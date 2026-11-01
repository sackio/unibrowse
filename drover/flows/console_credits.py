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
import argparse, datetime, json, os, pathlib, re, shutil, subprocess, sys, tempfile, time, urllib.request

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
# ⚠️ "NOT THE LOGIN CARD" IS NOT "SIGNED IN", and reading it that way reported
# a failed login as a success. After a submit the app shows a THIRD page -- "To
# continue, click the link sent to <address>" -- which contains none of the
# login card's phrases, so the first version of this pattern called it signed
# in while the profile had no session at all (measured 2026-10-25; the billing
# read then came back exit 3). Every signed-out state the app has shown us is
# listed here, and the billing read remains the authority.
SIGNED_OUT = re.compile(r"continue with (google|email)|sign in to"
                        r"|click the link sent to|verification code", re.I)
CREDIT = re.compile(r"(credit|grant|balance|expires)[^.]{0,120}", re.I)

# ⚠️ CREDIT ABOVE IS A BLURB, NOT A FIGURE: `[^.]` stops at the decimal point,
# so a $198.72 balance comes back from it as "$198". Fine for a human reading
# the row, useless for deciding anything, and these two exist for the deciding.
# Both measured against the live page 2026-10-25:
#   "Remaining balance Applies to Expires on Date granted $198.72 of $200.00"
#   "Oct 17, 2026 API credit (Max 20x) Expiring Nov 20, 2026 $200.00"
BALANCE = re.compile(r"Remaining balance.{0,200}?\$([\d,]+\.\d{2}) of \$([\d,]+\.\d{2})", re.S)
EXPIRING = re.compile(r"Expiring ([A-Z][a-z]{2} \d{1,2}, \d{4})")
# ⛔ NOT `BROKER`: that name is already taken further down by the reprobe
# guard's /inbound URL, and the later binding wins at import. The alert
# then posts to the wrong path and 404s -- silently, since nothing but the
# alert itself was ever going to notice.
POST_URL = os.environ.get("DROVER_POST_URL", "http://192.168.1.168:3030/messages")


def figures(page):
    """(remaining, granted, soonest expiry) from the billing page, any None if
    the page did not say. ⚠️ The SOONEST expiry, not the last one: the invoice
    history lists expired grants too, and the number that matters is when the
    credit now being spent runs out."""
    m = BALANCE.search(page)
    bal = (float(m.group(1).replace(",", "")), float(m.group(2).replace(",", ""))) if m else (None, None)
    dates = []
    for e in EXPIRING.finditer(page):
        try:
            dates.append(datetime.datetime.strptime(e.group(1), "%b %d, %Y").date())
        except ValueError:
            pass
    return bal[0], bal[1], (min(dates) if dates else None)


def post(to, subject, content):
    body = json.dumps({"from": "unibrowse", "to": to, "kind": "dm",
                       "priority": "info", "subject": subject,
                       "content": content}).encode()
    req = urllib.request.Request(POST_URL, data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status


def watch(state_path, to, page, signed_in, floor, days):
    """Run daily from cron and say NOTHING unless a person has to act.

    ⛔ A daily "balance moved by three cents" is how a cron teaches someone to
    ignore it, so routine movement is recorded and not spoken. Four things are
    worth a message, and each is rate-limited by state rather than by luck:
    · the session died -- but only on the SECOND consecutive run, because one
      bad run is a slow page or a docker hiccup, and a genuinely dead session
      is still dead tomorrow. The cost of waiting a day is nothing; the cost of
      crying wolf is that the real one is ignored.
    · the page stopped yielding a figure, same two-in-a-row rule: that means
      the layout moved, which is a code problem, not a credit problem.
    · the balance crossed below `floor` -- ONCE per crossing, re-armed if it
      goes back above.
    · the grant expires within `days` -- once per expiry date.
    """
    st = {}
    sp = pathlib.Path(state_path).expanduser()
    if sp.exists():
        try:
            st = json.loads(sp.read_text())
        except Exception:
            st = {}
    new = {"at": datetime.datetime.now().isoformat(timespec="seconds"),
           "signed_in": bool(signed_in)}
    say = []

    if not signed_in:
        new["badRuns"] = int(st.get("badRuns") or 0) + 1
        if new["badRuns"] == 2:
            say.append("Console profile agents2 has no session — two runs in a row. "
                       "The balance read is blind until it is logged in again: "
                       "console_credits.py --login --submit")
    else:
        rem, granted, exp = figures(page)
        new.update({"remaining": rem, "granted": granted,
                    "expires": exp.isoformat() if exp else None})
        if rem is None:
            new["badRuns"] = int(st.get("badRuns") or 0) + 1
            if new["badRuns"] == 2:
                say.append("Console billing page no longer yields a balance — two runs "
                           "in a row. The page layout moved; the read needs fixing.")
        else:
            new["badRuns"] = 0
            if rem < floor:
                if not st.get("warnedFloor"):
                    say.append("Console credit for agents2 is down to $%.2f of $%.2f."
                               % (rem, granted or 0))
                new["warnedFloor"] = True
            if exp:
                left = (exp - datetime.date.today()).days
                new["daysLeft"] = left
                if left <= days and st.get("warnedExpiry") != exp.isoformat():
                    say.append("Console credit for agents2 expires %s — %d days. "
                               "$%.2f of $%.2f unspent."
                               % (exp.isoformat(), left, rem, granted or 0))
                    new["warnedExpiry"] = exp.isoformat()
                elif st.get("warnedExpiry") == exp.isoformat():
                    new["warnedExpiry"] = st["warnedExpiry"]
    # ⛔ State is written whether or not anything was said, and BEFORE the post:
    # a broker that is down must not cause the same alert to fire again tomorrow
    # as though it were new.
    sp.parent.mkdir(parents=True, exist_ok=True)
    sp.write_text(json.dumps(new, indent=1))
    if say and to:
        try:
            post(to, "Claude Console credit", "\n".join(say))
        except Exception as e:
            print(json.dumps({"watch": "post-failed", "error": str(e)[:160]}))
    return new, say



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
    {"do": "type", "env": "DROVER_LOGIN_EMAIL", "sel": "input[type=email]"},
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
        {"do": "type", "env": "DROVER_LOGIN_EMAIL", "sel": "input[type=email]"},
        {"do": "expect", "sel": "input[type=email]", "env_value": "DROVER_LOGIN_EMAIL"},
        {"do": "expect", "sel": "button", "text": "continue with email"},
        {"do": "click", "sel": "button", "text": "continue with email"},
        # ⚠️ NOW MEASURED, so it is asserted. The first live submit read the
        # page 8s after the press and found the login card UNCHANGED -- the
        # transition is slower than that, and the steps that followed ran on a
        # page that was still moving. This wording is what the app actually
        # shows (2026-10-25): "To continue, click the link sent to <address>".
        {"do": "expect", "sel": "body", "contains": True,
         "value": "click the link sent to", "seconds": 90},
        {"do": "read", "sel": "body", "as": "posted"},
        {"do": "shot", "path": "/out/after-submit.png"},
        # The same page offers the cross-device path in its own words: "If the
        # link shows a verification code instead of signing you in, enter it
        # here", with a "Verify email address" button. The email field is gone
        # by now, so a bare `input` is the code box -- and the override window
        # is there for the run where it is not.
        # ⚠️ The code box is not in the DOM the moment the page says "link
        # sent": measured 2026-10-25, this eval reported FOUR buttons and ZERO
        # inputs, so choose_field could not decide and the default carried the
        # run. A few seconds later the input existed (the waitfor below matched
        # at 0.0s). The wait is here so the orchestrator gets real data.
        {"do": "wait", "seconds": 6},
        {"do": "eval", "as": "controls",
         "js": "JSON.stringify([...document.querySelectorAll('input,button')].map("
               "e=>[e.tagName,e.type||null,e.getAttribute('inputmode'),"
               "e.getAttribute('maxlength'),e.getAttribute('aria-label'),"
               "(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40)]))",
         "write": "/share/controls.json"},
        {"do": "await", "path": "/share/field.txt", "as": "field",
         "seconds": 90, "default": "input[inputmode=numeric], input[maxlength='6'], input"},
        {"do": "waitfor", "sel": {"from": "field"}, "seconds": 60, "still": True},
        {"do": "click", "sel": {"from": "field"}},
        # ⚠️ The code is a single-use credential. `from` forces the sensitive
        # typing path, only its length is logged, and the file it arrived in is
        # deleted by the orchestrator in a finally.
        {"do": "await", "path": "/share/code.txt", "as": "code", "seconds": 600},
        {"do": "type", "from": "code"},
        # The check that caught a truncated email address, applied where it
        # matters more: a mistyped digit burns the link and the attempt.
        {"do": "expect", "sel": {"from": "field"}, "from_value": "code", "seconds": 15},
        # ⛔ THE CODE WAS NEVER SUBMITTED on the first live run: six digits were
        # typed and nothing pressed the button, so every step said ok and the
        # profile ended with no session. Typing is not submitting.
        {"do": "expect", "sel": "button", "text": "verify email"},
        {"do": "click", "sel": "button", "text": "verify email"},
        {"do": "wait", "seconds": 10},
        {"do": "read", "sel": "body", "as": "after"},
        {"do": "shot", "path": "/out/after-code.png"},
        # ⭐ THE ASSERTION THAT MATTERS: an authenticated page, not the absence
        # of login words. A regex over the login flow's own page said "signed
        # in" when the profile had no session.
        {"do": "nav", "url": BILLING},
        {"do": "wait", "seconds": 8},
        {"do": "read", "sel": "body", "as": "billing"},
        {"do": "shot", "path": "/out/billing.png"},
    ]


# The generic machinery -- containers, mounts, the magic-link orchestration --
# lives in _drover.py so the claude.ai lane uses the same code rather than a
# second copy of it.
from _drover import (IMAGE, MAGICLINK, choose_field, fetch_code,  # noqa: E402
                     orchestrate_login, proc_output, result_of, rundir, run_session)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True,
                    help="a directory kept across runs; one account, one profile")
    ap.add_argument("--json", help="write the full result here")
    ap.add_argument("--login", action="store_true",
                    help="drive the login page; stops before the submit unless --submit")
    ap.add_argument("--submit", action="store_true",
                    help="⛔ sends a REAL single-use magic link to the mailbox")
    ap.add_argument("--watch", action="store_true",
                    help="cron mode: record the reading and speak only when it matters")
    ap.add_argument("--state", default="~/.local/state/drover/console-credits.json",
                    help="⚠️ host-local: the cron runs on one host, so does its memory")
    ap.add_argument("--notify", default="slack:U0NGEHS2J")
    ap.add_argument("--floor", type=float, default=25.0)
    ap.add_argument("--days", type=int, default=14)
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
            r, redeem = orchestrate_login(prof, os.environ["DROVER_LOGIN_EMAIL"],
                                          login_steps(), kind="console",
                                          guard=reprobe_blocking)
            # The billing page is the authority; `after` only says what the
            # login flow claimed.
            page = (r.get("reads") or {}).get("billing") or ""
            signed = bool(page) and not SIGNED_OUT.search(page[:4000])
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
        if a.watch:
            out["watch"], out["said"] = watch(a.state, a.notify, page, False, a.floor, a.days)
        print(json.dumps(out))
        if a.json:
            pathlib.Path(a.json).write_text(json.dumps({**out, "result": r}, indent=1))
        sys.exit(3)
    out["signed_in"] = True
    out["grants"] = " | ".join(m.group(0).strip() for m in CREDIT.finditer(page))[:700]
    if a.watch:
        out["watch"], out["said"] = watch(a.state, a.notify, page, True, a.floor, a.days)
    print(json.dumps(out))
    if a.json:
        pathlib.Path(a.json).write_text(json.dumps({**out, "result": r}, indent=1))
    sys.exit(0 if out["grants"] else 1)


if __name__ == "__main__":
    main()
