# Testing Guide for unibrowse

## Overview

unibrowse has a comprehensive test suite to validate all tools and features. Testing can be done manually or through automated execution.

## Quick Start

### Manual Testing (Recommended)

**Step 1: Prerequisites**
- Load extension in Chrome (`chrome://extensions`)
- Reload the extension after building
- Open a tab with interactive content (Amazon, GitHub, etc.)
- Connect to the tab using the MCP extension

**Step 2: Run Tests**
Ask Claude Code to execute:
```
Run the browser MCP test suite
```

Claude will systematically run through all tests in `TEST_SUITE.md` and report results.

### Quick Mode (Essential Tests Only)
```
Run the browser MCP test suite in quick mode
```

Skips:
- Navigation tests (to avoid disrupting current page)
- Demonstration recording tests (require user interaction)

## Test Categories

### 1. **Background Interaction Log** (NEW!)
Tests the continuous recording system:
- Query recent interactions
- Filter by time range (including negative offsets)
- Filter by interaction type
- Search by text
- Prune old interactions

### 2. **DOM Exploration**
- Query elements by selector
- Count elements
- Get visible text
- Find by text content
- Get filtered ARIA tree

### 3. **Basic Interactions**
- Click, hover, drag
- Type text, press keys
- Scroll, select options

### 4. **Navigation**
- Navigate to URLs
- Go back/forward
- Handle page changes

### 5. **Tab Management**
- List tabs
- Create/close tabs
- Switch between tabs

### 6. **Screenshots & Logs**
- Take screenshots
- Get console logs
- Get network logs

### 7. **Demonstrations**
- Request user demonstrations
- Test timeout handling
- Verify overlay persistence

## Test Files

```
docs/TEST_SUITE.md       Comprehensive manual test plan with expected results
scripts/run-tests.sh     Simple runner script (displays instructions)
tests/test-runner.js     Automated test framework (WIP - future enhancement)
```

## Running Tests Manually

Follow `TEST_SUITE.md` step by step:

1. Navigate to the section you want to test
2. Copy the tool call
3. Execute through Claude Code
4. Verify expected results
5. Mark as ✅ pass or ❌ fail

## Expected Test Duration

- **Full Suite**: ~5-10 minutes (including demonstrations)
- **Quick Mode**: ~2-3 minutes
- **Single Category**: ~30-60 seconds

## Interpreting Results

### Success Indicators
- ✅ Tool returns expected data structure
- ✅ No errors or exceptions
- ✅ State changes occur as expected (navigation, clicks, etc.)
- ✅ Background log captures interactions

### Common Issues

**Tool returns error**
- Check if extension is connected
- Verify page is fully loaded
- Check console for WebSocket errors

**Empty results from interaction log**
- May need to interact with page first
- Check buffer hasn't been cleared
- Verify background capture is injected

**Timeout errors**
- Page may be slow to load
- Network issues
- Increase timeout parameter

**Demonstration overlay doesn't appear**
- Check if overlay script injected
- Look for console errors
- Verify page allows script injection

## Automated Testing (Future)

The `test-runner.js` framework is planned for CI/CD integration:

```bash
# Run full automated suite
node test-runner.js

# Quick mode for CI
node test-runner.js --quick
```

Currently a skeleton - needs MCP SDK integration to actually call tools.

## Adding New Tests

When adding new MCP tools:

1. Add test case to `TEST_SUITE.md`
2. Include in appropriate category
3. Document expected results
4. Add edge cases if relevant

Format:
```markdown
### X.Y Tool Name
\`\`\`
tool_name({ args: values })
\`\`\`
**Expected**: What should happen
```

## Regression Testing

Run full test suite after:
- Adding new features
- Refactoring core components
- Updating Chrome extension manifest
- Changing WebSocket communication
- Modifying interaction capture

## Performance Benchmarks

Track these metrics:
- **Background capture overhead**: <5% CPU impact
- **Tool response time**: <100ms for most tools
- **Snapshot generation**: <2s for large pages
- **Interaction log query**: <50ms for 500 interactions

## CI/CD Integration (Planned)

Future automated testing pipeline:
1. Build extension
2. Start headless Chrome
3. Load extension
4. Connect to test page
5. Run test-runner.js
6. Report results
7. Fail build if tests fail

## Contributing Tests

When submitting PRs:
- Add tests for new features
- Update TEST_SUITE.md
- Ensure all existing tests pass
- Document any new test requirements
