#!/usr/bin/env python3
"""Issue a job to the `drover` dispatcher and collect its replies -- the wire a
lane (business outreach, alpaca, a shopping seat, a cron) uses to drive
drover-as-a-service without being an LLM.

It is the sending half of dispatcher.py: register a throwaway subscriber, DM the
job envelope to `drover`, long-poll this subscriber's inbox for the dispatcher's
replies, print each, and exit when the terminal reply lands. Token-free: a lane
shells this, it does not spend a seat.

  # the proven unit: one live contact-form chunk, VPN exit
  client.py --job outreach --n 8 --shards 4
  client.py --job outreach --n 8 --shards 4 --dry     # fill, send NOTHING
  client.py --job outreach --retry                    # the once-only retry set
  client.py --job signup --n 320 --shards 16
  client.py --job session --fresh --vpn us
  client.py --job status
  client.py --raw '{"job":"outreach","n":8,"shards":4}'   # any envelope verbatim

Exit 0 = the dispatcher reported the job done with rc=0 (batch), or a non-batch
job's single reply arrived; 1 = the job failed / reported a non-zero rc; 2 = no
reply before --wait elapsed (the dispatcher may still be working -- this times
out the client, not the job).

⛔ A non-dry outreach/signup row is a REAL message to a stranger. The lane
dedupes (lane.py never re-picks a key in its results, a pod is never retried) so
a duplicate dispatch cannot re-send, but --dry is there for a test.
"""
import argparse, json, os, sys, time, urllib.error, urllib.request

ATC = os.environ.get("ATC_URL", "http://192.168.1.168:3030")
DROVER = os.environ.get("DROVER_DISPATCH_ID", "drover")


def http(method, path, body=None, timeout=70):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(ATC + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, None
    except urllib.error.URLError as e:
        return 0, {"error": str(e)}


def envelope(a):
    if a.raw:
        env = json.loads(a.raw)
        if "job" not in env:
            sys.exit("--raw envelope has no \"job\"")
        return env
    if not a.job:
        sys.exit("need --job or --raw")
    env = {"job": a.job}
    if a.job in ("outreach", "signup"):
        if a.n is not None:
            env["n"] = a.n
        if a.shards is not None:
            env["shards"] = a.shards
        if a.dry:
            env["dry"] = True
        if a.retry:
            env["retry"] = True
        if a.keys:
            env["keys"] = a.keys
        if a.nord:
            env["nord"] = a.nord
    elif a.job == "session":
        if a.profile:
            env["profile"] = a.profile
        if a.fresh:
            env["fresh"] = True
        if a.vpn:
            env["vpn"] = a.vpn
    elif a.job == "release":
        env["pod"] = a.pod or sys.exit("--job release needs --pod")
    return env


def terminal(job, content):
    """Has the job's LAST reply arrived? A batch (outreach/signup) sends a
    'started' then a 'done (rc=N)'/'FAILED'; everything else is one reply."""
    low = content.lower()
    if job in ("outreach", "signup"):
        return ("done (rc=" in low) or ("failed" in low)
    return True


def succeeded(content):
    low = content.lower()
    if "done (rc=" in low:
        return "done (rc=0)" in low
    return not ("failed" in low or "unreachable" in low or "unknown job" in low)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", choices=["outreach", "signup", "session", "release", "status"])
    ap.add_argument("--raw", help="a full JSON envelope, used verbatim")
    ap.add_argument("--n", type=int)
    ap.add_argument("--shards", type=int)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--retry", action="store_true")
    ap.add_argument("--keys")
    ap.add_argument("--nord")
    ap.add_argument("--profile")
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--vpn")
    ap.add_argument("--pod")
    ap.add_argument("--wait", type=int, default=3600,
                    help="seconds to wait for the terminal reply (client-side only)")
    a = ap.parse_args()
    env = envelope(a)
    job = env["job"]

    me = "drover-client-%d-%d" % (os.getpid(), int(time.time()))
    st, _ = http("POST", "/subscribers",
                 {"id": me, "agent_id": me, "hostname": os.uname().nodename, "zones": [me]})
    if st not in (200, 201, 204):
        sys.exit("register failed (%s)" % st)
    try:
        st, _ = http("POST", "/messages",
                     {"to": DROVER, "from": me, "content": json.dumps(env), "subject": "job"})
        if st not in (200, 201, 204):
            sys.exit("send failed (%s)" % st)
        print("-> %s  %s" % (DROVER, json.dumps(env)), flush=True)

        deadline = time.time() + a.wait
        last = ""
        while time.time() < deadline:
            st, body = http("GET", "/inbox/%s/poll?timeout=30" % me, timeout=40)
            if st == 204 or not body:
                continue
            msgs = body if isinstance(body, list) else (
                body.get("messages") if isinstance(body, dict) and "messages" in body else [body])
            for m in msgs:
                if not isinstance(m, dict):
                    continue
                content = (m.get("content") or "").strip()
                if not content:
                    continue
                last = content
                print("<- %s" % content, flush=True)
                if terminal(job, content):
                    sys.exit(0 if succeeded(content) else 1)
        print("!! no terminal reply within %ds (job may still be running)" % a.wait, flush=True)
        sys.exit(0 if (last and succeeded(last)) else 2)
    finally:
        http("DELETE", "/subscribers/%s" % me)


if __name__ == "__main__":
    main()
