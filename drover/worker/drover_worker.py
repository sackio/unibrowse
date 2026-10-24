#!/usr/bin/env python3
"""Drover worker: one disposable browser, driven without an extension.

Ben, #unibrowse-v2 2026-10-24: v2 is "a lighter, better, faster automated
driver", a headless swarm on k8s with reliable human mode, fast on small
workers. This file is that driver, for one pod.

  · Xvfb + BRANDED google-chrome. Branded Chrome refuses --load-extension
    (chromium-host/Dockerfile.chrome), which is why v1 runs Chrome for Testing
    and reports a Chromium brand. With no extension, Drover is free to run the
    real thing.
  · CDP over --remote-debugging-pipe (fd 3/4). No TCP port, no
    DevToolsActivePort file, nothing another process can attach to.
  · ⛔ Runtime.enable and Console.enable are NEVER sent. They are the leak the
    stealth projects close (patchright, rebrowser; scout survey 2026-10-24):
    with them on, console arguments get serialized for the client and a page can
    notice. All page reads go through an isolated world, which shares the DOM
    and not the page's globals.
  · Input is XTEST through xdotool on the local display, with motion from
    scripts/humanmotion.py: the same model v1's realinput.py uses.
  · The profile is a fresh temp dir per run and is deleted afterwards. A worker
    keeps nothing, so losing a node loses nothing. The exception is
    DROVER_PROFILE: a directory kept across runs, for an account that must stay
    logged in (one account, one profile, one browser at a time).

  drover_worker.py probe --url http://host:8765/probe.html?label=x [--out f.json]
  drover_worker.py visit --url https://… --wait 20 [--shot f.png]

Stdlib only. Python 3.10+.
"""
import argparse, base64, json, math, os, random, shutil, signal, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
for p in (os.path.join(HERE, "..", "..", "scripts"), "/opt/drover/scripts"):
    if os.path.exists(os.path.join(p, "humanmotion.py")):
        sys.path.insert(0, os.path.abspath(p))
        break
import humanmotion as hm

CHROME = os.environ.get("DROVER_CHROME", "/usr/bin/google-chrome")
SCREEN = os.environ.get("DROVER_SCREEN", "1920x1080")
DISPLAY = os.environ.get("DROVER_DISPLAY", ":99")
# ⛔ Without a backend flag, WebGL is null under Xvfb and nothing errors
# (chromium-host/Dockerfile.chrome, measured 2026-10-15). Mesa llvmpipe over
# EGL: software, no GPU, and rebrowser reads it all green where SwiftShader is
# 🟡 headless/WebGL; on the 80-site panel it scored 53/80 vs SwiftShader 50/80,
# within noise (k8s/panel-variants-job.yaml, 2026-10-24).
EXTRA = os.environ.get("DROVER_CHROME_ARGS", "--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist").split()
CFG = hm.MotionConfig()


# ---------------------------------------------------------------- display ---
def start_display():
    if subprocess.run(["xdpyinfo", "-display", DISPLAY], capture_output=True).returncode == 0:
        return None                                    # someone else's display; leave it
    w, h = SCREEN.split("x")
    xvfb = subprocess.Popen(["Xvfb", DISPLAY, "-screen", "0", f"{w}x{h}x24", "-nolisten", "tcp"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        if subprocess.run(["xdpyinfo", "-display", DISPLAY], capture_output=True).returncode == 0:
            return xvfb
        time.sleep(0.1)
    raise SystemExit("Xvfb did not come up on " + DISPLAY)


def start_audio():
    """A PulseAudio daemon with a null sink, so the page sees an audio output
    device. With none, enumerateDevices() returns zero devices, which CreepJS
    reports as "devices (0)" and no desktop does (bench, 2026-10-24).
    Off with DROVER_AUDIO=0."""
    if os.environ.get("DROVER_AUDIO", "1") == "0" or not shutil.which("pulseaudio"):
        return None
    p = subprocess.Popen(["pulseaudio", "--daemonize=no", "--exit-idle-time=-1", "--disallow-exit",
                          "-n", "--load=module-null-sink sink_name=out",
                          "--load=module-native-protocol-unix"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.5)
    return p


def start_proxy_forwarder():
    """Chrome drops credentials from --proxy-server, and a vpn-proxy lease URL
    carries a password (skill vpn-proxy). Answering the auth challenge over
    CDP would mean Fetch.enable, request interception a page can feel. So the
    worker runs a local forwarder on 127.0.0.1 that adds Proxy-Authorization
    and relays bytes, and Chrome points at that. Returns Chrome's proxy URL."""
    import socket, socketserver
    from urllib.parse import urlsplit
    up = urlsplit(os.environ["DROVER_PROXY"])
    if not up.username:
        return os.environ["DROVER_PROXY"]
    auth = "Basic " + base64.b64encode(f"{up.username}:{up.password}".encode()).decode()

    def pump(a, b):
        try:
            while (d := a.recv(65536)):
                b.sendall(d)
        except OSError:
            pass
        finally:
            for s in (a, b):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    class H(socketserver.BaseRequestHandler):
        def handle(self):
            c = self.request
            head = b""
            while b"\r\n\r\n" not in head:
                d = c.recv(65536)
                if not d:
                    return
                head += d
            top, rest = head.split(b"\r\n\r\n", 1)
            lines = top.split(b"\r\n")
            lines = [lines[0]] + [l for l in lines[1:] if not l.lower().startswith(b"proxy-authorization:")]
            lines.append(b"Proxy-Authorization: " + auth.encode())
            u = socket.create_connection((up.hostname, up.port or 3128), timeout=30)
            u.settimeout(None)
            u.sendall(b"\r\n".join(lines) + b"\r\n\r\n" + rest)
            t = threading.Thread(target=pump, args=(u, c), daemon=True)
            t.start()
            pump(c, u)
            t.join()

    class S(socketserver.ThreadingTCPServer):
        daemon_threads = allow_reuse_address = True

    srv = S(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_address[1]}"


LANGS = {"US": "en-US", "GB": "en-GB", "CA": "en-CA", "AU": "en-AU", "IE": "en-IE",
         "NL": "nl-NL", "DE": "de-DE", "FR": "fr-FR", "ES": "es-ES", "IT": "it-IT"}


def identity():
    """Make the browser agree with its exit IP, as BrowserScan/pixelscan and
    CreepJS grade it: timezone, language and geolocation all from wherever the
    traffic actually leaves. Ben, #unibrowse-v2 2026-10-24: "location to mirror
    a random location near where our VPN IP exit says it is".

    The lookup goes through DROVER_PROXY when one is set, the same exit Chrome
    will use, so the answer describes the browser's IP and not the pod's.
    ⚠️ A failed lookup returns None and the browser keeps the image defaults
    (America/New_York, en-US); the result records which happened."""
    import urllib.request
    proxy = os.environ.get("DROVER_PROXY")
    opener = urllib.request.build_opener(*([urllib.request.ProxyHandler({"http": proxy, "https": proxy})] if proxy else []))
    try:
        d = json.load(opener.open("http://ip-api.com/json/?fields=status,query,countryCode,city,lat,lon,timezone,isp,proxy,hosting", timeout=8))
    except Exception as e:
        return {"ok": False, "err": str(e)}
    if d.get("status") != "success":
        return {"ok": False, "err": d}
    # A random point within ~3 km of the exit's city centre, at a wifi-grade
    # accuracy: a desktop has no GPS, so a 5 m fix would itself be odd.
    r, a = 3000 * random.random() ** 0.5, random.uniform(0, 6.283)
    lat = d["lat"] + (r * math.cos(a)) / 111320
    lon = d["lon"] + (r * math.sin(a)) / (111320 * max(0.2, math.cos(math.radians(d["lat"]))))
    return {"ok": True, "ip": d["query"], "country": d["countryCode"], "city": d["city"], "tz": d["timezone"],
            "isp": d.get("isp"), "listedProxy": d.get("proxy"), "listedHosting": d.get("hosting"),
            "lang": LANGS.get(d["countryCode"], "en-US"),
            "geo": {"latitude": round(lat, 6), "longitude": round(lon, 6), "accuracy": random.randint(25, 120)}}


def on_screen(x, y):
    """Clamp a path point to the display. ⛔ A path that bows or overshoots
    past an edge yields a negative coordinate, and xdotool parses "-3" as an
    OPTION and prints its usage instead of moving (measured 2026-10-24: the
    probe died with "-w, --window <windowid>" on one run in three)."""
    w, h = (int(v) for v in SCREEN.split("x"))
    return str(min(max(int(x), 0), w - 1)), str(min(max(int(y), 0), h - 1))


def xdo(*chain):
    p = subprocess.run(["xdotool", *chain], capture_output=True, text=True, timeout=120,
                       env={**os.environ, "DISPLAY": DISPLAY})
    if p.returncode != 0:
        raise RuntimeError(f"xdotool {chain[:2]} failed: {p.stderr.strip()}")
    return p.stdout.strip()


# -------------------------------------------------------------------- CDP ---
class Pipe:
    """CDP over the debugging pipe: NUL-terminated JSON, fd 3 in, fd 4 out."""

    def __init__(self, wfd, rfd):
        self.w, self.r = os.fdopen(wfd, "wb", buffering=0), os.fdopen(rfd, "rb", buffering=0)
        self.n, self.pending, self.lock = 0, {}, threading.Lock()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        buf = b""
        while True:
            chunk = self.r.read(65536)
            if not chunk:
                for ev in self.pending.values():
                    ev.set()
                return
            buf += chunk
            while b"\0" in buf:
                raw, buf = buf.split(b"\0", 1)
                msg = json.loads(raw)
                slot = self.pending.get(msg.get("id"))
                if slot is not None:
                    slot.msg = msg
                    slot.set()

    def call(self, method, params=None, session=None, timeout=30):
        with self.lock:
            self.n += 1
            mid = self.n
        ev = threading.Event()
        ev.msg = None
        self.pending[mid] = ev
        m = {"id": mid, "method": method, "params": params or {}}
        if session:
            m["sessionId"] = session
        self.w.write(json.dumps(m).encode() + b"\0")
        # ⚠️ A timeout here does NOT mean the call never ran (memo 6aaf3b89).
        # Callers must not retry a side-effecting call on timeout alone.
        if not ev.wait(timeout):
            self.pending.pop(mid, None)
            raise TimeoutError(f"{method} gave no answer in {timeout}s (it may still have run)")
        self.pending.pop(mid, None)
        if ev.msg is None:
            raise RuntimeError("browser went away")
        if "error" in ev.msg:
            raise RuntimeError(f"{method}: {ev.msg['error']}")
        return ev.msg.get("result", {})


class Browser:
    def __init__(self, ident=None, extra=()):
        self.keep = os.environ.get("DROVER_PROFILE")
        if self.keep:
            os.makedirs(self.keep, exist_ok=True)
            # ⛔ Chrome's own lock, left by a killed pod, makes the next launch
            # refuse the profile. Safe to clear only because one account's
            # profile is driven by one browser at a time.
            for lock in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
                try:
                    os.unlink(os.path.join(self.keep, lock))
                except FileNotFoundError:
                    pass
        self.profile = self.keep or tempfile.mkdtemp(prefix="drover-")
        self.ident = ident if ident and ident.get("ok") else None
        w, h = SCREEN.split("x")
        env = {**os.environ, "DISPLAY": DISPLAY}
        coherence = []
        if self.ident:
            # TZ on the PROCESS, not Emulation.setTimezoneOverride: the real
            # zone, so every API reports it without an override to find.
            env["TZ"] = self.ident["tz"]
            lang = self.ident["lang"]
            # ⛔ Plain tags only. Chrome copies --accept-lang into navigator.languages
            # verbatim, so "en;q=0.9" here showed up as a language named
            # "en;q=0.9" (bench, 2026-10-24). Chrome adds the q-values itself.
            coherence = [f"--lang={lang}", f"--accept-lang={lang},{lang.split('-')[0]}"]
        if os.environ.get("DROVER_PROXY"):
            coherence.append("--proxy-server=" + start_proxy_forwarder())
            if os.environ.get("DROVER_PROXY_BYPASS"):
                # The bench collector lives on the LAN, where an exit cannot reach.
                coherence.append("--proxy-bypass-list=" + os.environ["DROVER_PROXY_BYPASS"])
        args = [CHROME, f"--user-data-dir={self.profile}", "--remote-debugging-pipe",
                "--no-first-run", "--no-default-browser-check", "--password-store=basic",
                "--disable-features=Translate",
                # ⭐ Without this a debugging-pipe browser reports
                # navigator.webdriver === true (measured, first bench run
                # 2026-10-24). It switches the automation feature off rather
                # than faking a value, as nodriver does.
                "--disable-blink-features=AutomationControlled",
                f"--window-size={w},{h}", "--window-position=0,0",
                *coherence, *EXTRA, *extra, "about:blank"]
        r1, w1 = os.pipe()          # we write -> chrome reads on fd 3
        r2, w2 = os.pipe()          # chrome writes on fd 4 -> we read
        os.set_inheritable(r1, True)
        os.set_inheritable(w2, True)

        def wire():
            os.dup2(r1, 3)
            os.dup2(w2, 4)

        self.proc = subprocess.Popen(args, preexec_fn=wire, pass_fds=(3, 4), stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL, env=env, start_new_session=True)
        os.close(r1)
        os.close(w2)
        self.cdp = Pipe(w1, r2)
        self.session = self._attach()
        self.world = None
        self.raise_window()
        if self.ident:
            # Answers navigator.geolocation with a point near the exit. The
            # permission is left at "prompt", as a fresh desktop profile has it,
            # unless the job sets DROVER_GEO_GRANT=1.
            self.send("Emulation.setGeolocationOverride", self.ident["geo"])
            if os.environ.get("DROVER_GEO_GRANT") == "1":
                self.cdp.call("Browser.grantPermissions", {"permissions": ["geolocation"]})

    def _attach(self):
        for _ in range(100):
            ts = self.cdp.call("Target.getTargets")["targetInfos"]
            pages = [t for t in ts if t["type"] == "page"]
            if pages:
                return self.cdp.call("Target.attachToTarget", {"targetId": pages[0]["targetId"], "flatten": True})["sessionId"]
            time.sleep(0.1)
        raise RuntimeError("no page target")

    def raise_window(self):
        """On a real desktop (a window manager, other windows) a new Chrome can
        open BEHIND whatever is up, and XTEST input then lands on that window
        instead (laptop1 2026-10-24: under a fullscreen kiosk, calibration saw
        no movement). Activate our own window. Xvfb has no WM and nothing to
        be behind, so a failure here is ignored."""
        for _ in range(30):
            try:
                wins = xdo("search", "--onlyvisible", "--class", "google-chrome").split()
            except RuntimeError:
                wins = []
            ours = []
            for w in wins:
                try:
                    if int(xdo("getwindowpid", w)) in self._pids():
                        ours.append(w)
                except (RuntimeError, ValueError):
                    pass
            if ours:
                try:
                    xdo("windowactivate", "--sync", ours[-1])
                except RuntimeError:
                    pass
                return ours[-1]
            time.sleep(0.2)
        return None

    def _pids(self):
        pids, frontier = {self.proc.pid}, [self.proc.pid]
        while frontier:
            p = frontier.pop()
            try:
                for c in open(f"/proc/{p}/task/{p}/children").read().split():
                    pids.add(int(c))
                    frontier.append(int(c))
            except OSError:
                pass
        return pids

    def send(self, method, params=None, timeout=30):
        return self.cdp.call(method, params, session=self.session, timeout=timeout)

    def navigate(self, url, settle=2.0, timeout=45):
        self.send("Page.navigate", {"url": url}, timeout=timeout)
        self.world = None                              # a navigation destroys the isolated world
        end = time.time() + timeout
        while time.time() < end:
            try:
                if self.eval("document.readyState") == "complete":
                    break
            except RuntimeError:
                pass
            time.sleep(0.25)
        time.sleep(settle)

    def eval(self, expr, timeout=30, _retried=False):
        """Evaluate in an ISOLATED world: same DOM, none of the page's globals,
        invisible to the page's own scripts. Never Runtime.enable."""
        if self.world is None:
            frame = self.send("Page.getFrameTree")["frameTree"]["frame"]["id"]
            self.world = self.send("Page.createIsolatedWorld",
                                   {"frameId": frame, "worldName": "d", "grantUniveralAccess": False})["executionContextId"]
        try:
            r = self.send("Runtime.evaluate", {"expression": expr, "contextId": self.world,
                                               "returnByValue": True, "awaitPromise": True}, timeout=timeout)
        except RuntimeError as e:
            # A redirect or late navigation throws the world away under us
            # ("Cannot find context with specified id", 4 of the first 8 panel
            # errors). Make a fresh world once and try again.
            if _retried or "context" not in str(e).lower():
                raise
            self.world = None
            return self.eval(expr, timeout, _retried=True)
        if "exceptionDetails" in r:
            raise RuntimeError("eval: " + r["exceptionDetails"].get("text", "exception"))
        return r["result"].get("value")

    def shot(self, path):
        data = self.send("Page.captureScreenshot", {"format": "png"}, timeout=60)["data"]
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))

    def rss_mb(self):
        """Memory of the whole Chrome tree, the number replica counts are sized
        on, so it is measured rather than assumed.

        ⛔ Summed per-process RSS OVER-COUNTS: Chrome's processes share most of
        their pages, and summing RSS counts each shared page once per process.
        PSS divides shared pages fairly. The pod's cgroup is the authority,
        because it is what a k8s memory limit enforces, and `cluster` sizes on
        its PEAK (DM 2026-10-24). rssMb is kept only to show the gap."""
        pids, frontier = {self.proc.pid}, [self.proc.pid]
        while frontier:
            p = frontier.pop()
            try:
                for c in open(f"/proc/{p}/task/{p}/children").read().split():
                    pids.add(int(c))
                    frontier.append(int(c))
            except OSError:
                pass
        kb = pss = 0
        for p in pids:
            try:
                for line in open(f"/proc/{p}/status"):
                    if line.startswith("VmRSS:"):
                        kb += int(line.split()[1])
                for line in open(f"/proc/{p}/smaps_rollup"):
                    if line.startswith("Pss:"):
                        pss += int(line.split()[1])
            except OSError:
                pass
        out = {"rssMb": round(kb / 1024), "pssMb": round(pss / 1024), "procs": len(pids)}
        for key, name in (("cgroupMb", "memory.current"), ("cgroupPeakMb", "memory.peak")):
            try:
                out[key] = round(int(open("/sys/fs/cgroup/" + name).read()) / 2**20)
            except (OSError, ValueError):
                out[key] = None
        return out

    def close(self):
        try:
            self.cdp.call("Browser.close", timeout=5)
        except Exception:
            pass
        try:
            self.proc.wait(5)
        except subprocess.TimeoutExpired:
            os.killpg(self.proc.pid, signal.SIGKILL)   # its own session: kills only this browser
        if not self.keep:
            shutil.rmtree(self.profile, ignore_errors=True)


# ------------------------------------------------------------------ input ---
class Hands:
    """Human-shaped XTEST input. Coordinates are page CSS px; the offset from
    page to screen is CALIBRATED by moving the real pointer and reading where
    the page saw it, because outer/screen metrics read 0 under Xvfb with no
    window manager (memo adc92d28). Calibration also proves the events land."""

    def __init__(self, b):
        self.b = b
        self.dx = self.dy = 0

    LISTEN = ("(() => { if (!window.__dmOn) { window.__dmOn = 1; window.__dm = null;"
              " addEventListener('mousemove', e => { window.__dm = [e.clientX, e.clientY, e.isTrusted]; }, true); }"
              " return 1; })()")

    def seen(self):
        """Where the PAGE last saw the pointer, in CSS px. Installed lazily,
        because a navigation throws the isolated world away."""
        self.b.eval(self.LISTEN)
        return self.b.eval("window.__dm")

    def calibrate(self):
        self.b.eval(self.LISTEN)
        # ⛔ A point over a cross-origin iframe (an embedded form, a map)
        # delivers its mousemoves to the frame, not the top page, so one point
        # can read "no movement" on a page that works (measured on a town
        # contact page, 2026-10-24). Try a few spread-out points.
        seen = None
        for sx, sy in [(700, 500), (300, 250), (1300, 300), (500, 800), (1500, 750)]:
            sx, sy = sx + random.randint(-40, 40), sy + random.randint(-40, 40)
            self.move_screen(sx, sy)
            time.sleep(0.15)
            seen = self.seen()
            if seen and abs(self.where()[0] - sx) < 3:
                break
        if not seen:
            raise RuntimeError("calibration: page saw no pointer movement")
        dpr = self.b.eval("devicePixelRatio") or 1
        self.dx, self.dy = sx - seen[0] * dpr, sy - seen[1] * dpr
        return {"dx": self.dx, "dy": self.dy, "trusted": seen[2]}

    def where(self):
        d = dict(l.split("=", 1) for l in xdo("getmouselocation", "--shell").splitlines() if "=" in l)
        return int(d["X"]), int(d["Y"])

    def move_screen(self, x, y, width=None):
        # ⛔ Forget the page's last sighting first. A stale one (the pointer
        # left the page, or sits over a cross-origin frame) reads as "the page
        # saw it there", and re-learning the offset from it walked the pointer
        # into the screen corner on a town contact form (2026-10-24).
        try:
            self.b.eval(self.LISTEN)
            self.b.eval("window.__dm = null")
        except RuntimeError:
            pass
        x0, y0 = self.where()
        chain = []
        for px, py, dt in hm.steps(x0, y0, x, y, cfg=CFG, target_width=width or CFG.target_width):
            chain += ["mousemove", *on_screen(px, py), "sleep", f"{dt:.3f}"]
        for px, py, dt in hm.settle(x, y):
            chain += ["mousemove", *on_screen(px, py), "sleep", f"{dt:.3f}"]
        if chain:
            xdo(*chain)

    def rect(self, selector):
        r = self.b.eval(f"(() => {{ const e = document.querySelector({json.dumps(selector)}); if (!e) return null;"
                        f" const r = e.getBoundingClientRect();"
                        f" return [r.left, r.top, r.width, r.height, devicePixelRatio, innerHeight]; }})()")
        if not r:
            raise RuntimeError("no element " + selector)
        return r

    def reach(self, selector, tries=12):
        """Bring an element into view the way a person does: by scrolling.
        ⛔ Never scrollIntoView(), which is a scripted jump no hand makes.
        Re-measures after every gesture, because a notch's size in px varies
        by page and the plan mixes wheel, arrow keys and over-scroll."""
        last = None
        for _ in range(tries):
            left, top, w, h, dpr, vh = self.rect(selector)
            if top >= vh * 0.12 and top + h <= vh * 0.88:
                # Smooth scrolling keeps moving the page after the last wheel
                # notch: a box measured mid-glide is gone by the time the hand
                # arrives (a form 3000 px down a town homepage). Wait for still.
                time.sleep(0.3)
                l2, t2, *_ = self.rect(selector)
                if abs(t2 - top) < 2:
                    return left, top, w, h, dpr
                continue
            # Near the top or bottom of the page the comfortable band cannot be
            # reached (measured: a form's first field at y=40 failed 12 tries).
            # Fully on screen and the scroll no longer moves it: good enough.
            if top >= 0 and top + h <= vh and last is not None and abs(top - last) < 2:
                return left, top, w, h, dpr
            last = top
            # ~100 CSS px per notch is the starting guess; the loop corrects it
            want = (top + h / 2 - vh / 2) / 100.0
            self.scroll(-max(1, round(abs(want))) if want > 0 else max(1, round(abs(want))))
            time.sleep(random.uniform(0.15, 0.5))
        raise RuntimeError("could not scroll %s into view" % selector)

    def scroll(self, notches):
        """humanmotion's scroll plan: wheel bursts, arrow keys, pauses to read,
        overshoot and back. Positive is up. The wheel scrolls what is under the
        pointer, so the pointer is parked over the page first if it is off it
        (memo 2fda44d8)."""
        x, y = self.where()
        vw, vh = self.b.eval("[innerWidth, innerHeight]")
        if not (self.dx < x < self.dx + vw and self.dy < y < self.dy + vh):
            self.move_screen(round(self.dx + vw * random.uniform(0.35, 0.65)),
                             round(self.dy + vh * random.uniform(0.35, 0.65)))
        for op in hm.scroll_plan(notches, CFG):
            time.sleep(op["delay"])
            if op["op"] == "wheel":
                button = "4" if op["notches"] > 0 else "5"
                chain = []
                for _ in range(abs(op["notches"])):
                    chain += ["click", button, "sleep", f"{random.uniform(0.012, 0.035):.3f}"]
                xdo(*chain)
            elif op["op"] == "key":
                chain = []
                for _ in range(op["repeat"]):
                    chain += ["key", op["key"], "sleep", f"{random.uniform(0.04, 0.11):.3f}"]
                xdo(*chain)

    def drag(self, from_selector, to_selector):
        """Press on one element, carry, release on another: humanmotion's drag
        model (slower and steadier than a free move, no settle at the drop)."""
        fl, ft, fw, fh, dpr = self.reach(from_selector)
        x0 = round(self.dx + (fl + fw * random.uniform(0.35, 0.65)) * dpr)
        y0 = round(self.dy + (ft + fh * random.uniform(0.35, 0.65)) * dpr)
        self.move_screen(x0, y0, width=fw * dpr)
        tl, tt, tw, th, _, _ = self.rect(to_selector)
        x1 = round(self.dx + (tl + tw * random.uniform(0.4, 0.6)) * dpr)
        y1 = round(self.dy + (tt + th * random.uniform(0.4, 0.6)) * dpr)
        plan = hm.drag_steps(x0, y0, x1, y1, CFG, target_width=tw * dpr)
        chain = ["mousedown", "1", "sleep", f"{plan['grab']:.3f}"]
        for px, py, dt in plan["steps"]:
            chain += ["mousemove", *on_screen(px, py), "sleep", f"{dt:.3f}"]
        chain += ["sleep", f"{plan['hold']:.3f}", "mouseup", "1"]
        xdo(*chain)

    def click(self, selector):
        """Aim, look, correct, press. ⛔ The page-to-screen offset can go stale
        after calibration (measured 2026-10-24: dx came out -236 on one run in
        three, and Finish was clicked at x=0). So after every approach the page
        is asked where it saw the pointer, and a miss gets a short corrective
        move, the way a hand that lands just off a button nudges onto it. The
        offset is re-learned from each correction."""
        left, top, w, h, dpr = self.reach(selector)
        tx = left + w * random.uniform(0.3, 0.7)          # off-centre, well inside the box
        ty = top + h * random.uniform(0.3, 0.7)
        self.move_screen(round(self.dx + tx * dpr), round(self.dy + ty * dpr), width=w * dpr)
        for _ in range(3):
            # A busy page (scripts still running on a fresh load) delivers the
            # mousemove late: 50 ms read null on every try in a new pod. Wait
            # for the sighting, up to a second, before judging the aim.
            for _ in range(12):
                time.sleep(0.08)
                got = self.seen()
                if got:
                    break
            hit = got and self.b.eval(
                f"(() => {{ const t = document.querySelector({json.dumps(selector)}), e = document.elementFromPoint({got[0]}, {got[1]});"
                f" return !!(t && e && (t === e || t.contains(e))); }})()")
            if hit:
                break
            vw, vh = self.b.eval("[innerWidth, innerHeight]")
            if got and 2 < got[0] < vw - 2 and 2 < got[1] < vh - 2:   # a fresh sighting, not an edge
                sx, sy = self.where()
                self.dx, self.dy = sx - got[0] * dpr, sy - got[1] * dpr
            self.move_screen(round(self.dx + tx * dpr), round(self.dy + ty * dpr), width=w * dpr)
        else:
            raise RuntimeError(f"pointer would not land on {selector}")
        pre, dwell = hm.press_timing(CFG)
        xdo("sleep", f"{pre:.3f}", "mousedown", "1", "sleep", f"{dwell:.3f}", "mouseup", "1")

    def type(self, text, sensitive=False):
        """Keystroke program from humanmotion: typos with corrections unless
        `sensitive` (passwords, cards, amounts: memo 0e09d689)."""
        for op in hm.type_program(text, CFG, sensitive=sensitive):
            time.sleep(op["delay"])
            if op["op"] == "backspace":
                xdo("key", "--clearmodifiers", "BackSpace")
            else:
                xdo("type", "--clearmodifiers", "--delay", "0", "--", op["char"])


# ------------------------------------------------------------------- jobs ---
def job_probe(b, url, out):
    """The bench probe: human-click Target, human-type into the field, press
    Finish, then read the probe's own JSON back from the DOM."""
    hands = Hands(b)
    t0 = time.time()
    b.navigate(url)
    cal = hands.calibrate()
    time.sleep(random.uniform(0.4, 1.2))
    hands.click("#target")
    time.sleep(random.uniform(0.3, 0.9))
    hands.click("#field")
    hands.type("Drover probe, typed by hand.")
    time.sleep(random.uniform(0.3, 0.8))
    hands.click("#below")                        # below the fold: human scroll
    time.sleep(random.uniform(0.3, 0.8))
    hands.drag("#dragA", "#dropB")
    time.sleep(random.uniform(0.3, 0.8))
    hands.click("#finish")                       # back at the top: scroll up
    raw = None
    for _ in range(40):
        raw = b.eval("document.getElementById('out').textContent")
        if raw:
            break
        time.sleep(0.25)
    if raw:
        res = json.loads(raw)
    else:
        # Say WHERE it stopped, not just that it did: the pointer, the page
        # scroll and where Finish actually sits.
        res = {"error": "probe produced no result",
               "where": {"pointer": hands.where(), "offset": [hands.dx, hands.dy],
                         "page": b.eval("[scrollY, innerHeight, (r => [r.left, r.top, r.width, r.height])"
                                        "(document.getElementById('finish').getBoundingClientRect())]")}}
        if out:
            b.shot(os.path.splitext(out)[0] + "-fail.png")
    res["driver"] = {"name": "drover", "chrome": CHROME, "calibration": cal, "identity": b.ident,
                     **b.rss_mb(), "jobSeconds": round(time.time() - t0, 2)}
    if out:
        with open(out, "w") as f:
            json.dump(res, f, indent=2)
    return res


def job_visit(b, url, wait, shot, interact=False):
    """Load a third-party page (a detection suite or a live site), let it
    settle, and report what a classifier needs: final URL, title, visible
    text, iframe sources (DataDome and PerimeterX challenge in iframes), and a
    screenshot if asked.

    `interact` behaves like a person who has just landed: the pointer wanders
    a little and the page is scrolled down and partly back, all as XTEST
    input. Behavioural sensors (PerimeterX, Akamai) score exactly this
    window, so a load with no input at all is its own tell."""
    t0 = time.time()
    b.navigate(url, settle=min(wait, 4.0))
    if interact:
        hands = Hands(b)
        try:
            hands.calibrate()
            vw, vh = b.eval("[innerWidth, innerHeight]")
            for _ in range(random.randint(2, 4)):
                hands.move_screen(round(hands.dx + vw * random.uniform(0.15, 0.85)),
                                  round(hands.dy + vh * random.uniform(0.2, 0.8)))
                time.sleep(random.uniform(0.3, 1.1))
            hands.scroll(-random.randint(3, 8))
            time.sleep(random.uniform(0.8, 2.0))
            hands.scroll(random.randint(1, 3))
        except Exception as e:                      # a challenge page may have no body to move over
            interact = f"failed: {e}"
    rest = wait - (time.time() - t0)
    if rest > 0:
        time.sleep(rest)
    page = b.eval("({url: location.href, title: document.title,"
                  " text: document.body ? document.body.innerText : '',"
                  " frames: [...document.querySelectorAll('iframe')].map(f => f.src).filter(Boolean).slice(0, 20)})") or {}
    if shot:
        try:
            b.shot(shot)
        except (TimeoutError, RuntimeError) as e:     # a heavy page must not cost the verdict
            page["shotError"] = str(e)[:120]
    return {"url": url, **page, "interact": interact, "exitIp": (b.ident or {}).get("ip"), **b.rss_mb(), "seconds": round(time.time() - t0, 2)}


# Captcha widgets a hand can press, by the frame they render in, with where
# the checkbox sits inside it (fractions of the frame's box), and the field a
# solved widget writes its token into.
WIDGETS = [
    ("recaptcha", "iframe[src*='recaptcha/api2/anchor'],iframe[src*='recaptcha/enterprise/anchor']", 0.10, 0.5, "g-recaptcha-response"),
    ("hcaptcha", "iframe[src*='hcaptcha.com'][src*='frame=checkbox']", 0.10, 0.5, "h-captcha-response"),
    ("turnstile", "iframe[src*='challenges.cloudflare.com']", 0.10, 0.5, "cf-turnstile-response"),
]
TOKEN = ("(n => [...document.querySelectorAll(`textarea[name=\"${n}\"],input[name=\"${n}\"]`)]"
         ".some(e => e.value.length > 20))")
CAPTCHA_PRESENT = ("!!document.querySelector(\"[data-sitekey],.g-recaptcha,.h-captcha,.cf-turnstile,"
                   "script[src*='recaptcha/api.js'],script[src*='recaptcha/enterprise.js'],script[src*='hcaptcha.com/1/api.js']\")")


def job_contact(b, row, cfg, dry=False, shot=None):
    """One outreach row: open a town's contact form, fill it by hand, press any
    captcha checkbox, submit, and read the verdict. Field choice, message and
    the success/refusal patterns are the v1 lane's own (outreach/
    extract_config.py lifts them), so both lanes post the same text and score
    the same way. Statuses match the lane's results file.

    ⛔ NO PAID SOLVING here. A captcha that serves an image challenge, or has
    no checkbox at all (v3, invisible), ends the row `blocked` before submit;
    it is never sent without the token the site asked for.
    `dry` stops before the submit press: a timing run that sends nothing."""
    import re
    t0 = time.time()
    ok_rx, fail_rx = re.compile(cfg["OK_CONTACT"], re.I), re.compile(cfg["FAIL_TEXT"], re.I)

    def done(status, note):
        if shot:
            try:
                b.shot(shot)
            except (TimeoutError, RuntimeError):
                pass
        return {"key": row["key"], "address": row["address"], "status": status, "note": note[:300],
                "exitIp": (b.ident or {}).get("ip"), "seconds": round(time.time() - t0, 1)}

    try:
        b.navigate(row["url"], settle=2.0)
    except Exception as e:
        return done("error", f"navigate: {e}")
    # Forms render late (JS builders, consent walls): ask again for ~20 s.
    found = {}
    for _ in range(10):
        try:
            found = json.loads(b.eval(cfg["DISCOVER_CONTACT"]) or "{}")
        except Exception as e:
            found = {"ok": False, "why": f"discover failed: {e}"}
        if found.get("ok"):
            break
        time.sleep(2)
    if not found.get("ok"):
        return done("noform", found.get("why", "no form"))
    town = row.get("town") or row["address"].split("@")[0]
    values = {"email": row["address"], "first": row["first"], "last": row["last"],
              "full": (row["first"] + " " + row["last"]).strip(), "subject": cfg["SUBJECT"],
              "message": cfg["MSG_TMPL"].replace("{address}", row["address"]).replace("{town}", town)}
    hands = Hands(b)
    try:
        hands.calibrate()
        for k in ("first", "last", "full", "email", "subject", "message"):
            if k != "email" and k != "message" and not found["fields"].get(k):
                continue
            sel = f"[data-ub-f='{k}']"
            hands.click(sel)
            hands.type(values[k])
            # The last keystroke can still be in flight when typing returns
            # (measured: "Stor" for "Store"). Give the page a moment to catch up.
            for _ in range(10):
                got = b.eval(f"(e => e && e.value)(document.querySelector({json.dumps(sel)}))")
                if got == values[k]:
                    break
                time.sleep(0.15)
            if got != values[k]:
                return done("error", f"field {k} reads back {str(got)[:60]!r}")
            time.sleep(random.uniform(0.3, 1.0))
        for i in range(len(found.get("boxes") or [])):
            hands.click(f"[data-ub-f='box{i}']")
            time.sleep(random.uniform(0.2, 0.6))
    except RuntimeError as e:
        return done("blocked", f"form field unreachable — {e}")
    kind = "none"
    if b.eval(CAPTCHA_PRESENT):
        kind = "captcha"
        for name, sel, fx, fy, field in WIDGETS:
            if not b.eval(f"!!document.querySelector({json.dumps(sel)})"):
                continue
            kind = name
            try:
                left, top, w, h, dpr = hands.reach(sel)
            except RuntimeError as e:
                return done("blocked", f"{name}: widget unreachable — {e}")
            hands.move_screen(round(hands.dx + (left + w * fx) * dpr), round(hands.dy + (top + h * fy) * dpr), width=24 * dpr)
            pre, dwell = hm.press_timing(CFG)
            xdo("sleep", f"{pre:.3f}", "mousedown", "1", "sleep", f"{dwell:.3f}", "mouseup", "1")
            for _ in range(8):
                time.sleep(1)
                if b.eval(TOKEN + f"({json.dumps(field)})"):
                    break
            break
        token = any(b.eval(TOKEN + f"({json.dumps(f)})") for *_, f in WIDGETS)
        if not token:
            served = b.eval("[...document.querySelectorAll(\"iframe[src*='bframe'],iframe[src*='hcaptcha.com'][src*='challenge']\")]"
                            ".some(f => { const r = f.getBoundingClientRect(); return r.top > -1000 && r.height > 100; })")
            return done("blocked", f"{kind}: " + ("challenge served — did not submit" if served
                                                  else "no token and nothing solved — did not submit"))
    if dry:
        return done("dry", f"{kind}: filled, not sent")
    before = b.eval(cfg["BODY"]) or ""
    url0 = b.eval("location.href")
    sub = json.loads(b.eval(cfg["SUBMIT_RECT"]) or "{}")
    if not sub.get("ok"):
        return done("blocked", f"{kind}: no submit control found")
    try:
        hands.click("[data-ub-f='submit']")
    except RuntimeError as e:
        return done("blocked", f"{kind}: submit control unreachable — {e}")
    # ⛔ From here the town may have the message. Anything that goes wrong is
    # `unsure`, never `error`: the lane sweeps `error` rows again, and a re-run
    # of a row that did send is a second message to a stranger. The marker on
    # stderr tells lane.py the same if this process dies past this point.
    print("PRESSED", file=sys.stderr, flush=True)
    try:
        time.sleep(5)
        try:
            after, url1 = b.eval(cfg["BODY"]) or "", b.eval("location.href")
        except Exception:
            time.sleep(3)
            after, url1 = b.eval(cfg["BODY"]) or "", b.eval("location.href")
    except Exception as e:
        return done("unsure", f"{kind}: submit pressed, page unreadable after — {e}")
    s = sub.get("label", "")
    bad = fail_rx.search(after)
    if bad and not fail_rx.search(before):              # only a NEW refusal counts
        return done("blocked", f"{kind}|{s}|rejected: {bad.group(0)!r}")
    if ok_rx.search(after) and not ok_rx.search(before):
        return done("submitted", f"{kind}|{s}|ok-text")
    if url1 != url0 or after != before:
        return done("submitted", f"{kind}|{s}|page-changed")
    return done("blocked", f"{kind}|{s}|no confirmation")


# Interactive elements, each with a CSS path that needs no attribute written
# into the page (a data-* marker would be visible to the page's own scripts).
SNAPSHOT = r"""(() => {
  const path = e => { const p = []; for (; e && e.nodeType === 1 && e !== document.body; e = e.parentElement) {
      if (e.id && /^[A-Za-z][\w-]*$/.test(e.id)) { p.unshift('#' + e.id); return p.join(' > '); }
      let i = 1; for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName) i++;
      p.unshift(e.tagName.toLowerCase() + ':nth-of-type(' + i + ')'); }
    return 'body > ' + p.join(' > '); };
  const label = e => (e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute('aria-label') ||
      e.placeholder || e.innerText || e.value || e.title || e.name || '';
  const q = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=checkbox],[contenteditable=true],iframe';
  return [...document.querySelectorAll(q)].filter(e => { const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }).slice(0, 150).map(e => ({
    sel: path(e), tag: e.tagName.toLowerCase(), type: e.type || e.getAttribute('role') || undefined,
    name: e.name || undefined, label: String(label(e)).trim().replace(/\s+/g, ' ').slice(0, 80),
    value: (e.type === 'password' ? undefined : (e.value || undefined)), checked: e.checked || undefined,
    src: e.tagName === 'IFRAME' ? e.src.slice(0, 120) : undefined}));
})()"""


def job_serve(b, port, outdir):
    """A held session for multi-step work (signups, forms): one browser, the
    same human hands, driven a step at a time over HTTP on 127.0.0.1. POST a
    JSON {op, ...}; every op answers JSON. GET /shot.png is the last shot.

      navigate {url}    snapshot    text    frames    eval {expr}
      click {sel}       type {sel?, text, sensitive?}    key {key}
      select {sel, text}  (a native <select>, by its option's text)
      scroll {notches}  click_in {sel, fx, fy}  (a point inside a cross-origin
                        iframe, e.g. a captcha checkbox: fractions of its box)
      shot              close
    """
    import http.server
    hands = Hands(b)
    state = {"cal": False, "shot": os.path.join(outdir, "shot.png")}

    def ready():
        if not state["cal"]:
            hands.calibrate()
            state["cal"] = True

    def run(c):
        op = c.get("op")
        if op == "navigate":
            b.navigate(c["url"], settle=c.get("settle", 2.0))
            state["cal"] = False
            return {"url": b.eval("location.href"), "title": b.eval("document.title")}
        if op == "snapshot":
            return {"url": b.eval("location.href"), "title": b.eval("document.title"), "elements": b.eval(SNAPSHOT)}
        if op == "text":
            return {"text": (b.eval("document.body ? document.body.innerText : ''") or "")[:c.get("max", 6000)]}
        if op == "frames":
            return {"frames": b.eval("[...document.querySelectorAll('iframe')].map(f => f.src).filter(Boolean)")}
        if op == "eval":
            return {"value": b.eval(c["expr"])}
        if op == "click":
            ready(); hands.click(c["sel"]); time.sleep(c.get("after", 0.8))
            return {"url": b.eval("location.href")}
        if op == "click_in":
            ready()
            left, top, w, h, dpr = hands.reach(c["sel"])
            x, y = left + w * c.get("fx", 0.5), top + h * c.get("fy", 0.5)
            hands.move_screen(round(hands.dx + x * dpr), round(hands.dy + y * dpr), width=24 * dpr)
            pre, dwell = hm.press_timing(CFG)
            xdo("sleep", f"{pre:.3f}", "mousedown", "1", "sleep", f"{dwell:.3f}", "mouseup", "1")
            return {"ok": True}
        if op == "type":
            ready()
            if c.get("sel"):
                hands.click(c["sel"])
            hands.type(c["text"], sensitive=c.get("sensitive", False))
            # ⚠️ A space went missing once on a live form ("KatamaCreek") and
            # did not reproduce in 4 tries on a bare input. Read back what the
            # field holds so the caller can see it rather than submit it.
            # Never echoed for a sensitive field.
            if c.get("sel") and not c.get("sensitive"):
                got = b.eval(f"(e => e && 'value' in e ? e.value : null)(document.querySelector({json.dumps(c['sel'])}))")
                return {"ok": got is None or c["text"] in got, "value": got}
            return {"ok": True}
        if op == "select":
            # ⛔ A native <select> opens a popup on click that swallows the
            # wheel and every key until it closes (measured: typing into one
            # picked "Armed Forces Pacific" and froze scrolling). Type-ahead
            # the option without typos, then Enter closes it.
            ready(); hands.click(c["sel"]); time.sleep(0.4)
            hands.type(c["text"], sensitive=True)
            xdo("key", "--clearmodifiers", "Return"); time.sleep(0.3)
            got = b.eval(f"(e => e.options[e.selectedIndex] && e.options[e.selectedIndex].text)"
                         f"(document.querySelector({json.dumps(c['sel'])}))")
            return {"selected": got}
        if op == "key":
            xdo("key", "--clearmodifiers", c["key"]); time.sleep(c.get("after", 0.5))
            return {"ok": True}
        if op == "scroll":
            ready(); hands.scroll(int(c["notches"]))
            return {"ok": True}
        if op == "shot":
            b.shot(state["shot"])
            return {"shot": "/shot.png"}
        raise ValueError("unknown op " + str(op))

    lock = threading.Lock()                           # one hand on the mouse at a time

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype="application/json"):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/shot.png" and os.path.exists(state["shot"]):
                return self._send(200, open(state["shot"], "rb").read(), "image/png")
            self._send(404, b"{}")

        def do_POST(self):
            c = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            if c.get("op") == "close":
                self._send(200, b'{"closing": true}')
                threading.Thread(target=srv.shutdown).start()
                return
            with lock:
                try:
                    r, code = run(c), 200
                except Exception as e:
                    r, code = {"error": f"{type(e).__name__}: {e}"[:300]}, 500
            self._send(code, json.dumps(r).encode())

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    print(json.dumps({"serving": port, "exitIp": (b.ident or {}).get("ip")}), flush=True)
    srv.serve_forever()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("job", choices=["probe", "visit", "serve", "contact"])
    ap.add_argument("--row", help="contact: the queue row as JSON {url,address,first,last,key,town}")
    ap.add_argument("--config", help="contact: outreach/contact-config.json")
    ap.add_argument("--dry", action="store_true", help="contact: fill but do not submit")
    ap.add_argument("--url", default="about:blank")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--out")
    ap.add_argument("--wait", type=float, default=15)
    ap.add_argument("--shot")
    ap.add_argument("--interact", action="store_true")
    a = ap.parse_args()
    xvfb = start_display()
    audio = start_audio()
    ident = identity() if os.environ.get("DROVER_IDENTITY", "1") != "0" else None
    extra = []
    if a.job == "probe":
        # ⛔ The bench is served over plain http, and an insecure origin hides
        # navigator.mediaDevices and userAgentData entirely: the first runs
        # read media=None and brands=null for that reason, not as a tell.
        # Marking only the probe's own origin secure fixes the measurement and
        # changes nothing any other site can see.
        from urllib.parse import urlsplit
        u = urlsplit(a.url)
        extra.append(f"--unsafely-treat-insecure-origin-as-secure={u.scheme}://{u.netloc}")
    b = Browser(ident, extra)
    try:
        if a.job == "probe":
            r = job_probe(b, a.url, a.out)
            d = r.get("driver", {})
            print(json.dumps({"cdpLeak": r.get("cdpLeak"), "webdriver": r.get("nav", {}).get("webdriver"),
                              "brands": r.get("nav", {}).get("brands"), "webgl": r.get("webgl", {}).get("ok"),
                              "movesTrusted": r.get("input", {}).get("movesTrusted"),
                              "typed": r.get("input", {}).get("typed"), "rssMb": d.get("rssMb"), "pssMb": d.get("pssMb"),
                              "cgroupPeakMb": d.get("cgroupPeakMb"),
                              "jobSeconds": d.get("jobSeconds")}))
        elif a.job == "contact":
            print(json.dumps(job_contact(b, json.loads(a.row), json.load(open(a.config)), a.dry, a.shot)))
        elif a.job == "serve":
            job_serve(b, a.port, a.out or tempfile.gettempdir())
        else:
            print(json.dumps(job_visit(b, a.url, a.wait, a.shot, a.interact)))
    finally:
        b.close()
        for p in (audio, xvfb):
            if p:
                p.terminate()


if __name__ == "__main__":
    main()
