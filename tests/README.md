# Browser MCP Tests

This directory contains test suites for Browser MCP functionality.

## Test Files

- **test-all-tools.js** - Comprehensive test suite for all 76 Browser MCP tools
- **test-advanced-macros.js** - Test suite for advanced macros
- **test-utility-macros.js** - Test suite for utility macros
- **test-attach-direct.js** - Test tab attachment functionality
- **test-connection.js** - Test WebSocket connection to Browser MCP
- **test-create-window.js** - Test window creation functionality
- **test-list-tabs.js** - Test listing tabs functionality
- **test-multi-tab.js** - Test multi-tab management features
- **test-runner.js** - Test runner utility
- **test-set-label.js** - Test tab labeling functionality
- **test-simple.js** - Simple smoke tests
- **test-window-creation.js** - Test window creation scenarios

## Running Tests

```bash
# Run all tests
node tests/test-all-tools.js [tool_name] [args...]

# Run specific test suites
node tests/test-connection.js
node tests/test-macros.js

# Run with test runner
node tests/test-runner.js
```

## Documentation

- **TESTING.md** - Comprehensive testing guide and best practices

## Writing Tests

When adding new tests:

1. Name files with `test-` prefix
2. Use descriptive test names
3. Test both success and error cases
4. Clean up resources after tests
5. Document test requirements in comments
