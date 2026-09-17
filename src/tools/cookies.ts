import { zodToJsonSchema } from "zod-to-json-schema";

import {
  GetCookiesTool,
  SetCookieTool,
  DeleteCookieTool,
  ClearCookiesTool,
} from "@/types/tool-schemas";
import { jsonResponse, textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

// ⛔ NO TOOL IN THIS FILE MAY CALL ensureAttachedFromParams().
//
// All four are BROWSER-scoped, not tab-scoped. Verified against the extension
// on 2026-08-20 by reading every handler body: handleGetCookies / handleSetCookie / handleDeleteCookie / handleClearCookies
// use ONLY the chrome.cookies API and contain zero references to chrome.tabs,
// chrome.debugger, tabId or tabTarget. The attach pre-flight they used to run
// was pure liability -- it opened or attached a tab purely to discard it, and
// the server side never even looked at its return value.
//
// This is the same defect fixed in system.ts/extensions.ts by 737069d, whose
// symptom was: with no tab attached, ensure_attached auto-opens one, and if
// that tab settles on a page extensions cannot debug, Chrome raises "Cannot
// access a chrome-extension:// URL of different extension" and the whole call
// fails. It looks exactly like a dead browser and is not one. Calls that passed
// an explicit tabTarget kept working, which is what made it look intermittent.
//
// ⛔ THE REASON IT SURVIVED IN THESE FOUR: they LOOK tab-scoped. Cookies and
// history feel like properties of a page. They are not -- they are profile-wide
// stores, and the extension reads them without a tab. ⇒ Judge scope by what the
// HANDLER touches, never by what the tool name suggests.
//
// ⛔⛔ CORRECTION 2026-09-17 -- THE PARAGRAPH ABOVE IS TRUE OF THE CODE AND FALSE
// OF CHROME, AND THAT GAP COST A MONTH. "Profile-wide stores" is wrong: Chrome
// keeps a SEPARATE cookie store per incognito session, and `chrome.cookies`
// exposes them via `storeId` / `getAllCookieStores()`. The handlers took
// `tabTarget` (it is in all four schemas below) and none of them read it, so
// every call silently acted on the DEFAULT store.
//   · Reported by `agents`, measured 3x: browser_get_cookies with tabTarget set
//     to an incognito tab signed in as agents2@sack.io returned BEN'S
//     default-profile sessionKey. The sign-in was fine; only the read was wrong.
//   · browser_clear_cookies had it too, where it is destructive: "clear this
//     tab's cookies" cleared Ben's real session.
// ⇒ THE METHOD ERROR, worth more than the fix: that audit read every handler,
// correctly established the parameter was UNUSED, and then treated unused as
// CORRECT. Proving what the code does says nothing about what it should do.
//
// ⭐ The fix is entirely extension-side (`resolveCookieStoreId`) and does NOT
// reintroduce an attach pre-flight: it calls tabManager.resolveTab(), which
// READS the already-attached tab map and attaches nothing. The prohibition
// above stands -- do not "fix" this by adding ensureAttachedFromParams back.
//
// Routing is unaffected: sendSocketMessage() reads extensionId straight off the
// payload, so multi-extension disambiguation still works and still raises the
// normal "Multiple extensions are connected" error when the caller omits it.

/**
 * Get cookies for a specific URL or all cookies
 * Retrieves browser cookies with optional filtering by URL, name, or domain.
 * Returns cookie details including name, value, domain, path, expiration, and security flags.
 */
export const getCookies: Tool = {
  schema: {
    name: GetCookiesTool.shape.name.value,
    description: GetCookiesTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetCookiesTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = GetCookiesTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_cookies", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get cookies: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Set a cookie for a specific URL
 * Creates or updates a cookie with specified name, value, and optional attributes
 * including domain, path, expiration, and security flags. Useful for testing authentication
 * or managing session state.
 */
export const setCookie: Tool = {
  schema: {
    name: SetCookieTool.shape.name.value,
    description: SetCookieTool.shape.description.value,
    inputSchema: zodToJsonSchema(SetCookieTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = SetCookieTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_set_cookie", validatedParams);
      return textResponse(`Cookie "${validatedParams.name}" set for ${validatedParams.url}`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to set cookie: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Delete a specific cookie
 * Removes a cookie by name and URL. The cookie is immediately deleted and will not
 * be available in subsequent requests. Useful for testing logout scenarios or
 * clearing specific session data.
 */
export const deleteCookie: Tool = {
  schema: {
    name: DeleteCookieTool.shape.name.value,
    description: DeleteCookieTool.shape.description.value,
    inputSchema: zodToJsonSchema(DeleteCookieTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = DeleteCookieTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_delete_cookie", validatedParams);
      return textResponse(`Cookie "${validatedParams.name}" deleted from ${validatedParams.url}`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to delete cookie: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Clear all cookies
 * Removes all browser cookies, optionally filtered by URL or domain. Use with caution
 * as this will log users out of all websites. Can be scoped to specific URLs or domains
 * to avoid clearing everything.
 */
export const clearCookies: Tool = {
  schema: {
    name: ClearCookiesTool.shape.name.value,
    description: ClearCookiesTool.shape.description.value,
    inputSchema: zodToJsonSchema(ClearCookiesTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = ClearCookiesTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_clear_cookies", validatedParams);
      return textResponse(`Cleared ${result.count} cookie(s)`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to clear cookies: ${error.message}`, false, error, max_tokens);
    }
  },
};
