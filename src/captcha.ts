/**
 * Remote captcha solving — hand a captcha to a human's phone and block until
 * they deal with it.
 *
 * ⛔ WHY browser_request_user_action IS NOT THIS. That tool draws a notification
 * and an overlay IN THE BROWSER and waits for someone sitting at it. Every
 * browser this fleet drives is somewhere the operator is not: a headless
 * sidecar on office, a laptop across a VPN. The overlay is shown to an empty
 * room. This moves the request to the person instead of the person to the
 * request.
 *
 * SHAPE: the agent calls browser_request_captcha_solve and gets a URL back.
 * unibrowse serves a phone-sized page at that URL; an ATC artifact PROXIES it so
 * it is reachable off-LAN with no VPN. The page polls a live screenshot of the
 * tab and posts taps back, which are replayed with browser_realistic_click
 * (CDP Input, real OS-level events — a synthetic click is exactly what a
 * captcha is looking for). The agent polls browser_check_captcha_solve.
 *
 * ⛔ THE WRITE SURFACE IS EXACTLY THREE PATHS. nginx allows POST under /f/
 * only to `tap`, `text` and `done` ($-anchored, commit 2fb447c 2026-09-12),
 * and GET on those three is 403 because they are callbacks rather than files.
 * ⇒ Polling MUST stay on /state and /shot. Adding a fourth verb is an nginx
 * change and a DM to that seat, not a local edit.
 *
 * ⛔ THE ARTIFACT PAGE COULD NOT POLL US DIRECTLY. An ATC artifact is locked to
 * its own origin by CSP (`connect-src 'self'`), so a page hosted AS an artifact
 * cannot fetch unibrowse. Proxying instead puts our page under the artifact's
 * own origin, which is why the poll works at all. That is also why every URL in
 * the page below is RELATIVE — an absolute path resolves at the artifact
 * domain root and 404s.
 *
 * ⚠️ SECURITY, STATED PLAINLY. The token in the URL grants the holder the
 * ability to click inside a live, logged-in browser. That is a real capability,
 * so it is bounded on four axes:
 *   · single tab — a session names one tabTarget and cannot reach another
 *   · short TTL — default 10 minutes, then the session refuses everything
 *   · single use — 'solved' is terminal; a replayed URL does nothing
 *   · optional rect clamp — when the caller can name the widget's box, taps
 *     outside it are rejected rather than clamped, so a leaked link cannot
 *     wander the rest of an authenticated page
 * ⚠️ The rect clamp is OPT-IN and usually unavailable: reCAPTCHA's tile
 * challenge opens in an overlay outside the checkbox's rect, so clamping to the
 * widget you can see would make the puzzle unreachable. Do not assume it is on.
 */

import crypto from "crypto";
import type { Express } from "express";

export type CaptchaState = "pending" | "solved" | "expired" | "cancelled";

export interface CaptchaSession {
  id: string;
  token: string;
  extensionId?: string;
  tabTarget: number | string;
  prompt: string;
  /**
   * The ATC id of the agent or thread that asked for this captcha — the seat
   * that is blocked on it. Two things key off it, and both are Ben's ask
   * (Slack #unibrowse 2026-10-12): the human's notice is SENT AS this id so
   * the bridge posts it in that correspondent's own channel, and the same id
   * is DMed when the captcha is solved so the requester need not poll.
   * ⚠️ Null when the caller passed no `agent` — then the human is DMed as
   * before and nobody is told about the solve, because there is no address.
   */
  requester: string | null;
  state: CaptchaState;
  createdAt: number;
  expiresAt: number;
  taps: number;
  typed: number;
  lastShotAt: number | null;
  solvedAt: number | null;
  note: string | null;
  /** Optional viewport-CSS-pixel box outside which taps are refused. */
  rect: { x: number; y: number; width: number; height: number } | null;
  /**
   * Where the last relayed tap left the pointer, so the NEXT one can be moved
   * from there. ⛔ Without this the replay passes no currentX/currentY and the
   * extension's bezier starts at (0,0) on every tap — the viewport corner, on
   * every single relayed click. A path that begins at the same pixel every time
   * is a signature, which is the exact defect fixed server-side in 6057caf for
   * the realistic_* TOOLS; this path bypasses those tools and talks to the
   * socket directly, so it never got the fix.
   */
  cursor: { x: number; y: number } | null;
  /**
   * Resolves when a relayed press that is STILL BEING REPLAYED in the browser
   * finishes. ⛔ `done` MUST WAIT FOR IT. A press-and-hold is replayed only
   * after the phone releases, so for up to 20s the browser is mid-press while
   * the page is idle and the Done button is sitting there — and the human
   * presses it, because from their side the gesture is over.
   *
   * MEASURED 2026-10-12, session 0737b650: release at 21:28:55.8Z started a
   * ~6.8s hold; Ben pressed Done 2.1s later; the solve notice reached
   * `freelance` at 21:28:57.9Z and the press did not land until 21:29:02.7Z.
   * The requester resumed, read the page five seconds BEFORE the press
   * arrived, and correctly reported the challenge unsolved. Marking the
   * session solved early also replaced the page with "Thanks — sent back" and
   * stopped the screenshot poll, so Ben never saw the result of his own press
   * either: "I held it down but it still wasn't reflecting my press."
   * ⚠️ Not persisted and not in publicView — it is in-flight state, not a fact
   * about the session.
   */
  inFlight?: Promise<void> | null;
}

const sessions = new Map<string, CaptchaSession>();

/** Tokens are the credential, so they are random, not derived from the id. */
function newToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function createCaptchaSession(opts: {
  tabTarget: number | string;
  extensionId?: string;
  prompt?: string;
  ttlSeconds?: number;
  rect?: { x: number; y: number; width: number; height: number } | null;
  requester?: string | null;
}): CaptchaSession {
  const now = Date.now();
  // 10 minutes: long enough for a phone to buzz, be noticed and answered;
  // short enough that a leaked link is usually already dead.
  const ttl = Math.min(Math.max(opts.ttlSeconds ?? 600, 30), 3600);
  const s: CaptchaSession = {
    id: crypto.randomUUID(),
    token: newToken(),
    extensionId: opts.extensionId,
    tabTarget: opts.tabTarget,
    prompt: opts.prompt || "Please solve the captcha shown below.",
    state: "pending",
    createdAt: now,
    expiresAt: now + ttl * 1000,
    taps: 0,
    typed: 0,
    lastShotAt: null,
    solvedAt: null,
    note: null,
    rect: opts.rect ?? null,
    cursor: null,
    requester: opts.requester ?? null,
  };
  sessions.set(s.token, s);
  return s;
}

export function getSessionById(id: string): CaptchaSession | undefined {
  for (const s of sessions.values()) if (s.id === id) return s;
  return undefined;
}

/**
 * ⚠️ Expiry is evaluated on READ, not by a timer. A timer would have to be
 * cancelled on every terminal transition and leaks a handle per session if it
 * is not; reading the clock cannot drift out of sync with the state.
 */
export function resolveSession(token: string): CaptchaSession | undefined {
  const s = sessions.get(token);
  if (!s) return undefined;
  if (s.state === "pending" && Date.now() > s.expiresAt) s.state = "expired";
  return s;
}

/** Drop sessions that ended long enough ago that nobody is still polling. */
export function sweepCaptchaSessions(maxAgeMs = 3600_000): number {
  const cutoff = Date.now() - maxAgeMs;
  let n = 0;
  for (const [token, s] of sessions) {
    if (s.createdAt < cutoff) {
      sessions.delete(token);
      n++;
    }
  }
  return n;
}

export function listCaptchaSessions(): CaptchaSession[] {
  return [...sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Runs IN THE TAB and returns normalised rects of everything a keyboard can type
 * into. ⛔ Plain ES5 and a flat array: this string crosses the socket to the
 * extension's MAIN-world relay, and anything fancier has mangled before.
 *
 * Excludes the controls a keyboard is useless on (checkbox/radio/button/submit),
 * anything hidden, disabled or readonly, anything smaller than a few px, and
 * anything scrolled out of view — a rect the operator cannot see is a rect that
 * would open the keyboard on a tap that hit something else.
 */
export const FIELD_RECTS_JS = String.raw`(function(){
  if (!document.body) return [];
  var sel = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio])'
    + ':not([type=button]):not([type=submit]):not([type=reset]):not([type=file])'
    + ',textarea,[contenteditable=""],[contenteditable="true"]';
  var W = window.innerWidth || 1, H = window.innerHeight || 1;
  var n = document.querySelectorAll(sel), out = [];
  for (var i = 0; i < n.length && out.length < 40; i++) {
    var e = n[i];
    if (e.disabled || e.readOnly) continue;
    var r = e.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue;
    var st = window.getComputedStyle(e);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue;
    out.push({ fx: r.left / W, fy: r.top / H, fw: r.width / W, fh: r.height / H });
  }
  return out;
})()`;

/**
 * The editing keys the page may send. ⛔ An allowlist, not free text: this is a
 * public-token endpoint, and "type whatever you name" is a different and much
 * larger capability than "correct what you just typed".
 */
/**
 * ⛔ FULL REPLACE, NOT A DIFF. The phone box and the field in the tab are two
 * strings, and the first attempt at this streamed only the EDITS — appended
 * characters as text, deletions as Backspace. Measured failure, Ben on his
 * phone 2026-10-18 13:03 (#apis): the field read "vvsNSTRMXansnstRmx" — every
 * attempt appended to the last, and Backspace deleted nothing. Setting the
 * whole value makes delete, paste and a mid-string edit all work by
 * construction, because the page is the only source of truth.
 * ⚠️ Goes through the native value setter, so a React/Vue controlled input sees
 * the change; a bare `.value =` is swallowed by the framework's own setter.
 */
export function focusedSetJs(text: string): string {
  return `(function(){
    var v = ${JSON.stringify(text)};
    var e = document.activeElement;
    if (!e || e === document.body) return 'NO_FOCUS';
    var tag = (e.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      if (e.disabled || e.readOnly) return 'NOT_EDITABLE:readonly';
      try {
        var proto = tag === 'input' ? window.HTMLInputElement.prototype
                                    : window.HTMLTextAreaElement.prototype;
        var d = Object.getOwnPropertyDescriptor(proto, 'value');
        if (d && d.set) d.set.call(e, v); else e.value = v;
      } catch (err) { e.value = v; }
      try { e.setSelectionRange(v.length, v.length); } catch (err) {}
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
      return 'OK';
    }
    if (e.isContentEditable) {
      e.textContent = v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      return 'OK';
    }
    return 'NOT_EDITABLE:' + tag;
  })()`;
}

const KB_KEYS: Record<string, true> = {
  Backspace: true, Delete: true, Enter: true, Tab: true,
  ArrowLeft: true, ArrowRight: true, Home: true, End: true,
};

function publicView(s: CaptchaSession) {
  return {
    id: s.id,
    state: s.state,
    prompt: s.prompt,
    tabTarget: s.tabTarget,
    taps: s.taps,
    typed: s.typed,
    createdAt: new Date(s.createdAt).toISOString(),
    expiresAt: new Date(s.expiresAt).toISOString(),
    solvedAt: s.solvedAt ? new Date(s.solvedAt).toISOString() : null,
    secondsRemaining: Math.max(0, Math.round((s.expiresAt - Date.now()) / 1000)),
    note: s.note,
  };
}

const PAGE = String.raw`<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Solve captcha</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin:0; background:#14161a; color:#e8eaed;
         font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  header { padding:12px 14px; background:#1d2026; border-bottom:1px solid #2b2f37;
           position:sticky; top:0; z-index:2; }
  h1 { margin:0 0 3px; font-size:15px; font-weight:600; }
  .sub { font-size:12.5px; color:#9aa0aa; }
  #wrap { position:relative; padding:10px; }
  /* ⛔ ALL FOUR OF THESE ARE LOAD-BEARING ON MOBILE, and the one they fix is
     press-and-hold. MEASURED 2026-10-09, Ben on Android Chrome: holding the
     button opened the BROWSER's long-press context menu ("open image in new
     tab / save image"), which both hid the page and cancelled the gesture.
     ⛔ DO NOT PUT BACKTICKS IN THIS BLOCK — PAGE is a String.raw template and a
     backtick ends it, which breaks the build rather than the page.
     Calling preventDefault() on pointerdown does NOT stop the menu: it is
     raised off the touch sequence, not off the pointer event.
       touch-action:none        — stop the press being claimed as a scroll/pan,
                                  which fires pointercancel and ends the hold
       -webkit-touch-callout    — the iOS/Android image callout menu
       user-select              — the text/image selection that a long press
                                  starts, which also steals the sequence
     ⚠️ Removing any one of them reintroduces a failure that only appears on a
     real phone — a desktop browser holds the button quite happily. */
  #shot { width:100%; display:block; border-radius:8px; border:1px solid #2b2f37;
          touch-action:none; -webkit-touch-callout:none;
          -webkit-user-select:none; user-select:none; }
  #dot { position:absolute; width:26px; height:26px; margin:-13px 0 0 -13px;
         border:2px solid #4ade80; border-radius:50%; pointer-events:none;
         opacity:0; transition:opacity .45s; }
  .bar { display:flex; gap:8px; padding:0 10px 12px; }
  button { flex:1; padding:13px; font-size:14px; font-weight:600; border:0;
           border-radius:8px; background:#2b2f37; color:#e8eaed; }
  button.go { background:#2563eb; color:#fff; }
  button:disabled { opacity:.45; }
  input { width:100%; padding:12px; font-size:16px; border-radius:8px;
          border:1px solid #2b2f37; background:#1d2026; color:#e8eaed; }
  .row { padding:0 10px 10px; }
  #status { padding:10px 14px; font-size:13px; color:#9aa0aa; }
  .done { text-align:center; padding:48px 20px; }
  .done h2 { font-size:20px; margin:0 0 8px; }
  .hint { font-size:12px; color:#6b7280; padding:0 14px 14px; }
</style>
</head><body>
<div id="app">
  <header>
    <h1 id="prompt">Loading…</h1>
    <div class="sub"><span id="left"></span></div>
  </header>
  <div id="live">
    <div id="wrap"><img id="shot" alt="page"><div id="dot"></div></div>
    <div class="row"><input id="txt" placeholder="Tap a box in the picture, then type here" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text" enterkeyhint="go"></div>
    <div class="bar">
      <button id="up">▲ Scroll up</button>
      <button id="down">▼ Scroll down</button>
    </div>
    <div class="bar">
      <button id="clear">Clear</button>
      <button id="send">Send text</button>
      <button id="done" class="go">Done</button>
    </div>
    <div id="status">Tap the image where you would tap the page. Tap a text box and your keyboard opens — then what you type, delete or paste here goes straight into that field.</div>
    <div class="hint">Taps become real clicks in the browser. The picture refreshes every couple of seconds. The picture is only what fits on screen — scroll if the button you need is further down the page.</div>
  </div>
</div>
<script>
// ⛔ RELATIVE URLS ONLY. This page is served through an ATC artifact proxy that
// mounts it at /f/<id>/, so an absolute path would resolve at the artifact
// domain root and 404. A <base> tag is injected by the proxy for exactly this.
var busy = false, stopped = false, shotFailed = false, shotInFlight = false, shotAgain = false;

// ⛔ A FAILED SHOT MUST SAY SO. It used to fail silently: /shot answers with a
// JSON error body on failure, an <img> cannot render JSON, and the old code had
// only an onload handler — so the operator got a blank frame, no text, and no
// way to tell "broken" from "still loading". MEASURED 2026-10-09: Ben, sent
// three captchas at once, reported the third as "doesn't even explain anything,
// it's broken". It was: its tab was backgrounded, Page.captureScreenshot never
// produced a frame, and the relay had no way to tell him that.
//
// ⛔⛔ ONE REQUEST PER SHOT, AND ONE SHOT IN FLIGHT. The fix above polled with a
// probe Image and then assigned the loaded URL to the visible <img>. The
// response carries Cache-Control: no-store, so that assignment is a SECOND
// full request — TWO compositor captures per poll — and only the second one's
// failure is visible, as a broken icon with no text, which is the very symptom
// the probe was added to prevent.
//
// MEASURED 2026-10-18 20:21 EDT on session 9b5fe6d1, office Chrome
// (ext_018237f9, X session locked, window at 3840,1080): /state answered in
// 61ms through the same proxy and /shot in 4.00s, five times running — so the
// cost is the compositor frame, not the network. This page asked for a new one
// every 2200ms, i.e. ~8s of capture demanded per 2.2s on ONE extension socket.
// The queue could only grow, and Ben (Slack #business-connect 20:20) saw it as
// a broken image on his phone while the SAME relay had worked an hour earlier
// on the MacBook, whose captures are fast enough that the arithmetic never
// bites. ⇒ The old code was never wrong about fast browsers and never right
// about slow ones; a fixed poll rate against a variable capture cost is the
// defect, so the page now paces itself off the server instead of off a clock.
function shot() {
  if (stopped) return;
  // A poll that lands mid-capture asks for ONE more frame afterwards rather
  // than joining a queue: the operator wants the latest frame, not every frame.
  if (shotInFlight) { shotAgain = true; return; }
  shotInFlight = true; shotAgain = false;
  var img = document.getElementById('shot');
  fetch('shot?t=' + Date.now())
    .then(function (r) {
      if (r.ok) return r.blob();
      // The body is the explanation. Read it here — there is no second request
      // to read it from any more.
      return r.json().then(
        function (j) { throw new Error((j && j.error) || ('HTTP ' + r.status)); },
        function () { throw new Error('HTTP ' + r.status); }
      );
    })
    .then(function (b) {
      // Render the bytes we already hold. An object URL would be cheaper, but a
      // data: URL also survives this page being served behind a CSP that allows
      // data: and not blob:, and 30KB of base64 is not worth the exposure.
      return new Promise(function (ok, no) {
        var fr = new FileReader();
        fr.onload = function () { ok(fr.result); };
        fr.onerror = function () { no(new Error('the picture could not be decoded')); };
        fr.readAsDataURL(b);
      });
    })
    .then(function (url) {
      img.src = url;
      if (shotFailed) { shotFailed = false; document.getElementById('status').textContent = ''; }
    })
    .catch(function (err) {
      shotFailed = true;
      document.getElementById('status').textContent =
        'Picture unavailable: ' + ((err && err.message) || 'unknown') +
        ' — the page is still there, this is the screenshot failing.';
    })
    .then(function () {
      shotInFlight = false;
      if (shotAgain && !stopped) { shotAgain = false; setTimeout(shot, 0); }
    });
}

function poll() {
  fetch('state').then(function (r) { return r.json(); }).then(function (s) {
    document.getElementById('prompt').textContent = s.prompt;
    document.getElementById('left').textContent =
      s.state === 'pending' ? (s.secondsRemaining + 's left · ' + s.taps + ' taps sent') : s.state;
    if (s.state !== 'pending') {
      stopped = true;
      document.getElementById('app').innerHTML =
        '<div class="done"><h2>' +
        (s.state === 'solved' ? 'Thanks — sent back' : s.state === 'expired' ? 'This link has expired' : 'Cancelled') +
        '</h2><div class="sub">You can close this page.</div></div>';
    }
  }).catch(function () {});
}

// PRESS-AND-HOLD: the duration is MEASURED from the operator's own gesture
// rather than offered as a preset, because the challenge scores how long the
// button was held and a menu of durations would just be guessing on their
// behalf. pointerdown/pointerup covers mouse, touch and pen in one listener.
//
// ⛔ The press POSITION is taken from pointerDOWN, not pointerup. On a touch
// screen a finger drifts during a multi-second hold, and releasing somewhere
// else must not relocate the click.
var holdStart = null, holdFx = 0, holdFy = 0, holdTimer = null;

// ⭐ WHY THE PAGE KNOWS WHERE THE TEXT BOXES ARE. A phone raises its native
// keyboard only when .focus() happens INSIDE the touch gesture. Focusing after
// the tap's fetch resolves is already too late — the keyboard simply never
// appears, which is the "clanky thing" Ben reported (#apis 2026-10-18 12:32).
// So the rects come down with /state and the decision is made synchronously in
// pointerdown, before anything is sent.
var fields = [], liveKb = false, kbChain = Promise.resolve(), kbTimer = null;

function loadFields() {
  return fetch('state?fields=1').then(function (r) { return r.json(); })
    .then(function (s) { fields = (s && s.fields) || []; })
    .catch(function () { /* ⛔ fail to NO fields: the Send box still works */ });
}

function hitField(fx, fy) {
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (fx >= f.fx && fx <= f.fx + f.fw && fy >= f.fy && fy <= f.fy + f.fh) return true;
  }
  return false;
}

// ⛔ SERIALISED. Each keystroke is its own request and they must land in the
// order they were typed; two parallel fetches would race and spell the captcha
// wrong, which on an image captcha is indistinguishable from misreading it.
function sendKb(body) {
  kbChain = kbChain.then(function () {
    return fetch('text', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
  });
  return kbChain;
}

function holdLabel() {
  if (holdStart === null) return;
  var secs = ((Date.now() - holdStart) / 1000).toFixed(1);
  document.getElementById('status').textContent = 'Holding ' + secs + 's — release to send.';
}

document.addEventListener('pointerdown', function (e) {
  if (e.target.id !== 'shot' || busy || stopped) return;
  var img = e.target, r = img.getBoundingClientRect();
  // Normalised 0..1 so the server does the scaling — it is the only side that
  // knows the tab's CSS viewport, and the image may be at any device ratio.
  holdFx = (e.clientX - r.left) / r.width;
  holdFy = (e.clientY - r.top) / r.height;
  holdStart = Date.now();
  // ⛔ THIS .focus() MUST STAY IN THE POINTERDOWN HANDLER. It is the whole
  // mechanism: inside the gesture the phone opens its keyboard, one tick later
  // it does not. Do not move it into the tap response.
  liveKb = hitField(holdFx, holdFy);
  if (liveKb) {
    var box = document.getElementById('txt');
    box.value = '';
    box.focus();
  }
  var dot = document.getElementById('dot');
  dot.style.left = (e.clientX - r.left + 10) + 'px';
  dot.style.top = (e.clientY - r.top + 10) + 'px';
  dot.style.opacity = 1;
  holdTimer = setInterval(holdLabel, 100);
  // Stop the browser turning a long press into a text selection or a drag,
  // which on mobile cancels the pointer sequence and loses the release.
  e.preventDefault();
});

function endHold(e) {
  if (holdStart === null) return;
  var held = Date.now() - holdStart;
  holdStart = null;
  if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
  if (busy || stopped) { document.getElementById('dot').style.opacity = 0; return; }
  busy = true;
  // Greyed as well as refused: the button that must not be pressed should not
  // look pressable for the seconds the browser is mid-press.
  document.getElementById('done').disabled = true;
  // Anything under ~250ms is an ordinary tap; send it without a hold so the
  // extension keeps its own randomised 50-100ms down-delay, which is more
  // human than a measured 180ms replayed exactly.
  var body = { fx: holdFx, fy: holdFy };
  if (held >= 250) body.holdMs = Math.min(held, 20000);

  // ⛔ THE HOLD IS REPLAYED AFTER THE RELEASE, SO THE PAGE MUST SAY SO WHILE IT
  // RUNS. The browser presses for the full duration only once the phone lets
  // go, and for those seconds the busy flag suppresses the screenshot poll — so
  // the picture froze, the status still read "release to send", and a hold that was
  // working looked like a press that never landed. MEASURED 2026-10-12 on
  // session dc65861e: Ben pressed, got no feedback, and reported through
  // the freelance seat (#freelance 17:18) that "his press never registers" — while
  // the 16s hold he had just sent was in flight and went on to CLEAR the challenge.
  // ⭐ The ring stays lit for the same reason: it is the only thing on screen
  // that marks where the browser's finger currently is.
  var holdEnds = body.holdMs ? Date.now() + body.holdMs : 0;
  var replayTimer = null;
  function replayLabel() {
    var left = Math.max(0, holdEnds - Date.now()) / 1000;
    document.getElementById('status').textContent = left > 0.05
      ? ('Holding in the browser — ' + left.toFixed(1) + 's to go. The picture updates when it finishes.')
      : 'Hold finished — fetching the page.';
  }
  if (holdEnds) { replayLabel(); replayTimer = setInterval(replayLabel, 100); }

  fetch('tap', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify(body) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      // ⛔ A SHORT TAP ON A PRESS-AND-HOLD CHALLENGE IS A FAILURE THAT REPORTS
      // SUCCESS. "Tap sent." is true and useless: the widget scores duration,
      // so a 180ms tap does nothing at all and the operator has no reason to
      // suspect the gesture rather than the relay. Ben's first press on
      // dc65861e was exactly this (measured <250ms, 2026-10-12), and his
      // conclusion was that the page was broken. The prompt is the only thing
      // that knows which kind of challenge this is, so read it.
      var wantsHold = /\bhold\b/i.test(document.getElementById('prompt').textContent || '');
      document.getElementById('status').textContent = j.ok
        ? (j.holdMs
            ? ('Held ' + (j.holdMs / 1000).toFixed(1) + 's — sent. Watch the picture; press again if it did not complete.')
            : (wantsHold
                ? 'That was a quick tap, and this challenge needs a press and HOLD — press the button and keep holding for several seconds.'
                : 'Tap sent.'))
        : ('Refused: ' + (j.error || 'unknown'));
    })
    .catch(function () { document.getElementById('status').textContent = 'Tap failed to send.'; })
    .then(function () {
      if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
      document.getElementById('dot').style.opacity = 0;
      document.getElementById('done').disabled = false;
      busy = false; setTimeout(shot, 600);
      // The tap may have opened a form, dismissed an overlay or moved things,
      // so the rects from before it are stale.
      loadFields();
    });
}

// ⛔ The CSS above stops the long-press menu on every mobile browser that
// honours -webkit-touch-callout. This catches the rest, and costs nothing: the
// operator has no use for a context menu on a screenshot they are tapping
// through. Same for the drag, which on desktop would otherwise start an image
// drag halfway through a hold and lose the release.
document.addEventListener('contextmenu', function (e) {
  if (e.target.id === 'shot') e.preventDefault();
});
document.addEventListener('dragstart', function (e) {
  if (e.target.id === 'shot') e.preventDefault();
});

document.addEventListener('pointerup', endHold);
// ⛔ A hold that ends by the pointer being cancelled or leaving the window must
// still SEND. Otherwise the operator holds for five seconds, lifts off the edge
// of the image, and nothing happens with no error — the failure this relay
// exists to avoid.
document.addEventListener('pointercancel', endHold);
window.addEventListener('blur', endHold);

// ⭐ THE BOX IS THE SOURCE OF TRUTH. Every change sends the WHOLE value and the
// field in the tab is set to it, so delete, paste and editing the middle all
// work. ⛔ DO NOT GO BACK TO STREAMING EDITS: that was the first version and it
// appended every attempt onto the last while Backspace deleted nothing
// (measured, Ben's phone 2026-10-18 13:03 — the field read
// "vvsNSTRMXansnstRmx").
// Debounced, because an IME fires input per keystroke and the field only has to
// agree with the box once the typing pauses.
document.getElementById('txt').addEventListener('input', function () {
  if (!liveKb) return;
  var v = this.value;
  if (kbTimer) clearTimeout(kbTimer);
  kbTimer = setTimeout(function () {
    kbTimer = null;
    sendKb({ value: v }).then(function (r) {
      if (r && r.verdict && r.verdict !== 'OK') {
        document.getElementById('status').textContent =
          'The page lost the text box — tap it in the picture again, then type.';
      }
      setTimeout(shot, 300);
    });
  }, 140);
});

// Enter submits the form in the TAB, which is what a captcha box usually wants.
document.getElementById('txt').addEventListener('keydown', function (e) {
  if (!liveKb || e.key !== 'Enter') return;
  e.preventDefault();
  // Flush first: a debounced value still waiting would land AFTER the Enter and
  // submit the previous string. sendKb is serialised, so order is kept.
  if (kbTimer) { clearTimeout(kbTimer); kbTimer = null; sendKb({ value: this.value }); }
  sendKb({ key: 'Enter' }).then(function () { setTimeout(shot, 500); });
});

document.getElementById('send').onclick = function () {
  var el = document.getElementById('txt');
  var v = el.value;
  if (!v) return;
  // In live mode this is a flush, not a second send: the write REPLACES the
  // field, so pressing it after a pause cannot double the answer.
  if (liveKb) {
    if (kbTimer) { clearTimeout(kbTimer); kbTimer = null; }
    sendKb({ value: v }).then(function (r) {
      document.getElementById('status').textContent =
        (r && r.verdict === 'OK') ? 'Field set to what you typed.'
                                  : 'Tap the text box in the picture, then press Send text again.';
      setTimeout(shot, 400);
    });
    return;
  }
  fetch('text', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: v }) })
    .then(function () { el.value = '';
                        document.getElementById('status').textContent = 'Text sent.'; setTimeout(shot, 600); });
};

// ⭐ SCROLL, because the picture is only the viewport. A submit button below
// the fold is not in the image at all, and before this there was nothing the
// operator could do about it.
// ⛔ RELOAD THE RECTS AFTER SCROLLING — they are viewport-relative, so every
// one of them is wrong the moment the page moves, and a stale rect means a tap
// on empty space opens the keyboard (or a tap on a field does not).
function scrollBy(y) {
  var st = document.getElementById('status');
  st.textContent = 'Scrolling…';
  kbChain = kbChain.then(function () {
    return fetch('text', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({ scroll: y }) })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
  });
  kbChain.then(function (j) {
    st.textContent = (j && j.ok) ? 'Scrolled. Tap where you want to press.'
                                 : ('Could not scroll: ' + ((j && j.error) || 'no answer'));
    liveKb = false;
    setTimeout(function () { shot(); loadFields(); }, 250);
  });
}
document.getElementById('up').onclick = function () { scrollBy(-400); };
document.getElementById('down').onclick = function () { scrollBy(400); };

// ⭐ CLEAR EMPTIES THE FIELD IN THE TAB, not just this box. Ben, #apis
// 2026-10-18: "there's no ability for me to delete".
document.getElementById('clear').onclick = function () {
  var el = document.getElementById('txt');
  el.value = '';
  var st = document.getElementById('status');
  if (!liveKb) { st.textContent = 'Box cleared. Tap a text box in the picture to clear that field.'; return; }
  if (kbTimer) { clearTimeout(kbTimer); kbTimer = null; }
  sendKb({ value: '' }).then(function (r) {
    st.textContent = (r && r.verdict === 'OK') ? 'Field cleared.'
                                               : 'Tap the text box in the picture again, then Clear.';
    setTimeout(shot, 300);
  });
};

document.getElementById('done').onclick = function () {
  // ⛔ DO NOT LET THE HUMAN END THE SESSION MID-PRESS. From their side the
  // gesture finished when they lifted their finger; in the browser it is only
  // starting, and Done would tell the waiting agent the captcha is dealt with
  // before the press lands. Measured on session 0737b650 — see the inFlight
  // field in src/captcha.ts. The server also waits: a stale page is still out
  // there in somebody's phone and the two defences fail differently.
  if (busy) {
    document.getElementById('status').textContent =
      'Your press is still being replayed in the browser — wait for it to finish, then press Done.';
    return;
  }
  fetch('done', { method: 'POST' }).then(poll);
};

shot(); poll(); loadFields();
setInterval(function () { if (!busy) shot(); }, 2200);
setInterval(poll, 2000);
</script>
</body></html>`;

/**
 * Mount the solver routes.
 *
 * ⛔ These are deliberately NOT behind requireApiKey. The 128-bit token in the
 * path IS the credential — the same model as an ATC artifact URL, which the
 * operator has already accepted for pages that carry far more than a captcha.
 * Adding a key would break the only thing that makes this work: a phone opening
 * a link with no LAN access and no login.
 */
/**
 * ⛔ ONE CAPTURE PER SESSION AT A TIME, AND IT CANNOT HANG FOREVER.
 *
 * Every /shot used to call `deps.screenshot` directly, so N callers meant N
 * concurrent compositor captures on a SINGLE extension socket — and a relay
 * page polls, so N grows on its own whenever a capture is slower than the poll
 * interval. MEASURED 2026-10-18: 4.0s per capture on office Chrome with its X
 * session locked, against a 2200ms poll. The page half of this fix paces one
 * viewer; this half bounds every viewer, every stale page still open from
 * before the fix, and my own probes, to one capture in flight per session.
 *
 * Callers arriving mid-capture share its result. They get a frame at most one
 * capture old, which is what a poller wanted, and the extension sees one
 * request instead of N.
 *
 * ⚠️ The timeout is NOT the extension's — CDP fails its own capture at 10s with
 * a message worth reading, and that message still reaches the operator. This
 * one catches the case where the socket never answers at all, so a dead
 * capture cannot hold the shared slot until nginx gives up on everyone.
 */
const SHOT_TIMEOUT_MS = 20_000;
const shotsInFlight = new Map<string, Promise<string>>();

export function coalesceCapture(key: string, take: () => Promise<string>): Promise<string> {
  const running = shotsInFlight.get(key);
  if (running) return running;
  const p = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`capture did not answer within ${SHOT_TIMEOUT_MS / 1000}s`)),
      SHOT_TIMEOUT_MS,
    );
    take().then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
  shotsInFlight.set(key, p);
  // ⛔ Settled means free, whether it resolved or threw. A rejected promise left
  // in the map would make every later poll fail with the SAME stale error.
  p.catch(() => {}).then(() => { if (shotsInFlight.get(key) === p) shotsInFlight.delete(key); });
  return p;
}

export function registerCaptchaRoutes(
  app: Express,
  deps: {
    screenshot: (s: CaptchaSession) => Promise<string>;
    viewport: (s: CaptchaSession) => Promise<{ width: number; height: number }>;
    click: (s: CaptchaSession, x: number, y: number, holdMs?: number) => Promise<void>;
    /**
     * Make the tab's WINDOW the focused one before a press is replayed, and
     * report whether it already was.
     *
     * ⭐ WINDOW FOCUS IS THE ONE THING THAT SEPARATED A HOLD THAT CLEARED
     * PERIMETERX FROM THREE THAT DID NOT. 2026-10-12 on tab 41944444: a ~16s
     * hold cleared the challenge at 21:18, and three holds of 12.98s, 1.23s and
     * 11.23s delivered to the right coordinates at 21:35 did not. Reading
     * hasFocus() minutes after each gave true and false respectively.
     * ⛔ THAT PAIR OF READS IS NOT EVIDENCE ABOUT EITHER PRESS — neither was
     * taken at the moment of a press, and this comment claimed otherwise until
     * it was re-checked. What IS evidence: at 21:44 this code logged
     * windowWasFocused=false, raised the window, and the challenge cleared on
     * that single tap.
     * ⚠️ The tab was `active` in its own window throughout — chrome.tabs said
     * active:true — because `active` is per-window and says nothing about
     * whether that window is the focused one. Nothing upstream of hasFocus()
     * can see this, which is why it went unnoticed for an hour.
     * ⚠️ An unfocused, occluded window also throttles requestAnimationFrame,
     * and a press-and-hold widget's progress runs on rAF. Both the scoring and
     * the animation are therefore suspect, and this costs one call to rule out.
     * ⛔ THIS IS NOT A CORRELATION I HAVE PROVEN CAUSAL — n=1 either way, and
     * PerimeterX's reasons are not observable. It makes the browser's state
     * match the state it was in when a hold DID pass, which is the most we can
     * say.
     * ⚠️ It raises a window on the operator's own desktop, which is visible to
     * whoever is sitting there. That is the cost, and it is why it happens on a
     * press rather than on every screenshot poll.
     */
    focusTab?: (s: CaptchaSession) => Promise<{ wasFocused: boolean } | void>;
    type: (s: CaptchaSession, text: string) => Promise<void>;
    /**
     * Normalised rects of the tab's own editable fields, so the PAGE can tell —
     * before it sends anything — whether a tap is landing on a text box.
     *
     * ⭐ THIS EXISTS BECAUSE OF A MOBILE RULE, NOT FOR TIDINESS. A phone opens
     * its native keyboard only when .focus() runs INSIDE a user gesture. A tap
     * handler that waited for the tap response before focusing would be past
     * the gesture, and the keyboard would never appear — so the page has to
     * already know. Asked for by Ben, Slack #apis 2026-10-18 12:32: "when I
     * click something that is now a tax input or whatever my phone's keyboard
     * should come up it shouldn't be this clanky thing where I have to type in
     * an answer".
     * ⚠️ Optional, and an empty list is the safe answer: no rects means no
     * keyboard and the operator still has the Send text box. It must never
     * refuse a tap.
     */
    fields?: (s: CaptchaSession) => Promise<Array<{ fx: number; fy: number; fw: number; fh: number }>>;
    /**
     * One editing key, for the keys a text box needs that typing cannot express
     * — Backspace above all. ⚠️ Optional: without it the page still types,
     * it just cannot correct, and the route says so rather than silently
     * dropping the keystroke.
     */
    pressKey?: (s: CaptchaSession, key: string) => Promise<void>;
    /**
     * Set the focused field's whole value. Returns the probe's verdict so the
     * page can say "tap the box again" instead of silently losing the text —
     * `OK`, `NO_FOCUS`, or `NOT_EDITABLE:<tag>`.
     * ⚠️ Optional: without it the route answers 501 and the page falls back to
     * the Send box, which is the pre-2026-10-18 behaviour.
     */
    setValue?: (s: CaptchaSession, text: string) => Promise<string>;
    /**
     * Scroll the tab by a pixel delta.
     *
     * ⛔ WITHOUT THIS THE RELAY CANNOT REACH ANYTHING BELOW THE FOLD, and the
     * failure is silent: the screenshot is the viewport, so a submit button
     * further down the form is not in the picture and there is nothing to tap.
     * Suspected on the BLS registration form 2026-10-18 — two sessions ended
     * `solved` with the code typed into the field and the form NEVER SUBMITTED
     * (`apis`, taps=4 typed=15). ⚠️ Suspected, not proven: the tab was reserved
     * to another seat and I did not take it over to measure the geometry.
     * ⚠️ Scrolling invalidates every field rect, so the page reloads them after.
     */
    scroll?: (s: CaptchaSession, y: number) => Promise<void>;
    /**
     * Called once when the human presses Done, so the blocked requester is
     * TOLD rather than having to poll for it (Ben, Slack #unibrowse
     * 2026-10-12).
     *
     * ⛔ FIRE AND FORGET, AND IT MUST NOT BE AWAITED BY THE ROUTE. The phone is
     * waiting on this response to show "Thanks — sent back"; a slow or hanging
     * broker would leave the operator looking at a button that did nothing,
     * having already solved the captcha. The DM failing is recoverable — the
     * agent's own poll still sees `solved` — so it is never worth blocking the
     * one actor who cannot retry.
     */
    onSolved?: (s: CaptchaSession) => void;
  },
) {
  function live(req: any, res: any): CaptchaSession | null {
    const s = resolveSession(String(req.params.token || ""));
    if (!s) {
      res.status(404).json({ error: "no such captcha session" });
      return null;
    }
    if (s.state !== "pending") {
      res.status(410).json({ error: `session is ${s.state}`, state: s.state });
      return null;
    }
    return s;
  }

  // ⛔ SERVE THE PAGE AT index.html TOO — THE PUBLISHED LINK ENDS THERE.
  // atc-files returns `url_public` as `https://atc.sack.io/f/<id>/index.html`,
  // and the proxy maps that path straight through to us. Serving only the
  // directory means the exact URL we DM to a human 404s while every other
  // endpoint works — measured 2026-09-12: `/` 200, `/index.html` 404, `/shot`
  // 200. The person gets a dead link and the agent sees a healthy session.
  const servePage = (req: any, res: any) => {
    const s = resolveSession(String(req.params.token || ""));
    if (!s) return res.status(404).type("html").send("<h1>No such captcha session</h1>");
    res.type("html").send(PAGE);
  };
  app.get("/captcha/:token/", servePage);
  app.get("/captcha/:token/index.html", servePage);
  // Same page without the trailing slash, so a pasted link works either way.
  app.get("/captcha/:token", (req: any, res: any) => res.redirect(`/captcha/${req.params.token}/`));

  // ⭐ `?fields=1` RIDES /state RATHER THAN ADDING A PATH. nginx proxies this
  // mount's GETs, and /state and /shot are the two that are PROVEN to reach us
  // through it; a brand-new path name is exactly the thing that would work on
  // the LAN and 404 on the phone. Same reasoning that put holdMs on `tap`.
  // ⚠️ OPT-IN PER REQUEST because it costs a round trip into the tab: the 2s
  // status poll asks without it, and only a page load or a tap asks with it.
  app.get("/captcha/:token/state", async (req: any, res: any) => {
    const s = resolveSession(String(req.params.token || ""));
    if (!s) return res.status(404).json({ error: "no such captcha session" });
    const view: any = publicView(s);
    if (req.query?.fields !== undefined && s.state === "pending" && deps.fields) {
      // ⛔ A FAILED PROBE MUST NOT FAIL THE POLL. The page needs `state` to
      // show the countdown and to notice `solved`; losing that because a
      // field scan threw would break the whole screen over a nicety.
      try {
        view.fields = await deps.fields(s);
      } catch (err: any) {
        view.fields = [];
        view.fieldsError = String(err?.message ?? err);
      }
    }
    res.json(view);
  });

  app.get("/captcha/:token/shot", async (req: any, res: any) => {
    const s = live(req, res);
    if (!s) return;
    try {
      const b64 = await coalesceCapture(s.id, () => deps.screenshot(s));
      s.lastShotAt = Date.now();
      const buf = Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ""), "base64");
      res.setHeader("Cache-Control", "no-store");
      res.type("png").send(buf);
    } catch (err: any) {
      res.status(502).json({ error: `screenshot failed: ${err.message}` });
    }
  });

  app.post("/captcha/:token/tap", async (req: any, res: any) => {
    const s = live(req, res);
    if (!s) return;
    const fx = Number(req.body?.fx), fy = Number(req.body?.fy);
    if (!Number.isFinite(fx) || !Number.isFinite(fy) || fx < 0 || fx > 1 || fy < 0 || fy > 1) {
      return res.status(400).json({ ok: false, error: "fx/fy must be 0..1" });
    }
    try {
      const vp = await deps.viewport(s);
      const x = Math.round(fx * vp.width), y = Math.round(fy * vp.height);
      // ⛔ REFUSE outside the rect rather than clamping. Clamping would silently
      // move the operator's tap to the widget's edge and click something they
      // did not aim at — a wrong click that looks like it worked.
      if (s.rect) {
        const r = s.rect;
        if (x < r.x || x > r.x + r.width || y < r.y || y > r.y + r.height) {
          return res.status(403).json({ ok: false, error: "tap outside the captcha area" });
        }
      }
      // PRESS-AND-HOLD. Ben, Slack #unibrowse 2026-10-08, approving it for the
      // PerimeterX "press & hold" challenge that a discrete click cannot pass.
      //
      // ⭐ CARRIED ON THE EXISTING `tap` BODY, NOT A NEW `hold` PATH, and that
      // is deliberate: the public write surface is exactly three $-anchored
      // paths (POST /f/up-<32hex>/{tap,text,done}) granted by the `nginx` seat.
      // A fourth verb is their change and another round trip; a field is ours.
      //
      // ⛔ REFUSE an out-of-range hold rather than clamping it, for the same
      // reason the rect refuses rather than clamping: a silently shortened hold
      // looks like a hold that did not work, and the operator retries a thing
      // that was never sent as asked.
      const rawHold = req.body?.holdMs;
      let holdMs: number | undefined;
      if (rawHold !== undefined && rawHold !== null) {
        const h = Number(rawHold);
        if (!Number.isFinite(h) || h < 0 || h > 20000) {
          return res.status(400).json({ ok: false, error: "holdMs must be 0..20000" });
        }
        holdMs = Math.round(h);
      }
      // ⛔ LOG WHAT WAS ACTUALLY SENT. Nothing did until 2026-10-12, and when
      // Ben reported a hold that "wasn't reflecting my press" the only way to
      // recover the duration was to difference the gaps between the page's
      // own screenshot polls in the [Call] log. A relay that replays an
      // operator's gesture must record the gesture it replayed.
      // ⛔ BEST EFFORT, AND NEVER FATAL. A tap that refuses because the window
      // could not be raised is strictly worse than a tap delivered to an
      // unfocused window: the second might work, the first cannot.
      let wasFocused: boolean | null = null;
      if (deps.focusTab) {
        try {
          const r = await deps.focusTab(s);
          wasFocused = r && typeof r.wasFocused === "boolean" ? r.wasFocused : null;
        } catch (err: any) {
          console.error(`[captcha] focusTab failed for ${s.id}: ${err?.message ?? err}`);
        }
      }
      const started = Date.now();
      const pending = deps.click(s, x, y, holdMs);
      s.inFlight = pending.then(
        () => { s.inFlight = null; },
        () => { s.inFlight = null; },
      );
      await pending;
      console.log(
        `[captcha] tap ${s.id} (${x},${y}) holdMs=${holdMs ?? "-"} took=${Date.now() - started}ms ` +
          `windowWasFocused=${wasFocused === null ? "?" : wasFocused}`,
      );
      s.cursor = { x, y };
      s.taps++;
      res.json({ ok: true, x, y, holdMs: holdMs ?? null, taps: s.taps });
    } catch (err: any) {
      res.status(502).json({ ok: false, error: err.message });
    }
  });

  app.post("/captcha/:token/text", async (req: any, res: any) => {
    const s = live(req, res);
    if (!s) return;
    // ⭐ A KEY RIDES THE `text` PATH, for the same reason holdMs rides `tap`:
    // the nginx write surface is exactly {tap, text, done} and a fourth verb is
    // that seat's change, not a local edit.
    // ⭐ SCROLL RIDES THE SAME PATH, for the same reason holdMs rides `tap`:
    // the nginx write surface is exactly {tap, text, done}.
    const rawScroll = req.body?.scroll;
    if (rawScroll !== undefined && rawScroll !== null) {
      const y = Number(rawScroll);
      if (!Number.isFinite(y) || Math.abs(y) > 5000) {
        return res.status(400).json({ ok: false, error: "scroll must be -5000..5000" });
      }
      if (!deps.scroll) {
        return res.status(501).json({ ok: false, error: "this server cannot scroll the page" });
      }
      try {
        await deps.scroll(s, Math.round(y));
        return res.json({ ok: true, scrolled: Math.round(y) });
      } catch (err: any) {
        return res.status(502).json({ ok: false, error: err.message });
      }
    }
    // ⭐ A WHOLE-VALUE WRITE RIDES THE SAME PATH, for the same reason a key
    // does: the nginx write surface is exactly {tap, text, done}.
    const rawValue = req.body?.value;
    if (typeof rawValue === "string") {
      if (!deps.setValue) {
        return res.status(501).json({ ok: false, error: "this server cannot set a field value" });
      }
      if (rawValue.length > 500) {
        return res.status(400).json({ ok: false, error: "value too long" });
      }
      try {
        const verdict = await deps.setValue(s, rawValue);
        s.typed++;
        // ⚠️ 200 WITH ok:false ON A BAD VERDICT. The request worked; the page
        // did not have a field focused, and the operator is the only one who
        // can fix that — so it has to reach them, not a log.
        return res.json({ ok: verdict === "OK", verdict, length: rawValue.length, typed: s.typed });
      } catch (err: any) {
        return res.status(502).json({ ok: false, error: err.message });
      }
    }
    const rawKey = req.body?.key;
    if (rawKey !== undefined && rawKey !== null && rawKey !== "") {
      const key = String(rawKey);
      if (!deps.pressKey) {
        return res.status(501).json({ ok: false, error: "this server cannot send key events" });
      }
      if (!KB_KEYS[key]) {
        return res.status(400).json({ ok: false, error: `key must be one of: ${Object.keys(KB_KEYS).join(", ")}` });
      }
      try {
        await deps.pressKey(s, key);
        s.typed++;
        return res.json({ ok: true, key, typed: s.typed });
      } catch (err: any) {
        return res.status(502).json({ ok: false, error: err.message });
      }
    }
    const text = String(req.body?.text ?? "");
    if (!text) return res.status(400).json({ ok: false, error: "empty text" });
    if (text.length > 500) return res.status(400).json({ ok: false, error: "text too long" });
    try {
      await deps.type(s, text);
      s.typed++;
      res.json({ ok: true, typed: s.typed });
    } catch (err: any) {
      res.status(502).json({ ok: false, error: err.message });
    }
  });

  app.post("/captcha/:token/done", async (req: any, res: any) => {
    const s = live(req, res);
    if (!s) return;
    // ⛔ A PRESS STILL IN FLIGHT OUTRANKS THE DONE BUTTON — see `inFlight`.
    // The bound is holdMs's own ceiling plus the move and the round trip; past
    // that something is wrong with the socket, and reporting solved late is
    // worse than reporting it on a press that will never arrive.
    if (s.inFlight) {
      let timer: any;
      await Promise.race([
        s.inFlight,
        new Promise<void>((r) => { timer = setTimeout(r, 25000); timer?.unref?.(); }),
      ]);
      clearTimeout(timer);
    }
    s.state = "solved";
    s.solvedAt = Date.now();
    s.note = typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : null;
    res.json(publicView(s));
    // ⛔ AFTER res.json, AND NOT AWAITED — see onSolved's contract above.
    // ⛔ try/catch is not optional: a synchronous throw in the callback would
    // escape into Express's error handler on a request that has ALREADY been
    // answered, which logs an unhandled failure for a captcha that was in fact
    // solved.
    if (deps.onSolved) {
      try {
        deps.onSolved(s);
      } catch (err: any) {
        console.error(`[captcha] onSolved threw for ${s.id}: ${err?.message ?? err}`);
      }
    }
  });
}
