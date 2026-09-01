import {
  createWebSocketServer,
  getEffectiveClientIP,
  mcpConfig,
  stripIPv4Mapped
} from "./chunk-YYZQZXP6.js";

// src/config/app.config.ts
var appConfig = {
  name: "unibrowse",
  tagline: "Bridging the gap between AI agents and browser automation",
  description: "unibrowse connects AI applications to your browser, bridging the gap between AI agents and browser automation. Supported by Claude, Cursor, VS Code, Windsurf, and more.",
  email: {
    defaultFrom: "support@unibrowse.local"
  }
};

// src/tools/send-to-agent.ts
var DEFAULT_ATC_URL = "http://192.168.1.168:3030";
var ATC_URL = process.env.UNIBROWSE_ATC_URL || DEFAULT_ATC_URL;
var INLINE_CONTENT_LIMIT = 200 * 1024;
var NOTE_LIMIT = 2e3;
var parked = /* @__PURE__ */ new Map();
var PARK_TTL_MS = 6 * 60 * 60 * 1e3;
function parkContent(id, entry) {
  parked.set(id, { ...entry, at: Date.now() });
  const cutoff = Date.now() - PARK_TTL_MS;
  for (const [k, v] of parked) if (v.at < cutoff) parked.delete(k);
}
function getParked(id) {
  const e = parked.get(id);
  if (!e) return null;
  if (Date.now() - e.at > PARK_TTL_MS) {
    parked.delete(id);
    return null;
  }
  return e;
}
async function fetchDestinations(fetchImpl = fetch) {
  const res = await fetchImpl(`${ATC_URL}/destinations`);
  if (!res.ok) throw new Error(`ATC /destinations returned HTTP ${res.status}`);
  const body = await res.json();
  return body.destinations ?? [];
}
function head(what) {
  return `This is from unibrowse \u2014 ${what}
`;
}
function renderNote(note) {
  const n = (note ?? "").trim();
  if (!n) return "";
  const safe = n.slice(0, NOTE_LIMIT).replace(/^(--- end note ---)$/gim, " $1");
  const truncated = n.length > NOTE_LIMIT ? `
[note truncated at ${NOTE_LIMIT} characters]` : "";
  return `
--- note from the sender ---
${safe}${truncated}
--- end note ---
`;
}
function renderContentShare(input, parkedUrl) {
  const h = head(input.scope === "selection" ? "a selection from:" : "the page at:") + `${input.url}
` + (input.title ? `Title: ${input.title}
` : "");
  if (parkedUrl) {
    return `${h}${renderNote(input.note)}
The content was too large to send inline (${input.content.length} bytes as ${input.format}).
Fetch it here \u2014 plain GET, no auth:
${parkedUrl}

\u26A0\uFE0F That URL is served from unibrowse's mcp-server and expires in 6 hours.`;
  }
  return `${h}${renderNote(input.note)}
--- ${input.format} ---
${input.content}`;
}
function renderTabRecording(rec) {
  if (!rec || !rec.recordingId) return "";
  const id = JSON.stringify(rec.recordingId);
  const head2 = `

\u2B50 HOW THE TAB GOT HERE \u2014 a recording came with it.

  browser_get_recording({ recordingId: ${id} })
` + (rec.reviewUrl ? `  Replay (for a human): ${rec.reviewUrl}
` : "");
  if (!rec.partial) {
    return head2 + `
\u26A0\uFE0F Metadata only by default. Pass includeEvents:true \u2014 and a filter \u2014 when
   you actually need the stream, or it will fill your context with frames.`;
  }
  return head2 + `
\u26D4 THIS IS A SNAPSHOT OF A RECORDING THAT IS STILL RUNNING. It was cut at
   the moment of the share (${humanDuration(rec.durationMs)} in${rec.eventCount != null ? `, ${rec.eventCount} rrweb events` : ""}) and it will
   NEVER GROW. The sender's recorder carried on and saves separately when
   they stop it \u2014 so an unfinished-looking flow at the end of this one is
   the cut, not the truth about what they did.
\u26D4 NO VIDEO in it. Tab video is one continuous encode and cannot be split
   without ending the capture, which would stop the sender's recording.
   You have DOM (rrweb), network and interactions.
\u26A0\uFE0F Metadata only by default. Pass includeEvents:true \u2014 and a filter \u2014 when
   you actually need the stream, or it will fill your context with frames.`;
}
function renderTabShare(input) {
  const t = JSON.stringify(input.label);
  return head("a LIVE browser tab has been shared with you.") + renderNote(input.note) + `
  Tab      ${input.label}
  URL      ${input.url}
` + (input.title ? `  Title    ${input.title}
` : "") + (input.extensionLabel ? `  Browser  ${input.extensionLabel}
` : "") + `
It is already attached \u2014 you do NOT need browser_attach_tab. Confirm with
browser_list_attached_tabs(), then drive it:

  browser_snapshot({ tabTarget: ${t} })
  browser_click({ tabTarget: ${t}, ... })

\u2B50 ADDRESS IT BY THAT LABEL, on every call.
\u26D4 Not by tabId${input.tabId != null ? ` (${input.tabId})` : ""}${input.extensionId ? ` or extensionId (${input.extensionId})` : ""} \u2014 those are
   bindings, not identity. Chrome remints the extensionId every time it
   restarts the extension's service worker, and tabIds do not survive a
   browser restart. They are printed here for diagnosis only. The label
   survives both, and routing refuses to guess when one is ambiguous.

\u26A0\uFE0F SHARED, NOT HANDED OVER. The sender is working this tab too.
   Nobody has reserved it \u2014 do not call browser_reserve_tab on it, do not
   detach it, and do not close it. If you need it to yourself for a few
   steps, ask them first.` + renderTabRecording(input.recording);
}
function humanDuration(ms) {
  if (!ms || ms < 0) return "unknown";
  const s = Math.round(ms / 1e3);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
function renderRecordingShare(input) {
  const id = JSON.stringify(input.recordingId);
  return head("a session recording has been shared with you.") + renderNote(input.note) + `
` + (input.title ? `  Title    ${input.title}
` : "") + `  Id       ${input.recordingId}
` + (input.startUrl ? `  Start    ${input.startUrl}
` : "") + `  Length   ${humanDuration(input.durationMs)}
` + (input.pageCount ? `  Pages    ${input.pageCount}
` : "") + `
  browser_get_recording({ recordingId: ${id} })

` + (input.reviewUrl ? `Human-viewable replay: ${input.reviewUrl}

` : "") + `\u26A0\uFE0F Recordings hold rrweb frames, network entries and interactions, and a
   long session runs to megabytes. The call above returns metadata only;
   pass includeEvents:true \u2014 and a filter \u2014 when you actually need the
   stream, or it will fill your context with replay frames.`;
}
function renderContent(input, parkedUrl) {
  if (input.kind === "tab") return renderTabShare(input);
  if (input.kind === "recording") return renderRecordingShare(input);
  return renderContentShare(input, parkedUrl);
}
function subjectFor(input) {
  if (input.kind === "tab") return `unibrowse: shared tab "${input.label}"`;
  if (input.kind === "recording") {
    return `unibrowse: shared recording ${input.title || input.recordingId}`;
  }
  return `From unibrowse: ${input.title || input.url}`;
}
function createSender(opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async function sendToAgent2(input) {
    const to = (input.to || "").trim();
    if (!to) return { ok: false, sent: 0, detail: "No recipient given." };
    try {
      const dests = await fetchDestinations(fetchImpl);
      if (dests.length && !dests.some((d) => d.id === to)) {
        const near = dests.map((d) => d.id).filter((id) => id.startsWith(to.slice(0, 3))).slice(0, 5);
        return {
          ok: false,
          sent: 0,
          detail: `"${to}" is not a registered ATC subscriber, so the broker would accept this message and never deliver it.` + (near.length ? ` Did you mean: ${near.join(", ")}?` : "")
        };
      }
    } catch (e) {
      console.warn(`[SendToAgent] destination check skipped: ${e.message}`);
    }
    if (input.kind === "tab" && !(input.label || "").trim()) {
      return {
        ok: false,
        sent: 0,
        detail: "This tab has no label, and the label is the only handle that survives a service-worker restart. Give it one before sharing."
      };
    }
    if (input.kind === "recording" && !(input.recordingId || "").trim()) {
      return { ok: false, sent: 0, detail: "No recordingId \u2014 nothing for the recipient to fetch." };
    }
    let parkedUrl;
    if ((input.kind ?? "content") === "content" && input.content.length > INLINE_CONTENT_LIMIT && opts.selfBaseUrl) {
      const c = input;
      const id = `park-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      parkContent(id, {
        body: c.content,
        format: c.format,
        title: c.title ?? "",
        url: c.url
      });
      parkedUrl = `${opts.selfBaseUrl.replace(/\/$/, "")}/shared/${id}`;
    }
    const reviewBase = opts.selfBaseUrl ? opts.selfBaseUrl.replace(/\/$/, "") : null;
    let share = input;
    if (reviewBase) {
      if (input.kind === "recording" && !input.reviewUrl) {
        share = { ...input, reviewUrl: `${reviewBase}/review/${input.recordingId}` };
      } else if (input.kind === "tab" && input.recording?.recordingId && !input.recording.reviewUrl) {
        share = {
          ...input,
          recording: {
            ...input.recording,
            reviewUrl: `${reviewBase}/review/${input.recording.recordingId}`
          }
        };
      }
    }
    const body = {
      to,
      from: input.from || "unibrowse",
      subject: subjectFor(share).slice(0, 200),
      content: renderContent(share, parkedUrl)
    };
    try {
      const res = await fetchImpl(`${ATC_URL}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        let detail = `ATC returned HTTP ${res.status}`;
        try {
          const t = await res.text();
          if (t) detail += `: ${t.slice(0, 200)}`;
        } catch {
        }
        return { ok: false, sent: 0, detail, parkedUrl };
      }
      const out = await res.json();
      const sent = out.sent ?? 0;
      if (sent === 0) {
        return {
          ok: false,
          sent: 0,
          detail: `The broker accepted the message but delivered it to nobody` + (out.drop_reason ? ` (drop_reason: ${out.drop_reason})` : "") + `. Routing is not delivery \u2014 check the recipient id.`,
          parkedUrl
        };
      }
      return { ok: true, sent, parkedUrl };
    } catch (e) {
      return { ok: false, sent: 0, detail: e.message, parkedUrl };
    }
  };
}

// src/utils/mongodb.ts
import { MongoClient } from "mongodb";
var MongoDB = class _MongoDB {
  static instance;
  client = null;
  db = null;
  connected = false;
  constructor() {
  }
  static getInstance() {
    if (!_MongoDB.instance) {
      _MongoDB.instance = new _MongoDB();
    }
    return _MongoDB.instance;
  }
  /**
   * Connect to MongoDB
   * Default: mongodb://localhost:27018/unibrowse
   */
  async connect(uri) {
    if (this.connected && this.client) {
      return;
    }
    const connectionUri = uri || process.env.MONGODB_URI || "mongodb://localhost:27018";
    const dbName = process.env.MONGODB_DB || "unibrowse";
    try {
      this.client = new MongoClient(connectionUri, {
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5e3,
        socketTimeoutMS: 45e3
      });
      await this.client.connect();
      this.db = this.client.db(dbName);
      this.connected = true;
      await this.ensureIndexes();
      console.log(`[MongoDB] Connected to ${connectionUri}/${dbName}`);
    } catch (error) {
      console.error("[MongoDB] Connection failed:", error);
      this.connected = false;
      throw error;
    }
  }
  /**
   * Ensure required indexes exist
   */
  async ensureIndexes() {
    if (!this.db) return;
    const macros = this.db.collection("macros");
    await macros.createIndex({ id: 1 }, { unique: true });
    await macros.createIndex({ site: 1, category: 1 });
    await macros.createIndex({ site: 1, name: 1 }, { unique: true });
    await macros.createIndex({ tags: 1 });
    await macros.createIndex({ createdAt: 1 });
    await macros.createIndex({ reliability: 1 });
    const recordings = this.db.collection("recordings");
    await recordings.createIndex({ id: 1 }, { unique: true });
    await recordings.createIndex({ createdAt: -1 });
    await recordings.createIndex({ tags: 1 });
    await recordings.createIndex({ title: "text", description: "text" });
    const recordingEvents = this.db.collection("recording_events");
    try {
      const existing = await recordingEvents.indexes();
      const stale = existing.find(
        (idx) => idx.unique && idx.key && idx.key.recordingId === 1 && Object.keys(idx.key).length === 1
      );
      if (stale) await recordingEvents.dropIndex(stale.name);
    } catch {
    }
    await recordingEvents.createIndex({ recordingId: 1, chunkIndex: 1 }, { unique: true });
    const watches = this.db.collection("watches");
    await watches.createIndex({ watchId: 1 }, { unique: true });
    await watches.createIndex({ extensionId: 1 });
    await watches.createIndex({ createdAt: 1 });
    console.log("[MongoDB] Indexes created successfully");
  }
  /**
   * Get macros collection
   */
  getMacrosCollection() {
    if (!this.db) {
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    return this.db.collection("macros");
  }
  /**
   * Get recordings collection
   */
  getRecordingsCollection() {
    if (!this.db) {
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    return this.db.collection("recordings");
  }
  /**
   * Get recording_events collection (rrweb events + network entries, separate to avoid 16MB doc limit)
   */
  getRecordingEventsCollection() {
    if (!this.db) {
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    return this.db.collection("recording_events");
  }
  /**
   * Get recording_annotations collection — one doc per user-drawn annotation
   * captured during a session recording. Separate collection because each doc
   * carries a base64 PNG screenshot (~100-300KB) and we want fast indexed
   * lookup by recordingId for the review UI / browser_get_recording tool.
   */
  getRecordingAnnotationsCollection() {
    if (!this.db) {
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    return this.db.collection("recording_annotations");
  }
  /**
   * Watch subscriptions collection — see src/watch/persistence.ts for what is
   * stored and, more importantly, what deliberately is not.
   */
  getWatchesCollection() {
    if (!this.db) {
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    return this.db.collection("watches");
  }
  /**
   * Check if connected
   */
  isConnected() {
    return this.connected;
  }
  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.connected = false;
      this.client = null;
      this.db = null;
      console.log("[MongoDB] Disconnected");
    }
  }
  /**
   * Health check
   */
  async ping() {
    if (!this.db) return false;
    try {
      await this.db.admin().ping();
      return true;
    } catch {
      return false;
    }
  }
};
var mongodb = MongoDB.getInstance();

// src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

// src/context.ts
import { readFileSync } from "fs";

// src/utils/messaging-sender.ts
import { WebSocket } from "ws";
var MESSAGE_RESPONSE_TYPE = "messageResponse";
function generateId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${randomStr}`;
}
function addSocketMessageResponseListener(ws, typeListener) {
  const listener = async (event) => {
    const message = JSON.parse(event.data.toString());
    if (message.type !== MESSAGE_RESPONSE_TYPE) {
      return;
    }
    await typeListener(message);
  };
  ws.addEventListener("message", listener);
  return () => ws.removeEventListener("message", listener);
}
function createSocketMessageSender(ws) {
  async function sendSocketMessage(type2, payload, options = { timeoutMs: 3e4 }) {
    const { timeoutMs } = options;
    const id = generateId();
    const message = { id, type: type2, payload };
    return new Promise((resolve2, reject) => {
      const cleanup = () => {
        removeSocketMessageResponseListener();
        ws.removeEventListener("error", errorHandler);
        ws.removeEventListener("close", cleanup);
        if (timeoutId) clearTimeout(timeoutId);
      };
      let timeoutId;
      if (timeoutMs) {
        timeoutId = setTimeout(() => {
          cleanup();
          reject(
            new Error(`WebSocket response timeout after ${timeoutMs}ms`)
          );
        }, timeoutMs);
      }
      const removeSocketMessageResponseListener = addSocketMessageResponseListener(
        ws,
        (responseMessage) => {
          const { payload: responsePayload } = responseMessage;
          if (responsePayload.requestId !== id) {
            return;
          }
          const { result, error } = responsePayload;
          if (error !== void 0 && error !== null) {
            const text = typeof error === "string" && error.trim().length > 0 ? error : `${type2} failed, but the extension reported no error detail (received ${JSON.stringify(error)}). This usually means the throw was not an Error object. If this browser is running an extension build older than 2026-08-27, reload it to get described errors.`;
            reject(new Error(text));
          } else {
            resolve2(result);
          }
          cleanup();
        }
      );
      const errorHandler = (_event) => {
        cleanup();
        reject(new Error("WebSocket error occurred"));
      };
      ws.addEventListener("error", errorHandler);
      ws.addEventListener("close", cleanup);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      } else {
        cleanup();
        reject(new Error("WebSocket is not open"));
      }
    });
  }
  return { sendSocketMessage };
}

// src/context.ts
var noConnectionMessage = `No connection to browser extension. In order to proceed, you must first connect a tab by clicking the Browser MCP extension icon in the browser toolbar and clicking the 'Connect' button.`;
var _cachedGateway;
function dockerGatewayIp() {
  if (_cachedGateway !== void 0) return _cachedGateway ?? void 0;
  try {
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
  } catch {
  }
  _cachedGateway = null;
  return void 0;
}
var Context = class _Context {
  _ws;
  _activeTabId = null;
  // Multi-extension pool. Key is the extension's stable extensionId.
  _extensions = /* @__PURE__ */ new Map();
  // Reverse-lookup: tabId → extensionId, so a tool call carrying tabTarget
  // can be routed to the right extension without walking the whole pool.
  _tabToExtension = /* @__PURE__ */ new Map();
  // tabId → the LABEL the extension announced for it. Labels are what tool
  // descriptions tell callers to prefer ("Prefer tabTarget when you have a
  // label"), yet until 2026-08-22 the server recorded only the numeric id, so a
  // non-numeric tabTarget fell straight through wsFor() to the ambiguity throw
  // whenever more than one browser was connected — i.e. following the
  // documented advice was the one thing that could not route. Kept as
  // tabId → label (not label → extension) so forgetTabOwner stays a single
  // delete and a label that moves between tabs cannot leave a stale mapping.
  _tabLabels = /* @__PURE__ */ new Map();
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
  _seenExtensions = /* @__PURE__ */ new Map();
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
  _disconnects = [];
  static MAX_DISCONNECT_LOG = 50;
  /** Record a disconnect. Called from the ws close handler, before unregister. */
  recordDisconnect(entry) {
    this._disconnects.push({ ...entry, at: Date.now() });
    if (this._disconnects.length > _Context.MAX_DISCONNECT_LOG) {
      this._disconnects.splice(0, this._disconnects.length - _Context.MAX_DISCONNECT_LOG);
    }
  }
  /** Recent disconnects, newest last. */
  getDisconnects() {
    return this._disconnects;
  }
  /** Which extension owns this socket, if any. Needed to name a dying ws. */
  findExtensionIdByWs(ws) {
    for (const [id, conn] of this._extensions) {
      if (conn.ws === ws) return id;
    }
    return void 0;
  }
  get ws() {
    if (!this._ws) {
      throw new Error(noConnectionMessage);
    }
    return this._ws;
  }
  set ws(ws) {
    this._ws = ws;
  }
  hasWs() {
    return !!this._ws;
  }
  /** Register / re-register an extension. Returns the canonical connection record. */
  registerExtension(extensionId, ws, meta = {}) {
    const prior = this._extensions.get(extensionId);
    const tabIds = prior?.tabIds ?? /* @__PURE__ */ new Set();
    const conn = { extensionId, ws, tabIds, meta: { ...prior?.meta, ...meta }, registeredAt: Date.now() };
    this._extensions.set(extensionId, conn);
    const seen = this._seenExtensions.get(extensionId);
    this._seenExtensions.set(extensionId, {
      firstSeenAt: seen?.firstSeenAt ?? Date.now(),
      lastSeenAt: Date.now()
    });
    this._ws = ws;
    return conn;
  }
  /** Remove an extension by id. Also clears any tabs the extension owned. */
  unregisterExtensionById(extensionId) {
    const conn = this._extensions.get(extensionId);
    if (!conn) return;
    for (const tabId of conn.tabIds) {
      this._tabToExtension.delete(tabId);
      this._tabLabels.delete(tabId);
    }
    this._extensions.delete(extensionId);
    const seen = this._seenExtensions.get(extensionId);
    if (seen) seen.lastSeenAt = Date.now();
    if (this._ws === conn.ws) {
      const next = this._extensions.values().next();
      this._ws = next.done ? void 0 : next.value.ws;
    }
  }
  /** Remove whatever extension owns a given WebSocket (used on `ws.close`). */
  unregisterExtensionByWs(ws) {
    for (const [id, conn] of this._extensions) {
      if (conn.ws === ws) {
        this.unregisterExtensionById(id);
        return;
      }
    }
  }
  /** Look up an extension by id. */
  getExtension(extensionId) {
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
  describeExtension(extensionId) {
    const conn = this._extensions.get(extensionId);
    if (!conn) return void 0;
    const { profileName, hostname, userAgent, remoteAddress, peerAddress, viaProxy } = conn.meta;
    const platform = userAgent ? /Macintosh|Mac OS X/.test(userAgent) ? "macOS" : /Windows/.test(userAgent) ? "Windows" : /CrOS/.test(userAgent) ? "ChromeOS" : /Linux/.test(userAgent) ? "Linux" : void 0 : void 0;
    const addr = remoteAddress ?? "";
    const isLoopback = addr === "127.0.0.1" || addr === "::1" || addr === "localhost";
    const isDockerBridge = /^(172\.1[6-9]\.|172\.2\d\.|172\.3[01]\.)/.test(addr);
    const gateway = dockerGatewayIp();
    const isDockerHost = !!gateway && addr === gateway;
    const kind = isLoopback ? "local-desktop" : isDockerHost ? "docker-host-desktop" : isDockerBridge ? "container-sidecar" : addr ? "lan-remote" : "unknown";
    const bits = [
      kind === "container-sidecar" ? "container chromium (sidecar)" : kind === "local-desktop" ? "desktop browser on this host" : kind === "docker-host-desktop" ? "desktop browser on the docker HOST (not a container)" : kind === "lan-remote" ? hostname ? `browser on ${hostname}` : viaProxy ? "remote browser (via proxy \u2014 address not identifying)" : `browser on ${addr}` : "unidentified browser",
      profileName ? `profile "${profileName}"` : void 0,
      platform
    ].filter(Boolean);
    return {
      extensionId,
      label: bits.join(" \xB7 "),
      kind,
      platform,
      profileName,
      hostname,
      remoteAddress: remoteAddress || void 0,
      peerAddress: peerAddress && peerAddress !== remoteAddress ? peerAddress : void 0,
      viaProxy: viaProxy || void 0,
      connectedForMs: Date.now() - conn.registeredAt,
      tabCount: conn.tabIds.size
    };
  }
  /** Describe every currently-registered extension. */
  describeExtensions() {
    return Array.from(this._extensions.keys()).map((id) => this.describeExtension(id)).filter((d) => !!d);
  }
  /** Iterate every registered extension. */
  listExtensions() {
    return Array.from(this._extensions.values());
  }
  /**
   * Extensions this process has seen that are NOT currently connected.
   * An empty pool and a pool whose browsers have all died look identical
   * without this — see the `_seenExtensions` note above.
   */
  listAbsentExtensions() {
    const absent = [];
    for (const [id, seen] of this._seenExtensions) {
      if (!this._extensions.has(id)) absent.push({ extensionId: id, lastSeenAt: seen.lastSeenAt });
    }
    return absent;
  }
  /** Human-readable "and by the way, these are missing" suffix for errors. */
  _absentSuffix() {
    const absent = this.listAbsentExtensions();
    if (absent.length === 0) return "";
    const parts = absent.map((a) => {
      const mins = Math.round((Date.now() - a.lastSeenAt) / 6e4);
      const ago = mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
      return `${a.extensionId} (last seen ${ago})`;
    });
    return ` \u26A0\uFE0F ALSO SEEN THIS SESSION BUT CURRENTLY ABSENT: ${parts.join(", ")}. An absent extension means that browser is closed, or Chrome disabled/crashed its extension (chrome://extensions will show a Reload button). If the browser you actually want is in that list, DO NOT reason about the ones still connected \u2014 you would be measuring a different browser.`;
  }
  /** Mark a tab as owned by an extension (called from TAB_ATTACHED handler). */
  recordTabOwner(tabId, extensionId, label) {
    const conn = this._extensions.get(extensionId);
    if (!conn) return;
    conn.tabIds.add(tabId);
    this._tabToExtension.set(tabId, extensionId);
    if (label) this._tabLabels.set(tabId, label);
  }
  /**
   * Which extensions currently hold a tab under this label?
   *
   * Returns every match, never a pick. Labels are unique WITHIN an extension
   * and nothing makes them unique across the pool — two browsers can each hold
   * a tab labelled "pushbuild.slack.com" — so collapsing a collision to one
   * answer would route a caller to a browser they did not name and report it as
   * success. That is the failure mode this file keeps re-learning (see the
   * restricted-URL retarget note in the extension's handleEnsureAttached): a
   * wrong destination reported as success costs more than an error.
   */
  extensionsForLabel(label) {
    const owners = /* @__PURE__ */ new Set();
    for (const [tabId, l] of this._tabLabels) {
      if (l !== label) continue;
      const owner = this._tabToExtension.get(tabId);
      if (owner && this._extensions.has(owner)) owners.add(owner);
    }
    return Array.from(owners);
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
  async rebuildTabOwnership(extensionId) {
    const conn = this._extensions.get(extensionId);
    if (!conn) return 0;
    const { sendSocketMessage } = createSocketMessageSender(conn.ws);
    const result = await sendSocketMessage(
      "browser_list_attached_tabs",
      {},
      { timeoutMs: 1e4 }
    );
    const tabs = Array.isArray(result?.tabs) ? result.tabs : [];
    let recovered = 0;
    for (const t of tabs) {
      if (typeof t?.tabId === "number") {
        this.recordTabOwner(t.tabId, extensionId, typeof t.label === "string" ? t.label : void 0);
        recovered++;
      }
    }
    return recovered;
  }
  /**
   * Which extension currently owns this tab, if the server knows.
   *
   * Returns undefined rather than guessing — the map is populated only by
   * TAB_ATTACHED and by rebuildTabOwnership, so "not in the map" means "not
   * recorded", never "no owner". Callers that need certainty should say which
   * extension they mean instead of treating undefined as an answer.
   */
  extensionIdForTab(tabId) {
    return this._tabToExtension.get(tabId);
  }
  /** Clear a tab's owner (called from TAB_DETACHED or extension disconnect). */
  forgetTabOwner(tabId) {
    const owner = this._tabToExtension.get(tabId);
    if (!owner) return;
    this._tabToExtension.delete(tabId);
    this._tabLabels.delete(tabId);
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
  wsFor(opts = {}) {
    if (opts.extensionId) {
      const conn = this._extensions.get(opts.extensionId);
      if (!conn) {
        const available = Array.from(this._extensions.keys()).join(", ") || "(none)";
        const seen = this._seenExtensions.get(opts.extensionId);
        if (seen) {
          const mins = Math.round((Date.now() - seen.lastSeenAt) / 6e4);
          const ago = mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
          throw new Error(
            `Extension "${opts.extensionId}" was registered but is GONE (last seen ${ago}). That browser is closed, or Chrome disabled/crashed its extension \u2014 chrome://extensions will show a Reload button. This is NOT the same as a wrong id. Do not fall back to another extension and report findings from it: that is a different browser with different logins. Still registered: ${available}.`
          );
        }
        throw new Error(
          `Unknown extensionId "${opts.extensionId}" \u2014 never seen by this server. Registered: ${available}.` + this._absentSuffix()
        );
      }
      return conn.ws;
    }
    if (opts.tabTarget != null && opts.tabTarget !== "") {
      if (typeof opts.tabTarget === "number") {
        const owner = this._tabToExtension.get(opts.tabTarget);
        if (owner) return this._extensions.get(owner).ws;
      }
      if (typeof opts.tabTarget === "string" && /^\d+$/.test(opts.tabTarget)) {
        const owner = this._tabToExtension.get(parseInt(opts.tabTarget, 10));
        if (owner) return this._extensions.get(owner).ws;
      }
      if (typeof opts.tabTarget === "string") {
        const owners = this.extensionsForLabel(opts.tabTarget);
        if (owners.length === 1) return this._extensions.get(owners[0]).ws;
        if (owners.length > 1) {
          throw new Error(
            `Tab label "${opts.tabTarget}" exists in ${owners.length} connected browsers, so it does not identify one:
` + owners.map((id) => {
              const d = this.describeExtension(id);
              return `  \xB7 ${id} \u2014 ${d?.label ?? "(unknown)"}`;
            }).join("\n") + `
Pass extensionId alongside tabTarget to say which, or target the numeric tabId from browser_list_attached_tabs \u2014 tab ids are unique across browsers, labels are not.`
          );
        }
      }
    }
    if (this._extensions.size === 1) {
      return this._extensions.values().next().value.ws;
    }
    if (this._extensions.size === 0) {
      if (this._ws) return this._ws;
      throw new Error(noConnectionMessage + this._absentSuffix());
    }
    const ids = Array.from(this._extensions.keys());
    const described = ids.map((id) => {
      const d = this.describeExtension(id);
      return d ? `  \xB7 ${id} \u2014 ${d.label}${d.remoteAddress ? ` [peer ${d.remoteAddress}]` : ""}` : `  \xB7 ${id}`;
    }).join("\n");
    throw new Error(
      `Multiple extensions are connected (${ids.length}). To target a specific browser, EITHER pass extensionId on this call \u2014 the connected browsers are:
${described}
OR first attach to a tab (browser_list_tabs \u2192 browser_attach_tab({tabId} or {autoOpenUrl})) and then pass tabTarget=<tabId-or-label> on subsequent calls \u2014 the server routes attached tabs to their owning extension automatically. If your MCP client's tool schema doesn't show extensionId, refresh it via /mcp (or session respawn).` + // ⚠️ Load-bearing: on 2026-08-06 this message listed the two surviving
      // browsers and said nothing about the third having died. Agents picked
      // from the list it offered, which is exactly what a list implies is
      // complete. The absent ones belong in the same breath as the present.
      this._absentSuffix()
    );
  }
  /**
   * Get the currently active (last-used) tab ID
   * Note: With multi-tab support, this only tracks the most recently used tab
   */
  get activeTabId() {
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
  async ensureAttached(options) {
    const tabTarget = options?.tabId ?? options?.label;
    const result = await this.sendSocketMessage("browser_ensure_attached", {
      tabId: options?.tabId ?? null,
      label: options?.label ?? null,
      autoOpenUrl: options?.autoOpenUrl ?? null
    }, { extensionId: options?.extensionId, tabTarget });
    this._activeTabId = result.tabId;
    return result;
  }
  /**
   * Convenience wrapper: take a raw params blob (post-zod-parse), extract the
   * routing-relevant fields (extensionId, tabTarget), and call ensureAttached
   * with the right options. Lets handlers avoid the boilerplate of pulling
   * fields out individually — they just `await context.ensureAttachedFromParams(validatedParams)`.
   */
  async ensureAttachedFromParams(params) {
    const tabTarget = params?.tabTarget;
    return this.ensureAttached({
      extensionId: params?.extensionId,
      tabId: typeof tabTarget === "number" ? tabTarget : void 0,
      label: typeof tabTarget === "string" ? tabTarget : void 0
    });
  }
  async sendSocketMessage(type2, payload, options = {}) {
    const ws = this.wsFor({
      extensionId: options.extensionId ?? payload?.extensionId,
      tabTarget: options.tabTarget ?? payload?.tabTarget
    });
    const { sendSocketMessage } = createSocketMessageSender(ws);
    try {
      return await sendSocketMessage(type2, payload, { timeoutMs: options.timeoutMs ?? 3e4 });
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
  async broadcastSocketMessage(type2, payload, options = {}) {
    const out = [];
    const extensions = this.listExtensions();
    if (extensions.length === 0 && this._ws) {
      try {
        const { sendSocketMessage } = createSocketMessageSender(this._ws);
        const result = await sendSocketMessage(type2, payload, { timeoutMs: options.timeoutMs ?? 3e4 });
        return [{ extensionId: "default", result }];
      } catch (e) {
        return [{ extensionId: "default", error: e?.message ?? String(e) }];
      }
    }
    await Promise.all(extensions.map(async (conn) => {
      try {
        const { sendSocketMessage } = createSocketMessageSender(conn.ws);
        const result = await sendSocketMessage(type2, payload, { timeoutMs: options.timeoutMs ?? 3e4 });
        out.push({ extensionId: conn.extensionId, result });
      } catch (e) {
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
};

// src/watch/buffer.ts
var DEFAULT_MAX_BUFFERED = 100;
var MAX_TIMEOUT_MS = 12e4;
var MIN_TIMEOUT_MS = 10;
var WatchBuffer = class {
  slots = /* @__PURE__ */ new Map();
  maxBuffered;
  /**
   * Per-watch capacity, from sink.maxBuffered. Without this the schema
   * advertised a knob that did nothing — worse than not offering it, because a
   * caller sizing a buffer for a long conversation would believe they had.
   */
  capacities = /* @__PURE__ */ new Map();
  // ⛔ NOT a TypeScript parameter property (`constructor(private x: T)`).
  // Node's --experimental-strip-types rejects those outright, and the unit
  // tests import this module directly rather than through tsup.
  constructor(maxBuffered = DEFAULT_MAX_BUFFERED) {
    this.maxBuffered = maxBuffered;
  }
  /** Set a watch's own queue depth. Called when a buffer-sink watch is created. */
  setCapacity(watchId, maxBuffered) {
    if (maxBuffered == null || !Number.isFinite(maxBuffered) || maxBuffered < 1) return;
    this.capacities.set(watchId, Math.floor(maxBuffered));
  }
  capacityFor(watchId) {
    return this.capacities.get(watchId) ?? this.maxBuffered;
  }
  slot(watchId) {
    let s = this.slots.get(watchId);
    if (!s) {
      s = { queue: [], waiters: [] };
      this.slots.set(watchId, s);
    }
    return s;
  }
  /** Deliver an event. Wakes one waiter if any, else buffers. */
  push(watchId, event) {
    const s = this.slot(watchId);
    const waiter = s.waiters.shift();
    if (waiter) {
      waiter({ matched: true, events: [event] });
      return;
    }
    s.queue.push(event);
    const cap = this.capacityFor(watchId);
    if (s.queue.length > cap) {
      s.queue.splice(0, s.queue.length - cap);
    }
  }
  /**
   * Drain everything buffered, or block until the next event or the timeout.
   * Returns `{matched:false}` on timeout rather than throwing — a timeout is
   * an answer ("nothing yet"), not an error.
   */
  poll(watchId, timeoutMs = 15e3) {
    const s = this.slot(watchId);
    if (s.queue.length > 0) {
      const events = s.queue;
      s.queue = [];
      return Promise.resolve({ matched: true, events });
    }
    const deadline = Math.max(MIN_TIMEOUT_MS, Math.min(timeoutMs, MAX_TIMEOUT_MS));
    return new Promise((resolve2) => {
      let settled = false;
      const settle = (r) => {
        if (settled) return;
        settled = true;
        resolve2(r);
      };
      const waiter = (r) => settle(r);
      s.waiters.push(waiter);
      setTimeout(() => {
        const idx = s.waiters.indexOf(waiter);
        if (idx >= 0) s.waiters.splice(idx, 1);
        settle({ matched: false, timeoutMs: deadline });
      }, deadline);
    });
  }
  /** Tear down a watch's slot; pending waiters resolve as unmatched. */
  drop(watchId) {
    this.capacities.delete(watchId);
    const s = this.slots.get(watchId);
    if (!s) return;
    const waiters = s.waiters.splice(0);
    for (const w of waiters) w({ matched: false });
    this.slots.delete(watchId);
  }
};

// src/watch/persistence.ts
function toPersisted(rec) {
  return {
    watchId: rec.watchId,
    source: rec.source,
    home: rec.home,
    extensionId: rec.extensionId,
    tabId: rec.tabId ?? null,
    agent: rec.agent,
    predicate: rec.predicate,
    prefilter: rec.prefilter,
    config: rec.config,
    sink: rec.sink,
    options: rec.options,
    createdAt: rec.createdAt,
    armedAgainstUrl: rec.armedAgainstUrl,
    firedBeforeShutdown: Boolean(rec.options?.once && rec.firedCount > 0)
  };
}
function fromPersisted(p) {
  return {
    watchId: p.watchId,
    source: p.source,
    home: p.home,
    extensionId: p.extensionId,
    tabId: p.tabId ?? null,
    agent: p.agent,
    predicate: p.predicate,
    prefilter: p.prefilter,
    config: p.config,
    sink: p.sink,
    options: p.options,
    createdAt: p.createdAt,
    // ⛔ Counters described a process that no longer exists. Carrying them over
    // would make a fresh server claim a history it did not observe.
    firedCount: 0,
    droppedCount: 0,
    prefilteredCount: 0,
    lastFiredAt: null,
    // ⛔ The load-bearing line of this file. See the header.
    armedReportedByExtension: null,
    armedReportedAt: null
  };
}
function looksLikeAWatch(p) {
  return p != null && typeof p === "object" && typeof p.watchId === "string" && typeof p.source === "string" && typeof p.extensionId === "string" && typeof p.createdAt === "number" && p.sink != null;
}
function planRehydration(rows, now) {
  const plan = { rehydrate: [], drop: [], lostBuffers: [], malformed: 0 };
  for (const row of rows) {
    if (!looksLikeAWatch(row)) {
      plan.malformed += 1;
      continue;
    }
    if (row.firedBeforeShutdown) {
      plan.drop.push({ watchId: row.watchId, reason: "once" });
      continue;
    }
    const ttl = row.options?.ttlMs;
    if (typeof ttl === "number" && now - row.createdAt >= ttl) {
      plan.drop.push({ watchId: row.watchId, reason: "ttl" });
      continue;
    }
    const record = fromPersisted(row);
    plan.rehydrate.push({
      watchId: row.watchId,
      record,
      // Page-home watches are conditional on the document still being there.
      requiresUrl: row.home === "page" ? row.armedAgainstUrl : void 0
    });
    if (row.sink?.kind === "buffer") plan.lostBuffers.push(row.watchId);
  }
  return plan;
}

// src/watch/predicate.ts
var cache = /* @__PURE__ */ new Map();
function compilePredicate(src) {
  if (src == null || src === "") return () => true;
  const hit = cache.get(src);
  if (hit) return hit;
  let fn;
  try {
    fn = new Function("e", `"use strict"; return (${src})(e);`);
  } catch (err) {
    throw new Error(
      `Invalid watch predicate: ${err.message}. Expected a JS arrow function, e.g. "(e) => e.url.includes('done')".`
    );
  }
  const compiled = (event) => {
    try {
      return Boolean(fn(event));
    } catch {
      return false;
    }
  };
  if (cache.size > 500) cache.clear();
  cache.set(src, compiled);
  return compiled;
}
function validatePredicate(src) {
  try {
    compilePredicate(src);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// src/watch/registry.ts
var MAX_TOMBSTONES = 50;
var WatchRegistry = class {
  watches = /* @__PURE__ */ new Map();
  /**
   * Recently-cleared watches, newest last. Bounded — this is an explanation
   * buffer, not a history.
   */
  tombstones = /* @__PURE__ */ new Map();
  /**
   * When THIS registry came into being. The registry is in memory, so an
   * mcp-server restart takes every watch with it and leaves no tombstone to
   * find. Exposing the start time lets a caller work out that their watch was
   * created before this process existed, which is the only honest answer
   * available for that case.
   */
  startedAt = Date.now();
  /** extensionId -> watchIds. Kept in sync on every create/delete. */
  byExtension = /* @__PURE__ */ new Map();
  /** `${extensionId}:${tabId}` -> watchIds, for the tab-detach cascade. */
  byExtensionTab = /* @__PURE__ */ new Map();
  counter = 0;
  /** Deterministic ids — no Math.random, so tests are reproducible. */
  nextId() {
    this.counter += 1;
    return `w-${Date.now().toString(36)}-${this.counter}`;
  }
  tabKey(extensionId, tabId) {
    return `${extensionId}:${tabId}`;
  }
  index(rec) {
    let ext = this.byExtension.get(rec.extensionId);
    if (!ext) {
      ext = /* @__PURE__ */ new Set();
      this.byExtension.set(rec.extensionId, ext);
    }
    ext.add(rec.watchId);
    if (rec.tabId != null) {
      const key = this.tabKey(rec.extensionId, rec.tabId);
      let tab = this.byExtensionTab.get(key);
      if (!tab) {
        tab = /* @__PURE__ */ new Set();
        this.byExtensionTab.set(key, tab);
      }
      tab.add(rec.watchId);
    }
  }
  deindex(rec) {
    const ext = this.byExtension.get(rec.extensionId);
    if (ext) {
      ext.delete(rec.watchId);
      if (ext.size === 0) this.byExtension.delete(rec.extensionId);
    }
    if (rec.tabId != null) {
      const key = this.tabKey(rec.extensionId, rec.tabId);
      const tab = this.byExtensionTab.get(key);
      if (tab) {
        tab.delete(rec.watchId);
        if (tab.size === 0) this.byExtensionTab.delete(key);
      }
    }
  }
  create(spec, home) {
    const rec = {
      ...spec,
      watchId: this.nextId(),
      home,
      createdAt: Date.now(),
      firedCount: 0,
      droppedCount: 0,
      prefilteredCount: 0,
      lastFiredAt: null,
      // ⛔ null, not true. The server has not heard from the extension yet, and
      // "unknown" is a different state from "armed" — conflating them is the
      // isActive bug (memo 9fb367c0) under a new name.
      armedReportedByExtension: null,
      armedReportedAt: null
    };
    this.watches.set(rec.watchId, rec);
    this.tombstones.delete(rec.watchId);
    this.index(rec);
    return rec;
  }
  /**
   * Put an existing record back, verbatim — used by rehydration after a
   * restart. Distinct from create(): it mints no id and invents no state, so
   * whatever persistence decided about `armed` is preserved exactly.
   */
  restore(rec) {
    this.watches.set(rec.watchId, rec);
    this.tombstones.delete(rec.watchId);
    this.index(rec);
    return rec;
  }
  get(watchId) {
    return this.watches.get(watchId);
  }
  list(filter = {}) {
    let out = [...this.watches.values()];
    if (filter.extensionId !== void 0) {
      out = out.filter((w) => w.extensionId === filter.extensionId);
    }
    if (filter.tabId !== void 0) {
      out = out.filter((w) => w.tabId === filter.tabId);
    }
    if (filter.agent !== void 0) {
      out = out.filter((w) => w.agent === filter.agent);
    }
    return out;
  }
  /** Every watch belonging to one extension — what gets re-pushed on register. */
  specsFor(extensionId) {
    const ids = this.byExtension.get(extensionId);
    if (!ids) return [];
    return [...ids].map((id) => this.watches.get(id)).filter(Boolean);
  }
  delete(watchId, reason = "deleted") {
    const rec = this.watches.get(watchId);
    if (!rec) return false;
    this.deindex(rec);
    this.watches.delete(watchId);
    this.tombstones.set(watchId, {
      watchId,
      source: rec.source,
      reason,
      at: Date.now(),
      agent: rec.agent,
      extensionId: rec.extensionId,
      tabId: rec.tabId ?? null,
      firedCount: rec.firedCount
    });
    while (this.tombstones.size > MAX_TOMBSTONES) {
      const oldest = this.tombstones.keys().next().value;
      if (oldest === void 0) break;
      this.tombstones.delete(oldest);
    }
    return true;
  }
  /** Why a watch that no longer exists was cleared, if we still know. */
  tombstone(watchId) {
    return this.tombstones.get(watchId);
  }
  /** Recently-cleared watches, NEWEST FIRST. */
  recentlyCleared(filter = {}) {
    let out = [...this.tombstones.values()].reverse();
    if (filter.extensionId !== void 0) out = out.filter((t) => t.extensionId === filter.extensionId);
    if (filter.tabId !== void 0) out = out.filter((t) => t.tabId === filter.tabId);
    if (filter.agent !== void 0) out = out.filter((t) => t.agent === filter.agent);
    return out;
  }
  /** Cascade for TAB_DETACHED / tab close. Browser-wide watches survive. */
  deleteByTab(extensionId, tabId) {
    const ids = this.byExtensionTab.get(this.tabKey(extensionId, tabId));
    if (!ids) return [];
    const removed = [...ids];
    for (const id of removed) this.delete(id, "tab-detached");
    return removed;
  }
  /** Cascade for socket close / extension disconnect. Takes everything. */
  deleteByExtension(extensionId) {
    const ids = this.byExtension.get(extensionId);
    if (!ids) return [];
    const removed = [...ids];
    for (const id of removed) this.delete(id, "extension-disconnected");
    return removed;
  }
  /** Remove watches whose ttl has elapsed. Returns the removed ids. */
  expire(now) {
    const removed = [];
    for (const rec of [...this.watches.values()]) {
      const ttl = rec.options?.ttlMs;
      if (ttl == null) continue;
      if (now - rec.createdAt >= ttl) {
        this.delete(rec.watchId, "ttl");
        removed.push(rec.watchId);
      }
    }
    return removed;
  }
  recordFired(watchId, at) {
    const rec = this.watches.get(watchId);
    if (!rec) return;
    rec.firedCount += 1;
    rec.lastFiredAt = at;
  }
  /**
   * An event passed the extension's prefilter but not the server-side
   * predicate. Tracked separately from droppedCount, which means a DELIVERY
   * failure — conflating "your filter is loose" with "the sink is broken"
   * would hide both.
   */
  recordPrefiltered(watchId, count = 1) {
    const rec = this.watches.get(watchId);
    if (!rec) return;
    rec.prefilteredCount += count;
  }
  recordDropped(watchId, count = 1) {
    const rec = this.watches.get(watchId);
    if (!rec) return;
    rec.droppedCount += count;
  }
  /**
   * Store what the EXTENSION said, verbatim.
   *
   * ⛔ Never call this with a value the server inferred. The whole point of the
   * field is that it distinguishes "the extension confirmed it is armed" from
   * "we have a row for it".
   */
  recordArmed(watchId, armed, at) {
    const rec = this.watches.get(watchId);
    if (!rec) return;
    rec.armedReportedByExtension = armed;
    rec.armedReportedAt = at;
  }
};

// src/watch/sinks.ts
var DEFAULT_ATC_FROM = "unibrowse";
function renderContent2(record, event) {
  const head2 = event.breakerTripped ? `\u26D4 WATCH DISARMED \u2014 ${event.breakerTripped.reason}
watch ${record.watchId} on ${record.source} fired ${event.breakerTripped.firedInWindow} times in one minute against a cap of ${event.breakerTripped.cap}. It is no longer armed; re-create it with a narrower predicate or a higher maxPerMin.` : `watch ${record.watchId} fired \u2014 ${record.source}` + (record.tabId != null ? ` (tab ${record.tabId})` : "");
  let payload;
  try {
    payload = JSON.stringify(event.payload, null, 2);
  } catch {
    payload = String(event.payload);
  }
  if (payload.length > 4e3) payload = payload.slice(0, 4e3) + "\n\u2026 truncated";
  const foot = event.breakerTripped ? "" : `

Stop this watch: browser_watch_delete({watchId: "${record.watchId}"}) \u2014 or reply to this message.`;
  return `${head2}

${payload}${foot}`;
}
function createSinkDispatcher(opts) {
  const { fetchImpl, buffer, atcUrl, atcFrom = DEFAULT_ATC_FROM } = opts;
  async function post(url, body, headers = {}, sink = "webhook") {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        if (res.text) {
          try {
            const t = await res.text();
            if (t) detail += `: ${t.slice(0, 200)}`;
          } catch {
          }
        }
        return { ok: false, sink, detail };
      }
      return { ok: true, sink };
    } catch (e) {
      return { ok: false, sink, detail: e instanceof Error ? e.message : String(e) };
    }
  }
  return {
    async deliver(record, event) {
      const sink = record.sink;
      if (sink.kind === "buffer") {
        buffer.push(record.watchId, event);
        return { ok: true, sink: "buffer" };
      }
      if (sink.kind === "webhook") {
        return post(
          sink.url,
          {
            watchId: record.watchId,
            source: record.source,
            tabId: record.tabId,
            extensionId: record.extensionId,
            firedAt: event.firedAt,
            payload: event.payload,
            breakerTripped: event.breakerTripped
          },
          sink.headers ?? {},
          "webhook"
        );
      }
      const to = sink.to ?? record.agent;
      if (!to) {
        return {
          ok: false,
          sink: "atc",
          detail: `atc sink has no recipient: sink.to was not set and the watch has no \`agent\`. Pass \`agent\` when creating the watch so events reach your own session, or set sink.to explicitly.`
        };
      }
      return post(
        `${atcUrl}/messages`,
        {
          to,
          from: atcFrom,
          subject: sink.subject ?? `watch ${record.source}`,
          content: renderContent2(record, event),
          priority: event.breakerTripped ? "warning" : sink.priority ?? "info"
        },
        {},
        "atc"
      );
    }
  };
}

// src/watch/service.ts
var DEFAULT_ATC_URL2 = "http://192.168.1.168:3030";
var watchRegistry = new WatchRegistry();
var watchBuffer = new WatchBuffer();
var dispatcher = createSinkDispatcher({
  fetchImpl: ((url, init) => fetch(url, init)),
  buffer: watchBuffer,
  atcUrl: process.env.UNIBROWSE_ATC_URL || DEFAULT_ATC_URL2
});
var expiryTimer = null;
var buffersLostToRestart = /* @__PURE__ */ new Set();
var pendingUrlVerification = /* @__PURE__ */ new Map();
async function persistWatch(rec) {
  try {
    if (!mongodb.isConnected()) await mongodb.connect();
    await mongodb.getWatchesCollection().updateOne({ watchId: rec.watchId }, { $set: toPersisted(rec) }, { upsert: true });
  } catch (e) {
    console.log(`[Watch] persist failed for ${rec.watchId} (non-fatal): ${e?.message}`);
  }
}
async function unpersistWatch(watchId) {
  try {
    if (!mongodb.isConnected()) return;
    await mongodb.getWatchesCollection().deleteOne({ watchId });
  } catch (e) {
    console.log(`[Watch] unpersist failed for ${watchId} (non-fatal): ${e?.message}`);
  }
}
async function unpersistMany(ids) {
  if (ids.length === 0) return;
  try {
    if (!mongodb.isConnected()) return;
    await mongodb.getWatchesCollection().deleteMany({ watchId: { $in: ids } });
  } catch (e) {
    console.log(`[Watch] bulk unpersist failed (non-fatal): ${e?.message}`);
  }
}
async function rehydrateWatches() {
  try {
    if (!mongodb.isConnected()) await mongodb.connect();
    if (!mongodb.isConnected()) {
      console.log("[Watch] no MongoDB connection; watches did NOT survive this restart");
      return;
    }
    const rows = await mongodb.getWatchesCollection().find({}).toArray();
    if (rows.length === 0) return;
    const plan = planRehydration(rows, Date.now());
    for (const c of plan.rehydrate) {
      if (c.requiresUrl) c.record.armedAgainstUrl = c.requiresUrl;
      watchRegistry.restore(c.record);
      if (c.requiresUrl) pendingUrlVerification.set(c.watchId, c.requiresUrl);
    }
    console.log(
      `[Watch] ${pendingUrlVerification.size} page watch(es) pending URL verification before re-arm`
    );
    for (const id of plan.lostBuffers) buffersLostToRestart.add(id);
    if (plan.drop.length > 0) {
      await unpersistMany(plan.drop.map((d) => d.watchId));
    }
    console.log(
      `[Watch] rehydrated ${plan.rehydrate.length} watch(es) as armed:unknown${plan.drop.length ? `, dropped ${plan.drop.length} (${plan.drop.map((d) => d.reason).join(",")})` : ""}${plan.lostBuffers.length ? `, ${plan.lostBuffers.length} buffer(s) lost` : ""}${plan.malformed ? `, \u26A0\uFE0F ${plan.malformed} MALFORMED row(s) skipped` : ""}`
    );
  } catch (e) {
    console.log(`[Watch] rehydration failed (non-fatal): ${e?.message}`);
  }
}
async function handleWatchFired(payload, disarmInExtension) {
  const watchId = String(payload?.watchId ?? "");
  if (!watchId) return;
  const record = watchRegistry.get(watchId);
  if (!record) {
    console.log(`[Watch] WATCH_FIRED for unknown watch ${watchId}; disarming in extension`);
    try {
      disarmInExtension(watchId);
    } catch {
    }
    return;
  }
  const event = {
    watchId,
    source: String(payload.source ?? record.source),
    firedAt: Number(payload.firedAt ?? Date.now()),
    payload: payload.payload,
    breakerTripped: payload.breakerTripped
  };
  if (!event.breakerTripped && record.home !== "page") {
    let matched;
    try {
      matched = compilePredicate(record.predicate)(event.payload);
    } catch {
      matched = false;
    }
    if (!matched) {
      watchRegistry.recordPrefiltered(watchId);
      return;
    }
  }
  watchRegistry.recordFired(watchId, event.firedAt);
  const result = await dispatcher.deliver(record, event);
  if (!result.ok) {
    watchRegistry.recordDropped(watchId);
    console.log(
      `[Watch] delivery failed for ${watchId} via ${result.sink}: ${result.detail ?? "unknown"}`
    );
  }
  if (event.breakerTripped) {
    watchRegistry.delete(watchId, "breaker");
    watchBuffer.drop(watchId);
    void unpersistWatch(watchId);
    return;
  }
  if (record.options?.once) {
    watchRegistry.delete(watchId, "once");
    void unpersistWatch(watchId);
  }
}
function onWatchDocumentChanged(watchId, detail) {
  const rec = watchRegistry.get(watchId);
  if (!rec) return;
  watchRegistry.delete(watchId, "document-changed");
  watchBuffer.drop(watchId);
  void unpersistWatch(watchId);
  console.log(
    `[Watch] ${watchId} cleared as document-changed: was ${detail.was ?? "?"}, now ${detail.now ?? "?"}`
  );
}
function onTabGone(extensionId, tabId) {
  const removed = watchRegistry.deleteByTab(extensionId, tabId);
  for (const id of removed) watchBuffer.drop(id);
  void unpersistMany(removed);
  if (removed.length > 0) {
    console.log(`[Watch] tab ${tabId} gone: cleared ${removed.length} watch(es)`);
  }
  return removed;
}
function onExtensionGone(extensionId) {
  const removed = watchRegistry.deleteByExtension(extensionId);
  for (const id of removed) watchBuffer.drop(id);
  if (removed.length > 0) {
    console.log(`[Watch] extension ${extensionId} gone: cleared ${removed.length} watch(es)`);
  }
  return removed;
}
async function rearmForExtension(extensionId, liveUrlOf) {
  const specs = specsToRearm(extensionId);
  const dropped = [];
  const needsCheck = specs.filter((s) => pendingUrlVerification.has(s.watchId));
  if (needsCheck.length === 0) return { specs, dropped };
  const survivors = [];
  for (const s of specs) {
    const wanted = pendingUrlVerification.get(s.watchId);
    if (!wanted) {
      survivors.push(s);
      continue;
    }
    pendingUrlVerification.delete(s.watchId);
    let actual;
    try {
      actual = s.tabId != null ? await liveUrlOf(s.tabId) : void 0;
    } catch {
      actual = void 0;
    }
    if (typeof actual === "string" && actual === wanted) {
      survivors.push(s);
      continue;
    }
    watchRegistry.delete(s.watchId, "document-changed");
    watchBuffer.drop(s.watchId);
    void unpersistWatch(s.watchId);
    dropped.push({ watchId: s.watchId, reason: "document-changed" });
    console.log(
      `[Watch] ${s.watchId} NOT re-armed: created against ${wanted}, tab ${s.tabId} now shows ${actual ?? "(unreachable/gone)"}`
    );
  }
  return { specs: survivors, dropped };
}
async function recordArmedFromExtension(extensionId, listArmed) {
  try {
    const rows = await listArmed();
    const live = new Set(rows.filter((r) => r.armed).map((r) => r.watchId));
    const now = Date.now();
    for (const rec of watchRegistry.list({ extensionId })) {
      watchRegistry.recordArmed(rec.watchId, live.has(rec.watchId), now);
    }
    console.log(`[Watch] ${extensionId} confirms ${live.size} watch(es) armed`);
  } catch (e) {
    console.log(`[Watch] armed-state confirmation for ${extensionId} failed (non-fatal): ${e?.message}`);
  }
}
function specsToRearm(extensionId) {
  return watchRegistry.specsFor(extensionId).map((w) => ({
    watchId: w.watchId,
    source: w.source,
    // The prefilter is what the extension applies; the predicate stays here.
    // A page-home watch is the exception — its predicate is injected into the
    // document, so it must travel.
    prefilter: w.prefilter,
    predicate: w.home === "page" ? w.predicate : void 0,
    config: w.config,
    // The document a page watch belongs to. The extension re-injects on every
    // navigation of that tab, and without this it would attach to whatever
    // page is now there — the live-navigation twin of the restart case.
    armedAgainstUrl: w.armedAgainstUrl,
    options: w.options,
    tabId: w.tabId ?? null,
    extensionId: w.extensionId
  }));
}
function startWatchExpiry(intervalMs = 3e4) {
  if (expiryTimer) return;
  expiryTimer = setInterval(() => {
    const removed = watchRegistry.expire(Date.now());
    for (const id of removed) watchBuffer.drop(id);
    void unpersistMany(removed);
    if (removed.length > 0) console.log(`[Watch] expired ${removed.length} watch(es)`);
  }, intervalMs);
  if (typeof expiryTimer.unref === "function") expiryTimer.unref();
}
async function forgetWatch(watchId) {
  await unpersistWatch(watchId);
}

// src/server.ts
var sendToAgent = createSender({
  selfBaseUrl: process.env.UNIBROWSE_PUBLIC_URL || "http://mcp-server:9010"
});
var globalContext = new Context();
function describeExtensionLabel(extensionId) {
  if (!extensionId) return void 0;
  try {
    return globalContext.describeExtensions().find((e) => e.extensionId === extensionId)?.label;
  } catch {
    return void 0;
  }
}
var MULTI_AGENT_INSTRUCTIONS = `Unibrowse is a multi-agent browser MCP server.

Multiple extensions may be connected at once (e.g. ben's host Chrome plus container chromiums spawned by browser_launch_isolated_chrome for isolated work). Multiple agents share the server simultaneously.

Routing model:
- Each extension has a stable extensionId \u2014 find them via browser_list_attached_tabs (response.extensions array) or the return value of browser_launch_isolated_chrome.
- Pin a specific extension by passing extensionId on every tool call. This is the explicit path.
- Alternatively, attach a tab first (browser_attach_tab with autoOpenUrl or tabId) \u2014 the server records tabId\u2192extensionId so subsequent calls with tabTarget alone route to the right extension automatically.
- When only one extension is connected, no routing fields are required (single-extension fallback). Multi-extension mode requires either extensionId or an attached tabTarget.

Tab reservations (multi-agent etiquette):
- Pass agent:"<your name>" on browser_create_tab/browser_attach_tab to reserve a tab to yourself; other agents calling control tools on it will get a tab-reserved error.
- Pass takeover:true when you genuinely need to claim a tab from a dead agent.
- Use browser_list_attached_tabs to see who owns what (response.tabs[].reservation).

If a tool errors with "Multiple extensions are connected" it includes a prescriptive recovery path: pass extensionId, or attach a tab and use tabTarget. If your MCP client's tool schema doesn't show extensionId, your client cached tools/list before the schema bump \u2014 refresh with /mcp or session respawn.`;
async function createServerWithTools(options) {
  const { name, version, tools, resources, wss: providedWss } = options;
  startWatchExpiry();
  void rehydrateWatches();
  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {}
      },
      instructions: MULTI_AGENT_INSTRUCTIONS
    }
  );
  async function handleBrowserMessage(ws, message) {
    const { id, type: type2, payload } = message;
    if (type2 === "EXTENSION_REGISTER") {
      const extensionId = payload?.extensionId || message?.wsId || `legacy-${Math.random().toString(36).slice(2, 10)}`;
      const meta = {
        profileName: payload?.profileName,
        hostname: payload?.hostname,
        userAgent: payload?.userAgent,
        // The BROWSER's address. Captured server-side, so it is available even
        // for an extension too old to report anything about itself, and it is
        // what tells a container chromium apart from a desktop Chrome — see
        // Context.describeExtension. Resolved past a trusted proxy at
        // connection time (see the wss "connection" handler); falls back to the
        // raw peer when there was no upgrade request to read, which is the old
        // behaviour and correct for every direct LAN/loopback connection.
        remoteAddress: ws.__clientIp || stripIPv4Mapped(String(ws?._socket?.remoteAddress || "")) || void 0,
        // The PROXY's address, kept separately so a reader can still see the
        // path a connection took and can disagree with the inference above.
        // ⚠️ Never merge these two back into one field: the whole defect was
        // that one field was answering two different questions.
        peerAddress: ws.__peerIp,
        viaProxy: ws.__viaProxy
      };
      globalContext.registerExtension(extensionId, ws, meta);
      console.log(`[Server] Extension registered: extensionId=${extensionId} profile=${meta.profileName ?? "-"} totalConnected=${globalContext.listExtensions().length}`);
      try {
        ws.send(JSON.stringify({ type: "EXTENSION_REGISTER_ACK", payload: { extensionId } }));
      } catch {
      }
      void globalContext.rebuildTabOwnership(extensionId).then((n) => {
        if (n > 0) console.log(`[Server] Rebuilt tab ownership for ${extensionId}: ${n} tab(s)`);
      }).catch((e) => console.log(`[Server] Tab-ownership rebuild for ${extensionId} failed (non-fatal): ${e?.message ?? e}`));
      void rearmForExtension(extensionId, async (tabId) => {
        const res = await globalContext.sendSocketMessage(
          "browser_evaluate",
          { expression: "location.href", tabTarget: tabId },
          { extensionId, tabTarget: tabId, timeoutMs: 8e3 }
        );
        const raw = typeof res === "string" ? res : res?.result ?? res?.value;
        return typeof raw === "string" ? raw.replace(/^"|"$/g, "") : void 0;
      }).then(({ specs, dropped }) => {
        if (dropped.length > 0) {
          console.log(`[Watch] ${dropped.length} page watch(es) cleared as document-changed`);
        }
        if (specs.length === 0) return;
        ws.send(JSON.stringify({
          id: `watch-rearm-${Date.now()}`,
          type: "browser_watch_rearm",
          payload: { specs }
        }));
        console.log(`[Watch] re-pushed ${specs.length} watch(es) to ${extensionId}`);
        return recordArmedFromExtension(extensionId, async () => {
          const res = await globalContext.sendSocketMessage(
            "browser_watch_list_armed",
            {},
            { extensionId, timeoutMs: 8e3 }
          );
          return res?.watches ?? [];
        });
      }).catch((e) => console.log(`[Watch] re-push to ${extensionId} failed (non-fatal): ${e?.message}`));
      return;
    }
    if (type2 === "SEND_TO_AGENT") {
      const p = payload ?? {};
      const kind = p.kind ?? "content";
      const note = p.note ? String(p.note) : void 0;
      const r = p.recording ?? null;
      const rideAlong = r && r.recordingId ? {
        recordingId: String(r.recordingId),
        partial: r.partial !== false,
        durationMs: typeof r.durationMs === "number" ? r.durationMs : void 0,
        eventCount: typeof r.eventCount === "number" ? r.eventCount : void 0,
        reviewUrl: r.reviewUrl ? String(r.reviewUrl) : void 0
      } : void 0;
      const share = kind === "tab" ? {
        kind: "tab",
        to: String(p.to ?? ""),
        note,
        recording: rideAlong,
        label: String(p.label ?? ""),
        url: String(p.url ?? ""),
        title: p.title ? String(p.title) : void 0,
        tabId: typeof p.tabId === "number" ? p.tabId : void 0,
        extensionId: p.extensionId ? String(p.extensionId) : void 0,
        // ⭐ The extension does not know its own human label — the server
        // derives it (kind + platform + address). Fill it here so the
        // recipient can tell WHICH browser they were handed, without the
        // extension having to mirror a naming scheme it does not own.
        extensionLabel: describeExtensionLabel(String(p.extensionId ?? ""))
      } : kind === "recording" ? {
        kind: "recording",
        to: String(p.to ?? ""),
        note,
        recordingId: String(p.recordingId ?? ""),
        title: p.title ? String(p.title) : void 0,
        startUrl: p.startUrl ? String(p.startUrl) : void 0,
        durationMs: typeof p.durationMs === "number" ? p.durationMs : void 0,
        reviewUrl: p.reviewUrl ? String(p.reviewUrl) : void 0,
        pageCount: typeof p.pageCount === "number" ? p.pageCount : void 0
      } : {
        to: String(p.to ?? ""),
        note,
        url: String(p.url ?? ""),
        title: p.title ? String(p.title) : void 0,
        content: String(p.content ?? ""),
        format: p.format ?? "markdown",
        scope: String(p.scope ?? "page")
      };
      void sendToAgent(share).then((result) => {
        try {
          ws.send(JSON.stringify({
            id: `send-to-agent-${Date.now()}`,
            type: "SEND_TO_AGENT_RESULT",
            payload: { requestId: p.requestId ?? null, ...result }
          }));
        } catch {
        }
        console.log(
          `[SendToAgent] ${kind} -> ${p.to}: ok=${result.ok} sent=${result.sent}` + (result.detail ? ` detail=${result.detail}` : "")
        );
      });
      return;
    }
    if (type2 === "WATCH_DOCUMENT_CHANGED") {
      const p = payload ?? {};
      onWatchDocumentChanged(String(p.watchId ?? ""), {
        was: p.was,
        now: p.now
      });
      return;
    }
    if (type2 === "WATCH_FIRED") {
      void handleWatchFired(
        payload ?? {},
        (watchId) => {
          try {
            ws.send(JSON.stringify({
              id: `watch-disarm-${Date.now()}`,
              type: "browser_watch_disarm",
              payload: { watchId }
            }));
          } catch {
          }
        }
      ).catch((e) => console.log(`[Watch] handleWatchFired failed: ${e?.message ?? e}`));
      return;
    }
    if (type2 === "TAB_ATTACHED" || type2 === "TAB_DETACHED") {
      let extensionId = payload?.extensionId || message?.wsId;
      if (!extensionId || !globalContext.getExtension(extensionId)) {
        for (const conn of globalContext.listExtensions()) {
          if (conn.ws === ws) {
            if (extensionId && extensionId !== conn.extensionId) {
              console.log(`[Server] TAB_${type2 === "TAB_ATTACHED" ? "ATTACHED" : "DETACHED"}: split-brain detected, payload claimed ${extensionId} but ws owner is ${conn.extensionId}`);
            }
            extensionId = conn.extensionId;
            break;
          }
        }
      }
      const tabId = payload?.tabId;
      if (tabId != null && extensionId) {
        if (type2 === "TAB_ATTACHED") {
          globalContext.recordTabOwner(tabId, extensionId, payload?.label);
          console.log(`[Server] TAB_ATTACHED: tab=${tabId} ext=${extensionId}`);
        } else {
          globalContext.forgetTabOwner(tabId);
          console.log(`[Server] TAB_DETACHED: tab=${tabId} ext=${extensionId}`);
          onTabGone(extensionId, tabId);
        }
      }
      return;
    }
    if (type2 === "messageResponse") {
      return;
    }
    if (!type2) {
      console.warn(`[Server] Message without type field: ${JSON.stringify(message)}`);
      return;
    }
    console.log(`[Server] Handling tool request: ${type2} (id: ${id})`);
    try {
      const tool = tools.find((t) => t.schema.name === type2);
      if (!tool) {
        console.warn(`[Server] Unknown tool: ${type2}`);
        ws.send(JSON.stringify({ id, error: `Unknown tool: ${type2}` }));
        return;
      }
      const toolResult = await tool.handle(globalContext, payload || {});
      ws.send(JSON.stringify({
        type: "messageResponse",
        payload: {
          requestId: id,
          result: toolResult
        }
      }));
    } catch (error) {
      console.error(`[Server] Tool execution error:`, error);
      ws.send(JSON.stringify({
        type: "messageResponse",
        payload: {
          requestId: id,
          error: String(error)
        }
      }));
    }
  }
  const connections = /* @__PURE__ */ new Set();
  const wss = providedWss || await createWebSocketServer();
  wss.on("connection", (websocket, request) => {
    try {
      if (request) {
        const peer = stripIPv4Mapped(String(websocket?._socket?.remoteAddress || ""));
        const configured = new Set(
          (process.env.UNIBROWSE_TRUSTED_PROXIES || "").split(",").map((s) => stripIPv4Mapped(s.trim())).filter(Boolean)
        );
        const effective = configured.has(peer) ? stripIPv4Mapped(getEffectiveClientIP(request)) : peer;
        websocket.__clientIp = effective || void 0;
        websocket.__peerIp = peer || void 0;
        websocket.__viaProxy = !!effective && !!peer && effective !== peer;
      }
    } catch {
    }
    console.log("[Server] New WebSocket connection established");
    connections.add(websocket);
    console.log(`[Server] Total active connections: ${connections.size}`);
    websocket.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleBrowserMessage(websocket, message);
      } catch (error) {
        console.error("[Server] Error parsing message:", error);
      }
    });
    websocket.on("close", (code, reason) => {
      const dyingId = globalContext.findExtensionIdByWs(websocket);
      if (dyingId) {
        onExtensionGone(dyingId);
        const ident = globalContext.describeExtension(dyingId);
        const conn = globalContext.getExtension(dyingId);
        const connectedMs = conn ? Date.now() - conn.registeredAt : 0;
        const reasonText = reason?.toString?.() || void 0;
        globalContext.recordDisconnect({
          extensionId: dyingId,
          label: ident?.label,
          kind: ident?.kind,
          remoteAddress: ident?.remoteAddress,
          connectedMs,
          code,
          reason: reasonText
        });
        console.log(
          `[Server] Extension DISCONNECTED: ${dyingId} kind=${ident?.kind ?? "unknown"} addr=${ident?.remoteAddress ?? "?"} afterMs=${connectedMs} code=${code ?? "none"} reason=${reasonText || "(none)"}`
        );
      } else {
        console.log("[Server] WebSocket connection closed (no extension registered on it)");
      }
      connections.delete(websocket);
      console.log(`[Server] Total active connections: ${connections.size}`);
      globalContext.unregisterExtensionByWs(websocket);
      if (globalContext.hasWs() && globalContext.ws === websocket) {
        console.log("[Server] Primary extension ws closed, clearing globalContext.ws");
        globalContext.ws = void 0;
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
    const tool = tools.find((tool2) => tool2.schema.name === request.params.name);
    if (!tool) {
      return {
        content: [
          { type: "text", text: `Tool "${request.params.name}" not found` }
        ],
        isError: true
      };
    }
    try {
      const result = await tool.handle(globalContext, request.params.arguments);
      return result;
    } catch (error) {
      return {
        content: [{ type: "text", text: String(error) }],
        isError: true
      };
    }
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find(
      (resource2) => resource2.schema.uri === request.params.uri
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
async function createServerWithoutWebSocket(options) {
  const { name, version, tools, resources } = options;
  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools.map((tool) => tool.schema) };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: resources.map((resource) => resource.schema) };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((tool2) => tool2.schema.name === request.params.name);
    if (!tool) {
      return {
        content: [
          { type: "text", text: `Tool "${request.params.name}" not found` }
        ],
        isError: true
      };
    }
    try {
      const result = await tool.handle(globalContext, request.params.arguments);
      return result;
    } catch (error) {
      return {
        content: [{ type: "text", text: String(error) }],
        isError: true
      };
    }
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find(
      (resource2) => resource2.schema.uri === request.params.uri
    );
    if (!resource) {
      return { contents: [] };
    }
    const contents = await resource.read(globalContext, request.params.uri);
    return { contents };
  });
  return server;
}

// src/tools/bookmarks.ts
import { zodToJsonSchema } from "zod-to-json-schema";

// src/types/tool-schemas.ts
import { z } from "zod";
var ElementSchema = z.object({
  element: z.string().describe(
    "Human-readable element description used to obtain permission to interact with the element"
  ),
  ref: z.string().describe("Exact target element reference from the page snapshot")
});
var TabTargetSchema = z.object({
  tabTarget: z.union([z.number(), z.string()]).optional().describe(
    "Optional tab identifier \u2014 must be a tab ID or label from browser_list_attached_tabs (NOT a Chrome tab ID from browser_list_tabs). If not provided, uses the last-used attached tab. Use browser_create_tab or browser_attach_tab to attach a tab before targeting it."
  ),
  agent: z.string().optional().describe(
    `Your agent identifier (e.g. your ATC session name: "shopping", "ha", "unibrowse"). When supplied on browser_create_tab/browser_attach_tab, reserves the tab to you so other agents can't hijack it. When supplied on control tools (navigate/evaluate/click/etc.), the server checks ownership and returns a tab-reserved error if a different agent owns the tab. Omit for legacy free-for-all behavior (any caller can drive the tab).`
  ),
  takeover: z.boolean().optional().describe(
    "Set true to forcibly take over a tab currently reserved by a different agent. The takeover is recorded in the tab's reservation history. Requires `agent` to be set. Use sparingly \u2014 intended for cleanup when the prior owner has died or you genuinely need the tab back."
  ),
  extensionId: z.string().optional().describe(
    "Pin this call to a specific extension (host Chrome vs container chromium). Get the id from browser_launch_isolated_chrome's response or browser_list_attached_tabs's `extensions` array. Omit when only one extension is connected, or when tabTarget refers to a tab the server has already routed via TAB_ATTACHED."
  )
});
var ExtensionIdSchema = z.object({
  extensionId: z.string().optional().describe(
    "Pin this call to a specific extension. Required when multiple extensions are connected; if omitted in single-extension mode the only registered extension is used. Get the id from browser_launch_isolated_chrome's response or browser_list_attached_tabs's `extensions` array."
  )
});
var FrameTargetSchema = z.object({
  frameTarget: z.string().optional().describe(
    `Optional frame identifier to operate inside an iframe. Accepts a CDP frameId string from browser_list_frames, or a CSS selector of an <iframe> element (e.g. '#checkout-frame', 'iframe[name="payment"]'). Nameless iframes without a stable selector must use frameId from browser_list_frames. CDP bypasses same-origin policy \u2014 cross-origin iframes are accessible. If omitted, operates on the main frame.`
  )
});
var MaxTokensSchema = z.object({
  max_tokens: z.number().positive().optional().describe(
    "Optional maximum tokens for response output (default: 25000). Claude Code's default MCP tool response limit is 25,000 tokens. Use this to control response size for large outputs (snapshots, screenshots, logs, etc.). Set to a lower value to reduce response size or higher value if MAX_MCP_OUTPUT_TOKENS env var is increased."
  )
});
var NavigateTool = z.object({
  name: z.literal("browser_navigate"),
  description: z.literal("Navigate to a URL. WHEN tabTarget IS OMITTED, A NEW TAB IS CREATED at the URL (in the background) instead of reusing whichever tab was most recently used \u2014 this prevents cross-agent collisions on a shared unibrowse server. The new tab is auto-attached and becomes this caller's last-used tab so a subsequent browser_evaluate / browser_click / etc. without tabTarget hits it. Pass an explicit tabTarget to navigate an existing attached tab. Pass focus=true to bring the auto-created tab to front (default background)."),
  arguments: z.object({
    url: z.string().describe("The URL to navigate to"),
    focus: z.boolean().optional().describe("Only used when tabTarget is omitted (auto-create path). Bring the new tab to front (default: false \u2014 opens in background).")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GoBackTool = z.object({
  name: z.literal("browser_go_back"),
  description: z.literal("Go back to the previous page"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var GoForwardTool = z.object({
  name: z.literal("browser_go_forward"),
  description: z.literal("Go forward to the next page"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var WaitTool = z.object({
  name: z.literal("browser_wait"),
  description: z.literal("Wait for a specified time in seconds"),
  arguments: z.object({
    time: z.number().default(1).describe("The time to wait in seconds (default: 1)")
  }).merge(MaxTokensSchema)
});
var PressKeyTool = z.object({
  name: z.literal("browser_press_key"),
  description: z.literal("Press a key on the keyboard"),
  arguments: z.object({
    key: z.string().describe(
      "Name of the key to press or a character to generate, such as `ArrowLeft` or `a`"
    )
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ScrollTool = z.object({
  name: z.literal("browser_scroll"),
  description: z.literal("Scroll the page by a specific amount in pixels"),
  arguments: z.object({
    x: z.number().optional().describe("Horizontal scroll amount in pixels (positive = right, negative = left). Default: 0"),
    y: z.number().describe("Vertical scroll amount in pixels (positive = down, negative = up)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ScrollToElementTool = z.object({
  name: z.literal("browser_scroll_to_element"),
  description: z.literal("Scroll to make a specific element visible in the viewport"),
  arguments: ElementSchema.merge(TabTargetSchema).merge(MaxTokensSchema)
});
var SetDeviceMetricsTool = z.object({
  name: z.literal("browser_set_device_metrics"),
  description: z.literal(
    "Override the attached tab's viewport size and mobile flag via CDP (Emulation.setDeviceMetricsOverride). Useful for multi-breakpoint UI audits without relaunching chromium \u2014 e.g. step through 390x844 / 768x1024 / 1280x800 in one session. Pass `reset:true` to clear the override and restore the renderer's natural size. Width/height/mobile are ignored when reset is true."
  ),
  arguments: z.object({
    width: z.number().int().min(1).optional().describe(
      "Viewport width in CSS pixels (1+). Required unless `reset: true`."
    ),
    height: z.number().int().min(1).optional().describe(
      "Viewport height in CSS pixels (1+). Required unless `reset: true`."
    ),
    deviceScaleFactor: z.number().min(0).default(1).describe(
      "Device pixel ratio (0 = use system default). Default: 1."
    ),
    mobile: z.boolean().default(false).describe(
      "Whether to emulate as a mobile device. Affects @media queries, touch-event firing, viewport meta-tag handling. Default: false."
    ),
    reset: z.boolean().default(false).describe(
      "Clear any active device-metrics override (Emulation.clearDeviceMetricsOverride). When true, width/height/deviceScaleFactor/mobile are ignored."
    )
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var SetFileInputTool = z.object({
  name: z.literal("browser_set_file_input"),
  description: z.literal(
    "Attach local file(s) to an <input type=file> via CDP DOM.setFileInputFiles \u2014 the ONLY way to programmatically populate a file input (JS cannot set input.files for security). Resolves the input by CSS selector, sets its files, and fires 'input'+'change' so the page/form reacts. CRITICAL: the paths must be ABSOLUTE and exist ON THE BROWSER'S HOST filesystem \u2014 for isolated chromes that's the chromium-host sidecar container, where the bind-mounted profiles dir is visible at /app/.chrome-profiles/... (stage files there so the sidecar chrome can read them). For a multi-file input pass several paths; for single-file inputs pass one. Selector must match exactly one <input type=file>. VERIFYING SUCCESS: do NOT rely on input.files afterward \u2014 React/controlled forms consume the File into state and CLEAR input.files synchronously, so files.length==0 is NORMAL and NOT a failure (the tool returns `count`=what was set, plus `landed`+a `note` when the input was cleared); confirm via the form's own filename chip/UI. SELECTORS on framework forms: the real <input type=file> is often hidden behind a styled dropzone/button and keyed by `id` (which may contain dots/brackets) rather than `name` \u2014 target the underlying input via input[id=\"...\"], not the visible button."
  ),
  arguments: z.object({
    selector: z.string().describe(
      `CSS selector for the target <input type=file> (e.g. 'input[type=file]', '#idFront', 'input[name="receipt"]'). Must resolve to exactly one file input.`
    ),
    paths: z.array(z.string()).min(1).describe(
      "Absolute file path(s) on the BROWSER HOST (the chromium-host sidecar container for isolated chromes), e.g. ['/app/.chrome-profiles/_uploads/foo/id-front.jpg']. Order preserved. One path for a normal input; multiple for a `multiple` input."
    )
  }).merge(TabTargetSchema).merge(ExtensionIdSchema).merge(MaxTokensSchema)
});
var ListTabsTool = z.object({
  name: z.literal("browser_list_tabs"),
  description: z.literal("List all open Chrome browser tabs. NOTE: The tabIds returned here are Chrome tab IDs, only usable with browser_switch_tab and browser_close_tab. For targeting tabs in operations like browser_navigate/browser_snapshot, use browser_list_attached_tabs instead."),
  arguments: z.object({}).merge(ExtensionIdSchema).merge(MaxTokensSchema)
});
var SwitchTabTool = z.object({
  name: z.literal("browser_switch_tab"),
  description: z.literal("Switch to a specific browser tab. Accepts either a numeric tabId or a tabTarget label (from browser_list_attached_tabs)."),
  arguments: z.object({
    tabId: z.number().optional().describe("Numeric Chrome tab ID to switch to"),
    tabTarget: z.union([z.string(), z.number()]).optional().describe("Tab label or ID (resolves via attached tab registry)")
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema).refine((d) => d.tabId !== void 0 || d.tabTarget !== void 0, {
    message: "Provide either tabId (number) or tabTarget (label/id)"
  })
});
var CreateTabTool = z.object({
  name: z.literal("browser_create_tab"),
  description: z.literal("Create a new browser tab and automatically attach it for control. Returns tabId and label that can be used as tabTarget in subsequent operations. NEW TABS OPEN IN THE BACKGROUND BY DEFAULT \u2014 the user's currently-focused tab stays focused so agent work doesn't disrupt user flow. Pass focus=true to override and bring the new tab to front. Use incognito=true for a fresh anonymous session (no cookies, history, or login state from the main profile). Requires 'Allow in incognito' to be enabled for unibrowse in chrome://extensions. When you pass `agent` the new tab is reserved to you so other agents can't drive it."),
  arguments: z.object({
    url: z.string().optional().describe("URL to open in the new tab (default: about:blank)"),
    incognito: z.boolean().optional().describe("Open tab in an incognito window for a fresh anonymous session. All incognito tabs share one persistent incognito window. Requires extension to be allowed in incognito (chrome://extensions)."),
    focus: z.boolean().optional().describe("Bring the new tab to front and focus it (default: false \u2014 opens in background so user flow isn't disrupted)."),
    agent: z.string().optional().describe("Your agent identifier; if supplied, the newly-created tab is reserved to you so other agents can't drive it without passing takeover:true."),
    takeover: z.boolean().optional().describe("Used together with agent: if the new tab's id collides with an existing reservation (rare), set true to forcibly take ownership.")
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema)
});
var CloseTabTool = z.object({
  name: z.literal("browser_close_tab"),
  description: z.literal("Close a specific browser tab. Accepts either a numeric tabId (from browser_list_tabs / browser_create_tab) or a tabTarget label (from browser_list_attached_tabs). Prefer tabTarget when you have a label."),
  arguments: z.object({
    tabId: z.number().optional().describe("Numeric Chrome tab ID to close"),
    tabTarget: z.union([z.string(), z.number()]).optional().describe("Tab label or ID (resolves via attached tab registry)")
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema).refine((d) => d.tabId !== void 0 || d.tabTarget !== void 0, {
    message: "Provide either tabId (number) or tabTarget (label/id)"
  })
});
var CreateWindowTool = z.object({
  name: z.literal("browser_create_window"),
  description: z.literal("Create a new browser window. Opens in the BACKGROUND by default \u2014 the user's currently-focused window stays in front so agent work doesn't disrupt user flow. Pass focused=true to bring the new window to front."),
  arguments: z.object({
    url: z.union([z.string(), z.array(z.string())]).optional().describe("URL or array of URLs to open in the new window (default: about:blank)"),
    focused: z.boolean().optional().describe("Whether the new window should be focused / brought to front (default: false \u2014 opens in background so user flow isn't disrupted)."),
    incognito: z.boolean().optional().describe("Whether to open in incognito/private mode (default: false)"),
    width: z.number().optional().describe("Window width in pixels"),
    height: z.number().optional().describe("Window height in pixels")
    // Same gap as ReloadExtensionTool, found in the same pass: creating a
    // window is a per-BROWSER action and there was no way to say which
    // browser. The handler parses with zod, so an extensionId passed by a
    // caller was silently STRIPPED before routing ever saw it — the failure
    // looked like "it opened somewhere else" rather than like a rejected
    // argument.
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema)
});
var FillFormTool = z.object({
  name: z.literal("browser_fill_form"),
  description: z.literal("Fill multiple form fields at once, including forms inside iframes via frameTarget."),
  arguments: z.object({
    fields: z.array(
      z.object({
        element: z.string().describe("Human-readable field description"),
        ref: z.string().describe("Exact field reference from the page snapshot"),
        value: z.string().describe("Value to fill in the field")
      })
    ).describe("Array of fields to fill")
  }).merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema)
});
var SubmitFormTool = z.object({
  name: z.literal("browser_submit_form"),
  description: z.literal("Submit a form"),
  arguments: ElementSchema.merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetNetworkLogsTool = z.object({
  name: z.literal("browser_get_network_logs"),
  description: z.literal("Get captured network requests/responses. Pass tabTarget to scope to a single tab (avoids cross-tab leakage that used to happen because the log was global). Pass since=<epoch ms> to skip stale entries from earlier in the session. The underlying buffer is capped at 1000 entries (rolling) so a long-lived session can't accumulate megabytes of stale traffic."),
  arguments: z.object({
    filter: z.string().optional().describe("Optional filter to match URLs (e.g., 'api', '.json')"),
    since: z.number().int().nonnegative().optional().describe("Only return entries with timestamp >= this epoch-ms value. Useful to skip stale entries from prior navigations.")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var SnapshotTool = z.object({
  name: z.literal("browser_snapshot"),
  description: z.literal(
    "Capture accessibility snapshot of the current page or a specific iframe. Use this for getting references to elements to interact with. Defaults to interactive elements only (buttons, links, inputs, etc.) to minimize context usage. Set interactiveOnly: false for the full tree. Use frameTarget to snapshot the contents of a specific iframe."
  ),
  arguments: z.object({
    interactiveOnly: z.boolean().default(true).describe("Only include interactive elements (buttons, links, inputs, etc.). Default: true. Set to false for the full accessibility tree."),
    maxDepth: z.number().default(5).describe("Maximum depth to traverse in the accessibility tree. Default: 5.")
  }).merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema)
});
var ClickTool = z.object({
  name: z.literal("browser_click"),
  description: z.literal("Perform click on a web page element, including elements inside iframes via frameTarget."),
  arguments: ElementSchema.merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema)
});
var DragTool = z.object({
  name: z.literal("browser_drag"),
  description: z.literal("Perform drag and drop between two elements"),
  arguments: z.object({
    startElement: z.string().describe(
      "Human-readable source element description used to obtain the permission to interact with the element"
    ),
    startRef: z.string().describe("Exact source element reference from the page snapshot"),
    endElement: z.string().describe(
      "Human-readable target element description used to obtain the permission to interact with the element"
    ),
    endRef: z.string().describe("Exact target element reference from the page snapshot")
  }).merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema)
});
var HoverTool = z.object({
  name: z.literal("browser_hover"),
  description: z.literal("Hover over element on page, including elements inside iframes via frameTarget."),
  arguments: ElementSchema.merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema)
});
var TypeTool = z.object({
  name: z.literal("browser_type"),
  description: z.literal("Type text into editable element, including inputs inside iframes via frameTarget."),
  arguments: ElementSchema.extend({
    text: z.string().describe("Text to type into the element"),
    submit: z.boolean().describe("Whether to submit entered text (press Enter after)")
  }).merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema)
});
var SelectOptionTool = z.object({
  name: z.literal("browser_select_option"),
  description: z.literal("Select an option in a dropdown"),
  arguments: ElementSchema.extend({
    values: z.array(z.string()).describe(
      "Array of values to select in the dropdown. This can be a single value or multiple values."
    )
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ScreenshotTool = z.object({
  name: z.literal("browser_screenshot"),
  description: z.literal("Take a screenshot of the current page"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var SegmentedScreenshotTool = z.object({
  name: z.literal("browser_segmented_screenshot"),
  description: z.literal(
    "Capture multiple screenshots of specific page elements based on CSS selectors. Each selector will produce a separate PNG image file saved to disk. Elements are automatically scrolled into view before capture. Returns array of file paths (not base64) to minimize context usage."
  ),
  arguments: z.object({
    selectors: z.array(z.string()).min(1).describe(
      "Array of CSS selectors identifying elements to capture (e.g., ['.header', '.main', '.footer']). Each element will be captured as a separate image."
    ),
    outputDir: z.string().optional().describe("Output directory for screenshots (default: /tmp)"),
    prefix: z.string().optional().describe("Filename prefix (default: 'segment')"),
    includeLabels: z.boolean().optional().describe(
      "Include element ID or first class name in filename (default: false)"
    )
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetConsoleLogsTool = z.object({
  name: z.literal("browser_get_console_logs"),
  description: z.literal(
    `Get console logs from the browser. Entries are tagged source:"page" (from a tab) or source:"background" (the extension's own service worker \u2014 its errors and handler failures). Pass source:"background" to get ONLY extension errors: an unfiltered call on a busy browser can exceed 200k characters of page noise and bury them.`
  ),
  arguments: z.object({
    source: z.enum(["page", "background", "all"]).optional().describe("Filter by origin: 'background' = the extension's own service worker only, 'page' = tabs only, 'all' = both (default).")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var EvaluateTool = z.object({
  name: z.literal("browser_evaluate"),
  description: z.literal(
    "Evaluate JavaScript expression in the page or inside a specific iframe. Use frameTarget with a frameId from browser_list_frames to execute inside an iframe. CDP bypasses same-origin policy, so cross-origin iframes are accessible."
  ),
  arguments: z.object({
    expression: z.string().describe("JavaScript expression to evaluate in page context")
  }).merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema)
});
var ListFramesTool = z.object({
  name: z.literal("browser_list_frames"),
  description: z.literal(
    "List all frames (iframes) in the current page. Returns frameId, url, parentFrameId, name, and best-effort iframeSelector for each frame. Use the frameId with browser_evaluate, browser_click, browser_type, browser_snapshot, browser_query_dom, and browser_fill_form via their frameTarget parameter to operate inside a frame. CDP bypasses same-origin policy \u2014 cross-origin iframes are accessible."
  ),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var GetErrorsTool = z.object({
  name: z.literal("browser_get_errors"),
  description: z.literal(
    "Get a unified error report across all attached browser tabs and the extension background. Returns page-level errors/warnings (from all tabs), background handler errors, tab health status, and a summary. Use 'since' to filter to errors after a timestamp. Designed for the heal/diagnostic workflow \u2014 call this first when something seems wrong."
  ),
  // ⚠️ MUST merge TabTargetSchema — that is what carries extensionId/tabTarget.
  // Without it, zod's .parse() STRIPS the extensionId the caller passed, the
  // router's payload fallback finds nothing, and the call dies telling the
  // caller to pass the field they just passed. Measured live 2026-08-13 with
  // three browsers connected. Worst possible tool to lose: its own description
  // says "call this first when something seems wrong", so the one tool built
  // for diagnosis was the one that failed in the multi-browser setup that is
  // now normal.
  arguments: z.object({
    since: z.number().optional().describe("Only return errors after this Unix ms timestamp"),
    levelsOnly: z.array(z.string()).optional().describe("Filter page errors to these levels (e.g. ['error']). Defaults to error+warning.")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ReloadExtensionTool = z.object({
  name: z.literal("browser_reload_extension"),
  description: z.literal(
    "Reload the unibrowse Chrome extension (calls chrome.runtime.reload()). Use this to recover from extension crashes, stale state, or after background.js errors. The extension will reconnect automatically within ~2 seconds. All attached tab sessions will need to be re-established after reload. Pass extensionId to choose WHICH browser to reload when several are connected."
  ),
  // ⚠️ This took no target at all until 2026-08-14, while GetErrorsTool
  // directly above it had been given one. Same file, same domain, same
  // handler module — fixed on one, never propagated to its sibling.
  //
  // The consequence was worse here than a missing filter: with several
  // browsers connected there was NO WAY to say which one to reload, so the
  // only honest options were to refuse or to guess. On this fleet a guess can
  // land on Laura's browser or on the container serving other agents' tabs,
  // which is why the tool sat unused and Ben kept being asked to reload by
  // hand — twice asking why I wasn't doing it myself.
  //
  // ExtensionIdSchema rather than TabTargetSchema: reloading is a per-BROWSER
  // action, not a per-tab one, so tabTarget/agent/takeover would be noise.
  arguments: z.object({}).merge(ExtensionIdSchema).merge(MaxTokensSchema)
});
var QueryDOMTool = z.object({
  name: z.literal("browser_query_dom"),
  description: z.literal(
    "Query DOM elements by CSS selector and return basic info without full ARIA tree. Use frameTarget to query inside a specific iframe."
  ),
  arguments: z.object({
    selector: z.string().describe("CSS selector to query elements"),
    limit: z.number().optional().describe("Maximum number of elements to return (default: 10)")
  }).merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema)
});
var GetVisibleTextTool = z.object({
  name: z.literal("browser_get_visible_text"),
  description: z.literal(
    "Get visible text content from the page or a specific element"
  ),
  arguments: z.object({
    selector: z.string().optional().describe("Optional CSS selector to get text from specific element"),
    maxLength: z.number().optional().describe("Maximum text length to return (default: 5000)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetComputedStylesTool = z.object({
  name: z.literal("browser_get_computed_styles"),
  description: z.literal("Get computed CSS styles for an element"),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element"),
    properties: z.array(z.string()).optional().describe(
      "Specific CSS properties to retrieve (e.g. ['display', 'color']). If not specified, returns common layout properties."
    )
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var CheckVisibilityTool = z.object({
  name: z.literal("browser_check_visibility"),
  description: z.literal(
    "Check if element is visible, hidden, in viewport, or has specific display state"
  ),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetAttributesTool = z.object({
  name: z.literal("browser_get_attributes"),
  description: z.literal("Get all attributes or specific attributes of an element"),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element"),
    attributes: z.array(z.string()).optional().describe(
      "Specific attributes to retrieve (e.g. ['href', 'class']). If not specified, returns all attributes."
    )
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var CountElementsTool = z.object({
  name: z.literal("browser_count_elements"),
  description: z.literal("Count number of elements matching a CSS selector"),
  arguments: z.object({
    selector: z.string().describe("CSS selector to count matching elements")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetPageMetadataTool = z.object({
  name: z.literal("browser_get_page_metadata"),
  description: z.literal(
    "Get page metadata including title, description, Open Graph tags, schema.org data, etc."
  ),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var GetFilteredAriaTreeTool = z.object({
  name: z.literal("browser_get_filtered_aria_tree"),
  description: z.literal(
    "Get ARIA tree with filters to reduce token usage (e.g. only interactive elements, specific roles, max depth). Use frameTarget to get the ARIA tree of a specific iframe."
  ),
  arguments: z.object({
    roles: z.array(z.string()).optional().describe(
      "Filter to only include elements with these ARIA roles (e.g. ['button', 'link', 'textbox'])"
    ),
    maxDepth: z.number().optional().describe("Maximum depth to traverse in the tree (default: 5)"),
    interactiveOnly: z.boolean().optional().describe("Only include interactive elements (buttons, links, inputs, etc.)")
  }).merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema)
});
var FindByTextTool = z.object({
  name: z.literal("browser_find_by_text"),
  description: z.literal(
    "Find elements containing specific text (case-insensitive, partial match)"
  ),
  arguments: z.object({
    text: z.string().describe("Text to search for in elements"),
    selector: z.string().optional().describe("Optional CSS selector to narrow search scope"),
    exact: z.boolean().optional().describe("Whether to match exact text (default: false for partial match)"),
    limit: z.number().optional().describe("Maximum number of results to return (default: 10)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetFormValuesTool = z.object({
  name: z.literal("browser_get_form_values"),
  description: z.literal(
    "Get current values of all form fields in a form or the entire page"
  ),
  arguments: z.object({
    formSelector: z.string().optional().describe("Optional CSS selector for a specific form. If not specified, gets all form fields on the page.")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var CheckElementStateTool = z.object({
  name: z.literal("browser_check_element_state"),
  description: z.literal(
    "Check element state: enabled/disabled, checked/unchecked, selected, readonly, required, etc."
  ),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var RequestUserActionTool = z.object({
  name: z.literal("browser_request_user_action"),
  description: z.literal(
    "Request the user to perform an action in the browser. Shows a notification and overlay with instructions. User can complete or reject the request. Captures all interactions from request to completion via the background log. More flexible than request_demonstration - use this for both learning workflows AND getting user assistance."
  ),
  arguments: z.object({
    request: z.string().describe("Clear instructions for what you want the user to do (e.g., 'Please navigate to your shopping cart and add an item')"),
    timeout: z.number().optional().describe("Maximum time to wait for user response in seconds (default: 300s = 5 minutes). After timeout, request is automatically cancelled.")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetInteractionsTool = z.object({
  name: z.literal("browser_get_interactions"),
  description: z.literal(
    "Retrieve user interactions from the background audit log. Interactions are continuously recorded in the background while connected to a tab. Query any time segment with flexible filtering."
  ),
  arguments: z.object({
    startTime: z.number().optional().describe("Start time as Unix timestamp in ms, or negative offset from now (e.g., -60000 = last minute)"),
    endTime: z.number().optional().describe("End time as Unix timestamp in ms, or negative offset from now"),
    limit: z.number().optional().describe("Maximum number of interactions to return (default: 50)"),
    offset: z.number().optional().describe("Skip first N interactions for pagination (default: 0)"),
    types: z.array(z.string()).optional().describe("Filter by interaction types (e.g., ['click', 'keyboard', 'scroll', 'navigation'])"),
    urlPattern: z.string().optional().describe("Filter by URL regex pattern"),
    selectorPattern: z.string().optional().describe("Filter by CSS selector regex pattern"),
    sortOrder: z.enum(["asc", "desc"]).optional().describe("Sort order by timestamp (default: desc - newest first)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var PruneInteractionsTool = z.object({
  name: z.literal("browser_prune_interactions"),
  description: z.literal(
    "Remove interactions from the background audit log based on various criteria. Allows selective pruning by time, count, type, or pattern."
  ),
  arguments: z.object({
    before: z.number().optional().describe("Remove all interactions before this Unix timestamp in ms"),
    after: z.number().optional().describe("Remove all interactions after this Unix timestamp in ms"),
    between: z.tuple([z.number(), z.number()]).optional().describe("Remove interactions within time range [startTime, endTime] in ms"),
    keepLast: z.number().optional().describe("Keep only the last N interactions, remove all older ones"),
    keepFirst: z.number().optional().describe("Keep only the first N interactions, remove all newer ones"),
    removeOldest: z.number().optional().describe("Remove the oldest N interactions"),
    types: z.array(z.string()).optional().describe("Remove only these interaction types"),
    excludeTypes: z.array(z.string()).optional().describe("Remove all interactions except these types"),
    urlPattern: z.string().optional().describe("Remove interactions matching this URL regex"),
    selectorPattern: z.string().optional().describe("Remove interactions matching this selector regex")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var SearchInteractionsTool = z.object({
  name: z.literal("browser_search_interactions"),
  description: z.literal(
    "Search the background interaction log using text queries. Searches across selectors, values, URLs, and element text content."
  ),
  arguments: z.object({
    query: z.string().describe("Text to search for in interactions (searches selectors, values, URLs, element text)"),
    types: z.array(z.string()).optional().describe("Filter by interaction types"),
    startTime: z.number().optional().describe("Start time filter (Unix timestamp in ms or negative offset)"),
    endTime: z.number().optional().describe("End time filter (Unix timestamp in ms or negative offset)"),
    limit: z.number().optional().describe("Maximum number of results (default: 50)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetCookiesTool = z.object({
  name: z.literal("browser_get_cookies"),
  description: z.literal("Get cookies for a specific URL or all cookies"),
  arguments: z.object({
    url: z.string().optional().describe("URL to get cookies for (if not provided, gets all cookies)"),
    name: z.string().optional().describe("Filter by cookie name"),
    domain: z.string().optional().describe("Filter by cookie domain")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var SetCookieTool = z.object({
  name: z.literal("browser_set_cookie"),
  description: z.literal("Set a cookie for a specific URL"),
  arguments: z.object({
    url: z.string().describe("URL to set the cookie for"),
    name: z.string().describe("Cookie name"),
    value: z.string().describe("Cookie value"),
    domain: z.string().optional().describe("Cookie domain"),
    path: z.string().optional().describe("Cookie path (default: /)"),
    secure: z.boolean().optional().describe("Secure flag (default: false)"),
    httpOnly: z.boolean().optional().describe("HttpOnly flag (default: false)"),
    sameSite: z.enum(["no_restriction", "lax", "strict"]).optional().describe("SameSite attribute"),
    expirationDate: z.number().optional().describe("Expiration date in Unix timestamp (seconds since epoch)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var DeleteCookieTool = z.object({
  name: z.literal("browser_delete_cookie"),
  description: z.literal("Delete a specific cookie"),
  arguments: z.object({
    url: z.string().describe("URL of the cookie to delete"),
    name: z.string().describe("Name of the cookie to delete")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ClearCookiesTool = z.object({
  name: z.literal("browser_clear_cookies"),
  description: z.literal("Clear all cookies, optionally filtered by URL or domain"),
  arguments: z.object({
    url: z.string().optional().describe("Only clear cookies for this URL"),
    domain: z.string().optional().describe("Only clear cookies for this domain")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var DownloadFileTool = z.object({
  name: z.literal("browser_download_file"),
  description: z.literal("Download a file from a URL"),
  arguments: z.object({
    url: z.string().describe("URL of the file to download"),
    filename: z.string().optional().describe("Suggested filename for the download"),
    saveAs: z.boolean().optional().describe("Whether to prompt user for save location (default: false)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetDownloadsTool = z.object({
  name: z.literal("browser_get_downloads"),
  description: z.literal("Get list of downloads with optional filtering"),
  arguments: z.object({
    query: z.array(z.string()).optional().describe("Search query terms to filter downloads"),
    orderBy: z.array(z.enum(["startTime", "endTime", "url", "filename", "bytesReceived"])).optional().describe("Fields to order results by"),
    limit: z.number().optional().describe("Maximum number of downloads to return")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var CancelDownloadTool = z.object({
  name: z.literal("browser_cancel_download"),
  description: z.literal("Cancel a download in progress"),
  arguments: z.object({
    downloadId: z.number().describe("ID of the download to cancel")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var OpenDownloadTool = z.object({
  name: z.literal("browser_open_download"),
  description: z.literal("Open a downloaded file"),
  arguments: z.object({
    downloadId: z.number().describe("ID of the download to open")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetClipboardTool = z.object({
  name: z.literal("browser_get_clipboard"),
  description: z.literal("Read text from the clipboard"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var SetClipboardTool = z.object({
  name: z.literal("browser_set_clipboard"),
  description: z.literal("Write text to the clipboard"),
  arguments: z.object({
    text: z.string().describe("Text to write to the clipboard")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var SearchHistoryTool = z.object({
  name: z.literal("browser_search_history"),
  description: z.literal("Search browsing history"),
  arguments: z.object({
    text: z.string().describe("Text to search for in history"),
    startTime: z.number().optional().describe("Start time in milliseconds since epoch"),
    endTime: z.number().optional().describe("End time in milliseconds since epoch"),
    maxResults: z.number().optional().describe("Maximum number of results to return (default: 100)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetHistoryVisitsTool = z.object({
  name: z.literal("browser_get_history_visits"),
  description: z.literal("Get visit details for a URL"),
  arguments: z.object({
    url: z.string().describe("URL to get visit history for")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var DeleteHistoryTool = z.object({
  name: z.literal("browser_delete_history"),
  description: z.literal("Delete specific URLs from history"),
  arguments: z.object({
    urls: z.array(z.string()).describe("URLs to delete from history")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ClearHistoryTool = z.object({
  name: z.literal("browser_clear_history"),
  description: z.literal("Clear browsing history for a time range"),
  arguments: z.object({
    startTime: z.number().describe("Start time in milliseconds since epoch"),
    endTime: z.number().describe("End time in milliseconds since epoch")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetVersionTool = z.object({
  name: z.literal("browser_get_version"),
  description: z.literal("Get browser version information"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var GetSystemInfoTool = z.object({
  name: z.literal("browser_get_system_info"),
  description: z.literal("Get system information including OS, platform, and architecture"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var GetBrowserInfoTool = z.object({
  name: z.literal("browser_get_browser_info"),
  description: z.literal("Get browser capabilities and information"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var GetNetworkStateTool = z.object({
  name: z.literal("browser_get_network_state"),
  description: z.literal("Get current network connection state"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var SetNetworkConditionsTool = z.object({
  name: z.literal("browser_set_network_conditions"),
  description: z.literal("Set network throttling conditions for testing"),
  arguments: z.object({
    offline: z.boolean().optional().describe("Simulate offline mode (default: false)"),
    latency: z.number().optional().describe("Minimum latency in milliseconds (default: 0)"),
    downloadThroughput: z.number().optional().describe("Download throughput in bytes/sec (default: -1 for unlimited)"),
    uploadThroughput: z.number().optional().describe("Upload throughput in bytes/sec (default: -1 for unlimited)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ClearCacheTool = z.object({
  name: z.literal("browser_clear_cache"),
  description: z.literal("Clear browser cache"),
  arguments: z.object({
    cacheStorage: z.boolean().optional().describe("Clear cache storage (default: true)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetBookmarksTool = z.object({
  name: z.literal("browser_get_bookmarks"),
  description: z.literal("Get bookmarks from the browser"),
  arguments: z.object({
    parentId: z.string().optional().describe("Parent folder ID to get bookmarks from (default: root)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var CreateBookmarkTool = z.object({
  name: z.literal("browser_create_bookmark"),
  description: z.literal("Create a new bookmark"),
  arguments: z.object({
    title: z.string().describe("Bookmark title"),
    url: z.string().describe("Bookmark URL"),
    parentId: z.string().optional().describe("Parent folder ID (default: root)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var DeleteBookmarkTool = z.object({
  name: z.literal("browser_delete_bookmark"),
  description: z.literal("Delete a bookmark by ID"),
  arguments: z.object({
    id: z.string().describe("Bookmark ID to delete")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var SearchBookmarksTool = z.object({
  name: z.literal("browser_search_bookmarks"),
  description: z.literal("Search bookmarks by query"),
  arguments: z.object({
    query: z.string().describe("Search query"),
    maxResults: z.number().optional().describe("Maximum number of results (default: 100)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ListExtensionsTool = z.object({
  name: z.literal("browser_list_extensions"),
  description: z.literal("List all installed browser extensions"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var GetExtensionInfoTool = z.object({
  name: z.literal("browser_get_extension_info"),
  description: z.literal("Get detailed information about a specific extension"),
  arguments: z.object({
    id: z.string().describe("Extension ID")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var EnableExtensionTool = z.object({
  name: z.literal("browser_enable_extension"),
  description: z.literal("Enable a disabled extension"),
  arguments: z.object({
    id: z.string().describe("Extension ID to enable")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var DisableExtensionTool = z.object({
  name: z.literal("browser_disable_extension"),
  description: z.literal("Disable an enabled extension"),
  arguments: z.object({
    id: z.string().describe("Extension ID to disable")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var StoreMacroTool = z.object({
  name: z.literal("browser_store_macro"),
  description: z.literal(
    "Store a new executable JavaScript macro for site-specific automation. Macros are reusable routines that encapsulate common workflows. Two kinds: `page` macros (default) run in the page's MAIN-world context via Runtime.evaluate \u2014 they can do DOM work but can't trigger real OS input or call other browser_* tools. `routine` macros run host-side in the mcp-server Node runtime with a `ctx` handle that exposes the browser tool surface as awaitable calls (ctx.navigate, ctx.evaluate, ctx.realisticClick, ctx.waitForUrl, ...). Routines can sequence real CDP input + navigation + page-JS into a single reusable flow. SECURITY NOTE: routine macros execute with full mcp-server process privileges (filesystem, network, env). Treat routine-kind authoring as admin-equivalent \u2014 only store routines you'd run as the server."
  ),
  arguments: z.object({
    site: z.string().describe("Site domain (e.g., 'amazon.com') or '*' for universal macros"),
    category: z.string().describe("Macro category: 'search', 'extraction', 'navigation', 'interaction', 'form', 'util'"),
    name: z.string().describe("Human-readable macro name (unique per site)"),
    description: z.string().describe("What the macro does and when to use it"),
    parameters: z.record(z.object({
      type: z.enum(["string", "number", "boolean", "object", "array"]).describe("Parameter data type"),
      description: z.string().describe("What this parameter is for"),
      required: z.boolean().describe("Whether this parameter is required"),
      default: z.any().optional().describe("Default value if not provided")
    })).describe("Macro parameters schema"),
    code: z.string().describe(
      "JavaScript function code. Page-kind: `(params) => { /* page-JS, DOM only */ return result; }`. Routine-kind: `async (params, ctx) => { /* sequence ctx.* tool calls + JS */ return result; }`."
    ),
    kind: z.enum(["page", "routine"]).optional().describe(
      "Execution model. 'page' (default) = legacy in-page eval, DOM-only, no real input. 'routine' = host-side runner with ctx tool handle (navigate/evaluate/realisticClick/waitForUrl/etc.) composable inside the macro. Routines are admin-trust code."
    ),
    returnType: z.string().describe("Description of what the macro returns"),
    reliability: z.enum(["high", "medium", "low", "untested"]).optional().describe("Reliability rating (default: untested)"),
    tags: z.array(z.string()).optional().describe("Tags for filtering and search")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ListMacrosTool = z.object({
  name: z.literal("browser_list_macros"),
  description: z.literal("List available macros with optional filtering by site, category, or tags. Returns macro metadata without the code."),
  arguments: z.object({
    site: z.string().optional().describe("Filter by site domain or '*' for universal"),
    category: z.string().optional().describe("Filter by category: search, extraction, navigation, interaction, form, util"),
    tags: z.array(z.string()).optional().describe("Filter by tags (returns macros matching ANY tag)"),
    search: z.string().optional().describe("Search in name and description"),
    reliability: z.enum(["high", "medium", "low", "untested"]).optional().describe("Filter by reliability rating"),
    limit: z.number().optional().describe("Maximum number of results (default: 50)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetMacroTool = z.object({
  name: z.literal("browser_get_macro"),
  description: z.literal("Fetch a stored macro's full source by id, including the JavaScript code body, parameter schema, description, usage statistics, and reliability rating. Read-only \u2014 use this to inspect or iterate on a macro before patching with browser_update_macro. Complements browser_list_macros (which returns metadata only)."),
  arguments: z.object({
    id: z.string().describe("Macro ID to fetch")
  }).merge(MaxTokensSchema)
});
var ExecuteMacroTool = z.object({
  name: z.literal("browser_execute_macro"),
  description: z.literal("Execute a stored macro by ID with provided parameters. The macro runs in the page context and returns the result. Pass timeout_ms (default 30000, max 120000) to extend the WebSocket-level wait for long-running macros \u2014 the previous default 30s ceiling could not be overridden from the caller."),
  arguments: z.object({
    id: z.string().describe("Macro ID to execute"),
    params: z.record(z.any()).optional().describe("Parameters to pass to the macro function"),
    timeout_ms: z.number().int().positive().max(12e4).optional().describe("WebSocket-level timeout for this call in ms (default 30000, max 120000). Use for macros known to take longer than 30s (e.g. multi-step network waits).")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var UpdateMacroTool = z.object({
  name: z.literal("browser_update_macro"),
  description: z.literal("Update an existing macro. Creates a new version while preserving the old one. Only the owner can update macros."),
  arguments: z.object({
    id: z.string().describe("Macro ID to update"),
    description: z.string().optional().describe("Updated description"),
    parameters: z.record(z.object({
      type: z.enum(["string", "number", "boolean", "object", "array"]),
      description: z.string(),
      required: z.boolean(),
      default: z.any().optional()
    })).optional().describe("Updated parameters schema"),
    code: z.string().optional().describe("Updated JavaScript code"),
    kind: z.enum(["page", "routine"]).optional().describe(
      "Promote/demote between execution kinds (see browser_store_macro for semantics). Omit to leave unchanged."
    ),
    returnType: z.string().optional().describe("Updated return type description"),
    reliability: z.enum(["high", "medium", "low", "untested"]).optional().describe("Updated reliability rating"),
    tags: z.array(z.string()).optional().describe("Updated tags")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var DeleteMacroTool = z.object({
  name: z.literal("browser_delete_macro"),
  description: z.literal("Delete a macro by ID. This action cannot be undone. Only the owner can delete macros."),
  arguments: z.object({
    id: z.string().describe("Macro ID to delete")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var RealisticMouseMoveTool = z.object({
  name: z.literal("browser_realistic_mouse_move"),
  description: z.literal("Move mouse cursor along a natural bezier curve path to target coordinates. More human-like than instant positioning. Uses CDP Input domain for OS-level events."),
  arguments: z.object({
    x: z.number().describe("Target X coordinate"),
    y: z.number().describe("Target Y coordinate"),
    duration: z.number().optional().describe("Movement duration in milliseconds (default: 500)"),
    currentX: z.number().optional().describe("Current mouse X position (default: 0)"),
    currentY: z.number().optional().describe("Current mouse Y position (default: 0)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var RealisticClickTool = z.object({
  name: z.literal("browser_realistic_click"),
  description: z.literal("Perform a realistic click at coordinates with human-like timing and optional mouse movement. Supports double-clicks. Uses CDP Input domain for OS-level events."),
  arguments: z.object({
    x: z.number().describe("Target X coordinate to click"),
    y: z.number().describe("Target Y coordinate to click"),
    button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button to click (default: 'left')"),
    clickCount: z.number().optional().describe("Number of clicks - 1 for single, 2 for double (default: 1)"),
    moveFirst: z.boolean().optional().describe("Whether to move mouse to position first with bezier curve (default: true)"),
    moveDuration: z.number().optional().describe("Duration of mouse movement in ms if moveFirst is true (default: 300)"),
    currentX: z.number().optional().describe("Current mouse X position for movement calculation (default: 0)"),
    currentY: z.number().optional().describe("Current mouse Y position for movement calculation (default: 0)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var RealisticTypeTool = z.object({
  name: z.literal("browser_realistic_type"),
  description: z.literal("Type text with realistic human-like timing and optional typos. Variable delays between keystrokes. Uses CDP Input domain for OS-level keyboard events."),
  arguments: z.object({
    text: z.string().describe("Text to type"),
    minDelay: z.number().optional().describe("Minimum delay between keystrokes in ms (default: 50)"),
    maxDelay: z.number().optional().describe("Maximum delay between keystrokes in ms (default: 150)"),
    mistakeChance: z.number().optional().describe("Probability of making a typo that gets corrected, 0-1 (default: 0)"),
    pressEnter: z.boolean().optional().describe("Whether to press Enter after typing (default: false)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var StartVideoRecordingTool = z.object({
  name: z.literal("browser_start_video_recording"),
  description: z.literal(
    "Start recording video of the current tab using Chrome's tab capture API. Records a WebM video of exactly what is visible in the tab. After starting, use any browser interaction tools (scroll, click, mouse move, type, navigate) to create scripted page interactions \u2014 all will be captured in the video. Call browser_stop_video_recording when done to save the video to a file."
  ),
  arguments: z.object({}).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var StopVideoRecordingTool = z.object({
  name: z.literal("browser_stop_video_recording"),
  description: z.literal(
    "Stop the active tab video recording and save it to a file. Returns the path to the saved WebM video file. The video captures everything that happened in the tab since browser_start_video_recording was called."
  ),
  arguments: z.object({
    output_path: z.string().optional().describe("File path to save the video. Defaults to /tmp/unibrowse_video_<timestamp>.webm")
    // TabTargetSchema was missing here while browser_start_video_recording had
    // it — so a caller could START a recording on a named extension and then
    // have no way to say which browser to STOP. In a multi-extension setup
    // wsFor() then threw "Multiple extensions are connected", and the schema
    // offered no field to satisfy it. Additive and optional; nothing breaks.
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ListAttachedTabsTool = z.object({
  name: z.literal("browser_list_attached_tabs"),
  description: z.literal(
    "List all tabs that have debugger attached with their labels and IDs. Use this to find valid tabTarget values for browser_navigate, browser_snapshot, browser_click, and all other tab-targeting operations. Only attached tabs can be targeted \u2014 use browser_attach_tab or browser_create_tab to attach new tabs. URL query-string values and fragments are redacted by default (origin, path and parameter names are kept) because a long-attached tab puts its URL into every caller's context; pass fullUrls:true if you genuinely need them."
  ),
  arguments: z.object({
    live: z.boolean().optional().describe(
      "Add liveUrl/liveTitle read from Chrome's CURRENT tab state, plus urlChanged/titleChanged flags. \u26D4 The plain `url` and `title` fields are captured when a tab is ATTACHED and are NEVER updated on navigation \u2014 a tab that has since navigated still reports the page it left. Pass live:true whenever you need to know where a tab actually is now: picking a tab by title or URL, or verifying one has not moved. Costs one chrome.tabs.get per attached tab."
    ),
    // ⛔ Opt-IN, never opt-out. A tab attached and left broadcasts its query
    // string to every agent that lists tabs, and on 2026-08-17 that was a
    // stranger's name, home address, phone, email and card last-4 landing in
    // two seats' contexts. A default-full flag would have left the exposure in
    // place for everyone who never read this schema, which is everyone.
    fullUrls: z.boolean().optional().describe(
      "Return unredacted URLs including query-string values and fragments. Default false. Only set this when you need a specific parameter value \u2014 the redacted form keeps origin, path and parameter names, which is enough to identify a tab."
    )
  }).merge(MaxTokensSchema)
});
var SetTabLabelTool = z.object({
  name: z.literal("browser_set_tab_label"),
  description: z.literal(
    "Set or update a tab's label. Labels are used to identify tabs in a human-readable way."
  ),
  arguments: z.object({
    tabTarget: z.union([z.number(), z.string()]).describe("Tab identifier (tab ID or current label) of the tab to update"),
    label: z.string().describe("The new label for the tab")
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema)
});
var DetachTabTool = z.object({
  name: z.literal("browser_detach_tab"),
  description: z.literal(
    "Detach debugger from a specific tab. This removes the tab from the list of attached tabs. Accepts either a numeric tabId or a tabTarget label."
  ),
  arguments: z.object({
    tabId: z.number().optional().describe("Numeric Chrome tab ID to detach"),
    tabTarget: z.union([z.string(), z.number()]).optional().describe("Tab label or ID (resolves via attached tab registry)")
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema).refine((d) => d.tabId !== void 0 || d.tabTarget !== void 0, {
    message: "Provide either tabId (number) or tabTarget (label/id)"
  })
});
var GetActiveTabTool = z.object({
  name: z.literal("browser_get_active_tab"),
  description: z.literal(
    "Get information about the currently active (last-used) tab. Returns tab ID, label, URL, and last used timestamp."
  ),
  arguments: z.object({}).merge(ExtensionIdSchema).merge(MaxTokensSchema)
});
var AttachTabTool = z.object({
  name: z.literal("browser_attach_tab"),
  description: z.literal(
    "Attach debugger to a browser tab. Can attach to an existing tab by ID or open a new tab with a URL. Use this to start controlling a tab before performing operations on it. When you pass `agent`, the tab is reserved to you and other agents will get a tab-reserved error on attempted control."
  ),
  arguments: z.object({
    tabId: z.number().optional().describe("The tab ID to attach to (if attaching to existing tab)"),
    autoOpenUrl: z.string().optional().describe("URL to open in a new tab and attach to (if opening new tab)"),
    label: z.string().optional().describe("Optional label to assign to the tab after attaching"),
    agent: z.string().optional().describe("Your agent identifier; if supplied, the attached tab is reserved to you."),
    takeover: z.boolean().optional().describe("When attaching to a tab already reserved by a different agent, set true to forcibly transfer ownership.")
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema)
});
var ReserveTabTool = z.object({
  name: z.literal("browser_reserve_tab"),
  description: z.literal(
    "Explicitly reserve an already-attached tab for an agent. Useful when claiming a tab someone else created or previously released. Requires `agent`. Returns tab-reserved if another agent owns it and `takeover` isn't set; pass takeover:true to forcibly transfer (logged in tab history)."
  ),
  arguments: z.object({
    tabTarget: z.union([z.number(), z.string()]).describe("Tab ID or label to reserve"),
    agent: z.string().describe("Your agent identifier"),
    takeover: z.boolean().optional().describe("Forcibly take over from the current owner")
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema)
});
var ReleaseTabTool = z.object({
  name: z.literal("browser_release_tab"),
  description: z.literal(
    "Release the reservation on a tab so another agent can claim it. The owner is logged in the tab's history. If `agent` is supplied, only the matching owner may release; if omitted, the release is permissive."
  ),
  arguments: z.object({
    tabTarget: z.union([z.number(), z.string()]).describe("Tab ID or label to release"),
    agent: z.string().optional().describe("Your agent identifier (must match the current owner unless omitted)")
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema)
});
var RecordingStepSchema = z.object({
  id: z.number().describe("1-based sequential step ID"),
  type: z.string().describe("Interaction type: click, input, keydown, scroll, etc."),
  timestamp: z.number().describe("Milliseconds offset from recording startTime"),
  url: z.string().optional().describe("Page URL when this step occurred"),
  element: z.object({
    selector: z.string().optional(),
    tagName: z.string().optional(),
    text: z.string().optional(),
    value: z.string().optional()
  }).optional().describe("Element context"),
  note: z.string().optional().describe("User annotation for this step"),
  value: z.string().optional().describe("Input value (for input/change events)"),
  key: z.string().optional().describe("Key name (for keydown events)"),
  x: z.number().optional().describe("Click X coordinate"),
  y: z.number().optional().describe("Click Y coordinate"),
  scrollX: z.number().optional(),
  scrollY: z.number().optional(),
  // Selector capture step fields (type === 'selector_capture')
  name: z.string().optional().describe("User-assigned name for the captured data point"),
  description: z.string().optional().describe("What this selector captures"),
  selector: z.string().optional().describe("The chosen CSS selector"),
  matchCount: z.number().optional().describe("Number of page elements matched"),
  selectorOptions: z.array(z.object({
    strategy: z.string(),
    selector: z.string(),
    count: z.number()
  })).optional(),
  elements: z.array(z.object({
    tagName: z.string(),
    text: z.string().optional()
  })).optional(),
  region: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number()
  }).optional()
});
var SaveRecordingTool = z.object({
  name: z.literal("browser_save_recording"),
  description: z.literal(
    "Save a user interaction recording to MongoDB for later retrieval by agents. Called internally by the extension after the user reviews and confirms a recording."
  ),
  arguments: z.object({
    sessionId: z.string().describe("Session ID from the recording session"),
    title: z.string().describe("User-provided title for the recording"),
    description: z.string().optional().describe("Optional description of what the recording demonstrates"),
    tags: z.array(z.string()).optional().describe("Tags for categorization and search"),
    startUrl: z.string().optional().describe("URL where the recording started"),
    startTime: z.number().describe("Unix timestamp (ms) when recording started"),
    endTime: z.number().describe("Unix timestamp (ms) when recording ended"),
    duration: z.number().describe("Recording duration in milliseconds"),
    steps: z.array(RecordingStepSchema).describe("Array of recorded interaction steps")
  })
});
var ListRecordingsTool = z.object({
  name: z.literal("browser_list_recordings"),
  description: z.literal(
    "List saved session recordings from MongoDB. Returns metadata for each: title, description, tags, startUrl, duration, pages visited, network request count, interaction count, and annotations. Use browser_get_recording with includeEvents=true to get full events for analysis."
  ),
  arguments: z.object({
    search: z.string().optional().describe("Search term to match against title and description"),
    tags: z.array(z.string()).optional().describe("Filter by tags (returns recordings matching any tag)"),
    startUrl: z.string().optional().describe("Filter by starting URL (partial match)"),
    limit: z.number().optional().describe("Maximum number of results to return (default: 50)")
  }).merge(MaxTokensSchema)
});
var GetRecordingTool = z.object({
  name: z.literal("browser_get_recording"),
  description: z.literal(
    "Get a saved session recording by ID. Returns metadata by default. Use includeInteractions/includeNetwork/includeStats to fetch event data, with optional filtering by time range, interaction type, selector, URL pattern, HTTP method/status, and limit/offset pagination. includeEvents=true is shorthand for includeInteractions+includeNetwork. Use browser_list_recordings to find IDs."
  ),
  arguments: z.object({
    id: z.string().describe("The recording ID to retrieve"),
    // what to include
    includeEvents: z.boolean().optional().describe("Shorthand for includeInteractions=true + includeNetwork=true."),
    includeInteractions: z.boolean().optional().describe("Include user interaction events (clicks, scrolls, inputs, navigations)."),
    includeNetwork: z.boolean().optional().describe("Include network request/response entries."),
    includeStats: z.boolean().optional().describe("Include summary statistics: counts by interaction type, top URLs, network error rate, time span."),
    includeAnnotations: z.boolean().optional().describe(
      "Include user-drawn annotations (pencil / rectangle / lasso) captured during the recording. Each annotation has: id, timestamp, tool, shape, bbox, viewport, domTargets (ranked list of DOM elements under the shape \u2014 xpath + css + text), note, pageUrl, pageTitle, and screenshotPng (base64 PNG of the cropped area, often 100-300KB). Agents use this to understand what ben highlighted + what he wants done."
    ),
    annotationStripScreenshots: z.boolean().optional().describe(
      "When includeAnnotations is true, drop the base64 screenshot PNGs from each annotation (keep only metadata + shape + note + domTargets). Use this when you just want the annotation list for navigation and don't need the visuals \u2014 saves response token budget."
    ),
    // time range
    startTime: z.number().optional().describe("Filter events at or after this Unix timestamp (ms)."),
    endTime: z.number().optional().describe("Filter events at or before this Unix timestamp (ms)."),
    // interaction filters
    interactionTypes: z.array(z.string()).optional().describe("Filter interactions by kind, e.g. ['click', 'scroll', 'mousemove', 'dom_mutation', 'keydown', 'navigate']."),
    selectorPattern: z.string().optional().describe("Regex applied to interaction selector strings."),
    // network filters
    networkUrlPattern: z.string().optional().describe("Regex applied to network entry URLs."),
    networkMethod: z.string().optional().describe("Filter network entries by HTTP method (GET, POST, etc.)."),
    networkStatusMin: z.number().optional().describe("Keep network entries with status >= this value."),
    networkStatusMax: z.number().optional().describe("Keep network entries with status <= this value."),
    // pagination
    limit: z.number().optional().describe("Max interactions or network entries to return (default: 100)."),
    offset: z.number().optional().describe("Skip first N results for pagination (default: 0)."),
    // body size controls — finance reported a single 80KB+ response body blowing
    // past MCP's 25k-token cap even with limit=30. Two knobs:
    bodyMaxBytes: z.number().optional().describe(
      "Truncate each request/response body to this many bytes (default: no truncation). When applied, the truncated body has `...[truncated N more bytes]` appended so the consumer knows it's incomplete. Use this to inspect many entries without hitting the MCP response token cap (~25k)."
    ),
    excludeBodies: z.boolean().optional().describe(
      "When true, requestBody and responseBody are dropped entirely from network entries; headers, status, URL, method, and timing are preserved. Use for metadata-only sweeps (find candidate URLs/methods first, then re-fetch with bodyMaxBytes for specific ones)."
    )
  }).merge(MaxTokensSchema)
});
var UpdateRecordingTool = z.object({
  name: z.literal("browser_update_recording"),
  description: z.literal(
    "Update the title, description, or tags of a saved session recording. Use this to annotate sessions after reviewing them."
  ),
  arguments: z.object({
    id: z.string().describe("The recording ID to update"),
    title: z.string().optional().describe("New title for the recording"),
    description: z.string().optional().describe("Description of what this session demonstrates"),
    tags: z.array(z.string()).optional().describe("Tags for categorization (replaces existing tags)")
  }).merge(MaxTokensSchema)
});
var DeleteRecordingTool = z.object({
  name: z.literal("browser_delete_recording"),
  description: z.literal(
    "Delete a saved user interaction recording by ID."
  ),
  arguments: z.object({
    id: z.string().describe("The recording ID to delete")
  }).merge(MaxTokensSchema)
});
var GetRecordingScreenshotTool = z.object({
  name: z.literal("browser_get_recording_screenshot"),
  description: z.literal(
    "Get a screenshot of a session recording at a specific timestamp. Two modes: 'video' extracts a frame from the recorded video using ffmpeg (fast, full-page); 'dom' replays rrweb events in a live browser tab and screenshots the reconstructed DOM (supports selector highlighting, works even without video). 'auto' uses video if available, falls back to dom. Returns a PNG image. Use browser_get_recording to find timestamps from interactions/network entries."
  ),
  arguments: z.object({
    id: z.string().describe("Recording ID"),
    timestamp: z.number().describe("Unix timestamp in ms to render. Use 0 for the start of the recording."),
    selector: z.string().optional().describe("CSS selector to highlight in the DOM replay (dom/auto mode). Draws a red outline around the matched element."),
    mode: z.enum(["video", "dom", "auto"]).optional().describe("Screenshot source: 'video' (ffmpeg frame), 'dom' (rrweb replay), 'auto' (default \u2014 video if available, else dom)."),
    tabId: z.number().optional().describe("For video mode with multi-tab recordings: which tab's video to use. Defaults to primaryTabId.")
  }).merge(MaxTokensSchema)
});
var StartSessionRecordingTool = z.object({
  name: z.literal("browser_start_session_recording"),
  description: z.literal(
    "Start a rich session recording on the targeted browser tab. Captures: full DOM mutations (rrweb), all XHR/fetch network traffic with request/response bodies, mouse interactions, and tab video. Survives cross-domain navigation \u2014 if the recorded tab navigates, the recording follows it. Returns a sessionId. Use browser_stop_session_recording when done \u2014 the review URL is returned and a review tab opens automatically (pass openReview:false on stop to suppress). Pin to a specific browser via extensionId in multi-extension mode; use tabTarget to record a non-active tab. Agents can use this to show ben what they did during a multi-step flow."
  ),
  arguments: z.object({}).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var StopSessionRecordingTool = z.object({
  name: z.literal("browser_stop_session_recording"),
  description: z.literal(
    "Stop ONE session recording, save its captured data (DOM events, network traffic, video) to the server, and return the review URL. Recordings are per-tab and SEVERAL can run at once: name which one with sessionId, or with tabTarget to stop whichever recording covers that tab. If exactly one is live you may omit both. \u26D4 If several are live and you name neither, this REFUSES and lists them rather than guessing \u2014 stopping the wrong session destroys the wrong evidence. By default a review tab opens automatically; pass openReview:false to suppress (useful for headless agent flows). Review URL is always returned in the response regardless."
  ),
  arguments: z.object({
    openReview: z.boolean().optional().describe(
      "Whether to auto-open the review page in a new tab when the recording stops (default: true). Pass false for headless / programmatic flows that just want the reviewUrl back without polluting the browser with a new tab."
    ),
    sessionId: z.string().optional().describe(
      "Which recording to stop, as returned by browser_start_session_recording. Required when more than one recording is live, unless you identify it by tabTarget instead."
    )
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetSessionRecordingStateTool = z.object({
  name: z.literal("browser_get_session_recording_state"),
  description: z.literal(
    "List the session recordings in progress on the targeted browser. Recordings are per-tab and several can run at once, so this returns { isRecording, count, recordings: [...] } \u2014 `recordings` is ALWAYS an array, one entry per live recording with its sessionId, tabId, elapsedMs and event counts. Pass tabTarget to ask only about the recording covering that tab. Use it before stopping to learn which sessionId you mean, or at the start of a flow to avoid double-starting a tab."
  ),
  arguments: z.object({}).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var LaunchIsolatedChromeTool = z.object({
  name: z.literal("browser_launch_isolated_chrome"),
  description: z.literal(
    "Launch Chrome in isolated mode with the Browser MCP extension pre-loaded. Creates an isolated profile separate from your main browser, useful for testing, automation, and development. The extension will auto-connect to the MCP server."
  ),
  arguments: z.object({
    profileName: z.string().optional().describe("Name for the isolated profile (default: 'unibrowse-test'). Each profile is stored separately in .chrome-profiles/"),
    url: z.union([z.string(), z.array(z.string())]).optional().describe("URL or array of URLs to open on launch (default: chrome://extensions/)"),
    width: z.number().optional().describe("Window width in pixels"),
    height: z.number().optional().describe("Window height in pixels"),
    headless: z.boolean().optional().describe(
      "Launch in headless / no-user-window-pollution mode (default: false). When the chromium-host sidecar is active (UNIBROWSE_CHROMIUM_HOST set on the server), `headless: true` routes through the sidecar with Xvfb-headful rendering \u2014 giving you a fully isolated chromium (no user-Chrome interaction) AND a real-browser fingerprint that defeats Auth0/Cloudflare/Akamai anti-bot gates. If you specifically need the lighter --headless=new flag (faster, but detectable, suitable only for pure scraping where anti-bot doesn't matter), pass `realHeadless: true` as well."
    ),
    realHeadless: z.boolean().optional().describe(
      "Opt into chromium's `--headless=new` flag instead of Xvfb-headful when `headless: true` is set and the sidecar is active. Lighter / faster, but anti-bot detectable. Only useful for pure scraping where the target doesn't fingerprint headless Chrome."
    ),
    autoAttach: z.boolean().optional().describe(
      "After spawn, automatically attach the URL tab(s) to the unibrowse debugger so the agent can immediately drive them with browser_navigate/evaluate/click/etc without a separate browser_attach_tab call. Default true. When true, the response includes `tabId` (first url) and `tabIds` (all urls). When false (or when no url was provided), only `extensionId` is returned and the caller must attach explicitly."
    ),
    agent: z.string().optional().describe(
      "Your agent identifier. When supplied, attached tabs are reserved to you so other agents can't drive them without takeover. Forwarded to the implicit browser_create_tab calls that auto-attach the launch URLs."
    ),
    freshProfile: z.boolean().optional().describe("Always start with a fresh profile, DELETING any existing data (cookies, history, auth). Default: TRUE \u2014 note the destructive value is the default. Set to false to persist profile data between sessions. Profiles on the sidecar's persistent allowlist refuse to be wiped by this flag alone; see forceProfileName."),
    forceProfileName: z.string().optional().describe("Override for wiping a PERSISTENT profile with freshProfile:true. Must equal profileName verbatim, which is deliberate friction: a plain boolean force flag gets set once in a wrapper and silently inherited by every later call. Persistent profiles hold long-lived auth that is expensive to rebuild \u2014 prefer a freshProfile:false restart, which reuses the profile and self-heals. Overrides are logged and the owning session is DM'd.")
  }).merge(MaxTokensSchema)
});
var CloseIsolatedChromeTool = z.object({
  name: z.literal("browser_close_isolated_chrome"),
  description: z.literal(
    "Shut down an isolated chromium launched by browser_launch_isolated_chrome, freeing its processes and its paired Xvfb display. This is the destroy counterpart to that tool \u2014 without it every launched instance leaks until someone reaps it by hand (browser_close_tab only reaps renderers and returns success while the browser lives on). PROCESS-ONLY: never deletes the profile directory, so auth state survives and the instance can be relaunched with freshProfile:false."
  ),
  arguments: z.object({
    extensionId: z.string().optional().describe("extensionId of the instance to close, as returned by browser_launch_isolated_chrome or browser_list_attached_tabs. Either this or profileName is required."),
    profileName: z.string().optional().describe("Profile name of the instance to close (e.g. 'swap-ben'). More reliable than extensionId for instances launched before the current mcp-server started. Either this or extensionId is required."),
    forceProfileName: z.string().optional().describe("Required to close an instance whose profile is on the persistent allowlist. Must equal the profile name verbatim. Persistent profiles are long-lived on purpose (e.g. auth brokers that look idle by design); closing one is cheap to recover from but should be deliberate. The owning session is notified."),
    caller: z.string().optional().describe("Your agent identifier, recorded in the override audit line and the owner notification.")
  }).merge(MaxTokensSchema)
});
var WatchSourcesTool = z.object({
  name: z.literal("browser_watch_sources"),
  description: z.literal(
    "List every event source browser_watch_create can watch, with each one's execution home, permission status, rough event volume, and \u2014 most importantly \u2014 the EXACT shape the predicate will be handed. Call this before creating a watch: the predicate's argument differs per source, and guessing it is the main way a watch silently never fires."
  ),
  arguments: z.object({
    filter: z.string().optional().describe("Optional substring to filter source ids by, e.g. 'Network' or 'chrome.downloads'.")
  })
});
var WatchCreateTool = z.object({
  name: z.literal("browser_watch_create"),
  description: z.literal(
    "Arm a watch on a browser event source and get pushed a notification when your predicate matches \u2014 instead of polling the page. Events are FIRE-AND-FORGET: if no listener is attached when one fires, it is dropped, never queued. The watch is cleared when the tab detaches, the extension disconnects, its ttl elapses, or you delete it. Call browser_watch_sources first to see the sources and their predicate shapes."
  ),
  arguments: z.object({
    source: z.string().describe("Source id from browser_watch_sources, e.g. 'cdp.Network.eventSourceMessageReceived'."),
    predicate: z.string().optional().describe(
      `JS arrow function deciding whether to fire, e.g. "(e) => e.data.includes('[DONE]')". Omit to fire on every event that passes the prefilter. Evaluated ON THE SERVER for worker-home sources (MV3's CSP forbids evaluating a string as JS in a service worker) and IN THE PAGE for dom.*/page.* sources. A predicate that throws at runtime does not fire and does not kill the watch. NOTE: admin-trust code, same boundary as a stored routine.`
    ),
    prefilter: z.any().optional().describe(
      "Declarative, eval-free matcher applied IN THE EXTENSION so non-matching events never cross the WebSocket. Strongly wanted on high-volume sources (see `volume` in browser_watch_sources). Shape: {path, op, value} where op is includes|equals|notEquals|regex|startsWith|endsWith|exists|missing|gt|lt, combined with {all:[\u2026]}, {any:[\u2026]}, {not:{\u2026}}. Example: {path:'request.url', op:'includes', value:'/api/chat'}. Without one, EVERY event of that source crosses the wire before your predicate is applied."
    ),
    sink: z.object({
      kind: z.enum(["atc", "webhook", "buffer"]).describe("Where matches are delivered."),
      to: z.string().optional().describe("atc only: recipient. Defaults to your `agent`, so events land in your own session."),
      subject: z.string().optional().describe("atc only: message subject."),
      priority: z.enum(["info", "warning", "critical"]).optional().describe("atc only."),
      url: z.string().optional().describe("webhook only: the URL to POST to."),
      headers: z.record(z.string()).optional().describe("webhook only: extra request headers."),
      maxBuffered: z.number().optional().describe("buffer only: queue depth (default 100).")
    }).optional().describe("Delivery target. Defaults to {kind:'atc'}, which DMs your own agent session."),
    config: z.record(z.any()).optional().describe(
      "Per-source configuration for dom.*/page.* sources \u2014 e.g. {selector:'#chat'} for dom.mutation and dom.elementText, {eventName:'my-app-ready'} for page.event. The required keys are named in each source's description from browser_watch_sources."
    ),
    tabTarget: z.union([z.number(), z.string()]).optional().describe("Tab id or label to scope the watch to. Omit for a browser-wide source."),
    extensionId: z.string().optional().describe("Which browser to arm in. Required when several extensions are connected."),
    agent: z.string().optional().describe("Your agent identifier. The atc sink delivers here by default \u2014 set it or events have nowhere to go."),
    options: z.object({
      once: z.boolean().optional().describe("Disarm after the first match."),
      ttlMs: z.number().optional().describe("Auto-disarm after this many ms."),
      maxPerMin: z.number().optional().describe("Rate cap. Exceeding 10x this in one minute trips a breaker that disarms the watch AND tells you it did."),
      coalesce: z.object({
        windowMs: z.number(),
        mode: z.enum(["last", "batch", "count"])
      }).optional().describe("Group bursts. For a streamed response you usually want the end, not every token.")
    }).optional()
  })
});
var WatchListTool = z.object({
  name: z.literal("browser_watch_list"),
  description: z.literal(
    "List watches this server holds. `armed` is the EXTENSION's last raw answer, not the server's belief: 'unknown' means the extension has never reported, which is different from false. This report never repairs state on read."
  ),
  arguments: z.object({
    extensionId: z.string().optional().describe("Filter to one browser."),
    tabTarget: z.union([z.number(), z.string()]).optional().describe("Filter to one tab."),
    agent: z.string().optional().describe("Filter to watches you created."),
    refresh: z.boolean().optional().describe("Re-query the extension for actual armed state and record the answer. Off by default so listing stays side-effect-free.")
  })
});
var WatchDeleteTool = z.object({
  name: z.literal("browser_watch_delete"),
  description: z.literal("Delete a watch and disarm it in the extension."),
  arguments: z.object({
    watchId: z.string().describe("The watchId returned by browser_watch_create."),
    extensionId: z.string().optional().describe("Which browser holds it.")
  })
});
var WatchPollTool = z.object({
  name: z.literal("browser_watch_poll"),
  description: z.literal(
    "Drain events from a watch whose sink is 'buffer', blocking until one arrives or the timeout elapses. This is the 'wait until X happens' shape; use an atc or webhook sink when you want to be notified without waiting."
  ),
  arguments: z.object({
    watchId: z.string().describe("The watchId returned by browser_watch_create."),
    timeoutMs: z.number().optional().describe("How long to block (default 15000, max 120000). A timeout is an answer, not an error.")
  })
});

// src/utils/response-helpers.ts
import { encodingForModel } from "js-tiktoken";
var DEFAULT_MAX_TOKENS = process.env.MAX_MCP_OUTPUT_TOKENS ? parseInt(process.env.MAX_MCP_OUTPUT_TOKENS, 10) : 25e3;
var tokenEncoder = null;
function getTokenEncoder() {
  if (!tokenEncoder) {
    tokenEncoder = encodingForModel("gpt-4");
  }
  return tokenEncoder;
}
function estimateTokens(text) {
  if (text == null) return 0;
  try {
    const encoder = getTokenEncoder();
    return encoder.encode(text).length;
  } catch (error) {
    return Math.ceil(text.length / 4);
  }
}
function truncateToTokens(text, maxTokens) {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= maxTokens) {
    return text;
  }
  let left = 0;
  let right = text.length;
  let bestLength = 0;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const truncated2 = text.substring(0, mid);
    const tokens = estimateTokens(truncated2);
    if (tokens <= maxTokens - 100) {
      bestLength = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  const truncated = text.substring(0, bestLength);
  const truncationNotice = `

[... Response truncated: ${currentTokens} tokens \u2192 ${maxTokens} tokens limit. Original size: ${text.length} chars, truncated to: ${bestLength} chars ...]`;
  return truncated + truncationNotice;
}
function jsonResponse(data, pretty = true, maxTokens = DEFAULT_MAX_TOKENS) {
  let text = JSON.stringify(data, null, pretty ? 2 : 0) ?? "null";
  if (maxTokens && maxTokens > 0) {
    text = truncateToTokens(text, maxTokens);
  }
  return {
    content: [
      {
        type: "text",
        text
      }
    ]
  };
}
function textResponse(text, maxTokens = DEFAULT_MAX_TOKENS) {
  if (maxTokens && maxTokens > 0) {
    text = truncateToTokens(text, maxTokens);
  }
  return {
    content: [
      {
        type: "text",
        text
      }
    ]
  };
}
function imageResponse(base64Data, mimeType = "image/png", maxTokens = DEFAULT_MAX_TOKENS) {
  if (maxTokens && maxTokens > 0) {
    const currentTokens = estimateTokens(base64Data);
    if (currentTokens > maxTokens) {
      const errorMsg = `[Image Response Truncated]

Image size (${currentTokens} tokens) exceeds maximum allowed tokens (${maxTokens}).

Original data size: ${base64Data.length} characters
Estimated tokens: ${currentTokens}
Limit: ${maxTokens} tokens

Consider:
1. Reducing screenshot area
2. Taking screenshot of specific element instead of full page
3. Using lower quality/resolution
4. Increasing MAX_MCP_OUTPUT_TOKENS environment variable`;
      return {
        content: [
          {
            type: "text",
            text: errorMsg
          }
        ]
      };
    }
  }
  return {
    content: [
      {
        type: "image",
        data: base64Data,
        mimeType
      }
    ]
  };
}
function errorResponse(message, includeStack = false, error, maxTokens = DEFAULT_MAX_TOKENS) {
  let text = message;
  if (includeStack && error?.stack) {
    text += `

Stack trace:
${error.stack}`;
  }
  if (maxTokens && maxTokens > 0) {
    text = truncateToTokens(text, maxTokens);
  }
  return {
    content: [
      {
        type: "text",
        text
      }
    ],
    isError: true
  };
}

// src/tools/bookmarks.ts
var getBookmarks = {
  schema: {
    name: GetBookmarksTool.shape.name.value,
    description: GetBookmarksTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetBookmarksTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      const validatedParams = GetBookmarksTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_bookmarks", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get bookmarks: ${error.message}`, false, error, max_tokens);
    }
  }
};
var createBookmark = {
  schema: {
    name: CreateBookmarkTool.shape.name.value,
    description: CreateBookmarkTool.shape.description.value,
    inputSchema: zodToJsonSchema(CreateBookmarkTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      const validatedParams = CreateBookmarkTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_create_bookmark", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to create bookmark: ${error.message}`, false, error, max_tokens);
    }
  }
};
var deleteBookmark = {
  schema: {
    name: DeleteBookmarkTool.shape.name.value,
    description: DeleteBookmarkTool.shape.description.value,
    inputSchema: zodToJsonSchema(DeleteBookmarkTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      const validatedParams = DeleteBookmarkTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_delete_bookmark", validatedParams);
      return textResponse(`Bookmark deleted successfully (ID: ${validatedParams.id})`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to delete bookmark: ${error.message}`, false, error, max_tokens);
    }
  }
};
var searchBookmarks = {
  schema: {
    name: SearchBookmarksTool.shape.name.value,
    description: SearchBookmarksTool.shape.description.value,
    inputSchema: zodToJsonSchema(SearchBookmarksTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      const validatedParams = SearchBookmarksTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_search_bookmarks", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to search bookmarks: ${error.message}`, false, error, max_tokens);
    }
  }
};

// src/tools/clipboard.ts
import { zodToJsonSchema as zodToJsonSchema2 } from "zod-to-json-schema";
var getClipboard = {
  schema: {
    name: GetClipboardTool.shape.name.value,
    description: GetClipboardTool.shape.description.value,
    inputSchema: zodToJsonSchema2(GetClipboardTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = GetClipboardTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_clipboard", validatedParams);
      return textResponse(result.text, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get clipboard: ${error.message}`, false, error, max_tokens);
    }
  }
};
var setClipboard = {
  schema: {
    name: SetClipboardTool.shape.name.value,
    description: SetClipboardTool.shape.description.value,
    inputSchema: zodToJsonSchema2(SetClipboardTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = SetClipboardTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_set_clipboard", validatedParams);
      return textResponse(`Clipboard set to: ${validatedParams.text.substring(0, 50)}${validatedParams.text.length > 50 ? "..." : ""}`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to set clipboard: ${error.message}`, false, error, max_tokens);
    }
  }
};

// src/tools/common.ts
import { zodToJsonSchema as zodToJsonSchema3 } from "zod-to-json-schema";

// src/utils/aria-snapshot.ts
async function captureAriaSnapshot(context, status = "", tabTarget, maxTokens, interactiveOnly = true, maxDepth = 5) {
  const url = await context.sendSocketMessage("getUrl", tabTarget !== void 0 ? { tabTarget } : void 0);
  const title = await context.sendSocketMessage("getTitle", tabTarget !== void 0 ? { tabTarget } : void 0);
  const snapshotParams = { interactiveOnly, maxDepth };
  if (tabTarget !== void 0) snapshotParams.tabTarget = tabTarget;
  const snapshot2 = await context.sendSocketMessage("browser_snapshot", snapshotParams);
  return textResponse(
    `${status ? `${status}
` : ""}
- Page URL: ${url}
- Page Title: ${title}
- Page Snapshot
\`\`\`yaml
${snapshot2}
\`\`\`
`,
    maxTokens
  );
}

// src/tools/common.ts
var navigate = (snapshot2) => ({
  schema: {
    name: NavigateTool.shape.name.value,
    description: NavigateTool.shape.description.value,
    inputSchema: zodToJsonSchema3(NavigateTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = NavigateTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_navigate", validatedParams);
      if (snapshot2) {
        const tabT = validatedParams.tabTarget ?? result?.label ?? result?.tabId;
        return captureAriaSnapshot(context, "", tabT, max_tokens);
      }
      if (result?.autoCreated) {
        return textResponse(
          `Auto-created new tab ${result.tabId} (label: "${result.label}") at ${validatedParams.url}
Use tabTarget: "${result.label}" or tabTarget: ${result.tabId} to target this tab in subsequent calls.`,
          max_tokens
        );
      }
      return textResponse(`Navigated to ${validatedParams.url}`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to navigate: ${error.message}`, false, error, max_tokens);
    }
  }
});
var goBack = (snapshot2) => ({
  schema: {
    name: GoBackTool.shape.name.value,
    description: GoBackTool.shape.description.value,
    inputSchema: zodToJsonSchema3(GoBackTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = GoBackTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_go_back", validatedParams);
      if (snapshot2) {
        return captureAriaSnapshot(context, "", validatedParams.tabTarget, max_tokens);
      }
      return textResponse("Navigated back", max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to go back: ${error.message}`, false, error, max_tokens);
    }
  }
});
var goForward = (snapshot2) => ({
  schema: {
    name: GoForwardTool.shape.name.value,
    description: GoForwardTool.shape.description.value,
    inputSchema: zodToJsonSchema3(GoForwardTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = GoForwardTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_go_forward", validatedParams);
      if (snapshot2) {
        return captureAriaSnapshot(context, "", validatedParams.tabTarget, max_tokens);
      }
      return textResponse("Navigated forward", max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to go forward: ${error.message}`, false, error, max_tokens);
    }
  }
});
var wait = {
  schema: {
    name: WaitTool.shape.name.value,
    description: WaitTool.shape.description.value,
    inputSchema: zodToJsonSchema3(WaitTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      const { time } = WaitTool.shape.arguments.parse(params);
      await new Promise((resolve2) => setTimeout(resolve2, Math.max(0, time) * 1e3));
      return textResponse(`Waited for ${time} seconds`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to wait: ${error.message}`, false, error, max_tokens);
    }
  }
};
var pressKey = {
  schema: {
    name: PressKeyTool.shape.name.value,
    description: PressKeyTool.shape.description.value,
    inputSchema: zodToJsonSchema3(PressKeyTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = PressKeyTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_press_key", validatedParams);
      return textResponse(`Pressed key ${validatedParams.key}`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to press key: ${error.message}`, false, error, max_tokens);
    }
  }
};
var scroll = {
  schema: {
    name: ScrollTool.shape.name.value,
    description: ScrollTool.shape.description.value,
    inputSchema: zodToJsonSchema3(ScrollTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = ScrollTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_scroll", validatedParams);
      const x = validatedParams.x ?? 0;
      const y = validatedParams.y;
      return textResponse(`Scrolled by (${x}, ${y}) pixels`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to scroll: ${error.message}`, false, error, max_tokens);
    }
  }
};
var scrollToElement = {
  schema: {
    name: ScrollToElementTool.shape.name.value,
    description: ScrollToElementTool.shape.description.value,
    inputSchema: zodToJsonSchema3(ScrollToElementTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = ScrollToElementTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_scroll_to_element", validatedParams);
      return textResponse(`Scrolled to "${validatedParams.element}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to scroll to element: ${error.message}`, false, error, max_tokens);
    }
  }
};
var setDeviceMetrics = {
  schema: {
    name: SetDeviceMetricsTool.shape.name.value,
    description: SetDeviceMetricsTool.shape.description.value,
    inputSchema: zodToJsonSchema3(SetDeviceMetricsTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = SetDeviceMetricsTool.shape.arguments.parse(params);
      if (!validatedParams.reset && (validatedParams.width === void 0 || validatedParams.height === void 0)) {
        return errorResponse(
          "width and height are required unless reset:true",
          false,
          void 0,
          max_tokens
        );
      }
      await context.sendSocketMessage("browser_set_device_metrics", validatedParams);
      if (validatedParams.reset) {
        return textResponse("Device metrics override cleared", max_tokens);
      }
      const dpr = validatedParams.deviceScaleFactor ?? 1;
      const mob = validatedParams.mobile ? " (mobile)" : "";
      return textResponse(
        `Device metrics overridden: ${validatedParams.width}\xD7${validatedParams.height} @ ${dpr}x${mob}`,
        max_tokens
      );
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to set device metrics: ${error.message}`, false, error, max_tokens);
    }
  }
};
var setFileInput = {
  schema: {
    name: SetFileInputTool.shape.name.value,
    description: SetFileInputTool.shape.description.value,
    inputSchema: zodToJsonSchema3(SetFileInputTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = SetFileInputTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_set_file_input",
        validatedParams
      );
      const count = result?.count ?? validatedParams.paths.length;
      const note = result?.note ? ` \u2014 NOTE: ${result.note}` : "";
      return textResponse(
        `Set ${count} file(s) on ${validatedParams.selector}: ${validatedParams.paths.join(", ")}${note}`,
        max_tokens
      );
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to set file input: ${error.message}`, false, error, max_tokens);
    }
  }
};

// src/tools/cookies.ts
import { zodToJsonSchema as zodToJsonSchema4 } from "zod-to-json-schema";
var getCookies = {
  schema: {
    name: GetCookiesTool.shape.name.value,
    description: GetCookiesTool.shape.description.value,
    inputSchema: zodToJsonSchema4(GetCookiesTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = GetCookiesTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_cookies", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get cookies: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var setCookie = {
  schema: {
    name: SetCookieTool.shape.name.value,
    description: SetCookieTool.shape.description.value,
    inputSchema: zodToJsonSchema4(SetCookieTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = SetCookieTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_set_cookie", validatedParams);
      return textResponse(`Cookie "${validatedParams.name}" set for ${validatedParams.url}`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to set cookie: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var deleteCookie = {
  schema: {
    name: DeleteCookieTool.shape.name.value,
    description: DeleteCookieTool.shape.description.value,
    inputSchema: zodToJsonSchema4(DeleteCookieTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = DeleteCookieTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_delete_cookie", validatedParams);
      return textResponse(`Cookie "${validatedParams.name}" deleted from ${validatedParams.url}`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to delete cookie: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var clearCookies = {
  schema: {
    name: ClearCookiesTool.shape.name.value,
    description: ClearCookiesTool.shape.description.value,
    inputSchema: zodToJsonSchema4(ClearCookiesTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = ClearCookiesTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_clear_cookies", validatedParams);
      return textResponse(`Cleared ${result.count} cookie(s)`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to clear cookies: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/custom.ts
import * as fs from "fs";
import * as path from "path";
import { zodToJsonSchema as zodToJsonSchema5 } from "zod-to-json-schema";
var getConsoleLogs = {
  schema: {
    name: GetConsoleLogsTool.shape.name.value,
    description: GetConsoleLogsTool.shape.description.value,
    inputSchema: zodToJsonSchema5(GetConsoleLogsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const consoleLogs = await context.sendSocketMessage(
        "browser_get_console_logs",
        // `source` must be forwarded in the PAYLOAD — the options arg carries
        // routing only. Sending `{}` here (as this did) silently drops any
        // filter the caller asked for, which on this tool means they get the
        // 200k-character unfiltered dump they were explicitly trying to avoid.
        { source: params?.source },
        { extensionId: params?.extensionId, tabTarget: params?.tabTarget }
      );
      const text = consoleLogs.map((log) => JSON.stringify(log)).join("\n");
      return textResponse(text, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get console logs: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var screenshot = {
  schema: {
    name: ScreenshotTool.shape.name.value,
    description: ScreenshotTool.shape.description.value,
    inputSchema: zodToJsonSchema5(ScreenshotTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = ScreenshotTool.shape.arguments.parse(params);
      const screenshot2 = await context.sendSocketMessage(
        "browser_screenshot",
        validatedParams
      );
      return imageResponse(screenshot2, "image/png", max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to capture screenshot: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var segmentedScreenshot = {
  schema: {
    name: SegmentedScreenshotTool.shape.name.value,
    description: SegmentedScreenshotTool.shape.description.value,
    inputSchema: zodToJsonSchema5(SegmentedScreenshotTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = SegmentedScreenshotTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_segmented_screenshot",
        validatedParams
      );
      const { screenshots, failedSelectors } = result;
      const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
      const outputDir = validatedParams.outputDir || "/tmp";
      const prefix = validatedParams.prefix || "segment";
      const includeLabels = validatedParams.includeLabels || false;
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const filePaths = [];
      for (let i = 0; i < screenshots.length; i++) {
        const { selector, base64Data, label } = screenshots[i];
        const sequenceNum = String(i + 1).padStart(3, "0");
        const labelPart = includeLabels && label ? `_${label}` : "";
        const filename = `${timestamp}_${prefix}_${sequenceNum}${labelPart}.png`;
        const filepath = path.join(outputDir, filename);
        const buffer = Buffer.from(base64Data, "base64");
        fs.writeFileSync(filepath, buffer);
        filePaths.push({
          path: filepath,
          selector,
          label,
          index: i + 1
        });
      }
      return jsonResponse(
        {
          success: true,
          count: filePaths.length,
          files: filePaths,
          failedSelectors,
          outputDir,
          timestamp,
          // ⚠️ These paths are INSIDE the mcp-server container, not on the
          // caller's host. `storybook` (2026-08-02) had an agent hand back
          // absolute paths for inspection and the directory did not exist on
          // their machine — reported success, files unreachable. Saying so
          // here because a path that looks ordinary is the whole trap: nothing
          // about `/tmp/…png` signals which filesystem it lives on.
          pathsAre: "container-local",
          note: `Files were written INSIDE the mcp-server container at ${outputDir} \u2014 they are NOT on your host filesystem. Do not hand these paths to another session or a human expecting to open them. Read them with: docker compose exec mcp-server cat <path>  (or copy out with docker cp). To keep them, pass outputDir pointing at a bind-mounted directory.`
        },
        max_tokens
      );
    } catch (error) {
      return errorResponse(
        `Failed to capture segmented screenshots: ${error.message}`,
        false,
        error,
        max_tokens
      );
    }
  }
};
var evaluate = {
  schema: {
    name: EvaluateTool.shape.name.value,
    description: EvaluateTool.shape.description.value,
    inputSchema: zodToJsonSchema5(EvaluateTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = EvaluateTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_evaluate",
        validatedParams
      );
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to evaluate JavaScript: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getNetworkLogs = {
  schema: {
    name: GetNetworkLogsTool.shape.name.value,
    description: GetNetworkLogsTool.shape.description.value,
    inputSchema: zodToJsonSchema5(GetNetworkLogsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = GetNetworkLogsTool.shape.arguments.parse(params);
      const networkLogs = await context.sendSocketMessage(
        "browser_get_network_logs",
        validatedParams
      );
      return jsonResponse(networkLogs, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get network logs: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/downloads.ts
import { zodToJsonSchema as zodToJsonSchema6 } from "zod-to-json-schema";
var downloadFile = {
  schema: {
    name: DownloadFileTool.shape.name.value,
    description: DownloadFileTool.shape.description.value,
    inputSchema: zodToJsonSchema6(DownloadFileTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = DownloadFileTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_download_file", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to download file: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getDownloads = {
  schema: {
    name: GetDownloadsTool.shape.name.value,
    description: GetDownloadsTool.shape.description.value,
    inputSchema: zodToJsonSchema6(GetDownloadsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = GetDownloadsTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_downloads", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get downloads: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var cancelDownload = {
  schema: {
    name: CancelDownloadTool.shape.name.value,
    description: CancelDownloadTool.shape.description.value,
    inputSchema: zodToJsonSchema6(CancelDownloadTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = CancelDownloadTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_cancel_download", validatedParams);
      return textResponse(`Download ${validatedParams.downloadId} cancelled`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to cancel download: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var openDownload = {
  schema: {
    name: OpenDownloadTool.shape.name.value,
    description: OpenDownloadTool.shape.description.value,
    inputSchema: zodToJsonSchema6(OpenDownloadTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = OpenDownloadTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_open_download", validatedParams);
      return textResponse(`Opened download ${validatedParams.downloadId}`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to open download: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/extensions.ts
import { zodToJsonSchema as zodToJsonSchema7 } from "zod-to-json-schema";
var listExtensions = {
  schema: {
    name: ListExtensionsTool.shape.name.value,
    description: ListExtensionsTool.shape.description.value,
    inputSchema: zodToJsonSchema7(ListExtensionsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = ListExtensionsTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_list_extensions", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to list extensions: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getExtensionInfo = {
  schema: {
    name: GetExtensionInfoTool.shape.name.value,
    description: GetExtensionInfoTool.shape.description.value,
    inputSchema: zodToJsonSchema7(GetExtensionInfoTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = GetExtensionInfoTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_extension_info", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get extension info: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var enableExtension = {
  schema: {
    name: EnableExtensionTool.shape.name.value,
    description: EnableExtensionTool.shape.description.value,
    inputSchema: zodToJsonSchema7(EnableExtensionTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = EnableExtensionTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_enable_extension", validatedParams);
      return textResponse(`Extension enabled successfully (ID: ${validatedParams.id})`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to enable extension: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var disableExtension = {
  schema: {
    name: DisableExtensionTool.shape.name.value,
    description: DisableExtensionTool.shape.description.value,
    inputSchema: zodToJsonSchema7(DisableExtensionTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = DisableExtensionTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_disable_extension", validatedParams);
      return textResponse(`Extension disabled successfully (ID: ${validatedParams.id})`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to disable extension: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/exploration.ts
import { zodToJsonSchema as zodToJsonSchema8 } from "zod-to-json-schema";
var queryDOM = {
  schema: {
    name: QueryDOMTool.shape.name.value,
    description: QueryDOMTool.shape.description.value,
    inputSchema: zodToJsonSchema8(QueryDOMTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = QueryDOMTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_query_dom", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to query DOM: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getVisibleText = {
  schema: {
    name: GetVisibleTextTool.shape.name.value,
    description: GetVisibleTextTool.shape.description.value,
    inputSchema: zodToJsonSchema8(GetVisibleTextTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = GetVisibleTextTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_visible_text", validatedParams);
      return typeof result === "string" ? textResponse(result, max_tokens) : jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get visible text: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getComputedStyles = {
  schema: {
    name: GetComputedStylesTool.shape.name.value,
    description: GetComputedStylesTool.shape.description.value,
    inputSchema: zodToJsonSchema8(GetComputedStylesTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = GetComputedStylesTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_computed_styles", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get computed styles: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var checkVisibility = {
  schema: {
    name: CheckVisibilityTool.shape.name.value,
    description: CheckVisibilityTool.shape.description.value,
    inputSchema: zodToJsonSchema8(CheckVisibilityTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = CheckVisibilityTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_check_visibility", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to check visibility: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getAttributes = {
  schema: {
    name: GetAttributesTool.shape.name.value,
    description: GetAttributesTool.shape.description.value,
    inputSchema: zodToJsonSchema8(GetAttributesTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = GetAttributesTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_attributes", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get attributes: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var countElements = {
  schema: {
    name: CountElementsTool.shape.name.value,
    description: CountElementsTool.shape.description.value,
    inputSchema: zodToJsonSchema8(CountElementsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = CountElementsTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_count_elements", validatedParams);
      return textResponse(`Found ${result} elements matching selector "${validatedParams.selector}"`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to count elements: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getPageMetadata = {
  schema: {
    name: GetPageMetadataTool.shape.name.value,
    description: GetPageMetadataTool.shape.description.value,
    inputSchema: zodToJsonSchema8(GetPageMetadataTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = GetPageMetadataTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_page_metadata", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get page metadata: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getFilteredAriaTree = {
  schema: {
    name: GetFilteredAriaTreeTool.shape.name.value,
    description: GetFilteredAriaTreeTool.shape.description.value,
    inputSchema: zodToJsonSchema8(GetFilteredAriaTreeTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = GetFilteredAriaTreeTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_filtered_aria_tree", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get filtered ARIA tree: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var findByText = {
  schema: {
    name: FindByTextTool.shape.name.value,
    description: FindByTextTool.shape.description.value,
    inputSchema: zodToJsonSchema8(FindByTextTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = FindByTextTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_find_by_text", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to find by text: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getFormValues = {
  schema: {
    name: GetFormValuesTool.shape.name.value,
    description: GetFormValuesTool.shape.description.value,
    inputSchema: zodToJsonSchema8(GetFormValuesTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = GetFormValuesTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_form_values", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get form values: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var checkElementState = {
  schema: {
    name: CheckElementStateTool.shape.name.value,
    description: CheckElementStateTool.shape.description.value,
    inputSchema: zodToJsonSchema8(CheckElementStateTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = CheckElementStateTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_check_element_state", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to check element state: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/forms.ts
import zodToJsonSchema9 from "zod-to-json-schema";
var fillForm = {
  schema: {
    name: FillFormTool.shape.name.value,
    description: FillFormTool.shape.description.value,
    inputSchema: zodToJsonSchema9(FillFormTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = FillFormTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_fill_form", validatedParams);
      return textResponse(`Filled ${validatedParams.fields.length} form fields`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to fill form: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var submitForm = {
  schema: {
    name: SubmitFormTool.shape.name.value,
    description: SubmitFormTool.shape.description.value,
    inputSchema: zodToJsonSchema9(SubmitFormTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = SubmitFormTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_submit_form", validatedParams);
      return textResponse(`Submitted form "${validatedParams.element}"`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to submit form: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/history.ts
import { zodToJsonSchema as zodToJsonSchema10 } from "zod-to-json-schema";
var searchHistory = {
  schema: {
    name: SearchHistoryTool.shape.name.value,
    description: SearchHistoryTool.shape.description.value,
    inputSchema: zodToJsonSchema10(SearchHistoryTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = SearchHistoryTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_search_history", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to search history: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getHistoryVisits = {
  schema: {
    name: GetHistoryVisitsTool.shape.name.value,
    description: GetHistoryVisitsTool.shape.description.value,
    inputSchema: zodToJsonSchema10(GetHistoryVisitsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = GetHistoryVisitsTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_history_visits", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get history visits: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var deleteHistory = {
  schema: {
    name: DeleteHistoryTool.shape.name.value,
    description: DeleteHistoryTool.shape.description.value,
    inputSchema: zodToJsonSchema10(DeleteHistoryTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = DeleteHistoryTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_delete_history", validatedParams);
      return textResponse(`Deleted ${validatedParams.urls.length} URL(s) from history`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to delete history: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var clearHistory = {
  schema: {
    name: ClearHistoryTool.shape.name.value,
    description: ClearHistoryTool.shape.description.value,
    inputSchema: zodToJsonSchema10(ClearHistoryTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = ClearHistoryTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_clear_history", validatedParams);
      const startDate = new Date(validatedParams.startTime).toISOString();
      const endDate = new Date(validatedParams.endTime).toISOString();
      return textResponse(`Cleared history from ${startDate} to ${endDate}`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to clear history: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/interactions.ts
import { zodToJsonSchema as zodToJsonSchema11 } from "zod-to-json-schema";
var getInteractions = {
  schema: {
    name: GetInteractionsTool.shape.name.value,
    description: GetInteractionsTool.shape.description.value,
    inputSchema: zodToJsonSchema11(GetInteractionsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = GetInteractionsTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_interactions", validatedParams);
      const interactions = result.interactions || [];
      const totalCount = result.totalCount || 0;
      const bufferSize = result.bufferSize || 0;
      let summary = `# Interaction Log

`;
      summary += `**Retrieved**: ${interactions.length} of ${totalCount} total interactions
`;
      summary += `**Buffer size**: ${bufferSize} interactions
`;
      if (validatedParams.startTime || validatedParams.endTime) {
        summary += `**Time range**: `;
        if (validatedParams.startTime) {
          summary += `${validatedParams.startTime < 0 ? `${validatedParams.startTime}ms ago` : new Date(validatedParams.startTime).toISOString()}`;
        }
        if (validatedParams.endTime) {
          summary += ` to ${validatedParams.endTime < 0 ? `${validatedParams.endTime}ms ago` : new Date(validatedParams.endTime).toISOString()}`;
        }
        summary += `
`;
      }
      if (validatedParams.types && validatedParams.types.length > 0) {
        summary += `**Filtered by types**: ${validatedParams.types.join(", ")}
`;
      }
      summary += `
## Interactions

`;
      for (const interaction of interactions) {
        const timestamp = new Date(interaction.timestamp).toISOString();
        summary += `**${interaction.type}** (${timestamp})
`;
        if (interaction.url) {
          summary += `  - URL: ${interaction.url}
`;
        }
        if (interaction.element) {
          summary += `  - Element: ${interaction.element.tagName}`;
          if (interaction.element.text) summary += ` "${interaction.element.text}"`;
          summary += `
`;
          if (interaction.element.selector) {
            summary += `  - Selector: \`${interaction.element.selector}\`
`;
          }
        }
        if (interaction.value) {
          summary += `  - Value: "${interaction.value}"
`;
        }
        if (interaction.key) {
          summary += `  - Key: ${interaction.key}
`;
        }
        if (interaction.x !== void 0 && interaction.y !== void 0) {
          summary += `  - Position: (${interaction.x}, ${interaction.y})
`;
        }
        summary += `
`;
      }
      if (interactions.length === 0) {
        summary += `No interactions found matching the specified criteria.
`;
      }
      return textResponse(summary, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get interactions: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var pruneInteractions = {
  schema: {
    name: PruneInteractionsTool.shape.name.value,
    description: PruneInteractionsTool.shape.description.value,
    inputSchema: zodToJsonSchema11(PruneInteractionsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = PruneInteractionsTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_prune_interactions", validatedParams);
      const removedCount = result.removedCount || 0;
      const remainingCount = result.remainingCount || 0;
      let summary = `# Interaction Log Pruned

`;
      summary += `**Removed**: ${removedCount} interactions
`;
      summary += `**Remaining**: ${remainingCount} interactions

`;
      const criteria = [];
      if (validatedParams.before) {
        criteria.push(`before ${new Date(validatedParams.before).toISOString()}`);
      }
      if (validatedParams.after) {
        criteria.push(`after ${new Date(validatedParams.after).toISOString()}`);
      }
      if (validatedParams.between) {
        criteria.push(`between ${new Date(validatedParams.between[0]).toISOString()} and ${new Date(validatedParams.between[1]).toISOString()}`);
      }
      if (validatedParams.keepLast) {
        criteria.push(`kept last ${validatedParams.keepLast} interactions`);
      }
      if (validatedParams.keepFirst) {
        criteria.push(`kept first ${validatedParams.keepFirst} interactions`);
      }
      if (validatedParams.removeOldest) {
        criteria.push(`removed oldest ${validatedParams.removeOldest} interactions`);
      }
      if (validatedParams.types) {
        criteria.push(`types: ${validatedParams.types.join(", ")}`);
      }
      if (validatedParams.excludeTypes) {
        criteria.push(`excluded types: ${validatedParams.excludeTypes.join(", ")}`);
      }
      if (validatedParams.urlPattern) {
        criteria.push(`URL pattern: ${validatedParams.urlPattern}`);
      }
      if (validatedParams.selectorPattern) {
        criteria.push(`selector pattern: ${validatedParams.selectorPattern}`);
      }
      if (criteria.length > 0) {
        summary += `**Criteria**: ${criteria.join(", ")}
`;
      }
      return textResponse(summary, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to prune interactions: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var searchInteractions = {
  schema: {
    name: SearchInteractionsTool.shape.name.value,
    description: SearchInteractionsTool.shape.description.value,
    inputSchema: zodToJsonSchema11(SearchInteractionsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = SearchInteractionsTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_search_interactions", validatedParams);
      const interactions = result.interactions || [];
      const totalMatches = result.totalMatches || 0;
      let summary = `# Interaction Search Results

`;
      summary += `**Query**: "${validatedParams.query}"
`;
      summary += `**Found**: ${interactions.length} of ${totalMatches} total matches

`;
      if (validatedParams.types && validatedParams.types.length > 0) {
        summary += `**Filtered by types**: ${validatedParams.types.join(", ")}
`;
      }
      summary += `## Matches

`;
      for (const interaction of interactions) {
        const timestamp = new Date(interaction.timestamp).toISOString();
        summary += `**${interaction.type}** (${timestamp})
`;
        if (interaction.url) {
          summary += `  - URL: ${interaction.url}
`;
        }
        if (interaction.element) {
          summary += `  - Element: ${interaction.element.tagName}`;
          if (interaction.element.text) summary += ` "${interaction.element.text}"`;
          summary += `
`;
          if (interaction.element.selector) {
            summary += `  - Selector: \`${interaction.element.selector}\`
`;
          }
        }
        if (interaction.value) {
          summary += `  - Value: "${interaction.value}"
`;
        }
        if (interaction.matchedField) {
          summary += `  - Matched in: ${interaction.matchedField}
`;
        }
        summary += `
`;
      }
      if (interactions.length === 0) {
        summary += `No interactions found matching "${validatedParams.query}".
`;
      }
      return textResponse(summary, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to search interactions: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/network.ts
import { zodToJsonSchema as zodToJsonSchema12 } from "zod-to-json-schema";
var getNetworkState = {
  schema: {
    name: GetNetworkStateTool.shape.name.value,
    description: GetNetworkStateTool.shape.description.value,
    inputSchema: zodToJsonSchema12(GetNetworkStateTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = GetNetworkStateTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_network_state", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get network state: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var setNetworkConditions = {
  schema: {
    name: SetNetworkConditionsTool.shape.name.value,
    description: SetNetworkConditionsTool.shape.description.value,
    inputSchema: zodToJsonSchema12(SetNetworkConditionsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = SetNetworkConditionsTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_set_network_conditions", validatedParams);
      return textResponse("Network conditions updated successfully", max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to set network conditions: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var clearCache = {
  schema: {
    name: ClearCacheTool.shape.name.value,
    description: ClearCacheTool.shape.description.value,
    inputSchema: zodToJsonSchema12(ClearCacheTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = ClearCacheTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_clear_cache", validatedParams);
      return textResponse("Cache cleared successfully", max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to clear cache: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/snapshot.ts
import zodToJsonSchema13 from "zod-to-json-schema";
var snapshot = {
  schema: {
    name: SnapshotTool.shape.name.value,
    description: SnapshotTool.shape.description.value,
    inputSchema: zodToJsonSchema13(SnapshotTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = SnapshotTool.shape.arguments.parse(params);
      return await captureAriaSnapshot(context, "", validatedParams.tabTarget, max_tokens, validatedParams.interactiveOnly, validatedParams.maxDepth);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to capture snapshot: ${error.message}`, false, error, max_tokens);
    }
  }
};
var click = {
  schema: {
    name: ClickTool.shape.name.value,
    description: ClickTool.shape.description.value,
    inputSchema: zodToJsonSchema13(ClickTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = ClickTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_click", validatedParams);
      return textResponse(`Clicked "${validatedParams.element}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to click element: ${error.message}`, false, error, max_tokens);
    }
  }
};
var drag = {
  schema: {
    name: DragTool.shape.name.value,
    description: DragTool.shape.description.value,
    inputSchema: zodToJsonSchema13(DragTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = DragTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_drag", validatedParams);
      return textResponse(`Dragged "${validatedParams.startElement}" to "${validatedParams.endElement}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to drag element: ${error.message}`, false, error, max_tokens);
    }
  }
};
var hover = {
  schema: {
    name: HoverTool.shape.name.value,
    description: HoverTool.shape.description.value,
    inputSchema: zodToJsonSchema13(HoverTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = HoverTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_hover", validatedParams);
      return textResponse(`Hovered over "${validatedParams.element}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to hover over element: ${error.message}`, false, error, max_tokens);
    }
  }
};
var type = {
  schema: {
    name: TypeTool.shape.name.value,
    description: TypeTool.shape.description.value,
    inputSchema: zodToJsonSchema13(TypeTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = TypeTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_type", validatedParams);
      return textResponse(`Typed "${validatedParams.text}" into "${validatedParams.element}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to type into element: ${error.message}`, false, error, max_tokens);
    }
  }
};
var selectOption = {
  schema: {
    name: SelectOptionTool.shape.name.value,
    description: SelectOptionTool.shape.description.value,
    inputSchema: zodToJsonSchema13(SelectOptionTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = SelectOptionTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_select_option", validatedParams);
      return textResponse(`Selected option in "${validatedParams.element}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to select option: ${error.message}`, false, error, max_tokens);
    }
  }
};

// src/tools/system.ts
import { zodToJsonSchema as zodToJsonSchema14 } from "zod-to-json-schema";
var getVersion = {
  schema: {
    name: GetVersionTool.shape.name.value,
    description: GetVersionTool.shape.description.value,
    inputSchema: zodToJsonSchema14(GetVersionTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = GetVersionTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_version", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get version: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getSystemInfo = {
  schema: {
    name: GetSystemInfoTool.shape.name.value,
    description: GetSystemInfoTool.shape.description.value,
    inputSchema: zodToJsonSchema14(GetSystemInfoTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = GetSystemInfoTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_system_info", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get system info: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getBrowserInfo = {
  schema: {
    name: GetBrowserInfoTool.shape.name.value,
    description: GetBrowserInfoTool.shape.description.value,
    inputSchema: zodToJsonSchema14(GetBrowserInfoTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = GetBrowserInfoTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_browser_info", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get browser info: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/tabs.ts
import zodToJsonSchema15 from "zod-to-json-schema";
var listTabs = {
  schema: {
    name: ListTabsTool.shape.name.value,
    description: ListTabsTool.shape.description.value,
    inputSchema: zodToJsonSchema15(ListTabsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const tabs = await context.sendSocketMessage("browser_list_tabs", params || {});
      return jsonResponse({ tabs: Array.isArray(tabs) ? tabs : tabs?.tabs || [] }, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to list tabs: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var switchTab = {
  schema: {
    name: SwitchTabTool.shape.name.value,
    description: SwitchTabTool.shape.description.value,
    inputSchema: zodToJsonSchema15(SwitchTabTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = SwitchTabTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_switch_tab", validatedParams);
      const switched = validatedParams.tabId ?? validatedParams.tabTarget ?? "(active tab)";
      return textResponse(`Switched to tab ${switched}`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to switch tab: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var createTab = {
  schema: {
    name: CreateTabTool.shape.name.value,
    description: CreateTabTool.shape.description.value,
    inputSchema: zodToJsonSchema15(CreateTabTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    const sentAt = Date.now();
    try {
      const validatedParams = CreateTabTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_create_tab",
        validatedParams
      );
      return jsonResponse({
        tabId: result.tabId,
        label: result.label,
        url: result.url ?? validatedParams.url ?? null,
        incognito: result.incognito ?? validatedParams.incognito ?? false,
        message: `Created and attached tab ${result.tabId} (label: "${result.label}")${validatedParams.url ? ` at ${validatedParams.url}` : ""}. Use tabTarget: "${result.label}" or tabTarget: ${result.tabId} to target it.`
      }, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      const err = error instanceof Error ? error : new Error(String(error));
      const msg = err.message;
      if (/timeout/i.test(msg)) {
        const reconciled = await findTabCreatedSince(context, params, sentAt);
        if (reconciled.kind === "found") {
          const t = reconciled.tab;
          return jsonResponse({
            tabId: t.tabId,
            label: t.label,
            url: t.url ?? null,
            incognito: t.incognito ?? false,
            reconciledAfterTimeout: true,
            message: `The response timed out, but the tab WAS created \u2014 found tab ${t.tabId} (label: "${t.label}") attached after this call started. Use it; do NOT retry, a retry would open a duplicate.`
          }, true, max_tokens2);
        }
        if (reconciled.kind === "ambiguous") {
          return errorResponse(
            `The create timed out and reconciliation is AMBIGUOUS: ${reconciled.tabs.length} tabs attached since this call started that match the requested URL (${reconciled.tabs.map((t) => `${t.tabId} "${t.label}"`).join(", ")}). Do not retry \u2014 inspect these with browser_list_attached_tabs and close any duplicate.`,
            false,
            err,
            max_tokens2
          );
        }
        return errorResponse(
          `Failed to create tab: ${msg}. \u26A0\uFE0F Reconciliation found no matching tab attached since this call started${reconciled.kind === "unchecked" ? ` (the check itself failed: ${reconciled.why})` : ""}, so the tab probably was not created \u2014 but a timeout cannot prove that. Before retrying, confirm with browser_list_attached_tabs; a blind retry on this error is how duplicate tabs happen.`,
          false,
          err,
          max_tokens2
        );
      }
      return errorResponse(`Failed to create tab: ${msg}`, false, err, max_tokens2);
    }
  }
};
async function findTabCreatedSince(context, params, sentAt) {
  try {
    const res = await context.sendSocketMessage(
      "browser_list_attached_tabs",
      {},
      { extensionId: params?.extensionId, timeoutMs: 1e4 }
    );
    const tabs = res?.tabs ?? [];
    const wanted = params?.url ? String(params.url) : null;
    const since = sentAt - 2e3;
    const candidates = tabs.filter((t) => {
      if (typeof t?.attachedAt !== "number" || t.attachedAt < since) return false;
      if (!wanted) return true;
      return typeof t.url === "string" && (t.url === wanted || t.url.startsWith(wanted));
    });
    if (candidates.length === 1) return { kind: "found", tab: candidates[0] };
    if (candidates.length > 1) return { kind: "ambiguous", tabs: candidates };
    return { kind: "none" };
  } catch (e) {
    return { kind: "unchecked", why: e?.message ?? String(e) };
  }
}
var closeTab = {
  schema: {
    name: CloseTabTool.shape.name.value,
    description: CloseTabTool.shape.description.value,
    inputSchema: zodToJsonSchema15(CloseTabTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = CloseTabTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_close_tab", validatedParams);
      const closed = validatedParams.tabId ?? validatedParams.tabTarget ?? "(active tab)";
      return textResponse(`Closed tab ${closed}`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to close tab: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var createWindow = {
  schema: {
    name: CreateWindowTool.shape.name.value,
    description: CreateWindowTool.shape.description.value,
    inputSchema: zodToJsonSchema15(CreateWindowTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = CreateWindowTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_create_window",
        validatedParams,
        { extensionId: params?.extensionId }
      );
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to create window: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/user-action.ts
import { zodToJsonSchema as zodToJsonSchema16 } from "zod-to-json-schema";
var requestUserAction = (snapshot2) => ({
  schema: {
    name: RequestUserActionTool.shape.name.value,
    description: RequestUserActionTool.shape.description.value,
    inputSchema: zodToJsonSchema16(RequestUserActionTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const { request, timeout } = RequestUserActionTool.shape.arguments.parse(params);
      const wsTimeoutMs = timeout ? timeout * 1e3 : 3e5;
      const result = await context.sendSocketMessage(
        "browser_request_user_action",
        { request },
        {
          timeoutMs: wsTimeoutMs,
          extensionId: params?.extensionId,
          tabTarget: params?.tabTarget
        }
      );
      const interactions = result.interactions || [];
      const status = result.status;
      const feedback = result.feedback;
      let summary = `# User Action Request

`;
      summary += `**Request**: ${request}
`;
      summary += `**Status**: ${status}
`;
      summary += `**Duration**: ${(result.duration / 1e3).toFixed(1)}s
`;
      summary += `**Start Time**: ${new Date(result.startTime).toISOString()}
`;
      summary += `**End Time**: ${new Date(result.endTime).toISOString()}
`;
      if (feedback) {
        summary += `**User Feedback**: ${feedback}
`;
      }
      summary += `
`;
      if (status === "rejected") {
        summary += `The user rejected this request.
`;
        if (feedback) {
          summary += `
**Reason provided**: ${feedback}
`;
        }
      } else if (status === "timeout") {
        summary += `The request timed out after ${timeout || 300}s.
`;
      } else {
        summary += `## Interactions Captured (${interactions.length})

`;
        if (interactions.length === 0) {
          summary += `No interactions were captured during this period.
`;
        } else {
          const grouped = interactions.reduce((acc, interaction) => {
            const type2 = interaction.type;
            if (!acc[type2]) acc[type2] = [];
            acc[type2].push(interaction);
            return acc;
          }, {});
          for (const [type2, items] of Object.entries(grouped)) {
            summary += `### ${type2} (${items.length})
`;
            for (const interaction of items.slice(0, 10)) {
              const time = new Date(interaction.timestamp).toISOString().split("T")[1].slice(0, -1);
              summary += `- **${time}** `;
              if (interaction.selector) {
                summary += `\`${interaction.selector}\` `;
              }
              if (interaction.element?.tagName) {
                summary += `<${interaction.element.tagName}> `;
              }
              if (interaction.element?.text) {
                summary += `"${interaction.element.text.slice(0, 50)}" `;
              }
              if (interaction.key) {
                summary += `Key: ${interaction.key} `;
              }
              if (interaction.value) {
                summary += `Value: "${interaction.value.slice(0, 50)}" `;
              }
              if (interaction.url) {
                summary += `URL: ${interaction.url} `;
              }
              summary += `
`;
            }
            if (items.length > 10) {
              summary += `... and ${items.length - 10} more ${type2} interactions
`;
            }
            summary += `
`;
          }
        }
      }
      return textResponse(summary, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to request user action: ${error.message}`, false, error, max_tokens2);
    }
  }
});

// src/tools/macros.ts
import { zodToJsonSchema as zodToJsonSchema17 } from "zod-to-json-schema";
import { v4 as uuidv4 } from "uuid";

// src/tools/routine-runner.ts
var RoutineError = class extends Error {
  code;
  cause;
  constructor(code, message, cause) {
    super(message);
    this.name = "RoutineError";
    this.code = code;
    this.cause = cause;
  }
};
function buildCtx(context, defaults) {
  const mergeTarget = (opts) => ({
    tabTarget: opts?.tabTarget ?? defaults.tabTarget,
    extensionId: opts?.extensionId ?? defaults.extensionId,
    agent: opts?.agent ?? defaults.agent,
    takeover: opts?.takeover ?? defaults.takeover,
    timeoutMs: opts?.timeoutMs
  });
  const wrapErr = (code, op, err) => {
    const msg = err instanceof Error ? err.message : String(err);
    return new RoutineError(code, `ctx.${op} failed: ${msg}`, err);
  };
  const callTool = async (op, type2, payload, opts) => {
    try {
      return await context.sendSocketMessage(type2, payload, opts);
    } catch (e) {
      throw wrapErr("tool-error", op, e);
    }
  };
  return {
    /** Navigate the current tab to `url`. Pass {focus:true} to bring the tab to front. */
    async navigate(url, opts = {}) {
      return await callTool(
        "navigate",
        "browser_navigate",
        { url, focus: opts.focus, ...mergeTarget(opts) },
        mergeTarget(opts)
      );
    },
    /**
     * Evaluate JS in the page's MAIN world. Accepts either:
     *   - a function: serialized via .toString() and called with `args` injected as JSON
     *   - a string: used as-is (legacy `expression` shape; an implicit IIFE wraps it)
     * The function form lets routines write `await ctx.evaluate(() => document.title)`.
     */
    async evaluate(fnOrExpr, args, opts = {}) {
      let expression;
      if (typeof fnOrExpr === "function") {
        const argsJson = JSON.stringify(args ?? []);
        expression = `(${fnOrExpr.toString()}).apply(null, ${argsJson})`;
      } else {
        expression = fnOrExpr;
      }
      return await callTool(
        "evaluate",
        "browser_evaluate",
        { expression, ...mergeTarget(opts) },
        mergeTarget(opts)
      );
    },
    /** OS-level click via CDP Input. moveFirst false by default (see cdp.js). */
    async realisticClick(x, y, opts = {}) {
      return await callTool(
        "realisticClick",
        "browser_realistic_click",
        {
          x,
          y,
          button: opts.button,
          clickCount: opts.clickCount,
          moveFirst: opts.moveFirst,
          moveDuration: opts.moveDuration,
          currentX: opts.currentX,
          currentY: opts.currentY,
          ...mergeTarget(opts)
        },
        mergeTarget(opts)
      );
    },
    /** OS-level mouse move along a bezier (5 steps default after the cdp.js fix). */
    async realisticMouseMove(x, y, opts = {}) {
      return await callTool(
        "realisticMouseMove",
        "browser_realistic_mouse_move",
        {
          x,
          y,
          duration: opts.duration,
          currentX: opts.currentX,
          currentY: opts.currentY,
          ...mergeTarget(opts)
        },
        mergeTarget(opts)
      );
    },
    /** OS-level keystrokes via CDP Input — supports pressEnter, mistakes, timing. */
    async realisticType(text, opts = {}) {
      return await callTool(
        "realisticType",
        "browser_realistic_type",
        {
          text,
          pressEnter: opts.pressEnter,
          mistakeChance: opts.mistakeChance,
          minDelay: opts.minDelay,
          maxDelay: opts.maxDelay,
          ...mergeTarget(opts)
        },
        mergeTarget(opts)
      );
    },
    /** Press a single keyboard key (e.g. 'Enter', 'Tab', 'Escape', 'a'). */
    async pressKey(key, opts = {}) {
      return await callTool(
        "pressKey",
        "browser_press_key",
        { key, ...mergeTarget(opts) },
        mergeTarget(opts)
      );
    },
    /** Pure server-side sleep — no round-trip, but exposed for uniform API. */
    async wait(ms) {
      await new Promise((r) => setTimeout(r, Math.max(0, ms)));
    },
    /**
     * Poll location.href in the page until it matches `pattern` (string substring
     * or RegExp). Default 15s deadline, 200ms polling. Throws RoutineError
     * code='wait-timeout' when the deadline expires. Returns the matching URL.
     */
    async waitForUrl(pattern, opts = {}) {
      const deadline = Date.now() + (opts.timeoutMs ?? 15e3);
      const pollMs = opts.pollMs ?? 200;
      const reStr = pattern instanceof RegExp ? pattern.source : null;
      const reFlags = pattern instanceof RegExp ? pattern.flags : null;
      const subStr = typeof pattern === "string" ? pattern : null;
      while (Date.now() < deadline) {
        try {
          const href = await this.evaluate(() => location.href, [], opts);
          if (reStr) {
            const re = new RegExp(reStr, reFlags || "");
            if (re.test(href)) return href;
          } else if (subStr && href.includes(subStr)) {
            return href;
          }
        } catch (e) {
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
      throw new RoutineError(
        "wait-timeout",
        `ctx.waitForUrl(${String(pattern)}) timed out after ${opts.timeoutMs ?? 15e3}ms`
      );
    },
    /** Capture a tab screenshot. Returns {dataUrl}. */
    async screenshot(opts = {}) {
      return await callTool(
        "screenshot",
        "browser_screenshot",
        { fullPage: opts.fullPage, quality: opts.quality, ...mergeTarget(opts) },
        mergeTarget(opts)
      );
    },
    /** Get the visible text of the page (or a selector). */
    async getVisibleText(opts = {}) {
      return await callTool(
        "getVisibleText",
        "browser_get_visible_text",
        { selector: opts.selector, ...mergeTarget(opts) },
        mergeTarget(opts)
      );
    },
    /**
     * Bring the targeted tab to front via CDP Page.bringToFront — useful when
     * the routine needs to ensure focus before a subsequent realistic input
     * (cdp.js already prepends bringToFront on realisticClick/move, but this
     * exposes the primitive for explicit use).
     */
    async bringToFront(opts = {}) {
      return;
    },
    /**
     * Arm a navigation observer on the inherited (or overridden) tab. Returns
     * an object with `first({timeoutMs?})` and `dispose()` methods. The
     * observer captures webNavigation.onCommitted events whose top-frame URL
     * matches `pattern` from arm-time onward — so the routine can call this
     * BEFORE a click that triggers a transient redirect (e.g. OAuth callback
     * that auto-bounces in <50ms) and reliably retrieve the matched URL.
     *
     * Usage:
     *   const sub = await ctx.observeNavigations({ pattern: /callback/ });
     *   await ctx.realisticClick(x, y);
     *   const { url } = await sub.first({ timeoutMs: 8000 });
     *   await sub.dispose();
     *
     * `pattern` may be a string (treated as a regex source) or a RegExp.
     */
    async observeNavigations(opts = { pattern: "" }) {
      const pattern = opts.pattern;
      if (!pattern) throw new RoutineError("bad-args", "ctx.observeNavigations requires opts.pattern");
      const patternStr = pattern instanceof RegExp ? pattern.source : String(pattern);
      const flagsStr = pattern instanceof RegExp ? pattern.flags : "";
      const targetOpts = mergeTarget(opts);
      const startRes = await callTool(
        "observeNavigations.start",
        "browser_observe_navigations_start",
        { pattern: patternStr, flags: flagsStr, ...targetOpts },
        targetOpts
      );
      const subId = startRes.subscriptionId;
      let disposed = false;
      return {
        subscriptionId: subId,
        /** Resolve with the first matched navigation, or reject on timeout. */
        async first(firstOpts = {}) {
          if (disposed) throw new RoutineError("disposed", "observeNavigations: already disposed");
          const res = await callTool(
            "observeNavigations.first",
            "browser_observe_navigations_first",
            { subscriptionId: subId, timeoutMs: firstOpts.timeoutMs },
            { ...targetOpts, timeoutMs: (firstOpts.timeoutMs ?? 15e3) + 2e3 }
          );
          if (res?.matched) return { url: res.url, timestamp: res.timestamp, transitionType: res.transitionType };
          throw new RoutineError(
            "wait-timeout",
            `observeNavigations.first timed out after ${res?.timeoutMs ?? "?"}ms (no match for ${patternStr})`
          );
        },
        /** Tear down the subscription. Safe to call multiple times. */
        async dispose() {
          if (disposed) return;
          disposed = true;
          try {
            await callTool(
              "observeNavigations.dispose",
              "browser_observe_navigations_dispose",
              { subscriptionId: subId },
              targetOpts
            );
          } catch {
          }
        }
      };
    },
    /**
     * Search browser history (chrome.history.search) for `text`, returned
     * NEWEST-FIRST as [{ url, title, lastVisitTime, visitCount }]. This is a
     * RELIABLE fallback for capturing a transient navigation the tab has already
     * bounced away from — e.g. an OAuth callback URL that flashes through in <1s
     * and forwards to the app. observeNavigations can miss such a cross-origin
     * main-frame swap (the frame target is torn down mid-redirect), but history
     * records the visit durably. `text` is a free-text query matched against URL
     * + title substrings (e.g. "oauth/code/callback"). Pass {startTime} (epoch
     * ms) to only return visits at/after a moment you stamped before the click,
     * so a stale code from a prior run can't be mistaken for the fresh one. NOTE:
     * history is browser-wide, not tab-scoped — filter/parse in the routine.
     */
    async searchHistory(text, opts = {}) {
      const targetOpts = mergeTarget(opts);
      const res = await callTool(
        "searchHistory",
        "browser_search_history",
        { text, maxResults: opts.maxResults ?? 20, startTime: opts.startTime, ...targetOpts },
        targetOpts
      );
      const items = res?.results ?? [];
      return items.slice().sort((a, b) => (b.lastVisitTime ?? 0) - (a.lastVisitTime ?? 0));
    },
    /**
     * Scroll the page by a pixel delta (wraps browser_scroll).
     * `y` is required (positive = down, negative = up); `x` optional (default 0).
     */
    async scroll(y, opts = {}) {
      return await callTool(
        "scroll",
        "browser_scroll",
        { x: opts.x ?? 0, y, ...mergeTarget(opts) },
        mergeTarget(opts)
      );
    },
    /**
     * Execute a stored macro by id from within this routine and return its
     * result — lets a routine COMPOSE existing extraction/util macros instead
     * of inlining their code. `page`-kind macros are wrapped + evaluated in the
     * routine's target tab (identical path to browser_execute_macro's page
     * branch, so the macro sees `params` and returns its normal value).
     * `routine`-kind macros run nested via runRoutine, sharing this Context +
     * target binding. NOTE: nested routine-kind calls are unguarded against
     * self-recursion — don't have a routine executeMacro itself.
     */
    async executeMacro(id, macroParams = {}, opts = {}) {
      if (!mongodb.isConnected()) await mongodb.connect();
      const macro = await mongodb.getMacrosCollection().findOne({ id });
      if (!macro) throw new RoutineError("macro-not-found", `ctx.executeMacro: no macro with id "${id}"`);
      const targetOpts = mergeTarget(opts);
      if (macro.kind === "routine") {
        return await runRoutine(macro.code, macroParams, context, {
          tabTarget: targetOpts.tabTarget,
          extensionId: targetOpts.extensionId,
          agent: targetOpts.agent,
          takeover: targetOpts.takeover
        });
      }
      const wrapped = `
        return (async function() {
          const macroFunction = ${macro.code};
          const params = ${JSON.stringify(macroParams || {})};
          const result = typeof macroFunction === 'function' ? await macroFunction(params) : await macroFunction;
          return result;
        })()
      `;
      try {
        return await context.sendSocketMessage(
          "browser_evaluate",
          { expression: wrapped },
          targetOpts
        );
      } catch (e) {
        throw wrapErr("macro-eval-error", "executeMacro", e);
      }
    }
  };
}
async function runRoutine(code, params, context, bind) {
  const ctx = buildCtx(context, bind);
  let macroFn;
  try {
    const wrapped = `return (${code});`;
    const factory = new Function("params", "ctx", wrapped);
    macroFn = factory(params, ctx);
  } catch (e) {
    throw new RoutineError(
      "syntax-error",
      `Failed to compile routine: ${e instanceof Error ? e.message : String(e)}`,
      e
    );
  }
  if (typeof macroFn !== "function") {
    throw new RoutineError(
      "syntax-error",
      `Routine code must evaluate to a function; got ${typeof macroFn}`
    );
  }
  return await macroFn(params, ctx);
}

// src/tools/macros.ts
var storeMacro = {
  schema: {
    name: StoreMacroTool.shape.name.value,
    description: StoreMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema17(StoreMacroTool.shape.arguments)
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = StoreMacroTool.shape.arguments.parse(params);
      const macros = mongodb.getMacrosCollection();
      const existing = await macros.findOne({
        site: validatedParams.site,
        name: validatedParams.name
      });
      if (existing) {
        const now2 = /* @__PURE__ */ new Date();
        const updateDoc = {
          category: validatedParams.category,
          description: validatedParams.description,
          parameters: validatedParams.parameters,
          code: validatedParams.code,
          kind: validatedParams.kind || existing.kind || "page",
          returnType: validatedParams.returnType,
          updatedAt: now2,
          reliability: validatedParams.reliability || existing.reliability,
          tags: validatedParams.tags || existing.tags
        };
        if (validatedParams.code !== existing.code) {
          const [major, minor, patch] = existing.version.split(".").map(Number);
          updateDoc.version = `${major}.${minor}.${patch + 1}`;
        }
        await macros.updateOne(
          { id: existing.id },
          { $set: updateDoc }
        );
        return jsonResponse({
          success: true,
          id: existing.id,
          message: `Macro "${validatedParams.name}" updated successfully`,
          macro: {
            id: existing.id,
            site: existing.site,
            category: updateDoc.category,
            name: existing.name,
            description: updateDoc.description
          }
        });
      }
      const now = /* @__PURE__ */ new Date();
      const macroDoc = {
        id: uuidv4(),
        site: validatedParams.site,
        category: validatedParams.category,
        name: validatedParams.name,
        description: validatedParams.description,
        parameters: validatedParams.parameters,
        code: validatedParams.code,
        kind: validatedParams.kind || "page",
        returnType: validatedParams.returnType,
        version: "1.0.0",
        createdAt: now,
        updatedAt: now,
        lastVerified: now,
        reliability: validatedParams.reliability || "untested",
        tags: validatedParams.tags || [],
        usageCount: 0,
        successRate: 0
      };
      await macros.insertOne(macroDoc);
      return jsonResponse({
        success: true,
        id: macroDoc.id,
        message: `Macro "${validatedParams.name}" stored successfully`,
        macro: {
          id: macroDoc.id,
          site: macroDoc.site,
          category: macroDoc.category,
          name: macroDoc.name,
          description: macroDoc.description
        }
      });
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to store macro: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var listMacros = {
  schema: {
    name: ListMacrosTool.shape.name.value,
    description: ListMacrosTool.shape.description.value,
    inputSchema: zodToJsonSchema17(ListMacrosTool.shape.arguments)
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = ListMacrosTool.shape.arguments.parse(params || {});
      const macros = mongodb.getMacrosCollection();
      const query = {};
      if (validatedParams.site) {
        query.site = validatedParams.site;
      }
      if (validatedParams.category) {
        query.category = validatedParams.category;
      }
      if (validatedParams.tags && validatedParams.tags.length > 0) {
        query.tags = { $in: validatedParams.tags };
      }
      if (validatedParams.reliability) {
        query.reliability = validatedParams.reliability;
      }
      if (validatedParams.search) {
        query.$or = [
          { name: { $regex: validatedParams.search, $options: "i" } },
          { description: { $regex: validatedParams.search, $options: "i" } }
        ];
      }
      const limit = validatedParams.limit || 50;
      const results = await macros.find(query, {
        projection: {
          _id: 0,
          code: 0
          // Exclude code from list results
        }
      }).limit(limit).sort({ usageCount: -1, createdAt: -1 }).toArray();
      return jsonResponse({
        count: results.length,
        macros: results
      });
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to list macros: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getMacro = {
  schema: {
    name: GetMacroTool.shape.name.value,
    description: GetMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema17(GetMacroTool.shape.arguments)
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = GetMacroTool.shape.arguments.parse(params || {});
      const macros = mongodb.getMacrosCollection();
      const macro = await macros.findOne(
        { id: validatedParams.id },
        { projection: { _id: 0 } }
      );
      if (!macro) {
        return errorResponse(`Macro with ID "${validatedParams.id}" not found`, true, void 0, max_tokens);
      }
      return jsonResponse(macro, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get macro: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var executeMacro = {
  schema: {
    name: ExecuteMacroTool.shape.name.value,
    description: ExecuteMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema17(ExecuteMacroTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = ExecuteMacroTool.shape.arguments.parse(params);
      const macros = mongodb.getMacrosCollection();
      const macro = await macros.findOne({ id: validatedParams.id });
      if (!macro) {
        return errorResponse(`Macro with ID "${validatedParams.id}" not found`, true, void 0, max_tokens);
      }
      if (macro.kind === "routine") {
        try {
          const result2 = await runRoutine(
            macro.code,
            validatedParams.params || {},
            context,
            {
              tabTarget: validatedParams.tabTarget,
              extensionId: validatedParams.extensionId,
              agent: validatedParams.agent,
              takeover: validatedParams.takeover
            }
          );
          await macros.updateOne(
            { id: validatedParams.id },
            {
              $set: {
                usageCount: (macro.usageCount || 0) + 1,
                lastVerified: /* @__PURE__ */ new Date(),
                successRate: macro.usageCount > 0 ? (macro.successRate * macro.usageCount + 1) / (macro.usageCount + 1) : 1
              }
            }
          );
          return jsonResponse({
            success: true,
            macro: { id: macro.id, name: macro.name, site: macro.site, kind: "routine" },
            result: result2
          });
        } catch (e) {
          await macros.updateOne(
            { id: validatedParams.id },
            {
              $set: {
                usageCount: (macro.usageCount || 0) + 1,
                lastVerified: /* @__PURE__ */ new Date(),
                successRate: macro.usageCount > 0 ? macro.successRate * macro.usageCount / (macro.usageCount + 1) : 0
              }
            }
          );
          return errorResponse(
            `Routine execution failed (${e?.code || "unknown"}): ${e?.message || String(e)}`,
            false,
            { code: e?.code, cause: e?.cause, stack: e?.stack },
            max_tokens
          );
        }
      }
      const looksLikeRoutine = /^\s*(?:async\s+)?(?:function\s*\(\s*\w+\s*,\s*\w+\s*\)|\(\s*\w+\s*,\s*\w+\s*\)\s*=>)/.test(
        macro.code || ""
      );
      if (looksLikeRoutine) {
        return errorResponse(
          `Macro "${macro.name}" (id ${macro.id}) has a two-argument signature (params, ctx) but is stored as kind:'${macro.kind || "page"}'. The page-eval path invokes the macro with one argument only, so ctx will be undefined and any ctx.* call will throw "Cannot read properties of undefined". Either: (a) update the macro to kind:'routine' via browser_update_macro({id, kind: 'routine'}), OR (b) remove the ctx parameter from the macro signature and use only DOM-side JS. If browser_update_macro's schema doesn't show a 'kind' field in your MCP client, your client cached tools/list before the field was added \u2014 respawn your session to refresh (or pass kind:'routine' as an out-of-schema arg; the server accepts it).`,
          true,
          void 0,
          max_tokens
        );
      }
      await context.ensureAttachedFromParams(params);
      const wrappedCode = `
        return (async function() {
          const macroFunction = ${macro.code};
          const params = ${JSON.stringify(validatedParams.params || {})};
          try {
            // If code evaluated to a function, call it with params.
            // If it evaluated to a Promise (IIFE format), just await it.
            const result = typeof macroFunction === 'function'
              ? await macroFunction(params)
              : await macroFunction;
            return { success: true, result: result };
          } catch (error) {
            return { success: false, error: error.message, stack: error.stack };
          }
        })()
      `;
      const timeoutMs = validatedParams.timeout_ms || 3e4;
      const result = await context.sendSocketMessage(
        "browser_evaluate",
        { expression: wrappedCode },
        {
          timeoutMs,
          extensionId: validatedParams.extensionId,
          tabTarget: validatedParams.tabTarget
        }
      );
      const isSuccess = result.success === true;
      const updateFields = {
        usageCount: macro.usageCount + 1,
        lastVerified: /* @__PURE__ */ new Date()
      };
      if (macro.usageCount > 0) {
        const newSuccessCount = macro.successRate * macro.usageCount + (isSuccess ? 1 : 0);
        updateFields.successRate = newSuccessCount / (macro.usageCount + 1);
      } else {
        updateFields.successRate = isSuccess ? 1 : 0;
      }
      await macros.updateOne(
        { id: validatedParams.id },
        { $set: updateFields }
      );
      if (result.success) {
        return jsonResponse({
          success: true,
          macro: {
            id: macro.id,
            name: macro.name,
            site: macro.site
          },
          result: result.result
        });
      } else {
        return errorResponse(
          `Macro execution failed: ${result.error}`,
          false,
          result.stack,
          max_tokens
        );
      }
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to execute macro: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var updateMacro = {
  schema: {
    name: UpdateMacroTool.shape.name.value,
    description: UpdateMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema17(UpdateMacroTool.shape.arguments)
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = UpdateMacroTool.shape.arguments.parse(params);
      const macros = mongodb.getMacrosCollection();
      const existing = await macros.findOne({ id: validatedParams.id });
      if (!existing) {
        return errorResponse(`Macro with ID "${validatedParams.id}" not found`, true, void 0, max_tokens);
      }
      const updateDoc = {
        updatedAt: /* @__PURE__ */ new Date()
      };
      if (validatedParams.description !== void 0) {
        updateDoc.description = validatedParams.description;
      }
      if (validatedParams.parameters !== void 0) {
        updateDoc.parameters = validatedParams.parameters;
      }
      if (validatedParams.code !== void 0) {
        updateDoc.code = validatedParams.code;
        const [major, minor, patch] = existing.version.split(".").map(Number);
        updateDoc.version = `${major}.${minor}.${patch + 1}`;
      }
      if (validatedParams.returnType !== void 0) {
        updateDoc.returnType = validatedParams.returnType;
      }
      if (validatedParams.reliability !== void 0) {
        updateDoc.reliability = validatedParams.reliability;
      }
      if (validatedParams.tags !== void 0) {
        updateDoc.tags = validatedParams.tags;
      }
      if (validatedParams.kind !== void 0) {
        updateDoc.kind = validatedParams.kind;
      }
      await macros.updateOne(
        { id: validatedParams.id },
        { $set: updateDoc }
      );
      return jsonResponse({
        success: true,
        message: `Macro "${existing.name}" updated successfully`,
        id: existing.id,
        version: updateDoc.version || existing.version
      });
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to update macro: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var deleteMacro = {
  schema: {
    name: DeleteMacroTool.shape.name.value,
    description: DeleteMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema17(DeleteMacroTool.shape.arguments)
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = DeleteMacroTool.shape.arguments.parse(params);
      const macros = mongodb.getMacrosCollection();
      const existing = await macros.findOne({ id: validatedParams.id });
      if (!existing) {
        return errorResponse(`Macro with ID "${validatedParams.id}" not found`, true, void 0, max_tokens);
      }
      await macros.deleteOne({ id: validatedParams.id });
      return jsonResponse({
        success: true,
        message: `Macro "${existing.name}" deleted successfully`,
        id: existing.id
      });
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to delete macro: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/recordings.ts
import { zodToJsonSchema as zodToJsonSchema18 } from "zod-to-json-schema";
import { v4 as uuidv42 } from "uuid";
import { execFile } from "child_process";
import { promisify } from "util";
import fs2 from "fs";
import path2 from "path";
import { fileURLToPath } from "url";
var execFileAsync = promisify(execFile);
var __dirname = path2.dirname(fileURLToPath(import.meta.url));
var RECORDINGS_DIR = process.env.RECORDINGS_DIR || path2.join(__dirname, "..", "..", "recordings");
var saveRecording = {
  schema: {
    name: SaveRecordingTool.shape.name.value,
    description: SaveRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema18(SaveRecordingTool.shape.arguments)
  },
  handle: async (_context, params) => {
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = SaveRecordingTool.shape.arguments.parse(params);
      const recordings = mongodb.getRecordingsCollection();
      const now = /* @__PURE__ */ new Date();
      const recordingDoc = {
        id: uuidv42(),
        sessionId: validatedParams.sessionId,
        title: validatedParams.title,
        description: validatedParams.description || "",
        tags: validatedParams.tags || [],
        startUrl: validatedParams.startUrl || "",
        createdAt: now,
        startTime: validatedParams.startTime,
        endTime: validatedParams.endTime,
        duration: validatedParams.duration,
        stepCount: validatedParams.steps.length,
        steps: validatedParams.steps
      };
      await recordings.insertOne(recordingDoc);
      return jsonResponse({
        success: true,
        id: recordingDoc.id,
        message: `Recording "${validatedParams.title}" saved successfully`
      });
    } catch (error) {
      return errorResponse(`Failed to save recording: ${error.message}`, false, error);
    }
  }
};
var listRecordings = {
  schema: {
    name: ListRecordingsTool.shape.name.value,
    description: ListRecordingsTool.shape.description.value,
    inputSchema: zodToJsonSchema18(ListRecordingsTool.shape.arguments)
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = ListRecordingsTool.shape.arguments.parse(params || {});
      const recordings = mongodb.getRecordingsCollection();
      const query = {};
      if (validatedParams.tags && validatedParams.tags.length > 0) {
        query.tags = { $in: validatedParams.tags };
      }
      if (validatedParams.startUrl) {
        query.startUrl = { $regex: validatedParams.startUrl, $options: "i" };
      }
      if (validatedParams.search) {
        query.$or = [
          { title: { $regex: validatedParams.search, $options: "i" } },
          { description: { $regex: validatedParams.search, $options: "i" } }
        ];
      }
      const limit = validatedParams.limit || 50;
      const results = await recordings.find(query, {
        projection: {
          _id: 0,
          steps: 0
          // Exclude steps from list results
        }
      }).sort({ createdAt: -1 }).limit(limit).toArray();
      return jsonResponse({ count: results.length, recordings: results }, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to list recordings: ${error.message}`, false, error, max_tokens);
    }
  }
};
var getRecording = {
  schema: {
    name: GetRecordingTool.shape.name.value,
    description: GetRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema18(GetRecordingTool.shape.arguments)
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const p = GetRecordingTool.shape.arguments.parse(params);
      const recordings = mongodb.getRecordingsCollection();
      const recording = await recordings.findOne(
        { id: p.id },
        { projection: { _id: 0, steps: 0 } }
      );
      if (!recording) {
        return errorResponse(`Recording with ID "${p.id}" not found`, true, void 0, max_tokens);
      }
      const { pages: recordingPages, ...recordingMeta } = recording;
      const result = { recording: recordingMeta };
      const wantInteractions = p.includeInteractions || p.includeEvents;
      const wantNetwork = p.includeNetwork || p.includeEvents;
      if (wantInteractions || wantNetwork || p.includeStats) {
        const recordingEvents = mongodb.getRecordingEventsCollection();
        const chunks = await recordingEvents.find({ recordingId: p.id }, { projection: { _id: 0, recordingId: 0, rrwebEvents: 0 } }).sort({ chunkIndex: 1 }).toArray();
        const allInteractions = [];
        const allNetwork = [];
        for (const ch of chunks) {
          if (ch.interactions) allInteractions.push(...ch.interactions);
          if (ch.networkEntries) allNetwork.push(...ch.networkEntries);
        }
        if (p.includeStats) {
          const kindCounts = {};
          for (const i of allInteractions) {
            const k = i.kind ?? "unknown";
            kindCounts[k] = (kindCounts[k] || 0) + 1;
          }
          const networkErrors = allNetwork.filter((n) => (n.responseStatus ?? 0) >= 400 || n.error).length;
          const timestamps = allInteractions.map((i) => i.timestamp).filter(Boolean);
          const pages = recordingPages ?? [];
          const topUrls = pages.filter((pg) => pg.url && !pg.url.startsWith("about:") && !pg.url.includes("js.stripe.com") && !pg.url.includes("stripe.network")).map((pg) => ({ url: pg.url, title: pg.title }));
          result.stats = {
            interactionCount: allInteractions.length,
            networkCount: allNetwork.length,
            networkErrorCount: networkErrors,
            interactionsByKind: kindCounts,
            topUrls,
            timeSpanMs: timestamps.length >= 2 ? Math.max(...timestamps) - Math.min(...timestamps) : null
          };
        }
        if (wantInteractions) {
          let items = allInteractions;
          if (p.startTime != null) items = items.filter((i) => (i.timestamp ?? 0) >= p.startTime);
          if (p.endTime != null) items = items.filter((i) => (i.timestamp ?? 0) <= p.endTime);
          if (p.interactionTypes?.length) {
            const types = new Set(p.interactionTypes);
            items = items.filter((i) => types.has(i.kind));
          }
          if (p.selectorPattern) {
            const re = new RegExp(p.selectorPattern, "i");
            items = items.filter((i) => i.selector && re.test(i.selector));
          }
          const limit = p.limit ?? 100;
          const offset = p.offset ?? 0;
          result.interactions = items.slice(offset, offset + limit);
          result.interactionsMeta = { total: items.length, limit, offset, returned: result.interactions.length };
        }
        if (wantNetwork) {
          let items = allNetwork;
          if (p.startTime != null) items = items.filter((n) => (n.timestamp ?? n.startTime ?? 0) >= p.startTime);
          if (p.endTime != null) items = items.filter((n) => (n.timestamp ?? n.startTime ?? 0) <= p.endTime);
          if (p.networkUrlPattern) {
            const re = new RegExp(p.networkUrlPattern, "i");
            items = items.filter((n) => n.url && re.test(n.url));
          }
          if (p.networkMethod) {
            const method = p.networkMethod.toUpperCase();
            items = items.filter((n) => n.method?.toUpperCase() === method);
          }
          if (p.networkStatusMin != null) items = items.filter((n) => (n.responseStatus ?? 0) >= p.networkStatusMin);
          if (p.networkStatusMax != null) items = items.filter((n) => (n.responseStatus ?? 0) <= p.networkStatusMax);
          const limit = p.limit ?? 100;
          const offset = p.offset ?? 0;
          let sliced = items.slice(offset, offset + limit);
          if (p.excludeBodies) {
            sliced = sliced.map((n) => {
              const { requestBody: _rb, responseBody: _rsb, ...rest } = n;
              return { ...rest, bodyOmittedReason: "excludeBodies" };
            });
          } else if (typeof p.bodyMaxBytes === "number") {
            const cap = Math.max(0, p.bodyMaxBytes);
            const truncate = (s) => {
              if (typeof s !== "string") return s;
              if (s.length <= cap) return s;
              return s.slice(0, cap) + `...[truncated ${s.length - cap} more bytes]`;
            };
            sliced = sliced.map((n) => ({
              ...n,
              requestBody: truncate(n.requestBody),
              responseBody: truncate(n.responseBody)
            }));
          }
          result.networkEntries = sliced;
          result.networkMeta = { total: items.length, limit, offset, returned: result.networkEntries.length };
        }
        result.reviewUrl = `http://localhost:9010/review/${p.id}`;
      }
      if (p.includeAnnotations) {
        const col = mongodb.getRecordingAnnotationsCollection();
        const docs = await col.find({ recordingId: p.id }, { projection: { _id: 0, recordingId: 0 } }).sort({ timestamp: 1 }).toArray();
        let annotations = docs;
        if (p.annotationStripScreenshots) {
          annotations = annotations.map((a) => {
            const { screenshotPng: _s1, fullViewportPng: _s2, ...rest } = a;
            return { ...rest, screenshotPng: null };
          });
        }
        result.annotations = annotations;
        result.annotationsMeta = { total: annotations.length };
      }
      return jsonResponse(result, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to get recording: ${error.message}`, false, error, max_tokens);
    }
  }
};
var updateRecording = {
  schema: {
    name: UpdateRecordingTool.shape.name.value,
    description: UpdateRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema18(UpdateRecordingTool.shape.arguments)
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = UpdateRecordingTool.shape.arguments.parse(params);
      const recordings = mongodb.getRecordingsCollection();
      const existing = await recordings.findOne({ id: validatedParams.id });
      if (!existing) {
        return errorResponse(`Recording with ID "${validatedParams.id}" not found`, true, void 0, max_tokens);
      }
      const update = { updatedAt: /* @__PURE__ */ new Date() };
      if (validatedParams.title !== void 0) update.title = validatedParams.title;
      if (validatedParams.description !== void 0) update.description = validatedParams.description;
      if (validatedParams.tags !== void 0) update.tags = validatedParams.tags;
      await recordings.updateOne({ id: validatedParams.id }, { $set: update });
      return jsonResponse({
        success: true,
        id: validatedParams.id,
        message: `Recording updated successfully`,
        updated: update
      }, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to update recording: ${error.message}`, false, error, max_tokens);
    }
  }
};
var startSessionRecording = {
  schema: {
    name: StartSessionRecordingTool.shape.name.value,
    description: StartSessionRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema18(StartSessionRecordingTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const result = await context.sendSocketMessage("browser_start_session_recording", params || {});
      return jsonResponse(result, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to start session recording: ${error.message}`, false, error, max_tokens);
    }
  }
};
var stopSessionRecording = {
  schema: {
    name: StopSessionRecordingTool.shape.name.value,
    description: StopSessionRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema18(StopSessionRecordingTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const result = await context.sendSocketMessage("browser_stop_session_recording", params || {}, { timeoutMs: 12e4 });
      return jsonResponse(result, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to stop session recording: ${error.message}`, false, error, max_tokens);
    }
  }
};
var getSessionRecordingState = {
  schema: {
    name: GetSessionRecordingStateTool.shape.name.value,
    description: GetSessionRecordingStateTool.shape.description.value,
    inputSchema: zodToJsonSchema18(GetSessionRecordingStateTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const result = await context.sendSocketMessage("browser_get_session_recording_state", params || {});
      return jsonResponse(result, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to get session recording state: ${error.message}`, false, error, max_tokens);
    }
  }
};
var deleteRecording = {
  schema: {
    name: DeleteRecordingTool.shape.name.value,
    description: DeleteRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema18(DeleteRecordingTool.shape.arguments)
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = DeleteRecordingTool.shape.arguments.parse(params);
      const recordings = mongodb.getRecordingsCollection();
      const existing = await recordings.findOne({ id: validatedParams.id });
      if (!existing) {
        return errorResponse(`Recording with ID "${validatedParams.id}" not found`, true, void 0, max_tokens);
      }
      await recordings.deleteOne({ id: validatedParams.id });
      return jsonResponse({
        success: true,
        message: `Recording "${existing.title}" deleted successfully`,
        id: existing.id
      }, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to delete recording: ${error.message}`, false, error, max_tokens);
    }
  }
};
var getRecordingScreenshot = {
  schema: {
    name: GetRecordingScreenshotTool.shape.name.value,
    description: GetRecordingScreenshotTool.shape.description.value,
    inputSchema: zodToJsonSchema18(GetRecordingScreenshotTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) await mongodb.connect();
      const p = GetRecordingScreenshotTool.shape.arguments.parse(params);
      const recordingsColl = mongodb.getRecordingsCollection();
      const recording = await recordingsColl.findOne({ id: p.id }, { projection: { _id: 0 } });
      if (!recording) return errorResponse(`Recording "${p.id}" not found`, true, void 0, max_tokens);
      const targetTs = p.timestamp > 0 ? p.timestamp : recording.startTime;
      const mode = p.mode ?? "auto";
      const useVideo = mode === "video" || mode === "auto" && (recording.videoPath || recording.recordedTabIds?.length);
      if (useVideo) {
        const tabId = p.tabId ?? recording.primaryTabId ?? recording.recordedTabIds?.[0];
        const videoFile = tabId ? path2.join(RECORDINGS_DIR, `${p.id}-tab-${tabId}.webm`) : path2.join(RECORDINGS_DIR, `${p.id}.webm`);
        if (fs2.existsSync(videoFile)) {
          const videoStartTimes = recording.videoStartTimes || {};
          const videoStart = tabId && videoStartTimes[tabId] ? videoStartTimes[tabId] : recording.videoStartTime ?? recording.startTime;
          const offsetSec = Math.max(0, (targetTs - videoStart) / 1e3).toFixed(3);
          const { stdout } = await execFileAsync("ffmpeg", [
            "-ss",
            offsetSec,
            "-i",
            videoFile,
            "-vframes",
            "1",
            "-f",
            "image2",
            "-vcodec",
            "png",
            "pipe:1"
          ], { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 });
          const base64 = stdout.toString("base64");
          return imageResponse(base64, "image/png", max_tokens);
        }
        if (mode === "video") {
          return errorResponse(`No video file found for recording "${p.id}"${tabId ? ` tab ${tabId}` : ""}`, true, void 0, max_tokens);
        }
      }
      const label = `rrweb-frame-${Date.now()}`;
      const playerUrl = `http://localhost:9010/rrweb-player?id=${p.id}&t=${targetTs}${p.selector ? "&selector=" + encodeURIComponent(p.selector) : ""}`;
      await context.sendSocketMessage(
        "browser_create_tab",
        { url: playerUrl, label },
        { extensionId: params?.extensionId }
      );
      try {
        const ready = await context.sendSocketMessage("browser_evaluate", {
          expression: `new Promise((resolve, reject) => {
            const start = Date.now();
            const poll = () => {
              if (window.__playerReady) return resolve(true);
              if (Date.now() - start > 15000) return reject(new Error('rrweb player timeout'));
              setTimeout(poll, 200);
            };
            poll();
          })`,
          tabTarget: label
        }, { extensionId: params?.extensionId, tabTarget: label });
        if (!ready) throw new Error("Player did not become ready");
        let screenshotSelector = "#rrweb-container";
        if (p.selector) {
          const bounds = await context.sendSocketMessage("browser_evaluate", {
            expression: "window.__elementBounds",
            tabTarget: label
          });
        }
        const shot = await context.sendSocketMessage("browser_screenshot", {
          selector: screenshotSelector,
          tabTarget: label
        });
        const base64 = shot?.data ?? shot;
        return imageResponse(base64, "image/png", max_tokens);
      } finally {
        await context.sendSocketMessage("browser_close_tab", { tabTarget: label }).catch(() => {
        });
      }
    } catch (error) {
      return errorResponse(`Failed to get recording screenshot: ${error.message}`, false, error, max_tokens);
    }
  }
};

// src/tools/realistic-input.ts
import { zodToJsonSchema as zodToJsonSchema19 } from "zod-to-json-schema";
var realisticMouseMove = {
  schema: {
    name: RealisticMouseMoveTool.shape.name.value,
    description: RealisticMouseMoveTool.shape.description.value,
    inputSchema: zodToJsonSchema19(RealisticMouseMoveTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = RealisticMouseMoveTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_realistic_mouse_move", validatedParams);
      return textResponse(result.message || `Moved mouse to (${validatedParams.x}, ${validatedParams.y})`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to move mouse: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var realisticClick = {
  schema: {
    name: RealisticClickTool.shape.name.value,
    description: RealisticClickTool.shape.description.value,
    inputSchema: zodToJsonSchema19(RealisticClickTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = RealisticClickTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_realistic_click", validatedParams);
      return textResponse(result.message || `Clicked at (${validatedParams.x}, ${validatedParams.y})`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to click: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var realisticType = {
  schema: {
    name: RealisticTypeTool.shape.name.value,
    description: RealisticTypeTool.shape.description.value,
    inputSchema: zodToJsonSchema19(RealisticTypeTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = RealisticTypeTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_realistic_type", validatedParams);
      const preview = validatedParams.text.substring(0, 50);
      const suffix = validatedParams.text.length > 50 ? "..." : "";
      return textResponse(result.message || `Typed: "${preview}${suffix}"`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to type: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/multi-tab-management.ts
import zodToJsonSchema20 from "zod-to-json-schema";
function redactUrl(url) {
  const raw = typeof url === "string" ? url : "";
  if (!raw) return raw;
  const q = raw.indexOf("?");
  const h = raw.indexOf("#");
  if (q === -1 && h === -1) return raw;
  try {
    const u = new URL(raw);
    let changed = false;
    for (const key of Array.from(u.searchParams.keys())) {
      u.searchParams.set(key, "\u2026");
      changed = true;
    }
    if (u.hash && u.hash.length > 1) {
      u.hash = "#\u2026";
      changed = true;
    }
    return changed ? u.toString().replace(/%E2%80%A6/g, "\u2026") : raw;
  } catch {
    const cut = Math.min(...[q, h].filter((i) => i >= 0));
    return raw.slice(0, cut) + (raw[cut] === "#" ? "#\u2026" : "?\u2026");
  }
}
var listAttachedTabs = {
  schema: {
    name: ListAttachedTabsTool.shape.name.value,
    description: ListAttachedTabsTool.shape.description.value,
    inputSchema: zodToJsonSchema20(ListAttachedTabsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens, fullUrls, live } = params || {};
    try {
      const results = await context.broadcastSocketMessage(
        "browser_list_attached_tabs",
        { live: live === true }
      );
      const tabs = [];
      const errors = [];
      for (const r of results) {
        if (r.error) {
          errors.push({ extensionId: r.extensionId, error: r.error });
          continue;
        }
        for (const t of r.result?.tabs ?? []) {
          tabs.push({
            ...t,
            url: fullUrls ? t.url : redactUrl(t.url),
            urlRedacted: fullUrls ? void 0 : typeof t.url === "string" && redactUrl(t.url) !== t.url || void 0,
            extensionId: r.extensionId
          });
        }
      }
      if (tabs.length === 0) {
        const message = errors.length ? `No tabs attached. Extension errors: ${errors.map((e) => `${e.extensionId}: ${e.error}`).join("; ")}` : "No tabs currently attached";
        return jsonResponse({
          tabs: [],
          // Identity, not bare ids. A caller cannot tell which machine an opaque
          // UUID refers to, and on 2026-08-11 that cost an hour of debugging a
          // container chromium in the belief it was ben's desktop Chrome.
          extensions: results.map((r) => context.describeExtension(r.extensionId) ?? { extensionId: r.extensionId, label: "unidentified browser", kind: "unknown" }),
          errors,
          message
        }, true, max_tokens);
      }
      const summary = `Attached tabs (${tabs.length} across ${results.length} extension${results.length === 1 ? "" : "s"}):
` + tabs.map((tab) => {
        const res = tab.reservation ? ` [reserved: ${tab.reservation.owner} since ${new Date(tab.reservation.claimedAt).toISOString()}]` : "";
        const ext = ` [ext: ${tab.extensionId}]`;
        const liveUnavailable = live === true && tab.liveUrl === void 0 && tab.liveError === void 0;
        const moved = tab.urlChanged === true || tab.titleChanged === true;
        const liveNote = liveUnavailable ? `
  \u26A0\uFE0F LIVE STATE UNAVAILABLE: this extension is running a build that predates the live:true option, so url/title above are attach-time only and may be stale. Reload the extension, or verify with browser_evaluate("location.href").` : tab.liveError ? `
  \u26A0\uFE0F LIVE STATE UNREADABLE: ${tab.liveError}` : moved ? `
  \u26A0\uFE0F THIS TAB HAS NAVIGATED since it was attached \u2014 the url/title above are the ATTACH-TIME record.
  Now at: ${tab.liveUrl}
  Now titled: ${tab.liveTitle}` : tab.liveUrl ? `
  (live url/title confirmed unchanged since attach)` : "";
        return `- Tab ${tab.tabId} (${tab.label}): ${tab.title}${ext}${res}
  URL: ${tab.url}
  Last used: ${new Date(tab.lastUsedAt).toLocaleString()}${liveNote}`;
      }).join("\n");
      return jsonResponse({
        tabs,
        // Identity, not bare ids. A caller cannot tell which machine an opaque
        // UUID refers to, and on 2026-08-11 that cost an hour of debugging a
        // container chromium in the belief it was ben's desktop Chrome.
        extensions: results.map((r) => context.describeExtension(r.extensionId) ?? { extensionId: r.extensionId, label: "unidentified browser", kind: "unknown" }),
        errors,
        message: summary
      }, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(
        `Failed to list attached tabs: ${error.message}`,
        false,
        error,
        max_tokens2
      );
    }
  }
};
var setTabLabel = {
  schema: {
    name: SetTabLabelTool.shape.name.value,
    description: SetTabLabelTool.shape.description.value,
    inputSchema: zodToJsonSchema20(SetTabLabelTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = SetTabLabelTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_set_tab_label",
        validatedParams
      );
      return textResponse(
        `Updated tab ${validatedParams.tabTarget} label to "${validatedParams.label}"`,
        max_tokens
      );
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(
        `Failed to set tab label: ${error.message}`,
        false,
        error,
        max_tokens2
      );
    }
  }
};
var detachTab = {
  schema: {
    name: DetachTabTool.shape.name.value,
    description: DetachTabTool.shape.description.value,
    inputSchema: zodToJsonSchema20(DetachTabTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = DetachTabTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_detach_tab",
        validatedParams
      );
      return textResponse(
        `Detached from tab ${validatedParams.tabId}${result.detachedLabel ? ` (${result.detachedLabel})` : ""}`,
        max_tokens
      );
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(
        `Failed to detach tab: ${error.message}`,
        false,
        error,
        max_tokens2
      );
    }
  }
};
var getActiveTab = {
  schema: {
    name: GetActiveTabTool.shape.name.value,
    description: GetActiveTabTool.shape.description.value,
    inputSchema: zodToJsonSchema20(GetActiveTabTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const result = await context.sendSocketMessage(
        "browser_get_active_tab",
        params || {}
      );
      if (!result.hasActiveTab) {
        return textResponse("No tabs currently attached", max_tokens);
      }
      return textResponse(
        `Active tab: ${result.tabId} (${result.label})
Title: ${result.title}
URL: ${result.url}
Last used: ${new Date(result.lastUsedAt).toLocaleString()}`,
        max_tokens
      );
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(
        `Failed to get active tab: ${error.message}`,
        false,
        error,
        max_tokens2
      );
    }
  }
};
var attachTab = {
  schema: {
    name: AttachTabTool.shape.name.value,
    description: AttachTabTool.shape.description.value,
    inputSchema: zodToJsonSchema20(AttachTabTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = AttachTabTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_ensure_attached",
        validatedParams
      );
      return textResponse(
        `Attached to tab ${result.tabId} (label: "${result.label}")
URL: ${result.url}
Use tabTarget: "${result.label}" or tabTarget: ${result.tabId} to target this tab.`,
        max_tokens
      );
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(
        `Failed to attach to tab: ${error.message}`,
        false,
        error,
        max_tokens2
      );
    }
  }
};
var reserveTab = {
  schema: {
    name: ReserveTabTool.shape.name.value,
    description: ReserveTabTool.shape.description.value,
    inputSchema: zodToJsonSchema20(ReserveTabTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = ReserveTabTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_reserve_tab", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      return errorResponse(
        `Failed to reserve tab: ${error.message}`,
        false,
        error,
        max_tokens
      );
    }
  }
};
var releaseTab = {
  schema: {
    name: ReleaseTabTool.shape.name.value,
    description: ReleaseTabTool.shape.description.value,
    inputSchema: zodToJsonSchema20(ReleaseTabTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = ReleaseTabTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_release_tab", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      return errorResponse(
        `Failed to release tab: ${error.message}`,
        false,
        error,
        max_tokens
      );
    }
  }
};

// src/tools/video-recording.ts
import { zodToJsonSchema as zodToJsonSchema21 } from "zod-to-json-schema";
import * as fs3 from "fs";
var startVideoRecording = {
  schema: {
    name: StartVideoRecordingTool.shape.name.value,
    description: StartVideoRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema21(StartVideoRecordingTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = StartVideoRecordingTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_start_video_recording", validatedParams);
      return textResponse(result.message || `Video recording started`, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to start video recording: ${error.message}`, false, error, params?.max_tokens);
    }
  }
};
var stopVideoRecording = {
  schema: {
    name: StopVideoRecordingTool.shape.name.value,
    description: StopVideoRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema21(StopVideoRecordingTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = StopVideoRecordingTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_stop_video_recording",
        {},
        { extensionId: validatedParams.extensionId, tabTarget: validatedParams.tabTarget }
      );
      if (!result.videoBase64) {
        throw new Error("No video data returned from extension");
      }
      const outputPath = validatedParams.output_path || `/tmp/unibrowse_video_${Date.now()}.webm`;
      const videoBuffer = Buffer.from(result.videoBase64, "base64");
      fs3.writeFileSync(outputPath, videoBuffer);
      const sizeMB = (result.byteLength / (1024 * 1024)).toFixed(2);
      return textResponse(
        `Video recording saved to: ${outputPath}
Size: ${sizeMB} MB (${result.byteLength} bytes)
Format: ${result.mimeType || "video/webm"}`,
        max_tokens
      );
    } catch (error) {
      return errorResponse(`Failed to stop video recording: ${error.message}`, false, error, params?.max_tokens);
    }
  }
};

// src/tools/chrome-launcher.ts
import { spawn, execSync } from "child_process";
import { zodToJsonSchema as zodToJsonSchema22 } from "zod-to-json-schema";
import * as path3 from "path";
import * as fs4 from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath as fileURLToPath2 } from "url";
var __filename = fileURLToPath2(import.meta.url);
var __dirname2 = path3.dirname(__filename);
function stableExtensionIdFor(profileName) {
  if (!profileName) return null;
  const roots = [
    "/app/.chrome-profiles",
    path3.resolve(__dirname2, "..", "..", ".chrome-profiles")
  ];
  const root = roots.find((r) => fs4.existsSync(r));
  if (!root) return null;
  const key = profileName.replace(/[^A-Za-z0-9._-]/g, "_");
  const file = path3.join(root, ".unibrowse-identities", `${key}.json`);
  try {
    if (fs4.existsSync(file)) {
      const parsed = JSON.parse(fs4.readFileSync(file, "utf8"));
      if (parsed?.extensionId) return String(parsed.extensionId);
    }
  } catch {
  }
  try {
    const id = `ext_${randomUUID()}`;
    fs4.mkdirSync(path3.dirname(file), { recursive: true });
    fs4.writeFileSync(file, JSON.stringify(
      { extensionId: id, profileName, mintedAt: (/* @__PURE__ */ new Date()).toISOString() },
      null,
      2
    ));
    return id;
  } catch {
    return null;
  }
}
var launchedProcesses = /* @__PURE__ */ new Map();
var launchedXvfbs = /* @__PURE__ */ new Map();
var shuttingDown = false;
var installSignalHandlers = () => {
  const shutdown = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[chrome-launcher] Received ${sig}, gracefully closing ${launchedProcesses.size} spawned chromium(s)...`);
    for (const [pid, proc] of launchedProcesses) {
      try {
        proc.kill("SIGTERM");
        console.log(`[chrome-launcher] SIGTERM \u2192 chromium pid ${pid}`);
      } catch (e) {
        console.warn(`[chrome-launcher] Failed to SIGTERM chromium pid ${pid}:`, e.message);
      }
    }
    for (const [pid, proc] of launchedXvfbs) {
      try {
        proc.kill("SIGTERM");
      } catch {
      }
      console.log(`[chrome-launcher] SIGTERM \u2192 Xvfb pid ${pid}`);
    }
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
};
installSignalHandlers();
var startupCleanupDone = false;
var runStartupCleanup = () => {
  if (startupCleanupDone) return;
  startupCleanupDone = true;
  const cleaned = [];
  const profileRoots = [
    "/app/.chrome-profiles",
    path3.resolve(__dirname2, "..", "..", ".chrome-profiles")
  ];
  for (const root of profileRoots) {
    if (!fs4.existsSync(root)) continue;
    try {
      for (const profile of fs4.readdirSync(root)) {
        for (const lock of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
          const p = path3.join(root, profile, lock);
          try {
            if (fs4.lstatSync(p)) {
              fs4.unlinkSync(p);
              cleaned.push(p);
            }
          } catch {
          }
        }
      }
    } catch {
    }
  }
  const xUnixDir = "/tmp/.X11-unix";
  if (fs4.existsSync(xUnixDir)) {
    try {
      for (const f of fs4.readdirSync(xUnixDir)) {
        if (!/^X\d+$/.test(f)) continue;
        const p = path3.join(xUnixDir, f);
        try {
          fs4.unlinkSync(p);
          cleaned.push(p);
        } catch {
        }
      }
    } catch {
    }
  }
  if (cleaned.length) {
    console.log(`[chrome-launcher] Startup cleanup: removed ${cleaned.length} stale lock/socket(s): ${cleaned.slice(0, 5).join(", ")}${cleaned.length > 5 ? "\u2026" : ""}`);
  }
};
var selfHealProfile = (profileDir) => {
  const prefsPath = path3.join(profileDir, "Default", "Preferences");
  if (!fs4.existsSync(prefsPath)) return;
  try {
    const raw = fs4.readFileSync(prefsPath, "utf8");
    const prefs = JSON.parse(raw);
    let dirty = false;
    if (prefs?.profile?.exit_type && prefs.profile.exit_type !== "Normal") {
      prefs.profile.exit_type = "Normal";
      dirty = true;
    }
    if (prefs?.profile?.exited_cleanly === false) {
      prefs.profile.exited_cleanly = true;
      dirty = true;
    }
    if (dirty) {
      fs4.writeFileSync(prefsPath, JSON.stringify(prefs));
      console.log(`[chrome-launcher] Self-healed profile exit markers at ${prefsPath}`);
    }
  } catch (e) {
    console.warn(`[chrome-launcher] Profile self-heal failed (${prefsPath}):`, e.message);
  }
};
async function launchViaChromiumHost(context, params, hostUrl, max_tokens) {
  const validatedParams = LaunchIsolatedChromeTool.shape.arguments.parse(params);
  const preLaunchExtensionIds = new Set(
    context.listExtensions?.().map((e) => e.extensionId) ?? []
  );
  const wsHint = process.env.UNIBROWSE_CHROMIUM_SERVER_HINT || "ws://mcp-server:9010/ws";
  const httpHint = wsHint.replace(/^ws/, "http").replace(/\/ws$/, "");
  const stableExtId = stableExtensionIdFor(validatedParams.profileName);
  const seedUrl = `${httpHint}/__unibrowse_seed?ws=${encodeURIComponent(wsHint)}&http=${encodeURIComponent(httpHint)}` + (stableExtId ? `&eid=${encodeURIComponent(stableExtId)}` : "");
  const userUrls = validatedParams.url ? Array.isArray(validatedParams.url) ? validatedParams.url : [validatedParams.url] : ["chrome://extensions/"];
  const useXvfbForHeadless = !validatedParams.realHeadless;
  const innerHeadless = !!validatedParams.headless && !useXvfbForHeadless;
  const autoAttach = validatedParams.autoAttach !== false;
  const cmdLineUrls = autoAttach ? [seedUrl] : [seedUrl, ...userUrls];
  const reqBody = {
    profileName: validatedParams.profileName,
    urls: cmdLineUrls,
    freshProfile: validatedParams.freshProfile !== false,
    headless: innerHeadless,
    width: validatedParams.width,
    height: validatedParams.height,
    serverHint: wsHint,
    // Persistent-profile override. The sidecar refuses to wipe a profileDir
    // on the persistent allowlist unless this NAMES the profile verbatim — a
    // bare boolean would get set once in a wrapper and inherited by every
    // later call, silently dissolving the friction it exists to create.
    forceProfileName: validatedParams.forceProfileName,
    caller: validatedParams.caller
  };
  const launchResp = await fetch(`${hostUrl.replace(/\/$/, "")}/launch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody)
  });
  if (!launchResp.ok) {
    const text = await launchResp.text().catch(() => "");
    if (launchResp.status === 409) {
      try {
        const body = JSON.parse(text);
        if (body?.message) return errorResponse(body.message, false, void 0, max_tokens);
      } catch {
      }
    }
    return errorResponse(
      `chromium-host /launch returned ${launchResp.status}: ${text}`,
      false,
      void 0,
      max_tokens
    );
  }
  const { pid, display, profileDir } = await launchResp.json();
  let spawnedExtensionId = null;
  const deadline = Date.now() + 3e4;
  const startedAt = Date.now();
  while (Date.now() < deadline) {
    const current = context.listExtensions?.() ?? [];
    const newcomers = current.filter((e) => !preLaunchExtensionIds.has(e.extensionId));
    if (newcomers.length > 0 && Date.now() - startedAt > 3e3) {
      newcomers.sort((a, b) => (b.registeredAt ?? 0) - (a.registeredAt ?? 0));
      spawnedExtensionId = newcomers[0].extensionId;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (spawnedExtensionId && pid) {
    try {
      await fetch(`${hostUrl.replace(/\/$/, "")}/processes/${pid}/extension`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extensionId: spawnedExtensionId })
      });
    } catch {
    }
  }
  const attachedTabIds = [];
  if (autoAttach && spawnedExtensionId && userUrls.length > 0) {
    for (const url of userUrls) {
      try {
        const createRes = await context.sendSocketMessage(
          "browser_create_tab",
          { url, agent: validatedParams.agent },
          { extensionId: spawnedExtensionId, timeoutMs: 2e4 }
        );
        if (createRes?.tabId) attachedTabIds.push(createRes.tabId);
      } catch (e) {
        console.warn(`[chrome-launcher] auto-attach failed for ${url}: ${e?.message || e}`);
      }
    }
  }
  const fresh = validatedParams.freshProfile !== false;
  let message = `\u2713 Chrome launched via chromium-host sidecar
`;
  message += `  Profile: ${validatedParams.profileName} ${fresh ? "(fresh - no cookies/history)" : "(persistent)"}
`;
  message += `  Profile Directory: ${profileDir}
`;
  message += `  Display: ${display || "(headless)"}
`;
  message += `  PID (in chromium-host): ${pid}
`;
  message += `  URLs requested: ${userUrls.length > 0 ? userUrls.join(", ") : "(none)"}
`;
  if (spawnedExtensionId) {
    message += `  Extension ID: ${spawnedExtensionId}
`;
    if (attachedTabIds.length > 0) {
      message += `  Attached tabs: ${attachedTabIds.join(", ")}
`;
      message += `
Ready to drive \u2014 pass extensionId=${spawnedExtensionId} and tabTarget=${attachedTabIds[0]} on subsequent tool calls.`;
    } else if (autoAttach && userUrls.length > 0) {
      message += `
Extension registered but auto-attach failed \u2014 call browser_attach_tab({autoOpenUrl, extensionId=${spawnedExtensionId}}) manually.`;
    } else {
      message += `
Pass extensionId=${spawnedExtensionId} on subsequent tool calls to pin them to this chromium.`;
    }
  } else {
    message += `
(Extension id not seen within 30s \u2014 check browser_list_attached_tabs.)`;
  }
  return jsonResponse({
    pid,
    profileDir,
    urls: userUrls,
    display,
    extensionId: spawnedExtensionId,
    tabId: attachedTabIds[0] ?? null,
    tabIds: attachedTabIds,
    via: "chromium-host",
    message
  }, true, max_tokens);
}
function findChromeExecutable() {
  const possiblePaths = [
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ];
  for (const chromePath of possiblePaths) {
    if (fs4.existsSync(chromePath)) {
      return chromePath;
    }
  }
  try {
    const commands = ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"];
    for (const cmd of commands) {
      try {
        const result = execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>nul`, {
          encoding: "utf-8"
        }).trim();
        if (result && fs4.existsSync(result)) {
          return result;
        }
      } catch {
      }
    }
  } catch {
  }
  return null;
}
var launchIsolatedChrome = {
  schema: {
    name: LaunchIsolatedChromeTool.shape.name.value,
    description: LaunchIsolatedChromeTool.shape.description.value,
    inputSchema: zodToJsonSchema22(LaunchIsolatedChromeTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const chromiumHost = process.env.UNIBROWSE_CHROMIUM_HOST;
      if (chromiumHost) {
        return await launchViaChromiumHost(context, params, chromiumHost, max_tokens);
      }
      runStartupCleanup();
      const validatedParams = LaunchIsolatedChromeTool.shape.arguments.parse(params);
      const preLaunchExtensionIds = new Set(
        context.listExtensions?.().map((e) => e.extensionId) ?? []
      );
      const chromeBin = findChromeExecutable();
      if (!chromeBin) {
        return errorResponse(
          "Could not find Chrome or Chromium executable. Please install Chrome/Chromium or set the path manually.",
          false
        );
      }
      const candidates = [
        path3.resolve(__dirname2, "..", "extension"),
        // /app/extension when run from /app/dist
        path3.resolve(__dirname2, "..", "..", "extension"),
        // <repo>/extension when run from <repo>/src/tools
        "/app/extension"
      ];
      let extensionDir = null;
      for (const c of candidates) {
        try {
          if (fs4.existsSync(path3.join(c, "manifest.json"))) {
            extensionDir = c;
            break;
          }
        } catch {
        }
      }
      if (!extensionDir) {
        return errorResponse(
          `Extension directory not found (searched: ${candidates.join(", ")})`,
          false
        );
      }
      const profilesDir = path3.join(path3.dirname(extensionDir), ".chrome-profiles");
      if (!fs4.existsSync(profilesDir)) {
        fs4.mkdirSync(profilesDir, { recursive: true }, max_tokens);
      }
      const profileName = validatedParams.profileName || "unibrowse-test";
      const profileDir = path3.join(profilesDir, profileName);
      const freshProfile = validatedParams.freshProfile !== false;
      if (freshProfile && fs4.existsSync(profileDir)) {
        try {
          fs4.rmSync(profileDir, { recursive: true, force: true });
        } catch (rmErr) {
          if (rmErr?.code === "EBUSY" || rmErr?.code === "ENOTEMPTY") {
            const aside = `${profileDir}.dead-${Date.now()}`;
            try {
              fs4.renameSync(profileDir, aside);
              console.warn(`[chrome-launcher] rmSync EBUSY (NFS sillyrename?); renamed ${profileDir} \u2192 ${aside}`);
            } catch (mvErr) {
              console.error(`[chrome-launcher] could not clear ${profileDir}: rm failed (${rmErr.message}) and rename failed (${mvErr.message}). Launching with stale profile.`);
            }
          } else {
            throw rmErr;
          }
        }
      }
      if (!fs4.existsSync(profileDir)) {
        fs4.mkdirSync(profileDir, { recursive: true });
      }
      if (!freshProfile) {
        selfHealProfile(profileDir);
      }
      let urls;
      if (!validatedParams.url) {
        urls = ["chrome://extensions/"];
      } else if (Array.isArray(validatedParams.url)) {
        urls = validatedParams.url;
      } else {
        urls = [validatedParams.url];
      }
      const chromeArgs = [
        `--user-data-dir=${profileDir}`,
        `--load-extension=${extensionDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--disable-features=TranslateUI",
        "--disable-default-apps"
      ];
      const inContainer = fs4.existsSync("/.dockerenv") || process.env.UNIBROWSE_FORCE_CHROME_NOSANDBOX === "1";
      if (inContainer) {
        chromeArgs.push("--no-sandbox", "--disable-dev-shm-usage");
      }
      if (validatedParams.width && validatedParams.height) {
        chromeArgs.push(`--window-size=${validatedParams.width},${validatedParams.height}`);
      }
      if (validatedParams.headless) {
        chromeArgs.push("--headless=new");
        chromeArgs.push("--disable-gpu");
      }
      chromeArgs.push(...urls);
      const spawnEnv = { ...process.env };
      let xvfbProcess = null;
      let xvfbDisplay = null;
      if (inContainer && !validatedParams.headless) {
        xvfbDisplay = `:${90 + Math.floor(Math.random() * 100)}`;
        try {
          xvfbProcess = spawn("Xvfb", [xvfbDisplay, "-screen", "0", "1280x1024x24", "-nolisten", "tcp"], {
            detached: true,
            stdio: "ignore"
          });
          xvfbProcess.unref();
          const startSleep = Date.now();
          while (Date.now() - startSleep < 1500) {
            if (fs4.existsSync(`/tmp/.X11-unix/X${xvfbDisplay.slice(1)}`)) break;
            execSync("sleep 0.1");
          }
          spawnEnv.DISPLAY = xvfbDisplay;
          console.log(`[chrome-launcher] Spawned Xvfb on ${xvfbDisplay} (pid ${xvfbProcess.pid}) for headful chromium`);
        } catch (xvfbErr) {
          console.warn(`[chrome-launcher] Xvfb failed to start (${xvfbErr.message}); chromium will likely fail to open display`);
        }
      }
      const chromeProcess = spawn(chromeBin, chromeArgs, {
        detached: true,
        stdio: "ignore",
        env: spawnEnv
      });
      chromeProcess.unref();
      if (chromeProcess.pid) {
        launchedProcesses.set(chromeProcess.pid, chromeProcess);
        chromeProcess.once("exit", () => launchedProcesses.delete(chromeProcess.pid));
      }
      if (xvfbProcess?.pid) {
        launchedXvfbs.set(xvfbProcess.pid, xvfbProcess);
        xvfbProcess.once("exit", () => launchedXvfbs.delete(xvfbProcess.pid));
      }
      let spawnedExtensionId = null;
      const pollDeadline = Date.now() + 15e3;
      while (Date.now() < pollDeadline) {
        const current = context.listExtensions?.() ?? [];
        const newcomers = current.filter((e) => !preLaunchExtensionIds.has(e.extensionId));
        if (newcomers.length > 0) {
          spawnedExtensionId = newcomers[newcomers.length - 1].extensionId;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      let message = `\u2713 Chrome launched in isolated mode
`;
      message += `  Profile: ${profileName} ${freshProfile ? "(fresh - no cookies/history)" : "(persistent)"}
`;
      message += `  Profile Directory: ${profileDir}
`;
      message += `  Extension: ${extensionDir}
`;
      message += `  PID: ${chromeProcess.pid}
`;
      message += `  URLs: ${urls.join(", ")}
`;
      if (validatedParams.headless) {
        message += `  Mode: Headless
`;
      }
      if (spawnedExtensionId) {
        message += `  Extension ID: ${spawnedExtensionId}
`;
        message += `
Pass extensionId=${spawnedExtensionId} on subsequent tool calls to pin them to this chromium.`;
      } else {
        message += `
The extension will auto-connect to the MCP server at localhost:9010 (extension id not seen within 15s \u2014 check browser_list_attached_tabs).`;
      }
      return jsonResponse({
        pid: chromeProcess.pid,
        profileName,
        profileDir,
        extensionDir,
        urls,
        extensionId: spawnedExtensionId,
        message
      }, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(
        `Failed to launch isolated Chrome: ${error.message}`,
        false,
        error,
        max_tokens2
      );
    }
  }
};
var closeIsolatedChrome = {
  schema: {
    name: CloseIsolatedChromeTool.shape.name.value,
    description: CloseIsolatedChromeTool.shape.description.value,
    inputSchema: zodToJsonSchema22(CloseIsolatedChromeTool.shape.arguments)
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      const args = CloseIsolatedChromeTool.shape.arguments.parse(params || {});
      const { extensionId, profileName, forceProfileName, caller } = args;
      if (!extensionId && !profileName) {
        return errorResponse("Either extensionId or profileName is required.", false, void 0, max_tokens);
      }
      const hostUrl = process.env.UNIBROWSE_CHROMIUM_HOST;
      if (!hostUrl) {
        return errorResponse(
          "browser_close_isolated_chrome requires the chromium-host sidecar (UNIBROWSE_CHROMIUM_HOST unset). Instances launched in-process are not tracked by the sidecar and cannot be closed this way.",
          false,
          void 0,
          max_tokens
        );
      }
      const base = hostUrl.replace(/\/$/, "");
      const listResp = await fetch(`${base}/processes`);
      if (!listResp.ok) {
        return errorResponse(`chromium-host /processes returned ${listResp.status}`, false, void 0, max_tokens);
      }
      const { processes } = await listResp.json();
      const match = (processes || []).find((p) => extensionId && p.extensionId === extensionId || profileName && p.profileName === profileName);
      if (!match) {
        return errorResponse(
          `No tracked isolated chromium matches ${extensionId ? `extensionId=${extensionId}` : `profileName=${profileName}`}. Currently tracked: ${(processes || []).map((p) => p.profileName).join(", ") || "(none)"}.`,
          false,
          void 0,
          max_tokens
        );
      }
      const qs = new URLSearchParams();
      if (forceProfileName) qs.set("forceProfileName", forceProfileName);
      if (caller) qs.set("caller", caller);
      const delUrl = `${base}/processes/${match.pid}${qs.toString() ? `?${qs}` : ""}`;
      const delResp = await fetch(delUrl, { method: "DELETE" });
      const body = await delResp.json().catch(() => ({}));
      if (delResp.status === 409) {
        return errorResponse(body.message || "Refused: profile is persistent.", false, void 0, max_tokens);
      }
      if (!delResp.ok) {
        return errorResponse(`chromium-host DELETE returned ${delResp.status}: ${JSON.stringify(body)}`, false, void 0, max_tokens);
      }
      const freed = body.freed || {};
      return jsonResponse({
        closed: true,
        pid: match.pid,
        profileName: match.profileName,
        extensionId: match.extensionId || null,
        display: freed.display ?? null,
        xvfbReaped: freed.xvfbPid ?? null,
        note: "Process-only: the profile directory was NOT deleted. Relaunch with freshProfile:false to reuse its auth state."
      }, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to close isolated Chrome: ${error.message}`, false, error, max_tokens);
    }
  }
};

// package.json
var package_default = {
  name: "@unibrowse/mcp",
  version: "1.1.0",
  description: "MCP server bridging the gap between AI agents and browser automation",
  author: "unibrowse",
  bugs: "https://github.com/sackio/unibrowse/issues",
  type: "module",
  bin: {
    "mcp-server-unibrowse": "dist/http-server.js"
  },
  files: [
    "dist"
  ],
  scripts: {
    typecheck: "tsc --noEmit",
    build: "tsup src/http-server.ts src/stdio-server.ts --format esm && shx chmod +x dist/*.js && shx mkdir -p dist/views && shx cp src/views/*.html dist/views/ && shx cp -r src/public dist/public",
    prepare: "npm run build",
    watch: "tsup src/http-server.ts src/stdio-server.ts --format esm --watch",
    dev: "nodemon",
    start: "node --env-file=.env dist/http-server.js",
    "start:stdio": "node dist/stdio-server.js",
    inspector: "CLIENT_PORT=9001 SERVER_PORT=9002 pnpx @modelcontextprotocol/inspector node dist/stdio-server.js",
    chrome: "./scripts/launch-chrome-isolated.sh",
    "test:prereq": "node tests/check-prerequisites.js",
    test: "node tests/test-all-tools.js",
    "test:multi-tab": "node tests/test-multi-tab.js",
    "test:window": "node tests/test-create-window.js",
    "test:utility-macros": "node tests/test-utility-macros.js",
    "test:advanced-macros": "node tests/test-advanced-macros.js",
    "store:macros": "node tests/store-utility-macros.js",
    "store:advanced-macros": "node tests/store-advanced-macros.js",
    "backup:test": "./scripts/backup-and-test.sh",
    "test:unit": "node --test --experimental-strip-types 'tests/unit/*.test.*'"
  },
  dependencies: {
    "@modelcontextprotocol/sdk": "^1.20.0",
    archiver: "^7.0.1",
    commander: "^13.1.0",
    express: "^5.1.0",
    "js-tiktoken": "^1.0.15",
    mongodb: "^6.20.0",
    nodemon: "^3.1.10",
    uuid: "^13.0.0",
    ws: "^8.18.1",
    zod: "^3.24.2",
    "zod-to-json-schema": "^3.24.3"
  },
  devDependencies: {
    "@types/archiver": "^6.0.3",
    "@types/express": "^5.0.3",
    "@types/uuid": "^10.0.0",
    "@types/ws": "^8.18.0",
    shx: "^0.3.4",
    tsup: "^8.4.0",
    typescript: "^5.6.2"
  }
};

export {
  appConfig,
  getParked,
  fetchDestinations,
  mongodb,
  validatePredicate,
  watchRegistry,
  watchBuffer,
  buffersLostToRestart,
  persistWatch,
  forgetWatch,
  globalContext,
  createServerWithTools,
  createServerWithoutWebSocket,
  ListFramesTool,
  GetErrorsTool,
  ReloadExtensionTool,
  WatchSourcesTool,
  WatchCreateTool,
  WatchListTool,
  WatchDeleteTool,
  WatchPollTool,
  jsonResponse,
  textResponse,
  errorResponse,
  getBookmarks,
  createBookmark,
  deleteBookmark,
  searchBookmarks,
  getClipboard,
  setClipboard,
  navigate,
  goBack,
  goForward,
  wait,
  pressKey,
  scroll,
  scrollToElement,
  setDeviceMetrics,
  setFileInput,
  getCookies,
  setCookie,
  deleteCookie,
  clearCookies,
  getConsoleLogs,
  screenshot,
  segmentedScreenshot,
  evaluate,
  getNetworkLogs,
  downloadFile,
  getDownloads,
  cancelDownload,
  openDownload,
  listExtensions,
  getExtensionInfo,
  enableExtension,
  disableExtension,
  queryDOM,
  getVisibleText,
  getComputedStyles,
  checkVisibility,
  getAttributes,
  countElements,
  getPageMetadata,
  getFilteredAriaTree,
  findByText,
  getFormValues,
  checkElementState,
  fillForm,
  submitForm,
  searchHistory,
  getHistoryVisits,
  deleteHistory,
  clearHistory,
  getInteractions,
  pruneInteractions,
  searchInteractions,
  getNetworkState,
  setNetworkConditions,
  clearCache,
  snapshot,
  click,
  drag,
  hover,
  type,
  selectOption,
  getVersion,
  getSystemInfo,
  getBrowserInfo,
  listTabs,
  switchTab,
  createTab,
  closeTab,
  createWindow,
  requestUserAction,
  storeMacro,
  listMacros,
  getMacro,
  executeMacro,
  updateMacro,
  deleteMacro,
  saveRecording,
  listRecordings,
  getRecording,
  updateRecording,
  startSessionRecording,
  stopSessionRecording,
  getSessionRecordingState,
  deleteRecording,
  getRecordingScreenshot,
  realisticMouseMove,
  realisticClick,
  realisticType,
  listAttachedTabs,
  setTabLabel,
  detachTab,
  getActiveTab,
  attachTab,
  reserveTab,
  releaseTab,
  startVideoRecording,
  stopVideoRecording,
  launchIsolatedChrome,
  closeIsolatedChrome,
  package_default
};
