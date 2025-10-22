/**
 * Browser MCP - Background Service Worker
 * Central coordinator for WebSocket, Chrome Debugger, and message routing
 */

importScripts('utils/websocket-offscreen.js', 'utils/cdp.js');

// Global state for auto-connect
let offscreenReady = false;
let autoConnectAttempted = false;

/**
 * Background Interaction Recorder
 * Continuously records all user interactions in a circular buffer
 * Provides flexible querying, pruning, and searching capabilities
 */
class BackgroundRecorder {
  constructor(maxSize = 500) {
    this.buffer = [];
    this.maxSize = maxSize;
    this.enabled = true;
    this.actionIdCounter = 0;
  }

  /**
   * Add an interaction to the buffer
   */
  addAction(action) {
    if (!this.enabled) return;

    // Add timestamp and unique ID
    action.timestamp = Date.now();
    action.id = ++this.actionIdCounter;

    // Add to buffer
    this.buffer.push(action);

    // Maintain circular buffer
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  /**
   * Get interactions with flexible filtering
   */
  get(filters = {}) {
    let results = [...this.buffer];
    const now = Date.now();

    // Apply time filters (support negative offsets from now)
    if (filters.startTime !== undefined) {
      const startTime = filters.startTime < 0 ? now + filters.startTime : filters.startTime;
      results = results.filter(a => a.timestamp >= startTime);
    }
    if (filters.endTime !== undefined) {
      const endTime = filters.endTime < 0 ? now + filters.endTime : filters.endTime;
      results = results.filter(a => a.timestamp <= endTime);
    }

    // Apply type filters
    if (filters.types && filters.types.length > 0) {
      results = results.filter(a => filters.types.includes(a.type));
    }

    // Apply URL pattern filter
    if (filters.urlPattern) {
      const urlRegex = new RegExp(filters.urlPattern, 'i');
      results = results.filter(a => a.url && urlRegex.test(a.url));
    }

    // Apply selector pattern filter
    if (filters.selectorPattern) {
      const selectorRegex = new RegExp(filters.selectorPattern, 'i');
      results = results.filter(a => a.element && a.element.selector && selectorRegex.test(a.element.selector));
    }

    // Sort by timestamp
    const sortOrder = filters.sortOrder || 'desc';
    results.sort((a, b) => {
      return sortOrder === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
    });

    // Apply pagination
    const offset = filters.offset || 0;
    const limit = filters.limit || 50;
    const paginatedResults = results.slice(offset, offset + limit);

    return {
      interactions: paginatedResults,
      totalCount: results.length,
      bufferSize: this.buffer.length,
    };
  }

  /**
   * Prune interactions based on criteria
   */
  prune(filters = {}) {
    const originalLength = this.buffer.length;
    let toRemove = [];

    // Time-based pruning
    if (filters.before !== undefined) {
      toRemove = this.buffer.filter(a => a.timestamp < filters.before);
    }
    if (filters.after !== undefined) {
      toRemove = this.buffer.filter(a => a.timestamp > filters.after);
    }
    if (filters.between) {
      const [start, end] = filters.between;
      toRemove = this.buffer.filter(a => a.timestamp >= start && a.timestamp <= end);
    }

    // Count-based pruning
    if (filters.keepLast !== undefined) {
      const toKeep = this.buffer.slice(-filters.keepLast);
      this.buffer = toKeep;
      return {
        removedCount: originalLength - this.buffer.length,
        remainingCount: this.buffer.length,
      };
    }
    if (filters.keepFirst !== undefined) {
      const toKeep = this.buffer.slice(0, filters.keepFirst);
      this.buffer = toKeep;
      return {
        removedCount: originalLength - this.buffer.length,
        remainingCount: this.buffer.length,
      };
    }
    if (filters.removeOldest !== undefined) {
      this.buffer = this.buffer.slice(filters.removeOldest);
      return {
        removedCount: originalLength - this.buffer.length,
        remainingCount: this.buffer.length,
      };
    }

    // Type-based pruning
    if (filters.types && filters.types.length > 0) {
      toRemove = this.buffer.filter(a => filters.types.includes(a.type));
    }
    if (filters.excludeTypes && filters.excludeTypes.length > 0) {
      toRemove = this.buffer.filter(a => !filters.excludeTypes.includes(a.type));
    }

    // Pattern-based pruning
    if (filters.urlPattern) {
      const urlRegex = new RegExp(filters.urlPattern, 'i');
      toRemove = this.buffer.filter(a => a.url && urlRegex.test(a.url));
    }
    if (filters.selectorPattern) {
      const selectorRegex = new RegExp(filters.selectorPattern, 'i');
      toRemove = this.buffer.filter(a => a.element && a.element.selector && selectorRegex.test(a.element.selector));
    }

    // Remove the filtered actions
    if (toRemove.length > 0) {
      const removeIds = new Set(toRemove.map(a => a.id));
      this.buffer = this.buffer.filter(a => !removeIds.has(a.id));
    }

    return {
      removedCount: originalLength - this.buffer.length,
      remainingCount: this.buffer.length,
    };
  }

  /**
   * Search interactions by text query
   */
  search(query, filters = {}) {
    const queryLower = query.toLowerCase();
    let results = [];

    // Search across all relevant fields
    for (const action of this.buffer) {
      let matched = false;
      let matchedField = null;

      // Search in URL
      if (action.url && action.url.toLowerCase().includes(queryLower)) {
        matched = true;
        matchedField = 'url';
      }

      // Search in selector
      if (!matched && action.element && action.element.selector && action.element.selector.toLowerCase().includes(queryLower)) {
        matched = true;
        matchedField = 'selector';
      }

      // Search in element text
      if (!matched && action.element && action.element.text && action.element.text.toLowerCase().includes(queryLower)) {
        matched = true;
        matchedField = 'element.text';
      }

      // Search in value
      if (!matched && action.value && action.value.toLowerCase().includes(queryLower)) {
        matched = true;
        matchedField = 'value';
      }

      // Search in key
      if (!matched && action.key && action.key.toLowerCase().includes(queryLower)) {
        matched = true;
        matchedField = 'key';
      }

      if (matched) {
        results.push({ ...action, matchedField });
      }
    }

    // Apply additional filters
    const now = Date.now();
    if (filters.types && filters.types.length > 0) {
      results = results.filter(a => filters.types.includes(a.type));
    }
    if (filters.startTime !== undefined) {
      const startTime = filters.startTime < 0 ? now + filters.startTime : filters.startTime;
      results = results.filter(a => a.timestamp >= startTime);
    }
    if (filters.endTime !== undefined) {
      const endTime = filters.endTime < 0 ? now + filters.endTime : filters.endTime;
      results = results.filter(a => a.timestamp <= endTime);
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => b.timestamp - a.timestamp);

    // Apply limit
    const limit = filters.limit || 50;
    const limitedResults = results.slice(0, limit);

    return {
      interactions: limitedResults,
      totalMatches: results.length,
    };
  }

  /**
   * Clear all interactions
   */
  clear() {
    this.buffer = [];
    this.actionIdCounter = 0;
  }

  /**
   * Enable/disable recording
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Get current buffer stats
   */
  getStats() {
    return {
      bufferSize: this.buffer.length,
      maxSize: this.maxSize,
      enabled: this.enabled,
      oldestTimestamp: this.buffer.length > 0 ? this.buffer[0].timestamp : null,
      newestTimestamp: this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].timestamp : null,
    };
  }
}

/**
 * TabManager - Manages multiple tab attachments with labels
 * Handles CDP instances per tab, label generation, and tab resolution
 */
class TabManager {
  constructor() {
    this.attachedTabs = new Map(); // Map<tabId, TabInfo>
    this.labelCounter = new Map(); // Map<domain, number>
    this.lastUsedTabId = null;
  }

  /**
   * Generate a unique label for a tab based on its URL
   * Format: "domain.com" for first, "domain.com-2" for subsequent
   */
  generateLabel(url) {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace('www.', '');

      // Count existing tabs for this domain
      let count = 1;
      for (const tab of this.attachedTabs.values()) {
        try {
          const tabDomain = new URL(tab.url).hostname.replace('www.', '');
          if (tabDomain === domain) {
            count++;
          }
        } catch (e) {
          // Ignore invalid URLs
        }
      }

      // Return "domain.com" for first, "domain.com-2" for subsequent
      return count === 1 ? domain : `${domain}-${count}`;
    } catch (error) {
      // Fallback for invalid URLs
      console.warn('[TabManager] Invalid URL for label generation:', url);
      return `tab-${Date.now()}`;
    }
  }

  /**
   * Attach debugger to a tab
   * Creates new CDP instance and stores tab info
   */
  async attachTab(tabId, url, title) {
    // Check if already attached
    if (this.attachedTabs.has(tabId)) {
      console.log('[TabManager] Tab already attached:', tabId);
      return this.attachedTabs.get(tabId);
    }

    console.log('[TabManager] Attaching to tab:', tabId, url);

    // Generate label
    const label = this.generateLabel(url);

    // Create new CDP instance for this tab
    const cdp = new CDPHelper();
    await cdp.attach(tabId);

    const tabInfo = {
      tabId,
      label,
      url,
      title,
      attachedAt: Date.now(),
      lastUsedAt: Date.now(),
      cdp
    };

    this.attachedTabs.set(tabId, tabInfo);
    this.lastUsedTabId = tabId;

    console.log('[TabManager] Tab attached successfully:', label);
    return tabInfo;
  }

  /**
   * Detach debugger from a tab
   * Cleans up CDP instance
   */
  async detachTab(tabId) {
    const tabInfo = this.attachedTabs.get(tabId);
    if (!tabInfo) {
      console.warn('[TabManager] Tab not attached:', tabId);
      return;
    }

    console.log('[TabManager] Detaching from tab:', tabId, tabInfo.label);

    // Detach CDP
    try {
      await tabInfo.cdp.detach();
    } catch (error) {
      console.error('[TabManager] Error detaching CDP:', error);
    }

    // Remove from map
    this.attachedTabs.delete(tabId);

    // Update lastUsedTabId if needed
    if (this.lastUsedTabId === tabId) {
      const remaining = Array.from(this.attachedTabs.values());
      if (remaining.length > 0) {
        // Use the most recently used remaining tab
        remaining.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
        this.lastUsedTabId = remaining[0].tabId;
      } else {
        this.lastUsedTabId = null;
      }
    }

    console.log('[TabManager] Tab detached. Remaining tabs:', this.attachedTabs.size);
  }

  /**
   * Detach from all tabs
   */
  async detachAll() {
    console.log('[TabManager] Detaching from all tabs:', this.attachedTabs.size);
    const tabIds = Array.from(this.attachedTabs.keys());

    for (const tabId of tabIds) {
      await this.detachTab(tabId);
    }

    this.lastUsedTabId = null;
  }

  /**
   * Mark a tab as used (updates lastUsedAt timestamp)
   */
  markUsed(tabId) {
    const tabInfo = this.attachedTabs.get(tabId);
    if (tabInfo) {
      tabInfo.lastUsedAt = Date.now();
      this.lastUsedTabId = tabId;
    }
  }

  /**
   * Resolve tab ID or label to tab info
   * @param {number|string} tabIdOrLabel - Tab ID (number) or label (string)
   * @returns {Object|null} Tab info or null if not found
   */
  resolveTab(tabIdOrLabel) {
    // If number, lookup by tabId
    if (typeof tabIdOrLabel === 'number') {
      return this.attachedTabs.get(tabIdOrLabel) || null;
    }

    // If string, lookup by label
    for (const tabInfo of this.attachedTabs.values()) {
      if (tabInfo.label === tabIdOrLabel) {
        return tabInfo;
      }
    }

    return null;
  }

  /**
   * Get the active CDP instance for operations
   * @param {number|string} tabTarget - Optional tab ID or label. If not provided, uses last-used tab
   * @returns {CDPHelper|null} CDP instance or null if no tab available
   */
  getActiveCDP(tabTarget) {
    let tabInfo = null;

    if (tabTarget) {
      // Resolve specific tab
      tabInfo = this.resolveTab(tabTarget);
    } else if (this.lastUsedTabId) {
      // Use last-used tab
      tabInfo = this.attachedTabs.get(this.lastUsedTabId);
    }

    if (tabInfo) {
      // Mark as used
      this.markUsed(tabInfo.tabId);
    }

    return tabInfo?.cdp || null;
  }

  /**
   * Update tab label
   * @param {number} tabId - Tab ID
   * @param {string} newLabel - New label (must be unique)
   * @throws {Error} If label already in use
   */
  setTabLabel(tabId, newLabel) {
    const tabInfo = this.attachedTabs.get(tabId);
    if (!tabInfo) {
      throw new Error(`Tab ${tabId} is not attached`);
    }

    // Check label uniqueness
    for (const info of this.attachedTabs.values()) {
      if (info.label === newLabel && info.tabId !== tabId) {
        throw new Error(`Label "${newLabel}" is already in use by tab ${info.tabId}`);
      }
    }

    const oldLabel = tabInfo.label;
    tabInfo.label = newLabel;
    console.log('[TabManager] Tab label updated:', tabId, oldLabel, '->', newLabel);
  }

  /**
   * Get list of all attached tabs
   * @returns {Array} Array of tab info objects
   */
  listTabs() {
    return Array.from(this.attachedTabs.values()).map(t => ({
      tabId: t.tabId,
      label: t.label,
      url: t.url,
      title: t.title,
      attachedAt: t.attachedAt,
      lastUsedAt: t.lastUsedAt,
      isActive: t.tabId === this.lastUsedTabId
    }));
  }

  /**
   * Check if any tabs are attached
   */
  hasAttachedTabs() {
    return this.attachedTabs.size > 0;
  }

  /**
   * Get the last-used tab ID
   */
  getLastUsedTabId() {
    return this.lastUsedTabId;
  }
}

class BackgroundController {
  constructor() {
    this.ws = new WebSocketManager('ws://localhost:9010/ws');
    this.tabManager = new TabManager(); // NEW: Multi-tab manager
    this.cdp = new CDPHelper(); // DEPRECATED: Keep for backwards compatibility during migration
    this.handlers = {};
    this.consoleLogs = [];
    this.networkLogs = [];
    this.badgeBlinkInterval = null;
    this.recordingSessions = new Map(); // Track active recording sessions
    this.backgroundRecorder = new BackgroundRecorder(500); // Background interaction log
    this.state = {
      connected: false,
      tabId: null, // DEPRECATED: Use tabManager.lastUsedTabId instead
      tabUrl: null,
      tabTitle: null,
      originalTabTitle: null,
      temporarilyDetached: false // Track temporary detachments (e.g., extension popups)
    };

    this.keepaliveInterval = null; // Keepalive timer to maintain connection
    this.isReattaching = false; // Track if reattachment is in progress

    this.setupListeners();
    this.registerHandlers();

    // Initialize badge to disconnected state
    this.updateBadge(false);
  }

  /**
   * Check if a URL is restricted and cannot be debugged
   */
  isRestrictedUrl(url) {
    if (!url) return true;

    return (
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('edge://') ||
      url.startsWith('about:') ||
      url.startsWith('devtools://')
    );
  }

  /**
   * Find the first valid (non-restricted) tab
   */
  async findFirstValidTab() {
    const tabs = await chrome.tabs.query({});

    for (const tab of tabs) {
      if (!this.isRestrictedUrl(tab.url)) {
        console.log('[Background] Found valid tab:', tab.id, tab.url);
        return tab;
      }
    }

    throw new Error('No valid tabs found - all tabs have restricted URLs (chrome://, chrome-extension://, etc.)');
  }

  /**
   * Attempt to reattach debugger with exponential backoff retry logic
   * This handles cases where other extensions (like 1Password) temporarily interfere
   *
   * @param {number} tabId - The tab ID to reattach to
   * @param {number} attemptNumber - Current attempt number (0-indexed)
   * @param {number} maxAttempts - Maximum number of retry attempts (default: 5)
   */
  async attemptReattachWithRetry(tabId, attemptNumber, maxAttempts = 5) {
    const baseDelay = 500; // Start with 500ms
    const delay = baseDelay * Math.pow(2, attemptNumber); // Exponential backoff

    // Set reattaching flag on first attempt
    if (attemptNumber === 0) {
      this.isReattaching = true;
    }

    setTimeout(async () => {
      try {
        // Verify tab still exists
        const currentTab = await chrome.tabs.get(tabId);

        // Check if we're still tracking this tab
        if (!currentTab || this.state.tabId !== tabId) {
          console.log('[Background] Tab no longer tracked, aborting reattach');
          this.isReattaching = false;
          return;
        }

        // Check if tab is at a restricted URL (another extension interfering)
        if (this.isRestrictedUrl(currentTab.url)) {
          console.log(`[Background] Tab at restricted URL (${currentTab.url}), attempt ${attemptNumber + 1}/${maxAttempts}`);

          if (attemptNumber < maxAttempts - 1) {
            console.log(`[Background] Will retry reattachment in ${delay * 2}ms...`);
            this.attemptReattachWithRetry(tabId, attemptNumber + 1, maxAttempts);
            return;
          } else {
            console.error('[Background] Max reattachment attempts reached while tab at restricted URL');
            this.isReattaching = false;
            this.disconnect();
            return;
          }
        }

        // Tab is at a normal URL, attempt reattachment
        console.log(`[Background] Reattaching to tab ${tabId} (attempt ${attemptNumber + 1}/${maxAttempts}) at: ${currentTab.url}`);
        await this.cdp.attach(tabId);
        this.state.temporarilyDetached = false;
        this.isReattaching = false;
        console.log('[Background] Successfully reattached after detachment');

      } catch (error) {
        const errorMsg = error.message || '';

        // Check if error is due to restricted URL
        if (errorMsg.includes('chrome-extension://') || errorMsg.includes('Cannot access')) {
          console.log(`[Background] Reattachment blocked by extension interference (attempt ${attemptNumber + 1}/${maxAttempts})`);

          // Retry if we haven't exceeded max attempts
          if (attemptNumber < maxAttempts - 1) {
            const nextDelay = baseDelay * Math.pow(2, attemptNumber + 1);
            console.log(`[Background] Will retry reattachment in ${nextDelay}ms...`);
            this.attemptReattachWithRetry(tabId, attemptNumber + 1, maxAttempts);
            return;
          } else {
            console.error('[Background] Max reattachment attempts reached, giving up');
            this.isReattaching = false;
            this.disconnect();
            return;
          }
        }

        // Check if tab was actually closed
        try {
          await chrome.tabs.get(tabId);
          // Tab still exists but reattachment failed for other reason
          console.error('[Background] Reattachment failed with unexpected error:', error);

          if (attemptNumber < maxAttempts - 1) {
            console.log(`[Background] Will retry after unexpected error...`);
            this.attemptReattachWithRetry(tabId, attemptNumber + 1, maxAttempts);
            return;
          }
        } catch {
          // Tab was closed
          console.log('[Background] Tab was closed during reattachment attempt');
        }

        // Either tab was closed or we've exhausted retries
        console.log('[Background] Disconnecting after failed reattachment');
        this.isReattaching = false;
        this.disconnect();
      }
    }, delay);
  }

  /**
   * Setup event listeners
   */
  setupListeners() {
    // WebSocket state changes
    this.ws.onStateChange((state, data) => {
      console.log('[Background] WebSocket state:', state, data);
      this.updateConnectionState();

      // Handle incoming messages
      if (state === 'message') {
        this.handleMCPMessage(data);
      }
    });

    // Extension icon clicked
    chrome.action.onClicked.addListener(() => {
      // Popup will handle this, but we can add fallback behavior here
      console.log('[Background] Extension icon clicked');
    });

    // Tab closed/removed - enhanced detection with recording cleanup
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (this.state.tabId === tabId) {
        console.log('[Background] Active tab closed');
        this.handleTabClosed(tabId);
      }
    });

    // Tab updated (navigation, etc)
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (this.state.tabId === tabId) {
        if (changeInfo.url) {
          console.log('[Background] Tab URL changed to:', changeInfo.url);
          this.state.tabUrl = changeInfo.url;

          // If navigating to restricted URL while attached, mark as temporarily detached
          if (this.isRestrictedUrl(changeInfo.url) && this.cdp.isAttached()) {
            console.log('[Background] Navigating to restricted URL, will need to reattach after navigation');
            this.state.temporarilyDetached = true;
          }
        }

        // Re-attach debugger if we're in a temporary detachment state
        // Only attempt reattachment when page is fully loaded and not already attached
        if (changeInfo.status === 'complete' &&
            this.state.temporarilyDetached &&
            this.state.connected &&
            !this.cdp.isAttached()) {

          // Check if the URL is now accessible (not chrome-extension://)
          const url = tab.url || this.state.tabUrl;
          if (url && !this.isRestrictedUrl(url)) {
            console.log('[Background] Tab load complete, re-attaching debugger to:', url);
            try {
              await this.cdp.attach(tabId);
              this.state.temporarilyDetached = false;
              console.log('[Background] Debugger re-attached successfully');

              // Update stored title
              this.state.originalTabTitle = tab.title.startsWith('🟢 [MCP] ')
                ? tab.title.replace('🟢 [MCP] ', '')
                : tab.title;

              // Re-inject indicators and background capture
              await this.updateTabTitle();
              await this.injectTabIndicator();
              await this.injectBackgroundCapture();
            } catch (error) {
              console.error('[Background] Failed to re-attach debugger:', error);
              // If re-attachment fails after multiple attempts, disconnect
              if (error.message && error.message.includes('restricted URL')) {
                console.log('[Background] Cannot reattach to restricted URL, staying in temporary detachment');
              } else {
                console.error('[Background] Reattachment failed permanently, disconnecting');
                this.disconnect();
              }
            }
          } else {
            console.log('[Background] Tab still on restricted URL, not reattaching yet:', url);
          }
        }

        // Update title tracking when it changes (but ignore our own MCP prefix)
        if (changeInfo.title && this.state.connected) {
          // Only update if the title doesn't already have our MCP prefix
          if (!changeInfo.title.startsWith('🟢 [MCP]')) {
            this.state.originalTabTitle = changeInfo.title;
            this.updateTabTitle();
          }
        }
        // Re-inject indicator when page finishes loading
        // Only if debugger is attached (indicators require CDP)
        if (changeInfo.status === 'complete' && this.state.connected && this.cdp.isAttached()) {
          this.injectTabIndicator();
          this.injectBackgroundCapture(); // Always re-inject background capture on navigation

          // Re-inject overlay and content script if there's an active recording
          if (this.currentRecordingRequest) {
            const sessionId = this.currentRecordingRequest.sessionId;
            const session = this.recordingSessions.get(sessionId);
            if (session) {
              console.log('[Background] Re-injecting overlay and content script after navigation');

              // Re-inject overlay first
              chrome.scripting.executeScript({
                target: { tabId: this.state.tabId },
                files: ['recording-overlay.js']
              }).then(() => {
                // Restore the overlay with its current state
                const overlayState = {
                  state: this.currentRecordingRequest.state === 'active' ? 'recording' : 'waiting',
                  actionCount: this.currentRecordingRequest.actionCount || 0,
                  startTime: session.recordingStartTime || null,
                  position: { x: null, y: null }
                };

                chrome.scripting.executeScript({
                  target: { tabId: this.state.tabId },
                  func: (sessionId, request, state) => {
                    if (window.RecordingOverlay) {
                      window.mcpRecordingOverlay = new window.RecordingOverlay(sessionId, request, state);
                    }
                  },
                  args: [sessionId, session.request, overlayState]
                });
              }).catch(err => {
                console.error('[Background] Failed to re-inject overlay:', err);
              });

              // Re-inject content script if recording is active
              if (this.currentRecordingRequest.state === 'active') {
                chrome.scripting.executeScript({
                  target: { tabId: this.state.tabId },
                  files: ['content-script.js']
                }).then(() => {
                  // Wait a bit then send start message
                  setTimeout(() => {
                    chrome.scripting.executeScript({
                      target: { tabId: this.state.tabId },
                      func: (sessionId, request) => {
                        window.postMessage({
                          type: 'START_RECORDING',
                          data: { sessionId, request }
                        }, '*');
                      },
                      args: [sessionId, session.request]
                    });
                  }, 100);
                }).catch(err => {
                  console.error('[Background] Failed to re-inject content script:', err);
                });
              }
            }
          }
        }
      }
    });

    // Debugger detached
    chrome.debugger.onDetach.addListener(async (source, reason) => {
      if (source.tabId === this.state.tabId) {
        console.log('[Background] Debugger detached:', reason);

        // For 'target_closed', verify if the tab actually still exists
        // CDP can report 'target_closed' for many reasons besides actual tab closure:
        // - Page navigation within the same tab
        // - Frame destruction during page updates
        // - Dynamic content loading that creates/destroys frames
        // - Security-triggered detachments
        // - Redirects or error pages
        if (reason === 'target_closed') {
          try {
            const tab = await chrome.tabs.get(source.tabId);
            if (tab) {
              // Tab still exists! This is a temporary detachment, not actual closure
              console.log('[Background] Tab still exists despite target_closed event - treating as temporary detachment');
              console.log('[Background] Tab URL:', tab.url);

              // Treat as temporary detachment
              this.state.temporarilyDetached = true;
              this.cdp.target = null;
              this.cdp.isDetaching = false;
              this.cdp.enabledDomains.clear();

              // Attempt to reattach with retry logic to handle other extensions
              console.log('[Background] Will attempt to reattach to tab...');
              this.attemptReattachWithRetry(source.tabId, 0);

              return; // Don't disconnect
            }
          } catch (error) {
            // Tab doesn't exist - this is a real closure
            console.log('[Background] Tab no longer exists - confirming permanent detachment');
          }
        }

        // Handle other permanent reasons or confirmed tab closure
        const permanentReasons = ['canceled_by_user'];

        if (permanentReasons.includes(reason) || reason === 'target_closed') {
          // Permanent detachment - fully disconnect
          console.log('[Background] Permanent detachment, disconnecting completely');
          this.disconnect();
        } else {
          // Temporary detachment (e.g., navigation to chrome-extension:// URL)
          console.log('[Background] Temporary detachment, keeping connection state');
          this.state.temporarilyDetached = true;

          // Mark CDP as detached but keep state
          this.cdp.target = null;
          this.cdp.isDetaching = false;
          this.cdp.enabledDomains.clear();

          // Note: Tab navigation listener will attempt to re-attach when tab returns to normal URL
          console.log('[Background] Waiting for tab to navigate back to re-attach...');
        }
      }
    });

    // Messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Handle offscreen document ready signal
      if (message.type === 'OFFSCREEN_READY') {
        console.log('[Background] Offscreen document ready');
        offscreenReady = true;
        return false;
      }

      // Handle WebSocket messages from offscreen document
      if (message.type === 'WS_MESSAGE') {
        console.log('[Background] Received WS_MESSAGE from offscreen:', message.message?.type);
        this.handleMCPMessage(message.message);
        return false;
      }

      // Handle background interaction capture
      // Always accept interactions, even when not connected, so we don't lose data
      if (message.type === 'BACKGROUND_INTERACTION') {
        this.backgroundRecorder.addAction(message.interaction);
        return false; // Synchronous response - no need to keep channel open
      }

      // Only handle popup-specific messages here
      const popupMessages = ['connect', 'disconnect', 'get_state', 'ensure_attached'];
      if (popupMessages.includes(message.type)) {
        this.handlePopupMessage(message, sendResponse);
        return true; // Keep channel open for async response
      }
      // Let other listeners handle recording messages
      return false;
    });

    // Notification button clicks
    // Console API called (for console log collection)
    chrome.debugger.onEvent.addListener(async (source, method, params) => {
      if (source.tabId === this.state.tabId) {
        if (method === 'Console.messageAdded') {
          this.consoleLogs.push({
            level: params.message.level,
            text: params.message.text,
            timestamp: Date.now()
          });
        }

        // Page navigation events - track navigations to prevent disconnection
        if (method === 'Page.frameNavigated' && params.frame.parentId === undefined) {
          // Main frame navigated
          console.log('[Background] Main frame navigated to:', params.frame.url);
          this.state.tabUrl = params.frame.url;

          // Check if we need to reattach after navigation to restricted URL
          if (this.state.temporarilyDetached) {
            if (!this.isRestrictedUrl(params.frame.url)) {
              console.log('[Background] Navigation returned from restricted URL, will reattach...');
              // Wait a bit for page to stabilize before reattaching
              setTimeout(async () => {
                try {
                  if (this.state.temporarilyDetached && this.state.connected) {
                    await this.cdp.attach(this.state.tabId);
                    this.state.temporarilyDetached = false;
                    console.log('[Background] Debugger re-attached after navigation');

                    // Get current tab and update title
                    const tab = await chrome.tabs.get(this.state.tabId);
                    this.state.originalTabTitle = tab.title.startsWith('🟢 [MCP] ')
                      ? tab.title.replace('🟢 [MCP] ', '')
                      : tab.title;

                    // Re-inject indicators
                    await this.updateTabTitle();
                    await this.injectTabIndicator();
                    await this.injectBackgroundCapture();
                  }
                } catch (error) {
                  console.error('[Background] Failed to reattach after navigation:', error);
                }
              }, 500);
            }
          }
        }

        if (method === 'Page.loadEventFired') {
          console.log('[Background] Page load completed');
        }

        // Network events (for network log collection)
        if (method === 'Network.requestWillBeSent') {
          this.networkLogs.push({
            type: 'request',
            requestId: params.requestId,
            url: params.request.url,
            method: params.request.method,
            headers: params.request.headers,
            timestamp: Date.now()
          });
        }

        if (method === 'Network.responseReceived') {
          // Find the matching request and add response info
          const request = this.networkLogs.find(
            log => log.requestId === params.requestId && log.type === 'request'
          );
          if (request) {
            request.response = {
              status: params.response.status,
              statusText: params.response.statusText,
              headers: params.response.headers,
              mimeType: params.response.mimeType
            };
          }
        }
      }
    });
  }

  /**
   * Register message handlers for all MCP tools
   */
  registerHandlers() {
    // We'll import handlers from separate files
    // For now, define inline handlers as placeholders

    // Connection/Attachment handlers
    this.handlers['browser_ensure_attached'] = this.handleEnsureAttached.bind(this);

    // Navigation handlers
    this.handlers['browser_navigate'] = this.handleNavigate.bind(this);
    this.handlers['browser_go_back'] = this.handleGoBack.bind(this);
    this.handlers['browser_go_forward'] = this.handleGoForward.bind(this);
    this.handlers['browser_wait'] = this.handleWait.bind(this);

    // Interaction handlers
    this.handlers['browser_click'] = this.handleClick.bind(this);
    this.handlers['browser_type'] = this.handleType.bind(this);
    this.handlers['browser_hover'] = this.handleHover.bind(this);
    this.handlers['browser_drag'] = this.handleDrag.bind(this);
    this.handlers['browser_select_option'] = this.handleSelectOption.bind(this);
    this.handlers['browser_press_key'] = this.handlePressKey.bind(this);
    this.handlers['browser_scroll'] = this.handleScroll.bind(this);
    this.handlers['browser_scroll_to_element'] = this.handleScrollToElement.bind(this);

    // Realistic input handlers (CDP-based)
    this.handlers['browser_realistic_mouse_move'] = this.handleRealisticMouseMove.bind(this);
    this.handlers['browser_realistic_click'] = this.handleRealisticClick.bind(this);
    this.handlers['browser_realistic_type'] = this.handleRealisticType.bind(this);

    // Tab management handlers
    this.handlers['browser_list_tabs'] = this.handleListTabs.bind(this);
    this.handlers['browser_switch_tab'] = this.handleSwitchTab.bind(this);
    this.handlers['browser_create_tab'] = this.handleCreateTab.bind(this);
    this.handlers['browser_close_tab'] = this.handleCloseTab.bind(this);

    // Multi-tab management handlers (NEW)
    this.handlers['browser_list_attached_tabs'] = this.handleListAttachedTabs.bind(this);
    this.handlers['browser_set_tab_label'] = this.handleSetTabLabel.bind(this);
    this.handlers['browser_detach_tab'] = this.handleDetachTab.bind(this);
    this.handlers['browser_get_active_tab'] = this.handleGetActiveTab.bind(this);

    // Form handlers
    this.handlers['browser_fill_form'] = this.handleFillForm.bind(this);
    this.handlers['browser_submit_form'] = this.handleSubmitForm.bind(this);

    // Information handlers
    this.handlers['browser_snapshot'] = this.handleSnapshot.bind(this);
    this.handlers['browser_screenshot'] = this.handleScreenshot.bind(this);
    this.handlers['browser_get_console_logs'] = this.handleGetConsoleLogs.bind(this);
    this.handlers['browser_get_network_logs'] = this.handleGetNetworkLogs.bind(this);
    this.handlers['browser_evaluate'] = this.handleEvaluate.bind(this);
    this.handlers['getUrl'] = this.handleGetUrl.bind(this);
    this.handlers['getTitle'] = this.handleGetTitle.bind(this);

    // DOM exploration handlers
    this.handlers['browser_query_dom'] = this.handleQueryDOM.bind(this);
    this.handlers['browser_get_visible_text'] = this.handleGetVisibleText.bind(this);
    this.handlers['browser_get_computed_styles'] = this.handleGetComputedStyles.bind(this);
    this.handlers['browser_check_visibility'] = this.handleCheckVisibility.bind(this);
    this.handlers['browser_get_attributes'] = this.handleGetAttributes.bind(this);
    this.handlers['browser_count_elements'] = this.handleCountElements.bind(this);
    this.handlers['browser_get_page_metadata'] = this.handleGetPageMetadata.bind(this);
    this.handlers['browser_get_filtered_aria_tree'] = this.handleGetFilteredAriaTree.bind(this);
    this.handlers['browser_find_by_text'] = this.handleFindByText.bind(this);
    this.handlers['browser_get_form_values'] = this.handleGetFormValues.bind(this);
    this.handlers['browser_check_element_state'] = this.handleCheckElementState.bind(this);

    // Recording/Learning handlers
    this.handlers['browser_request_user_action'] = this.handleRequestUserAction.bind(this);

    // Background interaction log handlers
    this.handlers['browser_get_interactions'] = this.handleGetInteractions.bind(this);
    this.handlers['browser_prune_interactions'] = this.handlePruneInteractions.bind(this);
    this.handlers['browser_search_interactions'] = this.handleSearchInteractions.bind(this);

    // Cookie management handlers
    this.handlers['browser_get_cookies'] = this.handleGetCookies.bind(this);
    this.handlers['browser_set_cookie'] = this.handleSetCookie.bind(this);
    this.handlers['browser_delete_cookie'] = this.handleDeleteCookie.bind(this);
    this.handlers['browser_clear_cookies'] = this.handleClearCookies.bind(this);

    // Download management handlers
    this.handlers['browser_download_file'] = this.handleDownloadFile.bind(this);
    this.handlers['browser_get_downloads'] = this.handleGetDownloads.bind(this);
    this.handlers['browser_cancel_download'] = this.handleCancelDownload.bind(this);
    this.handlers['browser_open_download'] = this.handleOpenDownload.bind(this);

    // Clipboard handlers
    this.handlers['browser_get_clipboard'] = this.handleGetClipboard.bind(this);
    this.handlers['browser_set_clipboard'] = this.handleSetClipboard.bind(this);

    // History handlers
    this.handlers['browser_search_history'] = this.handleSearchHistory.bind(this);
    this.handlers['browser_get_history_visits'] = this.handleGetHistoryVisits.bind(this);
    this.handlers['browser_delete_history'] = this.handleDeleteHistory.bind(this);
    this.handlers['browser_clear_history'] = this.handleClearHistory.bind(this);

    // System information handlers
    this.handlers['browser_get_version'] = this.handleGetVersion.bind(this);
    this.handlers['browser_get_system_info'] = this.handleGetSystemInfo.bind(this);
    this.handlers['browser_get_browser_info'] = this.handleGetBrowserInfo.bind(this);

    // Network handlers
    this.handlers['browser_get_network_state'] = this.handleGetNetworkState.bind(this);
    this.handlers['browser_set_network_conditions'] = this.handleSetNetworkConditions.bind(this);
    this.handlers['browser_clear_cache'] = this.handleClearCache.bind(this);

    // Bookmark handlers
    this.handlers['browser_get_bookmarks'] = this.handleGetBookmarks.bind(this);
    this.handlers['browser_create_bookmark'] = this.handleCreateBookmark.bind(this);
    this.handlers['browser_delete_bookmark'] = this.handleDeleteBookmark.bind(this);
    this.handlers['browser_search_bookmarks'] = this.handleSearchBookmarks.bind(this);

    // Extension management handlers
    this.handlers['browser_list_extensions'] = this.handleListExtensions.bind(this);
    this.handlers['browser_get_extension_info'] = this.handleGetExtensionInfo.bind(this);
    this.handlers['browser_enable_extension'] = this.handleEnableExtension.bind(this);
    this.handlers['browser_disable_extension'] = this.handleDisableExtension.bind(this);

    console.log('[Background] Registered', Object.keys(this.handlers).length, 'handlers');
  }

  /**
   * Connect to MCP server via WebSocket
   * Debugger attachment is deferred until first tool use (lazy attachment)
   */
  async connect() {
    try {
      console.log('[Background] Connecting to MCP server...');

      // Connect WebSocket (no debugger attachment yet - lazy attachment)
      this.ws.connect();

      // Update state - connected now means WebSocket connected
      // Debugger will be attached on-demand via ensureAttached()
      this.state.connected = true;
      this.consoleLogs = [];
      this.networkLogs = [];

      this.updateConnectionState();

      // Start keepalive mechanism to maintain debugger connection
      this.startKeepalive();

      console.log('[Background] Connected to MCP server (WebSocket only, debugger will attach on first tool use)');

      return { success: true, message: 'Connected to MCP server. Debugger will attach on first tool use.' };
    } catch (error) {
      console.error('[Background] Connection failed:', error);
      await this.disconnect();
      throw error;
    }
  }

  /**
   * Disconnect from MCP server and detach debugger
   */
  async disconnect() {
    console.log('[Background] Disconnecting...');
    console.log('[Background] Current state:', {
      tabId: this.state.tabId,
      connected: this.state.connected,
      cdpAttached: this.cdp.isAttached()
    });

    // Set connected to false FIRST to prevent event listeners from re-adding indicators
    this.state.connected = false;

    // Stop keepalive mechanism
    this.stopKeepalive();

    // Clean up ALL tabs (not just the active one)
    // This handles cases where indicators were left behind after crashes
    await this.removeAllTabPrefixes();
    await this.removeAllTabIndicators();

    this.ws.disconnect();
    await this.cdp.detach();

    this.state.tabId = null;
    this.state.tabUrl = null;
    this.state.tabTitle = null;
    this.state.originalTabTitle = null;
    this.state.temporarilyDetached = false;
    this.consoleLogs = [];
    this.networkLogs = [];
    this.backgroundRecorder.clear(); // Clear background interaction log

    this.updateConnectionState();
    console.log('[Background] Disconnect complete');
  }

  /**
   * Start keepalive mechanism to maintain debugger connection
   * Periodically checks connection state and reattaches if needed
   */
  startKeepalive() {
    // Clear any existing keepalive interval
    this.stopKeepalive();

    console.log('[Background] Starting keepalive mechanism (checks every 2 seconds)');

    this.keepaliveInterval = setInterval(async () => {
      // Only run keepalive if we're connected and have a tab
      if (!this.state.connected || !this.state.tabId) {
        return;
      }

      // Check if we're in a temporarily detached state
      // Skip if reattachment is already in progress (from target_closed handler)
      if (this.state.temporarilyDetached && !this.cdp.isAttached() && !this.isReattaching) {
        console.log('[Background] Keepalive detected temporarily detached state, attempting reattachment...');

        try {
          // Get current tab info
          const tab = await chrome.tabs.get(this.state.tabId);

          // Only reattach if URL is accessible
          if (tab && tab.url && !this.isRestrictedUrl(tab.url)) {
            console.log('[Background] Keepalive reattaching to:', tab.url);
            await this.cdp.attach(this.state.tabId);
            this.state.temporarilyDetached = false;
            console.log('[Background] Keepalive reattachment successful');

            // Update stored URL and title
            this.state.tabUrl = tab.url;
            this.state.originalTabTitle = tab.title.startsWith('🟢 [MCP] ')
              ? tab.title.replace('🟢 [MCP] ', '')
              : tab.title;

            // Re-inject indicators
            await this.updateTabTitle();
            await this.injectTabIndicator();
            await this.injectBackgroundCapture();
          } else {
            console.log('[Background] Keepalive skipping reattachment - tab still on restricted URL:', tab?.url);
          }
        } catch (error) {
          console.error('[Background] Keepalive reattachment failed:', error);
          // Don't disconnect on keepalive failure - let the normal error handling deal with it
        }
      }
    }, 2000); // Check every 2 seconds
  }

  /**
   * Stop keepalive mechanism
   */
  stopKeepalive() {
    if (this.keepaliveInterval) {
      console.log('[Background] Stopping keepalive mechanism');
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  /**
   * Handle tab closure with proper cleanup
   * Cleans up recording sessions, user action requests, and disconnects gracefully
   * @param {number} tabId - The ID of the closed tab
   */
  async handleTabClosed(tabId) {
    console.log('[Background] handleTabClosed called for tab:', tabId);

    // Check if there's an active recording session
    if (this.currentRecordingRequest) {
      const sessionId = this.currentRecordingRequest.sessionId;
      const session = this.recordingSessions.get(sessionId);

      console.log('[Background] Active recording session detected, cancelling:', sessionId);

      // Cancel the recording session
      if (session && session.reject) {
        session.reject(new Error('Tab closed during recording'));
      }

      // Clean up recording state
      this.recordingSessions.delete(sessionId);
      this.currentRecordingRequest = null;
      chrome.action.setBadgeText({ text: '' });

      console.log('[Background] Recording session cleaned up');
    }

    // Check if there's an active user action request
    if (this.currentUserActionRequest) {
      const requestId = this.currentUserActionRequest.requestId;
      const navListener = this.currentUserActionRequest.navigationListener;

      console.log('[Background] Active user action request detected, cancelling:', requestId);

      // Remove navigation listener if it exists
      if (navListener) {
        chrome.webNavigation.onCommitted.removeListener(navListener);
        console.log('[Background] Navigation listener removed');
      }

      // Send cancellation notification through WebSocket if still connected
      if (this.ws && this.state.connected) {
        try {
          await this.ws.send(JSON.stringify({
            type: 'notification',
            method: 'notifications/cancelled',
            params: {
              reason: 'Tab closed during user action request',
              requestId: requestId
            }
          }));
        } catch (error) {
          console.error('[Background] Failed to send cancellation notification:', error);
        }
      }

      // Clean up user action request
      this.currentUserActionRequest = null;

      console.log('[Background] User action request cleaned up');
    }

    // Disconnect normally
    console.log('[Background] Tab closed, initiating disconnect...');
    await this.disconnect();

    console.log('[Background] Tab closure cleanup complete');
  }

  /**
   * Ensure debugger is attached to a tab (lazy attachment with multi-tab support)
   * Supports attaching by tabId, label, or auto-opening a new tab
   *
   * @param {Object} payload - { tabId?: number, label?: string, autoOpenUrl?: string }
   * @returns {Object} - { tabId: number, label: string }
   */
  async handleEnsureAttached({ tabId, label, autoOpenUrl }) {
    try {
      let targetTabId = tabId;

      // Resolve label to tabId if provided
      if (!targetTabId && label) {
        const tabInfo = this.tabManager.resolveTab(label);
        if (!tabInfo) {
          throw new Error(`No tab found with label: ${label}`);
        }
        targetTabId = tabInfo.tabId;
        console.log('[Background] Resolved label', label, 'to tab', targetTabId);
      }

      // If no target specified, use last-used tab
      if (!targetTabId) {
        targetTabId = this.tabManager.getLastUsedTabId();
        if (targetTabId) {
          console.log('[Background] Using last-used tab:', targetTabId);
        }
      }

      // If STILL no target and autoOpenUrl provided, create new tab
      if (!targetTabId && autoOpenUrl) {
        console.log('[Background] No tabs attached, creating new tab with URL:', autoOpenUrl);
        const newTab = await chrome.tabs.create({ url: autoOpenUrl, active: true });
        targetTabId = newTab.id;

        // Wait for tab to load
        await new Promise((resolve) => {
          const listener = (tabId, changeInfo) => {
            if (tabId === targetTabId && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);

          // Timeout after 30 seconds
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 30000);
        });

        console.log('[Background] New tab created and loaded:', targetTabId);
      }

      // If STILL no target, error
      if (!targetTabId) {
        throw new Error('No tab available. Provide tabId, label, or autoOpenUrl.');
      }

      // Check if already attached to this tab (idempotent)
      if (this.tabManager.attachedTabs.has(targetTabId)) {
        console.log('[Background] Already attached to tab:', targetTabId);
        this.tabManager.markUsed(targetTabId);
        const tabInfo = this.tabManager.attachedTabs.get(targetTabId);

        // Update state for backwards compatibility
        this.state.tabId = targetTabId;
        this.state.tabUrl = tabInfo.url;
        this.state.tabTitle = tabInfo.title;

        return { tabId: targetTabId, label: tabInfo.label };
      }

      // Get tab info
      let tab = await chrome.tabs.get(targetTabId);
      if (!tab) {
        throw new Error(`Tab ${targetTabId} not found`);
      }

      // Check if the target tab has a restricted URL
      if (this.isRestrictedUrl(tab.url)) {
        console.warn('[Background] Cannot attach to restricted URL:', tab.url);
        console.log('[Background] Searching for first valid tab...');

        // Find the first valid tab
        const validTab = await this.findFirstValidTab();
        targetTabId = validTab.id;
        tab = validTab;

        console.log('[Background] Switched to valid tab:', targetTabId, tab.url);
      }

      console.log('[Background] Attaching to tab:', targetTabId, tab.url);

      // Attach using TabManager (creates new CDP instance)
      const tabInfo = await this.tabManager.attachTab(targetTabId, tab.url, tab.title);

      // Update state for backwards compatibility
      this.state.tabId = targetTabId;
      this.state.tabUrl = tab.url;
      this.state.tabTitle = tab.title;
      this.state.originalTabTitle = tab.title.startsWith('🟢 [MCP] ')
        ? tab.title.replace('🟢 [MCP] ', '')
        : tab.title;

      // Inject indicators and background capture
      console.log('[Background] Injecting indicators and background capture...');
      await this.injectTabIndicator(targetTabId);
      await this.injectBackgroundCapture(targetTabId);

      console.log('[Background] Successfully attached to tab:', targetTabId, 'with label:', tabInfo.label);

      return { tabId: targetTabId, label: tabInfo.label };
    } catch (error) {
      console.error('[Background] ensureAttached failed:', error);
      throw error;
    }
  }

  /**
   * List all attached tabs with their labels
   */
  async handleListAttachedTabs() {
    try {
      const tabs = this.tabManager.listTabs();
      return { tabs };
    } catch (error) {
      console.error('[Background] handleListAttachedTabs failed:', error);
      throw error;
    }
  }

  /**
   * Set or update a tab's label
   */
  async handleSetTabLabel({ tabId, label }) {
    try {
      if (!tabId || !label) {
        throw new Error('Both tabId and label are required');
      }

      // Ensure the tab is attached
      const tabInfo = this.tabManager.attachedTabs.get(tabId);
      if (!tabInfo) {
        throw new Error(`Tab ${tabId} is not attached`);
      }

      // Update the label
      this.tabManager.setTabLabel(tabId, label);

      return {
        tabId,
        label,
        success: true
      };
    } catch (error) {
      console.error('[Background] handleSetTabLabel failed:', error);
      throw error;
    }
  }

  /**
   * Detach debugger from a specific tab
   */
  async handleDetachTab({ tabId }) {
    try {
      if (!tabId) {
        throw new Error('tabId is required');
      }

      // Check if tab is attached
      const tabInfo = this.tabManager.attachedTabs.get(tabId);
      if (!tabInfo) {
        console.warn('[Background] Tab not attached:', tabId);
        return { success: true, message: 'Tab was not attached' };
      }

      console.log('[Background] Detaching from tab:', tabId, 'label:', tabInfo.label);

      // Detach using TabManager
      await this.tabManager.detachTab(tabId);

      // If this was the active tab, clear backwards-compatible state
      if (this.state.tabId === tabId) {
        this.state.tabId = null;
        this.state.tabUrl = null;
        this.state.tabTitle = null;
        this.state.originalTabTitle = null;
      }

      console.log('[Background] Successfully detached from tab:', tabId);

      return {
        success: true,
        tabId,
        detachedLabel: tabInfo.label
      };
    } catch (error) {
      console.error('[Background] handleDetachTab failed:', error);
      throw error;
    }
  }

  /**
   * Get the currently active (last-used) tab
   */
  async handleGetActiveTab() {
    try {
      const lastUsedTabId = this.tabManager.getLastUsedTabId();

      if (!lastUsedTabId) {
        return {
          hasActiveTab: false,
          message: 'No tabs currently attached'
        };
      }

      const tabInfo = this.tabManager.attachedTabs.get(lastUsedTabId);

      return {
        hasActiveTab: true,
        tabId: lastUsedTabId,
        label: tabInfo.label,
        url: tabInfo.url,
        title: tabInfo.title,
        lastUsedAt: tabInfo.lastUsedAt
      };
    } catch (error) {
      console.error('[Background] handleGetActiveTab failed:', error);
      throw error;
    }
  }

  /**
   * Update connection state and notify popup
   */
  async updateConnectionState() {
    const state = {
      connected: this.state.connected,
      wsState: await this.ws.getState(),
      debuggerAttached: this.cdp.isAttached(),
      tabId: this.state.tabId,
      tabUrl: this.state.tabUrl,
      tabTitle: this.state.tabTitle
    };

    // Store state for popup to retrieve
    chrome.storage.local.set({ connectionState: state });

    // Notify popup if it's open
    chrome.runtime.sendMessage({ type: 'state_change', state }).catch(() => {
      // Popup might not be open, ignore error
    });

    // Update extension badge
    this.updateBadge(state.connected);
  }

  /**
   * Update extension badge based on connection state
   */
  updateBadge(connected) {
    if (connected) {
      // Connected: blinking green badge
      this.startBadgeBlink();
    } else {
      // Disconnected: solid red badge
      this.stopBadgeBlink();
      chrome.action.setBadgeText({ text: '●' });
      chrome.action.setBadgeBackgroundColor({ color: '#dc2626' }); // Red
    }
  }

  /**
   * Start blinking green badge animation
   */
  startBadgeBlink() {
    // Stop any existing blink
    this.stopBadgeBlink();

    let visible = true;
    this.badgeBlinkInterval = setInterval(() => {
      chrome.action.setBadgeText({ text: visible ? '●' : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' }); // Green
      visible = !visible;
    }, 800); // Blink every 800ms
  }

  /**
   * Stop badge blinking animation
   */
  stopBadgeBlink() {
    if (this.badgeBlinkInterval) {
      clearInterval(this.badgeBlinkInterval);
      this.badgeBlinkInterval = null;
    }
  }

  /**
   * Update tab title to show MCP connection indicator
   */
  async updateTabTitle() {
    if (!this.state.tabId || !this.state.originalTabTitle) return;

    // Only update title if debugger is attached and not detaching
    if (!this.cdp.isAttached() || this.cdp.isDetaching) {
      return;
    }

    try {
      // Don't add prefix if it's already there
      if (this.state.originalTabTitle.startsWith('🟢 [MCP]')) {
        return;
      }

      const newTitle = `🟢 [MCP] ${this.state.originalTabTitle}`;
      await this.cdp.evaluate(`document.title = ${JSON.stringify(newTitle)}`, true);
      console.log('[Background] Tab title updated with MCP indicator');
    } catch (error) {
      console.error('[Background] Failed to update tab title:', error);
    }
  }

  /**
   * Restore original tab title (remove MCP indicator)
   */
  async restoreTabTitle() {
    if (!this.state.tabId) {
      console.log('[Background] restoreTabTitle: No tabId, skipping');
      return;
    }

    console.log('[Background] restoreTabTitle: Starting cleanup');
    console.log('[Background] restoreTabTitle: CDP attached?', this.cdp.isAttached());
    console.log('[Background] restoreTabTitle: CDP detaching?', this.cdp.isDetaching);

    try {
      // Try using CDP only if debugger is attached AND not detaching
      if (this.cdp.isAttached() && !this.cdp.isDetaching) {
        console.log('[Background] restoreTabTitle: Using CDP path');
        await this.cdp.evaluate(`
          if (document.title.startsWith('🟢 [MCP] ')) {
            document.title = document.title.replace('🟢 [MCP] ', '');
          }
        `, true);
        console.log('[Background] restoreTabTitle: CDP cleanup successful');
      } else {
        // Use chrome.scripting if debugger already detached or detaching
        console.log('[Background] restoreTabTitle: Using chrome.scripting fallback');
        console.log('[Background] restoreTabTitle: Target tabId:', this.state.tabId);

        const result = await chrome.scripting.executeScript({
          target: { tabId: this.state.tabId },
          func: () => {
            console.log('[Page] restoreTabTitle: Executing in page context');
            console.log('[Page] restoreTabTitle: Current title:', document.title);
            if (document.title.startsWith('🟢 [MCP] ')) {
              document.title = document.title.replace('🟢 [MCP] ', '');
              console.log('[Page] restoreTabTitle: Title updated to:', document.title);
              return { success: true, newTitle: document.title };
            }
            return { success: false, reason: 'Title does not have MCP prefix' };
          }
        });

        console.log('[Background] restoreTabTitle: chrome.scripting result:', result);
        console.log('[Background] restoreTabTitle: Fallback cleanup successful');
      }
      console.log('[Background] Tab title restored');
    } catch (error) {
      // Log but don't throw - cleanup should be best-effort
      console.warn('[Background] Failed to restore tab title (non-fatal):', error.message);
    }
  }

  /**
   * Remove MCP prefix from all tabs
   * Used when switching tabs to ensure only the active tab has the prefix
   */
  async removeAllTabPrefixes() {
    console.log('[Background] Removing MCP prefix from all tabs');

    try {
      // Get all tabs
      const tabs = await chrome.tabs.query({});

      // Remove prefix from each tab that has it
      for (const tab of tabs) {
        // Skip if title doesn't have the prefix
        if (!tab.title || !tab.title.startsWith('🟢 [MCP] ')) {
          continue;
        }

        try {
          // Use chrome.scripting to remove prefix
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              if (document.title.startsWith('🟢 [MCP] ')) {
                document.title = document.title.replace('🟢 [MCP] ', '');
              }
            }
          });
          console.log(`[Background] Removed MCP prefix from tab ${tab.id}`);
        } catch (error) {
          // Tab may be restricted or unavailable - skip
          console.warn(`[Background] Could not remove prefix from tab ${tab.id}:`, error.message);
        }
      }
    } catch (error) {
      console.warn('[Background] Failed to remove all tab prefixes (non-fatal):', error.message);
    }
  }

  /**
   * Remove MCP indicator from all tabs
   * Used when switching tabs and for cleanup after crashes
   */
  async removeAllTabIndicators() {
    console.log('[Background] Removing MCP indicator from all tabs');

    try {
      // Get all tabs
      const tabs = await chrome.tabs.query({});

      // Remove indicator from each tab
      for (const tab of tabs) {
        try {
          // Use chrome.scripting to remove indicator
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const indicator = document.getElementById('browser-mcp-indicator');
              if (indicator) {
                indicator.remove();
                console.log('[Page] MCP indicator removed');
              }
            }
          });
          console.log(`[Background] Removed MCP indicator from tab ${tab.id}`);
        } catch (error) {
          // Tab may be restricted or unavailable - skip
          console.warn(`[Background] Could not remove indicator from tab ${tab.id}:`, error.message);
        }
      }
    } catch (error) {
      console.warn('[Background] Failed to remove all tab indicators (non-fatal):', error.message);
    }
  }

  /**
   * Cleanup on extension startup/reload
   * Removes all MCP prefixes and indicators from all tabs
   * Ensures clean state on startup
   * Optionally adds indicators to a specific tab after cleanup
   */
  async cleanupOnStartup(activeTabId = null) {
    console.log('[Background] Running startup cleanup...');

    try {
      // Remove all prefixes and indicators from all tabs
      await this.removeAllTabPrefixes();
      await this.removeAllTabIndicators();

      console.log('[Background] Startup cleanup complete');

      // If we have an active tab, add indicators to it
      if (activeTabId) {
        console.log('[Background] Adding indicators to active tab:', activeTabId);

        // Store original title before adding prefix
        const tab = await chrome.tabs.get(activeTabId);
        this.state.originalTabTitle = tab.title.startsWith('🟢 [MCP] ')
          ? tab.title.replace('🟢 [MCP] ', '')
          : tab.title;

        // Add indicators using chrome.scripting (no CDP needed yet)
        await this.addIndicatorsWithoutCDP(activeTabId);
      }
    } catch (error) {
      console.error('[Background] Startup cleanup failed:', error);
    }
  }

  /**
   * Add indicators to a tab without using CDP
   * Used during startup before debugger is attached
   */
  async addIndicatorsWithoutCDP(tabId) {
    try {
      // Add title prefix
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          if (!document.title.startsWith('🟢 [MCP] ')) {
            document.title = `🟢 [MCP] ${document.title}`;
          }
        }
      });

      // Add visual indicator
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Remove any existing indicator
          const existing = document.getElementById('browser-mcp-indicator');
          if (existing) existing.remove();

          // Create indicator using DOM methods
          const container = document.createElement('div');
          container.id = 'browser-mcp-indicator';
          container.style.cssText = `
            position: fixed;
            bottom: 16px;
            right: 16px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 13px;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 8px;
            pointer-events: none;
            animation: mcpFadeIn 0.3s ease-out;
          `;

          // Create pulse dot
          const dot = document.createElement('div');
          dot.style.cssText = `
            width: 8px;
            height: 8px;
            background: #10b981;
            border-radius: 50%;
            animation: mcpPulse 2s ease-in-out infinite;
          `;

          // Create text node
          const text = document.createTextNode('MCP Connected');

          // Assemble indicator
          container.appendChild(dot);
          container.appendChild(text);

          // Add animations
          const style = document.createElement('style');
          style.textContent = `
            @keyframes mcpFadeIn {
              from { opacity: 0; transform: translateY(10px); }
              to { opacity: 1; transform: translateY(0); }
            }
            @keyframes mcpPulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.5; }
            }
          `;
          document.head.appendChild(style);

          document.body.appendChild(container);
        }
      });

      console.log('[Background] Indicators added to tab:', tabId);
    } catch (error) {
      console.warn('[Background] Failed to add indicators (non-fatal):', error.message);
    }
  }

  /**
   * Inject visual indicator on the connected tab
   */
  async injectTabIndicator() {
    if (!this.state.tabId) return;

    // Only inject if debugger is attached and not detaching
    if (!this.cdp.isAttached() || this.cdp.isDetaching) {
      console.log('[Background] Skipping indicator injection: debugger not available');
      return;
    }

    try {
      await this.cdp.evaluate(`
        (() => {
          // Remove any existing indicator
          const existing = document.getElementById('browser-mcp-indicator');
          if (existing) existing.remove();

          // Create indicator using DOM methods (no innerHTML - works with TrustedHTML policies)
          const container = document.createElement('div');
          container.id = 'browser-mcp-indicator';
          container.style.cssText = \`
            position: fixed;
            bottom: 16px;
            right: 16px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 13px;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 8px;
            pointer-events: none;
            animation: mcpFadeIn 0.3s ease-out;
          \`;

          // Create pulse dot
          const dot = document.createElement('div');
          dot.style.cssText = \`
            width: 8px;
            height: 8px;
            background: #10b981;
            border-radius: 50%;
            animation: mcpPulse 2s ease-in-out infinite;
          \`;

          // Create text node
          const text = document.createTextNode('MCP Connected');

          // Assemble indicator
          container.appendChild(dot);
          container.appendChild(text);

          // Add animations
          const style = document.createElement('style');
          style.textContent = \`
            @keyframes mcpFadeIn {
              from { opacity: 0; transform: translateY(10px); }
              to { opacity: 1; transform: translateY(0); }
            }
            @keyframes mcpPulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.5; }
            }
          \`;
          document.head.appendChild(style);

          document.body.appendChild(container);
        })();
      `, true);
      console.log('[Background] Tab indicator injected');
    } catch (error) {
      console.error('[Background] Failed to inject indicator:', error);
    }
  }

  /**
   * Inject background interaction capture script
   */
  async injectBackgroundCapture() {
    if (!this.state.tabId) return;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: this.state.tabId },
        files: ['background-interaction-capture.js']
      });
      console.log('[Background] Background interaction capture injected');
    } catch (error) {
      console.error('[Background] Failed to inject background capture:', error);
    }
  }

  /**
   * Remove visual indicator from the connected tab
   */
  async removeTabIndicator() {
    if (!this.state.tabId) {
      console.log('[Background] removeTabIndicator: No tabId, skipping');
      return;
    }

    console.log('[Background] removeTabIndicator: Starting cleanup');
    console.log('[Background] removeTabIndicator: CDP attached?', this.cdp.isAttached());
    console.log('[Background] removeTabIndicator: CDP detaching?', this.cdp.isDetaching);

    try {
      // Try using CDP only if debugger is attached AND not detaching
      if (this.cdp.isAttached() && !this.cdp.isDetaching) {
        console.log('[Background] removeTabIndicator: Using CDP path');
        await this.cdp.evaluate(`
          (() => {
            const indicator = document.getElementById('browser-mcp-indicator');
            if (indicator) indicator.remove();
          })();
        `, true);
        console.log('[Background] removeTabIndicator: CDP cleanup successful');
      } else {
        // Use chrome.scripting if debugger already detached or detaching
        console.log('[Background] removeTabIndicator: Using chrome.scripting fallback');
        console.log('[Background] removeTabIndicator: Target tabId:', this.state.tabId);

        const result = await chrome.scripting.executeScript({
          target: { tabId: this.state.tabId },
          func: () => {
            console.log('[Page] removeTabIndicator: Executing in page context');
            const indicator = document.getElementById('browser-mcp-indicator');
            console.log('[Page] removeTabIndicator: Found indicator?', !!indicator);
            if (indicator) {
              indicator.remove();
              console.log('[Page] removeTabIndicator: Indicator removed');
              return { success: true };
            }
            return { success: false, reason: 'Indicator element not found' };
          }
        });

        console.log('[Background] removeTabIndicator: chrome.scripting result:', result);
        console.log('[Background] removeTabIndicator: Fallback cleanup successful');
      }
      console.log('[Background] Tab indicator removed');
    } catch (error) {
      // Log but don't throw - cleanup should be best-effort
      console.warn('[Background] Failed to remove indicator (non-fatal):', error.message);
    }
  }

  /**
   * Handle message from MCP server
   */
  async handleMCPMessage(message) {
    const { type, payload, id } = message;
    console.log('[Background] Handling MCP message:', type, payload);

    // Check if handler exists
    const handler = this.handlers[type];
    if (!handler) {
      console.warn('[Background] No handler for message type:', type);
      this.ws.sendNoResponse({
        type: 'messageResponse',
        payload: {
          requestId: id,
          error: `Unknown message type: ${type}`
        }
      }).catch(err => {
        console.error('[Background] Failed to send error response:', err);
      });
      return;
    }

    // Execute handler
    try {
      const result = await handler(payload);
      this.ws.sendNoResponse({
        type: 'messageResponse',
        payload: {
          requestId: id,
          result
        }
      }).catch(err => {
        console.error('[Background] Failed to send success response:', err);
      });
    } catch (error) {
      console.error('[Background] Handler error:', error);
      this.ws.sendNoResponse({
        type: 'messageResponse',
        payload: {
          requestId: id,
          error: error.message
        }
      }).catch(err => {
        console.error('[Background] Failed to send error response:', err);
      });
    }
  }

  /**
   * Handle message from popup
   */
  async handlePopupMessage(message, sendResponse) {
    console.log('[Background] Popup message:', message);

    switch (message.type) {
      case 'connect':
        try {
          const result = await this.connect();
          sendResponse({ success: true, data: result });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;

      case 'disconnect':
        try {
          await this.disconnect();
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;

      case 'get_state':
        try {
          const wsState = await this.ws.getState();
          sendResponse({
            success: true,
            data: {
              connected: this.state.connected,
              wsState: wsState,
              debuggerAttached: this.cdp.isAttached(),
              tabId: this.state.tabId,
              tabUrl: this.state.tabUrl,
              tabTitle: this.state.tabTitle,
              recordingRequest: this.currentRecordingRequest || null
            }
          });
        } catch (error) {
          sendResponse({
            success: true,
            data: {
              connected: this.state.connected,
              wsState: 'disconnected',
              debuggerAttached: this.cdp.isAttached(),
              tabId: this.state.tabId,
              tabUrl: this.state.tabUrl,
              tabTitle: this.state.tabTitle,
              recordingRequest: this.currentRecordingRequest || null
            }
          });
        }
        break;

      case 'ensure_attached':
        try {
          const result = await this.handleEnsureAttached(message.payload || {});
          sendResponse({ success: true, data: result });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;

      default:
        // Let other listeners handle non-popup messages
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  }

  // ==================== PLACEHOLDER HANDLERS ====================
  // These will be replaced by imports from handlers/ directory
  //
  // TODO: Multi-tab refactoring - The following handlers need to be updated:
  // - Add 'tabTarget' parameter to function signature
  // - Call: const cdp = await this.tabManager.getActiveCDP(tabTarget);
  // - Replace all 'this.cdp' with 'cdp' within the handler
  //
  // Updated handlers: handleNavigate, handleGoBack, handleGoForward, handleClick,
  //                   handleType, handleSnapshot, handleScreenshot, handleEvaluate,
  //                   handleGetUrl, handleGetTitle
  //
  // Remaining handlers to update (~25): handleHover, handleDrag, handleSelectOption,
  //   handlePressKey, handleScroll, handleScrollToElement, handleRealisticMouseMove,
  //   handleRealisticClick, handleRealisticType, handleFillForm, handleSubmitForm,
  //   handleQueryDOM, handleGetVisibleText, handleGetComputedStyles,
  //   handleCheckVisibility, handleGetAttributes, handleCountElements,
  //   handleGetPageMetadata, handleGetFilteredAriaTree, handleFindByText,
  //   handleGetFormValues, handleCheckElementState, handleGetNetworkState,
  //   handleSetNetworkConditions, handleClearCache

  async handleNavigate({ url, tabTarget }) {
    const cdp = await this.tabManager.getActiveCDP(tabTarget);
    await cdp.navigate(url);
    return { success: true, url };
  }

  async handleGoBack({ tabTarget }) {
    const cdp = await this.tabManager.getActiveCDP(tabTarget);
    await cdp.goBack();
    return { success: true };
  }

  async handleGoForward({ tabTarget }) {
    const cdp = await this.tabManager.getActiveCDP(tabTarget);
    await cdp.goForward();
    return { success: true };
  }

  async handleWait({ time }) {
    await new Promise(resolve => setTimeout(resolve, time * 1000));
    return { success: true, time };
  }

  async handleClick({ element, ref, tabTarget }) {
    const cdp = await this.tabManager.getActiveCDP(tabTarget);

    // Get element position
    const elemInfo = await cdp.querySelector(ref);
    if (!elemInfo) {
      throw new Error(`Element not found: ${ref}`);
    }

    // Click at element center
    const x = elemInfo.rect.x + elemInfo.rect.width / 2;
    const y = elemInfo.rect.y + elemInfo.rect.height / 2;
    await cdp.click(x, y);

    return { success: true, element, ref };
  }

  async handleType({ element, ref, text, submit, tabTarget }) {
    try {
      const cdp = await this.tabManager.getActiveCDP(tabTarget);

      // Focus the element first by clicking it
      const elemInfo = await cdp.querySelector(ref);
      if (!elemInfo) {
        throw new Error(`Element not found: ${ref}`);
      }

      const x = elemInfo.rect.x + elemInfo.rect.width / 2;
      const y = elemInfo.rect.y + elemInfo.rect.height / 2;

      // Check if still attached before clicking
      if (!cdp.isAttached() || cdp.isDetaching) {
        throw new Error('Debugger detached before typing could start');
      }

      await cdp.click(x, y);

      // Wait a moment for focus
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if still attached before typing
      if (!cdp.isAttached() || cdp.isDetaching) {
        throw new Error('Debugger detached before typing could start');
      }

      // Type the text (this will throw if detachment occurs mid-typing)
      await cdp.type(text);

      // Submit if requested (only if still attached)
      if (submit && cdp.isAttached() && !cdp.isDetaching) {
        await cdp.pressKey('Enter');
      }

      return { success: true, element, text };
    } catch (error) {
      // Provide better error messages for detachment scenarios
      if (error.message && (error.message.includes('Detached') || error.message.includes('detached'))) {
        throw new Error(`Typing operation interrupted: debugger detached (page navigation, frame update, or dynamic content change). Partial text may have been entered. The browser will attempt to reconnect automatically.`);
      }
      throw error;
    }
  }

  async handleHover({ element, ref }) {
    // Get element position
    const elemInfo = await this.cdp.querySelector(ref);
    if (!elemInfo) {
      throw new Error(`Element not found: ${ref}`);
    }

    // Move mouse to element center
    const x = elemInfo.rect.x + elemInfo.rect.width / 2;
    const y = elemInfo.rect.y + elemInfo.rect.height / 2;

    await this.cdp.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y
    });

    return { success: true, element, ref };
  }

  async handleDrag({ startElement, startRef, endElement, endRef }) {
    // Get start element position
    const startElemInfo = await this.cdp.querySelector(startRef);
    if (!startElemInfo) {
      throw new Error(`Start element not found: ${startRef}`);
    }

    // Get end element position
    const endElemInfo = await this.cdp.querySelector(endRef);
    if (!endElemInfo) {
      throw new Error(`End element not found: ${endRef}`);
    }

    // Calculate center coordinates for both elements
    const startX = startElemInfo.rect.x + startElemInfo.rect.width / 2;
    const startY = startElemInfo.rect.y + startElemInfo.rect.height / 2;
    const endX = endElemInfo.rect.x + endElemInfo.rect.width / 2;
    const endY = endElemInfo.rect.y + endElemInfo.rect.height / 2;

    // Perform drag and drop
    await this.cdp.drag(startX, startY, endX, endY);

    return { success: true, startElement, endElement };
  }

  async handleSelectOption({ element, ref, values }) {
    // TODO: Select dropdown options
    return { success: true, values };
  }

  async handlePressKey({ key }) {
    await this.cdp.pressKey(key);
    return { success: true, key };
  }

  async handleScroll({ x, y }) {
    await this.cdp.scroll(x, y);
    return { success: true, x: x ?? 0, y };
  }

  async handleScrollToElement({ element, ref }) {
    const result = await this.cdp.scrollToElement(ref);
    if (!result.success) {
      throw new Error(result.error || 'Failed to scroll to element');
    }
    return { success: true, element, ref };
  }

  async handleRealisticMouseMove({ x, y, duration, currentX, currentY }) {
    const result = await this.cdp.moveMouseRealistic(x, y, {
      duration,
      currentX,
      currentY
    });
    return {
      success: true,
      position: result,
      message: `Moved mouse to (${x}, ${y})`
    };
  }

  async handleRealisticClick({ x, y, button, clickCount, moveFirst, moveDuration, currentX, currentY }) {
    await this.cdp.clickRealistic(x, y, {
      button,
      clickCount,
      moveFirst,
      moveDuration,
      currentX,
      currentY
    });
    return {
      success: true,
      position: { x, y },
      button: button || 'left',
      clickCount: clickCount || 1,
      message: `${clickCount === 2 ? 'Double-' : ''}Clicked ${button || 'left'} button at (${x}, ${y})`
    };
  }

  async handleRealisticType({ text, minDelay, maxDelay, mistakeChance, pressEnter }) {
    try {
      if (!this.cdp.isAttached() || this.cdp.isDetaching) {
        throw new Error('Debugger detached before typing could start');
      }

      await this.cdp.typeRealistic(text, {
        minDelay,
        maxDelay,
        mistakeChance,
        pressEnter
      });

      return {
        success: true,
        text,
        length: text.length,
        message: `Typed "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"${pressEnter ? ' and pressed Enter' : ''}`
      };
    } catch (error) {
      if (error.message && (error.message.includes('Detached') || error.message.includes('detached'))) {
        throw new Error(`Typing operation interrupted: debugger detached (page navigation, frame update, or dynamic content change). Partial text may have been entered. The browser will attempt to reconnect automatically.`);
      }
      throw error;
    }
  }

  async handleListTabs() {
    const tabs = await chrome.tabs.query({});
    return tabs.map(tab => ({
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      active: tab.active
    }));
  }

  async handleSwitchTab({ tabId }) {
    let targetTabId = tabId;
    let tab = await chrome.tabs.get(tabId);

    // Check if the requested tab has a restricted URL
    if (this.isRestrictedUrl(tab.url)) {
      console.warn('[Background] Cannot switch to restricted URL:', tab.url);
      console.log('[Background] Finding first valid tab instead...');

      // Find the first valid tab
      const validTab = await this.findFirstValidTab();
      targetTabId = validTab.id;
      tab = validTab;

      console.log('[Background] Switched to valid tab:', targetTabId, tab.url);
    }

    await chrome.tabs.update(targetTabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });

    return {
      success: true,
      tabId: targetTabId,
      url: tab.url,
      message: targetTabId !== tabId
        ? `Requested tab has restricted URL, switched to ${tab.url} instead`
        : undefined
    };
  }

  async handleCreateTab({ url }) {
    const tab = await chrome.tabs.create({ url: url || 'about:blank' });
    return { success: true, tabId: tab.id, url: tab.url };
  }

  async handleCloseTab({ tabId }) {
    await chrome.tabs.remove(tabId);
    return { success: true, tabId };
  }

  async handleFillForm({ fields }) {
    // Use JavaScript to fill all fields at once (more reliable than keyboard simulation)
    const result = await this.cdp.evaluate(`
      (function() {
        const results = [];
        const fields = ${JSON.stringify(fields)};

        for (const field of fields) {
          const element = document.querySelector(field.ref);
          if (!element) {
            results.push({ ref: field.ref, success: false, error: 'Element not found' });
            continue;
          }

          // Set the value
          element.value = field.value;

          // Trigger input events to notify the page
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));

          results.push({ ref: field.ref, success: true });
        }

        return { success: true, fieldCount: fields.length, results: results };
      })()
    `, true);

    return result;
  }

  async handleSubmitForm({ element, ref }) {
    // Find the form element
    const elemInfo = await this.cdp.querySelector(ref);
    if (!elemInfo) {
      throw new Error(`Form not found: ${ref}`);
    }

    // Submit the form by pressing Enter or clicking submit button
    await this.cdp.evaluate(`
      (function() {
        const form = document.querySelector('${ref.replace(/'/g, "\\'")}');
        if (!form) return { success: false, error: 'Form not found' };

        // If it's a form element, submit it
        if (form.tagName === 'FORM') {
          form.submit();
          return { success: true };
        }

        // If it's a submit button, click it
        if (form.type === 'submit' || form.tagName === 'BUTTON') {
          form.click();
          return { success: true };
        }

        return { success: false, error: 'Element is not a form or submit button' };
      })()
    `, true);

    return { success: true, element, ref };
  }

  async handleSnapshot({ tabTarget }) {
    try {
      const cdp = await this.tabManager.getActiveCDP(tabTarget);
      const tree = await cdp.getPartialAccessibilityTree(10);

      // Check if tree is empty due to restricted frames
      if (!tree.nodes || tree.nodes.length === 0) {
        console.warn('[Background] Accessibility tree is empty - page may contain restricted iframes');
        return JSON.stringify({
          error: 'Page contains restricted content',
          message: 'The page has iframes (like about:blank#blocked or chrome:// URLs) that cannot be accessed. Try using browser_evaluate to interact with the main page content instead.',
          nodes: []
        }, null, 2);
      }

      // Return YAML-formatted string
      return JSON.stringify(tree, null, 2);
    } catch (error) {
      // If we get a restricted frame error, return a helpful message
      if (error.message && error.message.includes('restricted content')) {
        console.warn('[Background] Snapshot failed due to restricted content:', error.message);
        return JSON.stringify({
          error: 'Page contains restricted content',
          message: error.message,
          suggestion: 'Use browser_evaluate to interact with accessible parts of the page',
          nodes: []
        }, null, 2);
      }
      throw error;
    }
  }

  async handleScreenshot({ tabTarget }) {
    const cdp = await this.tabManager.getActiveCDP(tabTarget);
    const data = await cdp.captureScreenshot();
    return data; // Return base64 string directly
  }

  async handleGetConsoleLogs() {
    return this.consoleLogs;
  }

  async handleGetNetworkLogs({ filter }) {
    if (filter) {
      // Filter network logs by URL
      return this.networkLogs.filter(log => log.url.includes(filter));
    }
    return this.networkLogs;
  }

  async handleEvaluate({ expression, tabTarget }) {
    const cdp = await this.tabManager.getActiveCDP(tabTarget);
    // Execute JavaScript in page context
    const result = await cdp.evaluate(expression, true);
    return result;
  }

  async handleGetUrl({ tabTarget }) {
    if (tabTarget) {
      const tabInfo = this.tabManager.resolveTab(tabTarget);
      if (!tabInfo) {
        throw new Error(`No tab found with identifier: ${tabTarget}`);
      }
      return tabInfo.url;
    }
    return this.state.tabUrl;
  }

  async handleGetTitle({ tabTarget }) {
    if (tabTarget) {
      const tabInfo = this.tabManager.resolveTab(tabTarget);
      if (!tabInfo) {
        throw new Error(`No tab found with identifier: ${tabTarget}`);
      }
      return tabInfo.title;
    }
    return this.state.tabTitle;
  }

  async handleQueryDOM({ selector, limit = 10 }) {
    return this.cdp.evaluate(`
      Array.from(document.querySelectorAll('${selector.replace(/'/g, "\\'")}'))
        .slice(0, ${limit})
        .map((el, index) => ({
          index,
          tagName: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.className || undefined,
          text: el.textContent?.trim().substring(0, 100) || undefined
        }))
    `);
  }

  async handleGetVisibleText({ selector, maxLength = 5000 }) {
    const script = selector
      ? `document.querySelector('${selector.replace(/'/g, "\\'")}')?.innerText || ''`
      : 'document.body.innerText || ""';

    const text = await this.cdp.evaluate(script);
    return text.substring(0, maxLength);
  }

  async handleGetComputedStyles({ selector, properties }) {
    const defaultProperties = ['display', 'visibility', 'position', 'width', 'height', 'top', 'left', 'opacity', 'z-index'];
    const propsToGet = properties && properties.length > 0 ? properties : defaultProperties;

    return await this.cdp.evaluate(`
      (() => {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return null;
        const styles = window.getComputedStyle(el);
        const result = {};
        ${JSON.stringify(propsToGet)}.forEach(prop => {
          result[prop] = styles.getPropertyValue(prop);
        });
        return result;
      })()
    `);
  }

  async handleCheckVisibility({ selector }) {
    return await this.cdp.evaluate(`
      (() => {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return { exists: false };

        const rect = el.getBoundingClientRect();
        const styles = window.getComputedStyle(el);

        return {
          exists: true,
          visible: el.offsetParent !== null,
          display: styles.display !== 'none',
          visibility: styles.visibility !== 'hidden',
          opacity: parseFloat(styles.opacity) > 0,
          inViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth,
          rect: {
            top: rect.top,
            left: rect.left,
            bottom: rect.bottom,
            right: rect.right,
            width: rect.width,
            height: rect.height
          }
        };
      })()
    `);
  }

  async handleGetAttributes({ selector, attributes }) {
    const specificAttrs = attributes && attributes.length > 0;

    return await this.cdp.evaluate(`
      (() => {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return null;

        const result = {};
        ${specificAttrs ? `
          // Get specific attributes
          ${JSON.stringify(attributes)}.forEach(attr => {
            const value = el.getAttribute(attr);
            if (value !== null) result[attr] = value;
          });
        ` : `
          // Get all attributes
          Array.from(el.attributes).forEach(attr => {
            result[attr.name] = attr.value;
          });
        `}
        return result;
      })()
    `);
  }

  async handleCountElements({ selector }) {
    return this.cdp.evaluate(`document.querySelectorAll('${selector.replace(/'/g, "\\'")}').length`);
  }

  async handleGetPageMetadata() {
    return await this.cdp.evaluate(`
      (() => {
        const metadata = {
          title: document.title,
          description: '',
          keywords: '',
          author: '',
          canonical: '',
          og: {},
          twitter: {},
          schema: []
        };

        // Extract meta tags
        document.querySelectorAll('meta').forEach(meta => {
          const name = meta.getAttribute('name') || meta.getAttribute('property');
          const content = meta.getAttribute('content');

          if (!name || !content) return;

          // Standard meta tags
          if (name === 'description') metadata.description = content;
          if (name === 'keywords') metadata.keywords = content;
          if (name === 'author') metadata.author = content;

          // Open Graph tags
          if (name.startsWith('og:')) {
            metadata.og[name.substring(3)] = content;
          }

          // Twitter Card tags
          if (name.startsWith('twitter:')) {
            metadata.twitter[name.substring(8)] = content;
          }
        });

        // Canonical URL
        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) metadata.canonical = canonical.getAttribute('href');

        // Schema.org structured data
        document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
          try {
            metadata.schema.push(JSON.parse(script.textContent));
          } catch (e) {
            // Skip invalid JSON
          }
        });

        return metadata;
      })()
    `);
  }

  async handleGetFilteredAriaTree({ roles, maxDepth = 5, interactiveOnly }) {
    // Get full ARIA tree from CDP
    const fullTree = await this.cdp.getPartialAccessibilityTree(maxDepth);

    // Filter tree based on parameters
    const filterNode = (node, depth = 0) => {
      if (depth > maxDepth) return null;

      // Check role filter
      if (roles && roles.length > 0 && !roles.includes(node.role?.value)) {
        // Still process children even if parent doesn't match
        const children = node.children
          ?.map(child => filterNode(child, depth + 1))
          .filter(Boolean);
        return children && children.length > 0 ? { ...node, children } : null;
      }

      // Check interactive filter
      if (interactiveOnly) {
        const interactiveRoles = ['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'menuitem', 'tab', 'switch', 'slider'];
        if (!interactiveRoles.includes(node.role?.value)) {
          const children = node.children
            ?.map(child => filterNode(child, depth + 1))
            .filter(Boolean);
          return children && children.length > 0 ? { ...node, children } : null;
        }
      }

      // Include node and filter its children
      const filteredChildren = node.children
        ?.map(child => filterNode(child, depth + 1))
        .filter(Boolean);

      return {
        ...node,
        children: filteredChildren && filteredChildren.length > 0 ? filteredChildren : undefined
      };
    };

    return filterNode(fullTree);
  }

  async handleFindByText({ text, selector, exact, limit = 10 }) {
    const searchText = text.toLowerCase();

    return await this.cdp.evaluate(`
      (() => {
        const results = [];
        const scope = ${selector ? `document.querySelector('${selector.replace(/'/g, "\\'")}')` : 'document.body'};
        if (!scope) return results;

        const searchText = '${searchText.replace(/'/g, "\\'")}';
        const exact = ${Boolean(exact)};
        const limit = ${limit};

        const walker = document.createTreeWalker(
          scope,
          NodeFilter.SHOW_TEXT,
          null
        );

        let node;
        while ((node = walker.nextNode()) && results.length < limit) {
          const text = node.textContent.trim();
          if (!text) continue;

          const matches = exact
            ? text.toLowerCase() === searchText
            : text.toLowerCase().includes(searchText);

          if (matches) {
            const element = node.parentElement;
            results.push({
              tagName: element.tagName.toLowerCase(),
              id: element.id || undefined,
              className: element.className || undefined,
              text: text.substring(0, 200),
              selector: element.id
                ? '#' + element.id
                : element.className
                  ? element.tagName.toLowerCase() + '.' + element.className.split(' ')[0]
                  : element.tagName.toLowerCase()
            });
          }
        }

        return results;
      })()
    `);
  }

  async handleGetFormValues({ formSelector }) {
    return await this.cdp.evaluate(`
      (() => {
        const scope = ${formSelector ? `document.querySelector('${formSelector.replace(/'/g, "\\'")}')` : 'document'};
        if (!scope) return {};

        const formValues = {};

        // Get all form elements
        const inputs = scope.querySelectorAll('input, select, textarea');

        inputs.forEach(element => {
          const name = element.name || element.id;
          if (!name) return;

          if (element.type === 'checkbox' || element.type === 'radio') {
            formValues[name] = element.checked;
          } else if (element.tagName === 'SELECT' && element.multiple) {
            formValues[name] = Array.from(element.selectedOptions).map(opt => opt.value);
          } else {
            formValues[name] = element.value;
          }
        });

        return formValues;
      })()
    `);
  }

  async handleCheckElementState({ selector }) {
    return await this.cdp.evaluate(`
      (() => {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return null;

        return {
          tagName: el.tagName.toLowerCase(),
          disabled: el.disabled || false,
          readonly: el.readOnly || false,
          required: el.required || false,
          checked: el.checked || false,
          selected: el.selected || false,
          value: el.value || '',
          placeholder: el.placeholder || '',
          type: el.type || '',
          name: el.name || '',
          id: el.id || '',
          className: el.className || '',
          hidden: el.hidden || false,
          ariaDisabled: el.getAttribute('aria-disabled') === 'true',
          ariaChecked: el.getAttribute('aria-checked'),
          ariaSelected: el.getAttribute('aria-selected'),
          ariaHidden: el.getAttribute('aria-hidden') === 'true',
          ariaExpanded: el.getAttribute('aria-expanded'),
          ariaPressed: el.getAttribute('aria-pressed')
        };
      })()
    `);
  }



  /**
   * Inject draggable user action overlay into page
   */
  async injectUserActionOverlay(requestId, request) {
    await chrome.scripting.executeScript({
      target: { tabId: this.state.tabId },
      func: (requestId, request) => {
        // Remove any existing overlay first
        const existing = document.getElementById('mcp-user-action-overlay');
        if (existing) existing.remove();

        // Create draggable overlay
        const overlay = document.createElement('div');
        overlay.id = 'mcp-user-action-overlay';
        overlay.style.cssText = `
          position: fixed;
          top: 20px;
          left: 20px;
          background: white;
          border: 2px solid #4a90e2;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          z-index: 2147483647;
          max-width: 400px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          cursor: move;
        `;

        overlay.innerHTML = `
          <div id="mcp-overlay-header" style="
            margin-bottom: 15px;
            cursor: move;
            user-select: none;
          ">
            <div style="font-weight: 600; font-size: 16px; color: #2d3748; margin-bottom: 8px;">
              🤖 Agent Request
            </div>
            <div style="font-size: 14px; color: #4a5568; line-height: 1.5; white-space: pre-wrap;">
              ${request}
            </div>
          </div>
          <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button id="mcp-reject-btn" style="
              padding: 8px 16px;
              border: 1px solid #e2e8f0;
              border-radius: 6px;
              background: white;
              color: #4a5568;
              cursor: pointer;
              font-size: 14px;
              font-weight: 500;
            ">Reject</button>
            <button id="mcp-complete-btn" style="
              padding: 8px 16px;
              border: none;
              border-radius: 6px;
              background: #4a90e2;
              color: white;
              cursor: pointer;
              font-size: 14px;
              font-weight: 500;
            ">Complete</button>
          </div>
        `;

        document.body.appendChild(overlay);

        // Make overlay draggable
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;

        const header = document.getElementById('mcp-overlay-header');

        header.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);

        function dragStart(e) {
          initialX = e.clientX - xOffset;
          initialY = e.clientY - yOffset;

          if (e.target === header || header.contains(e.target)) {
            isDragging = true;
          }
        }

        function drag(e) {
          if (isDragging) {
            e.preventDefault();

            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            xOffset = currentX;
            yOffset = currentY;

            setTranslate(currentX, currentY, overlay);
          }
        }

        function dragEnd(e) {
          initialX = currentX;
          initialY = currentY;
          isDragging = false;
        }

        function setTranslate(xPos, yPos, el) {
          el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
        }

        // Button handlers - show feedback modal instead of immediate completion
        document.getElementById('mcp-complete-btn').addEventListener('click', () => {
          showFeedbackModal('completed');
        });

        document.getElementById('mcp-reject-btn').addEventListener('click', () => {
          showFeedbackModal('rejected');
        });

        // Show feedback modal
        function showFeedbackModal(action) {
          // Hide the main overlay temporarily
          overlay.style.display = 'none';

          // Create feedback modal
          const feedbackModal = document.createElement('div');
          feedbackModal.id = 'mcp-feedback-modal';
          feedbackModal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border: 2px solid ${action === 'completed' ? '#4a90e2' : '#e53e3e'};
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            z-index: 2147483648;
            width: 420px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          `;

          feedbackModal.innerHTML = `
            <div style="margin-bottom: 16px;">
              <div style="font-weight: 600; font-size: 16px; color: #2d3748; margin-bottom: 8px;">
                ${action === 'completed' ? '✅ Action Completed' : '❌ Action Rejected'}
              </div>
              <div style="font-size: 14px; color: #4a5568; line-height: 1.5;">
                ${action === 'completed'
                  ? 'Optionally provide additional information about what you did:'
                  : 'Optionally explain why you rejected this request:'}
              </div>
            </div>
            <textarea id="mcp-feedback-text" placeholder="Enter feedback here (optional)..." style="
              width: 100%;
              min-height: 100px;
              padding: 12px;
              border: 1px solid #e2e8f0;
              border-radius: 6px;
              font-size: 14px;
              font-family: inherit;
              resize: vertical;
              margin-bottom: 16px;
              box-sizing: border-box;
            "></textarea>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
              <button id="mcp-feedback-cancel" style="
                padding: 8px 16px;
                border: 1px solid #e2e8f0;
                border-radius: 6px;
                background: white;
                color: #4a5568;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
              ">Back</button>
              <button id="mcp-feedback-send" style="
                padding: 8px 20px;
                border: none;
                border-radius: 6px;
                background: ${action === 'completed' ? '#4a90e2' : '#e53e3e'};
                color: white;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
              ">Send</button>
            </div>
          `;

          document.body.appendChild(feedbackModal);

          // Focus textarea
          const textarea = document.getElementById('mcp-feedback-text');
          setTimeout(() => textarea.focus(), 100);

          // Cancel button - go back to main overlay
          document.getElementById('mcp-feedback-cancel').addEventListener('click', () => {
            feedbackModal.remove();
            overlay.style.display = 'block';
          });

          // Send button - send message with feedback
          document.getElementById('mcp-feedback-send').addEventListener('click', () => {
            const feedbackText = textarea.value.trim();
            chrome.runtime.sendMessage({
              type: action === 'completed' ? 'USER_ACTION_COMPLETE' : 'USER_ACTION_REJECTED',
              requestId: requestId,
              feedback: feedbackText || null
            });
            feedbackModal.remove();
            overlay.remove();
          });

          // Enter key submits (Ctrl+Enter for newline)
          textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              document.getElementById('mcp-feedback-send').click();
            }
          });

          // Hover effects for buttons
          const sendBtn = document.getElementById('mcp-feedback-send');
          const cancelBtn = document.getElementById('mcp-feedback-cancel');

          sendBtn.addEventListener('mouseenter', () => {
            sendBtn.style.background = action === 'completed' ? '#3182ce' : '#c53030';
          });
          sendBtn.addEventListener('mouseleave', () => {
            sendBtn.style.background = action === 'completed' ? '#4a90e2' : '#e53e3e';
          });

          cancelBtn.addEventListener('mouseenter', () => cancelBtn.style.background = '#f7fafc');
          cancelBtn.addEventListener('mouseleave', () => cancelBtn.style.background = 'white');
        }

        // Hover effects
        const completeBtn = document.getElementById('mcp-complete-btn');
        const rejectBtn = document.getElementById('mcp-reject-btn');

        completeBtn.addEventListener('mouseenter', () => completeBtn.style.background = '#3182ce');
        completeBtn.addEventListener('mouseleave', () => completeBtn.style.background = '#4a90e2');

        rejectBtn.addEventListener('mouseenter', () => rejectBtn.style.background = '#f7fafc');
        rejectBtn.addEventListener('mouseleave', () => rejectBtn.style.background = 'white');
      },
      args: [requestId, request]
    });
  }

  /**
   * Handle request user action - simplified version using background log
   */
  async handleRequestUserAction({ request }) {
    const requestId = `request-${Date.now()}`;
    console.log('[Background] User action request:', { requestId, request });

    return new Promise(async (resolve, reject) => {
      try {
        // Record start timestamp
        const startTime = Date.now();

        // Store request so overlay can access it
        this.currentUserActionRequest = {
          requestId,
          request,
          startTime,
          resolve,
          reject
        };

        // Set up message listener for user response
        const messageListener = (message, sender) => {
          if (message.type === 'USER_ACTION_COMPLETE' && message.requestId === requestId) {
            console.log('[Background] User completed action', message.feedback ? `with feedback: ${message.feedback}` : 'without feedback');
            const endTime = Date.now();

            // Query background interaction log for this time period
            const interactions = this.backgroundRecorder.get({
              startTime,
              endTime,
              limit: 1000 // Get all interactions during this period
            });

            // Store navigation listener before cleanup
            const navListener = this.currentUserActionRequest?.navigationListener;

            // Clean up
            this.currentUserActionRequest = null;
            chrome.action.setBadgeText({ text: '' });
            chrome.runtime.onMessage.removeListener(messageListener);

            // Remove notification
            chrome.notifications.clear(requestId);

            // Remove navigation listener
            if (navListener) {
              chrome.webNavigation.onCommitted.removeListener(navListener);
            }

            resolve({
              status: 'completed',
              request,
              startTime,
              endTime,
              duration: endTime - startTime,
              interactions: interactions.interactions,
              feedback: message.feedback || null
            });
          } else if (message.type === 'USER_ACTION_REJECTED' && message.requestId === requestId) {
            console.log('[Background] User rejected action', message.feedback ? `with reason: ${message.feedback}` : 'without reason');
            const endTime = Date.now();

            // Store navigation listener before cleanup
            const navListener = this.currentUserActionRequest?.navigationListener;

            // Clean up
            this.currentUserActionRequest = null;
            chrome.action.setBadgeText({ text: '' });
            chrome.runtime.onMessage.removeListener(messageListener);

            // Remove notification
            chrome.notifications.clear(requestId);

            // Remove navigation listener
            if (navListener) {
              chrome.webNavigation.onCommitted.removeListener(navListener);
            }

            resolve({
              status: 'rejected',
              request,
              startTime,
              endTime,
              duration: endTime - startTime,
              interactions: [],
              feedback: message.feedback || null
            });
          }
          // Explicitly return false to indicate no async response needed
          return false;
        };

        chrome.runtime.onMessage.addListener(messageListener);

        // Show badge to indicate request pending
        chrome.action.setBadgeText({ text: '?' });
        chrome.action.setBadgeBackgroundColor({ color: '#4a90e2' });

        // Create persistent notification
        await chrome.notifications.create(requestId, {
          type: 'basic',
          iconUrl: 'icon-48.png',
          title: '🤖 Agent Request Active',
          message: request.substring(0, 100) + (request.length > 100 ? '...' : ''),
          priority: 2,
          requireInteraction: true
        });

        // Store navigation listener to re-inject overlay on navigation
        const navigationListener = (details) => {
          if (details.tabId === this.state.tabId && details.frameId === 0) {
            console.log('[Background] Page navigated, re-injecting overlay');
            // Re-inject overlay after navigation
            setTimeout(() => {
              this.injectUserActionOverlay(requestId, request);
            }, 500);
          }
        };
        chrome.webNavigation.onCommitted.addListener(navigationListener);
        this.currentUserActionRequest.navigationListener = navigationListener;

        // Inject user action overlay
        await this.injectUserActionOverlay(requestId, request);
        console.log('[Background] User action overlay injected');
      } catch (error) {
        console.error('[Background] Error in handleRequestUserAction:', error);
        this.currentUserActionRequest = null;
        chrome.action.setBadgeText({ text: '' });
        reject(error);
      }
    });
  }

  /**
   * Handle browser_get_interactions
   */
  async handleGetInteractions(data) {
    console.log('[Background] Getting interactions:', data);
    const result = this.backgroundRecorder.get(data);
    return result;
  }

  /**
   * Handle browser_prune_interactions
   */
  async handlePruneInteractions(data) {
    console.log('[Background] Pruning interactions:', data);
    const result = this.backgroundRecorder.prune(data);
    return result;
  }

  /**
   * Handle browser_search_interactions
   */
  async handleSearchInteractions(data) {
    console.log('[Background] Searching interactions:', data);
    const result = this.backgroundRecorder.search(data.query, {
      types: data.types,
      startTime: data.startTime,
      endTime: data.endTime,
      limit: data.limit,
    });
    return result;
  }

  /**
   * Handle browser_get_cookies - Get cookies with optional filtering
   */
  async handleGetCookies(data) {
    console.log('[Background] Getting cookies:', data);

    // Build query details
    const details = {};
    if (data.url) {
      details.url = data.url;
    }
    if (data.name) {
      details.name = data.name;
    }
    if (data.domain) {
      details.domain = data.domain;
    }

    // Get cookies using Chrome API
    const cookies = await chrome.cookies.getAll(details);

    return { cookies };
  }

  /**
   * Handle browser_set_cookie - Set a cookie
   */
  async handleSetCookie(data) {
    console.log('[Background] Setting cookie:', data);

    // Build cookie details
    const details = {
      url: data.url,
      name: data.name,
      value: data.value,
    };

    // Optional parameters
    if (data.domain !== undefined) details.domain = data.domain;
    if (data.path !== undefined) details.path = data.path;
    if (data.secure !== undefined) details.secure = data.secure;
    if (data.httpOnly !== undefined) details.httpOnly = data.httpOnly;
    if (data.sameSite !== undefined) details.sameSite = data.sameSite;
    if (data.expirationDate !== undefined) details.expirationDate = data.expirationDate;

    // Set the cookie
    await chrome.cookies.set(details);

    return { success: true };
  }

  /**
   * Handle browser_delete_cookie - Delete a specific cookie
   */
  async handleDeleteCookie(data) {
    console.log('[Background] Deleting cookie:', data);

    // Delete the cookie
    const result = await chrome.cookies.remove({
      url: data.url,
      name: data.name,
    });

    return { success: result !== null };
  }

  /**
   * Handle browser_clear_cookies - Clear cookies with optional filtering
   */
  async handleClearCookies(data) {
    console.log('[Background] Clearing cookies:', data);

    // Build query details
    const details = {};
    if (data.url) {
      details.url = data.url;
    }
    if (data.domain) {
      details.domain = data.domain;
    }

    // Get all cookies matching the filter
    const cookies = await chrome.cookies.getAll(details);

    // Delete each cookie
    let count = 0;
    for (const cookie of cookies) {
      const url = `http${cookie.secure ? 's' : ''}://${cookie.domain}${cookie.path}`;
      const result = await chrome.cookies.remove({
        url: url,
        name: cookie.name,
      });
      if (result !== null) {
        count++;
      }
    }

    return { count };
  }

  /**
   * Handle browser_download_file - Download a file from a URL
   */
  async handleDownloadFile(data) {
    console.log('[Background] Downloading file:', data);

    // Build download options
    const options = {
      url: data.url,
    };

    // Optional parameters
    if (data.filename !== undefined) {
      options.filename = data.filename;
    }
    if (data.saveAs !== undefined) {
      options.saveAs = data.saveAs;
    }

    // Initiate download
    const downloadId = await chrome.downloads.download(options);

    return { downloadId };
  }

  /**
   * Handle browser_get_downloads - Get download items with optional filtering
   */
  async handleGetDownloads(data) {
    console.log('[Background] Getting downloads:', data);

    // Build query
    const query = {};
    if (data.query && data.query.length > 0) {
      query.query = data.query;
    }
    if (data.orderBy && data.orderBy.length > 0) {
      query.orderBy = data.orderBy;
    }
    if (data.limit !== undefined) {
      query.limit = data.limit;
    }

    // Search downloads
    const downloads = await chrome.downloads.search(query);

    return { downloads };
  }

  /**
   * Handle browser_cancel_download - Cancel a download
   */
  async handleCancelDownload(data) {
    console.log('[Background] Cancelling download:', data);

    // Cancel the download
    await chrome.downloads.cancel(data.downloadId);

    return { success: true };
  }

  /**
   * Handle browser_open_download - Open a downloaded file
   */
  async handleOpenDownload(data) {
    console.log('[Background] Opening download:', data);

    // Open the download
    await chrome.downloads.open(data.downloadId);

    return { success: true };
  }

  /**
   * Handle browser_get_clipboard - Read text from clipboard
   */
  async handleGetClipboard(data) {
    console.log('[Background] Getting clipboard');

    try {
      // Use chrome.scripting with proper user gesture context
      // This is more reliable than CDP evaluation for clipboard operations
      const results = await chrome.scripting.executeScript({
        target: { tabId: this.state.tabId },
        func: async () => {
          try {
            // Focus the document first to ensure we have user gesture
            window.focus();
            document.body.focus();

            // Try using the Clipboard API
            if (navigator.clipboard && navigator.clipboard.readText) {
              return await navigator.clipboard.readText();
            }

            // Fallback: use a temporary textarea
            const textarea = document.createElement('textarea');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            document.execCommand('paste');
            const text = textarea.value;
            document.body.removeChild(textarea);
            return text;
          } catch (error) {
            throw new Error('Failed to read clipboard: ' + error.message);
          }
        },
        world: 'MAIN'
      });

      const text = results[0]?.result || '';
      return { text };
    } catch (error) {
      console.error('[Background] Clipboard read failed:', error);
      throw new Error(`Clipboard read failed: ${error.message}`);
    }
  }

  /**
   * Handle browser_set_clipboard - Write text to clipboard
   */
  async handleSetClipboard(data) {
    console.log('[Background] Setting clipboard:', data.text.substring(0, 50));

    try {
      // Use chrome.scripting with proper user gesture context
      // This is more reliable than CDP evaluation for clipboard operations
      await chrome.scripting.executeScript({
        target: { tabId: this.state.tabId },
        func: async (text) => {
          try {
            // Focus the document first to ensure we have user gesture
            window.focus();
            document.body.focus();

            // Try using the Clipboard API first
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(text);
              return;
            }

            // Fallback: use a temporary textarea
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
          } catch (error) {
            throw new Error('Failed to write clipboard: ' + error.message);
          }
        },
        args: [data.text],
        world: 'MAIN'
      });

      return { success: true };
    } catch (error) {
      console.error('[Background] Clipboard write failed:', error);
      throw new Error(`Clipboard write failed: ${error.message}`);
    }
  }

  /**
   * Handle browser_search_history - Search browsing history
   */
  async handleSearchHistory(data) {
    console.log('[Background] Searching history:', data.text);

    // Build query
    const query = {
      text: data.text,
    };
    if (data.startTime !== undefined) {
      query.startTime = data.startTime;
    }
    if (data.endTime !== undefined) {
      query.endTime = data.endTime;
    }
    if (data.maxResults !== undefined) {
      query.maxResults = data.maxResults;
    }

    // Search history
    const results = await chrome.history.search(query);

    return { results };
  }

  /**
   * Handle browser_get_history_visits - Get visit details for a URL
   */
  async handleGetHistoryVisits(data) {
    console.log('[Background] Getting history visits for:', data.url);

    // Get visits for URL
    const visits = await chrome.history.getVisits({ url: data.url });

    return { visits };
  }

  /**
   * Handle browser_delete_history - Delete specific URLs from history
   */
  async handleDeleteHistory(data) {
    console.log('[Background] Deleting history for:', data.urls);

    // Delete each URL from history
    for (const url of data.urls) {
      await chrome.history.deleteUrl({ url });
    }

    return { success: true };
  }

  /**
   * Handle browser_clear_history - Clear history for time range
   */
  async handleClearHistory(data) {
    console.log('[Background] Clearing history from:', data.startTime, 'to:', data.endTime);

    // Delete history range
    await chrome.history.deleteRange({
      startTime: data.startTime,
      endTime: data.endTime,
    });

    return { success: true };
  }

  // System Information Handlers

  /**
   * Get browser version information
   */
  async handleGetVersion(data) {
    console.log('[Background] Getting browser version');

    // Get browser info from runtime
    const manifest = chrome.runtime.getManifest();
    const browserInfo = await chrome.runtime.getPlatformInfo();

    return {
      browserName: 'Chrome',
      browserVersion: /Chrome\/([0-9.]+)/.exec(navigator.userAgent)?.[1] || 'Unknown',
      extensionVersion: manifest.version,
      userAgent: navigator.userAgent,
      platform: browserInfo,
    };
  }

  /**
   * Get system information
   */
  async handleGetSystemInfo(data) {
    console.log('[Background] Getting system info');

    const platformInfo = await chrome.runtime.getPlatformInfo();

    return {
      os: platformInfo.os,
      arch: platformInfo.arch,
      platform: platformInfo.os,
      nacl_arch: platformInfo.nacl_arch,
    };
  }

  /**
   * Get browser capabilities and information
   */
  async handleGetBrowserInfo(data) {
    console.log('[Background] Getting browser info');

    const manifest = chrome.runtime.getManifest();
    const platformInfo = await chrome.runtime.getPlatformInfo();

    // Get installed extensions count (only this extension)
    let extensionCount = 0;
    try {
      const extensions = await chrome.management.getAll();
      extensionCount = extensions.filter(ext => ext.enabled && ext.type === 'extension').length;
    } catch (error) {
      console.warn('[Background] Could not get extensions:', error);
    }

    return {
      browserVersion: /Chrome\/([0-9.]+)/.exec(navigator.userAgent)?.[1] || 'Unknown',
      extensionName: manifest.name,
      extensionVersion: manifest.version,
      manifestVersion: manifest.manifest_version,
      platform: platformInfo,
      installedExtensions: extensionCount,
      permissions: manifest.permissions || [],
      hostPermissions: manifest.host_permissions || [],
    };
  }

  // Network Handlers

  /**
   * Get current network connection state
   */
  async handleGetNetworkState(data) {
    console.log('[Background] Getting network state');

    // Evaluate navigator.connection in the page context
    const connectionInfo = await this.cdp.evaluate(`
      (() => {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!conn) {
          return {
            online: navigator.onLine,
            type: 'unknown',
          };
        }
        return {
          online: navigator.onLine,
          type: conn.effectiveType || conn.type || 'unknown',
          downlink: conn.downlink,
          downlinkMax: conn.downlinkMax,
          rtt: conn.rtt,
          saveData: conn.saveData,
        };
      })()
    `, true);

    return connectionInfo;
  }

  /**
   * Set network throttling conditions
   */
  async handleSetNetworkConditions(data) {
    console.log('[Background] Setting network conditions:', data);

    // Use CDP to emulate network conditions
    const conditions = {
      offline: data.offline || false,
      latency: data.latency || 0,
      downloadThroughput: data.downloadThroughput !== undefined ? data.downloadThroughput : -1,
      uploadThroughput: data.uploadThroughput !== undefined ? data.uploadThroughput : -1,
    };

    await this.cdp.sendCommand('Network.emulateNetworkConditions', conditions);

    return { success: true, conditions };
  }

  /**
   * Clear browser cache
   */
  async handleClearCache(data) {
    console.log('[Background] Clearing cache');

    const cacheStorage = data.cacheStorage !== false;

    // Clear browsing data using Chrome API
    await chrome.browsingData.remove(
      {},
      {
        cache: true,
        cacheStorage: cacheStorage,
      }
    );

    return { success: true };
  }

  // Bookmark Handlers

  /**
   * Get bookmarks from the browser
   */
  async handleGetBookmarks(data) {
    console.log('[Background] Getting bookmarks:', data);

    // Get bookmarks from a specific parent or the entire tree
    let bookmarks;
    if (data.parentId) {
      bookmarks = await chrome.bookmarks.getChildren(data.parentId);
    } else {
      bookmarks = await chrome.bookmarks.getTree();
    }

    return { bookmarks };
  }

  /**
   * Create a new bookmark
   */
  async handleCreateBookmark(data) {
    console.log('[Background] Creating bookmark:', data.title);

    const bookmark = {
      title: data.title,
      url: data.url,
    };

    if (data.parentId) {
      bookmark.parentId = data.parentId;
    }

    const created = await chrome.bookmarks.create(bookmark);

    return { bookmark: created };
  }

  /**
   * Delete a bookmark
   */
  async handleDeleteBookmark(data) {
    console.log('[Background] Deleting bookmark:', data.id);

    await chrome.bookmarks.remove(data.id);

    return { success: true };
  }

  /**
   * Search bookmarks
   */
  async handleSearchBookmarks(data) {
    console.log('[Background] Searching bookmarks:', data.query);

    // Search bookmarks
    const results = await chrome.bookmarks.search(data.query);

    // Limit results if specified
    const bookmarks = data.maxResults
      ? results.slice(0, data.maxResults)
      : results;

    return { bookmarks };
  }

  // Extension Management Handlers

  /**
   * List all installed extensions
   */
  async handleListExtensions(data) {
    console.log('[Background] Listing extensions');

    const extensions = await chrome.management.getAll();

    return { extensions };
  }

  /**
   * Get extension information
   */
  async handleGetExtensionInfo(data) {
    console.log('[Background] Getting extension info:', data.id);

    const extension = await chrome.management.get(data.id);

    return { extension };
  }

  /**
   * Enable an extension
   */
  async handleEnableExtension(data) {
    console.log('[Background] Enabling extension:', data.id);

    await chrome.management.setEnabled(data.id, true);

    return { success: true };
  }

  /**
   * Disable an extension
   */
  async handleDisableExtension(data) {
    console.log('[Background] Disabling extension:', data.id);

    await chrome.management.setEnabled(data.id, false);

    return { success: true };
  }
}

// Initialize controller
const controller = new BackgroundController();

console.log('[Background] Browser MCP extension loaded');

// Auto-connect functionality
async function autoConnect() {
  // First clean up any leftover indicators/prefixes from previous sessions
  await controller.cleanupOnStartup();
  console.log('[Background] Extension initialized and cleaned up');

  // Don't attempt twice
  if (autoConnectAttempted) {
    return;
  }

  try {
    console.log('[Background] Starting auto-connect...');
    autoConnectAttempted = true;

    // Wait for offscreen document to be ready (with timeout)
    if (!offscreenReady) {
      console.log('[Background] Waiting for offscreen document...');
      const startTime = Date.now();
      while (!offscreenReady && (Date.now() - startTime) < 5000) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (!offscreenReady) {
        console.log('[Background] Offscreen document not ready after 5s, proceeding anyway...');
      }
    }

    // Connect WebSocket to server
    await controller.connect();
    console.log('[Background] WebSocket connected');

    // Auto-select active tab, but skip restricted URLs
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

    // Filter out restricted URLs (chrome://, chrome-extension://, about:, etc.)
    const restrictedPrefixes = ['chrome://', 'chrome-extension://', 'about:', 'edge://', 'view-source:'];
    const isRestricted = (url) => {
      if (!url) return true;
      return restrictedPrefixes.some(prefix => url.startsWith(prefix));
    };

    let selectedTab = null;

    // First try the active tab
    if (tabs.length > 0 && !isRestricted(tabs[0].url)) {
      selectedTab = tabs[0];
    } else {
      // Find any non-restricted tab
      console.log('[Background] Active tab is restricted, searching for valid tab...');
      const allTabs = await chrome.tabs.query({});
      for (const tab of allTabs) {
        if (!isRestricted(tab.url)) {
          selectedTab = tab;
          console.log('[Background] Found valid tab:', tab.id, tab.url);
          break;
        }
      }
    }

    if (selectedTab) {
      console.log('[Background] Auto-connecting to tab:', selectedTab.id, selectedTab.url);

      // Update state with selected tab
      controller.state.tabId = selectedTab.id;
      controller.state.tabUrl = selectedTab.url;
      controller.state.tabTitle = selectedTab.title;
      controller.state.originalTabTitle = selectedTab.title;

      // Add indicators to the selected tab (after cleanup has run)
      try {
        await controller.addIndicatorsWithoutCDP(selectedTab.id);
        console.log('[Background] Indicators added to auto-connected tab');
      } catch (error) {
        console.warn('[Background] Failed to add indicators to auto-connected tab:', error);
      }

      console.log('[Background] Auto-connect complete - ready for MCP commands');
    } else {
      console.log('[Background] No valid tabs found - will connect when a valid tab becomes active');
      console.log('[Background] Note: chrome://, about:, and other restricted URLs cannot be controlled');
    }
  } catch (error) {
    console.error('[Background] Auto-connect failed:', error);
    autoConnectAttempted = false; // Allow retry
    // Retry after 3 seconds
    setTimeout(autoConnect, 3000);
  }
}

// Start auto-connect on extension load
autoConnect();

// Auto-reconnect if tab changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (controller.state.connected && !controller.state.tabId) {
    console.log('[Background] Tab activated, auto-connecting:', activeInfo.tabId);
    const tab = await chrome.tabs.get(activeInfo.tabId);
    controller.state.tabId = tab.id;
    controller.state.tabUrl = tab.url;
    controller.state.tabTitle = tab.title;
  }
});
