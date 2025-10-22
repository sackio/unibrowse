/**
 * Content Script for Recording User Demonstrations
 *
 * This script is injected into pages to capture user interactions
 * when the user is demonstrating a workflow to Claude.
 */

// Prevent redefinition on re-injection
if (!window.DemonstrationRecorder) {

class DemonstrationRecorder {
  constructor(sessionId, request) {
    this.sessionId = sessionId;
    this.request = request;
    this.actions = [];
    this.startTime = Date.now();
    this.startUrl = window.location.href;
    this.recording = false;
    this.ui = null;
    this.listeners = [];
    this.extensionInvalidated = false;
  }

  /**
   * Safe wrapper for chrome.runtime.sendMessage
   */
  safeSendMessage(message, callback) {
    if (this.extensionInvalidated) {
      return;
    }

    if (!chrome.runtime?.id) {
      this.extensionInvalidated = true;
      console.log('[DemonstrationRecorder] Extension context invalidated');
      return;
    }

    try {
      if (callback) {
        chrome.runtime.sendMessage(message, callback);
      } else {
        chrome.runtime.sendMessage(message).catch(err => {
          if (err.message?.includes('Extension context invalidated')) {
            this.extensionInvalidated = true;
          }
        });
      }
    } catch (err) {
      if (err.message?.includes('Extension context invalidated')) {
        this.extensionInvalidated = true;
      }
    }
  }

  /**
   * Generate a robust CSS selector for an element
   */
  generateSelector(element) {
    // Priority 1: Use ID if available
    if (element.id) {
      return `#${element.id}`;
    }

    // Priority 2: Use data-testid if available
    if (element.dataset.testid) {
      return `[data-testid="${element.dataset.testid}"]`;
    }

    // Priority 3: Use unique class combination
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).filter(c => c);
      if (classes.length > 0) {
        const selector = `${element.tagName.toLowerCase()}.${classes.join('.')}`;
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }
      }
    }

    // Priority 4: Use nth-child
    const parent = element.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children);
      const index = siblings.indexOf(element) + 1;
      return `${this.generateSelector(parent)} > ${element.tagName.toLowerCase()}:nth-child(${index})`;
    }

    // Fallback: Just the tag name
    return element.tagName.toLowerCase();
  }

  /**
   * Capture element context
   */
  captureElementContext(element) {
    const rect = element.getBoundingClientRect();
    const computed = window.getComputedStyle(element);

    return {
      selector: this.generateSelector(element),
      tagName: element.tagName.toLowerCase(),
      text: element.textContent?.trim().substring(0, 100) || '',
      value: element.value || '',
      id: element.id || undefined,
      classes: element.className ? element.className.split(/\s+/).filter(c => c) : [],
      name: element.name || undefined,
      type: element.type || undefined,
      role: element.getAttribute('role') || undefined,
      ariaLabel: element.getAttribute('aria-label') || undefined,
      placeholder: element.placeholder || undefined,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      },
      visible: computed.display !== 'none' && computed.visibility !== 'hidden' && computed.opacity !== '0'
    };
  }

  /**
   * Record an action
   */
  recordAction(type, data = {}) {
    const timestamp = Date.now() - this.startTime;
    const action = {
      step: this.actions.length + 1,
      timestamp,
      type,
      ...data
    };
    this.actions.push(action);
    this.updateUI();

    // Send action to background script
    this.safeSendMessage({
      type: 'RECORDING_ACTION',
      sessionId: this.sessionId,
      action
    });
  }

  /**
   * Show notification asking user to start
   * (No UI in content script - popup handles all UI)
   */
  showStartNotification() {
    // Immediately start recording - popup shows the UI
    this.start();
  }

  /**
   * Start recording
   */
  start() {
    this.recording = true;
    this.attachListeners();
  }

  /**
   * Stop recording
   */
  stop() {
    this.recording = false;
    this.detachListeners();

    return {
      sessionId: this.sessionId,
      request: this.request,
      duration: Date.now() - this.startTime,
      startUrl: this.startUrl,
      endUrl: window.location.href,
      actions: this.actions
    };
  }

  /**
   * Create start notification UI
   */
  createStartNotificationUI() {
    // Remove any existing notification
    this.removeStartNotification();

    this.startNotification = document.createElement('div');
    this.startNotification.id = 'mcp-start-notification';
    this.startNotification.innerHTML = `
      <div style="
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        color: #333;
        padding: 32px 40px;
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        z-index: 2147483647;
        max-width: 450px;
        user-select: none;
      ">
        <div style="font-size: 24px; font-weight: 700; margin-bottom: 16px; color: #667eea;">
          🎬 Demonstration Request
        </div>
        <div style="font-size: 15px; line-height: 1.6; margin-bottom: 24px; color: #555;">
          <strong>Claude is asking you to demonstrate:</strong>
          <div style="margin-top: 12px; padding: 12px; background: #f5f5f5; border-radius: 8px; font-style: italic;">
            "${this.request}"
          </div>
        </div>
        <div style="font-size: 13px; color: #777; margin-bottom: 20px;">
          Click Start when you're ready. All your actions will be recorded until you click Done.
        </div>
        <div style="display: flex; gap: 12px;">
          <button id="mcp-start-btn" style="
            flex: 1;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            font-size: 14px;
          ">Start Demonstration</button>
          <button id="mcp-cancel-btn" style="
            background: #f0f0f0;
            color: #666;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            font-size: 14px;
          ">Cancel</button>
        </div>
      </div>
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.4);
        z-index: 2147483646;
      "></div>
    `;

    document.body.appendChild(this.startNotification);

    // Start button handler
    document.getElementById('mcp-start-btn').addEventListener('click', () => {
      this.start();
    });

    // Cancel button handler
    document.getElementById('mcp-cancel-btn').addEventListener('click', () => {
      this.removeStartNotification();
      this.safeSendMessage({
        type: 'RECORDING_CANCELLED',
        sessionId: this.sessionId
      });
    });
  }

  /**
   * Remove start notification
   */
  removeStartNotification() {
    if (this.startNotification) {
      this.startNotification.remove();
      this.startNotification = null;
    }
  }

  /**
   * Create recording UI (after user clicks Start)
   */
  createRecordingUI() {
    this.ui = document.createElement('div');
    this.ui.id = 'mcp-recording-ui';
    this.ui.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 16px 20px;
        border-radius: 12px;
        box-shadow: 0 8px 16px rgba(0,0,0,0.3);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        font-size: 14px;
        z-index: 2147483647;
        min-width: 280px;
        user-select: none;
      ">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
          <div style="
            width: 10px;
            height: 10px;
            background: #ff4444;
            border-radius: 50%;
            animation: pulse 1.5s ease-in-out infinite;
          "></div>
          <div style="font-weight: 600; flex: 1;">Recording Demonstration</div>
        </div>
        <div style="font-size: 12px; opacity: 0.9; margin-bottom: 12px;">
          ${this.request}
        </div>
        <div style="margin-bottom: 8px;">
          <div style="font-size: 12px; opacity: 0.8;">
            <span id="mcp-action-count">0 actions</span> · <span id="mcp-time">0s</span>
          </div>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <div style="font-size: 11px; opacity: 0.7; font-family: monospace;">
            Ctrl+Shift+D
          </div>
          <button id="mcp-done-btn" style="
            background: white;
            color: #667eea;
            border: none;
            padding: 6px 16px;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            font-size: 12px;
          ">Done</button>
        </div>
      </div>
      <style>
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      </style>
    `;

    document.body.appendChild(this.ui);

    // Start timer
    this.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const timeEl = document.getElementById('mcp-time');
      if (timeEl) {
        timeEl.textContent = `${elapsed}s`;
      }
    }, 1000);

    // Done button handler
    const doneBtn = document.getElementById('mcp-done-btn');
    doneBtn.addEventListener('click', () => {
      this.safeSendMessage({
        type: 'RECORDING_COMPLETE',
        sessionId: this.sessionId
      });
    });
  }

  /**
   * Update UI with current action count
   */
  updateUI() {
    const countEl = document.getElementById('mcp-action-count');
    if (countEl) {
      const count = this.actions.length;
      countEl.textContent = `${count} action${count !== 1 ? 's' : ''}`;
    }

    // Also update the overlay if it exists
    if (window.mcpRecordingOverlay) {
      window.mcpRecordingOverlay.actionCount = this.actions.length;
      window.mcpRecordingOverlay.updateActionCount();
    }
  }

  /**
   * Remove UI
   */
  removeUI() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    if (this.ui) {
      this.ui.remove();
      this.ui = null;
    }
  }

  /**
   * Attach event listeners
   */
  attachListeners() {
    const clickHandler = (e) => {
      if (e.target.closest('#mcp-recording-ui')) return;
      this.recordAction('click', {
        element: this.captureElementContext(e.target),
        button: e.button
      });
    };

    const inputHandler = (e) => {
      if (e.target.closest('#mcp-recording-ui')) return;
      this.recordAction('input', {
        element: this.captureElementContext(e.target),
        value: e.target.value
      });
    };

    const submitHandler = (e) => {
      this.recordAction('submit', {
        element: this.captureElementContext(e.target)
      });
    };

    const changeHandler = (e) => {
      if (e.target.closest('#mcp-recording-ui')) return;
      if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox' || e.target.type === 'radio') {
        this.recordAction('change', {
          element: this.captureElementContext(e.target),
          value: e.target.value,
          checked: e.target.checked
        });
      }
    };

    const keydownHandler = (e) => {
      // Check for Ctrl+Shift+D hotkey to stop recording
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        this.stop();
        return;
      }

      if (e.target.closest('#mcp-recording-ui')) return;
      // Only record special keys
      if (['Enter', 'Tab', 'Escape'].includes(e.key)) {
        this.recordAction('keydown', {
          key: e.key,
          element: this.captureElementContext(e.target)
        });
      }
    };

    const selectionHandler = () => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentElement
          : range.commonAncestorContainer;

        this.recordAction('selection', {
          text: selection.toString().trim(),
          element: this.captureElementContext(container),
          rangeStart: range.startOffset,
          rangeEnd: range.endOffset
        });
      }
    };

    // Debounce selection changes to avoid recording every character
    let selectionTimeout;
    const debouncedSelectionHandler = () => {
      clearTimeout(selectionTimeout);
      selectionTimeout = setTimeout(selectionHandler, 500);
    };

    const copyHandler = (e) => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        this.recordAction('copy', {
          text: selection.toString().trim()
        });
      }
    };

    const pasteHandler = (e) => {
      if (e.target.closest('#mcp-recording-ui')) return;
      // Note: Can't access clipboard content directly for security reasons
      this.recordAction('paste', {
        element: this.captureElementContext(e.target)
      });
    };

    const cutHandler = (e) => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        this.recordAction('cut', {
          text: selection.toString().trim(),
          element: this.captureElementContext(e.target)
        });
      }
    };

    const doubleClickHandler = (e) => {
      if (e.target.closest('#mcp-recording-ui')) return;
      this.recordAction('doubleclick', {
        element: this.captureElementContext(e.target)
      });
    };

    const contextMenuHandler = (e) => {
      if (e.target.closest('#mcp-recording-ui')) return;
      this.recordAction('contextmenu', {
        element: this.captureElementContext(e.target),
        x: e.clientX,
        y: e.clientY
      });
    };

    const dragStartHandler = (e) => {
      if (e.target.closest('#mcp-recording-ui')) return;
      this.recordAction('dragstart', {
        element: this.captureElementContext(e.target)
      });
    };

    const dropHandler = (e) => {
      if (e.target.closest('#mcp-recording-ui')) return;
      this.recordAction('drop', {
        element: this.captureElementContext(e.target),
        dataTransfer: e.dataTransfer ? {
          types: Array.from(e.dataTransfer.types),
          files: e.dataTransfer.files.length
        } : null
      });
    };

    const scrollHandler = () => {
      // Debounce scroll events
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = setTimeout(() => {
        this.recordAction('scroll', {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          scrollHeight: document.documentElement.scrollHeight,
          scrollWidth: document.documentElement.scrollWidth
        });
      }, 500);
    };

    const focusHandler = (e) => {
      if (e.target.closest('#mcp-recording-ui')) return;
      // Only record focus on interactive elements
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(e.target.tagName)) {
        this.recordAction('focus', {
          element: this.captureElementContext(e.target)
        });
      }
    };

    const blurHandler = (e) => {
      if (e.target.closest('#mcp-recording-ui')) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && e.target.value) {
        this.recordAction('blur', {
          element: this.captureElementContext(e.target),
          finalValue: e.target.value
        });
      }
    };

    // File upload handler
    const fileChangeHandler = (e) => {
      if (e.target.type === 'file' && e.target.files.length > 0) {
        this.recordAction('fileupload', {
          element: this.captureElementContext(e.target),
          fileCount: e.target.files.length,
          files: Array.from(e.target.files).map(f => ({
            name: f.name,
            size: f.size,
            type: f.type
          }))
        });
      }
    };

    // Wheel/mousewheel for scroll detection
    const wheelHandler = (e) => {
      clearTimeout(this.wheelTimeout);
      this.wheelTimeout = setTimeout(() => {
        this.recordAction('wheel', {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode
        });
      }, 500);
    };

    // Mouse movement tracking (debounced to reduce data)
    const mouseMoveHandler = (e) => {
      // Ignore if hovering over recording UI
      if (e.target.closest('#mcp-recording-ui') || e.target.closest('#mcp-recording-overlay-container')) {
        return;
      }

      clearTimeout(this.mouseMoveTimeout);
      this.mouseMoveTimeout = setTimeout(() => {
        // Get element under mouse
        const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);

        this.recordAction('mousemove', {
          x: e.clientX,
          y: e.clientY,
          pageX: e.pageX,
          pageY: e.pageY,
          screenX: e.screenX,
          screenY: e.screenY,
          elementUnder: elementUnderMouse ? this.captureElementContext(elementUnderMouse) : null
        });
      }, 300); // Record every 300ms of movement
    };

    // Store listeners for cleanup
    this.listeners = [
      { event: 'click', handler: clickHandler, options: { capture: true } },
      { event: 'dblclick', handler: doubleClickHandler, options: { capture: true } },
      { event: 'contextmenu', handler: contextMenuHandler, options: { capture: true } },
      { event: 'input', handler: inputHandler },
      { event: 'submit', handler: submitHandler },
      { event: 'change', handler: changeHandler },
      { event: 'keydown', handler: keydownHandler },
      { event: 'selectionchange', handler: debouncedSelectionHandler },
      { event: 'copy', handler: copyHandler },
      { event: 'paste', handler: pasteHandler },
      { event: 'cut', handler: cutHandler },
      { event: 'dragstart', handler: dragStartHandler },
      { event: 'drop', handler: dropHandler },
      { event: 'scroll', handler: scrollHandler },
      { event: 'wheel', handler: wheelHandler },
      { event: 'mousemove', handler: mouseMoveHandler },
      { event: 'focus', handler: focusHandler, options: { capture: true } },
      { event: 'blur', handler: blurHandler, options: { capture: true } }
    ];

    // Separate listener for file inputs (needs to be on change event)
    document.addEventListener('change', fileChangeHandler, { capture: true });

    // Attach all listeners
    this.listeners.forEach(({ event, handler, options }) => {
      document.addEventListener(event, handler, options);
    });

    // Navigation detection
    this.originalUrl = window.location.href;
    this.urlCheckInterval = setInterval(() => {
      if (window.location.href !== this.originalUrl) {
        this.recordAction('navigation', {
          url: window.location.href,
          previousUrl: this.originalUrl
        });
        this.originalUrl = window.location.href;
      }
    }, 500);
  }

  /**
   * Detach event listeners
   */
  detachListeners() {
    this.listeners.forEach(({ event, handler, options }) => {
      document.removeEventListener(event, handler, options);
    });
    this.listeners = [];

    if (this.urlCheckInterval) {
      clearInterval(this.urlCheckInterval);
    }
  }
}

// Store class globally
window.DemonstrationRecorder = DemonstrationRecorder;

} // End of redefinition check

// Message handler from background script
window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  const { type, data } = event.data;

  if (type === 'START_RECORDING') {
    const recorder = new DemonstrationRecorder(data.sessionId, data.request);
    window.__mcpRecorder = recorder;
    recorder.start();
  } else if (type === 'STOP_RECORDING') {
    if (window.__mcpRecorder) {
      const result = window.__mcpRecorder.stop();
      // Safe send for message listener context
      if (chrome.runtime?.id) {
        try {
          chrome.runtime.sendMessage({
            type: 'RECORDING_RESULT',
            result
          }).catch(() => {
            // Extension context invalidated during reload
          });
        } catch (err) {
          // Extension context invalidated
        }
      }
      window.__mcpRecorder = null;
    }
  }
});

console.log('[MCP Content Script] Loaded and ready for recording');
