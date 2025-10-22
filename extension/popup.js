/**
 * Browser MCP - Popup UI Controller
 */

class PopupController {
  constructor() {
    this.elements = {
      status: document.getElementById('status'),
      statusText: document.getElementById('status-text'),
      connectionBtn: document.getElementById('connection-btn'),
      wsState: document.getElementById('ws-state'),
      debuggerState: document.getElementById('debugger-state'),
      tabsSection: document.getElementById('tabs-section'),
      tabsList: document.getElementById('tabs-list'),
      refreshTabsBtn: document.getElementById('refresh-tabs-btn'),
      error: document.getElementById('error')
    };

    this.currentState = null;
    this.windows = [];
    this.tabs = [];

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

    this.elements.refreshTabsBtn.addEventListener('click', () => {
      this.loadTabsAndWindows();
    });
  }

  /**
   * Load state from background worker
   */
  async loadState() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'get_state' });
      if (response.success) {
        this.currentState = response.data;
        this.updateUI(response.data);

        // Load tabs/windows if connected
        if (response.data.connected) {
          await this.loadTabsAndWindows();
        }
      }
    } catch (error) {
      console.error('Failed to load state:', error);
    }
  }

  /**
   * Load all tabs and windows
   */
  async loadTabsAndWindows() {
    try {
      // Get all windows with their tabs
      this.windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });

      // Flatten tabs list for easier access
      this.tabs = [];
      this.windows.forEach(window => {
        window.tabs.forEach(tab => {
          this.tabs.push({
            ...tab,
            windowId: window.id,
            windowFocused: window.focused
          });
        });
      });

      this.renderTabs();
    } catch (error) {
      console.error('Failed to load tabs:', error);
    }
  }

  /**
   * Render tabs grouped by window
   */
  renderTabs() {
    const container = this.elements.tabsList;
    container.innerHTML = '';

    if (this.windows.length === 0) {
      container.innerHTML = '<div class="no-tabs">No browser windows found</div>';
      return;
    }

    this.windows.forEach((window, index) => {
      const windowGroup = document.createElement('div');
      windowGroup.className = 'window-group';

      const windowTitle = document.createElement('div');
      windowTitle.className = 'window-title';
      windowTitle.textContent = `Window ${index + 1}${window.focused ? ' (Current)' : ''} - ${window.tabs.length} tabs`;
      windowGroup.appendChild(windowTitle);

      const tabList = document.createElement('ul');
      tabList.className = 'tab-list';

      window.tabs.forEach(tab => {
        const tabItem = document.createElement('li');
        tabItem.className = 'tab-item';

        // Highlight active tab in current window
        if (tab.active && window.focused) {
          tabItem.classList.add('active');
        }

        // Highlight attached tab
        if (this.currentState && tab.id === this.currentState.tabId) {
          tabItem.classList.add('attached');
        }

        const tabTitleDiv = document.createElement('div');
        tabTitleDiv.className = 'tab-item-title';

        const titleText = document.createElement('span');
        titleText.textContent = tab.title || 'Untitled';
        tabTitleDiv.appendChild(titleText);

        // Add badges
        const badges = document.createElement('span');
        if (tab.active && window.focused) {
          const activeBadge = document.createElement('span');
          activeBadge.className = 'tab-badge active';
          activeBadge.textContent = 'Current';
          badges.appendChild(activeBadge);
        }
        if (this.currentState && tab.id === this.currentState.tabId) {
          const attachedBadge = document.createElement('span');
          attachedBadge.className = 'tab-badge attached';
          attachedBadge.textContent = 'Attached';
          badges.appendChild(attachedBadge);
        }
        tabTitleDiv.appendChild(badges);

        const tabUrlDiv = document.createElement('div');
        tabUrlDiv.className = 'tab-item-url';
        tabUrlDiv.textContent = tab.url;

        tabItem.appendChild(tabTitleDiv);
        tabItem.appendChild(tabUrlDiv);

        // Click to attach to this tab
        tabItem.addEventListener('click', async () => {
          await this.attachToTab(tab.id);
        });

        tabList.appendChild(tabItem);
      });

      windowGroup.appendChild(tabList);
      container.appendChild(windowGroup);
    });
  }

  /**
   * Attach debugger to a specific tab
   */
  async attachToTab(tabId) {
    try {
      // Send message to background to attach to this tab
      const response = await chrome.runtime.sendMessage({
        type: 'ensure_attached',
        payload: { tabId }
      });

      if (response.success) {
        console.log('Successfully attached to tab:', tabId);
        // Switch to the tab
        await chrome.tabs.update(tabId, { active: true });
        const tab = await chrome.tabs.get(tabId);
        await chrome.windows.update(tab.windowId, { focused: true });

        // Refresh UI
        await this.loadState();
      } else {
        this.showError(response.error || 'Failed to attach to tab');
      }
    } catch (error) {
      console.error('Failed to attach to tab:', error);
      this.showError(error.message);
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

    // Show/hide tabs section based on connection status
    if (state.connected) {
      this.elements.tabsSection.style.display = 'block';
    } else {
      this.elements.tabsSection.style.display = 'none';
    }

    // Update connection button
    if (state.connected) {
      this.elements.connectionBtn.textContent = 'Disconnect';
      this.elements.connectionBtn.classList.remove('primary');
      this.elements.connectionBtn.classList.add('secondary');
    } else {
      this.elements.connectionBtn.textContent = 'Connect';
      this.elements.connectionBtn.classList.remove('secondary');
      this.elements.connectionBtn.classList.add('primary');
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
