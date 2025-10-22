import zodToJsonSchema from "zod-to-json-schema";

import {
  ListAttachedTabsTool,
  SetTabLabelTool,
  DetachTabTool,
  GetActiveTabTool,
} from "@/types/tool-schemas";

import type { Context } from "@/context";
import { textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

/**
 * List all attached tabs with their labels
 * Returns information about all tabs that currently have debugger attached,
 * including their tab IDs, labels, URLs, titles, and last-used timestamps.
 * Useful for understanding which tabs are available for multi-tab operations.
 */
export const listAttachedTabs: Tool = {
  schema: {
    name: ListAttachedTabsTool.shape.name.value,
    description: ListAttachedTabsTool.shape.description.value,
    inputSchema: zodToJsonSchema(ListAttachedTabsTool.shape.arguments),
  },
  handle: async (context: Context) => {
    try {
      await context.ensureAttached();
      const result = await context.sendSocketMessage(
        "browser_list_attached_tabs",
        {}
      );

      if (!result.tabs || result.tabs.length === 0) {
        return textResponse("No tabs currently attached");
      }

      const tabList = result.tabs
        .map(
          (tab: any) =>
            `- Tab ${tab.tabId} (${tab.label}): ${tab.title}\n  URL: ${tab.url}\n  Last used: ${new Date(tab.lastUsedAt).toLocaleString()}`
        )
        .join("\n");

      return textResponse(
        `Attached tabs (${result.tabs.length}):\n${tabList}`
      );
    } catch (error) {
      return errorResponse(
        `Failed to list attached tabs: ${error.message}`,
        false,
        error
      );
    }
  },
};

/**
 * Set or update a tab's label
 * Updates the human-readable label for an attached tab. Labels are used to
 * identify tabs in multi-tab operations instead of numeric tab IDs.
 */
export const setTabLabel: Tool = {
  schema: {
    name: SetTabLabelTool.shape.name.value,
    description: SetTabLabelTool.shape.description.value,
    inputSchema: zodToJsonSchema(SetTabLabelTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = SetTabLabelTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_set_tab_label",
        validatedParams
      );

      return textResponse(
        `Updated tab ${validatedParams.tabId} label to "${validatedParams.label}"`
      );
    } catch (error) {
      return errorResponse(
        `Failed to set tab label: ${error.message}`,
        false,
        error
      );
    }
  },
};

/**
 * Detach debugger from a specific tab
 * Removes the debugger attachment from the specified tab. After detachment,
 * the tab will no longer appear in listAttachedTabs and cannot be targeted
 * by other tools unless re-attached.
 */
export const detachTab: Tool = {
  schema: {
    name: DetachTabTool.shape.name.value,
    description: DetachTabTool.shape.description.value,
    inputSchema: zodToJsonSchema(DetachTabTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = DetachTabTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_detach_tab",
        validatedParams
      );

      return textResponse(
        `Detached from tab ${validatedParams.tabId}${result.detachedLabel ? ` (${result.detachedLabel})` : ""}`
      );
    } catch (error) {
      return errorResponse(
        `Failed to detach tab: ${error.message}`,
        false,
        error
      );
    }
  },
};

/**
 * Get the currently active (last-used) tab
 * Returns information about the tab that was most recently used for operations.
 * This is the tab that will be targeted by default when no tabTarget is specified.
 */
export const getActiveTab: Tool = {
  schema: {
    name: GetActiveTabTool.shape.name.value,
    description: GetActiveTabTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetActiveTabTool.shape.arguments),
  },
  handle: async (context: Context) => {
    try {
      await context.ensureAttached();
      const result = await context.sendSocketMessage(
        "browser_get_active_tab",
        {}
      );

      if (!result.hasActiveTab) {
        return textResponse("No tabs currently attached");
      }

      return textResponse(
        `Active tab: ${result.tabId} (${result.label})\n` +
          `Title: ${result.title}\n` +
          `URL: ${result.url}\n` +
          `Last used: ${new Date(result.lastUsedAt).toLocaleString()}`
      );
    } catch (error) {
      return errorResponse(
        `Failed to get active tab: ${error.message}`,
        false,
        error
      );
    }
  },
};
