---
name: browser
description: Browser automation using the browser MCP for web scraping, form filling, content extraction, and macro execution. Use when user asks to open websites, search pages, extract data, fill forms, or automate browser tasks.
---

# Browser Automation Skill

You have access to comprehensive browser automation via the browser MCP. Use these guidelines when performing browser tasks.

## Tab Management (Check First!)

**Default behavior:** Create a new tab unless user specifies an existing one.

**Check if user specified a tab:**
- Look for: "in tab X", "use tab Y", "in the X-tab", "on tab Z"
- If YES: Use that tab with `tabTarget` parameter
- If NO: Create new tab + set label

## Page Content Strategy

**CRITICAL: Avoid `browser_snapshot` - it wastes massive context!**

**Default approach:**
```javascript
mcp__browser__browser_get_visible_text({
  maxLength: 3000  // Always truncate
});
```

**Use specialized macros (preferred):**
- `get_interactive_elements` - Find buttons, links, inputs
- `discover_forms` - Analyze forms
- `extract_table_data` - Get table data
- `extract_main_content` - Article extraction

**Use `browser_snapshot` ONLY as last resort** when you need exact element refs for clicking.

## Macro-First Approach

Always check for existing macros before using direct control:

```javascript
// 1. Check site-specific macros
mcp__browser__browser_list_macros({ site: "example.com" });

// 2. Check universal macros
mcp__browser__browser_list_macros({ site: "*" });

// 3. Execute macro if available
mcp__browser__browser_execute_macro({
  id: "macro-id",
  params: { ... }
});
```

## Available Universal Macros (40+)

**Essential Exploration:**
- `get_interactive_elements` - All buttons/links/inputs
- `discover_forms` - Form analysis
- `detect_messages` - Error/success messages
- `find_element_by_description` - Natural language search

**Data Extraction:**
- `extract_table_data` - HTML tables
- `extract_main_content` - Reader mode
- `get_page_outline` - Document structure

**Page Cleanup:**
- `smart_cookie_consent` - Handle cookies
- `dismiss_interruptions` - Auto-dismiss popups
- `close_modal` - Close modals

**Advanced:**
- `audit_accessibility` - WCAG audit
- `measure_page_performance` - Performance metrics
- `analyze_form_requirements` - Form validation

## Standard Workflow

```javascript
// 1. Tab setup (if no tab specified)
const tab = mcp__browser__browser_create_tab({ url: "https://..." });
mcp__browser__browser_set_tab_label({ tabTarget: tab.id, label: "descriptive-name" });

// 2. Get page content (save context!)
mcp__browser__browser_get_visible_text({ maxLength: 3000 });

// 3. Check for macros
mcp__browser__browser_list_macros({ site: "domain.com" });

// 4. Execute macro or direct control
mcp__browser__browser_execute_macro({ id: "...", params: {} });

// 5. Return results
```

## Creating Site-Specific Macros

If you discover a reusable pattern, store it:

```javascript
mcp__browser__browser_store_macro({
  site: "example.com",  // or "*" for universal
  category: "search",   // search, extraction, navigation, interaction, form, util
  name: "example_search",
  description: "Search example.com with filters",
  parameters: {
    query: { type: "string", description: "Search query", required: true }
  },
  code: "(params) => { /* JavaScript */ return result; }",
  returnType: "Object with results array",
  reliability: "untested",
  tags: ["search", "filters"]
});
```

## Multi-Tab Operations

```javascript
// Create multiple tabs for comparison
const tab1 = mcp__browser__browser_create_tab({ url: "https://site1.com" });
const tab2 = mcp__browser__browser_create_tab({ url: "https://site2.com" });

// Label them
mcp__browser__browser_set_tab_label({ tabTarget: tab1.id, label: "site-1" });
mcp__browser__browser_set_tab_label({ tabTarget: tab2.id, label: "site-2" });

// Execute in parallel
mcp__browser__browser_execute_macro({ id: "...", tabTarget: "site-1" });
mcp__browser__browser_execute_macro({ id: "...", tabTarget: "site-2" });
```

## Token Conservation

1. **Always truncate:** Use `maxLength` on `get_visible_text`
2. **Use targeted macros:** Get only what you need
3. **Avoid snapshots:** Only use as absolute last resort
4. **Clean first:** Remove interruptions before main operations

## Remember

- ✅ Check for tab specification first
- ✅ Default to new tab (prevents interference)
- ✅ Use `get_visible_text` with truncation (not snapshot!)
- ✅ Check for macros before direct control
- ✅ Store reusable patterns as macros
- ✅ Label tabs descriptively
- ✅ Chain operations in parallel when possible

Start working immediately. No preamble needed.
