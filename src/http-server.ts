#!/usr/bin/env node
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import { appConfig } from "@/config/app.config";

import type { Resource } from "@/resources/resource";
import { createServerWithTools, createServerWithoutWebSocket } from "@/server";
import * as bookmarks from "@/tools/bookmarks";
import * as clipboard from "@/tools/clipboard";
import * as common from "@/tools/common";
import * as cookies from "@/tools/cookies";
import * as custom from "@/tools/custom";
import * as downloads from "@/tools/downloads";
import * as extensions from "@/tools/extensions";
import * as exploration from "@/tools/exploration";
import * as forms from "@/tools/forms";
import * as history from "@/tools/history";
import * as interactions from "@/tools/interactions";
import * as network from "@/tools/network";
import * as snapshot from "@/tools/snapshot";
import * as system from "@/tools/system";
import * as tabs from "@/tools/tabs";
import * as userAction from "@/tools/user-action";
import * as macros from "@/tools/macros";
import * as realisticInput from "@/tools/realistic-input";
import * as multiTabManagement from "@/tools/multi-tab-management";
import type { Tool } from "@/tools/tool";

import packageJSON from "../package.json";

const commonTools: Tool[] = [
  common.pressKey,
  common.scroll,
  common.scrollToElement,
  common.wait,
];

const customTools: Tool[] = [
  custom.evaluate,
  custom.getConsoleLogs,
  custom.getNetworkLogs,
  custom.screenshot,
];

const explorationTools: Tool[] = [
  exploration.queryDOM,
  exploration.getVisibleText,
  exploration.getComputedStyles,
  exploration.checkVisibility,
  exploration.getAttributes,
  exploration.countElements,
  exploration.getPageMetadata,
  exploration.getFilteredAriaTree,
  exploration.findByText,
  exploration.getFormValues,
  exploration.checkElementState,
];

const tabTools: Tool[] = [
  tabs.listTabs,
  tabs.switchTab,
  tabs.createTab,
  tabs.closeTab,
  tabs.createWindow,
];

const formTools: Tool[] = [
  forms.fillForm,
  forms.submitForm,
];

const recordingTools: Tool[] = [
  userAction.requestUserAction(false),
];

const interactionTools: Tool[] = [
  interactions.getInteractions,
  interactions.pruneInteractions,
  interactions.searchInteractions,
];

const cookieTools: Tool[] = [
  cookies.getCookies,
  cookies.setCookie,
  cookies.deleteCookie,
  cookies.clearCookies,
];

const downloadTools: Tool[] = [
  downloads.downloadFile,
  downloads.getDownloads,
  downloads.cancelDownload,
  downloads.openDownload,
];

const clipboardTools: Tool[] = [
  clipboard.getClipboard,
  clipboard.setClipboard,
];

const historyTools: Tool[] = [
  history.searchHistory,
  history.getHistoryVisits,
  history.deleteHistory,
  history.clearHistory,
];

const systemTools: Tool[] = [
  system.getVersion,
  system.getSystemInfo,
  system.getBrowserInfo,
];

const networkTools: Tool[] = [
  network.getNetworkState,
  network.setNetworkConditions,
  network.clearCache,
];

const bookmarkTools: Tool[] = [
  bookmarks.getBookmarks,
  bookmarks.createBookmark,
  bookmarks.deleteBookmark,
  bookmarks.searchBookmarks,
];

const extensionTools: Tool[] = [
  extensions.listExtensions,
  extensions.getExtensionInfo,
  extensions.enableExtension,
  extensions.disableExtension,
];

const macroTools: Tool[] = [
  macros.storeMacro,
  macros.listMacros,
  macros.executeMacro,
  macros.updateMacro,
  macros.deleteMacro,
];

const realisticInputTools: Tool[] = [
  realisticInput.realisticMouseMove,
  realisticInput.realisticClick,
  realisticInput.realisticType,
];

const multiTabTools: Tool[] = [
  multiTabManagement.listAttachedTabs,
  multiTabManagement.setTabLabel,
  multiTabManagement.detachTab,
  multiTabManagement.getActiveTab,
  multiTabManagement.attachTab,
];

const snapshotTools: Tool[] = [
  common.navigate(false),
  common.goBack(false),
  common.goForward(false),
  snapshot.snapshot,
  snapshot.click,
  snapshot.drag,
  snapshot.hover,
  snapshot.type,
  snapshot.selectOption,
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
];

const resources: Resource[] = [];

// Create server with WebSocket for Chrome extension
async function createServerWithWebSocket(): Promise<Server> {
  return createServerWithTools({
    name: appConfig.name,
    version: packageJSON.version,
    tools: snapshotTools,
    resources,
  });
}

async function main() {
  const app = express();
  app.use(express.json());

  const port = parseInt(process.env.PORT || "9010");

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", version: packageJSON.version });
  });

  // Create HTTP MCP server with Streamable HTTP transport
  const httpMcpServer = await createServerWithoutWebSocket({
    name: appConfig.name,
    version: packageJSON.version,
    tools: snapshotTools,
    resources,
  });

  // Create transport instance - stateless mode (no session ID)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode
  });

  // Connect MCP server to transport
  await httpMcpServer.connect(transport);

  // MCP endpoint - delegates to transport.handleRequest()
  app.post("/mcp", (req, res) => {
    console.log(`[HTTP] New MCP request from ${req.ip}`);
    transport.handleRequest(req, res, req.body);
  });

  // Start HTTP server
  const httpServer = app.listen(port, () => {
    console.log(`[HTTP] Browser MCP server listening on http://localhost:${port}`);
    console.log(`[HTTP] MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`[HTTP] Health check: http://localhost:${port}/health`);
  });

  // Create WebSocket server on the same HTTP server
  const { createWebSocketServerFromHTTP } = await import("@/ws");
  const wss = createWebSocketServerFromHTTP(httpServer);

  // Create MCP server with WebSocket for Chrome extension
  await createServerWithTools({
    name: appConfig.name,
    version: packageJSON.version,
    tools: snapshotTools,
    resources,
    wss, // Pass the WebSocket server
  });

  console.log(`[HTTP] WebSocket endpoint: ws://localhost:${port}/ws`);
  console.log(`[HTTP] Combined HTTP + WebSocket server ready`);
}

main().catch((error) => {
  console.error("[HTTP] Fatal error:", error);
  process.exit(1);
});
