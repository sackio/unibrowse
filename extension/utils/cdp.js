/**
 * Chrome DevTools Protocol (CDP) Helper Utilities
 * Wraps chrome.debugger API with convenient helper functions
 */

class CDPHelper {
  constructor() {
    this.target = null;
    this.enabledDomains = new Set();
    this.isDetaching = false; // Flag to prevent operations during detachment
    this.reattachAttempts = 0;
    this.maxReattachAttempts = 3;
    this.reattachDelay = 1000; // Start with 1 second
    this.detachListener = null;
    this.lastKnownUrl = null;
  }

  /**
   * Validate tab exists and get its current state
   */
  async validateTab(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);

      // Check if URL is accessible
      if (tab.url && (
        tab.url.startsWith('chrome://') ||
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('edge://') ||
        tab.url.startsWith('about:')
      )) {
        throw new Error(`Cannot attach debugger to restricted URL: ${tab.url}`);
      }

      this.lastKnownUrl = tab.url;
      return tab;
    } catch (error) {
      console.error('[CDP] Tab validation failed:', error);
      throw error;
    }
  }

  /**
   * Setup detach event listener
   * NOTE: This listener only tracks detachments for logging.
   * Reattachment is handled by background.js to avoid conflicts.
   */
  setupDetachListener() {
    if (this.detachListener) {
      chrome.debugger.onDetach.removeListener(this.detachListener);
    }

    this.detachListener = (source, reason) => {
      if (this.target && source.tabId === this.target.tabId) {
        console.warn(`[CDP] Debugger detached from tab ${source.tabId}, reason:`, reason);
        this.isDetaching = true;
        const wasAttached = this.target !== null;
        this.target = null;
        this.enabledDomains.clear();

        // Log the detachment but let background.js handle reattachment
        console.log(`[CDP] Detachment logged. Background.js will handle reattachment if needed.`);
      }
    };

    chrome.debugger.onDetach.addListener(this.detachListener);
  }

  /**
   * Attempt to reattach debugger
   */
  async attemptReattach(tabId) {
    this.reattachAttempts++;

    try {
      await this.attach(tabId);
      console.log('[CDP] Successfully reattached debugger');
      this.reattachAttempts = 0; // Reset on success
    } catch (error) {
      console.error(`[CDP] Reattach attempt ${this.reattachAttempts} failed:`, error);

      if (this.reattachAttempts < this.maxReattachAttempts) {
        const nextDelay = this.reattachDelay * Math.pow(2, this.reattachAttempts);
        console.log(`[CDP] Will retry in ${nextDelay}ms`);
        setTimeout(() => this.attemptReattach(tabId), nextDelay);
      } else {
        console.error('[CDP] Max reattach attempts reached, giving up');
      }
    }
  }

  /**
   * Attach debugger to target tab
   */
  async attach(tabId) {
    try {
      // Validate tab before attempting attach
      console.log('[CDP] Validating tab:', tabId);
      await this.validateTab(tabId);
      console.log('[CDP] Tab validated');

      this.target = { tabId };
      this.isDetaching = false;
      this.reattachAttempts = 0;

      console.log('[CDP] Calling chrome.debugger.attach...');

      // Attempt to attach with conflict resolution
      let attachSuccess = false;
      let lastError = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await chrome.debugger.attach(this.target, '1.3');
          attachSuccess = true;
          break;
        } catch (attachError) {
          lastError = attachError;
          console.error(`[CDP] Attach error (attempt ${attempt}/3):`, attachError);

          // If another debugger is already attached, force detach and retry
          if (attachError.message && attachError.message.includes('Another debugger is already attached')) {
            console.warn(`[CDP] Another debugger is attached, force detaching (attempt ${attempt}/3)...`);
            try {
              // Force detach - ignore errors
              await chrome.debugger.detach(this.target).catch(() => {});
              // Longer delay to ensure Chrome cleans up
              await new Promise(resolve => setTimeout(resolve, 200 * attempt));
              console.log(`[CDP] Waiting complete, retrying attach...`);
            } catch (detachError) {
              console.warn('[CDP] Detach error (continuing anyway):', detachError);
              await new Promise(resolve => setTimeout(resolve, 200 * attempt));
            }
          } else {
            // Different error, don't retry
            throw attachError;
          }
        }
      }

      if (!attachSuccess) {
        console.error('[CDP] Failed to attach after 3 attempts');
        throw lastError;
      }

      console.log('[CDP] Debugger attached to tab:', tabId);

      // Setup detach listener
      console.log('[CDP] Setting up detach listener...');
      this.setupDetachListener();
      console.log('[CDP] Detach listener setup complete');

      // Enable essential CDP domains
      // Note: Input domain doesn't have .enable method
      console.log('[CDP] Enabling CDP domains...');
      await this.enableDomains(['Page', 'Runtime', 'DOM', 'Accessibility', 'Console', 'Network']);
      console.log('[CDP] All domains enabled');

      console.log('[CDP] attach() complete, returning true');
      return true;
    } catch (error) {
      console.error('[CDP] Failed to attach debugger:', error);
      this.target = null;
      throw error;
    }
  }

  /**
   * Detach debugger from target
   */
  async detach() {
    if (!this.target) {
      return;
    }

    try {
      this.isDetaching = true; // Set flag before detaching

      // Remove detach listener before detaching to avoid triggering it
      if (this.detachListener) {
        chrome.debugger.onDetach.removeListener(this.detachListener);
        this.detachListener = null;
      }

      await chrome.debugger.detach(this.target);
      console.log('[CDP] Debugger detached');
      this.target = null;
      this.enabledDomains.clear();
      this.isDetaching = false;
      this.lastKnownUrl = null;
    } catch (error) {
      console.error('[CDP] Failed to detach debugger:', error);
      this.target = null;
      this.enabledDomains.clear();
      this.isDetaching = false;
      this.lastKnownUrl = null;
    }
  }

  /**
   * Enable CDP domains
   */
  async enableDomains(domains) {
    console.log('[CDP] enableDomains called with:', domains);
    const errors = [];

    for (const domain of domains) {
      if (this.enabledDomains.has(domain)) {
        console.log(`[CDP] Domain ${domain} already enabled, skipping`);
        continue;
      }

      try {
        console.log(`[CDP] Enabling domain: ${domain}...`);
        await this.sendCommand(`${domain}.enable`);
        this.enabledDomains.add(domain);
        console.log(`[CDP] ✓ Enabled domain: ${domain}`);
      } catch (error) {
        console.warn(`[CDP] ✗ Failed to enable domain ${domain}:`, error.message);
        errors.push({ domain, error: error.message });
        // Continue with other domains - don't let one failure stop everything
      }
    }

    if (errors.length > 0) {
      console.warn('[CDP] Some domains failed to enable:', errors);
      // Only throw if ALL domains failed
      if (errors.length === domains.length) {
        throw new Error(`Failed to enable all CDP domains: ${errors.map(e => e.domain).join(', ')}`);
      }
    }

    console.log('[CDP] enableDomains complete - enabled:', Array.from(this.enabledDomains));
  }

  /**
   * Ensure debugger is attached and tab is valid before operation
   */
  async ensureAttached() {
    if (!this.target) {
      throw new Error('Debugger not attached');
    }

    if (this.isDetaching) {
      throw new Error('Debugger is detaching');
    }

    // Validate tab still exists and is accessible
    try {
      const tab = await chrome.tabs.get(this.target.tabId);

      // Check if tab navigated to restricted URL
      if (tab.url && (
        tab.url.startsWith('chrome://') ||
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('edge://') ||
        tab.url.startsWith('about:')
      )) {
        console.warn(`[CDP] Tab navigated to restricted URL: ${tab.url}`);
        throw new Error(`Cannot operate on restricted URL: ${tab.url}`);
      }

      // Update last known URL
      this.lastKnownUrl = tab.url;
      return true;
    } catch (error) {
      // Check if this is a "tab not found" error (tab was closed)
      const errorMessage = error.message || '';
      if (errorMessage.includes('No tab with id:') ||
          errorMessage.includes('Tab not found') ||
          errorMessage.includes('tab was closed')) {
        // Tab was closed - this is expected, handle gracefully
        console.log(`[CDP] Tab ${this.target.tabId} no longer exists (closed)`);
        this.target = null;
        this.isDetaching = true;
        throw new Error(`Tab ${this.target.tabId} was closed`);
      }

      // Other errors (restricted URLs, etc.) - log and throw
      console.error('[CDP] Tab validation failed during ensureAttached:', error);
      this.target = null;
      this.isDetaching = true;
      throw error;
    }
  }

  /**
   * Send CDP command with retry logic and timeout
   * @param {string} method - CDP method name
   * @param {object} params - Method parameters
   * @param {number} retries - Current retry attempt
   * @param {number} maxRetries - Maximum retry attempts
   * @param {number} timeoutMs - Optional timeout in milliseconds (0 = no timeout)
   */
  async sendCommand(method, params = {}, retries = 0, maxRetries = 1, timeoutMs = null) {
    // Validate attachment before command
    await this.ensureAttached();

    try {
      // Determine timeout based on method type if not explicitly provided
      if (timeoutMs === null) {
        // Runtime.evaluate (macros): 2 minutes - complex operations need time
        // Page navigation: 30 seconds - page loads can be slow
        // Other commands: 10 seconds - general operations
        if (method === 'Runtime.evaluate') {
          timeoutMs = 120000; // 2 minutes for macros and JavaScript execution
        } else if (method.startsWith('Page.navigate') || method.startsWith('Page.reload')) {
          timeoutMs = 30000; // 30 seconds for navigation
        } else {
          timeoutMs = 10000; // 10 seconds for other commands
        }
      }

      const commandPromise = chrome.debugger.sendCommand(this.target, method, params);

      // Only apply timeout if timeoutMs > 0 (allows disabling timeout with 0)
      if (timeoutMs > 0) {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`CDP command ${method} timed out after ${timeoutMs/1000} seconds`)), timeoutMs);
        });
        const result = await Promise.race([commandPromise, timeoutPromise]);
        console.log(`[CDP] ${method}:`, result);
        return result;
      } else {
        // No timeout - wait indefinitely
        const result = await commandPromise;
        console.log(`[CDP] ${method}:`, result);
        return result;
      }
    } catch (error) {
      // Parse CDP error if it's in stringified JSON format
      let cdpError = error;
      if (error.message && error.message.startsWith('{')) {
        try {
          cdpError = JSON.parse(error.message);
        } catch {
          // Not JSON, use original error
        }
      }

      // Check for various detachment/navigation scenarios
      const errorMessage = cdpError.message || error.message || '';
      const errorCode = cdpError.code || '';

      // Handle detachment
      if (errorMessage.includes('Detached') || errorMessage.includes('detached') ||
          errorMessage.includes('not attached')) {
        console.warn(`[CDP] ${method} failed due to detachment`);
        this.isDetaching = true;
        const oldTabId = this.target?.tabId;
        this.target = null;
        this.enabledDomains.clear();

        // Retry after reattachment if within retry limit
        if (retries < maxRetries && oldTabId) {
          console.log(`[CDP] Attempting to reattach and retry ${method} (retry ${retries + 1}/${maxRetries})`);
          try {
            await new Promise(resolve => setTimeout(resolve, 500)); // Brief delay
            await this.attach(oldTabId);
            return this.sendCommand(method, params, retries + 1, maxRetries, timeoutMs);
          } catch (reattachError) {
            console.error(`[CDP] Reattachment failed:`, reattachError);
            throw error; // Throw original error
          }
        }
      }

      // Handle navigation interruption
      if (errorCode === -32000 && errorMessage.includes('Inspected target navigated or closed')) {
        console.warn(`[CDP] ${method} interrupted by page navigation`);
        throw new Error('Page navigation interrupted command execution. This is normal for actions that trigger navigation.');
      }

      // Handle chrome-extension:// URL errors - detach gracefully instead of throwing
      if (errorMessage.includes('Cannot access a chrome-extension://')) {
        console.warn(`[CDP] ${method} failed: Cannot access chrome-extension:// URL - detaching gracefully`);

        // Mark as detached to prevent further operations
        this.isDetaching = true;
        this.target = null;
        this.enabledDomains.clear();

        // Return a special error object that indicates graceful detachment
        // This allows the caller to distinguish between fatal errors and expected detachments
        const gracefulError = new Error('Tab navigated to chrome-extension:// URL (graceful detachment)');
        gracefulError.isGracefulDetachment = true;
        gracefulError.reason = 'chrome-extension-navigation';
        throw gracefulError;
      }

      // Handle about:blank#blocked and other restricted frame errors
      if (errorMessage.includes('Cannot access contents of url') ||
          errorMessage.includes('about:blank#blocked') ||
          errorMessage.includes('Extension manifest must request permission')) {
        console.warn(`[CDP] ${method} encountered restricted frame:`, errorMessage);

        // For accessibility tree requests, return a minimal valid tree
        if (method === 'Accessibility.getFullAXTree') {
          console.log('[CDP] Returning empty accessibility tree due to restricted frames');
          return { nodes: [] };
        }

        // For other operations, provide a clear error message
        throw new Error(`Page contains restricted content (iframes with about:blank#blocked or chrome:// URLs) that cannot be accessed. The main page is accessible but some frames are blocked.`);
      }

      console.error(`[CDP] ${method} failed:`, error);
      throw error;
    }
  }

  /**
   * Evaluate JavaScript in page context
   */
  async evaluate(expression, returnByValue = true) {
    try {
      const result = await this.sendCommand('Runtime.evaluate', {
        expression,
        returnByValue,
        awaitPromise: true,
        userGesture: true
      });

      if (result.exceptionDetails) {
        throw new Error(`Evaluation error: ${result.exceptionDetails.exception.description}`);
      }

      return result.result.value;
    } catch (error) {
      // Check if this is a navigation interruption
      if (error.message && error.message.includes('Page navigation interrupted command execution')) {
        // Return a special value indicating navigation occurred
        console.log('[CDP] Evaluation interrupted by navigation - returning navigation indicator');
        return {
          __navigation_occurred: true,
          message: 'Command execution interrupted by page navigation'
        };
      }
      throw error;
    }
  }

  /**
   * Execute function in page context
   */
  async executeFunction(func, args = []) {
    const argsStr = args.map(arg => JSON.stringify(arg)).join(', ');
    const expression = `(${func.toString()})(${argsStr})`;
    return this.evaluate(expression);
  }

  /**
   * Query by accessibility nodeId and return element info
   */
  async queryByNodeId(nodeId) {
    // Get the full accessibility tree
    const tree = await this.getAccessibilityTree();

    // Find the node by nodeId
    const node = tree.nodes.find(n => n.nodeId === nodeId);
    if (!node) {
      throw new Error(`Accessibility node not found: ${nodeId}`);
    }

    // Get the backend DOM node ID
    if (!node.backendDOMNodeId) {
      throw new Error(`Node ${nodeId} does not have a DOM node reference`);
    }

    // Use DOM.getBoxModel to get the element's bounding box
    try {
      const boxModel = await this.sendCommand('DOM.getBoxModel', {
        backendNodeId: node.backendDOMNodeId
      });

      // Calculate center of content box
      const content = boxModel.model.content;
      const x = (content[0] + content[2] + content[4] + content[6]) / 4;
      const y = (content[1] + content[3] + content[5] + content[7]) / 4;
      const width = Math.max(content[2] - content[0], content[4] - content[6]);
      const height = Math.max(content[5] - content[1], content[7] - content[3]);

      return {
        exists: true,
        nodeId,
        backendDOMNodeId: node.backendDOMNodeId,
        rect: { x, y, width, height }
      };
    } catch (error) {
      console.error(`[CDP] Failed to get box model for node ${nodeId}:`, error);
      throw new Error(`Failed to get element coordinates for node ${nodeId}`);
    }
  }

  /**
   * Query DOM selector and return element info
   */
  async querySelector(selector) {
    // Check if selector is a nodeId (numeric string) or CSS selector
    if (/^\d+$/.test(selector)) {
      // It's a nodeId from accessibility tree
      return this.queryByNodeId(selector);
    }

    // It's a CSS selector
    return this.evaluate(`
      (function() {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return null;

        const rect = el.getBoundingClientRect();
        return {
          exists: true,
          tagName: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.className || undefined,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          }
        };
      })()
    `);
  }

  /**
   * Click element at coordinates
   */
  async click(x, y) {
    await this.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1
    });

    await this.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1
    });
  }

  /**
   * Drag and drop from start coordinates to end coordinates
   */
  async drag(startX, startY, endX, endY) {
    // Move to start position
    await this.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: startX,
      y: startY
    });

    // Press mouse button at start
    await this.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: startX,
      y: startY,
      button: 'left',
      clickCount: 1
    });

    // Small delay to register the press
    await new Promise(resolve => setTimeout(resolve, 50));

    // Move mouse to end position in steps for smooth drag
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const currentX = startX + (endX - startX) * (i / steps);
      const currentY = startY + (endY - startY) * (i / steps);

      await this.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: currentX,
        y: currentY,
        button: 'left'
      });

      // Small delay between moves
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    // Release mouse button at end
    await this.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: endX,
      y: endY,
      button: 'left',
      clickCount: 1
    });
  }

  /**
   * Type text
   */
  async type(text) {
    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // Check if still attached before each keystroke
      if (!this.isAttached() || this.isDetaching) {
        throw new Error(`Typing interrupted: debugger detached after ${i} characters`);
      }

      try {
        await this.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown',
          text: char
        });

        await this.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          text: char
        });

        // Small delay between keystrokes
        await new Promise(resolve => setTimeout(resolve, 10));
      } catch (error) {
        // If detached during typing, throw with context
        if (error.message && error.message.includes('Detached')) {
          throw new Error(`Typing interrupted by detachment after ${i} of ${text.length} characters`);
        }
        throw error;
      }
    }
  }

  /**
   * Press key
   */
  async pressKey(key) {
    await this.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key
    });

    await this.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key
    });
  }

  /**
   * Scroll by specific amount
   */
  async scroll(x = 0, y = 0) {
    return this.evaluate(`window.scrollBy(${x}, ${y})`, true);
  }

  /**
   * Scroll to element
   */
  async scrollToElement(selector) {
    return this.evaluate(`
      (function() {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return { success: false, error: 'Element not found' };
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { success: true };
      })()
    `, true);
  }

  /**
   * Navigate to URL
   */
  async navigate(url) {
    return this.sendCommand('Page.navigate', { url });
  }

  /**
   * Go back in history
   */
  async goBack() {
    // Get navigation history
    const history = await this.sendCommand('Page.getNavigationHistory');
    const currentIndex = history.currentIndex;

    if (currentIndex > 0) {
      const entry = history.entries[currentIndex - 1];
      return this.sendCommand('Page.navigateToHistoryEntry', { entryId: entry.id });
    }

    throw new Error('Cannot go back: at beginning of history');
  }

  /**
   * Go forward in history
   */
  async goForward() {
    const history = await this.sendCommand('Page.getNavigationHistory');
    const currentIndex = history.currentIndex;

    if (currentIndex < history.entries.length - 1) {
      const entry = history.entries[currentIndex + 1];
      return this.sendCommand('Page.navigateToHistoryEntry', { entryId: entry.id });
    }

    throw new Error('Cannot go forward: at end of history');
  }

  /**
   * Take screenshot
   */
  async captureScreenshot(format = 'png', quality = 80) {
    const result = await this.sendCommand('Page.captureScreenshot', {
      format,
      quality: format === 'jpeg' ? quality : undefined
    });

    return result.data; // Returns base64 encoded image
  }

  /**
   * Get element region for screenshot capture
   * @param {string} selector - CSS selector for the element
   * @returns {Object} Element region with {x, y, width, height, label, scrolled}
   */
  async getElementRegion(selector) {
    const scrollResult = await this.evaluate(`
      (function() {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return { found: false };

        const initialRect = element.getBoundingClientRect();
        const initiallyInView = (
          initialRect.top >= 0 &&
          initialRect.left >= 0 &&
          initialRect.bottom <= window.innerHeight &&
          initialRect.right <= window.innerWidth
        );

        if (!initiallyInView) {
          element.scrollIntoView({ behavior: "instant", block: "start", inline: "start" });
        }

        const rect = element.getBoundingClientRect();
        let label = element.id || (element.className && element.className.split(" ")[0]) || "";

        return {
          found: true,
          scrolled: !initiallyInView,
          x: Math.max(0, rect.left),
          y: Math.max(0, rect.top),
          width: Math.min(rect.width, window.innerWidth - rect.left),
          height: Math.min(rect.height, window.innerHeight - rect.top),
          label: label
        };
      })()
    `);

    if (!scrollResult.found) {
      throw new Error(`Element not found: ${selector}`);
    }
    return scrollResult;
  }

  /**
   * Capture segmented screenshots based on CSS selectors
   * @param {string[]} selectors - Array of CSS selectors
   * @param {Object} options - Options {includeLabels}
   * @returns {Array} Array of {selector, base64Data, label} or {selector, base64Data: null, label: '', error}
   */
  async captureSegmentedScreenshots(selectors, options = {}) {
    const screenshots = [];
    const { includeLabels = false } = options;

    for (const selector of selectors) {
      try {
        const region = await this.getElementRegion(selector);

        // Wait for animations to settle if we scrolled
        if (region.scrolled) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        const result = await this.sendCommand('Page.captureScreenshot', {
          format: 'png',
          clip: {
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
            scale: 1,
          },
        });

        screenshots.push({
          selector: selector,
          base64Data: result.data,
          label: includeLabels ? region.label : '',
        });
      } catch (error) {
        screenshots.push({
          selector: selector,
          base64Data: null,
          label: '',
          error: error.message,
        });
      }
    }
    return screenshots;
  }

  /**
   * Get accessibility tree
   */
  async getAccessibilityTree() {
    return this.sendCommand('Accessibility.getFullAXTree');
  }

  /**
   * Get partial accessibility tree (filtered)
   */
  async getPartialAccessibilityTree(depth = 5) {
    // Use getFullAXTree instead - getPartialAXTree requires a nodeId
    const tree = await this.sendCommand('Accessibility.getFullAXTree');
    return tree;
  }

  /**
   * Check if target is attached
   */
  isAttached() {
    return this.target !== null;
  }

  /**
   * Get current target
   */
  getTarget() {
    return this.target;
  }

  /**
   * Generate bezier curve points for natural mouse movement
   * Uses cubic bezier curve with random control points
   */
  generateBezierCurve(startX, startY, endX, endY, steps = 20) {
    const points = [];

    // Generate random control points for natural curve
    const cp1x = startX + (endX - startX) * (0.25 + Math.random() * 0.25);
    const cp1y = startY + (endY - startY) * (Math.random() * 0.5 - 0.25);
    const cp2x = startX + (endX - startX) * (0.5 + Math.random() * 0.25);
    const cp2y = startY + (endY - startY) * (0.5 + Math.random() * 0.5);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const invT = 1 - t;

      // Cubic bezier formula
      const x = Math.pow(invT, 3) * startX +
                3 * Math.pow(invT, 2) * t * cp1x +
                3 * invT * Math.pow(t, 2) * cp2x +
                Math.pow(t, 3) * endX;

      const y = Math.pow(invT, 3) * startY +
                3 * Math.pow(invT, 2) * t * cp1y +
                3 * invT * Math.pow(t, 2) * cp2y +
                Math.pow(t, 3) * endY;

      points.push({ x: Math.round(x), y: Math.round(y) });
    }

    return points;
  }

  /**
   * Move mouse along natural bezier curve path
   * @param {number} targetX - Destination X coordinate
   * @param {number} targetY - Destination Y coordinate
   * @param {object} options - Movement options
   * @param {number} options.duration - Movement duration in ms (default: 500)
   * @param {number} options.currentX - Current mouse X position (default: 0)
   * @param {number} options.currentY - Current mouse Y position (default: 0)
   * @param {number} options.steps - Number of movement steps (default: 20)
   */
  async moveMouseRealistic(targetX, targetY, options = {}) {
    const {
      duration = 500,
      currentX = 0,
      currentY = 0,
      steps = 20
    } = options;

    const points = this.generateBezierCurve(currentX, currentY, targetX, targetY, steps);
    const delayPerStep = duration / steps;

    for (const point of points) {
      if (!this.isAttached() || this.isDetaching) {
        throw new Error('Mouse movement interrupted: debugger detached');
      }

      await this.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y
      });

      // Variable delay with slight randomness for human-like behavior
      const randomDelay = delayPerStep * (0.8 + Math.random() * 0.4);
      await new Promise(resolve => setTimeout(resolve, randomDelay));
    }

    return { x: targetX, y: targetY };
  }

  /**
   * Perform realistic click with human-like timing
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {object} options - Click options
   * @param {string} options.button - Mouse button ('left', 'right', 'middle')
   * @param {number} options.clickCount - Number of clicks (1 = single, 2 = double)
   * @param {number} options.downDelay - Delay between press and release in ms (default: 50-100 random)
   * @param {boolean} options.moveFirst - Whether to move mouse to position first (default: true)
   * @param {number} options.moveDuration - Duration of mouse movement in ms (default: 300)
   */
  async clickRealistic(x, y, options = {}) {
    const {
      button = 'left',
      clickCount = 1,
      downDelay = 50 + Math.random() * 50,
      moveFirst = true,
      moveDuration = 300,
      currentX = 0,
      currentY = 0
    } = options;

    // Move mouse to position first if requested
    if (moveFirst) {
      await this.moveMouseRealistic(x, y, {
        duration: moveDuration,
        currentX,
        currentY
      });
      // Small pause before clicking (human reaction time)
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
    }

    // Perform click(s)
    for (let i = 0; i < clickCount; i++) {
      await this.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button,
        clickCount: i + 1
      });

      // Variable delay between press and release
      await new Promise(resolve => setTimeout(resolve, downDelay));

      await this.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button,
        clickCount: i + 1
      });

      // Delay between multiple clicks (for double-click)
      if (i < clickCount - 1) {
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 50));
      }
    }
  }

  /**
   * Type text with realistic human-like timing
   * @param {string} text - Text to type
   * @param {object} options - Typing options
   * @param {number} options.minDelay - Minimum delay between keystrokes in ms (default: 50)
   * @param {number} options.maxDelay - Maximum delay between keystrokes in ms (default: 150)
   * @param {number} options.mistakeChance - Chance of making a typo (0-1, default: 0)
   * @param {boolean} options.pressEnter - Whether to press Enter after typing (default: false)
   */
  async typeRealistic(text, options = {}) {
    const {
      minDelay = 50,
      maxDelay = 150,
      mistakeChance = 0,
      pressEnter = false
    } = options;

    for (let i = 0; i < text.length; i++) {
      if (!this.isAttached() || this.isDetaching) {
        throw new Error(`Typing interrupted: debugger detached after ${i} characters`);
      }

      const char = text[i];

      // Occasionally make a typo and correct it
      if (mistakeChance > 0 && Math.random() < mistakeChance) {
        // Type a random wrong character
        const wrongChar = String.fromCharCode(97 + Math.floor(Math.random() * 26));
        await this._typeChar(wrongChar);
        await new Promise(resolve => setTimeout(resolve, minDelay + Math.random() * (maxDelay - minDelay)));

        // Backspace to delete it
        await this.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Backspace',
          code: 'Backspace',
          windowsVirtualKeyCode: 8
        });
        await this.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Backspace',
          code: 'Backspace',
          windowsVirtualKeyCode: 8
        });
        await new Promise(resolve => setTimeout(resolve, minDelay + Math.random() * (maxDelay - minDelay)));
      }

      // Type the actual character
      await this._typeChar(char);

      // Variable delay between keystrokes
      const delay = minDelay + Math.random() * (maxDelay - minDelay);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Press Enter if requested
    if (pressEnter) {
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));
      await this.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13
      });
      await this.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13
      });
    }
  }

  /**
   * Helper to type a single character
   */
  async _typeChar(char) {
    await this.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      text: char
    });
    await this.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      text: char
    });
  }
}

// Export for use in background.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CDPHelper;
}
