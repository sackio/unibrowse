# 🤨 Unibrowse Plugin Guide

Complete guide to installing, configuring, and using the unibrowse browser automation plugin for Claude Code.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Usage](#usage)
6. [Available Agents](#available-agents)
7. [Skills](#skills)
8. [Macros](#macros)
9. [Advanced Features](#advanced-features)
10. [Troubleshooting](#troubleshooting)

---

## Overview

**Unibrowse** is a comprehensive browser automation plugin for Claude Code that provides:

- **5 Specialized Sub-Agents** - Domain experts for browser automation, e-commerce, forms, scraping, and QA testing
- **57+ Macros** - Pre-built JavaScript functions for common browser operations
- **Multi-Tab Management** - Coordinate operations across multiple browser tabs with context preservation
- **Macro-First Philosophy** - Intelligent fallback from macros to direct MCP tools
- **Token Optimization** - Built-in strategies to minimize context usage

**Plugin Structure**:
```
.claude-plugin/
  plugin.json          # Plugin manifest
  README.md            # Quick start guide

.claude/
  skills/
    browser/
      SKILL.md         # Browser skill (delegation strategy)
      MACROS.md        # Complete macro reference
      MULTI_TAB.md     # Multi-tab patterns
      TROUBLESHOOTING.md  # Troubleshooting guide
      AMAZON_MACROS.md  # Amazon macro reference
  agents/
    browser.md         # Generic browser agent
    browser-ecommerce.md  # E-commerce specialist
    browser-forms.md    # Form automation specialist
    browser-scraper.md  # Web scraping specialist
    browser-qa.md       # QA testing specialist
  hooks/
    browser-navigation.json  # Navigation hooks

docs/
  PLUGIN_GUIDE.md      # This file
  EXAMPLES.md          # Usage examples
  ARCHITECTURE.md      # Technical architecture
```

---

## Prerequisites

### Required Software

1. **Claude Code CLI** - Version 2.0+ with agent support
2. **Docker & Docker Compose** - For MCP server
3. **Google Chrome** - For browser extension
4. **MongoDB** - For macro storage (included in Docker Compose)
5. **Node.js** - Version 18+ for MCP server

### System Requirements

- **OS**: Linux, macOS, or Windows with WSL2
- **Memory**: 4GB+ RAM
- **Disk Space**: 2GB+ for Docker images
- **Network**: Internet connection for package installation

---

## Installation

### Step 1: Clone Repository

```bash
git clone https://github.com/yourusername/browser-mcp.git
cd browser-mcp
```

### Step 2: Install Dependencies

```bash
# Install Node.js dependencies
npm install

# Build extension
npm run build
```

### Step 3: Start MCP Server

```bash
# Start server with Docker Compose
docker compose up -d

# Verify server is running
curl http://localhost:9010/health
# Expected: {"status":"healthy"}
```

### Step 4: Install Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension/dist` directory from this repository
5. Extension should appear with "Unibrowse" name and 🤨 icon

### Step 5: Connect Extension

1. Click the extension icon in Chrome toolbar
2. Verify Server URL is `ws://localhost:9010/ws`
3. Click "Connect" button
4. Status should show "Connected"
5. Click "Attach to this tab" on any tab you want to control

### Step 6: Install Plugin in Claude Code

#### Option A: Install from .claude-plugin Directory

```bash
# From repository root
claude plugin install .claude-plugin

# Verify installation
claude plugin list
# Should show: unibrowse (v1.0.0)
```

#### Option B: Manual Installation

```bash
# Copy plugin files to Claude Code config directory
cp -r .claude/* ~/.claude/

# Verify files are in place
ls ~/.claude/skills/browser/
ls ~/.claude/agents/
```

### Step 7: Verify Installation

```bash
# Check prerequisites
npm run test:prereq

# Expected output:
# ✓ MCP server is running (port 9010)
# ✓ Extension is connected
# ✓ At least one tab attached
# ✓ MongoDB is accessible
```

---

## Configuration

### MCP Server Configuration

**File**: `docker-compose.yml`

```yaml
services:
  app:
    ports:
      - "9010:9010"  # MCP server port
    environment:
      - MONGODB_URI=mongodb://mongodb:27017/browser-mcp
      - PORT=9010
```

**To change port**:
1. Edit `docker-compose.yml`
2. Edit extension configuration: Extension popup → Settings → Server URL
3. Restart server: `docker compose restart`

### Extension Configuration

**Access**: Click extension icon → Settings

**Options**:
- **Server URL**: WebSocket URL (default: `ws://localhost:9010/ws`)
- **Auto-reconnect**: Automatically reconnect on disconnect
- **Debug Logging**: Enable verbose console logging

### Claude Code Configuration

**File**: `~/.claude/config.json`

Add MCP server configuration:

```json
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"],
      "env": {
        "MCP_SERVER_URL": "ws://localhost:9010/ws"
      }
    }
  }
}
```

### MongoDB Configuration

**Connection String**: `mongodb://localhost:27017/browser-mcp`

**To seed macros**:

```bash
# Import macros from backup
docker compose exec mongodb mongoimport \
  --db browser-mcp \
  --collection macros \
  --file /data/macros-backup.json

# Or seed from TypeScript
npm run seed:macros
```

---

## Usage

### Basic Usage (Automatic Delegation)

Simply describe what you want to do - Claude Code will automatically delegate to the appropriate sub-agent:

```
User: "Search Amazon for wireless headphones under $100"
→ Automatically delegates to browser-ecommerce agent

User: "Fill out the contact form on example.com"
→ Automatically delegates to browser-forms agent

User: "Extract all product data from this page"
→ Automatically delegates to browser-scraper agent

User: "Test this page for accessibility issues"
→ Automatically delegates to browser-qa agent

User: "Take a screenshot of example.com"
→ Automatically delegates to browser agent
```

### Manual Agent Invocation

You can explicitly delegate to a specific agent using the Task tool:

```javascript
// Delegate to e-commerce agent
Task({
  subagent_type: "browser-ecommerce",
  prompt: "Search Amazon for wireless headphones under $100 and compare the top 3 results"
});

// Delegate to form automation agent
Task({
  subagent_type: "browser-forms",
  prompt: "Fill out the contact form at https://example.com/contact with my information"
});
```

### Using Skills Directly

The browser skill provides guidance and delegation strategy without direct execution:

```
User: "How do I scrape multiple pages?"
→ Browser skill activates, provides guidance
→ May suggest delegating to browser-scraper agent
```

---

## Available Agents

### 1. Browser Agent (Generic)

**File**: `.claude/agents/browser.md`

**Purpose**: General-purpose browser automation, tab management, macro execution

**Use Cases**:
- Navigation and screenshot capture
- Tab creation and management
- Macro discovery and execution
- Simple browser operations

**Example**:
```
"Take a screenshot of example.com"
"Create a new tab and navigate to google.com"
"List all available macros for amazon.com"
```

**Tools**: All `mcp__browser__*`, Read, Bash

**Model**: Sonnet

**Max Messages**: 20

---

### 2. E-Commerce Agent (Amazon Specialist)

**File**: `.claude/agents/browser-ecommerce.md`

**Purpose**: Amazon automation, Google Shopping, multi-site price comparison

**Use Cases**:
- Amazon product search with filters
- Price tracking across sites
- Reviews analysis
- Rufus AI integration
- Cart operations

**Amazon Macros**: 17 specialized macros (search, filters, extraction, Rufus, etc.)

**Example**:
```
"Search Amazon for wireless headphones under $100"
"Compare prices for iPhone 15 on Amazon, Walmart, and Best Buy"
"Get reviews summary for product https://amazon.com/dp/B08N5WRWNW"
"Ask Rufus: What are the best noise-canceling headphones?"
```

**Tools**: All `mcp__browser__*`, Read

**Model**: Sonnet

**Max Messages**: 25

---

### 3. Form Automation Agent

**File**: `.claude/agents/browser-forms.md`

**Purpose**: Intelligent form discovery, filling, validation, and safe submission

**Use Cases**:
- Contact form automation
- Registration workflows
- Multi-step forms
- Conditional field handling
- Validation error recovery

**Universal Macros**: `discover_forms`, `analyze_form_requirements`, `find_element_by_description`, `detect_messages`

**Example**:
```
"Fill out the contact form at https://example.com/contact"
"Complete the multi-step registration form"
"Analyze form requirements and show me what fields are required"
```

**Safety Protocols**:
- ✅ Never auto-submits without user approval
- ✅ Always returns preview before submission
- ✅ Warns on sensitive fields (passwords, credit cards)
- ✅ Preserves form data on errors

**Tools**: All `mcp__browser__*`, Read

**Model**: Sonnet

**Max Messages**: 25

---

### 4. Web Scraper Agent

**File**: `.claude/agents/browser-scraper.md`

**Purpose**: Structured data extraction, pagination, export to JSON/CSV

**Use Cases**:
- Table data extraction
- Multi-page aggregation
- Article content extraction
- Product catalog scraping
- Pagination and infinite scroll handling

**Universal Macros**: `extract_table_data`, `extract_main_content`, `detect_pagination`, `detect_infinite_scroll`

**Example**:
```
"Extract all products from this e-commerce page"
"Scrape the pricing table from https://example.com/pricing"
"Extract articles from all pages of this blog (handle pagination)"
"Get all data from this table and export to CSV"
```

**Tools**: All `mcp__browser__*`, Read, Write

**Model**: Sonnet

**Max Messages**: 30

---

### 5. QA Testing Agent

**File**: `.claude/agents/browser-qa.md`

**Purpose**: Accessibility audits (WCAG 2.1), performance testing, visual regression

**Use Cases**:
- WCAG 2.1 accessibility compliance
- Keyboard navigation testing
- Color contrast analysis
- Performance metrics
- Visual regression testing
- Responsive design validation

**Universal Macros**: `audit_accessibility`, `check_keyboard_navigation`, `analyze_color_contrast`, `measure_page_performance`

**Example**:
```
"Audit https://example.com for accessibility issues"
"Test keyboard navigation on this page"
"Check performance metrics and identify bottlenecks"
"Compare screenshots at desktop, tablet, and mobile viewports"
```

**Report Generation**: Markdown reports with severity categorization (critical, serious, moderate, minor)

**Tools**: All `mcp__browser__*`, Read, Write

**Model**: Sonnet

**Max Messages**: 25

---

## Skills

### Browser Skill

**File**: `.claude/skills/browser/SKILL.md`

**Purpose**: Provides delegation strategy and guidance for browser automation tasks

**Trigger**: Auto-activates when browser-related keywords are detected

**Responsibilities**:
- Analyzes request and determines appropriate sub-agent
- Provides multi-tab workflow guidance
- Suggests macro-first approach
- Offers token conservation strategies

**Does NOT**:
- Execute browser operations directly (delegates to sub-agents)
- Make MCP tool calls

**Example Activation**:
```
User: "How do I automate form filling?"
→ Browser skill activates
→ Provides guidance on form automation
→ Suggests delegating to browser-forms agent
```

---

## Macros

### Macro Categories

**Total Macros**: 57+
- **Universal Macros**: 40+ (work on any site)
- **Amazon Macros**: 17 (amazon.com specific)

### Universal Macro Categories

1. **Extraction (10 macros)**: Data extraction, table parsing, content analysis
2. **Form (5 macros)**: Form discovery, field analysis, validation
3. **Navigation (4 macros)**: Pagination, infinite scroll, breadcrumbs
4. **Util (8 macros)**: Interruption handling, cookie consent, modals
5. **Interaction (6 macros)**: Smart clicking, filling, dropdowns
6. **Exploration (4 macros)**: Page analysis, AJAX detection, performance
7. **CDN (3 macros)**: Library injection (jQuery, Lodash, Moment)

### Amazon Macro Categories

1. **Navigation (4 macros)**: Search, product clicking, pagination, reviews
2. **Extraction (7 macros)**: Product info, listings, images, reviews summary
3. **Interaction (5 macros)**: Rufus AI, filters, sorting, variations, cart
4. **Search (1 macro)**: Review search

### Macro Usage

```javascript
// 1. List available macros
const macros = await mcp__browser__browser_list_macros({
  site: "amazon.com"  // Or "*" for universal
});

// 2. Execute macro
const result = await mcp__browser__browser_execute_macro({
  id: "amazon_search",
  params: { query: "headphones" },
  tabTarget: tabId
});

// 3. Use results
console.log(result.content);
```

**Documentation**:
- [MACROS.md](./.claude/skills/browser/MACROS.md) - Complete universal macro reference
- [AMAZON_MACROS.md](./.claude/skills/browser/AMAZON_MACROS.md) - Amazon macro reference

---

## Advanced Features

### Multi-Tab Workflows

**Use Case**: Compare data across multiple sites simultaneously

```javascript
// Create tabs for each site
const amazonTab = await mcp__browser__browser_create_tab({ url: "https://amazon.com" });
const walmartTab = await mcp__browser__browser_create_tab({ url: "https://walmart.com" });

// Label tabs
await mcp__browser__browser_set_tab_label({
  tabTarget: amazonTab.content.tabId,
  label: "amazon"
});

await mcp__browser__browser_set_tab_label({
  tabTarget: walmartTab.content.tabId,
  label: "walmart"
});

// Perform operations in parallel
const [amazonResults, walmartResults] = await Promise.all([
  searchAmazon("headphones", "amazon"),
  searchWalmart("headphones", "walmart")
]);

// Tab IDs preserved for future operations
```

**See**: [MULTI_TAB.md](./.claude/skills/browser/MULTI_TAB.md) for complete patterns

---

### Tab Context Preservation

**Pattern**: Sub-agents create tabs → return tab IDs → main conversation stores → future delegations use `tabTarget`

**Example**:
```
User: "Search Amazon and Walmart for headphones"
→ E-commerce agent creates 2 tabs, returns IDs
→ Main conversation stores: amazonTab=123, walmartTab=456

User: "Get more details on the Amazon result"
→ Delegate to e-commerce with tabTarget=123 (preserved context)
```

**Benefits**:
- Maintains session state (login, cookies, cart)
- Enables multi-step workflows
- Supports parallel operations

---

### Macro-First Execution

**Philosophy**: Always check for macros before using direct tools

**Pattern**:
```javascript
// 1. Extract domain
const domain = new URL(url).hostname;

// 2. Check site-specific macros
const siteMacros = await mcp__browser__browser_list_macros({ site: domain });

// 3. Check universal macros
const universalMacros = await mcp__browser__browser_list_macros({ site: "*" });

// 4. Execute macro if available
if (siteMacros.content.macros.length > 0) {
  result = await mcp__browser__browser_execute_macro({
    id: siteMacros.content.macros[0].id,
    params: { ... }
  });
} else {
  // Fall back to direct tools
  result = await mcp__browser__browser_navigate({ url: url });
}
```

**Benefits**:
- Reduces token usage (macros return structured data)
- Faster execution (optimized JavaScript)
- Site-specific handling (Amazon, etc.)

---

### Token Conservation

**Strategies**:

1. **Use macros instead of snapshots**:
   ```javascript
   // ❌ DON'T: Snapshot returns huge ARIA tree
   const snapshot = await mcp__browser__browser_snapshot();

   // ✅ DO: Use targeted macro
   const products = await mcp__browser__browser_execute_macro({
     id: "extract_products"
   });
   ```

2. **Truncate text extraction**:
   ```javascript
   const text = await mcp__browser__browser_get_visible_text({
     maxLength: 3000  // Limit output
   });
   ```

3. **Clean interruptions first**:
   ```javascript
   await mcp__browser__browser_execute_macro({
     id: "dismiss_interruptions"
   });
   ```

4. **Export large datasets**:
   ```javascript
   // Export to file instead of returning
   fs.writeFileSync('/tmp/export.json', JSON.stringify(data));
   return { exportPath: '/tmp/export.json' };
   ```

---

## Troubleshooting

### Common Issues

**Issue**: "MCP server not responding"

**Solution**:
```bash
# Check if server is running
docker compose ps

# Restart server
docker compose restart

# Check logs
docker compose logs -f
```

---

**Issue**: "Extension not connected"

**Solution**:
1. Click extension icon
2. Verify Server URL: `ws://localhost:9010/ws`
3. Click "Connect"
4. Check Chrome console for errors

---

**Issue**: "Macro not found"

**Solution**:
```bash
# Check MongoDB is running
docker compose ps mongodb

# List macros
docker compose exec mongodb mongosh browser-mcp --eval "db.macros.find().limit(5)"

# Seed macros if empty
npm run seed:macros
```

---

**Issue**: "Tab not found"

**Solution**:
```javascript
// List attached tabs
const tabs = await mcp__browser__browser_list_attached_tabs();
console.log(tabs);

// Attach to current tab via extension popup
// Or create new tab
const tab = await mcp__browser__browser_create_tab({ url: url });
```

---

**See**: [TROUBLESHOOTING.md](./.claude/skills/browser/TROUBLESHOOTING.md) for complete troubleshooting guide

---

## Additional Resources

### Documentation

- **[MACROS.md](./.claude/skills/browser/MACROS.md)** - Complete macro reference (40+ universal)
- **[AMAZON_MACROS.md](./.claude/skills/browser/AMAZON_MACROS.md)** - Amazon macro reference (17 macros)
- **[MULTI_TAB.md](./.claude/skills/browser/MULTI_TAB.md)** - Multi-tab workflow patterns
- **[TROUBLESHOOTING.md](./.claude/skills/browser/TROUBLESHOOTING.md)** - Troubleshooting guide
- **[EXAMPLES.md](./EXAMPLES.md)** - Usage examples for all agents
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Technical architecture

### GitHub

- **Repository**: https://github.com/yourusername/browser-mcp
- **Issues**: https://github.com/yourusername/browser-mcp/issues
- **Discussions**: https://github.com/yourusername/browser-mcp/discussions

### Community

- **Discord**: Join our community server
- **Slack**: #unibrowse channel in Claude Code workspace

---

## Getting Help

1. **Check documentation** - Most answers are in the docs above
2. **Run diagnostics** - `npm run test:prereq` to check prerequisites
3. **Enable debug logging** - See extension console and server logs
4. **Report issues** - GitHub issues with reproduction steps
5. **Ask community** - Discord, Slack, GitHub Discussions

---

**Version**: 1.0.0
**Last Updated**: 2025-12-10
**Plugin Name**: unibrowse
**Logo**: 🤨
