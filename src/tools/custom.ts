import * as fs from "fs";
import * as path from "path";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  EvaluateTool,
  GetConsoleLogsTool,
  GetNetworkLogsTool,
  ScreenshotTool,
  SegmentedScreenshotTool,
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
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const consoleLogs = await context.sendSocketMessage(
        "browser_get_console_logs",
        {},
      );
      const text: string = consoleLogs
        .map((log) => JSON.stringify(log))
        .join("\n");
      return textResponse(text, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get console logs: ${error.message}`, false, error, max_tokens);
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
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = ScreenshotTool.shape.arguments.parse(params);
      const screenshot = await context.sendSocketMessage(
        "browser_screenshot",
        validatedParams,
      );
      return imageResponse(screenshot, "image/png", max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to capture screenshot: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Capture segmented screenshots of page elements
 * Takes screenshots of specific page elements identified by CSS selectors.
 * Each element is captured as a separate PNG file saved to disk.
 * Returns array of file paths to minimize context usage.
 */
export const segmentedScreenshot: Tool = {
  schema: {
    name: SegmentedScreenshotTool.shape.name.value,
    description: SegmentedScreenshotTool.shape.description.value,
    inputSchema: zodToJsonSchema(SegmentedScreenshotTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = SegmentedScreenshotTool.shape.arguments.parse(params);

      const result = await context.sendSocketMessage(
        "browser_segmented_screenshot",
        validatedParams,
      );

      const { screenshots, failedSelectors } = result;

      // Generate timestamp for filename
      const timestamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\..+/, "")
        .replace("T", "_");

      const outputDir = validatedParams.outputDir || "/tmp";
      const prefix = validatedParams.prefix || "segment";
      const includeLabels = validatedParams.includeLabels || false;

      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Convert base64 to PNG files and collect file paths
      const filePaths: Array<{
        path: string;
        selector: string;
        label: string;
        index: number;
      }> = [];

      for (let i = 0; i < screenshots.length; i++) {
        const { selector, base64Data, label } = screenshots[i];
        const sequenceNum = String(i + 1).padStart(3, "0");
        const labelPart = includeLabels && label ? `_${label}` : "";
        const filename = `${timestamp}_${prefix}_${sequenceNum}${labelPart}.png`;
        const filepath = path.join(outputDir, filename);

        const buffer = Buffer.from(base64Data, "base64");
        fs.writeFileSync(filepath, buffer);

        filePaths.push({
          path: filepath,
          selector: selector,
          label: label,
          index: i + 1,
        });
      }

      return jsonResponse(
        {
          success: true,
          count: filePaths.length,
          files: filePaths,
          failedSelectors: failedSelectors,
          outputDir: outputDir,
          timestamp: timestamp,
        },
        max_tokens,
      );
    } catch (error) {
      return errorResponse(
        `Failed to capture segmented screenshots: ${error.message}`,
        false,
        error,
        max_tokens,
      );
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
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = EvaluateTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_evaluate",
        validatedParams,
      );
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to evaluate JavaScript: ${error.message}`, false, error, max_tokens);
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
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetNetworkLogsTool.shape.arguments.parse(params);
      const networkLogs = await context.sendSocketMessage(
        "browser_get_network_logs",
        validatedParams,
      );
      return jsonResponse(networkLogs, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get network logs: ${error.message}`, false, error, max_tokens);
    }
  },
};
