import type { Request, Response, NextFunction } from "express";
import type { IncomingMessage } from "http";
import { URL } from "url";

/**
 * Parse UNIBROWSE_API_KEYS env var into a Set of valid keys.
 * Empty / unset → empty set → auth disabled (backward compat for localhost-only setups).
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

export function isAuthEnabled(): boolean {
  return VALID_KEYS.size > 0;
}

export function isValidKey(key: string | null | undefined): boolean {
  if (!key) return false;
  return VALID_KEYS.has(key);
}

/**
 * Extract an API key from an HTTP request.
 * Looks at (in order): Authorization: Bearer <key>, ?key= query param, X-API-Key header.
 */
export function extractKey(req: Request | IncomingMessage): string | null {
  const headers = (req as any).headers || {};
  const auth = headers["authorization"] || headers["Authorization"];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const xKey = headers["x-api-key"] || headers["X-API-Key"];
  if (typeof xKey === "string" && xKey.length > 0) return xKey.trim();
  // Query param (works for both express Request and raw IncomingMessage)
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

/**
 * Express middleware that rejects requests without a valid API key.
 * No-ops when UNIBROWSE_API_KEYS is unset (backward compat).
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  if (!isAuthEnabled()) return next();
  const key = extractKey(req);
  if (!isValidKey(key)) {
    res.status(401).json({ error: "Invalid or missing API key. Provide Authorization: Bearer <key> or ?key=<key>." });
    return;
  }
  next();
}

/**
 * Verify a WebSocket upgrade request's API key. Returns true if auth disabled
 * or a valid key is present; false otherwise. Used by ws's verifyClient.
 */
export function verifyWebSocketAuth(req: IncomingMessage): boolean {
  if (!isAuthEnabled()) return true;
  return isValidKey(extractKey(req));
}
