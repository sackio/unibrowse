/**
 * Chrome DevTools Protocol (CDP) Helper Utilities
 * Wraps chrome.debugger API with convenient helper functions
 */

class CDPHelper {
  constructor() {
    this.target = null;
    this.enabledDomains = new Set();
    this.isDetaching = false; // Flag to prevent operations during detachment
  }

  /**
   * Attach debugger to target tab
   */
  async attach(tabId) {
    try {
      this.target = { tabId };
      this.isDetaching = false;
      await chrome.debugger.attach(this.target, '1.3');
      console.log('[CDP] Debugger attached to tab:', tabId);

      // Enable essential CDP domains
      // Note: Input domain doesn't have .enable method
      await this.enableDomains(['Page', 'Runtime', 'DOM', 'Accessibility', 'Console', 'Network']);

      return true;
    } catch (error) {
      console.error('[CDP] Failed to attach debugger:', error);
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
      await chrome.debugger.detach(this.target);
      console.log('[CDP] Debugger detached');
      this.target = null;
      this.enabledDomains.clear();
      this.isDetaching = false;
    } catch (error) {
      console.error('[CDP] Failed to detach debugger:', error);
      this.target = null;
      this.enabledDomains.clear();
      this.isDetaching = false;
    }
  }

  /**
   * Enable CDP domains
   */
  async enableDomains(domains) {
    for (const domain of domains) {
      if (this.enabledDomains.has(domain)) {
        continue;
      }

      try {
        await this.sendCommand(`${domain}.enable`);
        this.enabledDomains.add(domain);
        console.log(`[CDP] Enabled domain: ${domain}`);
      } catch (error) {
        console.warn(`[CDP] Failed to enable domain ${domain}:`, error);
      }
    }
  }

  /**
   * Send CDP command
   */
  async sendCommand(method, params = {}) {
    if (!this.target) {
      throw new Error('Debugger not attached');
    }

    // Check if debugger is detaching
    if (this.isDetaching) {
      throw new Error('Debugger is detaching');
    }

    try {
      const result = await chrome.debugger.sendCommand(this.target, method, params);
      console.log(`[CDP] ${method}:`, result);
      return result;
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

      if (errorMessage.includes('Detached') || errorMessage.includes('detached')) {
        console.warn(`[CDP] ${method} failed due to detachment`);
        this.isDetaching = true;
        this.target = null;
      } else if (errorCode === -32000 && errorMessage.includes('Inspected target navigated or closed')) {
        // Page navigated - this is not necessarily an error
        console.warn(`[CDP] ${method} interrupted by page navigation`);
        // Don't mark as detaching - debugger is still attached, just page navigated
        throw new Error('Page navigation interrupted command execution. This is normal for actions that trigger navigation.');
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
