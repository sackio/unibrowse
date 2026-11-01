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
import argparse, base64, json, math, os, pathlib, random, re, shutil, signal, subprocess, sys, tempfile, threading, time

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
# ⛔ --disable-gpu-compositing IS WHAT MAKES INPUT WORK AFTER A NAVIGATION, and
# it is not optional. Under Xvfb the GPU compositor's surface for a view built
# on a cross-process navigation never goes input-active, so Chrome silently
# drops every XTEST mouse move and keystroke handed to it -- the page sees no
# pointer and no keys, while xdotool reports success. Measured 2026-10-25: a
# first/local data: page took full input; Wikipedia and Amazon after a nav took
# none, across windowfocus, a focus cycle, an openbox WM (_NET_ACTIVE_WINDOW
# set), setFocusEmulationEnabled, site-isolation off and occlusion off -- only
# a SOFTWARE compositor fixed it. It disables the GPU for the COMPOSITOR only;
# WebGL/canvas stay on the same ANGLE/llvmpipe path, so the fingerprint above
# (the 53/80 llvmpipe reading) is unchanged. Confirmed: click/type via XTEST,
# real keydowns reach the page, on a navigated site.
EXTRA = os.environ.get(
    "DROVER_CHROME_ARGS",
    "--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist --disable-gpu-compositing").split()
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


def start_wm():
    """Start a minimal window manager, if one is installed.

    ⛔ WHY THIS IS NOT OPTIONAL FOR INPUT. Headful Chrome on X11 activates its
    render widget from the platform's window activation, and with no window
    manager nothing ever sends it. X input focus lands on the right window and
    the pointer sits over it, but a cross-process navigation (any real site,
    e.g. amazon.com from the startup page) makes a fresh, UNACTIVATED widget,
    so Chrome drops every XTEST mouse move and keystroke handed to it --
    document.hasFocus() can even be forced true with setFocusEmulationEnabled
    and the field STILL stays empty, because the drop is at the aura view, not
    the renderer. Measured on Amazon /ap/signin 2026-10-25: getwindowfocus ==
    the content window, pointer over it, hf true, 20 keystrokes -> length 0. A
    WM sends the activation and the input lands. A trivial data: page escapes
    this only by never leaving the activated startup process.

    No-op (and the old behaviour) when no WM binary is present, so an image
    without one is unchanged. Off with DROVER_WM=0."""
    if os.environ.get("DROVER_WM", "1") == "0":
        return None
    for wm in ("openbox", "fluxbox", "blackbox", "jwm", "twm"):
        if shutil.which(wm):
            p = subprocess.Popen([wm], env={**os.environ, "DISPLAY": DISPLAY},
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True)
            time.sleep(0.6)
            return p
    return None


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
    from urllib.parse import urlsplit, unquote
    if _FWD:
        return _FWD[0]
    up = urlsplit(os.environ["DROVER_PROXY"])
    if not up.username:
        return os.environ["DROVER_PROXY"]
    auth = "Basic " + base64.b64encode(f"{up.username}:{up.password}".encode()).decode()
    socks = up.scheme.startswith("socks5")

    def socks_open(host, port):
        """A SOCKS5 tunnel with username/password auth (RFC 1928/1929), which
        Chrome cannot do itself. Used for a Nord SOCKS5 server, the one kind of
        exit 2Captcha can also reach (Ben, ask unibrowse/a4s)."""
        u = socket.create_connection((up.hostname, up.port or 1080), timeout=30)
        u.sendall(b"\x05\x01\x02")
        if u.recv(2) != b"\x05\x02":
            raise OSError("socks: no user/pass method")
        user, pw = unquote(up.username).encode(), unquote(up.password).encode()
        u.sendall(b"\x01" + bytes([len(user)]) + user + bytes([len(pw)]) + pw)
        if u.recv(2)[1:] != b"\x00":
            raise OSError("socks: auth refused")
        h = host.encode()
        u.sendall(b"\x05\x01\x00\x03" + bytes([len(h)]) + h + port.to_bytes(2, "big"))
        rep = u.recv(4)
        if len(rep) < 2 or rep[1] != 0:
            raise OSError(f"socks: connect refused {rep[1:2].hex()}")
        u.recv({1: 4, 4: 16}.get(rep[3], 0) or u.recv(1)[0])
        u.recv(2)
        u.settimeout(None)
        return u

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
            if socks:
                method, target, ver = lines[0].split(b" ", 2)
                try:
                    if method == b"CONNECT":
                        host, port = target.decode().rsplit(":", 1)
                        u = socks_open(host, int(port))
                        c.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
                        if rest:
                            u.sendall(rest)
                    else:                              # plain http: absolute URI -> origin form
                        t = urlsplit(target.decode())
                        u = socks_open(t.hostname, t.port or 80)
                        lines[0] = b" ".join([method, ((t.path or "/") + (f"?{t.query}" if t.query else "")).encode(), ver])
                        u.sendall(b"\r\n".join(lines) + b"\r\n\r\n" + rest)
                except OSError:
                    c.sendall(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                    return
            else:
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
    _FWD.append(f"http://127.0.0.1:{srv.server_address[1]}")
    return _FWD[0]


_FWD = []                                              # the one forwarder per process


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
    if proxy and proxy.startswith("socks5"):           # urllib speaks no SOCKS; go through the forwarder
        proxy = start_proxy_forwarder()
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
        self.wlock = threading.Lock()   # serialise writes: call() and fire() share one pipe
        self.on_event = None            # optional handler for CDP events (messages with no id)
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
                mid = msg.get("id")
                if mid is not None:
                    slot = self.pending.get(mid)
                    if slot is not None:              # a reply we are waiting for
                        slot.msg = msg
                        slot.set()
                    # else: reply to a fire() we deliberately did not await -- drop
                elif self.on_event is not None:       # a CDP event (no id)
                    try:
                        self.on_event(msg)
                    except Exception:
                        pass

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
        with self.wlock:
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

    def fire(self, method, params=None, session=None):
        """Send a command and do NOT await the reply. For the read thread, which
        must never block waiting for a reply on the pipe it is itself draining
        (that would deadlock). The reply comes back with an id no one is waiting
        on and is dropped in _read."""
        with self.lock:
            self.n += 1
            mid = self.n
        m = {"id": mid, "method": method, "params": params or {}}
        if session:
            m["sessionId"] = session
        with self.wlock:
            self.w.write(json.dumps(m).encode() + b"\0")


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
                # Put Chrome's shared memory on disk-backed /tmp, not the
                # memory-backed /dev/shm emptyDir (which counts against this pod's
                # memory cgroup). Lets the request drop to ~2Gi so more shards fit
                # the batch-cpu slivers (cluster seat, 2026-10-26). Measured safe.
                "--disable-dev-shm-usage",
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
        # ⛔ A blocking JS dialog (alert/confirm/beforeunload) FREEZES the renderer,
        # so every Runtime.evaluate in that page hangs the full 30s and returns
        # nothing -- the "write hung" class, 910 paid-but-unconfirmed captcha rows
        # measured 2026-10-31. The INJECT's own input/change dispatch can trip a
        # site onchange/submit handler that opens one mid-evaluate, and the lane's
        # one-shot accept ran BEFORE the evaluate, never during it. Accept every
        # dialog as it opens, reactively, from the read thread, so the evaluate
        # unblocks and returns a real answer (submitted/not) instead of a timeout.
        # accept=True == a person clicking OK: it clears alert()/confirm() and lets
        # a submit's beforeunload proceed. (unibrowse, 2026-10-31.)
        self.cdp.on_event = self._on_cdp_event
        try:
            self.send("Page.enable")
        except RuntimeError:
            pass
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

    def _on_cdp_event(self, msg):
        """Runs on the pipe read thread (see Pipe.on_event). Keep it to
        fire-and-forget writes only -- it must never call self.send(), which
        would wait for a reply on the very pipe this thread drains."""
        if msg.get("method") == "Page.javascriptDialogOpening":
            self.cdp.fire("Page.handleJavaScriptDialog", {"accept": True, "promptText": ""},
                          session=msg.get("sessionId") or self.session)

    @staticmethod
    def _same_site(a, b):
        """Same registrable site (eTLD+1 approximated by the last two labels)?
        Cheap and good enough to decide whether a nav is a within-site
        link-follow (carry a referrer) or a fresh destination (bare)."""
        try:
            from urllib.parse import urlparse
            ha, hb = urlparse(a).hostname or "", urlparse(b).hostname or ""
            return bool(ha) and ha.split(".")[-2:] == hb.split(".")[-2:]
        except Exception:
            return False

    def navigate(self, url, settle=2.0, timeout=45, referrer=None, transition=None):
        # ⭐ HUMAN-MODE NAVIGATION (Ben, #unibrowse 2026-10-31: "navigating to
        # Links properly", enforced "on pretty much every site automatically").
        # A person reaches a deeper page of a site by FOLLOWING A LINK, so the
        # request carries a same-origin Referer and Chrome marks it a link
        # navigation. A cold Page.navigate carries neither, and that bare shape
        # is one of the tells bot-walls score against. So: when we are ALREADY
        # on the same site and nobody overrode it, default to a link-follow from
        # wherever we are. The FIRST load of a host stays bare -- a human types
        # the domain, and that top-level load is normal and expected.
        # ⚠️ MEASURED LIMIT, this session: this realism is necessary but NOT
        # sufficient against Akamai Bot Manager (Lowe's deep pages stayed Access
        # Denied from a datacenter egress even with referrer+link transition AND
        # a validated _abck). Akamai also weighs IP reputation and a fully
        # warmed sensor; crawl-in realism helps the broad case, not that one.
        if referrer is None and transition is None:
            last = getattr(self, "_last_url", None)
            if last and self._same_site(last, url):
                referrer, transition = last, "link"
        if referrer and not transition:
            transition = "link"
        params = {"url": url}
        if referrer:
            params["referrer"] = referrer
        if transition:
            params["transitionType"] = transition
        self.send("Page.navigate", params, timeout=timeout)
        self._last_url = url
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

    def eval_main(self, expr, timeout=30):
        """Evaluate in the PAGE's own world. Only for what must touch the
        page's globals (a captcha widget's registered callback); everything
        else stays in the isolated world. Still no Runtime.enable."""
        r = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True}, timeout=timeout)
        if "exceptionDetails" in r:
            raise RuntimeError("eval_main: " + r["exceptionDetails"].get("text", "exception"))
        return r["result"].get("value")

    def shot(self, path):
        data = self.send("Page.captureScreenshot", {"format": "png"}, timeout=60)["data"]
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))

    def cookies(self):
        """Every cookie the browser holds, httpOnly ones included.

        ⭐ WHY THIS EXISTS. A session kept in a profile is only useful to the
        rest of the fleet if its token can be handed over: claude-usage's sweep
        authenticates with a `sessionKey` cookie and its only browser step
        today is a full magic-link login to re-mint one. With a kept profile
        that becomes a READ, and a login is needed once rather than per run.

        ⛔ A cookie VALUE is a credential -- a profile's cookie store is a
        credential store. Nothing here returns it to a step log; the `cookie`
        step writes it straight to a file with mode 600 and records the name
        and length only.

        Storage.getCookies is browser-wide and needs no domain enabled;
        Network.getAllCookies is the page-level fallback for a Chrome that
        refuses it on a session.
        """
        try:
            return self.send("Storage.getCookies")["cookies"]
        except RuntimeError:
            return self.send("Network.getAllCookies")["cookies"]

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


# --------------------------------------------------------------- locators ---
# A LOCATOR is either a CSS selector string, or a dict naming an element by the
# text a person reads on it: {"sel": "button", "text": "continue with email"}.
#
# ⛔ IT IS NOT A PATH, AND THAT IS THE POINT. Resolving a text match to a CSS
# path in one eval and acting on it in the next is RACY on a React page.
# Measured on the Console login page, 2026-10-25: three identical runs gave a
# correct root-anchored path, a no-match, and a read of "" from a path whose own
# resolution had just seen "Continue with email". The DOM re-renders between
# evals and nth-child indices move under the selector; Hands.click alone spends
# three evals on one press (reach, hit test, press), so no path survives it.
# A locator carries the QUESTION rather than an answer, so every eval resolves
# it against the DOM it is actually looking at -- resolve-and-act is atomic
# within each eval by construction, and a stale index cannot be aimed at.
#
# ⛔ AND IT MUTATES NOTHING. The obvious way to hand Hands a text-matched
# element is to tag it -- el.setAttribute('data-drover','1') -- and aim at the
# attribute, which is stable across renders. That writes a unique attribute
# into the live DOM of a login page, where the page can read it; this file goes
# to some lengths not to be noticeable (no Runtime.enable, isolated worlds) and
# a bespoke attribute would undo that for the sake of a selector.
FIND_JS = """(spec=>{
  const list=[...document.querySelectorAll(spec.sel||'*')], n=spec.nth||0;
  if(!spec.text) return list[n]||null;
  // ⚠️ textContent is the fallback, not the other way round: innerText needs
  // layout and reads empty in a headless window (measured 2026-10-25). A
  // control can also carry its label only in `value` or aria-label.
  const re=new RegExp(spec.text,'i');
  const txt=e=>((e.innerText||e.textContent||'')+' '+(e.value||'')+' '
                +(e.getAttribute('aria-label')||'')).replace(/\\s+/g,' ').trim();
  return list.filter(e=>re.test(txt(e)))[n]||null;
})"""


def el(loc):
    """The JS expression for the element a locator names, resolved in place."""
    if isinstance(loc, dict):
        return "(%s)(%s)" % (FIND_JS, json.dumps(loc))
    return "document.querySelector(%s)" % json.dumps(loc)


def locname(loc):
    """A locator in words, for an error a person reads."""
    if isinstance(loc, dict):
        return "%s matching %r" % (loc.get("sel", "*"), loc.get("text"))
    return loc


def describe(b, loc, seconds=0, poll=0.4):
    """What a locator resolves to RIGHT NOW -- tag, label, where the text
    matched, whether it is disabled -- or None if nothing does.

    Reporting only: the step that acts resolves the locator again itself, so
    this cannot hand it a stale answer.

    `seconds` polls, because "nothing matches" and "the render has not landed
    yet" are the same answer read at two different moments, and one of the three
    Console runs above failed only that way.
    """
    js = ("(()=>{const e=%s;if(!e)return null;"
          "const t=(e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim();"
          "return JSON.stringify({tag:e.tagName,"
          "label:(t||e.value||e.getAttribute('aria-label')||'').slice(0,60),"
          "via:t?'text':(e.value?'value':'aria-label'),"
          "type:e.getAttribute('type')||null,disabled:!!e.disabled})})()" % el(loc))
    dl = time.time() + float(seconds)
    while True:
        raw = b.eval(js)
        if raw or time.time() >= dl:
            return json.loads(raw) if raw else None
        time.sleep(poll)


# ------------------------------------------------------------------ input ---
class Hands:
    """Human-shaped XTEST input. Coordinates are page CSS px; the offset from
    page to screen is CALIBRATED by moving the real pointer and reading where
    the page saw it, because outer/screen metrics read 0 under Xvfb with no
    window manager (memo adc92d28). Calibration also proves the events land."""

    def __init__(self, b):
        self.b = b
        self.dx = self.dy = 0
        self._scroll_tamed = False

    def _tame_scroll(self):
        # ⛔ `scroll-behavior: smooth` makes the page KEEP GLIDING after the last
        # wheel notch (measured on Elementor town forms, 2026-10-26:
        # documentElement scrollBehavior=smooth). click()'s sighting-wait polls
        # up to 1.6s for the page to report the pointer; during that wait the
        # field drifts out from under a pointer parked on target, so
        # elementFromPoint(aim) lands on a neighbour and the click reads "pointer
        # would not land" though the page saw the pointer exactly on target
        # (aim 1101,799 / page saw 1101,799 / hit-test missed). A hand needs no
        # smooth scroll; force instant so a settled box stays settled. Persists
        # on the page DOM until the next full navigation, so once per instance.
        if self._scroll_tamed:
            return
        try:
            self.b.eval("(() => { const s = document.createElement('style');"
                        " s.textContent = '*{scroll-behavior:auto !important}';"
                        " (document.head || document.documentElement).appendChild(s);"
                        " document.documentElement.style.scrollBehavior = 'auto';"
                        " if (document.body) document.body.style.scrollBehavior = 'auto';"
                        " return 1; })()")
            self._scroll_tamed = True
        except RuntimeError:
            pass

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
        # ⛔ A SINGLE SIGHTING CANNOT BE TRUSTED, AND THIS USED TO BELIEVE ONE.
        # move_screen clears the page's last sighting before it moves, but a
        # renderer that is busy delivers the PREVIOUS move's mousemove after
        # that clear -- so the page reports where the pointer WAS and this
        # attributes it to where the pointer now IS. The offset then comes out
        # wrong by the distance between two probe points. Measured on
        # claude.ai/login 2026-10-25, which blocks its renderer for ~14s while
        # it hydrates: dx=356 dy=617 where the truth is 0,143, and the next
        # click was aimed off-screen and clamped to the screen edge. The run
        # before and after it were both fine, which is what a race looks like.
        # ⇒ Learn the offset from one point, then PREDICT a second point and
        # check the page agrees. Two points that agree cannot both be a stale
        # delivery of the other.
        dpr = self.b.eval("devicePixelRatio") or 1
        pts = [(700, 500), (300, 250), (1300, 300), (500, 800), (1500, 750), (900, 400)]
        seen = None
        for i, (sx, sy) in enumerate(pts):
            sx, sy = sx + random.randint(-40, 40), sy + random.randint(-40, 40)
            self.move_screen(sx, sy)
            time.sleep(0.15)
            seen = self.seen()
            if not (seen and abs(self.where()[0] - sx) < 3):
                continue
            dx, dy = sx - seen[0] * dpr, sy - seen[1] * dpr
            vx, vy = pts[(i + 1) % len(pts)]
            vx, vy = vx + random.randint(-40, 40), vy + random.randint(-40, 40)
            self.move_screen(vx, vy)
            time.sleep(0.2)
            check = self.seen()
            if not check:
                continue
            # Where the page SHOULD have seen the pointer if dx,dy are right.
            if abs(check[0] * dpr + dx - vx) < 4 and abs(check[1] * dpr + dy - vy) < 4:
                self.dx, self.dy = dx, dy
                return {"dx": dx, "dy": dy, "trusted": bool(seen[2] and check[2]),
                        "confirmedAt": [vx, vy]}
        if not seen:
            raise RuntimeError("calibration: page saw no pointer movement")
        raise RuntimeError("calibration: no two points agreed on the offset "
                           "(last sighting %s, pointer %s) -- the page is probably "
                           "still blocking its renderer" % (seen, self.where()))

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
        # `selector` is a LOCATOR (see above): a CSS string, or a dict naming
        # the element by its text. Either way it is re-resolved by every eval
        # that touches it, so nothing here can aim at a path that has moved.
        r = self.b.eval(f"(() => {{ const e = {el(selector)}; if (!e) return null;"
                        f" const r = e.getBoundingClientRect();"
                        f" return [r.left, r.top, r.width, r.height, devicePixelRatio, innerHeight]; }})()")
        if not r:
            raise RuntimeError("no element " + locname(selector))
        return r

    def reach(self, selector, tries=12):
        """Bring an element into view the way a person does: by scrolling.
        ⛔ Never scrollIntoView(), which is a scripted jump no hand makes.
        Re-measures after every gesture, because a notch's size in px varies
        by page and the plan mixes wheel, arrow keys and over-scroll."""
        self._tame_scroll()
        last = None
        for _ in range(tries):
            left, top, w, h, dpr, vh = self.rect(selector)
            if top >= vh * 0.12 and top + h <= vh * 0.88:
                # Smooth scrolling keeps moving the page after the last wheel
                # notch: a box measured mid-glide is gone by the time the hand
                # arrives (a form 3000 px down a town homepage). Wait for still.
                time.sleep(0.3)
                l2, t2, *_ = self.rect(selector)
                if abs(t2 - top) >= 2:
                    continue
                # ⛔ On screen is not reachable: a fixed cookie bar or chat
                # widget along the bottom covered fields at y≈810-825 of 936
                # (live chunk 2026-10-24: "pointer would not land", page saw
                # the pointer exactly on target). Ask what is on top first.
                if self.b.eval(f"(() => {{ const t = {el(selector)}; if (!t) return false; const r = t.getBoundingClientRect(),"
                               f" e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);"
                               f" return !!(e && (e === t || t.contains(e) || (e.control === t))); }})()"):
                    return left, top, w, h, dpr
                # Covered: bring it to the upper middle, clear of bottom bars.
                want = (top + h / 2 - vh * 0.4) / 100.0
                if abs(want) < 0.5:
                    # Name the coverer so the note says WHAT is on top (cookie bar,
                    # chat widget, sticky header): the data a dismissal rule needs.
                    who = self.b.eval(
                        f"(() => {{ const t = {el(selector)}; if (!t) return '?'; const r = t.getBoundingClientRect();"
                        f" const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (!e) return 'nothing';"
                        f" const c = (typeof e.className === 'string' && e.className.trim()) ? '.' + e.className.trim().split(/\\s+/).join('.') : '';"
                        f" return (e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + c).slice(0, 80) + ' pos=' + getComputedStyle(e).position; }})()") or '?'
                    raise RuntimeError(f"{locname(selector)} is covered by {who}")
                self.scroll(-max(1, round(abs(want))) if want > 0 else max(1, round(abs(want))))
                time.sleep(random.uniform(0.15, 0.5))
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
        # Human wheel scrolling could not move it: it is in a sub-scroller the
        # page wheel does not drive, or off a page the wheel will not budge
        # (live 2026-10-25: 18 reCAPTCHA anchor iframes lost to "could not
        # scroll into view"). A scripted scroll of the element's own scrollable
        # ancestors is less human than a wheel, but a widget we cannot reach is
        # a row lost outright -- and this runs only after the wheel has failed.
        forced = self._force_into_view(selector)
        if forced:
            return forced
        raise RuntimeError("could not scroll %s into view" % locname(selector))

    def _force_into_view(self, selector):
        """Last resort for reach(): scrollIntoView the element (which also
        scrolls every scrollable ancestor, unlike a page wheel), then accept
        it if it is now on screen. Returns a rect or None."""
        self.b.eval("(() => { const e = " + el(selector) + ";"
                    " if (e) e.scrollIntoView({block:'center', inline:'center'}); })()")
        time.sleep(0.4)
        try:
            left, top, w, h, dpr, vh = self.rect(selector)
        except RuntimeError:
            return None
        if top >= 0 and top + h <= vh and w >= 10 and h >= 10:
            return left, top, w, h, dpr
        return None

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
        box = self.reach(selector)
        tx = ty = None
        got = None
        for attempt in range(3):
            # ⛔ RE-MEASURE THE BOX, DO NOT REUSE THE ONE REACH RETURNED. A
            # hydrating page moves its own controls: measured on the Console
            # login page 2026-10-25, the email field was at clientY 469-509
            # when reach() measured it and the pointer landed at clientY 535
            # with a *correct* offset (re-learned from that very sighting as
            # 0,143) -- the field had moved ~44px while the hand was
            # travelling, and clientY does not move with scrolling, so that was
            # a layout shift, not a scroll. Aiming at a remembered box is
            # aiming at where a control used to be.
            if attempt:
                box = self.reach(selector)
            left, top, w, h, dpr = box
            # ⛔ A RETRY MUST MOVE, OR IT CANNOT TELL ITSELF ANYTHING. The aim
            # point used to be computed ONCE, so a failed attempt re-issued the
            # same coordinates -- and xdotool moving the pointer to where it
            # already is generates NO mousemove, so the page had nothing to
            # report and `seen()` returned None again. The first attempt can
            # legitimately race a hydrating page's blocked renderer; attempts
            # two and three were then guaranteed to fail for a different and
            # invisible reason. Measured on the Console login page 2026-10-25:
            # two runs failed with "page saw None" while the pointer was ON the
            # field (aim 1007,497, pointer 1008,641, offset 1,144 -- correct),
            # and one re-learned dx as 89 from a bogus edge sighting.
            # So: a fresh point inside the box every attempt, and on a retry a
            # step away first, which is also what a hand that missed does.
            tx, ty = (left + w * random.uniform(0.3, 0.7),      # off-centre, well inside
                      top + h * random.uniform(0.3, 0.7))
            if attempt:
                self.move_screen(round(self.dx + tx * dpr) - random.randint(40, 70),
                                 round(self.dy + ty * dpr) - random.randint(25, 50))
            self.move_screen(round(self.dx + tx * dpr), round(self.dy + ty * dpr), width=w * dpr)
            # A busy page (scripts still running on a fresh load) delivers the
            # mousemove late: 50 ms read null on every try in a new pod, and
            # platform.claude.com blocks its renderer for longer than that
            # while it hydrates. Wait for the sighting before judging the aim.
            for _ in range(20):
                time.sleep(0.08)
                got = self.seen()
                if got:
                    break
            hit = got and self.b.eval(
                f"(() => {{ const t = {el(selector)}, e = document.elementFromPoint({got[0]}, {got[1]});"
                f" return !!(t && e && (t === e || t.contains(e) || e.control === t)); }})()")
            if hit:
                break
            vw, vh = self.b.eval("[innerWidth, innerHeight]")
            if got and 2 < got[0] < vw - 2 and 2 < got[1] < vh - 2:   # a fresh sighting, not an edge
                sx, sy = self.where()
                self.dx, self.dy = sx - got[0] * dpr, sy - got[1] * dpr
        else:
            raise RuntimeError(f"pointer would not land on {locname(selector)} (aim {tx:.0f},{ty:.0f} offset {self.dx:.0f},{self.dy:.0f}"
                               f" page saw {got} pointer {self.where()})")
        pre, dwell = hm.press_timing(CFG)
        xdo("sleep", f"{pre:.3f}", "mousedown", "1", "sleep", f"{dwell:.3f}", "mouseup", "1")

    def click_point(self, cx, cy):
        """Click a CLIENT (CSS px) point, not an element centre. For a target
        inside a cross-origin out-of-process iframe (a Turnstile checkbox),
        which querySelector in the top document cannot reach but a real XTEST
        OS click can -- it hit-tests to the frame the way a real cursor does,
        where a CDP mouse event into an OOPIF hangs un-acked (alpaca measured
        4/6, 2026-10-19). Requires the offset already calibrated."""
        dpr = self.b.eval("devicePixelRatio") or 1
        self.move_screen(round(self.dx + cx * dpr) - random.randint(20, 45),
                         round(self.dy + cy * dpr) - random.randint(10, 28))
        self.move_screen(round(self.dx + cx * dpr), round(self.dy + cy * dpr))
        pre, dwell = hm.press_timing(CFG)
        xdo("sleep", f"{pre:.3f}", "mousedown", "1", "sleep", f"{dwell:.3f}", "mouseup", "1")

    def type(self, text, sensitive=False):
        """Keystroke program from humanmotion: typos with corrections unless
        `sensitive` (passwords, cards, amounts: memo 0e09d689)."""
        for op in hm.type_program(text, CFG, sensitive=sensitive):
            time.sleep(op["delay"])
            if op["op"] == "backspace":
                xdo("key", "--clearmodifiers", "BackSpace")
            elif ord(op["char"][0]) > 127:
                # ⛔ xdotool cannot type a character the US keymap lacks: it
                # remaps a spare keycode, sends, and reverts before Chrome has
                # read the new mapping, so the key is dropped while xdotool
                # reports success. Measured 2026-10-27, r8 Inkling: "·" was
                # missing from the field on 4 of 4 forms. A real user gets
                # such a character from an OS input method too, so commit it
                # as text.
                self.b.send("Input.insertText", {"text": op["char"]})
            else:
                xdo("type", "--clearmodifiers", "--delay", "0", "--", op["char"])

    def ensure_focus(self, tries=8):
        """Give the Chrome window X INPUT FOCUS so XTEST keystrokes reach it.

        ⛔ THE PERVASIVE INPUT BUG. Under Xvfb with no window manager, X focus
        is not granted to a window on its own, and a NAVIGATION leaves the new
        document without it: document.hasFocus() reads false and every
        synthesized keystroke is delivered to the root window and dropped,
        while the page's mousemove listener never fires so calibrate() also
        fails with "page saw no pointer movement". Measured on Amazon
        /ap/signin 2026-10-25: hasFocus false, zero iframes, field auto-focused,
        20 keystrokes -> value length 0; a trivial page in the SAME container
        typed fine, because its first click happened to re-focus the window.
        The single windowfocus + warp run_session does at startup is spent on
        about:blank and does not survive the nav to the page a flow drives.

        windowfocus is XSetInputFocus -- the X-level focus a WM would grant,
        and the only one that routes KEY events, which follow input focus, not
        the pointer. Page.bringToFront is Chrome's own focus; a real pointer
        motion generates the crossing some builds additionally want. Do all
        three, verify from the page, and retry: cheap when focus is already
        held (one eval returns at once), decisive when it is not."""
        # ⭐ The renderer-level fix for the real cause. Measured 2026-10-25 on
        # Amazon /ap/signin: X input focus WAS on the right Chrome window
        # (getwindowfocus == the 1919x1079 content window) and the pointer WAS
        # over it, yet document.hasFocus() stayed false and no mousemove or
        # keystroke reached the page. A cross-process navigation makes a fresh
        # RenderWidget that, with no window manager to activate it, starts
        # blurred -- so Chrome drops the input it is handed. setFocusEmulationEnabled
        # tells the renderer to consider itself focused regardless of the
        # missing activation; it persists for the session, so one call suffices.
        try:
            self.b.send("Emulation.setFocusEmulationEnabled", {"enabled": True})
        except Exception:
            pass
        sw, sh = (int(v) for v in SCREEN.split("x")[:2])
        for _ in range(tries):
            try:
                if self.b.eval("document.hasFocus()"):
                    return True
            except RuntimeError:
                pass
            # ⛔ A FOCUS *TRANSITION*, NOT A STATIC RE-FOCUS. A cross-process
            # navigation builds a new RenderWidgetHostView, and on X11/Ozone with
            # no WM it only takes focus on a FocusIn event -- which XSetInputFocus
            # to the already-focused window never emits. So focus a DIFFERENT
            # Chrome window first (Chrome keeps a tiny aux window beside the
            # content one), then the content window, forcing the FocusOut/FocusIn
            # the new view needs. This is why a same-process data: page typed and
            # a navigated-to site did not, with focus and a WM both already right.
            wins = self._chrome_windows()
            if wins:
                content = wins[-1][0]
                aux = next((w for w, area in wins if w != content), None)
                try:
                    if aux:
                        xdo("windowfocus", "--sync", aux)
                        time.sleep(0.05)
                    xdo("windowfocus", "--sync", content)
                except RuntimeError:
                    pass
            try:
                self.b.send("Page.bringToFront")
            except Exception:
                pass
            try:
                xdo("mousemove", "1", "1", "sleep", "0.03",
                    "mousemove", str(sw // 2 + random.randint(-60, 60)),
                    str(sh // 2 + random.randint(-60, 60)))
            except RuntimeError:
                pass
            time.sleep(0.2)
        try:
            return bool(self.b.eval("document.hasFocus()"))
        except RuntimeError:
            return False

    def _chrome_windows(self):
        """Our Chrome's X windows as (id, area), smallest first -- the content
        window is the largest (last). For the focus cycle in ensure_focus."""
        out = []
        try:
            wins = xdo("search", "--class", "google-chrome").split()
        except RuntimeError:
            wins = []
        for w in wins:
            try:
                g = xdo("getwindowgeometry", "--shell", w)
                d = dict(l.split("=", 1) for l in g.splitlines() if "=" in l)
                out.append((w, int(d.get("WIDTH", 0)) * int(d.get("HEIGHT", 0))))
            except (RuntimeError, ValueError):
                pass
        out.sort(key=lambda t: t[1])
        return out

    KEYMAP = {
        "Enter":     ("Enter", "Enter", 13, "\r", "Return"),
        "Tab":       ("Tab", "Tab", 9, None, "Tab"),
        "Space":     (" ", "Space", 32, " ", "space"),
        "Escape":    ("Escape", "Escape", 27, None, "Escape"),
        "Backspace": ("Backspace", "Backspace", 8, None, "BackSpace"),
        "ArrowDown": ("ArrowDown", "ArrowDown", 40, None, "Down"),
    }

    def press(self, name):
        """Press a named key over XTEST -- Enter to submit, Space to toggle a
        focused checkbox, Tab to move on. isTrusted hardware key, like type()."""
        sym = self.KEYMAP.get(name, (name,))[-1]
        xdo("key", "--clearmodifiers", sym)


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




def load_contact():
    """The outreach lane's contact job lives in drover/outreach/contact.py
    (the lane owns that file; this one is unibrowse's). Loaded by path, next to
    this worker in the repo and in the image alike."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("contact", os.path.join(HERE, "..", "outreach", "contact.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


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


def job_session(b, url, steps, out, shot):
    """Drive a PERSISTENT profile through a declared sequence of steps.

    Ben, #unibrowse 2026-10-25: "work with drover to get many of our automated
    stuff on there, alpaca, Claude etc". Those automations are the opposite
    shape to the outreach swarm -- one account, one browser, serially, and the
    whole value is the session that SURVIVES the run. Every other job in this
    file throws its profile away on purpose.

    ⛔ REFUSES WITHOUT DROVER_PROFILE. A session job on a temp profile logs in,
    does the work, and then deletes the login. That reads as success and is the
    expensive failure: these accounts rate-limit the login itself, so a lost
    session costs a real attempt, not just a retry. Mint-and-lose is worse than
    not running.

    Steps are DATA, so porting an automation is a JSON file rather than an edit
    here -- which also leaves job_contact's shared Hands/reach path untouched.

      [{"do": "nav",    "url": "https://platform.claude.com/login"},
       {"do": "click",  "sel": "input[type=email]"},
       {"do": "type",   "env": "DROVER_LOGIN_EMAIL", "sel": "input[type=email]"},
       {"do": "expect", "sel": "input[type=email]", "value": "a@b.c"},
       {"do": "read",   "sel": "body", "as": "page"}]

    ⭐ `expect` is the step that matters and the reason this is not just a
    macro runner. v1's Console login clicked a button and never checked that
    the click landed; it came back to an unchanged page with no error, and the
    run was scored as a site refusal for three days (measured 2026-10-25). A
    step that asserts what it just did turns that into a named failure.
    """
    if not b.keep:
        raise SystemExit("session: refusing to run without DROVER_PROFILE -- "
                         "a login driven into a temp profile is discarded on exit")
    h = Hands(b)
    # ⛔ X INPUT FOCUS, NOT JUST WINDOW ACTIVATION. xdotool type delivers to
    # whichever window holds X input focus. Under Xvfb there is no window
    # manager to grant it, windowactivate quietly fails (raise_window ignores
    # that by design), and the keystrokes land on the root window. Measured
    # 2026-10-25: focus and type both reported ok on every step and the field
    # stayed empty -- the silent success `expect` exists to catch.
    win = b.raise_window()
    if win:
        try:
            xdo("windowfocus", "--sync", win)
        except RuntimeError:
            pass
    # ⛔ AND PARK THE POINTER INSIDE THE WINDOW. With no WM, X keeps the default
    # PointerRoot focus, so keystrokes are delivered to the window UNDER THE
    # POINTER rather than to whatever holds a focus a WM would have granted.
    # The outreach lane only types successfully because calibrate() walks the
    # pointer across the page first, as a side effect nothing names. A flow
    # that focuses a field and types -- no pointer aiming anywhere -- leaves it
    # wherever Chrome started it and every keystroke is swallowed, with
    # xdotool reporting success. Measured 2026-10-25: focus ok, type ok, field
    # empty. Screen centre is inside a maximised window on any geometry, and
    # needs none of the dx/dy calibration that aiming does.
    try:
        sw, sh = (int(v) for v in SCREEN.split("x")[:2])
        xdo("mousemove", str(sw // 2), str(sh // 2))
    except (RuntimeError, ValueError):
        pass
    # Pointer calibration is for AIMING only, and it can fail outright on a
    # page that swallows mousemoves. A flow that only focuses and types must
    # not die for that, so it runs on the first click step instead of up front.
    calibrated = [False]
    log, reads = [], {}

    def target(st):
        """The LOCATOR a step acts on, and what it resolves to right now.

        `text` narrows `sel` to the element whose visible text matches, which
        is how a real page names its submit button -- CSS cannot express it,
        and v1 found these with an innerText regex for the same reason.

        ⛔ It returns the question, never a resolved path: see FIND_JS above for
        the three Console runs that measured why. The detail is for the log and
        for the no-match report only -- the step that acts re-resolves the
        locator itself. Resolution is POLLED, because "nothing matches" and
        "the render has not landed yet" are the same answer read at two
        different moments, and one of those three runs failed only that way.
        """
        # ⭐ `sel` may be {"from": "<name>"}, taking the selector from a
        # previous read or await. A flow cannot always know its next selector
        # when it starts: the page after a login submit has never been measured
        # here, and measuring it REQUIRES the submit. So the orchestrator drops
        # the selector in a file mid-run, the way it already drops the emailed
        # code, instead of this file shipping a guess that gets one attempt
        # against a login that rate-limits attempts.
        sel = st.get("sel")
        if isinstance(sel, dict) and sel.get("from"):
            sel = reads[sel["from"]]
        if not st.get("text"):
            return sel, None
        loc = {"sel": sel or "button,a,input,[role=button]",
               "text": st["text"], "nth": int(st.get("nth", 0))}
        return loc, describe(b, loc, seconds=float(st.get("resolveSeconds", 10)))

    def note(i, st, status, extra=None):
        row = {"i": i, "do": st.get("do"), "status": status}
        if st.get("sel"):
            row["sel"] = st["sel"]
        if extra:
            row.update(extra)
        log.append(row)
        return status == "ok"

    if url and url != "about:blank":
        b.navigate(url)
    for i, st in enumerate(steps):
        do = st.get("do")
        try:
            if do == "nav":
                # `referrer` makes an in-site nav look like a followed link
                # (same-origin Referer + Sec-Fetch-Site: same-origin); the
                # literal "current" uses wherever the browser is right now, so a
                # flow need not know its own URL at author time. `transition`
                # sets Page.navigate's transitionType ("link" for a followed
                # link). Omit both for the first/typed load of a host.
                ref = st.get("referrer")
                if ref == "current":
                    try:
                        ref = b.eval("location.href")
                    except RuntimeError:
                        ref = None
                b.navigate(st["url"], referrer=ref, transition=st.get("transition"))
                note(i, st, "ok", {"url": st["url"],
                                   "ref": (ref.split("?", 1)[0][:60] if ref else None),
                                   "transition": st.get("transition")})
            elif do == "reload":
                b.navigate(b.eval("location.href"), settle=float(st.get("settle", 2.0)))
                note(i, st, "ok")
            elif do == "click":
                loc, m = target(st)
                if st.get("text") and m is None:
                    note(i, st, "no-match", {"text": st.get("text")})
                    break
                # ⛔ Hands.click RETURNS NONE ON SUCCESS -- it has no return
                # statement -- and RAISES on a genuine miss. Testing its return
                # value therefore labels every successful click a failure. I
                # shipped exactly that in 47351c4, read the resulting
                # "unreachable" on three landed clicks as a bug in Hands, and
                # warned the outreach lane about a false negative that does not
                # exist. The absence of an exception IS the success signal.
                if not calibrated[0]:
                    h.ensure_focus()
                    h.calibrate()
                    calibrated[0] = True
                h.click(loc)
                note(i, st, "ok", {"matched": m} if m else None)
            elif do == "clickxy":
                # Click a point relative to an anchor element -- for a target in
                # a cross-origin iframe (a Turnstile checkbox) that querySelector
                # cannot reach. `sel` is the anchor (the iframe), `ox` the x
                # offset from its left edge in CSS px, `oyf` the y as a fraction
                # of its height. A real XTEST OS click lands in the OOPIF.
                if not calibrated[0]:
                    h.ensure_focus()
                    h.calibrate()
                    calibrated[0] = True
                # Anchor rect: a selector's rect, or a `rectjs` expression that
                # returns [left,top,w,h,dpr] -- for a widget that querySelector
                # cannot name directly (e.g. iframe-or-container fallback).
                if st.get("rectjs"):
                    box = h.b.eval(st["rectjs"])
                    if not box:
                        note(i, st, "no-element", {"rectjs": True})
                        break
                else:
                    box = h.rect(st["sel"])          # [left, top, w, h, dpr, innerHeight]
                px = box[0] + float(st.get("ox", box[2] / 2))
                py = box[1] + box[3] * float(st.get("oyf", 0.5))
                h.click_point(px, py)
                note(i, st, "ok", {"xy": [round(px), round(py)]})
            elif do == "scroll":
                # Human-shaped XTEST scroll: wheel bursts + arrow keys, pauses,
                # overshoot-and-back. Positive `notches` scrolls up, negative
                # down. The wheel acts on what is under the pointer, so calibrate
                # first (scroll parks the pointer over the page).
                if not calibrated[0]:
                    h.ensure_focus()
                    h.calibrate()
                    calibrated[0] = True
                n = int(st.get("notches", -3))
                h.scroll(n)
                note(i, st, "ok", {"notches": n})
            elif do == "drag":
                # Press on one element, carry, release on another -- XTEST drag.
                # `from`/`to` are locators (a CSS string or a {sel,text} dict).
                if not calibrated[0]:
                    h.ensure_focus()
                    h.calibrate()
                    calibrated[0] = True
                h.drag(st["from"], st["to"])
                note(i, st, "ok", {"from": st["from"], "to": st["to"]})
            elif do == "type":
                # ⛔ A credential passed on the command line is world-readable
                # through `ps` for every user on the box, which is why
                # realinput.py grew --text-stdin. Here the value comes from the
                # environment and never enters argv, the steps file, or the log.
                # `from` takes the value a previous read/await stored. A code
                # that arrived mid-run is single-use by nature, so it is
                # sensitive whether or not the caller says so.
                secret = bool(st.get("env")) or bool(st.get("from")) or bool(st.get("sensitive"))
                if st.get("env"):
                    text = os.environ[st["env"]]
                elif st.get("from"):
                    text = reads[st["from"]]
                else:
                    text = st["text"]
                # Focus the window so the XTEST keystrokes land, then type.
                h.ensure_focus()
                if secret:
                    # ⛔ LEAK GUARD (memo 1166f986, 2026-11-01): a bare type sent
                    # the eBay password to the Chrome OMNIBOX -> Google search.
                    # XTEST lands wherever OS focus is, and a `focus` step's
                    # "ok" does not prove it is the field. So a secret is typed
                    # only into a NAMED field that (1) is document.activeElement,
                    # (2) in a document that has OS focus (hasFocus() is false
                    # while the omnibox holds it), and (3) visibly received a
                    # harmless canary keystroke, which is then erased. Any miss
                    # aborts BEFORE a secret character is sent.
                    # A code read mid-run (`from`) may go to a widget that
                    # filters keys (split OTP boxes), so it gets the focus
                    # check without the canary and may omit `sel`; an `env`
                    # value (a password) must name its field and pass both.
                    canary = bool(st.get("env"))
                    s0 = None
                    if st.get("sel") or st.get("text"):
                        loc, m = target(st)
                        chk = ("(()=>{const e=%s;if(!e)return null;e.focus();"
                               "return {a:document.activeElement===e,f:document.hasFocus(),"
                               "v:(e.value||'').length}})()" % el(loc))
                    elif canary:
                        note(i, st, "refused", {"why": "secret env type needs sel"})
                        break
                    else:
                        chk = ("(()=>{const e=document.activeElement;"
                               "return {a:!!e&&(/^(INPUT|TEXTAREA)$/.test(e.tagName)||e.isContentEditable),"
                               "f:document.hasFocus(),v:e&&e.value?e.value.length:0}})()")
                    s0 = b.eval(chk)
                    if not s0 or not s0.get("a") or not s0.get("f"):
                        note(i, st, "not-focused", {"state": s0})
                        break
                    if canary:
                        xdo("key", "--clearmodifiers", "0")
                        time.sleep(0.25)
                        s1 = b.eval(chk)
                        if not s1 or s1.get("v") != s0["v"] + 1:
                            note(i, st, "canary-missed", {"before": s0, "after": s1})
                            break
                        h.press("Backspace")
                        time.sleep(0.25)
                        s2 = b.eval(chk)
                        if not s2 or s2.get("v") != s0["v"] or not s2.get("f"):
                            note(i, st, "canary-not-cleared", {"state": s2})
                            break
                h.type(text, sensitive=secret)
                if secret and canary:
                    s3 = b.eval(chk)
                    if not s3 or s3.get("v") != s0["v"] + len(text):
                        note(i, st, "value-mismatch", {"chars": len(text),
                                                       "fieldLen": (s3 or {}).get("v")})
                        break
                note(i, st, "ok", {"chars": len(text), "value": "***" if secret else text})
            elif do == "read":
                # ⚠️ textContent, never innerText: innerText needs layout and
                # reads 0 on a fully rendered page in a headless window
                # (measured 2026-10-25), which looks exactly like a blank page.
                loc = target(st)[0] if (st.get("sel") or st.get("text")) else "body"
                v = b.eval("(()=>{const e=%s;"
                           "return e?e.textContent.replace(/\\s+/g,' ').trim():null})()"
                           % el(loc))
                reads[st.get("as", "read%d" % i)] = v
                note(i, st, "ok" if v is not None else "missing",
                     {"chars": len(v) if v else 0})
            elif do == "press":
                # Press a named key, optionally after focusing a selector.
                # Submit and checkbox toggle WITHOUT a mouse: the CDP mouse path
                # does not actuate controls in this container (measured
                # 2026-10-25: hit-testable #signInSubmit / #auth-remember-me did
                # not fire on a CDP click), while a key event on the focused
                # control does. `ensure_focus` first so the key is not dropped.
                h.ensure_focus()
                if st.get("sel") or st.get("text"):
                    loc, m = target(st)
                    if st.get("text") and m is None:
                        note(i, st, "no-match", {"text": st.get("text")})
                        break
                    if not b.eval("(()=>{const e=%s;if(!e)return false;e.focus();"
                                  "return document.activeElement===e})()" % el(loc)):
                        note(i, st, "not-focused", {"key": st.get("key", "Enter")})
                        break
                h.press(st.get("key", "Enter"))
                note(i, st, "ok", {"key": st.get("key", "Enter")})
            elif do == "expect":
                # Asserts the page is where the previous step should have put
                # it. `value` checks a field actually holds what we typed --
                # the check whose absence hid a truncated address for a day.
                loc, m = target(st)
                # ⚠️ `value` ONLY FOR A CONTROL THAT HAS ONE. Every <button>
                # carries value="" as a DOM property, so preferring value
                # wherever it is defined read the submit button as "" --
                # measured 2026-10-25, three runs out of three, AFTER the
                # locator change had made the resolution itself deterministic.
                # I had attributed that empty read to the path race; it was
                # this. An `expect` with no `value` then passes on "", which
                # looks like a verified page and verified nothing.
                js = ("(()=>{const e=%s;if(!e)return null;"
                      "return /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)"
                      "?e.value:e.textContent.replace(/\\s+/g,' ').trim()})()"
                      % el(loc))
                # env_value keeps the expected value out of the steps file for
                # the same reason `type` takes env: an address or secret in a
                # file on disk is a copy nobody tracks.
                # `from_value` asserts a field holds a value that arrived
                # mid-run -- the emailed code. ⛔ IT IS SENSITIVE BY NATURE, so
                # the comparison happens here and the value never reaches the
                # log: a 6-digit code printed into a step row is a credential
                # written to disk by the thing built to avoid that.
                secret = bool(st.get("from_value")) or bool(st.get("sensitive"))
                if st.get("from_value"):
                    want = reads[st["from_value"]]
                elif st.get("env_value"):
                    want = os.environ[st["env_value"]]
                else:
                    want = st.get("value")

                def holds(v):
                    if want is None:
                        return v is not None
                    if st.get("contains"):
                        return bool(v) and want in v
                    return v == want

                # ⛔ POLL, DO NOT SAMPLE ONCE. xdotool returns when it has SENT
                # the keystrokes, not when the page has processed them, so a
                # read taken straight after `type` can see n-1 characters:
                # measured 2026-10-25, "agents2@sack.i" for a 15-character
                # address, one run in four. v1's probe made exactly this
                # mistake and its "agents2@sac" was read as a site refusal for
                # three days -- a one-shot assertion here would have
                # reproduced that bug inside the thing built to catch it.
                # ⚠️ The deadline is what keeps this an assertion: a value that
                # is genuinely wrong still fails, it just takes `seconds` to
                # say so.
                dl = time.time() + float(st.get("seconds", 8))
                while True:
                    got = b.eval(js)
                    ok = holds(got)
                    if ok or time.time() >= dl:
                        break
                    time.sleep(float(st.get("poll", 0.4)))
                # ⚠️ REPORT WHAT MATCHED, not just what it said. A text-matched
                # control can resolve correctly and still read textContent ""
                # -- the match may have come from value or aria-label -- and an
                # `expect` with no `value` then passes on an empty string,
                # which looks like it verified something and did not. The
                # resolved tag, label and `disabled` are the evidence, and for
                # a submit button they are the thing worth seeing BEFORE a run
                # that presses it.
                extra = ({"gotChars": len(got) if isinstance(got, str) else None,
                          "got": "***"} if secret else
                         {"got": (got[:120] if isinstance(got, str) else got)})
                if st.get("text"):
                    extra["matched"] = m
                if not note(i, st, "ok" if ok else "failed", extra):
                    break
            elif do == "waitfor":
                # ⛔ A FIXED SLEEP IS THE WRONG TOOL ON THESE PAGES. claude.ai
                # and platform.claude.com render NOTHING for a long time on a
                # cold profile -- readyState stays "interactive" with an empty
                # body for up to ~60s, and app.thimble.com's bundle measured
                # 122s. A `wait` long enough to be safe is wasted on every
                # fast load, and one short enough to be quick fails as a
                # selector miss further down. Poll for the element instead.
                # A locator, so a flow can wait for the control a person
                # reads ("the Continue button") and not only for a CSS shape.
                loc = target(st)[0]
                t0 = time.time()
                dl = t0 + float(st.get("seconds", 60))
                found, still = False, None
                while time.time() < dl:
                    if b.eval("!!(%s)" % el(loc)):
                        found = True
                        break
                    time.sleep(float(st.get("poll", 1)))
                # ⛔ "IT EXISTS" IS NOT "IT HAS STOPPED MOVING", and the
                # difference broke the click twice. `still` waits for the box
                # to hold position: on the Console login page the input existed
                # at waitedSec 0.0 and the page then shifted it ~44px while the
                # hand was travelling, so the press landed below the field.
                # Cheap insurance -- two rects, 300ms apart -- and it only
                # costs the pages that are actually still settling.
                found_at = time.time()
                if found and st.get("still"):
                    prev = None
                    while time.time() < dl:
                        r = b.eval("(()=>{const e=%s;if(!e)return null;const r="
                                   "e.getBoundingClientRect();return [r.left,r.top]})()"
                                   % el(loc))
                        if prev and r and abs(r[0] - prev[0]) < 2 and abs(r[1] - prev[1]) < 2:
                            break
                        prev = r
                        time.sleep(0.3)
                    still = round(time.time() - found_at, 1)
                # Two numbers, because they are two different facts: how long
                # the control took to appear, and how long it then went on
                # moving. Measured on the Console login page, the second is
                # 7-11s while the first can be 0.3s -- which is exactly the
                # window the earlier clicks were pressing into.
                if not note(i, st, "ok" if found else "timeout",
                            {"waitedSec": round(found_at - t0, 1), "stillSec": still}):
                    break
            elif do == "waiturl":
                # ⛔ WAIT ON THE URL, NOT A FIXED SLEEP OR AN UNMEASURED DOM.
                # The one place this is the only honest signal: an OAuth
                # Authorize click lands on a callback ~90s later (the SKILL
                # measured the console callback at ~90s), over a network-bound
                # redirect whose timing a fixed `wait` cannot match, onto a page
                # whose DOM this flow has never seen -- so there is no element to
                # `waitfor`. location.href reaching the callback IS the landing,
                # and its query carries the code. Poll it to a deadline.
                pat, sub = st.get("match"), st.get("contains")
                rx = re.compile(pat) if pat else None
                t0 = time.time()
                dl = t0 + float(st.get("seconds", 120))
                href = None
                while time.time() < dl:
                    cur = b.eval("location.href")
                    if cur and (rx.search(cur) if rx else (sub in cur if sub else True)):
                        href = cur
                        break
                    time.sleep(float(st.get("poll", 2)))
                if href is None:
                    last = b.eval("location.href") or ""
                    note(i, st, "timeout", {"waitedSec": round(time.time() - t0, 1),
                                            "last": last.split("?", 1)[0][:120]})
                    break
                # ⛔ THE HREF CAN CARRY A SINGLE-USE CREDENTIAL (an OAuth code in
                # a query param), so it goes straight to a 600 file like `cookie`
                # and `code` -- never into the logged `reads` or the step row,
                # which record only the path it reached, never the query.
                if st.get("write"):
                    dest = pathlib.Path(st["write"])
                    dest.touch(mode=0o600, exist_ok=True)
                    os.chmod(dest, 0o600)
                    dest.write_text(href)
                else:
                    reads[st.get("as", "url%d" % i)] = href
                note(i, st, "ok", {"waitedSec": round(time.time() - t0, 1),
                                   "path": href.split("?", 1)[0][:120],
                                   "wrote": st.get("write")})
            elif do == "focus":
                # ⭐ A LOGIN FORM DOES NOT NEED A POINTER. `click` aims XTEST at
                # a screen coordinate and refuses when calibration says the
                # point is off-window -- correct, but it makes filling a field
                # depend on window geometry that varies by host (measured
                # 2026-10-25 under docker on office: dx came back negative and
                # scaled with the probe point, i.e. a devicePixelRatio
                # mismatch, so every click refused while the same image clicks
                # fine in a pod).
                # focus + type keeps what actually matters: the KEYSTROKES are
                # still XTEST, still isTrusted, still humanmotion-timed. Only
                # the caret placement is scripted, and it is verified below
                # rather than assumed.
                # ⚠️ MEASURED LIMIT, 2026-10-25: focus alone did NOT make
                # typing land under Xvfb. activeElement was the field, the
                # pointer was parked inside the window, xdotool reported
                # success, and the field stayed empty. The same page typed
                # fine once a click had moved the pointer ONTO the field. With
                # no WM there is no _NET_ACTIVE_WINDOW (getactivewindow errors
                # outright), so treat `focus` as useful for firing a page's
                # focus handlers, NOT as a substitute for clicking before you
                # type.
                loc, m = target(st)
                if st.get("text") and m is None:
                    note(i, st, "no-match", {"text": st.get("text")})
                    break
                h.ensure_focus()
                ok = b.eval("(()=>{const e=%s;if(!e)return false;"
                            "e.focus();return document.activeElement===e})()"
                            % el(loc))
                if not note(i, st, "ok" if ok else "not-focused"):
                    break
            elif do == "await":
                # ⛔ WHY THIS EXISTS AND WHY IT IS NOT TWO RUNS. A magic-link
                # login needs a value that arrives by EMAIL, mid-flow. Splitting
                # it into two session invocations loses the attempt: the code is
                # issued against the sign-in the browser already started, and
                # v1's own note records that it "has to be typed back into the
                # very tab that asked for it". So the browser stays up and waits
                # here while the orchestrator drops the value in a file.
                # ⚠️ The value is a single-use credential. Only its length is
                # logged, never the value, and it is typed via {"from": ...}
                # which forces the sensitive path.
                path, dl = st["path"], time.time() + float(st.get("seconds", 300))
                val = None
                while time.time() < dl:
                    try:
                        t = open(path).read().strip()
                        if t:
                            val = t
                            break
                    except FileNotFoundError:
                        pass
                    time.sleep(float(st.get("poll", 2)))
                if val is None and st.get("default") is not None:
                    # ⭐ A DEFAULT TURNS THE WAIT INTO AN OVERRIDE WINDOW rather
                    # than a dependency. The post-submit page is unmeasured, so
                    # the flow carries its best guess at the next selector and
                    # gives the orchestrator a window to replace it from what it
                    # can see (a screenshot lands while this waits). Without
                    # this, a login attempt that cost a real single-use link
                    # would be thrown away because nobody was watching.
                    val = st["default"]
                    reads[st.get("as", "await%d" % i)] = val
                    note(i, st, "default", {"chars": len(val)})
                    continue
                if val is None:
                    note(i, st, "timeout", {"path": path})
                    break
                reads[st.get("as", "await%d" % i)] = val
                note(i, st, "ok", {"chars": len(val)})
            elif do == "eval":
                # ⛔ READ ONLY, AND THAT IS A RULE ABOUT THIS STEP, NOT A
                # LIMITATION OF IT. Scripted input is exactly what this worker
                # exists not to produce: clicks and keystrokes go through
                # Hands (XTEST, isTrusted, humanmotion-timed). An eval that
                # sets a value or calls .click() would look like success and
                # hand the site the one signal the rest of this file spends
                # real effort not to emit.
                # It exists because diagnosing a failed click took three runs
                # of adding temporary code to this file: "what is actually
                # under that point" is a question a flow should be able to ask.
                reads[st.get("as", "eval%d" % i)] = v = b.eval(st["js"])
                # ⭐ `write` sends the value OUT to the orchestrator mid-run,
                # the same way `await` brings one in. That closes the loop: a
                # flow can report what it is looking at and be told what to do
                # about it, instead of a human reading a screenshot inside a
                # 90-second window. ⛔ Never write a credential this way -- the
                # share directory is a file on disk.
                if st.get("write"):
                    pathlib.Path(st["write"]).write_text("" if v is None else str(v))
                note(i, st, "ok", {"value": (v if isinstance(v, (int, float, bool)) else
                                             str(v)[:300] if v is not None else None),
                                   "wrote": st.get("write")})
            elif do == "delcookies":
                # Delete cookies whose domain contains `domain` (and name
                # matches `match`, if given). ⭐ WHY: HTTP 431 (request header
                # too large) after a transplant + native re-login stacks two
                # cookie sets on one site -- measured on eBay 2026-11-01, every
                # www.ebay.com request 431'd. `dry: true` only reports. Logs
                # NAMES and value LENGTHS, never values.
                dom, pat = st["domain"], st.get("match")
                rx = re.compile(pat) if pat else None
                hit = [c for c in b.cookies() if dom in (c.get("domain") or "")
                       and (not rx or rx.search(c.get("name") or ""))]
                info = sorted(((c.get("domain") or "") + " " + (c.get("name") or "")
                               + " " + str(len(c.get("value") or "")) for c in hit))
                if not st.get("dry"):
                    for c in hit:
                        b.send("Network.deleteCookies", {"name": c["name"],
                               "domain": c.get("domain"), "path": c.get("path") or "/"})
                note(i, st, "ok", {"count": len(hit), "bytes": sum(len(c.get("value") or "") + len(c.get("name") or "") for c in hit),
                                   "dry": bool(st.get("dry")), "cookies": info[:80]})
            elif do == "cookie":
                # ⛔ VALUE STRAIGHT TO DISK, NEVER THROUGH THE LOG. The step
                # row carries the name, whether it was found, and the length.
                # A sessionKey in a step row would be a credential written into
                # a result file by the thing built to hand it over safely.
                # ⭐ `match` (a regex on the name) rather than `name`, because
                # some apps put identifiers IN the cookie name: Alpaca's are
                # CognitoIdentityServiceProvider.<clientId>.<sub>.accessToken,
                # so an exact name would hardcode one user's sub into a flow
                # and silently miss on every other account.
                want, dom, pat = st.get("name"), st.get("domain"), st.get("match")
                if not want and not pat:
                    raise KeyError("name or match")
                rx = re.compile(pat) if pat else None
                hit = [c for c in b.cookies()
                       if (c.get("name") == want if want else rx.search(c.get("name") or ""))
                       and (not dom or dom in (c.get("domain") or ""))]
                if not hit:
                    # NAMES are not credentials, and "no such cookie" is
                    # useless without them: it cannot distinguish a wrong name
                    # from a profile with no session from a CDP call that
                    # returned nothing at all.
                    seen = sorted({(c.get("domain") or "") + " " + (c.get("name") or "")
                                   for c in b.cookies()})
                    note(i, st, "no-cookie", {"name": want, "match": pat, "domain": dom,
                                              "present": seen[:40], "total": len(seen)})
                    break
                val = hit[0].get("value") or ""
                dest = pathlib.Path(st["write"])
                # Mode BEFORE content: a file created 644 and chmod'd after is
                # world-readable for the moment in between, and that moment is
                # on a host other agents share.
                dest.touch(mode=0o600, exist_ok=True)
                os.chmod(dest, 0o600)
                dest.write_text(val)
                # The name REPORTED is the one that matched, not the one
                # asked for: with `match` those differ, and the matched name is
                # the fact worth having.
                note(i, st, "ok", {"name": hit[0].get("name"), "matches": len(hit),
                                   "chars": len(val), "wrote": str(dest),
                                   "httpOnly": hit[0].get("httpOnly"),
                                   "expires": hit[0].get("expires")})
            elif do == "setcookies":
                # ⛔ VALUES NEVER THROUGH THE LOG, SAME RULE AS `cookie`. The
                # cookies come from a file (`from`, a 600 file in the mounted
                # share dir the orchestrator writes and deletes), so no token
                # is ever in steps.json, in argv, or in a result row -- only
                # the NAMES set are reported.
                # ⭐ WHY A STEP. Transplanting a kept session (Amazon, eBay,
                # DoorDash) from a browser that is already logged in is how a
                # profile gets warm without re-entering a password or a 2FA
                # code. Storage.setCookies is browser-wide and carries httpOnly
                # cookies (at-main/x-main/session-token), which document.cookie
                # and an eval cannot set -- which is the whole reason a read of
                # the auth cookie is useless without this to put it back.
                src = pathlib.Path(st["from"])
                cks = json.loads(src.read_text())
                _ss = {"lax": "Lax", "strict": "Strict", "none": "None",
                       "no_restriction": "None"}
                params = []
                for c in cks:
                    p = {"name": c["name"], "value": c["value"],
                         "domain": c.get("domain"), "path": c.get("path") or "/"}
                    if c.get("secure") is not None:
                        p["secure"] = c["secure"]
                    if c.get("httpOnly") is not None:
                        p["httpOnly"] = c["httpOnly"]
                    ss = (c.get("sameSite") or "").lower()
                    if ss in _ss:
                        p["sameSite"] = _ss[ss]
                    exp = c.get("expires") or c.get("expirationDate")
                    if exp and exp > 0:
                        p["expires"] = exp
                    params.append(p)
                b.send("Storage.setCookies", {"cookies": params})
                note(i, st, "ok", {"set": len(params),
                                   "names": sorted({c["name"] for c in cks})})
            elif do == "setstorage":
                # ⛔ VALUES NEVER THROUGH THE LOG, same rule as setcookies. The
                # localStorage/sessionStorage entries come from a 600 file
                # (`from`) the orchestrator writes and deletes; only the KEY
                # names are reported.
                # ⭐ WHY A STEP, and why it is NOT the banned `eval`. A modern
                # SPA login (Microsoft/MSAL, Google, many OAuth SPAs) keeps its
                # real auth tokens in Web Storage, which Storage.setCookies
                # cannot carry -- which is why a cookie-only transplant of the
                # Azure portal came up signed-out. This is SESSION RESTORE, not
                # scripted input: it emits no click, no keystroke, no isTrusted
                # event -- the exact parallel of setcookies, and categorically
                # unlike the `eval` step the stealth rule forbids.
                # ⚠️ Web Storage is PER-ORIGIN, so the flow must already be ON
                # the target origin (nav first); a reload after lets the app's
                # JS read the seeded tokens at startup.
                src = pathlib.Path(st["from"])
                data = json.loads(src.read_text())
                stores = data if isinstance(data, list) else [data]
                total, names = 0, []
                for s in stores:
                    local = s.get("local") or {}
                    session = s.get("session") or {}
                    obj = json.dumps({"local": local, "session": session})
                    js = ("(function(){try{var o=" + obj + ";"
                          "for(var k in o.local){localStorage.setItem(k,o.local[k]);}"
                          "for(var k2 in o.session){sessionStorage.setItem(k2,o.session[k2]);}"
                          "return 'ok';}catch(e){return 'err:'+String(e);}})()")
                    b.eval(js)
                    total += len(local) + len(session)
                    names += list(local.keys()) + list(session.keys())
                note(i, st, "ok", {"keys": total, "names": sorted(set(names))[:40]})
            elif do == "wait":
                time.sleep(float(st.get("seconds", 1)))
                note(i, st, "ok")
            elif do == "shot":
                b.shot(st["path"])
                note(i, st, "ok")
            else:
                note(i, st, "unknown-step")
                break
        except KeyError as e:
            if st.get("optional"):
                note(i, st, "skipped", {"field": str(e)})
                continue
            note(i, st, "missing-field", {"field": str(e)})
            break
        except Exception as e:
            # ⭐ `optional` exists for the controls that are there or not there
            # depending on the profile: a cookie banner, a "you were signed
            # out" notice, a survey. On a disposable profile the banner is
            # always present and on a kept one never, and a flow that halts on
            # its absence is a flow that only works the first time. ⛔ Never
            # put it on a step whose failure MATTERS -- an optional assertion
            # is not an assertion.
            if st.get("optional"):
                note(i, st, "skipped", {"error": str(e)[:120]})
                continue
            note(i, st, "error", {"error": str(e)[:160]})
            break
    if shot:
        b.shot(shot)
    # The landing URL, because "did this page sign me out" is answered by where
    # the app PUT us, not by matching words in the body: a signed-in page can
    # contain "sign in" in a menu, and a wrong read there triggers a login,
    # which is the one expensive thing a kept profile exists to avoid.
    try:
        final = b.eval("location.href")
    except Exception:
        final = None
    # "default" is an await that fell back to its declared default, which is a
    # planned outcome, not a fault -- counting it as one made a fully
    # successful login report ok:false and cost a real attempt's worth of
    # confusion. Only a status that stopped the run is a failure.
    r = {"profile": b.keep, "url": final, "steps": log, "reads": reads,
         "ok": bool(log) and all(x["status"] in ("ok", "default") for x in log)}
    if out:
        pathlib.Path(out).write_text(json.dumps(r, indent=1))
    return r


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

    # Bind host defaults to loopback (the k8s path reaches it via `kubectl
    # port-forward`, which connects to the pod's 127.0.0.1). Set DROVER_SERVE_HOST=
    # 0.0.0.0 when the serve port is published off-pod directly — e.g. a plain
    # `docker -p` mapping, which forwards to the container's eth0, NOT its loopback,
    # so a 127.0.0.1 bind refuses every connection. Backward-compatible: unset ==
    # old behaviour. (unibrowse 2026-10-30, for apis's durable election-night session.)
    bind_host = os.environ.get("DROVER_SERVE_HOST") or "127.0.0.1"
    srv = http.server.ThreadingHTTPServer((bind_host, port), H)
    print(json.dumps({"serving": port, "bind": bind_host, "exitIp": (b.ident or {}).get("ip")}), flush=True)
    srv.serve_forever()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("job", choices=["probe", "visit", "serve", "contact", "session"])
    ap.add_argument("--steps", help="session: JSON file of steps, or inline JSON array")
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
    wm = start_wm()
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
    # ⛔ Refuse BEFORE launching a browser. The in-job guard catches direct
    # callers, but reaching it costs a Chrome start and, on a login flow, the
    # caller has usually already fetched a single-use code by then.
    if a.job == "session" and not os.environ.get("DROVER_PROFILE"):
        raise SystemExit("session: refusing to run without DROVER_PROFILE -- "
                         "a login driven into a temp profile is discarded on exit")
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
            print(json.dumps(load_contact().job_contact(b, json.loads(a.row), json.load(open(a.config)), sys.modules[__name__], a.dry, a.shot)))
        elif a.job == "session":
            raw = a.steps or "[]"
            # ⛔ A PATH THAT IS NOT THERE IS A MOUNT FAULT, NOT INLINE JSON.
            # `--steps` accepts a file or a literal array, so a path missing
            # inside the container fell through to json.loads("/steps/...")
            # and died with "Expecting value: line 1 column 1". Measured
            # 2026-10-25: on server4 the docker daemon has a PRIVATE /tmp, so
            # a bind mount of a /tmp directory shows the directory and NONE of
            # its files -- the mount silently delivers nothing. Another seat
            # read the resulting error as "the kept profile only works where
            # the browser is", which is not a thing: every container launches
            # its own Chrome. Name the fault instead.
            if raw.startswith("/") or raw.endswith(".json"):
                if not os.path.exists(raw):
                    raise SystemExit("session: --steps %s does not exist IN THE CONTAINER. "
                                     "Its directory is probably bind-mounted but empty -- a "
                                     "docker daemon with a private /tmp does exactly that. "
                                     "Put the steps file somewhere the daemon can see." % raw)
                raw = open(raw).read()
                if not raw.strip():
                    raise SystemExit("session: --steps %s is empty in the container" % raw)
            print(json.dumps(job_session(b, a.url, json.loads(raw), a.out, a.shot)))
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
