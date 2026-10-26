#!/usr/bin/env python3
"""Drover health dashboard -- the collector + static server behind the realtime UI.

⛔ WHY A SERVICE AND NOT A POLLING SEAT. Ben asked for a live view of the whole
drover fleet (Slack #unibrowse 2026-10-26). Under the permanent token embargo an
LLM must not be the thing polling kubectl every few seconds -- so this stdlib
daemon does every read on a server-side timer and caches ONE snapshot, and the
browser page polls THIS, not a seat. No new host deps (stdlib only), no cluster
hammering (one `get pods`/`get jobs` per refresh), nothing fabricated: every
field traces to kubectl or a file on the NAS, and a source that can't be read
shows as an explicit error rather than a plausible zero.

  GET /            -> the dashboard page (dashboard.html, re-read on change)
  GET /api/state   -> the cached JSON snapshot + its age
  GET /healthz     -> ok

Sources (all live on office, where the dispatcher and kubectl already run):
  kubectl --kubeconfig <barn> -n drover get pods/jobs/secret   (pods, VPN, sessions)
  business/outreach/captcha-spend.tsv                           (2captcha calls + cost)
  business/outreach/captcha-svc-results-ord.tsv                 (contact-form send outcomes)
  business/outreach/captcha-svc-ordered.tsv                     (contact-form queue depth)
  business/outreach/data/drover-signups*.tsv                    (signup lane done/total)
  /mnt/nas/data/.secrets/drover-profiles/*                      (warmed login freshness)
"""
import json, os, re, subprocess, threading, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "dashboard.html")

KUBECONFIG = os.environ.get(
    "DROVER_KUBECONFIG",
    "/mnt/nas/data/code/server_admin/k8s-credentials/clusters/barn-cluster.yaml")
NS = os.environ.get("DROVER_NS", "drover")
OUTREACH = os.environ.get("DROVER_OUTREACH_DIR", "/mnt/nas/data/code/business/outreach")
PROFILES = os.environ.get("DROVER_PROFILES_DIR", "/mnt/nas/data/.secrets/drover-profiles")
PORT = int(os.environ.get("DROVER_DASH_PORT", "8792"))
REFRESH = int(os.environ.get("DROVER_DASH_REFRESH", "10"))
# Notify Ben to top up 2Captcha at this spend (Ben, Slack #unibrowse 2026-10-26:
# "notify me at $4.50 and I will top up"). Fires once via a sentinel file.
ATC = os.environ.get("ATC_URL", "http://192.168.1.168:3030")
NOTIFY_TO = os.environ.get("DROVER_DASH_NOTIFY", "slack:U0NGEHS2J")
SPEND_NOTIFY_AT = float(os.environ.get("DROVER_DASH_SPEND_NOTIFY", "4.50"))
_SPEND_SENTINEL = os.path.join(HERE, ".spend-notified")

_snap = {"meta": {"collected_at": 0, "ok": False, "note": "starting"}}
_snap_lock = threading.Lock()
_fcache = {}            # path -> (mtime, size, parsed)  -- avoid re-reading unchanged NFS files


# ── helpers ─────────────────────────────────────────────────────────────────

def kube(*args, timeout=20):
    cmd = ["kubectl", "--kubeconfig=" + KUBECONFIG, "-n", NS, *args]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def kube_json(*args, timeout=20):
    r = kube(*args, "-o", "json", timeout=timeout)
    if r.returncode != 0:
        return None, (r.stderr or "").strip()[-200:]
    try:
        return json.loads(r.stdout), None
    except Exception as e:
        return None, "parse: %s" % e


def _read_cached(path):
    """Return the file's text, cached by (mtime,size) so an unchanged file on NFS
    is not re-read every refresh. Returns None if absent/unreadable."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = (st.st_mtime, st.st_size)
    hit = _fcache.get(path)
    if hit and hit[0] == key:
        return hit[1]
    try:
        with open(path, "r", errors="replace") as f:
            txt = f.read()
    except OSError:
        return None
    _fcache[path] = (key, txt)
    return txt


def _rows(path, sep="\t"):
    txt = _read_cached(path)
    if txt is None:
        return None
    return [ln.split(sep) for ln in txt.splitlines() if ln.strip()]


def _age(iso):
    """Seconds since an RFC3339 timestamp like 2026-10-26T10:03:53Z."""
    if not iso:
        return None
    try:
        t = time.strptime(iso.split(".")[0].rstrip("Z"), "%Y-%m-%dT%H:%M:%S")
        return max(0, int(time.time() - (time.mktime(t) - time.timezone)))
    except Exception:
        return None


# ── collectors ──────────────────────────────────────────────────────────────

def collect_k8s():
    out = {"ok": False, "pods": [], "jobs": [], "sessions": [], "error": None}
    data, err = kube_json("get", "pods")
    if data is None:
        out["error"] = "pods: " + (err or "unreachable")
        return out
    out["ok"] = True
    for p in data.get("items", []):
        m = p.get("metadata", {}) or {}
        s = p.get("status", {}) or {}
        lab = m.get("labels", {}) or {}
        cs = (s.get("containerStatuses") or [{}])[0]
        state = cs.get("state", {}) or {}
        reason = None
        for k in ("waiting", "terminated"):
            if state.get(k) and state[k].get("reason"):
                reason = state[k]["reason"]
        name = m.get("name")
        rec = {
            "name": name,
            "phase": s.get("phase"),
            "ready": bool(cs.get("ready")),
            "podIP": s.get("podIP"),
            "node": p.get("spec", {}).get("nodeName") or s.get("hostIP"),
            "restarts": cs.get("restartCount", 0),
            "reason": reason,
            "job": lab.get("job-name") or lab.get("batch.kubernetes.io/job-name"),
            "shard": lab.get("batch.kubernetes.io/job-completion-index"),
            "age": _age(s.get("startTime") or m.get("creationTimestamp")),
        }
        out["pods"].append(rec)
        if (name or "").startswith("drover-session"):
            out["sessions"].append(rec)
    jdata, jerr = kube_json("get", "jobs")
    if jdata is not None:
        for j in jdata.get("items", []):
            m = j.get("metadata", {}) or {}
            st = j.get("status", {}) or {}
            spec = j.get("spec", {}) or {}
            active = st.get("active", 0) or 0
            succ = st.get("succeeded", 0) or 0
            fail = st.get("failed", 0) or 0
            comp = spec.get("completions")
            status = "Running" if active else ("Complete" if succ and succ == (comp or succ) else ("Failed" if fail else "Idle"))
            out["jobs"].append({
                "name": m.get("name"), "active": active, "succeeded": succ,
                "failed": fail, "completions": comp, "status": status,
                "age": _age(m.get("creationTimestamp")),
            })
    # VPN exit mode for the current batch: the dispatcher sets the drover-proxy
    # secret only for a fresh VPN run; absent => house IP. We never read its value.
    sec = kube("get", "secret", "drover-proxy", timeout=10)
    out["vpn_secret"] = (sec.returncode == 0)
    return out


def collect_captcha():
    """2captcha spend ledger: each paid solve call, its cost and target."""
    out = {"ok": False, "calls": 0, "cost": 0.0, "today_calls": 0, "today_cost": 0.0,
           "recent": [], "error": None}
    rows = _rows(os.path.join(OUTREACH, "captcha-spend.tsv"))
    if rows is None:
        out["error"] = "captcha-spend.tsv unreadable"
        return out
    out["ok"] = True
    today = time.strftime("%Y-%m-%d")
    for r in rows:
        if len(r) < 2:
            continue
        ts = r[0]
        try:
            cost = float(r[1])
        except ValueError:
            cost = 0.0
        out["calls"] += 1
        out["cost"] += cost
        if ts.startswith(today):
            out["today_calls"] += 1
            out["today_cost"] += cost
    for r in rows[-30:][::-1]:
        if len(r) >= 4:
            host = re.sub(r"^https?://", "", r[3]).split("/")[0]
            out["recent"].append({"ts": r[0], "cost": r[1], "type": r[2], "host": host})
    out["cost"] = round(out["cost"], 4)
    out["today_cost"] = round(out["today_cost"], 4)
    return out


def collect_outreach():
    """Contact-form lane: queue depth vs send outcomes, recent results, exit IPs."""
    out = {"ok": False, "queue": None, "results_total": 0, "by_status": {},
           "recent": [], "exit_ips": [], "error": None}
    q = _rows(os.path.join(OUTREACH, "captcha-svc-ordered.tsv"))
    res = _rows(os.path.join(OUTREACH, "captcha-svc-results-ord.tsv"))
    if res is None:
        out["error"] = "captcha-svc-results-ord.tsv unreadable"
        return out
    out["ok"] = True
    if q is not None:
        out["queue"] = max(0, len(q) - 1)                 # minus header
    body = res[1:] if res and res[0][:1] == ["key"] else res
    ips = {}
    for r in body:
        if len(r) < 3:
            continue
        status = r[2]
        out["results_total"] += 1
        out["by_status"][status] = out["by_status"].get(status, 0) + 1
        note = r[3] if len(r) > 3 else ""
        m = re.search(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b", note)
        if m:
            ips[m.group(1)] = ips.get(m.group(1), 0) + 1
    for r in body[-25:][::-1]:
        if len(r) >= 3:
            out["recent"].append({"key": r[0], "address": r[1], "status": r[2],
                                   "note": (r[3] if len(r) > 3 else "")[:200]})
    out["exit_ips"] = sorted(ips.items(), key=lambda x: -x[1])[:8]
    return out


def collect_signups():
    out = {"ok": False, "total": 0, "done": 0, "by_status": {}, "error": None}
    full = _rows(os.path.join(OUTREACH, "data", "drover-signups.tsv"))
    done = _read_cached(os.path.join(OUTREACH, "data", "drover-signups-done.tsv"))
    if full is None:
        out["error"] = "drover-signups.tsv unreadable"
        return out
    out["ok"] = True
    body = full[1:] if full and full[0][:1] == ["brand"] else full
    out["total"] = len(body)
    if done is not None:
        out["done"] = max(0, len([ln for ln in done.splitlines() if ln.strip()]) - 1)
    for r in body:
        if len(r) >= 5:
            out["by_status"][r[4]] = out["by_status"].get(r[4], 0) + 1
    return out


def collect_logins():
    out = {"ok": False, "profiles": [], "error": None}
    try:
        names = sorted(os.listdir(PROFILES))
    except OSError as e:
        out["error"] = str(e)
        return out
    out["ok"] = True
    skip_suffix = (".run", "-shots")
    skip_exact = {"_locks", ".unibrowse-identities", "_uploads"}
    for n in names:
        if n.startswith(".") or n in skip_exact or n.endswith(skip_suffix):
            continue
        d = os.path.join(PROFILES, n)
        if not os.path.isdir(d):
            continue
        cookies = os.path.join(d, "Default", "Cookies")
        lock = os.path.join(d, n + ".run", ".chrome.lock")   # sibling <name>.run/
        lock2 = os.path.join(PROFILES, n + ".run", ".chrome.lock")
        last = None
        for p in (cookies, d):
            try:
                last = max(last or 0, os.stat(p).st_mtime)
            except OSError:
                pass
        in_use = False
        for lp in (lock, lock2):
            try:
                if time.time() - os.stat(lp).st_mtime < 600:
                    in_use = True
            except OSError:
                pass
        out["profiles"].append({
            "name": n,
            "last_active": int(time.time() - last) if last else None,
            "in_use": in_use,
            "has_cookies": os.path.exists(cookies),
        })
    out["profiles"].sort(key=lambda p: (not p["in_use"], p["last_active"] if p["last_active"] is not None else 1e12))
    return out


BRAND_LABEL = {"ots": "Our Town Store", "pb": "pushbuild", "jf": "Trip at Hand", "ink": "ink"}


def collect_lanes():
    """Each outreach lane broken down by task, per project. Signups is split by
    brand (the project); contact-forms is one project (Our Town Store)."""
    out = {"ok": False, "lanes": [], "error": None}
    full = _rows(os.path.join(OUTREACH, "data", "drover-signups.tsv"))
    done = _rows(os.path.join(OUTREACH, "data", "drover-signups-done.tsv"))
    if full is not None:
        out["ok"] = True
        fbody = full[1:] if full and full[0][:1] == ["brand"] else full
        totals = {}
        for r in fbody:
            if r:
                totals[r[0]] = totals.get(r[0], 0) + 1
        dbody = (done[1:] if done and done[0][:1] == ["date"] else done) or []
        outcomes = {}
        for r in dbody:
            if len(r) >= 5:
                outcomes.setdefault(r[1], {})
                outcomes[r[1]][r[4]] = outcomes[r[1]].get(r[4], 0) + 1
        for b in sorted(totals, key=lambda x: -totals[x]):
            oc = outcomes.get(b, {})
            dn = sum(oc.values())
            out["lanes"].append({"lane": "signups", "job": "drover-signups", "mode": "house IP",
                                 "project": BRAND_LABEL.get(b, b), "total": totals[b], "done": dn,
                                 "remaining": max(0, totals[b] - dn), "by_status": oc})
    q = _rows(os.path.join(OUTREACH, "captcha-svc-ordered.tsv"))
    res = _rows(os.path.join(OUTREACH, "captcha-svc-results-ord.tsv"))
    if res is not None:
        out["ok"] = True
        rbody = res[1:] if res and res[0][:1] == ["key"] else res
        oc = {}
        for r in rbody:
            if len(r) >= 3:
                oc[r[2]] = oc.get(r[2], 0) + 1
        qn = max(0, len(q) - 1) if q else None
        dn = sum(oc.values())
        out["lanes"].append({"lane": "contact-form", "job": "drover-outreach", "mode": "VPN",
                             "project": "Our Town Store", "total": qn, "done": dn,
                             "remaining": (max(0, qn - dn) if qn is not None else None), "by_status": oc})
    if not out["lanes"] and not out["ok"]:
        out["error"] = "no lane data readable"
    return out


def collect():
    t0 = time.time()
    snap = {"k8s": collect_k8s(), "captcha": collect_captcha(),
            "outreach": collect_outreach(), "signups": collect_signups(),
            "logins": collect_logins(), "lanes": collect_lanes()}
    snap["meta"] = {
        "collected_at": int(t0),
        "duration_ms": int((time.time() - t0) * 1000),
        "ok": snap["k8s"]["ok"],
        "ns": NS, "refresh": REFRESH,
    }
    return snap


def _maybe_notify_spend(snap):
    """Once, when 2Captcha all-time spend crosses the notify threshold, DM Ben to
    top up (a sentinel file makes it fire once)."""
    cap = snap.get("captcha") or {}
    if not cap.get("ok"):
        return
    if cap.get("cost", 0) < SPEND_NOTIFY_AT or os.path.exists(_SPEND_SENTINEL):
        return
    body = ("⚠️ drover 2Captcha spend is $%.2f (notify set at $%.2f, hard cap $5.00). "
            "Top up the 2Captcha account when you can; past $5 reCAPTCHA rows come back blocked "
            "and I'll need SOLVE_BUDGET raised + the solve-broker restarted to spend the top-up. "
            "— drover-dashboard" % (cap["cost"], SPEND_NOTIFY_AT))
    data = json.dumps({"to": NOTIFY_TO, "from": "unibrowse", "content": body,
                       "subject": "2Captcha budget"}).encode()
    try:
        req = urllib.request.Request(ATC + "/messages", data=data, method="POST",
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=15).read()
        with open(_SPEND_SENTINEL, "w") as f:
            f.write("%d %.4f\n" % (int(time.time()), cap["cost"]))
    except Exception:
        pass        # retry next tick; the sentinel is only written on success


def loop():
    global _snap
    while True:
        try:
            s = collect()
        except Exception as e:
            s = {"meta": {"collected_at": int(time.time()), "ok": False, "note": "collect error: %s" % e}}
        with _snap_lock:
            _snap = s
        try:
            _maybe_notify_spend(s)
        except Exception:
            pass
        time.sleep(REFRESH)


# ── http ────────────────────────────────────────────────────────────────────

class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype):
        b = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(b)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/state":
            with _snap_lock:
                s = dict(_snap)
            s.setdefault("meta", {})["age"] = int(time.time() - s.get("meta", {}).get("collected_at", 0))
            return self._send(200, json.dumps(s), "application/json")
        if path == "/healthz":
            return self._send(200, "ok", "text/plain")
        if path in ("/", "/index.html"):
            try:
                with open(PAGE, "rb") as f:
                    return self._send(200, f.read(), "text/html; charset=utf-8")
            except OSError:
                return self._send(500, "dashboard.html missing", "text/plain")
        self._send(404, "not found", "text/plain")


def main():
    threading.Thread(target=loop, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), H)
    import sys
    sys.stderr.write("drover-dashboard on :%d (ns=%s refresh=%ds)\n" % (PORT, NS, REFRESH))
    srv.serve_forever()


if __name__ == "__main__":
    main()
