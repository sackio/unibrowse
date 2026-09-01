/**
 * Browser MCP - Popup UI Controller
 */

class PopupController {
  constructor() {
    this.elements = {
      status: document.getElementById('status'),
      statusText: document.getElementById('status-text'),
      wsState: document.getElementById('ws-state'),
      debuggerState: document.getElementById('debugger-state'),
      attachedTabsSection: document.getElementById('attached-tabs-section'),
      attachedTabsList: document.getElementById('attached-tabs-list'),
      refreshAttachedTabsBtn: document.getElementById('refresh-attached-tabs-btn'),
      tabsSection: document.getElementById('tabs-section'),
      tabsList: document.getElementById('tabs-list'),
      refreshTabsBtn: document.getElementById('refresh-tabs-btn'),
      error: document.getElementById('error'),
      sessionRecordSection: document.getElementById('session-record-section'),
      sessionRecordBtn: document.getElementById('session-record-btn'),
      sessionRecordStats: document.getElementById('session-record-stats'),
      sessionRecordList: document.getElementById('session-record-list'),
      sendAgentSection: document.getElementById('send-agent-section'),
      sendAgentTarget: document.getElementById('send-agent-target'),
      sendAgentFormat: document.getElementById('send-agent-format'),
      sendPageBtn: document.getElementById('send-page-btn'),
      sendSelectionBtn: document.getElementById('send-selection-btn'),
      sendAgentStatus: document.getElementById('send-agent-status'),
      shareRecordingSelect: document.getElementById('share-recording-select'),
      shareRecordingBtn: document.getElementById('share-recording-btn'),
      attachCurrentTabBtn: document.getElementById('attach-current-tab-btn'),
    };

    this.currentState = null;
    this.attachedTabs = [];
    this.windows = [];
    this.tabs = [];

    this.setupEventListeners();
    this.loadState();

    // Listen for state updates from background
    chrome.runtime.onMessage.addListener((message) => {
      console.log('[Popup] Received message:', message);
      if (message.type === 'state_change') {
        this.updateUI(message.state);
      }
    });

    // Poll for state updates
    setInterval(() => this.loadState(), 1000);
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    this.elements.refreshTabsBtn.addEventListener('click', () => {
      this.loadTabsAndWindows();
    });

    this.elements.refreshAttachedTabsBtn.addEventListener('click', () => {
      this.loadAttachedTabs();
    });

    this.elements.sendPageBtn.addEventListener('click', () => this.sendToAgent('page'));
    this.elements.sendSelectionBtn.addEventListener('click', () => this.sendToAgent('selection'));
    this.elements.shareRecordingBtn.addEventListener('click', () => this.shareRecording());
    this.loadDestinations();
    this.loadSavedRecordings();

    this.elements.sessionRecordBtn.addEventListener('click', () => {
      this.handleSessionRecordClick();
    });

    this.elements.attachCurrentTabBtn.addEventListener('click', () => {
      this.handleAttachCurrentTabClick();
    });
  }

  /**
   * "Attach this tab" — one-click attach the currently focused tab.
   * Skips the find-it-in-the-list grind. Catches un-attachable-tab errors
   * (chrome-extension:// owned by other extensions, chrome://, etc.) and
   * shows a useful hint instead of the raw chrome.debugger error.
   */
  async handleAttachCurrentTabClick() {
    const btn = this.elements.attachCurrentTabBtn;
    try {
      btn.disabled = true;
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab) {
        this.showError('No active tab found.');
        btn.disabled = false;
        return;
      }
      if (this._isUnattachableUrl(tab.url)) {
        this.showError(this._unattachableHint(tab.url));
        btn.disabled = false;
        return;
      }
      await this.attachToTab(tab.id);
    } catch (error) {
      console.error('Attach current tab failed:', error);
      this.showError(this._friendlyAttachError(error));
    } finally {
      btn.disabled = false;
    }
  }

  /**
   * Tabs at these URL schemes can't be debugged by any extension — chrome blocks
   * chrome.debugger.attach on them. chrome-extension:// is allowed only when
   * the URL is in OUR extension's own namespace; any other extension's pages
   * (New Tab overrides like Momentum/Notion, PDF viewer, other extensions'
   * options pages) are blocked with "Cannot access a chrome-extension:// URL
   * of different extension".
   */
  _isUnattachableUrl(url) {
    if (!url) return true;
    // ⚠️ This list used to be Chrome-only, and was the ONE guard in the
    // extension that never learned about `edge://` — every attach-path guard
    // in background.js and utils/cdp.js already handled it. The consequence
    // was confined to this popup: it would offer an Edge internal page as
    // attachable, and the attach then failed with the background's (correct)
    // error. Misleading UI rather than a broken tab, which is why it survived.
    if (BrowserEnv.isInternalUrl(url) || url.startsWith('about:')) return true;
    if (url.startsWith('chrome-extension://')) {
      // Allow our own extension pages (popup, options, review.html) — but those
      // shouldn't be in the attach list anyway since the popup itself isn't a tab.
      const ourPrefix = `chrome-extension://${chrome.runtime.id}/`;
      return !url.startsWith(ourPrefix);
    }
    return false;
  }

  _unattachableHint(url) {
    if (!url) return 'This tab has no URL — navigate it to a real page first.';
    if (url.startsWith('chrome-extension://')) {
      return `This tab is owned by another extension (likely a New Tab override or PDF viewer). ${BrowserEnv.name} blocks debugging other extensions’ pages — navigate this tab to a regular URL (e.g. https://example.com) first.`;
    }
    // Checked before the generic internal-page branch below, because
    // devtools:/view-source: are in the internal-prefix list too and deserve
    // the more specific wording.
    if (url.startsWith('devtools://') || url.startsWith('view-source:') || url.startsWith('about:')) {
      return 'This kind of page can’t be attached. Navigate to a regular URL first.';
    }
    if (BrowserEnv.isInternalUrl(url)) {
      return `${BrowserEnv.name}’s built-in pages (${BrowserEnv.internalScheme}…) can’t be debugged by extensions. Navigate to a regular URL first.`;
    }
    return 'This tab can’t be attached.';
  }

  _friendlyAttachError(error) {
    const msg = error?.message || String(error || 'Failed to attach to tab');
    if (/Cannot access a chrome-extension:\/\/ URL of different extension/i.test(msg)) {
      return `This tab is owned by another extension (likely a New Tab override or PDF viewer). ${BrowserEnv.name} blocks debugging other extensions’ pages — navigate this tab to a regular URL (e.g. https://example.com) first.`;
    }
    // ⚠️ Matches the browser's OWN error text, which we do not control. Chromium
    // says "Cannot access a chrome:// URL"; whether a fork rewrites that to its
    // own scheme is not something I could verify without the browser in hand, so
    // this accepts either rather than assuming. A miss here only costs the
    // friendly rewrite — the raw message still reaches the user.
    if (/cannot access (?:a )?(?:chrome|edge|brave|opera|vivaldi)[:\/]/i.test(msg)) {
      return `${BrowserEnv.name}’s built-in pages can’t be debugged by extensions. Navigate to a regular URL first.`;
    }
    if (/No tab with given id/i.test(msg)) {
      return 'That tab is no longer open. Refresh the tab list.';
    }
    return msg;
  }

  /**
   * Handle Session Record button click — starts/stops rich session recording
   * (rrweb DOM + network interceptor + video, survives cross-domain navigation)
   */
  async handleSessionRecordClick() {
    // ⛔ START ONLY. Recordings are per-tab and several can run at once, so a
    // single toggle has no defensible meaning — "stop" would have to pick one
    // of N. Each live recording carries its own Stop button in the list below.
    const btn = this.elements.sessionRecordBtn;
    try {
      btn.disabled = true;
      btn.textContent = '⏳ Starting...';
      const response = await chrome.runtime.sendMessage({ type: 'start_session_recording' });
      if (!response || !response.success) {
        this.showError(response?.error || 'Failed to start session recording');
      }
    } catch (error) {
      console.error('Session record click failed:', error);
      this.showError(error.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '⏺ Record This Tab';
      this.loadState();
    }
  }

  /**
   * Fill the agent picker from the server's /destinations.
   * ⛔ Never a hand-typed list: the option's value IS the ATC address, and an
   * address that is not a real subscriber is accepted by the broker and never
   * delivered, with no error anywhere (`ha`, scanfile, 2026-08-31).
   */
  async loadDestinations() {
    const sel = this.elements.sendAgentTarget;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'get_destinations' });
      if (!resp || !resp.success) throw new Error(resp?.error || 'could not load');
      sel.textContent = '';
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = `Send to… (${resp.destinations.length})`;
      sel.appendChild(blank);
      for (const d of resp.destinations) {
        const o = document.createElement('option');
        o.value = d.id;
        o.textContent = d.hostname ? `${d.id} · ${d.hostname}` : d.id;
        sel.appendChild(o);
      }
      const last = (await chrome.storage.local.get('lastSendTarget')).lastSendTarget;
      if (last && resp.destinations.some(d => d.id === last)) sel.value = last;
    } catch (e) {
      sel.textContent = '';
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'Agent list unavailable';
      sel.appendChild(o);
      this._sendStatus(false, `Could not load the agent list: ${e.message}`);
    }
  }

  _sendStatus(ok, text) {
    const el = this.elements.sendAgentStatus;
    el.textContent = text;
    el.classList.remove('ok', 'bad');
    el.classList.add('visible', ok ? 'ok' : 'bad');
  }

  /** Send the page or the selection. Reports DELIVERY, not "we posted it". */
  async sendToAgent(scope) {
    const to = this.elements.sendAgentTarget.value;
    if (!to) { this._sendStatus(false, 'Pick an agent first.'); return; }
    const format = this.elements.sendAgentFormat.value;
    const buttons = [this.elements.sendPageBtn, this.elements.sendSelectionBtn];
    buttons.forEach(b => { b.disabled = true; });
    this._sendStatus(true, `Sending ${scope} to ${to}…`);
    try {
      chrome.storage.local.set({ lastSendTarget: to }).catch(() => {});
      const r = await chrome.runtime.sendMessage({
        type: 'send_to_agent',
        payload: { to, scope, format },
      });
      if (r && r.success) {
        const kb = Math.max(1, Math.round((r.bytes || 0) / 1024));
        this._sendStatus(true, `Delivered to ${to} (${kb} KB of ${r.format}).`);
      } else {
        this._sendStatus(false, r?.detail || r?.error || 'Send failed.');
      }
    } catch (e) {
      this._sendStatus(false, e.message);
    } finally {
      buttons.forEach(b => { b.disabled = false; });
    }
  }

  /**
   * Fill the recording picker from the SERVER's saved list.
   *
   * ⚠️ Saved, never the live rows above. A recording still running has no id
   * on the server yet, so offering it would hand a recipient an address that
   * resolves to nothing until someone presses Stop.
   */
  async loadSavedRecordings() {
    const sel = this.elements.shareRecordingSelect;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'list_saved_recordings' });
      if (!resp || !resp.success) throw new Error(resp?.error || 'could not load');
      sel.textContent = '';
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = resp.recordings.length
        ? `Share a recording… (${resp.recordings.length})`
        : 'No saved recordings';
      sel.appendChild(blank);
      for (const r of resp.recordings) {
        const o = document.createElement('option');
        o.value = r.id;
        const secs = Math.round((r.duration || 0) / 1000);
        const len = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m`;
        o.textContent = `${r.title || r.id} · ${len}`;
        o.title = r.startUrl || '';
        sel.appendChild(o);
      }
    } catch (e) {
      sel.textContent = '';
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'Recording list unavailable';
      sel.appendChild(o);
    }
  }

  /**
   * Share a LIVE attached tab. Reports what the recipient was actually told to
   * address it by, because the background auto-labels an unlabelled tab and
   * the user would otherwise not know the tab now has a name.
   */
  async shareTab(tabId, btn) {
    const to = this.elements.sendAgentTarget.value;
    if (!to) { this._sendStatus(false, 'Pick an agent first (the dropdown above).'); return; }
    if (btn) btn.disabled = true;
    this._sendStatus(true, `Sharing tab with ${to}…`);
    try {
      chrome.storage.local.set({ lastSendTarget: to }).catch(() => {});
      const r = await chrome.runtime.sendMessage({ type: 'share_tab', payload: { to, tabId } });
      if (r && r.success) {
        this._sendStatus(
          true,
          `Shared with ${to} as "${r.label}"` +
          (r.labelWasGenerated ? ' (label generated — it had none).' : '.'),
        );
        await this.loadAttachedTabs();
      } else {
        this._sendStatus(false, r?.detail || r?.error || 'Share failed.');
      }
    } catch (e) {
      this._sendStatus(false, e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /** Share a saved recording — the id and the review link, not the events. */
  async shareRecording() {
    const to = this.elements.sendAgentTarget.value;
    if (!to) { this._sendStatus(false, 'Pick an agent first.'); return; }
    const recordingId = this.elements.shareRecordingSelect.value;
    if (!recordingId) { this._sendStatus(false, 'Pick a recording first.'); return; }
    const btn = this.elements.shareRecordingBtn;
    btn.disabled = true;
    this._sendStatus(true, `Sharing recording with ${to}…`);
    try {
      chrome.storage.local.set({ lastSendTarget: to }).catch(() => {});
      const r = await chrome.runtime.sendMessage({
        type: 'share_recording',
        payload: { to, recordingId },
      });
      if (r && r.success) {
        this._sendStatus(true, `Recording shared with ${to}.`);
      } else {
        this._sendStatus(false, r?.detail || r?.error || 'Share failed.');
      }
    } catch (e) {
      this._sendStatus(false, e.message);
    } finally {
      btn.disabled = false;
    }
  }

  /** Stop ONE named recording. Never an unqualified stop — see the click handler. */
  async stopRecording(sessionId) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'stop_session_recording', sessionId });
      if (response && response.error) this.showError(response.error);
      // The recording exists on the server only once stop() has finished
      // uploading, which is exactly now — so refresh the share picker here and
      // preselect what was just made. "Share the recording I just took" is the
      // common case and should not require finding it in a list.
      if (response && response.recordingId) {
        await this.loadSavedRecordings();
        const sel = this.elements.shareRecordingSelect;
        if ([...sel.options].some(o => o.value === response.recordingId)) {
          sel.value = response.recordingId;
        }
      }
    } catch (error) {
      this.showError(error.message);
    } finally {
      this.loadState();
    }
  }

  /**
   * Render one row per live recording.
   * ⚠️ Rows are rebuilt from state each poll rather than mutated, so a
   * recording that ended elsewhere (agent tool, tab closed) cannot leave a
   * stale row with a Stop button that silently targets nothing.
   */
  _renderRecordingList(recordings) {
    const list = this.elements.sessionRecordList;
    if (!list) return;
    list.textContent = '';
    for (const r of recordings) {
      const elapsed = Math.floor((Date.now() - (r.startTime || Date.now())) / 1000);
      const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const s = (elapsed % 60).toString().padStart(2, '0');

      const row = document.createElement('div');
      row.className = 'sr-row';

      const main = document.createElement('span');
      main.className = 'sr-row-main';
      main.textContent = `tab ${r.tabId}`;
      main.title = r.startUrl || '';
      if (r.autoStarted) {
        const auto = document.createElement('span');
        auto.className = 'sr-row-auto';
        auto.textContent = ' (auto)';
        main.appendChild(auto);
      }

      const el = document.createElement('span');
      el.className = 'sr-row-elapsed';
      el.textContent = `${m}:${s}`;

      const stop = document.createElement('button');
      stop.className = 'sr-stop';
      stop.textContent = 'Stop';
      stop.addEventListener('click', () => this.stopRecording(r.sessionId));

      row.appendChild(main);
      row.appendChild(el);
      row.appendChild(stop);
      list.appendChild(row);
    }
  }

  /**
   * Load state from background worker
   */
  async loadState() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'get_state' });
      if (response.success) {
        this.currentState = response.data;
        this.updateUI(response.data);

        // Load tabs/windows if connected
        if (response.data.connected) {
          await this.loadTabsAndWindows();
          await this.loadAttachedTabs();
        }
      }
    } catch (error) {
      console.error('Failed to load state:', error);
    }
  }

  /**
   * Load all tabs and windows
   */
  async loadTabsAndWindows() {
    try {
      // Get all windows with their tabs
      this.windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });

      // Flatten tabs list for easier access
      this.tabs = [];
      this.windows.forEach(window => {
        window.tabs.forEach(tab => {
          this.tabs.push({
            ...tab,
            windowId: window.id,
            windowFocused: window.focused
          });
        });
      });

      // Note: loadState() already calls loadAttachedTabs(), so we don't duplicate it here
      this.renderTabs();
    } catch (error) {
      console.error('Failed to load tabs:', error);
    }
  }

  /**
   * Render tabs grouped by window
   */
  renderTabs() {
    const container = this.elements.tabsList;
    container.innerHTML = '';

    if (this.windows.length === 0) {
      container.innerHTML = '<div class="no-tabs">No browser windows found</div>';
      return;
    }

    // Build set of attached tab IDs for fast lookup
    const attachedTabIds = new Set(this.attachedTabs.map(t => t.tabId));

    this.windows.forEach((window, index) => {
      // Filter out attached tabs AND tabs we can't attach to anyway
      // (chrome://, other extensions' chrome-extension://, devtools://, etc.).
      // chrome.debugger.attach throws "Cannot access a chrome-extension:// URL
      // of different extension" for New Tab overrides (Momentum/Notion) + the
      // PDF viewer; hiding them upfront beats a confusing error after click.
      const unattachedTabs = window.tabs
        .filter(tab => !attachedTabIds.has(tab.id))
        .filter(tab => !this._isUnattachableUrl(tab.url));

      // Skip windows with no unattached tabs
      if (unattachedTabs.length === 0) {
        return;
      }

      const windowGroup = document.createElement('div');
      windowGroup.className = 'window-group';

      const windowTitle = document.createElement('div');
      windowTitle.className = 'window-title';
      windowTitle.textContent = `Window ${index + 1}${window.focused ? ' (Current)' : ''} - ${unattachedTabs.length} tabs`;
      windowGroup.appendChild(windowTitle);

      const tabList = document.createElement('ul');
      tabList.className = 'tab-list';

      unattachedTabs.forEach(tab => {
        const tabItem = document.createElement('li');
        tabItem.className = 'tab-item';

        // Highlight active tab in current window
        if (tab.active && window.focused) {
          tabItem.classList.add('active');
        }

        const tabTitleDiv = document.createElement('div');
        tabTitleDiv.className = 'tab-item-title';

        const titleText = document.createElement('span');
        titleText.textContent = tab.title || 'Untitled';
        tabTitleDiv.appendChild(titleText);

        // Add badges
        const badges = document.createElement('span');
        if (tab.active && window.focused) {
          const activeBadge = document.createElement('span');
          activeBadge.className = 'tab-badge active';
          activeBadge.textContent = 'Current';
          badges.appendChild(activeBadge);
        }
        tabTitleDiv.appendChild(badges);

        const tabUrlDiv = document.createElement('div');
        tabUrlDiv.className = 'tab-item-url';
        tabUrlDiv.textContent = tab.url;

        tabItem.appendChild(tabTitleDiv);
        tabItem.appendChild(tabUrlDiv);

        // Click to attach to this tab
        tabItem.addEventListener('click', async () => {
          await this.attachToTab(tab.id);
        });

        tabList.appendChild(tabItem);
      });

      windowGroup.appendChild(tabList);
      container.appendChild(windowGroup);
    });
  }

  /**
   * Attach debugger to a specific tab
   */
  async attachToTab(tabId) {
    try {
      // Send message to background to attach to this tab
      const response = await chrome.runtime.sendMessage({
        type: 'ensure_attached',
        payload: { tabId }
      });

      if (response.success) {
        console.log('Successfully attached to tab:', tabId);
        // Switch to the tab
        await chrome.tabs.update(tabId, { active: true });
        const tab = await chrome.tabs.get(tabId);
        await chrome.windows.update(tab.windowId, { focused: true });

        // Refresh UI
        await this.loadState();
      } else {
        this.showError(this._friendlyAttachError({ message: response.error }) || 'Failed to attach to tab');
      }
    } catch (error) {
      console.error('Failed to attach to tab:', error);
      this.showError(this._friendlyAttachError(error));
    }
  }

  /**
   * Load attached tabs from background
   */
  async loadAttachedTabs() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'list_attached_tabs'
      });

      if (response.success) {
        this.attachedTabs = response.tabs || [];
        this.renderAttachedTabs();
      } else {
        console.error('Failed to load attached tabs:', response.error);
      }
    } catch (error) {
      console.error('Failed to load attached tabs:', error);
    }
  }

  /**
   * Render attached tabs with label management UI
   */
  renderAttachedTabs() {
    const container = this.elements.attachedTabsList;
    container.innerHTML = '';

    if (this.attachedTabs.length === 0) {
      container.innerHTML = '<div class="no-tabs">No attached tabs</div>';
      return;
    }

    this.attachedTabs.forEach(tab => {
      const tabItem = document.createElement('div');
      tabItem.className = 'attached-tab-item';

      // Highlight active (last-used) tab
      if (tab.isActive) {
        tabItem.classList.add('active-tab');
      }

      // Header with label and controls
      const header = document.createElement('div');
      header.className = 'attached-tab-header';

      // Label (editable)
      const labelSpan = document.createElement('span');
      labelSpan.className = 'attached-tab-label';
      labelSpan.textContent = tab.label;
      labelSpan.title = 'Click to edit label';

      // Add active indicator if this is the last-used tab
      if (tab.isActive) {
        const activeIndicator = document.createElement('span');
        activeIndicator.className = 'active-indicator';
        activeIndicator.textContent = 'ACTIVE';
        labelSpan.appendChild(activeIndicator);
      }

      labelSpan.addEventListener('click', () => {
        this.editTabLabel(tab.tabId, labelSpan);
      });

      header.appendChild(labelSpan);

      // Controls
      const controls = document.createElement('div');
      controls.className = 'attached-tab-controls';

      // Share button — hands this live tab to the agent picked above.
      const shareBtn = document.createElement('button');
      shareBtn.className = 'share-btn';
      shareBtn.textContent = 'Share';
      shareBtn.title = 'Send this live tab to the agent selected above — you both keep using it';
      shareBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.shareTab(tab.tabId, shareBtn);
      });

      // Detach button
      const detachBtn = document.createElement('button');
      detachBtn.className = 'detach-btn';
      detachBtn.textContent = 'Detach';
      detachBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.detachTab(tab.tabId);
      });

      controls.appendChild(shareBtn);
      controls.appendChild(detachBtn);
      header.appendChild(controls);

      tabItem.appendChild(header);

      // Tab info
      const info = document.createElement('div');
      info.className = 'attached-tab-info';
      info.textContent = `Tab ${tab.tabId} • ${tab.title}`;
      tabItem.appendChild(info);

      // URL
      const url = document.createElement('div');
      url.className = 'attached-tab-url';
      url.textContent = tab.url;
      tabItem.appendChild(url);

      container.appendChild(tabItem);
    });
  }

  /**
   * Edit tab label inline
   */
  editTabLabel(tabId, labelElement) {
    const currentLabel = labelElement.textContent.replace(' ACTIVE', '').trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentLabel;

    labelElement.textContent = '';
    labelElement.appendChild(input);
    input.focus();
    input.select();

    const saveLabel = async () => {
      const newLabel = input.value.trim();
      if (newLabel && newLabel !== currentLabel) {
        try {
          const response = await chrome.runtime.sendMessage({
            type: 'set_tab_label',
            payload: { tabId, label: newLabel }
          });

          if (response.success) {
            await this.loadAttachedTabs();
          } else {
            console.error('Failed to update label:', response.error);
            labelElement.textContent = currentLabel;
          }
        } catch (error) {
          console.error('Failed to update label:', error);
          labelElement.textContent = currentLabel;
        }
      } else {
        labelElement.textContent = currentLabel;
      }
    };

    input.addEventListener('blur', saveLabel);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveLabel();
      } else if (e.key === 'Escape') {
        labelElement.textContent = currentLabel;
      }
    });
  }

  /**
   * Detach from a specific tab
   */
  async detachTab(tabId) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'detach_tab',
        payload: { tabId }
      });

      if (response.success) {
        console.log('Successfully detached from tab:', tabId);
        await this.loadAttachedTabs();
        await this.loadState();
      } else {
        this.showError(response.error || 'Failed to detach from tab');
      }
    } catch (error) {
      console.error('Failed to detach from tab:', error);
      this.showError(error.message);
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

    // Show/hide tabs sections based on connection status
    if (state.connected) {
      this.elements.attachedTabsSection.style.display = 'block';
      this.elements.tabsSection.style.display = 'block';
      this.elements.sessionRecordSection.style.display = 'block';
      this.elements.sendAgentSection.style.display = 'block';
      this.elements.attachCurrentTabBtn.style.display = 'block';
    } else {
      this.elements.attachedTabsSection.style.display = 'none';
      this.elements.tabsSection.style.display = 'none';
      this.elements.sessionRecordSection.style.display = 'none';
      this.elements.sendAgentSection.style.display = 'none';
      this.elements.attachCurrentTabBtn.style.display = 'none';
    }

    // Update session record button state
    const btn = this.elements.sessionRecordBtn;
    const recs = Array.isArray(state.sessionRecordings) ? state.sessionRecordings : [];
    this._renderRecordingList(recs);
    btn.classList.toggle('recording', recs.length > 0);
    const stats = this.elements.sessionRecordStats;
    if (recs.length) {
      stats.classList.add('visible');
      stats.textContent = recs.length === 1 ? '1 recording' : `${recs.length} recordings`;
    } else {
      stats.classList.remove('visible');
      stats.textContent = '';
    }
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
}

// Initialize popup controller
const popup = new PopupController();

console.log('Browser MCP popup loaded');

// ─── Server registry + per-tab binding UI ───────────────────────────────────

(async function initServerUI() {
  const select = document.getElementById('tab-server-select');
  const statusLine = document.getElementById('tab-binding-status');
  const serverInfo = document.getElementById('current-server-info');
  const openOptionsLink = document.getElementById('open-server-options');
  if (!select) return;

  if (openOptionsLink) {
    openOptionsLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
      else window.open(chrome.runtime.getURL('options.html'));
    });
  }

  async function getActiveTabId() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0]?.id ?? null;
    } catch { return null; }
  }

  async function render() {
    const servers = await listServers();
    const defaultId = await getDefaultServerId();
    const tabId = await getActiveTabId();
    const binding = tabId != null ? await getTabBinding(tabId) : null;

    // Populate dropdown
    select.innerHTML = '';
    const def = document.createElement('option');
    def.value = '';
    const defaultName = servers.find(s => s.id === defaultId)?.name || '(none)';
    def.textContent = `— use default (${defaultName}) —`;
    select.appendChild(def);
    for (const s of servers) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name}${s.id === defaultId ? '  ★ default' : ''}`;
      select.appendChild(opt);
    }
    select.value = binding || '';

    statusLine.textContent = tabId == null
      ? 'No active tab (open this popup from a regular tab).'
      : binding
        ? `Tab ${tabId} bound to "${servers.find(s => s.id === binding)?.name || binding}".`
        : `Tab ${tabId} using default server.`;

    // Top info row: show what server the WS is currently connected to
    const def2 = servers.find(s => s.id === defaultId);
    if (def2 && serverInfo) {
      try {
        const u = new URL(def2.serverUrl || 'http://localhost:9010');
        serverInfo.textContent = u.host || def2.serverUrl;
        serverInfo.title = def2.name;
      } catch {
        serverInfo.textContent = def2.serverUrl || 'localhost:9010';
      }
    } else if (serverInfo) {
      serverInfo.textContent = 'localhost:9010';
    }
  }

  select.addEventListener('change', async () => {
    const tabId = await getActiveTabId();
    if (tabId == null) return;
    const val = select.value || null;
    await setTabBinding(tabId, val);
    // Ask the service worker to spin up a WS connection for this tab's bound
    // server (no-op if it's the default, or already connected). This lets the
    // bound server actually drive the tab over its own WebSocket.
    try {
      await chrome.runtime.sendMessage({ type: 'ENSURE_SERVER_WS', tabId });
    } catch (err) {
      console.log('[popup] ENSURE_SERVER_WS message failed (extension may be reloading):', err?.message || err);
    }
    await render();
  });

  await render();
})();
