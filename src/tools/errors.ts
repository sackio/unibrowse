import { zodToJsonSchema } from "zod-to-json-schema";

import { GetErrorsTool, ReloadExtensionTool } from "@/types/tool-schemas";
import { jsonResponse, errorResponse } from "@/utils/response-helpers";

import { Tool } from "./tool";

// ⛔ NEITHER TOOL IN THIS FILE MAY CALL ensureAttachedFromParams().
//
// Both are BROWSER-scoped, and both are what you reach for when the browser is
// already unhealthy — which is precisely when a tab-attach pre-flight cannot be
// satisfied. Gating the diagnostics and the recovery lever on a working tab put
// the fire extinguisher behind the fire.
//
// handleGetErrors() reads this.consoleLogs / this.backgroundErrors and iterates
// attachedTabs; it never attaches to anything. handleReloadExtension() takes NO
// arguments at all and does one thing: chrome.runtime.reload().
//
// Concretely: on 2026-08-22 a dangling tabManager.lastUsedTabId made every
// untargeted ensure_attached throw "No tab with id: 41931315" on office's
// desktop Chrome. In that state browser_get_errors could not report the fault
// and browser_reload_extension could not clear it — the two tools whose entire
// job is that fault. See the banner in tabs.ts for the mechanism.
//
// ⚠️ GetErrorsTool merges TabTargetSchema, but handleGetErrors ignores
// tabTarget and returns errors across all tabs. It is still worth forwarding:
// sendSocketMessage reads it for multi-extension ROUTING. It is a router hint
// here, not a filter — do not document it to callers as one.

export const getErrors: Tool = {
  schema: {
    name: GetErrorsTool.shape.name.value,
    description: GetErrorsTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetErrorsTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = GetErrorsTool.shape.arguments.parse(params || {});
      const result = await context.sendSocketMessage("browser_get_errors", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to get errors: ${error.message}`, false, error, max_tokens);
    }
  },
};

export const reloadExtension: Tool = {
  schema: {
    name: ReloadExtensionTool.shape.name.value,
    description: ReloadExtensionTool.shape.description.value,
    inputSchema: zodToJsonSchema(ReloadExtensionTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      // Route explicitly rather than leaning on sendSocketMessage's fallback
      // of reading the payload. The fallback does work here (this handler
      // forwards RAW params, so nothing is stripped), but relying on it is
      // what made the sibling bugs so hard to see: the moment someone adds a
      // .parse() to this handler, routing would break silently and the tool
      // would start reloading an arbitrary browser.
      const result = await context.sendSocketMessage(
        "browser_reload_extension",
        params || {},
        { extensionId: params?.extensionId },
      );
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to reload extension: ${error.message}`, false, error, max_tokens);
    }
  },
};
