import { zodToJsonSchema } from "zod-to-json-schema";

import {
  EvaluateTool,
  GetConsoleLogsTool,
  GetNetworkLogsTool,
  ScreenshotTool,
} from "@/types/tool-schemas";
import { textResponse, imageResponse, jsonResponse, errorResponse } from "@/utils/response-helpers";

import { Tool } from "./tool";

/**
 * Get console logs from the browser
 * Retrieves all console messages (log, warn, error, info, debug) that have been recorded
 * since the page loaded. Useful for debugging and understanding page behavior.
 */
export const getConsoleLogs: Tool = {
  schema: {
    name: GetConsoleLogsTool.shape.name.value,
    description: GetConsoleLogsTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetConsoleLogsTool.shape.arguments),
  },
  handle: async (context, _params) => {
    try {
      await context.ensureAttached();
      const consoleLogs = await context.sendSocketMessage(
        "browser_get_console_logs",
        {},
      );
      const text: string = consoleLogs
        .map((log) => JSON.stringify(log))
        .join("\n");
      return textResponse(text);
    } catch (error) {
      return errorResponse(`Failed to get console logs: ${error.message}`, false, error);
    }
  },
};

/**
 * Take a screenshot of the current page
 * Captures a PNG screenshot of the currently visible viewport. Returns the image
 * as base64-encoded data that can be saved or displayed.
 */
export const screenshot: Tool = {
  schema: {
    name: ScreenshotTool.shape.name.value,
    description: ScreenshotTool.shape.description.value,
    inputSchema: zodToJsonSchema(ScreenshotTool.shape.arguments),
  },
  handle: async (context, _params) => {
    try {
      await context.ensureAttached();
      const screenshot = await context.sendSocketMessage(
        "browser_screenshot",
        {},
      );
      return imageResponse(screenshot, "image/png");
    } catch (error) {
      return errorResponse(`Failed to capture screenshot: ${error.message}`, false, error);
    }
  },
};

/**
 * Evaluate JavaScript code in the page context
 * Executes arbitrary JavaScript in the page's context and returns the result.
 * Useful for extracting data, manipulating the DOM, or inspecting page state.
 */
export const evaluate: Tool = {
  schema: {
    name: EvaluateTool.shape.name.value,
    description: EvaluateTool.shape.description.value,
    inputSchema: zodToJsonSchema(EvaluateTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = EvaluateTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_evaluate",
        validatedParams,
      );
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to evaluate JavaScript: ${error.message}`, false, error);
    }
  },
};

/**
 * Get network request logs from the browser
 * Retrieves all HTTP/HTTPS network requests that have occurred since page load,
 * including request/response headers, status codes, and timing information.
 */
export const getNetworkLogs: Tool = {
  schema: {
    name: GetNetworkLogsTool.shape.name.value,
    description: GetNetworkLogsTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetNetworkLogsTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = GetNetworkLogsTool.shape.arguments.parse(params);
      const networkLogs = await context.sendSocketMessage(
        "browser_get_network_logs",
        validatedParams,
      );
      return jsonResponse(networkLogs);
    } catch (error) {
      return errorResponse(`Failed to get network logs: ${error.message}`, false, error);
    }
  },
};
