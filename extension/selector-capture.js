/**
 * Selector Capture Overlay
 *
 * Injected into the page during a user recording to let the user:
 *   1. Drag a rectangle over a page region
 *   2. Pick a detected element from the results panel
 *   3. Name it and add it as a selector_capture step to the recording
 */

// Guard: only one instance at a time
if (window.mcpSelectorCaptureActive) {
  // Already active — do nothing
} else {

class SelectorCaptureOverlay {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.detectedElements = []; // [{el, selectors, bestSelector}]
    this.selectedIndex = -1;
    this.highlightedEls = [];
    this.originalOutlines = new WeakMap();
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.isDragging = false;
    this.dragRect = null; // {x, y, width, height}

    this._boundMouseDown = this._onDragStart.bind(this);
    this._boundMouseMove = this._onDragMove.bind(this);
    this._boundMouseUp = this._onDragEnd.bind(this);
    this._boundKeyDown = this._setupKeyHandler.bind(this);

    this._create();
    this._setupDragListeners();
    document.addEventListener('keydown', this._boundKeyDown, true);
  }

  // ─── DOM Construction ────────────────────────────────────────────────────

  _create() {
    this.host = document.createElement('div');
    this.host.id = 'mcp-selector-capture-container';
    this.host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;';

    const shadow = this.host.attachShadow({ mode: 'closed' });
    this._shadow = shadow;

    shadow.innerHTML = `
      <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .sc-drag-layer {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          cursor: crosshair;
          background: rgba(0,0,0,0.18);
          z-index: 1;
          pointer-events: all;
          user-select: none;
        }

        .sc-drag-rect {
          position: absolute;
          border: 2px dashed #3b82f6;
          background: rgba(59,130,246,0.08);
          display: none;
          pointer-events: none;
        }

        .sc-drag-rect.error {
          border-color: #ef4444;
          background: rgba(239,68,68,0.08);
        }

        .sc-panel {
          position: fixed;
          right: 0;
          top: 0;
          width: 380px;
          height: 100vh;
          overflow-y: auto;
          background: #fff;
          box-shadow: -4px 0 20px rgba(0,0,0,0.15);
          z-index: 2;
          display: none;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 14px;
          color: #1e293b;
        }

        .sc-panel-header {
          position: sticky;
          top: 0;
          z-index: 10;
          background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%);
          color: white;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        }

        .sc-panel-title { font-weight: 600; font-size: 15px; }

        .sc-btn-close {
          background: rgba(255,255,255,0.15);
          border: 1px solid rgba(255,255,255,0.3);
          color: white;
          cursor: pointer;
          width: 28px; height: 28px;
          border-radius: 50%;
          font-size: 16px;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.15s;
        }
        .sc-btn-close:hover { background: rgba(255,255,255,0.28); }

        .sc-instructions {
          padding: 14px 16px;
          color: #64748b;
          font-size: 13px;
          line-height: 1.6;
          border-bottom: 1px solid #f1f5f9;
        }

        .sc-hint {
          margin: 8px 16px;
          padding: 8px 10px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 5px;
          color: #dc2626;
          font-size: 12px;
          display: none;
        }

        .sc-elements-list {
          border-bottom: 1px solid #e2e8f0;
        }

        .sc-el-row {
          padding: 8px 14px;
          cursor: pointer;
          border-bottom: 1px solid #f1f5f9;
          transition: background 0.1s;
          display: flex;
          align-items: flex-start;
          gap: 8px;
        }

        .sc-el-row:hover { background: #f0fdfa; }
        .sc-el-row.selected { background: #ccfbf1; }

        .sc-el-tag {
          display: inline-block;
          background: #f1f5f9;
          color: #0f766e;
          padding: 1px 6px;
          border-radius: 3px;
          font-family: monospace;
          font-size: 11px;
          font-weight: 600;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .sc-el-info { flex: 1; min-width: 0; }
        .sc-el-sel {
          font-family: monospace;
          font-size: 11px;
          color: #475569;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sc-el-text { font-size: 12px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .sc-empty-state {
          padding: 24px 16px;
          text-align: center;
          color: #94a3b8;
          font-size: 13px;
        }

        .sc-empty-state p { margin-bottom: 10px; }

        .sc-btn-retry {
          background: #0d9488;
          color: white;
          border: none;
          padding: 7px 16px;
          border-radius: 5px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
        }
        .sc-btn-retry:hover { background: #0f766e; }

        .sc-selector-section {
          padding: 12px 16px;
          border-bottom: 1px solid #e2e8f0;
          display: none;
        }

        .sc-field-label {
          font-size: 11px;
          font-weight: 600;
          color: #0f766e;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          margin-bottom: 5px;
          display: block;
        }

        .sc-selector-input {
          width: 100%;
          padding: 6px 10px;
          border: 1px solid #99f6e4;
          border-radius: 4px;
          font-family: monospace;
          font-size: 12px;
          background: white;
          color: #1e293b;
          transition: border-color 0.15s;
          word-break: break-all;
        }
        .sc-selector-input:focus { outline: none; border-color: #0d9488; }
        .sc-selector-input.valid { border-color: #0d9488; }
        .sc-selector-input.invalid { border-color: #ef4444; }

        .sc-match-count {
          font-size: 11px;
          color: #64748b;
          margin-top: 5px;
          min-height: 16px;
        }

        .sc-options-toggle {
          font-size: 12px;
          color: #0d9488;
          cursor: pointer;
          padding: 6px 0 2px;
          user-select: none;
          font-weight: 500;
          display: block;
        }
        .sc-options-toggle:hover { text-decoration: underline; }

        .sc-options-list {
          margin-top: 6px;
          border: 1px solid #99f6e4;
          border-radius: 4px;
          overflow: hidden;
        }
        .sc-options-list.hidden { display: none; }

        .sc-option-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 5px 8px;
          font-size: 12px;
          cursor: pointer;
          border-bottom: 1px solid #e6fffa;
          transition: background 0.1s;
        }
        .sc-option-row:last-child { border-bottom: none; }
        .sc-option-row:hover { background: #e6fffa; }

        .sc-opt-strategy {
          min-width: 70px;
          font-weight: 600;
          font-size: 10px;
          color: #0f766e;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          flex-shrink: 0;
        }
        .sc-opt-selector { flex: 1; font-family: monospace; font-size: 11px; color: #1e293b; word-break: break-all; }
        .sc-opt-count { font-size: 10px; color: #64748b; white-space: nowrap; }

        .sc-name-section {
          padding: 12px 16px;
          border-bottom: 1px solid #e2e8f0;
          display: none;
        }

        .sc-name-input, .sc-desc-input {
          width: 100%;
          padding: 6px 10px;
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          font-size: 13px;
          font-family: inherit;
          transition: border-color 0.15s;
          margin-bottom: 10px;
        }
        .sc-name-input:focus, .sc-desc-input:focus { outline: none; border-color: #0d9488; }
        .sc-desc-input { resize: vertical; min-height: 52px; }

        .sc-actions {
          padding: 12px 16px;
          display: none;
          gap: 10px;
          flex-direction: row;
          position: sticky;
          bottom: 0;
          background: white;
          border-top: 1px solid #e2e8f0;
          box-shadow: 0 -2px 8px rgba(0,0,0,0.06);
        }

        .sc-btn-cancel {
          flex: 1;
          padding: 9px;
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          color: #64748b;
          transition: all 0.15s;
        }
        .sc-btn-cancel:hover { background: #e2e8f0; }

        .sc-btn-add {
          flex: 2;
          padding: 9px;
          background: #0d9488;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          color: white;
          transition: all 0.15s;
        }
        .sc-btn-add:hover:not(:disabled) { background: #0f766e; }
        .sc-btn-add:disabled { opacity: 0.45; cursor: not-allowed; }
      </style>

      <div class="sc-drag-layer">
        <div class="sc-drag-rect"></div>
      </div>

      <div class="sc-panel">
        <div class="sc-panel-header">
          <span class="sc-panel-title">🎯 Selector Capture</span>
          <button class="sc-btn-close" title="Cancel (Escape)">×</button>
        </div>
        <div class="sc-instructions">
          Draw a box over a page region to detect elements. Click an element, name it, and add it to the recording.
        </div>
        <div class="sc-hint"></div>
        <div class="sc-elements-list"></div>

        <div class="sc-selector-section">
          <label class="sc-field-label">CSS Selector</label>
          <input class="sc-selector-input" type="text" spellcheck="false" />
          <div class="sc-match-count"></div>
          <span class="sc-options-toggle hidden">▸ 0 selector options</span>
          <div class="sc-options-list hidden"></div>
        </div>

        <div class="sc-name-section">
          <label class="sc-field-label">Data Point Name *</label>
          <input class="sc-name-input" type="text" placeholder="e.g. product_price" />
          <label class="sc-field-label">Description</label>
          <textarea class="sc-desc-input" placeholder="Optional: what does this selector capture?"></textarea>
        </div>

        <div class="sc-actions">
          <button class="sc-btn-cancel">Cancel</button>
          <button class="sc-btn-add" disabled>Add to Recording</button>
        </div>
      </div>
    `;

    // Wire up panel events
    this._shadow.querySelector('.sc-btn-close').addEventListener('click', () => this.cancel());
    this._shadow.querySelector('.sc-btn-cancel').addEventListener('click', () => this.cancel());
    this._shadow.querySelector('.sc-btn-add').addEventListener('click', () => this._onAddToRecording());

    const selectorInput = this._shadow.querySelector('.sc-selector-input');
    selectorInput.addEventListener('input', this._debounce((e) => this._testCustomSelector(e.target.value), 300));

    const nameInput = this._shadow.querySelector('.sc-name-input');
    nameInput.addEventListener('input', () => this._onNameInput());

    const optionsToggle = this._shadow.querySelector('.sc-options-toggle');
    optionsToggle.addEventListener('click', () => {
      const list = this._shadow.querySelector('.sc-options-list');
      const isHidden = list.classList.contains('hidden');
      list.classList.toggle('hidden', !isHidden);
      optionsToggle.textContent = (isHidden ? '▾ ' : '▸ ') + optionsToggle.textContent.slice(2);
    });

    document.body.appendChild(this.host);

    // Show panel immediately (instructions visible)
    const panel = this._shadow.querySelector('.sc-panel');
    panel.style.display = 'block';
  }

  // ─── Drag Listeners ───────────────────────────────────────────────────────

  _setupDragListeners() {
    const layer = this._shadow.querySelector('.sc-drag-layer');
    layer.addEventListener('mousedown', this._boundMouseDown);
    // mousemove / mouseup on document so they work outside the shadow
    document.addEventListener('mousemove', this._boundMouseMove, true);
    document.addEventListener('mouseup', this._boundMouseUp, true);
  }

  _setupKeyHandler(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
    }
  }

  _onDragStart(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;

    const rect = this._shadow.querySelector('.sc-drag-rect');
    rect.style.left = e.clientX + 'px';
    rect.style.top = e.clientY + 'px';
    rect.style.width = '0px';
    rect.style.height = '0px';
    rect.style.display = 'block';
    rect.classList.remove('error');
  }

  _onDragMove(e) {
    if (!this.isDragging) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = this._shadow.querySelector('.sc-drag-rect');
    const x = Math.min(e.clientX, this.dragStartX);
    const y = Math.min(e.clientY, this.dragStartY);
    const w = Math.abs(e.clientX - this.dragStartX);
    const h = Math.abs(e.clientY - this.dragStartY);

    rect.style.left = x + 'px';
    rect.style.top = y + 'px';
    rect.style.width = w + 'px';
    rect.style.height = h + 'px';
  }

  _onDragEnd(e) {
    if (!this.isDragging) return;
    e.preventDefault();
    e.stopPropagation();
    this.isDragging = false;

    const dragRectEl = this._shadow.querySelector('.sc-drag-rect');
    dragRectEl.style.display = 'none';

    const r = this._getDragRect(e);

    if (r.width < 10 || r.height < 10) {
      this._showHint('Drag a larger area to detect elements.', 'error');
      return;
    }

    this.dragRect = r;
    this._hideHint();
    const elements = this._detectElementsInRegion(r);

    if (elements.length === 0) {
      this._renderEmptyState();
    } else {
      this.detectedElements = elements;
      this._renderElementList();
    }
  }

  _getDragRect(e) {
    const endX = e ? e.clientX : this.dragStartX;
    const endY = e ? e.clientY : this.dragStartY;
    return {
      x: Math.min(endX, this.dragStartX),
      y: Math.min(endY, this.dragStartY),
      width: Math.abs(endX - this.dragStartX),
      height: Math.abs(endY - this.dragStartY),
    };
  }

  // ─── Element Detection ────────────────────────────────────────────────────

  _detectElementsInRegion(rect) {
    const step = 8;
    const seen = new Set();
    const results = [];

    for (let sx = rect.x + 4; sx < rect.x + rect.width; sx += step) {
      for (let sy = rect.y + 4; sy < rect.y + rect.height; sy += step) {
        const els = document.elementsFromPoint(sx, sy);
        for (const el of els) {
          if (seen.has(el)) continue;
          seen.add(el);
          if (!this._isRelevantElement(el)) continue;
          const selectors = this._generateSelectorStrategies(el);
          if (selectors.length === 0) continue;
          const bestSelector = selectors[0].selector;
          const bb = el.getBoundingClientRect();
          results.push({ el, selectors, bestSelector, bb });
        }
      }
    }

    // Sort by bounding-box area ascending (smallest = most leaf-level), cap at 25
    results.sort((a, b) => {
      const areaA = a.bb.width * a.bb.height;
      const areaB = b.bb.width * b.bb.height;
      return areaA - areaB;
    });

    return results.slice(0, 25);
  }

  _isRelevantElement(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (['script', 'style', 'meta', 'html', 'body', 'head', 'link', 'noscript'].includes(tag)) return false;
    // Skip the capture overlay itself
    if (el.closest && el.closest('#mcp-selector-capture-container')) return false;
    if (el === this.host) return false;
    // Minimum size
    const bb = el.getBoundingClientRect();
    if (bb.width < 5 || bb.height < 5) return false;
    return true;
  }

  // ─── Selector Strategy Generation ─────────────────────────────────────────

  _generateSelectorStrategies(el) {
    const strategies = [];
    const tag = el.tagName ? el.tagName.toLowerCase() : '*';

    const tryAdd = (strategy, selector) => {
      const count = this._countMatches(selector);
      if (count >= 0) strategies.push({ strategy, selector, count });
    };

    // 1. ID
    if (el.id && el.id.trim()) {
      tryAdd('id', '#' + CSS.escape(el.id));
    }

    // 2. data-testid
    const dtid = el.getAttribute('data-testid');
    if (dtid) {
      tryAdd('data-testid', `[data-testid="${dtid.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`);
    }

    // 3. data-test
    const dt = el.getAttribute('data-test');
    if (dt) {
      tryAdd('data-test', `[data-test="${dt.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`);
    }

    // 4. aria-label
    const aria = el.getAttribute('aria-label');
    if (aria) {
      tryAdd('aria-label', `[aria-label="${aria.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`);
    }

    // 5. name
    const name = el.getAttribute('name');
    if (name) {
      tryAdd('name', `[name="${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`);
    }

    // 6. class (first 3 non-empty classes)
    if (el.classList && el.classList.length > 0) {
      const classes = Array.from(el.classList).filter(c => c.trim()).slice(0, 3);
      if (classes.length > 0) {
        tryAdd('class', `${tag}.${classes.map(c => CSS.escape(c)).join('.')}`);
      }
    }

    // 7. Full path (always last, always unique)
    const path = this._generateFullPath(el);
    tryAdd('path', path);

    // Sort: count=1 first, then ascending; remove invalid (-1)
    strategies.sort((a, b) => {
      if (a.count === 1 && b.count !== 1) return -1;
      if (b.count === 1 && a.count !== 1) return 1;
      return a.count - b.count;
    });

    return strategies;
  }

  _generateFullPath(el) {
    const parts = [];
    let current = el;
    while (current && current !== document.documentElement) {
      const tag = current.tagName ? current.tagName.toLowerCase() : '*';
      if (current.id && current.id.trim()) {
        parts.unshift('#' + CSS.escape(current.id));
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          parts.unshift(`${tag}:nth-of-type(${idx})`);
        } else {
          parts.unshift(tag);
        }
      } else {
        parts.unshift(tag);
      }
      current = parent;
    }
    return parts.join(' > ');
  }

  _countMatches(selector) {
    try {
      return document.querySelectorAll(selector).length;
    } catch (e) {
      return -1;
    }
  }

  // ─── Panel Rendering ──────────────────────────────────────────────────────

  _renderElementList() {
    const list = this._shadow.querySelector('.sc-elements-list');
    list.innerHTML = '';

    this.detectedElements.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'sc-el-row';
      row.dataset.index = i;

      const tag = item.el.tagName ? item.el.tagName.toLowerCase() : '?';
      const text = (item.el.textContent || '').trim().substring(0, 50);

      row.innerHTML = `
        <span class="sc-el-tag">${tag}</span>
        <div class="sc-el-info">
          <div class="sc-el-sel">${this._esc(item.bestSelector)}</div>
          ${text ? `<div class="sc-el-text">${this._esc(text)}</div>` : ''}
        </div>
      `;

      row.addEventListener('click', () => this._selectElement(i));
      list.appendChild(row);
    });

    // Show selector/name/actions sections
    this._shadow.querySelector('.sc-selector-section').style.display = 'block';
    this._shadow.querySelector('.sc-name-section').style.display = 'block';
    this._shadow.querySelector('.sc-actions').style.display = 'flex';
  }

  _renderEmptyState() {
    const list = this._shadow.querySelector('.sc-elements-list');
    list.innerHTML = `
      <div class="sc-empty-state">
        <p>No elements found in that region.</p>
        <button class="sc-btn-retry">Try Again</button>
      </div>
    `;
    list.querySelector('.sc-btn-retry').addEventListener('click', () => {
      list.innerHTML = '';
      this._shadow.querySelector('.sc-selector-section').style.display = 'none';
      this._shadow.querySelector('.sc-name-section').style.display = 'none';
      this._shadow.querySelector('.sc-actions').style.display = 'none';
      this._showHint('Draw a larger area.', 'info');
    });
  }

  _selectElement(index) {
    this.selectedIndex = index;
    this._clearHighlights();

    // Highlight selected row
    this._shadow.querySelectorAll('.sc-el-row').forEach((r, i) => {
      r.classList.toggle('selected', i === index);
    });

    const item = this.detectedElements[index];
    const bestSel = item.bestSelector;

    // Update selector input
    const input = this._shadow.querySelector('.sc-selector-input');
    input.value = bestSel;
    input.classList.remove('invalid');
    input.classList.add('valid');

    // Highlight page matches
    const count = this._highlightMatches(bestSel);

    // Match count
    this._shadow.querySelector('.sc-match-count').textContent =
      count >= 0 ? `${count} match${count !== 1 ? 'es' : ''} on page` : '⚠ Invalid selector';

    // Render options
    this._renderOptionsList(index);

    // Focus name input
    const nameInput = this._shadow.querySelector('.sc-name-input');
    nameInput.focus();
  }

  _renderOptionsList(index) {
    const item = this.detectedElements[index];
    const strategies = item.selectors;

    const toggle = this._shadow.querySelector('.sc-options-toggle');
    const list = this._shadow.querySelector('.sc-options-list');

    if (strategies.length <= 1) {
      toggle.classList.add('hidden');
      list.innerHTML = '';
      return;
    }

    toggle.classList.remove('hidden');
    toggle.textContent = `▸ ${strategies.length} selector options`;
    list.classList.add('hidden');
    list.innerHTML = '';

    strategies.forEach(opt => {
      const row = document.createElement('div');
      row.className = 'sc-option-row';
      row.innerHTML = `
        <span class="sc-opt-strategy">${this._esc(opt.strategy)}</span>
        <span class="sc-opt-selector">${this._esc(opt.selector)}</span>
        <span class="sc-opt-count">${opt.count >= 0 ? opt.count + ' match' + (opt.count !== 1 ? 'es' : '') : '—'}</span>
      `;
      row.addEventListener('click', () => {
        const selectorInput = this._shadow.querySelector('.sc-selector-input');
        selectorInput.value = opt.selector;
        if (this.selectedIndex >= 0) {
          this.detectedElements[this.selectedIndex].bestSelector = opt.selector;
        }
        this._testCustomSelector(opt.selector);
      });
      list.appendChild(row);
    });
  }

  // ─── Highlight Mechanism ──────────────────────────────────────────────────

  _highlightMatches(selector) {
    this._clearHighlights();
    let matches;
    try {
      matches = Array.from(document.querySelectorAll(selector));
    } catch (e) {
      return -1;
    }
    matches.forEach(el => {
      this.originalOutlines.set(el, {
        outline: el.style.outline,
        outlineOffset: el.style.outlineOffset
      });
      el.style.outline = '2px solid #0d9488';
      el.style.outlineOffset = '2px';
      this.highlightedEls.push(el);
    });
    return matches.length;
  }

  _clearHighlights() {
    this.highlightedEls.forEach(el => {
      const saved = this.originalOutlines.get(el);
      if (saved) {
        el.style.outline = saved.outline;
        el.style.outlineOffset = saved.outlineOffset;
      }
    });
    this.highlightedEls = [];
  }

  // ─── Selector Input Handling ──────────────────────────────────────────────

  _testCustomSelector(sel) {
    const input = this._shadow.querySelector('.sc-selector-input');
    const countEl = this._shadow.querySelector('.sc-match-count');
    const count = this._highlightMatches(sel);

    if (count < 0) {
      input.classList.add('invalid');
      input.classList.remove('valid');
      countEl.textContent = '⚠ Invalid selector';
    } else {
      input.classList.remove('invalid');
      input.classList.add('valid');
      countEl.textContent = `${count} match${count !== 1 ? 'es' : ''} on page`;
    }

    // Update stored bestSelector for selected element
    if (this.selectedIndex >= 0 && count >= 0) {
      this.detectedElements[this.selectedIndex].bestSelector = sel;
    }
  }

  _onNameInput() {
    const name = this._shadow.querySelector('.sc-name-input').value.trim();
    this._shadow.querySelector('.sc-btn-add').disabled = !name;
  }

  // ─── Add to Recording ─────────────────────────────────────────────────────

  _onAddToRecording() {
    const nameInput = this._shadow.querySelector('.sc-name-input');
    const name = nameInput.value.trim();
    if (!name) return;

    const selector = this._shadow.querySelector('.sc-selector-input').value.trim();
    const description = this._shadow.querySelector('.sc-desc-input').value.trim();

    let matchCount = 0;
    try { matchCount = document.querySelectorAll(selector).length; } catch (e) { matchCount = 0; }

    const item = this.selectedIndex >= 0 ? this.detectedElements[this.selectedIndex] : null;
    const selectorOptions = item ? item.selectors : [];

    const previewElements = this.detectedElements.slice(0, 5).map(d => ({
      tagName: d.el.tagName || '',
      text: (d.el.textContent || '').trim().substring(0, 80)
    }));

    const capture = {
      name,
      description,
      selector,
      matchCount,
      selectorOptions,
      elements: previewElements,
      region: this.dragRect,
      timestamp: Date.now(),
      url: window.location.href
    };

    chrome.runtime.sendMessage({
      type: 'SELECTOR_CAPTURE_COMPLETE',
      sessionId: this.sessionId,
      capture
    });

    this.destroy();
  }

  cancel() {
    chrome.runtime.sendMessage({
      type: 'SELECTOR_CAPTURE_CANCELLED',
      sessionId: this.sessionId
    });
    this.destroy();
  }

  destroy() {
    this._clearHighlights();
    document.removeEventListener('mousemove', this._boundMouseMove, true);
    document.removeEventListener('mouseup', this._boundMouseUp, true);
    document.removeEventListener('keydown', this._boundKeyDown, true);
    if (this.host && this.host.parentNode) {
      this.host.parentNode.removeChild(this.host);
    }
    window.mcpSelectorCaptureActive = false;
    window.mcpSelectorCaptureInstance = null;
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  _showHint(msg, type) {
    const hint = this._shadow.querySelector('.sc-hint');
    hint.textContent = msg;
    hint.style.display = 'block';
    hint.style.background = type === 'error' ? '#fef2f2' : '#f0fdfa';
    hint.style.borderColor = type === 'error' ? '#fecaca' : '#99f6e4';
    hint.style.color = type === 'error' ? '#dc2626' : '#0f766e';
  }

  _hideHint() {
    const hint = this._shadow.querySelector('.sc-hint');
    hint.style.display = 'none';
  }

  _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  _debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }
}

// Entry point
window.mcpSelectorCaptureActive = true;
window.mcpSelectorCaptureInstance = new SelectorCaptureOverlay(window._mcpCaptureSid || '');

} // end guard
