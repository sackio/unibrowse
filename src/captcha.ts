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
  #shot { width:100%; display:block; border-radius:8px; border:1px solid #2b2f37; }
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
var busy = false, stopped = false;

function shot() {
  if (stopped) return;
  var img = document.getElementById('shot');
  var probe = new Image();
  probe.onload = function () { img.src = probe.src; img.dataset.nw = probe.naturalWidth; img.dataset.nh = probe.naturalHeight; };
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

document.addEventListener('click', function (e) {
  if (e.target.id !== 'shot' || busy || stopped) return;
  var img = e.target, r = img.getBoundingClientRect();
  var nw = +img.dataset.nw || r.width, nh = +img.dataset.nh || r.height;
  // Normalised 0..1 so the server does the scaling — it is the only side that
  // knows the tab's CSS viewport, and the image may be at any device ratio.
  var fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
  var dot = document.getElementById('dot');
  dot.style.left = (e.clientX - r.left + 10) + 'px';
  dot.style.top = (e.clientY - r.top + 10) + 'px';
  dot.style.opacity = 1; setTimeout(function () { dot.style.opacity = 0; }, 450);
  busy = true;
  fetch('tap', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ fx: fx, fy: fy }) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      document.getElementById('status').textContent =
        j.ok ? 'Tap sent.' : ('Refused: ' + (j.error || 'unknown'));
    })
    .catch(function () { document.getElementById('status').textContent = 'Tap failed to send.'; })
    .then(function () { busy = false; setTimeout(shot, 600); });
});

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
    click: (s: CaptchaSession, x: number, y: number) => Promise<void>;
    type: (s: CaptchaSession, text: string) => Promise<void>;
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
      await deps.click(s, x, y);
      s.taps++;
      res.json({ ok: true, x, y, taps: s.taps });
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
  });
}
