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
  // ── Re-injection guard ──────────────────────────────────────────────────
  // ⛔ THIS USED TO BE `window.__unibrowse_network_interceptor__ = true`, an
  // enumerable global with our product name in it. Any page could read it, or
  // find it in a for-in over window, and know exactly what was watching.
  // MEASURED 2026-10-03: eBay signed Ben's office profile out twice in one day
  // under automated use, and `window.fetch.toString()` did not report
  // "[native code]" — so we were visible by at least two independent means.
  // Non-enumerable and innocuously named now: invisible to enumeration, and it
  // does not name us. ⚠️ A fingerprinter who GUESSES the key still finds it;
  // this raises the cost, it does not hide us.
  const GUARD = '__ni_installed__';
  if (Object.getOwnPropertyDescriptor(window, GUARD)) return;
  try {
    Object.defineProperty(window, GUARD, { value: true, enumerable: false, configurable: true });
  } catch (e) {
    window[GUARD] = true;   // sealed window: better installed than not
  }

  // ── Make our wrappers look native ───────────────────────────────────────
  // A monkeypatched builtin is detectable three cheap ways: its `name`, its
  // `toString()`, and enumeration. We fix the first two. This is hygiene any
  // well-behaved wrapper owes its host page — library feature-detection reads
  // `fetch.toString()` to spot polyfills, so a source-revealing wrapper breaks
  // callers as well as announcing us.
  // ⛔ WHAT THIS DOES NOT DO, and nobody should claim otherwise: it does not
  // make the browser undetectable. Attaching the CDP debugger enables Runtime
  // and is independently visible, the bridge still dispatches a CustomEvent
  // under a fixed name, and a dozen other signals remain. Expect fingerprinting
  // to still succeed against a determined site.
  const NATIVE_SRC = new WeakMap();
  const origToString = Function.prototype.toString;
  const patchedToString = function toString() {
    const faked = NATIVE_SRC.get(this);
    return faked !== undefined ? faked : origToString.call(this);
  };
  // The override must hide ITSELF, or `Function.prototype.toString.toString()`
  // gives the whole game away in one call.
  NATIVE_SRC.set(patchedToString, 'function toString() { [native code] }');
  try { Function.prototype.toString = patchedToString; } catch (e) { /* sealed */ }

  function hideWrapper(fn, nativeName) {
    try {
      Object.defineProperty(fn, 'name', { value: nativeName, configurable: true });
    } catch (e) { /* non-configurable name: leave it */ }
    NATIVE_SRC.set(fn, `function ${nativeName}() { [native code] }`);
    return fn;
  }

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
  // ⛔ `window.XMLHttpRequest.name` read "InterceptedXHR" — it named us outright.
  hideWrapper(InterceptedXHR, 'XMLHttpRequest');
  // Carry the constructor's own statics (UNSENT/OPENED/… and anything a page
  // reads off the constructor) so feature detection is unchanged.
  try {
    for (const k of Object.getOwnPropertyNames(OrigXHR)) {
      if (['length', 'name', 'prototype'].includes(k)) continue;
      const d = Object.getOwnPropertyDescriptor(OrigXHR, k);
      if (d) Object.defineProperty(InterceptedXHR, k, d);
    }
  } catch (e) { /* best effort */ }
  window.XMLHttpRequest = InterceptedXHR;

  // ── WebSocket Interceptor ─────────────────────────────────────────────────
  const OrigWS = window.WebSocket;
  if (OrigWS) {
    window.WebSocket = function (url, protocols) {
      const ws = protocols != null ? new OrigWS(url, protocols) : new OrigWS(url);
      const wsUrl = String(url);
      ws.addEventListener('open', () => {
        dispatch({ type: 'ws_open', url: wsUrl, protocol: ws.protocol || null, timestamp: Date.now() });
      });
      ws.addEventListener('message', (e) => {
        let data = '';
        try { data = typeof e.data === 'string' ? e.data.slice(0, 1024) : '[binary]'; } catch {}
        dispatch({ type: 'ws_message', url: wsUrl, direction: 'received', data, timestamp: Date.now() });
      });
      ws.addEventListener('close', (e) => {
        dispatch({ type: 'ws_close', url: wsUrl, code: e.code, reason: (e.reason || '').slice(0, 200), timestamp: Date.now() });
      });
      const origWsSend = ws.send.bind(ws);
      ws.send = function (data) {
        let payload = '';
        try { payload = typeof data === 'string' ? data.slice(0, 1024) : '[binary]'; } catch {}
        dispatch({ type: 'ws_message', url: wsUrl, direction: 'sent', data: payload, timestamp: Date.now() });
        return origWsSend(data);
      };
      return ws;
    };
    // Constants (CONNECTING/OPEN/CLOSING/CLOSED) live on the constructor and
    // pages read them; carry them across or feature detection breaks.
    try {
      for (const k of Object.getOwnPropertyNames(OrigWS)) {
        if (['length', 'name', 'prototype'].includes(k)) continue;
        const d = Object.getOwnPropertyDescriptor(OrigWS, k);
        if (d) Object.defineProperty(window.WebSocket, k, d);
      }
      window.WebSocket.prototype = OrigWS.prototype;
    } catch (e) { /* best effort */ }
    hideWrapper(window.WebSocket, 'WebSocket');
    window.WebSocket.prototype = OrigWS.prototype;
    window.WebSocket.CONNECTING = OrigWS.CONNECTING;
    window.WebSocket.OPEN      = OrigWS.OPEN;
    window.WebSocket.CLOSING   = OrigWS.CLOSING;
    window.WebSocket.CLOSED    = OrigWS.CLOSED;
  }

  // ── History API — SPA navigation ──────────────────────────────────────────
  function dispatchSpaNav(type, url, title) {
    window.dispatchEvent(new CustomEvent('__unibrowse_spa_nav__', {
      detail: { type, url: url ? String(url) : location.href, title: title ? String(title) : '' },
    }));
  }
  const origPushState = history.pushState.bind(history);
  history.pushState = function (state, title, url) {
    origPushState(state, title, url);
    dispatchSpaNav('push', url, title);
  };
  const origReplaceState = history.replaceState.bind(history);
  history.replaceState = function (state, title, url) {
    origReplaceState(state, title, url);
    dispatchSpaNav('replace', url, title);
  };

  // ── Dialog patches (alert / confirm / prompt) ─────────────────────────────
  function dispatchDialog(kind, message, result) {
    window.dispatchEvent(new CustomEvent('__unibrowse_dialog__', {
      detail: { kind, message: String(message || '').slice(0, 500), result },
    }));
  }
  const origAlert = window.alert;
  window.alert = function (msg) {
    dispatchDialog('alert', msg, null);
    return origAlert?.call(window, msg);
  };
  const origConfirm = window.confirm;
  window.confirm = function (msg) {
    const result = origConfirm?.call(window, msg);
    dispatchDialog('confirm', msg, result);
    return result;
  };
  const origPrompt = window.prompt;
  window.prompt = function (msg, def) {
    const result = origPrompt?.call(window, msg, def);
    dispatchDialog('prompt', msg, result !== null ? '[answered]' : '[dismissed]');
    return result;
  };

  // ── Fetch Interceptor ──────────────────────────────────────────────────────
  const origFetch = window.fetch;
  // hideWrapper is applied after the assignment below — see the call that
  // follows the function body.
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
  // ⛔ AFTER the assignment: an anonymous async function has name "" and a
  // source-revealing toString. Both said "this is not the real fetch".
  hideWrapper(window.fetch, 'fetch');
})();
