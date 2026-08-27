/**
 * Watch — the page tier (Phase 2).
 *
 * Sources whose events only exist inside the document: DOM mutations, element
 * text, viewport intersection, and arbitrary page events. Their predicates
 * cannot run in the service worker because the worker has no `document`, so
 * the predicate is injected INTO the page and evaluated there. Only matches
 * come back.
 *
 * ⚠️ A page-home watch dies with the document. Re-injection on
 * webNavigation.onCommitted is part of the fail-quiet fix, not an
 * optimisation: without it a watch survives in the registry, reports armed,
 * and never fires again.
 *
 * ⛔ Classic script — loaded via importScripts, no `export`.
 */

/**
 * Page-home source definitions.
 *
 * `config` names the extra arguments a caller supplies (selector, event name).
 * `body` is the in-page observer, written as source text because it is
 * stringified and injected — it cannot close over anything out here.
 */
const PAGE_BINDINGS = {
  "dom.mutation": {
    config: ["selector", "subtree", "attributes", "characterData"],
    body: `
      let obs = null;
      const stopBoot = whenPresent(CONFIG.selector, (target) => {
      obs = new MutationObserver((mutations) => {
        const ev = {
          type: 'mutation',
          count: mutations.length,
          addedNodes: mutations.reduce((n, m) => n + m.addedNodes.length, 0),
          removedNodes: mutations.reduce((n, m) => n + m.removedNodes.length, 0),
          text: target.innerText ? target.innerText.slice(-2000) : '',
          selector: CONFIG.selector || 'body',
          url: location.href,
        };
        if (predicate(ev)) report(ev);
      });
      obs.observe(target, {
        childList: true,
        subtree: CONFIG.subtree !== false,
        attributes: CONFIG.attributes === true,
        characterData: CONFIG.characterData === true,
      });
      });
      cleanup(() => { stopBoot(); if (obs) obs.disconnect(); });
    `,
  },

  "dom.elementText": {
    config: ["selector"],
    body: `
      if (!CONFIG.selector) { report({ error: 'dom.elementText requires config.selector' }); return; }
      let last = null;
      const check = () => {
        const el = document.querySelector(CONFIG.selector);
        const text = el ? (el.innerText || el.textContent || '') : null;
        if (text === last) return;
        const prev = last;
        last = text;
        const ev = { type: 'elementText', selector: CONFIG.selector, text, previous: prev,
                     present: el !== null, url: location.href };
        if (predicate(ev)) report(ev);
      };
      check();
      // MutationObserver rather than an interval: this is a real event source,
      // not a poll. The whole point of the subsystem is to stop polling.
      const obs = new MutationObserver(check);
      obs.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true,
      });
      cleanup(() => obs.disconnect());
    `,
  },

  "dom.intersection": {
    config: ["selector", "threshold"],
    body: `
      if (!CONFIG.selector) { report({ error: 'dom.intersection requires config.selector' }); return; }
      let obs = null;
      const stopBoot = whenPresent(CONFIG.selector, (el) => {
      obs = new IntersectionObserver((entries) => {
        for (const en of entries) {
          const ev = { type: 'intersection', selector: CONFIG.selector,
                       isIntersecting: en.isIntersecting, ratio: en.intersectionRatio,
                       url: location.href };
          if (predicate(ev)) report(ev);
        }
      }, { threshold: CONFIG.threshold != null ? CONFIG.threshold : 0 });
      obs.observe(el);
      });
      cleanup(() => { stopBoot(); if (obs) obs.disconnect(); });
    `,
  },

  "page.event": {
    config: ["eventName", "selector", "capture"],
    body: `
      const name = CONFIG.eventName;
      if (!name) { report({ error: 'page.event requires config.eventName' }); return; }
      const fn = (e) => {
        const ev = { type: 'pageEvent', eventName: name, url: location.href,
                     detail: (() => { try { return JSON.parse(JSON.stringify(e.detail ?? null)); }
                                      catch { return String(e.detail); } })(),
                     targetTag: e.target && e.target.tagName ? e.target.tagName : null,
                     targetId: e.target && e.target.id ? e.target.id : null };
        if (predicate(ev)) report(ev);
      };
      let bound = null;
      const stopBoot = CONFIG.selector
        ? whenPresent(CONFIG.selector, (el) => {
            bound = el;
            el.addEventListener(name, fn, CONFIG.capture === true);
          })
        : (window.addEventListener(name, fn, CONFIG.capture === true), bound = window, () => {});
      cleanup(() => {
        stopBoot();
        if (bound) bound.removeEventListener(name, fn, CONFIG.capture === true);
      });
    `,
  },

  "page.error": {
    config: [],
    body: `
      const onErr = (e) => {
        const ev = { type: 'pageError', message: e.message || String(e.reason || e),
                     filename: e.filename || null, lineno: e.lineno || null, url: location.href };
        if (predicate(ev)) report(ev);
      };
      window.addEventListener('error', onErr);
      window.addEventListener('unhandledrejection', onErr);
      cleanup(() => {
        window.removeEventListener('error', onErr);
        window.removeEventListener('unhandledrejection', onErr);
      });
    `,
  },
};

/**
 * Build the self-contained script injected into the page for one watch.
 *
 * Everything the observer needs is baked in: it cannot import, and it cannot
 * close over anything in the worker. Previous injections for the same watchId
 * are torn down first so a re-injection after navigation — or a double-arm —
 * cannot leave two observers reporting the same event twice.
 */
function buildPageWatchSource({ watchId, source, predicate, config }) {
  const binding = PAGE_BINDINGS[source];
  if (!binding) throw new Error(`Unknown page watch source: ${source}`);

  return `(() => {
  const WATCH_ID = ${JSON.stringify(watchId)};
  const CONFIG = ${JSON.stringify(config || {})};

  // Tear down a previous injection of the SAME watch before installing a new
  // one. Without this, a re-injection after navigation (or a repeated arm)
  // leaves the old observer live and every event is reported twice.
  window.__unibrowseWatches = window.__unibrowseWatches || {};
  if (window.__unibrowseWatches[WATCH_ID]) {
    try { window.__unibrowseWatches[WATCH_ID](); } catch (e) { /* best-effort */ }
    delete window.__unibrowseWatches[WATCH_ID];
  }

  let teardown = () => {};
  const cleanup = (fn) => { teardown = fn; window.__unibrowseWatches[WATCH_ID] = fn; };

  // ⛔ MAIN world — there is no chrome.runtime here. Post to the window and let
  // the ISOLATED-world relay forward it. (ISOLATED would have chrome.runtime
  // but is governed by the EXTENSION's CSP, where the predicate below cannot
  // be compiled at all.)
  const report = (payload) => {
    try {
      window.postMessage({ __unibrowseWatch: true, watchId: WATCH_ID, payload }, '*');
    } catch (e) {
      try { teardown(); } catch (e2) { /* best-effort */ }
    }
  };

  // ⛔ WAIT FOR THE SELECTOR RATHER THAN GIVING UP ON IT.
  //
  // A widget that has not rendered yet — or has just been replaced by a
  // re-auth wall, a route change, or a late hydration — is the NORMAL case,
  // not an error. Bailing at inject time leaves the watch armed and blind,
  // which is the fail-quiet this subsystem exists to remove.
  //
  // whenPresent(sel, cb) calls back immediately if the element is there, and
  // otherwise watches the document until it appears. Returns a disposer.
  // NOTE: no backticks anywhere in this string -- it lives inside a template
  // literal, and one would terminate it. (Cost me a parse error once already.)
  const whenPresent = (sel, cb) => {
    const found = sel ? document.querySelector(sel) : document.body;
    if (found) { cb(found); return () => {}; }
    const boot = new MutationObserver(() => {
      const el = document.querySelector(sel);
      if (!el) return;
      boot.disconnect();
      cb(el);
    });
    boot.observe(document.documentElement, { childList: true, subtree: true });
    return () => boot.disconnect();
  };

  // The caller's predicate, evaluated HERE where the DOM exists. A runtime
  // throw means "no match" — one odd event must not kill the watch.
  const rawPredicate = ${predicate ? `(${predicate})` : "(() => true)"};
  const predicate = (e) => { try { return Boolean(rawPredicate(e)); } catch (err) { return false; } };

  try {
    ${binding.body}
  } catch (err) {
    report({ error: 'watch setup failed: ' + (err && err.message ? err.message : String(err)) });
  }
})();`;
}

globalThis.PAGE_BINDINGS = PAGE_BINDINGS;
globalThis.buildPageWatchSource = buildPageWatchSource;
