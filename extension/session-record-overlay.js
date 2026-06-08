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
      this.container.style.cssText = 'all: initial; position: fixed; bottom: 16px; right: 16px; z-index: 2147483646;';
      this.shadow = this.container.attachShadow({ mode: 'closed' });
      this.shadow.innerHTML = `
        <style>
          .pill {
            display: flex; align-items: center; gap: 8px;
            background: linear-gradient(135deg, #6f42c1 0%, #4c1d95 100%);
            color: white; padding: 10px 14px; border-radius: 999px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px; font-weight: 500;
            box-shadow: 0 6px 20px rgba(0,0,0,0.4);
            cursor: default;
            user-select: none;
            border: 2px solid rgba(255,255,255,0.15);
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
        <div class="pill" part="pill">
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
      if (this.container?.parentNode) this.container.parentNode.removeChild(this.container);
      window.__unibrowseSessionRecordOverlay = null;
    }
  }

  window.__unibrowseSessionRecordOverlay = new SessionRecordOverlay();
})();
