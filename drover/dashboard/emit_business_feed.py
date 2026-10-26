#!/usr/bin/env python3
"""Emit the `unibrowse` business-dashboard feed from the Drover health collector.

Ben wants every business pipeline actively worked and fed at the right rate
(#business 2026-10-26 10:27, relayed by `business`). The business dashboard reads
one JSON per seat from business/dash/feeds/<seat>.json (schema: that dir's
README.md). This script is that generator for the `unibrowse` seat.

⛔ SCRIPT, NEVER AN LLM TURN (token embargo). Runs hourly from office cron. It does
NOT recompute anything the Drover dashboard already computes -- it fetches the
collector's cached snapshot (http://localhost:8792/api/state, one server-side read
every 10s) and reshapes it into the feed schema. A per-lane rate/day is derived
from a small persisted snapshot so "done today" and ETA are real, not estimated.

  python3 emit_business_feed.py            # write the feed once
  python3 emit_business_feed.py --dry      # print to stdout, write nothing

Exit 0 = feed written · 2 = collector unreadable (feed left untouched, so a dead
collector shows as STALE on the dashboard rather than as a plausible zero).
"""
import json, os, sys, time, tempfile, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta

STATE_URL = os.environ.get("DROVER_DASH_STATE", "http://localhost:8792/api/state")
FEED = os.environ.get(
    "UNIBROWSE_FEED",
    "/mnt/nas/data/code/business/dash/feeds/unibrowse.json")
# rate snapshot: {key: [epoch, done]} so rate/day = delta_done / delta_days
RATE_STATE = os.environ.get(
    "UNIBROWSE_FEED_RATE_STATE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".feed_rate_state.json"))
EDT = timezone(timedelta(hours=-4))  # feed timestamps are wall-clock ET per examples

# Human project label -> brand domain for the account column Ben's per-project
# count feeds on (business/outreach/browser-brief.md). Only for projects that are
# ours to name; unknown projects pass through with no domain.
BRAND = {
    "Our Town Store": "ourtownstore.com",
    "pushbuild": "pushbuild.com",
    "ink": "inklingbook.com",
    "re": "getreturnedequity.com",
    "Trip at Hand": "tripathand.app",
}


def fetch_state():
    req = urllib.request.Request(STATE_URL, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def load_rate_state():
    try:
        with open(RATE_STATE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_rate_state(d):
    tmp = RATE_STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f)
    os.replace(tmp, RATE_STATE)


def rate_per_day(prev, key, done, now):
    """submitted/done rate in units/day from the last snapshot; None if no basis."""
    p = prev.get(key)
    if not p:
        return None
    pts, pdone = p
    dt_days = (now - pts) / 86400.0
    if dt_days < 1 / 48.0:  # <30 min elapsed -> too noisy to annualise
        return None
    delta = done - pdone
    if delta < 0:
        return None
    return delta / dt_days


def main():
    dry = "--dry" in sys.argv
    try:
        st = fetch_state()
        if not st.get("meta", {}).get("ok", True) and not st.get("lanes"):
            raise RuntimeError("collector reports not-ok and no lanes")
    except Exception as e:
        sys.stderr.write(f"collector unreadable ({e}); feed left untouched\n")
        return 2

    now = time.time()
    prev = load_rate_state()
    new_state = {}

    lanes = st.get("lanes", {}).get("lanes", [])
    captcha = st.get("captcha", {})
    k8s = st.get("k8s", {})
    pods = k8s.get("pods", []) if k8s.get("ok") else []
    running_signups = sum(
        1 for p in pods if p.get("job") == "drover-signups" and p.get("phase") == "Running")
    running_outreach = sum(
        1 for p in pods if p.get("job") == "drover-outreach" and p.get("phase") == "Running")

    items = []
    pipeline = []
    for ln in lanes:
        lane = ln.get("lane")          # "signups" | "contact-form"
        project = ln.get("project", "?")
        bs = ln.get("by_status", {}) or {}
        done = ln.get("done", 0) or 0
        total = ln.get("total", 0) or 0
        remaining = ln.get("remaining", 0) or 0
        submitted = bs.get("submitted", 0)
        blocked = bs.get("blocked", 0)
        noform = bs.get("noform", 0)
        errors = bs.get("error", 0)
        key = f"{lane}:{project}"
        new_state[key] = [now, done]

        rate = rate_per_day(prev, key, done, now)
        attempts = done - noform  # rows that actually had a submittable form
        success_pct = round(100.0 * submitted / attempts, 1) if attempts > 0 else None

        # dominant blocker
        blocker = ""
        if lane == "signups" and remaining > 0 and rate == 0:
            blocker = "lane idle (no pods picking rows)"
        if blocked and blocked >= submitted:
            blocker = f"captcha unsolvable on {blocked} sites (reCAPTCHA/hCaptcha, no token)"
        if remaining == 0 and total > 0:
            status = "done"
        elif (lane == "signups" and running_signups) or (lane == "contact-form" and running_outreach):
            status = "running"
        elif remaining > 0:
            status = "queued"
        else:
            status = "waiting"

        results = []
        if success_pct is not None:
            results.append(f"{submitted} submitted of {attempts} form-bearing ({success_pct}%)")
        if blocked:
            results.append(f"{blocked} captcha-blocked")
        if noform:
            results.append(f"{noform} no-form")
        if errors:
            results.append(f"{errors} errors")

        item = {
            "id": f"ub-{lane}-{project}".lower().replace(" ", "-"),
            "name": f"{'Newsletter signups' if lane=='signups' else 'Contact-form outreach'} — {project}",
            "kind": "signup" if lane == "signups" else "email",
            "status": status,
            "done": done,
            "total": total,
            "unit": "sites",
            "queue": remaining,
            "results": "; ".join(results),
            "blocker": blocker,
            "link": "https://atc.sack.io/f/up-f3a5dbe762874f57e5d33044a26e3d6b/index.html",
        }
        dom = BRAND.get(project)
        if dom:
            item["account"] = f"hello@{dom}"
        if rate is not None:
            item["rate"] = f"{round(rate)}/day"
            if rate > 0 and remaining > 0:
                eta_days = remaining / rate
                item["eta"] = (datetime.now(EDT) + timedelta(days=eta_days)).strftime("%Y-%m-%d")
        items.append(item)

        # signups funnel -> pipeline block
        if lane == "signups":
            pipeline.append({
                "project": project,
                "funnel": "newsletter signup",
                "stages": [
                    {"stage": "sites tried", "count": done},
                    {"stage": "had a form", "count": attempts},
                    {"stage": "submitted", "count": submitted},
                ],
                "note": (f"{blocked} blocked by captcha, {noform} had no form"
                         if (blocked or noform) else ""),
                "tried": done, "submitted": submitted,
                "blocked": blocked, "noform": noform,
            })

    # KPIs
    tot_sub = sum(p["submitted"] for p in pipeline)
    kpis = [
        {"label": "signups submitted", "value": tot_sub},
        {"label": "2captcha spend today", "value": f"${captcha.get('today_cost', 0):.2f}"},
        {"label": "2captcha spend total", "value": f"${captcha.get('cost', 0):.2f}"},
        {"label": "signup pods running", "value": running_signups},
    ]

    # dry-up warnings + captcha top-up -> calendar
    calendar = []
    for it in items:
        if it.get("status") in ("running", "queued") and it.get("rate") and it.get("queue"):
            try:
                r = float(it["rate"].split("/")[0])
                if r > 0 and it["queue"] / r < 1.0:
                    calendar.append({
                        "date": datetime.now(EDT).strftime("%Y-%m-%d"),
                        "title": f"{it['name']} queue under 1 day ({it['queue']} left @ {it['rate']})",
                        "kind": "signup" if it["kind"] == "signup" else "email",
                    })
            except Exception:
                pass

    running_items = [i for i in items if i["status"] == "running"]
    summary = (f"{len(running_items)} lanes running, {tot_sub} signup submits logged; "
               f"2captcha ${captcha.get('today_cost',0):.2f} today "
               f"(${captcha.get('cost',0):.2f} total).")

    feed = {
        "seat": "unibrowse",
        "business": "Drover outreach automation",
        "updated": datetime.now(EDT).isoformat(timespec="seconds"),
        "summary": summary,
        "kpis": kpis,
        "items": items,
        "pipeline": pipeline,
        "calendar": calendar,
    }

    if dry:
        print(json.dumps(feed, indent=1))
        return 0

    save_rate_state(new_state)
    tmp = tempfile.NamedTemporaryFile(
        "w", dir=os.path.dirname(FEED), prefix=".unibrowse.", suffix=".json", delete=False)
    json.dump(feed, tmp, indent=1)
    tmp.flush()
    os.fsync(tmp.fileno())
    tmp.close()
    os.replace(tmp.name, FEED)
    sys.stderr.write(f"wrote {FEED} ({len(items)} lanes, {len(pipeline)} funnels)\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
