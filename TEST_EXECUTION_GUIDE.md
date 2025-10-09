# Browser MCP Test Execution Guide

## Current Status

The browser-mcp refactor branch has:
- ✅ Background recording system implemented
- ✅ Three new MCP tools (get/prune/search interactions)
- ✅ HTTP/WebSocket server running with hot reload
- ✅ Service management infrastructure (PM2/systemd)
- ⚠️  **Browser MCP tools not loaded in current Claude Code session**

## Why Tests Can't Run Yet

The browser MCP server is configured in `~/.claude/mcp/browser.json` and points to the built files. However, this Claude Code session started before the latest build, so the browser MCP tools aren't available in the current session.

## How to Run the Test Suite

### Option 1: Restart Claude Code (Recommended)

1. **Exit the current Claude Code session**:
   ```bash
   exit
   ```

2. **Ensure the HTTP/WebSocket server is running**:
   ```bash
   cd /mnt/nas/data/code/forks/browser-mcp
   ./service.sh status
   ```

   If not running:
   ```bash
   ./service.sh dev
   ```

3. **Start a new Claude Code session**:
   ```bash
   claude
   ```

4. **Verify browser MCP tools are loaded**:
   Ask Claude Code: "list all available browser MCP tools"

   You should see tools like:
   - `browser_get_interactions`
   - `browser_prune_interactions`
   - `browser_search_interactions`
   - `browser_snapshot`
   - `browser_click`
   - etc.

5. **Run the test suite**:
   ```
   Run the browser MCP test suite from TEST_SUITE.md
   ```

### Option 2: Manual Testing (Current Session)

Since the MCP tools aren't loaded, you can test manually by:

1. **Ensure extension is connected** (should show in browser console):
   ```
   [WebSocket] Connected
   ```

2. **Generate test interactions** by using the browser:
   - Click buttons and links
   - Scroll the page
   - Type into input fields
   - Navigate between pages

3. **Use Chrome DevTools console** to verify:
   ```javascript
   // Check if background capture is running
   chrome.runtime.sendMessage({type: 'GET_STATE'}, (response) => {
     console.log('Connection state:', response);
   });
   ```

4. **Manually verify background recording**:
   - Open the extension popup
   - Check connection status
   - Perform various interactions
   - Verify they're being captured

## Server Management

The HTTP/WebSocket server is now running with service management:

### Development Mode (Current)
```bash
./service.sh dev     # Running with hot reload
./service.sh status  # Check if running
```

### Production Mode (PM2)
```bash
./service.sh start   # Start with PM2
./service.sh logs    # View logs
./service.sh restart # Restart server
./service.sh stop    # Stop server
```

### Production Mode (systemd)
```bash
./service.sh systemd-install  # One-time setup
./service.sh systemd-start    # Start service
./service.sh systemd-logs     # View logs
./service.sh systemd-stop     # Stop service
```

## Test Suite Structure

The test suite in `TEST_SUITE.md` contains 10 categories:

1. **Connection & State** (2 tests) - Basic connectivity
2. **Background Interaction Log** (5 tests) - New refactored tools ⭐
3. **Navigation** (3 tests) - Page navigation
4. **DOM Exploration** (5 tests) - DOM querying
5. **Interaction** (4 tests) - Click, hover, scroll
6. **Screenshot & Console** (3 tests) - Screenshots, logs
7. **Tab Management** (4 tests) - Tab operations
8. **Advanced Interaction Log** (4 tests) - Time ranges, patterns ⭐
9. **Edge Cases** (3 tests) - Error handling
10. **Recording/Demonstration** (2 tests) - Legacy recording UI

**Total: 33 test cases**

## Prerequisites for Testing

1. **Chrome browser** with extension loaded
2. **Extension connected** to WebSocket (ws://localhost:9009)
3. **Browser MCP tools available** in Claude Code
4. **Test page open** with interactive elements (Amazon, GitHub, etc.)

## Expected Workflow

1. Restart Claude Code → loads browser MCP tools
2. Connect extension → enables background recording
3. Generate interactions → provides test data
4. Run test suite → verifies all 33 test cases
5. Review results → identify any failures
6. Fix issues → iterate as needed

## Next Steps

Choose one:
- **Option A**: Restart Claude Code and run automated test suite
- **Option B**: Continue manual testing in current session
- **Option C**: Commit current work and test later

## Files Modified on This Branch

### New Files
- `extension/background-interaction-capture.js` - Background capture script
- `SERVICE.md` - Service management documentation
- `service.sh` - Service management script
- `ecosystem.config.js` - PM2 configuration
- `browser-mcp.service` - systemd service file
- `TEST_SUITE.md` - Comprehensive test suite
- `TESTING.md` - Testing guide
- `test-runner.js` - Automated test framework (skeleton)
- `run-tests.sh` - Test execution script

### Modified Files
- `src/tools/interactions.ts` - New interaction log tools
- `src/types/tool-schemas.ts` - Tool schema definitions
- `src/types/messaging.ts` - Message type definitions
- `extension/background.js` - BackgroundRecorder class
- `src/index.ts` - Tool registration
- `nodemon.json` - Enhanced for hot reload
- `.gitignore` - Added logs exclusion

## Service Status

Currently running:
```
[HTTP] WebSocket server ready on ws://localhost:9009
[HTTP] Browser MCP server listening on http://localhost:3010
[nodemon] watching path(s): src/**/* extension/**/*
```

Auto-restart enabled: Changes to src/ or extension/ trigger rebuild and restart.
