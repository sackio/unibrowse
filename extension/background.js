/**
 * Browser MCP - Background Service Worker
 * Central coordinator for WebSocket, Chrome Debugger, and message routing
 */

importScripts('config.js', 'utils/browser-env.js', 'utils/server-resolver.js', 'utils/websocket-offscreen.js', 'utils/cdp.js');

// ─── Auto session-capture on attach (ben 2026-08-02) ────────────────────────
// "Anytime we attach a tab we should be doing a session recording so that we
// can record what I do or what an agent does or both … this helps us refine
// what agents are doing and figure out what they did wrong what they did right."
//
// ⚠️ These live HERE and not in config.js on purpose: the server REPLACES
// config.js wholesale when the extension is served via /install/extension.zip
// (see the header of that file), so any behavioural default placed there is
// silently reverted for every downloaded install.
//
// Video is deliberately NOT automatic — ben, same conversation: "we have tabs
// attached for very long time so I don't want to just be recording endlessly …
// video recording automatically only when specified but DOM capturing
// everything I think is still good." Video stays opt-in via an explicit
// browser_start_session_recording / the popup.
const SESSION_AUTO_CAPTURE_ON_ATTACH = true;
const SESSION_AUTO_CAPTURE_VIDEO = false;

// Rolling-window caps. An auto-started recording has no natural end — it lives
// as long as the tab stays attached, which for this fleet is measured in days —
// so these bound service-worker memory, not just upload size.
// ⚠️ rrweb's cap is enforced ONLY at FullSnapshot boundaries; see
// _trimSessionBuffers(). The others are plain independent records and can be
// head-dropped freely.
const SESSION_MAX_RRWEB_EVENTS = 20000;
const SESSION_MAX_NETWORK_ENTRIES = 5000;
const SESSION_MAX_INTERACTIONS = 5000;

// rrweb EventType values we depend on (rrweb doesn't expose the enum to us here).
const RRWEB_TYPE_META = 4;
const RRWEB_TYPE_FULL_SNAPSHOT = 2;

// Stable extension identity for the multi-extension server pool. Generated once
// per Chrome profile, persisted in chrome.storage.local, and shipped to the
// server in EXTENSION_REGISTER so the server can route per-tab tool calls back
// to the right extension when multiple are connected (e.g. ben's main Chrome
// vs a container chromium spawned by browser_launch_isolated_chrome).
//
// Singleton pattern: ensureExtensionId() returns the same in-flight promise on
// every call, so concurrent callers can `await` it without each triggering a
// fresh storage round-trip. This is load-bearing for the split-brain bug fix
// — without it, background.js's startup probe and the WS-manager's connect()
// could race, and the offscreen's first OFFSCREEN_CONNECT could arrive before
// `self.__unibrowseExtensionId` was set. With it, the FIRST resolution writes
// storage exactly once; all later callers see the same id.
let _extIdPromise = null;
async function ensureExtensionId() {
  if (_extIdPromise) return _extIdPromise;
  _extIdPromise = (async () => {
    try {
      const stored = await chrome.storage.local.get(['__unibrowseExtensionId', '__unibrowseProfileHint']);
      let id = stored.__unibrowseExtensionId;
      if (!id) {
        id = 'ext_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
        await chrome.storage.local.set({ __unibrowseExtensionId: id });
      }
      self.__unibrowseExtensionId = id;
      self.__unibrowseProfileHint = stored.__unibrowseProfileHint || null;
      return id;
    } catch (err) {
      // Extension context invalidated etc. Fall back to a per-process id so the
      // server can still distinguish connections during reload windows.
      const fb = self.__unibrowseExtensionId || ('ext_eph_' + Math.random().toString(36).slice(2));
      self.__unibrowseExtensionId = fb;
      // Don't memoize the fallback — next non-error call should retry storage.
      _extIdPromise = null;
      return fb;
    }
  })();
  return _extIdPromise;
}
// Fire the probe at module load so storage gets populated as early as
// possible; concurrent callers reuse the promise (idempotent).
ensureExtensionId().catch(() => {});

// Global state for auto-connect
let offscreenReady = false;
let autoConnectAttempted = false;

/**
 * Background Interaction Recorder
 * Continuously records all user interactions in a circular buffer
 * Provides flexible querying, pruning, and searching capabilities
 */
class BackgroundRecorder {
  constructor(maxSize = 500) {
    this.buffer = [];
    this.maxSize = maxSize;
    this.enabled = true;
    this.actionIdCounter = 0;
  }

  /**
   * Add an interaction to the buffer
   */
  addAction(action) {
    if (!this.enabled) return;

    // Add timestamp and unique ID
    action.timestamp = Date.now();
    action.id = ++this.actionIdCounter;

    // Add to buffer
    this.buffer.push(action);

    // Maintain circular buffer
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  /**
   * Get interactions with flexible filtering
   */
  get(filters = {}) {
    let results = [...this.buffer];
    const now = Date.now();

    // Apply time filters (support negative offsets from now)
    if (filters.startTime !== undefined) {
      const startTime = filters.startTime < 0 ? now + filters.startTime : filters.startTime;
      results = results.filter(a => a.timestamp >= startTime);
    }
    if (filters.endTime !== undefined) {
      const endTime = filters.endTime < 0 ? now + filters.endTime : filters.endTime;
      results = results.filter(a => a.timestamp <= endTime);
    }

    // Apply type filters
    if (filters.types && filters.types.length > 0) {
      results = results.filter(a => filters.types.includes(a.type));
    }

    // Apply URL pattern filter
    if (filters.urlPattern) {
      const urlRegex = new RegExp(filters.urlPattern, 'i');
      results = results.filter(a => a.url && urlRegex.test(a.url));
    }

    // Apply selector pattern filter
    if (filters.selectorPattern) {
      const selectorRegex = new RegExp(filters.selectorPattern, 'i');
      results = results.filter(a => a.element && a.element.selector && selectorRegex.test(a.element.selector));
    }

    // Sort by timestamp
    const sortOrder = filters.sortOrder || 'desc';
    results.sort((a, b) => {
      return sortOrder === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
    });

    // Apply pagination
    const offset = filters.offset || 0;
    const limit = filters.limit || 50;
    const paginatedResults = results.slice(offset, offset + limit);

    return {
      interactions: paginatedResults,
      totalCount: results.length,
      bufferSize: this.buffer.length,
    };
  }

  /**
   * Prune interactions based on criteria
   */
  prune(filters = {}) {
    const originalLength = this.buffer.length;
    let toRemove = [];

    // Time-based pruning
    if (filters.before !== undefined) {
      toRemove = this.buffer.filter(a => a.timestamp < filters.before);
    }
    if (filters.after !== undefined) {
      toRemove = this.buffer.filter(a => a.timestamp > filters.after);
    }
    if (filters.between) {
      const [start, end] = filters.between;
      toRemove = this.buffer.filter(a => a.timestamp >= start && a.timestamp <= end);
    }

    // Count-based pruning
    if (filters.keepLast !== undefined) {
      const toKeep = this.buffer.slice(-filters.keepLast);
      this.buffer = toKeep;
      return {
        removedCount: originalLength - this.buffer.length,
        remainingCount: this.buffer.length,
      };
    }
    if (filters.keepFirst !== undefined) {
      const toKeep = this.buffer.slice(0, filters.keepFirst);
      this.buffer = toKeep;
      return {
        removedCount: originalLength - this.buffer.length,
        remainingCount: this.buffer.length,
      };
    }
    if (filters.removeOldest !== undefined) {
      this.buffer = this.buffer.slice(filters.removeOldest);
      return {
        removedCount: originalLength - this.buffer.length,
        remainingCount: this.buffer.length,
      };
    }

    // Type-based pruning
    if (filters.types && filters.types.length > 0) {
      toRemove = this.buffer.filter(a => filters.types.includes(a.type));
    }
    if (filters.excludeTypes && filters.excludeTypes.length > 0) {
      toRemove = this.buffer.filter(a => !filters.excludeTypes.includes(a.type));
    }

    // Pattern-based pruning
    if (filters.urlPattern) {
      const urlRegex = new RegExp(filters.urlPattern, 'i');
      toRemove = this.buffer.filter(a => a.url && urlRegex.test(a.url));
    }
    if (filters.selectorPattern) {
      const selectorRegex = new RegExp(filters.selectorPattern, 'i');
      toRemove = this.buffer.filter(a => a.element && a.element.selector && selectorRegex.test(a.element.selector));
    }

    // Remove the filtered actions
    if (toRemove.length > 0) {
      const removeIds = new Set(toRemove.map(a => a.id));
      this.buffer = this.buffer.filter(a => !removeIds.has(a.id));
    }

    return {
      removedCount: originalLength - this.buffer.length,
      remainingCount: this.buffer.length,
    };
  }

  /**
   * Search interactions by text query
   */
  search(query, filters = {}) {
    const queryLower = query.toLowerCase();
    let results = [];

    // Search across all relevant fields
    for (const action of this.buffer) {
      let matched = false;
      let matchedField = null;

      // Search in URL
      if (action.url && action.url.toLowerCase().includes(queryLower)) {
        matched = true;
        matchedField = 'url';
      }

      // Search in selector
      if (!matched && action.element && action.element.selector && action.element.selector.toLowerCase().includes(queryLower)) {
        matched = true;
        matchedField = 'selector';
      }

      // Search in element text
      if (!matched && action.element && action.element.text && action.element.text.toLowerCase().includes(queryLower)) {
        matched = true;
        matchedField = 'element.text';
      }

      // Search in value
      if (!matched && action.value && action.value.toLowerCase().includes(queryLower)) {
        matched = true;
        matchedField = 'value';
      }

      // Search in key
      if (!matched && action.key && action.key.toLowerCase().includes(queryLower)) {
        matched = true;
        matchedField = 'key';
      }

      if (matched) {
        results.push({ ...action, matchedField });
      }
    }

    // Apply additional filters
    const now = Date.now();
    if (filters.types && filters.types.length > 0) {
      results = results.filter(a => filters.types.includes(a.type));
    }
    if (filters.startTime !== undefined) {
      const startTime = filters.startTime < 0 ? now + filters.startTime : filters.startTime;
      results = results.filter(a => a.timestamp >= startTime);
    }
    if (filters.endTime !== undefined) {
      const endTime = filters.endTime < 0 ? now + filters.endTime : filters.endTime;
      results = results.filter(a => a.timestamp <= endTime);
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => b.timestamp - a.timestamp);

    // Apply limit
    const limit = filters.limit || 50;
    const limitedResults = results.slice(0, limit);

    return {
      interactions: limitedResults,
      totalMatches: results.length,
    };
  }

  /**
   * Clear all interactions
   */
  clear() {
    this.buffer = [];
    this.actionIdCounter = 0;
  }

  /**
   * Enable/disable recording
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Get current buffer stats
   */
  getStats() {
    return {
      bufferSize: this.buffer.length,
      maxSize: this.maxSize,
      enabled: this.enabled,
      oldestTimestamp: this.buffer.length > 0 ? this.buffer[0].timestamp : null,
      newestTimestamp: this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].timestamp : null,
    };
  }
}

/**
 * TabManager - Manages multiple tab attachments with labels
 * Handles CDP instances per tab, label generation, and tab resolution
 */
class TabManager {
  constructor() {
    this.attachedTabs = new Map(); // Map<tabId, TabInfo>
    this.labelCounter = new Map(); // Map<domain, number>
    this.lastUsedTabId = null;
    // Tab reservation registry — Map<tabId, { owner, claimedAt, history[] }>
    // - owner: agent name string ("shopping", "ha", etc.) — the agent that
    //   currently controls the tab. Operations from other agents (when they
    //   supply an `agent` param) get a tab-reserved error unless they also
    //   set takeover:true.
    // - claimedAt: epoch ms when current owner took control.
    // - history: rolling list (max 10) of prior {owner, claimedAt, releasedAt,
    //   releaseReason} entries so callers can see who had it before.
    // A missing entry means the tab is unreserved (legacy free-for-all).
    this.reservations = new Map();
  }

  // ─── Reservation registry ──────────────────────────────────────────────

  /**
   * ⚠️ RESERVATIONS EXPIRE. They did not, and that was the bug behind a year of
   * "the extension has crashed, I need to reload it."
   *
   * A reservation used to live in this Map until something explicitly released
   * it — with no TTL, no liveness check, and no way for anyone but the owner to
   * clear it. So an agent that took a tab and then died (a throwaway automation
   * session, a crashed seat, a respawn) held that tab FOREVER. Every later
   * operation on it was refused with a correct, well-formed, completely
   * unactionable error naming an owner that no longer existed.
   *
   * Measured 2026-08-12: ben's claude.ai tab was held by "claude-login-auto"
   * — a disposable session from an account swap the previous day — for 26
   * HOURS. The only thing that clears the Map is reloading the extension, which
   * is exactly the workaround he had been driven to, and which is why it kept
   * coming back. ⭐ From outside, "the extension is broken" and "the extension
   * is holding a stale lock" are indistinguishable: both look like a dead
   * browser, and a reload fixes both. That is what hid this through two
   * previous investigations that went looking for a crash.
   *
   * Expiry keys on LAST ACTIVITY, not claim time — a genuinely long task keeps
   * refreshing its own claim just by working, so this cannot cut a live agent
   * off mid-flight. It only reaps claims nobody is using.
   */
  static RESERVATION_TTL_MS = 30 * 60 * 1000;   // 30 min of INACTIVITY

  /** Has this reservation gone stale (owner idle past the TTL)? */
  _isStale(entry) {
    if (!entry || !entry.owner) return false;
    const last = entry.lastActivityAt || entry.claimedAt || 0;
    return Date.now() - last > TabManager.RESERVATION_TTL_MS;
  }

  /** Drop a stale reservation in place. Returns true if one was reaped. */
  _reapIfStale(tabId) {
    const entry = this.reservations.get(tabId);
    if (!this._isStale(entry)) return false;
    const heldMs = Date.now() - (entry.lastActivityAt || entry.claimedAt);
    console.log(
      `[TabManager] Tab ${tabId} reservation by "${entry.owner}" EXPIRED after ` +
      `${Math.round(heldMs / 60000)}min idle — auto-releasing`
    );
    this.releaseTab(tabId, `expired-after-${Math.round(heldMs / 60000)}min-idle`);
    return true;
  }

  /** Mark the owner as alive so an in-progress task keeps its claim. */
  touchReservation(tabId, agent) {
    const entry = this.reservations.get(tabId);
    if (!entry || !entry.owner || !agent) return;
    if (entry.owner !== agent) return;
    entry.lastActivityAt = Date.now();
  }

  /** Human-readable age, so a stale claim reads as stale. */
  static _describeAge(ms) {
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m}min ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ${m % 60}min ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  /** Claim a tab for an agent. Throws `tab-reserved` if held by another and
   *  takeover is false. No-op if agent is empty (legacy free-for-all). */
  claimTab(tabId, agent, options = {}) {
    if (!agent) return null;
    const takeover = options.takeover === true;
    // An idle-expired claim is not a claim. Reap before reading, so a caller
    // never has to pass takeover:true to displace an owner that is already gone.
    this._reapIfStale(tabId);
    const existing = this.reservations.get(tabId);
    if (existing && existing.owner && existing.owner !== agent) {
      if (!takeover) {
        const err = new Error(
          `Tab ${tabId} is reserved by "${existing.owner}" since ` +
          `${new Date(existing.claimedAt).toISOString()}. Pass takeover:true on the ` +
          `same call to forcibly transfer ownership (logged in tab history).`
        );
        err.code = 'tab-reserved';
        err.owner = existing.owner;
        err.claimedAt = existing.claimedAt;
        throw err;
      }
      // Takeover: record the prior owner in history before claiming.
      const history = existing.history || [];
      history.push({
        owner: existing.owner,
        claimedAt: existing.claimedAt,
        releasedAt: Date.now(),
        releaseReason: `taken-over-by:${agent}`,
      });
      while (history.length > 10) history.shift();
      this.reservations.set(tabId, { owner: agent, claimedAt: Date.now(), lastActivityAt: Date.now(), history });
      console.log(`[TabManager] Tab ${tabId} forcibly taken over by "${agent}" from "${existing.owner}"`);
      return { taken: true, previousOwner: existing.owner };
    }
    if (existing && existing.owner === agent) {
      // Already ours, refresh nothing — keep original claimedAt.
      return { reclaimed: true };
    }
    // Unreserved → claim.
    const history = (existing && existing.history) || [];
    this.reservations.set(tabId, { owner: agent, claimedAt: Date.now(), lastActivityAt: Date.now(), history });
    console.log(`[TabManager] Tab ${tabId} reserved by "${agent}"`);
    return { claimed: true };
  }

  /** Release the reservation on a tab and append a history entry. */
  releaseTab(tabId, reason = 'released') {
    const existing = this.reservations.get(tabId);
    if (!existing || !existing.owner) return;
    const history = existing.history || [];
    history.push({
      owner: existing.owner,
      claimedAt: existing.claimedAt,
      releasedAt: Date.now(),
      releaseReason: reason,
    });
    while (history.length > 10) history.shift();
    this.reservations.set(tabId, { owner: null, claimedAt: null, history });
    console.log(`[TabManager] Tab ${tabId} released ("${existing.owner}" → ${reason})`);
  }

  /** Read-only ownership probe. Returns null when caller may proceed (no agent
   *  supplied, no reservation, or caller IS the owner). Returns a
   *  {blocked:true, owner, claimedAt} record when another agent owns it. */
  checkAccess(tabId, agent) {
    if (!agent) return null;
    // Reap first: an idle-expired claim must not block a live caller. Without
    // this the probe faithfully reports a reservation whose owner died
    // yesterday — see the RESERVATION_TTL_MS note above.
    this._reapIfStale(tabId);
    const existing = this.reservations.get(tabId);
    if (!existing || !existing.owner) return null;
    if (existing.owner === agent) return null;
    return {
      blocked: true,
      owner: existing.owner,
      claimedAt: existing.claimedAt,
      lastActivityAt: existing.lastActivityAt || existing.claimedAt,
    };
  }

  getReservation(tabId) {
    // Reap here too, so browser_list_attached_tabs never reports a phantom
    // owner. The listing is where a human or agent goes to find out WHO holds
    // a tab; showing them a 26-hour-old claim as if it were live is how this
    // bug survived being looked at directly.
    this._reapIfStale(tabId);
    return this.reservations.get(tabId) || null;
  }

  /**
   * Generate a unique label for a tab based on its URL
   * Format: "domain.com" for first, "domain.com-2" for subsequent
   */
  generateLabel(url) {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace('www.', '');

      // Count existing tabs for this domain
      let count = 1;
      for (const tab of this.attachedTabs.values()) {
        try {
          const tabDomain = new URL(tab.url).hostname.replace('www.', '');
          if (tabDomain === domain) {
            count++;
          }
        } catch (e) {
          // Ignore invalid URLs
        }
      }

      // Return "domain.com" for first, "domain.com-2" for subsequent
      return count === 1 ? domain : `${domain}-${count}`;
    } catch (error) {
      // Fallback for invalid URLs
      console.warn('[TabManager] Invalid URL for label generation:', url);
      return `tab-${Date.now()}`;
    }
  }

  /**
   * Attach debugger to a tab
   * Creates new CDP instance and stores tab info
   */
  async attachTab(tabId, url, title, options = {}) {
    try {
      // Bail early on URLs we KNOW chrome will reject. Prevents the cascade
      // of [CDP] / [TabManager] / [Background] error logs ben pasted on
      // 2026-06-27 when a tab was an other-extension's New Tab override.
      // Without this guard cdp.attach() throws "Cannot access a
      // chrome-extension:// URL of different extension", which the retry
      // path then eats 5x before giving up — and on every keepalive
      // pass after that.
      if (url && (url.startsWith('chrome-extension://') ||
                  BrowserEnv.isInternalUrl(url) ||
                  (url.startsWith('about:') && url !== 'about:blank' && url !== 'about:blank#blocked'))) {
        const friendly = url.startsWith('chrome-extension://')
          ? `This tab is owned by another extension (likely a New Tab override or PDF viewer). ${BrowserEnv.name} blocks debugging other extensions' pages — navigate to a regular URL first.`
          : `This page (${url}) can't be debugged by extensions. Navigate to a regular URL first.`;
        const err = new Error(friendly);
        err.code = 'UNATTACHABLE_URL';
        throw err;
      }

      // Reservation: when an `agent` is supplied, claim ownership before
      // anything else. Throws `tab-reserved` if another agent already owns
      // it and takeover isn't set, leaving the tab state untouched.
      const { agent, takeover, label: requestedLabel } = options;
      this.claimTab(tabId, agent, { takeover: takeover === true });

      // A caller-supplied label must not collide with another tab's, or
      // resolveTab() silently returns whichever it finds first.
      if (requestedLabel) {
        for (const [otherId, info] of this.attachedTabs) {
          if (otherId !== tabId && info.label === requestedLabel) {
            throw new Error(
              `Label "${requestedLabel}" is already in use by tab ${otherId}. ` +
              `Labels must be unique — pick another, or target by numeric tabId.`
            );
          }
        }
      }

      // Check if already attached
      let preservedLabel = null;
      if (this.attachedTabs.has(tabId)) {
        const existing = this.attachedTabs.get(tabId);
        if (existing.cdp && existing.cdp.isAttached()) {
          console.log('[TabManager] Tab already attached and CDP alive:', tabId);
          return existing;
        }
        // CDP is dead (debugger detached behind our back) — remove stale entry and re-attach
        console.log('[TabManager] Tab in map but CDP is dead, removing stale entry and re-attaching:', tabId);
        preservedLabel = existing.label; // preserve custom label (e.g. "efast2")
        if (existing.cdp?.detachListener) {
          chrome.debugger.onDetach.removeListener(existing.cdp.detachListener);
          existing.cdp.detachListener = null;
        }
        this.attachedTabs.delete(tabId);
      }

      console.log('[TabManager] Attaching to tab:', tabId, url);

      // Caller's label wins, then a preserved custom label, then one derived
      // from the URL. ⚠️ The caller's label used to be ACCEPTED AND DROPPED:
      // browser_attach_tab({label}) only ever used `label` to RESOLVE an
      // existing tab, never to name a new one, so the tab silently got a
      // hostname label instead. The follow-up call targeting the requested
      // label then failed with "No tab found with label" — correct, but for a
      // reason invisible in the attach response that reported success.
      // (assistant, 2026-08-06.)
      const label = requestedLabel || preservedLabel || this.generateLabel(url);

      // Store original title (remove [MCP] prefix if it exists)
      const originalTitle = title.startsWith('🟢 [MCP] ')
        ? title.replace('🟢 [MCP] ', '')
        : title;

      // Create new CDP instance for this tab
      const cdp = new CDPHelper();
      console.log('[TabManager] Created CDP instance, about to attach...');

      await cdp.attach(tabId);
      console.log('[TabManager] CDP attach() returned successfully');

      console.log('[TabManager] CDP attached, now creating tab info...');

      // Create tab info FIRST, before trying to modify the page
      const tabInfo = {
        tabId,
        label,
        url,
        title: originalTitle,
        originalTitle: originalTitle,
        attachedAt: Date.now(),
        lastUsedAt: Date.now(),
        cdp
      };

      // Store in map immediately
      this.attachedTabs.set(tabId, tabInfo);
      this.lastUsedTabId = tabId;
      console.log('[TabManager] Tab info stored, now adding [MCP] prefix...');

      // Add [MCP] prefix to tab title (do this AFTER storing in map)
      try {
        await cdp.evaluate(`
          if (!document.title.startsWith('🟢 [MCP] ')) {
            document.title = '🟢 [MCP] ' + document.title;
          }
        `, true);
        console.log('[TabManager] Added [MCP] prefix to tab title');
      } catch (error) {
        console.error('[TabManager] Failed to update tab title:', error);
        // Continue anyway - tab is still attached
      }

      console.log('[TabManager] Tab attached successfully:', label);
      // Announce ownership to the server so it can route tabTarget-bound
      // tool calls to our WebSocket (multi-extension pool). Best-effort —
      // doesn't block the attach result.
      try {
        const announce = {
          type: 'TAB_ATTACHED',
          payload: {
            extensionId: self.__unibrowseExtensionId,
            tabId,
            label,
            url,
          },
        };
        if (typeof self.__unibrowseSendBareToServer === 'function') {
          self.__unibrowseSendBareToServer(announce);
        }
      } catch { /* best-effort */ }
      return tabInfo;
    } catch (error) {
      console.error('[TabManager] CRITICAL ERROR in attachTab:', error);
      console.error('[TabManager] Error stack:', error.stack);
      throw error;
    }
  }

  /**
   * Detach debugger from a tab
   * Cleans up CDP instance and restores original title
   */
  async detachTab(tabId) {
    const tabInfo = this.attachedTabs.get(tabId);
    if (!tabInfo) {
      console.warn('[TabManager] Tab not attached:', tabId);
      return;
    }

    // Release the reservation so other agents can claim the tab.
    this.releaseTab(tabId, 'detached');

    // Announce detachment to the server's multi-extension pool.
    try {
      const announce = {
        type: 'TAB_DETACHED',
        payload: { extensionId: self.__unibrowseExtensionId, tabId },
      };
      if (typeof self.__unibrowseSendBareToServer === 'function') {
        self.__unibrowseSendBareToServer(announce);
      }
    } catch { /* best-effort */ }

    console.log('[TabManager] Detaching from tab:', tabId, tabInfo.label);

    // Check if tab still exists before trying to restore title
    let tabExists = false;
    try {
      await chrome.tabs.get(tabId);
      tabExists = true;
    } catch (error) {
      // Tab was closed - this is expected, no need to restore title
      console.log('[TabManager] Tab no longer exists (closed), skipping title restoration');
    }

    // Only restore title if tab still exists
    if (tabExists) {
      // Remove [MCP] prefix from tab title before detaching
      try {
        // Try CDP first if still attached
        if (tabInfo.cdp.isAttached()) {
          await tabInfo.cdp.evaluate(`
            if (document.title.startsWith('🟢 [MCP] ')) {
              document.title = document.title.replace('🟢 [MCP] ', '');
            }
          `, true);
          console.log('[TabManager] Removed [MCP] prefix using CDP');
        }
      } catch (error) {
        // Fall back to chrome.scripting if CDP fails
        console.warn('[TabManager] CDP title restoration failed, using chrome.scripting:', error);
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              if (document.title.startsWith('🟢 [MCP] ')) {
                document.title = document.title.replace('🟢 [MCP] ', '');
              }
            }
          });
          console.log('[TabManager] Removed [MCP] prefix using chrome.scripting');
        } catch (scriptError) {
          console.warn('[TabManager] Failed to restore tab title (tab may have closed):', scriptError.message);
        }
      }
    }

    // Detach CDP
    try {
      await tabInfo.cdp.detach();
    } catch (error) {
      console.error('[TabManager] Error detaching CDP:', error);
    }

    // Remove from map
    this.attachedTabs.delete(tabId);
    // ⚠️ And drop the reservation with it. Nothing anywhere called
    // reservations.delete() — releaseTab() only nulls the owner and keeps the
    // entry — so the Map accumulated one entry per tab ever attached, forever,
    // each still naming whoever last held it. A detached tab's reservation
    // cannot be meaningful: the tab it refers to is gone.
    this.reservations.delete(tabId);

    // Update lastUsedTabId if needed. This was the ONLY path that got it
    // right; repointLastUsed() is this logic extracted so the five paths that
    // nulled the pointer instead can share it.
    if (this.lastUsedTabId === tabId) this.repointLastUsed();

    console.log('[TabManager] Tab detached. Remaining tabs:', this.attachedTabs.size);
  }

  /**
   * Detach from all tabs
   */
  async detachAll() {
    console.log('[TabManager] Detaching from all tabs:', this.attachedTabs.size);
    const tabIds = Array.from(this.attachedTabs.keys());

    for (const tabId of tabIds) {
      await this.detachTab(tabId);
    }

    this.lastUsedTabId = null;
  }

  /**
   * Mark a tab as used (updates lastUsedAt timestamp)
   */
  markUsed(tabId) {
    const tabInfo = this.attachedTabs.get(tabId);
    if (tabInfo) {
      tabInfo.lastUsedAt = Date.now();
      this.lastUsedTabId = tabId;
    }
  }

  /**
   * Resolve tab ID or label to tab info
   * @param {number|string} tabIdOrLabel - Tab ID (number) or label (string)
   * @returns {Object|null} Tab info or null if not found
   */
  resolveTab(tabIdOrLabel) {
    // If number, lookup by tabId
    if (typeof tabIdOrLabel === 'number') {
      return this.attachedTabs.get(tabIdOrLabel) || null;
    }

    // If string that looks like a number, also try numeric lookup (agents often pass IDs as strings)
    if (typeof tabIdOrLabel === 'string' && /^\d+$/.test(tabIdOrLabel)) {
      const numericId = parseInt(tabIdOrLabel, 10);
      const byId = this.attachedTabs.get(numericId);
      if (byId) return byId;
    }

    // Lookup by label
    for (const tabInfo of this.attachedTabs.values()) {
      if (tabInfo.label === tabIdOrLabel) {
        return tabInfo;
      }
    }

    return null;
  }

  /**
   * Get the active CDP instance for operations
   * @param {number|string} tabTarget - Optional tab ID or label. If not provided, uses last-used tab
   * @returns {CDPHelper|null} CDP instance or null if no tab available
   */
  getActiveCDP(tabTarget) {
    let tabInfo = null;

    if (tabTarget) {
      // Resolve specific tab
      tabInfo = this.resolveTab(tabTarget);
    } else if (this.lastUsedTabId) {
      // Use last-used tab
      tabInfo = this.attachedTabs.get(this.lastUsedTabId);
    }

    if (tabInfo) {
      // Mark as used
      this.markUsed(tabInfo.tabId);
    }

    return tabInfo?.cdp || null;
  }

  /**
   * Get active CDP or throw a descriptive error if not found.
   * Use this in handlers instead of getActiveCDP() to avoid null-dereference crashes.
   * When `agent` is supplied (4th arg via options), enforces the tab reservation:
   * non-owners get a tab-reserved error unless they also pass takeover:true,
   * in which case ownership is transferred (logged in history).
   */
  requireCDP(tabTarget, options = {}) {
    // Caller can pass options explicitly, OR the dispatcher has stashed the
    // request's agent + takeover on `this._currentAgent` / `_currentTakeover`
    // before invoking the handler. The explicit options win when supplied.
    const agent = options.agent !== undefined ? options.agent : this._currentAgent;
    const takeover = options.takeover !== undefined ? options.takeover : this._currentTakeover;
    // Resolve tab info (without marking used yet — we may bail on reservation)
    let tabInfo = null;
    if (tabTarget) {
      tabInfo = this.resolveTab(tabTarget);
    } else if (this.lastUsedTabId) {
      tabInfo = this.attachedTabs.get(this.lastUsedTabId);
    }
    if (!tabInfo || !tabInfo.cdp) {
      throw new Error(
        tabTarget
          ? `Tab ${tabTarget} not found or not attached. Use browser_list_attached_tabs to see available tabs.`
          : 'No tabs currently attached. Use browser_attach_tab or browser_create_tab first.'
      );
    }
    // Reservation gate. When agent is supplied: if the tab is reserved by
    // someone else, either honor it (no takeover → throw) or take over.
    if (agent) {
      const block = this.checkAccess(tabInfo.tabId, agent);
      if (block) {
        if (takeover === true) {
          this.claimTab(tabInfo.tabId, agent, { takeover: true });
        } else {
          // State the AGE, not just the timestamp. The old message gave an ISO
          // string, which reads as an equally-valid claim whether it is 4
          // minutes or 26 hours old — so a dead owner's lock looked exactly
          // like a live colleague's. The age is the whole signal.
          const idleMs = Date.now() - (block.lastActivityAt || block.claimedAt);
          const err = new Error(
            `Tab ${tabInfo.label || tabInfo.tabId} is reserved by "${block.owner}", ` +
            `last active ${TabManager._describeAge(idleMs)} ` +
            `(claimed ${new Date(block.claimedAt).toISOString()}). ` +
            `Reservations auto-expire after ${Math.round(TabManager.RESERVATION_TTL_MS / 60000)}min idle; ` +
            `pass takeover:true to claim it now.`
          );
          err.code = 'tab-reserved';
          err.owner = block.owner;
          err.claimedAt = block.claimedAt;
          err.idleMs = idleMs;
          throw err;
        }
      } else if (!this.reservations.get(tabInfo.tabId)?.owner) {
        // Tab is unreserved AND caller identified themselves — claim it as a
        // courtesy so future calls from other agents see the reservation.
        this.claimTab(tabInfo.tabId, agent);
      }
      // The owner just did work on this tab — refresh the claim. This is what
      // makes the TTL safe: a long-running task cannot be reaped out from
      // under itself, because every operation it performs pushes the deadline
      // out. Only claims nobody is exercising go stale.
      this.touchReservation(tabInfo.tabId, agent);
    }
    this.markUsed(tabInfo.tabId);
    return tabInfo.cdp;
  }

  /**
   * Update tab label
   * @param {number} tabId - Tab ID
   * @param {string} newLabel - New label (must be unique)
   * @throws {Error} If label already in use
   */
  setTabLabel(tabId, newLabel) {
    const tabInfo = this.attachedTabs.get(tabId);
    if (!tabInfo) {
      throw new Error(`Tab ${tabId} is not attached`);
    }

    // Check label uniqueness
    for (const info of this.attachedTabs.values()) {
      if (info.label === newLabel && info.tabId !== tabId) {
        // If label is already in use, try to detach the old tab first
        // (This can happen when extension reloads and Chrome keeps old debugger attachments)
        console.warn(`[TabManager] Label "${newLabel}" already in use by tab ${info.tabId}, detaching old tab`);
        try {
          this.detachTab(info.tabId).catch(err => {
            console.warn('[TabManager] Failed to detach old tab:', err);
          });
        } catch (err) {
          console.warn('[TabManager] Error detaching old tab:', err);
        }
        // Don't throw - allow the label to be reassigned
        break;
      }
    }

    const oldLabel = tabInfo.label;
    tabInfo.label = newLabel;
    console.log('[TabManager] Tab label updated:', tabId, oldLabel, '->', newLabel);
  }

  /**
   * Get list of all attached tabs
   * @returns {Array} Array of tab info objects
   */
  listTabs() {
    return Array.from(this.attachedTabs.values()).map(t => {
      const r = this.reservations.get(t.tabId);
      return {
        tabId: t.tabId,
        label: t.label,
        url: t.url,
        title: t.title,
        attachedAt: t.attachedAt,
        lastUsedAt: t.lastUsedAt,
        // ⛔ LOAD-BEARING CONTRACT, NOT AN INCIDENTAL FIELD. `isActive` means
        // exactly "this tab IS lastUsedTabId" and nothing else.
        //
        // `claude-login-auto` (agents, commit 936f2ee) derives a health check
        // from it: "extension has attached tabs AND none is active ⇒ the
        // last-used pointer is dangling", and then HEALS that by re-attaching
        // the extension's first live tab. Redefining isActive — e.g. to "the
        // foreground tab", or to something the server maintains independently
        // of lastUsedTabId — silently INVERTS that predicate: it would report
        // healthy extensions as wedged and re-attach tabs nobody asked for, on
        // every login run across the fleet.
        //
        // ⛔ Tell `agents` BEFORE changing this so they can re-key the detector.
        //
        // ⚠️ Deliberately reads the RAW field, not getLastUsedTabId(): that
        // getter repairs a stale pointer on read, and repairing the state you
        // are reporting on would hide the very condition this field publishes.
        isActive: t.tabId === this.lastUsedTabId,
        // Reservation: surface current owner + claim time + prior owners.
        // null when free-for-all (no reservation), so legacy callers can
        // ignore the field harmlessly.
        reservation: r && r.owner
          ? {
              owner: r.owner,
              claimedAt: r.claimedAt,
              historyCount: (r.history || []).length,
              recentHistory: (r.history || []).slice(-3),
            }
          : null,
      };
    });
  }

  /**
   * Check if any tabs are attached
   */
  hasAttachedTabs() {
    return this.attachedTabs.size > 0;
  }

  /**
   * Get the last-used tab ID
   *
   * ⛔ NEVER hand back an id that is no longer in attachedTabs. Callers use this
   * as "the tab to use when the caller named none", and handleEnsureAttached's
   * dead-tab prune is guarded by `attachedTabs.has(targetTabId)` — so a pointer
   * that has fallen OUT of the map skips the prune entirely and drops through to
   * `chrome.tabs.get(<dead id>)`, which rejects with Chrome's raw
   * "No tab with id: <n>". Every untargeted call into that extension then fails
   * with an id the caller never supplied and cannot act on.
   *
   * Measured 2026-08-22 on office's desktop Chrome (ext_018237f9): the pointer
   * dangled at 41931315 for ~29h. browser_create_tab failed 100%, which blocked
   * claude.ai logins fleet-wide, because that browser is the only one on office
   * that can consume a magic link. Re-attaching any live tab cleared it — attach
   * calls markUsed(), which overwrites the pointer.
   *
   * ⭐ Validate on READ, not at each delete. Two paths already drop an entry
   * without moving the pointer (the re-attach-failed delete in
   * handleEnsureAttached, and the same delete in _attemptTabManagerReattach),
   * and the next one written will do it again. Only the read is a chokepoint.
   *
   * ⚠️ listTabs() deliberately still compares against the RAW field so that
   * `isActive` reports the pointer's true state — an extension with attached
   * tabs and no isActive:true is the dangling-pointer signal. Do not "fix" it
   * to call this method; that would heal the state being reported on.
   */
  getLastUsedTabId() {
    if (!this.attachedTabs.has(this.lastUsedTabId)) this.repointLastUsed();
    return this.lastUsedTabId;
  }

  /**
   * Point lastUsedTabId at the most recently used tab that is actually
   * attached, or null when nothing is.
   *
   * ⛔ CALL THIS INSTEAD OF `lastUsedTabId = null` ANYWHERE OTHER TABS MAY
   * STILL BE ATTACHED. Nulling it while two tabs are attached leaves the
   * extension in a state where NO tab reports isActive — which is not a
   * neutral inaccuracy, because that exact condition is a published signal.
   *
   * `claude-login-auto` (agents, commit 936f2ee) reads
   * "extension has attached tabs AND none is active ⇒ dangling pointer" and
   * HEALS it by re-attaching the first live tab. A spurious all-false state
   * therefore makes it re-attach a tab nobody asked for, on every login run.
   * Five call sites nulled the pointer this way, three of them added by me on
   * 2026-08-22 while fixing the dangling-pointer wedge itself — the fix
   * reintroduced a weaker form of the bug at a lower severity, which is why
   * this is a method and not a line repeated six times.
   *
   * detachTab() has always done the right thing here; this is that logic,
   * named, so the other paths can share it.
   */
  repointLastUsed() {
    const remaining = Array.from(this.attachedTabs.values()).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    const next = remaining.length > 0 ? remaining[0].tabId : null;
    if (next !== this.lastUsedTabId) {
      console.warn('[TabManager] re-pointing lastUsedTabId', this.lastUsedTabId, '→', next);
    }
    this.lastUsedTabId = next;
    return next;
  }
}

// ─── Frame utilities ─────────────────────────────────────────────────────────

/**
 * Flatten the CDP Page.getFrameTree result into a simple array.
 * @param {{ frame, childFrames }} frameNode  CDP frame tree node
 * @param {string|null} parentId
 * @returns {Array<{ frameId, url, name, parentFrameId, iframeSelector }>}
 */
/**
 * Split rrweb / network / interaction event arrays into chunks where each chunk's
 * combined JSON.stringify size stays under maxBytes. Returns
 *   [{ rrwebEvents, networkEntries, interactions }, ...]
 * preserving event order. Used by handleStopSessionRecording to stay under
 * MongoDB's 16MB-per-doc limit.
 */
function chunkEventsBySize(rrweb, network, interactions, maxBytes) {
  const chunks = [];
  let cur = { rrwebEvents: [], networkEntries: [], interactions: [] };
  let curSize = 0;
  const flush = () => {
    if (cur.rrwebEvents.length || cur.networkEntries.length || cur.interactions.length) {
      chunks.push(cur);
      cur = { rrwebEvents: [], networkEntries: [], interactions: [] };
      curSize = 0;
    }
  };
  const push = (key, item) => {
    let s;
    try { s = JSON.stringify(item).length; } catch { s = 1024; }
    // If a single event exceeds maxBytes, accept it alone — better to send a
    // single oversized chunk and let the server reject than drop data silently.
    if (s > maxBytes && cur.rrwebEvents.length + cur.networkEntries.length + cur.interactions.length === 0) {
      cur[key].push(item);
      chunks.push(cur);
      cur = { rrwebEvents: [], networkEntries: [], interactions: [] };
      curSize = 0;
      return;
    }
    if (curSize + s > maxBytes) flush();
    cur[key].push(item);
    curSize += s;
  };
  for (const e of rrweb) push('rrwebEvents', e);
  for (const e of network) push('networkEntries', e);
  for (const e of interactions) push('interactions', e);
  flush();
  return chunks.length ? chunks : [{ rrwebEvents: [], networkEntries: [], interactions: [] }];
}

function flattenFrameTree(frameNode, parentId = null) {
  const { frame, childFrames = [] } = frameNode;
  return [
    {
      frameId: frame.id,
      url: frame.url || '',
      name: frame.name || null,
      parentFrameId: parentId,
      iframeSelector: null,   // populated by handleListFrames
    },
    ...childFrames.flatMap(c => flattenFrameTree(c, frame.id)),
  ];
}

class BackgroundController {
  constructor() {
    // URL is resolved lazily before the first connect() — see initServerConfig().
    // We construct with localhost as a sentinel so the WS manager wires its
    // listeners; resolveServerConfig() will overwrite this.url before connecting.
    this.ws = new WebSocketManager('ws://localhost:9010/ws', { wsId: 'default' });
    // Expose a helper for TabManager (and other components) to send bare
    // notification messages to the server without expecting a response —
    // used for TAB_ATTACHED / TAB_DETACHED announcements that populate the
    // server's multi-extension routing table.
    self.__unibrowseSendBareToServer = (message) => {
      try { this.ws.sendNoResponse(message); } catch { /* best-effort */ }
    };
    this.serverConfig = null; // populated by initServerConfig()
    // Connection pool: serverId → WebSocketManager. The "default" entry is
    // this.ws; additional entries are created on demand by ensureWsForServer
    // when a tab is bound to a non-default server.
    this.serverPool = new Map();
    this.serverPool.set('default', this.ws);
    this.tabManager = new TabManager(); // NEW: Multi-tab manager
    this.cdp = new CDPHelper(); // DEPRECATED: Keep for backwards compatibility during migration
    this.handlers = {};
    this.consoleLogs = [];
    // Ring buffer of background errors, max 200.
    // ⚠️ Two things used to make this miss exactly the errors worth having:
    //   1. It was ONLY written from inside handler try/catch blocks, so an
    //      uncaught throw or a rejected promise at service-worker top level —
    //      the kind that kills the worker — was never recorded at all.
    //   2. It is in-memory, so an MV3 teardown or a crash destroyed the buffer.
    //      The record of a crash did not survive the crash.
    // ⇒ Ben, 2026-08-13, asked whether I could read the extension's own errors.
    // For the ones that mattered the answer was no, and he had been acting as
    // my instrument (reading chrome://extensions and pasting) as a result.
    // Now: installGlobalErrorCapture() below catches uncaught + unhandled
    // rejection, and every write mirrors to chrome.storage.local so the next
    // worker can read what happened before it started.
    this.backgroundErrors = [];
    this.networkLogs = [];
    this.badgeBlinkInterval = null;
    this.recordingSessions = new Map(); // Track active recording sessions
    this.backgroundRecorder = new BackgroundRecorder(500); // Background interaction log
    this.sessionRecording = null; // { sessionId, tabId, tabIds[], startTime, startUrl, rrwebEvents[], networkEntries[], interactions[], pages[], videoStarted }
    this.state = {
      connected: false,
      tabId: null, // DEPRECATED: Use tabManager.lastUsedTabId instead
      tabUrl: null,
      tabTitle: null,
      originalTabTitle: null,
      temporarilyDetached: false // Track temporary detachments (e.g., extension popups)
    };

    this.keepaliveInterval = null; // Keepalive timer to maintain connection
    this.isReattaching = false; // Track if reattachment is in progress

    this.setupListeners();
    this.registerHandlers();

    // Initialize badge to disconnected state
    this.updateBadge(false);

  }

  /**
   * Check if a URL is restricted and cannot be debugged
   */
  isRestrictedUrl(url) {
    if (!url) return true;
    // about:blank is the one about: URL that IS debuggable — CDP attach
    // works fine on it. Excluding it from the restriction list lets
    // callers use attach_tab({autoOpenUrl:"about:blank"}) as a "give me
    // a blank attached tab I'll navigate later" idiom. Everything else
    // under about: (about:settings, about:flags, about:version) does
    // remain restricted.
    if (url === 'about:blank' || url === 'about:blank#blocked') return false;

    return (
      BrowserEnv.isInternalUrl(url) ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('about:')
    );
  }

  /**
   * Find the first valid (non-restricted) tab
   */
  async findFirstValidTab() {
    const tabs = await chrome.tabs.query({});

    for (const tab of tabs) {
      if (!this.isRestrictedUrl(tab.url)) {
        console.log('[Background] Found valid tab:', tab.id, tab.url);
        return tab;
      }
    }

    throw new Error(`No valid tabs found - all tabs have restricted URLs (${BrowserEnv.internalScheme}, chrome-extension://, etc.)`);
  }

  /**
   * Attempt to reattach debugger with exponential backoff retry logic
   * This handles cases where other extensions (like 1Password) temporarily interfere
   *
   * @param {number} tabId - The tab ID to reattach to
   * @param {number} attemptNumber - Current attempt number (0-indexed)
   * @param {number} maxAttempts - Maximum number of retry attempts (default: 5)
   */
  async attemptReattachWithRetry(tabId, attemptNumber, maxAttempts = 5) {
    const baseDelay = 500; // Start with 500ms
    const delay = baseDelay * Math.pow(2, attemptNumber); // Exponential backoff

    // Set reattaching flag on first attempt
    if (attemptNumber === 0) {
      this.isReattaching = true;
    }

    setTimeout(async () => {
      try {
        // Verify tab still exists
        const currentTab = await chrome.tabs.get(tabId);

        // Check if we're still tracking this tab
        if (!currentTab || this.state.tabId !== tabId) {
          console.log('[Background] Tab no longer tracked, aborting reattach');
          this.isReattaching = false;
          return;
        }

        // Check if tab is at a restricted URL (another extension interfering)
        if (this.isRestrictedUrl(currentTab.url)) {
          // chrome-extension:// (other extensions' pages) is permanently
          // un-attachable — bail immediately instead of cycling 5 retries.
          // Only the transient "page is still loading and currently routes
          // through chrome://" pattern deserves a single retry, and that
          // resolves within the first 500ms backoff, so cap at 1 retry max.
          const isPermanentBlock = currentTab.url.startsWith('chrome-extension://');
          const remainingRetries = isPermanentBlock ? 0 : (1 - attemptNumber);
          console.log(`[Background] Tab at restricted URL (${currentTab.url}), giving up${isPermanentBlock ? ' (other extension owns it)' : ''}`);
          if (remainingRetries > 0) {
            this.attemptReattachWithRetry(tabId, attemptNumber + 1, maxAttempts);
            return;
          }
          this.isReattaching = false;
          this.state.temporarilyDetached = true;
          return;
        }

        // Tab is at a normal URL, attempt reattachment
        console.log(`[Background] Reattaching to tab ${tabId} (attempt ${attemptNumber + 1}/${maxAttempts}) at: ${currentTab.url}`);
        await this.cdp.attach(tabId);
        this.state.temporarilyDetached = false;
        this.isReattaching = false;
        console.log('[Background] Successfully reattached after detachment');

      } catch (error) {
        const errorMsg = error.message || '';

        // Check if error is due to restricted URL.
        // "Cannot access a chrome-extension:// URL of different extension" =
        // permanent; bail immediately. Plain "Cannot access" without
        // chrome-extension hint MIGHT be transient (e.g. a redirect through
        // chrome://) so allow ONE retry.
        if (errorMsg.includes('chrome-extension://') || errorMsg.includes('Cannot access')) {
          const isPermanent = errorMsg.includes('chrome-extension://');
          if (!isPermanent && attemptNumber < 1) {
            this.attemptReattachWithRetry(tabId, attemptNumber + 1, maxAttempts);
            return;
          }
          console.warn('[Background] Reattachment blocked' + (isPermanent ? ' (other extension owns tab)' : ' (restricted URL)') + ' — giving up');
          this.isReattaching = false;
          this.state.temporarilyDetached = true;
          return;
        }

        // Check if tab was actually closed
        try {
          await chrome.tabs.get(tabId);
          // Tab still exists but reattachment failed for other reason
          console.error('[Background] Reattachment failed with unexpected error:', error);

          if (attemptNumber < maxAttempts - 1) {
            console.log(`[Background] Will retry after unexpected error...`);
            this.attemptReattachWithRetry(tabId, attemptNumber + 1, maxAttempts);
            return;
          }
        } catch {
          // Tab was closed
          console.log('[Background] Tab was closed during reattachment attempt');
        }

        // Either tab was closed or we've exhausted retries
        console.log('[Background] Tab closed or reattachment failed - keeping WebSocket connected');
        this.isReattaching = false;
        // Don't disconnect - keep WebSocket alive even without attached tabs
        this.state.temporarilyDetached = true;
      }
    }, delay);
  }

  /**
   * Attempt to reattach a TabManager-tracked tab's debugger with exponential backoff.
   * Mirrors attemptReattachWithRetry but operates on TabManager multi-tab entries.
   */
  async _attemptTabManagerReattach(tabId, tabInfo, attempt, maxAttempts = 5) {
    const delay = 500 * Math.pow(2, attempt);
    setTimeout(async () => {
      try {
        // If the tab was explicitly detached while we were waiting, abort
        if (!this.tabManager.attachedTabs.has(tabId)) {
          console.log(`[Background] TabManager tab ${tabId} removed from map, aborting reattach`);
          return;
        }

        const currentTab = await chrome.tabs.get(tabId).catch(() => null);
        if (!currentTab) {
          console.log(`[Background] TabManager tab ${tabId} closed, removing from map`);
          this.tabManager.attachedTabs.delete(tabId);
          if (this.tabManager.lastUsedTabId === tabId) this.tabManager.repointLastUsed();
          return;
        }

        if (this.isRestrictedUrl(currentTab.url)) {
          // For an other-extension chrome-extension:// URL, the situation
          // will never resolve — chrome won't let us debug it ever. Stop
          // retrying AND drop the tab from the attached-tabs map so future
          // keepalive ticks don't re-discover it and fire the same chain
          // of errors. (Diagnosed 2026-06-27 from ben's MacBook log spam.)
          if (currentTab.url.startsWith('chrome-extension://')) {
            console.warn(`[Background] TabManager tab ${tabId} owned by another extension (${currentTab.url}); removing from attached-tabs`);
            this.tabManager.attachedTabs.delete(tabId);
            if (this.tabManager.lastUsedTabId === tabId) this.tabManager.repointLastUsed();
            return;
          }
          // For chrome:// / devtools:// / etc., a single retry covers transient
          // navigation; beyond that, stop.
          if (attempt < 1) {
            this._attemptTabManagerReattach(tabId, tabInfo, attempt + 1, maxAttempts);
          } else {
            console.warn(`[Background] TabManager tab ${tabId} reattach gave up (restricted URL)`);
          }
          return;
        }

        console.log(`[Background] TabManager reattaching tab ${tabId} (attempt ${attempt + 1}/${maxAttempts})`);
        await tabInfo.cdp.attach(tabId);
        tabInfo.url = currentTab.url;
        tabInfo.title = currentTab.title;
        tabInfo.lastUsedAt = Date.now();
        console.log(`[Background] TabManager tab ${tabId} reattached successfully`);
        await this.injectBackgroundCapture(tabId).catch(() => {});
      } catch (error) {
        console.error(`[Background] TabManager reattach attempt ${attempt + 1} failed for tab ${tabId}:`, error.message);
        if (attempt < maxAttempts - 1 && this.tabManager.attachedTabs.has(tabId)) {
          this._attemptTabManagerReattach(tabId, tabInfo, attempt + 1, maxAttempts);
        } else {
          console.warn(`[Background] TabManager tab ${tabId} reattach exhausted all attempts`);
        }
      }
    }, delay);
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

      // ⭐ Re-announce every attached tab whenever the socket comes up.
      //
      // The server's tabId→extension routing map is built ONLY from
      // TAB_ATTACHED, which was sent once at attach time and never again. The
      // map lives in server memory, so a :9010 restart empties it while the
      // tabs themselves — which live here — are completely unaffected. With
      // more than one browser connected, wsFor() then resolves no owner for a
      // tabTarget and throws "Multiple extensions are connected (N)…", telling
      // the caller their call is ambiguous when nothing about their call
      // changed. Every seat holding a tab by label breaks at once, silently,
      // and the error points at them rather than at the restart.
      //
      // Found 2026-08-22 while planning a restart to deploy 8e61812 — by
      // asking what the restart would cost, not by hitting it. Until now the
      // recovery was for each seat to re-attach by hand, which only works if
      // someone tells them to.
      //
      // Best-effort and idempotent: recordTabOwner() is a Map set, so a
      // duplicate announcement for a tab the server already knows is a no-op.
      // The offscreen doc sends EXTENSION_REGISTER on the same socket before
      // it notifies us, so the connection is already identified by the time
      // this runs; the small delay is slack for that ordering, not a fix for it.
      if (state === 'connected') {
        setTimeout(() => {
          const attached = Array.from(this.tabManager?.attachedTabs?.values?.() || []);
          if (attached.length === 0) return;
          console.log('[Background] Socket up — re-announcing', attached.length, 'attached tab(s) to rebuild server routing');
          for (const info of attached) {
            try {
              self.__unibrowseSendBareToServer?.({
                type: 'TAB_ATTACHED',
                payload: {
                  extensionId: self.__unibrowseExtensionId,
                  tabId: info.tabId,
                  label: info.label,
                  url: info.url,
                },
              });
            } catch { /* best-effort, per tab */ }
          }
        }, 500);
      }

      // Reset autoConnectAttempted on disconnection
      // This allows reconnection when server restarts or becomes available
      // WebSocket will retry indefinitely with exponential backoff (max 5s delay)
      if (state === 'disconnected' && !this.ws.isIntentionallyClosed) {
        console.log('[Background] WebSocket disconnected, allowing auto-reconnect');
        autoConnectAttempted = false;
      }
    });

    // Extension icon clicked
    chrome.action.onClicked.addListener(() => {
      // Popup will handle this, but we can add fallback behavior here
      console.log('[Background] Extension icon clicked');
    });

    // Tab closed/removed
    chrome.tabs.onRemoved.addListener((tabId) => {
      // Release the reservation for ANY closed tab, not just the active one.
      // A closed tab's reservation is pure garbage that can still block a
      // caller: label resolution can land a later lookup on a stale entry, so
      // "reserved by <long-dead agent>" outlives the tab it described.
      if (this.tabManager?.reservations?.has(tabId)) {
        const owner = this.tabManager.reservations.get(tabId)?.owner;
        this.tabManager.reservations.delete(tabId);
        if (owner) console.log(`[TabManager] Tab ${tabId} closed — reservation by "${owner}" dropped`);
      }
      if (this.state.tabId === tabId) {
        console.log('[Background] Active tab closed');
        this.handleTabClosed(tabId);
      }
    });

    // Child frame injection for session recording.
    // tabs.onUpdated fires for the main frame; child frames that load after the main
    // frame use webNavigation.onCompleted (details.frameId !== 0).
    chrome.webNavigation.onCompleted.addListener((details) => {
      if (details.frameId === 0) return; // main frame handled by tabs.onUpdated
      if (!this.sessionRecording?.tabIds?.includes(details.tabId)) return;
      const { tabId, frameId } = details;
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: 'MAIN',
        files: ['lib/network-interceptor.js'],
      }).catch(() => {});
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        files: ['lib/rrweb-record.min.js', 'session-recorder.js'],
      }).catch(() => {});
    }, { url: [{ urlMatches: 'https?://.*' }] });

    // Tab updated (navigation, etc)
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (this.state.tabId === tabId) {
        if (changeInfo.url) {
          console.log('[Background] Tab URL changed to:', changeInfo.url);
          this.state.tabUrl = changeInfo.url;

          // If navigating to restricted URL while attached, mark as temporarily detached
          if (this.isRestrictedUrl(changeInfo.url) && this.cdp.isAttached()) {
            console.log('[Background] Navigating to restricted URL, will need to reattach after navigation');
            this.state.temporarilyDetached = true;
          }
        }

        // Re-attach debugger if we're in a temporary detachment state
        // Only attempt reattachment when page is fully loaded and not already attached
        if (changeInfo.status === 'complete' &&
            this.state.temporarilyDetached &&
            this.state.connected &&
            !this.cdp.isAttached()) {

          // Check if the URL is now accessible (not chrome-extension://)
          const url = tab.url || this.state.tabUrl;
          if (url && !this.isRestrictedUrl(url)) {
            console.log('[Background] Tab load complete, re-attaching debugger to:', url);
            try {
              await this.cdp.attach(tabId);
              this.state.temporarilyDetached = false;
              console.log('[Background] Debugger re-attached successfully');

              // Update stored title
              this.state.originalTabTitle = tab.title.startsWith('🟢 [MCP] ')
                ? tab.title.replace('🟢 [MCP] ', '')
                : tab.title;

              // Re-inject indicators and background capture
              await this.updateTabTitle();
              await this.injectTabIndicator();
              await this.injectBackgroundCapture();
            } catch (error) {
              console.error('[Background] Failed to re-attach debugger:', error);
              // If re-attachment fails, stay in temporary detachment but keep WebSocket connected
              if (error.message && error.message.includes('restricted URL')) {
                console.log('[Background] Cannot reattach to restricted URL, staying in temporary detachment');
              } else {
                console.error('[Background] Reattachment failed - keeping WebSocket connected without attached tab');
                this.state.temporarilyDetached = true;
              }
            }
          } else {
            console.log('[Background] Tab still on restricted URL, not reattaching yet:', url);
          }
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
        // Only if debugger is attached (indicators require CDP)
        if (changeInfo.status === 'complete' && this.state.connected && this.cdp.isAttached()) {
          this.injectTabIndicator();
          this.injectBackgroundCapture(); // Always re-inject background capture on navigation

          // Re-inject overlay and content script if there's an active recording
          if (this.currentRecordingRequest) {
            const sessionId = this.currentRecordingRequest.sessionId;
            const session = this.recordingSessions.get(sessionId);
            if (session) {
              console.log('[Background] Re-injecting overlay and content script after navigation');

              // Re-inject overlay first (with annotation tool alongside — both
              // load into the same isolated world, recording-overlay exposes
              // window.RecordingOverlay, annotation-tool exposes window.AnnotationTool)
              chrome.scripting.executeScript({
                target: { tabId: this.state.tabId },
                files: ['recording-overlay.js', 'annotation-tool.js']
              }).then(() => {
                // Restore the overlay with its current state
                const overlayState = {
                  state: this.currentRecordingRequest.state === 'active' ? 'recording' : 'waiting',
                  actionCount: this.currentRecordingRequest.actionCount || 0,
                  startTime: session.recordingStartTime || null,
                  position: { x: null, y: null }
                };

                chrome.scripting.executeScript({
                  target: { tabId: this.state.tabId },
                  func: (sessionId, request, state) => {
                    if (window.RecordingOverlay) {
                      window.mcpRecordingOverlay = new window.RecordingOverlay(sessionId, request, state);
                    }
                  },
                  args: [sessionId, session.request, overlayState]
                });
              }).catch(err => {
                console.error('[Background] Failed to re-inject overlay:', err);
              });

              // Re-inject content script if recording is active
              if (this.currentRecordingRequest.state === 'active') {
                chrome.scripting.executeScript({
                  target: { tabId: this.state.tabId },
                  files: ['content-script.js']
                }).then(() => {
                  // Wait a bit then send start message
                  setTimeout(() => {
                    chrome.scripting.executeScript({
                      target: { tabId: this.state.tabId },
                      func: (sessionId, request) => {
                        window.postMessage({
                          type: 'START_RECORDING',
                          data: { sessionId, request }
                        }, '*');
                      },
                      args: [sessionId, session.request]
                    });
                  }, 100);
                }).catch(err => {
                  console.error('[Background] Failed to re-inject content script:', err);
                });
              }
            }
          }
        }
      }

      // Re-inject session recorder scripts on navigation for any session-recorded tab
      if (changeInfo.status === 'complete' && this.sessionRecording?.tabIds?.includes(tabId)) {
        console.log('[Background] Re-injecting session recorder after navigation:', tab.url);
        // MAIN world first (bypasses CSP, must precede isolated world injection)
        // allFrames: true injects into all loaded frames; child frames that load later
        // are handled by the webNavigation.onCompleted listener.
        chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          files: ['lib/network-interceptor.js']
        }).catch(err => {
          console.warn('[Background] Could not re-inject network interceptor:', err.message);
        });
        chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          files: ['lib/rrweb-record.min.js', 'session-recorder.js']
        }).catch(err => {
          console.warn('[Background] Could not re-inject session recorder:', err.message);
        });

        // Re-inject the annotation tool + floating "Recording / ✏️ Annotate"
        // overlay on the primary tab only. Without this the pill vanishes on
        // page reload (reported by ben 2026-06-10): network/rrweb keep working
        // but the user has no UI affordance to add new annotations until the
        // recording is stopped.
        // ⛔ Not for auto-started recordings — the pill intercepts page clicks.
        // See the long note at the injection site in handleStartSessionRecording.
        if (tabId === this.sessionRecording.tabId && !this.sessionRecording.autoStarted) {
          chrome.scripting.executeScript({
            target: { tabId },
            files: ['annotation-tool.js', 'session-record-overlay.js'],
          }).catch(err => {
            console.warn('[Background] Could not re-inject session overlay/annotation:', err.message);
          });
        }

        // Start video for this tab if it hasn't been recorded yet.
        // ⚠️ MUST honour autoStarted here too, not just at session start. This
        // fires on every navigation of a recorded tab, so without the check an
        // auto-started (deliberately DOM-only) session would silently acquire
        // video the first time any page navigated — quietly reintroducing the
        // exact always-on capture ben asked not to have.
        if (!this.sessionRecording.recordedTabIds?.includes(tabId) &&
            (!this.sessionRecording.autoStarted || SESSION_AUTO_CAPTURE_VIDEO)) {
          this.startSessionTabVideo(tabId);
        }
      }

      // Reattach dead TabManager CDPs when the page finishes loading
      // Handles navigation/reload detachments for multi-tab sessions
      if (changeInfo.status === 'complete' && tabId !== this.state.tabId) {
        const tmInfo = this.tabManager.attachedTabs.get(tabId);
        if (tmInfo && tmInfo.cdp && !tmInfo.cdp.isAttached()) {
          const url = tab.url;
          if (url && !this.isRestrictedUrl(url)) {
            console.log(`[Background] TabManager tab ${tabId} page loaded, reattaching CDP...`);
            tmInfo.cdp.attach(tabId).then(() => {
              tmInfo.url = url;
              tmInfo.title = tab.title;
              tmInfo.lastUsedAt = Date.now();
              console.log(`[Background] TabManager tab ${tabId} reattached after navigation`);
              this.injectBackgroundCapture(tabId).catch(() => {});
            }).catch(err => {
              console.error(`[Background] TabManager tab ${tabId} reattach failed on page load:`, err.message);
            });
          }
        }
      }
    });

    // New tab opened — extend session recording to tabs opened from a recorded tab
    chrome.tabs.onCreated.addListener((tab) => {
      if (!this.sessionRecording) return;
      if (tab.openerTabId && this.sessionRecording.tabIds?.includes(tab.openerTabId)) {
        if (!this.sessionRecording.tabIds.includes(tab.id)) {
          this.sessionRecording.tabIds.push(tab.id);
          console.log(`[Background] Session recording extended to new tab ${tab.id} (opened from ${tab.openerTabId})`);
          // Injection happens in tabs.onUpdated when the tab finishes loading
        }
      }
    });

    // Debugger detached
    chrome.debugger.onDetach.addListener(async (source, reason) => {
      if (source.tabId === this.state.tabId) {
        console.log('[Background] Debugger detached:', reason);

        // For 'target_closed', verify if the tab actually still exists
        // CDP can report 'target_closed' for many reasons besides actual tab closure:
        // - Page navigation within the same tab
        // - Frame destruction during page updates
        // - Dynamic content loading that creates/destroys frames
        // - Security-triggered detachments
        // - Redirects or error pages
        if (reason === 'target_closed') {
          try {
            const tab = await chrome.tabs.get(source.tabId);
            if (tab) {
              // Tab still exists! This is a temporary detachment, not actual closure
              console.log('[Background] Tab still exists despite target_closed event - treating as temporary detachment');
              console.log('[Background] Tab URL:', tab.url);

              // Treat as temporary detachment
              this.state.temporarilyDetached = true;
              this.cdp.target = null;
              this.cdp.isDetaching = false;
              this.cdp.enabledDomains.clear();

              // Attempt to reattach with retry logic to handle other extensions
              console.log('[Background] Will attempt to reattach to tab...');
              this.attemptReattachWithRetry(source.tabId, 0);

              return; // Don't disconnect
            }
          } catch (error) {
            // Tab doesn't exist - this is a real closure
            console.log('[Background] Tab no longer exists - confirming permanent detachment');
          }
        }

        // Handle other permanent reasons or confirmed tab closure
        const permanentReasons = ['canceled_by_user'];

        if (permanentReasons.includes(reason)) {
          // Only disconnect on explicit user cancellation
          console.log('[Background] User canceled debugger, disconnecting completely');
          this.disconnect();
        } else if (reason === 'target_closed') {
          // Tab closed - keep WebSocket connected
          console.log('[Background] Tab closed - keeping WebSocket connected without attached tab');
          this.state.temporarilyDetached = true;
          this.cdp.target = null;
          this.cdp.isDetaching = false;
          this.cdp.enabledDomains.clear();
        } else {
          // Temporary detachment (e.g., navigation to chrome-extension:// URL)
          console.log('[Background] Temporary detachment, keeping connection state');
          this.state.temporarilyDetached = true;

          // Mark CDP as detached but keep state
          this.cdp.target = null;
          this.cdp.isDetaching = false;
          this.cdp.enabledDomains.clear();

          // Note: Tab navigation listener will attempt to re-attach when tab returns to normal URL
          console.log('[Background] Waiting for tab to navigate back to re-attach...');
        }
      }

      // Handle detach for TabManager multi-tab attachments
      // Guard: skip if the CDPHelper is mid-attach (pre-emptive detach fires a spurious onDetach)
      const tmInfo = this.tabManager.attachedTabs.get(source.tabId);
      if (tmInfo && tmInfo.cdp && !tmInfo.cdp.isAttaching) {
        console.log(`[Background] TabManager tab ${source.tabId} detached (${reason}), scheduling reattach...`);
        tmInfo.cdp.target = null;
        tmInfo.cdp.isDetaching = false;
        tmInfo.cdp.enabledDomains.clear();
        if (reason !== 'canceled_by_user') {
          this._attemptTabManagerReattach(source.tabId, tmInfo, 0);
        }
      }
    });

    // Messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Handle offscreen document ready signal
      if (message.type === 'OFFSCREEN_READY') {
        console.log('[Background] Offscreen document ready');
        offscreenReady = true;
        return false;
      }

      // The seed content script handing us the launcher's stable, per-profile
      // extensionId. It arrives AFTER ensureExtensionId() may already have
      // minted one (the SW starts before the first tab loads), so this has to
      // be able to overwrite a freshly-minted id — otherwise the mint always
      // wins the race and the identity rotates on every relaunch anyway.
      if (message.type === 'ADOPT_EXTENSION_ID') {
        (async () => {
          try {
            const id = message.extensionId;
            if (!id || id === self.__unibrowseExtensionId) {
              sendResponse({ ok: true, unchanged: true });
              return;
            }
            const prev = self.__unibrowseExtensionId;
            await chrome.storage.local.set({ __unibrowseExtensionId: id });
            self.__unibrowseExtensionId = id;
            _extIdPromise = Promise.resolve(id);
            console.log(`[Background] adopted stable extensionId ${id} (was ${prev || 'unset'})`);
            // Re-register under the adopted id, so the server does not keep
            // the throwaway one this session minted a moment ago.
            try { await this.ws.disconnect(); } catch {}
            try { await this.ws.connect(); } catch {}
            sendResponse({ ok: true, extensionId: id, previous: prev || null });
          } catch (err) {
            sendResponse({ ok: false, error: err?.message || String(err) });
          }
        })();
        return true; // async response
      }

      // Options page asked us to re-resolve server config and reconnect
      // Authoritative identity query for the offscreen document.
      //
      // ⛔ THE RACE THIS KILLS: offscreen used to read chrome.storage.local
      // itself and, on coming up empty, register as `conn.wsId` — which is the
      // literal string "default". So whether a browser registered as its real
      // stable id or as "default" depended on who won a race between the
      // service worker's first storage write and the offscreen's first
      // connect. Ben's desktop Chrome alternated between `ext_018237f9…` and
      // `default` across reloads for exactly this reason, which means every
      // agent holding the previous id was silently pointing at nothing.
      //
      // ensureExtensionId() is a memoised singleton, so awaiting it here is
      // authoritative and cheap: it returns the SAME id the SW already
      // resolved, or completes the one round-trip in flight.
      if (message.type === 'GET_EXTENSION_ID') {
        (async () => {
          try {
            const id = await ensureExtensionId();
            sendResponse({ ok: true, extensionId: id });
          } catch (err) {
            sendResponse({ ok: false, error: err?.message || String(err) });
          }
        })();
        return true; // async response
      }

      if (message.type === 'RECONNECT_WS') {
        (async () => {
          try {
            console.log('[Background] RECONNECT_WS — disconnecting and re-resolving server config');
            try { await this.ws.disconnect(); } catch {}
            this.serverConfig = await resolveServerConfig();
            this.ws.url = this.serverConfig.wsUrl;
            console.log(`[Background] New server URL: ${this.ws.url.replace(/key=[^&]+/, 'key=***')} (source: ${this.serverConfig.source})`);
            await this.ws.connect();
            sendResponse({ success: true, source: this.serverConfig.source, httpUrl: this.serverConfig.httpUrl });
          } catch (err) {
            sendResponse({ success: false, error: err?.message || String(err) });
          }
        })();
        return true; // async response
      }

      // Popup asked us to ensure a WebSocket connection exists for a given
      // tab's bound server. Spins up a pool entry if not already open, so the
      // bound server can drive that tab over its own connection.
      if (message.type === 'ENSURE_SERVER_WS') {
        (async () => {
          try {
            const tabId = message.tabId;
            if (tabId == null) throw new Error('tabId required');
            const cfg = await getServerForTab(tabId);
            const result = await this.ensureWsForServer(cfg);
            sendResponse({ success: true, ...result });
          } catch (err) {
            sendResponse({ success: false, error: err?.message || String(err) });
          }
        })();
        return true;
      }

      // Handle WebSocket messages from offscreen document. The wsId field
      // tells us which pool connection delivered the message; we thread it
      // through so responses go back the same way.
      if (message.type === 'WS_MESSAGE') {
        const originWsId = message.wsId || 'default';
        console.log(`[Background] WS_MESSAGE from offscreen (wsId=${originWsId}):`, message.message?.type);
        this.handleMCPMessage(message.message, originWsId);
        return false;
      }

      // Handle background interaction capture
      // Always accept interactions, even when not connected, so we don't lose data
      if (message.type === 'BACKGROUND_INTERACTION') {
        this.backgroundRecorder.addAction(message.interaction);
        return false; // Synchronous response - no need to keep channel open
      }

      // Session recording event accumulation (from session-recorder.js content script)
      if (this.sessionRecording && this.sessionRecording.tabIds?.includes(sender?.tab?.id)) {
        if (message.type === 'SR_RRWEB') {
          this.sessionRecording.rrwebEvents.push(message.event);
          this._trimSessionBuffers();
          return false;
        }
        if (message.type === 'SR_NETWORK') {
          this.sessionRecording.networkEntries.push({
            ...message.entry,
            frameId: sender.frameId || 0,
          });
          this._trimSessionBuffers();
          return false;
        }
        if (message.type === 'SR_PAGE_START') {
          this.sessionRecording.pages.push({
            url: message.url,
            title: message.title,
            startTime: message.timestamp,
            tabId: sender.tab.id,
            frameId: sender.frameId || 0,
            isFrame: message.isFrame || false,
            referrer: message.referrer || null,
            viewport: message.viewport || null,
            screen: message.screen || null,
            language: message.language || null,
            timezone: message.timezone || null,
            userAgent: message.userAgent || null,
            performance: message.performance || null,
          });
          return false;
        }
        if (message.type === 'SR_PAGE_END') {
          const lastPage = this.sessionRecording.pages[this.sessionRecording.pages.length - 1];
          if (lastPage && !lastPage.endTime) lastPage.endTime = message.timestamp;
          return false;
        }
        if (message.type === 'SR_INTERACTION') {
          this.sessionRecording.interactions.push({
            ...message.interaction,
            tabId: sender.tab.id,
            frameId: sender.frameId || 0,
          });
          return false;
        }
        if (message.type === 'SR_ANNOTATION_CREATE') {
          // Async: capture viewport screenshot, crop to bbox, persist into the
          // active sessionRecording. Reply with {success, annotationId} so
          // the overlay can flash a success state.
          (async () => {
            try {
              const annotationId = `ann-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
              const p = message.payload || {};
              const tabId = sender.tab?.id;
              const windowId = sender.tab?.windowId;
              let screenshotDataUrl = null;
              try {
                screenshotDataUrl = await new Promise((resolve, reject) => {
                  chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
                    const err = chrome.runtime.lastError;
                    if (err) return reject(err);
                    resolve(dataUrl);
                  });
                });
              } catch (capErr) {
                console.warn('[Background] captureVisibleTab failed for annotation:', capErr?.message || capErr);
              }
              // Crop to bbox via OffscreenCanvas, preserving viewport DPR.
              let croppedDataUrl = screenshotDataUrl;
              if (screenshotDataUrl && p.bbox && p.viewport) {
                try {
                  const img = await fetch(screenshotDataUrl).then(r => r.blob()).then(b => createImageBitmap(b));
                  // captureVisibleTab returns a screenshot at the viewport's
                  // actual pixel resolution (img.width × img.height). Map our
                  // CSS-pixel bbox to image pixels.
                  const sx = img.width / p.viewport.width;
                  const sy = img.height / p.viewport.height;
                  const cx = Math.max(0, Math.floor(p.bbox.x * sx));
                  const cy = Math.max(0, Math.floor(p.bbox.y * sy));
                  const cw = Math.max(1, Math.floor(p.bbox.w * sx));
                  const ch = Math.max(1, Math.floor(p.bbox.h * sy));
                  const canvas = new OffscreenCanvas(cw, ch);
                  const ctx = canvas.getContext('2d');
                  ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
                  const blob = await canvas.convertToBlob({ type: 'image/png' });
                  croppedDataUrl = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                  });
                } catch (cropErr) {
                  console.warn('[Background] Annotation screenshot crop failed:', cropErr?.message || cropErr);
                }
              }
              const annotation = {
                id: annotationId,
                timestamp: p.timestamp || Date.now(),
                tabId,
                tool: p.tool || 'pencil',
                shape: p.shape || null,
                bbox: p.bbox || null,
                viewport: p.viewport || null,
                domTargets: p.domTargets || [],
                note: p.note || '',
                pageUrl: p.pageUrl || null,
                pageTitle: p.pageTitle || null,
                screenshotPng: croppedDataUrl || null,
                fullViewportPng: screenshotDataUrl || null,
              };
              this.sessionRecording.annotations.push(annotation);
              console.log(`[Background] Annotation ${annotationId} captured (${annotation.tool}, note=${(annotation.note || '').slice(0, 40)})`);
              sendResponse({ success: true, annotationId });
            } catch (e) {
              console.error('[Background] SR_ANNOTATION_CREATE failed:', e);
              sendResponse({ success: false, error: e?.message || String(e) });
            }
          })();
          return true; // async response
        }
      }

      // Only handle popup-specific messages here
      const popupMessages = ['connect', 'disconnect', 'get_state', 'ensure_attached', 'list_attached_tabs', 'set_tab_label', 'detach_tab', 'start_session_recording', 'stop_session_recording', 'get_session_recording_state'];
      if (popupMessages.includes(message.type)) {
        this.handlePopupMessage(message, sendResponse);
        return true; // Keep channel open for async response
      }
      // Let other listeners handle recording messages
      return false;
    });

    // Console/error collection + page navigation events across ALL attached tabs
    chrome.debugger.onEvent.addListener(async (source, method, params) => {
      const isLegacyTab = source.tabId === this.state.tabId;
      const tmTab = this.tabManager?.attachedTabs?.get(source.tabId);
      if (!isLegacyTab && !tmTab) return; // not one of our tabs

      const tabLabel = tmTab?.label || null;

      if (method === 'Console.messageAdded') {
        this.consoleLogs.push({
          level: params.message.level,
          text: params.message.text,
          url: params.message.url || null,
          line: params.message.line || null,
          timestamp: Date.now(),
          tabId: source.tabId,
          tabLabel,
          source: 'page',
        });
        if (this.consoleLogs.length > 500) this.consoleLogs.shift();
      }

      if (method === 'Log.entryAdded') {
        const entry = params.entry;
        this.consoleLogs.push({
          level: entry.level,
          text: entry.text,
          url: entry.url || null,
          timestamp: Date.now(),
          tabId: source.tabId,
          tabLabel,
          source: 'page',
        });
        if (this.consoleLogs.length > 500) this.consoleLogs.shift();
      }

      if (method === 'Runtime.exceptionThrown') {
        const ex = params.exceptionDetails;
        this.consoleLogs.push({
          level: 'error',
          text: ex.exception?.description || ex.text || 'Uncaught exception',
          url: ex.url || null,
          line: ex.lineNumber || null,
          timestamp: Date.now(),
          tabId: source.tabId,
          tabLabel,
          source: 'page',
        });
        if (this.consoleLogs.length > 500) this.consoleLogs.shift();
      }

      if (!isLegacyTab) return; // remaining handlers below are legacy-tab-only

      // Page navigation events - track navigations to prevent disconnection
      if (method === 'Page.frameNavigated' && params.frame.parentId === undefined) {
        // Main frame navigated
        console.log('[Background] Main frame navigated to:', params.frame.url);
        this.state.tabUrl = params.frame.url;

        // Check if we need to reattach after navigation to restricted URL
        if (this.state.temporarilyDetached) {
          if (!this.isRestrictedUrl(params.frame.url)) {
            console.log('[Background] Navigation returned from restricted URL, will reattach...');
            // Wait a bit for page to stabilize before reattaching
            setTimeout(async () => {
              try {
                if (this.state.temporarilyDetached && this.state.connected) {
                  await this.cdp.attach(this.state.tabId);
                  this.state.temporarilyDetached = false;
                  console.log('[Background] Debugger re-attached after navigation');

                  // Get current tab and update title
                  const tab = await chrome.tabs.get(this.state.tabId);
                  this.state.originalTabTitle = tab.title.startsWith('🟢 [MCP] ')
                    ? tab.title.replace('🟢 [MCP] ', '')
                    : tab.title;

                  // Re-inject indicators
                  await this.updateTabTitle();
                  await this.injectTabIndicator();
                  await this.injectBackgroundCapture();
                }
              } catch (error) {
                console.error('[Background] Failed to reattach after navigation:', error);
              }
            }, 500);
          }
        }
      }

      if (method === 'Page.loadEventFired') {
        console.log('[Background] Page load completed');
      }

      // Network events (for network log collection)
      // Cap at NETWORK_LOG_MAX entries (ring buffer) so a long-lived session
      // doesn't accumulate megabytes of stale entries — used to be unbounded
      // (ha bug #4). Per-entry tabId+tabLabel let handleGetNetworkLogs filter
      // to a single tab instead of leaking cross-tab traffic.
      if (method === 'Network.requestWillBeSent') {
        this.networkLogs.push({
          type: 'request',
          tabId: source.tabId,
          tabLabel,
          requestId: params.requestId,
          url: params.request.url,
          method: params.request.method,
          headers: params.request.headers,
          timestamp: Date.now()
        });
        const NETWORK_LOG_MAX = 1000;
        if (this.networkLogs.length > NETWORK_LOG_MAX) {
          this.networkLogs.splice(0, this.networkLogs.length - NETWORK_LOG_MAX);
        }
      }

      if (method === 'Network.responseReceived') {
        // Find the matching request and add response info
        const request = this.networkLogs.find(
          log => log.requestId === params.requestId && log.type === 'request'
        );
        if (request) {
          request.response = {
            status: params.response.status,
            statusText: params.response.statusText,
            headers: params.response.headers,
            mimeType: params.response.mimeType
          };
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

    // Connection/Attachment handlers
    this.handlers['browser_ensure_attached'] = this.handleEnsureAttached.bind(this);
    this.handlers['browser_reserve_tab'] = this.handleReserveTab.bind(this);
    this.handlers['browser_release_tab'] = this.handleReleaseTab.bind(this);

    // Navigation handlers
    this.handlers['browser_navigate'] = this.handleNavigate.bind(this);
    this.handlers['browser_go_back'] = this.handleGoBack.bind(this);
    this.handlers['browser_go_forward'] = this.handleGoForward.bind(this);
    this.handlers['browser_wait'] = this.handleWait.bind(this);

    // Navigation observer — buffer per-tab webNavigation.onCommitted events
    // matching a regex pattern. Used by routine macros via ctx.observeNavigations
    // for transient-redirect capture (e.g. OAuth callback URLs that bounce
    // through faster than a polling waitForUrl can catch).
    this.navObservers = new Map(); // subId -> {regex, tabId, matches:[], pendingResolvers:[]}
    this._navObserverListener = (details) => {
      if (details.frameId !== 0) return; // top frame only
      for (const [subId, sub] of this.navObservers) {
        if (sub.tabId != null && sub.tabId !== details.tabId) continue;
        if (!sub.regex.test(details.url)) continue;
        const match = { url: details.url, timestamp: Date.now(), transitionType: details.transitionType };
        sub.matches.push(match);
        // Wake any waiter currently in `first()`.
        const resolvers = sub.pendingResolvers.splice(0);
        for (const r of resolvers) r(match);
      }
    };
    chrome.webNavigation.onCommitted.addListener(this._navObserverListener);
    this.handlers['browser_observe_navigations_start'] = this.handleObserveNavStart.bind(this);
    this.handlers['browser_observe_navigations_first'] = this.handleObserveNavFirst.bind(this);
    this.handlers['browser_observe_navigations_dispose'] = this.handleObserveNavDispose.bind(this);

    // Interaction handlers
    this.handlers['browser_click'] = this.handleClick.bind(this);
    this.handlers['browser_type'] = this.handleType.bind(this);
    this.handlers['browser_hover'] = this.handleHover.bind(this);
    this.handlers['browser_drag'] = this.handleDrag.bind(this);
    this.handlers['browser_select_option'] = this.handleSelectOption.bind(this);
    this.handlers['browser_press_key'] = this.handlePressKey.bind(this);
    this.handlers['browser_scroll'] = this.handleScroll.bind(this);
    this.handlers['browser_scroll_to_element'] = this.handleScrollToElement.bind(this);
    this.handlers['browser_set_device_metrics'] = this.handleSetDeviceMetrics.bind(this);
    this.handlers['browser_set_file_input'] = this.handleSetFileInput.bind(this);

    // Realistic input handlers (CDP-based)
    this.handlers['browser_realistic_mouse_move'] = this.handleRealisticMouseMove.bind(this);
    this.handlers['browser_realistic_click'] = this.handleRealisticClick.bind(this);
    this.handlers['browser_realistic_type'] = this.handleRealisticType.bind(this);

    // Video recording handlers (agent-driven tab capture)
    this.handlers['browser_start_video_recording'] = this.handleStartVideoRecording.bind(this);
    this.handlers['browser_stop_video_recording'] = this.handleStopVideoRecording.bind(this);

    // Session recording handlers (rrweb + network + video)
    this.handlers['browser_start_session_recording'] = async (params) => {
      return new Promise((resolve) => this.handleStartSessionRecording(resolve, params || {}));
    };
    this.handlers['browser_stop_session_recording'] = async (params) => {
      return new Promise((resolve) => this.handleStopSessionRecording(resolve, params || {}));
    };
    this.handlers['browser_get_session_recording_state'] = async (params) => {
      // Mirror the popup's get_session_recording_state shape so agents can
      // query "am I recording? on which tab? for how long?" without having
      // to start/stop or poll storage themselves.
      if (!this.sessionRecording) {
        return { isRecording: false };
      }
      const r = this.sessionRecording;
      return {
        isRecording: true,
        sessionId: r.sessionId,
        startedAt: r.startTime,
        elapsedMs: Date.now() - r.startTime,
        primaryTabId: r.tabId,
        recordedTabIds: r.recordedTabIds || [],
        startUrl: r.startUrl,
        rrwebEventCount: (r.rrwebEvents || []).length,
        networkEntryCount: (r.networkEntries || []).length,
        interactionCount: (r.interactions || []).length,
        annotationCount: (r.annotations || []).length,
        pageCount: (r.pages || []).length,
      };
    };

    // Tab management handlers
    this.handlers['browser_list_tabs'] = this.handleListTabs.bind(this);
    this.handlers['browser_switch_tab'] = this.handleSwitchTab.bind(this);
    this.handlers['browser_create_tab'] = this.handleCreateTab.bind(this);
    this.handlers['browser_close_tab'] = this.handleCloseTab.bind(this);
    this.handlers['browser_create_window'] = this.handleCreateWindow.bind(this);

    // Multi-tab management handlers (NEW)
    this.handlers['browser_list_attached_tabs'] = this.handleListAttachedTabs.bind(this);
    this.handlers['browser_set_tab_label'] = this.handleSetTabLabel.bind(this);
    this.handlers['browser_detach_tab'] = this.handleDetachTab.bind(this);
    this.handlers['browser_get_active_tab'] = this.handleGetActiveTab.bind(this);

    // Form handlers
    this.handlers['browser_fill_form'] = this.handleFillForm.bind(this);
    this.handlers['browser_submit_form'] = this.handleSubmitForm.bind(this);

    // Information handlers
    this.handlers['browser_snapshot'] = this.handleSnapshot.bind(this);
    this.handlers['browser_screenshot'] = this.handleScreenshot.bind(this);
    this.handlers['browser_segmented_screenshot'] = this.handleSegmentedScreenshot.bind(this);
    this.handlers['browser_get_console_logs'] = this.handleGetConsoleLogs.bind(this);
    this.handlers['browser_get_errors'] = this.handleGetErrors.bind(this);
    this.handlers['browser_reload_extension'] = this.handleReloadExtension.bind(this);
    this.handlers['browser_get_network_logs'] = this.handleGetNetworkLogs.bind(this);
    this.handlers['browser_evaluate'] = this.handleEvaluate.bind(this);
    this.handlers['browser_list_frames'] = this.handleListFrames.bind(this);
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

    // Recording/Learning handlers
    this.handlers['browser_request_user_action'] = this.handleRequestUserAction.bind(this);

    // Background interaction log handlers
    this.handlers['browser_get_interactions'] = this.handleGetInteractions.bind(this);
    this.handlers['browser_prune_interactions'] = this.handlePruneInteractions.bind(this);
    this.handlers['browser_search_interactions'] = this.handleSearchInteractions.bind(this);

    // Cookie management handlers
    this.handlers['browser_get_cookies'] = this.handleGetCookies.bind(this);
    this.handlers['browser_set_cookie'] = this.handleSetCookie.bind(this);
    this.handlers['browser_delete_cookie'] = this.handleDeleteCookie.bind(this);
    this.handlers['browser_clear_cookies'] = this.handleClearCookies.bind(this);

    // Download management handlers
    this.handlers['browser_download_file'] = this.handleDownloadFile.bind(this);
    this.handlers['browser_get_downloads'] = this.handleGetDownloads.bind(this);
    this.handlers['browser_cancel_download'] = this.handleCancelDownload.bind(this);
    this.handlers['browser_open_download'] = this.handleOpenDownload.bind(this);

    // Clipboard handlers
    this.handlers['browser_get_clipboard'] = this.handleGetClipboard.bind(this);
    this.handlers['browser_set_clipboard'] = this.handleSetClipboard.bind(this);

    // History handlers
    this.handlers['browser_search_history'] = this.handleSearchHistory.bind(this);
    this.handlers['browser_get_history_visits'] = this.handleGetHistoryVisits.bind(this);
    this.handlers['browser_delete_history'] = this.handleDeleteHistory.bind(this);
    this.handlers['browser_clear_history'] = this.handleClearHistory.bind(this);

    // System information handlers
    this.handlers['browser_get_version'] = this.handleGetVersion.bind(this);
    this.handlers['browser_get_system_info'] = this.handleGetSystemInfo.bind(this);
    this.handlers['browser_get_browser_info'] = this.handleGetBrowserInfo.bind(this);

    // Network handlers
    this.handlers['browser_get_network_state'] = this.handleGetNetworkState.bind(this);
    this.handlers['browser_set_network_conditions'] = this.handleSetNetworkConditions.bind(this);
    this.handlers['browser_clear_cache'] = this.handleClearCache.bind(this);

    // Bookmark handlers
    this.handlers['browser_get_bookmarks'] = this.handleGetBookmarks.bind(this);
    this.handlers['browser_create_bookmark'] = this.handleCreateBookmark.bind(this);
    this.handlers['browser_delete_bookmark'] = this.handleDeleteBookmark.bind(this);
    this.handlers['browser_search_bookmarks'] = this.handleSearchBookmarks.bind(this);

    // Extension management handlers
    this.handlers['browser_list_extensions'] = this.handleListExtensions.bind(this);
    this.handlers['browser_get_extension_info'] = this.handleGetExtensionInfo.bind(this);
    this.handlers['browser_enable_extension'] = this.handleEnableExtension.bind(this);
    this.handlers['browser_disable_extension'] = this.handleDisableExtension.bind(this);

    console.log('[Background] Registered', Object.keys(this.handlers).length, 'handlers');
  }

  /**
   * Connect to MCP server via WebSocket
   * Debugger attachment is deferred until first tool use (lazy attachment)
   */
  async connect() {
    try {
      console.log('[Background] Connecting to MCP server...');
      // Make sure the extensionId is loaded from chrome.storage BEFORE we
      // initiate the WebSocket connect — the OFFSCREEN_CONNECT message carries
      // it through to the offscreen document so the EXTENSION_REGISTER frame
      // has the right id from the very first round-trip.
      try { await ensureExtensionId(); } catch {}

      // chromium-host sidecar bootstrap: scan open tabs for a
      // /__unibrowse_seed?ws=…&http=…&key=… URL. The chromium-host service
      // opens this URL as the first tab of every new chromium specifically
      // so we can discover where to connect. We do this in background.js
      // (not just via the content script) because in headful mode the seed
      // tab can finish loading BEFORE the extension is ready to attach
      // content scripts, so the content-script path silently no-ops. This
      // tab-scan path is the deterministic backstop.
      try {
        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
          if (!t.url) continue;
          const m = t.url.match(/\/__unibrowse_seed\?(.+)$/);
          if (!m) continue;
          const params = new URLSearchParams(m[1]);
          const wsUrl = params.get('ws');
          const httpUrl = params.get('http');
          const apiKey = params.get('key') || '';
          if (!wsUrl) continue;
          const existing = await chrome.storage.local.get(['unibrowse_server_config']);
          if (existing.unibrowse_server_config?.WS_URL) break;
          await chrome.storage.local.set({
            unibrowse_server_config: {
              SERVER_URL: httpUrl || '',
              WS_URL: wsUrl,
              API_KEY: apiKey,
            },
          });
          console.log(`[Background] Picked up sidecar seed from tab ${t.id}: ${wsUrl}`);
          break;
        }
      } catch (e) {
        // Tabs query can fail during very early SW startup; non-fatal.
      }

      // Resolve the active server URL (storage override → baked config → localhost)
      // before kicking off the WebSocket. URL carries ?key=<api_key> when set.
      try {
        this.serverConfig = await resolveServerConfig();
        this.ws.url = this.serverConfig.wsUrl;
        console.log(`[Background] Server config resolved (${this.serverConfig.source}): ${this.serverConfig.httpUrl} → ${this.ws.url.replace(/key=[^&]+/, 'key=***')}`);
      } catch (err) {
        console.warn('[Background] resolveServerConfig failed, falling back to ws://localhost:9010/ws:', err?.message || err);
        this.ws.url = 'ws://localhost:9010/ws';
        this.serverConfig = { httpUrl: 'http://localhost:9010', wsUrl: 'ws://localhost:9010/ws', apiKey: '', source: 'fallback' };
      }

      // Connect WebSocket (no debugger attachment yet - lazy attachment).
      // Don't await — the offscreen doc's auto-reconnect handles server unavailability.
      // Explicitly catch so a rejected promise doesn't surface as an unhandled rejection.
      this.ws.connect().catch(err => {
        console.warn('[Background] Initial WebSocket connect attempt failed (auto-reconnect will retry):', err.message);
      });

      // Update state - connected now means WebSocket connected
      // Debugger will be attached on-demand via ensureAttached()
      this.state.connected = true;
      chrome.storage.session.set({ swShouldReconnect: true });
      chrome.alarms.create('sw-keepalive', { periodInMinutes: 0.5 });
      this.consoleLogs = [];
      this.networkLogs = [];

      this.updateConnectionState();

      // Start keepalive mechanism to maintain debugger connection
      this.startKeepalive();

      console.log('[Background] Connected to MCP server (WebSocket only, debugger will attach on first tool use)');

      return { success: true, message: 'Connected to MCP server. Debugger will attach on first tool use.' };
    } catch (error) {
      console.error('[Background] Connection failed:', error);
      await this.disconnect();
      throw error;
    }
  }

  /**
   * Ensure a WebSocket connection exists for the given server config and
   * return it (creating a new pool entry on demand). Used by ENSURE_SERVER_WS
   * so a tab bound to a non-default server gets its own WS opened transparently.
   * The default server's WS lives at this.ws / serverPool.get('default') and
   * never goes through this helper.
   */
  async ensureWsForServer(serverCfg) {
    const id = serverCfg?.id || 'default';
    if (id === 'default') {
      return { wsId: 'default', already: true };
    }
    const existing = this.serverPool.get(id);
    if (existing) {
      const state = await existing.getState().catch(() => 'unknown');
      return { wsId: id, already: true, state };
    }
    console.log(`[Background] Spinning up pool WS for server ${id} → ${(serverCfg.wsUrl || '').replace(/key=[^&]+/, 'key=***')}`);
    const mgr = new WebSocketManager(serverCfg.wsUrl, { wsId: id });
    this.serverPool.set(id, mgr);
    try {
      await mgr.connect();
    } catch (err) {
      console.warn(`[Background] Initial pool connect for ${id} deferred (auto-reconnect will retry):`, err?.message || err);
    }
    return { wsId: id, already: false };
  }

  /**
   * Disconnect from MCP server and detach debugger
   */
  async disconnect() {
    console.log('[Background] Disconnecting...');
    console.log('[Background] Current state:', {
      tabId: this.state.tabId,
      connected: this.state.connected,
      cdpAttached: this.cdp.isAttached()
    });

    // Set connected to false FIRST to prevent event listeners from re-adding indicators
    this.state.connected = false;
    chrome.storage.session.set({ swShouldReconnect: false });
    // INTENTIONALLY do NOT clear the 'sw-keepalive' alarm here. The alarm
    // handler already checks `swShouldReconnect` and skips the reconnect when
    // false (see chrome.alarms.onAlarm listener below). Keeping the alarm
    // running is the ONLY mechanism that wakes a dormant MV3 SW periodically;
    // clearing it means the SW goes dormant after explicit disconnect and
    // never wakes itself again — the user has to bounce the extension by
    // hand. Diagnosed 2026-06-14 after ben's main Chrome got stuck dormant
    // post-yesterday's reload cascade.

    // Stop keepalive mechanism
    this.stopKeepalive();

    // Clean up ALL tabs (not just the active one)
    // This handles cases where indicators were left behind after crashes
    await this.removeAllTabPrefixes();
    await this.removeAllTabIndicators();

    this.ws.disconnect();
    await this.cdp.detach();

    this.state.tabId = null;
    this.state.tabUrl = null;
    this.state.tabTitle = null;
    this.state.originalTabTitle = null;
    this.state.temporarilyDetached = false;
    this.consoleLogs = [];
    this.networkLogs = [];
    this.backgroundRecorder.clear(); // Clear background interaction log

    this.updateConnectionState();
    console.log('[Background] Disconnect complete');
  }

  /**
   * Start keepalive mechanism to maintain debugger connection
   * Periodically checks connection state and reattaches if needed
   */
  startKeepalive() {
    // Clear any existing keepalive interval
    this.stopKeepalive();

    console.log('[Background] Starting keepalive mechanism (checks every 2 seconds)');

    this.keepaliveInterval = setInterval(async () => {
      // Only run keepalive if we're connected and have a tab
      if (!this.state.connected || !this.state.tabId) {
        return;
      }

      // Check if we're in a temporarily detached state
      // Skip if reattachment is already in progress (from target_closed handler)
      if (this.state.temporarilyDetached && !this.cdp.isAttached() && !this.isReattaching) {
        console.log('[Background] Keepalive detected temporarily detached state, attempting reattachment...');

        try {
          // Get current tab info
          const tab = await chrome.tabs.get(this.state.tabId);

          // Only reattach if URL is accessible
          if (tab && tab.url && !this.isRestrictedUrl(tab.url)) {
            console.log('[Background] Keepalive reattaching to:', tab.url);
            await this.cdp.attach(this.state.tabId);
            this.state.temporarilyDetached = false;
            console.log('[Background] Keepalive reattachment successful');

            // Update stored URL and title
            this.state.tabUrl = tab.url;
            this.state.originalTabTitle = tab.title.startsWith('🟢 [MCP] ')
              ? tab.title.replace('🟢 [MCP] ', '')
              : tab.title;

            // Re-inject indicators
            await this.updateTabTitle();
            await this.injectTabIndicator();
            await this.injectBackgroundCapture();
          } else {
            console.log('[Background] Keepalive skipping reattachment - tab still on restricted URL:', tab?.url);
          }
        } catch (error) {
          // Check if the error is due to tab not existing
          const isTabNotFound = error.message && (
            error.message.includes('No tab with id') ||    // 'No tab with id: X' (chrome.tabs.get)
            error.message.includes('No tab with given id') || // 'No tab with given id X' (chrome.debugger.attach)
            error.message.includes('tab not found')
          );

          if (isTabNotFound) {
            console.log('[Background] Keepalive detected tab no longer exists:', this.state.tabId);
            console.log('[Background] Cleaning up state and switching to another attached tab if available');

            // Clear the temporarily detached state
            this.state.temporarilyDetached = false;

            // Try to switch to another attached tab, or clear state if none available
            const lastUsedTabId = this.tabManager.getLastUsedTabId();
            if (lastUsedTabId && lastUsedTabId !== this.state.tabId) {
              const tabInfo = this.tabManager.attachedTabs.get(lastUsedTabId);
              if (tabInfo) {
                this.state.tabId = lastUsedTabId;
                this.state.tabUrl = tabInfo.url;
                this.state.tabTitle = tabInfo.title;
                this.state.originalTabTitle = tabInfo.originalTitle;
                console.log('[Background] Switched active tab to:', lastUsedTabId);
              } else {
                // Clear state - no valid tabs available
                this.state.tabId = null;
                this.state.tabUrl = null;
                this.state.tabTitle = null;
                this.state.originalTabTitle = null;
                console.log('[Background] No attached tabs available, cleared tab state');
              }
            } else {
              // Clear state - no other tabs available
              this.state.tabId = null;
              this.state.tabUrl = null;
              this.state.tabTitle = null;
              this.state.originalTabTitle = null;
              console.log('[Background] No attached tabs available, cleared tab state');
            }
          } else if (error.message && (error.message.includes('Cannot access a chrome-extension://') || error.message.includes('chrome-extension://'))) {
            // Transient: another extension's popup/overlay is active on the tab.
            // State stays temporarilyDetached so the next keepalive tick will retry.
            console.warn('[Background] Keepalive reattach blocked by chrome-extension:// page (transient, will retry)');
          } else {
            // Other error - log but don't clear state
            console.error('[Background] Keepalive reattachment failed:', error);
            // Don't disconnect on keepalive failure - let the normal error handling deal with it
          }
        }
      }

      // Retry failed responses periodically
      if (this.failedResponses && this.failedResponses.size > 0) {
        console.log(`[Background] Retrying ${this.failedResponses.size} failed responses...`);

        for (const [requestId, responseData] of this.failedResponses.entries()) {
          // Only retry if not too old (5 minutes)
          const age = Date.now() - responseData.timestamp;
          if (age > 300000) {
            console.log(`[Background] Dropping old failed response: ${requestId}`);
            this.failedResponses.delete(requestId);
            continue;
          }

          // Attempt to resend with single retry
          const result = await this.safeSendResponse(
            requestId,
            responseData.payload,
            { maxAttempts: 1 }
          );

          if (result.success) {
            console.log(`[Background] Successfully retried failed response: ${requestId}`);
          }
        }
      }
    }, 2000); // Check every 2 seconds
  }

  /**
   * Stop keepalive mechanism
   */
  stopKeepalive() {
    if (this.keepaliveInterval) {
      console.log('[Background] Stopping keepalive mechanism');
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  /**
   * Handle tab closure with proper cleanup
   * Cleans up recording sessions, user action requests, and disconnects gracefully
   * @param {number} tabId - The ID of the closed tab
   */
  async handleTabClosed(tabId) {
    console.log('[Background] handleTabClosed called for tab:', tabId);

    // Check if there's an active recording session
    if (this.currentRecordingRequest) {
      const sessionId = this.currentRecordingRequest.sessionId;
      const session = this.recordingSessions.get(sessionId);

      console.log('[Background] Active recording session detected, cancelling:', sessionId);

      // Cancel the recording session
      if (session && session.reject) {
        session.reject(new Error('Tab closed during recording'));
      }

      // Clean up recording state
      this.recordingSessions.delete(sessionId);
      this.currentRecordingRequest = null;
      chrome.action.setBadgeText({ text: '' });

      console.log('[Background] Recording session cleaned up');
    }

    // Check if there's an active user action request
    if (this.currentUserActionRequest) {
      const requestId = this.currentUserActionRequest.requestId;
      const navListener = this.currentUserActionRequest.navigationListener;

      console.log('[Background] Active user action request detected, cancelling:', requestId);

      // Remove navigation listener if it exists
      if (navListener) {
        chrome.webNavigation.onCommitted.removeListener(navListener);
        console.log('[Background] Navigation listener removed');
      }

      // Send cancellation notification through WebSocket if still connected
      if (this.ws && this.state.connected) {
        try {
          await this.ws.send(JSON.stringify({
            type: 'notification',
            method: 'notifications/cancelled',
            params: {
              reason: 'Tab closed during user action request',
              requestId: requestId
            }
          }));
        } catch (error) {
          console.error('[Background] Failed to send cancellation notification:', error);
        }
      }

      // Clean up user action request
      this.currentUserActionRequest = null;

      console.log('[Background] User action request cleaned up');
    }

    // Check if this tab is attached
    if (this.tabManager.attachedTabs.has(tabId)) {
      console.log('[Background] Attached tab closed, detaching:', tabId);
      await this.tabManager.detachTab(tabId);
      console.log('[Background] Tab detached successfully');

      // Update backwards compatibility state if this was THE tracked tab
      if (this.state.tabId === tabId) {
        const lastUsedTabId = this.tabManager.getLastUsedTabId();
        if (lastUsedTabId) {
          const tabInfo = this.tabManager.attachedTabs.get(lastUsedTabId);
          this.state.tabId = lastUsedTabId;
          this.state.tabUrl = tabInfo.url;
          this.state.tabTitle = tabInfo.title;
          this.state.originalTabTitle = tabInfo.originalTitle;
          console.log('[Background] Switched active tab to:', lastUsedTabId);
        } else {
          // No more attached tabs - stay connected but clear tab state
          this.state.tabId = null;
          this.state.tabUrl = null;
          this.state.tabTitle = null;
          this.state.originalTabTitle = null;
          console.log('[Background] No more attached tabs, but staying connected');
        }
      }
    } else {
      console.log('[Background] Closed tab was not attached, no action needed');
    }

    console.log('[Background] Tab closure cleanup complete');
  }

  /**
   * Ensure debugger is attached to a tab (lazy attachment with multi-tab support)
   * Supports attaching by tabId, label, or auto-opening a new tab
   *
   * @param {Object} payload - { tabId?: number, label?: string, autoOpenUrl?: string }
   * @returns {Object} - { tabId: number, label: string }
   */
  /**
   * @param autoCapture - set FALSE to suppress auto session-capture.
   *   ⚠️ LOAD-BEARING: handleStartSessionRecording() calls this method to
   *   attach the tab it is about to record. Without this flag that call would
   *   re-enter _maybeAutoCapture() → handleStartSessionRecording() → attach →
   *   … and recurse without bound, because `this.sessionRecording` is not
   *   assigned until AFTER that internal attach returns, so the usual
   *   "already recording" guard is still null and cannot break the cycle.
   */
  async handleEnsureAttached({ tabId, label, autoOpenUrl, autoCapture = true, _reResolved = false }) {
    try {
      let targetTabId = tabId;

      // Did the caller NAME a tab? Substituting a different one is only ever
      // acceptable when they didn't. See the restricted-URL branch below.
      const explicitTarget = tabId != null || label != null;

      // Resolve label to tabId if provided.
      // ⚠️ With autoOpenUrl ALSO supplied, a label that matches nothing is not
      // an error — it is the NAME to give the tab we are about to create.
      // Previously the lookup ran first and threw "No tab found with label: X"
      // before the autoOpenUrl branch below could run, so
      // attach_tab({autoOpenUrl, label}) could never succeed on a first call
      // and created nothing. (ha, 2026-08-12.) The combination plainly means
      // "open this URL and call it X"; only the ORDER said otherwise.
      // (attachTab() below already honours options.label, so the name is
      // applied by the normal attach path — nothing extra to carry.)
      if (!targetTabId && label) {
        const tabInfo = this.tabManager.resolveTab(label);
        if (tabInfo) {
          targetTabId = tabInfo.tabId;
          console.log('[Background] Resolved label', label, 'to tab', targetTabId);
        } else if (autoOpenUrl) {
          console.log('[Background] Label', label, 'is unused; the new tab will be named with it');
        } else {
          // No autoOpenUrl to fall back on — the caller named a tab that does
          // not exist and gave us no way to make one.
          throw new Error(`No tab found with label: ${label}`);
        }
      }

      // If no target but autoOpenUrl provided, create new tab
      // (do this BEFORE falling back to last-used tab)
      if (!targetTabId && autoOpenUrl) {
        console.log('[Background] Creating new tab with URL:', autoOpenUrl);
        const newTab = await chrome.tabs.create({ url: autoOpenUrl, active: true });
        targetTabId = newTab.id;

        // Wait for tab to load and URL to be populated
        await new Promise((resolve) => {
          const listener = (tabId, changeInfo) => {
            if (tabId === targetTabId && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);

          // Timeout after 30 seconds
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 30000);
        });

        // Small delay to ensure URL is fully populated in tab object
        await new Promise(resolve => setTimeout(resolve, 100));

        console.log('[Background] New tab created and loaded:', targetTabId);
      }

      // If still no target, try last-used tab
      if (!targetTabId) {
        targetTabId = this.tabManager.getLastUsedTabId();
        if (targetTabId) {
          console.log('[Background] Using last-used tab:', targetTabId);
        }
      }

      // If STILL no target, check if we need to create a window or use active tab
      if (!targetTabId) {
        // Check if there are any windows
        const windows = await chrome.windows.getAll();

        if (windows.length === 0) {
          console.log('[Background] No windows found, creating new window...');
          const newWindow = await chrome.windows.create({ url: 'about:blank', focused: true });
          targetTabId = newWindow.tabs[0].id;
          console.log('[Background] Created new window and tab:', targetTabId);

          // Wait for tab to be ready
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          // Windows exist - try to get active tab from last focused window
          console.log('[Background] No explicit target, looking for active tab in current window...');
          try {
            const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (activeTab) {
              targetTabId = activeTab.id;
              console.log('[Background] Using active tab from current window:', targetTabId);
            } else {
              // Fallback: get any tab from the first window
              const [firstWindow] = windows;
              const tabs = await chrome.tabs.query({ windowId: firstWindow.id });
              if (tabs.length > 0) {
                targetTabId = tabs[0].id;
                console.log('[Background] Using first tab from first window:', targetTabId);
              } else {
                throw new Error('No tab available. Provide tabId, label, or autoOpenUrl.');
              }
            }
          } catch (queryError) {
            console.error('[Background] Failed to query for active tab:', queryError);
            throw new Error('No tab available. Provide tabId, label, or autoOpenUrl.');
          }
        }
      }

      // Check if already attached to this tab (idempotent)
      if (this.tabManager.attachedTabs.has(targetTabId)) {
        const tabInfo = this.tabManager.attachedTabs.get(targetTabId);

        if (tabInfo.cdp.isAttached()) {
          console.log('[Background] Already attached to tab:', targetTabId);
          this.tabManager.markUsed(targetTabId);
          this.state.tabId = targetTabId;
          this.state.tabUrl = tabInfo.url;
          this.state.tabTitle = tabInfo.title;
          await this._maybeAutoCapture(targetTabId, autoCapture);
          return { tabId: targetTabId, label: tabInfo.label, url: tabInfo.url };
        }

        // CDP session died (navigation killed it, retry exhausted, or the tab
        // was closed while the SW was dormant so chrome.tabs.onRemoved never
        // fired). Verify the underlying tab still exists before re-attaching.
        const liveTab = await chrome.tabs.get(targetTabId).catch(() => null);

        if (!liveTab) {
          // The tab is gone. If we don't prune the stale entry here, it remains
          // the last-used pointer and every untargeted ensure_attached (e.g. the
          // create_tab / navigate pre-flight) falls back to it and throws
          // "No tab with id: <dead>" — wedging the whole extension until manually
          // cleared. Prune it (detachTab also advances lastUsedTabId off this id),
          // then re-resolve a live target instead of throwing.
          console.warn('[Background] Attached tab', targetTabId, 'no longer exists; pruning stale registry entry');
          await this.tabManager.detachTab(targetTabId).catch(() => {
            // Best-effort: guarantee the map entry is gone even if detach throws
            this.tabManager.attachedTabs.delete(targetTabId);
            if (this.tabManager.lastUsedTabId === targetTabId) this.tabManager.repointLastUsed();
          });
          if (this.state.tabId === targetTabId) {
            this.state.tabId = null;
            this.state.tabUrl = null;
            this.state.tabTitle = null;
            this.state.originalTabTitle = null;
          }
          if (tabId != null && targetTabId === tabId) {
            // Caller explicitly asked for this now-dead tab — registry is clean
            // now, so surface the not-found error rather than silently retargeting.
            throw new Error(`No tab with id: ${targetTabId}`);
          }
          // targetTabId came from the last-used fallback; re-resolve from scratch.
          return await this.handleEnsureAttached({ tabId: null, label: null, autoOpenUrl: null, autoCapture });
        }

        // Tab still exists — re-attach now (unless it navigated to a restricted URL)
        console.log('[Background] Tab in map but CDP disconnected, re-attaching:', targetTabId);
        try {
          if (!this.isRestrictedUrl(liveTab.url)) {
            await tabInfo.cdp.attach(targetTabId);
            tabInfo.url = liveTab.url;
            tabInfo.title = liveTab.title;
            tabInfo.lastUsedAt = Date.now();
            this.tabManager.markUsed(targetTabId);
            this.state.tabId = targetTabId;
            this.state.tabUrl = liveTab.url;
            this.state.tabTitle = liveTab.title;
            await this.injectBackgroundCapture(targetTabId).catch(() => {});
            console.log('[Background] Re-attached to tab after dead session:', targetTabId);
            await this._maybeAutoCapture(targetTabId, autoCapture);
            return { tabId: targetTabId, label: tabInfo.label, url: liveTab.url };
          }
        } catch (reattachErr) {
          console.warn('[Background] Re-attach failed, removing from map for fresh attach:', reattachErr.message);
          this.tabManager.attachedTabs.delete(targetTabId);
          // ⚠️ And move the last-used pointer off it. This delete bypasses
          // detachTab(), which is the only place that re-points it — leaving
          // lastUsedTabId naming a tab that is no longer in the map. That is
          // exactly the state that wedged ext_018237f9 on 2026-08-22.
          // getLastUsedTabId() now repairs this on read; keeping the pointer
          // honest here too means the repair is a backstop, not the mechanism.
          if (this.tabManager.lastUsedTabId === targetTabId) this.tabManager.repointLastUsed();
        }
      }

      // Get tab info.
      //
      // ⛔ chrome.tabs.get REJECTS for an unknown id — it does not resolve to a
      // falsy value — so the `if (!tab)` guard below was unreachable and
      // Chrome's raw "No tab with id: <n>" escaped in its place. That is the
      // right answer when the caller NAMED the tab, and the wrong one when WE
      // picked it: an id we chose ourselves going stale is ours to recover
      // from, not theirs to read as a failure about a tab they never mentioned.
      let tab = await chrome.tabs.get(targetTabId).catch((err) => {
        if (explicitTarget) throw err;
        return null;
      });
      if (!tab) {
        if (explicitTarget) {
          throw new Error(`Tab ${targetTabId} not found`);
        }
        console.warn('[Background] Self-chosen target', targetTabId, 'vanished before attach; re-resolving');
        this.tabManager.attachedTabs.delete(targetTabId);
        if (this.tabManager.lastUsedTabId === targetTabId) this.tabManager.repointLastUsed();
        // One retry only. The prune above shrinks the map, so a second miss
        // means we are picking from live-tab queries rather than stale state,
        // and looping would not converge on anything better.
        if (_reResolved) {
          throw new Error('No tab available. Provide tabId, label, or autoOpenUrl.');
        }
        return await this.handleEnsureAttached({ tabId: null, label: null, autoOpenUrl: null, autoCapture, _reResolved: true });
      }

      // Check if the target tab has a restricted URL
      if (this.isRestrictedUrl(tab.url)) {
        // ⛔ NEVER substitute a tab the caller explicitly named. Retargeting is
        // a convenience for "attach me to something sensible"; applied to an
        // explicit tabId it returns SUCCESS naming a DIFFERENT tab, which the
        // caller cannot distinguish from the attach they asked for.
        // `assistant` (2026-08-06) passed a chrome://newtab/ id and landed on
        // an unrelated tab in a browser they should not have been in — the
        // response read as a normal successful attach. A wrong destination
        // reported as success is worse than a failure.
        // The dead-tab branch above already reasons this way ("surface the
        // not-found error rather than silently retargeting"); this path was
        // simply missed.
        if (explicitTarget) {
          const err = new Error(
            `Cannot attach to tab ${targetTabId} (${tab.url}) — extensions cannot debug this URL. ` +
            `Navigate it to a regular page first, or pass a different tabId. ` +
            `Not retargeting automatically, because you asked for a specific tab.`
          );
          err.code = 'UNATTACHABLE_URL';
          throw err;
        }

        console.warn('[Background] Cannot attach to restricted URL:', tab.url);
        console.log('[Background] Searching for first valid tab...');

        // Find the first valid tab
        const validTab = await this.findFirstValidTab();
        targetTabId = validTab.id;
        tab = validTab;

        console.log('[Background] Switched to valid tab:', targetTabId, tab.url);
      }

      console.log('[Background] Attaching to tab:', targetTabId, tab.url);

      // Attach using TabManager (creates new CDP instance). Pass caller's
      // agent/takeover so the tab is reserved to them on first attach.
      const tabInfo = await this.tabManager.attachTab(targetTabId, tab.url, tab.title, {
        agent: this.tabManager._currentAgent,
        takeover: this.tabManager._currentTakeover,
        // `label` was accepted here and silently dropped — see attachTab().
        label,
      });

      // Update state for backwards compatibility
      this.state.tabId = targetTabId;
      this.state.tabUrl = tab.url;
      this.state.tabTitle = tab.title;
      this.state.originalTabTitle = tab.title.startsWith('🟢 [MCP] ')
        ? tab.title.replace('🟢 [MCP] ', '')
        : tab.title;

      // Inject indicators and background capture
      console.log('[Background] Injecting indicators and background capture...');
      await this.injectTabIndicator(targetTabId);
      await this.injectBackgroundCapture(targetTabId);

      console.log('[Background] Successfully attached to tab:', targetTabId, 'with label:', tabInfo.label);

      await this._maybeAutoCapture(targetTabId, autoCapture);

      return { tabId: targetTabId, label: tabInfo.label, url: tab.url };
    } catch (error) {
      console.error('[Background] ensureAttached failed:', error);
      throw error;
    }
  }

  /**
   * List all attached tabs with their labels and reservation info.
   */
  async handleListAttachedTabs() {
    try {
      const tabs = this.tabManager.listTabs();
      return { tabs };
    } catch (error) {
      console.error('[Background] handleListAttachedTabs failed:', error);
      throw error;
    }
  }

  /**
   * Explicitly reserve a tab for an agent. Useful when an agent wants to claim
   * a tab it didn't create (e.g. one the user opened, or one previously released
   * by another agent). Accepts the same agent/takeover semantics as everything
   * else — pass takeover:true to forcibly transfer ownership.
   */
  async handleReserveTab({ tabTarget, agent, takeover }) {
    if (!agent) throw new Error('browser_reserve_tab requires an agent identifier');
    const info = this.tabManager.resolveTab(tabTarget);
    if (!info) throw new Error(`Tab ${tabTarget} not attached. Use browser_list_attached_tabs.`);
    const outcome = this.tabManager.claimTab(info.tabId, agent, { takeover: takeover === true });
    return {
      success: true,
      tabId: info.tabId,
      label: info.label,
      reservedTo: agent,
      outcome,
    };
  }

  /**
   * Explicitly release a tab's reservation, freeing it for any other agent to
   * pick up. No-op if the tab isn't reserved.
   */
  async handleReleaseTab({ tabTarget, agent }) {
    const info = this.tabManager.resolveTab(tabTarget);
    if (!info) throw new Error(`Tab ${tabTarget} not attached. Use browser_list_attached_tabs.`);
    // Only the owner may release (unless no agent supplied — be permissive then)
    const existing = this.tabManager.reservations.get(info.tabId);
    if (existing && existing.owner && agent && existing.owner !== agent) {
      const err = new Error(
        `Cannot release tab ${info.label || info.tabId}: reserved by "${existing.owner}", not "${agent}".`
      );
      err.code = 'tab-reserved';
      err.owner = existing.owner;
      throw err;
    }
    this.tabManager.releaseTab(info.tabId, agent ? `released-by:${agent}` : 'released');
    return { success: true, tabId: info.tabId, label: info.label };
  }

  /**
   * Set or update a tab's label
   */
  async handleSetTabLabel({ tabTarget, label }) {
    try {
      if (!tabTarget || !label) {
        throw new Error('Both tabTarget and label are required');
      }

      // Resolve tab (can be ID or label)
      const tabInfo = this.tabManager.resolveTab(tabTarget);
      if (!tabInfo) {
        throw new Error(`Tab ${tabTarget} not found`);
      }

      // Update the label
      this.tabManager.setTabLabel(tabInfo.tabId, label);

      return {
        tabId: tabInfo.tabId,
        label,
        success: true
      };
    } catch (error) {
      console.error('[Background] handleSetTabLabel failed:', error);
      throw error;
    }
  }

  /**
   * Detach debugger from a specific tab
   */
  async handleDetachTab({ tabId, tabTarget }) {
    try {
      // Resolve tabTarget to numeric tabId if needed
      let resolvedTabId = tabId;
      if (!resolvedTabId && tabTarget !== undefined) {
        const tabInfo = this.tabManager.resolveTab(tabTarget);
        if (tabInfo) {
          resolvedTabId = tabInfo.tabId;
        } else if (typeof tabTarget === 'string' && /^\d+$/.test(tabTarget)) {
          resolvedTabId = parseInt(tabTarget, 10);
        } else if (typeof tabTarget === 'number') {
          resolvedTabId = tabTarget;
        } else {
          throw new Error(`browser_detach_tab: no tab found with label "${tabTarget}"`);
        }
      }

      if (!resolvedTabId) {
        throw new Error('Provide either tabId (number) or tabTarget (label/id)');
      }

      // Check if tab is attached
      const tabInfo = this.tabManager.attachedTabs.get(resolvedTabId);
      if (!tabInfo) {
        console.warn('[Background] Tab not attached:', resolvedTabId);
        return { success: true, message: 'Tab was not attached' };
      }

      console.log('[Background] Detaching from tab:', resolvedTabId, 'label:', tabInfo.label);

      // Detach using TabManager
      await this.tabManager.detachTab(resolvedTabId);

      // If this was the active tab, clear backwards-compatible state
      if (this.state.tabId === resolvedTabId) {
        this.state.tabId = null;
        this.state.tabUrl = null;
        this.state.tabTitle = null;
        this.state.originalTabTitle = null;
      }

      console.log('[Background] Successfully detached from tab:', resolvedTabId);

      return {
        success: true,
        tabId: resolvedTabId,
        detachedLabel: tabInfo.label
      };
    } catch (error) {
      console.error('[Background] handleDetachTab failed:', error);
      throw error;
    }
  }

  /**
   * Get the currently active (last-used) tab
   */
  async handleGetActiveTab() {
    try {
      const lastUsedTabId = this.tabManager.getLastUsedTabId();

      if (!lastUsedTabId) {
        return {
          hasActiveTab: false,
          message: 'No tabs currently attached'
        };
      }

      const tabInfo = this.tabManager.attachedTabs.get(lastUsedTabId);

      return {
        hasActiveTab: true,
        tabId: lastUsedTabId,
        label: tabInfo.label,
        url: tabInfo.url,
        title: tabInfo.title,
        lastUsedAt: tabInfo.lastUsedAt
      };
    } catch (error) {
      console.error('[Background] handleGetActiveTab failed:', error);
      throw error;
    }
  }

  /**
   * Update connection state and notify popup
   */
  async updateConnectionState() {
    const state = {
      connected: this.state.connected,
      wsState: await this.ws.getState(),
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

    // Only update title if debugger is attached and not detaching
    if (!this.cdp.isAttached() || this.cdp.isDetaching) {
      return;
    }

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
    if (!this.state.tabId) {
      console.log('[Background] restoreTabTitle: No tabId, skipping');
      return;
    }

    console.log('[Background] restoreTabTitle: Starting cleanup');
    console.log('[Background] restoreTabTitle: CDP attached?', this.cdp.isAttached());
    console.log('[Background] restoreTabTitle: CDP detaching?', this.cdp.isDetaching);

    try {
      // Try using CDP only if debugger is attached AND not detaching
      if (this.cdp.isAttached() && !this.cdp.isDetaching) {
        console.log('[Background] restoreTabTitle: Using CDP path');
        await this.cdp.evaluate(`
          if (document.title.startsWith('🟢 [MCP] ')) {
            document.title = document.title.replace('🟢 [MCP] ', '');
          }
        `, true);
        console.log('[Background] restoreTabTitle: CDP cleanup successful');
      } else {
        // Use chrome.scripting if debugger already detached or detaching
        console.log('[Background] restoreTabTitle: Using chrome.scripting fallback');
        console.log('[Background] restoreTabTitle: Target tabId:', this.state.tabId);

        const result = await chrome.scripting.executeScript({
          target: { tabId: this.state.tabId },
          func: () => {
            console.log('[Page] restoreTabTitle: Executing in page context');
            console.log('[Page] restoreTabTitle: Current title:', document.title);
            if (document.title.startsWith('🟢 [MCP] ')) {
              document.title = document.title.replace('🟢 [MCP] ', '');
              console.log('[Page] restoreTabTitle: Title updated to:', document.title);
              return { success: true, newTitle: document.title };
            }
            return { success: false, reason: 'Title does not have MCP prefix' };
          }
        });

        console.log('[Background] restoreTabTitle: chrome.scripting result:', result);
        console.log('[Background] restoreTabTitle: Fallback cleanup successful');
      }
      console.log('[Background] Tab title restored');
    } catch (error) {
      // Log but don't throw - cleanup should be best-effort
      console.warn('[Background] Failed to restore tab title (non-fatal):', error.message);
    }
  }

  /**
   * Remove MCP prefix from all tabs that are NOT attached
   * Attached tabs should keep their prefix
   */
  async removeAllTabPrefixes() {
    console.log('[Background] Cleaning up MCP prefixes from unattached tabs');

    try {
      // Get all tabs
      const tabs = await chrome.tabs.query({});

      // Get set of attached tab IDs
      const attachedTabIds = new Set(this.tabManager.attachedTabs.keys());
      console.log('[Background] Currently attached tabs:', Array.from(attachedTabIds));

      // Check each tab and remove prefix if NOT attached
      for (const tab of tabs) {
        // Skip restricted URLs that can't be scripted
        if (this.isRestrictedUrl(tab.url)) {
          continue;
        }

        // Skip if this tab is attached - it should keep the prefix
        if (attachedTabIds.has(tab.id)) {
          continue;
        }

        try {
          // Use chrome.scripting to remove prefix from unattached tabs
          const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              if (document.title.startsWith('🟢 [MCP] ')) {
                const oldTitle = document.title;
                document.title = document.title.replace('🟢 [MCP] ', '');
                return { removed: true, oldTitle, newTitle: document.title };
              }
              return { removed: false };
            }
          });

          if (result?.[0]?.result?.removed) {
            console.log(`[Background] Removed MCP prefix from unattached tab ${tab.id}: "${result[0].result.oldTitle}" -> "${result[0].result.newTitle}"`);
          }
        } catch (error) {
          // Tab may be restricted or unavailable - skip
          // Don't log this as it's expected for some tabs
        }
      }

      console.log('[Background] Finished cleaning up MCP prefixes');
    } catch (error) {
      console.warn('[Background] Failed to remove all tab prefixes (non-fatal):', error.message);
    }
  }

  /**
   * Remove MCP indicator from all tabs
   * Used when switching tabs and for cleanup after crashes
   */
  async removeAllTabIndicators() {
    console.log('[Background] Removing MCP indicator from all tabs');

    try {
      // Get all tabs
      const tabs = await chrome.tabs.query({});

      // Remove indicator from each tab
      for (const tab of tabs) {
        try {
          // Use chrome.scripting to remove indicator
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const indicator = document.getElementById('browser-mcp-indicator');
              if (indicator) {
                indicator.remove();
                console.log('[Page] MCP indicator removed');
              }
            }
          });
          console.log(`[Background] Removed MCP indicator from tab ${tab.id}`);
        } catch (error) {
          // Tab may be restricted or unavailable - skip
          console.warn(`[Background] Could not remove indicator from tab ${tab.id}:`, error.message);
        }
      }
    } catch (error) {
      console.warn('[Background] Failed to remove all tab indicators (non-fatal):', error.message);
    }
  }

  /**
   * Cleanup on extension startup/reload
   * Removes all MCP prefixes and indicators from all tabs
   * Ensures clean state on startup
   * Optionally adds indicators to a specific tab after cleanup
   */
  async cleanupOnStartup(activeTabId = null) {
    console.log('[Background] Running startup cleanup...');

    try {
      // Remove all prefixes and indicators from all tabs
      await this.removeAllTabPrefixes();
      await this.removeAllTabIndicators();

      console.log('[Background] Startup cleanup complete');

      // If we have an active tab, add indicators to it
      if (activeTabId) {
        console.log('[Background] Adding indicators to active tab:', activeTabId);

        // Store original title before adding prefix
        const tab = await chrome.tabs.get(activeTabId);
        this.state.originalTabTitle = tab.title.startsWith('🟢 [MCP] ')
          ? tab.title.replace('🟢 [MCP] ', '')
          : tab.title;

        // Add indicators using chrome.scripting (no CDP needed yet)
        await this.addIndicatorsWithoutCDP(activeTabId);
      }
    } catch (error) {
      console.error('[Background] Startup cleanup failed:', error);
    }
  }

  /**
   * Add indicators to a tab without using CDP
   * Used during startup before debugger is attached
   */
  async addIndicatorsWithoutCDP(tabId) {
    try {
      // Add title prefix
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          if (!document.title.startsWith('🟢 [MCP] ')) {
            document.title = `🟢 [MCP] ${document.title}`;
          }
        }
      });

      // Add visual indicator
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Remove any existing indicator
          const existing = document.getElementById('browser-mcp-indicator');
          if (existing) existing.remove();

          // Create indicator using DOM methods
          const container = document.createElement('div');
          container.id = 'browser-mcp-indicator';
          container.style.cssText = `
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
          `;

          // Create pulse dot
          const dot = document.createElement('div');
          dot.style.cssText = `
            width: 8px;
            height: 8px;
            background: #10b981;
            border-radius: 50%;
            animation: mcpPulse 2s ease-in-out infinite;
          `;

          // Create text node
          const text = document.createTextNode('MCP Connected');

          // Assemble indicator
          container.appendChild(dot);
          container.appendChild(text);

          // Add animations
          const style = document.createElement('style');
          style.textContent = `
            @keyframes mcpFadeIn {
              from { opacity: 0; transform: translateY(10px); }
              to { opacity: 1; transform: translateY(0); }
            }
            @keyframes mcpPulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.5; }
            }
          `;
          document.head.appendChild(style);

          document.body.appendChild(container);
        }
      });

      console.log('[Background] Indicators added to tab:', tabId);
    } catch (error) {
      console.warn('[Background] Failed to add indicators (non-fatal):', error.message);
    }
  }

  /**
   * Inject visual indicator on the connected tab
   */
  async injectTabIndicator() {
    if (!this.state.tabId) return;

    // Only inject if debugger is attached and not detaching
    if (!this.cdp.isAttached() || this.cdp.isDetaching) {
      console.log('[Background] Skipping indicator injection: debugger not available');
      return;
    }

    try {
      await this.cdp.evaluate(`
        (() => {
          // Remove any existing indicator
          const existing = document.getElementById('browser-mcp-indicator');
          if (existing) existing.remove();

          // Create indicator using DOM methods (no innerHTML - works with TrustedHTML policies)
          const container = document.createElement('div');
          container.id = 'browser-mcp-indicator';
          container.style.cssText = \`
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
          \`;

          // Create pulse dot
          const dot = document.createElement('div');
          dot.style.cssText = \`
            width: 8px;
            height: 8px;
            background: #10b981;
            border-radius: 50%;
            animation: mcpPulse 2s ease-in-out infinite;
          \`;

          // Create text node
          const text = document.createTextNode('MCP Connected');

          // Assemble indicator
          container.appendChild(dot);
          container.appendChild(text);

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

          document.body.appendChild(container);
        })();
      `, true);
      console.log('[Background] Tab indicator injected');
    } catch (error) {
      console.error('[Background] Failed to inject indicator:', error);
    }
  }

  /**
   * Inject background interaction capture script
   */
  async injectBackgroundCapture(tabTarget) {
    const targetTabId = tabTarget || this.tabManager.lastUsedTabId;
    if (!targetTabId) return;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        files: ['background-interaction-capture.js']
      });
      console.log('[Background] Background interaction capture injected into tab:', targetTabId);
    } catch (error) {
      console.error('[Background] Failed to inject background capture into tab', targetTabId, ':', error);
    }
  }

  /**
   * Remove visual indicator from the connected tab
   */
  async removeTabIndicator() {
    if (!this.state.tabId) {
      console.log('[Background] removeTabIndicator: No tabId, skipping');
      return;
    }

    console.log('[Background] removeTabIndicator: Starting cleanup');
    console.log('[Background] removeTabIndicator: CDP attached?', this.cdp.isAttached());
    console.log('[Background] removeTabIndicator: CDP detaching?', this.cdp.isDetaching);

    try {
      // Try using CDP only if debugger is attached AND not detaching
      if (this.cdp.isAttached() && !this.cdp.isDetaching) {
        console.log('[Background] removeTabIndicator: Using CDP path');
        await this.cdp.evaluate(`
          (() => {
            const indicator = document.getElementById('browser-mcp-indicator');
            if (indicator) indicator.remove();
          })();
        `, true);
        console.log('[Background] removeTabIndicator: CDP cleanup successful');
      } else {
        // Use chrome.scripting if debugger already detached or detaching
        console.log('[Background] removeTabIndicator: Using chrome.scripting fallback');
        console.log('[Background] removeTabIndicator: Target tabId:', this.state.tabId);

        const result = await chrome.scripting.executeScript({
          target: { tabId: this.state.tabId },
          func: () => {
            console.log('[Page] removeTabIndicator: Executing in page context');
            const indicator = document.getElementById('browser-mcp-indicator');
            console.log('[Page] removeTabIndicator: Found indicator?', !!indicator);
            if (indicator) {
              indicator.remove();
              console.log('[Page] removeTabIndicator: Indicator removed');
              return { success: true };
            }
            return { success: false, reason: 'Indicator element not found' };
          }
        });

        console.log('[Background] removeTabIndicator: chrome.scripting result:', result);
        console.log('[Background] removeTabIndicator: Fallback cleanup successful');
      }
      console.log('[Background] Tab indicator removed');
    } catch (error) {
      // Log but don't throw - cleanup should be best-effort
      console.warn('[Background] Failed to remove indicator (non-fatal):', error.message);
    }
  }

  /**
   * Safely send response to MCP server with retry logic
   * Prevents tab detachment on send failures
   */
  async safeSendResponse(requestId, payload, options = {}) {
    const maxAttempts = options.maxAttempts || 3;
    const baseDelay = options.baseDelay || 100;
    const wsId = options.wsId || this._currentOriginWsId || 'default';
    const ws = this.serverPool.get(wsId) || this.ws;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await ws.sendNoResponse({
          type: 'messageResponse',
          payload: { requestId, ...payload }
        });

        // Success - clear failure tracking
        if (this.failedResponses?.has(requestId)) {
          this.failedResponses.delete(requestId);
        }
        return { success: true };

      } catch (error) {
        const isLastAttempt = attempt === maxAttempts;
        const delay = baseDelay * Math.pow(2, attempt - 1);

        console.warn(
          `[Background] Response send attempt ${attempt}/${maxAttempts} failed:`,
          error.message,
          isLastAttempt ? '(final attempt)' : `(retrying in ${delay}ms)`
        );

        if (!isLastAttempt) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Queue for background retry
        if (!this.failedResponses) {
          this.failedResponses = new Map();
        }
        this.failedResponses.set(requestId, {
          payload,
          timestamp: Date.now(),
          attempts: maxAttempts
        });

        console.error(
          '[Background] Failed to send response after all attempts:',
          error.message,
          '- response queued for background retry'
        );

        return { success: false, error: error.message, queued: true };
      }
    }
  }

  /**
   * Handle message from MCP server
   * Implements comprehensive error containment to prevent detachment
   */
  async handleMCPMessage(message, originWsId = 'default') {
    const { type, payload, id } = message;
    console.log(`[Background] Handling MCP message (wsId=${originWsId}):`, type, payload);
    // Stash the origin so safeSendResponse can route the reply back via the
    // same WS the command came in on — even when handlers don't explicitly
    // thread the wsId through their call chains.
    this._currentOriginWsId = originWsId;
    // Same trick for the reservation system: stash the caller's agent name +
    // takeover flag on the TabManager so requireCDP() can enforce ownership
    // without every handler having to plumb `agent` / `takeover` through its
    // call chain. Cleared in finally below.
    const callerAgent = (payload && typeof payload === 'object') ? payload.agent : undefined;
    const callerTakeover = (payload && typeof payload === 'object') ? payload.takeover === true : false;
    if (this.tabManager) {
      this.tabManager._currentAgent = callerAgent || null;
      this.tabManager._currentTakeover = callerTakeover;
    }

    // Preserve state for recovery
    const stateSnapshot = {
      tabId: this.state.tabId,
      connected: this.state.connected,
      temporarilyDetached: this.state.temporarilyDetached,
      isReattaching: this.isReattaching
    };

    try {
      // Check if handler exists
      const handler = this.handlers[type];
      if (!handler) {
        console.warn('[Background] No handler for message type:', type);
        await this.safeSendResponse(id, {
          error: `Unknown message type: ${type}`,
          errorType: 'handler_not_found'
        });
        return; // Explicitly return, don't continue
      }

      // Execute handler with timeout protection
      const handlerTimeout = 30000; // 30 seconds
      const handlerPromise = handler(payload !== undefined ? payload : {});

      const result = await Promise.race([
        handlerPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Handler timeout')), handlerTimeout)
        )
      ]);

      // Send success response
      await this.safeSendResponse(id, { result });

    } catch (error) {
      // Classify and handle error appropriately
      console.error('[Background] Handler error:', error);
      this.recordBackgroundError({ level: 'error', source: 'handler', message: error.message || String(error), stack: error.stack || null });

      const errorClassification = this.classifyError(error);

      // Handle based on classification
      switch (errorClassification.category) {
        case 'graceful_detachment':
          await this.handleGracefulDetachment(id, error, stateSnapshot);
          break;

        case 'temporary_failure':
          await this.handleTemporaryFailure(id, error, stateSnapshot);
          break;

        case 'recoverable_error':
          await this.handleRecoverableError(id, error, stateSnapshot);
          break;

        default:
          await this.handleCriticalError(id, error, stateSnapshot);
      }

      // CRITICAL: Never let errors propagate beyond this point
      // This ensures errors are fully contained and don't cause detachment
    }

    console.log('[Background] Message handling complete for:', type);
  }

  /**
   * Classify error to determine appropriate handling
   * All errors are marked as non-detachment to prevent tab disconnection
   */
  classifyError(error) {
    // Graceful detachment - expected state change
    if (error.isGracefulDetachment) {
      return {
        category: 'graceful_detachment',
        severity: 'info',
        recoverable: true,
        requiresDetachment: false
      };
    }

    // WebSocket communication errors
    if (error.message?.includes('WebSocket') ||
        error.message?.includes('send failed') ||
        error.message?.includes('not connected')) {
      return {
        category: 'temporary_failure',
        severity: 'warning',
        recoverable: true,
        requiresDetachment: false
      };
    }

    // CDP/Debugger detachment errors
    if (error.message?.includes('Detached') ||
        error.message?.includes('detached') ||
        error.message?.includes('debugger')) {
      return {
        category: 'recoverable_error',
        severity: 'warning',
        recoverable: true,
        requiresDetachment: false
      };
    }

    // Tab not found or closed
    if (error.message?.includes('tab') &&
        error.message?.includes('not found')) {
      return {
        category: 'recoverable_error',
        severity: 'error',
        recoverable: true,
        requiresDetachment: false
      };
    }

    // Timeout errors
    if (error.message?.includes('timeout')) {
      return {
        category: 'temporary_failure',
        severity: 'warning',
        recoverable: true,
        requiresDetachment: false
      };
    }

    // Unknown/critical errors - still don't detach!
    return {
      category: 'critical_error',
      severity: 'error',
      recoverable: false,
      requiresDetachment: false
    };
  }

  /**
   * Handle graceful detachment errors
   * Marks tab as temporarily detached without disconnecting
   */
  async handleGracefulDetachment(requestId, error, stateSnapshot) {
    console.log('[Background] Graceful detachment - tab became inaccessible');

    if (!this.state.temporarilyDetached) {
      this.state.temporarilyDetached = true;
    }

    await this.safeSendResponse(requestId, {
      error: `Tab is temporarily inaccessible (${error.reason || 'restricted URL'}). The connection remains active.`,
      errorType: 'graceful_detachment',
      reason: error.reason,
      recoverable: true
    });
  }

  /**
   * Handle temporary failures (WebSocket, network issues)
   * Suggests retry without changing state
   */
  async handleTemporaryFailure(requestId, error, stateSnapshot) {
    console.warn('[Background] Temporary failure:', error.message);

    await this.safeSendResponse(requestId, {
      error: error.message,
      errorType: 'temporary_failure',
      suggestion: 'This is a temporary issue. Please retry the operation.',
      recoverable: true
    });
  }

  /**
   * Handle recoverable errors (CDP detachment, tab issues)
   * Triggers automatic recovery mechanisms
   */
  async handleRecoverableError(requestId, error, stateSnapshot) {
    console.warn('[Background] Recoverable error:', error.message);

    // Trigger reattachment if needed
    if (error.message?.includes('Detached') &&
        !this.isReattaching &&
        this.state.tabId) {
      console.log('[Background] Triggering reattachment due to error');
      this.attemptReattachWithRetry(this.state.tabId, 0);
    }

    await this.safeSendResponse(requestId, {
      error: error.message,
      errorType: 'recoverable_error',
      suggestion: 'Automatic recovery in progress. The operation was not completed.',
      recoverable: true
    });
  }

  /**
   * Handle critical errors
   * Logs full details but preserves connection state
   */
  async handleCriticalError(requestId, error, stateSnapshot) {
    console.error('[Background] Critical error:', error.message);
    console.error('[Background] Error stack:', error.stack);
    console.error('[Background] State at error:', stateSnapshot);
    this.recordBackgroundError({ level: 'critical', source: 'handler', message: error.message || String(error), stack: error.stack || null });

    await this.safeSendResponse(requestId, {
      error: error.message,
      errorType: 'critical_error',
      suggestion: 'This is an unexpected error. The extension state has been preserved.',
      recoverable: false
    });

    // IMPORTANT: Even critical errors don't trigger detachment
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
        try {
          const wsState = await this.ws.getState();
          sendResponse({
            success: true,
            data: {
              connected: this.state.connected,
              wsState: wsState,
              debuggerAttached: this.cdp.isAttached(),
              tabId: this.state.tabId,
              tabUrl: this.state.tabUrl,
              tabTitle: this.state.tabTitle,
              recordingRequest: this.currentRecordingRequest || null,
              isRecording: false,
              sessionRecording: this.sessionRecording ? { startTime: this.sessionRecording.startTime } : null,
            }
          });
        } catch (error) {
          sendResponse({
            success: true,
            data: {
              connected: this.state.connected,
              wsState: 'disconnected',
              debuggerAttached: this.cdp.isAttached(),
              tabId: this.state.tabId,
              tabUrl: this.state.tabUrl,
              tabTitle: this.state.tabTitle,
              recordingRequest: this.currentRecordingRequest || null,
              isRecording: false,
              sessionRecording: this.sessionRecording ? { startTime: this.sessionRecording.startTime } : null,
            }
          });
        }
        break;

      case 'ensure_attached':
        try {
          const result = await this.handleEnsureAttached(message.payload || {});
          sendResponse({ success: true, data: result });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;

      case 'list_attached_tabs':
        try {
          const tabs = this.tabManager.listTabs();
          const lastUsedTabId = this.tabManager.getLastUsedTabId();
          const tabsWithActiveFlag = tabs.map(tab => ({
            ...tab,
            isActive: tab.tabId === lastUsedTabId
          }));
          sendResponse({ success: true, tabs: tabsWithActiveFlag });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;

      case 'set_tab_label':
        try {
          const { tabId, label } = message.payload;
          this.tabManager.setTabLabel(tabId, label);
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;

      case 'detach_tab':
        try {
          const { tabId } = message.payload;
          await this.tabManager.detachTab(tabId);
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;

      case 'start_session_recording':
        try {
          await this.handleStartSessionRecording(sendResponse);
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;

      case 'stop_session_recording':
        try {
          await this.handleStopSessionRecording(sendResponse);
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;

      case 'get_session_recording_state':
        sendResponse({
          success: true,
          sessionRecording: this.sessionRecording ? {
            sessionId: this.sessionRecording.sessionId,
            tabId: this.sessionRecording.tabId,
            startTime: this.sessionRecording.startTime,
            startUrl: this.sessionRecording.startUrl,
            rrwebEventCount: this.sessionRecording.rrwebEvents.length,
            networkEntryCount: this.sessionRecording.networkEntries.length,
            pageCount: this.sessionRecording.pages.length,
          } : null,
        });
        break;

      default:
        // Let other listeners handle non-popup messages
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  }

  /**
   * Start a session recording: rrweb DOM capture + network interceptor + video
   * Survives cross-domain navigation via chrome.storage.session.
   */
  /**
   * Inject the capture scripts into a tab that is joining an in-flight session.
   * Mirrors the injection in handleStartSessionRecording / the onUpdated
   * re-injection path: MAIN world first (network interceptor bypasses CSP),
   * then the isolated-world rrweb recorder.
   * Deliberately NOT injecting annotation-tool/session-record-overlay — those
   * are primary-tab UI affordances, not capture.
   */
  async _injectSessionRecorderInto(tabId) {
    chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      files: ['lib/network-interceptor.js'],
    }).catch(err => {
      console.warn('[Background] Auto-capture: network interceptor inject failed:', err.message);
    });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['lib/rrweb-record.min.js', 'session-recorder.js'],
    }).catch(err => {
      console.warn('[Background] Auto-capture: session recorder inject failed:', err.message);
    });
  }

  /**
   * Start or extend session capture when a tab is attached (ben 2026-08-02).
   *
   * Two cases: a recording is already running → fold this tab into it (one
   * shared timeline, which is what makes a human's actions and an agent's
   * appear in order in a single replay); nothing running → start one on this
   * tab.
   *
   * ⛔ NEVER THROWS. Capture is a side benefit of attaching; attaching is the
   * thing the caller actually asked for. A failure here (restricted URL, tab
   * closed mid-flight, scripting permission) must not turn a working
   * browser_attach_tab into an error.
   */
  async _maybeAutoCapture(tabId, enabled) {
    if (!enabled || !SESSION_AUTO_CAPTURE_ON_ATTACH) return;
    try {
      if (this.sessionRecording) {
        // Defensive: a recording rehydrated from chrome.storage.session after a
        // service-worker restart can come back without its arrays.
        if (!Array.isArray(this.sessionRecording.tabIds)) this.sessionRecording.tabIds = [];
        if (!this.sessionRecording.tabIds.includes(tabId)) {
          this.sessionRecording.tabIds.push(tabId);
          await this._injectSessionRecorderInto(tabId);
          console.log(`[Background] Auto-capture: tab ${tabId} joined session ${this.sessionRecording.sessionId}`);
        }
        return;
      }
      await new Promise((resolve) =>
        this.handleStartSessionRecording(resolve, { tabTarget: tabId, autoStarted: true })
      );
      console.log(`[Background] Auto-capture: started session recording on attach of tab ${tabId}`);
    } catch (err) {
      console.warn('[Background] Auto-capture failed (the attach itself is unaffected):', err?.message || err);
    }
  }

  /**
   * Bound an auto-started recording's in-memory buffers.
   *
   * ⚠️ THE RRWEB BUFFER CANNOT BE HEAD-DROPPED. Its incremental events are
   * DIFFS against the DOM built by a preceding FullSnapshot. Cutting at an
   * arbitrary offset leaves events referencing nodes that were never created:
   * the buffer is still non-empty, still uploads, still opens in the review
   * UI — and replays as a blank or corrupt page. That failure is invisible
   * until someone actually watches a recording, which is exactly when they
   * need it. So we only ever cut back to a FullSnapshot boundary (paired with
   * its preceding Meta event, which carries the viewport).
   *
   * Those boundaries exist only because session-recorder.js sets
   * `checkoutEveryNms` — without it rrweb emits one FullSnapshot at index 0
   * and NOTHING here can trim. If you ever see the buffer running far past
   * SESSION_MAX_RRWEB_EVENTS, check that option first.
   */
  _trimSessionBuffers() {
    const r = this.sessionRecording;
    if (!r) return;

    const ev = r.rrwebEvents;
    if (ev && ev.length > SESSION_MAX_RRWEB_EVENTS) {
      // Smallest cut index that gets us under the cap == keep the most data.
      let cut = -1;
      for (let i = 0; i < ev.length; i++) {
        if (ev[i]?.type !== RRWEB_TYPE_FULL_SNAPSHOT) continue;
        if (ev.length - i <= SESSION_MAX_RRWEB_EVENTS) { cut = i; break; }
      }
      if (cut > 0) {
        // Keep the Meta immediately preceding the snapshot — rrweb emits
        // Meta+FullSnapshot as a pair on checkout and the replayer needs the
        // viewport dimensions from it.
        if (cut - 1 >= 0 && ev[cut - 1]?.type === RRWEB_TYPE_META) cut -= 1;
        const dropped = ev.splice(0, cut).length;
        r.droppedRrwebEvents = (r.droppedRrwebEvents || 0) + dropped;
        r.trimmedAt = Date.now();
        console.log(
          `[Background] Session buffer trimmed to snapshot boundary: dropped ${dropped} rrweb events ` +
          `(${ev.length} retained, ${r.droppedRrwebEvents} dropped this session)`
        );
      }
      // cut === -1 → no snapshot recent enough to cut to. Leave it: an
      // oversized REPLAYABLE buffer beats a trimmed corrupt one. Self-corrects
      // at the next checkout.
    }

    // Independent records — no replay dependency, safe to head-drop.
    if (r.networkEntries && r.networkEntries.length > SESSION_MAX_NETWORK_ENTRIES) {
      r.networkEntries.splice(0, r.networkEntries.length - SESSION_MAX_NETWORK_ENTRIES);
    }
    if (r.interactions && r.interactions.length > SESSION_MAX_INTERACTIONS) {
      r.interactions.splice(0, r.interactions.length - SESSION_MAX_INTERACTIONS);
    }
  }

  async handleStartSessionRecording(sendResponse, params = {}) {
    if (this.sessionRecording) {
      sendResponse({ success: false, error: 'A session recording is already in progress' });
      return;
    }

    // When called from the popup with no params, fall back to the legacy
    // "active tab in last-focused window" behavior. When an agent calls with
    // tabTarget, target that specific tab — this is how an agent recording
    // its own sidecar chromium's flow gets the right tab (since the sidecar's
    // chromium has no OS focus, "active+lastFocusedWindow" picks up nothing
    // or the wrong tab).
    let tabId = null;
    let startUrl = '';
    const explicitTarget = params.tabTarget;
    if (explicitTarget !== undefined && explicitTarget !== null && explicitTarget !== '') {
      const tabInfo = this.tabManager.resolveTab(explicitTarget);
      if (!tabInfo) {
        sendResponse({ success: false, error: `Tab ${explicitTarget} not found in attached tabs. Use browser_attach_tab first.` });
        return;
      }
      tabId = tabInfo.tabId;
      startUrl = tabInfo.url || '';
    } else {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!activeTab || !activeTab.id) {
        sendResponse({ success: false, error: 'No active tab found. In multi-extension mode or for headless sidecar chromiums, pass tabTarget explicitly (e.g. tabTarget: <tabId> or a labeled tab).' });
        return;
      }
      tabId = activeTab.id;
      startUrl = activeTab.url || '';
    }

    // Auto-attach the debugger to the recording tab if it isn't already.
    // Without this, popup-driven recording works for rrweb (script injection
    // is debugger-independent) but agent tools targeting the same tab can't
    // act on it. Doing it here removes the "click Attach, then click Record"
    // grind ben hit on 2026-06-27.
    if (!this.tabManager.attachedTabs.has(tabId)) {
      try {
        // autoCapture:false breaks the attach → auto-capture → start-recording
        // → attach cycle. `this.sessionRecording` is still null at this point,
        // so the "already recording" guard above cannot stop the recursion.
        await this.handleEnsureAttached({ tabId, autoCapture: false });
      } catch (attachErr) {
        sendResponse({
          success: false,
          error: `Couldn't attach to the recording tab: ${attachErr?.message || attachErr}. ` +
            'If this tab is owned by another extension (e.g. a New Tab override), ' +
            'navigate to a regular URL first then retry.'
        });
        return;
      }
    }

    const sessionId = `sr-${Date.now()}`;
    const startTime = Date.now();

    this.sessionRecording = {
      sessionId,
      tabId,              // Primary tab (for video capture)
      tabIds: [tabId],    // All tabs being recorded (grows as new tabs open)
      recordedTabIds: [], // Tabs that have an active video recording
      videoStartTimes: {}, // tabId → epoch ms when video started
      startTime,
      startUrl,
      rrwebEvents: [],
      networkEntries: [],
      interactions: [],
      annotations: [],    // user-drawn shapes + notes + screenshots (SR_ANNOTATION_CREATE flow)
      pages: [],
      videoStarted: false,
      // True when this recording was started implicitly by attaching a tab
      // rather than by an explicit browser_start_session_recording / popup
      // click. Gates video (ben: automatic recording is DOM-only) and marks
      // the recording as long-lived, i.e. subject to the rolling-window trim.
      autoStarted: params.autoStarted === true,
      droppedRrwebEvents: 0,
    };

    // Inject network interceptor into page's MAIN world (bypasses CSP)
    // allFrames: true injects into the main frame AND all already-loaded child frames.
    // Frames that load later are handled by the webNavigation.onCompleted listener.
    chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      files: ['lib/network-interceptor.js']
    }).catch(err => {
      console.warn('[Background] Could not inject network interceptor:', err.message);
    });

    // Inject rrweb + session-recorder into ISOLATED world (all frames)
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['lib/rrweb-record.min.js', 'session-recorder.js']
      });
    } catch (err) {
      console.warn('[Background] Could not inject session recorder:', err.message);
    }

    // Inject annotation tooling + the floating session-record overlay (with
    // "✏️ Annotate" button) into the primary tab only — agents can annotate
    // on the main flow tab; child iframes don't need the UI.
    //
    // ⛔ NEVER for an auto-started recording. The overlay is a fixed-position
    // pill at z-index 2147483646 anchored bottom-right, and it EATS CLICKS on
    // whatever sits underneath it. `storybook` lost an hour to this on
    // 2026-08-02: `elementFromPoint()` at the centre of a real "Order print"
    // button returned `__unibrowse_sr_overlay`, three controls were genuinely
    // unclickable, and the clicks landed on glass.
    //
    // ⭐ The expensive part was the misdiagnosis, not the dead controls: the
    // handler ran fine when invoked directly, so a TRUE tester report ("these
    // three don't work") was retracted and the tester blamed. Verifying "does
    // the handler work?" cannot detect a click that never arrives.
    //
    // The instrument was changing what it measured. Auto-capture makes that
    // strictly worse — it puts the pill on the FIRST TAB ANY AGENT ATTACHES,
    // fleet-wide, where previously it appeared only if a human deliberately
    // started recording. The pill is a human affordance (drag, annotate); an
    // agent driving a page needs none of it. So an implicit recording captures
    // silently and paints nothing.
    if (!this.sessionRecording.autoStarted) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['annotation-tool.js', 'session-record-overlay.js'],
        });
      } catch (err) {
        console.warn('[Background] Could not inject session-record overlay/annotation:', err.message);
      }
    } else {
      console.log('[Background] Auto-started session: overlay/annotation UI suppressed (would intercept page clicks)');
    }

    // Start tab capture video for primary tab.
    // ⛔ NOT for auto-started recordings. ben, 2026-08-02: "we have tabs
    // attached for very long time so I don't want to just be recording
    // endlessly … video recording automatically only when specified but DOM
    // capturing everything I think is still good." Video is tab-capture — it
    // costs real CPU/disk and shows a capture indicator on every tab — so an
    // implicit, possibly-days-long recording must not start one. An explicit
    // browser_start_session_recording or popup click still does.
    if (!this.sessionRecording.autoStarted || SESSION_AUTO_CAPTURE_VIDEO) {
      this.startSessionTabVideo(tabId);
    } else {
      console.log('[Background] Auto-started session: DOM+network only, video suppressed by design');
    }

    // Set badge
    chrome.action.setBadgeText({ text: 'SR' });
    chrome.action.setBadgeBackgroundColor({ color: '#6f42c1' });

    // Persist
    chrome.storage.session.set({ sessionRecording: this.sessionRecording }).catch(() => {});

    sendResponse({ success: true, sessionId, startTime });
  }

  /**
   * Start tab capture video for a specific tab within the current session recording.
   */
  startSessionTabVideo(tabId) {
    if (!this.sessionRecording) return;
    if (this.sessionRecording.recordedTabIds.includes(tabId)) return; // Already recording

    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        console.warn(`[Background] tabCapture unavailable for tab ${tabId}:`, chrome.runtime.lastError?.message);
        return;
      }
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_START_TAB_RECORDING', streamId, tabId }).then(() => {
        if (!this.sessionRecording) return;
        this.sessionRecording.recordedTabIds.push(tabId);
        this.sessionRecording.videoStartTimes[tabId] = Date.now();
        if (!this.sessionRecording.videoStarted) {
          this.sessionRecording.videoStarted = true;
        }
        console.log(`[Background] Session video started for tab ${tabId}`);
      }).catch(err => {
        console.warn(`[Background] Could not start video for tab ${tabId}:`, err.message);
      });
    });
  }

  /**
   * Stop a session recording: finalize video, upload everything to server, open review.
   */
  async handleStopSessionRecording(sendResponse, params = {}) {
    if (!this.sessionRecording) {
      sendResponse({ success: false, error: 'No session recording in progress' });
      return;
    }
    // Agents driving headless sidecar chromiums often don't want a review tab
    // auto-opening in their own pool (it's just noise — they get the reviewUrl
    // back in the response and share it with the user). Default true so popup
    // / user-initiated stops still get the auto-open. Pass openReview:false
    // from agent tool calls.
    const shouldOpenReview = params.openReview !== false;

    const recording = this.sessionRecording;
    this.sessionRecording = null;

    // Clear badge
    chrome.action.setBadgeText({ text: '' });
    chrome.storage.session.remove('sessionRecording').catch(() => {});

    // Tear down the floating "Recording / ✏️ Annotate" overlay in every
    // recorded tab so the user doesn't see a stale indicator while the
    // upload pipeline finishes.
    for (const tabId of new Set([recording.tabId, ...(recording.recordedTabIds || [])])) {
      if (tabId == null) continue;
      try {
        chrome.tabs.sendMessage(tabId, { type: 'SR_OVERLAY_DESTROY' }).catch(() => {});
      } catch { /* tab may have closed */ }
    }

    // Close last page entry
    const endTime = Date.now();
    const lastPage = recording.pages[recording.pages.length - 1];
    if (lastPage && !lastPage.endTime) lastPage.endTime = endTime;

    // Stop all tab videos. For recordings whose base64 is small enough to fit
    // in a single chrome.runtime.sendMessage response (<32 MiB), the offscreen
    // returns videoBase64 inline. For larger recordings (which previously
    // blew up with "Message exceeded maximum allowed size of 64MiB"), the
    // offscreen returns metadata + holds the data, and we fetch it in chunks.
    const tabVideos = []; // { tabId, videoBase64, mimeType }
    for (const recordedTabId of (recording.recordedTabIds || [])) {
      try {
        const videoResponse = await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_TAB_RECORDING', tabId: recordedTabId });
        if (!videoResponse?.success) {
          console.warn(`[Background] Video stop returned no success for tab ${recordedTabId}`);
          continue;
        }
        let videoBase64 = videoResponse.videoBase64;
        if (videoResponse.chunked) {
          const { chunkCount, totalBase64Length, tabId: tabKey } = videoResponse;
          console.log(`[Background] Tab ${recordedTabId} video chunked: ${chunkCount} chunks, total ${totalBase64Length} b64 chars`);
          const parts = new Array(chunkCount);
          for (let i = 0; i < chunkCount; i++) {
            const chunkResp = await chrome.runtime.sendMessage({
              type: 'OFFSCREEN_GET_VIDEO_CHUNK',
              tabId: tabKey,
              chunkIndex: i,
            });
            if (!chunkResp?.success) {
              throw new Error(`Chunk ${i} fetch failed: ${chunkResp?.error || 'no response'}`);
            }
            parts[i] = chunkResp.chunk;
          }
          // Release the holding pen so memory frees regardless of upload outcome.
          await chrome.runtime.sendMessage({ type: 'OFFSCREEN_RELEASE_VIDEO', tabId: tabKey }).catch(() => {});
          videoBase64 = parts.join('');
        }
        if (videoBase64) {
          tabVideos.push({ tabId: recordedTabId, videoBase64, mimeType: videoResponse.mimeType || 'video/webm' });
          console.log(`[Background] Video stopped for tab ${recordedTabId}:`, videoResponse.byteLength, 'bytes');
        }
      } catch (err) {
        console.warn(`[Background] Video stop failed for tab ${recordedTabId}:`, err.message);
      }
    }

    // Build metadata for the server
    let hostname = recording.startUrl;
    try { hostname = new URL(recording.startUrl).hostname; } catch {}
    const autoTitle = `Session: ${hostname} @ ${new Date(recording.startTime).toLocaleTimeString()}`;
    const metadata = {
      sessionId: recording.sessionId,
      title: recording.title || autoTitle,
      description: '',
      tags: ['session-recording'],
      startUrl: recording.startUrl,
      startTime: recording.startTime,
      endTime,
      duration: endTime - recording.startTime,
      pages: recording.pages,
      rrwebEventCount: recording.rrwebEvents.length,
      networkEntryCount: recording.networkEntries.length,
      interactionCount: (recording.interactions || []).length,
      annotationCount: (recording.annotations || []).length,
      status: 'complete',
      primaryTabId: recording.tabId,
      recordedTabIds: recording.recordedTabIds || [],
      videoStartTimes: recording.videoStartTimes || {},
    };

    // Route to the server bound to the PRIMARY recorded tab so a tab assigned
    // to a remote server uploads its recording to THAT server rather than the
    // extension's default. Falls back to the default if no per-tab binding exists.
    const primaryTabId = recording.tabId
                       || (recording.recordedTabIds && recording.recordedTabIds[0])
                       || null;
    const cfg = primaryTabId != null
      ? await getServerForTab(primaryTabId)
      : (this.serverConfig || await resolveServerConfig());
    const SERVER_BASE = cfg.httpUrl || 'http://localhost:9010';
    const authHeaders = cfg.apiKey ? { 'Authorization': `Bearer ${cfg.apiKey}` } : {};
    console.log(`[Background] Recording upload routed to ${cfg.name || cfg.httpUrl} (source: ${cfg.source})`);

    try {
      // 1. Create recording metadata
      const createResp = await fetch(`${SERVER_BASE}/api/v1/recordings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(metadata),
      });
      const createData = await createResp.json();
      if (!createData.id) throw new Error('Server did not return recording id');
      const recordingId = createData.id;

      // 2. Upload per-tab videos (fire and forget)
      for (const tv of tabVideos) {
        const binaryStr = atob(tv.videoBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const blob = new Blob([bytes.buffer], { type: tv.mimeType });
        fetch(`${SERVER_BASE}/api/v1/recordings/${recordingId}/video/${tv.tabId}`, {
          method: 'POST',
          headers: { 'Content-Type': tv.mimeType, ...authHeaders },
          body: blob,
        }).then(r => r.json()).then(d => {
          console.log(`[Background] Video uploaded for tab ${tv.tabId}:`, d);
        }).catch(err => {
          console.warn(`[Background] Video upload failed for tab ${tv.tabId}:`, err.message);
        });
      }

      // 3. Upload rrweb events + network entries + interactions.
      // Two issues to handle:
      //  (a) MV3 service worker can terminate mid-fetch — must await every POST
      //      before sendResponse, or the SW dies and silently drops the upload.
      //  (b) Mongo doc limit is 16MB. Long sessions with many iframes (e.g.
      //      shaws.com/weeklyad) easily exceed that, so we chunk client-side
      //      into ~12MB batches; each chunk becomes its own Mongo doc and the
      //      server aggregates them on read.
      const CHUNK_BYTES = 12 * 1024 * 1024; // ~12MB per chunk, headroom under 16MB Mongo limit
      const eventsUploadStatus = { chunks: 0, totalBytes: 0, errors: [] };
      const allRrweb = recording.rrwebEvents || [];
      const allNetwork = recording.networkEntries || [];
      const allInteractions = recording.interactions || [];
      const allAnnotations = recording.annotations || [];
      // Annotations carry base64 PNG screenshots (often 100-300KB each) so
      // they can't ride along with the other event chunks without blowing
      // past the 12MB chunk cap unpredictably. Upload them on their own
      // endpoint, one per request, so each one stays under the Mongo doc
      // limit even with high-DPI viewport screenshots.
      for (let i = 0; i < allAnnotations.length; i++) {
        const a = allAnnotations[i];
        try {
          const resp = await fetch(`${SERVER_BASE}/api/v1/recordings/${recordingId}/annotations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify(a),
          });
          if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
          }
        } catch (err) {
          console.error(`[Background] Annotation ${i + 1}/${allAnnotations.length} upload failed:`, err.message);
        }
      }
      if (allRrweb.length > 0 || allNetwork.length > 0 || allInteractions.length > 0) {
        const chunks = chunkEventsBySize(allRrweb, allNetwork, allInteractions, CHUNK_BYTES);
        console.log(`[Background] Uploading session events: ${chunks.length} chunks, ${allRrweb.length} rrweb / ${allNetwork.length} network / ${allInteractions.length} interactions`);
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const body = JSON.stringify({ ...chunk, chunkIndex: i });
          eventsUploadStatus.totalBytes += body.length;
          try {
            const url = `${SERVER_BASE}/api/v1/recordings/${recordingId}/events${i === 0 ? '?reset=1' : ''}`;
            const resp = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeaders },
              body,
            });
            if (!resp.ok) {
              const text = await resp.text().catch(() => '');
              throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
            }
            await resp.json();
            eventsUploadStatus.chunks++;
          } catch (err) {
            console.error(`[Background] Chunk ${i}/${chunks.length} upload failed:`, err.message);
            eventsUploadStatus.errors.push({ chunkIndex: i, error: err.message });
          }
        }
        console.log(`[Background] Session events upload done: ${eventsUploadStatus.chunks}/${chunks.length} chunks, ${(eventsUploadStatus.totalBytes / 1024 / 1024).toFixed(1)}MB total`);
      }

      const reviewUrl = `${SERVER_BASE}/review/${recordingId}`;
      sendResponse({ success: true, recordingId, reviewUrl, eventsUploadStatus });

      // Open the review tab from BACKGROUND — popup.js used to do this on
      // sendMessage response, but MV3 popups close on focus loss and the
      // upload + chunking takes several seconds for a real session. The
      // sendResponse fires into a dead popup → chrome.tabs.create never runs
      // → ben sees "recording done" toast but no review window opens
      // (observed 2026-06-04). Background's chrome.tabs.create is unaffected
      // by popup lifecycle. Wrapped in try/catch since this is best-effort
      // and shouldn't break the upload path if the tab creation API errors.
      if (shouldOpenReview) {
        try {
          await chrome.tabs.create({ url: reviewUrl, active: true });
        } catch (e) {
          console.warn('[Background] Failed to auto-open review tab:', e?.message || e);
        }
      }
    } catch (err) {
      console.error('[Background] Failed to save session recording:', err);
      sendResponse({ success: false, error: err.message });
    }
  }

  // ==================== PLACEHOLDER HANDLERS ====================
  // These will be replaced by imports from handlers/ directory
  //
  // TODO: Multi-tab refactoring - The following handlers need to be updated:
  // - Add 'tabTarget' parameter to function signature
  // - Call: const cdp = await this.tabManager.requireCDP(tabTarget);
  // - Replace all 'this.cdp' with 'cdp' within the handler
  //
  // Updated handlers: handleNavigate, handleGoBack, handleGoForward, handleClick,
  //                   handleType, handleSnapshot, handleScreenshot, handleEvaluate,
  //                   handleGetUrl, handleGetTitle
  //
  // Remaining handlers to update (~25): handleHover, handleDrag, handleSelectOption,
  //   handlePressKey, handleScroll, handleScrollToElement, handleRealisticMouseMove,
  //   handleRealisticClick, handleRealisticType, handleFillForm, handleSubmitForm,
  //   handleQueryDOM, handleGetVisibleText, handleGetComputedStyles,
  //   handleCheckVisibility, handleGetAttributes, handleCountElements,
  //   handleGetPageMetadata, handleGetFilteredAriaTree, handleFindByText,
  //   handleGetFormValues, handleCheckElementState, handleGetNetworkState,
  //   handleSetNetworkConditions, handleClearCache

  async handleNavigate({ url, tabTarget, focus }) {
    // When tabTarget is omitted, AUTO-CREATE a fresh attached tab at the URL
    // instead of falling back to the global lastUsedTabId. Shared unibrowse
    // servers serve many agents at once; the old fallback meant "whoever
    // navigated last wins" and other agents' tabs got hijacked mid-flow.
    // Auto-creating gives each agent its own tab without needing to think
    // about it. To navigate an existing tab, pass an explicit tabTarget.
    if (tabTarget === undefined || tabTarget === null || tabTarget === "") {
      const created = await this.handleCreateTab({ url, focus });
      return {
        success: true,
        url: created.url || url,
        tabId: created.tabId,
        label: created.label,
        autoCreated: true,
      };
    }
    const cdp = await this.tabManager.requireCDP(tabTarget);
    await cdp.navigate(url);
    return { success: true, url };
  }

  async handleGoBack({ tabTarget }) {
    const cdp = await this.tabManager.requireCDP(tabTarget);
    await cdp.goBack();
    return { success: true };
  }

  async handleGoForward({ tabTarget }) {
    const cdp = await this.tabManager.requireCDP(tabTarget);
    await cdp.goForward();
    return { success: true };
  }

  async handleWait({ time }) {
    await new Promise(resolve => setTimeout(resolve, time * 1000));
    return { success: true, time };
  }

  /**
   * Start a navigation observer scoped to a tab + regex pattern. Returns a
   * subscriptionId the caller uses for subsequent first/dispose calls. The
   * observer buffers webNavigation.onCommitted events whose URL matches the
   * pattern from arm-time onward, so the caller can ARM BEFORE a click that
   * triggers a transient redirect and reliably retrieve the matching URL
   * even if the page redirected onward in <50ms. Resolves the polling race
   * that bit ctx.waitForUrl on re-consent OAuth callbacks.
   */
  async handleObserveNavStart({ pattern, flags, tabTarget }) {
    if (!pattern) throw new Error('pattern is required');
    // Resolve tabTarget to a concrete tabId. tabTarget may be a label
    // (string) or a numeric id; the existing TabManager.resolveTab handles
    // both. Null tabTarget = observe across all tabs (rare; usually scoped).
    let tabId = null;
    if (tabTarget != null && tabTarget !== '') {
      const info = this.tabManager.resolveTab(tabTarget);
      if (!info) throw new Error(`Tab ${tabTarget} not found in attached tabs`);
      tabId = info.tabId;
    }
    let regex;
    try { regex = new RegExp(pattern, flags || ''); }
    catch (e) { throw new Error(`Invalid pattern regex: ${e.message}`); }
    const subId = `nav-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    this.navObservers.set(subId, {
      regex, tabId,
      matches: [],
      pendingResolvers: [],
      createdAt: Date.now(),
    });
    return { subscriptionId: subId, armed: true, tabId };
  }

  /**
   * Wait for the first navigation match on the subscription. If a match has
   * ALREADY arrived between start and now, returns it immediately. Otherwise
   * blocks until the next match OR the per-call timeout (default 15s). The
   * subscription remains active after first() returns — caller may invoke
   * first() multiple times to drain in arrival order, then dispose().
   */
  async handleObserveNavFirst({ subscriptionId, timeoutMs }) {
    const sub = this.navObservers.get(subscriptionId);
    if (!sub) throw new Error(`Unknown subscriptionId: ${subscriptionId}`);
    // Already have a match? Return the oldest unread.
    if (sub.matches.length > 0) {
      const m = sub.matches.shift();
      return { matched: true, ...m };
    }
    const deadlineMs = Math.max(100, Math.min(timeoutMs || 15000, 120000));
    return await new Promise((resolve) => {
      let settled = false;
      const settle = (val) => { if (!settled) { settled = true; resolve(val); } };
      const onMatch = (m) => settle({ matched: true, ...m });
      sub.pendingResolvers.push(onMatch);
      setTimeout(() => {
        // Pull the resolver back out of the queue so it can't fire later
        const idx = sub.pendingResolvers.indexOf(onMatch);
        if (idx >= 0) sub.pendingResolvers.splice(idx, 1);
        settle({ matched: false, timeoutMs: deadlineMs });
      }, deadlineMs);
    });
  }

  async handleObserveNavDispose({ subscriptionId }) {
    const existed = this.navObservers.delete(subscriptionId);
    return { success: true, existed };
  }

  async handleClick({ element, ref, tabTarget, frameTarget }) {
    const cdp = await this.tabManager.requireCDP(tabTarget);

    // Get element position (frame-aware)
    const elemInfo = frameTarget
      ? await cdp.querySelectorInFrame(await this.resolveFrameId(cdp, frameTarget), ref)
      : await cdp.querySelector(ref);
    if (!elemInfo) {
      throw new Error(`Element not found: ${ref}`);
    }

    // Click at element center (coordinates are already viewport-relative)
    const x = elemInfo.rect.x + elemInfo.rect.width / 2;
    const y = elemInfo.rect.y + elemInfo.rect.height / 2;
    await cdp.click(x, y);

    return { success: true, element, ref };
  }

  async handleType({ element, ref, text, submit, tabTarget, frameTarget }) {
    try {
      const cdp = await this.tabManager.requireCDP(tabTarget);

      // Focus the element first by clicking it (frame-aware)
      const elemInfo = frameTarget
        ? await cdp.querySelectorInFrame(await this.resolveFrameId(cdp, frameTarget), ref)
        : await cdp.querySelector(ref);
      if (!elemInfo) {
        throw new Error(`Element not found: ${ref}`);
      }

      const x = elemInfo.rect.x + elemInfo.rect.width / 2;
      const y = elemInfo.rect.y + elemInfo.rect.height / 2;

      // Check if still attached before clicking
      if (!cdp.isAttached() || cdp.isDetaching) {
        throw new Error('Debugger detached before typing could start');
      }

      await cdp.click(x, y);

      // Wait a moment for focus
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if still attached before typing
      if (!cdp.isAttached() || cdp.isDetaching) {
        throw new Error('Debugger detached before typing could start');
      }

      // Type the text (this will throw if detachment occurs mid-typing)
      await cdp.type(text);

      // Submit if requested (only if still attached)
      if (submit && cdp.isAttached() && !cdp.isDetaching) {
        await cdp.pressKey('Enter');
      }

      return { success: true, element, text };
    } catch (error) {
      // Provide better error messages for detachment scenarios
      if (error.message && (error.message.includes('Detached') || error.message.includes('detached'))) {
        throw new Error(`Typing operation interrupted: debugger detached (page navigation, frame update, or dynamic content change). Partial text may have been entered. The browser will attempt to reconnect automatically.`);
      }
      throw error;
    }
  }

  async handleHover({ element, ref, tabTarget, frameTarget }) {
    const cdp = await this.tabManager.requireCDP(tabTarget);

    // Get element position (frame-aware)
    const elemInfo = frameTarget
      ? await cdp.querySelectorInFrame(await this.resolveFrameId(cdp, frameTarget), ref)
      : await cdp.querySelector(ref);
    if (!elemInfo) {
      throw new Error(`Element not found: ${ref}`);
    }

    // Move mouse to element center
    const x = elemInfo.rect.x + elemInfo.rect.width / 2;
    const y = elemInfo.rect.y + elemInfo.rect.height / 2;

    await cdp.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y
    });

    return { success: true, element, ref };
  }

  async handleDrag({ startElement, startRef, endElement, endRef, tabTarget, frameTarget }) {
    const cdp = await this.tabManager.requireCDP(tabTarget);

    // Get start element position (frame-aware)
    const resolvedFrameId = frameTarget ? await this.resolveFrameId(cdp, frameTarget) : null;
    const startElemInfo = resolvedFrameId
      ? await cdp.querySelectorInFrame(resolvedFrameId, startRef)
      : await cdp.querySelector(startRef);
    if (!startElemInfo) {
      throw new Error(`Start element not found: ${startRef}`);
    }

    // Get end element position
    const endElemInfo = resolvedFrameId
      ? await cdp.querySelectorInFrame(resolvedFrameId, endRef)
      : await cdp.querySelector(endRef);
    if (!endElemInfo) {
      throw new Error(`End element not found: ${endRef}`);
    }

    // Calculate center coordinates for both elements
    const startX = startElemInfo.rect.x + startElemInfo.rect.width / 2;
    const startY = startElemInfo.rect.y + startElemInfo.rect.height / 2;
    const endX = endElemInfo.rect.x + endElemInfo.rect.width / 2;
    const endY = endElemInfo.rect.y + endElemInfo.rect.height / 2;

    // Perform drag and drop
    await cdp.drag(startX, startY, endX, endY);

    return { success: true, startElement, endElement };
  }

  async handleSelectOption({ element, ref, values, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    // TODO: Select dropdown options
    return { success: true, values };
  }

  async handlePressKey({ key, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    await cdp.pressKey(key);
    return { success: true, key };
  }

  async handleScroll({ x, y, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    await cdp.scroll(x, y);
    return { success: true, x: x ?? 0, y };
  }

  async handleScrollToElement({ element, ref, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    const result = await cdp.scrollToElement(ref);
    if (!result.success) {
      throw new Error(result.error || 'Failed to scroll to element');
    }
    return { success: true, element, ref };
  }

  /**
   * Override the attached tab's viewport via CDP Emulation. Wraps
   * setDeviceMetricsOverride (or clearDeviceMetricsOverride when reset).
   * Lets agents step through breakpoints (390/768/1280…) on a single
   * chromium instance without relaunching — the renderer paints at the
   * requested dimensions regardless of the OS window size, which matters
   * for Xvfb-headful sidecars whose chromium has a ~500px window minimum.
   */
  async handleSetDeviceMetrics({ width, height, deviceScaleFactor, mobile, reset, tabTarget }) {
    const cdp = await this.tabManager.requireCDP(tabTarget);
    if (reset) {
      await cdp.sendCommand('Emulation.clearDeviceMetricsOverride', {});
      return { success: true, reset: true };
    }
    if (typeof width !== 'number' || typeof height !== 'number') {
      throw new Error('width and height are required unless reset:true');
    }
    await cdp.sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: typeof deviceScaleFactor === 'number' ? deviceScaleFactor : 1,
      mobile: !!mobile,
    });
    return { success: true, width, height, deviceScaleFactor: deviceScaleFactor ?? 1, mobile: !!mobile };
  }

  /**
   * Attach local file(s) to an <input type=file> via CDP DOM.setFileInputFiles.
   * JS cannot set input.files (security), so this is the only programmatic path.
   * `paths` must exist on the BROWSER HOST filesystem (the chromium-host sidecar
   * container for isolated chromes). CDP setFileInputFiles fires a TRUSTED
   * 'input'+'change' on the input, so React/framework forms react correctly.
   * DOM domain is enabled on attach (see cdp.js enableDomains), so no enable here.
   */
  async handleSetFileInput({ selector, paths, tabTarget }) {
    const cdp = await this.tabManager.requireCDP(tabTarget);
    if (!selector || typeof selector !== 'string') {
      throw new Error('selector (CSS string) is required');
    }
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('paths (non-empty array of absolute host file paths) is required');
    }

    // Resolve the element to a Runtime objectId (a live handle CDP DOM ops accept).
    const evalRes = await cdp.sendCommand('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)})`,
      returnByValue: false,
    });
    if (evalRes && evalRes.exceptionDetails) {
      const d = evalRes.exceptionDetails;
      throw new Error(`Selector evaluation failed: ${d.exception?.description || d.text || 'unknown error'}`);
    }
    const objectId = evalRes?.result?.objectId;
    if (!objectId) {
      throw new Error(`No element matched selector: ${selector}`);
    }

    try {
      // Guard: confirm it's actually an <input type=file>; capture `multiple`.
      const metaRes = await cdp.sendCommand('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: 'function(){ return JSON.stringify({ tag: this.tagName, type: (this.type || ""), multiple: !!this.multiple }); }',
        returnByValue: true,
      });
      let meta = {};
      try { meta = JSON.parse(metaRes?.result?.value || '{}'); } catch (e) { /* ignore */ }
      if ((meta.tag || '').toUpperCase() !== 'INPUT' || (meta.type || '').toLowerCase() !== 'file') {
        throw new Error(`Selector "${selector}" matched <${(meta.tag || '?').toLowerCase()} type="${meta.type || '?'}">, not an <input type=file>`);
      }
      if (paths.length > 1 && !meta.multiple) {
        throw new Error(`Selector "${selector}" is a single-file input but ${paths.length} paths were given; set one file at a time or target a [multiple] input`);
      }

      // Set the files. This fires a trusted input+change on the element.
      // Success = this call does not throw; CDP rejects if the input refuses the files.
      await cdp.sendCommand('DOM.setFileInputFiles', { files: paths, objectId });

      // Read back what the input holds NOW — INFORMATIONAL ONLY. React/controlled
      // forms synchronously consume the File into component state and CLEAR
      // input.files inside their change handler, so a 0 here is NOT a failure
      // (observed live on united.com — 3/3 uploads succeeded while files.length read 0).
      const backRes = await cdp.sendCommand('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: 'function(){ const f = this.files; return JSON.stringify({ count: f ? f.length : 0, names: f ? Array.from(f).map(x => x.name) : [] }); }',
        returnByValue: true,
      });
      let back = { count: 0, names: [] };
      try { back = JSON.parse(backRes?.result?.value || '{}'); } catch (e) { /* ignore */ }

      // `count`/`names` reflect what we SET (authoritative). `landed` is the
      // possibly-React-cleared read-back — surface a note when it went to 0.
      const requestedNames = paths.map(p => p.split(/[\\/]/).pop());
      const cleared = back.count === 0 && paths.length > 0;
      return {
        success: true,
        selector,
        requested: paths.length,
        count: paths.length,
        names: requestedNames,
        landed: back.count,
        landedNames: back.names,
        multiple: !!meta.multiple,
        note: cleared
          ? 'input.files reads 0 after set — normal for React/controlled forms (they consume the File into state and clear the input). NOT a failure: verify via the form\'s own filename chip/UI, not files.length.'
          : undefined,
      };
    } finally {
      try { await cdp.sendCommand('Runtime.releaseObject', { objectId }); } catch (e) { /* best-effort */ }
    }
  }

  async handleRealisticMouseMove({ x, y, duration, currentX, currentY, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    const result = await cdp.moveMouseRealistic(x, y, {
      duration,
      currentX,
      currentY
    });
    return {
      success: true,
      position: result,
      message: `Moved mouse to (${x}, ${y})`
    };
  }

  async handleRealisticClick({ x, y, button, clickCount, moveFirst, moveDuration, currentX, currentY, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    await cdp.clickRealistic(x, y, {
      button,
      clickCount,
      moveFirst,
      moveDuration,
      currentX,
      currentY
    });
    return {
      success: true,
      position: { x, y },
      button: button || 'left',
      clickCount: clickCount || 1,
      message: `${clickCount === 2 ? 'Double-' : ''}Clicked ${button || 'left'} button at (${x}, ${y})`
    };
  }

  /**
   * Single write path for background errors: ring-buffer + PERSIST.
   *
   * Persistence is the point. The buffer is in-memory, and an MV3 service
   * worker is torn down constantly (idle) and occasionally dies outright. Both
   * destroy the record — so the errors from immediately BEFORE a crash, which
   * are the ones that explain it, were exactly the ones that never survived to
   * be read. Mirroring to chrome.storage.local means the next worker can serve
   * them, whether or not this one shut down cleanly.
   *
   * Best-effort and never throws: an error recorder that can itself fail loudly
   * inside a catch block would replace the original error with its own.
   *
   * ⚠️ SCOPE, stated because the boundary is easy to assume away: this survives
   * SERVICE-WORKER teardown, not a profile relaunch. chrome.storage.local lives
   * in Default/Local Extension Settings, which wipeStaleExtensionData deletes on
   * every container-chromium launch (the same directory that used to eat the
   * stable extensionId). So for a sidecar browser the history starts empty each
   * launch — which is fine, since it is a new browser — while for a long-lived
   * desktop Chrome, the case this exists for, it persists indefinitely.
   *
   * ⚠️ UNVERIFIED END-TO-END as of 2026-08-13: the write path and the filter are
   * confirmed live, but I could not observe a full write→teardown→recover cycle.
   * The extension holds an open websocket, which keeps the worker alive and
   * prevents natural dormancy, and browser_reload_extension on a container
   * chromium dropped the extension without it re-registering. Do not read the
   * recovery path as proven; the first real post-teardown read is the test.
   */
  recordBackgroundError(entry) {
    const rec = { timestamp: Date.now(), ...entry };
    try {
      this.backgroundErrors.push(rec);
      while (this.backgroundErrors.length > 200) this.backgroundErrors.shift();
    } catch { /* never let recording break the caller */ }
    try {
      // Keep the persisted slice small — it is read on startup, and the whole
      // point is that it is readable, not complete.
      const slice = this.backgroundErrors.slice(-50);
      chrome.storage.local.set({ __unibrowseBackgroundErrors: slice }).catch(() => {});
    } catch { /* storage unavailable during teardown */ }
    return rec;
  }

  /**
   * Load errors persisted by a PREVIOUS service-worker generation and prepend
   * them, so a caller asking "what went wrong" after a crash sees across the
   * restart rather than only after it. Tagged so nobody mistakes a recovered
   * entry for a live one.
   */
  async loadPersistedBackgroundErrors() {
    try {
      const st = await chrome.storage.local.get(['__unibrowseBackgroundErrors']);
      const prev = st.__unibrowseBackgroundErrors;
      if (!Array.isArray(prev) || !prev.length) return 0;
      const known = new Set(this.backgroundErrors.map(e => `${e.timestamp}|${e.message}`));
      const recovered = prev
        .filter(e => e && !known.has(`${e.timestamp}|${e.message}`))
        .map(e => ({ ...e, fromPreviousWorker: true }));
      if (!recovered.length) return 0;
      this.backgroundErrors = [...recovered, ...this.backgroundErrors].slice(-200);
      console.log(`[Background] recovered ${recovered.length} error(s) from a previous service-worker generation`);
      return recovered.length;
    } catch { return 0; }
  }

  /**
   * Catch what the handler try/catch blocks structurally cannot: an uncaught
   * throw at service-worker top level, and a promise rejection nobody awaited.
   * These are the ones that take the worker down, and until 2026-08-13 the
   * extension recorded none of them — which is why "the extension crashed" had
   * to be diagnosed by a human reading chrome://extensions.
   */
  installGlobalErrorCapture() {
    if (self.__unibrowseGlobalErrorCaptureInstalled) return;
    self.__unibrowseGlobalErrorCaptureInstalled = true;
    try {
      self.addEventListener('error', (ev) => {
        this.recordBackgroundError({
          level: 'critical',
          source: 'uncaught',
          message: ev?.message || String(ev?.error || 'uncaught error'),
          stack: ev?.error?.stack || (ev?.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : null),
        });
      });
      self.addEventListener('unhandledrejection', (ev) => {
        const r = ev?.reason;
        this.recordBackgroundError({
          level: 'critical',
          source: 'unhandledrejection',
          message: (r && (r.message || String(r))) || 'unhandled promise rejection',
          stack: r?.stack || null,
        });
      });
      console.log('[Background] global error capture installed');
    } catch (e) {
      console.warn('[Background] could not install global error capture:', e?.message || e);
    }
  }

  async handleRealisticType({ text, minDelay, maxDelay, mistakeChance, pressEnter, tabTarget }) {
    const cdp = await this.tabManager.requireCDP(tabTarget);
    const safeText = text ?? '';
    try {
      if (!cdp.isAttached() || cdp.isDetaching) {
        throw new Error('Debugger detached before typing could start');
      }

      // ⚠️ VERIFY BY EFFECT, DO NOT ASSERT SUCCESS.
      // CDP Input events are delivered to the tab's focused element. When the
      // target tab is not the browser's ACTIVE tab there may be no focused
      // element at all — the keystrokes go nowhere, typeRealistic() resolves
      // perfectly happily, and this returned `Typed "..."` over an empty
      // field. ha hit exactly that on 2026-08-12 and reported success with an
      // empty input; it is also the likely cause of the broken ecobee_login_full
      // password step.
      //
      // ⭐ A false success is worse than a failure: the caller has no reason to
      // re-check, so the error surfaces somewhere else entirely, much later.
      // So: snapshot the focused element's value, type, and read it back.
      const probe = async () => {
        try {
          const r = await cdp.sendCommand('Runtime.evaluate', {
            expression: `(()=>{const e=document.activeElement;if(!e)return JSON.stringify({none:true});
              const tag=e.tagName;const v=('value' in e)?String(e.value??''):(e.isContentEditable?String(e.textContent??''):null);
              return JSON.stringify({tag,editable:v!==null,len:v===null?0:v.length});})()`,
            returnByValue: true,
          });
          return JSON.parse(r?.result?.value ?? '{}');
        } catch { return null; }   // probe must never break a working type
      };

      const before = safeText ? await probe() : null;

      await cdp.typeRealistic(safeText, {
        minDelay,
        maxDelay,
        mistakeChance,
        pressEnter
      });

      // Only meaningful when we actually had text to type AND the focus target
      // could hold it. pressEnter may navigate or clear the field, so a
      // post-Enter read is not evidence of anything — skip the check then.
      let verified = null;
      if (safeText && !pressEnter && before && before.editable) {
        const after = await probe();
        if (after && after.editable && after.len === before.len) {
          throw new Error(
            `Typed ${safeText.length} character(s) but the focused ${String(after.tag || 'element').toLowerCase()} ` +
            `did not change (still ${after.len} chars). CDP input goes to the tab's FOCUSED element, and a tab ` +
            `that is not the browser's ACTIVE tab often has no focus — call browser_switch_tab on this tab first, ` +
            `or click the field with browser_realistic_click, then retry.`
          );
        }
        verified = after && after.editable ? after.len - before.len : null;
      }

      return {
        success: true,
        text: safeText,
        length: safeText.length,
        verifiedDelta: verified,
        message: `Typed "${safeText.substring(0, 50)}${safeText.length > 50 ? '...' : ''}"${pressEnter ? ' and pressed Enter' : ''}`
          + (verified !== null ? ` (field grew by ${verified} chars)` : '')
      };
    } catch (error) {
      if (error.message && (error.message.includes('Detached') || error.message.includes('detached'))) {
        throw new Error(`Typing operation interrupted: debugger detached (page navigation, frame update, or dynamic content change). Partial text may have been entered. The browser will attempt to reconnect automatically.`);
      }
      throw error;
    }
  }

  async handleStartVideoRecording({ tabTarget }) {
    const tabInfo = tabTarget
      ? this.tabManager.resolveTab(tabTarget)
      : this.tabManager.attachedTabs.get(this.tabManager.lastUsedTabId);
    const tabId = tabInfo?.tabId;
    if (!tabId) {
      throw new Error('No tab available for video recording. Use browser_attach_tab or browser_create_tab first.');
    }
    return new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, async (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          reject(new Error(chrome.runtime.lastError?.message || 'tabCapture.getMediaStreamId failed — tab may not be visible'));
          return;
        }
        try {
          await chrome.runtime.sendMessage({ type: 'OFFSCREEN_START_TAB_RECORDING', streamId });
          resolve({ success: true, tabId, message: `Video recording started for tab ${tabId}` });
        } catch (err) {
          reject(new Error(`Failed to start offscreen recording: ${err.message}`));
        }
      });
    });
  }

  async handleStopVideoRecording() {
    const response = await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_TAB_RECORDING' });
    if (!response?.success) {
      throw new Error(response?.error || 'No active video recording to stop');
    }
    // Big-recording path: chunked transfer to dodge chrome's 64 MiB sendMessage cap.
    let videoBase64 = response.videoBase64;
    if (response.chunked) {
      const { chunkCount, tabId: tabKey } = response;
      const parts = new Array(chunkCount);
      for (let i = 0; i < chunkCount; i++) {
        const chunkResp = await chrome.runtime.sendMessage({
          type: 'OFFSCREEN_GET_VIDEO_CHUNK',
          tabId: tabKey,
          chunkIndex: i,
        });
        if (!chunkResp?.success) throw new Error(`Chunk ${i}: ${chunkResp?.error || 'no response'}`);
        parts[i] = chunkResp.chunk;
      }
      await chrome.runtime.sendMessage({ type: 'OFFSCREEN_RELEASE_VIDEO', tabId: tabKey }).catch(() => {});
      videoBase64 = parts.join('');
    }
    return {
      success: true,
      videoBase64,
      mimeType: response.mimeType || 'video/webm',
      byteLength: response.byteLength || 0,
    };
  }

  async handleListTabs() {
    const tabs = await chrome.tabs.query({});
    return tabs.map(tab => ({
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      active: tab.active
    }));
  }

  async handleSwitchTab({ tabId, tabTarget }) {
    let targetTabId = tabId;

    // Resolve tabTarget (label or string ID) if no numeric tabId given
    if (!targetTabId && tabTarget !== undefined) {
      const tabInfo = this.tabManager.resolveTab(tabTarget);
      if (tabInfo) {
        targetTabId = tabInfo.tabId;
      } else if (typeof tabTarget === 'string' && /^\d+$/.test(tabTarget)) {
        targetTabId = parseInt(tabTarget, 10);
      } else if (typeof tabTarget === 'number') {
        targetTabId = tabTarget;
      } else {
        throw new Error(`browser_switch_tab: no tab found with label "${tabTarget}"`);
      }
    }

    const tab = await chrome.tabs.get(targetTabId);

    // ⛔ Never substitute. Unlike ensure_attached, this handler has NO
    // untargeted path — it is unreachable without a tabId or tabTarget — so a
    // substitution here is ALWAYS overriding a tab the caller named, and
    // "switch" means focusing a window on someone's screen.
    //
    // This was the sibling of the ensure_attached bug fixed in c6cea0d: same
    // decision (restricted URL → findFirstValidTab), same file, made twice.
    // Found by grepping the other call sites of that decision rather than by
    // hitting it — the correct branch gives no signal about the wrong one.
    //
    // It did disclose the swap via `message`, but that disclosure was broken
    // in the direction that trains callers to ignore it: the condition was
    // `targetTabId !== tabId`, and `tabId` is undefined whenever the caller
    // targets by label — so EVERY label-targeted switch reported "switched to
    // <url> instead" alongside success:true, even with no substitution at all.
    // A warning that cries wolf on the common path is worse than none, because
    // it is still there when it is true.
    if (this.isRestrictedUrl(tab.url)) {
      const err = new Error(
        `Cannot switch to tab ${targetTabId} (${tab.url}) — extensions cannot drive this URL. ` +
        `Not switching to a different tab, because you asked for a specific one.`
      );
      err.code = 'UNATTACHABLE_URL';
      throw err;
    }

    await chrome.tabs.update(targetTabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });

    return { success: true, tabId: targetTabId, url: tab.url };
  }

  async handleCreateTab({ url, incognito, label, focus }) {
    // Default behavior: new tabs open in the background so agent work doesn't
    // steal focus from whatever the user is doing. Callers pass focus=true to
    // explicitly bring the new tab to front.
    const shouldFocus = focus === true;
    let newTab;

    if (incognito) {
      const allowed = await chrome.extension.isAllowedIncognitoAccess();
      if (!allowed) {
        // The API stays `incognito` on every Chromium fork — only the words a
        // human has to hunt for change. Edge calls the mode "InPrivate" and
        // labels the toggle "Allow in InPrivate", so Chrome's wording sends an
        // Edge user looking for a control that isn't there under that name.
        throw new Error(
          `Extension not allowed in ${BrowserEnv.privateModeLabel} mode. ` +
          BrowserEnv.privateAccessHint()
        );
      }

      // Find or create the shared incognito window
      let incognitoWindowId = this._incognitoWindowId;
      if (incognitoWindowId) {
        try { await chrome.windows.get(incognitoWindowId); }
        catch { incognitoWindowId = null; this._incognitoWindowId = null; }
      }

      if (!incognitoWindowId) {
        const win = await chrome.windows.create({ incognito: true, url: url || 'about:blank', focused: shouldFocus });
        // Same silent-fallback detection as handleCreateWindow: even when
        // isAllowedIncognitoAccess() returned true earlier, the result can
        // come back as a normal window if state shifted. Trust the result.
        if (win.incognito !== true) {
          try { await chrome.windows.remove(win.id); } catch {}
          throw new Error(
            `Cannot open ${BrowserEnv.privateModeLabel} tab: extension is not allowed in ` +
            `${BrowserEnv.privateModeLabel} (${BrowserEnv.name} silently fell back to the ` +
            `default profile). ${BrowserEnv.privateAccessHint()} Then retry.`
          );
        }
        this._incognitoWindowId = win.id;
        newTab = win.tabs[0];
      } else {
        newTab = await chrome.tabs.create({ url: url || 'about:blank', windowId: incognitoWindowId, active: shouldFocus });
        if (shouldFocus) {
          // chrome.tabs.create active=true brings the tab to front within its window,
          // but does not focus the window itself — do that explicitly when requested.
          try { await chrome.windows.update(incognitoWindowId, { focused: true }); } catch {}
        }
      }
    } else {
      newTab = await chrome.tabs.create({ url: url || 'about:blank', active: shouldFocus });
    }

    let targetTabId = newTab.id;

    // Wait for the tab to finish loading before attaching
    await new Promise((resolve) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === targetTabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      // Timeout after 15 seconds
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
    });

    // Get final tab info and attach
    const tab = await chrome.tabs.get(targetTabId);

    // Skip debugger attachment for restricted URLs (about:blank, chrome://, etc.)
    const isRestricted = !tab.url || tab.url === 'about:blank' ||
      BrowserEnv.isInternalUrl(tab.url) || tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('about:');
    if (isRestricted) {
      console.log('[handleCreateTab] Restricted URL, skipping debugger attachment:', tab.url);
      return { success: true, tabId: tab.id, label: `tab-${tab.id}`, url: tab.url || 'about:blank' };
    }

    // Pass the caller's agent/takeover so the tab is reserved on creation.
    //
    // ⚠️ TOCTOU: the isRestricted check above read tab.url, but chrome.debugger
    // .attach() runs later, and the tab can navigate in between — at which point
    // Chrome throws its own raw "Cannot access a chrome-extension:// URL of
    // different extension". That escapes unwrapped, because the guarded path
    // that would have turned it into a friendly UNATTACHABLE_URL error is the
    // one we already passed.
    //
    // This is INTERMITTENT, which is exactly why it was mistaken for a
    // permanent New Tab override: `agents` hit it twice in a row on
    // 2026-08-15 and `!login ben` failed 0/4, while minutes later I could not
    // reproduce it on the same browser with the same URLs, plain or incognito.
    // I had hit it myself earlier the same day on a slow-loading tab and
    // dismissed it.
    //
    // The wait above resolves on a 15s TIMEOUT as well as on 'complete', so a
    // slow page reaches this line still mid-navigation — which widens the
    // window rather than being a separate bug.
    //
    // ⛔ NOT PROVEN — I could not reproduce it, so this is defensive, not a
    // confirmed fix. It is safe either way: re-read the URL, and only retry
    // when the tab has settled somewhere attachable. If it has genuinely landed
    // on another extension's page, fall back to the same non-attached success
    // the guard above returns, instead of failing the caller's create.
    let tabInfo;
    try {
      tabInfo = await this.tabManager.attachTab(targetTabId, tab.url, tab.title, {
        agent: this.tabManager._currentAgent,
        takeover: this.tabManager._currentTakeover,
      });
    } catch (err) {
      const raced = /Cannot access a chrome-extension:\/\/ URL of different extension/i.test(err?.message || '');
      if (!raced) throw err;
      const settled = await chrome.tabs.get(targetTabId).catch(() => null);
      const settledUrl = settled?.url || '';
      console.warn(`[handleCreateTab] attach raced a navigation; url now ${settledUrl || '(unknown)'}`);
      if (!settledUrl || settledUrl.startsWith('chrome-extension://') || BrowserEnv.isInternalUrl(settledUrl)) {
        return { success: true, tabId: targetTabId, label: `tab-${targetTabId}`, url: settledUrl || 'about:blank', attached: false, note: 'Tab created but not attached: it settled on a page extensions cannot debug.' };
      }
      tabInfo = await this.tabManager.attachTab(targetTabId, settledUrl, settled?.title, {
        agent: this.tabManager._currentAgent,
        takeover: this.tabManager._currentTakeover,
      });
    }
    // Apply caller-requested label so the tab is resolvable by it (e.g. the
    // recording-screenshot flow creates a tab labeled "rrweb-frame-<ts>" and then
    // navigates/screenshots/closes it by that label). Without this the label was
    // silently dropped and every subsequent tabTarget lookup failed.
    if (label) {
      try { this.tabManager.setTabLabel(targetTabId, label); }
      catch (err) { console.warn('[handleCreateTab] Could not apply requested label:', err.message); }
    }
    await this.injectTabIndicator(targetTabId);
    await this.injectBackgroundCapture(targetTabId);

    // Auto session-capture. ⚠️ This path attaches via tabManager.attachTab()
    // DIRECTLY and never goes through handleEnsureAttached, so it needs its own
    // hook — hooking only ensure_attached silently misses it, and this is the
    // BUSIER path: browser_launch_isolated_chrome's autoAttach and every
    // browser_create_tab land here, not there. (Caught 2026-08-02 by launching
    // a throwaway chromium and finding isRecording:false when the feature was
    // supposedly done.)
    await this._maybeAutoCapture(targetTabId, true);

    const result = { success: true, tabId: tab.id, label: tabInfo.label, url: tab.url };
    if (this.tabManager._currentAgent) result.reservedTo = this.tabManager._currentAgent;
    return result;
  }

  async handleCloseTab({ tabId, tabTarget }) {
    let resolvedTabId = tabId;

    // Resolve tabTarget (label or string ID) if no numeric tabId given
    if (!resolvedTabId && tabTarget !== undefined) {
      const tabInfo = this.tabManager.resolveTab(tabTarget);
      if (tabInfo) {
        resolvedTabId = tabInfo.tabId;
      } else if (typeof tabTarget === 'string' && /^\d+$/.test(tabTarget)) {
        resolvedTabId = parseInt(tabTarget, 10);
      } else if (typeof tabTarget === 'number') {
        resolvedTabId = tabTarget;
      }
    }

    if (!resolvedTabId) {
      // Nothing identifiable was passed → genuinely malformed call.
      if (tabId === undefined && tabTarget === undefined) {
        throw new Error(`browser_close_tab: could not resolve tab — provide tabId (number) or a valid tabTarget label`);
      }
      // A target WAS supplied but didn't resolve — the tab is almost certainly already
      // closed. Close is idempotent, so report success instead of throwing (and logging
      // a noisy "critical error"). This is hit by best-effort cleanup such as the
      // recording-screenshot finally block.
      console.log('[Background] handleCloseTab: target already gone, nothing to close:', tabTarget ?? tabId);
      return { success: true, tabId: null, alreadyClosed: true };
    }

    // Also remove from TabManager if it's an attached tab
    if (this.tabManager.attachedTabs.has(resolvedTabId)) {
      await this.tabManager.detachTab(resolvedTabId).catch(() => {});
    }

    // chrome.tabs.remove rejects if the tab is already gone — the goal (tab closed) is
    // already met, so swallow that case rather than surfacing it as a handler error.
    try {
      await chrome.tabs.remove(resolvedTabId);
    } catch (err) {
      if (/No tab with id|Invalid tab ID|cannot be edited/i.test(err.message || '')) {
        console.log('[Background] handleCloseTab: tab already closed:', resolvedTabId);
        return { success: true, tabId: resolvedTabId, alreadyClosed: true };
      }
      throw err;
    }
    return { success: true, tabId: resolvedTabId };
  }

  async handleCreateWindow({ url, focused, incognito, width, height }) {
    // Default to background-open so a new window doesn't steal focus from
    // whatever the user is doing. Callers pass focused=true to override.
    const createData = { focused: focused === true };

    // Set URL - can be a string or array of URLs
    if (url) {
      if (Array.isArray(url)) {
        createData.url = url;
      } else {
        createData.url = url;
      }
    } else {
      createData.url = 'about:blank';
    }

    // focused already set above per the default-background policy.
    if (incognito !== undefined) createData.incognito = incognito;

    // Set window size if provided
    if (width !== undefined) createData.width = width;
    if (height !== undefined) createData.height = height;

    const window = await chrome.windows.create(createData);

    // Detect the silent-incognito-fallback bug from ha #1: Chrome will quietly
    // open a NORMAL window in the user's profile when the extension lacks
    // chrome://extensions "Allow in incognito", and chrome.windows.create
    // resolves with `incognito:false` on the returned object regardless of
    // what was requested. Trust the RESULT object — not the request param —
    // so we don't echo a lie back to the caller. Close the wrong-mode
    // window first so we don't leave it lying around.
    if (incognito === true && window.incognito !== true) {
      try { await chrome.windows.remove(window.id); } catch { /* best-effort */ }
      throw new Error(
        `Cannot open ${BrowserEnv.privateModeLabel} window: extension is not allowed in ` +
        `${BrowserEnv.privateModeLabel} (${BrowserEnv.name} silently fell back to the ` +
        `default profile). ${BrowserEnv.privateAccessHint()} Then retry.`
      );
    }

    return {
      success: true,
      windowId: window.id,
      tabs: window.tabs.map(t => ({ tabId: t.id, url: t.url })),
      focused: window.focused,
      incognito: window.incognito
    };
  }

  async handleFillForm({ fields, tabTarget, frameTarget }) {
    const cdp = await this.tabManager.requireCDP(tabTarget);
    // Use JavaScript to fill all fields at once (more reliable than keyboard simulation)
    const fillScript = `
      (function() {
        const results = [];
        const fields = ${JSON.stringify(fields)};

        for (const field of fields) {
          const element = document.querySelector(field.ref);
          if (!element) {
            results.push({ ref: field.ref, success: false, error: 'Element not found' });
            continue;
          }

          // Set the value
          element.value = field.value;

          // Trigger input events to notify the page
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));

          results.push({ ref: field.ref, success: true });
        }

        return { success: true, fieldCount: fields.length, results: results };
      })()
    `;

    const result = frameTarget
      ? await cdp.evaluateInFrame(await this.resolveFrameId(cdp, frameTarget), fillScript, true)
      : await cdp.evaluate(fillScript, true);

    return result;
  }

  async handleSubmitForm({ element, ref, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    // Find the form element
    const elemInfo = await cdp.querySelector(ref);
    if (!elemInfo) {
      throw new Error(`Form not found: ${ref}`);
    }

    // Submit the form by pressing Enter or clicking submit button
    await cdp.evaluate(`
      (function() {
        const form = document.querySelector('${ref.replace(/'/g, "\\'")}');
        if (!form) return { success: false, error: 'Form not found' };

        // If it's a form element, submit it
        if (form.tagName === 'FORM') {
          form.submit();
          return { success: true };
        }

        // If it's a submit button, click it
        if (form.type === 'submit' || form.tagName === 'BUTTON') {
          form.click();
          return { success: true };
        }

        return { success: false, error: 'Element is not a form or submit button' };
      })()
    `, true);

    return { success: true, element, ref };
  }

  async handleSnapshot(data) {
    try {
      const { tabTarget, frameTarget, interactiveOnly = true, maxDepth = 5 } = data || {};
      const cdp = await this.tabManager.requireCDP(tabTarget);
      let tree;
      if (frameTarget) {
        const frameId = await this.resolveFrameId(cdp, frameTarget);
        // Accessibility.getFullAXTree accepts frameId (Chrome 97+)
        tree = await cdp.sendCommand('Accessibility.getFullAXTree', { frameId, depth: maxDepth });
      } else {
        tree = await cdp.getPartialAccessibilityTree(maxDepth);
      }

      // Check if tree is empty due to restricted frames
      if (!tree.nodes || tree.nodes.length === 0) {
        console.warn('[Background] Accessibility tree is empty - page may contain restricted iframes');
        return JSON.stringify({
          error: 'Page contains restricted content',
          message: 'The page has iframes (like about:blank#blocked or chrome:// URLs) that cannot be accessed. Try using browser_evaluate to interact with the main page content instead.',
          nodes: []
        }, null, 2);
      }

      // CDP returns a flat node list with childIds references — build a nested tree.
      // filterNode(tree) on the raw { nodes: [] } object was the prior bug: role/children
      // don't exist on the wrapper object, so interactiveOnly: true always returned null.
      const nodeMap = new Map();
      for (const node of tree.nodes) {
        nodeMap.set(node.nodeId, node);
      }

      // Find the root: the node whose nodeId doesn't appear in any other node's childIds
      const allChildIds = new Set(tree.nodes.flatMap(n => n.childIds || []));
      const rootNode = tree.nodes.find(n => !allChildIds.has(n.nodeId));

      if (!interactiveOnly) {
        // Return the flat list as-is (same as before — no filtering needed)
        return JSON.stringify(tree, null, 2);
      }

      const interactiveRoles = ['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'menuitem', 'tab', 'switch', 'slider', 'spinbutton', 'option'];

      // Walk the tree via childIds, pruning non-interactive branches
      const filterNode = (nodeId, depth = 0) => {
        if (depth > maxDepth) return null;
        const node = nodeMap.get(nodeId);
        if (!node || node.ignored) return null;

        const filteredChildren = (node.childIds || [])
          .map(id => filterNode(id, depth + 1))
          .filter(Boolean);

        const isInteractive = interactiveRoles.includes(node.role?.value);
        if (isInteractive) {
          const { childIds, ...rest } = node;
          return { ...rest, children: filteredChildren.length > 0 ? filteredChildren : undefined };
        }
        // Non-interactive: keep only if it has interactive descendants
        if (filteredChildren.length > 0) {
          const { childIds, ...rest } = node;
          return { ...rest, children: filteredChildren };
        }
        return null;
      };

      const filtered = rootNode ? filterNode(rootNode.nodeId) : null;
      return JSON.stringify(filtered, null, 2);
    } catch (error) {
      // If we get a restricted frame error, return a helpful message
      if (error.message && error.message.includes('restricted content')) {
        console.warn('[Background] Snapshot failed due to restricted content:', error.message);
        return JSON.stringify({
          error: 'Page contains restricted content',
          message: error.message,
          suggestion: 'Use browser_evaluate to interact with accessible parts of the page',
          nodes: []
        }, null, 2);
      }
      throw error;
    }
  }

  async handleScreenshot({ tabTarget }) {
    const cdp = await this.tabManager.requireCDP(tabTarget);
    if (!cdp) {
      throw new Error(
        tabTarget
          ? `Tab ${tabTarget} not found or not attached`
          : 'No tabs currently attached. Please attach to a tab first.'
      );
    }

    // ⚠️ NEVER PRE-BLOCK ON VISIBILITY — ALWAYS ATTEMPT THE CAPTURE FIRST.
    //
    // Page.captureScreenshot waits for a compositor frame, and a hidden tab
    // SOMETIMES never produces one: measured 2026-08-02, a fresh container
    // chromium came up `visibilityState: hidden` and capture died on the 10s
    // CDP timeout; one browser_switch_tab flipped it to 'visible' and the
    // identical call returned a 22KB image.
    //
    // ⛔ But hidden is NOT sufficient for failure, and I shipped a hard
    // precheck that assumed it was — on a single reproduction. `storybook`
    // produced the counterexample within minutes: a HIDDEN tab, with an
    // override mismatched to its window, captured 59,556 tokens of rich image.
    // A precheck would have refused that and returned an authoritative
    // explanation for a failure that was never going to happen — turning my
    // diagnostic into a cause of the thing it describes.
    //
    // ⚠️ Then I reproduced their counterexample on my OWN setup, which is the
    // part that settles it: a fresh container chromium, `visibilityState:
    // hidden`, captured 22,328 chars successfully — the SAME scenario that had
    // timed out for me an hour earlier. So my original reproduction was not
    // reliable either, and the hard block I shipped would have rejected this
    // very capture. The timeout is INTERMITTENT and its actual gate is UNKNOWN;
    // hidden is correlated at best, and possibly incidental.
    //
    // So: attempt, and only explain AFTER a real failure. The cause is offered
    // when it is consistent with the evidence, never used to predict.
    // Whatever actually gates compositing here is still unknown; do not write
    // a confident mechanism into this comment without measuring it.
    try {
      return await cdp.captureScreenshot(); // base64 string
    } catch (err) {
      if (!/timed out/i.test(err?.message || '')) throw err;

      let vis = 'unknown';
      try { vis = await cdp.evaluate('document.visibilityState'); } catch { /* keep 'unknown' */ }

      if (vis === 'hidden') {
        throw new Error(
          `Screenshot timed out, and this tab is HIDDEN (visibilityState: hidden). ` +
          `Page.captureScreenshot waits for a compositor frame and a backgrounded tab may never ` +
          `produce one. This is NOT evidence the page is blank or broken. ` +
          `Try foregrounding it — browser_switch_tab({tabId: <id>}) — then retry. ` +
          `Note: hidden tabs CAN capture successfully, so hidden is a likely contributor here, not a proven cause.`
        );
      }
      throw new Error(
        `Screenshot timed out after 10s (tab visibilityState: ${vis}). The page may still be ` +
        `painting, or the renderer is not producing frames. Retry, or check the tab is alive.`
      );
    }
  }

  async handleSegmentedScreenshot({ selectors, includeLabels, tabTarget }) {
    const cdp = await this.tabManager.requireCDP(tabTarget);
    if (!cdp) {
      throw new Error(
        tabTarget
          ? `Tab ${tabTarget} not found or not attached`
          : 'No tabs currently attached. Please attach to a tab first.'
      );
    }

    if (!Array.isArray(selectors) || selectors.length === 0) {
      throw new Error('selectors must be a non-empty array');
    }

    const screenshots = await cdp.captureSegmentedScreenshots(selectors, { includeLabels });

    const successful = screenshots.filter(s => s.base64Data !== null);
    const failed = screenshots.filter(s => s.base64Data === null);

    return {
      screenshots: successful,
      failedSelectors: failed.map(f => ({ selector: f.selector, error: f.error })),
    };
  }

  async handleGetConsoleLogs({ source = 'all' } = {}) {
    // Merge page console logs with background extension errors so agents see both.
    // Background errors are tagged with source:'background' for easy filtering.
    //
    // ⚠️ `source` exists because an unfiltered call on a busy browser returned
    // 219,000 characters — ~61k tokens, almost entirely Amazon preload
    // warnings — with the single background error that mattered buried inside
    // it. A diagnostic you cannot afford to read is not a diagnostic.
    const bgEntries = this.backgroundErrors.map(e => ({
      level: e.level === 'critical' ? 'error' : e.level,
      text: `[Background ${e.level}] ${e.message}`,
      stack: e.stack || undefined,
      timestamp: e.timestamp,
      source: 'background',
      // Surfaced so a reader can tell a recovered entry from a live one — it
      // came from a PREVIOUS service-worker generation, i.e. from before a
      // teardown or crash.
      fromPreviousWorker: e.fromPreviousWorker || undefined,
      errorSource: e.source || undefined,
    }));
    if (source === 'background') return bgEntries.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    if (source === 'page') return [...this.consoleLogs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    return [...this.consoleLogs, ...bgEntries].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  /**
   * browser_get_errors — unified error view across all attached tabs + background.
   * Designed for the heal skill: returns a complete health picture with actionable context.
   */
  async handleGetErrors({ since, levelsOnly } = {}) {
    const cutoff = since ? Number(since) : 0;

    // Page errors/warnings from all tabs
    const pageErrors = this.consoleLogs.filter(e => {
      if (e.timestamp < cutoff) return false;
      if (levelsOnly) return levelsOnly.includes(e.level);
      return ['error', 'warning', 'warn'].includes(e.level);
    });

    // Background handler/critical errors
    const bgErrors = this.backgroundErrors.filter(e => e.timestamp >= cutoff);

    // Tab health status
    const tabs = [];
    for (const [tabId, info] of (this.tabManager?.attachedTabs || new Map())) {
      tabs.push({
        tabId,
        label: info.label,
        url: info.url,
        title: info.title,
        cdpAlive: !!(info.cdp?.isAttached()),
        lastUsedAt: info.lastUsedAt,
      });
    }

    // Extension connection state — getState() is async, must await
    let wsConnected = false;
    try {
      const wsState = await this.ws?.getState?.();
      wsConnected = wsState === 'connected';
    } catch (_) {}

    return {
      summary: {
        pageErrorCount: pageErrors.length,
        backgroundErrorCount: bgErrors.length,
        attachedTabCount: tabs.length,
        unhealthyTabCount: tabs.filter(t => !t.cdpAlive).length,
        wsConnected,
        sessionRecordingActive: !!this.sessionRecording,
      },
      pageErrors,
      backgroundErrors: bgErrors,
      tabs,
    };
  }

  async handleReloadExtension() {
    // Send acknowledgement before reloading (response may not arrive but try)
    setTimeout(() => chrome.runtime.reload(), 200);
    return { success: true, message: 'Extension reloading in 200ms. Reconnect after ~2 seconds.' };
  }

  async handleGetNetworkLogs({ filter, tabTarget, since }) {
    let logs = this.networkLogs;
    // Per-tab isolation (ha bug #4) — when a tabTarget is supplied, only
    // entries belonging to that tab are returned, instead of leaking the
    // global cross-tab stream.
    if (tabTarget !== undefined && tabTarget !== null && tabTarget !== '') {
      const info = this.tabManager?.resolveTab?.(tabTarget);
      const targetTabId = info?.tabId
        ?? (typeof tabTarget === 'number' ? tabTarget : (parseInt(tabTarget, 10) || null));
      if (targetTabId != null) {
        logs = logs.filter(l => l.tabId === targetTabId);
      }
    }
    if (typeof since === 'number' && since > 0) {
      logs = logs.filter(l => (l.timestamp || 0) >= since);
    }
    if (filter) {
      logs = logs.filter(l => l.url && l.url.includes(filter));
    }
    return logs;
  }

  async handleEvaluate({ expression, tabTarget, frameTarget }) {
    const cdp = await this.tabManager.requireCDP(tabTarget);
    if (frameTarget) {
      const frameId = await this.resolveFrameId(cdp, frameTarget);
      return cdp.evaluateInFrame(frameId, expression, true);
    }
    return cdp.evaluate(expression, true);
  }

  /**
   * List all frames in the current page.
   * Returns frameId, url, parentFrameId, and best-effort iframeSelector for each frame.
   */
  async handleListFrames({ tabTarget }) {
    const cdp = await this.tabManager.requireCDP(tabTarget);
    const frameTree = await cdp.getFrameTree();
    const frames = flattenFrameTree(frameTree);

    // Best-effort: populate iframeSelector for child frames by querying the main frame DOM
    if (frames.length > 1) {
      try {
        const iframeData = await cdp.evaluate(`
          Array.from(document.querySelectorAll('iframe, frame')).map((el, i) => ({
            src: el.src || el.getAttribute('src') || null,
            name: el.name || null,
            id: el.id || null,
            selector: el.id
              ? '#' + el.id
              : (el.name
                ? 'iframe[name="' + el.name + '"]'
                : 'iframe:nth-of-type(' + (i + 1) + ')'),
          }))
        `);

        if (Array.isArray(iframeData)) {
          for (const frame of frames) {
            if (!frame.parentFrameId) continue; // skip root frame
            // Match by name first, then by URL prefix
            const match = iframeData.find(d =>
              (frame.name && d.name === frame.name) ||
              (d.src && frame.url && frame.url.startsWith(d.src.split('?')[0]))
            );
            if (match) frame.iframeSelector = match.selector;
          }
        }
      } catch { /* best-effort, ignore errors */ }
    }

    return { frames, count: frames.length };
  }

  /**
   * Resolve a frameTarget (CDP frameId string or CSS selector) to a CDP frameId.
   * @param {CDPHelper} cdp
   * @param {string} frameTarget
   */
  async resolveFrameId(cdp, frameTarget) {
    // If it looks like a CDP frameId (uppercase hex dot number), use directly
    if (/^[0-9A-Fa-f]+\.[0-9]+$/.test(frameTarget)) {
      return frameTarget;
    }

    // Treat as CSS selector — find the iframe element and read its name/id
    const frameName = await cdp.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(frameTarget)});
        if (!el || (el.tagName !== 'IFRAME' && el.tagName !== 'FRAME')) return null;
        return el.name || el.id || null;
      })()
    `);

    if (!frameName) {
      throw new Error(
        `Cannot resolve iframe from selector "${frameTarget}". ` +
        `Use browser_list_frames to get frameId values for nameless iframes.`
      );
    }

    // Cross-reference with the live frame tree
    const frameTree = await cdp.getFrameTree();
    const allFrames = flattenFrameTree(frameTree);
    const found = allFrames.find(f => f.name === frameName);
    if (!found) {
      throw new Error(`No CDP frame found with name "${frameName}" (resolved from "${frameTarget}")`);
    }
    return found.frameId;
  }

  async handleGetUrl({ tabTarget }) {
    if (tabTarget) {
      const tabInfo = this.tabManager.resolveTab(tabTarget);
      if (!tabInfo) {
        throw new Error(`No tab found with identifier: ${tabTarget}`);
      }
      return tabInfo.url;
    }
    return this.state.tabUrl;
  }

  async handleGetTitle({ tabTarget }) {
    if (tabTarget) {
      const tabInfo = this.tabManager.resolveTab(tabTarget);
      if (!tabInfo) {
        throw new Error(`No tab found with identifier: ${tabTarget}`);
      }
      return tabInfo.title;
    }
    return this.state.tabTitle;
  }

  async handleQueryDOM({ selector, limit = 10, tabTarget, frameTarget }) {
    const cdp = await this.tabManager.requireCDP(tabTarget);
    const queryScript = `
      Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
        .slice(0, ${limit})
        .map((el, index) => ({
          index,
          tagName: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.className || undefined,
          text: el.textContent?.trim().substring(0, 100) || undefined
        }))
    `;
    if (frameTarget) {
      return cdp.evaluateInFrame(await this.resolveFrameId(cdp, frameTarget), queryScript);
    }
    return cdp.evaluate(queryScript);
  }

  /**
   * Read a page's visible text.
   *
   * ⚠️ CONFIRMED BUG, and the reason for most of this method:
   *
   *   `text.substring(0, maxLength)`  ->  SILENT truncation at 5000 chars
   *
   * The old implementation cut at maxLength and returned the prefix with no
   * indication anything had been removed. A caller reading past the cut sees
   * content simply absent, which is indistinguishable from a page that doesn't
   * have it. Truncation is now reported explicitly.
   *
   * ⛔ SPECULATIVE, DO NOT TREAT AS DIAGNOSED — the innerText fallback below.
   * I originally justified it with "innerText returns '' for hidden documents,
   * so every headless tab reads as blank." **That is FALSE and I measured it
   * false on 2026-08-02**: a backgrounded tab reporting
   * `visibilityState=hidden, hidden=true` returned innerText=129, not ''.
   * The case that prompted it — an ecobee SPA showing innerText=0 while
   * textContent=3578 — turned out to be a page whose textContent was ENTIRELY
   * <script> text (script+style chars = 3679, i.e. non-script text was
   * negative). innerText=0 was simply CORRECT there.
   *
   * So the fallback is kept as cheap defence-in-depth, NOT as a fix for a known
   * fault: if innerText is empty while real non-script text nodes exist, we
   * surface them rather than returning '' and letting a caller conclude the
   * page is blank. `documentHidden` is reported as an OBSERVATION for whoever
   * is debugging, not as the cause of anything.
   *
   * ⚑ STILL UNEXPLAINED: `storybook`'s user-tester described a dialog it had
   * itself opened as "invisible, no visible content" when it was 480x828 with
   * 583 characters in it. This method does not explain that, and the tempting
   * story above was wrong. Do not close that case with this code.
   *
   * The happy path still returns a plain string exactly as before; only
   * truncation and the fallback return an object, so a caller can always tell
   * it was reading something other than a clean render.
   */
  async handleGetVisibleText({ selector, maxLength = 5000, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    const rootExpr = selector
      ? `document.querySelector('${selector.replace(/'/g, "\\'")}')`
      : 'document.body';

    const script = `(function(){
      var root = ${rootExpr};
      if (!root) return JSON.stringify({ notFound: true });
      var rendered = root.innerText || '';
      if (rendered.trim()) return JSON.stringify({ text: rendered, source: 'innerText' });
      // innerText empty. Either genuinely blank, or the document isn't rendered.
      // Walk text nodes directly — no layout required — skipping non-content
      // elements and anything explicitly hidden by computed style (which IS
      // available without layout).
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function(n) {
          var p = n.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          var t = p.tagName;
          if (t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT' || t === 'TEMPLATE') return NodeFilter.FILTER_REJECT;
          if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          var cs = getComputedStyle(p);
          if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var parts = [], n;
      while ((n = walker.nextNode())) parts.push(n.nodeValue.trim());
      return JSON.stringify({
        text: parts.join('\\n'),
        source: 'textWalk',
        documentHidden: document.visibilityState === 'hidden'
      });
    })()`;

    const raw = await cdp.evaluate(script);
    let parsed;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      // Don't swallow it — an unparseable result is exactly the silent-failure
      // shape this method exists to stop doing.
      return { error: 'VISIBLE_TEXT_UNREADABLE', detail: String(raw).slice(0, 200) };
    }

    if (parsed.notFound) {
      return { error: 'SELECTOR_NOT_FOUND', selector: selector || null };
    }

    const full = parsed.text || '';
    const truncated = full.length > maxLength;
    const text = truncated ? full.substring(0, maxLength) : full;

    // Unremarkable read → same plain string it always returned.
    if (!truncated && parsed.source === 'innerText') return text;

    return {
      text,
      ...(truncated && {
        truncated: true,
        returnedLength: text.length,
        totalLength: full.length,
        // ⚠️ Word this in terms of POSITION, not size. The trap is the OFFSET
        // of what you're looking for, never its length: `storybook`'s tester
        // missed a 684-char dialog because it began at character 12,387 of a
        // 13,245-char page, so the default read returned 0–5000 and truthfully
        // answered a different question. A 4,000-char block at the top comes
        // back fine; a tiny modal late in the DOM does not. Reporting only a
        // byte count invites exactly the comparison I got wrong myself —
        // "684 is nowhere near 5000, so this isn't it."
        note: `TRUNCATED: returned characters 0–${text.length} of ${full.length}. ⚠️ ANYTHING LATER IN THE DOCUMENT IS ABSENT FROM THIS RESULT REGARDLESS OF ITS SIZE — modals, dialogs, footers and late sections commonly sit past the cut even when they are small. Do not read this as "the page does not contain it". Pass a selector to target the element directly, or raise maxLength above ${full.length}.`,
      }),
      ...(parsed.source === 'textWalk' && {
        source: 'textWalk',
        documentHidden: parsed.documentHidden,
        note2: parsed.documentHidden
          ? 'innerText was empty because this document is HIDDEN (background/headless tab), not because the page is blank. Text recovered by walking text nodes; visual ordering may differ slightly from a rendered read.'
          : 'innerText was empty but text nodes exist; recovered by walking them.',
      }),
    };
  }

  async handleGetComputedStyles({ selector, properties, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    const defaultProperties = ['display', 'visibility', 'position', 'width', 'height', 'top', 'left', 'opacity', 'z-index'];
    const propsToGet = properties && properties.length > 0 ? properties : defaultProperties;

    return await cdp.evaluate(`
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

  async handleCheckVisibility({ selector, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    return await cdp.evaluate(`
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

  async handleGetAttributes({ selector, attributes, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    const specificAttrs = attributes && attributes.length > 0;

    return await cdp.evaluate(`
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

  async handleCountElements({ selector, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    return cdp.evaluate(`document.querySelectorAll('${selector.replace(/'/g, "\\'")}').length`);
  }

  async handleGetPageMetadata({ tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    return await cdp.evaluate(`
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

  async handleGetFilteredAriaTree({ roles, maxDepth = 5, interactiveOnly, tabTarget, frameTarget }) {
    const cdp = await this.tabManager.requireCDP(tabTarget);
    let fullTree;
    if (frameTarget) {
      const frameId = await this.resolveFrameId(cdp, frameTarget);
      // Accessibility.getFullAXTree accepts frameId (Chrome 97+)
      fullTree = await cdp.sendCommand('Accessibility.getFullAXTree', { frameId, depth: maxDepth });
    } else {
      fullTree = await cdp.getPartialAccessibilityTree(maxDepth);
    }

    if (!fullTree.nodes || fullTree.nodes.length === 0) {
      return null;
    }

    // Build a lookup map and find the root node (same fix as handleSnapshot)
    const nodeMap = new Map();
    for (const node of fullTree.nodes) {
      nodeMap.set(node.nodeId, node);
    }
    const allChildIds = new Set(fullTree.nodes.flatMap(n => n.childIds || []));
    const rootNode = fullTree.nodes.find(n => !allChildIds.has(n.nodeId));

    const interactiveRoles = ['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'menuitem', 'tab', 'switch', 'slider'];

    const filterNode = (nodeId, depth = 0) => {
      if (depth > maxDepth) return null;
      const node = nodeMap.get(nodeId);
      if (!node || node.ignored) return null;

      const filteredChildren = (node.childIds || [])
        .map(id => filterNode(id, depth + 1))
        .filter(Boolean);

      const { childIds, ...rest } = node;

      // Check role filter
      if (roles && roles.length > 0 && !roles.includes(node.role?.value)) {
        return filteredChildren.length > 0 ? { ...rest, children: filteredChildren } : null;
      }

      // Check interactive filter
      if (interactiveOnly && !interactiveRoles.includes(node.role?.value)) {
        return filteredChildren.length > 0 ? { ...rest, children: filteredChildren } : null;
      }

      return {
        ...rest,
        children: filteredChildren.length > 0 ? filteredChildren : undefined
      };
    };

    return rootNode ? filterNode(rootNode.nodeId) : null;
  }

  async handleFindByText({ text, selector, exact, limit = 10, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    const searchText = text.toLowerCase();

    return await cdp.evaluate(`
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

  async handleGetFormValues({ formSelector, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    return await cdp.evaluate(`
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

  async handleCheckElementState({ selector, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    return await cdp.evaluate(`
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



  /**
   * Inject draggable user action overlay into page
   */
  async injectUserActionOverlay(requestId, request) {
    await chrome.scripting.executeScript({
      target: { tabId: this.state.tabId },
      func: (requestId, request) => {
        // Remove any existing overlay first
        const existing = document.getElementById('mcp-user-action-overlay');
        if (existing) existing.remove();

        // Create draggable overlay
        const overlay = document.createElement('div');
        overlay.id = 'mcp-user-action-overlay';
        overlay.style.cssText = `
          position: fixed;
          top: 20px;
          left: 20px;
          background: white;
          border: 2px solid #4a90e2;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          z-index: 2147483647;
          max-width: 400px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          cursor: move;
        `;

        overlay.innerHTML = `
          <div id="mcp-overlay-header" style="
            margin-bottom: 15px;
            cursor: move;
            user-select: none;
          ">
            <div style="font-weight: 600; font-size: 16px; color: #2d3748; margin-bottom: 8px;">
              🤖 Agent Request
            </div>
            <div style="font-size: 14px; color: #4a5568; line-height: 1.5; white-space: pre-wrap;">
              ${request}
            </div>
          </div>
          <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button id="mcp-reject-btn" style="
              padding: 8px 16px;
              border: 1px solid #e2e8f0;
              border-radius: 6px;
              background: white;
              color: #4a5568;
              cursor: pointer;
              font-size: 14px;
              font-weight: 500;
            ">Reject</button>
            <button id="mcp-complete-btn" style="
              padding: 8px 16px;
              border: none;
              border-radius: 6px;
              background: #4a90e2;
              color: white;
              cursor: pointer;
              font-size: 14px;
              font-weight: 500;
            ">Complete</button>
          </div>
        `;

        document.body.appendChild(overlay);

        // Make overlay draggable
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;

        const header = document.getElementById('mcp-overlay-header');

        header.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);

        function dragStart(e) {
          initialX = e.clientX - xOffset;
          initialY = e.clientY - yOffset;

          if (e.target === header || header.contains(e.target)) {
            isDragging = true;
          }
        }

        function drag(e) {
          if (isDragging) {
            e.preventDefault();

            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            xOffset = currentX;
            yOffset = currentY;

            setTranslate(currentX, currentY, overlay);
          }
        }

        function dragEnd(e) {
          initialX = currentX;
          initialY = currentY;
          isDragging = false;
        }

        function setTranslate(xPos, yPos, el) {
          el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
        }

        // Button handlers - show feedback modal instead of immediate completion
        document.getElementById('mcp-complete-btn').addEventListener('click', () => {
          showFeedbackModal('completed');
        });

        document.getElementById('mcp-reject-btn').addEventListener('click', () => {
          showFeedbackModal('rejected');
        });

        // Show feedback modal
        function showFeedbackModal(action) {
          // Hide the main overlay temporarily
          overlay.style.display = 'none';

          // Create feedback modal
          const feedbackModal = document.createElement('div');
          feedbackModal.id = 'mcp-feedback-modal';
          feedbackModal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border: 2px solid ${action === 'completed' ? '#4a90e2' : '#e53e3e'};
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            z-index: 2147483648;
            width: 420px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          `;

          feedbackModal.innerHTML = `
            <div style="margin-bottom: 16px;">
              <div style="font-weight: 600; font-size: 16px; color: #2d3748; margin-bottom: 8px;">
                ${action === 'completed' ? '✅ Action Completed' : '❌ Action Rejected'}
              </div>
              <div style="font-size: 14px; color: #4a5568; line-height: 1.5;">
                ${action === 'completed'
                  ? 'Optionally provide additional information about what you did:'
                  : 'Optionally explain why you rejected this request:'}
              </div>
            </div>
            <textarea id="mcp-feedback-text" placeholder="Enter feedback here (optional)..." style="
              width: 100%;
              min-height: 100px;
              padding: 12px;
              border: 1px solid #e2e8f0;
              border-radius: 6px;
              font-size: 14px;
              font-family: inherit;
              resize: vertical;
              margin-bottom: 16px;
              box-sizing: border-box;
            "></textarea>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
              <button id="mcp-feedback-cancel" style="
                padding: 8px 16px;
                border: 1px solid #e2e8f0;
                border-radius: 6px;
                background: white;
                color: #4a5568;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
              ">Back</button>
              <button id="mcp-feedback-send" style="
                padding: 8px 20px;
                border: none;
                border-radius: 6px;
                background: ${action === 'completed' ? '#4a90e2' : '#e53e3e'};
                color: white;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
              ">Send</button>
            </div>
          `;

          document.body.appendChild(feedbackModal);

          // Focus textarea
          const textarea = document.getElementById('mcp-feedback-text');
          setTimeout(() => textarea.focus(), 100);

          // Cancel button - go back to main overlay
          document.getElementById('mcp-feedback-cancel').addEventListener('click', () => {
            feedbackModal.remove();
            overlay.style.display = 'block';
          });

          // Send button - send message with feedback
          document.getElementById('mcp-feedback-send').addEventListener('click', () => {
            const feedbackText = textarea.value.trim();
            chrome.runtime.sendMessage({
              type: action === 'completed' ? 'USER_ACTION_COMPLETE' : 'USER_ACTION_REJECTED',
              requestId: requestId,
              feedback: feedbackText || null
            });
            feedbackModal.remove();
            overlay.remove();
          });

          // Enter key submits (Ctrl+Enter for newline)
          textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              document.getElementById('mcp-feedback-send').click();
            }
          });

          // Hover effects for buttons
          const sendBtn = document.getElementById('mcp-feedback-send');
          const cancelBtn = document.getElementById('mcp-feedback-cancel');

          sendBtn.addEventListener('mouseenter', () => {
            sendBtn.style.background = action === 'completed' ? '#3182ce' : '#c53030';
          });
          sendBtn.addEventListener('mouseleave', () => {
            sendBtn.style.background = action === 'completed' ? '#4a90e2' : '#e53e3e';
          });

          cancelBtn.addEventListener('mouseenter', () => cancelBtn.style.background = '#f7fafc');
          cancelBtn.addEventListener('mouseleave', () => cancelBtn.style.background = 'white');
        }

        // Hover effects
        const completeBtn = document.getElementById('mcp-complete-btn');
        const rejectBtn = document.getElementById('mcp-reject-btn');

        completeBtn.addEventListener('mouseenter', () => completeBtn.style.background = '#3182ce');
        completeBtn.addEventListener('mouseleave', () => completeBtn.style.background = '#4a90e2');

        rejectBtn.addEventListener('mouseenter', () => rejectBtn.style.background = '#f7fafc');
        rejectBtn.addEventListener('mouseleave', () => rejectBtn.style.background = 'white');
      },
      args: [requestId, request]
    });
  }

  /**
   * Handle request user action - simplified version using background log
   */
  async handleRequestUserAction({ request }) {
    const requestId = `request-${Date.now()}`;
    console.log('[Background] User action request:', { requestId, request });

    return new Promise(async (resolve, reject) => {
      try {
        // Record start timestamp
        const startTime = Date.now();

        // Store request so overlay can access it
        this.currentUserActionRequest = {
          requestId,
          request,
          startTime,
          resolve,
          reject
        };

        // Set up message listener for user response
        const messageListener = (message, sender) => {
          if (message.type === 'USER_ACTION_COMPLETE' && message.requestId === requestId) {
            console.log('[Background] User completed action', message.feedback ? `with feedback: ${message.feedback}` : 'without feedback');
            const endTime = Date.now();

            // Query background interaction log for this time period
            const interactions = this.backgroundRecorder.get({
              startTime,
              endTime,
              limit: 1000 // Get all interactions during this period
            });

            // Store navigation listener before cleanup
            const navListener = this.currentUserActionRequest?.navigationListener;

            // Clean up
            this.currentUserActionRequest = null;
            chrome.action.setBadgeText({ text: '' });
            chrome.runtime.onMessage.removeListener(messageListener);

            // Remove notification
            chrome.notifications.clear(requestId);

            // Remove navigation listener
            if (navListener) {
              chrome.webNavigation.onCommitted.removeListener(navListener);
            }

            resolve({
              status: 'completed',
              request,
              startTime,
              endTime,
              duration: endTime - startTime,
              interactions: interactions.interactions,
              feedback: message.feedback || null
            });
          } else if (message.type === 'USER_ACTION_REJECTED' && message.requestId === requestId) {
            console.log('[Background] User rejected action', message.feedback ? `with reason: ${message.feedback}` : 'without reason');
            const endTime = Date.now();

            // Store navigation listener before cleanup
            const navListener = this.currentUserActionRequest?.navigationListener;

            // Clean up
            this.currentUserActionRequest = null;
            chrome.action.setBadgeText({ text: '' });
            chrome.runtime.onMessage.removeListener(messageListener);

            // Remove notification
            chrome.notifications.clear(requestId);

            // Remove navigation listener
            if (navListener) {
              chrome.webNavigation.onCommitted.removeListener(navListener);
            }

            resolve({
              status: 'rejected',
              request,
              startTime,
              endTime,
              duration: endTime - startTime,
              interactions: [],
              feedback: message.feedback || null
            });
          }
          // Explicitly return false to indicate no async response needed
          return false;
        };

        chrome.runtime.onMessage.addListener(messageListener);

        // Show badge to indicate request pending
        chrome.action.setBadgeText({ text: '?' });
        chrome.action.setBadgeBackgroundColor({ color: '#4a90e2' });

        // Create persistent notification
        await chrome.notifications.create(requestId, {
          type: 'basic',
          iconUrl: 'icon-48.png',
          title: '🤖 Agent Request Active',
          message: request.substring(0, 100) + (request.length > 100 ? '...' : ''),
          priority: 2,
          requireInteraction: true
        });

        // Store navigation listener to re-inject overlay on navigation
        const navigationListener = (details) => {
          if (details.tabId === this.state.tabId && details.frameId === 0) {
            console.log('[Background] Page navigated, re-injecting overlay');
            // Re-inject overlay after navigation
            setTimeout(() => {
              this.injectUserActionOverlay(requestId, request);
            }, 500);
          }
        };
        chrome.webNavigation.onCommitted.addListener(navigationListener);
        this.currentUserActionRequest.navigationListener = navigationListener;

        // Inject user action overlay
        await this.injectUserActionOverlay(requestId, request);
        console.log('[Background] User action overlay injected');
      } catch (error) {
        console.error('[Background] Error in handleRequestUserAction:', error);
        this.currentUserActionRequest = null;
        chrome.action.setBadgeText({ text: '' });
        reject(error);
      }
    });
  }

  /**
   * Handle browser_get_interactions
   */
  async handleGetInteractions(data) {
    console.log('[Background] Getting interactions:', data);
    const result = this.backgroundRecorder.get(data);
    return result;
  }

  /**
   * Handle browser_prune_interactions
   */
  async handlePruneInteractions(data) {
    console.log('[Background] Pruning interactions:', data);
    const result = this.backgroundRecorder.prune(data);
    return result;
  }

  /**
   * Handle browser_search_interactions
   */
  async handleSearchInteractions(data) {
    console.log('[Background] Searching interactions:', data);
    const result = this.backgroundRecorder.search(data.query, {
      types: data.types,
      startTime: data.startTime,
      endTime: data.endTime,
      limit: data.limit,
    });
    return result;
  }

  /**
   * Handle browser_get_cookies - Get cookies with optional filtering
   */
  async handleGetCookies(data) {
    console.log('[Background] Getting cookies:', data);

    // Build query details
    const details = {};
    if (data.url) {
      details.url = data.url;
    }
    if (data.name) {
      details.name = data.name;
    }
    if (data.domain) {
      details.domain = data.domain;
    }

    // Get cookies using Chrome API
    const cookies = await chrome.cookies.getAll(details);

    return { cookies };
  }

  /**
   * Handle browser_set_cookie - Set a cookie
   */
  async handleSetCookie(data) {
    console.log('[Background] Setting cookie:', data);

    // Build cookie details
    const details = {
      url: data.url,
      name: data.name,
      value: data.value,
    };

    // Optional parameters
    if (data.domain !== undefined) details.domain = data.domain;
    if (data.path !== undefined) details.path = data.path;
    if (data.secure !== undefined) details.secure = data.secure;
    if (data.httpOnly !== undefined) details.httpOnly = data.httpOnly;
    if (data.sameSite !== undefined) details.sameSite = data.sameSite;
    if (data.expirationDate !== undefined) details.expirationDate = data.expirationDate;

    // Set the cookie
    await chrome.cookies.set(details);

    return { success: true };
  }

  /**
   * Handle browser_delete_cookie - Delete a specific cookie
   */
  async handleDeleteCookie(data) {
    console.log('[Background] Deleting cookie:', data);

    // Delete the cookie
    const result = await chrome.cookies.remove({
      url: data.url,
      name: data.name,
    });

    return { success: result !== null };
  }

  /**
   * Handle browser_clear_cookies - Clear cookies with optional filtering
   */
  async handleClearCookies(data) {
    console.log('[Background] Clearing cookies:', data);

    // Build query details
    const details = {};
    if (data.url) {
      details.url = data.url;
    }
    if (data.domain) {
      details.domain = data.domain;
    }

    // Get all cookies matching the filter
    const cookies = await chrome.cookies.getAll(details);

    // Delete each cookie
    let count = 0;
    for (const cookie of cookies) {
      const url = `http${cookie.secure ? 's' : ''}://${cookie.domain}${cookie.path}`;
      const result = await chrome.cookies.remove({
        url: url,
        name: cookie.name,
      });
      if (result !== null) {
        count++;
      }
    }

    return { count };
  }

  /**
   * Handle browser_download_file - Download a file from a URL
   */
  async handleDownloadFile(data) {
    console.log('[Background] Downloading file:', data);

    // Build download options
    const options = {
      url: data.url,
    };

    // Optional parameters
    if (data.filename !== undefined) {
      options.filename = data.filename;
    }
    if (data.saveAs !== undefined) {
      options.saveAs = data.saveAs;
    }

    // Initiate download
    const downloadId = await chrome.downloads.download(options);

    return { downloadId };
  }

  /**
   * Handle browser_get_downloads - Get download items with optional filtering
   */
  async handleGetDownloads(data) {
    console.log('[Background] Getting downloads:', data);

    // Build query
    const query = {};
    if (data.query && data.query.length > 0) {
      query.query = data.query;
    }
    if (data.orderBy && data.orderBy.length > 0) {
      query.orderBy = data.orderBy;
    }
    if (data.limit !== undefined) {
      query.limit = data.limit;
    }

    // Search downloads
    const downloads = await chrome.downloads.search(query);

    return { downloads };
  }

  /**
   * Handle browser_cancel_download - Cancel a download
   */
  async handleCancelDownload(data) {
    console.log('[Background] Cancelling download:', data);

    // Cancel the download
    await chrome.downloads.cancel(data.downloadId);

    return { success: true };
  }

  /**
   * Handle browser_open_download - Open a downloaded file
   */
  async handleOpenDownload(data) {
    console.log('[Background] Opening download:', data);

    // Open the download
    await chrome.downloads.open(data.downloadId);

    return { success: true };
  }

  /**
   * Handle browser_get_clipboard - Read text from clipboard
   */
  async handleGetClipboard(data) {
    console.log('[Background] Getting clipboard');

    try {
      // Use chrome.scripting with proper user gesture context
      // This is more reliable than CDP evaluation for clipboard operations
      const results = await chrome.scripting.executeScript({
        target: { tabId: this.state.tabId },
        func: async () => {
          try {
            // Focus the document first to ensure we have user gesture
            window.focus();
            document.body.focus();

            // Try using the Clipboard API
            if (navigator.clipboard && navigator.clipboard.readText) {
              return await navigator.clipboard.readText();
            }

            // Fallback: use a temporary textarea
            const textarea = document.createElement('textarea');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            document.execCommand('paste');
            const text = textarea.value;
            document.body.removeChild(textarea);
            return text;
          } catch (error) {
            throw new Error('Failed to read clipboard: ' + error.message);
          }
        },
        world: 'MAIN'
      });

      const text = results[0]?.result || '';
      return { text };
    } catch (error) {
      console.error('[Background] Clipboard read failed:', error);
      throw new Error(`Clipboard read failed: ${error.message}`);
    }
  }

  /**
   * Handle browser_set_clipboard - Write text to clipboard
   */
  async handleSetClipboard(data) {
    console.log('[Background] Setting clipboard:', data.text.substring(0, 50));

    try {
      // Use chrome.scripting with proper user gesture context
      // This is more reliable than CDP evaluation for clipboard operations
      await chrome.scripting.executeScript({
        target: { tabId: this.state.tabId },
        func: async (text) => {
          try {
            // Focus the document first to ensure we have user gesture
            window.focus();
            document.body.focus();

            // Try using the Clipboard API first
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(text);
              return;
            }

            // Fallback: use a temporary textarea
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
          } catch (error) {
            throw new Error('Failed to write clipboard: ' + error.message);
          }
        },
        args: [data.text],
        world: 'MAIN'
      });

      return { success: true };
    } catch (error) {
      console.error('[Background] Clipboard write failed:', error);
      throw new Error(`Clipboard write failed: ${error.message}`);
    }
  }

  /**
   * Handle browser_search_history - Search browsing history
   */
  async handleSearchHistory(data) {
    console.log('[Background] Searching history:', data.text);

    // Build query
    const query = {
      text: data.text,
    };
    if (data.startTime !== undefined) {
      query.startTime = data.startTime;
    }
    if (data.endTime !== undefined) {
      query.endTime = data.endTime;
    }
    if (data.maxResults !== undefined) {
      query.maxResults = data.maxResults;
    }

    // Search history
    const results = await chrome.history.search(query);

    return { results };
  }

  /**
   * Handle browser_get_history_visits - Get visit details for a URL
   */
  async handleGetHistoryVisits(data) {
    console.log('[Background] Getting history visits for:', data.url);

    // Get visits for URL
    const visits = await chrome.history.getVisits({ url: data.url });

    return { visits };
  }

  /**
   * Handle browser_delete_history - Delete specific URLs from history
   */
  async handleDeleteHistory(data) {
    console.log('[Background] Deleting history for:', data.urls);

    // Delete each URL from history
    for (const url of data.urls) {
      await chrome.history.deleteUrl({ url });
    }

    return { success: true };
  }

  /**
   * Handle browser_clear_history - Clear history for time range
   */
  async handleClearHistory(data) {
    console.log('[Background] Clearing history from:', data.startTime, 'to:', data.endTime);

    // Delete history range
    await chrome.history.deleteRange({
      startTime: data.startTime,
      endTime: data.endTime,
    });

    return { success: true };
  }

  // System Information Handlers

  /**
   * Get browser version information
   */
  async handleGetVersion(data) {
    console.log('[Background] Getting browser version');

    // Get browser info from runtime
    const manifest = chrome.runtime.getManifest();
    const browserInfo = await chrome.runtime.getPlatformInfo();

    return {
      // ⚠️ Both of these were hardcoded to Chrome: the name literally, and the
      // version by parsing the UA's `Chrome/` token — which every Chromium
      // fork carries, so on Edge this reported "Chrome" plus the underlying
      // Chromium version. An agent asking which browser it was driving got a
      // confident wrong answer, and nothing failed to make that visible.
      browserName: BrowserEnv.name,
      browserVersion: BrowserEnv.version,
      // Kept alongside, because the fork version and the engine version are
      // different questions and callers checking for a Chromium-level
      // behaviour change want this one.
      chromiumVersion: BrowserEnv.chromiumVersion,
      extensionVersion: manifest.version,
      userAgent: navigator.userAgent,
      platform: browserInfo,
    };
  }

  /**
   * Get system information
   */
  async handleGetSystemInfo(data) {
    console.log('[Background] Getting system info');

    const platformInfo = await chrome.runtime.getPlatformInfo();

    return {
      os: platformInfo.os,
      arch: platformInfo.arch,
      platform: platformInfo.os,
      nacl_arch: platformInfo.nacl_arch,
    };
  }

  /**
   * Get browser capabilities and information
   */
  async handleGetBrowserInfo(data) {
    console.log('[Background] Getting browser info');

    const manifest = chrome.runtime.getManifest();
    const platformInfo = await chrome.runtime.getPlatformInfo();

    // Get installed extensions count (only this extension)
    let extensionCount = 0;
    try {
      const extensions = await chrome.management.getAll();
      extensionCount = extensions.filter(ext => ext.enabled && ext.type === 'extension').length;
    } catch (error) {
      console.warn('[Background] Could not get extensions:', error);
    }

    return {
      browserName: BrowserEnv.name,
      browserVersion: BrowserEnv.version,
      chromiumVersion: BrowserEnv.chromiumVersion,
      extensionName: manifest.name,
      extensionVersion: manifest.version,
      manifestVersion: manifest.manifest_version,
      platform: platformInfo,
      installedExtensions: extensionCount,
      permissions: manifest.permissions || [],
      hostPermissions: manifest.host_permissions || [],
    };
  }

  // Network Handlers

  /**
   * Get current network connection state
   */
  async handleGetNetworkState({ tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    console.log('[Background] Getting network state');

    // Evaluate navigator.connection in the page context
    const connectionInfo = await cdp.evaluate(`
      (() => {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!conn) {
          return {
            online: navigator.onLine,
            type: 'unknown',
          };
        }
        return {
          online: navigator.onLine,
          type: conn.effectiveType || conn.type || 'unknown',
          downlink: conn.downlink,
          downlinkMax: conn.downlinkMax,
          rtt: conn.rtt,
          saveData: conn.saveData,
        };
      })()
    `, true);

    return connectionInfo;
  }

  /**
   * Set network throttling conditions
   */
  async handleSetNetworkConditions({ offline, latency, downloadThroughput, uploadThroughput, tabTarget }) {
    const cdp = this.tabManager.requireCDP(tabTarget);
    console.log('[Background] Setting network conditions:', { offline, latency, downloadThroughput, uploadThroughput });

    // Use CDP to emulate network conditions
    const conditions = {
      offline: offline || false,
      latency: latency || 0,
      downloadThroughput: downloadThroughput !== undefined ? downloadThroughput : -1,
      uploadThroughput: uploadThroughput !== undefined ? uploadThroughput : -1,
    };

    await cdp.sendCommand('Network.emulateNetworkConditions', conditions);

    return { success: true, conditions };
  }

  /**
   * Clear browser cache
   */
  async handleClearCache(data) {
    console.log('[Background] Clearing cache');

    const cacheStorage = data.cacheStorage !== false;

    // Clear browsing data using Chrome API
    await chrome.browsingData.remove(
      {},
      {
        cache: true,
        cacheStorage: cacheStorage,
      }
    );

    return { success: true };
  }

  // Bookmark Handlers

  /**
   * Get bookmarks from the browser
   */
  async handleGetBookmarks(data) {
    console.log('[Background] Getting bookmarks:', data);

    // Get bookmarks from a specific parent or the entire tree
    let bookmarks;
    if (data.parentId) {
      bookmarks = await chrome.bookmarks.getChildren(data.parentId);
    } else {
      bookmarks = await chrome.bookmarks.getTree();
    }

    return { bookmarks };
  }

  /**
   * Create a new bookmark
   */
  async handleCreateBookmark(data) {
    console.log('[Background] Creating bookmark:', data.title);

    const bookmark = {
      title: data.title,
      url: data.url,
    };

    if (data.parentId) {
      bookmark.parentId = data.parentId;
    }

    const created = await chrome.bookmarks.create(bookmark);

    return { bookmark: created };
  }

  /**
   * Delete a bookmark
   */
  async handleDeleteBookmark(data) {
    console.log('[Background] Deleting bookmark:', data.id);

    await chrome.bookmarks.remove(data.id);

    return { success: true };
  }

  /**
   * Search bookmarks
   */
  async handleSearchBookmarks(data) {
    console.log('[Background] Searching bookmarks:', data.query);

    // Search bookmarks
    const results = await chrome.bookmarks.search(data.query);

    // Limit results if specified
    const bookmarks = data.maxResults
      ? results.slice(0, data.maxResults)
      : results;

    return { bookmarks };
  }

  // Extension Management Handlers

  /**
   * List all installed extensions
   */
  async handleListExtensions(data) {
    console.log('[Background] Listing extensions');

    const extensions = await chrome.management.getAll();

    return { extensions };
  }

  /**
   * Get extension information
   */
  async handleGetExtensionInfo(data) {
    console.log('[Background] Getting extension info:', data.id);

    const extension = await chrome.management.get(data.id);

    return { extension };
  }

  /**
   * Enable an extension
   */
  async handleEnableExtension(data) {
    console.log('[Background] Enabling extension:', data.id);

    await chrome.management.setEnabled(data.id, true);

    return { success: true };
  }

  /**
   * Disable an extension
   */
  async handleDisableExtension(data) {
    console.log('[Background] Disabling extension:', data.id);

    await chrome.management.setEnabled(data.id, false);

    return { success: true };
  }
}

// Initialize controller
const controller = new BackgroundController();

// ⚠️ Wire the error capture IMMEDIATELY, at module scope, before anything else
// runs. Two reasons it goes here rather than inside some later init step:
//   1. This is the earliest point a throw can happen in a fresh service-worker
//      generation, and startup is exactly when the interesting crashes occur.
//   2. There is no other init hook guaranteed to run — the worker is spun up
//      and torn down constantly, and a capture installed lazily is a capture
//      that misses the generation that died.
controller.installGlobalErrorCapture();
// Recover what a PREVIOUS generation recorded before it went away. Fire and
// forget: the read is async, and blocking module evaluation on storage would
// delay every connect.
controller.loadPersistedBackgroundErrors().catch(() => {});

console.log('[Background] Browser MCP extension loaded');

// Note: Debugger cleanup is now handled in CDP attach logic when conflicts are detected
// No automatic cleanup on load to preserve existing attachments

// Auto-connect functionality
async function autoConnect() {
  // First clean up any leftover indicators/prefixes from previous sessions
  await controller.cleanupOnStartup();
  console.log('[Background] Extension initialized and cleaned up');

  // Don't attempt twice
  if (autoConnectAttempted) {
    return;
  }

  try {
    console.log('[Background] Starting auto-connect...');
    autoConnectAttempted = true;

    // Wait for offscreen document to be ready (with timeout)
    if (!offscreenReady) {
      console.log('[Background] Waiting for offscreen document...');
      const startTime = Date.now();
      while (!offscreenReady && (Date.now() - startTime) < 5000) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (!offscreenReady) {
        console.log('[Background] Offscreen document not ready after 5s, proceeding anyway...');
      }
    }

    // Connect WebSocket to server
    await controller.connect();
    console.log('[Background] WebSocket connected');

    // Auto-select active tab, but skip restricted URLs
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

    // Filter out restricted URLs (the browser's own pages, extension pages, about:)
    const isRestricted = (url) => {
      if (!url) return true;
      return BrowserEnv.isInternalUrl(url) ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:');
    };

    let selectedTab = null;

    // First try the active tab
    if (tabs.length > 0 && !isRestricted(tabs[0].url)) {
      selectedTab = tabs[0];
    } else {
      // Find any non-restricted tab
      console.log('[Background] Active tab is restricted, searching for valid tab...');
      const allTabs = await chrome.tabs.query({});
      for (const tab of allTabs) {
        if (!isRestricted(tab.url)) {
          selectedTab = tab;
          console.log('[Background] Found valid tab:', tab.id, tab.url);
          break;
        }
      }
    }

    if (selectedTab) {
      console.log('[Background] Auto-connect found valid tab:', selectedTab.id, selectedTab.url);
      console.log('[Background] Note: Tab is not attached yet - use popup to attach tabs');
      console.log('[Background] Auto-connect complete - ready for MCP commands when tabs are attached');
    } else {
      console.log('[Background] No valid tabs found - will connect when a valid tab becomes active');
      console.log('[Background] Note: chrome://, about:, and other restricted URLs cannot be controlled');
    }
  } catch (error) {
    console.error('[Background] Auto-connect failed:', error);
    autoConnectAttempted = false; // Allow retry
    // Don't bother with setTimeout — MV3 SWs unload aggressively and the
    // setTimeout dies with the SW. The always-on `sw-keepalive` alarm
    // (created at module load) will retry on its next tick whether the SW
    // is alive or dormant. Single recovery mechanism > two unreliable ones.
  }
}

// ── sw-keepalive heartbeat, written to disk ──────────────────────────────────
//
// ⛔ WHY THIS EXISTS. On 2026-08-16 the socket to mcp-server was dead for 31
// minutes — roughly 62 consecutive sw-keepalive ticks, every one of which
// should have reconnected it (see the handler below: it forces a reconnect
// whenever the socket is dead). It was the FOURTH such outage, and after all
// four we still could not say which of these happened:
//     · the alarm stopped firing altogether
//     · it fired and got stuck partway through the handler
//     · it fired, completed, and decided not to act
// Those are three different bugs with three different fixes, and nothing in
// Chrome records which one we are looking at. The service-worker console is
// useless here: it is cleared by the reload that ends the outage, so the
// evidence is destroyed by the repair.
//
// chrome.storage.local survives BOTH service-worker eviction and an extension
// reload, so this makes the next occurrence readable after the fact instead of
// argued about. ⭐ A record written at 'enter' with no matching outcome record
// is the signal that the handler HUNG rather than failed — a hang leaves no
// error anywhere else.
//
// READING IT WHEN THE EXTENSION IS DEAD (the case that matters — you cannot ask
// a dead worker anything). Verified working on office 2026-08-16:
//
//   strings "$HOME/.config/google-chrome/Profile 1/Local Extension Settings/\
// pikjoohganfooeancifkoccakcocchmk"/*.log | grep swHeartbeat | tail -1
//
//   → swHeartbeat[{"at":1.78693049208e+12,"stage":"enter"},
//                 {"at":1.786930493141e+12,"stage":"probed","wsLive":true,
//                  "shouldReconnect":true}]
//
// ⚠️ The profile directory is "Profile 1" on ben's office Chrome, NOT "Default"
// — do not assume, `find ~/.config/google-chrome -maxdepth 2 -type d -name
// 'Local Extension Settings'`. The per-extension subdirectory is Chrome's own
// extension id, which is NOT the `ext_…` handle mcp-server uses; find it with
// `grep -l swHeartbeat */*.log`.
// ⚠️ `at` is epoch ms but Chrome's serializer writes it in scientific notation
// (1.78693049208e+12), so it needs a float parse, not an int parse.
const HEARTBEAT_KEY = 'swHeartbeat';
const HEARTBEAT_MAX = 80; // ~20 min of history at 2 records per 30s tick

async function recordHeartbeat(stage, extra = {}) {
  try {
    const stored = await chrome.storage.local.get(HEARTBEAT_KEY);
    const ring = Array.isArray(stored?.[HEARTBEAT_KEY]) ? stored[HEARTBEAT_KEY] : [];
    ring.push({ at: Date.now(), stage, ...extra });
    while (ring.length > HEARTBEAT_MAX) ring.shift();
    await chrome.storage.local.set({ [HEARTBEAT_KEY]: ring });
  } catch (err) {
    // Instrumentation must NEVER break the recovery path it is instrumenting.
    // A failed write costs us evidence; a thrown write would cost us the
    // reconnect, which is the whole point of the handler.
    console.warn('[Background] heartbeat write failed (ignored):', err?.message || err);
  }
}

// Alarm listener must be registered synchronously at top level so Chrome wakes
// the service worker when the alarm fires (even after suspension).
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'sw-keepalive') return;
  console.log('[Background] sw-keepalive alarm fired — service worker awake');

  // Written BEFORE the first await below, so that a hang in isConnected() —
  // the failure this whole record exists to catch — still leaves a trace.
  await recordHeartbeat('enter');

  // Always check the ACTUAL WebSocket state, not controller.state.connected. The
  // in-memory state is set optimistically in connect() before the async ws.connect()
  // resolves, so it can stay `true` after a silent failure — which would block the
  // alarm from ever recovering. isConnected() is async (offscreen round-trip), so
  // it MUST be awaited — otherwise wsLive is a (truthy) Promise and we never recover.
  // ⚠️ Everything below runs inside try/catch ONLY so the failure is recorded.
  // An async listener that throws is swallowed by Chrome with nothing logged
  // anywhere a later reader can find — which is indistinguishable from the
  // alarm never having fired, and is one of the three cases we could not tell
  // apart across four outages.
  try {
    const wsLive = await controller.ws.isConnected();

    // Default to reconnecting unless storage explicitly says no. This recovers from
    // session-storage being cleared or never written.
    const { swShouldReconnect } = await chrome.storage.session.get('swShouldReconnect');
    const shouldReconnect = swShouldReconnect !== false;

    // Reconcile in-memory state with reality.
    controller.state.connected = wsLive;

    await recordHeartbeat('probed', { wsLive, shouldReconnect });

    if (shouldReconnect && !wsLive) {
      console.log('[Background] Alarm wake: WebSocket dead, forcing reconnect…');
      autoConnectAttempted = false; // clear any stuck flag
      await autoConnect();
      // Re-probe rather than assuming autoConnect() worked: it resolves without
      // throwing on a failed connect, so "we called it" and "it connected" are
      // different claims and only the second one matters.
      await recordHeartbeat('reconnected', { wsLive: await controller.ws.isConnected() });
    }

    // Restart keepalive interval if the service worker was suspended and it stopped.
    if (wsLive && !controller.keepaliveInterval) {
      controller.startKeepalive();
    }
  } catch (err) {
    await recordHeartbeat('threw', { error: String(err?.message || err) });
    console.error('[Background] sw-keepalive handler threw:', err);
  }
});

// Wake on Chrome (re)startup — without this, a closed-then-reopened browser leaves
// the extension dormant until the next alarm tick, which can be 30s of dead time.
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] chrome.runtime.onStartup — kicking auto-connect');
  autoConnectAttempted = false;
  autoConnect();
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Background] chrome.runtime.onInstalled', details.reason);
  autoConnectAttempted = false;
  autoConnect();
});

// Always-on keepalive alarm — created at SW module load, NEVER cleared.
// This is the only reliable mechanism that wakes a dormant MV3 SW without
// human action. The alarm handler (chrome.alarms.onAlarm above) is gated
// by `swShouldReconnect`, so it's safe to leave running across explicit
// disconnects — it won't reconnect when the user doesn't want it to, but
// IT WILL keep the SW periodically alive, ready to act on a future
// reconnect intent. Removing this line is how we got into the
// disconnect-and-stay-stuck-forever bug fixed 2026-06-14.
chrome.alarms.create('sw-keepalive', { periodInMinutes: 0.5 });

// Start auto-connect on extension load
autoConnect();

// Periodic health check while the service worker is active — catches WebSocket drops
// (server restart, network blip) without needing an alarm wakeup. Also clears
// `autoConnectAttempted` if it got stuck (e.g. a previous attempt errored without
// firing a `disconnected` event, which is the only place the listener clears it).
let lastAutoConnectAt = Date.now();
setInterval(async () => {
  // isConnected() is async (offscreen round-trip) — must await, or the truthy
  // Promise short-circuits this check and we never reconnect after a drop.
  if (await controller.ws.isConnected()) {
    autoConnectAttempted = false;
    return;
  }
  // WS isn't connected. If we tried recently, give it time. If it's been >30s,
  // reset the flag and try again.
  if (autoConnectAttempted && Date.now() - lastAutoConnectAt > 30000) {
    console.log('[Background] autoConnectAttempted stuck for >30s — clearing');
    autoConnectAttempted = false;
  }
  if (!autoConnectAttempted) {
    console.log('[Background] Periodic health check: attempting to reconnect…');
    lastAutoConnectAt = Date.now();
    autoConnect();
  }
}, 5000);

// Auto-reconnect if tab changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (controller.state.connected && !controller.state.tabId) {
    console.log('[Background] Tab activated, auto-connecting:', activeInfo.tabId);
    const tab = await chrome.tabs.get(activeInfo.tabId);
    controller.state.tabId = tab.id;
    controller.state.tabUrl = tab.url;
    controller.state.tabTitle = tab.title;
  }
});
