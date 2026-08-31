import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The popup's onMessage listener gates traffic behind a hardcoded allowlist.
 * A `case` in handlePopupMessage() that is missing from that allowlist never
 * reaches a listener at all: the listener returns false, nothing else answers,
 * and Chrome reports
 *
 *   "A listener indicated an asynchronous response by returning true, but the
 *    message channel closed before a response was received"
 *
 * — which reads like an async/timeout bug and is actually a missing string.
 *
 * ⛔ NOTHING ELSE CATCHES THIS. Not the parser, not load time, not the
 * typecheck: two lists simply disagree and the feature is dead. Shipped
 * exactly that on 2026-08-31 (get_destinations, send_to_agent); ben hit it on
 * the first click. This test is the guard that was missing.
 */

const src = fs.readFileSync(
  path.join(import.meta.dirname, "../../extension/background.js"),
  "utf8",
);

function allowlist() {
  const m = src.match(/static POPUP_MESSAGE_TYPES = \[([\s\S]*?)\];/);
  assert.ok(m, "POPUP_MESSAGE_TYPES must exist — the listener reads it by name");
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

function switchCases() {
  const start = src.indexOf("async handlePopupMessage(message, sendResponse) {");
  assert.ok(start > -1, "handlePopupMessage must exist");
  // The method ends at the first dedented closing brace.
  const body = src.slice(start);
  const end = body.indexOf("\n  }\n");
  assert.ok(end > -1, "could not find the end of handlePopupMessage");
  return [...body.slice(0, end).matchAll(/case '([a-z_]+)':/g)].map((x) => x[1]);
}

test("⛔ every popup switch case is allowlisted — or it silently never runs", () => {
  const allowed = allowlist();
  const cases = switchCases();
  const missing = cases.filter((c) => !allowed.includes(c));
  assert.deepEqual(
    missing,
    [],
    `handled in the switch but NOT in POPUP_MESSAGE_TYPES, so unreachable: ${missing.join(", ")}`,
  );
});

test("the allowlist has no entries the switch cannot handle", () => {
  const allowed = allowlist();
  const cases = switchCases();
  const orphans = allowed.filter((a) => !cases.includes(a));
  assert.deepEqual(
    orphans,
    [],
    `allowlisted but no case handles them, so they fall to the default error: ${orphans.join(", ")}`,
  );
});

test("the listener reads the shared constant, not a second inline literal", () => {
  // The original bug existed because the array was written out inline, 2200
  // lines from the switch. If someone re-inlines it, the two tests above go on
  // passing while the listener consults a different list entirely.
  assert.match(
    src,
    /const popupMessages = BackgroundController\.POPUP_MESSAGE_TYPES;/,
    "the listener must consult POPUP_MESSAGE_TYPES itself, not a copy",
  );
});

test("the message types the send-to-agent feature needs are actually wired", () => {
  const allowed = allowlist();
  for (const t of ["get_destinations", "send_to_agent"]) {
    assert.ok(allowed.includes(t), `${t} must be reachable from the popup`);
  }
});
