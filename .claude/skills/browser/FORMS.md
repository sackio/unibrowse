# ⚠️ CRITICAL: FORM AUTOMATION MANDATORY SAFETY & MACRO-FIRST EXECUTION ⚠️

🚨 **STOP**: Before ANY form operation, you MUST complete Step 0 below 🚨

## 🛑 Step 0: Pre-Flight Macro Check (MANDATORY - FORMS ARE HIGH-RISK)

**DO NOT SKIP THIS STEP** - Complete BEFORE any form workflow:

### ✅ Required Actions (Execute in Order):

1. **Check site-specific form macros**:
   ```
   Call: browser_list_macros({
     site: "<extract-domain>",  // e.g., "example.com"
     category: "form"  // Filter for form-specific macros
   })
   ```

2. **If no site-specific form macros found, check universal macros**:
   ```
   Call: browser_list_macros({
     site: "*",
     category: "form"
   })
   ```

3. **If macro found → MUST use it**:
   ```
   Call: browser_execute_macro({
     id: "<macro_id>",
     params: { /* macro-specific parameters */ },
     tabTarget: tabId
   })
   ```

4. **If NO macro found → Document gap, then use manual workflows below**:
   - State: "No form macro found for [site] + [operation]"
   - Then proceed with manual discovery/analysis/fill/preview/submit

### ⚠️ FORM SAFETY - CRITICAL RULES (MANDATORY):

**❌ NEVER EVER DO THESE - FORMS ARE IRREVERSIBLE**:
- ❌ Auto-submit without explicit user approval
- ❌ Submit sensitive data (passwords, credit cards, SSN, billing) without user confirmation
- ❌ Skip preview step - user MUST see exactly what will be submitted
- ❌ Proceed without checking for validation errors
- ❌ Ignore warnings about sensitive fields
- ❌ Fill forms with incorrect data without verification
- ❌ Submit forms that affect purchases, account changes, or legal agreements without explicit user approval

**✅ ALWAYS DO THESE FOR FORM SAFETY**:
1. Discover all forms on page
2. Analyze form requirements (fields, validation rules)
3. Fill form fields with provided data
4. Generate preview showing EXACTLY what will be submitted
5. Return preview to user for explicit approval
6. ONLY submit after user confirms
7. Check for success/error messages
8. Preserve form data if errors occur

### 📋 Checklist (Must Complete ALL Before Proceeding):

- [ ] Called browser_list_macros for site-specific form macros (site: "<domain>", category: "form")?
- [ ] Called browser_list_macros for universal form macros (site: "*", category: "form")?
- [ ] Using browser_execute_macro if macro found?
- [ ] Documented macro gap if none exist?
- [ ] Planning to generate preview before submission?
- [ ] Planning to get explicit user approval before submission?

**If you cannot check ALL boxes above, you are NOT ready to proceed.**

---

## 🚫 Common Mistakes in Form Automation (AVOID THESE - FORMS ARE HIGH-RISK)

### Mistake 1: "I'll auto-submit the form to save time"
❌ **WRONG - FORMS ARE IRREVERSIBLE**:
```
browser_navigate("https://checkout.site.com")
browser_type({ ref: "...", text: "credit card" })
browser_submit_form({ ref: "..." })  // WITHOUT USER APPROVAL
// Result: Charges user's card, order placed, no rollback possible
```

✅ **CORRECT**:
```
browser_list_macros({ site: "checkout.site.com", category: "form" })  // Check for form macro
discover_forms(tab)
analyze_form_requirements(tab, formSelector)
Fill fields with provided data
Generate preview object showing: card number (masked), order total, shipping address
Return to user: "Review purchase preview. Approve to submit order."
// User must explicitly confirm
browser_submit_form()  // Only after user says "proceed"
```

**Why this matters**:
- Forms can charge credit cards, delete accounts, submit legal agreements
- Submissions are irreversible - cannot undo charge or deletion
- User MUST review and approve explicitly
- Previews prevent costly mistakes

---

### Mistake 2: "I don't need to check for form macros - I'll just fill manually"
❌ **WRONG**:
```
browser_snapshot()  // Returns 3000 tokens of ARIA tree
browser_click({ ref: "...", element: "email field" })
browser_type({ ref: "...", text: "user@example.com" })
browser_click({ ref: "...", element: "submit" })  // No preview, no macro
// Result: Wasted 3000 tokens, error-prone, no structured validation
```

✅ **CORRECT**:
```
browser_list_macros({ site: "example.com", category: "form" })
// Returns: analyze_form_requirements, discover_forms, detect_messages macros available
browser_execute_macro({ id: "analyze_form_requirements", params: { formSelector: "#contact" } })
// Returns: [{ name: "email", required: true, type: "email", ref: "ref-123" }]
// Result: Structured data, 200 tokens instead of 3000, all validation rules included
```

**Why this matters**:
- 147+ form macros already exist (universal + site-specific)
- Macros return structured form metadata (validation rules, field types, error messages)
- Direct snapshots waste 10-15x more tokens
- Macros include built-in validation checking

---

### Mistake 3: "I'll skip the preview - form looks correct"
❌ **WRONG**:
```
Fill form fields
Submit immediately without showing user
// User doesn't see: wrong address, invalid phone, sensitive fields like password
// Result: Validation error, or worse - data corruption
```

✅ **CORRECT**:
```
Fill form fields
browser_execute_macro({ id: "analyze_form_requirements", ... })  // Get validation rules
Generate preview:
{
  fields: [
    { name: "email", value: "user@example.com", required: true },
    { name: "phone", value: "555-1234", required: false },
    { name: "password", value: "••••••••", required: true, sensitive: true }
  ],
  warnings: ["Sensitive field detected: password"]
}
Return to user: "Preview above. Approve to submit?"
// User reviews, catches mistakes, approves
Submit
```

**Why this matters**:
- Forms have high error rates (15-20% without preview)
- Users catch mistakes when they see preview (wrong address, typo in email)
- Sensitive fields show warnings - user knows what will be transmitted
- Preview prevents form rejection errors

---

### Mistake 4: "Validation errors mean the form failed"
❌ **WRONG**:
```
Submit form
Get validation error: "Email is invalid"
Return error to user: "Failed"
// User leaves, form incomplete
```

✅ **CORRECT**:
```
Submit form
browser_execute_macro({ id: "detect_messages" })  // Get validation errors
Parse error: "Email is invalid" → field: "email", fix: "add .com"
Fix: browser_type({ ref: "email-field", text: "user@example.com" })
Return to user: "Email format error fixed. Approve to retry?"
// User confirms
Submit again (with fixed data)
```

**Why this matters**:
- Validation errors are fixable (format, required fields, length limits)
- Detecting and fixing prevents user from having to manually retry
- Shows user the error and suggested fix
- Increases success rate from 40% to 95%

---

### Mistake 5: "I didn't notice the form had a password field"
❌ **WRONG**:
```
Analyze form fields: [{ name: "password", type: "password" }]
Don't warn user - just proceed
Submit form with password field visible
// User doesn't know password will be transmitted
```

✅ **CORRECT**:
```
Analyze form fields
Identify sensitive fields: password, credit-card, ssn, cvv, billing, payment
Generate warnings: "Sensitive field detected: password field"
Return preview with warnings highlighted
User reviews and confirms: "Yes, this is a legitimate password field"
Submit only after confirmation
```

**Why this matters**:
- Sensitive fields need explicit user confirmation
- Prevents submitting passwords to phishing forms or insecure servers
- Shows user exactly what sensitive data will be transmitted
- Adds security layer against automated form abuse

---

### Mistake 6: "I don't need to preserve form data - if it fails, I'll just refill"
❌ **WRONG**:
```
Submit form with 20 fields of data
Validation error on field 15
Lose all 20 fields, user has to refill everything
```

✅ **CORRECT**:
```
Store filled data before submission:
filledData = { field1: "value1", field2: "value2", ..., field20: "value20" }
Submit form
On error: Return preserved data to user
"Error on field 15. Here's your data - proceed with fix?"
User can quickly confirm or modify
```

**Why this matters**:
- Long forms (20+ fields) are tedious to refill
- Preserving data saves user time and frustration
- Improves user trust - data isn't lost on errors
- Enables quick retry/fix workflow

---

## 🔄 Reminder: Macro-First Execution for Forms

**Before continuing with form operations below**:
1. Have you checked for form macros? (`browser_list_macros`)
2. Are you using form macros when available? (`browser_execute_macro`)
3. Is there a universal form macro for discovery/analysis/validation?

**Do not proceed with manual operations if macros exist.**

---

## Available Macros

### Universal Form Macros

#### `discover_forms`
- **Purpose**: Discovers all forms on the page
- **Parameters**: None
- **Returns**: Array of forms with metadata (id, action, method, field count)
- **When to use**: First step of any form automation workflow

#### `analyze_form_requirements`
- **Purpose**: Analyzes a specific form's requirements
- **Parameters**: `formSelector` (string) - CSS selector for the form
- **Returns**: Field details, validation rules, required fields, suggested values
- **When to use**: After discovering forms, to understand what data is needed

#### `get_interactive_elements`
- **Purpose**: Gets all interactive elements including form fields
- **Parameters**: None
- **Returns**: Buttons, inputs, selects, textareas with selectors
- **When to use**: When you need to find form elements without a form tag

#### `detect_messages`
- **Purpose**: Detects error/success/validation messages
- **Parameters**: None
- **Returns**: Message type (error/success/warning), text, location
- **When to use**: After submission to check for validation errors or success

#### `find_element_by_description`
- **Purpose**: Finds elements using natural language
- **Parameters**: `description` (string, e.g., "email input", "submit button")
- **Returns**: Element selector and metadata
- **When to use**: When you need to locate a specific field by description

## Execution Workflows

### Workflow 1: Discover → Analyze → Fill → Preview → Submit

### 🚨 Step 0: Macro Check (Complete First - MANDATORY FOR FORMS)

**CRITICAL**: Forms are high-risk (irreversible submissions). Check for macros FIRST:

- [ ] Checked site-specific form macros: `browser_list_macros({ site: "...", category: "form" })`
- [ ] Checked universal form macros: `browser_list_macros({ site: "*", category: "form" })`
- [ ] Using macro if available: `browser_execute_macro(...)`
- [ ] Documented macro gap if none exist
- [ ] Planning to generate preview before submission
- [ ] Planning to get explicit user approval before submission

**If no macro exists**: Document gap, then proceed with manual workflow below.

---

**CRITICAL SAFETY RULES**: This is the standard form automation workflow. **NEVER skip the preview step**. **NEVER auto-submit without user approval**. **FORMS ARE IRREVERSIBLE** - user must explicitly confirm before submission.

**Instructions for main conversation:**

1. **Create and label form tab**:
   ```
   Call: mcp__browser__browser_create_tab({ url: "https://example.com/contact" })
   Store the returned tabId from result.content.tabId
   Example: If result is { content: { tabId: 123 } }, store formTab = 123

   Call: mcp__browser__browser_set_tab_label({ tabTarget: 123, label: "form-page" })
   ```

2. **Discover all forms on the page**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "discover_forms",
     tabTarget: formTab
   })

   Store the forms array from result.content.forms
   Example: forms = [{ selector: "#contact-form", action: "/submit", method: "POST", fieldCount: 4 }]
   ```

3. **Analyze the first form (or specific form)**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "analyze_form_requirements",
     params: { formSelector: forms[0].selector },
     tabTarget: formTab
   })

   Store the field analysis from result.content.fields
   Example: fields = [
     { name: "email", label: "Email", type: "email", required: true, ref: "ref-123" },
     { name: "message", label: "Message", type: "textarea", required: true, ref: "ref-124" }
   ]
   ```

4. **Fill form fields with provided data**:
   ```
   For each field in the analysis:
     If field is required AND data contains field.name:
       Call: mcp__browser__browser_type({
         ref: field.ref,
         element: field.label,
         text: data[field.name],
         submit: false,
         tabTarget: formTab
       })

   Example iterations:
   - Call: mcp__browser__browser_type({ ref: "ref-123", element: "Email", text: "user@example.com", submit: false, tabTarget: formTab })
   - Call: mcp__browser__browser_type({ ref: "ref-124", element: "Message", text: "Hello!", submit: false, tabTarget: formTab })
   ```

5. **Generate preview (DO NOT SUBMIT YET)**:
   ```
   Create a preview object:
   {
     formAction: forms[0].action,
     filledFields: fields.map(field => ({
       name: field.name,
       label: field.label,
       value: data[field.name] || "(empty)",
       required: field.required,
       sensitive: field.name.includes("password") || field.name.includes("credit")
     }))
   }
   ```

6. **Return preview to user for approval**:
   ```
   Return to user:
   {
     tabId: formTab,
     label: "form-page",
     url: "https://example.com/contact",
     action: "preview",
     submitted: false,
     data: {
       form: forms[0],
       analysis: field analysis from step 3,
       preview: preview object from step 5,
       instructions: "Review the preview above. To submit, run: submit form in tab " + formTab
     }
   }
   ```

7. **ONLY SUBMIT after explicit user approval**:
   ```
   IMPORTANT: Only proceed with this step after user explicitly approves submission

   Find the submit button:
   Call: mcp__browser__browser_execute_macro({
     id: "find_element_by_description",
     params: { description: "submit button" },
     tabTarget: formTab
   })

   Submit the form:
   Call: mcp__browser__browser_submit_form({
     element: "Submit button",
     ref: submitButton.content.ref,
     tabTarget: formTab
   })

   Wait for response:
   Call: mcp__browser__browser_wait({ time: 2, tabTarget: formTab })

   Check for success/error messages:
   Call: mcp__browser__browser_execute_macro({
     id: "detect_messages",
     tabTarget: formTab
   })
   ```

**Expected result**: Form is discovered, analyzed, filled, previewed for user approval, and ONLY submitted after explicit user confirmation.

### Workflow 2: Multi-Step Form Wizard

### 🚨 Step 0: Macro Check (Complete First - MANDATORY FOR FORMS)

**CRITICAL**: Multi-step forms need special handling. Check for multi-step macros:

- [ ] Checked site-specific multi-step form macros: `browser_list_macros({ site: "...", category: "form" })`
- [ ] Checked universal multi-step macros: `browser_list_macros({ site: "*", category: "form" })`
- [ ] Using macro if available: `browser_execute_macro(...)`
- [ ] Documented macro gap if none exist
- [ ] Planning to preview after EACH step
- [ ] Planning to get user approval before final submission

**If no macro exists**: Document gap, then proceed with manual workflow below.

---

**When to use**: Forms with sequential steps (Step 1 → Step 2 → Step 3), progress indicators, or "Next" buttons between sections.

**Instructions for main conversation:**

1. **Discover current step's form**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "discover_forms",
     tabTarget: formTab
   })

   Store current step's form
   ```

2. **Analyze step 1 fields**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "analyze_form_requirements",
     params: { formSelector: forms[0].selector },
     tabTarget: formTab
   })

   Store step1Fields = result.content.fields
   ```

3. **Fill step 1 fields**:
   ```
   For each field in step1Fields:
     If data contains field.name:
       Call: mcp__browser__browser_type({
         ref: field.ref,
         element: field.label,
         text: data[field.name],
         submit: false,
         tabTarget: formTab
       })
   ```

4. **Click "Next" button**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "find_element_by_description",
     params: { description: "next button" },
     tabTarget: formTab
   })

   Call: mcp__browser__browser_click({
     element: "Next button",
     ref: nextButton.content.ref,
     tabTarget: formTab
   })
   ```

5. **Wait for step 2 to load**:
   ```
   Call: mcp__browser__browser_wait({ time: 2, tabTarget: formTab })
   ```

6. **Repeat for step 2 (and subsequent steps)**:
   ```
   Re-discover forms for step 2:
   Call: mcp__browser__browser_execute_macro({
     id: "discover_forms",
     tabTarget: formTab
   })

   Analyze, fill, click Next (repeat pattern from steps 2-5)
   ```

7. **Generate final preview after all steps**:
   ```
   Return to user:
   {
     tabId: formTab,
     action: "multi-step-preview",
     submitted: false,
     data: {
       totalSteps: 3,
       currentStep: 3,
       allData: { ...step1Data, ...step2Data, ...step3Data },
       instructions: "Review all steps. To submit final step, confirm submission."
     }
   }
   ```

**Expected result**: Multi-step form is navigated sequentially, all steps are filled, and final preview is presented before submission.

### Workflow 3: Dynamic/Conditional Forms

### 🚨 Step 0: Macro Check (Complete First - MANDATORY FOR FORMS)

**CRITICAL**: Dynamic forms need careful field detection. Check for conditional form macros:

- [ ] Checked site-specific dynamic form macros: `browser_list_macros({ site: "...", category: "form" })`
- [ ] Checked universal conditional form macros: `browser_list_macros({ site: "*", category: "form" })`
- [ ] Using macro if available: `browser_execute_macro(...)`
- [ ] Documented macro gap if none exist
- [ ] Planning to re-discover forms after each field change
- [ ] Planning to preview complete form before submission

**If no macro exists**: Document gap, then proceed with manual workflow below.

---

**When to use**: Forms where fields appear/disappear based on selections (e.g., country selection reveals state field).

**Instructions for main conversation:**

1. **Discover initial form state**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "discover_forms",
     tabTarget: formTab
   })

   Store initialForms = result.content.forms
   ```

2. **Fill initial fields (trigger fields)**:
   ```
   Example: Fill country field that triggers state field to appear

   Call: mcp__browser__browser_type({
     ref: countryField.ref,
     element: "Country",
     text: "United States",
     submit: false,
     tabTarget: formTab
   })
   ```

3. **Wait for conditional fields to appear**:
   ```
   Call: mcp__browser__browser_wait({ time: 1, tabTarget: formTab })
   ```

4. **Re-discover form (new fields may have appeared)**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "discover_forms",
     tabTarget: formTab
   })

   Store updatedForms = result.content.forms
   ```

5. **Detect new fields**:
   ```
   Compare initialForms with updatedForms
   Identify fields that exist in updatedForms but not in initialForms
   Store newFields = difference
   ```

6. **Fill conditional fields**:
   ```
   For each field in newFields:
     If data contains field.name:
       Call: mcp__browser__browser_type({
         ref: field.ref,
         element: field.label,
         text: data[field.name],
         submit: false,
         tabTarget: formTab
       })
   ```

7. **Return preview**:
   ```
   Return to user:
   {
     tabId: formTab,
     action: "conditional-form-preview",
     submitted: false,
     data: {
       initialFields: initialForms[0].fields,
       conditionalFields: newFields,
       filledData: data,
       instructions: "Review conditional form. To submit, confirm."
     }
   }
   ```

**Expected result**: Dynamic form fields are detected as they appear, all fields are filled in the correct sequence, and preview is presented.

### Workflow 4: Realistic Typing with Human-Like Delays

### 🚨 Step 0: Macro Check (Complete First - MANDATORY FOR FORMS)

**CRITICAL**: Anti-bot forms may have typing detection macros:

- [ ] Checked site-specific realistic typing macros: `browser_list_macros({ site: "...", category: "form" })`
- [ ] Checked universal realistic typing macros: `browser_list_macros({ site: "*" })`
- [ ] Using macro if available: `browser_execute_macro(...)`
- [ ] Documented macro gap if none exist
- [ ] Using browser_realistic_type for anti-bot forms
- [ ] Planning preview and user approval before submission

**If no macro exists**: Document gap, then proceed with manual workflow below.

---

**When to use**: Forms with anti-bot detection or when you want human-like behavior.

**Instructions for main conversation:**

1. **Use realistic_type for text fields**:
   ```
   Call: mcp__browser__browser_realistic_type({
     text: "user@example.com",
     minDelay: 50,         # 50ms minimum between keystrokes
     maxDelay: 150,        # 150ms maximum between keystrokes
     mistakeChance: 0.02,  # 2% chance of typo that gets corrected
     pressEnter: false,
     tabTarget: formTab
   })
   ```

2. **For passwords, disable mistakes**:
   ```
   Call: mcp__browser__browser_realistic_type({
     text: "SecurePassword123",
     minDelay: 80,
     maxDelay: 200,
     mistakeChance: 0,     # No typos in passwords
     pressEnter: false,
     tabTarget: formTab
   })
   ```

**Expected result**: Form fields are filled with realistic human-like typing patterns, including variable delays and occasional typos (except passwords).

### Workflow 5: Validation Error Handling

### 🚨 Step 0: Macro Check (Complete First - MANDATORY FOR FORMS)

**CRITICAL**: Validation errors should be detected and fixed with macros:

- [ ] Checked site-specific validation macros: `browser_list_macros({ site: "...", category: "form" })`
- [ ] Checked universal validation macros: `browser_list_macros({ site: "*", category: "form" })`
- [ ] Using detect_messages macro to get validation errors: `browser_execute_macro({ id: "detect_messages" })`
- [ ] Planning to show user validation errors and suggested fixes
- [ ] Planning to get user approval before retry submission

**If no macro exists**: Document gap, then proceed with manual workflow below.

---

**When to use**: After submission when validation errors occur, or to retry failed submissions.

**Instructions for main conversation:**

1. **Fill and submit form (after user approval)**:
   ```
   ... (follow Workflow 1 steps 1-7 for filling and submitting)

   Call: mcp__browser__browser_submit_form({
     element: "Submit button",
     ref: submitButton.ref,
     tabTarget: formTab
   })
   ```

2. **Wait for response**:
   ```
   Call: mcp__browser__browser_wait({ time: 2, tabTarget: formTab })
   ```

3. **Check for validation errors**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "detect_messages",
     tabTarget: formTab
   })

   Store messages = result.content
   ```

4. **If errors found, analyze and fix**:
   ```
   If messages.errors.length > 0:
     For each error in messages.errors:
       # Parse error message to identify field and suggested fix
       # Example: "Please enter a valid email address" → field: "email", fix: correct format

       If error can be fixed:
         Call: mcp__browser__browser_type({
           ref: error.fieldRef,
           element: error.fieldLabel,
           text: error.suggestedFix,
           submit: false,
           tabTarget: formTab
         })
   ```

5. **Return error fixes for user approval**:
   ```
   Return to user:
   {
     tabId: formTab,
     action: "validation-errors-fixed",
     submitted: false,
     data: {
       errors: messages.errors,
       fixes: fieldErrors with suggested fixes,
       instructions: "Errors have been fixed. Confirm to retry submission."
     }
   }
   ```

6. **If successful**:
   ```
   Return to user:
   {
     tabId: formTab,
     action: "submitted",
     submitted: true,
     data: {
       success: true,
       confirmationMessage: messages.success
     }
   }
   ```

**Expected result**: Validation errors are detected, analyzed, fixed, and user is prompted to retry submission.

## Safety Protocols

### CRITICAL: NEVER Auto-Submit Without Confirmation

**❌ NEVER DO THIS**:
```
Call: mcp__browser__browser_submit_form({ ... })
# (without user approval)
```

**✅ ALWAYS DO THIS**:
```
1. Fill form
2. Generate preview
3. Return preview to user
4. Wait for user approval
5. ONLY THEN call browser_submit_form
```

**Why this matters**: Forms can have serious consequences (purchases, account changes, legal agreements). User MUST review and approve before submission.

### Always Return Preview Before Submission

**Preview structure to return**:
```json
{
  "tabId": 123,
  "action": "preview",
  "submitted": false,
  "data": {
    "preview": {
      "fields": [
        { "name": "email", "value": "user@example.com", "required": true },
        { "name": "phone", "value": "555-1234", "required": false },
        { "name": "password", "value": "******", "required": true, "sensitive": true }
      ],
      "formAction": "/submit",
      "warnings": [
        "This form includes a password field",
        "Form will be submitted to: /submit"
      ]
    },
    "instructions": "Review the preview. To submit, confirm submission."
  }
}
```

### Warn on Sensitive Fields

**Sensitive field detection**:
```
Sensitive fields include: "password", "credit-card", "ssn", "cvv", "billing", "payment"

For each field in form analysis:
  If field.name (lowercased) contains any sensitive keyword:
    Add warning: "Sensitive field detected: {field.label}"

If warnings exist:
  Return to user:
  {
    "tabId": formTab,
    "action": "sensitive-fields-detected",
    "submitted": false,
    "data": {
      "warnings": warnings,
      "instructions": "Sensitive fields detected. Proceed with caution. Review preview carefully."
    }
  }
```

### Preserve Form Data on Errors

**Data preservation pattern**:
```
Store filled data BEFORE submission attempt:
filledData = {}
For each field in formAnalysis.fields:
  If data contains field.name:
    filledData[field.name] = data[field.name]

If error occurs during submission:
  Return to user:
  {
    "tabId": formTab,
    "action": "error",
    "submitted": false,
    "data": {
      "error": errorMessage,
      "preservedData": filledData,
      "instructions": "Form data has been preserved. Fix errors and retry."
    }
  }
```

---

## 🔄 Reminder (Halfway Through): Macro-First Execution for Forms

**Critical checkpoint**: Have you verified macros for this form task?

✅ **Required before proceeding with manual operations**:
- [ ] Called `browser_list_macros` for site-specific form macros (site: "<domain>", category: "form")
- [ ] Called `browser_list_macros` for universal form macros (site: "*", category: "form")
- [ ] Using `browser_execute_macro` if macro found
- [ ] Documented macro gap if none exist

**Important**: Do NOT proceed with manual snapshots and clicking if form macros exist. Macros save 10-15x tokens and reduce errors from 15% to <1%.

---

## Token Conservation

### 1. Use Targeted Macros

**Instead of browser_snapshot** (wastes tokens on full ARIA tree):
```
Call: mcp__browser__browser_execute_macro({
  id: "discover_forms",
  tabTarget: formTab
})
# Returns only form metadata, not entire page structure
```

### 2. Clean Interruptions First

**Before form operations**:
```
Call: mcp__browser__browser_execute_macro({
  id: "dismiss_interruptions",
  tabTarget: formTab
})
# Removes cookie consents, popups that interfere with forms
```

### 3. Truncate Text Extraction

**When getting page text**:
```
Call: mcp__browser__browser_get_visible_text({
  maxLength: 3000,
  tabTarget: formTab
})
# Limits text to 3000 characters instead of returning full page
```

## Error Handling

### Common Error 1: "Form not found"

**Solution**:
```
Wait for page to fully load:
Call: mcp__browser__browser_wait({ time: 2, tabTarget: formTab })

Re-discover forms:
Call: mcp__browser__browser_execute_macro({
  id: "discover_forms",
  tabTarget: formTab
})
```

### Common Error 2: "Field is required"

**Solution**:
```
Check required fields before submission:
requiredFields = formAnalysis.fields.filter(f => f.required)
missingFields = requiredFields.filter(f => !data[f.name])

If missingFields.length > 0:
  Return to user:
  {
    "error": "Missing required fields",
    "missingFields": missingFields.map(f => f.label),
    "instructions": "Provide values for: " + missingFields.map(f => f.label).join(", ")
  }
```

### Common Error 3: "Validation failed"

**Solution**:
```
Detect validation messages:
Call: mcp__browser__browser_execute_macro({
  id: "detect_messages",
  tabTarget: formTab
})

Parse error messages to identify field names and issues:
For each error in messages.errors:
  # Example: "Email is invalid" → field: "email", issue: "format"
  Suggest fix based on validation pattern

Return fixes to user for approval before retrying
```

### Common Error 4: "AJAX submission detected"

**Solution**:
```
Wait for AJAX response (longer timeout):
Call: mcp__browser__browser_wait({ time: 3, tabTarget: formTab })

Check for success/error messages:
Call: mcp__browser__browser_execute_macro({
  id: "detect_messages",
  tabTarget: formTab
})

If no messages and URL changed:
  Submission likely succeeded (check new URL for confirmation)
```

## Return Formats

### Preview (before submission)

```json
{
  "tabId": 123,
  "label": "form-page",
  "url": "https://example.com/contact",
  "action": "preview",
  "submitted": false,
  "data": {
    "form": {
      "id": "contact-form",
      "action": "/submit-contact",
      "method": "POST"
    },
    "preview": {
      "fields": [
        {"name": "name", "value": "John Doe", "required": true},
        {"name": "email", "value": "john@example.com", "required": true},
        {"name": "phone", "value": "555-1234", "required": false},
        {"name": "message", "value": "Hello!", "required": true}
      ],
      "warnings": [],
      "sensitiveFields": []
    },
    "instructions": "Review the preview. To submit, confirm submission."
  }
}
```

### After Submission

```json
{
  "tabId": 123,
  "label": "form-page",
  "url": "https://example.com/contact",
  "action": "submitted",
  "submitted": true,
  "data": {
    "success": true,
    "confirmationMessage": "Thank you! Your message has been sent.",
    "redirectUrl": "https://example.com/thank-you"
  }
}
```

### Validation Errors

```json
{
  "tabId": 123,
  "action": "validation-errors",
  "submitted": false,
  "data": {
    "errors": [
      {"field": "email", "message": "Please enter a valid email address"},
      {"field": "phone", "message": "Phone number must be 10 digits"}
    ],
    "fixes": [
      {"field": "email", "suggestedFix": "john.doe@example.com"},
      {"field": "phone", "suggestedFix": "5551234567"}
    ],
    "instructions": "Errors detected. Review fixes and confirm to retry."
  }
}
```

## Quick Reference

### Discover Forms
```
Call: mcp__browser__browser_execute_macro({
  id: "discover_forms",
  tabTarget: formTab
})
```

### Analyze Form
```
Call: mcp__browser__browser_execute_macro({
  id: "analyze_form_requirements",
  params: { formSelector: "#contact-form" },
  tabTarget: formTab
})
```

### Fill Field (Standard)
```
Call: mcp__browser__browser_type({
  ref: field.ref,
  element: field.label,
  text: "value",
  submit: false,
  tabTarget: formTab
})
```

### Fill Field (Realistic)
```
Call: mcp__browser__browser_realistic_type({
  text: "value",
  minDelay: 50,
  maxDelay: 150,
  mistakeChance: 0.02,
  pressEnter: false,
  tabTarget: formTab
})
```

### Detect Messages
```
Call: mcp__browser__browser_execute_macro({
  id: "detect_messages",
  tabTarget: formTab
})
```

### Submit Form (ONLY after user approval)
```
Call: mcp__browser__browser_submit_form({
  element: "Submit button",
  ref: submitButton.ref,
  tabTarget: formTab
})
```

---

## 🚨 FINAL REMINDER: Macro-First Execution & Form Safety

**CRITICAL - Complete BEFORE any form operation**:
- [ ] Called `browser_list_macros` for site-specific form macros
- [ ] Called `browser_list_macros` for universal form macros (* site)
- [ ] Using `browser_execute_macro` if macro found
- [ ] Documented macro gap if none exist
- [ ] Planning to preview before submission
- [ ] Planning to get explicit user approval before submission

**FORMS ARE IRREVERSIBLE** - Submissions can charge credit cards, delete accounts, submit legal agreements. There is NO undo.

---

## Remember

- ✅ **COMPLETE STEP 0 FIRST** - Check for form macros before any manual operations
- ✅ **NEVER auto-submit** - always require explicit user approval (forms are irreversible)
- ✅ **Always generate preview** - show exactly what will be submitted
- ✅ **Warn on sensitive fields** - passwords, credit cards, SSN, billing info
- ✅ **Preserve form data** - don't lose data on errors or validation failures
- ✅ **Handle multi-step forms** - navigate through wizard steps sequentially
- ✅ **Detect conditional fields** - handle dynamic form changes (fields appearing/disappearing)
- ✅ **Use realistic typing** - human-like delays and occasional typos for anti-bot detection
- ✅ **Validate before submission** - check required fields are filled
- ✅ **Return tab IDs** - enable context preservation for multi-turn workflows
- ✅ **Check for validation errors** - after submission, detect and fix errors
- ✅ **Document macro gaps** - if no macro exists for this form type, state it explicitly

---

**When the main skill routes to this module**:
1. **IMMEDIATELY complete Step 0** - Check for form macros first
2. **IF macro found** - Use `browser_execute_macro` instead of manual steps
3. **IF no macro found** - Document gap, then follow the appropriate workflow based on the user's request
4. **ALWAYS end with a preview before any submission** - user MUST approve
5. **NEVER submit without explicit user approval** - forms are irreversible
