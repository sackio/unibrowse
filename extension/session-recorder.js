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
      },
    });
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
      },
    });
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
      },
    });
  }, true);

  // Input change tracking — fires on blur after value changed
  document.addEventListener('change', (e) => {
    if (!isContextValid()) return;
    const target = e.target;
    if (!target) return;
    const tag = target.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return;
    const isPassword = target.type === 'password';
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
        value: isPassword ? '[password]' : (String(target.value || '')).slice(0, 500),
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
    if (target?.type === 'password') return;
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

  // Keyboard tracking — all non-password keypresses.
  // In text input fields: only special keys (Enter, Escape, etc.) and modifier combos.
  // Outside inputs: all keys.
  document.addEventListener('keydown', (e) => {
    if (!isContextValid()) return;
    const target = e.target;

    // Never capture password fields
    if (target?.type === 'password') return;

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
    if (target.type === 'password') return;
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
