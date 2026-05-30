// Options page: lets the user override SERVER_URL + API_KEY at runtime,
// test the connection, and reset back to baked-in/localhost defaults.

const STORAGE_KEY = 'unibrowse_server_config';

const $ = (id) => document.getElementById(id);

function setStatus(kind, msg) {
  const el = $('status');
  el.className = 'status ' + kind;
  el.textContent = msg;
}

async function loadCurrent() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const cfg = stored[STORAGE_KEY] || {};
  $('server-url').value = cfg.SERVER_URL || '';
  $('api-key').value = cfg.API_KEY || '';

  // Show the active resolved config for context (what background.js will use)
  const baked = (typeof self !== 'undefined' && self.UNIBROWSE_CONFIG) || null;
  let bakedLine = 'none';
  if (baked && baked.SERVER_URL) {
    bakedLine = `${baked.SERVER_URL} (installed ${baked.INSTALLED_AT || 'unknown'})`;
  }
  $('current-config').innerHTML =
    `<strong>Override (stored):</strong> ${cfg.SERVER_URL ? `<code>${escapeHtml(cfg.SERVER_URL)}</code>` : '<em>not set</em>'}<br>` +
    `<strong>Baked default:</strong> <code>${escapeHtml(bakedLine)}</code><br>` +
    `<strong>Fallback:</strong> <code>http://localhost:9010</code>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normalizeServerUrl(raw) {
  let u = raw.trim();
  if (!u) return '';
  // If user just gives a host:port, assume http
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  // Strip trailing slash
  u = u.replace(/\/+$/, '');
  return u;
}

async function save() {
  const serverUrl = normalizeServerUrl($('server-url').value);
  const apiKey = $('api-key').value.trim();

  if (!serverUrl && !apiKey) {
    // Both empty → clear the override entirely
    await chrome.storage.local.remove(STORAGE_KEY);
    setStatus('ok', 'Override cleared — extension will use baked-in / localhost defaults on next connect.');
  } else {
    await chrome.storage.local.set({
      [STORAGE_KEY]: { SERVER_URL: serverUrl, WS_URL: '', API_KEY: apiKey },
    });
    setStatus('ok', `Saved. Reconnecting to ${serverUrl || '(baked default)'}…`);
  }

  // Ask the background service worker to drop the current connection and reconnect
  try {
    await chrome.runtime.sendMessage({ type: 'RECONNECT_WS' });
  } catch (err) {
    // Background not listening for this yet — the user can just reload the extension
    setStatus('info', 'Saved. Reload the extension (chrome://extensions → reload) for the new server settings to take effect.');
  }

  await loadCurrent();
}

async function testConnection() {
  setStatus('info', 'Testing /health…');
  const serverUrl = normalizeServerUrl($('server-url').value);
  const apiKey = $('api-key').value.trim();
  // If user hasn't typed anything, test the currently-active config
  let target = serverUrl;
  if (!target) {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    target = (stored[STORAGE_KEY] && stored[STORAGE_KEY].SERVER_URL)
          || (self.UNIBROWSE_CONFIG && self.UNIBROWSE_CONFIG.SERVER_URL)
          || 'http://localhost:9010';
  }
  try {
    const headers = apiKey ? { 'Authorization': 'Bearer ' + apiKey } : {};
    const resp = await fetch(target + '/health', { headers });
    if (!resp.ok) {
      setStatus('err', `HTTP ${resp.status} from ${target}/health`);
      return;
    }
    const data = await resp.json();
    setStatus('ok', `OK — ${target} v${data.version || '?'} (auth ${data.authRequired ? 'required' : 'open'})`);
  } catch (err) {
    setStatus('err', 'Failed: ' + (err.message || err));
  }
}

async function reset() {
  await chrome.storage.local.remove(STORAGE_KEY);
  $('server-url').value = '';
  $('api-key').value = '';
  setStatus('ok', 'Cleared. Extension will use baked-in / localhost defaults.');
  try { await chrome.runtime.sendMessage({ type: 'RECONNECT_WS' }); } catch {}
  await loadCurrent();
}

document.addEventListener('DOMContentLoaded', () => {
  loadCurrent().catch(err => setStatus('err', 'Failed to load current config: ' + err.message));
  $('save').addEventListener('click', save);
  $('test').addEventListener('click', testConnection);
  $('reset').addEventListener('click', reset);
});
