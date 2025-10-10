# Browser MCP Tools Reference

Complete reference for all 68 MCP tools available in Browser MCP.

## Table of Contents

- [Navigation & Common](#navigation--common) (7 tools)
- [Snapshot & Interaction](#snapshot--interaction) (6 tools)
- [DOM Exploration](#dom-exploration) (11 tools)
- [Custom](#custom) (4 tools)
- [Tabs](#tabs) (4 tools)
- [Forms](#forms) (2 tools)
- [Recording](#recording) (2 tools)
- [Interaction Log](#interaction-log) (3 tools)
- [Cookie Management](#cookie-management) (4 tools)
- [Download Management](#download-management) (4 tools)
- [Clipboard](#clipboard) (2 tools)
- [History](#history) (4 tools)
- [System Information](#system-information) (3 tools)
- [Network](#network) (3 tools)
- [Bookmarks](#bookmarks) (4 tools)
- [Extension Management](#extension-management) (4 tools)

---

## Navigation & Common

### `browser_navigate`
Navigate to a URL in the connected browser tab.

**Parameters:**
- `url` (string, required): The URL to navigate to

**Example:**
```json
{
  "url": "https://example.com"
}
```

### `browser_go_back`
Navigate back in browser history.

**Parameters:** None

### `browser_go_forward`
Navigate forward in browser history.

**Parameters:** None

### `browser_press_key`
Press a keyboard key.

**Parameters:**
- `key` (string, required): Key name (e.g., "Enter", "Escape", "ArrowDown")

**Example:**
```json
{
  "key": "Enter"
}
```

### `browser_scroll`
Scroll the page by a specific amount.

**Parameters:**
- `x` (number, optional): Horizontal scroll amount in pixels (default: 0)
- `y` (number, required): Vertical scroll amount in pixels

**Example:**
```json
{
  "y": 500
}
```

### `browser_scroll_to_element`
Scroll to make a specific element visible.

**Parameters:**
- `element` (string, required): Human-readable element description
- `ref` (string, required): Element reference from snapshot

### `browser_wait`
Wait for a specified amount of time.

**Parameters:**
- `time` (number, required): Time to wait in seconds

**Example:**
```json
{
  "time": 2
}
```

---

## Snapshot & Interaction

### `browser_snapshot`
Capture an accessibility snapshot of the current page.

**Parameters:** None

**Returns:** Accessibility tree with element references

### `browser_click`
Click on an element.

**Parameters:**
- `element` (string, required): Human-readable element description
- `ref` (string, required): Element reference from snapshot
- `button` (string, optional): Mouse button ("left", "right", "middle")
- `doubleClick` (boolean, optional): Perform double-click
- `modifiers` (array, optional): Modifier keys to hold

**Example:**
```json
{
  "element": "Submit button",
  "ref": "123"
}
```

### `browser_drag`
Drag and drop between two elements.

**Parameters:**
- `startElement` (string, required): Source element description
- `startRef` (string, required): Source element reference
- `endElement` (string, required): Target element description
- `endRef` (string, required): Target element reference

### `browser_hover`
Hover over an element.

**Parameters:**
- `element` (string, required): Human-readable element description
- `ref` (string, required): Element reference from snapshot

### `browser_type`
Type text into an editable element.

**Parameters:**
- `element` (string, required): Human-readable element description
- `ref` (string, required): Element reference from snapshot
- `text` (string, required): Text to type
- `submit` (boolean, optional): Press Enter after typing
- `slowly` (boolean, optional): Type one character at a time

**Example:**
```json
{
  "element": "Search input",
  "ref": "456",
  "text": "browser automation",
  "submit": true
}
```

### `browser_select_option`
Select an option in a dropdown.

**Parameters:**
- `element` (string, required): Human-readable element description
- `ref` (string, required): Element reference from snapshot
- `values` (array, required): Values to select

---

## DOM Exploration

### `browser_query_dom`
Query DOM elements by CSS selector.

**Parameters:**
- `selector` (string, required): CSS selector
- `limit` (number, optional): Maximum results to return (default: 10)

**Example:**
```json
{
  "selector": "button.primary",
  "limit": 5
}
```

### `browser_get_visible_text`
Get visible text content from the page or element.

**Parameters:**
- `selector` (string, optional): CSS selector for specific element
- `maxLength` (number, optional): Maximum text length (default: 5000)

### `browser_get_computed_styles`
Get computed CSS styles for an element.

**Parameters:**
- `selector` (string, required): CSS selector
- `properties` (array, optional): Specific CSS properties to retrieve

**Example:**
```json
{
  "selector": ".container",
  "properties": ["display", "width", "height"]
}
```

### `browser_check_visibility`
Check if an element is visible.

**Parameters:**
- `selector` (string, required): CSS selector

**Returns:** Visibility state (visible, hidden, in viewport, etc.)

### `browser_get_attributes`
Get attributes of an element.

**Parameters:**
- `selector` (string, required): CSS selector
- `attributes` (array, optional): Specific attributes (returns all if omitted)

**Example:**
```json
{
  "selector": "a.link",
  "attributes": ["href", "title"]
}
```

### `browser_count_elements`
Count elements matching a CSS selector.

**Parameters:**
- `selector` (string, required): CSS selector

**Returns:** Number of matching elements

### `browser_get_page_metadata`
Get page metadata (title, description, Open Graph tags, etc.).

**Parameters:** None

**Returns:** Page metadata object

### `browser_get_filtered_aria_tree`
Get filtered accessibility tree.

**Parameters:**
- `interactiveOnly` (boolean, optional): Only interactive elements
- `roles` (array, optional): Filter by ARIA roles
- `maxDepth` (number, optional): Maximum tree depth (default: 5)

### `browser_find_by_text`
Find elements containing specific text.

**Parameters:**
- `text` (string, required): Text to search for
- `exact` (boolean, optional): Exact match (default: false)
- `selector` (string, optional): Narrow search scope
- `limit` (number, optional): Maximum results (default: 10)

**Example:**
```json
{
  "text": "Sign In",
  "exact": true,
  "limit": 5
}
```

### `browser_get_form_values`
Get current values of form fields.

**Parameters:**
- `formSelector` (string, optional): Specific form selector

**Returns:** Object with field names and values

### `browser_check_element_state`
Check element state (enabled/disabled, checked, etc.).

**Parameters:**
- `selector` (string, required): CSS selector

**Returns:** Element state object

---

## Custom

### `browser_evaluate`
Evaluate JavaScript in the page context.

**Parameters:**
- `expression` (string, required): JavaScript code to evaluate

**Example:**
```json
{
  "expression": "document.title"
}
```

**Warning:** Use with caution. Can modify page state.

### `browser_get_console_logs`
Get console logs from the browser.

**Parameters:** None

**Returns:** Array of console messages

### `browser_get_network_logs`
Get network requests and responses.

**Parameters:**
- `filter` (string, optional): Filter URLs by pattern

**Returns:** Array of network requests with status, timing, etc.

### `browser_screenshot`
Take a screenshot of the page or element.

**Parameters:**
- `element` (string, optional): Element description (if screenshotting element)
- `ref` (string, optional): Element reference (if screenshotting element)
- `fullPage` (boolean, optional): Capture full scrollable page
- `filename` (string, optional): Custom filename
- `type` (string, optional): Image format ("png" or "jpeg")

**Example:**
```json
{
  "fullPage": true,
  "filename": "page-capture.png"
}
```

---

## Tabs

### `browser_list_tabs`
List all open browser tabs.

**Parameters:** None

**Returns:** Array of tabs with ID, title, URL, active status

### `browser_switch_tab`
Switch to a specific tab.

**Parameters:**
- `tabId` (number, required): Tab ID from list_tabs

**Example:**
```json
{
  "tabId": 12345
}
```

### `browser_create_tab`
Create a new browser tab.

**Parameters:**
- `url` (string, optional): URL to open (default: about:blank)

**Example:**
```json
{
  "url": "https://example.com"
}
```

### `browser_close_tab`
Close a specific tab.

**Parameters:**
- `tabId` (number, required): Tab ID to close

---

## Forms

### `browser_fill_form`
Fill multiple form fields at once.

**Parameters:**
- `fields` (array, required): Array of field objects with:
  - `element` (string): Field description
  - `ref` (string): Field reference
  - `value` (string): Value to fill

**Example:**
```json
{
  "fields": [
    {"element": "Email", "ref": "123", "value": "user@example.com"},
    {"element": "Password", "ref": "456", "value": "secret123"}
  ]
}
```

### `browser_submit_form`
Submit a form.

**Parameters:**
- `element` (string, required): Form element description
- `ref` (string, required): Form element reference

---

## Recording

### `browser_request_demonstration`
Request user to demonstrate a workflow.

**Parameters:**
- `request` (string, required): Instructions for what to demonstrate
- `timeout` (number, optional): Maximum wait time in seconds

**Example:**
```json
{
  "request": "Please log into the application"
}
```

**Returns:** Recorded interactions when user completes demonstration

### `browser_request_user_action`
Request user to perform an action with overlay.

**Parameters:**
- `request` (string, required): Instructions for the user
- `timeout` (number, optional): Maximum wait time (default: 300s)

**Example:**
```json
{
  "request": "Please navigate to your shopping cart and add an item",
  "timeout": 120
}
```

---

## Interaction Log

### `browser_get_interactions`
Retrieve user interactions from background log.

**Parameters:**
- `startTime` (number, optional): Start timestamp (ms) or negative offset
- `endTime` (number, optional): End timestamp (ms) or negative offset
- `types` (array, optional): Filter by interaction types
- `limit` (number, optional): Maximum results (default: 50)
- `offset` (number, optional): Pagination offset
- `urlPattern` (string, optional): Filter by URL regex
- `selectorPattern` (string, optional): Filter by selector regex
- `sortOrder` (string, optional): "asc" or "desc" (default: "desc")

**Example:**
```json
{
  "startTime": -60000,
  "types": ["click", "keyboard"],
  "limit": 20
}
```

### `browser_prune_interactions`
Remove interactions from the log based on criteria.

**Parameters:**
- `before` (number, optional): Remove before timestamp
- `after` (number, optional): Remove after timestamp
- `between` (array, optional): Remove within time range [start, end]
- `keepLast` (number, optional): Keep only last N interactions
- `keepFirst` (number, optional): Keep only first N interactions
- `removeOldest` (number, optional): Remove oldest N interactions
- `types` (array, optional): Remove only these types
- `excludeTypes` (array, optional): Remove all except these types
- `urlPattern` (string, optional): Remove matching URL regex
- `selectorPattern` (string, optional): Remove matching selector regex

**Example:**
```json
{
  "keepLast": 100
}
```

### `browser_search_interactions`
Search interaction log using text queries.

**Parameters:**
- `query` (string, required): Text to search for
- `startTime` (number, optional): Start time filter
- `endTime` (number, optional): End time filter
- `types` (array, optional): Filter by types
- `limit` (number, optional): Maximum results (default: 50)

**Example:**
```json
{
  "query": "login",
  "types": ["click", "keyboard"],
  "limit": 10
}
```

---

## Cookie Management

### `browser_get_cookies`
Get cookies for current page or URL.

**Parameters:**
- `url` (string, optional): Specific URL to get cookies for
- `name` (string, optional): Specific cookie name
- `domain` (string, optional): Filter by domain

**Example:**
```json
{
  "domain": ".example.com"
}
```

**Returns:** Array of cookie objects

### `browser_set_cookie`
Set a cookie.

**Parameters:**
- `name` (string, required): Cookie name
- `value` (string, required): Cookie value
- `url` (string, optional): URL (defaults to current page)
- `domain` (string, optional): Cookie domain
- `path` (string, optional): Cookie path (default: "/")
- `secure` (boolean, optional): Secure flag
- `httpOnly` (boolean, optional): HTTP-only flag
- `expirationDate` (number, optional): Expiration timestamp
- `sameSite` (string, optional): SameSite policy

**Example:**
```json
{
  "name": "session_token",
  "value": "abc123",
  "secure": true,
  "httpOnly": true
}
```

### `browser_delete_cookie`
Delete a specific cookie.

**Parameters:**
- `name` (string, required): Cookie name
- `url` (string, optional): URL (defaults to current page)

**Example:**
```json
{
  "name": "session_token"
}
```

### `browser_clear_cookies`
Clear all cookies or cookies matching criteria.

**Parameters:**
- `url` (string, optional): Clear cookies for specific URL
- `domain` (string, optional): Clear cookies for domain

---

## Download Management

### `browser_download_file`
Download a file from a URL.

**Parameters:**
- `url` (string, required): File URL to download
- `filename` (string, optional): Custom filename

**Example:**
```json
{
  "url": "https://example.com/file.pdf",
  "filename": "document.pdf"
}
```

**Returns:** Download ID

### `browser_get_downloads`
Get list of downloads.

**Parameters:**
- `query` (string, optional): Filter by filename
- `state` (string, optional): Filter by state ("in_progress", "complete", "interrupted")
- `limit` (number, optional): Maximum results

**Example:**
```json
{
  "state": "complete",
  "limit": 10
}
```

**Returns:** Array of download objects with ID, filename, state, progress, etc.

### `browser_cancel_download`
Cancel an in-progress download.

**Parameters:**
- `downloadId` (number, required): Download ID from get_downloads

**Example:**
```json
{
  "downloadId": 12345
}
```

### `browser_open_download`
Open a completed download.

**Parameters:**
- `downloadId` (number, required): Download ID from get_downloads

---

## Clipboard

### `browser_get_clipboard`
Get text from clipboard.

**Parameters:** None

**Returns:** Clipboard text content

### `browser_set_clipboard`
Set clipboard text content.

**Parameters:**
- `text` (string, required): Text to copy to clipboard

**Example:**
```json
{
  "text": "Hello, World!"
}
```

---

## History

### `browser_search_history`
Search browser history.

**Parameters:**
- `text` (string, required): Search query
- `startTime` (number, optional): Start timestamp (ms since epoch)
- `endTime` (number, optional): End timestamp (ms since epoch)
- `maxResults` (number, optional): Maximum results (default: 100)

**Example:**
```json
{
  "text": "github",
  "maxResults": 20
}
```

**Returns:** Array of history items with URL, title, last visit time, visit count

### `browser_get_history_visits`
Get visit details for a specific URL.

**Parameters:**
- `url` (string, required): URL to get visits for

**Returns:** Array of visit objects with timestamps and transitions

### `browser_delete_history`
Delete specific URLs from history.

**Parameters:**
- `urls` (array, required): URLs to remove from history

**Example:**
```json
{
  "urls": ["https://example.com/page1", "https://example.com/page2"]
}
```

### `browser_clear_history`
Clear browsing history within a time range.

**Parameters:**
- `startTime` (number, required): Start timestamp (ms since epoch)
- `endTime` (number, optional): End timestamp (defaults to now)

**Example:**
```json
{
  "startTime": 1609459200000,
  "endTime": 1640995200000
}
```

---

## System Information

### `browser_get_version`
Get browser extension version.

**Parameters:** None

**Returns:** Extension version string

### `browser_get_system_info`
Get system information.

**Parameters:** None

**Returns:** Object with OS, architecture, and platform details

### `browser_get_browser_info`
Get browser information.

**Parameters:** None

**Returns:** Object with browser name, version, and extension count

---

## Network

### `browser_get_network_state`
Get current network connection state.

**Parameters:** None

**Returns:** Object with connection type, effective type, downlink speed, RTT

### `browser_set_network_conditions`
Emulate network conditions (throttling).

**Parameters:**
- `offline` (boolean, optional): Simulate offline mode
- `downloadThroughput` (number, optional): Download speed in bytes/second (-1 for unlimited)
- `uploadThroughput` (number, optional): Upload speed in bytes/second (-1 for unlimited)
- `latency` (number, optional): Additional latency in milliseconds

**Example:**
```json
{
  "downloadThroughput": 50000,
  "uploadThroughput": 20000,
  "latency": 100
}
```

**Presets:**
- **Slow 3G**: `{"downloadThroughput": 50000, "uploadThroughput": 50000, "latency": 2000}`
- **Fast 3G**: `{"downloadThroughput": 180000, "uploadThroughput": 84000, "latency": 562}`

### `browser_clear_cache`
Clear browser cache.

**Parameters:**
- `since` (number, optional): Clear cache since timestamp (ms since epoch)

**Example:**
```json
{
  "since": 1640995200000
}
```

---

## Bookmarks

### `browser_get_bookmarks`
Get bookmarks tree or folder contents.

**Parameters:**
- `folderId` (string, optional): Specific folder ID (omit for root)
- `recursive` (boolean, optional): Include subfolders (default: true)

**Returns:** Bookmark tree with folders and bookmarks

### `browser_create_bookmark`
Create a new bookmark.

**Parameters:**
- `title` (string, required): Bookmark title
- `url` (string, required): Bookmark URL
- `parentId` (string, optional): Parent folder ID

**Example:**
```json
{
  "title": "Example Site",
  "url": "https://example.com"
}
```

**Returns:** Created bookmark object with ID

### `browser_delete_bookmark`
Delete a bookmark.

**Parameters:**
- `id` (string, required): Bookmark ID from get_bookmarks

**Example:**
```json
{
  "id": "123"
}
```

### `browser_search_bookmarks`
Search bookmarks.

**Parameters:**
- `query` (string, required): Search query (searches title and URL)
- `limit` (number, optional): Maximum results (default: 100)

**Example:**
```json
{
  "query": "documentation",
  "limit": 20
}
```

**Returns:** Array of matching bookmarks

---

## Extension Management

### `browser_list_extensions`
List all installed browser extensions.

**Parameters:** None

**Returns:** Array of extension objects with ID, name, version, enabled status, description

### `browser_get_extension_info`
Get detailed information about a specific extension.

**Parameters:**
- `id` (string, required): Extension ID from list_extensions

**Example:**
```json
{
  "id": "extension-id-here"
}
```

**Returns:** Detailed extension object with permissions, host permissions, install type, etc.

### `browser_enable_extension`
Enable a disabled extension.

**Parameters:**
- `id` (string, required): Extension ID to enable

**Example:**
```json
{
  "id": "extension-id-here"
}
```

### `browser_disable_extension`
Disable an enabled extension.

**Parameters:**
- `id` (string, required): Extension ID to disable

**Example:**
```json
{
  "id": "extension-id-here"
}
```

**Note:** Cannot disable or enable the Browser MCP extension itself.

---

## Best Practices

### Using Snapshots
Always call `browser_snapshot` before interacting with elements to get current page state and element references.

### Error Handling
All tools return error messages if operations fail. Check response structure for success/error status.

### Performance
- Use `browser_wait` sparingly; prefer waiting for specific conditions
- Batch operations when possible (e.g., `browser_fill_form` instead of multiple type operations)
- Use filtered queries to reduce data transfer

### Security
- Cookie and history operations affect user privacy; use responsibly
- `browser_evaluate` can execute arbitrary JavaScript; validate inputs
- Network throttling affects all tabs; restore conditions after testing

### Interaction Log
- Background interaction log has configurable size limit (default: 100 actions or 5 minutes)
- Use `browser_prune_interactions` regularly to manage memory
- Search and filter operations are optimized for recent interactions

---

## Error Codes

Common error scenarios:

- **No tab connected**: Browser MCP extension not connected to server
- **Element not found**: Invalid reference or element removed from DOM
- **Permission denied**: Operation requires additional browser permissions
- **Invalid parameter**: Missing required parameter or wrong type
- **Operation failed**: Chrome API returned error (check details in message)
- **Timeout**: Operation exceeded time limit (e.g., user action request)

---

## Version

This reference is for Browser MCP version 0.1.3 with 68 total tools.

Last updated: 2025-01-10
