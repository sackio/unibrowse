# Browse Amazon Command

This command provides instructions and examples for automating Amazon.com using the browser MCP and stored macros.

## Prerequisites

1. **unibrowse Connection**: Ensure you have the unibrowse extension installed and connected to a tab
2. **Amazon Tab**: Navigate to Amazon.com in your browser
3. **Macro Storage**: All Amazon macros are stored in MongoDB and ready to use

## Available Amazon Macros (17 total)

### Navigation Macros (4)

1. **amazon_search** (ID: `7b6861cb-ead4-4360-b6c3-cb7e8c284f5d`)
   - Navigate to Amazon and submit search query with realistic typing
   - Parameters: `query` (required)
   - Success rate: 95.4%
   - Example:
     ```
     mcp__browser__browser_execute_macro(
       id="7b6861cb-ead4-4360-b6c3-cb7e8c284f5d",
       params={"query": "wireless headphones"}
     )
     ```

2. **amazon_click_product** (ID: `3d7c6cfd-b4ac-4a44-9f5c-4e1b5bcf5fcc`)
   - Click on product by position or title match (filters out sponsored by default)
   - Parameters: `position` OR `titleMatch`
   - Success rate: 98.9%
   - Example:
     ```
     mcp__browser__browser_execute_macro(
       id="3d7c6cfd-b4ac-4a44-9f5c-4e1b5bcf5fcc",
       params={"position": 1}
     )
     ```

3. **amazon_navigate_pages** (ID: `51652c7f-af00-460e-b072-483720ac1a78`)
   - Navigate through result pages (next/previous/specific page)
   - Parameters: `action` (next/previous/page), `pageNumber` (optional)
   - Success rate: 100%

4. **amazon_view_all_reviews** (ID: `948c2fa7-bd73-4a53-8774-2506ef55dfea`)
   - Navigate to full reviews page with optional star filter
   - Parameters: `filterStars` (optional, 1-5)
   - Success rate: 100%

### Extraction Macros (7)

5. **amazon_get_product_info** (ID: `80fb5801-e0f9-42ed-966a-07d1c4e33e13`)
   - Extract comprehensive product details (price, rating, availability, variations)
   - Parameters: `includeDescription`, `includeFeatures`, `includeSpecs`, `includeAboutItem` (all optional)
   - Success rate: 100%
   - Example:
     ```
     mcp__browser__browser_execute_macro(
       id="80fb5801-e0f9-42ed-966a-07d1c4e33e13",
       params={"includeDescription": true, "includeFeatures": true}
     )
     ```

6. **amazon_get_listing_products** (ID: `1d0949a5-f1be-4150-ae0f-de62af10a17a`)
   - Extract all products from search/listing page with filters and pagination
   - Parameters: `includeSponsored` (optional, default: true)
   - Success rate: 100%

7. **amazon_get_related_products** (ID: `fa3da029-377b-4808-b9d7-ed9b6b677c04`)
   - Extract recommendations and "frequently bought together" items
   - Success rate: 95.7%

8. **amazon_extract_search_results** (ID: `68218a0b-f28d-4e46-b519-96089b54adb2`)
   - Extract products from search results with ASIN and delivery info
   - Parameters: `includeSponsored` (optional, default: true)
   - Success rate: 100%

9. **amazon_get_available_filters** (ID: `56bd405b-e0de-4f46-ac4c-276f0e185803`)
   - Get all available filters and sort options
   - Success rate: 100%

10. **amazon_get_product_images** (ID: `9aebf2df-6c3c-4304-b6d3-d58aa6ee5420`)
    - Extract product gallery images (standard or high-res)
    - Parameters: `highRes` (optional, default: false)
    - Success rate: 100%

11. **amazon_get_reviews_summary** (ID: `47916e4e-0329-41ae-9414-c956e2e02bfd`)
    - Extract rating distribution and top reviews
    - Success rate: 100%

### Interaction Macros (5)

12. **amazon_ask_rufus** (ID: `e0747b62-d304-4005-9018-476d12c2493f`)
    - Ask Rufus AI assistant questions about products
    - Parameters: `question` (required)
    - Success rate: 100%
    - Example:
      ```
      mcp__browser__browser_execute_macro(
        id="e0747b62-d304-4005-9018-476d12c2493f",
        params={"question": "Which of these headphones has the best battery life?"}
      )
      ```

13. **amazon_apply_filter** (ID: `7fae7294-2070-45a8-b2c5-2ebac9fd02a6`)
    - Apply filter by category and text (brands, price, delivery, etc.)
    - Parameters: `filterCategory`, `filterText` (both required)
    - Success rate: 87.5%

14. **amazon_apply_sort** (ID: `1bee9321-ac22-4cc5-ba5d-50b40dec6680`)
    - Change sort order (price, rating, date)
    - Parameters: `sortBy` (required, e.g., 'price-asc-rank')
    - Success rate: 100%

15. **amazon_select_variation** (ID: `605b2d02-5946-4f84-b587-668185248ea2`)
    - Select product variations (size, color, style)
    - Parameters: `variationType`, `value` (both required)
    - Success rate: 100%

16. **amazon_add_to_cart** (ID: `c619ea93-d408-45b7-915f-1c3f8dc46641`)
    - Add product to cart with quantity
    - Parameters: `quantity` (optional, default: 1)
    - Success rate: 66.7%

### Search Macros (1)

17. **amazon_search_reviews** (ID: `3b5e1bf6-ceaa-46f4-b922-7938b20264d5`)
    - Search within product reviews
    - Parameters: `searchQuery` (optional, empty to clear)
    - Success rate: 100%

## Common Workflows

### 1. Search and Extract Product Details
```
# Step 1: Search for products
mcp__browser__browser_execute_macro(
  id="7b6861cb-ead4-4360-b6c3-cb7e8c284f5d",
  params={"query": "noise cancelling headphones"}
)

# Step 2: Extract search results
mcp__browser__browser_execute_macro(
  id="68218a0b-f28d-4e46-b519-96089b54adb2",
  params={"includeSponsored": false}
)

# Step 3: Click on first product
mcp__browser__browser_execute_macro(
  id="3d7c6cfd-b4ac-4a44-9f5c-4e1b5bcf5fcc",
  params={"position": 1}
)

# Step 4: Get detailed product information
mcp__browser__browser_execute_macro(
  id="80fb5801-e0f9-42ed-966a-07d1c4e33e13",
  params={"includeDescription": true, "includeFeatures": true}
)
```

### 2. Compare Products with Rufus AI
```
# After extracting search results, ask Rufus to compare
mcp__browser__browser_execute_macro(
  id="e0747b62-d304-4005-9018-476d12c2493f",
  params={"question": "Compare the first three products by battery life and comfort"}
)
```

### 3. Filter and Sort Search Results
```
# Apply brand filter
mcp__browser__browser_execute_macro(
  id="7fae7294-2070-45a8-b2c5-2ebac9fd02a6",
  params={"filterCategory": "Brand", "filterText": "Sony"}
)

# Sort by price (low to high)
mcp__browser__browser_execute_macro(
  id="1bee9321-ac22-4cc5-ba5d-50b40dec6680",
  params={"sortBy": "price-asc-rank"}
)
```

### 4. Analyze Product Reviews
```
# Navigate to product reviews
mcp__browser__browser_execute_macro(
  id="948c2fa7-bd73-4a53-8774-2506ef55dfea",
  params={"filterStars": 5}
)

# Get reviews summary
mcp__browser__browser_execute_macro(
  id="47916e4e-0329-41ae-9414-c956e2e02bfd",
  params={}
)

# Search within reviews
mcp__browser__browser_execute_macro(
  id="3b5e1bf6-ceaa-46f4-b922-7938b20264d5",
  params={"searchQuery": "battery life"}
)
```

## Tips and Best Practices

1. **Human-like Interactions**: All macros use realistic typing delays, scrolling, and randomized click coordinates to avoid detection

2. **Error Handling**: Macros return detailed error messages. If a macro fails, check:
   - You're on the correct Amazon page
   - Elements are loaded (some pages take time)
   - Your search query or parameters are valid

3. **Rate Limiting**: Wait a few seconds between macro executions to avoid triggering Amazon's bot detection

4. **Tab Management**: Use `tabTarget` parameter to specify which browser tab to use if you have multiple tabs open

5. **Listing Macros**: To list all available Amazon macros:
   ```
   mcp__browser__browser_list_macros(site="amazon.com")
   ```

6. **Getting Macro Details**: To see full details of a specific macro:
   ```
   mcp__browser__browser_list_macros(site="amazon.com", search="search")
   ```

## Troubleshooting

### Macro Execution Fails
- Ensure the browser tab is attached: `mcp__browser__browser_list_attached_tabs()`
- Take a snapshot to see the current page state: `mcp__browser__browser_snapshot()`
- Verify you're on the correct Amazon page (search results, product page, etc.)

### Product Not Found
- Some macros filter out sponsored results by default
- Try increasing the `position` parameter or using `titleMatch` instead
- Check if the product is still available on the page

### Extraction Returns Empty Data
- The page might still be loading - wait a few seconds
- Amazon's layout may have changed - macro might need updating
- Try taking a screenshot to verify the page is loaded: `mcp__browser__browser_screenshot()`

## Additional Resources

- Full macro list: `/tmp/amazon_google_shopping_macros.md`
- unibrowse documentation: `tests/README.md`
- Macro source code: `backups/macros_latest.json`
