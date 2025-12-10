import { zodToJsonSchema } from "zod-to-json-schema";
import {
  GetBookmarksTool,
  CreateBookmarkTool,
  DeleteBookmarkTool,
  SearchBookmarksTool,
} from "@/types/tool-schemas";
import { jsonResponse, textResponse, errorResponse } from "@/utils/response-helpers";
import type { Tool } from "./tool";

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
      await context.ensureAttached();
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
      await context.ensureAttached();
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
      await context.ensureAttached();
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
      await context.ensureAttached();
      const validatedParams = SearchBookmarksTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_search_bookmarks", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to search bookmarks: ${error.message}`, false, error, max_tokens);
    }
  },
};
