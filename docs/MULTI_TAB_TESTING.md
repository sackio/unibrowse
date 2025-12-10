# Multi-Tab Management Testing Guide

This guide provides comprehensive testing procedures for the multi-tab management feature in unibrowse.

## Prerequisites

1. unibrowse extension installed and loaded in Chrome
2. MCP server running (stdio or HTTP mode)
3. Client connected to the MCP server (Claude, VS Code, Cursor, etc.)

## Test Scenarios

### 1. Basic Tab Attachment

**Objective:** Verify that multiple tabs can be attached simultaneously.

**Steps:**
1. Open the unibrowse extension popup
2. Click "Connect" to start the MCP server connection
3. Open 3-4 different websites in separate tabs (e.g., amazon.com, github.com, google.com)
4. In the popup, click on each tab in the "Browser Windows & Tabs" section to attach them
5. Verify that the "Attached Tabs" section shows all attached tabs
6. Verify that each tab has an auto-generated label based on its domain

**Expected Results:**
- Each clicked tab appears in the "Attached Tabs" section
- Labels are auto-generated: first tab from domain gets "domain.com", second gets "domain.com-2", etc.
- The most recently attached/used tab is marked with "ACTIVE" badge
- Each attached tab shows: label, tab ID, title, and URL

### 2. Label Management

**Objective:** Verify that tab labels can be customized and are unique.

**Steps:**
1. Ensure multiple tabs are attached (from Test 1)
2. Click on a label in the "Attached Tabs" section to edit it
3. Change the label to "test-label-1"
4. Press Enter to save
5. Try to change another tab's label to the same "test-label-1"
6. Try changing a label to an empty string
7. Press Escape while editing to cancel changes

**Expected Results:**
- Clicking a label shows an inline text input
- Entering a new unique label and pressing Enter saves it successfully
- Duplicate labels should be rejected (or handled gracefully)
- Empty labels should be rejected
- Pressing Escape cancels editing and restores original label
- The label updates immediately in the UI

### 3. Tab Detachment

**Objective:** Verify that tabs can be detached individually.

**Steps:**
1. Ensure multiple tabs are attached (from Test 1)
2. Click the "Detach" button on one of the attached tabs
3. Verify the tab is removed from the "Attached Tabs" section
4. Verify the tab still appears in the "Browser Windows & Tabs" section
5. Re-attach the tab by clicking it in the "Browser Windows & Tabs" section

**Expected Results:**
- Detach button removes the tab from attached list
- The debugger is detached from that specific tab
- Other attached tabs remain attached
- Tab can be re-attached without issues
- If the active tab is detached, a different tab becomes active

### 4. Active Tab Tracking

**Objective:** Verify that the active (last-used) tab is tracked correctly.

**Steps:**
1. Attach 3+ tabs
2. Use MCP tools to interact with different tabs by specifying `tabTarget`
3. After each tool call, check which tab has the "ACTIVE" indicator in the popup
4. Make a tool call without specifying `tabTarget`
5. Verify the operation was performed on the active tab

**Expected Results:**
- The "ACTIVE" badge moves to whichever tab was most recently used
- Only one tab should have the "ACTIVE" badge at a time
- Operations without `tabTarget` execute on the active tab
- The active tab indicator updates in real-time

### 5. MCP Tool - List Attached Tabs

**Objective:** Test the `browser_list_attached_tabs` MCP tool.

**MCP Tool Call:**
```json
{
  "name": "browser_list_attached_tabs"
}
```

**Expected Response:**
```json
[
  {
    "tabId": 123,
    "label": "amazon.com",
    "title": "Amazon.com: Online Shopping",
    "url": "https://www.amazon.com",
    "lastUsedAt": 1704999600000,
    "isActive": true
  },
  {
    "tabId": 456,
    "label": "github.com",
    "title": "GitHub - unibrowse",
    "url": "https://github.com/...",
    "lastUsedAt": 1704999500000,
    "isActive": false
  }
]
```

**Verification:**
- All attached tabs are returned
- Each tab includes: tabId, label, title, url, lastUsedAt, isActive
- Exactly one tab has `isActive: true`
- The active tab is the most recently used one

### 6. MCP Tool - Set Tab Label

**Objective:** Test the `browser_set_tab_label` MCP tool.

**MCP Tool Call (using tab ID):**
```json
{
  "name": "browser_set_tab_label",
  "arguments": {
    "tabTarget": 123,
    "label": "shopping-cart"
  }
}
```

**MCP Tool Call (using existing label):**
```json
{
  "name": "browser_set_tab_label",
  "arguments": {
    "tabTarget": "amazon.com",
    "label": "amazon-homepage"
  }
}
```

**Expected Results:**
- Label is updated successfully
- New label appears in the popup UI immediately
- Subsequent operations can use the new label as `tabTarget`
- Duplicate labels are rejected with an error
- Empty labels are rejected

### 7. MCP Tool - Detach Tab

**Objective:** Test the `browser_detach_tab` MCP tool.

**MCP Tool Call (using tab ID):**
```json
{
  "name": "browser_detach_tab",
  "arguments": {
    "tabTarget": 123
  }
}
```

**MCP Tool Call (using label):**
```json
{
  "name": "browser_detach_tab",
  "arguments": {
    "tabTarget": "shopping-cart"
  }
}
```

**Expected Results:**
- Tab is successfully detached
- Tab no longer appears in `browser_list_attached_tabs` output
- Popup UI removes the tab from "Attached Tabs" section
- Attempting operations on the detached tab returns an error
- Other attached tabs remain unaffected

### 8. MCP Tool - Get Active Tab

**Objective:** Test the `browser_get_active_tab` MCP tool.

**MCP Tool Call:**
```json
{
  "name": "browser_get_active_tab"
}
```

**Expected Response:**
```json
{
  "tabId": 123,
  "label": "amazon.com",
  "title": "Amazon.com: Online Shopping",
  "url": "https://www.amazon.com",
  "lastUsedAt": 1704999600000
}
```

**Verification:**
- Returns the tab marked as "ACTIVE" in the popup
- Matches the most recently used tab
- After using a tool with `tabTarget`, this should return that tab

### 9. Tab Targeting in Existing Tools

**Objective:** Verify that existing tools support the `tabTarget` parameter.

**Test Cases:**

**Navigation:**
```json
{
  "name": "browser_navigate",
  "arguments": {
    "url": "https://example.com",
    "tabTarget": "github.com"
  }
}
```

**Screenshot:**
```json
{
  "name": "browser_screenshot",
  "arguments": {
    "tabTarget": 456,
    "fullPage": true
  }
}
```

**Snapshot:**
```json
{
  "name": "browser_snapshot",
  "arguments": {
    "tabTarget": "amazon.com"
  }
}
```

**Click (with tabTarget):**
```json
{
  "name": "browser_click",
  "arguments": {
    "element": "Search button",
    "ref": "123",
    "tabTarget": "google.com"
  }
}
```

**Expected Results:**
- Operation executes on the specified tab
- Other tabs are not affected
- Invalid `tabTarget` (non-existent label or tab ID) returns an error
- After the operation, the targeted tab becomes the active tab

### 10. Default Tab Behavior

**Objective:** Verify operations without `tabTarget` use the active tab.

**Steps:**
1. Attach multiple tabs
2. Use a tool with `tabTarget` to make tab A active
3. Use another tool WITHOUT `tabTarget`
4. Verify the operation was performed on tab A

**Test Case:**
```json
// First, navigate on a specific tab (makes it active)
{
  "name": "browser_navigate",
  "arguments": {
    "url": "https://example.com",
    "tabTarget": "github.com"
  }
}

// Then take screenshot without tabTarget (should screenshot github.com tab)
{
  "name": "browser_screenshot",
  "arguments": {
    "fullPage": true
  }
}
```

**Expected Results:**
- Second operation executes on the tab that was made active by the first operation
- Screenshot is of the github.com tab (now at example.com after navigation)

### 11. Extension Popup UI Refresh

**Objective:** Verify UI updates when tabs are attached/detached programmatically.

**Steps:**
1. Have the popup open
2. Use MCP tool to detach a tab: `browser_detach_tab({ tabTarget: "amazon.com" })`
3. Click "Refresh" in the "Attached Tabs" section
4. Use MCP tool to attach to a new tab (this may require implementing an attach tool)
5. Click "Refresh" again

**Expected Results:**
- After detaching via MCP, refresh shows updated attached tabs list
- UI reflects the current state from the background worker
- Active tab indicator is correct after refresh
- Manual and programmatic operations stay in sync

### 12. Multiple Tabs from Same Domain

**Objective:** Verify label generation for multiple tabs from the same domain.

**Steps:**
1. Open 3 tabs from the same domain (e.g., 3 GitHub repository pages)
2. Attach all three tabs via the popup
3. Verify the labels

**Expected Results:**
- First tab: "github.com"
- Second tab: "github.com-2"
- Third tab: "github.com-3"
- Labels are auto-generated correctly
- Each tab is uniquely identifiable

### 13. Concurrent Operations

**Objective:** Verify multiple rapid operations on different tabs.

**Test Case:**
```json
// Take screenshots of 3 different tabs in rapid succession
browser_screenshot({ tabTarget: "amazon.com" })
browser_screenshot({ tabTarget: "github.com" })
browser_screenshot({ tabTarget: "google.com" })
```

**Expected Results:**
- All operations complete successfully
- Each screenshot is from the correct tab
- No race conditions or tab confusion
- Active tab is the last one used (google.com)

### 14. Tab Lifecycle

**Objective:** Test attachment behavior when tabs are closed.

**Steps:**
1. Attach to a tab (e.g., amazon.com)
2. Close that browser tab manually
3. Try to use an MCP tool targeting that tab
4. Check the attached tabs list
5. Verify error handling

**Expected Results:**
- Attempting to use a closed tab returns an error
- The tab should be automatically removed from attached tabs (or marked as invalid)
- Error message clearly indicates the tab no longer exists

### 15. Label Persistence

**Objective:** Verify labels persist across operations.

**Steps:**
1. Attach to a tab and set a custom label: `browser_set_tab_label({ tabTarget: 123, label: "test-tab" })`
2. Perform several operations on that tab using the label
3. List attached tabs to verify label is preserved
4. Refresh the popup to verify label persists

**Expected Results:**
- Custom label persists across operations
- Label can be used repeatedly for `tabTarget`
- Label is preserved in the background worker state
- Popup shows the custom label

## Edge Cases

### Edge Case 1: Empty Attached Tabs
- Detach all tabs
- Call `browser_list_attached_tabs`
- Expected: Empty array or "No tabs attached" message

### Edge Case 2: Very Long Labels
- Set a label with 100+ characters
- Expected: Label should be truncated or rejected with validation error

### Edge Case 3: Special Characters in Labels
- Try labels with: spaces, unicode, emojis, special chars
- Expected: Either accept all valid characters or clearly define allowed character set

### Edge Case 4: Rapid Attach/Detach
- Rapidly attach and detach the same tab multiple times
- Expected: No state corruption, final state matches last operation

### Edge Case 5: Tab Navigation Changes Domain
- Attach to amazon.com with auto-label "amazon.com"
- Navigate to github.com in that same tab
- Expected: Label remains "amazon.com" (labels don't auto-update on navigation)

## Automated Testing Checklist

- [ ] Test 1: Basic Tab Attachment
- [ ] Test 2: Label Management
- [ ] Test 3: Tab Detachment
- [ ] Test 4: Active Tab Tracking
- [ ] Test 5: MCP Tool - List Attached Tabs
- [ ] Test 6: MCP Tool - Set Tab Label
- [ ] Test 7: MCP Tool - Detach Tab
- [ ] Test 8: MCP Tool - Get Active Tab
- [ ] Test 9: Tab Targeting in Existing Tools
- [ ] Test 10: Default Tab Behavior
- [ ] Test 11: Extension Popup UI Refresh
- [ ] Test 12: Multiple Tabs from Same Domain
- [ ] Test 13: Concurrent Operations
- [ ] Test 14: Tab Lifecycle
- [ ] Test 15: Label Persistence
- [ ] Edge Case 1: Empty Attached Tabs
- [ ] Edge Case 2: Very Long Labels
- [ ] Edge Case 3: Special Characters in Labels
- [ ] Edge Case 4: Rapid Attach/Detach
- [ ] Edge Case 5: Tab Navigation Changes Domain

## Bug Reporting Template

If you encounter issues during testing, please report them with this format:

**Issue Title:** [Component] Brief description

**Test Scenario:** Which test case was being executed

**Steps to Reproduce:**
1. Step 1
2. Step 2
3. Step 3

**Expected Behavior:** What should have happened

**Actual Behavior:** What actually happened

**Environment:**
- Browser: Chrome version
- OS: Operating system
- Extension version: unibrowse version
- MCP mode: stdio or HTTP

**Additional Context:** Screenshots, error messages, console logs, etc.

## Success Criteria

The multi-tab management feature is considered fully functional when:

- ✅ All 15 main test scenarios pass
- ✅ All 5 edge cases are handled correctly
- ✅ No critical bugs in tab targeting logic
- ✅ UI correctly reflects backend state
- ✅ Documentation is complete and accurate
- ✅ Error messages are clear and helpful

## Notes

- The extension popup refreshes state every 1 second (polling interval)
- Background worker maintains the TabManager state
- All tab operations are async and should handle race conditions
- Label uniqueness is enforced at the TabManager level
- The active tab is determined by `lastUsedAt` timestamp
