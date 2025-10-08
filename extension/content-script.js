/**
 * Content Script for Recording User Demonstrations
 *
 * This script is injected into pages to capture user interactions
 * when the user is demonstrating a workflow to Claude.
 */

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
    window.postMessage({
      type: 'RECORDING_ACTION',
      sessionId: this.sessionId,
      action
    }, '*');
  }

  /**
   * Start recording
   */
  start() {
    this.recording = true;
    this.createUI();
    this.attachListeners();
  }

  /**
   * Stop recording
   */
  stop() {
    this.recording = false;
    this.detachListeners();
    this.removeUI();

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
   * Create floating UI
   */
  createUI() {
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
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="font-size: 12px; opacity: 0.8;">
            <span id="mcp-action-count">0 actions</span> · <span id="mcp-time">0s</span>
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
      window.postMessage({
        type: 'RECORDING_COMPLETE',
        sessionId: this.sessionId
      }, '*');
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
      if (e.target.closest('#mcp-recording-ui')) return;
      // Only record special keys
      if (['Enter', 'Tab', 'Escape'].includes(e.key)) {
        this.recordAction('keydown', {
          key: e.key,
          element: this.captureElementContext(e.target)
        });
      }
    };

    // Store listeners for cleanup
    this.listeners = [
      { event: 'click', handler: clickHandler, options: { capture: true } },
      { event: 'input', handler: inputHandler },
      { event: 'submit', handler: submitHandler },
      { event: 'change', handler: changeHandler },
      { event: 'keydown', handler: keydownHandler }
    ];

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
      window.postMessage({
        type: 'RECORDING_RESULT',
        result
      }, '*');
      window.__mcpRecorder = null;
    }
  }
});

console.log('[MCP Content Script] Loaded and ready for recording');
