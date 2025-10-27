/**
 * Offscreen Document - Maintains persistent WebSocket connection
 *
 * This runs in an offscreen document (not a service worker) so it can
 * maintain long-lived WebSocket connections without being terminated.
 */

class OffscreenManager {
  constructor() {
    this.ws = null;
    this.serverUrl = null;
    this.connectionState = 'disconnected';
    this.pendingRequests = new Map();
    this.messageId = 0;

    // Auto-reconnect configuration
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = Infinity; // Always try to reconnect
    this.reconnectDelay = 1000; // Start with 1 second
    this.maxReconnectDelay = 30000; // Max 30 seconds between attempts
    this.reconnectTimer = null;
    this.intentionalDisconnect = false; // Track if disconnect was intentional

    console.log('[Offscreen] OffscreenManager constructing...');

    // ALWAYS set up message listener, even if Chrome APIs aren't fully ready yet
    // The listener will check API availability per-message
    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        this.handleMessage(message, sender, sendResponse);
        return true; // Keep sendResponse channel open for async
      });
      console.log('[Offscreen] ✓ Message listener registered successfully');
    } catch (error) {
      console.error('[Offscreen] ✗ Failed to register message listener:', error);
      return;
    }

    // Now check if Chrome APIs are fully available for initialization
    if (!this.isChromeAvailable()) {
      console.log('[Offscreen] Chrome APIs not fully available yet, skipping connection restore');
      return;
    }

    console.log('[Offscreen] ✓ OffscreenManager initialized with Chrome APIs available');

    // Delay connection restoration to ensure Chrome APIs are fully ready
    // and to avoid race conditions during extension reload
    setTimeout(() => {
      this.restoreConnection();
    }, 100);
  }

  /**
   * Check if Chrome APIs are available
   * Returns false if extension context has been invalidated
   */
  isChromeAvailable() {
    try {
      // Only check what we actually need - chrome.runtime.sendMessage
      // chrome.runtime.id can be undefined in offscreen documents
      return typeof chrome !== 'undefined' &&
             chrome.runtime &&
             typeof chrome.runtime.sendMessage === 'function';
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if Chrome Storage API is available
   * Storage API may not be available in all contexts
   */
  isStorageAvailable() {
    try {
      return typeof chrome !== 'undefined' &&
             chrome.storage &&
             chrome.storage.local &&
             typeof chrome.storage.local.get === 'function';
    } catch (error) {
      return false;
    }
  }

  async restoreConnection() {
    try {
      // Check if Chrome APIs are still available
      if (!this.isChromeAvailable()) {
        console.log('[Offscreen] Chrome APIs not available, skipping connection restore');
        return;
      }

      // Always try to connect to default server URL
      const defaultUrl = 'ws://localhost:9010/ws';
      console.log('[Offscreen] Auto-connecting to', defaultUrl);
      this.intentionalDisconnect = false;
      await this.connect(defaultUrl);
    } catch (error) {
      console.log('[Offscreen] Initial connection failed, will retry:', error.message);
      // Schedule reconnect - this will handle the retry logic
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  scheduleReconnect() {
    // Don't reconnect if it was an intentional disconnect
    if (this.intentionalDisconnect) {
      console.log('[Offscreen] Skipping reconnect - disconnect was intentional');
      return;
    }

    // Clear any existing timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.reconnectAttempts++;
    console.log(`[Offscreen] Scheduling reconnect attempt #${this.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(async () => {
      console.log(`[Offscreen] Attempting reconnect #${this.reconnectAttempts}...`);
      try {
        await this.connect(this.serverUrl || 'ws://localhost:9010/ws');
        // Success - reset attempts
        this.reconnectAttempts = 0;
        console.log('[Offscreen] Reconnected successfully!');
      } catch (error) {
        console.log('[Offscreen] Reconnect failed:', error.message);
        // Schedule next attempt
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Cancel any scheduled reconnection
   */
  cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  async handleMessage(message, sender, sendResponse) {
    console.log('[Offscreen] handleMessage called with:', message?.type || 'no type');

    // Only handle messages prefixed with OFFSCREEN_
    // All other messages are meant for the background service worker
    if (!message.type || !message.type.startsWith('OFFSCREEN_')) {
      console.log('[Offscreen] Ignoring non-OFFSCREEN message:', message?.type);
      return; // Ignore, let background service worker handle it
    }

    console.log('[Offscreen] Processing OFFSCREEN message:', message.type);

    try {
      switch (message.type) {
        case 'OFFSCREEN_CONNECT':
          await this.connect(message.url);
          sendResponse({ success: true, state: this.connectionState });
          break;

        case 'OFFSCREEN_DISCONNECT':
          await this.disconnect();
          sendResponse({ success: true });
          break;

        case 'OFFSCREEN_SEND_MESSAGE':
          const result = await this.sendMessage(message.messageType, message.data, message.options);
          sendResponse({ success: true, result });
          break;

        case 'OFFSCREEN_SEND_MESSAGE_NO_RESPONSE':
          this.sendMessageNoResponse(message.data);
          sendResponse({ success: true });
          break;

        case 'OFFSCREEN_GET_STATE':
          sendResponse({
            success: true,
            state: this.connectionState,
            connected: this.ws && this.ws.readyState === WebSocket.OPEN
          });
          break;

        default:
          console.warn('[Offscreen] Unknown OFFSCREEN_ message type:', message.type);
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      // Check if error is due to extension context being invalidated (reload)
      if (!this.isChromeAvailable() || error.message?.includes('Extension context invalidated')) {
        console.log('[Offscreen] Message handling skipped - extension reloading');
        sendResponse({ success: false, error: 'Extension context invalidated' });
      } else {
        console.error('[Offscreen] Error handling message:', error);
        sendResponse({ success: false, error: error.message });
      }
    }
  }

  async connect(url) {
    console.log('[Offscreen] Connecting to', url);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[Offscreen] Already connected');
      return;
    }

    this.serverUrl = url;
    this.connectionState = 'connecting';

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log('[Offscreen] WebSocket connected');
          this.connectionState = 'connected';

          // IMPORTANT: Send identification message to server
          // This tells the server that this connection is from the browser extension
          // (not from an external MCP client like the test suite)
          try {
            this.ws.send(JSON.stringify({
              type: 'EXTENSION_REGISTER',
              source: 'browser-extension'
            }));
            console.log('[Offscreen] Sent extension identification to server');
          } catch (error) {
            console.error('[Offscreen] Failed to send extension identification:', error);
          }

          // Store connection info (only if Chrome APIs available)
          if (this.isChromeAvailable()) {
            try {
              // Store connection state if storage API available
              if (this.isStorageAvailable()) {
                chrome.storage.local.set({
                  serverUrl: url,
                  isConnected: true
                }).catch(err => {
                  console.log('[Offscreen] Could not store connection info:', err.message);
                });
              }

              // Notify service worker
              chrome.runtime.sendMessage({
                type: 'WS_CONNECTED'
              }).catch(err => {
                console.log('[Offscreen] Could not notify service worker (may be sleeping):', err.message);
              });
            } catch (err) {
              console.log('[Offscreen] Error in onopen handler:', err.message);
            }
          }

          resolve();
        };

        this.ws.onclose = (event) => {
          console.log('[Offscreen] WebSocket closed:', event.code, event.reason);
          this.connectionState = 'disconnected';

          // Clear stored connection (only if Chrome APIs available)
          if (this.isChromeAvailable()) {
            if (this.isStorageAvailable()) {
              chrome.storage.local.set({ isConnected: false }).catch(err => {
                console.log('[Offscreen] Could not clear connection state:', err.message);
              });
            }

            // Notify service worker
            chrome.runtime.sendMessage({
              type: 'WS_DISCONNECTED',
              code: event.code,
              reason: event.reason
            }).catch(err => {
              console.log('[Offscreen] Could not notify service worker (may be sleeping):', err.message);
            });
          }

          // Reject any pending requests
          for (const [id, { reject }] of this.pendingRequests) {
            reject(new Error('WebSocket disconnected'));
          }
          this.pendingRequests.clear();

          // Schedule reconnection (unless it was an intentional disconnect)
          this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('[Offscreen] WebSocket error:', error);
          this.connectionState = 'error';

          // Notify service worker (only if Chrome APIs available)
          if (this.isChromeAvailable()) {
            try {
              chrome.runtime.sendMessage({
                type: 'WS_ERROR',
                error: error.message || 'WebSocket error'
              }).catch(err => {
                console.log('[Offscreen] Could not notify service worker (may be sleeping):', err.message);
              });
            } catch (err) {
              console.log('[Offscreen] Error in onerror handler:', err.message);
            }
          }

          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onmessage = (event) => {
          this.handleWebSocketMessage(event);
        };

      } catch (error) {
        console.error('[Offscreen] Failed to create WebSocket:', error);
        this.connectionState = 'error';
        reject(error);
      }
    });
  }

  async disconnect() {
    console.log('[Offscreen] Disconnecting');

    // Mark as intentional disconnect to prevent auto-reconnect
    this.intentionalDisconnect = true;

    // Cancel any pending reconnection attempts
    this.cancelReconnect();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connectionState = 'disconnected';

    // Clear stored connection (only if Chrome APIs available)
    if (this.isChromeAvailable() && this.isStorageAvailable()) {
      try {
        await chrome.storage.local.set({ isConnected: false });
      } catch (error) {
        console.log('[Offscreen] Could not clear connection state:', error.message);
      }
    }
  }

  handleWebSocketMessage(event) {
    try {
      const message = JSON.parse(event.data);
      console.log('[Offscreen] WebSocket message:', message);

      // Check if this is a response to a pending request
      if (message.id && this.pendingRequests.has(message.id)) {
        console.log('[Offscreen] Message matches pending request:', message.id);
        const { resolve, reject, timeoutId } = this.pendingRequests.get(message.id);

        // Clear timeout
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // Remove from pending
        this.pendingRequests.delete(message.id);

        // Resolve or reject based on response
        if (message.error) {
          reject(new Error(message.error));
        } else {
          resolve(message.result || message);
        }
      } else {
        // Unsolicited message - forward to service worker (only if Chrome APIs available)
        console.log('[Offscreen] Forwarding message to background:', message.type);
        if (this.isChromeAvailable()) {
          chrome.runtime.sendMessage({
            type: 'WS_MESSAGE',
            message
          }).then(() => {
            console.log('[Offscreen] ✓ Message forwarded successfully');
          }).catch(err => {
            console.log('[Offscreen] ✗ Could not forward message to service worker:', err.message);
          });
        } else {
          console.log('[Offscreen] ✗ Chrome APIs not available, cannot forward');
        }
      }
    } catch (error) {
      console.error('[Offscreen] Error parsing WebSocket message:', error);
    }
  }

  sendMessage(messageType, data, options = {}) {
    console.log('[Offscreen] Sending message:', messageType, data);

    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = ++this.messageId;
      const message = {
        id,
        type: messageType,
        ...data
      };

      // Set up timeout
      const timeoutMs = options.timeoutMs || 30000;
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      // Store pending request
      this.pendingRequests.set(id, { resolve, reject, timeoutId });

      // Send message
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  /**
   * Send a message that doesn't expect a response (e.g., responses to server requests)
   */
  sendMessageNoResponse(data) {
    console.log('[Offscreen] Sending message (no response expected):', data);

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    try {
      this.ws.send(JSON.stringify(data));
    } catch (error) {
      console.error('[Offscreen] Failed to send message:', error);
      throw error;
    }
  }
}

console.log('[Offscreen] Script executing - about to initialize');

// Update status in the page
function updateStatus(message) {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    statusEl.textContent = `[${timestamp}] ${message}`;
  }
}

updateStatus('Script loaded, initializing...');

// Initialize the offscreen manager
const offscreenManager = new OffscreenManager();

console.log('[Offscreen] OffscreenManager instance created');
console.log('[Offscreen] Document loaded and ready');
updateStatus('OffscreenManager created');

// Notify background script that we're ready - do this immediately
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
  console.log('[Offscreen] Sending OFFSCREEN_READY notification');
  updateStatus('Notifying background script...');
  chrome.runtime.sendMessage({
    type: 'OFFSCREEN_READY'
  }).then(() => {
    console.log('[Offscreen] OFFSCREEN_READY sent successfully');
    updateStatus('Ready! Waiting for messages...');
  }).catch(err => {
    console.log('[Offscreen] Could not notify background:', err.message);
    updateStatus('Error: Could not notify background');
  });
} else {
  console.error('[Offscreen] Chrome APIs not available for notification!');
  updateStatus('Error: Chrome APIs not available');
}
