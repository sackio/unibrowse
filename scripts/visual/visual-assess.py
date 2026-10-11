#!/usr/bin/env python3
"""Pixel-regression half of visual assessment: store a baseline, diff against it.

unibrowse already has the CAPTURE half that visual-eyes and snap-browser use
Playwright for — `browser_segmented_screenshot` (one PNG per CSS selector,
written to disk) and `browser_set_device_metrics` (fixed viewport). What it had
no equivalent of is pixel-level regression, which is this file.

⛔ WHERE SCREENSHOTS MUST GO, measured 2026-10-11 both directions. The MCP server
runs in a container with NO /tmp mount, and `browser_segmented_screenshot`'s
`outputDir` DEFAULTS TO /tmp. A file written to the container's /tmp is absent on
the host; `/app/fetched` maps to /home/ben/files/unibrowse-fetched, which is
/mnt/nas/data/files/unibrowse-fetched and readable from every host over NFS.
⇒ ALWAYS pass `outputDir` explicitly. Taking the default returns a path nobody
can open, and nothing errors — it fails toward looking fine.

⚠️ AND DO NOT PULL SCREENSHOTS THROUGH A TOOL RESPONSE. `browser_screenshot`
returns base64, measured at 0.955 tokens per source byte — a 500KB PNG is about
478,000 tokens. Capture to disk, then `Read` the file: Read renders images
visually at no such cost. This matters more than any other line here.

Judgment is NOT this file's job. frontend-design@claude-plugins-official is
installed fleet-wide for that; this only answers "did it change, and where".

usage:
  visual-assess.py baseline <name> <image.png>        store/replace a baseline
  visual-assess.py compare  <name> <image.png> [--threshold N] [--out DIR]
  visual-assess.py list                               what baselines exist
"""
import argparse
import json
import os
import shutil
import sys

STORE = os.environ.get(
    "UNIBROWSE_VISUAL_BASELINES",
    "/mnt/nas/data/files/unibrowse-fetched/visual-baselines",
)

def _load(path):
    try:
        from PIL import Image
    except ImportError:
        sys.exit("Pillow is required and was not importable; it is present on office.")
    img = Image.open(path)
    # ⚠️ Convert BEFORE comparing. A PNG saved with an alpha channel and one
    # without are both "the same screenshot" to a human and different shapes to
    # numpy, which would read as 100% changed rather than as a mode mismatch.
    return img.convert("RGB")

def cmd_baseline(args):
    os.makedirs(STORE, exist_ok=True)
    dest = os.path.join(STORE, args.name + ".png")
    existed = os.path.exists(dest)
    _load(args.image)  # validate it is a readable image before we store it
    shutil.copyfile(args.image, dest)
    print(json.dumps({"stored": dest, "replaced": existed}, indent=2))

def cmd_compare(args):
    import numpy as np
    base_path = os.path.join(STORE, args.name + ".png")
    if not os.path.exists(base_path):
        sys.exit("no baseline named %r in %s — run `baseline` first" % (args.name, STORE))
    a, b = _load(base_path), _load(args.image)

    # ⛔ Size mismatch is NOT a diff percentage, it is a different measurement.
    # Reporting "97% changed" for a 1280x800 baseline against a 1512x945 capture
    # would be true and useless: the fix is to pin the viewport with
    # browser_set_device_metrics, not to read the number.
    if a.size != b.size:
        print(json.dumps({
            "verdict": "SIZE_MISMATCH",
            "baseline_size": list(a.size),
            "candidate_size": list(b.size),
            "note": "Not comparable. Pin the viewport with browser_set_device_metrics "
                    "(width/height/deviceScaleFactor) and recapture; do not read a "
                    "percentage off differently-sized images.",
        }, indent=2))
        return 2

    arr_a = np.asarray(a, dtype=np.int16)
    arr_b = np.asarray(b, dtype=np.int16)
    # per-pixel max channel delta, so a shift in one channel is not averaged away
    delta = np.abs(arr_a - arr_b).max(axis=2)
    changed = delta > args.tolerance
    total = int(changed.size)
    n_changed = int(changed.sum())
    pct = n_changed / total * 100 if total else 0.0

    box = None
    if n_changed:
        ys, xs = np.nonzero(changed)
        box = {"left": int(xs.min()), "top": int(ys.min()),
               "right": int(xs.max()), "bottom": int(ys.max())}

    out = {
        "verdict": "CHANGED" if pct > args.threshold else "UNCHANGED",
        "changed_pixels": n_changed,
        "total_pixels": total,
        "changed_pct": round(pct, 4),
        "threshold_pct": args.threshold,
        "tolerance": args.tolerance,
        "bbox_of_changes": box,
        "baseline": base_path,
        "candidate": args.image,
    }

    if n_changed and args.out:
        os.makedirs(args.out, exist_ok=True)
        from PIL import Image
        vis = np.asarray(b, dtype=np.uint8).copy()
        vis[changed] = [255, 0, 0]          # changed pixels in red, over the candidate
        dpath = os.path.join(args.out, args.name + "_diff.png")
        Image.fromarray(vis).save(dpath)
        out["diff_image"] = dpath
        out["diff_note"] = "Red pixels differ from the baseline. Read this file to see it."

    print(json.dumps(out, indent=2))
    return 0 if out["verdict"] == "UNCHANGED" else 1

def cmd_list(args):
    if not os.path.isdir(STORE):
        print(json.dumps({"store": STORE, "baselines": []}, indent=2)); return
    rows = sorted(f[:-4] for f in os.listdir(STORE) if f.endswith(".png"))
    print(json.dumps({"store": STORE, "baselines": rows}, indent=2))

def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("baseline", help="store or replace a baseline")
    b.add_argument("name"); b.add_argument("image"); b.set_defaults(fn=cmd_baseline)

    c = sub.add_parser("compare", help="diff an image against its baseline")
    c.add_argument("name"); c.add_argument("image")
    c.add_argument("--threshold", type=float, default=0.1,
                   help="percent of pixels that may differ before the verdict is CHANGED (default 0.1)")
    c.add_argument("--tolerance", type=int, default=8,
                   help="per-channel value difference ignored as encoder noise (default 8). "
                        "⚠️ 0 makes antialiasing and JPEG-ish noise read as real change.")
    c.add_argument("--out", help="directory to write a red-highlighted diff PNG into")
    c.set_defaults(fn=cmd_compare)

    sub.add_parser("list", help="list stored baselines").set_defaults(fn=cmd_list)

    args = p.parse_args()
    sys.exit(args.fn(args) or 0)

if __name__ == "__main__":
    main()
