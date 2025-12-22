# Macro Learning & Testing Module

## Overview

This module provides step-by-step instructions for learning new browser automation workflows from user demonstrations and converting them into reusable macros.

**Core Workflow**: User demonstrates → Capture interactions → Analyze patterns → Generate macro → Test → Iterate

---

## When to Create New Macros

Create new macros when:

✅ **Repetitive site-specific tasks** - User performs same workflow multiple times
✅ **Complex multi-step operations** - More than 3 sequential actions
✅ **Site patterns discovered** - Common elements/workflows across a domain
✅ **User requests** - "Can you automate this?" or "Learn how to do X"
✅ **Workflow optimization** - Current approach uses too many direct tool calls

❌ **Don't create macros for**:
- One-time operations
- Simple single-click actions already covered by universal macros
- Highly dynamic content with no stable selectors
- Security-sensitive operations (login, payments)

---

## Phase 1: Request User Demonstration

### Step 1: Ask User to Demonstrate

When you need to learn a new workflow:

```
"I need to learn how to [TASK] on [SITE]. Could you demonstrate the workflow while I capture your interactions?

I'll use browser_request_user_action to record your clicks, typing, and navigation. This will help me create a reusable macro for future requests.

Should I proceed?"
```

### Step 2: Invoke Request Tool

Use `browser_request_user_action` to capture the demonstration:

**Tool**: `mcp__unibrowse__browser_request_user_action`

**Parameters**:
```json
{
  "request": "Please demonstrate [SPECIFIC TASK]: [STEP-BY-STEP INSTRUCTIONS]",
  "timeout": 300,
  "tabTarget": [TAB_ID or TAB_LABEL]
}
```

**Example**:
```json
{
  "request": "Please demonstrate searching for a product on Amazon: 1) Enter 'wireless headphones' in the search box, 2) Click the search button, 3) Click on the first product result",
  "timeout": 300,
  "tabTarget": "amazon-demo"
}
```

**Important**: Provide clear, numbered instructions so user knows exactly what to demonstrate.

### Step 3: Wait for User Completion

The tool will:
- Show a notification overlay to the user
- Display your instructions
- Record all interactions (clicks, typing, navigation, etc.)
- Wait for user to click "Complete" or timeout
- Return captured interaction data

**User can**:
- ✅ Click "Complete" when done
- ❌ Click "Reject" if they don't want to demonstrate

---

## Phase 2: Capture & Analyze Interactions

### Step 4: Retrieve Interaction Log

After user completes demonstration, get the interaction log:

**Tool**: `mcp__unibrowse__browser_get_interactions`

**Parameters**:
```json
{
  "startTime": -300000,  // Last 5 minutes
  "tabTarget": [TAB_ID],
  "sortOrder": "asc"     // Chronological order
}
```

**What you'll get**:
```json
{
  "interactions": [
    {
      "timestamp": 1703260800000,
      "type": "navigation",
      "url": "https://amazon.com/s?k=wireless+headphones",
      "tabId": 123
    },
    {
      "timestamp": 1703260805000,
      "type": "click",
      "selector": "div[data-component-type='s-search-result']:nth-child(1) h2 a",
      "element": { "tag": "a", "text": "Sony WH-1000XM5..." },
      "coordinates": { "x": 450, "y": 320 }
    },
    {
      "timestamp": 1703260810000,
      "type": "keyboard",
      "key": "Enter",
      "targetSelector": "input#twotabsearchtextbox"
    }
  ]
}
```

### Step 5: Analyze Interaction Patterns

Look for:

**1. Stable Selectors**
- CSS selectors that are consistent across sessions
- Prefer: `data-*` attributes, `id`, stable `class` names
- Avoid: dynamically generated IDs, nth-child without context

**2. Interaction Sequences**
- Navigation → Wait → Click → Type → Submit patterns
- Conditional logic (if X exists, do Y)
- Loop patterns (pagination, multiple items)

**3. Data Extraction Points**
- Where user clicked to get data
- What elements contain the target information
- How to identify those elements reliably

**4. Wait Points**
- Where delays were needed (page loads, AJAX)
- How long user waited
- What changed on page after wait

### Step 6: Identify Macro Parameters

Determine what should be configurable:

**Common Parameters**:
- `query` - Search terms, filter values
- `position` - Which result to click (1st, 2nd, etc.)
- `maxResults` - How many items to process
- `waitTime` - Delay durations
- `includeX` - Boolean flags for optional data

**Example**:
```javascript
// User searched for "wireless headphones"
// Parameter: query (string)

// User clicked the 1st result
// Parameter: position (number, default: 1)

// User waited ~2 seconds
// Parameter: waitTime (number, default: 2000)
```

---

## Phase 3: Generate Macro Code

### Step 7: Write Macro Function

Convert interactions to JavaScript function:

**Template**:
```javascript
(params) => {
  // 1. Validate parameters
  const {
    query,           // Required
    position = 1,    // Optional with default
    maxResults = 10, // Optional with default
    waitTime = 2000  // Optional with default
  } = params;

  if (!query) {
    return { success: false, error: 'query parameter is required' };
  }

  // 2. Perform actions (based on captured interactions)
  const searchBox = document.querySelector('input#twotabsearchtextbox');
  if (!searchBox) {
    return { success: false, error: 'Search box not found' };
  }

  searchBox.value = query;
  searchBox.dispatchEvent(new Event('input', { bubbles: true }));

  // 3. Click search button
  const searchButton = document.querySelector('input#nav-search-submit-button');
  if (searchButton) {
    searchButton.click();
  } else {
    // Fallback: press Enter
    searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  }

  // 4. Return results
  return {
    success: true,
    message: `Searching for "${query}"`,
    data: { query, timestamp: Date.now() }
  };
}
```

**Key Principles**:

✅ **Error handling** - Check if elements exist before interacting
✅ **Fallbacks** - Provide alternative selectors/methods
✅ **Validation** - Verify required parameters
✅ **Clear returns** - Always return { success, data/error }
✅ **Comments** - Explain non-obvious logic

### Step 8: Define Macro Metadata

**Tool**: `mcp__unibrowse__browser_store_macro`

**Parameters**:
```json
{
  "site": "amazon.com",
  "category": "search|extraction|navigation|interaction|form|util",
  "name": "descriptive_macro_name",
  "description": "Clear explanation of what this macro does and when to use it",
  "parameters": {
    "paramName": {
      "type": "string|number|boolean|object|array",
      "description": "What this parameter does",
      "required": true|false,
      "default": "default value if not required"
    }
  },
  "code": "(params) => { /* function code */ }",
  "returnType": "Description of what the macro returns",
  "reliability": "untested|low|medium|high",
  "tags": ["tag1", "tag2"]
}
```

**Example**:
```json
{
  "site": "amazon.com",
  "category": "search",
  "name": "amazon_product_search",
  "description": "Search for products on Amazon and optionally click a specific result",
  "parameters": {
    "query": {
      "type": "string",
      "description": "Search query (e.g., 'wireless headphones')",
      "required": true
    },
    "position": {
      "type": "number",
      "description": "Which search result to click (1-based index)",
      "required": false,
      "default": null
    },
    "waitTime": {
      "type": "number",
      "description": "Milliseconds to wait after search",
      "required": false,
      "default": 2000
    }
  },
  "code": "(params) => { /* code from Step 7 */ }",
  "returnType": "{ success: boolean, message: string, data: { query, resultCount, clickedPosition? } }",
  "reliability": "untested",
  "tags": ["amazon", "search", "products"]
}
```

### Step 9: Store the Macro

Execute the `browser_store_macro` tool with the metadata from Step 8.

**Expected Result**:
```json
{
  "success": true,
  "macro": {
    "id": "uuid-generated-by-system",
    "name": "amazon_product_search",
    "site": "amazon.com",
    "category": "search",
    "version": 1,
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

**Save the macro ID** - you'll need it for testing!

---

## Phase 4: Test the Macro

### Step 10: Create Test Cases

Define test scenarios:

**Test Case Template**:
```
Test Case: [NAME]
Description: [What this tests]
Parameters: { ... }
Expected Result: [What should happen]
Success Criteria: [How to verify]
```

**Example Test Cases**:
```
Test Case 1: Basic Search
Description: Search for a common product
Parameters: { query: "laptop" }
Expected: Search executes, results load
Success: resultCount > 0

Test Case 2: Search with Click
Description: Search and click 2nd result
Parameters: { query: "laptop", position: 2 }
Expected: Navigates to 2nd product page
Success: URL contains /dp/ and product title visible

Test Case 3: Edge Case - Empty Query
Description: Test error handling
Parameters: { query: "" }
Expected: Returns error
Success: success === false, error message present

Test Case 4: Edge Case - Invalid Position
Description: Click position 999 (doesn't exist)
Parameters: { query: "laptop", position: 999 }
Expected: Returns error or clicks nothing
Success: Graceful error handling
```

### Step 11: Execute Test Cases

For each test case:

**Step 11a: Navigate to Site**
```javascript
browser_navigate({
  url: "https://amazon.com",
  tabTarget: [TEST_TAB_ID]
})
```

**Step 11b: Execute Macro**
```javascript
browser_execute_macro({
  id: "[MACRO_UUID]",
  params: { /* test case parameters */ },
  tabTarget: [TEST_TAB_ID]
})
```

**Step 11c: Verify Results**

Check:
- ✅ `success` field is correct
- ✅ Expected data is present
- ✅ Error messages are clear (for error cases)
- ✅ Page state is correct (URL, elements visible)

**Step 11d: Take Screenshot (Optional)**
```javascript
browser_screenshot({ tabTarget: [TEST_TAB_ID] })
```

### Step 12: Document Test Results

Create a test report:

```
MACRO TEST REPORT
=================
Macro: amazon_product_search
ID: [UUID]
Date: 2024-01-15
Tester: Claude

Test Case 1: Basic Search ✅ PASS
- Parameters: { query: "laptop" }
- Result: { success: true, resultCount: 48 }
- Notes: Worked perfectly

Test Case 2: Search with Click ✅ PASS
- Parameters: { query: "laptop", position: 2 }
- Result: { success: true, clickedPosition: 2 }
- Notes: Navigated to correct product

Test Case 3: Empty Query ✅ PASS
- Parameters: { query: "" }
- Result: { success: false, error: "query required" }
- Notes: Error handling works

Test Case 4: Invalid Position ⚠️ PARTIAL
- Parameters: { query: "laptop", position: 999 }
- Result: { success: false, error: "Position 999 not found" }
- Notes: Should return more specific error about max available

Overall: 75% pass rate
Recommendation: Update error message for invalid position
Reliability: medium → high after fix
```

---

## Phase 5: Iterate & Improve

### Step 13: Fix Issues Found in Testing

Common fixes:

**Issue: Selector not found**
```javascript
// Before
const button = document.querySelector('button.submit');

// After (with fallback)
const button = document.querySelector('button.submit') ||
               document.querySelector('input[type="submit"]') ||
               document.querySelector('button[type="submit"]');
```

**Issue: Timing problems**
```javascript
// Add explicit waits
await new Promise(resolve => setTimeout(resolve, params.waitTime || 2000));

// Or use MutationObserver
const waitForElement = (selector, timeout = 5000) => {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) return resolve(element);

    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
};
```

**Issue: Data extraction incomplete**
```javascript
// Extract more comprehensive data
const extractProductData = (element) => {
  return {
    title: element.querySelector('h2')?.textContent?.trim() || null,
    price: element.querySelector('.a-price .a-offscreen')?.textContent || null,
    rating: element.querySelector('.a-icon-star-small')?.textContent || null,
    reviews: element.querySelector('.a-size-small .a-link-normal')?.textContent || null,
    imageUrl: element.querySelector('img')?.src || null,
    url: element.querySelector('h2 a')?.href || null
  };
};
```

### Step 14: Update Macro

Use `browser_update_macro` to apply fixes:

**Tool**: `mcp__unibrowse__browser_update_macro`

**Parameters**:
```json
{
  "id": "[MACRO_UUID]",
  "code": "[UPDATED_CODE]",
  "reliability": "medium",  // Update based on test results
  "description": "[Updated description if needed]"
}
```

### Step 15: Re-test

Repeat Phase 4 (Steps 10-12) with updated macro.

**Goal**: Achieve 100% pass rate on all test cases.

### Step 16: Document Final Macro

Add to appropriate documentation file (e.g., AMAZON_MACROS.md):

```markdown
### amazon_product_search

**Category**: search
**Reliability**: high
**ID**: [UUID]

**Description**:
Search for products on Amazon with optional result clicking.

**Parameters**:
- `query` (string, required) - Search query
- `position` (number, optional) - Which result to click (1-based)
- `waitTime` (number, optional, default: 2000) - Wait after search

**Returns**:
```json
{
  "success": true,
  "message": "Search completed",
  "data": {
    "query": "laptop",
    "resultCount": 48,
    "clickedPosition": 2  // If position specified
  }
}
```

**Example**:
```javascript
browser_execute_macro({
  id: "[UUID]",
  params: { query: "wireless headphones", position: 1 }
})
```

**Test Results**: 100% pass rate (4/4 test cases)
**Created**: 2024-01-15
**Last Updated**: 2024-01-15
```

---

## Special Cases

### Learning Multi-Step Workflows

For complex workflows (e.g., "add to cart and checkout"):

1. **Break into sub-macros** - Create separate macros for each logical step
2. **Chain macros** - Document the sequence in workflow guide
3. **Share state** - Return data needed by next macro

**Example**:
```
Workflow: Amazon Purchase
1. amazon_product_search({ query: "item" })
2. amazon_get_product_details()
3. amazon_add_to_cart()
4. amazon_go_to_checkout()  // ⚠️ Requires user confirmation!
```

### Learning Pagination Patterns

For workflows involving pagination:

1. **Request user to demonstrate** navigating through 2-3 pages
2. **Capture interaction patterns** - Look for "Next" button selectors
3. **Generate loop-based macro**:

```javascript
(params) => {
  const results = [];
  const maxPages = params.maxPages || 3;

  for (let page = 1; page <= maxPages; page++) {
    // Extract data from current page
    const pageData = extractCurrentPage();
    results.push(...pageData);

    // Find and click next button
    const nextButton = document.querySelector('a.s-pagination-next');
    if (!nextButton || nextButton.classList.contains('s-pagination-disabled')) {
      break;  // Last page
    }

    nextButton.click();
    // Wait for next page to load (this is tricky in synchronous macro!)
  }

  return { success: true, data: results, pagesProcessed: page };
}
```

**Note**: Pagination macros are complex because page loads require async waiting. Consider using multiple macro calls instead:

```
// Better approach
for page 1 to maxPages:
  call amazon_extract_page_data()
  call amazon_click_next_page()
  wait 2 seconds
```

### Learning Form Filling

For form workflows:

1. **Request user to fill out form** (but NOT submit - safety!)
2. **Capture typing events** - Get field selectors and values
3. **Generate form-filling macro**:

```javascript
(params) => {
  const fields = params.fields || {};
  const results = [];

  for (const [fieldName, value] of Object.entries(fields)) {
    // Try multiple selector strategies
    let input = document.querySelector(`input[name="${fieldName}"]`) ||
                document.querySelector(`input[id="${fieldName}"]`) ||
                document.querySelector(`input[placeholder*="${fieldName}"]`);

    if (input) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      results.push({ field: fieldName, success: true });
    } else {
      results.push({ field: fieldName, success: false, error: 'Field not found' });
    }
  }

  return { success: true, data: { fieldsFilled: results } };
}
```

---

## Safety Protocols

### Never Auto-Execute These Actions

❌ **Form Submission** - Always require explicit user confirmation
❌ **Payment/Purchase** - Never automate checkout completion
❌ **Account Deletion** - Never automate destructive actions
❌ **Login** - Never store or auto-fill credentials
❌ **File Upload** - Requires user to select files manually

### Macro Safety Checklist

Before storing a macro, verify:

- [ ] No hardcoded credentials or sensitive data
- [ ] No automatic form submissions (preview only)
- [ ] No purchase/payment actions
- [ ] Clear error messages for all failure modes
- [ ] Graceful degradation if elements not found
- [ ] Returns structured data (not raw HTML)
- [ ] Documented parameters and return values
- [ ] Tested on at least 3 different inputs

---

## Example: Full Learning Session

### User Request
"Can you learn how to search Amazon and get product prices?"

### Your Response

```
I'll learn how to search Amazon and extract product prices. Let me capture a demonstration from you.

I need you to demonstrate this workflow:
1. Navigate to Amazon.com
2. Search for "laptop"
3. Wait for results to load
4. Look at the first 3 product prices

I'll record your interactions and create a reusable macro.

Should I proceed?
```

### User: "Yes, go ahead"

```javascript
// Step 1: Create demo tab
browser_create_tab({ url: "https://amazon.com" })
// Returns: { tabId: 12345 }

// Step 2: Label tab
browser_set_tab_label({ tabTarget: 12345, label: "amazon-macro-demo" })

// Step 3: Request demonstration
browser_request_user_action({
  request: "Please demonstrate searching Amazon for 'laptop' and viewing the first 3 product prices: 1) Type 'laptop' in search box, 2) Click search or press Enter, 3) Wait for results to load, 4) Scroll to see first 3 products",
  timeout: 300,
  tabTarget: "amazon-macro-demo"
})

// Returns when user clicks "Complete":
// { success: true, message: "User completed demonstration" }

// Step 4: Get interactions
browser_get_interactions({
  startTime: -300000,  // Last 5 minutes
  tabTarget: 12345,
  sortOrder: "asc"
})

// Returns: [list of interactions]
```

### Analyze Interactions

```
Captured Interactions:
1. [keyboard] input#twotabsearchtextbox - typed "laptop"
2. [keyboard] Enter key
3. [navigation] https://amazon.com/s?k=laptop
4. [scroll] y: 450 pixels

Key Patterns:
- Search box: input#twotabsearchtextbox (stable ID)
- Submit: Enter key (no button click needed)
- Results container: div[data-component-type="s-search-results"]
- Product cards: div[data-component-type="s-search-result"]
- Price selector: span.a-price span.a-offscreen
```

### Generate Macro

```javascript
// Macro Code
(params) => {
  const { query, maxResults = 10 } = params;

  if (!query) {
    return { success: false, error: 'query parameter required' };
  }

  // 1. Find search box
  const searchBox = document.querySelector('input#twotabsearchtextbox');
  if (!searchBox) {
    return { success: false, error: 'Search box not found' };
  }

  // 2. Enter query
  searchBox.value = query;
  searchBox.dispatchEvent(new Event('input', { bubbles: true }));

  // 3. Submit search
  searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  // Note: Actual price extraction would happen AFTER page loads
  // This macro just initiates the search

  return {
    success: true,
    message: `Searching for "${query}"`,
    data: { query, timestamp: Date.now() }
  };
}

// Store Macro
browser_store_macro({
  site: "amazon.com",
  category: "search",
  name: "amazon_search_products",
  description: "Search for products on Amazon using the main search box",
  parameters: {
    query: {
      type: "string",
      description: "Search query term",
      required: true
    },
    maxResults: {
      type: "number",
      description: "Maximum results to extract (not implemented yet)",
      required: false,
      default: 10
    }
  },
  code: "[CODE_ABOVE]",
  returnType: "{ success: boolean, message: string, data: { query, timestamp } }",
  reliability: "untested",
  tags: ["amazon", "search", "products"]
})

// Returns: { success: true, macro: { id: "abc-123", ... } }
```

### Test Macro

```javascript
// Test Case 1: Basic search
browser_execute_macro({
  id: "abc-123",
  params: { query: "wireless mouse" },
  tabTarget: 12345
})

// Verify: Check that search executed, URL changed to /s?k=wireless+mouse

// Test Case 2: Edge case - special characters
browser_execute_macro({
  id: "abc-123",
  params: { query: "laptop 15\" screen" },
  tabTarget: 12345
})

// Verify: Special characters handled correctly
```

### Report to User

```
✅ Macro Created Successfully!

I've learned how to search Amazon and created a reusable macro:

**Macro**: amazon_search_products
**ID**: abc-123
**Reliability**: medium (tested with 2 test cases)

**Usage**:
browser_execute_macro({
  id: "abc-123",
  params: { query: "your search term" }
})

**Note**: This macro initiates the search. To extract product prices, I would need to create a companion macro (amazon_extract_product_prices) that runs AFTER the search results load. Would you like me to learn that workflow next?
```

---

## Troubleshooting

### Issue: User interactions not captured

**Cause**: Tab not attached or wrong tabTarget
**Fix**: Verify tab is attached with `browser_list_attached_tabs` before requesting demonstration

### Issue: Selectors don't work reliably

**Cause**: Dynamic selectors, site changes
**Fix**: Use multiple fallback selectors, prefer data attributes and stable IDs

### Issue: Macro works in testing but fails in production

**Cause**: Timing issues, different page states
**Fix**: Add explicit waits, check for element visibility, handle multiple page states

### Issue: Complex workflow too hard to capture in one macro

**Cause**: Workflow requires multiple page loads, async operations
**Fix**: Break into multiple macros, chain them with explicit tool calls

---

## Quick Reference

### Learning Workflow Summary

```
1. User requests automation
2. Ask permission to capture demonstration
3. browser_request_user_action({ request: "..." })
4. browser_get_interactions({ startTime: -300000 })
5. Analyze patterns, identify parameters
6. Write macro code with error handling
7. browser_store_macro({ ... })
8. Test with multiple test cases
9. browser_update_macro({ ... }) if fixes needed
10. Document in appropriate macro reference file
```

### Essential Tools

- `browser_request_user_action` - Capture user demonstrations
- `browser_get_interactions` - Retrieve interaction log
- `browser_store_macro` - Save new macro
- `browser_execute_macro` - Test macro
- `browser_update_macro` - Fix/improve macro
- `browser_list_macros` - Find existing macros
- `browser_delete_macro` - Remove failed macro

---

## Remember

✅ **Always ask user permission** before capturing demonstrations
✅ **Provide clear instructions** in request messages
✅ **Test thoroughly** before marking as "high reliability"
✅ **Document well** - future you will thank current you
✅ **Safety first** - never automate sensitive actions
✅ **Iterate** - first version rarely perfect

**Start by learning simple workflows, then build up to complex automation!**
