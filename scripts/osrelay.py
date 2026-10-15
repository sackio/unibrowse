#!/usr/bin/env python3
"""Phone-to-OS-input relay for the osdrive rig (display :97).

⭐ WHY THIS IS A HOST SCRIPT AND NOT PART OF mcp-server. The relay has to run
xdotool against an X display on THIS machine, and mcp-server runs in a
container: it cannot see /tmp/.X11-unix on the host and cannot drive :97. So the
page, the screenshot and the input all live here, and the ATC artifact proxies
straight to this process. Nothing to build, deploy or restart on the server.

⛔ THE TOKEN IN THE PATH IS THE CREDENTIAL — same model as the captcha relay.
Whoever holds the URL can move the mouse and press keys inside display :97
until the session expires. It is bound to that display and that TTL.

⛔ WHAT THIS REPLAYS IS A HUMAN'S OWN GESTURE. Ben asked for exactly this
(Slack #freelance 2026-10-12 18:28): "proxy my movement and click ... based on
what I do and drag". The page records his real pointer track with timestamps
and this replays it point for point. ⛔ It does not synthesise a gesture, and
an agent must not use it to answer a bot check on its own judgement.

⛔ PRESSURE IS NOT CARRIED, AND NOT FAKED. XTEST has no force channel. Chrome
reports pressure 0.5 for any mouse button that is down — real or synthetic —
which is already the correct value a real mouse produces (measured 2026-10-09:
XTEST 0.5, CDP 0). Mapping a phone's touch force onto a mouse pointer would
mean presenting a fake touchscreen to the browser.

Usage: osrelay.py [--display :97] [--port 9701] [--bind 192.168.1.199] [--ttl 1800]
Prints the LAN URL and the token on startup.
"""
import argparse, json, os, re, secrets, subprocess, threading, time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ap = argparse.ArgumentParser()
ap.add_argument("--display", default=os.environ.get("OSDRIVE_DISPLAY", ":97"))
ap.add_argument("--port", type=int, default=9701)
ap.add_argument("--bind", default="192.168.1.199")
ap.add_argument("--ttl", type=int, default=1800)
ap.add_argument("--prompt", default="Drive the browser on office display :97")
# ⛔ WITHOUT THIS, PRESSING "Done" TELLS NOBODY. Until 2026-10-15 /done only set
# local state and printed a line, so the agent waiting on the solve learned
# nothing — measured that day: Ben solved an eBay hCaptcha, pressed Done, and I
# found out because I was diffing screenshots, then because he asked. The
# captcha relay DMs on solve; this script predates it and did not.
# ⚠️ The notify is best-effort BY DESIGN and its result is reported in the
# response: a failed DM must not make a solved captcha look unsolved.
ap.add_argument("--notify", default=os.environ.get("OSRELAY_NOTIFY", ""),
                help="ATC subscriber to DM when the operator presses Done")
ap.add_argument("--broker", default=os.environ.get("ATC_URL", "http://192.168.1.168:3030"))
A = ap.parse_args()


def notify_done(note: str) -> bool:
    """DM the owning seat that the human finished. Never raises."""
    if not A.notify:
        return False
    body = f"osrelay: operator pressed Done on display {A.display}."
    if note:
        body += f" Note: {note}"
    try:
        req = urllib.request.Request(
            A.broker.rstrip("/") + "/messages",
            data=json.dumps({"to": A.notify, "from": "osrelay",
                             "subject": "osrelay: Done pressed",
                             "content": body}).encode(),
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=6) as r:
            r.read()
        print(f"[osrelay] notified {A.notify}", flush=True)
        return True
    except Exception as e:
        print(f"[osrelay] notify FAILED: {e}", flush=True)
        return False

# ⭐ REUSING A TOKEN IS WHAT KEEPS A PUBLISHED LINK ALIVE ACROSS A RESTART.
# The ATC artifact proxies to /r/<token>/, so a fresh token silently 404s the
# page the operator is already holding — and from his side that is
# indistinguishable from the relay being down. Passed in the ENVIRONMENT, not
# in argv, so it does not sit in `ps` output for every local account to read.
TOKEN = os.environ.get("OSRELAY_TOKEN") or secrets.token_hex(16)
if not re.fullmatch(r"[0-9a-f]{32}", TOKEN):
    raise SystemExit("OSRELAY_TOKEN must be 32 lowercase hex characters")
STATE = {"state": "pending", "expires": time.time() + A.ttl, "taps": 0, "typed": 0,
         "points": 0, "note": None, "replaying": False}
LOCK = threading.Lock()          # one gesture at a time; XTEST has one pointer


def xrun(args, **kw):
    return subprocess.run(["xdotool", *args],
                          env={**os.environ, "DISPLAY": A.display},
                          capture_output=True, timeout=30, **kw)


def screen_size():
    # ⛔ Read it every time rather than caching: the Xephyr screen can be
    # resized, and a stale size silently scales every tap to the wrong place.
    out = xrun(["getdisplaygeometry"]).stdout.decode().split()
    return (int(out[0]), int(out[1])) if len(out) == 2 else (1920, 1080)


def shot_png():
    p = subprocess.run(["import", "-window", "root", "png:-"],
                       env={**os.environ, "DISPLAY": A.display},
                       capture_output=True, timeout=30)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode()[:200] or "import failed")
    return p.stdout


def pointer_xy():
    out = xrun(["getmouselocation", "--shell"]).stdout.decode()
    mx, my = re.search(r"X=(\d+)", out), re.search(r"Y=(\d+)", out)
    return (int(mx.group(1)) if mx else 0, int(my.group(1)) if my else 0)


def shot_jpeg(width=760, zoom=False, quality=50):
    """A SMALL JPEG for the live view, because the PNG cannot carry one.

    Ben asked to watch the press land in real time (#freelance 2026-10-12
    23:23: "I really should be able to see in real time the press animation
    that is coming back"), and he watches it on a phone over cellular. Measured
    on :97 the same evening: the root PNG is 106KB and 0.30s, a full screen
    640px wide at q55 is 18KB and 0.25s, and a 560x420 crop centred on the
    pointer is 29KB and 0.10s. ⇒ ZOOM IS THE CHEAPEST AND THE MOST USEFUL
    FRAME, because during a replay the pointer is exactly on the button he is
    pressing. /shot keeps serving the real pixels for anyone who wants them.
    """
    args = ["-window", "root"]
    if zoom:
        w, h = screen_size()
        px, py = pointer_xy()
        cw, ch = min(560, w), min(420, h)
        cx = max(0, min(w - cw, px - cw // 2))
        cy = max(0, min(h - ch, py - ch // 2))
        args += ["-crop", f"{cw}x{ch}+{cx}+{cy}", "+repage"]
    else:
        args += ["-resize", f"{max(240, min(1600, width))}x>"]
    args += ["-quality", str(max(20, min(90, quality))), "jpg:-"]
    p = subprocess.run(["import", *args],
                       env={**os.environ, "DISPLAY": A.display},
                       capture_output=True, timeout=30)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode()[:200] or "import failed")
    return p.stdout


def replay(path, fx, fy, hold_ms):
    # ⭐ The flag is what lets the PAGE know a press is live without guessing
    # from its own in-flight fetch: a reload mid-replay would otherwise show a
    # slow static view during the one moment that matters.
    STATE["replaying"] = True
    try:
        return _replay(path, fx, fy, hold_ms)
    finally:
        STATE["replaying"] = False


def _replay(path, fx, fy, hold_ms):
    """Replay the operator's gesture. `path` wins when present; fx/fy+hold is
    the fallback for a plain tap, so an older page still works."""
    w, h = screen_size()
    with LOCK:
        if path:
            # ⚠️ Timed against the ORIGINAL gesture's clock, not a fixed step:
            # the shape of a hold is in its timing, and resampling it evenly
            # would hand the page a machine's rhythm back.
            t0 = time.time()
            down = False
            for pt in path[:4000]:
                due = t0 + float(pt.get("ms", 0)) / 1000.0
                d = due - time.time()
                if d > 0:
                    time.sleep(min(d, 20))
                x = max(0, min(w - 1, int(float(pt["fx"]) * w)))
                y = max(0, min(h - 1, int(float(pt["fy"]) * h)))
                xrun(["mousemove", str(x), str(y)])
                want = pt.get("down")
                if want and not down:
                    xrun(["mousedown", "1"]); down = True
                elif want is False and down:
                    xrun(["mouseup", "1"]); down = False
            if down:
                xrun(["mouseup", "1"])
            return {"replayed": len(path[:4000])}
        x = max(0, min(w - 1, int(fx * w)))
        y = max(0, min(h - 1, int(fy * h)))
        # Eased approach so a bare tap still arrives like a hand, not a jump.
        cur = xrun(["getmouselocation", "--shell"]).stdout.decode()
        cx = int(re.search(r"X=(\d+)", cur).group(1)) if "X=" in cur else x
        cy = int(re.search(r"Y=(\d+)", cur).group(1)) if "Y=" in cur else y
        steps = 14
        for i in range(1, steps + 1):
            t = i / steps
            e = 2 * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 2 / 2
            xrun(["mousemove", str(int(cx + (x - cx) * e)), str(int(cy + (y - cy) * e))])
            time.sleep(0.016)
        xrun(["mousemove", str(x), str(y)])
        xrun(["mousedown", "1"])
        if hold_ms and hold_ms > 0:
            end = time.time() + hold_ms / 1000.0
            while time.time() < end:
                xrun(["mousemove_relative", "--", str(secrets.choice([-1, 0, 1])),
                      str(secrets.choice([-1, 0, 1]))])
                time.sleep(0.03)
            xrun(["mousemove", str(x), str(y)])
        else:
            time.sleep(0.05 + secrets.randbelow(60) / 1000.0)
        xrun(["mouseup", "1"])
        return {"x": x, "y": y, "holdMs": hold_ms}


PAGE = r"""<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Drive office :97</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#15171b; color:#e8eaed; font:15px/1.4 -apple-system,system-ui,sans-serif; }
  header { padding:12px 14px 8px; } h1 { font-size:16px; margin:0 0 4px; }
  .sub { font-size:12px; color:#9aa0aa; }
  #wrap { position:relative; padding:8px 10px 10px; overflow:hidden; }
  /* Same four properties as the captcha page, for the same measured reason:
     without them a long press on a real phone becomes a selection or a scroll
     and the release is lost. */
  #shot { width:100%; display:block; border-radius:8px; border:1px solid #2b2f37;
          touch-action:none; -webkit-touch-callout:none; -webkit-user-select:none; user-select:none;
          transform-origin:0 0; will-change:transform; }
  /* ⭐ A 1920px desktop squeezed to a phone's width makes a 48px checkbox ~10px
     wide, which is smaller than a fingertip can aim at — measured against
     eBay's hCaptcha box on 2026-10-15, where Ben could not land a tap at all.
     Hence the two-finger pinch below. ⛔ Page zoom is NOT the fix: iOS Safari
     ignores user-scalable=no, and its own zoom moves the picture out from under
     the coordinate mapping, so a tap then lands somewhere else on the desktop. */
  body { overscroll-behavior:none; }
  #badge { position:absolute; top:14px; right:16px; padding:3px 8px; border-radius:6px;
           background:rgba(10,12,15,.72); color:#4ade80; font-size:11px; font-weight:600;
           pointer-events:none; opacity:0; transition:opacity .3s; }
  #dot { position:absolute; width:26px; height:26px; margin:-13px 0 0 -13px; border:2px solid #4ade80;
         border-radius:50%; pointer-events:none; opacity:0; transition:opacity .4s; }
  .bar { display:flex; gap:8px; padding:0 10px 12px; }
  button { flex:1; padding:13px; font-size:15px; font-weight:600; border:0; border-radius:8px;
           background:#2b2f37; color:#e8eaed; } button.go { background:#2563eb; color:#fff; }
  button:disabled { opacity:.45; }
  input { width:100%; padding:12px; font-size:16px; border-radius:8px; border:1px solid #2b2f37;
          background:#1d2026; color:#e8eaed; } .row { padding:0 10px 10px; }
  #status { padding:10px 14px; font-size:13px; color:#9aa0aa; min-height:1.4em; }
  .hint { font-size:12px; color:#6b7280; padding:0 14px 16px; }
</style></head><body>
<div id="app">
<header><h1 id="prompt">Loading…</h1><div class="sub"><span id="left"></span></div></header>
<div id="wrap"><img id="shot" alt="screen"><div id="dot"></div><div id="badge"></div></div>
<div class="row"><input id="txt" placeholder="Type here to send keys" autocomplete="off"></div>
<div class="bar"><button id="pause" style="flex:0 0 auto">Pause</button><button id="zreset" style="flex:0 0 auto">1:1</button><button id="send">Send text</button><button id="done" class="go">Done</button></div>
<div id="status">Touch the picture and it moves the real mouse on office.</div>
<div class="hint">The picture is live. While your press is being replayed it zooms in on the
pointer, so you watch the button fill as it happens. Your whole gesture is replayed — the path you
take, how long you hold, and drags.
Pressure is not sent: a mouse always reports the same pressure, so there is nothing to vary.</div>
</div>
<script>
var busy=false, stopped=false, live=true, fails=0;
function s(t){document.getElementById('status').textContent=t;}
function badge(t){ var b=document.getElementById('badge'); b.textContent=t||''; b.style.opacity=t?1:0; }
// ⭐ CHAINED, NOT setInterval. Each frame is requested only once the previous
// one has arrived, so a slow link slows the frame rate instead of queueing
// requests the phone will never render — and during a replay the gap is zero,
// which on the measured numbers (29KB, 0.10s a frame) is ~6fps of the press.
var gen=0, hot=0;
function frame(){ if(stopped) return; var my=++gen;
  if(!live && !busy && Date.now()>hot){ badge(''); return setTimeout(function(){ if(my===gen) frame(); },600); }
  var img=document.getElementById('shot'), p=new Image(), t=Date.now(), z=busy;
  p.onload=function(){ if(my!==gen) return; img.src=p.src; fails=0;
    badge(z?'\u25cf live \u00b7 zoomed on the press':'\u25cf live');
    var gap = busy?0:(Date.now()<hot?250:700);
    setTimeout(function(){ if(my===gen) frame(); }, Math.max(0,gap-(Date.now()-t))); };
  p.onerror=function(){ if(my!==gen) return; fails++; badge('');
    if(fails===1){ fetch('live?t='+Date.now()).then(function(r){return r.json();})
      .then(function(j){s('Live view unavailable: '+((j&&j.error)||'unknown')+' — the browser may still be fine.');})
      .catch(function(){s('Live view unavailable and the reason could not be read.');}); }
    setTimeout(function(){ if(my===gen) frame(); },1500); };
  p.src='live?z='+(z?1:0)+'&t='+Date.now(); }
function shot(){ frame(); }
function poll(){ fetch('state').then(function(r){return r.json();}).then(function(j){
  document.getElementById('prompt').textContent=j.prompt;
  document.getElementById('left').textContent = j.state==='pending'
    ? (j.secondsRemaining+'s left · '+j.taps+' gestures sent') : j.state;
  if(j.state!=='pending'){ stopped=true; document.getElementById('app').innerHTML=
    '<div style="text-align:center;padding:48px 20px"><h2>'+(j.state==='done'?'Finished':'Expired')+
    '</h2><div class="sub">You can close this page.</div></div>'; }}).catch(function(){}); }

// ⭐ THE WHOLE TRACK, NOT JUST THE ENDPOINTS. Ben asked for his movement to be
// proxied, so every pointermove is recorded with the ms offset it happened at
// and replayed against that same clock on the other side.
var track=null, t0=0;
function rel(e){ var r=document.getElementById('shot').getBoundingClientRect();
  return {fx:(e.clientX-r.left)/r.width, fy:(e.clientY-r.top)/r.height}; }
document.addEventListener('pointerdown', function(e){
  if(e.target.id!=='shot'||busy||stopped) return;
  t0=Date.now(); var p=rel(e); track=[{fx:p.fx,fy:p.fy,ms:0,down:true}];
  var d=document.getElementById('dot'), r=document.getElementById('shot').getBoundingClientRect();
  d.style.left=(e.clientX-r.left+10)+'px'; d.style.top=(e.clientY-r.top+10)+'px'; d.style.opacity=1;
  s('Recording your gesture…'); e.preventDefault(); }, {passive:false});
document.addEventListener('pointermove', function(e){
  if(!track||busy||stopped) return; var p=rel(e);
  if(track.length<4000) track.push({fx:p.fx,fy:p.fy,ms:Date.now()-t0,down:true});
  s('Holding '+((Date.now()-t0)/1000).toFixed(1)+'s'); e.preventDefault(); }, {passive:false});
function end(e){ if(!track||busy||stopped) return; var pts=track; track=null;
  var p=pts[pts.length-1]; pts.push({fx:p.fx,fy:p.fy,ms:Date.now()-t0,down:false});
  busy=true; document.getElementById('done').disabled=true; frame();
  var held=Date.now()-t0;
  // The replay takes as long as the gesture did, so say so rather than freezing.
  var ends=Date.now()+held, tick=setInterval(function(){
    var l=Math.max(0,ends-Date.now())/1000;
    s(l>0.05?('Replaying on office — '+l.toFixed(1)+'s to go.'):'Replay finishing…'); },100);
  fetch('tap',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({path:pts})}).then(function(r){return r.json();})
   .then(function(j){ s(j.ok?('Sent — '+(j.replayed||1)+' points, '+(held/1000).toFixed(1)+'s.')
                           :('Refused: '+(j.error||'unknown'))); })
   .catch(function(){ s('Failed to send.'); })
   .then(function(){ clearInterval(tick); document.getElementById('dot').style.opacity=0;
     document.getElementById('done').disabled=false; busy=false;
     // Stay fast for a few seconds: the thing he is waiting to see is what the
     // page does AFTER the button is released.
     hot=Date.now()+5000; }); }
// ── PINCH TO ZOOM ─────────────────────────────────────────────────────────
// ⭐ Two fingers zoom and pan the PICTURE; one finger still means "replay this
// gesture on the real desktop". Keeping those on different finger counts is
// what lets a 10px target be tapped without inventing a second mode to be in.
// ⭐ THE COORDINATE MAPPING NEEDS NO CHANGE AND THAT IS DELIBERATE: rel() reads
// getBoundingClientRect(), which reports the TRANSFORMED box, so a tap is still
// the same fraction of the image however it is scaled or panned.
var z=1, px=0, py=0, pinch=null;
function applyT(){ var el=document.getElementById('shot');
  el.style.transform='translate('+px+'px,'+py+'px) scale('+z+')'; }
function dist(t){ var dx=t[0].clientX-t[1].clientX, dy=t[0].clientY-t[1].clientY;
  return Math.hypot(dx,dy); }
function mid(t){ return {x:(t[0].clientX+t[1].clientX)/2, y:(t[0].clientY+t[1].clientY)/2}; }
document.addEventListener('touchstart', function(e){
  if(e.touches.length!==2) return;
  // A second finger means the one-finger gesture that just started was aiming,
  // not pressing — drop it rather than replaying a stray tap on the desktop.
  track=null; document.getElementById('dot').style.opacity=0;
  pinch={d:dist(e.touches), m:mid(e.touches)}; e.preventDefault();
  s('Pinch to zoom — one finger still taps.'); }, {passive:false});
document.addEventListener('touchmove', function(e){
  if(!pinch||e.touches.length!==2) return;
  var d=dist(e.touches), m=mid(e.touches), nz=Math.min(8,Math.max(1,z*(d/(pinch.d||1)))), r=nz/z;
  // Anchored zoom: the image point under the old midpoint stays under the new
  // one. screen = p + z*img, so p1 = m1 - r*(m0 - p0). Panning falls out of it
  // for free — moving two fingers without spreading them is r=1.
  px = m.x - r*(pinch.m.x - px);
  py = m.y - r*(pinch.m.y - py);
  z=nz; pinch={d:d,m:m}; applyT(); e.preventDefault(); }, {passive:false});
document.addEventListener('touchend', function(e){ if(e.touches.length<2) pinch=null; });
document.addEventListener('touchcancel', function(){ pinch=null; });
// iOS Safari ignores user-scalable=no and zooms the PAGE on pinch and on
// double-tap, which breaks the mapping. These three events are how it asks.
['gesturestart','gesturechange','gestureend'].forEach(function(n){
  document.addEventListener(n, function(e){ e.preventDefault(); }, {passive:false}); });
document.addEventListener('dblclick', function(e){ e.preventDefault(); }, {passive:false});
document.getElementById('zreset').onclick=function(){ z=1; px=0; py=0; applyT(); s('Zoom reset.'); };

document.addEventListener('pointerup', end);
document.addEventListener('pointercancel', end);
window.addEventListener('blur', end);
document.addEventListener('contextmenu', function(e){ if(e.target.id==='shot') e.preventDefault(); });
document.getElementById('pause').onclick=function(){ live=!live;
  this.textContent = live?'Pause':'Live'; s(live?'Live view on.':'Live view paused — it still goes live while a press replays.');
  if(live) frame(); };
document.getElementById('send').onclick=function(){ var v=document.getElementById('txt').value; if(!v) return;
  fetch('text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:v})})
    .then(function(){document.getElementById('txt').value=''; s('Keys sent.'); setTimeout(shot,500);}); };
document.getElementById('done').onclick=function(){
  if(busy){ s('Your gesture is still being replayed — wait for it to finish.'); return; }
  fetch('done',{method:'POST'}).then(poll); };
frame(); poll(); setInterval(poll,3000);
</script></body></html>"""


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):
        print(f"[osrelay] {self.address_string()} {fmt % a}", flush=True)

    def _tok(self):
        m = re.match(rf"^/r/{TOKEN}(/.*)?$", self.path.split("?")[0])
        return m.group(1) or "/" if m else None

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _live(self):
        if STATE["state"] == "pending" and time.time() > STATE["expires"]:
            STATE["state"] = "expired"
        return STATE["state"] == "pending"

    def do_GET(self):
        leaf = self._tok()
        if leaf is None:
            return self._json(404, {"error": "no such session"})
        if leaf in ("/", "/index.html"):
            b = PAGE.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            return self.wfile.write(b)
        if leaf == "/state":
            self._live()
            return self._json(200, {"prompt": A.prompt, "state": STATE["state"],
                                    "taps": STATE["taps"], "typed": STATE["typed"],
                                    "points": STATE["points"],
                                    "replaying": STATE["replaying"],
                                    "secondsRemaining": max(0, int(STATE["expires"] - time.time()))})
        if leaf == "/live":
            if not self._live():
                return self._json(410, {"error": f"session is {STATE['state']}"})
            q = parse_qs(urlparse(self.path).query)
            zoom = q.get("z", ["0"])[0] not in ("0", "", "false")
            try:
                w = int(q.get("w", ["760"])[0])
            except Exception:
                w = 760
            try:
                jpg = shot_jpeg(width=w, zoom=zoom)
            except Exception as e:
                return self._json(502, {"error": f"screenshot failed: {e}"})
            px, py = pointer_xy()
            sw, sh = screen_size()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Pointer", f"{px},{py}")
            self.send_header("X-Screen", f"{sw}x{sh}")
            self.send_header("X-Zoom", "1" if zoom else "0")
            self.send_header("X-Replaying", "1" if STATE["replaying"] else "0")
            self.send_header("Content-Length", str(len(jpg)))
            self.end_headers()
            return self.wfile.write(jpg)
        if leaf == "/shot":
            if not self._live():
                return self._json(410, {"error": f"session is {STATE['state']}"})
            try:
                png = shot_png()
            except Exception as e:
                return self._json(502, {"error": f"screenshot failed: {e}"})
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(png)))
            self.end_headers()
            return self.wfile.write(png)
        return self._json(404, {"error": "no such path"})

    def do_POST(self):
        leaf = self._tok()
        if leaf is None:
            return self._json(404, {"error": "no such session"})
        if not self._live():
            return self._json(410, {"error": f"session is {STATE['state']}"})
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            body = {}
        if leaf == "/tap":
            path = body.get("path") or []
            try:
                r = replay(path, float(body.get("fx", 0.5)), float(body.get("fy", 0.5)),
                           int(body.get("holdMs") or 0))
            except Exception as e:
                return self._json(502, {"ok": False, "error": str(e)[:200]})
            STATE["taps"] += 1
            STATE["points"] += len(path)
            print(f"[osrelay] gesture {STATE['taps']}: {r}", flush=True)
            return self._json(200, {"ok": True, **r})
        if leaf == "/text":
            t = str(body.get("text") or "")[:500]
            if not t:
                return self._json(400, {"ok": False, "error": "empty"})
            with LOCK:
                xrun(["type", "--clearmodifiers", "--delay", "90", "--", t])
            STATE["typed"] += 1
            return self._json(200, {"ok": True})
        if leaf == "/done":
            STATE["state"] = "done"
            STATE["note"] = str(body.get("note") or "")[:500] or None
            print("[osrelay] operator pressed Done", flush=True)
            notified = notify_done(STATE["note"] or "")
            return self._json(200, {"state": STATE["state"], "notified": notified})
        return self._json(404, {"error": "no such path"})


if __name__ == "__main__":
    srv = ThreadingHTTPServer((A.bind, A.port), H)
    print(f"[osrelay] display={A.display} url=http://{A.bind}:{A.port}/r/{TOKEN}/ "
          f"ttl={A.ttl}s", flush=True)
    srv.serve_forever()
