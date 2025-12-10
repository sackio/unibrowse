# Advanced Form Controls Macros

Comprehensive collection of 11 macros for handling complex form controls including date pickers, file uploads, sliders, color pickers, custom dropdowns, rich text editors, and autocomplete inputs.

## 📦 Storage Status

✅ **All 11 macros are stored in the MongoDB database**

To re-store or update macros:
```bash
npm run store:macros
```

## 🧪 Testing

Run the comprehensive test suite:
```bash
npm run test:form-controls-macros
```

This tests macro storage, listing, and execution on real forms with advanced controls.

## 📚 Macro Catalog

### Tier 1: Most Critical Controls (4)

Essential macros for the most commonly encountered advanced form controls.

#### 1. `fill_date_picker`
**Category:** form
**Reliability:** high
**Description:** Fill date inputs including native and custom JavaScript date pickers (Flatpickr, Pikaday, Bootstrap Datepicker, jQuery UI)

**Parameters:**
- `selector` (string, required): CSS selector for date input/picker
- `date` (string, required): Date in YYYY-MM-DD format or "today", "tomorrow", "yesterday"

**Returns:** Object with success flag, method used (native_date_input, Flatpickr, Pikaday, jQuery_UI_datepicker, etc.), and value set

**Use case:** Fill date fields in booking forms, scheduling applications, event registration. Automatically detects and handles multiple date picker libraries.

**Methods detected:**
1. Native HTML5 date input
2. Flatpickr (via data attributes or class detection)
3. Pikaday
4. Bootstrap Datepicker
5. jQuery UI Datepicker
6. Direct value setting with event triggers

---

#### 2. `set_custom_select`
**Category:** form
**Reliability:** high
**Description:** Set value on custom select boxes (Select2, Chosen, Material UI, and other custom implementations)

**Parameters:**
- `selector` (string, required): CSS selector for select element or custom select container
- `value` (string, required): Value to select (value attribute or visible text)

**Returns:** Object with success flag, method used, and value set

**Use case:** Fill custom dropdowns that don't use native `<select>` elements. Handles Select2, Chosen, and Material UI select components.

**Methods detected:**
1. Native `<select>` element (by value or text matching)
2. Select2 (jQuery plugin)
3. Chosen (jQuery plugin)
4. Hidden select with custom UI
5. Material UI and similar (click-based option selection)

---

#### 3. `set_rich_text_editor`
**Category:** form
**Reliability:** high
**Description:** Set content in rich text editors (TinyMCE, CKEditor, Quill, ContentEditable)

**Parameters:**
- `selector` (string, required): CSS selector for editor container or textarea
- `content` (string, required): HTML or plain text content to set
- `format` (string, optional): Content format: "html" or "text" (default: "text")

**Returns:** Object with success flag, method used (TinyMCE, CKEditor, Quill, contentEditable, etc.), and format

**Use case:** Fill WYSIWYG editors in content management systems, comment forms, email composers.

**Methods detected:**
1. TinyMCE (window.tinymce)
2. CKEditor (window.CKEDITOR)
3. Quill (element.__quill or .ql-editor class)
4. ContentEditable divs
5. Nested contentEditable elements
6. Textarea fallback

---

#### 4. `detect_advanced_form_controls`
**Category:** form
**Reliability:** high
**Description:** Scan page for complex form controls and provide filling strategies for each type

**Parameters:**
- `formSelector` (string, optional): CSS selector for form to scan (default: entire page)

**Returns:** Object with total count, controls categorized by type (datePickers, colorPickers, fileUploads, rangeSliders, customSelects, richTextEditors, autocompletes), and macro recommendations

**Use case:** Survey a form before automation to understand which specialized macros are needed. Essential for planning form-filling workflows.

**Detected controls:**
- Date pickers (native and custom)
- Color pickers (native and custom)
- File upload inputs and dropzones
- Range sliders (native and custom)
- Custom select boxes
- Rich text editors
- Autocomplete inputs

---

### Tier 2: Specialized Input Controls (4)

Macros for handling less common but important form controls.

#### 5. `set_range_slider`
**Category:** form
**Reliability:** high
**Description:** Set value on range sliders including native and custom implementations (noUiSlider, Ion.RangeSlider)

**Parameters:**
- `selector` (string, required): CSS selector for range slider
- `value` (number, required): Numeric value to set

**Returns:** Object with success flag, method used, value set, and min/max values (for native sliders)

**Use case:** Set price ranges, volume controls, brightness sliders, age selectors.

**Methods detected:**
1. Native HTML5 range input
2. noUiSlider (element.noUiSlider)
3. Ion.RangeSlider (jQuery plugin)
4. Slider container with hidden input

---

#### 6. `set_color_picker`
**Category:** form
**Reliability:** high
**Description:** Set color on native and custom color pickers (Spectrum, Pickr)

**Parameters:**
- `selector` (string, required): CSS selector for color picker
- `color` (string, required): Color in hex format (#RRGGBB) or named color (red, blue, green, etc.)

**Returns:** Object with success flag, method used, and color value in hex format

**Use case:** Fill color selection fields in design tools, theme customizers, branding forms.

**Named colors supported:** red, green, blue, white, black, yellow, cyan, magenta, orange

**Methods detected:**
1. Native HTML5 color input
2. Spectrum color picker (jQuery plugin)
3. Pickr color picker (element._pickr)
4. Direct value setting with event triggers

---

#### 7. `prepare_file_upload`
**Category:** form
**Reliability:** high
**Description:** Prepare file upload input and detect dropzone support (Dropzone.js and custom implementations)

**Parameters:**
- `selector` (string, required): CSS selector for file input or dropzone

**Returns:** Object with upload type (native_file_input, Dropzone.js, custom_drag_drop), constraints (accept types, multiple flag, maxSize), hidden input details, and instructions

**Use case:** Understand file upload mechanisms before attempting upload. Provides guidance on how to interact with different upload implementations.

**Detected mechanisms:**
1. Native file input (type="file")
2. Dropzone.js (element.dropzone or .dropzone class)
3. Custom drag-drop zones (data attributes or ARIA roles)
4. Hidden file inputs associated with upload buttons

---

#### 8. `fill_autocomplete`
**Category:** form
**Reliability:** medium
**Description:** Fill autocomplete/typeahead inputs and optionally select from suggestions

**Parameters:**
- `selector` (string, required): CSS selector for autocomplete input
- `text` (string, required): Text to type
- `waitForSuggestions` (boolean, optional): Wait for suggestions to appear (default: true)

**Returns:** Object with success flag, method used, text entered, and selected value (if suggestion was clicked)

**Use case:** Fill address autocomplete, search suggestions, tag inputs, location selectors.

**Suggestion containers detected:**
- `.autocomplete-suggestions`
- `.typeahead`
- `.dropdown-menu`
- `.suggestions`
- `[role="listbox"]`
- `.ui-autocomplete`

**Behavior:**
- Types text and triggers keyboard events
- Waits 500ms for suggestions to appear
- Clicks first suggestion if found
- Falls back to pressing Enter if no suggestions

---

### Tier 3: Analysis and Utility Macros (3)

Supporting macros for understanding form structure and requirements.

#### 9. `analyze_form_for_filling`
**Category:** form
**Reliability:** high
**Description:** Analyze form structure and generate optimal filling strategy with field purpose detection

**Parameters:**
- `formSelector` (string, optional): CSS selector for form (default: first form on page)

**Returns:** Object with form details (action, method, fieldCount), fields array with purpose detection, fillable fields, and filling strategy

**Use case:** Understand form structure before automation, identify required fields, detect field purposes (email, phone, name, address, etc.).

**Detected field purposes:**
- Email, phone, password
- First name, last name, full name
- Address, city, state, zip code, country
- Credit card, CVV, expiration
- Username, company
- Birthdate, age, gender

**Field analysis includes:**
- Type, name, ID, required flag
- Label association
- Placeholder text
- Validation constraints (pattern, minLength, maxLength, min, max)
- Select options
- Purpose detection from multiple sources

---

#### 10. `smart_fill_form`
**Category:** form
**Reliability:** high
**Description:** Intelligently fill form fields with realistic data based on detected field purpose

**Parameters:**
- `formSelector` (string, optional): CSS selector for form (default: first form)
- `data` (object, optional): Data object to use instead of generated data
- `fillHidden` (boolean, optional): Fill hidden fields (default: false)

**Returns:** Object with filled count, skipped count, filled fields array, skipped fields array

**Use case:** Automatically fill forms with realistic test data, speed up manual testing, automate registration workflows.

**Generated realistic data:**
- firstName: "Alex"
- lastName: "Johnson"
- email: "alex.johnson@example.com"
- phone: "(555) 123-4567"
- username: "alexj" + random number
- password: "SecurePass123!"
- address: "123 Main Street"
- city: "San Francisco"
- state: "CA"
- zipCode: "94102"
- country: "United States"
- company: "Acme Corporation"

**Skipped fields:**
- Disabled or readonly
- Hidden (unless fillHidden=true)
- Submit/button/reset types
- Fields with unknown purpose

---

#### 11. `detect_password_requirements`
**Category:** form
**Reliability:** high
**Description:** Analyze password field requirements from validation messages and patterns

**Parameters:**
- `passwordSelector` (string, optional): CSS selector for password field (default: input[type="password"])

**Returns:** Object with requirements (minLength, maxLength, pattern), auto-detected requirements (uppercase, lowercase, number, special), pattern analysis, and sample password

**Use case:** Generate valid passwords for automated registration, understand password complexity requirements, test password validation.

**Auto-detected from helper text:**
- Minimum character length
- Uppercase letter requirement
- Lowercase letter requirement
- Number/digit requirement
- Special character requirement

**Pattern analysis:**
- Uppercase detection
- Lowercase detection
- Number detection
- Special character detection

**Sample password generation:**
- Includes required character types
- Meets minimum length
- Respects maximum length
- Uses mix of: ABCD (uppercase), abcd (lowercase), 1234 (numbers), !@#$ (special)

---

## 🎯 Usage Examples

### Example 1: Date Picker Filling
```javascript
// Fill date with relative date
const result = await browser_execute_macro({
  id: "macro-id-for-fill_date_picker",
  params: {
    selector: "#booking-date",
    date: "tomorrow"
  }
});
// Result: { success: true, method: "Flatpickr", value: "2025-12-11" }

// Fill with specific date
const result2 = await browser_execute_macro({
  id: "macro-id-for-fill_date_picker",
  params: {
    selector: ".checkin-date",
    date: "2025-12-25"
  }
});
// Result: { success: true, method: "native_date_input", value: "2025-12-25" }
```

### Example 2: Custom Select Handling
```javascript
// Set value on Select2 dropdown
const result = await browser_execute_macro({
  id: "macro-id-for-set_custom_select",
  params: {
    selector: "#country-select",
    value: "United States"
  }
});
// Result: { success: true, method: "Select2", value: "United States" }

// Set by value instead of text
const result2 = await browser_execute_macro({
  id: "macro-id-for-set_custom_select",
  params: {
    selector: "#country-select",
    value: "US"
  }
});
// Result: { success: true, method: "native_select_by_value", value: "US" }
```

### Example 3: Rich Text Editor Workflow
```javascript
// Set plain text content
const result = await browser_execute_macro({
  id: "macro-id-for-set_rich_text_editor",
  params: {
    selector: "#comment-editor",
    content: "This is a test comment.",
    format: "text"
  }
});
// Result: { success: true, method: "Quill", format: "text" }

// Set HTML content
const result2 = await browser_execute_macro({
  id: "macro-id-for-set_rich_text_editor",
  params: {
    selector: ".wysiwyg-editor",
    content: "<p>Bold text: <strong>important</strong></p>",
    format: "html"
  }
});
// Result: { success: true, method: "TinyMCE", format: "html" }
```

### Example 4: Form Survey and Auto-Fill
```javascript
// First, detect all advanced controls
const survey = await browser_execute_macro({
  id: "macro-id-for-detect_advanced_form_controls",
  params: { formSelector: "#registration-form" }
});
// Result: {
//   totalAdvancedControls: 5,
//   controls: {
//     datePickers: [{ selector: "#birthdate", type: "native" }],
//     customSelects: [{ selector: "#country", type: "Select2", optionCount: 195 }],
//     richTextEditors: [{ selector: "#bio", type: "Quill" }],
//     ...
//   },
//   recommendations: { ... }
// }

// Then, auto-fill with realistic data
const filled = await browser_execute_macro({
  id: "macro-id-for-smart_fill_form",
  params: {
    formSelector: "#registration-form",
    fillHidden: false
  }
});
// Result: {
//   success: true,
//   filled: 8,
//   skipped: 2,
//   filledFields: [...],
//   skippedFields: [...]
// }
```

### Example 5: Password Field Analysis
```javascript
// Analyze password requirements
const pwdReqs = await browser_execute_macro({
  id: "macro-id-for-detect_password_requirements",
  params: { passwordSelector: "#new-password" }
});
// Result: {
//   success: true,
//   requirements: {
//     minLength: 8,
//     pattern: "...",
//     autoDetected: {
//       minLength: 12,
//       requiresUppercase: true,
//       requiresLowercase: true,
//       requiresNumber: true,
//       requiresSpecial: true
//     },
//     samplePassword: "ABCDabcd1234!@#$"
//   },
//   summary: "12+ characters, uppercase, lowercase, number, special character"
// }
```

### Example 6: File Upload Preparation
```javascript
// Understand file upload mechanism
const upload = await browser_execute_macro({
  id: "macro-id-for-prepare_file_upload",
  params: { selector: ".file-dropzone" }
});
// Result: {
//   success: true,
//   type: "Dropzone.js",
//   dropzoneDetected: true,
//   hiddenInput: {
//     selector: "#file-input-hidden",
//     accept: "image/*,.pdf",
//     multiple: true
//   },
//   instructions: "Use dropzone.addFile() method or find hidden file input"
// }
```

### Example 7: Color Picker and Slider
```javascript
// Set color picker value
const color = await browser_execute_macro({
  id: "macro-id-for-set_color_picker",
  params: {
    selector: "#brand-color",
    color: "#FF5733"  // or "red"
  }
});
// Result: { success: true, method: "Spectrum_colorpicker", value: "#FF5733" }

// Set range slider value
const slider = await browser_execute_macro({
  id: "macro-id-for-set_range_slider",
  params: {
    selector: "#price-range",
    value: 75
  }
});
// Result: { success: true, method: "noUiSlider", value: 75 }
```

### Example 8: Autocomplete with Suggestions
```javascript
// Fill autocomplete and select first suggestion
const autocomplete = await browser_execute_macro({
  id: "macro-id-for-fill_autocomplete",
  params: {
    selector: "#city-search",
    text: "San Francisco",
    waitForSuggestions: true
  }
});
// Result: {
//   success: true,
//   method: "autocomplete_with_selection",
//   text: "San Francisco",
//   selected: "San Francisco, CA, USA"
// }

// Fill without waiting for suggestions (just enter text)
const autocomplete2 = await browser_execute_macro({
  id: "macro-id-for-fill_autocomplete",
  params: {
    selector: "#search-box",
    text: "product name",
    waitForSuggestions: false
  }
});
// Result: { success: true, method: "text_entered", text: "product name" }
```

## 🔍 Finding Macro IDs

To get the macro ID for use in `browser_execute_macro`:

```javascript
// List all universal macros
const macros = await browser_list_macros({ site: "*", category: "form" });

// Find the macro you need
const targetMacro = macros.macros.find(m => m.name === "fill_date_picker");
const macroId = targetMacro.id;
```

## 📊 Control Type Coverage

### Date Pickers
- Native HTML5 `<input type="date">`
- Flatpickr (most popular JS date picker)
- Pikaday
- Bootstrap Datepicker
- jQuery UI Datepicker
- Generic detection via data attributes and classes

### Select Boxes
- Native `<select>` elements
- Select2 (jQuery plugin)
- Chosen (jQuery plugin)
- Material UI Select
- Custom dropdowns with hidden select
- Generic click-based custom selects

### Rich Text Editors
- TinyMCE (most popular WYSIWYG)
- CKEditor
- Quill
- ContentEditable divs
- Generic contentEditable detection

### Range Sliders
- Native HTML5 `<input type="range">`
- noUiSlider
- Ion.RangeSlider (jQuery)
- Generic slider containers

### Color Pickers
- Native HTML5 `<input type="color">`
- Spectrum (jQuery plugin)
- Pickr
- Generic color picker detection

### File Uploads
- Native `<input type="file">`
- Dropzone.js
- Custom drag-drop zones
- Hidden file inputs with upload buttons

### Autocomplete
- Generic autocomplete detection
- jQuery UI Autocomplete
- Twitter Typeahead
- Bootstrap dropdowns
- Custom suggestion containers

## 🚀 Best Practices

1. **Survey First**: Use `detect_advanced_form_controls` before attempting to fill forms to understand what you're dealing with
2. **Analyze Requirements**: Use `analyze_form_for_filling` to understand field purposes and validation rules
3. **Use Smart Fill**: `smart_fill_form` can handle most common fields automatically with realistic data
4. **Password Generation**: Use `detect_password_requirements` to generate compliant passwords
5. **Event Triggering**: All macros properly trigger input/change/blur events to activate validation
6. **Fallback Strategy**: Macros try multiple detection methods and fall back to direct value setting
7. **Wait for Ready**: Ensure date pickers and other complex controls are fully initialized before filling
8. **Check Success**: Always check the `success` flag in the response and the `method` used

## 🔄 Integration with Other Macros

Form controls macros work well with:

- **Utility Macros**:
  - `discover_forms` - Find forms before using advanced controls
  - `get_form_state` - Check form completion status
  - `detect_modals` - Handle interruptions during form filling

- **Advanced Macros**:
  - `analyze_form_requirements` - Deep validation analysis
  - `generate_form_test_data` - Generate test data
  - `validate_form_before_submit` - Pre-submission validation

- **Form Filling Macros**:
  - `validate_form_before_submit` - Validate before submission
  - `smart_submit_form` - Submit with validation
  - `detect_multistep_form` - Handle multi-step wizards

## 🛠️ Development

All macros are defined in `advanced-form-controls-macros.js` and organized in 3 tiers.

To modify or add macros:
1. Edit `advanced-form-controls-macros.js`
2. Run `npm run store:macros` to update the database
3. Run `npm run test:form-controls-macros` to verify functionality

## 📝 Notes

- All macros are universal (site: "*") and work on any website
- Macros execute in the page context with full DOM access
- Multiple detection methods ensure broad compatibility
- Events are properly triggered to activate JavaScript validation
- Reliability is high for most macros (medium for autocomplete due to timing sensitivity)
- Results include the method used for debugging and optimization

## 🎯 Quick Reference

### Date & Time
- `fill_date_picker` - Universal date picker handler

### Dropdowns & Selection
- `set_custom_select` - Custom select/dropdown handler

### Text & Rich Content
- `set_rich_text_editor` - WYSIWYG editor handler
- `fill_autocomplete` - Autocomplete/typeahead handler

### Sliders & Pickers
- `set_range_slider` - Range slider handler
- `set_color_picker` - Color picker handler

### File Handling
- `prepare_file_upload` - File upload detection

### Analysis & Detection
- `detect_advanced_form_controls` - Survey all controls
- `analyze_form_for_filling` - Form structure analysis
- `detect_password_requirements` - Password validation rules

### Smart Automation
- `smart_fill_form` - Intelligent auto-fill with realistic data
