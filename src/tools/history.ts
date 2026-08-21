import { zodToJsonSchema } from "zod-to-json-schema";

import {
  SearchHistoryTool,
  GetHistoryVisitsTool,
  DeleteHistoryTool,
  ClearHistoryTool,
} from "@/types/tool-schemas";
import { jsonResponse, textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

// ⛔ NO TOOL IN THIS FILE MAY CALL ensureAttachedFromParams().
//
// All four are BROWSER-scoped, not tab-scoped. Verified against the extension
// on 2026-08-20 by reading every handler body: handleSearchHistory / handleGetHistoryVisits / handleDeleteHistory / handleClearHistory
// use ONLY the chrome.history API and contain zero references to chrome.tabs,
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
 * Search browsing history
 * Searches browser history for items matching the provided text. Supports filtering
 * by time range and limiting results. Returns history items with URL, title, visit count,
 * and last visit time. Useful for finding previously visited pages.
 */
export const searchHistory: Tool = {
  schema: {
    name: SearchHistoryTool.shape.name.value,
    description: SearchHistoryTool.shape.description.value,
    inputSchema: zodToJsonSchema(SearchHistoryTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = SearchHistoryTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_search_history", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to search history: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Get visit details for a URL
 * Retrieves detailed visit information for a specific URL, including all visit times
 * and transitions. Returns an array of visit items with timestamps and transition types.
 * Useful for analyzing browsing patterns for a specific page.
 */
export const getHistoryVisits: Tool = {
  schema: {
    name: GetHistoryVisitsTool.shape.name.value,
    description: GetHistoryVisitsTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetHistoryVisitsTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = GetHistoryVisitsTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_history_visits", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get history visits: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Delete specific URLs from history
 * Removes specified URLs from browser history. All visits to the provided URLs will
 * be deleted. Use with caution as this action cannot be undone. Returns the count
 * of deleted items.
 */
export const deleteHistory: Tool = {
  schema: {
    name: DeleteHistoryTool.shape.name.value,
    description: DeleteHistoryTool.shape.description.value,
    inputSchema: zodToJsonSchema(DeleteHistoryTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = DeleteHistoryTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_delete_history", validatedParams);
      return textResponse(`Deleted ${validatedParams.urls.length} URL(s) from history`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to delete history: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Clear browsing history for a time range
 * Removes all browsing history within the specified time range. Use with extreme caution
 * as this action cannot be undone. The time range is specified in milliseconds since epoch.
 * Returns success confirmation.
 */
export const clearHistory: Tool = {
  schema: {
    name: ClearHistoryTool.shape.name.value,
    description: ClearHistoryTool.shape.description.value,
    inputSchema: zodToJsonSchema(ClearHistoryTool.shape.arguments),
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
      const { max_tokens } = params || {};
      return errorResponse(`Failed to clear history: ${error.message}`, false, error, max_tokens);
    }
  },
};
