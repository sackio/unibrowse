# Amazon Search Agent - Training Summary

**Training Date:** 2025-10-11
**Agent File:** `/mnt/nas/data/code/forks/browser-mcp/.claude/agents/amazon-search.md`
**Memories Stored:** 16 with tag "amazon-search"

## Training Sessions Completed

### Session 1: Basic Product Search
**Duration:** ~5 minutes
**User Demonstration:** Searched for "wireless headphones"

**Key Patterns Learned:**
- Search input selector: `input#twotabsearchtextbox`
- Submit button: `span#nav-search-submit-text > input`
- Form container: `div#nav-search > form`
- Results container: `div[data-component-type="s-search-result"]`
- Complete workflow: Navigate → Type → Submit → Wait → Extract

**Memories Stored:** 5
- Search input location and interaction
- Form submission methods
- Result container structure
- Data extraction patterns
- Complete search workflow sequence

### Session 2: Applying Filters
**Duration:** ~6 minutes
**User Demonstration:** Applied price filter ($25-$35) and rating filter (4+ stars)

**Key Patterns Learned:**
- Filter sidebar: `div#s-refinements`
- Price filters: `li[id*='p_36']` with IDs like `p_36/dynamic-picker-0`
- Rating filters: `li[id*='p_72']` with specific IDs like `p_72/1248879011`
- URL parameter patterns: `rh=p_36:2500-3500` for price, `rh=p_72/{id}` for ratings
- Filter behavior: Click → Navigate → Reload → Verify

**Memories Stored:** 5
- Price filter selectors and structure
- Rating filter selectors and behavior
- Filter application behavior (URL changes)
- Filter sidebar structure
- Complete filtering workflow sequence

### Session 3: Data Extraction
**Duration:** ~4 minutes
**Analysis:** Examined filtered results to understand data structure

**Key Patterns Learned:**
- Product titles: First long text block in each result
- Prices: `span.a-price` with format $XX.XX
- List prices: Text containing "List Price:"
- Ratings: `span.a-icon-alt` with format "X.X out of 5 stars"
- Review counts: Parenthetical numbers like "(77.6K)"
- Product links: `a.a-link-normal.s-no-outline` with relative URLs
- Delivery info: Text containing "FREE delivery" with time windows

**Memories Stored:** 6
- Title extraction pattern
- Price extraction with list price handling
- Rating and review count parsing
- Product link extraction
- Delivery information structure
- Complete extraction workflow (8-step process)

## Agent Capabilities

The trained agent can now:

1. **Search Products**
   - Navigate to Amazon.com
   - Enter search keywords
   - Submit and wait for results

2. **Apply Filters**
   - Price range filters (any predefined range)
   - Star rating filters (1-5 stars)
   - Multiple filters simultaneously
   - Verify filter application via URL

3. **Extract Data**
   - Product titles (full descriptive text)
   - Current prices and original prices
   - Star ratings (X.X out of 5 format)
   - Review counts (with K/M notation)
   - Product links (relative URLs)
   - Delivery information
   - Sponsored vs organic results

4. **Error Handling**
   - Fallback selectors for search input
   - Detection of page structure changes
   - Graceful handling of missing data fields
   - Screenshot capture for debugging

## Memory Organization

**Tagging Strategy:**
- Primary tag: `amazon-search` (all memories)
- Category tags: `selector`, `workflow`, `data-pattern`, `navigation-flow`
- Function tags: `search-input`, `filter-price`, `extraction-title`, etc.
- Status tag: `verified` (all memories verified during training)

**Memory Retrieval Patterns:**
```javascript
// Search workflow
retrieve_memory(query="amazon search input selector")
retrieve_memory(query="amazon search workflow")

// Filtering
retrieve_memory(query="amazon filter price rating")
search_by_tag(tags=["amazon-search", "filter-price"])

// Extraction
retrieve_memory(query="amazon extraction pattern")
search_by_tag(tags=["amazon-search", "extraction-pattern"])
```

## Known Limitations

1. **Amazon Business Account:** Training was conducted on an Amazon Business account, which may show business-specific UI elements
2. **Desktop Interface:** All selectors verified on desktop web interface only (not mobile)
3. **Regional Variations:** May vary slightly in different geographic regions
4. **Dynamic Content:** Some sponsored content and recommendations may have different structure
5. **Page Updates:** Amazon frequently updates their UI; selectors may need revalidation over time

## Validation Recommendations

Before deploying the agent in production:

1. **Test Basic Search:** Verify search input and result extraction work correctly
2. **Test Price Filters:** Try different price ranges, confirm URL parameters correct
3. **Test Rating Filters:** Apply star rating filters, verify results update
4. **Test Data Extraction:** Extract 10-20 products, validate all fields present
5. **Test Edge Cases:** Products without ratings, out-of-stock items, sponsored results
6. **Cross-Region Test:** If applicable, test in different Amazon marketplaces

## Future Enhancement Opportunities

1. **Additional Filters:** Brand, delivery speed, condition (new/used), deals
2. **Pagination:** Navigate through multiple result pages
3. **Sort Options:** Price low-to-high, customer reviews, newest
4. **Product Details:** Click into product pages for detailed specs
5. **Price Tracking:** Monitor price changes over time
6. **Comparison Mode:** Side-by-side comparison of multiple products
7. **Mobile Support:** Train on mobile selectors for responsive design

## Training Artifacts

- **Screenshots:** 3 screenshots captured during training (homepage, search results, filtered results)
- **Interactions:** 134+ user interactions logged and analyzed
- **Selectors Verified:** 12+ CSS selectors tested and confirmed
- **Workflows Documented:** 3 complete workflows (search, filter, extract)

## Invocation Examples

```bash
# Invoke from Claude Code CLI
claude agent amazon-search "Search for wireless headphones under $30 with 4+ stars"

# Or from another agent
Use the amazon-search agent to find the top 5 rated coffee makers under $100
```

## Maintenance Notes

- **Last Verified:** 2025-10-11
- **Amazon Layout Version:** Q4 2025 (estimated)
- **Reliability Rating:** High for search/filter, Medium-High for extraction
- **Recommended Revalidation:** Every 3-6 months or when selectors fail

## Training Methodology

This agent was trained using the **agent-trainer** meta-agent with the following process:

1. **User Demonstrations:** Real user interactions captured via browser MCP
2. **Interaction Analysis:** Click events, form submissions, navigation patterns analyzed
3. **DOM Queries:** Selectors verified via query_dom and get_visible_text
4. **Pattern Extraction:** Consistent patterns identified across multiple demonstrations
5. **Memory Storage:** Structured memories stored with comprehensive metadata
6. **Agent Generation:** Markdown configuration file generated with complete instructions
7. **Knowledge Validation:** Memory retrieval confirmed all patterns accessible

This systematic approach ensures the agent has reliable, verified knowledge of Amazon's interface and can operate autonomously while gracefully handling errors.
