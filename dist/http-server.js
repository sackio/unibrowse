#!/usr/bin/env node
import {
  appConfig,
  cancelDownload,
  checkElementState,
  checkVisibility,
  clearCache,
  clearCookies,
  clearHistory,
  click,
  closeTab,
  countElements,
  createBookmark,
  createServerWithTools,
  createServerWithoutWebSocket,
  createTab,
  deleteBookmark,
  deleteCookie,
  deleteHistory,
  deleteMacro,
  disableExtension,
  downloadFile,
  drag,
  enableExtension,
  evaluate,
  executeMacro,
  fillForm,
  findByText,
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
  getNetworkLogs,
  getNetworkState,
  getPageMetadata,
  getSystemInfo,
  getVersion,
  getVisibleText,
  goBack,
  goForward,
  hover,
  listExtensions,
  listMacros,
  listTabs,
  navigate,
  openDownload,
  package_default,
  pressKey,
  pruneInteractions,
  queryDOM,
  realisticClick,
  realisticMouseMove,
  realisticType,
  requestUserAction,
  screenshot,
  scroll,
  scrollToElement,
  searchBookmarks,
  searchHistory,
  searchInteractions,
  selectOption,
  setClipboard,
  setCookie,
  setNetworkConditions,
  snapshot,
  storeMacro,
  submitForm,
  switchTab,
  type,
  updateMacro,
  wait
} from "./chunk-PT4C6M2D.js";
import "./chunk-ITTVOQ2V.js";

// src/http-server.ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
var commonTools = [
  pressKey,
  scroll,
  scrollToElement,
  wait
];
var customTools = [
  evaluate,
  getConsoleLogs,
  getNetworkLogs,
  screenshot
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
  closeTab
];
var formTools = [
  fillForm,
  submitForm
];
var recordingTools = [
  requestUserAction(false)
];
var interactionTools = [
  getInteractions,
  pruneInteractions,
  searchInteractions
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
  getBrowserInfo
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
  executeMacro,
  updateMacro,
  deleteMacro
];
var realisticInputTools = [
  realisticMouseMove,
  realisticClick,
  realisticType
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
  ...realisticInputTools
];
var resources = [];
async function main() {
  const app = express();
  app.use(express.json());
  const port = parseInt(process.env.PORT || "9010");
  app.get("/health", (req, res) => {
    res.json({ status: "ok", version: package_default.version });
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
  app.post("/mcp", (req, res) => {
    console.log(`[HTTP] New MCP request from ${req.ip}`);
    transport.handleRequest(req, res, req.body);
  });
  const httpServer = app.listen(port, () => {
    console.log(`[HTTP] Browser MCP server listening on http://localhost:${port}`);
    console.log(`[HTTP] MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`[HTTP] Health check: http://localhost:${port}/health`);
  });
  const { createWebSocketServerFromHTTP } = await import("./ws-NVCKGOAZ.js");
  const wss = createWebSocketServerFromHTTP(httpServer);
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
