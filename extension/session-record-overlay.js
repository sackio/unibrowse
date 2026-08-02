/**
 * SessionRecordOverlay — small floating control that appears in pages where
 * a session recording (rrweb+network+video) is active. Shows a record indicator
 * + "✏️ Annotate" button that opens the AnnotationTool. Distinct from the
 * older "selector capture" recording-overlay.js which is for agent-requested
 * one-off interaction captures, not session recordings.
 *
 * Loaded by background.js's handleStartSessionRecording alongside session-recorder.js
 * and unloaded on stop. Idempotent so re-injection across navigation is safe.
 */
(function () {
  if (window.__unibrowseSessionRecordOverlay) return;

  class SessionRecordOverlay {
    constructor() {
      this.activeAnnotation = null;
      this.annotationCount = 0;
      this._build();
      // Listen for stop signal from background so we tear down cleanly.
      this._msgListener = (msg) => {
        if (msg?.type === 'SR_OVERLAY_DESTROY') this.destroy();
        if (msg?.type === 'SR_ANNOTATION_SAVED') {
          this.annotationCount++;
          this._updateCount();
          this._setBadge('saved ✓');
          setTimeout(() => this._setBadge(''), 1200);
        }
        if (msg?.type === 'SR_ANNOTATION_FAILED') {
          this._setBadge(`fail: ${msg.error || 'unknown'}`);
          setTimeout(() => this._setBadge(''), 3500);
        }
      };
      chrome.runtime?.onMessage?.addListener?.(this._msgListener);
    }

    _build() {
      this.container = document.createElement('div');
      this.container.id = '__unibrowse_sr_overlay';
      // Initial anchor: bottom-right unless we have a saved drag position.
      // Position persists in localStorage so it survives page reloads, which
      // also re-mount this overlay. Use left/top once dragged (anchors
      // bottom/right would otherwise have to be inverted on drag).
      const saved = this._readSavedPos();
      // ⚠️ `pointer-events: none` is LOAD-BEARING and must survive `all: initial`,
      // which resets pointer-events back to `auto`. The container sits at
      // z-index 2147483646, so any area of it that accepts pointer events eats
      // clicks aimed at the page underneath — and the click silently lands on
      // glass rather than erroring, so it reads as a broken page control.
      // (`storybook`, 2026-08-02: elementFromPoint() over a real button returned
      // this element; three controls were unclickable and a correct bug report
      // about them was retracted as tester error.)
      // The interactive `.pill` re-enables pointer events for itself below, so
      // only the visible pill catches clicks — not its bounding box.
      const baseCss = 'all: initial; position: fixed; z-index: 2147483646; pointer-events: none;';
      if (saved) {
        this.container.style.cssText = `${baseCss} left: ${saved.x}px; top: ${saved.y}px;`;
      } else {
        this.container.style.cssText = `${baseCss} bottom: 16px; right: 16px;`;
      }
      this.shadow = this.container.attachShadow({ mode: 'closed' });
      this.shadow.innerHTML = `
        <style>
          .pill {
            /* Re-enables clicks for the pill only; the host container is
               pointer-events:none so the rest of the page stays reachable. */
            pointer-events: auto;
            display: flex; align-items: center; gap: 8px;
            background: linear-gradient(135deg, #6f42c1 0%, #4c1d95 100%);
            color: white; padding: 10px 14px; border-radius: 999px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px; font-weight: 500;
            box-shadow: 0 6px 20px rgba(0,0,0,0.4);
            cursor: grab;
            user-select: none;
            border: 2px solid rgba(255,255,255,0.15);
            touch-action: none;
          }
          .pill.dragging { cursor: grabbing; box-shadow: 0 10px 28px rgba(0,0,0,0.55); }
          .grip {
            width: 10px; opacity: 0.55; line-height: 1; font-size: 14px;
            letter-spacing: -2px; padding-right: 2px;
          }
          .dot {
            width: 10px; height: 10px; border-radius: 50%;
            background: #ef4444;
            animation: pulse 1.6s ease-in-out infinite;
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.35; }
          }
          .label { white-space: nowrap; }
          .badge {
            background: rgba(0,0,0,0.25); border-radius: 6px;
            padding: 2px 6px; font-size: 11px;
            min-width: 14px; text-align: center;
          }
          .btn {
            background: rgba(255,255,255,0.18);
            border: none; color: white;
            padding: 5px 10px; border-radius: 999px;
            font: inherit; font-size: 12px; font-weight: 500;
            cursor: pointer;
          }
          .btn:hover { background: rgba(255,255,255,0.28); }
          .status {
            margin-left: 6px; font-size: 11px; opacity: 0.85;
            font-style: italic;
            max-width: 140px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          }
        </style>
        <div class="pill" part="pill" data-role="pill" title="Drag to move">
          <div class="grip" aria-hidden="true">⋮⋮</div>
          <div class="dot"></div>
          <div class="label">Recording</div>
          <div class="badge" data-role="count">0</div>
          <button class="btn" data-role="annotate">✏️ Annotate</button>
          <div class="status" data-role="status"></div>
        </div>
      `;
      document.documentElement.appendChild(this.container);
      const annotateBtn = this.shadow.querySelector('[data-role="annotate"]');
      annotateBtn.addEventListener('click', () => this._openAnnotation());
      this._wireDrag();
    }

    /**
     * Make the pill draggable. The drag starts on pointerdown anywhere in the
     * pill EXCEPT the Annotate button (so the click still registers). We
     * snap into left/top coordinates on first drag and persist them so the
     * position survives reloads (which re-mount this overlay).
     */
    _wireDrag() {
      const pill = this.shadow.querySelector('[data-role="pill"]');
      if (!pill) return;
      let drag = null;       // {startX, startY, originLeft, originTop, moved}
      const DRAG_THRESH = 3; // px before we consider it a real drag (vs click)

      pill.addEventListener('pointerdown', (e) => {
        // Don't start a drag from inside the Annotate button.
        if (e.target?.closest?.('[data-role="annotate"]')) return;
        // Snap to left/top so future moves can update them directly. If we're
        // still on bottom-right anchors, convert from current rect.
        const rect = this.container.getBoundingClientRect();
        this.container.style.left = `${Math.round(rect.left)}px`;
        this.container.style.top = `${Math.round(rect.top)}px`;
        this.container.style.right = 'auto';
        this.container.style.bottom = 'auto';
        drag = {
          startX: e.clientX,
          startY: e.clientY,
          originLeft: rect.left,
          originTop: rect.top,
          moved: false,
        };
        try { pill.setPointerCapture(e.pointerId); } catch {}
      });

      pill.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESH) return;
        drag.moved = true;
        pill.classList.add('dragging');
        const margin = 4;
        const w = this.container.offsetWidth;
        const h = this.container.offsetHeight;
        const maxX = Math.max(margin, window.innerWidth  - w - margin);
        const maxY = Math.max(margin, window.innerHeight - h - margin);
        const nx = Math.min(Math.max(margin, drag.originLeft + dx), maxX);
        const ny = Math.min(Math.max(margin, drag.originTop  + dy), maxY);
        this.container.style.left = `${Math.round(nx)}px`;
        this.container.style.top  = `${Math.round(ny)}px`;
      });

      const finish = (e) => {
        if (!drag) return;
        pill.classList.remove('dragging');
        try { pill.releasePointerCapture(e.pointerId); } catch {}
        if (drag.moved) {
          const rect = this.container.getBoundingClientRect();
          this._writeSavedPos({ x: Math.round(rect.left), y: Math.round(rect.top) });
        }
        drag = null;
      };
      pill.addEventListener('pointerup', finish);
      pill.addEventListener('pointercancel', finish);

      // Keep the saved position inside the viewport on resize so the pill
      // never gets stranded off-screen.
      this._resizeClamp = () => {
        if (!this.container) return;
        const left = parseFloat(this.container.style.left);
        const top = parseFloat(this.container.style.top);
        if (Number.isNaN(left) || Number.isNaN(top)) return;
        const w = this.container.offsetWidth;
        const h = this.container.offsetHeight;
        const margin = 4;
        const maxX = Math.max(margin, window.innerWidth - w - margin);
        const maxY = Math.max(margin, window.innerHeight - h - margin);
        const nx = Math.min(Math.max(margin, left), maxX);
        const ny = Math.min(Math.max(margin, top), maxY);
        if (nx !== left || ny !== top) {
          this.container.style.left = `${Math.round(nx)}px`;
          this.container.style.top = `${Math.round(ny)}px`;
          this._writeSavedPos({ x: Math.round(nx), y: Math.round(ny) });
        }
      };
      window.addEventListener('resize', this._resizeClamp);
    }

    _readSavedPos() {
      try {
        const raw = localStorage.getItem('__unibrowse_sr_overlay_pos');
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (typeof p?.x !== 'number' || typeof p?.y !== 'number') return null;
        return p;
      } catch { return null; }
    }
    _writeSavedPos(pos) {
      try { localStorage.setItem('__unibrowse_sr_overlay_pos', JSON.stringify(pos)); } catch {}
    }

    _openAnnotation() {
      if (this.activeAnnotation) return; // already open
      if (!window.AnnotationTool) {
        this._setBadge('Annotation tool not loaded');
        return;
      }
      this.activeAnnotation = new window.AnnotationTool({
        onSave: (payload) => {
          this._setBadge('uploading…');
          chrome.runtime.sendMessage(
            { type: 'SR_ANNOTATION_CREATE', payload },
            (resp) => {
              if (resp?.success) {
                this.annotationCount++;
                this._updateCount();
                this._setBadge('saved ✓');
                setTimeout(() => this._setBadge(''), 1200);
                // Keep the palette open for chained annotations — just clear
                // the canvas + note so the user can draw the next shape
                // without re-clicking "Annotate". Done button on the palette
                // is the explicit "close annotation mode" affordance.
                this.activeAnnotation?.resetForNext();
                this.activeAnnotation?.incrementSavedCount(this.annotationCount);
              } else {
                // On error, tear down — they probably want a fresh start.
                this.activeAnnotation?.finish();
                this.activeAnnotation = null;
                this._setBadge(`fail: ${resp?.error || 'no response'}`);
                setTimeout(() => this._setBadge(''), 3500);
              }
            }
          );
        },
        onCancel: () => {
          this.activeAnnotation?.finish();
          this.activeAnnotation = null;
          this._setBadge('done');
          setTimeout(() => this._setBadge(''), 1200);
        },
      });
    }

    _updateCount() {
      const el = this.shadow.querySelector('[data-role="count"]');
      if (el) el.textContent = String(this.annotationCount);
    }
    _setBadge(msg) {
      const el = this.shadow.querySelector('[data-role="status"]');
      if (el) el.textContent = msg || '';
    }

    destroy() {
      try { this.activeAnnotation?.finish(); } catch {}
      try { chrome.runtime?.onMessage?.removeListener?.(this._msgListener); } catch {}
      try { if (this._resizeClamp) window.removeEventListener('resize', this._resizeClamp); } catch {}
      if (this.container?.parentNode) this.container.parentNode.removeChild(this.container);
      window.__unibrowseSessionRecordOverlay = null;
    }
  }

  window.__unibrowseSessionRecordOverlay = new SessionRecordOverlay();
})();
