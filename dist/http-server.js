#!/usr/bin/env node
import {
  GetErrorsTool,
  ListFramesTool,
  ReloadExtensionTool,
  WatchCreateTool,
  WatchDeleteTool,
  WatchListTool,
  WatchPollTool,
  WatchSourcesTool,
  appConfig,
  attachTab,
  buffersLostToRestart,
  cancelDownload,
  checkElementState,
  checkVisibility,
  clearCache,
  clearCookies,
  clearHistory,
  click,
  closeIsolatedChrome,
  closeTab,
  countElements,
  createBookmark,
  createServerWithTools,
  createServerWithoutWebSocket,
  createTab,
  createWindow,
  deleteBookmark,
  deleteCookie,
  deleteHistory,
  deleteMacro,
  deleteRecording,
  detachTab,
  disableExtension,
  downloadFile,
  drag,
  enableExtension,
  errorResponse,
  evaluate,
  executeMacro,
  fillForm,
  findByText,
  forgetWatch,
  getActiveTab,
  getAttributes,
  getBookmarks,
  getBrowserInfo,
  getClipboard,
  getComputedStyles,
  getConsoleLogs,
  getCookies,
  getDownloads,
  getExtensionInfo,
  getFilteredAriaTree,
  getFormValues,
  getHistoryVisits,
  getInteractions,
  getMacro,
  getNetworkLogs,
  getNetworkState,
  getPageMetadata,
  getRecording,
  getRecordingScreenshot,
  getSessionRecordingState,
  getSystemInfo,
  getVersion,
  getVisibleText,
  globalContext,
  goBack,
  goForward,
  hover,
  jsonResponse,
  launchIsolatedChrome,
  listAttachedTabs,
  listExtensions,
  listMacros,
  listRecordings,
  listTabs,
  mongodb,
  navigate,
  openDownload,
  package_default,
  persistWatch,
  pressKey,
  pruneInteractions,
  queryDOM,
  realisticClick,
  realisticMouseMove,
  realisticType,
  releaseTab,
  requestUserAction,
  reserveTab,
  saveRecording,
  screenshot,
  scroll,
  scrollToElement,
  searchBookmarks,
  searchHistory,
  searchInteractions,
  segmentedScreenshot,
  selectOption,
  setClipboard,
  setCookie,
  setDeviceMetrics,
  setFileInput,
  setNetworkConditions,
  setTabLabel,
  snapshot,
  startSessionRecording,
  startVideoRecording,
  stopSessionRecording,
  stopVideoRecording,
  storeMacro,
  submitForm,
  switchTab,
  textResponse,
  type,
  updateMacro,
  updateRecording,
  validatePredicate,
  wait,
  watchBuffer,
  watchRegistry
} from "./chunk-ELLWHOQJ.js";
import {
  extractKey,
  getEffectiveClientIP,
  isAuthEnabled,
  isLocalClient,
  isValidKey,
  requireApiKey,
  requireLan
} from "./chunk-YYZQZXP6.js";

// src/http-server.ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import fs2 from "fs";
import path2 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// src/tools/watch.ts
import { zodToJsonSchema } from "zod-to-json-schema";

// src/watch/sources.ts
var CDP_SOURCES = [
  {
    id: "cdp.Network.eventSourceMessageReceived",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { data: string; eventName: string; eventId: string; requestId: string; timestamp: number }) => boolean",
    cost: "high",
    scope: "tab",
    description: "Server-Sent Events frame. The best source for a chat app: one event per streamed message, with none of the re-render noise a DOM observer sees."
  },
  {
    id: "cdp.Network.webSocketFrameReceived",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { requestId: string; timestamp: number; response: { payloadData: string; opcode: number } }) => boolean",
    cost: "high",
    scope: "tab",
    description: "Inbound WebSocket frame \u2014 the other half of live apps."
  },
  {
    id: "cdp.Network.webSocketFrameSent",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { requestId: string; timestamp: number; response: { payloadData: string; opcode: number } }) => boolean",
    cost: "high",
    scope: "tab",
    description: "Outbound WebSocket frame."
  },
  {
    id: "cdp.Network.requestWillBeSent",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { requestId: string; request: { url: string; method: string; headers: object }; timestamp: number }) => boolean",
    cost: "high",
    scope: "tab",
    description: "Outgoing request. Already feeds the networkLogs ring buffer that browser_get_network_logs polls. High volume \u2014 use a predicate."
  },
  {
    id: "cdp.Network.responseReceived",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { requestId: string; response: { url: string; status: number; mimeType: string; headers: object } }) => boolean",
    cost: "high",
    scope: "tab",
    description: "Response headers received. Fires before the body is available."
  },
  {
    id: "cdp.Network.loadingFinished",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { requestId: string; timestamp: number; encodedDataLength: number }) => boolean",
    cost: "high",
    scope: "tab",
    description: "A request completed and its body is now retrievable."
  },
  {
    id: "cdp.Network.loadingFailed",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { requestId: string; errorText: string; canceled?: boolean; blockedReason?: string }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "A request failed, was cancelled, or was blocked."
  },
  {
    id: "cdp.Runtime.consoleAPICalled",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { type: string; args: Array<{ type: string; value?: unknown }>; timestamp: number }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "console.log / warn / error from the page."
  },
  {
    id: "cdp.Runtime.exceptionThrown",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { timestamp: number; exceptionDetails: { text: string; url?: string; lineNumber: number } }) => boolean",
    cost: "low",
    scope: "tab",
    description: "An uncaught exception in the page."
  },
  {
    id: "cdp.Log.entryAdded",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { entry: { source: string; level: string; text: string; url?: string } }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "Browser-level log: CORS failures, CSP violations, mixed content. Things the page's own console never sees."
  },
  {
    id: "cdp.Page.javascriptDialogOpening",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { url: string; message: string; type: string; hasBrowserHandler: boolean }) => boolean",
    cost: "low",
    scope: "tab",
    description: "An alert/confirm/prompt is blocking the tab."
  },
  {
    id: "cdp.Page.fileChooserOpened",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { frameId: string; mode: string }) => boolean",
    cost: "low",
    scope: "tab",
    description: "The page opened a file picker."
  },
  {
    id: "cdp.Page.downloadWillBegin",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { frameId: string; guid: string; url: string; suggestedFilename: string }) => boolean",
    cost: "low",
    scope: "tab",
    description: "A download is starting from this tab."
  },
  {
    id: "cdp.Page.frameNavigated",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { frame: { id: string; url: string; securityOrigin: string } }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "A frame committed a navigation, including sub-frames."
  },
  {
    id: "cdp.Page.loadEventFired",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { timestamp: number }) => boolean",
    cost: "low",
    scope: "tab",
    description: "The page's load event fired."
  },
  {
    id: "cdp.Page.domContentEventFired",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { timestamp: number }) => boolean",
    cost: "low",
    scope: "tab",
    description: "DOMContentLoaded fired."
  },
  {
    id: "cdp.Target.targetCrashed",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { targetId: string; status: string; errorCode: number }) => boolean",
    cost: "low",
    scope: "tab",
    description: "The tab died. Currently invisible to an agent until its next call fails."
  },
  {
    id: "cdp.DOM.attributeModified",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { nodeId: number; name: string; value: string }) => boolean",
    cost: "high",
    scope: "tab",
    description: "DOM attribute changed, without needing a content script. Chatty; prefer a network source where the state round-trips to a server."
  },
  {
    id: "cdp.DOM.childNodeInserted",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { parentNodeId: number; previousNodeId: number; node: { nodeName: string; nodeValue?: string } }) => boolean",
    cost: "high",
    scope: "tab",
    description: "A node was inserted. Very chatty on modern frameworks."
  },
  {
    id: "cdp.Media.playerEventsAdded",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { playerId: string; events: Array<{ timestamp: number; value: string }> }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "Media player state changes."
  },
  {
    id: "cdp.Security.securityStateChanged",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { securityState: string; summary?: string }) => boolean",
    cost: "low",
    scope: "tab",
    description: "TLS/security state of the page changed."
  },
  {
    id: "cdp.Storage.indexedDBContentUpdated",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { origin: string; databaseName: string; objectStoreName: string }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "IndexedDB content changed for an origin."
  }
];
var CHROME_SOURCES = [
  {
    id: "chrome.webNavigation.onCommitted",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; url: string; frameId: number; transitionType: string; timeStamp: number }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "A navigation committed. Top frame is frameId === 0. This is the source browser_observe_navigations_* already uses."
  },
  {
    id: "chrome.webNavigation.onCompleted",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; url: string; frameId: number; timeStamp: number }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "A document finished loading."
  },
  {
    id: "chrome.webNavigation.onHistoryStateUpdated",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { tabId: number; url: string; frameId: number; transitionType: string }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "history.pushState \u2014 SPA route changes, which onCommitted never fires for. If a single-page app seems to 'not navigate', this is why."
  },
  {
    id: "chrome.webNavigation.onBeforeNavigate",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { tabId: number; url: string; frameId: number; timeStamp: number }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "A navigation is about to start."
  },
  {
    id: "chrome.webNavigation.onDOMContentLoaded",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { tabId: number; url: string; frameId: number; timeStamp: number }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "DOMContentLoaded, per frame."
  },
  {
    id: "chrome.webNavigation.onErrorOccurred",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { tabId: number; url: string; error: string; frameId: number }) => boolean",
    cost: "low",
    scope: "tab",
    description: "A navigation failed."
  },
  {
    id: "chrome.webNavigation.onCreatedNavigationTarget",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { sourceTabId: number; tabId: number; url: string }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A new tab/window was opened by a navigation (target=_blank)."
  },
  {
    id: "chrome.tabs.onUpdated",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; changeInfo: { status?: string; title?: string; url?: string; favIconUrl?: string; audible?: boolean; mutedInfo?: object; discarded?: boolean }; tab: object }) => boolean",
    cost: "high",
    scope: "tab",
    description: "Tab changed. Title, favicon, audible, muted and discarded transitions all arrive inside changeInfo."
  },
  {
    id: "chrome.tabs.onCreated",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tab: { id: number; url?: string; title?: string; windowId: number } }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A tab was created."
  },
  {
    id: "chrome.tabs.onRemoved",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; removeInfo: { windowId: number; isWindowClosing: boolean } }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A tab was closed."
  },
  {
    id: "chrome.tabs.onActivated",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; windowId: number }) => boolean",
    cost: "medium",
    scope: "browser",
    description: "The foreground tab changed."
  },
  {
    id: "chrome.windows.onCreated",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { window: { id: number; type: string; focused: boolean } }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A browser window opened."
  },
  {
    id: "chrome.windows.onRemoved",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { windowId: number }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A browser window closed."
  },
  {
    id: "chrome.windows.onFocusChanged",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { windowId: number }) => boolean",
    cost: "medium",
    scope: "browser",
    description: "Window focus moved. windowId is -1 when the browser lost focus."
  },
  {
    id: "chrome.downloads.onCreated",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { id: number; url: string; filename: string; mime: string; totalBytes: number }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A download started."
  },
  {
    id: "chrome.downloads.onChanged",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { id: number; state?: { previous: string; current: string }; paused?: object; error?: object }) => boolean",
    cost: "medium",
    scope: "browser",
    description: "Download progress. state.current === 'complete' is the usual predicate."
  },
  {
    id: "chrome.cookies.onChanged",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { removed: boolean; cookie: { name: string; domain: string; value: string; expirationDate?: number }; cause: string }) => boolean",
    cost: "high",
    scope: "browser",
    description: "A cookie changed. Useful for detecting session expiry, login and logout without touching the page."
  },
  {
    id: "chrome.history.onVisited",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { id: string; url: string; title?: string; lastVisitTime?: number }) => boolean",
    cost: "medium",
    scope: "browser",
    description: "A URL was visited. The durable fallback that already rescues cross-origin redirects a tab has bounced away from."
  },
  {
    id: "chrome.management.onDisabled",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { id: string; name: string; enabled: boolean }) => boolean",
    cost: "low",
    scope: "browser",
    description: "An extension was disabled under you."
  },
  {
    id: "chrome.management.onEnabled",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { id: string; name: string; enabled: boolean }) => boolean",
    cost: "low",
    scope: "browser",
    description: "An extension was enabled."
  },
  {
    id: "chrome.management.onUninstalled",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { id: string }) => boolean",
    cost: "low",
    scope: "browser",
    description: "An extension was uninstalled."
  },
  {
    id: "chrome.storage.onChanged",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { changes: Record<string, { oldValue?: unknown; newValue?: unknown }>; areaName: string }) => boolean",
    cost: "medium",
    scope: "browser",
    description: "Extension storage changed."
  },
  {
    id: "chrome.bookmarks.onCreated",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { id: string; bookmark: { title: string; url?: string; parentId?: string } }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A bookmark was created."
  },
  {
    id: "chrome.notifications.onClicked",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { notificationId: string }) => boolean",
    cost: "low",
    scope: "browser",
    description: "The user clicked a notification."
  },
  {
    id: "chrome.declarativeNetRequest.onRuleMatchedDebug",
    home: "worker",
    permission: "GRANTED",
    predicateArg: "(e: { request: { url: string; method: string; tabId: number }; rule: { rulesetId: string; ruleId: number } }) => boolean",
    cost: "high",
    scope: "browser",
    description: "A declarativeNetRequest rule matched. Observational only."
  }
];
var UNIBROWSE_SOURCES = [
  {
    id: "unibrowse.tab.attached",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; extensionId: string; url?: string; label?: string }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A tab was attached to unibrowse."
  },
  {
    id: "unibrowse.tab.detached",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; extensionId: string; reason?: string }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A tab was detached."
  },
  {
    id: "unibrowse.tab.reserved",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; owner: string; claimedAt: number }) => boolean",
    cost: "low",
    scope: "browser",
    description: "An agent reserved a tab."
  },
  {
    id: "unibrowse.tab.released",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; owner: string }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A tab reservation was released."
  },
  {
    id: "unibrowse.tab.takeover",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { tabId: number; previousOwner: string; newOwner: string; at: number }) => boolean",
    cost: "low",
    scope: "browser",
    description: "Another agent took over a tab you had reserved. Today you find this out by having a call fail."
  },
  {
    id: "unibrowse.tab.lastUsedRepointed",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { previousTabId: number | null; tabId: number | null; reason: string }) => boolean",
    cost: "low",
    scope: "browser",
    description: "The lastUsedTabId pointer moved. Relevant to anything reading isActive."
  },
  {
    id: "unibrowse.macro.finished",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { name: string; ok: boolean; durationMs: number; error?: string }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A macro or routine finished, successfully or not."
  },
  {
    id: "unibrowse.recording.stopped",
    home: "worker",
    permission: "FREE",
    predicateArg: "(e: { recordingId: string; tabId: number; eventCount: number }) => boolean",
    cost: "low",
    scope: "browser",
    description: "A session recording stopped."
  }
];
var PAGE_SOURCES = [
  {
    id: "dom.mutation",
    home: "page",
    permission: "GRANTED",
    predicateArg: "(e: { type: 'mutation'; count: number; addedNodes: number; removedNodes: number; text: string; selector: string; url: string }) => boolean",
    cost: "high",
    scope: "tab",
    description: "DOM changed under a selector. config: {selector?, subtree?, attributes?, characterData?}. Very chatty on modern frameworks \u2014 prefer a network source when the state round-trips to a server."
  },
  {
    id: "dom.elementText",
    home: "page",
    permission: "GRANTED",
    predicateArg: "(e: { type: 'elementText'; selector: string; text: string | null; previous: string | null; present: boolean; url: string }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "An element's text changed. config: {selector} (required). Backed by a MutationObserver, not a poll. `present` distinguishes 'element gone' from 'text empty'."
  },
  {
    id: "dom.intersection",
    home: "page",
    permission: "GRANTED",
    predicateArg: "(e: { type: 'intersection'; selector: string; isIntersecting: boolean; ratio: number; url: string }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "An element entered or left the viewport. config: {selector} (required), {threshold?}. Good for infinite scroll and lazily-rendered content."
  },
  {
    id: "page.event",
    home: "page",
    permission: "GRANTED",
    predicateArg: "(e: { type: 'pageEvent'; eventName: string; detail: unknown; targetTag: string | null; targetId: string | null; url: string }) => boolean",
    cost: "medium",
    scope: "tab",
    description: "Any DOM event, including the page's own CustomEvents. config: {eventName} (required), {selector?} to bind to an element instead of window, {capture?}. This is how you watch an app that already announces its own state changes."
  },
  {
    id: "page.error",
    home: "page",
    permission: "GRANTED",
    predicateArg: "(e: { type: 'pageError'; message: string; filename: string | null; lineno: number | null; url: string }) => boolean",
    cost: "low",
    scope: "tab",
    description: "An uncaught error or unhandled promise rejection in the page. Complements cdp.Runtime.exceptionThrown with the in-page view."
  }
];
var SOURCES = [
  ...CDP_SOURCES,
  ...CHROME_SOURCES,
  ...UNIBROWSE_SOURCES,
  ...PAGE_SOURCES
];
var BY_ID = new Map(SOURCES.map((s) => [s.id, s]));
function distance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[b.length];
}
function validateSourceId(id) {
  const hit = BY_ID.get(id);
  if (hit) return { ok: true, source: hit };
  let best = null;
  for (const s of SOURCES) {
    const d = distance(id, s.id);
    if (!best || d < best.d) best = { id: s.id, d };
  }
  const suggestion = best && best.d <= Math.max(6, Math.floor(id.length * 0.4)) ? ` Did you mean "${best.id}"?` : "";
  return {
    ok: false,
    error: `Unknown watch source "${id}".${suggestion} Call browser_watch_sources to list all ${SOURCES.length} sources with their predicate argument shapes.`
  };
}

// src/tools/watch.ts
function renderArmed(rec) {
  if (rec.armedReportedByExtension === null) return "unknown \u2014 extension has never reported";
  const when = rec.armedReportedAt ? new Date(rec.armedReportedAt).toISOString() : "?";
  return `${rec.armedReportedByExtension} (as of ${when})`;
}
var watchSources = {
  schema: {
    name: WatchSourcesTool.shape.name.value,
    description: WatchSourcesTool.shape.description.value,
    inputSchema: zodToJsonSchema(WatchSourcesTool.shape.arguments)
  },
  handle: (async (_context, params) => {
    const { filter } = WatchSourcesTool.shape.arguments.parse(params ?? {});
    const list = filter ? SOURCES.filter((s) => s.id.toLowerCase().includes(filter.toLowerCase())) : SOURCES;
    if (list.length === 0) {
      return textResponse(
        `No watch source matches "${filter}". Call browser_watch_sources with no filter to see all ${SOURCES.length}.`
      );
    }
    let out = `# Watch sources (${list.length}${filter ? ` matching "${filter}"` : ""})

`;
    out += `The predicate argument differs per source. Copy the shape below rather than guessing \u2014
`;
    out += `a predicate written against the wrong shape simply never matches, which looks exactly
`;
    out += `like a quiet page.

`;
    let currentGroup = "";
    for (const s of list) {
      const group = s.id.split(".")[0];
      if (group !== currentGroup) {
        currentGroup = group;
        const heading = group === "cdp" ? "CDP \u2014 per attached tab" : group === "chrome" ? "chrome.* \u2014 browser-wide APIs" : "unibrowse \u2014 the automation plane itself";
        out += `
## ${heading}

`;
      }
      out += `**\`${s.id}\`**  \xB7  ${s.scope}-scoped  \xB7  volume: ${s.cost}
`;
      out += `${s.description}
`;
      out += `predicate: \`${s.predicateArg}\`

`;
    }
    return textResponse(out);
  })
};
var watchCreate = {
  schema: {
    name: WatchCreateTool.shape.name.value,
    description: WatchCreateTool.shape.description.value,
    inputSchema: zodToJsonSchema(WatchCreateTool.shape.arguments)
  },
  handle: (async (context, params) => {
    try {
      const args = WatchCreateTool.shape.arguments.parse(params ?? {});
      const check = validateSourceId(args.source);
      if (!check.ok) return errorResponse(check.error);
      const descriptor = check.source;
      const pred = validatePredicate(args.predicate);
      if (!pred.ok) return errorResponse(pred.error);
      const NEEDS_SELECTOR = ["dom.mutation", "dom.elementText", "dom.intersection"];
      if (NEEDS_SELECTOR.includes(args.source) && args.source !== "dom.mutation" && !args.config?.selector) {
        return errorResponse(
          `Source "${args.source}" requires config.selector, e.g. config: {selector: "#status"}.`
        );
      }
      if (args.source === "page.event" && !args.config?.eventName) {
        return errorResponse(
          `Source "page.event" requires config.eventName, e.g. config: {eventName: "my-app-ready"}.`
        );
      }
      const sink = args.sink ?? { kind: "atc" };
      if (sink.kind === "atc" && !sink.to && !args.agent) {
        return errorResponse(
          `This watch would have nowhere to deliver: sink.kind is "atc" but neither sink.to nor \`agent\` was set. Pass \`agent\` with your identifier so events reach your own session, or set sink.to explicitly.`
        );
      }
      if (sink.kind === "webhook" && !sink.url) {
        return errorResponse(`sink.kind is "webhook" but sink.url was not set.`);
      }
      let tabId = null;
      let extensionId = args.extensionId;
      if (descriptor.scope === "tab") {
        const attached = await context.ensureAttachedFromParams(args);
        tabId = attached.tabId;
        if (!extensionId) {
          extensionId = context.extensionIdForTab(attached.tabId);
        }
      }
      if (!extensionId) {
        const exts = context.listExtensions();
        if (exts.length === 1) extensionId = exts[0].extensionId;
        else if (exts.length > 1) {
          return errorResponse(
            `Multiple extensions are connected (${exts.length}); pass extensionId to say which browser to arm the watch in. Connected: ${exts.map((e) => e.extensionId).join(", ")}`
          );
        } else {
          return errorResponse(`No extension is connected, so there is nothing to arm a watch in.`);
        }
      }
      const record = watchRegistry.create(
        {
          source: args.source,
          prefilter: args.prefilter,
          predicate: args.predicate,
          config: args.config,
          sink,
          options: args.options,
          tabId,
          extensionId,
          agent: args.agent
        },
        descriptor.home
      );
      let armedAgainstUrl;
      if (descriptor.home === "page" && tabId != null) {
        try {
          const u = await context.sendSocketMessage(
            "browser_evaluate",
            { expression: "location.href", tabTarget: tabId },
            { extensionId, tabTarget: tabId, timeoutMs: 5e3 }
          );
          const raw = typeof u === "string" ? u : u?.result ?? u?.value;
          armedAgainstUrl = typeof raw === "string" ? raw.replace(/^"|"$/g, "") : void 0;
        } catch {
        }
      }
      let armed;
      try {
        const res = await context.sendSocketMessage(
          "browser_watch_arm",
          {
            watchId: record.watchId,
            source: record.source,
            // ⛔ The extension gets the PREFILTER, not the predicate: MV3's CSP
            // forbids evaluating a string as JS in a service worker. A page
            // watch is the exception — its predicate is injected into the
            // document and runs under the page's CSP.
            prefilter: record.prefilter,
            predicate: descriptor.home === "page" ? record.predicate : void 0,
            config: record.config,
            armedAgainstUrl,
            options: record.options,
            tabId: record.tabId,
            extensionId
          },
          { extensionId }
        );
        armed = res?.armed === true;
        watchRegistry.recordArmed(record.watchId, armed, Date.now());
      } catch (e) {
        watchRegistry.delete(record.watchId);
        return errorResponse(
          `Failed to arm the watch in extension ${extensionId}: ${e?.message ?? e}. No watch was created.`
        );
      }
      if (!armed) {
        watchRegistry.delete(record.watchId);
        return errorResponse(
          `Extension ${extensionId} did not confirm the watch as armed. No watch was created.`
        );
      }
      if (sink.kind === "buffer") {
        watchBuffer.setCapacity(record.watchId, sink.maxBuffered);
      }
      void persistWatch({ ...record, armedAgainstUrl });
      let out = `# Watch armed

`;
      out += `**watchId**: \`${record.watchId}\`
`;
      out += `**source**: \`${record.source}\` (${descriptor.scope}-scoped, volume ${descriptor.cost})
`;
      out += `**home**: ${record.home}
`;
      if (tabId != null) out += `**tab**: ${tabId}
`;
      out += `**extension**: ${extensionId}
`;
      out += `**sink**: ${sink.kind}`;
      if (sink.kind === "atc") out += ` \u2192 ${sink.to ?? args.agent}`;
      if (sink.kind === "webhook") out += ` \u2192 ${sink.url}`;
      out += `
`;
      out += `**predicate**: ${record.predicate ? `\`${record.predicate}\`` : "none \u2014 fires on every event"}
`;
      if (descriptor.home === "page") {
        out += armedAgainstUrl ? `**document**: ${armedAgainstUrl}
  (if this tab navigates elsewhere the watch is cleared as \`document-changed\` rather than re-attached to the new page)
` : `\u26A0\uFE0F **document**: could not be read, so this watch is NOT url-guarded \u2014 if the tab navigates it may re-attach to a different page, and it will not survive a server restart.
`;
      }
      out += `
`;
      out += `Events are dropped if nothing is listening when they fire; they are never queued.
`;
      out += `This watch is cleared when the tab detaches, the extension disconnects`;
      if (record.options?.ttlMs) out += `, after ${record.options.ttlMs}ms`;
      if (record.options?.once) out += `, or after its first match`;
      out += `, or when you call browser_watch_delete.
`;
      if (sink.kind === "buffer") {
        out += `
Drain it with \`browser_watch_poll({watchId: "${record.watchId}"})\`.
`;
      }
      return textResponse(out);
    } catch (e) {
      return errorResponse(`browser_watch_create failed: ${e?.message ?? e}`);
    }
  })
};
var watchList = {
  schema: {
    name: WatchListTool.shape.name.value,
    description: WatchListTool.shape.description.value,
    inputSchema: zodToJsonSchema(WatchListTool.shape.arguments)
  },
  handle: (async (context, params) => {
    try {
      const args = WatchListTool.shape.arguments.parse(params ?? {});
      const tabId = typeof args.tabTarget === "number" ? args.tabTarget : void 0;
      if (args.refresh) {
        const targets = new Set(
          watchRegistry.list({ extensionId: args.extensionId }).map((w) => w.extensionId)
        );
        for (const ext of targets) {
          try {
            const res = await context.sendSocketMessage(
              "browser_watch_list_armed",
              {},
              { extensionId: ext }
            );
            const live = new Set(
              (res?.watches ?? []).filter((w) => w.armed).map((w) => w.watchId)
            );
            const now = Date.now();
            for (const rec of watchRegistry.list({ extensionId: ext })) {
              watchRegistry.recordArmed(rec.watchId, live.has(rec.watchId), now);
            }
          } catch {
          }
        }
      }
      const rows = watchRegistry.list({
        extensionId: args.extensionId,
        ...tabId !== void 0 ? { tabId } : {},
        agent: args.agent
      });
      const cleared = watchRegistry.recentlyCleared({
        extensionId: args.extensionId,
        ...tabId !== void 0 ? { tabId } : {},
        agent: args.agent
      });
      if (rows.length === 0) {
        let out2 = `No live watches.
`;
        if (cleared.length > 0) {
          out2 += `
\u26A0\uFE0F But ${cleared.length} watch(es) were CLEARED recently \u2014 this is not the same
`;
          out2 += `as never having armed one:

`;
          out2 += renderCleared(cleared);
        } else {
          out2 += `
No recently-cleared watches either.
`;
        }
        out2 += `
${restartNote()}`;
        return textResponse(out2);
      }
      let out = `# Watches (${rows.length})

`;
      for (const r of rows) {
        out += `**\`${r.watchId}\`** \u2014 \`${r.source}\`
`;
        out += `- armed (per extension): ${renderArmed(r)}
`;
        out += `- sink: ${r.sink.kind}`;
        if (r.sink.kind === "atc") out += ` \u2192 ${r.sink.to ?? r.agent ?? "?"}`;
        out += `
`;
        out += `- extension: ${r.extensionId}${r.tabId != null ? `, tab ${r.tabId}` : ", browser-wide"}
`;
        out += `- fired: ${r.firedCount}`;
        if (r.lastFiredAt) out += ` (last ${new Date(r.lastFiredAt).toISOString()})`;
        if (r.prefilteredCount) out += `, passed prefilter but not predicate: ${r.prefilteredCount}`;
        if (r.droppedCount) out += `, delivery failures: ${r.droppedCount}`;
        out += `
`;
        if (r.predicate) out += `- predicate: \`${r.predicate}\`
`;
        out += `
`;
      }
      if (cleared.length > 0) {
        out += `
## Recently cleared (${cleared.length})

`;
        out += renderCleared(cleared);
      }
      out += `
\`armed\` is the extension's own last answer, recorded verbatim. "unknown" means it
`;
      out += `has never reported \u2014 which is not the same as false. Pass \`refresh: true\` to re-ask.
`;
      out += `
${restartNote()}`;
      return textResponse(out);
    } catch (e) {
      return errorResponse(`browser_watch_list failed: ${e?.message ?? e}`);
    }
  })
};
var watchDelete = {
  schema: {
    name: WatchDeleteTool.shape.name.value,
    description: WatchDeleteTool.shape.description.value,
    inputSchema: zodToJsonSchema(WatchDeleteTool.shape.arguments)
  },
  handle: (async (context, params) => {
    try {
      const args = WatchDeleteTool.shape.arguments.parse(params ?? {});
      const rec = watchRegistry.get(args.watchId);
      if (!rec) return errorResponse(explainMissing(args.watchId));
      let disarmNote = "";
      try {
        await context.sendSocketMessage(
          "browser_watch_disarm",
          { watchId: args.watchId },
          { extensionId: args.extensionId ?? rec.extensionId }
        );
      } catch (e) {
        disarmNote = `
\u26A0\uFE0F The extension did not confirm the disarm (${e?.message ?? e}). The server record is gone, so any further events from it will be discarded and the extension told to disarm on the next one.
`;
      }
      watchRegistry.delete(args.watchId);
      watchBuffer.drop(args.watchId);
      buffersLostToRestart.delete(args.watchId);
      await forgetWatch(args.watchId);
      return textResponse(`Deleted watch \`${args.watchId}\` (\`${rec.source}\`).${disarmNote}`);
    } catch (e) {
      return errorResponse(`browser_watch_delete failed: ${e?.message ?? e}`);
    }
  })
};
var watchPoll = {
  schema: {
    name: WatchPollTool.shape.name.value,
    description: WatchPollTool.shape.description.value,
    inputSchema: zodToJsonSchema(WatchPollTool.shape.arguments)
  },
  handle: (async (_context, params) => {
    try {
      const args = WatchPollTool.shape.arguments.parse(params ?? {});
      const rec = watchRegistry.get(args.watchId);
      if (!rec) return errorResponse(explainMissing(args.watchId));
      if (rec.sink.kind !== "buffer") {
        return errorResponse(
          `Watch "${args.watchId}" has a "${rec.sink.kind}" sink, so its events are delivered rather than buffered. Only a watch created with sink {kind:"buffer"} can be polled.`
        );
      }
      const res = await watchBuffer.poll(args.watchId, args.timeoutMs ?? 15e3);
      if (!res.matched) {
        const lost = buffersLostToRestart.has(args.watchId);
        return textResponse(
          `No events from \`${args.watchId}\` within ${res.timeoutMs}ms. This is an answer, not an error \u2014 poll again to keep waiting.` + (lost ? `

\u26A0\uFE0F NOTE: this watch survived an mcp-server restart, but its BUFFER did not. Anything it captured before the restart is gone and will not be replayed. The watch itself is re-armed and will deliver new events normally.` : "")
        );
      }
      buffersLostToRestart.delete(args.watchId);
      let out = `# ${res.events.length} event(s) from \`${args.watchId}\`

`;
      for (const ev of res.events) {
        out += `**${new Date(ev.firedAt).toISOString()}** \u2014 \`${ev.source}\`
`;
        if (ev.breakerTripped) {
          out += `\u26D4 WATCH DISARMED: ${ev.breakerTripped.reason} (${ev.breakerTripped.firedInWindow} fires against a cap of ${ev.breakerTripped.cap})
`;
        }
        out += "```json\n" + JSON.stringify(ev.payload, null, 2).slice(0, 4e3) + "\n```\n\n";
      }
      return textResponse(out);
    } catch (e) {
      return errorResponse(`browser_watch_poll failed: ${e?.message ?? e}`);
    }
  })
};
var CLEARED_EXPLANATION = {
  deleted: "you deleted it",
  "tab-detached": "its tab detached or closed",
  "extension-disconnected": "its extension's WebSocket closed \u2014 note that an mcp-server restart closes every extension socket at once, so this can affect every watch in the fleet simultaneously",
  ttl: "its ttlMs elapsed",
  once: "it was created with once:true and has fired",
  breaker: "the rate-cap breaker tripped and disarmed it",
  "document-changed": "its tab navigated away from the document it was created against \u2014 re-arming would have attached your observer to a different page"
};
function renderCleared(cleared) {
  let out = "";
  for (const t of cleared) {
    out += `- **\`${t.watchId}\`** \`${t.source}\` \u2014 cleared ${new Date(t.at).toISOString()}: `;
    out += `**${t.reason}** (${CLEARED_EXPLANATION[t.reason] ?? "reason not recorded"}), `;
    out += `after firing ${t.firedCount} time(s)
`;
  }
  return out;
}
function restartNote() {
  const started = new Date(watchRegistry.startedAt).toISOString();
  return `Watches are persisted and DO survive an mcp-server restart: subscriptions are reloaded and re-armed when each extension reconnects, arriving as \`armed: unknown\` until the extension confirms. \u26A0\uFE0F What does NOT survive: buffered events (the queue starts empty and a poll says so), and any page watch whose tab navigated while the server was down \u2014 those are cleared as \`document-changed\` rather than re-armed onto a different document. This server started at ${started}.
`;
}
function explainMissing(watchId) {
  const t = watchRegistry.tombstone(watchId);
  if (t) {
    return `Watch \`${watchId}\` was CLEARED at ${new Date(t.at).toISOString()} \u2014 reason: **${t.reason}** (${CLEARED_EXPLANATION[t.reason] ?? "reason not recorded"}). It fired ${t.firedCount} time(s) before that. It is not armed and will deliver nothing; re-create it with browser_watch_create.`;
  }
  return `No watch with id "${watchId}", and no record of one having been cleared \u2014 it was never created here, or it was cleared long enough ago that its tombstone aged out.

${restartNote()}`;
}

// src/install.ts
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
function findExtensionDir() {
  const candidates = [
    path.join(__dirname, "..", "extension"),
    // /app/extension when run from /app/dist
    path.join(__dirname, "..", "..", "extension"),
    // <repo>/extension when run from <repo>/dist
    "/app/extension"
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    } catch {
    }
  }
  return null;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function deriveBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"]?.split(",")[0].trim() || (req.secure ? "https" : "http");
  const host = req.headers["x-forwarded-host"]?.split(",")[0].trim() || req.headers.host || "localhost:9010";
  const wsProto = proto === "https" ? "wss" : "ws";
  return { http: `${proto}://${host}`, ws: `${wsProto}://${host}` };
}
function detectBrowserFamily(req) {
  const ua = req.headers["user-agent"] || "";
  if (/\bEdgA?\//.test(ua)) return { name: "Edge", scheme: "edge" };
  if (/\bOPR\//.test(ua)) return { name: "Opera", scheme: "opera" };
  if (/\bVivaldi\//.test(ua)) return { name: "Vivaldi", scheme: "vivaldi" };
  return { name: "Chrome", scheme: "chrome" };
}
function installLandingHandler(req, res) {
  const browser = detectBrowserFamily(req);
  const { http: httpBase, ws: wsBase } = deriveBaseUrl(req);
  const queryKey = req.query.key || "";
  const authOn = isAuthEnabled();
  const isLocal = isLocalClient(req);
  const authForThisClient = authOn && !isLocal;
  const keyIsValid = authForThisClient ? isValidKey(queryKey) : true;
  const downloadHref = `/install/extension.zip${queryKey ? `?key=${encodeURIComponent(queryKey)}` : ""}`;
  const errorBanner = authForThisClient && queryKey && !keyIsValid ? `<div class="banner err">The provided key is not valid on this server.</div>` : authForThisClient && !queryKey ? `<div class="banner warn">This server requires an API key for remote clients. Append <code>?key=&lt;your-key&gt;</code> to this URL to enable the download.</div>` : "";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>unibrowse \u2014 install extension</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 780px; margin: 40px auto; padding: 0 20px; color: #222; line-height: 1.55; }
    h1 { font-size: 28px; margin-bottom: 4px; }
    .sub { color: #666; margin-bottom: 28px; }
    .banner { padding: 12px 16px; border-radius: 6px; margin: 18px 0; font-size: 14px; }
    .banner.err { background: #fee; border: 1px solid #f99; color: #800; }
    .banner.warn { background: #fff8e1; border: 1px solid #f0c060; color: #806000; }
    .download { display: inline-block; background: #6f42c1; color: white; padding: 12px 22px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 12px 0 20px; }
    .download[aria-disabled="true"] { background: #999; cursor: not-allowed; pointer-events: none; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
    pre { background: #1e1e1e; color: #eee; padding: 14px; border-radius: 6px; overflow-x: auto; }
    ol li { margin: 8px 0; }
    .meta { color: #999; font-size: 12px; margin-top: 36px; }
  </style>
</head>
<body>
  <h1>Install the unibrowse extension</h1>
  <div class="sub">This dev extension is distributed directly from your server, not a web store. It runs on any Chromium browser \u2014 Chrome, Edge, Brave, Opera, Vivaldi.</div>
  ${errorBanner}
  <a class="download" href="${downloadHref}" ${!keyIsValid ? 'aria-disabled="true"' : ""}>Download extension (.zip)</a>
  <h3>Install steps</h3>
  <ol>
    <li>Click the button above to download <code>unibrowse-extension.zip</code>.</li>
    <li>Unzip it somewhere stable (e.g. <code>~/unibrowse-extension</code>).</li>
    <li>Open <code>${browser.scheme}://extensions</code> in ${escapeHtml(browser.name)} and turn <strong>Developer mode</strong> on.</li>
    <li>Click <strong>Load unpacked</strong> and select the unzipped folder.</li>
    <li>The extension auto-connects to this server (<code>${wsBase}/ws</code>).</li>
  </ol>
  <h3>Configuration</h3>
  <p>The downloaded extension is pre-configured for this server. You can override the server URL or API key any time via the extension's <strong>Options</strong> page (Right-click the extension icon \u2192 Options).</p>
  <div class="meta">
    Server: <code>${httpBase}</code><br>
    WebSocket: <code>${wsBase}/ws</code><br>
    Auth policy: <code>${authOn ? "LAN open / remote requires API key" : "open (no key required)"}</code><br>
    You are: <code>${isLocal ? "LAN client (open access)" : "remote client (API key required)"}</code> \u2014 ${escapeHtml(getEffectiveClientIP(req))}
  </div>
</body>
</html>`);
}
async function installZipHandler(req, res) {
  if (isAuthEnabled() && !isLocalClient(req)) {
    const key = extractKey(req);
    if (!isValidKey(key)) {
      res.status(401).json({
        error: "Invalid or missing API key. Open /install?key=<key> to download.",
        clientIp: getEffectiveClientIP(req)
      });
      return;
    }
  }
  const extDir = findExtensionDir();
  if (!extDir) {
    res.status(500).json({ error: "Extension directory not found on server" });
    return;
  }
  const { http: httpBase, ws: wsBase } = deriveBaseUrl(req);
  const apiKey = extractKey(req) || "";
  const configContent = `// Auto-generated by /install/extension.zip on ${(/* @__PURE__ */ new Date()).toISOString()}
// Server: ${httpBase}
// Edit via the extension's Options page to override at runtime.
self.UNIBROWSE_CONFIG = {
  SERVER_URL: ${JSON.stringify(httpBase)},
  WS_URL: ${JSON.stringify(`${wsBase}/ws`)},
  API_KEY: ${JSON.stringify(apiKey)},
  INSTALLED_FROM: ${JSON.stringify(httpBase)},
  INSTALLED_AT: ${JSON.stringify((/* @__PURE__ */ new Date()).toISOString())},
};
`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="unibrowse-extension.zip"`);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    console.error("[install] zip error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  });
  archive.pipe(res);
  const skip = (name) => {
    if (name.startsWith(".nfs")) return true;
    if (name.endsWith(".backup")) return true;
    if (name.includes(".backup-")) return true;
    if (name === ".gitignore") return true;
    if (name === "generate-icons.js") return true;
    return false;
  };
  function walk(dir, rel) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const inner = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, inner);
      } else if (entry.isFile()) {
        if (inner === "config.js") continue;
        archive.file(abs, { name: inner });
      }
    }
  }
  walk(extDir, "");
  archive.append(configContent, { name: "config.js" });
  archive.finalize();
}

// src/tools/frames.ts
import { zodToJsonSchema as zodToJsonSchema2 } from "zod-to-json-schema";
var listFrames = {
  schema: {
    name: ListFramesTool.shape.name.value,
    description: ListFramesTool.shape.description.value,
    inputSchema: zodToJsonSchema2(ListFramesTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = ListFramesTool.shape.arguments.parse(params || {});
      const result = await context.sendSocketMessage("browser_list_frames", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to list frames: ${error.message}`, false, error, max_tokens);
    }
  }
};

// src/tools/errors.ts
import { zodToJsonSchema as zodToJsonSchema3 } from "zod-to-json-schema";
var getErrors = {
  schema: {
    name: GetErrorsTool.shape.name.value,
    description: GetErrorsTool.shape.description.value,
    inputSchema: zodToJsonSchema3(GetErrorsTool.shape.arguments)
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
  }
};
var reloadExtension = {
  schema: {
    name: ReloadExtensionTool.shape.name.value,
    description: ReloadExtensionTool.shape.description.value,
    inputSchema: zodToJsonSchema3(ReloadExtensionTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const result = await context.sendSocketMessage(
        "browser_reload_extension",
        params || {},
        { extensionId: params?.extensionId }
      );
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to reload extension: ${error.message}`, false, error, max_tokens);
    }
  }
};

// src/http-server.ts
import { v4 as uuidv4 } from "uuid";
var __dirname2 = path2.dirname(fileURLToPath2(import.meta.url));
var RECORDINGS_DIR = process.env.RECORDINGS_DIR || path2.join(__dirname2, "..", "recordings");
var commonTools = [
  pressKey,
  scroll,
  scrollToElement,
  setDeviceMetrics,
  setFileInput,
  wait
];
var customTools = [
  evaluate,
  getConsoleLogs,
  getNetworkLogs,
  screenshot,
  segmentedScreenshot
];
var explorationTools = [
  queryDOM,
  getVisibleText,
  getComputedStyles,
  checkVisibility,
  getAttributes,
  countElements,
  getPageMetadata,
  getFilteredAriaTree,
  findByText,
  getFormValues,
  checkElementState
];
var tabTools = [
  listTabs,
  switchTab,
  createTab,
  closeTab,
  createWindow
];
var formTools = [
  fillForm,
  submitForm
];
var recordingTools = [
  requestUserAction(false),
  saveRecording,
  listRecordings,
  getRecording,
  updateRecording,
  deleteRecording,
  startSessionRecording,
  stopSessionRecording,
  getSessionRecordingState,
  getRecordingScreenshot
];
var interactionTools = [
  getInteractions,
  pruneInteractions,
  searchInteractions,
  watchSources,
  watchCreate,
  watchList,
  watchDelete,
  watchPoll
];
var cookieTools = [
  getCookies,
  setCookie,
  deleteCookie,
  clearCookies
];
var downloadTools = [
  downloadFile,
  getDownloads,
  cancelDownload,
  openDownload
];
var clipboardTools = [
  getClipboard,
  setClipboard
];
var historyTools = [
  searchHistory,
  getHistoryVisits,
  deleteHistory,
  clearHistory
];
var systemTools = [
  getVersion,
  getSystemInfo,
  getBrowserInfo,
  launchIsolatedChrome,
  closeIsolatedChrome
];
var networkTools = [
  getNetworkState,
  setNetworkConditions,
  clearCache
];
var bookmarkTools = [
  getBookmarks,
  createBookmark,
  deleteBookmark,
  searchBookmarks
];
var extensionTools = [
  listExtensions,
  getExtensionInfo,
  enableExtension,
  disableExtension
];
var macroTools = [
  storeMacro,
  listMacros,
  getMacro,
  executeMacro,
  updateMacro,
  deleteMacro
];
var realisticInputTools = [
  realisticMouseMove,
  realisticClick,
  realisticType
];
var videoRecordingTools = [
  startVideoRecording,
  stopVideoRecording
];
var multiTabTools = [
  listAttachedTabs,
  setTabLabel,
  detachTab,
  getActiveTab,
  attachTab,
  reserveTab,
  releaseTab
];
var frameTools = [
  listFrames
];
var diagnosticTools = [
  getErrors,
  reloadExtension
];
var snapshotTools = [
  navigate(false),
  goBack(false),
  goForward(false),
  snapshot,
  click,
  drag,
  hover,
  type,
  selectOption,
  ...commonTools,
  ...customTools,
  ...explorationTools,
  ...tabTools,
  ...formTools,
  ...recordingTools,
  ...interactionTools,
  ...cookieTools,
  ...downloadTools,
  ...clipboardTools,
  ...historyTools,
  ...systemTools,
  ...networkTools,
  ...bookmarkTools,
  ...extensionTools,
  ...macroTools,
  ...realisticInputTools,
  ...multiTabTools,
  ...videoRecordingTools,
  ...frameTools,
  ...diagnosticTools
];
var resources = [];
async function main() {
  const app = express();
  app.use(express.json({ limit: "10gb" }));
  app.use("/api/v1/recordings/:id/video", express.raw({ type: "video/*", limit: "500mb" }));
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  const port = parseInt(process.env.PORT || "9010");
  app.get("/health", (req, res) => {
    const authOn = isAuthEnabled();
    const local = isLocalClient(req);
    res.json({
      status: "ok",
      version: package_default.version,
      // All gated routes (/mcp, /ws, /install/zip, /api/v1/recordings/*)
      // share the same policy: LAN clients always allowed; remote clients
      // need an API key when UNIBROWSE_API_KEYS is set.
      policy: authOn ? "lan-open-remote-required" : "open",
      authRequired: authOn && !local,
      clientIp: getEffectiveClientIP(req),
      isLocalClient: local
    });
  });
  app.get("/extensions", (_req, res) => {
    const identities = globalContext.describeExtensions();
    const usable = identities.filter(
      (e) => e.kind !== "container-sidecar" && e.kind !== "lan-remote"
    );
    res.json({
      hostBrowserPresent: usable.length > 0,
      hostBrowserKinds: usable.map((e) => e.kind),
      connected: identities,
      // Newest last. Close code is the diagnostic field: 1000/1001 = deliberate
      // close (worker shutdown), 1006 = socket vanished with no close frame.
      recentDisconnects: globalContext.getDisconnects()
    });
  });
  app.get("/install", installLandingHandler);
  app.get("/install/extension.zip", installZipHandler);
  app.get("/__unibrowse_seed", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      `<!doctype html><meta charset=utf-8><title>unibrowse seed</title><body>seeding\u2026</body>`
    );
  });
  if (!fs2.existsSync(RECORDINGS_DIR)) {
    fs2.mkdirSync(RECORDINGS_DIR, { recursive: true });
  }
  async function ensureMongoConnected() {
    if (!mongodb.isConnected()) await mongodb.connect();
  }
  app.post("/api/v1/recordings", requireApiKey, async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const body = req.body;
      const doc = {
        id: uuidv4(),
        sessionId: body.sessionId || "",
        title: body.title || "Untitled Session",
        description: body.description || "",
        tags: body.tags || [],
        status: body.status || "complete",
        startUrl: body.startUrl || "",
        startTime: body.startTime || Date.now(),
        endTime: body.endTime || Date.now(),
        duration: body.duration || 0,
        pages: body.pages || [],
        rrwebEventCount: body.rrwebEventCount || 0,
        networkEntryCount: body.networkEntryCount || 0,
        annotations: [],
        videoPath: null,
        primaryTabId: body.primaryTabId || null,
        recordedTabIds: body.recordedTabIds || [],
        videoStartTimes: body.videoStartTimes || {},
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      };
      await recordings.insertOne(doc);
      res.json({ id: doc.id, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/v1/recordings/:id/video", requireApiKey, async (req, res) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const videoPath = path2.join(RECORDINGS_DIR, `${id}.webm`);
      fs2.writeFileSync(videoPath, req.body);
      const recordings = mongodb.getRecordingsCollection();
      await recordings.updateOne(
        { id },
        { $set: { videoPath: `recordings/${id}.webm`, updatedAt: /* @__PURE__ */ new Date() } }
      );
      res.json({ success: true, videoPath: `recordings/${id}.webm` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/v1/recordings/:id/events", requireApiKey, async (req, res) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const { rrwebEvents = [], networkEntries = [], interactions = [], chunkIndex = 0 } = req.body;
      const recordingEvents = mongodb.getRecordingEventsCollection();
      if (req.query.reset === "1" || chunkIndex === 0) {
        await recordingEvents.deleteMany({ recordingId: id });
      }
      await recordingEvents.insertOne({
        recordingId: id,
        chunkIndex,
        rrwebEvents,
        networkEntries,
        interactions,
        updatedAt: /* @__PURE__ */ new Date()
      });
      res.json({ success: true, chunkIndex, rrwebEventCount: rrwebEvents.length, networkEntryCount: networkEntries.length, interactionCount: interactions.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/v1/recordings/:id/annotations", async (req, res) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const col = mongodb.getRecordingAnnotationsCollection();
      const docs = await col.find({ recordingId: id }, { projection: { _id: 0, recordingId: 0 } }).sort({ timestamp: 1 }).toArray();
      res.json({ annotations: docs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/v1/recordings/:id/annotations", requireApiKey, async (req, res) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const annotation = req.body;
      const col = mongodb.getRecordingAnnotationsCollection();
      await col.updateOne(
        { recordingId: id, id: annotation.id },
        { $set: { ...annotation, recordingId: id, updatedAt: /* @__PURE__ */ new Date() } },
        { upsert: true }
      );
      res.json({ success: true, annotationId: annotation.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/v1/recordings", async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const limit = parseInt(String(req.query.limit || "50"));
      const results = await recordings.find({}, { projection: { _id: 0, rrwebEvents: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray();
      res.json({ count: results.length, recordings: results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/v1/recordings/:id", async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const recording = await recordings.findOne({ id: req.params.id }, { projection: { _id: 0 } });
      if (!recording) return res.status(404).json({ error: "Not found" });
      res.json({ recording });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/v1/recordings/:id/video", async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const recording = await recordings.findOne({ id: req.params.id });
      if (!recording || !recording.videoPath) return res.status(404).json({ error: "No video" });
      const absPath = path2.join(RECORDINGS_DIR, `${req.params.id}.webm`);
      if (!fs2.existsSync(absPath)) return res.status(404).json({ error: "Video file not found" });
      const stat = fs2.statSync(absPath);
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Type": "video/webm"
        });
        fs2.createReadStream(absPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Content-Type": "video/webm",
          "Accept-Ranges": "bytes"
        });
        fs2.createReadStream(absPath).pipe(res);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/v1/recordings/:id/video/:tabId", requireApiKey, async (req, res) => {
    try {
      await ensureMongoConnected();
      const { id, tabId } = req.params;
      const videoPath = path2.join(RECORDINGS_DIR, `${id}-tab-${tabId}.webm`);
      fs2.writeFileSync(videoPath, req.body);
      const recordings = mongodb.getRecordingsCollection();
      await recordings.updateOne(
        { id },
        { $set: { updatedAt: /* @__PURE__ */ new Date() } }
      );
      res.json({ success: true, size: req.body.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/v1/recordings/:id/video/:tabId", (req, res) => {
    const { id, tabId } = req.params;
    const absPath = path2.join(RECORDINGS_DIR, `${id}-tab-${tabId}.webm`);
    if (!fs2.existsSync(absPath)) return res.status(404).json({ error: "No video for this tab" });
    const stat = fs2.statSync(absPath);
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": "video/webm"
      });
      fs2.createReadStream(absPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": "video/webm",
        "Accept-Ranges": "bytes"
      });
      fs2.createReadStream(absPath).pipe(res);
    }
  });
  app.get("/api/v1/recordings/:id/events", async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordingEvents = mongodb.getRecordingEventsCollection();
      const docs = await recordingEvents.find({ recordingId: req.params.id }, { projection: { _id: 0 } }).sort({ chunkIndex: 1 }).toArray();
      if (docs.length === 0) return res.json({ rrwebEvents: [], networkEntries: [], interactions: [] });
      const rrwebEvents = [];
      const networkEntries = [];
      const interactions = [];
      for (const d of docs) {
        if (d.rrwebEvents) rrwebEvents.push(...d.rrwebEvents);
        if (d.networkEntries) networkEntries.push(...d.networkEntries);
        if (d.interactions) interactions.push(...d.interactions);
      }
      res.json({ rrwebEvents, networkEntries, interactions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.put("/api/v1/recordings/:id", async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const { title, description, tags } = req.body;
      const update = { updatedAt: /* @__PURE__ */ new Date() };
      if (title !== void 0) update.title = title;
      if (description !== void 0) update.description = description;
      if (tags !== void 0) update.tags = tags;
      const result = await recordings.updateOne({ id: req.params.id }, { $set: update });
      if (result.matchedCount === 0) return res.status(404).json({ error: "Not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.put("/api/v1/recordings/:id/annotations", async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const { annotations } = req.body;
      await recordings.updateOne(
        { id: req.params.id },
        { $set: { annotations: annotations || [], updatedAt: /* @__PURE__ */ new Date() } }
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/v1/recordings/:id/frame", async (req, res) => {
    try {
      await ensureMongoConnected();
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      const recordings = mongodb.getRecordingsCollection();
      const recording = await recordings.findOne({ id: req.params.id });
      if (!recording) return res.status(404).json({ error: "Recording not found" });
      const targetTs = parseInt(req.query.t || "0", 10) || recording.startTime;
      const tabId = req.query.tabId ? parseInt(req.query.tabId, 10) : recording.primaryTabId ?? recording.recordedTabIds?.[0];
      const videoFile = tabId ? path2.join(RECORDINGS_DIR, `${req.params.id}-tab-${tabId}.webm`) : path2.join(RECORDINGS_DIR, `${req.params.id}.webm`);
      if (!fs2.existsSync(videoFile)) return res.status(404).json({ error: "No video file found" });
      const videoStartTimes = recording.videoStartTimes || {};
      const videoStart = tabId && videoStartTimes[tabId] ? videoStartTimes[tabId] : recording.videoStartTime ?? recording.startTime;
      const offsetSec = Math.max(0, (targetTs - videoStart) / 1e3).toFixed(3);
      res.setHeader("Content-Type", "image/png");
      const ffmpeg = exec(
        `ffmpeg -ss ${offsetSec} -i "${videoFile}" -vframes 1 -f image2 -vcodec png pipe:1`,
        { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
        (err, stdout) => {
          if (err) {
            if (!res.headersSent) res.status(500).json({ error: err.message });
            return;
          }
          res.end(stdout);
        }
      );
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/rrweb-player", (_req, res) => {
    const viewPath = path2.join(__dirname2, "views", "rrweb-player.html");
    if (fs2.existsSync(viewPath)) {
      res.sendFile(viewPath);
    } else {
      res.status(404).send("rrweb player not found");
    }
  });
  app.use("/public", express.static(path2.join(__dirname2, "public")));
  app.get("/review", async (req, res) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const results = await recordings.find({}, { projection: { _id: 0, rrwebEvents: 0 } }).sort({ createdAt: -1 }).limit(50).toArray();
      const rows = results.map((r) => `
        <tr>
          <td><a href="/review/${r.id}">${r.title || "Untitled"}</a></td>
          <td>${new Date(r.startTime).toLocaleString()}</td>
          <td>${Math.round((r.duration || 0) / 1e3)}s</td>
          <td>${r.pages?.length || 0} pages</td>
          <td>${r.rrwebEventCount || 0} DOM / ${r.networkEntryCount || 0} net</td>
          <td>${r.videoPath ? "\u2713" : "\u2014"}</td>
          <td><a href="/review/${r.id}">Review</a></td>
        </tr>`).join("");
      res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recordings</title>
        <style>body{font-family:sans-serif;max-width:1200px;margin:40px auto;padding:0 20px}
        table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #ddd}
        th{background:#f5f5f5;font-weight:600}a{color:#6f42c1;text-decoration:none}
        a:hover{text-decoration:underline}h1{color:#1a1a1a}</style></head>
        <body><h1>Session Recordings</h1>
        <table><thead><tr><th>Title</th><th>Date</th><th>Duration</th><th>Pages</th><th>Events</th><th>Video</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7">No recordings yet</td></tr>'}</tbody></table></body></html>`);
    } catch (err) {
      res.status(500).send("Error: " + err.message);
    }
  });
  app.get("/review/:id", async (req, res) => {
    try {
      const viewPath = path2.join(__dirname2, "views", "review.html");
      if (fs2.existsSync(viewPath)) {
        res.sendFile(viewPath);
      } else {
        res.status(404).send("Review UI not found");
      }
    } catch (err) {
      res.status(500).send("Error: " + err.message);
    }
  });
  const httpMcpServer = await createServerWithoutWebSocket({
    name: appConfig.name,
    version: package_default.version,
    tools: snapshotTools,
    resources
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: void 0
    // Stateless mode
  });
  await httpMcpServer.connect(transport);
  app.post("/mcp", requireLan, (req, res) => {
    console.log(`[HTTP] New MCP request from ${req.ip}`);
    transport.handleRequest(req, res, req.body);
  });
  const httpServer = app.listen(port, () => {
    console.log(`[HTTP] Browser MCP server listening on http://localhost:${port}`);
    console.log(`[HTTP] MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`[HTTP] Health check: http://localhost:${port}/health`);
    console.log(`[HTTP] Install page:  http://localhost:${port}/install`);
    console.log(`[HTTP] Auth policy:   ${isAuthEnabled() ? "LAN open, remote requires API key (UNIBROWSE_API_KEYS set)" : "open (no UNIBROWSE_API_KEYS \u2014 all clients allowed)"}`);
    const trustedProxies = (process.env.UNIBROWSE_TRUSTED_PROXIES || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (trustedProxies.length === 0) {
      console.warn(
        "[HTTP] \u26A0\uFE0F  UNIBROWSE_TRUSTED_PROXIES is EMPTY. If this server is reachable via a reverse proxy (browser.pushbuild.com \u2192 nginx on server4), that proxy's traffic will now be classified by its PRIVATE peer address, i.e. as LAN \u2014 bypassing the API key and exposing /mcp. Set it to the proxy's NIC address(es). See EXTRA_TRUSTED_PROXIES in src/utils/auth.ts."
      );
    } else {
      console.log(`[HTTP] Trusted proxies: ${trustedProxies.join(", ")} (their X-Forwarded-For is authoritative; removing one fails toward LAN \u2014 see src/utils/auth.ts)`);
    }
  });
  const { createWebSocketServerFromHTTP } = await import("./ws-S7OJF7HG.js");
  const wss = createWebSocketServerFromHTTP(httpServer);
  const WS_HEARTBEAT_MS = 3e4;
  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });
  });
  const wsHeartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client;
      if (ws.isAlive === false) {
        try {
          ws.terminate();
        } catch {
        }
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
      }
    }
  }, WS_HEARTBEAT_MS);
  wss.on("close", () => clearInterval(wsHeartbeat));
  await createServerWithTools({
    name: appConfig.name,
    version: package_default.version,
    tools: snapshotTools,
    resources,
    wss
    // Pass the WebSocket server
  });
  console.log(`[HTTP] WebSocket endpoint: ws://localhost:${port}/ws`);
  console.log(`[HTTP] Combined HTTP + WebSocket server ready`);
}
main().catch((error) => {
  console.error("[HTTP] Fatal error:", error);
  process.exit(1);
});
