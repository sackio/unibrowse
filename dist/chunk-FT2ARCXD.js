var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/ws.ts
import { WebSocketServer } from "ws";

// src/config/mcp.config.ts
var mcpConfig = {
  defaultWsPort: 9009,
  // Legacy: Standalone WebSocket port
  defaultHttpPort: 9010,
  // Combined HTTP + WebSocket server port
  errors: {
    noConnectedTab: "No tab is connected"
  }
};

// src/utils/helpers.ts
async function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

// src/utils/port.ts
import { execSync } from "child_process";
import net from "net";
async function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port);
  });
}
function killProcessOnPort(port) {
  try {
    if (process.platform === "win32") {
      execSync(
        `FOR /F "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a`
      );
    } else {
      execSync(`lsof -ti:${port} | xargs -r kill -9 2>/dev/null || true`);
    }
  } catch (error) {
  }
}

// src/ws.ts
async function createWebSocketServer(port = mcpConfig.defaultWsPort) {
  killProcessOnPort(port);
  while (await isPortInUse(port)) {
    await wait(100);
  }
  return new WebSocketServer({ port });
}
function createWebSocketServerFromHTTP(httpServer) {
  return new WebSocketServer({
    server: httpServer,
    path: "/ws"
    // WebSocket endpoint at /ws
  });
}

export {
  __require,
  mcpConfig,
  createWebSocketServer,
  createWebSocketServerFromHTTP
};
