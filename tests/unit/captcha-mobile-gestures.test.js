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

test("a screenshot that fails tells the operator why", () => {
  const fn = captcha.slice(captcha.indexOf("function shot()"));
  const body = fn.slice(0, fn.indexOf("function poll()"));
  assert.match(body, /probe\.onerror/, "a failed image load must be handled at all");
  assert.match(
    body,
    /fetch\('shot/,
    "the error body must be re-fetched — the <img> load discards it",
  );
  assert.match(
    body,
    /Picture unavailable/,
    "the operator must see text, not an empty frame",
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
