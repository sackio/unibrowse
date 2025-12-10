---
name: browser
description: Browser automation using the browser MCP for web scraping, form filling, content extraction, and macro execution. Use when user asks to open websites, search pages, extract data, fill forms, or automate browser tasks.
---

# Browser Automation Skill

This skill provides guidance for browser automation tasks. **You should delegate actual execution to specialized sub-agents** rather than executing MCP tools directly.

## When to Use This Skill

Activate when the user requests:
- Web browsing or navigation
- Data extraction or web scraping
- Form filling or automation
- E-commerce operations (Amazon, shopping)
- Testing or quality assurance
- Screenshot capture
- Multi-tab workflows

## Delegation Strategy

**IMPORTANT**: This skill provides guidance and delegation strategy. **Delegate execution to sub-agents** who have direct MCP access.

### Sub-Agent Selection

Choose the appropriate sub-agent based on task type:

#### 🌐 Generic Browser (`browser`)
**Use for:**
- Simple navigation and screenshots
- Tab creation and management
- Generic page operations
- When no specialized sub-agent applies

**Triggers**: "browse", "navigate", "screenshot", "tab", "open website"

**Delegate with**:
```
Delegate to browser sub-agent to navigate to https://example.com and take a screenshot
```

#### 🛒 E-Commerce (`browser-ecommerce`)
**Use for:**
- Amazon product searches and comparisons
- Price tracking and comparison
- Reviews analysis
- Rufus AI interactions
- Shopping cart operations
- Multi-site price comparisons

**Triggers**: "amazon", "shopping", "price", "product", "reviews", "buy", "purchase"

**Delegate with**:
```
Delegate to browser-ecommerce sub-agent to search Amazon for wireless headphones under $100 with good reviews
```

#### 📝 Form Automation (`browser-forms`)
**Use for:**
- Form discovery and analysis
- Field detection and validation
- Form filling with test data
- Multi-step form wizards
- Submission with safety checks

**Triggers**: "form", "fill", "submit", "input", "field", "validation"

**Delegate with**:
```
Delegate to browser-forms sub-agent to discover and analyze all forms on example.com
```

#### 🔍 Web Scraper (`browser-scraper`)
**Use for:**
- Structured data extraction (tables, lists, products)
- Pagination handling
- Infinite scroll aggregation
- Multi-page data collection
- Export to JSON/CSV

**Triggers**: "scrape", "extract", "data", "table", "pagination", "export"

**Delegate with**:
```
Delegate to browser-scraper sub-agent to extract all product data from this page and export to CSV
```

#### 🧪 QA Testing (`browser-qa`)
**Use for:**
- Accessibility audits (WCAG 2.1)
- Performance testing and analysis
- Visual regression testing
- Keyboard navigation validation
- Functional testing

**Triggers**: "test", "qa", "accessibility", "performance", "audit", "wcag", "a11y"

**Delegate with**:
```
Delegate to browser-qa sub-agent to audit this page for accessibility issues and generate a report
```

## Multi-Tab Workflow Patterns

Sub-agents create tabs and return tab IDs, enabling multi-step workflows with preserved context.

### Pattern 1: Parallel Comparison

**User Request**: "Compare prices on Amazon and Walmart"

**Strategy**:
```
1. Delegate to browser-ecommerce sub-agent
2. Sub-agent creates 2 tabs: amazonTab=123, walmartTab=456
3. Sub-agent searches both sites in parallel
4. Returns results with tab IDs
5. Store tab context: amazonTab=123, walmartTab=456
6. Future requests can target specific tabs
```

**Follow-up**: "Get more details on the Amazon result"
```
Delegate to browser-ecommerce with tabTarget=123 (preserved amazonTab ID)
```

### Pattern 2: Sequential Scraping

**User Request**: "Extract all products from pages 1-5"

**Strategy**:
```
1. Delegate to browser-scraper sub-agent
2. Sub-agent creates tab: scrapingTab=123
3. Sub-agent iterates through pages sequentially
4. Returns aggregated data with tab ID
5. Store tab context: scrapingTab=123
```

**Follow-up**: "Continue to pages 6-10"
```
Delegate to browser-scraper with tabTarget=123 (continues in same tab)
```

### Pattern 3: Form Preview and Submit

**User Request**: "Fill out the contact form"

**Strategy**:
```
1. Delegate to browser-forms sub-agent
2. Sub-agent creates tab: formTab=123
3. Sub-agent discovers, analyzes, and fills form
4. Returns preview with tab ID (NOT submitted)
5. Store tab context: formTab=123
6. User reviews preview
```

**Follow-up**: "Submit the form"
```
Delegate to browser-forms with tabTarget=123 to submit (after user approval)
```

## Tab Context Preservation

**Critical Pattern**: Sub-agents create tabs → return IDs → main conversation stores → future delegations specify `tabTarget`

### Sub-Agent Return Format

Sub-agents return tab metadata:
```json
{
  "tabId": 123,
  "label": "amazon-search",
  "url": "https://amazon.com/s?k=headphones",
  "data": { ... }
}
```

### Main Conversation Storage

Store tab IDs in context for future use:
```
Context: amazonTab=123, walmartTab=456, scrapingTab=789
```

### Future Delegation with Tab Target

Specify `tabTarget` to operate on existing tab:
```
Delegate to browser-ecommerce with tabTarget=123 to get product details
```

## Macro Discovery Pattern

**DO NOT execute macros directly**. Let sub-agents handle macro discovery and execution.

### How Sub-Agents Use Macros

All sub-agents follow this pattern:
1. Extract domain from URL
2. Check site-specific macros: `browser_list_macros({ site: "domain.com" })`
3. Check universal macros: `browser_list_macros({ site: "*" })`
4. Execute macro if available
5. Fall back to direct MCP tools if no macro exists
6. Report which method was used

### Available Macro Categories

- **40+ Universal Macros**: Work on any website
- **17 Amazon Macros**: E-commerce specific
- **Categories**: extraction, form, navigation, util, interaction, exploration, cdn

**See**: `.claude/skills/browser/MACROS.md` for complete macro reference

## Token Conservation Rules

Sub-agents follow these rules automatically, but you should be aware:

### 1. Avoid `browser_snapshot`
**Problem**: Wastes massive context with full ARIA tree

**Solution**: Sub-agents use `browser_get_visible_text({ maxLength: 3000 })` by default

### 2. Use Specialized Macros
**Problem**: Generic extraction returns too much data

**Solution**: Sub-agents use targeted macros:
- `get_interactive_elements` - Find buttons, links, inputs
- `discover_forms` - Analyze forms
- `extract_table_data` - Get table data
- `extract_main_content` - Article extraction

### 3. Always Truncate Text
**Problem**: Full page text consumes excessive tokens

**Solution**: Sub-agents always use `maxLength` parameter on text extraction

### 4. Clean Before Main Operations
**Problem**: Interruptions (cookie consents, modals) interfere with automation

**Solution**: Sub-agents use cleanup macros first:
- `smart_cookie_consent` - Handle cookies
- `dismiss_interruptions` - Auto-dismiss popups
- `close_modal` - Close modals

## Error Handling

### Common Issues and Solutions

**Issue**: "No attached tabs"
**Solution**: Delegate to browser sub-agent to create and attach a tab first

**Issue**: "Tab not found"
**Solution**: Verify tab ID is still valid with `browser_list_attached_tabs` (via browser sub-agent)

**Issue**: "Macro not found"
**Solution**: Sub-agent will automatically fall back to direct MCP tools

**Issue**: "Navigation timeout"
**Solution**: Sub-agent will retry with increased timeout or report error

**Issue**: "Element not found"
**Solution**: Sub-agent will use alternative locators or report detailed error

## Standard Delegation Workflow

```
1. User makes request
2. Identify task type (navigation, scraping, forms, testing, shopping)
3. Select appropriate sub-agent
4. Delegate with clear instructions
5. Sub-agent:
   - Creates tab (if needed) and labels it
   - Checks for macros (site-specific → universal)
   - Executes macro OR uses direct MCP tools
   - Returns results + tab metadata
6. Store tab context in main conversation
7. Present results to user
8. Handle follow-up requests with tab context
```

## Quick Reference

### Delegation Templates

**Generic browsing**:
```
Delegate to browser sub-agent to navigate to URL and take a screenshot
```

**E-commerce**:
```
Delegate to browser-ecommerce sub-agent to search Amazon for PRODUCT with FILTERS
```

**Form filling**:
```
Delegate to browser-forms sub-agent to discover forms on URL and fill FIELDS
```

**Web scraping**:
```
Delegate to browser-scraper sub-agent to extract DATA from URL with PAGINATION
```

**QA testing**:
```
Delegate to browser-qa sub-agent to audit URL for ISSUE_TYPE and generate report
```

### Tab Management

**Create new tab**:
```
Delegate to browser sub-agent to create tab for URL with label "descriptive-name"
```

**Use existing tab**:
```
Delegate to SUB-AGENT with tabTarget=TAB_ID to perform ACTION
```

**List tabs**:
```
Delegate to browser sub-agent to list all attached tabs
```

## Remember

- ✅ **Delegate to sub-agents** - Don't execute MCP tools directly
- ✅ **Choose the right specialist** - Match task type to sub-agent expertise
- ✅ **Preserve tab context** - Store tab IDs for multi-step workflows
- ✅ **Trust sub-agents** - They handle token conservation and macro discovery
- ✅ **Provide clear instructions** - Specify URLs, filters, fields, etc.
- ✅ **Handle follow-ups** - Use tabTarget for continued operations

## Further Reading

- **Macro Reference**: `.claude/skills/browser/MACROS.md` - Complete macro documentation
- **Multi-Tab Patterns**: `.claude/skills/browser/MULTI_TAB.md` - Deep dive on multi-tab workflows
- **Amazon Macros**: `.claude/skills/browser/AMAZON_MACROS.md` - Amazon-specific automation
- **Troubleshooting**: `.claude/skills/browser/TROUBLESHOOTING.md` - Common issues and solutions

---

**Start working immediately when user requests browser automation. No preamble needed. Delegate to appropriate sub-agent with clear instructions.**
