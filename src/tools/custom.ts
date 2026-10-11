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
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      // Forward extensionId + tabTarget through options so multi-extension
      // routing works. Without them wsFor() sees no target at all and throws
      // "Multiple extensions are connected … EITHER pass extensionId on this
      // call" — instructing the caller to do the exact thing they already did.
      // The pre-flight ensureAttachedFromParams above consumed the routing and
      // then this call threw it away, so a correct invocation read as a
      // rejected extensionId. Cost `agents` the one diagnostic they needed
      // while debugging a sign-in hang on 2026-08-11.
      // ⚠️ macros.ts had this exact fix, with a comment naming this exact
      // symptom, since before today — applied to one call site and never
      // propagated. Check the siblings when you fix a routing bug here.
      const consoleLogs = await context.sendSocketMessage(
        "browser_get_console_logs",
        // `source` must be forwarded in the PAYLOAD — the options arg carries
        // routing only. Sending `{}` here (as this did) silently drops any
        // filter the caller asked for, which on this tool means they get the
        // 200k-character unfiltered dump they were explicitly trying to avoid.
        { source: params?.source } as any,
        { extensionId: params?.extensionId, tabTarget: params?.tabTarget },
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
      await context.ensureAttachedFromParams(params);
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
      await context.ensureAttachedFromParams(params);
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

      // ⛔ The bare "/tmp" default returned a path NOBODY COULD OPEN whenever the
      // server runs in the container, which is the deployment in use: there is no
      // /tmp bind mount, so the file existed only inside a container nobody looks
      // in, and nothing errored. MEASURED 2026-10-11 in both directions. The env
      // var keeps /tmp correct for a plain stdio deployment while docker-compose
      // points it at the bind-mounted /app/fetched.
      const outputDir =
        validatedParams.outputDir || process.env.UNIBROWSE_SCREENSHOT_DIR || "/tmp";
      const prefix = validatedParams.prefix || "segment";
      const BIND_CONTAINER = process.env.UNIBROWSE_FETCHED_CONTAINER || "/app/fetched";
      const BIND_HOST =
        process.env.UNIBROWSE_FETCHED_HOST || "/mnt/nas/data/files/unibrowse-fetched";
      const hostVisible =
        outputDir === BIND_CONTAINER || outputDir.startsWith(BIND_CONTAINER + "/");
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
          // ⚠️ A path that looks ordinary is the whole trap: nothing about
          // `/tmp/….png` signals which filesystem it lives on. `storybook`
          // (2026-08-02) handed back absolute paths for inspection and the
          // directory did not exist on their machine — success reported, files
          // unreachable.
          // ⛔ BUT THE BLANKET WARNING WAS ITSELF WRONG for the one directory
          // that works. /app/fetched IS bind-mounted, so telling callers "not on
          // your host, do not share these" sent them copying files out of a
          // container for paths they could already open. Measured 2026-10-11 by
          // reading a capture back on the host. ⇒ Answer per path, never in
          // general.
          ...(hostVisible
            ? {
                pathsAre: "host-visible",
                hostPaths: filePaths.map((f) =>
                  f.path.replace(BIND_CONTAINER, BIND_HOST),
                ),
                note:
                  `${outputDir} is bind-mounted, so these files ARE on the host at ` +
                  `${BIND_HOST}/… and are readable from every host over NFS. Safe to hand to ` +
                  `another session. ⭐ Read the PNG from disk — do NOT fetch it as base64 through ` +
                  `a tool response, which costs ~0.955 tokens per byte (a 52KB PNG is ~49,600 tokens). ` +
                  `⚠️ The container writes as root, so you cannot rm these as your own user: ` +
                  `clean up with \`docker exec unibrowse-mcp-server rm -rf <dir>\`.`,
              }
            : {
                pathsAre: "container-local",
                note:
                  `Files were written INSIDE the mcp-server container at ${outputDir} — they are NOT on ` +
                  `your host filesystem. Do not hand these paths to another session or a human expecting ` +
                  `to open them. ⇒ Pass outputDir under ${BIND_CONTAINER} instead, which is bind-mounted ` +
                  `to ${BIND_HOST} and readable fleet-wide.`,
              }),
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
      await context.ensureAttachedFromParams(params);
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
      await context.ensureAttachedFromParams(params);
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
