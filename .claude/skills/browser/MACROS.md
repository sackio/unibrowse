# Browser Automation Macros Reference

Complete reference for all 57+ macros available in the Unibrowse browser automation system.

## Overview

- **40+ Universal Macros**: Work on any website (7 categories)
- **51 Site-Specific Macros**: Specialized automation for specific websites
  - **17 Amazon Macros**: E-commerce automation
  - **12 Google Shopping Macros**: Product comparison across retailers
  - **5 Walmart Macros**: Walmart e-commerce automation
  - **14 Upwork Macros**: Freelance platform automation
  - **14 Fidelity Macros**: Investment/financial automation
  - **3 OpenGameArt Macros**: Game asset discovery
  - **2 CoinTracker Macros**: Crypto portfolio tracking
  - **1 Google Macro**: Web search automation

**Total Macros**: 91+ (40+ universal + 51 site-specific)

## Site-Specific Macros Documentation

### E-Commerce Sites
- **[Amazon Macros (17)](AMAZON_MACROS.md)** - Product search, reviews analysis, Rufus AI, cart operations
- **[Google Shopping Macros (12)](GOOGLE_SHOPPING_MACROS.md)** - Multi-retailer comparison, price tracking, merchant filtering
- **[Walmart Macros (5)](WALMART_MACROS.md)** - Product search, extraction, sorting, filtering

### Professional & Financial
- **[Upwork Macros (14)](UPWORK_MACROS.md)** - Job search, proposals, messaging, freelance automation
- **[Fidelity Macros (14)](FIDELITY_MACROS.md)** - Portfolio analysis, positions, transactions, reporting

### Other Specialized Sites
- **[OpenGameArt Macros (3)](OPENGAMEART_MACROS.md)** - Asset search, license extraction
- **[CoinTracker Macros (2)](COINTRACKER_MACROS.md)** - Crypto portfolio, tax summaries
- **[Google Macros (1)](GOOGLE_MACROS.md)** - Web search with realistic typing

## Universal Macros (40+)

### Extraction Category (10 macros)

#### `extract_table_data`
**Description**: Extract all tables from page with headers and rows

**Parameters**: None

**Returns**:
```json
{
  "tables": [
    {
      "headers": ["Column 1", "Column 2"],
      "rows": [["Value 1", "Value 2"], ["Value 3", "Value 4"]]
    }
  ]
}
```

**Use Cases**: Scraping data tables, extracting tabular data

---

#### `extract_main_content`
**Description**: Extract main article/content from page (body, title, metadata)

**Parameters**: None

**Returns**:
```json
{
  "title": "Article Title",
  "body": "Article content...",
  "author": "Author Name",
  "publishedDate": "2025-12-10"
}
```

**Use Cases**: Article extraction, blog scraping, content parsing

---

#### `extract_links`
**Description**: Extract all links from page

**Parameters**:
- `selector` (optional): CSS selector to filter links

**Returns**:
```json
{
  "links": [
    { "text": "Link Text", "href": "https://...", "target": "_blank" }
  ]
}
```

**Use Cases**: Link aggregation, sitemap generation, broken link detection

---

#### `extract_images`
**Description**: Extract all images from page

**Parameters**:
- `selector` (optional): CSS selector to filter images

**Returns**:
```json
{
  "images": [
    { "src": "https://...", "alt": "Image description", "width": 800, "height": 600 }
  ]
}
```

**Use Cases**: Image collection, media scraping, gallery extraction

---

#### `get_page_outline`
**Description**: Extract page structure (headings, sections)

**Parameters**: None

**Returns**:
```json
{
  "outline": [
    { "level": 1, "text": "Main Heading" },
    { "level": 2, "text": "Subheading" }
  ]
}
```

**Use Cases**: Document structure analysis, TOC generation

---

#### `get_page_metadata`
**Description**: Extract metadata (title, description, Open Graph, schema.org)

**Parameters**: None

**Returns**:
```json
{
  "title": "Page Title",
  "description": "Page description",
  "openGraph": { "type": "article", "image": "..." },
  "schema": { "@type": "Article", "author": "..." }
}
```

**Use Cases**: SEO analysis, social media preview extraction

---

#### `extract_products`
**Description**: Extract product listings from e-commerce pages

**Parameters**: None

**Returns**:
```json
{
  "products": [
    { "name": "Product Name", "price": "$99.99", "rating": 4.5, "image": "..." }
  ]
}
```

**Use Cases**: Price comparison, product aggregation, e-commerce scraping

---

#### `get_interactive_elements`
**Description**: Get all interactive elements (buttons, links, inputs)

**Parameters**: None

**Returns**:
```json
{
  "elements": [
    { "type": "button", "text": "Submit", "selector": "#submit-btn", "ref": "..." }
  ]
}
```

**Use Cases**: Form analysis, interaction testing, button discovery

---

#### `extract_structured_data`
**Description**: Extract JSON-LD structured data

**Parameters**: None

**Returns**:
```json
{
  "data": [
    { "@type": "Product", "name": "...", "price": "..." }
  ]
}
```

**Use Cases**: Schema.org data extraction, rich snippet analysis

---

#### `get_text_content`
**Description**: Extract clean text content from page (no HTML)

**Parameters**:
- `maxLength` (optional): Maximum characters to return

**Returns**:
```json
{
  "text": "Clean text content..."
}
```

**Use Cases**: Text analysis, content extraction, summarization

---

### Form Category (5 macros)

#### `discover_forms`
**Description**: Discover all forms on page

**Parameters**: None

**Returns**:
```json
{
  "forms": [
    {
      "id": "contact-form",
      "action": "/submit",
      "method": "POST",
      "fieldCount": 5,
      "selector": "form#contact-form"
    }
  ]
}
```

**Use Cases**: Form automation, field detection

---

#### `analyze_form_requirements`
**Description**: Analyze specific form (fields, validation, required)

**Parameters**:
- `formSelector` (required): CSS selector for form

**Returns**:
```json
{
  "fields": [
    {
      "name": "email",
      "label": "Email Address",
      "type": "email",
      "required": true,
      "ref": "...",
      "validation": { "pattern": "email", "minLength": 5 }
    }
  ]
}
```

**Use Cases**: Form filling, validation testing

---

#### `find_element_by_description`
**Description**: Find element using natural language description

**Parameters**:
- `description` (required): Natural language description (e.g., "email input")

**Returns**:
```json
{
  "element": {
    "text": "Email",
    "selector": "input[type=email]",
    "ref": "..."
  }
}
```

**Use Cases**: Element location, form field finding

---

#### `detect_validation_rules`
**Description**: Detect client-side validation rules for form fields

**Parameters**:
- `formSelector` (optional): CSS selector for form

**Returns**:
```json
{
  "rules": [
    { "field": "email", "type": "email", "required": true, "pattern": "..." }
  ]
}
```

**Use Cases**: Form validation testing, field requirement analysis

---

#### `detect_messages`
**Description**: Detect error/success/validation messages on page

**Parameters**: None

**Returns**:
```json
{
  "errors": [{ "text": "Invalid email", "selector": "..." }],
  "success": [{ "text": "Form submitted", "selector": "..." }]
}
```

**Use Cases**: Form submission validation, error detection

---

### Navigation Category (4 macros)

#### `detect_pagination`
**Description**: Detect pagination controls

**Parameters**: None

**Returns**:
```json
{
  "hasNextPage": true,
  "hasPreviousPage": false,
  "nextButtonRef": "...",
  "previousButtonRef": null,
  "currentPage": 1,
  "totalPages": 10
}
```

**Use Cases**: Multi-page scraping, pagination handling

---

#### `detect_infinite_scroll`
**Description**: Detect if page uses infinite scroll

**Parameters**: None

**Returns**:
```json
{
  "isInfiniteScroll": true,
  "scrollContainer": ".products-list"
}
```

**Use Cases**: Infinite scroll handling, dynamic content loading

---

#### `find_navigation`
**Description**: Find main navigation menu

**Parameters**: None

**Returns**:
```json
{
  "navigation": {
    "items": [
      { "text": "Home", "href": "/", "ref": "..." }
    ],
    "selector": "nav.main-nav"
  }
}
```

**Use Cases**: Site exploration, navigation testing

---

#### `detect_breadcrumbs`
**Description**: Detect breadcrumb navigation

**Parameters**: None

**Returns**:
```json
{
  "breadcrumbs": [
    { "text": "Home", "href": "/" },
    { "text": "Products", "href": "/products" }
  ]
}
```

**Use Cases**: Navigation analysis, current page context

---

### Util Category (8 macros)

#### `dismiss_interruptions`
**Description**: Auto-dismiss popups, modals, overlays

**Parameters**: None

**Returns**:
```json
{
  "dismissed": 3,
  "types": ["cookie-banner", "modal", "popup"]
}
```

**Use Cases**: Clean page before operations, remove interruptions

---

#### `smart_cookie_consent`
**Description**: Handle cookie consent banners intelligently

**Parameters**: None

**Returns**:
```json
{
  "handled": true,
  "action": "accepted" | "rejected" | "dismissed"
}
```

**Use Cases**: Cookie consent automation, banner removal

---

#### `close_modal`
**Description**: Close modal dialogs

**Parameters**: None

**Returns**:
```json
{
  "closed": true,
  "modalType": "subscription-popup"
}
```

**Use Cases**: Modal dismissal, popup removal

---

#### `wait_for_element`
**Description**: Wait for specific element to appear

**Parameters**:
- `selector` (required): CSS selector to wait for
- `timeout` (optional): Maximum wait time in ms

**Returns**:
```json
{
  "found": true,
  "waitTime": 1500,
  "ref": "..."
}
```

**Use Cases**: Dynamic content loading, AJAX waits

---

#### `scroll_to_element`
**Description**: Scroll specific element into view

**Parameters**:
- `selector` (required): CSS selector for element

**Returns**:
```json
{
  "scrolled": true,
  "elementVisible": true
}
```

**Use Cases**: Element visibility, lazy loading trigger

---

#### `highlight_element`
**Description**: Visually highlight element (for debugging)

**Parameters**:
- `selector` (required): CSS selector for element

**Returns**:
```json
{
  "highlighted": true
}
```

**Use Cases**: Debugging, element verification

---

#### `check_element_visibility`
**Description**: Check if element is visible in viewport

**Parameters**:
- `selector` (required): CSS selector for element

**Returns**:
```json
{
  "visible": true,
  "inViewport": true,
  "hidden": false
}
```

**Use Cases**: Visibility testing, viewport checks

---

#### `get_element_position`
**Description**: Get element position and dimensions

**Parameters**:
- `selector` (required): CSS selector for element

**Returns**:
```json
{
  "x": 100,
  "y": 200,
  "width": 300,
  "height": 150
}
```

**Use Cases**: Layout analysis, position tracking

---

### Interaction Category (6 macros)

#### `smart_click`
**Description**: Intelligently click element (handles overlays, waits)

**Parameters**:
- `selector` (required): CSS selector for element

**Returns**:
```json
{
  "clicked": true,
  "dismissedOverlays": 1
}
```

**Use Cases**: Reliable clicking, overlay handling

---

#### `smart_fill`
**Description**: Intelligently fill form field (handles validation)

**Parameters**:
- `selector` (required): CSS selector for field
- `value` (required): Value to fill

**Returns**:
```json
{
  "filled": true,
  "validated": true
}
```

**Use Cases**: Form filling, input handling

---

#### `select_dropdown`
**Description**: Select option from dropdown

**Parameters**:
- `selector` (required): CSS selector for dropdown
- `value` (required): Value to select

**Returns**:
```json
{
  "selected": true,
  "option": "Option Text"
}
```

**Use Cases**: Dropdown selection, form filling

---

#### `check_checkbox`
**Description**: Check/uncheck checkbox

**Parameters**:
- `selector` (required): CSS selector for checkbox
- `checked` (required): true or false

**Returns**:
```json
{
  "checked": true
}
```

**Use Cases**: Form filling, checkbox toggling

---

#### `upload_file`
**Description**: Upload file to file input

**Parameters**:
- `selector` (required): CSS selector for file input
- `filePath` (required): Path to file to upload

**Returns**:
```json
{
  "uploaded": true,
  "fileName": "document.pdf"
}
```

**Use Cases**: File upload testing, form submission

---

#### `drag_and_drop`
**Description**: Drag element to target location

**Parameters**:
- `sourceSelector` (required): CSS selector for source
- `targetSelector` (required): CSS selector for target

**Returns**:
```json
{
  "dropped": true
}
```

**Use Cases**: Drag-and-drop interfaces, sorting

---

### Exploration Category (4 macros)

#### `explore_page`
**Description**: Comprehensive page analysis (structure, content, interactivity)

**Parameters**: None

**Returns**:
```json
{
  "structure": { "headings": [...], "sections": [...] },
  "content": { "wordCount": 1500, "images": 10 },
  "interactivity": { "forms": 2, "buttons": 15, "links": 50 }
}
```

**Use Cases**: Page analysis, content discovery

---

#### `detect_ajax_requests`
**Description**: Detect AJAX/XHR requests on page

**Parameters**: None

**Returns**:
```json
{
  "hasAjax": true,
  "endpoints": ["https://api.example.com/data"]
}
```

**Use Cases**: API detection, dynamic content analysis

---

#### `detect_javascript_frameworks`
**Description**: Detect JavaScript frameworks used on page

**Parameters**: None

**Returns**:
```json
{
  "frameworks": ["React", "jQuery"],
  "versions": { "React": "18.2.0" }
}
```

**Use Cases**: Technology stack analysis, framework detection

---

#### `analyze_performance`
**Description**: Analyze page performance metrics

**Parameters**: None

**Returns**:
```json
{
  "loadTime": 2500,
  "totalSize": 3500,
  "requests": 45,
  "score": 75
}
```

**Use Cases**: Performance testing, optimization analysis

---

### CDN Category (3 macros)

#### `inject_jquery`
**Description**: Inject jQuery library into page

**Parameters**: None

**Returns**:
```json
{
  "injected": true,
  "version": "3.6.0"
}
```

**Use Cases**: Page manipulation, jQuery utilities

---

#### `inject_lodash`
**Description**: Inject Lodash library into page

**Parameters**: None

**Returns**:
```json
{
  "injected": true,
  "version": "4.17.21"
}
```

**Use Cases**: Data manipulation, utility functions

---

#### `inject_moment`
**Description**: Inject Moment.js library into page

**Parameters**: None

**Returns**:
```json
{
  "injected": true,
  "version": "2.29.4"
}
```

**Use Cases**: Date/time manipulation, formatting

---

## Amazon-Specific Macros (17)

### Navigation Macros (4)

#### `amazon_search`
**Description**: Search Amazon with query

**Site**: amazon.com

**Parameters**:
- `query` (required): Search query string

**Returns**:
```json
{
  "searchUrl": "https://amazon.com/s?k=...",
  "resultsFound": true
}
```

**Use Cases**: Product search, Amazon automation

---

#### `amazon_click_product`
**Description**: Click on product from listing

**Site**: amazon.com

**Parameters**:
- `index` (required): Product index (1-based)

**Returns**:
```json
{
  "clicked": true,
  "productTitle": "Product Name"
}
```

**Use Cases**: Product navigation, listing interaction

---

#### `amazon_navigate_pages`
**Description**: Navigate through pagination

**Site**: amazon.com

**Parameters**:
- `direction` (required): "next" or "previous"
- `page` (optional): Specific page number

**Returns**:
```json
{
  "navigated": true,
  "currentPage": 2
}
```

**Use Cases**: Multi-page product browsing

---

#### `amazon_view_all_reviews`
**Description**: Navigate to full reviews page

**Site**: amazon.com

**Parameters**: None

**Returns**:
```json
{
  "navigated": true,
  "reviewsPageUrl": "https://..."
}
```

**Use Cases**: Reviews analysis, sentiment tracking

---

### Extraction Macros (7)

#### `amazon_get_product_info`
**Description**: Extract complete product details

**Site**: amazon.com

**Parameters**: None

**Returns**:
```json
{
  "title": "Product Title",
  "price": "$99.99",
  "rating": 4.5,
  "reviewsCount": 1234,
  "availability": "In Stock",
  "features": ["Feature 1", "Feature 2"],
  "description": "Product description...",
  "images": ["https://..."]
}
```

**Use Cases**: Product details extraction, price tracking

---

#### `amazon_get_listing_products`
**Description**: Extract all products from search/listing page

**Site**: amazon.com

**Parameters**: None

**Returns**:
```json
{
  "products": [
    {
      "title": "Product Name",
      "price": "$99.99",
      "rating": 4.5,
      "reviews": 1234,
      "link": "https://...",
      "image": "https://...",
      "sponsored": false
    }
  ]
}
```

**Use Cases**: Product aggregation, price comparison

---

#### `amazon_get_related_products`
**Description**: Extract related/recommended products

**Site**: amazon.com

**Parameters**: None

**Returns**:
```json
{
  "relatedProducts": [
    { "title": "...", "price": "...", "link": "..." }
  ]
}
```

**Use Cases**: Product discovery, recommendations

---

#### `amazon_extract_search_results`
**Description**: Extract search results with metadata

**Site**: amazon.com

**Parameters**: None

**Returns**:
```json
{
  "products": [...],
  "pagination": { "currentPage": 1, "totalPages": 10 },
  "filters": { "categories": [...], "priceRanges": [...] }
}
```

**Use Cases**: Comprehensive search data extraction

---

#### `amazon_get_available_filters`
**Description**: Get all available filter options

**Site**: amazon.com

**Parameters**: None

**Returns**:
```json
{
  "categories": ["Electronics", "Books"],
  "priceRanges": ["Under $25", "$25-$50"],
  "brands": ["Sony", "Samsung"],
  "ratings": ["4 Stars & Up"],
  "prime": true
}
```

**Use Cases**: Filter discovery, search refinement

---

#### `amazon_get_product_images`
**Description**: Extract all product images

**Site**: amazon.com

**Parameters**: None

**Returns**:
```json
{
  "images": [
    { "url": "https://...", "type": "main", "zoom": "https://..." }
  ]
}
```

**Use Cases**: Image collection, product media

---

#### `amazon_get_reviews_summary`
**Description**: Extract reviews summary statistics

**Site**: amazon.com

**Parameters**: None

**Returns**:
```json
{
  "overallRating": 4.5,
  "totalReviews": 1234,
  "ratingBreakdown": {
    "5star": 60,
    "4star": 20,
    "3star": 10,
    "2star": 5,
    "1star": 5
  },
  "verifiedPurchasePercent": 85,
  "keyFeatures": ["Great battery life", "Easy to use"]
}
```

**Use Cases**: Reviews analysis, sentiment tracking

---

### Interaction Macros (5)

#### `amazon_ask_rufus`
**Description**: Interact with Rufus AI assistant

**Site**: amazon.com

**Parameters**:
- `question` (required): Question to ask Rufus

**Returns**:
```json
{
  "response": "Rufus AI response...",
  "suggestions": ["Product 1", "Product 2"]
}
```

**Use Cases**: AI-powered shopping assistance

---

#### `amazon_apply_filter`
**Description**: Apply specific filter

**Site**: amazon.com

**Parameters**:
- `filterType` (required): Filter type (e.g., "price", "brand")
- `value` (required): Filter value (e.g., "under-25", "Sony")

**Returns**:
```json
{
  "applied": true,
  "filterType": "price",
  "value": "under-25"
}
```

**Use Cases**: Search refinement, filter application

---

#### `amazon_apply_sort`
**Description**: Sort results

**Site**: amazon.com

**Parameters**:
- `sortBy` (required): "featured", "price-low-high", "price-high-low", "rating", "newest"

**Returns**:
```json
{
  "sorted": true,
  "sortBy": "price-low-high"
}
```

**Use Cases**: Result ordering, price comparison

---

#### `amazon_select_variation`
**Description**: Select product variation (color, size, etc.)

**Site**: amazon.com

**Parameters**:
- `variationType` (required): Type of variation (e.g., "color", "size")
- `value` (required): Variation value (e.g., "Black", "Large")

**Returns**:
```json
{
  "selected": true,
  "variationType": "color",
  "value": "Black"
}
```

**Use Cases**: Product customization, variant selection

---

#### `amazon_add_to_cart`
**Description**: Add current product to cart

**Site**: amazon.com

**Parameters**:
- `quantity` (optional): Quantity to add (default: 1)

**Returns**:
```json
{
  "added": true,
  "quantity": 2,
  "cartTotal": "$199.98"
}
```

**Use Cases**: Cart operations, purchase workflow

---

### Search Macros (1)

#### `amazon_search_reviews`
**Description**: Search within product reviews

**Site**: amazon.com

**Parameters**:
- `query` (required): Search query (e.g., "battery life")

**Returns**:
```json
{
  "reviews": [
    { "text": "Great battery life...", "rating": 5, "verified": true }
  ]
}
```

**Use Cases**: Topic-specific review analysis

---

## Macro Usage Patterns

### Check Before Use

Always check for macros before using direct tools:

```javascript
// 1. Extract domain
const domain = new URL(url).hostname;

// 2. Check site-specific macros
const siteMacros = await mcp__browser__browser_list_macros({
  site: domain
});

// 3. Check universal macros
const universalMacros = await mcp__browser__browser_list_macros({
  site: "*"
});

// 4. Execute macro if available
if (siteMacros.content.macros.length > 0) {
  const result = await mcp__browser__browser_execute_macro({
    id: siteMacros.content.macros[0].id,
    params: { ... }
  });
}
```

### Macro Discovery

List all available macros:

```javascript
// List all macros
const allMacros = await mcp__browser__browser_list_macros({});

// List by site
const amazonMacros = await mcp__browser__browser_list_macros({
  site: "amazon.com"
});

// List by category
const formMacros = await mcp__browser__browser_list_macros({
  category: "form"
});
```

### Macro Execution

Execute a macro with parameters:

```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "amazon_search",
  params: { query: "wireless headphones" },
  tabTarget: tabId
});
```

## Storage and Management

All macros are stored in MongoDB for centralized management:

```bash
# Store core utility macros
npm run store:macros

# Store advanced macros
npm run store:advanced-macros

# Check macro count
mongosh unibrowse --eval 'db.macros.count()'
```

## Creating Custom Macros

See `.claude/agents/browser-macro-trainer.md` (future feature) for macro creation patterns.

## Further Reading

### Workflow Patterns
- [Multi-Tab Patterns](MULTI_TAB.md) - Multi-tab workflow patterns
- [Troubleshooting](TROUBLESHOOTING.md) - Common macro issues and solutions

### Site-Specific Macro Guides
- [Amazon Macros (17)](AMAZON_MACROS.md) - E-commerce automation for Amazon
- [Google Shopping Macros (12)](GOOGLE_SHOPPING_MACROS.md) - Multi-retailer price comparison
- [Walmart Macros (5)](WALMART_MACROS.md) - Walmart product automation
- [Upwork Macros (14)](UPWORK_MACROS.md) - Freelance platform automation
- [Fidelity Macros (14)](FIDELITY_MACROS.md) - Investment portfolio management
- [OpenGameArt Macros (3)](OPENGAMEART_MACROS.md) - Game asset discovery
- [CoinTracker Macros (2)](COINTRACKER_MACROS.md) - Crypto portfolio tracking
- [Google Macros (1)](GOOGLE_MACROS.md) - Web search automation
