#!/usr/bin/env node
import {
  appConfig,
  attachTab,
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
  createTab,
  createWindow,
  deleteBookmark,
  deleteCookie,
  deleteHistory,
  deleteMacro,
  detachTab,
  disableExtension,
  downloadFile,
  drag,
  enableExtension,
  evaluate,
  executeMacro,
  fillForm,
  findByText,
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
  getNetworkLogs,
  getNetworkState,
  getPageMetadata,
  getSystemInfo,
  getVersion,
  getVisibleText,
  goBack,
  goForward,
  hover,
  launchIsolatedChrome,
  listAttachedTabs,
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
  setTabLabel,
  snapshot,
  storeMacro,
  submitForm,
  switchTab,
  type,
  updateMacro,
  wait
} from "./chunk-BBUZRO7Q.js";
import "./chunk-FT2ARCXD.js";

// src/stdio-server.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { program } from "commander";
function setupExitWatchdog(server) {
  process.stdin.on("close", async () => {
    setTimeout(() => process.exit(0), 15e3);
    await server.close();
    process.exit(0);
  });
}
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
  closeTab,
  createWindow
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
  getBrowserInfo,
  launchIsolatedChrome
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
var multiTabTools = [
  listAttachedTabs,
  setTabLabel,
  detachTab,
  getActiveTab,
  attachTab
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
  ...multiTabTools
];
var resources = [];
async function createServer() {
  return createServerWithTools({
    name: appConfig.name,
    version: package_default.version,
    tools: snapshotTools,
    resources
  });
}
program.version("Version " + package_default.version).name(package_default.name).action(async () => {
  const server = await createServer();
  setupExitWatchdog(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
});
program.parse(process.argv);
