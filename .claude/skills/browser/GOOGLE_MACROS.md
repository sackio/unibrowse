# 🤨 Google Macros Reference

Complete reference for all 1 Google-specific macro for web search automation.

## Table of Contents

1. [Overview](#overview)
2. [Search Macros (1)](#search-macros)
3. [Complete Workflows](#complete-workflows)
4. [Best Practices](#best-practices)
5. [Troubleshooting](#troubleshooting)

---

## Overview

**Google macros** are specialized JavaScript functions stored in MongoDB that automate Google Search operations with realistic human-like behavior. They handle search query submission and navigation on Google.com.

**Total Google Macros**: 1
- **Search**: 1 macro

**Site**: `google.com`

**Usage Pattern**:
```javascript
// 1. Check if macro exists
const macros = await mcp__browser__browser_list_macros({ site: "google.com" });

// 2. Execute macro
const result = await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "python programming tutorial" },
  tabTarget: tabId
});

// 3. Handle navigation
console.log("Search submitted:", result.content);
```

---

## Search Macros

### `google_search`

**Description**: Perform a Google search with realistic human-like typing and behavior. Returns immediately after scheduling the search submission to avoid context loss during page navigation.

**Site**: `google.com`

**Category**: search

**Parameters**:
- `query` (string, required): Search query to type into Google (e.g., "python programming", "weather in NYC", "best restaurants near me")

**Returns**:
```javascript
{
  "success": true,
  "action": "search_submitted",
  "query": "python programming tutorial",
  "method": "realistic_typing",
  "message": "Submitted Google search for \"python programming tutorial\", navigation will occur",
  "note": "Returning before navigation completes to avoid context loss"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "best machine learning libraries python 2025" },
  tabTarget: tabId
});

console.log(`Search submitted: ${result.content.query}`);
console.log(`Method: ${result.content.method}`);
```

**Use Cases**:
- Automated web research workflows
- Search-based data gathering
- Information lookup automation
- SEO and keyword research
- Price comparison research
- Product research and reviews
- News and current events search

**Notes**:
- Uses realistic typing with randomized delays (50-150ms per character)
- Clears existing search query first to avoid appending
- Submits search by pressing Enter key
- **Important**: Returns immediately after scheduling the search to avoid context loss during page navigation
- Similar to other navigation macros (amazon_click_product, amazon_view_all_reviews)
- Page will navigate to search results, so capture any needed data before calling this macro

**Important Behavior**:
The macro schedules the typing and submission asynchronously using `setTimeout` to return immediately. This prevents the macro from hanging during the page transition to search results. The actual typing and submission happen in the background:
```
Timeline:
T+0ms:   Macro returns immediately with "search_submitted" status
T+800ms: Search input gets focus
T+1100ms: Realistic typing begins
T+2000-3000ms: Search completes, page navigates to results
```

---

## Complete Workflows

### Workflow 1: Simple Web Search

```javascript
// Step 1: Navigate to Google (if not already there)
await mcp__browser__browser_navigate({
  url: "https://www.google.com",
  tabTarget: tabId
});

// Step 2: Wait for page to load
await new Promise(resolve => setTimeout(resolve, 2000));

// Step 3: Perform search
const result = await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "artificial intelligence trends 2025" },
  tabTarget: tabId
});

console.log(`Search submitted: ${result.content.query}`);

// Step 4: Wait for results page to load
await new Promise(resolve => setTimeout(resolve, 3000));

// Step 5: Extract search results (using browser tools)
const pageText = await mcp__browser__browser_get_visible_text({
  tabTarget: tabId
});

console.log("Results page loaded and ready for processing");
```

### Workflow 2: Multi-Query Research

```javascript
// List of search queries
const queries = [
  "best programming languages 2025",
  "web development trends 2025",
  "machine learning applications real world",
  "cloud computing platforms comparison"
];

// Function to perform search with delay
const searchWithDelay = async (query, delayMs = 3000) => {
  const result = await mcp__browser__browser_execute_macro({
    id: "google_search",
    params: { query },
    tabTarget: tabId
  });

  console.log(`Searched for: "${query}"`);

  // Wait for results to load
  await new Promise(resolve => setTimeout(resolve, delayMs));

  return result;
};

// Execute searches sequentially
for (const query of queries) {
  await searchWithDelay(query, 3000);

  // Could extract results here before next search
  const results = await mcp__browser__browser_get_visible_text({
    selector: "[data-sokoban-container]",
    tabTarget: tabId,
    maxLength: 2000
  });

  console.log(`Results for "${query}":`, results.substring(0, 500));
}
```

### Workflow 3: Image Search Follow-up

```javascript
// Step 1: Start with regular search
const searchResult = await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "northern lights photography" },
  tabTarget: tabId
});

console.log("Search submitted, waiting for results...");

// Step 2: Wait for results page
await new Promise(resolve => setTimeout(resolve, 3000));

// Step 3: Click on Images tab
const imageTab = await mcp__browser__browser_find_by_text({
  text: "Images",
  tabTarget: tabId
});

if (imageTab.length > 0) {
  await mcp__browser__browser_click({
    element: "Images tab",
    ref: imageTab[0].ref,
    tabTarget: tabId
  });

  console.log("Switched to image search");

  // Step 4: Wait for images to load
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 5: Extract image information
  const images = await mcp__browser__browser_count_elements({
    selector: "img[data-src]",
    tabTarget: tabId
  });

  console.log(`Found ${images} images in results`);
}
```

### Workflow 4: Local Search

```javascript
// Step 1: Search for local businesses
const result = await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "best pizza restaurants near me" },
  tabTarget: tabId
});

console.log("Searching for restaurants...");

// Step 2: Wait for results
await new Promise(resolve => setTimeout(resolve, 3000));

// Step 3: Extract local results
const localResults = await mcp__browser__browser_query_dom({
  selector: ".TQc0E",  // Google local search result container
  tabTarget: tabId,
  limit: 10
});

console.log(`Found ${localResults.length} local results`);

// Step 4: Process results
localResults.forEach(result => {
  console.log("Result:", result);
});
```

---

## Best Practices

### 1. Always Wait for Page Load After Search

Google's page navigation takes 2-3 seconds, and search macros return immediately:

```javascript
// ✅ Good: Wait for results page
await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "web development" },
  tabTarget: tabId
});

// IMPORTANT: Wait for results to load
await new Promise(resolve => setTimeout(resolve, 3000));

// NOW extract or process results
const results = await mcp__browser__browser_get_visible_text({
  tabTarget: tabId
});

// ❌ Bad: Don't extract immediately
await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "web development" },
  tabTarget: tabId
});

// This will get old page content, not search results!
const results = await mcp__browser__browser_get_visible_text({
  tabTarget: tabId
});
```

### 2. Include Complete Search Queries

Use specific, descriptive search queries for better results:

```javascript
// ✅ Good: Specific, descriptive query
await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "how to learn machine learning for beginners 2025" },
  tabTarget: tabId
});

// ❌ Bad: Too vague
await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "learning" },
  tabTarget: tabId
});
```

### 3. Use Search Operators for Precision

Enhance searches with Google's search operators:

```javascript
// ✅ Good: Use search operators
const operators = {
  site_search: 'site:github.com python tutorials',
  exact_match: '"machine learning" "deep learning" differences',
  exclude: 'python programming -game -fun',
  file_type: 'machine learning filetype:pdf',
  year_range: 'artificial intelligence 2024..2025'
};

for (const [name, query] of Object.entries(operators)) {
  await mcp__browser__browser_execute_macro({
    id: "google_search",
    params: { query },
    tabTarget: tabId
  });

  await new Promise(resolve => setTimeout(resolve, 3000));
  console.log(`Searched with ${name}`);
}
```

### 4. Handle Navigation Timing Carefully

Different searches may have different result load times:

```javascript
// ✅ Good: Adaptive wait times
const smartWait = async (minWait = 2000, maxWait = 5000) => {
  const randomWait = minWait + Math.random() * (maxWait - minWait);
  await new Promise(resolve => setTimeout(resolve, randomWait));
};

await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "complex technical query" },
  tabTarget: tabId
});

// Wait with randomization for natural behavior
await smartWait(2000, 4000);
```

### 5. Clean Up Search Box Before New Query

Previous searches might interfere:

```javascript
// ✅ Good: Clear before searching (macro does this)
await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "first query" },
  tabTarget: tabId
});

await new Promise(resolve => setTimeout(resolve, 3000));

// Macro automatically clears the search box
await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "second query" },
  tabTarget: tabId
});

await new Promise(resolve => setTimeout(resolve, 3000));
```

---

## Troubleshooting

### Issue: Search Results Don't Load

**Cause**: Not enough time waited for results page or network issue

**Solution**:
```javascript
// Increase wait time
await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "python programming" },
  tabTarget: tabId
});

// Wait longer for slow networks
await new Promise(resolve => setTimeout(resolve, 5000));

// Verify results loaded
const resultCount = await mcp__browser__browser_count_elements({
  selector: "[data-sokoban-container]",  // Google result containers
  tabTarget: tabId
});

if (resultCount === 0) {
  console.log("Results didn't load, waiting longer...");
  await new Promise(resolve => setTimeout(resolve, 3000));
}
```

### Issue: Search Input Not Found

**Cause**: Not on Google.com or Google page structure changed

**Solution**:
```javascript
// Verify you're on Google
const currentURL = window.location.href;
console.log("Current URL:", currentURL);

if (!currentURL.includes("google.com")) {
  console.log("Navigate to https://www.google.com first");
  await mcp__browser__browser_navigate({
    url: "https://www.google.com",
    tabTarget: tabId
  });

  // Wait for page load
  await new Promise(resolve => setTimeout(resolve, 2000));
}

// Try search again
const result = await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "your query here" },
  tabTarget: tabId
});
```

### Issue: Typing Appears Slow or Unnatural

**Cause**: Realistic typing has randomized delays (50-150ms per character)

**Solution**:
This is intentional behavior to avoid detection as a bot. The randomized typing delays make the search appear human-like. This is not an error - it's a feature.

```javascript
// Expected timing for "python programming" (18 characters)
// Min time: 18 * 50ms = 900ms
// Max time: 18 * 150ms = 2700ms
// Plus navigation delays

// This is correct behavior, not a bug!
const result = await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "python programming" },
  tabTarget: tabId
});
```

### Issue: Page Navigation Happens Too Quickly

**Cause**: Macro schedules search asynchronously to avoid context loss

**Solution**:
This is intentional behavior. The macro returns immediately and schedules the search in the background to prevent hanging during page navigation.

```javascript
// ✅ Correct usage: Macro returns immediately
const result = await mcp__browser__browser_execute_macro({
  id: "google_search",
  params: { query: "machine learning" },
  tabTarget: tabId
});

console.log(result.content.message);  // "...navigation will occur"

// The typing and submission happen asynchronously:
// - T+800ms: Focus search box
// - T+1100ms: Start typing
// - T+2000-3000ms: Actual navigation occurs

// Always wait after calling this macro!
await new Promise(resolve => setTimeout(resolve, 3000));
```

### Issue: Special Characters in Search Query

**Cause**: Certain characters need proper encoding

**Solution**:
```javascript
// ✅ Good: Use proper encoding
const queries = [
  "what is C++ programming",          // & and # characters
  'search with "quotes" in query',    // Quotes in search
  "Python 2.7 vs Python 3.x",         // Versions with dots
  "web:api tutorial"                   // Special characters
];

for (const query of queries) {
  const result = await mcp__browser__browser_execute_macro({
    id: "google_search",
    params: { query },
    tabTarget: tabId
  });

  await new Promise(resolve => setTimeout(resolve, 3000));
}
```

### Issue: Back Button Not Working After Search

**Cause**: Browser history navigation issue

**Solution**:
```javascript
// Use browser back navigation if needed
await mcp__browser__browser_go_back({
  tabTarget: tabId
});

// Or navigate directly
await mcp__browser__browser_navigate({
  url: "https://www.google.com",
  tabTarget: tabId
});

await new Promise(resolve => setTimeout(resolve, 2000));
```

---

## Related Documentation

- **[MACROS.md](./MACROS.md)** - Complete macro reference (57+ macros)
- **[GOOGLE_SHOPPING_MACROS.md](./GOOGLE_SHOPPING_MACROS.md)** - Google Shopping-specific macros (12 macros)
- **[MULTI_TAB.md](./MULTI_TAB.md)** - Multi-tab workflow patterns
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Comprehensive troubleshooting guide

---

**Built with 🤨 by the Unibrowse team**
