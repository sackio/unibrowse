import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── THE ERROR THAT NAMES A SYMPTOM AND HIDES ITS CAUSE ──────────────────────
 *
 * Chrome's "Cannot access a chrome-extension:// URL of different extension"
 * comes out of chrome.debugger.attach() without saying WHICH extension, so it
 * is unactionable as shipped. Worse, the caller sees it as part of a sequence
 * that destroys its own evidence: one call succeeds, the next reports the
 * debugger detached, every later call carries this string, and then the tab
 * leaves the attached-tab registry so the diagnostic calls answer "No tab
 * found".
 *
 * MEASURED 2026-10-09: four round trips and two wrong hypotheses (one of them
 * mine) on office's desktop Chrome — realistic_click into a form field OK,
 * realistic_type → "debugger detached", everything after → this string, tab
 * gone. Reproduced on the normal profile and in incognito; the identical flow
 * worked on a container sidecar with no other extensions installed.
 *
 * ⛔ THE POINT OF THESE TESTS IS THAT IT MUST NOT GUESS A CULPRIT.
 * `extension/popup.js` rewrites the same string as "likely a New Tab override
 * or PDF viewer", and the attach-race comment in extension/background.js
 * records that this error was ALREADY once mistaken for exactly that. A
 * confident wrong cause is worse than no cause, because it is what stops the
 * next person looking.
 */

const repoRoot = path.join(import.meta.dirname, "../..");
const src = fs.readFileSync(path.join(repoRoot, "src/utils/response-helpers.ts"), "utf8");

function codeOnly(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

const code = codeOnly(src);

test("the shared error path runs the explainer, so every tool benefits", () => {
  assert.match(
    code,
    /let text = explainIfKnown\(message\)/,
    "errorResponse must enrich through explainIfKnown — enriching one tool leaves every other tool bare",
  );
});

test("it matches the browser's own wording", () => {
  assert.match(
    code,
    /Cannot access a chrome-extension/,
    "the matcher must key on Chrome's actual error text",
  );
});

test("it leaves every other error untouched", () => {
  const i = code.indexOf("function explainIfKnown");
  const fn = code.slice(i, code.indexOf("\n}", i));
  assert.match(
    fn,
    /if \(!DIFFERENT_EXTENSION_URL\.test\(message\)\) return message;/,
    "an unrelated error must pass through byte-for-byte — callers parse these strings",
  );
});

/**
 * ⛔ The load-bearing assertion. Not a style preference: the previous
 * rewrite of this string asserted a cause that was already known to be wrong.
 */
test("it names no culprit", () => {
  const i = code.indexOf("function explainIfKnown");
  const fn = code.slice(i, code.indexOf("\n}", i));
  for (const guess of ["1Password", "New Tab override", "PDF viewer"]) {
    assert.ok(
      !fn.includes(guess),
      `the explanation must not assert "${guess}" as the cause — Chrome does not say which extension, and a confident wrong cause stops the next person looking`,
    );
  }
});

test("it says the evidence disappears, which is why nobody caught it", () => {
  const i = code.indexOf("function explainIfKnown");
  const fn = code.slice(i, code.indexOf("\n}", i));
  assert.match(
    fn,
    /No tab found/,
    "the caller must be told the tab leaves the registry, or they investigate after the evidence is gone",
  );
});

test("it names the call that identifies the actual extension", () => {
  const i = code.indexOf("function explainIfKnown");
  const fn = code.slice(i, code.indexOf("\n}", i));
  assert.match(
    fn,
    /browser_list_frames/,
    "listing frames is what turns this from a symptom into a named cause",
  );
  assert.match(
    fn,
    /browser_list_extensions/,
    "listing installed extensions is the other half",
  );
});

test("it refuses to tell a caller to disable someone else's extension", () => {
  const i = code.indexOf("function explainIfKnown");
  const fn = code.slice(i, code.indexOf("\n}", i));
  assert.match(
    fn,
    /without asking them first/,
    "disabling a password manager on someone's real browser is their decision, not a debugging step",
  );
});
