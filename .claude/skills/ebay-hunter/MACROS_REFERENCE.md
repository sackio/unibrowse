# eBay Macros Quick Reference

This document provides a quick reference for the eBay macros used in the Cluster Hunter workflow.

**Full documentation**: See `docs/macros/EBAY_MACROS.md` for complete details on all 18 eBay macros.

---

## Core Macros Used in Cluster Hunter

### 1. ebay_search_products

**Purpose**: Execute a search query on eBay with optional listing type filter.

**Parameters**:
```javascript
{
  query: string,        // Search query (e.g., "Lot Dell OptiPlex 3080 Micro i5")
  searchType: string    // "all", "buyItNow", or "auction"
}
```

**Returns**: Navigates to search results page.

**Usage in Workflow**: Step 2B (i) - Execute 8 search queries for different micro desktop models.

---

### 2. ebay_apply_filters

**Purpose**: Apply condition and price range filters to search results.

**Parameters**:
```javascript
{
  condition: string[],  // ["Used", "Refurbished", "New", "For Parts"]
  price: {
    min: number,        // Minimum price in dollars
    max: number         // Maximum price in dollars
  }
}
```

**Returns**: Applies filters to current search results page.

**Usage in Workflow**: Step 2B (ii) - Filter for Used/Refurbished listings between $50-$400.

**Note**: "For Parts" is excluded by design to avoid broken/incomplete systems.

---

### 3. ebay_apply_sort

**Purpose**: Sort search results by price, ending time, or newly listed.

**Parameters**:
```javascript
{
  sortBy: string  // "price", "endingSoonest", "newlyListed"
}
```

**Returns**: Sorts current search results.

**Usage in Workflow**: Step 2B (iii) - Sort by price (lowest first) to find best deals.

---

### 4. ebay_extract_search_results

**Purpose**: Extract product data from search results page.

**Parameters**:
```javascript
{
  limit: number,              // Max number of listings to extract (default: 20)
  calculateTotalPrice: boolean // Include item price + shipping in totalPrice field
}
```

**Returns**:
```javascript
{
  products: [
    {
      itemId: string,           // eBay item ID (unique identifier)
      title: string,            // Full listing title
      price: number,            // Item price in dollars
      shippingCost: number,     // Shipping cost (0 if free)
      totalPrice: number,       // price + shippingCost (if calculateTotalPrice: true)
      condition: string,        // "New", "Refurbished", "Used", "For Parts"
      seller: {
        username: string,       // Seller username
        positivePercentage: number,  // Seller positive feedback % (0-100)
        feedbackCount: number   // Total feedback count
      },
      url: string,              // Direct link to listing
      listingType: string,      // "buyItNow" or "auction"
      freeShipping: boolean,    // True if shipping is free
      imageUrl: string          // URL to product image
    },
    // ... more products
  ]
}
```

**Usage in Workflow**: Step 2B (iv) - Extract up to 60 listings per query for client-side filtering.

**Note**: This is the primary data source for the entire filtering pipeline.

---

## Other Available eBay Macros

These macros are available but not used in the current Cluster Hunter workflow:

- `ebay_navigate_to_product` - Navigate to a specific listing by URL or item ID
- `ebay_extract_product_details` - Extract detailed info from a single product page
- `ebay_extract_product_specs` - Extract technical specifications table
- `ebay_extract_images` - Extract all product images
- `ebay_add_to_watchlist` - Add item to eBay watchlist
- `ebay_remove_from_watchlist` - Remove item from watchlist
- `ebay_place_bid` - Place bid on auction listing
- `ebay_buy_it_now` - Purchase Buy It Now listing
- `ebay_add_to_cart` - Add item to shopping cart
- `ebay_view_cart` - Navigate to shopping cart
- `ebay_checkout` - Proceed to checkout
- `ebay_extract_seller_info` - Get detailed seller information
- `ebay_search_seller_items` - Search items from specific seller
- `ebay_extract_shipping_info` - Extract detailed shipping information

See `docs/macros/EBAY_MACROS.md` for complete documentation.

---

## Macro Execution Pattern

All macros are executed via the `browser_execute_macro` tool:

```javascript
browser_execute_macro({
  id: "macro_name",        // Macro ID from browser_list_macros
  params: { /* ... */ },   // Macro-specific parameters
  tabTarget: tabId         // Tab ID to execute macro in
})
```

**Best Practices**:
1. Always check macros exist first: `browser_list_macros({ site: "ebay.com" })`
2. Reuse single tab for sequential operations (more efficient)
3. Wait 2-3 seconds between searches to avoid rate limiting
4. Use extraction macros (not snapshots) for token efficiency

---

## Common Issues

### Rate Limiting

**Symptom**: eBay blocks access or returns CAPTCHA
**Solution**: Add `sleep 2` (or longer) between macro calls
**Used in**: Step 2B (vi) - 2 second delay between search queries

### Missing Data

**Symptom**: `ebay_extract_search_results` returns empty products array
**Cause**: Page didn't load, filters too restrictive, or no results
**Solution**: Check with `browser_snapshot` to see current page state

### Incorrect Filtering

**Symptom**: Too many/few results after `ebay_apply_filters`
**Cause**: eBay's server-side filters may be inconsistent
**Solution**: Use client-side filtering (Step 2B v) as final validation

---

## Data Flow

```
ebay_search_products (navigate)
  ↓
ebay_apply_filters (server-side filtering)
  ↓
ebay_apply_sort (sort by price)
  ↓
ebay_extract_search_results (extract data)
  ↓
Client-side filtering (bulk lot, CPU gen, condition, cost)
  ↓
Accumulate qualifying deals
```

This pipeline runs 8 times (once per search query), then results are deduplicated and ranked.
