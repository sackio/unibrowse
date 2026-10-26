#!/usr/bin/env python3
"""Regression guard: TRUSTED INPUT MUST LAND AFTER A NAVIGATION.

⛔ WHY THIS EXISTS. Headful Chrome under Xvfb does not make the render view
built on a cross-process navigation input-active unless the compositor is in
software (--disable-gpu-compositing, set in drover_worker.EXTRA). Without it the
first/local page takes full XTEST input and every navigated site silently drops
it -- the page sees no pointer and no keystrokes while xdotool reports success
(measured 2026-10-25, root cause of the Amazon drive failure). That failure is
INVISIBLE: clicks and types all return ok and only the empty field shows it. So
this probe navigates to a real cross-site page, types with the same Hands path
every flow uses, and asserts BOTH that the value landed and that keydown events
actually fired in the page.

  python3 input_selfcheck.py            # default target (Wikipedia search)
  python3 input_selfcheck.py --url https://duckduckgo.com --sel '#searchbox_input'

Exit 0 = trusted input landed after the nav. Exit 1 = it did not (the compositor
regression is back, or the target page changed). Prints the measured value
length and keydown count, never the typed text.
"""
import argparse, json, os, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _drover

SENTINEL = "drover input selfcheck"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="https://www.wikipedia.org/")
    ap.add_argument("--sel", default="#searchInput")
    a = ap.parse_args()
    prof = tempfile.mkdtemp(prefix="drover-selfcheck-")
    steps = [
        {"do": "nav", "url": a.url},
        {"do": "wait", "seconds": 4},
        {"do": "click", "sel": a.sel},
        {"do": "eval", "js": "(()=>{window.__kd=0;"
                             "addEventListener('keydown',()=>window.__kd++,true);return 1})()"},
        {"do": "type", "text": SENTINEL},
        {"do": "eval", "js": "JSON.stringify({len:((document.querySelector(%r)||{}).value||'').length,"
                             "kd:window.__kd})" % a.sel, "as": "r"},
    ]
    r = _drover.run_session(prof, steps, timeout=120)
    # Every step must have run via XTEST -- no 'via' marker means the normal
    # hardware path, which is the only one this engine should use.
    bad_via = [s for s in r.get("steps", []) if s.get("via")]
    got = json.loads((r.get("reads") or {}).get("r") or "{}")
    ln, kd = got.get("len", 0), got.get("kd", 0)
    ok = ln == len(SENTINEL) and kd >= len(SENTINEL) and not bad_via
    print("input_selfcheck %s: url=%s len=%d/%d keydowns=%d%s"
          % ("PASS" if ok else "FAIL", a.url, ln, len(SENTINEL), kd,
             (" via=%s" % [s.get("via") for s in bad_via]) if bad_via else ""))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
