# 🤨 Amazon Macros Reference

Complete reference for all 17 Amazon-specific macros used by the e-commerce sub-agent.

## Table of Contents

1. [Overview](#overview)
2. [Navigation Macros (4)](#navigation-macros)
3. [Extraction Macros (7)](#extraction-macros)
4. [Interaction Macros (5)](#interaction-macros)
5. [Search Macros (1)](#search-macros)
6. [Complete Workflows](#complete-workflows)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Overview

**Amazon macros** are specialized JavaScript functions stored in MongoDB that automate Amazon-specific operations. They provide a higher-level abstraction over direct browser tools and are designed to handle Amazon's specific page structures, interactions, and data formats.

**Total Amazon Macros**: 17
- **Navigation**: 4 macros
- **Extraction**: 7 macros
- **Interaction**: 5 macros
- **Search**: 1 macro

**Site**: `amazon.com` (or localized versions: `amazon.co.uk`, `amazon.de`, etc.)

**Usage Pattern**:
```javascript
// 1. Check if macro exists
const macros = await mcp__browser__browser_list_macros({ site: "amazon.com" });

// 2. Execute macro
const result = await mcp__browser__browser_execute_macro({
  id: "amazon_search",
  params: { query: "wireless headphones" },
  tabTarget: tabId
});

// 3. Use results
console.log("Search executed:", result.content);
```

---

## Navigation Macros

### `amazon_search`

**Description**: Search Amazon with a query string

**Site**: `amazon.com`

**Parameters**:
- `query` (string, required): Search query (e.g., "wireless headphones")

**Returns**:
```javascript
{
  "searchUrl": "https://amazon.com/s?k=wireless+headphones",
  "resultsFound": true,
  "totalResults": "1,000+ results"
}
```

**Example**:
```javascript
const searchResult = await mcp__browser__browser_execute_macro({
  id: "amazon_search",
  params: { query: "wireless headphones" },
  tabTarget: tabId
});

console.log("Search URL:", searchResult.content.searchUrl);
```

**Use Cases**:
- Product search automation
- Price comparison workflows
- Product discovery

**Notes**:
- Navigates to Amazon search results page
- Handles URL encoding automatically
- Works with all Amazon locales (amazon.com, amazon.co.uk, etc.)

---

### `amazon_click_product`

**Description**: Click on a specific product from the listing page

**Site**: `amazon.com`

**Parameters**:
- `index` (number, required): Product index (1-based, e.g., 1 for first product)

**Returns**:
```javascript
{
  "clicked": true,
  "productUrl": "https://amazon.com/dp/B08N5WRWNW",
  "productTitle": "Sony WH-1000XM4 Wireless Headphones"
}
```

**Example**:
```javascript
// Click on first product
const clickResult = await mcp__browser__browser_execute_macro({
  id: "amazon_click_product",
  params: { index: 1 },
  tabTarget: tabId
});

console.log("Navigated to:", clickResult.content.productUrl);
```

**Use Cases**:
- Automated product detail viewing
- Price tracking workflows
- Review analysis

**Notes**:
- Index is 1-based (1 = first product, 2 = second product)
- Skips sponsored products when counting
- Waits for product page to load

---

### `amazon_navigate_pages`

**Description**: Navigate through search result pagination

**Site**: `amazon.com`

**Parameters**:
- `direction` (string, required): "next" or "previous"
- `page` (number, optional): Specific page number to jump to

**Returns**:
```javascript
{
  "navigated": true,
  "currentPage": 2,
  "totalPages": 10,
  "hasNextPage": true,
  "hasPreviousPage": true
}
```

**Example**:
```javascript
// Navigate to next page
const nextPage = await mcp__browser__browser_execute_macro({
  id: "amazon_navigate_pages",
  params: { direction: "next" },
  tabTarget: tabId
});

// Jump to specific page
const page5 = await mcp__browser__browser_execute_macro({
  id: "amazon_navigate_pages",
  params: { page: 5 },
  tabTarget: tabId
});
```

**Use Cases**:
- Multi-page data scraping
- Comprehensive product comparison
- Price monitoring across multiple pages

**Notes**:
- Handles both "Next" button clicks and direct page jumps
- Returns pagination metadata for loop control
- Waits for page load after navigation

---

### `amazon_view_all_reviews`

**Description**: Navigate from product page to full reviews page

**Site**: `amazon.com`

**Parameters**: None

**Returns**:
```javascript
{
  "navigated": true,
  "reviewsUrl": "https://amazon.com/product-reviews/B08N5WRWNW",
  "totalReviews": "12,345 ratings"
}
```

**Example**:
```javascript
// From product page, go to reviews page
const reviewsPage = await mcp__browser__browser_execute_macro({
  id: "amazon_view_all_reviews",
  tabTarget: tabId
});

console.log("Reviews URL:", reviewsPage.content.reviewsUrl);
```

**Use Cases**:
- Detailed review analysis
- Sentiment tracking
- Review search and filtering

**Notes**:
- Must be on product detail page before calling
- Finds and clicks "See all reviews" link
- Waits for reviews page to load

---

## Extraction Macros

### `amazon_get_product_info`

**Description**: Extract complete product details from product page

**Site**: `amazon.com`

**Parameters**: None

**Returns**:
```javascript
{
  "title": "Sony WH-1000XM4 Wireless Headphones",
  "price": "$278.00",
  "rating": 4.7,
  "reviewsCount": 12345,
  "availability": "In Stock",
  "features": [
    "Industry-leading noise cancellation",
    "30-hour battery life",
    "Touch sensor controls"
  ],
  "description": "Long product description...",
  "images": [
    "https://m.media-amazon.com/images/I/71o8Q5XJS5L._AC_SL1500_.jpg",
    "https://m.media-amazon.com/images/I/61vFO3MRZLL._AC_SL1500_.jpg"
  ],
  "asin": "B08N5WRWNW",
  "category": "Electronics > Headphones",
  "brand": "Sony"
}
```

**Example**:
```javascript
// Extract product details
const productInfo = await mcp__browser__browser_execute_macro({
  id: "amazon_get_product_info",
  tabTarget: tabId
});

console.log("Product:", productInfo.content.title);
console.log("Price:", productInfo.content.price);
console.log("Rating:", productInfo.content.rating);
```

**Use Cases**:
- Price tracking
- Product comparison
- Inventory monitoring

**Notes**:
- Must be on product detail page
- Extracts from multiple page sections
- Handles variations in page layout

---

### `amazon_get_listing_products`

**Description**: Extract all products from search/listing page

**Site**: `amazon.com`

**Parameters**: None

**Returns**:
```javascript
{
  "products": [
    {
      "title": "Sony WH-1000XM4 Wireless Headphones",
      "price": "$278.00",
      "rating": 4.7,
      "reviews": 12345,
      "link": "https://amazon.com/dp/B08N5WRWNW",
      "image": "https://m.media-amazon.com/images/I/71o8Q5XJS5L._AC_SL1500_.jpg",
      "sponsored": false,
      "prime": true,
      "bestSeller": true
    },
    // ... more products
  ],
  "totalProducts": 24
}
```

**Example**:
```javascript
// Extract all products from current page
const products = await mcp__browser__browser_execute_macro({
  id: "amazon_get_listing_products",
  tabTarget: tabId
});

console.log(`Found ${products.content.products.length} products`);

// Filter by price
const under100 = products.content.products.filter(p =>
  parseFloat(p.price.replace(/[$,]/g, "")) < 100
);
```

**Use Cases**:
- Price comparison across products
- Multi-product data aggregation
- Market research

**Notes**:
- Extracts from current page only (use with pagination for multi-page)
- Excludes sponsored products by default (unless `sponsored: false` flag)
- Handles various listing formats (grid, list)

---

### `amazon_get_related_products`

**Description**: Extract related/recommended products from product page

**Site**: `amazon.com`

**Parameters**: None

**Returns**:
```javascript
{
  "relatedProducts": [
    {
      "title": "Bose QuietComfort 45",
      "price": "$279.00",
      "rating": 4.5,
      "link": "https://amazon.com/dp/B098FKXT8L",
      "image": "https://m.media-amazon.com/images/I/51JkuOGuWJL._AC_SL1000_.jpg",
      "section": "Customers also bought"
    },
    // ... more products
  ],
  "totalRelated": 12
}
```

**Example**:
```javascript
// Get related products
const related = await mcp__browser__browser_execute_macro({
  id: "amazon_get_related_products",
  tabTarget: tabId
});

console.log("Related products:", related.content.relatedProducts.length);
```

**Use Cases**:
- Product recommendation analysis
- Competitive product discovery
- Cross-selling research

**Notes**:
- Extracts from "Customers also bought", "Frequently bought together", etc.
- Returns products from multiple recommendation sections
- May have duplicates across sections

---

### `amazon_extract_search_results`

**Description**: Extract search results with comprehensive metadata

**Site**: `amazon.com`

**Parameters**: None

**Returns**:
```javascript
{
  "products": [ /* array of products */ ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 10,
    "hasNextPage": true,
    "hasPreviousPage": false
  },
  "filters": {
    "availableCategories": ["Electronics", "Computers", "Office Products"],
    "availableBrands": ["Sony", "Bose", "Sennheiser"],
    "priceRanges": ["Under $25", "$25 to $50", "$50 to $100", "Over $100"]
  },
  "sort": {
    "currentSort": "Featured",
    "availableSorts": ["Featured", "Price: Low to High", "Price: High to Low", "Avg. Customer Review", "Newest Arrivals"]
  },
  "totalResults": "1,000+ results"
}
```

**Example**:
```javascript
// Extract full search results with metadata
const results = await mcp__browser__browser_execute_macro({
  id: "amazon_extract_search_results",
  tabTarget: tabId
});

console.log("Products:", results.content.products.length);
console.log("Available filters:", results.content.filters);
console.log("Pagination:", results.content.pagination);
```

**Use Cases**:
- Comprehensive search analysis
- Filter discovery
- Market research with full context

**Notes**:
- More comprehensive than `amazon_get_listing_products`
- Includes metadata for filters, sorting, pagination
- Useful for understanding available search refinements

---

### `amazon_get_available_filters`

**Description**: Get all available filter options on search page

**Site**: `amazon.com`

**Parameters**: None

**Returns**:
```javascript
{
  "categories": [
    { "name": "Electronics", "count": 500 },
    { "name": "Computers & Accessories", "count": 300 }
  ],
  "brands": [
    { "name": "Sony", "count": 45 },
    { "name": "Bose", "count": 32 }
  ],
  "priceRanges": [
    { "label": "Under $25", "count": 120 },
    { "label": "$25 to $50", "count": 250 }
  ],
  "features": [
    { "name": "Prime", "count": 800 },
    { "name": "Free Shipping", "count": 950 }
  ],
  "ratings": [
    { "stars": "4 Stars & Up", "count": 600 }
  ],
  "availability": [
    { "name": "In Stock", "count": 900 }
  ]
}
```

**Example**:
```javascript
// Get available filters
const filters = await mcp__browser__browser_execute_macro({
  id: "amazon_get_available_filters",
  tabTarget: tabId
});

console.log("Available brands:", filters.content.brands);
console.log("Price ranges:", filters.content.priceRanges);
```

**Use Cases**:
- Dynamic filter discovery
- Search refinement
- Market segment analysis

**Notes**:
- Returns all filter options visible in left sidebar
- Includes result counts per filter
- Use with `amazon_apply_filter` to apply filters

---

### `amazon_get_product_images`

**Description**: Extract all product images including zoomed versions

**Site**: `amazon.com`

**Parameters**: None

**Returns**:
```javascript
{
  "images": [
    {
      "thumbnail": "https://m.media-amazon.com/images/I/71o8Q5XJS5L._AC_SX75_.jpg",
      "large": "https://m.media-amazon.com/images/I/71o8Q5XJS5L._AC_SL1500_.jpg",
      "alt": "Sony WH-1000XM4 front view"
    },
    // ... more images
  ],
  "totalImages": 7
}
```

**Example**:
```javascript
// Get product images
const images = await mcp__browser__browser_execute_macro({
  id: "amazon_get_product_images",
  tabTarget: tabId
});

// Download high-res images
for (const image of images.content.images) {
  console.log("Large image URL:", image.large);
}
```

**Use Cases**:
- Product image archival
- Visual product comparison
- Marketing asset collection

**Notes**:
- Extracts both thumbnail and high-resolution URLs
- Includes alt text for accessibility
- May include 360° view URLs

---

### `amazon_get_reviews_summary`

**Description**: Extract reviews summary statistics from product page

**Site**: `amazon.com`

**Parameters**: None

**Returns**:
```javascript
{
  "overallRating": 4.7,
  "totalReviews": 12345,
  "ratingBreakdown": {
    "5star": 72,  // percentage
    "4star": 15,
    "3star": 8,
    "2star": 3,
    "1star": 2
  },
  "verifiedPurchasePercent": 85,
  "topFeaturesMentioned": {
    "sound quality": { mentions: 450, sentiment: "positive" },
    "noise cancellation": { mentions: 380, sentiment: "positive" },
    "battery life": { mentions: 320, sentiment: "positive" },
    "comfort": { mentions: 280, sentiment: "mixed" }
  },
  "topCriticalReviews": [
    { text: "Battery died after 6 months", rating: 2, helpful: 234 }
  ],
  "topPositiveReviews": [
    { text: "Best headphones I've ever owned", rating: 5, helpful: 567 }
  ]
}
```

**Example**:
```javascript
// Get reviews summary
const reviews = await mcp__browser__browser_execute_macro({
  id: "amazon_get_reviews_summary",
  tabTarget: tabId
});

console.log("Overall rating:", reviews.content.overallRating);
console.log("5-star:", reviews.content.ratingBreakdown["5star"], "%");
console.log("Top features:", reviews.content.topFeaturesMentioned);
```

**Use Cases**:
- Product quality assessment
- Sentiment analysis
- Feature importance ranking

**Notes**:
- Must be on product page
- Extracts from reviews widget and summary section
- Includes feature mentions with sentiment

---

## Interaction Macros

### `amazon_ask_rufus`

**Description**: Interact with Amazon's Rufus AI assistant

**Site**: `amazon.com`

**Parameters**:
- `question` (string, required): Question to ask Rufus (e.g., "What are the best wireless headphones under $100?")

**Returns**:
```javascript
{
  "question": "What are the best wireless headphones under $100?",
  "response": "Based on customer reviews and ratings, here are the top wireless headphones under $100:\n\n1. Sony WH-CH520 - $58 (4.5 stars, 2,345 reviews)\n2. Anker Soundcore Q20 - $60 (4.4 stars, 5,678 reviews)\n3. JBL Tune 510BT - $40 (4.3 stars, 3,456 reviews)\n\nAll three offer excellent sound quality and battery life in this price range.",
  "productRecommendations": [
    {
      "title": "Sony WH-CH520",
      "price": "$58.00",
      "link": "https://amazon.com/dp/B0BSLQ4FKZ"
    },
    // ... more recommendations
  ]
}
```

**Example**:
```javascript
// Ask Rufus for recommendations
const rufusResponse = await mcp__browser__browser_execute_macro({
  id: "amazon_ask_rufus",
  params: { question: "What are the best wireless headphones under $100?" },
  tabTarget: tabId
});

console.log("Rufus says:", rufusResponse.content.response);
console.log("Recommended products:", rufusResponse.content.productRecommendations);
```

**Use Cases**:
- Product recommendations
- Comparison queries
- Feature explanations
- Shopping guidance

**Notes**:
- Requires Rufus to be available (may not be available in all regions)
- Responses are AI-generated by Amazon's Rufus assistant
- May include product recommendations with links

---

### `amazon_apply_filter`

**Description**: Apply a specific filter to search results

**Site**: `amazon.com`

**Parameters**:
- `filterType` (string, required): Type of filter ("price", "brand", "category", "prime", "rating", etc.)
- `value` (string, required): Filter value (e.g., "under-100", "Sony", "Electronics", "true")

**Returns**:
```javascript
{
  "applied": true,
  "filterType": "price",
  "filterValue": "under-100",
  "resultsCount": "245 results"
}
```

**Example**:
```javascript
// Apply price filter
await mcp__browser__browser_execute_macro({
  id: "amazon_apply_filter",
  params: { filterType: "price", value: "under-100" },
  tabTarget: tabId
});

// Apply brand filter
await mcp__browser__browser_execute_macro({
  id: "amazon_apply_filter",
  params: { filterType: "brand", value: "Sony" },
  tabTarget: tabId
});

// Apply Prime filter
await mcp__browser__browser_execute_macro({
  id: "amazon_apply_filter",
  params: { filterType: "prime", value: "true" },
  tabTarget: tabId
});
```

**Use Cases**:
- Search refinement
- Price range filtering
- Brand-specific searches

**Common filter values**:
- **price**: "under-25", "25-50", "50-100", "100-200", "over-200"
- **brand**: Brand name (e.g., "Sony", "Bose")
- **prime**: "true" or "false"
- **rating**: "4stars", "3stars", "2stars", "1star"
- **category**: Category name from available filters

**Notes**:
- Use `amazon_get_available_filters` to discover valid filter values
- Multiple filters can be applied sequentially
- Page reloads after filter application

---

### `amazon_apply_sort`

**Description**: Sort search results by specified criterion

**Site**: `amazon.com`

**Parameters**:
- `sortBy` (string, required): Sort criterion
  - `"featured"` - Amazon's featured sorting (default)
  - `"price-low-high"` - Price: Low to High
  - `"price-high-low"` - Price: High to Low
  - `"rating"` - Avg. Customer Review
  - `"newest"` - Newest Arrivals

**Returns**:
```javascript
{
  "sorted": true,
  "sortBy": "price-low-high",
  "resultsCount": "1,000+ results"
}
```

**Example**:
```javascript
// Sort by price (low to high)
await mcp__browser__browser_execute_macro({
  id: "amazon_apply_sort",
  params: { sortBy: "price-low-high" },
  tabTarget: tabId
});

// Sort by rating
await mcp__browser__browser_execute_macro({
  id: "amazon_apply_sort",
  params: { sortBy: "rating" },
  tabTarget: tabId
});
```

**Use Cases**:
- Finding lowest price
- Finding highest rated products
- Discovering newest products

**Notes**:
- Page reloads after sort application
- Sort persists across pagination
- Can combine with filters

---

### `amazon_select_variation`

**Description**: Select product variation (color, size, style, etc.)

**Site**: `amazon.com`

**Parameters**:
- `variationType` (string, required): Type of variation ("color", "size", "style", "model", etc.)
- `value` (string, required): Variation value (e.g., "Black", "Large", "Pro")

**Returns**:
```javascript
{
  "selected": true,
  "variationType": "color",
  "value": "Black",
  "priceChanged": true,
  "newPrice": "$279.00",
  "availability": "In Stock"
}
```

**Example**:
```javascript
// Select color
await mcp__browser__browser_execute_macro({
  id: "amazon_select_variation",
  params: { variationType: "color", value: "Black" },
  tabTarget: tabId
});

// Select size
await mcp__browser__browser_execute_macro({
  id: "amazon_select_variation",
  params: { variationType: "size", value: "Large" },
  tabTarget: tabId
});
```

**Use Cases**:
- Product configuration before purchase
- Price comparison across variations
- Availability checking per variation

**Notes**:
- Must be on product page with variations
- Some variations may affect price/availability
- Use `amazon_get_product_info` after selection to get updated details

---

### `amazon_add_to_cart`

**Description**: Add current product to cart

**Site**: `amazon.com`

**Parameters**:
- `quantity` (number, optional): Quantity to add (default: 1)

**Returns**:
```javascript
{
  "added": true,
  "productTitle": "Sony WH-1000XM4 Wireless Headphones",
  "quantity": 2,
  "cartTotal": "$556.00",
  "itemsInCart": 3
}
```

**Example**:
```javascript
// Add 1 item to cart
await mcp__browser__browser_execute_macro({
  id: "amazon_add_to_cart",
  params: { quantity: 1 },
  tabTarget: tabId
});

// Add 3 items to cart
await mcp__browser__browser_execute_macro({
  id: "amazon_add_to_cart",
  params: { quantity: 3 },
  tabTarget: tabId
});
```

**Use Cases**:
- Automated cart management
- Bulk ordering
- Price monitoring with cart snapshots

**Notes**:
- Must be on product page
- Variations must be selected before adding to cart
- Returns updated cart total and item count

---

## Search Macros

### `amazon_search_reviews`

**Description**: Search within product reviews for specific keywords

**Site**: `amazon.com`

**Parameters**:
- `query` (string, required): Search term (e.g., "battery life", "sound quality")

**Returns**:
```javascript
{
  "query": "battery life",
  "matchingReviews": [
    {
      "rating": 5,
      "title": "Excellent battery life!",
      "text": "The battery life is amazing - lasts 30+ hours on a single charge. I can use these for a week without charging.",
      "verified": true,
      "helpful": 234,
      "date": "2024-01-15"
    },
    {
      "rating": 2,
      "title": "Battery died after 6 months",
      "text": "Battery life was great initially, but after 6 months it barely lasts 10 hours. Very disappointed.",
      "verified": true,
      "helpful": 123,
      "date": "2024-02-10"
    },
    // ... more reviews
  ],
  "totalMatches": 145
}
```

**Example**:
```javascript
// Search reviews for "battery life"
const batteryReviews = await mcp__browser__browser_execute_macro({
  id: "amazon_search_reviews",
  params: { query: "battery life" },
  tabTarget: tabId
});

console.log(`Found ${batteryReviews.content.totalMatches} reviews mentioning "battery life"`);

// Analyze sentiment
const positive = batteryReviews.content.matchingReviews.filter(r => r.rating >= 4);
const negative = batteryReviews.content.matchingReviews.filter(r => r.rating <= 2);

console.log(`Positive: ${positive.length}, Negative: ${negative.length}`);
```

**Use Cases**:
- Feature-specific sentiment analysis
- Topic-based review filtering
- Problem identification (search for "broke", "defect", etc.)

**Notes**:
- Must be on product page or reviews page
- Returns top matching reviews (sorted by helpfulness)
- Use for focused analysis of specific features/concerns

---

## Complete Workflows

### Workflow 1: Product Search and Analysis

```javascript
// 1. Create and label tab
const tab = await mcp__browser__browser_create_tab({ url: "https://amazon.com" });
await mcp__browser__browser_set_tab_label({
  tabTarget: tab.content.tabId,
  label: "amazon-analysis"
});

const tabId = tab.content.tabId;

// 2. Search for product
await mcp__browser__browser_execute_macro({
  id: "amazon_search",
  params: { query: "wireless headphones" },
  tabTarget: tabId
});

// 3. Apply filters
await mcp__browser__browser_execute_macro({
  id: "amazon_apply_filter",
  params: { filterType: "price", value: "under-100" },
  tabTarget: tabId
});

await mcp__browser__browser_execute_macro({
  id: "amazon_apply_filter",
  params: { filterType: "prime", value: "true" },
  tabTarget: tabId
});

// 4. Sort by rating
await mcp__browser__browser_execute_macro({
  id: "amazon_apply_sort",
  params: { sortBy: "rating" },
  tabTarget: tabId
});

// 5. Extract products
const products = await mcp__browser__browser_execute_macro({
  id: "amazon_get_listing_products",
  tabTarget: tabId
});

// 6. Click on first product
await mcp__browser__browser_execute_macro({
  id: "amazon_click_product",
  params: { index: 1 },
  tabTarget: tabId
});

// 7. Get product details
const productInfo = await mcp__browser__browser_execute_macro({
  id: "amazon_get_product_info",
  tabTarget: tabId
});

// 8. Get reviews summary
const reviews = await mcp__browser__browser_execute_macro({
  id: "amazon_get_reviews_summary",
  tabTarget: tabId
});

// 9. Return comprehensive analysis
return {
  tabId: tabId,
  searchResults: products.content.products,
  selectedProduct: productInfo.content,
  reviews: reviews.content
};
```

### Workflow 2: Rufus AI-Powered Shopping

```javascript
// 1. Create tab and navigate
const tab = await mcp__browser__browser_create_tab({ url: "https://amazon.com" });
const tabId = tab.content.tabId;

// 2. Ask Rufus for recommendations
const recommendations = await mcp__browser__browser_execute_macro({
  id: "amazon_ask_rufus",
  params: { question: "What are the best wireless headphones for working from home under $150?" },
  tabTarget: tabId
});

// 3. Search for first recommended product
if (recommendations.content.productRecommendations.length > 0) {
  const firstRec = recommendations.content.productRecommendations[0];

  await mcp__browser__browser_navigate({
    url: firstRec.link,
    tabTarget: tabId
  });

  // 4. Get detailed product info
  const productInfo = await mcp__browser__browser_execute_macro({
    id: "amazon_get_product_info",
    tabTarget: tabId
  });

  // 5. Search reviews for key features
  const comfortReviews = await mcp__browser__browser_execute_macro({
    id: "amazon_search_reviews",
    params: { query: "comfort" },
    tabTarget: tabId
  });

  const noiseCancelReviews = await mcp__browser__browser_execute_macro({
    id: "amazon_search_reviews",
    params: { query: "noise cancellation" },
    tabTarget: tabId
  });

  // 6. Return comprehensive analysis
  return {
    rufusRecommendation: recommendations.content.response,
    product: productInfo.content,
    comfortReviews: comfortReviews.content.matchingReviews.slice(0, 5),
    noiseCancelReviews: noiseCancelReviews.content.matchingReviews.slice(0, 5)
  };
}
```

### Workflow 3: Multi-Page Price Comparison

```javascript
// 1. Create tab and search
const tab = await mcp__browser__browser_create_tab({ url: "https://amazon.com" });
const tabId = tab.content.tabId;

await mcp__browser__browser_execute_macro({
  id: "amazon_search",
  params: { query: "mechanical keyboard" },
  tabTarget: tabId
});

// 2. Sort by price (low to high)
await mcp__browser__browser_execute_macro({
  id: "amazon_apply_sort",
  params: { sortBy: "price-low-high" },
  tabTarget: tabId
});

// 3. Extract products from multiple pages
let allProducts = [];
let currentPage = 1;
const maxPages = 3;

while (currentPage <= maxPages) {
  // Extract products from current page
  const pageProducts = await mcp__browser__browser_execute_macro({
    id: "amazon_get_listing_products",
    tabTarget: tabId
  });

  allProducts = allProducts.concat(pageProducts.content.products);

  // Check if there's a next page
  const pagination = await mcp__browser__browser_execute_macro({
    id: "amazon_navigate_pages",
    params: { direction: "next" },
    tabTarget: tabId
  });

  if (!pagination.content.hasNextPage) {
    break;
  }

  currentPage++;
  await mcp__browser__browser_wait({ time: 2, tabTarget: tabId });
}

// 4. Analyze prices
const priceAnalysis = {
  totalProducts: allProducts.length,
  lowestPrice: Math.min(...allProducts.map(p => parseFloat(p.price.replace(/[$,]/g, "")))),
  highestPrice: Math.max(...allProducts.map(p => parseFloat(p.price.replace(/[$,]/g, "")))),
  averagePrice: allProducts.reduce((sum, p) => sum + parseFloat(p.price.replace(/[$,]/g, "")), 0) / allProducts.length,
  primeEligible: allProducts.filter(p => p.prime).length
};

return {
  tabId: tabId,
  products: allProducts,
  analysis: priceAnalysis
};
```

---

## Best Practices

### 1. Check Macro Availability

```javascript
// Always check if macro exists before using
const macros = await mcp__browser__browser_list_macros({ site: "amazon.com" });
const amazonSearch = macros.content.macros.find(m => m.id === "amazon_search");

if (amazonSearch) {
  await mcp__browser__browser_execute_macro({
    id: "amazon_search",
    params: { query: "headphones" },
    tabTarget: tabId
  });
} else {
  // Fall back to direct navigation
  await mcp__browser__browser_navigate({
    url: "https://amazon.com/s?k=headphones",
    tabTarget: tabId
  });
}
```

### 2. Use Macros in Sequence

```javascript
// Macros work best when chained in logical order
// 1. Search
await mcp__browser__browser_execute_macro({
  id: "amazon_search",
  params: { query: "wireless headphones" }
});

// 2. Filter
await mcp__browser__browser_execute_macro({
  id: "amazon_apply_filter",
  params: { filterType: "price", value: "under-100" }
});

// 3. Sort
await mcp__browser__browser_execute_macro({
  id: "amazon_apply_sort",
  params: { sortBy: "rating" }
});

// 4. Extract
const products = await mcp__browser__browser_execute_macro({
  id: "amazon_get_listing_products"
});
```

### 3. Handle Errors Gracefully

```javascript
try {
  const result = await mcp__browser__browser_execute_macro({
    id: "amazon_search",
    params: { query: "headphones" },
    tabTarget: tabId
  });
} catch (error) {
  console.log("Macro failed, falling back to direct tools");

  // Fall back to direct navigation
  await mcp__browser__browser_navigate({
    url: "https://amazon.com/s?k=headphones",
    tabTarget: tabId
  });
}
```

### 4. Wait Between Operations

```javascript
// Some operations need time to complete
await mcp__browser__browser_execute_macro({
  id: "amazon_apply_filter",
  params: { filterType: "prime", value: "true" }
});

// Wait for page reload
await mcp__browser__browser_wait({ time: 2, tabTarget: tabId });

// Continue with extraction
const products = await mcp__browser__browser_execute_macro({
  id: "amazon_get_listing_products",
  tabTarget: tabId
});
```

---

## Troubleshooting

### Macro Execution Failed

**Problem**: `amazon_search` returns error

**Solutions**:
- Check if on Amazon domain (amazon.com, amazon.co.uk, etc.)
- Verify MongoDB is running and macros are stored
- Try listing macros to confirm availability
- Fall back to direct browser tools

### Product Not Found

**Problem**: `amazon_click_product` fails to find product

**Solutions**:
- Ensure on search results page
- Verify products are loaded (wait for page)
- Check if index is valid (1-based, within range)
- Use `amazon_get_listing_products` first to verify products exist

### Filter Not Applied

**Problem**: `amazon_apply_filter` doesn't work

**Solutions**:
- Use `amazon_get_available_filters` to check valid filter values
- Ensure correct filter type and value format
- Wait for page reload after applying filter
- Verify you're on search results page

### Rufus Not Available

**Problem**: `amazon_ask_rufus` returns "Rufus not available"

**Solutions**:
- Check if Rufus is available in your region
- Try refreshing the page
- Fall back to regular search and extraction
- Use `amazon_get_reviews_summary` for product insights instead

---

## See Also

- [MACROS.md](./MACROS.md) - Complete macro reference (universal + Amazon)
- [MULTI_TAB.md](./MULTI_TAB.md) - Multi-tab workflow patterns
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - General troubleshooting
- [../agents/browser-ecommerce.md](../agents/browser-ecommerce.md) - E-commerce sub-agent documentation
