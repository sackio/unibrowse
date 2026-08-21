import { zodToJsonSchema } from "zod-to-json-schema";

import {
  DownloadFileTool,
  GetDownloadsTool,
  CancelDownloadTool,
  OpenDownloadTool,
} from "@/types/tool-schemas";
import { jsonResponse, textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

// ⛔ NO TOOL IN THIS FILE MAY CALL ensureAttachedFromParams().
//
// All four are BROWSER-scoped, not tab-scoped. Verified against the extension
// on 2026-08-20 by reading every handler body: handleDownloadFile / handleGetDownloads / handleCancelDownload / handleOpenDownload
// use ONLY the chrome.downloads API and contain zero references to chrome.tabs,
// chrome.debugger, tabId or tabTarget. The attach pre-flight they used to run
// was pure liability -- it opened or attached a tab purely to discard it, and
// the server side never even looked at its return value.
//
// This is the same defect fixed in system.ts/extensions.ts by 737069d, whose
// symptom was: with no tab attached, ensure_attached auto-opens one, and if
// that tab settles on a page extensions cannot debug, Chrome raises "Cannot
// access a chrome-extension:// URL of different extension" and the whole call
// fails. It looks exactly like a dead browser and is not one. Calls that passed
// an explicit tabTarget kept working, which is what made it look intermittent.
//
// ⛔ THE REASON IT SURVIVED IN THESE FOUR: they LOOK tab-scoped. Cookies and
// history feel like properties of a page. They are not -- they are profile-wide
// stores, and the extension reads them without a tab. ⇒ Judge scope by what the
// HANDLER touches, never by what the tool name suggests.
//
// Routing is unaffected: sendSocketMessage() reads extensionId straight off the
// payload, so multi-extension disambiguation still works and still raises the
// normal "Multiple extensions are connected" error when the caller omits it.

/**
 * Download a file from a URL
 * Initiates a file download from the specified URL. Can optionally specify a filename
 * and whether to prompt the user for a save location. Returns the download ID for
 * tracking and management.
 */
export const downloadFile: Tool = {
  schema: {
    name: DownloadFileTool.shape.name.value,
    description: DownloadFileTool.shape.description.value,
    inputSchema: zodToJsonSchema(DownloadFileTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = DownloadFileTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_download_file", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to download file: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Get list of downloads with optional filtering
 * Retrieves download history with optional filtering by search terms and ordering.
 * Returns download items with details including filename, URL, status, progress,
 * and timestamps. Useful for tracking download history and managing active downloads.
 */
export const getDownloads: Tool = {
  schema: {
    name: GetDownloadsTool.shape.name.value,
    description: GetDownloadsTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetDownloadsTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = GetDownloadsTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_downloads", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get downloads: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Cancel a download in progress
 * Cancels an active download by its ID. The download will be stopped and removed
 * from the downloads list. Useful for stopping unwanted or stalled downloads.
 */
export const cancelDownload: Tool = {
  schema: {
    name: CancelDownloadTool.shape.name.value,
    description: CancelDownloadTool.shape.description.value,
    inputSchema: zodToJsonSchema(CancelDownloadTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = CancelDownloadTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_cancel_download", validatedParams);
      return textResponse(`Download ${validatedParams.downloadId} cancelled`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to cancel download: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Open a downloaded file
 * Opens a downloaded file using the system's default application for that file type.
 * The download must be complete and the file must still exist on disk.
 */
export const openDownload: Tool = {
  schema: {
    name: OpenDownloadTool.shape.name.value,
    description: OpenDownloadTool.shape.description.value,
    inputSchema: zodToJsonSchema(OpenDownloadTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = OpenDownloadTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_open_download", validatedParams);
      return textResponse(`Opened download ${validatedParams.downloadId}`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to open download: ${error.message}`, false, error, max_tokens);
    }
  },
};
