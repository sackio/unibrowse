/**
 * WebSocket Manager for Browser MCP
 * Manages WebSocket connection to MCP server with auto-reconnect
 */

class WebSocketManager {
  constructor(url = 'ws://localhost:9010/ws') {
    this.url = url;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = Infinity; // Never give up - keep trying indefinitely
    this.reconnectDelay = 1000; // Start with 1 second
    this.maxReconnectDelay = 5000; // Max 5 seconds (reduced from 30s for faster recovery)
    this.isIntentionallyClosed = false;
    this.messageHandlers = new Map();
    this.stateChangeHandlers = [];
    this.pendingMessages = [];
  }

  /**
   * Connect to WebSocket server
   */
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('[WebSocket] Already connected or connecting');
      return;
    }

    this.isIntentionallyClosed = false;
    console.log('[WebSocket] Connecting to', this.url);
    this.emitStateChange('connecting');

    try {
      this.ws = new WebSocket(this.url);
      this.setupEventHandlers();
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      this.emitStateChange('error', error.message);
      this.scheduleReconnect();
    }
  }

  /**
   * Setup WebSocket event handlers
   */
  setupEventHandlers() {
    this.ws.onopen = () => {
      console.log('[WebSocket] Connected');
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.emitStateChange('connected');

      // Send any pending messages
      while (this.pendingMessages.length > 0) {
        const msg = this.pendingMessages.shift();
        this.send(msg);
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[WebSocket] Received:', message);
        this.handleMessage(message);
      } catch (error) {
        console.error('[WebSocket] Failed to parse message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('[WebSocket] Error:', error);
      this.emitStateChange('error', 'WebSocket error occurred');
    };

    this.ws.onclose = (event) => {
      console.log('[WebSocket] Closed:', event.code, event.reason);
      this.emitStateChange('disconnected');

      if (!this.isIntentionallyClosed) {
        this.scheduleReconnect();
      }
    };
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    this.isIntentionallyClosed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.emitStateChange('disconnected');
  }

  /**
   * Send message to server
   */
  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocket] Not connected, queueing message');
      this.pendingMessages.push(message);
      return false;
    }

    try {
      const data = typeof message === 'string' ? message : JSON.stringify(message);
      this.ws.send(data);
      console.log('[WebSocket] Sent:', message);
      return true;
    } catch (error) {
      console.error('[WebSocket] Failed to send message:', error);
      return false;
    }
  }

  /**
   * Handle incoming message
   */
  handleMessage(message) {
    const { id, type } = message;

    // Check if there's a specific handler for this message ID
    if (id && this.messageHandlers.has(id)) {
      const handler = this.messageHandlers.get(id);
      this.messageHandlers.delete(id);
      handler(message);
      return;
    }

    // Broadcast to all state change handlers
    this.emitStateChange('message', message);
  }

  /**
   * Register a one-time message handler for a specific message ID
   */
  onMessage(id, handler) {
    this.messageHandlers.set(id, handler);
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
    this.stateChangeHandlers.forEach(handler => {
      try {
        handler(state, data);
      } catch (error) {
        console.error('[WebSocket] State change handler error:', error);
      }
    });
  }

  /**
   * Schedule reconnect with exponential backoff
   */
  scheduleReconnect() {
    if (this.isIntentionallyClosed) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnect attempts reached');
      this.emitStateChange('error', 'Failed to reconnect after maximum attempts');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Get current connection state
   */
  getState() {
    if (!this.ws) return 'disconnected';

    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'connected';
      case WebSocket.CLOSING:
        return 'disconnecting';
      case WebSocket.CLOSED:
        return 'disconnected';
      default:
        return 'unknown';
    }
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

// Export for use in background.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebSocketManager;
}
