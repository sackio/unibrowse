// Advanced Form Controls Macros
// Handle complex controls like date pickers, file uploads, sliders, custom widgets

export const advancedFormControlsMacros = [
  // Macro 1: Smart date picker handler
  {
    site: '*',
    category: 'form',
    name: 'fill_date_picker',
    description: 'Fill date inputs including native and custom JavaScript date pickers',
    parameters: {
      selector: {
        type: 'string',
        description: 'CSS selector for date input/picker',
        required: true
      },
      date: {
        type: 'string',
        description: 'Date in YYYY-MM-DD format or "today", "tomorrow", "yesterday"',
        required: true
      }
    },
    code: `async (params) => {
      const selector = params.selector;
      let dateString = params.date;

      // Parse relative dates
      const today = new Date();
      if (dateString === 'today') {
        dateString = today.toISOString().split('T')[0];
      } else if (dateString === 'tomorrow') {
        today.setDate(today.getDate() + 1);
        dateString = today.toISOString().split('T')[0];
      } else if (dateString === 'yesterday') {
        today.setDate(today.getDate() - 1);
        dateString = today.toISOString().split('T')[0];
      }

      const element = document.querySelector(selector);
      if (!element) {
        return { success: false, error: 'Element not found: ' + selector };
      }

      // Method 1: Native date input
      if (element.type === 'date') {
        element.value = dateString;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return {
          success: true,
          method: 'native_date_input',
          value: dateString
        };
      }

      // Method 2: Look for date picker library data attributes
      const pickerTypes = [
        { attr: 'data-flatpickr', name: 'Flatpickr' },
        { attr: 'data-pikaday', name: 'Pikaday' },
        { attr: 'data-datepicker', name: 'Bootstrap Datepicker' }
      ];

      for (const type of pickerTypes) {
        if (element.hasAttribute(type.attr) || element.classList.contains('flatpickr-input') ||
            element.classList.contains('datepicker')) {

          // Try to find the library instance
          if (element._flatpickr) {
            element._flatpickr.setDate(dateString);
            return { success: true, method: type.name, value: dateString };
          }

          if (window.flatpickr) {
            const fp = window.flatpickr(element);
            fp.setDate(dateString);
            return { success: true, method: 'Flatpickr_manual', value: dateString };
          }
        }
      }

      // Method 3: Try setting value directly and triggering events
      element.value = dateString;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));

      // Method 4: Try jQuery UI datepicker
      if (window.jQuery && window.jQuery.fn.datepicker) {
        try {
          window.jQuery(element).datepicker('setDate', new Date(dateString));
          return { success: true, method: 'jQuery_UI_datepicker', value: dateString };
        } catch (e) {
          // Not a jQuery UI datepicker
        }
      }

      return {
        success: true,
        method: 'direct_value_set',
        value: dateString,
        warning: 'Used direct value setting - custom picker may need manual interaction'
      };
    }`,
    returnType: 'Object with success flag, method used, and value set',
    reliability: 'high',
    tags: ['form', 'date', 'picker', 'calendar', 'advanced']
  },

  // Macro 2: Range slider handler
  {
    site: '*',
    category: 'form',
    name: 'set_range_slider',
    description: 'Set value on range sliders including native and custom (noUiSlider, Ion.RangeSlider)',
    parameters: {
      selector: {
        type: 'string',
        description: 'CSS selector for range slider',
        required: true
      },
      value: {
        type: 'number',
        description: 'Numeric value to set',
        required: true
      }
    },
    code: `(params) => {
      const element = document.querySelector(params.selector);
      if (!element) {
        return { success: false, error: 'Element not found: ' + params.selector };
      }

      const value = params.value;

      // Method 1: Native range input
      if (element.type === 'range') {
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return {
          success: true,
          method: 'native_range',
          value: value,
          min: element.min,
          max: element.max
        };
      }

      // Method 2: noUiSlider
      if (element.noUiSlider) {
        element.noUiSlider.set(value);
        return { success: true, method: 'noUiSlider', value: value };
      }

      // Method 3: Ion.RangeSlider
      if (window.jQuery && element.id) {
        try {
          const $elem = window.jQuery('#' + element.id);
          if ($elem.data('ionRangeSlider')) {
            $elem.data('ionRangeSlider').update({ from: value });
            return { success: true, method: 'Ion.RangeSlider', value: value };
          }
        } catch (e) {
          // Not Ion.RangeSlider
        }
      }

      // Method 4: Look for slider container with data attributes
      const container = element.closest('[data-slider]') || element.closest('.slider');
      if (container) {
        // Try to find input within slider
        const input = container.querySelector('input[type="range"], input[type="hidden"]');
        if (input) {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, method: 'slider_container_input', value: value };
        }
      }

      return {
        success: false,
        error: 'Could not detect slider type',
        attempted: ['native_range', 'noUiSlider', 'Ion.RangeSlider']
      };
    }`,
    returnType: 'Object with success flag, method used, and value set',
    reliability: 'high',
    tags: ['form', 'slider', 'range', 'advanced']
  },

  // Macro 3: File upload handler
  {
    site: '*',
    category: 'form',
    name: 'prepare_file_upload',
    description: 'Prepare file upload input and detect dropzone support',
    parameters: {
      selector: {
        type: 'string',
        description: 'CSS selector for file input or dropzone',
        required: true
      }
    },
    code: `(params) => {
      const element = document.querySelector(params.selector);
      if (!element) {
        return { success: false, error: 'Element not found: ' + params.selector };
      }

      const result = {
        success: true,
        type: null,
        accept: null,
        multiple: false,
        maxSize: null,
        dropzoneDetected: false,
        instructions: null
      };

      // Method 1: Native file input
      if (element.type === 'file') {
        result.type = 'native_file_input';
        result.accept = element.accept || 'any';
        result.multiple = element.multiple;
        result.instructions = 'Use browser_evaluate to create File objects and set input.files';

        return result;
      }

      // Method 2: Dropzone.js
      if (element.dropzone || element.classList.contains('dropzone')) {
        result.type = 'Dropzone.js';
        result.dropzoneDetected = true;
        result.instructions = 'Use dropzone.addFile() method or find hidden file input';

        // Look for hidden file input
        const hiddenInput = element.querySelector('input[type="file"]');
        if (hiddenInput) {
          result.hiddenInput = {
            selector: '#' + hiddenInput.id || 'input[type="file"]',
            accept: hiddenInput.accept,
            multiple: hiddenInput.multiple
          };
        }

        return result;
      }

      // Method 3: Look for drag-drop zones
      const isDragDrop = element.hasAttribute('data-drag-drop') ||
                        element.classList.contains('drag-drop') ||
                        element.classList.contains('file-drop') ||
                        element.getAttribute('role') === 'button';

      if (isDragDrop) {
        result.type = 'custom_drag_drop';
        result.dropzoneDetected = true;

        // Look for associated file input
        const fileInput = document.querySelector(\`[data-for="\${element.id}"], input[type="file"]\`);
        if (fileInput) {
          result.hiddenInput = {
            selector: '#' + fileInput.id || 'input[type="file"]',
            accept: fileInput.accept,
            multiple: fileInput.multiple
          };
        }

        result.instructions = 'Click element to trigger file dialog, or find hidden file input';
        return result;
      }

      return {
        success: false,
        error: 'Could not detect file upload mechanism',
        suggestion: 'Look for input[type="file"] or click upload button'
      };
    }`,
    returnType: 'Object with upload type, constraints, and instructions',
    reliability: 'high',
    tags: ['form', 'upload', 'file', 'dropzone', 'advanced']
  },

  // Macro 4: Color picker handler
  {
    site: '*',
    category: 'form',
    name: 'set_color_picker',
    description: 'Set color on native and custom color pickers',
    parameters: {
      selector: {
        type: 'string',
        description: 'CSS selector for color picker',
        required: true
      },
      color: {
        type: 'string',
        description: 'Color in hex format (#RRGGBB) or named color',
        required: true
      }
    },
    code: `(params) => {
      const element = document.querySelector(params.selector);
      if (!element) {
        return { success: false, error: 'Element not found: ' + params.selector };
      }

      let color = params.color;

      // Ensure hex format
      if (!color.startsWith('#')) {
        // Convert named colors
        const namedColors = {
          'red': '#FF0000', 'green': '#008000', 'blue': '#0000FF',
          'white': '#FFFFFF', 'black': '#000000', 'yellow': '#FFFF00',
          'cyan': '#00FFFF', 'magenta': '#FF00FF', 'orange': '#FFA500'
        };
        color = namedColors[color.toLowerCase()] || '#000000';
      }

      // Method 1: Native color input
      if (element.type === 'color') {
        element.value = color;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, method: 'native_color_input', value: color };
      }

      // Method 2: Try to find color picker library instances
      // Spectrum color picker
      if (window.jQuery && element.spectrum) {
        try {
          window.jQuery(element).spectrum('set', color);
          return { success: true, method: 'Spectrum_colorpicker', value: color };
        } catch (e) {}
      }

      // Method 3: Pickr color picker
      if (element._pickr) {
        element._pickr.setColor(color);
        return { success: true, method: 'Pickr', value: color };
      }

      // Method 4: Direct value setting
      element.value = color;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      return {
        success: true,
        method: 'direct_value_set',
        value: color,
        warning: 'Used direct value setting - custom picker may need manual interaction'
      };
    }`,
    returnType: 'Object with success flag, method used, and color value',
    reliability: 'high',
    tags: ['form', 'color', 'picker', 'advanced']
  },

  // Macro 5: Custom dropdown/select handler
  {
    site: '*',
    category: 'form',
    name: 'set_custom_select',
    description: 'Set value on custom select boxes (Select2, Chosen, Material UI, etc.)',
    parameters: {
      selector: {
        type: 'string',
        description: 'CSS selector for select element or custom select container',
        required: true
      },
      value: {
        type: 'string',
        description: 'Value to select (value attribute or visible text)',
        required: true
      }
    },
    code: `(params) => {
      const selector = params.selector;
      const value = params.value;

      let element = document.querySelector(selector);
      if (!element) {
        return { success: false, error: 'Element not found: ' + selector };
      }

      // Method 1: Native select
      if (element.tagName === 'SELECT') {
        // Try by value
        element.value = value;
        if (element.value === value) {
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, method: 'native_select_by_value', value: value };
        }

        // Try by text
        const option = Array.from(element.options).find(opt =>
          opt.text.toLowerCase().includes(value.toLowerCase())
        );
        if (option) {
          element.value = option.value;
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, method: 'native_select_by_text', value: option.value };
        }

        return { success: false, error: 'No matching option found' };
      }

      // Method 2: Select2
      if (window.jQuery) {
        const $elem = window.jQuery(selector);
        if ($elem.data('select2')) {
          $elem.val(value).trigger('change');
          return { success: true, method: 'Select2', value: value };
        }

        // Chosen
        if ($elem.data('chosen')) {
          $elem.val(value).trigger('chosen:updated').trigger('change');
          return { success: true, method: 'Chosen', value: value };
        }
      }

      // Method 3: Look for hidden select inside custom select
      const hiddenSelect = element.querySelector('select') ||
                          element.previousElementSibling?.tagName === 'SELECT' ? element.previousElementSibling : null;

      if (hiddenSelect) {
        hiddenSelect.value = value;
        hiddenSelect.dispatchEvent(new Event('change', { bubbles: true }));

        // Update visible text
        const selectedOption = hiddenSelect.options[hiddenSelect.selectedIndex];
        if (selectedOption) {
          const displayElement = element.querySelector('.selected, .current, [class*="value"]');
          if (displayElement) {
            displayElement.textContent = selectedOption.text;
          }
        }

        return { success: true, method: 'custom_select_with_hidden', value: value };
      }

      // Method 4: Material UI or similar - find and click option
      const customOptions = element.querySelectorAll('[role="option"], .option, [data-value]');
      for (const option of customOptions) {
        if (option.textContent.toLowerCase().includes(value.toLowerCase()) ||
            option.dataset.value === value) {
          option.click();
          return { success: true, method: 'custom_select_click_option', value: value };
        }
      }

      return {
        success: false,
        error: 'Could not detect custom select type',
        attempted: ['native', 'Select2', 'Chosen', 'hidden_select', 'custom_options']
      };
    }`,
    returnType: 'Object with success flag, method used, and value set',
    reliability: 'high',
    tags: ['form', 'select', 'dropdown', 'custom', 'advanced']
  },

  // Macro 6: Rich text editor handler
  {
    site: '*',
    category: 'form',
    name: 'set_rich_text_editor',
    description: 'Set content in rich text editors (TinyMCE, CKEditor, Quill, ContentEditable)',
    parameters: {
      selector: {
        type: 'string',
        description: 'CSS selector for editor container or textarea',
        required: true
      },
      content: {
        type: 'string',
        description: 'HTML or plain text content to set',
        required: true
      },
      format: {
        type: 'string',
        description: 'Content format: "html" or "text" (default: text)',
        required: false,
        default: 'text'
      }
    },
    code: `(params) => {
      const selector = params.selector;
      const content = params.content;
      const format = params.format || 'text';

      const element = document.querySelector(selector);
      if (!element) {
        return { success: false, error: 'Element not found: ' + selector };
      }

      // Method 1: TinyMCE
      if (window.tinymce) {
        const editor = window.tinymce.get(element.id) ||
                      window.tinymce.editors.find(ed => ed.targetElm === element);
        if (editor) {
          editor.setContent(content);
          return { success: true, method: 'TinyMCE', format: format };
        }
      }

      // Method 2: CKEditor
      if (window.CKEDITOR) {
        const editor = window.CKEDITOR.instances[element.id || element.name];
        if (editor) {
          editor.setData(content);
          return { success: true, method: 'CKEditor', format: format };
        }
      }

      // Method 3: Quill
      if (element.__quill || element.classList.contains('ql-editor')) {
        const quillContainer = element.closest('.ql-container')?.previousElementSibling;
        if (quillContainer && quillContainer.__quill) {
          if (format === 'html') {
            quillContainer.__quill.root.innerHTML = content;
          } else {
            quillContainer.__quill.setText(content);
          }
          return { success: true, method: 'Quill', format: format };
        }
      }

      // Method 4: ContentEditable
      if (element.contentEditable === 'true' || element.isContentEditable) {
        if (format === 'html') {
          element.innerHTML = content;
        } else {
          element.textContent = content;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, method: 'contentEditable', format: format };
      }

      // Method 5: Look for contentEditable inside container
      const editableDiv = element.querySelector('[contenteditable="true"], .editor, [role="textbox"]');
      if (editableDiv) {
        if (format === 'html') {
          editableDiv.innerHTML = content;
        } else {
          editableDiv.textContent = content;
        }
        editableDiv.dispatchEvent(new Event('input', { bubbles: true }));
        return { success: true, method: 'nested_contentEditable', format: format };
      }

      // Method 6: Fallback to textarea
      if (element.tagName === 'TEXTAREA') {
        element.value = content;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, method: 'textarea_fallback', format: 'text' };
      }

      return {
        success: false,
        error: 'Could not detect rich text editor type',
        attempted: ['TinyMCE', 'CKEditor', 'Quill', 'contentEditable', 'textarea']
      };
    }`,
    returnType: 'Object with success flag, method used, and format',
    reliability: 'high',
    tags: ['form', 'editor', 'wysiwyg', 'richtext', 'advanced']
  },

  // Macro 7: Autocomplete/Typeahead handler
  {
    site: '*',
    category: 'form',
    name: 'fill_autocomplete',
    description: 'Fill autocomplete/typeahead inputs and select from suggestions',
    parameters: {
      selector: {
        type: 'string',
        description: 'CSS selector for autocomplete input',
        required: true
      },
      text: {
        type: 'string',
        description: 'Text to type',
        required: true
      },
      waitForSuggestions: {
        type: 'boolean',
        description: 'Wait for suggestions to appear (default: true)',
        required: false,
        default: true
      }
    },
    code: `async (params) => {
      const element = document.querySelector(params.selector);
      if (!element) {
        return { success: false, error: 'Element not found: ' + params.selector };
      }

      const text = params.text;
      const waitForSuggestions = params.waitForSuggestions !== false;

      // Set value and trigger events
      element.value = text;
      element.focus();

      // Trigger key events to activate autocomplete
      element.dispatchEvent(new KeyboardEvent('keydown', { key: text[0], bubbles: true }));
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: text[0], bubbles: true }));

      if (!waitForSuggestions) {
        return { success: true, method: 'text_entered', text: text };
      }

      // Wait for suggestions to appear
      await new Promise(resolve => setTimeout(resolve, 500));

      // Look for suggestion dropdowns
      const suggestionSelectors = [
        '.autocomplete-suggestions',
        '.typeahead',
        '.dropdown-menu',
        '.suggestions',
        '[role="listbox"]',
        '.ui-autocomplete'
      ];

      let suggestionsFound = null;
      for (const sel of suggestionSelectors) {
        const suggestions = document.querySelector(sel);
        if (suggestions && suggestions.children.length > 0) {
          suggestionsFound = suggestions;
          break;
        }
      }

      if (suggestionsFound) {
        const firstSuggestion = suggestionsFound.querySelector('[role="option"], li, .suggestion, .item');
        if (firstSuggestion) {
          firstSuggestion.click();
          return {
            success: true,
            method: 'autocomplete_with_selection',
            text: text,
            selected: firstSuggestion.textContent.trim()
          };
        }
      }

      // Trigger enter key to accept
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      return {
        success: true,
        method: 'autocomplete_enter_key',
        text: text,
        warning: 'Suggestions not found, pressed Enter to accept'
      };
    }`,
    returnType: 'Object with success flag, method used, and selected value',
    reliability: 'medium',
    tags: ['form', 'autocomplete', 'typeahead', 'suggestions', 'advanced']
  },

  // Macro 8: Detect all advanced controls on page
  {
    site: '*',
    category: 'form',
    name: 'detect_advanced_form_controls',
    description: 'Scan page for complex form controls and provide filling strategies',
    parameters: {
      formSelector: {
        type: 'string',
        description: 'CSS selector for form to scan (default: entire page)',
        required: false
      }
    },
    code: `(params) => {
      const container = params.formSelector
        ? document.querySelector(params.formSelector)
        : document.body;

      if (!container) {
        return { success: false, error: 'Container not found' };
      }

      const controls = {
        datePickers: [],
        colorPickers: [],
        fileUploads: [],
        rangeSliders: [],
        customSelects: [],
        richTextEditors: [],
        autocompletes: []
      };

      // Date pickers
      const dateInputs = container.querySelectorAll('input[type="date"], .datepicker, [data-datepicker]');
      dateInputs.forEach(el => {
        controls.datePickers.push({
          selector: '#' + el.id || el.name,
          type: el.type === 'date' ? 'native' : 'custom'
        });
      });

      // Color pickers
      const colorInputs = container.querySelectorAll('input[type="color"], [data-colorpicker]');
      colorInputs.forEach(el => {
        controls.colorPickers.push({
          selector: '#' + el.id || el.name,
          type: el.type === 'color' ? 'native' : 'custom'
        });
      });

      // File uploads
      const fileInputs = container.querySelectorAll('input[type="file"], .dropzone, [data-drag-drop]');
      fileInputs.forEach(el => {
        controls.fileUploads.push({
          selector: '#' + el.id || 'input[type="file"]',
          accept: el.accept,
          multiple: el.multiple
        });
      });

      // Range sliders
      const rangeInputs = container.querySelectorAll('input[type="range"], .slider, [data-slider]');
      rangeInputs.forEach(el => {
        controls.rangeSliders.push({
          selector: '#' + el.id || el.name,
          min: el.min,
          max: el.max,
          value: el.value
        });
      });

      // Custom selects
      const selects = container.querySelectorAll('select, [class*="select2"], [class*="chosen"]');
      selects.forEach(el => {
        const isCustom = el.classList.contains('select2') ||
                        el.classList.contains('chosen') ||
                        el.nextElementSibling?.classList.contains('select2');
        controls.customSelects.push({
          selector: '#' + el.id || el.name,
          type: isCustom ? 'custom' : 'native',
          optionCount: el.options?.length || 0
        });
      });

      // Rich text editors
      const editors = container.querySelectorAll('textarea.tinymce, [contenteditable="true"], .ql-editor, .cke_editable');
      editors.forEach(el => {
        controls.richTextEditors.push({
          selector: '#' + el.id || '.editor',
          type: el.classList.contains('ql-editor') ? 'Quill' :
                el.classList.contains('cke_editable') ? 'CKEditor' :
                el.classList.contains('tinymce') ? 'TinyMCE' : 'contentEditable'
        });
      });

      // Autocompletes
      const autocompletes = container.querySelectorAll('[data-autocomplete], [autocomplete="off"]');
      autocompletes.forEach(el => {
        if (el.type === 'text' || el.type === 'search') {
          controls.autocompletes.push({
            selector: '#' + el.id || el.name
          });
        }
      });

      const totalControls = Object.values(controls).reduce((sum, arr) => sum + arr.length, 0);

      return {
        success: true,
        totalAdvancedControls: totalControls,
        controls: controls,
        recommendations: {
          datePickers: controls.datePickers.length > 0 ? 'Use fill_date_picker macro' : null,
          colorPickers: controls.colorPickers.length > 0 ? 'Use set_color_picker macro' : null,
          fileUploads: controls.fileUploads.length > 0 ? 'Use prepare_file_upload macro' : null,
          rangeSliders: controls.rangeSliders.length > 0 ? 'Use set_range_slider macro' : null,
          customSelects: controls.customSelects.length > 0 ? 'Use set_custom_select macro' : null,
          richTextEditors: controls.richTextEditors.length > 0 ? 'Use set_rich_text_editor macro' : null,
          autocompletes: controls.autocompletes.length > 0 ? 'Use fill_autocomplete macro' : null
        }
      };
    }`,
    returnType: 'Object with all detected advanced controls and recommendations',
    reliability: 'high',
    tags: ['form', 'detection', 'analysis', 'advanced', 'survey']
  }
];
