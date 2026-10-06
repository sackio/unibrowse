import zodToJsonSchema from "zod-to-json-schema";

import {
  ListAttachedTabsTool,
  SetTabLabelTool,
  DetachTabTool,
  GetActiveTabTool,
  AttachTabTool,
  ReserveTabTool,
  ReleaseTabTool,
} from "@/types/tool-schemas";

import type { Context } from "@/context";
import { textResponse, errorResponse, jsonResponse, estimateTokens, DEFAULT_MAX_TOKENS } from "@/utils/response-helpers";

import type { Tool } from "./tool";
import { redactUrl } from "@/utils/redact-url";


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
  handle: async (context: Context, params) => {
    const { max_tokens, fullUrls } = (params || {}) as any;
    // ⛔ LIVE STATE IS THE DEFAULT, AND THAT IS THE WHOLE POINT. `url`/`title`
    // are the ATTACH-TIME record; when they go stale they fail TOWARD "nothing
    // to fix", and a field that fails toward healthy costs more than one that
    // fails toward broken, because only the second one gets checked. `ha`'s
    // argument, 2026-09-19, after losing an hour to a tab that reported
    // consumerportal/#/devices while it was actually on
    // auth.ecobee.com/u/login/identifier. The caveat was ALREADY in this tool's
    // description and two seats were bitten anyway ⇒ the doc is not the lever,
    // the default is. Cost: one chrome.tabs.get per attached tab, no CDP.
    // Opt OUT with live:false when you only want the roster.
    const live = (params as any)?.live !== false;
    try {
      // Aggregate across every registered extension. With multiple extensions
      // (ben's main Chrome + container chromiums launched via
      // browser_launch_isolated_chrome) callers see the union of attached tabs,
      // each tagged with the owning extensionId. Partial failures are surfaced
      // rather than dropped so a broken connection is visible.
      const results = await context.broadcastSocketMessage(
        "browser_list_attached_tabs",
        { live } as any,
      );

      const tabs: any[] = [];
      const errors: Array<{ extensionId: string; error: string }> = [];
      for (const r of results) {
        if (r.error) {
          errors.push({ extensionId: r.extensionId, error: r.error });
          continue;
        }
        for (const t of (r.result?.tabs ?? [])) {
          // Redact on the way IN, so there is no downstream path — summary,
          // json body, or a future field — that can leak the raw value by
          // forgetting to call redactUrl. Opting out is explicit and per-call.
          tabs.push({
            ...t,
            url: fullUrls ? t.url : redactUrl(t.url),
            urlRedacted: fullUrls ? undefined : (typeof t.url === "string" && redactUrl(t.url) !== t.url) || undefined,
            extensionId: r.extensionId,
          });
        }
      }

      if (tabs.length === 0) {
        const message = errors.length
          ? `No tabs attached. Extension errors: ${errors.map(e => `${e.extensionId}: ${e.error}`).join("; ")}`
          : "No tabs currently attached";
        return jsonResponse({ tabs: [], // Identity, not bare ids. A caller cannot tell which machine an opaque
      // UUID refers to, and on 2026-08-11 that cost an hour of debugging a
      // container chromium in the belief it was ben's desktop Chrome.
      extensions: results.map(r => context.describeExtension(r.extensionId) ?? { extensionId: r.extensionId, label: "unidentified browser", kind: "unknown" }), errors, message }, true, max_tokens);
      }

      // ⛔ DO NOT HAND A LONG LIST STRAIGHT TO jsonResponse. It truncates the
      // SERIALISED STRING, so an over-budget result is JSON cut off mid-object
      // — unparseable, with rows silently missing and nothing saying so.
      // MEASURED 2026-09-13: at max_tokens 1200 this call dropped the exact
      // reserved tab I was using to decide whether to restart a shared server.
      // Same defect, same day, as browser_list_fetched (see tools/downloads.ts);
      // this is the second instance, so treat it as a pattern in every list
      // tool rather than two coincidences.
      const tabLine = (tab: any) => {
          const res = tab.reservation
            ? ` [reserved: ${tab.reservation.owner} since ${new Date(tab.reservation.claimedAt).toISOString()}]`
            : "";
          const ext = ` [ext: ${tab.extensionId}]`;
          // ⛔ url/title are the ATTACH-TIME record and never update on
          // navigation. When live:true was requested, show where the tab
          // actually is and say plainly that it moved — a caller matching on
          // title or URL is otherwise reading a page the tab has left.
          // ⛔ An extension whose build predates live tab state simply ignores
          // `live` and returns no such fields. Absent flags would otherwise
          // read as "nothing changed" — the same false all-clear this option
          // exists to remove. Say the data is UNAVAILABLE, not that it agrees.
          const liveUnavailable =
            live && tab.liveUrl === undefined && tab.liveError === undefined;
          const moved = tab.urlChanged === true || tab.titleChanged === true;
          const liveNote = liveUnavailable
            ? `\n  ⚠️ LIVE STATE UNAVAILABLE: this extension is running a build that predates the ` +
              `live:true option, so url/title above are attach-time only and may be stale. ` +
              `Reload the extension, or verify with browser_evaluate("location.href").`
            : tab.liveError
            ? `\n  ⚠️ LIVE STATE UNREADABLE: ${tab.liveError}`
            : moved
              ? `\n  ⚠️ THIS TAB HAS NAVIGATED since it was attached — the url/title above are the ATTACH-TIME record.` +
                `\n  Now at: ${tab.liveUrl}\n  Now titled: ${tab.liveTitle}`
              : tab.liveUrl
                ? `\n  (live url/title confirmed unchanged since attach)`
                : "";
          return `- Tab ${tab.tabId} (${tab.label}): ${tab.title}${ext}${res}\n  URL: ${tab.url}\n  Last used: ${new Date(tab.lastUsedAt).toLocaleString()}${liveNote}`;
        };

      // Identity, not bare ids. A caller cannot tell which machine an opaque
      // UUID refers to, and on 2026-08-11 that cost an hour of debugging a
      // container chromium in the belief it was ben's desktop Chrome.
      // ⛔ ALWAYS returned in full, never dropped for size: it is small, and it
      // is the half that says WHICH browser a tab is on.
      const extensionList = results.map(r => context.describeExtension(r.extensionId) ?? { extensionId: r.extensionId, label: "unidentified browser", kind: "unknown" });

      const envelope = (shown: any[], cut: boolean) => ({
        tabs: shown,
        count: shown.length,
        total: tabs.length,
        ...(cut ? { truncatedForSize: true } : {}),
        extensions: extensionList,
        errors,
        message:
          `Attached tabs (${cut ? `${shown.length} of ${tabs.length} shown` : tabs.length} across ${results.length} extension${results.length === 1 ? "" : "s"}):\n` +
          shown.map(tabLine).join("\n") +
          (cut
            ? `\n\n⚠️ ${tabs.length - shown.length} MORE TAB(S) NOT SHOWN — they did not fit the response token budget. ` +
              `This is NOT the full list: ${tabs.length} tabs are attached. Raise max_tokens to see them. ` +
              `⛔ Do not conclude a tab is unattached, or unreserved, from its absence here.`
            : ""),
      });

      const budget = max_tokens ?? DEFAULT_MAX_TOKENS;
      if (estimateTokens(JSON.stringify(envelope(tabs, false), null, 2)) <= budget) {
        return jsonResponse(envelope(tabs, false), true, max_tokens);
      }
      // Binary search the largest row count that fits — per-tab size varies
      // widely with URL length, reservation history and live-state notes.
      let lo = 0, hi = tabs.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (estimateTokens(JSON.stringify(envelope(tabs.slice(0, mid), true), null, 2)) <= budget) lo = mid;
        else hi = mid - 1;
      }
      return jsonResponse(envelope(tabs.slice(0, lo), true), true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(
        `Failed to list attached tabs: ${error.message}`,
        false,
        error,
        max_tokens
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
    const { max_tokens } = params || {};
    try {
      // Multi-tab management doesn't need ensureAttached - just need WebSocket connection
      const validatedParams = SetTabLabelTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_set_tab_label",
        validatedParams
      );

      return textResponse(
        `Updated tab ${validatedParams.tabTarget} label to "${validatedParams.label}"`
      , max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(
        `Failed to set tab label: ${error.message}`, false, error
      , max_tokens);
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
    const { max_tokens } = params || {};
    try {
      // ⛔ No ensureAttachedFromParams() here. Running an ATTACH pre-flight in
      // front of a DETACH is backwards on its face, and it is not harmless:
      // untargeted, ensure_attached falls back to tabManager.lastUsedTabId, so
      // a dangling pointer makes detach fail with "No tab with id: <someone
      // else's dead tab>" while the tab you named is alive and attached.
      // (Same failure that wedged browser_create_tab on 2026-08-22 — see the
      // banner in tabs.ts.) handleDetachTab resolves tabId/tabTarget itself and
      // errors clearly when given neither.
      const validatedParams = DetachTabTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_detach_tab",
        validatedParams
      );

      return textResponse(
        `Detached from tab ${validatedParams.tabId}${result.detachedLabel ? ` (${result.detachedLabel})` : ""}`,
        max_tokens
      );
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(
        `Failed to detach tab: ${error.message}`, false, error
      , max_tokens);
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
  handle: async (context: Context, params) => {
    const { max_tokens } = params || {};
    try {
      // Don't call ensureAttached() - we want to gracefully return no active tab.
      // Pass params through so multi-ext routing picks up extensionId/tabTarget.
      const result = await context.sendSocketMessage(
        "browser_get_active_tab",
        params || {}
      );

      if (!result.hasActiveTab) {
        return textResponse("No tabs currently attached", max_tokens);
      }

      return textResponse(
        `Active tab: ${result.tabId} (${result.label})\n` +
          `Title: ${result.title}\n` +
          `URL: ${result.url}\n` +
          `Last used: ${new Date(result.lastUsedAt).toLocaleString()}`,
        max_tokens
      );
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(
        `Failed to get active tab: ${error.message}`,
        false,
        error,
        max_tokens
      );
    }
  },
};

/**
 * Attach debugger to a browser tab
 * Can attach to an existing tab by ID or open a new tab with a URL.
 * Optionally assign a label to the tab after attaching.
 */
export const attachTab: Tool = {
  schema: {
    name: AttachTabTool.shape.name.value,
    description: AttachTabTool.shape.description.value,
    inputSchema: zodToJsonSchema(AttachTabTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = AttachTabTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_ensure_attached",
        validatedParams
      );

      return textResponse(
        `Attached to tab ${result.tabId} (label: "${result.label}")\n` +
          `URL: ${result.url}\n` +
          `Use tabTarget: "${result.label}" or tabTarget: ${result.tabId} to target this tab.`,
        max_tokens
      );
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(
        `Failed to attach to tab: ${error.message}`, false, error
      , max_tokens);
    }
  },
};

/**
 * Reserve an attached tab to an agent, so other agents can't drive it.
 * Pair with browser_release_tab to free it later.
 */
export const reserveTab: Tool = {
  schema: {
    name: ReserveTabTool.shape.name.value,
    description: ReserveTabTool.shape.description.value,
    inputSchema: zodToJsonSchema(ReserveTabTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = ReserveTabTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_reserve_tab", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      return errorResponse(
        `Failed to reserve tab: ${(error as any).message}`, false, error, max_tokens
      );
    }
  },
};

/**
 * Release a tab's reservation so any agent can claim it again.
 */
export const releaseTab: Tool = {
  schema: {
    name: ReleaseTabTool.shape.name.value,
    description: ReleaseTabTool.shape.description.value,
    inputSchema: zodToJsonSchema(ReleaseTabTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = ReleaseTabTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_release_tab", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      return errorResponse(
        `Failed to release tab: ${(error as any).message}`, false, error, max_tokens
      );
    }
  },
};
