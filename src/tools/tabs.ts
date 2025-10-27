import zodToJsonSchema from "zod-to-json-schema";

import {
  CloseTabTool,
  CreateTabTool,
  CreateWindowTool,
  ListTabsTool,
  SwitchTabTool,
} from "@/types/tool-schemas";

import type { Context } from "@/context";
import { textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

/**
 * List all open browser tabs
 * Returns information about all currently open tabs in the browser, including tab IDs,
 * URLs, and titles. Useful for understanding the current browser state and selecting
 * which tab to interact with.
 */
export const listTabs: Tool = {
  schema: {
    name: ListTabsTool.shape.name.value,
    description: ListTabsTool.shape.description.value,
    inputSchema: zodToJsonSchema(ListTabsTool.shape.arguments),
  },
  handle: async (context: Context) => {
    try {
      // Don't call ensureAttached() - browser_list_tabs uses chrome.tabs.query which works without attachment
      const tabs = await context.sendSocketMessage("browser_list_tabs", {});
      return textResponse(`Open tabs:\n${JSON.stringify(tabs, null, 2)}`);
    } catch (error) {
      return errorResponse(`Failed to list tabs: ${error.message}`, false, error);
    }
  },
};

/**
 * Switch to a specific browser tab
 * Changes focus to the tab with the specified tab ID. The tab must already be open.
 * Use listTabs to get available tab IDs. After switching, subsequent operations will
 * target the newly selected tab.
 */
export const switchTab: Tool = {
  schema: {
    name: SwitchTabTool.shape.name.value,
    description: SwitchTabTool.shape.description.value,
    inputSchema: zodToJsonSchema(SwitchTabTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = SwitchTabTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_switch_tab", validatedParams);
      return textResponse(`Switched to tab ${validatedParams.tabId}`);
    } catch (error) {
      return errorResponse(`Failed to switch tab: ${error.message}`, false, error);
    }
  },
};

/**
 * Create a new browser tab
 * Opens a new tab in the browser. Optionally navigates to a specified URL, otherwise
 * opens a blank tab (about:blank). Returns the new tab ID which can be used with
 * switchTab to interact with the newly created tab.
 */
export const createTab: Tool = {
  schema: {
    name: CreateTabTool.shape.name.value,
    description: CreateTabTool.shape.description.value,
    inputSchema: zodToJsonSchema(CreateTabTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = CreateTabTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_create_tab",
        validatedParams
      );
      return textResponse(`Created new tab ${result.tabId}${validatedParams.url ? ` at ${validatedParams.url}` : ""}`);
    } catch (error) {
      return errorResponse(`Failed to create tab: ${error.message}`, false, error);
    }
  },
};

/**
 * Close a specific browser tab
 * Closes the tab with the specified tab ID. Use listTabs to get available tab IDs.
 * Cannot close the last remaining tab in the browser. If the closed tab was the
 * active tab, focus will move to another open tab.
 */
export const closeTab: Tool = {
  schema: {
    name: CloseTabTool.shape.name.value,
    description: CloseTabTool.shape.description.value,
    inputSchema: zodToJsonSchema(CloseTabTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = CloseTabTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_close_tab", validatedParams);
      return textResponse(`Closed tab ${validatedParams.tabId}`);
    } catch (error) {
      return errorResponse(`Failed to close tab: ${error.message}`, false, error);
    }
  },
};

/**
 * Create a new browser window
 * Opens a new browser window with optional configuration. Can open with a single URL,
 * multiple URLs (one per tab), or as a blank window. Supports incognito mode and
 * custom window dimensions. Useful when you need a fresh browser context or want to
 * separate different tasks into different windows.
 */
export const createWindow: Tool = {
  schema: {
    name: CreateWindowTool.shape.name.value,
    description: CreateWindowTool.shape.description.value,
    inputSchema: zodToJsonSchema(CreateWindowTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    try {
      // Don't call ensureAttached() - creating a window doesn't need an existing attachment
      const validatedParams = CreateWindowTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_create_window", validatedParams);

      let message = `Created new window ${result.windowId}`;
      if (result.tabs && result.tabs.length > 0) {
        const tabInfo = result.tabs.map((t: any) => `Tab ${t.tabId}: ${t.url}`).join(", ");
        message += ` with ${result.tabs.length} tab(s) (${tabInfo})`;
      }
      if (result.incognito) {
        message += " [Incognito Mode]";
      }

      return textResponse(message);
    } catch (error) {
      return errorResponse(`Failed to create window: ${error.message}`, false, error);
    }
  },
};
