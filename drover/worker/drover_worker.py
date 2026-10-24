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
    keeps nothing, so losing a node loses nothing.

  drover_worker.py probe --url http://host:8765/probe.html?label=x [--out f.json]
  drover_worker.py visit --url https://… --wait 20 [--shot f.png]

Stdlib only. Python 3.10+.
"""
import argparse, base64, json, os, random, shutil, signal, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
for p in (os.path.join(HERE, "..", "..", "scripts"), "/opt/drover/scripts"):
    if os.path.exists(os.path.join(p, "humanmotion.py")):
        sys.path.insert(0, os.path.abspath(p))
        break
import humanmotion as hm

CHROME = os.environ.get("DROVER_CHROME", "/usr/bin/google-chrome")
SCREEN = os.environ.get("DROVER_SCREEN", "1920x1080")
DISPLAY = os.environ.get("DROVER_DISPLAY", ":99")
# ⛔ Without these two, WebGL is null under Xvfb and nothing errors
# (chromium-host/Dockerfile.chrome, measured 2026-10-15).
EXTRA = os.environ.get("DROVER_CHROME_ARGS", "--use-angle=swiftshader --enable-unsafe-swiftshader").split()
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
    def __init__(self):
        self.profile = tempfile.mkdtemp(prefix="drover-")
        w, h = SCREEN.split("x")
        args = [CHROME, f"--user-data-dir={self.profile}", "--remote-debugging-pipe",
                "--no-first-run", "--no-default-browser-check", "--password-store=basic",
                "--disable-features=Translate",
                # ⭐ Without this a debugging-pipe browser reports
                # navigator.webdriver === true (measured, first bench run
                # 2026-10-24). It switches the automation feature off rather
                # than faking a value, as nodriver does.
                "--disable-blink-features=AutomationControlled",
                f"--window-size={w},{h}", "--window-position=0,0",
                *EXTRA, "about:blank"]
        r1, w1 = os.pipe()          # we write -> chrome reads on fd 3
        r2, w2 = os.pipe()          # chrome writes on fd 4 -> we read
        os.set_inheritable(r1, True)
        os.set_inheritable(w2, True)

        def wire():
            os.dup2(r1, 3)
            os.dup2(w2, 4)

        self.proc = subprocess.Popen(args, preexec_fn=wire, pass_fds=(3, 4), stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL, env={**os.environ, "DISPLAY": DISPLAY},
                                     start_new_session=True)
        os.close(r1)
        os.close(w2)
        self.cdp = Pipe(w1, r2)
        self.session = self._attach()
        self.world = None

    def _attach(self):
        for _ in range(100):
            ts = self.cdp.call("Target.getTargets")["targetInfos"]
            pages = [t for t in ts if t["type"] == "page"]
            if pages:
                return self.cdp.call("Target.attachToTarget", {"targetId": pages[0]["targetId"], "flatten": True})["sessionId"]
            time.sleep(0.1)
        raise RuntimeError("no page target")

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

    def eval(self, expr, timeout=30):
        """Evaluate in an ISOLATED world: same DOM, none of the page's globals,
        invisible to the page's own scripts. Never Runtime.enable."""
        if self.world is None:
            frame = self.send("Page.getFrameTree")["frameTree"]["frame"]["id"]
            self.world = self.send("Page.createIsolatedWorld",
                                   {"frameId": frame, "worldName": "d", "grantUniveralAccess": False})["executionContextId"]
        r = self.send("Runtime.evaluate", {"expression": expr, "contextId": self.world,
                                           "returnByValue": True, "awaitPromise": True}, timeout=timeout)
        if "exceptionDetails" in r:
            raise RuntimeError("eval: " + r["exceptionDetails"].get("text", "exception"))
        return r["result"].get("value")

    def shot(self, path):
        data = self.send("Page.captureScreenshot", {"format": "png"})["data"]
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

    def calibrate(self):
        self.b.eval("window.__dm=null; addEventListener('mousemove', e => { window.__dm=[e.clientX,e.clientY,e.isTrusted]; }, true); 1")
        sx, sy = 700 + random.randint(-40, 40), 500 + random.randint(-40, 40)
        self.move_screen(sx, sy)
        time.sleep(0.15)
        seen = self.b.eval("window.__dm")
        if not seen:
            raise RuntimeError("calibration: page saw no pointer movement")
        dpr = self.b.eval("devicePixelRatio") or 1
        self.dx, self.dy = sx - seen[0] * dpr, sy - seen[1] * dpr
        return {"dx": self.dx, "dy": self.dy, "trusted": seen[2]}

    def where(self):
        d = dict(l.split("=", 1) for l in xdo("getmouselocation", "--shell").splitlines() if "=" in l)
        return int(d["X"]), int(d["Y"])

    def move_screen(self, x, y, width=None):
        x0, y0 = self.where()
        chain = []
        for px, py, dt in hm.steps(x0, y0, x, y, cfg=CFG, target_width=width or CFG.target_width):
            chain += ["mousemove", str(px), str(py), "sleep", f"{dt:.3f}"]
        for px, py, dt in hm.settle(x, y):
            chain += ["mousemove", str(px), str(py), "sleep", f"{dt:.3f}"]
        if chain:
            xdo(*chain)

    def rect(self, selector):
        r = self.b.eval(f"(() => {{ const e = document.querySelector({json.dumps(selector)}); if (!e) return null;"
                        f" e.scrollIntoView({{block:'center'}}); const r = e.getBoundingClientRect();"
                        f" return [r.left, r.top, r.width, r.height, devicePixelRatio]; }})()")
        if not r:
            raise RuntimeError("no element " + selector)
        return r

    def click(self, selector):
        left, top, w, h, dpr = self.rect(selector)
        # Aim off-centre, as a hand does; stay well inside the box.
        tx = left + w * random.uniform(0.3, 0.7)
        ty = top + h * random.uniform(0.3, 0.7)
        x, y = round(self.dx + tx * dpr), round(self.dy + ty * dpr)
        self.move_screen(x, y, width=w * dpr)
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
    hands.click("#finish")
    raw = None
    for _ in range(40):
        raw = b.eval("document.getElementById('out').textContent")
        if raw:
            break
        time.sleep(0.25)
    res = json.loads(raw) if raw else {"error": "probe produced no result"}
    res["driver"] = {"name": "drover", "chrome": CHROME, "calibration": cal,
                     **b.rss_mb(), "jobSeconds": round(time.time() - t0, 2)}
    if out:
        with open(out, "w") as f:
            json.dump(res, f, indent=2)
    return res


def job_visit(b, url, wait, shot):
    """Load a third-party page (CreepJS, bot-detector, a live site), let it
    settle, and return its visible text, plus a screenshot if asked."""
    t0 = time.time()
    b.navigate(url, settle=wait)
    text = b.eval("document.body ? document.body.innerText : ''")
    if shot:
        b.shot(shot)
    return {"url": url, "text": text, **b.rss_mb(), "seconds": round(time.time() - t0, 2)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("job", choices=["probe", "visit"])
    ap.add_argument("--url", required=True)
    ap.add_argument("--out")
    ap.add_argument("--wait", type=float, default=15)
    ap.add_argument("--shot")
    a = ap.parse_args()
    xvfb = start_display()
    b = Browser()
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
        else:
            print(json.dumps(job_visit(b, a.url, a.wait, a.shot)))
    finally:
        b.close()
        if xvfb:
            xvfb.terminate()


if __name__ == "__main__":
    main()
