# unibrowse Test Suite

This directory contains automated test suites for the unibrowse server and extension.

## ⚠️ Prerequisites

**IMPORTANT**: Before running any tests, you MUST:

1. **Start the MCP Server**:
   ```bash
   docker compose up -d mcp-server
   ```

2. **Connect a Browser with the Extension**:
   - Open Chrome/Chromium
   - Navigate to `chrome://extensions`
   - Enable "Developer mode" (toggle in top-right)
   - Click "Load unpacked"
   - Select the `extension/` folder in this project
   - Click the unibrowse extension icon in the toolbar
   - Click "Connect" to connect to `ws://localhost:9010/ws`

3. **Verify Prerequisites**:
   ```bash
   npm run test:prereq
   ```

   This will check if both the server and extension are connected.

## Test Suites

### Prerequisites Checker
```bash
npm run test:prereq
```
Verifies that the MCP server is running and the browser extension is connected.
**Run this first before any other tests!**

### Comprehensive Test Suite
```bash
npm test
```
Tests all basic browser automation tools (76 tools total).

### Multi-Tab Management Tests
```bash
npm run test:multi-tab
```
Tests multi-tab management features.

### Window Creation Tests
```bash
npm run test:window
```
Tests window creation functionality with various configurations.

### Utility Macros Tests
```bash
npm run test:utility-macros
```
Tests the 4 core utility macros.

### Advanced Macros Tests
```bash
npm run test:advanced-macros
```
Tests advanced browser automation macros for e-commerce.

## Test Files

- **check-prerequisites.js** - Prerequisites checker (NEW)
- **test-all-tools.js** - Comprehensive test suite for all 76 tools
- **test-advanced-macros.js** - Advanced macros test suite
- **test-utility-macros.js** - Utility macros test suite
- **test-create-window.js** - Window creation tests
- **test-multi-tab.js** - Multi-tab management tests
- **test-attach-direct.js** - Tab attachment tests
- **test-connection.js** - WebSocket connection tests
- **test-list-tabs.js** - Tab listing tests
- **test-runner.js** - Test runner utility
- **test-set-label.js** - Tab labeling tests
- **test-simple.js** - Simple smoke tests
- **test-window-creation.js** - Window creation scenarios

## Architecture

### Test Communication Flow

```
Test Script → MCP Server (port 9010) → Browser Extension
     ↓              ↓                         ↓
  WebSocket    Tool Handler             Chrome APIs
```

### Response Format

All tools return responses in MCP format:
```javascript
{
  content: [
    {
      type: "text",
      text: "JSON string or message"
    }
  ],
  isError: false // or true for errors
}
```

Tests parse the JSON from `content[0].text` to get the actual result.

## Common Issues

### "No connection to browser extension"

**Cause**: The browser extension is not connected to the MCP server.

**Solution**:
1. Ensure Chrome is running with the extension loaded
2. Click the extension icon and click "Connect"
3. Run `npm run test:prereq` to verify connection
4. If still failing, check Docker logs: `docker logs browser-mcp-server`

### "Request timeout"

**Cause**: The MCP server or extension is not responding.

**Solutions**:
- Restart the MCP server: `docker compose restart mcp-server`
- Reload the browser extension
- Check if MongoDB is healthy: `docker ps | grep mongodb`

### "Macro not found"

**Cause**: Macros haven't been stored in MongoDB yet.

**Solution**:
```bash
npm run store:macros           # Store utility macros
npm run store:advanced-macros  # Store advanced macros
```

## Test Cleanup

All test suites automatically clean up resources they create:
- Close tabs opened during testing
- Close windows created during testing
- Disconnect WebSocket connections

The cleanup runs even if tests fail, ensuring a clean state for subsequent test runs.

## Documentation

- **TESTING.md** - Comprehensive testing guide and best practices
- **README.md** - This file

## Writing Tests

When adding new tests:

1. Name files with `test-` prefix
2. Use descriptive test names
3. Test both success and error cases
4. Clean up resources after tests (use `finally` blocks)
5. Handle MCP response format correctly
6. Document test requirements in comments

Example test structure:
```javascript
import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:9010/ws';
let ws;
let createdResources = [];

async function sendMessage(type, payload) {
  // Send message and parse MCP response
}

async function runTests() {
  try {
    // Connect and run tests
  } finally {
    // Clean up resources
  }
}
```

## CI/CD Considerations

These tests currently **require manual setup** (browser with extension connected).

For automated CI/CD, consider:
1. Using Puppeteer/Playwright to launch Chrome with the extension
2. Creating headless test variants
3. Running tests in a container with Xvfb for GUI

## Contributing

When adding new test suites:
- Always include cleanup logic
- Test both success and error cases
- Add descriptive test names
- Include response validation
- Update this README
- Add npm script to package.json

## License

See main project README for license information.
