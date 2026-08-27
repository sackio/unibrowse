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

// ⛔ NO TOOL IN THIS FILE MAY CALL ensureAttachedFromParams().
//
// These are the tab LIFECYCLE tools — create, close, switch, list, create
// window. Every one of their extension handlers resolves its own target from
// its own arguments (handleCreateTab uses only the id of the tab it just
// created; handleSwitchTab / handleCloseTab resolve tabId-or-tabTarget and are
// unreachable without one) and none of them reads the last-used pointer. The
// attach pre-flight they used to run could therefore only ever fail; it could
// never help.
//
// On browser_create_tab it was worse than useless: it required an already-
// attached tab in order to create one. Untargeted, ensure_attached falls back
// to tabManager.lastUsedTabId, and on 2026-08-22 office's desktop Chrome
// (ext_018237f9) had that pointer dangling at a closed tab, 41931315. Every
// browser_create_tab returned "Failed to create tab: No tab with id: 41931315"
// — naming an id the caller never supplied, for a create that never ran — for
// ~29h. That browser is the only one on office that can consume a claude.ai
// magic link, so it blocked every login on the fleet.
//
// This is the third pass of the same removal (737069d: system + extensions;
// 79c4655: bookmarks/cookies/downloads/history; this one: tab lifecycle).
// ⭐ Judge scope by what the extension HANDLER touches, never by the tool name:
// these look tab-scoped, and are the tools that manage tabs rather than tools
// that operate inside one.
//
// Routing survives the removal: sendSocketMessage() reads extensionId and
// tabTarget straight off the payload, and every schema here merges
// ExtensionIdSchema, so multi-extension disambiguation is unchanged.

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
    // Stamped BEFORE the send so a reconciliation can tell a tab this call
    // created from one that was already open on the same URL.
    const sentAt = Date.now();
    try {
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
      const err = error instanceof Error ? error : new Error(String(error));
      const msg = err.message;

      // ⛔ A TIMEOUT IS NOT EVIDENCE THAT THE TAB WAS NOT CREATED.
      //
      // The write completes in the extension before the response gives up, so
      // "Failed to create tab: WebSocket response timeout" was returned for
      // calls that had in fact created AND attached a tab. A caller that
      // retries on it gets a duplicate — which is exactly what happened to
      // `shopping` on 2026-08-27 (tabs 41932981 and 41932990, same URL).
      //
      // So on a timeout specifically, go and look before reporting failure.
      if (/timeout/i.test(msg)) {
        const reconciled = await findTabCreatedSince(context, params, sentAt);

        if (reconciled.kind === "found") {
          const t = reconciled.tab;
          return jsonResponse({
            tabId: t.tabId,
            label: t.label,
            url: t.url ?? null,
            incognito: t.incognito ?? false,
            reconciledAfterTimeout: true,
            message:
              `The response timed out, but the tab WAS created — found tab ${t.tabId} ` +
              `(label: "${t.label}") attached after this call started. Use it; do NOT retry, ` +
              `a retry would open a duplicate.`,
          }, true, max_tokens);
        }

        if (reconciled.kind === "ambiguous") {
          // Refuse to guess, the same way tabTarget-by-label does on a
          // collision: naming the candidates is more useful than picking one.
          return errorResponse(
            `The create timed out and reconciliation is AMBIGUOUS: ${reconciled.tabs.length} tabs ` +
              `attached since this call started that match the requested URL ` +
              `(${reconciled.tabs.map((t: any) => `${t.tabId} "${t.label}"`).join(", ")}). ` +
              `Do not retry — inspect these with browser_list_attached_tabs and close any duplicate.`,
            false, err, max_tokens,
          );
        }

        return errorResponse(
          `Failed to create tab: ${msg}. ⚠️ Reconciliation found no matching tab attached since ` +
            `this call started${reconciled.kind === "unchecked" ? ` (the check itself failed: ${reconciled.why})` : ""}, ` +
            `so the tab probably was not created — but a timeout cannot prove that. Before retrying, ` +
            `confirm with browser_list_attached_tabs; a blind retry on this error is how duplicate tabs happen.`,
          false, err, max_tokens,
        );
      }

      return errorResponse(`Failed to create tab: ${msg}`, false, err, max_tokens);
    }
  },
};

/**
 * After a create timed out, ask the browser whether the tab exists anyway.
 *
 * Matches on "attached at or after the moment we sent the request", so a tab
 * the user already had open on the same URL cannot be mistaken for one this
 * call created.
 */
async function findTabCreatedSince(
  context: Context,
  params: any,
  sentAt: number,
): Promise<
  | { kind: "found"; tab: any }
  | { kind: "ambiguous"; tabs: any[] }
  | { kind: "none" }
  | { kind: "unchecked"; why: string }
> {
  try {
    const res: any = await context.sendSocketMessage(
      "browser_list_attached_tabs",
      {},
      { extensionId: params?.extensionId, timeoutMs: 10000 },
    );
    const tabs: any[] = res?.tabs ?? [];
    const wanted = params?.url ? String(params.url) : null;

    // A small negative allowance: the extension stamps attachedAt from its own
    // clock, which can sit fractionally behind ours.
    const since = sentAt - 2000;
    const candidates = tabs.filter((t) => {
      if (typeof t?.attachedAt !== "number" || t.attachedAt < since) return false;
      if (!wanted) return true;
      return typeof t.url === "string" && (t.url === wanted || t.url.startsWith(wanted));
    });

    if (candidates.length === 1) return { kind: "found", tab: candidates[0] };
    if (candidates.length > 1) return { kind: "ambiguous", tabs: candidates };
    return { kind: "none" };
  } catch (e) {
    // The check failing is its own answer, and must not be reported as "no
    // tab was created" — that is the false-negative this whole path exists
    // to stop being confident about.
    return { kind: "unchecked", why: (e as Error)?.message ?? String(e) };
  }
}

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
      const result = await context.sendSocketMessage(
        "browser_create_window",
        validatedParams,
        { extensionId: params?.extensionId },
      );

      // Return the full result object as JSON so tests can access windowId, tabs, etc.
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to create window: ${error.message}`, false, error, max_tokens);
    }
  },
};
