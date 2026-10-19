import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── A SUCCESS THAT MEANT "THE BROKER ACCEPTED IT", NOT "SOMEONE WAS TOLD" ────
 *
 * Measured and reported by the `atc` seat, 2026-10-19 10:24:51Z:
 * `browser_request_captcha_solve` was called with `agent=alpaca-signup` — a
 * name with no /subscribers row and no conv registry entry under either
 * spelling. The notice was sent AS that name, the bridge had no channel to
 * route it to, it diverted to the `atc` seat, and the operator was never
 * pinged. The tool returned a link and a success, and the requester had no way
 * to learn any of it.
 *
 * ⛔ THE DEFECT IS NOT THE DIVERT. The divert names its reason and reaches a
 * seat that can escalate, which is how this was found at all. The defect is
 * that the CALLER COULD NOT TELL a notifiable agent from an unnotifiable one,
 * and that the response's own wording promised a fallback ("else the solver's
 * DM") that did not happen.
 *
 * ⚠️ Slipway shares the shape and raises the stakes: its link reads and drives
 * EVERY tab in a browser until the TTL expires, so a notice nobody receives
 * leaves a live capability open with no one watching it.
 *
 * ⭐ `reachable: false` IS NOT AN ERROR. Real seats read false — a container
 * sidecar, or `claude-login-auto`, which has no channel by design. These tests
 * therefore assert that the relay STOPS PROMISING a notice, never that it
 * refuses the work.
 */

const repoRoot = path.join(import.meta.dirname, "../..");
const captcha = fs.readFileSync(path.join(repoRoot, "src/tools/captcha.ts"), "utf8");
const slipway = fs.readFileSync(path.join(repoRoot, "src/tools/slipway.ts"), "utf8");
const publish = fs.readFileSync(path.join(repoRoot, "src/utils/atc-publish.ts"), "utf8");

const RELAYS = [
  ["captcha", captcha],
  ["slipway", slipway],
];

test("both relays resolve the requester before promising it a notice", () => {
  for (const [name, src] of RELAYS) {
    assert.match(src, /seatReachable\(requester\)/, `${name} must probe the requester it was given`);
    assert.match(
      src,
      /requesterReachable/,
      `${name} must report the resolution — the caller could not tell, and that was the defect`,
    );
    assert.match(src, /requesterBasis/, `${name} must carry the REASON, not just a boolean`);
  }
});

/**
 * ⛔ The one assertion that would have caught the original. `from: requester`
 * with no resolution check is the line that diverted.
 */
test("neither relay sends as a name that resolves to nobody", () => {
  for (const [name, src] of RELAYS) {
    assert.match(
      src,
      /reach\.reachable !== false \? requester :/,
      `${name} must fall back to a routable sender when the requester does not resolve`,
    );
    assert.doesNotMatch(
      src,
      /from: requester \?\?/,
      `${name} must not send as the raw requester — that is the 2026-10-19 defect verbatim`,
    );
  }
});

/**
 * ⚠️ A DIAGNOSTIC THAT CAN BREAK THE THING IT DIAGNOSES IS WORSE THAN NO
 * DIAGNOSTIC. A captcha that cannot be minted because the broker was slow would
 * be a bigger bug than the one being fixed, so the probe is bounded and cannot
 * throw.
 */
test("the reachability probe cannot fail a mint", () => {
  const fn = publish.slice(publish.indexOf("export async function seatReachable"));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  assert.match(body, /AbortSignal\.timeout\(/, "the probe must be bounded in time");
  assert.match(body, /catch/, "the probe must never throw into the caller's happy path");
  assert.match(
    body,
    /reachable: null/,
    'an unanswerable probe must report null — collapsing it to false invents a defect, to true restores the false promise',
  );
});

/**
 * ⛔ The endpoint's own note says absence and deafness are not distinguished.
 * A relay that reported "no such agent" on this evidence would be asserting
 * something it cannot know.
 */
test("an unreachable requester is reported as unread, not as a wrong name", () => {
  for (const [name, src] of RELAYS) {
    assert.match(
      src,
      /resolves to nobody/,
      `${name} must describe the inbox, not accuse the name`,
    );
    assert.doesNotMatch(
      src,
      /no such agent|unknown agent|invalid agent/i,
      `${name} must not claim the agent does not exist — basis:none cannot establish that`,
    );
  }
});

/**
 * ⭐ The operational consequence is the same for both causes, and it is the only
 * thing the caller actually has to act on.
 */
test("an unreachable requester is told to send the link itself", () => {
  for (const [name, src] of RELAYS) {
    const step = src.slice(src.indexOf("nextStep:"));
    assert.match(
      step.slice(0, 1200),
      /reach\.reachable === false/,
      `${name}'s nextStep must branch on the resolution, not only on notified.ok`,
    );
  }
});
