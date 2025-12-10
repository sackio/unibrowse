# 🤨 CoinTracker Macros Reference

Complete reference for all 2 CoinTracker-specific macros for cryptocurrency portfolio tracking and analysis.

## Table of Contents

1. [Overview](#overview)
2. [Extraction Macros (2)](#extraction-macros)
3. [Complete Workflows](#complete-workflows)
4. [Best Practices](#best-practices)
5. [Troubleshooting](#troubleshooting)

---

## Overview

**CoinTracker macros** are specialized JavaScript functions stored in MongoDB that automate cryptocurrency portfolio tracking, analysis, and data extraction operations on CoinTracker.io.

**Total CoinTracker Macros**: 2
- **Extraction**: 2 macros

**Site**: `cointracker.io`

**Usage Pattern**:
```javascript
// 1. Check if macro exists
const macros = await mcp__browser__browser_list_macros({ site: "cointracker.io" });

// 2. Execute macro
const result = await mcp__browser__browser_execute_macro({
  id: "extract_portfolio_summary",
  tabTarget: tabId
});

// 3. Use results
console.log("Portfolio summary:", result.content);
```

---

## Extraction Macros

### `extract_portfolio_summary`

**Description**: Extract portfolio summary including total value, performance metrics (unrealized return, cost basis), and tax summary. Use on the main CoinTracker Portfolio page.

**Site**: `cointracker.io`

**Category**: extraction

**Parameters**: None

**Returns**:
```javascript
{
  "success": true,
  "timestamp": "2025-12-10T15:25:46.000Z",
  "portfolio": {
    "totalValue": "$156,207.03",
    "pastWeekChange": "$2,456.45 (+1.6%)"
  },
  "performance": {
    "unrealizedReturn": "$128,887.89 (191.51%)",
    "costBasis": "$67,319.14"
  },
  "taxSummary": [
    {
      "year": "2025",
      "gains": "$12,345.67",
      "income": "$5,234.89"
    },
    {
      "year": "2024",
      "gains": "$45,678.90",
      "income": "$8,901.23"
    }
  ],
  "message": "Extracted portfolio summary: $156,207.03"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "extract_portfolio_summary",
  tabTarget: tabId
});

const portfolio = result.content.portfolio;
console.log(`Total Portfolio Value: ${portfolio.totalValue}`);
console.log(`Past Week Change: ${portfolio.pastWeekChange}`);
console.log(`Unrealized Return: ${result.content.performance.unrealizedReturn}`);
```

**Use Cases**:
- Dashboard creation with current portfolio metrics
- Performance tracking across years
- Tax reporting preparation
- Portfolio health monitoring
- Financial planning and analysis

**Notes**:
- Requires page to be on CoinTracker Portfolio main page
- Extracts real-time portfolio value and performance metrics
- Includes tax summary for multiple years
- Timestamp included for audit trail
- Returns high-level portfolio overview (see `extract_all_asset_holdings` for individual assets)

**Return Fields**:
- `timestamp`: ISO format date/time of extraction
- `portfolio.totalValue`: Current portfolio total in USD
- `portfolio.pastWeekChange`: Weekly change with percentage
- `performance.unrealizedReturn`: Total unrealized gains/losses with percentage
- `performance.costBasis`: Total amount invested (cost basis)
- `taxSummary`: Array of tax years with capital gains and income

---

### `extract_all_asset_holdings`

**Description**: Extracts all cryptocurrency asset holdings from the CoinTracker portfolio page, including name, symbol, price, holdings value, quantity, and unrealized returns for each asset.

**Site**: `cointracker.io`

**Category**: extraction

**Parameters**: None

**Returns**:
```javascript
{
  "success": true,
  "timestamp": "2025-12-10T15:25:46.000Z",
  "assets": [
    {
      "name": "Bitcoin",
      "symbol": "BTC",
      "price": "$43,456.78",
      "holdings": {
        "value": "$196,207.03",
        "quantity": "4.51625338"
      },
      "unrealizedReturn": {
        "amount": "$128,887.89",
        "percentage": "191.51%"
      }
    },
    {
      "name": "Ethereum",
      "symbol": "ETH",
      "price": "$2,345.67",
      "holdings": {
        "value": "$45,678.90",
        "quantity": "19.5"
      },
      "unrealizedReturn": {
        "amount": "$23,456.78",
        "percentage": "105.23%"
      }
    }
  ],
  "totalAssets": 2,
  "message": "Extracted 2 assets"
}
```

**Example**:
```javascript
// Extract all holdings
const result = await mcp__browser__browser_execute_macro({
  id: "extract_all_asset_holdings",
  tabTarget: tabId
});

// Process each asset
result.content.assets.forEach(asset => {
  console.log(`${asset.name} (${asset.symbol})`);
  console.log(`  Holding Value: ${asset.holdings.value}`);
  console.log(`  Quantity: ${asset.holdings.quantity}`);
  console.log(`  Unrealized Return: ${asset.unrealizedReturn.amount} (${asset.unrealizedReturn.percentage})`);
});

console.log(`Total Assets: ${result.content.totalAssets}`);
```

**Use Cases**:
- Export portfolio composition for analysis
- Track individual asset performance
- Rebalancing analysis and planning
- Asset allocation reporting
- Portfolio diversification analysis
- Tax lot tracking and planning
- Integration with external portfolio tools

**Notes**:
- Extracts data from visible portfolio table
- Includes both main holdings and wallet details
- Handles multiple cryptocurrencies and altcoins
- Returns precise quantity data with decimals
- Supports tracking of unrealized gains/losses per asset
- Useful for detailed tax reporting and portfolio analysis

**Return Fields Per Asset**:
- `name`: Full cryptocurrency name (e.g., "Bitcoin", "Ethereum")
- `symbol`: Ticker symbol (e.g., "BTC", "ETH")
- `price`: Current price per unit
- `holdings.value`: Total value of holdings in USD
- `holdings.quantity`: Number of coins/tokens held
- `unrealizedReturn.amount`: Dollar amount of unrealized gain/loss
- `unrealizedReturn.percentage`: Percentage return on investment

---

## Complete Workflows

### Workflow 1: Daily Portfolio Check

```javascript
// Step 1: Extract portfolio summary
const summary = await mcp__browser__browser_execute_macro({
  id: "extract_portfolio_summary",
  tabTarget: tabId
});

console.log("=== Daily Portfolio Check ===");
console.log(`Total Value: ${summary.content.portfolio.totalValue}`);
console.log(`This Week: ${summary.content.portfolio.pastWeekChange}`);
console.log(`Total Return: ${summary.content.performance.unrealizedReturn}`);

// Step 2: Extract detailed holdings
const holdings = await mcp__browser__browser_execute_macro({
  id: "extract_all_asset_holdings",
  tabTarget: tabId
});

// Step 3: Identify top performers
const topPerformers = holdings.content.assets
  .sort((a, b) => {
    const aReturn = parseFloat(a.unrealizedReturn.percentage);
    const bReturn = parseFloat(b.unrealizedReturn.percentage);
    return bReturn - aReturn;
  })
  .slice(0, 3);

console.log("\n=== Top Performers ===");
topPerformers.forEach(asset => {
  console.log(`${asset.name}: ${asset.unrealizedReturn.percentage}`);
});
```

### Workflow 2: Tax Planning and Reporting

```javascript
// Step 1: Get portfolio summary for tax data
const summary = await mcp__browser__browser_execute_macro({
  id: "extract_portfolio_summary",
  tabTarget: tabId
});

// Step 2: Extract individual asset returns
const holdings = await mcp__browser__browser_execute_macro({
  id: "extract_all_asset_holdings",
  tabTarget: tabId
});

// Step 3: Calculate tax implications
const taxData = {
  year: 2025,
  totalGains: summary.content.taxSummary.find(t => t.year === "2025")?.gains || "$0",
  totalIncome: summary.content.taxSummary.find(t => t.year === "2025")?.income || "$0",
  assets: holdings.content.assets.map(asset => ({
    symbol: asset.symbol,
    unrealizedGain: asset.unrealizedReturn.amount,
    percentage: asset.unrealizedReturn.percentage
  }))
};

console.log("=== Tax Summary for 2025 ===");
console.log(`Capital Gains: ${taxData.totalGains}`);
console.log(`Income: ${taxData.totalIncome}`);
console.log(`Unrealized Gains: ${holdings.content.assets.reduce((sum, a) => {
  const amount = parseFloat(a.unrealizedReturn.amount.replace(/[$,]/g, ''));
  return sum + (isNaN(amount) ? 0 : amount);
}, 0).toFixed(2)}`);
```

### Workflow 3: Portfolio Rebalancing Analysis

```javascript
// Step 1: Get all holdings with current values
const holdings = await mcp__browser__browser_execute_macro({
  id: "extract_all_asset_holdings",
  tabTarget: tabId
});

// Step 2: Calculate total portfolio value
const totalValue = holdings.content.assets.reduce((sum, asset) => {
  const value = parseFloat(asset.holdings.value.replace(/[$,]/g, ''));
  return sum + (isNaN(value) ? 0 : value);
}, 0);

// Step 3: Calculate allocation percentages
const allocation = holdings.content.assets.map(asset => {
  const value = parseFloat(asset.holdings.value.replace(/[$,]/g, ''));
  return {
    symbol: asset.symbol,
    name: asset.name,
    value: value,
    percentage: ((value / totalValue) * 100).toFixed(2),
    targetPercentage: 25,  // Example: 25% per asset for 4-asset portfolio
    needsRebalancing: Math.abs((value / totalValue) * 100 - 25) > 5
  };
});

console.log("=== Rebalancing Analysis ===");
allocation.forEach(asset => {
  console.log(`${asset.name} (${asset.symbol}): ${asset.percentage}% (Target: ${asset.targetPercentage}%)`);
  if (asset.needsRebalancing) {
    console.log(`  >> Rebalancing needed!`);
  }
});
```

---

## Best Practices

### 1. Always Check for Portfolio Page Load

Make sure the portfolio page has fully loaded before extracting data:

```javascript
// ✅ Good: Wait for page load
await new Promise(resolve => setTimeout(resolve, 2000));
const summary = await mcp__browser__browser_execute_macro({
  id: "extract_portfolio_summary",
  tabTarget: tabId
});

// ❌ Bad: Extract immediately without waiting
const summary = await mcp__browser__browser_execute_macro({
  id: "extract_portfolio_summary",
  tabTarget: tabId
});
```

### 2. Extract Both Summary and Holdings

Use both macros together for complete portfolio analysis:

```javascript
// ✅ Good: Get complete portfolio picture
const summary = await mcp__browser__browser_execute_macro({
  id: "extract_portfolio_summary",
  tabTarget: tabId
});

const holdings = await mcp__browser__browser_execute_macro({
  id: "extract_all_asset_holdings",
  tabTarget: tabId
});

const totalAssets = holdings.content.totalAssets;
const portfolioValue = summary.content.portfolio.totalValue;
```

### 3. Parse Numeric Values Carefully

CoinTracker returns formatted strings; parse them for calculations:

```javascript
// ✅ Good: Parse currency values
const parseValue = (valueStr) => {
  return parseFloat(valueStr.replace(/[$,]/g, ''));
};

holdings.content.assets.forEach(asset => {
  const value = parseValue(asset.holdings.value);
  const quantity = parseFloat(asset.holdings.quantity);
  const pricePerUnit = value / quantity;
});

// ❌ Bad: Using string values directly
const total = holdings.content.assets[0].holdings.value + 100;  // Won't work!
```

### 4. Use Timestamp for Audit Trail

Include timestamp in your analysis for audit and compliance:

```javascript
// ✅ Good: Track when data was extracted
const result = await mcp__browser__browser_execute_macro({
  id: "extract_portfolio_summary",
  tabTarget: tabId
});

const reportDate = result.content.timestamp;
console.log(`Report Generated: ${new Date(reportDate).toLocaleString()}`);
```

### 5. Handle Rounding in Tax Calculations

Be careful with decimal precision in tax reporting:

```javascript
// ✅ Good: Use proper rounding for tax reporting
const gains = holdings.content.assets.map(a => {
  const amount = parseFloat(a.unrealizedReturn.amount.replace(/[$,]/g, ''));
  return parseFloat(amount.toFixed(2));
});

const totalGains = gains.reduce((a, b) => a + b, 0).toFixed(2);
```

---

## Troubleshooting

### Issue: Portfolio Data Not Extracting

**Cause**: Not on the correct CoinTracker page or page not fully loaded

**Solution**:
```javascript
// 1. Verify you're on portfolio page
const currentURL = window.location.href;
console.log("Current URL:", currentURL);
if (!currentURL.includes("cointracker.io")) {
  console.log("Navigate to https://cointracker.io/portfolio");
  // Then retry extraction
}

// 2. Wait for page load
await new Promise(resolve => setTimeout(resolve, 3000));

// 3. Retry extraction
const result = await mcp__browser__browser_execute_macro({
  id: "extract_portfolio_summary",
  tabTarget: tabId
});
```

### Issue: Missing or Zero Asset Values

**Cause**: Assets may be in wallets that haven't fully synced

**Solution**:
```javascript
// Filter out zero-value holdings
const validAssets = holdings.content.assets.filter(asset => {
  const value = parseFloat(asset.holdings.value.replace(/[$,]/g, ''));
  return value > 0;
});

console.log(`Active holdings: ${validAssets.length} of ${holdings.content.totalAssets}`);

// Check for sync issues
if (holdings.content.totalAssets > validAssets.length) {
  console.log("Some wallets may not be fully synced");
}
```

### Issue: Percentage Parsing Errors

**Cause**: Unrealized return percentage includes "%" symbol

**Solution**:
```javascript
// ✅ Correct parsing
const parsePercentage = (percentStr) => {
  return parseFloat(percentStr.replace('%', '').trim());
};

const returnPercent = parsePercentage(asset.unrealizedReturn.percentage);
const returnAmount = parseFloat(asset.unrealizedReturn.amount.replace(/[$,]/g, ''));

console.log(`Return: ${returnAmount} (${returnPercent}%)`);
```

### Issue: Tax Summary Empty or Incomplete

**Cause**: Tax data may not be available for all years

**Solution**:
```javascript
// Check for tax data
const taxData = summary.content.taxSummary || [];

if (taxData.length === 0) {
  console.log("No tax data available - ensure you're on CoinTracker Dashboard");
} else {
  taxData.forEach(year => {
    console.log(`${year.year}: Gains: ${year.gains}, Income: ${year.income}`);
  });
}
```

### Issue: Decimal Precision Issues in Calculations

**Cause**: JavaScript floating-point arithmetic precision

**Solution**:
```javascript
// ✅ Good: Use proper decimal handling
const Decimal = require('decimal.js');

const holdingValue = new Decimal(asset.holdings.value.replace(/[$,]/g, ''));
const quantity = new Decimal(asset.holdings.quantity);
const pricePerUnit = holdingValue.dividedBy(quantity);

console.log(`Price per unit: $${pricePerUnit.toFixed(2)}`);

// Or use simpler approaches
const total = parseFloat((100.1 + 0.2).toFixed(2));  // Avoid 100.30000000000001
```

---

## Related Documentation

- **[MACROS.md](./MACROS.md)** - Complete macro reference (57+ macros)
- **[FIDELITY_MACROS.md](./FIDELITY_MACROS.md)** - Fidelity-specific macros (14 macros)
- **[UPWORK_MACROS.md](./UPWORK_MACROS.md)** - Upwork-specific macros (14 macros)
- **[MULTI_TAB.md](./MULTI_TAB.md)** - Multi-tab workflow patterns
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Comprehensive troubleshooting guide

---

**Built with 🤨 by the Unibrowse team**
