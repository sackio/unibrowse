// Smart Form Filling Macros
// Intelligent form filling with validation, multi-step handling, and realistic data generation

export const formFillingMacros = [
  // Macro 1: Comprehensive form analysis with filling strategy
  {
    site: '*',
    category: 'form',
    name: 'analyze_form_for_filling',
    description: 'Analyze form structure and generate optimal filling strategy',
    parameters: {
      formSelector: {
        type: 'string',
        description: 'CSS selector for form (default: first form on page)',
        required: false
      }
    },
    code: `(params) => {
      const form = params.formSelector
        ? document.querySelector(params.formSelector)
        : document.querySelector('form');

      if (!form) {
        return { success: false, error: 'No form found' };
      }

      const fields = [];
      const inputs = form.querySelectorAll('input, select, textarea');

      inputs.forEach((input, index) => {
        const field = {
          index: index,
          type: input.type || input.tagName.toLowerCase(),
          name: input.name || input.id || \`field_\${index}\`,
          id: input.id,
          required: input.required || input.hasAttribute('aria-required'),
          placeholder: input.placeholder,
          value: input.value,
          disabled: input.disabled,
          readonly: input.readOnly
        };

        // Get associated label
        const label = input.id
          ? document.querySelector(\`label[for="\${input.id}"]\`)
          : input.closest('label');
        field.label = label ? label.textContent.trim() : '';

        // Detect field purpose from various attributes
        field.purpose = detectFieldPurpose(input, field.label);

        // Get validation constraints
        if (input.type === 'text' || input.type === 'email' || input.type === 'tel') {
          field.pattern = input.pattern;
          field.minLength = input.minLength > 0 ? input.minLength : null;
          field.maxLength = input.maxLength > 0 ? input.maxLength : null;
        }

        if (input.type === 'number') {
          field.min = input.min;
          field.max = input.max;
          field.step = input.step;
        }

        // Get select options
        if (input.tagName === 'SELECT') {
          field.options = Array.from(input.options).map(opt => ({
            value: opt.value,
            text: opt.text,
            selected: opt.selected
          }));
        }

        fields.push(field);
      });

      function detectFieldPurpose(input, label) {
        const text = (input.name + input.id + label + input.placeholder).toLowerCase();

        if (/email/i.test(text)) return 'email';
        if (/phone|tel/i.test(text)) return 'phone';
        if (/password/i.test(text)) return 'password';
        if (/first.*name|fname/i.test(text)) return 'firstName';
        if (/last.*name|lname/i.test(text)) return 'lastName';
        if (/full.*name|name/i.test(text)) return 'fullName';
        if (/address.*1|street/i.test(text)) return 'address';
        if (/city/i.test(text)) return 'city';
        if (/state|province/i.test(text)) return 'state';
        if (/zip|postal/i.test(text)) return 'zipCode';
        if (/country/i.test(text)) return 'country';
        if (/card.*number|credit/i.test(text)) return 'creditCard';
        if (/cvv|cvc/i.test(text)) return 'cvv';
        if (/exp|expir/i.test(text)) return 'expiration';
        if (/username|login/i.test(text)) return 'username';
        if (/company|organization/i.test(text)) return 'company';
        if (/birth|dob/i.test(text)) return 'birthdate';
        if (/age/i.test(text)) return 'age';
        if (/gender|sex/i.test(text)) return 'gender';

        return 'unknown';
      }

      return {
        success: true,
        formSelector: params.formSelector || 'form:first-child',
        action: form.action,
        method: form.method || 'GET',
        fieldCount: fields.length,
        requiredFields: fields.filter(f => f.required).length,
        fields: fields,
        fillable: fields.filter(f => !f.disabled && !f.readonly),
        strategy: generateFillingStrategy(fields)
      };

      function generateFillingStrategy(fields) {
        return {
          order: fields.map(f => f.name),
          requiredFirst: fields.filter(f => f.required).map(f => f.name),
          autofillable: fields.filter(f => f.purpose !== 'unknown').map(f => ({
            name: f.name,
            purpose: f.purpose
          }))
        };
      }
    }`,
    returnType: 'Object with form analysis, fields array, and filling strategy',
    reliability: 'high',
    tags: ['form', 'analysis', 'filling', 'automation']
  },

  // Macro 2: Smart form filling with realistic data
  {
    site: '*',
    category: 'form',
    name: 'smart_fill_form',
    description: 'Intelligently fill form fields with realistic data based on field purpose',
    parameters: {
      formSelector: {
        type: 'string',
        description: 'CSS selector for form (default: first form)',
        required: false
      },
      data: {
        type: 'object',
        description: 'Optional data object to use instead of generated data',
        required: false
      },
      fillHidden: {
        type: 'boolean',
        description: 'Fill hidden fields (default: false)',
        required: false,
        default: false
      }
    },
    code: `(params) => {
      const form = params.formSelector
        ? document.querySelector(params.formSelector)
        : document.querySelector('form');

      if (!form) {
        return { success: false, error: 'No form found' };
      }

      const fillData = params.data || generateRealisticData();
      const filled = [];
      const skipped = [];
      const inputs = form.querySelectorAll('input, select, textarea');

      inputs.forEach(input => {
        // Skip disabled, readonly, hidden (unless fillHidden=true), submit/button
        if (input.disabled || input.readOnly) {
          skipped.push({ name: input.name, reason: 'disabled or readonly' });
          return;
        }

        if (input.type === 'hidden' && !params.fillHidden) {
          skipped.push({ name: input.name, reason: 'hidden field' });
          return;
        }

        if (['submit', 'button', 'reset'].includes(input.type)) {
          skipped.push({ name: input.name, reason: 'button type' });
          return;
        }

        // Detect field purpose
        const label = input.id
          ? document.querySelector(\`label[for="\${input.id}"]\`)?.textContent
          : input.closest('label')?.textContent;
        const text = (input.name + input.id + label + input.placeholder).toLowerCase();

        let value = null;
        let purpose = 'unknown';

        // Match field purpose and fill with appropriate data
        if (/email/i.test(text)) {
          purpose = 'email';
          value = fillData.email;
        } else if (/phone|tel/i.test(text)) {
          purpose = 'phone';
          value = fillData.phone;
        } else if (/password/i.test(text)) {
          purpose = 'password';
          value = fillData.password || generatePassword(input);
        } else if (/first.*name|fname/i.test(text)) {
          purpose = 'firstName';
          value = fillData.firstName;
        } else if (/last.*name|lname/i.test(text)) {
          purpose = 'lastName';
          value = fillData.lastName;
        } else if (/full.*name|name/i.test(text)) {
          purpose = 'fullName';
          value = \`\${fillData.firstName} \${fillData.lastName}\`;
        } else if (/address.*1|street/i.test(text)) {
          purpose = 'address';
          value = fillData.address;
        } else if (/city/i.test(text)) {
          purpose = 'city';
          value = fillData.city;
        } else if (/state|province/i.test(text)) {
          purpose = 'state';
          value = fillData.state;
        } else if (/zip|postal/i.test(text)) {
          purpose = 'zipCode';
          value = fillData.zipCode;
        } else if (/country/i.test(text)) {
          purpose = 'country';
          value = fillData.country;
        } else if (/username|login/i.test(text)) {
          purpose = 'username';
          value = fillData.username;
        } else if (/company|organization/i.test(text)) {
          purpose = 'company';
          value = fillData.company;
        }

        // Handle different input types
        if (value !== null) {
          if (input.tagName === 'SELECT') {
            // Find matching option
            const option = Array.from(input.options).find(opt =>
              opt.value === value || opt.text.toLowerCase().includes(value.toLowerCase())
            );
            if (option) {
              input.value = option.value;
              input.dispatchEvent(new Event('change', { bubbles: true }));
              filled.push({ name: input.name, purpose, value: option.text });
            } else {
              skipped.push({ name: input.name, reason: 'no matching option' });
            }
          } else if (input.type === 'checkbox') {
            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            filled.push({ name: input.name, purpose, value: 'checked' });
          } else if (input.type === 'radio') {
            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            filled.push({ name: input.name, purpose, value: 'checked' });
          } else {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            filled.push({ name: input.name, purpose, value });
          }
        } else {
          skipped.push({ name: input.name, reason: 'purpose unknown' });
        }
      });

      function generateRealisticData() {
        return {
          firstName: 'Alex',
          lastName: 'Johnson',
          email: 'alex.johnson@example.com',
          phone: '(555) 123-4567',
          username: 'alexj' + Math.floor(Math.random() * 1000),
          password: 'SecurePass123!',
          address: '123 Main Street',
          city: 'San Francisco',
          state: 'CA',
          zipCode: '94102',
          country: 'United States',
          company: 'Acme Corporation'
        };
      }

      function generatePassword(input) {
        // Generate password based on input constraints
        const minLength = input.minLength || 8;
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
        let password = '';
        for (let i = 0; i < minLength; i++) {
          password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password;
      }

      return {
        success: true,
        filled: filled.length,
        skipped: skipped.length,
        filledFields: filled,
        skippedFields: skipped,
        message: \`Filled \${filled.length} fields, skipped \${skipped.length} fields\`
      };
    }`,
    returnType: 'Object with filled fields count and details',
    reliability: 'high',
    tags: ['form', 'fill', 'automation', 'smart']
  },

  // Macro 3: Detect password requirements
  {
    site: '*',
    category: 'form',
    name: 'detect_password_requirements',
    description: 'Analyze password field requirements from validation messages and patterns',
    parameters: {
      passwordSelector: {
        type: 'string',
        description: 'CSS selector for password field (default: input[type="password"])',
        required: false
      }
    },
    code: `(params) => {
      const passwordField = params.passwordSelector
        ? document.querySelector(params.passwordSelector)
        : document.querySelector('input[type="password"]');

      if (!passwordField) {
        return { success: false, error: 'No password field found' };
      }

      const requirements = {
        minLength: passwordField.minLength || null,
        maxLength: passwordField.maxLength || null,
        pattern: passwordField.pattern || null,
        required: passwordField.required,
        autoDetected: {}
      };

      // Look for requirement hints in nearby text
      const container = passwordField.closest('div, fieldset, form');
      if (container) {
        const text = container.textContent.toLowerCase();

        // Detect common requirements from helper text
        if (/(\d+)\s*character/i.test(text)) {
          const match = text.match(/(\d+)\s*character/i);
          requirements.autoDetected.minLength = parseInt(match[1]);
        }

        if (/uppercase|capital/i.test(text)) {
          requirements.autoDetected.requiresUppercase = true;
        }

        if (/lowercase/i.test(text)) {
          requirements.autoDetected.requiresLowercase = true;
        }

        if (/number|digit/i.test(text)) {
          requirements.autoDetected.requiresNumber = true;
        }

        if (/special.*character|symbol/i.test(text)) {
          requirements.autoDetected.requiresSpecial = true;
        }
      }

      // Analyze pattern if provided
      if (requirements.pattern) {
        const pattern = requirements.pattern;
        requirements.patternAnalysis = {
          hasUppercase: /[A-Z]/.test(pattern) || /\[A-Z\]/.test(pattern),
          hasLowercase: /[a-z]/.test(pattern) || /\[a-z\]/.test(pattern),
          hasNumber: /[0-9]/.test(pattern) || /\[0-9\]/.test(pattern),
          hasSpecial: /[^A-Za-z0-9]/.test(pattern)
        };
      }

      // Generate sample password
      requirements.samplePassword = generatePasswordFromRequirements(requirements);

      function generatePasswordFromRequirements(reqs) {
        const minLen = reqs.minLength || reqs.autoDetected.minLength || 8;
        let password = '';

        if (reqs.autoDetected.requiresUppercase || reqs.patternAnalysis?.hasUppercase) {
          password += 'ABCD';
        }

        if (reqs.autoDetected.requiresLowercase || reqs.patternAnalysis?.hasLowercase) {
          password += 'abcd';
        }

        if (reqs.autoDetected.requiresNumber || reqs.patternAnalysis?.hasNumber) {
          password += '1234';
        }

        if (reqs.autoDetected.requiresSpecial || reqs.patternAnalysis?.hasSpecial) {
          password += '!@#$';
        }

        // Pad to minimum length
        while (password.length < minLen) {
          password += 'x';
        }

        return password.substring(0, reqs.maxLength || password.length);
      }

      return {
        success: true,
        selector: params.passwordSelector || 'input[type="password"]',
        requirements: requirements,
        summary: summarizeRequirements(requirements)
      };

      function summarizeRequirements(reqs) {
        const parts = [];
        const minLen = reqs.minLength || reqs.autoDetected.minLength;
        if (minLen) parts.push(\`\${minLen}+ characters\`);
        if (reqs.autoDetected.requiresUppercase) parts.push('uppercase');
        if (reqs.autoDetected.requiresLowercase) parts.push('lowercase');
        if (reqs.autoDetected.requiresNumber) parts.push('number');
        if (reqs.autoDetected.requiresSpecial) parts.push('special character');
        return parts.join(', ') || 'No specific requirements detected';
      }
    }`,
    returnType: 'Object with password requirements and sample password',
    reliability: 'high',
    tags: ['form', 'password', 'validation', 'requirements']
  },

  // Macro 4: Detect multi-step form navigation
  {
    site: '*',
    category: 'form',
    name: 'detect_multistep_form',
    description: 'Detect if form has multiple steps and find navigation buttons',
    parameters: {
      formSelector: {
        type: 'string',
        description: 'CSS selector for form (default: first form)',
        required: false
      }
    },
    code: `(params) => {
      const form = params.formSelector
        ? document.querySelector(params.formSelector)
        : document.querySelector('form');

      if (!form) {
        return { success: false, error: 'No form found' };
      }

      const indicators = {
        hasStepIndicator: false,
        hasProgressBar: false,
        hasNextButton: false,
        hasPrevButton: false,
        currentStep: null,
        totalSteps: null,
        stepLabels: []
      };

      // Look for step indicators
      const stepIndicators = form.querySelectorAll('[class*="step"], [class*="progress"], [aria-label*="step" i]');
      if (stepIndicators.length > 0) {
        indicators.hasStepIndicator = true;

        // Try to extract step numbers
        stepIndicators.forEach(el => {
          const text = el.textContent.trim();
          const match = text.match(/step\s*(\d+)\s*(?:of|\/\/)\s*(\d+)/i);
          if (match) {
            indicators.currentStep = parseInt(match[1]);
            indicators.totalSteps = parseInt(match[2]);
          }

          if (el.classList.contains('active') || el.classList.contains('current')) {
            indicators.stepLabels.push(text);
          }
        });
      }

      // Look for progress bars
      const progressBars = form.querySelectorAll('progress, [role="progressbar"], [class*="progress"]');
      if (progressBars.length > 0) {
        indicators.hasProgressBar = true;
        progressBars.forEach(bar => {
          if (bar.value !== undefined && bar.max !== undefined) {
            indicators.progressValue = bar.value;
            indicators.progressMax = bar.max;
            indicators.progressPercent = Math.round((bar.value / bar.max) * 100);
          }
        });
      }

      // Find navigation buttons
      const buttons = form.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]');
      const nextButtons = [];
      const prevButtons = [];

      buttons.forEach(btn => {
        const text = (btn.textContent + btn.value + btn.getAttribute('aria-label')).toLowerCase();

        if (/next|continue|proceed|forward/i.test(text)) {
          nextButtons.push({
            selector: generateSelector(btn),
            text: btn.textContent.trim() || btn.value,
            disabled: btn.disabled
          });
        }

        if (/prev|previous|back/i.test(text)) {
          prevButtons.push({
            selector: generateSelector(btn),
            text: btn.textContent.trim() || btn.value,
            disabled: btn.disabled
          });
        }
      });

      indicators.hasNextButton = nextButtons.length > 0;
      indicators.hasPrevButton = prevButtons.length > 0;
      indicators.nextButtons = nextButtons;
      indicators.prevButtons = prevButtons;

      // Determine if multi-step
      const isMultiStep = indicators.hasStepIndicator ||
                          indicators.hasProgressBar ||
                          (indicators.hasNextButton && indicators.hasPrevButton);

      function generateSelector(element) {
        if (element.id) return '#' + element.id;
        if (element.name) return \`[name="\${element.name}"]\`;
        let path = element.tagName.toLowerCase();
        if (element.className) {
          path += '.' + element.className.split(' ')[0];
        }
        return path;
      }

      return {
        success: true,
        isMultiStep: isMultiStep,
        ...indicators,
        recommendation: isMultiStep
          ? 'Fill visible fields, then click Next button to proceed'
          : 'Standard single-step form'
      };
    }`,
    returnType: 'Object with multi-step detection and navigation details',
    reliability: 'high',
    tags: ['form', 'multistep', 'navigation', 'wizard']
  },

  // Macro 5: Validate form before submission
  {
    site: '*',
    category: 'form',
    name: 'validate_form_before_submit',
    description: 'Check all validation rules and report errors before submitting',
    parameters: {
      formSelector: {
        type: 'string',
        description: 'CSS selector for form (default: first form)',
        required: false
      }
    },
    code: `(params) => {
      const form = params.formSelector
        ? document.querySelector(params.formSelector)
        : document.querySelector('form');

      if (!form) {
        return { success: false, error: 'No form found' };
      }

      const validation = {
        isValid: true,
        errors: [],
        warnings: [],
        emptyRequired: [],
        patternMismatches: [],
        lengthErrors: []
      };

      const inputs = form.querySelectorAll('input, select, textarea');

      inputs.forEach(input => {
        const fieldName = input.name || input.id || input.placeholder || 'unnamed field';

        // Check required fields
        if (input.required && !input.value.trim()) {
          validation.isValid = false;
          validation.emptyRequired.push({
            name: fieldName,
            type: input.type,
            selector: generateSelector(input)
          });
          validation.errors.push(\`Required field "\${fieldName}" is empty\`);
        }

        // Check pattern validation
        if (input.pattern && input.value) {
          const regex = new RegExp(input.pattern);
          if (!regex.test(input.value)) {
            validation.isValid = false;
            validation.patternMismatches.push({
              name: fieldName,
              pattern: input.pattern,
              value: input.value,
              selector: generateSelector(input)
            });
            validation.errors.push(\`Field "\${fieldName}" doesn't match required pattern\`);
          }
        }

        // Check length constraints
        if (input.minLength && input.value.length < input.minLength) {
          validation.isValid = false;
          validation.lengthErrors.push({
            name: fieldName,
            required: input.minLength,
            actual: input.value.length,
            selector: generateSelector(input)
          });
          validation.errors.push(\`Field "\${fieldName}" too short (min: \${input.minLength}, actual: \${input.value.length})\`);
        }

        if (input.maxLength && input.value.length > input.maxLength) {
          validation.isValid = false;
          validation.lengthErrors.push({
            name: fieldName,
            required: input.maxLength,
            actual: input.value.length,
            selector: generateSelector(input)
          });
          validation.errors.push(\`Field "\${fieldName}" too long (max: \${input.maxLength}, actual: \${input.value.length})\`);
        }

        // Check email format
        if (input.type === 'email' && input.value) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(input.value)) {
            validation.isValid = false;
            validation.errors.push(\`Field "\${fieldName}" has invalid email format\`);
          }
        }

        // Check URL format
        if (input.type === 'url' && input.value) {
          try {
            new URL(input.value);
          } catch {
            validation.isValid = false;
            validation.errors.push(\`Field "\${fieldName}" has invalid URL format\`);
          }
        }

        // Check number constraints
        if (input.type === 'number' && input.value) {
          const num = parseFloat(input.value);
          if (input.min && num < parseFloat(input.min)) {
            validation.isValid = false;
            validation.errors.push(\`Field "\${fieldName}" below minimum (\${input.min})\`);
          }
          if (input.max && num > parseFloat(input.max)) {
            validation.isValid = false;
            validation.errors.push(\`Field "\${fieldName}" above maximum (\${input.max})\`);
          }
        }

        // Check browser validation API
        if (input.checkValidity && !input.checkValidity()) {
          validation.isValid = false;
          validation.errors.push(\`Field "\${fieldName}" failed browser validation: \${input.validationMessage}\`);
        }
      });

      // Look for visible error messages
      const errorMessages = form.querySelectorAll('[class*="error"], [role="alert"], .invalid-feedback');
      if (errorMessages.length > 0) {
        validation.warnings.push(\`Form has \${errorMessages.length} visible error message(s)\`);
        errorMessages.forEach(msg => {
          if (msg.textContent.trim()) {
            validation.warnings.push(msg.textContent.trim());
          }
        });
      }

      function generateSelector(element) {
        if (element.id) return '#' + element.id;
        if (element.name) return \`[name="\${element.name}"]\`;
        return element.tagName.toLowerCase();
      }

      return {
        success: true,
        isValid: validation.isValid,
        errorCount: validation.errors.length,
        warningCount: validation.warnings.length,
        errors: validation.errors,
        warnings: validation.warnings,
        emptyRequired: validation.emptyRequired,
        patternMismatches: validation.patternMismatches,
        lengthErrors: validation.lengthErrors,
        recommendation: validation.isValid
          ? 'Form is valid and ready to submit'
          : 'Fix errors before submitting'
      };
    }`,
    returnType: 'Object with validation status and error details',
    reliability: 'high',
    tags: ['form', 'validation', 'errors', 'submit']
  },

  // Macro 6: Smart form submission with retry
  {
    site: '*',
    category: 'form',
    name: 'smart_submit_form',
    description: 'Submit form with validation check and handle common errors',
    parameters: {
      formSelector: {
        type: 'string',
        description: 'CSS selector for form (default: first form)',
        required: false
      },
      validateFirst: {
        type: 'boolean',
        description: 'Validate before submitting (default: true)',
        required: false,
        default: true
      }
    },
    code: `async (params) => {
      const form = params.formSelector
        ? document.querySelector(params.formSelector)
        : document.querySelector('form');

      if (!form) {
        return { success: false, error: 'No form found' };
      }

      // Validate first if requested
      if (params.validateFirst !== false) {
        const isValid = form.checkValidity ? form.checkValidity() : true;
        if (!isValid) {
          return {
            success: false,
            error: 'Form validation failed',
            message: 'Fix validation errors before submitting'
          };
        }
      }

      // Find submit button
      const submitButton = form.querySelector('button[type="submit"], input[type="submit"]') ||
                          form.querySelector('button:not([type="button"]):not([type="reset"])');

      try {
        if (submitButton) {
          // Click submit button (preferred - triggers event handlers)
          submitButton.click();
          return {
            success: true,
            method: 'button_click',
            message: 'Form submitted via submit button'
          };
        } else {
          // Submit form directly
          form.submit();
          return {
            success: true,
            method: 'form_submit',
            message: 'Form submitted directly'
          };
        }
      } catch (error) {
        return {
          success: false,
          error: error.message,
          message: 'Form submission failed'
        };
      }
    }`,
    returnType: 'Object with submission status and method used',
    reliability: 'high',
    tags: ['form', 'submit', 'validation', 'automation']
  }
];
