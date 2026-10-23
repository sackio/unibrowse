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


def main():
    failures = 0
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
    print(f"\nAll {len(CASES)} cases identical.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
