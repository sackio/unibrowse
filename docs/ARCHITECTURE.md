# 🤨 Architecture Documentation

Technical deep dive into unibrowse's architecture, covering MCP server, extension, MongoDB, sub-agents, macro system, and delegation flow.

## Table of Contents

- [System Overview](#system-overview)
- [Component Architecture](#component-architecture)
- [MCP Server](#mcp-server)
- [Chrome Extension](#chrome-extension)
- [MongoDB Storage](#mongodb-storage)
- [Sub-Agent System](#sub-agent-system)
- [Macro System](#macro-system)
- [Delegation Flow](#delegation-flow)
- [Tab Management](#tab-management)
- [Token Optimization](#token-optimization)
- [Communication Protocols](#communication-protocols)
- [Extension Points](#extension-points)

---

## System Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code CLI                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  Main Conversation                        │   │
│  │  - User prompts                                          │   │
│  │  - Context preservation (tab IDs)                        │   │
│  │  - Result presentation                                   │   │
│  └───────────────┬──────────────────────────────────────────┘   │
│                  │ Delegates to                                  │
│  ┌──────────────▼──────────────────────────────────────────┐   │
│  │            Browser Skill (Guidance Layer)               │   │
│  │  - Intent recognition                                    │   │
│  │  - Sub-agent selection                                   │   │
│  │  - Delegation strategy                                   │   │
│  └───────────────┬──────────────────────────────────────────┘   │
│                  │ Spawns                                        │
│  ┌──────────────▼──────────────────────────────────────────┐   │
│  │           Sub-Agents (Specialized Workers)              │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │ Browser | E-Commerce | Forms | Scraper | QA    │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  │  - Macro-first execution                                 │   │
│  │  - Direct MCP tool fallback                              │   │
│  │  - Tab creation & management                             │   │
│  │  - Result reporting + tab IDs                            │   │
│  └───────────────┬──────────────────────────────────────────┘   │
└──────────────────┼──────────────────────────────────────────────┘
                   │ MCP Protocol (stdio/WebSocket)
┌──────────────────▼──────────────────────────────────────────────┐
│                      MCP Server (Node.js)                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Tool Registry (76 tools)                    │   │
│  │  - Navigation (navigate, go_back, go_forward)            │   │
│  │  - Interaction (click, type, select, drag)               │   │
│  │  - Extraction (snapshot, query_dom, get_text)            │   │
│  │  - Macros (list, execute, store, update, delete)         │   │
│  │  - Multi-tab (list, create, switch, attach, detach)      │   │
│  │  - Testing (screenshot, check_visibility, get_styles)    │   │
│  │  - Network (get_logs, set_conditions, clear_cache)       │   │
│  │  - Cookies (get, set, delete, clear)                     │   │
│  │  - History (search, get_visits, delete, clear)           │   │
│  │  - Bookmarks (get, create, delete, search)               │   │
│  │  - Downloads (list, cancel, open)                        │   │
│  │  - Realistic (mouse_move, click, type)                   │   │
│  │  - User Actions (request_action, get_interactions)       │   │
│  └───────────────┬──────────────────────────────────────────┘   │
│                  │ WebSocket (ws://localhost:9010/ws)            │
│  ┌──────────────▼──────────────────────────────────────────┐   │
│  │         Extension Communication Layer                    │   │
│  │  - WebSocket server                                      │   │
│  │  - Message routing                                       │   │
│  │  - Tab targeting (tabId → specific tab)                 │   │
│  │  - Response limiting (max_tokens support)                │   │
│  └───────────────┬──────────────────────────────────────────┘   │
│                  │                                               │
│  ┌──────────────▼──────────────────────────────────────────┐   │
│  │            MongoDB Integration                           │   │
│  │  - Macro storage (57+ macros)                            │   │
│  │  - Site-specific macros (amazon.com → 17 macros)         │   │
│  │  - Universal macros (* → 40+ macros)                     │   │
│  │  - Macro versioning & metadata                           │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                   │ WebSocket (ws://localhost:9010/ws)
┌──────────────────▼──────────────────────────────────────────────┐
│               Chrome Extension (🤨 unibrowse)                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                 Background Service Worker                │   │
│  │  - WebSocket client (auto-reconnect)                     │   │
│  │  - Message routing to content scripts                    │   │
│  │  - Tab state management                                  │   │
│  │  - Debugger attachment management                        │   │
│  │  - Interaction logging (background audit log)            │   │
│  └───────────────┬──────────────────────────────────────────┘   │
│                  │                                               │
│  ┌──────────────▼──────────────────────────────────────────┐   │
│  │                  Content Scripts                         │   │
│  │  - DOM manipulation                                      │   │
│  │  - Element interaction (click, type, etc.)               │   │
│  │  - Data extraction (snapshot, query, text)               │   │
│  │  - Event listeners (click, navigation detection)         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   Popup UI                                │   │
│  │  - Connection status (🟢 Connected / 🔴 Disconnected)    │   │
│  │  - Server URL configuration                              │   │
│  │  - Attach/detach tabs                                    │   │
│  │  - Debug logging toggle                                  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                   │ CDP (Chrome DevTools Protocol)
┌──────────────────▼──────────────────────────────────────────────┐
│                      Chrome Browser                              │
│  - Tabs with attached debugger                                  │
│  - DOM tree, JavaScript execution                               │
│  - Network monitoring, cookies, storage                         │
│  - Rendering, screenshots, PDF export                           │
└─────────────────────────────────────────────────────────────────┘
```

### Component Summary

| Component | Technology | Port/Protocol | Purpose |
|-----------|-----------|---------------|---------|
| **Claude Code CLI** | Node.js | - | Hosts skills, sub-agents, main conversation |
| **Browser Skill** | Markdown (guidance) | - | Intent recognition, delegation strategy |
| **Sub-Agents** | Markdown (config) + Sonnet LLM | - | Specialized domain workers |
| **MCP Server** | Node.js + Express | 9010 (HTTP/WS) | Tool execution, macro management |
| **MongoDB** | MongoDB | 27017 | Macro storage, persistence |
| **Chrome Extension** | JavaScript (Manifest V3) | - | Browser control via CDP |
| **Chrome Browser** | Chromium | - | Target automation environment |

---

## Component Architecture

### 1. Claude Code CLI Layer

**Purpose**: Host environment for skills, sub-agents, and main conversation.

**Key Files**:
- `.claude/skills/browser/SKILL.md` - Browser skill (guidance + delegation)
- `.claude/agents/browser.md` - Generic browser sub-agent
- `.claude/agents/browser-ecommerce.md` - E-commerce sub-agent
- `.claude/agents/browser-forms.md` - Form automation sub-agent
- `.claude/agents/browser-scraper.md` - Web scraper sub-agent
- `.claude/agents/browser-qa.md` - QA testing sub-agent
- `.claude/hooks/browser-navigation.json` - Navigation hooks

**Responsibilities**:
- User prompt processing
- Intent recognition (via browser skill)
- Sub-agent lifecycle (spawn, execute, return)
- Context preservation (tab IDs, agent results)
- Result aggregation and presentation

### 2. Browser Skill (Guidance Layer)

**Purpose**: Lightweight guidance and delegation strategy (NOT direct execution).

**Key Sections**:
- **When to Use**: Trigger conditions (browser automation, web scraping, testing)
- **Delegation Strategy**: Routes requests to appropriate sub-agents
- **Multi-Tab Patterns**: Guidance on parallel/sequential operations
- **Token Conservation**: Rules to minimize context usage
- **Error Handling**: Common issues and recovery strategies

**Delegation Triggers**:
| Keywords | Delegates To | Rationale |
|----------|--------------|-----------|
| "Amazon", "shopping", "price" | `browser-ecommerce` | E-commerce expertise |
| "form", "fill", "submit" | `browser-forms` | Form automation expertise |
| "extract", "scrape", "table" | `browser-scraper` | Data extraction expertise |
| "test", "accessibility", "performance" | `browser-qa` | QA testing expertise |
| "navigate", "screenshot", "tab" | `browser` | Generic operations |

### 3. Sub-Agent System

**Architecture**: Each sub-agent is an independent LLM context with:
- YAML frontmatter configuration (name, description, model, maxMessages, tools, parameters)
- System prompt with domain expertise
- Tool access (all `mcp__browser__*` tools + Read/Write)
- Workflow patterns (step-by-step guides)
- Return format specification

**Agent Lifecycle**:
```
1. Main conversation detects intent → Browser skill evaluates → Selects sub-agent
2. Claude Code spawns sub-agent with:
   - Task description
   - Parameters (url, data, testType, etc.)
   - Fresh context (no history from main conversation)
3. Sub-agent executes:
   - Checks macros (site-specific → universal)
   - Executes macro OR uses direct MCP tools
   - Creates/manages tabs with labels
   - Performs domain-specific operations
4. Sub-agent returns:
   - Tab IDs (for context preservation)
   - Structured data (JSON)
   - Action taken
   - Status (success/error)
5. Main conversation:
   - Stores tab IDs in context
   - Presents results to user
   - Awaits follow-up (can delegate again with preserved tabs)
```

**Agent Comparison**:

| Agent | Model | Max Messages | Specialization | Key Macros |
|-------|-------|--------------|----------------|------------|
| **browser** | Sonnet | 20 | Generic ops | dismiss_interruptions, find_navigation |
| **browser-ecommerce** | Sonnet | 25 | Amazon, shopping | 17 Amazon macros (search, filters, Rufus) |
| **browser-forms** | Sonnet | 25 | Form automation | discover_forms, analyze_form_requirements |
| **browser-scraper** | Sonnet | 30 | Data extraction | extract_table_data, detect_pagination |
| **browser-qa** | Sonnet | 25 | Testing, audits | audit_accessibility, measure_performance |

---

## MCP Server

### Architecture

**Technology**: Node.js + Express + WebSocket (ws)

**Entry Point**: `src/index.ts`

**Key Components**:
- **Tool Registry** (`src/tools/`): 76 tools across 18 categories
- **WebSocket Server** (`src/server.ts`): Handles connections from extension
- **Message Router** (`src/router.ts`): Routes tool calls to extension
- **Macro Manager** (`src/macros/`): CRUD operations for macros in MongoDB
- **Tab Manager** (`src/tabs.ts`): Multi-tab state management

### Tool Categories (76 tools total)

```typescript
// Navigation (4 tools)
browser_navigate, browser_go_back, browser_go_forward, browser_snapshot

// Interaction (8 tools)
browser_click, browser_type, browser_hover, browser_drag,
browser_select_option, browser_press_key, browser_scroll,
browser_scroll_to_element

// Extraction (8 tools)
browser_query_dom, browser_get_visible_text, browser_get_attributes,
browser_count_elements, browser_get_page_metadata, browser_screenshot,
browser_get_filtered_aria_tree, browser_find_by_text

// Forms (3 tools)
browser_fill_form, browser_submit_form, browser_get_form_values

// Multi-Tab (10 tools)
browser_list_tabs, browser_create_tab, browser_switch_tab, browser_close_tab,
browser_list_attached_tabs, browser_attach_tab, browser_detach_tab,
browser_set_tab_label, browser_get_active_tab, browser_create_window

// Macros (6 tools)
browser_list_macros, browser_execute_macro, browser_store_macro,
browser_update_macro, browser_delete_macro, browser_search_macros

// Network (3 tools)
browser_get_network_logs, browser_set_network_conditions, browser_clear_cache

// Cookies (4 tools)
browser_get_cookies, browser_set_cookie, browser_delete_cookie, browser_clear_cookies

// History (4 tools)
browser_search_history, browser_get_history_visits, browser_delete_history,
browser_clear_history

// Bookmarks (4 tools)
browser_get_bookmarks, browser_create_bookmark, browser_delete_bookmark,
browser_search_bookmarks

// Downloads (4 tools)
browser_download_file, browser_get_downloads, browser_cancel_download,
browser_open_download

// Clipboard (2 tools)
browser_get_clipboard, browser_set_clipboard

// Testing (4 tools)
browser_check_visibility, browser_check_element_state, browser_get_computed_styles,
browser_wait

// Realistic (3 tools)
browser_realistic_mouse_move, browser_realistic_click, browser_realistic_type

// User Actions (4 tools)
browser_request_user_action, browser_get_interactions,
browser_prune_interactions, browser_search_interactions

// Extensions (4 tools)
browser_list_extensions, browser_get_extension_info, browser_enable_extension,
browser_disable_extension

// System (3 tools)
browser_get_version, browser_get_system_info, browser_get_browser_info,
browser_launch_isolated_chrome

// Console (1 tool)
browser_get_console_logs
```

### Tool Execution Flow

```
1. Sub-agent calls tool via MCP protocol:
   {
     "method": "tools/call",
     "params": {
       "name": "mcp__browser__browser_navigate",
       "arguments": { "url": "https://example.com", "tabTarget": 123 }
     }
   }

2. MCP server receives call, validates parameters

3. Server routes to WebSocket handler:
   - Finds target tab (tabTarget: 123 or last-used tab)
   - Constructs message for extension

4. Server sends WebSocket message to extension:
   {
     "type": "browser_navigate",
     "url": "https://example.com",
     "tabId": 123,
     "messageId": "msg-12345"
   }

5. Extension receives message, executes via CDP:
   - Attaches debugger to tab 123 (if not already attached)
   - Sends CDP command: Page.navigate({ url: "..." })
   - Waits for Page.loadEventFired

6. Extension sends response back to server:
   {
     "type": "response",
     "messageId": "msg-12345",
     "success": true,
     "data": { "url": "https://example.com", "title": "Example Domain" }
   }

7. Server returns result to sub-agent:
   {
     "content": [
       {
         "type": "text",
         "text": "✓ Navigated to https://example.com\nTitle: Example Domain"
       }
     ]
   }
```

### Response Limiting (max_tokens)

**Purpose**: Prevent massive tool responses from exhausting context budget.

**Implementation**:
- All tools accept optional `max_tokens` parameter (default: 25000)
- Server applies token budget BEFORE returning to agent
- Uses tiktoken to count tokens accurately
- Truncates response intelligently:
  - Snapshots: Truncate ARIA tree depth-first
  - Text extraction: Cut at word boundaries
  - Arrays: Truncate to first N items + count
  - Objects: Preserve structure, truncate values

**Example**:
```javascript
// Request with token limit
browser_snapshot({ max_tokens: 5000 })

// Server truncates if needed:
// Full snapshot: 15,000 tokens → Truncated: 4,983 tokens
// Message: "[Truncated to fit 5000 token budget. 10,017 tokens removed.]"
```

---

## Chrome Extension

### Architecture

**Technology**: JavaScript (ES6+), Manifest V3

**Entry Point**: `extension/manifest.json`

**Key Components**:
- **Background Service Worker** (`extension/background.js`): WebSocket client, message routing
- **Content Scripts** (`extension/content.js`): DOM manipulation, data extraction
- **Popup UI** (`extension/popup.html`): Connection management, settings

### Background Service Worker

**Responsibilities**:
- Maintain WebSocket connection to MCP server (auto-reconnect)
- Route messages between server and content scripts
- Manage debugger attachments (one per tab)
- Track tab state (attached/detached, labels)
- Log user interactions (background audit log)

**WebSocket Connection**:
```javascript
class WebSocketClient {
  constructor(url = 'ws://localhost:9010/ws') {
    this.url = url;
    this.ws = null;
    this.reconnectDelay = 1000; // Start at 1 second
    this.maxReconnectDelay = 30000; // Max 30 seconds
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('🟢 Connected to MCP server');
      this.reconnectDelay = 1000; // Reset delay on success
    };

    this.ws.onclose = () => {
      console.log('🔴 Disconnected from MCP server');
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.routeMessage(message);
    };
  }

  routeMessage(message) {
    // Route to appropriate handler based on message type
    // e.g., browser_navigate → sendToContentScript(tabId, message)
  }
}
```

**Debugger Attachment**:
```javascript
// Attach debugger to tab for CDP access
chrome.debugger.attach({ tabId: tabId }, '1.3', () => {
  if (chrome.runtime.lastError) {
    console.error('Failed to attach debugger:', chrome.runtime.lastError);
    return;
  }

  console.log(`✓ Debugger attached to tab ${tabId}`);

  // Enable necessary CDP domains
  chrome.debugger.sendCommand({ tabId }, 'Page.enable');
  chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
  chrome.debugger.sendCommand({ tabId }, 'Network.enable');
});
```

**Background Audit Log**:
- Continuously records all user interactions (clicks, keyboard, scroll, navigation)
- Stored in memory (per-tab circular buffer, max 1000 interactions)
- Accessible via `browser_get_interactions` tool
- Used for macro training (future feature)
- Prune/search capabilities via dedicated tools

### Content Scripts

**Responsibilities**:
- Execute DOM operations (click, type, extract)
- Evaluate JavaScript in page context
- Capture snapshots (ARIA tree, visible text, DOM queries)
- Inject helper libraries (jQuery, Lodash, Moment) for macros

**Snapshot Generation** (ARIA Tree):
```javascript
function generateAriaSnapshot() {
  function traverseNode(node, depth = 0, maxDepth = 10) {
    if (depth > maxDepth) return null;

    const role = node.getAttribute('role') || getImplicitRole(node);
    const name = getAccessibleName(node);
    const ref = generateUniqueRef(node);

    return {
      role: role,
      name: name,
      ref: ref,
      focusable: node.tabIndex >= 0,
      children: Array.from(node.children)
        .map(child => traverseNode(child, depth + 1, maxDepth))
        .filter(Boolean)
    };
  }

  return traverseNode(document.body);
}
```

**Macro Execution** (Page Context):
```javascript
// Execute macro code in isolated page context
function executeMacro(macroCode, params) {
  return new Promise((resolve, reject) => {
    const script = `
      (async function() {
        const macroFunc = ${macroCode};
        return await macroFunc(${JSON.stringify(params)});
      })();
    `;

    chrome.debugger.sendCommand(
      { tabId: currentTabId },
      'Runtime.evaluate',
      { expression: script, awaitPromise: true, returnByValue: true },
      (result) => {
        if (result.exceptionDetails) {
          reject(new Error(result.exceptionDetails.text));
        } else {
          resolve(result.result.value);
        }
      }
    );
  });
}
```

### Popup UI

**Features**:
- Connection status indicator (🟢/🔴)
- Server URL configuration (default: ws://localhost:9010/ws)
- Attach/detach current tab
- Debug logging toggle
- Extension version display

**UI Layout**:
```
┌──────────────────────────────────────┐
│  🤨 unibrowse                        │
├──────────────────────────────────────┤
│  Status: 🟢 Connected                │
│  Server: ws://localhost:9010/ws      │
├──────────────────────────────────────┤
│  Current Tab:                        │
│  ✓ Attached (Tab 123)                │
│  [ Detach Tab ]                      │
├──────────────────────────────────────┤
│  Settings:                           │
│  □ Debug Logging                     │
├──────────────────────────────────────┤
│  Version: 1.0.0                      │
└──────────────────────────────────────┘
```

---

## MongoDB Storage

### Purpose

Centralized storage for macros with versioning, metadata, and search capabilities.

### Schema

**Collection**: `macros`

**Document Structure**:
```json
{
  "_id": "macro-id-12345",
  "site": "amazon.com",          // or "*" for universal
  "category": "extraction",       // extraction, form, navigation, etc.
  "name": "amazon_get_product_info",
  "description": "Extract product details from Amazon product page",
  "parameters": {
    "query": {
      "type": "string",
      "description": "Optional product ASIN",
      "required": false
    }
  },
  "code": "(params) => { /* JavaScript macro code */ }",
  "returnType": "object",
  "tags": ["amazon", "product", "extraction"],
  "reliability": "high",          // high, medium, low, untested
  "version": 2,
  "createdAt": "2025-12-10T14:00:00Z",
  "updatedAt": "2025-12-10T15:30:00Z",
  "author": "system",
  "usageCount": 1234,
  "avgExecutionTime": 850         // milliseconds
}
```

### Queries

**List macros by site**:
```javascript
db.macros.find({ site: "amazon.com" })
```

**Search macros by tags**:
```javascript
db.macros.find({ tags: { $in: ["extraction", "product"] } })
```

**Get universal macros**:
```javascript
db.macros.find({ site: "*" })
```

**Search by name/description**:
```javascript
db.macros.find({
  $text: { $search: "extract product price" }
})
```

### Versioning

When a macro is updated:
1. Old version archived to `macros_archive` collection
2. New version stored with incremented `version` field
3. `updatedAt` timestamp set
4. `usageCount` reset to 0

This allows rollback if new version has issues.

---

## Sub-Agent System

### Agent Configuration (YAML)

Every sub-agent has a YAML frontmatter block defining:

```yaml
---
name: browser-ecommerce
description: E-commerce specialist for Amazon shopping, price comparison, and product research.
model: sonnet
maxMessages: 25
tools:
  - mcp__browser__*     # All browser MCP tools
  - Read                # File reading
  - Write               # File writing (for exports)
parameters:
  url:
    type: string
    description: URL to navigate to
    required: false
  query:
    type: string
    description: Search query
    required: false
  action:
    type: string
    description: Action to perform (search, filter, compare)
    required: false
  tabTarget:
    type: string|number
    description: Existing tab ID to reuse
    required: false
---
```

### Agent Specialization

**Domain Expertise** (embedded in system prompt):
- Workflows specific to domain (e.g., Amazon search → filter → extract)
- Macro awareness (knows which macros exist for the domain)
- Error handling for domain-specific issues
- Return format expectations

**Example**: E-Commerce Agent knows:
- 17 Amazon-specific macros
- Standard Amazon workflow patterns
- How to handle Amazon's dynamic page structure
- Rufus AI integration
- Price comparison across multiple sites

### Macro-First Execution Pattern

**Every sub-agent follows this pattern**:

```javascript
// 1. Extract domain from URL
const url = "https://amazon.com/...";
const domain = new URL(url).hostname;  // "amazon.com"

// 2. Check site-specific macros
const siteMacros = await mcp__browser__browser_list_macros({
  site: domain,
  category: "extraction"  // Optional filter
});

// 3. Check universal macros
const universalMacros = await mcp__browser__browser_list_macros({
  site: "*",
  category: "extraction"
});

// 4. Execute macro if available
if (siteMacros.content.macros.length > 0) {
  const macro = siteMacros.content.macros[0];
  const result = await mcp__browser__browser_execute_macro({
    id: macro.id,
    params: { query: "wireless headphones" },
    tabTarget: tabId
  });
  return { method: "macro", macroUsed: macro.name, data: result.content };
}

// 5. Fall back to direct MCP tools
const text = await mcp__browser__browser_get_visible_text({
  maxLength: 3000,
  tabTarget: tabId
});
return { method: "direct", data: { text: text.content } };
```

### Return Format

**All sub-agents return structured JSON**:

```json
{
  "tabId": 123,
  "label": "amazon-search",
  "url": "https://amazon.com/s?k=headphones",
  "action": "search",
  "method": "macro",
  "macroUsed": "amazon_search",
  "data": {
    "results": [...],
    "totalResults": "1,000+",
    "filters": [...]
  },
  "metadata": {
    "executionTime": 850,
    "tokensUsed": 1234
  }
}
```

**Key fields**:
- `tabId`: For context preservation
- `label`: Human-readable tab identifier
- `url`: Current URL
- `action`: Action performed (search, extract, audit, etc.)
- `method`: "macro" or "direct" (how operation was performed)
- `macroUsed`: Name of macro executed (if method=macro)
- `data`: Domain-specific results
- `metadata`: Performance metrics

---

## Macro System

### Macro Lifecycle

```
1. Creation:
   - Developer writes JavaScript function
   - Defines parameters schema
   - Specifies return type
   - Tags for search
   - Stores via browser_store_macro tool

2. Discovery:
   - Sub-agent extracts domain from URL
   - Lists macros for site (browser_list_macros)
   - Filters by category/tags if needed
   - Selects best match

3. Execution:
   - Sub-agent calls browser_execute_macro
   - MCP server validates parameters
   - Server sends to extension
   - Extension injects macro code into page context
   - Macro executes, returns result
   - Server returns to sub-agent

4. Update:
   - Developer modifies macro code
   - Calls browser_update_macro
   - Old version archived
   - New version stored
   - Version incremented

5. Deletion:
   - Developer calls browser_delete_macro
   - Macro moved to macros_archive
   - No longer discoverable
```

### Macro Categories

**Extraction (10 macros)**:
- `extract_table_data`: Extract tables with headers and rows
- `extract_main_content`: Extract article body, remove boilerplate
- `extract_links`: Get all hyperlinks
- `extract_images`: Get all images with src/alt
- `get_page_outline`: Extract headings (H1-H6) as outline
- `get_page_metadata`: Extract meta tags (title, description, OG tags)
- `extract_products`: Extract product listings (price, title, rating)
- `get_interactive_elements`: Find buttons, links, inputs
- `extract_structured_data`: Extract JSON-LD, microdata, RDFa
- `get_text_content`: Extract all visible text

**Form (5 macros)**:
- `discover_forms`: Find all forms on page
- `analyze_form_requirements`: Analyze fields, validation, required
- `find_element_by_description`: Natural language element search
- `detect_validation_rules`: Extract validation patterns (regex, length)
- `detect_messages`: Find error/success/validation messages

**Navigation (4 macros)**:
- `detect_pagination`: Find next/prev buttons, page numbers
- `detect_infinite_scroll`: Check if page uses infinite scroll
- `find_navigation`: Locate primary navigation menu
- `detect_breadcrumbs`: Extract breadcrumb trail

**Util (8 macros)**:
- `dismiss_interruptions`: Close popups, cookie consents, modals
- `smart_cookie_consent`: Accept/reject cookies intelligently
- `close_modal`: Close any modal dialog
- `wait_for_element`: Wait for element to appear
- `scroll_to_element`: Scroll element into view
- `highlight_element`: Temporarily highlight element
- `check_element_visibility`: Check if element is visible
- `get_element_position`: Get element coordinates

**Interaction (6 macros)**:
- `smart_click`: Click with retry logic (handles dynamic elements)
- `smart_fill`: Fill form field with validation checking
- `select_dropdown`: Select option from dropdown
- `check_checkbox`: Check/uncheck checkbox
- `upload_file`: Upload file via file input
- `drag_and_drop`: Drag element to target

**Exploration (4 macros)**:
- `explore_page`: Comprehensive page analysis
- `detect_ajax_requests`: Monitor AJAX activity
- `detect_javascript_frameworks`: Identify JS frameworks (React, Vue, etc.)
- `analyze_performance`: Measure page performance metrics

**CDN (3 macros)**:
- `inject_jquery`: Inject jQuery into page (if not present)
- `inject_lodash`: Inject Lodash into page
- `inject_moment`: Inject Moment.js into page

**Amazon-Specific (17 macros)**:
- Navigation: `amazon_search`, `amazon_click_product`, `amazon_navigate_pages`, `amazon_view_all_reviews`
- Extraction: `amazon_get_product_info`, `amazon_get_listing_products`, `amazon_get_related_products`, `amazon_extract_search_results`, `amazon_get_available_filters`, `amazon_get_product_images`, `amazon_get_reviews_summary`
- Interaction: `amazon_ask_rufus`, `amazon_apply_filter`, `amazon_apply_sort`, `amazon_select_variation`, `amazon_add_to_cart`
- Search: `amazon_search_reviews`

### Macro Structure

**Example Macro** (`extract_table_data`):

```javascript
{
  "site": "*",  // Universal macro
  "category": "extraction",
  "name": "extract_table_data",
  "description": "Extract all tables from page with headers and rows",
  "parameters": {},  // No parameters needed
  "code": `
    (params) => {
      const tables = Array.from(document.querySelectorAll('table'));

      return {
        tables: tables.map(table => {
          const headers = Array.from(table.querySelectorAll('th'))
            .map(th => th.textContent.trim());

          const rows = Array.from(table.querySelectorAll('tbody tr'))
            .map(tr => Array.from(tr.querySelectorAll('td'))
              .map(td => td.textContent.trim())
            );

          return {
            headers: headers.length > 0 ? headers : null,
            rows: rows
          };
        })
      };
    }
  `,
  "returnType": "object",
  "tags": ["extraction", "table", "data"],
  "reliability": "high"
}
```

---

## Delegation Flow

### Step-by-Step Delegation

```
1. User sends prompt:
   "Search Amazon for wireless headphones under $100"

2. Main conversation receives prompt

3. Browser skill evaluates:
   - Keywords detected: "Amazon", "search", "under $100"
   - Intent: E-commerce product search
   - Decision: Delegate to browser-ecommerce sub-agent

4. Main conversation spawns browser-ecommerce agent:
   - Provides task: "Search Amazon for wireless headphones under $100"
   - Parameters: { query: "wireless headphones", maxPrice: 100 }
   - Fresh context (no history)

5. Browser-ecommerce agent executes:
   a. Creates tab: browser_create_tab({ url: "https://amazon.com" })
      → Returns tabId: 123

   b. Labels tab: browser_set_tab_label({ tabTarget: 123, label: "amazon-search" })

   c. Checks macros: browser_list_macros({ site: "amazon.com", category: "navigation" })
      → Finds: amazon_search macro

   d. Executes search: browser_execute_macro({
        id: "amazon_search",
        params: { query: "wireless headphones" },
        tabTarget: 123
      })
      → Returns: { searchUrl: "...", resultsFound: true, totalResults: "1,000+" }

   e. Checks macros: browser_list_macros({ site: "amazon.com", category: "interaction" })
      → Finds: amazon_apply_filter macro

   f. Applies filter: browser_execute_macro({
        id: "amazon_apply_filter",
        params: { filterType: "price", value: "under-100" },
        tabTarget: 123
      })
      → Returns: { filterApplied: true, resultsUpdated: true }

   g. Checks macros: browser_list_macros({ site: "amazon.com", category: "extraction" })
      → Finds: amazon_get_listing_products macro

   h. Extracts results: browser_execute_macro({
        id: "amazon_get_listing_products",
        tabTarget: 123
      })
      → Returns: { products: [{ title: "Sony...", price: "$58.00", ... }, ...] }

6. Browser-ecommerce agent returns to main conversation:
   {
     "tabId": 123,
     "label": "amazon-search",
     "url": "https://amazon.com/s?k=wireless+headphones&...",
     "action": "search",
     "method": "macro",
     "macrosUsed": ["amazon_search", "amazon_apply_filter", "amazon_get_listing_products"],
     "data": {
       "query": "wireless headphones",
       "totalResults": "1,000+",
       "products": [
         { "title": "Sony WH-CH520", "price": "$58.00", "rating": 4.6, ... },
         { "title": "JBL Tune 510BT", "price": "$29.95", "rating": 4.5, ... },
         ...
       ]
     }
   }

7. Main conversation:
   - Stores tab context: amazonSearchTab = 123
   - Presents results to user:
     "Found 50 wireless headphones under $100:
      1. Sony WH-CH520 - $58.00 ⭐ 4.6
      2. JBL Tune 510BT - $29.95 ⭐ 4.5
      ..."

8. User asks follow-up:
   "Get details on the Sony option"

9. Main conversation:
   - Recognizes follow-up context
   - Has preserved tab ID: 123
   - Delegates to browser-ecommerce again:
     - Task: "Get details on the Sony option"
     - Parameters: { tabTarget: 123, productIndex: 1 }

10. Browser-ecommerce agent:
    - Uses existing tab 123 (no need to recreate)
    - Executes: amazon_click_product({ index: 1, tabTarget: 123 })
    - Executes: amazon_get_product_info({ tabTarget: 123 })
    - Returns detailed product info

11. Main conversation presents full product details
```

### Delegation Decision Tree

```
User Prompt
    │
    ▼
Extract Keywords
    │
    ├─ "Amazon", "shopping", "price" → E-Commerce Agent
    ├─ "form", "fill", "submit" → Form Automation Agent
    ├─ "extract", "scrape", "table" → Web Scraper Agent
    ├─ "test", "accessibility", "audit" → QA Testing Agent
    └─ "navigate", "screenshot", "click" → Generic Browser Agent
```

---

## Tab Management

### Tab States

**Lifecycle**:
```
Created → Attached → Labeled → Active → Detached → Closed
```

**States**:
- **Created**: Tab exists in Chrome but not attached
- **Attached**: Debugger attached, can receive CDP commands
- **Labeled**: Has descriptive label (e.g., "amazon-search")
- **Active**: Last-used tab (default target if tabTarget not specified)
- **Detached**: Debugger detached, can't receive commands
- **Closed**: Tab closed, no longer accessible

### Tab Context Preservation

**Pattern**:

```javascript
// Sub-agent creates tab
const tab = await mcp__browser__browser_create_tab({ url: "https://amazon.com" });
const tabId = tab.content.tabId;  // 123

// Sub-agent labels tab
await mcp__browser__browser_set_tab_label({ tabTarget: tabId, label: "amazon" });

// Sub-agent returns tab ID
return {
  tabId: tabId,
  label: "amazon",
  data: { ... }
};

// Main conversation stores in context
// Internal note: amazonTab = 123

// Future delegations use preserved ID
// "Get more details" → Delegate with { tabTarget: 123 }
```

### Multi-Tab Operations

**Parallel Pattern** (Promise.all):
```javascript
// Create multiple tabs in parallel
const [amazonTab, walmartTab, bestbuyTab] = await Promise.all([
  mcp__browser__browser_create_tab({ url: "https://amazon.com" }),
  mcp__browser__browser_create_tab({ url: "https://walmart.com" }),
  mcp__browser__browser_create_tab({ url: "https://bestbuy.com" })
]);

// Execute operations in parallel
const [amazonResults, walmartResults, bestbuyResults] = await Promise.all([
  mcp__browser__browser_execute_macro({ id: "amazon_search", tabTarget: "amazon" }),
  mcp__browser__browser_navigate({ url: "...", tabTarget: "walmart" }),
  mcp__browser__browser_navigate({ url: "...", tabTarget: "bestbuy" })
]);
```

**Sequential Pattern** (await chain):
```javascript
// Multi-step form (must complete step 1 before step 2)
await mcp__browser__browser_execute_macro({ id: "discover_forms", tabTarget: tabId });
await mcp__browser__browser_type({ ref: "field-1", text: "value", tabTarget: tabId });
await mcp__browser__browser_click({ element: "Next", ref: "btn-next", tabTarget: tabId });
await mcp__browser__browser_wait({ time: 2, tabTarget: tabId });
await mcp__browser__browser_execute_macro({ id: "discover_forms", tabTarget: tabId });
```

---

## Token Optimization

### Strategies

**1. Macro-First Execution**
- Macros return structured data (no raw HTML)
- Example: `extract_table_data` returns JSON table, not full DOM
- Savings: 90%+ (15,000 tokens → 500 tokens)

**2. Targeted Text Extraction**
- Use `browser_get_visible_text({ maxLength: 3000 })` instead of snapshots
- Truncate at word boundaries
- Savings: 80%+ (10,000 tokens → 2,000 tokens)

**3. Avoid Snapshots**
- Snapshots (ARIA tree) are token-heavy (5,000-20,000 tokens)
- Only use when absolutely necessary (element interaction)
- Use `browser_query_dom` for targeted element queries
- Savings: 95%+ (20,000 tokens → 1,000 tokens)

**4. Deduplicate Before Returning**
- Multi-page scraping can produce duplicates
- Deduplicate in sub-agent before returning
- Savings: 30-50% (depends on duplication rate)

**5. Export Large Datasets**
- Don't return 1000-row tables in context
- Export to /tmp/ file, return summary + file URL
- Savings: 99%+ (50,000 tokens → 500 tokens)

**6. Clean Interruptions First**
- Cookie consents, popups add noise to extractions
- Use `dismiss_interruptions` macro before operations
- Savings: 10-20% (reduces noise in snapshots/extractions)

**7. Response Limiting (max_tokens)**
- Set `max_tokens` parameter on all tools
- Server enforces budget, truncates intelligently
- Prevents runaway context consumption

### Token Budget Example

**Without Optimization** (naive approach):
```javascript
// 1. Full page snapshot: 15,000 tokens
const snapshot = await browser_snapshot();

// 2. Full visible text: 10,000 tokens
const text = await browser_get_visible_text();

// 3. Extract all tables: 8,000 tokens
const tables = await browser_query_dom({ selector: "table" });

// Total: 33,000 tokens (exhausts context quickly)
```

**With Optimization**:
```javascript
// 1. Use macro for targeted extraction: 500 tokens
const tableData = await browser_execute_macro({
  id: "extract_table_data",
  max_tokens: 5000
});

// 2. Truncate text extraction: 2,000 tokens
const text = await browser_get_visible_text({
  maxLength: 3000,
  max_tokens: 2000
});

// 3. Clean interruptions first: reduces noise
await browser_execute_macro({ id: "dismiss_interruptions" });

// Total: 2,500 tokens (13x improvement)
```

---

## Communication Protocols

### MCP Protocol (stdio transport)

**Protocol**: Model Context Protocol (stdio)

**Transport**: Standard input/output (JSON-RPC 2.0)

**Flow**:
```
Claude Code ↔ MCP Server (stdio)
```

**Message Format**:
```json
// Request from Claude Code
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "mcp__browser__browser_navigate",
    "arguments": {
      "url": "https://example.com",
      "tabTarget": 123
    }
  }
}

// Response from MCP Server
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "✓ Navigated to https://example.com"
      }
    ]
  }
}
```

### WebSocket Protocol (extension transport)

**Protocol**: WebSocket (ws://)

**Transport**: JSON messages over WebSocket

**Flow**:
```
MCP Server ↔ Chrome Extension (WebSocket)
```

**Message Format**:
```json
// Request from MCP Server to Extension
{
  "type": "browser_navigate",
  "url": "https://example.com",
  "tabId": 123,
  "messageId": "msg-12345",
  "max_tokens": 25000
}

// Response from Extension to MCP Server
{
  "type": "response",
  "messageId": "msg-12345",
  "success": true,
  "data": {
    "url": "https://example.com",
    "title": "Example Domain"
  },
  "tokensUsed": 142
}
```

### Chrome DevTools Protocol (CDP)

**Protocol**: Chrome DevTools Protocol

**Transport**: Chrome internal messaging

**Flow**:
```
Extension (via chrome.debugger API) ↔ Chrome Browser (CDP)
```

**Example Commands**:
```javascript
// Navigate to URL
chrome.debugger.sendCommand(
  { tabId: 123 },
  'Page.navigate',
  { url: 'https://example.com' }
);

// Click element at coordinates
chrome.debugger.sendCommand(
  { tabId: 123 },
  'Input.dispatchMouseEvent',
  { type: 'mousePressed', x: 100, y: 200, button: 'left', clickCount: 1 }
);

// Evaluate JavaScript
chrome.debugger.sendCommand(
  { tabId: 123 },
  'Runtime.evaluate',
  { expression: 'document.title', returnByValue: true }
);
```

---

## Extension Points

### Adding New Sub-Agents

**Steps**:
1. Create `.claude/agents/browser-<specialty>.md`
2. Follow template: YAML frontmatter + system prompt
3. Define expertise, workflows, return format
4. Update `.claude/skills/browser/SKILL.md` delegation strategy
5. Update `.claude-plugin/plugin.json` agent list
6. Add examples to `docs/EXAMPLES.md`

**Template**:
```yaml
---
name: browser-<specialty>
description: <One-line description>
model: sonnet
maxMessages: 25
tools:
  - mcp__browser__*
  - Read
  - Write
parameters:
  <your parameters>
---

# 🤨 <Agent Name> Agent

<System prompt with expertise, workflows, return format>
```

### Adding New Macros

**Steps**:
1. Write JavaScript function (ES6+)
2. Define parameters schema
3. Test in browser console first
4. Store via `browser_store_macro` tool:
   ```javascript
   await browser_store_macro({
     site: "example.com",  // or "*" for universal
     category: "extraction",
     name: "my_new_macro",
     description: "What this macro does",
     parameters: { ... },
     code: "(params) => { ... }",
     returnType: "object",
     tags: ["extraction", "custom"]
   });
   ```
5. Test execution via `browser_execute_macro`
6. Document in `MACROS.md`

### Adding New MCP Tools

**Steps**:
1. Add tool definition to `src/tools/index.ts`:
   ```typescript
   {
     name: "browser_my_new_tool",
     description: "What this tool does",
     inputSchema: {
       type: "object",
       properties: {
         param1: { type: "string", description: "..." }
       },
       required: ["param1"]
     }
   }
   ```
2. Implement handler in `src/handlers/my-new-tool.ts`
3. Register handler in `src/server.ts`
4. Add extension support (if needed) in `extension/background.js`
5. Update tests in `tests/test-all-tools.js`
6. Document in `docs/PLUGIN_GUIDE.md`

### Extending Plugin

**Plugin Structure**:
```
.claude-plugin/
  plugin.json          # Plugin manifest
  README.md            # Installation guide

.claude/
  skills/
    browser/
      SKILL.md         # Browser skill (guidance + delegation)
      MACROS.md        # Macro reference
      MULTI_TAB.md     # Multi-tab patterns
      TROUBLESHOOTING.md
      AMAZON_MACROS.md
  agents/
    browser.md         # Generic browser agent
    browser-ecommerce.md
    browser-forms.md
    browser-scraper.md
    browser-qa.md
    browser-<new>.md   # Add new agents here
  hooks/
    browser-navigation.json  # Navigation hooks

docs/
  PLUGIN_GUIDE.md      # Complete plugin guide
  EXAMPLES.md          # Usage examples
  ARCHITECTURE.md      # This file
```

**To extend**:
1. Add new agents to `.claude/agents/`
2. Update delegation strategy in `.claude/skills/browser/SKILL.md`
3. Register in `.claude-plugin/plugin.json`
4. Add examples to `docs/EXAMPLES.md`
5. Update `docs/PLUGIN_GUIDE.md` with new features

---

## Future Expansion

### Macro Training Agent (Planned)

**Purpose**: Learn from user demonstrations and auto-generate macros.

**Architecture**:
```
User Demonstration
    ↓ (via browser_request_user_action)
Background Audit Log captures all interactions
    ↓ (retrieved via browser_get_interactions)
Macro Training Agent analyzes patterns
    ↓
Generates JavaScript macro code
    ↓
Tests macro on same site
    ↓
Validates results
    ↓
Stores macro (via browser_store_macro)
    ↓
Macro available for all sub-agents
```

**Example Flow**:
```
User: "Learn how to extract product prices from example.com"
→ Macro Training Agent: "Please demonstrate by clicking and extracting manually"
→ User: [Demonstrates in browser]
→ Agent: [Retrieves interactions from audit log]
→ Agent: [Analyzes: clicked .product-card, extracted .price text]
→ Agent: [Generates macro code]
→ Agent: [Tests macro on same page]
→ Agent: [Validates: extracted prices match]
→ Agent: [Stores macro as "example_extract_prices"]
→ User: "Extract prices from example.com" [Now uses macro automatically]
```

### Additional Specialist Agents (Future)

**Potential specialists**:
- `browser-social-media.md` - Twitter, LinkedIn, Facebook automation
- `browser-email.md` - Gmail, Outlook web automation
- `browser-video.md` - YouTube, Vimeo interaction
- `browser-finance.md` - Banking, investment sites
- `browser-travel.md` - Flight/hotel booking automation
- `browser-calendar.md` - Google Calendar, Outlook Calendar
- `browser-docs.md` - Google Docs, Microsoft Office Online

Each follows the same architecture: YAML config + system prompt + workflows.

---

## Summary

**Key Architectural Principles**:

1. **Separation of Concerns**
   - Skill: Guidance + delegation (no execution)
   - Sub-agents: Specialized execution (domain experts)
   - MCP server: Tool orchestration
   - Extension: Browser control (CDP)

2. **Context Preservation**
   - Tab IDs returned by sub-agents
   - Main conversation stores tab context
   - Future delegations reuse tabs

3. **Macro-First Philosophy**
   - Check macros before direct tools
   - Site-specific → universal → fallback
   - 90%+ token savings

4. **Token Optimization**
   - Targeted extraction (macros)
   - Truncate text (maxLength)
   - Avoid snapshots
   - Export large datasets
   - Response limiting (max_tokens)

5. **Extensibility**
   - Add new sub-agents (markdown files)
   - Add new macros (JavaScript + store)
   - Add new tools (MCP server + extension)
   - Plugin distribution (community sharing)

**Technology Stack Summary**:
- **Claude Code**: Skill + sub-agent host (Node.js)
- **MCP Server**: Tool execution, macro management (Node.js + Express + WebSocket)
- **MongoDB**: Macro storage (NoSQL)
- **Chrome Extension**: Browser control (JavaScript + Manifest V3 + CDP)
- **Chrome Browser**: Automation target (Chromium)

For questions or contributions, see [PLUGIN_GUIDE.md](./PLUGIN_GUIDE.md) or open a GitHub issue!
