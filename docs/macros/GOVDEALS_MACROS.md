# GovDeals.com Macro System

Comprehensive macro system for finding government surplus deals on GovDeals.com.

**Focus**: Electronics & IT equipment within 50-mile radius of zip code 01450
**Scope**: Search and extraction only (no bidding automation)
**Total Macros**: 13 (3 navigation, 6 extraction, 3 interaction, 1 utility)

---

## Table of Contents

- [Overview](#overview)
- [Safety & Best Practices](#safety--best-practices)
- [Macro Catalog](#macro-catalog)
  - [Navigation Macros](#navigation-macros-3)
  - [Extraction Macros](#extraction-macros-6)
  - [Interaction Macros](#interaction-macros-3)
  - [Utility Macros](#utility-macros-1)
- [Complete Workflows](#complete-workflows)
- [Testing Guide](#testing-guide)
- [Troubleshooting](#troubleshooting)

---

## Overview

The GovDeals macro system provides token-efficient automation for discovering government surplus auction listings. These macros handle location-based search, category filtering, result extraction, and detail retrieval without requiring full-page snapshots.

### Key Features

- **Location-based search**: Filter by zip code with configurable radius
- **Category filtering**: Focus on Electronics & IT equipment
- **Multi-page extraction**: Navigate and extract across result pages
- **Detailed item data**: Extract specifications, pricing, timing, and images
- **Price & sort filters**: Refine searches by price range and sort order
- **Type-ahead autocomplete**: Handle dynamic category selection

### Architecture

All macros follow the proven eBay pattern:
- Arrow function format: `(params) => { ... }`
- Multi-layer selector fallback
- Event dispatch for form interactions
- Pattern-based text extraction
- Return metadata instead of performing navigation

---

## Safety & Best Practices

### Token Efficiency

- **Avoid snapshots**: Use macros to extract structured data instead of full-page snapshots
- **Batch operations**: Extract multiple results in one macro call (default: 60 items)
- **Pagination metadata**: Get page info without loading additional pages
- **Selective extraction**: Use parameters to extract only needed data (e.g., `extractImages: false`)

### Reliability Ratings

- **High**: Core search and extraction macros (tested patterns)
- **Medium**: Navigation and filter macros (site-dependent)
- **Low**: Seller info and advanced features (may require live testing)

### Error Handling

All macros return:
```javascript
{
  success: boolean,
  // ... macro-specific data
  error: string | null
}
```

Always check `success` before using results:
```javascript
const result = await browser_execute_macro({ id: "govdeals_extract_search_results" });
if (!result.success) {
  console.error("Extraction failed:", result.error);
}
```

---

## Macro Catalog

### Navigation Macros (3)

#### 1. `govdeals_location_search`

Search GovDeals by location (zip code + radius) with optional category filter.

**Category**: navigation
**Reliability**: high
**Tags**: search, location, core

**Parameters**:
```javascript
{
  zipCode: "01450",          // Required: 5-digit zip code
  distance: 50,              // Optional: Search radius in miles (default: 50)
  category: "Electronics"    // Optional: Category filter
}
```

**Returns**:
```javascript
{
  success: true,
  action: "location_search_executed",
  searchParams: {
    zipCode: "01450",
    distance: 50,
    category: "Electronics"
  },
  url: "https://www.govdeals.com/...",
  resultsFound: true,
  error: null
}
```

**Example**:
```javascript
await browser_execute_macro({
  id: "govdeals_location_search",
  params: {
    zipCode: "01450",
    distance: 50,
    category: "Electronics"
  }
});

await browser_wait({ time: 2 }); // Wait for results to load
```

**Selectors**:
- Zip input: `input[name="zipCode"]`, `#zipCode`, `input[placeholder*="Zip"]`
- Distance: `select[name="distance"]`, `#distance`
- Category: `input[name="category"]`, `#categorySearch` (handles autocomplete)
- Submit: `button[type="submit"]`, text match `/search/i`

---

#### 2. `govdeals_advanced_search`

Execute advanced search with multiple filters (query, price, category, status, date range).

**Category**: navigation
**Reliability**: medium
**Tags**: search, advanced, filters

**Parameters**:
```javascript
{
  query: "Dell server",      // Optional: Search text
  priceMin: 100,             // Optional: Minimum price
  priceMax: 1000,            // Optional: Maximum price
  category: "Electronics",   // Optional: Category filter
  status: "active",          // Optional: active|ending_soon|sold
  dateRange: {               // Optional: Date range filter
    start: "2026-01-01",
    end: "2026-02-28"
  }
}
```

**Returns**:
```javascript
{
  success: true,
  action: "advanced_search_executed",
  filtersApplied: {
    query: "Dell server",
    priceMin: 100,
    priceMax: 1000,
    category: "Electronics"
  },
  url: "https://www.govdeals.com/...",
  error: null
}
```

**Example**:
```javascript
await browser_execute_macro({
  id: "govdeals_advanced_search",
  params: {
    query: "Dell PowerEdge",
    priceMax: 1000,
    category: "Electronics",
    status: "active"
  }
});
```

---

#### 3. `govdeals_navigate_page`

Navigate to specific page number in search results. Returns page URL metadata.

**Category**: navigation
**Reliability**: high
**Tags**: navigation, pagination

**Parameters**:
```javascript
{
  page: 3  // Required: Page number to navigate to
}
```

**Returns**:
```javascript
{
  success: true,
  action: "page_navigation_prepared",
  targetPage: 3,
  pageUrl: "https://www.govdeals.com/...?page=3",
  error: null
}
```

**Example**:
```javascript
const pageInfo = await browser_execute_macro({
  id: "govdeals_navigate_page",
  params: { page: 3 }
});

if (pageInfo.success) {
  await browser_navigate({ url: pageInfo.pageUrl });
  await browser_wait({ time: 2 });
}
```

**Note**: This macro returns the URL to navigate to but does NOT perform the navigation. Caller must use `browser_navigate()`.

---

### Extraction Macros (6)

#### 4. `govdeals_extract_search_results`

Extract auction listings from search results page with details (title, price, time, location, images).

**Category**: extraction
**Reliability**: high
**Tags**: extraction, search, core

**Parameters**:
```javascript
{
  limit: 60,           // Optional: Max results to extract (default: 60)
  includeImages: true  // Optional: Include image URLs (default: true)
}
```

**Returns**:
```javascript
{
  success: true,
  results: [
    {
      id: "12345",
      title: "Dell PowerEdge R740 Server",
      currentBid: 450.00,
      minimumBid: 500.00,
      reserveMet: false,
      timeRemaining: "2 days 4 hours",
      endDate: "2026-02-10T15:30:00Z",
      location: "Boston, MA",
      distance: "15 miles",
      seller: "State of Massachusetts",
      imageUrl: "https://...",
      itemUrl: "https://www.govdeals.com/...",
      category: "Electronics",
      condition: "Used - Good"
    }
    // ... more results
  ],
  totalExtracted: 24,
  hasMore: true,
  error: null
}
```

**Example**:
```javascript
const results = await browser_execute_macro({
  id: "govdeals_extract_search_results",
  params: { limit: 50 }
});

console.log(`Found ${results.totalExtracted} listings`);
console.log(`Has more pages: ${results.hasMore}`);

// Access first result
if (results.results.length > 0) {
  const firstItem = results.results[0];
  console.log(`${firstItem.title} - $${firstItem.currentBid}`);
  console.log(`Location: ${firstItem.location}`);
}
```

**Selectors**:
- Container: `.auction-item`, `.listing-card`, `[data-auction-id]`
- Title: `.item-title`, `h3.title`, `.auction-title`
- Price: `.current-bid`, `.bid-amount`, pattern `/\$[\d,]+\.?\d*/`
- Time: `.time-remaining`, `.countdown`, `[data-end-date]`
- Location: `.item-location`, `.seller-location`, `.distance`
- Image: `img.item-image`, `.image-container img`

---

#### 5. `govdeals_extract_listing_details`

Extract complete details from auction listing page (description, specs, pricing, timing, images, bid history).

**Category**: extraction
**Reliability**: high
**Tags**: extraction, details, core

**Parameters**:
```javascript
{
  extractSpecs: true,       // Optional: Extract specifications table (default: true)
  extractImages: true,      // Optional: Extract all image URLs (default: true)
  extractBidHistory: false  // Optional: Extract bid history (default: false)
}
```

**Returns**:
```javascript
{
  success: true,
  listing: {
    id: "12345",
    title: "Dell PowerEdge R740 Server",
    description: "Full HTML description...",
    specifications: {
      manufacturer: "Dell",
      model: "PowerEdge R740",
      condition: "Used - Good",
      serialNumber: "ABC123",
      processor: "Intel Xeon",
      memory: "64GB DDR4",
      storage: "2TB SSD"
    },
    pricing: {
      currentBid: 450.00,
      minimumBid: 500.00,
      nextMinimumBid: 550.00,
      bidIncrement: 50.00,
      reservePrice: null,
      reserveMet: false,
      totalCost: 450.00,
      fees: []
    },
    timing: {
      startDate: "2026-02-01T10:00:00Z",
      endDate: "2026-02-10T15:30:00Z",
      timeRemaining: "2 days 4 hours",
      auctionStatus: "active"
    },
    seller: {
      name: "State of Massachusetts",
      location: "Boston, MA",
      rating: null,
      contactInfo: {}
    },
    images: [
      { url: "...", thumbnail: "...", fullSize: "..." }
    ],
    bidHistory: [
      { bidder: "User***123", amount: 450.00, timestamp: "..." }
    ]
  },
  error: null
}
```

**Example**:
```javascript
// Navigate to listing page first
await browser_click({ selector: results.results[0].itemUrl });
await browser_wait({ time: 2 });

// Extract full details
const details = await browser_execute_macro({
  id: "govdeals_extract_listing_details",
  params: {
    extractSpecs: true,
    extractImages: true,
    extractBidHistory: false
  }
});

if (details.success) {
  console.log("Title:", details.listing.title);
  console.log("Current Bid:", details.listing.pricing.currentBid);
  console.log("Time Remaining:", details.listing.timing.timeRemaining);
  console.log("Specifications:", details.listing.specifications);
}
```

**Selectors**:
- Title: `h1.item-title`, `h1.auction-title`, `h1`
- Description: `.item-description`, `#description`, `.asset-details`
- Specs table: `.specifications`, `.item-specs`, `table.details`
- Price: `.current-bid`, `.bid-amount`
- Time: `.time-remaining`, `.countdown`, `[data-end-date]`
- Images: `.gallery img`, `.image-gallery img`
- Bid history: `.bid-history`, `table.bids`

---

#### 6. `govdeals_extract_seller_info`

Extract seller information from listing or seller page.

**Category**: extraction
**Reliability**: low
**Tags**: extraction, seller

**Parameters**: None

**Returns**:
```javascript
{
  success: true,
  seller: {
    name: "State of Massachusetts",
    location: "Boston, MA",
    totalAuctions: 45,
    activeAuctions: 12,
    rating: null,
    contactInfo: {
      phone: "555-1234",
      email: "surplus@state.ma.us",
      website: "https://..."
    }
  },
  error: null
}
```

**Example**:
```javascript
const sellerInfo = await browser_execute_macro({
  id: "govdeals_extract_seller_info"
});

if (sellerInfo.success) {
  console.log(`Seller: ${sellerInfo.seller.name}`);
  console.log(`Active auctions: ${sellerInfo.seller.activeAuctions}`);
}
```

---

#### 7. `govdeals_extract_pagination_info`

Extract pagination metadata from search results (current page, total pages, results count, navigation URLs).

**Category**: extraction
**Reliability**: medium
**Tags**: extraction, pagination

**Parameters**: None

**Returns**:
```javascript
{
  success: true,
  pagination: {
    currentPage: 2,
    totalPages: 12,
    resultsPerPage: 24,
    totalResults: 285,
    hasNextPage: true,
    hasPreviousPage: true,
    nextPageUrl: "https://www.govdeals.com/...?page=3",
    previousPageUrl: "https://www.govdeals.com/...?page=1"
  },
  error: null
}
```

**Example**:
```javascript
const pagination = await browser_execute_macro({
  id: "govdeals_extract_pagination_info"
});

console.log(`Page ${pagination.pagination.currentPage} of ${pagination.pagination.totalPages}`);
console.log(`Total results: ${pagination.pagination.totalResults}`);

if (pagination.pagination.hasNextPage) {
  console.log("Next page URL:", pagination.pagination.nextPageUrl);
}
```

**Selectors**:
- Current page: `.pagination .active`, `[aria-current="page"]`
- Page links: `.pagination a`, `.pager a`
- Next/prev: `a[rel="next"]`, `a[rel="prev"]`

---

#### 8. `govdeals_extract_available_filters`

Extract available filter options from search page (categories, price ranges, statuses).

**Category**: extraction
**Reliability**: low
**Tags**: extraction, filters

**Parameters**: None

**Returns**:
```javascript
{
  success: true,
  filters: {
    categories: [
      { label: "Electronics", value: "electronics" },
      { label: "Vehicles", value: "vehicles" }
    ],
    priceRanges: [],
    statuses: [
      { label: "Active", value: "active" },
      { label: "Ending Soon", value: "ending_soon" }
    ],
    locations: [],
    conditions: [
      { label: "New", value: "new" },
      { label: "Used - Good", value: "used_good" }
    ]
  },
  error: null
}
```

**Example**:
```javascript
const filters = await browser_execute_macro({
  id: "govdeals_extract_available_filters"
});

console.log("Available categories:");
filters.filters.categories.forEach(cat => {
  console.log(`- ${cat.label}`);
});
```

---

#### 9. `govdeals_extract_category_tree`

Extract complete category hierarchy with focus on Electronics & IT equipment.

**Category**: extraction
**Reliability**: low
**Tags**: extraction, categories

**Parameters**: None

**Returns**:
```javascript
{
  success: true,
  categoryTree: {
    root: [
      {
        name: "Electronics",
        url: "https://...",
        subcategories: [
          { name: "Computers", url: "..." },
          { name: "Servers", url: "..." },
          { name: "Networking", url: "..." }
        ]
      }
    ],
    electronics: [
      { name: "Computers", url: "..." },
      { name: "Servers", url: "..." },
      { name: "Networking", url: "..." }
    ]
  },
  error: null
}
```

---

### Interaction Macros (3)

#### 10. `govdeals_apply_category_filter`

Apply category filter with type-ahead autocomplete support.

**Category**: interaction
**Reliability**: high
**Tags**: interaction, filter, core

**Parameters**:
```javascript
{
  category: "Electronics",      // Required: Category name or path
  applyImmediately: true        // Optional: Apply filter immediately (default: true)
}
```

**Returns**:
```javascript
{
  success: true,
  action: "category_filter_applied",
  category: "Electronics",
  filterApplied: true,
  resultsUpdated: false,
  error: null
}
```

**Example**:
```javascript
await browser_execute_macro({
  id: "govdeals_apply_category_filter",
  params: {
    category: "Electronics",
    applyImmediately: true
  }
});

await browser_wait({ time: 2 }); // Wait for results to update
```

**Implementation Notes**:
- Handles SELECT dropdowns
- Handles INPUT with type-ahead autocomplete
- Waits 500ms for autocomplete suggestions
- Falls back to form submission if no suggestions

---

#### 11. `govdeals_apply_price_filter`

Apply price range filter (min and/or max).

**Category**: interaction
**Reliability**: medium
**Tags**: interaction, filter, price

**Parameters**:
```javascript
{
  minPrice: 100,   // Optional: Minimum price
  maxPrice: 1000   // Optional: Maximum price
}
```

**Returns**:
```javascript
{
  success: true,
  action: "price_filter_applied",
  priceRange: { min: 100, max: 1000 },
  filterApplied: true,
  error: null
}
```

**Example**:
```javascript
await browser_execute_macro({
  id: "govdeals_apply_price_filter",
  params: {
    minPrice: 100,
    maxPrice: 1000
  }
});

await browser_wait({ time: 2 });
```

---

#### 12. `govdeals_apply_sort`

Apply sort order to search results.

**Category**: interaction
**Reliability**: low
**Tags**: interaction, sort

**Parameters**:
```javascript
{
  sortBy: "ending_soon"  // Required: ending_soon|price_low|price_high|newest|distance
}
```

**Returns**:
```javascript
{
  success: true,
  action: "sort_applied",
  sortBy: "ending_soon",
  sortApplied: true,
  error: null
}
```

**Example**:
```javascript
await browser_execute_macro({
  id: "govdeals_apply_sort",
  params: { sortBy: "ending_soon" }
});

await browser_wait({ time: 2 });
```

**Sort Options**:
- `ending_soon`: Auctions ending soonest first
- `price_low`: Lowest price first
- `price_high`: Highest price first
- `newest`: Newest listings first
- `distance`: Closest location first

---

### Utility Macros (1)

#### 13. `govdeals_detect_page_type`

Detect current page type in GovDeals workflow.

**Category**: util
**Reliability**: medium
**Tags**: utility, detection

**Parameters**: None

**Returns**:
```javascript
{
  success: true,
  pageType: "search_results",  // or: listing_detail, advanced_search, home, unknown
  url: "https://www.govdeals.com/...",
  metadata: {
    searchParams: {
      zipCode: "01450",
      category: "Electronics",
      page: "2"
    }
  },
  error: null
}
```

**Example**:
```javascript
const pageType = await browser_execute_macro({
  id: "govdeals_detect_page_type"
});

if (pageType.pageType === "search_results") {
  // Extract search results
  const results = await browser_execute_macro({
    id: "govdeals_extract_search_results"
  });
} else if (pageType.pageType === "listing_detail") {
  // Extract listing details
  const details = await browser_execute_macro({
    id: "govdeals_extract_listing_details"
  });
}
```

**Detection Logic**:
- URL patterns: `/search`, `/listing/`, `/advanced-search`
- Element presence: `.search-results`, `.auction-detail`, form presence
- Metadata extraction from URL parameters

---

## Complete Workflows

### Workflow 1: Find Electronics Near 01450

Search for electronics within 50 miles, filter by price, and extract top results.

```javascript
// Step 1: Navigate to GovDeals
await browser_navigate({ url: "https://www.govdeals.com" });
await browser_wait({ time: 2 });

// Step 2: Search by location and category
await browser_execute_macro({
  id: "govdeals_location_search",
  params: {
    zipCode: "01450",
    distance: 50,
    category: "Electronics"
  }
});
await browser_wait({ time: 2 });

// Step 3: Apply price filter
await browser_execute_macro({
  id: "govdeals_apply_price_filter",
  params: { maxPrice: 1000 }
});
await browser_wait({ time: 2 });

// Step 4: Sort by ending soon
await browser_execute_macro({
  id: "govdeals_apply_sort",
  params: { sortBy: "ending_soon" }
});
await browser_wait({ time: 2 });

// Step 5: Extract results
const results = await browser_execute_macro({
  id: "govdeals_extract_search_results",
  params: { limit: 50 }
});

console.log(`Found ${results.totalExtracted} deals`);

// Step 6: Get details for top result
if (results.results.length > 0) {
  await browser_navigate({ url: results.results[0].itemUrl });
  await browser_wait({ time: 2 });

  const details = await browser_execute_macro({
    id: "govdeals_extract_listing_details",
    params: { extractSpecs: true }
  });

  console.log("Title:", details.listing.title);
  console.log("Current Bid:", details.listing.pricing.currentBid);
  console.log("Specs:", details.listing.specifications);
}
```

**Output**:
```
Found 24 deals
Title: Dell PowerEdge R740 Server
Current Bid: 450.00
Specs: {
  manufacturer: "Dell",
  model: "PowerEdge R740",
  processor: "Intel Xeon",
  memory: "64GB DDR4",
  storage: "2TB SSD"
}
```

---

### Workflow 2: Multi-Page Extraction

Extract all results across multiple pages.

```javascript
// Navigate and search
await browser_navigate({ url: "https://www.govdeals.com" });
await browser_wait({ time: 2 });

await browser_execute_macro({
  id: "govdeals_location_search",
  params: {
    zipCode: "01450",
    distance: 50,
    category: "Electronics"
  }
});
await browser_wait({ time: 3 });

// Multi-page extraction loop
let allResults = [];
let page = 1;

while (true) {
  console.log(`Extracting page ${page}...`);

  // Extract current page results
  const pageResults = await browser_execute_macro({
    id: "govdeals_extract_search_results",
    params: { limit: 60 }
  });

  allResults.push(...pageResults.results);
  console.log(`Extracted ${pageResults.totalExtracted} listings from page ${page}`);

  // Check pagination
  const pagination = await browser_execute_macro({
    id: "govdeals_extract_pagination_info"
  });

  if (!pagination.pagination.hasNextPage) {
    console.log("No more pages");
    break;
  }

  // Navigate to next page
  await browser_navigate({ url: pagination.pagination.nextPageUrl });
  await browser_wait({ time: 2 });
  page++;

  // Safety limit
  if (page > 20) {
    console.log("Reached page limit (20)");
    break;
  }
}

console.log(`Total extracted: ${allResults.length} listings across ${page} pages`);

// Analyze results
const avgPrice = allResults.reduce((sum, r) => sum + (r.currentBid || 0), 0) / allResults.length;
console.log(`Average price: $${avgPrice.toFixed(2)}`);

const byLocation = allResults.reduce((acc, r) => {
  acc[r.location] = (acc[r.location] || 0) + 1;
  return acc;
}, {});
console.log("Listings by location:", byLocation);
```

**Output**:
```
Extracting page 1...
Extracted 24 listings from page 1
Extracting page 2...
Extracted 24 listings from page 2
Extracting page 3...
Extracted 18 listings from page 3
No more pages
Total extracted: 66 listings across 3 pages
Average price: $327.45
Listings by location: {
  "Boston, MA": 25,
  "Worcester, MA": 18,
  "Manchester, NH": 15,
  "Providence, RI": 8
}
```

---

### Workflow 3: Advanced Search with Filters

Use advanced search to find specific items.

```javascript
// Navigate to advanced search
await browser_navigate({ url: "https://www.govdeals.com/advanced-search" });
await browser_wait({ time: 2 });

// Execute advanced search
await browser_execute_macro({
  id: "govdeals_advanced_search",
  params: {
    query: "Dell server",
    priceMin: 200,
    priceMax: 1500,
    category: "Electronics",
    status: "active"
  }
});
await browser_wait({ time: 3 });

// Extract results
const results = await browser_execute_macro({
  id: "govdeals_extract_search_results",
  params: { limit: 30 }
});

// Filter for specific specs
const serversWithSpecs = [];

for (const item of results.results.slice(0, 10)) {  // Check top 10
  await browser_navigate({ url: item.itemUrl });
  await browser_wait({ time: 2 });

  const details = await browser_execute_macro({
    id: "govdeals_extract_listing_details",
    params: { extractSpecs: true, extractImages: false }
  });

  // Filter by specifications
  const specs = details.listing.specifications;
  if (specs.memory && specs.memory.includes("64GB")) {
    serversWithSpecs.push({
      title: details.listing.title,
      price: details.listing.pricing.currentBid,
      memory: specs.memory,
      processor: specs.processor,
      url: item.itemUrl
    });
  }

  console.log(`Checked: ${item.title} - ${specs.memory || 'No memory info'}`);
}

console.log(`\nFound ${serversWithSpecs.length} servers with 64GB+ RAM:`);
serversWithSpecs.forEach(server => {
  console.log(`- ${server.title} ($${server.price})`);
  console.log(`  ${server.processor} | ${server.memory}`);
  console.log(`  ${server.url}`);
});
```

---

### Workflow 4: Monitor Ending Soon Auctions

Track auctions ending within 24 hours.

```javascript
// Search for electronics
await browser_navigate({ url: "https://www.govdeals.com" });
await browser_wait({ time: 2 });

await browser_execute_macro({
  id: "govdeals_location_search",
  params: {
    zipCode: "01450",
    distance: 50,
    category: "Electronics"
  }
});
await browser_wait({ time: 2 });

// Sort by ending soon
await browser_execute_macro({
  id: "govdeals_apply_sort",
  params: { sortBy: "ending_soon" }
});
await browser_wait({ time: 2 });

// Extract results
const results = await browser_execute_macro({
  id: "govdeals_extract_search_results",
  params: { limit: 50 }
});

// Filter items ending within 24 hours
const endingSoon = results.results.filter(item => {
  const time = item.timeRemaining.toLowerCase();
  return (
    time.includes('hour') ||
    (time.includes('day') && parseInt(time) === 1)
  );
});

console.log(`Found ${endingSoon.length} auctions ending within 24 hours:\n`);

endingSoon.forEach(item => {
  console.log(`${item.title}`);
  console.log(`  Current Bid: $${item.currentBid || 'No bids'}`);
  console.log(`  Time Remaining: ${item.timeRemaining}`);
  console.log(`  Location: ${item.location}`);
  console.log(`  URL: ${item.itemUrl}\n`);
});
```

---

## Testing Guide

### Initial Setup

```bash
# Ensure Unibrowse is running
docker compose up -d

# Verify macros are stored
echo 'db.macros.find({site: "govdeals.com"}).count()' | \
  docker compose exec -T mongodb mongosh unibrowse --quiet
# Should output: 13
```

### Test 1: Basic Location Search

```javascript
// Start browser
await browser_launch_isolated_chrome({ headless: false });

// Navigate to GovDeals
await browser_navigate({ url: "https://www.govdeals.com" });
await browser_wait({ time: 2 });

// Test location search
const searchResult = await browser_execute_macro({
  id: "govdeals_location_search",
  params: {
    zipCode: "01450",
    distance: 50,
    category: "Electronics"
  }
});

console.log("Search result:", searchResult);
// Expected: success: true, resultsFound: true

await browser_wait({ time: 3 });

// Verify page changed
const pageType = await browser_execute_macro({
  id: "govdeals_detect_page_type"
});

console.log("Page type:", pageType.pageType);
// Expected: "search_results"
```

### Test 2: Extract Search Results

```javascript
// (Continue from Test 1)

const results = await browser_execute_macro({
  id: "govdeals_extract_search_results",
  params: { limit: 20 }
});

console.log(`Extracted ${results.totalExtracted} results`);
console.log(`Has more: ${results.hasMore}`);

// Verify result structure
if (results.results.length > 0) {
  const firstItem = results.results[0];
  console.log("\nFirst item:");
  console.log("- ID:", firstItem.id);
  console.log("- Title:", firstItem.title);
  console.log("- Current Bid:", firstItem.currentBid);
  console.log("- Location:", firstItem.location);
  console.log("- URL:", firstItem.itemUrl);
}
```

### Test 3: Extract Listing Details

```javascript
// (Continue from Test 2)

if (results.results.length > 0) {
  // Navigate to first listing
  await browser_navigate({ url: results.results[0].itemUrl });
  await browser_wait({ time: 2 });

  // Extract details
  const details = await browser_execute_macro({
    id: "govdeals_extract_listing_details",
    params: {
      extractSpecs: true,
      extractImages: true,
      extractBidHistory: false
    }
  });

  console.log("\nListing details:");
  console.log("- Title:", details.listing.title);
  console.log("- Description length:", details.listing.description?.length || 0);
  console.log("- Specifications:", Object.keys(details.listing.specifications).length, "fields");
  console.log("- Current Bid:", details.listing.pricing.currentBid);
  console.log("- Time Remaining:", details.listing.timing.timeRemaining);
  console.log("- Images:", details.listing.images.length);
}
```

### Test 4: Pagination

```javascript
// (Continue from Test 2 - on search results page)

const pagination = await browser_execute_macro({
  id: "govdeals_extract_pagination_info"
});

console.log("\nPagination info:");
console.log("- Current Page:", pagination.pagination.currentPage);
console.log("- Total Pages:", pagination.pagination.totalPages);
console.log("- Total Results:", pagination.pagination.totalResults);
console.log("- Has Next:", pagination.pagination.hasNextPage);
console.log("- Next URL:", pagination.pagination.nextPageUrl);

if (pagination.pagination.hasNextPage) {
  await browser_navigate({ url: pagination.pagination.nextPageUrl });
  await browser_wait({ time: 2 });

  const page2Results = await browser_execute_macro({
    id: "govdeals_extract_search_results",
    params: { limit: 20 }
  });

  console.log(`\nPage 2: Extracted ${page2Results.totalExtracted} results`);
}
```

### Test 5: Filters

```javascript
// Start fresh on search page
await browser_navigate({ url: "https://www.govdeals.com" });
await browser_wait({ time: 2 });

// Test category filter
await browser_execute_macro({
  id: "govdeals_apply_category_filter",
  params: { category: "Electronics" }
});
await browser_wait({ time: 2 });

// Test price filter
await browser_execute_macro({
  id: "govdeals_apply_price_filter",
  params: {
    minPrice: 100,
    maxPrice: 1000
  }
});
await browser_wait({ time: 2 });

// Test sort
await browser_execute_macro({
  id: "govdeals_apply_sort",
  params: { sortBy: "ending_soon" }
});
await browser_wait({ time: 2 });

// Extract results
const filteredResults = await browser_execute_macro({
  id: "govdeals_extract_search_results"
});

console.log(`Found ${filteredResults.totalExtracted} filtered results`);
```

---

## Troubleshooting

### Common Issues

#### 1. Search fails to execute

**Symptom**: `govdeals_location_search` returns `success: false`

**Possible causes**:
- Zip code field not found
- Page structure changed
- JavaScript disabled

**Solutions**:
```javascript
// Check if page loaded
const pageType = await browser_execute_macro({
  id: "govdeals_detect_page_type"
});

if (pageType.pageType === "unknown") {
  console.log("Page type not recognized, may need selector updates");
}

// Try manual form filling to identify correct selectors
await browser_query_dom({ selector: "input[type='text']" });
```

#### 2. No results extracted

**Symptom**: `govdeals_extract_search_results` returns empty array

**Possible causes**:
- No matching results for search
- Results not loaded yet
- Selector mismatch

**Solutions**:
```javascript
// Wait longer for results to load
await browser_wait({ time: 5 });

// Check if results container exists
const hasResults = await browser_evaluate({
  code: `() => {
    return document.querySelectorAll('.auction-item, .listing-card').length;
  }`
});

console.log(`Found ${hasResults} result containers on page`);

// If 0, selectors may need updating
```

#### 3. Listing details incomplete

**Symptom**: Missing specifications or images

**Possible causes**:
- Page hasn't fully loaded
- Item has minimal information
- Specification table uses different format

**Solutions**:
```javascript
// Wait for images to load
await browser_wait({ time: 3 });

// Check page structure
const pageInfo = await browser_evaluate({
  code: `() => {
    return {
      hasTables: document.querySelectorAll('table').length,
      hasSpecs: !!document.querySelector('.specifications, .item-specs'),
      hasImages: document.querySelectorAll('img').length
    };
  }`
});

console.log("Page structure:", pageInfo);
```

#### 4. Category autocomplete not working

**Symptom**: `govdeals_apply_category_filter` doesn't select category

**Possible causes**:
- Autocomplete dropdown takes longer to appear
- Category name doesn't match exactly
- Dropdown requires keyboard interaction

**Solutions**:
```javascript
// Increase wait time in macro (edit macro code)
// Or try manual interaction to understand behavior:

await browser_type({
  selector: 'input[name="category"]',
  text: "Electr"
});

await browser_wait({ time: 1 });

// Check what suggestions appeared
const suggestions = await browser_query_dom({
  selector: '.autocomplete-suggestion, [role="option"]'
});

console.log("Suggestions:", suggestions);
```

### Selector Updates

If GovDeals changes their site structure, you may need to update selectors. Here's how:

1. **Identify failing macro**:
   ```javascript
   const result = await browser_execute_macro({ id: "govdeals_extract_search_results" });
   if (!result.success) {
     console.log("Error:", result.error);
   }
   ```

2. **Inspect page structure**:
   ```javascript
   // Take snapshot to examine manually
   const snapshot = await browser_snapshot();
   // Or use query_dom to find elements
   const items = await browser_query_dom({
     selector: "div[class*='auction'], div[class*='listing']"
   });
   ```

3. **Update macro**:
   - Edit `/mnt/nas/data/code/unibrowse/macros/govdeals-macros.js`
   - Find the failing macro
   - Update selector arrays with new patterns
   - Re-store macros: `node macros/storage/store-govdeals-macros.js`

4. **Test updated macro**:
   ```javascript
   const result = await browser_execute_macro({ id: "govdeals_extract_search_results" });
   console.log("Success:", result.success);
   ```

### Performance Issues

#### Slow extraction

**Problem**: Multi-page extraction takes too long

**Solutions**:
- Reduce `limit` parameter in `govdeals_extract_search_results`
- Skip image extraction: `includeImages: false`
- Skip bid history: `extractBidHistory: false`
- Don't extract specs for every listing (only when needed)

**Example**:
```javascript
// Fast extraction (no images, smaller limit)
const results = await browser_execute_macro({
  id: "govdeals_extract_search_results",
  params: {
    limit: 30,
    includeImages: false
  }
});

// Only get details for interesting items
const topItems = results.results.filter(r => r.currentBid < 500);
```

#### High token usage

**Problem**: Conversation uses too many tokens

**Solutions**:
- Use macros instead of snapshots
- Extract only needed fields
- Batch results instead of one-by-one processing
- Store results externally instead of in conversation

**Example**:
```javascript
// BAD: One snapshot per page
for (let page = 1; page <= 10; page++) {
  const snapshot = await browser_snapshot();  // 5K+ tokens each!
}

// GOOD: One macro call per page
for (let page = 1; page <= 10; page++) {
  const results = await browser_execute_macro({
    id: "govdeals_extract_search_results",
    params: { limit: 60, includeImages: false }
  });  // ~1K tokens with structured data
}
```

---

## Appendix: Implementation Notes

### Multi-Layer Selector Strategy

All extraction macros use 3-layer fallback:

1. **Semantic selectors** (most reliable):
   - `[name="zipCode"]`, `#categorySearch`, `.item-title`

2. **Pattern selectors** (flexible):
   - `input[placeholder*="Zip"]`, `[class*="auction"]`

3. **Context-based** (last resort):
   - Find inputs by label text
   - Pattern matching in text content

Example from `govdeals_location_search`:
```javascript
const zipInputSelectors = [
  'input[name="zipCode"]',           // Semantic (best)
  '#zipCode',
  'input[placeholder*="Zip" i]',      // Pattern (good)
  'input[type="text"][maxlength="5"]' // Generic (fallback)
];

let zipInput = null;
for (const selector of zipInputSelectors) {
  zipInput = document.querySelector(selector);
  if (zipInput) break;
}

// Context-based fallback
if (!zipInput) {
  const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
  zipInput = inputs.find(input => {
    const label = input.labels?.[0]?.textContent || '';
    return /zip.*code/i.test(label);
  });
}
```

### Event Dispatch Pattern

Form interactions require proper event dispatch to trigger site JavaScript:

```javascript
// Fill field
input.value = "value";

// Dispatch events in order
input.dispatchEvent(new Event('input', { bubbles: true }));   // Trigger input handlers
input.dispatchEvent(new Event('change', { bubbles: true }));  // Trigger change handlers
input.dispatchEvent(new Event('blur', { bubbles: true }));    // Trigger validation
```

### Pattern-Based Extraction

When selectors aren't reliable, extract from text patterns:

```javascript
const pageText = document.body.textContent;

// Extract price
const pricePattern = /\$?([\d,]+\.?\d*)/;
const priceMatch = pageText.match(pricePattern);
if (priceMatch) {
  const price = parseFloat(priceMatch[1].replace(/,/g, ''));
}

// Extract time remaining
const timePattern = /(\d+)\s+(day|hour|minute)s?\s+(\d+)?\s*(hour|minute)?/i;
const timeMatch = pageText.match(timePattern);
```

### Metadata vs Navigation

Navigation macros (like `govdeals_navigate_page`) return URLs but don't navigate:

```javascript
// Macro returns URL
const pageInfo = await browser_execute_macro({
  id: "govdeals_navigate_page",
  params: { page: 3 }
});

// Caller performs navigation
if (pageInfo.success) {
  await browser_navigate({ url: pageInfo.pageUrl });
}
```

This pattern:
- Allows caller to control navigation timing
- Enables pre-flight validation
- Separates concerns (metadata vs action)

---

## Version History

- **v1.0** (2026-02-03): Initial release
  - 13 macros (3 navigation, 6 extraction, 3 interaction, 1 utility)
  - Location-based search with zip code + radius
  - Electronics category filtering
  - Multi-page extraction support
  - Detailed item specification extraction
  - Price and sort filtering
  - Type-ahead autocomplete handling

---

## Support

For issues, updates, or contributions:
- **File**: `/mnt/nas/data/code/unibrowse/macros/govdeals-macros.js`
- **Storage**: `node /mnt/nas/data/code/unibrowse/macros/storage/store-govdeals-macros.js`
- **Database**: MongoDB collection `macros` (site: "govdeals.com")

To list all GovDeals macros:
```javascript
const macros = await browser_list_macros({
  site: "govdeals.com"
});

console.log(`${macros.count} macros available`);
```
