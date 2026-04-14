# eBay Auction Sniper Macros

## ⚠️ SAFETY FIRST ⚠️

**CRITICAL**: These macros are designed for **SAFE TESTING** of auction bidding workflows. They will fill forms and navigate pages, but **WILL NOT** submit final bids automatically.

### Testing Protocol

1. **Start with ended auctions** - Safest approach, eBay will reject the bid
2. **Use low-value test auctions** - Under $5 if testing on active listings
3. **Stop at confirmation page** - Review all details before any manual action
4. **Never automate the final click** - User must manually confirm (for practice only)

### What These Macros Do

✅ Navigate to bid placement page
✅ Fill bid amount field
✅ Extract form state and validation
✅ Extract confirmation page details

❌ **DO NOT** click final "Confirm Bid" button
❌ **DO NOT** automate bid submission

---

## Overview

The eBay Sniper system consists of 4 macros that work together to safely practice auction bidding workflows:

| Macro | Purpose | Page Type | Safety Level |
|-------|---------|-----------|--------------|
| `ebay_sniper_analyze_page` | Detect current page and extract state | Any bid workflow page | 🟢 Read-only |
| `ebay_sniper_initiate_bid` | Click "Place Bid" button | Product page | 🟡 Navigates |
| `ebay_sniper_fill_bid` | Fill bid amount (NO SUBMIT) | Bid entry page | 🟢 Fills form |
| `ebay_sniper_review_bid` | Extract confirmation data | Confirmation page | 🟢 Read-only |

### Architecture

**Critical Constraint**: `browser_evaluate` macros cannot survive page navigation. JavaScript execution context is destroyed when page navigates.

**Solution**: User orchestrates workflow with `browser_wait` between steps.

---

## Macro API Reference

### 1. `ebay_sniper_analyze_page`

**Purpose**: Safety utility - detect current page in bid workflow and extract comprehensive state

**Parameters**: None

**Returns**:
```javascript
{
  success: boolean,
  pageType: "product_page" | "bid_entry_page" | "bid_confirmation_page" | "unknown",
  url: string,
  itemId: string | null,
  timestamp: number,

  // Only present if pageType === "product_page"
  product?: {
    title: string,
    currentBid: number,
    timeLeft: string,
    bidCount: number,
    isAuction: boolean
  },

  // Only present if pageType === "bid_entry_page"
  bidEntry?: {
    minBid: number,
    maxBidField: {
      selector: string,
      value: string,
      placeholder: string
    },
    submitButton: {
      text: string,
      disabled: boolean,
      selector: string
    }
  },

  // Only present if pageType === "bid_confirmation_page"
  confirmation?: {
    bidAmount: number,
    total: number,
    confirmButton: {
      text: string,
      disabled: boolean,
      selector: string
    }
  },

  error: string | null,
  hint?: string
}
```

**Example**:
```javascript
const state = await browser_execute_macro({
  id: "ebay_sniper_analyze_page",
  params: {}
});

console.log('Current page:', state.pageType);
if (state.pageType === "product_page") {
  console.log('Product:', state.product.title);
  console.log('Current bid:', state.product.currentBid);
  console.log('Time left:', state.product.timeLeft);
}
```

**Use Cases**:
- Verify you're on the correct page before executing workflow steps
- Extract current state at any point in workflow
- Debug workflow issues
- Safely explore bid workflow without interaction

---

### 2. `ebay_sniper_initiate_bid`

**Purpose**: Click "Place Bid" button to navigate from product page to bid entry page

**Parameters**:
- `verifyAuction` (boolean, default: `true`) - Verify listing is an auction before clicking

**Returns**:
```javascript
{
  success: boolean,
  action: "clicked_place_bid" | null,
  preClickState: {
    itemId: string,
    isAuction: boolean,
    bidCount: number,
    timeLeft: string,
    currentBid: number,
    buttonText: string,
    buttonSelector: string
  },
  error: string | null,
  warning?: string,
  message: string
}
```

**Example**:
```javascript
// Verify auction and click Place Bid
const initiate = await browser_execute_macro({
  id: "ebay_sniper_initiate_bid",
  params: { verifyAuction: true }
});

if (initiate.success) {
  console.log('✓ Clicked Place Bid button');
  console.log('  Item ID:', initiate.preClickState.itemId);
  console.log('  Current bid:', initiate.preClickState.currentBid);
  console.log('  Time left:', initiate.preClickState.timeLeft);

  // Wait for page navigation
  await browser_wait({ time: 2 });
} else {
  console.error('Error:', initiate.error);
}
```

**Button Detection Strategy**:
1. `button[data-test-id="place-bid"]` (modern eBay)
2. `#placebidbtn` (legacy ID)
3. `.btn-place-bid` (class-based)
4. `a[href*="placeoffer"]` (link-based)
5. Text search: `/place\s+bid/i`

**Auction Verification**:
- Checks for bid count element
- Checks for time remaining element
- Sets `preClickState.isAuction = true` if found

---

### 3. `ebay_sniper_fill_bid`

**Purpose**: Fill bid amount on bid entry page (DOES NOT SUBMIT)

**Parameters**:
- `bidAmount` (number, required) - Bid amount in dollars (e.g., `142.50`)
- `verifyMinimum` (boolean, default: `true`) - Verify bid meets minimum requirement

**Returns**:
```javascript
{
  success: boolean,
  action: "filled_bid_amount" | null,
  bidAmount: number,
  minimumBid: number | null,
  bidInput: {
    value: string,
    selector: string
  },
  submitButton: {
    text: string,
    disabled: boolean,
    selector: string
  } | null,
  validationError: string | null,
  warning: string, // Always present: "BID NOT SUBMITTED"
  nextStep: string,
  error: string | null
}
```

**Example**:
```javascript
// Fill bid amount (but don't submit)
const fill = await browser_execute_macro({
  id: "ebay_sniper_fill_bid",
  params: {
    bidAmount: 142.00,
    verifyMinimum: true
  }
});

if (fill.success) {
  console.log('✓ Bid filled:', fill.bidAmount);
  console.log('  Minimum bid:', fill.minimumBid);
  console.log('  Submit button:', fill.submitButton.text);
  console.log('  ⚠️', fill.warning);

  if (fill.validationError) {
    console.error('  Validation error:', fill.validationError);
  }
} else {
  console.error('Error:', fill.error);
}
```

**Input Field Detection**:
1. `input[data-test-id="bid-amount"]`
2. `#MaxBidId` (common eBay field ID)
3. `input[name="maxbid"]`
4. Context search: inputs with labels/placeholders containing "bid" or "amount"

**Minimum Bid Extraction**:
- Pattern match in page text: `/enter\s+\$?([\d,]+\.?\d*)\s+or\s+more/i`
- Pattern: `/minimum\s+bid[:\s]+\$?([\d,]+\.?\d*)/i`
- Fallback: Current bid + increment (usually $0.50)

**Event Triggering**:
```javascript
input.value = bidAmount.toFixed(2);
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
input.dispatchEvent(new Event('blur', { bubbles: true }));
```

**CRITICAL SAFETY**: This macro explicitly does NOT click the submit button. It fills the form and returns button info for user review.

---

### 4. `ebay_sniper_review_bid`

**Purpose**: Extract confirmation page data (READ-ONLY, no interaction)

**Parameters**: None

**Returns**:
```javascript
{
  success: boolean,
  pageType: "confirmation_page",
  url: string,
  itemId: string | null,
  timestamp: number,
  item: {
    title: string,
    imageUrl: string,
    itemNumber: string
  },
  bid: {
    yourBid: number,
    shippingCost: number,
    totalCost: number,
    currentBid: number,
    bidIncrement: number
  },
  confirmButton: {
    text: string,
    disabled: boolean,
    selector: string,
    warning: string // "DO NOT CLICK THIS BUTTON IN PRODUCTION"
  } | null,
  messages: Array<{
    type: "info" | "warning" | "error",
    text: string
  }>,
  safetyWarning: string, // "DO NOT CLICK CONFIRM BUTTON"
  readOnly: true,
  error: string | null
}
```

**Example**:
```javascript
// Extract confirmation page data
const review = await browser_execute_macro({
  id: "ebay_sniper_review_bid",
  params: {}
});

if (review.success) {
  console.log('✓ Confirmation page extracted');
  console.log('  Item:', review.item.title);
  console.log('  Your bid:', review.bid.yourBid);
  console.log('  Shipping:', review.bid.shippingCost);
  console.log('  Total:', review.bid.totalCost);
  console.log('  🛑', review.safetyWarning);

  if (review.messages.length > 0) {
    console.log('  Messages:');
    review.messages.forEach(msg => {
      console.log(`    [${msg.type}] ${msg.text}`);
    });
  }
} else {
  console.error('Error:', review.error);
  console.log('Hint:', review.hint);
}
```

**Data Extraction Patterns**:
- Your Bid: `/your\s+(?:max\s+)?bid[:\s]+\$?([\d,]+\.?\d*)/i`
- Shipping: `/shipping[:\s]+\$?([\d,]+\.?\d*)/i`
- Total: `/total[:\s]+\$?([\d,]+\.?\d*)/i`
- Current Bid: `/current\s+bid[:\s]+\$?([\d,]+\.?\d*)/i`
- Increment: `/bid\s+increment[:\s]+\$?([\d,]+\.?\d*)/i`

**CRITICAL SAFETY**: This macro is read-only. No mutation capability. No click interaction. Forces manual review.

---

## Complete Workflow Example

```javascript
// ═══════════════════════════════════════════════════════════
// COMPLETE EBAY SNIPER WORKFLOW - SAFE TESTING VERSION
// ═══════════════════════════════════════════════════════════

// ASSUMPTIONS:
// - Browser is already open (via browser_navigate)
// - Already on auction product page (e.g., Item 297961478320)
// - Item is ending soon (for testing timing)

console.log('🎯 eBay Sniper Workflow - Safe Testing Mode');
console.log('═══════════════════════════════════════════\n');

// ───────────────────────────────────────────────────────────
// STEP 1: Verify we're on the right page
// ───────────────────────────────────────────────────────────
console.log('📍 STEP 1: Analyze current page');

const pageCheck = await browser_execute_macro({
  id: "ebay_sniper_analyze_page",
  params: {}
});

if (!pageCheck.success) {
  console.error('❌ Page analysis failed:', pageCheck.error);
  throw new Error('Cannot proceed - not on valid page');
}

console.log('✓ Page type:', pageCheck.pageType);

if (pageCheck.pageType !== "product_page") {
  console.error('❌ Expected product page, got:', pageCheck.pageType);
  throw new Error('Must start on product page');
}

console.log('✓ Item ID:', pageCheck.itemId);
console.log('✓ Title:', pageCheck.product.title);
console.log('✓ Current bid: $' + pageCheck.product.currentBid.toFixed(2));
console.log('✓ Time left:', pageCheck.product.timeLeft);
console.log('✓ Is auction:', pageCheck.product.isAuction);

if (!pageCheck.product.isAuction) {
  console.error('❌ Item is not an auction');
  throw new Error('This workflow is for auctions only');
}

console.log('\n');

// ───────────────────────────────────────────────────────────
// STEP 2: Click Place Bid button
// ───────────────────────────────────────────────────────────
console.log('🖱️  STEP 2: Click Place Bid button');

const initiate = await browser_execute_macro({
  id: "ebay_sniper_initiate_bid",
  params: { verifyAuction: true }
});

if (!initiate.success) {
  console.error('❌ Failed to click Place Bid:', initiate.error);
  throw new Error('Cannot proceed to bid entry');
}

console.log('✓ Clicked:', initiate.preClickState.buttonText);
console.log('✓ Pre-click state captured');
console.log('  - Item ID:', initiate.preClickState.itemId);
console.log('  - Current bid: $' + initiate.preClickState.currentBid.toFixed(2));
console.log('  - Time left:', initiate.preClickState.timeLeft);

console.log('\n⏳ Waiting for page navigation...');

// ───────────────────────────────────────────────────────────
// STEP 3: Wait for navigation to bid entry page
// ───────────────────────────────────────────────────────────
await browser_wait({ time: 2 }); // 2 seconds for page load

console.log('✓ Navigation complete\n');

// ───────────────────────────────────────────────────────────
// STEP 4: Verify we're on bid entry page
// ───────────────────────────────────────────────────────────
console.log('📍 STEP 3: Verify bid entry page');

const bidPageCheck = await browser_execute_macro({
  id: "ebay_sniper_analyze_page",
  params: {}
});

if (!bidPageCheck.success || bidPageCheck.pageType !== "bid_entry_page") {
  console.error('❌ Not on bid entry page:', bidPageCheck.pageType);
  console.error('   URL:', bidPageCheck.url);
  throw new Error('Navigation to bid entry failed');
}

console.log('✓ On bid entry page');
console.log('✓ Minimum bid: $' + (bidPageCheck.bidEntry.minBid || 'unknown'));

console.log('\n');

// ───────────────────────────────────────────────────────────
// STEP 5: Fill bid amount (BUT DON'T SUBMIT)
// ───────────────────────────────────────────────────────────
console.log('💰 STEP 4: Fill bid amount');

const YOUR_BID = 142.00; // ← SET YOUR BID HERE

const fill = await browser_execute_macro({
  id: "ebay_sniper_fill_bid",
  params: {
    bidAmount: YOUR_BID,
    verifyMinimum: true
  }
});

if (!fill.success) {
  console.error('❌ Failed to fill bid:', fill.error);
  if (fill.validationError === "below_minimum") {
    console.error('   Your bid: $' + YOUR_BID.toFixed(2));
    console.error('   Minimum: $' + fill.minimumBid.toFixed(2));
  }
  throw new Error('Cannot fill bid amount');
}

console.log('✓ Bid filled: $' + fill.bidAmount.toFixed(2));
console.log('✓ Minimum bid: $' + (fill.minimumBid || 'unknown'));
console.log('✓ Input field:', fill.bidInput.selector);
console.log('✓ Submit button:', fill.submitButton.text);
console.log('✓ Button disabled:', fill.submitButton.disabled);

if (fill.validationError) {
  console.error('⚠️  Validation error:', fill.validationError);
}

console.log('\n⚠️  WARNING:', fill.warning);
console.log('   Next step:', fill.nextStep);

console.log('\n');

// ───────────────────────────────────────────────────────────
// CRITICAL SAFETY POINT
// ───────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════');
console.log('🛑 WORKFLOW STOPPED AT BID ENTRY PAGE');
console.log('═══════════════════════════════════════════');
console.log('');
console.log('The form is filled with: $' + YOUR_BID.toFixed(2));
console.log('Submit button is visible but NOT clicked');
console.log('');
console.log('OPTIONS:');
console.log('1. Review the page manually');
console.log('2. Click submit button manually (for practice)');
console.log('3. Stop here (safest for ended auctions)');
console.log('');
console.log('If you manually click submit, wait 5-10 seconds,');
console.log('then run the review macro to extract confirmation data.');
console.log('═══════════════════════════════════════════\n');

// ───────────────────────────────────────────────────────────
// OPTIONAL: Extract confirmation (if user manually submits)
// ───────────────────────────────────────────────────────────
console.log('⏳ Waiting 10 seconds for manual submit click...');
await browser_wait({ time: 10 });

console.log('\n📍 STEP 5: Check for confirmation page');

const confirmCheck = await browser_execute_macro({
  id: "ebay_sniper_analyze_page",
  params: {}
});

if (confirmCheck.pageType === "bid_confirmation_page") {
  console.log('✓ On confirmation page (you clicked submit)');

  const review = await browser_execute_macro({
    id: "ebay_sniper_review_bid",
    params: {}
  });

  if (review.success) {
    console.log('\n📊 CONFIRMATION PAGE DATA:');
    console.log('═══════════════════════════════════════════');
    console.log('Item:', review.item.title);
    console.log('Item #:', review.item.itemNumber);
    console.log('');
    console.log('Your bid:    $' + review.bid.yourBid.toFixed(2));
    console.log('Shipping:    $' + review.bid.shippingCost.toFixed(2));
    console.log('Total cost:  $' + review.bid.totalCost.toFixed(2));
    console.log('');
    console.log('Current bid: $' + (review.bid.currentBid || 'N/A'));
    console.log('Increment:   $' + (review.bid.bidIncrement || 'N/A'));
    console.log('');

    if (review.messages.length > 0) {
      console.log('MESSAGES:');
      review.messages.forEach(msg => {
        console.log(`  [${msg.type.toUpperCase()}] ${msg.text}`);
      });
      console.log('');
    }

    console.log('Confirm button:', review.confirmButton?.text || 'Not found');
    console.log('');
    console.log('🛑', review.safetyWarning);
    console.log('═══════════════════════════════════════════\n');
  }
} else {
  console.log('✓ Still on bid entry page (you did not click submit)');
  console.log('   This is expected for safe testing');
  console.log('   No confirmation page to review\n');
}

console.log('✅ Workflow complete - No bids were submitted automatically');
```

---

## Testing Guide

### Phase 1: Ended Auctions (Safest)

**Goal**: Test full workflow with zero risk

**Steps**:
1. Search eBay for "sold listings" or find expired auction
2. Navigate to ended auction page
3. Run full workflow with any bid amount
4. eBay will block submission (auction ended) - this is expected and safe

**Expected Results**:
- ✅ Page detection works
- ✅ Button clicks work
- ✅ Form fills correctly
- ❌ eBay blocks submission (SAFE - auction ended)

**Benefits**:
- No risk of accidental bid
- Full workflow testing
- Selector validation
- Error handling verification

### Phase 2: Active Low-Value Auctions

**Goal**: Test on real auctions with minimal financial risk

**Criteria**:
- Auction value: Under $5
- Time remaining: Multiple days
- Item: Something you don't mind winning

**Steps**:
1. Find low-value test auction
2. Run workflow with minimum bid
3. Stop at confirmation page
4. DO NOT click confirm
5. Let auction expire naturally

**Expected Results**:
- ✅ Full workflow to confirmation
- ✅ All data extracted correctly
- ✅ You can review confirmation page
- ✅ Auction expires without bid (you didn't click confirm)

### Phase 3: Production Dry-Run (Tonight's Snipe)

**Goal**: Practice for real snipe without submitting

**Timing**:
- Start workflow 5 minutes before auction end
- This gives time to fix any errors

**Steps**:
1. At 10:55 PM, navigate to auction page
2. Run full workflow with your max bid ($142.00)
3. Verify form fills correctly
4. Review confirmation page
5. User decides: click confirm (real bid) or stop (practice)

**Decision Point**:
- If everything looks correct → Manually click confirm (real bid placed)
- If anything looks wrong → Stop, no bid placed (safe practice)

---

## Error Handling

### Common Errors and Solutions

#### Error: "Not on product page"
**Cause**: Started workflow on wrong page
**Solution**:
```javascript
// Always verify first
const check = await browser_execute_macro({
  id: "ebay_sniper_analyze_page"
});

if (check.pageType !== "product_page") {
  // Navigate to product page first
  await browser_navigate({
    url: "https://www.ebay.com/itm/297961478320"
  });
}
```

#### Error: "Place Bid button not found"
**Cause**: Item is not an auction (Buy It Now only)
**Solution**:
```javascript
// Check if auction
if (!pageCheck.product.isAuction) {
  console.error('This is not an auction listing');
  // Try different workflow for Buy It Now
}
```

#### Error: "Bid amount below minimum"
**Cause**: Your bid doesn't meet eBay's minimum
**Solution**:
```javascript
// Extract minimum first
const pageCheck = await browser_execute_macro({
  id: "ebay_sniper_analyze_page"
});

const minBid = pageCheck.bidEntry?.minBid || 0;
const yourBid = Math.max(minBid, 142.00); // Use max of your bid or minimum

const fill = await browser_execute_macro({
  id: "ebay_sniper_fill_bid",
  params: { bidAmount: yourBid }
});
```

#### Error: "Bid input field not found"
**Cause**: eBay changed their form structure
**Solution**:
- Check if logged in (eBay requires login for bidding)
- Try clicking "Place Bid" again
- Check browser console for JavaScript errors
- Report issue for macro update

#### Error: "Navigation timeout"
**Cause**: Page took too long to load
**Solution**:
```javascript
// Increase wait time
await browser_wait({ time: 5 }); // Try 5 seconds instead of 2

// Or check if navigation actually happened
const afterNav = await browser_execute_macro({
  id: "ebay_sniper_analyze_page"
});

if (afterNav.pageType === "product_page") {
  // Still on product page, navigation failed
  console.error('Navigation did not occur');
}
```

---

## CSS Selector Strategies

### Multi-Layer Fallback Pattern

All macros use a multi-layer fallback strategy for maximum reliability:

```javascript
// Layer 1: Modern data attributes (most specific)
'button[data-test-id="place-bid"]'

// Layer 2: Legacy IDs (stable)
'#placebidbtn'

// Layer 3: Classes (somewhat stable)
'.btn-place-bid'

// Layer 4: Attribute patterns (flexible)
'a[href*="placeoffer"]'

// Layer 5: Text content search (last resort)
Array.from(document.querySelectorAll('button'))
  .find(btn => /place\s+bid/i.test(btn.textContent))
```

### Why This Works

1. **Modern eBay**: Uses `data-test-id` attributes
2. **Legacy eBay**: Uses ID selectors like `#MaxBidId`
3. **Mobile eBay**: May use different classes
4. **International eBay**: Text patterns adapt to language

### Selector Maintenance

If a macro fails:
1. Open browser dev tools
2. Inspect the target element
3. Check which selector would match
4. Update macro with new primary selector
5. Keep old selectors as fallbacks

---

## Troubleshooting

### Q: Workflow stops at product page, won't click Place Bid

**A**: Check if you're logged in to eBay. Most bid actions require authentication.

```javascript
// Check for sign-in button
const signInBtn = document.querySelector('[data-testid="signin-header"]');
if (signInBtn) {
  console.log('You are not logged in');
  // Log in first, then retry workflow
}
```

### Q: Form fills but validation errors appear

**A**: Your bid may not meet eBay's requirements. Check minimum bid and increment.

```javascript
const pageCheck = await browser_execute_macro({
  id: "ebay_sniper_analyze_page"
});

console.log('Minimum bid:', pageCheck.bidEntry.minBid);

// Ensure your bid is at least minimum + one increment
const safeBid = pageCheck.bidEntry.minBid + 0.50; // $0.50 is common increment
```

### Q: Can't get to confirmation page

**A**: You must manually click the submit button. Macros deliberately do not automate this step.

```javascript
// After filling bid, macro returns submit button info
const fill = await browser_execute_macro({
  id: "ebay_sniper_fill_bid",
  params: { bidAmount: 142.00 }
});

console.log('Submit button:', fill.submitButton.text);
console.log('Selector:', fill.submitButton.selector);

// YOU must manually click this button
// Then wait and run review macro
```

### Q: Getting "unknown page type" errors

**A**: URL pattern may have changed. Check actual URL and update detection logic.

```javascript
const pageCheck = await browser_execute_macro({
  id: "ebay_sniper_analyze_page"
});

console.log('URL:', pageCheck.url);
console.log('Page type:', pageCheck.pageType);

// If unknown, check URL pattern and report issue
```

### Q: Workflow works on some auctions but not others

**A**: Some auctions have different requirements (e.g., immediate payment, preapproval needed).

Check for page messages:
```javascript
const review = await browser_execute_macro({
  id: "ebay_sniper_review_bid"
});

if (review.messages.length > 0) {
  review.messages.forEach(msg => {
    console.log(`[${msg.type}] ${msg.text}`);
  });
}
```

---

## Integration with Existing eBay Macros

These sniper macros complement the [existing 18 eBay macros](./EBAY_MACROS.md):

### Combined Workflow: Search → Analyze → Snipe

```javascript
// 1. Search for auctions ending soon
await browser_execute_macro({
  id: "ebay_search_products",
  params: {
    query: "HP ProDesk 600 G4",
    filters: { listingType: "auction" }
  }
});

// 2. Sort by ending soonest
await browser_execute_macro({
  id: "ebay_apply_sort",
  params: { sortBy: "ending_soonest" }
});

// 3. Extract search results
const results = await browser_execute_macro({
  id: "ebay_extract_search_results"
});

// 4. Click into best deal
await browser_execute_macro({
  id: "ebay_click_product",
  params: { index: 0 } // First result
});

// 5. Extract full product details
const details = await browser_execute_macro({
  id: "ebay_extract_product_details"
});

// 6. Check seller reputation
const seller = await browser_execute_macro({
  id: "ebay_extract_seller_info"
});

// 7. Decide if you want to bid
if (details.shipping.cost < 10 && seller.positiveFeedbackPercent > 98) {
  // 8. START SNIPER WORKFLOW
  // ... (use sniper macros from above)
}
```

---

## Safety Checklist

Before running workflow on production auction:

- [ ] Tested on ended auction successfully
- [ ] Verified all macros return expected data
- [ ] Confirmed bid amount is correct
- [ ] Checked shipping costs
- [ ] Verified seller reputation
- [ ] Calculated total cost (bid + shipping)
- [ ] Set maximum bid (don't exceed this)
- [ ] Reviewed confirmation page thoroughly
- [ ] User is ready to manually click confirm (if desired)
- [ ] Accepted that this is for practice/testing

---

## Production Snipe: Tonight's Workflow

**Auction**: 297961478320 - HP ProDesk 600 G4
**End Time**: 10:58 PM EST
**Your Max Bid**: $142.00

### Timeline

**10:55 PM** - Start workflow (3 minutes before end)
```javascript
// Navigate to auction
await browser_navigate({
  url: "https://www.ebay.com/itm/297961478320"
});

// Run sniper workflow
// ... (full workflow from above)
```

**10:57 PM** - Verify form filled correctly

**10:58 PM** - Decision point:
- If satisfied → Manually click "Confirm Bid"
- If not → Stop here (practice complete)

### Post-Snipe

If you bid:
- Check "My eBay" for bid status
- Monitor for outbid notifications
- Be prepared to pay if you win

If you didn't bid:
- Workflow still validated
- Ready for next auction
- Learned timing and flow

---

## Future Enhancements

Potential additions (DO NOT IMPLEMENT WITHOUT USER APPROVAL):

1. **Timing Optimization**
   - Calculate optimal bid submission time
   - Account for network latency
   - Auto-refresh for time sync

2. **Bid Strategy**
   - Snipe at last second (high risk)
   - Early snipe with proxy bid (safer)
   - Incremental bidding

3. **Multi-Auction**
   - Track multiple auctions
   - Bid on whichever ends first
   - Budget management

4. **Watchlist Integration**
   - Add to watchlist
   - Monitor price changes
   - Alert on ending soon

**IMPORTANT**: All enhancements must maintain safety-first approach. Never automate final bid submission without explicit user approval for each bid.

---

## License and Disclaimer

These macros are provided for **educational and testing purposes only**.

**Disclaimer**:
- Not responsible for accidental bids
- Not responsible for won auctions
- User assumes all risk
- Test thoroughly before production use
- eBay's terms of service apply
- Automation may violate eBay policies

**Recommended Use**:
- Practice workflows
- Understand bid process
- Learn eBay's interface
- Manual review before submission

---

## Support

If you encounter issues:

1. Check this documentation
2. Test on ended auctions first
3. Verify browser console for errors
4. Check eBay's site status
5. Report macro failures with details:
   - URL
   - Page type expected vs actual
   - Error message
   - Browser console output

---

**Last Updated**: 2026-02-03
**Version**: 1.0.0
**Macros**: 4 (analyze, initiate, fill, review)
**Reliability**: Untested (pending validation)
