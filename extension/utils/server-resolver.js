/**
 * Multi-server registry + per-tab binding for the unibrowse extension.
 *
 * Storage model:
 *   chrome.storage.local
 *     unibrowse_servers           - Array<{id,name,serverUrl,apiKey}>
 *     unibrowse_default_server_id - id of the server used for unbound tabs
 *   chrome.storage.session
 *     unibrowse_tab_bindings      - { [tabId]: serverId } — per-tab override
 *
 * Baked-in defaults (from /install/extension.zip) seed the registry on first
 * use so a freshly-downloaded extension works without any manual setup.
 *
 * Resolution priority for a tab's effective server:
 *   1. Per-tab binding (chrome.storage.session)
 *   2. Default server (chrome.storage.local)
 *   3. Baked self.UNIBROWSE_CONFIG
 *   4. ws://localhost:9010 fallback
 */

const SERVERS_KEY = 'unibrowse_servers';
const DEFAULT_SERVER_KEY = 'unibrowse_default_server_id';
const TAB_BINDINGS_KEY = 'unibrowse_tab_bindings';

// Legacy keys (single-server world) — still honored for back-compat.
const LEGACY_OVERRIDE_KEY = 'unibrowse_server_config';

const FALLBACK_HTTP = 'http://localhost:9010';
const FALLBACK_WS = 'ws://localhost:9010/ws';

// ─── URL helpers ───────────────────────────────────────────────────────────

function deriveWsFromHttp(httpUrl) {
  try {
    const u = new URL(httpUrl);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/ws';
    u.search = '';
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
    const sep = wsUrl.includes('?') ? '&' : '?';
    return `${wsUrl}${sep}key=${encodeURIComponent(key)}`;
  }
}

function buildEffective(server) {
  const httpUrl = server.serverUrl || FALLBACK_HTTP;
  const wsBase = server.wsUrl || deriveWsFromHttp(httpUrl);
  return {
    id: server.id,
    name: server.name || httpUrl,
    httpUrl,
    wsUrl: withKey(wsBase, server.apiKey || ''),
    apiKey: server.apiKey || '',
  };
}

function makeId() {
  return 's_' + Math.random().toString(36).slice(2, 10);
}

// ─── Registry ──────────────────────────────────────────────────────────────

async function readRaw() {
  const data = await chrome.storage.local.get([SERVERS_KEY, DEFAULT_SERVER_KEY, LEGACY_OVERRIDE_KEY]);
  return {
    servers: data[SERVERS_KEY] || [],
    defaultId: data[DEFAULT_SERVER_KEY] || null,
    legacy: data[LEGACY_OVERRIDE_KEY] || null,
  };
}

async function writeServers(servers, defaultId) {
  await chrome.storage.local.set({
    [SERVERS_KEY]: servers,
    [DEFAULT_SERVER_KEY]: defaultId,
  });
}

/**
 * Seed the registry from baked self.UNIBROWSE_CONFIG and/or the legacy
 * single-server override the first time we run on this profile. Idempotent.
 */
async function ensureSeeded() {
  const raw = await readRaw();
  if (raw.servers.length > 0) return;
  const servers = [];
  const baked = self.UNIBROWSE_CONFIG;
  if (baked && (baked.SERVER_URL || baked.WS_URL)) {
    servers.push({
      id: 'baked',
      name: baked.INSTALLED_FROM || baked.SERVER_URL || 'Default',
      serverUrl: baked.SERVER_URL || '',
      wsUrl: baked.WS_URL || '',
      apiKey: baked.API_KEY || '',
    });
  }
  if (raw.legacy && (raw.legacy.SERVER_URL || raw.legacy.WS_URL)) {
    servers.push({
      id: 'legacy-override',
      name: raw.legacy.SERVER_URL || 'Custom',
      serverUrl: raw.legacy.SERVER_URL || '',
      wsUrl: raw.legacy.WS_URL || '',
      apiKey: raw.legacy.API_KEY || '',
    });
  }
  if (servers.length === 0) {
    servers.push({
      id: 'localhost',
      name: 'localhost (fallback)',
      serverUrl: FALLBACK_HTTP,
      wsUrl: '',
      apiKey: '',
    });
  }
  // Default = the legacy override if present, else first server
  const defaultId = servers.find(s => s.id === 'legacy-override')?.id || servers[0].id;
  await writeServers(servers, defaultId);
}

async function listServers() {
  await ensureSeeded();
  const raw = await readRaw();
  return raw.servers.slice();
}

async function getDefaultServerId() {
  await ensureSeeded();
  const raw = await readRaw();
  return raw.defaultId || (raw.servers[0]?.id || null);
}

async function setDefaultServerId(id) {
  await ensureSeeded();
  const raw = await readRaw();
  if (!raw.servers.find(s => s.id === id)) throw new Error(`Unknown server id: ${id}`);
  await writeServers(raw.servers, id);
}

async function getServerById(id) {
  const list = await listServers();
  return list.find(s => s.id === id) || null;
}

async function addServer({ name, serverUrl, apiKey, wsUrl }) {
  await ensureSeeded();
  const raw = await readRaw();
  const id = makeId();
  const server = {
    id,
    name: name || serverUrl || id,
    serverUrl: serverUrl || '',
    wsUrl: wsUrl || '',
    apiKey: apiKey || '',
  };
  const servers = [...raw.servers, server];
  await writeServers(servers, raw.defaultId || id);
  return id;
}

async function updateServer(id, patch) {
  await ensureSeeded();
  const raw = await readRaw();
  const i = raw.servers.findIndex(s => s.id === id);
  if (i < 0) throw new Error(`Unknown server id: ${id}`);
  raw.servers[i] = { ...raw.servers[i], ...patch, id };
  await writeServers(raw.servers, raw.defaultId);
}

async function removeServer(id) {
  await ensureSeeded();
  const raw = await readRaw();
  const servers = raw.servers.filter(s => s.id !== id);
  if (servers.length === 0) {
    // Refuse to remove the last server — keep at least the localhost fallback.
    return false;
  }
  let defaultId = raw.defaultId;
  if (defaultId === id) defaultId = servers[0].id;
  await writeServers(servers, defaultId);
  // Also clear any tab bindings pointing at the removed server
  const sess = await chrome.storage.session.get(TAB_BINDINGS_KEY);
  const map = sess[TAB_BINDINGS_KEY] || {};
  let dirty = false;
  for (const k of Object.keys(map)) {
    if (map[k] === id) { delete map[k]; dirty = true; }
  }
  if (dirty) await chrome.storage.session.set({ [TAB_BINDINGS_KEY]: map });
  return true;
}

// ─── Per-tab bindings ──────────────────────────────────────────────────────

async function getTabBinding(tabId) {
  if (tabId == null) return null;
  const sess = await chrome.storage.session.get(TAB_BINDINGS_KEY);
  const map = sess[TAB_BINDINGS_KEY] || {};
  return map[String(tabId)] || null;
}

async function setTabBinding(tabId, serverId) {
  if (tabId == null) return;
  const sess = await chrome.storage.session.get(TAB_BINDINGS_KEY);
  const map = sess[TAB_BINDINGS_KEY] || {};
  if (serverId) map[String(tabId)] = serverId;
  else delete map[String(tabId)];
  await chrome.storage.session.set({ [TAB_BINDINGS_KEY]: map });
}

async function clearTabBinding(tabId) {
  return setTabBinding(tabId, null);
}

async function listTabBindings() {
  const sess = await chrome.storage.session.get(TAB_BINDINGS_KEY);
  return sess[TAB_BINDINGS_KEY] || {};
}

/**
 * Resolve the effective server config for a tab — its binding if set,
 * otherwise the default. Returns { id, name, httpUrl, wsUrl, apiKey, source }.
 */
async function getServerForTab(tabId) {
  await ensureSeeded();
  const boundId = await getTabBinding(tabId);
  let server = boundId ? await getServerById(boundId) : null;
  let source = 'binding';
  if (!server) {
    const defaultId = await getDefaultServerId();
    server = defaultId ? await getServerById(defaultId) : null;
    source = 'default';
  }
  if (!server) {
    server = { id: 'fallback', name: 'localhost', serverUrl: FALLBACK_HTTP, wsUrl: '', apiKey: '' };
    source = 'fallback';
  }
  return { ...buildEffective(server), source };
}

/** Legacy back-compat: resolve the DEFAULT server config (no tab context). */
async function resolveServerConfig() {
  await ensureSeeded();
  const defaultId = await getDefaultServerId();
  const server = defaultId ? await getServerById(defaultId) : null;
  if (!server) {
    return { httpUrl: FALLBACK_HTTP, wsUrl: FALLBACK_WS, apiKey: '', source: 'fallback' };
  }
  return { ...buildEffective(server), source: 'default' };
}

/** Legacy back-compat: set the SINGLE-server override that older code uses. */
async function setServerConfig(cfg) {
  if (cfg === null) {
    await chrome.storage.local.remove(LEGACY_OVERRIDE_KEY);
    return;
  }
  await chrome.storage.local.set({
    [LEGACY_OVERRIDE_KEY]: {
      SERVER_URL: cfg.SERVER_URL || '',
      WS_URL: cfg.WS_URL || '',
      API_KEY: cfg.API_KEY || '',
    },
  });
}

/** Headers for an authenticated fetch() against a specific tab's bound server. */
async function getAuthHeadersForTab(tabId) {
  const cfg = await getServerForTab(tabId);
  return cfg.apiKey ? { 'Authorization': `Bearer ${cfg.apiKey}` } : {};
}

/** Headers for the default server (back-compat for code without a tab context). */
async function getAuthHeaders() {
  const cfg = await resolveServerConfig();
  return cfg.apiKey ? { 'Authorization': `Bearer ${cfg.apiKey}` } : {};
}

// Export to global scope for service-worker and popup/options pages
self.resolveServerConfig = resolveServerConfig;
self.setServerConfig = setServerConfig;
self.getAuthHeaders = getAuthHeaders;
self.getAuthHeadersForTab = getAuthHeadersForTab;
self.listServers = listServers;
self.addServer = addServer;
self.updateServer = updateServer;
self.removeServer = removeServer;
self.getDefaultServerId = getDefaultServerId;
self.setDefaultServerId = setDefaultServerId;
self.getServerById = getServerById;
self.getTabBinding = getTabBinding;
self.setTabBinding = setTabBinding;
self.clearTabBinding = clearTabBinding;
self.listTabBindings = listTabBindings;
self.getServerForTab = getServerForTab;
