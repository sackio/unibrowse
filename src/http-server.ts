#!/usr/bin/env node
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { appConfig } from "@/config/app.config";

import type { Resource } from "@/resources/resource";
import { createServerWithTools, createServerWithoutWebSocket, globalContext } from "@/server";
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
import { installLandingHandler, installZipHandler } from "@/install";
import { requireApiKey, requireLan, isAuthEnabled, isLocalClient, getEffectiveClientIP } from "@/utils/auth";
import * as realisticInput from "@/tools/realistic-input";
import * as multiTabManagement from "@/tools/multi-tab-management";
import * as videoRecording from "@/tools/video-recording";
import * as frames from "@/tools/frames";
import * as errors from "@/tools/errors";
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
  common.setDeviceMetrics,
  common.setFileInput,
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
  recordings.updateRecording,
  recordings.deleteRecording,
  recordings.startSessionRecording,
  recordings.stopSessionRecording,
  recordings.getSessionRecordingState,
  recordings.getRecordingScreenshot,
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
  chromeLauncher.closeIsolatedChrome,
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
  macros.getMacro,
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
  multiTabManagement.reserveTab,
  multiTabManagement.releaseTab,
];

const frameTools: Tool[] = [
  frames.listFrames,
];

const diagnosticTools: Tool[] = [
  errors.getErrors,
  errors.reloadExtension,
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
  ...frameTools,
  ...diagnosticTools,
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
  app.use(express.json({ limit: "10gb" }));

  // Allow large binary uploads for video (matches both /video and /video/:tabId)
  app.use("/api/v1/recordings/:id/video", express.raw({ type: "video/*", limit: "500mb" }));

  // CORS for extension fetch calls
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  const port = parseInt(process.env.PORT || "9010");

  // Health check endpoint — always public (used by docker healthcheck + LAN probe)
  app.get("/health", (req, res) => {
    const authOn = isAuthEnabled();
    const local = isLocalClient(req);
    res.json({
      status: "ok",
      version: packageJSON.version,
      // All gated routes (/mcp, /ws, /install/zip, /api/v1/recordings/*)
      // share the same policy: LAN clients always allowed; remote clients
      // need an API key when UNIBROWSE_API_KEYS is set.
      policy: authOn ? "lan-open-remote-required" : "open",
      authRequired: authOn && !local,
      clientIp: getEffectiveClientIP(req),
      isLocalClient: local,
    });
  });

  // Connected extensions + recent disconnects. Public, read-only, no secrets.
  //
  // ⚠️ The point of this endpoint is that it answers "is a usable browser
  // attached, and if not, when and how did it go?" WITHOUT needing a browser.
  // Every previous instrument for that question lived inside the extension, so
  // it died with the thing it was measuring.
  //
  // `hostBrowserPresent` deliberately encodes the SAME gate the login script
  // uses (an extension that is neither a container sidecar nor off-host), so a
  // watchdog built on this cannot report healthy for a browser the login would
  // reject. ⛔ It is NOT proof a sign-in will complete: the container sidecar
  // requests a magic link happily and then hangs forever consuming one. Necessary,
  // not sufficient — treat a true here as "worth attempting", never as success.
  app.get("/extensions", (_req, res) => {
    const identities = globalContext.describeExtensions();
    const usable = identities.filter(
      (e) => e.kind !== "container-sidecar" && e.kind !== "lan-remote",
    );
    res.json({
      hostBrowserPresent: usable.length > 0,
      hostBrowserKinds: usable.map((e) => e.kind),
      connected: identities,
      // Newest last. Close code is the diagnostic field: 1000/1001 = deliberate
      // close (worker shutdown), 1006 = socket vanished with no close frame.
      recentDisconnects: globalContext.getDisconnects(),
    });
  });

  // Extension distribution — public landing page; the zip download itself is
  // gated by the same API key middleware when UNIBROWSE_API_KEYS is set.
  app.get("/install", installLandingHandler);
  app.get("/install/extension.zip", installZipHandler);

  // Chromium-host sidecar bootstrap. The chromium-host service spawns each
  // new chromium with this URL as the first tab (carrying ws/http/key as
  // query params). The extension's unibrowse-seed.js content script picks
  // up the params on document_start and writes them to chrome.storage.local
  // so resolveServerConfig finds a non-localhost default on first connect.
  // Public route (no API key) since the page itself contains no secrets;
  // the key in the URL is what the page is meant to seed.
  app.get("/__unibrowse_seed", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      `<!doctype html><meta charset=utf-8><title>unibrowse seed</title><body>seeding…</body>`,
    );
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
  app.post("/api/v1/recordings", requireApiKey, async (req: any, res: any) => {
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
        primaryTabId: body.primaryTabId || null,
        recordedTabIds: body.recordedTabIds || [],
        videoStartTimes: body.videoStartTimes || {},
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
  app.post("/api/v1/recordings/:id/video", requireApiKey, async (req: any, res: any) => {
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

  // POST /api/v1/recordings/:id/events — append a chunk of events.
  // Recordings can produce >16MB of events (Mongo's per-doc limit), so each call
  // inserts a NEW chunk doc rather than replacing. Pass ?reset=1 on the first
  // chunk to wipe any prior chunks for this recording (re-uploads).
  // Chunks are reassembled on read by querying all docs for recordingId, sorted
  // by chunkIndex.
  app.post("/api/v1/recordings/:id/events", requireApiKey, async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const { rrwebEvents = [], networkEntries = [], interactions = [], chunkIndex = 0 } = req.body as any;
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
        updatedAt: new Date(),
      });
      res.json({ success: true, chunkIndex, rrwebEventCount: rrwebEvents.length, networkEntryCount: networkEntries.length, interactionCount: interactions.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/recordings/:id/annotations — fetch all user-drawn annotations
  // for a recording, sorted by timestamp. Used by the review viewer to render
  // them on the timeline + side panel. Read-only.
  app.get("/api/v1/recordings/:id/annotations", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const col = mongodb.getRecordingAnnotationsCollection();
      const docs = await col
        .find({ recordingId: id }, { projection: { _id: 0, recordingId: 0 } })
        .sort({ timestamp: 1 })
        .toArray();
      res.json({ annotations: docs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/v1/recordings/:id/annotations — append a single user annotation.
  // Annotations carry base64 PNG screenshots (~100-300KB each) so they're
  // uploaded one-per-request rather than chunked with events. Each becomes
  // a separate doc in the recordingAnnotations collection.
  app.post("/api/v1/recordings/:id/annotations", requireApiKey, async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const annotation = req.body as any;
      const col = mongodb.getRecordingAnnotationsCollection();
      // Idempotency: if the same annotationId is re-uploaded (resume / retry),
      // replace rather than insert duplicate.
      await col.updateOne(
        { recordingId: id, id: annotation.id },
        { $set: { ...annotation, recordingId: id, updatedAt: new Date() } },
        { upsert: true },
      );
      res.json({ success: true, annotationId: annotation.id });
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

  // POST /api/v1/recordings/:id/video/:tabId — upload per-tab video
  app.post("/api/v1/recordings/:id/video/:tabId", requireApiKey, async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const { id, tabId } = req.params;
      const videoPath = path.join(RECORDINGS_DIR, `${id}-tab-${tabId}.webm`);
      fs.writeFileSync(videoPath, req.body as Buffer);
      const recordings = mongodb.getRecordingsCollection();
      await recordings.updateOne(
        { id },
        { $set: { updatedAt: new Date() } }
      );
      res.json({ success: true, size: (req.body as Buffer).length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/recordings/:id/video/:tabId — stream per-tab video
  app.get("/api/v1/recordings/:id/video/:tabId", (req: any, res: any) => {
    const { id, tabId } = req.params;
    const absPath = path.join(RECORDINGS_DIR, `${id}-tab-${tabId}.webm`);
    if (!fs.existsSync(absPath)) return res.status(404).json({ error: "No video for this tab" });
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
  });

  // GET /api/v1/recordings/:id/events — get rrweb events + network for replay.
  // Aggregates all chunks for this recording, sorted by chunkIndex.
  app.get("/api/v1/recordings/:id/events", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordingEvents = mongodb.getRecordingEventsCollection();
      const docs = await recordingEvents
        .find({ recordingId: req.params.id }, { projection: { _id: 0 } })
        .sort({ chunkIndex: 1 })
        .toArray();
      if (docs.length === 0) return res.json({ rrwebEvents: [], networkEntries: [], interactions: [] });
      const rrwebEvents: any[] = [];
      const networkEntries: any[] = [];
      const interactions: any[] = [];
      for (const d of docs) {
        if (d.rrwebEvents) rrwebEvents.push(...d.rrwebEvents);
        if (d.networkEntries) networkEntries.push(...d.networkEntries);
        if (d.interactions) interactions.push(...d.interactions);
      }
      res.json({ rrwebEvents, networkEntries, interactions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/v1/recordings/:id — update title, description, tags
  app.put("/api/v1/recordings/:id", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const { title, description, tags } = req.body as any;
      const update: any = { updatedAt: new Date() };
      if (title !== undefined) update.title = title;
      if (description !== undefined) update.description = description;
      if (tags !== undefined) update.tags = tags;
      const result = await recordings.updateOne({ id: req.params.id }, { $set: update });
      if (result.matchedCount === 0) return res.status(404).json({ error: "Not found" });
      res.json({ success: true });
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

  // GET /api/v1/recordings/:id/frame — extract a video frame at a timestamp via ffmpeg
  app.get("/api/v1/recordings/:id/frame", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      const recordings = mongodb.getRecordingsCollection();
      const recording = await recordings.findOne({ id: req.params.id });
      if (!recording) return res.status(404).json({ error: "Recording not found" });

      const targetTs = parseInt(req.query.t as string || "0", 10) || recording.startTime;
      const tabId = req.query.tabId ? parseInt(req.query.tabId as string, 10) : (recording.primaryTabId ?? recording.recordedTabIds?.[0]);

      const videoFile = tabId
        ? path.join(RECORDINGS_DIR, `${req.params.id}-tab-${tabId}.webm`)
        : path.join(RECORDINGS_DIR, `${req.params.id}.webm`);

      if (!fs.existsSync(videoFile)) return res.status(404).json({ error: "No video file found" });

      const videoStartTimes = recording.videoStartTimes || {};
      const videoStart = (tabId && videoStartTimes[tabId])
        ? videoStartTimes[tabId]
        : (recording.videoStartTime ?? recording.startTime);
      const offsetSec = Math.max(0, (targetTs - videoStart) / 1000).toFixed(3);

      res.setHeader("Content-Type", "image/png");
      const ffmpeg = exec(
        `ffmpeg -ss ${offsetSec} -i "${videoFile}" -vframes 1 -f image2 -vcodec png pipe:1`,
        { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 } as any,
        (err: any, stdout: any) => {
          if (err) {
            if (!res.headersSent) res.status(500).json({ error: err.message });
            return;
          }
          res.end(stdout);
        }
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /rrweb-player — rrweb DOM replay player for screenshots
  app.get("/rrweb-player", (_req: any, res: any) => {
    const viewPath = path.join(__dirname, "views", "rrweb-player.html");
    if (fs.existsSync(viewPath)) {
      res.sendFile(viewPath);
    } else {
      res.status(404).send("rrweb player not found");
    }
  });

  // ── Review UI ───────────────────────────────────────────────────────────────

  // Serve static assets copied to dist/public/ by build script
  app.use("/public", express.static(path.join(__dirname, "public")));

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
      const viewPath = path.join(__dirname, "views", "review.html");
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

  // MCP endpoint — LAN-ONLY, no remote access even with a valid API key.
  // The MCP control plane can drive browsers (code execution), so it must
  // never be reachable from the public internet when the server is
  // reverse-proxied (browser.pushbuild.com). Remote off-LAN clients are the
  // EXTENSION plane only (/ws + /install + recordings), which stay on
  // requireApiKey. requireLan reads the effective client IP (XFF-aware behind
  // the loopback/docker-bridge proxy) and 403s anything non-LAN.
  app.post("/mcp", requireLan, (req, res) => {
    console.log(`[HTTP] New MCP request from ${req.ip}`);
    transport.handleRequest(req, res, req.body);
  });

  // Start HTTP server
  const httpServer = app.listen(port, () => {
    console.log(`[HTTP] Browser MCP server listening on http://localhost:${port}`);
    console.log(`[HTTP] MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`[HTTP] Health check: http://localhost:${port}/health`);
    console.log(`[HTTP] Install page:  http://localhost:${port}/install`);
    console.log(`[HTTP] Auth policy:   ${isAuthEnabled() ? "LAN open, remote requires API key (UNIBROWSE_API_KEYS set)" : "open (no UNIBROWSE_API_KEYS — all clients allowed)"}`);

    // ⛔ Say it at boot, because the failure is SILENT and fails toward OPEN.
    // Public traffic reaches us through nginx on server4, whose peer address is
    // private; only its membership in UNIBROWSE_TRUSTED_PROXIES makes us read
    // the X-Forwarded-For that marks that traffic REMOTE. With the list empty,
    // nothing errors — every public visitor simply starts classifying as LAN,
    // which bypasses the API key and exposes /mcp. There is no other symptom to
    // notice, so the only chance to notice is here.
    const trustedProxies = (process.env.UNIBROWSE_TRUSTED_PROXIES || "")
      .split(",").map(s => s.trim()).filter(Boolean);
    if (trustedProxies.length === 0) {
      console.warn(
        "[HTTP] ⚠️  UNIBROWSE_TRUSTED_PROXIES is EMPTY. If this server is reachable via a " +
        "reverse proxy (browser.pushbuild.com → nginx on server4), that proxy's traffic will " +
        "now be classified by its PRIVATE peer address, i.e. as LAN — bypassing the API key " +
        "and exposing /mcp. Set it to the proxy's NIC address(es). See EXTRA_TRUSTED_PROXIES " +
        "in src/utils/auth.ts.",
      );
    } else {
      console.log(`[HTTP] Trusted proxies: ${trustedProxies.join(", ")} (their X-Forwarded-For is authoritative; removing one fails toward LAN — see src/utils/auth.ts)`);
    }
  });

  // Create WebSocket server on the same HTTP server
  const { createWebSocketServerFromHTTP } = await import("@/ws");
  const wss = createWebSocketServerFromHTTP(httpServer);

  // WebSocket keepalive heartbeat. REMOTE extensions connect through a reverse
  // proxy (browser.pushbuild.com → server4 nginx → here), which drops an IDLE
  // WS at proxy_read_timeout (600s) → ~10-min reconnect churn (only remote/
  // proxied extensions are affected; LAN-direct ones aren't). A server ping
  // every 30s keeps frames flowing well under that window (the browser's WS
  // auto-replies pong at the protocol level, so no extension change needed) AND
  // reaps genuinely-dead peers (no pong within an interval → terminate).
  const WS_HEARTBEAT_MS = 30_000;
  wss.on("connection", (ws: any) => {
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
  });
  const wsHeartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as any;
      if (ws.isAlive === false) { try { ws.terminate(); } catch { /* ignore */ } continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, WS_HEARTBEAT_MS);
  wss.on("close", () => clearInterval(wsHeartbeat));

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
