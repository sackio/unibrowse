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

// src/utils/auth.ts
import { URL } from "url";
function loadKeys() {
  const raw = process.env.UNIBROWSE_API_KEYS || "";
  return new Set(
    raw.split(",").map((k) => k.trim()).filter((k) => k.length > 0)
  );
}
var VALID_KEYS = loadKeys();
function isAuthEnabled() {
  return VALID_KEYS.size > 0;
}
function isValidKey(key) {
  if (!key) return false;
  return VALID_KEYS.has(key);
}
function extractKey(req) {
  const headers = req.headers || {};
  const auth = headers["authorization"] || headers["Authorization"];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const xKey = headers["x-api-key"] || headers["X-API-Key"];
  if (typeof xKey === "string" && xKey.length > 0) return xKey.trim();
  let url = null;
  try {
    const rawUrl = req.originalUrl || req.url || "";
    url = new URL(rawUrl, "http://localhost");
  } catch {
  }
  if (url) {
    const k = url.searchParams.get("key");
    if (k && k.length > 0) return k;
  }
  return null;
}
function stripIPv4Mapped(ip) {
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}
function isPrivateIPv4(ip) {
  if (ip === "0.0.0.0") return true;
  if (ip.startsWith("127.")) return true;
  if (ip.startsWith("10.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("169.254.")) return true;
  return false;
}
function isPrivateIPv6(ip) {
  if (ip === "::1" || ip === "::") return true;
  if (/^fe[89ab]/i.test(ip)) return true;
  if (/^f[cd]/i.test(ip)) return true;
  return false;
}
function isLocalIP(ip) {
  if (!ip) return false;
  const n = stripIPv4Mapped(ip.trim());
  if (n.includes(":")) return isPrivateIPv6(n);
  return isPrivateIPv4(n);
}
var EXTRA_TRUSTED_PROXIES = new Set(
  (process.env.UNIBROWSE_TRUSTED_PROXIES || "").split(",").map((s) => stripIPv4Mapped(s.trim())).filter(Boolean)
);
function isTrustedProxyPeer(ip) {
  const n = stripIPv4Mapped(ip);
  if (n.startsWith("127.") || n === "::1" || n === "0.0.0.0") return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(n)) return true;
  if (EXTRA_TRUSTED_PROXIES.has(n)) return true;
  return false;
}
function getEffectiveClientIP(req) {
  const socket = req.socket || req.connection || {};
  const peer = stripIPv4Mapped(String(socket.remoteAddress || ""));
  if (isTrustedProxyPeer(peer)) {
    const headers = req.headers || {};
    const xff = headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
      const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1];
    }
  }
  return peer;
}
function isLocalClient(req) {
  return isLocalIP(getEffectiveClientIP(req));
}
function requireApiKey(req, res, next) {
  if (!isAuthEnabled()) return next();
  if (isLocalClient(req)) return next();
  const key = extractKey(req);
  if (!isValidKey(key)) {
    res.status(401).json({
      error: "Invalid or missing API key. Provide Authorization: Bearer <key> or ?key=<key>.",
      clientIp: getEffectiveClientIP(req)
    });
    return;
  }
  next();
}
function verifyWebSocketAuth(req) {
  if (!isAuthEnabled()) return true;
  if (isLocalClient(req)) return true;
  return isValidKey(extractKey(req));
}
function requireLan(req, res, next) {
  if (isLocalClient(req)) return next();
  res.status(403).json({
    error: "This endpoint is LAN-only. Remote clients are not permitted, even with a valid API key.",
    clientIp: getEffectiveClientIP(req)
  });
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
    path: "/ws",
    verifyClient: (info, cb) => {
      if (!isAuthEnabled()) return cb(true);
      if (verifyWebSocketAuth(info.req)) return cb(true);
      cb(false, 401, "Unauthorized: missing or invalid API key");
    }
  });
}

export {
  mcpConfig,
  isAuthEnabled,
  isValidKey,
  extractKey,
  getEffectiveClientIP,
  isLocalClient,
  requireApiKey,
  requireLan,
  createWebSocketServer,
  createWebSocketServerFromHTTP
};
