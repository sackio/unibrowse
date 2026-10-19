/**
 * Slipway — drive one browser from a phone.
 *
 * Ben named it in Slack #unibrowse 2026-10-12 15:14 ("it's called the app
 * slipway"), authorised building it, and asked for it paced. This file is
 * PHASE 1: the half that needs no app at all. A phone-sized page, served by us
 * and proxied by an ATC artifact so it works off-LAN with no VPN, showing a
 * live screenshot of any tab attached to ONE browser, with real taps, typing,
 * scrolling, tab switching and session recording.
 *
 * ⭐ WHY THIS IS A SEPARATE MODULE FROM captcha.ts RATHER THAN A FLAG ON IT.
 * They differ on the axis that decides every security property: a captcha
 * session names ONE tab, lives ten minutes and is single-use, and those three
 * bounds are what make its link safe to send. Slipway deliberately gives up
 * all three. Folding them together would mean one code path whose blast radius
 * depends on a boolean, which is the shape where the dangerous default wins.
 *
 * ⚠️ SAY THE CAPABILITY PLAINLY: whoever holds a Slipway URL can click, type
 * and read inside every tab OPEN IN the named browser — not merely the ones
 * already attached, since the roster attaches on select — for as long as the
 * session lives. That is strictly more than the captcha relay grants, and it is
 * bounded on only two axes now:
 *   · ONE BROWSER — `extensionId` is required at mint and cannot be changed by
 *     the page, so a leaked link cannot wander the rest of the fleet. Minting a
 *     second session is the only way to reach a second browser, and that is a
 *     deliberate friction.
 *   · A TTL — default 8h rather than 10 minutes, because the point is to leave
 *     it open on a phone. `done` ends it early; expiry is evaluated on read.
 * ⛔ It does NOT have the captcha relay's single-use or rect clamp. Do not
 * describe it as "like the captcha link but for more tabs" to anyone deciding
 * whether to send it.
 *
 * ⛔ THE WRITE SURFACE IS STILL EXACTLY THREE PATH NAMES. nginx allows POST
 * under /f/ only to `tap`, `text` and `done` ($-anchored, commit 2fb447c), and
 * an artifact proxy mounts us under /f/<id>/. A fourth verb is an nginx change
 * and a DM to that seat. ⇒ Every action here is carried as a FIELD on one of
 * those three bodies: `text` doubles as a small command channel ({cmd:"select"}
 * / {cmd:"scroll"} / {cmd:"key"} / {cmd:"record"}). Same trick press-and-hold
 * used on `tap`. It is not elegant; it is the thing that ships without a
 * cross-seat dependency, and the alternative was worse.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Express } from "express";
import { coalesceCapture } from "@/captcha";

export type SlipwayState = "live" | "ended" | "expired";

export interface SlipwayTab {
  tabTarget: number | string;
  label: string | null;
  title: string | null;
  url: string | null;
  reservedTo: string | null;
  /**
   * ⭐ FALSE MEANS "OPEN IN THIS BROWSER BUT NOT DRIVEABLE YET", NOT "absent".
   *
   * The roster deliberately spans every tab the browser has. Listing only the
   * attached ones showed Ben a ONE-ITEM menu holding a platform.claude.com
   * login tab an agent had left there and none of his own 17 pages — measured
   * on his Chrome 2026-10-12 16:07 — which is what "let's work on the app this
   * is not working still for me" (#unibrowse 15:39) actually was. Picking an
   * unattached tab attaches it first.
   */
  attached: boolean;
}

export interface SlipwaySession {
  id: string;
  token: string;
  /** ⛔ Required. The one browser this link can reach. See the header. */
  extensionId: string;
  /** The tab currently being shown; null until the holder picks one. */
  tabTarget: number | string | null;
  label: string;
  state: SlipwayState;
  createdAt: number;
  expiresAt: number;
  taps: number;
  typed: number;
  lastShotAt: number | null;
  endedAt: number | null;
  recording: boolean;
  /** The agent that minted it — who gets told things, same role as in captcha.ts. */
  requester: string | null;
  /**
   * Where the last relayed tap left the pointer, so the next one starts from
   * there. Same reason as the captcha relay: without it the extension's bezier
   * starts at (0,0) on every tap, and a path that begins at the same pixel
   * every time is a signature.
   */
  cursor: { x: number; y: number } | null;
}

const sessions = new Map<string, SlipwaySession>();

/**
 * ⭐ SESSIONS SURVIVE A RESTART. THAT IS THE WHOLE POINT OF THIS BLOCK.
 *
 * In memory alone they did not, and the entire cost landed on the person
 * holding the link. Measured 2026-10-12: four deploys of mine inside ten
 * minutes each silently killed Ben's page, so every time he opened it he got a
 * dead link, and he reported — correctly — that it still did not work. ⛔ A
 * dead session is INDISTINGUISHABLE from the feature being broken, which is
 * why "sessions live in memory, a link never outlives a deploy" was never an
 * acceptable thing to tell him; it describes the bug as a design.
 *
 * ⚠️ THE FILE HOLDS LIVE TOKENS, which are credentials. It lives in a NAMED
 * DOCKER VOLUME and deliberately NOT under the repo directory: that is
 * /mnt/nas, readable by every seat on all four hosts, so a bind mount there
 * would publish every live link to the fleet. Anyone with docker on office can
 * still read the volume — the same audience that can mint a session anyway.
 *
 * ⛔ IF THE PATH IS NOT WRITABLE THIS DEGRADES TO IN-MEMORY AND SAYS SO LOUDLY,
 * once per distinct error. A silent fallback here would restore exactly the
 * failure it exists to remove, and the server would look healthy doing it.
 */
const STATE_FILE =
  process.env.SLIPWAY_STATE_FILE || "/app/state/slipway-sessions.json";
let persistError: string | null = null;
let persistQueued = false;

function writeSlipwayState(): void {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    // Only sessions still worth restoring. An ended or expired one on disk is
    // noise that gets loaded and immediately swept on every boot.
    const keep = [...sessions.values()].filter(
      (s) => s.state === "live" && Date.now() < s.expiresAt,
    );
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ version: 1, savedAt: Date.now(), sessions: keep }),
      { mode: 0o600 },
    );
    // ⛔ Write-then-rename, never in place: a crash mid-write leaves truncated
    // JSON, and the load path cannot tell that from "no sessions" — it would
    // drop every live link while reporting a clean start.
    fs.renameSync(tmp, STATE_FILE);
    persistError = null;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (persistError !== msg) {
      persistError = msg;
      console.error(
        `[slipway] ⚠️ cannot persist sessions to ${STATE_FILE}: ${msg} — ` +
          `links will NOT survive a restart`,
      );
    }
  }
}

/** Coalesce a burst of mutations into one write a tick later. */
export function persistSlipway(): void {
  if (persistQueued) return;
  persistQueued = true;
  setTimeout(() => {
    persistQueued = false;
    writeSlipwayState();
  }, 250).unref();
}

/**
 * Restore whatever is still live. Call once at startup, before the routes
 * start answering, so a page polling across a deploy never sees a 404.
 */
export function loadSlipwaySessions(): {
  loaded: number;
  dropped: number;
  error: string | null;
} {
  let loaded = 0;
  let dropped = 0;
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    for (const s of (data?.sessions ?? []) as SlipwaySession[]) {
      // ⛔ Validate rather than trust: this file is state we wrote, but a
      // half-upgraded shape would otherwise enter the map and fail later, at a
      // route, where the cause is invisible.
      if (!s || typeof s.token !== "string" || typeof s.extensionId !== "string") {
        dropped++;
        continue;
      }
      if (s.state !== "live" || Date.now() >= s.expiresAt) {
        dropped++;
        continue;
      }
      sessions.set(s.token, s);
      loaded++;
    }
    return { loaded, dropped, error: null };
  } catch (err: any) {
    // A missing file is the normal first boot, not a fault.
    if (err?.code === "ENOENT") return { loaded, dropped, error: null };
    return { loaded, dropped, error: err?.message ?? String(err) };
  }
}

function newToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function createSlipwaySession(opts: {
  extensionId: string;
  label?: string;
  tabTarget?: number | string | null;
  ttlSeconds?: number;
  requester?: string | null;
}): SlipwaySession {
  const now = Date.now();
  // 8h default: this is meant to be left open on a phone for a working day.
  // Floor 60s, ceiling 24h — a link that outlives the day it was made for is
  // a credential nobody remembers issuing.
  const ttl = Math.min(Math.max(opts.ttlSeconds ?? 28_800, 60), 86_400);
  const s: SlipwaySession = {
    id: crypto.randomUUID(),
    token: newToken(),
    extensionId: opts.extensionId,
    tabTarget: opts.tabTarget ?? null,
    label: opts.label || "Slipway",
    state: "live",
    createdAt: now,
    expiresAt: now + ttl * 1000,
    taps: 0,
    typed: 0,
    lastShotAt: null,
    endedAt: null,
    recording: false,
    requester: opts.requester ?? null,
    cursor: null,
  };
  sessions.set(s.token, s);
  persistSlipway();
  return s;
}

export function getSlipwayById(id: string): SlipwaySession | undefined {
  for (const s of sessions.values()) if (s.id === id) return s;
  return undefined;
}

/**
 * ⚠️ Expiry is evaluated on READ, exactly as in captcha.ts and for the same
 * reason: a timer has to be cancelled on every terminal transition and leaks a
 * handle whenever it is not, while reading the clock cannot drift out of sync
 * with the state.
 */
export function resolveSlipway(token: string): SlipwaySession | undefined {
  const s = sessions.get(token);
  if (!s) return undefined;
  if (s.state === "live" && Date.now() > s.expiresAt) {
    s.state = "expired";
    persistSlipway();
  }
  return s;
}

export function listSlipwaySessions(): SlipwaySession[] {
  return [...sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** Drop sessions whose TTL ran out long enough ago that nobody is still polling. */
export function sweepSlipwaySessions(graceMs = 3_600_000): number {
  const now = Date.now();
  let n = 0;
  for (const [token, s] of sessions) {
    const dead = s.state !== "live" || now > s.expiresAt;
    if (dead && now - Math.max(s.endedAt ?? 0, s.expiresAt) > graceMs) {
      sessions.delete(token);
      persistSlipway();
      n++;
    }
  }
  return n;
}

export function slipwayPublicView(s: SlipwaySession, tabs: SlipwayTab[] | null) {
  return {
    id: s.id,
    label: s.label,
    state: s.state,
    extensionId: s.extensionId,
    tabTarget: s.tabTarget,
    recording: s.recording,
    taps: s.taps,
    typed: s.typed,
    tabs,
    secondsRemaining: Math.max(0, Math.round((s.expiresAt - Date.now()) / 1000)),
    expiresAt: new Date(s.expiresAt).toISOString(),
  };
}

const PAGE = String.raw`<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Slipway</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin:0; background:#14161a; color:#e8eaed;
         font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  header { padding:10px 12px; background:#1d2026; border-bottom:1px solid #2b2f37;
           position:sticky; top:0; z-index:3; }
  .row1 { display:flex; align-items:center; gap:8px; }
  h1 { margin:0; font-size:15px; font-weight:600; white-space:nowrap; }
  .sub { font-size:12px; color:#9aa0aa; margin-top:3px; }
  select { flex:1; min-width:0; padding:9px; font-size:14px; border-radius:7px;
           border:1px solid #2b2f37; background:#14161a; color:#e8eaed; }
  #wrap { position:relative; padding:8px; }
  /* ⛔ ALL FOUR OF THESE ARE LOAD-BEARING ON MOBILE and they are copied from the
     captcha relay deliberately, where they were MEASURED 2026-10-09 on Ben's
     Android Chrome: a press-and-hold otherwise opens the browser's long-press
     image menu, which hides the page AND cancels the gesture. preventDefault on
     pointerdown does NOT stop it — the menu is raised off the touch sequence.
     ⛔ DO NOT PUT BACKTICKS IN THIS BLOCK — PAGE is a String.raw template. */
  #shot { width:100%; display:block; border-radius:8px; border:1px solid #2b2f37;
          touch-action:none; -webkit-touch-callout:none;
          -webkit-user-select:none; user-select:none; background:#0e1013; min-height:120px; }
  #dot { position:absolute; width:26px; height:26px; margin:-13px 0 0 -13px;
         border:2px solid #4ade80; border-radius:50%; pointer-events:none;
         opacity:0; transition:opacity .45s; }
  .bar { display:flex; gap:6px; padding:0 8px 8px; }
  button { flex:1; padding:11px 6px; font-size:14px; font-weight:600; border:0;
           border-radius:7px; background:#2b2f37; color:#e8eaed; }
  button.go { background:#2563eb; color:#fff; }
  button.rec { background:#b91c1c; color:#fff; }
  button:disabled { opacity:.45; }
  input { width:100%; padding:11px; font-size:16px; border-radius:7px;
          border:1px solid #2b2f37; background:#1d2026; color:#e8eaed; }
  .r { padding:0 8px 8px; }
  #status { padding:8px 12px 12px; font-size:13px; color:#9aa0aa; min-height:18px; }
  .done { text-align:center; padding:48px 20px; }
  .done h2 { font-size:20px; margin:0 0 8px; }
</style>
</head><body>
<div id="app">
  <header>
    <div class="row1">
      <h1 id="ttl">Slipway</h1>
      <select id="tabs"><option value="">Loading tabs…</option></select>
    </div>
    <div class="sub" id="meta"></div>
  </header>
  <div id="live">
    <div id="wrap"><img id="shot" alt="page"><div id="dot"></div></div>
    <div class="r"><input id="txt" placeholder="Tap a box in the picture, then type here" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text" enterkeyhint="go"></div>
    <div class="bar">
      <button id="clear">Clear</button>
      <button id="send">Send text</button>
      <button id="enter">Enter</button>
    </div>
    <div class="bar">
      <button id="up">Scroll up</button>
      <button id="down">Scroll down</button>
    </div>
    <div class="bar">
      <button id="attach">Attach current tab</button>
    </div>
    <div class="bar">
      <button id="rec">Record</button>
      <button id="end" class="go">Finish</button>
    </div>
    <div id="status">Pick a tab, then tap the picture where you would tap the page.</div>
  </div>
</div>
<script>
// ⛔ RELATIVE URLS ONLY — this page is mounted at /f/<id>/ by the artifact
// proxy, so an absolute path resolves at the artifact domain root and 404s.
var busy = false, stopped = false, shotFailed = false, haveTab = false,
    shotInFlight = false, shotAgain = false;
// ⛔ A 1x1 TRANSPARENT PNG, SET BEFORE ANYTHING ELSE. An <img> with no src
// renders the browser's broken-image icon, which says "this page is broken"
// when the truth is "no tab is selected yet". Measured: that is exactly how
// Ben read it. The placeholder makes the empty state silent so the status line
// can do the talking.
var BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function setStatus(t) { document.getElementById('status').textContent = t; }

// ⛔ A FAILED SHOT MUST SAY SO. /shot answers with a JSON error body on failure
// and an <img> cannot render JSON, so an onload-only handler shows a blank
// frame — indistinguishable from "still loading". This cost the captcha relay a
// report of "it's broken" when the real cause was a backgrounded tab.
//
// ⛔⛔ ONE REQUEST PER SHOT, AND ONE SHOT IN FLIGHT — same defect and same fix as
// the captcha relay, where it was measured; the long version is in captcha.ts.
// In short: Cache-Control: no-store makes img.src = probe.src a SECOND full
// request, so a probe poll costs TWO compositor captures, and office Chrome
// captures in 4.0s against this page's 2200ms poll (measured 2026-10-18). The
// queue grew until the operator saw a broken image. Fetch once, render the
// bytes we hold, and never run two captures at once.
function shot() {
  if (stopped || !haveTab) return;
  if (shotInFlight) { shotAgain = true; return; }
  shotInFlight = true; shotAgain = false;
  var img = document.getElementById('shot');
  fetch('shot?t=' + Date.now())
    .then(function (r) {
      if (r.ok) return r.blob();
      return r.json().then(
        function (j) { throw new Error((j && j.error) || ('HTTP ' + r.status)); },
        function () { throw new Error('HTTP ' + r.status); }
      );
    })
    .then(function (b) {
      return new Promise(function (ok, no) {
        var fr = new FileReader();
        fr.onload = function () { ok(fr.result); };
        fr.onerror = function () { no(new Error('the picture could not be decoded')); };
        fr.readAsDataURL(b);
      });
    })
    .then(function (url) {
      img.src = url;
      if (shotFailed) { shotFailed = false; setStatus(''); }
    })
    .catch(function (err) {
      shotFailed = true;
      setStatus('Picture unavailable: ' + ((err && err.message) || 'unknown') +
                ' — the page is still there, this is the screenshot failing.');
    })
    .then(function () {
      shotInFlight = false;
      if (shotAgain && !stopped && haveTab) { shotAgain = false; setTimeout(shot, 0); }
    });
}

// ⭐ THE PHONE'S OWN KEYBOARD. A phone opens it only when .focus() runs INSIDE
// the touch gesture, so the page cannot wait to be told it hit a text box — the
// field rects come down with /state and the decision is made synchronously in
// pointerdown. Ported from the captcha relay 2026-10-18.
var fields = [], liveKb = false, kbTimer = null, kbChain = Promise.resolve();

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

// ⛔ SERIALISED. Two value writes in flight at once can land out of order, and
// the later-arriving older string silently undoes what was typed after it.
function sendVal(v) {
  kbChain = kbChain.then(function () { return post({ cmd: 'value', value: v }); })
    .catch(function () { return null; });
  return kbChain;
}

function post(body) {
  return fetch('text', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                         body: JSON.stringify(body) })
    .then(function (r) { return r.json(); });
}

// ⛔ null, NOT ''. An EMPTY roster also stringifies to '', so initialising
// this to '' meant the first poll of a browser with no attached tabs compared
// equal, skipped the rebuild, and left the menu saying "Loading tabs…" for
// ever — a state that reads as a hung page and is actually an accurate but
// unrendered "none". The empty case must render like any other.
var lastTabsKey = null;
function poll() {
  fetch('state').then(function (r) { return r.json(); }).then(function (s) {
    document.getElementById('ttl').textContent = s.label || 'Slipway';
    if (s.state !== 'live') {
      stopped = true;
      document.getElementById('app').innerHTML =
        '<div class="done"><h2>' +
        (s.state === 'expired' ? 'This link has expired' : 'Finished') +
        '</h2><div class="sub">You can close this page.</div></div>';
      return;
    }
    var mins = Math.round(s.secondsRemaining / 60);
    document.getElementById('meta').textContent =
      mins + ' min left · ' + s.taps + ' taps · ' + (s.recording ? 'RECORDING' : 'not recording');
    document.getElementById('rec').className = s.recording ? 'rec' : '';
    document.getElementById('rec').textContent = s.recording ? 'Stop recording' : 'Record';

    // Only rebuild the <select> when the roster actually changed — rebuilding
    // it on every poll closes the native picker under the operator's finger.
    var key = (s.tabs || []).map(function (t) {
      return t.tabTarget + ':' + (t.title || '') + ':' + (t.attached ? 1 : 0);
    }).join('|');
    if (key !== lastTabsKey) {
      lastTabsKey = key;
      var sel = document.getElementById('tabs');
      sel.innerHTML = '';
      if (!(s.tabs || []).length) {
        sel.innerHTML = '<option value="">No tabs in this browser</option>';
        haveTab = false;
        document.getElementById('shot').src = BLANK;
        setStatus('This browser has no tabs open at all — open one, or press "Attach current tab".');
      } else {
        (s.tabs || []).forEach(function (t) {
          var o = document.createElement('option');
          o.value = String(t.tabTarget);
          // '●' marks a tab that is open but not attached yet. Picking it
          // attaches it, so the marker is information, not a warning.
          o.textContent = (t.attached ? '' : '\u25cf ') +
                          (t.title || t.label || String(t.tabTarget)).slice(0, 60) +
                          (t.reservedTo ? ' [' + t.reservedTo + ']' : '');
          sel.appendChild(o);
        });
      }
    }
    if (s.tabTarget !== null && s.tabTarget !== undefined) {
      document.getElementById('tabs').value = String(s.tabTarget);
      if (!haveTab) { haveTab = true; shot(); }
    } else if ((s.tabs || []).length) {
      // ⛔ The empty-roster fault one level in: tabs EXIST but none is chosen,
      // so the <img> still has no src and still renders a broken-image icon.
      haveTab = false;
      document.getElementById('shot').src = BLANK;
      setStatus('Pick a tab above to start driving it. \u25cf = not attached yet; picking it attaches it.');
    }
  }).catch(function () {});
}

document.getElementById('tabs').onchange = function () {
  var v = this.value;
  if (!v) return;
  setStatus('Switching tab…');
  post({ cmd: 'select', tabTarget: v }).then(function (j) {
    if (j.ok) { haveTab = true; setStatus(''); setTimeout(shot, 400); }
    else setStatus('Could not switch: ' + (j.error || 'unknown'));
  });
};

// PRESS-AND-HOLD, measured from the operator's own gesture rather than offered
// as a preset, because a challenge scores how long the button was held.
// ⛔ The press POSITION comes from pointerDOWN, not pointerup: on a touch screen
// a finger drifts during a multi-second hold and releasing elsewhere must not
// relocate the click.
var holdStart = null, holdFx = 0, holdFy = 0, holdTimer = null;

document.addEventListener('pointerdown', function (e) {
  if (e.target.id !== 'shot' || busy || stopped || !haveTab) return;
  var r = e.target.getBoundingClientRect();
  holdFx = (e.clientX - r.left) / r.width;
  holdFy = (e.clientY - r.top) / r.height;
  holdStart = Date.now();
  // ⛔ THIS .focus() MUST STAY IN THE POINTERDOWN HANDLER. Inside the gesture
  // the phone raises its keyboard; one tick later it does not.
  liveKb = hitField(holdFx, holdFy);
  if (liveKb) {
    var box = document.getElementById('txt');
    box.value = '';
    box.focus();
  }
  var dot = document.getElementById('dot');
  dot.style.left = (e.clientX - r.left + 8) + 'px';
  dot.style.top = (e.clientY - r.top + 8) + 'px';
  dot.style.opacity = 1;
  holdTimer = setInterval(function () {
    if (holdStart !== null) setStatus('Holding ' + ((Date.now() - holdStart) / 1000).toFixed(1) + 's — release to send.');
  }, 100);
  e.preventDefault();
});

function endHold() {
  if (holdStart === null) return;
  var held = Date.now() - holdStart;
  holdStart = null;
  if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
  document.getElementById('dot').style.opacity = 0;
  if (busy || stopped) return;
  busy = true;
  var body = { fx: holdFx, fy: holdFy };
  // Under ~250ms is an ordinary tap: send it with no hold so the extension
  // keeps its own randomised 50-100ms down-delay, which is more human than a
  // measured 180ms replayed exactly.
  if (held >= 250) body.holdMs = Math.min(held, 20000);
  fetch('tap', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify(body) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      setStatus(j.ok ? (j.holdMs ? ('Held ' + (j.holdMs / 1000).toFixed(1) + 's — sent.') : 'Tap sent.')
                     : ('Refused: ' + (j.error || 'unknown')));
    })
    .catch(function () { setStatus('Tap failed to send.'); })
    .then(function () { busy = false; setTimeout(shot, 500); loadFields(); });
}

// ⛔ A hold that ends by cancellation or by leaving the window must still SEND,
// or the operator holds for five seconds, lifts off the edge of the image, and
// nothing happens with no error.
document.addEventListener('pointerup', endHold);
document.addEventListener('pointercancel', endHold);
window.addEventListener('blur', endHold);
document.addEventListener('contextmenu', function (e) { if (e.target.id === 'shot') e.preventDefault(); });
document.addEventListener('dragstart', function (e) { if (e.target.id === 'shot') e.preventDefault(); });

// ⭐ THE BOX IS THE SOURCE OF TRUTH in live mode: every change sends the WHOLE
// value and the field is set to it, so delete, paste and editing the middle all
// work. ⛔ DO NOT GO BACK TO STREAMING EDITS — that version appended every
// attempt onto the last while Backspace deleted nothing (measured on the
// captcha relay, Ben's phone 2026-10-18 13:03).
document.getElementById('txt').addEventListener('input', function () {
  if (!liveKb) return;
  var v = this.value;
  if (kbTimer) clearTimeout(kbTimer);
  kbTimer = setTimeout(function () {
    kbTimer = null;
    sendVal(v).then(function (j) {
      if (j && j.verdict && j.verdict !== 'OK') {
        setStatus('The page lost the text box — tap it in the picture again, then type.');
      }
      setTimeout(shot, 300);
    });
  }, 140);
});

document.getElementById('txt').addEventListener('keydown', function (e) {
  if (!liveKb || e.key !== 'Enter') return;
  e.preventDefault();
  // Flush first: a debounced value still waiting would land AFTER the Enter and
  // submit the previous string. sendVal is serialised, so order is kept.
  if (kbTimer) { clearTimeout(kbTimer); kbTimer = null; sendVal(this.value); }
  kbChain = kbChain.then(function () { return post({ cmd: 'key', key: 'Enter' }); });
  kbChain.then(function () { setTimeout(shot, 700); });
});

// ⭐ CLEAR EMPTIES THE FIELD IN THE TAB, not just this box.
document.getElementById('clear').onclick = function () {
  var el = document.getElementById('txt');
  el.value = '';
  if (!liveKb) { setStatus('Box cleared. Tap a text box in the picture to clear that field.'); return; }
  if (kbTimer) { clearTimeout(kbTimer); kbTimer = null; }
  sendVal('').then(function (j) {
    setStatus(j && j.verdict === 'OK' ? 'Field cleared.'
                                      : 'Tap the text box in the picture again, then Clear.');
    setTimeout(shot, 300);
  });
};

document.getElementById('send').onclick = function () {
  var v = document.getElementById('txt').value;
  if (!v) return;
  setStatus('Typing…');
  // In live mode this is a flush, not a second send: the write REPLACES the
  // field, so pressing it after a pause cannot double what was typed.
  if (liveKb) {
    if (kbTimer) { clearTimeout(kbTimer); kbTimer = null; }
    sendVal(v).then(function (j) {
      setStatus(j && j.verdict === 'OK' ? 'Field set to what you typed.'
                                        : 'Tap the text box in the picture, then press Send text again.');
      setTimeout(shot, 400);
    });
    return;
  }
  post({ text: v }).then(function (j) {
    if (j.ok) { document.getElementById('txt').value = ''; setStatus('Text sent.'); setTimeout(shot, 500); }
    else setStatus('Refused: ' + (j.error || 'unknown'));
  });
};
document.getElementById('enter').onclick = function () {
  post({ cmd: 'key', key: 'Enter' }).then(function (j) {
    setStatus(j.ok ? 'Enter sent.' : ('Refused: ' + (j.error || 'unknown')));
    setTimeout(shot, 700);
  });
};
document.getElementById('up').onclick = function () {
  post({ cmd: 'scroll', y: -400 }).then(function () { setTimeout(shot, 350); });
};
document.getElementById('down').onclick = function () {
  post({ cmd: 'scroll', y: 400 }).then(function () { setTimeout(shot, 350); });
};
document.getElementById('attach').onclick = function () {
  setStatus('Attaching whatever tab that browser is showing…');
  post({ cmd: 'attach' }).then(function (j) {
    if (j.ok) {
      haveTab = true; lastTabsKey = null; setStatus('Attached.');
      poll(); setTimeout(shot, 600);
    } else setStatus('Could not attach: ' + (j.error || 'unknown'));
  });
};
document.getElementById('rec').onclick = function () {
  var on = document.getElementById('rec').className !== 'rec';
  setStatus(on ? 'Starting recording…' : 'Stopping recording…');
  post({ cmd: 'record', on: on }).then(function (j) {
    setStatus(j.ok ? (on ? 'Recording.' : 'Recording stopped.') : ('Refused: ' + (j.error || 'unknown')));
    poll();
  });
};
document.getElementById('end').onclick = function () {
  if (!confirm('Finish this Slipway session? The link stops working.')) return;
  fetch('done', { method: 'POST' }).then(poll);
};

document.getElementById('shot').src = BLANK;
poll();
setInterval(function () { if (!busy) shot(); }, 2200);
setInterval(poll, 3000);
</script>
</body></html>`;

/**
 * Mount the Slipway routes.
 *
 * ⛔ NOT behind requireApiKey, same as the captcha relay: the 128-bit token in
 * the path IS the credential, because the whole point is a phone opening a link
 * with no LAN access and no login. See the header for what that token grants —
 * it is more than the captcha one, and that is stated there rather than here so
 * it cannot be read as an aside.
 */
export function registerSlipwayRoutes(
  app: Express,
  deps: {
    listTabs: (s: SlipwaySession) => Promise<SlipwayTab[]>;
    screenshot: (s: SlipwaySession) => Promise<string>;
    viewport: (s: SlipwaySession) => Promise<{ width: number; height: number }>;
    click: (s: SlipwaySession, x: number, y: number, holdMs?: number) => Promise<void>;
    type: (s: SlipwaySession, text: string) => Promise<void>;
    scroll: (s: SlipwaySession, y: number) => Promise<void>;
    pressKey: (s: SlipwaySession, key: string) => Promise<void>;
    record: (s: SlipwaySession, on: boolean) => Promise<void>;
    /**
     * Attach this browser's current tab and return its id.
     *
     * ⚠️ THIS IS THE ONE PLACE SLIPWAY ATTACHES ANYTHING, and it contradicts
     * nothing in the header: the rule there is that MINTING must not open or
     * attach a tab to satisfy a request that named none. This runs only when
     * the person holding the page presses a button, which is a choice, not an
     * inference. Without it a browser with nothing attached is a dead page —
     * measured on Ben's own Chrome within minutes of shipping, where it
     * presented as "the tab menu just says loading and the image is broken".
     */
    attachCurrent: (s: SlipwaySession) => Promise<number | string>;
    /**
     * Attach ONE named tab of this browser and return the id it ended up with.
     *
     * ⚠️ Carries the same exemption as attachCurrent, for the same reason: it
     * runs only when the person holding the page picks that tab out of the
     * roster. Minting still attaches nothing.
     */
    attachTab: (s: SlipwaySession, tabTarget: number | string) => Promise<number | string>;
    /**
     * Raise the tab's window before a press, and report whether it already had
     * focus. ⛔ BEST EFFORT, NEVER FATAL — ported from the captcha relay, where
     * a hold replayed into an unfocused window did nothing and looked like a
     * hold that had not been sent. A tap refused because the window could not
     * be raised is strictly worse than a tap delivered to an unfocused one.
     */
    focusTab?: (s: SlipwaySession) => Promise<{ wasFocused: boolean } | void>;
    /**
     * The tab's editable field rects, normalised 0..1, so a tap that lands in
     * one can open the phone's own keyboard INSIDE the touch gesture. ⚠️ Fails
     * to an empty list: no rects just means no keyboard and the Send text box
     * behaves as before, and it must never fail the status poll.
     */
    fields?: (s: SlipwaySession) => Promise<Array<{ fx: number; fy: number; fw: number; fh: number }>>;
    /**
     * Set the focused field's WHOLE value, returning the probe's verdict
     * (`OK`, `NO_FOCUS`, `NOT_EDITABLE:<tag>`). Full replace, not a diff —
     * streaming edits appended every attempt onto the last and Backspace
     * deleted nothing (measured on the captcha relay, Ben 2026-10-18 13:03).
     */
    setValue?: (s: SlipwaySession, text: string) => Promise<string>;
  },
) {
  /** A live session, or the response already sent. */
  function live(req: any, res: any): SlipwaySession | null {
    const s = resolveSlipway(String(req.params.token || ""));
    if (!s) {
      res.status(404).json({ ok: false, error: "no such slipway session" });
      return null;
    }
    if (s.state !== "live") {
      res.status(410).json({ ok: false, error: `session is ${s.state}`, state: s.state });
      return null;
    }
    return s;
  }

  /** Live AND pointed at a tab — every page action needs both. */
  function onTab(req: any, res: any): SlipwaySession | null {
    const s = live(req, res);
    if (!s) return null;
    if (s.tabTarget === null) {
      // ⛔ Say which of the two things is missing. "No tab selected" and "the
      // session is dead" are different problems and the holder can fix one.
      res.status(409).json({ ok: false, error: "no tab selected yet — pick one first" });
      return null;
    }
    return s;
  }

  // ⛔ SERVE THE PAGE AT index.html TOO. atc-files returns `url_public` as
  // .../f/<id>/index.html and the proxy maps that path straight through, so
  // serving only the directory means the exact URL we send a human 404s while
  // every other endpoint works. Measured on the captcha relay 2026-09-12.
  const servePage = (req: any, res: any) => {
    const s = resolveSlipway(String(req.params.token || ""));
    if (!s) return res.status(404).type("html").send("<h1>No such Slipway session</h1>");
    res.type("html").send(PAGE);
  };
  app.get("/slipway/:token/", servePage);
  app.get("/slipway/:token/index.html", servePage);
  app.get("/slipway/:token", (req: any, res: any) => res.redirect(`/slipway/${req.params.token}/`));

  app.get("/slipway/:token/state", async (req: any, res: any) => {
    const s = resolveSlipway(String(req.params.token || ""));
    if (!s) return res.status(404).json({ error: "no such slipway session" });
    // ⚠️ The roster is read LIVE on every poll, not cached on the session. A
    // cached roster goes stale toward "the tab you want is still there", and
    // the holder then taps into a tab that was closed minutes ago.
    let tabs: SlipwayTab[] | null = null;
    if (s.state === "live") {
      try {
        tabs = await deps.listTabs(s);
      } catch {
        tabs = null; // null means "could not read", NOT "no tabs" — see the page.
      }
    }
    const view: any = slipwayPublicView(s, tabs);
    // ⭐ OPT-IN, because it costs an evaluate in the tab and the countdown poll
    // runs every couple of seconds. ⛔ NEVER FAILS THE POLL: the page's clock
    // and tab roster must not depend on a field probe.
    if (req.query?.fields !== undefined && s.state === "live" && deps.fields) {
      try {
        view.fields = await deps.fields(s);
      } catch (err: any) {
        view.fields = [];
        view.fieldsError = String(err?.message ?? err);
      }
    }
    res.json(view);
  });

  app.get("/slipway/:token/shot", async (req: any, res: any) => {
    const s = onTab(req, res);
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

  app.post("/slipway/:token/tap", async (req: any, res: any) => {
    const s = onTab(req, res);
    if (!s) return;
    const fx = Number(req.body?.fx), fy = Number(req.body?.fy);
    if (!Number.isFinite(fx) || !Number.isFinite(fy) || fx < 0 || fx > 1 || fy < 0 || fy > 1) {
      return res.status(400).json({ ok: false, error: "fx/fy must be 0..1" });
    }
    // ⛔ REFUSE an out-of-range hold rather than clamping it: a silently
    // shortened hold looks like a hold that did not work, and the operator
    // retries a thing that was never sent as asked.
    const rawHold = req.body?.holdMs;
    let holdMs: number | undefined;
    if (rawHold !== undefined && rawHold !== null) {
      const h = Number(rawHold);
      if (!Number.isFinite(h) || h < 0 || h > 20000) {
        return res.status(400).json({ ok: false, error: "holdMs must be 0..20000" });
      }
      holdMs = Math.round(h);
    }
    try {
      // ⛔ BEST EFFORT, AND NEVER FATAL — see the focusTab dep. Ported from the
      // captcha relay 2026-10-18: a press replayed into a window sitting behind
      // the operator's others does nothing and reads as a dead relay.
      let wasFocused: boolean | null = null;
      if (deps.focusTab) {
        try {
          const fr = await deps.focusTab(s);
          wasFocused = fr && typeof fr.wasFocused === "boolean" ? fr.wasFocused : null;
        } catch (err: any) {
          console.error(`[slipway] focusTab failed for ${s.id}: ${err?.message ?? err}`);
        }
      }
      const vp = await deps.viewport(s);
      const x = Math.round(fx * vp.width), y = Math.round(fy * vp.height);
      const started = Date.now();
      await deps.click(s, x, y, holdMs);
      console.log(
        `[slipway] tap ${s.id} (${x},${y}) holdMs=${holdMs ?? "-"} took=${Date.now() - started}ms ` +
          `windowWasFocused=${wasFocused === null ? "?" : wasFocused}`,
      );
      s.cursor = { x, y };
      s.taps++;
      res.json({ ok: true, x, y, holdMs: holdMs ?? null, taps: s.taps });
    } catch (err: any) {
      res.status(502).json({ ok: false, error: err.message });
    }
  });

  /**
   * `text` is BOTH the typing endpoint and the command channel — see the
   * header for why there is no fourth path. A body with `text` types; a body
   * with `cmd` performs that command. Unknown commands are REFUSED by name
   * rather than ignored, so a page/server version skew fails loudly.
   */
  app.post("/slipway/:token/text", async (req: any, res: any) => {
    const s = live(req, res);
    if (!s) return;
    const cmd = req.body?.cmd;

    if (typeof cmd === "string") {
      try {
        if (cmd === "select") {
          const raw = req.body?.tabTarget;
          if (raw === undefined || raw === null || raw === "") {
            return res.status(400).json({ ok: false, error: "select needs tabTarget" });
          }
          // ⛔ ONLY A TAB THIS BROWSER ACTUALLY HAS. Trusting the body would
          // let a holder name any tab id in the fleet, which is exactly the
          // bound the one-browser rule exists to keep.
          const tabs = await deps.listTabs(s);
          const want = String(raw);
          const hit = tabs.find((t) => String(t.tabTarget) === want);
          if (!hit) {
            return res.status(404).json({
              ok: false,
              error: `tab ${want} is not open in this browser`,
              available: tabs.map((t) => t.tabTarget),
            });
          }
          // ⭐ ATTACH ON SELECT. Most picks are now of a tab we are not driving
          // yet, because the roster spans the whole browser.
          // ⛔ Do NOT skip this and let the screenshot discover the problem: a
          // capture against an unattached tab fails with a message about the
          // debugger, which on a phone reads as the page being broken rather
          // than as one missing step.
          if (!hit.attached) {
            const tabId = await deps.attachTab(s, hit.tabTarget);
            s.tabTarget = tabId;
            persistSlipway();
            return res.json({ ok: true, tabTarget: s.tabTarget, justAttached: true });
          }
          s.tabTarget = hit.tabTarget;
          persistSlipway();
          return res.json({ ok: true, tabTarget: s.tabTarget, justAttached: false });
        }

        if (cmd === "attach") {
          const tabTarget = await deps.attachCurrent(s);
          s.tabTarget = tabTarget;
          persistSlipway();
          return res.json({ ok: true, tabTarget });
        }

        if (cmd === "scroll") {
          const t = onTab(req, res);
          if (!t) return;
          const y = Number(req.body?.y);
          if (!Number.isFinite(y) || Math.abs(y) > 20000) {
            return res.status(400).json({ ok: false, error: "y must be a number within ±20000" });
          }
          await deps.scroll(t, Math.round(y));
          return res.json({ ok: true, y: Math.round(y) });
        }

        if (cmd === "key") {
          const t = onTab(req, res);
          if (!t) return;
          const key = String(req.body?.key ?? "");
          // A short allowlist, not a free-text key name: this endpoint is
          // reachable by anyone holding the link, and the page only needs these.
          const allowed = new Set([
            "Enter", "Tab", "Escape", "Backspace", "Delete",
            "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End",
            "PageUp", "PageDown",
          ]);
          if (!allowed.has(key)) {
            return res.status(400).json({ ok: false, error: `key must be one of: ${[...allowed].join(", ")}` });
          }
          await deps.pressKey(t, key);
          return res.json({ ok: true, key });
        }

        // ⭐ WHOLE-VALUE WRITE. This is what makes delete, paste and a
        // mid-string edit work from a phone: the page is the source of truth
        // and the field is set to it, rather than the page streaming edits it
        // cannot keep in step.
        if (cmd === "value") {
          const t = onTab(req, res);
          if (!t) return;
          if (!deps.setValue) {
            return res.status(501).json({ ok: false, error: "this server cannot set a field value" });
          }
          const raw = req.body?.value;
          if (typeof raw !== "string") {
            return res.status(400).json({ ok: false, error: "value must be a string" });
          }
          if (raw.length > 2000) {
            return res.status(400).json({ ok: false, error: "value too long" });
          }
          const verdict = await deps.setValue(t, raw);
          t.typed++;
          // ⚠️ 200 WITH ok:false ON A BAD VERDICT: the request worked, the tab
          // had no field focused, and only the operator can fix that.
          return res.json({ ok: verdict === "OK", verdict, length: raw.length, typed: t.typed });
        }

        if (cmd === "record") {
          const t = onTab(req, res);
          if (!t) return;
          const on = req.body?.on === true;
          await deps.record(t, on);
          t.recording = on;
          return res.json({ ok: true, recording: on });
        }

        return res.status(400).json({ ok: false, error: `unknown cmd "${cmd}"` });
      } catch (err: any) {
        return res.status(502).json({ ok: false, error: err.message });
      }
    }

    const t = onTab(req, res);
    if (!t) return;
    const text = String(req.body?.text ?? "");
    if (!text) return res.status(400).json({ ok: false, error: "empty text" });
    if (text.length > 2000) return res.status(400).json({ ok: false, error: "text too long" });
    try {
      await deps.type(t, text);
      t.typed++;
      res.json({ ok: true, typed: t.typed });
    } catch (err: any) {
      res.status(502).json({ ok: false, error: err.message });
    }
  });

  app.post("/slipway/:token/done", async (req: any, res: any) => {
    const s = live(req, res);
    if (!s) return;
    s.state = "ended";
    s.endedAt = Date.now();
    persistSlipway();
    // ⚠️ A recording left running outlives the session that started it and
    // nothing else will stop it, so end it here. Best effort: failing to stop
    // a recording must not stop the session ending, or the holder is left with
    // a link they cannot close.
    if (s.recording) {
      try {
        await deps.record(s, false);
        s.recording = false;
      } catch (err: any) {
        console.error(`[slipway] could not stop recording for ${s.id}: ${err?.message ?? err}`);
      }
    }
    res.json(slipwayPublicView(s, null));
  });
}
