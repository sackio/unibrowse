# eBay Macros Reference

Comprehensive macro collection for eBay.com automation and data extraction.

## Overview

**Total Macros**: 22 (18 existing + 4 sniper macros)
**Site**: ebay.com
**Version**: 1.1.0
**Last Updated**: 2026-02-03

These macros enable:
- Exhaustive product search across multiple pages
- Product details extraction (specs, pricing, conditions)
- Seller reputation and feedback analysis
- Shipping cost calculation and total price comparison
- Auction vs Buy It Now detection
- Condition filtering and comparison shopping
- Item reviews when available
- **NEW**: Safe auction bidding workflow (sniper macros)

## Macro Categories

- **Search (1)**: Product search with listing type filters
- **Navigation (4)**: Page navigation, seller profiles, product tabs
- **Extraction (10)**: Products, details, seller info, shipping, filters, images, reviews
- **Interaction (2)**: Apply filters and sort options
- **Workflow (1)**: Multi-page exhaustive extraction
- **Auction Bidding (4)**: Safe bidding workflow for auction sniping (see [EBAY_SNIPER_MACROS.md](./EBAY_SNIPER_MACROS.md))

## Macros by Category

### Search Macros

#### 1. ebay_search_products
**Category**: search
**Reliability**: untested

Search for products with query and optional listing type filter.

**Parameters:**
- `query` (string, required): Search query
- `searchType` (string, optional): Listing type filter - "all", "auction", "buyItNow" (default: "all")

**Example:**
```javascript
{ query: "iPhone 15", searchType: "buyItNow" }
```

---

### Navigation Macros

#### 2. ebay_click_product
**Category**: navigation
**Reliability**: untested

Click a product by position or title match in search results.

**Parameters:**
- `position` (number, optional): Position in results (0-indexed)
- `titleMatch` (string, optional): Partial title to match

**Example:**
```javascript
{ position: 0 }  // Click first product
{ titleMatch: "iPhone 15 Pro" }  // Click by title
```

#### 3. ebay_navigate_pages
**Category**: navigation
**Reliability**: untested

Navigate through search result pages.

**Parameters:**
- `direction` (string, required): "next", "previous", or "goto"
- `pageNumber` (number, optional): Page number for "goto" direction

**Example:**
```javascript
{ direction: "next" }
{ direction: "goto", pageNumber: 3 }
```

#### 4. ebay_view_seller_profile
**Category**: navigation
**Reliability**: untested

Navigate to seller profile page from product page.

**Parameters:** None

#### 5. ebay_switch_item_tabs
**Category**: navigation
**Reliability**: untested

Switch between product detail tabs (description, shipping, returns).

**Parameters:**
- `tab` (string, required): "description", "shipping", or "returns"

**Example:**
```javascript
{ tab: "shipping" }
```

---

### Extraction Macros

#### 6. ebay_extract_search_results
**Category**: extraction
**Reliability**: medium

Extract product listings from search results page.

**Parameters:**
- `limit` (number, optional): Max products to extract (default: 60)
- `includeSponsored` (boolean, optional): Include sponsored listings (default: false)
- `calculateTotalPrice` (boolean, optional): Add shipping to price (default: true)

**Returns:**
```javascript
{
  success: true,
  products: [
    {
      itemId: "157570632552",
      title: "Apple iPhone 15 - 128 GB - Black (T-Mobile)",
      price: 124.60,
      shippingCost: 6.52,
      totalPrice: 131.12,
      freeShipping: false,
      condition: "New",
      listingType: "auction",  // or "buyItNow", "both", "unknown"
      timeLeft: "6d 3h",
      bidCount: 602,
      seller: null,
      url: "https://www.ebay.com/itm/157570632552...",
      sponsored: null
    }
  ],
  totalExtracted: 3,
  hasMore: true
}
```

#### 7. ebay_extract_product_details
**Category**: extraction
**Reliability**: high

Extract comprehensive product details from product page.

**Parameters:** None

**Returns:**
```javascript
{
  success: true,
  product: {
    itemId: "157570632552",
    title: "Apple iPhone 15 - 128 GB - Black (T-Mobile)",
    price: 124.60,
    buyItNowPrice: null,
    currentBid: 124.60,
    bidCount: 602,
    timeLeft: "6d 3h",
    listingType: "auction",  // "buyItNow", "both", "unknown"
    isBuyItNow: false,
    isAuction: true,
    condition: "New",
    conditionDescription: "Brand new in sealed box",
    itemLocation: "Franklin Park, New Jersey, United States"
  }
}
```

#### 8. ebay_extract_seller_info
**Category**: extraction
**Reliability**: medium

Extract seller feedback score, ratings, and policies.

**Parameters:** None

**Returns:**
```javascript
{
  success: true,
  seller: {
    username: "tech_seller_99",
    feedbackScore: 45678,
    positivePercentage: 99.8,
    isTopRated: true,
    hasStore: true,
    memberSince: "2015",
    location: "United States",
    policies: {
      returns: "30 days money back",
      shipping: "Same day dispatch"
    }
  }
}
```

#### 9. ebay_extract_shipping_details
**Category**: extraction
**Reliability**: medium

Extract shipping costs, services, delivery estimates.

**Parameters:** None

**Returns:**
```javascript
{
  success: true,
  shipping: {
    cost: 6.52,
    isFree: false,
    service: "USPS Ground Advantage",
    estimatedDelivery: "Dec 30 - Jan 3",
    shipsFrom: "Franklin Park, NJ",
    shipsTo: "United States",
    internationalShipping: false,
    handlingTime: "1 business day"
  }
}
```

#### 10. ebay_detect_best_offer
**Category**: extraction
**Reliability**: medium

Detect if Best Offer is available and thresholds.

**Parameters:** None

**Returns:**
```javascript
{
  success: true,
  bestOffer: {
    available: true,
    autoAcceptPrice: 450.00,  // If visible
    minimumOfferPrice: 400.00,  // If visible
    hasButton: true
  }
}
```

#### 11. ebay_extract_available_filters
**Category**: extraction
**Reliability**: medium

Extract all available filter options from search results.

**Parameters:** None

**Returns:**
```javascript
{
  success: true,
  filters: {
    condition: {
      title: "Condition",
      options: [
        { value: "on", label: "New", count: 17629, checked: false },
        { value: "on", label: "Open box", count: 4098, checked: false },
        { value: "on", label: "Excellent - Refurbished", count: 988, checked: false },
        { value: "on", label: "Used", count: 51153, checked: false }
      ]
    },
    shipping: {
      title: "Shipping and pickup",
      options: [
        { value: "on", label: "Arrives in 2-4 days", count: null, checked: false },
        { value: "on", label: "Free Shipping", count: null, checked: false }
      ]
    },
    network: {...},
    storagecapacity: {...},
    // ... more filter categories
  },
  hasSortOptions: true,
  totalFilterCategories: 13
}
```

#### 12. ebay_extract_item_specifics
**Category**: extraction
**Reliability**: medium

Extract product specification table (Item Specifics).

**Parameters:** None

**Returns:**
```javascript
{
  success: true,
  specifics: {
    brand: { label: "Brand", value: "Apple" },
    model: { label: "Model", value: "iPhone 15" },
    storage_capacity: { label: "Storage Capacity", value: "128 GB" },
    network: { label: "Network", value: "Unlocked" },
    // ... more specifications
  },
  totalItems: 12
}
```

#### 13. ebay_extract_product_images
**Category**: extraction
**Reliability**: medium

Extract all product images including high-res versions.

**Parameters:**
- `includeZoom` (boolean, optional): Include high-res zoom images (default: true)

**Returns:**
```javascript
{
  success: true,
  images: {
    main: "https://i.ebayimg.com/images/g/.../s-l500.webp",
    thumbnails: [
      "https://i.ebayimg.com/images/g/.../s-l64.webp",
      // ... more thumbnails
    ],
    highRes: [
      "https://i.ebayimg.com/images/g/.../s-l1600.webp",
      // ... more high-res images
    ]
  },
  totalImages: 5,
  hasHighRes: true
}
```

#### 14. ebay_extract_pagination_info
**Category**: extraction
**Reliability**: medium

Extract pagination info (current page, total pages, results count).

**Parameters:** None

**Returns:**
```javascript
{
  success: true,
  pagination: {
    currentPage: 1,
    totalPages: 127,
    totalResults: 76234,
    resultsPerPage: 60,
    hasNext: true,
    hasPrev: false
  }
}
```

#### 15. ebay_extract_item_reviews
**Category**: extraction
**Reliability**: low

Extract item reviews when available (eBay item reviews are uncommon).

**Parameters:**
- `limit` (number, optional): Max reviews to extract (default: 10)

**Returns:**
```javascript
{
  success: true,
  reviews: [
    {
      rating: 5.0,
      text: "Great product, exactly as described",
      author: "buyer123",
      verified: true,
      date: "Dec 15, 2024"
    }
  ],
  totalReviews: 5,
  overallRating: 4.8,
  hasMore: false
}
```

---

### Interaction Macros

#### 16. ebay_apply_filters
**Category**: interaction
**Reliability**: medium

Apply filters to search results.

**Parameters:**
- `condition` (string, optional): "New", "Used", "Open box", "Refurbished"
- `priceMin` (number, optional): Minimum price
- `priceMax` (number, optional): Maximum price
- `buyingFormat` (string, optional): "Auction", "Buy It Now"
- `location` (string, optional): Location filter
- `freeShipping` (boolean, optional): Free shipping only

**Example:**
```javascript
{
  condition: "New",
  priceMin: 100,
  priceMax: 500,
  freeShipping: true
}
```

**Returns:**
```javascript
{
  success: true,
  applied: [
    { filter: "condition", value: "New" },
    { filter: "priceMin", value: 100 },
    { filter: "priceMax", value: 500 },
    { filter: "freeShipping", value: true }
  ],
  totalApplied: 4,
  errors: []
}
```

#### 17. ebay_apply_sort
**Category**: interaction
**Reliability**: medium

Apply sort order to search results.

**Parameters:**
- `sortBy` (string, required): "bestMatch", "price", "priceDesc", "timeEnding", "newlyListed"

**Example:**
```javascript
{ sortBy: "price" }  // Sort by price + shipping: lowest first
```

**Returns:**
```javascript
{
  success: true,
  sortBy: "price",
  sortText: "price + shipping: lowest first",
  message: "Sort option clicked, page will reload"
}
```

---

### Workflow Macros

#### 18. ebay_multi_page_extraction
**Category**: workflow
**Reliability**: medium

Extract products from current search results page and return pagination info. Call multiple times with manual navigation to extract across multiple pages.

**IMPORTANT**: This macro extracts from the current page only. To extract from multiple pages, you must manually navigate to each page and call this macro again.

**Parameters:**
- `includeSponsored` (boolean, optional): Include sponsored listings (default: false)

**Example:**
```javascript
{
  includeSponsored: false
}
```

**Returns:**
```javascript
{
  success: true,
  products: [/* Array of products from current page */],
  currentPage: 1,
  productsOnPage: 60,
  hasNextPage: true,
  nextPageUrl: "https://www.ebay.com/sch/i.html?_nkw=iPhone+13&_pgn=2",
  totalResults: 7634
}
```

**Multi-Page Workflow Example:**
```javascript
// Page 1: Call macro
const page1 = await ebay_multi_page_extraction({ includeSponsored: false });
// Result: { products: [...60 items...], hasNextPage: true, nextPageUrl: "...&_pgn=2" }

// Page 2: Navigate to next page
await browser_navigate({ url: page1.nextPageUrl });
await browser_wait({ time: 2 });

// Page 2: Call macro again
const page2 = await ebay_multi_page_extraction({ includeSponsored: false });
// Result: { products: [...60 items...], hasNextPage: true, nextPageUrl: "...&_pgn=3" }

// Combine results
const allProducts = [...page1.products, ...page2.products];
```

---

## Common Workflows

### Workflow 1: Basic Search and Extract

```javascript
// 1. Search for products
ebay_search_products({ query: "iPhone 15", searchType: "buyItNow" })

// 2. Extract first page results
ebay_extract_search_results({ limit: 10, calculateTotalPrice: true })

// 3. Click first product
ebay_click_product({ position: 0 })

// 4. Extract product details
ebay_extract_product_details()

// 5. Get seller info
ebay_extract_seller_info()

// 6. Get shipping details
ebay_extract_shipping_details()
```

### Workflow 2: Price Comparison with Filters

```javascript
// 1. Search
ebay_search_products({ query: "vintage camera" })

// 2. Apply filters
ebay_apply_filters({
  condition: "Used",
  priceMin: 50,
  priceMax: 200,
  freeShipping: true
})

// 3. Sort by price
ebay_apply_sort({ sortBy: "price" })

// 4. Extract results
ebay_extract_search_results({ limit: 20, calculateTotalPrice: true })

// 5. Get pagination info
ebay_extract_pagination_info()
```

### Workflow 3: Multi-Page Exhaustive Extraction

```javascript
// 1. Search
ebay_search_products({ query: "collectible coins" })

// 2. Apply desired filters
ebay_apply_filters({ condition: "New" })

// 3. Extract from current page
const page1 = ebay_multi_page_extraction({ includeSponsored: false })
const allProducts = [...page1.products]

// 4. Navigate and extract from subsequent pages
let currentPage = page1
for (let i = 1; i < 10 && currentPage.hasNextPage; i++) {
  // Navigate to next page
  browser_navigate({ url: currentPage.nextPageUrl })
  browser_wait({ time: 2 })

  // Extract from new page
  currentPage = ebay_multi_page_extraction({ includeSponsored: false })
  allProducts.push(...currentPage.products)
}

// 5. Deduplicate by itemId
const uniqueProducts = Array.from(
  new Map(allProducts.map(p => [p.itemId, p])).values()
)
```

### Workflow 4: Deep Product Analysis

```javascript
// On a product page:

// 1. Get basic details
ebay_extract_product_details()

// 2. Get item specifics
ebay_extract_item_specifics()

// 3. Get all images
ebay_extract_product_images({ includeZoom: true })

// 4. Get seller info
ebay_extract_seller_info()

// 5. Get shipping details
ebay_extract_shipping_details()

// 6. Check for Best Offer
ebay_detect_best_offer()

// 7. Get reviews (if available)
ebay_extract_item_reviews({ limit: 10 })
```

### Workflow 5: Auction Monitoring

```javascript
// 1. Search for auctions
ebay_search_products({ query: "rare vinyl record", searchType: "auction" })

// 2. Sort by ending soonest
ebay_apply_sort({ sortBy: "timeEnding" })

// 3. Extract results
ebay_extract_search_results({ limit: 50 })

// Filter results in your code by:
// - timeLeft (e.g., "2h 15m")
// - bidCount
// - currentBid vs your target price
```

## eBay-Specific Patterns

### Auction vs Buy It Now Detection

eBay listings can be:
- **Auction only**: `listingType: "auction"`, has bidCount and timeLeft
- **Buy It Now only**: `listingType: "buyItNow"`, fixed price
- **Both**: `listingType: "both"`, auction with Buy It Now option
- **Unknown**: `listingType: "unknown"`, couldn't determine

```javascript
const details = await ebay_extract_product_details();

if (details.product.isAuction) {
  console.log(`Current bid: $${details.product.currentBid}`);
  console.log(`Bids: ${details.product.bidCount}`);
  console.log(`Time left: ${details.product.timeLeft}`);
}

if (details.product.isBuyItNow) {
  console.log(`Buy It Now: $${details.product.buyItNowPrice}`);
}
```

### Condition Classification

eBay conditions are detailed and vary by category:

**Common conditions:**
- **New**: Brand new, unused
- **Open box**: New but packaging opened
- **Excellent - Refurbished**: Professionally refurbished, like new
- **Very Good - Refurbished**: Refurbished, minor wear
- **Good - Refurbished**: Refurbished, moderate wear
- **Used**: Previously used, various wear levels
- **For parts or not working**: Non-functional or incomplete

```javascript
// Apply condition filter
await ebay_apply_filters({ condition: "New" });

// Or compare conditions in extracted results
const results = await ebay_extract_search_results({ limit: 50 });
const newItems = results.products.filter(p =>
  p.condition?.toLowerCase().includes('new')
);
```

### Total Price Calculation

eBay pricing varies significantly with shipping:

```javascript
const results = await ebay_extract_search_results({
  limit: 20,
  calculateTotalPrice: true  // Adds price + shipping
});

// Sort by total price in your code
const sortedByTotal = results.products.sort((a, b) =>
  a.totalPrice - b.totalPrice
);

// Filter free shipping
const freeShip = results.products.filter(p => p.freeShipping);
```

### Seller Reputation

Seller feedback is critical on eBay:

```javascript
const sellerInfo = await ebay_extract_seller_info();

if (sellerInfo.seller.isTopRated &&
    sellerInfo.seller.positivePercentage > 99.0) {
  console.log('Highly trusted seller');
}

console.log(`Feedback: ${sellerInfo.seller.feedbackScore}`);
console.log(`Positive: ${sellerInfo.seller.positivePercentage}%`);
```

### Best Offer Negotiation

Check if seller accepts Best Offer:

```javascript
const bestOffer = await ebay_detect_best_offer();

if (bestOffer.bestOffer.available) {
  if (bestOffer.bestOffer.autoAcceptPrice) {
    console.log(`Auto-accept at: $${bestOffer.bestOffer.autoAcceptPrice}`);
  }
  if (bestOffer.bestOffer.minimumOfferPrice) {
    console.log(`Minimum offer: $${bestOffer.bestOffer.minimumOfferPrice}`);
  }
}
```

## Tips and Best Practices

### 1. Always Calculate Total Price

eBay shipping costs vary widely. Use `calculateTotalPrice: true` to compare actual costs:

```javascript
ebay_extract_search_results({ calculateTotalPrice: true })
```

### 2. Exclude Sponsored Listings for Accurate Results

Sponsored listings may not be relevant:

```javascript
ebay_extract_search_results({ includeSponsored: false })
```

### 3. Use Pagination for Large Searches

For comprehensive price research, use multi-page extraction with manual navigation:

```javascript
// Extract page 1
const page1 = ebay_multi_page_extraction({ includeSponsored: false })
let allProducts = [...page1.products]

// Navigate and extract subsequent pages
let currentPage = page1
for (let i = 1; i < 10 && currentPage.hasNextPage; i++) {
  browser_navigate({ url: currentPage.nextPageUrl })
  browser_wait({ time: 2 })
  currentPage = ebay_multi_page_extraction({ includeSponsored: false })
  allProducts.push(...currentPage.products)
}
```

### 4. Filter by Condition for Consistency

When comparing prices, filter by condition:

```javascript
ebay_apply_filters({ condition: "New" })
```

### 5. Sort Before Extracting

Apply sort before extraction for best results:

```javascript
ebay_apply_sort({ sortBy: "price" })  // Then extract
```

### 6. Check Seller Reputation

Always verify seller feedback for expensive items:

```javascript
const seller = await ebay_extract_seller_info();
if (seller.seller.positivePercentage < 95.0) {
  console.warn('Low seller rating');
}
```

### 7. Delay Between Pages

Use reasonable delays when manually navigating between pages:

```javascript
// After navigating to next page
browser_navigate({ url: nextPageUrl })
browser_wait({ time: 2 })  // 2 second delay

// Then extract
ebay_multi_page_extraction({ includeSponsored: false })
```

## Error Handling

All macros return `success: true/false` and include error messages:

```javascript
const result = await ebay_extract_product_details();

if (!result.success) {
  console.error('Error:', result.error);
  // Common errors:
  // - "Not on a product page"
  // - "Not on a search results page"
  // - "Element not found"
}
```

## Reliability Ratings

- **High**: 95%+ success rate on standard use cases
- **Medium**: 80-95% success rate, may need selector adjustments
- **Low**: <80% success rate, feature rarely available (e.g., item reviews)
- **Untested**: Not yet tested in production

## Version History

### v1.1.0 (2026-02-03)
- **NEW**: Added 4 auction sniper macros for safe bidding workflow
- `ebay_sniper_analyze_page` - Multi-page detection and state extraction
- `ebay_sniper_initiate_bid` - Navigate to bid entry page
- `ebay_sniper_fill_bid` - Fill bid amount without submission
- `ebay_sniper_review_bid` - Extract confirmation page data (read-only)
- All sniper macros include safety features (no auto-submission)
- Ideal for testing on ended auctions
- Full documentation in EBAY_SNIPER_MACROS.md

### v1.0.4 (2025-12-29)
- Fixed `ebay_multi_page_extraction` to work within browser_evaluate constraints
- Changed from automatic multi-page navigation to single-page extraction with pagination metadata
- Updated to return `currentPage`, `hasNextPage`, `nextPageUrl`, and `totalResults`
- Requires manual navigation between pages for multi-page workflows

### v1.0.3 (2025-12-29)
- Fixed `ebay_extract_seller_info` regex escaping
- Fixed `ebay_extract_shipping_details` service extraction
- Fixed `ebay_extract_item_specifics` to iterate all label-value sections
- Fixed `ebay_view_seller_profile` selectors and store URL support
- Fixed `ebay_switch_item_tabs` with flexible pattern matching

### v1.0.0 (2025-12-29)
- Initial release with 18 macros
- Full search, extraction, and filtering support
- Multi-page extraction workflow
- Auction and Buy It Now support

---

## Auction Bidding Workflow

**NEW**: eBay auction sniper macros for safe testing of bidding workflows.

### Overview

4 specialized macros enable practicing auction bidding **without accidentally submitting final bids**:

1. **`ebay_sniper_analyze_page`** - Detect current page in bid workflow (product/bid entry/confirmation)
2. **`ebay_sniper_initiate_bid`** - Click "Place Bid" button to navigate to bid entry
3. **`ebay_sniper_fill_bid`** - Fill bid amount field (DOES NOT SUBMIT)
4. **`ebay_sniper_review_bid`** - Extract confirmation page data (READ-ONLY)

### Safety Features

⚠️ **These macros are designed for SAFE TESTING**:
- Fill forms and navigate pages
- **DO NOT** submit final bids automatically
- User must manually click "Confirm Bid" (for practice only)
- Ideal for testing on ended auctions

### Quick Example

```javascript
// 1. Verify you're on product page
const check = await browser_execute_macro({
  id: "ebay_sniper_analyze_page"
});

// 2. Click Place Bid button
await browser_execute_macro({
  id: "ebay_sniper_initiate_bid",
  params: { verifyAuction: true }
});

// 3. Wait for navigation
await browser_wait({ time: 2 });

// 4. Fill bid amount (but don't submit)
const fill = await browser_execute_macro({
  id: "ebay_sniper_fill_bid",
  params: { bidAmount: 142.00, verifyMinimum: true }
});

console.log('⚠️', fill.warning); // "BID NOT SUBMITTED"
// Form is filled, user can review before manual submission
```

### Complete Documentation

See **[EBAY_SNIPER_MACROS.md](./EBAY_SNIPER_MACROS.md)** for:
- Complete API reference
- Full workflow examples
- Testing guide (ended auctions → active → production)
- Error handling
- Safety checklist
- Integration with search/extraction macros

### Use Cases

- Practice auction sniping timing
- Learn eBay's bid workflow
- Test bid strategies safely
- Prepare for real auctions
- Automate research, manual submission

---

## Related Documentation

- [eBay Sniper Macros](./EBAY_SNIPER_MACROS.md) - **Auction bidding workflow**
- [Amazon Macros](./AMAZON_MACROS.md)
- [Google Shopping Macros](./GOOGLE_SHOPPING_MACROS.md)
- [E-commerce Skill Module](../.claude/skills/browser/ECOMMERCE.md)

## Support

For issues or feature requests, see the main unibrowse repository.
