import { zodToJsonSchema } from "zod-to-json-schema";

import {
  GoBackTool,
  GoForwardTool,
  NavigateTool,
  PressKeyTool,
  ScrollTool,
  ScrollToElementTool,
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
      await context.ensureAttached();
      const validatedParams = NavigateTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_navigate", validatedParams);
      if (snapshot) {
        return captureAriaSnapshot(context, "", validatedParams.tabTarget);
      }
      return textResponse(`Navigated to ${validatedParams.url}`);
    } catch (error) {
      return errorResponse(`Failed to navigate: ${error.message}`, false, error);
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
      await context.ensureAttached();
      const validatedParams = GoBackTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_go_back", validatedParams);
      if (snapshot) {
        return captureAriaSnapshot(context, "", validatedParams.tabTarget);
      }
      return textResponse("Navigated back");
    } catch (error) {
      return errorResponse(`Failed to go back: ${error.message}`, false, error);
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
      await context.ensureAttached();
      const validatedParams = GoForwardTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_go_forward", validatedParams);
      if (snapshot) {
        return captureAriaSnapshot(context, "", validatedParams.tabTarget);
      }
      return textResponse("Navigated forward");
    } catch (error) {
      return errorResponse(`Failed to go forward: ${error.message}`, false, error);
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
      await context.ensureAttached();
      const { time } = WaitTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_wait", { time });
      return textResponse(`Waited for ${time} seconds`);
    } catch (error) {
      return errorResponse(`Failed to wait: ${error.message}`, false, error);
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
      await context.ensureAttached();
      const validatedParams = PressKeyTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_press_key", validatedParams);
      return textResponse(`Pressed key ${validatedParams.key}`);
    } catch (error) {
      return errorResponse(`Failed to press key: ${error.message}`, false, error);
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
      await context.ensureAttached();
      const validatedParams = ScrollTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_scroll", validatedParams);
      const x = validatedParams.x ?? 0;
      const y = validatedParams.y;
      return textResponse(`Scrolled by (${x}, ${y}) pixels`);
    } catch (error) {
      return errorResponse(`Failed to scroll: ${error.message}`, false, error);
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
      await context.ensureAttached();
      const validatedParams = ScrollToElementTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_scroll_to_element", validatedParams);
      return textResponse(`Scrolled to "${validatedParams.element}"`);
    } catch (error) {
      return errorResponse(`Failed to scroll to element: ${error.message}`, false, error);
    }
  },
};
