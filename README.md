<a href="https://browsermcp.io">
  <img src="./.github/images/banner.png" alt="Browser MCP banner">
</a>

<h3 align="center">Browser MCP</h3>

<p align="center">
  Automate your browser with AI.
  <br />
  <a href="https://browsermcp.io"><strong>Website</strong></a>
  •
  <a href="https://docs.browsermcp.io"><strong>Docs</strong></a>
  •
  <a href="docs/TOOLS_REFERENCE.md"><strong>Tools Reference</strong></a>
</p>

## About

Browser MCP is an MCP server + Chrome extension that allows you to automate your browser using AI applications like VS Code, Claude, Cursor, and Windsurf. With **72 comprehensive tools** including multi-tab management, it provides complete browser automation capabilities through the Model Context Protocol.

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

Browser MCP provides 72 tools organized into 17 categories:

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

Browser MCP supports simultaneous automation of multiple browser tabs, allowing you to:

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

## Contributing

This repo contains all the core MCP code for Browser MCP, but currently cannot yet be built on its own due to dependencies on utils and types from the monorepo where it's developed.

## Credits

Browser MCP was adapted from the [Playwright MCP server](https://github.com/microsoft/playwright-mcp) in order to automate the user's browser rather than creating new browser instances. This allows using the user's existing browser profile to use logged-in sessions and avoid bot detection mechanisms that commonly block automated browser use.
