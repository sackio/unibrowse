// Server registry management UI.

const $ = (id) => document.getElementById(id);
const status = $('status');

function setStatus(kind, msg) {
  status.className = 'status ' + kind;
  status.textContent = msg;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normalizeServerUrl(raw) {
  let u = (raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  u = u.replace(/\/+$/, '');
  return u;
}

async function renderServers() {
  const body = $('servers-body');
  body.innerHTML = '';
  const servers = await listServers();
  const defaultId = await getDefaultServerId();

  if (servers.length === 0) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#888;">No servers yet — add one below.</td></tr>';
    return;
  }

  for (const s of servers) {
    const tr = document.createElement('tr');
    if (s.id === defaultId) tr.className = 'is-default';
    const keyDisplay = s.apiKey ? `<code>${escapeHtml(s.apiKey.slice(0, 4))}…${escapeHtml(s.apiKey.slice(-4))}</code>` : '<em style="color:#aaa">(none)</em>';
    tr.innerHTML = `
      <td><strong>${escapeHtml(s.name || '(unnamed)')}</strong></td>
      <td><code>${escapeHtml(s.serverUrl || '')}</code></td>
      <td>${keyDisplay}</td>
      <td>${s.id === defaultId ? '<span class="pill default">DEFAULT</span>' : ''}</td>
      <td class="actions">
        ${s.id === defaultId ? '' : `<button class="secondary" data-action="default" data-id="${s.id}">Make default</button>`}
        <button class="secondary" data-action="test" data-id="${s.id}">Test</button>
        <button class="danger" data-action="remove" data-id="${s.id}">Remove</button>
      </td>
    `;
    body.appendChild(tr);
  }

  body.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => onAction(btn.dataset.action, btn.dataset.id));
  });
}

async function onAction(action, id) {
  try {
    const server = await getServerById(id);
    if (action === 'default') {
      await setDefaultServerId(id);
      setStatus('ok', `"${server.name}" is now the default server.`);
      await renderServers();
      // Tell the background to reconnect with the new default
      try { await chrome.runtime.sendMessage({ type: 'RECONNECT_WS' }); } catch {}
    } else if (action === 'remove') {
      if (!confirm(`Remove server "${server?.name || id}"? Tab bindings pointing at it will revert to the default.`)) return;
      const ok = await removeServer(id);
      if (!ok) {
        setStatus('err', 'Cannot remove the last server. Add another first.');
        return;
      }
      setStatus('ok', 'Server removed.');
      await renderServers();
      try { await chrome.runtime.sendMessage({ type: 'RECONNECT_WS' }); } catch {}
    } else if (action === 'test') {
      await testServer(server);
    }
  } catch (err) {
    setStatus('err', 'Error: ' + (err.message || err));
  }
}

async function testServer(server) {
  setStatus('info', `Testing ${server.name} (${server.serverUrl})…`);
  try {
    const headers = server.apiKey ? { 'Authorization': 'Bearer ' + server.apiKey } : {};
    const resp = await fetch(server.serverUrl + '/health', { headers });
    if (!resp.ok) {
      setStatus('err', `HTTP ${resp.status} from ${server.serverUrl}/health`);
      return;
    }
    const data = await resp.json();
    const requiresAuth = data.authRequired ? 'yes' : 'no';
    setStatus('ok', `OK — ${server.name} v${data.version || '?'} (this client must authenticate: ${requiresAuth})`);
  } catch (err) {
    setStatus('err', 'Failed: ' + (err.message || err));
  }
}

async function addServerFromForm() {
  const name = $('add-name').value.trim();
  const url = normalizeServerUrl($('add-url').value);
  const key = $('add-key').value.trim();
  if (!url) {
    setStatus('err', 'Please enter a server URL.');
    return;
  }
  try {
    const id = await addServer({ name: name || url, serverUrl: url, apiKey: key });
    $('add-name').value = '';
    $('add-url').value = '';
    $('add-key').value = '';
    setStatus('ok', `Added "${name || url}".`);
    await renderServers();
  } catch (err) {
    setStatus('err', 'Failed: ' + (err.message || err));
  }
}

async function testFromForm() {
  const url = normalizeServerUrl($('add-url').value);
  const key = $('add-key').value.trim();
  if (!url) {
    setStatus('err', 'Please enter a server URL to test.');
    return;
  }
  await testServer({ name: 'this URL', serverUrl: url, apiKey: key });
}

document.addEventListener('DOMContentLoaded', () => {
  renderServers().catch(err => setStatus('err', 'Failed to load: ' + err.message));
  $('add-server').addEventListener('click', addServerFromForm);
  $('add-test').addEventListener('click', testFromForm);
});
