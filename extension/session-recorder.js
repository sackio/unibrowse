/**
 * Session Recorder — Content Script
 *
 * Injected (with rrweb-record.min.js) at recording start and re-injected on each navigation.
 * Captures DOM mutations (rrweb), network traffic (XHR/fetch interceptor), and page lifecycle.
 * All events are streamed to background.js via chrome.runtime.sendMessage.
 */

// Guard against double-injection on the same page
if (window.__unibrowse_recording__) {
  console.log('[SessionRecorder] Already active on this page, skipping re-injection');
} else {
  window.__unibrowse_recording__ = true;

  // ─── Context validity helpers ────────────────────────────────────────────

  let _contextValid = true;
  let rrwebStop = null;

  /**
   * Check whether the extension context is still live.
   * Accessing chrome.runtime.id throws or returns undefined when the
   * service worker has been reloaded and this content script is orphaned.
   */
  function isContextValid() {
    try {
      return _contextValid && !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  /**
   * Safe sendMessage — silently drops the message if the context is gone,
   * and stops the rrweb recorder so it stops generating events.
   */
  function safeSend(message) {
    if (!isContextValid()) return;
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch (err) {
      if (err.message?.includes('Extension context invalidated') ||
          err.message?.includes('context invalidated')) {
        _contextValid = false;
        if (rrwebStop) { try { rrwebStop(); } catch {} rrwebStop = null; }
      }
    }
  }

  // ─── Page Lifecycle Markers ────────────────────────────────────────────────

  safeSend({
    type: 'SR_PAGE_START',
    url: location.href,
    title: document.title,
    timestamp: Date.now(),
  });

  window.addEventListener('beforeunload', () => {
    safeSend({
      type: 'SR_PAGE_END',
      url: location.href,
      timestamp: Date.now(),
    });
  });

  // ─── rrweb DOM Recording ──────────────────────────────────────────────────

  if (typeof rrwebRecord === 'function') {
    try {
      rrwebStop = rrwebRecord({
        emit(event) {
          safeSend({ type: 'SR_RRWEB', event });
        },
        maskAllInputs: false,
        blockClass: '__unibrowse_blocked__',
        sampling: {
          scroll: 150,
          media: 800,
          input: 'last',
        },
      });
      console.log('[SessionRecorder] rrweb recording started');
    } catch (err) {
      console.error('[SessionRecorder] rrweb failed to start:', err);
    }
  } else {
    console.warn('[SessionRecorder] rrwebRecord not available — DOM recording disabled');
  }

  // ─── Network Interceptor bridge ───────────────────────────────────────────
  // lib/network-interceptor.js is injected by background.js into the MAIN world
  // (world: 'MAIN') which bypasses CSP. It dispatches CustomEvents that we pick
  // up here in the ISOLATED world and forward to background.

  window.addEventListener('__unibrowse_network__', (e) => {
    safeSend({
      type: 'SR_NETWORK',
      entry: { ...e.detail, timestamp: Date.now() },
    });
  });

  console.log('[SessionRecorder] Active on', location.href);
}
