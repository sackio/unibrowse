#!/usr/bin/env node
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { appConfig } from "@/config/app.config";

import type { Resource } from "@/resources/resource";
import { createServerWithTools, createServerWithoutWebSocket } from "@/server";
import * as bookmarks from "@/tools/bookmarks";
import * as clipboard from "@/tools/clipboard";
import * as common from "@/tools/common";
import * as cookies from "@/tools/cookies";
import * as custom from "@/tools/custom";
import * as downloads from "@/tools/downloads";
import * as extensions from "@/tools/extensions";
import * as exploration from "@/tools/exploration";
import * as forms from "@/tools/forms";
import * as history from "@/tools/history";
import * as interactions from "@/tools/interactions";
import * as network from "@/tools/network";
import * as snapshot from "@/tools/snapshot";
import * as system from "@/tools/system";
import * as tabs from "@/tools/tabs";
import * as userAction from "@/tools/user-action";
import * as macros from "@/tools/macros";
import * as recordings from "@/tools/recordings";
import * as realisticInput from "@/tools/realistic-input";
import * as multiTabManagement from "@/tools/multi-tab-management";
import * as videoRecording from "@/tools/video-recording";
import * as chromeLauncher from "@/tools/chrome-launcher";
import type { Tool } from "@/tools/tool";

import packageJSON from "../package.json";
import { mongodb } from "@/utils/mongodb";
import { v4 as uuidv4 } from "uuid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(__dirname, "..", "recordings");

const commonTools: Tool[] = [
  common.pressKey,
  common.scroll,
  common.scrollToElement,
  common.wait,
];

const customTools: Tool[] = [
  custom.evaluate,
  custom.getConsoleLogs,
  custom.getNetworkLogs,
  custom.screenshot,
  custom.segmentedScreenshot,
];

const explorationTools: Tool[] = [
  exploration.queryDOM,
  exploration.getVisibleText,
  exploration.getComputedStyles,
  exploration.checkVisibility,
  exploration.getAttributes,
  exploration.countElements,
  exploration.getPageMetadata,
  exploration.getFilteredAriaTree,
  exploration.findByText,
  exploration.getFormValues,
  exploration.checkElementState,
];

const tabTools: Tool[] = [
  tabs.listTabs,
  tabs.switchTab,
  tabs.createTab,
  tabs.closeTab,
  tabs.createWindow,
];

const formTools: Tool[] = [
  forms.fillForm,
  forms.submitForm,
];

const recordingTools: Tool[] = [
  userAction.requestUserAction(false),
  recordings.saveRecording,
  recordings.listRecordings,
  recordings.getRecording,
  recordings.deleteRecording,
  recordings.startSessionRecording,
  recordings.stopSessionRecording,
];

const interactionTools: Tool[] = [
  interactions.getInteractions,
  interactions.pruneInteractions,
  interactions.searchInteractions,
];

const cookieTools: Tool[] = [
  cookies.getCookies,
  cookies.setCookie,
  cookies.deleteCookie,
  cookies.clearCookies,
];

const downloadTools: Tool[] = [
  downloads.downloadFile,
  downloads.getDownloads,
  downloads.cancelDownload,
  downloads.openDownload,
];

const clipboardTools: Tool[] = [
  clipboard.getClipboard,
  clipboard.setClipboard,
];

const historyTools: Tool[] = [
  history.searchHistory,
  history.getHistoryVisits,
  history.deleteHistory,
  history.clearHistory,
];

const systemTools: Tool[] = [
  system.getVersion,
  system.getSystemInfo,
  system.getBrowserInfo,
  chromeLauncher.launchIsolatedChrome,
];

const networkTools: Tool[] = [
  network.getNetworkState,
  network.setNetworkConditions,
  network.clearCache,
];

const bookmarkTools: Tool[] = [
  bookmarks.getBookmarks,
  bookmarks.createBookmark,
  bookmarks.deleteBookmark,
  bookmarks.searchBookmarks,
];

const extensionTools: Tool[] = [
  extensions.listExtensions,
  extensions.getExtensionInfo,
  extensions.enableExtension,
  extensions.disableExtension,
];

const macroTools: Tool[] = [
  macros.storeMacro,
  macros.listMacros,
  macros.executeMacro,
  macros.updateMacro,
  macros.deleteMacro,
];

const realisticInputTools: Tool[] = [
  realisticInput.realisticMouseMove,
  realisticInput.realisticClick,
  realisticInput.realisticType,
];

const videoRecordingTools: Tool[] = [
  videoRecording.startVideoRecording,
  videoRecording.stopVideoRecording,
];

const multiTabTools: Tool[] = [
  multiTabManagement.listAttachedTabs,
  multiTabManagement.setTabLabel,
  multiTabManagement.detachTab,
  multiTabManagement.getActiveTab,
  multiTabManagement.attachTab,
];

const snapshotTools: Tool[] = [
  common.navigate(false),
  common.goBack(false),
  common.goForward(false),
  snapshot.snapshot,
  snapshot.click,
  snapshot.drag,
  snapshot.hover,
  snapshot.type,
  snapshot.selectOption,
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
];

const resources: Resource[] = [];

// Create server with WebSocket for Chrome extension
async function createServerWithWebSocket(): Promise<Server> {
  return createServerWithTools({
    name: appConfig.name,
    version: packageJSON.version,
    tools: snapshotTools,
    resources,
  });
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));

  // Allow large binary uploads for video
  app.use("/api/v1/recordings/:id/video", express.raw({ type: "video/*", limit: "500mb" }));

  // CORS for extension fetch calls
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  const port = parseInt(process.env.PORT || "9010");

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", version: packageJSON.version });
  });

  // ── Session Recording API ───────────────────────────────────────────────────

  // Ensure recordings directory exists
  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  }

  // Ensure MongoDB connected for recording routes
  async function ensureMongoConnected() {
    if (!mongodb.isConnected()) await mongodb.connect();
  }

  // POST /api/v1/recordings — create recording metadata, return id
  app.post("/api/v1/recordings", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const body = req.body as any;
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
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await recordings.insertOne(doc);
      res.json({ id: doc.id, success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/v1/recordings/:id/video — upload raw video bytes
  app.post("/api/v1/recordings/:id/video", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const videoPath = path.join(RECORDINGS_DIR, `${id}.webm`);
      fs.writeFileSync(videoPath, req.body as Buffer);
      const recordings = mongodb.getRecordingsCollection();
      await recordings.updateOne(
        { id },
        { $set: { videoPath: `recordings/${id}.webm`, updatedAt: new Date() } }
      );
      res.json({ success: true, videoPath: `recordings/${id}.webm` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/v1/recordings/:id/events — upload rrweb events + network entries
  app.post("/api/v1/recordings/:id/events", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const { rrwebEvents = [], networkEntries = [] } = req.body as any;
      const recordingEvents = mongodb.getRecordingEventsCollection();
      await recordingEvents.replaceOne(
        { recordingId: id },
        { recordingId: id, rrwebEvents, networkEntries, updatedAt: new Date() },
        { upsert: true }
      );
      const recordings = mongodb.getRecordingsCollection();
      await recordings.updateOne(
        { id },
        { $set: { rrwebEventCount: rrwebEvents.length, networkEntryCount: networkEntries.length, updatedAt: new Date() } }
      );
      res.json({ success: true, rrwebEventCount: rrwebEvents.length, networkEntryCount: networkEntries.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/recordings — list recordings
  app.get("/api/v1/recordings", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const limit = parseInt(String(req.query.limit || "50"));
      const results = await recordings
        .find({}, { projection: { _id: 0, rrwebEvents: 0 } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      res.json({ count: results.length, recordings: results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/recordings/:id — get single recording metadata
  app.get("/api/v1/recordings/:id", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const recording = await recordings.findOne({ id: req.params.id }, { projection: { _id: 0 } });
      if (!recording) return res.status(404).json({ error: "Not found" });
      res.json({ recording });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/recordings/:id/video — stream video file
  app.get("/api/v1/recordings/:id/video", async (req: any, res: any) => {
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
          "Content-Type": "video/webm",
        });
        fs.createReadStream(absPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Content-Type": "video/webm",
          "Accept-Ranges": "bytes",
        });
        fs.createReadStream(absPath).pipe(res);
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/recordings/:id/events — get rrweb events + network for replay
  app.get("/api/v1/recordings/:id/events", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordingEvents = mongodb.getRecordingEventsCollection();
      const doc = await recordingEvents.findOne({ recordingId: req.params.id }, { projection: { _id: 0 } });
      if (!doc) return res.json({ rrwebEvents: [], networkEntries: [] });
      res.json({ rrwebEvents: doc.rrwebEvents || [], networkEntries: doc.networkEntries || [] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/v1/recordings/:id/annotations — save annotations
  app.put("/api/v1/recordings/:id/annotations", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const { annotations } = req.body as any;
      await recordings.updateOne(
        { id: req.params.id },
        { $set: { annotations: annotations || [], updatedAt: new Date() } }
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Review UI ───────────────────────────────────────────────────────────────

  // Serve rrweb bundle for review page (src/public/ — not bundled by tsup)
  app.use("/public", express.static(path.join(__dirname, "..", "src", "public")));

  // GET /review — list recordings
  app.get("/review", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const results = await recordings
        .find({}, { projection: { _id: 0, rrwebEvents: 0 } })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();
      const rows = results.map((r: any) => `
        <tr>
          <td><a href="/review/${r.id}">${r.title || "Untitled"}</a></td>
          <td>${new Date(r.startTime).toLocaleString()}</td>
          <td>${Math.round((r.duration || 0) / 1000)}s</td>
          <td>${r.pages?.length || 0} pages</td>
          <td>${r.rrwebEventCount || 0} DOM / ${r.networkEntryCount || 0} net</td>
          <td>${r.videoPath ? "✓" : "—"}</td>
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
    } catch (err: any) {
      res.status(500).send("Error: " + err.message);
    }
  });

  // GET /review/:id — full review UI
  app.get("/review/:id", async (req: any, res: any) => {
    try {
      const viewPath = path.join(__dirname, "..", "src", "views", "review.html");
      if (fs.existsSync(viewPath)) {
        res.sendFile(viewPath);
      } else {
        res.status(404).send("Review UI not found");
      }
    } catch (err: any) {
      res.status(500).send("Error: " + err.message);
    }
  });

  // Create HTTP MCP server with Streamable HTTP transport
  const httpMcpServer = await createServerWithoutWebSocket({
    name: appConfig.name,
    version: packageJSON.version,
    tools: snapshotTools,
    resources,
  });

  // Create transport instance - stateless mode (no session ID)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode
  });

  // Connect MCP server to transport
  await httpMcpServer.connect(transport);

  // MCP endpoint - delegates to transport.handleRequest()
  app.post("/mcp", (req, res) => {
    console.log(`[HTTP] New MCP request from ${req.ip}`);
    transport.handleRequest(req, res, req.body);
  });

  // Start HTTP server
  const httpServer = app.listen(port, () => {
    console.log(`[HTTP] Browser MCP server listening on http://localhost:${port}`);
    console.log(`[HTTP] MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`[HTTP] Health check: http://localhost:${port}/health`);
  });

  // Create WebSocket server on the same HTTP server
  const { createWebSocketServerFromHTTP } = await import("@/ws");
  const wss = createWebSocketServerFromHTTP(httpServer);

  // Create MCP server with WebSocket for Chrome extension
  await createServerWithTools({
    name: appConfig.name,
    version: packageJSON.version,
    tools: snapshotTools,
    resources,
    wss, // Pass the WebSocket server
  });

  console.log(`[HTTP] WebSocket endpoint: ws://localhost:${port}/ws`);
  console.log(`[HTTP] Combined HTTP + WebSocket server ready`);
}

main().catch((error) => {
  console.error("[HTTP] Fatal error:", error);
  process.exit(1);
});
