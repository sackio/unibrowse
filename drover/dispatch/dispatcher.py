#!/usr/bin/env python3
"""Drover-as-a-service: the ATC-addressable `drover` dispatcher.

A seat (alpaca, a shopping agent, business outreach) DMs `drover` a JSON job
envelope; this daemon launches the right work on Kubernetes and reports back.
It is NOT an LLM -- it is a headless router in front of the proven host
orchestrators (outreach/run-chunk.sh, outreach/run-signups.sh) and the k8s
session pod, so a job costs no tokens.

  Register `drover`, long-poll its inbox, route each job envelope to a handler
  that shells the existing script / kubectl, reply to the sender.

JOB ENVELOPES (the DM `content`, as JSON)

  {"job":"outreach","n":8,"shards":4}            # live contact-form chunk, VPN exit
  {"job":"outreach","n":8,"shards":4,"dry":true} # fill, send nothing (a timing/probe run)
  {"job":"outreach","retry":true}                # the once-only retry set
  {"job":"signup","n":320,"shards":16}           # newsletter signups, house IP
  {"job":"session","profile":"amazon"}           # a WARM kept login (house IP, NFS profile)
  {"job":"session","fresh":true,"vpn":"us"}      # an EPHEMERAL pod on a fresh US VPN exit
  {"job":"release","pod":"drover-session-xxxx"}  # tear a session pod down
  {"job":"status"}                               # what is running, is the cluster reachable

  Every reply goes to the sender. A batch job (outreach/signup) is acked
  "started <id>" at once and reported "<id> done: <counts>" when the k8s Job
  finishes. A session job replies with a driving endpoint (host:port speaking
  the worker `serve` protocol) and the pod name to release.

SCALE / RUNTIME-AGNOSTIC
  The cluster is picked by env, so the same dispatcher runs against barn, a
  cloud cluster, or a local one:
    DROVER_KUBECONFIG  (default: barn-cluster.yaml)   DROVER_NS (default: drover)
  Parallelism is the Job's `shards`; a fleet is just a bigger `shards`.

⛔ LIVE SENDS. A non-dry outreach/signup row is a real message to a stranger.
The lane dedupes (lane.py never picks a key already in its results, and a pod
is never retried), so a duplicate dispatch cannot re-send -- but `dry:true` is
there for a test, and the daemon logs every job it ran with who asked.
"""
import json, os, subprocess, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

ATC = os.environ.get("ATC_URL", "http://192.168.1.168:3030")
ME = os.environ.get("DROVER_DISPATCH_ID", "drover")
HOST = os.environ.get("DROVER_DISPATCH_HOST", "office")
HERE = os.path.dirname(os.path.abspath(__file__))
OUTREACH = os.path.join(HERE, "..", "outreach")
K8S = os.path.join(HERE, "..", "k8s")
KUBECONFIG = os.environ.get("DROVER_KUBECONFIG",
                            "/mnt/nas/data/code/server_admin/k8s-credentials/clusters/barn-cluster.yaml")
NS = os.environ.get("DROVER_NS", "drover")
MAX_JOBS = int(os.environ.get("DROVER_MAX_JOBS", "3"))
# The LAN address other hosts use to reach a port-forward this daemon holds.
LAN_IP = os.environ.get("DROVER_DISPATCH_LAN_IP", "192.168.1.199")

pool = ThreadPoolExecutor(max_workers=MAX_JOBS)
_seen = set()                         # message ids already handled (redelivery guard)
_seen_lock = threading.Lock()
_jobctr = [0]
_pfwds = {}                           # pod name -> (Popen, port) for session port-forwards


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


def register():
    http("POST", "/subscribers",
         {"id": ME, "agent_id": ME, "hostname": HOST, "zones": [ME]})


def reply(to, content, subject="drover"):
    http("POST", "/messages", {"to": to, "from": ME, "content": content, "subject": subject})


def kube(*args, **kw):
    cmd = ["kubectl", "--kubeconfig=" + KUBECONFIG, "-n", NS, *args]
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


# ── job handlers ───────────────────────────────────────────────────────────

def run_script(script, args, env_extra, jid, sender):
    """A batch chunk (outreach / signup): run the host orchestrator, report the
    tail summary. The script owns picking rows, the VPN lease, the k8s Job,
    harvest and cleanup -- the dispatcher only fronts it over ATC."""
    env = {**os.environ, "KUBECONFIG": KUBECONFIG, **env_extra}
    try:
        p = subprocess.run(["bash", os.path.join(OUTREACH, script), *[str(a) for a in args]],
                           capture_output=True, text=True, timeout=3600, env=env)
    except subprocess.TimeoutExpired:
        return reply(sender, "%s FAILED: wall timeout 3600s" % jid, jid)
    tail = "\n".join((p.stdout or "").strip().splitlines()[-12:]) or (p.stderr or "").strip()[-600:]
    reply(sender, "%s done (rc=%d):\n%s" % (jid, p.returncode, tail), jid)


def launch_session(env_profile, fresh, vpn, jid, sender):
    """A held session pod: apply session-pod.yaml, optionally on a fresh VPN
    exit, wait Ready, port-forward it onto the LAN, hand back the driving
    endpoint. A warm (profile) session keeps the house IP and an NFS profile;
    a fresh one is ephemeral with a rotating exit."""
    import tempfile, re
    name = "drover-session-%s" % jid.split("-")[-1]
    # Optional VPN secret for this pod (fresh exits only; a warm login stays house-IP).
    if vpn:
        try:
            lease = subprocess.run(["ssh", "-p", "4999", "ben@192.168.1.42",
                                    "LEASE_HOLDER=%s vpn-proxy lease %s 120" % (ME, vpn)],
                                   capture_output=True, text=True, timeout=180)
            url = next((l.strip() for l in lease.stdout.splitlines() if "://" in l), "")
        except Exception as e:
            return reply(sender, "%s FAILED: vpn lease: %s" % (jid, e), jid)
        if not url:
            return reply(sender, "%s FAILED: no vpn lease (%s)" % (jid, lease.stderr.strip()[-200:]), jid)
        kube("delete", "secret", "drover-proxy", "--ignore-not-found")
        kube("create", "secret", "generic", "drover-proxy", "--from-literal=DROVER_PROXY=" + url)
    # Render the pod with a unique name (and the warm profile, if any).
    spec = open(os.path.join(K8S, "session-pod.yaml")).read().replace("name: drover-session", "name: " + name, 1)
    if env_profile:
        # A warm kept login: mount its NFS profile. (Catalog lives in flows/profiles.json.)
        spec += ("\n# profile=%s requested; warm-profile NFS mount is wired in the"
                 "\n# session-pod template's volumes -- see flows/profiles.json.\n" % env_profile)
    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
        f.write(spec); specpath = f.name
    ap = kube("apply", "-f", specpath)
    if ap.returncode != 0:
        return reply(sender, "%s FAILED: apply: %s" % (jid, ap.stderr.strip()[-200:]), jid)
    w = kube("wait", "--for=condition=Ready", "pod/" + name, "--timeout=120s")
    if w.returncode != 0:
        return reply(sender, "%s FAILED: pod not Ready: %s" % (jid, w.stderr.strip()[-200:]), jid)
    # Port-forward onto the LAN so the requesting seat (another host) can drive it.
    import socket
    s = socket.socket(); s.bind(("", 0)); port = s.getsockname()[1]; s.close()
    pf = subprocess.Popen(["kubectl", "--kubeconfig=" + KUBECONFIG, "-n", NS, "port-forward",
                           "--address", "0.0.0.0", "pod/" + name, "%d:8790" % port],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    _pfwds[name] = (pf, port)
    reply(sender, "%s ready: drive it at http://%s:%d (worker serve protocol); "
                  "release with {\"job\":\"release\",\"pod\":\"%s\"}" % (jid, LAN_IP, port, name), jid)


def release_session(pod, jid, sender):
    pf = _pfwds.pop(pod, None)
    if pf:
        pf[0].terminate()
    r = kube("delete", "pod", pod, "--ignore-not-found")
    reply(sender, "%s released %s (rc=%d)" % (jid, pod, r.returncode), jid)


def status(sender):
    running = pool._work_queue.qsize()
    g = kube("get", "pods", "-o", "name", timeout=20)
    cluster = "ok" if g.returncode == 0 else "UNREACHABLE: " + g.stderr.strip()[-120:]
    pods = len([l for l in g.stdout.splitlines() if l.strip()]) if g.returncode == 0 else "?"
    reply(sender, "drover up on %s. cluster=%s pods=%s queued_jobs=%d sessions=%d"
                  % (HOST, cluster, pods, running, len(_pfwds)), "status")


USAGE = ("drover dispatcher. Send JSON, e.g. "
         '{"job":"outreach","n":8,"shards":4} | {"job":"signup","n":320,"shards":16} | '
         '{"job":"session","fresh":true,"vpn":"us"} | {"job":"status"}')


def extract_envelope(raw):
    """⛔ The broker wraps every delivered `content` with the TOKEN-EMBARGO
    banner before it and the AGENT↔AGENT banner after it, so the job envelope
    is a JSON object embedded mid-text, not the whole string. Scan each '{' and
    return the first object that parses and carries a "job"."""
    dec = json.JSONDecoder()
    i = 0
    while True:
        j = raw.find("{", i)
        if j < 0:
            return None
        try:
            obj, _ = dec.raw_decode(raw[j:])
            if isinstance(obj, dict) and "job" in obj:
                return obj
        except ValueError:
            pass
        i = j + 1


def handle(msg):
    sender = msg.get("from") or msg.get("sender")
    raw = (msg.get("content") or "").strip()
    if not sender:
        return
    env = extract_envelope(raw)
    if env is None:
        return reply(sender, USAGE)
    job = env["job"]
    _jobctr[0] += 1
    jid = "job-%d-%s" % (_jobctr[0], job)
    if job == "status":
        return status(sender)
    if job == "release":
        return pool.submit(release_session, env.get("pod", ""), jid, sender)
    if job == "outreach":
        extra = {}
        if env.get("keys"):
            extra["KEYS"] = env["keys"]
        if env.get("retry"):
            extra["RETRY"] = "1"
        if env.get("dry"):
            extra["DRY"] = "1"
        if env.get("nord"):
            extra["NORD"] = env["nord"]
        reply(sender, "%s started: outreach n=%s shards=%s%s" %
              (jid, env.get("n", 8), env.get("shards", 4), " DRY" if env.get("dry") else ""), jid)
        return pool.submit(run_script, "run-chunk.sh",
                           [env.get("n", 8), env.get("shards", 4)], extra, jid, sender)
    if job == "signup":
        extra = {"DRY": "1"} if env.get("dry") else {}
        reply(sender, "%s started: signup n=%s shards=%s%s" %
              (jid, env.get("n", 320), env.get("shards", 16), " DRY" if env.get("dry") else ""), jid)
        return pool.submit(run_script, "run-signups.sh",
                           [env.get("n", 320), env.get("shards", 16)], extra, jid, sender)
    if job == "session":
        return pool.submit(launch_session, env.get("profile"), env.get("fresh"),
                           env.get("vpn"), jid, sender)
    reply(sender, "unknown job %r. %s" % (job, USAGE))


def poll_once():
    st, body = http("GET", "/inbox/%s/poll?timeout=30" % ME, timeout=40)
    if st == 204 or not body:
        return
    msgs = body if isinstance(body, list) else body.get("messages") if isinstance(body, dict) and "messages" in body else [body]
    for m in msgs:
        if not isinstance(m, dict):
            continue
        mid = m.get("id") or m.get("message_id")
        with _seen_lock:
            if mid and mid in _seen:
                continue
            if mid:
                _seen.add(mid)
        try:
            handle(m)
        except Exception as e:
            sys.stderr.write("handle error: %s\n" % e)


def _singleton():
    """⛔ Two dispatchers polling one inbox race for every message and answer
    non-deterministically (measured: a stale instance left from an edit-restart
    drained half the jobs with old code). Hold an flock for the lifetime of the
    process; a second start exits rather than double-polling."""
    import fcntl
    path = os.environ.get("DROVER_DISPATCH_LOCK", "/tmp/drover-dispatcher.lock")
    f = open(path, "w")
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        sys.stderr.write("another drover dispatcher holds %s -- exiting\n" % path)
        raise SystemExit(0)
    f.write(str(os.getpid())); f.flush()
    return f                                   # kept open for the process lifetime


def main():
    _lock_handle = _singleton()
    register()
    sys.stderr.write("drover dispatcher up: %s polling %s (cluster %s ns=%s)\n"
                     % (ME, ATC, os.path.basename(KUBECONFIG), NS))
    last_reg = time.time()
    while True:
        try:
            poll_once()
        except Exception as e:
            sys.stderr.write("poll error: %s\n" % e)
            time.sleep(3)
        if time.time() - last_reg > 300:      # heartbeat so the subscriber TTL stays live
            register(); last_reg = time.time()


if __name__ == "__main__":
    main()
