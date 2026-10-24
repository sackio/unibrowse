#!/usr/bin/env python3
"""Outcome panel: load live, antibot-protected sites and score blocked/passed.

The probe measures our own tells; this measures what they cost. The model is
the Browser Use stealth bench (scout survey 2026-10-24): real sites grouped by
the antibot vendor in front of them, scored only on whether the browser was
let through. No LLM is in the loop; a page is classified from its title, text,
final URL and iframes.

  panel.py --sites results/sites.json [--runs 2] [--jobs 3] [--wait 20]
           [--image drover-worker:dev] [--proxy-env FILE] [--label NAME]

sites.json is [{"url": ..., "vendor": ...}, ...]; bu_sites.py makes one from
the Browser Use repo. ⛔ That list is theirs and they ask it not be published
in plaintext, so it stays under results/ (gitignored) and is never committed.

Each site is visited `--runs` times in a shuffled order: one verdict per cell
is noise (Paterson's method, scout survey).
"""
import argparse, collections, concurrent.futures as cf, json, os, random, re, subprocess, time

HERE = os.path.dirname(os.path.abspath(__file__))

# What a refusal looks like, per vendor. A match on the BLOCK patterns means
# refused; a page with almost no text is "empty" (often a challenge that never
# rendered), which is scored as blocked too but kept apart so it can be read.
BLOCK = [
    ("cloudflare", r"just a moment|verify you are human|attention required|checking (if the site connection is secure|your browser)|cf-chl|challenges\.cloudflare\.com"),
    ("perimeterx", r"press & hold|press and hold|px-captcha|perimeterx|access to this page has been denied|human verification"),
    ("datadome", r"captcha-delivery\.com|datadome|you have been blocked|please enable js and disable any ad blocker"),
    ("akamai", r"access denied.*reference #|you don't have permission to access|errors\.edgesuite\.net"),
    ("recaptcha", r"recaptcha/api2/(anchor|bframe)|unusual traffic from your computer"),
    ("hcaptcha", r"hcaptcha\.com/captcha|newassets\.hcaptcha\.com"),
    ("geetest", r"geetest|static\.geetest\.com"),
    ("generic", r"\b403 forbidden\b|are you a robot|bot detected|request (was )?blocked|suspicious activity|automated (access|requests)"),
]


def classify(r):
    if r.get("error"):
        return "error", r["error"][:120]
    hay = " ".join([r.get("title") or "", r.get("text") or "", r.get("finalUrl") or "", " ".join(r.get("frames") or [])]).lower()
    for name, pat in BLOCK:
        m = re.search(pat, hay, re.S)
        if m:
            return "blocked", f"{name}: {m.group(0)[:60]}"
    if len((r.get("text") or "").strip()) < 120:
        return "empty", f"{len((r.get('text') or '').strip())} chars"
    return "passed", ""


def visit(site, a, n):
    out = os.path.join(a.outdir, "shots")
    os.makedirs(out, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "-", site["url"].lower())[8:60] + f"-{n}"
    if a.local:
        # Inside a worker pod: run the worker directly, one browser at a time.
        cmd = ["python3", a.worker, "visit", "--url", site["url"], "--wait", str(a.wait), "--interact",
               "--shot", os.path.join(out, slug + ".png")]
    else:
        cmd = ["docker", "run", "--rm", "--user", "1000:1000", "--shm-size=1g",
               "--security-opt", "seccomp=unconfined", "-v", f"{out}:/out"]
        if a.proxy_env:
            cmd += ["--env-file", a.proxy_env]
        cmd += [a.image, "visit", "--url", site["url"], "--wait", str(a.wait), "--interact",
                "--shot", f"/out/{slug}.png"]
    t0 = time.time()
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=a.wait + 150)
        r = json.loads(p.stdout.strip().splitlines()[-1]) if p.returncode == 0 and p.stdout.strip() else \
            {"error": (p.stderr.strip().splitlines() or ["no output"])[-1]}
    except (subprocess.TimeoutExpired, ValueError) as e:
        r = {"error": str(e)[:200]}
    r["finalUrl"] = r.pop("url", None) if "url" in r and r.get("url") != site["url"] else r.get("url")
    verdict, why = classify(r)
    return {"site": site["url"], "vendor": site.get("vendor"), "run": n, "verdict": verdict, "why": why,
            "title": (r.get("title") or "")[:100], "textLen": len(r.get("text") or ""),
            "peakMb": r.get("cgroupPeakMb"), "seconds": round(time.time() - t0, 1),
            "interact": r.get("interact"), "exitIp": r.get("exitIp"), "shot": f"shots/{slug}.png"}


def canary(a):
    """A cheap look at the exit before a batch spends tries on it. Reputation
    lists cannot tell VPN exits apart (they list them all), so ask the sites:
    a few that pass from a clean exit, one per strict vendor. FILE is a list
    like sites.json, chosen from panel runs (results/, never committed)."""
    a.outdir = os.path.join(a.outroot, "canary")
    sites = json.load(open(a.canary))
    with cf.ThreadPoolExecutor(min(a.jobs, len(sites))) as ex:
        rows = list(ex.map(lambda s: visit(s, a, 1), sites))
    for r in rows:
        print("ROW " + json.dumps(r), flush=True)
    refused = [r for r in rows if r["verdict"] in ("blocked", "empty")]
    exits = sorted({r.get("exitIp") or "?" for r in rows})
    healthy = len(refused) < a.canary_max
    print(json.dumps({"healthy": healthy, "exit": exits, "refused": len(refused), "of": len(rows),
                      "verdicts": {r["vendor"]: r["verdict"] for r in rows}}))
    return 0 if healthy else 3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", required=True)
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--wait", type=float, default=20)
    ap.add_argument("--image", default="drover-worker:dev")
    ap.add_argument("--proxy-env")
    ap.add_argument("--label", default=time.strftime("%Y%m%d-%H%M"))
    ap.add_argument("--local", action="store_true", help="run the worker in-process (inside a worker pod)")
    ap.add_argument("--worker", default="/opt/drover/worker/drover_worker.py")
    ap.add_argument("--shard", default=os.environ.get("JOB_COMPLETION_INDEX"),
                    help="i/n: take every n-th cell starting at i (k8s Indexed Job sets the index)")
    ap.add_argument("--shards", type=int, default=int(os.environ.get("DROVER_SHARDS", "1")))
    ap.add_argument("--outroot", default=os.path.join(HERE, "results"))
    ap.add_argument("--canary", metavar="FILE",
                    help="exit health check: visit the sites in FILE once each; exit 3 if --canary-max or more are refused")
    ap.add_argument("--canary-max", type=int, default=2)
    a = ap.parse_args()
    if a.canary:
        return canary(a)
    a.outdir = os.path.join(a.outroot, "panel-" + a.label)
    os.makedirs(a.outdir, exist_ok=True)
    sites = json.load(open(a.sites))
    cells = [(s, n) for s in sites for n in range(1, a.runs + 1)]
    if a.shard is not None and a.shards > 1:
        # Shard BEFORE shuffling, by a fixed order, so the pods split the set
        # exactly with no overlap; each pod then shuffles its own share.
        cells = cells[int(a.shard)::a.shards]
    random.shuffle(cells)
    log = open(os.path.join(a.outdir, "runs.jsonl"), "a")
    rows = []
    with cf.ThreadPoolExecutor(a.jobs) as ex:
        for row in ex.map(lambda c: visit(c[0], a, c[1]), cells):
            rows.append(row)
            log.write(json.dumps(row) + "\n")
            log.flush()
            if a.local:
                print("ROW " + json.dumps(row), flush=True)   # pod logs are the result channel
            print(f"{row['verdict']:8} {row['vendor'] or '-':14} {row['site'][:50]:50} {row['why'][:50]}", flush=True)
    # Summary by vendor. A site counts as passed only if EVERY run passed.
    by_site = collections.defaultdict(list)
    for r in rows:
        by_site[(r["vendor"], r["site"])].append(r["verdict"])
    by_vendor = collections.defaultdict(lambda: [0, 0])
    for (vendor, _), vs in by_site.items():
        by_vendor[vendor][1] += 1
        by_vendor[vendor][0] += all(v == "passed" for v in vs)
    # By exit IP: the same browser scored per egress, so a bad exit shows up
    # as its own row instead of as a worse browser.
    by_exit = collections.defaultdict(collections.Counter)
    for r in rows:
        by_exit[r.get("exitIp") or "?"][r["verdict"]] += 1
    total = sum(p for p, _ in by_vendor.values()), sum(n for _, n in by_vendor.values())
    summary = {"label": a.label, "image": a.image, "proxy": bool(a.proxy_env), "runs": a.runs,
               "passed": total[0], "sites": total[1],
               "byVendor": {v: f"{p}/{n}" for v, (p, n) in sorted(by_vendor.items(), key=lambda x: -x[1][1])},
               "verdicts": dict(collections.Counter(r["verdict"] for r in rows)),
               "byExit": {ip: dict(c) for ip, c in by_exit.items()},
               "peakMbMax": max((r["peakMb"] or 0) for r in rows)}
    json.dump(summary, open(os.path.join(a.outdir, "summary.json"), "w"), indent=2)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    raise SystemExit(main())
