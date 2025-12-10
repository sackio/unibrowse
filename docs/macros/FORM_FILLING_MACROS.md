# Smart Form Filling Macros

Comprehensive collection of 7 macros for intelligent form filling with validation, multi-step handling, realistic data generation, and automated submission.

## 📦 Storage Status

✅ **All 7 macros are stored in the MongoDB database**

To re-store or update macros:
```bash
npm run store:macros
```

## 🧪 Testing

Run the comprehensive test suite:
```bash
npm run test:form-filling-macros
```

This tests form analysis, smart filling, validation, multi-step detection, and submission on real forms.

## 📚 Macro Catalog

### Tier 1: Core Form Operations (3)

Essential macros for analyzing, filling, and validating forms.

#### 1. `analyze_form_for_filling`
**Category:** form
**Reliability:** high
**Description:** Analyze form structure comprehensively and generate optimal filling strategy with field purpose detection

**Parameters:**
- `formSelector` (string, optional): CSS selector for form (default: first form on page)

**Returns:** Object with form metadata (action, method, fieldCount), detailed fields array, fillable fields, required fields, and filling strategy

**Use case:** Understand form structure before automation, identify required fields, detect field purposes for smart filling, generate field completion order.

**Field analysis includes:**
- **Basic properties**: type, name, id, required, placeholder, value, disabled, readonly
- **Label detection**: Associated `<label>` text
- **Purpose detection**: Automatic field purpose from name/id/label/placeholder
- **Validation constraints**: pattern, minLength, maxLength, min, max, step
- **Select options**: All available options with values and text
- **Index**: Sequential field order

**Detected field purposes:**
- email, phone, password
- firstName, lastName, fullName
- address, city, state, zipCode, country
- creditCard, cvv, expiration
- username, company
- birthdate, age, gender
- unknown (for unrecognized fields)

**Filling strategy generated:**
- Order: All fields in sequential order
- Required first: Required fields prioritized
- Autofillable: Fields with detected purposes

---

#### 2. `smart_fill_form`
**Category:** form
**Reliability:** high
**Description:** Intelligently fill form fields with realistic data based on automatically detected field purpose

**Parameters:**
- `formSelector` (string, optional): CSS selector for form (default: first form)
- `data` (object, optional): Custom data object to use instead of generated data
- `fillHidden` (boolean, optional): Fill hidden fields (default: false)

**Returns:** Object with filled count, skipped count, detailed arrays of filled and skipped fields with reasons

**Use case:** Automatically fill forms with realistic test data, speed up manual testing, automate registration workflows, generate form test scenarios.

**Realistic data generated:**
- firstName: "Alex"
- lastName: "Johnson"
- email: "alex.johnson@example.com"
- phone: "(555) 123-4567"
- username: "alexj" + random number (e.g., "alexj742")
- password: "SecurePass123!" (or generated based on constraints)
- address: "123 Main Street"
- city: "San Francisco"
- state: "CA"
- zipCode: "94102"
- country: "United States"
- company: "Acme Corporation"

**Skipped field reasons:**
- Disabled or readonly
- Hidden field (unless fillHidden=true)
- Button type (submit/button/reset)
- Unknown purpose

**Field handling by type:**
- Text inputs: Direct value setting
- Select: Match by value or text
- Checkbox: Check all detected fields
- Radio: Check matched fields
- Textarea: Direct value setting

**Custom data example:**
```javascript
{
  data: {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane.doe@company.com",
    phone: "+1-555-987-6543",
    company: "Tech Corp"
  }
}
```

---

#### 3. `validate_form_before_submit`
**Category:** form
**Reliability:** high
**Description:** Comprehensive validation check of all rules and constraints, reporting errors before submission

**Parameters:**
- `formSelector` (string, optional): CSS selector for form (default: first form)

**Returns:** Object with isValid flag, error/warning counts, detailed error/warning messages, categorized validation failures

**Use case:** Pre-submission validation, automated testing, error prevention, form completion verification.

**Validation checks:**

1. **Required fields**: Empty required fields
2. **Pattern matching**: Regex pattern validation
3. **Length constraints**: minLength and maxLength
4. **Email format**: RFC-compliant email validation
5. **URL format**: Valid URL structure
6. **Number constraints**: min and max values
7. **Browser validation**: HTML5 checkValidity API
8. **Visible errors**: Existing error messages on page

**Error categories:**
- `emptyRequired`: Required fields that are empty
- `patternMismatches`: Fields failing pattern validation
- `lengthErrors`: Fields with incorrect length
- Generic errors: Email, URL, number, browser validation failures

**Warnings:**
- Visible error messages on page (may indicate previous validation failures)

**Recommendation:**
- "Form is valid and ready to submit" if valid
- "Fix errors before submitting" if invalid

---

### Tier 2: Specialized Analysis (2)

Deep analysis macros for understanding form requirements and structure.

#### 4. `detect_password_requirements`
**Category:** form
**Reliability:** high
**Description:** Analyze password field requirements from validation messages, patterns, and helper text

**Parameters:**
- `passwordSelector` (string, optional): CSS selector for password field (default: input[type="password"])

**Returns:** Object with requirements (minLength, maxLength, pattern), auto-detected rules from text, pattern analysis, sample password, and human-readable summary

**Use case:** Generate valid passwords for automated registration, understand password complexity requirements, test password validation, configure password generators.

**Detection sources:**

1. **Input attributes**:
   - minLength, maxLength
   - pattern (regex)
   - required flag

2. **Helper text analysis** (from nearby text):
   - Character length ("8 characters" → minLength: 8)
   - Uppercase requirement ("uppercase" or "capital")
   - Lowercase requirement ("lowercase")
   - Number requirement ("number" or "digit")
   - Special character requirement ("special character" or "symbol")

3. **Pattern analysis**:
   - Uppercase detection: `/[A-Z]/` or `/\[A-Z\]/`
   - Lowercase detection: `/[a-z]/` or `/\[a-z\]/`
   - Number detection: `/[0-9]/` or `/\[0-9\]/`
   - Special character detection: `/[^A-Za-z0-9]/`

**Sample password generation:**
- Includes required character types:
  - Uppercase: "ABCD"
  - Lowercase: "abcd"
  - Numbers: "1234"
  - Special: "!@#$"
- Pads to minimum length with "x"
- Truncates to maximum length if specified
- Example: "ABCDabcd1234!@#$xxx" (for minLength=20)

**Summary format:**
"12+ characters, uppercase, lowercase, number, special character"

---

#### 5. `detect_multistep_form`
**Category:** form
**Reliability:** high
**Description:** Detect multi-step form structure and find navigation buttons for wizard-style forms

**Parameters:**
- `formSelector` (string, optional): CSS selector for form (default: first form)

**Returns:** Object with multi-step detection flags, current step, total steps, progress info, navigation buttons, and step labels

**Use case:** Detect wizard-style forms, automate multi-step workflows, determine form completion progress, locate navigation controls.

**Detection indicators:**

1. **Step indicators**:
   - Elements with "step" in class
   - Progress indicators
   - ARIA labels with "step"
   - Extract "Step X of Y" patterns

2. **Progress bars**:
   - `<progress>` elements
   - `[role="progressbar"]`
   - Elements with "progress" class
   - Extract value/max/percentage

3. **Navigation buttons**:
   - **Next**: "next", "continue", "proceed", "forward"
   - **Previous**: "prev", "previous", "back"
   - Button text, value, or aria-label matching

**Returned information:**
- `isMultiStep`: Boolean flag
- `hasStepIndicator`: Step counter detected
- `hasProgressBar`: Progress bar detected
- `hasNextButton`: Next button found
- `hasPrevButton`: Previous button found
- `currentStep`: Current step number (if detected)
- `totalSteps`: Total steps (if detected)
- `stepLabels`: Active step labels
- `progressPercent`: Progress percentage (if progress bar)
- `nextButtons`: Array of next buttons with selectors
- `prevButtons`: Array of previous buttons with selectors

**Recommendation:**
- "Fill visible fields, then click Next button to proceed" if multi-step
- "Standard single-step form" if not multi-step

---

### Tier 3: Submission and Workflow (2)

Macros for form submission and complete form filling workflows.

#### 6. `smart_submit_form`
**Category:** form
**Reliability:** high
**Description:** Submit form with optional pre-validation and intelligent button detection

**Parameters:**
- `formSelector` (string, optional): CSS selector for form (default: first form)
- `validateFirst` (boolean, optional): Validate before submitting (default: true)

**Returns:** Object with success flag, submission method used (button_click or form_submit), and status message

**Use case:** Automated form submission, testing form workflows, end-to-end automation, validation-aware submission.

**Submission strategy:**

1. **Optional validation**:
   - Calls `form.checkValidity()` if available
   - Returns error if validation fails
   - Can be disabled with `validateFirst: false`

2. **Submit button detection**:
   - `button[type="submit"]`
   - `input[type="submit"]`
   - Generic `<button>` (not type="button" or type="reset")

3. **Submission methods**:
   - **Preferred**: Click submit button (triggers event handlers)
   - **Fallback**: Call `form.submit()` directly

**Error handling:**
- Catches and returns submission errors
- Provides clear error messages
- Returns method used for debugging

**States:**
- Success with button_click
- Success with form_submit
- Failure with validation error
- Failure with exception

---

#### 7. `analyze_form_requirements`
**Category:** form
**Reliability:** high
**Description:** Deep analysis of form validation requirements and constraints for test data generation

**Parameters:**
- `formSelector` (string, optional): CSS selector for form (default: first form)

**Returns:** Object with total field count, required field count, detailed validation rules, field constraints, and password requirements

**Use case:** Generate appropriate test data, understand validation complexity, prepare automated testing, validate form accessibility.

**Analysis includes:**

1. **Field counts**:
   - Total fields
   - Required fields
   - Optional fields

2. **Validation rules per field**:
   - Required flag
   - Pattern regex
   - Min/max length
   - Min/max value
   - Step value
   - Input type
   - Email/URL validation

3. **Constraints detection**:
   - Character limits
   - Numeric ranges
   - Date ranges
   - Pattern complexity
   - Select option counts

4. **Password requirements**:
   - Minimum/maximum length
   - Character type requirements
   - Pattern rules
   - Sample valid password

5. **Field categorization**:
   - Text inputs
   - Email/URL inputs
   - Number inputs
   - Date inputs
   - Select dropdowns
   - Checkboxes/radios
   - Textareas

**Use with `generate_form_test_data`:**
This macro is designed to work with the `generate_form_test_data` macro from the Advanced Macros collection for intelligent test data generation.

---

## 🎯 Usage Examples

### Example 1: Complete Form Filling Workflow
```javascript
// Step 1: Analyze form structure
const analysis = await browser_execute_macro({
  id: "macro-id-for-analyze_form_for_filling",
  params: { formSelector: "#registration-form" }
});
// Result: {
//   success: true,
//   formSelector: "#registration-form",
//   action: "/register",
//   method: "POST",
//   fieldCount: 8,
//   requiredFields: 5,
//   fields: [...],
//   fillable: [...],
//   strategy: { order: [...], requiredFirst: [...], autofillable: [...] }
// }

// Step 2: Smart fill with realistic data
const filled = await browser_execute_macro({
  id: "macro-id-for-smart_fill_form",
  params: { formSelector: "#registration-form" }
});
// Result: {
//   success: true,
//   filled: 7,
//   skipped: 1,
//   filledFields: [
//     { name: "email", purpose: "email", value: "alex.johnson@example.com" },
//     { name: "firstName", purpose: "firstName", value: "Alex" },
//     ...
//   ],
//   skippedFields: [
//     { name: "terms", reason: "purpose unknown" }
//   ]
// }

// Step 3: Validate before submission
const validation = await browser_execute_macro({
  id: "macro-id-for-validate_form_before_submit",
  params: { formSelector: "#registration-form" }
});
// Result: {
//   success: true,
//   isValid: false,
//   errorCount: 1,
//   errors: ["Required field 'terms' is empty"],
//   recommendation: "Fix errors before submitting"
// }

// Step 4: Fix errors manually, then submit
if (validation.isValid) {
  const submit = await browser_execute_macro({
    id: "macro-id-for-smart_submit_form",
    params: { formSelector: "#registration-form" }
  });
}
```

### Example 2: Multi-Step Form Handling
```javascript
// Detect if form has multiple steps
const multiStep = await browser_execute_macro({
  id: "macro-id-for-detect_multistep_form",
  params: { formSelector: "#wizard-form" }
});
// Result: {
//   success: true,
//   isMultiStep: true,
//   hasStepIndicator: true,
//   hasNextButton: true,
//   hasPrevButton: false,
//   currentStep: 1,
//   totalSteps: 3,
//   stepLabels: ["Personal Information"],
//   nextButtons: [
//     { selector: "#btn-next", text: "Continue", disabled: false }
//   ],
//   recommendation: "Fill visible fields, then click Next button to proceed"
// }

// Fill step 1, then navigate
await browser_execute_macro({
  id: "macro-id-for-smart_fill_form",
  params: { formSelector: "#wizard-form" }
});

// Click next button
await browser_click({
  element: "Next button",
  ref: multiStep.nextButtons[0].selector
});

// Repeat for subsequent steps...
```

### Example 3: Password Field Analysis
```javascript
// Analyze password requirements
const pwdReqs = await browser_execute_macro({
  id: "macro-id-for-detect_password_requirements",
  params: { passwordSelector: "#new-password" }
});
// Result: {
//   success: true,
//   selector: "#new-password",
//   requirements: {
//     minLength: 8,
//     maxLength: null,
//     pattern: "(?=.*\\d)(?=.*[a-z])(?=.*[A-Z]).{8,}",
//     required: true,
//     autoDetected: {
//       minLength: 12,
//       requiresUppercase: true,
//       requiresLowercase: true,
//       requiresNumber: true,
//       requiresSpecial: true
//     },
//     patternAnalysis: {
//       hasUppercase: true,
//       hasLowercase: true,
//       hasNumber: true,
//       hasSpecial: false
//     },
//     samplePassword: "ABCDabcd1234xxxx"
//   },
//   summary: "12+ characters, uppercase, lowercase, number, special character"
// }

// Use sample password for filling
await browser_type({
  element: "password field",
  ref: "#new-password",
  text: pwdReqs.requirements.samplePassword,
  submit: false
});
```

### Example 4: Custom Data Filling
```javascript
// Fill form with custom data object
const customData = {
  firstName: "Jane",
  lastName: "Smith",
  email: "jane.smith@company.com",
  phone: "+1-555-123-4567",
  company: "TechCorp Inc.",
  address: "456 Tech Avenue",
  city: "Austin",
  state: "TX",
  zipCode: "78701"
};

const filled = await browser_execute_macro({
  id: "macro-id-for-smart_fill_form",
  params: {
    formSelector: "#contact-form",
    data: customData,
    fillHidden: false
  }
});
// Result: {
//   success: true,
//   filled: 9,
//   skipped: 0,
//   filledFields: [...],
//   message: "Filled 9 fields, skipped 0 fields"
// }
```

### Example 5: Validation-Only Check
```javascript
// Validate without filling (for existing data)
const validation = await browser_execute_macro({
  id: "macro-id-for-validate_form_before_submit",
  params: { formSelector: "#checkout-form" }
});

if (!validation.isValid) {
  console.log("Errors found:");
  validation.errors.forEach(error => console.log("  -", error));

  console.log("\nEmpty required fields:");
  validation.emptyRequired.forEach(field => {
    console.log(`  - ${field.name} (${field.type}): ${field.selector}`);
  });

  console.log("\nPattern mismatches:");
  validation.patternMismatches.forEach(field => {
    console.log(`  - ${field.name}: ${field.value} doesn't match ${field.pattern}`);
  });
}
```

### Example 6: Form Requirements Deep Analysis
```javascript
// Analyze form requirements for test planning
const reqs = await browser_execute_macro({
  id: "macro-id-for-analyze_form_requirements",
  params: { formSelector: "#signup-form" }
});
// Result: {
//   success: true,
//   totalFields: 12,
//   requiredFields: 8,
//   validationRules: {
//     email: { required: true, pattern: "email", type: "email" },
//     password: { required: true, minLength: 12, pattern: "..." },
//     age: { required: true, min: 18, max: 120, type: "number" },
//     ...
//   },
//   constraints: {
//     characterLimits: { bio: { max: 500 } },
//     numericRanges: { age: { min: 18, max: 120 } },
//     patternComplexity: { email: "medium", password: "high" }
//   },
//   passwordRequirements: {
//     minLength: 12,
//     requiresUppercase: true,
//     requiresLowercase: true,
//     requiresNumber: true,
//     requiresSpecial: true,
//     samplePassword: "ABCDabcd1234!@#$"
//   }
// }
```

### Example 7: Submit with Validation
```javascript
// Submit with automatic validation
const submit = await browser_execute_macro({
  id: "macro-id-for-smart_submit_form",
  params: {
    formSelector: "#login-form",
    validateFirst: true
  }
});

if (submit.success) {
  console.log(`Form submitted via ${submit.method}`);
} else {
  console.log(`Submission failed: ${submit.error}`);
}
```

### Example 8: Complete Registration Flow
```javascript
// 1. Detect multi-step form
const structure = await browser_execute_macro({
  id: "macro-id-for-detect_multistep_form",
  params: {}
});

if (structure.isMultiStep) {
  // Multi-step: handle each step
  for (let step = 1; step <= structure.totalSteps; step++) {
    // Fill current step
    await browser_execute_macro({
      id: "macro-id-for-smart_fill_form",
      params: {}
    });

    // Validate
    const valid = await browser_execute_macro({
      id: "macro-id-for-validate_form_before_submit",
      params: {}
    });

    if (!valid.isValid) {
      throw new Error("Validation failed on step " + step);
    }

    // Click next (or submit on last step)
    if (step < structure.totalSteps) {
      await browser_click({
        element: "next button",
        ref: structure.nextButtons[0].selector
      });
      await browser_wait({ time: 1 });
    } else {
      await browser_execute_macro({
        id: "macro-id-for-smart_submit_form",
        params: {}
      });
    }
  }
} else {
  // Single-step: fill and submit
  await browser_execute_macro({
    id: "macro-id-for-smart_fill_form",
    params: {}
  });

  await browser_execute_macro({
    id: "macro-id-for-smart_submit_form",
    params: { validateFirst: true }
  });
}
```

## 🔍 Finding Macro IDs

To get the macro ID for use in `browser_execute_macro`:

```javascript
// List all form macros
const macros = await browser_list_macros({ site: "*", category: "form" });

// Find the macro you need
const targetMacro = macros.macros.find(m => m.name === "smart_fill_form");
const macroId = targetMacro.id;
```

## 📊 Field Purpose Detection

The macros automatically detect field purposes from multiple sources:

### Detection Sources (in order of precedence):
1. Input name attribute
2. Input id attribute
3. Associated label text
4. Placeholder text

### Regular Expressions Used:
- Email: `/email/i`
- Phone: `/phone|tel/i`
- Password: `/password/i`
- First name: `/first.*name|fname/i`
- Last name: `/last.*name|lname/i`
- Full name: `/full.*name|name/i`
- Address: `/address.*1|street/i`
- City: `/city/i`
- State: `/state|province/i`
- Zip code: `/zip|postal/i`
- Country: `/country/i`
- Credit card: `/card.*number|credit/i`
- CVV: `/cvv|cvc/i`
- Expiration: `/exp|expir/i`
- Username: `/username|login/i`
- Company: `/company|organization/i`
- Birthdate: `/birth|dob/i`
- Age: `/age/i`
- Gender: `/gender|sex/i`

## 🚀 Best Practices

1. **Analyze Before Filling**: Always use `analyze_form_for_filling` first to understand form structure
2. **Validate Before Submit**: Use `validate_form_before_submit` to catch errors early
3. **Handle Multi-Step**: Detect multi-step forms with `detect_multistep_form` before automation
4. **Custom Data**: Provide custom data object to `smart_fill_form` for specific test scenarios
5. **Password Analysis**: Use `detect_password_requirements` for complex password fields
6. **Error Handling**: Check `success` flags and handle skipped fields appropriately
7. **Event Triggers**: All macros properly trigger input/change events for validation
8. **Hidden Fields**: Be cautious with `fillHidden` - usually leave false to avoid breaking form logic

## 🔄 Integration with Other Macros

Form filling macros work well with:

- **Form Controls Macros**:
  - `detect_advanced_form_controls` - Detect complex controls
  - `fill_date_picker` - Fill date fields
  - `set_custom_select` - Fill custom dropdowns
  - `set_rich_text_editor` - Fill WYSIWYG editors

- **Utility Macros**:
  - `discover_forms` - Find all forms on page
  - `get_form_state` - Check completion status
  - `detect_messages` - Check for errors after submission

- **Advanced Macros**:
  - `generate_form_test_data` - Generate test data based on requirements
  - `audit_accessibility` - Check form accessibility

## 🛠️ Development

All macros are defined in `form-filling-macros.js` and organized in 3 tiers.

To modify or add macros:
1. Edit `form-filling-macros.js`
2. Run `npm run store:macros` to update the database
3. Run `npm run test:form-filling-macros` to verify functionality

## 📝 Notes

- All macros are universal (site: "*") and work on any website
- Field purpose detection is intelligent but not perfect - verify critical fields
- Password generation respects detected constraints
- Multi-step detection works with common patterns (may miss custom implementations)
- Validation uses both HTML5 API and custom checks for comprehensive coverage
- Skipped fields are normal and expected (disabled, hidden, unknown purpose)
- Events are properly triggered to ensure JavaScript validation runs

## 🎯 Quick Reference

### Analysis
- `analyze_form_for_filling` - Complete form structure analysis
- `detect_password_requirements` - Password field requirements
- `detect_multistep_form` - Multi-step form detection
- `analyze_form_requirements` - Deep validation analysis

### Filling
- `smart_fill_form` - Intelligent auto-fill with realistic data

### Validation
- `validate_form_before_submit` - Pre-submission validation

### Submission
- `smart_submit_form` - Validated form submission

## 🔧 Troubleshooting

### Fields Not Filled
- Check if field is disabled/readonly
- Verify field purpose is detected (check analysis output)
- Provide custom data object with exact field names
- Enable `fillHidden` if needed

### Validation Fails
- Review `errors` array for specific issues
- Check `emptyRequired` for missing required fields
- Review `patternMismatches` for format issues
- Check `lengthErrors` for size constraints

### Multi-Step Not Detected
- Verify form has clear step indicators
- Check for progress bars or step counters
- Look for next/previous buttons with standard text
- May need manual step detection for custom implementations

### Password Requirements Not Detected
- Check for helper text near password field
- Verify pattern attribute exists
- May need to manually provide password based on visible requirements
- Use sample password as starting point and adjust

### Submit Fails
- Ensure validation passes first
- Check for disabled submit button
- Verify no modals or overlays blocking submission
- Check browser console for JavaScript errors
