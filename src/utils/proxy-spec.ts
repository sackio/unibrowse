/**
 * Proxy spec parsing for browser_launch_isolated_chrome.
 *
 * Its own module for the same reason as dead-profiles.ts: chrome-launcher.ts
 * imports the "@/types" path alias, which the bare `node --test` runner cannot
 * resolve, so anything that needs a unit test cannot live in there.
 *
 * ⚠️ MIRRORED IN `chromium-host/server.js` (parseProxySpec/buildProxyBypassList).
 * That is a separate container with no build step and no access to this tree's
 * aliases, so the logic is duplicated rather than imported. If you change the
 * accepted grammar here, change it there too — a sidecar that accepts a spec
 * this file rejects (or vice versa) means the proxy applies on one launch path
 * and not the other, which presents as an intermittent exit IP.
 */

/** Schemes chromium accepts on --proxy-server. */
const SCHEMES = ["http", "https", "socks4", "socks5"] as const;

/**
 * Validate and normalise a proxy spec.
 *
 * ⛔ THROWS rather than returning a fallback. An unproxied launch is the one
 * outcome a caller cannot detect: the browser comes up, every page loads, and
 * only the exit IP is wrong — which is the entire thing they asked for. A
 * silent default here would fail toward "healthy".
 *
 * ⛔ Rejects credentials (`user:pass@host`). chromium does not use them on this
 * flag (it prompts instead), and accepting them would put a secret on a command
 * line that `ps` shows to every process on the host.
 */
export function parseProxySpec(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("proxy must be a non-empty string, e.g. 'http://172.17.0.1:18889'");
  }
  const spec = raw.trim();

  // A value starting with '-' would be read by chromium as another flag. spawn()
  // takes an argv array so there is no shell to escape, but argv injection into
  // chromium's own parser is still argv injection.
  if (spec.startsWith("-")) {
    throw new Error(`proxy may not start with '-' (got ${JSON.stringify(spec)}) — that is a flag, not a host`);
  }
  if (/[\s;'"|&$`\\<>(){}]/.test(spec)) {
    throw new Error(`proxy contains forbidden characters: ${JSON.stringify(spec)}`);
  }
  if (spec.includes("@")) {
    throw new Error(
      "proxy may not carry credentials — chromium ignores them on --proxy-server and a command " +
      "line is world-readable via ps. Use an unauthenticated local exit.",
    );
  }

  let scheme = "";
  let hostPort = spec;
  const schemeSplit = spec.indexOf("://");
  if (schemeSplit !== -1) {
    scheme = spec.slice(0, schemeSplit).toLowerCase();
    hostPort = spec.slice(schemeSplit + 3);
    if (!(SCHEMES as readonly string[]).includes(scheme)) {
      throw new Error(`proxy scheme must be one of ${SCHEMES.join(", ")} (got ${JSON.stringify(scheme)})`);
    }
  }
  if (hostPort.includes("/")) {
    throw new Error(`proxy must be host:port with no path (got ${JSON.stringify(spec)})`);
  }

  // Split host from port, tolerating a bracketed IPv6 literal.
  let host: string;
  let portStr: string;
  const v6 = hostPort.match(/^\[([0-9A-Fa-f:]+)\]:(\d+)$/);
  if (v6) {
    host = `[${v6[1]}]`;
    portStr = v6[2];
  } else {
    const idx = hostPort.lastIndexOf(":");
    if (idx === -1) {
      throw new Error(`proxy must include a port, e.g. 'http://127.0.0.1:18889' (got ${JSON.stringify(spec)})`);
    }
    host = hostPort.slice(0, idx);
    portStr = hostPort.slice(idx + 1);
    if (!/^[A-Za-z0-9.\-_]+$/.test(host)) {
      throw new Error(`proxy host is not a hostname or IPv4 literal: ${JSON.stringify(host)}`);
    }
  }
  if (host === "") throw new Error(`proxy is missing a host: ${JSON.stringify(spec)}`);
  if (!/^\d+$/.test(portStr)) {
    throw new Error(`proxy port must be numeric (got ${JSON.stringify(portStr)})`);
  }
  const port = Number(portStr);
  if (port < 1 || port > 65535) {
    throw new Error(`proxy port out of range 1-65535 (got ${port})`);
  }
  return scheme ? `${scheme}://${host}:${port}` : `${host}:${port}`;
}

/**
 * Hosts that must never be proxied.
 *
 * ⚠️ THE mcp-server HOST IS THE LOAD-BEARING ENTRY and it is appended whether or
 * not the caller kept the default. A killswitch VPN (gluetun, per `scripts`
 * 2026-10-02) blocks LAN egress, so proxying the extension's own WebSocket to
 * the server does not merely add a hop — it FAILS the connection. The extension
 * then never registers and the launch reads as "the proxy is broken", which is
 * the most expensive possible way to learn about a bypass-list mistake.
 */
const DEFAULT_BYPASS = [
  "localhost",
  "127.0.0.1",
  "[::1]",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
];

/**
 * Build the --proxy-bypass-list value.
 *
 * @param override caller's list, which REPLACES the defaults (it does not merge)
 * @param serverHint ws:// or http:// URL of the mcp-server; its host is always added
 */
export function buildProxyBypassList(override: string | undefined, serverHint?: string): string {
  const base = override && override.trim() !== ""
    ? override.split(";").map((s) => s.trim()).filter(Boolean)
    : [...DEFAULT_BYPASS];

  const serverHost = proxyHostFromUrl(serverHint);
  if (serverHost && !base.some((e) => e.toLowerCase() === serverHost.toLowerCase())) {
    base.push(serverHost);
  }
  return base.join(";");
}

/** Hostname out of a ws:/wss:/http:/https: URL, or "" when it cannot be read. */
export function proxyHostFromUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url.replace(/^ws/, "http")).hostname;
  } catch {
    return "";
  }
}
