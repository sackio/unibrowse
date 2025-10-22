import type { Server } from "http";
import { WebSocketServer } from "ws";

import { mcpConfig } from "@/config/mcp.config";
import { wait } from "@/utils/helpers";

import { isPortInUse, killProcessOnPort } from "@/utils/port";

// Create WebSocket server on a standalone port (legacy function)
export async function createWebSocketServer(
  port: number = mcpConfig.defaultWsPort,
): Promise<WebSocketServer> {
  killProcessOnPort(port);
  // Wait until the port is free
  while (await isPortInUse(port)) {
    await wait(100);
  }
  return new WebSocketServer({ port });
}

// Create WebSocket server attached to an existing HTTP server
export function createWebSocketServerFromHTTP(
  httpServer: Server,
): WebSocketServer {
  return new WebSocketServer({
    server: httpServer,
    path: "/ws" // WebSocket endpoint at /ws
  });
}
