import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── ATTACHING AN ALREADY-ATTACHED TAB MUST NOT RESERVE IT ────────────────────
 *
 * ⚠️ WHAT THIS IS AND IS NOT. It locks a rule that is right on its own terms:
 * a call that is only REPAIRING a tab should not take its reservation. It is
 * NOT a regression test for a reproduced bug.
 *
 * ⛔ MEASURED 2026-10-08, AND IT FALSIFIED THE STORY THIS FILE FIRST TOLD: an
 * already-attached tab with a healthy CDP session is NOT claimed on the pre-fix
 * code — handleEnsureAttached returns before reaching attachTab. Verified by
 * attaching tab 41942031 on office with an `agent` set and finding it still
 * unreserved. The gate therefore bites only where attachTab is actually
 * reached: a first attach, or the CDP-disconnected re-attach branch.
 *
 * ⛔ The 2026-10-08 incident in which `claude-login-auto` acquired a
 * reservation on `alpaca`'s signup tab is UNEXPLAINED. Do not cite this file
 * as its fix.
 *
 * ⭐ THE DISTINCTION THIS LOCKS: claiming on attach is correct when the call
 * CREATED the attachment, and wrong when the tab was already attached. A first
 * attach is an acquisition; re-attaching someone else's live tab is a repair.
 *
 * ⚠️ WHY A TEST AND NOT JUST THE FIX: the regression is invisible from the
 * outside. Re-adding the unconditional claim leaves every attach succeeding
 * with an identical response — only the reservation quietly changes owner, and
 * the seat that loses its tab finds out one call later, somewhere else.
 *
 * ⛔ UNDEPLOYED AT THE TIME OF WRITING. This is extension code, and an
 * extension change reaches no running browser without the ↻ on
 * chrome://extensions that Ben has declined (memo `98c8143f`). The test guards
 * the source so the fix is intact whenever a reload finally happens.
 */

const repoRoot = path.join(import.meta.dirname, "../..");

function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

const bg = codeOnly(
  fs.readFileSync(path.join(repoRoot, "extension/background.js"), "utf8"),
);

test("attachTab records whether the tab was already attached, BEFORE claiming", () => {
  assert.match(
    bg,
    /const wasAlreadyAttached = this\.attachedTabs\.has\(tabId\);/,
    "the already-attached state must be captured — it is the whole discriminator",
  );
  const claimIdx = bg.indexOf("this.claimTab(tabId, agent, { takeover: takeover === true });");
  const flagIdx = bg.indexOf("const wasAlreadyAttached = this.attachedTabs.has(tabId);");
  assert.ok(flagIdx !== -1 && claimIdx !== -1, "both the flag and the claim must exist");
  assert.ok(
    flagIdx < claimIdx,
    "the flag must be read BEFORE the claim — attachTab inserts into attachedTabs, " +
      "so reading it afterwards always reports true and the guard never fires",
  );
});

test("the claim is gated on a first attach or an explicit takeover", () => {
  assert.match(
    bg,
    /if \(!wasAlreadyAttached \|\| takeover === true\) \{\s*this\.claimTab\(tabId, agent, \{ takeover: takeover === true \}\);/,
    "a heal attach must not claim; an explicit takeover:true must still transfer",
  );
});

test("nothing claims unconditionally on the attach path any more", () => {
  const unconditional = bg.match(/^\s*this\.claimTab\(tabId, agent, \{ takeover: takeover === true \}\);/gm) || [];
  assert.equal(
    unconditional.length,
    1,
    "exactly one claim site on this path, and it is the gated one — a second, " +
      "ungated call would restore the bug while every test above still passed",
  );
});

test("a skipped claim is logged, so a caller can tell it does not own the tab", () => {
  assert.match(
    bg,
    /NOT claiming it \(heal, not acquisition\)/,
    "silence here is what made the original incident invisible to both seats",
  );
  assert.match(
    bg,
    /browser_reserve_tab/,
    "the log must name the call that DOES take ownership, or the advice is incomplete",
  );
});
