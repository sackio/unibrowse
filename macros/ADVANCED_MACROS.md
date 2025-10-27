# Browser MCP Advanced Macros

Comprehensive collection of 24 advanced macros for sophisticated browser automation, content analysis, and testing.

## 📦 Storage Status

✅ **All 24 macros are stored in the MongoDB database**

To re-store or update macros:
```bash
npm run store:advanced-macros
```

## 🧪 Testing

Run the comprehensive test suite:
```bash
npm run test:advanced-macros
```

This tests macro storage, listing, and execution on real websites (example.com and github.com).

## 📚 Macro Catalog

### Tier 1: Most Valuable Macros (5)

These are the highest-impact macros for content extraction, accessibility, and page state analysis.

#### 1. `extract_main_content`
**Category:** extraction
**Reliability:** high
**Description:** Intelligently extract article/main content similar to Reader Mode

**Parameters:** None

**Returns:** Object with title, author, publishDate, content, wordCount, readingTime

**Use case:** Extract clean article content from news sites, blogs, documentation pages. Automatically detects main content container, removes ads/sidebars, and provides reading metrics.

---

#### 2. `detect_page_load_state`
**Category:** util
**Reliability:** high
**Description:** Detect comprehensive page loading state including network activity and resource loading

**Parameters:** None

**Returns:** Object with loadState, networkActivity, imagesLoaded, fontsLoaded, iframesLoaded, scriptsLoaded

**Use case:** Determine optimal timing for page interactions, wait for AJAX content, detect SPA navigation completion.

---

#### 3. `audit_accessibility`
**Category:** util
**Reliability:** medium
**Description:** Comprehensive WCAG 2.1 accessibility audit

**Parameters:** None

**Returns:** Object with score (0-100), issueCount, issues array with severity levels, recommendations

**Use case:** Automated accessibility testing, compliance verification, identify WCAG violations.

---

#### 4. `find_search_functionality`
**Category:** navigation
**Reliability:** high
**Description:** Automatically locate site search functionality

**Parameters:** None

**Returns:** Object with found flag, type ('input', 'button', 'link'), selector, placeholder text

**Use case:** Locate search boxes on unfamiliar sites, automate site search operations.

---

#### 5. `smart_cookie_consent`
**Category:** util
**Reliability:** medium
**Description:** Intelligently detect and dismiss cookie consent banners with configurable preferences

**Parameters:**
- `action` (string, optional): 'accept_all', 'reject_all', 'customize' (default: 'accept_all')

**Returns:** Object with found flag, dismissed flag, action taken, button clicked

**Use case:** Automate cookie consent handling, bypass GDPR banners, configure cookie preferences.

---

### Tier 2: Performance & Analysis Macros (6)

Advanced macros for performance measurement, content structure analysis, and resource tracking.

#### 6. `measure_page_performance`
**Category:** util
**Reliability:** high
**Description:** Comprehensive performance metrics using Navigation Timing API

**Parameters:** None

**Returns:** Object with loadTime, domContentLoaded, firstPaint, firstContentfulPaint, resourceCounts, totalSize

**Use case:** Performance monitoring, load time optimization, resource analysis.

---

#### 7. `get_page_outline`
**Category:** extraction
**Reliability:** high
**Description:** Extract document outline from heading hierarchy

**Parameters:** None

**Returns:** Object with headingCount, outline array, tocExists, structure tree

**Use case:** Generate table of contents, understand document structure, navigation analysis.

---

#### 8. `extract_all_text_by_sections`
**Category:** extraction
**Reliability:** high
**Description:** Extract all text content grouped by semantic sections

**Parameters:**
- `includeHidden` (boolean, optional): Include hidden text (default: false)

**Returns:** Object with sections array (header, main, aside, footer), totalText, wordCount

**Use case:** Content analysis, text mining, semantic structure extraction.

---

#### 9. `analyze_images`
**Category:** extraction
**Reliability:** high
**Description:** Comprehensive image analysis including alt text, dimensions, lazy loading

**Parameters:**
- `limit` (number, optional): Maximum images to analyze (default: 50)

**Returns:** Object with total, withAlt, withSrc, lazy, decorative, images array with details

**Use case:** SEO audits, accessibility checks, image optimization analysis.

---

#### 10. `extract_download_links`
**Category:** extraction
**Reliability:** high
**Description:** Find all downloadable files (PDFs, docs, images, archives, media)

**Parameters:**
- `types` (array, optional): File types to include (default: all types)

**Returns:** Object with total count, downloads array with URL, type, filename, size estimate

**Use case:** Resource discovery, bulk download preparation, file inventory.

---

#### 11. `detect_tracking_scripts`
**Category:** util
**Reliability:** medium
**Description:** Detect analytics, advertising, and tracking scripts

**Parameters:** None

**Returns:** Object with total trackers, categories (analytics, advertising, social), cookiesSet, thirdPartyDomains

**Use case:** Privacy audits, tracking transparency, ad blocker development.

---

### Tier 3: Advanced Discovery Macros (7)

Sophisticated macros for element discovery, form analysis, and dynamic content detection.

#### 12. `find_elements_by_position`
**Category:** exploration
**Reliability:** high
**Description:** Find elements by viewport position (top-left, top-right, center, etc.)

**Parameters:**
- `position` (string, required): Position area - 'top-left', 'top-right', 'top-center', 'center', 'bottom-left', 'bottom-right', 'bottom-center'
- `limit` (number, optional): Maximum elements to return (default: 10)

**Returns:** Object with count, position area, elements array with selectors and coordinates

**Use case:** Locate navigation bars, floating action buttons, overlays by screen position.

---

#### 13. `find_recently_added_elements`
**Category:** exploration
**Reliability:** medium
**Description:** Track and find elements added after initial page load

**Parameters:**
- `since` (number, optional): Milliseconds to look back (default: 5000)

**Returns:** Object with count, elements array with selectors and timestamps

**Use case:** Detect AJAX-loaded content, monitor SPA updates, track dynamic elements.

---

#### 14. `find_elements_by_z_index`
**Category:** exploration
**Reliability:** high
**Description:** Find elements by z-index stacking order

**Parameters:**
- `limit` (number, optional): Maximum elements to return (default: 20)
- `minZIndex` (number, optional): Minimum z-index to include (default: 1)

**Returns:** Object with highest z-index, totalWithZIndex, elements array sorted by z-index

**Use case:** Find modals, popups, floating elements, stacking context analysis.

---

#### 15. `analyze_form_requirements`
**Category:** exploration
**Reliability:** high
**Description:** Analyze form validation requirements and constraints

**Parameters:**
- `formSelector` (string, optional): CSS selector for form (default: first form)

**Returns:** Object with totalFields, requiredFields, validationRules, constraints, passwordRequirements

**Use case:** Automated form filling, validation testing, password generator configuration.

---

#### 16. `generate_form_test_data`
**Category:** util
**Reliability:** medium
**Description:** Generate realistic test data for form fields based on validation rules

**Parameters:**
- `formSelector` (string, optional): CSS selector for form (default: first form)

**Returns:** Object with field count, generated data object with field names and test values

**Use case:** Automated testing, form validation testing, QA workflows.

---

#### 17. `detect_infinite_scroll`
**Category:** navigation
**Reliability:** high
**Description:** Detect and analyze infinite scroll functionality

**Parameters:** None

**Returns:** Object with detected flag, scrollThreshold, loadMoreTrigger, currentPage, hasNextPage

**Use case:** Pagination detection, content scraping, scroll-based navigation.

---

#### 18. `detect_loading_indicators`
**Category:** exploration
**Reliability:** high
**Description:** Find all loading spinners, skeletons, and progress indicators

**Parameters:** None

**Returns:** Object with loading flag, indicatorCount, types array, indicators with selectors

**Use case:** Determine page readiness, wait for content load, detect active AJAX requests.

---

### Tier 4: Navigation & Testing Macros (6)

Specialized macros for keyboard navigation, visual analysis, CAPTCHA detection, and testing utilities.

#### 19. `get_keyboard_navigation_order`
**Category:** navigation
**Reliability:** high
**Description:** Map complete keyboard navigation order and detect tab traps

**Parameters:**
- `limit` (number, optional): Maximum elements to include (default: 100)

**Returns:** Object with totalFocusable, order array with tabindex values, tabTraps, skipLinks

**Use case:** Accessibility testing, keyboard navigation audits, focus management analysis.

---

#### 20. `detect_dark_mode`
**Category:** util
**Reliability:** high
**Description:** Detect dark mode availability and current state

**Parameters:** None

**Returns:** Object with available flag, active flag, toggleSelector, method ('class', 'attribute', 'media-query')

**Use case:** Theme detection, automated theme testing, user preference detection.

---

#### 21. `measure_viewport_coverage`
**Category:** util
**Reliability:** medium
**Description:** Calculate what percentage of viewport is covered by each element

**Parameters:** None

**Returns:** Object with elements array sorted by coverage percentage, mostProminent, emptySpace percentage

**Use case:** Visual analysis, above-the-fold content detection, layout optimization.

---

#### 22. `detect_captcha`
**Category:** util
**Reliability:** high
**Description:** Detect presence and type of CAPTCHA challenges

**Parameters:** None

**Returns:** Object with present flag, type ('recaptcha', 'hcaptcha', 'cloudflare', 'custom'), iframe flag

**Use case:** Bot detection handling, automation flow decisions, CAPTCHA service identification.

---

#### 23. `generate_unique_selectors`
**Category:** util
**Reliability:** high
**Description:** Generate unique, stable CSS selectors for elements

**Parameters:**
- `elements` (array, required): Array of element references or descriptions
- `strategy` (string, optional): 'id', 'class', 'attribute', 'structure' (default: 'auto')

**Returns:** Object with count, selectors array with uniqueness scores and specificity

**Use case:** Test automation, element tracking, persistent selectors for dynamic content.

---

#### 24. `compare_element_positions`
**Category:** util
**Reliability:** medium
**Description:** Compare element positions between page states for visual regression testing

**Parameters:**
- `baseline` (object, required): Previous element position snapshot
- `tolerance` (number, optional): Pixel tolerance for position changes (default: 5)

**Returns:** Object with changed count, unchanged count, changes array with element selectors and position deltas

**Use case:** Visual regression testing, layout shift detection, responsive design validation.

---

## 🎯 Usage Examples

### Example 1: Content Extraction Workflow
```javascript
// Extract main article content
const content = await browser_execute_macro({
  id: "macro-id-for-extract_main_content",
  params: {}
});
// Result: { title: "...", author: "...", content: "...", wordCount: 1234, readingTime: "6 min" }

// Get document outline
const outline = await browser_execute_macro({
  id: "macro-id-for-get_page_outline",
  params: {}
});
// Result: { headingCount: 8, outline: [...], structure: [...] }
```

### Example 2: Performance Analysis
```javascript
// Measure page performance
const perf = await browser_execute_macro({
  id: "macro-id-for-measure_page_performance",
  params: {}
});
// Result: { loadTime: 2340, firstPaint: 980, resourceCounts: {...}, totalSize: "2.3 MB" }

// Detect tracking scripts
const trackers = await browser_execute_macro({
  id: "macro-id-for-detect_tracking_scripts",
  params: {}
});
// Result: { total: 8, categories: {...}, cookiesSet: 12, thirdPartyDomains: [...] }
```

### Example 3: Accessibility Audit
```javascript
// Run accessibility audit
const a11y = await browser_execute_macro({
  id: "macro-id-for-audit_accessibility",
  params: {}
});
// Result: { score: 87, issueCount: 5, issues: [...], recommendations: [...] }

// Check keyboard navigation
const keyboard = await browser_execute_macro({
  id: "macro-id-for-get_keyboard_navigation_order",
  params: { limit: 50 }
});
// Result: { totalFocusable: 42, order: [...], tabTraps: [], skipLinks: [...] }
```

### Example 4: Form Analysis & Testing
```javascript
// Analyze form requirements
const formReqs = await browser_execute_macro({
  id: "macro-id-for-analyze_form_requirements",
  params: { formSelector: "#signup-form" }
});
// Result: { totalFields: 7, requiredFields: 4, validationRules: {...}, passwordRequirements: {...} }

// Generate test data
const testData = await browser_execute_macro({
  id: "macro-id-for-generate_form_test_data",
  params: { formSelector: "#signup-form" }
});
// Result: { fieldCount: 7, data: { email: "test@example.com", password: "...", ... } }
```

### Example 5: Smart Cookie Consent
```javascript
// Automatically accept all cookies
const cookies = await browser_execute_macro({
  id: "macro-id-for-smart_cookie_consent",
  params: { action: "accept_all" }
});
// Result: { found: true, dismissed: true, action: "accept_all", buttonClicked: "Accept All" }
```

### Example 6: Position-Based Element Discovery
```javascript
// Find elements in top-right corner
const topRight = await browser_execute_macro({
  id: "macro-id-for-find_elements_by_position",
  params: { position: "top-right", limit: 5 }
});
// Result: { count: 5, position: "top-right", elements: [...] }

// Find highest z-index elements (modals, popups)
const zIndex = await browser_execute_macro({
  id: "macro-id-for-find_elements_by_z_index",
  params: { limit: 10, minZIndex: 100 }
});
// Result: { highest: 999999, totalWithZIndex: 23, elements: [...] }
```

## 🔍 Finding Macro IDs

To get the macro ID for use in `browser_execute_macro`:

```javascript
// List all universal macros
const macros = await browser_list_macros({ site: "*" });

// Find the macro you need
const targetMacro = macros.macros.find(m => m.name === "extract_main_content");
const macroId = targetMacro.id;
```

## 📊 Macro Categories

- **Extraction** (6 macros): Content extraction, text analysis, media analysis
- **Exploration** (5 macros): Element discovery, form analysis, loading detection
- **Navigation** (3 macros): Search, infinite scroll, keyboard navigation
- **Util** (10 macros): Performance, accessibility, dark mode, tracking, selectors, testing

## 🚀 Best Practices

1. **Tier 1 for Critical Workflows**: Use Tier 1 macros for essential operations (content extraction, accessibility, page state)
2. **Performance Monitoring**: Combine `measure_page_performance` with `detect_tracking_scripts` for complete performance analysis
3. **Accessibility First**: Run `audit_accessibility` and `get_keyboard_navigation_order` together for comprehensive accessibility testing
4. **Form Automation**: Use `analyze_form_requirements` before `generate_form_test_data` for intelligent form filling
5. **Smart Waiting**: Use `detect_page_load_state` and `detect_loading_indicators` to determine optimal interaction timing
6. **Position-Based Discovery**: Use `find_elements_by_position` and `find_elements_by_z_index` when traditional selectors fail

## 🔄 Integration with Utility Macros

Advanced macros complement the 17 utility macros:

- Use `get_interactive_elements` (utility) + `get_keyboard_navigation_order` (advanced) for complete interaction mapping
- Use `discover_forms` (utility) + `analyze_form_requirements` (advanced) for deep form analysis
- Use `detect_modals` (utility) + `find_elements_by_z_index` (advanced) for comprehensive modal detection
- Use `cleanup_page` (utility) + `detect_tracking_scripts` (advanced) for privacy-focused browsing

## 🛠️ Development

All macros are defined in `advanced-macros.js` and organized in 4 tiers.

To modify or add macros:
1. Edit `advanced-macros.js`
2. Run `npm run store:advanced-macros` to update the database
3. Run `npm run test:advanced-macros` to verify functionality

## 📝 Notes

- All macros are universal (site: "*") and work on any website
- Macros execute in the page context with full DOM access
- Results are token-efficient and structured for easy consumption
- Reliability ratings: high > medium > low > untested
- Advanced macros are designed for sophisticated automation and testing workflows

## 🎯 Quick Reference

### Content & Extraction
- `extract_main_content` - Article extraction
- `get_page_outline` - Document structure
- `extract_all_text_by_sections` - Semantic text extraction
- `analyze_images` - Image analysis
- `extract_download_links` - File discovery

### Performance & Analysis
- `measure_page_performance` - Performance metrics
- `detect_page_load_state` - Loading state
- `detect_tracking_scripts` - Privacy analysis

### Forms & Input
- `analyze_form_requirements` - Form constraints
- `generate_form_test_data` - Test data generation

### Accessibility & UX
- `audit_accessibility` - WCAG compliance
- `get_keyboard_navigation_order` - Tab order
- `detect_dark_mode` - Theme detection

### Discovery & Navigation
- `find_search_functionality` - Search location
- `find_elements_by_position` - Position-based search
- `find_elements_by_z_index` - Stacking order
- `detect_infinite_scroll` - Pagination detection
- `detect_loading_indicators` - Loading state

### Testing & Utilities
- `smart_cookie_consent` - Cookie handling
- `detect_captcha` - CAPTCHA detection
- `generate_unique_selectors` - Stable selectors
- `compare_element_positions` - Visual regression
- `measure_viewport_coverage` - Visual analysis
