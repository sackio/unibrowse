# 🤨 Fidelity Macros Reference

Complete reference for all 14 Fidelity-specific macros used for portfolio management, account tracking, and investment data extraction.

## Table of Contents

1. [Overview](#overview)
2. [Position & Lot Macros (2)](#position--lot-macros)
3. [Account & Balance Macros (2)](#account--balance-macros)
4. [Activity & Transaction Macros (5)](#activity--transaction-macros)
5. [Portfolio Summary Macros (1)](#portfolio-summary-macros)
6. [Reporting Macros (2)](#reporting-macros)
7. [Complete Workflows](#complete-workflows)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

---

## Overview

**Fidelity macros** are specialized JavaScript functions stored in MongoDB that automate Fidelity-specific operations. They handle portfolio analysis, position tracking, account management, transaction monitoring, and investment reporting on the Fidelity platform.

**Total Fidelity Macros**: 14
- **Position & Lot Management**: 2 macros
- **Account & Balance**: 2 macros
- **Activity & Transactions**: 5 macros
- **Portfolio Summary**: 1 macro
- **Reporting**: 2 macros

**Site**: `fidelity.com`

**Usage Pattern**:
```javascript
// 1. List available macros
const macros = await mcp__browser__browser_list_macros({ site: "fidelity.com" });

// 2. Execute macro
const result = await mcp__browser__browser_execute_macro({
  id: "extract_all_positions_with_lots",
  params: {},
  tabTarget: tabId
});

// 3. Use results
console.log("Positions:", result.content.positions);
```

---

## Position & Lot Macros

### `expand_all_positions`

**Description**: Expand all position rows on Fidelity positions page to reveal lot details

**Site**: `fidelity.com`

**Category**: interaction

**Parameters**:
- `delayBetweenClicks` (number, optional): Milliseconds to wait between expanding each position (default: 500ms)

**Returns**:
```javascript
{
  "success": true,
  "totalPositions": 12,
  "expandedCount": 12,
  "showAllButtonsFound": 8,
  "showAllClicked": 8
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "expand_all_positions",
  params: { delayBetweenClicks: 1000 },
  tabTarget: tabId
});

console.log(`Expanded ${result.content.expandedCount} positions`);
console.log(`Clicked ${result.content.showAllClicked} Show All buttons`);
```

**Use Cases**:
- Prepare positions page for data extraction
- Reveal all lot details at once
- Load complete transaction history for positions
- Prepare for detailed position analysis

**Notes**:
- Automatically expands collapsed position rows
- Clicks "Show All" buttons to reveal complete lot history
- Uses delays to allow page rendering
- Must run before `extract_all_positions_with_lots` for complete data

---

### `extract_all_positions_with_lots`

**Description**: Extract all positions with complete lot details from Fidelity positions page

**Site**: `fidelity.com`

**Category**: extraction

**Parameters**: None

**Returns**:
```javascript
{
  "totalPositions": 12,
  "positions": [
    {
      "symbol": "AAPL",
      "description": "Apple Inc",
      "lotCount": 4,
      "lots": [
        {
          "acquired": "Jan-15-2023",
          "term": "Long",
          "gainLossDollar": "+$2,150.50",
          "gainLossPercent": "+18.5%",
          "currentValue": "$14,320.00",
          "quantity": "100",
          "avgCostBasis": "$119.50",
          "costBasisTotal": "$11,950.00"
        },
        {
          "acquired": "Jun-22-2023",
          "term": "Long",
          "gainLossDollar": "+$1,245.25",
          "gainLossPercent": "+12.3%",
          "currentValue": "$11,425.75",
          "quantity": "75",
          "avgCostBasis": "$133.65",
          "costBasisTotal": "$10,024.75"
        }
      ]
    }
  ],
  "timestamp": "2025-12-10T15:30:00.000Z"
}
```

**Example**:
```javascript
// First expand all positions
await mcp__browser__browser_execute_macro({
  id: "expand_all_positions",
  tabTarget: tabId
});

// Then extract data
const result = await mcp__browser__browser_execute_macro({
  id: "extract_all_positions_with_lots",
  tabTarget: tabId
});

// Analyze gains
const totalGains = result.content.positions.reduce((sum, pos) =>
  sum + pos.lots.reduce((lotSum, lot) => {
    const gain = lot.gainLossDollar.replace(/[$+,]/g, '');
    return lotSum + parseFloat(gain);
  }, 0), 0
);

console.log(`Total gains: $${totalGains.toFixed(2)}`);
```

**Use Cases**:
- Complete portfolio analysis with all lots
- Tax loss harvesting analysis
- Cost basis verification
- Long-term vs short-term gains analysis
- Rebalancing decisions based on lot details

**Notes**:
- Requires positions to be expanded first
- Extracts all lot-level details
- Separates short-term and long-term gains
- Includes acquisition dates for tax planning
- Works best after running `expand_all_positions`

---

## Account & Balance Macros

### `extract_accounts_and_balances`

**Description**: Extract all account names, numbers, balances, and gains/losses from Fidelity account selector

**Site**: `fidelity.com`

**Category**: extraction

**Parameters**: None

**Returns**:
```javascript
{
  "success": true,
  "timestamp": "2025-12-10T15:30:00.000Z",
  "totalAccounts": 4,
  "accounts": [
    {
      "type": "Summary",
      "name": "All accounts",
      "accountNumber": null,
      "balance": "405,929.45",
      "gainsLosses": "+$6,618.82",
      "gainsLossesPercent": "+1.66%"
    },
    {
      "type": "TAXABLE",
      "accountNumber": "84651377",
      "balance": "405,929.45",
      "gainsLosses": "+$6,618.82",
      "gainsLossesPercent": "+1.66%"
    },
    {
      "type": "ROTH IRA",
      "accountNumber": "227456733",
      "balance": "59,464.58",
      "gainsLosses": "$0.00",
      "gainsLossesPercent": "0.00%"
    }
  ]
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "extract_accounts_and_balances",
  tabTarget: tabId
});

// Calculate total portfolio value
const accounts = result.content.accounts.filter(a => a.name !== "All accounts");
const totalBalance = accounts.reduce((sum, a) => {
  const balance = a.balance.replace(/,/g, '');
  return sum + parseFloat(balance);
}, 0);

console.log(`Total portfolio: $${totalBalance.toFixed(2)}`);

// Find accounts with gains
const profitable = accounts.filter(a =>
  parseFloat(a.gainsLosses) > 0
);

console.log(`${profitable.length} accounts with gains`);
```

**Use Cases**:
- Portfolio overview across all accounts
- Account balance tracking
- Performance monitoring by account
- Tax-advantaged account review
- Rebalancing decisions

**Notes**:
- Includes summary of all accounts
- Parses account types (TAXABLE, ROTH IRA, etc.)
- Extracts account numbers for reference
- Shows both dollar and percentage gains/losses
- Works with account selector panel expanded

---

### `generate_account_summary_report`

**Description**: Generate comprehensive summary report across all accounts with performance metrics

**Site**: `fidelity.com`

**Category**: reporting

**Parameters**:
- `includePreviousDay` (boolean, optional): Include previous day change (default: true)
- `includeMonthly` (boolean, optional): Include month-to-date change (default: true)
- `includeYearly` (boolean, optional): Include year-to-date change (default: true)

**Returns**:
```javascript
{
  "success": true,
  "reportDate": "2025-12-10T15:30:00.000Z",
  "summary": {
    "totalBalance": "$465,394.03",
    "totalGains": "+$6,618.82",
    "totalGainsPercent": "+1.66%",
    "accountCount": 3
  },
  "byTimeframe": {
    "previousDay": {
      "change": "+$245.50",
      "changePercent": "+0.05%"
    },
    "monthToDate": {
      "change": "+$2,150.25",
      "changePercent": "+0.47%"
    },
    "yearToDate": {
      "change": "+$6,618.82",
      "changePercent": "+1.66%"
    }
  },
  "accountBreakdown": [
    {
      "type": "TAXABLE",
      "number": "84651377",
      "balance": "$405,929.45",
      "percentage": "87.2%"
    }
  ]
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "generate_account_summary_report",
  params: {
    includePreviousDay: true,
    includeMonthly: true,
    includeYearly: true
  },
  tabTarget: tabId
});

console.log("Portfolio Summary:");
console.log(`Total: ${result.content.summary.totalBalance}`);
console.log(`YTD Gains: ${result.content.byTimeframe.yearToDate.change}`);
```

**Use Cases**:
- Quick portfolio health check
- Performance monitoring over time
- Reporting to advisors
- Investment decision support
- Regular portfolio reviews

**Notes**:
- Aggregates all accounts
- Shows multiple timeframe comparisons
- Includes percentage breakdowns
- Useful for periodic reporting

---

## Activity & Transaction Macros

### `extract_activities`

**Description**: Extract all activities and transactions from Fidelity Activity page with current filters

**Site**: `fidelity.com`

**Category**: extraction

**Parameters**: None

**Returns**:
```javascript
{
  "success": true,
  "timestamp": "2025-12-10T15:30:00.000Z",
  "totalActivities": 23,
  "activities": [
    {
      "date": "Dec-05-2025",
      "accountType": "TAXABLE",
      "accountNumber": "84651377",
      "description": "Dividend Received - APPLE INC",
      "amount": "$23.50",
      "rawAccount": "TAXABLE ACCT *84651377"
    },
    {
      "date": "Dec-03-2025",
      "accountType": "ROTH IRA",
      "accountNumber": "227456733",
      "description": "Bought 10 shares of VTI @ $254.32",
      "amount": "-$2,543.20",
      "rawAccount": "ROTH IRA ACCT *227456733"
    }
  ]
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "extract_activities",
  tabTarget: tabId
});

// Filter for dividend income
const dividends = result.content.activities.filter(a =>
  a.description.includes("Dividend")
);

const totalDividends = dividends.reduce((sum, d) => {
  const amount = parseFloat(d.amount.replace(/[$,]/g, ''));
  return sum + amount;
}, 0);

console.log(`Total dividends: $${totalDividends.toFixed(2)}`);

// Filter for purchases
const purchases = result.content.activities.filter(a =>
  a.description.includes("Bought") || a.description.includes("Purchased")
);

console.log(`Purchases this period: ${purchases.length}`);
```

**Use Cases**:
- Transaction history review
- Dividend tracking
- Tax documentation
- Cost basis verification
- Portfolio activity analysis

**Notes**:
- Works with current date filter settings
- Extracts transactions from visible page
- Includes both buy and sell transactions
- Shows dividend and interest income
- Tracks deposits and withdrawals

---

### `extract_activities_ytd_2025`

**Description**: Automatically set date filter to 2025 YTD and extract all activities

**Site**: `fidelity.com`

**Category**: extraction

**Parameters**:
- `waitDelay` (number, optional): Milliseconds to wait for page updates (default: 2000ms)

**Returns**:
```javascript
{
  "success": true,
  "activities": [
    {
      "date": "Dec-05-2025",
      "accountType": "TAXABLE",
      "accountNumber": "84651377",
      "description": "Dividend Received - APPLE INC",
      "amount": "$23.50"
    }
  ],
  "totalActivities": 45,
  "timestamp": "2025-12-10T15:30:00.000Z",
  "filterApplied": "2025 YTD"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "extract_activities_ytd_2025",
  params: { waitDelay: 3000 },
  tabTarget: tabId
});

console.log(`Found ${result.content.totalActivities} activities in 2025`);

// Calculate total purchases
const purchases = result.content.activities.filter(a =>
  parseFloat(a.amount) < 0 && a.description.includes("Bought")
);

const totalInvested = purchases.reduce((sum, p) =>
  sum + Math.abs(parseFloat(p.amount.replace(/[$,]/g, ''))), 0
);

console.log(`Total invested in 2025: $${totalInvested.toFixed(2)}`);
```

**Use Cases**:
- Year-to-date tax planning
- Annual investment summary
- 2025 performance analysis
- Tax-loss harvesting opportunities
- Year-end reporting

**Notes**:
- Automatically applies 2025 YTD filter
- Extracts complete activity list for year
- Useful for tax preparation
- Includes all transaction types for year

---

### `extract_all_activities_with_scroll`

**Description**: Scroll through entire Activity page to load all transactions and extract complete history

**Site**: `fidelity.com`

**Category**: extraction

**Parameters**:
- `scrollDelay` (number, optional): Milliseconds between scrolls for lazy loading (default: 1500ms)
- `maxScrolls` (number, optional): Maximum scroll attempts to prevent infinite loops (default: 50)

**Returns**:
```javascript
{
  "success": true,
  "activities": [
    {
      "date": "Dec-05-2025",
      "accountType": "TAXABLE",
      "description": "Dividend Received - APPLE INC",
      "amount": "$23.50"
    }
  ],
  "totalActivitiesLoaded": 127,
  "scrollAttemptsUsed": 8,
  "message": "Successfully loaded 127 activities after 8 scrolls",
  "timestamp": "2025-12-10T15:30:00.000Z"
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "extract_all_activities_with_scroll",
  params: {
    scrollDelay: 1000,
    maxScrolls: 50
  },
  tabTarget: tabId
});

console.log(`Loaded ${result.content.totalActivitiesLoaded} total activities`);
console.log(`Used ${result.content.scrollAttemptsUsed} scrolls`);

// Analyze all transactions
const totalCost = result.content.activities.reduce((sum, a) => {
  const amount = parseFloat(a.amount.replace(/[$,]/g, ''));
  return sum + (amount < 0 ? Math.abs(amount) : 0);
}, 0);

console.log(`Total purchases: $${totalCost.toFixed(2)}`);
```

**Use Cases**:
- Complete transaction history extraction
- Comprehensive tax documentation
- Long-term performance analysis
- Detailed cost basis research
- Complete portfolio audit

**Notes**:
- Handles lazy-loading page structure
- Continues until no new activities load
- Safeguard against infinite scrolling
- Works with any date filter applied
- Best for comprehensive historical analysis

---

### `categorize_activities_by_type`

**Description**: Extract and categorize all activities by transaction type (dividends, purchases, sales, etc.)

**Site**: `fidelity.com`

**Category**: utility

**Parameters**:
- `detailLevel` (string, optional): "summary" or "detailed" (default: "detailed")

**Returns**:
```javascript
{
  "success": true,
  "totalActivities": 127,
  "timestamp": "2025-12-10T15:30:00.000Z",
  "byType": {
    "dividends": {
      "count": 12,
      "total": "$245.75",
      "activities": [
        {
          "date": "Dec-05-2025",
          "description": "Dividend Received - APPLE INC",
          "amount": "$23.50",
          "security": "AAPL"
        }
      ]
    },
    "purchases": {
      "count": 18,
      "total": "-$45,320.50",
      "activities": []
    },
    "sales": {
      "count": 5,
      "total": "$8,450.25",
      "activities": []
    },
    "deposits": {
      "count": 8,
      "total": "$50,000.00",
      "activities": []
    },
    "withdrawals": {
      "count": 2,
      "total": "-$5,000.00",
      "activities": []
    }
  }
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "categorize_activities_by_type",
  params: { detailLevel: "detailed" },
  tabTarget: tabId
});

console.log("Activity Summary:");
console.log(`Dividends: ${result.content.byType.dividends.total}`);
console.log(`Purchases: ${result.content.byType.purchases.total}`);
console.log(`Sales: ${result.content.byType.sales.total}`);

// Calculate net contribution
const deposits = parseFloat(result.content.byType.deposits.total.replace(/[$,]/g, ''));
const withdrawals = Math.abs(parseFloat(result.content.byType.withdrawals.total.replace(/[$,]/g, '')));
const netContribution = deposits - withdrawals;

console.log(`Net contribution: $${netContribution.toFixed(2)}`);
```

**Use Cases**:
- Tax planning and analysis
- Income tracking (dividends, interest)
- Investment activity review
- Cost basis analysis
- Performance attribution

**Notes**:
- Automatically categorizes transaction types
- Provides both summary and detailed views
- Calculates totals by category
- Useful for tax preparation
- Helps identify dividend income and capital gains

---

## Portfolio Summary Macros

### `extract_portfolio_summary`

**Description**: Extract portfolio summary with totals, holdings, and performance metrics

**Site**: `fidelity.com`

**Category**: extraction

**Parameters**: None

**Returns**:
```javascript
{
  "success": true,
  "timestamp": "2025-12-10T15:30:00.000Z",
  "summary": {
    "totalValue": "$465,394.03",
    "totalGains": "+$6,618.82",
    "totalGainsPercent": "+1.66%",
    "changeToday": "+$245.50",
    "changeTodayPercent": "+0.05%"
  },
  "holdingsByType": {
    "stocks": {
      "count": 8,
      "value": "$320,500.00",
      "percentage": "68.8%"
    },
    "funds": {
      "count": 5,
      "value": "$144,894.03",
      "percentage": "31.2%"
    }
  },
  "topPositions": [
    {
      "symbol": "AAPL",
      "name": "Apple Inc",
      "value": "$65,250.00",
      "percentage": "14.0%"
    }
  ]
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "extract_portfolio_summary",
  tabTarget: tabId
});

console.log("Portfolio Overview:");
console.log(`Total Value: ${result.content.summary.totalValue}`);
console.log(`YTD Gains: ${result.content.summary.totalGains}`);
console.log(`Today's Change: ${result.content.summary.changeToday}`);
```

**Use Cases**:
- Quick portfolio health check
- Daily performance monitoring
- Asset allocation review
- Top holdings identification
- Performance reporting

**Notes**:
- Summary of entire portfolio
- Includes daily and YTD performance
- Shows asset type breakdown
- Lists top positions for quick reference

---

## Reporting Macros

### `generate_tax_report`

**Description**: Generate tax report showing capital gains, dividends, and other tax-relevant information

**Site**: `fidelity.com`

**Category**: reporting

**Parameters**:
- `taxYear` (number, optional): Tax year (default: current year)
- `includeShortTerm` (boolean, optional): Include short-term gains (default: true)
- `includeLongTerm` (boolean, optional): Include long-term gains (default: true)

**Returns**:
```javascript
{
  "success": true,
  "taxYear": 2025,
  "timestamp": "2025-12-10T15:30:00.000Z",
  "summary": {
    "shortTermGains": "$1,245.50",
    "longTermGains": "$5,373.32",
    "totalCapitalGains": "$6,618.82",
    "dividendIncome": "$245.75",
    "interestIncome": "$125.30",
    "totalIncome": "$6,989.87"
  },
  "byAccount": [
    {
      "accountType": "TAXABLE",
      "number": "84651377",
      "shortTermGains": "$1,245.50",
      "longTermGains": "$5,373.32",
      "dividends": "$245.75"
    }
  ],
  "realizationsList": [
    {
      "security": "AAPL",
      "soldDate": "2025-11-15",
      "costBasis": "$4,500.00",
      "proceeds": "$5,245.50",
      "gain": "$745.50",
      "holdingPeriod": "long-term"
    }
  ]
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "generate_tax_report",
  params: {
    taxYear: 2025,
    includeShortTerm: true,
    includeLongTerm: true
  },
  tabTarget: tabId
});

console.log("2025 Tax Summary:");
console.log(`Short-term gains: ${result.content.summary.shortTermGains}`);
console.log(`Long-term gains: ${result.content.summary.longTermGains}`);
console.log(`Total income: ${result.content.summary.totalIncome}`);

// Export to tax preparer
const taxData = JSON.stringify(result.content, null, 2);
console.log(taxData);
```

**Use Cases**:
- Tax preparation and filing
- CPA documentation
- Tax-loss harvesting opportunities
- Quarterly estimated tax payments
- Tax planning decisions

**Notes**:
- Separates short-term and long-term gains
- Includes all income sources
- Details all security sales
- Organized by account for accuracy

---

### `generate_performance_report`

**Description**: Generate comprehensive performance report with benchmarks and attribution

**Site**: `fidelity.com`

**Category**: reporting

**Parameters**:
- `period` (string, optional): "ytd", "1year", "3year", "5year", "10year" (default: "ytd")
- `includeBenchmark` (boolean, optional): Include benchmark comparison (default: true)
- `includeAttribution` (boolean, optional): Include performance attribution by holding (default: true)

**Returns**:
```javascript
{
  "success": true,
  "period": "ytd",
  "reportDate": "2025-12-10T15:30:00.000Z",
  "performance": {
    "totalReturn": "+1.66%",
    "absoluteReturn": "+$6,618.82",
    "contributions": "$50,000.00",
    "startingBalance": "$408,775.21",
    "endingBalance": "$465,394.03"
  },
  "benchmark": {
    "index": "S&P 500",
    "return": "+2.34%",
    "variance": "-0.68%",
    "outperformance": "Underperformed benchmark by 0.68%"
  },
  "topContributors": [
    {
      "symbol": "AAPL",
      "contribution": "+$2,150.50",
      "percentage": "32.5%"
    }
  ],
  "topDetractors": [
    {
      "symbol": "TSLA",
      "contribution": "-$845.25",
      "percentage": "12.8%"
    }
  ]
}
```

**Example**:
```javascript
const result = await mcp__browser__browser_execute_macro({
  id: "generate_performance_report",
  params: {
    period: "ytd",
    includeBenchmark: true,
    includeAttribution: true
  },
  tabTarget: tabId
});

console.log("Performance Analysis:");
console.log(`Return: ${result.content.performance.totalReturn}`);
console.log(`vs S&P 500: ${result.content.benchmark.outperformance}`);

console.log("\nTop Performers:");
result.content.topContributors.forEach(c => {
  console.log(`${c.symbol}: ${c.contribution}`);
});
```

**Use Cases**:
- Performance monitoring
- Investment strategy review
- Rebalancing decisions
- Advisor communication
- Annual review reporting

**Notes**:
- Multiple time periods available
- Compares to market benchmarks
- Attribution by individual holdings
- Shows contribution vs. detraction

---

## Complete Workflows

### Workflow 1: Complete Portfolio Analysis

```javascript
// Step 1: Expand all positions
await mcp__browser__browser_execute_macro({
  id: "expand_all_positions",
  params: { delayBetweenClicks: 800 },
  tabTarget: tabId
});

// Step 2: Extract positions with lots
const positions = await mcp__browser__browser_execute_macro({
  id: "extract_all_positions_with_lots",
  tabTarget: tabId
});

// Step 3: Extract accounts and balances
const accounts = await mcp__browser__browser_execute_macro({
  id: "extract_accounts_and_balances",
  tabTarget: tabId
});

// Step 4: Get portfolio summary
const summary = await mcp__browser__browser_execute_macro({
  id: "extract_portfolio_summary",
  tabTarget: tabId
});

// Step 5: Generate tax report
const taxReport = await mcp__browser__browser_execute_macro({
  id: "generate_tax_report",
  params: { taxYear: 2025 },
  tabTarget: tabId
});

console.log("Portfolio Summary:", summary.content.summary);
console.log("Tax Summary:", taxReport.content.summary);
```

### Workflow 2: Tax-Loss Harvesting Analysis

```javascript
// Step 1: Expand positions
await mcp__browser__browser_execute_macro({
  id: "expand_all_positions",
  tabTarget: tabId
});

// Step 2: Extract detailed lots
const positions = await mcp__browser__browser_execute_macro({
  id: "extract_all_positions_with_lots",
  tabTarget: tabId
});

// Step 3: Find tax-loss opportunities
const losses = positions.content.positions
  .flatMap(pos =>
    pos.lots
      .filter(lot => lot.gainLossDollar.includes("-"))
      .map(lot => ({
        symbol: pos.symbol,
        loss: lot.gainLossDollar,
        lossPercent: lot.gainLossPercent,
        acquired: lot.acquired
      }))
  );

console.log("Tax-loss opportunities:");
losses.forEach(loss => {
  console.log(`${loss.symbol}: ${loss.loss} (${loss.lossPercent})`);
});

// Step 4: Generate tax report for comparison
const taxReport = await mcp__browser__browser_execute_macro({
  id: "generate_tax_report",
  params: { taxYear: 2025 },
  tabTarget: tabId
});

const currentGains = parseFloat(taxReport.content.summary.totalCapitalGains.replace(/[$,]/g, ''));
console.log(`Current gains to offset: $${currentGains.toFixed(2)}`);
```

### Workflow 3: Performance and Activity Review

```javascript
// Step 1: Get account summary
const accounts = await mcp__browser__browser_execute_macro({
  id: "extract_accounts_and_balances",
  tabTarget: tabId
});

// Step 2: Extract all activities with scroll
const activities = await mcp__browser__browser_execute_macro({
  id: "extract_all_activities_with_scroll",
  params: { scrollDelay: 1000 },
  tabTarget: tabId
});

// Step 3: Categorize activities
const categorized = await mcp__browser__browser_execute_macro({
  id: "categorize_activities_by_type",
  params: { detailLevel: "detailed" },
  tabTarget: tabId
});

// Step 4: Generate performance report
const performance = await mcp__browser__browser_execute_macro({
  id: "generate_performance_report",
  params: {
    period: "ytd",
    includeBenchmark: true,
    includeAttribution: true
  },
  tabTarget: tabId
});

console.log("Activity Summary:", categorized.content.byType);
console.log("Performance:", performance.content.performance);
```

---

## Best Practices

### 1. Always Expand Positions First

Always expand positions before extracting lot details:

```javascript
// ✅ Good: Expand then extract
await mcp__browser__browser_execute_macro({
  id: "expand_all_positions",
  tabTarget: tabId
});

const data = await mcp__browser__browser_execute_macro({
  id: "extract_all_positions_with_lots",
  tabTarget: tabId
});

// ❌ Bad: Extract without expanding
const data = await mcp__browser__browser_execute_macro({
  id: "extract_all_positions_with_lots",
  tabTarget: tabId
});
```

### 2. Use Scroll Extraction for Comprehensive History

For complete transaction history, use scroll extraction:

```javascript
// ✅ Good: Scroll for complete data
const all = await mcp__browser__browser_execute_macro({
  id: "extract_all_activities_with_scroll"
});

// ❌ Bad: Limited to visible page
const activities = await mcp__browser__browser_execute_macro({
  id: "extract_activities"
});
```

### 3. Categorize Before Analyzing

Always categorize activities for structured analysis:

```javascript
// ✅ Good: Categorize activities
const categorized = await mcp__browser__browser_execute_macro({
  id: "categorize_activities_by_type",
  params: { detailLevel: "detailed" }
});

const dividends = categorized.content.byType.dividends.total;

// ❌ Bad: Manual parsing of activities
const activities = await mcp__browser__browser_execute_macro({
  id: "extract_activities"
});
```

### 4. Use Report Macros for Official Documents

For tax or advisory purposes, use dedicated report macros:

```javascript
// ✅ Good: Dedicated report macro
const taxReport = await mcp__browser__browser_execute_macro({
  id: "generate_tax_report",
  params: { taxYear: 2025 }
});

// ❌ Bad: Manual data compilation
const activities = await mcp__browser__browser_execute_macro({
  id: "extract_activities_ytd_2025"
});
```

---

## Troubleshooting

### Issue: Expand Positions Returns 0 Expanded

**Cause**: Positions already expanded or page structure changed

**Solution**:
```javascript
// Check current state first
const snapshot = await mcp__browser__browser_snapshot({ tabTarget: tabId });

// Manually expand if needed, then try again
const result = await mcp__browser__browser_execute_macro({
  id: "expand_all_positions",
  params: { delayBetweenClicks: 1000 },
  tabTarget: tabId
});

if (result.content.expandedCount === 0) {
  console.log("Positions may already be expanded");
}
```

### Issue: Extract Activities Returns Empty

**Cause**: Activity page not loaded or no activities in selected date range

**Solution**:
```javascript
// Wait for page load
await new Promise(resolve => setTimeout(resolve, 2000));

// Then extract
const activities = await mcp__browser__browser_execute_macro({
  id: "extract_activities",
  tabTarget: tabId
});

if (activities.content.totalActivities === 0) {
  // Try with scroll to load more
  const withScroll = await mcp__browser__browser_execute_macro({
    id: "extract_all_activities_with_scroll",
    tabTarget: tabId
  });
}
```

### Issue: Tax Report Missing Data

**Cause**: Different tax year selected or no sales occurred

**Solution**:
```javascript
// Verify tax year
const report = await mcp__browser__browser_execute_macro({
  id: "generate_tax_report",
  params: {
    taxYear: 2025,
    includeShortTerm: true,
    includeLongTerm: true
  },
  tabTarget: tabId
});

// Check if trades exist
const activities = await mcp__browser__browser_execute_macro({
  id: "categorize_activities_by_type",
  tabTarget: tabId
});

console.log("Sales count:", activities.content.byType.sales.count);
```

---

## Related Documentation

- **[MACROS.md](./MACROS.md)** - Complete macro reference (57+ macros)
- **[UPWORK_MACROS.md](./UPWORK_MACROS.md)** - Upwork-specific macros
- **[GOOGLE_SHOPPING_MACROS.md](./GOOGLE_SHOPPING_MACROS.md)** - Google Shopping macros
- **[MULTI_TAB.md](./MULTI_TAB.md)** - Multi-tab workflow patterns
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Comprehensive troubleshooting guide

---

**Built with 🤨 by the Unibrowse team**
