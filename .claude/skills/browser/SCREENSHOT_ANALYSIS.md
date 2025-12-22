# Screenshot Analysis Module

## When to Use This Module

Activate when the user requests:
- Screenshot analysis or examination
- Visual or layout issue detection
- Accessibility compliance checking (WCAG 2.1 AA/AAA)
- Design consistency analysis
- Color contrast verification
- Component consistency auditing

**Trigger keywords**: "screenshot", "analysis", "analyze", "visual", "layout", "accessibility", "wcag", "a11y", "contrast", "design", "consistency"

## Core Analysis Types

This module provides three types of analysis:

1. **Visual/Layout Analysis**: Alignment, spacing, overlapping elements, viewport issues, visual hierarchy
2. **Accessibility Analysis**: WCAG 2.1 AA/AAA compliance (color contrast, alt text, ARIA labels, semantic HTML, keyboard navigation, text sizing)
3. **Design Consistency Analysis**: Font patterns, color palettes, spacing scales, component consistency

## Input Parameters

When analyzing screenshots, gather these parameters from the user:

- **screenshotPaths**: Array of screenshot file paths (required)
- **url**: URL for extracting HTML/DOM (optional)
- **selectors**: CSS selectors used for segmented screenshots (optional)
- **tabTarget**: Browser tab ID for live HTML extraction (optional)
- **analysisTypes**: Specific analysis types to run: `visual`, `accessibility`, `design`, or `all` (default: all)
- **outputPath**: Where to save the report (default: `/tmp/screenshot_analysis_{timestamp}.md`)

## Workflow 1: Comprehensive Analysis (Screenshots + HTML)

**Use when**: User provides screenshots and wants full analysis with DOM context

**Instructions for main conversation:**

1. **Read all screenshot files**:
   ```
   For each screenshot path in screenshotPaths:
     Call: Read({ file_path: screenshotPath })
     Store the image data for analysis
   ```

2. **Extract HTML/DOM (if url or tabTarget provided)**:
   ```
   If url provided:
     Call: mcp__browser__browser_navigate({
       url: url,
       tabTarget: tabTarget  // if provided
     })

   Get full ARIA tree for semantic analysis:
   Call: mcp__browser__browser_snapshot({ tabTarget: tabTarget })
   Store snapshot for structural analysis

   Query specific selectors (if provided):
   For each selector in selectors:
     Call: mcp__browser__browser_query_dom({
       selector: selector,
       limit: 10,
       tabTarget: tabTarget
     })
     Store DOM elements for targeted analysis

   Get visible text content:
   Call: mcp__browser__browser_get_visible_text({
     maxLength: 5000,
     tabTarget: tabTarget
   })
   Store text for readability analysis
   ```

3. **Get computed styles for analysis**:
   ```
   For each selector in selectors:
     Call: mcp__browser__browser_get_computed_styles({
       selector: selector,
       properties: ["font-family", "font-size", "font-weight", "line-height",
                    "color", "background-color", "margin", "padding",
                    "display", "position", "z-index"],
       tabTarget: tabTarget
     })
     Store styles for consistency analysis
   ```

4. **Run analysis algorithms**:
   ```
   Based on analysisTypes parameter:

   If "visual" or "all":
     - Analyze screenshots for alignment issues
     - Check spacing consistency from computed styles
     - Detect overlapping elements from DOM positions
     - Check viewport issues (horizontal scrollbars, clipping)
     - Analyze visual hierarchy (font sizes, weights, heading order)

   If "accessibility" or "all":
     - Calculate color contrast ratios from computed styles
     - Check for alt text on images from ARIA tree
     - Verify ARIA labels on interactive elements
     - Check semantic HTML structure (headings, landmarks)
     - Verify keyboard navigation (focus indicators, tab order)
     - Check text sizing (minimum 16px for body text)

   If "design" or "all":
     - Extract font palette from all computed styles
     - Build color palette from all unique colors
     - Analyze spacing patterns (margins/paddings)
     - Compare component styles across instances
   ```

5. **Generate comprehensive markdown report** (see Report Template section below)

6. **Save report to file**:
   ```
   Generate timestamp: YYYYMMDDTHHmmss
   Default path if not specified: /tmp/screenshot_analysis_{timestamp}.md

   Call: Write({
     file_path: outputPath,
     content: markdownReport
   })
   ```

7. **Return JSON summary**:
   ```json
   {
     "reportPath": "/tmp/screenshot_analysis_20251222_115810.md",
     "summary": {
       "total": 47,
       "critical": 3,
       "high": 12,
       "medium": 18,
       "low": 14
     },
     "screenshots": [
       "/tmp/segment_001_header.png",
       "/tmp/segment_002_main.png",
       "/tmp/segment_003_footer.png"
     ],
     "wcagCompliance": {
       "AA": {
         "passed": false,
         "percentage": 78,
         "failures": ["1.4.3 Contrast", "2.4.7 Focus Visible"]
       },
       "AAA": {
         "passed": false,
         "percentage": 45,
         "failures": ["1.4.6 Contrast (Enhanced)", "2.4.7 Focus Visible", "1.4.8 Visual Presentation"]
       }
     }
   }
   ```

## Workflow 2: Accessibility-Only Analysis

**Use when**: User specifically requests WCAG compliance checking

**Instructions for main conversation:**

1. **Read screenshots** (same as Workflow 1, step 1)

2. **Extract DOM from tab if available** (same as Workflow 1, step 2)

3. **Get computed styles for contrast calculation**:
   ```
   Call: mcp__browser__browser_query_dom({
     selector: "*[class], *[id], a, button, input, label, p, h1, h2, h3, h4, h5, h6",
     limit: 100,
     tabTarget: tabTarget
   })

   For each element returned:
     Call: mcp__browser__browser_get_computed_styles({
       selector: "{element's selector}",
       properties: ["color", "background-color", "font-size", "font-weight"],
       tabTarget: tabTarget
     })
   ```

4. **Run accessibility checks only**:
   ```
   Color Contrast Calculation:
   - Extract foreground color (text color)
   - Extract background color
   - Calculate contrast ratio using formula:
     L = relative luminance = 0.2126*R + 0.7152*G + 0.0722*B (sRGB)
     ratio = (lighter + 0.05) / (darker + 0.05)
   - Check WCAG compliance:
     * WCAG AA: 4.5:1 for normal text, 3:1 for large text (18pt+/14pt+ bold)
     * WCAG AAA: 7:1 for normal text, 4.5:1 for large text

   Alt Text Verification:
   - From ARIA tree, find all <img> tags
   - Flag images without alt attribute
   - Flag decorative images without alt="" or role="presentation"

   ARIA Label Verification:
   - Check interactive elements (buttons, links, inputs) for aria-label or aria-labelledby
   - Verify ARIA roles match element semantics

   Semantic HTML Check:
   - Verify proper heading hierarchy (h1 → h2 → h3, not h1 → h4)
   - Check for landmark regions (<nav>, <main>, <aside>, <footer>)
   - Flag excessive non-semantic divs

   Keyboard Navigation Check:
   - Verify focus indicators exist (:focus styles in computed styles)
   - Check tabindex attributes for proper tab order
   - Look for keyboard traps (focus stuck in modal/dialog)

   Text Sizing Check:
   - Flag text smaller than 16px for body content
   - Check for responsive font sizing (rem/em vs px)
   ```

5. **Generate focused accessibility report** (see Accessibility Report Template)

6. **Return WCAG compliance breakdown**:
   ```json
   {
     "reportPath": "/tmp/accessibility_analysis_20251222_115810.md",
     "wcagCompliance": {
       "AA": {
         "passed": false,
         "percentage": 78,
         "criteria": {
           "1.4.3 Contrast (Minimum)": { "passed": false, "details": "12 failures" },
           "1.3.1 Info and Relationships": { "passed": true, "details": "All landmarks present" },
           "2.4.7 Focus Visible": { "passed": false, "details": "No focus indicators on buttons" }
         }
       },
       "AAA": {
         "passed": false,
         "percentage": 45,
         "criteria": {
           "1.4.6 Contrast (Enhanced)": { "passed": false, "details": "18 failures" }
         }
       }
     }
   }
   ```

## Workflow 3: Existing Tab Analysis

**Use when**: User wants analysis of an already-open tab without navigation

**Instructions for main conversation:**

1. **Read screenshots** (same as Workflow 1, step 1)

2. **Extract live DOM without navigation**:
   ```
   IMPORTANT: Skip browser_navigate, use existing tabTarget

   Call: mcp__browser__browser_snapshot({ tabTarget: tabTarget })

   Call: mcp__browser__browser_query_dom({
     selector: selectors.join(", "),  // if selectors provided
     limit: 50,
     tabTarget: tabTarget
   })

   Call: mcp__browser__browser_get_visible_text({
     maxLength: 5000,
     tabTarget: tabTarget
   })
   ```

3. **Run all analysis algorithms** (same as Workflow 1, step 4)

4. **Generate report with live DOM context** (same as Workflow 1, step 5)

5. **Return summary** (same as Workflow 1, step 7)

## Analysis Algorithm Details

### Visual/Layout Analysis

**Check these issues**:

1. **Alignment Detection**:
   - Extract element positions from DOM (getBoundingClientRect equivalent)
   - Group elements by alignment type (left, center, right, top, bottom)
   - Flag misaligned elements (e.g., buttons not aligned in a row)

2. **Spacing Consistency**:
   - Extract all margin and padding values from computed styles
   - Build histogram of spacing values
   - Flag inconsistencies (e.g., 8px in one place, 12px in another)
   - Suggest spacing scale (4px, 8px, 16px, 24px, 32px)

3. **Overlapping Elements**:
   - Extract bounding boxes from DOM
   - Detect elements with overlapping coordinates
   - Check z-index conflicts
   - Flag unintended overlaps (not modals or dropdowns)

4. **Viewport Issues**:
   - Check if content width exceeds viewport width (horizontal scrollbar)
   - Detect clipping at viewport edges
   - Flag content that extends beyond visible area

5. **Visual Hierarchy**:
   - Extract font-size, font-weight, color from all text elements
   - Check heading order (h1 should be largest, h2 next, etc.)
   - Verify proper hierarchy (h1 → h2 → h3, not h1 → h4)
   - Check contrast between hierarchy levels

### Accessibility Analysis

**Check these WCAG 2.1 criteria**:

1. **Color Contrast (1.4.3 Level AA, 1.4.6 Level AAA)**:
   ```
   For each text element:
     Extract foreground color (color property)
     Extract background color (background-color property)

     Calculate luminance:
     function luminance(r, g, b):
       [rs, gs, bs] = [r, g, b].map(c => {
         c = c / 255
         return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
       })
       return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs

     Calculate contrast ratio:
     ratio = (lighter + 0.05) / (darker + 0.05)

     Check compliance:
     isLargeText = fontSize >= 18pt OR (fontSize >= 14pt AND fontWeight >= 700)

     WCAG AA:
       normalText: ratio >= 4.5
       largeText: ratio >= 3

     WCAG AAA:
       normalText: ratio >= 7
       largeText: ratio >= 4.5

     Flag failures as critical severity
   ```

2. **Alt Text (1.1.1 Level A)**:
   - Extract all `<img>` elements from ARIA tree
   - Check for alt attribute presence
   - Verify decorative images have `alt=""` or `role="presentation"`
   - Flag missing alt text as high severity

3. **ARIA Labels (4.1.2 Level A)**:
   - Extract all interactive elements (buttons, links, inputs)
   - Check for aria-label, aria-labelledby, or visible text content
   - Verify ARIA roles match element semantics (role="button" on <div> is okay if labeled)
   - Flag missing labels as high severity

4. **Semantic HTML (1.3.1 Level A)**:
   - Check heading hierarchy (h1 → h2 → h3, no skipping)
   - Verify landmark regions exist: `<nav>`, `<main>`, `<aside>`, `<footer>`
   - Count divs vs semantic elements (flag excessive div soup)
   - Flag improper heading order as medium severity

5. **Keyboard Navigation (2.4.7 Level AA)**:
   - Check for :focus styles in computed styles
   - Verify tabindex attributes don't break tab order
   - Look for keyboard traps (focus cannot leave modal)
   - Flag missing focus indicators as critical severity

6. **Text Sizing (1.4.4 Level AA)**:
   - Extract font-size from all text elements
   - Flag text < 16px for body content (medium severity)
   - Check for responsive sizing (rem/em preferred over px)
   - Flag fixed pixel sizing as low severity

### Design Consistency Analysis

**Check these patterns**:

1. **Font Palette**:
   ```
   Extract from all elements:
     font-family
     font-size
     font-weight
     line-height

   Build palette:
     "Roboto 16px/24px 400" - Body text (12 instances)
     "Roboto 20px/28px 700" - Headings (8 instances)

   Detect variations:
     Group similar sizes (15.5px, 16px, 16.5px within 1px)
     Flag inconsistencies: "3 variations found - recommend standardizing to 16px"

   Severity: medium for variations, low for optimization suggestions
   ```

2. **Color Palette**:
   ```
   Extract all unique colors from computed styles:
     color property
     background-color property
     border-color property

   Group similar colors:
     Calculate color distance (Euclidean in RGB space)
     Group colors within 5% of each other

   Flag excessive variations:
     "5 shades of blue found: #007bff, #0056b3, #0062cc, #004085, #003d7a"
     Recommendation: "Use design tokens for consistent color palette"

   Severity: low for color variations
   ```

3. **Spacing Patterns**:
   ```
   Extract all margin and padding values:
     margin-top, margin-right, margin-bottom, margin-left
     padding-top, padding-right, padding-bottom, padding-left

   Build histogram:
     4px: 23 instances
     8px: 45 instances
     12px: 2 instances   ← Flag as arbitrary
     16px: 67 instances
     27px: 1 instance    ← Flag as arbitrary

   Detect scale:
     Common scales: 4px base (4, 8, 16, 24, 32, 48, 64)
                    8px base (8, 16, 24, 32, 40, 48)

   Flag arbitrary values:
     "8 arbitrary values found (12px, 27px, etc.)"
     Recommendation: "Use spacing tokens based on 8px scale"

   Severity: medium for arbitrary values
   ```

4. **Component Consistency**:
   ```
   If same selector appears multiple times:
     Compare styles across instances

   Example: All buttons should have same styles
     Extract styles for "button.primary" in different locations
     Compare: font-size, padding, border-radius, background-color

   Flag differences:
     "Button styles inconsistent across 3 instances"
     "Instance 1: padding 8px 16px, border-radius 4px"
     "Instance 2: padding 10px 20px, border-radius 6px"
     Recommendation: "Create shared button component or CSS class"

   Severity: medium for style inconsistencies
   ```

## Severity Categorization

**Use these rules**:

- **Critical**: Completely blocks users, WCAG Level A failures
  - Examples: contrast ratio < 3:1, no focus indicators, missing form labels

- **High**: Major usability issues, WCAG Level AA failures
  - Examples: contrast ratio 3:1-4.5:1, missing alt text, overlapping elements

- **Medium**: Noticeable inconsistencies, WCAG Level AAA failures
  - Examples: spacing variations, alignment issues, font size variations, contrast ratio 4.5:1-7:1

- **Low**: Minor polish items, optimization suggestions
  - Examples: color palette optimization, spacing scale suggestions, design token recommendations

## Report Template

Generate a markdown report with this structure:

```markdown
# Screenshot Analysis Report

**Generated**: {ISO 8601 timestamp}
**Screenshots Analyzed**: {count}
**Analysis Types**: {visual, accessibility, design}

## Executive Summary

- **Total Issues**: {total}
- **Critical**: {critical_count} (must fix immediately)
- **High**: {high_count} (fix soon)
- **Medium**: {medium_count} (address in iteration)
- **Low**: {low_count} (optimize over time)
- **WCAG 2.1 AA Compliance**: {PASS/FAIL} ({percentage}%)
- **WCAG 2.1 AAA Compliance**: {PASS/FAIL} ({percentage}%)

---

## Critical Issues

{if no critical issues: "✅ No critical issues found"}

{for each critical issue:}

### {Issue Title} - `{selector}`

**Severity**: Critical
**Category**: {Visual/Accessibility/Design}
**Screenshot**: `{path}`

**Description**: {detailed explanation of what's wrong}

**Impact**: {how this affects users - be specific about accessibility barriers}

**Recommendation**: {specific fix with code example if applicable}

**WCAG Reference**: {e.g., "WCAG 2.1 SC 1.4.3 Contrast (Minimum) - Level AA"}

---

## High Priority Issues

{repeat same structure as critical issues}

## Medium Priority Issues

{repeat same structure}

## Low Priority Issues

{repeat same structure}

---

## Accessibility Compliance

### WCAG 2.1 Level AA

- {✅/❌} **1.4.3 Contrast (Minimum)**: {passed/failed} - {details}
  - {if failed: list specific failures with selectors}
- {✅/❌} **1.3.1 Info and Relationships**: {passed/failed} - {details}
- {✅/❌} **2.4.7 Focus Visible**: {passed/failed} - {details}
- {✅/❌} **1.1.1 Non-text Content**: {passed/failed} - {details}
- {✅/❌} **4.1.2 Name, Role, Value**: {passed/failed} - {details}

### WCAG 2.1 Level AAA

- {✅/❌} **1.4.6 Contrast (Enhanced)**: {passed/failed} - {details}
- {✅/❌} **1.4.8 Visual Presentation**: {passed/failed} - {details}
- {✅/❌} **2.4.8 Location**: {passed/failed} - {details}

---

## Design Consistency Analysis

### Font Palette

**Detected Fonts**:
- `Roboto 16px/24px 400` - Body text ({count} instances)
- `Roboto 20px/28px 700` - Headings ({count} instances)
- `Roboto 14px/20px 400` - Small text ({count} instances)

**Issues**:
{if variations found:}
- {count} font size variations detected: {list variations}
- **Recommendation**: Standardize to design tokens

{if no issues: "✅ Font usage is consistent"}

### Color Palette

**Primary Colors**:
- Primary: `{hex}` ({count} instances)
- Secondary: `{hex}` ({count} instances)
- Accent: `{hex}` ({count} instances)

**Issues**:
{if variations found:}
- {count} color variations within 5% of primary: {list variations}
- **Recommendation**: Use CSS variables or design tokens

{if no issues: "✅ Color palette is consistent"}

### Spacing Scale

**Detected Scale**: {e.g., "4px, 8px, 16px, 24px, 32px"}

**Issues**:
{if arbitrary values found:}
- {count} arbitrary spacing values: {list values like "13px, 27px"}
- **Recommendation**: Adopt systematic spacing scale (suggest 8px base)

{if no issues: "✅ Spacing follows consistent scale"}

### Component Consistency

**Components Analyzed**: {button, input, card, etc.}

**Issues**:
{for each inconsistent component:}
- **{component type}**: {count} style variations detected
  - Instance 1: {styles}
  - Instance 2: {styles}
  - **Recommendation**: {suggestion}

{if no issues: "✅ Components are styled consistently"}

---

## Recommendations Summary

### Immediate Actions (Critical/High)

1. Fix color contrast failures on: `{selectors}`
   - Suggested colors: {provide specific hex values that meet WCAG AA}
2. Add focus indicators to interactive elements: `{selectors}`
   - Suggested CSS: `outline: 2px solid #007bff; outline-offset: 2px;`
3. Add alt text to images: `{selectors}`

### Short-term Improvements (Medium)

1. Standardize spacing using design tokens
   - Implement 8px spacing scale
2. Align elements consistently: `{selectors}`
3. Fix font size variations: {list specific changes}

### Long-term Optimizations (Low)

1. Implement comprehensive design token system
2. Create component library for consistency
3. Establish WCAG AAA compliance roadmap

---

## Screenshot References

{for each screenshot:}
- `{path}` - {description based on selector, e.g., "Header section"}

---

**Report generated by Unibrowse Screenshot Analysis Module**
**Timestamp**: {ISO 8601 timestamp}
```

## Accessibility Report Template

For accessibility-only analysis, use this focused template:

```markdown
# Accessibility Audit Report

**Generated**: {ISO 8601 timestamp}
**Screenshots Analyzed**: {count}
**WCAG Version**: 2.1
**Target Compliance**: {AA/AAA}

## Executive Summary

- **WCAG 2.1 AA Compliance**: {PASS/FAIL} ({percentage}%)
- **WCAG 2.1 AAA Compliance**: {PASS/FAIL} ({percentage}%)
- **Total Accessibility Issues**: {total}
- **Critical (Level A)**: {count}
- **High (Level AA)**: {count}
- **Medium (Level AAA)**: {count}

---

## Critical Accessibility Barriers (Level A)

{Must be fixed to meet minimum legal requirements}

{for each Level A failure:}

### {Issue Title} - `{selector}`

**WCAG Criterion**: {e.g., "1.1.1 Non-text Content (Level A)"}
**Screenshot**: `{path}`

**What's Wrong**: {explanation}

**Why It Matters**: {impact on users with disabilities}

**How to Fix**: {specific recommendation with code}

**Example**:
```css
/* Before */
img.logo { ... }

/* After */
<img class="logo" alt="Company Name Logo" ... >
```

---

## High Priority Issues (Level AA)

{Should be fixed to meet industry standard accessibility}

{repeat same structure}

## Medium Priority Issues (Level AAA)

{Nice to have for enhanced accessibility}

{repeat same structure}

---

## WCAG 2.1 Success Criteria Checklist

### Level A (Critical)

- {✅/❌} **1.1.1 Non-text Content**: {status} - {details}
- {✅/❌} **1.3.1 Info and Relationships**: {status} - {details}
- {✅/❌} **2.1.1 Keyboard**: {status} - {details}
- {✅/❌} **4.1.2 Name, Role, Value**: {status} - {details}

### Level AA (Standard)

- {✅/❌} **1.4.3 Contrast (Minimum)**: {status} - {details}
- {✅/❌} **2.4.7 Focus Visible**: {status} - {details}
- {✅/❌} **1.4.4 Resize Text**: {status} - {details}

### Level AAA (Enhanced)

- {✅/❌} **1.4.6 Contrast (Enhanced)**: {status} - {details}
- {✅/❌} **1.4.8 Visual Presentation**: {status} - {details}
- {✅/❌} **2.4.8 Location**: {status} - {details}

---

## Recommended Fixes

### Color Contrast Failures

{for each contrast failure:}
- **Element**: `{selector}`
- **Current**: {foreground} on {background} = {ratio}:1
- **Required**: {4.5/7}:1 for {normal/large} text
- **Suggested Fix**: Change {foreground/background} to `{hex}` for {ratio}:1 contrast

### Missing Alt Text

{for each missing alt:}
- **Image**: `{selector}` in `{screenshot}`
- **Suggested Alt**: "{description based on context}"

### Missing Focus Indicators

{for each missing focus:}
- **Element**: `{selector}`
- **Suggested CSS**:
  ```css
  {selector}:focus {
    outline: 2px solid #007bff;
    outline-offset: 2px;
  }
  ```

---

**Report generated by Unibrowse Screenshot Analysis Module**
**Timestamp**: {ISO 8601 timestamp}
```

## Error Handling

**Handle these scenarios**:

1. **Screenshot Read Failures**:
   - Try to read screenshot with Read tool
   - If fails, skip and note in report: "⚠️ Could not read screenshot: {path}"
   - Continue with remaining screenshots

2. **DOM Extraction Failures**:
   - If browser_snapshot fails, perform visual-only analysis
   - Note in report: "⚠️ DOM extraction failed - analysis based on screenshots only"
   - Limit to visual analysis, note that accessibility checks are limited

3. **Invalid Selectors**:
   - If browser_query_dom returns no elements, note in report
   - "⚠️ Selector '{selector}' matched no elements"
   - Continue with other selectors

4. **Navigation Failures**:
   - If browser_navigate fails, use screenshots only
   - Warn in report: "⚠️ Could not navigate to {url} - using screenshots without DOM context"
   - Accessibility analysis will be limited

## Return Format

**Always return JSON summary** at the end of analysis:

```json
{
  "reportPath": "/tmp/screenshot_analysis_20251222_115810.md",
  "summary": {
    "total": 47,
    "critical": 3,
    "high": 12,
    "medium": 18,
    "low": 14
  },
  "screenshots": [
    "/tmp/segment_001_header.png",
    "/tmp/segment_002_main.png",
    "/tmp/segment_003_footer.png"
  ],
  "analysisTypes": ["visual", "accessibility", "design"],
  "wcagCompliance": {
    "AA": {
      "passed": false,
      "percentage": 78,
      "failures": [
        "1.4.3 Contrast (Minimum)",
        "2.4.7 Focus Visible"
      ]
    },
    "AAA": {
      "passed": false,
      "percentage": 45,
      "failures": [
        "1.4.6 Contrast (Enhanced)",
        "2.4.7 Focus Visible",
        "1.4.8 Visual Presentation"
      ]
    }
  },
  "topIssues": [
    {
      "severity": "critical",
      "title": "Insufficient color contrast on primary buttons",
      "selector": "button.primary",
      "wcagCriterion": "1.4.3 Contrast (Minimum)"
    },
    {
      "severity": "high",
      "title": "Missing alt text on product images",
      "selector": "img.product",
      "wcagCriterion": "1.1.1 Non-text Content"
    }
  ]
}
```

## Important Notes

1. **Always read screenshots first** - Use Read tool before attempting analysis
2. **Use actual DOM when available** - Provides accurate computed styles and structure
3. **Be specific in recommendations** - Provide exact CSS fixes with code examples
4. **Prioritize accessibility** - WCAG failures are always critical/high severity
5. **Compare across screenshots** - Consistency issues span multiple elements
6. **Save to /tmp by default** - Follow MCP file output preferences
7. **Generate unique timestamps** - Format: `YYYYMMDDTHHmmss` (e.g., 20251222_115810)
8. **Provide actionable recommendations** - Not just "fix contrast" but "change #007bff to #0056b3 for 4.7:1 ratio"

## Tab Context Preservation

**Return tab metadata** for multi-turn workflows:

```json
{
  "tabId": 123,
  "tabLabel": "screenshot-analysis",
  "url": "https://example.com",
  "reportPath": "/tmp/screenshot_analysis_20251222_115810.md",
  "summary": { ... }
}
```

**For follow-up requests**, specify `tabTarget` to continue in same tab:
```
User: "Run another analysis with different selectors"

Call: mcp__browser__browser_query_dom({
  selector: ".new-selector",
  tabTarget: 123  // Use stored tab ID
})
```

## Success Criteria

A successful analysis includes:
- ✅ All screenshots read and analyzed
- ✅ At least one analysis type completed (visual, accessibility, or design)
- ✅ Report generated with specific, actionable recommendations
- ✅ Report saved to file (default: /tmp)
- ✅ Valid JSON summary returned with issue counts
- ✅ WCAG compliance assessed (if accessibility analysis performed)
- ✅ Severity categorization applied (critical, high, medium, low)
- ✅ Code examples provided for fixes where applicable

## Quick Reference

### Common Commands for Screenshot Analysis

**Capture segmented screenshots**:
```
Call: mcp__browser__browser_segmented_screenshot({
  selectors: [".header", ".main", ".footer"],
  outputDir: "/tmp",
  prefix: "analysis",
  includeLabels: true,
  tabTarget: tabId
})

Returns: Array of screenshot paths
Store these paths for analysis input
```

**Get element styles**:
```
Call: mcp__browser__browser_get_computed_styles({
  selector: ".element",
  properties: ["color", "background-color", "font-size", "font-weight"],
  tabTarget: tabId
})
```

**Calculate contrast ratio**:
```
Given:
  foreground = { r: 255, g: 255, b: 255 }  // white
  background = { r: 0, g: 123, b: 255 }    // blue #007bff

Calculate luminance:
  L_fg = 0.2126 * (255/255)^2.4 + 0.7152 * (255/255)^2.4 + 0.0722 * (255/255)^2.4 = 1.0
  L_bg = 0.2126 * (0/255)^2.4 + 0.7152 * (123/255)^2.4 + 0.0722 * (255/255)^2.4 ≈ 0.127

Calculate ratio:
  ratio = (1.0 + 0.05) / (0.127 + 0.05) = 1.05 / 0.177 ≈ 5.93:1

Check compliance:
  WCAG AA (4.5:1): ✅ PASS
  WCAG AAA (7:1): ❌ FAIL
```

## Token Conservation

- **Use maxLength on text extraction**: Always limit to 3000-5000 characters
- **Limit DOM queries**: Use specific selectors, set reasonable limits (10-50 elements)
- **Avoid full snapshots when possible**: Use targeted queries instead
- **Process screenshots in batches**: If > 10 screenshots, analyze in groups
- **Summarize in report**: Don't include full DOM or styles in report, only issues

## Remember

When analyzing screenshots:
1. Read all screenshot files first
2. Extract DOM context if URL or tab provided
3. Run appropriate analysis types (visual, accessibility, design, or all)
4. Generate detailed markdown report with specific recommendations
5. Save report to /tmp (or specified path)
6. Return JSON summary with issue counts and WCAG compliance
7. Store tab metadata for follow-up requests
8. Be specific - provide code examples, exact colors, precise measurements
9. Prioritize accessibility - WCAG failures are critical/high priority
10. Focus on actionable recommendations - tell users exactly what to change
