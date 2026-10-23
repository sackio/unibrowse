/**
 * Proxy credentials for a sidecar profile, held in memory until its extension
 * collects them.
 *
 * ⛔ WHY THIS EXISTS AT ALL: Chrome cannot be told a proxy password. Its
 * `--proxy-server` flag takes host:port only, and `parseProxySpec` refuses a
 * spec carrying credentials on purpose — a command line is world-readable via
 * `ps`, so a lease URL on it would leak the password to every process in the
 * container. The only place that can answer a 407 is the extension, via
 * chrome.webRequest.onAuthRequired, so the credentials have to reach it.
 *
 * ⛔ THREE PLACES THEY MUST NEVER GO, and the design is shaped by each:
 *   · the command line  → so the sidecar is never told them at all; this store
 *     lives in mcp-server, and POST /launch carries host:port as before.
 *   · a URL             → so the seed page carries a single-use NONCE, not the
 *     password. A password in a URL lands in that profile's history, in this
 *     server's access log and in any Referer it sends.
 *   · a log line        → so nothing here prints a value, and the collect
 *     endpoint logs the profile name and the outcome only.
 *
 * ⚠️ The credentials DO come to rest in the profile's chrome.storage.local,
 * because the extension needs them again after its service worker restarts.
 * That is already a credential store — it holds the profile's cookies — so this
 * adds no new class of exposure. It does mean a profile directory handed to
 * someone else carries the proxy lease with it.
 */
import crypto from "crypto";

export type ProxyAuth = { username: string; password: string; proxy: string };

type Entry = ProxyAuth & { nonce: string; at: number; collected: boolean };

const BY_EID = new Map<string, Entry>();

/** A lease is short-lived; an uncollected entry is a launch that never came up. */
const TTL_MS = 12 * 60 * 60 * 1000;

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [eid, e] of BY_EID) if (e.at < cutoff) BY_EID.delete(eid);
}

/**
 * Hold credentials for `eid` and return the nonce the seed page should carry.
 * ⚠️ Replaces any previous entry for that profile: a relaunch with a new lease
 * must not be answerable with the old password, which would authenticate
 * against the wrong exit and look like a proxy fault.
 */
export function stageProxyAuth(eid: string, auth: ProxyAuth): string {
  sweep();
  const nonce = crypto.randomBytes(16).toString("hex");
  BY_EID.set(eid, { ...auth, nonce, at: Date.now(), collected: false });
  return nonce;
}

/**
 * Exchange (eid, nonce) for the credentials, once.
 *
 * ⛔ Single use, and the nonce is compared in constant time. The window between
 * a launch and its extension's first fetch is the only time this endpoint
 * answers at all, which is what keeps an eid — a value other seats legitimately
 * know and pass around — from being enough to read someone's lease.
 */
export function collectProxyAuth(eid: string, nonce: string): ProxyAuth | null {
  sweep();
  const e = BY_EID.get(eid);
  if (!e || e.collected) return null;
  const a = Buffer.from(String(nonce));
  const b = Buffer.from(e.nonce);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  e.collected = true;
  return { username: e.username, password: e.password, proxy: e.proxy };
}

/**
 * Validate what a caller handed us. ⛔ Rejects anything that cannot survive an
 * HTTP header, because a credential containing a newline is a header-injection
 * primitive, not a typo to be cleaned up.
 */
export function validateProxyAuth(raw: any, proxy: string | undefined): ProxyAuth {
  if (!raw || typeof raw !== "object") throw new Error("proxyAuth must be an object");
  const username = String(raw.username ?? "");
  const password = String(raw.password ?? "");
  if (!username) throw new Error("proxyAuth.username is required");
  if (!password) throw new Error("proxyAuth.password is required");
  if (!proxy) throw new Error("proxyAuth needs `proxy` — there is nothing to authenticate to");
  for (const [k, v] of Object.entries({ username, password })) {
    if (/[\r\n\0]/.test(v)) throw new Error(`proxyAuth.${k} may not contain a newline or NUL`);
    if (v.length > 512) throw new Error(`proxyAuth.${k} is implausibly long (${v.length})`);
  }
  return { username, password, proxy };
}
