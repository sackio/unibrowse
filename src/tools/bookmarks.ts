import { zodToJsonSchema } from "zod-to-json-schema";
import {
  GetBookmarksTool,
  CreateBookmarkTool,
  DeleteBookmarkTool,
  SearchBookmarksTool,
} from "@/types/tool-schemas";
import { jsonResponse, textResponse, errorResponse } from "@/utils/response-helpers";
import type { Tool } from "./tool";

// ⛔ NO TOOL IN THIS FILE MAY CALL ensureAttachedFromParams().
//
// All four are BROWSER-scoped, not tab-scoped. Verified against the extension
// on 2026-08-20 by reading every handler body: handleGetBookmarks / handleCreateBookmark / handleDeleteBookmark / handleSearchBookmarks
// use ONLY the chrome.bookmarks API and contain zero references to chrome.tabs,
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
 * Get bookmarks from the browser
 * Retrieves bookmarks from a specific folder or the entire bookmark tree.
 * Returns bookmark nodes including titles, URLs, folders, and hierarchy.
 * Useful for analyzing bookmark structure and finding specific bookmarks.
 */
export const getBookmarks: Tool = {
  schema: {
    name: GetBookmarksTool.shape.name.value,
    description: GetBookmarksTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetBookmarksTool.shape.arguments),
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
  },
};

/**
 * Create a new bookmark
 * Creates a new bookmark with the specified title and URL in the given folder.
 * If no parent folder is specified, the bookmark is created in the default location.
 * Returns the created bookmark node with its assigned ID.
 */
export const createBookmark: Tool = {
  schema: {
    name: CreateBookmarkTool.shape.name.value,
    description: CreateBookmarkTool.shape.description.value,
    inputSchema: zodToJsonSchema(CreateBookmarkTool.shape.arguments),
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
  },
};

/**
 * Delete a bookmark
 * Removes a bookmark or folder by its ID. When deleting a folder, all contained
 * bookmarks and subfolders are also removed. Use with caution.
 */
export const deleteBookmark: Tool = {
  schema: {
    name: DeleteBookmarkTool.shape.name.value,
    description: DeleteBookmarkTool.shape.description.value,
    inputSchema: zodToJsonSchema(DeleteBookmarkTool.shape.arguments),
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
  },
};

/**
 * Search bookmarks
 * Searches bookmarks by query string across titles and URLs.
 * Returns matching bookmarks with their full details including folders and URLs.
 * Supports limiting the number of results returned.
 */
export const searchBookmarks: Tool = {
  schema: {
    name: SearchBookmarksTool.shape.name.value,
    description: SearchBookmarksTool.shape.description.value,
    inputSchema: zodToJsonSchema(SearchBookmarksTool.shape.arguments),
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
  },
};
