/**
 * Browser MCP Utility Macros Library
 *
 * Comprehensive collection of utility macros for efficient page exploration
 * and interaction without relying on heavy snapshot operations.
 *
 * Usage: Import these macros into Browser MCP using browser_store_macro
 */

// ============================================================================
// TIER 1: MOST USEFUL MACROS
// ============================================================================

/**
 * Get Interactive Elements
 * Returns all interactive elements (buttons, links, inputs) with minimal info
 */
const getInteractiveElements = {
  site: "*",
  category: "exploration",
  name: "get_interactive_elements",
  description: "Get all interactive elements (buttons, links, inputs, selects) on the page with minimal token usage",
  parameters: {
    limit: {
      type: "number",
      description: "Maximum number of elements to return (default: 50)",
      required: false,
      default: 50
    },
    includeHidden: {
      type: "boolean",
      description: "Include hidden elements (default: false)",
      required: false,
      default: false
    }
  },
  code: `(params) => {
    const { limit = 50, includeHidden = false } = params;
    const elements = [];

    // Helper to check if element is visible
    const isVisible = (el) => {
      if (includeHidden) return true;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' &&
             style.visibility !== 'hidden' &&
             style.opacity !== '0' &&
             el.offsetParent !== null;
    };

    // Helper to get best selector
    const getSelector = (el) => {
      if (el.id) return '#' + el.id;
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\\s+/).slice(0, 2).join('.');
        if (classes) return el.tagName.toLowerCase() + '.' + classes;
      }
      return el.tagName.toLowerCase();
    };

    // Buttons
    document.querySelectorAll('button').forEach(btn => {
      if (isVisible(btn) && elements.length < limit) {
        elements.push({
          type: 'button',
          text: btn.textContent.trim().substring(0, 50),
          selector: getSelector(btn),
          disabled: btn.disabled,
          ariaLabel: btn.getAttribute('aria-label')
        });
      }
    });

    // Links
    document.querySelectorAll('a[href]').forEach(link => {
      if (isVisible(link) && elements.length < limit) {
        elements.push({
          type: 'link',
          text: link.textContent.trim().substring(0, 50),
          href: link.href,
          selector: getSelector(link),
          opensNewTab: link.target === '_blank'
        });
      }
    });

    // Input fields
    document.querySelectorAll('input, textarea').forEach(input => {
      if (isVisible(input) && elements.length < limit) {
        const label = input.labels?.[0]?.textContent.trim() ||
                     input.placeholder ||
                     input.name ||
                     input.id;
        elements.push({
          type: 'input',
          inputType: input.type || 'textarea',
          label: label?.substring(0, 50),
          name: input.name,
          value: input.value ? '(has value)' : '',
          required: input.required,
          selector: getSelector(input)
        });
      }
    });

    // Select dropdowns
    document.querySelectorAll('select').forEach(select => {
      if (isVisible(select) && elements.length < limit) {
        const label = select.labels?.[0]?.textContent.trim() ||
                     select.name ||
                     select.id;
        elements.push({
          type: 'select',
          label: label?.substring(0, 50),
          name: select.name,
          optionsCount: select.options.length,
          selectedValue: select.value,
          selector: getSelector(select)
        });
      }
    });

    return {
      count: elements.length,
      elements: elements,
      truncated: elements.length >= limit
    };
  }`,
  returnType: "Object with count, elements array, and truncated flag",
  reliability: "high",
  tags: ["exploration", "navigation", "interactive"]
};

/**
 * Discover Forms
 * Returns all forms with their fields grouped
 */
const discoverForms = {
  site: "*",
  category: "exploration",
  name: "discover_forms",
  description: "Discover all forms on the page with their fields, actions, and submit buttons",
  parameters: {},
  code: `(params) => {
    const forms = [];

    document.querySelectorAll('form').forEach((form, idx) => {
      const fields = [];

      // Get all inputs in this form
      form.querySelectorAll('input, textarea, select').forEach(field => {
        const label = field.labels?.[0]?.textContent.trim() ||
                     field.placeholder ||
                     field.getAttribute('aria-label') ||
                     field.name ||
                     field.id ||
                     'unlabeled';

        const fieldInfo = {
          type: field.type || field.tagName.toLowerCase(),
          name: field.name,
          label: label.substring(0, 50),
          required: field.required,
          value: field.value ? '(has value)' : '',
          disabled: field.disabled
        };

        if (field.tagName === 'SELECT') {
          fieldInfo.optionsCount = field.options.length;
        }

        fields.push(fieldInfo);
      });

      // Find submit button
      const submitBtn = form.querySelector('[type="submit"], button:not([type="button"])');

      forms.push({
        formId: form.id || \`form-\${idx}\`,
        name: form.name,
        action: form.action || '(current page)',
        method: form.method || 'get',
        fieldCount: fields.length,
        fields: fields,
        submitButton: submitBtn?.textContent.trim() || 'Submit'
      });
    });

    return {
      formCount: forms.length,
      forms: forms
    };
  }`,
  returnType: "Object with formCount and forms array",
  reliability: "high",
  tags: ["forms", "exploration", "automation"]
};

/**
 * Detect Messages
 * Find all errors, warnings, alerts on page
 */
const detectMessages = {
  site: "*",
  category: "exploration",
  name: "detect_messages",
  description: "Detect all error, warning, success, and info messages on the page",
  parameters: {},
  code: `(params) => {
    const messages = {
      errors: [],
      warnings: [],
      successes: [],
      info: [],
      total: 0
    };

    // Common error/warning/success patterns
    const patterns = {
      error: ['error', 'danger', 'alert-danger', 'alert-error', 'invalid', 'failure'],
      warning: ['warning', 'alert-warning', 'caution'],
      success: ['success', 'alert-success', 'confirmation', 'confirmed'],
      info: ['info', 'alert-info', 'notice', 'notification']
    };

    // Check elements with common message classes
    document.querySelectorAll('[class*="alert"], [class*="message"], [class*="error"], [class*="warning"], [class*="success"], [role="alert"], [role="status"]').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      const text = el.textContent.trim();
      if (!text || text.length < 2) return;

      const className = el.className.toLowerCase();
      const role = el.getAttribute('role');

      const message = {
        text: text.substring(0, 100),
        location: el.getBoundingClientRect().top < window.innerHeight ? 'visible' : 'below fold',
        dismissible: !!el.querySelector('[aria-label*="close" i], .close, [data-dismiss]')
      };

      // Categorize message
      let categorized = false;
      for (const [type, keywords] of Object.entries(patterns)) {
        if (keywords.some(kw => className.includes(kw)) || role === type) {
          messages[type + 's'].push(message);
          messages.total++;
          categorized = true;
          break;
        }
      }

      if (!categorized && role === 'alert') {
        messages.info.push(message);
        messages.total++;
      }
    });

    return messages;
  }`,
  returnType: "Object with errors, warnings, successes, info arrays and total count",
  reliability: "high",
  tags: ["exploration", "debugging", "validation"]
};

/**
 * Find Element by Description
 * Find elements using natural language description
 */
const findElementByDescription = {
  site: "*",
  category: "util",
  name: "find_element_by_description",
  description: "Find elements using natural language description (e.g., 'the blue submit button')",
  parameters: {
    description: {
      type: "string",
      description: "Natural language description of the element to find",
      required: true
    }
  },
  code: `(params) => {
    const { description } = params;
    const desc = description.toLowerCase();
    const matches = [];

    // Extract keywords
    const words = desc.split(/\\s+/);
    const colors = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'black', 'white', 'gray'];
    const types = ['button', 'link', 'input', 'field', 'select', 'dropdown', 'checkbox', 'radio'];

    // Determine element type
    let targetType = types.find(t => desc.includes(t)) || 'any';
    let searchText = words.filter(w => !types.includes(w) && !colors.includes(w)).join(' ');

    // Build selector based on type
    let selector = '*';
    if (targetType === 'button') selector = 'button, [type="button"], [type="submit"], [role="button"]';
    else if (targetType === 'link') selector = 'a[href]';
    else if (targetType === 'input' || targetType === 'field') selector = 'input, textarea';
    else if (targetType === 'select' || targetType === 'dropdown') selector = 'select';
    else if (targetType === 'checkbox') selector = 'input[type="checkbox"]';
    else if (targetType === 'radio') selector = 'input[type="radio"]';

    document.querySelectorAll(selector).forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      let score = 0;
      const text = el.textContent.trim().toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = (el.placeholder || '').toLowerCase();

      // Score based on text match
      if (searchText && (text.includes(searchText) || ariaLabel.includes(searchText) || placeholder.includes(searchText))) {
        score += 10;
      }

      // Score based on color match
      const color = colors.find(c => desc.includes(c));
      if (color && (style.backgroundColor.includes(color) || style.color.includes(color) || el.className.includes(color))) {
        score += 5;
      }

      // Score based on attributes
      words.forEach(word => {
        if (el.className.toLowerCase().includes(word)) score += 2;
        if (el.id.toLowerCase().includes(word)) score += 3;
      });

      if (score > 0) {
        matches.push({
          score: score,
          element: el,
          text: text.substring(0, 50),
          selector: el.id ? '#' + el.id : el.className ? el.tagName.toLowerCase() + '.' + el.className.split(' ')[0] : el.tagName.toLowerCase()
        });
      }
    });

    // Sort by score
    matches.sort((a, b) => b.score - a.score);

    if (matches.length === 0) {
      return { found: false, message: 'No matching elements found' };
    }

    const best = matches[0];
    return {
      found: true,
      text: best.text,
      selector: best.selector,
      confidence: best.score > 10 ? 'high' : best.score > 5 ? 'medium' : 'low',
      alternativeCount: matches.length - 1
    };
  }`,
  returnType: "Object with found flag, text, selector, confidence level",
  reliability: "medium",
  tags: ["search", "exploration", "util"]
};

// ============================================================================
// TIER 2: HIGH VALUE MACROS
// ============================================================================

/**
 * Extract Table Data
 * Extract structured data from HTML tables
 */
const extractTableData = {
  site: "*",
  category: "extraction",
  name: "extract_table_data",
  description: "Extract structured data from HTML tables",
  parameters: {
    selector: {
      type: "string",
      description: "CSS selector for specific table (optional, uses first table if not specified)",
      required: false
    },
    maxRows: {
      type: "number",
      description: "Maximum number of rows to return (default: 100)",
      required: false,
      default: 100
    }
  },
  code: `(params) => {
    const { selector, maxRows = 100 } = params;
    const table = selector ? document.querySelector(selector) : document.querySelector('table');

    if (!table) {
      return { found: false, message: 'No table found' };
    }

    const headers = [];
    const rows = [];

    // Extract headers
    const headerCells = table.querySelectorAll('thead th, thead td, tr:first-child th');
    if (headerCells.length > 0) {
      headerCells.forEach(cell => headers.push(cell.textContent.trim()));
    } else {
      // Try first row as headers
      const firstRow = table.querySelector('tr');
      if (firstRow) {
        firstRow.querySelectorAll('td, th').forEach(cell => headers.push(cell.textContent.trim()));
      }
    }

    // Extract data rows
    const dataRows = table.querySelectorAll('tbody tr, tr');
    dataRows.forEach((row, idx) => {
      if (idx === 0 && headerCells.length === 0) return; // Skip if first row was used as headers
      if (rows.length >= maxRows) return;

      const rowData = [];
      row.querySelectorAll('td, th').forEach(cell => {
        rowData.push(cell.textContent.trim());
      });

      if (rowData.length > 0) {
        rows.push(rowData);
      }
    });

    return {
      found: true,
      headers: headers,
      rows: rows,
      rowCount: rows.length,
      columnCount: headers.length,
      truncated: rows.length >= maxRows
    };
  }`,
  returnType: "Object with headers, rows array, counts, and truncated flag",
  reliability: "high",
  tags: ["extraction", "data", "tables"]
};

/**
 * Get Form State
 * Check which form fields are filled and form completion status
 */
const getFormState = {
  site: "*",
  category: "exploration",
  name: "get_form_state",
  description: "Get current state of a form including which fields are filled",
  parameters: {
    formSelector: {
      type: "string",
      description: "CSS selector for the form (optional, uses first form if not specified)",
      required: false
    }
  },
  code: `(params) => {
    const { formSelector } = params;
    const form = formSelector ? document.querySelector(formSelector) : document.querySelector('form');

    if (!form) {
      return { found: false, message: 'No form found' };
    }

    const fields = [];
    let totalFields = 0;
    let filledFields = 0;
    let requiredFields = 0;
    let filledRequiredFields = 0;

    form.querySelectorAll('input, textarea, select').forEach(field => {
      // Skip hidden and submit buttons
      if (field.type === 'hidden' || field.type === 'submit' || field.type === 'button') return;

      totalFields++;
      const isFilled = field.value && field.value.trim().length > 0;
      if (isFilled) filledFields++;

      if (field.required) {
        requiredFields++;
        if (isFilled) filledRequiredFields++;
      }

      const label = field.labels?.[0]?.textContent.trim() ||
                   field.placeholder ||
                   field.name ||
                   field.id ||
                   'unlabeled';

      fields.push({
        name: field.name || field.id,
        label: label.substring(0, 50),
        type: field.type || field.tagName.toLowerCase(),
        filled: isFilled,
        value: isFilled ? '(has value)' : '',
        required: field.required,
        valid: field.checkValidity ? field.checkValidity() : true
      });
    });

    const readyToSubmit = requiredFields === 0 || filledRequiredFields === requiredFields;

    return {
      found: true,
      totalFields: totalFields,
      filledFields: filledFields,
      emptyFields: totalFields - filledFields,
      requiredFields: requiredFields,
      filledRequiredFields: filledRequiredFields,
      completionPercentage: totalFields > 0 ? Math.round((filledFields / totalFields) * 100) : 0,
      readyToSubmit: readyToSubmit,
      fields: fields
    };
  }`,
  returnType: "Object with field counts, completion percentage, and field details",
  reliability: "high",
  tags: ["forms", "validation", "exploration"]
};

/**
 * Detect Modals
 * Detect and describe modals/dialogs on the page
 */
const detectModals = {
  site: "*",
  category: "exploration",
  name: "detect_modals",
  description: "Detect and describe modal dialogs, popups, and overlays on the page",
  parameters: {},
  code: `(params) => {
    const modals = [];

    // Common modal selectors
    const modalSelectors = [
      '[role="dialog"]',
      '[role="alertdialog"]',
      '.modal.show',
      '.modal.active',
      '.popup.active',
      '.overlay.active',
      '[aria-modal="true"]'
    ];

    modalSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(modal => {
        const style = window.getComputedStyle(modal);
        if (style.display === 'none' || style.visibility === 'hidden') return;

        // Get modal heading
        const heading = modal.querySelector('h1, h2, h3, [role="heading"]')?.textContent.trim() ||
                       modal.querySelector('.modal-title, .dialog-title')?.textContent.trim() ||
                       'No heading';

        // Get buttons
        const buttons = [];
        modal.querySelectorAll('button, [role="button"]').forEach(btn => {
          const text = btn.textContent.trim();
          if (text) buttons.push(text);
        });

        // Check if closeable
        const hasCloseButton = !!modal.querySelector('[aria-label*="close" i], .close, [data-dismiss]');

        // Determine type
        let type = 'generic';
        const text = modal.textContent.toLowerCase();
        if (text.includes('cookie')) type = 'cookie_consent';
        else if (text.includes('newsletter') || text.includes('email') || text.includes('subscribe')) type = 'newsletter';
        else if (text.includes('age') || text.includes('18+')) type = 'age_verification';
        else if (text.includes('location') || text.includes('region')) type = 'location';

        modals.push({
          type: type,
          heading: heading.substring(0, 100),
          buttons: buttons,
          buttonCount: buttons.length,
          closeable: hasCloseButton,
          ariaLabel: modal.getAttribute('aria-label')
        });
      });
    });

    return {
      hasModal: modals.length > 0,
      modalCount: modals.length,
      modals: modals
    };
  }`,
  returnType: "Object with hasModal flag, count, and modals array with details",
  reliability: "high",
  tags: ["exploration", "modals", "popups"]
};

/**
 * Check Visibility Batch
 * Check visibility of multiple elements at once
 */
const checkVisibilityBatch = {
  site: "*",
  category: "util",
  name: "check_visibility_batch",
  description: "Check visibility status of multiple elements at once",
  parameters: {
    selectors: {
      type: "array",
      description: "Array of CSS selectors to check",
      required: true
    }
  },
  code: `(params) => {
    const { selectors } = params;
    const results = [];

    selectors.forEach(selector => {
      const element = document.querySelector(selector);

      if (!element) {
        results.push({
          selector: selector,
          exists: false,
          visible: false,
          inViewport: false
        });
        return;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      const isVisible = style.display !== 'none' &&
                       style.visibility !== 'hidden' &&
                       style.opacity !== '0' &&
                       element.offsetParent !== null;

      const inViewport = rect.top >= 0 &&
                        rect.left >= 0 &&
                        rect.bottom <= window.innerHeight &&
                        rect.right <= window.innerWidth;

      results.push({
        selector: selector,
        exists: true,
        visible: isVisible,
        inViewport: inViewport,
        dimensions: { width: rect.width, height: rect.height }
      });
    });

    return {
      checked: selectors.length,
      results: results
    };
  }`,
  returnType: "Object with checked count and results array",
  reliability: "high",
  tags: ["util", "visibility", "testing"]
};

// ============================================================================
// TIER 3: NAVIGATION AND CONTENT MACROS
// ============================================================================

/**
 * Smart Wait Helper
 * Wait for elements to appear or conditions to be met
 */
const smartWaitHelper = {
  site: "*",
  category: "util",
  name: "smart_wait_helper",
  description: "Wait for elements to appear, disappear, or conditions to be met",
  parameters: {
    condition: {
      type: "string",
      description: "Condition to wait for: 'appear', 'disappear', 'count', or 'text'",
      required: true
    },
    selector: {
      type: "string",
      description: "CSS selector for element(s) to watch",
      required: true
    },
    expectedValue: {
      type: "string",
      description: "Expected value for text or count conditions",
      required: false
    },
    timeout: {
      type: "number",
      description: "Maximum wait time in milliseconds (default: 5000)",
      required: false,
      default: 5000
    }
  },
  code: `(params) => {
    const { condition, selector, expectedValue, timeout = 5000 } = params;
    const startTime = Date.now();

    return new Promise((resolve) => {
      const checkCondition = () => {
        if (Date.now() - startTime > timeout) {
          resolve({ success: false, message: 'Timeout exceeded', elapsed: Date.now() - startTime });
          return;
        }

        const elements = document.querySelectorAll(selector);

        if (condition === 'appear' && elements.length > 0) {
          resolve({ success: true, message: 'Element appeared', count: elements.length, elapsed: Date.now() - startTime });
        } else if (condition === 'disappear' && elements.length === 0) {
          resolve({ success: true, message: 'Element disappeared', elapsed: Date.now() - startTime });
        } else if (condition === 'count' && elements.length === parseInt(expectedValue)) {
          resolve({ success: true, message: 'Count matched', count: elements.length, elapsed: Date.now() - startTime });
        } else if (condition === 'text' && elements.length > 0) {
          const hasText = Array.from(elements).some(el => el.textContent.includes(expectedValue));
          if (hasText) {
            resolve({ success: true, message: 'Text found', elapsed: Date.now() - startTime });
          } else {
            setTimeout(checkCondition, 100);
          }
        } else {
          setTimeout(checkCondition, 100);
        }
      };

      checkCondition();
    });
  }`,
  returnType: "Promise resolving to object with success flag, message, and elapsed time",
  reliability: "high",
  tags: ["util", "waiting", "automation"]
};

/**
 * Dropdown Options Lister
 * Get all options from select dropdowns
 */
const dropdownOptionsLister = {
  site: "*",
  category: "exploration",
  name: "list_dropdown_options",
  description: "Get all available options from select dropdowns on the page",
  parameters: {
    selector: {
      type: "string",
      description: "CSS selector for specific dropdown (optional, lists all if not specified)",
      required: false
    }
  },
  code: `(params) => {
    const { selector } = params;
    const dropdowns = [];

    const selects = selector ?
      [document.querySelector(selector)].filter(Boolean) :
      Array.from(document.querySelectorAll('select'));

    selects.forEach((select, idx) => {
      const label = select.labels?.[0]?.textContent.trim() ||
                   select.getAttribute('aria-label') ||
                   select.name ||
                   select.id ||
                   \`dropdown-\${idx}\`;

      const options = [];
      select.querySelectorAll('option').forEach(option => {
        options.push({
          value: option.value,
          text: option.textContent.trim(),
          selected: option.selected,
          disabled: option.disabled
        });
      });

      dropdowns.push({
        label: label.substring(0, 50),
        name: select.name,
        id: select.id,
        selectedValue: select.value,
        selectedText: select.options[select.selectedIndex]?.textContent.trim(),
        optionCount: options.length,
        options: options,
        required: select.required,
        disabled: select.disabled
      });
    });

    return {
      dropdownCount: dropdowns.length,
      dropdowns: dropdowns
    };
  }`,
  returnType: "Object with dropdownCount and dropdowns array with all options",
  reliability: "high",
  tags: ["exploration", "forms", "dropdowns"]
};

/**
 * Breadcrumb Navigator
 * Extract breadcrumb navigation information
 */
const breadcrumbNavigator = {
  site: "*",
  category: "navigation",
  name: "get_breadcrumbs",
  description: "Extract breadcrumb navigation showing current page hierarchy",
  parameters: {},
  code: `(params) => {
    const breadcrumbs = [];

    // Common breadcrumb selectors
    const selectors = [
      '[aria-label="breadcrumb"]',
      '[aria-label="Breadcrumb"]',
      '.breadcrumb',
      '.breadcrumbs',
      'nav[class*="breadcrumb" i]',
      'ol[class*="breadcrumb" i]'
    ];

    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (container) {
        // Extract items
        const items = container.querySelectorAll('a, span, li');
        items.forEach((item, idx) => {
          const text = item.textContent.trim();
          if (text && text !== '/' && text !== '>' && text !== '›') {
            breadcrumbs.push({
              position: idx,
              text: text.substring(0, 100),
              href: item.href || null,
              isCurrentPage: !item.href || item.getAttribute('aria-current') === 'page'
            });
          }
        });

        if (breadcrumbs.length > 0) break; // Found breadcrumbs, stop searching
      }
    }

    return {
      found: breadcrumbs.length > 0,
      depth: breadcrumbs.length,
      breadcrumbs: breadcrumbs,
      currentPage: breadcrumbs.find(b => b.isCurrentPage)?.text || null
    };
  }`,
  returnType: "Object with found flag, depth, breadcrumbs array, and currentPage",
  reliability: "high",
  tags: ["navigation", "exploration", "hierarchy"]
};

/**
 * Pagination Info
 * Get pagination information and available page controls
 */
const paginationInfo = {
  site: "*",
  category: "navigation",
  name: "get_pagination_info",
  description: "Get pagination information including current page, total pages, and available controls",
  parameters: {},
  code: `(params) => {
    const pagination = {
      found: false,
      currentPage: null,
      totalPages: null,
      hasNext: false,
      hasPrevious: false,
      controls: []
    };

    // Common pagination selectors
    const containers = document.querySelectorAll('[role="navigation"][aria-label*="pagination" i], .pagination, nav[class*="pag" i]');

    for (const container of containers) {
      // Find current page indicator
      const current = container.querySelector('[aria-current="page"], .active, .current');
      if (current) {
        pagination.found = true;
        pagination.currentPage = parseInt(current.textContent.trim()) || current.textContent.trim();
      }

      // Find all page links
      const links = container.querySelectorAll('a, button');
      links.forEach(link => {
        const text = link.textContent.trim().toLowerCase();
        const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();

        if (text.includes('next') || ariaLabel.includes('next')) {
          pagination.hasNext = !link.disabled && !link.classList.contains('disabled');
          pagination.controls.push({ type: 'next', disabled: link.disabled });
        } else if (text.includes('prev') || ariaLabel.includes('prev')) {
          pagination.hasPrevious = !link.disabled && !link.classList.contains('disabled');
          pagination.controls.push({ type: 'previous', disabled: link.disabled });
        } else if (/^\d+$/.test(text)) {
          const pageNum = parseInt(text);
          if (pageNum > (pagination.totalPages || 0)) {
            pagination.totalPages = pageNum;
          }
          pagination.controls.push({ type: 'page', page: pageNum, isCurrent: link === current });
        }
      });

      if (pagination.found) break;
    }

    return pagination;
  }`,
  returnType: "Object with pagination details, current page, total pages, and available controls",
  reliability: "high",
  tags: ["navigation", "pagination", "exploration"]
};

/**
 * Smart Click Finder
 * Find all clickable elements with their action descriptions
 */
const smartClickFinder = {
  site: "*",
  category: "exploration",
  name: "find_clickable_elements",
  description: "Find all clickable elements with intelligent action descriptions",
  parameters: {
    limit: {
      type: "number",
      description: "Maximum number of elements to return (default: 30)",
      required: false,
      default: 30
    }
  },
  code: `(params) => {
    const { limit = 30 } = params;
    const clickables = [];

    // Helper to check if element is visible
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' &&
             style.visibility !== 'hidden' &&
             style.opacity !== '0' &&
             el.offsetParent !== null;
    };

    // Helper to determine action
    const getAction = (el) => {
      const text = el.textContent.trim().toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const combined = text + ' ' + ariaLabel;

      if (combined.includes('submit') || combined.includes('send')) return 'submit';
      if (combined.includes('save')) return 'save';
      if (combined.includes('delete') || combined.includes('remove')) return 'delete';
      if (combined.includes('edit') || combined.includes('modify')) return 'edit';
      if (combined.includes('cancel')) return 'cancel';
      if (combined.includes('close')) return 'close';
      if (combined.includes('search') || combined.includes('find')) return 'search';
      if (combined.includes('add') || combined.includes('create') || combined.includes('new')) return 'add';
      if (combined.includes('login') || combined.includes('sign in')) return 'login';
      if (combined.includes('logout') || combined.includes('sign out')) return 'logout';
      if (el.href) return 'navigate';
      return 'click';
    };

    // Buttons and links
    document.querySelectorAll('button, a[href], [role="button"], [onclick]').forEach(el => {
      if (!isVisible(el) || clickables.length >= limit) return;

      const text = el.textContent.trim();
      if (!text && !el.getAttribute('aria-label')) return;

      clickables.push({
        action: getAction(el),
        text: text.substring(0, 50),
        ariaLabel: el.getAttribute('aria-label'),
        href: el.href || null,
        type: el.tagName.toLowerCase(),
        selector: el.id ? '#' + el.id : el.className ? el.tagName.toLowerCase() + '.' + el.className.split(' ')[0] : el.tagName.toLowerCase()
      });
    });

    return {
      count: clickables.length,
      elements: clickables,
      truncated: clickables.length >= limit
    };
  }`,
  returnType: "Object with count, clickable elements array, and truncated flag",
  reliability: "high",
  tags: ["exploration", "interaction", "navigation"]
};

/**
 * Content Change Monitor
 * Detect what has changed on the page since last check
 */
const contentChangeMonitor = {
  site: "*",
  category: "util",
  name: "detect_page_changes",
  description: "Detect content changes by comparing current state with stored snapshot",
  parameters: {
    baselineSnapshot: {
      type: "string",
      description: "Previous page content snapshot to compare against",
      required: true
    }
  },
  code: `(params) => {
    const { baselineSnapshot } = params;
    const changes = [];

    // Get current key elements
    const currentState = {
      title: document.title,
      h1Count: document.querySelectorAll('h1').length,
      buttonCount: document.querySelectorAll('button').length,
      linkCount: document.querySelectorAll('a').length,
      inputCount: document.querySelectorAll('input').length,
      modalVisible: !!document.querySelector('[role="dialog"], .modal.show'),
      messageCount: document.querySelectorAll('[role="alert"], .alert').length
    };

    const baseline = JSON.parse(baselineSnapshot);

    // Compare states
    if (baseline.title !== currentState.title) {
      changes.push({ type: 'title', old: baseline.title, new: currentState.title });
    }

    ['h1Count', 'buttonCount', 'linkCount', 'inputCount', 'messageCount'].forEach(key => {
      if (baseline[key] !== currentState[key]) {
        changes.push({ type: key, old: baseline[key], new: currentState[key] });
      }
    });

    if (baseline.modalVisible !== currentState.modalVisible) {
      changes.push({
        type: 'modal',
        event: currentState.modalVisible ? 'appeared' : 'disappeared'
      });
    }

    return {
      hasChanges: changes.length > 0,
      changeCount: changes.length,
      changes: changes,
      currentSnapshot: JSON.stringify(currentState)
    };
  }`,
  returnType: "Object with hasChanges flag, changeCount, changes array, and new snapshot",
  reliability: "medium",
  tags: ["util", "monitoring", "automation"]
};

// ============================================================================
// TIER 4: MODAL AND CLEANUP MACROS
// ============================================================================

/**
 * Smart Modal Closer
 * Intelligently close modals, dialogs, and popups
 */
const smartModalCloser = {
  site: "*",
  category: "util",
  name: "close_modal",
  description: "Intelligently find and close modal dialogs, popups, and overlays",
  parameters: {
    type: {
      type: "string",
      description: "Type of modal to close: 'any', 'cookie', 'newsletter', 'age_verification' (default: 'any')",
      required: false,
      default: "any"
    }
  },
  code: `(params) => {
    const { type = 'any' } = params;
    const closed = [];

    // Common close button patterns
    const closeSelectors = [
      '[aria-label*="close" i]',
      '[aria-label*="dismiss" i]',
      '.close',
      '.modal-close',
      '.popup-close',
      '[data-dismiss]',
      'button[class*="close" i]'
    ];

    // Find visible modals
    const modalSelectors = [
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[aria-modal="true"]',
      '.modal.show',
      '.modal.active',
      '.popup.active',
      '.overlay.active'
    ];

    modalSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(modal => {
        const style = window.getComputedStyle(modal);
        if (style.display === 'none' || style.visibility === 'hidden') return;

        // Check if this modal matches the type filter
        if (type !== 'any') {
          const text = modal.textContent.toLowerCase();
          if (type === 'cookie' && !text.includes('cookie')) return;
          if (type === 'newsletter' && !text.includes('newsletter') && !text.includes('subscribe')) return;
          if (type === 'age_verification' && !text.includes('age') && !text.includes('18+')) return;
        }

        // Try to find and click close button
        for (const closeSelector of closeSelectors) {
          const closeBtn = modal.querySelector(closeSelector);
          if (closeBtn) {
            const btnStyle = window.getComputedStyle(closeBtn);
            if (btnStyle.display !== 'none' && btnStyle.visibility !== 'hidden') {
              closeBtn.click();
              closed.push({
                heading: modal.querySelector('h1, h2, h3')?.textContent.trim() || 'No heading',
                closeMethod: 'button',
                selector: closeSelector
              });
              return;
            }
          }
        }

        // Try ESC key
        modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }));
        closed.push({
          heading: modal.querySelector('h1, h2, h3')?.textContent.trim() || 'No heading',
          closeMethod: 'escape_key'
        });
      });
    });

    return {
      closed: closed.length,
      modals: closed,
      success: closed.length > 0
    };
  }`,
  returnType: "Object with count of closed modals and details",
  reliability: "high",
  tags: ["util", "cleanup", "modals"]
};

/**
 * Auto-Dismiss Interruptions
 * Automatically dismiss common page interruptions
 */
const autoDismissInterruptions = {
  site: "*",
  category: "util",
  name: "dismiss_interruptions",
  description: "Automatically dismiss common interruptions: cookie banners, newsletters, notifications",
  parameters: {},
  code: `(params) => {
    const dismissed = [];

    // Cookie consent patterns
    const cookiePatterns = {
      acceptButtons: [
        'button:contains("Accept")',
        'button:contains("Agree")',
        'button:contains("OK")',
        '[id*="accept" i]',
        '[class*="accept" i]'
      ],
      containers: [
        '[class*="cookie" i]',
        '[id*="cookie" i]',
        '[aria-label*="cookie" i]'
      ]
    };

    // Find and dismiss cookie banners
    cookiePatterns.containers.forEach(containerSel => {
      document.querySelectorAll(containerSel).forEach(container => {
        if (container.textContent.toLowerCase().includes('cookie')) {
          const acceptBtn = container.querySelector('button');
          if (acceptBtn && acceptBtn.textContent.toLowerCase().includes('accept')) {
            acceptBtn.click();
            dismissed.push({ type: 'cookie_banner', method: 'accept_button' });
          }
        }
      });
    });

    // Dismiss newsletter popups (look for close button)
    document.querySelectorAll('[class*="newsletter" i], [class*="subscribe" i]').forEach(popup => {
      const style = window.getComputedStyle(popup);
      if (style.display !== 'none') {
        const closeBtn = popup.querySelector('[aria-label*="close" i], .close');
        if (closeBtn) {
          closeBtn.click();
          dismissed.push({ type: 'newsletter_popup', method: 'close_button' });
        }
      }
    });

    // Dismiss notification permission requests
    document.querySelectorAll('[class*="notification" i]').forEach(notif => {
      const rejectBtn = notif.querySelector('button:contains("No"), button:contains("Deny"), button:contains("Later")');
      if (rejectBtn) {
        rejectBtn.click();
        dismissed.push({ type: 'notification_request', method: 'reject_button' });
      }
    });

    return {
      dismissed: dismissed.length,
      interruptions: dismissed,
      success: dismissed.length > 0
    };
  }`,
  returnType: "Object with count of dismissed interruptions and details",
  reliability: "medium",
  tags: ["util", "cleanup", "automation"]
};

/**
 * Page Cleanup
 * Remove common distractions and clean up the page
 */
const pageCleanup = {
  site: "*",
  category: "util",
  name: "cleanup_page",
  description: "Remove ads, popups, overlays, and other distractions from the page",
  parameters: {
    aggressive: {
      type: "boolean",
      description: "Use aggressive cleanup (may remove some content) (default: false)",
      required: false,
      default: false
    }
  },
  code: `(params) => {
    const { aggressive = false } = params;
    const removed = [];

    // Remove overlays
    document.querySelectorAll('[class*="overlay" i], [class*="backdrop" i]').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'absolute') {
        el.remove();
        removed.push({ type: 'overlay', class: el.className });
      }
    });

    // Remove ads
    const adSelectors = [
      '[id*="ad" i]',
      '[class*="ad" i]',
      '[class*="advertisement" i]',
      'iframe[src*="doubleclick"]',
      'iframe[src*="googlesyndication"]'
    ];

    adSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(ad => {
        // Be careful not to remove main content
        if (ad.id?.toLowerCase() === 'header' || ad.id?.toLowerCase() === 'main') return;
        ad.remove();
        removed.push({ type: 'ad', selector: selector });
      });
    });

    if (aggressive) {
      // Remove sticky headers/footers
      document.querySelectorAll('[style*="position: fixed"], [style*="position: sticky"]').forEach(el => {
        if (el.offsetHeight > 100) return; // Probably main content
        el.remove();
        removed.push({ type: 'sticky_element', tag: el.tagName });
      });

      // Remove chat widgets
      document.querySelectorAll('[class*="chat" i], [id*="chat" i]').forEach(chat => {
        chat.remove();
        removed.push({ type: 'chat_widget' });
      });
    }

    return {
      removed: removed.length,
      elements: removed,
      aggressive: aggressive
    };
  }`,
  returnType: "Object with count of removed elements and details",
  reliability: "medium",
  tags: ["util", "cleanup", "readability"]
};

// Export macros for storage
const tier1Macros = [
  getInteractiveElements,
  discoverForms,
  detectMessages,
  findElementByDescription
];

const tier2Macros = [
  extractTableData,
  getFormState,
  detectModals,
  checkVisibilityBatch
];

const tier3Macros = [
  smartWaitHelper,
  dropdownOptionsLister,
  breadcrumbNavigator,
  paginationInfo,
  smartClickFinder,
  contentChangeMonitor
];

const tier4Macros = [
  smartModalCloser,
  autoDismissInterruptions,
  pageCleanup
];

const allMacros = [
  ...tier1Macros,
  ...tier2Macros,
  ...tier3Macros,
  ...tier4Macros
];

// CommonJS export (for compatibility)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { tier1Macros, tier2Macros, tier3Macros, tier4Macros, allMacros };
}

// ES Module export
export { tier1Macros, tier2Macros, tier3Macros, tier4Macros, allMacros };
