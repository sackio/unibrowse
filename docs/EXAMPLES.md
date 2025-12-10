# 🤨 Usage Examples

Complete real-world examples for all 5 unibrowse sub-agents.

## Table of Contents

- [Browser Agent (Generic)](#browser-agent-generic)
- [E-Commerce Agent](#e-commerce-agent)
- [Form Automation Agent](#form-automation-agent)
- [Web Scraper Agent](#web-scraper-agent)
- [QA Testing Agent](#qa-testing-agent)
- [Multi-Agent Workflows](#multi-agent-workflows)

---

## Browser Agent (Generic)

The generic browser agent handles navigation, screenshots, tab management, and basic interactions.

### Example 1: Take Screenshot

**Prompt**:
```
"Take a screenshot of example.com"
```

**What Happens**:
1. Browser skill recognizes "screenshot" → delegates to browser agent
2. Agent creates tab, labels it "example-page"
3. Agent navigates to example.com
4. Agent captures screenshot via `browser_screenshot`
5. Agent returns screenshot + tab ID

**Result**:
```
📸 Screenshot saved to /tmp/screenshot-20251210-143352.png
Tab ID: 123 (example-page)
```

**Follow-up**:
```
"Click the login button"
# Uses preserved tab 123
```

### Example 2: Navigate and Interact

**Prompt**:
```
"Navigate to github.com/anthropics and click the 'Repositories' tab"
```

**What Happens**:
1. Agent creates tab, navigates to URL
2. Agent uses `find_element_by_description` macro to locate "Repositories tab"
3. Agent clicks element
4. Agent returns confirmation + tab ID

**Result**:
```
✓ Navigated to github.com/anthropics
✓ Clicked 'Repositories' tab
Tab ID: 124 (github-anthropics)
```

### Example 3: Extract Links

**Prompt**:
```
"Get all links from example.com/blog"
```

**What Happens**:
1. Agent creates tab, navigates
2. Agent uses `extract_links` macro
3. Agent returns structured link list

**Result**:
```
Found 25 links:
1. https://example.com/blog/post-1 - "How to Build Apps"
2. https://example.com/blog/post-2 - "Best Practices"
...

Tab ID: 125 (example-blog)
```

### Example 4: Multi-Tab Management

**Prompt**:
```
"Open three tabs: google.com, github.com, and stackoverflow.com"
```

**What Happens**:
1. Agent creates 3 tabs in parallel
2. Agent labels each tab descriptively
3. Agent returns all tab IDs

**Result**:
```
✓ Created 3 tabs:
- Tab 126 (google): google.com
- Tab 127 (github): github.com
- Tab 128 (stackoverflow): stackoverflow.com
```

**Follow-up**:
```
"Take screenshots of all three tabs"
# Agent uses preserved tab IDs
```

---

## E-Commerce Agent

The e-commerce agent specializes in Amazon shopping, price comparison, and product research.

### Example 1: Amazon Product Search

**Prompt**:
```
"Search Amazon for wireless headphones under $100 with good reviews"
```

**What Happens**:
1. Browser skill recognizes "Amazon" → delegates to e-commerce agent
2. Agent creates tab, navigates to amazon.com
3. Agent uses `amazon_search` macro with query "wireless headphones"
4. Agent uses `amazon_apply_filter` macro for price: under $100
5. Agent uses `amazon_apply_sort` macro to sort by rating
6. Agent uses `amazon_get_listing_products` macro to extract results
7. Agent returns top products + tab ID

**Result**:
```
Found 50 wireless headphones under $100:

Top 5 by rating:
1. Sony WH-CH520 - $58.00 ⭐ 4.6 (8,234 reviews)
2. JBL Tune 510BT - $29.95 ⭐ 4.5 (12,456 reviews)
3. Anker Soundcore Q20 - $59.99 ⭐ 4.6 (5,678 reviews)
4. Skullcandy Hesh 3 - $79.99 ⭐ 4.4 (3,421 reviews)
5. Tribit XFree Tune - $39.99 ⭐ 4.5 (6,789 reviews)

Tab ID: 129 (amazon-headphones)
```

**Follow-up**:
```
"Get detailed specs and reviews for the Sony option"
# Agent uses tab 129, clicks first product, extracts details
```

### Example 2: Amazon + Rufus AI

**Prompt**:
```
"Ask Rufus on Amazon: What are the best noise-canceling headphones for travel?"
```

**What Happens**:
1. Agent creates tab, navigates to amazon.com
2. Agent uses `amazon_ask_rufus` macro with question
3. Agent parses Rufus response + product recommendations
4. Agent returns structured answer

**Result**:
```
🤖 Rufus AI Response:

"For travel, I recommend noise-canceling headphones with:
- Active Noise Cancellation (ANC)
- Long battery life (20+ hours)
- Comfortable ear cups
- Compact folding design"

Top Recommendations:
1. Sony WH-1000XM5 - $398.00 ⭐ 4.7
   Features: Industry-leading ANC, 30hr battery, premium comfort

2. Bose QuietComfort 45 - $329.00 ⭐ 4.6
   Features: Legendary ANC, 24hr battery, lightweight

3. Apple AirPods Max - $549.00 ⭐ 4.8
   Features: Spatial audio, 20hr battery, Apple ecosystem

Tab ID: 130 (amazon-rufus)
```

### Example 3: Multi-Site Price Comparison

**Prompt**:
```
"Compare prices for iPhone 15 Pro on Amazon, Walmart, and Best Buy"
```

**What Happens**:
1. Agent creates 3 tabs in parallel (Amazon, Walmart, Best Buy)
2. Agent searches all 3 sites simultaneously
3. Agent extracts pricing, availability, ratings from each
4. Agent generates comparison table
5. Agent returns results + all tab IDs

**Result**:
```
iPhone 15 Pro (128GB) Price Comparison:

| Store      | Price    | Rating | Availability | Link       |
|------------|----------|--------|--------------|------------|
| Amazon     | $999.00  | 4.7⭐  | In Stock     | Tab 131    |
| Walmart    | $999.00  | 4.6⭐  | In Stock     | Tab 132    |
| Best Buy   | $999.00  | 4.8⭐  | Limited      | Tab 133    |

Best Value: All stores have same price. Best Buy has highest rating (4.8⭐)
but limited stock. Amazon has most reviews (2,345).

Recommendation: Amazon (best balance of availability and reviews)
```

**Follow-up**:
```
"Show me the Amazon reviews"
# Agent uses tab 131, navigates to reviews
```

### Example 4: Review Analysis

**Prompt**:
```
"Search Amazon reviews for Sony WH-1000XM4 mentioning 'battery life'"
```

**What Happens**:
1. Agent creates tab, searches for product
2. Agent clicks into product page
3. Agent navigates to reviews
4. Agent uses `amazon_search_reviews` macro with query "battery life"
5. Agent extracts matching reviews
6. Agent summarizes findings

**Result**:
```
Found 127 reviews mentioning "battery life":

Summary:
⭐ Positive (85%): "Battery lasts 30+ hours", "Charges fast", "Week-long trips no problem"
⚠️ Neutral (10%): "Decent but not exceptional", "Meets advertised specs"
❌ Negative (5%): "Drains faster with ANC on", "Battery degraded after 1 year"

Top Review (⭐⭐⭐⭐⭐):
"Battery life is incredible. I charge once a week with daily 2-hour commutes.
ANC doesn't seem to drain it much. After 6 months, still like new."

Tab ID: 134 (sony-reviews)
```

### Example 5: Add to Cart

**Prompt**:
```
"Search Amazon for Kindle Paperwhite and add the 16GB version to my cart"
```

**What Happens**:
1. Agent searches for "Kindle Paperwhite"
2. Agent finds product with 16GB option
3. Agent uses `amazon_select_variation` macro to choose 16GB
4. Agent uses `amazon_add_to_cart` macro
5. Agent confirms addition

**Result**:
```
✓ Found Kindle Paperwhite
✓ Selected 16GB storage option
✓ Added to cart

Product: Kindle Paperwhite (16GB, 2024 model)
Price: $149.99
Cart Total: 1 item

Tab ID: 135 (kindle-cart)
```

---

## Form Automation Agent

The form automation agent handles form discovery, filling, validation, and safe submission (with approval).

### Example 1: Contact Form

**Prompt**:
```
"Fill out the contact form at example.com/contact with:
Name: John Doe
Email: john@example.com
Message: I'd like more information about your services."
```

**What Happens**:
1. Browser skill recognizes "form" → delegates to form automation agent
2. Agent creates tab, navigates to URL
3. Agent uses `discover_forms` macro to find forms
4. Agent uses `analyze_form_requirements` macro to understand fields
5. Agent fills each field with provided data
6. Agent generates preview (DOES NOT SUBMIT YET)
7. Agent returns preview for user approval

**Result**:
```
📋 Form Preview (example.com/contact):

Fields to be submitted:
✓ Name: John Doe (required)
✓ Email: john@example.com (required)
✓ Subject: (empty, optional)
✓ Message: I'd like more information... (required)

Form Action: /submit-contact (POST)
Sensitive Fields: None

⚠️ Review the preview above. To submit, say: "Submit the form"

Tab ID: 136 (contact-form)
```

**Follow-up to Submit**:
```
"Submit the form"
# Agent uses tab 136, submits form, checks for confirmation
```

**Result**:
```
✓ Form submitted successfully!
Confirmation: "Thank you! We'll respond within 24 hours."

Tab ID: 136 (contact-form)
```

### Example 2: Multi-Step Registration Form

**Prompt**:
```
"Fill out the registration form at example.com/signup with:
Step 1: Name: Jane Smith, Email: jane@example.com, Password: SecurePass123
Step 2: Address: 123 Main St, City: New York, State: NY, Zip: 10001
Step 3: Phone: 555-1234, Company: Acme Inc"
```

**What Happens**:
1. Agent creates tab, navigates
2. Agent discovers Step 1 form fields
3. Agent fills Step 1 fields
4. Agent clicks "Next" button
5. Agent waits for Step 2 to load
6. Agent discovers Step 2 form fields
7. Agent fills Step 2 fields
8. Agent clicks "Next" button
9. Agent waits for Step 3 to load
10. Agent discovers Step 3 form fields
11. Agent fills Step 3 fields
12. Agent generates complete preview (all 3 steps)

**Result**:
```
📋 Multi-Step Form Preview (3 steps):

Step 1 - Account Info:
✓ Name: Jane Smith
✓ Email: jane@example.com
✓ Password: ******** (sensitive)

Step 2 - Address:
✓ Address: 123 Main St
✓ City: New York
✓ State: NY
✓ Zip: 10001

Step 3 - Additional Info:
✓ Phone: 555-1234
✓ Company: Acme Inc

⚠️ Sensitive fields detected: Password
⚠️ Review all steps carefully before submitting.

To submit, say: "Submit the registration"

Tab ID: 137 (signup-form)
```

### Example 3: Form with Validation Errors

**Prompt**:
```
"Fill out the form at example.com/subscribe with:
Email: john@example
Name: J"
```

**What Happens**:
1. Agent creates tab, fills fields
2. Agent generates preview, user approves
3. Agent submits form
4. Server returns validation errors
5. Agent uses `detect_messages` macro to find error messages
6. Agent analyzes errors and suggests fixes
7. Agent returns error report (does NOT auto-retry)

**Result**:
```
❌ Form submission failed - validation errors:

Errors found:
1. Email: "Please enter a valid email address"
   Current: john@example
   Suggested Fix: john@example.com

2. Name: "Name must be at least 2 characters"
   Current: J
   Suggested Fix: John

Would you like me to fix these errors and retry?

Tab ID: 138 (subscribe-form)
```

**Follow-up**:
```
"Yes, fix the errors and submit again"
# Agent corrects fields, re-submits
```

### Example 4: Dynamic/Conditional Form

**Prompt**:
```
"Fill out the shipping form at example.com/checkout with:
Country: United States
(this should reveal state/zip fields)
State: California
Zip: 90210"
```

**What Happens**:
1. Agent creates tab, discovers initial form
2. Agent fills Country field
3. Agent waits 1 second for dynamic fields to appear
4. Agent re-discovers form (detects new State/Zip fields)
5. Agent fills newly appeared fields
6. Agent returns preview

**Result**:
```
📋 Form Preview (with conditional fields):

Initial Fields:
✓ Country: United States (triggered additional fields)

Conditional Fields (appeared after country selection):
✓ State: California
✓ Zip: 90210

Form adapted to show US-specific fields.

To submit, say: "Submit the form"

Tab ID: 139 (checkout-form)
```

### Example 5: Realistic Typing

**Prompt**:
```
"Fill out the login form at example.com/login with realistic typing:
Email: user@example.com
Password: SecurePass123"
```

**What Happens**:
1. Agent creates tab, discovers form
2. Agent uses `browser_realistic_type` for human-like behavior:
   - Variable delays between keystrokes (50-150ms)
   - Occasional typos with corrections (2% chance)
   - Natural rhythm (faster for common patterns)
3. Agent returns preview

**Result**:
```
📋 Login Form Preview:

✓ Email: user@example.com (typed with realistic delays)
✓ Password: ************ (typed carefully, no typos)

Typing behavior:
- Used variable delays (50-150ms per keystroke)
- Email took ~2.5 seconds to type (realistic)
- Password took ~3.2 seconds (slower, more careful)

⚠️ Sensitive field detected: Password
Review and confirm to submit.

Tab ID: 140 (login-form)
```

---

## Web Scraper Agent

The web scraper agent handles structured data extraction, pagination, infinite scroll, and export.

### Example 1: Table Extraction

**Prompt**:
```
"Extract the pricing table from example.com/pricing and export to CSV"
```

**What Happens**:
1. Browser skill recognizes "extract" → delegates to scraper agent
2. Agent creates tab, navigates
3. Agent uses `extract_table_data` macro
4. Agent formats as CSV
5. Agent writes to /tmp/pricing.csv
6. Agent returns summary + file URL

**Result**:
```
✓ Extracted pricing table (3 columns × 4 rows)

Headers: Plan, Price, Features
Rows:
1. Basic, $9/month, 10GB storage, Email support
2. Pro, $29/month, 100GB storage, Priority support
3. Enterprise, Custom, Unlimited storage, Dedicated support

📄 Exported to: file:///tmp/pricing-20251210.csv

Tab ID: 141 (pricing-table)
```

### Example 2: Pagination (Next Button)

**Prompt**:
```
"Scrape all job listings from example.com/jobs (paginated, up to 5 pages)"
```

**What Happens**:
1. Agent creates tab, navigates
2. Agent uses `detect_pagination` macro to find next button
3. Agent extracts jobs from page 1
4. Agent clicks "Next" button
5. Agent extracts jobs from page 2
6. Agent repeats for pages 3-5
7. Agent deduplicates all jobs
8. Agent exports to JSON file

**Result**:
```
✓ Scraped 5 pages of job listings

Total jobs found: 87 (after deduplication)

Sample jobs:
1. Software Engineer - $120k - San Francisco
2. Product Manager - $140k - Remote
3. Data Scientist - $130k - New York
...

📄 Exported to: file:///tmp/jobs-20251210.json

Tab ID: 142 (jobs-scraper)
```

### Example 3: Infinite Scroll

**Prompt**:
```
"Scrape all tweets from example-twitter.com/user/timeline (infinite scroll)"
```

**What Happens**:
1. Agent creates tab, navigates
2. Agent uses `detect_infinite_scroll` macro
3. Agent scrolls to bottom, waits for new content
4. Agent extracts visible tweets
5. Agent repeats until no new content loads (or max iterations)
6. Agent deduplicates tweets
7. Agent exports to JSON

**Result**:
```
✓ Scraped infinite scroll timeline

Scroll iterations: 12
Tweets collected: 240 (after deduplication)

Sample tweets:
1. "Just launched our new product! #excited" - 2025-12-09
2. "Great meeting with the team today" - 2025-12-08
...

📄 Exported to: file:///tmp/tweets-20251210.json

Tab ID: 143 (twitter-scraper)
```

### Example 4: Article Content Extraction

**Prompt**:
```
"Extract the main article content from example.com/blog/post-123"
```

**What Happens**:
1. Agent creates tab, navigates
2. Agent uses `extract_main_content` macro to get article body
3. Agent uses `get_page_metadata` macro to get title, author, date
4. Agent structures as markdown
5. Agent writes to /tmp/ file

**Result**:
```
✓ Extracted article content

Title: "10 Tips for Better Productivity"
Author: John Smith
Published: December 8, 2025
Word Count: 1,234

Content preview:
"In today's fast-paced world, productivity is key..."

📄 Full article saved to: file:///tmp/article-20251210.md

Tab ID: 144 (blog-article)
```

### Example 5: Multi-Site Aggregation

**Prompt**:
```
"Scrape product prices for 'iPhone 15' from Amazon, Walmart, and Best Buy. Export comparison table."
```

**What Happens**:
1. Agent creates 3 tabs in parallel
2. Agent searches each site simultaneously
3. Agent extracts product data from each
4. Agent aggregates into comparison table
5. Agent exports to CSV

**Result**:
```
✓ Scraped 3 sites in parallel

Products found:
- Amazon: 12 iPhone 15 listings
- Walmart: 8 iPhone 15 listings
- Best Buy: 10 iPhone 15 listings

Comparison (lowest prices):
| Store     | Model          | Price    | Rating |
|-----------|----------------|----------|--------|
| Amazon    | iPhone 15 128GB| $799.00  | 4.7⭐  |
| Walmart   | iPhone 15 128GB| $799.00  | 4.6⭐  |
| Best Buy  | iPhone 15 128GB| $799.00  | 4.8⭐  |

📄 Full comparison: file:///tmp/iphone-comparison-20251210.csv

Tab IDs: 145 (Amazon), 146 (Walmart), 147 (Best Buy)
```

---

## QA Testing Agent

The QA testing agent handles accessibility audits, performance testing, visual regression, and keyboard navigation.

### Example 1: Accessibility Audit

**Prompt**:
```
"Audit example.com for accessibility issues (WCAG 2.1 AA)"
```

**What Happens**:
1. Browser skill recognizes "accessibility" → delegates to QA agent
2. Agent creates tab, navigates
3. Agent uses `audit_accessibility` macro
4. Agent categorizes issues by severity
5. Agent generates markdown report with recommendations
6. Agent exports report to /tmp/

**Result**:
```
🔍 Accessibility Audit Complete

Summary:
- ❌ Critical: 2 issues (must fix for WCAG AA)
- ⚠️ Serious: 5 issues (important to fix)
- ℹ️ Moderate: 8 issues (should fix)
- 💡 Minor: 12 issues (nice to fix)

Critical Issues:
1. Missing alt text on 3 images (WCAG 1.1.1)
   Impact: Screen readers can't describe images
   Fix: Add descriptive alt attributes

2. Insufficient color contrast on navigation links (WCAG 1.4.3)
   Current: 3.2:1, Required: 4.5:1
   Fix: Darken link color or lighten background

WCAG 2.1 AA Compliance: ❌ FAILED (critical issues present)

📄 Full report: file:///tmp/accessibility-report-20251210.md

Tab ID: 148 (accessibility-audit)
```

### Example 2: Performance Testing

**Prompt**:
```
"Test page load performance for example.com"
```

**What Happens**:
1. Agent creates tab, navigates
2. Agent uses `measure_page_performance` macro
3. Agent uses `analyze_resource_sizes` macro
4. Agent calculates performance score (0-100)
5. Agent generates report with recommendations

**Result**:
```
⚡ Performance Test Complete

Metrics:
- Page Load Time: 2.3 seconds
- DOM Content Loaded: 1.2 seconds
- First Contentful Paint: 0.8 seconds
- Total Page Size: 3.2 MB
- Total Requests: 87

Performance Score: 72/100 (Good)

Bottlenecks:
1. Large JavaScript bundles (1.8 MB)
   Recommendation: Code splitting, lazy loading

2. Unoptimized images (800 KB)
   Recommendation: WebP format, responsive images

3. No caching headers on static assets
   Recommendation: Enable browser caching

📄 Full report: file:///tmp/performance-report-20251210.md

Tab ID: 149 (performance-test)
```

### Example 3: Keyboard Navigation Testing

**Prompt**:
```
"Test keyboard navigation on example.com/form"
```

**What Happens**:
1. Agent creates tab, navigates
2. Agent uses `check_keyboard_navigation` macro
3. Agent tests tab order, focus visibility, skip links
4. Agent generates report with issues found

**Result**:
```
⌨️ Keyboard Navigation Test Complete

Tab Order Test:
✓ All interactive elements reachable via Tab
✓ Tab order matches visual order
❌ 2 elements lack visible focus indicators

Focus Visibility:
✓ Most elements show focus outlines
❌ Submit button has no focus indicator
❌ Dropdown menu has faint focus indicator

Skip Links:
❌ No "Skip to main content" link found
Recommendation: Add skip link for screen reader users

Keyboard Traps:
✓ No keyboard traps detected

Overall: ⚠️ PARTIALLY ACCESSIBLE
Critical fix needed: Add focus indicators to submit button

📄 Full report: file:///tmp/keyboard-nav-report-20251210.md

Tab ID: 150 (keyboard-test)
```

### Example 4: Visual Regression Testing

**Prompt**:
```
"Capture baseline screenshots of example.com at desktop and mobile resolutions"
```

**What Happens**:
1. Agent creates tab, navigates
2. Agent sets viewport to 1920×1080 (desktop)
3. Agent captures screenshot
4. Agent sets viewport to 375×667 (mobile)
5. Agent captures screenshot
6. Agent saves both to /tmp/

**Result**:
```
📸 Visual Regression Baseline Captured

Desktop (1920×1080):
file:///tmp/baseline-desktop-20251210.png

Mobile (375×667):
file:///tmp/baseline-mobile-20251210.png

Use these baselines to compare against future changes:
"Compare example.com against baseline screenshots"

Tab ID: 151 (visual-regression)
```

### Example 5: Responsive Design Testing

**Prompt**:
```
"Test example.com at mobile, tablet, and desktop resolutions. Check for layout issues."
```

**What Happens**:
1. Agent creates tab, navigates
2. Agent captures screenshots at 3 resolutions
3. Agent analyzes layout for each
4. Agent checks for common issues (overflow, hidden content, broken grids)
5. Agent generates report

**Result**:
```
📱 Responsive Design Test Complete

Resolutions Tested:
1. Mobile (375×667) - iPhone SE
2. Tablet (768×1024) - iPad
3. Desktop (1920×1080) - Full HD

Layout Analysis:

Mobile:
✓ Content fits viewport
✓ No horizontal scroll
❌ Navigation menu overflows on small screens
⚠️ Images slightly pixelated (need higher resolution)

Tablet:
✓ Content adapts well
✓ Navigation works correctly
✓ Images look good

Desktop:
✓ Full layout displays correctly
✓ All features accessible
✓ Images sharp

Issues Found: 2 (1 critical, 1 minor)
Critical: Navigation overflow on mobile (<380px width)

📄 Screenshots + full report: /tmp/responsive-test-20251210/

Tab ID: 152 (responsive-test)
```

---

## Multi-Agent Workflows

Complex workflows that involve multiple agents working together.

### Example 1: Complete E-Commerce Journey

**Prompt**:
```
"Search Amazon for wireless headphones under $100, test the product page for accessibility, and fill out a review form."
```

**What Happens**:
1. **E-Commerce Agent**: Searches Amazon, filters, returns results (tab 153)
2. User selects product to test
3. **QA Agent**: Audits product page accessibility (uses tab 153)
4. **Form Agent**: Discovers and fills review form (uses tab 153)

**Result**:
```
Step 1 - Product Search (E-Commerce Agent):
✓ Found 50 headphones under $100
✓ Top result: Sony WH-CH520 - $58.00 ⭐ 4.6
Tab 153 (amazon-headphones)

Step 2 - Accessibility Audit (QA Agent):
✓ Audited product page
Issues: 3 moderate, 7 minor (no critical issues)
WCAG 2.1 AA: ✓ PASSED

Step 3 - Review Form (Form Agent):
📋 Review form preview:
✓ Rating: 5 stars
✓ Title: Great headphones for the price
✓ Review: Excellent sound quality...

All tasks complete! Tab 153 preserved throughout workflow.
```

### Example 2: Competitive Analysis

**Prompt**:
```
"Compare iPhone 15 on Amazon, Walmart, and Best Buy. Scrape reviews from each. Generate comparison report."
```

**What Happens**:
1. **E-Commerce Agent**: Creates 3 tabs, searches all sites (tabs 154-156)
2. **Scraper Agent**: Extracts reviews from each tab
3. **Scraper Agent**: Aggregates data, generates comparison report

**Result**:
```
Step 1 - Price Comparison (E-Commerce Agent):
✓ Amazon: $799.00 ⭐ 4.7 (2,345 reviews)
✓ Walmart: $799.00 ⭐ 4.6 (1,234 reviews)
✓ Best Buy: $799.00 ⭐ 4.8 (3,456 reviews)

Step 2 - Review Extraction (Scraper Agent):
✓ Scraped 100 reviews from each site
✓ Total reviews analyzed: 300

Step 3 - Report Generation (Scraper Agent):
📊 Comparison Report:

Pricing: All identical ($799.00)

Ratings:
- Best Buy highest: 4.8⭐
- Amazon middle: 4.7⭐
- Walmart lowest: 4.6⭐

Review Sentiment:
- Amazon: 87% positive, 8% neutral, 5% negative
- Walmart: 85% positive, 10% neutral, 5% negative
- Best Buy: 90% positive, 7% neutral, 3% negative

Common Praise: Camera quality, battery life, display
Common Complaints: Price, no charger included, heavy

Recommendation: Best Buy (highest rating + most positive reviews)

📄 Full report: file:///tmp/iphone-comparison-20251210.pdf

Tabs: 154 (Amazon), 155 (Walmart), 156 (Best Buy)
```

### Example 3: Job Search Pipeline

**Prompt**:
```
"Search for 'Senior Software Engineer' jobs on LinkedIn, Indeed, and Glassdoor. Scrape listings. Test application forms for accessibility. Fill out applications where possible."
```

**What Happens**:
1. **E-Commerce Agent**: Searches all 3 job sites (tabs 157-159)
2. **Scraper Agent**: Extracts job listings from each
3. **QA Agent**: Tests application forms for accessibility
4. **Form Agent**: Fills out accessible application forms

**Result**:
```
Step 1 - Job Search (E-Commerce Agent):
✓ LinkedIn: 45 jobs found
✓ Indeed: 67 jobs found
✓ Glassdoor: 32 jobs found

Step 2 - Listing Extraction (Scraper Agent):
✓ Total jobs: 144 (after deduplication)
✓ Filtered to: 32 (matching Senior, $150k+, Remote)

Top matches:
1. Tech Corp - Senior SWE - $180k - Remote - LinkedIn
2. StartupXYZ - Lead Engineer - $170k - Remote - Indeed
3. BigCo - Staff Engineer - $200k - Remote - Glassdoor

Step 3 - Form Accessibility (QA Agent):
✓ LinkedIn form: Accessible (WCAG AA)
✓ Indeed form: Accessible (WCAG AA)
❌ Glassdoor form: Not accessible (missing labels)

Step 4 - Application Filling (Form Agent):
✓ LinkedIn application filled (preview ready)
✓ Indeed application filled (preview ready)
⚠️ Glassdoor skipped (accessibility issues)

Would you like to review and submit the 2 applications?

📄 Job analysis: file:///tmp/job-search-20251210.csv

Tabs: 157 (LinkedIn), 158 (Indeed), 159 (Glassdoor)
```

### Example 4: Website Migration Testing

**Prompt**:
```
"Compare old-site.com and new-site.com. Test both for accessibility and performance. Verify all pages migrated correctly."
```

**What Happens**:
1. **Browser Agent**: Creates 2 tabs (old vs new)
2. **QA Agent**: Accessibility audits on both
3. **QA Agent**: Performance tests on both
4. **Scraper Agent**: Extracts all pages from sitemap
5. **Browser Agent**: Verifies page-by-page migration

**Result**:
```
Step 1 - Site Setup (Browser Agent):
✓ Tab 160 (old-site.com)
✓ Tab 161 (new-site.com)

Step 2 - Accessibility Comparison (QA Agent):
Old Site: 15 issues (3 critical)
New Site: 4 issues (0 critical) ✓ IMPROVED

Step 3 - Performance Comparison (QA Agent):
Old Site: 4.2s load time, Score: 58/100
New Site: 1.8s load time, Score: 85/100 ✓ IMPROVED

Step 4 - Page Migration (Scraper Agent):
✓ Extracted sitemap: 247 pages
✓ All pages migrated: 247/247 ✓

Step 5 - Spot Check (Browser Agent):
✓ Home page: Content matches
✓ About page: Content matches
✓ Contact page: Content matches
✓ Blog (10 posts): All match

Migration Status: ✓ SUCCESS

Improvements:
+ Accessibility: 11 fewer issues
+ Performance: 57% faster load time
+ WCAG AA Compliance: Now passing

📄 Full report: file:///tmp/migration-report-20251210.pdf

Tabs: 160 (old site), 161 (new site)
```

### Example 5: Social Media Campaign

**Prompt**:
```
"Draft a LinkedIn post, preview it on LinkedIn's post composer, take a screenshot, and test the post form for accessibility."
```

**What Happens**:
1. **Browser Agent**: Navigates to LinkedIn, opens post composer
2. **Form Agent**: Fills post text
3. **Browser Agent**: Captures screenshot of preview
4. **QA Agent**: Tests post form accessibility

**Result**:
```
Step 1 - Navigate (Browser Agent):
✓ Logged into LinkedIn
✓ Opened post composer

Step 2 - Draft Post (Form Agent):
✓ Post text filled:
"Excited to announce our new product launch! 🚀
Learn more: example.com/product"

Step 3 - Preview Screenshot (Browser Agent):
📸 Screenshot: file:///tmp/linkedin-preview-20251210.png

Step 4 - Accessibility Check (QA Agent):
✓ Post form: Accessible (WCAG AA)
✓ Character counter: Visible, accessible
✓ Image upload: Keyboard accessible
✓ Emoji picker: Screen reader compatible

Ready to post! Say "Post to LinkedIn" to submit.

Tab 162 (linkedin-composer)
```

---

## Tips for Effective Usage

### 1. Be Specific
```
❌ "Search Amazon"
✅ "Search Amazon for wireless headphones under $100 with 4+ star ratings"
```

### 2. Leverage Context Preservation
```
"Search Amazon for headphones"  # Creates tab 123
"Get details on the first result"  # Uses tab 123
"Show me the reviews"  # Still uses tab 123
"Compare with Walmart"  # Creates new tab 124, preserves 123
```

### 3. Use Natural Language
```
❌ "browser_execute_macro amazon_search query=headphones"
✅ "Search Amazon for headphones"
```

### 4. Combine Operations
```
"Search Amazon for iPhone 15, apply filters for Prime shipping and 4+ stars,
sort by price, and show me the top 5 results"
```

### 5. Request Previews Before Submission
```
"Fill out the form and show me a preview"  # Safe
❌ "Fill and submit the form immediately"  # Agent will still require approval
```

---

## Next Steps

- Review [TROUBLESHOOTING.md](../.claude/skills/browser/TROUBLESHOOTING.md) for common issues
- Read [ARCHITECTURE.md](./ARCHITECTURE.md) to understand how agents work
- Explore [MACROS.md](../.claude/skills/browser/MACROS.md) for available automation

For questions or issues, open a GitHub issue or discussion!
