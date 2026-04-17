/**
 * Network Interceptor — Page Context (MAIN world)
 *
 * Injected by background.js via chrome.scripting.executeScript({ world: 'MAIN' }).
 * Runs in the page's own JS context so it can wrap XHR and fetch.
 * Bridges captured entries to the content script via CustomEvent.
 *
 * CSP note: extension scripts injected with world:'MAIN' bypass page CSP — no unsafe-inline needed.
 */
(function () {
  if (window.__unibrowse_network_interceptor__) return;
  window.__unibrowse_network_interceptor__ = true;

  const MAX_BODY = 50 * 1024; // 50 KB cap on response bodies

  function truncate(str) {
    if (typeof str !== 'string') str = String(str || '');
    return str.length > MAX_BODY ? str.slice(0, MAX_BODY) + '…[truncated]' : str;
  }

  function dispatch(entry) {
    window.dispatchEvent(new CustomEvent('__unibrowse_network__', { detail: entry }));
  }

  // ── XHR Interceptor ────────────────────────────────────────────────────────
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
    xhr.open = function (method, url, ...args) {
      entry.method = method;
      entry.url = url;
      return origOpen(method, url, ...args);
    };

    const origSetRequestHeader = xhr.setRequestHeader.bind(xhr);
    xhr.setRequestHeader = function (name, value) {
      entry.requestHeaders[name] = value;
      return origSetRequestHeader(name, value);
    };

    const origSend = xhr.send.bind(xhr);
    xhr.send = function (body) {
      entry.startTime = Date.now();
      if (body) {
        try { entry.requestBody = typeof body === 'string' ? body : JSON.stringify(body); }
        catch (e) { entry.requestBody = String(body); }
      }
      xhr.addEventListener('loadend', function () {
        entry.responseStatus = xhr.status;
        entry.duration = Date.now() - entry.startTime;
        const rawHeaders = xhr.getAllResponseHeaders();
        rawHeaders.trim().split(/\r?\n/).forEach(line => {
          const [key, ...rest] = line.split(':');
          if (key) entry.responseHeaders[key.trim()] = rest.join(':').trim();
        });
        try { entry.responseBody = truncate(xhr.responseText); }
        catch (e) { entry.responseBody = null; }
        dispatch(entry);
      });
      return origSend(body);
    };

    return xhr;
  }
  InterceptedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = InterceptedXHR;

  // ── Fetch Interceptor ──────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (input, init = {}) {
    const entry = {
      id: Math.random().toString(36).slice(2),
      startTime: Date.now(),
      url: typeof input === 'string' ? input : (input?.url || String(input)),
      method: ((init.method || 'GET')).toUpperCase(),
      requestHeaders: {},
      requestBody: null,
      responseStatus: null,
      responseHeaders: {},
      responseBody: null,
      duration: null,
    };

    if (init.headers) {
      const headers = new Headers(init.headers);
      headers.forEach((v, k) => { entry.requestHeaders[k] = v; });
    }
    if (init.body) {
      try { entry.requestBody = typeof init.body === 'string' ? init.body : JSON.stringify(init.body); }
      catch (e) { entry.requestBody = String(init.body); }
    }

    try {
      const response = await origFetch(input, init);
      entry.responseStatus = response.status;
      entry.duration = Date.now() - entry.startTime;
      response.headers.forEach((v, k) => { entry.responseHeaders[k] = v; });

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
