# Watch — push events out of the browser

Design spec. Approved by Ben 2026-08-27.

Filed as `docs/WATCH_DESIGN.md` to sit beside `EXTENSION_DESIGN.md` rather than
under a new tree.

---

## The problem

An agent driving a tab today has exactly one way to learn that something
happened on the page: call a tool and look. Waiting for a chat reply, a job to
finish, a file to download, or a page to settle all become polling loops, each
one a round trip through MCP → server → WS → extension → CDP, repeated until
the answer changes.

`browser_observe_navigations_*` already solved a narrow slice of this — arm a
regex against `webNavigation.onCommitted`, buffer matches, drain with a
blocking `first()`. It was built for OAuth callbacks that redirect faster than
a poll can catch. It is the right shape and the wrong scope: one event source,
pull-only, and it cannot hand anything to a third party.

**Watch generalises that primitive**: any event source, an arbitrary predicate,
and delivery to a sink — ATC first, arbitrary webhooks after.

## What was decided, and by whom

Ben, 2026-08-27, in `#unibrowse`:

- **Events fire-and-forget.** A watch that fires with no listener **drops** the
  event. No queue, no outbox, no retry, no replay. This is what keeps the
  system small.
- **Watches are explicitly deletable**, and are **cleared when the attachment
  ends**.
- **One general predicate**, not a per-source filter DSL. The source decides
  *when* to evaluate; the caller's JS predicate decides *whether* to fire.
- **Build for every source we can enumerate.**
- **ATC delivery must reach the calling agent's own session.**

## ⛔ Correction, 2026-08-27: the predicate cannot run in the extension

The design below said the predicate runs in the extension, next to the event.
**It cannot.** MV3's extension Content Security Policy forbids evaluating a
string as JavaScript in a service worker; `new Function` and `eval` both throw:

> Evaluating a string as JavaScript violates the following Content Security
> Policy directive because `'unsafe-eval'` is not an allowed source of script

Found on the first live arm, not in design. What ships instead:

| stage | where | what |
|---|---|---|
| **prefilter** | extension service worker | declarative, eval-free — `{path, op, value}` with `all`/`any`/`not`. Keeps chatty sources off the WebSocket. |
| **predicate** | mcp-server (Node, no CSP) | the caller's arbitrary JS. Fully general, as specified. |

Both properties the design wanted survive: non-matching events still do not
cross the wire, and the predicate is still one general evaluate.

**Page-home sources are the exception** — their predicate is injected into the
document and runs under the *page's* CSP, not the extension's, so those keep
arbitrary JS at the source.

⭐ Two consequences worth stating:

1. **`once` moved to the server.** A prefilter match is not a predicate match,
   so disarming on the first prefilter hit would drop the watch before the real
   condition was ever tested.
2. **Predicate execution stays on the trust boundary `routine-runner` already
   occupies** — the server's Node runtime — instead of widening it into the
   browser context that holds every live cookie in the pool. The security
   section below gets simpler as a result, not more complicated.

⚠️ The rejected alternative was a manifest `sandbox` page, which would allow
eval inside the extension. It was rejected because every evaluation becomes an
async postMessage hop (worker → offscreen → sandboxed iframe → back), which for
a source like `Network.requestWillBeSent` is worse than a local WebSocket
message — while *appearing* to preserve the "cheap at the source" property.

---

## Architecture — prefilter at the source, predicate and delivery at the server

Three homes, one API.

```
  ┌─────────────── browser ────────────────┐      ┌──── mcp-server ────┐
  │                                        │      │                    │
  │  page (content script)                 │      │  watch registry    │
  │    DOM / window / fetch  ──┐           │      │  (authoritative)   │
  │                            │ predicate │      │                    │
  │  service worker            ├─ evaluate │ WS   │  sink dispatch     │──> ATC
  │    CDP events  ────────────┤  HERE     ├─────>│   atc | webhook    │──> webhook
  │    chrome.* events ────────┤           │      │   | buffer         │──> poll
  │    unibrowse events  ──────┘           │      │                    │
  └────────────────────────────────────────┘      └────────────────────┘
```

**The predicate always runs where the event already is.** Non-matching events
never cross the WebSocket. This is the primary defence against a chatty source
turning into a network problem, and it costs nothing.

**Delivery always runs on the server.** The extension never holds a webhook
credential and never makes an outbound request to a third party. The server is
already the identity and auth plane — see `src/utils/auth.ts` and memo
`33ff3f8b` — and putting egress anywhere else would route around it.

### Rejected alternatives

**Everything at the server.** The extension streams whole event types and the
server evaluates. One sandbox to reason about, but `Network.requestWillBeSent`
on a busy page is hundreds of events per second per tab, and no server-side
predicate can touch the DOM.

**Everything in the extension**, POSTing straight to ATC. Lowest latency, and
the only design that survives an mcp-server restart. Rejected because the
extension would hold webhook credentials and make arbitrary outbound calls from
a context that also holds every live cookie and session in the browser.

## API

```ts
browser_watch_create({
  source:    "cdp.Network.eventSourceMessageReceived",
  tabTarget: "chat",              // or extensionId for browser-wide sources
  predicate: "(e) => e.data.includes('[DONE]')",   // optional; omit = every event
  sink:      { kind: "atc" },     // defaults to the CALLING AGENT (see below)
  options:   { once: false, coalesce: {windowMs: 2000, mode: "last"}, maxPerMin: 30 },
  agent:     "unibrowse",         // caller identity, as elsewhere in this codebase
}) -> { watchId, source, home: "worker" | "page" | "server", armed: true }

browser_watch_list({ tabTarget?, extensionId? })
  -> [{ watchId, source, armed, firedCount, lastFiredAt, droppedCount, ... }]

browser_watch_delete({ watchId })

browser_watch_sources()
  -> [{ id, home, permission, predicateArg, cost, description }]

browser_watch_poll({ watchId, timeoutMs })   // for sink.kind === "buffer"
```

### `browser_watch_sources()` carries its own documentation

The predicate's sandbox differs by home, and that difference is the part of
this system most likely to confuse a caller. A `cdp.*` predicate receives the
CDP event object and has no DOM. A `dom.*` predicate receives
`(mutations, document)`. A `unibrowse.*` predicate receives the internal event
record.

`browser_watch_sources()` returns, per source, the execution home and **the
exact shape the predicate will be handed**, so the caller never has to guess
and never has to read this document.

## Sinks

| kind | shape | notes |
|---|---|---|
| `atc` | `{ to?, subject?, priority? }` | `to` defaults to the calling `agent`. Server POSTs `/messages` on the broker. |
| `webhook` | `{ url, headers? }` | Arbitrary third party. Server-side only. |
| `buffer` | `{ maxBuffered? }` | Held server-side, drained by `browser_watch_poll`. |

`buffer` is `observeNavigations.first()` generalised. It stays because
"block until X happens" is still the right shape when an agent is actively
waiting rather than going away — push and long-poll answer different questions
and both are worth having.

### ATC delivery reaches the calling agent's session

Ben's explicit requirement. The `agent` parameter already flows through this
codebase as caller identity (tab reservations use it; `claimTab()` no-ops
without it). A watch records its creator, and `sink.kind === "atc"` with no
explicit `to` delivers to that creator's ATC subscriber id.

Broker contract, read from `atc/server/src/messages.ts:1297`:

```
POST http://192.168.1.168:3030/messages
{ to, from, content, subject?, priority? }
```

`to`, `from` and `content` are all required; the route 400s without them.

⛔ The literal broker host is used, not `$ATC_URL` — that variable is unset in
several execution contexts and the failure reads exactly like "nothing armed".

## Flood control

Four layers, because a watch on a chatty source is the obvious way to hurt ATC.

1. **The predicate runs at the source.** Non-matches never leave the worker.
   Free, and it does most of the work.
2. **Coalescing** — `{windowMs, mode: last | batch | count}`. For an SSE stream
   you want "the response finished", not four hundred token events.
3. **Rate cap** — `maxPerMin`, enforced in the worker.
4. **Circuit breaker** — a watch that blows its cap auto-disarms.

⚠️ **The breaker must announce its own death through the sink.** A watch that
silently stops is indistinguishable from a quiet page, which is the failure
this whole system exists to remove. The final message is not optional.

## Lifetime

A watch dies on any of:

- `browser_watch_delete`
- the tab detaching or closing (tab-scoped watches)
- the extension disconnecting (browser-wide watches)
- `options.ttlMs` elapsing
- `options.once` firing once

Events arriving with no live sink are **dropped**. This is a decision, not an
oversight.

## ⛔ The fail-quiet, and the three things that fix it

Dropping *events* is safe. The danger is the *watch* disappearing silently:
Chrome evicts MV3 service workers on its own schedule, `navObservers` is a
plain in-memory `Map`, and an agent waiting on a notification cannot tell
"nothing has happened yet" from "my watch is gone." **That is the one failure
mode that makes push strictly worse than the polling it replaces** — a poller
finds out.

Three parts, none of them new machinery:

1. **Watch definitions persist to `chrome.storage.session`.** A service-worker
   wake re-arms from storage instead of losing them.
2. **The server holds the authoritative registry and re-pushes on
   `EXTENSION_REGISTER`.** This is the repair `6e8a186` already performs for tab
   ownership, and it has the useful property that it fixes drift predating its
   own deploy. The extension re-announces on reconnect, as `5cda765` does.
3. **`browser_watch_list` reports `armed` as the extension's raw answer**, never
   the server's belief.

⛔ Point 3 is load-bearing and easy to get wrong. `browser_list_attached_tabs`
exposes an `isActive` field that `claude-login-auto` (owned by `agents`) reads
to detect a wedged pointer, and the rule established there is that a report must
**never repair on read** — repairing the state you publish hides the condition
being published. A registry answering `armed: true` because the server holds a
row, while the worker has actually lost the watch, is that same bug under a new
name. See memo `9fb367c0`.

## Source catalogue

`FREE` = the event stream already flows in unibrowse today. `GRANTED` =
permission already in `manifest.json`, listener not yet written. `NEEDS PERM` =
manifest change, which forces a pool-wide **re-install**, not a reload.

### Tier 1 — CDP, per attached tab (`chrome.debugger`, already attached)

| source | status | note |
|---|---|---|
| `Network.requestWillBeSent` / `responseReceived` | FREE | already feeding the `networkLogs` ring buffer |
| `Network.eventSourceMessageReceived` | GRANTED | **SSE frames — the best source for a chat app** |
| `Network.webSocketFrameReceived` / `FrameSent` | GRANTED | the other half of live apps |
| `Network.loadingFinished` / `loadingFailed` | GRANTED | |
| `Runtime.consoleAPICalled` / `exceptionThrown` | GRANTED | console output, uncaught errors |
| `Log.entryAdded` | GRANTED | CORS, CSP, mixed content — things `console` never sees |
| `Page.javascriptDialogOpening` | GRANTED | a modal blocking the tab |
| `Page.fileChooserOpened`, `Page.downloadWillBegin` | GRANTED | |
| `Page.frameNavigated`, `loadEventFired`, `domContentEventFired` | GRANTED | |
| `Target.targetCrashed` | GRANTED | the tab died — currently invisible until the next call fails |
| `DOM.attributeModified` / `childNodeInserted` | GRANTED | DOM mutation without a content script; chatty |
| `Media.playerEventsAdded` | GRANTED | |
| `Security.securityStateChanged` | GRANTED | |
| `Storage.indexedDBContentUpdated` | GRANTED | |

**Excluded from v1: `Fetch.requestPaused`.** Interception blocks the request
until the handler responds, so a slow or crashed predicate hangs the page. A
passive observer that can wedge the thing it observes is a different and much
riskier product.

### Tier 2 — `chrome.*` events, browser-wide

| source | status | note |
|---|---|---|
| `webNavigation.onCommitted` / `onCompleted` | FREE | |
| `webNavigation.onHistoryStateUpdated` | GRANTED | **SPA route changes, which `onCommitted` never fires for** |
| `webNavigation.onBeforeNavigate`, `onDOMContentLoaded`, `onErrorOccurred`, `onCreatedNavigationTarget` | GRANTED | |
| `tabs.onCreated` / `onUpdated` / `onRemoved` / `onActivated` | FREE | title, favicon, audible, muted, discarded live inside `onUpdated` |
| `windows.onCreated` / `onRemoved` / `onFocusChanged` | GRANTED | |
| `downloads.onCreated` / `onChanged` / `onDeterminingFilename` | GRANTED | progress → complete |
| `cookies.onChanged` | GRANTED | session expiry, login/logout detection |
| `history.onVisited` | GRANTED | the durable fallback that already rescues missed cross-origin redirects |
| `management.onEnabled` / `onDisabled` / `onUninstalled` | GRANTED | an extension changing under you |
| `storage.onChanged`, `bookmarks.*`, `sessions.*`, `notifications.onClicked` | GRANTED | |
| `declarativeNetRequest.onRuleMatchedDebug`, `webRequest.*` | GRANTED | observational only |
| `idle.onStateChanged` | **NEEDS PERM** | **excluded from v1** — the only source costing a re-install |

### Tier 3 — in-page, content script

Injected via `chrome.scripting`, the way `session-recorder.js` already is.
There is no `MutationObserver` in the extension today; this tier is new
infrastructure.

- `MutationObserver` — subtree, attributes, characterData
- `IntersectionObserver` — element entered/left the viewport
- `ResizeObserver`, `PerformanceObserver` (LCP, long tasks, resource timing)
- window/document events: `hashchange`, `popstate`, `visibilitychange`,
  `online`/`offline`, `beforeunload`, `error`, `unhandledrejection`, `storage`
- arbitrary `addEventListener` on any target — including the page's own
  `CustomEvent`s, which is how you watch an app that announces its own state
- `fetch` / `XHR` / `WebSocket` patching in the MAIN world — gets request and
  response **bodies**, which CDP gives only via a second round trip
- element predicate — "this selector's text changed". The one place a
  rAF/interval fallback is genuinely needed, for state with no event behind it.

⚠️ A page-home watch dies on navigation and must be re-injected on
`webNavigation.onCommitted`. That re-injection is part of the fail-quiet fix,
not an optimisation.

### Tier 4 — unibrowse's own events

About the automation plane, not the page. All FREE — the code already knows
when these happen and never tells anyone.

- tab attached / detached / reserved / released
- **another agent took over your tab** — today you find out by a call failing
- extension connected / disconnected / re-registered
- `lastUsedTabId` re-pointed
- macro or routine started / finished / threw
- session recording started / stopped

For a multi-agent fleet this tier is plausibly worth more than the page tier:
it is the only way one agent learns that another has taken the thing it was
working on.

## Security

⛔ **A watch predicate is admin-trust code, exactly like a routine.**

`routine-runner` already executes caller-supplied JS in the mcp-server Node
runtime — full filesystem, process and network access — and gates on the same
`/mcp` plane, which is LAN-only and API-keyed. A watch predicate is not a new
trust boundary, but it does widen the surface from the server's runtime to the
**browser's extension context**, which holds every live cookie and session in
the pool.

This is stated here so it is a decision on the record rather than something
discovered later. Anyone who can reach `/mcp` can already run arbitrary code in
the server; watch predicates let them also run it in the extension.

⛔ Nothing in this feature may weaken the `203.0.113.1` / trusted-proxy
classification described in memo `33ff3f8b`. Both are security controls that
fail toward OPEN, silently.

## Testing

- **Unit** — predicate compilation and sandbox shape per home; coalescing
  windows; rate cap and breaker arithmetic; registry lifetime transitions.
- **Integration** — arm against a real CDP source in an isolated Chrome, drive
  the page, assert exactly one delivery. Assert the *negative* too: a predicate
  that never matches produces zero WS traffic.
- **Fail-quiet regression** — kill the service worker, confirm re-arm from
  `chrome.storage.session`, and confirm `browser_watch_list` reports
  `armed: false` in the window where it genuinely is false rather than
  repairing on read.
- **Breaker** — exceed `maxPerMin` and assert the final "breaker tripped"
  message is delivered.

## Deployment

⛔ `mcp-server` on `:9010` is **shared LAN-wide**. Heads-up to zone `sessions`
and wait for acknowledgement before `docker compose restart mcp-server`.

Extension changes reach a browser only at that browser's next extension reload.
No manifest change is required for v1, so no re-install is needed.

`tsup` does not typecheck. Baseline `npm run typecheck` error count measured at
**375** on 2026-08-27 before this work; it must not rise.
