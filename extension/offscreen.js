/**
 * Offscreen Document — maintains persistent WebSocket connections.
 *
 * Multi-WS pool: one OffscreenManager owns a Map<wsId, Conn> so the extension
 * can talk to multiple unibrowse servers simultaneously (one per known server,
 * keyed by serverId from the registry). All OFFSCREEN_* messages may include
 * an optional `wsId`; if omitted, the legacy "default" connection is used so
 * older callers and the initial bootstrap work unchanged.
 */

const DEFAULT_WS_ID = 'default';

class OffscreenManager {
  constructor() {
    /** @type {Map<string, object>} wsId -> Conn */
    this.connections = new Map();

    // Tab capture recording state — one recorder per tab (keyed by tabId or 'default')
    this.recorders = new Map();

    console.log('[Offscreen] OffscreenManager constructing...');

    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        this.handleMessage(message, sender, sendResponse);
        return true;
      });
      console.log('[Offscreen] ✓ Message listener registered successfully');
    } catch (error) {
      console.error('[Offscreen] ✗ Failed to register message listener:', error);
      return;
    }

    if (!this.isChromeAvailable()) {
      console.log('[Offscreen] Chrome APIs not fully available yet, skipping connection restore');
      return;
    }

    console.log('[Offscreen] ✓ OffscreenManager initialized with Chrome APIs available');

    setTimeout(() => { this.restoreConnection(); }, 100);
  }

  isChromeAvailable() {
    try {
      return typeof chrome !== 'undefined' &&
             chrome.runtime &&
             typeof chrome.runtime.sendMessage === 'function';
    } catch { return false; }
  }

  isStorageAvailable() {
    try {
      return typeof chrome !== 'undefined' &&
             chrome.storage &&
             chrome.storage.local &&
             typeof chrome.storage.local.get === 'function';
    } catch { return false; }
  }

  async restoreConnection() {
    try {
      if (!this.isChromeAvailable()) return;
      const defaultUrl = 'ws://localhost:9010/ws';
      console.log('[Offscreen] Auto-connecting to', defaultUrl, 'as', DEFAULT_WS_ID);
      const conn = this._getOrCreateConn(DEFAULT_WS_ID);
      conn.intentionalDisconnect = false;
      await this.connect(defaultUrl, DEFAULT_WS_ID);
    } catch (error) {
      console.log('[Offscreen] Initial connection failed, will retry:', error.message);
      this.scheduleReconnect(DEFAULT_WS_ID);
    }
  }

  // ─── Per-connection state ────────────────────────────────────────────────

  _getOrCreateConn(wsId) {
    const id = wsId || DEFAULT_WS_ID;
    if (!this.connections.has(id)) {
      this.connections.set(id, {
        wsId: id,
        ws: null,
        serverUrl: null,
        connectionState: 'disconnected',
        pendingRequests: new Map(),
        messageId: 0,
        reconnectAttempts: 0,
        reconnectDelay: 1000,
        maxReconnectDelay: 30000,
        reconnectTimer: null,
        intentionalDisconnect: false,
      });
    }
    return this.connections.get(id);
  }

  _isOpen(conn) {
    return conn && conn.ws && conn.ws.readyState === WebSocket.OPEN;
  }

  scheduleReconnect(wsId) {
    const conn = this._getOrCreateConn(wsId);
    if (conn.intentionalDisconnect) {
      console.log(`[Offscreen][${conn.wsId}] Skipping reconnect — intentional disconnect`);
      return;
    }
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    const delay = Math.min(conn.reconnectDelay * Math.pow(2, conn.reconnectAttempts), conn.maxReconnectDelay);
    conn.reconnectAttempts++;
    console.log(`[Offscreen][${conn.wsId}] Scheduling reconnect attempt #${conn.reconnectAttempts} in ${delay}ms`);
    conn.reconnectTimer = setTimeout(async () => {
      console.log(`[Offscreen][${conn.wsId}] Attempting reconnect #${conn.reconnectAttempts}...`);
      try {
        await this.connect(conn.serverUrl || 'ws://localhost:9010/ws', conn.wsId);
        conn.reconnectAttempts = 0;
        console.log(`[Offscreen][${conn.wsId}] Reconnected successfully`);
      } catch (error) {
        console.log(`[Offscreen][${conn.wsId}] Reconnect failed:`, error.message);
        this.scheduleReconnect(conn.wsId);
      }
    }, delay);
  }

  cancelReconnect(wsId) {
    const conn = this.connections.get(wsId || DEFAULT_WS_ID);
    if (!conn) return;
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }
    conn.reconnectAttempts = 0;
  }

  // ─── Message handling ────────────────────────────────────────────────────

  async handleMessage(message, sender, sendResponse) {
    if (!message.type || !message.type.startsWith('OFFSCREEN_')) return;
    const wsId = message.wsId || DEFAULT_WS_ID;
    console.log(`[Offscreen][${wsId}] Processing ${message.type}`);

    try {
      switch (message.type) {
        case 'OFFSCREEN_CONNECT':
          // Background sends extensionId here so we don't have to re-read it from
          // chrome.storage at every reconnect (which races against the SW's
          // own storage initialisation). Stash on the connection for use in
          // sendIdentification below.
          if (message.extensionId) {
            const conn = this._getOrCreateConn(wsId);
            conn.extensionId = message.extensionId;
          }
          this.connect(message.url, wsId).catch(err => {
            console.log(`[Offscreen][${wsId}] Initial connect failed (auto-reconnect):`, err.message);
          });
          sendResponse({ success: true, state: this._getOrCreateConn(wsId).connectionState });
          break;

        case 'OFFSCREEN_DISCONNECT':
          await this.disconnect(wsId);
          sendResponse({ success: true });
          break;

        case 'OFFSCREEN_SEND_MESSAGE': {
          const result = await this.sendMessage(message.messageType, message.data, message.options, wsId);
          sendResponse({ success: true, result });
          break;
        }

        case 'OFFSCREEN_SEND_MESSAGE_NO_RESPONSE':
          this.sendMessageNoResponse(message.data, wsId);
          sendResponse({ success: true });
          break;

        case 'OFFSCREEN_GET_STATE': {
          const conn = this.connections.get(wsId);
          sendResponse({
            success: true,
            state: conn?.connectionState || 'disconnected',
            connected: this._isOpen(conn),
          });
          break;
        }

        case 'OFFSCREEN_LIST_CONNECTIONS': {
          const summary = Array.from(this.connections.values()).map(c => ({
            wsId: c.wsId,
            serverUrl: c.serverUrl,
            connectionState: c.connectionState,
            open: c.ws && c.ws.readyState === WebSocket.OPEN,
          }));
          sendResponse({ success: true, connections: summary });
          break;
        }

        case 'OFFSCREEN_START_TAB_RECORDING':
          await this.startTabRecording(message.streamId, message.tabId ?? 'default');
          sendResponse({ success: true });
          break;

        case 'OFFSCREEN_STOP_TAB_RECORDING': {
          const videoData = await this.stopTabRecording(message.tabId ?? 'default');
          const bytes = new Uint8Array(videoData.arrayBuffer);
          let binary = '';
          const chunkSize = 8192;
          for (let i = 0; i < bytes.byteLength; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)));
          }
          sendResponse({ success: true, videoBase64: btoa(binary), mimeType: videoData.mimeType, byteLength: videoData.arrayBuffer.byteLength });
          break;
        }

        default:
          console.warn(`[Offscreen][${wsId}] Unknown message type:`, message.type);
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      if (!this.isChromeAvailable() || error.message?.includes('Extension context invalidated')) {
        sendResponse({ success: false, error: 'Extension context invalidated' });
      } else {
        console.error(`[Offscreen][${wsId}] Error handling message:`, error);
        sendResponse({ success: false, error: error.message });
      }
    }
  }

  // ─── connect / disconnect / send ─────────────────────────────────────────

  async connect(url, wsId = DEFAULT_WS_ID) {
    const conn = this._getOrCreateConn(wsId);
    console.log(`[Offscreen][${conn.wsId}] Connecting to`, url);

    if (this._isOpen(conn) && conn.serverUrl === url) {
      console.log(`[Offscreen][${conn.wsId}] Already connected to`, url);
      return;
    }
    if (conn.ws && conn.serverUrl !== url) {
      try { conn.ws.close(); } catch {}
      conn.ws = null;
    }

    conn.serverUrl = url;
    conn.connectionState = 'connecting';
    conn.intentionalDisconnect = false;

    return new Promise((resolve, reject) => {
      let opened = false;
      try {
        conn.ws = new WebSocket(url);

        conn.ws.onopen = () => {
          opened = true;
          console.log(`[Offscreen][${conn.wsId}] WebSocket connected`);
          conn.connectionState = 'connected';

          const sendIdentification = async () => {
            // Multi-extension pool: include a stable extensionId so the server
            // can route per-tab tool calls back to the right extension when
            // multiple are connected (e.g. ben's main Chrome + a container
            // chromium spawned via browser_launch_isolated_chrome). The
            // extensionId is generated once per Chrome profile and persisted
            // in chrome.storage.local — see ensureExtensionId() in background.js.
            // The offscreen document has its own `self`, separate from the
            // service worker's. The extensionId is pushed in via OFFSCREEN_CONNECT
            // (stashed on conn.extensionId), but we also fall back to a
            // storage read in case the connect path didn't carry it.
            let extensionId = conn.extensionId || null;
            let profileHint = null;
            if (!extensionId) {
              try {
                if (chrome?.storage?.local?.get) {
                  const s = await chrome.storage.local.get(['__unibrowseExtensionId', '__unibrowseProfileHint']);
                  extensionId = s.__unibrowseExtensionId || null;
                  profileHint = s.__unibrowseProfileHint || null;
                }
              } catch {}
            }
            // First-run fallback: storage was empty AND background.js's
            // ensureExtensionId() hadn't completed in time (race on container
            // spinup, since the WS auto-reconnect can fire before the SW's
            // top-level await resolves). Mint a UUID here so the very first
            // EXTENSION_REGISTER carries a unique id, and persist it so future
            // reconnects stay stable.
            if (!extensionId) {
              try {
                const minted = 'ext_' + (crypto && crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)));
                extensionId = minted;
                conn.extensionId = minted;
                if (chrome?.storage?.local?.set) {
                  chrome.storage.local.set({ __unibrowseExtensionId: minted }).catch(() => {});
                }
                console.log(`[Offscreen][${conn.wsId}] Minted extensionId in offscreen fallback: ${minted}`);
              } catch {}
            }
            const payload = JSON.stringify({
              type: 'EXTENSION_REGISTER',
              source: 'browser-extension',
              wsId: conn.wsId,
              payload: {
                extensionId: extensionId || conn.wsId,
                profileName: profileHint,
                hostname: null,
                userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || null,
              },
            });
            try {
              if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
                conn.ws.send(payload);
              } else {
                setTimeout(() => {
                  try { if (conn.ws && conn.ws.readyState === WebSocket.OPEN) conn.ws.send(payload); } catch {}
                }, 100);
              }
            } catch {
              setTimeout(() => {
                try { if (conn.ws && conn.ws.readyState === WebSocket.OPEN) conn.ws.send(payload); } catch {}
              }, 100);
            }
          };
          sendIdentification();

          if (this.isChromeAvailable()) {
            chrome.runtime.sendMessage({
              type: 'WS_CONNECTED',
              wsId: conn.wsId,
              serverUrl: url,
            }).catch(err => {
              console.log(`[Offscreen][${conn.wsId}] Could not notify SW:`, err.message);
            });
          }
          resolve();
        };

        conn.ws.onclose = (event) => {
          console.log(`[Offscreen][${conn.wsId}] WebSocket closed:`, event.code, event.reason);
          conn.connectionState = 'disconnected';

          if (this.isChromeAvailable()) {
            chrome.runtime.sendMessage({
              type: 'WS_DISCONNECTED',
              wsId: conn.wsId,
              code: event.code,
              reason: event.reason,
            }).catch(err => {
              console.log(`[Offscreen][${conn.wsId}] Could not notify SW:`, err.message);
            });
          }

          for (const [, { reject: r }] of conn.pendingRequests) {
            try { r(new Error('WebSocket disconnected')); } catch {}
          }
          conn.pendingRequests.clear();

          if (!opened) reject(new Error(`WebSocket closed before connecting (code: ${event.code})`));
          this.scheduleReconnect(conn.wsId);
        };

        conn.ws.onerror = () => {
          console.log(`[Offscreen][${conn.wsId}] WebSocket error event (non-critical, will reconnect)`);
          if (this.isChromeAvailable()) {
            try {
              chrome.runtime.sendMessage({
                type: 'WS_ERROR',
                wsId: conn.wsId,
                error: 'WebSocket error event (connection will be retried automatically)',
              }).catch(() => {});
            } catch {}
          }
        };

        conn.ws.onmessage = (event) => {
          this.handleWebSocketMessage(event, conn.wsId);
        };

      } catch (error) {
        console.error(`[Offscreen][${conn.wsId}] Failed to create WebSocket:`, error);
        conn.connectionState = 'error';
        reject(error);
      }
    });
  }

  async disconnect(wsId = DEFAULT_WS_ID) {
    const conn = this.connections.get(wsId);
    if (!conn) return;
    console.log(`[Offscreen][${conn.wsId}] Disconnecting`);
    conn.intentionalDisconnect = true;
    this.cancelReconnect(conn.wsId);
    if (conn.ws) {
      try { conn.ws.close(); } catch {}
      conn.ws = null;
    }
    conn.connectionState = 'disconnected';
  }

  handleWebSocketMessage(event, wsId) {
    const conn = this.connections.get(wsId);
    if (!conn) return;
    try {
      const message = JSON.parse(event.data);

      if (message.id && conn.pendingRequests.has(message.id)) {
        const { resolve, reject, timeoutId } = conn.pendingRequests.get(message.id);
        if (timeoutId) clearTimeout(timeoutId);
        conn.pendingRequests.delete(message.id);
        if (message.error) reject(new Error(message.error));
        else resolve(message.result || message);
      } else {
        if (this.isChromeAvailable()) {
          chrome.runtime.sendMessage({
            type: 'WS_MESSAGE',
            wsId: conn.wsId,
            message,
          }).catch(err => {
            console.log(`[Offscreen][${conn.wsId}] Could not forward message:`, err.message);
          });
        }
      }
    } catch (error) {
      console.error(`[Offscreen][${conn.wsId}] Error parsing WS message:`, error);
    }
  }

  // ─── Tab capture recording (unchanged) ───────────────────────────────────

  async startTabRecording(streamId, key = 'default') {
    const existing = this.recorders.get(key);
    if (existing && existing.mediaRecorder.state !== 'inactive') {
      existing.mediaRecorder.stop();
      existing.stream?.getTracks().forEach(t => t.stop());
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    });

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    const chunks = [];
    const mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.start(1000);

    this.recorders.set(key, { mediaRecorder, chunks, stream });
    console.log(`[Offscreen] Tab recording started for key=${key}, mimeType:`, mimeType);
  }

  stopTabRecording(key = 'default') {
    return new Promise((resolve, reject) => {
      const rec = this.recorders.get(key);
      if (!rec || rec.mediaRecorder.state === 'inactive') {
        reject(new Error(`No active tab recording for key=${key}`));
        return;
      }
      const mimeType = 'video/webm';
      rec.mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(rec.chunks, { type: mimeType });
          const arrayBuffer = await blob.arrayBuffer();
          this.recorders.delete(key);
          console.log(`[Offscreen] Tab recording stopped for key=${key},`, arrayBuffer.byteLength, 'bytes');
          resolve({ arrayBuffer, mimeType });
        } catch (err) { reject(err); }
      };
      rec.stream?.getTracks().forEach(t => t.stop());
      rec.mediaRecorder.stop();
    });
  }

  // ─── Send helpers ─────────────────────────────────────────────────────────

  sendMessage(messageType, data, options = {}, wsId = DEFAULT_WS_ID) {
    const conn = this._getOrCreateConn(wsId);
    return new Promise((resolve, reject) => {
      if (!this._isOpen(conn)) {
        reject(new Error(`WebSocket not connected for wsId=${conn.wsId}`));
        return;
      }
      const id = ++conn.messageId;
      const message = { id, type: messageType, ...data };
      const timeoutMs = options.timeoutMs || 30000;
      const timeoutId = setTimeout(() => {
        if (conn.pendingRequests.has(id)) {
          conn.pendingRequests.delete(id);
          reject(new Error(`Request timeout after ${timeoutMs}ms (wsId=${conn.wsId})`));
        }
      }, timeoutMs);
      conn.pendingRequests.set(id, { resolve, reject, timeoutId });
      try {
        conn.ws.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timeoutId);
        conn.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  sendMessageNoResponse(data, wsId = DEFAULT_WS_ID) {
    const conn = this._getOrCreateConn(wsId);
    if (!this._isOpen(conn)) {
      throw new Error(`WebSocket not connected for wsId=${conn.wsId}`);
    }
    try {
      conn.ws.send(JSON.stringify(data));
    } catch (error) {
      console.error(`[Offscreen][${conn.wsId}] Failed to send:`, error);
      throw error;
    }
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────

console.log('[Offscreen] Script executing - about to initialize');

function updateStatus(message) {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    statusEl.textContent = `[${timestamp}] ${message}`;
  }
}

updateStatus('Script loaded, initializing...');

const offscreenManager = new OffscreenManager();

console.log('[Offscreen] OffscreenManager instance created');
updateStatus('OffscreenManager created');

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
  console.log('[Offscreen] Sending OFFSCREEN_READY notification');
  updateStatus('Notifying background script...');
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' })
    .then(() => { updateStatus('Ready! Waiting for messages...'); })
    .catch(err => {
      console.log('[Offscreen] Could not notify background:', err.message);
      updateStatus('Error: Could not notify background');
    });
} else {
  console.error('[Offscreen] Chrome APIs not available for notification!');
  updateStatus('Error: Chrome APIs not available');
}
