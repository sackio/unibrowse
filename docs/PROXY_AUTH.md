# Authenticated proxies

A VPN lease arrives as a URL with credentials in it:
`http://user:pass@exit.example:8888`. Chrome cannot be given that.

## Why there is machinery here at all

⛔ **`--proxy-server` takes host:port and nothing else.** There is no flag for a
proxy password, and `parseProxySpec` refuses a spec containing one on purpose:
a command line is world-readable via `ps`, so a lease URL on it hands the
password to every process in the container.

⛔ **And under Xvfb nobody can type it.** Chrome's answer to a 407 is a dialog.
There is no window manager to show one and no human to fill it, so the request
hangs — the browser looks healthy and loads nothing.

⇒ `chrome.webRequest.onAuthRequired`, in the extension, is the only place a 407
can be answered. The problem that leaves is getting the credentials there.

## How they get there

```js
browser_launch_isolated_chrome({
  profileName: "ots-rot",                   // ⛔ must be a NAMED profile
  proxy: "http://exit.example:8888",        // host:port only, as always
  proxyAuth: { username: "...", password: "..." },
})
```

1. **mcp-server** stages the credentials in memory against that profile's stable
   extension id and puts a **single-use nonce** on the seed URL (`&pa=…`).
   ⛔ Never the password: the seed page is a real navigation, so its URL lands in
   the profile's history, in this server's access log, and in any `Referer` the
   page emits.
2. **The seed content script** exchanges `(eid, pa)` for the credentials at
   `GET /__unibrowse_proxy_auth` and stores them in `chrome.storage.local`.
   It fetches from the seed page rather than from the background because that
   page is same-origin with mcp-server, whose host is in chrome's proxy bypass
   list — so this one request cannot hit the 407 it exists to answer.
3. **background.js** arms `onAuthRequired` and answers proxy challenges.

⛔ **The sidecar is never told the credentials at all.** `POST /launch` carries
host:port exactly as before.

## The three refusals, and why each one is there

| | |
|---|---|
| `isProxy` false → `{}` | a **site's** 401. Answering it with the proxy's credentials would hand a stranger's login form our VPN lease |
| 3rd challenge for one request → `{}` | Chrome re-fires `onAuthRequired` when credentials are refused, so answering every time with a wrong password **loops until the request dies** — a hang, not an error. Two tries, then let it 407 so the cause is visible |
| a credential containing `\r`, `\n` or NUL → throw | that is a header-injection primitive, not a typo to tidy up |

## Honest limits

⚠️ **The credentials come to rest in the profile.** `chrome.storage.local` already
holds that profile's cookies, so this adds no new *class* of exposure — but a
profile directory copied elsewhere carries the lease with it.

⚠️ **The collect endpoint is public.** It has to be: the extension fetches it
before it has registered, so it cannot be gated on the API key. The nonce is
what guards it — 16 random bytes, single use, constant-time compared, and issued
only to a launch that asked for credentials. ⭐ An extension id alone is not
enough, which matters because extension ids are values other seats legitimately
hold and pass around in messages.

⚠️ **Every collect failure returns the same 404** — wrong nonce, already
collected, never staged, expired. Distinguishing them would let a caller
enumerate which profiles hold a lease by reading the error.

⚠️ **Staged credentials expire after 12h** and a relaunch replaces them. An
uncollected entry is a launch that never came up.

✅ **Verified end to end 2026-10-23**, against a real authenticating proxy that
`scripts` stood up (a shared NordVPN US exit; unauthenticated `curl -x` to it
returns 407):

| | |
|---|---|
| positive | a sidecar profile launched with `proxyAuth` loaded `https://ipinfo.io/ip` and it returned the VPN exit's address, not the house IP — so the 407 was answered |
| negative | the same launch with a deliberately wrong password produced Chrome's own "site can't be reached" within 10s, i.e. it **failed fast rather than hanging** — which is the property the two-attempt cap exists for |

Also covered by unit tests: `tests/unit/proxy-auth-is-single-use.test.ts`
(5 cases — single use, wrong nonce and wrong eid, relaunch replacing a lease,
nonce unguessability, and a credential carrying CR/LF being refused).

⚠️ **Still unexercised:** a proxy that challenges with a scheme other than Basic,
and a challenge arriving before the seed page has run. The second is unlikely by
construction — the seed page is the first navigation and its host is in the
bypass list — but "unlikely by construction" is not "measured".
