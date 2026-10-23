#!/usr/bin/env python3
"""OS-level mouse/keyboard for the chromium-host sidecars.

Input is delivered by the X server through XTEST (xdotool), NOT by CDP, so the
page sees ordinary hardware events: isTrusted true, real pointer movement before
the press, real key timing. Ben's requirement, #unibrowse 2026-10-23: "it needs
to be mouse and keyboard automation that's made to look realistic".

The motion itself comes from scripts/humanmotion.py, which ui-eye calls too, so
the Linux sidecars and the MacBook move the same way. This file is only the
delivery mechanism: it turns a trajectory into xdotool.

The whole gesture is ONE chained xdotool invocation inside the container, so a
120-step path costs one docker exec rather than 120.

  realinput.py move   --display :95 --x 640 --y 400
  realinput.py click  --display :95 --x 640 --y 400 [--width 32] [--button 1]
  realinput.py hover  --display :95 --x 640 --y 400
  realinput.py scroll --display :95 --notches -6
  realinput.py type   --display :95 --text "hello"
  realinput.py key    --display :95 --key Return
  realinput.py where  --display :95
"""
import argparse, os, random, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import humanmotion as hm

CONTAINER = "unibrowse-chromium-host"
CFG = hm.MotionConfig()


def _run(display, chain):
    cmd = ["docker", "exec", "-e", f"DISPLAY={display}", CONTAINER, "xdotool"] + chain
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if p.returncode != 0:
        raise SystemExit(f"xdotool failed ({p.returncode}): {p.stderr.strip()}")
    return p.stdout.strip()


def where(display):
    out = _run(display, ["getmouselocation", "--shell"])
    d = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
    return int(d["X"]), int(d["Y"])


def move_chain(display, x, y, width=None, jitter=True):
    """The travelled path to (x,y) as an xdotool chain. `width` is the target's
    size in px — Fitts's law means a small target is approached more slowly, so
    passing the real element width is worth doing when it is known."""
    x0, y0 = where(display)
    chain = []
    for px, py, dt in hm.steps(x0, y0, x, y, cfg=CFG, target_width=width or CFG.target_width):
        chain += ["mousemove", str(px), str(py), "sleep", f"{dt:.3f}"]
    if jitter:
        for px, py, dt in hm.settle(x, y):
            chain += ["mousemove", str(px), str(py), "sleep", f"{dt:.3f}"]
    return chain


def click(display, x, y, button=1, width=None):
    pre, dwell = hm.press_timing(CFG)
    chain = move_chain(display, x, y, width=width)
    chain += ["sleep", f"{pre:.3f}",
              "mousedown", str(button),
              "sleep", f"{dwell:.3f}",          # real press dwell
              "mouseup", str(button)]
    _run(display, chain)
    return where(display)


def scroll(display, notches):
    """Wheel notches, in the bursts a hand produces. Button 4 is up, 5 is down."""
    button = "4" if notches > 0 else "5"
    chain = []
    for n, gap in hm.scroll_bursts(notches):
        for _ in range(n):
            chain += ["click", button, "sleep", f"{random.uniform(0.012, 0.035):.3f}"]
        chain += ["sleep", f"{gap:.3f}"]
    _run(display, chain)


def type_text(display, text):
    """xdotool's `type` swallows the rest of an argv chain, so it CANNOT be chained
    with sleeps (measured 2026-10-23: the literal chain text landed in the field).
    Type in short runs instead — one exec per run — with the per-key intervals and
    the word-boundary pauses taken from humanmotion.key_delays, so the rhythm is
    the shared model's rather than a flat --delay."""
    delays = hm.key_delays(text, CFG)
    i = 0
    while i < len(delays):
        n = random.randint(2, 5)
        chunk, i = delays[i:i + n], i + n
        run = "".join(c for c, _ in chunk)
        per_key = sum(d for _, d in chunk) / len(chunk)
        _run(display, ["type", "--clearmodifiers", "--delay",
                       str(max(20, int(per_key * 1000))), "--", run])
        if i < len(delays):
            time.sleep(delays[i][1])


def key(display, name, repeat=1):
    chain = []
    for _ in range(repeat):
        chain += ["key", "--clearmodifiers", name,
                  "sleep", f"{random.uniform(0.05, 0.14):.3f}"]
    _run(display, chain)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["move", "hover", "click", "scroll", "type", "key", "where"])
    ap.add_argument("--display", required=True)
    ap.add_argument("--x", type=int)
    ap.add_argument("--y", type=int)
    ap.add_argument("--width", type=float, help="target width in px (Fitts); default 20")
    ap.add_argument("--notches", type=int, default=-3)
    ap.add_argument("--text")
    ap.add_argument("--key")
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--button", type=int, default=1)
    a = ap.parse_args()

    if a.action == "where":
        print("%d %d" % where(a.display))
    elif a.action in ("move", "hover"):
        _run(a.display, move_chain(a.display, a.x, a.y, width=a.width))
        print("%d %d" % where(a.display))
    elif a.action == "click":
        print("%d %d" % click(a.display, a.x, a.y, a.button, width=a.width))
    elif a.action == "scroll":
        scroll(a.display, a.notches)
        print("ok")
    elif a.action == "type":
        type_text(a.display, a.text)
        print("ok")
    elif a.action == "key":
        key(a.display, a.key, a.repeat)
        print("ok")


if __name__ == "__main__":
    main()
