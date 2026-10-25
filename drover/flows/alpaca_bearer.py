#!/usr/bin/env python3
"""Sign in to the Alpaca dashboard through Drover and report WHERE the bearer is.

⭐ WHAT THIS IS FOR, and what it deliberately does not do yet. The `alpaca`
seat's tools/alpaca-signup drives app.alpaca.markets through the unibrowse
extension and takes the bearer from the REQUEST HEADERS of the dashboard's own
/api/v1/paper_accounts call, reloading the page after attaching to catch it.
They asked (2026-10-25) whether the token is also in page storage, because they
have never looked -- and if it is, Drover can read it from an isolated world
and needs no network interception at all, which is both simpler and does not
break when the endpoint moves.

So this run is a MEASUREMENT, not the port: log in, then report the storage
KEY NAMES, their lengths, and whether each value is shaped like a JWT.
⛔ NO VALUE IS EVER PRINTED, written or logged. A bearer is a credential, and
"it is only a test" is how one ends up in a log file someone greps later.

⛔ READ-ONLY. No admin macro, nothing created, nothing deleted. The profile is
disposable and destroyed on the way out, which is also what `alpaca` asked for
("clear the session afterwards").

⚠️ THEIR WINDOWS, NOT MINE: `alpaca` runs signups at 10:15/14:15/18:15 ET and
asked that nothing else touch this login during 10:00-10:45, 14:00-14:45 and
18:00-18:45 ET. This script refuses inside those windows rather than trusting
whoever runs it to remember.

  ALPACA_LOGIN_EMAIL=agents239@sack.io alpaca_bearer.py --json out.json

Exit 0 = signed in and storage reported · 2 = inside a blackout window ·
3 = the login did not complete (the step log says where) · 1 = other.
"""
import argparse, datetime, json, os, pathlib, shutil, subprocess, sys, tempfile

IMAGE = os.environ.get("DROVER_IMAGE", "192.168.1.168:32000/drover/worker:2026-10-25u")
LOGIN = "https://app.alpaca.markets/account/login"
# ⛔ The dashboard password is a DIFFERENT credential from the trading API keys
# and lives only here, mode 600. It is forwarded to the container BY NAME
# (`-e NAME`), never as a value on the command line, because `ps` is readable
# by every user on the box.
SECRETS = "/mnt/nas/data/code/forks/alpaca-mcp-server/.secrets/LOGINS.conf"
PASSWORD_KEY = "ALPACA_DASHBOARD_PASSWORD"

# `alpaca`, 2026-10-25: "Any time is fine except 10:00-10:45, 14:00-14:45 and
# 18:00-18:45 ET." Their signup lane uses the same Cognito login, and a
# collision costs them a real signup, not a retry.
BLACKOUTS = [(10, 0, 10, 45), (14, 0, 14, 45), (18, 0, 18, 45)]

# ⚠️ MEASURED 2026-10-25, and it is not what the obvious guess says. This page
# has NO "Sign in" text anywhere. Its controls are: a BUTTON labelled "Accept"
# (aria-label "Accept cookies"), input[type=email], input[type=password], a
# TEXTLESS input[type=submit], and a BUTTON reading "Continue". My first run
# asserted a button matching /sign in/i and correctly found nothing -- which is
# why the assertion is there rather than a blind click.
STEPS = [
    {"do": "nav", "url": LOGIN},
    # Cold profile on a heavy SPA: poll for the field, and wait for it to stop
    # moving. A click placed the instant a control exists lands next to it --
    # measured on platform.claude.com, where the box moved for 4-11s after
    # appearing.
    {"do": "waitfor", "sel": "input[type=email]", "seconds": 120, "still": True},
    # The consent banner is always present on a disposable profile and never on
    # a kept one, and it can overlay the form -- so it is dismissed, and the
    # step is `optional` because its absence is not a failure.
    {"do": "click", "sel": "button", "text": "accept", "optional": True},
    {"do": "click", "sel": "input[type=email]"},
    {"do": "type", "env": "ALPACA_LOGIN_EMAIL"},
    {"do": "expect", "sel": "input[type=email]", "env_value": "ALPACA_LOGIN_EMAIL"},
    {"do": "waitfor", "sel": "input[type=password]", "seconds": 60, "still": True},
    {"do": "click", "sel": "input[type=password]"},
    {"do": "type", "env": PASSWORD_KEY},
    # ⛔ `sensitive` masks the readback. The check is worth making -- a silently
    # truncated field is exactly the fault that cost the Console lane three
    # days -- but the row must carry a length, not a password.
    {"do": "expect", "sel": "input[type=password]", "env_value": PASSWORD_KEY,
     "sensitive": True},
    {"do": "expect", "sel": "button", "text": "continue"},
    {"do": "click", "sel": "button", "text": "continue"},
    # ⛔ NO ASSERTION ON THE POST-LOGIN WORDING. This page has never been
    # measured from here, and a guessed string would halt a run that worked.
    # The storage report below is the evidence; the shot is the record.
    {"do": "wait", "seconds": 12},
    {"do": "eval", "as": "where", "js": "JSON.stringify({url:location.href,"
     "title:document.title,"
     "frames:[...document.querySelectorAll('iframe')].map(f=>f.src).filter(Boolean).slice(0,8)})"},
    # ⛔ NAMES, LENGTHS AND SHAPE ONLY. `jwt` means the value starts with the
    # base64 of '{"alg' -- enough to say "a token lives here" without ever
    # moving the token.
    {"do": "eval", "as": "storage", "js":
     "JSON.stringify(['localStorage','sessionStorage'].map(which=>{"
     "const s=window[which];const out=[];"
     "try{for(let i=0;i<s.length;i++){const k=s.key(i),v=s.getItem(k)||'';"
     "out.push([which,k,v.length,v.slice(0,3)==='eyJ'])}}catch(e){out.push([which,'ERR',0,false])}"
     "return out}).flat())"},
    {"do": "shot", "path": "/out/after-login.png"},
    {"do": "read", "sel": "body", "as": "page"},
]


def blackout(now):
    for h1, m1, h2, m2 in BLACKOUTS:
        if (h1, m1) <= (now.hour, now.minute) < (h2, m2):
            return "%02d:%02d-%02d:%02d ET is the alpaca signup lane's window" % (h1, m1, h2, m2)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="write the full result here")
    # ⛔ The profile must NOT sit inside another bind mount. Measured
    # 2026-10-25: identical command, only the profile path different -- with
    # /prof inside the read-only /steps mount Chrome died at startup and the
    # only symptom was "browser went away" (the same opaque message the
    # missing-seccomp fault produces). Separate directories, always.
    ap.add_argument("--rundir", default="/mnt/nas/data/.secrets/drover-profiles",
                    help="⛔ not /tmp: server4's docker daemon has a private /tmp, "
                         "so a bind mount from there arrives EMPTY with no error")
    a = ap.parse_args()
    if not os.environ.get("ALPACA_LOGIN_EMAIL"):
        raise SystemExit("set ALPACA_LOGIN_EMAIL (alpaca named agents239@sack.io for this test)")
    why = blackout(datetime.datetime.now())
    if why:
        raise SystemExit("refusing: " + why)

    # The password never passes through argv or this process's own output: it
    # is read here only to put it in the child environment by name.
    env = dict(os.environ)
    for line in pathlib.Path(SECRETS).read_text().splitlines():
        if line.startswith(PASSWORD_KEY + "="):
            env[PASSWORD_KEY] = line.split("=", 1)[1].strip()
    if not env.get(PASSWORD_KEY):
        raise SystemExit("%s not found in %s" % (PASSWORD_KEY, SECRETS))

    root = pathlib.Path(a.rundir)
    root.mkdir(parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    # ⛔ Disposable, and destroyed in the finally: alpaca asked for the session
    # to be cleared afterwards, and a profile holding a dashboard session is a
    # credential store either way.
    work = pathlib.Path(tempfile.mkdtemp(prefix="alpaca-bearer-", dir=root))
    prof, out, steps = work / "prof", work / "out", work / "steps"
    for d in (prof, out, steps):
        d.mkdir()
        os.chmod(d, 0o700)
    (steps / "steps.json").write_text(json.dumps(STEPS))
    try:
        cmd = ["docker", "run", "--rm", "--shm-size=512m",
               # ⛔ Without this Chrome dies at startup and the only symptom is
               # "browser went away", which names nothing.
               "--security-opt", "seccomp=unconfined",
               "-e", "DROVER_PROFILE=/prof", "-e", "ALPACA_LOGIN_EMAIL", "-e", PASSWORD_KEY,
               "-v", "%s:/prof" % prof, "-v", "%s:/steps:ro" % steps, "-v", "%s:/out" % out]
        worker = pathlib.Path(__file__).resolve().parent.parent / "worker" / "drover_worker.py"
        if os.environ.get("DROVER_NO_MOUNT") != "1" and worker.is_file():
            cmd += ["-v", "%s:/opt/drover/worker/drover_worker.py:ro" % worker]
        cmd += [IMAGE, "session", "--steps", "/steps/steps.json"]
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=600, env=env)
        line = [l for l in p.stdout.splitlines() if l.startswith("{")]
        if not line:
            raise SystemExit("session produced no result: %s"
                             % (p.stderr.strip()[-400:] or "no stderr"))
        r = json.loads(line[-1])
        reads = r.get("reads") or {}
        # ⛔ OUTSIDE the work dir, which the finally deletes -- the first
        # version copied them to out + "-kept", a path INSIDE work, so the
        # "kept" screenshots were removed with everything else and the field
        # reported a directory that did not exist.
        shots = str(root / ("alpaca-shots-" + work.name.split("-")[-1]))
        shutil.copytree(out, shots, dirs_exist_ok=True)
        res = {"steps": r.get("steps"), "ok": r.get("ok"), "url": r.get("url"),
               "where": reads.get("where"), "storage": reads.get("storage"),
               "shots": shots,
               # The page text is NOT reported: a dashboard body can contain
               # account numbers. Only its size, as evidence it rendered.
               "pageChars": len(reads.get("page") or "")}
        print(json.dumps(res, indent=1))
        if a.json:
            pathlib.Path(a.json).write_text(json.dumps(res, indent=1))
        sys.exit(0 if r.get("ok") else 3)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
