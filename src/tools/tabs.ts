import zodToJsonSchema from "zod-to-json-schema";

import {
  CloseTabTool,
  CreateTabTool,
  CreateWindowTool,
  ListTabsTool,
  SwitchTabTool,
} from "@/types/tool-schemas";

import type { Context } from "@/context";
import { textResponse, jsonResponse, errorResponse } from "@/utils/response-helpers";

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
  handle: async (context: Context, params) => {
    const { max_tokens } = params || {};
    try {
      // Don't call ensureAttached() - browser_list_tabs uses chrome.tabs.query which works without attachment.
      // Pass params through so multi-extension routing picks up extensionId.
      const tabs = await context.sendSocketMessage("browser_list_tabs", params || {});
      // Return clean JSON instead of the "Open tabs:\n[...JSON...]" narrative
      // prefix that used to force callers to regex-extract the payload.
      return jsonResponse({ tabs: Array.isArray(tabs) ? tabs : (tabs?.tabs || []) }, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to list tabs: ${error.message}`, false, error, max_tokens);
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
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = SwitchTabTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_switch_tab", validatedParams);
      // Report what the CALLER actually named. These read `tabId`, but the
      // schema also accepts `tabTarget` (a label or id) and that is what most
      // callers pass — producing "Switched to tab undefined" on a call that
      // fully succeeded. A success message that looks like a failure costs a
      // reader the same investigation a real failure would.
      const switched = (validatedParams as any).tabId ?? (validatedParams as any).tabTarget ?? "(active tab)";
      return textResponse(`Switched to tab ${switched}`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to switch tab: ${error.message}`, false, error, max_tokens);
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
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = CreateTabTool.shape.arguments.parse(params);
      const result: any = await context.sendSocketMessage(
        "browser_create_tab",
        validatedParams
      );
      // Return clean JSON. Keep a human-readable `message` field so logs/UIs
      // can still surface a one-liner without re-formatting the payload.
      return jsonResponse({
        tabId: result.tabId,
        label: result.label,
        url: result.url ?? validatedParams.url ?? null,
        incognito: result.incognito ?? validatedParams.incognito ?? false,
        message: `Created and attached tab ${result.tabId} (label: "${result.label}")${validatedParams.url ? ` at ${validatedParams.url}` : ""}. Use tabTarget: "${result.label}" or tabTarget: ${result.tabId} to target it.`,
      }, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to create tab: ${error.message}`, false, error, max_tokens);
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
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = CloseTabTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_close_tab", validatedParams);
      // Report what the CALLER actually named. These read `tabId`, but the
      // schema also accepts `tabTarget` (a label or id) and that is what most
      // callers pass — producing "Switched to tab undefined" on a call that
      // fully succeeded. A success message that looks like a failure costs a
      // reader the same investigation a real failure would.
      const closed = (validatedParams as any).tabId ?? (validatedParams as any).tabTarget ?? "(active tab)";
      return textResponse(`Closed tab ${closed}`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to close tab: ${error.message}`, false, error, max_tokens);
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
    const { max_tokens } = params || {};
    try {
      // Don't call ensureAttached() - creating a window doesn't need an existing attachment
      const validatedParams = CreateWindowTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_create_window", validatedParams);

      // Return the full result object as JSON so tests can access windowId, tabs, etc.
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to create window: ${error.message}`, false, error, max_tokens);
    }
  },
};
