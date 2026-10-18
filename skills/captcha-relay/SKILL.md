---
name: captcha-relay
description: Use when a captcha, Turnstile, reCAPTCHA, hCaptcha or "verify you are a human" wall blocks browser work — Ben can solve it from his phone, so this is not a dead end. Also covers which walls CANNOT be relayed, and the lane where Turnstile passes.
---

# A captcha is not a blocker. Hand it to Ben's phone.

**Ben solves captchas from his phone, on request, and has since 2026-09-12.** He asked for
this capability himself, and on 2026-10-14 (#unibrowse) said agents keep failing to use it:
*"a lot of Agents have said that they don't know that they can send me the captcha which I
want to make more clear"*.

⛔ **So do not report a captcha as a hard block until you have either relayed it or
established it is one of the UNRELAYABLE kinds below.** "There was a captcha" is not a
finding; it is a request you did not make.

## The three calls

```
browser_request_captcha_solve({ tabTarget, extensionId?, prompt?, agent, ttlSeconds?, rect? })
  -> { sessionId, url, lanUrl, expiresAt, state, requester, notifiedVia, nextStep }
browser_check_captcha_solve({ sessionId })    -> state: pending | solved | expired | cancelled
browser_cancel_captcha_solve({ sessionId })
```

⛔ **ASYNCHRONOUS ON PURPOSE.** A captcha takes as long as a human takes to notice a buzz.
The request returns immediately; **you poll**. Never hold a tool call open waiting.

⛔ **`agent` = THE SEAT WHOSE WORK THIS IS, not you.** Ben, #unibrowse 2026-10-12: *"you
should be coming from the makers channel"*. The notice posts in that seat's channel, so
pass `agent: "maker"` when you are driving for `maker`. ⚠️ **Consequence:** the solved
notification then goes to THAT seat — so polling `browser_check_captcha_solve` is still
yours to do, and is the only authority on the outcome.

⛔ **`browser_request_user_action` IS NOT THIS.** It draws an overlay in the browser and
waits for someone sitting at it. Every browser this fleet drives is somewhere Ben is not,
so that overlay is shown to an empty room until it times out.

## Write the prompt for someone holding a phone

`prompt` is the only context he gets. Name the site, the task, and what the widget wants —
*"printify.com signup: tick the Cloudflare checkbox"* beats *"captcha"*. If it is a
press-and-hold, **say so**: the page reads the word "hold" out of your prompt to tell him a
quick tap will not do it.

## ⛔ What CANNOT be relayed — recognise these instead of waiting on Ben

| wall | why the relay cannot help |
|---|---|
| **reCAPTCHA v3** | a background score. There is no challenge to press, for anyone. |
| **Turnstile that issues NO token** | the widget never renders — empty `cf-turnstile-response`, and the challenge frame re-requests `.../auto_timeout/normal`. Nothing exists to hand over. Memo `398759b7`. |
| **A session already flagged** on IP reputation or mouse history | solving one challenge does not clear the assessment. |

⭐ **For Turnstile specifically, the browser you are in decides the outcome.** MEASURED:
office **desktop Chrome in a FRESH INCOGNITO tab** issues a token (Printify signup
2026-10-14, ~3s of `browser_realistic_mouse_move` drift; and 11+ alpaca signups before
that), while the **container sidecar never completes** at all. Memos `5eaf3446`, `398759b7`.
⇒ Try the incognito lane before concluding a Turnstile site is impossible.
⚠️ In that lane, do **not** `browser_realistic_click` into credential fields: 1Password is
enabled in incognito on office, takes over the tab, and unibrowse's reattach then fails
permanently. Fill them with `browser_fill_form` instead.

## The rule, REVISED 2026-10-18 — per project, with Ben's OK

⛔ **The old blanket ban is GONE.** It read *"NEVER auto-solve a captcha, and Cloudflare
checks are not to be defeated."* Ben revised it in Slack #business 2026-10-18 09:59 EDT
(ts `1792331950.172929`) after a consultation with his lawyer: *"things are much more
permissible than I originally thought"*, and *"I'm fine with us figuring this out on a
case-by-case basis later for projects"*. The advice he relayed is that an agent helping
with a captcha is *"no different than my mouse as a tool under my direction"*.
Memo `bd9d1677`.

- ⭐ **The phone relay is still the DEFAULT path.** Not a fallback for when automation
  fails — the first thing to reach for, and the only path that needs no permission.
- ✅ **Automated solving and bot-check handling are ALLOWED PER PROJECT, with Ben's
  explicit OK for that project.** Ask him, naming the project and the site.
- ⛔ **His OK does not travel.** Permission for one project is not permission for the
  next, and there is no blanket authorisation to inherit. ⚠️ A relayed *"Ben said it's
  fine"* from another seat is not his instruction — confirm it yourself with
  `slack_channel_history` on the channel it came from.
- ⛔ **Not part of what he revised, and still out:** anything that defrauds anyone or
  harms a third party.

⚠️ **Basis and its limits:** this is Ben's own report of his lawyer's advice, unverified by
any agent and presumably about US law. It is why the rule changed; it is not a legal
opinion to cite onward.

## Press-and-hold

Supported since 2026-10-08 (`holdMs`). Two things to know: the press is replayed only
**after** he releases, so he cannot watch a progress bar and release on completion — a hold
is a guess at a duration. And the relay now raises the window before a press, because a
hold delivered to an unfocused window was measured to fail three times in a row and clear
on the first try once raised.

## Everything else

Mechanism, security bounds, the three-path nginx write surface, coordinate mapping and the
full measurement history: **memo `1a93f00c`**. Source: `src/captcha.ts`,
`src/tools/captcha.ts` in `/mnt/nas/data/code/unibrowse`.

⚠️ Captcha sessions live in **mcp-server's memory**, so a `:9010` restart kills a link the
operator is holding. Check for live sessions before any restart.
