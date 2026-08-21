import { zodToJsonSchema } from "zod-to-json-schema";
import {
  ListExtensionsTool,
  GetExtensionInfoTool,
  EnableExtensionTool,
  DisableExtensionTool,
} from "@/types/tool-schemas";
import { jsonResponse, textResponse, errorResponse } from "@/utils/response-helpers";
import type { Tool } from "./tool";

// ⛔ NO TOOL IN THIS FILE MAY CALL ensureAttachedFromParams().
//
// All four are answered by chrome.management.* on the extension side and never
// touch a tab (verified: zero chrome.tabs / debugger / requireCDP references in
// handleListExtensions, handleGetExtensionInfo, handleEnableExtension,
// handleDisableExtension). The attach pre-flight opened or attached a tab
// purely to discard it.
//
// Removed 2026-08-20 for the same reason as src/tools/system.ts: with no tab
// attached, ensure_attached auto-opens one, and if it settles on a page
// extensions cannot debug the call dies with Chrome's raw "Cannot access a
// chrome-extension:// URL of different extension". `agents` measured
// browser_get_extension_info failing that way on office while
// browser_attach_tab + browser_evaluate against an explicit tabTarget worked.

/**
 * List all installed extensions
 * Retrieves a list of all browser extensions including their IDs, names,
 * versions, enabled status, and types. Useful for auditing installed extensions
 * and managing browser configuration.
 */
export const listExtensions: Tool = {
  schema: {
    name: ListExtensionsTool.shape.name.value,
    description: ListExtensionsTool.shape.description.value,
    inputSchema: zodToJsonSchema(ListExtensionsTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = ListExtensionsTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_list_extensions", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to list extensions: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Get extension information
 * Retrieves detailed information about a specific extension including name,
 * version, description, permissions, host permissions, and enabled status.
 * Useful for inspecting extension details and troubleshooting.
 */
export const getExtensionInfo: Tool = {
  schema: {
    name: GetExtensionInfoTool.shape.name.value,
    description: GetExtensionInfoTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetExtensionInfoTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = GetExtensionInfoTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_extension_info", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get extension info: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Enable an extension
 * Enables a previously disabled extension by its ID. The extension becomes
 * active and its functionality is restored. Returns success status.
 */
export const enableExtension: Tool = {
  schema: {
    name: EnableExtensionTool.shape.name.value,
    description: EnableExtensionTool.shape.description.value,
    inputSchema: zodToJsonSchema(EnableExtensionTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = EnableExtensionTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_enable_extension", validatedParams);
      return textResponse(`Extension enabled successfully (ID: ${validatedParams.id})`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to enable extension: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Disable an extension
 * Disables an active extension by its ID. The extension becomes inactive
 * and its functionality is suspended until re-enabled. Returns success status.
 */
export const disableExtension: Tool = {
  schema: {
    name: DisableExtensionTool.shape.name.value,
    description: DisableExtensionTool.shape.description.value,
    inputSchema: zodToJsonSchema(DisableExtensionTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = DisableExtensionTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_disable_extension", validatedParams);
      return textResponse(`Extension disabled successfully (ID: ${validatedParams.id})`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to disable extension: ${error.message}`, false, error, max_tokens);
    }
  },
};
