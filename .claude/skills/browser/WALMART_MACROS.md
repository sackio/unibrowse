# 🤨 Walmart Macros Reference

Complete reference for all 5 Walmart-specific macros used by the e-commerce sub-agent.

## Table of Contents

1. [Overview](#overview)
2. [Search Macros (1)](#search-macros)
3. [Extraction Macros (2)](#extraction-macros)
4. [Utility Macros (2)](#utility-macros)
5. [Complete Workflows](#complete-workflows)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)
8. [Related Documentation](#related-documentation)

---

## Overview

**Walmart macros** are specialized JavaScript functions stored in MongoDB that automate Walmart-specific operations. They handle product search, data extraction, filtering, and sorting on Walmart.com.

**Total Walmart Macros**: 5
- **Search**: 1 macro
- **Extraction**: 2 macros
- **Utility**: 2 macros

**Site**: `walmart.com`

**Usage Pattern**:
```javascript
// 1. Check if macro exists
const macros = await mcp__browser__browser_list_macros({ site: "walmart.com" });

// 2. Execute macro
const result = await mcp__browser__browser_execute_macro({
  id: "walmart_search",
  params: { query: "wireless headphones" },
  tabTarget: tabId
});

// 3. Use results
console.log("Search executed:", result.content);
```

---

## Search Macros

### `walmart_search`

**Description**: Search for products on Walmart with realistic human-like typing

**Site**: `walmart.com`

**Category**: search

**Parameters**:
- `query` (string, required): Product search query (e.g., "wireless headphones", "running shoes", "laptop stand")

**Returns**:
```javascript
{
  "success": true,
  "action": "walmart_search",
  "query": "wireless headphones",
  "message": "Searching for 'wireless headphones' on Walmart",
  "note": "Page navigation occurs - extract products after search completes"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "walmart_search",
  params: { query: "noise canceling headphones" },
  tabTarget: tabId
});
```

**Use Cases**:
- Product search automation
- Price comparison workflows
- Multi-site product research

**Notes**:
- Uses realistic typing with randomized delays
- Clears existing search query first
- Submits search by pressing Enter
- Triggers page navigation to search results
- Wait briefly after search before extracting products

---

## Extraction Macros

### `walmart_extract_products`

**Description**: Extract product information from Walmart search results including prices, ratings, badges, and shipping

**Site**: `walmart.com`

**Category**: extraction

**Parameters**:
- `maxResults` (number, optional): Maximum number of products to extract (default: 50)

**Returns**:
```javascript
{
  "success": true,
  "action": "walmart_extract_products",
  "count": 50,
  "totalFound": 427,
  "products": [
    {
      "position": 1,
      "itemId": "product_123456",
      "title": "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
      "price": {
        "current": 349.99,
        "was": 399.99,
        "shipping": 0,
        "total": 349.99,
        "freeShipping": true,
        "display": "$349.99"
      },
      "rating": 4.8,
      "reviewCount": 1523,
      "badges": ["Best seller", "Free shipping"],
      "productUrl": "https://www.walmart.com/ip/...",
      "imageUrl": "https://...",
      "imageAlt": "Sony WH-1000XM5 headphones"
    }
  ],
  "message": "Extracted 50 products from Walmart search results"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "walmart_extract_products",
  params: {
    maxResults: 100
  },
  tabTarget: tabId
});

const products = result.content.products;
console.log(`Found ${products.length} products, ${result.content.totalFound} total available`);
```

**Use Cases**:
- Price comparison across products
- Product research and analysis
- Building product databases
- Finding bestsellers and trending items
- Identifying free shipping options

**Data Extracted**:
- **Position**: Index in search results
- **itemId**: Walmart product identifier for data attributes
- **Title**: Product name
- **Price**: Current, original, shipping cost, total, free shipping flag
- **Rating & Reviews**: Customer ratings and review count
- **Badges**: Special tags like "Best seller", "Clearance", "Free shipping"
- **URLs**: Product and image URLs
- **Image**: Product thumbnail with alt text

**Notes**:
- Extracts all currently visible products
- Uses data attributes for reliable selection (`data-item-id`, `data-automation-id`)
- Includes shipping cost in price calculation
- Badge extraction identifies special product attributes
- Handles out-of-stock indicators

---

### `walmart_get_product_details`

**Description**: Extract detailed product information from a Walmart product page including specifications, images, and description

**Site**: `walmart.com`

**Category**: extraction

**Parameters**:
- `expandDetails` (boolean, optional): Expand description sections (default: true)
- `includeImages` (boolean, optional): Extract product images (default: true)
- `maxImages` (number, optional): Maximum number of images to extract (default: 8)

**Returns**:
```javascript
{
  "success": true,
  "action": "walmart_get_product_details",
  "url": "https://www.walmart.com/ip/...",
  "itemId": "product_123456",
  "title": "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
  "price": {
    "current": 349.99,
    "was": 399.99,
    "onSale": true,
    "discount": 12.5
  },
  "rating": 4.8,
  "reviewCount": 1523,
  "availability": "In stock",
  "description": [
    "Premium noise canceling headphones",
    "Up to 30 hours of battery life",
    "Bluetooth 5.3 connectivity",
    "Active noise canceling technology"
  ],
  "specifications": {
    "Brand": "Sony",
    "Model": "WH-1000XM5",
    "Connectivity": "Bluetooth",
    "Battery Life": "30 hours",
    "Noise Cancellation": "Yes"
  },
  "images": [
    {
      "position": 1,
      "src": "https://...",
      "alt": "Sony WH-1000XM5 front view",
      "thumbnail": "https://..."
    }
  ],
  "metadata": {
    "sku": "SKU123456",
    "category": "Electronics > Audio > Headphones"
  },
  "message": "Extracted detailed product information"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "walmart_get_product_details",
  params: {
    expandDetails: true,
    includeImages: true,
    maxImages: 8
  },
  tabTarget: tabId
});

const details = result.content;
console.log(`Product: ${details.title}`);
console.log(`Price: ${details.price.current} (was ${details.price.was})`);
console.log(`Rating: ${details.rating} stars (${details.reviewCount} reviews)`);
console.log(`Images: ${details.images.length}`);
```

**Use Cases**:
- Detailed product comparison
- Building comprehensive product catalogs
- Analyzing product specifications
- Collecting product images for galleries
- Verifying pricing and availability

**Data Extracted**:
- **Title & Price**: Product name and pricing information
- **Rating & Reviews**: Customer feedback
- **Availability**: Stock status
- **Description**: Bullet points of product features
- **Specifications**: Detailed product attributes
- **Images**: Product photos with thumbnails
- **Metadata**: SKU and category information

**Notes**:
- Designed for product detail pages
- Expands description sections for full content
- Extracts multiple images for visual review
- Includes discount percentage if on sale
- Handles specifications in key-value format

---

## Utility Macros

### `walmart_sort_by_price`

**Description**: Sort Walmart products by total price (product price + shipping cost)

**Site**: `walmart.com`

**Category**: util

**Parameters**:
- `sortOrder` (string, required): Sort direction - `"low-to-high"` or `"high-to-low"`
- `includeShipping` (boolean, optional): Include shipping cost in sort (default: true)
- `maxResults` (number, optional): Maximum number of products to include in sorted results (default: 50)

**Returns**:
```javascript
{
  "success": true,
  "action": "walmart_sort_by_price",
  "sortOrder": "low-to-high",
  "count": 50,
  "totalProductsFound": 427,
  "productsWithKnownPrice": 48,
  "products": [
    {
      "position": 1,
      "itemId": "product_789",
      "title": "Sony WH-1000XM5",
      "price": {
        "current": 299.99,
        "shipping": 0,
        "total": 299.99,
        "freeShipping": true,
        "display": "$299.99"
      },
      "rating": 4.8,
      "shipping": "Free",
      "imageUrl": "https://..."
    }
  ],
  "note": "Client-side sorting based on currently loaded products (extract all first for best results)"
}
```

**Example**:
```javascript
// Sort by lowest price first (best deals)
const result1 = await mcp__browser__browser_execute_macro({
  id: "walmart_sort_by_price",
  params: {
    sortOrder: "low-to-high",
    maxResults: 50
  },
  tabTarget: tabId
});

const cheapest = result1.content.products[0];
console.log(`Cheapest: ${cheapest.title} - ${cheapest.price.display}`);

// Sort by highest price (premium products)
const result2 = await mcp__browser__browser_execute_macro({
  id: "walmart_sort_by_price",
  params: {
    sortOrder: "high-to-low",
    maxResults: 50
  },
  tabTarget: tabId
});
```

**Use Cases**:
- Finding best deals (lowest total price)
- Identifying premium products
- Price comparison analysis
- Finding free shipping options
- Building price-sorted product lists

**Sort Options**:
- `low-to-high` - Cheapest products first (best deals)
- `high-to-low` - Most expensive products first (premium items)

**Notes**:
- Client-side sorting (doesn't reload page)
- Sorts by total price including shipping by default
- Free shipping is treated as $0 shipping cost
- Only sorts products that have been extracted
- Extract all visible products first for most complete results

---

### `walmart_filter_products`

**Description**: Filter Walmart products by price range, shipping options, and special badges

**Site**: `walmart.com`

**Category**: util

**Parameters**:
- `minPrice` (number, optional): Minimum price filter (e.g., 50)
- `maxPrice` (number, optional): Maximum price filter (e.g., 200)
- `freeShippingOnly` (boolean, optional): Filter for free shipping only (default: false)
- `includeShipping` (boolean, optional): Include shipping in price calculations (default: true)
- `badges` (array, optional): Filter by badge text (e.g., ["Best seller", "Clearance"])
- `maxResults` (number, optional): Maximum number of products to return (default: 50)

**Returns**:
```javascript
{
  "success": true,
  "action": "walmart_filter_products",
  "matchedCount": 12,
  "totalScanned": 50,
  "filtersApplied": {
    "priceRange": "$50 - $200",
    "freeShippingOnly": false,
    "badges": ["Best seller"]
  },
  "filteredByPrice": 45,
  "filteredByShipping": 0,
  "filteredByBadges": 12,
  "products": [
    {
      "position": 3,
      "itemId": "product_456",
      "title": "Sony WH-1000XM5",
      "price": {
        "current": 149.99,
        "total": 149.99,
        "display": "$149.99"
      },
      "badges": ["Best seller"],
      "rating": 4.8
    }
  ],
  "note": "Client-side filtering based on currently loaded products (load/extract more products for broader filtering)"
}
```

**Example**:
```javascript
// Filter by price range
const result1 = await mcp__browser__browser_execute_macro({
  id: "walmart_filter_products",
  params: {
    minPrice: 50,
    maxPrice: 200,
    maxResults: 50
  },
  tabTarget: tabId
});

// Filter for free shipping only
const result2 = await mcp__browser__browser_execute_macro({
  id: "walmart_filter_products",
  params: {
    freeShippingOnly: true,
    maxResults: 50
  },
  tabTarget: tabId
});

// Filter for bestsellers with price range
const result3 = await mcp__browser__browser_execute_macro({
  id: "walmart_filter_products",
  params: {
    minPrice: 30,
    maxPrice: 150,
    badges: ["Best seller"],
    maxResults: 50
  },
  tabTarget: tabId
});
```

**Use Cases**:
- Budget-conscious shopping
- Finding free shipping deals
- Identifying bestseller products
- Filtering clearance items
- Narrowing product selections

**Supported Badges**:
- "Best seller" - Popular/bestselling products
- "Clearance" - Clearance sale items
- "Free shipping" - Products with free shipping
- "Great price" - Good value items
- "Limited time" - Time-limited offers

**Notes**:
- Client-side filtering (doesn't reload page)
- Works on currently loaded/extracted products
- Price filtering uses total price (product + shipping) by default
- Supports multiple badge filters (OR logic)
- Returns filter summary showing how many products matched each criterion

---

## Complete Workflows

### Workflow 1: Find Best Walmart Deal with Shipping

```javascript
// Step 1: Search for product
await mcp__browser__browser_execute_macro({
  id: "walmart_search",
  params: { query: "wireless headphones" },
  tabTarget: tabId
});

// Step 2: Wait for page to load
await new Promise(resolve => setTimeout(resolve, 1000));

// Step 3: Extract all products
const extracted = await mcp__browser__browser_execute_macro({
  id: "walmart_extract_products",
  params: { maxResults: 100 },
  tabTarget: tabId
});

// Step 4: Sort by lowest total price (including shipping)
const sorted = await mcp__browser__browser_execute_macro({
  id: "walmart_sort_by_price",
  params: {
    sortOrder: "low-to-high",
    includeShipping: true,
    maxResults: 50
  },
  tabTarget: tabId
});

// Step 5: Get the best deal
const bestDeal = sorted.content.products[0];
console.log(`Best deal: ${bestDeal.title}`);
console.log(`Price: ${bestDeal.price.display}`);
console.log(`Shipping: ${bestDeal.shipping}`);
console.log(`Rating: ${bestDeal.rating} stars`);
```

### Workflow 2: Find Bestseller Deals Within Budget

```javascript
// Step 1: Search
await mcp__browser__browser_execute_macro({
  id: "walmart_search",
  params: { query: "laptop stand" },
  tabTarget: tabId
});

// Step 2: Wait for results
await new Promise(resolve => setTimeout(resolve, 1000));

// Step 3: Extract products
const extracted = await mcp__browser__browser_execute_macro({
  id: "walmart_extract_products",
  params: { maxResults: 100 },
  tabTarget: tabId
});

// Step 4: Filter for bestsellers with price range
const filtered = await mcp__browser__browser_execute_macro({
  id: "walmart_filter_products",
  params: {
    minPrice: 20,
    maxPrice: 75,
    badges: ["Best seller"],
    maxResults: 50
  },
  tabTarget: tabId
});

// Step 5: Sort by price
const sorted = await mcp__browser__browser_execute_macro({
  id: "walmart_sort_by_price",
  params: {
    sortOrder: "low-to-high",
    maxResults: 50
  },
  tabTarget: tabId
});

const results = sorted.content.products;
console.log(`Found ${results.length} bestsellers between $20-$75`);
```

### Workflow 3: Free Shipping Products Only

```javascript
// Step 1: Search
await mcp__browser__browser_execute_macro({
  id: "walmart_search",
  params: { query: "running shoes" },
  tabTarget: tabId
});

// Step 2: Wait
await new Promise(resolve => setTimeout(resolve, 1000));

// Step 3: Extract
const extracted = await mcp__browser__browser_execute_macro({
  id: "walmart_extract_products",
  params: { maxResults: 100 },
  tabTarget: tabId
});

// Step 4: Filter for free shipping only
const filtered = await mcp__browser__browser_execute_macro({
  id: "walmart_filter_products",
  params: {
    freeShippingOnly: true,
    maxResults: 50
  },
  tabTarget: tabId
});

// Step 5: Sort by price
const sorted = await mcp__browser__browser_execute_macro({
  id: "walmart_sort_by_price",
  params: {
    sortOrder: "low-to-high",
    maxResults: 50
  },
  tabTarget: tabId
});

console.log(`Found ${sorted.content.count} free shipping options`);
```

### Workflow 4: Get Complete Product Details and Compare

```javascript
// Step 1: Search
await mcp__browser__browser_execute_macro({
  id: "walmart_search",
  params: { query: "bluetooth speaker" },
  tabTarget: tabId
});

// Step 2: Wait
await new Promise(resolve => setTimeout(resolve, 1000));

// Step 3: Extract products
const products = await mcp__browser__browser_execute_macro({
  id: "walmart_extract_products",
  params: { maxResults: 20 },
  tabTarget: tabId
});

// Step 4: For each top product, get detailed info
const detailedProducts = [];
for (let i = 0; i < Math.min(3, products.content.products.length); i++) {
  // Click on product (requires separate navigation)
  // Then extract details
  const details = await mcp__browser__browser_execute_macro({
    id: "walmart_get_product_details",
    params: {
      expandDetails: true,
      includeImages: true,
      maxImages: 5
    },
    tabTarget: tabId
  });

  detailedProducts.push(details.content);

  // Navigate back to results (would require separate macro/navigation)
}

console.log(`Collected detailed info for ${detailedProducts.length} products`);
```

---

## Best Practices

### 1. Always Extract Before Filtering/Sorting

Client-side filters and sorts work on currently loaded products:

```javascript
// ✅ Good: Extract first
const products = await walmart_extract_products({ maxResults: 100 });
const filtered = await walmart_filter_products({ minPrice: 50, maxPrice: 200 });

// ❌ Bad: Filter without extracting
const filtered = await walmart_filter_products({ minPrice: 50, maxPrice: 200 }); // Filters limited products
```

### 2. Include Shipping in Price Calculations

Walmart shipping varies, so always sort by total price:

```javascript
// ✅ Good: Include shipping in sort
const sorted = await walmart_sort_by_price({
  sortOrder: "low-to-high",
  includeShipping: true  // Includes shipping cost
});

// ⚠️ Caution: Excluding shipping gives incomplete view
const sorted = await walmart_sort_by_price({
  sortOrder: "low-to-high",
  includeShipping: false  // Only product price
});
```

### 3. Wait After Search Before Extracting

Search results take time to load:

```javascript
// ✅ Good: Wait for page load
await walmart_search({ query: "headphones" });
await new Promise(resolve => setTimeout(resolve, 1000));
const products = await walmart_extract_products();

// ❌ Bad: Extract immediately
await walmart_search({ query: "headphones" });
const products = await walmart_extract_products(); // May be empty
```

### 4. Use Badge Filters for Quality Products

Badge filtering identifies bestsellers and special offers:

```javascript
// ✅ Good: Filter for bestsellers
const bestsellers = await walmart_filter_products({
  badges: ["Best seller"],
  maxResults: 50
});

// ✅ Good: Find clearance items
const clearance = await walmart_filter_products({
  badges: ["Clearance"],
  maxResults: 50
});
```

### 5. Combine Multiple Filters for Precise Results

Stack filters sequentially for better results:

```javascript
// ✅ Good: Combined filtering
const products = await walmart_extract_products({ maxResults: 100 });

// Filter by price
const priceFiltered = await walmart_filter_products({
  minPrice: 50,
  maxPrice: 200,
  maxResults: 100
});

// Then filter by shipping
const shippingFiltered = await walmart_filter_products({
  freeShippingOnly: true,
  maxResults: 100
});

// Finally sort
const sorted = await walmart_sort_by_price({
  sortOrder: "low-to-high",
  maxResults: 50
});
```

### 6. Extract Product Details for Deep Comparisons

Use detail extraction for comprehensive product information:

```javascript
// ✅ Good: Get specifications and images
const details = await walmart_get_product_details({
  expandDetails: true,
  includeImages: true,
  maxImages: 8
});

console.log("Specifications:", details.content.specifications);
console.log("Images available:", details.content.images.length);
console.log("Product availability:", details.content.availability);
```

---

## Troubleshooting

### Issue: Search Returns No Products

**Cause**: Page hasn't fully loaded or search term has no results

**Solution**:
```javascript
// Wait longer for results to load
await walmart_search({ query: "headphones" });
await new Promise(resolve => setTimeout(resolve, 2000));

const products = await walmart_extract_products();
if (products.content.count === 0) {
  console.log("Try a different search term");
}
```

### Issue: Extract Returns Empty Products

**Cause**: Page still loading or products not in DOM yet

**Solution**:
```javascript
// Scroll page to trigger loading
await new Promise(resolve => setTimeout(resolve, 1500));

// Try extraction again
const products = await walmart_extract_products({ maxResults: 100 });

// Check what was found
console.log(`Found ${products.content.count} products`);
console.log(`Total available: ${products.content.totalFound}`);
```

### Issue: Filter Returns No Results

**Cause**: No products in current results match filter criteria

**Solution**:
```javascript
// Extract more products first
const products = await walmart_extract_products({ maxResults: 100 });

// Try filter with relaxed criteria
const filtered = await walmart_filter_products({
  minPrice: 25,  // Lower minimum
  maxPrice: 300, // Higher maximum
  maxResults: 100
});

console.log(`Found ${filtered.content.matchedCount} products matching criteria`);
```

### Issue: Sort by Price Has Incomplete Data

**Cause**: Some products lack shipping information

**Solution**:
```javascript
const sorted = await walmart_sort_by_price({
  sortOrder: "low-to-high",
  includeShipping: true,
  maxResults: 50
});

// Check product counts
console.log(`Products with price: ${sorted.content.productsWithKnownPrice}`);

// Products without shipping info are listed last but still included
const lastProduct = sorted.content.products[sorted.content.products.length - 1];
console.log(`Last product: ${lastProduct.title} (shipping: ${lastProduct.price.shipping})`);
```

### Issue: Badge Filter Not Working

**Cause**: Badge text doesn't match exactly

**Solution**:
```javascript
// Extract products first to see actual badges
const products = await walmart_extract_products({ maxResults: 50 });

// Check actual badge values
if (products.content.products.length > 0) {
  console.log("Badges in results:", products.content.products[0].badges);
}

// Use exact badge text
const filtered = await walmart_filter_products({
  badges: ["Best seller"],  // Exact match
  maxResults: 50
});
```

### Issue: Product Details Incomplete

**Cause**: Product page hasn't fully loaded or details aren't available

**Solution**:
```javascript
// Wait for page to load
await new Promise(resolve => setTimeout(resolve, 1500));

// Extract details with full expansion
const details = await walmart_get_product_details({
  expandDetails: true,
  includeImages: true,
  maxImages: 8
});

// Check what was found
console.log(`Specifications available: ${Object.keys(details.content.specifications).length}`);
console.log(`Images available: ${details.content.images.length}`);
console.log(`Description bullets: ${details.content.description.length}`);
```

### Issue: Shipping Not Calculated Correctly

**Cause**: Some Walmart products have variable shipping based on location

**Solution**:
```javascript
// Use client-side filter with shipping enabled
const filtered = await walmart_filter_products({
  minPrice: 50,
  maxPrice: 200,
  includeShipping: true,  // Ensures shipping is factored
  maxResults: 50
});

// Sort with shipping included
const sorted = await walmart_sort_by_price({
  sortOrder: "low-to-high",
  includeShipping: true,  // Critical for accurate results
  maxResults: 50
});

// Check if products have free shipping
const freeShippingProducts = sorted.content.products.filter(p => p.price.freeShipping);
console.log(`${freeShippingProducts.length} products have free shipping`);
```

---

## Related Documentation

- **[MACROS.md](./MACROS.md)** - Complete macro reference (57+ macros)
- **[GOOGLE_SHOPPING_MACROS.md](./GOOGLE_SHOPPING_MACROS.md)** - Google Shopping-specific macros (12 macros)
- **[AMAZON_MACROS.md](./AMAZON_MACROS.md)** - Amazon-specific macros (17 macros)
- **[MULTI_TAB.md](./MULTI_TAB.md)** - Multi-tab workflow patterns
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Comprehensive troubleshooting guide

---

**Built with 🤨 by the Unibrowse team**
