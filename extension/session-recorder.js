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

  // ─── Network Interceptor (page context) ───────────────────────────────────
  // Must run in page context (not content script) to intercept page's XHR/fetch.
  // We inject a <script> tag and bridge events back via CustomEvent.

  const interceptorCode = `
(function() {
  if (window.__unibrowse_network_interceptor__) return;
  window.__unibrowse_network_interceptor__ = true;

  const MAX_BODY = 50 * 1024; // 50 KB cap on response bodies

  function truncate(str) {
    if (typeof str !== 'string') return str;
    return str.length > MAX_BODY ? str.slice(0, MAX_BODY) + '…[truncated]' : str;
  }

  function dispatch(entry) {
    window.dispatchEvent(new CustomEvent('__unibrowse_network__', { detail: entry }));
  }

  // ── XHR Interceptor ──────────────────────────────────────────────────────
  const OrigXHR = window.XMLHttpRequest;
  function InterceptedXHR() {
    const xhr = new OrigXHR();
    const entry = {
      id: Math.random().toString(36).slice(2),
      startTime: null,
      url: null,
      method: null,
      requestHeaders: {},
      requestBody: null,
      responseStatus: null,
      responseHeaders: {},
      responseBody: null,
      duration: null,
    };

    const origOpen = xhr.open.bind(xhr);
    xhr.open = function(method, url, ...args) {
      entry.method = method;
      entry.url = url;
      return origOpen(method, url, ...args);
    };

    const origSetRequestHeader = xhr.setRequestHeader.bind(xhr);
    xhr.setRequestHeader = function(name, value) {
      entry.requestHeaders[name] = value;
      return origSetRequestHeader(name, value);
    };

    const origSend = xhr.send.bind(xhr);
    xhr.send = function(body) {
      entry.startTime = Date.now();
      if (body) {
        try { entry.requestBody = typeof body === 'string' ? body : JSON.stringify(body); }
        catch(e) { entry.requestBody = String(body); }
      }
      xhr.addEventListener('loadend', function() {
        entry.responseStatus = xhr.status;
        entry.duration = Date.now() - entry.startTime;
        // Parse response headers
        const rawHeaders = xhr.getAllResponseHeaders();
        rawHeaders.trim().split(/\\r?\\n/).forEach(line => {
          const [key, ...rest] = line.split(':');
          if (key) entry.responseHeaders[key.trim()] = rest.join(':').trim();
        });
        try { entry.responseBody = truncate(xhr.responseText); }
        catch(e) { entry.responseBody = null; }
        dispatch(entry);
      });
      return origSend(body);
    };

    return xhr;
  }
  InterceptedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = InterceptedXHR;

  // ── Fetch Interceptor ────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function(input, init = {}) {
    const entry = {
      id: Math.random().toString(36).slice(2),
      startTime: Date.now(),
      url: typeof input === 'string' ? input : (input?.url || String(input)),
      method: (init.method || 'GET').toUpperCase(),
      requestHeaders: {},
      requestBody: null,
      responseStatus: null,
      responseHeaders: {},
      responseBody: null,
      duration: null,
    };

    // Capture request headers
    if (init.headers) {
      const headers = new Headers(init.headers);
      headers.forEach((v, k) => { entry.requestHeaders[k] = v; });
    }
    // Capture request body
    if (init.body) {
      try { entry.requestBody = typeof init.body === 'string' ? init.body : JSON.stringify(init.body); }
      catch(e) { entry.requestBody = String(init.body); }
    }

    try {
      const response = await origFetch(input, init);
      entry.responseStatus = response.status;
      entry.duration = Date.now() - entry.startTime;
      response.headers.forEach((v, k) => { entry.responseHeaders[k] = v; });

      // Clone to read body without consuming it
      const clone = response.clone();
      clone.text().then(text => {
        entry.responseBody = truncate(text);
        dispatch(entry);
      }).catch(() => { dispatch(entry); });

      return response;
    } catch (err) {
      entry.duration = Date.now() - entry.startTime;
      entry.responseStatus = 0;
      entry.responseBody = 'Network error: ' + err.message;
      dispatch(entry);
      throw err;
    }
  };
})();
`;

  // Inject into page context via a <script> tag
  try {
    const script = document.createElement('script');
    script.textContent = interceptorCode;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
    console.log('[SessionRecorder] Network interceptor injected');
  } catch (err) {
    console.warn('[SessionRecorder] Could not inject network interceptor:', err);
  }

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
