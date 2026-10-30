#!/usr/bin/env python3
"""Do the OAuth Authorize click for claude-login-auto, on a kept Drover profile.

⭐ THE POINT. claude-login-auto (owned by `scripts`) is the fleet's account-swap
gate and STAYS the orchestrator: it mints the OAuth URL, writes the host->account
marker, reads it back over ssh, and confirms by the usage sweep. Its ONE browser
leg is -- given the authorize URL, in a browser signed in to the TARGET claude.ai
account -- verify the account, click Authorize, and return the code#state the
callback shows. That leg is what this moves OFF Ben's office Chrome (the office
extension broke 2026-10-30) and onto a kept Drover profile, one per account.

⛔ THIS DOES NOT EDIT claude-login-auto, and must not. The isActive/marker
contract other seats depend on stays with `scripts`. Division agreed with
`agents` in #unibrowse 2026-10-30: drover returns code#state; claude-login-auto
does everything else. This is a thing that script CALLS.

Two paths, the same shape as console_credits.py / claude_session.py:

  # HOT PATH -- the swap's browser leg. Assumes the kept profile is signed in.
  claude_login.py --account pushbuild --authorize-url "<url>" --code-out <file>

  # RARE -- establish/refresh the kept claude.ai session (magic link by email).
  DROVER_LOGIN_EMAIL=bsack@pushbuild.com \
      claude_login.py --account pushbuild --login --submit

Exit 0 = code#state captured (written to --code-out, mode 600) ·
     3 = the profile is signed OUT (caller must --login first) ·
    11 = the consent page is NOT the expected account -- REFUSED to click ·
     5 = no code#state at the callback (captcha / timeout / changed page) ·
     2 = refused by a guard · 1 = other.

⛔ THE AUTHORIZATION CODE IS A SINGLE-USE CREDENTIAL, like the magic link. It is
written ONLY to --code-out (mode 600) and NEVER printed, logged, or placed in the
--json result. stdout and --json carry status, the exit code, and a masked
length -- never the code or the callback query.
"""
import argparse, json, os, pathlib, shutil, sys, urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drover import orchestrate_login, rundir, run_session  # noqa: E402
import claude_session as cs  # noqa: E402  reuse its steps + EMAIL map, no drift

# The callback the Authorize click lands on. platform.claude.com is the current
# console host; the path is stable across it and console.anthropic.com.
CALLBACK = r"/oauth/code/callback"


def authorize_steps(url, expect_text, authorize_text):
    """Verify the account, click Authorize, capture the callback URL.

    ⛔ THE `expect` IS A GATE, NOT A NOTE. It HALTS the run on failure (the step
    loop breaks), so a page that is not the expected account never reaches the
    click below -- the expectedAccount safety the office macro carried, kept
    here. The code before it (read + the email scrape) is so that a wrong
    --expect-text comes back as a tuning fact, not an unexplained refusal.
    """
    return [
        {"do": "nav", "url": url},
        # claude.ai/platform render nothing for up to ~60s on a cold profile.
        {"do": "waitfor", "sel": "body", "seconds": 90},
        {"do": "wait", "seconds": 4},
        {"do": "read", "sel": "body", "as": "consent"},
        # The account(s) the consent page actually names -- the fact that tunes
        # --expect-text. textContent, never innerText (innerText reads 0 here).
        {"do": "eval", "as": "whoami", "js":
         "JSON.stringify((document.body.textContent.match("
         "/[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}/gi)||[]).slice(0,8))"},
        {"do": "expect", "sel": "body", "contains": True, "value": expect_text,
         "seconds": 10},
        {"do": "waitfor", "sel": "button", "text": authorize_text, "seconds": 25,
         "still": True},
        {"do": "click", "sel": "button", "text": authorize_text},
        # The callback lands ~90s later; its query carries the code -> 600 file,
        # never the log.
        {"do": "waiturl", "match": CALLBACK, "seconds": 150,
         "write": "/share/callback.url"},
        # ⛔ Do NOT leave the callback as the final URL: the worker reports
        # location.href as the result's `url`, which would put the code there.
        {"do": "nav", "url": cs.HOME},
        {"do": "wait", "seconds": 2},
    ]


def classify_failure(reads, steps):
    """Why the gate halted, as an exit code. Signed-out and wrong-account are
    different faults with different fixes, and must not read the same."""
    page = (reads or {}).get("consent") or ""
    if cs.SIGNED_OUT.search(page[:6000]):
        return 3, "profile signed out (authorize URL bounced to login)"
    # The gate (an `expect` step) failed without the page looking signed out:
    # the expected account marker was not on the consent page.
    for s in (steps or []):
        if s.get("do") == "expect" and s.get("status") == "failed":
            return 11, "consent page did not contain the expected account marker"
    # Clicked, but the callback never arrived.
    return 5, "no callback reached after Authorize (captcha / timeout / changed page)"


def parse_code_state(url):
    """code#state from the callback URL, the format claude-login-auto pastes.
    Query params, not a fragment -- so no fragment-stripping trap here."""
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    code = (q.get("code") or [None])[0]
    state = (q.get("state") or [None])[0]
    if not code or not state:
        return None
    return "%s#%s" % (code, state)


def do_authorize(prof, a):
    expect_text = a.expect_text or cs.EMAIL.get(a.account) or ""
    if not expect_text:
        raise SystemExit("no --expect-text and no email known for %s; refusing to "
                         "click Authorize without an account check" % a.account)
    share = pathlib.Path(rundir(prof), "share")
    share.mkdir(parents=True, exist_ok=True)
    os.chmod(share, 0o700)
    cbfile = share / "callback.url"
    try:
        r = run_session(str(prof),
                        authorize_steps(a.authorize_url, expect_text, a.authorize_text),
                        share=str(share), timeout=300)
        reads, steps = r.get("reads") or {}, r.get("steps") or []
        whoami = reads.get("whoami")
        code_state = parse_code_state(cbfile.read_text()) if cbfile.exists() else None
        out = {"account": a.account, "ok": r.get("ok"), "whoami": whoami,
               "steps": steps}
        if code_state:
            dest = pathlib.Path(a.code_out).expanduser()
            dest.touch(mode=0o600, exist_ok=True)
            os.chmod(dest, 0o600)
            dest.write_text(code_state)
            out.update({"authorized": True, "wrote": str(dest),
                        "codeStateChars": len(code_state)})
            print(json.dumps(out))
            if a.json:
                pathlib.Path(a.json).write_text(json.dumps(out, indent=1))
            return 0
        rc, why = classify_failure(reads, steps)
        out.update({"authorized": False, "exit": rc, "why": why})
        print(json.dumps(out))
        if a.json:
            pathlib.Path(a.json).write_text(json.dumps(out, indent=1))
        return rc
    finally:
        # The callback URL holds the single-use code: it does not outlive the call.
        shutil.rmtree(share, ignore_errors=True)


def do_login(prof, a):
    email = a.email or os.environ.get("DROVER_LOGIN_EMAIL")
    if not email:
        raise SystemExit("--login needs --email or DROVER_LOGIN_EMAIL "
                         "(never on the command line: ps is world-readable)")
    os.environ["DROVER_LOGIN_EMAIL"] = email
    # ⛔ DON'T SPEND A LOGIN ATTEMPT ON A SESSION THAT WORKS. These accounts
    # rate-limit the login itself; check the kept profile first and refuse if it
    # is already signed in, unless --force. This is the OAuth-session analogue of
    # claude_session's auth_failing guard -- but keyed on the profile, not the
    # usage sweep, because this session is for Authorize, not the usage cookie.
    rshare = pathlib.Path(rundir(prof), "readshare")
    rshare.mkdir(parents=True, exist_ok=True)
    os.chmod(rshare, 0o700)
    try:
        rr = run_session(str(prof), cs.read_steps("/share"), share=str(rshare))
        ck = rshare / "sessionKey"
        signed = ck.exists() and len(ck.read_text()) > 0 and "/login" not in (rr.get("url") or "")
    finally:
        shutil.rmtree(rshare, ignore_errors=True)
    if signed and not a.force:
        print(json.dumps({"account": a.account, "alreadySignedIn": True}))
        return 0
    if not a.submit:
        r = run_session(str(prof), cs.login_dry())
        print(json.dumps({"account": a.account, "dry": True, "ok": r.get("ok"),
                          "controls": (r.get("reads") or {}).get("controls")}))
        return 0 if r.get("ok") else 1
    # No usage-sweep guard here: establishing the OAuth session is the goal, and
    # the refusal above already prevents spending an attempt on a live session.
    r, redeem = orchestrate_login(prof, email, cs.login_steps("/share"), kind="ai")
    vshare = pathlib.Path(rundir(prof), "verifyshare")
    vshare.mkdir(parents=True, exist_ok=True)
    os.chmod(vshare, 0o700)
    try:
        vr = run_session(str(prof), cs.read_steps("/share"), share=str(vshare))
        vck = vshare / "sessionKey"
        now_signed = vck.exists() and len(vck.read_text()) > 0 and "/login" not in (vr.get("url") or "")
    finally:
        shutil.rmtree(vshare, ignore_errors=True)
    print(json.dumps({"account": a.account, "submitted": True, "ok": r.get("ok"),
                      "signed_in": now_signed, "redeemChars": len(redeem)}))
    return 0 if now_signed else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", required=True, help="the name the usage sweep uses")
    ap.add_argument("--profile", help="override the kept profile dir "
                    "(default: <PROFILES>/claudeai-<account>)")
    ap.add_argument("--authorize-url", help="hot path: the OAuth URL to authorize")
    ap.add_argument("--code-out", help="hot path: write code#state here, mode 600")
    ap.add_argument("--expect-text", help="account marker the consent page must "
                    "contain before Authorize is clicked (default: the account email)")
    ap.add_argument("--authorize-text", default="authorize",
                    help="visible text of the Authorize button (case-insensitive)")
    ap.add_argument("--login", action="store_true", help="establish/refresh the session")
    ap.add_argument("--submit", action="store_true",
                    help="⛔ --login: send a REAL single-use magic link")
    ap.add_argument("--force", action="store_true",
                    help="--login: re-login even if the profile is already signed in")
    ap.add_argument("--email", help="--login: defaults to DROVER_LOGIN_EMAIL")
    ap.add_argument("--json", help="write the full (credential-free) result here")
    a = ap.parse_args()

    prof = pathlib.Path(a.profile) if a.profile else pathlib.Path(cs.PROFILES, "claudeai-" + a.account)
    prof.mkdir(parents=True, exist_ok=True)
    os.chmod(prof, 0o700)

    if a.login:
        sys.exit(do_login(prof, a))
    if a.authorize_url:
        if not a.code_out:
            raise SystemExit("--authorize-url needs --code-out (the code is written "
                             "to a 600 file, never printed)")
        sys.exit(do_authorize(prof, a))
    raise SystemExit("nothing to do: pass --authorize-url (+ --code-out) or --login")


if __name__ == "__main__":
    main()
