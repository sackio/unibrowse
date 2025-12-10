# unibrowse Testing Guide

This guide explains how to run the unibrowse test suites to validate functionality.

## Prerequisites

1. **Extension Loaded**: unibrowse extension must be installed and loaded in Chrome
2. **Server Running**: MCP server must be running (HTTP mode on port 9010)
3. **Tab Attached**: At least one browser tab must be attached via the extension popup

## Starting the Server

```bash
# Start the HTTP server
npm start

# Or in development mode with auto-reload
npm run dev
```

The server will start on `http://localhost:9010` with WebSocket endpoint at `ws://localhost:9010/ws`.

## Test Suites

### 1. Comprehensive Test Suite (`test-all-tools.js`)

Tests all 76 tools across 18 categories including multi-tab management, window creation, and macro functionality.

**Run:**
```bash
npm test
```

**What it tests:**
- Cookie Management (4 tools)
- Download Management (4 tools)
- Clipboard (2 tools)
- History (4 tools)
- System Information (3 tools)
- Network (3 tools)
- Bookmarks (4 tools)
- Extension Management (4 tools)
- **Multi-Tab Management (5 tools)** ← New!
- **Window Management (3 tools)** ← New!
- Core Tools (navigation, snapshots, etc.)

**Expected Output:**
```
═══════════════════════════════════════════════════════
  BROWSER MCP COMPREHENSIVE TEST SUITE
  Testing all 76 tools across 18 categories
═══════════════════════════════════════════════════════

✓ PASSED:  XX tests
✗ FAILED:  X tests
⊘ SKIPPED: X tests
```

### 2. Multi-Tab Management Test Suite (`test-multi-tab.js`)

Dedicated test suite for multi-tab features with comprehensive coverage of all multi-tab scenarios.

**Run:**
```bash
npm run test:multi-tab
```

**What it tests:**

#### Section 1: Basic Tab Management
- List attached tabs
- Get active tab
- Verify active tab indicator
- Tab metadata (ID, label, title, URL)

#### Section 2: Label Management
- Set custom labels by tab ID
- Set labels by label reference
- Verify label changes
- Restore original labels
- Duplicate label rejection

#### Section 3: Tab Targeting
- Navigate using tab ID
- Navigate using label
- Screenshot with tabTarget
- Snapshot with tabTarget
- Default to active tab (no tabTarget specified)

#### Section 4: Active Tab Tracking
- Active tab switches on tool use
- Only one tab marked as active at a time
- Last-used tab tracking

#### Section 5: Concurrent Operations
- Rapid sequential operations on different tabs
- Parallel screenshot capture

#### Section 6: Error Handling
- Invalid tab ID rejection
- Invalid label rejection
- Clear error messages

**Expected Output:**
```
╔═══════════════════════════════════════════════════════════════╗
║           BROWSER MCP MULTI-TAB MANAGEMENT TEST SUITE        ║
╚═══════════════════════════════════════════════════════════════╝

✓ PASSED:  18/18
✗ FAILED:  0/18
⊘ SKIPPED: 0/18

Pass Rate: 100.0%

🎉 ALL MULTI-TAB TESTS PASSED! 🎉
```

### 3. Utility Macros Test Suite (`test-utility-macros.js`)

Comprehensive test suite for the utility macros system, testing macro storage, listing, and execution on real websites.

**Run:**
```bash
npm run test:utility-macros
```

**What it tests:**

#### Phase 1: Macro Storage
- Store 4 core utility macros in database
- Verify macros are stored with correct metadata
- Test duplicate detection (macros already exist)

#### Phase 2: Macro Discovery
- List all universal macros (site: *)
- Verify macro count and metadata
- Check macro organization by category

#### Phase 3: Macro Execution
- Execute macros on simple page (example.com)
- Execute macros on complex page (github.com)
- Test `get_interactive_elements` macro
- Test `discover_forms` macro
- Test `detect_messages` macro
- Test `find_element_by_description` macro
- Verify macro results match expected structure
- Automatic tab attachment if no tabs connected

**Expected Output:**
```
═══════════════════════════════════════════════════════════════
  BROWSER MCP UTILITY MACROS TEST SUITE
  Comprehensive testing of macro storage and execution
═══════════════════════════════════════════════════════════════

Phase 1: Macro Storage
  ✓ Store: get_interactive_elements
  ✓ Store: discover_forms
  ✓ Store: detect_messages
  ✓ Store: find_element_by_description

Phase 2: Macro Discovery
  ✓ List all universal macros
  Found 17 macros in database

Phase 3: Macro Execution
  ✓ Execute on example.com
  ✓ Execute on github.com

  Total:  13 tests
  ✓ Pass: 13 tests
  ✗ Fail: 0 tests
  Pass Rate: 100.0%

🎉 ALL TESTS PASSED! 🎉
```

**Storing All 17 Utility Macros:**

To store the full set of 17 utility macros from `macros/utility-macros.js`:
```bash
npm run store:macros
```

This will store all macros organized in 4 tiers:
- **Tier 1** (4 macros): Most useful - interactive elements, forms, messages, element search
- **Tier 2** (4 macros): High value - tables, form state, modals, visibility checks
- **Tier 3** (6 macros): Navigation & content - waiting, dropdowns, breadcrumbs, pagination, clickables, change detection
- **Tier 4** (3 macros): Cleanup - modal closing, interruption dismissal, page cleanup

### 4. Advanced Macros Test Suite (`test-advanced-macros.js`)

Comprehensive test suite for the advanced macros system with 24 sophisticated macros for content analysis, performance testing, and accessibility auditing.

**Run:**
```bash
npm run test:advanced-macros
```

**What it tests:**

#### Phase 1: Macro Discovery & Storage Verification
- List all universal macros from database
- Verify all 24 advanced macros are stored
- Check for specific macros: extract_main_content, detect_page_load_state, audit_accessibility, etc.

#### Phase 2: Tab Management
- Check for attached tabs
- Auto-attach to new tab if needed
- Navigate to test pages

#### Phase 3: Testing Tier 1 Macros (Most Valuable)
- **extract_main_content**: Extract article content with word count and reading time
- **detect_page_load_state**: Detect loading state, network activity, resource loading
- **audit_accessibility**: Run WCAG 2.1 accessibility audit
- **find_search_functionality**: Locate site search functionality

#### Phase 4: Testing Tier 2 Macros (Performance & Analysis)
- **measure_page_performance**: Comprehensive performance metrics
- **get_page_outline**: Extract document heading structure
- **analyze_images**: Analyze images for alt text, dimensions, lazy loading

#### Phase 5: Testing on Complex Page (GitHub)
- Navigate to github.com
- **detect_tracking_scripts**: Detect analytics and tracking scripts

#### Phase 6: Testing Tier 3 Macros (Advanced Discovery)
- **find_elements_by_position**: Find elements by viewport position
- **find_elements_by_z_index**: Find elements by stacking order
- **detect_loading_indicators**: Detect loading spinners and progress indicators

#### Phase 7: Testing Tier 4 Macros (Navigation & Testing)
- **get_keyboard_navigation_order**: Map keyboard navigation and detect tab traps
- **detect_dark_mode**: Detect dark mode availability
- **measure_viewport_coverage**: Calculate viewport coverage by elements
- **detect_captcha**: Detect CAPTCHA presence and type

**Expected Output:**
```
═══════════════════════════════════════════════════════════════
  BROWSER MCP ADVANCED MACROS TEST SUITE
  Comprehensive testing of 24 advanced macros
═══════════════════════════════════════════════════════════════

Phase 1: Macro Discovery & Storage Verification
  ✓ List all universal macros (Found 41 macros)
  ✓ Find extract_main_content in database
  ✓ Find detect_page_load_state in database
  ... (all 5 key macros verified)

Phase 3: Testing Tier 1 Macros (Most Valuable)
  ✓ Execute extract_main_content (Found content: 19 words, 1 min)
  ✓ Execute detect_page_load_state (Load state: loading, images: 100%)
  ✓ Execute audit_accessibility (A11y score: 100/100, issues: 0)
  ... (all tier 1 macros tested)

Phase 7: Testing Tier 4 Macros (Navigation & Testing)
  ✓ Execute get_keyboard_navigation_order (Focusable: 456, tab traps: 0)
  ✓ Execute detect_dark_mode (Dark mode available: false, active: false)
  ✓ Execute measure_viewport_coverage (Most prominent: main, empty: 48%)
  ✓ Execute detect_captcha (CAPTCHA present: false, type: N/A)

  Total:  24 tests
  ✓ Pass: 24 tests
  ✗ Fail: 0 tests
  Pass Rate: 100.0%

🎉 ALL TESTS PASSED! 🎉
```

**Storing All 24 Advanced Macros:**

To store the full set of 24 advanced macros from `macros/advanced-macros.js`:
```bash
npm run store:advanced-macros
```

This will store all macros organized in 4 tiers:
- **Tier 1** (5 macros): Most valuable - content extraction, page state, accessibility, search, cookie consent
- **Tier 2** (6 macros): Performance & analysis - metrics, outline, text extraction, images, downloads, tracking
- **Tier 3** (7 macros): Advanced discovery - position finding, z-index, form analysis, infinite scroll, loading indicators
- **Tier 4** (6 macros): Navigation & testing - keyboard nav, dark mode, viewport coverage, CAPTCHA, selectors, visual regression

See `macros/ADVANCED_MACROS.md` for complete documentation of all 24 macros.

### 5. Window Creation Test Suite (`test-create-window.js`)

Dedicated test suite for the new window creation functionality with comprehensive testing of window creation options.

**Run:**
```bash
npm run test:window
```

**What it tests:**

#### Test 1: Single URL Window
- Creates window with single URL
- Verifies focused state
- Validates window ID and tab information

#### Test 2: Multiple URLs Window
- Creates window with multiple URLs (opens multiple tabs)
- Tests custom dimensions (width/height)
- Verifies correct number of tabs created

#### Test 3: Blank Window
- Creates window with no URL (about:blank)
- Tests default window behavior
- Validates blank tab creation

#### Test 4: Custom Dimensions
- Creates window with specific width and height
- Tests window size customization

#### Test 5: Incognito Mode
- Creates incognito/private window
- Verifies incognito flag
- Tests unfocused window creation

**Expected Output:**
```
═══════════════════════════════════════════════════════
  WINDOW CREATION TEST SUITE
  Testing browser_create_window functionality
═══════════════════════════════════════════════════════

Test 1: Create window with single URL
  ✓ PASS

Test 2: Create window with multiple URLs
  ✓ PASS

Test 3: Create blank window (default)
  ✓ PASS

Test 4: Create window with custom dimensions
  ✓ PASS

Test 5: Create incognito window
  ✓ PASS

  Total:  5 tests
  ✓ Pass: 5 tests
  ✗ Fail: 0 tests
  Pass Rate: 100.0%

🎉 ALL TESTS PASSED! 🎉
```

## Test Setup Recommendations

### For Full Test Coverage

To get the most comprehensive test results:

1. **Attach Multiple Tabs** (2-3 recommended):
   - Open 2-3 different websites in separate tabs
   - Click each tab in the extension popup to attach them
   - This enables multi-tab testing scenarios

2. **Use Different Domains**:
   - Example: github.com, example.com, amazon.com
   - This tests auto-generated label uniqueness

3. **Ensure Stable Connection**:
   - Keep the extension popup open while testing
   - Don't navigate away from attached tabs during tests

### For Quick Validation

If you just want to verify basic functionality:

1. **Attach One Tab**:
   - Navigate to any interactive website (e.g., example.com)
   - Attach to the tab via extension popup

2. **Run Comprehensive Suite**:
   - `npm test`
   - Some multi-tab tests will be skipped but core functionality will be validated

## Manual Testing

For manual testing using the extension popup UI, see:
- [docs/MULTI_TAB_TESTING.md](docs/MULTI_TAB_TESTING.md) - Detailed manual test scenarios

## Troubleshooting

### "No attached tabs found"
**Problem**: Test suite reports no attached tabs.

**Solution**:
1. Open the unibrowse extension popup
2. Click "Connect" if not already connected
3. Click on a tab in the "Browser Windows & Tabs" section to attach to it
4. Verify the tab appears in "Attached Tabs" section
5. Re-run the test suite

### "WebSocket connection error"
**Problem**: Cannot connect to WebSocket server.

**Solution**:
1. Ensure the MCP server is running: `npm start`
2. Check that server is listening on port 9010
3. Verify no firewall is blocking localhost:9010
4. Check server logs for errors

### "Test timeout after 10 seconds"
**Problem**: Individual tests are timing out.

**Solution**:
1. Check that the browser tab hasn't navigated away or crashed
2. Ensure the extension is still connected (check popup)
3. Try reloading the extension
4. Restart the MCP server

### "Debugger detached" errors
**Problem**: Tests fail with debugger detachment errors.

**Solution**:
1. Don't manually interact with attached tabs during testing
2. Avoid opening DevTools on attached tabs
3. Ensure page isn't auto-refreshing
4. Check browser console for extension errors

## Test Results Interpretation

### Pass Rate Calculation
```
Pass Rate = (Passed Tests) / (Passed Tests + Failed Tests) × 100%
```

Note: Skipped tests are excluded from pass rate calculation.

### Common Skipped Tests
Some tests are intentionally skipped to avoid:
- Deleting actual browser history
- Clearing cache
- Modifying extension states
- Downloading files
- Detaching the active tab (which would break the test suite)

This is normal and expected.

### Success Criteria

**Comprehensive Test Suite (`npm test`)**:
- ✅ Pass rate ≥ 95%
- ✅ No critical failures (navigation, snapshot, multi-tab tools)
- ✅ Skipped tests are for destructive operations only

**Multi-Tab Test Suite (`npm run test:multi-tab`)**:
- ✅ Pass rate = 100% (when 2+ tabs attached)
- ✅ All sections pass without errors
- ✅ Active tab tracking works correctly

**Window Creation Test Suite (`npm run test:window`)**:
- ✅ Pass rate = 100%
- ✅ All window creation options work (single URL, multiple URLs, blank, dimensions, incognito)
- ✅ Windows are created with correct properties

## Continuous Integration

To run tests in CI/CD:

```bash
# In CI environment
npm ci                    # Install dependencies
npm run build            # Build TypeScript
npm start &              # Start server in background
sleep 5                  # Wait for server startup
npm test                 # Run comprehensive tests
npm run test:multi-tab   # Run multi-tab tests
npm run test:window      # Run window creation tests
```

Note: CI testing requires a headless Chrome setup with the extension installed.

## Contributing

When adding new features:

1. Add tests to `test-all-tools.js` in the appropriate category
2. If adding multi-tab features, update `test-multi-tab.js`
3. If adding window management features, update `test-create-window.js`
4. Consider creating a dedicated test file for complex new features
5. Update this document with new test scenarios
6. Ensure all tests pass before submitting PR

## Additional Resources

- [docs/MULTI_TAB_TESTING.md](docs/MULTI_TAB_TESTING.md) - Comprehensive manual testing guide
- [docs/TOOLS_REFERENCE.md](docs/TOOLS_REFERENCE.md) - Complete API reference
- [README.md](README.md) - Project overview
