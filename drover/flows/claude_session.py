#!/usr/bin/env python3
"""Keep a claude.ai session in a Drover profile, and hand its cookie over.

⭐ WHAT THIS REPLACES, AND WHAT IT DOES NOT. `claude-usage`'s sweep is a
zero-LLM JSON API call authenticated by a `sessionKey` cookie
(~/.claude/state/claude-usage-cron/<account>.cookie). Its ONLY browser step is
`claude-login-auto --mint-cookie <account>`, which performs a whole magic-link
login to produce one. With a kept profile that becomes a READ: the session
lives in the profile, the cookie is exported from it, and a login happens once
rather than per re-mint.

⛔ THIS DOES NOT TOUCH claude-login-auto, AND IT MUST NOT. That script is the
fleet's account-swap path -- other seats read its `isActive` contract -- and
Ben put it LAST in the porting order for exactly that reason. This flow is
additive: something `claude-login-auto` could call, not a replacement for it.
⛔ The cookie file is written ONLY with --cookie-out, so no run changes what the
sweep reads by accident. Without it you get a length and an expiry.

⛔ AND IT WILL NOT MINT A SESSION THAT ALREADY WORKS. The skill's own rule, and
it is a good one: "Do not open a browser because a number looks surprising.
Open one only when the API says that account cannot authenticate." So --submit
consults the sweep's own output and refuses unless that account is actually
failing auth. It FAILS CLOSED: a missing or stale sweep file is a refusal, not
a licence, because "I could not check" is not "it is broken".

  claude_session.py --account agents2                      # read: signed in? cookie?
  claude_session.py --account agents2 --login              # dry: fill, assert, stop
  claude_session.py --account agents2 --login --submit     # only if auth is failing
  claude_session.py --account agents2 --cookie-out ~/.claude/state/.../agents2.cookie

Exit 0 = session present (and cookie exported if asked) · 3 = not signed in ·
2 = refused by a guard · 1 = other.
⚠️ The sweep runs on server4, so the cookie file it reads is host-local THERE.
Run the export on the host that owns the file.
"""
import argparse, json, os, pathlib, re, shutil, sys, time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drover import orchestrate_login, rundir, run_session  # noqa: E402

HOME = "https://claude.ai/new"
LOGIN = "https://claude.ai/login"
USAGE_JSON = "/tmp/claude-usage-latest.json"
PROFILES = "/mnt/nas/data/.secrets/drover-profiles"

# ⚠️ claude.ai renders NOTHING for a long time on a cold profile: readyState
# stays "interactive" with an empty body for up to ~60s (measured 2026-10-22).
# Poll for a control, never sleep for a guess.
SIGNED_OUT = re.compile(r"continue with (google|email)|click the link sent to"
                        r"|verification code|sign in to", re.I)


def read_steps(share):
    """Is this profile signed in, and what is the session cookie worth?

    ⛔ The cookie VALUE never passes through a step row or this process's
    output: the worker writes it straight to a file created 0600, and the row
    carries the name, length and expiry. A profile's cookie store is a
    credential store.
    """
    return [
        {"do": "nav", "url": HOME},
        {"do": "waitfor", "sel": "body", "seconds": 90},
        {"do": "wait", "seconds": 8},
        {"do": "read", "sel": "body", "as": "page"},
        {"do": "cookie", "name": "sessionKey", "domain": "claude.ai",
         "write": "%s/sessionKey" % share, "optional": True},
    ]


def login_dry():
    """Everything before the submit. Free, repeatable, and it proves the page
    rather than assuming it: the Console lane's equivalent is what caught a
    truncated address that had been read as a site refusal for three days."""
    return [
        {"do": "nav", "url": LOGIN},
        {"do": "waitfor", "sel": "input[type=email]", "seconds": 120, "still": True},
        {"do": "click", "sel": "input[type=email]"},
        {"do": "type", "env": "DROVER_LOGIN_EMAIL"},
        {"do": "expect", "sel": "input[type=email]", "env_value": "DROVER_LOGIN_EMAIL"},
        {"do": "expect", "sel": "button", "text": "continue with email"},
        {"do": "eval", "as": "controls", "js":
         "JSON.stringify([...document.querySelectorAll('button,input')].map("
         "e=>[e.tagName,e.type||null,(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,28)]))"},
    ]


def login_steps(share):
    """The submit path. Shape measured on platform.claude.com, which is the
    same app family; ⚠️ claude.ai's own wording after the submit has NOT been
    measured from here, so nothing asserts it -- the mailbox is the proof the
    POST happened, and a guessed string would halt a run that worked after the
    link was already spent."""
    return login_dry()[:6] + [
        {"do": "click", "sel": "button", "text": "continue with email"},
        {"do": "wait", "seconds": 10},
        {"do": "read", "sel": "body", "as": "posted"},
        {"do": "shot", "path": "/out/after-submit.png"},
        {"do": "wait", "seconds": 6},
        {"do": "eval", "as": "controls", "write": "/share/controls.json", "js":
         "JSON.stringify([...document.querySelectorAll('input,button')].map("
         "e=>[e.tagName,e.type||null,e.getAttribute('inputmode'),e.getAttribute('maxlength'),"
         "e.getAttribute('aria-label'),(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40)]))"},
        {"do": "await", "path": "/share/field.txt", "as": "field", "seconds": 90,
         "default": "input[inputmode=numeric], input[maxlength='6'], input"},
        {"do": "waitfor", "sel": {"from": "field"}, "seconds": 60, "still": True},
        {"do": "click", "sel": {"from": "field"}},
        {"do": "await", "path": "/share/code.txt", "as": "code", "seconds": 600},
        {"do": "type", "from": "code"},
        {"do": "expect", "sel": {"from": "field"}, "from_value": "code", "seconds": 15},
        # ⛔ Typing is not submitting. The Console lane reported a fully green
        # run with no session because nothing pressed the button.
        {"do": "click", "sel": "button", "text": "verify|continue|sign in", "optional": True},
        {"do": "wait", "seconds": 10},
        {"do": "nav", "url": HOME},
        {"do": "wait", "seconds": 10},
        {"do": "read", "sel": "body", "as": "after"},
        {"do": "cookie", "name": "sessionKey", "domain": "claude.ai",
         "write": "%s/sessionKey" % share},
    ]


def auth_failing(account, usage_json=USAGE_JSON, max_age=7200):
    """None if this account is genuinely failing auth; otherwise the reason not
    to mint. Reads the sweep's own output -- the signal the skill says to use."""
    f = pathlib.Path(usage_json)
    if not f.exists():
        return "%s is missing, so I cannot tell whether %s needs a cookie" % (usage_json, account)
    age = time.time() - f.stat().st_mtime
    if age > max_age:
        return "%s is %.1fh stale; re-run the sweep before minting" % (usage_json, age / 3600)
    try:
        d = json.loads(f.read_text())
    except Exception as e:
        return "%s unreadable: %s" % (usage_json, e)
    for a in d.get("accounts") or []:
        if a.get("account") == account:
            if a.get("ok") and not a.get("needs_reauth"):
                return ("%s authenticates right now (weekly %s%%) -- a mint would spend a "
                        "login attempt to replace a working cookie"
                        % (account, a.get("weekly_all_pct")))
            return None
    return "%s is not in %s" % (account, usage_json)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", required=True, help="the name the usage sweep uses")
    ap.add_argument("--email", help="only needed for --login; defaults to DROVER_LOGIN_EMAIL")
    ap.add_argument("--login", action="store_true", help="drive the login page")
    ap.add_argument("--submit", action="store_true",
                    help="⛔ sends a REAL single-use link; refused unless auth is failing")
    ap.add_argument("--cookie-out", help="write the sessionKey here, mode 600")
    ap.add_argument("--usage-json", default=USAGE_JSON)
    ap.add_argument("--json", help="write the full result here")
    a = ap.parse_args()

    prof = pathlib.Path(PROFILES, "claudeai-" + a.account)
    prof.mkdir(parents=True, exist_ok=True)
    os.chmod(prof, 0o700)
    email = a.email or os.environ.get("DROVER_LOGIN_EMAIL")

    if a.login:
        if not email:
            raise SystemExit("--login needs --email or DROVER_LOGIN_EMAIL "
                             "(never on the command line: ps is world-readable)")
        os.environ["DROVER_LOGIN_EMAIL"] = email
        if a.submit:
            why = auth_failing(a.account, a.usage_json)
            if why:
                print(json.dumps({"account": a.account, "refused": why}))
                sys.exit(2)
            share = pathlib.Path(rundir(prof))
            r, redeem = orchestrate_login(prof, email, login_steps("/share"), kind="ai")
            page = (r.get("reads") or {}).get("after") or ""
            signed = bool(page) and not SIGNED_OUT.search(page[:4000])
            print(json.dumps({"account": a.account, "submitted": True,
                              "steps": r.get("steps"), "ok": r.get("ok"),
                              "signed_in": signed, "redeemChars": len(redeem)}))
            sys.exit(0 if signed else 1)
        r = run_session(str(prof), login_dry())
        print(json.dumps({"account": a.account, "dry": True, "steps": r.get("steps"),
                          "controls": (r.get("reads") or {}).get("controls"),
                          "ok": r.get("ok")}))
        sys.exit(0 if r.get("ok") else 1)

    # The read path: no login, no attempt spent.
    share = pathlib.Path(rundir(prof), "share")
    share.mkdir(parents=True, exist_ok=True)
    os.chmod(share, 0o700)
    try:
        r = run_session(str(prof), read_steps("/share"), share=str(share))
        page = (r.get("reads") or {}).get("page") or ""
        signed = bool(page) and not SIGNED_OUT.search(page[:4000])
        cookie = share / "sessionKey"
        out = {"account": a.account, "profile": str(prof), "url": r.get("url"),
               "chars": len(page), "signed_in": signed,
               "cookieChars": len(cookie.read_text()) if cookie.exists() else 0,
               "steps": r.get("steps")}
        if a.cookie_out and cookie.exists() and signed:
            dest = pathlib.Path(a.cookie_out).expanduser()
            # ⛔ Mode before content, and keep the one it replaces: a cookie
            # written for the WRONG ACCOUNT is the known expensive failure here
            # (2026-08-11: a ben cookie landed in agents.cookie and the sweep
            # reported ben's quota as agents' for a day). Keeping .prev is what
            # makes that recoverable.
            if dest.exists():
                shutil.copy2(dest, str(dest) + ".prev")
            dest.touch(mode=0o600, exist_ok=True)
            os.chmod(dest, 0o600)
            dest.write_text(cookie.read_text())
            out["wrote"] = str(dest)
            # ⚠️ I cannot verify WHICH account this cookie belongs to from
            # here. claude-login-auto checks that before writing, and this flow
            # deliberately does not pretend to: the account name comes from the
            # profile it was read out of, which is only as right as the profile.
            out["identityChecked"] = False
        print(json.dumps(out))
        if a.json:
            pathlib.Path(a.json).write_text(json.dumps({**out, "result": r}, indent=1))
        sys.exit(0 if signed else 3)
    finally:
        # ⛔ The exported cookie does not linger in the run directory.
        shutil.rmtree(share, ignore_errors=True)


if __name__ == "__main__":
    main()
