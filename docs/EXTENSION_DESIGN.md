# unibrowse Extension - Architecture Design

## Overview

A barebones Chrome extension that connects to the unibrowse server via WebSocket and executes browser automation commands using the Chrome Debugger API and Chrome DevTools Protocol (CDP).

## Core Concept

```
MCP Server (localhost:9009)
    ↕ WebSocket
Background Service Worker
    ↕ Chrome Debugger API / CDP
Active Browser Tab
```

## Extension Components

### 1. **manifest.json**
```json
{
  "manifest_version": 3,
  "name": "unibrowse",
  "version": "1.0.0",
  "permissions": [
    "debugger",
    "tabs",
    "activeTab",
    "scripting",
    "storage"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": "icon.png"
  }
}
```

**Permissions Explained**:
- `debugger` - Attach debugger to tabs, use CDP
- `tabs` - Query and manipulate tabs
- `activeTab` - Access active tab content
- `scripting` - Execute scripts in page context
- `storage` - Store connection state
- `host_permissions` - Access all URLs for content injection

---

### 2. **background.js** (Service Worker)

**Responsibilities**:
- Maintain WebSocket connection to MCP server (ws://localhost:9009)
- Attach Chrome debugger to active tab
- Route messages between MCP server and browser
- Execute CDP commands
- Manage connection state

**Key Functions**:
```javascript
class BackgroundController {
  websocket = null;
  debugTarget = null;

  // Connect to MCP WebSocket server
  async connectToMCP() {
    this.websocket = new WebSocket('ws://localhost:9009');
    this.websocket.onmessage = (msg) => this.handleMCPMessage(msg);
  }

  // Attach debugger to active tab
  async attachDebugger() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.debugger.attach({ tabId: tab.id }, '1.3');
    this.debugTarget = { tabId: tab.id };
  }

  // Handle message from MCP server
  async handleMCPMessage(message) {
    const { type, payload, id } = JSON.parse(message.data);
    const handler = this.messageHandlers[type];

    try {
      const result = await handler(payload);
      this.websocket.send(JSON.stringify({ id, result }));
    } catch (error) {
      this.websocket.send(JSON.stringify({ id, error: error.message }));
    }
  }
}
```

---

### 3. **popup.html / popup.js** (Extension UI)

Simple UI to show connection status and control:

```html
<!DOCTYPE html>
<html>
<body style="width: 300px; padding: 20px;">
  <h2>unibrowse</h2>
  <div id="status">Disconnected</div>
  <button id="connect">Connect</button>
  <button id="disconnect" disabled>Disconnect</button>

  <hr>

  <div id="info">
    <p><strong>MCP Server:</strong> localhost:9009</p>
    <p><strong>Debugger:</strong> <span id="debugger-status">Not attached</span></p>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

**UI States**:
- ❌ Disconnected - Red status, "Connect" button enabled
- ⏳ Connecting - Yellow status, all buttons disabled
- ✅ Connected - Green status, "Disconnect" button enabled

---

## Message Handler Implementation Strategy

### Approach 1: Chrome DevTools Protocol (CDP) - **PREFERRED**

Use `chrome.debugger.sendCommand()` to execute CDP commands in the page context.

**Advantages**:
- Full access to browser internals
- Can execute arbitrary JavaScript via `Runtime.evaluate`
- Native ARIA tree access via `Accessibility.getFullAXTree`
- Screenshot capabilities via `Page.captureScreenshot`
- No content script injection needed

**Example**:
```javascript
// Execute DOM query using CDP
async function queryDOM({ selector, limit = 10 }) {
  const expression = `
    Array.from(document.querySelectorAll('${selector}')).slice(0, ${limit}).map(el => ({
      tagName: el.tagName.toLowerCase(),
      id: el.id || undefined,
      className: el.className || undefined,
      text: el.textContent?.trim().substring(0, 100)
    }))
  `;

  const result = await chrome.debugger.sendCommand(
    this.debugTarget,
    'Runtime.evaluate',
    { expression, returnByValue: true }
  );

  return result.result.value;
}
```

### Approach 2: Content Script Injection (Fallback)

For scenarios where CDP is unavailable or complex:

```javascript
// Inject and execute script
async function executeInPage(func, args) {
  const [tab] = await chrome.tabs.query({ active: true });

  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: func,
    args: args
  });

  return result[0].result;
}
```

---

## Tool Implementation Matrix

| Tool | Implementation Method | CDP Command / Approach |
|------|----------------------|------------------------|
| **Navigation** |
| browser_navigate | CDP | `Page.navigate` |
| browser_go_back | CDP | `Page.navigateToHistoryEntry` with history[-1] |
| browser_go_forward | CDP | `Page.navigateToHistoryEntry` with history[+1] |
| **Interaction** |
| browser_click | CDP | `Runtime.evaluate` → `element.click()` |
| browser_hover | CDP | `Input.dispatchMouseEvent` |
| browser_type | CDP | `Input.insertText` + focus element |
| browser_drag | CDP | `Input.dispatchMouseEvent` series |
| browser_select_option | CDP | `Runtime.evaluate` → set selected |
| browser_press_key | CDP | `Input.dispatchKeyEvent` |
| browser_wait | JavaScript | `setTimeout` / `await sleep(ms)` |
| **Information** |
| browser_snapshot | CDP | `Accessibility.getFullAXTree` |
| browser_screenshot | CDP | `Page.captureScreenshot` |
| browser_get_console_logs | CDP | Listen to `Console.messageAdded` events |
| **DOM Exploration** |
| browser_query_dom | CDP | `Runtime.evaluate` with querySelector |
| browser_get_visible_text | CDP | `Runtime.evaluate` with TreeWalker |
| browser_get_computed_styles | CDP | `Runtime.evaluate` with getComputedStyle |
| browser_check_visibility | CDP | `Runtime.evaluate` with getBoundingClientRect |
| browser_get_attributes | CDP | `Runtime.evaluate` with element.attributes |
| browser_count_elements | CDP | `Runtime.evaluate` with querySelectorAll.length |
| browser_get_page_metadata | CDP | `Runtime.evaluate` with document.querySelector(meta) |
| browser_get_filtered_aria_tree | CDP | `Accessibility.getPartialAXTree` with filters |
| browser_find_by_text | CDP | `Runtime.evaluate` with TreeWalker + text search |
| browser_get_form_values | CDP | `Runtime.evaluate` with form.elements iteration |
| browser_check_element_state | CDP | `Runtime.evaluate` with element properties |

---

## WebSocket Protocol

### Message Format from MCP Server:
```json
{
  "type": "browser_navigate",
  "payload": { "url": "https://example.com" },
  "id": "msg-abc123"
}
```

### Response Format to MCP Server:
```json
{
  "id": "msg-abc123",
  "result": { "success": true, "data": "..." }
}
```

### Error Response:
```json
{
  "id": "msg-abc123",
  "error": "Element not found: #button"
}
```

---

## Connection Flow

```
1. User clicks "Connect" in popup
   ↓
2. Popup sends message to background worker
   ↓
3. Background worker:
   - Connects to ws://localhost:9009
   - Attaches debugger to active tab
   - Sends "connected" event to MCP server
   ↓
4. MCP server acknowledges connection
   ↓
5. Extension is ready to receive commands
```

---

## Debugger Lifecycle

### Attach:
```javascript
async function attachDebugger() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.debugger.attach({ tabId: tab.id }, '1.3');

  // Enable necessary CDP domains
  await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.enable');
  await chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.enable');
  await chrome.debugger.sendCommand({ tabId: tab.id }, 'Accessibility.enable');
  await chrome.debugger.sendCommand({ tabId: tab.id }, 'Console.enable');

  console.log('Debugger attached to tab:', tab.id);
}
```

### Detach:
```javascript
async function detachDebugger() {
  if (this.debugTarget) {
    await chrome.debugger.detach(this.debugTarget);
    this.debugTarget = null;
  }
}
```

### Handle Tab Close:
```javascript
chrome.tabs.onRemoved.addListener((tabId) => {
  if (this.debugTarget?.tabId === tabId) {
    this.detachDebugger();
    this.websocket?.close();
  }
});
```

---

## Error Handling

### WebSocket Errors:
```javascript
websocket.onerror = (error) => {
  console.error('WebSocket error:', error);
  this.updateStatus('error', 'Failed to connect to MCP server');
};

websocket.onclose = () => {
  this.updateStatus('disconnected', 'Connection closed');
  this.reconnect(); // Auto-reconnect after 5s
};
```

### Debugger Errors:
```javascript
chrome.debugger.onDetach.addListener((source, reason) => {
  if (reason === 'canceled_by_user') {
    this.updateStatus('disconnected', 'Debugger detached by user');
  }
});
```

### CDP Command Errors:
```javascript
try {
  const result = await chrome.debugger.sendCommand(target, 'Page.navigate', { url });
} catch (error) {
  if (error.message.includes('No target with given id')) {
    // Tab was closed, reattach to new active tab
    await this.attachDebugger();
  }
}
```

---

## File Structure

```
browser-mcp-extension/
├── manifest.json
├── background.js          # Main service worker
├── popup.html            # Extension popup UI
├── popup.js              # Popup logic
├── handlers/
│   ├── navigation.js     # Navigate, go back, go forward
│   ├── interaction.js    # Click, type, hover, etc.
│   ├── information.js    # Snapshot, screenshot, console
│   └── exploration.js    # All 11 DOM exploration tools
├── utils/
│   ├── cdp.js           # CDP helper functions
│   └── websocket.js     # WebSocket manager
└── icon.png             # Extension icon
```

---

## Development Workflow

1. **Build extension**: Simply copy files (no build step needed)
2. **Load in Chrome**: `chrome://extensions` → "Load unpacked" → select folder
3. **Start MCP server**: `node dist/index.js`
4. **Test**: Click "Connect" in extension popup, run MCP commands

---

## Advantages of This Approach

✅ **Simple**: No complex build process, pure JavaScript
✅ **Powerful**: Full access via CDP, can do anything DevTools can do
✅ **Fast**: Direct debugger API, no content script messaging overhead
✅ **Comprehensive**: Single implementation handles all 23+ tools
✅ **Maintainable**: Clear separation of concerns, easy to extend
✅ **Debug-friendly**: Can use Chrome DevTools to debug the extension itself

---

## Next Steps

1. Create extension file structure
2. Implement background service worker with WebSocket
3. Implement CDP-based message handlers
4. Create simple popup UI
5. Test with MCP server
6. Document installation and usage
