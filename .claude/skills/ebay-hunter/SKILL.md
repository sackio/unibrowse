---
name: cluster-hunter
description: Barn Cluster Hardware Hunter - Horizontally scale a Numba/VectorBT compute cluster by identifying high-value, high-thread-count nodes. Automated procurement agent for 10th gen Intel hardware on eBay with intelligent discovery of related listings and seller inventories.
argument-hint: "[optional: max-price-per-node]"
disable-model-invocation: false
---

# Barn Cluster Hardware Hunter (v2.1)

**Mission:** Horizontally scale a Numba/VectorBT compute cluster by identifying high-value, high-thread-count nodes.

**Strategy:** Universal chassis acceptance - if the price is right and the math works, the size of the box doesn't matter. Focus on 10th gen Intel (Gold Tier), accept 8th/9th gen for bulk volume, and HARD REJECT anything older. Expand search surface by mining related items and seller inventories.

**Philosophy:** Running in a barn with ample space and power allows us to overcome Mini/Micro thermal limitations through "Barn Engineering" (zip-tie a house fan to a shelf of Minis). Form factor is now a preference, not a dealbreaker.

---

## 📋 Task Tracking Strategy

**IMPORTANT**: This is a multi-step workflow. Use `TaskCreate` and `TaskUpdate` tools to track progress.

**Task Lifecycle:**
1. **Setup**: Check macros, open browser tab.
2. **Primary Search**: Gold Tier (10th gen i7/i5).
3. **Hidden Gem Search**: Acer/Fujitsu i7-10700.
4. **Bulk Lot Search**: High-volume opportunities.
5. **Discovery**: Mine related items and seller inventories for promising listings.
6. **Analysis**: Calculate "True Cost" with 2026 Barn Lab Taxes.
7. **Automation**: Send alerts (Buy It Now) or create sniper tasks (Auctions).
8. **Report**: Generate decision-ready email.
9. **Cleanup**: Close tabs.

---

## 🛠️ Step 0: Macro-First Execution (MANDATORY)

**BEFORE ANY BROWSER OPERATION**, verify required macros exist:

### Check eBay-Specific Macros
Use `mcp__unibrowse__browser_list_macros` with `site: "ebay.com"` to verify these macros exist:

**Required Macros:**
* `ebay_search_products` - Primary search
* `ebay_extract_search_results` - Result extraction
* `ebay_extract_listing_details` - Individual listing details
* `ebay_extract_related_items` - Discovery: related items
* `ebay_extract_seller_items` - Discovery: seller inventory
* `ebay_extract_recommended_items` - Discovery: eBay recommendations

If ANY core search/extraction macros are missing, **ABORT** and report critical error.

---

## 🔍 Step 1: Automated Search Strings

Execute these searches sequentially using `mcp__unibrowse__browser_execute_macro` with the `ebay_search_products` macro.

### Primary Search: The "Gold Standard"
**Search Query:**
```
(i7-10700, i5-10500, i5-10400) (ProDesk, EliteDesk, OptiPlex, ThinkCentre) -All-in-one
```

**Negative Keywords Explained:**
- `-All-in-one`: Excludes all-in-one desktops (not suitable for cluster)
- **Note:** We NO LONGER exclude Mini/Tiny/Micro - barn space allows for thermal mitigation

**Instructions:**
1. Navigate to eBay.com using `mcp__unibrowse__browser_navigate`
2. Execute the `ebay_search_products` macro with the search query above
3. Apply filters: Buy It Now + Auctions, Used/Refurbished/For Parts
4. Sort by: Ending Soonest (auctions) or Price + Shipping: Lowest First (BIN)

---

### Hidden Gem Search: The "Underdog Brands"
**Search Query:**
```
(Acer Veriton, Fujitsu Esprimo) i7-10700
```

**Why:** Acer and Fujitsu are often overlooked, leading to lower prices for identical 10th gen i7 silicon.

**Instructions:** Same as Primary Search but with this query string.

---

### Bulk Lot Search: The "Volume Play"
**Search Query:**
```
Lot (5, 10, 20) (8th, 10th) Gen Desktop
```

**Why:** Bulk lots often have better per-unit pricing. Accept 8th gen (Silver Tier) for high-volume cluster expansion.

**Instructions:**
1. Execute `ebay_search_products` macro with query above
2. Look for listings with minimum quantity of 5 units
3. Verify form factor is SFF or MT (avoid Mini/Tiny in title)

---

## 🧬 Step 2: Hardware Identification - The "Hyphen Rule"

**CRITICAL:** Always look for the number immediately following the hyphen in the CPU name.

| Pattern | Generation | Tier | Action |
|---------|------------|------|--------|
| `i7-10700`, `i9-10900`, `i5-10500`, `i5-10400` | 10th | **Gold** | ✅ PRIORITY TARGET |
| `i5-8500`, `i7-8700`, `i5-9500` | 8th/9th | **Silver** | ✅ Secondary (volume only) |
| `i7-4770`, `i5-6500`, `i7-7700` | 4th/6th/7th | **Bronze** | ❌ HARD REJECT |

**How to Apply:**
1. Extract results using `ebay_extract_search_results` macro
2. For each listing, parse the CPU name from the title
3. Use regex pattern: `i[357]-(\d{1,2})\d{3}` to extract generation number
4. Classify as Gold (gen 10), Silver (gen 8-9), or Bronze (gen ≤7)
5. **Immediately skip/reject** any Bronze tier listings

---

## 🔬 Step 3: Discovery Phase - Mine Related Listings

**NEW WORKFLOW:** When you find a promising listing (Gold/Silver tier, good price), expand the search surface.

### A. Extract Related Items
1. Navigate to the promising listing using `mcp__unibrowse__browser_navigate`
2. Execute `ebay_extract_related_items` macro with `limit: 20`
3. Apply the Hyphen Rule to all related items
4. Add Gold/Silver tier items to your candidate list

### B. Extract Seller's Other Items
1. While on the same listing page, execute `ebay_extract_seller_items` macro with `limit: 30`
2. If seller has multiple Gold tier items, flag as "PREFERRED SELLER"
3. Note: Sellers with bulk inventory often have better negotiation potential

### C. Extract Recommended Items
1. Execute `ebay_extract_recommended_items` macro with `limit: 15`
2. eBay's algorithm often surfaces similar hardware you might miss
3. Apply Hyphen Rule, add qualifying items to candidate list

**Discovery Strategy:**
- For each Primary/Hidden Gem search result in **Gold tier** → Run all 3 discovery macros
- For **Silver tier** → Only run if price is exceptional (under $80 base price)
- Track discovered items separately to avoid duplicate evaluation

---

## 🧮 Step 4: The "Barebones" Math Engine (2026 Adjustments)

**Objective:** Calculate "True Cost" by adding "Barn Lab Taxes" for missing parts.

### Penalty Table (2026 Market Rates)

| Missing Component | Cost | Notes |
|-------------------|------|-------|
| 16GB RAM (2x8GB DDR4) | +$65.00 | Required for VectorBT workloads |
| 256GB SSD | +$30.00 | Minimum viable storage |
| AC Adapter (Mini/Micro) | +$20.00 | **ALERT USER** to check if included |
| Power Cord (C13) | +$5.00 | Standard IEC C13 cable (SFF/MT only) |
| CPU (i7-10700) | +$140.00 | If listing is barebones chassis only |

### Detection Instructions

For each listing, examine the title and description (use `ebay_extract_listing_details` if needed) and check for these keywords:

**Missing RAM:**
- Keywords: "no ram", "no memory", "ram not included"
- If found: Add $65 to Barn Tax

**Missing AC Adapter (Mini/Micro only):**
- Keywords: "no adapter", "no ac", "no power supply", "no brick"
- Form Factor check: Only applies to Mini/Tiny/Micro/USFF
- If found: Add $20 to Barn Tax AND alert user in report

**Missing SSD:**
- Keywords: "no ssd", "no hdd", "no drive", "storage not included"
- If found: Add $30 to Barn Tax

**Missing Power Cord:**
- Keywords: "no cord", "no cable", "power cord not included"
- If found: Add $5 to Barn Tax

**Missing CPU:**
- Keywords: "no cpu", "no processor", "cpu not included", "barebones chassis"
- If found: Add $140 to Barn Tax

### Total Cost Calculation

1. **Calculate base price per unit:**
   - If listing is a lot: `(price + shipping) / quantity`
   - If single unit: `price + shipping`

2. **Add Barn Lab Taxes:** `True Cost = Base Price + Barn Tax`

3. **Calculate price per core** (for comparison):
   - i7-10700: 16 threads (8 cores × 2)
   - i5-10500/i5-10400: 12 threads (6 cores × 2)
   - Formula: `True Cost / thread_count`

---

## 🎯 Step 5: Target Strike Prices (Total Cost = Bid + Shipping + Barn Tax)

| Tier | CPU | Strike Price (Complete) | Auction Strategy |
|------|-----|------------------------|------------------|
| **P1: Gold** | i7-10700, i9-10900 | **$165.00** | Sniper bid at 5s remaining |
| **P2: Silver** | i5-10500, i5-10400 | **$135.00** | Only bid if Gold units are scarce |
| **P3: Bulk** | i5-8500, i5-9500, i7-8700 | **$110.00** | Ideal for high-volume node clusters |

### The "Mini Penalty" (T-Series CPUs)

**Low-Power Tax:** If the CPU ends in "T" (e.g., i7-10700**T**, i5-10500**T**), it's a low-power variant with reduced clock speeds.

**Strike Price Adjustment:**
- **Subtract $15** from the strike price for T-series CPUs
- Example: i7-10700T Gold strike price = $165 - $15 = **$150**
- Example: i5-10500T Silver strike price = $135 - $15 = **$120**

**Rationale:** T-series CPUs have 35W TDP vs 65W TDP for standard desktop CPUs, resulting in 10-15% lower performance under sustained workloads.

### Strike Price Decision Tree

For each listing after calculating True Cost:

**If Gold Tier AND True Cost ≤ $165:**
- Classification: "STRIKE PRICE HIT - IMMEDIATE ACTION"
- If Buy It Now: Send Gmail alert (see Step 7A)
- If Auction: Create Calendar sniper task (see Step 7B)

**If Silver Tier AND True Cost ≤ $135:**
- Classification: "SILVER OPPORTUNITY"
- Create Calendar sniper task (only if Gold units are scarce this week)

**If Bulk/Silver AND True Cost ≤ $110 AND Quantity ≥ 5:**
- Classification: "BULK VOLUME PLAY"
- Create Calendar sniper task

**T-Series CPU Adjustment:**
- Apply $15 penalty to strike price before comparison
- Example: i7-10700T at $155 total → Compare against $150 strike (not $165)

---

## 🏗️ Step 6: Lenient Form Factor Guidelines

**Philosophy:** In a barn with ample space and power, you can overcome thermal limitations with "Barn Engineering" (e.g., zip-tie a house fan to a shelf of Minis). Form factor is now a **preference**, not a dealbreaker.

### Hierarchy (Preferred to Acceptable)

**1. MT (Mini Tower)** - BONUS
- Largest form factor
- Best cooling (no thermal throttling)
- Easiest to maintain
- Examples: OptiPlex 3080 MT, EliteDesk 800 G6 MT
- **Priority:** If price is equal to SFF/Mini, choose Tower

**2. SFF (Small Form Factor)** - PREFERRED
- 4 RAM slots (64GB max)
- Standard PCIe power connectors
- Internal PSU (no brick needed)
- Examples: OptiPlex 3080 SFF, ProDesk 600 G6 SFF
- **Priority:** Standard choice for cluster nodes

**3. Mini/Tiny/Micro (1-Liter)** - ACCEPTABLE
- 2 RAM slots (32GB max) - sufficient for most workloads
- External power brick (check for inclusion! +$20 if missing)
- 1-liter chassis = excellent shelf density
- Examples: OptiPlex Micro, ProDesk Mini, ThinkCentre Tiny
- **Priority:** Accept at standard strike prices
- **Important:** Apply T-series CPU penalty (-$15) if applicable
- **Alert:** Always notify user to verify AC adapter inclusion

### Form Factor Detection

Extract form factor from listing title using keywords:
- `MT`, `Mini Tower`, `Tower` → Classify as MT (BONUS - prefer if price equal)
- `SFF`, `Small Form Factor` → Classify as SFF (PREFERRED)
- `Micro`, `Mini`, `Tiny`, `USFF` → Classify as Mini (ACCEPTABLE)

### AC Adapter Alert (Mini/Micro Only)

When Mini form factor detected:
1. Check title/description for: "no adapter", "no ac", "no power supply"
2. If missing: Add $20 to Barn Tax
3. **IMPORTANT:** Include prominent alert in report/email: "⚠️ VERIFY AC ADAPTER INCLUDED"

---

## 🤖 Step 7: Automation & Skills Protocol

### A. Buy It Now Listings - Send Gmail Alert

When a listing hits strike price and is Buy It Now:

1. Use `mcp__google-gmail__gmail_send` tool
2. **To:** ben@sack.io
3. **Subject:** "🚨 BUY NOW: [model] - $[savings] under strike - [listing.itemId]"
4. **Body** (HTML format):

```html
<h2>🎯 IMMEDIATE ACTION REQUIRED - BUY IT NOW</h2>

<p style="font-size: 20px; background-color: #27ae60; color: white; padding: 15px; text-align: center; border-radius: 5px; margin: 20px 0;">
  <strong>🔗 <a href="[listing.url]" style="color: white; text-decoration: underline;">CLICK HERE TO BUY ON EBAY</a></strong><br>
  Item: [listing.itemId]
</p>

<p><strong>Model:</strong> [listing.model]</p>
<p><strong>CPU:</strong> [listing.cpu] ([tier] Tier)</p>
<p><strong>True Cost:</strong> $[trueCost]</p>
<p><strong>Strike Price:</strong> $[strikePrice]</p>
<p><strong>Savings:</strong> $[strikePrice - trueCost]</p>
<p><strong>Form Factor:</strong> [formFactor] ([ramSlots] RAM slots)</p>
<p><strong>Quantity Available:</strong> [quantity]</p>

<h3>Barebones Checklist:</h3>
<ul>
  <li>RAM: [✅ Included OR ❌ MISSING (+$65)]</li>
  <li>SSD: [✅ Included OR ❌ MISSING (+$30)]</li>
  <li>AC Adapter (Mini only): [✅ Included OR ⚠️ VERIFY (+$20) OR N/A (SFF/MT)]</li>
  <li>Power Cord: [✅ Included OR ❌ MISSING (+$5)]</li>
  <li>CPU: [✅ Included OR ❌ MISSING (+$140)]</li>
  <li>T-Series CPU: [YES (strike price -$15) OR NO (standard strike price)]</li>
</ul>

<p style="font-size: 18px; background-color: #3498db; color: white; padding: 10px; text-align: center; border-radius: 5px; margin: 20px 0;">
  <strong><a href="[listing.url]" style="color: white;">🔗 EBAY LISTING: [listing.url]</a></strong>
</p>
```

---

### B. Auction Listings - Create Calendar Sniper Task

When a listing hits strike price and is an Auction:

1. Parse the auction end time from the listing
2. Calculate sniper time: **5 minutes before auction end**
3. Use `mcp__google-calendar__calendar_create` tool
4. **Summary:** "Snipe: [model] - $[strikePrice] - [listing.itemId]"
5. **Start Time:** Sniper time (5 min before end)
6. **End Time:** Auction end time
7. **Description:**

```
🎯 CLUSTER SNIPER TASK

🔗 EBAY: [listing.url]
Item ID: [listing.itemId]

Model: [listing.model]
CPU: [listing.cpu] ([tier] Tier)
Form Factor: [formFactor]

True Cost: $[trueCost]
Max Bid: $[strikePrice]
Savings: $[strikePrice - trueCost]

Barebones Checklist:
- RAM: [MISSING (+$65) OR Included]
- SSD: [MISSING (+$30) OR Included]
- AC Adapter: [⚠️ VERIFY (+$20 if missing) OR N/A (SFF/MT)]
- Power Cord: [MISSING (+$5) OR Included]
- T-Series CPU: [YES (strike adjusted -$15) OR NO]

⏰ Sniper Strategy: Bid at 5 seconds remaining

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIRECT LINK: [listing.url]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 📧 Step 8: The "Cluster Architect" Report

**Objective:** Send a comprehensive decision-ready HTML email to `ben@sack.io` using `mcp__google-gmail__gmail_send`.

**Subject:** "Cluster Hunt Report - [Date]"

### Report Structure

#### 1. 🚀 Top Picks (Ready to Buy)

Create an HTML table with listings that hit strike prices:

| Model | CPU | Form | Tier | True Cost | Strike | Savings | Qty | Link |
|-------|-----|------|------|-----------|--------|---------|-----|------|

Include only listings where `True Cost ≤ Strike Price`.

---

#### 2. ⚠️ "Some Assembly Required" (Best DIY Deals)

Create an HTML table with barebones listings that have high Barn Tax but good final pricing:

| Model | CPU | Base Price | Barn Tax | True Cost | vs Strike | Notes |
|-------|-----|------------|----------|-----------|-----------|-------|

Include listings where Barn Tax ≥ $100 but still competitive.

---

#### 3. 🔍 Discovery Summary

Summary statistics from the discovery phase:

```
- Total Discovered: [count] listings
- Gold Tier: [count] listings
- Silver Tier: [count] listings
- Rejected (Bronze): [count] listings
```

---

#### 4. 👥 Preferred Sellers

List sellers with multiple Gold/Silver tier listings:

| Seller ID | Gold Listings | Silver Listings | Notes |
|-----------|---------------|-----------------|-------|

Flag sellers with 3+ qualifying listings as "good for bulk negotiation".

---

#### 5. 📉 Market Pulse

Calculate and report:
- Average Gold Tier Price
- Average Silver Tier Price
- Form Factor Distribution (% SFF, % MT, % USFF)
- **Recommendation:** "BUY GOLD TIER NOW" or "WAIT - PRICES HIGH" or "FOCUS ON SILVER TIER"

Base recommendation on:
- If avg Gold price < $170: "Good time to buy Gold"
- If avg Silver price < $125: "Focus on Silver tier"
- If both above threshold: "Wait - prices elevated"

---

## 🧹 Step 9: Cleanup

1. **Close Browser Tabs:** Use `mcp__unibrowse__browser_close_tab` to close eBay tabs
2. **Log Summary** to console:
   ```
   Hunt Complete.
   - Primary Search: [count] results ([gold] Gold, [silver] Silver)
   - Hidden Gem: [count] results ([gold] Gold)
   - Bulk Lots: [count] results ([silver] Silver, [bronze] rejected)
   - Discovery: [count] additional listings
   - Strike Price Hits: [bin_count] BIN, [auction_count] Auction
   - Alerts Sent: [gmail_count] Gmail, [calendar_count] Calendar
   - Report Sent: ben@sack.io
   ```
3. **TaskUpdate:** Mark all tasks as Complete using `TaskUpdate` tool

---

## 🎓 Key Learnings & Strategy Notes

### Why 10th Gen?
- **Hyphen 10** = Comet Lake architecture (2020)
- 14nm+++ process, mature and reliable
- 65W TDP for SFF/MT (no thermal issues)
- 16 threads (i7-10700) for parallel Numba workloads
- 4 RAM slots in SFF = 64GB max (perfect for VectorBT backtests)

### Why Avoid Older Generations?
- **Hyphen 4-7** = Ancient silicon (2013-2017)
- Limited memory support (DDR3 on 4th gen)
- Slower single-thread performance (critical for Numba JIT)
- Higher power consumption per thread
- Not worth cluster expansion, even at low prices

### The Discovery Advantage
- **Related Items:** eBay's algorithm surfaces similar hardware you might miss
- **Seller Inventory:** Bulk sellers often have unlisted inventory or will negotiate multi-unit deals
- **Recommended Items:** Captures "people also bought" intelligence
- **Result:** 2-3x more candidates than direct search alone

### The "Barn Engineering" Philosophy
- **Thermal Mitigation:** Zip-tie a large house fan to a shelf of Mini PCs to solve thermal throttling
- **Density Advantage:** 1-liter Minis offer excellent shelf density in barn environment
- **Power Flexibility:** With barn power capacity, external bricks are not a problem
- **Result:** Mini/Micro form factors are now acceptable at standard strike prices (with T-series penalty if applicable)

---

## 🔧 MCP Tools Reference

### Unibrowse MCP (Browser Automation)
- `mcp__unibrowse__browser_navigate` - Navigate to URLs
- `mcp__unibrowse__browser_list_macros` - Check available macros
- `mcp__unibrowse__browser_execute_macro` - Execute stored macros
- `mcp__unibrowse__browser_close_tab` - Close browser tabs

### Google Gmail MCP (Email Alerts)
- `mcp__google-gmail__gmail_send` - Send HTML emails
  - Parameters: `to`, `subject`, `body`, `html_body: true`

### Google Calendar MCP (Sniper Tasks)
- `mcp__google-calendar__calendar_create` - Create calendar events
  - Parameters: `summary`, `start` (ISO 8601), `end` (ISO 8601), `description`

---

## 📝 Execution Checklist

- [ ] Verify all required eBay macros exist
- [ ] Create browser tab for eBay
- [ ] Execute Primary Search
- [ ] Execute Hidden Gem Search
- [ ] Execute Bulk Lot Search
- [ ] For each Gold tier result, run Discovery (related/seller/recommended)
- [ ] Calculate True Cost for all candidates
- [ ] Apply Strike Price logic
- [ ] Send Gmail alerts for BIN hits
- [ ] Create Calendar tasks for Auction hits
- [ ] Generate and send comprehensive report
- [ ] Close browser tabs
- [ ] Mark all tasks complete
