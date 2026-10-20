# console-credits — read Claude Console credit grants per account

Reads, per account: date granted / expires on / remaining balance, from
`platform.claude.com/settings/billing`. Read-only. Asked for by `agents`
(2026-10-19) to feed the per-grant guard in agentkit's grants.json.

## Why a script and not a seat clicking
~12 browser calls per account. Driving it from the shell through the server's
`POST /mcp` endpoint collapses that to one tool call for the whole batch, and
keeps the magic-link URLs — live single-use credentials — out of any LLM context.

## Use
1. `browser_launch_isolated_chrome` with a fresh profile at
   `https://platform.claude.com/login`, `headless: true` (Xvfb-headful sidecar,
   so nothing paints on Ben's screen). Note the tabId.
2. Create a SECOND attached tab — the verification-code flow needs two contexts.
3. `UB_TAB_A=<tab1> UB_TAB_B=<tab2> python3 -I cc2.py <email> [...]`

## ⛔ Three traps, each measured 2026-10-19
- **A magic link is `/magic-link#<token>`.** Navigating the opener tab from
  `#OLD` to `#NEW` is a SAME-DOCUMENT navigation: no reload, and the page keeps
  rendering the PREVIOUS code. Three accounts submitted a stale code and failed
  verification while every `navigate` call returned success. `cc2.py` loads
  `about:blank` between links to force a real document load.
- **Opening a Console magic link no longer signs you in.** It renders a 6-digit
  code to type back on the requesting page. Same profile and same tab still get
  the code, so it is not a cross-context rule. `/api/organizations` stays 403 on
  `/magic-link` meanwhile, which mimics the benign "slow consume" in memo
  34fa4ebc — look at the page body, not the API, before concluding it stalled.
- **The code input renders LATE.** At ~4s after submit the login page has zero
  inputs; `input[name=code]` and "Verify email" appear a few seconds later.
- ⚠️ The Console shows **Date granted / Expires on**, NOT a next-credit date.
  That string is on `claude.ai/settings/billing`, a separate sign-in.
- ⚠️ Requesting several links for one address in quick succession appears to
  throttle it — ben@sack.io and agents@sack.io stopped returning "link sent"
  after repeated debug attempts. `claude-login-auto` uses magic links to those
  same addresses, so back off rather than retrying.

## ⛔ Three more traps, measured 2026-10-20 (the first run of this tool)

- **The submit needs an attestation token AT CLICK TIME, and this script used to click
  without one.** All three accounts returned a bare `no link-sent` while the page read
  "Couldn't verify your browser. Try again." — no mail was sent, and it looked exactly
  like the magic-link throttle warned about above. It is not that. `cc2.py` now mints
  before clicking and reports the timing in a `mint` field.
  ⚠️ "Try again." on the Console login page is PLAIN TEXT in `#email-error`, not a
  control. There is nothing to press, unlike claude.ai's redeem page.
- **`platform.claude.com/logout` does not end the session.** After one account signs in,
  `/logout` then `/login` lands on `/dashboard` still signed in, so the layout probe
  finds no email field and every later account in the batch dies "login card not laid
  out". ⇒ Pass `UB_EXT=<extensionId>` so the script can clear cookies scoped by
  `tabTarget`, or run ONE account per launched browser. The `WRONG ACCOUNT` guard is the
  only thing that stops the first account's grant being reported under the other names.
- **A failed `browser_evaluate` returns its error as content text, not as an error.**
  `nav(B,"about:blank")` detaches the debugger (restricted URL), so the next evaluate
  returned the 74-char string "Failed to evaluate JavaScript: Cannot attach debugger to
  restricted URL: about:blank" — which the script took for the 6-digit code, typed into
  `input[name=code]` and submitted. The page answered "There was an error verifying your
  code", so the fault read as a code-flow problem while the real cause was a parked tab.
  `ev()` now raises. The neutral URL between links is a real same-origin page.

## ⚠️ LANE: the chromium-host sidecar is the WORST lane for this, and rest is the only fix

Attestation mint times measured 2026-10-20, same WAN egress:

| lane | mint |
|---|---|
| office `ext_bb94966c`, claude.ai, incognito | **506ms** 09:50 · **611ms** 10:35 — stable |
| server4 sidecar, platform.claude.com, 1st+2nd mint | 2325ms · 2079ms |
| server4 sidecar, every mint after | **NONE at ~14s**, 0 tokens on 3 widgets |

A VIRGIN sidecar profile fails too (`NONE 14018ms`), so launching a clean profile does
not help — the instinct toward isolation is what breaks it. The early successes then
uniform failure is a budget being spent, not a fingerprint being rejected.
⭐ Office stayed at ~600ms throughout, so this did NOT exhaust a WAN-wide budget; the
degradation is specific to the sidecar lane.
⇒ **Rest it for hours** (ext_bb94966c recovered overnight on 10-17). Do not retry in a
loop, and do not go borrow `agents`' login browser — `claude-login-auto` needs its mint
budget for account swaps.
