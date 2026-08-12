#!/usr/bin/env node
import {
  GetErrorsTool,
  ListFramesTool,
  ReloadExtensionTool,
  appConfig,
  attachTab,
  cancelDownload,
  checkElementState,
  checkVisibility,
  clearCache,
  clearCookies,
  clearHistory,
  click,
  closeIsolatedChrome,
  closeTab,
  countElements,
  createBookmark,
  createServerWithTools,
  createServerWithoutWebSocket,
  createTab,
  createWindow,
  deleteBookmark,
  deleteCookie,
  deleteHistory,
  deleteMacro,
  deleteRecording,
  detachTab,
  disableExtension,
  downloadFile,
  drag,
  enableExtension,
  errorResponse,
  evaluate,
  executeMacro,
  fillForm,
  findByText,
  getActiveTab,
  getAttributes,
  getBookmarks,
  getBrowserInfo,
  getClipboard,
  getComputedStyles,
  getConsoleLogs,
  getCookies,
  getDownloads,
  getExtensionInfo,
  getFilteredAriaTree,
  getFormValues,
  getHistoryVisits,
  getInteractions,
  getMacro,
  getNetworkLogs,
  getNetworkState,
  getPageMetadata,
  getRecording,
  getRecordingScreenshot,
  getSessionRecordingState,
  getSystemInfo,
  getVersion,
  getVisibleText,
  goBack,
  goForward,
  hover,
  jsonResponse,
  launchIsolatedChrome,
  listAttachedTabs,
  listExtensions,
  listMacros,
  listRecordings,
  listTabs,
  mongodb,
  navigate,
  openDownload,
  package_default,
  pressKey,
  pruneInteractions,
  queryDOM,
  realisticClick,
  realisticMouseMove,
  realisticType,
  releaseTab,
  requestUserAction,
  reserveTab,
  saveRecording,
  screenshot,
  scroll,
  scrollToElement,
  searchBookmarks,
  searchHistory,
  searchInteractions,
  segmentedScreenshot,
  selectOption,
  setClipboard,
  setCookie,
  setDeviceMetrics,
  setFileInput,
  setNetworkConditions,
  setTabLabel,
  snapshot,
  startSessionRecording,
  startVideoRecording,
  stopSessionRecording,
  stopVideoRecording,
  storeMacro,
  submitForm,
  switchTab,
  type,
  updateMacro,
  updateRecording,
  wait
} from "./chunk-DAW6CMBL.js";
import {
  extractKey,
  getEffectiveClientIP,
  isAuthEnabled,
  isLocalClient,
  isValidKey,
  requireApiKey,
  requireLan
} from "./chunk-YYZQZXP6.js";

// src/http-server.ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import fs2 from "fs";
import path2 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// src/install.ts
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
function findExtensionDir() {
  const candidates = [
    path.join(__dirname, "..", "extension"),
    // /app/extension when run from /app/dist
    path.join(__dirname, "..", "..", "extension"),
    // <repo>/extension when run from <repo>/dist
    "/app/extension"
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    } catch {
    }
  }
  return null;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function deriveBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"]?.split(",")[0].trim() || (req.secure ? "https" : "http");
  const host = req.headers["x-forwarded-host"]?.split(",")[0].trim() || req.headers.host || "localhost:9010";
  const wsProto = proto === "https" ? "wss" : "ws";
  return { http: `${proto}://${host}`, ws: `${wsProto}://${host}` };
}
function installLandingHandler(req, res) {
  const { http: httpBase, ws: wsBase } = deriveBaseUrl(req);
  const queryKey = req.query.key || "";
  const authOn = isAuthEnabled();
  const isLocal = isLocalClient(req);
  const authForThisClient = authOn && !isLocal;
  const keyIsValid = authForThisClient ? isValidKey(queryKey) : true;
  const downloadHref = `/install/extension.zip${queryKey ? `?key=${encodeURIComponent(queryKey)}` : ""}`;
  const errorBanner = authForThisClient && queryKey && !keyIsValid ? `<div class="banner err">The provided key is not valid on this server.</div>` : authForThisClient && !queryKey ? `<div class="banner warn">This server requires an API key for remote clients. Append <code>?key=&lt;your-key&gt;</code> to this URL to enable the download.</div>` : "";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>unibrowse \u2014 install extension</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 780px; margin: 40px auto; padding: 0 20px; color: #222; line-height: 1.55; }
    h1 { font-size: 28px; margin-bottom: 4px; }
    .sub { color: #666; margin-bottom: 28px; }
    .banner { padding: 12px 16px; border-radius: 6px; margin: 18px 0; font-size: 14px; }
    .banner.err { background: #fee; border: 1px solid #f99; color: #800; }
    .banner.warn { background: #fff8e1; border: 1px solid #f0c060; color: #806000; }
    .download { display: inline-block; background: #6f42c1; color: white; padding: 12px 22px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 12px 0 20px; }
    .download[aria-disabled="true"] { background: #999; cursor: not-allowed; pointer-events: none; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
    pre { background: #1e1e1e; color: #eee; padding: 14px; border-radius: 6px; overflow-x: auto; }
    ol li { margin: 8px 0; }
    .meta { color: #999; font-size: 12px; margin-top: 36px; }
  </style>
</head>
<body>
  <h1>Install the unibrowse extension</h1>
  <div class="sub">This dev extension is distributed directly from your server, not the Chrome Web Store.</div>
  ${errorBanner}
  <a class="download" href="${downloadHref}" ${!keyIsValid ? 'aria-disabled="true"' : ""}>Download extension (.zip)</a>
  <h3>Install steps</h3>
  <ol>
    <li>Click the button above to download <code>unibrowse-extension.zip</code>.</li>
    <li>Unzip it somewhere stable (e.g. <code>~/unibrowse-extension</code>).</li>
    <li>Open <code>chrome://extensions</code> in Chrome and toggle <strong>Developer mode</strong> on (top-right).</li>
    <li>Click <strong>Load unpacked</strong> and select the unzipped folder.</li>
    <li>The extension auto-connects to this server (<code>${wsBase}/ws</code>).</li>
  </ol>
  <h3>Configuration</h3>
  <p>The downloaded extension is pre-configured for this server. You can override the server URL or API key any time via the extension's <strong>Options</strong> page (Right-click the extension icon \u2192 Options).</p>
  <div class="meta">
    Server: <code>${httpBase}</code><br>
    WebSocket: <code>${wsBase}/ws</code><br>
    Auth policy: <code>${authOn ? "LAN open / remote requires API key" : "open (no key required)"}</code><br>
    You are: <code>${isLocal ? "LAN client (open access)" : "remote client (API key required)"}</code> \u2014 ${escapeHtml(getEffectiveClientIP(req))}
  </div>
</body>
</html>`);
}
async function installZipHandler(req, res) {
  if (isAuthEnabled() && !isLocalClient(req)) {
    const key = extractKey(req);
    if (!isValidKey(key)) {
      res.status(401).json({
        error: "Invalid or missing API key. Open /install?key=<key> to download.",
        clientIp: getEffectiveClientIP(req)
      });
      return;
    }
  }
  const extDir = findExtensionDir();
  if (!extDir) {
    res.status(500).json({ error: "Extension directory not found on server" });
    return;
  }
  const { http: httpBase, ws: wsBase } = deriveBaseUrl(req);
  const apiKey = extractKey(req) || "";
  const configContent = `// Auto-generated by /install/extension.zip on ${(/* @__PURE__ */ new Date()).toISOString()}
// Server: ${httpBase}
// Edit via the extension's Options page to override at runtime.
self.UNIBROWSE_CONFIG = {
  SERVER_URL: ${JSON.stringify(httpBase)},
  WS_URL: ${JSON.stringify(`${wsBase}/ws`)},
  API_KEY: ${JSON.stringify(apiKey)},
  INSTALLED_FROM: ${JSON.stringify(httpBase)},
  INSTALLED_AT: ${JSON.stringify((/* @__PURE__ */ new Date()).toISOString())},
};
`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="unibrowse-extension.zip"`);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    console.error("[install] zip error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  });
  archive.pipe(res);
  const skip = (name) => {
    if (name.startsWith(".nfs")) return true;
    if (name.endsWith(".backup")) return true;
    if (name.includes(".backup-")) return true;
    if (name === ".gitignore") return true;
    if (name === "generate-icons.js") return true;
    return false;
  };
  function walk(dir, rel) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const inner = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, inner);
      } else if (entry.isFile()) {
        if (inner === "config.js") continue;
        archive.file(abs, { name: inner });
      }
    }
  }
  walk(extDir, "");
  archive.append(configContent, { name: "config.js" });
  archive.finalize();
}

// src/tools/frames.ts
import { zodToJsonSchema } from "zod-to-json-schema";
var listFrames = {
  schema: {
    name: ListFramesTool.shape.name.value,
    description: ListFramesTool.shape.description.value,
    inputSchema: zodToJsonSchema(ListFramesTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = ListFramesTool.shape.arguments.parse(params || {});
      const result = await context.sendSocketMessage("browser_list_frames", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to list frames: ${error.message}`, false, error, max_tokens);
    }
  }
};

// src/tools/errors.ts
import { zodToJsonSchema as zodToJsonSchema2 } from "zod-to-json-schema";
var getErrors = {
  schema: {
    name: GetErrorsTool.shape.name.value,
    description: GetErrorsTool.shape.description.value,
    inputSchema: zodToJsonSchema2(GetErrorsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = GetErrorsTool.shape.arguments.parse(params || {});
      const result = await context.sendSocketMessage("browser_get_errors", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to get errors: ${error.message}`, false, error, max_tokens);
    }
  }
};
var reloadExtension = {
  schema: {
    name: ReloadExtensionTool.shape.name.value,
    description: ReloadExtensionTool.shape.description.value,
    inputSchema: zodToJsonSchema2(ReloadExtensionTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const result = await context.sendSocketMessage("browser_reload_extension", params || {});
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to reload extension: ${error.message}`, false, error, max_tokens);
    }
  }
};

// src/http-server.ts
import { v4 as uuidv4 } from "uuid";
var __dirname2 = path2.dirname(fileURLToPath2(import.meta.url));
var RECORDINGS_DIR = process.env.RECORDINGS_DIR || path2.join(__dirname2, "..", "recordings");
var commonTools = [
  pressKey,
  scroll,
  scrollToElement,
  setDeviceMetrics,
  setFileInput,
  wait
];
var customTools = [
  evaluate,
  getConsoleLogs,
  getNetworkLogs,
  screenshot,
  segmentedScreenshot
];
var explorationTools = [
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
  checkElementState
];
var tabTools = [
  listTabs,
  switchTab,
  createTab,
  closeTab,
  createWindow
];
var formTools = [
  fillForm,
  submitForm
];
var recordingTools = [
  requestUserAction(false),
  saveRecording,
  listRecordings,
  getRecording,
  updateRecording,
  deleteRecording,
  startSessionRecording,
  stopSessionRecording,
  getSessionRecordingState,
  getRecordingScreenshot
];
var interactionTools = [
  getInteractions,
  pruneInteractions,
  searchInteractions
];
var cookieTools = [
  getCookies,
  setCookie,
  deleteCookie,
  clearCookies
];
var downloadTools = [
  downloadFile,
  getDownloads,
  cancelDownload,
  openDownload
];
var clipboardTools = [
  getClipboard,
  setClipboard
];
var historyTools = [
  searchHistory,
  getHistoryVisits,
  deleteHistory,
  clearHistory
];
var systemTools = [
  getVersion,
  getSystemInfo,
  getBrowserInfo,
  launchIsolatedChrome,
  closeIsolatedChrome
];
var networkTools = [
  getNetworkState,
  setNetworkConditions,
  clearCache
];
var bookmarkTools = [
  getBookmarks,
  createBookmark,
  deleteBookmark,
  searchBookmarks
];
var extensionTools = [
  listExtensions,
  getExtensionInfo,
  enableExtension,
  disableExtension
];
var macroTools = [
  storeMacro,
  listMacros,
  getMacro,
  executeMacro,
  updateMacro,
  deleteMacro
];
var realisticInputTools = [
  realisticMouseMove,
  realisticClick,
  realisticType
];
var videoRecordingTools = [
  startVideoRecording,
  stopVideoRecording
];
var multiTabTools = [
  listAttachedTabs,
  setTabLabel,
  detachTab,
  getActiveTab,
  attachTab,
  reserveTab,
  releaseTab
];
var frameTools = [
  listFrames
];
var diagnosticTools = [
  getErrors,
  reloadExtension
];
var snapshotTools = [
  navigate(false),
  goBack(false),
  goForward(false),
  snapshot,
  click,
  drag,
  hover,
  type,
  selectOption,
  ...commonTools,
  ...customTools,
  ...explorationTools,
  ...tabTools,
  ...formTools,
  ...recordingTools,
  ...interactionTools,
  ...cookieTools,
  ...downloadTools,
  ...clipboardTools,
  ...historyTools,
  ...systemTools,
  ...networkTools,
  ...bookmarkTools,
  ...extensionTools,
  ...macroTools,
  ...realisticInputTools,
  ...multiTabTools,
  ...videoRecordingTools,
  ...frameTools,
  ...diagnosticTools
];
var resources = [];
async function main() {
  const app = express();
  app.use(express.json({ limit: "10gb" }));
  app.use("/api/v1/recordings/:id/video", express.raw({ type: "video/*", limit: "500mb" }));
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  const port = parseInt(process.env.PORT || "9010");
  app.get("/health", (req, res) => {
    const authOn = isAuthEnabled();
    const local = isLocalClient(req);
    res.json({
      status: "ok",
      version: package_default.version,
      // All gated routes (/mcp, /ws, /install/zip, /api/v1/recordings/*)
      // share the same policy: LAN clients always allowed; remote clients
      // need an API key when UNIBROWSE_API_KEYS is set.
      policy: authOn ? "lan-open-remote-required" : "open",
      authRequired: authOn && !local,
      clientIp: getEffectiveClientIP(req),
      isLocalClient: local
    });
  });
  app.get("/install", installLandingHandler);
  app.get("/install/extension.zip", installZipHandler);
  app.get("/__unibrowse_seed", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      `<!doctype html><meta charset=utf-8><title>unibrowse seed</title><body>seeding\u2026</body>`
    );
  });
  if (!fs2.existsSync(RECORDINGS_DIR)) {
    fs2.mkdirSync(RECORDINGS_DIR, { recursive: true });
  }
  async function ensureMongoConnected() {
    if (!mongodb.isConnected()) await mongodb.connect();
  }
  app.post("/api/v1/recordings", requireApiKey, async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const body = req.body;
      const doc = {
        id: uuidv4(),
        sessionId: body.sessionId || "",
        title: body.title || "Untitled Session",
        description: body.description || "",
        tags: body.tags || [],
        status: body.status || "complete",
        startUrl: body.startUrl || "",
        startTime: body.startTime || Date.now(),
        endTime: body.endTime || Date.now(),
        duration: body.duration || 0,
        pages: body.pages || [],
        rrwebEventCount: body.rrwebEventCount || 0,
        networkEntryCount: body.networkEntryCount || 0,
        annotations: [],
        videoPath: null,
        primaryTabId: body.primaryTabId || null,
        recordedTabIds: body.recordedTabIds || [],
        videoStartTimes: body.videoStartTimes || {},
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      };
      await recordings.insertOne(doc);
      res.json({ id: doc.id, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/v1/recordings/:id/video", requireApiKey, async (req, res) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const videoPath = path2.join(RECORDINGS_DIR, `${id}.webm`);
      fs2.writeFileSync(videoPath, req.body);
      const recordings = mongodb.getRecordingsCollection();
      await recordings.updateOne(
        { id },
        { $set: { videoPath: `recordings/${id}.webm`, updatedAt: /* @__PURE__ */ new Date() } }
      );
      res.json({ success: true, videoPath: `recordings/${id}.webm` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/v1/recordings/:id/events", requireApiKey, async (req, res) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const { rrwebEvents = [], networkEntries = [], interactions = [], chunkIndex = 0 } = req.body;
      const recordingEvents = mongodb.getRecordingEventsCollection();
      if (req.query.reset === "1" || chunkIndex === 0) {
        await recordingEvents.deleteMany({ recordingId: id });
      }
      await recordingEvents.insertOne({
        recordingId: id,
        chunkIndex,
        rrwebEvents,
        networkEntries,
        interactions,
        updatedAt: /* @__PURE__ */ new Date()
      });
      res.json({ success: true, chunkIndex, rrwebEventCount: rrwebEvents.length, networkEntryCount: networkEntries.length, interactionCount: interactions.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/v1/recordings/:id/annotations", async (req, res) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const col = mongodb.getRecordingAnnotationsCollection();
      const docs = await col.find({ recordingId: id }, { projection: { _id: 0, recordingId: 0 } }).sort({ timestamp: 1 }).toArray();
      res.json({ annotations: docs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/v1/recordings/:id/annotations", requireApiKey, async (req, res) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const annotation = req.body;
      const col = mongodb.getRecordingAnnotationsCollection();
      await col.updateOne(
        { recordingId: id, id: annotation.id },
        { $set: { ...annotation, recordingId: id, updatedAt: /* @__PURE__ */ new Date() } },
        { upsert: true }
      );
      res.json({ success: true, annotationId: annotation.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/v1/recordings", async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const limit = parseInt(String(req.query.limit || "50"));
      const results = await recordings.find({}, { projection: { _id: 0, rrwebEvents: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray();
      res.json({ count: results.length, recordings: results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/v1/recordings/:id", async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const recording = await recordings.findOne({ id: req.params.id }, { projection: { _id: 0 } });
      if (!recording) return res.status(404).json({ error: "Not found" });
      res.json({ recording });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/v1/recordings/:id/video", async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const recording = await recordings.findOne({ id: req.params.id });
      if (!recording || !recording.videoPath) return res.status(404).json({ error: "No video" });
      const absPath = path2.join(RECORDINGS_DIR, `${req.params.id}.webm`);
      if (!fs2.existsSync(absPath)) return res.status(404).json({ error: "Video file not found" });
      const stat = fs2.statSync(absPath);
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Type": "video/webm"
        });
        fs2.createReadStream(absPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Content-Type": "video/webm",
          "Accept-Ranges": "bytes"
        });
        fs2.createReadStream(absPath).pipe(res);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/v1/recordings/:id/video/:tabId", requireApiKey, async (req, res) => {
    try {
      await ensureMongoConnected();
      const { id, tabId } = req.params;
      const videoPath = path2.join(RECORDINGS_DIR, `${id}-tab-${tabId}.webm`);
      fs2.writeFileSync(videoPath, req.body);
      const recordings = mongodb.getRecordingsCollection();
      await recordings.updateOne(
        { id },
        { $set: { updatedAt: /* @__PURE__ */ new Date() } }
      );
      res.json({ success: true, size: req.body.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/v1/recordings/:id/video/:tabId", (req, res) => {
    const { id, tabId } = req.params;
    const absPath = path2.join(RECORDINGS_DIR, `${id}-tab-${tabId}.webm`);
    if (!fs2.existsSync(absPath)) return res.status(404).json({ error: "No video for this tab" });
    const stat = fs2.statSync(absPath);
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": "video/webm"
      });
      fs2.createReadStream(absPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": "video/webm",
        "Accept-Ranges": "bytes"
      });
      fs2.createReadStream(absPath).pipe(res);
    }
  });
  app.get("/api/v1/recordings/:id/events", async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordingEvents = mongodb.getRecordingEventsCollection();
      const docs = await recordingEvents.find({ recordingId: req.params.id }, { projection: { _id: 0 } }).sort({ chunkIndex: 1 }).toArray();
      if (docs.length === 0) return res.json({ rrwebEvents: [], networkEntries: [], interactions: [] });
      const rrwebEvents = [];
      const networkEntries = [];
      const interactions = [];
      for (const d of docs) {
        if (d.rrwebEvents) rrwebEvents.push(...d.rrwebEvents);
        if (d.networkEntries) networkEntries.push(...d.networkEntries);
        if (d.interactions) interactions.push(...d.interactions);
      }
      res.json({ rrwebEvents, networkEntries, interactions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.put("/api/v1/recordings/:id", async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const { title, description, tags } = req.body;
      const update = { updatedAt: /* @__PURE__ */ new Date() };
      if (title !== void 0) update.title = title;
      if (description !== void 0) update.description = description;
      if (tags !== void 0) update.tags = tags;
      const result = await recordings.updateOne({ id: req.params.id }, { $set: update });
      if (result.matchedCount === 0) return res.status(404).json({ error: "Not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.put("/api/v1/recordings/:id/annotations", async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const { annotations } = req.body;
      await recordings.updateOne(
        { id: req.params.id },
        { $set: { annotations: annotations || [], updatedAt: /* @__PURE__ */ new Date() } }
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/v1/recordings/:id/frame", async (req, res) => {
    try {
      await ensureMongoConnected();
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      const recordings = mongodb.getRecordingsCollection();
      const recording = await recordings.findOne({ id: req.params.id });
      if (!recording) return res.status(404).json({ error: "Recording not found" });
      const targetTs = parseInt(req.query.t || "0", 10) || recording.startTime;
      const tabId = req.query.tabId ? parseInt(req.query.tabId, 10) : recording.primaryTabId ?? recording.recordedTabIds?.[0];
      const videoFile = tabId ? path2.join(RECORDINGS_DIR, `${req.params.id}-tab-${tabId}.webm`) : path2.join(RECORDINGS_DIR, `${req.params.id}.webm`);
      if (!fs2.existsSync(videoFile)) return res.status(404).json({ error: "No video file found" });
      const videoStartTimes = recording.videoStartTimes || {};
      const videoStart = tabId && videoStartTimes[tabId] ? videoStartTimes[tabId] : recording.videoStartTime ?? recording.startTime;
      const offsetSec = Math.max(0, (targetTs - videoStart) / 1e3).toFixed(3);
      res.setHeader("Content-Type", "image/png");
      const ffmpeg = exec(
        `ffmpeg -ss ${offsetSec} -i "${videoFile}" -vframes 1 -f image2 -vcodec png pipe:1`,
        { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
        (err, stdout) => {
          if (err) {
            if (!res.headersSent) res.status(500).json({ error: err.message });
            return;
          }
          res.end(stdout);
        }
      );
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/rrweb-player", (_req, res) => {
    const viewPath = path2.join(__dirname2, "views", "rrweb-player.html");
    if (fs2.existsSync(viewPath)) {
      res.sendFile(viewPath);
    } else {
      res.status(404).send("rrweb player not found");
    }
  });
  app.use("/public", express.static(path2.join(__dirname2, "public")));
  app.get("/review", async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const results = await recordings.find({}, { projection: { _id: 0, rrwebEvents: 0 } }).sort({ createdAt: -1 }).limit(50).toArray();
      const rows = results.map((r) => `
        <tr>
          <td><a href="/review/${r.id}">${r.title || "Untitled"}</a></td>
          <td>${new Date(r.startTime).toLocaleString()}</td>
          <td>${Math.round((r.duration || 0) / 1e3)}s</td>
          <td>${r.pages?.length || 0} pages</td>
          <td>${r.rrwebEventCount || 0} DOM / ${r.networkEntryCount || 0} net</td>
          <td>${r.videoPath ? "\u2713" : "\u2014"}</td>
          <td><a href="/review/${r.id}">Review</a></td>
        </tr>`).join("");
      res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recordings</title>
        <style>body{font-family:sans-serif;max-width:1200px;margin:40px auto;padding:0 20px}
        table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #ddd}
        th{background:#f5f5f5;font-weight:600}a{color:#6f42c1;text-decoration:none}
        a:hover{text-decoration:underline}h1{color:#1a1a1a}</style></head>
        <body><h1>Session Recordings</h1>
        <table><thead><tr><th>Title</th><th>Date</th><th>Duration</th><th>Pages</th><th>Events</th><th>Video</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7">No recordings yet</td></tr>'}</tbody></table></body></html>`);
    } catch (err) {
      res.status(500).send("Error: " + err.message);
    }
  });
  app.get("/review/:id", async (req, res) => {
    try {
      const viewPath = path2.join(__dirname2, "views", "review.html");
      if (fs2.existsSync(viewPath)) {
        res.sendFile(viewPath);
      } else {
        res.status(404).send("Review UI not found");
      }
    } catch (err) {
      res.status(500).send("Error: " + err.message);
    }
  });
  const httpMcpServer = await createServerWithoutWebSocket({
    name: appConfig.name,
    version: package_default.version,
    tools: snapshotTools,
    resources
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: void 0
    // Stateless mode
  });
  await httpMcpServer.connect(transport);
  app.post("/mcp", requireLan, (req, res) => {
    console.log(`[HTTP] New MCP request from ${req.ip}`);
    transport.handleRequest(req, res, req.body);
  });
  const httpServer = app.listen(port, () => {
    console.log(`[HTTP] Browser MCP server listening on http://localhost:${port}`);
    console.log(`[HTTP] MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`[HTTP] Health check: http://localhost:${port}/health`);
    console.log(`[HTTP] Install page:  http://localhost:${port}/install`);
    console.log(`[HTTP] Auth policy:   ${isAuthEnabled() ? "LAN open, remote requires API key (UNIBROWSE_API_KEYS set)" : "open (no UNIBROWSE_API_KEYS \u2014 all clients allowed)"}`);
  });
  const { createWebSocketServerFromHTTP } = await import("./ws-S7OJF7HG.js");
  const wss = createWebSocketServerFromHTTP(httpServer);
  const WS_HEARTBEAT_MS = 3e4;
  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });
  });
  const wsHeartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client;
      if (ws.isAlive === false) {
        try {
          ws.terminate();
        } catch {
        }
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
      }
    }
  }, WS_HEARTBEAT_MS);
  wss.on("close", () => clearInterval(wsHeartbeat));
  await createServerWithTools({
    name: appConfig.name,
    version: package_default.version,
    tools: snapshotTools,
    resources,
    wss
    // Pass the WebSocket server
  });
  console.log(`[HTTP] WebSocket endpoint: ws://localhost:${port}/ws`);
  console.log(`[HTTP] Combined HTTP + WebSocket server ready`);
}
main().catch((error) => {
  console.error("[HTTP] Fatal error:", error);
  process.exit(1);
});
