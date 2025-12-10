# 🤨 Multi-Tab Workflow Patterns

Complete guide to managing multiple browser tabs for parallel operations, sequential workflows, and context preservation across conversations.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Tab Context Preservation](#tab-context-preservation)
3. [Parallel Comparison Pattern](#parallel-comparison-pattern)
4. [Sequential Scraping Pattern](#sequential-scraping-pattern)
5. [Form Preview Pattern](#form-preview-pattern)
6. [Cross-Tab Data Aggregation](#cross-tab-data-aggregation)
7. [Tab Lifecycle Management](#tab-lifecycle-management)
8. [Real-World Examples](#real-world-examples)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)

---

## Core Concepts

### Tab ID Preservation

**Critical Pattern**: Sub-agents create tabs → return tab IDs → main conversation stores → future delegations specify `tabTarget`

```javascript
// Sub-agent creates tab
const tab = await mcp__browser__browser_create_tab({ url: "https://example.com" });
const tabId = tab.content.tabId;

// Sub-agent labels tab
await mcp__browser__browser_set_tab_label({ tabTarget: tabId, label: "example-page" });

// Sub-agent returns tab metadata
return {
  tabId: tabId,
  label: "example-page",
  url: "https://example.com",
  data: { ... }
};

// Main conversation stores: exampleTab=123

// Future delegation uses preserved tab ID
// Delegate to browser with tabTarget=123
```

### Why Multi-Tab?

**Use multi-tab workflows when you need to:**

1. **Parallel Operations** - Compare prices across 3 sites simultaneously
2. **Context Switching** - Keep Amazon results open while checking Walmart
3. **Form Preview** - Keep form filled in one tab while getting user approval
4. **Data Aggregation** - Scrape 5 related pages and combine results
5. **A/B Testing** - Compare two versions of a page side-by-side
6. **Session Isolation** - Maintain separate login sessions per tab

---

## Tab Context Preservation

### Creating and Labeling Tabs

**Always label tabs for easy reference:**

```javascript
// Create tab
const tab = await mcp__browser__browser_create_tab({
  url: "https://amazon.com"
});

// Label immediately
await mcp__browser__browser_set_tab_label({
  tabTarget: tab.content.tabId,
  label: "amazon-search"
});

// Use label for future operations
await mcp__browser__browser_navigate({
  url: "https://amazon.com/s?k=headphones",
  tabTarget: "amazon-search"  // Can use label OR tab ID
});
```

### Listing Active Tabs

**Check what tabs are available:**

```javascript
// List all attached tabs
const tabs = await mcp__browser__browser_list_attached_tabs();

// Returns:
// {
//   tabs: [
//     { tabId: 123, label: "amazon-search", url: "https://amazon.com/...", lastUsed: 1234567890 },
//     { tabId: 456, label: "walmart-search", url: "https://walmart.com/...", lastUsed: 1234567891 }
//   ]
// }
```

### Getting Active Tab

**Find the currently active tab:**

```javascript
const activeTab = await mcp__browser__browser_get_active_tab();

// Returns:
// {
//   tabId: 123,
//   label: "amazon-search",
//   url: "https://amazon.com/...",
//   lastUsed: 1234567890
// }
```

### Switching Between Tabs

**Switch focus to a specific tab:**

```javascript
// Switch by tab ID
await mcp__browser__browser_switch_tab({ tabId: 123 });

// Or target by label in next operation
await mcp__browser__browser_snapshot({ tabTarget: "amazon-search" });
```

---

## Parallel Comparison Pattern

**Use Case**: Compare data across multiple sites simultaneously

### E-Commerce Price Comparison

```javascript
// 1. Create tabs for all sites
const amazonTab = await mcp__browser__browser_create_tab({ url: "https://amazon.com" });
const walmartTab = await mcp__browser__browser_create_tab({ url: "https://walmart.com" });
const bestbuyTab = await mcp__browser__browser_create_tab({ url: "https://bestbuy.com" });

// 2. Label all tabs
await mcp__browser__browser_set_tab_label({
  tabTarget: amazonTab.content.tabId,
  label: "amazon"
});
await mcp__browser__browser_set_tab_label({
  tabTarget: walmartTab.content.tabId,
  label: "walmart"
});
await mcp__browser__browser_set_tab_label({
  tabTarget: bestbuyTab.content.tabId,
  label: "bestbuy"
});

// 3. Search all sites in parallel
const [amazonResults, walmartResults, bestbuyResults] = await Promise.all([
  mcp__browser__browser_execute_macro({
    id: "amazon_search",
    params: { query: "iPhone 15" },
    tabTarget: "amazon"
  }),
  mcp__browser__browser_navigate({
    url: "https://walmart.com/search?q=iPhone+15",
    tabTarget: "walmart"
  }),
  mcp__browser__browser_navigate({
    url: "https://bestbuy.com/site/searchpage.jsp?st=iPhone+15",
    tabTarget: "bestbuy"
  })
]);

// 4. Extract products from all sites in parallel
const [amazonProducts, walmartProducts, bestbuyProducts] = await Promise.all([
  mcp__browser__browser_execute_macro({
    id: "amazon_get_listing_products",
    tabTarget: "amazon"
  }),
  mcp__browser__browser_execute_macro({
    id: "extract_products",
    tabTarget: "walmart"
  }),
  mcp__browser__browser_execute_macro({
    id: "extract_products",
    tabTarget: "bestbuy"
  })
]);

// 5. Return all tab metadata
return {
  tabs: [
    {
      tabId: amazonTab.content.tabId,
      label: "amazon",
      site: "amazon",
      products: amazonProducts.content.products,
      lowestPrice: findLowestPrice(amazonProducts.content.products)
    },
    {
      tabId: walmartTab.content.tabId,
      label: "walmart",
      site: "walmart",
      products: walmartProducts.content.products,
      lowestPrice: findLowestPrice(walmartProducts.content.products)
    },
    {
      tabId: bestbuyTab.content.tabId,
      label: "bestbuy",
      site: "bestbuy",
      products: bestbuyProducts.content.products,
      lowestPrice: findLowestPrice(bestbuyProducts.content.products)
    }
  ],
  comparison: {
    lowestPrice: {
      site: "walmart",
      price: "$749.99",
      savings: "$50.00"
    },
    bestRating: {
      site: "amazon",
      rating: 4.7
    }
  }
};
```

### QA Testing: Multi-Browser Visual Regression

```javascript
// 1. Create tabs for different viewports
const desktopTab = await mcp__browser__browser_create_tab({ url: testUrl });
const tabletTab = await mcp__browser__browser_create_tab({ url: testUrl });
const mobileTab = await mcp__browser__browser_create_tab({ url: testUrl });

// 2. Label tabs
await mcp__browser__browser_set_tab_label({
  tabTarget: desktopTab.content.tabId,
  label: "desktop-1920x1080"
});
await mcp__browser__browser_set_tab_label({
  tabTarget: tabletTab.content.tabId,
  label: "tablet-768x1024"
});
await mcp__browser__browser_set_tab_label({
  tabTarget: mobileTab.content.tabId,
  label: "mobile-375x667"
});

// 3. Set viewport sizes in parallel
await Promise.all([
  mcp__browser__browser_evaluate({
    expression: "window.resizeTo(1920, 1080)",
    tabTarget: "desktop-1920x1080"
  }),
  mcp__browser__browser_evaluate({
    expression: "window.resizeTo(768, 1024)",
    tabTarget: "tablet-768x1024"
  }),
  mcp__browser__browser_evaluate({
    expression: "window.resizeTo(375, 667)",
    tabTarget: "mobile-375x667"
  })
]);

// 4. Take screenshots in parallel
const [desktopScreenshot, tabletScreenshot, mobileScreenshot] = await Promise.all([
  mcp__browser__browser_screenshot({ tabTarget: "desktop-1920x1080" }),
  mcp__browser__browser_screenshot({ tabTarget: "tablet-768x1024" }),
  mcp__browser__browser_screenshot({ tabTarget: "mobile-375x667" })
]);

// 5. Return all screenshots with tab metadata
return {
  tabs: [
    { tabId: desktopTab.content.tabId, viewport: "1920x1080", screenshot: desktopScreenshot },
    { tabId: tabletTab.content.tabId, viewport: "768x1024", screenshot: tabletScreenshot },
    { tabId: mobileTab.content.tabId, viewport: "375x667", screenshot: mobileScreenshot }
  ]
};
```

---

## Sequential Scraping Pattern

**Use Case**: Navigate through pages in a single tab, preserving session state

### Web Scraper: Pagination Loop

```javascript
// 1. Create and label tab
const tab = await mcp__browser__browser_create_tab({ url: startUrl });
await mcp__browser__browser_set_tab_label({
  tabTarget: tab.content.tabId,
  label: "scraper-session"
});

const tabId = tab.content.tabId;
let allData = [];
let currentPage = 1;
const maxPages = 10;

// 2. Loop through pages sequentially
while (currentPage <= maxPages) {
  // Clean interruptions
  await mcp__browser__browser_execute_macro({
    id: "dismiss_interruptions",
    tabTarget: tabId
  });

  // Extract data from current page
  const pageData = await mcp__browser__browser_execute_macro({
    id: "extract_table_data",
    tabTarget: tabId
  });

  // Add to aggregated data
  allData = allData.concat(pageData.content.rows);

  // Check for next page
  const pagination = await mcp__browser__browser_execute_macro({
    id: "detect_pagination",
    tabTarget: tabId
  });

  if (!pagination.content.hasNextPage) {
    break;
  }

  // Navigate to next page (preserves session in same tab)
  await mcp__browser__browser_click({
    element: "Next page button",
    ref: pagination.content.nextButtonRef,
    tabTarget: tabId
  });

  // Wait for page load
  await mcp__browser__browser_wait({ time: 2, tabTarget: tabId });

  currentPage++;
}

// 3. Deduplicate and return
const uniqueData = deduplicateData(allData);

return {
  tabId: tabId,
  label: "scraper-session",
  data: {
    totalPages: currentPage,
    totalRows: uniqueData.length,
    rows: uniqueData
  }
};
```

### E-Commerce: Amazon Multi-Step Product Analysis

```javascript
// 1. Create tab for Amazon session
const tab = await mcp__browser__browser_create_tab({ url: "https://amazon.com" });
await mcp__browser__browser_set_tab_label({
  tabTarget: tab.content.tabId,
  label: "amazon-analysis"
});

const tabId = tab.content.tabId;

// 2. Step 1: Search
await mcp__browser__browser_execute_macro({
  id: "amazon_search",
  params: { query: "wireless headphones" },
  tabTarget: tabId
});

// 3. Step 2: Apply filters
await mcp__browser__browser_execute_macro({
  id: "amazon_apply_filter",
  params: { filterType: "price", value: "under-100" },
  tabTarget: tabId
});

await mcp__browser__browser_execute_macro({
  id: "amazon_apply_sort",
  params: { sortBy: "rating" },
  tabTarget: tabId
});

// 4. Step 3: Extract products
const products = await mcp__browser__browser_execute_macro({
  id: "amazon_get_listing_products",
  tabTarget: tabId
});

// 5. Step 4: Click first product
await mcp__browser__browser_execute_macro({
  id: "amazon_click_product",
  params: { index: 1 },
  tabTarget: tabId
});

// 6. Step 5: Get detailed product info
const productInfo = await mcp__browser__browser_execute_macro({
  id: "amazon_get_product_info",
  tabTarget: tabId
});

// 7. Step 6: Get reviews summary
const reviewsSummary = await mcp__browser__browser_execute_macro({
  id: "amazon_get_reviews_summary",
  tabTarget: tabId
});

// 8. Step 7: Ask Rufus for recommendations
const rufusRec = await mcp__browser__browser_execute_macro({
  id: "amazon_ask_rufus",
  params: { question: "What are similar products with better reviews?" },
  tabTarget: tabId
});

// 9. Return comprehensive analysis with tab preserved
return {
  tabId: tabId,
  label: "amazon-analysis",
  data: {
    searchResults: products.content.products,
    selectedProduct: productInfo.content,
    reviews: reviewsSummary.content,
    rufusRecommendations: rufusRec.content
  }
};
```

---

## Form Preview Pattern

**Use Case**: Fill form in one tab, get user approval, then submit using preserved tab ID

### Form Automation: Multi-Step Form with Approval

```javascript
// PHASE 1: Fill form and return preview

// 1. Create tab and navigate
const tab = await mcp__browser__browser_create_tab({ url: formUrl });
await mcp__browser__browser_set_tab_label({
  tabTarget: tab.content.tabId,
  label: "contact-form"
});

const tabId = tab.content.tabId;

// 2. Discover and analyze form
const forms = await mcp__browser__browser_execute_macro({
  id: "discover_forms",
  tabTarget: tabId
});

const formAnalysis = await mcp__browser__browser_execute_macro({
  id: "analyze_form_requirements",
  params: { formSelector: forms.content.forms[0].selector },
  tabTarget: tabId
});

// 3. Fill all fields
for (const field of formAnalysis.content.fields) {
  if (data[field.name]) {
    await mcp__browser__browser_type({
      element: field.label,
      ref: field.ref,
      text: data[field.name],
      submit: false,
      tabTarget: tabId
    });
  }
}

// 4. Generate preview (DO NOT SUBMIT YET)
const preview = {
  formAction: forms.content.forms[0].action,
  filledFields: formAnalysis.content.fields.map(f => ({
    name: f.name,
    label: f.label,
    value: data[f.name] || "(empty)",
    required: f.required
  }))
};

// 5. Return preview for user approval (TAB PRESERVED)
return {
  tabId: tabId,
  label: "contact-form",
  url: formUrl,
  action: "preview",
  submitted: false,
  data: {
    form: forms.content.forms[0],
    analysis: formAnalysis.content,
    preview: preview,
    instructions: "Review the preview above. To submit, confirm submission."
  }
};

// PHASE 2: User approves, submit using preserved tab ID
// (Future delegation)

// 1. Find submit button
const submitButton = await mcp__browser__browser_execute_macro({
  id: "find_element_by_description",
  params: { description: "submit button" },
  tabTarget: tabId  // Uses PRESERVED tab ID from Phase 1
});

// 2. Submit form
await mcp__browser__browser_submit_form({
  element: "Submit button",
  ref: submitButton.content.ref,
  tabTarget: tabId
});

// 3. Wait for confirmation
await mcp__browser__browser_wait({ time: 2, tabTarget: tabId });

// 4. Check for success message
const messages = await mcp__browser__browser_execute_macro({
  id: "detect_messages",
  tabTarget: tabId
});

// 5. Return confirmation
return {
  tabId: tabId,
  label: "contact-form",
  action: "submitted",
  submitted: true,
  data: {
    success: true,
    confirmationMessage: messages.content.success
  }
};
```

---

## Cross-Tab Data Aggregation

**Use Case**: Scrape related pages in parallel tabs, then aggregate results

### Web Scraper: Multi-Page Article Extraction

```javascript
// 1. Create tabs for all article pages
const articleUrls = [
  "https://blog.example.com/article-1",
  "https://blog.example.com/article-2",
  "https://blog.example.com/article-3",
  "https://blog.example.com/article-4"
];

const tabs = [];
for (let i = 0; i < articleUrls.length; i++) {
  const tab = await mcp__browser__browser_create_tab({ url: articleUrls[i] });
  await mcp__browser__browser_set_tab_label({
    tabTarget: tab.content.tabId,
    label: `article-${i + 1}`
  });
  tabs.push({
    tabId: tab.content.tabId,
    label: `article-${i + 1}`,
    url: articleUrls[i]
  });
}

// 2. Extract content from all tabs in parallel
const articles = await Promise.all(
  tabs.map(async (tab) => {
    // Clean interruptions
    await mcp__browser__browser_execute_macro({
      id: "dismiss_interruptions",
      tabTarget: tab.tabId
    });

    // Extract main content
    const content = await mcp__browser__browser_execute_macro({
      id: "extract_main_content",
      tabTarget: tab.tabId
    });

    // Get metadata
    const metadata = await mcp__browser__browser_execute_macro({
      id: "get_page_metadata",
      tabTarget: tab.tabId
    });

    return {
      url: tab.url,
      title: metadata.content.title,
      author: metadata.content.author,
      date: metadata.content.publishDate,
      content: content.content.mainContent,
      wordCount: content.content.mainContent.split(/\s+/).length
    };
  })
);

// 3. Aggregate data
const aggregatedData = {
  totalArticles: articles.length,
  totalWords: articles.reduce((sum, a) => sum + a.wordCount, 0),
  articles: articles,
  tabs: tabs
};

// 4. Export to JSON
const fs = require('fs');
fs.writeFileSync(
  '/tmp/articles-export.json',
  JSON.stringify(aggregatedData, null, 2)
);

// 5. Return summary with all tab metadata
return {
  tabs: tabs,
  data: aggregatedData,
  exportPath: '/tmp/articles-export.json'
};
```

---

## Tab Lifecycle Management

### Creating Tabs

```javascript
// Create with URL
const tab1 = await mcp__browser__browser_create_tab({
  url: "https://example.com"
});

// Create blank tab
const tab2 = await mcp__browser__browser_create_tab({
  url: "about:blank"
});
```

### Labeling Tabs

```javascript
// Initial labeling
await mcp__browser__browser_set_tab_label({
  tabTarget: tabId,
  label: "initial-label"
});

// Relabeling (e.g., after navigation to product page)
await mcp__browser__browser_set_tab_label({
  tabTarget: tabId,
  label: "product-details"
});
```

### Detaching Tabs

```javascript
// Detach when done (removes from managed tabs)
await mcp__browser__browser_detach_tab({
  tabId: tabId
});
```

### Closing Tabs

```javascript
// Close tab completely
await mcp__browser__browser_close_tab({
  tabId: tabId
});
```

### Cleanup Pattern

```javascript
// Always clean up tabs after operation
try {
  // ... perform operations ...
} finally {
  // Detach all tabs
  for (const tab of tabs) {
    await mcp__browser__browser_detach_tab({ tabId: tab.tabId });
  }
}
```

---

## Real-World Examples

### Example 1: Multi-Site Job Search Aggregation

```javascript
// User: "Find software engineer jobs in NYC on LinkedIn, Indeed, and Glassdoor"

const jobSites = [
  { name: "linkedin", url: "https://linkedin.com/jobs/search?keywords=software+engineer&location=NYC" },
  { name: "indeed", url: "https://indeed.com/jobs?q=software+engineer&l=NYC" },
  { name: "glassdoor", url: "https://glassdoor.com/Job/nyc-software-engineer-jobs-SRCH_IL.0,3_IC1132348_KO4,21.htm" }
];

// Create tabs
const tabs = await Promise.all(
  jobSites.map(async (site) => {
    const tab = await mcp__browser__browser_create_tab({ url: site.url });
    await mcp__browser__browser_set_tab_label({
      tabTarget: tab.content.tabId,
      label: site.name
    });
    return { ...site, tabId: tab.content.tabId };
  })
);

// Extract jobs in parallel
const jobs = await Promise.all(
  tabs.map(async (tab) => {
    const listings = await mcp__browser__browser_execute_macro({
      id: "extract_job_listings",
      tabTarget: tab.tabId
    });
    return {
      site: tab.name,
      jobs: listings.content.jobs
    };
  })
);

// Aggregate and deduplicate
const allJobs = jobs.flatMap(j => j.jobs);
const uniqueJobs = deduplicateByTitle(allJobs);

return {
  tabs: tabs,
  summary: {
    totalJobs: uniqueJobs.length,
    linkedin: jobs[0].jobs.length,
    indeed: jobs[1].jobs.length,
    glassdoor: jobs[2].jobs.length
  },
  jobs: uniqueJobs
};
```

### Example 2: Social Media Cross-Platform Posting

```javascript
// User: "Check my post reach on Twitter, LinkedIn, and Facebook"

const socialTabs = [
  { platform: "twitter", url: "https://twitter.com/user/status/123" },
  { platform: "linkedin", url: "https://linkedin.com/feed/update/urn:li:activity:456" },
  { platform: "facebook", url: "https://facebook.com/user/posts/789" }
];

// Create tabs
const tabs = await Promise.all(
  socialTabs.map(async (social) => {
    const tab = await mcp__browser__browser_create_tab({ url: social.url });
    await mcp__browser__browser_set_tab_label({
      tabTarget: tab.content.tabId,
      label: social.platform
    });
    return { ...social, tabId: tab.content.tabId };
  })
);

// Extract metrics in parallel
const metrics = await Promise.all(
  tabs.map(async (tab) => {
    const stats = await mcp__browser__browser_execute_macro({
      id: "extract_post_metrics",
      tabTarget: tab.tabId
    });
    return {
      platform: tab.platform,
      likes: stats.content.likes,
      comments: stats.content.comments,
      shares: stats.content.shares,
      reach: stats.content.reach
    };
  })
);

return {
  tabs: tabs,
  metrics: metrics,
  totalReach: metrics.reduce((sum, m) => sum + m.reach, 0)
};
```

### Example 3: A/B Testing Product Page Variations

```javascript
// User: "Compare conversion elements on variant A vs variant B"

// Create tabs for both variants
const variantA = await mcp__browser__browser_create_tab({
  url: "https://example.com/product?variant=A"
});
const variantB = await mcp__browser__browser_create_tab({
  url: "https://example.com/product?variant=B"
});

// Label tabs
await mcp__browser__browser_set_tab_label({
  tabTarget: variantA.content.tabId,
  label: "variant-A"
});
await mcp__browser__browser_set_tab_label({
  tabTarget: variantB.content.tabId,
  label: "variant-B"
});

// Extract conversion elements in parallel
const [elementsA, elementsB] = await Promise.all([
  mcp__browser__browser_execute_macro({
    id: "extract_conversion_elements",
    tabTarget: "variant-A"
  }),
  mcp__browser__browser_execute_macro({
    id: "extract_conversion_elements",
    tabTarget: "variant-B"
  })
]);

// Take screenshots in parallel
const [screenshotA, screenshotB] = await Promise.all([
  mcp__browser__browser_screenshot({ tabTarget: "variant-A" }),
  mcp__browser__browser_screenshot({ tabTarget: "variant-B" })
]);

// Compare
const comparison = {
  variantA: {
    ctaButton: elementsA.content.ctaButton,
    pricingDisplay: elementsA.content.pricing,
    trustBadges: elementsA.content.trustBadges,
    screenshot: screenshotA
  },
  variantB: {
    ctaButton: elementsB.content.ctaButton,
    pricingDisplay: elementsB.content.pricing,
    trustBadges: elementsB.content.trustBadges,
    screenshot: screenshotB
  },
  differences: identifyDifferences(elementsA.content, elementsB.content)
};

return {
  tabs: [
    { tabId: variantA.content.tabId, label: "variant-A" },
    { tabId: variantB.content.tabId, label: "variant-B" }
  ],
  comparison: comparison
};
```

---

## Best Practices

### 1. Always Label Tabs

```javascript
// ❌ DON'T: Unlabeled tabs are hard to track
const tab = await mcp__browser__browser_create_tab({ url: url });
// Now what? How do I reference this tab later?

// ✅ DO: Label immediately
const tab = await mcp__browser__browser_create_tab({ url: url });
await mcp__browser__browser_set_tab_label({
  tabTarget: tab.content.tabId,
  label: "descriptive-name"
});
```

### 2. Use Descriptive Labels

```javascript
// ❌ DON'T: Generic labels
label: "tab1", "tab2", "tab3"

// ✅ DO: Descriptive labels
label: "amazon-search", "walmart-comparison", "product-details"
```

### 3. Return Tab Metadata

```javascript
// ✅ ALWAYS return tab IDs for context preservation
return {
  tabId: tabId,
  label: "descriptive-name",
  url: currentUrl,
  data: { ... }
};
```

### 4. Clean Up After Operations

```javascript
// ✅ Detach tabs when done to avoid memory leaks
for (const tab of tabs) {
  await mcp__browser__browser_detach_tab({ tabId: tab.tabId });
}
```

### 5. Use Parallel Operations When Possible

```javascript
// ❌ DON'T: Sequential operations when parallel is possible
for (const tab of tabs) {
  await mcp__browser__browser_execute_macro({
    id: "extract_data",
    tabTarget: tab.tabId
  });
}

// ✅ DO: Parallel operations
const results = await Promise.all(
  tabs.map(tab =>
    mcp__browser__browser_execute_macro({
      id: "extract_data",
      tabTarget: tab.tabId
    })
  )
);
```

### 6. Handle Errors Gracefully

```javascript
// ✅ Handle tab-specific errors
const results = await Promise.allSettled(
  tabs.map(async (tab) => {
    try {
      return await mcp__browser__browser_execute_macro({
        id: "extract_data",
        tabTarget: tab.tabId
      });
    } catch (error) {
      return { error: error.message, tabId: tab.tabId };
    }
  })
);

// Filter successful results
const successful = results
  .filter(r => r.status === "fulfilled")
  .map(r => r.value);
```

### 7. Preserve Session State

```javascript
// ✅ Use same tab for operations that require session state
// (e.g., login, cookies, form state)

// Login in one tab
await loginToSite(tabId);

// Continue using same tab for authenticated operations
await fetchUserData(tabId);
await updateProfile(tabId);
```

---

## Troubleshooting

### Issue: "Tab not found"

**Problem**: Trying to use a tab ID that doesn't exist or was closed

**Solution**:
```javascript
// Check if tab exists before using
const tabs = await mcp__browser__browser_list_attached_tabs();
const tabExists = tabs.content.tabs.some(t => t.tabId === targetTabId);

if (!tabExists) {
  // Recreate tab or handle gracefully
  console.log("Tab no longer exists, creating new one");
  const newTab = await mcp__browser__browser_create_tab({ url: url });
  targetTabId = newTab.content.tabId;
}
```

### Issue: "Wrong tab targeted"

**Problem**: Accidentally using wrong tab ID

**Solution**:
```javascript
// Use labels instead of raw IDs for clarity
tabTarget: "amazon-search"  // Clear what tab you're targeting

// OR: Store tab mapping
const tabMap = {
  amazon: 123,
  walmart: 456,
  bestbuy: 789
};

await mcp__browser__browser_navigate({
  url: newUrl,
  tabTarget: tabMap.amazon
});
```

### Issue: "Session state lost"

**Problem**: Using different tabs when session continuity is needed

**Solution**:
```javascript
// ❌ DON'T: Create new tab for authenticated operation
const newTab = await mcp__browser__browser_create_tab({ url: authUrl });
// Session lost!

// ✅ DO: Reuse tab where you logged in
await mcp__browser__browser_navigate({
  url: authUrl,
  tabTarget: existingAuthenticatedTabId
});
```

### Issue: "Too many tabs open"

**Problem**: Memory issues from creating too many tabs

**Solution**:
```javascript
// ✅ Limit concurrent tabs
const MAX_CONCURRENT_TABS = 5;
const chunks = chunkArray(urls, MAX_CONCURRENT_TABS);

for (const chunk of chunks) {
  const tabs = await Promise.all(
    chunk.map(url => mcp__browser__browser_create_tab({ url }))
  );

  // Process tabs
  // ...

  // Clean up before next batch
  for (const tab of tabs) {
    await mcp__browser__browser_detach_tab({ tabId: tab.content.tabId });
  }
}
```

### Issue: "Tab operations timing out"

**Problem**: Operations taking too long in parallel

**Solution**:
```javascript
// ✅ Add timeout handling
const TIMEOUT = 30000; // 30 seconds

const results = await Promise.race([
  Promise.all(tabs.map(tab => performOperation(tab))),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), TIMEOUT)
  )
]);
```

---

## Summary

**Multi-tab patterns enable:**

✅ **Parallel comparison** - Compare data across sites simultaneously
✅ **Sequential workflows** - Navigate pages while preserving session state
✅ **Context preservation** - Keep tabs open across conversation turns
✅ **Data aggregation** - Combine results from multiple sources
✅ **Session isolation** - Maintain separate states per tab

**Key principles:**

1. Always label tabs with descriptive names
2. Return tab metadata for context preservation
3. Use parallel operations when possible
4. Clean up tabs after operations
5. Handle errors gracefully per tab
6. Preserve session state in same tab when needed

**See also:**

- [MACROS.md](./MACROS.md) - Complete macro reference
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues and solutions
- [../agents/browser.md](../agents/browser.md) - Generic browser agent
- [../agents/browser-ecommerce.md](../agents/browser-ecommerce.md) - E-commerce patterns
- [../agents/browser-scraper.md](../agents/browser-scraper.md) - Scraping patterns
