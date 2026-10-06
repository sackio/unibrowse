/**
 * Session Recorder — Content Script
 *
 * Injected (with rrweb-record.min.js) at recording start and re-injected on each navigation.
 * Captures DOM mutations (rrweb), network traffic (XHR/fetch interceptor), user interactions,
 * and page lifecycle. All events are streamed to background.js via chrome.runtime.sendMessage.
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

  // ─── CSS Selector helper ───────────────────────────────────────────────────

  /**
   * Build a short, human-readable CSS selector path for an element.
   * Stops at an ID (since IDs are unique). Filters out hashed class names.
   * Max 5 levels deep to avoid huge selectors.
   */
  function getCSSSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 5) {
      let seg = node.tagName.toLowerCase();
      if (node.id && node.id.length < 60) {
        seg += '#' + node.id;
        parts.unshift(seg);
        break;
      }
      // Only use class names that look like real BEM/utility names, not hashes
      const goodClasses = Array.from(node.classList || [])
        .filter(c => c && c.length < 40 && !/^[a-zA-Z0-9]{16,}$/.test(c))
        .slice(0, 3);
      if (goodClasses.length) seg += '.' + goodClasses.join('.');
      parts.unshift(seg);
      node = node.parentElement;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  /**
   * Get meaningful text label for an element — its own text or placeholder.
   */
  function getElementLabel(el) {
    if (!el) return '';
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text.length > 0 && text.length <= 120) return text;
    return (el.getAttribute('placeholder') || el.getAttribute('aria-label') ||
            el.getAttribute('title') || el.getAttribute('alt') || '').trim().slice(0, 120);
  }

  // ─── Context-snapshot helpers ──────────────────────────────────────────────
  // When the user hovers, clicks, or otherwise interacts, we want to capture
  // *why* the mouse is in that area — the smallest meaningful HTML region
  // around the target. We score candidate ancestors and pick the best one.

  const SEMANTIC_TAGS = new Set([
    'a','button','label','input','textarea','select','li','tr','td','th',
    'article','section','header','footer','nav','aside','dialog','form',
    'figure','fieldset','dt','dd','option','summary','details','menuitem',
  ]);
  const INTERACTIVE_TAGS = new Set(['a','button','input','select','textarea','label']);
  const NEVER_CONTEXT_TAGS = new Set(['html','body','main']);

  /**
   * Score how "interesting" an element is as a context container. Higher = more
   * likely to capture what the user is paying attention to. Looks at semantic
   * tag, interactive descendants, text density, ARIA hints, and bounding rect.
   */
  function scoreCandidate(el) {
    if (!el || el.nodeType !== 1) return -Infinity;
    const tag = el.tagName.toLowerCase();
    if (NEVER_CONTEXT_TAGS.has(tag)) return -Infinity;
    let s = 0;
    if (SEMANTIC_TAGS.has(tag)) s += 30;
    if (INTERACTIVE_TAGS.has(tag)) s += 20;
    if (el.hasAttribute('role')) s += 12;
    if (el.hasAttribute('aria-label')) s += 8;
    if (el.hasAttribute('data-testid') || el.hasAttribute('data-test')) s += 8;
    if (el.id) s += 5;
    const txt = (el.textContent || '').trim();
    // Sweet spot: 30–800 chars of text = readable block. Too sparse or too dense scores lower.
    if (txt.length >= 30 && txt.length <= 800) s += 18;
    else if (txt.length > 800 && txt.length <= 2500) s += 4;
    // Has a few interactive descendants — looks like a card / row / panel
    try {
      const interactives = el.querySelectorAll('a,button,input,select,textarea').length;
      if (interactives >= 1 && interactives <= 8) s += 10;
      else if (interactives > 8) s -= 5; // probably too big
    } catch {}
    // Bounded rect — not a sliver, not the whole viewport
    try {
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth || 1, vh = window.innerHeight || 1;
      if (r.width >= 80 && r.height >= 24 && r.width <= vw * 0.95 && r.height <= vh * 0.85) s += 10;
      if (r.width > vw * 0.98 && r.height > vh * 0.9) s -= 20; // viewport-sized
    } catch {}
    return s;
  }

  /**
   * Walk up from el (max 8 levels), score each candidate, return the highest-
   * scoring ancestor — or the element itself if nothing scores well.
   */
  function findContextContainer(el) {
    if (!el || el.nodeType !== 1) return null;
    let best = el;
    let bestScore = scoreCandidate(el);
    let node = el.parentElement;
    let depth = 0;
    while (node && node !== document.body && depth < 8) {
      const s = scoreCandidate(node);
      if (s > bestScore) { best = node; bestScore = s; }
      node = node.parentElement;
      depth++;
    }
    return best;
  }

  /**
   * Text content of `el` excluding <script>/<style>/<noscript> subtrees — so we
   * don't bleed CSS rules or inline JS into the snapshot. Falls back to
   * textContent if the TreeWalker throws.
   */
  function getCleanText(el) {
    try {
      let out = '';
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          const p = n.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          const tag = p.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let node;
      while ((node = walker.nextNode())) out += node.nodeValue + ' ';
      return out.trim().replace(/\s+/g, ' ');
    } catch {
      return (el.textContent || '').trim().replace(/\s+/g, ' ');
    }
  }

  /**
   * outerHTML of `el` with <script>/<style>/<noscript> blocks stripped. Cheap
   * regex sweep — these tags don't legally contain other tags so the regex is
   * safe for the level of fidelity we need.
   */
  function getCleanHtml(el) {
    let html = '';
    try { html = el.outerHTML || ''; } catch { return ''; }
    return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  }

  /**
   * Snapshot an element to a {selector, tag, text, html, rect} object with
   * adaptive caps. `truncated` flags signal that the raw value was longer.
   */
  function snapshotElement(el, maxText, maxHtml) {
    if (!el || el.nodeType !== 1) return null;
    const text = getCleanText(el);
    const html = getCleanHtml(el);
    let rect = null;
    try {
      const r = el.getBoundingClientRect();
      rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    } catch {}
    return {
      selector: getCSSSelector(el),
      tag: el.tagName.toLowerCase(),
      text: text.slice(0, maxText),
      textTruncated: text.length > maxText,
      html: html.slice(0, maxHtml),
      htmlTruncated: html.length > maxHtml,
      rect,
    };
  }

  /**
   * Capture {target, container} snapshots for an interaction. `target` is the
   * exact element under the cursor (tight cap); `container` is the closest
   * meaningful region around it (looser cap). If they resolve to the same
   * element, only `target` is returned.
   */
  function captureContext(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el === document.body || el === document.documentElement) return null;
    const target = snapshotElement(el, 250, 1200);
    const container = findContextContainer(el);
    if (!container || container === el) return { target };
    return { target, container: snapshotElement(container, 800, 3000) };
  }

  // ─── Page Lifecycle Markers ────────────────────────────────────────────────

  safeSend({
    type: 'SR_PAGE_START',
    url: location.href,
    title: document.title,
    timestamp: Date.now(),
    isFrame: window.parent !== window,
    referrer: document.referrer || null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: screen.width, height: screen.height },
    language: navigator.language || null,
    timezone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } })(),
    userAgent: navigator.userAgent || null,
    performance: (() => {
      try {
        const nav = performance.getEntriesByType('navigation')[0];
        if (!nav) return null;
        return {
          loadTime: Math.round(nav.loadEventEnd),
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
          transferSize: nav.transferSize || 0,
          encodedBodySize: nav.encodedBodySize || 0,
        };
      } catch { return null; }
    })(),
  });

  window.addEventListener('beforeunload', () => {
    safeSend({
      type: 'SR_PAGE_END',
      url: location.href,
      timestamp: Date.now(),
    });
  });

  // ─── rrweb DOM Recording ──────────────────────────────────────────────────

  // ─── Pause/resume, so an unwatched tab costs nothing ──────────────────────
  //
  // Ben, Slack #unibrowse 2026-10-06: "the recording should be sending hardly
  // any data when the UI is not changing or when the tab is idle ... not just be
  // growing in size all the time".
  //
  // ⛔ IT HAS TO BE PAUSE/RESUME, NOT FILTERING. The obvious reading — drop the
  // events emitted while nothing is happening — CORRUPTS THE RECORDING.
  // Incremental events are diffs against a FullSnapshot, so a buffer missing
  // some of them still uploads, still opens in review, and replays BLANK.
  // Stopping and restarting is safe because each restart emits a fresh
  // FullSnapshot, which is a new base for the diff chain.
  //
  // ⚠️ WHAT THIS DOES AND DOES NOT BUY, measured 2026-10-06 — do not oversell it:
  //   · a BACKGROUND tab now records nothing. That is where the size came from:
  //     a 3.69-day eBay capture, mostly unwatched, was 616 MB.
  //   · a VISIBLE page that churns is NOT helped. alpaca.markets emitted ~780
  //     DOM events/min while looking completely static to a human — live
  //     tickers. Those are real changes and still cost.
  const IDLE_MS = 10 * 60 * 1000;
  let rrwebActive = false;
  let idleTimer = null;
  // ⚠️ Declared OUT HERE deliberately. It was `const rrwebOptions` inside the
  // try block while startRrweb() lives in this scope — which parses fine and
  // throws ReferenceError on the first resume, because a function resolves
  // names from where it is DEFINED, not where it is called. `node --check`
  // passes it happily: a syntax check is not a scope check.
  let rrwebOptions = null;

  function startRrweb() {
    if (rrwebActive || typeof rrwebRecord !== 'function') return;
    try {
      rrwebStop = rrwebRecord(rrwebOptions);
      rrwebActive = true;
    } catch (err) {
      console.error('[SessionRecorder] rrweb failed to start:', err);
    }
  }

  function pauseRrweb(why) {
    if (!rrwebActive) return;
    try { if (typeof rrwebStop === 'function') rrwebStop(); } catch (e) { /* already gone */ }
    rrwebActive = false;
    console.log(`[SessionRecorder] paused (${why})`);
  }

  function markActivity() {
    if (!rrwebActive && !document.hidden) startRrweb();
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => pauseRrweb('idle'), IDLE_MS);
  }

  if (typeof rrwebRecord === 'function') {
    try {
      rrwebOptions = {
        emit(event) {
          safeSend({ type: 'SR_RRWEB', event });
        },
        // ⛔ FALSE BY OPERATOR DECISION, TWICE. Ben asked for password fields to
        // be recorded on 2026-05-27 (four suppression gates removed in
        // `ec9bf42`), and reaffirmed it on 2026-10-06 after being shown that it
        // had captured a portal password and a full card entry — number, expiry,
        // CVC — into a store backed up to 62 archives: "no do not mask passwords
        // often times I want you to browse to capture that".
        // ⇒ He wants credentials captured and usable. That is a deliberate,
        // informed choice about his own network, not an oversight.
        // ⛔ DO NOT flip this to true. It was set true on 2026-10-06 and reverted
        // the same hour; a future seat finding a card number here is looking at
        // intended behaviour.
        maskAllInputs: false,
        blockClass: '__unibrowse_blocked__',
        sampling: {
          scroll: 150,
          media: 800,
          input: 'last',
        },
        // ⚠️ LOAD-BEARING for the background's rolling-window trim — do not remove.
        //
        // Auto-capture (ben 2026-08-02) keeps a recording open for as long as a
        // tab is attached, which can be days. The background therefore caps
        // rrwebEvents and drops the oldest. But rrweb incremental events are
        // DIFFS: they replay against the DOM established by a preceding
        // FullSnapshot. Trim to an arbitrary offset and every remaining event
        // references nodes that were never created — the buffer is retained,
        // non-empty, and COMPLETELY UNREPLAYABLE, which looks like a working
        // recording right up until someone opens it.
        //
        // Without this option rrweb emits exactly ONE FullSnapshot, at start —
        // i.e. the only safe cut point is offset 0, so no trim is possible at
        // all. A periodic checkout gives the trimmer a snapshot boundary to cut
        // back to. 2 min is the granularity of what we can discard, so it also
        // sets how far past the cap the buffer can transiently run.
        checkoutEveryNms: 120000,
      };

      startRrweb();
      console.log('[SessionRecorder] rrweb recording started');

      // A hidden tab is the dominant case and the cheapest signal there is.
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) pauseRrweb('tab hidden');
        else markActivity();
      });

      // ⚠️ Interaction, not "visual change". A page can rewrite its DOM
      // continuously while looking static, so visual quiet is not a usable
      // idle signal — but nobody touching the tab for ten minutes is.
      // Passive + capture so a page cannot swallow the signal by stopping
      // propagation on its own handlers.
      for (const evt of ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart']) {
        window.addEventListener(evt, markActivity, { passive: true, capture: true });
      }
      markActivity();
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

  // ─── Interaction Capture ──────────────────────────────────────────────────
  // Rich user interaction events: clicks, input changes, text selections, copies,
  // and special key presses. Sent as SR_INTERACTION messages.

  // Left-click tracking — capture phase so we see all clicks
  document.addEventListener('click', (e) => {
    if (!isContextValid()) return;
    const target = e.target;
    if (!target || target === document.body || target === document.documentElement) return;
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'click',
        timestamp: Date.now(),
        selector: getCSSSelector(target),
        tagName: target.tagName.toLowerCase(),
        id: target.id || null,
        text: getElementLabel(target).slice(0, 120),
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        pageX: Math.round(e.pageX),
        pageY: Math.round(e.pageY),
        context: captureContext(target),
      },
    });
    noteClickedRegion(target);
  }, true);

  // Right-click / context menu tracking
  document.addEventListener('contextmenu', (e) => {
    if (!isContextValid()) return;
    const target = e.target;
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'contextmenu',
        timestamp: Date.now(),
        selector: getCSSSelector(target),
        tagName: target?.tagName?.toLowerCase() || null,
        id: target?.id || null,
        text: getElementLabel(target).slice(0, 120),
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        pageX: Math.round(e.pageX),
        pageY: Math.round(e.pageY),
        context: captureContext(target),
      },
    });
    noteClickedRegion(target);
  }, true);

  // Middle-click (and other non-left button clicks)
  document.addEventListener('auxclick', (e) => {
    if (!isContextValid()) return;
    const target = e.target;
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: e.button === 1 ? 'middle_click' : 'auxclick',
        button: e.button,
        timestamp: Date.now(),
        selector: getCSSSelector(target),
        tagName: target?.tagName?.toLowerCase() || null,
        id: target?.id || null,
        text: getElementLabel(target).slice(0, 120),
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        pageX: Math.round(e.pageX),
        pageY: Math.round(e.pageY),
        context: captureContext(target),
      },
    });
    noteClickedRegion(target);
  }, true);

  // Input change tracking — fires on blur after value changed
  document.addEventListener('change', (e) => {
    if (!isContextValid()) return;
    const target = e.target;
    if (!target) return;
    const tag = target.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return;
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'input_change',
        timestamp: Date.now(),
        selector: getCSSSelector(target),
        tagName: tag,
        inputType: target.type || null,
        name: target.name || null,
        id: target.id || null,
        placeholder: (target.placeholder || '').slice(0, 80),
        value: String(target.value || '').slice(0, 500),
        context: captureContext(target),
      },
    });
  }, true);

  // Select element change (fires immediately on selection change)
  document.addEventListener('input', (e) => {
    if (!isContextValid()) return;
    const target = e.target;
    if (!target || target.tagName.toLowerCase() !== 'select') return;
    const selected = Array.from(target.selectedOptions || []).map(o => o.text).join(', ');
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'select_change',
        timestamp: Date.now(),
        selector: getCSSSelector(target),
        name: target.name || null,
        id: target.id || null,
        value: target.value,
        selectedText: selected.slice(0, 200),
      },
    });
  }, true);

  // Text selection tracking — fires on mouseup if text is selected
  document.addEventListener('mouseup', (e) => {
    if (!isContextValid()) return;
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : '';
    if (text.length < 2) return; // ignore tiny accidental selections
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'selection',
        timestamp: Date.now(),
        text: text.slice(0, 1000),
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
      },
    });
  }, true);

  // Copy tracking
  document.addEventListener('copy', () => {
    if (!isContextValid()) return;
    const text = (window.getSelection() || '').toString().trim();
    if (!text) return;
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'copy',
        timestamp: Date.now(),
        text: text.slice(0, 1000),
      },
    });
  }, true);

  // Cut tracking
  document.addEventListener('cut', () => {
    if (!isContextValid()) return;
    const text = (window.getSelection() || '').toString().trim();
    if (!text) return;
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'cut',
        timestamp: Date.now(),
        text: text.slice(0, 1000),
      },
    });
  }, true);

  // Paste tracking
  document.addEventListener('paste', (e) => {
    if (!isContextValid()) return;
    const target = e.target;
    let text = '';
    try { text = (e.clipboardData || window.clipboardData)?.getData('text') || ''; } catch {}
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'paste',
        timestamp: Date.now(),
        text: text.slice(0, 1000),
        selector: getCSSSelector(target),
        tagName: target?.tagName?.toLowerCase() || null,
        id: target?.id || null,
      },
    });
  }, true);

  // Keyboard tracking — all keypresses including password fields.
  // In text input fields: only special keys (Enter, Escape, etc.) and modifier combos.
  // Outside inputs: all keys.
  document.addEventListener('keydown', (e) => {
    if (!isContextValid()) return;
    const target = e.target;

    const isInputField = ['input', 'textarea'].includes(target?.tagName?.toLowerCase()) || target?.isContentEditable;
    const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
    const isSpecialKey = e.key.length > 1; // 'Enter', 'Escape', 'ArrowUp', 'F5', etc.

    // In input fields: skip bare character keys (input_change captures the result)
    if (isInputField && !isSpecialKey && !hasModifier) return;

    // Skip bare modifier keys themselves
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;

    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'keypress',
        timestamp: Date.now(),
        key: e.key,
        selector: getCSSSelector(target),
        tagName: target?.tagName?.toLowerCase() || null,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      },
    });
  }, true);

  // ─── Dwell-based Hover Capture ───────────────────────────────────────────
  // When the cursor settles on an element for HOVER_DWELL_MS, snapshot the
  // surrounding region (text + html of the best-scoring container) so agents
  // can see what the user was *looking at*, not just what they clicked.
  // Cancels on every mouseover (cursor still moving) and on mouseout.
  // Dedupes: same container within HOVER_DEDUPE_MS is skipped. Also skips
  // hovers that fire right after a click on the same region (clicks already
  // carry the context payload).
  {
    const HOVER_DWELL_MS = 350;
    const HOVER_DEDUPE_MS = 2000;
    const POST_CLICK_SUPPRESS_MS = 600;

    let hoverTimer = null;
    let pendingTarget = null;
    let lastCapturedSelector = null;
    let lastCapturedTs = 0;
    let lastClickedSelector = null;
    let lastClickedTs = 0;

    // Exposed to click handlers so a hover right after a click is suppressed.
    window.__unibrowse_note_click__ = (el) => {
      try {
        const ctx = el && findContextContainer(el);
        lastClickedSelector = ctx ? getCSSSelector(ctx) : null;
        lastClickedTs = Date.now();
      } catch {}
    };

    document.addEventListener('mouseover', (e) => {
      if (!isContextValid()) return;
      const t = e.target;
      if (!t || t.nodeType !== 1) return;
      if (t === document.body || t === document.documentElement) return;
      pendingTarget = t;
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        if (pendingTarget !== t) return; // moved on before dwell elapsed
        const ctx = captureContext(t);
        if (!ctx) return;
        const containerSel = (ctx.container || ctx.target)?.selector || null;
        const now = Date.now();
        // Skip if we just clicked this same region
        if (lastClickedSelector && containerSel === lastClickedSelector &&
            now - lastClickedTs < POST_CLICK_SUPPRESS_MS) return;
        // Dedupe: same container hovered again within HOVER_DEDUPE_MS
        if (containerSel && containerSel === lastCapturedSelector &&
            now - lastCapturedTs < HOVER_DEDUPE_MS) return;
        lastCapturedSelector = containerSel;
        lastCapturedTs = now;
        safeSend({
          type: 'SR_INTERACTION',
          interaction: {
            kind: 'hover',
            timestamp: now,
            selector: ctx.target.selector,
            tagName: ctx.target.tag,
            text: ctx.target.text,
            context: ctx,
          },
        });
      }, HOVER_DWELL_MS);
    }, { passive: true, capture: true });

    document.addEventListener('mouseout', () => {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      pendingTarget = null;
    }, { passive: true, capture: true });
  }
  // Bridge for click handlers above to record the just-clicked region
  function noteClickedRegion(el) {
    try { window.__unibrowse_note_click__ && window.__unibrowse_note_click__(el); } catch {}
  }

  // Mouse movement tracking — throttled to at most one event per 150ms.
  // Stored for timeline overlay; hidden in review by default (opt-in via Mouse filter).
  {
    let lastMove = null;
    let movePending = false;
    document.addEventListener('mousemove', (e) => {
      if (!isContextValid()) return;
      lastMove = { x: Math.round(e.clientX), y: Math.round(e.clientY), pageX: Math.round(e.pageX), pageY: Math.round(e.pageY) };
      if (!movePending) {
        movePending = true;
        setTimeout(() => {
          movePending = false;
          if (lastMove) {
            safeSend({
              type: 'SR_INTERACTION',
              interaction: { kind: 'mousemove', timestamp: Date.now(), ...lastMove },
            });
          }
        }, 150);
      }
    }, { passive: true, capture: true });
  }

  // Scroll tracking — throttled to at most one event per 200ms.
  // Captures scroll position after user scrolls; hidden by default like mousemove.
  {
    let scrollPending = false;
    document.addEventListener('scroll', (e) => {
      if (!isContextValid()) return;
      if (!scrollPending) {
        scrollPending = true;
        setTimeout(() => {
          scrollPending = false;
          const target = e.target === document ? document.documentElement : e.target;
          safeSend({
            type: 'SR_INTERACTION',
            interaction: {
              kind: 'scroll',
              timestamp: Date.now(),
              scrollX: Math.round(window.scrollX),
              scrollY: Math.round(window.scrollY),
              selector: target !== document.documentElement ? getCSSSelector(target) : null,
            },
          });
        }, 200);
      }
    }, { passive: true, capture: true });
  }

  // Form submit tracking
  document.addEventListener('submit', (e) => {
    if (!isContextValid()) return;
    const form = e.target;
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'form_submit',
        timestamp: Date.now(),
        selector: getCSSSelector(form),
        action: form?.action || null,
        method: form?.method || null,
        context: captureContext(form),
      },
    });
  }, true);

  // ─── SPA Navigation ───────────────────────────────────────────────────────
  // Catches history.pushState / replaceState (bridged from MAIN world via CustomEvent)
  // and native popstate / hashchange for hash-router SPAs.

  window.addEventListener('__unibrowse_spa_nav__', (e) => {
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'spa_navigate',
        timestamp: Date.now(),
        navigationType: e.detail.type,
        url: e.detail.url,
        title: e.detail.title || null,
      },
    });
  });

  window.addEventListener('popstate', () => {
    if (!isContextValid()) return;
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'spa_navigate',
        timestamp: Date.now(),
        navigationType: 'popstate',
        url: location.href,
      },
    });
  });

  window.addEventListener('hashchange', (e) => {
    if (!isContextValid()) return;
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'spa_navigate',
        timestamp: Date.now(),
        navigationType: 'hashchange',
        url: e.newURL,
        oldURL: e.oldURL,
      },
    });
  });

  // ─── Page Visibility ──────────────────────────────────────────────────────
  // Fires when user switches tabs or minimises the window.

  document.addEventListener('visibilitychange', () => {
    if (!isContextValid()) return;
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'visibility_change',
        timestamp: Date.now(),
        visible: document.visibilityState === 'visible',
        state: document.visibilityState,
      },
    });
  });

  // ─── JS Errors ────────────────────────────────────────────────────────────

  window.addEventListener('error', (e) => {
    if (!isContextValid()) return;
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'js_error',
        timestamp: Date.now(),
        message: (e.message || 'Unknown error').slice(0, 500),
        source: (e.filename || '').slice(0, 200),
        line: e.lineno || null,
        col: e.colno || null,
      },
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    if (!isContextValid()) return;
    let reason = 'Unhandled rejection';
    try { reason = e.reason?.message || String(e.reason) || reason; } catch {}
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'js_error',
        timestamp: Date.now(),
        message: reason.slice(0, 500),
        source: 'unhandledrejection',
      },
    });
  });

  // ─── Focus Tracking ───────────────────────────────────────────────────────
  // Capture focusin on interactive elements (inputs, buttons, links).
  // Uses focusin (bubbles) rather than focus (does not bubble).

  document.addEventListener('focusin', (e) => {
    if (!isContextValid()) return;
    const target = e.target;
    if (!target) return;
    const tag = target.tagName?.toLowerCase();
    if (!['input', 'textarea', 'select', 'button', 'a'].includes(tag) && !target.isContentEditable) return;
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'focus',
        timestamp: Date.now(),
        selector: getCSSSelector(target),
        tagName: tag,
        id: target.id || null,
        name: target.name || null,
        inputType: target.type || null,
        placeholder: (target.placeholder || '').slice(0, 80),
        context: captureContext(target),
      },
    });
  }, true);

  // ─── Media Events ─────────────────────────────────────────────────────────
  // Captures play/pause/seek/end on <video> and <audio> via event delegation.

  for (const evtName of ['play', 'pause', 'ended', 'seeked']) {
    document.addEventListener(evtName, (e) => {
      if (!isContextValid()) return;
      const target = e.target;
      const tag = target?.tagName?.toLowerCase();
      if (tag !== 'video' && tag !== 'audio') return;
      safeSend({
        type: 'SR_INTERACTION',
        interaction: {
          kind: 'media_' + evtName,
          timestamp: Date.now(),
          selector: getCSSSelector(target),
          tag,
          currentTime: Math.round((target.currentTime || 0) * 100) / 100,
          duration: target.duration || null,
          src: (target.src || target.currentSrc || '').slice(0, 200),
        },
      });
    }, true);
  }

  // ─── Drag & Drop ──────────────────────────────────────────────────────────

  document.addEventListener('dragstart', (e) => {
    if (!isContextValid()) return;
    const target = e.target;
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'drag_start',
        timestamp: Date.now(),
        selector: getCSSSelector(target),
        tagName: target?.tagName?.toLowerCase() || null,
        text: getElementLabel(target).slice(0, 120),
      },
    });
  }, true);

  document.addEventListener('drop', (e) => {
    if (!isContextValid()) return;
    const target = e.target;
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'drop',
        timestamp: Date.now(),
        selector: getCSSSelector(target),
        tagName: target?.tagName?.toLowerCase() || null,
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
      },
    });
  }, true);

  // ─── Dialog Events ────────────────────────────────────────────────────────
  // alert/confirm/prompt are patched in the MAIN world (network-interceptor.js)
  // and bridged here via CustomEvent.

  window.addEventListener('__unibrowse_dialog__', (e) => {
    if (!isContextValid()) return;
    safeSend({
      type: 'SR_INTERACTION',
      interaction: {
        kind: 'dialog',
        timestamp: Date.now(),
        dialogType: e.detail.kind,
        message: e.detail.message,
        result: e.detail.result,
      },
    });
  });

  // ─── DOM Mutation Tracking ────────────────────────────────────────────────
  // Batches significant DOM changes (nodes added/removed, key attribute changes)
  // and sends them as SR_INTERACTION with kind='dom_mutation' every 300ms.
  // Skips invisible/structural nodes (script, style, meta) and noisy attribute
  // changes; focuses on meaningful structural and state changes.
  {
    const SKIP_TAGS = new Set(['script', 'style', 'meta', 'link', 'noscript', 'head']);
    const TRACK_ATTRS = new Set(['class', 'style', 'disabled', 'checked', 'selected',
      'src', 'href', 'aria-expanded', 'aria-hidden', 'aria-selected',
      'open', 'hidden', 'data-state', 'value']);

    let mutationBatch = [];
    let mutationTimer = null;

    function flushMutations() {
      mutationTimer = null;
      if (!mutationBatch.length || !isContextValid()) return;
      const batch = mutationBatch.splice(0);
      safeSend({
        type: 'SR_INTERACTION',
        interaction: {
          kind: 'dom_mutation',
          timestamp: Date.now(),
          mutations: batch,
          count: batch.length,
        },
      });
    }

    const observer = new MutationObserver((mutations) => {
      if (!isContextValid()) return;
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            const tag = node.tagName.toLowerCase();
            // Detect extension injections before skipping structural tags
            if (tag === 'script' || tag === 'link' || tag === 'iframe') {
              const src = node.src || node.href || node.getAttribute?.('src') || '';
              if (/^(chrome|moz)-extension:\/\//.test(src)) {
                mutationBatch.push({ type: 'ext_injection', tag, src: src.slice(0, 300), id: node.id || null });
              }
              continue;
            }
            if (SKIP_TAGS.has(tag)) continue;
            mutationBatch.push({
              type: 'node_added',
              selector: getCSSSelector(node),
              tag,
              id: node.id || null,
              text: getElementLabel(node).slice(0, 80),
            });
          }
          for (const node of m.removedNodes) {
            if (node.nodeType !== 1) continue;
            const tag = node.tagName.toLowerCase();
            if (tag === 'script' || tag === 'link') continue;
            if (SKIP_TAGS.has(tag)) continue;
            mutationBatch.push({
              type: 'node_removed',
              tag,
              id: node.id || null,
              selector: getCSSSelector(node),
            });
          }
        } else if (m.type === 'attributes') {
          const el = m.target;
          if (el.nodeType !== 1) continue;
          const attr = m.attributeName;
          if (!TRACK_ATTRS.has(attr)) continue;
          const newVal = el.getAttribute(attr);
          if (m.oldValue === newVal) continue; // no actual change
          mutationBatch.push({
            type: 'attr_changed',
            selector: getCSSSelector(el),
            tag: el.tagName.toLowerCase(),
            attr,
            oldValue: m.oldValue != null ? m.oldValue.slice(0, 120) : null,
            newValue: newVal != null ? newVal.slice(0, 120) : null,
          });
        }
      }
      if (mutationBatch.length && !mutationTimer) {
        mutationTimer = setTimeout(flushMutations, 300);
      }
    });

    // Observe body for DOM mutations + attribute changes
    const root = document.body || document.documentElement;
    if (root) {
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: [...TRACK_ATTRS],
      });
    }
    // Also observe <head> for extension script/style injections (childList only)
    if (document.head) {
      observer.observe(document.head, { childList: true });
    }
  }

  console.log('[SessionRecorder] Active on', location.href);
}
