<h3 align="center">unibrowse</h3>

<p align="center">
  Bridging the gap between AI agents and browser automation
  <br />
  <a href="docs/TOOLS_REFERENCE.md"><strong>Tools Reference</strong></a>
</p>

## About

**unibrowse** is an MCP server + Chrome extension that bridges the gap between AI agents and browser automation. With **72 comprehensive tools** including multi-tab management, it provides complete browser control through the Model Context Protocol, enabling AI applications like Claude, VS Code, Cursor, and Windsurf to automate your browser seamlessly.

## Features

- ⚡ **Fast**: Automation happens locally on your machine, resulting in better performance without network latency
- 🔒 **Private**: Since automation happens locally, your browser activity stays on your device and isn't sent to remote servers
- 👤 **Logged In**: Uses your existing browser profile, keeping you logged into all your services
- 🥷🏼 **Stealth**: Avoids basic bot detection and CAPTCHAs by using your real browser fingerprint
- 🛠️ **Comprehensive**: 72 tools covering navigation, DOM interaction, forms, cookies, downloads, history, bookmarks, and more
- 🔄 **Persistent HTTP**: Uses streamable HTTP transport on port 9010 for stable, multi-client connections
- 📝 **Interaction Logging**: Background audit log tracks all user interactions for debugging and context retrieval
- 🎯 **Multi-Tab Management**: Attach to and control multiple browser tabs simultaneously with label-based targeting

## Tool Categories

unibrowse provides 72 tools organized into 17 categories:

| Category | Tools | Description |
|----------|-------|-------------|
| **Navigation & Common** | 7 | Navigate, scroll, keyboard input, wait |
| **Snapshot & Interaction** | 6 | Page snapshots, click, drag, hover, type |
| **DOM Exploration** | 11 | Query elements, get text, styles, attributes, metadata |
| **Custom** | 4 | Execute JavaScript, console logs, network logs, screenshots |
| **Tabs** | 4 | List, switch, create, close tabs |
| **Multi-Tab Management** | 4 | List attached tabs, set labels, detach tabs, get active tab |
| **Forms** | 2 | Fill forms, submit forms |
| **Recording** | 2 | Request user demonstrations, guided actions |
| **Interaction Log** | 3 | Query, prune, search background interaction history |
| **Cookie Management** | 4 | Get, set, delete, clear cookies |
| **Download Management** | 4 | Initiate downloads, list, cancel, open |
| **Clipboard** | 2 | Get and set clipboard content |
| **History** | 4 | Search, get visits, delete, clear browsing history |
| **System Information** | 3 | Browser version, platform info, extension details |
| **Network** | 3 | Connection state, throttling, cache management |
| **Bookmarks** | 4 | List, create, delete, search bookmarks |
| **Extension Management** | 4 | List, get info, enable, disable extensions |

See [TOOLS_REFERENCE.md](docs/TOOLS_REFERENCE.md) for complete documentation of all tools with parameters and examples.

## Multi-Tab Management

unibrowse supports simultaneous automation of multiple browser tabs, allowing you to:

- **Attach to multiple tabs**: Connect debuggers to multiple tabs and manage them with unique labels
- **Label-based targeting**: Identify tabs using auto-generated domain-based labels (e.g., "amazon.com", "github.com-2")
- **Flexible tab targeting**: All tools support an optional `tabTarget` parameter to specify which tab to operate on
- **Last-used tracking**: When no tab is specified, operations target the most recently used tab
- **UI management**: Extension popup provides a visual interface to view, label, and detach tabs

### Usage Example

```javascript
// List all attached tabs
browser_list_attached_tabs()
// Returns: [
//   { tabId: 123, label: "amazon.com", title: "Amazon.com", url: "https://amazon.com", isActive: true },
//   { tabId: 456, label: "github.com", title: "GitHub", url: "https://github.com", isActive: false }
// ]

// Take screenshot of specific tab by label
browser_screenshot({ tabTarget: "github.com" })

// Navigate on a specific tab by ID
browser_navigate({ url: "https://example.com", tabTarget: 456 })

// Type in the active (last-used) tab
browser_type({ element: "Search", ref: "123", text: "browser automation" })
// Note: No tabTarget specified, so this operates on the active tab

// Set a custom label for easier identification
browser_set_tab_label({ tabTarget: 123, label: "shopping-cart" })

// Detach from a specific tab
browser_detach_tab({ tabTarget: "shopping-cart" })
```

### Tab Label Format

Labels are automatically generated from the domain name:
- First tab from a domain: `"example.com"`
- Second tab from same domain: `"example.com-2"`
- Third tab: `"example.com-3"`
- And so on...

You can also set custom labels using `browser_set_tab_label` for easier identification.

## Repository Structure

The repository is organized into the following directories:

```
browser-mcp/
├── src/               # Source code (TypeScript)
├── dist/              # Compiled JavaScript
├── extension/         # Chrome extension for browser integration
├── config/            # Configuration files (PM2, systemd, nodemon)
├── scripts/           # Operational scripts and utilities
│   └── utils/         # Development utilities (list-macros, test-macro)
├── tests/             # Test suites and test data
├── macros/            # Browser automation macros
│   └── storage/       # Scripts to load macros into MongoDB
├── docs/              # Additional documentation
├── backups/           # Database backups
└── logs/              # Application logs
```

### Key Files and Directories

- **src/** - Main source code for the MCP server
- **extension/** - Chrome extension that enables browser automation
- **config/** - PM2, systemd, and nodemon configurations
- **scripts/** - Operational shell scripts and MongoDB utilities
- **tests/** - Comprehensive test suites for all 72 tools
- **macros/** - Reusable JavaScript macros for common automation tasks
- **docs/** - Design documents, guides, and additional documentation

See individual README files in each directory for more details.

## Development

### Running Tests

```bash
# Run comprehensive tests
./scripts/run-tests.sh

# Or run specific tests
node tests/test-all-tools.js [tool_name]
```

### Using Utilities

```bash
# List available macros
node scripts/utils/list-macros.js [search_term]

# Test a specific macro
node scripts/utils/test-macro.js <macro_id> [params_json]
```

### Service Management

```bash
# Using PM2
pm2 start config/ecosystem.config.js

# Using systemd
./scripts/service.sh start|stop|restart|status
```

## Contributing

This repo contains all the core MCP code for unibrowse, but currently cannot yet be built on its own due to dependencies on utils and types from the monorepo where it's developed.

## Credits

unibrowse is a fork of [browser-mcp](https://github.com/BrowserMCP/mcp), adapted and extended with:
- 🤨 Plugin architecture for Claude Code with 5 specialized sub-agents
- 57+ reusable automation macros stored in MongoDB
- Intelligent delegation patterns for automatic routing
- Comprehensive documentation and examples

The original browser-mcp project was inspired by Microsoft's [Playwright MCP server](https://github.com/microsoft/playwright-mcp), but designed to automate the user's existing browser rather than creating new browser instances. This allows using the user's browser profile to maintain logged-in sessions and avoid bot detection mechanisms that commonly block automated browser use.

**Thank you to the browser-mcp team for creating the foundation that made this plugin possible!**
