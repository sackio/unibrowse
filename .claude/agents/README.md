# 🤨 unibrowse Agents

Specialized sub-agents for intelligent browser automation with automatic delegation.

## Overview

Unibrowse uses **5 specialized sub-agents** that automatically handle different types of browser automation tasks. The browser skill (`../.claude/skills/browser/SKILL.md`) analyzes your request and delegates to the appropriate agent.

**You don't need to know which agent to use** - just describe what you want in natural language, and the system routes to the right expert.

## Available Agents

### 1. Browser Agent (Generic)

**File**: `browser.md`

**Purpose**: Core browser operations - navigation, screenshots, tab management, basic interactions.

**When Auto-Delegated**: Requests involving "navigate", "screenshot", "tab", "click", "open URL"

**Expertise**:
- Tab creation and management
- Navigation (forward, back, URL)
- Screenshots and visual capture
- Basic element interaction
- Macro-first execution pattern

**Example Requests**:
```
"Take a screenshot of example.com"
"Navigate to github.com and open the repositories tab"
"Create three tabs: google.com, github.com, stackoverflow.com"
"Click the login button on this page"
```

**Key Tools**: All 76 `mcp__browser__*` tools, Read, Bash

**Model**: Sonnet | **Max Messages**: 20

---

### 2. E-Commerce Agent

**File**: `browser-ecommerce.md`

**Purpose**: Amazon shopping, price comparison, product research across multiple sites.

**When Auto-Delegated**: Requests involving "Amazon", "shopping", "price", "product", "compare", "Rufus"

**Expertise**:
- Amazon automation (17 specialized macros)
- Search, filter, sort products
- Rufus AI integration
- Price comparison across sites
- Review analysis

**Example Requests**:
```
"Search Amazon for wireless headphones under $100"
"Compare prices for iPhone 15 on Amazon, Walmart, and Best Buy"
"Ask Rufus on Amazon: What are the best noise-canceling headphones?"
"Search Amazon reviews for 'battery life' mentions"
"Add this product to my cart"
```

**Key Macros**: 17 Amazon-specific + universal macros

**Model**: Sonnet | **Max Messages**: 25

---

### 3. Form Automation Agent

**File**: `browser-forms.md`

**Purpose**: Intelligent form discovery, filling, validation handling, and safe submission.

**When Auto-Delegated**: Requests involving "form", "fill", "submit", "contact form", "registration"

**Expertise**:
- Form discovery and analysis
- Smart field detection (email, phone, required fields)
- Multi-step forms (wizard navigation)
- Conditional/dynamic fields
- Validation error handling
- **Safety**: NEVER auto-submits, always requires approval

**Example Requests**:
```
"Fill out the contact form at example.com with:
 Name: John Doe, Email: john@example.com, Message: Hello"
"Complete the multi-step registration form"
"Analyze the form and show me what fields are required"
```

**Safety Protocol**:
- ✅ Always generates preview before submission
- ✅ Requires explicit user approval to submit
- ✅ Warns on sensitive fields (passwords, credit cards)
- ✅ Preserves form data on errors

**Model**: Sonnet | **Max Messages**: 25

---

### 4. Web Scraper Agent

**File**: `browser-scraper.md`

**Purpose**: Structured data extraction, pagination handling, export to JSON/CSV.

**When Auto-Delegated**: Requests involving "extract", "scrape", "table", "data", "pagination", "export"

**Expertise**:
- Table extraction (headers + rows)
- Pagination (next button loops)
- Infinite scroll aggregation
- Article content extraction
- Multi-site parallel scraping
- Deduplication
- Export to files

**Example Requests**:
```
"Extract the pricing table from example.com and export to CSV"
"Scrape all job listings from example.com/jobs (paginated)"
"Extract all tweets from this infinite scroll timeline"
"Scrape product prices from Amazon, Walmart, and Best Buy"
```

**Deduplication**: Automatic before export

**Model**: Sonnet | **Max Messages**: 30

---

### 5. QA Testing Agent

**File**: `browser-qa.md`

**Purpose**: Accessibility audits (WCAG 2.1), performance testing, visual regression.

**When Auto-Delegated**: Requests involving "test", "accessibility", "audit", "performance", "WCAG"

**Expertise**:
- WCAG 2.1 AA compliance testing
- Accessibility issue categorization (critical, serious, moderate, minor)
- Performance metrics (load time, FCP, resource analysis)
- Visual regression (baseline screenshots)
- Keyboard navigation testing
- Responsive design testing

**Example Requests**:
```
"Audit example.com for accessibility issues"
"Test page load performance for this site"
"Check keyboard navigation on this form"
"Capture baseline screenshots at desktop and mobile resolutions"
"Test responsive design across mobile, tablet, and desktop"
```

**Reports**: Generates markdown reports to `/tmp/` with actionable recommendations

**Model**: Sonnet | **Max Messages**: 25

---

## How Auto-Delegation Works

### Delegation Flow

```
User: "Search Amazon for headphones under $100"
    ↓
Browser Skill analyzes request:
  - Keywords: "Amazon", "search", "under $100"
  - Intent: E-commerce product search
  - Decision: Delegate to browser-ecommerce
    ↓
Main conversation spawns browser-ecommerce agent:
  - Fresh context (no history)
  - Parameters: { query: "headphones", maxPrice: 100 }
    ↓
Browser-ecommerce agent executes:
  1. Creates tab, labels "amazon-search"
  2. Uses amazon_search macro
  3. Applies price filter macro
  4. Extracts results macro
  5. Returns: results + tab ID (123)
    ↓
Main conversation:
  - Stores: amazonTab = 123
  - Presents results to user
    ↓
User: "Get details on the first result"
    ↓
Main conversation:
  - Recognizes follow-up
  - Delegates again with tabTarget=123 (preserved)
    ↓
Browser-ecommerce agent:
  - Uses existing tab 123
  - Clicks first product
  - Extracts details
  - Returns: product info
```

### Delegation Triggers

| Keywords | Agent | Rationale |
|----------|-------|-----------|
| "Amazon", "shopping", "price", "product" | `browser-ecommerce` | E-commerce expertise |
| "form", "fill", "submit", "registration" | `browser-forms` | Form automation expertise |
| "extract", "scrape", "table", "pagination" | `browser-scraper` | Data extraction expertise |
| "test", "accessibility", "audit", "performance" | `browser-qa` | QA testing expertise |
| "navigate", "screenshot", "tab", "click" | `browser` | Generic operations |

**You don't need to specify the agent** - the browser skill handles routing automatically.

---

## Tab Context Preservation

**Key Feature**: Sub-agents return tab IDs, main conversation preserves them across turns.

**Example**:

```bash
User: "Search Amazon for headphones"
Agent: [Creates tab 123, searches, returns results]
       Internal: amazonTab = 123

User: "Get details on the first result"
Agent: [Uses tab 123, clicks first product, returns details]
       # No need to recreate tab - context preserved

User: "Show me the reviews"
Agent: [Uses tab 123, navigates to reviews, extracts]
       # Still using same tab - seamless workflow
```

**Benefits**:
- No need to recreate tabs for follow-up questions
- Faster execution (reuse existing state)
- Natural conversation flow
- Multi-step workflows without manual tab tracking

---

## Multi-Tab Workflows

### Parallel Comparison Pattern

```bash
"Compare prices for iPhone 15 on Amazon, Walmart, and Best Buy"

# Agent creates 3 tabs in parallel:
# - Tab 123 (Amazon)
# - Tab 124 (Walmart)
# - Tab 125 (Best Buy)

# Searches all 3 simultaneously (Promise.all)
# Returns comparison table + all tab IDs preserved

# Follow-up:
"Show me the Amazon reviews"
# Uses tab 123 (preserved from initial request)
```

### Sequential Form Workflow

```bash
"Fill out the contact form at example.com"

# Agent:
# 1. Creates tab 126
# 2. Discovers form
# 3. Fills fields
# 4. Returns preview (tab 126 preserved, form NOT submitted yet)

# User reviews preview, then:
"Submit the form"

# Agent:
# - Uses tab 126 (preserved)
# - Submits form
# - Returns confirmation
```

---

## Hooks Integration

**Hooks still work** with the new sub-agent architecture.

**Hook Configuration**: `.claude/hooks/browser-navigation.json`

**Triggers**:
- `PostToolUse: browser_navigate` → Updates macro context
- `PostToolUse: browser_switch_tab` → Refreshes for new tab
- `PostToolUse: browser_click` → Checks for navigation, updates if needed

**What Hooks Do**:
- Inject available macros into context after navigation
- Keep sub-agents aware of site-specific capabilities
- Reduce macro discovery overhead

**Example**:
```bash
User: "Navigate to amazon.com"
  ↓
browser_navigate tool executes
  ↓
Hook triggers: "PostToolUse: browser_navigate"
  ↓
Hook script lists macros for amazon.com
  ↓
Context updated: "Available macros: amazon_search, amazon_get_product_info, ..."
  ↓
User: "Search for headphones"
  ↓
Agent already knows amazon_search macro exists (via hook)
```

---

## Creating New Agents

Want to add a new specialized agent? Follow this template:

### Step 1: Create Agent File

**File**: `.claude/agents/browser-<specialty>.md`

**Template**:
```yaml
---
name: browser-<specialty>
description: <One-line description with 🤨 emoji>
model: sonnet
maxMessages: 25
tools:
  - mcp__browser__*
  - Read
  - Write
parameters:
  url:
    type: string
    description: URL to navigate to
    required: false
  # Add your parameters
---

# 🤨 <Agent Name> Agent

<System prompt with:>
- Expertise (what this agent is good at)
- Standard workflows (step-by-step guides)
- Macros available (list key macros)
- Error handling (common issues)
- Return format (JSON structure)
- Quick actions reference (common operations)
```

### Step 2: Update Delegation Strategy

**File**: `.claude/skills/browser/SKILL.md`

Add your agent to the delegation triggers section:
```markdown
| "your-keyword" | `browser-<specialty>` | Your rationale |
```

### Step 3: Register in Plugin Manifest

**File**: `.claude-plugin/plugin.json`

Add to `"agents"` array:
```json
{
  "path": ".claude/agents/browser-<specialty>.md",
  "description": "<One-line description>"
}
```

### Step 4: Add Examples

**File**: `docs/EXAMPLES.md`

Add real-world usage examples for your new agent.

### Step 5: Test Delegation

```bash
# Use natural language with your trigger keywords
"<Your test request with keywords>"

# Verify:
# 1. Browser skill delegates to your agent
# 2. Agent executes correctly
# 3. Returns results with tab ID
# 4. Follow-up requests use preserved tab
```

---

## Examples for Each Agent

### Browser Agent

```bash
"Take a screenshot of example.com"
→ Creates tab, navigates, captures screenshot
→ Returns: Screenshot saved to /tmp/screenshot.png, Tab 123

"Navigate to github.com and click 'Repositories'"
→ Creates tab, navigates, finds element, clicks
→ Returns: Clicked successfully, Tab 124
```

### E-Commerce Agent

```bash
"Search Amazon for wireless headphones under $100"
→ Creates tab, searches, filters, extracts results
→ Returns: 50 products found, Tab 125

"Compare prices for iPhone 15 on Amazon and Walmart"
→ Creates 2 tabs, searches both, compares
→ Returns: Comparison table, Tabs 126 (Amazon), 127 (Walmart)
```

### Form Automation Agent

```bash
"Fill out contact form at example.com with:
 Name: John Doe, Email: john@example.com"
→ Creates tab, discovers form, fills fields
→ Returns: Preview (not submitted yet), Tab 128

"Submit the form"
→ Uses tab 128, submits, checks confirmation
→ Returns: Submitted successfully, Tab 128
```

### Web Scraper Agent

```bash
"Extract pricing table from example.com/pricing"
→ Creates tab, navigates, extracts table
→ Returns: Table data (3 cols × 4 rows), Tab 129

"Scrape all job listings from example.com/jobs (5 pages)"
→ Creates tab, loops through pages, extracts, deduplicates
→ Returns: 87 jobs exported to /tmp/jobs.json, Tab 130
```

### QA Testing Agent

```bash
"Audit example.com for accessibility"
→ Creates tab, runs WCAG 2.1 audit, categorizes issues
→ Returns: 12 issues (2 critical, 5 serious, ...), Report saved, Tab 131

"Test page load performance"
→ Creates tab, measures metrics, analyzes bottlenecks
→ Returns: Score 72/100, Recommendations, Tab 132
```

---

## Best Practices

### 1. Use Natural Language

```
❌ Don't: "browser_navigate to amazon.com then browser_execute_macro amazon_search"
✅ Do: "Search Amazon for wireless headphones"
```

### 2. Leverage Context Preservation

```bash
"Search Amazon for headphones"     # Creates tab 123
"Get details on first result"      # Uses tab 123
"Show me reviews"                  # Still uses tab 123
```

### 3. Combine Operations

```bash
"Search Amazon for iPhone 15, apply Prime filter, sort by rating, show top 5"
# Agent handles all steps in one delegation
```

### 4. Request Previews Before Submission

```bash
"Fill out the form and show me a preview"
# Agent will NEVER auto-submit - always shows preview first
```

### 5. Use Specific Keywords for Better Delegation

```
"Search Amazon..." → browser-ecommerce (clear)
"Search..."       → browser (generic)
```

---

## Troubleshooting

### Agent Not Delegating Correctly

**Symptom**: Wrong agent handles your request

**Solution**: Be more specific with keywords
```bash
# Less specific:
"Search website"

# More specific:
"Search Amazon for products under $100"
```

### Lost Tab Context

**Symptom**: "Tab not found" error

**Cause**: Tab was closed or browser restarted

**Solution**: Request the operation again
```bash
"I lost the tab - search Amazon again for headphones"
```

### Form Not Submitting

**Expected Behavior**: Forms agent NEVER auto-submits

**If you want to submit**: Say explicitly
```bash
"Submit the form"
# Agent will use preserved tab ID and submit
```

### Hooks Not Working

**Check**:
1. Hooks enabled in Claude Code settings
2. Scripts executable: `chmod +x scripts/hooks/*.sh`
3. MCP server running: `docker compose ps`
4. MongoDB running (for macros)

---

## Additional Documentation

- **Complete Plugin Guide**: [docs/PLUGIN_GUIDE.md](../../docs/PLUGIN_GUIDE.md)
- **Real-World Examples**: [docs/EXAMPLES.md](../../docs/EXAMPLES.md)
- **Architecture Deep Dive**: [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- **Macro Reference**: [../skills/browser/MACROS.md](../skills/browser/MACROS.md)
- **Multi-Tab Patterns**: [../skills/browser/MULTI_TAB.md](../skills/browser/MULTI_TAB.md)
- **Troubleshooting**: [../skills/browser/TROUBLESHOOTING.md](../skills/browser/TROUBLESHOOTING.md)
- **Amazon Macros**: [../skills/browser/AMAZON_MACROS.md](../skills/browser/AMAZON_MACROS.md)

---

## Summary

**5 Specialized Agents**:
- 🌐 **Browser** (Generic) - Navigation, screenshots, basic ops
- 🛒 **E-Commerce** - Amazon, shopping, price comparison
- 📝 **Forms** - Form filling, validation, safe submission
- 📊 **Scraper** - Data extraction, pagination, export
- ✅ **QA** - Accessibility, performance, testing

**Key Features**:
- ✅ Automatic delegation (no manual agent selection)
- ✅ Natural language interface
- ✅ Tab context preservation across conversation
- ✅ Macro-first execution (90%+ token savings)
- ✅ Specialized domain expertise
- ✅ Safe form handling (never auto-submits)
- ✅ Multi-tab workflows (parallel + sequential)

**Start using it**: Just describe what you want in natural language - the system handles the rest!

For questions or issues, open a GitHub issue or see [TROUBLESHOOTING.md](../skills/browser/TROUBLESHOOTING.md).
