#!/usr/bin/env node
import {
  appConfig,
  checkElementState,
  checkVisibility,
  click,
  countElements,
  createServerWithTools,
  createServerWithoutWebSocket,
  evaluate,
  findByText,
  getAttributes,
  getComputedStyles,
  getConsoleLogs,
  getFilteredAriaTree,
  getFormValues,
  getPageMetadata,
  getVisibleText,
  goBack,
  goForward,
  hover,
  navigate,
  package_default,
  pressKey,
  queryDOM,
  screenshot,
  selectOption,
  snapshot,
  type,
  wait
} from "./chunk-LPW34GRT.js";

// src/http-server.ts
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
var commonTools = [pressKey, wait];
var customTools = [
  evaluate,
  getConsoleLogs,
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
var snapshotTools = [
  navigate(false),
  goBack(false),
  goForward(false),
  snapshot,
  click,
  hover,
  type,
  selectOption,
  ...commonTools,
  ...customTools,
  ...explorationTools
];
var resources = [];
async function createServerWithWebSocket() {
  return createServerWithTools({
    name: appConfig.name,
    version: package_default.version,
    tools: snapshotTools,
    resources
  });
}
async function main() {
  const app = express();
  app.use(express.json());
  const port = parseInt(process.env.PORT || "3010");
  await createServerWithWebSocket();
  console.log("[HTTP] WebSocket server ready on ws://localhost:9009");
  app.get("/health", (req, res) => {
    res.json({ status: "ok", version: package_default.version });
  });
  app.get("/sse", async (req, res) => {
    console.log(`[HTTP] New SSE connection from ${req.ip}`);
    try {
      const server = await createServerWithoutWebSocket({
        name: appConfig.name,
        version: package_default.version,
        tools: snapshotTools,
        resources
      });
      const transport = new SSEServerTransport("/message", res);
      await server.connect(transport);
      console.log(`[HTTP] SSE server connected successfully`);
      req.on("close", () => {
        console.log(`[HTTP] SSE connection closed`);
      });
    } catch (error) {
      console.error(`[HTTP] SSE connection error:`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: String(error) });
      }
    }
  });
  app.post("/message", express.json(), (req, res) => {
    res.sendStatus(200);
  });
  app.listen(port, () => {
    console.log(`[HTTP] Browser MCP server listening on http://localhost:${port}`);
    console.log(`[HTTP] SSE endpoint: http://localhost:${port}/sse`);
    console.log(`[HTTP] Health check: http://localhost:${port}/health`);
    console.log(`[HTTP] WebSocket (extension): ws://localhost:9009`);
  });
}
main().catch((error) => {
  console.error("[HTTP] Fatal error:", error);
  process.exit(1);
});
