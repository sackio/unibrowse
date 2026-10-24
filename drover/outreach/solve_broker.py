#!/usr/bin/env python3
"""Paid captcha solves for Drover pods, on the host, under the outreach lane's
ONE spend ledger and cap (Ben, #unibrowse-v2 2026-10-24 17:18; `unibrowse`:
one cap, one ledger, never a solve bought inside a pod).

  SOLVE_BUDGET=5.00 BROKER_TOKEN_FILE=… solve_broker.py [--port 18791]

POST /solve {url, kind, sitekey, action?, enterprise?}  with
  Authorization: Bearer <token>   →  {token, cost, field} | {error}

⛔ The cap is read from the ledger the v1 engine writes
(business/outreach/captcha-spend.tsv), summed on EVERY request, never cached:
a per-process total is the bug that ledger exists to stop. Solves in flight
are reserved at their worst-case price before they start, so concurrent pods
cannot overshoot. The ledger line format is the engine's own.
⛔ The 2Captcha key is read from its mode-600 file and never logged. The bearer
token keeps the rest of the LAN from spending it.
The task shapes mirror service_solve() in bin/captcha_solve.py.
"""
import argparse, json, os, pathlib, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CAPTCHA_ENV = pathlib.Path("/mnt/nas/data/code/scripts/2captcha/.env")
LEDGER = pathlib.Path(os.environ.get("SPEND_LEDGER", "/mnt/nas/data/code/business/outreach/captcha-spend.tsv"))
BUDGET = float(os.environ["SOLVE_BUDGET"])           # required: no default cap on someone else's money
WORST = 0.005                                         # reserve per solve in flight (v2 measured $0.00299)
TASKS = {"recaptcha-v2": "RecaptchaV2TaskProxyless", "recaptcha-invisible": "RecaptchaV2TaskProxyless",
         "recaptcha-v3": "RecaptchaV3TaskProxyless", "turnstile": "TurnstileTaskProxyless"}
FIELDS = {"turnstile": "cf-turnstile-response"}
KEY = next(l.split("=", 1)[1].strip() for l in CAPTCHA_ENV.read_text().splitlines() if l.startswith("CAPTCHA_API_KEY="))
TOKEN = pathlib.Path(os.environ["BROKER_TOKEN_FILE"]).read_text().strip()
lock, inflight = threading.Lock(), [0]


def spent():
    total = 0.0
    if LEDGER.exists():
        for line in LEDGER.read_text().splitlines():
            p = line.split("\t")
            try:
                total += float(p[1])
            except (IndexError, ValueError):
                pass
    return total


def api(path, payload):
    req = urllib.request.Request(f"https://api.2captcha.com/{path}", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read().decode())


def solve(c):
    kind = c.get("kind")
    if kind not in TASKS or not c.get("sitekey") or not c.get("url"):
        raise ValueError(f"need url, sitekey and a kind in {sorted(TASKS)}")
    with lock:
        s = spent()
        if s + (inflight[0] + 1) * WORST > BUDGET:
            raise ValueError(f"spend cap reached (${s:.4f} spent, {inflight[0]} in flight, cap ${BUDGET:.2f})")
        inflight[0] += 1
    try:
        task = {"type": TASKS[kind], "websiteURL": c["url"], "websiteKey": c["sitekey"]}
        if kind == "recaptcha-invisible":
            task["isInvisible"] = True
        if kind == "recaptcha-v3":
            task["minScore"] = 0.3
            if c.get("action"):
                task["pageAction"] = c["action"]
        if kind.startswith("recaptcha") and c.get("enterprise"):
            task["isEnterprise"] = True
        made = api("createTask", {"clientKey": KEY, "task": task})
        if made.get("errorId"):
            raise ValueError(f"createTask: {made.get('errorCode')} {made.get('errorDescription', '')}")
        for _ in range(36):
            time.sleep(5)
            got = api("getTaskResult", {"clientKey": KEY, "taskId": made["taskId"]})
            if got.get("errorId"):
                raise ValueError(f"getTaskResult: {got.get('errorCode')}")
            if got.get("status") == "ready":
                cost = float(got.get("cost") or 0)
                with LEDGER.open("a") as fh:      # a ledger we cannot write raises: no spending blind
                    fh.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')}\t{cost:.5f}\t{TASKS[kind]}\t{c['url']}\n")
                sol = got.get("solution") or {}
                tok = sol.get("gRecaptchaResponse") or sol.get("token")
                if not tok:
                    raise ValueError(f"paid ${cost:.5f} but the solution had no token")
                return {"token": tok, "cost": cost, "field": FIELDS.get(kind, "g-recaptcha-response")}
        raise ValueError("not ready after 180s")
    finally:
        with lock:
            inflight[0] -= 1


class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):                   # the default would log nothing secret, but keep it quiet
        pass

    def do_POST(self):
        if self.headers.get("Authorization") != f"Bearer {TOKEN}":
            return self.reply(403, {"error": "forbidden"})
        try:
            c = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            r = solve(c)
            print(time.strftime("%H:%M:%S"), "solved", c.get("kind"), c.get("url"), f"${r['cost']:.5f}", flush=True)
            self.reply(200, r)
        except Exception as e:
            print(time.strftime("%H:%M:%S"), "refused", str(e)[:200], flush=True)
            self.reply(200, {"error": str(e)[:300]})

    def reply(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18791)
    a = ap.parse_args()
    print(f"broker on :{a.port}, ledger {LEDGER} at ${spent():.4f} of ${BUDGET:.2f}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", a.port), H).serve_forever()
