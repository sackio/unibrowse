# Unibrowse feedback — driving Plaid Link iframe

**Filed**: 2026-05-14, by Claude/`finance` session, while driving a self-hosted
[Sure](https://github.com/we-promise/sure) Plaid Link flow.

## Context

User asked me to drive both the Plaid dashboard tab (form-fill the Production
application) and the Sure app tab (connect bank accounts via Plaid Link). The
form-fill worked fine. The Plaid Link iframe blocked me on several gaps below.

Plaid Link renders as a full-viewport cross-origin iframe at
`https://cdn.plaid.com/link/v2/stable/link.html?...&token=link-production-...`.
It's the canonical "modern cross-origin embed" — anything Plaid does, every
Stripe/Auth0/Hosted-checkout flow will do.

## Gaps observed

### 1. `browser_list_frames` doesn't enumerate dynamically-injected cross-origin iframes

After Plaid Link's `Plaid.create({...}).open()` runs, an iframe with
`id="plaid-link-iframe-1"` is appended to `<body>`. `document.querySelectorAll('iframe')`
sees it, but `browser_list_frames` returns only the main frame:

```json
{
  "frames": [{"frameId": "...", "url": "http://localhost:3100/...", "parentFrameId": null}],
  "count": 1
}
```

The iframe was visible (`display: block`, `inset: 0`, `z-index: 2147483647`)
and definitely loaded, but no frameId was ever exposed for it. So I had no
handle to operate inside it.

**Suggested fix**: `browser_list_frames` should call `Page.getFrameTree`
fresh on every invocation (not cached), and include all OOPIF frames CDP knows
about — including dynamically attached ones.

### 2. `frameTarget: "#plaid-link-iframe-1"` (CSS selector) rejected

```
Failed to evaluate JavaScript: Cannot resolve iframe from selector
"#plaid-link-iframe-1". Use browser_list_frames to get frameId values for
nameless iframes.
```

The iframe has a perfectly stable ID. Tools should resolve `#id` selectors
against `document.querySelector(...).contentFrame()` (or CDP equivalent) the
same way they'd resolve a `<name>` attribute. Right now CSS selectors only
work for *named* iframes, which is the rarer case.

**Suggested fix**: when `frameTarget` is a CSS selector, also try
`document.querySelector(sel).contentDocument`'s frame, not just by name.

### 3. Screenshot tokens blow my budget

`browser_screenshot` of a Plaid Link iframe page returned 33–61k tokens (PNG
base64). My default cap is 25k. The `max_tokens` parameter only truncates
text output — the actual image can't be downscaled.

**Suggested fix**: add `quality`, `format` (jpeg vs png), `maxWidth`,
`maxHeight`, or "screenshot of element" parameters so the caller can
preemptively shrink the payload. Plaid Link's UI doesn't need a 4K screenshot.

### 4. `browser_get_console_logs` is global, not tab-scoped

I asked for logs from `tabTarget=41907051` (Sure) and got 200+ entries from
`tabId=41906978` (an unrelated qf-dashboard tab that was 502'ing). The
`tabTarget` argument is accepted but ignored.

**Suggested fix**: when `tabTarget` is set, filter the log buffer by `tabId`
before returning.

### 5. `browser_get_network_logs` returns full headers (CSP > 4 KB)

Plaid dashboard's `content-security-policy` header is ~4 KB. Listing a few
dozen requests serializes a quarter-million tokens of mostly-CSP. The `filter`
arg helps but doesn't gate header bloat.

**Suggested fix**: add `includeHeaders: false`, `bodyMaxBytes`, or strip
`content-security-policy` / `strict-transport-security` / cookie response
headers by default.

### 6. `postMessage` interception / injection would unlock cross-origin iframes

Plaid Link communicates with the parent via `window.postMessage` for
events like `onSuccess`, `onExit`, `onEvent`. If unibrowse exposed:

- `browser_listen_postmessage(tabTarget, originPattern)` → stream messages
- `browser_send_postmessage(tabTarget, target, origin, data)` → inject

… I could observe Plaid Link's lifecycle and even trigger flows without DOM
access to the cross-origin iframe. That's the standard pattern for testing
embedded SDK widgets (Cypress's `cy.window().then(w => w.postMessage(...))`).

### 7. `browser_evaluate` returns `null` for valid JSON-serializable results

I hit several cases where:
```js
JSON.stringify({a: 1, b: [...document.querySelectorAll('button')].map(b => b.textContent)})
```
returned `null`, while the simpler:
```js
document.querySelectorAll('button').length
```
returned `7`. No error, just `null`. The pattern seems to be: complex
expressions that succeed in DevTools get serialized to `null` by the
unibrowse wrapper. Possibly a CDP `awaitPromise` / `returnByValue` issue or
a too-aggressive object-circularity guard.

**Suggested fix**: when the result is `undefined`, return `undefined` distinctly
from `null`. When `RemoteObject` is type=`object`, use `objectId` +
`Runtime.callFunctionOn` with `returnByValue: true` to get the actual
deeply-serialized value. And if serialization truly fails, return an error
object explaining why, not silent `null`.

### 8. Iframe content-driven flows (low-priority, hard problem)

For trusted user flows like bank-OAuth via Plaid Link, having unibrowse able
to *automate* the embedded login is not desirable for security reasons —
bank credentials should not flow through an automation harness. The right
answer here is the postMessage path (#6) and "show the iframe but require
human-in-the-loop for the actual auth," which is what we ended up doing.
Just calling this out so it's clear: I'm not asking to drive Plaid Link's
internals, only to observe its outer lifecycle and read its visible state.

## Severity / priority (my read)

| # | Gap | Priority | Why |
|---|---|---|---|
| 1 | `browser_list_frames` misses iframes | **High** | Blocks every embedded-widget flow |
| 2 | CSS selector → frame resolution | **High** | Same, easier workaround once #1 works |
| 4 | tab-scoped console logs | **Med-High** | I read 200 unrelated errors and missed the real one |
| 3 | screenshot size knobs | **Med** | Easy to hit, easy to add params |
| 5 | network-log header bloat | **Med** | Easy fix |
| 7 | `evaluate` returns null | **Med** | Silent failures are the worst kind |
| 6 | postMessage helpers | **Low-Med** | Powerful but bigger scope |
| 8 | iframe internals | **Skip** | Intentionally out-of-scope |

## Repro

The Plaid Link iframe at https://cdn.plaid.com/link/v2/stable/link.html
mounted by Sure at `http://localhost:3100/plaid_items/new?accountable_type=Depository&region=us`
reliably reproduces gaps 1–5 today. Happy to wire a more minimal repro if useful.
