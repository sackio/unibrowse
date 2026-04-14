# Temu Shopping Macros

**Complete macro reference for Temu.com automation**

**Total Macros**: 16 (7 core + 9 advanced)
**Implementation Date**: 2026-02-05
**Status**: All macros created, ready to store ⏳

---

## Table of Contents

- [Overview](#overview)
- [Site Characteristics](#site-characteristics)
- [Core Macros (7)](#core-macros-7)
- [Advanced Macros (9)](#advanced-macros-9)
- [Usage Examples](#usage-examples)
- [Temu vs AliExpress](#temu-vs-aliexpress)

---

## Overview

These macros enable automated product research and comparison shopping on Temu ("Shop Like a Billionaire"). Similar to AliExpress macros but adapted for Temu's unique features including flash sales, aggressive pricing tactics, and simplified seller model.

**Scope**: Search, filtering, product extraction, reviews (NO purchasing automation)

---

## Site Characteristics

**URL Patterns**:
- Search: `https://www.temu.com/search_result.html?search_key={query}`
- Product: `https://www.temu.com/{goodsId}.html` or `?goods_id={id}`

**Key Features**:
- Flash sales and countdown timers
- Aggressive pricing ("72% off" common)
- Gamification elements (coins, wheel spins)
- Fast-changing inventory
- Less prominent seller information
- "Shop Like a Billionaire" marketing

**Technical Notes**:
- Product ID format: alphanumeric (vs AliExpress numeric)
- Simpler class structure than AliExpress
- Mobile-first design
- Badge-heavy UI ("Lightning Deal", "Limited Stock")

---

## Core Macros (7)

### 1. `temu_search_products` ⏳
**Category**: search

Search for products by keyword.

**Parameters**:
```javascript
{
  query: string,   // Required
  sortBy: string   // Optional: default|price_asc|price_desc|sales|newest
}
```

**Example**:
```javascript
await browser_execute_macro({
  name: "temu_search_products",
  params: { query: "wireless earbuds", sortBy: "price_asc" }
});
```

---

### 2. `temu_extract_search_results` ⏳
**Category**: extraction

Extract product listings from search results.

**Parameters**:
```javascript
{
  limit: number,             // Optional: max results (default: 60)
  includeImages: boolean,    // Optional (default: true)
  includeFlashSales: boolean // Optional (default: true)
}
```

**Returns**:
```javascript
{
  success: true,
  results: [
    {
      id: "abc123xyz",
      title: "NVMe SSD 256GB M.2 2280",
      price: { current: 24.99, original: 89.99, discount: "72% off", currency: "USD" },
      rating: { stars: 4.6, count: 3456 },
      sold: 12543,
      imageUrl: "...",
      productUrl: "...",
      badges: ["Lightning Deal", "Free Shipping", "Limited Stock"],
      flashSale: { active: true, text: "Ends in 2h 34m" }
    }
  ],
  totalExtracted: 40,
  hasMore: true
}
```

**Key Difference from AliExpress**: Includes `flashSale` object with countdown timers.

---

### 3. `temu_extract_product_details` ⏳
**Category**: extraction

Extract detailed product information.

**Parameters**: Same as AliExpress version

**Returns**: Similar to AliExpress but includes `flashSale` object.

---

### 4. `temu_extract_reviews` ⏳
**Category**: extraction

Extract product reviews.

**Parameters**:
```javascript
{
  limit: number,        // Optional: max reviews (default: 20)
  withPhotos: boolean   // Optional: only reviews with photos (default: false)
}
```

---

### 5. `temu_extract_seller_info` ⏳
**Category**: extraction

Extract seller information (note: Temu has minimal seller info).

**Returns**:
```javascript
{
  success: true,
  seller: {
    name: "Temu Official" || "Third Party Seller",
    type: "Official|Third Party",
    rating: { overall: "95%", count: 12345 },
    shipsFrom: "China",
    processingTime: "1-3 days"
  }
}
```

**Important**: Temu often doesn't display seller names prominently - most items ship from "Temu Official".

---

### 6. `temu_apply_price_filter` ⏳
**Category**: interaction

Apply price range filter.

**Parameters**: `{ minPrice: number, maxPrice: number }`

---

### 7. `temu_apply_sort` ⏳
**Category**: interaction

Apply sort order.

**Parameters**: `{ sortBy: string }` (default|price_asc|price_desc|sales|newest)

---

## Advanced Macros (9)

### Navigation (2 macros)

#### 8. `temu_navigate_page` ⏳
Navigate to specific page number.

#### 9. `temu_extract_pagination_info` ⏳
Extract pagination metadata.

---

### Filtering (2 macros)

#### 10. `temu_apply_category_filter` ⏳
Apply category filter.

**Parameters**: `{ category: string }`

#### 11. `temu_apply_rating_filter` ⏳
Apply minimum rating filter.

**Parameters**: `{ minRating: number }` (4, 4.5, or 5)

---

### Product Extraction (3 macros)

#### 12. `temu_extract_variants` ⏳
Extract product variants (size, color, etc.).

#### 13. `temu_extract_product_specs` ⏳
Extract specifications table.

#### 14. `temu_parse_price` ⏳
Parse price text into structured format (utility).

---

### Reviews (2 macros)

#### 15. `temu_extract_rating_summary` ⏳
Extract rating summary with distribution.

#### 16. `temu_apply_review_filter` ⏳
Apply filters to reviews.

**Parameters**:
```javascript
{
  sortBy: string,      // Optional: helpful|newest|rating_high|rating_low
  withPhotos: boolean  // Optional: only reviews with photos
}
```

---

## Usage Examples

### Basic Product Search & Extraction

```javascript
// 1. Search for products
await browser_execute_macro({
  name: "temu_search_products",
  params: { query: "wireless earbuds", sortBy: "price_asc" }
});

await browser_wait({ time: 2 });

// 2. Apply price filter
await browser_execute_macro({
  name: "temu_apply_price_filter",
  params: { minPrice: 10, maxPrice: 30 }
});

await browser_wait({ time: 2 });

// 3. Extract results
const results = await browser_execute_macro({
  name: "temu_extract_search_results",
  params: { limit: 20, includeFlashSales: true }
});

console.log(`Found ${results.totalExtracted} products`);

// 4. Check for flash sales
const flashDeals = results.results.filter(p => p.flashSale && p.flashSale.active);
console.log(`${flashDeals.length} flash deals available`);

// 5. Visit product and get details
await browser_navigate({ url: results.results[0].productUrl });
await browser_wait({ time: 2 });

const details = await browser_execute_macro({
  name: "temu_extract_product_details",
  params: { extractSpecs: true }
});

console.log("Product:", details.product.title);
console.log("Price:", details.product.pricing.current);
if (details.product.flashSale) {
  console.log("Flash sale ends:", details.product.flashSale.text);
}

// 6. Extract reviews
const reviews = await browser_execute_macro({
  name: "temu_extract_reviews",
  params: { limit: 10, withPhotos: true }
});

console.log(`${reviews.totalExtracted} reviews with photos`);
```

---

## Temu vs AliExpress

### Similarities
- Both are international marketplaces
- Similar product categories
- User reviews and ratings
- Multiple payment options
- Mobile-optimized

### Key Differences

| Feature | AliExpress | Temu |
|---------|-----------|------|
| **Seller Model** | Many independent sellers, detailed ratings | Mostly "Temu Official", less seller info |
| **Pricing** | Varied, "new user" specials | Aggressive discounts, flash sales everywhere |
| **Product IDs** | Numeric (e.g., `3256806943253333`) | Alphanumeric (e.g., `abc123xyz`) |
| **Search URL** | `/w/wholesale-{query}.html` | `/search_result.html?search_key={query}` |
| **Flash Sales** | Occasional | Prominent, constant countdowns |
| **Shipping Info** | Detailed (ship from country, methods) | Simplified |
| **UI Complexity** | Heavily obfuscated classes | Simpler structure |
| **Gamification** | Moderate (coins, coupons) | Heavy (spin wheel, games) |
| **Target Market** | Global marketplace | US-focused, budget-conscious |

### Macro Implementation Differences

1. **Flash Sale Handling**: Temu macros include `flashSale` object in product data
2. **Seller Info**: Temu's `extract_seller_info` returns minimal data
3. **Product IDs**: Temu uses regex `/goods_id=([a-z0-9]+)/i` vs AliExpress `/item\/(\\d+)/`
4. **Badges**: Temu has more aggressive badge language ("Lightning Deal", "Limited Stock")

---

## Implementation Notes

### Flash Sale Detection

Temu prominently displays flash sales. Extract using:
```javascript
const flashElements = Array.from(document.querySelectorAll('*')).filter(el =>
  /flash|lightning|countdown/i.test(el.className)
);
```

### Price Patterns

Temu frequently shows dramatic discounts:
- Original: $89.99
- Current: $24.99
- Discount: "72% off"

Extract both `current` and `original` prices plus `discount` percentage.

### Minimal Seller Info

Unlike AliExpress's detailed seller ratings:
- Temu often shows "Temu Official" as seller
- Limited seller ratings displayed
- Less emphasis on individual seller performance

**Macro Strategy**: `temu_extract_seller_info` returns basic info or defaults to "Temu Official".

---

## File Locations

**Macro Definitions**: `/tmp/temu-macros.json` (16 macros, ready to store)

**Storage Command**: Use `mcp__unibrowse__browser_store_macro` tool for each macro.

---

## Testing Recommendations

1. **Flash Sales**: Test during active flash sale periods
2. **Price Changes**: Prices change rapidly - test multiple times
3. **Inventory**: Products may go out of stock quickly
4. **Mobile View**: Temu is mobile-first - test responsive layouts
5. **Badges**: Verify badge extraction (many promotional badges)

---

## Support & Updates

For updates or issues:
- Monitor Temu for UI changes
- Flash sale timers may use different formats
- Product availability changes rapidly
- Refer to ALIEXPRESS_MACROS.md for similar patterns
