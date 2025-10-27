/**
 * Browser MCP - Popup UI Controller
 */

class PopupController {
  constructor() {
    this.elements = {
      status: document.getElementById('status'),
      statusText: document.getElementById('status-text'),
      wsState: document.getElementById('ws-state'),
      debuggerState: document.getElementById('debugger-state'),
      attachedTabsSection: document.getElementById('attached-tabs-section'),
      attachedTabsList: document.getElementById('attached-tabs-list'),
      refreshAttachedTabsBtn: document.getElementById('refresh-attached-tabs-btn'),
      tabsSection: document.getElementById('tabs-section'),
      tabsList: document.getElementById('tabs-list'),
      refreshTabsBtn: document.getElementById('refresh-tabs-btn'),
      error: document.getElementById('error')
    };

    this.currentState = null;
    this.attachedTabs = [];
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
    this.elements.refreshTabsBtn.addEventListener('click', () => {
      this.loadTabsAndWindows();
    });

    this.elements.refreshAttachedTabsBtn.addEventListener('click', () => {
      this.loadAttachedTabs();
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
          await this.loadAttachedTabs();
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

      // Note: loadState() already calls loadAttachedTabs(), so we don't duplicate it here
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

    // Build set of attached tab IDs for fast lookup
    const attachedTabIds = new Set(this.attachedTabs.map(t => t.tabId));

    this.windows.forEach((window, index) => {
      // Filter out attached tabs
      const unattachedTabs = window.tabs.filter(tab => !attachedTabIds.has(tab.id));

      // Skip windows with no unattached tabs
      if (unattachedTabs.length === 0) {
        return;
      }

      const windowGroup = document.createElement('div');
      windowGroup.className = 'window-group';

      const windowTitle = document.createElement('div');
      windowTitle.className = 'window-title';
      windowTitle.textContent = `Window ${index + 1}${window.focused ? ' (Current)' : ''} - ${unattachedTabs.length} tabs`;
      windowGroup.appendChild(windowTitle);

      const tabList = document.createElement('ul');
      tabList.className = 'tab-list';

      unattachedTabs.forEach(tab => {
        const tabItem = document.createElement('li');
        tabItem.className = 'tab-item';

        // Highlight active tab in current window
        if (tab.active && window.focused) {
          tabItem.classList.add('active');
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
   * Load attached tabs from background
   */
  async loadAttachedTabs() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'list_attached_tabs'
      });

      if (response.success) {
        this.attachedTabs = response.tabs || [];
        this.renderAttachedTabs();
      } else {
        console.error('Failed to load attached tabs:', response.error);
      }
    } catch (error) {
      console.error('Failed to load attached tabs:', error);
    }
  }

  /**
   * Render attached tabs with label management UI
   */
  renderAttachedTabs() {
    const container = this.elements.attachedTabsList;
    container.innerHTML = '';

    if (this.attachedTabs.length === 0) {
      container.innerHTML = '<div class="no-tabs">No attached tabs</div>';
      return;
    }

    this.attachedTabs.forEach(tab => {
      const tabItem = document.createElement('div');
      tabItem.className = 'attached-tab-item';

      // Highlight active (last-used) tab
      if (tab.isActive) {
        tabItem.classList.add('active-tab');
      }

      // Header with label and controls
      const header = document.createElement('div');
      header.className = 'attached-tab-header';

      // Label (editable)
      const labelSpan = document.createElement('span');
      labelSpan.className = 'attached-tab-label';
      labelSpan.textContent = tab.label;
      labelSpan.title = 'Click to edit label';

      // Add active indicator if this is the last-used tab
      if (tab.isActive) {
        const activeIndicator = document.createElement('span');
        activeIndicator.className = 'active-indicator';
        activeIndicator.textContent = 'ACTIVE';
        labelSpan.appendChild(activeIndicator);
      }

      labelSpan.addEventListener('click', () => {
        this.editTabLabel(tab.tabId, labelSpan);
      });

      header.appendChild(labelSpan);

      // Controls
      const controls = document.createElement('div');
      controls.className = 'attached-tab-controls';

      // Detach button
      const detachBtn = document.createElement('button');
      detachBtn.className = 'detach-btn';
      detachBtn.textContent = 'Detach';
      detachBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.detachTab(tab.tabId);
      });

      controls.appendChild(detachBtn);
      header.appendChild(controls);

      tabItem.appendChild(header);

      // Tab info
      const info = document.createElement('div');
      info.className = 'attached-tab-info';
      info.textContent = `Tab ${tab.tabId} • ${tab.title}`;
      tabItem.appendChild(info);

      // URL
      const url = document.createElement('div');
      url.className = 'attached-tab-url';
      url.textContent = tab.url;
      tabItem.appendChild(url);

      container.appendChild(tabItem);
    });
  }

  /**
   * Edit tab label inline
   */
  editTabLabel(tabId, labelElement) {
    const currentLabel = labelElement.textContent.replace(' ACTIVE', '').trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentLabel;

    labelElement.textContent = '';
    labelElement.appendChild(input);
    input.focus();
    input.select();

    const saveLabel = async () => {
      const newLabel = input.value.trim();
      if (newLabel && newLabel !== currentLabel) {
        try {
          const response = await chrome.runtime.sendMessage({
            type: 'set_tab_label',
            payload: { tabId, label: newLabel }
          });

          if (response.success) {
            await this.loadAttachedTabs();
          } else {
            console.error('Failed to update label:', response.error);
            labelElement.textContent = currentLabel;
          }
        } catch (error) {
          console.error('Failed to update label:', error);
          labelElement.textContent = currentLabel;
        }
      } else {
        labelElement.textContent = currentLabel;
      }
    };

    input.addEventListener('blur', saveLabel);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveLabel();
      } else if (e.key === 'Escape') {
        labelElement.textContent = currentLabel;
      }
    });
  }

  /**
   * Detach from a specific tab
   */
  async detachTab(tabId) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'detach_tab',
        payload: { tabId }
      });

      if (response.success) {
        console.log('Successfully detached from tab:', tabId);
        await this.loadAttachedTabs();
        await this.loadState();
      } else {
        this.showError(response.error || 'Failed to detach from tab');
      }
    } catch (error) {
      console.error('Failed to detach from tab:', error);
      this.showError(error.message);
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

    // Show/hide tabs sections based on connection status
    if (state.connected) {
      this.elements.attachedTabsSection.style.display = 'block';
      this.elements.tabsSection.style.display = 'block';
    } else {
      this.elements.attachedTabsSection.style.display = 'none';
      this.elements.tabsSection.style.display = 'none';
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
