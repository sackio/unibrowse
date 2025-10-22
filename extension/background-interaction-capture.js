/**
 * Background Interaction Capture
 * Lightweight passive script that captures all user interactions
 * and sends them to the background recorder
 */

// Prevent multiple injections
if (!window.backgroundInteractionCapture) {
  class BackgroundInteractionCapture {
    constructor() {
      this.captureStartTime = Date.now();
      this.extensionInvalidated = false;
      this.setupListeners();
      console.log('[BackgroundCapture] Started capturing interactions');
    }

    /**
     * Capture element context for an interaction
     */
    captureElementContext(element) {
      if (!element) return null;

      try {
        // Generate unique selector
        const selector = this.generateSelector(element);

        return {
          tagName: element.tagName,
          id: element.id || null,
          className: element.className || null,
          text: element.textContent?.substring(0, 100) || null,
          selector,
          attributes: {
            type: element.getAttribute('type'),
            name: element.getAttribute('name'),
            placeholder: element.getAttribute('placeholder'),
            value: element.value || null,
          }
        };
      } catch (e) {
        return {
          tagName: element.tagName,
          error: e.message
        };
      }
    }

    /**
     * Generate CSS selector for an element
     */
    generateSelector(element) {
      if (!element || element === document) return 'document';
      if (element === document.body) return 'body';

      const path = [];
      while (element && element.nodeType === Node.ELEMENT_NODE) {
        let selector = element.tagName.toLowerCase();

        if (element.id) {
          selector += `#${element.id}`;
          path.unshift(selector);
          break;
        } else {
          let sibling = element;
          let nth = 1;
          while (sibling.previousElementSibling) {
            sibling = sibling.previousElementSibling;
            if (sibling.tagName === element.tagName) nth++;
          }
          if (nth > 1) selector += `:nth-of-type(${nth})`;
        }

        path.unshift(selector);
        element = element.parentElement;
      }

      return path.join(' > ');
    }

    /**
     * Send interaction to background
     */
    sendInteraction(type, data = {}) {
      // Stop sending if extension is invalidated
      if (this.extensionInvalidated) {
        return;
      }

      // Check if runtime is still valid
      if (!chrome.runtime?.id) {
        this.extensionInvalidated = true;
        console.log('[BackgroundCapture] Extension context invalidated, stopping capture');
        return;
      }

      const interaction = {
        type,
        timestamp: Date.now(),
        url: window.location.href,
        ...data
      };

      try {
        chrome.runtime.sendMessage({
          type: 'BACKGROUND_INTERACTION',
          interaction
        }).catch(err => {
          // Filter out benign "message channel closed" errors
          // This happens when the background script doesn't send a response (which is intentional)
          if (err.message?.includes('message channel closed')) {
            // This is expected - background script doesn't respond to these messages
            return;
          }

          // Handle extension reload/disconnect
          if (err.message?.includes('Extension context invalidated')) {
            this.extensionInvalidated = true;
            console.log('[BackgroundCapture] Extension reloaded, stopping capture');
          } else if (err.message?.includes('Receiving end does not exist')) {
            // Extension disconnected - stop sending
            this.extensionInvalidated = true;
            console.log('[BackgroundCapture] Extension disconnected, stopping capture');
          } else {
            console.error('[BackgroundCapture] Failed to send interaction:', err);
          }
        });
      } catch (err) {
        // Synchronous error - extension likely invalidated
        if (err.message?.includes('Extension context invalidated') ||
            err.message?.includes('context was destroyed') ||
            err.message?.includes('message channel closed')) {
          this.extensionInvalidated = true;
        }
      }
    }

    /**
     * Setup event listeners for all interaction types
     */
    setupListeners() {
      // Click events
      document.addEventListener('click', (e) => {
        this.sendInteraction('click', {
          element: this.captureElementContext(e.target),
          x: e.clientX,
          y: e.clientY,
          button: e.button,
        });
      }, true);

      // Double click
      document.addEventListener('dblclick', (e) => {
        this.sendInteraction('doubleclick', {
          element: this.captureElementContext(e.target),
          x: e.clientX,
          y: e.clientY,
        });
      }, true);

      // Right click
      document.addEventListener('contextmenu', (e) => {
        this.sendInteraction('contextmenu', {
          element: this.captureElementContext(e.target),
          x: e.clientX,
          y: e.clientY,
        });
      }, true);

      // Keyboard input
      document.addEventListener('keydown', (e) => {
        // Don't record every keystroke, only meaningful keys
        if (e.key.length === 1 || ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete'].includes(e.key)) {
          this.sendInteraction('keydown', {
            key: e.key,
            element: this.captureElementContext(e.target),
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
          });
        }
      }, true);

      // Form inputs (debounced)
      let inputTimeout;
      document.addEventListener('input', (e) => {
        clearTimeout(inputTimeout);
        inputTimeout = setTimeout(() => {
          this.sendInteraction('input', {
            element: this.captureElementContext(e.target),
            value: e.target.value?.substring(0, 100), // Limit value length
          });
        }, 500); // Debounce 500ms
      }, true);

      // Form submission
      document.addEventListener('submit', (e) => {
        this.sendInteraction('submit', {
          element: this.captureElementContext(e.target),
        });
      }, true);

      // Select changes
      document.addEventListener('change', (e) => {
        if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox' || e.target.type === 'radio') {
          this.sendInteraction('change', {
            element: this.captureElementContext(e.target),
            value: e.target.value,
            checked: e.target.checked,
          });
        }
      }, true);

      // Scrolling (debounced)
      let scrollTimeout;
      window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          this.sendInteraction('scroll', {
            scrollX: window.scrollX,
            scrollY: window.scrollY,
          });
        }, 300); // Debounce 300ms
      }, true);

      // Mouse movement (heavily debounced)
      let mouseMoveTimeout;
      document.addEventListener('mousemove', (e) => {
        clearTimeout(mouseMoveTimeout);
        mouseMoveTimeout = setTimeout(() => {
          const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
          this.sendInteraction('mousemove', {
            x: e.clientX,
            y: e.clientY,
            pageX: e.pageX,
            pageY: e.pageY,
            elementUnder: elementUnder ? this.captureElementContext(elementUnder) : null,
          });
        }, 300); // Debounce 300ms
      }, true);

      // Focus/Blur
      document.addEventListener('focus', (e) => {
        this.sendInteraction('focus', {
          element: this.captureElementContext(e.target),
        });
      }, true);

      document.addEventListener('blur', (e) => {
        this.sendInteraction('blur', {
          element: this.captureElementContext(e.target),
        });
      }, true);

      // Drag and drop
      document.addEventListener('dragstart', (e) => {
        this.sendInteraction('dragstart', {
          element: this.captureElementContext(e.target),
        });
      }, true);

      document.addEventListener('drop', (e) => {
        this.sendInteraction('drop', {
          element: this.captureElementContext(e.target),
        });
      }, true);

      // File upload
      document.addEventListener('change', (e) => {
        if (e.target.type === 'file' && e.target.files.length > 0) {
          this.sendInteraction('fileupload', {
            element: this.captureElementContext(e.target),
            fileCount: e.target.files.length,
            fileNames: Array.from(e.target.files).map(f => f.name),
          });
        }
      }, true);

      // Copy/Paste/Cut
      document.addEventListener('copy', () => {
        this.sendInteraction('copy', {});
      }, true);

      document.addEventListener('paste', () => {
        this.sendInteraction('paste', {});
      }, true);

      document.addEventListener('cut', () => {
        this.sendInteraction('cut', {});
      }, true);

      // Navigation (page visibility)
      document.addEventListener('visibilitychange', () => {
        this.sendInteraction('visibilitychange', {
          visible: !document.hidden,
        });
      });

      // Page load complete
      if (document.readyState === 'complete') {
        this.sendInteraction('pageload', {
          url: window.location.href,
        });
      } else {
        window.addEventListener('load', () => {
          this.sendInteraction('pageload', {
            url: window.location.href,
          });
        });
      }

      // Before unload
      window.addEventListener('beforeunload', () => {
        this.sendInteraction('navigation', {
          from: window.location.href,
        });
      });
    }
  }

  // Create instance
  window.backgroundInteractionCapture = new BackgroundInteractionCapture();
}
