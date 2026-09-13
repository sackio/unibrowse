# Connecting a browser from off-LAN

How a browser outside the house reaches this server, and the two ways it fails
while looking like it should work.

Everything below was measured on 2026-09-13 against Laura's work MacBook (macOS,
corporate VPN, off-LAN) and the office server. Where something is NOT established,
it says so.

## The shape

A remote browser reaches us through nginx on the public host, not on `:9010`:

| | |
|---|---|
| HTTP | `https://browser.pushbuild.com` |
| WebSocket | `wss://browser.pushbuild.com/ws?key=<api key>` |

The server classifies clients by address. nginx forces a `203.0.113.1`
remoteAddress (TEST-NET-3) on public traffic so it classifies REMOTE, and the
policy `lan-open-remote-required` then requires an API key from it. ⛔ That forcing
is a security control that fails toward OPEN — see memo `33ff3f8b` before touching
it or `UNIBROWSE_TRUSTED_PROXIES`.

⛔ **The API key travels as a QUERY PARAMETER on the WebSocket, never a header.**
Browsers cannot set headers on a WebSocket handshake, so `withKey()` in
`extension/utils/server-resolver.js` appends `?key=…`. Only HTTP calls use
`Authorization: Bearer <key>`. Nothing else is required of a remote client — no
origin header, no client id.

## ⛔ Failure mode 1 — config.js is read ONCE PER PROFILE, EVER

`extension/config.js` is consulted only inside `ensureSeeded()`, which opens with:

```js
const raw = await readRaw();
if (raw.servers.length > 0) return;     // ← early return
```

It seeds `chrome.storage.local.unibrowse_servers` on a profile that has none, and
is never read again. After that the live target is the storage registry
(`unibrowse_servers` + `unibrowse_default_server_id`), plus a per-tab binding in
`chrome.storage.session`.

⇒ **Reading config.js on a machine tells you nothing about where that browser
actually connects.** Editing it on a profile that has already run changes nothing,
silently. On 2026-09-13 config.js correctly read `wss://browser.pushbuild.com/ws`
with a valid key while the extension was dialling `localhost:9010` and failing.

**Discriminator** — run in any extension page's console:

```js
chrome.storage.local.get(['unibrowse_servers','unibrowse_default_server_id'], console.log)
```

**Fix**: the extension's Options page, never a file edit. Set the default server's
`serverUrl` to `https://browser.pushbuild.com` with the key.

⚠️ **Set `serverUrl`, not just `wsUrl`.** Four call sites in `background.js` do
`cfg.httpUrl || 'http://localhost:9010'`, including the upload leg of
`browser_fetch_to_server`. An entry carrying only a `wsUrl` connects, looks
healthy, and then POSTs every fetched file to localhost **on the browser's own
machine**. Leaving `wsUrl` blank is safe and preferred: `deriveWsFromHttp()` turns
an `https://` serverUrl into `wss://<host>/ws`.

## ⛔ Failure mode 2 — the service-worker script is cached in the profile

Swapping files in the extension directory does not evict the running MV3 service
worker. A reconnect is not a reload: the worker keeps its cached script across
server restarts and WebSocket reconnects.

⚠️ **Popup and options pages ARE re-read from disk on every open.** So a file swap
can leave a NEW popup talking to an OLD worker, which presents as *"message channel
closed before a response was received"* and reads as an unrelated bug. That is
worse than plain staleness because it looks like something else.

**Discriminator** — ask the server, not the popup. A green dot in the popup does
not establish which script is running; calling a tool added after the worker
started does:

```
Unknown message type: <tool name>     ⇒ still the old script
```

**What evicts it, on a desktop profile:**

| lever | result |
|---|---|
| ↻ on the unibrowse card at `chrome://extensions`, on-disk script changed | ✅ **evicts** — measured 2026-09-13, macOS |
| full Chrome restart + manifest version bump, on-disk script changed | ❌ fails — measured 2026-09-07, macOS |
| ↻ with the on-disk script unchanged | untested, and not worth testing |

⭐ **↻ is the remedy.** The 2026-09-13 measurement is tight: same Chrome process
(PID unchanged, 47-day uptime), `manifest.json` byte-identical and still `1.0.1`
(diffed against a pre-change backup), no quit — and the worker came back running
the new script, proven by a tool added after it started answering successfully.

⚠️ **Changed-vs-identical bytes is NOT the discriminator**, though it looks like an
attractive one. The 2026-09-07 files had changed too: Chrome re-read `manifest.json`
to `1.0.2` and went on executing the cached `background.js` anyway. What separates
the two results is the lever, not the bytes.

A fresh `browser_launch_isolated_chrome` also works, but that is a NEW browser with
a NEW profile — a different case, and it does not transfer to an existing one.

⛔ **Never call `browser_reload_extension`** to fix this. It strands every browser
kind, not just containers — memo `52ab66c1`.

⛔ **Never Remove + re-add the unpacked extension.** `manifest.json` carries no
`key`, so the extension id is derived from the load path, and `chrome.storage`
holds the server registry and API key. Removing loses the config and changes the
id the server addresses that browser by.

## Verifying, in the order that isolates faults

**1. HTTP reaches us** — from the remote machine:

```bash
curl -sS https://browser.pushbuild.com/health
```

Expect `200` with `policy: lan-open-remote-required`, `authRequired: true`,
`isLocalClient: false`. ⚠️ This is the same path the Options page's *Test* button
uses, so passing it says nothing about the WebSocket.

**2. The WebSocket route and the key are good** — from the remote machine:

```bash
curl -sS -i -N --http1.1 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  "https://browser.pushbuild.com/ws?key=<key>"
```

Expect `101 Switching Protocols`.

⛔ **`--http1.1` is required.** Without it curl negotiates HTTP/2 and the request
returns `404` — which reads exactly like a wrong route or a rejected key, and is
neither.

**3. The server actually saw it** — on office:

```bash
docker compose logs --since 10m mcp-server | grep -iE 'WebSocket|registered|DISCONNECTED'
```

⭐ **Zero lines is the informative result.** No successes *and* no auth rejections
means the client never reached us, which rules out both the key and the route and
points at the extension dialling somewhere else — i.e. failure mode 1.

## Getting updated extension code onto an off-LAN machine

⛔ There is no automated path, and both obvious routes are closed: `/install/extension.zip`
is `401` off-LAN, and its bundled `config.js` points at `localhost:9010` anyway;
`unibrowse-mac-extension-sync.sh` targets only `192.168.1.215` over LAN SSH and is
commented out of crontab.

What works is a private ATC file link (`/mnt/nas/data/code/atc/atc-files/atc-send-file`)
and hands on the machine. ⛔ Pack the tree **excluding `config.js`** so extracting
over an existing install cannot clobber that machine's settings, and extract on top
of the directory rather than replacing it.
