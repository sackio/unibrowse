# 🤨 Troubleshooting Guide

Common issues and solutions for browser automation with unibrowse.

## Table of Contents

1. [Connection Issues](#connection-issues)
2. [Tab Management Issues](#tab-management-issues)
3. [Macro Execution Issues](#macro-execution-issues)
4. [Form Automation Issues](#form-automation-issues)
5. [Scraping Issues](#scraping-issues)
6. [Performance Issues](#performance-issues)
7. [Authentication Issues](#authentication-issues)
8. [Extension Issues](#extension-issues)
9. [Database Issues](#database-issues)
10. [General Debugging](#general-debugging)

---

## Connection Issues

### Error: "MCP server not responding"

**Symptoms**: Tools timeout, no response from browser

**Causes**:
- MCP server not running
- Wrong port configured
- Extension not connected

**Solutions**:

```bash
# 1. Check if server is running
docker compose ps

# Expected output:
# NAME                IMAGE               STATUS
# browser-mcp-app-1   browser-mcp-app     Up 5 minutes

# 2. Check port 9010 is open
netstat -an | grep 9010

# 3. Restart server if needed
docker compose restart

# 4. Check logs
docker compose logs -f
```

**Extension side**:
1. Open Chrome extension popup
2. Verify status: "Connected to ws://localhost:9010/ws"
3. If not connected, click "Connect"
4. Check browser console for WebSocket errors

### Error: "WebSocket connection failed"

**Symptoms**: Extension shows "Disconnected" status

**Causes**:
- Server not running on port 9010
- Firewall blocking WebSocket
- Wrong URL configured

**Solutions**:

```bash
# 1. Verify server is listening
curl http://localhost:9010/health

# Expected: {"status":"healthy"}

# 2. Check WebSocket endpoint
wscat -c ws://localhost:9010/ws

# Should connect without errors

# 3. Check extension configuration
# Extension popup → Settings → Server URL should be:
# ws://localhost:9010/ws
```

### Error: "No tabs attached"

**Symptoms**: Tools work but can't target any tabs

**Causes**:
- Extension not attached to any tabs
- All tabs were closed/detached

**Solutions**:

```javascript
// 1. List attached tabs
const tabs = await mcp__browser__browser_list_attached_tabs();
console.log(tabs);

// If empty, attach to a tab:
// 2. Create new tab
const tab = await mcp__browser__browser_create_tab({
  url: "https://example.com"
});

// 3. Or manually attach via extension popup:
// - Click extension icon
// - Click "Attach to this tab"
```

---

## Tab Management Issues

### Error: "Tab not found"

**Symptoms**: `tabTarget` not found, operations fail

**Causes**:
- Tab was closed
- Tab ID no longer valid
- Wrong tab ID or label

**Solutions**:

```javascript
// 1. List all attached tabs
const tabs = await mcp__browser__browser_list_attached_tabs();
console.log("Available tabs:", tabs.content.tabs);

// 2. Check if specific tab exists
const tabExists = tabs.content.tabs.some(t => t.tabId === targetTabId);

if (!tabExists) {
  // 3. Recreate tab
  const newTab = await mcp__browser__browser_create_tab({ url: url });
  targetTabId = newTab.content.tabId;

  // 4. Label it
  await mcp__browser__browser_set_tab_label({
    tabTarget: newTab.content.tabId,
    label: "descriptive-name"
  });
}

// 5. Or use the active tab
const activeTab = await mcp__browser__browser_get_active_tab();
targetTabId = activeTab.content.tabId;
```

### Error: "Wrong tab targeted"

**Symptoms**: Operations execute on unexpected tab

**Causes**:
- Multiple tabs with similar labels
- Tab ID confusion
- Missing `tabTarget` parameter

**Solutions**:

```javascript
// 1. Use unique, descriptive labels
await mcp__browser__browser_set_tab_label({
  tabTarget: tabId,
  label: "amazon-search-wireless-headphones"  // Specific
});

// NOT:
// label: "search"  // Too generic

// 2. Store tab IDs in a map
const tabMap = {
  amazon: 123,
  walmart: 456,
  bestbuy: 789
};

// 3. Always specify tabTarget explicitly
await mcp__browser__browser_navigate({
  url: url,
  tabTarget: tabMap.amazon  // Explicit
});

// 4. List tabs to verify
const tabs = await mcp__browser__browser_list_attached_tabs();
console.log("Active tabs:", tabs.content.tabs.map(t => ({
  id: t.tabId,
  label: t.label,
  url: t.url
})));
```

### Error: "Session state lost"

**Symptoms**: Login lost, cookies missing, cart empty

**Causes**:
- Using different tab for authenticated operations
- Tab was closed and recreated

**Solutions**:

```javascript
// ❌ DON'T: Create new tab for authenticated operation
const newTab = await mcp__browser__browser_create_tab({ url: profileUrl });
// Cookies and session lost!

// ✅ DO: Reuse tab where you logged in
await mcp__browser__browser_navigate({
  url: profileUrl,
  tabTarget: authenticatedTabId  // Preserves session
});

// Store authenticated tab ID
const authTabId = loginTabId;

// Use same tab for all authenticated operations
await mcp__browser__browser_navigate({ url: "/profile", tabTarget: authTabId });
await mcp__browser__browser_navigate({ url: "/cart", tabTarget: authTabId });
```

---

## Macro Execution Issues

### Error: "Macro not found"

**Symptoms**: `browser_execute_macro` returns "Macro not found"

**Causes**:
- Macro doesn't exist
- Wrong macro ID
- MongoDB not running

**Solutions**:

```javascript
// 1. List available macros
const siteMacros = await mcp__browser__browser_list_macros({
  site: "amazon.com"
});
console.log("Site macros:", siteMacros.content.macros);

const universalMacros = await mcp__browser__browser_list_macros({
  site: "*"
});
console.log("Universal macros:", universalMacros.content.macros);

// 2. Check MongoDB is running
docker compose ps mongodb

// 3. Verify macro ID is correct
// Use exact ID from list_macros result

// 4. Fall back to direct tools if macro doesn't exist
if (siteMacros.content.macros.length === 0) {
  // Use direct browser tools instead
  await mcp__browser__browser_navigate({ url: url });
  await mcp__browser__browser_snapshot();
}
```

### Error: "Macro execution failed"

**Symptoms**: Macro runs but returns error or unexpected results

**Causes**:
- Page structure changed
- Element not found
- JavaScript error in macro code

**Solutions**:

```javascript
// 1. Check console logs for errors
const logs = await mcp__browser__browser_get_console_logs();
console.log("Console errors:", logs.content.logs.filter(l => l.type === "error"));

// 2. Take screenshot to see page state
const screenshot = await mcp__browser__browser_screenshot();

// 3. Get page snapshot to verify elements
const snapshot = await mcp__browser__browser_snapshot();

// 4. Try alternative approach
// If macro fails, use direct tools:
const element = await mcp__browser__browser_query_dom({
  selector: ".product-title"
});

if (element.content.elements.length > 0) {
  await mcp__browser__browser_click({
    element: "Product title",
    ref: element.content.elements[0].ref
  });
}

// 5. Update or recreate macro if page structure changed
// (Use macro training agent or manual update)
```

### Error: "Macro parameter error"

**Symptoms**: "Invalid parameter" or "Missing required parameter"

**Causes**:
- Wrong parameter type
- Missing required parameter
- Extra unexpected parameter

**Solutions**:

```javascript
// 1. Check macro definition
const macros = await mcp__browser__browser_list_macros({ site: "*" });
const targetMacro = macros.content.macros.find(m => m.id === "amazon_search");
console.log("Parameters:", targetMacro.parameters);

// 2. Ensure correct parameter types
await mcp__browser__browser_execute_macro({
  id: "amazon_search",
  params: {
    query: "headphones"  // String, not number or object
  }
});

// 3. Include all required parameters
// Check macro documentation in MACROS.md

// 4. Remove unexpected parameters
// Only include params defined in macro
```

---

## Form Automation Issues

### Error: "Form not found"

**Symptoms**: `discover_forms` returns empty array

**Causes**:
- Page not fully loaded
- Form in iframe
- Form dynamically rendered

**Solutions**:

```javascript
// 1. Wait for page to load
await mcp__browser__browser_wait({ time: 3 });

// 2. Check for iframes
const iframes = await mcp__browser__browser_query_dom({
  selector: "iframe"
});

if (iframes.content.elements.length > 0) {
  console.log("Forms may be in iframe - iframe handling not yet supported");
}

// 3. Try discovering after scrolling
await mcp__browser__browser_scroll({ y: 1000 });
await mcp__browser__browser_wait({ time: 1 });

const forms = await mcp__browser__browser_execute_macro({
  id: "discover_forms"
});

// 4. Use query_dom to find form manually
const formElements = await mcp__browser__browser_query_dom({
  selector: "form"
});
console.log("Forms found:", formElements.content.elements.length);
```

### Error: "Field is required"

**Symptoms**: Validation error on submit, "This field is required"

**Causes**:
- Missing required field
- Field not filled correctly
- Hidden required field

**Solutions**:

```javascript
// 1. Analyze form requirements first
const analysis = await mcp__browser__browser_execute_macro({
  id: "analyze_form_requirements",
  params: { formSelector: "#contact-form" }
});

console.log("Required fields:", analysis.content.fields.filter(f => f.required));

// 2. Check all required fields are filled
const requiredFields = analysis.content.fields.filter(f => f.required);
const missingFields = requiredFields.filter(f => !data[f.name]);

if (missingFields.length > 0) {
  console.log("Missing required fields:", missingFields.map(f => f.label));
  // Fill missing fields or ask user for data
}

// 3. Check for hidden fields
const hiddenFields = analysis.content.fields.filter(f => f.type === "hidden");
console.log("Hidden fields:", hiddenFields);

// 4. Verify field values before submit
const formValues = await mcp__browser__browser_execute_macro({
  id: "get_form_values"
});
console.log("Current values:", formValues.content);
```

### Error: "Validation failed"

**Symptoms**: "Please enter a valid email" or similar validation errors

**Causes**:
- Invalid format (email, phone, date)
- Value doesn't match pattern
- Client-side validation

**Solutions**:

```javascript
// 1. Check validation rules
const analysis = await mcp__browser__browser_execute_macro({
  id: "analyze_form_requirements"
});

console.log("Validation patterns:", analysis.content.fields.map(f => ({
  name: f.name,
  pattern: f.pattern,
  type: f.type
})));

// 2. Use correct format
// Email: user@domain.com
// Phone: (555) 555-5555 or 555-555-5555
// Date: MM/DD/YYYY or YYYY-MM-DD

// 3. Detect validation messages
const messages = await mcp__browser__browser_execute_macro({
  id: "detect_messages"
});

console.log("Validation errors:", messages.content.errors);

// 4. Fix errors and retry
for (const error of messages.content.errors) {
  // Parse error message to identify field
  // Apply fix
  // Retry
}
```

---

## Scraping Issues

### Error: "No data extracted"

**Symptoms**: Empty results from extraction macros

**Causes**:
- Wrong selector
- Data not loaded yet
- Page structure different than expected

**Solutions**:

```javascript
// 1. Wait for data to load
await mcp__browser__browser_wait({ time: 3 });

// 2. Check if AJAX is still loading
const networkState = await mcp__browser__browser_get_network_state();
console.log("Network state:", networkState);

// 3. Try scrolling to trigger lazy loading
await mcp__browser__browser_scroll({ y: 1000 });
await mcp__browser__browser_wait({ time: 2 });

// 4. Use query_dom to find elements manually
const elements = await mcp__browser__browser_query_dom({
  selector: ".product-item"
});

console.log("Elements found:", elements.content.elements.length);

// 5. Get visible text to verify data is present
const text = await mcp__browser__browser_get_visible_text({
  maxLength: 3000
});

console.log("Page text:", text.content.text.substring(0, 500));
```

### Error: "Duplicate data"

**Symptoms**: Same items appearing multiple times in results

**Causes**:
- Pagination overlap
- Infinite scroll duplicates
- Multiple extraction calls

**Solutions**:

```javascript
// Use deduplication helper
function deduplicateData(data, keyField = "id") {
  const seen = new Set();
  return data.filter(item => {
    const key = keyField ? item[keyField] : JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Apply after aggregation
const allData = [];
// ... extract from multiple pages ...
const uniqueData = deduplicateData(allData, "productId");

// Or use URL as dedup key
const uniqueByUrl = deduplicateData(allData, "url");
```

### Error: "Pagination not working"

**Symptoms**: Can't navigate to next page, stuck on page 1

**Causes**:
- Next button not found
- AJAX pagination
- Infinite scroll instead of pagination

**Solutions**:

```javascript
// 1. Detect pagination type
const pagination = await mcp__browser__browser_execute_macro({
  id: "detect_pagination"
});

console.log("Pagination type:", pagination.content);

if (!pagination.content.hasNextPage) {
  // Check for infinite scroll instead
  const infiniteScroll = await mcp__browser__browser_execute_macro({
    id: "detect_infinite_scroll"
  });

  if (infiniteScroll.content.hasInfiniteScroll) {
    // Use scroll-based pagination
    await mcp__browser__browser_scroll({ y: 1000 });
    await mcp__browser__browser_wait({ time: 2 });
  }
}

// 2. If next button exists but click fails
if (pagination.content.hasNextPage) {
  // Try clicking with realistic mouse movement
  await mcp__browser__browser_realistic_click({
    x: pagination.content.nextButtonPosition.x,
    y: pagination.content.nextButtonPosition.y
  });

  // Or try pressing Enter after focusing
  await mcp__browser__browser_press_key({ key: "Enter" });
}

// 3. Check if URL-based pagination
// Look for ?page=2 in URL
const currentUrl = await mcp__browser__browser_evaluate({
  expression: "window.location.href"
});

if (currentUrl.content.includes("page=")) {
  // Navigate directly to next page URL
  const nextPage = parseInt(currentUrl.match(/page=(\d+)/)[1]) + 1;
  const nextUrl = currentUrl.replace(/page=\d+/, `page=${nextPage}`);
  await mcp__browser__browser_navigate({ url: nextUrl });
}
```

---

## Performance Issues

### Error: "Operations timing out"

**Symptoms**: Tools take too long, timeout errors

**Causes**:
- Slow page load
- Large snapshots
- Too many parallel operations

**Solutions**:

```javascript
// 1. Avoid browser_snapshot for large pages
// Use targeted extraction instead:
const text = await mcp__browser__browser_get_visible_text({
  maxLength: 3000  // Truncate
});

// 2. Use macros instead of snapshots
const products = await mcp__browser__browser_execute_macro({
  id: "amazon_get_listing_products"  // Fast, targeted
});

// 3. Limit parallel operations
const MAX_CONCURRENT = 5;
const chunks = chunkArray(urls, MAX_CONCURRENT);

for (const chunk of chunks) {
  await Promise.all(chunk.map(url => processUrl(url)));
}

// 4. Increase timeout for slow operations
// (Not directly supported, but can wrap in timeout)
const result = await Promise.race([
  performOperation(),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), 60000)
  )
]);
```

### Error: "Memory issues"

**Symptoms**: Browser sluggish, high memory usage

**Causes**:
- Too many tabs open
- Large screenshots in memory
- Not cleaning up tabs

**Solutions**:

```javascript
// 1. Clean up tabs after use
try {
  // ... operations ...
} finally {
  for (const tab of tabs) {
    await mcp__browser__browser_detach_tab({ tabId: tab.tabId });
  }
}

// 2. Limit concurrent tabs
const MAX_TABS = 5;

// 3. Export large data to files instead of returning
const fs = require('fs');
fs.writeFileSync('/tmp/export.json', JSON.stringify(largeData));

return {
  exportPath: '/tmp/export.json',
  summary: { totalItems: largeData.length }
};

// 4. Clear cache periodically
await mcp__browser__browser_clear_cache();
```

---

## Authentication Issues

### Error: "Login failed"

**Symptoms**: Can't authenticate, stuck on login page

**Causes**:
- CAPTCHA present
- Two-factor authentication
- Bot detection
- Wrong credentials

**Solutions**:

```javascript
// 1. Check for CAPTCHA
const text = await mcp__browser__browser_get_visible_text();

if (text.content.text.toLowerCase().includes("captcha")) {
  console.log("CAPTCHA detected - manual intervention required");

  // Request user to solve CAPTCHA
  const userAction = await mcp__browser__browser_request_user_action({
    request: "Please solve the CAPTCHA to continue",
    timeout: 300  // 5 minutes
  });

  // Continue after user completes
}

// 2. Check for 2FA
if (text.content.text.toLowerCase().includes("verification code")) {
  console.log("2FA required - requesting user assistance");

  // User must enter 2FA code
  const userAction = await mcp__browser__browser_request_user_action({
    request: "Please enter your 2FA code",
    timeout: 300
  });
}

// 3. Use realistic typing to avoid bot detection
await mcp__browser__browser_realistic_type({
  text: username,
  minDelay: 80,
  maxDelay: 150,
  mistakeChance: 0.02  // Occasional typos
});

// 4. Add delays between actions
await mcp__browser__browser_wait({ time: 1 });

// 5. Move mouse realistically
await mcp__browser__browser_realistic_mouse_move({
  x: submitButtonX,
  y: submitButtonY,
  duration: 500
});
```

### Error: "Session expired"

**Symptoms**: Logged out unexpectedly, operations fail

**Causes**:
- Cookie expiration
- Tab closed/recreated
- Session timeout

**Solutions**:

```javascript
// 1. Check cookies
const cookies = await mcp__browser__browser_get_cookies({
  url: "https://example.com"
});

console.log("Session cookies:", cookies.content.cookies.filter(c =>
  c.name.includes("session") || c.name.includes("auth")
));

// 2. Preserve session by reusing same tab
// Store authenticated tab ID
const authTabId = loginTabId;

// Always use same tab for authenticated operations
await mcp__browser__browser_navigate({
  url: "/profile",
  tabTarget: authTabId
});

// 3. Set cookies manually if needed
await mcp__browser__browser_set_cookie({
  url: "https://example.com",
  name: "session_token",
  value: sessionToken,
  expirationDate: Date.now() / 1000 + 3600  // 1 hour
});

// 4. Re-authenticate if session lost
const isLoggedIn = await checkLoginStatus(tabId);

if (!isLoggedIn) {
  await performLogin(tabId, credentials);
}
```

---

## Extension Issues

### Error: "Extension not loaded"

**Symptoms**: MCP tools fail, extension not visible in Chrome

**Causes**:
- Extension not installed
- Extension disabled
- Chrome in headless mode

**Solutions**:

```bash
# 1. Verify extension is installed
# Open chrome://extensions/ in Chrome
# Look for "Browser MCP Extension"

# 2. Enable extension if disabled
# Toggle switch to "On"

# 3. Check extension ID
# Copy extension ID from chrome://extensions/

# 4. Reload extension
# Click reload button on chrome://extensions/

# 5. Check extension logs
# Click "Errors" button on extension card
# Look for JavaScript errors
```

### Error: "Extension disconnected"

**Symptoms**: Extension shows "Disconnected", operations fail

**Causes**:
- Extension lost connection to server
- Server restarted
- Network issue

**Solutions**:

```javascript
// 1. Check server is running
docker compose ps

// 2. Reconnect via extension popup
// Click extension icon → Click "Connect"

// 3. Check WebSocket URL in extension settings
// Should be: ws://localhost:9010/ws

// 4. Check for firewall/antivirus blocking WebSocket

// 5. Restart browser if connection persists
```

---

## Database Issues

### Error: "MongoDB connection failed"

**Symptoms**: Macros fail to load, "Database error"

**Causes**:
- MongoDB container not running
- Connection string wrong
- Database authentication failed

**Solutions**:

```bash
# 1. Check MongoDB is running
docker compose ps mongodb

# Expected: Up status

# 2. Check MongoDB logs
docker compose logs mongodb

# 3. Verify connection from server
docker compose exec app mongosh mongodb://mongodb:27017/browser-mcp

# 4. Restart MongoDB
docker compose restart mongodb

# 5. Check database collections
docker compose exec app mongosh mongodb://mongodb:27017/browser-mcp \
  --eval "db.macros.countDocuments()"

# Should return count > 0 if macros are stored
```

### Error: "Macro collection empty"

**Symptoms**: No macros found, `list_macros` returns empty

**Causes**:
- Database not seeded
- Migration not run
- Wrong database

**Solutions**:

```bash
# 1. Check if macros exist
docker compose exec app mongosh mongodb://mongodb:27017/browser-mcp \
  --eval "db.macros.find().limit(5)"

# 2. Seed macros if empty
# (Run seed script or import macros)

# 3. Verify correct database
docker compose exec app mongosh mongodb://mongodb:27017/browser-mcp \
  --eval "db.getName()"

# Should return: browser-mcp
```

---

## General Debugging

### Enable Verbose Logging

```bash
# 1. Server logs
docker compose logs -f app

# 2. Extension logs
# Open extension popup → Right-click → "Inspect"
# Check Console tab

# 3. Browser console logs
const logs = await mcp__browser__browser_get_console_logs();
console.log(logs.content.logs);

# 4. Network logs
const networkLogs = await mcp__browser__browser_get_network_logs();
console.log(networkLogs.content);
```

### Take Diagnostic Screenshots

```javascript
// Before operation
const before = await mcp__browser__browser_screenshot();

// Perform operation
// ...

// After operation
const after = await mcp__browser__browser_screenshot();

// Compare to identify issues
```

### Inspect Page State

```javascript
// 1. Get ARIA snapshot
const snapshot = await mcp__browser__browser_snapshot();
console.log("Page structure:", snapshot.content);

// 2. Get visible text
const text = await mcp__browser__browser_get_visible_text({
  maxLength: 3000
});
console.log("Visible text:", text.content.text);

// 3. Query specific elements
const elements = await mcp__browser__browser_query_dom({
  selector: ".error-message"
});
console.log("Error messages:", elements.content.elements);

// 4. Check element visibility
const visibility = await mcp__browser__browser_check_visibility({
  selector: "#submit-button"
});
console.log("Submit button visible:", visibility.content.isVisible);
```

### Test Individual Tools

```javascript
// Test navigation
await mcp__browser__browser_navigate({
  url: "https://example.com"
});

// Test snapshot
const snapshot = await mcp__browser__browser_snapshot();

// Test click
const button = await mcp__browser__browser_query_dom({
  selector: "button"
});

await mcp__browser__browser_click({
  element: "Button",
  ref: button.content.elements[0].ref
});

// Verify each step works individually
```

---

## Common Error Messages

### "Element not found"

**Solution**: Wait for element to load, check selector, verify page structure

### "Permission denied"

**Solution**: Check extension permissions, reload extension, verify site permissions

### "Timeout waiting for element"

**Solution**: Increase wait time, check if element exists, verify page loaded

### "JavaScript error in macro"

**Solution**: Check console logs, update macro code, verify page structure

### "Network error"

**Solution**: Check internet connection, verify URL is valid, check CORS issues

### "Invalid selector"

**Solution**: Verify CSS selector syntax, test in browser devtools, escape special characters

---

## Getting Help

**If issue persists:**

1. **Check documentation**:
   - [MACROS.md](./MACROS.md) - Macro reference
   - [MULTI_TAB.md](./MULTI_TAB.md) - Multi-tab patterns
   - [../agents/README.md](../agents/README.md) - Agent documentation

2. **Enable debug logging**:
   ```bash
   docker compose logs -f
   ```

3. **Collect diagnostics**:
   - Server logs
   - Extension console logs
   - Browser console logs
   - Screenshot of error state
   - Network logs

4. **Report issue** on GitHub with:
   - Error message
   - Steps to reproduce
   - Expected vs actual behavior
   - Diagnostic information

5. **Community support**:
   - Check GitHub issues for similar problems
   - Ask in discussions forum
   - Provide minimal reproducible example
