#!/usr/bin/env node
import {
  appConfig,
  attachTab,
  cancelDownload,
  checkElementState,
  checkVisibility,
  clearCache,
  clearCookies,
  clearHistory,
  click,
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
  getNetworkLogs,
  getNetworkState,
  getPageMetadata,
  getRecording,
  getSystemInfo,
  getVersion,
  getVisibleText,
  goBack,
  goForward,
  hover,
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
  requestUserAction,
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
  wait
} from "./chunk-RF24MMFJ.js";
import "./chunk-FT2ARCXD.js";

// src/http-server.ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(__dirname, "..", "recordings");
var commonTools = [
  pressKey,
  scroll,
  scrollToElement,
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
  deleteRecording,
  startSessionRecording,
  stopSessionRecording
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
  launchIsolatedChrome
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
  attachTab
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
  ...videoRecordingTools
];
var resources = [];
async function main() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use("/api/v1/recordings/:id/video", express.raw({ type: "video/*", limit: "500mb" }));
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  const port = parseInt(process.env.PORT || "9010");
  app.get("/health", (req, res) => {
    res.json({ status: "ok", version: package_default.version });
  });
  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  }
  async function ensureMongoConnected() {
    if (!mongodb.isConnected()) await mongodb.connect();
  }
  app.post("/api/v1/recordings", async (req, res) => {
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
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      };
      await recordings.insertOne(doc);
      res.json({ id: doc.id, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/v1/recordings/:id/video", async (req, res) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const videoPath = path.join(RECORDINGS_DIR, `${id}.webm`);
      fs.writeFileSync(videoPath, req.body);
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
  app.post("/api/v1/recordings/:id/events", async (req, res) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const { rrwebEvents = [], networkEntries = [] } = req.body;
      const recordingEvents = mongodb.getRecordingEventsCollection();
      await recordingEvents.replaceOne(
        { recordingId: id },
        { recordingId: id, rrwebEvents, networkEntries, updatedAt: /* @__PURE__ */ new Date() },
        { upsert: true }
      );
      const recordings = mongodb.getRecordingsCollection();
      await recordings.updateOne(
        { id },
        { $set: { rrwebEventCount: rrwebEvents.length, networkEntryCount: networkEntries.length, updatedAt: /* @__PURE__ */ new Date() } }
      );
      res.json({ success: true, rrwebEventCount: rrwebEvents.length, networkEntryCount: networkEntries.length });
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
      const absPath = path.join(RECORDINGS_DIR, `${req.params.id}.webm`);
      if (!fs.existsSync(absPath)) return res.status(404).json({ error: "Video file not found" });
      const stat = fs.statSync(absPath);
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
        fs.createReadStream(absPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Content-Type": "video/webm",
          "Accept-Ranges": "bytes"
        });
        fs.createReadStream(absPath).pipe(res);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/v1/recordings/:id/events", async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordingEvents = mongodb.getRecordingEventsCollection();
      const doc = await recordingEvents.findOne({ recordingId: req.params.id }, { projection: { _id: 0 } });
      if (!doc) return res.json({ rrwebEvents: [], networkEntries: [] });
      res.json({ rrwebEvents: doc.rrwebEvents || [], networkEntries: doc.networkEntries || [] });
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
  app.use("/public", express.static(path.join(__dirname, "..", "src", "public")));
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
      const viewPath = path.join(__dirname, "..", "src", "views", "review.html");
      if (fs.existsSync(viewPath)) {
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
  app.post("/mcp", (req, res) => {
    console.log(`[HTTP] New MCP request from ${req.ip}`);
    transport.handleRequest(req, res, req.body);
  });
  const httpServer = app.listen(port, () => {
    console.log(`[HTTP] Browser MCP server listening on http://localhost:${port}`);
    console.log(`[HTTP] MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`[HTTP] Health check: http://localhost:${port}/health`);
  });
  const { createWebSocketServerFromHTTP } = await import("./ws-XJAPUUIR.js");
  const wss = createWebSocketServerFromHTTP(httpServer);
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
