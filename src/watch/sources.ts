/**
 * Watch — the source catalogue.
 *
 * Every source declares its execution home and, crucially, the exact shape
 * the predicate will be handed. `browser_watch_sources` returns this verbatim,
 * so a caller never has to guess whether their predicate can see the DOM.
 *
 * Four tiers. CDP events, chrome API events and unibrowse's own automation
 * events all run in the service worker. The `dom.` and `page.` sources run
 * INSIDE the document, because a MutationObserver has no meaning in a worker.
 *
 * ⛔ Two sources are deliberately ABSENT rather than disabled:
 *   - cdp.Fetch.requestPaused — interception BLOCKS the request until the
 *     handler responds, so a slow predicate hangs the page it observes.
 *   - chrome.idle.onStateChanged — the only source needing a manifest
 *     permission change, which forces a pool-wide re-install, not a reload.
 */

import type { SourceDescriptor } from "./types.ts";

/** CDP event objects, per attached tab. chrome.debugger is already attached. */
const CDP_SOURCES: SourceDescriptor[] = [
  {
    id: "cdp.Network.eventSourceMessageReceived",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { data: string; eventName: string; eventId: string; requestId: string; timestamp: number }) => boolean",
    cost: "high",
    scope: "tab",
    description:
      "Server-Sent Events frame. The best source for a chat app: one event per streamed message, with none of the re-render noise a DOM observer sees.",
  },
  {
    id: "cdp.Network.webSocketFrameReceived",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { requestId: string; timestamp: number; response: { payloadData: string; opcode: number } }) => boolean",
    cost: "high",
    scope: "tab",
    description: "Inbound WebSocket frame — the other half of live apps.",
  },
  {
    id: "cdp.Network.webSocketFrameSent",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { requestId: string; timestamp: number; response: { payloadData: string; opcode: number } }) => boolean",
    cost: "high",
    scope: "tab",
    description: "Outbound WebSocket frame.",
  },
  {
    id: "cdp.Network.requestWillBeSent",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { requestId: string; request: { url: string; method: string; headers: object }; timestamp: number }) => boolean",
    cost: "high",
    scope: "tab",
    description:
      "Outgoing request. Already feeds the networkLogs ring buffer that browser_get_network_logs polls. High volume — use a predicate.",
  },
  {
    id: "cdp.Network.responseReceived",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { requestId: string; response: { url: string; status: number; mimeType: string; headers: object } }) => boolean",
    cost: "high",
    scope: "tab",
    description: "Response headers received. Fires before the body is available.",
  },
  {
    id: "cdp.Network.loadingFinished",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { requestId: string; timestamp: number; encodedDataLength: number }) => boolean",
    cost: "high",
    scope: "tab",
    description: "A request completed and its body is now retrievable.",
  },
  {
    id: "cdp.Network.loadingFailed",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { requestId: string; errorText: string; canceled?: boolean; blockedReason?: string }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "A request failed, was cancelled, or was blocked.",
  },
  {
    id: "cdp.Runtime.consoleAPICalled",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { type: string; args: Array<{ type: string; value?: unknown }>; timestamp: number }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "console.log / warn / error from the page.",
  },
  {
    id: "cdp.Runtime.exceptionThrown",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { timestamp: number; exceptionDetails: { text: string; url?: string; lineNumber: number } }) => boolean",
    cost: "low",
    scope: "tab",
    description: "An uncaught exception in the page.",
  },
  {
    id: "cdp.Log.entryAdded",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { entry: { source: string; level: string; text: string; url?: string } }) => boolean",
    cost: "medium",
    scope: "tab",
    description:
      "Browser-level log: CORS failures, CSP violations, mixed content. Things the page's own console never sees.",
  },
  {
    id: "cdp.Page.javascriptDialogOpening",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { url: string; message: string; type: string; hasBrowserHandler: boolean }) => boolean",
    cost: "low",
    scope: "tab",
    description: "An alert/confirm/prompt is blocking the tab.",
  },
  {
    id: "cdp.Page.fileChooserOpened",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { frameId: string; mode: string }) => boolean",
    cost: "low",
    scope: "tab",
    description: "The page opened a file picker.",
  },
  {
    id: "cdp.Page.downloadWillBegin",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { frameId: string; guid: string; url: string; suggestedFilename: string }) => boolean",
    cost: "low",
    scope: "tab",
    description: "A download is starting from this tab.",
  },
  {
    id: "cdp.Page.frameNavigated",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { frame: { id: string; url: string; securityOrigin: string } }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "A frame committed a navigation, including sub-frames.",
  },
  {
    id: "cdp.Page.loadEventFired",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { timestamp: number }) => boolean",
    cost: "low",
    scope: "tab",
    description: "The page's load event fired.",
  },
  {
    id: "cdp.Page.domContentEventFired",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { timestamp: number }) => boolean",
    cost: "low",
    scope: "tab",
    description: "DOMContentLoaded fired.",
  },
  {
    id: "cdp.Target.targetCrashed",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { targetId: string; status: string; errorCode: number }) => boolean",
    cost: "low",
    scope: "tab",
    description:
      "The tab died. Currently invisible to an agent until its next call fails.",
  },
  {
    id: "cdp.DOM.attributeModified",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { nodeId: number; name: string; value: string }) => boolean",
    cost: "high",
    scope: "tab",
    description:
      "DOM attribute changed, without needing a content script. Chatty; prefer a network source where the state round-trips to a server.",
  },
  {
    id: "cdp.DOM.childNodeInserted",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { parentNodeId: number; previousNodeId: number; node: { nodeName: string; nodeValue?: string } }) => boolean",
    cost: "high",
    scope: "tab",
    description: "A node was inserted. Very chatty on modern frameworks.",
  },
  {
    id: "cdp.Media.playerEventsAdded",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { playerId: string; events: Array<{ timestamp: number; value: string }> }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "Media player state changes.",
  },
  {
    id: "cdp.Security.securityStateChanged",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { securityState: string; summary?: string }) => boolean",
    cost: "low",
    scope: "tab",
    description: "TLS/security state of the page changed.",
  },
  {
    id: "cdp.Storage.indexedDBContentUpdated",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { origin: string; databaseName: string; objectStoreName: string }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "IndexedDB content changed for an origin.",
  },
];

/** chrome.* extension events, browser-wide. */
const CHROME_SOURCES: SourceDescriptor[] = [
  {
    id: "chrome.webNavigation.onCommitted",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; url: string; frameId: number; transitionType: string; timeStamp: number }) => boolean",
    cost: "medium",
    scope: "tab",
    description:
      "A navigation committed. Top frame is frameId === 0. This is the source browser_observe_navigations_* already uses.",
  },
  {
    id: "chrome.webNavigation.onCompleted",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; url: string; frameId: number; timeStamp: number }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "A document finished loading.",
  },
  {
    id: "chrome.webNavigation.onHistoryStateUpdated",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { tabId: number; url: string; frameId: number; transitionType: string }) => boolean",
    cost: "medium",
    scope: "tab",
    description:
      "history.pushState — SPA route changes, which onCommitted never fires for. If a single-page app seems to 'not navigate', this is why.",
  },
  {
    id: "chrome.webNavigation.onBeforeNavigate",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { tabId: number; url: string; frameId: number; timeStamp: number }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "A navigation is about to start.",
  },
  {
    id: "chrome.webNavigation.onDOMContentLoaded",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { tabId: number; url: string; frameId: number; timeStamp: number }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "DOMContentLoaded, per frame.",
  },
  {
    id: "chrome.webNavigation.onErrorOccurred",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { tabId: number; url: string; error: string; frameId: number }) => boolean",
    cost: "low",
    scope: "tab",
    description: "A navigation failed.",
  },
  {
    id: "chrome.webNavigation.onCreatedNavigationTarget",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { sourceTabId: number; tabId: number; url: string }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A new tab/window was opened by a navigation (target=_blank).",
  },
  {
    id: "chrome.tabs.onUpdated",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; changeInfo: { status?: string; title?: string; url?: string; favIconUrl?: string; audible?: boolean; mutedInfo?: object; discarded?: boolean }; tab: object }) => boolean",
    cost: "high",
    scope: "tab",
    description:
      "Tab changed. Title, favicon, audible, muted and discarded transitions all arrive inside changeInfo.",
  },
  {
    id: "chrome.tabs.onCreated",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tab: { id: number; url?: string; title?: string; windowId: number } }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A tab was created.",
  },
  {
    id: "chrome.tabs.onRemoved",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; removeInfo: { windowId: number; isWindowClosing: boolean } }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A tab was closed.",
  },
  {
    id: "chrome.tabs.onActivated",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; windowId: number }) => boolean",
    cost: "medium",
    scope: "browser",
    description: "The foreground tab changed.",
  },
  {
    id: "chrome.windows.onCreated",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { window: { id: number; type: string; focused: boolean } }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A browser window opened.",
  },
  {
    id: "chrome.windows.onRemoved",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { windowId: number }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A browser window closed.",
  },
  {
    id: "chrome.windows.onFocusChanged",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { windowId: number }) => boolean",
    cost: "medium",
    scope: "browser",
    description: "Window focus moved. windowId is -1 when the browser lost focus.",
  },
  {
    id: "chrome.downloads.onCreated",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { id: number; url: string; filename: string; mime: string; totalBytes: number }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A download started.",
  },
  {
    id: "chrome.downloads.onChanged",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { id: number; state?: { previous: string; current: string }; paused?: object; error?: object }) => boolean",
    cost: "medium",
    scope: "browser",
    description:
      "Download progress. state.current === 'complete' is the usual predicate.",
  },
  {
    id: "chrome.cookies.onChanged",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { removed: boolean; cookie: { name: string; domain: string; value: string; expirationDate?: number }; cause: string }) => boolean",
    cost: "high",
    scope: "browser",
    description:
      "A cookie changed. Useful for detecting session expiry, login and logout without touching the page.",
  },
  {
    id: "chrome.history.onVisited",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { id: string; url: string; title?: string; lastVisitTime?: number }) => boolean",
    cost: "medium",
    scope: "browser",
    description:
      "A URL was visited. The durable fallback that already rescues cross-origin redirects a tab has bounced away from.",
  },
  {
    id: "chrome.management.onDisabled",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { id: string; name: string; enabled: boolean }) => boolean",
    cost: "low",
    scope: "browser",
    description: "An extension was disabled under you.",
  },
  {
    id: "chrome.management.onEnabled",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { id: string; name: string; enabled: boolean }) => boolean",
    cost: "low",
    scope: "browser",
    description: "An extension was enabled.",
  },
  {
    id: "chrome.management.onUninstalled",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { id: string }) => boolean",
    cost: "low",
    scope: "browser",
    description: "An extension was uninstalled.",
  },
  {
    id: "chrome.storage.onChanged",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { changes: Record<string, { oldValue?: unknown; newValue?: unknown }>; areaName: string }) => boolean",
    cost: "medium",
    scope: "browser",
    description: "Extension storage changed.",
  },
  {
    id: "chrome.bookmarks.onCreated",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { id: string; bookmark: { title: string; url?: string; parentId?: string } }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A bookmark was created.",
  },
  {
    id: "chrome.notifications.onClicked",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { notificationId: string }) => boolean",
    cost: "low",
    scope: "browser",
    description: "The user clicked a notification.",
  },
  {
    id: "chrome.declarativeNetRequest.onRuleMatchedDebug",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { request: { url: string; method: string; tabId: number }; rule: { rulesetId: string; ruleId: number } }) => boolean",
    cost: "high",
    scope: "browser",
    description: "A declarativeNetRequest rule matched. Observational only.",
  },
];

/**
 * Tier 4 — unibrowse's own automation events.
 *
 * These are about the automation plane, not the page. All FREE: the code
 * already knows when they happen and simply never tells anyone. For a
 * multi-agent fleet this tier is arguably worth more than the page tier —
 * it is the only way one agent learns that another has taken its tab.
 */
const UNIBROWSE_SOURCES: SourceDescriptor[] = [
  {
    id: "unibrowse.tab.attached",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; extensionId: string; url?: string; label?: string }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A tab was attached to unibrowse.",
  },
  {
    id: "unibrowse.tab.detached",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; extensionId: string; reason?: string }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A tab was detached.",
  },
  {
    id: "unibrowse.tab.reserved",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; owner: string; claimedAt: number }) => boolean",
    cost: "low",
    scope: "browser",
    description: "An agent reserved a tab.",
  },
  {
    id: "unibrowse.tab.released",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; owner: string }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A tab reservation was released.",
  },
  {
    id: "unibrowse.tab.takeover",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; previousOwner: string; newOwner: string; at: number }) => boolean",
    cost: "low",
    scope: "browser",
    description:
      "Another agent took over a tab you had reserved. Today you find this out by having a call fail.",
  },
  {
    id: "unibrowse.tab.lastUsedRepointed",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { previousTabId: number | null; tabId: number | null; reason: string }) => boolean",
    cost: "low",
    scope: "browser",
    description:
      "The lastUsedTabId pointer moved. Relevant to anything reading isActive.",
  },
  {
    id: "unibrowse.macro.finished",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { name: string; ok: boolean; durationMs: number; error?: string }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A macro or routine finished, successfully or not.",
  },
  {
    id: "unibrowse.recording.stopped",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { recordingId: string; tabId: number; eventCount: number }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A session recording stopped.",
  },
];


/**
 * Tier 3 — the page. Predicates run INSIDE the document, injected via
 * chrome.scripting, because a MutationObserver has no meaning in the worker.
 *
 * ⚠️ A page-home watch dies with its document and is re-injected on
 * navigation. That re-injection is part of the fail-quiet fix, not an
 * optimisation.
 *
 * Extra arguments go in `options.config` — the per-source fields are named in
 * each description.
 */
const PAGE_SOURCES: SourceDescriptor[] = [
  {
    id: "dom.mutation",
    home: "page",
    permission: "GRANTED",
    predicateArg:
      "(e: { type: 'mutation'; count: number; addedNodes: number; removedNodes: number; text: string; selector: string; url: string }) => boolean",
    cost: "high",
    scope: "tab",
    description:
      "DOM changed under a selector. config: {selector?, subtree?, attributes?, characterData?}. Very chatty on modern frameworks — prefer a network source when the state round-trips to a server.",
  },
  {
    id: "dom.elementText",
    home: "page",
    permission: "GRANTED",
    predicateArg:
      "(e: { type: 'elementText'; selector: string; text: string | null; previous: string | null; present: boolean; url: string }) => boolean",
    cost: "medium",
    scope: "tab",
    description:
      "An element's text changed. config: {selector} (required). Backed by a MutationObserver, not a poll. `present` distinguishes 'element gone' from 'text empty'.",
  },
  {
    id: "dom.intersection",
    home: "page",
    permission: "GRANTED",
    predicateArg:
      "(e: { type: 'intersection'; selector: string; isIntersecting: boolean; ratio: number; url: string }) => boolean",
    cost: "medium",
    scope: "tab",
    description:
      "An element entered or left the viewport. config: {selector} (required), {threshold?}. Good for infinite scroll and lazily-rendered content.",
  },
  {
    id: "page.event",
    home: "page",
    permission: "GRANTED",
    predicateArg:
      "(e: { type: 'pageEvent'; eventName: string; detail: unknown; targetTag: string | null; targetId: string | null; url: string }) => boolean",
    cost: "medium",
    scope: "tab",
    description:
      "Any DOM event, including the page's own CustomEvents. config: {eventName} (required), {selector?} to bind to an element instead of window, {capture?}. This is how you watch an app that already announces its own state changes.",
  },
  {
    id: "page.error",
    home: "page",
    permission: "GRANTED",
    predicateArg:
      "(e: { type: 'pageError'; message: string; filename: string | null; lineno: number | null; url: string }) => boolean",
    cost: "low",
    scope: "tab",
    description:
      "An uncaught error or unhandled promise rejection in the page. Complements cdp.Runtime.exceptionThrown with the in-page view.",
  },
];

export const SOURCES: SourceDescriptor[] = [
  ...CDP_SOURCES,
  ...CHROME_SOURCES,
  ...UNIBROWSE_SOURCES,
  ...PAGE_SOURCES,
];

const BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

export function getSource(id: string): SourceDescriptor | undefined {
  return BY_ID.get(id);
}

/** Levenshtein distance, iterative two-row. Small inputs; no dependency. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Validate a source id, naming the nearest match on failure.
 *
 * ⛔ A mistyped source that returns a bare "unknown source" is a silent no-op
 * waiting to happen: the caller believes they armed a watch, nothing ever
 * fires, and the absence of events looks exactly like a quiet page. Naming the
 * near miss turns that into an immediate, obvious correction.
 */
export function validateSourceId(
  id: string,
): { ok: true; source: SourceDescriptor } | { ok: false; error: string } {
  const hit = BY_ID.get(id);
  if (hit) return { ok: true, source: hit };

  let best: { id: string; d: number } | null = null;
  for (const s of SOURCES) {
    const d = distance(id, s.id);
    if (!best || d < best.d) best = { id: s.id, d };
  }
  // Only suggest when the guess is plausibly a typo rather than a wild miss.
  const suggestion =
    best && best.d <= Math.max(6, Math.floor(id.length * 0.4))
      ? ` Did you mean "${best.id}"?`
      : "";
  return {
    ok: false,
    error:
      `Unknown watch source "${id}".${suggestion}` +
      ` Call browser_watch_sources to list all ${SOURCES.length} sources with their predicate argument shapes.`,
  };
}
