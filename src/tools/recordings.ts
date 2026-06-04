import { zodToJsonSchema } from "zod-to-json-schema";
import { v4 as uuidv4 } from "uuid";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(__dirname, "..", "..", "recordings");

import {
  SaveRecordingTool,
  ListRecordingsTool,
  GetRecordingTool,
  UpdateRecordingTool,
  DeleteRecordingTool,
  StartSessionRecordingTool,
  StopSessionRecordingTool,
  GetSessionRecordingStateTool,
  GetRecordingScreenshotTool,
} from "@/types/tool-schemas";
import { jsonResponse, errorResponse, imageResponse } from "@/utils/response-helpers";
import { mongodb } from "@/utils/mongodb";

import { Tool } from "./tool";

/**
 * Save a user interaction recording to MongoDB
 */
export const saveRecording: Tool = {
  schema: {
    name: SaveRecordingTool.shape.name.value,
    description: SaveRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema(SaveRecordingTool.shape.arguments),
  },
  handle: async (_context, params) => {
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }

      const validatedParams = SaveRecordingTool.shape.arguments.parse(params);
      const recordings = mongodb.getRecordingsCollection();

      const now = new Date();
      const recordingDoc = {
        id: uuidv4(),
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
        steps: validatedParams.steps,
      };

      await recordings.insertOne(recordingDoc);

      return jsonResponse({
        success: true,
        id: recordingDoc.id,
        message: `Recording "${validatedParams.title}" saved successfully`,
      });
    } catch (error) {
      return errorResponse(`Failed to save recording: ${error.message}`, false, error);
    }
  },
};

/**
 * List saved recordings with optional filtering
 */
export const listRecordings: Tool = {
  schema: {
    name: ListRecordingsTool.shape.name.value,
    description: ListRecordingsTool.shape.description.value,
    inputSchema: zodToJsonSchema(ListRecordingsTool.shape.arguments),
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }

      const validatedParams = ListRecordingsTool.shape.arguments.parse(params || {});
      const recordings = mongodb.getRecordingsCollection();

      const query: any = {};

      if (validatedParams.tags && validatedParams.tags.length > 0) {
        query.tags = { $in: validatedParams.tags };
      }

      if (validatedParams.startUrl) {
        query.startUrl = { $regex: validatedParams.startUrl, $options: "i" };
      }

      if (validatedParams.search) {
        query.$or = [
          { title: { $regex: validatedParams.search, $options: "i" } },
          { description: { $regex: validatedParams.search, $options: "i" } },
        ];
      }

      const limit = validatedParams.limit || 50;

      const results = await recordings
        .find(query, {
          projection: {
            _id: 0,
            steps: 0, // Exclude steps from list results
          },
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      return jsonResponse({ count: results.length, recordings: results }, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to list recordings: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Get a recording by ID with optional filtered/paginated event data
 */
export const getRecording: Tool = {
  schema: {
    name: GetRecordingTool.shape.name.value,
    description: GetRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetRecordingTool.shape.arguments),
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
        return errorResponse(`Recording with ID "${p.id}" not found`, true, undefined, max_tokens);
      }

      const { pages: recordingPages, ...recordingMeta } = recording as any;
      const result: any = { recording: recordingMeta };

      const wantInteractions = p.includeInteractions || p.includeEvents;
      const wantNetwork = p.includeNetwork || p.includeEvents;

      if (wantInteractions || wantNetwork || p.includeStats) {
        const recordingEvents = mongodb.getRecordingEventsCollection();
        // Aggregate all chunks (recordings >16MB are split across multiple docs).
        const chunks = await recordingEvents
          .find({ recordingId: p.id }, { projection: { _id: 0, recordingId: 0, rrwebEvents: 0 } })
          .sort({ chunkIndex: 1 })
          .toArray();

        const allInteractions: any[] = [];
        const allNetwork: any[] = [];
        for (const ch of chunks) {
          if (ch.interactions) allInteractions.push(...ch.interactions);
          if (ch.networkEntries) allNetwork.push(...ch.networkEntries);
        }

        if (p.includeStats) {
          const kindCounts: Record<string, number> = {};
          for (const i of allInteractions) {
            const k = i.kind ?? "unknown";
            kindCounts[k] = (kindCounts[k] || 0) + 1;
          }
          const networkErrors = allNetwork.filter(n => (n.responseStatus ?? 0) >= 400 || n.error).length;
          const timestamps = allInteractions.map(i => i.timestamp).filter(Boolean);
          const pages = (recordingPages as any[] | undefined) ?? [];
          const topUrls = pages
            .filter(pg => pg.url && !pg.url.startsWith("about:") && !pg.url.includes("js.stripe.com") && !pg.url.includes("stripe.network"))
            .map(pg => ({ url: pg.url, title: pg.title }));
          result.stats = {
            interactionCount: allInteractions.length,
            networkCount: allNetwork.length,
            networkErrorCount: networkErrors,
            interactionsByKind: kindCounts,
            topUrls,
            timeSpanMs: timestamps.length >= 2
              ? Math.max(...timestamps) - Math.min(...timestamps)
              : null,
          };
        }

        if (wantInteractions) {
          let items = allInteractions;
          if (p.startTime != null) items = items.filter(i => (i.timestamp ?? 0) >= p.startTime!);
          if (p.endTime != null)   items = items.filter(i => (i.timestamp ?? 0) <= p.endTime!);
          if (p.interactionTypes?.length) {
            const types = new Set(p.interactionTypes);
            items = items.filter(i => types.has(i.kind));
          }
          if (p.selectorPattern) {
            const re = new RegExp(p.selectorPattern, "i");
            items = items.filter(i => i.selector && re.test(i.selector));
          }
          const limit = p.limit ?? 100;
          const offset = p.offset ?? 0;
          result.interactions = items.slice(offset, offset + limit);
          result.interactionsMeta = { total: items.length, limit, offset, returned: result.interactions.length };
        }

        if (wantNetwork) {
          let items = allNetwork;
          if (p.startTime != null) items = items.filter(n => (n.timestamp ?? n.startTime ?? 0) >= p.startTime!);
          if (p.endTime != null)   items = items.filter(n => (n.timestamp ?? n.startTime ?? 0) <= p.endTime!);
          if (p.networkUrlPattern) {
            const re = new RegExp(p.networkUrlPattern, "i");
            items = items.filter(n => n.url && re.test(n.url));
          }
          if (p.networkMethod) {
            const method = p.networkMethod.toUpperCase();
            items = items.filter(n => n.method?.toUpperCase() === method);
          }
          if (p.networkStatusMin != null) items = items.filter(n => (n.responseStatus ?? 0) >= p.networkStatusMin!);
          if (p.networkStatusMax != null) items = items.filter(n => (n.responseStatus ?? 0) <= p.networkStatusMax!);
          const limit = p.limit ?? 100;
          const offset = p.offset ?? 0;
          result.networkEntries = items.slice(offset, offset + limit);
          result.networkMeta = { total: items.length, limit, offset, returned: result.networkEntries.length };
        }

        result.reviewUrl = `http://localhost:9010/review/${p.id}`;
      }

      return jsonResponse(result, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to get recording: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Update recording title, description, or tags
 */
export const updateRecording: Tool = {
  schema: {
    name: UpdateRecordingTool.shape.name.value,
    description: UpdateRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema(UpdateRecordingTool.shape.arguments),
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
        return errorResponse(`Recording with ID "${validatedParams.id}" not found`, true, undefined, max_tokens);
      }

      const update: any = { updatedAt: new Date() };
      if (validatedParams.title !== undefined) update.title = validatedParams.title;
      if (validatedParams.description !== undefined) update.description = validatedParams.description;
      if (validatedParams.tags !== undefined) update.tags = validatedParams.tags;

      await recordings.updateOne({ id: validatedParams.id }, { $set: update });

      return jsonResponse({
        success: true,
        id: validatedParams.id,
        message: `Recording updated successfully`,
        updated: update,
      }, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to update recording: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Start a rich session recording (rrweb + network + video) — delegates to extension
 */
export const startSessionRecording: Tool = {
  schema: {
    name: StartSessionRecordingTool.shape.name.value,
    description: StartSessionRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema(StartSessionRecordingTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const result = await context.sendSocketMessage("browser_start_session_recording", params || {});
      return jsonResponse(result, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to start session recording: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Stop the active session recording and save to server
 */
export const stopSessionRecording: Tool = {
  schema: {
    name: StopSessionRecordingTool.shape.name.value,
    description: StopSessionRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema(StopSessionRecordingTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      // Allow longer timeout — chunked rrweb/network/video upload for a long
      // session can take 30+ seconds. Without this override the WS-level 30s
      // timeout fires while uploads are still in flight, the agent sees a
      // tool error, but the upload may still complete (background continues
      // after we've given up).
      const result = await context.sendSocketMessage("browser_stop_session_recording", params || {}, { timeoutMs: 120000 });
      return jsonResponse(result, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to stop session recording: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Query whether a session recording is currently in progress on the targeted browser.
 * Delegates to extension's get_session_recording_state internal handler so agents can
 * inspect state without having to start/stop or guess.
 */
export const getSessionRecordingState: Tool = {
  schema: {
    name: GetSessionRecordingStateTool.shape.name.value,
    description: GetSessionRecordingStateTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetSessionRecordingStateTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const result = await context.sendSocketMessage("browser_get_session_recording_state", params || {});
      return jsonResponse(result, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to get session recording state: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Delete a recording by ID
 */
export const deleteRecording: Tool = {
  schema: {
    name: DeleteRecordingTool.shape.name.value,
    description: DeleteRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema(DeleteRecordingTool.shape.arguments),
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
        return errorResponse(`Recording with ID "${validatedParams.id}" not found`, true, undefined, max_tokens);
      }

      await recordings.deleteOne({ id: validatedParams.id });

      return jsonResponse({
        success: true,
        message: `Recording "${existing.title}" deleted successfully`,
        id: existing.id,
      }, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to delete recording: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Screenshot a recording at a specific timestamp — video frame (ffmpeg) or rrweb DOM replay
 */
export const getRecordingScreenshot: Tool = {
  schema: {
    name: GetRecordingScreenshotTool.shape.name.value,
    description: GetRecordingScreenshotTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetRecordingScreenshotTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) await mongodb.connect();

      const p = GetRecordingScreenshotTool.shape.arguments.parse(params);
      const recordingsColl = mongodb.getRecordingsCollection();
      const recording = await recordingsColl.findOne({ id: p.id }, { projection: { _id: 0 } });
      if (!recording) return errorResponse(`Recording "${p.id}" not found`, true, undefined, max_tokens);

      const targetTs = p.timestamp > 0 ? p.timestamp : recording.startTime;
      const mode = p.mode ?? "auto";

      // ── Video frame via ffmpeg ─────────────────────────────────────────────
      const useVideo = mode === "video" || (mode === "auto" && (recording.videoPath || recording.recordedTabIds?.length));

      if (useVideo) {
        // Find the right video file
        const tabId = p.tabId ?? recording.primaryTabId ?? (recording.recordedTabIds?.[0]);
        const videoFile = tabId
          ? path.join(RECORDINGS_DIR, `${p.id}-tab-${tabId}.webm`)
          : path.join(RECORDINGS_DIR, `${p.id}.webm`);

        if (fs.existsSync(videoFile)) {
          const videoStartTimes = recording.videoStartTimes || {};
          const videoStart = (tabId && videoStartTimes[tabId])
            ? videoStartTimes[tabId]
            : (recording.videoStartTime ?? recording.startTime);
          const offsetSec = Math.max(0, (targetTs - videoStart) / 1000).toFixed(3);

          const { stdout } = await execFileAsync("ffmpeg", [
            "-ss", offsetSec,
            "-i", videoFile,
            "-vframes", "1",
            "-f", "image2",
            "-vcodec", "png",
            "pipe:1",
          ], { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 });

          const base64 = (stdout as unknown as Buffer).toString("base64");
          return imageResponse(base64, "image/png", max_tokens);
        }

        if (mode === "video") {
          return errorResponse(`No video file found for recording "${p.id}"${tabId ? ` tab ${tabId}` : ""}`, true, undefined, max_tokens);
        }
        // fall through to DOM mode
      }

      // ── rrweb DOM replay via browser tab ──────────────────────────────────
      await context.ensureAttachedFromParams(params);

      const label = `rrweb-frame-${Date.now()}`;
      const playerUrl = `http://localhost:9010/rrweb-player?id=${p.id}&t=${targetTs}${p.selector ? "&selector=" + encodeURIComponent(p.selector) : ""}`;

      // Create the player tab directly at the URL. Creating a blank tab and then
      // navigating doesn't work: an about:blank tab is "restricted", so it never
      // attaches and the label is never registered — leaving every subsequent
      // tabTarget lookup (navigate/evaluate/screenshot/close) unresolvable.
      await context.sendSocketMessage("browser_create_tab", { url: playerUrl, label });

      try {
        // Poll until __playerReady (up to 15s)
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
          tabTarget: label,
        });

        if (!ready) throw new Error("Player did not become ready");

        // If selector given, get element bounds for a tight crop
        let screenshotSelector = "#rrweb-container";
        if (p.selector) {
          const bounds = await context.sendSocketMessage("browser_evaluate", {
            expression: "window.__elementBounds",
            tabTarget: label,
          });
          // bounds gives viewport coords — use full container but caller can crop; keep full for now
        }

        const shot = await context.sendSocketMessage("browser_screenshot", {
          selector: screenshotSelector,
          tabTarget: label,
        });

        const base64 = shot?.data ?? shot;
        return imageResponse(base64, "image/png", max_tokens);
      } finally {
        await context.sendSocketMessage("browser_close_tab", { tabTarget: label }).catch(() => {});
      }
    } catch (error) {
      return errorResponse(`Failed to get recording screenshot: ${error.message}`, false, error, max_tokens);
    }
  },
};
