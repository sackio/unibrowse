#!/usr/bin/env python3
"""Keep a transplanted session warm: load the signed-in homepage in the kept
Drover profile, confirm a logged-in marker is present, and alert the operator
if it has gone. Exit 0 = logged in · 3 = logged out · 1 = other.

⭐ WHY. A transplanted session (see transplant.py) stays valid for a long time
but can be invalidated, and a logged-out keep-warm profile fails silently right
when an agent needs it. This loads the homepage on a cadence, which also
refreshes the site's rolling cookies, and DMs Ben the moment the marker is gone
so the fix (re-transplant from his logged-in browser) happens before a consumer
trips over it.

  keepwarm.py --profile .../amazon --url https://www.amazon.com/ \
              --expect 'Account for|Hello,\\s+\\w' --label amazon --alert

The expect regex must be present in the signed-in page and absent when signed
out. It is matched against the first 3000 chars of body text.
"""
import argparse, json, os, pathlib, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _drover
import _lock


def _post(text, to="slack:U0NGEHS2J", url="http://192.168.1.168:3030/messages"):
    import urllib.request
    try:
        urllib.request.urlopen(urllib.request.Request(
            url, data=json.dumps({"to": to, "content": text}).encode(),
            headers={"Content-Type": "application/json"}), timeout=15)
    except Exception:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--url", required=True)
    ap.add_argument("--expect", required=True, help="regex that is present only when logged in")
    ap.add_argument("--label", default="site")
    ap.add_argument("--alert", action="store_true", help="DM when logged out")
    ap.add_argument("--alert-to", default="slack:U0NGEHS2J",
                    help="ATC address for the logout alert (default: Ben). Service "
                    "profiles (claudeai-*) point this at the owning agent seat.")
    ap.add_argument("--remedy", default="re-transplant from the MacBook "
                    "(drover/flows/transplant.py).",
                    help="the fix instruction included in the logout alert")
    args = ap.parse_args()

    prof = os.path.expanduser(args.profile)
    # ⛔ Step aside if a seat is actively using this profile. The warm cron and a
    # shopping/grocery seat both drive the same kept profiles; two Chromes on one
    # profile corrupt it. The Chrome lock is the hard backstop, but a reserved
    # profile is being kept warm by the seat using it anyway, so a skipped cycle
    # costs nothing and a lock-contention error is noise.
    if _lock.reserved_by_other(prof, "keepwarm"):
        rec = _lock.reservation(prof) or {}
        print("%s warm: SKIPPED -- reserved by %s" % (args.label, rec.get("seat")))
        sys.exit(0)
    out = prof + "-shots"
    pathlib.Path(out).mkdir(parents=True, exist_ok=True)
    os.chmod(out, 0o777)

    steps = [
        {"do": "nav", "url": args.url},
        {"do": "wait", "seconds": 6},
        {"do": "eval", "js": "JSON.stringify({t:(document.body.innerText||'').slice(0,3000),"
                             "title:document.title})", "as": "state"},
        {"do": "shot", "path": "/out/%s_warm.png" % args.label},
    ]
    r = _drover.run_session(prof, steps, out=out, timeout=200)
    st = json.loads((r.get("reads") or {}).get("state") or "{}")
    body = st.get("t", "")
    if re.search(args.expect, body):
        who = (re.search(r"Hello,\s*([^\n|]{1,30})|Hi\s+([A-Za-z]{1,30})", body) or [None])
        print("%s warm ok — logged in (%s)" % (args.label, st.get("title")))
        sys.exit(0)
    print("%s WARM: LOGGED OUT (title=%r)" % (args.label, st.get("title")), file=sys.stderr)
    if args.alert:
        _post("⚠️ %s drover session is LOGGED OUT — %s" % (args.label, args.remedy),
              to=args.alert_to)
    sys.exit(3)


if __name__ == "__main__":
    main()
