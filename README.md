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

Browser MCP is an MCP server + Chrome extension that allows you to automate your browser using AI applications like VS Code, Claude, Cursor, and Windsurf. With **68 comprehensive tools**, it provides complete browser automation capabilities through the Model Context Protocol.

## Features

- ⚡ **Fast**: Automation happens locally on your machine, resulting in better performance without network latency
- 🔒 **Private**: Since automation happens locally, your browser activity stays on your device and isn't sent to remote servers
- 👤 **Logged In**: Uses your existing browser profile, keeping you logged into all your services
- 🥷🏼 **Stealth**: Avoids basic bot detection and CAPTCHAs by using your real browser fingerprint
- 🛠️ **Comprehensive**: 68 tools covering navigation, DOM interaction, forms, cookies, downloads, history, bookmarks, and more
- 🔄 **Persistent HTTP**: Uses streamable HTTP transport on port 9010 for stable, multi-client connections
- 📝 **Interaction Logging**: Background audit log tracks all user interactions for debugging and context retrieval

## Tool Categories

Browser MCP provides 68 tools organized into 16 categories:

| Category | Tools | Description |
|----------|-------|-------------|
| **Navigation & Common** | 7 | Navigate, scroll, keyboard input, wait |
| **Snapshot & Interaction** | 6 | Page snapshots, click, drag, hover, type |
| **DOM Exploration** | 11 | Query elements, get text, styles, attributes, metadata |
| **Custom** | 4 | Execute JavaScript, console logs, network logs, screenshots |
| **Tabs** | 4 | List, switch, create, close tabs |
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

## Contributing

This repo contains all the core MCP code for Browser MCP, but currently cannot yet be built on its own due to dependencies on utils and types from the monorepo where it's developed.

## Credits

Browser MCP was adapted from the [Playwright MCP server](https://github.com/microsoft/playwright-mcp) in order to automate the user's browser rather than creating new browser instances. This allows using the user's existing browser profile to use logged-in sessions and avoid bot detection mechanisms that commonly block automated browser use.
