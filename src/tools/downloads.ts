import { zodToJsonSchema } from "zod-to-json-schema";

import {
  DownloadFileTool,
  GetDownloadsTool,
  CancelDownloadTool,
  OpenDownloadTool,
} from "@/types/tool-schemas";
import { jsonResponse, textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

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
    try {
      await context.ensureAttached();
      const validatedParams = DownloadFileTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_download_file", validatedParams);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to download file: ${error.message}`, false, error);
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
    try {
      await context.ensureAttached();
      const validatedParams = GetDownloadsTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_downloads", validatedParams);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to get downloads: ${error.message}`, false, error);
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
    try {
      await context.ensureAttached();
      const validatedParams = CancelDownloadTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_cancel_download", validatedParams);
      return textResponse(`Download ${validatedParams.downloadId} cancelled`);
    } catch (error) {
      return errorResponse(`Failed to cancel download: ${error.message}`, false, error);
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
    try {
      await context.ensureAttached();
      const validatedParams = OpenDownloadTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_open_download", validatedParams);
      return textResponse(`Opened download ${validatedParams.downloadId}`);
    } catch (error) {
      return errorResponse(`Failed to open download: ${error.message}`, false, error);
    }
  },
};
