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
  meta: { profileName?: string; hostname?: string; userAgent?: string };
  registeredAt: number;
}

export class Context {
  private _ws: WebSocket | undefined;
  private _activeTabId: number | null = null;
  // Multi-extension pool. Key is the extension's stable extensionId.
  private _extensions = new Map<string, ExtensionConn>();
  // Reverse-lookup: tabId → extensionId, so a tool call carrying tabTarget
  // can be routed to the right extension without walking the whole pool.
  private _tabToExtension = new Map<number, string>();

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

  /** Iterate every registered extension. */
  listExtensions(): ExtensionConn[] {
    return Array.from(this._extensions.values());
  }

  /** Mark a tab as owned by an extension (called from TAB_ATTACHED handler). */
  recordTabOwner(tabId: number, extensionId: string): void {
    const conn = this._extensions.get(extensionId);
    if (!conn) return;
    conn.tabIds.add(tabId);
    this._tabToExtension.set(tabId, extensionId);
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
        throw new Error(`Unknown extensionId "${opts.extensionId}". Registered: ${available}`);
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
      throw new Error(noConnectionMessage);
    }
    // Ambiguous: more than one extension is registered AND we don't know which
    // one owns the target. Surface the situation so the caller can pick.
    // Message is prescriptive so an agent whose MCP client may have a stale
    // schema (no extensionId field cached) has a fallback path: attach to a
    // tab first, then route by tabTarget instead of extensionId.
    const ids = Array.from(this._extensions.keys());
    throw new Error(
      `Multiple extensions are connected (${ids.length}). To target a specific browser, ` +
      `EITHER pass extensionId (one of: ${ids.join(", ")}) on this call, ` +
      `OR first attach to a tab (browser_list_tabs → browser_attach_tab({tabId} or {autoOpenUrl})) ` +
      `and then pass tabTarget=<tabId-or-label> on subsequent calls — the server routes attached tabs to their owning extension automatically. ` +
      `If your MCP client's tool schema doesn't show extensionId, refresh it via /mcp (or session respawn).`,
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
