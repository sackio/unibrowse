#!/usr/bin/env python3
"""Read the Claude Console credit balance for one account, via Drover.

⭐ THE POINT IS NOT TO LOG IN. v1 (unibrowse/scripts/console-credits/cc2.py)
signs out and signs back in on EVERY run, which is why it keeps failing and why
hammering the address deferred the job in the first place: platform.claude.com
rate-limits the login itself, and a magic link is a single-use credential that
has to be fetched from mail mid-flow.

A Drover `session` keeps its profile (DROVER_PROFILE), so the session survives
between runs. The balance is then an ordinary authenticated page read and costs
no login attempt at all. Logging in is the rare path, not the hot one.

  console_credits.py --profile /mnt/nas/data/.secrets/drover-profiles/agents2
  console_credits.py --profile … --json out.json

Exit 0 = balance read · 3 = not signed in (the profile needs a login) · 1 = other.
⛔ Exit 3 is NOT a failure to report as one. It means "this profile has no
session yet", which is the expected state before the first login.

⚠️ `grants` is the authority, NOT any dollar figure on the page: the figures
include SPENT amounts and reading them as a balance once caused a 6x
overstatement (recorded against v1).
"""
import argparse, json, os, pathlib, re, shutil, subprocess, sys, tempfile, time, urllib.request

IMAGE = os.environ.get("DROVER_IMAGE", "192.168.1.168:32000/drover/worker:2026-10-25u")
BILLING = "https://platform.claude.com/settings/billing"

# Steps are data (see job_session). textContent, not innerText: v1 read the
# balance off innerText and measured it coming back as "Loading Loading
# Loading" with an empty figure list, which is indistinguishable from $0.
STEPS = [
    {"do": "nav", "url": BILLING},
    {"do": "wait", "seconds": 6},
    {"do": "read", "sel": "body", "as": "page"},
]

# A signed-out Console shows its login card. Matching on what the LOGIN page
# says is more reliable than guessing what the billing page says, because the
# billing page is still "Loading" for several seconds after it renders.
SIGNED_OUT = re.compile(r"continue with (google|email)|sign in to", re.I)
CREDIT = re.compile(r"(credit|grant|balance|expires)[^.]{0,120}", re.I)


# ── login ───────────────────────────────────────────────────────────────────
# ⛔ EVERYTHING UP TO THE SUBMIT IS FREE; THE SUBMIT IS NOT. Filling the field
# costs nothing and can be re-run all day. Pressing "Continue with email" asks
# Anthropic to send a real single-use link to a real mailbox, and hammering
# that address is what deferred this job originally. So the submit needs an
# explicit --submit; without it this stops one step short, having proved the
# page, the selectors and the typed value.
LOGIN_DRY = [
    {"do": "nav", "url": "https://platform.claude.com/login"},
    # Cold profile: this page can render nothing for ~60s. Poll, do not sleep.
    # `still`: the field existing is not the field having stopped moving. This
    # page shifted it ~44px after it appeared, and the click landed below it.
    {"do": "waitfor", "sel": "input[type=email]", "seconds": 90, "still": True},
    {"do": "click", "sel": "input[type=email]"},
    {"do": "type", "env": "DROVER_LOGIN_EMAIL"},
    # The check v1 never made: that the address actually landed in the field.
    # Its probe read "agents2@sac" -- 11 of 15 characters -- because it sampled
    # straight after typing; here the assertion is the step, not a side note.
    {"do": "expect", "sel": "input[type=email]", "env_value": "DROVER_LOGIN_EMAIL"},
    # Resolve the submit button WITHOUT pressing it: proves the text match
    # finds it, so a later --submit is not also testing the selector.
    {"do": "expect", "sel": "button", "text": "continue with email"},
]


# ── the orchestrated login ──────────────────────────────────────────────────
# ⛔ ONE CONSOLE LOGIN AT A TIME, AND THE OTHER LANE IS A SCHEDULE. v1's
# agents2-console-reprobe signs in to this same address on a timer. Two lanes
# submitting against one rate-limited login is what deferred this job in the
# first place, so the rule is to pause it before a submit -- enforced here
# rather than remembered, and FAIL CLOSED if the broker cannot be reached,
# because "I could not check" and "it is paused" are not the same answer.
REPROBE = "unibrowse/agents2-console-reprobe"
BROKER = "http://192.168.1.168:3030/inbound/unibrowse"

# magiclink.py lives with v1 and is host-local to office: it shells out to
# /home/ben/scripts/gmail. sack.io is a catch-all into Ben's mailbox, which is
# why it filters on sender and subject as well as recipient.
MAGICLINK = "/mnt/nas/data/code/unibrowse/scripts/console-credits/magiclink.py"


def reprobe_blocking():
    """Why a submit must not run now, or None."""
    try:
        with urllib.request.urlopen(BROKER, timeout=10) as r:
            d = json.load(r)
    except Exception as e:
        return "cannot reach the broker to check %s (%s)" % (REPROBE, e)
    for it in ((d.get("sources") or {}).get("schedules") or {}).get("items", []):
        if it.get("id") == REPROBE and it.get("state") == "armed":
            return "%s is armed (next %s); pause it first" % (REPROBE, it.get("next_at"))
    return None


def login_steps():
    """The submit flow. Everything before step 6 is free and was proved by
    --login; 6 is the assertion that the control is what we think it is, and 7
    is the one irreversible act in this file.

    ⚠️ THE PAGE AFTER THE SUBMIT HAS NEVER BEEN MEASURED HERE, and measuring it
    requires spending a real link. So the code field carries a default and an
    override window: a screenshot lands in /out while the `await` holds, and
    the orchestrator can drop a selector in /share/field.txt if the default is
    wrong, instead of this flow betting the attempt on a guess.
    """
    return [
        {"do": "nav", "url": "https://platform.claude.com/login"},
        {"do": "waitfor", "sel": "input[type=email]", "seconds": 90, "still": True},
        {"do": "click", "sel": "input[type=email]"},
        {"do": "type", "env": "DROVER_LOGIN_EMAIL"},
        {"do": "expect", "sel": "input[type=email]", "env_value": "DROVER_LOGIN_EMAIL"},
        {"do": "expect", "sel": "button", "text": "continue with email"},
        {"do": "click", "sel": "button", "text": "continue with email"},
        # ⛔ NO ASSERTION ON THE POST-SUBMIT WORDING. The obvious step here is
        # expect body contains "link sent" -- and a guessed string would halt
        # the run on a page that worked, after the link had already been sent,
        # losing the attempt to a typo in this file. THE MAILBOX IS THE PROOF
        # THE POST HAPPENED, and the orchestrator is already watching it. The
        # page is read and photographed for the record instead.
        {"do": "wait", "seconds": 8},
        {"do": "read", "sel": "body", "as": "posted"},
        {"do": "shot", "path": "/out/after-submit.png"},
        {"do": "await", "path": "/share/field.txt", "as": "field",
         "seconds": 60, "default": "input[inputmode=numeric], input[type=text], input"},
        {"do": "waitfor", "sel": {"from": "field"}, "seconds": 60, "still": True},
        {"do": "click", "sel": {"from": "field"}},
        # ⚠️ The code is a single-use credential. `from` forces the sensitive
        # typing path, only its length is logged, and the file it arrived in is
        # deleted by the orchestrator in a finally.
        {"do": "await", "path": "/share/code.txt", "as": "code", "seconds": 600},
        {"do": "type", "from": "code"},
        {"do": "wait", "seconds": 8},
        {"do": "read", "sel": "body", "as": "after"},
        {"do": "shot", "path": "/out/after-code.png"},
    ]


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
    tmp = tempfile.mkdtemp(prefix="drover-redeem-")
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


def orchestrate_login(profile, email_addr, jsonout=None):
    why = reprobe_blocking()
    if why:
        raise SystemExit("--submit refused: " + why)
    # A floor one minute back: a link minted while we were reading the clock is
    # still this run's link, and a floor of exactly now can miss it.
    floor = time.time() - 60
    share = pathlib.Path(tempfile.mkdtemp(prefix="drover-login-"))
    out = share / "out"
    out.mkdir()
    for d in (share, out):
        d.chmod(0o777)        # the container runs as uid 1000 and must write /share
    proc = td = None
    try:
        proc, td = run_session(str(profile), login_steps(), share=str(share),
                               out=str(out), background=True)
        print("submitted; waiting for the link (floor %.0f)" % floor, flush=True)
        link = None
        deadline = time.time() + 300
        while time.time() < deadline and proc.poll() is None:
            time.sleep(10)
            g = subprocess.run([sys.executable, MAGICLINK, email_addr, "console", str(floor)],
                               capture_output=True, text=True)
            if g.returncode == 0 and g.stdout.strip():
                link = g.stdout.strip()
                break
        if not link:
            raise SystemExit("no magic link arrived within 300s "
                             "(run: %s ...); the submit may have been refused -- "
                             "see %s" % (MAGICLINK, out))
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


class proc_output:
    """Popen's captured streams in the shape result_of expects."""
    def __init__(self, proc, timeout=700):
        # communicate(), not wait(): a pipe that fills while nothing reads it
        # deadlocks the container, and the symptom is a browser that looks hung.
        self.stdout, self.stderr = proc.communicate(timeout=timeout)


def run_session(profile, steps, timeout=420, share=None, out=None, background=False):
    """Run one `session` container. `share` is mounted rw at /share -- the
    orchestrator drops the emailed code there mid-run -- and `out` rw at /out
    for screenshots. `background` returns the Popen and the steps directory for
    the caller to clean up, because an orchestrated login has to do host work
    (read mail, open the link elsewhere) WHILE the browser holds its tab.
    """
    td = tempfile.mkdtemp(prefix="drover-steps-")
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
        worker = pathlib.Path(__file__).resolve().parent.parent / "worker" / "drover_worker.py"
        if os.environ.get("DROVER_NO_MOUNT") != "1" and worker.is_file():
            cmd += ["-v", f"{worker}:/opt/drover/worker/drover_worker.py:ro"]
        cmd += [IMAGE, "session", "--steps", "/steps/steps.json"]
        if background:
            return subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True), td
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True,
                    help="a directory kept across runs; one account, one profile")
    ap.add_argument("--json", help="write the full result here")
    ap.add_argument("--login", action="store_true",
                    help="drive the login page; stops before the submit unless --submit")
    ap.add_argument("--submit", action="store_true",
                    help="⛔ sends a REAL single-use magic link to the mailbox")
    a = ap.parse_args()
    prof = pathlib.Path(a.profile).resolve()
    # The container runs as uid 1000, so a profile it cannot write makes Chrome
    # fail in a way that looks like the seccomp fault above.
    prof.mkdir(parents=True, exist_ok=True)
    if a.login:
        if not os.environ.get("DROVER_LOGIN_EMAIL"):
            raise SystemExit("--login needs DROVER_LOGIN_EMAIL in the environment "
                             "(never on the command line: ps is world-readable)")
        if a.submit:
            r, redeem = orchestrate_login(prof, os.environ["DROVER_LOGIN_EMAIL"], a.json)
            page = (r.get("reads") or {}).get("after") or ""
            signed = not SIGNED_OUT.search(page[:4000])
            out = {"profile": str(prof), "submitted": True, "url": r.get("url"),
                   "steps": r.get("steps"), "ok": r.get("ok"), "signed_in": signed,
                   "redeemChars": len(redeem)}
            print(json.dumps(out))
            if a.json:
                pathlib.Path(a.json).write_text(json.dumps({**out, "result": r}, indent=1))
            sys.exit(0 if signed else 1)
        r = run_session(str(prof), LOGIN_DRY)
        print(json.dumps({"profile": str(prof), "dry": True, "url": r.get("url"),
                          "steps": r.get("steps"), "ok": r.get("ok")}))
        sys.exit(0 if r.get("ok") else 1)
    r = run_session(str(prof), STEPS)
    page = (r.get("reads") or {}).get("page") or ""
    url = r.get("url") or ""
    out = {"profile": str(prof), "url": url, "chars": len(page), "steps_ok": r.get("ok")}
    # ⚠️ MEASURED 2026-10-25: THE URL DOES NOT ANSWER THIS FOR THIS APP. Signed
    # out, the Console renders its login card AT /settings/billing and never
    # redirects -- the landing URL read back identical to the signed-in one. So
    # the body match is the primary signal here and the URL test is kept only
    # for apps that do redirect. I had this the other way round on reasoning,
    # and the first run corrected it.
    if "/login" in url or "/magic-link" in url or SIGNED_OUT.search(page[:4000]):
        out["signed_in"] = False
        print(json.dumps(out))
        if a.json:
            pathlib.Path(a.json).write_text(json.dumps({**out, "result": r}, indent=1))
        sys.exit(3)
    out["signed_in"] = True
    out["grants"] = " | ".join(m.group(0).strip() for m in CREDIT.finditer(page))[:700]
    print(json.dumps(out))
    if a.json:
        pathlib.Path(a.json).write_text(json.dumps({**out, "result": r}, indent=1))
    sys.exit(0 if out["grants"] else 1)


if __name__ == "__main__":
    main()
