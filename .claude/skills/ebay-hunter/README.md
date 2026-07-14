# Cluster Hunter Skill

**Status**: ✅ Implemented
**Version**: 1.0
**Created**: 2026-01-28

---

## Overview

Automated eBay search skill that finds bulk lots of enterprise micro desktops (Dell OptiPlex, HP ProDesk/EliteDesk, Lenovo ThinkCentre), evaluates deals based on CPU generation and cost-per-node, and sends HTML email notifications.

**Goal**: Find bulk lots of 10th Gen Intel+ or Ryzen 4000/5000+ micro desktops under $130/node, with automatic fallback to 8th/9th Gen Intel below $80/node if zero results found.

---

## Quick Start

```bash
# Basic usage
/cluster-hunter

# With custom max price
/cluster-hunter max-price=150

# With custom instant-buy threshold
/cluster-hunter instant-buy=100

# Combined parameters
/cluster-hunter max-price=140 instant-buy=105
```

---

## Files

| File | Purpose | Lines |
|------|---------|-------|
| **SKILL.md** | Complete workflow implementation with YAML frontmatter | 821 |
| **MACROS_REFERENCE.md** | Quick reference for 4 core eBay macros | 194 |
| **EXAMPLES.md** | Usage examples, output samples, filtering logic | 361 |
| **README.md** | This file - overview and quick reference | - |

---

## Features

### Search Capabilities

- **8 Search Queries**: Executes sequentially for Dell, HP, and Lenovo models
- **Server-Side Filters**: Used/Refurbished condition, $50-$400 price range
- **Client-Side Filters**: Bulk lot detection, CPU generation validation, condition checks
- **Automatic Fallback**: Searches 8th/9th Gen Intel (<$80/node) if zero 10th Gen+ results

### Deal Evaluation

- **Cost Calculation**: (Item Price + Shipping + Power Adapter Adjustment) / Quantity
- **Power Adapter Adjustment**: Adds $12/node if not included
- **Deal Tiers**:
  - 🔥 Instant Buy: <$110/node
  - ✅ Good Deal: $110-$130/node
- **Ranking Score**: Weighted by price (40%), seller rating (30%), listing type (15%), shipping (15%)

### Output

- **HTML Email**: Styled table with color-coded tiers
- **Consolidated**: Single email with ALL qualifying deals
- **Sorted**: Best deals first (by ranking score)
- **Sent to**: ben@sack.io

---

## Architecture

### Skill Type

**Standalone Skill** (not a browser skill module)

**Rationale**:
- Self-contained end-to-end workflow (search → filter → evaluate → email)
- Direct invocation with `/cluster-hunter`
- Specialized email notification and filtering logic
- Leverages existing eBay macros via browser MCP

### Macro-First Execution

**CRITICAL**: Every execution MUST start with Step 0 macro check:

```
1. browser_list_macros({ site: "ebay.com" })
2. Verify 4 core macros available:
   - ebay_search_products
   - ebay_extract_search_results
   - ebay_apply_filters
   - ebay_apply_sort
3. STOP if macros not found
```

### Workflow (6 Steps)

1. **Setup**: Load gmail tool, create eBay tab
2. **Search Loop**: Execute 8 queries, filter, evaluate (primary 10th Gen+)
3. **Fallback**: Execute 8 queries for 8th/9th Gen if zero results (<$80/node)
4. **Deduplication**: Remove duplicate itemIds, sort by score
5. **Email**: Generate HTML email, send via gmail_send
6. **Cleanup**: Close tab

---

## Target Hardware

### Accepted CPUs (Primary Search)

**Intel 10th Gen+**:
- i5-10400T, i5-10500T, i5-10600T (10th Gen)
- i5-11xxx (11th Gen)
- i5-12xxx (12th Gen)
- i5-13xxx (13th Gen)

**AMD Ryzen 4000/5000**:
- Ryzen 5 Pro 4650GE (4000 series)
- Ryzen 5 5600GE, 5650GE (5000 series)

### Accepted CPUs (Fallback Search)

**Intel 8th/9th Gen** (only if zero primary results):
- i5-8500T, i5-8600T (8th Gen)
- i5-9500T, i5-9600T (9th Gen)

**Requirement**: Cost per node must be <$80 (stricter than primary)

---

## Filtering Pipeline

### Stage 1: eBay Server-Side Filters
- Condition: Used or Refurbished (exclude "For Parts")
- Price range: $50-$400

### Stage 2: Client-Side Post-Extraction Filters
1. **Bulk Lot Detection**: Regex for "lot", "bulk", "qty", "5x", etc. (quantity > 1)
2. **CPU Generation Validation**: Accept 10th Gen+, reject 6th-9th Gen
3. **Condition Validation**: Exclude "for parts", "as-is", "bios locked", "no power"
4. **Cost Calculation**: Include shipping and power adapter adjustment
5. **Price Filter**: Cost per node ≤ $130 (primary) or <$80 (fallback)

### Stage 3: Deduplication
- Deduplicate by itemId (same listing can appear in multiple searches)

---

## Dependencies

### MCP Servers

- **unibrowse**: Browser automation with 18 eBay macros
- **google-gmail**: Email sending via gmail_send tool

### Required Macros

- `ebay_search_products` - Search with query
- `ebay_extract_search_results` - Extract products with price, shipping, seller
- `ebay_apply_filters` - Apply condition and price filters
- `ebay_apply_sort` - Sort by price

**Full list**: See `docs/macros/EBAY_MACROS.md` for all 18 eBay macros

---

## Performance

**Execution Time**:
- Per search query: 5-10 seconds
- 8 queries + delays: 1-2 minutes
- Fallback (if needed): +1-2 minutes
- **Total**: 3-5 minutes typical, 10-15 minutes with fallback

**Token Usage**:
- Per query: 2,000-5,000 tokens
- 8 queries: 20,000-40,000 tokens
- Email generation: 5,000-10,000 tokens
- **Total**: ~30,000-60,000 tokens per run

**Network Requests**:
- Per query: 4 macro executions
- 8 queries: 32 macro executions
- Fallback: +32 macro executions
- **Total**: 32-64 macro executions

---

## Error Handling

- **Rate Limiting**: Pause 60 seconds, retry once, then skip to next query
- **No Results**: Continue to next query (don't fail entire workflow)
- **Email Failure**: Log results to console as fallback
- **Macro Not Found**: STOP immediately, report error

---

## Success Criteria

- ✅ Skill executes all 8 search queries without errors
- ✅ Filtering pipeline correctly identifies bulk lots with valid CPUs
- ✅ Cost-per-node calculation accurate (includes shipping and power adapter)
- ✅ Email delivered to ben@sack.io with HTML table of deals
- ✅ All URLs in email are valid and clickable
- ✅ Tab closes automatically after completion
- ✅ Automatic fallback to 8th/9th Gen if zero 10th Gen+ results
- ✅ All qualifying deals included (no artificial limit)
- ✅ Deals ranked by score (best deals first)

---

## Testing

### End-to-End Test

1. Invoke skill: `/cluster-hunter`
2. Monitor console logs for progress
3. Verify email received with HTML table
4. Spot-check 3-5 deals for accuracy (click URLs, verify pricing)
5. Verify deals sorted by score (best first)

### Edge Cases

- Zero results across all queries → Email says "No deals found"
- Rate limiting → Pauses 60 seconds and retries
- Invalid listing data → Skips listing and continues
- Email send failure → Logs results to console

---

## Future Enhancements

### Potential Improvements

- [ ] Add support for AMD Ryzen 7000 series (when available on eBay)
- [ ] Include storage size in filtering (e.g., require 256GB+ SSD)
- [ ] Add memory filtering (e.g., require 16GB+ RAM)
- [ ] Support for auction bidding (currently only Buy It Now)
- [ ] Price history tracking (avoid deals that are always available)
- [ ] Seller blacklist/whitelist
- [ ] Geographic filtering (e.g., only US sellers)
- [ ] Duplicate listing detection across sessions (avoid re-emailing same deals)

### Database Integration

For advanced features (price history, duplicate detection):
- Store extracted deals in MongoDB
- Track itemId, price, timestamp
- Compare against previous runs
- Only email NEW deals or significant price drops

---

## References

- **eBay Macros**: `docs/macros/EBAY_MACROS.md` - Full documentation
- **Browser Skill**: `.claude/skills/browser/ECOMMERCE.md` - E-commerce patterns
- **Gmail MCP**: `google-gmail` MCP server documentation
- **Implementation Plan**: See project transcript for detailed planning

---

## Changelog

### v1.0 (2026-01-28)

- ✅ Initial implementation
- ✅ 8 search queries for Dell, HP, Lenovo micro desktops
- ✅ Client-side filtering for bulk lots, CPU generation, condition
- ✅ Cost-per-node calculation with power adapter adjustment
- ✅ HTML email with styled table
- ✅ Automatic fallback to 8th/9th Gen Intel
- ✅ Deduplication and ranking by value score
- ✅ Comprehensive documentation (SKILL.md, MACROS_REFERENCE.md, EXAMPLES.md)

---

## License

Part of the unibrowse project. See project root for license information.

---

## Author

**Created by**: Claude Code (Sonnet 4.5)
**For**: Ben Sack (ben@sack.io)
**Date**: 2026-01-28
**Project**: unibrowse - Browser automation MCP server
