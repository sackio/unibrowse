/**
 * AnnotationTool — drawing overlay for marking up a page during session recording.
 *
 * Loaded by recording-overlay.js when the user clicks the "Annotate" button. Renders
 * a transparent full-page canvas on top of the document, a floating tool palette
 * (pencil / rectangle / lasso), and a note input. When the user saves, packages
 * up { shape, bbox, domTargets, note } and hands it to the caller via the onSave
 * callback. The caller (overlay) forwards the payload to background.js which
 * captures a viewport screenshot, crops it to the bbox, and persists the
 * annotation into the active session recording.
 *
 * Stays in the page's normal world (NOT inside the overlay's shadow DOM) because
 * we need to do hit-testing against the real page elements via document.elementFromPoint.
 * Uses pointer-events: none on the canvas EXCEPT during drawing so clicks pass
 * through to underlying elements between strokes.
 */
(function () {
  if (window.AnnotationTool) return; // idempotent

  const PALETTE_Z = 2147483646;
  const CANVAS_Z = 2147483645;

  class AnnotationTool {
    /**
     * @param {object} opts
     * @param {function} opts.onSave({shape, bbox, domTargets, note})
     * @param {function} opts.onCancel()
     */
    constructor(opts) {
      this.onSave = opts.onSave || (() => {});
      this.onCancel = opts.onCancel || (() => {});
      this.tool = 'pencil';        // 'pencil' | 'rect' | 'lasso'
      this.shape = null;           // {type, points: [{x,y}]} or {type:'rect', x,y,w,h}
      this.drawing = false;
      this.note = '';
      this._build();
      this._wire();
    }

    /** Mount canvas + palette overlay onto the page. */
    _build() {
      this.canvas = document.createElement('canvas');
      this.canvas.id = '__unibrowse_annot_canvas';
      this.canvas.style.cssText = [
        'position: fixed',
        'top: 0', 'left: 0',
        `width: ${window.innerWidth}px`,
        `height: ${window.innerHeight}px`,
        `z-index: ${CANVAS_Z}`,
        'pointer-events: auto',
        'cursor: crosshair',
        'background: rgba(37, 99, 235, 0.05)',
      ].join(';');
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
      document.documentElement.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      this.palette = document.createElement('div');
      this.palette.id = '__unibrowse_annot_palette';
      this.palette.style.cssText = [
        'all: initial',
        'position: fixed',
        'top: 80px', 'right: 16px',
        `z-index: ${PALETTE_Z}`,
        'background: #1e40af',
        'color: white',
        'padding: 12px',
        'border-radius: 12px',
        'box-shadow: 0 8px 32px rgba(0,0,0,0.5)',
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        'font-size: 13px',
        'display: flex',
        'flex-direction: column',
        'gap: 8px',
        'min-width: 280px',
      ].join(';');
      this.palette.innerHTML = `
        <div style="font-weight:600;display:flex;align-items:center;gap:8px;">
          <span>✏️</span><span>Annotate</span>
        </div>
        <div data-row="tools" style="display:flex;gap:4px;">
          <button data-tool="pencil" style="${btnCss(true)}">✏️ Pencil</button>
          <button data-tool="rect"   style="${btnCss()}">▭ Rect</button>
          <button data-tool="lasso"  style="${btnCss()}">🪢 Lasso</button>
        </div>
        <textarea data-field="note" placeholder="Add a note (what should the agent do?)..." rows="3" style="${textareaCss()}"></textarea>
        <div style="display:flex;gap:6px;">
          <button data-act="clear" style="${secondaryBtnCss()}">Clear drawing</button>
          <button data-act="cancel" style="${secondaryBtnCss()}">Cancel</button>
          <button data-act="save" style="${primaryBtnCss()}">Save annotation</button>
        </div>
        <div data-status="" style="font-size:11px;opacity:0.7;line-height:1.3;">
          Draw on the page. Save adds it to the active recording.
        </div>
      `;
      document.documentElement.appendChild(this.palette);
    }

    _wire() {
      // Tool selector
      this.palette.querySelectorAll('button[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.tool = btn.dataset.tool;
          this.palette.querySelectorAll('button[data-tool]').forEach(b => {
            b.style.cssText = btnCss(b === btn);
          });
          this._clearCanvas();
          this.shape = null;
          this._setStatus(`Tool: ${this.tool}. Draw on the page.`);
        });
      });
      // Action buttons
      this.palette.querySelector('button[data-act="clear"]').addEventListener('click', () => {
        this._clearCanvas();
        this.shape = null;
        this._setStatus('Cleared. Draw again.');
      });
      this.palette.querySelector('button[data-act="cancel"]').addEventListener('click', () => {
        this._teardown();
        this.onCancel();
      });
      this.palette.querySelector('button[data-act="save"]').addEventListener('click', () => this._save());
      this.palette.querySelector('textarea[data-field="note"]').addEventListener('input', (e) => {
        this.note = e.target.value;
      });

      // Drawing
      this.canvas.addEventListener('pointerdown', this._onDown.bind(this));
      this.canvas.addEventListener('pointermove', this._onMove.bind(this));
      this.canvas.addEventListener('pointerup',   this._onUp.bind(this));
      this.canvas.addEventListener('pointercancel', this._onUp.bind(this));

      // Window resize → re-size canvas (lose drawing)
      this._resizeHandler = () => {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.canvas.style.width = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';
        if (this.shape) this._redraw();
      };
      window.addEventListener('resize', this._resizeHandler);
    }

    _onDown(e) {
      this.drawing = true;
      const pt = this._ptFromEvent(e);
      if (this.tool === 'pencil') {
        this.shape = { type: 'pencil', points: [pt] };
        this.ctx.beginPath();
        this.ctx.moveTo(pt.x, pt.y);
        this.ctx.strokeStyle = '#ef4444';
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
      } else if (this.tool === 'rect') {
        this.shape = { type: 'rect', start: pt, end: pt };
      } else if (this.tool === 'lasso') {
        this.shape = { type: 'lasso', points: [pt] };
        this.ctx.beginPath();
        this.ctx.moveTo(pt.x, pt.y);
        this.ctx.strokeStyle = '#22c55e';
        this.ctx.setLineDash([6, 4]);
        this.ctx.lineWidth = 2;
      }
      try { this.canvas.setPointerCapture(e.pointerId); } catch {}
    }

    _onMove(e) {
      if (!this.drawing || !this.shape) return;
      const pt = this._ptFromEvent(e);
      if (this.shape.type === 'pencil' || this.shape.type === 'lasso') {
        this.shape.points.push(pt);
        this.ctx.lineTo(pt.x, pt.y);
        this.ctx.stroke();
      } else if (this.shape.type === 'rect') {
        this.shape.end = pt;
        this._redraw();
      }
    }

    _onUp() {
      if (!this.drawing) return;
      this.drawing = false;
      if (this.shape?.type === 'lasso' && this.shape.points.length > 2) {
        // close the polygon
        const first = this.shape.points[0];
        this.ctx.lineTo(first.x, first.y);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
      }
      this._setStatus('Shape captured. Add a note and save, or pick another tool to redo.');
    }

    _ptFromEvent(e) {
      return { x: e.clientX, y: e.clientY };
    }

    _clearCanvas() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.setLineDash([]);
    }

    _redraw() {
      this._clearCanvas();
      if (!this.shape) return;
      if (this.shape.type === 'rect') {
        const { start, end } = this.shape;
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        this.ctx.strokeStyle = '#ef4444';
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(x, y, w, h);
      } else if (this.shape.type === 'pencil') {
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#ef4444';
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.shape.points.forEach((p, i) => i ? this.ctx.lineTo(p.x, p.y) : this.ctx.moveTo(p.x, p.y));
        this.ctx.stroke();
      } else if (this.shape.type === 'lasso') {
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#22c55e';
        this.ctx.setLineDash([6, 4]);
        this.ctx.lineWidth = 2;
        this.shape.points.forEach((p, i) => i ? this.ctx.lineTo(p.x, p.y) : this.ctx.moveTo(p.x, p.y));
        const first = this.shape.points[0];
        if (first) this.ctx.lineTo(first.x, first.y);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
      }
    }

    _setStatus(msg) {
      const s = this.palette.querySelector('[data-status]');
      if (s) s.textContent = msg;
    }

    /** Compute axis-aligned bounding box of the current shape in viewport coords. */
    _computeBbox() {
      if (!this.shape) return null;
      if (this.shape.type === 'rect') {
        const { start, end } = this.shape;
        return {
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          w: Math.abs(end.x - start.x),
          h: Math.abs(end.y - start.y),
        };
      }
      const pts = this.shape.points || [];
      if (!pts.length) return null;
      let minX = +Infinity, minY = +Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    /** Find DOM elements under the shape, ranked by overlap area. Excludes our own overlay nodes. */
    _collectDomTargets(bbox) {
      const targets = [];
      const visited = new Set();
      // Probe a grid of points within the bbox; for each, walk up the element
      // chain skipping our overlay. Use elementsFromPoint to get all elements
      // (z-stacked) at each probe, then aggregate.
      const probeStep = Math.max(8, Math.floor(Math.min(bbox.w, bbox.h) / 12));
      for (let py = bbox.y; py <= bbox.y + bbox.h; py += probeStep) {
        for (let px = bbox.x; px <= bbox.x + bbox.w; px += probeStep) {
          if (!this._inShape(px, py)) continue;
          // Hide our overlay during the probe so elementsFromPoint doesn't pick it
          this.canvas.style.pointerEvents = 'none';
          const stack = document.elementsFromPoint(px, py);
          this.canvas.style.pointerEvents = 'auto';
          for (const el of stack) {
            if (!(el instanceof Element)) continue;
            if (el.id === '__unibrowse_annot_canvas' || el.id === '__unibrowse_annot_palette') continue;
            if (el.closest('#__unibrowse_annot_palette')) continue;
            if (el.closest('#mcp-recording-overlay-container')) continue;
            if (visited.has(el)) continue;
            visited.add(el);
            targets.push(el);
          }
        }
      }
      // Compute overlap area per target (intersection of bbox with element's
      // boundingClientRect) and rank. Filter out root containers (html, body)
      // and any element whose bounding rect covers >80% of the viewport area —
      // those are layout containers, not what the user is pointing at. They
      // sweep up the highest overlap-area ranks otherwise and bury the actual
      // target elements (verified 2026-06-07 by a driver test where <html>
      // outranked the <h1> the user actually highlighted).
      const viewportArea = window.innerWidth * window.innerHeight;
      const ranked = targets.map(el => {
        const r = el.getBoundingClientRect();
        const ix = Math.max(0, Math.min(bbox.x + bbox.w, r.right) - Math.max(bbox.x, r.left));
        const iy = Math.max(0, Math.min(bbox.y + bbox.h, r.bottom) - Math.max(bbox.y, r.top));
        const area = ix * iy;
        const tag = el.tagName.toLowerCase();
        const elArea = r.width * r.height;
        const tooLarge = viewportArea > 0 && elArea > 0.8 * viewportArea;
        return {
          tag,
          id: el.id || null,
          classes: el.classList.length ? Array.from(el.classList).slice(0, 6) : null,
          text: (el.textContent || '').trim().slice(0, 200) || null,
          xpath: this._xpath(el),
          css: this._cssPath(el),
          rect: { x: r.left, y: r.top, w: r.width, h: r.height },
          overlapArea: Math.round(area),
          _isRoot: tag === 'html' || tag === 'body',
          _tooLarge: tooLarge,
        };
      }).filter(t => t.overlapArea > 0 && !t._isRoot && !t._tooLarge)
        .map(t => { delete t._isRoot; delete t._tooLarge; return t; })
        .sort((a, b) => b.overlapArea - a.overlapArea)
        .slice(0, 12);
      return ranked;
    }

    /** Is a viewport point inside the current shape? */
    _inShape(x, y) {
      if (!this.shape) return false;
      if (this.shape.type === 'rect') {
        const { start, end } = this.shape;
        return x >= Math.min(start.x, end.x) && x <= Math.max(start.x, end.x)
            && y >= Math.min(start.y, end.y) && y <= Math.max(start.y, end.y);
      }
      if (this.shape.type === 'pencil') {
        // Pencil "shape" inclusion is generous — within ~16px of any stroke point.
        const r2 = 16 * 16;
        return this.shape.points.some(p => (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) <= r2);
      }
      if (this.shape.type === 'lasso') {
        return pointInPolygon({ x, y }, this.shape.points);
      }
      return false;
    }

    _xpath(el) {
      if (!(el instanceof Element)) return '';
      if (el.id) return `//*[@id="${el.id}"]`;
      const parts = [];
      while (el && el.nodeType === 1) {
        let index = 1;
        let sib = el.previousElementSibling;
        while (sib) { if (sib.nodeName === el.nodeName) index++; sib = sib.previousElementSibling; }
        parts.unshift(`${el.nodeName.toLowerCase()}[${index}]`);
        el = el.parentElement;
      }
      return '/' + parts.join('/');
    }

    _cssPath(el) {
      if (!(el instanceof Element)) return '';
      const parts = [];
      let depth = 0;
      while (el && el.nodeType === 1 && depth < 6) {
        let sel = el.nodeName.toLowerCase();
        if (el.id) { sel += `#${el.id}`; parts.unshift(sel); break; }
        if (el.classList.length) sel += '.' + Array.from(el.classList).slice(0, 2).join('.');
        parts.unshift(sel);
        el = el.parentElement;
        depth++;
      }
      return parts.join(' > ');
    }

    _save() {
      if (!this.shape) {
        this._setStatus('Draw something first.');
        return;
      }
      const bbox = this._computeBbox();
      if (!bbox || bbox.w < 4 || bbox.h < 4) {
        this._setStatus('Shape too small. Try again.');
        return;
      }
      const domTargets = this._collectDomTargets(bbox);
      const payload = {
        timestamp: Date.now(),
        tool: this.tool,
        shape: this.shape,
        bbox,
        domTargets,
        note: this.note,
        viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY },
        pageUrl: location.href,
        pageTitle: document.title,
      };
      this._setStatus('Saving + capturing screenshot…');
      this.onSave(payload);
    }

    _teardown() {
      window.removeEventListener('resize', this._resizeHandler);
      if (this.canvas?.parentNode) this.canvas.parentNode.removeChild(this.canvas);
      if (this.palette?.parentNode) this.palette.parentNode.removeChild(this.palette);
      this.canvas = this.palette = null;
    }

    /** Call from caller after the save completes successfully (or fails) to clean up. */
    finish() { this._teardown(); }
  }

  function btnCss(active) {
    return [
      'flex: 1',
      'padding: 8px 4px',
      'border: none',
      'border-radius: 6px',
      'cursor: pointer',
      'font-size: 12px',
      'font-weight: 500',
      `background: ${active ? '#3b82f6' : '#475569'}`,
      'color: white',
      'transition: background 0.15s',
    ].join(';');
  }
  function primaryBtnCss() {
    return ['flex: 1', 'padding: 8px', 'border: none', 'border-radius: 6px', 'cursor: pointer',
      'font-size: 12px', 'font-weight: 600', 'background: #22c55e', 'color: white'].join(';');
  }
  function secondaryBtnCss() {
    return ['flex: 1', 'padding: 8px', 'border: none', 'border-radius: 6px', 'cursor: pointer',
      'font-size: 12px', 'background: #475569', 'color: white'].join(';');
  }
  function textareaCss() {
    return ['width: 100%', 'box-sizing: border-box', 'padding: 8px', 'border: none',
      'border-radius: 6px', 'background: rgba(255,255,255,0.95)', 'color: #1e293b',
      'font-family: inherit', 'font-size: 12px', 'resize: vertical'].join(';');
  }

  /** Ray-casting point-in-polygon for lasso shapes. */
  function pointInPolygon(pt, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      const intersect = ((yi > pt.y) !== (yj > pt.y))
        && (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 1) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  window.AnnotationTool = AnnotationTool;
})();
