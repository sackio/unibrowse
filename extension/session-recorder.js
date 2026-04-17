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

  // ─── Page Lifecycle Markers ────────────────────────────────────────────────

  // Notify background that a new page has loaded in the recording tab
  chrome.runtime.sendMessage({
    type: 'SR_PAGE_START',
    url: location.href,
    title: document.title,
    timestamp: Date.now(),
  }).catch(() => {});

  window.addEventListener('beforeunload', () => {
    chrome.runtime.sendMessage({
      type: 'SR_PAGE_END',
      url: location.href,
      timestamp: Date.now(),
    }).catch(() => {});
  });

  // ─── rrweb DOM Recording ──────────────────────────────────────────────────

  let rrwebStop = null;

  if (typeof rrwebRecord === 'function') {
    try {
      rrwebStop = rrwebRecord({
        emit(event) {
          chrome.runtime.sendMessage({
            type: 'SR_RRWEB',
            event,
          }).catch(() => {});
        },
        // Capture all inputs including passwords (agents may need them for replay)
        maskAllInputs: false,
        blockClass: '__unibrowse_blocked__',
        sampling: {
          scroll: 150,   // ms throttle on scroll events
          media: 800,
          input: 'last', // only record final value, not every keystroke
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

  // Bridge CustomEvents from page context → background
  window.addEventListener('__unibrowse_network__', (e) => {
    const entry = e.detail;
    chrome.runtime.sendMessage({
      type: 'SR_NETWORK',
      entry: {
        ...entry,
        timestamp: Date.now(),
      },
    }).catch(() => {});
  });

  console.log('[SessionRecorder] Active on', location.href);
}
