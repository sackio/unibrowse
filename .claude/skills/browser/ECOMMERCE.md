# E-Commerce Automation Module

## Purpose

This module provides specialized guidance for e-commerce operations on Amazon, Google Shopping, Walmart, and multi-site price comparison. It leverages 34 site-specific e-commerce macros (17 Amazon + 12 Google Shopping + 5 Walmart) plus universal macros for other e-commerce sites.

## When Main Skill Routes Here

The main browser skill routes requests to this module when detecting:

**Keywords**: "amazon", "shopping", "price", "product", "reviews", "buy", "purchase", "walmart", "best buy", "google shopping", "cart", "rufus"

**Patterns**:
- Product searches and filtering
- Price comparison across multiple sites
- Reviews analysis and sentiment tracking
- Shopping cart operations
- E-commerce automation tasks

**Example Requests**:
- "Search Amazon for wireless headphones under $100"
- "Compare prices for iPhone 15 Pro on Amazon, Walmart, and Google Shopping"
- "Analyze reviews for this product focusing on battery life"
- "Find the best value poly strapping kit on Amazon"
- "Add this product to cart with color Black and size Large"

## Core Capabilities

### 1. Amazon Operations
- Product search with advanced filters
- Price tracking and monitoring
- Reviews analysis and sentiment tracking
- Rufus AI integration for smart shopping
- Cart operations and variation selection

### 2. Google Shopping
- Price comparison across retailers
- Product availability checking
- Merchant ratings and filtering
- Multi-retailer aggregation

### 3. Walmart
- Product search and extraction
- Client-side sorting and filtering
- Product details and specifications

### 4. Multi-Site Comparison
- Parallel price checking (Amazon, Walmart, Google Shopping, etc.)
- Feature comparison across sites
- Best deal identification

## Available E-Commerce Macros (34 Total)

### Amazon Macros (17 Total)

**Site**: `amazon.com`
**Full Documentation**: See `.claude/skills/browser/AMAZON_MACROS.md`

#### Navigation Macros (4)

- **`amazon_search`** - Search Amazon with query
- **`amazon_click_product`** - Click product from listing (index: 1-based)
- **`amazon_navigate_pages`** - Navigate pagination (next/previous)
- **`amazon_view_all_reviews`** - Navigate to full reviews page

#### Extraction Macros (7)

- **`amazon_get_product_info`** - Complete product details (title, price, rating, features, images)
- **`amazon_get_listing_products`** - All products from search/listing page
- **`amazon_get_related_products`** - Related/recommended products
- **`amazon_extract_search_results`** - Search results + pagination + filters
- **`amazon_get_available_filters`** - All available filter options
- **`amazon_get_product_images`** - All product images including zoomed
- **`amazon_get_reviews_summary`** - Reviews statistics and breakdown

#### Interaction Macros (5)

- **`amazon_ask_rufus`** - Interact with Rufus AI assistant
- **`amazon_apply_filter`** - Apply specific filter (price, brand, prime, etc.)
- **`amazon_apply_sort`** - Sort results (featured, price, rating, newest)
- **`amazon_select_variation`** - Select product variation (color, size, etc.)
- **`amazon_add_to_cart`** - Add current product to cart

#### Search Macros (1)

- **`amazon_search_reviews`** - Search within product reviews

### Google Shopping Macros (12 Total)

**Site**: `shopping.google.com`
**Full Documentation**: See `.claude/skills/browser/GOOGLE_SHOPPING_MACROS.md`

#### Search & Navigation (3)

- **`google_shopping_search`** - Search Google Shopping
- **`google_shopping_click_product`** - Click product from results
- **`google_shopping_load_more_results`** - Load more products (infinite scroll)

#### Extraction (3)

- **`google_shopping_extract_products`** - All products from current page
- **`google_shopping_get_available_filters`** - All filter options
- **`google_shopping_get_product_images`** - Product images from detail view

#### Interaction (4)

- **`google_shopping_apply_filter`** - Apply filter
- **`google_shopping_apply_sort`** - Client-side sorting
- **`google_shopping_filter_by_shipping`** - Filter by shipping options
- **`google_shopping_open_merchant_page`** - Open product on merchant site

#### Utility (2)

- **`google_shopping_sort_by_total_price`** - Sort by total cost (price + shipping)
- **`google_shopping_filter_by_merchant`** - Filter by specific merchant

### Walmart Macros (5 Total)

**Site**: `walmart.com`
**Full Documentation**: See `.claude/skills/browser/WALMART_MACROS.md`

- **`walmart_search`** - Search Walmart
- **`walmart_extract_products`** - All products from current page
- **`walmart_get_product_details`** - Complete product details from product page
- **`walmart_sort_by_price`** - Client-side price sorting
- **`walmart_filter_products`** - Client-side filtering by criteria

## Standard Workflows

### Workflow 1: Amazon Product Search

**User Request**: "Search Amazon for wireless headphones under $100 sorted by rating"

**Instructions for Main Conversation**:

1. **Create and label Amazon tab**:
   ```
   Call: mcp__browser__browser_create_tab({ url: "https://amazon.com" })
   Store the returned tabId from result.content.tabId
   Example: If result is { content: { tabId: 123 } }, store amazonTab = 123

   Call: mcp__browser__browser_set_tab_label({ tabTarget: 123, label: "amazon-search" })
   ```

2. **Execute Amazon search macro**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_search",
     params: { query: "wireless headphones" },
     tabTarget: amazonTab
   })
   ```

3. **Apply price filter**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_apply_filter",
     params: { filterType: "price", value: "under-100" },
     tabTarget: amazonTab
   })
   ```

4. **Apply rating sort**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_apply_sort",
     params: { sortBy: "rating" },
     tabTarget: amazonTab
   })
   ```

5. **Extract products**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_get_listing_products",
     params: {},
     tabTarget: amazonTab
   })
   Store the products array from result.content.products
   ```

6. **Return structured results**:
   ```json
   {
     "tabId": 123,
     "label": "amazon-search",
     "url": "https://amazon.com",
     "site": "amazon",
     "method": "amazon-macros",
     "macrosUsed": ["amazon_search", "amazon_apply_filter", "amazon_apply_sort", "amazon_get_listing_products"],
     "data": {
       "query": "wireless headphones",
       "filters": ["price: under-100", "sort: rating"],
       "products": [...]
     }
   }
   ```

**Follow-up Pattern**:
- User says: "Show me details on the first result"
- You should: Use stored amazonTab (123) and:
  ```
  Call: mcp__browser__browser_execute_macro({
    id: "amazon_click_product",
    params: { index: 1 },
    tabTarget: amazonTab
  })

  Then call: mcp__browser__browser_execute_macro({
    id: "amazon_get_product_info",
    tabTarget: amazonTab
  })
  ```

### Workflow 2: Multi-Site Price Comparison

**User Request**: "Compare prices for iPhone 15 Pro on Amazon, Walmart, and Google Shopping"

**Instructions for Main Conversation**:

1. **Create tabs for all sites** (can be done in sequence or parallel):
   ```
   Call: mcp__browser__browser_create_tab({ url: "https://amazon.com" })
   Store amazonTab = result.content.tabId

   Call: mcp__browser__browser_create_tab({ url: "https://shopping.google.com" })
   Store googleShoppingTab = result.content.tabId

   Call: mcp__browser__browser_create_tab({ url: "https://walmart.com" })
   Store walmartTab = result.content.tabId
   ```

2. **Label all tabs**:
   ```
   Call: mcp__browser__browser_set_tab_label({ tabTarget: amazonTab, label: "amazon" })
   Call: mcp__browser__browser_set_tab_label({ tabTarget: googleShoppingTab, label: "google-shopping" })
   Call: mcp__browser__browser_set_tab_label({ tabTarget: walmartTab, label: "walmart" })
   ```

3. **Search all sites** (execute site-specific search macros):
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_search",
     params: { query: "iPhone 15 Pro" },
     tabTarget: amazonTab
   })

   Call: mcp__browser__browser_execute_macro({
     id: "google_shopping_search",
     params: { query: "iPhone 15 Pro" },
     tabTarget: googleShoppingTab
   })

   Call: mcp__browser__browser_execute_macro({
     id: "walmart_search",
     params: { query: "iPhone 15 Pro" },
     tabTarget: walmartTab
   })
   ```

4. **Extract products from all sites**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_get_listing_products",
     tabTarget: amazonTab
   })
   Store amazonProducts = result.content.products

   Call: mcp__browser__browser_execute_macro({
     id: "google_shopping_extract_products",
     tabTarget: googleShoppingTab
   })
   Store googleShoppingProducts = result.content.products

   Call: mcp__browser__browser_execute_macro({
     id: "walmart_extract_products",
     tabTarget: walmartTab
   })
   Store walmartProducts = result.content.products
   ```

5. **Apply price sorting on all sites**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_apply_sort",
     params: { sortBy: "price-low-high" },
     tabTarget: amazonTab
   })

   Call: mcp__browser__browser_execute_macro({
     id: "google_shopping_apply_sort",
     params: { sortBy: "price-asc" },
     tabTarget: googleShoppingTab
   })

   Call: mcp__browser__browser_execute_macro({
     id: "walmart_sort_by_price",
     params: { order: "asc" },
     tabTarget: walmartTab
   })
   ```

6. **Re-extract sorted products**:
   ```
   Repeat step 4 to get sorted results from all sites
   ```

7. **Compare and return results**:
   ```json
   {
     "tabs": [
       {
         "tabId": amazonTab,
         "label": "amazon",
         "site": "amazon",
         "url": "https://amazon.com",
         "products": [...],
         "lowestPrice": amazonProducts[0]?.price,
         "macrosUsed": ["amazon_search", "amazon_apply_sort", "amazon_get_listing_products"]
       },
       {
         "tabId": googleShoppingTab,
         "label": "google-shopping",
         "site": "google-shopping",
         "url": "https://shopping.google.com",
         "products": [...],
         "lowestPrice": googleShoppingProducts[0]?.price,
         "macrosUsed": ["google_shopping_search", "google_shopping_apply_sort", "google_shopping_extract_products"]
       },
       {
         "tabId": walmartTab,
         "label": "walmart",
         "site": "walmart",
         "url": "https://walmart.com",
         "products": [...],
         "lowestPrice": walmartProducts[0]?.price,
         "macrosUsed": ["walmart_search", "walmart_sort_by_price", "walmart_extract_products"]
       }
     ],
     "comparison": {
       "lowestPrice": { "site": "walmart", "price": "$999.00" },
       "bestRating": { "site": "amazon", "rating": 4.7 },
       "totalProductsFound": 45
     }
   }
   ```

### Workflow 2a: Amazon Deep Comparison Shopping

**User Request**: "Find the best value wireless headphones on Amazon" or "Do comprehensive comparison shopping for standing desks"

**Purpose**: When you need to thoroughly evaluate multiple products by clicking into each one, examining details, related products, reviews, and making an informed comparison.

**Instructions for Main Conversation**:

1. **Initial search and extraction**:
   ```
   Call: mcp__unibrowse__browser_create_tab({ url: "https://amazon.com" })
   Store amazonTab = result.content.tabId

   Call: mcp__unibrowse__browser_attach_tab({ tabId: amazonTab, label: "amazon-comparison" })

   Call: mcp__unibrowse__browser_execute_macro({
     id: "<amazon_search_uuid>",
     params: { query: "wireless headphones" },
     tabTarget: amazonTab
   })

   Wait 3 seconds for page load:
   Call: mcp__unibrowse__browser_wait({ time: 3 })

   Call: mcp__unibrowse__browser_execute_macro({
     id: "<amazon_get_listing_products_uuid>",
     params: { includeSponsored: false },
     tabTarget: amazonTab
   })
   Store products = result.content.products
   ```

2. **Select top candidates** (choose 3-5 products based on rating + review count):
   ```
   Filter products by:
   - Rating >= 4.3 stars
   - Review count >= 50 reviews
   - Prime eligible (if important)
   - Price within target range

   Sort by: (rating × log(reviewCount)) to balance quality and confidence
   Take top 3-5 products
   Store selectedProducts = [product1, product2, product3, ...]
   ```

3. **Deep dive into each product** (loop through selectedProducts):
   ```
   For each product in selectedProducts:

     a. Click into product:
        Call: mcp__unibrowse__browser_execute_macro({
          id: "<amazon_click_product_uuid>",
          params: { position: product.position },
          tabTarget: amazonTab
        })

        Wait 2 seconds:
        Call: mcp__unibrowse__browser_wait({ time: 2 })

     b. Get comprehensive product details:
        Call: mcp__unibrowse__browser_execute_macro({
          id: "<amazon_get_product_info_uuid>",
          params: {
            includeDescription: true,
            includeFeatures: true,
            includeSpecs: true,
            includeAboutItem: true
          },
          tabTarget: amazonTab
        })
        Store productDetails[product.asin] = result.content.product

     c. Get related/alternative products:
        Call: mcp__unibrowse__browser_execute_macro({
          id: "<amazon_get_related_products_uuid>",
          tabTarget: amazonTab
        })
        Store relatedProducts[product.asin] = result.content.relatedProducts

     d. Get reviews summary:
        Call: mcp__unibrowse__browser_execute_macro({
          id: "<amazon_get_reviews_summary_uuid>",
          tabTarget: amazonTab
        })
        Store reviewsSummary[product.asin] = result.content

     e. Navigate back to search results:
        Call: mcp__unibrowse__browser_go_back({ tabTarget: amazonTab })

        Wait 2 seconds:
        Call: mcp__unibrowse__browser_wait({ time: 2 })
   ```

4. **Optional: Ask Rufus for comparison** (if available):
   ```
   Navigate back to first product or search page

   Call: mcp__unibrowse__browser_execute_macro({
     id: "<amazon_ask_rufus_uuid>",
     params: {
       question: "Compare [product1_title] vs [product2_title] vs [product3_title]. Which is best value?"
     },
     tabTarget: amazonTab
   })
   Store rufusComparison = result.content.response
   ```

5. **Analyze and compare**:
   ```
   For each product, calculate value score:

   valueScore = (
     (rating / 5.0) × 0.30 +                    // 30% weight on rating
     (reviewCount / maxReviewCount) × 0.20 +     // 20% weight on review count
     ((maxPrice - price) / maxPrice) × 0.30 +    // 30% weight on price (lower is better)
     (featureCount / maxFeatureCount) × 0.20     // 20% weight on features
   )

   Rank products by valueScore

   Consider additional factors:
   - Delivery speed (Prime vs standard)
   - Brand reputation
   - Warranty/return policy
   - Related products quality (indicates category strength)
   - Review sentiment on key topics
   ```

6. **Return comprehensive comparison**:
   ```json
   {
     "tabId": amazonTab,
     "label": "amazon-comparison",
     "query": "wireless headphones",
     "method": "deep-comparison-shopping",
     "macrosUsed": [
       "amazon_search",
       "amazon_get_listing_products",
       "amazon_click_product (×3)",
       "amazon_get_product_info (×3)",
       "amazon_get_related_products (×3)",
       "amazon_get_reviews_summary (×3)",
       "amazon_ask_rufus"
     ],
     "productsAnalyzed": 3,
     "comparison": {
       "winner": {
         "asin": "B0ABC123",
         "title": "Product Name",
         "price": "$79.99",
         "rating": 4.7,
         "reviewCount": 1234,
         "valueScore": 0.87,
         "whyBestValue": "Highest rating (4.7) with strong review count (1234), excellent price point, and comprehensive feature set including noise cancellation and 30-hour battery"
       },
       "runnerUp": {
         "asin": "B0DEF456",
         "title": "Product Name 2",
         "price": "$69.99",
         "rating": 4.5,
         "reviewCount": 890,
         "valueScore": 0.82,
         "whyRunnerUp": "Lower price but slightly fewer features and shorter battery life"
       },
       "allProducts": [
         {
           "asin": "B0ABC123",
           "title": "...",
           "price": "$79.99",
           "rating": 4.7,
           "reviewCount": 1234,
           "valueScore": 0.87,
           "features": ["Feature 1", "Feature 2", "..."],
           "pros": ["Excellent battery life", "Great noise cancellation"],
           "cons": ["Bulky design", "No waterproofing"],
           "relatedProductsCount": 12,
           "topRelatedProducts": [
             { "title": "...", "price": "$...", "rating": ... }
           ]
         },
         // ... more products
       ],
       "rufusRecommendation": "Rufus suggests Product 1 for best value because..."
     }
   }
   ```

**Follow-up Patterns**:

- User: "Show me more details on the winner"
  ```
  Navigate to winner product:
  Call: mcp__unibrowse__browser_navigate({
    url: "https://amazon.com/dp/" + winner.asin,
    tabTarget: amazonTab
  })

  Get full details with all optional fields
  ```

- User: "Check reviews for battery life on the winner"
  ```
  Call: mcp__unibrowse__browser_execute_macro({
    id: "<amazon_view_all_reviews_uuid>",
    tabTarget: amazonTab
  })

  Then:
  Call: mcp__unibrowse__browser_execute_macro({
    id: "<amazon_search_reviews_uuid>",
    params: { searchQuery: "battery life" },
    tabTarget: amazonTab
  })
  ```

- User: "Compare with related products too"
  ```
  Use stored relatedProducts[winner.asin] data
  Repeat deep dive process for top 2-3 related products
  Add to comparison analysis
  ```

**Token Conservation Notes**:
- Only get full details (description, specs, etc.) for top candidates
- Limit deep dive to 3-5 products maximum
- Use `includeSponsored: false` to reduce noise
- Store all data for follow-up questions to avoid re-fetching

**Time Estimate**:
- Initial search: ~5 seconds
- Per product deep dive: ~8-10 seconds
- Total for 3 products: ~30-40 seconds

---

### Workflow 2b: Google Shopping Deep Comparison Shopping

**User Request**: "Find the best value standing desk on Google Shopping" or "Compare prices across merchants for wireless mice"

**Purpose**: When you need to find the best total price (product + shipping) across multiple merchants on Google Shopping with comprehensive filtering and sorting.

**Instructions for Main Conversation**:

1. **Initial search and extraction**:
   ```
   Call: mcp__unibrowse__browser_create_tab({ url: "https://shopping.google.com" })
   Store googleShoppingTab = result.content.tabId

   Call: mcp__unibrowse__browser_attach_tab({ tabId: googleShoppingTab, label: "google-shopping-comparison" })

   Call: mcp__unibrowse__browser_execute_macro({
     id: "<google_shopping_search_uuid>",
     params: { query: "standing desk adjustable" },
     tabTarget: googleShoppingTab
   })

   Wait 3 seconds for page load:
   Call: mcp__unibrowse__browser_wait({ time: 3 })

   Call: mcp__unibrowse__browser_execute_macro({
     id: "<google_shopping_extract_products_uuid>",
     params: {
       maxResults: 50,
       includeSponsored: false
     },
     tabTarget: googleShoppingTab
   })
   Store products = result.content.products
   ```

2. **Optional: Apply filters** (based on user requirements):
   ```
   a. Get available filters to understand options:
      Call: mcp__unibrowse__browser_execute_macro({
        id: "<google_shopping_get_available_filters_uuid>",
        tabTarget: googleShoppingTab
      })
      Store availableFilters = result.content.filters

   b. Apply relevant filters (price range, features, brand, etc.):
      Call: mcp__unibrowse__browser_execute_macro({
        id: "<google_shopping_apply_filter_uuid>",
        params: { filterText: "$200 - $400" },
        tabTarget: googleShoppingTab
      })

      Wait 2 seconds for filter to apply:
      Call: mcp__unibrowse__browser_wait({ time: 2 })

      Call: mcp__unibrowse__browser_execute_macro({
        id: "<google_shopping_apply_filter_uuid>",
        params: { filterText: "Electric" },
        tabTarget: googleShoppingTab
      })

      Wait 2 seconds:
      Call: mcp__unibrowse__browser_wait({ time: 2 })

   c. Apply shipping filters if needed:
      Call: mcp__unibrowse__browser_execute_macro({
        id: "<google_shopping_filter_by_shipping_uuid>",
        params: {
          freeShipping: true,
          getItToday: false,
          nearby: false
        },
        tabTarget: googleShoppingTab
      })

      Wait 2 seconds:
      Call: mcp__unibrowse__browser_wait({ time: 2 })
   ```

3. **Load more results** (if needed for better selection):
   ```
   Call: mcp__unibrowse__browser_execute_macro({
     id: "<google_shopping_load_more_results_uuid>",
     tabTarget: googleShoppingTab
   })

   Wait 3 seconds for new products to load:
   Call: mcp__unibrowse__browser_wait({ time: 3 })
   ```

4. **Extract comprehensive product data after filtering**:
   ```
   Call: mcp__unibrowse__browser_execute_macro({
     id: "<google_shopping_extract_products_uuid>",
     params: {
       maxResults: 100,
       includeSponsored: false
     },
     tabTarget: googleShoppingTab
   })
   Store filteredProducts = result.content.products
   ```

5. **Sort by total price** (product + shipping):
   ```
   Call: mcp__unibrowse__browser_execute_macro({
     id: "<google_shopping_sort_by_total_price_uuid>",
     params: { maxResults: 50 },
     tabTarget: googleShoppingTab
   })
   Store sortedProducts = result.content.products
   ```

6. **Optional: Filter by trusted merchants**:
   ```
   Call: mcp__unibrowse__browser_execute_macro({
     id: "<google_shopping_filter_by_merchant_uuid>",
     params: {
       merchants: ["Amazon", "Best Buy", "Walmart", "Target"],
       exactMatch: false,
       maxResults: 50
     },
     tabTarget: googleShoppingTab
   })
   Store merchantFiltered = result.content.products
   ```

7. **Select top candidates** (choose top 5-10 based on total price + rating):
   ```
   Filter products by:
   - Rating >= 4.0 stars (if available)
   - Review count >= 10 reviews (for confidence)
   - Shipping cost known (products with unknown shipping ranked lower)
   - Trusted merchants (if user specified)

   Take top 5-10 products with best total price
   Store selectedProducts = sortedProducts.slice(0, 10)
   ```

8. **Analyze and compare**:
   ```
   For each product, calculate value score:

   valueScore = (
     (rating / 5.0) × 0.25 +                          // 25% weight on rating
     (reviewCount / maxReviewCount) × 0.15 +           // 15% weight on review count
     ((maxTotalPrice - totalPrice) / maxTotalPrice) × 0.40 +  // 40% weight on total price (lower is better)
     (merchantTrust / 5.0) × 0.20                      // 20% weight on merchant trust
   )

   merchantTrust scoring:
   - Amazon, Best Buy, Walmart, Target, Apple: 5/5
   - Established brands: 4/5
   - Unknown merchants: 2/5

   Rank products by valueScore

   Consider additional factors:
   - Free shipping vs paid shipping
   - Delivery speed (same-day, next-day, standard)
   - Nearby store availability
   - Merchant reputation
   - Return policy (infer from merchant)
   ```

9. **Return comprehensive comparison**:
   ```json
   {
     "tabId": googleShoppingTab,
     "label": "google-shopping-comparison",
     "query": "standing desk adjustable",
     "method": "deep-comparison-shopping",
     "macrosUsed": [
       "google_shopping_search",
       "google_shopping_extract_products (×2)",
       "google_shopping_get_available_filters",
       "google_shopping_apply_filter (×2)",
       "google_shopping_filter_by_shipping",
       "google_shopping_load_more_results",
       "google_shopping_sort_by_total_price",
       "google_shopping_filter_by_merchant"
     ],
     "productsAnalyzed": 50,
     "topCandidates": 10,
     "comparison": {
       "winner": {
         "position": 3,
         "title": "FlexiSpot Electric Standing Desk 48x24",
         "price": 299.99,
         "shippingCost": 0,
         "totalPrice": 299.99,
         "merchant": "Amazon",
         "rating": 4.6,
         "reviewCount": 2341,
         "valueScore": 0.89,
         "shipping": {
           "freeDelivery": true,
           "deliveryTime": "delivery by Thursday",
           "nearby": false
         },
         "whyBestValue": "Excellent total price ($299.99 with free shipping), high rating (4.6★), strong review count (2341), trusted merchant (Amazon), and fast delivery"
       },
       "runnerUp": {
         "position": 7,
         "title": "VIVO Electric Height Adjustable Desk 48x30",
         "price": 279.99,
         "shippingCost": 19.99,
         "totalPrice": 299.98,
         "merchant": "Walmart",
         "rating": 4.4,
         "reviewCount": 890,
         "valueScore": 0.82,
         "shipping": {
           "freeDelivery": false,
           "shippingCost": "$19.99",
           "deliveryTime": "delivery by Friday"
         },
         "whyRunnerUp": "Nearly identical total price ($299.98) but paid shipping and slightly lower rating (4.4★ vs 4.6★)"
       },
       "allProducts": [
         {
           "position": 3,
           "title": "FlexiSpot Electric Standing Desk",
           "price": 299.99,
           "shippingCost": 0,
           "totalPrice": 299.99,
           "merchant": "Amazon",
           "rating": 4.6,
           "reviewCount": 2341,
           "valueScore": 0.89,
           "productUrl": "https://google.com/shopping/product/...",
           "imageUrl": "https://...",
           "specs": ["Electric", "48x24", "Height Adjustable"],
           "shipping": {
             "freeDelivery": true,
             "deliveryTime": "delivery by Thursday"
           },
           "merchantTrust": 5
         },
         // ... more products
       ],
       "priceRange": {
         "lowest": 279.99,
         "highest": 499.99,
         "average": 365.50
       },
       "shippingAnalysis": {
         "freeShippingCount": 35,
         "paidShippingCount": 15,
         "averageShippingCost": 12.50
       },
       "merchantBreakdown": {
         "Amazon": 22,
         "Walmart": 12,
         "Best Buy": 8,
         "Target": 5,
         "Others": 3
       }
     }
   }
   ```

10. **Optional: Click through to merchant** (if user wants to purchase):
    ```
    Call: mcp__unibrowse__browser_execute_macro({
      id: "<google_shopping_open_merchant_page_uuid>",
      params: { position: winner.position },
      tabTarget: googleShoppingTab
    })

    Wait for merchant page to load:
    Call: mcp__unibrowse__browser_wait({ time: 3 })

    Note: This navigates to the merchant's website (e.g., Amazon product page)
    User can complete purchase there
    ```

**Follow-up Patterns**:

- User: "Show me the cheapest option overall"
  ```
  sortedProducts[0] is the cheapest by total price
  Present details with shipping breakdown
  ```

- User: "Which has the fastest delivery?"
  ```
  Filter sortedProducts by shipping.deliveryTime
  Find products with "today", "tomorrow", or earliest date
  Present top 3 fastest delivery options
  ```

- User: "Only show me options from Amazon"
  ```
  Call: mcp__unibrowse__browser_execute_macro({
    id: "<google_shopping_filter_by_merchant_uuid>",
    params: {
      merchants: ["Amazon"],
      exactMatch: true,
      maxResults: 50
    },
    tabTarget: googleShoppingTab
  })

  Re-sort by total price
  Present Amazon-only results
  ```

- User: "What if I need same-day delivery?"
  ```
  Call: mcp__unibrowse__browser_execute_macro({
    id: "<google_shopping_filter_by_shipping_uuid>",
    params: { getItToday: true },
    tabTarget: googleShoppingTab
  })

  Wait 2 seconds:
  Call: mcp__unibrowse__browser_wait({ time: 2 })

  Extract and sort new results
  Present same-day delivery options
  ```

**Token Conservation Notes**:
- Extract all products once, then use client-side sorting/filtering macros
- `google_shopping_sort_by_total_price` and `google_shopping_filter_by_merchant` don't reload page (saves tokens)
- Limit initial extraction to 50 products, load more only if needed
- Store all data for follow-up questions to avoid re-fetching

**Key Differences from Amazon Workflow**:
- Google Shopping is an aggregator → can't click into individual product detail pages like Amazon
- Focus on **total price** (product + shipping) rather than just product price
- **Merchant comparison** is primary value proposition
- Shipping filters are more important (free shipping, same-day, nearby stores)
- Less detailed product data (no "About this item", fewer specs)
- No Rufus AI equivalent

**When to Use This vs Amazon Workflow**:
- **Use Google Shopping** when: comparing across multiple merchants, finding cheapest total price including shipping, need quick merchant comparison
- **Use Amazon** when: need detailed product info, want Rufus AI insights, care about Prime benefits, need review analysis

**Time Estimate**:
- Initial search + extraction: ~5 seconds
- Apply filters: ~2-3 seconds per filter
- Load more results: ~3 seconds
- Sort by total price: ~1 second (client-side)
- Filter by merchant: ~1 second (client-side)
- Total: ~15-25 seconds (much faster than Amazon deep dive)

---

### Workflow 3: Reviews Analysis

**User Request**: "Analyze reviews for this Amazon product focusing on battery life and sound quality"

**Instructions for Main Conversation**:

1. **Get reviews summary**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_get_reviews_summary",
     tabTarget: amazonTab
   })
   Store summary = result.content
   ```

2. **View all reviews**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_view_all_reviews",
     tabTarget: amazonTab
   })
   ```

3. **Search reviews for specific topics**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_search_reviews",
     params: { query: "battery life" },
     tabTarget: amazonTab
   })
   Store batteryReviews = result.content

   Call: mcp__browser__browser_execute_macro({
     id: "amazon_search_reviews",
     params: { query: "sound quality" },
     tabTarget: amazonTab
   })
   Store soundReviews = result.content
   ```

4. **Return analysis**:
   ```json
   {
     "tabId": amazonTab,
     "data": {
       "summary": {
         "overallRating": 4.5,
         "totalReviews": 1234,
         "ratingBreakdown": {...},
         "keyFeaturesMultioned": [...]
       },
       "topicAnalysis": {
         "batteryLife": {
           "mentionCount": 89,
           "sentiment": "mixed",
           "commonPoints": ["lasts 8 hours", "drains quickly", "good for price"]
         },
         "soundQuality": {
           "mentionCount": 156,
           "sentiment": "positive",
           "commonPoints": ["clear bass", "balanced", "excellent for price"]
         }
       }
     }
   }
   ```

### Workflow 4: Rufus AI Integration

**User Request**: "Ask Rufus AI for wireless headphone recommendations under $100"

**Instructions for Main Conversation**:

1. **Navigate to Amazon** (if not already there):
   ```
   Call: mcp__browser__browser_navigate({
     url: "https://amazon.com",
     tabTarget: amazonTab
   })
   ```

2. **Ask Rufus for recommendations**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_ask_rufus",
     params: { question: "What are the best wireless headphones under $100?" },
     tabTarget: amazonTab
   })
   Store recommendations = result.content
   ```

3. **Ask Rufus for comparisons** (optional):
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_ask_rufus",
     params: { question: "Compare the top 3 wireless headphones under $100" },
     tabTarget: amazonTab
   })
   Store comparison = result.content
   ```

4. **Return Rufus insights**:
   ```json
   {
     "tabId": amazonTab,
     "method": "rufus-ai",
     "data": {
       "rufusRecommendations": "...",
       "rufusComparison": "..."
     }
   }
   ```

**Error Handling**: If Rufus is not available:
- Fall back to regular search and extraction
- Return note: "Rufus AI not available, using standard search"

### Workflow 5: Cart Operations

**User Request**: "Add this product to cart with color Black and size Large, quantity 2"

**Instructions for Main Conversation**:

1. **Select product variation (color)**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_select_variation",
     params: { variationType: "color", value: "Black" },
     tabTarget: amazonTab
   })
   ```

2. **Select product variation (size)**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_select_variation",
     params: { variationType: "size", value: "Large" },
     tabTarget: amazonTab
   })
   ```

3. **Add to cart**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_add_to_cart",
     params: { quantity: 2 },
     tabTarget: amazonTab
   })
   ```

4. **Return confirmation**:
   ```json
   {
     "tabId": amazonTab,
     "data": {
       "addedToCart": true,
       "variation": { "color": "Black", "size": "Large" },
       "quantity": 2,
       "confirmation": "..."
     }
   }
   ```

## Token Conservation

Follow these rules to minimize token usage:

### 1. Use Macros Instead of Snapshots

**DON'T**:
```
Call: mcp__browser__browser_snapshot({ tabTarget: amazonTab })
```

**DO**:
```
Call: mcp__browser__browser_execute_macro({
  id: "amazon_get_listing_products",
  tabTarget: amazonTab
})
```

### 2. Truncate Text Extraction

When using text extraction (rare, prefer macros):
```
Call: mcp__browser__browser_get_visible_text({
  maxLength: 3000,
  tabTarget: amazonTab
})
```

### 3. Clean Interruptions First

Before main operations:
```
Call: mcp__browser__browser_execute_macro({ id: "dismiss_interruptions", tabTarget: amazonTab })
Call: mcp__browser__browser_execute_macro({ id: "smart_cookie_consent", tabTarget: amazonTab })
```

## Macro Discovery Pattern (Non-Amazon/Walmart/Google Shopping Sites)

For other e-commerce sites (eBay, Best Buy, Target, etc.):

1. **Extract domain**:
   ```
   domain = extract hostname from URL (e.g., "ebay.com")
   ```

2. **Check for site-specific macros**:
   ```
   Call: mcp__browser__browser_list_macros({ site: domain })
   ```

3. **Check for universal macros**:
   ```
   Call: mcp__browser__browser_list_macros({ site: "*" })
   ```

4. **Execute macro or use direct tools**:
   - If site-specific macro found: Use it
   - Else if universal macro found: Use it
   - Else: Use direct browser tools (browser_type, browser_click, browser_get_visible_text, etc.)

## Error Handling

### Common Errors and Solutions

**Error**: "Product not found" or empty search results

**Solution**:
```
1. Retry with broader query (remove filters, use fewer keywords)
2. Call: mcp__browser__browser_execute_macro({
     id: "amazon_search",
     params: { query: broaderQuery },
     tabTarget: amazonTab
   })
3. If still no results, inform user product may not be available
```

**Error**: "Filter not available"

**Solution**:
```
1. Get available filters first:
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_get_available_filters",
     tabTarget: amazonTab
   })
2. Show user available filters
3. Apply valid filter from available options
```

**Error**: "Rufus not available"

**Solution**:
```
Fall back to regular search/extraction:
Call: mcp__browser__browser_execute_macro({
  id: "amazon_get_listing_products",
  tabTarget: amazonTab
})
Return note: "Rufus AI not available, using standard search"
```

**Error**: "Variation not found"

**Solution**:
```
1. Get product info to see available variations:
   Call: mcp__browser__browser_execute_macro({
     id: "amazon_get_product_info",
     tabTarget: amazonTab
   })
2. Show user available variations
3. Select from available options
```

## Return Format

**ALWAYS include tab metadata for context preservation**:

**Single Site Search**:
```json
{
  "tabId": 123,
  "label": "amazon-search",
  "url": "https://amazon.com",
  "site": "amazon",
  "method": "amazon-macros",
  "macrosUsed": ["amazon_search", "amazon_apply_filter", "amazon_get_listing_products"],
  "data": {
    "query": "wireless headphones",
    "filters": ["price: under-100", "sort: rating"],
    "products": [...],
    "pagination": { "currentPage": 1, "totalPages": 10 }
  }
}
```

**Multi-Site Comparison**:
```json
{
  "tabs": [
    { "tabId": 123, "label": "amazon", "site": "amazon", "products": [...], "lowestPrice": "$79.99" },
    { "tabId": 456, "label": "walmart", "site": "walmart", "products": [...], "lowestPrice": "$74.99" }
  ],
  "comparison": {
    "lowestPrice": { "site": "walmart", "price": "$74.99", "savings": "$5.00" },
    "bestRating": { "site": "amazon", "rating": 4.7 }
  }
}
```

## Quick Reference

### Search Amazon
```
mcp__browser__browser_execute_macro({ id: "amazon_search", params: { query: "..." }, tabTarget: ... })
```

### Apply Filter
```
mcp__browser__browser_execute_macro({ id: "amazon_apply_filter", params: { filterType: "price", value: "under-50" }, tabTarget: ... })
```

### Extract Products
```
mcp__browser__browser_execute_macro({ id: "amazon_get_listing_products", tabTarget: ... })
```

### Get Product Details
```
mcp__browser__browser_execute_macro({ id: "amazon_get_product_info", tabTarget: ... })
```

### Ask Rufus
```
mcp__browser__browser_execute_macro({ id: "amazon_ask_rufus", params: { question: "..." }, tabTarget: ... })
```

## Remember

- ✅ Use site-specific macros: Amazon (17), Google Shopping (12), Walmart (5)
- ✅ Create separate tabs for multi-site comparison (preserve tab IDs!)
- ✅ Always return tab metadata for context preservation
- ✅ Clean interruptions before main operations
- ✅ Use Rufus AI for Amazon recommendations when available
- ✅ Analyze reviews by topic for deeper insights
- ✅ Compare prices across sites when requested
- ✅ Apply site-specific sorting/filtering using appropriate macros
- ✅ Report all macros used in response
- ✅ For other e-commerce sites, use universal macros or direct tools

**Start immediately**: Detect e-commerce site → Use site-specific macros → Execute workflow → Return results with tab metadata
