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
  button { flex:1; padding:13px; font-size:15px; font-weight:600; border:0;
           border-radius:8px; background:#2b2f37; color:#e8eaed; }
  button.go { background:#2563eb; color:#fff; }
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
    <div class="row"><input id="txt" placeholder="Type an answer, if it needs one" autocomplete="off"></div>
    <div class="bar">
      <button id="send">Send text</button>
      <button id="done" class="go">Done</button>
    </div>
    <div id="status">Tap the image where you would tap the page.</div>
    <div class="hint">Taps become real clicks in the browser. The picture refreshes every couple of seconds.</div>
  </div>
</div>
<script>
// ⛔ RELATIVE URLS ONLY. This page is served through an ATC artifact proxy that
// mounts it at /f/<id>/, so an absolute path would resolve at the artifact
// domain root and 404. A <base> tag is injected by the proxy for exactly this.
var busy = false, stopped = false, shotFailed = false;

// ⛔ A FAILED SHOT MUST SAY SO. It used to fail silently: /shot answers with a
// JSON error body on failure, an <img> cannot render JSON, and the old code had
// only an onload handler — so the operator got a blank frame, no text, and no
// way to tell "broken" from "still loading". MEASURED 2026-10-09: Ben, sent
// three captchas at once, reported the third as "doesn't even explain anything,
// it's broken". It was: its tab was backgrounded, Page.captureScreenshot never
// produced a frame, and the relay had no way to tell him that.
function shot() {
  if (stopped) return;
  var img = document.getElementById('shot');
  var probe = new Image();
  probe.onload = function () {
    img.src = probe.src; img.dataset.nw = probe.naturalWidth; img.dataset.nh = probe.naturalHeight;
    if (shotFailed) { shotFailed = false; document.getElementById('status').textContent = ''; }
  };
  probe.onerror = function () {
    shotFailed = true;
    // Re-request as a fetch to read WHY. The image load threw away the body.
    fetch('shot?t=' + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (j) {
        document.getElementById('status').textContent =
          'Picture unavailable: ' + ((j && j.error) || 'unknown') +
          ' — the page is still there, this is the screenshot failing.';
      })
      .catch(function () {
        document.getElementById('status').textContent =
          'Picture unavailable and the error could not be read. The page may still be fine.';
      });
  };
  probe.src = 'shot?t=' + Date.now();
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
      busy = false; setTimeout(shot, 600);
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

document.getElementById('send').onclick = function () {
  var v = document.getElementById('txt').value;
  if (!v) return;
  fetch('text', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: v }) })
    .then(function () { document.getElementById('txt').value = '';
                        document.getElementById('status').textContent = 'Text sent.'; setTimeout(shot, 600); });
};

document.getElementById('done').onclick = function () {
  fetch('done', { method: 'POST' }).then(poll);
};

shot(); poll();
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
export function registerCaptchaRoutes(
  app: Express,
  deps: {
    screenshot: (s: CaptchaSession) => Promise<string>;
    viewport: (s: CaptchaSession) => Promise<{ width: number; height: number }>;
    click: (s: CaptchaSession, x: number, y: number, holdMs?: number) => Promise<void>;
    type: (s: CaptchaSession, text: string) => Promise<void>;
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

  app.get("/captcha/:token/state", (req: any, res: any) => {
    const s = resolveSession(String(req.params.token || ""));
    if (!s) return res.status(404).json({ error: "no such captcha session" });
    res.json(publicView(s));
  });

  app.get("/captcha/:token/shot", async (req: any, res: any) => {
    const s = live(req, res);
    if (!s) return;
    try {
      const b64 = await deps.screenshot(s);
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
      await deps.click(s, x, y, holdMs);
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

  app.post("/captcha/:token/done", (req: any, res: any) => {
    const s = live(req, res);
    if (!s) return;
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
