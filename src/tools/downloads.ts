import { zodToJsonSchema } from "zod-to-json-schema";

import {
  DownloadFileTool,
  GetDownloadsTool,
  CancelDownloadTool,
  OpenDownloadTool,
  FetchToServerTool,
  ListFetchedTool,
} from "@/types/tool-schemas";
import { jsonResponse, textResponse, errorResponse } from "@/utils/response-helpers";
import { mongodb } from "@/utils/mongodb";

import type { Tool } from "./tool";

// ⛔ NO TOOL IN THIS FILE MAY CALL ensureAttachedFromParams().
//
// Every tool here is BROWSER-scoped, not tab-scoped. Verified against the
// extension on 2026-08-20 by reading every handler body: handleDownloadFile /
// handleGetDownloads / handleCancelDownload / handleOpenDownload
// use ONLY the chrome.downloads API and contain zero references to chrome.tabs,
// chrome.debugger, tabId or tabTarget.
//
// ⚠️ Two later additions keep that property for DIFFERENT reasons, so do not
// re-derive it from the chrome.downloads argument above: browser_fetch_to_server
// runs its fetch in the SERVICE WORKER (it accepts tabTarget only to route the
// upload to the server that tab is bound to), and browser_list_fetched never
// reaches a browser at all — it reads our own Mongo index. The attach pre-flight they used to run
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

/**
 * Fetch a URL with the browser's own session and store the bytes server-side.
 *
 * ⛔ The three approaches a caller reaches for first all fail — see the comment
 * above FetchToServerTool in tool-schemas.ts for the measurements. The short
 * version: browser_download_file leaves the file on the browser's machine,
 * base64 through a tool response costs ~1 token per byte, and an in-page fetch
 * is blocked by the page's connect-src CSP on exactly the SSO sites this is for.
 *
 * ⚠️ This tool is BROWSER-scoped like the rest of this file — the fetch runs in
 * the service worker, not in a tab — so it must not call
 * ensureAttachedFromParams(). tabTarget is accepted only so the extension can
 * route the upload to the server that tab is bound to.
 */
export const fetchToServer: Tool = {
  schema: {
    name: FetchToServerTool.shape.name.value,
    description: FetchToServerTool.shape.description.value,
    inputSchema: zodToJsonSchema(FetchToServerTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = FetchToServerTool.shape.arguments.parse(params);
      // ⛔ ENCODE THE LABEL HERE, NOT IN THE EXTENSION. The extension puts it
      // straight into an HTTP request header, and headers are ISO-8859-1: an
      // en-dash in a document title makes the BROWSER throw
      // "String contains non ISO-8859-1 code point" before the fetch even
      // starts. Measured 2026-09-13 — `thread-laura-work-1` lost attachments to
      // a label reading "Prescription drug copays – Premium EPO".
      // ⭐ Doing it server-side is deliberate: it fixes browsers already in the
      // field, which cannot be updated without hands on the machine. The server
      // decodes on receipt in http-server.ts. Encoding it in the extension too
      // would double-encode, so the extension leaves `label` alone.
      const outbound = validatedParams.label === undefined
        ? validatedParams
        : { ...validatedParams, label: encodeURIComponent(validatedParams.label) };

      // ⛔ THE WS TIMEOUT IS A RESPONSE DEADLINE, NOT A TRANSFER DEADLINE.
      // The bytes travel browser → /api/v1/fetched, entirely outside this
      // socket. When the response window closes first we used to report
      // `failed` for a file that was already on disk and indexed. MEASURED
      // 2026-09-13 by `thread-laura-work-1`: two 79 MB pptx files, each
      // reported failed, retried, reported failed again — and all four
      // transfers had in fact succeeded. Cost: two good files nearly dropped
      // from their corpus on our own report, and 76 MB of byte-identical
      // duplicates created by the retries.
      // ⇒ A generous window for the common case, and a definitive answer from
      // our own index for the rest. Never guess from a timeout.
      const startedAt = new Date(Date.now() - 1000); // 1s of clock slack
      try {
        const result = await context.sendSocketMessage(
          "browser_fetch_to_server",
          outbound,
          { timeoutMs: 180_000 },
        );
        return jsonResponse(result, true, max_tokens);
      } catch (wsError: any) {
        // ⭐ ASK THE INDEX BEFORE CALLING IT A FAILURE. The upload leg does not
        // depend on this socket, so "no response" and "did not happen" are
        // different claims and only one of them is ours to make.
        // ⚠️ Two passes: the POST may still be in flight when the window
        // closes, so a single miss is not proof either.
        for (const waitMs of [0, 3000]) {
          if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
          try {
            const landed = await mongodb.getFetchedFilesCollection().findOne(
              { sourceUrl: validatedParams.url, createdAt: { $gte: startedAt } },
              { projection: { _id: 0 }, sort: { createdAt: -1 } },
            );
            if (landed) {
              return jsonResponse(
                {
                  ...landed,
                  recoveredAfterTimeout: true,
                  note:
                    `The WebSocket response window closed before the browser answered, but the file DID arrive and is indexed. ` +
                    `This is a success — do not retry, and do not record it as failed. ` +
                    `(A retry here is what creates byte-identical duplicates.)`,
                },
                true,
                max_tokens,
              );
            }
          } catch {
            // Index unreachable — fall through and report the original error
            // rather than inventing an outcome we cannot support.
          }
        }
        throw wsError;
      }
    } catch (error: any) {
      // ⚠️ `: any` and the surrounding tools' bare `catch (error)` differ on
      // purpose. Under useUnknownInCatchVariables a bare catch param is
      // `unknown`, which is two typecheck errors per tool — this file already
      // carries eight of them. Not spreading it further; the existing ones are
      // a separate cleanup.
      const { max_tokens } = params || {};
      return errorResponse(`Failed to fetch to server: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * List files previously retrieved by browser_fetch_to_server.
 *
 * Reads the server's own index rather than asking a browser, so it answers
 * even when no extension is connected.
 */
export const listFetched: Tool = {
  schema: {
    name: ListFetchedTool.shape.name.value,
    description: ListFetchedTool.shape.description.value,
    inputSchema: zodToJsonSchema(ListFetchedTool.shape.arguments),
  },
  // ⛔ Deliberately does NOT go through sendSocketMessage. The index lives in
  // OUR Mongo, written by the /api/v1/fetched route — asking a browser for it
  // would make "what have we retrieved" fail whenever no extension happens to
  // be connected, which is exactly when someone is trying to find a file from
  // yesterday. Every other tool in this file asks a browser; this one asks us.
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      const { limit } = ListFetchedTool.shape.arguments.parse(params);
      const capped = Math.min(limit ?? 50, 500);
      const rows = await mongodb.getFetchedFilesCollection()
        .find({}, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(capped)
        .toArray();
      return jsonResponse({ files: rows, count: rows.length }, true, max_tokens);
    } catch (error: any) {
      // ⚠️ `: any` and the surrounding tools' bare `catch (error)` differ on
      // purpose. Under useUnknownInCatchVariables a bare catch param is
      // `unknown`, which is two typecheck errors per tool — this file already
      // carries eight of them. Not spreading it further; the existing ones are
      // a separate cleanup.
      const { max_tokens } = params || {};
      return errorResponse(`Failed to list fetched files: ${error.message}`, false, error, max_tokens);
    }
  },
};
