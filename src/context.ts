import { readFileSync } from "fs";

import { WebSocket } from "ws";

import { mcpConfig } from "@/config/mcp.config";
import {
  MessagePayload,
  MessageType,
  SocketMessageMap,
} from "@/types/messaging";
import { createSocketMessageSender } from "@/utils/messaging-sender";

const noConnectionMessage = `No connection to browser extension. In order to proceed, you must first connect a tab by clicking the Browser MCP extension icon in the browser toolbar and clicking the 'Connect' button.`;

/**
 * Per-extension connection record. Each registered extension gets one entry.
 * `extensionId` is supplied by the extension on register (stable across reconnects
 * for the same Chrome profile + extension install). `tabIds` is the live set of
 * tabs the extension has attached debuggers to, populated/updated via the
 * TAB_ATTACHED / TAB_DETACHED notifications. `meta` carries human-readable hints
 * (host Chrome vs container Xvfb chromium, profile name, hostname) for surfacing
 * in browser_list_attached_tabs and for tools that target by profile.
 */
export interface ExtensionConn {
  extensionId: string;
  ws: WebSocket;
  tabIds: Set<number>;
  meta: {
    profileName?: string;
    hostname?: string;
    userAgent?: string;
    // The BROWSER's address, captured server-side at registration and resolved
    // past a trusted reverse proxy (rightmost X-Forwarded-For). This is the ONE
    // identity fact that needs no cooperation from the extension, and it is the
    // one that separates a container from a desktop: a sidecar chromium
    // connects from the docker bridge (172.x), ben's own Chrome from loopback
    // or the office LAN address.
    remoteAddress?: string;
    // The immediate socket peer. Differs from remoteAddress ONLY when the
    // connection came through a trusted proxy, in which case this is the
    // proxy. ⛔ Do not use it for identity — until 2026-08-17 remoteAddress
    // held THIS value for proxied extensions, and the resulting label named
    // server4's NIC as if it were Laura's MacBook.
    peerAddress?: string;
    viaProxy?: boolean;
  };
  registeredAt: number;
}

/**
 * The container's own default-gateway IP, read once from /proc/net/route.
 *
 * ⚠️ THIS IS THE WHOLE DISCRIMINATOR, and getting it wrong is why the first
 * version of describeExtension() mislabelled ben's Chrome as a container.
 * When this server runs in docker, a connection from a process on the HOST
 * arrives SNAT'd as the bridge gateway (e.g. 172.27.0.1), while a sibling
 * container arrives as its own address on the same subnet (172.27.0.3).
 * Both are "in the docker range", so the range alone cannot tell a desktop
 * browser from a sidecar — it labels the host as a container, which is
 * exactly backwards from what the caller needs to know.
 *
 * Returns undefined off-Linux or if /proc is unreadable; callers must treat
 * that as "cannot tell" rather than as either answer.
 */
let _cachedGateway: string | null | undefined;
function dockerGatewayIp(): string | undefined {
  if (_cachedGateway !== undefined) return _cachedGateway ?? undefined;
  try {
    // /proc/net/route: the default route has Destination 00000000. Gateway is
    // a little-endian hex u32.
    // ⚠️ A top-level import, NOT require(): package.json is "type": "module"
    // and tsup emits ESM, so `require` is not defined at runtime — and tsup
    // does not typecheck, so that would have shipped as a green build and
    // thrown only when an extension registered.
    const txt = readFileSync("/proc/net/route", "utf8");
    for (const line of txt.split("\n").slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length > 2 && f[1] === "00000000") {
        const hex = f[2];
        const octets = [6, 4, 2, 0].map((i) => parseInt(hex.slice(i, i + 2), 16));
        if (octets.every((o) => Number.isFinite(o))) {
          _cachedGateway = octets.join(".");
          return _cachedGateway;
        }
      }
    }
  } catch { /* not linux, or /proc unavailable */ }
  _cachedGateway = null;
  return undefined;
}

/** A caller-facing description of WHICH browser an extensionId refers to. */
export interface ExtensionIdentity {
  extensionId: string;
  label: string;
  kind: "container-sidecar" | "local-desktop" | "docker-host-desktop" | "lan-remote" | "unknown";
  platform?: string;
  profileName?: string;
  hostname?: string;
  remoteAddress?: string;
  /** The proxy the connection arrived through, when it did. Never identity. */
  peerAddress?: string;
  viaProxy?: boolean;
  connectedForMs: number;
  tabCount: number;
}

export class Context {
  private _ws: WebSocket | undefined;
  private _activeTabId: number | null = null;
  // Multi-extension pool. Key is the extension's stable extensionId.
  private _extensions = new Map<string, ExtensionConn>();
  // Reverse-lookup: tabId → extensionId, so a tool call carrying tabTarget
  // can be routed to the right extension without walking the whole pool.
  private _tabToExtension = new Map<number, string>();
  // Every extensionId seen since this process started, INCLUDING ones that have
  // since disconnected. Without this, `unregisterExtensionById` erases the fact
  // that a browser ever existed, and "the extension is dead" becomes
  // byte-identical to "there was never such an extension".
  //
  // That cost a full day on 2026-08-06: ben's Chrome (`default`) crashed on
  // 8/5 and Chrome disabled the extension. The server silently kept serving the
  // two OTHER browsers still connected. Agents probed those, found Amazon
  // genuinely signed out on them, and reported "Amazon is logged out" — while
  // ben's Amazon session was fine the whole time. The browser we needed was
  // ABSENT, not broken, and nothing in any response said so.
  // `shopping` reported `default` missing and it was explained away as
  // extension-id rotation, because nothing could distinguish the two.
  private _seenExtensions = new Map<string, { lastSeenAt: number; firstSeenAt: number }>();

  // Ring of recent DISCONNECTS, with the close code and how long the socket
  // had been up.
  //
  // ⚠️ This exists because every instrument we had for "the extension died"
  // lived INSIDE the extension — the global error listeners, the
  // chrome.storage.local persistence, all of it. When Chrome tears the
  // extension down, the instrument goes with it, so we were trying to read the
  // black box from inside the crash. Ben has now had to hand-click Reload at
  // least three times (08-12, 08-14, 08-15) and asked, fairly, why it keeps
  // happening and why it isn't fixed. The honest answer was that each previous
  // fix addressed something ADJACENT — a stale reservation, an id rotation, an
  // un-aimable reload tool — all of which a reload also cures, so each looked
  // like the fix from outside.
  //
  // The server is the one component that observes the death and SURVIVES it.
  // Recording the close code here is the first evidence that outlives the
  // patient: 1000/1001 is an orderly close (Chrome shutting the worker down),
  // 1006 is an abnormal drop with no close frame. Those imply very different
  // causes and we have never once known which we were looking at.
  private _disconnects: Array<{
    extensionId: string;
    label?: string;
    kind?: string;
    remoteAddress?: string;
    at: number;
    connectedMs: number;
    code?: number;
    reason?: string;
  }> = [];
  private static readonly MAX_DISCONNECT_LOG = 50;

  /** Record a disconnect. Called from the ws close handler, before unregister. */
  recordDisconnect(entry: {
    extensionId: string;
    label?: string;
    kind?: string;
    remoteAddress?: string;
    connectedMs: number;
    code?: number;
    reason?: string;
  }): void {
    this._disconnects.push({ ...entry, at: Date.now() });
    if (this._disconnects.length > Context.MAX_DISCONNECT_LOG) {
      this._disconnects.splice(0, this._disconnects.length - Context.MAX_DISCONNECT_LOG);
    }
  }

  /** Recent disconnects, newest last. */
  getDisconnects(): ReadonlyArray<Context["_disconnects"][number]> {
    return this._disconnects;
  }

  /** Which extension owns this socket, if any. Needed to name a dying ws. */
  findExtensionIdByWs(ws: WebSocket): string | undefined {
    for (const [id, conn] of this._extensions) {
      if (conn.ws === ws) return id;
    }
    return undefined;
  }

  get ws(): WebSocket {
    if (!this._ws) {
      throw new Error(noConnectionMessage);
    }
    return this._ws;
  }

  set ws(ws: WebSocket) {
    this._ws = ws;
  }

  hasWs(): boolean {
    return !!this._ws;
  }

  /** Register / re-register an extension. Returns the canonical connection record. */
  registerExtension(extensionId: string, ws: WebSocket, meta: ExtensionConn["meta"] = {}): ExtensionConn {
    const prior = this._extensions.get(extensionId);
    const tabIds = prior?.tabIds ?? new Set<number>();
    const conn: ExtensionConn = { extensionId, ws, tabIds, meta: { ...prior?.meta, ...meta }, registeredAt: Date.now() };
    this._extensions.set(extensionId, conn);
    const seen = this._seenExtensions.get(extensionId);
    this._seenExtensions.set(extensionId, {
      firstSeenAt: seen?.firstSeenAt ?? Date.now(),
      lastSeenAt: Date.now(),
    });
    // Keep _ws pointing at the most-recently-registered extension for backward
    // compat with any code path that still touches it directly.
    this._ws = ws;
    return conn;
  }

  /** Remove an extension by id. Also clears any tabs the extension owned. */
  unregisterExtensionById(extensionId: string): void {
    const conn = this._extensions.get(extensionId);
    if (!conn) return;
    for (const tabId of conn.tabIds) this._tabToExtension.delete(tabId);
    this._extensions.delete(extensionId);
    // Leave the _seenExtensions tombstone in place and stamp when we lost it.
    // This is the whole point: a disconnected browser must stay VISIBLE as
    // something that used to be here, or callers silently retarget the
    // survivors and report findings about the wrong browser.
    const seen = this._seenExtensions.get(extensionId);
    if (seen) seen.lastSeenAt = Date.now();
    // If the dropped extension was the legacy default, pick another (first in map).
    if (this._ws === conn.ws) {
      const next = this._extensions.values().next();
      this._ws = next.done ? undefined : next.value.ws;
    }
  }

  /** Remove whatever extension owns a given WebSocket (used on `ws.close`). */
  unregisterExtensionByWs(ws: WebSocket): void {
    for (const [id, conn] of this._extensions) {
      if (conn.ws === ws) {
        this.unregisterExtensionById(id);
        return;
      }
    }
  }

  /** Look up an extension by id. */
  getExtension(extensionId: string): ExtensionConn | undefined {
    return this._extensions.get(extensionId);
  }

  /**
   * Describe WHICH browser an extensionId actually is, in terms a caller can
   * act on.
   *
   * Ben, 2026-08-11: "you need to make it easier for agents to know which
   * browse they are driving." That morning `agents` spent an hour debugging an
   * incognito refusal in a container chromium while believing it was ben's
   * desktop Chrome, and sent him to toggle a Chrome setting twice — in a
   * browser that was never in play. Nothing in any response distinguished the
   * two: the ids are opaque UUIDs and every listing returned bare strings.
   *
   * ⚠️ `kind` is INFERRED from the peer address, not asserted by the browser.
   * A private-range peer is *consistent with* a container and does not prove
   * one. It is a strong hint printed next to the raw evidence, deliberately —
   * two of us burned an hour on probes whose confounds were invisible
   * (host `ps` also lists container processes; a container's `localhost` is
   * its own). Show the address so the reader can disagree with the label.
   */
  describeExtension(extensionId: string): ExtensionIdentity | undefined {
    const conn = this._extensions.get(extensionId);
    if (!conn) return undefined;
    const { profileName, hostname, userAgent, remoteAddress, peerAddress, viaProxy } = conn.meta;

    const platform = userAgent
      ? (/Macintosh|Mac OS X/.test(userAgent) ? "macOS"
        : /Windows/.test(userAgent) ? "Windows"
        : /CrOS/.test(userAgent) ? "ChromeOS"
        : /Linux/.test(userAgent) ? "Linux"
        : undefined)
      : undefined;

    // Docker bridge ranges. Loopback means the browser is on the same host as
    // this server; anything else on the LAN is a different machine.
    const addr = remoteAddress ?? "";
    const isLoopback = addr === "127.0.0.1" || addr === "::1" || addr === "localhost";
    const isDockerBridge = /^(172\.1[6-9]\.|172\.2\d\.|172\.3[01]\.)/.test(addr);
    // ⚠️ Order matters and the gateway case MUST come first. A browser running
    // on the docker host arrives as the bridge gateway, which is inside the
    // docker range — so testing the range first labels ben's own Chrome a
    // container. Caught within a minute of shipping the range-only version,
    // and only because the raw peer address is printed beside the inference.
    const gateway = dockerGatewayIp();
    const isDockerHost = !!gateway && addr === gateway;
    const kind: ExtensionIdentity["kind"] =
      isLoopback ? "local-desktop"
      : isDockerHost ? "docker-host-desktop"
      : isDockerBridge ? "container-sidecar"
      : addr ? "lan-remote"
      : "unknown";

    // Prefer the most specific human handle available. profileName is set by
    // browser_launch_isolated_chrome, so a sidecar usually names itself.
    const bits = [
      kind === "container-sidecar" ? "container chromium (sidecar)"
        : kind === "local-desktop" ? "desktop browser on this host"
        : kind === "docker-host-desktop" ? "desktop browser on the docker HOST (not a container)"
        // ⛔ For a proxied connection do NOT put an address in the label at
        // all unless the extension told us its hostname. `addr` is now the
        // real client, but a NAT'd machine still reports the NAT address, and
        // a bare IP in a human-readable label gets quoted onward as though it
        // identified the machine — which is exactly what happened with
        // 192.168.0.109 for two days. Say "remote browser" and let the reader
        // ask, rather than handing them a number that reads like an answer.
        : kind === "lan-remote"
          ? (hostname ? `browser on ${hostname}` : viaProxy ? "remote browser (via proxy — address not identifying)" : `browser on ${addr}`)
        : "unidentified browser",
      profileName ? `profile "${profileName}"` : undefined,
      platform,
    ].filter(Boolean);

    return {
      extensionId,
      label: bits.join(" · "),
      kind,
      platform,
      profileName,
      hostname,
      remoteAddress: remoteAddress || undefined,
      peerAddress: peerAddress && peerAddress !== remoteAddress ? peerAddress : undefined,
      viaProxy: viaProxy || undefined,
      connectedForMs: Date.now() - conn.registeredAt,
      tabCount: conn.tabIds.size,
    };
  }

  /** Describe every currently-registered extension. */
  describeExtensions(): ExtensionIdentity[] {
    return Array.from(this._extensions.keys())
      .map((id) => this.describeExtension(id))
      .filter((d): d is ExtensionIdentity => !!d);
  }

  /** Iterate every registered extension. */
  listExtensions(): ExtensionConn[] {
    return Array.from(this._extensions.values());
  }

  /**
   * Extensions this process has seen that are NOT currently connected.
   * An empty pool and a pool whose browsers have all died look identical
   * without this — see the `_seenExtensions` note above.
   */
  listAbsentExtensions(): Array<{ extensionId: string; lastSeenAt: number }> {
    const absent: Array<{ extensionId: string; lastSeenAt: number }> = [];
    for (const [id, seen] of this._seenExtensions) {
      if (!this._extensions.has(id)) absent.push({ extensionId: id, lastSeenAt: seen.lastSeenAt });
    }
    return absent;
  }

  /** Human-readable "and by the way, these are missing" suffix for errors. */
  private _absentSuffix(): string {
    const absent = this.listAbsentExtensions();
    if (absent.length === 0) return "";
    const parts = absent.map((a) => {
      const mins = Math.round((Date.now() - a.lastSeenAt) / 60000);
      const ago = mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
      return `${a.extensionId} (last seen ${ago})`;
    });
    return (
      ` ⚠️ ALSO SEEN THIS SESSION BUT CURRENTLY ABSENT: ${parts.join(", ")}. ` +
      `An absent extension means that browser is closed, or Chrome disabled/crashed its extension ` +
      `(chrome://extensions will show a Reload button). If the browser you actually want is in that ` +
      `list, DO NOT reason about the ones still connected — you would be measuring a different browser.`
    );
  }

  /** Mark a tab as owned by an extension (called from TAB_ATTACHED handler). */
  recordTabOwner(tabId: number, extensionId: string): void {
    const conn = this._extensions.get(extensionId);
    if (!conn) return;
    conn.tabIds.add(tabId);
    this._tabToExtension.set(tabId, extensionId);
  }

  /**
   * Rebuild one extension's routing entries by ASKING it what it has attached.
   *
   * ⛔ THE ROUTING MAP DOES NOT SURVIVE A SERVER RESTART, BUT THE TABS DO.
   * _tabToExtension is populated only by TAB_ATTACHED, which extensions send
   * once at attach time. It lives in this process's memory; the attached tabs
   * live in the browsers. So a :9010 restart empties the map while every tab
   * stays attached and healthy — and with more than one browser connected,
   * wsFor() then resolves no owner for a tabTarget and throws "Multiple
   * extensions are connected (N)…". That error tells the caller their call is
   * ambiguous at a moment when nothing about their call changed, and it fires
   * for every seat holding a tab by label, all at once.
   *
   * Recovering by having each seat re-attach by hand only works if something
   * tells them to, and nothing did. Asking the extension is better than waiting
   * to be told: browser_list_attached_tabs is answered from the extension's own
   * TabManager, needs no attached tab, and — unlike the matching extension-side
   * re-announce — works against extension builds ALREADY RUNNING, so it repairs
   * the restart that deploys it rather than the one after.
   *
   * Best-effort by construction: failure leaves the map exactly as empty as it
   * would have been, and recordTabOwner() is a Map set, so racing a genuine
   * TAB_ATTACHED for the same tab is a no-op rather than a conflict.
   */
  async rebuildTabOwnership(extensionId: string): Promise<number> {
    const conn = this._extensions.get(extensionId);
    if (!conn) return 0;
    const { sendSocketMessage } = createSocketMessageSender<SocketMessageMap>(conn.ws);
    const result: any = await sendSocketMessage(
      "browser_list_attached_tabs" as any,
      {} as any,
      { timeoutMs: 10000 },
    );
    const tabs: any[] = Array.isArray(result?.tabs) ? result.tabs : [];
    let recovered = 0;
    for (const t of tabs) {
      if (typeof t?.tabId === "number") {
        this.recordTabOwner(t.tabId, extensionId);
        recovered++;
      }
    }
    return recovered;
  }

  /** Clear a tab's owner (called from TAB_DETACHED or extension disconnect). */
  forgetTabOwner(tabId: number): void {
    const owner = this._tabToExtension.get(tabId);
    if (!owner) return;
    this._tabToExtension.delete(tabId);
    const conn = this._extensions.get(owner);
    if (conn) conn.tabIds.delete(tabId);
  }

  /**
   * Resolve the right WebSocket for an outgoing tool call.
   * - Explicit `extensionId` param → use that extension's ws.
   * - `tabTarget` (numeric tabId, OR a label that the extension recorded with
   *    its tab announcements) → look up owner, use that ws.
   * - Fallback when there's exactly one registered extension → use it.
   * - Otherwise → throw a descriptive error listing the available extensions.
   */
  wsFor(opts: { extensionId?: string; tabTarget?: number | string } = {}): WebSocket {
    if (opts.extensionId) {
      const conn = this._extensions.get(opts.extensionId);
      if (!conn) {
        const available = Array.from(this._extensions.keys()).join(", ") || "(none)";
        const seen = this._seenExtensions.get(opts.extensionId);
        if (seen) {
          // Distinguish "you named a browser that DIED" from "you named a
          // browser that never existed". These used to be the same message.
          const mins = Math.round((Date.now() - seen.lastSeenAt) / 60000);
          const ago = mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
          throw new Error(
            `Extension "${opts.extensionId}" was registered but is GONE (last seen ${ago}). ` +
            `That browser is closed, or Chrome disabled/crashed its extension — chrome://extensions ` +
            `will show a Reload button. This is NOT the same as a wrong id. ` +
            `Do not fall back to another extension and report findings from it: that is a different browser ` +
            `with different logins. Still registered: ${available}.`,
          );
        }
        throw new Error(
          `Unknown extensionId "${opts.extensionId}" — never seen by this server. Registered: ${available}.` +
          this._absentSuffix(),
        );
      }
      return conn.ws;
    }
    if (opts.tabTarget != null && opts.tabTarget !== "") {
      // Numeric tabTarget: direct lookup
      if (typeof opts.tabTarget === "number") {
        const owner = this._tabToExtension.get(opts.tabTarget);
        if (owner) return this._extensions.get(owner)!.ws;
      }
      // String tabTarget: a numeric string, or a label. For numeric strings,
      // try the number; for labels, walk the pool — extensions track labels
      // internally, so we let `wsFor` fall through to the single-pool fallback
      // below; the extension will resolve the label on its own.
      if (typeof opts.tabTarget === "string" && /^\d+$/.test(opts.tabTarget)) {
        const owner = this._tabToExtension.get(parseInt(opts.tabTarget, 10));
        if (owner) return this._extensions.get(owner)!.ws;
      }
    }
    // No explicit target. If there's exactly one extension, that's the default.
    // (This preserves backward compat for single-extension setups.)
    if (this._extensions.size === 1) {
      return this._extensions.values().next().value!.ws;
    }
    if (this._extensions.size === 0) {
      if (this._ws) return this._ws; // legacy direct-assigned ws
      // "Nothing connected" reads as "never set up" unless we say otherwise.
      throw new Error(noConnectionMessage + this._absentSuffix());
    }
    // Ambiguous: more than one extension is registered AND we don't know which
    // one owns the target. Surface the situation so the caller can pick.
    // Message is prescriptive so an agent whose MCP client may have a stale
    // schema (no extensionId field cached) has a fallback path: attach to a
    // tab first, then route by tabTarget instead of extensionId.
    const ids = Array.from(this._extensions.keys());
    // Name the browsers, don't just list their UUIDs. This message fires at the
    // exact moment a caller has to CHOOSE one, and until 2026-08-11 it offered
    // three opaque ids with nothing to choose between them — so callers picked
    // arbitrarily and then debugged the wrong machine. (Ben: "you need to make
    // it easier for agents to know which browse they are driving.")
    const described = ids
      .map((id) => {
        const d = this.describeExtension(id);
        return d ? `  · ${id} — ${d.label}${d.remoteAddress ? ` [peer ${d.remoteAddress}]` : ""}` : `  · ${id}`;
      })
      .join("\n");
    throw new Error(
      `Multiple extensions are connected (${ids.length}). To target a specific browser, ` +
      `EITHER pass extensionId on this call — the connected browsers are:\n${described}\n` +
      `OR first attach to a tab (browser_list_tabs → browser_attach_tab({tabId} or {autoOpenUrl})) ` +
      `and then pass tabTarget=<tabId-or-label> on subsequent calls — the server routes attached tabs to their owning extension automatically. ` +
      `If your MCP client's tool schema doesn't show extensionId, refresh it via /mcp (or session respawn).` +
      // ⚠️ Load-bearing: on 2026-08-06 this message listed the two surviving
      // browsers and said nothing about the third having died. Agents picked
      // from the list it offered, which is exactly what a list implies is
      // complete. The absent ones belong in the same breath as the present.
      this._absentSuffix(),
    );
  }

  /**
   * Get the currently active (last-used) tab ID
   * Note: With multi-tab support, this only tracks the most recently used tab
   */
  get activeTabId(): number | null {
    return this._activeTabId;
  }

  /**
   * Ensure debugger is attached to a tab (lazy attachment with multi-tab support)
   *
   * @param tabId - Optional tab ID to attach to
   * @param label - Optional label to identify the tab (alternative to tabId)
   * @param autoOpenUrl - Optional URL to open if no tabs are attached
   * @returns Object with tabId and label of the attached tab
   */
  async ensureAttached(options?: {
    tabId?: number;
    label?: string;
    autoOpenUrl?: string;
    extensionId?: string;
  }): Promise<{ tabId: number; label: string }> {
    // Forward both extensionId AND a routing-equivalent tabTarget into
    // sendSocketMessage's wsFor() — without the tabTarget, the multi-extension
    // disambiguation throws "Multiple extensions are connected" even when the
    // tab IS in the tabId→extension map. Bug surfaced 2026-06-04 by finance
    // calling execute_macro({tabTarget:1980049709}) without extensionId — the
    // execute_macro handler calls ensureAttachedFromParams BEFORE sending the
    // actual macro, so the pre-flight ensure_attached was hitting wsFor with
    // neither field and failing fast.
    const tabTarget = options?.tabId ?? options?.label;
    const result = await this.sendSocketMessage("browser_ensure_attached", {
      tabId: options?.tabId ?? null,
      label: options?.label ?? null,
      autoOpenUrl: options?.autoOpenUrl ?? null,
    }, { extensionId: options?.extensionId, tabTarget });

    // Update our cached active tab ID (for backwards compatibility)
    this._activeTabId = result.tabId;

    return result;
  }

  /**
   * Convenience wrapper: take a raw params blob (post-zod-parse), extract the
   * routing-relevant fields (extensionId, tabTarget), and call ensureAttached
   * with the right options. Lets handlers avoid the boilerplate of pulling
   * fields out individually — they just `await context.ensureAttachedFromParams(validatedParams)`.
   */
  async ensureAttachedFromParams(params: any): Promise<{ tabId: number; label: string }> {
    const tabTarget = params?.tabTarget;
    return this.ensureAttached({
      extensionId: params?.extensionId,
      tabId: typeof tabTarget === "number" ? tabTarget : undefined,
      label: typeof tabTarget === "string" ? tabTarget : undefined,
    });
  }

  async sendSocketMessage<T extends MessageType<SocketMessageMap>>(
    type: T,
    payload: MessagePayload<SocketMessageMap, T>,
    options: { timeoutMs?: number; extensionId?: string; tabTarget?: number | string } = {},
  ) {
    const ws = this.wsFor({
      extensionId: options.extensionId ?? (payload as any)?.extensionId,
      tabTarget: options.tabTarget ?? (payload as any)?.tabTarget,
    });
    const { sendSocketMessage } = createSocketMessageSender<SocketMessageMap>(ws);
    try {
      return await sendSocketMessage(type, payload, { timeoutMs: options.timeoutMs ?? 30000 });
    } catch (e) {
      if (e instanceof Error && e.message === mcpConfig.errors.noConnectedTab) {
        throw new Error(noConnectionMessage);
      }
      throw e;
    }
  }

  /**
   * Broadcast a message to every registered extension and return per-extension
   * results. Used for aggregate queries like browser_list_attached_tabs where
   * the answer is "everything every connected extension is aware of."
   */
  async broadcastSocketMessage<T extends MessageType<SocketMessageMap>>(
    type: T,
    payload: MessagePayload<SocketMessageMap, T>,
    options: { timeoutMs?: number } = {},
  ): Promise<Array<{ extensionId: string; result?: any; error?: string }>> {
    const out: Array<{ extensionId: string; result?: any; error?: string }> = [];
    const extensions = this.listExtensions();
    // Fall back to legacy single-ws when no explicit registrations exist yet —
    // covers the case where the extension is connected but EXTENSION_REGISTER
    // didn't include an id (very old builds).
    if (extensions.length === 0 && this._ws) {
      try {
        const { sendSocketMessage } = createSocketMessageSender<SocketMessageMap>(this._ws);
        const result = await sendSocketMessage(type, payload, { timeoutMs: options.timeoutMs ?? 30000 });
        return [{ extensionId: "default", result }];
      } catch (e: any) {
        return [{ extensionId: "default", error: e?.message ?? String(e) }];
      }
    }
    await Promise.all(extensions.map(async (conn) => {
      try {
        const { sendSocketMessage } = createSocketMessageSender<SocketMessageMap>(conn.ws);
        const result = await sendSocketMessage(type, payload, { timeoutMs: options.timeoutMs ?? 30000 });
        out.push({ extensionId: conn.extensionId, result });
      } catch (e: any) {
        out.push({ extensionId: conn.extensionId, error: e?.message ?? String(e) });
      }
    }));
    return out;
  }

  async close() {
    if (!this._ws) {
      return;
    }
    await this._ws.close();
  }
}
