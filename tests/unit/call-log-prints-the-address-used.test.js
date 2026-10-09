import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── THE ROUTING LOG MUST PRINT WHICHEVER ADDRESS THE CALLER USED ────────────
 *
 * Several tools accept EITHER `tabId` or `tabTarget` and their schemas refine
 * to require exactly one — browser_close_tab and browser_switch_tab among them.
 * The [Call] line originally printed only `tabTarget`, so a perfectly
 * well-addressed call rendered as `tabTarget=-`.
 *
 * ⛔ THAT IS NOT A MISSING DETAIL, IT IS A FALSE STATEMENT ABOUT THE CALL.
 * "-" reads as "no target supplied", which invites the reader to conclude a
 * fallback resolved it.
 *
 * MEASURED 2026-10-09, and it produced a wrong finding published to another
 * seat: claude-login-auto's closes logged as
 *   [Call] browser_close_tab tabTarget=- ... -> tabId=41942398
 * I read that as a bare close retargeted through lastUsedTabId, and said so.
 * It was not. The caller had passed `tabId: 41942398` and handleCloseTab
 * honoured it exactly — it resolves tabId FIRST and has no lastUsed fallback.
 * The real bug was in the caller's decision to issue the close at all.
 *
 * ⚠️ A diagnostic that omits one of two equivalent fields is worse than one
 * that omits both: it looks complete, so nobody goes and checks the handler.
 */

const repoRoot = path.join(import.meta.dirname, "../..");
const context = fs.readFileSync(path.join(repoRoot, "src/context.ts"), "utf8");
const bg = fs.readFileSync(path.join(repoRoot, "extension/background.js"), "utf8");

function logBlock() {
  const i = context.indexOf("const reqTarget");
  assert.notEqual(i, -1, "the [Call] log must still build a request description");
  return context.slice(i, context.indexOf("console.log(`[Call]", i) + 200);
}

test("the log reads tabId as well as tabTarget", () => {
  assert.match(
    logBlock(),
    /payload as any\)\?\.tabId/,
    "tabId must be read — tools that take it log as having no target otherwise",
  );
});

test("a call addressed by tabId does not render as having no target", () => {
  const block = logBlock();
  // The "-" placeholder must only be reachable when BOTH are absent.
  assert.match(
    block,
    /reqTabId\s*!=\s*null/,
    "tabId must be checked before falling back to the no-target placeholder",
  );
  assert.equal(
    /tabTarget=\$\{reqTarget \?\? "-"\}/.test(block),
    false,
    'printing `tabTarget=${reqTarget ?? "-"}` unconditionally is the bug this guards',
  );
});

/**
 * ⛔ The claim the bad log line led me to assert — that close_tab falls back to
 * lastUsedTabId — must stay false. If someone ever adds that fallback, a
 * mis-addressed close silently kills another agent's live tab.
 */
test("handleCloseTab resolves tabId first and has no lastUsed fallback", () => {
  const i = bg.indexOf("async handleCloseTab(");
  assert.notEqual(i, -1, "handleCloseTab must exist");
  const fn = bg.slice(i, i + 1400);
  assert.match(
    fn,
    /let resolvedTabId = tabId;/,
    "an explicitly supplied tabId must win outright",
  );
  assert.equal(
    /lastUsedTabId/.test(fn),
    false,
    "closing must never fall back to the global last-used pointer — that would close someone else's tab",
  );
});
