#!/usr/bin/env python3
"""OS-level mouse/keyboard for the chromium-host sidecars.

Input is delivered by the X server through XTEST (xdotool), NOT by CDP, so the
page sees ordinary hardware events: isTrusted true, real pointer movement before
the press, real key timing. Ben's requirement, #unibrowse 2026-10-23: "it needs
to be mouse and keyboard automation that's made to look realistic".

The whole gesture is ONE chained xdotool invocation inside the container, so a
200-step path costs one docker exec rather than 200.

  realinput.py move   --display :95 --x 640 --y 400
  realinput.py click  --display :95 --x 640 --y 400
  realinput.py type   --display :95 --text "hello"
  realinput.py where  --display :95
"""
import argparse, math, random, subprocess, sys, time

CONTAINER = "unibrowse-chromium-host"


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


def _path(x0, y0, x1, y1):
    """Cubic Bezier with offset control points, so the cursor arcs and
    overshoots slightly instead of travelling the straight line no hand draws."""
    dist = math.hypot(x1 - x0, y1 - y0)
    steps = max(12, min(90, int(dist / 7) + random.randint(6, 14)))
    # control points pushed perpendicular to the travel direction
    ang = math.atan2(y1 - y0, x1 - x0) + math.pi / 2
    bow = random.uniform(0.06, 0.22) * dist * random.choice((1, -1))
    cx1 = x0 + (x1 - x0) * 0.3 + math.cos(ang) * bow
    cy1 = y0 + (y1 - y0) * 0.3 + math.sin(ang) * bow
    cx2 = x0 + (x1 - x0) * 0.7 + math.cos(ang) * bow * 0.6
    cy2 = y0 + (y1 - y0) * 0.7 + math.sin(ang) * bow * 0.6
    pts = []
    for i in range(1, steps + 1):
        t = i / steps
        # ease-in-out: slow at both ends, quick in the middle
        t = t * t * (3 - 2 * t)
        u = 1 - t
        px = u**3 * x0 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t**3 * x1
        py = u**3 * y0 + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t**3 * y1
        pts.append((round(px), round(py)))
    pts[-1] = (x1, y1)
    return pts


def move_chain(display, x, y, jitter=True):
    x0, y0 = where(display)
    chain = []
    for px, py in _path(x0, y0, x, y):
        chain += ["mousemove", str(px), str(py), "sleep", f"{random.uniform(0.004, 0.016):.3f}"]
    if jitter:  # settle: a couple of 1px corrections, as a hand does
        for _ in range(random.randint(1, 2)):
            chain += ["mousemove", str(x + random.randint(-1, 1)), str(y + random.randint(-1, 1)),
                      "sleep", f"{random.uniform(0.02, 0.05):.3f}"]
        chain += ["mousemove", str(x), str(y)]
    return chain


def click(display, x, y, button=1):
    chain = move_chain(display, x, y)
    chain += ["sleep", f"{random.uniform(0.08, 0.22):.3f}",
              "mousedown", str(button),
              "sleep", f"{random.uniform(0.05, 0.13):.3f}",   # real press dwell
              "mouseup", str(button)]
    _run(display, chain)
    return where(display)


def type_text(display, text):
    """xdotool's `type` swallows the rest of an argv chain, so it CANNOT be chained
    with sleeps (measured 2026-10-23: the literal chain text landed in the field).
    Type in short runs instead — one exec per run, with its own delay and a pause
    between them, which keeps the per-keystroke variance without one exec per char."""
    i = 0
    while i < len(text):
        n = random.randint(2, 5)
        run, i = text[i:i + n], i + n
        _run(display, ["type", "--clearmodifiers", "--delay",
                       str(random.randint(55, 135)), "--", run])
        time.sleep(random.uniform(0.05, 0.22))


def key(display, name, repeat=1):
    chain = []
    for _ in range(repeat):
        chain += ["key", "--clearmodifiers", name, "sleep", f"{random.uniform(0.05, 0.14):.3f}"]
    _run(display, chain)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["move", "click", "type", "key", "where"])
    ap.add_argument("--display", required=True)
    ap.add_argument("--x", type=int)
    ap.add_argument("--y", type=int)
    ap.add_argument("--text")
    ap.add_argument("--key")
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--button", type=int, default=1)
    a = ap.parse_args()

    if a.action == "where":
        print("%d %d" % where(a.display))
    elif a.action == "move":
        _run(a.display, move_chain(a.display, a.x, a.y))
        print("%d %d" % where(a.display))
    elif a.action == "click":
        print("%d %d" % click(a.display, a.x, a.y, a.button))
    elif a.action == "type":
        type_text(a.display, a.text)
        print("ok")
    elif a.action == "key":
        key(a.display, a.key, a.repeat)
        print("ok")


if __name__ == "__main__":
    main()
