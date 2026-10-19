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
/**
 * ⛔ THE FALLBACK THAT WAS THEATRE. For about three hours on 2026-10-19 the
 * captcha relay fell back to `unibrowse-captcha` when the requester did not
 * resolve — a name that is ITSELF unbound, so it diverts exactly like the one it
 * was rescuing. `atc` measured the divert to commit b347914, 2026-10-14
 * 13:10:48 EDT; before that an unbound sender really did produce an operator DM,
 * which is why the recorded mechanism read correct for five weeks after it went
 * false.
 *
 * ⚠️ The agent-less path had the same hole, and only luck hid it: no
 * `unibrowse-captcha` notice had been minted since 10-12 19:16, so the first
 * agent-less captcha after the bridge change would have vanished —
 * `claude-login-auto`, which has no channel by design, included.
 */
test("an operator notice is never sent from an unbound sender", () => {
  const captchaSrc = captcha;
  assert.match(
    captchaSrc,
    /const OPERATOR_NOTICE_FROM = "unibrowse"/,
    "the human-facing sender must be a name the bridge can resolve",
  );
  const route = captchaSrc.slice(captchaSrc.indexOf("const sendAs ="));
  assert.match(
    route.slice(0, 200),
    /OPERATOR_NOTICE_FROM/,
    "the fallback sender must resolve — NOTIFY_FROM is unbound and diverts",
  );
  assert.doesNotMatch(
    route.slice(0, 200),
    /: NOTIFY_FROM/,
    "falling back to unibrowse-captcha is the 2026-10-19 theatre, reintroduced",
  );
});

/**
 * ⭐ SCOPE, from `atc`, so this is not over-corrected: the divert fires ONLY on
 * the operator-DM path. A message addressed to an ordinary SEAT is untouched, so
 * the solved-notice to the requester must keep its unbound provenance name — it
 * must NOT be "fixed" along with the operator path.
 */
test("the solved-notice to a seat is left on its own sender", () => {
  const fn = captcha.slice(captcha.indexOf("export async function notifySolvedToRequester"));
  const body = fn.slice(0, fn.indexOf("\nfunction "));
  assert.match(body, /from: NOTIFY_FROM/, "a seat-addressed DM is not affected by the divert");
});

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

/**
 * ⛔⛔ DELIVERED AND RUNG ARE DIFFERENT CLAIMS, AND THE BROKER CAN ONLY REPORT
 * THE FIRST. A Slack channel message with no @-mention raises no push on the
 * operator's phone; a DM always does. Three captcha relays expired at 0 taps on
 * 2026-10-19 with `sent: 1` on every one, and he was demonstrably present for
 * the third — he wrote "you can send me captchas to solve" in #alpaca at 06:13
 * EDT and a notice posted into that same channel expired untouched 35 minutes
 * later. Diagnosed by `atc`; I had the 0-tap pattern and blamed time of day.
 */
test("a notice addressed to a human carries an @-mention", () => {
  const mention = fs.readFileSync(path.join(repoRoot, "src/utils/atc-publish.ts"), "utf8");
  assert.match(
    mention,
    /export function slackMention\(/,
    "the mention must be derived in one place, not spelled into each notice",
  );
  assert.match(
    mention,
    /\^slack:\(U\[A-Z0-9\]/,
    "it must key on the RECIPIENT being a Slack human, not on a hardcoded operator id",
  );
  for (const [name, src] of RELAYS) {
    assert.match(src, /slackMention\(/, `${name}'s notice must carry the mention that makes it ring`);
  }
});

/**
 * ⚠️ THE GUARD THAT KEEPS THE MENTION WORTH ANYTHING. `atc`: a mention on every
 * seat notice is how he ends up muting the channel. Keying on the recipient is
 * what makes this self-limiting — agent-to-agent traffic gets "" and the
 * solved-notice to a requesting SEAT must never acquire one.
 */
test("a seat-addressed notice carries no mention", () => {
  const fn = captcha.slice(captcha.indexOf("export async function notifySolvedToRequester"));
  const body = fn.slice(0, fn.indexOf("\nfunction "));
  assert.doesNotMatch(
    body,
    /slackMention|<@U/,
    "the solved-notice goes to an agent — a mention there is noise with no recipient",
  );
});

/**
 * ⛔ THE RISK IS RE-MINT BURSTS, NOT NOTICE VOLUME. `atc` measured the live
 * broker log 2026-10-19: 38 "Captcha needs you" notices since 10-12 is 5.4/day,
 * but they arrive in bursts because a failed captcha re-mints — apis/BLS rang 5
 * times in 51 minutes on ONE form. Unguarded, the mention turns that into five
 * phone pings, which is what trains a person to mute a channel.
 */
test("a re-mint of the same task does not ring again", () => {
  const fn = captcha.slice(captcha.indexOf("function shouldMention("));
  const body = fn.slice(0, fn.indexOf("\nasync function "));
  assert.match(body, /session\.tabTarget/, "the task key must be the tab the captcha is bound to");
  assert.doesNotMatch(
    body,
    /session\.prompt/,
    'keying on prompt text would ring for every retry — "New image" is the same task',
  );
  assert.match(body, /lastMentionedAt\.delete/, "the map must be pruned, not grown per tab forever");
  assert.match(
    captcha,
    /shouldMention\(session\) \? slackMention\(to\) : ""/,
    "the dedupe must gate the MENTION, never the notice",
  );
});

/**
 * ⭐ Only the ping is deduped. A re-mint carries a NEW link and the old one is
 * expired or spent, so suppressing the POST would hide the live link — the
 * opposite of the 10-12 direction.
 */
test("every notice is still posted, deduped or not", () => {
  const fn = captcha.slice(captcha.indexOf("async function notify("));
  const body = fn.slice(0, fn.indexOf("\n/**", 10));
  assert.match(body, /return sendBrokerMessage\(/, "the send must be unconditional");
  assert.doesNotMatch(
    body,
    /if \(!mention\) return/,
    "a suppressed mention must never short-circuit the notice itself",
  );
});
