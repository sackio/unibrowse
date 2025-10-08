/**
 * Chrome DevTools Protocol (CDP) Helper Utilities
 * Wraps chrome.debugger API with convenient helper functions
 */

class CDPHelper {
  constructor() {
    this.target = null;
    this.enabledDomains = new Set();
  }

  /**
   * Attach debugger to target tab
   */
  async attach(tabId) {
    try {
      this.target = { tabId };
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
      await chrome.debugger.detach(this.target);
      console.log('[CDP] Debugger detached');
      this.target = null;
      this.enabledDomains.clear();
    } catch (error) {
      console.error('[CDP] Failed to detach debugger:', error);
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

    try {
      const result = await chrome.debugger.sendCommand(this.target, method, params);
      console.log(`[CDP] ${method}:`, result);
      return result;
    } catch (error) {
      console.error(`[CDP] ${method} failed:`, error);
      throw error;
    }
  }

  /**
   * Evaluate JavaScript in page context
   */
  async evaluate(expression, returnByValue = true) {
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
   * Query DOM selector and return element info
   */
  async querySelector(selector) {
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
    for (const char of text) {
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
}

// Export for use in background.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CDPHelper;
}
