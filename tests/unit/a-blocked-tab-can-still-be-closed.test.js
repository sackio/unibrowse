import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── A TAB WHOSE RENDERER IS BLOCKED MUST STILL BE CLOSABLE ──────────────────
 *
 * `handleCloseTab` awaited `detachTab()` before `chrome.tabs.remove`, and
 * detachTab does renderer-dependent work FIRST: the recording-stop hook, a CDP
 * Runtime.evaluate to strip the "🟢 [MCP] " title prefix (sendCommand gives
 * Runtime.evaluate a 120s budget), then a chrome.scripting fallback with no
 * timeout at all. All of it blocks while the tab's renderer is blocked.
 *
 * ⇒ A tab nobody could drive was also a tab nobody could CLOSE, and the caller
 * saw only "WebSocket response timeout" at 30s while the handler ground on.
 *
 * REPORTED 2026-10-10 14:04 by `freelance`: desktop tabs 41942990 and 41943114
 * on app.sortlist.com hung on every call including close_tab after a
 * location.reload, while a sibling tab on the SAME URL stayed healthy. Their
 * reading was a beforeunload "Leave site?" dialog.
 *
 * ✅ The dialog was CONFIRMED later the same day by an X screenshot of office's
 * display, and cleared with ui-eye's AXPress — four prompts stacked, after
 * which both tabs closed themselves, because the close_tab calls that had
 * "timed out" 20 minutes earlier were still queued behind it.
 *
 * ⚠️ I had first called it unobservable, on the strength of ui-eye's macOS-
 * centric schema text rather than a try; ui-eye reaches office fine. These
 * tests are still about the ORDERING, which blocks the close for any renderer
 * wedge, dialog or not — the dialog is what exposed it, not what it is about.
 *
 * ⛔ Asserts on SOURCE: the regression needs a wedged renderer to show itself,
 * which cannot be staged in this suite.
 */

const repoRoot = path.join(import.meta.dirname, "../..");
const bg = fs.readFileSync(path.join(repoRoot, "extension/background.js"), "utf8");
const tabs = fs.readFileSync(path.join(repoRoot, "src/tools/tabs.ts"), "utf8");
const schemas = fs.readFileSync(path.join(repoRoot, "src/types/tool-schemas.ts"), "utf8");
const httpServer = fs.readFileSync(path.join(repoRoot, "src/http-server.ts"), "utf8");

function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

const bgCode = codeOnly(bg);

/**
 * ⛔ Skip the parameter list before brace-matching. The first `{` after a
 * handler's name is its payload DESTRUCTURE, and matching from there returns
 * the parameter list — every landmark inside the function then reads as
 * absent, which looks exactly like "the fix is missing". Four false failures
 * on 2026-10-10 before this line existed.
 */
function fnBody(code, signatureStart) {
  const i = code.indexOf(signatureStart);
  assert.notEqual(i, -1, `expected to find ${signatureStart}`);
  const parenEnd = code.indexOf(") {", i);
  assert.notEqual(parenEnd, -1, `expected a body for ${signatureStart}`);
  const open = parenEnd + 2;
  let depth = 0;
  for (let j = open; j < code.length; j++) {
    if (code[j] === "{") depth++;
    else if (code[j] === "}") {
      depth--;
      if (depth === 0) return code.slice(open, j + 1);
    }
  }
  throw new Error(`unbalanced body for ${signatureStart}`);
}

const close = fnBody(bgCode, "async handleCloseTab(");

test("the detach is time-bounded, so teardown cannot gate the close", () => {
  assert.match(close, /DETACH_BUDGET_MS/, "the detach must run against a budget");
  assert.match(
    close,
    /Promise\.race\(\[\s*this\.tabManager\.detachTab\(/,
    "detachTab must be raced against that budget rather than simply awaited",
  );
});

test("the close is attempted even when the detach never finished", () => {
  const detachIdx = close.indexOf("detachTab(");
  const removeIdx = close.indexOf("chrome.tabs.remove(");
  assert.ok(detachIdx !== -1 && removeIdx !== -1, "both steps must be present");
  assert.ok(removeIdx > detachIdx, "the remove still follows the detach attempt");
  assert.ok(
    !/if \(!detachFinished\) \{[^}]*return/s.test(close),
    "a detach that timed out must not short-circuit the close",
  );
});

test("the remove is bounded too, because its own blocking is not ruled out", () => {
  assert.match(close, /REMOVE_BUDGET_MS/, "chrome.tabs.remove needs its own bound");
  assert.match(
    close,
    /resolve\('blocked'\)/,
    "a blocked remove must be distinguishable from a successful one",
  );
});

/**
 * ⛔ THE LOAD-BEARING ONE. An earlier draft forgot the tab as soon as the
 * detach timed out. That was wrong twice: it told the server a tab had
 * detached while its debugger was still attached, and it put the tab out of
 * reach of browser_handle_dialog — the one call that can unblock it — because
 * that resolves through the attached-tab registry.
 */
test("a tab that would not close stays addressable", () => {
  const blockedBranch = close.slice(close.indexOf("if (outcome === 'blocked')"));
  assert.ok(
    !/forgetTab\(/.test(blockedBranch.slice(0, blockedBranch.indexOf("throw err"))),
    "the tab must NOT be forgotten when the close failed — that is what keeps it reachable",
  );
  assert.match(
    close,
    /if \(wasAttached && !detachFinished\) this\.tabManager\.forgetTab\(/,
    "the bookkeeping must run once the tab is genuinely gone",
  );
});

test("the failure tells the caller the one call that can unblock it", () => {
  assert.match(
    close,
    /browser_handle_dialog\(\{tabTarget: \$\{resolvedTabId\}, accept: true\}\)/,
    "a blocked close must name the remedy with the tab already filled in",
  );
});

/**
 * ⭐ forgetTab exists precisely so the registry can be made honest without the
 * renderer's cooperation. If it ever grows an await, it has stopped being that.
 */
test("forgetTab needs no renderer", () => {
  const forget = fnBody(bgCode, "forgetTab(");
  assert.ok(!/await /.test(forget), "forgetTab must not await anything");
  assert.match(forget, /attachedTabs\.delete/, "it drops the attachment");
  assert.match(forget, /reservations\.delete/, "and the reservation");
  assert.match(forget, /TAB_DETACHED/, "and tells the server, which detachTab could no longer reach");
});

test("detachTab still does the same bookkeeping, via the shared path", () => {
  const detach = fnBody(bgCode, "async detachTab(");
  assert.match(detach, /this\.forgetTab\(tabId\)/, "detachTab must use the extracted helper, not a copy");
});

// ── the dialog tool ────────────────────────────────────────────────────────

test("the dialog handler is registered and uses the browser-process command", () => {
  assert.match(
    bgCode,
    /handlers\['browser_handle_dialog'\]/,
    "the handler must be registered or the message type is unknown",
  );
  const h = fnBody(bgCode, "async handleHandleDialog(");
  assert.match(
    h,
    /'Page\.handleJavaScriptDialog'/,
    "only this command is served by the browser process rather than the blocked renderer",
  );
});

/**
 * ⭐ "No dialog is showing" is an ANSWER. A caller asking "clear whatever is
 * blocking this tab" needs to learn that nothing was — which is also the
 * cheapest way to rule a dialog out as the cause.
 */
test("no dialog is a successful answer, not an error", () => {
  const h = fnBody(bgCode, "async handleHandleDialog(");
  assert.match(h, /No dialog is showing/i, "the CDP wording must be recognised");
  assert.match(h, /dialogPresent: false/, "and reported as a result the caller can branch on");
});

test("the tool is exposed to callers", () => {
  assert.match(schemas, /export const HandleDialogTool/, "a schema must exist");
  assert.match(tabs, /export const handleDialog: Tool/, "the server tool must exist");
  assert.match(httpServer, /tabs\.handleDialog/, "and be registered, or no caller can reach it");
});

/**
 * ⚠️ Every extension-side change reaches no browser until its unibrowse card is
 * reloaded, so the first thing a caller will meet is "Unknown message type" —
 * which reads as a broken tool and has a completely different remedy.
 */
test("an extension running older code is named as such", () => {
  assert.match(tabs, /Unknown message type/, "the undeployed case must be detected");
  assert.match(
    tabs,
    /chrome:\/\/extensions/,
    "and the caller told what actually fixes it",
  );
});
