# The :9010 peer protocol — connecting a browser that is NOT our Chrome extension

Written 2026-10-13 for Slipway's on-phone browser, after Ben assigned all of
Slipway to this seat (Slack #super-agent 15:09 EDT, ts `1791918565.978849`).

Everything below was read out of the running code, not recalled. Each claim
names its file and line so the next reader can disagree with it cheaply.

---

## ⛔ Read this before you plan anything

**Stock Chrome for Android accepts no extensions, and there is no cross-app
`chrome.debugger`.** Searched 2026-10-13: extension support on Android exists
only in experimental desktop-mode / large-screen builds, and `chrome.debugger`
has no documented Android behaviour at all. Some third-party Chromium browsers
on Android do run extensions (Yandex, Quetta), but their CDP support is
unverified and our extension needs CDP for part of its surface.

⇒ **Nothing on this server can reach a tab the operator opened in Chrome on his
phone.** A phone-resident browser has to be an app driving its own WebView,
which then connects here as a peer. That is what this document specifies.

⚠️ The other route on that phone is `super-agent`'s AccessibilityService puppet,
which already drives real Chrome with taps, typing and screenshots. It is
screen-level, so an unattended agent driving it captures whatever else is on
screen — which is why it is for sessions the operator is watching, not for this.

---

## 1 · The socket

`ws://<host>:9010/ws` — one WebSocket, path `/ws` exactly (`src/ws.ts:30`).

**Auth.** When `UNIBROWSE_API_KEYS` is set the upgrade requires a valid key as
`?key=<key>`, `Authorization: Bearer <key>`, or an `X-API-Key` header; without
one the upgrade is refused `401 Unauthorized: missing or invalid API key`
(`src/ws.ts:32-38`). When it is unset every upgrade is accepted. ⚠️ So a peer
that works on the LAN today can start failing at the handshake the moment keys
are switched on, and the failure is an HTTP status on the upgrade, not a
protocol error — handle it where you handle connection failures.

**Heartbeat.** The server pings every 30 s and terminates any peer that did not
pong within one interval (`src/http-server.ts:1637-1650`). Most WS clients
(OkHttp included) answer pong at the protocol level with no application code.
If yours does not, you must, or you get dropped every 30 s.

⚠️ The heartbeat exists because a proxied connection dies at nginx's
`proxy_read_timeout` (600 s) when idle. A phone adds its own hazards the
heartbeat does NOT solve: doze, network handoff, and process death. Reconnect
with backoff and re-register; see §2 on why that is safe.

---

## 2 · Registration

The peer speaks first. Nothing is routed to a connection that has not
registered — this is deliberate, so that a test script opening the socket cannot
displace a real browser (`src/server.ts:515-518`).

```json
{ "type": "EXTENSION_REGISTER",
  "payload": { "extensionId": "ext_<uuid>",
               "profileName": "slipway-phone",
               "hostname": "pixel",
               "userAgent": "<the WebView's UA>" } }
```

Server answers:

```json
{ "type": "EXTENSION_REGISTER_ACK", "payload": { "extensionId": "ext_<uuid>" } }
```

Handled at `src/server.ts:131-162`. `profileName`, `hostname` and `userAgent`
are all optional; only `extensionId` matters.

⛔ **`extensionId` MUST be stable across restarts, reinstalls excepted.** Mint
one `ext_<uuid>` on first run, persist it, and send the same one forever. An id
that changes per launch is the single most expensive mistake available here:
ha's ecobee-broker minted 1,329 distinct ids in 26 hours because the thing it
did to find its id was what destroyed it, and it could never converge. Other
seats match on extension ids and on how many exist, so churn is an
external-contract event, not a cosmetic detail.

**The server records your address itself**, past a trusted proxy, and keeps the
proxy's address separately (`src/server.ts:146-156`). You cannot report it and
should not try.

**Re-registering is safe and is the intended reconnect path.** The server
replaces the connection for that id.

### What the server does to you immediately after the ack

Two calls, both fire-and-forget, both already wrapped so a failure is non-fatal
(`src/server.ts:163-200`):

1. `browser_list_attached_tabs` — rebuilding tab ownership the restart erased.
2. `browser_evaluate` with `{expression: "location.href"}` per armed watch, to
   re-arm watches against the document they were created for.

⇒ A reduced peer should answer both with an explicit error (§3). It will be
logged as a non-fatal rebuild failure and nothing else breaks.

---

## 3 · Requests and responses

Server → peer:

```json
{ "id": "<uuid>", "type": "browser_navigate", "payload": { "url": "https://…" } }
```

Peer → server, success:

```json
{ "type": "messageResponse", "payload": { "requestId": "<the id>", "result": … } }
```

Peer → server, failure:

```json
{ "type": "messageResponse",
  "payload": { "requestId": "<the id>", "error": "browser_drag is not supported by the Slipway peer" } }
```

Implemented in `src/utils/messaging-sender.ts`. The four rules that actually
bite:

1. ⛔ **`error` is tested for PRESENCE, not truthiness** (`messaging-sender.ts`,
   the commented branch). `undefined` and `null` both mean success. **`error: ""`
   is treated as a FAILURE** and the server synthesises a message about an
   undescribed throw. ⇒ On success, OMIT the key. On failure, send a non-empty
   string that names the thing that failed.
2. **`requestId` must echo the request's `id` verbatim.** A response whose
   requestId matches nothing is silently ignored — there is no error for it.
3. **Default timeout is 30 s** per request, after which the server rejects and
   stops listening; a late answer is discarded silently. Callers may pass less.
4. **Responses may be out of order.** Requests are correlated only by id, so
   you may process concurrently — but see the concurrency warning in §5.

⚠️ Anything that is not `type: "messageResponse"` is ignored by the response
listener. There is no peer-initiated event channel in this protocol: the server
asks, you answer. Auto-attach and recording state are therefore *reported*, not
*pushed* — see §6.

---

## 4 · The handler set — 53, not ~150

The authority is `SocketMessageMap` in `src/types/messaging.ts`: **53 message
types**, which is what a peer can ever be sent. The ~150 figure is the MCP
*tool* count; many tools are served entirely server-side or fold onto one of
these 53.

**A reduced handler set is accepted, and an explicit unsupported error is the
right answer for the rest.** That is not a concession — rule 1 above means a
described error propagates to the calling agent as a real failure with your
text in it, which is strictly better than the silence a missing handler used to
produce.

⭐ **Implement the coordinate- and selector-based handlers, not the ref-based
ones.** `browser_click`, `browser_type`, `browser_hover`, `browser_drag` and
`browser_select_option` all take `{element, ref}` — refs minted by our aria
snapshot machinery, which is a large chunk of extension code. A WebView peer
should instead implement:

| message | payload | notes |
|---|---|---|
| `browser_navigate` | `{url, tabTarget?}` | |
| `browser_screenshot` | `{tabTarget?}` | |
| `browser_realistic_click` | `{x, y, button?, clickCount?, moveFirst?, moveDuration?}` | coordinates, no ref needed |
| `browser_realistic_type` | `{text, selector?, tabTarget?}` | |
| `browser_evaluate` | `{expression, tabTarget?}` | the lever that makes a thin peer useful |
| `browser_get_visible_text` | `{selector?, maxLength?, tabTarget?}` | |
| `browser_list_tabs` | `{extensionId?}` or `{}` | |
| `browser_list_attached_tabs` | `{live?}` or `{}` | called at registration |
| `browser_ensure_attached` | `{tabId, label, autoOpenUrl}` | **this is the create-a-tab path** |
| `browser_go_back` / `browser_go_forward` | `{tabTarget?}` | |
| `browser_press_key` | `{key, tabTarget?}` | |
| `browser_scroll` | `{x?, y?, tabTarget?, extensionId?}` | |
| `browser_wait` | `{time}` | |

⚠️ **There is no `browser_create_tab` or `browser_close_tab` in the socket map.**
Creation goes through `browser_ensure_attached` with `autoOpenUrl` set. Do not
invent message names: an unrecognised type from us would be a server change, and
one from you would be ignored.

⚠️ `browser_evaluate`'s argument is `expression`, not `code`, and the tab
argument is `tabTarget`, not `tabId`. The schemas strip unknown keys silently,
so a misnamed field is dropped and you get a plausible wrong answer with no
error.

---

## 5 · Concurrency

⛔ **One peer is one socket, and two drivers starve each other.** The
concurrency ceiling in this system is per-peer, not per-agent. A phone is worse
than a desktop here: one WebView, one main thread, a screen that may be off.
Serialise work per tab and let the 30 s timeout be the backpressure, rather than
running six agents' requests at once and timing all of them out.

---

## 6 · Auto-attach and always-recording: whose state is it?

**Yours, and the server reads it.** Three reasons, all in the code above:

1. There is no peer-initiated event channel (§3). You cannot push a state change
   even if you wanted to.
2. The server already treats a peer's answer about its own state as
   authoritative and records it **verbatim** rather than inferring it — see the
   watch registry, where `armed` is the peer's raw answer and `null` means
   "never reported", explicitly not false (`src/server.ts:177-182`). Reporting a
   row the peer is not actually holding is the exact fail-quiet that design
   guards against.
3. Attachment lifetime is already owned by the connection: a disconnect ends
   every attachment the peer held, and every watch with it
   (`src/server.ts:536-541`).

⇒ On the phone, "every tab I open is attached and recording from the first
frame" is a property of the Slipway shell. The server's job is to ask
(`browser_list_attached_tabs`, `browser_get_session_recording_state`) and to
believe the answer. ⛔ Do not build a server-side mirror of it that can disagree
with the phone — a signal that fails toward "healthy" is the expensive kind.

---

## 7 · How a peer is labelled

`Context.describeExtension` derives a `kind` and a human label from the
registration meta plus the server-captured address. ⛔ **Adding a new kind for a
phone peer is an external-contract change** — other seats match on kind and on
how many of each exist, and `alpaca`'s signup broke exactly this way when office
went from 1 to 17 extensions. Tell the affected seats before adding one, not
after.

---

## 8 · What is already built on this side

`src/slipway.ts` (868 lines) and `src/tools/slipway.ts` serve the **"There"**
half: a tokened session page that lets the phone drive the *house* browsers.
Write surface is exactly three nginx-allowed paths,
`POST /f/up-<32hex>/{tap,text,done}` — a new action is a FIELD on `text`, never
a new path, and an unknown `cmd` returns 400 by name so shell/server skew fails
loudly.

The **"Here"** half — a browser on the phone that the fleet drives — is what
this protocol is for, and it is not built yet.

---

## 9 · The Android side, and who owns which part

`super-agent`'s shell `com.superagent.slipway` is the starting point and is
**already installed on the operator's phone** (they measured it with `list_apps`
against `phone_ben` on 2026-10-13; `list_apps` reports presence and not version,
so "0.1.1 build 2" is by elimination — it is the only build ever published).

**Working tree: `/mnt/nas/data/code/super-agent`, module `android/slipway`,
commits `b95da3b` (milestone A) and `80518c1` (finished-link handling), both on
`main`.** ⚠️ That repo has ~184 unpushed commits, so there is no remote to read
— read the NAS working tree directly. Nothing uncommitted, no branches.

**The split, confirmed by Ben in Slack #super-agent at 15:14 EDT 2026-10-13
(ts `1791918842.755449`, answering this seat's own ask):** `super-agent` keeps
the APK build, the signing key and the OTA `slipway` channel — hand them a
commit and they build, sign and publish. This seat owns the browser, this
protocol and the driving half. ⛔ The install itself still needs the operator's
go at the moment of install and he taps the prompt himself; auto-confirm failed
on a normal install there on 2026-10-13.

Their `docs/slipway.md` records four Android traps already paid for: non-null
`onNewIntent` on compileSdk 35, manual insets on the root view, a cleartext
allowlist limited to `192.168.1.199` and `192.168.1.168`, and ⛔ no
`addJavascriptInterface` anywhere — *Here* loads the open web, and that API
exposes a Kotlin object to every script in the page. When the driving half needs
a channel into a page, it gets one bound to a page we serve.

### The puppet path, for a watched session only

`super-agent`'s AccessibilityService drives real Chrome through
`POST /api/v1/agent/execute` on `192.168.1.168:8800` — `tap`, `swipe`, `type`,
`open_url`, `launch_app`, `screenshot`, `dump_ui`. The `phone` MCP is the
intended interface for other seats and was **ECONNREFUSED all day 2026-10-13**
(measured here at session start and independently by `super-agent`); until it is
fixed, the call routes through them, and they do not hand out the master key.

⛔ Two non-negotiable constraints on that path: `screenshot` is request-only and
never scheduled, and `dump_ui` surfaces whatever is on the operator's screen —
it put personal content in front of `super-agent` on the morning of 2026-10-13.
Watched sessions only.
