import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createSender } from "@/tools/send-to-agent";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { WebSocketServer, WebSocket } from "ws";

import { Context } from "@/context";
import type { Resource } from "@/resources/resource";
import type { Tool } from "@/tools/tool";
import { stripIPv4Mapped, getEffectiveClientIP } from "@/utils/auth";
import {
  handleWatchFired,
  onExtensionGone,
  onTabGone,
  onWatchDocumentChanged,
  rearmForExtension,
  recordArmedFromExtension,
  rehydrateWatches,
  startWatchExpiry,
} from "@/watch/service";
import { createWebSocketServer } from "@/ws";

type Options = {
  name: string;
  version: string;
  tools: Tool[];
  resources: Resource[];
  wss?: WebSocketServer; // Optional WebSocketServer
};

// Shared context for all servers (WebSocket and HTTP)
// Exported so the HTTP layer can expose connection/disconnection state at
// GET /extensions. That endpoint is deliberately readable WITHOUT a working
// extension — it is the only view of "the browser died" that survives the
// browser dying. http-server imports from here already; there is no cycle.
/**
 * ⛔ Base URL the RECIPIENT will fetch a parked body from — not this process's
 * bind address. Inside the compose network that is the service name; override
 * with UNIBROWSE_PUBLIC_URL if a recipient lives outside it, or oversized
 * sends will hand out a URL only this container can resolve.
 */
const sendToAgent = createSender({
  selfBaseUrl: process.env.UNIBROWSE_PUBLIC_URL || "http://mcp-server:9010",
});

export const globalContext = new Context();

/**
 * The human label the server publishes for an extensionId, or undefined.
 *
 * ⚠️ Best-effort by design. An extension can share a tab in the moment its own
 * registration is being re-minted (a service-worker restart does exactly
 * that), and a share that arrives with no label is still a perfectly good
 * share — the LABEL of the tab is the handle, not this. So a miss omits the
 * line rather than failing the send.
 */
function describeExtensionLabel(extensionId: string): string | undefined {
  if (!extensionId) return undefined;
  try {
    return globalContext.describeExtensions().find((e) => e.extensionId === extensionId)?.label;
  } catch {
    return undefined;
  }
}

// MCP `instructions` field — surfaced to clients via the initialize handshake.
// Documents the multi-agent shared-server model that confused several callers
// (ha, shopping, storybook all hit it in one day). Agents that read this on
// connect will know that "multiple extensions" isn't a fault but the normal
// shape, and have a clear recovery path before they trip into the error.
const MULTI_AGENT_INSTRUCTIONS = `Unibrowse is a multi-agent browser MCP server.

Multiple extensions may be connected at once (e.g. ben's host Chrome plus container chromiums spawned by browser_launch_isolated_chrome for isolated work). Multiple agents share the server simultaneously.

Routing model:
- Each extension has a stable extensionId — find them via browser_list_attached_tabs (response.extensions array) or the return value of browser_launch_isolated_chrome.
- Pin a specific extension by passing extensionId on every tool call. This is the explicit path.
- Alternatively, attach a tab first (browser_attach_tab with autoOpenUrl or tabId) — the server records tabId→extensionId so subsequent calls with tabTarget alone route to the right extension automatically.
- When only one extension is connected, no routing fields are required (single-extension fallback). Multi-extension mode requires either extensionId or an attached tabTarget.

Tab reservations (multi-agent etiquette):
- Pass agent:"<your name>" on browser_create_tab/browser_attach_tab to reserve a tab to yourself; other agents calling control tools on it will get a tab-reserved error.
- Pass takeover:true when you genuinely need to claim a tab from a dead agent.
- Use browser_list_attached_tabs to see who owns what (response.tabs[].reservation).

If a tool errors with "Multiple extensions are connected" it includes a prescriptive recovery path: pass extensionId, or attach a tab and use tabTarget. If your MCP client's tool schema doesn't show extensionId, your client cached tools/list before the schema bump — refresh with /mcp or session respawn.`;

// Create server with WebSocket for browser extension
export async function createServerWithTools(options: Options): Promise<Server> {
  const { name, version, tools, resources, wss: providedWss } = options;
  // Reap ttl-expired watches. Idempotent, and unref'd so it never holds the
  // process open.
  startWatchExpiry();
  // Bring watch subscriptions back after a restart. Loaded as armed:unknown —
  // the re-push on EXTENSION_REGISTER below is what actually arms them.
  void rehydrateWatches();
  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions: MULTI_AGENT_INSTRUCTIONS,
    } as any,
  );

  // Helper to handle WebSocket messages manually (browser extension uses custom protocol)
  async function handleBrowserMessage(ws: WebSocket, message: any) {
    const { id, type, payload } = message;

    // Handle extension registration. The extension supplies a stable
    // `extensionId` (UUID it generated on first run and stored in
    // chrome.storage.local) plus optional meta (profileName / hostname /
    // userAgent). When multiple extensions are connected (e.g. ben's main
    // Chrome + a container chromium spawned by browser_launch_isolated_chrome),
    // each one is tracked independently so tool calls can be routed to the
    // right one — see Context.wsFor().
    if (type === 'EXTENSION_REGISTER') {
      const extensionId = (payload?.extensionId as string)
        || (message?.wsId as string)               // older message shape
        || `legacy-${Math.random().toString(36).slice(2, 10)}`;
      const meta = {
        profileName: payload?.profileName as string | undefined,
        hostname: payload?.hostname as string | undefined,
        userAgent: payload?.userAgent as string | undefined,
        // The BROWSER's address. Captured server-side, so it is available even
        // for an extension too old to report anything about itself, and it is
        // what tells a container chromium apart from a desktop Chrome — see
        // Context.describeExtension. Resolved past a trusted proxy at
        // connection time (see the wss "connection" handler); falls back to the
        // raw peer when there was no upgrade request to read, which is the old
        // behaviour and correct for every direct LAN/loopback connection.
        remoteAddress: ((ws as any).__clientIp as string | undefined)
          || stripIPv4Mapped(String((ws as any)?._socket?.remoteAddress || ""))
          || undefined,
        // The PROXY's address, kept separately so a reader can still see the
        // path a connection took and can disagree with the inference above.
        // ⚠️ Never merge these two back into one field: the whole defect was
        // that one field was answering two different questions.
        peerAddress: (ws as any).__peerIp as string | undefined,
        viaProxy: (ws as any).__viaProxy as boolean | undefined,
      };
      globalContext.registerExtension(extensionId, ws, meta);
      console.log(`[Server] Extension registered: extensionId=${extensionId} profile=${meta.profileName ?? '-'} totalConnected=${globalContext.listExtensions().length}`);
      // Ack back so the extension knows its registered identity.
      try {
        ws.send(JSON.stringify({ type: 'EXTENSION_REGISTER_ACK', payload: { extensionId } }));
      } catch { /* best-effort */ }
      // Ask this extension what it already has attached, and re-record the
      // ownership the restart erased. See Context.rebuildTabOwnership — without
      // this, every seat holding a tab by label gets "Multiple extensions are
      // connected" after a server restart, blaming the caller for a map that
      // this process dropped. Deliberately not awaited: registration must not
      // block on it, and a failure leaves the map no worse than before.
      void globalContext.rebuildTabOwnership(extensionId)
        .then((n) => {
          if (n > 0) console.log(`[Server] Rebuilt tab ownership for ${extensionId}: ${n} tab(s)`);
        })
        .catch((e) => console.log(`[Server] Tab-ownership rebuild for ${extensionId} failed (non-fatal): ${e?.message ?? e}`));

      // Re-push this extension's watches, for exactly the reason above: the
      // extension may have been evicted and re-woken, or this process may have
      // restarted, and a watch the server still lists but the extension is not
      // holding is the fail-quiet the whole design guards against.
      //
      // ⛔ The extension's answer is recorded VERBATIM — never inferred. A
      // registry that reports armed because it holds a row is the isActive bug
      // (memo 9fb367c0) under a new name.
      // Verify page-home watches against the document they were created for
      // before re-arming any of them. Deliberately not awaited inline — the
      // registration must not block on it.
      void rearmForExtension(extensionId, async (tabId: number) => {
        // ⛔ EVALUATE IN THE PAGE. Both browser_list_attached_tabs AND getUrl
        // return tabInfo.url — the URL captured when the tab was ATTACHED,
        // never updated on navigation. Verifying against either compares two
        // copies of the same stale value, which is why this guard passed a
        // test where the tab had demonstrably navigated. location.href is the
        // only source that reflects where the tab actually is.
        const res: any = await globalContext.sendSocketMessage(
          "browser_evaluate",
          { expression: "location.href", tabTarget: tabId },
          { extensionId, tabTarget: tabId, timeoutMs: 8000 },
        );
        const raw = typeof res === "string" ? res : (res?.result ?? res?.value);
        return typeof raw === "string" ? raw.replace(/^"|"$/g, "") : undefined;
      })
        .then(({ specs, dropped }) => {
          if (dropped.length > 0) {
            console.log(`[Watch] ${dropped.length} page watch(es) cleared as document-changed`);
          }
          if (specs.length === 0) return;
          ws.send(JSON.stringify({
            id: `watch-rearm-${Date.now()}`,
            type: 'browser_watch_rearm',
            payload: { specs },
          }));
          console.log(`[Watch] re-pushed ${specs.length} watch(es) to ${extensionId}`);
          // ⛔ Then ASK the extension what it is actually holding, and record
          // that. The re-push is fire-and-forget, so without this round trip
          // every rehydrated watch would sit at armed:unknown forever — honest,
          // but needlessly uninformative when the answer is one call away.
          return recordArmedFromExtension(extensionId, async () => {
            const res: any = await globalContext.sendSocketMessage(
              "browser_watch_list_armed",
              {},
              { extensionId, timeoutMs: 8000 },
            );
            return (res?.watches ?? []) as Array<{ watchId: string; armed: boolean }>;
          });
        })
        .catch((e) => console.log(`[Watch] re-push to ${extensionId} failed (non-fatal): ${e?.message}`));
      return;
    }

    // The popup's "send to agent" button. Unsolicited, like WATCH_FIRED, and
    // handled HERE rather than in the extension for the same reason: the
    // extension must never make an outbound call to a third party.
    if (type === 'SEND_TO_AGENT') {
      const p = (payload ?? {}) as Record<string, unknown>;
      const kind = (p.kind as 'content' | 'tab' | 'recording') ?? 'content';
      // ⛔ Build the input per kind rather than spreading the payload. The
      // extension is the only sender today, but this is a websocket frame:
      // spreading it would let any field the extension happens to carry —
      // cookies, auth headers, a whole tab record — ride into an outbound
      // message to a third party. Name every field that crosses.
      // ⛔ The note crosses the same named-field boundary as everything else —
      // it is the one field a human typed, and it is the reason this is not a
      // spread. See the comment above.
      const note = p.note ? String(p.note) : undefined;
      // A recording riding along with a tab share. Named field by field for the
      // same reason: the extension builds this object, and only these five keys
      // may reach a third party.
      const r = (p.recording ?? null) as Record<string, unknown> | null;
      const rideAlong =
        r && r.recordingId
          ? {
              recordingId: String(r.recordingId),
              partial: r.partial !== false,
              durationMs: typeof r.durationMs === 'number' ? r.durationMs : undefined,
              eventCount: typeof r.eventCount === 'number' ? r.eventCount : undefined,
              reviewUrl: r.reviewUrl ? String(r.reviewUrl) : undefined,
            }
          : undefined;
      const share =
        kind === 'tab'
          ? {
              kind: 'tab' as const,
              to: String(p.to ?? ''),
              note,
              recording: rideAlong,
              label: String(p.label ?? ''),
              url: String(p.url ?? ''),
              title: p.title ? String(p.title) : undefined,
              tabId: typeof p.tabId === 'number' ? p.tabId : undefined,
              extensionId: p.extensionId ? String(p.extensionId) : undefined,
              // ⭐ The extension does not know its own human label — the server
              // derives it (kind + platform + address). Fill it here so the
              // recipient can tell WHICH browser they were handed, without the
              // extension having to mirror a naming scheme it does not own.
              extensionLabel: describeExtensionLabel(String(p.extensionId ?? '')),
            }
          : kind === 'recording'
            ? {
                kind: 'recording' as const,
                to: String(p.to ?? ''),
                note,
                recordingId: String(p.recordingId ?? ''),
                title: p.title ? String(p.title) : undefined,
                startUrl: p.startUrl ? String(p.startUrl) : undefined,
                durationMs: typeof p.durationMs === 'number' ? p.durationMs : undefined,
                reviewUrl: p.reviewUrl ? String(p.reviewUrl) : undefined,
                pageCount: typeof p.pageCount === 'number' ? p.pageCount : undefined,
              }
            : {
                to: String(p.to ?? ''),
                note,
                url: String(p.url ?? ''),
                title: p.title ? String(p.title) : undefined,
                content: String(p.content ?? ''),
                format: (p.format as 'markdown' | 'html' | 'text') ?? 'markdown',
                scope: String(p.scope ?? 'page'),
              };
      void sendToAgent(share).then((result) => {
        // ⛔ Report the OUTCOME back to the extension so the popup can show it.
        // Without this the button would go green on "we posted it", which is
        // not the same as "it was delivered" — the failure this whole module
        // exists to make visible.
        try {
          ws.send(JSON.stringify({
            id: `send-to-agent-${Date.now()}`,
            type: 'SEND_TO_AGENT_RESULT',
            payload: { requestId: p.requestId ?? null, ...result },
          }));
        } catch { /* popup may be gone; the log below is the record */ }
        console.log(
          `[SendToAgent] ${kind} -> ${p.to}: ok=${result.ok} sent=${result.sent}` +
          (result.detail ? ` detail=${result.detail}` : ''),
        );
      });
      return;
    }

    // A page watch refused to re-inject because its tab navigated away from
    // the document it was created against. Unsolicited, like WATCH_FIRED.
    if (type === 'WATCH_DOCUMENT_CHANGED') {
      const p = (payload ?? {}) as Record<string, unknown>;
      onWatchDocumentChanged(String(p.watchId ?? ''), {
        was: p.was as string | undefined,
        now: p.now as string | undefined,
      });
      return;
    }

    // A watch matched in the extension. Unsolicited — no request is waiting on
    // it. Everything the caller configured (sink, once, rate accounting) is
    // applied here, on the server, because the extension must never hold a
    // webhook credential or make an outbound call to a third party.
    if (type === 'WATCH_FIRED') {
      void handleWatchFired(
        (payload ?? {}) as Record<string, unknown>,
        (watchId) => {
          try {
            ws.send(JSON.stringify({
              id: `watch-disarm-${Date.now()}`,
              type: 'browser_watch_disarm',
              payload: { watchId },
            }));
          } catch { /* best-effort */ }
        },
      ).catch((e) => console.log(`[Watch] handleWatchFired failed: ${e?.message ?? e}`));
      return;
    }

    // Extensions announce attached tabs so the server can route tabTarget-bound
    // tool calls to the right WebSocket without round-tripping to every
    // extension. Sent in pairs around TabManager.attachTab/detachTab.
    if (type === 'TAB_ATTACHED' || type === 'TAB_DETACHED') {
      let extensionId = (payload?.extensionId as string) || (message?.wsId as string);
      // Defensive fallback for two cases:
      //   1. extensionId missing — container chromium's SW didn't complete
      //      ensureExtensionId before TabManager.attachTab fired.
      //   2. extensionId set but doesn't match any registered extension —
      //      split-brain bug where background SW's ensureExtensionId and
      //      offscreen's first-run mint generated DIFFERENT UUIDs in a
      //      write-write race on chrome.storage.local. The extension
      //      registered with one (via offscreen's EXTENSION_REGISTER) but
      //      announces tabs with the other (background's self.__unibrowseExtensionId).
      // In both cases the inbound ws unambiguously identifies the sender —
      // each ws maps to exactly one registered extension. Trust the ws.
      if (!extensionId || !globalContext.getExtension(extensionId)) {
        for (const conn of globalContext.listExtensions()) {
          if (conn.ws === ws) {
            if (extensionId && extensionId !== conn.extensionId) {
              console.log(`[Server] TAB_${type === 'TAB_ATTACHED' ? 'ATTACHED' : 'DETACHED'}: split-brain detected, payload claimed ${extensionId} but ws owner is ${conn.extensionId}`);
            }
            extensionId = conn.extensionId;
            break;
          }
        }
      }
      const tabId = payload?.tabId as number;
      if (tabId != null && extensionId) {
        if (type === 'TAB_ATTACHED') {
          // Keep the label too — it is what callers are told to prefer, and
          // wsFor() can now route on it. See Context.extensionsForLabel.
          globalContext.recordTabOwner(tabId, extensionId, payload?.label as string | undefined);
          console.log(`[Server] TAB_ATTACHED: tab=${tabId} ext=${extensionId}`);
        } else {
          globalContext.forgetTabOwner(tabId);
          console.log(`[Server] TAB_DETACHED: tab=${tabId} ext=${extensionId}`);
          // Ben's lifetime rule: watches are cleared when the attachment ends.
          onTabGone(extensionId, tabId);
        }
      }
      return;
    }

    // If message type is 'messageResponse', it's a response from the extension (not a request)
    // The tool communication system will handle these via the message listener
    if (type === 'messageResponse') {
      // These are handled by the addSocketMessageResponseListener in messaging-sender.ts
      return;
    }

    // If no type at all, it's invalid
    if (!type) {
      console.warn(`[Server] Message without type field: ${JSON.stringify(message)}`);
      return;
    }

    console.log(`[Server] Handling tool request: ${type} (id: ${id})`);

    try {
      // Find the matching tool
      const tool = tools.find((t) => t.schema.name === type);
      if (!tool) {
        console.warn(`[Server] Unknown tool: ${type}`);
        ws.send(JSON.stringify({ id, error: `Unknown tool: ${type}` }));
        return;
      }

      // Execute the tool
      const toolResult = await tool.handle(globalContext, payload || {});

      // Send response in messageResponse format (for test clients)
      ws.send(JSON.stringify({
        type: 'messageResponse',
        payload: {
          requestId: id,
          result: toolResult
        }
      }));
    } catch (error) {
      console.error(`[Server] Tool execution error:`, error);
      ws.send(JSON.stringify({
        type: 'messageResponse',
        payload: {
          requestId: id,
          error: String(error)
        }
      }));
    }
  }

  // Track multiple WebSocket connections
  const connections = new Set<WebSocket>();

  // Use provided WebSocketServer or create a new one
  const wss = providedWss || await createWebSocketServer();
  wss.on("connection", (websocket, request?: any) => {
    // ⛔ RESOLVE THE CLIENT BEHIND THE PROXY, AT CONNECTION TIME.
    //
    // The raw socket peer is NOT the browser's address whenever the extension
    // arrives through the public reverse proxy (browser.pushbuild.com → nginx
    // on server4 → here). In that case the peer is server4's LAN NIC, and
    // describeExtension() then labelled the connection "browser on
    // 192.168.0.109" — naming the PROXY as though it were the machine.
    //
    // That is not cosmetic. On 2026-08-17 `genomics` had been reporting
    // 192.168.0.109 to ben for two days as Laura's MacBook's address and
    // comparing it against a real IP for his own machine; neither of them
    // could have caught it, because the tool states it as fact. I repeated the
    // same claim to them from my own notes. `kind` is inferred from this
    // address too, so a proxied desktop browser gets labelled `lan-remote`
    // purely as an artifact of how it reached us.
    //
    // getEffectiveClientIP() already knows how to do this (rightmost XFF when
    // the peer is a trusted proxy) — it was simply never applied here. Stash
    // it on the socket now, because the upgrade request is not in scope inside
    // handleBrowserMessage where EXTENSION_REGISTER is handled.
    // ⛔ AND CONSULT X-FORWARDED-FOR ONLY FOR AN EXPLICITLY-CONFIGURED PROXY.
    //
    // getEffectiveClientIP() trusts the whole docker-bridge range, which is
    // correct where it was written (auth gating) and WRONG here. Identity is a
    // different security question: trusting the bridge means any container can
    // set X-Forwarded-For and choose its own `remoteAddress` — and therefore
    // its own `kind`, which claude-login-auto gates on. Before this code
    // existed, `kind` derived from the socket peer, which cannot be forged.
    // I introduced that regression and `agents` surfaced it by asking whether
    // the re-inference could change what their allowlist sees.
    //
    // So: gate on UNIBROWSE_TRUSTED_PROXIES membership only. That is the set
    // that actually fronts browser.pushbuild.com (192.168.0.109 = server4's
    // NIC, 192.168.1.168), which is the case this exists for, and it leaves
    // every direct LAN/loopback/bridge connection deriving identity from the
    // unspoofable peer exactly as before.
    //
    // ⛔ NOTE THE COUPLING, because it is not obvious from here: that same env
    // var is a SECURITY control for auth classification, not just an identity
    // hint. Emptying it silently reclassifies all public traffic as LAN and
    // exposes /mcp. Read EXTRA_TRUSTED_PROXIES in src/utils/auth.ts before
    // touching the value — and do NOT "fix" the 203.0.113.1 that appears as a
    // remoteAddress for proxied browsers. It is a deliberate TEST-NET-3
    // placeholder nginx writes because the border router SNATs the real client
    // away; replacing it with a "real" address sends a PRIVATE one and breaks
    // the remote classification. I called it a defect to `agents` on
    // 2026-08-17 before reading the config; it is the opposite.
    try {
      if (request) {
        const peer = stripIPv4Mapped(String((websocket as any)?._socket?.remoteAddress || ""));
        const configured = new Set(
          (process.env.UNIBROWSE_TRUSTED_PROXIES || "")
            .split(",")
            .map((s) => stripIPv4Mapped(s.trim()))
            .filter(Boolean),
        );
        const effective = configured.has(peer)
          ? stripIPv4Mapped(getEffectiveClientIP(request))
          : peer;
        (websocket as any).__clientIp = effective || undefined;
        (websocket as any).__peerIp = peer || undefined;
        (websocket as any).__viaProxy = !!effective && !!peer && effective !== peer;
      }
    } catch { /* best-effort: identity degrades to the peer, never throws */ }

    console.log("[Server] New WebSocket connection established");
    connections.add(websocket);
    console.log(`[Server] Total active connections: ${connections.size}`);

    // NOTE: We don't store this connection in globalContext.ws yet!
    // The extension will send an EXTENSION_REGISTER message to identify itself,
    // and only that connection will be stored in globalContext.ws.
    // This prevents external clients (like test scripts) from overwriting the extension connection.

    // Handle incoming messages
    websocket.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleBrowserMessage(websocket, message);
      } catch (error) {
        console.error("[Server] Error parsing message:", error);
      }
    });

    websocket.on("close", (code?: number, reason?: Buffer) => {
      // ⚠️ Identify and RECORD the dying extension BEFORE unregistering it —
      // describeExtension() reads the live connection record, so after
      // unregisterExtensionByWs() there is nothing left to name it with. The
      // old handler logged the bare string "WebSocket connection closed",
      // which is why three separate disappearances of ben's Chrome left no
      // evidence about which browser had gone or how.
      const dyingId = globalContext.findExtensionIdByWs(websocket);
      if (dyingId) {
        // Ben's lifetime rule again: an extension disconnect ends every
        // attachment it held, so it ends every watch too. Done here, while the
        // id is still resolvable, for the same reason the identity is.
        onExtensionGone(dyingId);
        const ident = globalContext.describeExtension(dyingId);
        const conn = globalContext.getExtension(dyingId);
        const connectedMs = conn ? Date.now() - conn.registeredAt : 0;
        const reasonText = reason?.toString?.() || undefined;
        globalContext.recordDisconnect({
          extensionId: dyingId,
          label: ident?.label,
          kind: ident?.kind,
          remoteAddress: ident?.remoteAddress,
          connectedMs,
          code,
          reason: reasonText,
        });
        // Close code is the single most diagnostic field and we have never
        // captured it: 1000/1001 mean Chrome closed the socket deliberately
        // (worker shutdown), 1006 means the socket vanished with no close
        // frame at all. Those point at completely different causes.
        console.log(
          `[Server] Extension DISCONNECTED: ${dyingId} kind=${ident?.kind ?? "unknown"} ` +
          `addr=${ident?.remoteAddress ?? "?"} afterMs=${connectedMs} ` +
          `code=${code ?? "none"} reason=${reasonText || "(none)"}`,
        );
      } else {
        console.log("[Server] WebSocket connection closed (no extension registered on it)");
      }
      connections.delete(websocket);
      console.log(`[Server] Total active connections: ${connections.size}`);

      // Drop any extension registration this ws owned, plus its tab ownership.
      globalContext.unregisterExtensionByWs(websocket);

      // Backward compat: if this was the legacy primary ws, clear it too.
      if (globalContext.hasWs() && globalContext.ws === websocket) {
        console.log("[Server] Primary extension ws closed, clearing globalContext.ws");
        globalContext.ws = undefined as any;
      }
    });

    websocket.on("error", (error) => {
      console.error("[Server] WebSocket error:", error);
    });
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools.map((tool) => tool.schema) };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: resources.map((resource) => resource.schema) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((tool) => tool.schema.name === request.params.name);
    if (!tool) {
      return {
        content: [
          { type: "text", text: `Tool "${request.params.name}" not found` },
        ],
        isError: true,
      };
    }

    try {
      const result = await tool.handle(globalContext, request.params.arguments);
      return result;
    } catch (error) {
      return {
        content: [{ type: "text", text: String(error) }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find(
      (resource) => resource.schema.uri === request.params.uri,
    );
    if (!resource) {
      return { contents: [] };
    }

    const contents = await resource.read(globalContext, request.params.uri);
    return { contents };
  });

  server.close = async () => {
    await server.close();
    await wss.close();
    await globalContext.close();
  };

  return server;
}

// Create server WITHOUT WebSocket (for SSE connections)
export async function createServerWithoutWebSocket(options: Options): Promise<Server> {
  const { name, version, tools, resources } = options;
  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools.map((tool) => tool.schema) };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: resources.map((resource) => resource.schema) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((tool) => tool.schema.name === request.params.name);
    if (!tool) {
      return {
        content: [
          { type: "text", text: `Tool "${request.params.name}" not found` },
        ],
        isError: true,
      };
    }

    try {
      const result = await tool.handle(globalContext, request.params.arguments);
      return result;
    } catch (error) {
      return {
        content: [{ type: "text", text: String(error) }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find(
      (resource) => resource.schema.uri === request.params.uri,
    );
    if (!resource) {
      return { contents: [] };
    }

    const contents = await resource.read(globalContext, request.params.uri);
    return { contents };
  });

  return server;
}
