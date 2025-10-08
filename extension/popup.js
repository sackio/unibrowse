/**
 * Browser MCP - Popup UI Controller
 */

class PopupController {
  constructor() {
    this.elements = {
      status: document.getElementById('status'),
      statusText: document.getElementById('status-text'),
      connectBtn: document.getElementById('connect-btn'),
      disconnectBtn: document.getElementById('disconnect-btn'),
      wsState: document.getElementById('ws-state'),
      debuggerState: document.getElementById('debugger-state'),
      tabInfo: document.getElementById('tab-info'),
      tabTitle: document.getElementById('tab-title'),
      tabUrl: document.getElementById('tab-url'),
      error: document.getElementById('error'),
      recordingSection: document.getElementById('recording-section'),
      recordingWaiting: document.getElementById('recording-waiting'),
      recordingActive: document.getElementById('recording-active'),
      recordingRequestWaiting: document.getElementById('recording-request-waiting'),
      recordingRequestActive: document.getElementById('recording-request-active'),
      recordingActions: document.getElementById('recording-actions'),
      recordingTime: document.getElementById('recording-time'),
      recordingStartBtn: document.getElementById('recording-start-btn'),
      recordingCancelBtn: document.getElementById('recording-cancel-btn'),
      recordingDoneBtn: document.getElementById('recording-done-btn')
    };

    this.recordingStartTime = null;
    this.recordingTimerInterval = null;
    this.recordingState = 'none';  // 'none', 'waiting', 'active'

    this.setupEventListeners();
    this.loadState();

    // Listen for state updates from background
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'state_change') {
        this.updateUI(message.state);
      } else if (message.type === 'recording_started') {
        this.showRecording(message.sessionId, message.request);
      } else if (message.type === 'recording_action') {
        this.updateRecordingStats(message.actionCount);
      } else if (message.type === 'recording_stopped') {
        this.hideRecording();
      }
    });

    // Poll for state updates
    setInterval(() => this.loadState(), 1000);
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    this.elements.connectBtn.addEventListener('click', () => {
      this.connect();
    });

    this.elements.disconnectBtn.addEventListener('click', () => {
      this.disconnect();
    });

    this.elements.recordingStartBtn.addEventListener('click', () => {
      this.startRecording();
    });

    this.elements.recordingCancelBtn.addEventListener('click', () => {
      this.cancelRecording();
    });

    this.elements.recordingDoneBtn.addEventListener('click', () => {
      this.stopRecording();
    });
  }

  /**
   * Load state from background worker
   */
  async loadState() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'get_state' });
      if (response.success) {
        this.updateUI(response.data);
      }
    } catch (error) {
      console.error('Failed to load state:', error);
    }
  }

  /**
   * Connect to MCP server
   */
  async connect() {
    this.hideError();
    this.setButtonsEnabled(false);

    try {
      const response = await chrome.runtime.sendMessage({ type: 'connect' });

      if (response.success) {
        console.log('Connected:', response.data);
      } else {
        this.showError(response.error || 'Failed to connect');
        this.setButtonsEnabled(true);
      }
    } catch (error) {
      console.error('Connection error:', error);
      this.showError(error.message);
      this.setButtonsEnabled(true);
    }
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect() {
    this.hideError();
    this.setButtonsEnabled(false);

    try {
      const response = await chrome.runtime.sendMessage({ type: 'disconnect' });

      if (response.success) {
        console.log('Disconnected');
      } else {
        this.showError(response.error || 'Failed to disconnect');
      }
    } catch (error) {
      console.error('Disconnect error:', error);
      this.showError(error.message);
    } finally {
      this.setButtonsEnabled(true);
    }
  }

  /**
   * Update UI based on state
   */
  updateUI(state) {
    // Update status indicator
    if (state.connected) {
      this.setStatus('connected', 'Connected');
    } else if (state.wsState === 'connecting') {
      this.setStatus('connecting', 'Connecting...');
    } else {
      this.setStatus('disconnected', 'Disconnected');
    }

    // Update WebSocket state
    this.elements.wsState.textContent = this.formatState(state.wsState);

    // Update debugger state
    this.elements.debuggerState.textContent = state.debuggerAttached
      ? `Attached to tab ${state.tabId}`
      : 'Not attached';

    // Update tab info
    if (state.tabId && state.tabUrl) {
      this.elements.tabTitle.textContent = state.tabTitle || 'Untitled';
      this.elements.tabUrl.textContent = state.tabUrl;
      this.elements.tabInfo.classList.add('visible');
    } else {
      this.elements.tabInfo.classList.remove('visible');
    }

    // Update buttons
    this.elements.connectBtn.disabled = state.connected;
    this.elements.disconnectBtn.disabled = !state.connected;
  }

  /**
   * Set status display
   */
  setStatus(state, text) {
    this.elements.status.className = `status ${state}`;
    this.elements.statusText.textContent = text;
  }

  /**
   * Format state text
   */
  formatState(state) {
    const stateMap = {
      'connected': 'Connected',
      'connecting': 'Connecting...',
      'disconnected': 'Disconnected',
      'disconnecting': 'Disconnecting...',
      'error': 'Error'
    };

    return stateMap[state] || state;
  }

  /**
   * Enable/disable buttons
   */
  setButtonsEnabled(enabled) {
    if (enabled) {
      // Enable appropriate button based on state
      this.loadState();
    } else {
      // Disable all buttons
      this.elements.connectBtn.disabled = true;
      this.elements.disconnectBtn.disabled = true;
    }
  }

  /**
   * Show error message
   */
  showError(message) {
    this.elements.error.textContent = message;
    this.elements.error.classList.add('visible');
  }

  /**
   * Hide error message
   */
  hideError() {
    this.elements.error.classList.remove('visible');
  }

  /**
   * Show recording request (waiting state)
   */
  showRecording(sessionId, request) {
    this.currentSessionId = sessionId;
    this.currentRequest = request;
    this.recordingState = 'waiting';

    // Show waiting state
    this.elements.recordingRequestWaiting.textContent = request;
    this.elements.recordingWaiting.style.display = 'block';
    this.elements.recordingActive.style.display = 'none';
    this.elements.recordingSection.classList.add('visible', 'waiting');
  }

  /**
   * Start recording after user clicks Start button
   */
  async startRecording() {
    if (this.recordingState !== 'waiting') return;

    this.recordingState = 'active';
    this.recordingStartTime = Date.now();

    // Switch to active state
    this.elements.recordingWaiting.style.display = 'none';
    this.elements.recordingActive.style.display = 'block';
    this.elements.recordingSection.classList.remove('waiting');

    this.elements.recordingRequestActive.textContent = this.currentRequest;
    this.elements.recordingActions.textContent = '0';
    this.elements.recordingTime.textContent = '0';

    // Start timer
    if (this.recordingTimerInterval) {
      clearInterval(this.recordingTimerInterval);
    }
    this.recordingTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
      this.elements.recordingTime.textContent = elapsed;
    }, 1000);

    // Tell background to start recording
    await chrome.runtime.sendMessage({
      type: 'START_RECORDING_NOW',
      sessionId: this.currentSessionId
    });
  }

  /**
   * Cancel recording request
   */
  async cancelRecording() {
    await chrome.runtime.sendMessage({
      type: 'RECORDING_CANCELLED',
      sessionId: this.currentSessionId
    });
    this.hideRecording();
  }

  /**
   * Update recording stats
   */
  updateRecordingStats(actionCount) {
    if (this.recordingState === 'active') {
      this.elements.recordingActions.textContent = actionCount;
    }
  }

  /**
   * Hide recording UI
   */
  hideRecording() {
    this.elements.recordingSection.classList.remove('visible', 'waiting');
    this.elements.recordingWaiting.style.display = 'none';
    this.elements.recordingActive.style.display = 'none';
    if (this.recordingTimerInterval) {
      clearInterval(this.recordingTimerInterval);
      this.recordingTimerInterval = null;
    }
    this.recordingState = 'none';
    this.currentSessionId = null;
    this.currentRequest = null;
  }

  /**
   * Stop recording
   */
  async stopRecording() {
    if (this.currentSessionId) {
      await chrome.runtime.sendMessage({
        type: 'RECORDING_COMPLETE',
        sessionId: this.currentSessionId
      });
    }
  }
}

// Initialize popup controller
const popup = new PopupController();

console.log('Browser MCP popup loaded');
