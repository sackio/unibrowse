/**
 * Browser MCP - Background Service Worker
 * Central coordinator for WebSocket, Chrome Debugger, and message routing
 */

importScripts('utils/websocket.js', 'utils/cdp.js');

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

class BackgroundController {
  constructor() {
    this.ws = new WebSocketManager('ws://localhost:9009');
    this.cdp = new CDPHelper();
    this.handlers = {};
    this.consoleLogs = [];
    this.networkLogs = [];
    this.badgeBlinkInterval = null;
    this.recordingSessions = new Map(); // Track active recording sessions
    this.backgroundRecorder = new BackgroundRecorder(500); // Background interaction log
    this.state = {
      connected: false,
      tabId: null,
      tabUrl: null,
      tabTitle: null,
      originalTabTitle: null
    };

    this.setupListeners();
    this.registerHandlers();

    // Initialize badge to disconnected state
    this.updateBadge(false);
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

    // Tab closed/removed
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (this.state.tabId === tabId) {
        console.log('[Background] Active tab closed');
        this.disconnect();
      }
    });

    // Tab updated (navigation, etc)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (this.state.tabId === tabId) {
        if (changeInfo.url) {
          console.log('[Background] Tab navigated to:', changeInfo.url);
          this.state.tabUrl = changeInfo.url;
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
        if (changeInfo.status === 'complete' && this.state.connected) {
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
    chrome.debugger.onDetach.addListener((source, reason) => {
      if (source.tabId === this.state.tabId) {
        console.log('[Background] Debugger detached:', reason);
        // Always disconnect regardless of reason to ensure cleanup
        this.disconnect();
      }
    });

    // Messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Handle background interaction capture
      if (message.type === 'BACKGROUND_INTERACTION' && this.state.connected) {
        this.backgroundRecorder.addAction(message.interaction);
        return false;
      }

      // Only handle popup-specific messages here
      const popupMessages = ['connect', 'disconnect', 'get_state'];
      if (popupMessages.includes(message.type)) {
        this.handlePopupMessage(message, sendResponse);
        return true; // Keep channel open for async response
      }
      // Let other listeners handle recording messages
      return false;
    });

    // Notification button clicks
    // Console API called (for console log collection)
    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId === this.state.tabId) {
        if (method === 'Console.messageAdded') {
          this.consoleLogs.push({
            level: params.message.level,
            text: params.message.text,
            timestamp: Date.now()
          });
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

    // Tab management handlers
    this.handlers['browser_list_tabs'] = this.handleListTabs.bind(this);
    this.handlers['browser_switch_tab'] = this.handleSwitchTab.bind(this);
    this.handlers['browser_create_tab'] = this.handleCreateTab.bind(this);
    this.handlers['browser_close_tab'] = this.handleCloseTab.bind(this);

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
    this.handlers['browser_request_demonstration'] = this.handleRequestDemonstration.bind(this);
    this.handlers['browser_request_user_action'] = this.handleRequestUserAction.bind(this);

    // Background interaction log handlers
    this.handlers['browser_get_interactions'] = this.handleGetInteractions.bind(this);
    this.handlers['browser_prune_interactions'] = this.handlePruneInteractions.bind(this);
    this.handlers['browser_search_interactions'] = this.handleSearchInteractions.bind(this);

    console.log('[Background] Registered', Object.keys(this.handlers).length, 'handlers');
  }

  /**
   * Connect to MCP server and attach debugger
   */
  async connect() {
    try {
      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        throw new Error('No active tab found');
      }

      console.log('[Background] Connecting to tab:', tab.id, tab.url);

      // Attach debugger
      await this.cdp.attach(tab.id);

      // Update state
      this.state.tabId = tab.id;
      this.state.tabUrl = tab.url;
      this.state.originalTabTitle = tab.title;
      this.state.tabTitle = tab.title;
      this.consoleLogs = [];
      this.networkLogs = [];

      // Connect WebSocket
      this.ws.connect();

      this.state.connected = true;
      this.updateConnectionState();

      // Update tab title to show MCP indicator
      await this.updateTabTitle();

      // Inject visual indicator on the page
      await this.injectTabIndicator();

      // Inject background interaction capture script
      await this.injectBackgroundCapture();

      return { success: true, tabId: tab.id, url: tab.url };
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

    // Restore original tab title
    await this.restoreTabTitle();

    // Remove visual indicator from the page
    await this.removeTabIndicator();

    this.ws.disconnect();
    await this.cdp.detach();

    this.state.tabId = null;
    this.state.tabUrl = null;
    this.state.tabTitle = null;
    this.state.originalTabTitle = null;
    this.consoleLogs = [];
    this.networkLogs = [];
    this.backgroundRecorder.clear(); // Clear background interaction log

    this.updateConnectionState();
    console.log('[Background] Disconnect complete');
  }

  /**
   * Update connection state and notify popup
   */
  updateConnectionState() {
    const state = {
      connected: this.state.connected,
      wsState: this.ws.getState(),
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

    try {
      // Try using CDP if debugger is still attached
      if (this.cdp.isAttached()) {
        console.log('[Background] restoreTabTitle: Using CDP path');
        await this.cdp.evaluate(`
          if (document.title.startsWith('🟢 [MCP] ')) {
            document.title = document.title.replace('🟢 [MCP] ', '');
          }
        `, true);
        console.log('[Background] restoreTabTitle: CDP cleanup successful');
      } else {
        // Fallback to chrome.scripting if debugger already detached
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
      console.error('[Background] Failed to restore tab title:', error);
      console.error('[Background] Error details:', error.message, error.stack);
    }
  }

  /**
   * Inject visual indicator on the connected tab
   */
  async injectTabIndicator() {
    if (!this.state.tabId) return;

    try {
      await this.cdp.evaluate(`
        (() => {
          // Remove any existing indicator
          const existing = document.getElementById('browser-mcp-indicator');
          if (existing) existing.remove();

          // Create indicator element
          const indicator = document.createElement('div');
          indicator.id = 'browser-mcp-indicator';
          indicator.innerHTML = \`
            <div style="
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
            ">
              <div style="
                width: 8px;
                height: 8px;
                background: #10b981;
                border-radius: 50%;
                animation: mcpPulse 2s ease-in-out infinite;
              "></div>
              MCP Connected
            </div>
          \`;

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

          document.body.appendChild(indicator);
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

    try {
      // Try using CDP if debugger is still attached
      if (this.cdp.isAttached()) {
        console.log('[Background] removeTabIndicator: Using CDP path');
        await this.cdp.evaluate(`
          (() => {
            const indicator = document.getElementById('browser-mcp-indicator');
            if (indicator) indicator.remove();
          })();
        `, true);
        console.log('[Background] removeTabIndicator: CDP cleanup successful');
      } else {
        // Fallback to chrome.scripting if debugger already detached
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
      console.error('[Background] Failed to remove indicator:', error);
      console.error('[Background] Error details:', error.message, error.stack);
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
      this.ws.send({
        id,
        error: `Unknown message type: ${type}`
      });
      return;
    }

    // Execute handler
    try {
      const result = await handler(payload);
      this.ws.send({
        type: 'messageResponse',
        payload: {
          requestId: id,
          result
        }
      });
    } catch (error) {
      console.error('[Background] Handler error:', error);
      this.ws.send({
        type: 'messageResponse',
        payload: {
          requestId: id,
          error: error.message
        }
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
        sendResponse({
          success: true,
          data: {
            connected: this.state.connected,
            wsState: this.ws.getState(),
            debuggerAttached: this.cdp.isAttached(),
            tabId: this.state.tabId,
            tabUrl: this.state.tabUrl,
            tabTitle: this.state.tabTitle,
            recordingRequest: this.currentRecordingRequest || null
          }
        });
        break;

      default:
        // Let other listeners handle non-popup messages
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  }

  // ==================== PLACEHOLDER HANDLERS ====================
  // These will be replaced by imports from handlers/ directory

  async handleNavigate({ url }) {
    await this.cdp.navigate(url);
    return { success: true, url };
  }

  async handleGoBack() {
    await this.cdp.goBack();
    return { success: true };
  }

  async handleGoForward() {
    await this.cdp.goForward();
    return { success: true };
  }

  async handleWait({ time }) {
    await new Promise(resolve => setTimeout(resolve, time * 1000));
    return { success: true, time };
  }

  async handleClick({ element, ref }) {
    // Get element position
    const elemInfo = await this.cdp.querySelector(ref);
    if (!elemInfo) {
      throw new Error(`Element not found: ${ref}`);
    }

    // Click at element center
    const x = elemInfo.rect.x + elemInfo.rect.width / 2;
    const y = elemInfo.rect.y + elemInfo.rect.height / 2;
    await this.cdp.click(x, y);

    return { success: true, element, ref };
  }

  async handleType({ element, ref, text, submit }) {
    // Focus the element first by clicking it
    const elemInfo = await this.cdp.querySelector(ref);
    if (!elemInfo) {
      throw new Error(`Element not found: ${ref}`);
    }

    const x = elemInfo.rect.x + elemInfo.rect.width / 2;
    const y = elemInfo.rect.y + elemInfo.rect.height / 2;
    await this.cdp.click(x, y);

    // Wait a moment for focus
    await new Promise(resolve => setTimeout(resolve, 100));

    // Type the text
    await this.cdp.type(text);

    // Submit if requested
    if (submit) {
      await this.cdp.pressKey('Enter');
    }

    return { success: true, element, text };
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
    await chrome.tabs.update(tabId, { active: true });
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { focused: true });
    return { success: true, tabId };
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

  async handleSnapshot() {
    const tree = await this.cdp.getPartialAccessibilityTree(10);
    // Return YAML-formatted string
    return JSON.stringify(tree, null, 2);
  }

  async handleScreenshot() {
    const data = await this.cdp.captureScreenshot();
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

  async handleEvaluate({ expression }) {
    // Execute JavaScript in page context
    const result = await this.cdp.evaluate(expression, true);
    return result;
  }

  async handleGetUrl() {
    return this.state.tabUrl;
  }

  async handleGetTitle() {
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
   * Handle request demonstration - Ask user to demonstrate a workflow
   */
  async handleRequestDemonstration({ request }) {
    const sessionId = `session-${Date.now()}`;
    console.log('[Background] Starting recording request:', { sessionId, request });

    return new Promise(async (resolve, reject) => {
      try {
        // Create recording session first - store tabId so we can use it even if disconnected
        const session = {
          sessionId,
          request,
          startTime: Date.now(),
          actions: [],
          networkActivity: [],
          resolve,
          reject,
          tabId: this.state.tabId  // Store tabId for later use
        };

        this.recordingSessions.set(sessionId, session);
        console.log('[Background] Recording session created:', sessionId);

        // Set up message listener for content script and popup
        const messageListener = (message, sender) => {
          if (message.type === 'START_RECORDING_NOW' && message.sessionId === sessionId) {
            console.log('[Background] User clicked Start, injecting content script');
            // Update state to active and set recording start time
            if (this.currentRecordingRequest && this.currentRecordingRequest.sessionId === sessionId) {
              this.currentRecordingRequest.state = 'active';
              this.currentRecordingRequest.actionCount = 0;
            }
            // Set recording start time in session
            session.recordingStartTime = Date.now();

            // Show recording badge
            chrome.action.setBadgeText({ text: '●' });
            chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });

            // User clicked Start in overlay - inject and start content script
            chrome.scripting.executeScript({
              target: { tabId: this.state.tabId },
              files: ['content-script.js']
            }).then(() => {
              console.log('[Background] Content script injected, starting recording');
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
              console.error('[Background] Failed to start recording:', err);
              reject(err);
            });
          } else if (message.type === 'RECORDING_CANCELLED' && message.sessionId === sessionId) {
            // User cancelled - clean up
            this.currentRecordingRequest = null;
            chrome.action.setBadgeText({ text: '' });
            this.recordingSessions.delete(sessionId);
            chrome.runtime.onMessage.removeListener(messageListener);
            reject(new Error('Recording cancelled by user'));
          } else if (message.type === 'RECORDING_ACTION' && message.sessionId === sessionId) {
            session.actions.push(message.action);
            // Update recording request with action count
            if (this.currentRecordingRequest && this.currentRecordingRequest.sessionId === sessionId) {
              this.currentRecordingRequest.actionCount = session.actions.length;
            }
          } else if (message.type === 'RECORDING_COMPLETE' && message.sessionId === sessionId) {
            console.log('[Background] Received RECORDING_COMPLETE');
            // Ignore if already stopping
            if (!this.recordingSessions.has(sessionId)) {
              console.log('[Background] Session already stopped, ignoring');
              return;
            }
            // Clear currentRecordingRequest immediately to prevent re-injection
            this.currentRecordingRequest = null;
            chrome.action.setBadgeText({ text: '' });
            this.stopRecording(sessionId);
          } else if (message.type === 'RECORDING_RESULT' && message.result.sessionId === sessionId) {
            console.log('[Background] Received RECORDING_RESULT:', message.result);
            const result = message.result;

            // Add network activity
            result.network = session.networkActivity;
            console.log('[Background] Resolving Promise with result');

            // Clear recording request
            this.currentRecordingRequest = null;

            // Clear badge
            chrome.action.setBadgeText({ text: '' });

            // Clean up
            this.recordingSessions.delete(sessionId);
            chrome.runtime.onMessage.removeListener(messageListener);

            resolve(result);
          }
        };

        chrome.runtime.onMessage.addListener(messageListener);

        // Capture network activity during recording
        const initialNetworkCount = this.networkLogs.length;
        session.networkStartIndex = initialNetworkCount;

        // Store current recording request so popup can poll for it
        this.currentRecordingRequest = {
          sessionId,
          request,
          state: 'waiting'
        };
        console.log('[Background] Recording request stored for popup polling');

        // Show badge to indicate recording requested
        chrome.action.setBadgeText({ text: '⏸' });
        chrome.action.setBadgeBackgroundColor({ color: '#4a90e2' });

        // Inject recording overlay into the page
        console.log('[Background] Injecting recording overlay');
        chrome.scripting.executeScript({
          target: { tabId: this.state.tabId },
          files: ['recording-overlay.js']
        }).then(() => {
          console.log('[Background] Overlay script injected, creating overlay UI');
          // Create the overlay with sessionId and request
          chrome.scripting.executeScript({
            target: { tabId: this.state.tabId },
            func: (sessionId, request) => {
              if (window.RecordingOverlay) {
                window.mcpRecordingOverlay = new window.RecordingOverlay(sessionId, request);
              } else {
                console.error('[Overlay] RecordingOverlay class not found');
              }
            },
            args: [sessionId, request]
          });
        }).catch(err => {
          console.error('[Background] Failed to inject recording overlay:', err);
          reject(err);
        });

      } catch (error) {
        this.recordingSessions.delete(sessionId);
        reject(error);
      }
    });
  }

  /**
   * Stop a recording session
   */
  async stopRecording(sessionId) {
    console.log('[Background] stopRecording called for:', sessionId);
    const session = this.recordingSessions.get(sessionId);
    if (!session) {
      console.log('[Background] No session found for:', sessionId);
      return;
    }

    // Capture network logs from when recording started
    session.networkActivity = this.networkLogs.slice(session.networkStartIndex);
    console.log('[Background] Captured', session.networkActivity.length, 'network requests');

    // Use stored tabId from session (in case we've disconnected)
    const tabId = session.tabId || this.state.tabId;
    if (!tabId) {
      console.error('[Background] No tabId available to stop recording');
      // Resolve with what we have
      const result = {
        sessionId,
        request: session.request,
        duration: Date.now() - session.startTime,
        startUrl: session.startUrl || '',
        endUrl: '',
        actions: session.actions,
        network: session.networkActivity
      };

      this.currentRecordingRequest = null;
      chrome.action.setBadgeText({ text: '' });
      this.recordingSessions.delete(sessionId);

      if (session.resolve) {
        session.resolve(result);
      }
      return;
    }

    // Send stop message to content script via executeScript
    try {
      console.log('[Background] Sending STOP_RECORDING to content script');
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (sessionId) => {
          console.log('[Content] Received STOP_RECORDING');
          window.postMessage({
            type: 'STOP_RECORDING',
            sessionId
          }, '*');
        },
        args: [sessionId]
      });
      console.log('[Background] STOP_RECORDING message sent');
    } catch (error) {
      console.error('[Background] Error stopping recording:', error);

      // If we can't inject, resolve with what we have
      const result = {
        sessionId,
        request: session.request,
        duration: Date.now() - session.startTime,
        startUrl: session.startUrl || '',
        endUrl: '',
        actions: session.actions,
        network: session.networkActivity
      };

      this.currentRecordingRequest = null;
      chrome.action.setBadgeText({ text: '' });
      this.recordingSessions.delete(sessionId);

      if (session.resolve) {
        session.resolve(result);
      }
    }
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

        // Button handlers
        document.getElementById('mcp-complete-btn').addEventListener('click', () => {
          chrome.runtime.sendMessage({
            type: 'USER_ACTION_COMPLETE',
            requestId: requestId
          });
          overlay.remove();
        });

        document.getElementById('mcp-reject-btn').addEventListener('click', () => {
          chrome.runtime.sendMessage({
            type: 'USER_ACTION_REJECTED',
            requestId: requestId
          });
          overlay.remove();
        });

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
            console.log('[Background] User completed action');
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
              interactions: interactions.interactions
            });
          } else if (message.type === 'USER_ACTION_REJECTED' && message.requestId === requestId) {
            console.log('[Background] User rejected action');
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
              interactions: []
            });
          }
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
}

// Initialize controller
const controller = new BackgroundController();

console.log('[Background] Browser MCP extension loaded');
