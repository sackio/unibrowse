#!/usr/bin/env python3
"""Prove humanmotion.py and humanmotion.js still produce the same motion.

The model lives in two files because ui-eye is Python on the MacBook and the
chromium-host sidecar is node, and nothing can be shared between them. Two
implementations that merely look alike drift silently — nothing fails, one lane
just starts moving differently from the other. Both carry the same mulberry32
PRNG, Box-Muller normal and Marsaglia-Tsang gamma precisely so this check can
exist.

  python3 -I scripts/motion-equivalence.py

Exits non-zero on any divergence and names the first one.

⚠️ Pixel positions must match EXACTLY. Timings are compared to 1e-9s, because
the two runtimes format the same double differently in JSON — that is a
printing difference, not a behavioural one, and asserting on the text would
make this check cry wolf.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CASES = [
    # seed, x0, y0, x1, y1, target width
    (1, 0, 0, 630, 400, 20),
    (2, 1200, 800, 140, 90, 12),
    (3, 50, 50, 55, 52, 20),       # sub-pixel reach: the early-return branch
    (7, 400, 300, 400, 900, 64),   # straight down: direction_factor at its max
    (99, 960, 540, 20, 1040, 8),   # small target, long reach
    (12345, 0, 0, 1, 0, 20),       # distance < 1
]


def run(cmd):
    p = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True, timeout=60)
    if p.returncode != 0:
        print(f"⛔ {' '.join(cmd)} failed: {p.stderr.strip()[:400]}")
        sys.exit(2)
    return json.loads(p.stdout)


# The MacBook does not mount the NAS, so ui-eye cannot import the file next to
# this one — it carries a copy. A copy that has quietly stopped matching is the
# whole hazard, so check it by content rather than by seeded output: identical
# bytes is a stronger claim than identical behaviour on six seeds.
VENDORED = "/mnt/nas/data/code/ui-eye/src/ui_eye/client/humanmotion.py"


def check_vendored() -> int:
    import hashlib
    canonical = os.path.join(HERE, "humanmotion.py")
    try:
        a = hashlib.md5(open(canonical, "rb").read()).hexdigest()
        b = hashlib.md5(open(VENDORED, "rb").read()).hexdigest()
    except FileNotFoundError as e:
        print(f"⚠️  ui-eye copy not checked: {e}")
        return 0
    if a != b:
        print(f"⛔ {VENDORED} has drifted from {canonical} ({b} vs {a}).\n"
              f"   ⇒ cp {canonical} {VENDORED}  — the unibrowse one is canonical.")
        return 1
    print(f"✅ ui-eye copy byte-identical ({a[:12]})")
    return 0


TYPE_CASES = [
    (11, "Hartley Iowa, thanks!", False),
    (3, "a quick brown fox. Jumps!", False),
    (42, "hello@example.com", False),
    (7, "P@ssw0rd-1234", True),      # sensitive: must contain no backspace at all
]

SCROLL_CASES = [(11, -14), (7, 9), (99, -3), (5, 0)]

DRAG_CASES = [(4, 100, 100, 700, 420, 40), (13, 900, 600, 120, 140, 16)]


def check_generators() -> int:
    """The typing program and the scroll plan, which diverge for subtler reasons
    than the trajectory does.

    ⚠️ Both bugs this caught on the day it was written were Python's `x in s`
    being TRUE for an empty x: `prev in " \t"` and `prev in ".,!?;:"` both fired
    on the first character of every string, so Python added a word pause the
    node port did not. Neither failed anything; they just made one lane type
    differently from the other.
    """
    bad = 0
    for seed, text, sensitive in TYPE_CASES:
        args = ["emit-type", str(seed), text] + (["sensitive"] if sensitive else [])
        py = run(["python3", "-I", "humanmotion.py"] + args)
        js = run(["node", "humanmotion.js"] + args)
        label = f"type seed={seed} {text[:24]!r}{' sensitive' if sensitive else ''}"
        if len(py) != len(js) or any(
            p[:-1] != j[:-1] or abs(p[-1] - j[-1]) > 1e-9 for p, j in zip(py, js)
        ):
            print(f"⛔ {label}: diverged ({len(py)} vs {len(js)} ops)")
            bad += 1
            continue
        if sensitive and any(o[0] == "backspace" for o in py):
            print(f"⛔ {label}: produced a typo in a SENSITIVE field")
            bad += 1
            continue
        # the program must reconstruct the text exactly
        buf = []
        for op, ch, _ in py:
            if op == "key":
                buf.append(ch)
            elif op == "backspace" and buf:
                buf.pop()
        if "".join(buf) != text:
            print(f"⛔ {label}: replaying the program gives {''.join(buf)!r}, not the input")
            bad += 1
            continue
        print(f"✅ {label}: {len(py)} ops identical, text exact")

    for seed, x0, y0, x1, y1, w in DRAG_CASES:
        args = [str(v) for v in (seed, x0, y0, x1, y1, w)]
        py = run(["python3", "-I", "humanmotion.py", "emit-drag"] + args)
        js = run(["node", "humanmotion.js", "emit-drag"] + args)
        label = f"drag seed={seed} ({x0},{y0})->({x1},{y1}) w={w}"
        same = (abs(py["grab"] - js["grab"]) <= 1e-9 and abs(py["hold"] - js["hold"]) <= 1e-9
                and len(py["steps"]) == len(js["steps"])
                and all(p[:2] == j[:2] and abs(p[2] - j[2]) <= 1e-9
                        for p, j in zip(py["steps"], js["steps"])))
        if not same:
            print(f"⛔ {label}: diverged")
            bad += 1
            continue
        if (py["steps"][-1][0], py["steps"][-1][1]) != (x1, y1):
            print(f"⛔ {label}: ends at {py['steps'][-1][:2]}, not the drop point")
            bad += 1
            continue
        print(f"✅ {label}: {len(py['steps'])} steps identical, lands on the drop point")

    for seed, notches in SCROLL_CASES:
        args = ["emit-scroll", str(seed), str(notches)]
        py = run(["python3", "-I", "humanmotion.py"] + args)
        js = run(["node", "humanmotion.js"] + args)
        label = f"scroll seed={seed} notches={notches}"
        if len(py) != len(js) or any(
            p[:-1] != j[:-1] or abs(p[-1] - j[-1]) > 1e-9 for p, j in zip(py, js)
        ):
            print(f"⛔ {label}: diverged ({len(py)} vs {len(js)} ops)")
            bad += 1
        else:
            print(f"✅ {label}: {len(py)} ops identical")
    return bad


def main():
    failures = check_vendored() + check_generators()
    for seed, x0, y0, x1, y1, w in CASES:
        args = [str(v) for v in (seed, x0, y0, x1, y1, w)]
        py = run(["python3", "-I", "humanmotion.py", "emit"] + args)
        js = run(["node", "humanmotion.js", "emit"] + args)

        label = f"seed={seed} ({x0},{y0})->({x1},{y1}) w={w}"
        if len(py) != len(js):
            print(f"⛔ {label}: step count {len(py)} vs {len(js)}")
            failures += 1
            continue

        bad = None
        for i, (p, j) in enumerate(zip(py, js)):
            if p[0] != j[0] or p[1] != j[1] or abs(p[2] - j[2]) > 1e-9:
                bad = (i, p, j)
                break
        if bad:
            i, p, j = bad
            print(f"⛔ {label}: first divergence at step {i}: py={p} js={j}")
            failures += 1
        else:
            print(f"✅ {label}: {len(py)} steps identical")

    if failures:
        print(f"\n{failures}/{len(CASES)} cases diverged — the two implementations "
              f"are no longer the same model. Fix before shipping either.")
        return 1
    print(f"\nAll checks passed: {len(CASES)} trajectories, {len(TYPE_CASES)} typing programs, "
          f"{len(SCROLL_CASES)} scroll plans, {len(DRAG_CASES)} drags, and the ui-eye copy.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
