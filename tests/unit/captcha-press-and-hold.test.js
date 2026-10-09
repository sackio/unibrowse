import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── PRESS-AND-HOLD ON THE CAPTCHA RELAY ──────────────────────────────────────
 *
 * Ben, Slack #unibrowse 2026-10-08, approving it: the relay could only send
 * discrete clicks, and PerimeterX — which is what fiverr.com actually serves,
 * not Cloudflare — challenges with a press-and-hold button. A relay that cannot
 * hold cannot pass it, so "hand the captcha to a phone" had a hole exactly
 * where the operator would reach for it.
 *
 * ⭐ WHY THE DURATION RIDES THE EXISTING `tap` BODY. The public write surface is
 * exactly three $-anchored paths — POST /f/up-<32hex>/{tap,text,done} — granted
 * deliberately narrow by the `nginx` seat. A `hold` path would be a fourth
 * verb: their change, their deploy, another round trip. A field on a body we
 * already POST is ours alone, and ships on a :9010 restart.
 *
 * ⭐ AND WHY NO EXTENSION CHANGE. `downDelay` already exists in
 * extension/utils/cdp.js clickRealistic(), which sleeps it between
 * mousePressed and mouseReleased. It is NOT declared on the
 * browser_realistic_click tool schema, so it is unreachable through the tool —
 * but the captcha replay talks to the socket directly, which is the only reason
 * this works without the chrome://extensions ↻ Ben has declined.
 */

const repoRoot = path.join(import.meta.dirname, "../..");
const captcha = fs.readFileSync(path.join(repoRoot, "src/captcha.ts"), "utf8");
const httpServer = fs.readFileSync(path.join(repoRoot, "src/http-server.ts"), "utf8");

test("holdMs is validated and REFUSED out of range, never clamped", () => {
  assert.match(
    captcha,
    /holdMs must be 0\.\.20000/,
    "an out-of-range hold must be refused with a stated range",
  );
  assert.match(
    captcha,
    /status\(400\)\.json\(\{ ok: false, error: "holdMs must be 0\.\.20000" \}\)/,
    "it must be a 400, not a silent adjustment",
  );
  assert.ok(
    !/Math\.min\(\s*h\s*,\s*20000\s*\)/.test(captcha),
    "⛔ the server must not clamp: a silently shortened hold looks like a hold " +
      "that did not work, and the operator retries something never sent as asked",
  );
});

test("the hold reaches the extension as downDelay, and only when supplied", () => {
  assert.match(
    httpServer,
    /holdMs !== undefined \? \{ downDelay: holdMs \} : \{\}/,
    "downDelay must be passed through only when a hold was actually measured — " +
      "omitting it keeps the extension's own randomised 50-100ms, which is more " +
      "human than a replayed exact value",
  );
});

test("the replayed click starts from a tracked origin, never (0,0)", () => {
  assert.match(
    httpServer,
    /currentX: from\.x, currentY: from\.y/,
    "the bezier origin must be supplied — omitted, the extension starts every " +
      "relayed tap at the viewport corner, which is a signature",
  );
  assert.match(
    httpServer,
    /s\.cursor \?\?/,
    "it must use the session's last tap position when there is one",
  );
  assert.ok(
    !/currentX:\s*0\b/.test(httpServer),
    "a constant origin is the defect, not the fix",
  );
  assert.match(captcha, /s\.cursor = \{ x, y \};/, "each tap must record where it left the pointer");
});

test("the page measures the gesture instead of offering preset durations", () => {
  assert.match(captcha, /pointerdown/, "must listen on pointerdown to start timing");
  assert.match(captcha, /pointerup/, "must send on pointerup");
  assert.match(
    captcha,
    /holdStart = Date\.now\(\)/,
    "the duration must come from the operator's own gesture",
  );
  assert.match(
    captcha,
    /Date\.now\(\) - holdStart/,
    "and the sent value must be the elapsed gesture, not a chosen constant",
  );
});

test("a cancelled or window-blurred hold still sends", () => {
  assert.match(
    captcha,
    /addEventListener\('pointercancel', endHold\)/,
    "a cancelled pointer sequence must still deliver the hold",
  );
  assert.match(
    captcha,
    /addEventListener\('blur', endHold\)/,
    "⛔ otherwise the operator holds for seconds, lifts off the image edge, and " +
      "nothing happens with no error — the exact silent failure this relay exists to remove",
  );
});

test("the press position comes from pointerdown, not the release point", () => {
  const down = captcha.indexOf("holdFx = (e.clientX");
  const up = captcha.indexOf("function endHold");
  assert.ok(down !== -1 && up !== -1, "both handlers must exist");
  assert.ok(
    down < up,
    "position is captured at press time; a finger drifting during a multi-second " +
      "hold must not relocate the click",
  );
  assert.ok(
    !/endHold[\s\S]{0,400}e\.clientX/.test(captcha),
    "the release handler must not recompute coordinates",
  );
});

test("a short press stays an ordinary tap", () => {
  assert.match(
    captcha,
    /if \(held >= 250\) body\.holdMs = Math\.min\(held, 20000\)/,
    "sub-250ms presses must send no holdMs at all, so the extension keeps its own jitter",
  );
});
