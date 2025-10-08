/**
 * Browser MCP - Background Service Worker
 * Central coordinator for WebSocket, Chrome Debugger, and message routing
 */

importScripts('utils/websocket.js', 'utils/cdp.js');

class BackgroundController {
  constructor() {
    this.ws = new WebSocketManager('ws://localhost:9009');
    this.cdp = new CDPHelper();
    this.handlers = {};
    this.consoleLogs = [];
    this.badgeBlinkInterval = null;
    this.state = {
      connected: false,
      tabId: null,
      tabUrl: null,
      tabTitle: null
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
      if (this.state.tabId === tabId && changeInfo.url) {
        console.log('[Background] Tab navigated to:', changeInfo.url);
        this.state.tabUrl = changeInfo.url;
        this.state.tabTitle = tab.title;
      }
    });

    // Debugger detached
    chrome.debugger.onDetach.addListener((source, reason) => {
      if (source.tabId === this.state.tabId) {
        console.log('[Background] Debugger detached:', reason);
        if (reason !== 'canceled_by_user') {
          this.disconnect();
        }
      }
    });

    // Messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handlePopupMessage(message, sendResponse);
      return true; // Keep channel open for async response
    });

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

    // Information handlers
    this.handlers['browser_snapshot'] = this.handleSnapshot.bind(this);
    this.handlers['browser_screenshot'] = this.handleScreenshot.bind(this);
    this.handlers['browser_get_console_logs'] = this.handleGetConsoleLogs.bind(this);
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
      this.state.tabTitle = tab.title;
      this.consoleLogs = [];

      // Connect WebSocket
      this.ws.connect();

      this.state.connected = true;
      this.updateConnectionState();

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

    this.ws.disconnect();
    await this.cdp.detach();

    this.state.connected = false;
    this.state.tabId = null;
    this.state.tabUrl = null;
    this.state.tabTitle = null;
    this.consoleLogs = [];

    this.updateConnectionState();
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
            tabTitle: this.state.tabTitle
          }
        });
        break;

      default:
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
    // TODO: Drag and drop
    return { success: true };
  }

  async handleSelectOption({ element, ref, values }) {
    // TODO: Select dropdown options
    return { success: true, values };
  }

  async handlePressKey({ key }) {
    await this.cdp.pressKey(key);
    return { success: true, key };
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
    // TODO: Implement visible text extraction
    return { text: 'TODO: implement visible text' };
  }

  async handleGetComputedStyles({ selector, properties }) {
    // TODO: Implement computed styles
    return { styles: {} };
  }

  async handleCheckVisibility({ selector }) {
    // TODO: Implement visibility check
    return { visible: true };
  }

  async handleGetAttributes({ selector, attributes }) {
    // TODO: Implement get attributes
    return { attributes: {} };
  }

  async handleCountElements({ selector }) {
    return this.cdp.evaluate(`document.querySelectorAll('${selector.replace(/'/g, "\\'")}').length`);
  }

  async handleGetPageMetadata() {
    // TODO: Implement metadata extraction
    return { metadata: {} };
  }

  async handleGetFilteredAriaTree({ roles, maxDepth, interactiveOnly }) {
    // TODO: Implement filtered ARIA tree
    return { tree: {} };
  }

  async handleFindByText({ text, selector, exact, limit }) {
    // TODO: Implement find by text
    return { results: [] };
  }

  async handleGetFormValues({ formSelector }) {
    // TODO: Implement form values
    return { values: {} };
  }

  async handleCheckElementState({ selector }) {
    // TODO: Implement element state
    return { state: {} };
  }
}

// Initialize controller
const controller = new BackgroundController();

console.log('[Background] Browser MCP extension loaded');
