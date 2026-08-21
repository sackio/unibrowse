import { zodToJsonSchema } from "zod-to-json-schema";
import {
  GetVersionTool,
  GetSystemInfoTool,
  GetBrowserInfoTool,
} from "@/types/tool-schemas";
import { jsonResponse, errorResponse } from "@/utils/response-helpers";
import type { Tool } from "./tool";

// ⛔ NONE OF THE THREE TOOLS IN THIS FILE MAY CALL ensureAttachedFromParams().
//
// They are BROWSER-scoped, not tab-scoped: the extension answers all three
// from chrome.runtime.getManifest() / getPlatformInfo() and never touches a
// tab. The attach pre-flight they used to run was pure liability — it opened
// or attached a tab purely to throw it away.
//
// It broke them outright on 2026-08-20. With no tab attached, ensure_attached
// auto-opens one; if that tab settles on a page extensions cannot debug, Chrome
// raises "Cannot access a chrome-extension:// URL of different extension" and
// the whole call fails. Measured by `agents`: browser_get_system_info and
// browser_create_tab failed 5/5 over ten minutes on office, while
// browser_attach_tab + browser_evaluate against an EXPLICIT tabTarget worked
// perfectly — because a real tabTarget gives the pre-flight something valid to
// resolve. The failure looks like a dead browser and is not one.
//
// Consequence worth remembering: claude-login-auto probes candidate browsers
// with browser_get_system_info and requires os=linux. The probe returned an
// error, the candidate was skipped, and the script reported "no
// NON-CONTAINERISED browser is connected" — which was FALSE and pointed the
// reader at the wrong remedy entirely.
//
// Routing is unaffected by the removal: sendSocketMessage() reads extensionId
// straight off the payload, so multi-extension disambiguation still works and
// still raises the normal "Multiple extensions are connected" error when the
// caller omits it.

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
    const { max_tokens } = params || {};
    try {
      const validatedParams = GetVersionTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_version", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get version: ${error.message}`, false, error, max_tokens);
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
    const { max_tokens } = params || {};
    try {
      const validatedParams = GetSystemInfoTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_system_info", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get system info: ${error.message}`, false, error, max_tokens);
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
    const { max_tokens } = params || {};
    try {
      const validatedParams = GetBrowserInfoTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_browser_info", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get browser info: ${error.message}`, false, error, max_tokens);
    }
  },
};
