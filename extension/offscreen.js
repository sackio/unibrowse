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

    // Holding pen for stopped recordings' base64 — keyed by tabId. Lives just
    // long enough for the SW to fetch all chunks via OFFSCREEN_GET_VIDEO_CHUNK
    // then call OFFSCREEN_RELEASE_VIDEO. The chunked transfer exists because
    // chrome.runtime.sendMessage hard-caps at 64 MiB per response payload —
    // a single ~5min recording at 1280×720 24fps regularly clears that
    // (diagnosed 2026-06-27 by ben from the offscreen error log).
    this.pendingVideos = new Map(); // tabId -> { videoBase64, mimeType, byteLength, createdAt }
    // 32 MiB of base64 ≈ 24 MiB raw — comfortably under chrome's per-message cap.
    this.VIDEO_CHUNK_SIZE = 32 * 1024 * 1024;

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
          const tabKey = message.tabId ?? 'default';
          const videoData = await this.stopTabRecording(tabKey);
          const bytes = new Uint8Array(videoData.arrayBuffer);
          let binary = '';
          const stringifyChunkSize = 8192; // avoid String.fromCharCode stack overflow
          for (let i = 0; i < bytes.byteLength; i += stringifyChunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + stringifyChunkSize, bytes.byteLength)));
          }
          const videoBase64 = btoa(binary);
          // Inline path for small recordings — still works the same as before.
          // Cuts off well below chrome's 64 MiB cap so we never hit it.
          if (videoBase64.length <= this.VIDEO_CHUNK_SIZE) {
            sendResponse({
              success: true,
              videoBase64,
              mimeType: videoData.mimeType,
              byteLength: videoData.arrayBuffer.byteLength,
              chunked: false,
            });
          } else {
            // Big recording: stash + return metadata; caller pulls chunks.
            this.pendingVideos.set(tabKey, {
              videoBase64,
              mimeType: videoData.mimeType,
              byteLength: videoData.arrayBuffer.byteLength,
              createdAt: Date.now(),
            });
            const totalLen = videoBase64.length;
            const chunkCount = Math.ceil(totalLen / this.VIDEO_CHUNK_SIZE);
            console.log(`[Offscreen] Tab ${tabKey} video too large (${totalLen} b64 chars) — sending in ${chunkCount} chunks of ${this.VIDEO_CHUNK_SIZE}`);
            sendResponse({
              success: true,
              chunked: true,
              tabId: tabKey,
              mimeType: videoData.mimeType,
              byteLength: videoData.arrayBuffer.byteLength,
              totalBase64Length: totalLen,
              chunkSize: this.VIDEO_CHUNK_SIZE,
              chunkCount,
            });
          }
          break;
        }

        case 'OFFSCREEN_GET_VIDEO_CHUNK': {
          const tabKey = message.tabId ?? 'default';
          const pending = this.pendingVideos.get(tabKey);
          if (!pending) {
            sendResponse({ success: false, error: 'No pending video for tab (already released or never stopped)' });
            break;
          }
          const idx = message.chunkIndex | 0;
          const start = idx * this.VIDEO_CHUNK_SIZE;
          if (start >= pending.videoBase64.length) {
            sendResponse({ success: false, error: 'chunkIndex out of range' });
            break;
          }
          const chunk = pending.videoBase64.slice(start, start + this.VIDEO_CHUNK_SIZE);
          const isLast = (start + chunk.length) >= pending.videoBase64.length;
          sendResponse({ success: true, chunk, chunkIndex: idx, isLast });
          break;
        }

        case 'OFFSCREEN_RELEASE_VIDEO': {
          const tabKey = message.tabId ?? 'default';
          const had = this.pendingVideos.delete(tabKey);
          sendResponse({ success: true, released: had });
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
            // Background.js owns the extension identity (singleton ensureExtensionId
            // populates chrome.storage.local exactly once). Offscreen reads it,
            // never mints. If storage is still empty when we get here, RETRY a
            // few times — background's writer may not have landed yet (typical
            // race on container chromium first boot). The retry window is small
            // (~1.5s total) but enough to let the SW's first storage round-trip
            // complete. If it still isn't there, fall back to letting the
            // server use its ws-owner lookup (omit extensionId from payload).
            const tryRead = async () => {
              if (!chrome?.storage?.local?.get) return;
              try {
                const s = await chrome.storage.local.get(['__unibrowseExtensionId', '__unibrowseProfileHint']);
                if (s.__unibrowseExtensionId) extensionId = s.__unibrowseExtensionId;
                if (s.__unibrowseProfileHint) profileHint = s.__unibrowseProfileHint;
              } catch {}
            };
            if (!extensionId) {
              for (let i = 0; i < 8 && !extensionId; i++) {
                await tryRead();
                if (extensionId) break;
                await new Promise(r => setTimeout(r, 200));
              }
            }
            // ⛔ ASK THE BACKGROUND — it OWNS the identity. Polling storage is a
            // race we can lose: on a reload the SW's first write may not have
            // landed, and the old code then registered as `conn.wsId`, the
            // literal string "default". Ben's desktop Chrome alternated between
            // its real id and "default" across reloads because of this, which
            // silently stranded every agent holding the previous one.
            // ensureExtensionId() is a memoised singleton, so this returns the
            // id the SW already resolved rather than minting a competing one.
            if (!extensionId && typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
              try {
                const resp = await new Promise((resolve) => {
                  let done = false;
                  const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 3000);
                  chrome.runtime.sendMessage({ type: 'GET_EXTENSION_ID' }, (r) => {
                    void chrome.runtime.lastError;
                    if (!done) { done = true; clearTimeout(t); resolve(r); }
                  });
                });
                if (resp?.ok && resp.extensionId) {
                  extensionId = resp.extensionId;
                  console.log(`[Offscreen][${conn.wsId}] got authoritative extensionId ${extensionId} from background`);
                }
              } catch (e) {
                console.warn(`[Offscreen][${conn.wsId}] GET_EXTENSION_ID failed:`, e?.message || e);
              }
            }
            if (!extensionId) {
              // Registering as conn.wsId ("default") is the LAST resort and is
              // deliberately loud: it means this browser is about to take on an
              // id that any other unidentified browser could also take.
              console.warn(`[Offscreen][${conn.wsId}] NO stable extensionId available — registering as "${conn.wsId}". Agents holding a previous id for this browser will be stranded.`);
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
