import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";

import { isAuthEnabled, isValidKey, extractKey, isLocalClient, getEffectiveClientIP } from "@/utils/auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the extension/ directory.
// In dev, src/ is at <repo>/src and extension/ is at <repo>/extension.
// In the production docker image, the entry runs from /app/dist, and extension/
// is copied to /app/extension during the image build (see Dockerfile).
function findExtensionDir(): string | null {
  const candidates = [
    path.join(__dirname, "..", "extension"),         // /app/extension when run from /app/dist
    path.join(__dirname, "..", "..", "extension"),   // <repo>/extension when run from <repo>/dist
    "/app/extension",
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    } catch { /* ignore */ }
  }
  return null;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
}

// Derive the server's externally-visible base URL from the request.
// Honors X-Forwarded-Proto / X-Forwarded-Host (reverse-proxy aware).
function deriveBaseUrl(req: Request): { http: string; ws: string } {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0].trim()
    || (req.secure ? "https" : "http");
  const host = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0].trim()
    || req.headers.host
    || "localhost:9010";
  const wsProto = proto === "https" ? "wss" : "ws";
  return { http: `${proto}://${host}`, ws: `${wsProto}://${host}` };
}

/**
 * Which Chromium fork is asking for the download — used only to word the
 * install steps, which name a page that differs per browser (`edge://extensions`
 * vs `chrome://extensions`). The visitor is by definition using the browser they
 * are about to install into, so the request's own user-agent is the right
 * signal.
 *
 * Order matters: every fork carries `Chrome/` in its UA, so a fork token has to
 * win. Brave deliberately does not identify itself and will read as Chrome —
 * acceptable here, because Brave accepts `chrome://extensions`. Getting this
 * wrong costs a slightly-off instruction, never a failed install.
 */
function detectBrowserFamily(req: Request): { name: string; scheme: string } {
  const ua = (req.headers["user-agent"] as string | undefined) || "";
  if (/\bEdgA?\//.test(ua)) return { name: "Edge", scheme: "edge" };
  if (/\bOPR\//.test(ua)) return { name: "Opera", scheme: "opera" };
  if (/\bVivaldi\//.test(ua)) return { name: "Vivaldi", scheme: "vivaldi" };
  return { name: "Chrome", scheme: "chrome" };
}

/**
 * Landing page at GET /install — public, no auth required. Shows the user the
 * download link and instructions. If auth is enabled, the URL the admin shares
 * with users carries the key as ?key=<...> and the download link inherits it.
 */
export function installLandingHandler(req: Request, res: Response) {
  const browser = detectBrowserFamily(req);
  const { http: httpBase, ws: wsBase } = deriveBaseUrl(req);
  const queryKey = (req.query.key as string | undefined) || "";
  const authOn = isAuthEnabled();
  const isLocal = isLocalClient(req);
  // Effective auth for THIS visitor — LAN clients can always download.
  const authForThisClient = authOn && !isLocal;
  const keyIsValid = authForThisClient ? isValidKey(queryKey) : true;

  const downloadHref = `/install/extension.zip${queryKey ? `?key=${encodeURIComponent(queryKey)}` : ""}`;
  const errorBanner = authForThisClient && queryKey && !keyIsValid
    ? `<div class="banner err">The provided key is not valid on this server.</div>`
    : authForThisClient && !queryKey
    ? `<div class="banner warn">This server requires an API key for remote clients. Append <code>?key=&lt;your-key&gt;</code> to this URL to enable the download.</div>`
    : "";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>unibrowse — install extension</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 780px; margin: 40px auto; padding: 0 20px; color: #222; line-height: 1.55; }
    h1 { font-size: 28px; margin-bottom: 4px; }
    .sub { color: #666; margin-bottom: 28px; }
    .banner { padding: 12px 16px; border-radius: 6px; margin: 18px 0; font-size: 14px; }
    .banner.err { background: #fee; border: 1px solid #f99; color: #800; }
    .banner.warn { background: #fff8e1; border: 1px solid #f0c060; color: #806000; }
    .download { display: inline-block; background: #6f42c1; color: white; padding: 12px 22px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 12px 0 20px; }
    .download[aria-disabled="true"] { background: #999; cursor: not-allowed; pointer-events: none; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
    pre { background: #1e1e1e; color: #eee; padding: 14px; border-radius: 6px; overflow-x: auto; }
    ol li { margin: 8px 0; }
    .meta { color: #999; font-size: 12px; margin-top: 36px; }
  </style>
</head>
<body>
  <h1>Install the unibrowse extension</h1>
  <div class="sub">This dev extension is distributed directly from your server, not a web store. It runs on any Chromium browser — Chrome, Edge, Brave, Opera, Vivaldi.</div>
  ${errorBanner}
  <a class="download" href="${downloadHref}" ${!keyIsValid ? 'aria-disabled="true"' : ""}>Download extension (.zip)</a>
  <h3>Install steps</h3>
  <ol>
    <li>Click the button above to download <code>unibrowse-extension.zip</code>.</li>
    <li>Unzip it somewhere stable (e.g. <code>~/unibrowse-extension</code>).</li>
    <li>Open <code>${browser.scheme}://extensions</code> in ${escapeHtml(browser.name)} and turn <strong>Developer mode</strong> on.</li>
    <li>Click <strong>Load unpacked</strong> and select the unzipped folder.</li>
    <li>The extension auto-connects to this server (<code>${wsBase}/ws</code>).</li>
  </ol>
  <h3>Configuration</h3>
  <p>The downloaded extension is pre-configured for this server. You can override the server URL or API key any time via the extension's <strong>Options</strong> page (Right-click the extension icon → Options).</p>
  <div class="meta">
    Server: <code>${httpBase}</code><br>
    WebSocket: <code>${wsBase}/ws</code><br>
    Auth policy: <code>${authOn ? "LAN open / remote requires API key" : "open (no key required)"}</code><br>
    You are: <code>${isLocal ? "LAN client (open access)" : "remote client (API key required)"}</code> — ${escapeHtml(getEffectiveClientIP(req))}
  </div>
</body>
</html>`);
}

/**
 * GET /install/extension.zip[?key=...] — streams a zip of extension/ with
 * config.js rewritten to contain SERVER_URL + API_KEY for this server. When
 * UNIBROWSE_API_KEYS is set, a valid key must be supplied (so users who do
 * not have one can't get a pre-configured client). When unset, downloads are
 * open (backward compat for localhost-only setups).
 */
export async function installZipHandler(req: Request, res: Response) {
  // Remote clients need a valid key; LAN clients are always allowed.
  if (isAuthEnabled() && !isLocalClient(req)) {
    const key = extractKey(req);
    if (!isValidKey(key)) {
      res.status(401).json({
        error: "Invalid or missing API key. Open /install?key=<key> to download.",
        clientIp: getEffectiveClientIP(req),
      });
      return;
    }
  }

  const extDir = findExtensionDir();
  if (!extDir) {
    res.status(500).json({ error: "Extension directory not found on server" });
    return;
  }

  const { http: httpBase, ws: wsBase } = deriveBaseUrl(req);
  const apiKey = (extractKey(req) as string | null) || "";

  // The replacement config.js — overrides whatever ships in extension/config.js
  const configContent = `// Auto-generated by /install/extension.zip on ${new Date().toISOString()}
// Server: ${httpBase}
// Edit via the extension's Options page to override at runtime.
self.UNIBROWSE_CONFIG = {
  SERVER_URL: ${JSON.stringify(httpBase)},
  WS_URL: ${JSON.stringify(`${wsBase}/ws`)},
  API_KEY: ${JSON.stringify(apiKey)},
  INSTALLED_FROM: ${JSON.stringify(httpBase)},
  INSTALLED_AT: ${JSON.stringify(new Date().toISOString())},
};
`;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="unibrowse-extension.zip"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    console.error("[install] zip error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  });
  archive.pipe(res);

  // Walk extension/ and add each file, skipping NFS lock files, backups, and dotfiles.
  // We REPLACE config.js with the generated content below, even if a config.js
  // exists in the source tree.
  const skip = (name: string): boolean => {
    if (name.startsWith(".nfs")) return true;
    if (name.endsWith(".backup")) return true;
    if (name.includes(".backup-")) return true;
    if (name === ".gitignore") return true;
    if (name === "generate-icons.js") return true; // build-time only
    return false;
  };

  function walk(dir: string, rel: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const inner = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, inner);
      } else if (entry.isFile()) {
        if (inner === "config.js") continue; // replaced below
        archive.file(abs, { name: inner });
      }
    }
  }
  walk(extDir, "");
  archive.append(configContent, { name: "config.js" });

  archive.finalize();
}
