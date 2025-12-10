# 🤨 Google Shopping Macros Reference

Complete reference for all 12 Google Shopping-specific macros used by the e-commerce sub-agent.

## Table of Contents

1. [Overview](#overview)
2. [Search Macros (1)](#search-macros)
3. [Navigation Macros (2)](#navigation-macros)
4. [Extraction Macros (3)](#extraction-macros)
5. [Interaction Macros (4)](#interaction-macros)
6. [Utility Macros (2)](#utility-macros)
7. [Complete Workflows](#complete-workflows)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

---

## Overview

**Google Shopping macros** are specialized JavaScript functions stored in MongoDB that automate Google Shopping-specific operations. They handle product search, filtering, sorting, data extraction, and merchant navigation on Google Shopping.

**Total Google Shopping Macros**: 12
- **Search**: 1 macro
- **Navigation**: 2 macros
- **Extraction**: 3 macros
- **Interaction**: 4 macros
- **Utility**: 2 macros

**Site**: `shopping.google.com`

**Usage Pattern**:
```javascript
// 1. Check if macro exists
const macros = await mcp__browser__browser_list_macros({ site: "shopping.google.com" });

// 2. Execute macro
const result = await mcp__browser__browser_execute_macro({
  id: "google_shopping_search",
  params: { query: "wireless headphones" },
  tabTarget: tabId
});

// 3. Use results
console.log("Search executed:", result.content);
```

---

## Search Macros

### `google_shopping_search`

**Description**: Search for products on Google Shopping with realistic human-like typing

**Site**: `shopping.google.com`

**Category**: search

**Parameters**:
- `query` (string, required): Product search query (e.g., "wireless headphones", "running shoes", "laptop stand")

**Returns**:
```javascript
{
  "success": true,
  "action": "google_shopping_search",
  "query": "wireless headphones",
  "method": "realistic_typing",
  "message": "Searching for 'wireless headphones' on Google Shopping"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "google_shopping_search",
  params: { query: "noise canceling headphones" },
  tabTarget: tabId
});
```

**Use Cases**:
- Product search automation
- Price comparison workflows
- Multi-site product research

**Notes**:
- Uses realistic typing with randomized delays (50-150ms per character)
- Clears existing search query first
- Submits search by pressing Enter
- Returns immediately to avoid context loss during navigation

---

## Navigation Macros

### `google_shopping_click_product`

**Description**: Click on a product from Google Shopping search results to view details

**Site**: `shopping.google.com`

**Category**: navigation

**Parameters**:
- `titleText` (string, optional): Partial or full product title text to match (case-insensitive)
- `position` (number, optional): 1-based position of product to click (e.g., 1 for first product)

**Note**: Either `titleText` OR `position` must be provided (not both)

**Returns**:
```javascript
{
  "success": true,
  "action": "google_shopping_click_product",
  "matchedTitle": "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
  "searchedBy": "titleText",
  "searchValue": "Sony WH-1000XM5",
  "method": "scheduled_click",
  "message": "Clicked product: Sony WH-1000XM5 Wireless Noise Canceling Headphones"
}
```

**Example**:
```javascript
// By title text
const result1 = await mcp__browser__browser_execute_macro({
  id: "google_shopping_click_product",
  params: { titleText: "Sony WH-1000XM5" },
  tabTarget: tabId
});

// By position
const result2 = await mcp__browser__browser_execute_macro({
  id: "google_shopping_click_product",
  params: { position: 1 },
  tabTarget: tabId
});
```

**Use Cases**:
- Navigate to product detail pages
- Click specific products from search results
- Follow-up after search

**Notes**:
- Returns immediately after scheduling click to avoid context loss
- Supports partial title matching (case-insensitive)
- Position-based clicking is faster but requires knowing product order

---

### `google_shopping_load_more_results`

**Description**: Load more results on Google Shopping (infinite scroll style pagination)

**Site**: `shopping.google.com`

**Category**: navigation

**Parameters**: None

**Returns**:
```javascript
{
  "success": true,
  "currentProductCount": 40,
  "message": "Loaded more results, now showing 40 products"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "google_shopping_load_more_results",
  tabTarget: tabId
});
```

**Use Cases**:
- Load additional products beyond initial results
- Scraping large product sets
- Finding products not in first page

**Notes**:
- Scrolls to bottom to trigger infinite scroll
- Waits for new products to load
- Returns updated product count

---

## Extraction Macros

### `google_shopping_extract_products`

**Description**: Extract product information from Google Shopping results including shipping details

**Site**: `shopping.google.com`

**Category**: extraction

**Parameters**:
- `maxResults` (number, optional): Maximum number of products to extract (default: 20)
- `includeSponsored` (boolean, optional): Include sponsored/ad products in results (default: false)

**Returns**:
```javascript
{
  "success": true,
  "action": "google_shopping_extract_products",
  "count": 20,
  "products": [
    {
      "position": 1,
      "title": "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
      "price": "$399.99",
      "merchant": "Best Buy",
      "rating": 4.8,
      "reviewCount": 1523,
      "productUrl": "https://www.google.com/aclk?...",
      "imageUrl": "https://...",
      "specs": ["Bluetooth", "30 hours", "Noise Canceling"],
      "shipping": {
        "freeDelivery": true,
        "deliveryTime": "delivery by Thursday",
        "shippingCost": null,
        "distance": null,
        "nearby": false
      }
    }
  ],
  "message": "Extracted 20 products"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "google_shopping_extract_products",
  params: {
    maxResults: 50,
    includeSponsored: false
  },
  tabTarget: tabId
});

const products = result.content.products;
console.log(`Found ${products.length} products`);
```

**Use Cases**:
- Price comparison across merchants
- Product research and analysis
- Building product databases
- Finding best deals

**Notes**:
- Uses image-based discovery for reliable extraction
- Automatically scrolls to load more products
- Filters out sponsored products by default
- Extracts comprehensive shipping information

---

### `google_shopping_get_available_filters`

**Description**: Extract all available filters from Google Shopping search results

**Site**: `shopping.google.com`

**Category**: extraction

**Parameters**: None

**Returns**:
```javascript
{
  "success": true,
  "action": "google_shopping_get_available_filters",
  "filterCategories": ["Price", "Brand", "Features", "Color", "Stores", "Rating"],
  "totalCategories": 6,
  "filters": {
    "Price": ["Under $50", "$50 - $100", "$100 - $200", "Over $200"],
    "Brand": ["Sony", "Bose", "Apple", "Samsung"],
    "Features": ["Noise Canceling", "Bluetooth", "Wireless", "Microphone"],
    "Rating": ["4 stars and up", "3 stars and up"]
  },
  "message": "Found 6 filter categories with 25 total options"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "google_shopping_get_available_filters",
  tabTarget: tabId
});

const filters = result.content.filters;
console.log("Available filters:", Object.keys(filters));
```

**Use Cases**:
- Understanding available filtering options
- Building dynamic filter UIs
- Automated product narrowing

**Notes**:
- Returns all filter categories and their options
- Useful for understanding search refinement possibilities

---

### `google_shopping_get_product_images`

**Description**: Extract product images from Google Shopping results

**Site**: `shopping.google.com`

**Category**: extraction

**Parameters**:
- `position` (number, optional): 1-based position of specific product to get images from
- `titleText` (string, optional): Partial product title to match (case-insensitive)
- `maxProducts` (number, optional): Maximum number of products to extract images from (default: 20)

**Note**: If neither `position` nor `titleText` provided, extracts images from all products up to `maxProducts`

**Returns**:
```javascript
{
  "success": true,
  "action": "google_shopping_get_product_images",
  "searchMode": "specific_product",
  "searchValue": 1,
  "productsScanned": 20,
  "totalImages": 5,
  "products": [
    {
      "position": 1,
      "title": "Sony WH-1000XM5 Wireless Headphones",
      "imageCount": 5,
      "images": [
        {
          "url": "https://...",
          "alt": "Sony WH-1000XM5",
          "width": 300,
          "height": 300,
          "dimensions": "300x300"
        }
      ]
    }
  ],
  "message": "Extracted 5 images from product at position 1"
}
```

**Example**:
```javascript
// Get images from specific product
const result1 = await mcp__browser__browser_execute_macro({
  id: "google_shopping_get_product_images",
  params: { position: 1 },
  tabTarget: tabId
});

// Get images from all products
const result2 = await mcp__browser__browser_execute_macro({
  id: "google_shopping_get_product_images",
  params: { maxProducts: 50 },
  tabTarget: tabId
});
```

**Use Cases**:
- Building product galleries
- Image analysis and comparison
- Visual product research

---

## Interaction Macros

### `google_shopping_apply_filter`

**Description**: Apply a filter to Google Shopping search results

**Site**: `shopping.google.com`

**Category**: interaction

**Parameters**:
- `filterText` (string, required): Exact text of filter option to click (e.g., "Noise Canceling", "$45 - $100", "4 and up")

**Note**: Filter text is case-sensitive

**Returns**:
```javascript
{
  "success": true,
  "action": "google_shopping_apply_filter",
  "filterText": "Noise Canceling",
  "wasAlreadySelected": false,
  "method": "scheduled_click",
  "message": "Applied filter: Noise Canceling"
}
```

**Example**:
```javascript
// Apply price filter
const result1 = await mcp__browser__browser_execute_macro({
  id: "google_shopping_apply_filter",
  params: { filterText: "$100 - $200" },
  tabTarget: tabId
});

// Apply feature filter
const result2 = await mcp__browser__browser_execute_macro({
  id: "google_shopping_apply_filter",
  params: { filterText: "Wireless" },
  tabTarget: tabId
});
```

**Use Cases**:
- Narrowing search results
- Price range filtering
- Feature-based filtering
- Brand filtering

**Notes**:
- Returns immediately after scheduling click to avoid context loss
- Detects if filter was already selected
- Supports all filter types: features, price ranges, ratings, categories, etc.

---

### `google_shopping_apply_sort`

**Description**: Apply sort order to Google Shopping results

**Site**: `shopping.google.com`

**Category**: interaction

**Parameters**:
- `sortBy` (string, required): Sort option - "relevance", "price_low_to_high", "price_high_to_low", "rating_high_to_low"

**Returns**:
```javascript
{
  "success": true,
  "previousSort": "relevance",
  "newSort": "price_low_to_high",
  "message": "Changed sort from 'relevance' to 'price_low_to_high'"
}
```

**Example**:
```javascript
// Sort by lowest price first
const result = await mcp__browser__browser_execute_macro({
  id: "google_shopping_apply_sort",
  params: { sortBy: "price_low_to_high" },
  tabTarget: tabId
});
```

**Use Cases**:
- Finding best deals (lowest price)
- Premium product discovery (highest price)
- Quality-focused search (highest rating)

**Sort Options**:
- `relevance` - Default Google Shopping relevance ranking
- `price_low_to_high` - Cheapest products first
- `price_high_to_low` - Most expensive products first
- `rating_high_to_low` - Highest rated products first

---

### `google_shopping_filter_by_shipping`

**Description**: Apply shipping-related filters to Google Shopping results

**Site**: `shopping.google.com`

**Category**: interaction

**Parameters**:
- `freeShipping` (boolean, optional): Filter for products with free shipping (default: false)
- `getItToday` (boolean, optional): Filter for products available for delivery today (default: false)
- `nearby` (boolean, optional): Filter for products available at nearby stores (default: false)

**Note**: Multiple filters can be applied simultaneously

**Returns**:
```javascript
{
  "success": true,
  "action": "google_shopping_filter_by_shipping",
  "appliedFilters": [
    { "filter": "Free shipping", "alreadySelected": false },
    { "filter": "Get it today", "alreadySelected": false }
  ],
  "failedFilters": [],
  "message": "Applied 2 shipping filters"
}
```

**Example**:
```javascript
// Filter for free shipping only
const result1 = await mcp__browser__browser_execute_macro({
  id: "google_shopping_filter_by_shipping",
  params: { freeShipping: true },
  tabTarget: tabId
});

// Filter for same-day delivery with free shipping
const result2 = await mcp__browser__browser_execute_macro({
  id: "google_shopping_filter_by_shipping",
  params: {
    freeShipping: true,
    getItToday: true
  },
  tabTarget: tabId
});
```

**Use Cases**:
- Finding free shipping deals
- Urgent purchases (same-day delivery)
- Local store pickup

**Notes**:
- Reports which filters were successfully applied
- Reports which filters failed (not available for search)
- Detects already-selected filters

---

### `google_shopping_open_merchant_page`

**Description**: Click through to the merchant's website from a Google Shopping product

**Site**: `shopping.google.com`

**Category**: interaction

**Parameters**:
- `position` (number, optional): Product position (1-based index)
- `titleText` (string, optional): Search for product by title text (partial match)

**Note**: Use `position` OR `titleText`, not both

**Returns**:
```javascript
{
  "success": true,
  "action": "google_shopping_open_merchant_page",
  "productTitle": "Sony WH-1000XM5 Wireless Headphones",
  "position": 1,
  "merchant": "Best Buy",
  "message": "Navigating to Best Buy for: Sony WH-1000XM5 Wireless Headphones"
}
```

**Example**:
```javascript
// Open merchant page by position
const result1 = await mcp__browser__browser_execute_macro({
  id: "google_shopping_open_merchant_page",
  params: { position: 1 },
  tabTarget: tabId
});

// Open merchant page by title
const result2 = await mcp__browser__browser_execute_macro({
  id: "google_shopping_open_merchant_page",
  params: { titleText: "Sony WH-1000XM5" },
  tabTarget: tabId
});
```

**Use Cases**:
- Navigate to merchant site to complete purchase
- Get more product details from merchant
- Check merchant-specific deals

**Notes**:
- Opens merchant's product page in same tab
- Useful for completing purchases
- Preserves Google Shopping referral tracking

---

## Utility Macros

### `google_shopping_sort_by_total_price`

**Description**: Sort Google Shopping products by total price (product price + shipping cost)

**Site**: `shopping.google.com`

**Category**: util

**Parameters**:
- `maxResults` (number, optional): Maximum number of products to include in sorted results (default: 20)

**Returns**:
```javascript
{
  "success": true,
  "action": "google_shopping_sort_by_total_price",
  "count": 20,
  "totalProductsFound": 25,
  "productsWithKnownTotal": 18,
  "productsWithUnknownTotal": 7,
  "products": [
    {
      "position": 3,
      "title": "Sony WH-1000XM5",
      "price": 349.99,
      "shippingCost": 0,
      "totalPrice": 349.99,
      "merchant": "Best Buy",
      "priceDisplay": "$349.99",
      "shippingDisplay": "Free shipping",
      "totalDisplay": "$349.99"
    }
  ],
  "message": "Sorted 20 products by total price (18 with known shipping costs)"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "google_shopping_sort_by_total_price",
  params: { maxResults: 50 },
  tabTarget: tabId
});

const cheapestTotal = result.content.products[0];
console.log(`Cheapest total: ${cheapestTotal.totalDisplay} from ${cheapestTotal.merchant}`);
```

**Use Cases**:
- Finding true best deals (including shipping)
- Price comparison with shipping costs
- Identifying hidden shipping fees

**Notes**:
- Free shipping is treated as $0
- Products without clear shipping costs are listed last
- Client-side sorting (doesn't reload page)
- Extracts all visible products first, then sorts

---

### `google_shopping_filter_by_merchant`

**Description**: Filter Google Shopping products by merchant/store name

**Site**: `shopping.google.com`

**Category**: util

**Parameters**:
- `merchants` (array, required): Array of merchant names to filter by (e.g., ["Best Buy", "Amazon", "Walmart"])
- `exactMatch` (boolean, optional): Require exact merchant name match (default: false, allows partial matches)
- `maxResults` (number, optional): Maximum number of products to return (default: 50)

**Returns**:
```javascript
{
  "success": true,
  "action": "google_shopping_filter_by_merchant",
  "requestedMerchants": ["Best Buy", "Amazon"],
  "matchMode": "partial",
  "totalProductsScanned": 40,
  "matchedCount": 15,
  "returnedCount": 15,
  "merchantCounts": {
    "Best Buy": 8,
    "Amazon": 7
  },
  "products": [
    {
      "position": 1,
      "title": "Sony WH-1000XM5",
      "price": "$399.99",
      "merchant": "Best Buy",
      "rating": 4.8,
      "matchedBy": "Best Buy"
    }
  ],
  "message": "Found 15 products from requested merchants"
}
```

**Example**:
```javascript
// Filter for specific merchants
const result = await mcp__browser__browser_execute_macro({
  id: "google_shopping_filter_by_merchant",
  params: {
    merchants: ["Best Buy", "Amazon", "Walmart"],
    maxResults: 100
  },
  tabTarget: tabId
});

// Exact merchant match
const result2 = await mcp__browser__browser_execute_macro({
  id: "google_shopping_filter_by_merchant",
  params: {
    merchants: ["Best Buy"],
    exactMatch: true
  },
  tabTarget: tabId
});
```

**Use Cases**:
- Finding products from trusted merchants
- Comparing prices across specific stores
- Excluding unwanted merchants

**Notes**:
- Supports partial name matching by default (case-insensitive)
- Client-side filter that works on currently loaded products
- Returns merchant counts for analysis
- "Best" will match "Best Buy"

---

## Complete Workflows

### Workflow 1: Find Best Deal with Shipping

```javascript
// Step 1: Search for product
await mcp__browser__browser_execute_macro({
  id: "google_shopping_search",
  params: { query: "wireless headphones" },
  tabTarget: tabId
});

// Step 2: Apply filters
await mcp__browser__browser_execute_macro({
  id: "google_shopping_apply_filter",
  params: { filterText: "Noise Canceling" },
  tabTarget: tabId
});

await mcp__browser__browser_execute_macro({
  id: "google_shopping_apply_filter",
  params: { filterText: "$100 - $200" },
  tabTarget: tabId
});

// Step 3: Sort by total price (including shipping)
const sorted = await mcp__browser__browser_execute_macro({
  id: "google_shopping_sort_by_total_price",
  params: { maxResults: 50 },
  tabTarget: tabId
});

// Step 4: Get the cheapest option
const bestDeal = sorted.content.products[0];
console.log(`Best deal: ${bestDeal.title} - ${bestDeal.totalDisplay}`);
```

### Workflow 2: Compare Across Specific Merchants

```javascript
// Step 1: Search
await mcp__browser__browser_execute_macro({
  id: "google_shopping_search",
  params: { query: "iPhone 15 Pro" },
  tabTarget: tabId
});

// Step 2: Load more results
await mcp__browser__browser_execute_macro({
  id: "google_shopping_load_more_results",
  tabTarget: tabId
});

// Step 3: Filter by trusted merchants
const filtered = await mcp__browser__browser_execute_macro({
  id: "google_shopping_filter_by_merchant",
  params: {
    merchants: ["Best Buy", "Amazon", "Apple"],
    maxResults: 100
  },
  tabTarget: tabId
});

// Step 4: Sort by total price
const sorted = await mcp__browser__browser_execute_macro({
  id: "google_shopping_sort_by_total_price",
  params: { maxResults: 50 },
  tabTarget: tabId
});

console.log("Cheapest from trusted merchants:", sorted.content.products[0]);
```

### Workflow 3: Urgent Purchase (Same-Day Delivery)

```javascript
// Step 1: Search
await mcp__browser__browser_execute_macro({
  id: "google_shopping_search",
  params: { query: "laptop stand" },
  tabTarget: tabId
});

// Step 2: Apply same-day delivery filters
await mcp__browser__browser_execute_macro({
  id: "google_shopping_filter_by_shipping",
  params: {
    freeShipping: true,
    getItToday: true
  },
  tabTarget: tabId
});

// Step 3: Extract available products
const products = await mcp__browser__browser_execute_macro({
  id: "google_shopping_extract_products",
  params: { maxResults: 20 },
  tabTarget: tabId
});

// Step 4: Open merchant page for first result
await mcp__browser__browser_execute_macro({
  id: "google_shopping_open_merchant_page",
  params: { position: 1 },
  tabTarget: tabId
});
```

---

## Best Practices

### 1. Always Sort by Total Price

Google Shopping's default sort only considers product price, not shipping. Use `google_shopping_sort_by_total_price` for true best deals:

```javascript
// ❌ Bad: Default sort ignores shipping costs
await mcp__browser__browser_execute_macro({
  id: "google_shopping_apply_sort",
  params: { sortBy: "price_low_to_high" }
});

// ✅ Good: Sort by total price including shipping
await mcp__browser__browser_execute_macro({
  id: "google_shopping_sort_by_total_price"
});
```

### 2. Load More Results Before Filtering

Client-side filters only work on loaded products:

```javascript
// ✅ Good workflow
await google_shopping_search({ query: "headphones" });
await google_shopping_load_more_results();
await google_shopping_filter_by_merchant({ merchants: ["Best Buy"] });
```

### 3. Use Partial Title Matching

Title matching is case-insensitive and supports partial matches:

```javascript
// All of these will match "Sony WH-1000XM5 Wireless Headphones"
await google_shopping_click_product({ titleText: "Sony WH-1000XM5" });
await google_shopping_click_product({ titleText: "sony wh-1000xm5" });
await google_shopping_click_product({ titleText: "WH-1000XM5" });
```

### 4. Extract Before Clicking

Extract product data before navigating away:

```javascript
// ✅ Good: Extract first, then navigate
const products = await google_shopping_extract_products();
await google_shopping_click_product({ position: 1 });

// ❌ Bad: Click first (loses product list)
await google_shopping_click_product({ position: 1 });
const products = await google_shopping_extract_products(); // Empty!
```

### 5. Combine Filters Efficiently

Apply multiple filters in sequence for best results:

```javascript
// ✅ Good: Sequential filtering
await google_shopping_apply_filter({ filterText: "$100 - $200" });
await google_shopping_apply_filter({ filterText: "Noise Canceling" });
await google_shopping_filter_by_shipping({ freeShipping: true });
```

---

## Troubleshooting

### Issue: No Products Found

**Cause**: Page hasn't fully loaded or search returned no results

**Solution**:
```javascript
// Wait for page load
await new Promise(resolve => setTimeout(resolve, 2000));

// Then extract
const products = await google_shopping_extract_products();
if (products.content.count === 0) {
  console.log("Try a different search query");
}
```

### Issue: Filter Not Found

**Cause**: Filter text doesn't match exactly

**Solution**:
```javascript
// ❌ Wrong: Incorrect capitalization
await google_shopping_apply_filter({ filterText: "noise canceling" });

// ✅ Correct: Exact match with proper capitalization
await google_shopping_apply_filter({ filterText: "Noise Canceling" });

// Alternative: Get available filters first
const filters = await google_shopping_get_available_filters();
console.log("Available filters:", filters.content.filters);
```

### Issue: Merchant Filter Returns Empty

**Cause**: Merchant name doesn't match or products not loaded

**Solution**:
```javascript
// Load more products first
await google_shopping_load_more_results();

// Use partial matching (default)
const result = await google_shopping_filter_by_merchant({
  merchants: ["Best"],  // Will match "Best Buy"
  exactMatch: false
});

// Check what merchants were found
console.log("Merchant counts:", result.content.merchantCounts);
```

### Issue: Sort by Total Price Shows Products Without Shipping

**Cause**: Some products don't display shipping cost

**Solution**:
```javascript
const sorted = await google_shopping_sort_by_total_price();

// Products with unknown shipping are listed last
const withKnownShipping = sorted.content.productsWithKnownTotal;
const withUnknownShipping = sorted.content.productsWithUnknownTotal;

console.log(`${withKnownShipping} products with known shipping`);
console.log(`${withUnknownShipping} products without shipping info`);
```

### Issue: Sponsored Products Included

**Cause**: Default behavior includes sponsored products

**Solution**:
```javascript
// Exclude sponsored/ad products
const products = await google_shopping_extract_products({
  maxResults: 50,
  includeSponsored: false  // Default is false
});
```

---

## Related Documentation

- **[MACROS.md](./MACROS.md)** - Complete macro reference (57+ macros)
- **[AMAZON_MACROS.md](./AMAZON_MACROS.md)** - Amazon-specific macros (17 macros)
- **[WALMART_MACROS.md](./WALMART_MACROS.md)** - Walmart-specific macros
- **[MULTI_TAB.md](./MULTI_TAB.md)** - Multi-tab workflow patterns
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Comprehensive troubleshooting guide

---

**Built with 🤨 by the Unibrowse team**
