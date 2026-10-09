import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── THE HOLD DURATION MUST SURVIVE THE EXTENSION BOUNDARY ───────────────────
 *
 * Fiverr serves PerimeterX, and its challenge is PRESS AND HOLD, not a click.
 * The captcha relay sends `downDelay` (the hold, in ms) down the socket, and
 * `clickRealistic()` in extension/utils/cdp.js has always honoured it.
 *
 * ⛔ IT STILL DID NOTHING, because `handleRealisticClick` destructured a FIXED
 * LIST of fields that omitted `downDelay`. The value was dropped at the handler
 * with no error: the call succeeded, the response was well-formed, the
 * `message` read "Clicked left button at (572, 216)", and the button was never
 * held. MEASURED 2026-10-09 against the live challenge — holdMs: 5000 went out,
 * the widget did not register a press.
 *
 * ⚠️ A DESTRUCTURING HANDLER IS A SILENT ALLOW-LIST. This is the same failure
 * class as zod stripping an undeclared tool argument (see
 * list-attached-tabs-extension-filter.test.js): adding the parameter on the
 * server side looks finished and ships nothing. Both ends must name the field.
 *
 * ⛔ This asserts on SOURCE because the regression is invisible from outside —
 * there is no response field, no log line and no error that distinguishes a
 * forwarded hold from a dropped one.
 */

const repoRoot = path.join(import.meta.dirname, "../..");
const bg = fs.readFileSync(path.join(repoRoot, "extension/background.js"), "utf8");
const cdp = fs.readFileSync(path.join(repoRoot, "extension/utils/cdp.js"), "utf8");

function handlerBody() {
  const start = bg.indexOf("async handleRealisticClick(");
  assert.notEqual(start, -1, "handleRealisticClick must exist");
  // Up to the next method at the same indentation.
  const rest = bg.slice(start);
  const end = rest.indexOf("\n  async ", 1);
  return end === -1 ? rest : rest.slice(0, end);
}

test("the handler accepts downDelay from the socket message", () => {
  const sig = handlerBody().split("\n")[0];
  assert.match(
    sig,
    /\bdownDelay\b/,
    "handleRealisticClick must destructure downDelay — a field it does not name is a field it drops",
  );
});

test("the handler forwards downDelay to clickRealistic", () => {
  const body = handlerBody();
  const call = body.slice(body.indexOf("clickRealistic("));
  assert.match(
    call,
    /\bdownDelay\b/,
    "downDelay must reach clickRealistic, not merely be destructured",
  );
});

test("clickRealistic still sleeps for downDelay between press and release", () => {
  const fn = cdp.slice(cdp.indexOf("async clickRealistic("));
  const press = fn.indexOf("'mousePressed'");
  const release = fn.indexOf("'mouseReleased'");
  assert.ok(press !== -1 && release !== -1 && press < release, "press must precede release");
  const between = fn.slice(press, release);
  assert.match(
    between,
    /\bdownDelay\b/,
    "the hold must be spent BETWEEN press and release — elsewhere it is decorative",
  );
});

/**
 * ⛔ `buttons` vs `button`: `button` names the button this event concerns,
 * `buttons` is the bitmask of what is currently DOWN. CDP defaults the bitmask
 * to 0, so a press dispatched without it tells the page that no button is held
 * while claiming to be a press. Ordinary click targets do not care, which is
 * exactly why it went unnoticed; a press-and-hold widget reading `e.buttons`
 * does. MEASURED 2026-10-09: a 6.0s hold reached the page (6.77s round trip)
 * and PerimeterX did not accept it.
 */
test("a press reports the button as held, and the release reports it let go", () => {
  // ⚠️ Comments are stripped first: the explanation above each field is longer
  // than the field, and a fixed-width window measured on the raw text matched
  // prose instead of code the first time this was written.
  // ⚠️ Collapse whitespace after stripping comments. Removing a comment leaves
  // its indentation behind as a blank line, so a fixed-width window measured on
  // the stripped text spans mostly spaces and misses the field it is looking
  // for — which reads as "the fix is missing" when the fix is right there.
  const code = cdp
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\s+/g, " ");
  const fn = code.slice(code.indexOf("async clickRealistic("));
  const press = fn.indexOf("'mousePressed'");
  const release = fn.indexOf("'mouseReleased'");
  assert.match(fn.slice(press, press + 200), /buttons:\s*1/, "mousePressed must carry buttons: 1");
  assert.match(fn.slice(release, release + 200), /buttons:\s*0/, "mouseReleased must carry buttons: 0");
});

test("a long hold moves, because a perfectly still one is its own signature", () => {
  const fn = cdp.slice(cdp.indexOf("async clickRealistic("));
  const press = fn.indexOf("'mousePressed'");
  const release = fn.indexOf("'mouseReleased'");
  const between = fn.slice(press, release);
  assert.match(between, /'mouseMoved'/, "a hold must emit movement while the button is down");
  assert.match(
    between.slice(between.indexOf("'mouseMoved'")),
    /buttons:\s*1/,
    "movement during a hold must still report the button as held, or it reads as a drag with nothing pressed",
  );
});

test("the server sends the relay's holdMs as downDelay", () => {
  const http = fs.readFileSync(path.join(repoRoot, "src/http-server.ts"), "utf8");
  assert.match(
    http,
    /downDelay:\s*holdMs/,
    "the captcha relay's holdMs must leave the server as downDelay, the name the extension reads",
  );
});

/**
 * ⛔ A MOUSE THAT REPORTS ZERO PRESSURE WHILE ITS BUTTON IS DOWN CANNOT EXIST.
 *
 * The Pointer Events spec: for a mouse, `pressure` is 0.5 while a button is
 * held and 0 otherwise. CDP's `Input.dispatchMouseEvent` defaults `force` to 0
 * and `force` is what becomes `pressure`, so every press this codebase sent
 * arrived as a pointerdown claiming no pressure — readable by any page with a
 * single event listener, and impossible for real hardware to produce.
 *
 * MEASURED 2026-10-09 on one page, same coordinates, a minute apart: an XTEST
 * click (a real X pointer, via xdotool on the sidecar's Xvfb display) reported
 * pressure 0.5; the CDP click reported 0. EVERY other field was identical —
 * clientX/Y, screenX/Y, buttons, isTrusted, pointerType, pointerId, width,
 * height, isPrimary, tiltX/Y, twist, movementX/Y.
 *
 * ⚠️ That last sentence is the useful half. The obvious theory — that injected
 * input is distinguishable because it bypasses the OS — was wrong: CDP and a
 * real pointer agree on everything the page can see except this one field.
 */
test("a press reports the pressure a real mouse reports", () => {
  // ⚠️ Collapse whitespace after stripping comments. Removing a comment leaves
  // its indentation behind as a blank line, so a fixed-width window measured on
  // the stripped text spans mostly spaces and misses the field it is looking
  // for — which reads as "the fix is missing" when the fix is right there.
  const code = cdp
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\s+/g, " ");
  const fn = code.slice(code.indexOf("async clickRealistic("));
  const press = fn.indexOf("'mousePressed'");
  const release = fn.indexOf("'mouseReleased'");
  assert.match(
    fn.slice(press, press + 200),
    /force:\s*0\.5/,
    "mousePressed must set force: 0.5 — pressure 0 with a button down is impossible",
  );
  assert.match(
    fn.slice(release, release + 200),
    /force:\s*0\b/,
    "mouseReleased must set force: 0",
  );
});

test("pressure stays up for the whole hold, including the jitter", () => {
  // ⚠️ Collapse whitespace after stripping comments. Removing a comment leaves
  // its indentation behind as a blank line, so a fixed-width window measured on
  // the stripped text spans mostly spaces and misses the field it is looking
  // for — which reads as "the fix is missing" when the fix is right there.
  const code = cdp
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\s+/g, " ");
  const fn = code.slice(code.indexOf("async clickRealistic("));
  const between = fn.slice(fn.indexOf("'mousePressed'"), fn.indexOf("'mouseReleased'"));
  const moved = between.slice(between.indexOf("'mouseMoved'"));
  assert.match(
    moved,
    /force:\s*0\.5/,
    "a move during a hold must keep pressure at 0.5, or it reads as a release and re-press",
  );
});
