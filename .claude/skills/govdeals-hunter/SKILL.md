# GovDeals Hunter - Government Surplus Compute Cluster Procurement

**Mission:** Hunt for high-value compute hardware from government surplus auctions within 50 miles of Groton, MA (01450).

**Strategy:** Government agencies sell surplus equipment at deep discounts. Electronics & IT equipment often includes enterprise-grade servers, workstations, and networking gear.

**Hardware Targets:**
1. **Enterprise Workstations**: Dell OptiPlex, HP ProDesk, Lenovo ThinkCentre (10th gen Intel or newer)
2. **Small Servers**: Dell PowerEdge, HP ProLiant (tower/small form factor)
3. **Networking Equipment**: Enterprise switches, routers, access points
4. **Storage**: NAS devices, SAN equipment, enterprise drives

---

## 🎯 Search Parameters

**Location:** Zip Code 01450 (Groton, MA)
**Radius:** 50 miles
**Primary Category:** Electronics & IT Equipment
**Target CPUs:** Intel 10th gen+ (i5-10500, i7-10700, Xeon E-2200 series)
**Form Factors:** SFF towers, mini PCs, 1U/2U servers

---

## 📋 Workflow

### Phase 1: Macro Check (MANDATORY)
```javascript
// Verify GovDeals macros are available
Call: browser_list_macros({ site: "govdeals.com" })
```

**Required macros:**
- `govdeals_location_search` (CRITICAL)
- `govdeals_extract_search_results` (CRITICAL)
- `govdeals_extract_listing_details` (CRITICAL)
- `govdeals_apply_category_filter` (IMPORTANT)

If ANY core macro is missing, **ABORT** and report error.

---

### Phase 2: Execute Location Search

**Action:** Search GovDeals for electronics within 50 miles of 01450

```javascript
await browser_execute_macro({
  id: "govdeals_location_search",
  params: {
    zipCode: "01450",
    distance: 50,
    category: "Electronics"
  }
});

await browser_wait({ time: 2 });

const results = await browser_execute_macro({
  id: "govdeals_extract_search_results",
  params: {
    limit: 60,
    includeImages: true
  }
});
```

---

### Phase 3: Filter & Analyze Results

**Target Keywords:**
- Dell OptiPlex, HP ProDesk, HP EliteDesk, Lenovo ThinkCentre
- PowerEdge, ProLiant (servers)
- i5, i7, i9, Xeon (CPUs)
- 16GB, 32GB, 64GB (RAM indicators)
- SFF, Mini, Tower, 1U, 2U (form factors)

**Extract for each promising listing:**
```javascript
await browser_navigate({ url: listing.itemUrl });
await browser_wait({ time: 2 });

const details = await browser_execute_macro({
  id: "govdeals_extract_listing_details",
  params: {
    extractSpecs: true,
    extractImages: true,
    extractBidHistory: false
  }
});
```

---

### Phase 4: Calculate True Cost

**Government Auction Pricing Logic:**

```python
# 1. Base Price Analysis
if listing.currentBid:
    Base_Price = listing.currentBid
elif listing.minimumBid:
    Base_Price = listing.minimumBid
else:
    Base_Price = 0  # No bids yet (opportunity!)

# 2. Distance Factor (Pickup Required)
Distance = listing.distance  # in miles
if Distance <= 25:
    Distance_Factor = 0  # Local pickup, minimal cost
elif Distance <= 50:
    Distance_Factor = 25  # Gas + time (~1 hour round trip)
else:
    Distance_Factor = 50  # Longer trip

# 3. Condition Assessment
if "No RAM" in listing.description or "No SSD" in listing.description:
    Hardware_Gap = 95  # RAM ($65) + SSD ($30)
elif "No HDD" in listing.description or "No Storage" in listing.description:
    Hardware_Gap = 30  # SSD only
elif "8GB" in listing.description:
    Hardware_Gap = 65  # Need RAM upgrade
else:
    Hardware_Gap = 0  # Complete system

# 4. Buyer's Premium (GovDeals charges this)
Buyers_Premium = Base_Price * 0.10  # 10% typical

# 5. Government Pickup Factor
# Must pickup during business hours (M-F, 9-5)
# Factor in time cost
Pickup_Time_Cost = 50  # 2-3 hours of time

# 6. True Cost Calculation
True_Cost = Base_Price + Buyers_Premium + Distance_Factor + Hardware_Gap + Pickup_Time_Cost
```

**Example:**
```
Dell OptiPlex 7090 SFF, i7-10700, 16GB RAM, No SSD
Current Bid: $50
Distance: 15 miles
Buyer's Premium: $5 (10%)
Distance Factor: $0 (< 25 miles)
Hardware Gap: $30 (need SSD)
Pickup Time: $50
----------------------------------------
True Cost: $135 ($16.88 per core)
```

---

### Phase 5: Risk Assessment

**Green Flags (Government Auctions):**
- ✅ Seller is state/county agency (high trust)
- ✅ Detailed photos showing asset tags
- ✅ Recent auction (equipment is current)
- ✅ Pickup location is convenient (< 25 miles)
- ✅ Clear hardware specs in description
- ✅ Multiple similar units available

**Red Flags:**
- ⚠️ "AS-IS, NO WARRANTY" (standard government language - acceptable)
- 🚨 "No Power On Test" or "Unknown Condition" (CAUTION)
- 🚨 "For Parts Only" (SKIP unless extremely cheap)
- 🚨 BIOS Locked / Asset Locked (SKIP - government locks are hard)
- 🚨 Distance > 50 miles (pickup logistics too difficult)
- 🚨 Auction ends during work hours with no proxy bid option

---

### Phase 6: Generate Report

**Email Structure:**

```html
Subject: 🏛️ GovDeals Hunter Report - [Date]

## 🎯 Top Picks (Ready to Bid)

[Table of best deals with True Cost < $200]

## ⚠️ Pickup Required
All government auctions require IN-PERSON pickup during business hours.
Plan accordingly!

## 📍 Pickup Locations
[Map of all seller locations within 50 miles]

## 💰 Bid Strategy
- Government auctions are FINAL SALE
- Bid conservatively (no returns)
- Factor in 10% buyer's premium
- Plan pickup time during business hours (M-F 9-5)

## 📅 Auction Deadlines
[Calendar events for auctions ending soon]
```

**Send to:** ben@sack.io

---

### Phase 7: Calendar Integration

**Create calendar events for:**
1. **Auction Closing Time** - 15 min before close
2. **Pickup Window** - After winning (government requires 3-5 day pickup)

```javascript
// For each top deal
await calendar_create({
  summary: `🏛️ AUCTION: ${item.title}`,
  description: `Government Auction

Seller: ${item.seller}
Location: ${item.location} (${item.distance} miles)
True Cost: $${trueCost}
Current Bid: $${item.currentBid}

🚨 Pickup Required:
- Must pickup within 3-5 days of winning
- Business hours only (M-F 9-5)
- Bring ID and payment receipt

Link: ${item.itemUrl}`,
  start: auctionCloseTime - 15min,
  end: auctionCloseTime
});
```

---

## 🔧 Best Practices

### Government Auction Specifics:
1. **Always visit pickup location first** if possible (scout it out)
2. **Bring tools** - government may require YOU to disconnect equipment
3. **Bring help** - some items are heavy (servers, UPS units)
4. **Verify pickup hours** - some agencies only allow 2-hour windows
5. **Pay immediately** - most require payment within 24-48 hours
6. **No refunds** - ALL SALES FINAL, inspect carefully

### What to Look For:
- **Asset tags** = legitimate government equipment
- **Recent surplus** = newer equipment cycles
- **Bulk lots** = government often sells 5-10 identical units
- **Decommissioned datacenters** = server equipment
- **School/university surplus** = often well-maintained

### What to Avoid:
- **Police/evidence property** = unknown condition, possible damage
- **"Various Electronics" lots** = junk/e-waste
- **No photos** = skip, can't assess condition
- **Hospital equipment** = often specialized/proprietary
- **Military surplus** = may have special security chips/locks

---

## 📊 Strike Prices (Government Surplus)

Based on typical government auction prices:

| Tier | Description | True Cost | Use Case |
|------|-------------|-----------|----------|
| 💎 **Platinum** | i7 10th gen+, 16GB+, SSD, < $150 True Cost | < $150 | Immediate buy |
| 🥇 **Gold** | i5 10th gen+, 16GB, SSD, < $200 True Cost | $150-200 | Strong candidate |
| 🥈 **Silver** | i5 10th gen+, 8GB, No SSD, < $250 True Cost | $200-250 | Consider if local |
| 🥉 **Bronze** | Bulk lots (5+), older gen, < $100/unit True Cost | < $100/unit | Bulk play |
| ⛔ **Skip** | True Cost > $250, or logistics cost > $100 | > $250 | Not worth it |

---

## 💡 Advanced Strategies

### Multi-Page Extraction
```javascript
// Get pagination info
const pagination = await browser_execute_macro({
  id: "govdeals_extract_pagination_info"
});

let allResults = [];
for (let page = 1; page <= pagination.totalPages && page <= 5; page++) {
  const pageUrl = await browser_execute_macro({
    id: "govdeals_navigate_page",
    params: { page }
  });

  await browser_navigate({ url: pageUrl.nextPageUrl });
  await browser_wait({ time: 2 });

  const results = await browser_execute_macro({
    id: "govdeals_extract_search_results",
    params: { limit: 60 }
  });

  allResults.push(...results.results);
}
```

### Price Filter
```javascript
// Only show items under $500
await browser_execute_macro({
  id: "govdeals_apply_price_filter",
  params: {
    maxPrice: 500
  }
});
```

### Sort by Ending Soon
```javascript
await browser_execute_macro({
  id: "govdeals_apply_sort",
  params: {
    sortBy: "ending_soon"
  }
});
```

---

## 📅 Recommended Schedule

**Weekly Hunt:**
- **Monday morning:** Run search, identify targets
- **Monday afternoon:** Scout pickup locations (if needed)
- **Tuesday-Thursday:** Monitor auctions, place proxy bids
- **Friday:** Pick up won items (most agencies allow Friday pickup)

**Monthly Deep Dive:**
- **First of month:** Government fiscal cycles = more surplus
- **After holidays:** Schools/agencies clean out inventory

---

## 🚨 Important Notes

1. **NO SHIPPING** - Government auctions are 99% pickup-only
2. **Business Hours Only** - Cannot pick up on weekends
3. **Payment Timing** - Must pay within 24-48 hours
4. **Pickup Deadline** - Usually 3-5 days, NO EXTENSIONS
5. **Inspection** - Some allow pre-auction inspection, ALWAYS DO THIS if possible
6. **Bulk Lots** - Government often sells 10+ identical units as one lot
7. **Competition** - Commercial resellers hunt these too, bid strategically

---

## 🎓 Example Workflow

```bash
# User invokes skill
/govdeals-hunter

# System executes:
1. ✅ Check macros (PASS)
2. 🔍 Search zip 01450, 50 miles, Electronics
3. 📊 Extract 60 results
4. 🎯 Filter for compute hardware keywords
5. 💰 Calculate True Cost for top 10
6. 📧 Generate HTML email report
7. 📅 Create calendar events for auction deadlines
8. 📍 Create calendar events for pickup windows
```

**Expected Output:**
```
Found 12 promising government auctions:
- 3 Platinum deals (< $150 True Cost)
- 5 Gold deals ($150-200 True Cost)
- 4 Silver deals ($200-250 True Cost)

Top Pick: Dell OptiPlex 7080 SFF, i7-10700, 16GB, 256GB SSD
Location: MA State Surplus, Worcester (22 miles)
Current Bid: $75 | True Cost: $142.50
Ends: Thursday, Feb 6, 2:00 PM EST

Email sent to ben@sack.io
Calendar events created (5 auctions, 5 pickup windows)
```

---

## 🔗 Resources

**GovDeals Documentation:**
- Main search: `https://www.govdeals.com/`
- Advanced search: `https://www.govdeals.com/index.cfm?fa=Main.AdvSearchResultsNew`
- Help: `https://www.govdeals.com/index.cfm?fa=Main.Help`

**Macro Reference:**
See `/mnt/nas/data/code/unibrowse/docs/macros/GOVDEALS_MACROS.md` for complete macro documentation.
