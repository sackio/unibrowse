import { zodToJsonSchema } from "zod-to-json-schema";
import {
  GetVersionTool,
  GetSystemInfoTool,
  GetBrowserInfoTool,
} from "@/types/tool-schemas";
import { jsonResponse, errorResponse } from "@/utils/response-helpers";
import type { Tool } from "./tool";

/**
 * Get browser version information
 * Retrieves version details including browser name, version number, and user agent.
 * Useful for compatibility checking and debugging.
 */
export const getVersion: Tool = {
  schema: {
    name: GetVersionTool.shape.name.value,
    description: GetVersionTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetVersionTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = GetVersionTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_version", validatedParams);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to get version: ${error.message}`, false, error);
    }
  },
};

/**
 * Get system information
 * Retrieves system information including operating system name, platform,
 * architecture, and other environment details. Useful for understanding
 * the runtime environment.
 */
export const getSystemInfo: Tool = {
  schema: {
    name: GetSystemInfoTool.shape.name.value,
    description: GetSystemInfoTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetSystemInfoTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = GetSystemInfoTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_system_info", validatedParams);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to get system info: ${error.message}`, false, error);
    }
  },
};

/**
 * Get browser capabilities and information
 * Retrieves browser-specific information including supported features,
 * installed extensions count, profile information, and other browser capabilities.
 * Useful for feature detection and environment analysis.
 */
export const getBrowserInfo: Tool = {
  schema: {
    name: GetBrowserInfoTool.shape.name.value,
    description: GetBrowserInfoTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetBrowserInfoTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = GetBrowserInfoTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_browser_info", validatedParams);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to get browser info: ${error.message}`, false, error);
    }
  },
};
