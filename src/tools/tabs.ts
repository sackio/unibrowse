import zodToJsonSchema from "zod-to-json-schema";

import {
  CloseTabTool,
  CreateTabTool,
  CreateWindowTool,
  HandleDialogTool,
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
      // ⛔ SAY WHETHER THE TAB IS RESERVED, BECAUSE SILENCE READS AS "MINE".
      //
      // A tab is reserved on creation ONLY if the caller passed `agent` —
      // TabManager.claimTab() returns null immediately on an empty agent
      // (extension/background.js:449). Without it the tab is born UNRESERVED
      // and is indistinguishable from an orphan to anything that scans for
      // login pages, so another agent can legitimately claim it mid-flow. This
      // response said "Created and attached" either way, and a caller who
      // created a tab reasonably believes it is theirs.
      //
      // COST, measured 2026-10-08: `claude-login-auto` claimed `alpaca`'s
      // signup tab on app.alpaca.markets at the login step and locked their
      // script out mid-run. Two seats and three DMs went into finding out that
      // the tab had simply never been reserved. Nothing in any response had
      // said so.
      //
      // ⛔ AND PASSING `agent` IS NOT SUFFICIENT EITHER — MEASURED 2026-10-10
      // 09:55:07Z. A create carrying agent:"unibrowse-probe-A" came back with
      // `reservedTo: null`: an interleaving call that carried NO agent had set
      // the extension's shared `_currentAgent` to null, and claimTab(tabId,
      // null) returns immediately without claiming. The response still said
      // "Reserved for …". That is strictly worse than the wrong owner: the
      // creator believes the tab is held, nothing holds it, and the next agent
      // along claims it legitimately — which is the exact shape of the 10-08
      // incident above, whose cause was recorded as UNKNOWN.
      // ⚠️ NOT asserted as that cause: the discriminator is whether alpaca's
      // signup passed `agent` on create, and the server logs from 10-08 are
      // gone. Raised with `agents`, who hold that half.
      //
      // ⚠️ ADDITIVE ONLY — a new field plus an APPENDED warning. The existing
      // sentence is unchanged because callers parse this text, and the default
      // behaviour (no `agent` → no reservation) is deliberately NOT changed
      // here: defaulting the agent would alter who owns every tab every
      // existing caller creates, which is `agents`' predicate to rule on, not
      // a thing to infer at 21:40.
      const reservedBy = validatedParams.agent ?? null;

      // ⛔ "CREATED AND ATTACHED" WAS PRINTED EVEN WHEN NOTHING ATTACHED.
      //
      // The extension skips chrome.debugger entirely for a restricted URL —
      // about:blank, about:*, chrome://, chrome-extension:// — and returns
      // `{success:true}` WITHOUT calling tabManager.attachTab()
      // (extension/background.js, the `if (isRestricted)` early return). So the
      // tab is created, and reserved if an agent was passed, but never enters
      // the attached-tab registry. tabTarget -> owning-extension routing is
      // built from that registry, so EVERY later call fails: with no
      // extensionId it cannot resolve the browser at all and raises "Multiple
      // extensions are connected (N)", which reads like a targeting mistake by
      // the caller rather than a tab that was never attached.
      //
      // MEASURED 2026-10-09, reported by `freelance` and reproduced here:
      // create at about:blank -> "Created and attached tab 41942459",
      // reservedBy unibrowse; then browser_navigate({tabTarget}) ->
      // "Multiple extensions are connected (6)", and the same call WITH
      // extensionId -> "Cannot attach debugger to restricted URL: about:blank".
      // The second error is the real one and only the explicit extensionId
      // surfaced it.
      //
      // ⚠️ DETECTED FROM THE RETURNED URL, NOT FROM A NEW EXTENSION FIELD, ON
      // PURPOSE. The sibling TOCTOU branch in the extension already returns
      // `attached:false`, but the restricted branch does not, and an extension
      // fix reaches NO browser without the ↻ the operator declined — all six
      // connected extensions are on older code. URL-sniffing works on every
      // build, old and new. `attached === false` is honoured too, so a newer
      // extension that reports it is believed in preference.
      //
      // ⚠️ ADDITIVE for the working path: a tab that DID attach still reads
      // "Created and attached …" byte-for-byte, because callers parse this
      // text. Only the path that never attached says so, and on that path no
      // caller can have been working.
      const createdUrl: string = String(result.url ?? validatedParams.url ?? "");
      const urlIsUnattachable =
        createdUrl === "" ||
        createdUrl === "about:blank" ||
        /^(about|chrome|chrome-extension|edge|devtools|view-source):/i.test(createdUrl);
      const attached: boolean =
        result.attached === false ? false : !urlIsUnattachable;

      if (!attached) {
        return jsonResponse({
          tabId: result.tabId,
          label: result.label,
          url: result.url ?? validatedParams.url ?? null,
          incognito: result.incognito ?? validatedParams.incognito ?? false,
          reservedBy,
          attached: false,
          message: `⚠️ Created tab ${result.tabId} (label: "${result.label}") at ${createdUrl || "about:blank"} but did NOT attach it: ` +
            `the debugger cannot attach to a restricted URL, so this tab is absent from the attached-tab registry and ` +
            `tabTarget routing cannot find its browser. A later call without extensionId will fail with ` +
            `"Multiple extensions are connected"; with extensionId it will fail with "Cannot attach debugger to restricted URL". ` +
            `⇒ Create the tab at the real URL you want instead of navigating to it afterwards` +
            (reservedBy
              ? `. It is reserved for "${reservedBy}", but a reservation is not an attachment.`
              : `, and pass agent:"<your-seat>" to reserve it.`) +
            (result.note ? ` (extension: ${result.note})` : ""),
        }, true, max_tokens);
      }

      // ⛔ THE EXTENSION CAN RESERVE THE NEW TAB TO SOMEBODY ELSE — CHECK, AND
      // CORRECT IT, BECAUSE THE EXTENSION-SIDE FIX REACHES NO BROWSER WITHOUT A ↻.
      //
      // handleMCPMessage stashes each request's `agent` on one shared mutable
      // field, handleCreateTab read that field AFTER its load-wait (up to 15s),
      // and nothing ever cleared it. So an unrelated call landing inside that
      // window became the owner of a tab it had never asked for, and the real
      // creator was locked out of its own tab with `tab-reserved`.
      //
      // MEASURED by `agents` 2026-10-10: create by `claude-login-auto`,
      // TAB_ATTACHED tab=41943061 09:39:53.355Z, reserved to `freelance`
      // (claimed 09:39:53.090Z) whose only call was a browser_evaluate 2.7s
      // earlier. Reproduced on server3 at 09:35:38Z. Fixed in
      // extension/background.js by snapshotting the caller at handler entry —
      // ⚠️ which takes effect on a browser only after the ↻ control on
      // chrome://extensions, so EVERY browser connected today still has the bug
      // and this server-side correction is what actually reaches them.
      //
      // ⛔ `reservedBy` NO LONGER ASSERTS THE CLAIM WE ASKED FOR. It reports
      // what the extension said it did. Reporting our own request back as fact
      // is how this stayed invisible: the response said "Reserved for X" while
      // the tab belonged to Y, so the first evidence anyone got was an
      // unrelated tool failing later.
      const claimedTo: string | null =
        typeof result.reservedTo === "string" && result.reservedTo ? result.reservedTo : null;
      let reservationNote = "";
      if (reservedBy && claimedTo !== reservedBy) {
        // One corrective call, and only on a genuine mismatch — a fixed
        // extension returns our own agent here, so this costs nothing there.
        // takeover is legitimate by construction: this call created the tab a
        // moment ago, so no other seat can have a real interest in it.
        try {
          await context.sendSocketMessage("browser_reserve_tab" as any, {
            tabTarget: result.tabId,
            agent: reservedBy,
            takeover: true,
            extensionId: validatedParams.extensionId,
          } as any);
          reservationNote =
            ` ⚠️ The extension had reserved this new tab to ` +
            (claimedTo ? `"${claimedTo}"` : "nobody") +
            ` instead of you; corrected to "${reservedBy}" (known extension bug, fixed only on builds reloaded after 2026-10-10).`;
        } catch (e) {
          // ⛔ Say it failed. A silent failure here hands the caller a tab that
          // belongs to another seat while telling them it is theirs.
          reservationNote =
            ` ⛔ THIS TAB IS RESERVED TO ` +
            (claimedTo ? `"${claimedTo}"` : "nobody") +
            `, NOT to you, and the correction failed (${e instanceof Error ? e.message : String(e)}).` +
            ` Call browser_reserve_tab({tabTarget: ${result.tabId}, agent: "${reservedBy}", takeover: true}) before driving it.`;
        }
      } else if (!reservedBy && claimedTo) {
        reservationNote =
          ` ⚠️ You passed no \`agent\`, but the extension reserved this new tab to "${claimedTo}" — a stale caller from a known extension bug, not a seat that wants it. Your next call may fail \`tab-reserved\`; pass agent:"<your-seat>" on browser_create_tab.`;
      }

      return jsonResponse({
        tabId: result.tabId,
        label: result.label,
        url: result.url ?? validatedParams.url ?? null,
        incognito: result.incognito ?? validatedParams.incognito ?? false,
        reservedBy: reservedBy ?? claimedTo,
        reservedByExtension: claimedTo,
        attached: true,
        message: `Created and attached tab ${result.tabId} (label: "${result.label}")${validatedParams.url ? ` at ${validatedParams.url}` : ""}. Use tabTarget: "${result.label}" or tabTarget: ${result.tabId} to target it.` +
          (reservedBy
            ? ` Reserved for "${reservedBy}" — keep it by making calls that carry the same agent; the claim expires after 30min of inactivity.`
            : ` ⚠️ CREATED UNRESERVED: you passed no \`agent\`, so this tab is not yours and another agent may claim it mid-flow. Pass agent:"<your-seat>" on browser_create_tab to reserve it.`) +
          reservationNote,
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
 * Accept or dismiss a modal JavaScript dialog blocking a tab.
 *
 * ⛔ THIS IS THE ONLY TOOL THAT REACHES A TAB WHOSE RENDERER IS BLOCKED, so
 * it deliberately does NOT pre-flight anything that would itself need the
 * renderer. Page.handleJavaScriptDialog is served by the browser process.
 *
 * ⚠️ The extension half needs a ↻ on each browser before this works there;
 * on an older build the call comes back as an unknown message type.
 */
export const handleDialog: Tool = {
  schema: {
    name: HandleDialogTool.shape.name.value,
    description: HandleDialogTool.shape.description.value,
    inputSchema: zodToJsonSchema(HandleDialogTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = HandleDialogTool.shape.arguments.parse(params);
      const result: any = await context.sendSocketMessage(
        "browser_handle_dialog" as any,
        validatedParams,
      );
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const msg = (error as any)?.message ?? String(error);
      // ⛔ NAME THE UNDEPLOYED CASE. "Unknown message type" from an extension
      // running older code reads exactly like a broken tool, and the remedy is
      // completely different — it is the ↻, not a retry.
      const undeployed = /Unknown message type/i.test(msg);
      return errorResponse(
        `Failed to handle dialog: ${msg}` +
          (undeployed
            ? ` ⚠️ That extension is running code from before browser_handle_dialog existed (2026-10-10), so this tool cannot reach it until that browser's unibrowse card is reloaded with the ↻ on chrome://extensions. Nothing is wrong with the call.`
            : ""),
        false,
        error as any,
        max_tokens,
      );
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
