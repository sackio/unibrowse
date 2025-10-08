# Browser MCP Chrome Extension

Custom Chrome extension to connect to Browser MCP server via WebSocket and execute browser automation via Chrome DevTools Protocol.

## Status

🚧 **Under Development**

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select this `extension/` directory

## Usage

1. Start the MCP server: `cd .. && node dist/index.js`
2. Click the Browser MCP extension icon
3. Click "Connect" to attach debugger and connect to WebSocket
4. The extension is now ready to receive commands from the MCP server

## Architecture

- **background.js**: Service worker that manages WebSocket and Chrome debugger
- **utils/websocket.js**: WebSocket connection manager
- **utils/cdp.js**: Chrome DevTools Protocol helpers
- **handlers/**: Tool implementation by category
  - navigation.js: Navigate, go back/forward, wait
  - interaction.js: Click, type, hover, drag, select, press key
  - information.js: Snapshot, screenshot, console logs
  - exploration.js: 11 DOM exploration tools
- **popup.html/js**: Extension UI for connection control

## TODO

- [ ] Add extension icons (16x16, 48x48, 128x128)
- [ ] Implement all components (in progress)
- [ ] Test with MCP server
