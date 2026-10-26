#!/usr/bin/env python3
"""The machinery every Drover `session` flow needs, and none of the policy.

⭐ WHY THIS IS SHARED. The Console credit lane and the claude.ai session lane
are the same shape -- one kept profile, a magic link that arrives by mail, a
6-digit code read in a disposable browser and typed back into the tab that is
still waiting -- and differ only in URLs and wording. The second copy of that
orchestration would have been the place the two drifted, and the half that did
not get a fix would have gone on looking fine.

What stays in the flow that imports this: its URLs, its steps, its own
assertions, and whatever guard it needs before an irreversible act. A guard is
policy and belongs to the lane that owns the consequence.
"""
import json, os, pathlib, re, shutil, subprocess, sys, tempfile, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lock  # the per-profile Chrome lock: no two containers on one profile at once

IMAGE = os.environ.get("DROVER_IMAGE", "192.168.1.168:32000/drover/worker:2026-10-26in")
# ⬆ 2026-10-26in carries the --disable-gpu-compositing input fix baked into the
# worker (drover: trusted input dropped after a navigation). Mirror to the k8s
# registry 192.168.1.207:5050 and bump session-pod / outreach tags there too.

# magiclink.py lives with v1 and is host-local to office: it shells out to
# /home/ben/scripts/gmail. sack.io is a catch-all into Ben's mailbox, which is
# why it filters on sender and subject as well as recipient. `kind` picks the
# product: "console" for platform.claude.com, "ai" for claude.ai -- they send
# different mail and the wrong one matches nothing.
MAGICLINK = "/mnt/nas/data/code/unibrowse/scripts/console-credits/magiclink.py"


def choose_field(share, seconds=60):
    """Pick the code box from the controls the page reported, and tell the
    waiting flow which it is.

    ⭐ THIS IS WHY `eval` CAN WRITE. The alternative was a human reading a
    screenshot inside the await's window, which is not a mechanism -- it is a
    person being lucky. The page reports its own inputs, the selector is
    derived from their attributes, and the run no longer depends on anyone
    watching.
    """
    f = pathlib.Path(share, "controls.json")
    dl = time.time() + seconds
    while time.time() < dl and not f.exists():
        time.sleep(1)
    if not f.exists():
        return None, "the page never reported its controls"
    try:
        controls = json.loads(f.read_text())
    except Exception as e:
        return None, "controls unreadable: %s" % e
    # [tag, type, inputmode, maxlength, aria-label, text]
    inputs = [c for c in controls if c[0] == "INPUT"]
    for attr, idx, css in (("inputmode", 2, "input[inputmode=%r]"),
                           ("maxlength", 3, "input[maxlength=%r]")):
        for c in inputs:
            if c[idx]:
                sel = (css % c[idx]).replace("'", '"')
                pathlib.Path(share, "field.txt").write_text(sel)
                return sel, None
    if len(inputs) == 1:
        sel = "input[type=%s]" % inputs[0][1] if inputs[0][1] else "input"
        pathlib.Path(share, "field.txt").write_text(sel)
        return sel, None
    return None, "no single code box among %d inputs: %s" % (len(inputs), inputs[:6])


def fetch_code(email_addr, link, share, out):
    """Open the magic link in a DIFFERENT, disposable browser and read the
    6-digit verification code off the redeem page.

    ⭐ WHY NOT IN THE SAME BROWSER. The tab that asked for the link is holding
    its sign-in, and one profile cannot be driven by two Chromes (the profile
    lock). Anthropic's redeem page is built for exactly this: opened elsewhere
    it shows a code and says to enter it where the sign-in started. So the
    disposable browser never becomes a logged-in session, and the kept profile
    never has to be abandoned mid-flow.
    """
    # Beside the share dir, not inside it: the share dir is mounted into the
    # waiting container, and a disposable profile that has just consumed a
    # magic link should not be readable from there.
    tmp = tempfile.mkdtemp(prefix="drover-redeem-", dir=pathlib.Path(share).parent)
    try:
        r = run_session(tmp, [
            {"do": "nav", "url": link},
            {"do": "wait", "seconds": 10},
            {"do": "read", "sel": "body", "as": "page"},
            {"do": "shot", "path": "/out/redeem.png"},
        ], out=out, timeout=300)
        page = (r.get("reads") or {}).get("page") or ""
        m = re.search(r"verification code[^0-9]{0,80}(\d{6})", page, re.I) or re.search(r"\b(\d{6})\b", page)
        return (m.group(1) if m else None), page
    finally:
        # ⛔ A profile that has consumed a magic link holds that session's
        # cookies. It is a credential store, so it does not outlive the call.
        shutil.rmtree(tmp, ignore_errors=True)


def orchestrate_login(profile, email_addr, steps, kind="console", guard=None):
    """Drive a magic-link login to completion on a KEPT profile.

    `guard` is a callable returning a reason to refuse, or None -- policy the
    owning lane supplies, because only that lane knows what else competes for
    the same rate-limited login. `kind` picks the product's mail ("console" or
    "ai"); the wrong one matches no message at all.
    """
    why = guard() if guard else None
    if why:
        raise SystemExit("refusing to submit: " + why)
    # Hold the Chrome lock for the whole login: the background browser keeps the
    # kept profile open, and nothing else may open it meanwhile. Acquired here,
    # not via run_session -- a flock cannot outlive the function that takes it,
    # and run_session hands back a Popen that outlives its own call.
    _login_lock = _lock.chrome_lock(str(profile))
    _login_lock.__enter__()
    # A floor one minute back: a link minted while we were reading the clock is
    # still this run's link, and a floor of exactly now can miss it.
    floor = time.time() - 60
    share = pathlib.Path(tempfile.mkdtemp(prefix="drover-login-", dir=rundir(profile)))
    # ⚠️ The shots must OUTLIVE the share dir, which is deleted in the finally
    # because it holds the code. Keeping them is the whole record of a page
    # that costs a single-use link to see.
    out = pathlib.Path(os.environ.get("DROVER_LOGIN_SHOTS") or (str(share) + "-shots"))
    out.mkdir(parents=True, exist_ok=True)
    for d in (share, out):
        d.chmod(0o777)        # the container runs as uid 1000 and must write /share
    proc = td = None
    try:
        proc, td = run_session(str(profile), steps, share=str(share),
                               out=str(out), background=True)
        print("submitted; waiting for the link (floor %.0f)" % floor, flush=True)
        # Before the mail: the page reports its own inputs within ~20s and the
        # await that consumes this answer opens before a link normally arrives.
        # ⚠️ Not fatal if it cannot decide -- the flow carries a default and is
        # already waiting on it. But say which one is in play, because "it
        # worked" and "it worked on the default" are different facts about a
        # page this file has only seen once.
        sel, why = choose_field(share)
        print("code field: %s" % (sel or "default (%s)" % why), flush=True)
        link = None
        deadline = time.time() + 300
        while time.time() < deadline and proc.poll() is None:
            time.sleep(10)
            g = subprocess.run([sys.executable, MAGICLINK, email_addr, kind, str(floor)],
                               capture_output=True, text=True)
            if g.returncode == 0 and g.stdout.strip():
                link = g.stdout.strip()
                break
        if not link:
            # ⛔ DRAIN THE CONTAINER BEFORE BLAMING THE MAILBOX. If a step
            # failed, the browser is already gone and its step log is the
            # answer -- "no link arrived" would be true and useless, and the
            # log would be discarded with the process. Two different failures
            # must not read the same.
            if proc.poll() is not None:
                try:
                    r = result_of(proc_output(proc, timeout=30))
                    raise SystemExit("the session ended before a link arrived: %s"
                                     % json.dumps(r.get("steps")))
                except SystemExit:
                    raise
                except Exception as e:
                    raise SystemExit("the session ended before a link arrived and "
                                     "its output could not be read: %s" % e)
            raise SystemExit("no magic link arrived within 300s while the browser was "
                             "still waiting; the submit may have been refused -- "
                             "shots are in %s" % out)
        # ⛔ The link itself is a single-use credential: its LENGTH is reported,
        # never the URL, and it is not written to the json output.
        print("link found (%d chars); opening it in a disposable browser" % len(link), flush=True)
        code, redeem = fetch_code(email_addr, link, share, str(out))
        if not code:
            raise SystemExit("the redeem page showed no 6-digit code; first 300 chars: "
                             + redeem[:300])
        (share / "code.txt").write_text(code)
        print("code handed over (%d digits); waiting for the sign-in" % len(code), flush=True)
        r = result_of(proc_output(proc, timeout=700))
        return r, redeem
    finally:
        if proc and proc.poll() is None:
            proc.kill()
        # ⛔ The code file holds a live credential for as long as this directory
        # exists, so it goes away whatever happened.
        shutil.rmtree(share, ignore_errors=True)
        if td:
            shutil.rmtree(td, ignore_errors=True)
        _login_lock.__exit__(None, None, None)


class proc_output:
    """Popen's captured streams in the shape result_of expects."""
    def __init__(self, proc, timeout=700):
        # communicate(), not wait(): a pipe that fills while nothing reads it
        # deadlocks the container, and the symptom is a browser that looks hung.
        self.stdout, self.stderr = proc.communicate(timeout=timeout)


def rundir(profile):
    """Where this flow puts the directories it bind-mounts.

    ⛔ NOT /tmp. Measured 2026-10-25: server4's docker daemon has a PRIVATE
    /tmp, so `-v /tmp/x:/steps` mounts a directory the container sees as EMPTY
    -- no error, no warning, just no files. The worker then read the path as
    inline JSON and died with "Expecting value: line 1 column 1", and that was
    read elsewhere as "the kept profile only works where the browser is".
    It is not host affinity; it is a mount the daemon cannot see.

    Beside the profile is the right place anyway: the share directory briefly
    holds a single-use code, the profile directory is already mode 700, and
    both belong to one account.
    """
    d = pathlib.Path(os.environ.get("DROVER_RUNDIR")
                     or (str(pathlib.Path(profile).resolve()) + ".run"))
    d.mkdir(parents=True, exist_ok=True)
    os.chmod(d, 0o700)
    return str(d)


def run_session(profile, steps, timeout=420, share=None, out=None, background=False):
    """Run one `session` container. `share` is mounted rw at /share -- the
    orchestrator drops the emailed code there mid-run -- and `out` rw at /out
    for screenshots. `background` returns the Popen and the steps directory for
    the caller to clean up, because an orchestrated login has to do host work
    (read mail, open the link elsewhere) WHILE the browser holds its tab.
    """
    td = tempfile.mkdtemp(prefix="drover-steps-", dir=rundir(profile))
    try:
        pathlib.Path(td, "steps.json").write_text(json.dumps(steps))
        cmd = [
            "docker", "run", "--rm", "--shm-size=512m",
            # ⛔ Without unconfined seccomp Chrome dies at startup and the only
            # symptom is "RuntimeError: browser went away" -- it names nothing.
            # This is the docker equivalent of the pod's seccompProfile.
            "--security-opt", "seccomp=unconfined",
            "-e", "DROVER_PROFILE=/prof",
            "-v", f"{profile}:/prof", "-v", f"{td}:/steps:ro",
        ]
        if share:
            cmd += ["-v", f"{share}:/share"]
        if out:
            cmd += ["-v", f"{out}:/out"]
        # ⛔ MOUNT THE REPO'S WORKER OVER THE IMAGE'S. The published tag lags
        # the repo, and `session` does not exist in 2026-10-25r at all -- the
        # image refuses the subcommand outright, which is at least a loud
        # failure. Retagging instead would be the wrong fix: the outreach lane
        # pins its own tag in k8s/outreach-job.yaml and its owner asked to be
        # told before it moves, so building a new image under it is not mine to
        # do quietly. 2026-10-25s was built from HEAD by that owner and does
        # carry `session`, so the mount is now a no-op against a matching tag
        # and exists only to pick up repo edits made since the last build.
        # DROVER_NO_MOUNT=1 turns it off.
        # ⛔ FORWARD ONLY THE VARS THE STEPS NAME, AND BY NAME ONLY. docker run
        # does not inherit the host environment, so a step with {"env": "X"}
        # reports missing-field in the container while X is plainly set on the
        # host -- measured, and it reads like a bug in the step. `-e NAME` with
        # no =value takes the value from the host env without it ever appearing
        # in the command line, which `ps` shows to every user on the box.
        for st in steps:
            for key in ("env", "env_value"):
                if st.get(key):
                    cmd += ["-e", st[key]]
        # Egress: the worker reads DROVER_PROXY (and _BYPASS) to route Chrome
        # through a VPN exit. `-e NAME` with no =value takes it from the host
        # env, so the proxy URL (which carries a password) never hits argv.
        for v in ("DROVER_PROXY", "DROVER_PROXY_BYPASS",
                  "DROVER_CHROME_ARGS", "DROVER_WM", "DROVER_SCREEN"):
            if os.environ.get(v):
                cmd += ["-e", v]
        worker = pathlib.Path(__file__).resolve().parent.parent / "worker" / "drover_worker.py"
        if os.environ.get("DROVER_NO_MOUNT") != "1" and worker.is_file():
            cmd += ["-v", f"{worker}:/opt/drover/worker/drover_worker.py:ro"]
        cmd += [IMAGE, "session", "--steps", "/steps/steps.json"]
        if background:
            # The caller (orchestrate_login) holds the Chrome lock around the
            # whole background lifetime itself -- a flock cannot outlive this
            # function, so it cannot be taken here for a proc we return.
            return subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True), td
        with _lock.chrome_lock(profile):
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    finally:
        if not background:
            shutil.rmtree(td, ignore_errors=True)
    return result_of(p)


def result_of(p):
    line = [l for l in p.stdout.splitlines() if l.startswith("{")]
    if not line:
        raise SystemExit("session produced no result: %s" % (p.stderr.strip()[-300:] or "no stderr"))
    return json.loads(line[-1])


