import { zodToJsonSchema } from "zod-to-json-schema";

import {
  GoBackTool,
  GoForwardTool,
  NavigateTool,
  PressKeyTool,
  ScrollTool,
  ScrollToElementTool,
  SetDeviceMetricsTool,
  SetFileInputTool,
  WaitTool,
} from "@/types/tool-schemas";

import { captureAriaSnapshot } from "@/utils/aria-snapshot";
import { textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool, ToolFactory } from "./tool";

/**
 * Navigate to a URL
 * Directs the browser to load the specified URL. Optionally captures an accessibility snapshot
 * after navigation completes.
 */
export const navigate: ToolFactory = (snapshot) => ({
  schema: {
    name: NavigateTool.shape.name.value,
    description: NavigateTool.shape.description.value,
    inputSchema: zodToJsonSchema(NavigateTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = NavigateTool.shape.arguments.parse(params);
      const result: any = await context.sendSocketMessage("browser_navigate", validatedParams);
      // Auto-record host exemption — see Context.stopAutoRecordingIfExempt.
      // Here rather than in ensureAttached because this is a point where the
      // URL is already known: ensureAttached would need an extra round trip on
      // every single attached call to learn it.
      await context.stopAutoRecordingIfExempt(
        validatedParams.url,
        result?.tabId ?? validatedParams.tabTarget ?? null,
        (validatedParams as any).extensionId,
      );
      if (snapshot) {
        const tabT = validatedParams.tabTarget ?? result?.label ?? result?.tabId;
        return captureAriaSnapshot(context, "", tabT, max_tokens);
      }
      if (result?.autoCreated) {
        return textResponse(
          `Auto-created new tab ${result.tabId} (label: "${result.label}") at ${validatedParams.url}\n` +
          `Use tabTarget: "${result.label}" or tabTarget: ${result.tabId} to target this tab in subsequent calls.`,
          max_tokens,
        );
      }
      return textResponse(`Navigated to ${validatedParams.url}`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to navigate: ${error.message}`, false, error, max_tokens);
    }
  },
});

/**
 * Navigate back in browser history
 * Goes to the previous page in the browser's history stack, equivalent to clicking
 * the browser's back button.
 */
export const goBack: ToolFactory = (snapshot) => ({
  schema: {
    name: GoBackTool.shape.name.value,
    description: GoBackTool.shape.description.value,
    inputSchema: zodToJsonSchema(GoBackTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = GoBackTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_go_back", validatedParams);
      if (snapshot) {
        return captureAriaSnapshot(context, "", validatedParams.tabTarget, max_tokens);
      }
      return textResponse("Navigated back", max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to go back: ${error.message}`, false, error, max_tokens);
    }
  },
});

/**
 * Navigate forward in browser history
 * Goes to the next page in the browser's history stack, equivalent to clicking
 * the browser's forward button.
 */
export const goForward: ToolFactory = (snapshot) => ({
  schema: {
    name: GoForwardTool.shape.name.value,
    description: GoForwardTool.shape.description.value,
    inputSchema: zodToJsonSchema(GoForwardTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = GoForwardTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_go_forward", validatedParams);
      if (snapshot) {
        return captureAriaSnapshot(context, "", validatedParams.tabTarget, max_tokens);
      }
      return textResponse("Navigated forward", max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to go forward: ${error.message}`, false, error, max_tokens);
    }
  },
});

/**
 * Wait for a specified duration
 * Pauses execution for the specified number of seconds. Useful for waiting for
 * page loads, animations, or dynamic content to appear.
 */
export const wait: Tool = {
  schema: {
    name: WaitTool.shape.name.value,
    description: WaitTool.shape.description.value,
    inputSchema: zodToJsonSchema(WaitTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      const { time, seconds } = WaitTool.shape.arguments.parse(params);
      // Neither key given ⇒ the documented 1s default. `time` wins if both are.
      const secs = time ?? seconds ?? 1;
      // Pure server-side sleep — no extension round-trip needed. This both
      // avoids gratuitously waking a browser thread and unblocks callers in
      // multi-extension mode (browser_wait is temporal, not tab-specific, so
      // it shouldn't fail wsFor's disambiguation check).
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, secs) * 1000));
      return textResponse(`Waited for ${secs} seconds`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to wait: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Press a keyboard key
 * Simulates pressing a keyboard key (e.g., Enter, Escape, ArrowUp). Supports special keys,
 * function keys, and character keys.
 */
export const pressKey: Tool = {
  schema: {
    name: PressKeyTool.shape.name.value,
    description: PressKeyTool.shape.description.value,
    inputSchema: zodToJsonSchema(PressKeyTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = PressKeyTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_press_key", validatedParams);
      return textResponse(`Pressed key ${validatedParams.key}`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to press key: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Scroll the page by a specific amount
 * Scrolls the page by the specified number of pixels in the x and y directions.
 * Positive values scroll right/down, negative values scroll left/up.
 */
export const scroll: Tool = {
  schema: {
    name: ScrollTool.shape.name.value,
    description: ScrollTool.shape.description.value,
    inputSchema: zodToJsonSchema(ScrollTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = ScrollTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_scroll", validatedParams);
      const x = validatedParams.x ?? 0;
      const y = validatedParams.y;
      return textResponse(`Scrolled by (${x}, ${y}) pixels`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to scroll: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Scroll to bring an element into view
 * Scrolls the page to make the specified element visible in the viewport. Useful for
 * interacting with off-screen elements.
 */
export const scrollToElement: Tool = {
  schema: {
    name: ScrollToElementTool.shape.name.value,
    description: ScrollToElementTool.shape.description.value,
    inputSchema: zodToJsonSchema(ScrollToElementTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = ScrollToElementTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_scroll_to_element", validatedParams);
      return textResponse(`Scrolled to "${validatedParams.element}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to scroll to element: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Override the attached tab's viewport size + mobile flag via CDP
 * Emulation.setDeviceMetricsOverride. Standard DevTools-style emulation —
 * the renderer paints at the requested dimensions regardless of the actual
 * window size, so it works even on Xvfb-headful sidecar chromiums whose
 * window has a real minimum width. Pass `reset: true` to clear the override.
 */
export const setDeviceMetrics: Tool = {
  schema: {
    name: SetDeviceMetricsTool.shape.name.value,
    description: SetDeviceMetricsTool.shape.description.value,
    inputSchema: zodToJsonSchema(SetDeviceMetricsTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = SetDeviceMetricsTool.shape.arguments.parse(params);
      if (!validatedParams.reset && (validatedParams.width === undefined || validatedParams.height === undefined)) {
        return errorResponse(
          "width and height are required unless reset:true",
          false, undefined, max_tokens,
        );
      }
      await context.sendSocketMessage("browser_set_device_metrics", validatedParams);
      if (validatedParams.reset) {
        return textResponse("Device metrics override cleared", max_tokens);
      }
      const dpr = validatedParams.deviceScaleFactor ?? 1;
      const mob = validatedParams.mobile ? " (mobile)" : "";
      return textResponse(
        `Device metrics overridden: ${validatedParams.width}×${validatedParams.height} @ ${dpr}x${mob}`,
        max_tokens,
      );
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to set device metrics: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Attach local file(s) to an <input type=file> via CDP DOM.setFileInputFiles —
 * the only programmatic way to populate a file input (JS can't set input.files).
 * Paths must exist on the browser host (the chromium-host sidecar container for
 * isolated chromes; stage into the bind-mounted /app/.chrome-profiles/...).
 */
export const setFileInput: Tool = {
  schema: {
    name: SetFileInputTool.shape.name.value,
    description: SetFileInputTool.shape.description.value,
    inputSchema: zodToJsonSchema(SetFileInputTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      const { max_tokens } = params || {};
      await context.ensureAttachedFromParams(params);
      const validatedParams = SetFileInputTool.shape.arguments.parse(params);
      const result: any = await context.sendSocketMessage(
        "browser_set_file_input",
        validatedParams,
      );
      const count = result?.count ?? validatedParams.paths.length;
      const note = result?.note ? ` — NOTE: ${result.note}` : "";
      return textResponse(
        `Set ${count} file(s) on ${validatedParams.selector}: ${validatedParams.paths.join(", ")}${note}`,
        max_tokens,
      );
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to set file input: ${error.message}`, false, error, max_tokens);
    }
  },
};
