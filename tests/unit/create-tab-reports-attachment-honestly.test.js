import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── "CREATED AND ATTACHED" MUST NOT BE PRINTED WHEN NOTHING ATTACHED ────────
 *
 * `browser_create_tab` at a restricted URL creates the tab, reserves it if an
 * `agent` was passed, and attaches NOTHING: the extension's `isRestricted`
 * branch skips chrome.debugger and never calls `tabManager.attachTab()`, so the
 * tab is absent from the attached-tab registry. tabTarget -> owning-extension
 * routing is built from that registry, so every later call fails.
 *
 * ⛔ THE COST IS THE WRONG ERROR, NOT THE FAILURE. With no extensionId the
 * server cannot resolve the browser and raises "Multiple extensions are
 * connected (N)" — which reads as the caller's own targeting mistake. The real
 * error only appears if you happen to pass extensionId: "Cannot attach debugger
 * to restricted URL: about:blank". A seat chasing the first message never sees
 * the second.
 *
 * MEASURED 2026-10-09, reported by `freelance` and reproduced on office:
 * create at about:blank -> "Created and attached tab 41942459" with
 * reservedBy unibrowse; browser_navigate({tabTarget}) -> "Multiple extensions
 * are connected (6)"; the same call WITH extensionId -> the restricted-URL
 * error. ⚠️ `freelance` read this as "an about:blank tab does not register its
 * owning extension". Descriptively right, but the mechanism is narrower and
 * more useful: it is EVERY URL the debugger cannot attach to, and the
 * reservation still succeeds — which is why the tab looks owned and works for
 * nothing.
 *
 * ⚠️ WHY THE SERVER SNIFFS THE URL INSTEAD OF TRUSTING A FIELD. The extension
 * now reports `attached: false`, but an extension change reaches NO browser
 * without the ↻ the operator declined — all six connected extensions run older
 * code. URL detection works on every build; the field is honoured in
 * preference when a newer build supplies it.
 *
 * ⛔ Asserts on SOURCE because the regression is invisible from outside: the
 * call still succeeds, the tab still exists, and only the claim is false.
 */

const repoRoot = path.join(import.meta.dirname, "../..");
const tabs = fs.readFileSync(path.join(repoRoot, "src/tools/tabs.ts"), "utf8");
const bg = fs.readFileSync(path.join(repoRoot, "extension/background.js"), "utf8");

/**
 * ⚠️ Strip comments, THEN collapse whitespace. Removing a comment leaves its
 * indentation behind as a blank line, so a fixed-width window measured on the
 * stripped text spans mostly spaces and misses the code it is looking for —
 * which reads as "the fix is missing" when the fix is right there.
 */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\s+/g, " ");
}

const tabsCode = codeOnly(tabs);
const bgCode = codeOnly(bg);

/**
 * ⛔ BOUND A BRANCH BY ITS BRACES, NEVER BY A CHARACTER COUNT. Written first
 * with a fixed 700/1400-char window, both windows ran past the end of the
 * branch into the code after it — so the "does not say Created and attached"
 * assertion read the NEXT return, and the "does not call attachTab"
 * assertion read the attach that follows. Two false failures, and had the
 * adjacent code differed they would have been false PASSES instead.
 */
function blockAfter(code, marker) {
  const i = code.indexOf(marker);
  assert.notEqual(i, -1, `expected to find ${marker}`);
  const open = code.indexOf("{", i);
  assert.notEqual(open, -1, `expected a block after ${marker}`);
  let depth = 0;
  for (let j = open; j < code.length; j++) {
    if (code[j] === "{") depth++;
    else if (code[j] === "}") {
      depth--;
      if (depth === 0) return code.slice(open, j + 1);
    }
  }
  throw new Error(`unbalanced block after ${marker}`);
}

test("the server decides attachment rather than asserting it", () => {
  assert.match(
    tabsCode,
    /const attached\s*:\s*boolean\s*=/,
    "createTab must compute whether the tab attached, not hardcode the claim",
  );
});

test("a URL the debugger cannot attach to is recognised from the response", () => {
  // ⛔ Must not depend solely on a new extension field: an extension fix ships
  // nowhere without a reload, so the server has to recognise this itself.
  assert.match(
    tabsCode,
    /urlIsUnattachable/,
    "the server must detect an unattachable URL from the returned url",
  );
  for (const scheme of ["about", "chrome", "chrome-extension", "devtools", "view-source"]) {
    assert.ok(
      tabsCode.includes(scheme),
      `the unattachable-URL test must cover ${scheme}: — the extension skips the debugger for all of them`,
    );
  }
  assert.match(
    tabsCode,
    /createdUrl === "about:blank"/,
    "about:blank is the case that was actually measured and must be covered explicitly",
  );
});

test("an explicit attached:false from a newer extension is believed", () => {
  assert.match(
    tabsCode,
    /result\.attached === false\s*\?\s*false\s*:/,
    "a newer extension reporting attached:false must win over URL sniffing",
  );
});

test("the unattached path does NOT claim the tab was attached", () => {
  const branch = blockAfter(tabsCode, "if (!attached)");
  assert.ok(
    !/Created and attached/.test(branch),
    "the unattached branch must never print 'Created and attached'",
  );
  assert.match(
    branch,
    /did NOT attach/,
    "the unattached branch must say so in words a caller reads",
  );
});

/**
 * ⚠️ THE WORKING PATH IS AN EXTERNAL SURFACE. Callers parse this text, so a
 * tab that genuinely attached must still read "Created and attached …"
 * byte-for-byte. Fixing the lie must not rewrite the truth.
 */
test("a tab that did attach still reports exactly as before", () => {
  assert.match(
    tabsCode,
    /message: `Created and attached tab \$\{result\.tabId\} \(label: "\$\{result\.label\}"\)/,
    "the attached path's message must be unchanged — callers parse it",
  );
});

test("the unattached message names the remedy, not just the fault", () => {
  const branch = blockAfter(tabsCode, "if (!attached)");
  assert.match(
    branch,
    /Create the tab at the real URL/,
    "a caller needs the fix: create at the target URL instead of navigating afterwards",
  );
});

test("a reservation is not reported as an attachment", () => {
  const branch = blockAfter(tabsCode, "if (!attached)");
  assert.match(
    branch,
    /reservation is not an attachment/,
    "the tab IS reserved on this path, which is exactly why it looks owned and works for nothing",
  );
});

test("the extension's restricted branch reports attached:false and a note", () => {
  const branch = blockAfter(bgCode, "if (isRestricted)");
  assert.match(
    branch,
    /attached:\s*false/,
    "the restricted branch must report attached:false, like the TOCTOU branch below it already does",
  );
  assert.match(
    branch,
    /note:/,
    "it must carry a note saying why, or the server can only guess from the URL",
  );
});

/**
 * ⚠️ The restricted branch must keep skipping the attach. The bug was the
 * REPORT, not the skip — attempting the attach anyway would turn a working
 * create into a failing one.
 */
test("the restricted branch still returns success and still skips the attach", () => {
  const branch = blockAfter(bgCode, "if (isRestricted)");
  assert.match(branch, /success:\s*true/, "creating the tab still succeeds");
  assert.ok(
    !/attachTab\(/.test(branch),
    "the restricted branch must not attempt attachTab — that would fail the create",
  );
});
