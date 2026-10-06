import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── THE RECORDER MUST PAUSE, NOT FILTER ──────────────────────────────────────
 *
 * Ben, Slack #unibrowse 2026-10-06: the recording should send "hardly any data
 * when the UI is not changing or when the tab is idle".
 *
 * ⛔ THE OBVIOUS IMPLEMENTATION CORRUPTS THE RECORDING. rrweb incremental
 * events are DIFFS against a FullSnapshot, so dropping the quiet ones leaves a
 * buffer that still uploads, still opens in review, and REPLAYS BLANK (memo
 * 65ae10d8). Pause/resume is safe only because each restart emits a fresh
 * FullSnapshot — a new base for the diff chain.
 *
 * ⚠️ AND THE IDLE SIGNAL IS INTERACTION, NOT VISUAL CHANGE. Measured the same
 * day: alpaca.markets emitted ~780 DOM events/min while looking completely
 * static to a human. A "has the UI changed" test would have found that page
 * busy and a backgrounded eBay tab — the one that cost 616 MB over 3.69 days —
 * equally busy. Visibility and interaction are the signals that discriminate.
 */

const raw = fs.readFileSync(
  path.join(import.meta.dirname, "../../extension/session-recorder.js"),
  "utf8",
);

// ⚠️ Assert against CODE, not comments. The first version of the scope test
// failed because the comment explaining the bug contains the very string the
// test forbids — a test matching its own documentation. Same shape as the
// interceptor-fingerprint test, which flagged the comment quoting the old flag
// name it was built to outlaw.
function codeOnly(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}
const src = codeOnly(raw);

test("typed inputs are masked at capture", () => {
  assert.match(src, /maskAllInputs:\s*true/);
  assert.equal(
    /maskAllInputs:\s*false/.test(src), false,
    "maskAllInputs false let rrweb record a card number and a password verbatim",
  );
});

test("the recorder pauses on a hidden tab and resumes on activity", () => {
  assert.match(src, /visibilitychange/);
  assert.match(src, /pauseRrweb\(['"]tab hidden['"]\)/);
  assert.match(src, /function startRrweb\(/);
});

test("idle is measured by INTERACTION, not by DOM churn", () => {
  for (const evt of ["pointerdown", "keydown", "scroll"]) {
    assert.ok(src.includes(`'${evt}'`), `${evt} must reset the idle timer`);
  }
  assert.match(src, /pauseRrweb\(['"]idle['"]\)/);
});

test("the checkout interval survives — the trimmer depends on it", () => {
  // Removing checkoutEveryNms silently disables the background's rolling trim,
  // because then rrweb emits exactly ONE FullSnapshot and offset 0 is the only
  // safe cut point. The two are a matched pair.
  assert.match(src, /checkoutEveryNms:\s*120000/);
});

test("rrwebOptions is reachable from startRrweb's scope", () => {
  // ⛔ THE BUG THIS EXISTS FOR, and `node --check` passes it happily: the first
  // version declared `const rrwebOptions` INSIDE the try block while
  // startRrweb() lives in the enclosing scope. A function resolves names from
  // where it is DEFINED, so the first resume would have thrown ReferenceError —
  // at which point the recorder stays paused forever and simply records nothing.
  // A syntax check is not a scope check.
  const declIdx = src.search(/^\s*let rrwebOptions = null;/m);
  const fnIdx = src.indexOf("function startRrweb(");
  assert.notEqual(declIdx, -1, "rrwebOptions must be declared with `let` in the outer scope");
  assert.ok(declIdx < fnIdx, "declaration must precede startRrweb");
  assert.equal(
    /const rrwebOptions/.test(src), false,
    "a block-scoped const puts it out of startRrweb's reach again",
  );
});
