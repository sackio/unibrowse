/**
 * Watch — the worker-home engine.
 *
 * Binds watches to real event sources, evaluates the caller's predicate WHERE
 * THE EVENT ALREADY IS, and sends only matches to the server. That last part
 * is layer 1 of flood control and does most of the work for free: a predicate
 * that never matches produces zero WebSocket traffic.
 *
 * Source binding uses one shared listener per underlying source, fanned out to
 * that source's subscribers — the same shape as _navObserverListener in
 * background.js, which already proves the pattern.
 *
 * ⛔ CLASSIC SERVICE-WORKER SCRIPT. background.js has no "type":"module", so
 * this is loaded by importScripts and must not use `export`. It publishes onto
 * globalThis at the bottom, which is also how the unit tests reach it.
 *
 * Depends on createFloodGate from watch-flood.js — importScripts that first.
 */

/**
 * ⛔ THE PREDICATE DOES NOT RUN HERE, AND CANNOT.
 *
 * MV3's extension CSP forbids evaluating a string as JavaScript — `new
 * Function` and `eval` both throw in the service worker. Measured 2026-08-27
 * on the first live arm:
 *
 *   "Evaluating a string as JavaScript violates the following Content Security
 *    Policy directive because 'unsafe-eval' is not an allowed source of script"
 *
 * So the split is:
 *   - PREFILTER  (here)   declarative, no eval, keeps chatty sources off the wire
 *   - PREDICATE  (server) arbitrary JS, evaluated in Node where there is no CSP
 *
 * Page-home watches are the exception: their predicate is injected INTO the
 * document and runs under the PAGE's CSP, not the extension's, so those keep
 * full JS at the source. See watch-page.js.
 */

const STORAGE_KEY = "unibrowse_watches";

/**
 * How each source id binds to a real event stream.
 *
 * `bind(chrome, emit)` registers ONE listener and returns an unbind function.
 * `tabIdOf(args)` extracts the tab a given event belongs to, so a tab-scoped
 * watch can ignore other tabs. Returning null means "not tab-attributable",
 * which a tab-scoped watch treats as a non-match.
 *
 * CDP sources are bound by background.js instead (it already owns the single
 * chrome.debugger.onEvent listener); registerCdpSource below lets it feed
 * them in without this file reaching into the debugger.
 */
const CHROME_BINDINGS = {
  "chrome.webNavigation.onCommitted": {
    bind: (chrome, emit) => {
      const fn = (d) => emit(d);
      chrome.webNavigation.onCommitted.addListener(fn);
      return () => chrome.webNavigation.onCommitted.removeListener(fn);
    },
    tabIdOf: (e) => e?.tabId ?? null,
  },
  "chrome.webNavigation.onCompleted": {
    bind: (chrome, emit) => {
      const fn = (d) => emit(d);
      chrome.webNavigation.onCompleted.addListener(fn);
      return () => chrome.webNavigation.onCompleted.removeListener(fn);
    },
    tabIdOf: (e) => e?.tabId ?? null,
  },
  "chrome.webNavigation.onHistoryStateUpdated": {
    bind: (chrome, emit) => {
      const fn = (d) => emit(d);
      chrome.webNavigation.onHistoryStateUpdated.addListener(fn);
      return () => chrome.webNavigation.onHistoryStateUpdated.removeListener(fn);
    },
    tabIdOf: (e) => e?.tabId ?? null,
  },
  "chrome.webNavigation.onBeforeNavigate": {
    bind: (chrome, emit) => {
      const fn = (d) => emit(d);
      chrome.webNavigation.onBeforeNavigate.addListener(fn);
      return () => chrome.webNavigation.onBeforeNavigate.removeListener(fn);
    },
    tabIdOf: (e) => e?.tabId ?? null,
  },
  "chrome.webNavigation.onDOMContentLoaded": {
    bind: (chrome, emit) => {
      const fn = (d) => emit(d);
      chrome.webNavigation.onDOMContentLoaded.addListener(fn);
      return () => chrome.webNavigation.onDOMContentLoaded.removeListener(fn);
    },
    tabIdOf: (e) => e?.tabId ?? null,
  },
  "chrome.webNavigation.onErrorOccurred": {
    bind: (chrome, emit) => {
      const fn = (d) => emit(d);
      chrome.webNavigation.onErrorOccurred.addListener(fn);
      return () => chrome.webNavigation.onErrorOccurred.removeListener(fn);
    },
    tabIdOf: (e) => e?.tabId ?? null,
  },
  "chrome.webNavigation.onCreatedNavigationTarget": {
    bind: (chrome, emit) => {
      const fn = (d) => emit(d);
      chrome.webNavigation.onCreatedNavigationTarget.addListener(fn);
      return () => chrome.webNavigation.onCreatedNavigationTarget.removeListener(fn);
    },
    tabIdOf: (e) => e?.sourceTabId ?? null,
  },
  "chrome.tabs.onUpdated": {
    bind: (chrome, emit) => {
      const fn = (tabId, changeInfo, tab) => emit({ tabId, changeInfo, tab });
      chrome.tabs.onUpdated.addListener(fn);
      return () => chrome.tabs.onUpdated.removeListener(fn);
    },
    tabIdOf: (e) => e?.tabId ?? null,
  },
  "chrome.tabs.onCreated": {
    bind: (chrome, emit) => {
      const fn = (tab) => emit({ tab });
      chrome.tabs.onCreated.addListener(fn);
      return () => chrome.tabs.onCreated.removeListener(fn);
    },
    tabIdOf: (e) => e?.tab?.id ?? null,
  },
  "chrome.tabs.onRemoved": {
    bind: (chrome, emit) => {
      const fn = (tabId, removeInfo) => emit({ tabId, removeInfo });
      chrome.tabs.onRemoved.addListener(fn);
      return () => chrome.tabs.onRemoved.removeListener(fn);
    },
    tabIdOf: (e) => e?.tabId ?? null,
  },
  "chrome.tabs.onActivated": {
    bind: (chrome, emit) => {
      const fn = (info) => emit(info);
      chrome.tabs.onActivated.addListener(fn);
      return () => chrome.tabs.onActivated.removeListener(fn);
    },
    tabIdOf: (e) => e?.tabId ?? null,
  },
  "chrome.windows.onCreated": {
    bind: (chrome, emit) => {
      const fn = (w) => emit({ window: w });
      chrome.windows.onCreated.addListener(fn);
      return () => chrome.windows.onCreated.removeListener(fn);
    },
    tabIdOf: () => null,
  },
  "chrome.windows.onRemoved": {
    bind: (chrome, emit) => {
      const fn = (windowId) => emit({ windowId });
      chrome.windows.onRemoved.addListener(fn);
      return () => chrome.windows.onRemoved.removeListener(fn);
    },
    tabIdOf: () => null,
  },
  "chrome.windows.onFocusChanged": {
    bind: (chrome, emit) => {
      const fn = (windowId) => emit({ windowId });
      chrome.windows.onFocusChanged.addListener(fn);
      return () => chrome.windows.onFocusChanged.removeListener(fn);
    },
    tabIdOf: () => null,
  },
  "chrome.downloads.onCreated": {
    bind: (chrome, emit) => {
      const fn = (d) => emit(d);
      chrome.downloads.onCreated.addListener(fn);
      return () => chrome.downloads.onCreated.removeListener(fn);
    },
    tabIdOf: () => null,
  },
  "chrome.downloads.onChanged": {
    bind: (chrome, emit) => {
      const fn = (d) => emit(d);
      chrome.downloads.onChanged.addListener(fn);
      return () => chrome.downloads.onChanged.removeListener(fn);
    },
    tabIdOf: () => null,
  },
  "chrome.cookies.onChanged": {
    bind: (chrome, emit) => {
      const fn = (d) => emit(d);
      chrome.cookies.onChanged.addListener(fn);
      return () => chrome.cookies.onChanged.removeListener(fn);
    },
    tabIdOf: () => null,
  },
  "chrome.history.onVisited": {
    bind: (chrome, emit) => {
      const fn = (d) => emit(d);
      chrome.history.onVisited.addListener(fn);
      return () => chrome.history.onVisited.removeListener(fn);
    },
    tabIdOf: () => null,
  },
  "chrome.management.onDisabled": {
    bind: (chrome, emit) => {
      const fn = (d) => emit(d);
      chrome.management.onDisabled.addListener(fn);
      return () => chrome.management.onDisabled.removeListener(fn);
    },
    tabIdOf: () => null,
  },
  "chrome.management.onEnabled": {
    bind: (chrome, emit) => {
      const fn = (d) => emit(d);
      chrome.management.onEnabled.addListener(fn);
      return () => chrome.management.onEnabled.removeListener(fn);
    },
    tabIdOf: () => null,
  },
  "chrome.management.onUninstalled": {
    bind: (chrome, emit) => {
      const fn = (id) => emit({ id });
      chrome.management.onUninstalled.addListener(fn);
      return () => chrome.management.onUninstalled.removeListener(fn);
    },
    tabIdOf: () => null,
  },
  "chrome.storage.onChanged": {
    bind: (chrome, emit) => {
      const fn = (changes, areaName) => emit({ changes, areaName });
      chrome.storage.onChanged.addListener(fn);
      return () => chrome.storage.onChanged.removeListener(fn);
    },
    tabIdOf: () => null,
  },
  "chrome.bookmarks.onCreated": {
    bind: (chrome, emit) => {
      const fn = (id, bookmark) => emit({ id, bookmark });
      chrome.bookmarks.onCreated.addListener(fn);
      return () => chrome.bookmarks.onCreated.removeListener(fn);
    },
    tabIdOf: () => null,
  },
  "chrome.notifications.onClicked": {
    bind: (chrome, emit) => {
      const fn = (notificationId) => emit({ notificationId });
      chrome.notifications.onClicked.addListener(fn);
      return () => chrome.notifications.onClicked.removeListener(fn);
    },
    tabIdOf: () => null,
  },
  "chrome.declarativeNetRequest.onRuleMatchedDebug": {
    bind: (chrome, emit) => {
      const fn = (d) => emit(d);
      chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(fn);
      return () => chrome.declarativeNetRequest.onRuleMatchedDebug.removeListener(fn);
    },
    tabIdOf: (e) => e?.request?.tabId ?? null,
  },
};

/**
 * @param {object} opts
 * @param {object} opts.chrome        the chrome API object (injectable for tests)
 * @param {(msg: object) => void} opts.sendToServer
 * @param {() => number} [opts.now]
 */
function createWatchEngine({ chrome, sendToServer, now = Date.now, injectPageWatch = null }) {
  /** watchId -> {spec, predicate, gate, flushTimer} */
  const watches = new Map();
  /** sourceId -> {unbind, subscribers: Set<watchId>} */
  const bindings = new Map();
  /** sourceId -> event emitters fed externally (CDP, unibrowse's own events) */
  const externalSources = new Set();

  async function persist() {
    const specs = [...watches.values()].map((w) => w.spec);
    try {
      await chrome.storage.session.set({ [STORAGE_KEY]: specs });
    } catch {
      // Persistence is the re-arm optimisation, not the source of truth —
      // the server re-pushes on EXTENSION_REGISTER regardless.
    }
  }

  function deliver(watchId, payload, breakerTripped) {
    const w = watches.get(watchId);
    if (!w) return;
    sendToServer({
      type: "WATCH_FIRED",
      payload: {
        watchId,
        source: w.spec.source,
        tabId: w.spec.tabId ?? null,
        extensionId: w.spec.extensionId,
        firedAt: now(),
        payload,
        ...(breakerTripped ? { breakerTripped } : {}),
      },
    });
  }

  function scheduleFlush(watchId) {
    const w = watches.get(watchId);
    if (!w || !w.spec.options?.coalesce || w.flushTimer) return;
    const windowMs = w.spec.options.coalesce.windowMs;
    w.flushTimer = setTimeout(() => {
      w.flushTimer = null;
      const out = w.gate.flush();
      for (const ev of out) deliver(watchId, ev);
      // Anything arriving during the flush starts a fresh window.
      if (w.gate.state().held > 0) scheduleFlush(watchId);
    }, windowMs);
  }

  function onSourceEvent(sourceId, rawEvent) {
    const binding = bindings.get(sourceId);
    if (!binding) return;
    const tabIdOf = CHROME_BINDINGS[sourceId]?.tabIdOf ?? ((e) => e?.tabId ?? null);

    for (const watchId of [...binding.subscribers]) {
      const w = watches.get(watchId);
      if (!w) continue;

      // Tab scoping. A tab-scoped watch never sees another tab's events.
      if (w.spec.tabId != null && tabIdOf(rawEvent) !== w.spec.tabId) continue;

      // Layer 1: the PREFILTER runs here. A non-match costs one structured
      // comparison and never touches the WebSocket. The caller's JS predicate
      // is applied on the server — see the header note.
      if (!w.prefilter(rawEvent)) continue;

      const res = w.gate.offer(rawEvent);
      if (res.breaker) {
        // ⛔ Announce the death, then actually disarm. A watch that stops
        // silently is indistinguishable from a quiet page.
        deliver(watchId, rawEvent, res.breaker);
        void disarm(watchId);
        continue;
      }
      if (res.action === "deliver") {
        // ⛔ `once` is NOT honoured here any more. A prefilter match is not a
        // predicate match, so disarming now would drop the watch on the first
        // event that merely passed the cheap test. The server disarms us after
        // the real predicate fires.
        deliver(watchId, rawEvent);
      } else if (res.action === "hold") {
        scheduleFlush(watchId);
      }
      // "drop" is silent by design — gate.state().dropped keeps the count.
    }
  }

  function bindSource(sourceId) {
    if (bindings.has(sourceId)) return;
    const def = CHROME_BINDINGS[sourceId];
    if (def) {
      const unbind = def.bind(chrome, (ev) => onSourceEvent(sourceId, ev));
      bindings.set(sourceId, { unbind, subscribers: new Set() });
      return;
    }
    // CDP and unibrowse.* sources are fed by background.js via feed().
    externalSources.add(sourceId);
    bindings.set(sourceId, { unbind: () => {}, subscribers: new Set() });
  }

  function unbindIfIdle(sourceId) {
    const b = bindings.get(sourceId);
    if (!b || b.subscribers.size > 0) return;
    try {
      b.unbind();
    } catch {
      /* best-effort */
    }
    bindings.delete(sourceId);
    externalSources.delete(sourceId);
  }

  /** Is this a page-home source, i.e. one whose predicate needs the DOM? */
  function isPageSource(source) {
    return (
      typeof globalThis.PAGE_BINDINGS === "object" &&
      globalThis.PAGE_BINDINGS !== null &&
      Object.prototype.hasOwnProperty.call(globalThis.PAGE_BINDINGS, source)
    );
  }

  async function injectFor(spec) {
    if (!injectPageWatch) {
      throw new Error(
        `Cannot arm page watch "${spec.source}": no page injector is configured.`,
      );
    }
    const ok = await injectPageWatch(spec);
    if (!ok) {
      throw new Error(
        `Failed to inject the page watch into tab ${spec.tabId}. The watch was NOT armed — ` +
          `a page watch that cannot be injected would report armed and never fire.`,
      );
    }
  }

  async function arm(spec) {
    const page = isPageSource(spec.source);
    const known =
      page ||
      CHROME_BINDINGS[spec.source] ||
      spec.source.startsWith("cdp.") ||
      spec.source.startsWith("unibrowse.");
    if (!known) {
      throw new Error(
        `Cannot arm watch: unknown or unbindable source "${spec.source}"`,
      );
    }
    // There is no browser-wide DOM. A page watch without a tab could only ever
    // be armed against nothing.
    if (page && spec.tabId == null) {
      throw new Error(
        `Source "${spec.source}" observes the page, so it requires a tab. Pass tabTarget.`,
      );
    }

    // Replace rather than duplicate, so a server re-push is idempotent.
    if (watches.has(spec.watchId)) await disarm(spec.watchId, { persist: false });

    // Declarative, eval-free. The JS predicate is applied server-side.
    const prefilter = compilePrefilter(spec.prefilter);
    const gate = globalThis.createFloodGate({
      maxPerMin: spec.options?.maxPerMin,
      coalesce: spec.options?.coalesce,
      now,
    });

    watches.set(spec.watchId, { spec, prefilter, gate, flushTimer: null, page });

    if (page) {
      // The predicate travels into the document and runs there; matches come
      // back through feedMatch. Inject BEFORE claiming armed — a page watch
      // that failed to inject would otherwise report armed and never fire.
      try {
        await injectFor(spec);
      } catch (e) {
        watches.delete(spec.watchId);
        throw e;
      }
      ensurePageReinjection();
    } else {
      bindSource(spec.source);
      bindings.get(spec.source).subscribers.add(spec.watchId);
    }

    await persist();
    return { watchId: spec.watchId, armed: true };
  }

  /**
   * Re-inject page watches when their tab navigates.
   *
   * ⚠️ Not an optimisation. A content script dies with its document, so
   * without this the watch survives in both registries, reports armed, and
   * silently never fires again — the exact fail-quiet this design exists to
   * prevent, reintroduced one layer down.
   */
  let pageReinjectListener = null;
  function ensurePageReinjection() {
    if (pageReinjectListener || !chrome.webNavigation?.onCommitted) return;
    pageReinjectListener = (details) => {
      if (details.frameId !== 0) return; // top frame only; a sub-frame nav does not kill it
      for (const w of watches.values()) {
        if (!w.page || w.spec.tabId !== details.tabId) continue;

        // ⛔ A PAGE WATCH BELONGS TO A DOCUMENT, NOT A TAB.
        //
        // Re-injecting on any navigation attaches the caller's observer to
        // whatever page is now loaded. Measured by shopping-27 (2026-08-27): a
        // watch created against an Amazon order page silently re-attached to a
        // contact-us page and kept firing under the same watchId, still
        // reporting armed:true, with the only clue buried in the payload's
        // `url` field.
        //
        // ⚠️ Compared as a FULL url on purpose. This listener is
        // onCommitted, which does NOT fire for history.pushState — SPA route
        // changes arrive on onHistoryStateUpdated and never reach here — so a
        // strict comparison cannot punish an app that legitimately stays put.
        const want = w.spec.armedAgainstUrl;
        if (want && details.url && details.url !== want) {
          sendToServer({
            type: 'WATCH_DOCUMENT_CHANGED',
            payload: { watchId: w.spec.watchId, was: want, now: details.url },
          });
          void disarm(w.spec.watchId);
          continue;
        }

        void injectFor(w.spec).catch((e) =>
          console.warn(`[Watch] re-inject of ${w.spec.watchId} failed:`, e?.message),
        );
      }
    };
    chrome.webNavigation.onCommitted.addListener(pageReinjectListener);
  }

  /**
   * A page-home watch matched, reported by the injected content script.
   *
   * ⛔ The predicate is NOT re-run here. It already ran in the page, which is
   * the only place its DOM references resolve; re-running it in the worker
   * would throw and be swallowed as "no match", so every page watch would go
   * permanently silent. Flood control, `once` and the breaker still apply.
   */
  function feedMatch(watchId, payload) {
    const w = watches.get(watchId);
    if (!w) return;

    const res = w.gate.offer(payload);
    if (res.breaker) {
      deliver(watchId, payload, res.breaker);
      void disarm(watchId);
      return;
    }
    if (res.action === "deliver") {
      // Page-home watches DID evaluate the real predicate (in the page), so a
      // match here is a true match and `once` is correct to honour.
      deliver(watchId, payload);
      if (w.spec.options?.once) void disarm(watchId);
    } else if (res.action === "hold") {
      scheduleFlush(watchId);
    }
  }

  async function disarm(watchId, { persist: doPersist = true } = {}) {
    const w = watches.get(watchId);
    if (!w) return { watchId, armed: false, existed: false };
    if (w.flushTimer) clearTimeout(w.flushTimer);
    watches.delete(watchId);
    const b = bindings.get(w.spec.source);
    if (b) {
      b.subscribers.delete(watchId);
      unbindIfIdle(w.spec.source);
    }
    if (doPersist) await persist();
    return { watchId, armed: false, existed: true };
  }

  /**
   * ⛔ Reports ACTUAL binding state, not a stored intention. The server asks
   * this and stores the answer verbatim; it must never be a restatement of
   * what the server already believes.
   */
  function list() {
    return [...watches.values()].map((w) => ({
      watchId: w.spec.watchId,
      source: w.spec.source,
      tabId: w.spec.tabId ?? null,
      armed: w.page
        ? true // injected; a failed injection never reaches the map at all
        : bindings.get(w.spec.source)?.subscribers.has(w.spec.watchId) === true,
      ...w.gate.state(),
    }));
  }

  /** Re-arm from the server's authoritative list. Idempotent. */
  async function rearmAll(specs) {
    const wanted = new Set(specs.map((s) => s.watchId));
    for (const id of [...watches.keys()]) {
      if (!wanted.has(id)) await disarm(id, { persist: false });
    }
    for (const s of specs) await arm(s);
    await persist();
    return list();
  }

  /** What survived a service-worker eviction, for a wake-time re-arm. */
  async function persistedSpecs() {
    try {
      const got = await chrome.storage.session.get(STORAGE_KEY);
      const specs = got?.[STORAGE_KEY];
      return Array.isArray(specs) ? specs : [];
    } catch {
      return [];
    }
  }

  /**
   * Feed an event from a source this engine does not bind itself — CDP events
   * (background.js owns the single chrome.debugger.onEvent listener) and
   * unibrowse's own automation events.
   */
  function feed(sourceId, event) {
    onSourceEvent(sourceId, event);
  }

  return { arm, disarm, list, rearmAll, persistedSpecs, feed, feedMatch };
}

// Classic-script publication — see the header note in watch-flood.js.
globalThis.createWatchEngine = createWatchEngine;
