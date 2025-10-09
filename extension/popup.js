/**
 * Browser MCP - Popup UI Controller
 */

class PopupController {
  constructor() {
    this.elements = {
      status: document.getElementById('status'),
      statusText: document.getElementById('status-text'),
      connectionBtn: document.getElementById('connection-btn'),
      gotoTabBtn: document.getElementById('goto-tab-btn'),
      wsState: document.getElementById('ws-state'),
      debuggerState: document.getElementById('debugger-state'),
      tabInfo: document.getElementById('tab-info'),
      tabTitle: document.getElementById('tab-title'),
      tabUrl: document.getElementById('tab-url'),
      error: document.getElementById('error')
    };

    this.setupEventListeners();
    this.loadState();

    // Listen for state updates from background
    chrome.runtime.onMessage.addListener((message) => {
      console.log('[Popup] Received message:', message);
      if (message.type === 'state_change') {
        this.updateUI(message.state);
      }
    });

    // Poll for state updates
    setInterval(() => this.loadState(), 1000);
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    this.elements.connectionBtn.addEventListener('click', () => {
      // Check current state and toggle
      if (this.elements.connectionBtn.textContent === 'Connect') {
        this.connect();
      } else {
        this.disconnect();
      }
    });

    this.elements.gotoTabBtn.addEventListener('click', async () => {
      const response = await chrome.runtime.sendMessage({ type: 'get_state' });
      if (response.success && response.data.tabId) {
        chrome.tabs.update(response.data.tabId, { active: true });
        window.close(); // Close popup after switching
      }
    });
  }

  /**
   * Load state from background worker
   */
  async loadState() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'get_state' });
      if (response.success) {
        this.updateUI(response.data);
      }
    } catch (error) {
      console.error('Failed to load state:', error);
    }
  }

  /**
   * Connect to MCP server
   */
  async connect() {
    this.hideError();
    this.setButtonsEnabled(false);

    try {
      const response = await chrome.runtime.sendMessage({ type: 'connect' });

      if (response.success) {
        console.log('Connected:', response.data);
      } else {
        this.showError(response.error || 'Failed to connect');
        this.setButtonsEnabled(true);
      }
    } catch (error) {
      console.error('Connection error:', error);
      this.showError(error.message);
      this.setButtonsEnabled(true);
    }
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect() {
    this.hideError();
    this.setButtonsEnabled(false);

    try {
      const response = await chrome.runtime.sendMessage({ type: 'disconnect' });

      if (response.success) {
        console.log('Disconnected');
      } else {
        this.showError(response.error || 'Failed to disconnect');
      }
    } catch (error) {
      console.error('Disconnect error:', error);
      this.showError(error.message);
    } finally {
      this.setButtonsEnabled(true);
    }
  }

  /**
   * Update UI based on state
   */
  updateUI(state) {
    // Update status indicator
    if (state.connected) {
      this.setStatus('connected', 'Connected');
    } else if (state.wsState === 'connecting') {
      this.setStatus('connecting', 'Connecting...');
    } else {
      this.setStatus('disconnected', 'Disconnected');
    }

    // Update WebSocket state
    this.elements.wsState.textContent = this.formatState(state.wsState);

    // Update debugger state
    this.elements.debuggerState.textContent = state.debuggerAttached
      ? `Attached to tab ${state.tabId}`
      : 'Not attached';

    // Update tab info
    if (state.tabId && state.tabUrl) {
      this.elements.tabTitle.textContent = state.tabTitle || 'Untitled';
      this.elements.tabUrl.textContent = state.tabUrl;
      this.elements.tabInfo.classList.add('visible');
    } else {
      this.elements.tabInfo.classList.remove('visible');
    }

    // Update connection button
    if (state.connected) {
      this.elements.connectionBtn.textContent = 'Disconnect';
      this.elements.connectionBtn.classList.remove('primary');
      this.elements.connectionBtn.classList.add('secondary');
      this.elements.gotoTabBtn.style.display = 'block';
    } else {
      this.elements.connectionBtn.textContent = 'Connect';
      this.elements.connectionBtn.classList.remove('secondary');
      this.elements.connectionBtn.classList.add('primary');
      this.elements.gotoTabBtn.style.display = 'none';
    }
  }

  /**
   * Set status display
   */
  setStatus(state, text) {
    this.elements.status.className = `status ${state}`;
    this.elements.statusText.textContent = text;
  }

  /**
   * Format state text
   */
  formatState(state) {
    const stateMap = {
      'connected': 'Connected',
      'connecting': 'Connecting...',
      'disconnected': 'Disconnected',
      'disconnecting': 'Disconnecting...',
      'error': 'Error'
    };

    return stateMap[state] || state;
  }

  /**
   * Enable/disable buttons
   */
  setButtonsEnabled(enabled) {
    this.elements.connectionBtn.disabled = !enabled;
    if (enabled) {
      // Reload state to update button text
      this.loadState();
    }
  }

  /**
   * Show error message
   */
  showError(message) {
    this.elements.error.textContent = message;
    this.elements.error.classList.add('visible');
  }

  /**
   * Hide error message
   */
  hideError() {
    this.elements.error.classList.remove('visible');
  }
}

// Initialize popup controller
const popup = new PopupController();

console.log('Browser MCP popup loaded');
