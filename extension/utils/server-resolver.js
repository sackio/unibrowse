/**
 * Resolve the active unibrowse server URL + API key at runtime.
 *
 * Resolution priority:
 *   1. chrome.storage.local — user override set via the options page
 *   2. self.UNIBROWSE_CONFIG (from config.js) — values baked in at /install download time
 *   3. ws://localhost:9010/ws  — fallback for source-loaded dev installs
 *
 * Returns { httpUrl, wsUrl, apiKey, source } where source is one of
 * "storage" | "baked" | "fallback" for debugging/UI.
 */

const STORAGE_KEY = 'unibrowse_server_config';
const FALLBACK_HTTP = 'http://localhost:9010';
const FALLBACK_WS = 'ws://localhost:9010/ws';

function deriveWsFromHttp(httpUrl) {
  try {
    const u = new URL(httpUrl);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/ws';
    return u.toString();
  } catch {
    return FALLBACK_WS;
  }
}

function withKey(wsUrl, key) {
  if (!key) return wsUrl;
  try {
    const u = new URL(wsUrl);
    u.searchParams.set('key', key);
    return u.toString();
  } catch {
    // best-effort fallback for non-URL-parseable strings
    const sep = wsUrl.includes('?') ? '&' : '?';
    return `${wsUrl}${sep}key=${encodeURIComponent(key)}`;
  }
}

async function resolveServerConfig() {
  // 1. chrome.storage.local override (set by options page)
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const cfg = stored?.[STORAGE_KEY];
    if (cfg && (cfg.SERVER_URL || cfg.WS_URL)) {
      const httpUrl = cfg.SERVER_URL || '';
      const wsUrl = cfg.WS_URL || (httpUrl ? deriveWsFromHttp(httpUrl) : FALLBACK_WS);
      return {
        httpUrl: httpUrl || FALLBACK_HTTP,
        wsUrl: withKey(wsUrl, cfg.API_KEY || ''),
        apiKey: cfg.API_KEY || '',
        source: 'storage',
      };
    }
  } catch (err) {
    console.log('[resolveServerConfig] storage read failed (extension reloading?):', err?.message || err);
  }

  // 2. Baked-in config.js (populated by /install/extension.zip on the server)
  const baked = self.UNIBROWSE_CONFIG;
  if (baked && (baked.SERVER_URL || baked.WS_URL)) {
    const httpUrl = baked.SERVER_URL || '';
    const wsUrl = baked.WS_URL || (httpUrl ? deriveWsFromHttp(httpUrl) : FALLBACK_WS);
    return {
      httpUrl: httpUrl || FALLBACK_HTTP,
      wsUrl: withKey(wsUrl, baked.API_KEY || ''),
      apiKey: baked.API_KEY || '',
      source: 'baked',
    };
  }

  // 3. Localhost fallback
  return {
    httpUrl: FALLBACK_HTTP,
    wsUrl: FALLBACK_WS,
    apiKey: '',
    source: 'fallback',
  };
}

/** Persist a user-supplied override. Pass null to clear. */
async function setServerConfig(cfg) {
  if (cfg === null) {
    await chrome.storage.local.remove(STORAGE_KEY);
    return;
  }
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      SERVER_URL: cfg.SERVER_URL || '',
      WS_URL: cfg.WS_URL || '',
      API_KEY: cfg.API_KEY || '',
    },
  });
}

/** Return headers needed for authenticated fetch() calls to the server. */
async function getAuthHeaders() {
  const { apiKey } = await resolveServerConfig();
  return apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
}

self.resolveServerConfig = resolveServerConfig;
self.setServerConfig = setServerConfig;
self.getAuthHeaders = getAuthHeaders;
