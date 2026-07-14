import type { Request, Response, NextFunction } from "express";
import type { IncomingMessage } from "http";
import { URL } from "url";

/**
 * Parse UNIBROWSE_API_KEYS env var into a Set of valid keys.
 * Empty / unset → empty set → auth disabled (open mode).
 */
function loadKeys(): Set<string> {
  const raw = process.env.UNIBROWSE_API_KEYS || "";
  return new Set(
    raw
      .split(",")
      .map(k => k.trim())
      .filter(k => k.length > 0)
  );
}

const VALID_KEYS = loadKeys();

/**
 * Are remote clients required to present an API key?
 * Even when true, LAN/loopback clients are always allowed without a key —
 * see isLocalClient(). To require a key from LAN clients too, callers would
 * need to call isValidKey() unconditionally instead of going through
 * requireApiKey().
 */
export function isAuthEnabled(): boolean {
  return VALID_KEYS.size > 0;
}

export function isValidKey(key: string | null | undefined): boolean {
  if (!key) return false;
  return VALID_KEYS.has(key);
}

/**
 * Extract an API key from an HTTP request.
 * Looks at (in order): Authorization: Bearer <key>, X-API-Key header, ?key= query param.
 */
export function extractKey(req: Request | IncomingMessage): string | null {
  const headers = (req as any).headers || {};
  const auth = headers["authorization"] || headers["Authorization"];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const xKey = headers["x-api-key"] || headers["X-API-Key"];
  if (typeof xKey === "string" && xKey.length > 0) return xKey.trim();
  let url: URL | null = null;
  try {
    const rawUrl = (req as any).originalUrl || (req as any).url || "";
    url = new URL(rawUrl, "http://localhost");
  } catch { /* ignore */ }
  if (url) {
    const k = url.searchParams.get("key");
    if (k && k.length > 0) return k;
  }
  return null;
}

// ─── LAN / remote classification ───────────────────────────────────────────
// Policy: LAN clients (loopback + RFC1918 + IPv6 link-local / ULA) are always
// allowed without an API key. Remote clients must present a valid key when
// UNIBROWSE_API_KEYS is set. X-Forwarded-For is honored ONLY when the immediate
// peer is loopback, so an nginx → unibrowse-on-localhost reverse proxy still
// surfaces the real (possibly remote) client IP, while a direct LAN client
// can't spoof XFF to look local from elsewhere.

function stripIPv4Mapped(ip: string): string {
  // "::ffff:192.168.1.1" → "192.168.1.1"
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

function isPrivateIPv4(ip: string): boolean {
  if (ip === "0.0.0.0") return true;
  if (ip.startsWith("127.")) return true;
  if (ip.startsWith("10.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("169.254.")) return true; // link-local
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  if (ip === "::1" || ip === "::") return true;
  // fe80::/10 link-local
  if (/^fe[89ab]/i.test(ip)) return true;
  // fc00::/7 unique local
  if (/^f[cd]/i.test(ip)) return true;
  return false;
}

export function isLocalIP(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const n = stripIPv4Mapped(ip.trim());
  if (n.includes(":")) return isPrivateIPv6(n);
  return isPrivateIPv4(n);
}

/**
 * Is this peer trusted to set X-Forwarded-For? Yes for loopback (the standard
 * nginx-on-localhost reverse-proxy pattern) and for the docker bridge gateway
 * range 172.16.0.0/12 (so a containerised server can still see the real client
 * IP forwarded by the docker-proxy or by a host-side reverse proxy). Public
 * peers are NOT trusted, so a remote client can't spoof XFF=192.168.x.x to
 * impersonate a LAN client.
 */
// Extra reverse-proxy peer IPs to trust, declared via UNIBROWSE_TRUSTED_PROXIES
// (comma-separated). Needed when the public TLS reverse proxy runs on a
// DIFFERENT host than unibrowse (e.g. server4 nginx → office:9010): the
// container then sees the proxy host's LAN NIC IP (e.g. 192.168.0.109) as the
// peer, which is private but not loopback/docker-bridge, so without this it
// would be treated as a LAN CLIENT and its X-Forwarded-For ignored — defeating
// remote/key gating. Only the specific proxy IP(s) are trusted, never a whole
// subnet.
const EXTRA_TRUSTED_PROXIES = new Set(
  (process.env.UNIBROWSE_TRUSTED_PROXIES || "")
    .split(",")
    .map(s => stripIPv4Mapped(s.trim()))
    .filter(Boolean)
);

function isTrustedProxyPeer(ip: string): boolean {
  const n = stripIPv4Mapped(ip);
  if (n.startsWith("127.") || n === "::1" || n === "0.0.0.0") return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(n)) return true;
  if (EXTRA_TRUSTED_PROXIES.has(n)) return true;
  return false;
}

/**
 * Return the effective client IP — the immediate peer's address, OR if the
 * peer is a trusted proxy, the RIGHTMOST X-Forwarded-For entry (the value
 * the closest trusted proxy actually wrote). Reading rightmost defeats a
 * "client sends fake XFF=192.168.x.x" escalation when nginx appends rather
 * than replaces the header — the fake value ends up to the left of the real
 * IP that nginx appended, and gets ignored.
 *
 * For a properly-configured nginx (`proxy_set_header X-Forwarded-For
 * $remote_addr` — replaces) the chain has only one entry and rightmost ===
 * leftmost === the real client. For an append-style nginx (`...
 * $proxy_add_x_forwarded_for`) the rightmost is still the IP nginx itself
 * wrote, which is the real client.
 */
export function getEffectiveClientIP(req: Request | IncomingMessage): string {
  const socket = (req as any).socket || (req as any).connection || {};
  const peer: string = stripIPv4Mapped(String(socket.remoteAddress || ""));
  if (isTrustedProxyPeer(peer)) {
    const headers = (req as any).headers || {};
    const xff = headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
      const parts = xff.split(",").map(s => s.trim()).filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1];
    }
  }
  return peer;
}

export function isLocalClient(req: Request | IncomingMessage): boolean {
  return isLocalIP(getEffectiveClientIP(req));
}

// ─── Middleware + WebSocket verifier ───────────────────────────────────────

/**
 * Express middleware: passes when (a) auth is disabled, (b) the client is on
 * the LAN, or (c) a valid API key is present. Otherwise 401.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  if (!isAuthEnabled()) return next();
  if (isLocalClient(req)) return next();
  const key = extractKey(req);
  if (!isValidKey(key)) {
    res.status(401).json({
      error: "Invalid or missing API key. Provide Authorization: Bearer <key> or ?key=<key>.",
      clientIp: getEffectiveClientIP(req),
    });
    return;
  }
  next();
}

/**
 * WebSocket upgrade verifier. Same policy as requireApiKey.
 */
export function verifyWebSocketAuth(req: IncomingMessage): boolean {
  if (!isAuthEnabled()) return true;
  if (isLocalClient(req)) return true;
  return isValidKey(extractKey(req));
}

/**
 * Express middleware that rejects all remote (non-LAN) clients with 403.
 * No key bypass. Used to keep endpoints like /mcp strictly LAN-local even
 * when the server is reverse-proxied to the public internet — the MCP
 * control plane is for LAN AI agents only, not remote callers.
 */
export function requireLan(req: Request, res: Response, next: NextFunction) {
  if (isLocalClient(req)) return next();
  res.status(403).json({
    error: "This endpoint is LAN-only. Remote clients are not permitted, even with a valid API key.",
    clientIp: getEffectiveClientIP(req),
  });
}
