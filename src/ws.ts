import type { Server, IncomingMessage } from "http";
import { WebSocketServer } from "ws";

import { mcpConfig } from "@/config/mcp.config";
import { wait } from "@/utils/helpers";

import { isPortInUse, killProcessOnPort } from "@/utils/port";
import { verifyWebSocketAuth, isAuthEnabled } from "@/utils/auth";

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

// Create WebSocket server attached to an existing HTTP server.
// When UNIBROWSE_API_KEYS is set, the WS upgrade handshake requires a valid key
// supplied via ?key=<key>, Authorization: Bearer <key>, or X-API-Key header.
export function createWebSocketServerFromHTTP(
  httpServer: Server,
): WebSocketServer {
  return new WebSocketServer({
    server: httpServer,
    path: "/ws",
    verifyClient: (
      info: { req: IncomingMessage },
      cb: (ok: boolean, code?: number, msg?: string) => void,
    ) => {
      if (!isAuthEnabled()) return cb(true);
      if (verifyWebSocketAuth(info.req)) return cb(true);
      cb(false, 401, "Unauthorized: missing or invalid API key");
    },
  });
}
