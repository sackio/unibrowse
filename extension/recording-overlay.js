/**
 * Recording Overlay UI
 *
 * Displays a non-intrusive overlay for recording requests with:
 * - Expanded state: Full bar showing request and controls
 * - Minimized state: Floating button
 * - Shadow DOM for complete isolation from page
 * - Hotkey support
 * - Persistence across navigation
 */

class RecordingOverlay {
  constructor(sessionId, request, initialState = null) {
    this.sessionId = sessionId;
    this.request = request;
    this.state = 'waiting'; // 'waiting' | 'recording' | 'minimized-waiting' | 'minimized-recording'
    this.actionCount = 0;
    this.startTime = null;
    this.timerInterval = null;
    this.container = null;
    this.shadowRoot = null;
    this.position = { x: null, y: null }; // For draggable minimized button

    this.create();
    this.setupHotkeys();

    // Check if we have saved state from navigation first
    const hasSavedState = this.setupNavigationPersistence();

    // Only apply initial state if we didn't restore from sessionStorage
    if (initialState && !hasSavedState) {
      this.restoreState(initialState);
    }
  }

  /**
   * Create the overlay with Shadow DOM
   */
  create() {
    // Create container
    this.container = document.createElement('div');
    this.container.id = 'mcp-recording-overlay-container';
    this.container.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';

    // Attach shadow DOM (closed mode for isolation)
    this.shadowRoot = this.container.attachShadow({ mode: 'closed' });

    // Inject styles and content
    this.shadowRoot.innerHTML = this.getHTML();

    // Append to body
    document.body.appendChild(this.container);

    // Setup event listeners
    this.setupEventListeners();

    // Animate in
    setTimeout(() => {
      const overlay = this.shadowRoot.querySelector('.overlay');
      if (overlay) overlay.classList.add('visible');
    }, 10);
  }

  /**
   * Get HTML and CSS for the overlay
   */
  getHTML() {
    return `
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        .overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
          color: white;
          padding: 18px 28px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 15px;
          backdrop-filter: blur(10px);
          transform: translateY(-100%);
          transition: transform 0.3s ease-out;
          z-index: 2147483647;
          pointer-events: auto;
          border-bottom: 3px solid #60a5fa;
        }

        .overlay.visible {
          transform: translateY(0);
        }

        .overlay-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .overlay-title {
          display: flex;
          align-items: center;
          gap: 10px;
          font-weight: 600;
          font-size: 16px;
          color: #ffffff;
        }

        .overlay-title .icon {
          font-size: 18px;
          animation: none;
        }

        .overlay-title.recording .icon {
          animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.1); }
        }

        .overlay-controls {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .btn-icon {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: white;
          cursor: pointer;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 18px;
          opacity: 0.9;
          transition: all 0.2s;
        }

        .btn-icon:hover {
          opacity: 1;
          background: rgba(255, 255, 255, 0.25);
          transform: scale(1.05);
        }

        .overlay-content {
          margin-bottom: 12px;
        }

        .request-text {
          color: #f1f5f9;
          font-size: 14px;
          line-height: 1.5;
          max-width: 100%;
          margin-bottom: 4px;
          font-weight: 400;
        }

        .stats {
          display: flex;
          gap: 16px;
          align-items: center;
          font-size: 13px;
          color: #e0e7ff;
          margin-top: 8px;
        }

        .stat-item {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .overlay-actions {
          display: flex;
          gap: 12px;
          align-items: center;
        }

        .btn-primary {
          background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
          border: 2px solid rgba(255, 255, 255, 0.3);
          color: white;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(96, 165, 250, 0.5);
        }

        .btn-primary.recording {
          background: linear-gradient(135deg, #34d399 0%, #10b981 100%);
          border-color: rgba(255, 255, 255, 0.4);
        }

        .btn-primary.recording:hover {
          box-shadow: 0 6px 16px rgba(52, 211, 153, 0.5);
        }

        .hotkey-hint {
          font-size: 12px;
          color: #cbd5e1;
          margin-left: 4px;
          opacity: 0.9;
        }

        /* Minimized floating button */
        .floating-btn {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
          border: 2px solid rgba(255, 255, 255, 0.3);
          color: white;
          padding: 14px 28px;
          border-radius: 30px;
          font-size: 15px;
          font-weight: 600;
          cursor: move;
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 10px;
          z-index: 2147483647;
          pointer-events: auto;
        }

        .floating-btn:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 24px rgba(37, 99, 235, 0.5);
        }

        .floating-btn.recording {
          background: linear-gradient(135deg, #34d399 0%, #10b981 100%);
          animation: pulse 1.5s ease-in-out infinite;
          border-color: rgba(255, 255, 255, 0.4);
        }

        .floating-btn .badge {
          background: rgba(255, 255, 255, 0.3);
          padding: 2px 6px;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 600;
        }

        /* Tooltip */
        .floating-btn .tooltip {
          position: absolute;
          bottom: calc(100% + 12px);
          right: 0;
          background: rgba(30, 41, 59, 0.98);
          color: #f1f5f9;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 13px;
          line-height: 1.5;
          max-width: 400px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s;
          white-space: normal;
          word-wrap: break-word;
          border: 1px solid rgba(96, 165, 250, 0.3);
        }

        .floating-btn:hover .tooltip {
          opacity: 1;
        }

        .floating-btn .tooltip::after {
          content: '';
          position: absolute;
          top: 100%;
          right: 20px;
          border: 6px solid transparent;
          border-top-color: rgba(30, 41, 59, 0.98);
        }

        .hidden {
          display: none !important;
        }
      </style>

      <div class="overlay" data-state="expanded-waiting">
        <div class="overlay-header">
          <div class="overlay-title">
            <span class="icon">🎬</span>
            <span class="title-text">Recording Request</span>
          </div>
          <div class="overlay-controls">
            <button class="btn-icon btn-minimize" title="Minimize (Alt+Shift+M)">─</button>
            <button class="btn-icon btn-cancel" title="Cancel (Escape)">×</button>
          </div>
        </div>
        <div class="overlay-content">
          <div class="request-text">${this.escapeHTML(this.request)}</div>
          <div class="stats hidden">
            <div class="stat-item">
              <span>⏱️</span>
              <span class="timer">00:00</span>
            </div>
            <div class="stat-item">
              <span>📊</span>
              <span class="action-count">0 actions</span>
            </div>
          </div>
        </div>
        <div class="overlay-actions">
          <button class="btn-primary btn-start">
            <span class="icon">▶️</span>
            <span>Start Recording</span>
            <span class="hotkey-hint">(Alt+Shift+S)</span>
          </button>
        </div>
      </div>

      <button class="floating-btn hidden" data-state="minimized-waiting">
        <span class="icon">🎬</span>
        <span class="text">Start</span>
        <div class="tooltip">${this.escapeHTML(this.request)}</div>
      </button>
    `;
  }

  /**
   * Escape HTML to prevent injection
   */
  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    const overlay = this.shadowRoot.querySelector('.overlay');
    const floatingBtn = this.shadowRoot.querySelector('.floating-btn');

    // Start button
    const btnStart = this.shadowRoot.querySelector('.btn-start');
    if (btnStart) {
      btnStart.addEventListener('click', () => this.startRecording());
    }

    // Minimize button
    const btnMinimize = this.shadowRoot.querySelector('.btn-minimize');
    if (btnMinimize) {
      btnMinimize.addEventListener('click', () => this.toggleMinimize());
    }

    // Cancel button
    const btnCancel = this.shadowRoot.querySelector('.btn-cancel');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => this.cancel());
    }

    // Floating button click
    if (floatingBtn) {
      floatingBtn.addEventListener('click', () => {
        if (this.state.includes('waiting')) {
          this.startRecording();
        } else if (this.state.includes('recording')) {
          this.completeRecording();
        }
      });

      // Make floating button draggable
      this.makeDraggable(floatingBtn);
    }

    // Stop propagation to prevent interference with page
    [overlay, floatingBtn].forEach(el => {
      if (el) {
        el.addEventListener('mousedown', (e) => e.stopPropagation());
        el.addEventListener('mouseup', (e) => e.stopPropagation());
        el.addEventListener('click', (e) => e.stopPropagation());
      }
    });
  }

  /**
   * Make element draggable
   */
  makeDraggable(element) {
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;

    element.addEventListener('mousedown', (e) => {
      if (e.target === element || element.contains(e.target)) {
        isDragging = true;
        initialX = e.clientX - (this.position.x || 0);
        initialY = e.clientY - (this.position.y || 0);
        element.style.cursor = 'grabbing';
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;

        this.position.x = currentX;
        this.position.y = currentY;

        element.style.right = 'auto';
        element.style.bottom = 'auto';
        element.style.left = currentX + 'px';
        element.style.top = currentY + 'px';
      }
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        element.style.cursor = 'move';
      }
    });
  }

  /**
   * Setup hotkeys
   */
  setupHotkeys() {
    this.hotkeyHandler = (e) => {
      // Alt+Shift+S - Start recording
      if (e.altKey && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        if (this.state.includes('waiting')) {
          this.startRecording();
        }
      }
      // Alt+Shift+D - Complete recording
      else if (e.altKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        if (this.state.includes('recording')) {
          this.completeRecording();
        }
      }
      // Alt+Shift+M - Toggle minimize
      else if (e.altKey && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        this.toggleMinimize();
      }
      // Escape - Cancel
      else if (e.key === 'Escape' && this.state.includes('waiting')) {
        e.preventDefault();
        this.cancel();
      }
    };

    document.addEventListener('keydown', this.hotkeyHandler);
  }

  /**
   * Setup persistence across navigation
   * @returns {boolean} True if state was restored from sessionStorage
   */
  setupNavigationPersistence() {
    // Watch for page unload
    this.navigationHandler = () => {
      // Save state to sessionStorage (preserve minimized state)
      console.log('[Overlay] Saving state before navigation:', this.state);
      sessionStorage.setItem('mcp-recording-state', JSON.stringify({
        sessionId: this.sessionId,
        request: this.request,
        state: this.state,  // This includes minimized state
        actionCount: this.actionCount,
        startTime: this.startTime,
        position: this.position
      }));
    };

    window.addEventListener('beforeunload', this.navigationHandler);

    // Check if we're restoring from navigation
    const savedState = sessionStorage.getItem('mcp-recording-state');
    if (savedState) {
      try {
        const data = JSON.parse(savedState);
        console.log('[Overlay] Found saved state:', data);
        if (data.sessionId === this.sessionId) {
          console.log('[Overlay] Restoring state from sessionStorage');
          this.state = data.state;
          this.actionCount = data.actionCount;
          this.startTime = data.startTime;
          this.position = data.position;

          // Restore UI state
          this.updateUI();

          // Restart timer if recording
          if (this.state.includes('recording')) {
            this.startTimer();
          }

          sessionStorage.removeItem('mcp-recording-state');
          return true;  // State was restored
        }
      } catch (e) {
        console.error('[Overlay] Failed to restore state:', e);
      }
    }
    return false;  // No state was restored
  }

  /**
   * Start recording
   */
  startRecording() {
    console.log('[Overlay] Starting recording');
    // Always minimize when starting recording
    this.state = 'minimized-recording';
    this.startTime = Date.now();
    this.actionCount = 0;

    // Update UI
    this.updateUI();

    // Start timer
    this.startTimer();

    // Notify background
    chrome.runtime.sendMessage({
      type: 'START_RECORDING_NOW',
      sessionId: this.sessionId
    });
  }

  /**
   * Complete recording
   */
  completeRecording() {
    console.log('[Overlay] Completing recording');

    // Stop timer
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    // Notify background
    chrome.runtime.sendMessage({
      type: 'RECORDING_COMPLETE',
      sessionId: this.sessionId
    });

    // Destroy overlay
    this.destroy();
  }

  /**
   * Cancel recording
   */
  cancel() {
    console.log('[Overlay] Cancelling recording');

    // Notify background
    chrome.runtime.sendMessage({
      type: 'RECORDING_CANCELLED',
      sessionId: this.sessionId
    });

    // Destroy overlay
    this.destroy();
  }

  /**
   * Toggle minimize/expand
   */
  toggleMinimize() {
    if (this.state.includes('minimized')) {
      // Expand
      this.state = this.state.replace('minimized-', '');
    } else {
      // Minimize
      this.state = this.state.includes('recording') ? 'minimized-recording' : 'minimized-waiting';
    }

    this.updateUI();
  }

  /**
   * Update UI based on state
   */
  updateUI() {
    console.log('[Overlay] updateUI called, state:', this.state);
    const overlay = this.shadowRoot.querySelector('.overlay');
    const floatingBtn = this.shadowRoot.querySelector('.floating-btn');
    const stats = this.shadowRoot.querySelector('.stats');
    const btnStart = this.shadowRoot.querySelector('.btn-start');
    const overlayTitle = this.shadowRoot.querySelector('.overlay-title');

    console.log('[Overlay] Elements found:', {
      overlay: !!overlay,
      floatingBtn: !!floatingBtn,
      floatingBtnClasses: floatingBtn?.className
    });

    // Show/hide based on state
    if (this.state.includes('minimized')) {
      overlay?.classList.add('hidden');
      floatingBtn?.classList.remove('hidden');
      console.log('[Overlay] Should show floating button');
    } else {
      overlay?.classList.remove('hidden');
      floatingBtn?.classList.add('hidden');
      console.log('[Overlay] Should show overlay');
    }

    // Update recording state
    if (this.state.includes('recording')) {
      // Update overlay
      if (overlayTitle) {
        overlayTitle.classList.add('recording');
        overlayTitle.querySelector('.icon').textContent = '🔴';
        overlayTitle.querySelector('.title-text').textContent = 'Recording in Progress';
      }

      stats?.classList.remove('hidden');

      if (btnStart) {
        btnStart.classList.add('recording');
        btnStart.querySelector('.icon').textContent = '⏹️';
        btnStart.querySelector('span:not(.icon):not(.hotkey-hint)').textContent = 'Complete Recording';
        btnStart.querySelector('.hotkey-hint').textContent = '(Alt+Shift+D)';
        btnStart.onclick = () => this.completeRecording();
      }

      // Update floating button
      if (floatingBtn) {
        floatingBtn.classList.add('recording');
        floatingBtn.querySelector('.icon').textContent = '🔴';
        floatingBtn.querySelector('.text').textContent = 'Complete';

        // Add badge if not exists
        if (!floatingBtn.querySelector('.badge')) {
          const badge = document.createElement('span');
          badge.className = 'badge';
          floatingBtn.appendChild(badge);
        }
      }
    }

    // Update action count
    this.updateActionCount();
  }

  /**
   * Start timer
   */
  startTimer() {
    this.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const seconds = (elapsed % 60).toString().padStart(2, '0');

      const timerEl = this.shadowRoot.querySelector('.timer');
      if (timerEl) {
        timerEl.textContent = `${minutes}:${seconds}`;
      }
    }, 1000);
  }

  /**
   * Update action count
   */
  updateActionCount() {
    const countEl = this.shadowRoot.querySelector('.action-count');
    if (countEl) {
      countEl.textContent = `${this.actionCount} action${this.actionCount !== 1 ? 's' : ''}`;
    }

    const badge = this.shadowRoot.querySelector('.floating-btn .badge');
    if (badge) {
      badge.textContent = this.actionCount;
    }
  }

  /**
   * Increment action count
   */
  incrementActionCount() {
    this.actionCount++;
    this.updateActionCount();
  }

  /**
   * Restore state from previous navigation
   */
  restoreState(state) {
    console.log('[Overlay] Restoring state:', state);
    this.state = state.state || this.state;
    this.actionCount = state.actionCount || 0;
    this.startTime = state.startTime || null;
    this.position = state.position || { x: null, y: null };

    // Update UI to reflect restored state
    this.updateUI();

    // Restart timer if recording
    if (this.state.includes('recording') && this.startTime) {
      this.startTimer();
    }
  }

  /**
   * Destroy overlay
   */
  destroy() {
    // Clear timer
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }

    // Remove event listeners
    document.removeEventListener('keydown', this.hotkeyHandler);
    window.removeEventListener('beforeunload', this.navigationHandler);

    // Remove from DOM
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    // Clear session storage
    sessionStorage.removeItem('mcp-recording-state');
  }
}

// Export for use in content script
window.RecordingOverlay = RecordingOverlay;
