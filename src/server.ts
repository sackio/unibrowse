import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { WebSocketServer, WebSocket } from "ws";

import { Context } from "@/context";
import type { Resource } from "@/resources/resource";
import type { Tool } from "@/tools/tool";
import { createWebSocketServer } from "@/ws";

type Options = {
  name: string;
  version: string;
  tools: Tool[];
  resources: Resource[];
  wss?: WebSocketServer; // Optional WebSocketServer
};

// Shared context for all servers (WebSocket and HTTP)
const globalContext = new Context();

// Create server with WebSocket for browser extension
export async function createServerWithTools(options: Options): Promise<Server> {
  const { name, version, tools, resources, wss: providedWss } = options;
  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // Helper to handle WebSocket messages manually (browser extension uses custom protocol)
  async function handleBrowserMessage(ws: WebSocket, message: any) {
    const { id, type, payload } = message;

    // Handle extension registration
    if (type === 'EXTENSION_REGISTER') {
      console.log(`[Server] Extension registered, storing as primary browser connection`);
      globalContext.ws = ws;
      return;
    }

    // If message type is 'messageResponse', it's a response from the extension (not a request)
    // The tool communication system will handle these via the message listener
    if (type === 'messageResponse') {
      // These are handled by the addSocketMessageResponseListener in messaging-sender.ts
      return;
    }

    // If no type at all, it's invalid
    if (!type) {
      console.warn(`[Server] Message without type field: ${JSON.stringify(message)}`);
      return;
    }

    console.log(`[Server] Handling tool request: ${type} (id: ${id})`);

    try {
      // Find the matching tool
      const tool = tools.find((t) => t.schema.name === type);
      if (!tool) {
        console.warn(`[Server] Unknown tool: ${type}`);
        ws.send(JSON.stringify({ id, error: `Unknown tool: ${type}` }));
        return;
      }

      // Execute the tool
      const toolResult = await tool.handle(globalContext, payload || {});

      // Send response in messageResponse format (for test clients)
      ws.send(JSON.stringify({
        type: 'messageResponse',
        payload: {
          requestId: id,
          result: toolResult
        }
      }));
    } catch (error) {
      console.error(`[Server] Tool execution error:`, error);
      ws.send(JSON.stringify({
        type: 'messageResponse',
        payload: {
          requestId: id,
          error: String(error)
        }
      }));
    }
  }

  // Track multiple WebSocket connections
  const connections = new Set<WebSocket>();

  // Use provided WebSocketServer or create a new one
  const wss = providedWss || await createWebSocketServer();
  wss.on("connection", (websocket) => {
    console.log("[Server] New WebSocket connection established");
    connections.add(websocket);
    console.log(`[Server] Total active connections: ${connections.size}`);

    // NOTE: We don't store this connection in globalContext.ws yet!
    // The extension will send an EXTENSION_REGISTER message to identify itself,
    // and only that connection will be stored in globalContext.ws.
    // This prevents external clients (like test scripts) from overwriting the extension connection.

    // Handle incoming messages
    websocket.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleBrowserMessage(websocket, message);
      } catch (error) {
        console.error("[Server] Error parsing message:", error);
      }
    });

    websocket.on("close", () => {
      console.log("[Server] WebSocket connection closed");
      connections.delete(websocket);
      console.log(`[Server] Total active connections: ${connections.size}`);

      // If this was the extension connection, clear it
      // Use hasWs() to avoid throwing error when checking
      if (globalContext.hasWs() && globalContext.ws === websocket) {
        console.log("[Server] Extension connection closed, clearing globalContext.ws");
        globalContext.ws = undefined;
      }
    });

    websocket.on("error", (error) => {
      console.error("[Server] WebSocket error:", error);
    });
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools.map((tool) => tool.schema) };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: resources.map((resource) => resource.schema) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((tool) => tool.schema.name === request.params.name);
    if (!tool) {
      return {
        content: [
          { type: "text", text: `Tool "${request.params.name}" not found` },
        ],
        isError: true,
      };
    }

    try {
      const result = await tool.handle(globalContext, request.params.arguments);
      return result;
    } catch (error) {
      return {
        content: [{ type: "text", text: String(error) }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find(
      (resource) => resource.schema.uri === request.params.uri,
    );
    if (!resource) {
      return { contents: [] };
    }

    const contents = await resource.read(globalContext, request.params.uri);
    return { contents };
  });

  server.close = async () => {
    await server.close();
    await wss.close();
    await globalContext.close();
  };

  return server;
}

// Create server WITHOUT WebSocket (for SSE connections)
export async function createServerWithoutWebSocket(options: Options): Promise<Server> {
  const { name, version, tools, resources } = options;
  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools.map((tool) => tool.schema) };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: resources.map((resource) => resource.schema) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((tool) => tool.schema.name === request.params.name);
    if (!tool) {
      return {
        content: [
          { type: "text", text: `Tool "${request.params.name}" not found` },
        ],
        isError: true,
      };
    }

    try {
      const result = await tool.handle(globalContext, request.params.arguments);
      return result;
    } catch (error) {
      return {
        content: [{ type: "text", text: String(error) }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find(
      (resource) => resource.schema.uri === request.params.uri,
    );
    if (!resource) {
      return { contents: [] };
    }

    const contents = await resource.read(globalContext, request.params.uri);
    return { contents };
  });

  return server;
}
