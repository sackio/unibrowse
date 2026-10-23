#!/usr/bin/env python3
"""
Hook — when a seat runs into a captcha, tell it that the operator can SOLVE it
from his phone, and hand back the exact call.

WHY THIS EXISTS. Ben, Slack #unibrowse 2026-10-14 14:17 EDT, verbatim: *"a lot of
Agents have said that they don't know that they can send me the captcha which I
want to make more clear can you update memo and any skills or whatever like maybe
something that gets triggered whenever the word captcha get said and get it
installed on all four hosts"*.

⭐ THE FAILURE THIS FIXES IS A DISCOVERY FAILURE, NOT A CAPABILITY ONE. The relay
has been live on :9010 since 2026-09-12 and memo 1a93f00c documents it in detail —
but that memo is `injection_mode: on-recall`, and a seat that does not know the
capability exists never casts the query that would find it. So it reports the
captcha as a hard block, which is the exact outcome the relay was built to remove.
⇒ The trigger has to fire on the SITUATION, not on the seat remembering to ask.

⛔ THIS NEVER BLOCKS AND NEVER TOUCHES PERMISSIONS. Same shape as this fleet's
other advisory hook (atc/scripts/atc-timer-advisory.py): `systemMessage` plus
`hookSpecificOutput.additionalContext`, no `permissionDecision`. Advice and
authorisation are different powers and this hook only ever wanted the first. Any
exception is swallowed and we exit 0 — a browser call must never fail because a
paragraph could not be printed.

⭐ IT FIRES ON TOOL RESULTS, WHICH IS WHERE A CAPTCHA ACTUALLY APPEARS. A seat
rarely types "captcha"; it reads page text that says "Please verify you are a
human", or a Turnstile/reCAPTCHA field name, out of browser_evaluate or
browser_get_visible_text. PostToolUse is therefore the load-bearing event here,
not PreToolUse. Measured 2026-10-14 on printify.com/app/auth/register: the only
human-readable signal was "Please verify you are a human" in the page body and an
`input[name=cf-turnstile-response]` in the DOM — neither would have been caught by
watching what the agent wrote.

⚠️ NOISE IS BOUNDED BY DEDUPE. One injection per session (re-armed after
RE_ARM_SECONDS), keyed on session_id, in a marker file. An advisory that repeats
every tool call trains the model to skip it, which is worse than silence.

⛔ IT STAYS QUIET WHEN THE SEAT IS ALREADY USING THE RELAY. If the tool being
called IS browser_request_captcha_solve / _check_ / _cancel_, the seat plainly
knows; telling it again is pure cost.

⚠️ WHAT THIS HOOK DOES NOT CLAIM. It does not assert a captcha is present — only
that captcha-shaped words went past. A reCAPTCHA v3 score has nothing a human can
solve (memo 1a93f00c), so the advisory says "if there is something to press",
rather than promising the relay always applies.
"""

import json
import os
import re
import sys
import time

RE_ARM_SECONDS = 7200
MARKER_DIR = "/tmp/claude-captcha-advisory"

# Deliberately narrow. "captcha" alone would miss every real-world encounter
# measured so far, and a bare "verify" would fire on every login page.
TRIGGER = re.compile(
    r"captcha"
    r"|turnstile"
    r"|recaptcha"
    r"|hcaptcha"
    r"|cf-chl-widget"
    r"|px-captcha"
    r"|perimeterx"
    r"|verify (?:that )?you(?:'re| are) (?:a )?human"
    r"|are you a human"
    r"|i'm not a robot"
    r"|unusual traffic from your computer",
    re.I,
)

# Tools that ARE the relay. Seeing these means the seat already knows.
ALREADY_KNOWS = re.compile(r"captcha_solve", re.I)

ADVICE = """⭐ CAPTCHA SEEN? SOLVE IT YOURSELF FIRST — the phone relay is the fallback, not the default.

⛔ BEN, #unibrowse 2026-10-23, verbatim: *"we really need it to not be in the browser that it gets
solved it needs to be mouse and keyboard automation that's made to look realistic"* and *"they
should try to solve as much as they can"*. He also records the legal basis: these are accessibility
tools under his control, used on a limited basis, acting on his behalf.
⇒ A checkbox you can see is YOURS to click. Only what renders nothing goes to him.

⭐ HOW — OS-LEVEL INPUT, NOT CDP. `scripts/realinput.py` in the unibrowse repo drives the X server
with XTEST, so the page sees `isTrusted: true` hardware events with a real cursor path, press dwell
and key timing. CDP clicks (browser_click / browser_realistic_click) are dispatched INTO the page
and are what the harder widgets look for.
    python3 /mnt/nas/data/code/unibrowse/scripts/realinput.py click --display :NN --x X --y Y
    python3 /mnt/nas/data/code/unibrowse/scripts/realinput.py type  --display :NN --text "..."
  · `--display` is the sidecar's Xvfb display, from browser_launch_isolated_chrome's response.
  · SCREEN coords, not client: offX = screenX + (outerWidth-innerWidth)/2, offY = screenY +
    (outerHeight-innerHeight); add the element's clientX/clientY. Verified by reading back
    `isTrusted` mousemove events at the target.
  · The tab must be the ACTIVE tab in its window (browser_switch_tab) or the input lands elsewhere.
Measured 2026-10-23 by `unibrowse`: 37/37 trusted mousemoves to an exact target, trusted
mousedown/mouseup/click, and typed text read back verbatim.

⛔ WHAT GENUINELY CANNOT BE SOLVED — recognise these and STOP, do not relay them either:
  · reCAPTCHA v3 — a background score. There is nothing to press, by anyone.
  · A Turnstile or hCaptcha that renders NO widget and mints no token (empty response field, no
    iframe). Nothing is on screen, so a human sees nothing to tap. Memo `398759b7`.
  Measured today in this class: npm signup (DataDome interstitial, six lanes), Postman login.

⭐ STILL RELAY WHEN: you tried and the widget refused you, or the challenge needs a judgement call
you should not make alone. `browser_request_captcha_solve({tabTarget, extensionId, prompt, agent})`
returns a link immediately; poll `browser_check_captcha_solve({sessionId})`.
⛔ PASS `agent=<the seat whose WORK this is>`, not your own name — the notice posts in THAT seat's
channel, and you must still poll.
⛔ ASYNCHRONOUS ON PURPOSE — never block waiting.
⛔ `browser_request_user_action` IS NOT THIS. It draws an overlay in a browser nobody is sitting at.
⚠️ DON'T BURN HIS ATTENTION. Four relay links for one PyPI signup on 2026-10-23 ended with him
saying *"just stop hammering these accounts ... or just leave me alone"*. One link, then drop it.

Full mechanism, limits and the press-and-hold findings: memo `1a93f00c`. Skill: `captcha-relay`."""


def already_fired(session_id: str) -> bool:
    """Has this session been told already? Marker write failure means fire."""
    try:
        os.makedirs(MARKER_DIR, exist_ok=True)
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", session_id or "nosession")[:120]
        path = os.path.join(MARKER_DIR, safe)
        now = time.time()
        if os.path.exists(path) and now - os.path.getmtime(path) < RE_ARM_SECONDS:
            return True
        with open(path, "w") as fh:
            fh.write(str(int(now)))
        return False
    except Exception:
        # ⛔ Fail toward SPEAKING. A missing marker must not silence the advisory —
        # the whole point is that the seat does not know, and the worst case of a
        # duplicate paragraph is cheaper than a captcha reported as a dead end.
        return False


def text_of(payload: dict) -> str:
    """Everything this event carries, flattened. Bounded: a 500KB page dump costs
    nothing to regex but we do not need all of it, and an unbounded read is how a
    hook becomes the slow part of a tool call."""
    parts = []
    for key in ("prompt", "tool_input", "tool_response", "tool_output"):
        val = payload.get(key)
        if val is None:
            continue
        try:
            parts.append(val if isinstance(val, str) else json.dumps(val)[:200000])
        except Exception:
            pass
    return "\n".join(parts)[:400000]


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return

    tool = str(payload.get("tool_name") or "")
    if ALREADY_KNOWS.search(tool):
        return

    blob = text_of(payload)
    if not blob or not TRIGGER.search(blob):
        return

    if already_fired(str(payload.get("session_id") or "")):
        return

    event = str(payload.get("hook_event_name") or "PostToolUse")
    print(
        json.dumps(
            {
                "systemMessage": ADVICE,
                "hookSpecificOutput": {
                    "hookEventName": event,
                    "additionalContext": ADVICE,
                },
            }
        )
    )


try:
    main()
except Exception:
    pass
sys.exit(0)
