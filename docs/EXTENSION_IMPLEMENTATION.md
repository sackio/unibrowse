# Browser Extension Implementation Guide

This document details the implementation requirements for the Browser MCP Chrome extension to support the 11 new DOM exploration tools.

## Overview

The MCP server has been updated with 11 new tools for DOM exploration that minimize token usage while providing powerful inspection capabilities. These tools require corresponding message handlers in the browser extension.

## Architecture

The extension communicates with the MCP server via WebSocket on port 9009. Each tool sends a message type (e.g., `browser_query_dom`) and receives a response from the extension's content script or background service worker.

## Extension Blocker

**Current Status**: The Browser MCP extension source code is not available in the public GitHub repository. Only the MCP server code is open source. The extension is distributed as minified code via the Chrome Web Store.

**Location**: `/home/ben/.config/google-chrome/Profile 1/Extensions/bjfgambnhccakkhmkepdoekmckoijdlc/1.3.4_0/`

**Options to proceed**:
1. Contact BrowserMCP team for source access
2. Reverse engineer the minified extension
3. Create a custom open-source fork
4. Wait for official implementation

## Message Handler Specifications

Each message handler should be implemented in the extension's content script with the following specifications:

---

### 1. `browser_query_dom`

**Purpose**: Query DOM elements by CSS selector and return basic info without full ARIA tree.

**Input**:
```typescript
{
  selector: string;
  limit?: number; // default: 10
}
```

**Implementation**:
```typescript
function handleQueryDOM({ selector, limit = 10 }) {
  const elements = Array.from(document.querySelectorAll(selector));
  const limited = elements.slice(0, limit);

  return limited.map((el, index) => ({
    index,
    tagName: el.tagName.toLowerCase(),
    id: el.id || undefined,
    className: el.className || undefined,
    text: el.textContent?.trim().substring(0, 100) || undefined,
    role: el.getAttribute('role') || undefined,
    ariaLabel: el.getAttribute('aria-label') || undefined,
  }));
}
```

**Output**: Array of element info objects

---

### 2. `browser_get_visible_text`

**Purpose**: Get visible text content from page or specific element.

**Input**:
```typescript
{
  selector?: string;
  maxLength?: number; // default: 5000
}
```

**Implementation**:
```typescript
function handleGetVisibleText({ selector, maxLength = 5000 }) {
  const element = selector ? document.querySelector(selector) : document.body;
  if (!element) return '';

  // Get only visible text
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let text = '';
  let node;
  while ((node = walker.nextNode())) {
    text += node.textContent;
  }

  return text.trim().substring(0, maxLength);
}
```

**Output**: String of visible text

---

### 3. `browser_get_computed_styles`

**Purpose**: Get computed CSS styles for an element.

**Input**:
```typescript
{
  selector: string;
  properties?: string[]; // e.g., ['display', 'color']
}
```

**Implementation**:
```typescript
function handleGetComputedStyles({ selector, properties }) {
  const element = document.querySelector(selector);
  if (!element) return null;

  const computed = window.getComputedStyle(element);

  if (properties) {
    const result: Record<string, string> = {};
    properties.forEach(prop => {
      result[prop] = computed.getPropertyValue(prop);
    });
    return result;
  }

  // Default: common layout properties
  return {
    display: computed.display,
    visibility: computed.visibility,
    position: computed.position,
    width: computed.width,
    height: computed.height,
    opacity: computed.opacity,
    zIndex: computed.zIndex,
  };
}
```

**Output**: Object with CSS property values

---

### 4. `browser_check_visibility`

**Purpose**: Check if element is visible, in viewport, etc.

**Input**:
```typescript
{
  selector: string;
}
```

**Implementation**:
```typescript
function handleCheckVisibility({ selector }) {
  const element = document.querySelector(selector);
  if (!element) return { exists: false };

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return {
    exists: true,
    visible: style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
    inViewport: (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth
    ),
    boundingBox: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    },
    displayStyle: style.display,
    visibilityStyle: style.visibility,
    opacity: style.opacity,
  };
}
```

**Output**: Object with visibility information

---

### 5. `browser_get_attributes`

**Purpose**: Get all or specific attributes of an element.

**Input**:
```typescript
{
  selector: string;
  attributes?: string[]; // e.g., ['href', 'class']
}
```

**Implementation**:
```typescript
function handleGetAttributes({ selector, attributes }) {
  const element = document.querySelector(selector);
  if (!element) return null;

  if (attributes) {
    const result: Record<string, string | null> = {};
    attributes.forEach(attr => {
      result[attr] = element.getAttribute(attr);
    });
    return result;
  }

  // Get all attributes
  const result: Record<string, string> = {};
  for (const attr of element.attributes) {
    result[attr.name] = attr.value;
  }
  return result;
}
```

**Output**: Object with attribute name-value pairs

---

### 6. `browser_count_elements`

**Purpose**: Count number of elements matching a selector.

**Input**:
```typescript
{
  selector: string;
}
```

**Implementation**:
```typescript
function handleCountElements({ selector }) {
  return document.querySelectorAll(selector).length;
}
```

**Output**: Number

---

### 7. `browser_get_page_metadata`

**Purpose**: Get page metadata including Open Graph, schema.org, etc.

**Input**: Empty object

**Implementation**:
```typescript
function handleGetPageMetadata() {
  const getMeta = (name: string) =>
    document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.getAttribute('content');

  const getJsonLd = () => {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    return scripts.map(script => {
      try {
        return JSON.parse(script.textContent || '');
      } catch {
        return null;
      }
    }).filter(Boolean);
  };

  return {
    title: document.title,
    description: getMeta('description'),
    keywords: getMeta('keywords'),
    author: getMeta('author'),

    // Open Graph
    og: {
      title: getMeta('og:title'),
      description: getMeta('og:description'),
      image: getMeta('og:image'),
      url: getMeta('og:url'),
      type: getMeta('og:type'),
    },

    // Twitter Card
    twitter: {
      card: getMeta('twitter:card'),
      title: getMeta('twitter:title'),
      description: getMeta('twitter:description'),
      image: getMeta('twitter:image'),
    },

    // Structured Data
    structuredData: getJsonLd(),

    // Canonical URL
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
  };
}
```

**Output**: Object with metadata

---

### 8. `browser_get_filtered_aria_tree`

**Purpose**: Get ARIA tree with filters to reduce token usage.

**Input**:
```typescript
{
  roles?: string[]; // e.g., ['button', 'link', 'textbox']
  maxDepth?: number; // default: 5
  interactiveOnly?: boolean;
}
```

**Implementation**:
```typescript
function handleGetFilteredAriaTree({ roles, maxDepth = 5, interactiveOnly = false }) {
  const interactiveRoles = ['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'slider', 'menuitem'];

  function buildTree(element: Element, depth: number): any {
    if (depth > maxDepth) return null;

    const role = element.getAttribute('role') || getImplicitRole(element);

    // Apply filters
    if (roles && !roles.includes(role)) return null;
    if (interactiveOnly && !interactiveRoles.includes(role)) return null;

    const node = {
      role,
      name: element.getAttribute('aria-label') || element.textContent?.trim().substring(0, 50),
      children: [] as any[],
    };

    // Recursively build children
    for (const child of element.children) {
      const childNode = buildTree(child, depth + 1);
      if (childNode) node.children.push(childNode);
    }

    return node;
  }

  function getImplicitRole(element: Element): string {
    const tagName = element.tagName.toLowerCase();
    const roleMap: Record<string, string> = {
      'button': 'button',
      'a': 'link',
      'input': element.getAttribute('type') === 'text' ? 'textbox' : 'input',
      'textarea': 'textbox',
      'select': 'combobox',
      // ... more mappings
    };
    return roleMap[tagName] || 'generic';
  }

  return buildTree(document.body, 0);
}
```

**Output**: Filtered ARIA tree object

---

### 9. `browser_find_by_text`

**Purpose**: Find elements containing specific text.

**Input**:
```typescript
{
  text: string;
  selector?: string;
  exact?: boolean; // default: false
  limit?: number; // default: 10
}
```

**Implementation**:
```typescript
function handleFindByText({ text, selector, exact = false, limit = 10 }) {
  const root = selector ? document.querySelector(selector) : document.body;
  if (!root) return [];

  const results: any[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

  let node;
  while ((node = walker.nextNode()) && results.length < limit) {
    const element = node as Element;
    const textContent = element.textContent?.trim() || '';

    const matches = exact
      ? textContent === text
      : textContent.toLowerCase().includes(text.toLowerCase());

    if (matches) {
      results.push({
        tagName: element.tagName.toLowerCase(),
        id: element.id || undefined,
        className: element.className || undefined,
        text: textContent.substring(0, 100),
      });
    }
  }

  return results;
}
```

**Output**: Array of matching elements

---

### 10. `browser_get_form_values`

**Purpose**: Get current values of all form fields.

**Input**:
```typescript
{
  formSelector?: string;
}
```

**Implementation**:
```typescript
function handleGetFormValues({ formSelector }) {
  const forms = formSelector
    ? [document.querySelector(formSelector)]
    : Array.from(document.querySelectorAll('form'));

  const result: Record<string, any> = {};

  forms.forEach((form, formIndex) => {
    if (!form) return;

    const formName = form.id || form.name || `form-${formIndex}`;
    result[formName] = {};

    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach((input: any) => {
      const name = input.name || input.id || `unnamed-${input.type}`;

      if (input.type === 'checkbox' || input.type === 'radio') {
        result[formName][name] = input.checked;
      } else {
        result[formName][name] = input.value;
      }
    });
  });

  return result;
}
```

**Output**: Object with form field values

---

### 11. `browser_check_element_state`

**Purpose**: Check element state (enabled, checked, selected, etc.).

**Input**:
```typescript
{
  selector: string;
}
```

**Implementation**:
```typescript
function handleCheckElementState({ selector }) {
  const element = document.querySelector(selector) as HTMLInputElement;
  if (!element) return { exists: false };

  return {
    exists: true,
    enabled: !element.disabled,
    disabled: element.disabled,
    checked: element.checked || undefined,
    selected: (element as any).selected || undefined,
    readonly: element.readOnly || undefined,
    required: element.required || undefined,
    value: element.value || undefined,
    focused: document.activeElement === element,
  };
}
```

**Output**: Object with element state

---

## Extension Message Handler Registration

In the extension's content script or background service worker, register all message handlers:

```typescript
// Map of message type to handler function
const messageHandlers = {
  browser_query_dom: handleQueryDOM,
  browser_get_visible_text: handleGetVisibleText,
  browser_get_computed_styles: handleGetComputedStyles,
  browser_check_visibility: handleCheckVisibility,
  browser_get_attributes: handleGetAttributes,
  browser_count_elements: handleCountElements,
  browser_get_page_metadata: handleGetPageMetadata,
  browser_get_filtered_aria_tree: handleGetFilteredAriaTree,
  browser_find_by_text: handleFindByText,
  browser_get_form_values: handleGetFormValues,
  browser_check_element_state: handleCheckElementState,
};

// WebSocket message listener
websocket.on('message', (message) => {
  const { type, payload, id } = JSON.parse(message);

  if (messageHandlers[type]) {
    try {
      const result = messageHandlers[type](payload);
      websocket.send(JSON.stringify({ id, result }));
    } catch (error) {
      websocket.send(JSON.stringify({ id, error: error.message }));
    }
  }
});
```

## Testing

Once implemented, test each tool with the MCP server:

```typescript
// Example test queries
await mcp.call('browser_query_dom', { selector: 'button', limit: 5 });
await mcp.call('browser_get_visible_text', { maxLength: 1000 });
await mcp.call('browser_check_visibility', { selector: '#main-header' });
await mcp.call('browser_get_page_metadata', {});
```

## Token Usage Comparison

| Tool | Approximate Tokens | vs Full ARIA Snapshot |
|------|-------------------|----------------------|
| `browser_query_dom` | 200-500 | 98% reduction |
| `browser_get_visible_text` | 500-1500 | 95% reduction |
| `browser_count_elements` | 20-50 | 99.8% reduction |
| `browser_get_page_metadata` | 300-800 | 97% reduction |
| Full ARIA snapshot | 25,000-30,000 | baseline |

## Next Steps

1. **Obtain Extension Source**: Contact BrowserMCP team or reverse engineer
2. **Implement Handlers**: Add all 11 message handlers to content script
3. **Test Integration**: Verify each tool works with MCP server
4. **Performance Test**: Ensure tools respond within 500ms
5. **Documentation**: Update extension README with new capabilities
