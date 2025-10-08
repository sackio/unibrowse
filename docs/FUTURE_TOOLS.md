# Future Tools & Enhancements

This document outlines tools that are planned or partially implemented in Browser MCP.

## Table of Contents
- [Recording/Learning Tool](#recordinglearning-tool)
- [Placeholder Tools Needing Implementation](#placeholder-tools-needing-implementation)
- [Future Tool Ideas](#future-tool-ideas)

---

## Recording/Learning Tool

### Overview
A "learn by watching" system where the MCP can ask users to demonstrate workflows, capturing all interactions to create replayable action sequences.

### Status
🔴 **Not Implemented** - Planned

### User Flow
```
1. MCP calls browser_start_recording("Add item to cart")
2. Extension shows floating recording UI in page
3. User performs actions (clicks, types, navigates)
4. All interactions captured with rich element context
5. User clicks "Complete" button
6. Extension returns structured action sequence to MCP
```

### Visual UI Design
```
┌────────────────────────────────────────┐
│ 🔴 Recording: "Add item to cart"      │
│ ⏱️  00:45    [Pause] [Complete]        │
│                                        │
│ Last action:                           │
│ ✓ Clicked "Add to Cart" button       │
└────────────────────────────────────────┘
```

### Technical Architecture

#### 1. Content Script (extension/content-script.js)
Injected into the page to capture user interactions in real-time.

**Key Components:**
```javascript
class RecordingSession {
  constructor(sessionId, description)
  attachListeners()          // DOM event listeners
  captureElementContext()    // Rich element metadata
  generateCSSSelector()      // Multiple selector strategies
  recordAction()             // Store and stream actions
  createRecordingUI()        // Floating recording widget
}
```

**Captured Events:**
- `click` - All click events with button info
- `input` - Text input with sanitization
- `submit` - Form submissions
- `change` - Select/checkbox changes
- `keydown` - Special keys (Enter, Tab, etc.)
- `navigation` - Page transitions

**Element Context Captured:**
```javascript
{
  // Selector strategies (multiple for robustness)
  cssSelector: "#add-to-cart-button",
  xpath: "//*[@id='add-to-cart-button']",
  dataTestId: "add-cart-btn",

  // Visual/semantic info
  tagName: "button",
  text: "Add to Cart",
  value: "",
  placeholder: "",

  // Attributes
  id: "add-to-cart-button",
  className: "a-button-primary",
  name: "add-to-cart",
  type: "button",
  role: "button",
  ariaLabel: "Add to shopping cart",

  // Position & visibility
  rect: { x: 100, y: 200, width: 150, height: 40 },
  visible: true,

  // Context for resilience
  parentText: "Product: Mechanical Keyboard",
  nearbyText: "$79.99"
}
```

#### 2. Extension Background Handler
Manages recording sessions and communicates with MCP.

```javascript
class RecordingManager {
  startRecording({ sessionId, description, tabId })
  stopRecording({ sessionId })
  pauseRecording({ sessionId })
  resumeRecording({ sessionId })
  onRecordedEvent({ sessionId, action })  // Real-time streaming
}
```

#### 3. MCP Server Tools

**browser_start_recording**
```typescript
{
  name: "browser_start_recording",
  description: "Start recording user interactions to learn a workflow",
  arguments: {
    description: string,      // What to demonstrate
    maxDuration?: number,     // Max seconds (default: 300)
    streamEvents?: boolean    // Stream in real-time (default: false)
  }
}
```

**browser_stop_recording**
```typescript
{
  name: "browser_stop_recording",
  description: "Stop recording and get the captured workflow",
  arguments: {
    sessionId: string         // From start_recording
  }
}
```

**browser_replay_recording** (future)
```typescript
{
  name: "browser_replay_recording",
  description: "Replay a previously recorded workflow",
  arguments: {
    recording: RecordedWorkflow,
    speed?: number,           // Playback speed multiplier
    pauseOnError?: boolean    // Stop if step fails
  }
}
```

#### 4. Output Format

```javascript
{
  sessionId: "uuid-1234",
  description: "Add item to cart",
  duration: 45000,          // milliseconds
  startUrl: "https://amazon.com",
  endUrl: "https://amazon.com/cart",

  actions: [
    {
      step: 1,
      timestamp: 0,         // ms from start
      type: "click",
      target: {
        selector: ".s-result-item:nth-child(1) .a-button-primary",
        text: "Mechanical Keyboard - $79.99",
        role: "button",
        description: "First product in search results"
      },
      result: {
        navigation: true,
        newUrl: "https://amazon.com/dp/B08...",
        pageLoadTime: 1200
      }
    },
    {
      step: 2,
      timestamp: 3200,
      type: "click",
      target: {
        selector: "#add-to-cart-button",
        text: "Add to Cart",
        role: "button"
      },
      result: {
        cartItemCount: 1,
        modalAppeared: true,
        modalSelector: "#a-popover-1"
      }
    }
  ],

  summary: {
    totalClicks: 3,
    totalTypes: 0,
    pagesVisited: 3,
    formsSubmitted: 0,
    elementsInteracted: [
      { selector: ".s-result-item", count: 1 },
      { selector: "#add-to-cart-button", count: 1 },
      { selector: "#nav-cart", count: 1 }
    ]
  }
}
```

### Key Features

#### 1. Smart Element Identification
- **Multiple selector strategies**: CSS, XPath, data-testid, role, aria-label
- **Fallback mechanisms**: If primary selector fails, try alternatives
- **Visual landmarks**: "Button below heading 'Product Details'"
- **Semantic context**: Use aria-label, role, surrounding text
- **Robustness scoring**: Rate each selector's reliability

#### 2. Event Filtering & Deduplication
- Ignore mousemove unless hover is semantically important
- Deduplicate rapid events (double-clicks, bounce)
- Filter accidental clicks (immediate undo)
- Focus on meaningful interactions only
- Group related events (type sequence → single "fill field" action)

#### 3. Privacy & Security
- **Mask sensitive fields**: Passwords, credit cards, SSN
- **Sanitize recorded data**: Remove PII
- **User consent**: Clear warning before recording starts
- **Secure storage**: Encrypt recordings at rest
- **Expiration**: Auto-delete old recordings

#### 4. Real-time Feedback
- Show each action as captured in floating UI
- Live preview: "3 clicks, 2 form fields, 1 navigation"
- Action counter and elapsed time
- Visual confirmation for each step
- Undo last action button

#### 5. Session Management
- **Pause/Resume**: Temporarily stop recording
- **Cancel**: Discard entire session
- **Save Draft**: Store partial recording
- **Multiple sessions**: Track different workflows simultaneously
- **Session metadata**: Tags, notes, difficulty rating

### Use Cases

#### 1. Learning Complex Workflows
```
Scenario: MCP needs to learn a multi-step process
→ MCP: "I need to learn how to book a flight on this site"
→ Start recording: "Book a round-trip flight"
→ User demonstrates: search → select dates → choose flight → fill form → pay
→ MCP receives structured 15-step workflow
→ Can now automate similar bookings
```

#### 2. Building Test Automation
```
Scenario: Create regression tests
→ Record: "User registration flow"
→ User performs: fill form → verify email → login
→ MCP converts to automated test
→ Replay for regression testing
```

#### 3. Overcoming Complex UIs
```
Scenario: MCP struggles with JavaScript-heavy SPA
→ MCP: "I can't figure out how to open the settings menu"
→ Start recording: "Open settings"
→ User clicks hamburger → hovers → clicks nested item
→ MCP learns the exact sequence including timing
```

#### 4. Data Extraction Patterns
```
Scenario: Scraping requires interaction
→ Record: "Extract all product details"
→ User clicks tabs, expands sections, scrolls
→ MCP learns interaction pattern for data access
```

### Implementation Priority

**Phase 1: Basic Recording**
- Content script injection
- Click and input capture
- Simple selector generation
- Floating UI widget
- Stop/complete recording

**Phase 2: Rich Context**
- Multiple selector strategies
- Navigation tracking
- Form submission detection
- Element context metadata

**Phase 3: Advanced Features**
- Pause/resume
- Real-time streaming to MCP
- Sensitive data masking
- Session management

**Phase 4: Replay & Learning**
- Replay recorded workflows
- Fuzzy matching (handle UI changes)
- Confidence scoring
- Error recovery

### Open Questions

1. **Streaming vs Batch**: Stream events to MCP in real-time or return all at end?
2. **Storage**: Where to store recordings? Extension storage, MCP server, or both?
3. **Privacy**: How explicit should consent be? Require opt-in per session?
4. **Selector generation**: Which strategy should be primary? Most robust vs most readable?
5. **Replay timing**: Should replays preserve exact timing or adapt to page performance?

---

## Placeholder Tools Needing Implementation

These tools have basic handlers but need full implementation:

### browser_drag
**Status**: 🟡 Placeholder
**Handler Location**: `extension/background.js:380`

**Current State**:
```javascript
async handleDrag({ startElement, startRef, endElement, endRef }) {
  // TODO: Drag and drop
  return { success: true };
}
```

**Needed Implementation**:
```javascript
async handleDrag({ startElement, startRef, endElement, endRef }) {
  // Get start element position
  const startEl = await this.cdp.querySelector(startRef);
  const endEl = await this.cdp.querySelector(endRef);

  if (!startEl || !endEl) {
    throw new Error('Element not found');
  }

  // Calculate coordinates
  const startX = startEl.rect.x + startEl.rect.width / 2;
  const startY = startEl.rect.y + startEl.rect.height / 2;
  const endX = endEl.rect.x + endEl.rect.width / 2;
  const endY = endEl.rect.y + endEl.rect.height / 2;

  // Perform drag with CDP
  await this.cdp.sendCommand('Input.dispatchDragEvent', {
    type: 'dragStart',
    x: startX,
    y: startY
  });

  // Move through intermediate points for smooth drag
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const x = startX + (endX - startX) * (i / steps);
    const y = startY + (endY - startY) * (i / steps);

    await this.cdp.sendCommand('Input.dispatchDragEvent', {
      type: 'dragOver',
      x, y
    });

    await new Promise(resolve => setTimeout(resolve, 20));
  }

  await this.cdp.sendCommand('Input.dispatchDragEvent', {
    type: 'drop',
    x: endX,
    y: endY
  });

  return { success: true, startElement, endElement };
}
```

**MCP Tool**: Already defined in common.ts, just needs extension handler.

---

### browser_select_option
**Status**: 🟡 Placeholder
**Handler Location**: `extension/background.js:384`

**Current State**:
```javascript
async handleSelectOption({ element, ref, values }) {
  // TODO: Select dropdown options
  return { success: true, values };
}
```

**Needed Implementation**:
```javascript
async handleSelectOption({ element, ref, values }) {
  // Use evaluate to select options
  const result = await this.cdp.evaluate(`
    (function() {
      const select = document.querySelector('${ref.replace(/'/g, "\\'")}');
      if (!select) return { success: false, error: 'Element not found' };

      const selectedValues = [];
      const options = Array.from(select.options);

      // Handle both single and multiple select
      const valuesToSelect = Array.isArray(${JSON.stringify(values)})
        ? ${JSON.stringify(values)}
        : [${JSON.stringify(values)}];

      for (const value of valuesToSelect) {
        const option = options.find(opt =>
          opt.value === value ||
          opt.text === value ||
          opt.label === value
        );

        if (option) {
          option.selected = true;
          selectedValues.push(option.value);
        }
      }

      // Trigger change event
      select.dispatchEvent(new Event('change', { bubbles: true }));

      return {
        success: true,
        selectedValues,
        selectedText: options.filter(o => o.selected).map(o => o.text)
      };
    })()
  `);

  return result;
}
```

**MCP Tool**: Already defined in snapshot.ts.

---

### browser_get_visible_text
**Status**: 🟡 Placeholder
**Handler Location**: `extension/background.js:425`

**Current State**:
```javascript
async handleGetVisibleText({ maxLength = 10000 }) {
  return { text: 'TODO: implement visible text' };
}
```

**Needed Implementation**:
```javascript
async handleGetVisibleText({ maxLength = 10000 }) {
  const text = await this.cdp.evaluate(`
    (function() {
      // Get all visible text nodes
      function getVisibleText(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const parent = node.parentElement;
          const style = window.getComputedStyle(parent);

          // Skip invisible elements
          if (style.display === 'none' ||
              style.visibility === 'hidden' ||
              style.opacity === '0') {
            return '';
          }

          return node.textContent.trim();
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
          // Skip script, style, etc.
          if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME'].includes(node.tagName)) {
            return '';
          }

          let text = '';
          for (const child of node.childNodes) {
            text += getVisibleText(child) + ' ';
          }
          return text;
        }

        return '';
      }

      const fullText = getVisibleText(document.body);
      return fullText.replace(/\\s+/g, ' ').trim();
    })()
  `);

  return text.substring(0, maxLength);
}
```

**MCP Tool**: Already defined in exploration.ts.

---

### browser_get_page_metadata
**Status**: 🟡 Placeholder
**Handler Location**: `extension/background.js:429`

**Current State**:
```javascript
async handleGetPageMetadata() {
  return { metadata: {} };
}
```

**Needed Implementation**:
```javascript
async handleGetPageMetadata() {
  const metadata = await this.cdp.evaluate(`
    (function() {
      const meta = {};

      // Basic metadata
      meta.title = document.title;
      meta.url = window.location.href;
      meta.description = document.querySelector('meta[name="description"]')?.content;
      meta.keywords = document.querySelector('meta[name="keywords"]')?.content;

      // Open Graph
      meta.og = {};
      document.querySelectorAll('meta[property^="og:"]').forEach(tag => {
        const key = tag.getAttribute('property').replace('og:', '');
        meta.og[key] = tag.content;
      });

      // Twitter Card
      meta.twitter = {};
      document.querySelectorAll('meta[name^="twitter:"]').forEach(tag => {
        const key = tag.getAttribute('name').replace('twitter:', '');
        meta.twitter[key] = tag.content;
      });

      // Canonical URL
      meta.canonical = document.querySelector('link[rel="canonical"]')?.href;

      // Language
      meta.lang = document.documentElement.lang;

      // Author
      meta.author = document.querySelector('meta[name="author"]')?.content;

      // Viewport
      meta.viewport = document.querySelector('meta[name="viewport"]')?.content;

      // Structured data
      meta.jsonLd = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
        try {
          meta.jsonLd.push(JSON.parse(script.textContent));
        } catch (e) {}
      });

      return meta;
    })()
  `);

  return metadata;
}
```

**MCP Tool**: Already defined in exploration.ts.

---

### browser_find_by_text
**Status**: 🟡 Placeholder
**Handler Location**: `extension/background.js:433`

**Current State**:
```javascript
async handleFindByText({ text, limit = 10 }) {
  return { results: [] };
}
```

**Needed Implementation**:
```javascript
async handleFindByText({ text, limit = 10, exact = false }) {
  const results = await this.cdp.evaluate(`
    (function() {
      const searchText = '${text.replace(/'/g, "\\'")}';
      const exact = ${exact};
      const limit = ${limit};
      const results = [];

      function searchNode(node) {
        if (results.length >= limit) return;

        if (node.nodeType === Node.TEXT_NODE) {
          const content = node.textContent;
          const matches = exact
            ? content === searchText
            : content.toLowerCase().includes(searchText.toLowerCase());

          if (matches) {
            const element = node.parentElement;
            const rect = element.getBoundingClientRect();

            results.push({
              text: content.trim().substring(0, 100),
              tagName: element.tagName,
              selector: generateSelector(element),
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              visible: isVisible(element)
            });
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          for (const child of node.childNodes) {
            searchNode(child);
          }
        }
      }

      function generateSelector(el) {
        if (el.id) return '#' + el.id;
        // ... selector generation logic
      }

      function isVisible(el) {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               style.opacity !== '0';
      }

      searchNode(document.body);
      return results;
    })()
  `);

  return results;
}
```

**MCP Tool**: Already defined in exploration.ts.

---

### Other Placeholder Tools

The following tools have similar TODO implementations and need full CDP-based logic:

- **browser_get_computed_styles** - Get computed CSS for elements
- **browser_check_visibility** - Check if element is visible in viewport
- **browser_get_attributes** - Get all attributes of elements
- **browser_get_filtered_aria_tree** - Get filtered accessibility tree
- **browser_get_form_values** - Extract all form field values
- **browser_check_element_state** - Check checked/disabled/focused state

All these follow similar patterns:
1. Accept element selector or criteria
2. Use `this.cdp.evaluate()` to run JS in page context
3. Return structured data

---

## Future Tool Ideas

### 1. browser_wait_for_element
Wait for element to appear, become visible, or match condition.

```typescript
{
  selector: string,
  condition: "appear" | "visible" | "disappear" | "stable",
  timeout: number  // milliseconds
}
```

### 2. browser_mock_geolocation
Override browser geolocation for testing.

```typescript
{
  latitude: number,
  longitude: number,
  accuracy?: number
}
```

### 3. browser_set_cookies
Set cookies for testing authenticated states.

```typescript
{
  cookies: Array<{
    name: string,
    value: string,
    domain?: string,
    path?: string
  }>
}
```

### 4. browser_intercept_requests
Intercept and modify network requests (for testing/mocking).

```typescript
{
  pattern: string,  // URL pattern
  mockResponse?: object,
  blockRequest?: boolean
}
```

### 5. browser_get_network_log
Get all network requests made by page.

```typescript
{
  includeBody?: boolean,
  filterType?: "xhr" | "fetch" | "document" | "image"
}
```

### 6. browser_get_performance_metrics
Get page performance data.

```typescript
// Returns: load time, DOM ready, largest contentful paint, etc.
```

### 7. browser_execute_async
Execute async JavaScript with Promise support.

```typescript
{
  expression: string,
  timeout?: number
}
```

### 8. browser_listen_event
Listen for specific DOM events and report back.

```typescript
{
  eventType: string,  // "click", "submit", etc.
  selector?: string,
  duration: number    // How long to listen
}
```

### 9. browser_take_video
Record video of browser interactions.

```typescript
{
  duration: number,
  fps?: number
}
```

### 10. browser_accessibility_audit
Run automated accessibility checks.

```typescript
{
  standard: "WCAG2.1" | "Section508"
}
```

---

## Implementation Notes

### Priority Order
1. **High**: Placeholder tools (already have MCP definitions)
2. **High**: browser_evaluate (already implemented)
3. **Medium**: Recording/learning tool (game-changer feature)
4. **Low**: Future tool ideas (nice-to-have)

### Testing Strategy
- Unit tests for each handler
- Integration tests with real pages
- Edge case testing (slow networks, dynamic content)
- Privacy/security audit for recording features

### Documentation Requirements
- Update main README.md with new tools
- Add examples for each tool
- Create tutorial videos for recording feature
- Document security considerations
