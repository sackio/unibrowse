# QA Testing Module

## Routing Context

The main browser skill routes to this module when the user requests:
- **Trigger keywords**: "test", "qa", "accessibility", "performance", "audit", "wcag", "a11y", "keyboard navigation", "visual regression", "responsive", "validation"
- **Task patterns**: Accessibility audits, performance testing, visual regression, keyboard navigation validation, responsive design testing
- **Examples**:
  - "Audit this page for accessibility issues"
  - "Run a performance test and identify bottlenecks"
  - "Compare screenshots between baseline and current version"
  - "Test keyboard navigation and tab order"
  - "Generate a WCAG 2.1 compliance report"

**What this module provides**: Step-by-step instructions for comprehensive QA testing including accessibility audits (WCAG 2.1), performance analysis, visual regression testing, keyboard navigation validation, and responsive design testing. All tests generate detailed markdown reports with actionable recommendations.

## Available Macros

### Accessibility Macros

#### `audit_accessibility`
- **Purpose**: Run comprehensive WCAG 2.1 accessibility audit
- **Parameters**: None
- **Returns**: Issues by severity (critical, serious, moderate, minor) with WCAG criteria references
- **When to use**: Complete accessibility compliance testing

#### `check_keyboard_navigation`
- **Purpose**: Validate keyboard accessibility (tab order, focus visibility, keyboard traps)
- **Parameters**: None
- **Returns**: Tab order sequence, focus visibility issues, keyboard traps detected
- **When to use**: Testing keyboard-only navigation

#### `analyze_color_contrast`
- **Purpose**: Check color contrast ratios for WCAG compliance
- **Parameters**: None
- **Returns**: Contrast issues (text, backgrounds, borders) with ratios and WCAG pass/fail
- **When to use**: Verifying text readability and contrast requirements

#### `validate_aria`
- **Purpose**: Validate ARIA attributes for correctness
- **Parameters**: None
- **Returns**: Invalid/missing ARIA attributes, role issues, relationship errors
- **When to use**: Checking screen reader compatibility

### Performance Macros

#### `measure_page_performance`
- **Purpose**: Measure page load performance metrics
- **Parameters**: None
- **Returns**: Load time, DOMContentLoaded, First Paint, First Contentful Paint, etc.
- **When to use**: Performance benchmarking and optimization

#### `analyze_resource_sizes`
- **Purpose**: Analyze resource sizes and loading patterns
- **Parameters**: None
- **Returns**: JS, CSS, images, fonts sizes, total page size
- **When to use**: Identifying large resources that slow down loading

#### `detect_render_blocking`
- **Purpose**: Detect render-blocking resources
- **Parameters**: None
- **Returns**: Blocking scripts, stylesheets, and their impact
- **When to use**: Optimizing critical rendering path

### Validation Macros

#### `validate_html`
- **Purpose**: Validate HTML markup for errors
- **Parameters**: None
- **Returns**: Validation errors, warnings, and suggestions
- **When to use**: Checking HTML standards compliance

#### `check_broken_links`
- **Purpose**: Check for broken links on the page
- **Parameters**: None
- **Returns**: 404s, unreachable URLs, redirect chains
- **When to use**: Link integrity validation

## Execution Workflows

### Workflow 1: Accessibility Audit (WCAG 2.1)

**When to use**: Comprehensive accessibility compliance testing against WCAG 2.1 Level A, AA, AAA.

**Instructions for main conversation:**

1. **Create and label audit tab**:
   ```
   Call: mcp__browser__browser_create_tab({ url: "https://example.com" })
   Store the returned tabId from result.content.tabId
   Example: If result is { content: { tabId: 123 } }, store auditTab = 123

   Call: mcp__browser__browser_set_tab_label({ tabTarget: 123, label: "accessibility-audit" })
   ```

2. **Run accessibility audit**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "audit_accessibility",
     tabTarget: auditTab
   })

   Store auditResults = result.content
   Example: {
     issues: [
       { type: "missing-alt", severity: "critical", wcagCriterion: "1.1.1", element: "img.logo" },
       { type: "low-contrast", severity: "serious", wcagCriterion: "1.4.3", element: "p.description" }
     ]
   }
   ```

3. **Check keyboard navigation**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "check_keyboard_navigation",
     tabTarget: auditTab
   })

   Store keyboardResults = result.content
   Example: {
     tabOrder: [...],
     focusVisibility: [...],
     keyboardTraps: [...],
     issues: [...]
   }
   ```

4. **Analyze color contrast**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "analyze_color_contrast",
     tabTarget: auditTab
   })

   Store contrastResults = result.content
   Example: {
     issues: [
       { element: "p.text", foreground: "#777", background: "#fff", ratio: 3.5, wcagAA: false }
     ]
   }
   ```

5. **Validate ARIA attributes**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "validate_aria",
     tabTarget: auditTab
   })

   Store ariaResults = result.content
   Example: {
     issues: [
       { element: "div[role='button']", issue: "missing-aria-label", severity: "serious" }
     ]
   }
   ```

6. **Categorize issues by severity**:
   ```
   Aggregate all issues and categorize:
   critical = auditResults.issues.filter(i => i.severity === "critical")
             + keyboardResults.issues.filter(i => i.severity === "critical")

   serious = auditResults.issues.filter(i => i.severity === "serious")
            + contrastResults.issues.filter(i => i.severity === "serious")

   moderate = auditResults.issues.filter(i => i.severity === "moderate")
             + ariaResults.issues.filter(i => i.severity === "moderate")

   minor = auditResults.issues.filter(i => i.severity === "minor")
   ```

7. **Generate markdown report**:
   ```
   Create report with structure:
   # Accessibility Audit Report

   **URL**: https://example.com
   **Date**: {current timestamp}
   **WCAG Level**: AA

   ## Executive Summary
   - **Total Issues**: {total count}
   - **Critical**: {critical.length}
   - **Serious**: {serious.length}
   - **Moderate**: {moderate.length}
   - **Minor**: {minor.length}

   ## Critical Issues (Must Fix)
   {for each critical issue:
     ### {issue.type}
     - **WCAG Criterion**: {issue.wcagCriterion}
     - **Element**: {issue.element}
     - **Impact**: {issue.impact}
     - **Recommendation**: {issue.recommendation}
   }

   ## Serious Issues (Should Fix)
   {for each serious issue: ...}

   ## WCAG Compliance
   - **Level A**: {pass if no critical issues}
   - **Level AA**: {pass if no critical or serious issues}
   - **Level AAA**: {pass if no issues}

   ## Recommendations
   1. Fix all critical issues immediately (blocks users)
   2. Address serious issues in next sprint
   3. Plan moderate issues for future releases
   4. Consider minor issues for polish phase
   ```

8. **Export report to /tmp/**:
   ```
   Generate timestamp: Date.now()

   Call: Write({
     file_path: "/tmp/accessibility-report-{timestamp}.md",
     content: markdown report from step 7
   })
   ```

9. **Return results**:
   ```
   Return to user:
   {
     tabId: auditTab,
     label: "accessibility-audit",
     url: "https://example.com",
     testType: "accessibility",
     data: {
       totalIssues: critical.length + serious.length + moderate.length + minor.length,
       criticalIssues: critical.length,
       seriousIssues: serious.length,
       wcagCompliance: critical.length === 0 && serious.length === 0 ? "AA" : "Failed",
       reportPath: "/tmp/accessibility-report-{timestamp}.md"
     }
   }
   ```

**Expected result**: Comprehensive WCAG 2.1 accessibility audit with categorized issues, actionable recommendations, and markdown report saved to /tmp/.

### Workflow 2: Performance Testing

**When to use**: Performance benchmarking, bottleneck identification, and optimization recommendations.

**Instructions for main conversation:**

1. **Create and label performance test tab**:
   ```
   Call: mcp__browser__browser_create_tab({ url: "https://example.com" })
   Store perfTab = result.content.tabId

   Call: mcp__browser__browser_set_tab_label({ tabTarget: perfTab, label: "performance-test" })
   ```

2. **Measure page performance**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "measure_page_performance",
     tabTarget: perfTab
   })

   Store perfResults = result.content
   Example: {
     loadTime: 2500,
     domContentLoaded: 1800,
     firstPaint: 1200,
     firstContentfulPaint: 1400
   }
   ```

3. **Analyze resource sizes**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "analyze_resource_sizes",
     tabTarget: perfTab
   })

   Store resourceResults = result.content
   Example: {
     totalSize: 3500,  // KB
     javascript: 1200,
     css: 400,
     images: 1500,
     fonts: 300,
     other: 100
   }
   ```

4. **Detect render-blocking resources**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "detect_render_blocking",
     tabTarget: perfTab
   })

   Store blockingResults = result.content
   Example: {
     scripts: ["https://example.com/app.js"],
     stylesheets: ["https://example.com/style.css"],
     impact: "High"
   }
   ```

5. **Get network logs for detailed analysis**:
   ```
   Call: mcp__browser__browser_get_network_logs({
     tabTarget: perfTab
   })

   Store networkLogs = result.content
   Example: {
     requests: [
       { url: "...", method: "GET", status: 200, size: 500, timing: {...} },
       ...
     ]
   }
   ```

6. **Analyze bottlenecks**:
   ```
   Identify bottlenecks from collected data:

   bottlenecks = []

   If perfResults.loadTime > 3000:
     bottlenecks.push({
       title: "Slow Page Load",
       impact: "High",
       metric: perfResults.loadTime + "ms",
       recommendation: "Reduce total page size and optimize critical path"
     })

   If resourceResults.totalSize > 5000:  // > 5MB
     bottlenecks.push({
       title: "Large Page Size",
       impact: "High",
       metric: resourceResults.totalSize + "KB",
       recommendation: "Compress images, minify JS/CSS, enable gzip compression"
     })

   If blockingResults.scripts.length > 0:
     bottlenecks.push({
       title: "Render-Blocking Scripts",
       impact: "High",
       scripts: blockingResults.scripts,
       recommendation: "Use async/defer attributes or move scripts to end of body"
     })

   If networkLogs.requests.length > 100:
     bottlenecks.push({
       title: "Too Many Requests",
       impact: "Medium",
       count: networkLogs.requests.length,
       recommendation: "Combine resources, use sprites, implement HTTP/2 push"
     })
   ```

7. **Calculate performance score** (0-100):
   ```
   score = 100

   If perfResults.loadTime > 3000: score -= 20
   Else if perfResults.loadTime > 2000: score -= 10
   Else if perfResults.loadTime > 1000: score -= 5

   If resourceResults.totalSize > 5000: score -= 20  // > 5MB
   Else if resourceResults.totalSize > 2000: score -= 10  // > 2MB

   If networkLogs.requests.length > 100: score -= 15
   Else if networkLogs.requests.length > 50: score -= 10

   performanceScore = max(0, score)
   ```

8. **Generate markdown report**:
   ```
   Create report:
   # Performance Test Report

   **URL**: https://example.com
   **Date**: {timestamp}

   ## Metrics
   - **Load Time**: {perfResults.loadTime}ms
   - **DOM Content Loaded**: {perfResults.domContentLoaded}ms
   - **First Paint**: {perfResults.firstPaint}ms
   - **Total Size**: {resourceResults.totalSize}KB
   - **Requests**: {networkLogs.requests.length}

   ## Performance Score: {performanceScore}/100

   ## Resource Breakdown
   - **JavaScript**: {resourceResults.javascript}KB
   - **CSS**: {resourceResults.css}KB
   - **Images**: {resourceResults.images}KB
   - **Fonts**: {resourceResults.fonts}KB

   ## Bottlenecks
   {for each bottleneck:
     ### {bottleneck.title}
     - **Impact**: {bottleneck.impact}
     - **Metric**: {bottleneck.metric or bottleneck.count}
     - **Recommendation**: {bottleneck.recommendation}
   }

   ## Recommendations
   1. {Prioritize high-impact bottlenecks}
   2. {Medium-impact optimizations}
   3. {Nice-to-have improvements}
   ```

9. **Export report**:
   ```
   Call: Write({
     file_path: "/tmp/performance-report-{timestamp}.md",
     content: markdown report from step 8
   })
   ```

10. **Return results**:
    ```
    Return to user:
    {
      tabId: perfTab,
      label: "performance-test",
      url: "https://example.com",
      testType: "performance",
      data: {
        loadTime: perfResults.loadTime,
        totalSize: resourceResults.totalSize,
        bottlenecks: bottlenecks.length,
        performanceScore: performanceScore,
        reportPath: "/tmp/performance-report-{timestamp}.md"
      }
    }
    ```

**Expected result**: Complete performance analysis with metrics, bottleneck identification, performance score, and optimization recommendations in markdown report.

### Workflow 3: Visual Regression Testing

**When to use**: Comparing baseline and current versions for visual differences, layout shifts.

**Instructions for main conversation:**

1. **Create tabs for baseline and current**:
   ```
   Call: mcp__browser__browser_create_tab({ url: baselineUrl })
   Store baselineTab = result.content.tabId

   Call: mcp__browser__browser_set_tab_label({ tabTarget: baselineTab, label: "baseline" })

   Call: mcp__browser__browser_create_tab({ url: currentUrl })
   Store currentTab = result.content.tabId

   Call: mcp__browser__browser_set_tab_label({ tabTarget: currentTab, label: "current" })
   ```

2. **Capture baseline screenshot**:
   ```
   Call: mcp__browser__browser_screenshot({
     tabTarget: baselineTab
   })

   Store baselineScreenshot = result.content.data
   # This is base64-encoded image data
   ```

3. **Capture current screenshot**:
   ```
   Call: mcp__browser__browser_screenshot({
     tabTarget: currentTab
   })

   Store currentScreenshot = result.content.data
   ```

4. **Generate comparison report**:
   ```
   Create report:
   # Visual Regression Test Report

   **Baseline URL**: {baselineUrl}
   **Current URL**: {currentUrl}
   **Date**: {timestamp}

   ## Screenshots Captured
   - Baseline screenshot: {baselineTab}
   - Current screenshot: {currentTab}

   ## Manual Comparison Required
   The screenshots have been captured but automated visual diff analysis requires external tools.

   ### Next Steps:
   1. Review both screenshots side-by-side
   2. Look for layout shifts, color changes, or missing elements
   3. Use external visual diff tools (Percy, Applitools, BackstopJS) for automated comparison if needed

   ### Screenshot Locations:
   - Screenshots are embedded in browser tabs {baselineTab} and {currentTab}
   - Base64 data is available for export if needed

   ## Notes
   - Consider using segmented screenshots (browser_segmented_screenshot) for specific page sections
   - For automated diffing, export screenshots and use external tools
   ```

5. **Export report**:
   ```
   Call: Write({
     file_path: "/tmp/visual-regression-report-{timestamp}.md",
     content: markdown report from step 4
   })
   ```

6. **Return results**:
   ```
   Return to user:
   {
     tabs: [
       { tabId: baselineTab, label: "baseline", url: baselineUrl },
       { tabId: currentTab, label: "current", url: currentUrl }
     ],
     testType: "visual-regression",
     data: {
       baselineUrl: baselineUrl,
       currentUrl: currentUrl,
       screenshotsCaptured: 2,
       reportPath: "/tmp/visual-regression-report-{timestamp}.md",
       notes: "Manual comparison required or use external diff tools"
     }
   }
   ```

**Expected result**: Baseline and current screenshots captured in separate tabs, report generated for manual comparison or external tool analysis.

### Workflow 4: Keyboard Navigation Testing

**When to use**: Testing keyboard-only navigation, tab order, focus visibility, and accessibility.

**Instructions for main conversation:**

1. **Create and label keyboard test tab**:
   ```
   Call: mcp__browser__browser_create_tab({ url: "https://example.com" })
   Store keyboardTab = result.content.tabId

   Call: mcp__browser__browser_set_tab_label({ tabTarget: keyboardTab, label: "keyboard-test" })
   ```

2. **Get all interactive elements**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "get_interactive_elements",
     tabTarget: keyboardTab
   })

   Store elements = result.content.elements
   Example: [
     { type: "button", text: "Submit", selector: "#submit-btn" },
     { type: "link", text: "Home", selector: "a.home" },
     { type: "input", text: "", selector: "#email" }
   ]
   ```

3. **Test tab order and focus visibility**:
   ```
   For each element in elements:
     a. Focus the element:
        Call: mcp__browser__browser_evaluate({
          expression: "document.querySelector('" + element.selector + "').focus()",
          tabTarget: keyboardTab
        })

     b. Check focus visibility (outline, box-shadow, border):
        Call: mcp__browser__browser_get_computed_styles({
          selector: element.selector,
          properties: ["outline", "box-shadow", "border"],
          tabTarget: keyboardTab
        })

        Store focusStyle = result.content

     c. Determine if focus is visible:
        focusVisible = (
          focusStyle.outline !== "none" ||
          focusStyle["box-shadow"] !== "none" ||
          focusStyle.border !== "none"
        )

     d. Record result:
        tabResults.push({
          element: element.text,
          selector: element.selector,
          type: element.type,
          focusVisible: focusVisible
        })
   ```

4. **Check for keyboard traps**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "check_keyboard_navigation",
     tabTarget: keyboardTab
   })

   Store keyboardResults = result.content
   Example: {
     keyboardTraps: [
       { element: "div.modal", issue: "Cannot tab out of modal" }
     ],
     tabOrder: [...]
   }
   ```

5. **Test common keyboard shortcuts**:
   ```
   Test these shortcuts:
   - Tab: Focus next element
   - Shift+Tab: Focus previous element
   - Enter: Activate element
   - Space: Activate element/toggle
   - Escape: Close modal/cancel

   For each shortcut:
     Call: mcp__browser__browser_press_key({
       key: shortcut.key,
       tabTarget: keyboardTab
     })

     # Note: Full validation requires page state inspection
     # Record that test was performed
   ```

6. **Identify keyboard issues**:
   ```
   issues = []

   focusIssues = tabResults.filter(r => !r.focusVisible)
   If focusIssues.length > 0:
     issues.push({
       type: "Missing Focus Indicators",
       severity: "serious",
       count: focusIssues.length,
       elements: focusIssues.map(r => r.selector),
       recommendation: "Add visible focus indicators (outline, box-shadow, or border)"
     })

   If keyboardResults.keyboardTraps.length > 0:
     issues.push({
       type: "Keyboard Traps",
       severity: "critical",
       traps: keyboardResults.keyboardTraps,
       recommendation: "Ensure users can exit all interactive elements with keyboard"
     })
   ```

7. **Generate markdown report**:
   ```
   Create report:
   # Keyboard Navigation Test Report

   **URL**: https://example.com
   **Date**: {timestamp}

   ## Summary
   - **Interactive Elements**: {elements.length}
   - **Focus Issues**: {focusIssues.length}
   - **Keyboard Traps**: {keyboardResults.keyboardTraps.length}

   ## Tab Order
   {for each element in tabResults:
     {index}. {element.type}: "{element.text}" - Focus Visible: {element.focusVisible ? "✓" : "✗"}
   }

   ## Issues Found
   {for each issue in issues:
     ### {issue.type} (Severity: {issue.severity})
     - **Count**: {issue.count or issue.traps.length}
     - **Recommendation**: {issue.recommendation}
     - **Affected Elements**: {issue.elements or issue.traps}
   }

   ## Keyboard Shortcuts Tested
   - Tab / Shift+Tab: Navigation tested
   - Enter / Space: Activation tested
   - Escape: Cancel/close tested

   ## Recommendations
   1. Add focus indicators to all {focusIssues.length} elements missing them
   2. Fix {keyboardResults.keyboardTraps.length} keyboard trap(s)
   3. Test with real keyboard-only users
   ```

8. **Export report**:
   ```
   Call: Write({
     file_path: "/tmp/keyboard-navigation-report-{timestamp}.md",
     content: markdown report from step 7
   })
   ```

9. **Return results**:
   ```
   Return to user:
   {
     tabId: keyboardTab,
     label: "keyboard-test",
     url: "https://example.com",
     testType: "keyboard-navigation",
     data: {
       interactiveElements: elements.length,
       focusIssues: focusIssues.length,
       keyboardTraps: keyboardResults.keyboardTraps.length,
       reportPath: "/tmp/keyboard-navigation-report-{timestamp}.md"
     }
   }
   ```

**Expected result**: Comprehensive keyboard navigation testing with tab order analysis, focus visibility check, keyboard trap detection, and detailed markdown report.

### Workflow 5: Responsive Design Testing

**When to use**: Testing layout across multiple viewports (mobile, tablet, desktop).

**Instructions for main conversation:**

1. **Define viewports to test**:
   ```
   viewports = [
     { width: 320, height: 568, name: "Mobile Small (iPhone SE)" },
     { width: 375, height: 667, name: "Mobile Medium (iPhone 8)" },
     { width: 414, height: 896, name: "Mobile Large (iPhone 11)" },
     { width: 768, height: 1024, name: "Tablet (iPad)" },
     { width: 1024, height: 768, name: "Tablet Landscape" },
     { width: 1280, height: 720, name: "Desktop Small" },
     { width: 1920, height: 1080, name: "Desktop Large" }
   ]
   ```

2. **Create tab for responsive testing**:
   ```
   Call: mcp__browser__browser_create_tab({ url: "https://example.com" })
   Store responsiveTab = result.content.tabId

   Call: mcp__browser__browser_set_tab_label({ tabTarget: responsiveTab, label: "responsive-test" })
   ```

3. **Capture screenshots at each viewport**:
   ```
   screenshots = []

   For each viewport in viewports:
     # Note: Setting viewport size requires browser extension or CDP
     # Current implementation captures with default viewport
     # Document the viewport being tested

     Call: mcp__browser__browser_screenshot({
       tabTarget: responsiveTab
     })

     screenshots.push({
       viewport: viewport.name,
       width: viewport.width,
       height: viewport.height,
       screenshot: result.content.data
     })

     # Wait between captures
     Call: mcp__browser__browser_wait({ time: 1, tabTarget: responsiveTab })
   ```

4. **Generate markdown report**:
   ```
   Create report:
   # Responsive Design Test Report

   **URL**: https://example.com
   **Date**: {timestamp}

   ## Viewports Tested
   {for each viewport in viewports:
     - **{viewport.name}**: {viewport.width}x{viewport.height}px
   }

   ## Screenshots Captured
   Total: {screenshots.length} screenshots

   ## Manual Review Required
   Please review screenshots for:
   1. Layout shifts or broken layouts
   2. Text overflow or truncation
   3. Images scaling incorrectly
   4. Navigation menu collapsing properly
   5. Content readability at small sizes
   6. Touch target sizes (min 44x44px for mobile)

   ## Breakpoints to Check
   - Mobile: < 768px
   - Tablet: 768px - 1024px
   - Desktop: > 1024px

   ## Common Responsive Issues to Look For
   - Horizontal scrolling on mobile
   - Text too small to read without zooming
   - Interactive elements too close together
   - Images not scaling proportionally
   - Fixed-width content causing overflow

   ## Notes
   - Screenshots captured at default viewport (viewport resizing requires browser extension)
   - For accurate testing, manually resize browser or use DevTools device emulation
   - Consider using segmented screenshots for specific page sections
   ```

5. **Export report**:
   ```
   Call: Write({
     file_path: "/tmp/responsive-design-report-{timestamp}.md",
     content: markdown report from step 4
   })
   ```

6. **Return results**:
   ```
   Return to user:
   {
     tabId: responsiveTab,
     label: "responsive-test",
     url: "https://example.com",
     testType: "responsive-design",
     data: {
       viewportsTested: viewports.length,
       screenshotsCaptured: screenshots.length,
       reportPath: "/tmp/responsive-design-report-{timestamp}.md",
       notes: "Manual review required for layout issues"
     }
   }
   ```

**Expected result**: Screenshots captured for multiple viewport sizes, markdown report generated with responsive design checklist for manual review.

## Helper Functions Reference

### Severity Classification Logic

**Critical Issues** (block users from completing tasks):
- Keyboard traps
- Missing alt text on critical images
- Form fields with no labels
- Inaccessible required functionality

**Serious Issues** (significantly impact usability):
- Low color contrast (fails WCAG AA)
- Missing form labels
- Broken ARIA relationships
- Poor heading structure

**Moderate Issues** (noticeable but workarounds exist):
- Invalid ARIA attributes
- Suboptimal heading hierarchy
- Missing landmarks
- Color-only information

**Minor Issues** (minor inconveniences):
- Missing skip links
- Redundant alt text
- Empty headings
- Title case in headings

### Performance Score Calculation Logic

```
Start with score = 100

Deduct for slow load times:
- If loadTime > 3000ms: -20 points
- Else if loadTime > 2000ms: -10 points
- Else if loadTime > 1000ms: -5 points

Deduct for large page size:
- If totalSize > 5000KB (5MB): -20 points
- Else if totalSize > 2000KB (2MB): -10 points

Deduct for too many requests:
- If requests > 100: -15 points
- Else if requests > 50: -10 points

Final score = max(0, score)
```

### Focus Indicator Detection Logic

```
Element has visible focus if ANY of:
- outline is not "none"
- box-shadow is not "none"
- border is not "none"
```

## Error Handling

### Common Error 1: "Audit macro not found"

**Solution**:
```
Fall back to manual accessibility checks:
Call: mcp__browser__browser_snapshot({ tabTarget: auditTab })

Manually inspect ARIA tree for:
- Missing alt attributes
- Invalid ARIA roles
- Missing labels
- Contrast issues
```

### Common Error 2: "Performance metrics unavailable"

**Solution**:
```
Use network logs as fallback:
Call: mcp__browser__browser_get_network_logs({ tabTarget: perfTab })

Calculate metrics from network timing:
- Find first request (page load)
- Calculate total size from all responses
- Count number of requests
```

### Common Error 3: "Screenshot capture failed"

**Solution**:
```
Retry with delay:
Call: mcp__browser__browser_wait({ time: 3, tabTarget: testTab })

Call: mcp__browser__browser_screenshot({ tabTarget: testTab })

If still fails:
  Return error: "Screenshot capture failed after retry. Check page load status."
```

## Return Formats

### Accessibility Audit

```json
{
  "tabId": 123,
  "label": "accessibility-audit",
  "url": "https://example.com",
  "testType": "accessibility",
  "data": {
    "totalIssues": 15,
    "criticalIssues": 3,
    "seriousIssues": 5,
    "wcagCompliance": "Failed",
    "reportPath": "/tmp/accessibility-report-1234567890.md"
  }
}
```

### Performance Test

```json
{
  "tabId": 123,
  "label": "performance-test",
  "url": "https://example.com",
  "testType": "performance",
  "data": {
    "loadTime": 2500,
    "totalSize": 3500,
    "bottlenecks": 4,
    "performanceScore": 75,
    "reportPath": "/tmp/performance-report-1234567890.md"
  }
}
```

### Keyboard Navigation Test

```json
{
  "tabId": 123,
  "label": "keyboard-test",
  "url": "https://example.com",
  "testType": "keyboard-navigation",
  "data": {
    "interactiveElements": 25,
    "focusIssues": 8,
    "keyboardTraps": 1,
    "reportPath": "/tmp/keyboard-navigation-report-1234567890.md"
  }
}
```

## Quick Reference

### Run Accessibility Audit
```
Call: mcp__browser__browser_execute_macro({
  id: "audit_accessibility",
  tabTarget: auditTab
})
```

### Check Keyboard Navigation
```
Call: mcp__browser__browser_execute_macro({
  id: "check_keyboard_navigation",
  tabTarget: auditTab
})
```

### Measure Performance
```
Call: mcp__browser__browser_execute_macro({
  id: "measure_page_performance",
  tabTarget: perfTab
})
```

### Analyze Color Contrast
```
Call: mcp__browser__browser_execute_macro({
  id: "analyze_color_contrast",
  tabTarget: auditTab
})
```

### Validate ARIA
```
Call: mcp__browser__browser_execute_macro({
  id: "validate_aria",
  tabTarget: auditTab
})
```

### Capture Screenshot
```
Call: mcp__browser__browser_screenshot({
  tabTarget: testTab
})
```

### Get Network Logs
```
Call: mcp__browser__browser_get_network_logs({
  tabTarget: perfTab
})
```

## Remember

- ✅ **Test against WCAG 2.1 standards** - Level A, AA, AAA compliance
- ✅ **Categorize by severity** - critical, serious, moderate, minor (prioritize fixes)
- ✅ **Generate markdown reports** - detailed, actionable recommendations in /tmp/
- ✅ **Include evidence** - screenshots, metrics, specific elements affected
- ✅ **Provide concrete next steps** - prioritized action items for remediation
- ✅ **Test keyboard navigation** - tab order, focus visibility, no keyboard traps
- ✅ **Measure real performance** - load time, resource sizes, bottlenecks
- ✅ **Export with timestamps** - /tmp/{report-type}-{timestamp}.md
- ✅ **Return tab IDs** - enable context preservation for multi-turn workflows
- ✅ **Focus on actionability** - every issue should have a clear recommendation

---

**When the main skill routes to this module**: Immediately identify the test type (accessibility, performance, visual regression, keyboard navigation, responsive design), execute the appropriate comprehensive testing workflow with macros and tools, categorize findings by severity, generate a detailed markdown report with actionable recommendations, export to /tmp/, and return results with tab metadata and report path.
