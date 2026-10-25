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
import argparse, json, os, pathlib, re, subprocess, sys, tempfile

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
    {"do": "waitfor", "sel": "input[type=email]", "seconds": 90},
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


def run_session(profile, steps, timeout=420):
    with tempfile.TemporaryDirectory() as td:
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
        worker = pathlib.Path(__file__).resolve().parent.parent / "worker" / "drover_worker.py"
        if os.environ.get("DROVER_NO_MOUNT") != "1" and worker.is_file():
            cmd += ["-v", f"{worker}:/opt/drover/worker/drover_worker.py:ro"]
        cmd += [IMAGE, "session", "--steps", "/steps/steps.json"]
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
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
            raise SystemExit("--submit is not implemented yet: redeeming the link needs a "
                             "second tab in this browser, which job_session does not drive. "
                             "Refusing rather than sending a link nothing can redeem.")
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
