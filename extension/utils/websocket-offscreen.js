/**
 * WebSocket Manager - Offscreen Document Adapter
 * Proxies WebSocket operations to the offscreen document to avoid service worker timeouts
 */

class WebSocketManager {
  constructor(url = 'ws://localhost:9010/ws', options = {}) {
    this.url = url;
    this.wsId = options.wsId || 'default';
    this.stateChangeHandlers = [];
    this.offscreenReady = false;
    this.messageIdCounter = 0;
    this.pendingResponses = new Map();

    console.log(`[WebSocketManager:${this.wsId}] Initialized with offscreen adapter`);

    // Check if Chrome APIs are available
    // This can happen during extension reload - it's normal and not an error
    if (!this.isChromeAvailable()) {
      console.log('[WebSocketManager] Chrome APIs not available (extension reloading), skipping initialization');
      return;
    }

    // Listen for messages from offscreen document — filter by wsId so a
    // manager only sees events for its own connection. Messages without a
    // wsId (legacy offscreen builds) are treated as belonging to "default".
    try {
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (message.type === 'OFFSCREEN_READY') {
          console.log('[WebSocketManager] ✓ Offscreen document is ready and responding');
          this.offscreenReady = true;
          return;
        }
        const msgWsId = message.wsId || 'default';
        if (msgWsId !== this.wsId) return;
        if (message.type === 'WS_CONNECTED') {
          console.log(`[WebSocketManager:${this.wsId}] WebSocket connected`);
          this.emitStateChange('connected');
        } else if (message.type === 'WS_DISCONNECTED') {
          console.log(`[WebSocketManager:${this.wsId}] WebSocket disconnected`);
          this.emitStateChange('disconnected');
        } else if (message.type === 'WS_ERROR') {
          console.warn(`[WebSocketManager:${this.wsId}] WebSocket error (non-critical):`, message.error);
        }
        // WS_MESSAGE: background.js's central onMessage handler dispatches it
        // — we don't ack here so the dispatch fires once.
      });
    } catch (error) {
      // This shouldn't happen since we already checked Chrome API availability
      // but if it does, it's likely due to extension reload
      console.log('[WebSocketManager] Failed to add message listener (extension reloading):', error.message);
      return;
    }

    // Fire-and-forget on construction. A rejection here (typically Chrome's
    // transient "No SW" while the service worker is still activating) MUST be
    // caught — otherwise it surfaces as an "Uncaught (in promise)" error. Every
    // sendToOffscreen() lazily re-runs this, so a deferred failure self-heals.
    this.ensureOffscreenDocument().catch((err) => {
      console.log('[WebSocketManager] Initial offscreen ensure deferred (will retry on demand):', err?.message || err);
    });
  }

  /**
   * Chrome throws these while the service worker is still activating or being
   * torn down (e.g. right after an alarm/startup wake). They clear on their own,
   * so callers should retry rather than surface them as hard errors.
   */
  _isTransientSwError(msg) {
    if (!msg) return false;
    return msg.includes('No SW') ||
           msg.includes('No service worker') ||
           msg.includes('No active service worker') ||
           msg.includes('Service worker is not active') ||
           msg.includes('service worker is not yet active');
  }

  /**
   * Check if Chrome APIs are available
   */
  isChromeAvailable() {
    try {
      return typeof chrome !== 'undefined' &&
             chrome.runtime &&
             chrome.runtime.id;
    } catch (error) {
      return false;
    }
  }

  /**
   * Ensure the offscreen document exists.
   *
   * Single-flight: concurrent callers (constructor, connect, the 5s health
   * check, getState) share one in-flight attempt instead of racing to create
   * the document — which would otherwise throw "Only a single offscreen
   * document may be created" against itself.
   */
  async ensureOffscreenDocument() {
    if (this._ensuringPromise) return this._ensuringPromise;
    this._ensuringPromise = this._ensureOffscreenDocumentOnce()
      .finally(() => { this._ensuringPromise = null; });
    return this._ensuringPromise;
  }

  async _ensureOffscreenDocumentOnce() {
    const MAX_ATTEMPTS = 5;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Check if Chrome APIs are available first
      if (!this.isChromeAvailable()) {
        console.log('[WebSocketManager] Chrome APIs not available (extension reloading)');
        throw new Error('Chrome APIs not available');
      }

      try {
        // Check if offscreen document already exists
        const existingContexts = await chrome.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT'],
          documentUrls: [chrome.runtime.getURL('offscreen.html')]
        });

        if (existingContexts.length > 0) {
          this.offscreenReady = true;
          return;
        }

        // Create offscreen document
        console.log('[WebSocketManager] Creating offscreen document');
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['WORKERS', 'USER_MEDIA'],
          justification: 'Maintain WebSocket connection and perform tab capture for recording replay'
        });

        // Give the offscreen document a moment to initialize
        await new Promise(resolve => setTimeout(resolve, 100));

        this.offscreenReady = true;
        console.log('[WebSocketManager] Offscreen document created and ready');
        return;
      } catch (error) {
        const msg = error?.message || String(error);

        // Document already exists (getContexts can transiently miss it) — fine.
        if (msg.includes('Only a single offscreen')) {
          this.offscreenReady = true;
          return;
        }

        // Extension is reloading / context invalidated — expected; let the
        // caller retry later.
        if (msg === 'Chrome APIs not available' || !this.isChromeAvailable()) {
          console.log('[WebSocketManager] Offscreen document creation skipped (extension reloading)');
          throw error;
        }

        // "No SW" et al: the service worker isn't fully active yet (common right
        // after an alarm/startup wake). Back off briefly and retry instead of
        // failing the whole connect.
        if (this._isTransientSwError(msg) && attempt < MAX_ATTEMPTS) {
          const delay = 100 * attempt;
          console.log(`[WebSocketManager] Offscreen ensure hit transient SW state ("${msg}"), retry ${attempt}/${MAX_ATTEMPTS - 1} in ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        console.error('[WebSocketManager] Failed to create offscreen document:', error);
        throw error;
      }
    }
  }

  /**
   * Send message to offscreen document
   */
  async sendToOffscreen(type, data = {}, retryCount = 0) {
    // Check if Chrome APIs are available before attempting communication
    if (!this.isChromeAvailable()) {
      throw new Error('Chrome APIs not available - extension context may be invalidated');
    }

    await this.ensureOffscreenDocument();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Offscreen communication timeout'));
      }, 5000);

      try {
        chrome.runtime.sendMessage(
          { type, wsId: this.wsId, ...data },
          (response) => {
            clearTimeout(timeout);

            if (chrome.runtime.lastError) {
              const error = chrome.runtime.lastError.message;

              // Check if it's a "message port closed" error - offscreen doc not ready yet
              if (error.includes('message port closed') && retryCount < 3) {
                console.log(`[WebSocketManager] Offscreen not ready, retrying... (${retryCount + 1}/3)`);
                // Wait a bit and retry
                setTimeout(() => {
                  this.sendToOffscreen(type, data, retryCount + 1)
                    .then(resolve)
                    .catch(reject);
                }, 100 * (retryCount + 1)); // Exponential backoff
                return;
              }

              reject(new Error(error));
              return;
            }

            if (response && response.success) {
              resolve(response);
            } else {
              reject(new Error(response?.error || 'Unknown error'));
            }
          }
        );
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Connect to WebSocket server
   */
  async connect() {
    console.log('[WebSocketManager] Connecting via offscreen document');
    this.emitStateChange('connecting');

    try {
      await this.sendToOffscreen('OFFSCREEN_CONNECT', { url: this.url, extensionId: self.__unibrowseExtensionId || null });
      console.log('[WebSocketManager] Connection initiated');
    } catch (error) {
      // Check if this is due to extension reload vs actual connection error
      if (error.message.includes('Extension context invalidated')) {
        console.log('[WebSocketManager] Offscreen document invalidated, recreating...');
        // Close and recreate offscreen document
        try {
          await chrome.offscreen.closeDocument();
        } catch (e) {
          // May not exist
        }
        // Retry connection with fresh offscreen document
        await this.ensureOffscreenDocument();
        await this.sendToOffscreen('OFFSCREEN_CONNECT', { url: this.url, extensionId: self.__unibrowseExtensionId || null });
        console.log('[WebSocketManager] Connection initiated with new offscreen document');
      } else if (error.message.includes('Chrome APIs not available') || !this.isChromeAvailable()) {
        console.log('[WebSocketManager] Connection skipped - extension reloading');
        throw error;
      } else if (this._isTransientSwError(error.message)) {
        // Service worker still spinning up — auto-reconnect / health check will retry.
        console.log('[WebSocketManager] Connection deferred - service worker not active yet:', error.message);
        throw error;
      } else {
        console.error('[WebSocketManager] Connection failed:', error);
        this.emitStateChange('error', error.message);
        throw error;
      }
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  async disconnect() {
    console.log('[WebSocketManager] Disconnecting');
    try {
      await this.sendToOffscreen('OFFSCREEN_DISCONNECT');
      this.emitStateChange('disconnected');
    } catch (error) {
      // Check if this is due to extension reload vs actual disconnect error
      if (error.message.includes('Chrome APIs not available') || !this.isChromeAvailable()) {
        console.log('[WebSocketManager] Disconnect skipped - extension reloading');
      } else {
        console.error('[WebSocketManager] Disconnect failed:', error);
      }
    }
  }

  /**
   * Send message to server via offscreen document
   */
  send(message) {
    console.log('[WebSocketManager] Sending message via offscreen:', message);

    // Send without waiting for response (fire and forget, like original)
    this.sendToOffscreen('OFFSCREEN_SEND_MESSAGE', {
      messageType: message.type,
      data: message,
      options: { timeoutMs: 30000 }
    }).catch(error => {
      // Check if this is due to extension reload vs actual send error
      if (error?.message?.includes('Chrome APIs not available') || !this.isChromeAvailable()) {
        console.log('[WebSocketManager] Send skipped - extension reloading');
      } else {
        console.error('[WebSocketManager] Send failed:', error?.message || error || 'Unknown error');
      }
    });

    return true;
  }

  /**
   * Send message that doesn't expect a response (e.g., responses to requests)
   * This avoids timeout errors when sending responses back to the server
   */
  async sendNoResponse(message) {
    console.log('[WebSocketManager] Sending message (no response expected) via offscreen:', message);

    try {
      await this.sendToOffscreen('OFFSCREEN_SEND_MESSAGE_NO_RESPONSE', {
        data: message
      });
      return { success: true };
    } catch (error) {
      // Check if this is due to extension reload vs actual send error
      if (error?.message?.includes('Chrome APIs not available') || !this.isChromeAvailable()) {
        console.log('[WebSocketManager] Send skipped - extension reloading');
      } else {
        console.error('[WebSocketManager] Send failed:', error?.message || error || 'Unknown error');
      }

      // IMPORTANT: Return error status instead of throwing
      return { success: false, error: error?.message || 'Unknown error' };
    }
  }

  /**
   * Register a state change handler
   */
  onStateChange(handler) {
    this.stateChangeHandlers.push(handler);
  }

  /**
   * Emit state change event
   */
  emitStateChange(state, data = null) {
    console.log('[WebSocketManager] State change:', state, data);
    this.stateChangeHandlers.forEach(handler => {
      try {
        handler(state, data);
      } catch (error) {
        console.error('[WebSocketManager] State change handler error:', error);
      }
    });
  }

  /**
   * Get current connection state
   */
  async getState() {
    try {
      const response = await this.sendToOffscreen('OFFSCREEN_GET_STATE');
      return response.state;
    } catch (error) {
      // Only log if it's not a retry timeout (which is expected during startup)
      if (!error.message.includes('message port closed')) {
        console.error('[WebSocketManager] Failed to get state:', error);
      }
      return 'disconnected';
    }
  }

  /**
   * Check if connected
   */
  async isConnected() {
    try {
      const response = await this.sendToOffscreen('OFFSCREEN_GET_STATE');
      return response.connected;
    } catch (error) {
      return false;
    }
  }

  /**
   * Register a one-time message handler for a specific message ID
   */
  onMessage(id, handler) {
    // Store handler to be called when message arrives via WS_MESSAGE
    this.pendingResponses.set(id, handler);
  }
}

// Export for use in background.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebSocketManager;
}
