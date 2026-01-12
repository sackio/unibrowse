---
name: browser
description: Browser automation using the browser MCP for web scraping, form filling, content extraction, and macro execution. Use when user asks to open websites, search pages, extract data, fill forms, or automate browser tasks.
---

# ⚠️ CRITICAL: MACRO-FIRST EXECUTION MANDATE ⚠️

🚨 **STOP**: Before ANY browser operation, you MUST complete Step 0 below 🚨

## 🛑 Step 0: Pre-Flight Macro Check (MANDATORY)

**DO NOT SKIP THIS STEP** - Complete BEFORE any workflow:

### ✅ Required Actions (Execute in Order):

1. **Check site-specific macros**:
   ```
   Extract domain from URL (e.g., "amazon.com")
   Call: browser_list_macros({ site: "<domain>", category: "<optional-filter>" })
   ```

2. **If no site-specific macros found, check universal macros**:
   ```
   Call: browser_list_macros({ site: "*", category: "<optional-filter>" })
   ```

3. **If macro found → MUST use it**:
   ```
   Call: browser_execute_macro({
     id: "<macro_id>",
     params: { /* macro-specific parameters */ },
     tabTarget: tabId
   })
   ```

4. **If NO macro found → Document gap, then use direct tools**:
   - State explicitly: "No macro found for [site] + [operation]"
   - Then proceed with browser_click, browser_type, etc.

### ❌ NEVER Do This:

- ❌ Navigate without calling browser_list_macros first
- ❌ Use browser_click/browser_type before macro verification
- ❌ Assume "no macros exist" without checking both site-specific AND universal
- ❌ Skip Step 0 to "save time"
- ❌ Use browser_snapshot for data extraction without checking extraction macros

### 📋 Checklist (Must Complete ALL Before Proceeding):

- [ ] Called browser_list_macros for site-specific macros?
- [ ] Called browser_list_macros for universal macros (* site)?
- [ ] Using browser_execute_macro if macro found?
- [ ] Documented macro gap if none exist?

**If you cannot check ALL boxes above, you are NOT ready to proceed.**

---

## 💡 Why Macros Are Mandatory

- **Token efficiency**: Macros return structured data (10-100x fewer tokens than browser_snapshot)
- **Reliability**: Macros are tested workflows (error rate <1% vs 15% for manual operations)
- **Speed**: Single macro call vs 5-10 manual tool calls
- **Maintainability**: Site changes break manual flows, macros get updated centrally

---

## 🚫 Common Mistakes (AVOID THESE - Read Before Continuing)

### Mistake 1: "I'll just navigate directly"
❌ **Wrong Approach**:
```
browser_navigate("https://amazon.com/s?k=product")
browser_snapshot()  // Returns 5000 tokens of HTML
browser_click({ ref: "...", element: "first product" })
browser_get_visible_text()  // Returns 2000 tokens
TOTAL: 7000+ tokens, 4+ tool calls
```

✅ **Correct Approach**:
```
browser_list_macros({ site: "amazon.com", category: "search" })
browser_execute_macro({
  id: "amazon_search",
  params: { query: "product" }
})
TOTAL: ~200 tokens, 2 tool calls
```

**Savings**: 6,800+ tokens (97% reduction), 2x faster

### Mistake 2: "Macros probably don't exist for this"
❌ **Wrong**: Assuming no macros without checking
✅ **Right**: ALWAYS check site-specific AND universal macros

**Reality Check**: 147+ macros exist across sites
- Universal extraction macros (tables, forms, lists)
- Universal navigation macros (pagination, scrolling)
- Universal search macros (site search patterns)
- Site-specific macros (Amazon 17, eBay 18, Google Shopping 12, Walmart 5, +more)

### Mistake 3: "Step 0 is too much overhead"
❌ **Wrong**: Skipping Step 0 to "save time"
✅ **Right**: Step 0 takes 5 seconds, saves 5+ minutes and 10,000 tokens

**Real Cost Comparison**:
- Macro approach: 2 tool calls, ~500 tokens
- Direct approach: 6-8 tool calls, ~15,000 tokens
- **Result**: Step 0 verification is FREE time savings

---

## 🔄 Reminder: Macro-First Execution

**Status Check**: Have you completed Step 0 above?
- [ ] Checked for macros? (browser_list_macros)
- [ ] Using macros when available? (browser_execute_macro)
- [ ] Documented any gaps?

**Do not proceed with manual operations if macros exist.**

---

# Browser Automation Skill

This skill provides browser automation capabilities through **macro-first execution** of MCP tools. You must always check for macros before using direct tools.

## When to Use This Skill

Activate when the user requests:
- Web browsing or navigation
- Data extraction or web scraping
- Form filling or automation
- E-commerce operations (Amazon, Google Shopping, Walmart)
- Testing or quality assurance
- Screenshot capture and analysis
- Multi-tab workflows

## Specialization Modules (Route-Specific Instructions)

Based on task type, follow the appropriate module:

| Task Type | Module | Trigger Keywords |
|-----------|--------|-----------------|
| E-Commerce | ECOMMERCE.md | amazon, shopping, price, product, reviews, buy, purchase, compare prices, best deal, rufus, cart, google shopping, walmart |
| Form Automation | FORMS.md | form, fill, submit, input, field, validation, signup, register, contact form |
| Web Scraping | SCRAPER.md | scrape, extract, data, table, pagination, export, collect, gather, crawl |
| QA Testing | QA.md | test, qa, accessibility, performance, audit, wcag, a11y, validate, check, analyze |
| Screenshot Analysis | SCREENSHOT_ANALYSIS.md | screenshot, analyze screenshot, visual, layout, design consistency, contrast |
| Macro Learning | MACRO_LEARNING.md | learn, automate this, create macro, record, capture, demonstrate, teach you |
| Generic Operations | Direct Execution | navigate, go to, open, screenshot, tab, browse, visit |

---

## Available Macro Categories (91+ Macros)

### Universal Macros (40+)

- **extraction**: `get_interactive_elements`, `extract_table_data`, `extract_main_content`, `extract_form_fields`
- **form**: `discover_forms`, `fill_form_fields`, `validate_form`, `submit_form_safe`
- **navigation**: `smart_scroll`, `wait_for_element`, `check_page_loaded`, `pagination_next`
- **util**: `smart_cookie_consent`, `dismiss_interruptions`, `close_modal`, `detect_interruptions`
- **interaction**: `safe_click`, `type_with_validation`, `select_dropdown`, `hover_element`

### Site-Specific Macros (51)

- **Amazon** (17 macros): Search, product details, reviews, Rufus AI, cart operations
- **Google Shopping** (12 macros): Product search, comparison, price tracking
- **Walmart** (5 macros): Search, product details, reviews
- **eBay** (18 macros): Search, listings, auction bidding, seller operations
- **Upwork** (4 macros): Job search, proposal submission
- **Fidelity** (4 macros): Account navigation, portfolio analysis
- **OpenGameArt** (3 macros): Asset search, license filtering
- **CoinTracker** (3 macros): Portfolio tracking, transaction import
- **Google** (3 macros): Search, results extraction

**Full Documentation**: See `.claude/skills/browser/MACROS.md` and site-specific guides

---

## How This Skill Works

1. **User makes browser request**
2. **You MUST complete Step 0** (Check for macros - see top of this file)
3. **Detect task type** from user request (keywords, intent analysis)
4. **Route to specialization module** (ECOMMERCE.md, FORMS.md, SCRAPER.md, QA.md, SCREENSHOT_ANALYSIS.md)
5. **Follow module instructions** to invoke MCP tools
6. **Preserve tab context** for multi-turn workflows
7. **Return results** with tab metadata for future operations

---

## 🔄 Reminder: Step 0 Verification (Every 200 Lines)

**Before continuing with operations below**:
1. Have you checked for macros? (browser_list_macros)
2. Are you using macros when available? (browser_execute_macro)
3. Is there a universal macro for this pattern?

**Do not proceed with manual operations if macros exist.**

---

## Execution Patterns

### Pattern 1: Macro-First Execution (MANDATORY)

**ALWAYS follow this pattern** for browser automation tasks - Step 0 is NOT optional:

1. **Check site-specific macros first**:
   ```
   Extract domain from URL (e.g., "amazon.com" from "https://www.amazon.com/...")

   Call: mcp__browser__browser_list_macros({
     site: "amazon.com",
     category: "search"  // optional filter
   })

   If macro found → Use macro (go to step 3)
   If not found → Check universal macros (go to step 2)
   ```

2. **Check universal macros**:
   ```
   Call: mcp__browser__browser_list_macros({
     site: "*",
     category: "extraction"  // or relevant category
   })

   If macro found → Use macro (go to step 3)
   If not found → Use direct MCP tools (go to step 4)
   ```

3. **Execute macro**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "{macro_id}",
     params: { /* macro-specific parameters */ },
     tabTarget: tabId  // if operating on existing tab
   })

   Return result with tab metadata
   ```

4. **Fall back to direct MCP tools**:
   ```
   Use browser_click, browser_type, browser_get_visible_text, etc.
   Follow token conservation rules (see below)
   ```

### Pattern 2: Tab Creation and Labeling

**Always create and label tabs** for organized multi-turn workflows:

```
1. Create tab:
   Call: mcp__browser__browser_create_tab({ url: "https://example.com" })
   Store tabId from result.content.tabId

2. Label tab:
   Call: mcp__browser__browser_set_tab_label({
     tabTarget: tabId,
     label: "descriptive-name"  // e.g., "amazon-search", "form-filling", "scraping-products"
   })

3. Store tab context for future operations:
   amazonTab = 123
   walmartTab = 456
```

### Pattern 3: Multi-Turn Workflow

**Preserve tab context** across conversation turns:

```
Turn 1 - User: "Search Amazon for headphones"
You:
  1. Complete Step 0 (check for macros) ← REQUIRED FIRST
  2. Create tab (tabId = 123), label "amazon-search"
  3. Execute search macro or navigate + search
  4. Return results with tab metadata: { tabId: 123, label: "amazon-search", ... }
  5. STORE: amazonTab = 123

Turn 2 - User: "Get more details on the first result"
You:
  1. Complete Step 0 again (re-verify for macros for new operation)
  2. Use stored tab ID: tabTarget = 123
  3. Execute detail macro or click + extract
  4. Return results with same tab metadata
```

### Pattern 4: Cleanup Before Operations

**Always clean interruptions first** (cookie consents, modals, popups):

```
Before main operation:
  1. Check for cleanup macros:
     Call: mcp__browser__browser_list_macros({ site: "*", search: "cookie" })

  2. Execute cleanup:
     Call: mcp__browser__browser_execute_macro({
       id: "smart_cookie_consent",
       tabTarget: tabId
     })

     Call: mcp__browser__browser_execute_macro({
       id: "dismiss_interruptions",
       tabTarget: tabId
     })

  3. Then proceed with main operation
```

---

## 🔄 Reminder: Step 0 Verification (Every 200 Lines)

**Before continuing with operations below**:
1. Have you checked for macros? (browser_list_macros)
2. Are you using macros when available? (browser_execute_macro)
3. Is there a universal macro for this pattern?

**Do not proceed with manual operations if macros exist.**

---

## Token Conservation Rules

**CRITICAL**: Always minimize token usage when executing browser automation. Macros are essential for this.

### Rule 1: Avoid `browser_snapshot`

**Problem**: Returns massive ARIA tree (10,000+ tokens)

**Solution**: Use targeted alternatives OR macros

```
❌ DON'T:
Call: mcp__browser__browser_snapshot({ tabTarget: tabId })

✅ DO:
Call: mcp__browser__browser_get_visible_text({
  maxLength: 3000,
  tabTarget: tabId
})

OR use macros:
Call: mcp__browser__browser_execute_macro({
  id: "get_interactive_elements",
  tabTarget: tabId
})
```

### Rule 2: Use Specialized Macros

**Problem**: Generic extraction returns too much data

**Solution**: Use targeted macros first

```
❌ DON'T:
Call: mcp__browser__browser_get_visible_text({ maxLength: 10000 })

✅ DO:
Call: mcp__browser__browser_execute_macro({
  id: "get_interactive_elements",  // Returns only buttons, links, inputs
  tabTarget: tabId
})

OR:
Call: mcp__browser__browser_execute_macro({
  id: "extract_table_data",  // Returns only table data
  tabTarget: tabId
})
```

### Rule 3: Always Truncate Text Extraction

**Problem**: Full page text wastes tokens

**Solution**: Always set `maxLength`

```
❌ DON'T:
Call: mcp__browser__browser_get_visible_text({ tabTarget: tabId })

✅ DO:
Call: mcp__browser__browser_get_visible_text({
  maxLength: 3000,  // or 5000 for longer pages
  tabTarget: tabId
})
```

### Rule 4: Limit DOM Queries

**Problem**: Returning 100+ elements wastes tokens

**Solution**: Always set `limit`

```
❌ DON'T:
Call: mcp__browser__browser_query_dom({
  selector: "div",
  tabTarget: tabId
})

✅ DO:
Call: mcp__browser__browser_query_dom({
  selector: "button.primary, a.cta",  // Specific selector
  limit: 10,  // Reasonable limit
  tabTarget: tabId
})
```

### Rule 5: Use Macros for Cleanup

**Problem**: Manual popup dismissal requires multiple steps

**Solution**: Use cleanup macros (most token-efficient)

```
✅ Efficient:
Call: mcp__browser__browser_execute_macro({
  id: "smart_cookie_consent",
  tabTarget: tabId
})

Call: mcp__browser__browser_execute_macro({
  id: "dismiss_interruptions",
  tabTarget: tabId
})
```

---

## Tab Context Preservation

**Pattern**: Create tabs → store IDs → reuse in follow-ups

### Tab Creation Workflow

```
1. User requests browser operation
2. Create tab with descriptive URL
3. Label tab with meaningful name
4. Execute operation (AFTER Step 0 macro check)
5. Return result with tab metadata
6. Store tab ID for future use
```

### Tab Metadata Format

**Always return** tab metadata with results:

```json
{
  "tabId": 123,
  "tabLabel": "amazon-search",
  "url": "https://www.amazon.com/s?k=headphones",
  "timestamp": "2025-12-22T11:58:10Z",
  "data": { /* operation results */ }
}
```

### Multi-Tab Scenarios

**Scenario 1: Parallel Comparison**

```
User: "Compare prices on Amazon and Walmart"

You:
1. Create Amazon tab (amazonTab = 123)
2. Create Walmart tab (walmartTab = 456)
3. Execute searches in both tabs (use tabTarget parameter)
   - REMEMBER: Step 0 macro check for EACH site
   - Use amazon_search macro for Amazon
   - Use walmart_search macro for Walmart
4. Return results: { amazonTab: 123, walmartTab: 456, comparison: [...] }
5. Store both tab IDs

Follow-up: "Get more details on the Amazon result"
Use tabTarget = 123 (amazonTab)
```

**Scenario 2: Sequential Workflow**

```
User: "Fill out the contact form on example.com"

You:
1. Create tab (formTab = 123)
2. Discover forms (following FORMS.md and Step 0 macro check)
3. Fill fields
4. Generate preview (DO NOT submit)
5. Return preview with tab metadata
6. Store formTab = 123

Follow-up: "Submit the form"
Use tabTarget = 123 (formTab)
Call: mcp__browser__browser_submit_form (ONLY after user approval)
```

### Tab Management Commands

**List attached tabs**:
```
Call: mcp__browser__browser_list_attached_tabs()
Returns: Array of { tabId, label, url }
```

**Attach to existing tab**:
```
Call: mcp__browser__browser_attach_tab({ tabId: 123 })
OR
Call: mcp__browser__browser_attach_tab({ autoOpenUrl: "https://example.com" })
```

**Close tab**:
```
Call: mcp__browser__browser_close_tab({ tabId: 123 })
```

---

## Error Handling

### Common Errors and Solutions

**Error**: "No attached tabs"
```
Solution:
1. List attached tabs: mcp__browser__browser_list_attached_tabs()
2. If none, create and attach: mcp__browser__browser_attach_tab({ autoOpenUrl: "https://example.com" })
3. IMPORTANT: Before proceeding, complete Step 0 macro check
4. Retry operation with tabTarget
```

**Error**: "Tab not found (ID: 123)"
```
Solution:
1. List attached tabs to verify tab still exists
2. If tab closed, create new tab
3. Update stored tab ID
4. Complete Step 0 macro check before new operation
```

**Error**: "Macro not found"
```
Solution:
1. List available macros: mcp__browser__browser_list_macros({ site: "domain.com" })
2. Check spelling of macro ID
3. Fall back to direct MCP tools if macro doesn't exist
4. Document: "No macro found for [site] + [operation]"
```

**Error**: "Navigation timeout"
```
Solution:
1. Retry navigation with increased wait time
2. Check if site is accessible
3. Use browser_wait({ time: 5 }) before retrying
4. If stuck, try macro-based navigation (if available)
```

**Error**: "Element not found"
```
Solution:
1. Use browser_query_dom to verify element exists
2. Try alternative selectors (ID, class, text content)
3. Check if element is in iframe or shadow DOM
4. Wait for dynamic content: browser_wait({ time: 2 })
5. Consider extraction macros for robustness
```

**Error**: "Cannot read property of undefined"
```
Solution:
1. Verify return structure from MCP tool
2. Check that result.content exists before accessing properties
3. Add null checks: tabId = result?.content?.tabId || null
```

---

## Quick Reference

### Generic Browser Operations

**Navigate to URL**:
```
Call: mcp__browser__browser_navigate({
  url: "https://example.com",
  tabTarget: tabId  // optional
})
```

**Take screenshot**:
```
Call: mcp__browser__browser_screenshot({
  tabTarget: tabId  // optional
})
```

**Get visible text**:
```
Call: mcp__browser__browser_get_visible_text({
  maxLength: 3000,
  tabTarget: tabId  // optional
})
```

**Click element**:
```
Call: mcp__browser__browser_click({
  element: "Submit button",
  ref: "element-reference-from-snapshot",
  tabTarget: tabId  // optional
})
```

**Type text**:
```
Call: mcp__browser__browser_type({
  element: "Search input",
  ref: "element-reference-from-snapshot",
  text: "query text",
  submit: false,  // or true to press Enter
  tabTarget: tabId  // optional
})
```

**Query DOM**:
```
Call: mcp__browser__browser_query_dom({
  selector: "button.primary",
  limit: 10,
  tabTarget: tabId  // optional
})
```

**Execute macro**:
```
Call: mcp__browser__browser_execute_macro({
  id: "macro_id",
  params: { /* macro-specific */ },
  tabTarget: tabId  // optional
})
```

### Tab Management

**Create tab**:
```
Call: mcp__browser__browser_create_tab({
  url: "https://example.com"  // optional
})
Store: tabId = result.content.tabId
```

**Label tab**:
```
Call: mcp__browser__browser_set_tab_label({
  tabTarget: tabId,
  label: "descriptive-name"
})
```

**List tabs**:
```
Call: mcp__browser__browser_list_attached_tabs()
```

**Close tab**:
```
Call: mcp__browser__browser_close_tab({
  tabId: tabId
})
```

### Macro Discovery

**List all macros for site**:
```
Call: mcp__browser__browser_list_macros({
  site: "amazon.com"  // or "*" for universal
})
```

**Search macros by category**:
```
Call: mcp__browser__browser_list_macros({
  site: "amazon.com",
  category: "search"  // or "extraction", "form", etc.
})
```

**Search macros by keyword**:
```
Call: mcp__browser__browser_list_macros({
  site: "*",
  search: "cookie"  // finds "smart_cookie_consent"
})
```

---

## Execution Workflow Summary

```
1. User makes browser automation request
2. ✅ COMPLETE STEP 0 FIRST - Macro check (browser_list_macros)
3. Detect task type (keywords, intent)
4. Route to specialization module:
   - E-commerce → ECOMMERCE.md (STEP 0 required)
   - Form automation → FORMS.md (STEP 0 required)
   - Web scraping → SCRAPER.md (STEP 0 required)
   - QA testing → QA.md (STEP 0 required)
   - Screenshot analysis → SCREENSHOT_ANALYSIS.md
   - Generic → Direct execution (STEP 0 still required)
5. Follow module instructions:
   - Create/attach tab
   - COMPLETE STEP 0 (macro check)
   - Clean interruptions (cookie consents, modals)
   - Execute operation
   - Extract/process results
   - Apply token conservation
6. Return results with tab metadata
7. Store tab ID for future operations
8. Handle follow-up requests using stored tab context
```

---

## Remember

- ✅ **COMPLETE STEP 0 FIRST** - Check for macros before ANY browser operation
- ✅ **Execute tools directly** - You have MCP access, no delegation needed
- ✅ **Follow specialization modules** - They provide step-by-step instructions
- ✅ **Macro-first pattern** - Site-specific → universal → direct tools (MANDATORY)
- ✅ **Preserve tab context** - Store tab IDs, reuse in follow-ups
- ✅ **Conserve tokens** - Avoid snapshots, use macros, truncate text, limit queries
- ✅ **Clean before operating** - Handle cookie consents and popups first
- ✅ **Label tabs meaningfully** - Enables easy reference in multi-tab workflows
- ✅ **Return tab metadata** - Include tabId, label, URL in all results
- ✅ **Never auto-submit forms** - Always generate preview first, wait for approval
- ✅ **Handle errors gracefully** - Verify tabs exist, fall back to alternatives
- ✅ **Document macro gaps** - When no macro exists, state clearly before using direct tools

## Further Reading

**Specialization Modules**:
- `.claude/skills/browser/ECOMMERCE.md` - E-commerce automation (Amazon, Google Shopping, Walmart)
- `.claude/skills/browser/FORMS.md` - Form discovery and safe submission
- `.claude/skills/browser/SCRAPER.md` - Web scraping and data export
- `.claude/skills/browser/QA.md` - Accessibility and performance testing
- `.claude/skills/browser/SCREENSHOT_ANALYSIS.md` - Screenshot analysis and WCAG compliance

**Reference Documentation**:
- `.claude/skills/browser/MACROS.md` - Universal macro documentation
- `.claude/skills/browser/MACRO_LEARNING.md` - Learning new macros from user demonstrations
- `.claude/skills/browser/MULTI_TAB.md` - Deep dive on multi-tab workflows
- `.claude/skills/browser/TROUBLESHOOTING.md` - Common issues and solutions

**Site-Specific Guides**:
- `.claude/skills/browser/AMAZON_MACROS.md` - 17 Amazon-specific macros
- `.claude/skills/browser/GOOGLE_SHOPPING_MACROS.md` - 12 Google Shopping macros
- `.claude/skills/browser/WALMART_MACROS.md` - 5 Walmart macros
- `.claude/skills/browser/EBAY_MACROS.md` - 18 eBay macros
- (+ 5 more site-specific guides for Upwork, Fidelity, OpenGameArt, CoinTracker, Google)

---

**Start working immediately when user requests browser automation. NO PREAMBLE NEEDED. ALWAYS complete Step 0 first (macro check), detect task type, route to appropriate module, and execute tools directly.**
