import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── THREE FAULTS A REAL PHONE FOUND AND A DESKTOP NEVER WOULD ───────────────
 *
 * Ben, Slack #unibrowse 2026-10-09, solving three relayed captchas on Android
 * Chrome: "basically none of them work ... number three doesn't even explain
 * anything it's broken ... when I press and hold my context menu pops up here".
 *
 * Each symptom was a different bug, and every one of them is invisible from a
 * desktop browser or from the server's own logs:
 *
 *  1. LONG PRESS RAISED THE BROWSER'S CONTEXT MENU. `preventDefault()` on
 *     pointerdown does not stop it — the menu comes off the touch sequence.
 *     Only the CSS opt-outs do.
 *  2. A FAILED SCREENSHOT RENDERED AS A BLANK FRAME. /shot answers with a JSON
 *     error body; an <img> cannot render JSON, and there was no onerror, so the
 *     operator saw nothing at all and could not tell broken from loading.
 *  3. THE TAB WAS HIDDEN. Page.captureScreenshot waits on a compositor frame
 *     and Chrome does not composite a background tab, so the capture timed out.
 *
 * ⛔ Asserted on source: none of these three produce a server-side error, a
 * failed tool call, or a log line. The only instrument that caught them was a
 * person holding a phone.
 */

const repoRoot = path.join(import.meta.dirname, "../..");
const captcha = fs.readFileSync(path.join(repoRoot, "src/captcha.ts"), "utf8");
const httpServer = fs.readFileSync(path.join(repoRoot, "src/http-server.ts"), "utf8");

function shotCss() {
  const i = captcha.indexOf("#shot {");
  assert.notEqual(i, -1, "the screenshot img must still carry its own rule");
  return captcha.slice(i, captcha.indexOf("}", i));
}

test("the screenshot image opts out of every touch gesture the browser would claim", () => {
  const css = shotCss();
  for (const prop of ["touch-action:none", "-webkit-touch-callout:none", "user-select:none"]) {
    assert.ok(
      css.replace(/\s+/g, "").includes(prop.replace(/\s+/g, "")),
      `#shot must set ${prop} — without it a long press is stolen by the phone`,
    );
  }
});

test("a long press cannot raise a context menu or start a drag", () => {
  assert.match(
    captcha,
    /addEventListener\('contextmenu'[\s\S]{0,160}preventDefault/,
    "a contextmenu handler must cancel the menu over the screenshot",
  );
  assert.match(
    captcha,
    /addEventListener\('dragstart'[\s\S]{0,160}preventDefault/,
    "a dragstart handler must stop the image being dragged mid-hold",
  );
});

const slipway = fs.readFileSync(path.join(repoRoot, "src/slipway.ts"), "utf8");

/** The body of the page's shot() in either relay, as source text. */
function shotBody(src) {
  const fn = src.slice(src.indexOf("function shot()"));
  const end = fn.indexOf("\nfunction ", 1);
  assert.notEqual(end, -1, "shot() must be followed by another function to bound it");
  return fn.slice(0, end);
}

test("a screenshot that fails tells the operator why", () => {
  for (const [name, src] of [["captcha", captcha], ["slipway", slipway]]) {
    const body = shotBody(src);
    assert.match(body, /\.json\(\)/, `${name}: the error body must be read, not discarded`);
    assert.match(
      body,
      /Picture unavailable/,
      `${name}: the operator must see text, not an empty frame`,
    );
  }
});

/**
 * ⛔ THE ARITHMETIC, NOT THE RENDERING. Measured 2026-10-18 20:21 EDT: /shot
 * took 4.00s five times running on office Chrome (X session locked) while
 * /state answered in 61ms through the same proxy — so the cost is the
 * compositor frame. The page polled every 2200ms and, because the response is
 * no-store, each poll cost TWO captures: the probe Image, then the assignment
 * to the visible <img>. ~8s of work demanded per 2.2s on one extension socket.
 * Ben saw a broken image on his phone; the same relay had worked an hour
 * earlier on a MacBook fast enough that the arithmetic never bit.
 *
 * ⇒ A fixed poll rate against a variable capture cost is the defect. These two
 * assertions are the ones that make it impossible by construction, and neither
 * is observable from a desktop browser or a server log — exactly like the three
 * faults above.
 */
test("the page cannot outrun the capture it is polling", () => {
  for (const [name, src] of [["captcha", captcha], ["slipway", slipway]]) {
    const body = shotBody(src);
    assert.ok(
      !/new Image\(\)/.test(body),
      `${name}: a probe Image costs a SECOND capture, because /shot is no-store`,
    );
    assert.equal(
      (body.match(/fetch\('shot/g) || []).length,
      1,
      `${name}: exactly one request per shot`,
    );
    assert.match(
      body,
      /if \(shotInFlight\)/,
      `${name}: a poll landing mid-capture must not start a second one`,
    );
  }
});

/**
 * ⚠️ The page half only paces ONE viewer. A page already open from before the
 * fix, a second phone, and my own probe all still arrive independently — so the
 * bound has to exist server-side too, keyed on the session.
 */
test("concurrent callers share one capture per session", () => {
  assert.match(
    captcha,
    /export function coalesceCapture\(/,
    "the coalescing helper must stay exported — slipway imports it",
  );
  for (const [name, src] of [["captcha", captcha], ["slipway", slipway]]) {
    assert.match(
      src,
      /coalesceCapture\(s\.id, \(\) => deps\.screenshot\(s\)\)/,
      `${name}: /shot must go through the per-session coalescer`,
    );
  }
  assert.match(
    captcha,
    /shotsInFlight\.get\(key\) === p\) shotsInFlight\.delete\(key\)/,
    "a settled capture must free the slot, or one failure poisons every later poll",
  );
});

test("a hidden tab is foregrounded and retried, not reported as broken", () => {
  const dep = httpServer.slice(httpServer.indexOf("screenshot:"));
  const body = dep.slice(0, dep.indexOf("viewport:"));
  assert.match(body, /browser_switch_tab/, "the relay must be able to foreground its own tab");
  assert.match(
    body,
    /hidden\|timed out/,
    "only a hidden/timeout failure warrants stealing focus; other errors must propagate",
  );
});

/**
 * ⚠️ THE GUARD THAT MATTERS MOST HERE. Foregrounding on EVERY poll would be the
 * obvious implementation and is wrong: shots poll every ~2.2s, and reCAPTCHA
 * closes its image grid when the page loses focus, so a relay that grabs focus
 * on a timer destroys the very challenge it is relaying.
 */
test("the tab is foregrounded only on failure, never on every poll", () => {
  const dep = httpServer.slice(httpServer.indexOf("screenshot:"));
  const body = dep.slice(0, dep.indexOf("viewport:"));
  const switchAt = body.indexOf("browser_switch_tab");
  const catchAt = body.indexOf("catch");
  assert.ok(catchAt !== -1, "the capture must be wrapped so failure is distinguishable");
  assert.ok(
    switchAt > catchAt,
    "browser_switch_tab must sit inside the failure path — on the happy path it must never run",
  );
});
