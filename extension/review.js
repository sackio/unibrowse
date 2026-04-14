/**
 * Review Recording Controller
 * Renders step list, handles edits/deletions/notes, saves to MCP server
 */

class ReviewController {
  constructor() {
    this.recording = null;
    this.steps = [];
    this.titleInput = null;
    this.descInput = null;
    this.tagsInput = null;

    document.getElementById('save-btn').addEventListener('click', () => this.save());
    document.getElementById('discard-btn').addEventListener('click', () => this.discard());

    this.init();
  }

  async init() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'get_pending_recording' });
      if (!response || !response.recording) {
        this.showError('No pending recording found. This tab may have been opened incorrectly.');
        return;
      }
      this.recording = response.recording;
      this.steps = [...(this.recording.steps || [])];
      this.render();
      this.loadVideoReplay(); // async, non-blocking
    } catch (err) {
      this.showError('Failed to load recording: ' + err.message);
    }
  }

  async loadVideoReplay() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'get_recording_video' });
      if (!response || !response.success || !response.arrayBuffer) return;

      const blob = new Blob([response.arrayBuffer], { type: response.mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);

      const container = document.getElementById('video-container');
      const loadingEl = document.getElementById('video-loading');
      const videoEl = document.getElementById('recording-video');

      if (!container || !videoEl) return;

      videoEl.src = url;
      videoEl.style.display = 'block';
      if (loadingEl) loadingEl.style.display = 'none';
      container.style.display = 'block';

      // Revoke blob URL when tab closes to free memory
      window.addEventListener('beforeunload', () => URL.revokeObjectURL(url), { once: true });

      // Toggle video body visibility
      const toggleBtn = document.getElementById('video-toggle');
      const videoBody = document.getElementById('video-body');
      if (toggleBtn && videoBody) {
        toggleBtn.addEventListener('click', () => {
          const hidden = videoBody.style.display === 'none';
          videoBody.style.display = hidden ? 'block' : 'none';
          toggleBtn.textContent = hidden ? '▾ Hide' : '▸ Show';
        });
      }
    } catch (err) {
      // Video replay is optional — silently fail
      console.log('[Review] Video replay unavailable:', err.message);
    }
  }

  render() {
    const rec = this.recording;
    const duration = rec.duration ? this.formatDuration(rec.duration) : 'Unknown';

    const content = document.getElementById('content');
    content.innerHTML = '';

    // Metadata card
    const metaCard = document.createElement('div');
    metaCard.className = 'card';
    metaCard.innerHTML = `
      <h2>Recording Details</h2>
      <div class="field">
        <label>Title *</label>
        <input type="text" id="title-input" placeholder="What does this recording demonstrate?" />
      </div>
      <div class="field">
        <label>Description</label>
        <textarea id="desc-input" placeholder="Optional: describe the steps or purpose…"></textarea>
      </div>
      <div class="field">
        <label>Tags (comma-separated)</label>
        <input type="text" id="tags-input" placeholder="e.g. checkout, login, search" />
      </div>
      <div class="stats-row" style="margin-top:14px;">
        <div class="stat">
          <span class="stat-label">Start URL</span>
          <span class="stat-value" title="${this.escHtml(rec.startUrl || '')}">${this.truncate(rec.startUrl || '—', 60)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Duration</span>
          <span class="stat-value">${duration}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Steps</span>
          <span class="stat-value" id="step-count">${this.steps.length}</span>
        </div>
      </div>
    `;
    content.appendChild(metaCard);

    this.titleInput = metaCard.querySelector('#title-input');
    this.descInput = metaCard.querySelector('#desc-input');
    this.tagsInput = metaCard.querySelector('#tags-input');

    // Steps section
    const stepsSection = document.createElement('div');
    stepsSection.className = 'card';

    const stepsHeader = document.createElement('div');
    stepsHeader.className = 'steps-header';
    stepsHeader.innerHTML = `
      <h2>Interaction Steps</h2>
      <span class="step-count-badge" id="step-badge">${this.steps.length} steps</span>
    `;
    stepsSection.appendChild(stepsHeader);

    const stepsContainer = document.createElement('div');
    stepsContainer.id = 'steps-container';
    stepsSection.appendChild(stepsContainer);

    content.appendChild(stepsSection);

    this.renderSteps();
  }

  renderSteps() {
    const container = document.getElementById('steps-container');
    if (!container) return;

    container.innerHTML = '';

    if (this.steps.length === 0) {
      container.innerHTML = `
        <div class="empty-steps">
          <p>No interaction steps captured.</p>
          <small>You can still save this recording with a title.</small>
        </div>
      `;
      return;
    }

    this.steps.forEach((step, index) => {
      container.appendChild(this.createStepCard(step, index));
    });
  }

  createStepCard(step, index) {
    if (step.type === 'selector_capture') {
      return this._createSelectorCaptureCard(step, index);
    }

    const card = document.createElement('div');
    card.className = 'step-card';
    card.dataset.index = index;

    const typeClass = this.getTypeClass(step.type);
    const desc = this.getStepDescription(step);
    const timeStr = this.formatOffset(step.timestamp);

    const summary = document.createElement('div');
    summary.className = 'step-summary';
    summary.innerHTML = `
      <span class="step-num">#${step.id}</span>
      <span class="step-type-badge ${typeClass}">${step.type}</span>
      <span class="step-desc" title="${this.escHtml(desc)}">${this.escHtml(desc)}</span>
      <span class="step-time">+${timeStr}</span>
      <button class="step-delete" title="Remove step">✕</button>
    `;

    summary.querySelector('.step-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteStep(index);
    });

    summary.addEventListener('click', (e) => {
      if (e.target.classList.contains('step-delete')) return;
      card.classList.toggle('expanded');
    });

    // Details panel
    const details = document.createElement('div');
    details.className = 'step-details';

    // Build detail rows
    const rows = [];
    if (step.url) rows.push(['URL', this.truncate(step.url, 80)]);
    if (step.element && step.element.selector) rows.push(['Selector', step.element.selector]);
    if (step.element && step.element.tagName) rows.push(['Element', step.element.tagName + (step.element.text ? ` "${this.truncate(step.element.text, 30)}"` : '')]);
    if (step.value) rows.push(['Value', step.value]);
    if (step.key) rows.push(['Key', step.key]);
    if (step.x != null) rows.push(['Coords', `(${step.x}, ${step.y})`]);
    if (step.scrollX != null) rows.push(['Scroll', `(${step.scrollX}, ${step.scrollY})`]);

    let gridHtml = '';
    rows.forEach(([k, v]) => {
      gridHtml += `<span class="detail-key">${this.escHtml(k)}</span><span class="detail-val">${this.escHtml(String(v))}</span>`;
    });

    details.innerHTML = `
      ${gridHtml ? `<div class="detail-grid">${gridHtml}</div>` : ''}
      <div class="note-label">Note / Annotation</div>
      <textarea class="note-field" placeholder="Add a note about this step…">${this.escHtml(step.note || '')}</textarea>
    `;

    details.querySelector('.note-field').addEventListener('input', (e) => {
      this.steps[index].note = e.target.value;
    });

    card.appendChild(summary);
    card.appendChild(details);
    return card;
  }

  deleteStep(index) {
    this.steps.splice(index, 1);
    // Re-assign sequential ids
    this.steps.forEach((s, i) => { s.id = i + 1; });
    this.renderSteps();
    this.updateStepCount();
  }

  updateStepCount() {
    const badge = document.getElementById('step-badge');
    const count = document.getElementById('step-count');
    if (badge) badge.textContent = `${this.steps.length} steps`;
    if (count) count.textContent = this.steps.length;
  }

  async save() {
    const title = this.titleInput ? this.titleInput.value.trim() : '';
    if (!title) {
      if (this.titleInput) {
        this.titleInput.classList.add('error');
        this.titleInput.focus();
        this.titleInput.placeholder = 'Title is required';
      }
      return;
    }

    const saveBtn = document.getElementById('save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    const tags = (this.tagsInput ? this.tagsInput.value : '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    const recordingToSave = {
      sessionId: this.recording.sessionId,
      title,
      description: this.descInput ? this.descInput.value.trim() : '',
      tags,
      startUrl: this.recording.startUrl,
      startTime: this.recording.startTime,
      endTime: this.recording.endTime,
      duration: this.recording.duration,
      steps: this.steps,
    };

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'save_recording',
        recording: recordingToSave
      });

      if (response && response.success) {
        saveBtn.textContent = 'Saved!';
        saveBtn.className = 'btn btn-saved';
        setTimeout(() => window.close(), 1500);
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Recording';
        alert('Save failed: ' + (response ? response.error : 'Unknown error'));
      }
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Recording';
      alert('Save failed: ' + err.message);
    }
  }

  async discard() {
    if (!confirm('Discard this recording? All captured steps will be lost.')) return;
    await chrome.runtime.sendMessage({ type: 'discard_recording' });
    window.close();
  }

  showError(msg) {
    document.getElementById('content').innerHTML = `
      <div class="card" style="color:#c33; text-align:center; padding:40px;">
        <p style="font-size:16px; margin-bottom:8px;">Error</p>
        <p>${this.escHtml(msg)}</p>
      </div>
    `;
  }

  _createSelectorCaptureCard(step, index) {
    const card = document.createElement('div');
    card.className = 'step-card step-card--capture';
    card.dataset.index = index;

    const timeStr = this.formatOffset(step.timestamp);

    const summary = document.createElement('div');
    summary.className = 'step-summary';
    summary.innerHTML = `
      <span class="step-num">#${step.id}</span>
      <span class="step-type-badge type-selector-capture">capture</span>
      <span class="step-desc" title="${this.escHtml(step.name || '')}">${this.escHtml(step.name || '(unnamed)')}</span>
      <span class="step-time">+${timeStr}</span>
      <button class="step-delete" title="Remove step">✕</button>
    `;

    summary.querySelector('.step-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteStep(index);
    });

    summary.addEventListener('click', (e) => {
      if (e.target.classList.contains('step-delete')) return;
      card.classList.toggle('expanded');
    });

    const details = document.createElement('div');
    details.className = 'step-details step-details--capture';

    // Editable name row
    const nameInput = document.createElement('div');
    nameInput.className = 'capture-edit-row';
    nameInput.innerHTML = `
      <span class="capture-edit-label">Name</span>
      <input type="text" value="${this.escHtml(step.name || '')}" placeholder="Data point name" />
    `;
    nameInput.querySelector('input').addEventListener('input', (e) => {
      this.steps[index].name = e.target.value;
    });

    // Editable selector row
    const selInput = document.createElement('div');
    selInput.className = 'capture-edit-row';
    selInput.innerHTML = `
      <span class="capture-edit-label">Selector</span>
      <input type="text" value="${this.escHtml(step.selector || '')}" placeholder="CSS selector" style="font-family:monospace;font-size:12px;" />
    `;
    selInput.querySelector('input').addEventListener('input', (e) => {
      this.steps[index].selector = e.target.value;
    });

    // Stats row
    const stats = document.createElement('div');
    stats.className = 'capture-stats';
    const matchStr = step.matchCount != null ? `${step.matchCount} match${step.matchCount !== 1 ? 'es' : ''}` : '';
    const regionStr = step.region ? `${Math.round(step.region.width)}×${Math.round(step.region.height)}px` : '';
    const urlStr = step.url ? this.truncate(step.url, 50) : '';
    [matchStr, regionStr, urlStr].filter(Boolean).forEach(s => {
      const span = document.createElement('span');
      span.textContent = s;
      stats.appendChild(span);
    });

    details.appendChild(nameInput);
    details.appendChild(selInput);
    details.appendChild(stats);

    // Selector options
    if (step.selectorOptions && step.selectorOptions.length > 0) {
      const toggle = document.createElement('div');
      toggle.className = 'capture-options-toggle';
      toggle.textContent = `▸ ${step.selectorOptions.length} selector options`;

      const optList = document.createElement('div');
      optList.className = 'capture-options-list hidden';

      step.selectorOptions.forEach(opt => {
        const row = document.createElement('div');
        row.className = 'capture-option-row';
        row.innerHTML = `
          <span class="capture-opt-strategy">${this.escHtml(opt.strategy || '')}</span>
          <span class="capture-opt-selector">${this.escHtml(opt.selector || '')}</span>
          <span class="capture-opt-count">${opt.count != null ? opt.count + ' match' + (opt.count !== 1 ? 'es' : '') : ''}</span>
        `;
        row.addEventListener('click', () => {
          this.steps[index].selector = opt.selector;
          selInput.querySelector('input').value = opt.selector;
        });
        optList.appendChild(row);
      });

      toggle.addEventListener('click', () => {
        const hidden = optList.classList.contains('hidden');
        optList.classList.toggle('hidden', !hidden);
        toggle.textContent = (hidden ? '▾ ' : '▸ ') + toggle.textContent.slice(2);
      });

      details.appendChild(toggle);
      details.appendChild(optList);
    }

    // Element previews
    if (step.elements && step.elements.length > 0) {
      const preview = document.createElement('div');
      preview.className = 'capture-elements-preview';
      step.elements.slice(0, 5).forEach(el => {
        const span = document.createElement('span');
        span.innerHTML = `<span class="capture-el-tag">${this.escHtml(el.tagName || '?')}</span> `;
        if (el.text) {
          const textSpan = document.createElement('span');
          textSpan.className = 'capture-el-text';
          textSpan.textContent = '"' + this.truncate(el.text, 40) + '"';
          span.appendChild(textSpan);
        }
        span.appendChild(document.createTextNode(' '));
        preview.appendChild(span);
      });
      details.appendChild(preview);
    }

    // Note field
    const noteLabel = document.createElement('div');
    noteLabel.className = 'note-label';
    noteLabel.textContent = 'Note / Annotation';
    const noteField = document.createElement('textarea');
    noteField.className = 'note-field';
    noteField.placeholder = 'Add a note about this step…';
    noteField.value = step.note || '';
    noteField.addEventListener('input', (e) => {
      this.steps[index].note = e.target.value;
    });
    details.appendChild(noteLabel);
    details.appendChild(noteField);

    card.appendChild(summary);
    card.appendChild(details);
    return card;
  }

  // ---- Helpers ----

  getTypeClass(type) {
    const map = { click: 'type-click', dblclick: 'type-click', input: 'type-input', change: 'type-input', keydown: 'type-keydown', scroll: 'type-scroll', focus: 'type-focus', blur: 'type-blur', drag: 'type-drag', drop: 'type-drag', dragstart: 'type-drag', selector_capture: 'type-selector-capture' };
    return map[type] || 'type-other';
  }

  getStepDescription(step) {
    const el = step.element;
    const tag = el && el.tagName ? el.tagName.toLowerCase() : '';
    const text = el && el.text ? `"${this.truncate(el.text, 30)}"` : '';
    const sel = el && el.selector ? el.selector : '';

    switch (step.type) {
      case 'click':
      case 'dblclick':
        return text || sel || `${tag || 'element'} click`;
      case 'input':
      case 'change':
        return `${sel || tag || 'input'} ← "${this.truncate(step.value || '', 40)}"`;
      case 'keydown':
        return `Key: ${step.key || '?'}${sel ? ` on ${sel}` : ''}`;
      case 'scroll':
        return `Scroll (${step.scrollX || 0}, ${step.scrollY || 0})`;
      case 'focus':
        return `Focus ${sel || tag}`;
      case 'blur':
        return `Blur ${sel || tag}`;
      case 'selector_capture':
        return `Captured: "${step.name || '?'}" → ${step.selector || ''}`;
      default:
        return `${step.type}${sel ? ` on ${sel}` : ''}`;
    }
  }

  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }

  formatOffset(ms) {
    if (ms == null) return '?';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

const reviewController = new ReviewController();
