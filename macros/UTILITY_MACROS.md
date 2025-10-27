# Browser MCP Utility Macros

Comprehensive collection of 17 utility macros for efficient browser automation and page exploration.

## 📦 Storage Status

✅ **All 17 macros are stored in the MongoDB database**

To re-store or update macros:
```bash
npm run store:macros
```

## 🧪 Testing

Run the comprehensive test suite:
```bash
npm run test:utility-macros
```

This tests macro storage, listing, and execution on real websites (example.com and github.com).

## 📚 Macro Catalog

### Tier 1: Most Useful Macros (4)

These are the highest-value macros for general page exploration and interaction.

#### 1. `get_interactive_elements`
**Category:** exploration
**Reliability:** high
**Description:** Get all interactive elements (buttons, links, inputs, selects) on the page with minimal token usage

**Parameters:**
- `limit` (number, optional): Maximum number of elements to return (default: 50)
- `includeHidden` (boolean, optional): Include hidden elements (default: false)

**Returns:** Object with count, elements array, and truncated flag

**Use case:** Quickly discover what actions are available on a page without using expensive snapshot operations.

---

#### 2. `discover_forms`
**Category:** exploration
**Reliability:** high
**Description:** Discover all forms on the page with their fields, actions, and submit buttons

**Parameters:** None

**Returns:** Object with formCount and forms array

**Use case:** Understand form structure before filling fields, validate form state, or automate form submission.

---

#### 3. `detect_messages`
**Category:** exploration
**Reliability:** high
**Description:** Detect all error, warning, success, and info messages on the page

**Parameters:** None

**Returns:** Object with errors, warnings, successes, info arrays and total count

**Use case:** Validate form submissions, check for error states, monitor application feedback.

---

#### 4. `find_element_by_description`
**Category:** util
**Reliability:** medium
**Description:** Find elements using natural language description (e.g., 'the blue submit button')

**Parameters:**
- `description` (string, required): Natural language description of the element to find

**Returns:** Object with found flag, text, selector, confidence level

**Use case:** Natural language element targeting when you don't have exact selectors.

---

### Tier 2: High Value Macros (4)

Essential macros for data extraction and page state analysis.

#### 5. `extract_table_data`
**Category:** extraction
**Reliability:** high
**Description:** Extract structured data from HTML tables

**Parameters:**
- `selector` (string, optional): CSS selector for specific table (uses first table if not specified)
- `maxRows` (number, optional): Maximum number of rows to return (default: 100)

**Returns:** Object with headers, rows array, counts, and truncated flag

**Use case:** Scrape tabular data, compare pricing tables, extract reports.

---

#### 6. `get_form_state`
**Category:** exploration
**Reliability:** high
**Description:** Get current state of a form including which fields are filled

**Parameters:**
- `formSelector` (string, optional): CSS selector for the form (uses first form if not specified)

**Returns:** Object with field counts, completion percentage, and field details

**Use case:** Check form completion status, validate which fields still need input, resume interrupted workflows.

---

#### 7. `detect_modals`
**Category:** exploration
**Reliability:** high
**Description:** Detect and describe modal dialogs, popups, and overlays on the page

**Parameters:** None

**Returns:** Object with hasModal flag, count, and modals array with details

**Use case:** Detect cookie banners, newsletter popups, age verification, or any modal interruptions.

---

#### 8. `check_visibility_batch`
**Category:** util
**Reliability:** high
**Description:** Check visibility status of multiple elements at once

**Parameters:**
- `selectors` (array, required): Array of CSS selectors to check

**Returns:** Object with checked count and results array

**Use case:** Verify element states in testing, check if UI elements are properly displayed.

---

### Tier 3: Navigation and Content Macros (6)

Macros for advanced navigation, waiting, and content analysis.

#### 9. `smart_wait_helper`
**Category:** util
**Reliability:** high
**Description:** Wait for elements to appear, disappear, or conditions to be met

**Parameters:**
- `condition` (string, required): Condition to wait for: 'appear', 'disappear', 'count', or 'text'
- `selector` (string, required): CSS selector for element(s) to watch
- `expectedValue` (string, optional): Expected value for text or count conditions
- `timeout` (number, optional): Maximum wait time in milliseconds (default: 5000)

**Returns:** Promise resolving to object with success flag, message, and elapsed time

**Use case:** Wait for AJAX content to load, animations to complete, or elements to appear/disappear.

---

#### 10. `list_dropdown_options`
**Category:** exploration
**Reliability:** high
**Description:** Get all available options from select dropdowns on the page

**Parameters:**
- `selector` (string, optional): CSS selector for specific dropdown (lists all if not specified)

**Returns:** Object with dropdownCount and dropdowns array with all options

**Use case:** Understand available choices in dropdowns, automate selection workflows.

---

#### 11. `get_breadcrumbs`
**Category:** navigation
**Reliability:** high
**Description:** Extract breadcrumb navigation showing current page hierarchy

**Parameters:** None

**Returns:** Object with found flag, depth, breadcrumbs array, and currentPage

**Use case:** Understand site hierarchy, navigate backwards, track user journey.

---

#### 12. `get_pagination_info`
**Category:** navigation
**Reliability:** high
**Description:** Get pagination information including current page, total pages, and available controls

**Parameters:** None

**Returns:** Object with pagination details, current page, total pages, and available controls

**Use case:** Navigate multi-page content, scrape paginated data, understand content scope.

---

#### 13. `find_clickable_elements`
**Category:** exploration
**Reliability:** high
**Description:** Find all clickable elements with intelligent action descriptions

**Parameters:**
- `limit` (number, optional): Maximum number of elements to return (default: 30)

**Returns:** Object with count, clickable elements array, and truncated flag

**Use case:** Discover available actions, generate interaction maps, automate workflows.

---

#### 14. `detect_page_changes`
**Category:** util
**Reliability:** medium
**Description:** Detect content changes by comparing current state with stored snapshot

**Parameters:**
- `baselineSnapshot` (string, required): Previous page content snapshot to compare against

**Returns:** Object with hasChanges flag, changeCount, changes array, and new snapshot

**Use case:** Monitor page updates, detect AJAX changes, validate automation results.

---

### Tier 4: Modal and Cleanup Macros (3)

Utilities for dealing with interruptions and cleaning up the page.

#### 15. `close_modal`
**Category:** util
**Reliability:** high
**Description:** Intelligently find and close modal dialogs, popups, and overlays

**Parameters:**
- `type` (string, optional): Type of modal to close: 'any', 'cookie', 'newsletter', 'age_verification' (default: 'any')

**Returns:** Object with count of closed modals and details

**Use case:** Dismiss cookie banners, close newsletter popups, clear age verification modals.

---

#### 16. `dismiss_interruptions`
**Category:** util
**Reliability:** medium
**Description:** Automatically dismiss common interruptions: cookie banners, newsletters, notifications

**Parameters:** None

**Returns:** Object with count of dismissed interruptions and details

**Use case:** Clean up page before automation, improve user experience, bypass popups.

---

#### 17. `cleanup_page`
**Category:** util
**Reliability:** medium
**Description:** Remove ads, popups, overlays, and other distractions from the page

**Parameters:**
- `aggressive` (boolean, optional): Use aggressive cleanup (may remove some content) (default: false)

**Returns:** Object with count of removed elements and details

**Use case:** Prepare page for screenshots, improve readability, focus on main content.

---

## 🎯 Usage Examples

### Example 1: Quick Page Exploration
```javascript
// Execute macro to get all interactive elements
const result = await browser_execute_macro({
  id: "macro-id-for-get_interactive_elements",
  params: { limit: 20, includeHidden: false }
});

// Result: { count: 15, elements: [...], truncated: false }
```

### Example 2: Form Discovery and State Check
```javascript
// First, discover all forms
const forms = await browser_execute_macro({
  id: "macro-id-for-discover_forms",
  params: {}
});
// Result: { formCount: 2, forms: [...] }

// Then check the state of a specific form
const formState = await browser_execute_macro({
  id: "macro-id-for-get_form_state",
  params: { formSelector: "#login-form" }
});
// Result: { totalFields: 3, filledFields: 1, readyToSubmit: false, ... }
```

### Example 3: Clean Page Before Automation
```javascript
// Dismiss all interruptions
await browser_execute_macro({
  id: "macro-id-for-dismiss_interruptions",
  params: {}
});

// Close any remaining modals
await browser_execute_macro({
  id: "macro-id-for-close_modal",
  params: { type: "any" }
});

// Now proceed with main automation task
```

### Example 4: Extract Table Data
```javascript
// Extract data from a pricing table
const tableData = await browser_execute_macro({
  id: "macro-id-for-extract_table_data",
  params: { selector: ".pricing-table", maxRows: 50 }
});
// Result: { found: true, headers: [...], rows: [[...], [...]], ... }
```

### Example 5: Natural Language Element Search
```javascript
// Find an element using natural language
const element = await browser_execute_macro({
  id: "macro-id-for-find_element_by_description",
  params: { description: "the blue submit button" }
});
// Result: { found: true, selector: "button.submit-btn", confidence: "high" }
```

## 🔍 Finding Macro IDs

To get the macro ID for use in `browser_execute_macro`:

```javascript
// List all universal macros
const macros = await browser_list_macros({ site: "*" });

// Find the macro you need
const targetMacro = macros.macros.find(m => m.name === "get_interactive_elements");
const macroId = targetMacro.id;
```

## 📊 Macro Categories

- **Exploration** (7 macros): Page discovery, form analysis, message detection
- **Extraction** (1 macro): Data scraping from tables
- **Navigation** (2 macros): Breadcrumbs, pagination
- **Util** (7 macros): Element search, waiting, cleanup, modals

## 🚀 Best Practices

1. **Start with Tier 1**: These macros cover most common use cases
2. **Combine macros**: Use multiple macros in sequence for complex workflows
3. **Check reliability**: High-reliability macros are more predictable
4. **Use limits wisely**: Set appropriate limits to balance speed vs completeness
5. **Clean up first**: Use cleanup macros before main automation to avoid interruptions

## 🛠️ Development

All macros are defined in `utility-macros.js` and organized in 4 tiers.

To modify or add macros:
1. Edit `utility-macros.js`
2. Run `npm run store:macros` to update the database
3. Run `npm run test:utility-macros` to verify functionality

## 📝 Notes

- All macros are universal (site: "*") and work on any website
- Macros execute in the page context with access to the DOM
- Results are designed to be token-efficient (minimal output)
- Reliability ratings: high > medium > low > untested
