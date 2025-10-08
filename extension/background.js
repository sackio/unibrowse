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
        }
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
      this.state.originalTabTitle = tab.title;
      this.state.tabTitle = tab.title;
      this.consoleLogs = [];

      // Connect WebSocket
      this.ws.connect();

      this.state.connected = true;
      this.updateConnectionState();

      // Update tab title to show MCP indicator
      await this.updateTabTitle();

      // Inject visual indicator on the page
      await this.injectTabIndicator();

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

    // Restore original tab title
    await this.restoreTabTitle();

    // Remove visual indicator from the page
    await this.removeTabIndicator();

    this.ws.disconnect();
    await this.cdp.detach();

    this.state.connected = false;
    this.state.tabId = null;
    this.state.tabUrl = null;
    this.state.tabTitle = null;
    this.state.originalTabTitle = null;
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
    if (!this.state.tabId) return;

    try {
      // Get current title and strip MCP prefix if present
      await this.cdp.evaluate(`
        if (document.title.startsWith('🟢 [MCP] ')) {
          document.title = document.title.replace('🟢 [MCP] ', '');
        }
      `, true);
      console.log('[Background] Tab title restored');
    } catch (error) {
      console.error('[Background] Failed to restore tab title:', error);
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
   * Remove visual indicator from the connected tab
   */
  async removeTabIndicator() {
    if (!this.state.tabId) return;

    try {
      await this.cdp.evaluate(`
        (() => {
          const indicator = document.getElementById('browser-mcp-indicator');
          if (indicator) indicator.remove();
        })();
      `, true);
      console.log('[Background] Tab indicator removed');
    } catch (error) {
      console.error('[Background] Failed to remove indicator:', error);
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
}

// Initialize controller
const controller = new BackgroundController();

console.log('[Background] Browser MCP extension loaded');
