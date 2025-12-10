import { zodToJsonSchema } from "zod-to-json-schema";

import {
  GetCookiesTool,
  SetCookieTool,
  DeleteCookieTool,
  ClearCookiesTool,
} from "@/types/tool-schemas";
import { jsonResponse, textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

/**
 * Get cookies for a specific URL or all cookies
 * Retrieves browser cookies with optional filtering by URL, name, or domain.
 * Returns cookie details including name, value, domain, path, expiration, and security flags.
 */
export const getCookies: Tool = {
  schema: {
    name: GetCookiesTool.shape.name.value,
    description: GetCookiesTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetCookiesTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetCookiesTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_cookies", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get cookies: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Set a cookie for a specific URL
 * Creates or updates a cookie with specified name, value, and optional attributes
 * including domain, path, expiration, and security flags. Useful for testing authentication
 * or managing session state.
 */
export const setCookie: Tool = {
  schema: {
    name: SetCookieTool.shape.name.value,
    description: SetCookieTool.shape.description.value,
    inputSchema: zodToJsonSchema(SetCookieTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = SetCookieTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_set_cookie", validatedParams);
      return textResponse(`Cookie "${validatedParams.name}" set for ${validatedParams.url}`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to set cookie: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Delete a specific cookie
 * Removes a cookie by name and URL. The cookie is immediately deleted and will not
 * be available in subsequent requests. Useful for testing logout scenarios or
 * clearing specific session data.
 */
export const deleteCookie: Tool = {
  schema: {
    name: DeleteCookieTool.shape.name.value,
    description: DeleteCookieTool.shape.description.value,
    inputSchema: zodToJsonSchema(DeleteCookieTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = DeleteCookieTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_delete_cookie", validatedParams);
      return textResponse(`Cookie "${validatedParams.name}" deleted from ${validatedParams.url}`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to delete cookie: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Clear all cookies
 * Removes all browser cookies, optionally filtered by URL or domain. Use with caution
 * as this will log users out of all websites. Can be scoped to specific URLs or domains
 * to avoid clearing everything.
 */
export const clearCookies: Tool = {
  schema: {
    name: ClearCookiesTool.shape.name.value,
    description: ClearCookiesTool.shape.description.value,
    inputSchema: zodToJsonSchema(ClearCookiesTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = ClearCookiesTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_clear_cookies", validatedParams);
      return textResponse(`Cleared ${result.count} cookie(s, max_tokens)`);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to clear cookies: ${error.message}`, false, error, max_tokens);
    }
  },
};
