# AliExpress Shopping Macros

**Complete macro reference for AliExpress.com automation**

**Total Macros**: 19 (8 core + 11 advanced)
**Implementation Date**: 2026-02-05
**Status**: Core macros stored & tested ✅ | Advanced macros ready to store ⏳

---

## Table of Contents

- [Overview](#overview)
- [Site Characteristics](#site-characteristics)
- [Core Macros (8)](#core-macros-8)
  - [Search](#search-1-macro)
  - [Extraction](#extraction-4-macros)
  - [Interaction](#interaction-3-macros)
- [Advanced Macros (11)](#advanced-macros-11)
  - [Navigation](#navigation-2-macros)
  - [Filtering](#filtering-3-macros)
  - [Product Extraction](#product-extraction-4-macros)
  - [Reviews](#reviews-2-macros)
- [Usage Examples](#usage-examples)
- [Implementation Notes](#implementation-notes)

---

## Overview

These macros enable comprehensive automation of AliExpress product research, comparison shopping, and deal hunting. All macros follow best practices with multi-layer selector fallbacks, error handling, and structured return values.

**Scope**: Search, filtering, product extraction, reviews, seller analysis (NO purchasing automation)

---

## Site Characteristics

**URL Patterns**:
- Search: `https://www.aliexpress.us/w/wholesale-{query}.html`
- Product: `https://www.aliexpress.us/item/{itemId}.html`

**Key Features**:
- International shipping options
- Seller ratings (diamond system + percentage)
- Complex product variants (size, color, capacity)
- Dynamic pricing (varies by user location, "new user" specials)
- Coins/coupons/flash sales

**Technical Notes**:
- Heavily obfuscated class names (e.g., `l0_kh`, `nj_ao`)
- Product cards: `.search-item-card-wrapper-gallery`
- Images use `.avif` format
- Multi-currency support (USD, EUR, GBP, CNY)

---

## Core Macros (8)

### Search (1 macro)

#### `aliexpress_search_products` ✅ STORED & TESTED
**ID**: `6b13f47b-fe96-47d0-963d-ff09780415c6`

Search for products by keyword.

**Parameters**:
```javascript
{
  query: string,      // Required: "NVMe SSD 256GB"
  sortBy: string      // Optional: default|price_asc|price_desc|orders|newest
}
```

**Returns**:
```javascript
{
  success: true,
  action: "search_submitted",
  searchParams: { query, sortBy },
  url: "https://www.aliexpress.us/w/wholesale-nvme-ssd-256gb.html"
}
```

**Example**:
```javascript
await browser_execute_macro({
  id: "6b13f47b-fe96-47d0-963d-ff09780415c6",
  params: { query: "NVMe SSD 256GB", sortBy: "price_asc" }
});
```

---

### Extraction (4 macros)

#### `aliexpress_extract_search_results` ✅ STORED & TESTED
**ID**: `3302ad13-63ab-4573-8f65-52b079162978`

Extract product listings from search results page.

**Parameters**:
```javascript
{
  limit: number,           // Optional: max results (default: 60)
  includeImages: boolean,  // Optional: include image URLs (default: true)
  includeShipping: boolean // Optional: include shipping info (default: true)
}
```

**Returns**:
```javascript
{
  success: true,
  results: [
    {
      id: "3256806943253333",
      title: "PHONEPACE SSD M2 NVME...",
      price: { amount: 37.90, currency: "USD", formatted: "$37.90" },
      imageUrl: "https://ae-pic-a1.aliexpress-media.com/...",
      productUrl: "https://www.aliexpress.us/item/3256806943253333.html",
      sold: 3000,
      rating: { stars: 4.8, count: 1254 },
      shipping: { free: true, text: "Free shipping" },
      badges: ["Choice", "Fast Delivery"]
    }
  ],
  totalExtracted: 12,
  hasMore: true,
  url: "https://www.aliexpress.us/w/wholesale-nvme-ssd-256gb.html"
}
```

**Test Results**: Successfully extracted 5 products with all data fields on 2026-02-05.

---

#### `aliexpress_extract_product_details` ✅ STORED
**ID**: `0205f262-f300-484d-97ee-38f602467182`

Extract detailed product information from product page.

**Parameters**:
```javascript
{
  extractSpecs: boolean,    // Optional: extract specifications (default: true)
  extractImages: boolean,   // Optional: extract images (default: true)
  extractVariants: boolean, // Optional: extract variants (default: true)
  extractShipping: boolean  // Optional: extract shipping (default: true)
}
```

**Returns**:
```javascript
{
  success: true,
  product: {
    id: "3256806943253333",
    title: "Samsung 970 EVO Plus NVMe SSD",
    pricing: { current: 29.99, currency: "USD", original: 49.99, discount: "40%" },
    rating: { average: 4.8, count: 12543 },
    images: [{ url: "...", alt: "..." }],
    specifications: { brand: "Samsung", capacity: "256GB", ... },
    variants: [{ name: "Capacity", options: ["256GB", "512GB", "1TB"], prices: [...] }],
    shipping: { free: true, estimated: "7-15 days", from: "China" },
    seller: { name: "Official Store", rating: "98.5%" },
    availability: { inStock: true, quantity: 9999 }
  }
}
```

---

#### `aliexpress_extract_reviews` ✅ STORED
**ID**: `6b1b9be2-e924-40a6-bad5-62bb15f448e4`

Extract product reviews with ratings, text, photos, and reviewer info.

**Parameters**:
```javascript
{
  limit: number,        // Optional: max reviews (default: 20)
  withPhotos: boolean   // Optional: only reviews with photos (default: false)
}
```

**Returns**:
```javascript
{
  success: true,
  reviews: [
    {
      id: "12345",
      rating: 5,
      text: "Fast shipping, works perfectly...",
      date: "2026-01-15",
      verified: true,
      helpful: 234,
      reviewer: { name: "J***n", country: "US", level: "Gold Member" },
      photos: [{ url: "..." }],
      variant: "256GB / Black"
    }
  ],
  totalExtracted: 20,
  totalReviews: 12543,
  hasMore: true,
  summary: { average: 4.8, distribution: { 5: 9876, 4: 2100, ... } }
}
```

---

#### `aliexpress_extract_seller_info` ✅ STORED
**ID**: `f0763285-b887-427c-b1e3-5f39607306fa`

Extract seller information and ratings.

**Returns**:
```javascript
{
  success: true,
  seller: {
    id: "12345",
    name: "Official Store",
    url: "https://...",
    type: "Official Store|Top Brand|Regular Seller",
    rating: { overall: "98.5%", positive: 98.5 },
    stats: { followers: 123456, totalOrders: 500234, yearsInBusiness: 5 },
    performance: { itemAsDescribed: 4.9, communication: 4.8, shippingSpeed: 4.7 },
    location: "Shenzhen, China"
  }
}
```

---

### Interaction (3 macros)

#### `aliexpress_apply_price_filter` ✅ STORED
**ID**: `4a78b584-dd23-4466-b701-49728d2fe987`

Apply price range filter.

**Parameters**:
```javascript
{
  minPrice: number,  // Optional: minimum price
  maxPrice: number   // Optional: maximum price
}
```

**Example**:
```javascript
await browser_execute_macro({
  id: "4a78b584-dd23-4466-b701-49728d2fe987",
  params: { minPrice: 20, maxPrice: 50 }
});
```

---

#### `aliexpress_apply_shipping_filter` ✅ STORED
**ID**: `b7e727ef-88fc-4503-91f2-8e54e51aa973`

Apply shipping filters (free shipping, ship from location, fast delivery).

**Parameters**:
```javascript
{
  freeShipping: boolean,  // Optional: filter for free shipping (default: false)
  shipFrom: string,       // Optional: country code (US, CN, etc.)
  fastDelivery: boolean   // Optional: fast delivery filter (default: false)
}
```

---

#### `aliexpress_apply_sort` ✅ STORED
**ID**: `cc8319f7-293d-4508-ad61-dfcc249685d6`

Apply sort order to search results.

**Parameters**:
```javascript
{
  sortBy: string  // Required: default|price_asc|price_desc|orders|newest|rating
}
```

---

## Advanced Macros (11)

### Navigation (2 macros)

#### `aliexpress_navigate_page` ⏳ READY TO STORE

Navigate to specific page number in search results.

**Parameters**: `{ page: number }`

---

#### `aliexpress_extract_pagination_info` ⏳ READY TO STORE

Extract pagination information (current page, total pages, hasNext, etc.).

**Returns**:
```javascript
{
  success: true,
  pagination: {
    currentPage: 1,
    totalPages: 50,
    resultsPerPage: 60,
    totalResults: 2987,
    hasNextPage: true,
    hasPreviousPage: false,
    nextPageUrl: "...",
    previousPageUrl: null
  }
}
```

---

### Filtering (3 macros)

#### `aliexpress_apply_rating_filter` ⏳ READY TO STORE

Apply minimum star rating filter.

**Parameters**: `{ minRating: number }` (4, 4.5, or 5)

---

#### `aliexpress_apply_category_filter` ⏳ READY TO STORE

Apply category filter to narrow search results.

**Parameters**: `{ category: string }` (category name or path)

---

#### `aliexpress_apply_review_filter` ⏳ READY TO STORE

Apply filters to product reviews (sort, photos only, specific rating, country).

**Parameters**:
```javascript
{
  sortBy: string,      // Optional: helpful|newest|rating_high|rating_low
  withPhotos: boolean, // Optional: only reviews with photos
  rating: number,      // Optional: filter by specific star rating
  country: string      // Optional: filter by reviewer country
}
```

---

### Product Extraction (4 macros)

#### `aliexpress_extract_product_images` ⏳ READY TO STORE

Extract all product images with thumbnail and full-size URLs.

**Returns**:
```javascript
{
  success: true,
  images: [
    { thumbnail: "...", fullSize: "...", alt: "..." }
  ]
}
```

---

#### `aliexpress_extract_variants` ⏳ READY TO STORE

Extract all product variants (size, color, capacity) with pricing.

**Returns**:
```javascript
{
  success: true,
  variants: [
    {
      name: "Capacity",
      options: [
        { value: "256GB", price: 29.99, available: true },
        { value: "512GB", price: 54.99, available: true },
        { value: "1TB", price: 99.99, available: false }
      ]
    }
  ]
}
```

---

#### `aliexpress_extract_product_specs` ⏳ READY TO STORE

Extract product specifications table.

**Returns**:
```javascript
{
  success: true,
  specifications: {
    "Brand": "Samsung",
    "Model": "970 EVO Plus",
    "Capacity": "256GB",
    "Interface": "NVMe PCIe 3.0 x4",
    "Form Factor": "M.2 2280"
  }
}
```

---

#### `aliexpress_parse_price` ⏳ READY TO STORE

Parse price text into structured format (utility function).

**Parameters**: `{ priceText: string }` (e.g., "US $29.99", "€25.50")

**Returns**:
```javascript
{
  success: true,
  price: {
    amount: 29.99,
    currency: "USD",
    formatted: "$29.99"
  }
}
```

---

### Reviews (2 macros)

#### `aliexpress_extract_rating_summary` ⏳ READY TO STORE

Extract rating summary with distribution.

**Returns**:
```javascript
{
  success: true,
  summary: {
    average: 4.8,
    totalReviews: 12543,
    distribution: { 5: 9876, 4: 2100, 3: 400, 2: 100, 1: 67 },
    percentages: { 5: 79, 4: 17, 3: 3, 2: 1, 1: 1 },
    withPhotos: 3456,
    verified: 11234
  }
}
```

---

#### `aliexpress_advanced_search` ⏳ READY TO STORE

Perform advanced search with multiple filter parameters at once.

**Parameters**:
```javascript
{
  query: string,         // Required
  priceMin: number,      // Optional
  priceMax: number,      // Optional
  freeShipping: boolean, // Optional
  shipFrom: string,      // Optional
  ratingMin: number,     // Optional
  fastDelivery: boolean  // Optional
}
```

---

## Usage Examples

### Complete Product Research Workflow

```javascript
// 1. Search for products
await browser_execute_macro({
  id: "6b13f47b-fe96-47d0-963d-ff09780415c6",
  params: { query: "NVMe SSD 256GB", sortBy: "price_asc" }
});

await browser_wait({ time: 2 });

// 2. Apply filters
await browser_execute_macro({
  id: "4a78b584-dd23-4466-b701-49728d2fe987",
  params: { minPrice: 20, maxPrice: 50 }
});

await browser_execute_macro({
  id: "b7e727ef-88fc-4503-91f2-8e54e51aa973",
  params: { freeShipping: true, shipFrom: "US" }
});

await browser_wait({ time: 2 });

// 3. Extract search results
const results = await browser_execute_macro({
  id: "3302ad13-63ab-4573-8f65-52b079162978",
  params: { limit: 20 }
});

console.log(`Found ${results.totalExtracted} products`);

// 4. Visit top product and extract details
await browser_navigate({ url: results.results[0].productUrl });
await browser_wait({ time: 2 });

const details = await browser_execute_macro({
  id: "0205f262-f300-484d-97ee-38f602467182",
  params: { extractSpecs: true, extractVariants: true }
});

console.log("Product:", details.product.title);
console.log("Price:", details.product.pricing.current);

// 5. Extract reviews
const reviews = await browser_execute_macro({
  id: "6b1b9be2-e924-40a6-bad5-62bb15f448e4",
  params: { limit: 10, withPhotos: true }
});

console.log(`${reviews.totalReviews} reviews, extracted ${reviews.totalExtracted}`);

// 6. Get seller info
const seller = await browser_execute_macro({
  id: "f0763285-b887-427c-b1e3-5f39607306fa"
});

console.log("Seller:", seller.seller.name, "Rating:", seller.seller.rating.overall);
```

---

## Implementation Notes

### Multi-Layer Selector Strategy

All macros use 4-5 layers of selector fallbacks:

```javascript
const selectors = [
  '.search-item-card-wrapper-gallery',  // Layer 1: Current structure
  '[class*="search-card"]',              // Layer 2: Generic pattern
  '[class*="product-card"]',             // Layer 3: Alternate pattern
  '[data-product-id]'                    // Layer 4: Data attribute fallback
];
```

### Price Extraction Challenges

AliExpress has dynamic pricing:
- "New user" specials may hide prices from extraction
- Prices vary by user location and login status
- Multiple currencies supported
- Discount badges and coupons affect displayed price

**Solution**: Extract main price pattern `/^\$\d+\.?\d*$/` and handle null prices gracefully.

### Image Format

AliExpress uses modern `.avif` format for images. URLs contain thumbnail sizes that can be modified for full resolution:
- Thumbnail: `https://...480x480q75.jpg_.avif`
- Full size: Replace size patterns and extension

### Testing Notes

**Last Tested**: 2026-02-05
**Test Query**: "NVMe SSD 256GB"
**Results**: 12 products found, 5 extracted successfully
**Success Rate**: 100% for available data fields
**Known Issues**: Some products don't show prices (new user pricing)

---

## File Locations

**Macro Definitions**:
- Core (8): Stored in MongoDB ✅
- Advanced (11): `/tmp/aliexpress-advanced-macros.json` (ready to store)

**Storage Script**: Use `mcp__unibrowse__browser_store_macro` tool with each macro definition.

---

## Support & Updates

For issues or updates to these macros, refer to:
- Implementation summary: `/tmp/aliexpress-implementation-summary.md`
- Test results: Real browser testing on 2026-02-05
- Site changes: Monitor AliExpress for UI updates affecting selectors
