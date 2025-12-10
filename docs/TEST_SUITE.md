# unibrowse Test Suite

## Prerequisites
1. Extension loaded and reloaded in Chrome
2. Connected to an active tab
3. Tab is on a page with interactive elements (e.g., Amazon, GitHub, etc.)

## Test Execution
Run this test suite by asking Claude Code to "run the browser MCP test suite"

---

## 1. Connection & State Tests

### 1.1 Check Page Metadata
```
browser_get_page_metadata
```
**Expected**: Returns title, description, URL

### 1.2 Get Current URL
```
browser_snapshot (abbreviated)
```
**Expected**: Returns page structure without errors

---

## 2. Background Interaction Log Tests

### 2.1 Get Recent Interactions
```
browser_get_interactions({ limit: 10 })
```
**Expected**: Returns up to 10 most recent interactions

### 2.2 Get Last Minute of Interactions
```
browser_get_interactions({ startTime: -60000, limit: 20 })
```
**Expected**: Returns interactions from the last minute

### 2.3 Filter by Interaction Type
```
browser_get_interactions({ types: ["click", "scroll"], limit: 10 })
```
**Expected**: Returns only click and scroll interactions

### 2.4 Search Interactions
```
browser_search_interactions({ query: "button", limit: 5 })
```
**Expected**: Returns interactions mentioning "button" in selectors/text

### 2.5 Prune Old Interactions
```
browser_prune_interactions({ keepLast: 50 })
```
**Expected**: Removes all but the last 50 interactions

---

## 3. Navigation Tests

### 3.1 Navigate to Test Page
```
browser_navigate({ url: "https://example.com" })
```
**Expected**: Page navigates successfully

### 3.2 Go Back
```
browser_go_back
```
**Expected**: Returns to previous page

### 3.3 Go Forward
```
browser_go_forward
```
**Expected**: Returns to example.com

---

## 4. DOM Exploration Tests

### 4.1 Query DOM Elements
```
browser_query_dom({ selector: "a", limit: 5 })
```
**Expected**: Returns first 5 link elements

### 4.2 Count Elements
```
browser_count_elements({ selector: "p" })
```
**Expected**: Returns count of paragraph elements

### 4.3 Get Visible Text
```
browser_get_visible_text({ maxLength: 500 })
```
**Expected**: Returns first 500 chars of visible text

### 4.4 Find by Text
```
browser_find_by_text({ text: "More", limit: 3 })
```
**Expected**: Returns elements containing "More"

### 4.5 Get Filtered ARIA Tree
```
browser_get_filtered_aria_tree({ interactiveOnly: true, maxDepth: 3 })
```
**Expected**: Returns interactive elements up to depth 3

---

## 5. Interaction Tests

### 5.1 Click Element
```
browser_snapshot (to get refs)
browser_click({ element: "first link", ref: "<ref from snapshot>" })
```
**Expected**: Clicks the element, navigation may occur

### 5.2 Hover Element
```
browser_hover({ element: "button", ref: "<ref>" })
```
**Expected**: Hovers over element

### 5.3 Scroll
```
browser_scroll({ y: 500 })
```
**Expected**: Scrolls down 500px

### 5.4 Press Key
```
browser_press_key({ key: "Escape" })
```
**Expected**: Sends Escape key to page

---

## 6. Screenshot & Console Tests

### 6.1 Take Screenshot
```
browser_screenshot
```
**Expected**: Returns base64 screenshot

### 6.2 Get Console Logs
```
browser_get_console_logs
```
**Expected**: Returns array of console messages

### 6.3 Get Network Logs
```
browser_get_network_logs({ filter: "json" })
```
**Expected**: Returns network requests containing "json"

---

## 7. Tab Management Tests

### 7.1 List Tabs
```
browser_list_tabs
```
**Expected**: Returns all open tabs with IDs

### 7.2 Create New Tab
```
browser_create_tab({ url: "https://example.org" })
```
**Expected**: Opens new tab, returns tab ID

### 7.3 Switch Tab
```
browser_switch_tab({ tabId: <original_tab_id> })
```
**Expected**: Switches back to original tab

### 7.4 Close Tab
```
browser_close_tab({ tabId: <new_tab_id> })
```
**Expected**: Closes the newly created tab

---

## 8. Recording/Demonstration Tests

### 8.1 Request Demonstration (Short)
```
browser_request_demonstration({
  request: "Click any link on the page",
  timeout: 30
})
```
**Expected**:
- Overlay appears with Start button
- User clicks Start, performs action, clicks Complete
- Returns recorded actions and network activity

### 8.2 Request Demonstration (No Timeout)
```
browser_request_demonstration({
  request: "Navigate to any page you want to show me"
})
```
**Expected**:
- Waits indefinitely until user clicks Complete
- Records all interactions during demonstration

---

## 9. Advanced Interaction Log Tests

### 9.1 Time Range Query
```
browser_get_interactions({
  startTime: -300000,  // Last 5 minutes
  endTime: -60000,     // Up to 1 minute ago
  limit: 20
})
```
**Expected**: Returns interactions from 5 min ago to 1 min ago

### 9.2 Pattern Search
```
browser_search_interactions({
  query: "input",
  types: ["input", "change"],
  limit: 10
})
```
**Expected**: Returns input/change events matching "input"

### 9.3 Selective Pruning by Type
```
browser_prune_interactions({
  types: ["mousemove", "scroll"]
})
```
**Expected**: Removes only mousemove and scroll events

### 9.4 Prune by Time
```
browser_prune_interactions({
  before: <timestamp_5_minutes_ago>
})
```
**Expected**: Removes all interactions older than 5 minutes

---

## 10. Edge Case Tests

### 10.1 Empty Results
```
browser_get_interactions({ types: ["nonexistent_type"] })
```
**Expected**: Returns empty results gracefully

### 10.2 Large Limit
```
browser_get_interactions({ limit: 1000 })
```
**Expected**: Returns up to buffer size (500) interactions

### 10.3 Invalid Selector
```
browser_query_dom({ selector: ":::invalid:::" })
```
**Expected**: Returns error message gracefully

---

## Test Summary Template

After running all tests, report:
- ✅ Total passed: X/Y
- ❌ Total failed: X/Y
- ⚠️  Warnings/Notes: <any issues>
- 📊 Background log stats: <buffer size, oldest/newest timestamps>

---

## Automated Test Runner (Future Enhancement)

To make this fully automated, could create:
1. Node.js script that runs all tools via MCP SDK
2. Headless browser test suite
3. CI/CD integration for regression testing

For now, manual execution through Claude Code is sufficient for validation.
