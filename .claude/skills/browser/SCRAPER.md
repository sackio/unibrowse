# Scraper Module

## Routing Context

The main browser skill routes to this module when the user requests:
- **Trigger keywords**: "scrape", "extract", "data", "table", "pagination", "export", "csv", "json", "infinite scroll", "articles", "products", "list"
- **Task patterns**: Data extraction, table parsing, multi-page aggregation, export to files
- **Examples**:
  - "Scrape all products from this page and export to CSV"
  - "Extract the table data and save to JSON"
  - "Scrape all pages with pagination and aggregate the results"
  - "Extract article content including metadata and images"

**What this module provides**: Step-by-step instructions for structured data extraction, pagination handling, infinite scroll aggregation, and export to JSON/CSV files.

## Available Macros

### Extraction Macros

#### `extract_table_data`
- **Purpose**: Extract all tables from the page
- **Parameters**: None
- **Returns**: Array of tables with headers and rows
- **When to use**: Pages with HTML tables or data grids

#### `extract_main_content`
- **Purpose**: Extract main article/content from the page
- **Parameters**: None
- **Returns**: Title, body, metadata (author, date, description)
- **When to use**: Blog posts, news articles, documentation pages

#### `get_page_outline`
- **Purpose**: Extract page structure (headings, sections)
- **Parameters**: None
- **Returns**: Hierarchical outline with h1, h2, h3, etc.
- **When to use**: Understanding page structure or extracting navigation

#### `extract_links`
- **Purpose**: Extract all links from the page
- **Parameters**: `selector` (optional CSS selector to filter links)
- **Returns**: Array of links with text and href
- **When to use**: Collecting URLs for further scraping or analysis

#### `extract_images`
- **Purpose**: Extract all images from the page
- **Parameters**: `selector` (optional CSS selector to filter images)
- **Returns**: Array of images with src, alt, dimensions
- **When to use**: Image collection, gallery extraction

#### `get_page_metadata`
- **Purpose**: Extract metadata (title, description, Open Graph, schema.org)
- **Parameters**: None
- **Returns**: Complete metadata object (title, description, author, publishedDate, etc.)
- **When to use**: SEO analysis, article metadata extraction

### Navigation Macros

#### `detect_pagination`
- **Purpose**: Detect pagination controls on the page
- **Parameters**: None
- **Returns**: Next button ref, previous button ref, page numbers, total pages
- **When to use**: Multi-page scraping with page numbers or next/previous buttons

#### `detect_infinite_scroll`
- **Purpose**: Detect if the page uses infinite scroll
- **Parameters**: None
- **Returns**: Boolean (isInfiniteScroll) + scroll container selector
- **When to use**: Pages that load more content as you scroll down

### Analysis Macros

#### `query_dom`
- **Purpose**: Query DOM with CSS selector
- **Parameters**: `selector` (required), `limit` (optional)
- **Returns**: Array of matching elements with text, attributes, refs
- **When to use**: Custom extraction when specialized macros don't fit

#### `get_interactive_elements`
- **Purpose**: Get all interactive elements (buttons, links, inputs)
- **Parameters**: None
- **Returns**: Interactive elements with selectors and types
- **When to use**: Finding navigation elements or action triggers

## Execution Workflows

### Workflow 1: Simple Table Extraction

**When to use**: Pages with HTML tables or data grids that you want to export to CSV/JSON.

**Instructions for main conversation:**

1. **Create and label scraping tab**:
   ```
   Call: mcp__browser__browser_create_tab({ url: "https://example.com/data" })
   Store the returned tabId from result.content.tabId
   Example: If result is { content: { tabId: 123 } }, store scrapingTab = 123

   Call: mcp__browser__browser_set_tab_label({ tabTarget: 123, label: "scraping" })
   ```

2. **Clean interruptions (cookie consents, popups)**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "dismiss_interruptions",
     tabTarget: scrapingTab
   })
   ```

3. **Extract all tables**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "extract_table_data",
     tabTarget: scrapingTab
   })

   Store tables = result.content.tables
   Example: tables = [
     { headers: ["Name", "Price", "Quantity"], rows: [[...], [...]] },
     { headers: ["Product", "Rating"], rows: [[...]] }
   ]
   ```

4. **Convert to structured format**:
   ```
   For each table in tables:
     Structure table as:
     {
       headers: table.headers,
       rows: table.rows
     }
   ```

5. **Export to CSV**:
   ```
   Convert structured data to CSV format:
   - First row: headers joined by commas
   - Subsequent rows: values joined by commas (escape quotes and commas)

   Call: Write({
     file_path: "/tmp/scraped-data.csv",
     content: csvContent
   })
   ```

6. **Return results with export path**:
   ```
   Return to user:
   {
     tabId: scrapingTab,
     label: "scraping",
     url: "https://example.com/data",
     method: "macro",
     macroUsed: "extract_table_data",
     data: {
       tablesFound: tables.length,
       totalRows: sum of all rows across all tables,
       exportPath: "/tmp/scraped-data.csv"
     }
   }
   ```

**Expected result**: All tables extracted, converted to CSV, and saved to /tmp/scraped-data.csv.

### Workflow 2: Pagination Handling

**When to use**: Multi-page data (product listings, search results) with page numbers or next/previous buttons.

**Instructions for main conversation:**

1. **Create tab and navigate to first page**:
   ```
   Call: mcp__browser__browser_create_tab({ url: "https://example.com/products?page=1" })
   Store tabId as paginationTab = result.content.tabId

   Call: mcp__browser__browser_set_tab_label({ tabTarget: paginationTab, label: "pagination-scraping" })
   ```

2. **Detect pagination controls**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "detect_pagination",
     tabTarget: paginationTab
   })

   Store pagination = result.content
   Example: {
     hasNextPage: true,
     nextButtonRef: "ref-123",
     totalPages: 10,
     currentPage: 1
   }
   ```

3. **Initialize aggregation tracking**:
   ```
   Initialize:
   - allData = [] (empty array for aggregated data)
   - currentPage = 1
   - maxPages = 10 (or user-specified limit)
   ```

4. **Loop through pages (repeat until maxPages or no next page)**:
   ```
   While currentPage <= maxPages AND pagination.hasNextPage:

     a. Extract data from current page:
        Call: mcp__browser__browser_execute_macro({
          id: "extract_table_data",  # or appropriate extraction macro
          tabTarget: paginationTab
        })
        Store pageData = result.content

     b. Add to aggregated data:
        allData = allData + pageData.rows

     c. Navigate to next page:
        Call: mcp__browser__browser_click({
          element: "Next page button",
          ref: pagination.nextButtonRef,
          tabTarget: paginationTab
        })

     d. Wait for page to load:
        Call: mcp__browser__browser_wait({ time: 2, tabTarget: paginationTab })

     e. Re-detect pagination for next iteration:
        Call: mcp__browser__browser_execute_macro({
          id: "detect_pagination",
          tabTarget: paginationTab
        })
        Update pagination = result.content

     f. Increment currentPage counter
   ```

5. **Deduplicate collected data**:
   ```
   Remove duplicates from allData:
   - Create a Set to track seen items
   - Filter allData to keep only unique items (based on JSON stringified comparison)

   Store uniqueData = deduplicated array
   ```

6. **Export to JSON**:
   ```
   Call: Write({
     file_path: "/tmp/scraped-data.json",
     content: JSON.stringify(uniqueData, null, 2)
   })
   ```

7. **Return results**:
   ```
   Return to user:
   {
     tabId: paginationTab,
     label: "pagination-scraping",
     url: "https://example.com/products",
     method: "macro",
     macroUsed: "detect_pagination",
     data: {
       pagesScraped: currentPage - 1,
       totalItems: allData.length,
       uniqueItems: uniqueData.length,
       exportPath: "/tmp/scraped-data.json"
     }
   }
   ```

**Expected result**: Data from all pages aggregated, deduplicated, and exported to JSON file with progress report.

### Workflow 3: Infinite Scroll Aggregation

**When to use**: Pages that load more content as you scroll down (social media feeds, product galleries).

**Instructions for main conversation:**

1. **Create tab and navigate**:
   ```
   Call: mcp__browser__browser_create_tab({ url: "https://example.com/feed" })
   Store tabId as scrollTab = result.content.tabId

   Call: mcp__browser__browser_set_tab_label({ tabTarget: scrollTab, label: "infinite-scroll" })
   ```

2. **Detect infinite scroll**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "detect_infinite_scroll",
     tabTarget: scrollTab
   })

   Store scrollInfo = result.content
   Example: { isInfiniteScroll: true, scrollContainer: "body" }

   If NOT scrollInfo.isInfiniteScroll:
     Return error: "Page does not use infinite scroll"
   ```

3. **Initialize scroll tracking**:
   ```
   Initialize:
   - allItems = [] (aggregated items)
   - previousCount = 0
   - stableCount = 0 (counter for unchanged item count)
   - maxScrolls = 50 (safety limit)
   - scrollAttempts = 0
   ```

4. **Scroll and extract loop (repeat until stable or maxScrolls)**:
   ```
   While scrollAttempts < maxScrolls AND stableCount < 3:

     a. Extract current items (adjust selector as needed):
        Call: mcp__browser__browser_query_dom({
          selector: ".product-item",  # Adjust to match page structure
          tabTarget: scrollTab
        })
        Store items = result.content.elements
        currentCount = items.length

     b. Check if new items loaded:
        If currentCount == previousCount:
          stableCount++  # No new items, increment stable counter
        Else:
          stableCount = 0  # New items found, reset stable counter
          previousCount = currentCount

     c. Scroll down:
        Call: mcp__browser__browser_scroll({
          y: 1000,  # Scroll 1000px down
          tabTarget: scrollTab
        })

     d. Wait for content to load:
        Call: mcp__browser__browser_wait({ time: 2, tabTarget: scrollTab })

     e. Increment scrollAttempts
   ```

5. **Extract final data after scrolling complete**:
   ```
   Call: mcp__browser__browser_query_dom({
     selector: ".product-item",  # Same selector as in loop
     tabTarget: scrollTab
   })

   Store finalItems = result.content.elements
   ```

6. **Parse and structure data**:
   ```
   For each item in finalItems:
     Extract relevant fields:
     {
       text: item.text,
       href: item.href,
       ... (additional attributes as needed)
     }

   Store structuredData = array of parsed items
   ```

7. **Deduplicate**:
   ```
   Remove duplicates from structuredData (same logic as Workflow 2 step 5)
   Store uniqueData = deduplicated array
   ```

8. **Export to JSON**:
   ```
   Call: Write({
     file_path: "/tmp/scraped-data.json",
     content: JSON.stringify(uniqueData, null, 2)
   })
   ```

9. **Return results**:
   ```
   Return to user:
   {
     tabId: scrollTab,
     label: "infinite-scroll",
     url: "https://example.com/feed",
     method: "infinite-scroll",
     data: {
       scrollAttempts: scrollAttempts,
       itemsFound: uniqueData.length,
       exportPath: "/tmp/scraped-data.json"
     }
   }
   ```

**Expected result**: All items loaded via infinite scroll are aggregated, deduplicated, and exported to JSON file.

### Workflow 4: Article/Content Extraction

**When to use**: Blog posts, news articles, documentation pages where you want title, body, metadata, and images.

**Instructions for main conversation:**

1. **Create tab and navigate**:
   ```
   Call: mcp__browser__browser_create_tab({ url: "https://example.com/article" })
   Store tabId as articleTab = result.content.tabId

   Call: mcp__browser__browser_set_tab_label({ tabTarget: articleTab, label: "article-extraction" })
   ```

2. **Extract page metadata**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "get_page_metadata",
     tabTarget: articleTab
   })

   Store metadata = result.content
   Example: {
     title: "Article Title",
     description: "Article description",
     author: "John Doe",
     publishedDate: "2025-01-15"
   }
   ```

3. **Extract main content**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "extract_main_content",
     tabTarget: articleTab
   })

   Store content = result.content
   Example: {
     title: "Article Title",
     body: "Full article text...",
     wordCount: 1500
   }
   ```

4. **Extract images from article**:
   ```
   Call: mcp__browser__browser_execute_macro({
     id: "extract_images",
     params: { selector: "article img" },  # Filter to article images only
     tabTarget: articleTab
   })

   Store images = result.content.images
   Example: [
     { src: "https://example.com/img1.jpg", alt: "Image 1" },
     { src: "https://example.com/img2.jpg", alt: "Image 2" }
   ]
   ```

5. **Structure article data**:
   ```
   Create article object:
   {
     title: metadata.title,
     description: metadata.description,
     author: metadata.author,
     publishedDate: metadata.publishedDate,
     body: content.body,
     images: images.map(img => img.src),  # Extract only image URLs
     url: "https://example.com/article"
   }
   ```

6. **Export to JSON**:
   ```
   Call: Write({
     file_path: "/tmp/article.json",
     content: JSON.stringify(article, null, 2)
   })
   ```

7. **Return results**:
   ```
   Return to user:
   {
     tabId: articleTab,
     label: "article-extraction",
     url: "https://example.com/article",
     method: "macro",
     macroUsed: "extract_main_content",
     data: {
       title: article.title,
       wordCount: article.body.split(/\s+/).length,
       imagesCount: article.images.length,
       exportPath: "/tmp/article.json"
     }
   }
   ```

**Expected result**: Complete article data (metadata, content, images) extracted and saved to JSON file.

### Workflow 5: Multi-Site Aggregation

**When to use**: Collecting data from multiple websites and combining into a single dataset.

**Instructions for main conversation:**

1. **Create tabs for multiple sites**:
   ```
   Define URLs to scrape:
   urls = [
     "https://site1.com/products",
     "https://site2.com/products",
     "https://site3.com/products"
   ]

   For each url in urls:
     Call: mcp__browser__browser_create_tab({ url: url })
     Store tabId from result.content.tabId

     Call: mcp__browser__browser_set_tab_label({
       tabTarget: tabId,
       label: "scraping-{index}"  # scraping-1, scraping-2, etc.
     })

     Store tab info: { tabId: tabId, url: url, label: "scraping-{index}" }

   Store all tab info in tabs array
   ```

2. **Extract data from all sites (sequentially for simplicity)**:
   ```
   For each tab in tabs:

     a. Clean interruptions:
        Call: mcp__browser__browser_execute_macro({
          id: "dismiss_interruptions",
          tabTarget: tab.tabId
        })

     b. Extract data (adjust macro as needed):
        Call: mcp__browser__browser_execute_macro({
          id: "extract_table_data",  # or appropriate extraction macro
          tabTarget: tab.tabId
        })
        Store data = result.content

     c. Add to results:
        results.push({
          site: tab.url,
          data: data
        })
   ```

3. **Aggregate all data**:
   ```
   Flatten all results:
   aggregated = []
   For each result in results:
     For each table in result.data.tables:
       For each row in table.rows:
         aggregated.push(row)
   ```

4. **Deduplicate**:
   ```
   Remove duplicates from aggregated data (same logic as Workflow 2 step 5)
   Store uniqueData = deduplicated array
   ```

5. **Export to JSON**:
   ```
   Call: Write({
     file_path: "/tmp/multi-site-data.json",
     content: JSON.stringify({
       sites: results.map(r => r.site),
       totalItems: aggregated.length,
       uniqueItems: uniqueData.length,
       data: uniqueData
     }, null, 2)
   })
   ```

6. **Return results**:
   ```
   Return to user:
   {
     tabs: tabs.map(t => ({ tabId: t.tabId, label: t.label, url: t.url })),
     data: {
       sitesScraped: urls.length,
       totalItems: aggregated.length,
       uniqueItems: uniqueData.length,
       exportPath: "/tmp/multi-site-data.json"
     }
   }
   ```

**Expected result**: Data from multiple sites aggregated, deduplicated, and exported to a single JSON file with source tracking.

## Token Conservation

### Rule 1: Use Extraction Macros Instead of browser_snapshot

**❌ DON'T**:
```
Call: mcp__browser__browser_snapshot({ tabTarget: scrapingTab })
# Returns full ARIA tree - wastes massive context
```

**✅ DO**:
```
Call: mcp__browser__browser_execute_macro({
  id: "extract_table_data",
  tabTarget: scrapingTab
})
# Returns only table data - saves context
```

### Rule 2: Always Truncate Text Extraction

**ALWAYS use maxLength**:
```
Call: mcp__browser__browser_get_visible_text({
  maxLength: 3000,
  tabTarget: scrapingTab
})
# Limits to 3000 characters instead of returning full page
```

### Rule 3: Clean Interruptions Before Extracting

**Clean popups/cookie consents first**:
```
Call: mcp__browser__browser_execute_macro({
  id: "dismiss_interruptions",
  tabTarget: scrapingTab
})

Call: mcp__browser__browser_execute_macro({
  id: "smart_cookie_consent",
  tabTarget: scrapingTab
})

# THEN extract data
```

### Rule 4: Use Targeted Selectors with Limits

**❌ DON'T**:
```
Call: mcp__browser__browser_query_dom({
  selector: "*",  # Returns everything
  tabTarget: scrapingTab
})
```

**✅ DO**:
```
Call: mcp__browser__browser_query_dom({
  selector: ".product-item",  # Specific selector
  limit: 50,  # Limit results
  tabTarget: scrapingTab
})
```

## Data Processing Helpers

### Deduplication Logic

**JavaScript reference** (for understanding):
```javascript
function deduplicateData(data) {
  const seen = new Set();
  return data.filter(item => {
    const key = JSON.stringify(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
```

**What to do**: Create a Set to track JSON-stringified items, filter data to keep only unique items.

### CSV Conversion Logic

**JavaScript reference** (for understanding):
```javascript
function convertToCSV(data) {
  if (data.length === 0) return "";

  const headers = Object.keys(data[0]);

  const csv = [
    headers.join(","), // Header row
    ...data.map(row =>
      headers.map(h => JSON.stringify(row[h] || "")).join(",")
    )
  ].join("\n");

  return csv;
}
```

**What to do**:
1. Get headers from first data object
2. Create header row (comma-separated)
3. For each data row, create comma-separated values (with JSON.stringify for escaping)
4. Join all rows with newlines

### JSON Beautification

**What to do**: Use `JSON.stringify(data, null, 2)` for pretty-printed JSON with 2-space indentation.

## Error Handling

### Common Error 1: "No data found"

**Solution**:
```
Wait for page to fully load:
Call: mcp__browser__browser_wait({ time: 3, tabTarget: scrapingTab })

Try alternative selectors:
Call: mcp__browser__browser_query_dom({
  selector: ".product",  # Try different selectors
  tabTarget: scrapingTab
})

If still no elements:
  Fall back to text extraction:
  Call: mcp__browser__browser_get_visible_text({
    maxLength: 5000,
    tabTarget: scrapingTab
  })
  # Parse text manually
```

### Common Error 2: "Pagination not detected"

**Solution**:
```
Use generic next button detection:
Call: mcp__browser__browser_execute_macro({
  id: "find_element_by_description",
  params: { description: "next page button" },
  tabTarget: scrapingTab
})

If nextButton.content.ref exists:
  Call: mcp__browser__browser_click({
    element: "Next button",
    ref: nextButton.content.ref,
    tabTarget: scrapingTab
  })
```

### Common Error 3: "Infinite scroll not loading"

**Solution**:
```
Increase wait time:
Call: mcp__browser__browser_scroll({ y: 1000, tabTarget: scrapingTab })
Call: mcp__browser__browser_wait({ time: 5, tabTarget: scrapingTab })  # Longer wait

Check if at bottom of page:
Call: mcp__browser__browser_evaluate({
  expression: "window.innerHeight + window.scrollY >= document.body.offsetHeight",
  tabTarget: scrapingTab
})

If result.content.result is true:
  # Reached end of page, stop scrolling
```

### Common Error 4: "Export file too large"

**Solution**:
```
Split into multiple files:

chunkSize = 1000
For i from 0 to data.length by chunkSize:
  chunk = data.slice(i, i + chunkSize)

  Call: Write({
    file_path: "/tmp/scraped-data-part{i/chunkSize + 1}.json",
    content: JSON.stringify(chunk, null, 2)
  })
```

## Return Formats

### Single-Page Extraction

```json
{
  "tabId": 123,
  "label": "scraping",
  "url": "https://example.com/data",
  "method": "macro",
  "macroUsed": "extract_table_data",
  "data": {
    "tablesFound": 3,
    "totalRows": 150,
    "exportFormat": "csv",
    "exportPath": "/tmp/scraped-data.csv"
  }
}
```

### Multi-Page Extraction (Pagination)

```json
{
  "tabId": 123,
  "label": "pagination-scraping",
  "url": "https://example.com/products",
  "method": "macro",
  "macroUsed": "detect_pagination",
  "data": {
    "pagesScraped": 10,
    "totalItems": 500,
    "uniqueItems": 485,
    "exportFormat": "json",
    "exportPath": "/tmp/scraped-data.json"
  }
}
```

### Multi-Site Aggregation

```json
{
  "tabs": [
    { "tabId": 123, "label": "scraping-1", "url": "https://site1.com" },
    { "tabId": 456, "label": "scraping-2", "url": "https://site2.com" },
    { "tabId": 789, "label": "scraping-3", "url": "https://site3.com" }
  ],
  "data": {
    "sitesScraped": 3,
    "totalItems": 1500,
    "uniqueItems": 1200,
    "exportPath": "/tmp/multi-site-data.json"
  }
}
```

## Quick Reference

### Extract Table
```
Call: mcp__browser__browser_execute_macro({
  id: "extract_table_data",
  tabTarget: scrapingTab
})
```

### Extract Main Content
```
Call: mcp__browser__browser_execute_macro({
  id: "extract_main_content",
  tabTarget: scrapingTab
})
```

### Detect Pagination
```
Call: mcp__browser__browser_execute_macro({
  id: "detect_pagination",
  tabTarget: scrapingTab
})
```

### Detect Infinite Scroll
```
Call: mcp__browser__browser_execute_macro({
  id: "detect_infinite_scroll",
  tabTarget: scrapingTab
})
```

### Query DOM with Selector
```
Call: mcp__browser__browser_query_dom({
  selector: ".product-item",
  limit: 50,
  tabTarget: scrapingTab
})
```

### Get Page Metadata
```
Call: mcp__browser__browser_execute_macro({
  id: "get_page_metadata",
  tabTarget: scrapingTab
})
```

### Scroll Down
```
Call: mcp__browser__browser_scroll({
  y: 1000,  # Pixels to scroll down
  tabTarget: scrapingTab
})
```

### Export to File
```
Call: Write({
  file_path: "/tmp/scraped-data.json",
  content: JSON.stringify(data, null, 2)
})
```

## Remember

- ✅ **Use extraction macros** - extract_table_data, extract_main_content (not browser_snapshot)
- ✅ **Handle pagination systematically** - detect → loop → aggregate → deduplicate
- ✅ **Deduplicate data before export** - prevent duplicate entries
- ✅ **Clean interruptions first** - dismiss popups/cookie consents before extraction
- ✅ **Export to /tmp/ files** - use /tmp/scraped-data.{json|csv}
- ✅ **Return tab IDs** - enable context preservation for multi-turn workflows
- ✅ **Use token-efficient methods** - targeted macros, truncated text, limited selectors
- ✅ **Provide progress updates** - report pages scraped, items found, export paths
- ✅ **Report export paths** - always include exportPath in return data
- ✅ **Use appropriate export format** - CSV for tables, JSON for structured data

---

**When the main skill routes to this module**: Immediately identify the data type (table, list, products, articles), select the appropriate workflow (simple extraction, pagination, infinite scroll, multi-site), execute the extraction with token-efficient macros, aggregate and deduplicate the data, export to /tmp/, and return the results with tab metadata and export path.
