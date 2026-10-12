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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ap = argparse.ArgumentParser()
ap.add_argument("--display", default=os.environ.get("OSDRIVE_DISPLAY", ":97"))
ap.add_argument("--port", type=int, default=9701)
ap.add_argument("--bind", default="192.168.1.199")
ap.add_argument("--ttl", type=int, default=1800)
ap.add_argument("--prompt", default="Drive the browser on office display :97")
A = ap.parse_args()

TOKEN = secrets.token_hex(16)
STATE = {"state": "pending", "expires": time.time() + A.ttl, "taps": 0, "typed": 0,
         "points": 0, "note": None}
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


def replay(path, fx, fy, hold_ms):
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
  #wrap { position:relative; padding:8px 10px 10px; }
  /* Same four properties as the captcha page, for the same measured reason:
     without them a long press on a real phone becomes a selection or a scroll
     and the release is lost. */
  #shot { width:100%; display:block; border-radius:8px; border:1px solid #2b2f37;
          touch-action:none; -webkit-touch-callout:none; -webkit-user-select:none; user-select:none; }
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
<div id="wrap"><img id="shot" alt="screen"><div id="dot"></div></div>
<div class="row"><input id="txt" placeholder="Type here to send keys" autocomplete="off"></div>
<div class="bar"><button id="send">Send text</button><button id="done" class="go">Done</button></div>
<div id="status">Touch the picture and it moves the real mouse on office.</div>
<div class="hint">Your whole gesture is replayed — the path you take, how long you hold, and drags.
Pressure is not sent: a mouse always reports the same pressure, so there is nothing to vary.</div>
</div>
<script>
var busy=false, stopped=false;
function s(t){document.getElementById('status').textContent=t;}
function shot(){ if(stopped) return; var img=document.getElementById('shot'), p=new Image();
  p.onload=function(){img.src=p.src;};
  p.onerror=function(){ fetch('shot?t='+Date.now()).then(function(r){return r.json();})
    .then(function(j){s('Picture unavailable: '+((j&&j.error)||'unknown')+' — the browser may still be fine.');})
    .catch(function(){s('Picture unavailable and the reason could not be read.');}); };
  p.src='shot?t='+Date.now(); }
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
  busy=true; document.getElementById('done').disabled=true;
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
     document.getElementById('done').disabled=false; busy=false; setTimeout(shot,500); }); }
document.addEventListener('pointerup', end);
document.addEventListener('pointercancel', end);
window.addEventListener('blur', end);
document.addEventListener('contextmenu', function(e){ if(e.target.id==='shot') e.preventDefault(); });
document.getElementById('send').onclick=function(){ var v=document.getElementById('txt').value; if(!v) return;
  fetch('text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:v})})
    .then(function(){document.getElementById('txt').value=''; s('Keys sent.'); setTimeout(shot,500);}); };
document.getElementById('done').onclick=function(){
  if(busy){ s('Your gesture is still being replayed — wait for it to finish.'); return; }
  fetch('done',{method:'POST'}).then(poll); };
shot(); poll(); setInterval(function(){ if(!busy) shot(); },2500); setInterval(poll,3000);
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
                                    "secondsRemaining": max(0, int(STATE["expires"] - time.time()))})
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
            return self._json(200, {"state": STATE["state"]})
        return self._json(404, {"error": "no such path"})


if __name__ == "__main__":
    srv = ThreadingHTTPServer((A.bind, A.port), H)
    print(f"[osrelay] display={A.display} url=http://{A.bind}:{A.port}/r/{TOKEN}/ "
          f"ttl={A.ttl}s", flush=True)
    srv.serve_forever()
