#!/usr/bin/env node
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";

import { appConfig } from "@/config/app.config";

import type { Resource } from "@/resources/resource";
import { createServerWithTools, createServerWithoutWebSocket } from "@/server";
import * as common from "@/tools/common";
import * as custom from "@/tools/custom";
import * as exploration from "@/tools/exploration";
import * as snapshot from "@/tools/snapshot";
import type { Tool } from "@/tools/tool";

import packageJSON from "../package.json";

const commonTools: Tool[] = [common.pressKey, common.wait];

const customTools: Tool[] = [
  custom.evaluate,
  custom.getConsoleLogs,
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

const snapshotTools: Tool[] = [
  common.navigate(false),
  common.goBack(false),
  common.goForward(false),
  snapshot.snapshot,
  snapshot.click,
  snapshot.hover,
  snapshot.type,
  snapshot.selectOption,
  ...commonTools,
  ...customTools,
  ...explorationTools,
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

  const port = parseInt(process.env.PORT || "3010");

  // Start WebSocket server once for Chrome extension
  await createServerWithWebSocket();
  console.log("[HTTP] WebSocket server ready on ws://localhost:9009");

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", version: packageJSON.version });
  });

  // SSE endpoint for MCP - each connection gets its own server (without WebSocket)
  app.get("/sse", async (req, res) => {
    console.log(`[HTTP] New SSE connection from ${req.ip}`);

    try {
      // Create a new server instance for this SSE connection
      // This shares the global context with the WebSocket server
      const server = await createServerWithoutWebSocket({
        name: appConfig.name,
        version: packageJSON.version,
        tools: snapshotTools,
        resources,
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

  // POST endpoint for SSE messages
  app.post("/message", express.json(), (req, res) => {
    // This is handled by SSE transport automatically
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
