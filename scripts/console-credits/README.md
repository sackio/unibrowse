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
