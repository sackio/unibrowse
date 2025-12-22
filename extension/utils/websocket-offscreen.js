/**
 * WebSocket Manager - Offscreen Document Adapter
 * Proxies WebSocket operations to the offscreen document to avoid service worker timeouts
 */

class WebSocketManager {
  constructor(url = 'ws://localhost:9010/ws') {
    this.url = url;
    this.stateChangeHandlers = [];
    this.offscreenReady = false;
    this.messageIdCounter = 0;
    this.pendingResponses = new Map();

    console.log('[WebSocketManager] Initialized with offscreen adapter');

    // Check if Chrome APIs are available
    // This can happen during extension reload - it's normal and not an error
    if (!this.isChromeAvailable()) {
      console.log('[WebSocketManager] Chrome APIs not available (extension reloading), skipping initialization');
      return;
    }

    // Listen for messages from offscreen document
    try {
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (message.type === 'OFFSCREEN_READY') {
          console.log('[WebSocketManager] ✓ Offscreen document is ready and responding');
          this.offscreenReady = true;
        } else if (message.type === 'WS_CONNECTED') {
          console.log('[WebSocketManager] Offscreen WebSocket connected');
          this.emitStateChange('connected');
        } else if (message.type === 'WS_DISCONNECTED') {
          console.log('[WebSocketManager] Offscreen WebSocket disconnected');
          this.emitStateChange('disconnected');
        } else if (message.type === 'WS_ERROR') {
          console.error('[WebSocketManager] Offscreen WebSocket error:', message.error);
          this.emitStateChange('error', message.error);
        } else if (message.type === 'WS_MESSAGE') {
          console.log('[WebSocketManager] Offscreen message:', message.message);
          // Don't emit state change - message is already handled by WS_MESSAGE handler in background.js
          // This prevents duplicate message processing
        }
      });
    } catch (error) {
      // This shouldn't happen since we already checked Chrome API availability
      // but if it does, it's likely due to extension reload
      console.log('[WebSocketManager] Failed to add message listener (extension reloading):', error.message);
      return;
    }

    this.ensureOffscreenDocument();
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
   * Ensure offscreen document exists
   */
  async ensureOffscreenDocument() {
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
        console.log('[WebSocketManager] Offscreen document already exists');
        this.offscreenReady = true;
        return;
      }

      // Create offscreen document
      console.log('[WebSocketManager] Creating offscreen document');
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS'],
        justification: 'Maintain WebSocket connection without service worker timeout'
      });

      // Give the offscreen document a moment to initialize
      await new Promise(resolve => setTimeout(resolve, 100));

      this.offscreenReady = true;
      console.log('[WebSocketManager] Offscreen document created and ready');
    } catch (error) {
      // Document may already exist, which throws an error
      if (error.message.includes('Only a single offscreen')) {
        console.log('[WebSocketManager] Offscreen document already exists (caught error)');
        this.offscreenReady = true;
      } else if (error.message === 'Chrome APIs not available' || !this.isChromeAvailable()) {
        // Extension is reloading, this is expected
        console.log('[WebSocketManager] Offscreen document creation skipped (extension reloading)');
        throw error;
      } else {
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
          { type, ...data },
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
      await this.sendToOffscreen('OFFSCREEN_CONNECT', { url: this.url });
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
        await this.sendToOffscreen('OFFSCREEN_CONNECT', { url: this.url });
        console.log('[WebSocketManager] Connection initiated with new offscreen document');
      } else if (error.message.includes('Chrome APIs not available') || !this.isChromeAvailable()) {
        console.log('[WebSocketManager] Connection skipped - extension reloading');
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
