/**
 * Chrome DevTools Protocol (CDP) Helper Utilities
 * Wraps chrome.debugger API with convenient helper functions
 */

class CDPHelper {
  constructor() {
    this.target = null;
    this.enabledDomains = new Set();
    this.isDetaching = false; // Flag to prevent operations during detachment
    this.isAttaching = false; // Flag set during attach() to suppress spurious onDetach events
    this.reattachAttempts = 0;
    this.maxReattachAttempts = 3;
    this.reattachDelay = 1000; // Start with 1 second
    this.detachListener = null;
    this.lastKnownUrl = null;
  }

  /**
   * Validate tab exists and get its current state
   */
  async validateTab(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);

      // Check if URL is accessible
      if (tab.url && (
        BrowserEnv.isInternalUrl(tab.url) ||
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('about:')
      )) {
        throw new Error(`Cannot attach debugger to restricted URL: ${tab.url}`);
      }

      this.lastKnownUrl = tab.url;
      return tab;
    } catch (error) {
      console.error('[CDP] Tab validation failed:', error);
      throw error;
    }
  }

  /**
   * Setup detach event listener
   * NOTE: This listener only tracks detachments for logging.
   * Reattachment is handled by background.js to avoid conflicts.
   */
  setupDetachListener() {
    if (this.detachListener) {
      chrome.debugger.onDetach.removeListener(this.detachListener);
    }

    this.detachListener = (source, reason) => {
      if (this.target && source.tabId === this.target.tabId) {
        console.warn(`[CDP] Debugger detached from tab ${source.tabId}, reason:`, reason);
        this.isDetaching = true;
        const wasAttached = this.target !== null;
        this.target = null;
        this.enabledDomains.clear();

        // Log the detachment but let background.js handle reattachment
        console.log(`[CDP] Detachment logged. Background.js will handle reattachment if needed.`);
      }
    };

    chrome.debugger.onDetach.addListener(this.detachListener);
  }

  /**
   * Attempt to reattach debugger
   */
  async attemptReattach(tabId) {
    this.reattachAttempts++;

    try {
      await this.attach(tabId);
      console.log('[CDP] Successfully reattached debugger');
      this.reattachAttempts = 0; // Reset on success
    } catch (error) {
      console.error(`[CDP] Reattach attempt ${this.reattachAttempts} failed:`, error);

      if (this.reattachAttempts < this.maxReattachAttempts) {
        const nextDelay = this.reattachDelay * Math.pow(2, this.reattachAttempts);
        console.log(`[CDP] Will retry in ${nextDelay}ms`);
        setTimeout(() => this.attemptReattach(tabId), nextDelay);
      } else {
        console.error('[CDP] Max reattach attempts reached, giving up');
      }
    }
  }

  /**
   * Attach debugger to target tab
   */
  async attach(tabId) {
    // Guard against non-integer tabIds which cause "No matching signature" in chrome.debugger.attach
    if (typeof tabId !== 'number' || !Number.isInteger(tabId) || tabId <= 0) {
      throw new Error(`Invalid tabId: ${JSON.stringify(tabId)} (must be a positive integer)`);
    }
    this.isAttaching = true;
    try {
      // Validate tab before attempting attach
      console.log('[CDP] Validating tab:', tabId);
      await this.validateTab(tabId);
      console.log('[CDP] Tab validated');

      this.target = { tabId };
      this.isDetaching = false;
      this.reattachAttempts = 0;

      console.log('[CDP] Calling chrome.debugger.attach...');

      // Check if we (this extension) already own the debugger on this tab.
      // This happens when the service worker restarts but the old debugger session
      // is still live — in that case we can skip attach and just re-enable domains.
      const targets = await chrome.debugger.getTargets();
      const alreadyOurs = targets.find(t => t.tabId === tabId && t.attached);
      if (alreadyOurs) {
        console.log('[CDP] Debugger already attached by this extension, reusing session for tab:', tabId);
        // Fall through to domain setup without calling attach again
      } else {
        // Pre-emptive detach in case a stale session is lingering, then attach
        await chrome.debugger.detach(this.target).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 150));

        let attachSuccess = false;
        let lastError = null;

        for (let attempt = 1; attempt <= 5; attempt++) {
          try {
            await chrome.debugger.attach(this.target, '1.3');
            attachSuccess = true;
            if (attempt > 1) {
              console.log(`[CDP] Attach succeeded on retry ${attempt}/5 after force-detach`);
            }
            break;
          } catch (attachError) {
            lastError = attachError;
            const isAlreadyAttached = attachError.message && attachError.message.includes('Another debugger is already attached');
            // Downgrade the per-retry log noise: this is an expected race when
            // multiple agents touch the same tab or a service-worker restart
            // leaves a stale handle. Only the FINAL failure deserves an error.
            if (isAlreadyAttached && attempt < 5) {
              console.log(`[CDP] Attach race on tab ${this.target.tabId} (attempt ${attempt}/5) — force-detaching and retrying`);
              await chrome.debugger.detach(this.target).catch(() => {});
              await new Promise(resolve => setTimeout(resolve, 300 * attempt));
            } else if (isAlreadyAttached) {
              // Final attempt failed — escalate to error.
              console.error(`[CDP] Attach failed after 5 retries against an existing-debugger race on tab ${this.target.tabId}`);
              throw attachError;
            } else {
              console.error(`[CDP] Attach error (non-retryable):`, attachError);
              throw attachError;
            }
          }
        }

        if (!attachSuccess) {
          console.error('[CDP] Failed to attach after 5 attempts');
          throw lastError;
        }
      }

      console.log('[CDP] Debugger attached to tab:', tabId);

      // Setup detach listener
      console.log('[CDP] Setting up detach listener...');
      this.setupDetachListener();
      console.log('[CDP] Detach listener setup complete');

      // Enable essential CDP domains
      // Note: Input domain doesn't have .enable method
      console.log('[CDP] Enabling CDP domains...');
      await this.enableDomains(['Page', 'Runtime', 'DOM', 'Accessibility', 'Console', 'Log', 'Network']);
      console.log('[CDP] All domains enabled');

      console.log('[CDP] attach() complete, returning true');
      this.isAttaching = false;
      return true;
    } catch (error) {
      console.error('[CDP] Failed to attach debugger:', error);
      this.isAttaching = false;
      this.target = null;
      throw error;
    }
  }

  /**
   * Detach debugger from target
   */
  async detach() {
    if (!this.target) {
      return;
    }

    try {
      this.isDetaching = true; // Set flag before detaching

      // Remove detach listener before detaching to avoid triggering it
      if (this.detachListener) {
        chrome.debugger.onDetach.removeListener(this.detachListener);
        this.detachListener = null;
      }

      await chrome.debugger.detach(this.target);
      console.log('[CDP] Debugger detached');
      this.target = null;
      this.enabledDomains.clear();
      this.isDetaching = false;
      this.lastKnownUrl = null;
    } catch (error) {
      console.error('[CDP] Failed to detach debugger:', error);
      this.target = null;
      this.enabledDomains.clear();
      this.isDetaching = false;
      this.lastKnownUrl = null;
    }
  }

  /**
   * Enable CDP domains
   */
  async enableDomains(domains) {
    console.log('[CDP] enableDomains called with:', domains);
    const errors = [];

    for (const domain of domains) {
      if (this.enabledDomains.has(domain)) {
        console.log(`[CDP] Domain ${domain} already enabled, skipping`);
        continue;
      }

      try {
        console.log(`[CDP] Enabling domain: ${domain}...`);
        await this.sendCommand(`${domain}.enable`);
        this.enabledDomains.add(domain);
        console.log(`[CDP] ✓ Enabled domain: ${domain}`);
      } catch (error) {
        console.warn(`[CDP] ✗ Failed to enable domain ${domain}:`, error.message);
        errors.push({ domain, error: error.message });
        // Continue with other domains - don't let one failure stop everything
      }
    }

    if (errors.length > 0) {
      console.warn('[CDP] Some domains failed to enable:', errors);
      // Only throw if ALL domains failed
      if (errors.length === domains.length) {
        throw new Error(`Failed to enable all CDP domains: ${errors.map(e => e.domain).join(', ')}`);
      }
    }

    console.log('[CDP] enableDomains complete - enabled:', Array.from(this.enabledDomains));
  }

  /**
   * Ensure debugger is attached and tab is valid before operation
   */
  async ensureAttached() {
    if (!this.target) {
      throw new Error('Debugger not attached');
    }

    if (this.isDetaching) {
      throw new Error('Debugger is detaching');
    }

    // Validate tab still exists and is accessible
    try {
      const tab = await chrome.tabs.get(this.target.tabId);

      // Check if tab navigated to restricted URL
      if (tab.url && (
        BrowserEnv.isInternalUrl(tab.url) ||
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('about:')
      )) {
        console.warn(`[CDP] Tab navigated to restricted URL: ${tab.url}`);
        throw new Error(`Cannot operate on restricted URL: ${tab.url}`);
      }

      // Update last known URL
      this.lastKnownUrl = tab.url;
      return true;
    } catch (error) {
      // Check if this is a "tab not found" error (tab was closed)
      const errorMessage = error.message || '';
      if (errorMessage.includes('No tab with id') ||  // covers 'No tab with id: X' and 'No tab with given id X'
          errorMessage.includes('Tab not found') ||
          errorMessage.includes('tab was closed')) {
        // Tab was closed - this is expected, handle gracefully
        const closedTabId = this.target.tabId;  // capture before nulling this.target
        console.log(`[CDP] Tab ${closedTabId} no longer exists (closed)`);
        this.target = null;
        this.isDetaching = true;
        throw new Error(`Tab ${closedTabId} was closed`);
      }

      // Other errors (restricted URLs, etc.) - log and throw
      console.error('[CDP] Tab validation failed during ensureAttached:', error);
      this.target = null;
      this.isDetaching = true;
      throw error;
    }
  }

  /**
   * Send CDP command with retry logic and timeout
   * @param {string} method - CDP method name
   * @param {object} params - Method parameters
   * @param {number} retries - Current retry attempt
   * @param {number} maxRetries - Maximum retry attempts
   * @param {number} timeoutMs - Optional timeout in milliseconds (0 = no timeout)
   */
  async sendCommand(method, params = {}, retries = 0, maxRetries = 1, timeoutMs = null) {
    // Validate attachment before command
    await this.ensureAttached();

    try {
      // Determine timeout based on method type if not explicitly provided
      if (timeoutMs === null) {
        // Runtime.evaluate (macros): 2 minutes - complex operations need time
        // Page navigation: 30 seconds - page loads can be slow
        // Other commands: 10 seconds - general operations
        if (method === 'Runtime.evaluate') {
          timeoutMs = 120000; // 2 minutes for macros and JavaScript execution
        } else if (method.startsWith('Page.navigate') || method.startsWith('Page.reload')) {
          timeoutMs = 30000; // 30 seconds for navigation
        } else {
          timeoutMs = 10000; // 10 seconds for other commands
        }
      }

      const commandPromise = chrome.debugger.sendCommand(this.target, method, params);

      // Only apply timeout if timeoutMs > 0 (allows disabling timeout with 0)
      if (timeoutMs > 0) {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`CDP command ${method} timed out after ${timeoutMs/1000} seconds`)), timeoutMs);
        });
        const result = await Promise.race([commandPromise, timeoutPromise]);
        console.log(`[CDP] ${method}:`, result);
        return result;
      } else {
        // No timeout - wait indefinitely
        const result = await commandPromise;
        console.log(`[CDP] ${method}:`, result);
        return result;
      }
    } catch (error) {
      // Parse CDP error if it's in stringified JSON format
      let cdpError = error;
      if (error.message && error.message.startsWith('{')) {
        try {
          cdpError = JSON.parse(error.message);
        } catch {
          // Not JSON, use original error
        }
      }

      // Check for various detachment/navigation scenarios
      const errorMessage = cdpError.message || error.message || '';
      const errorCode = cdpError.code || '';

      // Handle detachment
      if (errorMessage.includes('Detached') || errorMessage.includes('detached') ||
          errorMessage.includes('not attached')) {
        console.warn(`[CDP] ${method} failed due to detachment`);
        this.isDetaching = true;
        const oldTabId = this.target?.tabId;
        this.target = null;
        this.enabledDomains.clear();

        // Retry after reattachment if within retry limit
        if (retries < maxRetries && oldTabId) {
          console.log(`[CDP] Attempting to reattach and retry ${method} (retry ${retries + 1}/${maxRetries})`);
          try {
            await new Promise(resolve => setTimeout(resolve, 500)); // Brief delay
            await this.attach(oldTabId);
            return this.sendCommand(method, params, retries + 1, maxRetries, timeoutMs);
          } catch (reattachError) {
            console.error(`[CDP] Reattachment failed:`, reattachError);
            throw error; // Throw original error
          }
        }
      }

      // Handle navigation interruption
      if (errorCode === -32000 && errorMessage.includes('Inspected target navigated or closed')) {
        console.warn(`[CDP] ${method} interrupted by page navigation`);
        throw new Error('Page navigation interrupted command execution. This is normal for actions that trigger navigation.');
      }

      // Handle chrome-extension:// URL errors - detach gracefully instead of throwing
      if (errorMessage.includes('Cannot access a chrome-extension://')) {
        console.warn(`[CDP] ${method} failed: Cannot access chrome-extension:// URL - detaching gracefully`);

        // Mark as detached to prevent further operations
        this.isDetaching = true;
        this.target = null;
        this.enabledDomains.clear();

        // Return a special error object that indicates graceful detachment
        // This allows the caller to distinguish between fatal errors and expected detachments
        const gracefulError = new Error('Tab navigated to chrome-extension:// URL (graceful detachment)');
        gracefulError.isGracefulDetachment = true;
        gracefulError.reason = 'chrome-extension-navigation';
        throw gracefulError;
      }

      // Handle about:blank#blocked and other restricted frame errors
      if (errorMessage.includes('Cannot access contents of url') ||
          errorMessage.includes('about:blank#blocked') ||
          errorMessage.includes('Extension manifest must request permission')) {
        console.warn(`[CDP] ${method} encountered restricted frame:`, errorMessage);

        // For accessibility tree requests, return a minimal valid tree
        if (method === 'Accessibility.getFullAXTree') {
          console.log('[CDP] Returning empty accessibility tree due to restricted frames');
          return { nodes: [] };
        }

        // For other operations, provide a clear error message
        throw new Error(`Page contains restricted content (iframes with about:blank#blocked or chrome:// URLs) that cannot be accessed. The main page is accessible but some frames are blocked.`);
      }

      console.error(`[CDP] ${method} failed:`, error);
      throw error;
    }
  }

  /**
   * Evaluate JavaScript in page context
   */
  /**
   * Decide how to wrap a caller's expression so its VALUE comes back.
   *
   * ⛔ SHARED BY `evaluate` AND `evaluateInFrame` ON PURPOSE. This logic lived
   * only in `evaluate` and the frame path wrapped the raw expression in an
   * async function body with no `return` — so EVERY frame-targeted evaluate
   * returned undefined, which reaches the caller as `null`. MEASURED
   * 2026-10-03 on two independent browsers (Ben's MacBook and office, both on
   * current code): frameTarget + `1+1` → null, while the same call on the main
   * frame returned 2.
   *
   * ⚠️ It was worse than one tool returning null. `querySelectorInFrame` passes
   * an IIFE through `evaluateInFrame` and treats a falsy result as "element not
   * found", so frame-scoped click / type / fill_form / query_dom could never
   * find anything either — they failed as "no such element", which looks like
   * a selector mistake rather than a transport bug.
   *
   * ⇒ Keep ONE implementation. The duplication is what let the frame path drift.
   *
   * Cases, unchanged from the original:
   *   A) caller wrote `return ...`                  → use as-is
   *   B) single statement (no `;`, no newline)      → `return (expr);`
   *   C) multi-statement that visually IS an
   *      expression, e.g. an IIFE in outer parens   → `return (\n expr \n);`
   *      (the ha-reported null-on-IIFE bug)
   *   D) anything else (declarations, bare
   *      statements)                                → as-is; caller supplies
   *                                                   its own `return`
   */
  _bodyForValue(expression) {
    const hasExplicitReturn = /^\s*return\b/.test(expression);
    const isSingleStatement = !expression.includes('\n') && !expression.includes(';');
    const trimmed = expression.trim();
    const looksLikeWrappedExpression =
      trimmed.startsWith('(') && trimmed.endsWith(')') && !hasExplicitReturn;

    if (hasExplicitReturn) return expression;
    if (isSingleStatement) return `return (${expression});`;
    if (looksLikeWrappedExpression) return `return (\n${expression}\n);`;
    return expression;
  }

  async evaluate(expression, returnByValue = true) {
    // Wrap in an async IIFE so const/let declarations are scoped (avoiding "already declared"
    // on re-runs in the shared MAIN world scope).
    // For single-line expressions (no semicolons anywhere, no newlines, no leading `return`)
    // add an explicit `return` so callers get back the value (e.g. `document.title` → "Page Title").
    // Multi-statement scripts (any `;`) and explicit-return statements are used as-is — wrapping
    // `let x = 5; x + 1` in `return (...)` would produce a SyntaxError.
    // Decide how to wrap the expression so its value comes back to the caller.
    // Three cases:
    //   A) Caller explicitly wrote `return ...`           → use as-is.
    //   B) Single-line/single-statement expression        → wrap as `return (expr);`.
    //   C) Multi-statement that visually IS an expression (an IIFE wrapped in
    //      outer parens, like `(async () => { ... })()`) → also wrap with
    //      `return (\n...\n);` so the IIFE's return value bubbles out instead
    //      of being silently discarded. This was the ha-reported null-on-IIFE
    //      bug — Promise-returning IIFEs evaluated but the outer wrapper
    //      returned undefined → caller saw `null`.
    //   D) Anything else (raw multi-statement script with `let`, declarations,
    //      bare statements)                               → use as-is; caller
    //      must include their own `return` if they want a value.
    const wrapped = `(async function() {\n${this._bodyForValue(expression)}\n})()`;
    try {
      const result = await this.sendCommand('Runtime.evaluate', {
        expression: wrapped,
        returnByValue,
        awaitPromise: true,
        userGesture: true
      });

      if (result.exceptionDetails) {
        throw new Error(`Evaluation error: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
      }

      // When returnByValue=true and the result can't be deep-cloned for
      // structured-clone transport (regex objects, functions, DOM nodes,
      // window, circular refs, etc.), CDP returns an objectId + no `value`
      // — and we used to surface that as the literal value undefined which
      // JSON-serialized to `null`. That silent loss is bug #5 from ha.
      // Now: detect the no-value-with-objectId case and throw a real error
      // that points the caller at the wrapping recipe.
      const r = result.result || {};
      if (returnByValue && r.value === undefined && r.objectId) {
        const desc = r.description || `<${r.type || 'object'}${r.subtype ? '/' + r.subtype : ''}>`;
        throw new Error(
          `Expression returned a non-serializable value (${desc}). ` +
          `Wrap it so the result is a primitive: JSON.stringify(<expr>) or (() => { const v = <expr>; return v ? String(v) : null; })().`
        );
      }
      return r.value;
    } catch (error) {
      // No longer need a separate "Illegal return statement" retry — the IIFE wrapper handles it.
      // Keep the block for any other retry-able errors below.
      // Check if this is a navigation interruption
      if (error.message && error.message.includes('Page navigation interrupted command execution')) {
        // Return a special value indicating navigation occurred
        console.log('[CDP] Evaluation interrupted by navigation - returning navigation indicator');
        return {
          __navigation_occurred: true,
          message: 'Command execution interrupted by page navigation'
        };
      }
      throw error;
    }
  }

  // ─── Frame-aware evaluation ───────────────────────────────────────────────

  /**
   * Get the frame tree for the current page.
   * Returns raw CDP { frame, childFrames } tree from Page.getFrameTree.
   */
  async getFrameTree() {
    const result = await this.sendCommand('Page.getFrameTree');
    return result.frameTree;
  }

  /**
   * Get an executionContextId scoped to a specific frame.
   * Uses Page.createIsolatedWorld which works cross-origin (CDP bypasses SOP).
   * Throws a clear error for unscriptable URLs (about:, chrome://, data:).
   *
   * @param {string} frameId  CDP frame ID from getFrameTree()
   */
  async getFrameExecutionContextId(frameId) {
    const result = await this.sendCommand('Page.createIsolatedWorld', {
      frameId,
      worldName: '__unibrowse_frame_ctx__',
      grantUniversalAccess: true,
    });
    return result.executionContextId;
  }

  /**
   * Evaluate JavaScript in a specific frame.
   * Wraps in an async IIFE (same as evaluate()) so const/let are scoped
   * and bare return statements are valid.
   *
   * @param {string} frameId  CDP frame ID from getFrameTree()
   * @param {string} expression
   * @param {boolean} returnByValue
   */
  async evaluateInFrame(frameId, expression, returnByValue = true) {
    let contextId;
    try {
      contextId = await this.getFrameExecutionContextId(frameId);
    } catch (err) {
      throw new Error(`Cannot get execution context for frame ${frameId}: ${err.message}`);
    }

    // ⛔ Same wrapping as the main frame. Passing the raw expression here is the
    // bug this fixes: no `return`, so the value was discarded and callers saw null.
    const wrapped = `(async function() {\n${this._bodyForValue(expression)}\n})()`;
    const result = await this.sendCommand('Runtime.evaluate', {
      expression: wrapped,
      contextId,
      returnByValue,
      awaitPromise: true,
      userGesture: true,
    });

    if (result.exceptionDetails) {
      throw new Error(
        `Frame evaluation error: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`
      );
    }
    return result.result.value;
  }

  /**
   * Query an element inside a frame and return its viewport-absolute bounding rect.
   * Uses DOM.getFrameOwner to find the <iframe> element in the parent, then
   * DOM.getBoxModel to get its viewport offset — works for nested iframes too.
   *
   * @param {string} frameId  CDP frame ID
   * @param {string} selector CSS selector within the frame's document
   * @returns {{ exists: boolean, tagName, id, frameId, rect: {x,y,width,height} } | null}
   */
  async querySelectorInFrame(frameId, selector) {
    // Step 1: Get element's bounding rect in frame-local coordinates
    const frameLocalInfo = await this.evaluateInFrame(frameId, `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          tagName: el.tagName.toLowerCase(),
          id: el.id || null,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      })()
    `);

    if (!frameLocalInfo) return null;

    // Step 2: Get the <iframe> element's viewport position using DOM.getFrameOwner
    // This CDP command maps a frameId → the backendNodeId of the <iframe> DOM element.
    let iframeLeft = 0, iframeTop = 0;
    try {
      const frameOwner = await this.sendCommand('DOM.getFrameOwner', { frameId });
      if (frameOwner.backendNodeId) {
        const boxModel = await this.sendCommand('DOM.getBoxModel', {
          backendNodeId: frameOwner.backendNodeId,
        });
        // content quad: [x1,y1, x2,y1, x2,y2, x1,y2]
        iframeLeft = boxModel.model.content[0];
        iframeTop  = boxModel.model.content[1];
      }
    } catch {
      // If DOM.getFrameOwner fails (e.g. root frame), offsets stay 0
    }

    return {
      exists: true,
      tagName: frameLocalInfo.tagName,
      id: frameLocalInfo.id,
      frameId,
      rect: {
        x: frameLocalInfo.rect.x + iframeLeft,
        y: frameLocalInfo.rect.y + iframeTop,
        width: frameLocalInfo.rect.width,
        height: frameLocalInfo.rect.height,
      },
    };
  }

  /**
   * Execute function in page context
   */
  async executeFunction(func, args = []) {
    const argsStr = args.map(arg => JSON.stringify(arg)).join(', ');
    const expression = `(${func.toString()})(${argsStr})`;
    return this.evaluate(expression);
  }

  /**
   * Query by accessibility nodeId and return element info
   */
  async queryByNodeId(nodeId) {
    // Get the full accessibility tree
    const tree = await this.getAccessibilityTree();

    // Find the node by nodeId
    const node = tree.nodes.find(n => n.nodeId === nodeId);
    if (!node) {
      throw new Error(`Accessibility node not found: ${nodeId}`);
    }

    // Get the backend DOM node ID
    if (!node.backendDOMNodeId) {
      throw new Error(`Node ${nodeId} does not have a DOM node reference`);
    }

    // Use DOM.getBoxModel to get the element's bounding box
    try {
      const boxModel = await this.sendCommand('DOM.getBoxModel', {
        backendNodeId: node.backendDOMNodeId
      });

      // Calculate center of content box
      const content = boxModel.model.content;
      const x = (content[0] + content[2] + content[4] + content[6]) / 4;
      const y = (content[1] + content[3] + content[5] + content[7]) / 4;
      const width = Math.max(content[2] - content[0], content[4] - content[6]);
      const height = Math.max(content[5] - content[1], content[7] - content[3]);

      return {
        exists: true,
        nodeId,
        backendDOMNodeId: node.backendDOMNodeId,
        rect: { x, y, width, height }
      };
    } catch (error) {
      console.error(`[CDP] Failed to get box model for node ${nodeId}:`, error);
      throw new Error(`Failed to get element coordinates for node ${nodeId}`);
    }
  }

  /**
   * Query DOM selector and return element info
   */
  async querySelector(selector) {
    // Check if selector is a nodeId (numeric string) or CSS selector
    if (/^\d+$/.test(selector)) {
      // It's a nodeId from accessibility tree
      return this.queryByNodeId(selector);
    }

    // It's a CSS selector
    return this.evaluate(`
      (function() {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return null;

        const rect = el.getBoundingClientRect();
        return {
          exists: true,
          tagName: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.className || undefined,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          }
        };
      })()
    `);
  }

  /**
   * Click element at coordinates
   */
  async click(x, y) {
    await this.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1
    });

    await this.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1
    });
  }

  /**
   * Drag and drop from start coordinates to end coordinates
   */
  async drag(startX, startY, endX, endY) {
    // Move to start position
    await this.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: startX,
      y: startY
    });

    // Press mouse button at start
    await this.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: startX,
      y: startY,
      button: 'left',
      clickCount: 1
    });

    // Small delay to register the press
    await new Promise(resolve => setTimeout(resolve, 50));

    // Move mouse to end position in steps for smooth drag
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const currentX = startX + (endX - startX) * (i / steps);
      const currentY = startY + (endY - startY) * (i / steps);

      await this.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: currentX,
        y: currentY,
        button: 'left'
      });

      // Small delay between moves
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    // Release mouse button at end
    await this.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: endX,
      y: endY,
      button: 'left',
      clickCount: 1
    });
  }

  /**
   * Type text
   */
  async type(text) {
    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // Check if still attached before each keystroke
      if (!this.isAttached() || this.isDetaching) {
        throw new Error(`Typing interrupted: debugger detached after ${i} characters`);
      }

      try {
        await this.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown',
          text: char
        });

        await this.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          text: char
        });

        // Small delay between keystrokes
        await new Promise(resolve => setTimeout(resolve, 10));
      } catch (error) {
        // If detached during typing, throw with context
        if (error.message && error.message.includes('Detached')) {
          throw new Error(`Typing interrupted by detachment after ${i} of ${text.length} characters`);
        }
        throw error;
      }
    }
  }

  /**
   * Press key
   */
  async pressKey(key) {
    await this.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key
    });

    await this.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key
    });
  }

  /**
   * Scroll by specific amount
   */
  async scroll(x = 0, y = 0) {
    return this.evaluate(`window.scrollBy(${x}, ${y})`, true);
  }

  /**
   * Scroll to element
   */
  async scrollToElement(selector) {
    return this.evaluate(`
      (function() {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return { success: false, error: 'Element not found' };
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { success: true };
      })()
    `, true);
  }

  /**
   * Navigate to URL
   */
  async navigate(url) {
    return this.sendCommand('Page.navigate', { url });
  }

  /**
   * Go back in history
   */
  async goBack() {
    // Get navigation history
    const history = await this.sendCommand('Page.getNavigationHistory');
    const currentIndex = history.currentIndex;

    if (currentIndex > 0) {
      const entry = history.entries[currentIndex - 1];
      return this.sendCommand('Page.navigateToHistoryEntry', { entryId: entry.id });
    }

    throw new Error('Cannot go back: at beginning of history');
  }

  /**
   * Go forward in history
   */
  async goForward() {
    const history = await this.sendCommand('Page.getNavigationHistory');
    const currentIndex = history.currentIndex;

    if (currentIndex < history.entries.length - 1) {
      const entry = history.entries[currentIndex + 1];
      return this.sendCommand('Page.navigateToHistoryEntry', { entryId: entry.id });
    }

    throw new Error('Cannot go forward: at end of history');
  }

  /**
   * Take screenshot
   */
  async captureScreenshot(format = 'png', quality = 80) {
    const result = await this.sendCommand('Page.captureScreenshot', {
      format,
      quality: format === 'jpeg' ? quality : undefined
    });

    return result.data; // Returns base64 encoded image
  }

  /**
   * Get element region for screenshot capture
   * @param {string} selector - CSS selector for the element
   * @returns {Object} Element region with {x, y, width, height, label, scrolled}
   */
  async getElementRegion(selector) {
    const scrollResult = await this.evaluate(`
      (function() {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return { found: false };

        const initialRect = element.getBoundingClientRect();
        const initiallyInView = (
          initialRect.top >= 0 &&
          initialRect.left >= 0 &&
          initialRect.bottom <= window.innerHeight &&
          initialRect.right <= window.innerWidth
        );

        if (!initiallyInView) {
          element.scrollIntoView({ behavior: "instant", block: "start", inline: "start" });
        }

        const rect = element.getBoundingClientRect();
        let label = element.id || (element.className && element.className.split(" ")[0]) || "";

        return {
          found: true,
          scrolled: !initiallyInView,
          x: Math.max(0, rect.left),
          y: Math.max(0, rect.top),
          width: Math.min(rect.width, window.innerWidth - rect.left),
          height: Math.min(rect.height, window.innerHeight - rect.top),
          label: label
        };
      })()
    `);

    if (!scrollResult.found) {
      throw new Error(`Element not found: ${selector}`);
    }
    return scrollResult;
  }

  /**
   * Capture segmented screenshots based on CSS selectors
   * @param {string[]} selectors - Array of CSS selectors
   * @param {Object} options - Options {includeLabels}
   * @returns {Array} Array of {selector, base64Data, label} or {selector, base64Data: null, label: '', error}
   */
  async captureSegmentedScreenshots(selectors, options = {}) {
    const screenshots = [];
    const { includeLabels = false } = options;

    for (const selector of selectors) {
      try {
        const region = await this.getElementRegion(selector);

        // Wait for animations to settle if we scrolled
        if (region.scrolled) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        const result = await this.sendCommand('Page.captureScreenshot', {
          format: 'png',
          clip: {
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
            scale: 1,
          },
        });

        screenshots.push({
          selector: selector,
          base64Data: result.data,
          label: includeLabels ? region.label : '',
        });
      } catch (error) {
        screenshots.push({
          selector: selector,
          base64Data: null,
          label: '',
          error: error.message,
        });
      }
    }
    return screenshots;
  }

  /**
   * Get accessibility tree
   */
  async getAccessibilityTree() {
    return this.sendCommand('Accessibility.getFullAXTree');
  }

  /**
   * Get partial accessibility tree (filtered)
   */
  async getPartialAccessibilityTree(depth = 5) {
    // Use getFullAXTree instead - getPartialAXTree requires a nodeId
    const tree = await this.sendCommand('Accessibility.getFullAXTree');
    return tree;
  }

  /**
   * Check if target is attached
   */
  isAttached() {
    return this.target !== null;
  }

  /**
   * Get current target
   */
  getTarget() {
    return this.target;
  }

  /**
   * Generate bezier curve points for natural mouse movement
   * Uses cubic bezier curve with random control points
   */
  generateBezierCurve(startX, startY, endX, endY, steps = 20) {
    const points = [];

    // Generate random control points for natural curve
    const cp1x = startX + (endX - startX) * (0.25 + Math.random() * 0.25);
    const cp1y = startY + (endY - startY) * (Math.random() * 0.5 - 0.25);
    const cp2x = startX + (endX - startX) * (0.5 + Math.random() * 0.25);
    const cp2y = startY + (endY - startY) * (0.5 + Math.random() * 0.5);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const invT = 1 - t;

      // Cubic bezier formula
      const x = Math.pow(invT, 3) * startX +
                3 * Math.pow(invT, 2) * t * cp1x +
                3 * invT * Math.pow(t, 2) * cp2x +
                Math.pow(t, 3) * endX;

      const y = Math.pow(invT, 3) * startY +
                3 * Math.pow(invT, 2) * t * cp1y +
                3 * invT * Math.pow(t, 2) * cp2y +
                Math.pow(t, 3) * endY;

      points.push({ x: Math.round(x), y: Math.round(y) });
    }

    return points;
  }

  /**
   * Move mouse along natural bezier curve path
   * @param {number} targetX - Destination X coordinate
   * @param {number} targetY - Destination Y coordinate
   * @param {object} options - Movement options
   * @param {number} options.duration - Movement duration in ms (default: 500)
   * @param {number} options.currentX - Current mouse X position (default: 0)
   * @param {number} options.currentY - Current mouse Y position (default: 0)
   * @param {number} options.steps - Number of movement steps (default: 20)
   */
  async moveMouseRealistic(targetX, targetY, options = {}) {
    const {
      duration = 500,
      currentX = 0,
      currentY = 0,
      steps = 5,
    } = options;

    // Page.bringToFront ensures CDP Input.dispatchMouseEvent lands on THIS tab
    // even if another window/tab currently has OS focus (common when running
    // a chromium-host sidecar chromium under Xvfb — its windows may not have
    // focus relative to the host's main display). Without this, Input events
    // observed leaking to a different focused tab. Best-effort: don't fail
    // the whole move if bringToFront errors (some targets don't support it).
    try { await this.sendCommand('Page.bringToFront', {}); } catch { /* best-effort */ }

    const points = this.generateBezierCurve(currentX, currentY, targetX, targetY, steps);
    const delayPerStep = duration / steps;

    for (const point of points) {
      if (!this.isAttached() || this.isDetaching) {
        throw new Error('Mouse movement interrupted: debugger detached');
      }

      await this.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y
      });

      // Variable delay with slight randomness for human-like behavior
      const randomDelay = delayPerStep * (0.8 + Math.random() * 0.4);
      await new Promise(resolve => setTimeout(resolve, randomDelay));
    }

    return { x: targetX, y: targetY };
  }

  /**
   * Perform realistic click with human-like timing
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {object} options - Click options
   * @param {string} options.button - Mouse button ('left', 'right', 'middle')
   * @param {number} options.clickCount - Number of clicks (1 = single, 2 = double)
   * @param {number} options.downDelay - Delay between press and release in ms (default: 50-100 random)
   * @param {boolean} options.moveFirst - Whether to move mouse to position first (default: true)
   * @param {number} options.moveDuration - Duration of mouse movement in ms (default: 300)
   */
  async clickRealistic(x, y, options = {}) {
    const {
      button = 'left',
      clickCount = 1,
      downDelay = 50 + Math.random() * 50,
      // Default flipped to false — the 20-step bezier loop hangs in
      // chromium-host sidecar chromiums under Xvfb, with each Input.dispatchMouseEvent
      // serializing through the debugger session and the cumulative latency
      // exceeding the WebSocket response timeout (30s). Callers that want a
      // human-like move-then-click can pass `moveFirst: true` explicitly, OR
      // call `browser_realistic_mouse_move` separately first. For 99% of
      // click-the-button workflows, the move was decoration anyway — what
      // matters is the actual OS-level press/release pair landing on the
      // target coordinates.
      moveFirst = false,
      moveDuration = 300,
      currentX = 0,
      currentY = 0
    } = options;

    // Page.bringToFront — see moveMouseRealistic above. CDP Input.dispatchMouseEvent
    // dispatches to whichever tab currently has OS focus, NOT the tab whose
    // debugger session we're calling through (verified 2026-06-03 by scripts
    // session during the office→admin OAuth swap — clicks were landing on
    // ben's main Chrome's focused tab instead of the sidecar chromium's
    // unfocused tab). bringToFront takes the debugger-attached tab to
    // foreground, making subsequent Input commands land on it.
    try { await this.sendCommand('Page.bringToFront', {}); } catch { /* best-effort */ }

    // Move mouse to position first if requested
    if (moveFirst) {
      await this.moveMouseRealistic(x, y, {
        duration: moveDuration,
        currentX,
        currentY
      });
      // Small pause before clicking (human reaction time)
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
    }

    // Perform click(s)
    for (let i = 0; i < clickCount; i++) {
      await this.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button,
        // ⛔ `buttons` IS NOT OPTIONAL AND IT IS NOT THE SAME FIELD AS `button`.
        // `button` names which button this event is about; `buttons` is the
        // BITMASK of what is currently held (1 = left). Omit it and CDP sends
        // the bitmask as 0, so the page sees a pointerdown reporting that no
        // button is down. Real hardware cannot produce that, and a press-and-
        // hold widget reading `e.buttons` during the hold sees the press end
        // immediately. Nothing errors: the click still "works" for ordinary
        // targets, which is why this survived.
        buttons: 1,
        // ⛔ `force` IS THE POINTER EVENT'S `pressure`, AND WITHOUT IT WE SEND A
        // PHYSICALLY IMPOSSIBLE EVENT. The Pointer Events spec requires a mouse
        // to report pressure 0.5 while a button is down, 0 when it is not. CDP
        // defaults force to 0, so every press we have ever sent arrived as a
        // pointerdown claiming ZERO pressure — which no hardware can produce,
        // and which any page can read with one event listener.
        //
        // MEASURED 2026-10-09, same page, same coordinates, a minute apart:
        // XTEST (a real X pointer) gave pressure 0.5, CDP gave 0. Every other
        // field matched exactly — clientX/Y, screenX/Y, buttons, isTrusted,
        // pointerType, pointerId, width, height, isPrimary, tilt, twist.
        //
        // ⚠️ Same family as the `buttons` bug above, and found the same way:
        // by comparing our event against a real one field by field, rather than
        // by checking whether the click worked. It always worked.
        force: 0.5,
        clickCount: i + 1
      });

      // ── THE HOLD IS SCORED ON WHAT THE POINTER DOES DURING IT ──────────
      //
      // A press-and-hold widget samples the pointer while the button is down —
      // in a requestAnimationFrame loop, so at display rate — and judges the
      // MANNER of the hold, not its duration. Two things give a script away
      // there, and the first version of this code had both:
      //
      //   ⛔ REGULAR SAMPLING. Emitting on a 90-200ms timer produces events at
      //      5-11Hz when a real pointer reports at 60Hz+. The gaps alone are a
      //      signature, whatever the coordinates say.
      //   ⛔ UNIFORM INDEPENDENT NOISE. ±2px drawn afresh each tick is white
      //      noise: every sample is independent of the last, so the pointer
      //      teleports about a fixed centre. A real hand DRIFTS — consecutive
      //      positions are strongly correlated, velocity changes smoothly, and
      //      the centre itself wanders. White noise and drift are trivially
      //      separable by anything looking at the autocorrelation.
      //
      // So: sample near display rate, and move by an Ornstein-Uhlenbeck drift —
      // velocity carries over, is damped toward zero, and gets a small random
      // impulse each step, with a weak pull back toward the press point. That
      // produces correlated, smoothly-varying motion of a few pixels rather
      // than independent jumps.
      //
      // ⚠️ MEASURED COST: ~16ms sampling over a 6s hold is ~375 serialized CDP
      // commands. In-container that is well inside the 30s WebSocket timeout,
      // but it is the same budget that forced moveFirst:false (a 20-step bezier
      // in one call once blew it on an Xvfb sidecar). The loop is bounded by
      // WALL CLOCK, not by a sample count, so a slow link emits fewer samples
      // rather than overrunning the hold.
      //
      // ⛔ THIS IS NOT KNOWN TO DEFEAT ANYTHING. Measured 2026-10-09: Fiverr's
      // PerimeterX challenge still refused a hold with correct pressure. This
      // removes two signatures that research says such widgets look at; whether
      // they are the ones deciding is unproven.
      if (downDelay > 400) {
        const until = Date.now() + downDelay;
        const SAMPLE_MS = 16;
        let vx = 0, vy = 0, dx = 0, dy = 0;
        while (Date.now() < until) {
          const remaining = until - Date.now();
          if (remaining <= 0) break;
          await new Promise(resolve => setTimeout(resolve, Math.min(SAMPLE_MS, remaining)));
          if (Date.now() >= until) break;
          // Damped velocity + random impulse + weak restoring pull. The
          // constants are small on purpose: a hand holding a button wanders a
          // couple of pixels, it does not wander off the control.
          vx = vx * 0.86 + (Math.random() * 2 - 1) * 0.22 - dx * 0.04;
          vy = vy * 0.86 + (Math.random() * 2 - 1) * 0.22 - dy * 0.04;
          dx += vx;
          dy += vy;
          await this.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: x + Math.round(dx),
            y: y + Math.round(dy),
            button,
            buttons: 1,
            // The button is down for the whole hold, so pressure stays 0.5
            // across the movement — dropping to 0 mid-hold would read as a
            // release followed by a fresh press.
            force: 0.5
          });
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, downDelay));
      }

      await this.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button,
        // Nothing is held any more once this event lands, so both the bitmask
        // and the pressure go to zero — which is what a real release reports.
        buttons: 0,
        force: 0,
        clickCount: i + 1
      });

      // Delay between multiple clicks (for double-click)
      if (i < clickCount - 1) {
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 50));
      }
    }
  }

  /**
   * Type text with realistic human-like timing
   * @param {string} text - Text to type
   * @param {object} options - Typing options
   * @param {number} options.minDelay - Minimum delay between keystrokes in ms (default: 50)
   * @param {number} options.maxDelay - Maximum delay between keystrokes in ms (default: 150)
   * @param {number} options.mistakeChance - Chance of making a typo (0-1, default: 0)
   * @param {boolean} options.pressEnter - Whether to press Enter after typing (default: false)
   */
  async typeRealistic(text, options = {}) {
    const {
      minDelay = 50,
      maxDelay = 150,
      mistakeChance = 0,
      pressEnter = false
    } = options;

    for (let i = 0; i < text.length; i++) {
      if (!this.isAttached() || this.isDetaching) {
        throw new Error(`Typing interrupted: debugger detached after ${i} characters`);
      }

      const char = text[i];

      // Occasionally make a typo and correct it
      if (mistakeChance > 0 && Math.random() < mistakeChance) {
        // Type a random wrong character
        const wrongChar = String.fromCharCode(97 + Math.floor(Math.random() * 26));
        await this._typeChar(wrongChar);
        await new Promise(resolve => setTimeout(resolve, minDelay + Math.random() * (maxDelay - minDelay)));

        // Backspace to delete it
        await this.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Backspace',
          code: 'Backspace',
          windowsVirtualKeyCode: 8
        });
        await this.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Backspace',
          code: 'Backspace',
          windowsVirtualKeyCode: 8
        });
        await new Promise(resolve => setTimeout(resolve, minDelay + Math.random() * (maxDelay - minDelay)));
      }

      // Type the actual character
      await this._typeChar(char);

      // Variable delay between keystrokes
      const delay = minDelay + Math.random() * (maxDelay - minDelay);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Press Enter if requested
    if (pressEnter) {
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));
      await this.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13
      });
      await this.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13
      });
    }
  }

  /**
   * Helper to type a single character
   */
  async _typeChar(char) {
    await this.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      text: char
    });
    await this.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      text: char
    });
  }
}

// Export for use in background.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CDPHelper;
}
