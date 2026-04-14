/**
 * GovDeals.com Macro System
 *
 * Comprehensive macro system for finding government surplus deals.
 * Focus: Electronics & IT equipment near zip code 01450 (50-mile radius)
 *
 * SCOPE: Search & extraction only (no bidding automation)
 *
 * Categories:
 * - Navigation (3): Location search, advanced search, pagination
 * - Extraction (6): Results, details, seller, pagination info, filters, categories
 * - Interaction (3): Category filter, price filter, sort
 * - Utility (1): Page type detection
 *
 * Total: 13 macros
 */

export const govdealsMacros = [
  // ═════════════════════════════════════════════════════════════
  // NAVIGATION MACROS (3)
  // ═════════════════════════════════════════════════════════════

  {
    site: "govdeals.com",
    category: "navigation",
    name: "govdeals_location_search",
    description: "Search GovDeals by location (zip code + radius). IMPORTANT: Navigate to https://www.govdeals.com and wait 3 seconds before calling this macro. Category filtering should be done AFTER location search using govdeals_apply_category_filter.",
    parameters: {
      zipCode: {
        type: "string",
        required: true,
        description: "5-digit zip code (e.g., '01450')"
      },
      distance: {
        type: "number",
        required: false,
        default: 50,
        description: "Search radius in miles (default: 50)"
      },
    },
    returnType: "object",
    reliability: "high",
    tags: ["search", "location", "core"],
    code: `(params) => {
      const { zipCode, distance = 50 } = params;

      const result = {
        success: false,
        action: "location_search_executed",
        searchParams: { zipCode, distance },
        url: window.location.href,
        resultsFound: false,
        error: null
      };

      try {
        // First, open the Location Search form if we're on the homepage
        const locationSearchLink = document.getElementById('a_MegaMenu_LocationSearch') ||
                                   document.querySelector('a[href*="location-search"]');
        if (locationSearchLink && window.location.pathname === '/') {
          locationSearchLink.click();
        }

        // Multi-layer selector strategy for zip code input
        const zipInputSelectors = [
          '#locationZipcode',              // GovDeals location search (PRIMARY)
          'input[name="zipCode"]',
          'input[name="zip"]',
          '#zipCode',
          '#zip',
          'input[placeholder*="Zip" i]',
          'input[placeholder*="ZIP" i]',
          'input[type="text"][maxlength="5"]'
        ];

        let zipInput = null;
        for (const selector of zipInputSelectors) {
          zipInput = document.querySelector(selector);
          if (zipInput) break;
        }

        // Context-based fallback
        if (!zipInput) {
          const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
          zipInput = inputs.find(input => {
            const label = input.labels?.[0]?.textContent || '';
            const placeholder = input.placeholder || '';
            return /zip.*code/i.test(label + ' ' + placeholder);
          });
        }

        if (!zipInput) {
          throw new Error('Could not find zip code input field');
        }

        // Fill zip code with event dispatch
        zipInput.value = zipCode;
        zipInput.dispatchEvent(new Event('input', { bubbles: true }));
        zipInput.dispatchEvent(new Event('change', { bubbles: true }));

        // Multi-layer selector for distance dropdown
        const distanceSelectors = [
          '#locationRadius',               // GovDeals location search (PRIMARY)
          'select[name="distance"]',
          'select[name="radius"]',
          '#distance',
          '#radius',
          'select[aria-label*="distance" i]',
          'select[aria-label*="radius" i]'
        ];

        let distanceSelect = null;
        for (const selector of distanceSelectors) {
          distanceSelect = document.querySelector(selector);
          if (distanceSelect) break;
        }

        if (distanceSelect) {
          // Find option with matching value
          const options = Array.from(distanceSelect.options);
          const matchingOption = options.find(opt =>
            parseInt(opt.value) === distance ||
            parseInt(opt.textContent) === distance
          );

          if (matchingOption) {
            distanceSelect.value = matchingOption.value;
            distanceSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }

        // Find and click search/submit button
        const submitSelectors = [
          '#btnSearch',                 // GovDeals location search button (PRIMARY)
          'button[type="submit"]',
          'input[type="submit"]',
          'button.search-btn',
          'button.btn-search',
          '#searchButton',
          'input[value="Search"]'
        ];

        let submitButton = null;
        for (const selector of submitSelectors) {
          submitButton = document.querySelector(selector);
          if (submitButton) break;
        }

        // Text-based fallback
        if (!submitButton) {
          const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
          submitButton = buttons.find(btn =>
            /search/i.test(btn.textContent || btn.value)
          );
        }

        if (!submitButton) {
          throw new Error('Could not find search submit button');
        }

        // Click submit button
        submitButton.click();

        result.success = true;
        result.resultsFound = true; // Will be verified after page loads

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  },

  {
    site: "govdeals.com",
    category: "navigation",
    name: "govdeals_advanced_search",
    description: "Execute advanced search with multiple filters (query, price, category, status, date range)",
    parameters: {
      query: {
        type: "string",
        required: false,
        description: "Search query text"
      },
      priceMin: {
        type: "number",
        required: false,
        description: "Minimum price filter"
      },
      priceMax: {
        type: "number",
        required: false,
        description: "Maximum price filter"
      },
      category: {
        type: "string",
        required: false,
        description: "Category filter"
      },
      status: {
        type: "string",
        required: false,
        description: "Auction status: active|ending_soon|sold"
      },
      dateRange: {
        type: "object",
        required: false,
        description: "Date range filter { start, end }"
      }
    },
    returnType: "object",
    reliability: "medium",
    tags: ["search", "advanced", "filters"],
    code: `(params) => {
      const { query, priceMin, priceMax, category, status, dateRange } = params;

      const result = {
        success: false,
        action: "advanced_search_executed",
        filtersApplied: {},
        url: window.location.href,
        error: null
      };

      try {
        // Fill query field
        if (query) {
          const querySelectors = [
            'input[name="query"]',
            'input[name="search"]',
            'input[type="search"]',
            '#searchQuery',
            'input[placeholder*="Search" i]'
          ];

          let queryInput = null;
          for (const selector of querySelectors) {
            queryInput = document.querySelector(selector);
            if (queryInput) break;
          }

          if (queryInput) {
            queryInput.value = query;
            queryInput.dispatchEvent(new Event('input', { bubbles: true }));
            result.filtersApplied.query = query;
          }
        }

        // Fill price filters
        if (priceMin !== undefined) {
          const minPriceSelectors = [
            'input[name="priceMin"]',
            'input[name="minPrice"]',
            '#priceMin'
          ];

          let minPriceInput = null;
          for (const selector of minPriceSelectors) {
            minPriceInput = document.querySelector(selector);
            if (minPriceInput) break;
          }

          if (minPriceInput) {
            minPriceInput.value = priceMin.toString();
            minPriceInput.dispatchEvent(new Event('input', { bubbles: true }));
            result.filtersApplied.priceMin = priceMin;
          }
        }

        if (priceMax !== undefined) {
          const maxPriceSelectors = [
            'input[name="priceMax"]',
            'input[name="maxPrice"]',
            '#priceMax'
          ];

          let maxPriceInput = null;
          for (const selector of maxPriceSelectors) {
            maxPriceInput = document.querySelector(selector);
            if (maxPriceInput) break;
          }

          if (maxPriceInput) {
            maxPriceInput.value = priceMax.toString();
            maxPriceInput.dispatchEvent(new Event('input', { bubbles: true }));
            result.filtersApplied.priceMax = priceMax;
          }
        }

        // Apply category filter
        if (category) {
          const categorySelectors = [
            'select[name="category"]',
            '#category',
            'input[name="category"]'
          ];

          let categoryField = null;
          for (const selector of categorySelectors) {
            categoryField = document.querySelector(selector);
            if (categoryField) break;
          }

          if (categoryField) {
            if (categoryField.tagName === 'SELECT') {
              const options = Array.from(categoryField.options);
              const match = options.find(opt =>
                opt.textContent.toLowerCase().includes(category.toLowerCase())
              );
              if (match) {
                categoryField.value = match.value;
                categoryField.dispatchEvent(new Event('change', { bubbles: true }));
                result.filtersApplied.category = category;
              }
            } else {
              categoryField.value = category;
              categoryField.dispatchEvent(new Event('input', { bubbles: true }));
              result.filtersApplied.category = category;
            }
          }
        }

        // Apply status filter
        if (status) {
          const statusSelectors = [
            'select[name="status"]',
            'select[name="auctionStatus"]',
            '#status'
          ];

          let statusSelect = null;
          for (const selector of statusSelectors) {
            statusSelect = document.querySelector(selector);
            if (statusSelect) break;
          }

          if (statusSelect) {
            const options = Array.from(statusSelect.options);
            const match = options.find(opt =>
              opt.value.toLowerCase() === status.toLowerCase() ||
              opt.textContent.toLowerCase().includes(status.toLowerCase())
            );
            if (match) {
              statusSelect.value = match.value;
              statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
              result.filtersApplied.status = status;
            }
          }
        }

        // Submit search
        const submitSelectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button.search-btn'
        ];

        let submitButton = null;
        for (const selector of submitSelectors) {
          submitButton = document.querySelector(selector);
          if (submitButton) break;
        }

        if (submitButton) {
          submitButton.click();
          result.success = true;
        } else {
          throw new Error('Could not find submit button');
        }

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  },

  {
    site: "govdeals.com",
    category: "navigation",
    name: "govdeals_navigate_page",
    description: "Navigate to specific page number in search results (returns metadata, does not perform navigation)",
    parameters: {
      page: {
        type: "number",
        required: true,
        description: "Page number to navigate to"
      }
    },
    returnType: "object",
    reliability: "high",
    tags: ["navigation", "pagination"],
    code: `(params) => {
      const { page } = params;

      const result = {
        success: false,
        action: "page_navigation_prepared",
        targetPage: page,
        pageUrl: null,
        error: null
      };

      try {
        // Find pagination links
        const paginationSelectors = [
          '.pagination a',
          '.pager a',
          'nav[aria-label*="pagination" i] a',
          '[role="navigation"] a'
        ];

        let pageLinks = [];
        for (const selector of paginationSelectors) {
          pageLinks = Array.from(document.querySelectorAll(selector));
          if (pageLinks.length > 0) break;
        }

        // Find link with matching page number
        const pageLink = pageLinks.find(link => {
          const text = link.textContent.trim();
          return parseInt(text) === page;
        });

        if (pageLink) {
          result.pageUrl = pageLink.href;
          result.success = true;
        } else {
          // Try to construct URL from current URL
          const url = new URL(window.location.href);

          // Common pagination parameter patterns
          const pageParams = ['page', 'p', 'pageNum', 'pageNumber'];

          for (const param of pageParams) {
            if (url.searchParams.has(param)) {
              url.searchParams.set(param, page.toString());
              result.pageUrl = url.toString();
              result.success = true;
              break;
            }
          }

          // If no existing param, add 'page'
          if (!result.success) {
            url.searchParams.set('page', page.toString());
            result.pageUrl = url.toString();
            result.success = true;
          }
        }

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  },

  // ═════════════════════════════════════════════════════════════
  // EXTRACTION MACROS (6)
  // ═════════════════════════════════════════════════════════════

  {
    site: "govdeals.com",
    category: "extraction",
    name: "govdeals_extract_search_results",
    description: "Extract auction listings from search results page with details (title, price, time, location, images)",
    parameters: {
      limit: {
        type: "number",
        required: false,
        default: 60,
        description: "Maximum number of results to extract"
      },
      includeImages: {
        type: "boolean",
        required: false,
        default: true,
        description: "Include image URLs in results"
      }
    },
    returnType: "object",
    reliability: "high",
    tags: ["extraction", "search", "core"],
    code: `(params) => {
      const { limit = 60, includeImages = true } = params;

      const result = {
        success: false,
        results: [],
        totalExtracted: 0,
        hasMore: false,
        error: null
      };

      try {
        // Multi-layer selectors for auction item containers
        const containerSelectors = [
          '.card-search',                  // GovDeals search result cards (PRIMARY)
          '.auction-item',
          '.listing-card',
          '.item-card',
          '[data-auction-id]',
          '[data-item-id]',
          '.search-result-item',
          'article.auction',
          'div[class*="auction"]',
          'div[class*="listing"]'
        ];

        let containers = [];
        for (const selector of containerSelectors) {
          containers = Array.from(document.querySelectorAll(selector));
          if (containers.length > 0) break;
        }

        if (containers.length === 0) {
          throw new Error('No auction items found on page');
        }

        // Limit extraction
        containers = containers.slice(0, limit);

        // Extract data from each container
        for (const container of containers) {
          const item = {
            id: null,
            title: null,
            currentBid: null,
            minimumBid: null,
            reserveMet: null,
            timeRemaining: null,
            endDate: null,
            location: null,
            distance: null,
            seller: null,
            imageUrl: null,
            itemUrl: null,
            category: null,
            condition: null
          };

          // Extract ID from data attribute or URL
          item.id = container.getAttribute('data-auction-id') ||
                    container.getAttribute('data-item-id') ||
                    container.getAttribute('id');

          // Extract title
          const titleSelectors = [
            '.card-title a',             // GovDeals title link (PRIMARY)
            'p.card-title a',            // GovDeals full selector
            '.item-title',
            '.auction-title',
            'h3.title',
            'h2',
            'h3',
            'a[href*="/listing/"]',
            'a[href*="/auction/"]'
          ];

          for (const selector of titleSelectors) {
            const titleEl = container.querySelector(selector);
            if (titleEl) {
              item.title = titleEl.textContent.trim();

              // Extract URL from title link
              if (titleEl.tagName === 'A') {
                item.itemUrl = titleEl.href;
              }
              break;
            }
          }

          // Extract item URL if not found yet
          if (!item.itemUrl) {
            const linkSelectors = [
              'a[href*="/en/asset/"]',    // GovDeals asset links (PRIMARY)
              'a[href*="/listing/"]',
              'a[href*="/auction/"]',
              'a[href*="/item/"]'
            ];

            for (const selector of linkSelectors) {
              const link = container.querySelector(selector);
              if (link) {
                item.itemUrl = link.href;
                break;
              }
            }
          }

          // Extract current bid / price
          const priceSelectors = [
            'p.card-amount',             // GovDeals price (PRIMARY)
            '.card-amount',
            '.current-bid',
            '.bid-amount',
            '.price',
            '[class*="current-bid"]',
            '[class*="price"]'
          ];

          for (const selector of priceSelectors) {
            const priceEl = container.querySelector(selector);
            if (priceEl) {
              const priceText = priceEl.textContent.trim();
              // Handle both "USD 200.00" and "$200.00" formats
              const priceMatch = priceText.match(/(?:USD\\s*)?\\$?([\\d,]+\\.?\\d*)/i);
              if (priceMatch) {
                item.currentBid = parseFloat(priceMatch[1].replace(/,/g, ''));
                break;
              }
            }
          }

          // Pattern-based price extraction fallback
          if (item.currentBid === null) {
            const text = container.textContent;
            const bidPatterns = [
              /current bid[:\\s]+\\$?([\\d,]+\\.?\\d*)/i,
              /bid[:\\s]+\\$?([\\d,]+\\.?\\d*)/i,
              /price[:\\s]+\\$?([\\d,]+\\.?\\d*)/i
            ];

            for (const pattern of bidPatterns) {
              const match = text.match(pattern);
              if (match) {
                item.currentBid = parseFloat(match[1].replace(/,/g, ''));
                break;
              }
            }
          }

          // Extract time remaining
          const timeSelectors = [
            'p.timerAttribute',          // GovDeals timer (PRIMARY)
            '.timerAttribute',
            '.time-remaining',
            '.countdown',
            '[data-end-date]',
            '[class*="time-remaining"]',
            '[class*="countdown"]'
          ];

          for (const selector of timeSelectors) {
            const timeEl = container.querySelector(selector);
            if (timeEl) {
              item.timeRemaining = timeEl.textContent.trim();

              // Try to extract end date from data attribute
              const endDate = timeEl.getAttribute('data-end-date') ||
                             timeEl.getAttribute('data-end-time');
              if (endDate) {
                item.endDate = endDate;
              }
              break;
            }
          }

          // Extract location
          const locationSelectors = [
            'p.card-grey[name="pAssetLocation"]',  // GovDeals location (PRIMARY)
            'p.card-grey',                          // GovDeals general (fallback)
            '.item-location',
            '.location',
            '.seller-location',
            '.distance',
            '[class*="location"]'
          ];

          for (const selector of locationSelectors) {
            const locEl = container.querySelector(selector);
            if (locEl) {
              const locText = locEl.textContent.trim();
              item.location = locText;

              // Try to extract distance
              const distMatch = locText.match(/([\\d.]+)\\s*miles?/i);
              if (distMatch) {
                item.distance = distMatch[0];
              }
              break;
            }
          }

          // Extract seller
          const sellerSelectors = [
            '.seller-name',
            '.seller',
            '[class*="seller"]'
          ];

          for (const selector of sellerSelectors) {
            const sellerEl = container.querySelector(selector);
            if (sellerEl) {
              item.seller = sellerEl.textContent.trim();
              break;
            }
          }

          // Extract image
          if (includeImages) {
            const imgSelectors = [
              'img.item-image',
              'img.auction-image',
              '.image-container img',
              'img[src*="/auction/"]',
              'img[src*="/listing/"]',
              'img'
            ];

            for (const selector of imgSelectors) {
              const img = container.querySelector(selector);
              if (img && img.src && !img.src.includes('placeholder')) {
                item.imageUrl = img.src;
                break;
              }
            }
          }

          // Extract category
          const categorySelectors = [
            '.category',
            '.item-category',
            '[class*="category"]'
          ];

          for (const selector of categorySelectors) {
            const catEl = container.querySelector(selector);
            if (catEl) {
              item.category = catEl.textContent.trim();
              break;
            }
          }

          // Extract condition
          const conditionSelectors = [
            '.condition',
            '.item-condition',
            '[class*="condition"]'
          ];

          for (const selector of conditionSelectors) {
            const condEl = container.querySelector(selector);
            if (condEl) {
              item.condition = condEl.textContent.trim();
              break;
            }
          }

          result.results.push(item);
        }

        result.totalExtracted = result.results.length;

        // Check if there are more results
        const nextPageSelectors = [
          '.pagination .next',
          'a[rel="next"]',
          'a[aria-label*="next" i]'
        ];

        for (const selector of nextPageSelectors) {
          const nextLink = document.querySelector(selector);
          if (nextLink && !nextLink.classList.contains('disabled')) {
            result.hasMore = true;
            break;
          }
        }

        result.success = true;

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  },

  {
    site: "govdeals.com",
    category: "extraction",
    name: "govdeals_extract_listing_details",
    description: "Extract complete details from auction listing page (description, specs, pricing, timing, images, bid history)",
    parameters: {
      extractSpecs: {
        type: "boolean",
        required: false,
        default: true,
        description: "Extract specifications table"
      },
      extractImages: {
        type: "boolean",
        required: false,
        default: true,
        description: "Extract all image URLs"
      },
      extractBidHistory: {
        type: "boolean",
        required: false,
        default: false,
        description: "Extract bid history table"
      }
    },
    returnType: "object",
    reliability: "high",
    tags: ["extraction", "details", "core"],
    code: `(params) => {
      const { extractSpecs = true, extractImages = true, extractBidHistory = false } = params;

      const result = {
        success: false,
        listing: {},
        error: null
      };

      try {
        const listing = {
          id: null,
          title: null,
          description: null,
          specifications: {},
          pricing: {},
          timing: {},
          seller: {},
          images: [],
          bidHistory: []
        };

        // Extract item ID from URL
        const urlMatch = window.location.href.match(/\\/(?:listing|auction|item)\\/([\\d]+)/);
        if (urlMatch) {
          listing.id = urlMatch[1];
        }

        // Extract title
        const titleSelectors = [
          'h1.item-title',
          'h1.auction-title',
          'h1',
          '.page-title h1',
          '[class*="item-title"]'
        ];

        for (const selector of titleSelectors) {
          const titleEl = document.querySelector(selector);
          if (titleEl) {
            listing.title = titleEl.textContent.trim();
            break;
          }
        }

        // Extract description
        const descSelectors = [
          '.item-description',
          '#description',
          '.asset-details',
          '.description',
          '[class*="description"]'
        ];

        for (const selector of descSelectors) {
          const descEl = document.querySelector(selector);
          if (descEl) {
            listing.description = descEl.innerHTML.trim();
            break;
          }
        }

        // Extract specifications
        if (extractSpecs) {
          const specSelectors = [
            '.specifications',
            '.item-specs',
            'table.details',
            'table.specifications',
            '.spec-table'
          ];

          let specTable = null;
          for (const selector of specSelectors) {
            specTable = document.querySelector(selector);
            if (specTable) break;
          }

          if (specTable) {
            const rows = specTable.querySelectorAll('tr');
            for (const row of rows) {
              const cells = row.querySelectorAll('td, th');
              if (cells.length >= 2) {
                const key = cells[0].textContent.trim();
                const value = cells[1].textContent.trim();
                if (key && value) {
                  listing.specifications[key] = value;
                }
              }
            }
          }

          // Look for spec list items
          const specListSelectors = [
            '.specs li',
            '.specifications li',
            'ul.specs li'
          ];

          for (const selector of specListSelectors) {
            const items = document.querySelectorAll(selector);
            if (items.length > 0) {
              items.forEach((item, idx) => {
                const text = item.textContent.trim();
                const match = text.match(/^([^:]+):\\s*(.+)$/);
                if (match) {
                  listing.specifications[match[1].trim()] = match[2].trim();
                } else {
                  listing.specifications[\`spec_\${idx + 1}\`] = text;
                }
              });
              break;
            }
          }
        }

        // Extract pricing information
        const currentBidSelectors = [
          '.current-bid',
          '.bid-amount',
          '[class*="current-bid"]'
        ];

        for (const selector of currentBidSelectors) {
          const bidEl = document.querySelector(selector);
          if (bidEl) {
            const bidText = bidEl.textContent.trim();
            const bidMatch = bidText.match(/\\$?([\\d,]+\\.?\\d*)/);
            if (bidMatch) {
              listing.pricing.currentBid = parseFloat(bidMatch[1].replace(/,/g, ''));
              break;
            }
          }
        }

        // Extract minimum bid
        const minBidSelectors = [
          '.minimum-bid',
          '.min-bid',
          '[class*="minimum-bid"]'
        ];

        for (const selector of minBidSelectors) {
          const minEl = document.querySelector(selector);
          if (minEl) {
            const minText = minEl.textContent.trim();
            const minMatch = minText.match(/\\$?([\\d,]+\\.?\\d*)/);
            if (minMatch) {
              listing.pricing.minimumBid = parseFloat(minMatch[1].replace(/,/g, ''));
              break;
            }
          }
        }

        // Extract next minimum bid
        const nextBidSelectors = [
          '.next-bid',
          '.next-minimum-bid',
          '[class*="next-bid"]'
        ];

        for (const selector of nextBidSelectors) {
          const nextEl = document.querySelector(selector);
          if (nextEl) {
            const nextText = nextEl.textContent.trim();
            const nextMatch = nextText.match(/\\$?([\\d,]+\\.?\\d*)/);
            if (nextMatch) {
              listing.pricing.nextMinimumBid = parseFloat(nextMatch[1].replace(/,/g, ''));
              break;
            }
          }
        }

        // Extract reserve status
        const pageText = document.body.textContent;
        if (/reserve\\s+met/i.test(pageText)) {
          listing.pricing.reserveMet = true;
        } else if (/reserve\\s+not\\s+met/i.test(pageText)) {
          listing.pricing.reserveMet = false;
        }

        // Extract timing information
        const timeSelectors = [
          '.time-remaining',
          '.countdown',
          '[data-end-date]'
        ];

        for (const selector of timeSelectors) {
          const timeEl = document.querySelector(selector);
          if (timeEl) {
            listing.timing.timeRemaining = timeEl.textContent.trim();

            const endDate = timeEl.getAttribute('data-end-date') ||
                           timeEl.getAttribute('data-end-time');
            if (endDate) {
              listing.timing.endDate = endDate;
            }
            break;
          }
        }

        // Extract start date
        const startDateSelectors = [
          '.start-date',
          '[data-start-date]'
        ];

        for (const selector of startDateSelectors) {
          const startEl = document.querySelector(selector);
          if (startEl) {
            listing.timing.startDate = startEl.textContent.trim();
            break;
          }
        }

        // Determine auction status
        if (listing.timing.timeRemaining) {
          if (/ended|closed/i.test(listing.timing.timeRemaining)) {
            listing.timing.auctionStatus = 'closed';
          } else {
            listing.timing.auctionStatus = 'active';
          }
        }

        // Extract seller information
        const sellerSelectors = [
          '.seller-name',
          '.seller-info .name',
          '[class*="seller-name"]'
        ];

        for (const selector of sellerSelectors) {
          const sellerEl = document.querySelector(selector);
          if (sellerEl) {
            listing.seller.name = sellerEl.textContent.trim();
            break;
          }
        }

        const locationSelectors = [
          '.seller-location',
          '.location',
          '[class*="seller-location"]'
        ];

        for (const selector of locationSelectors) {
          const locEl = document.querySelector(selector);
          if (locEl) {
            listing.seller.location = locEl.textContent.trim();
            break;
          }
        }

        // Extract images
        if (extractImages) {
          const imageSelectors = [
            '.gallery img',
            '.image-gallery img',
            '.item-images img',
            '[class*="gallery"] img',
            '[class*="images"] img'
          ];

          let images = [];
          for (const selector of imageSelectors) {
            images = Array.from(document.querySelectorAll(selector));
            if (images.length > 0) break;
          }

          for (const img of images) {
            if (img.src && !img.src.includes('placeholder')) {
              listing.images.push({
                url: img.src,
                thumbnail: img.src,
                fullSize: img.getAttribute('data-full-src') || img.src
              });
            }
          }
        }

        // Extract bid history
        if (extractBidHistory) {
          const bidHistorySelectors = [
            '.bid-history',
            '.bidding-activity',
            'table.bids',
            '[class*="bid-history"]'
          ];

          let bidTable = null;
          for (const selector of bidHistorySelectors) {
            bidTable = document.querySelector(selector);
            if (bidTable) break;
          }

          if (bidTable) {
            const rows = bidTable.querySelectorAll('tr');
            for (let i = 1; i < rows.length; i++) { // Skip header
              const cells = rows[i].querySelectorAll('td');
              if (cells.length >= 2) {
                const bidder = cells[0].textContent.trim();
                const amountText = cells[1].textContent.trim();
                const amountMatch = amountText.match(/\\$?([\\d,]+\\.?\\d*)/);

                const bid = {
                  bidder: bidder,
                  amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null,
                  timestamp: cells.length >= 3 ? cells[2].textContent.trim() : null
                };

                listing.bidHistory.push(bid);
              }
            }
          }
        }

        result.listing = listing;
        result.success = true;

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  },

  {
    site: "govdeals.com",
    category: "extraction",
    name: "govdeals_extract_seller_info",
    description: "Extract seller information from listing or seller page",
    parameters: {},
    returnType: "object",
    reliability: "low",
    tags: ["extraction", "seller"],
    code: `(params) => {
      const result = {
        success: false,
        seller: {},
        error: null
      };

      try {
        const seller = {
          name: null,
          location: null,
          totalAuctions: null,
          activeAuctions: null,
          rating: null,
          contactInfo: {}
        };

        // Extract seller name
        const nameSelectors = [
          '.seller-name',
          '.seller-info .name',
          'h2.seller',
          '[class*="seller-name"]'
        ];

        for (const selector of nameSelectors) {
          const nameEl = document.querySelector(selector);
          if (nameEl) {
            seller.name = nameEl.textContent.trim();
            break;
          }
        }

        // Extract location
        const locationSelectors = [
          '.seller-location',
          '.seller-info .location',
          '[class*="seller-location"]'
        ];

        for (const selector of locationSelectors) {
          const locEl = document.querySelector(selector);
          if (locEl) {
            seller.location = locEl.textContent.trim();
            break;
          }
        }

        // Extract auction counts
        const pageText = document.body.textContent;

        const totalMatch = pageText.match(/(\\d+)\\s+total\\s+auctions/i);
        if (totalMatch) {
          seller.totalAuctions = parseInt(totalMatch[1]);
        }

        const activeMatch = pageText.match(/(\\d+)\\s+active\\s+auctions/i);
        if (activeMatch) {
          seller.activeAuctions = parseInt(activeMatch[1]);
        }

        // Extract contact info
        const phoneMatch = pageText.match(/phone[:\\s]*([\\d\\-\\(\\)\\s]+)/i);
        if (phoneMatch) {
          seller.contactInfo.phone = phoneMatch[1].trim();
        }

        const emailMatch = pageText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/);
        if (emailMatch) {
          seller.contactInfo.email = emailMatch[1];
        }

        result.seller = seller;
        result.success = true;

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  },

  {
    site: "govdeals.com",
    category: "extraction",
    name: "govdeals_extract_pagination_info",
    description: "Extract pagination metadata from search results (current page, total pages, results count, navigation URLs)",
    parameters: {},
    returnType: "object",
    reliability: "medium",
    tags: ["extraction", "pagination"],
    code: `(params) => {
      const result = {
        success: false,
        pagination: {},
        error: null
      };

      try {
        const pagination = {
          currentPage: 1,
          totalPages: null,
          resultsPerPage: null,
          totalResults: null,
          hasNextPage: false,
          hasPreviousPage: false,
          nextPageUrl: null,
          previousPageUrl: null
        };

        // Extract current page
        const currentPageSelectors = [
          '.pagination .active',
          '.pagination .current',
          '[aria-current="page"]',
          '.pager .active'
        ];

        for (const selector of currentPageSelectors) {
          const currentEl = document.querySelector(selector);
          if (currentEl) {
            const pageNum = parseInt(currentEl.textContent.trim());
            if (!isNaN(pageNum)) {
              pagination.currentPage = pageNum;
              break;
            }
          }
        }

        // Extract from URL if not found
        if (pagination.currentPage === 1) {
          const url = new URL(window.location.href);
          const pageParams = ['page', 'p', 'pageNum', 'pageNumber'];

          for (const param of pageParams) {
            const pageVal = url.searchParams.get(param);
            if (pageVal) {
              pagination.currentPage = parseInt(pageVal);
              break;
            }
          }
        }

        // Extract total pages
        const pageText = document.body.textContent;

        const totalPagesPatterns = [
          /page\\s+\\d+\\s+of\\s+(\\d+)/i,
          /(\\d+)\\s+pages/i,
          /total\\s+pages[:\\s]+(\\d+)/i
        ];

        for (const pattern of totalPagesPatterns) {
          const match = pageText.match(pattern);
          if (match) {
            pagination.totalPages = parseInt(match[1]);
            break;
          }
        }

        // Count pagination links if total not found
        if (!pagination.totalPages) {
          const pageLinks = document.querySelectorAll('.pagination a[href*="page="], .pager a[href*="page="]');
          if (pageLinks.length > 0) {
            let maxPage = pagination.currentPage;
            pageLinks.forEach(link => {
              const pageNum = parseInt(link.textContent.trim());
              if (!isNaN(pageNum) && pageNum > maxPage) {
                maxPage = pageNum;
              }
            });
            pagination.totalPages = maxPage;
          }
        }

        // Extract results per page
        const resultsPerPageMatch = pageText.match(/(\\d+)\\s+results\\s+per\\s+page/i);
        if (resultsPerPageMatch) {
          pagination.resultsPerPage = parseInt(resultsPerPageMatch[1]);
        } else {
          // Count items on page as fallback
          const items = document.querySelectorAll('.auction-item, .listing-card, [data-auction-id]');
          if (items.length > 0) {
            pagination.resultsPerPage = items.length;
          }
        }

        // Extract total results
        const totalResultsPatterns = [
          /(\\d+)\\s+results/i,
          /showing\\s+\\d+\\s*-\\s*\\d+\\s+of\\s+(\\d+)/i,
          /(\\d+)\\s+auctions?\\s+found/i
        ];

        for (const pattern of totalResultsPatterns) {
          const match = pageText.match(pattern);
          if (match) {
            pagination.totalResults = parseInt(match[1]);
            break;
          }
        }

        // Find next page link
        const nextPageSelectors = [
          '.pagination .next',
          'a[rel="next"]',
          'a[aria-label*="next" i]',
          '.pager .next'
        ];

        for (const selector of nextPageSelectors) {
          const nextLink = document.querySelector(selector);
          if (nextLink && !nextLink.classList.contains('disabled')) {
            pagination.hasNextPage = true;
            pagination.nextPageUrl = nextLink.href;
            break;
          }
        }

        // Find previous page link
        const prevPageSelectors = [
          '.pagination .previous',
          '.pagination .prev',
          'a[rel="prev"]',
          'a[aria-label*="previous" i]',
          '.pager .previous'
        ];

        for (const selector of prevPageSelectors) {
          const prevLink = document.querySelector(selector);
          if (prevLink && !prevLink.classList.contains('disabled')) {
            pagination.hasPreviousPage = true;
            pagination.previousPageUrl = prevLink.href;
            break;
          }
        }

        result.pagination = pagination;
        result.success = true;

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  },

  {
    site: "govdeals.com",
    category: "extraction",
    name: "govdeals_extract_available_filters",
    description: "Extract available filter options from search page (categories, price ranges, statuses)",
    parameters: {},
    returnType: "object",
    reliability: "low",
    tags: ["extraction", "filters"],
    code: `(params) => {
      const result = {
        success: false,
        filters: {},
        error: null
      };

      try {
        const filters = {
          categories: [],
          priceRanges: [],
          statuses: [],
          locations: [],
          conditions: []
        };

        // Extract categories from dropdown or filter list
        const categorySelectors = [
          'select[name="category"] option',
          '#category option',
          '.category-filter option',
          '.filter-categories li'
        ];

        for (const selector of categorySelectors) {
          const options = document.querySelectorAll(selector);
          if (options.length > 0) {
            options.forEach(opt => {
              const text = opt.textContent.trim();
              const value = opt.value || text;
              if (text && text !== 'Select' && text !== 'All') {
                filters.categories.push({ label: text, value: value });
              }
            });
            break;
          }
        }

        // Extract status filters
        const statusSelectors = [
          'select[name="status"] option',
          '#status option',
          '.status-filter option'
        ];

        for (const selector of statusSelectors) {
          const options = document.querySelectorAll(selector);
          if (options.length > 0) {
            options.forEach(opt => {
              const text = opt.textContent.trim();
              const value = opt.value || text;
              if (text && text !== 'Select' && text !== 'All') {
                filters.statuses.push({ label: text, value: value });
              }
            });
            break;
          }
        }

        // Extract condition filters
        const conditionSelectors = [
          'select[name="condition"] option',
          '#condition option',
          '.condition-filter option'
        ];

        for (const selector of conditionSelectors) {
          const options = document.querySelectorAll(selector);
          if (options.length > 0) {
            options.forEach(opt => {
              const text = opt.textContent.trim();
              const value = opt.value || text;
              if (text && text !== 'Select' && text !== 'All') {
                filters.conditions.push({ label: text, value: value });
              }
            });
            break;
          }
        }

        result.filters = filters;
        result.success = true;

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  },

  {
    site: "govdeals.com",
    category: "extraction",
    name: "govdeals_extract_category_tree",
    description: "Extract complete category hierarchy with focus on Electronics & IT equipment",
    parameters: {},
    returnType: "object",
    reliability: "low",
    tags: ["extraction", "categories"],
    code: `(params) => {
      const result = {
        success: false,
        categoryTree: {},
        error: null
      };

      try {
        const categoryTree = {
          root: [],
          electronics: []
        };

        // Look for category navigation or tree
        const categoryNavSelectors = [
          '.category-nav',
          '.category-tree',
          '.categories',
          'nav[aria-label*="categories" i]'
        ];

        let categoryNav = null;
        for (const selector of categoryNavSelectors) {
          categoryNav = document.querySelector(selector);
          if (categoryNav) break;
        }

        if (categoryNav) {
          // Extract top-level categories
          const topLevelLinks = categoryNav.querySelectorAll('a[href*="category"], li > a');

          topLevelLinks.forEach(link => {
            const text = link.textContent.trim();
            const href = link.href;

            const category = {
              name: text,
              url: href,
              subcategories: []
            };

            // Look for subcategories
            const parent = link.closest('li');
            if (parent) {
              const subList = parent.querySelector('ul');
              if (subList) {
                const subLinks = subList.querySelectorAll('a');
                subLinks.forEach(subLink => {
                  category.subcategories.push({
                    name: subLink.textContent.trim(),
                    url: subLink.href
                  });
                });
              }
            }

            categoryTree.root.push(category);

            // Collect Electronics subcategories
            if (/electronics/i.test(text)) {
              categoryTree.electronics = category.subcategories;
            }
          });
        }

        // Fallback: extract from dropdown
        if (categoryTree.root.length === 0) {
          const categoryOptions = document.querySelectorAll('select[name="category"] option, #category option');
          categoryOptions.forEach(opt => {
            const text = opt.textContent.trim();
            if (text && text !== 'Select' && text !== 'All') {
              categoryTree.root.push({
                name: text,
                value: opt.value,
                subcategories: []
              });
            }
          });
        }

        result.categoryTree = categoryTree;
        result.success = true;

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  },

  // ═════════════════════════════════════════════════════════════
  // INTERACTION MACROS (3)
  // ═════════════════════════════════════════════════════════════

  {
    site: "govdeals.com",
    category: "interaction",
    name: "govdeals_apply_category_filter",
    description: "Apply category filter with type-ahead autocomplete support",
    parameters: {
      category: {
        type: "string",
        required: true,
        description: "Category name or path (e.g., 'Electronics' or 'Electronics > Computers')"
      },
      applyImmediately: {
        type: "boolean",
        required: false,
        default: true,
        description: "Apply filter immediately vs just fill the field"
      }
    },
    returnType: "object",
    reliability: "high",
    tags: ["interaction", "filter", "core"],
    code: `(params) => {
      const { category, applyImmediately = true } = params;

      const result = {
        success: false,
        action: "category_filter_applied",
        category: category,
        filterApplied: false,
        resultsUpdated: false,
        error: null
      };

      try {
        // Find category input/select
        const categorySelectors = [
          'input[name="category"]',
          'input[name="categorySearch"]',
          '#categorySearch',
          '#category',
          'select[name="category"]',
          'input[type="text"][placeholder*="Category" i]',
          'input[type="text"][autocomplete]'
        ];

        let categoryField = null;
        for (const selector of categorySelectors) {
          categoryField = document.querySelector(selector);
          if (categoryField) break;
        }

        if (!categoryField) {
          throw new Error('Could not find category filter field');
        }

        // Handle SELECT dropdown
        if (categoryField.tagName === 'SELECT') {
          const options = Array.from(categoryField.options);
          const match = options.find(opt =>
            opt.textContent.toLowerCase().includes(category.toLowerCase()) ||
            opt.value.toLowerCase().includes(category.toLowerCase())
          );

          if (match) {
            categoryField.value = match.value;
            categoryField.dispatchEvent(new Event('change', { bubbles: true }));
            result.filterApplied = true;
            result.success = true;
          } else {
            throw new Error(\`Category '\${category}' not found in dropdown\`);
          }
        }
        // Handle INPUT with autocomplete
        else if (categoryField.tagName === 'INPUT') {
          // Fill field
          categoryField.value = category;
          categoryField.dispatchEvent(new Event('input', { bubbles: true }));
          categoryField.dispatchEvent(new Event('focus', { bubbles: true }));

          // Wait for autocomplete dropdown
          setTimeout(() => {
            const suggestionSelectors = [
              '.autocomplete-suggestion',
              '.suggestion-item',
              '.dropdown-item',
              '[role="option"]',
              '.ui-menu-item'
            ];

            let suggestions = [];
            for (const selector of suggestionSelectors) {
              suggestions = Array.from(document.querySelectorAll(selector));
              if (suggestions.length > 0) break;
            }

            // Find matching suggestion
            const match = suggestions.find(s =>
              s.textContent.toLowerCase().includes(category.toLowerCase())
            );

            if (match) {
              match.click();
              result.filterApplied = true;
              result.success = true;
            } else if (!applyImmediately) {
              // Field filled but no selection made
              result.success = true;
              result.filterApplied = false;
            } else {
              // Trigger form submit or filter button
              categoryField.dispatchEvent(new Event('change', { bubbles: true }));
              categoryField.dispatchEvent(new Event('blur', { bubbles: true }));

              // Look for apply/filter button
              const filterBtnSelectors = [
                'button[type="submit"]',
                'button.apply-filter',
                'button.filter-btn',
                'input[type="submit"]'
              ];

              let filterBtn = null;
              for (const selector of filterBtnSelectors) {
                filterBtn = document.querySelector(selector);
                if (filterBtn) {
                  filterBtn.click();
                  result.filterApplied = true;
                  break;
                }
              }

              result.success = true;
            }
          }, 500);
        }

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  },

  {
    site: "govdeals.com",
    category: "interaction",
    name: "govdeals_apply_price_filter",
    description: "Apply price range filter (min and/or max)",
    parameters: {
      minPrice: {
        type: "number",
        required: false,
        description: "Minimum price"
      },
      maxPrice: {
        type: "number",
        required: false,
        description: "Maximum price"
      }
    },
    returnType: "object",
    reliability: "medium",
    tags: ["interaction", "filter", "price"],
    code: `(params) => {
      const { minPrice, maxPrice } = params;

      const result = {
        success: false,
        action: "price_filter_applied",
        priceRange: { min: minPrice, max: maxPrice },
        filterApplied: false,
        error: null
      };

      try {
        let minFilled = false;
        let maxFilled = false;

        // Fill minimum price
        if (minPrice !== undefined) {
          const minPriceSelectors = [
            'input[name="priceMin"]',
            'input[name="minPrice"]',
            '#priceMin',
            '#minPrice',
            'input[placeholder*="Min" i][placeholder*="Price" i]'
          ];

          let minInput = null;
          for (const selector of minPriceSelectors) {
            minInput = document.querySelector(selector);
            if (minInput) break;
          }

          if (minInput) {
            minInput.value = minPrice.toString();
            minInput.dispatchEvent(new Event('input', { bubbles: true }));
            minInput.dispatchEvent(new Event('change', { bubbles: true }));
            minFilled = true;
          }
        }

        // Fill maximum price
        if (maxPrice !== undefined) {
          const maxPriceSelectors = [
            'input[name="priceMax"]',
            'input[name="maxPrice"]',
            '#priceMax',
            '#maxPrice',
            'input[placeholder*="Max" i][placeholder*="Price" i]'
          ];

          let maxInput = null;
          for (const selector of maxPriceSelectors) {
            maxInput = document.querySelector(selector);
            if (maxInput) break;
          }

          if (maxInput) {
            maxInput.value = maxPrice.toString();
            maxInput.dispatchEvent(new Event('input', { bubbles: true }));
            maxInput.dispatchEvent(new Event('change', { bubbles: true }));
            maxFilled = true;
          }
        }

        if (!minFilled && !maxFilled) {
          throw new Error('Could not find price filter fields');
        }

        // Look for apply button
        const applyBtnSelectors = [
          'button.apply-filter',
          'button[type="submit"]',
          'button.filter-btn',
          'input[type="submit"]'
        ];

        let applyBtn = null;
        for (const selector of applyBtnSelectors) {
          applyBtn = document.querySelector(selector);
          if (applyBtn) break;
        }

        if (applyBtn) {
          applyBtn.click();
          result.filterApplied = true;
        } else {
          // Trigger form submission via Enter key on last field
          const lastField = maxFilled ?
            document.querySelector('input[name="priceMax"], input[name="maxPrice"]') :
            document.querySelector('input[name="priceMin"], input[name="minPrice"]');

          if (lastField) {
            lastField.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
            result.filterApplied = true;
          }
        }

        result.success = minFilled || maxFilled;

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  },

  {
    site: "govdeals.com",
    category: "interaction",
    name: "govdeals_apply_sort",
    description: "Apply sort order to search results",
    parameters: {
      sortBy: {
        type: "string",
        required: true,
        description: "Sort option: ending_soon|price_low|price_high|newest|distance"
      }
    },
    returnType: "object",
    reliability: "low",
    tags: ["interaction", "sort"],
    code: `(params) => {
      const { sortBy } = params;

      const result = {
        success: false,
        action: "sort_applied",
        sortBy: sortBy,
        sortApplied: false,
        error: null
      };

      try {
        // Find sort dropdown
        const sortSelectors = [
          'select[name="sort"]',
          'select[name="sortBy"]',
          '#sort',
          '#sortBy',
          'select[aria-label*="sort" i]'
        ];

        let sortSelect = null;
        for (const selector of sortSelectors) {
          sortSelect = document.querySelector(selector);
          if (sortSelect) break;
        }

        if (!sortSelect) {
          throw new Error('Could not find sort dropdown');
        }

        // Map sort parameter to option value
        const sortMap = {
          'ending_soon': ['ending_soon', 'time_ending', 'end_time', 'ending'],
          'price_low': ['price_low', 'price_asc', 'lowest_price', 'price_ascending'],
          'price_high': ['price_high', 'price_desc', 'highest_price', 'price_descending'],
          'newest': ['newest', 'date_desc', 'recent', 'date_new'],
          'distance': ['distance', 'distance_asc', 'nearest', 'closest']
        };

        const searchTerms = sortMap[sortBy] || [sortBy];
        const options = Array.from(sortSelect.options);

        // Find matching option
        let matchingOption = null;
        for (const term of searchTerms) {
          matchingOption = options.find(opt =>
            opt.value.toLowerCase().includes(term) ||
            opt.textContent.toLowerCase().includes(term)
          );
          if (matchingOption) break;
        }

        if (matchingOption) {
          sortSelect.value = matchingOption.value;
          sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
          result.sortApplied = true;
          result.success = true;
        } else {
          throw new Error(\`Sort option '\${sortBy}' not found\`);
        }

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  },

  // ═════════════════════════════════════════════════════════════
  // UTILITY MACROS (1)
  // ═════════════════════════════════════════════════════════════

  {
    site: "govdeals.com",
    category: "util",
    name: "govdeals_detect_page_type",
    description: "Detect current page type in GovDeals workflow (search_results, listing_detail, advanced_search, home, unknown)",
    parameters: {},
    returnType: "object",
    reliability: "medium",
    tags: ["utility", "detection"],
    code: `(params) => {
      const result = {
        success: false,
        pageType: "unknown",
        url: window.location.href,
        metadata: {},
        error: null
      };

      try {
        const url = result.url.toLowerCase();

        // URL-based detection
        if (url.includes('/search') || url.includes('/index.cfm?fa=main.goSearch')) {
          result.pageType = "search_results";

          // Extract search metadata
          const urlObj = new URL(result.url);
          result.metadata.searchParams = {
            zipCode: urlObj.searchParams.get('zipCode'),
            category: urlObj.searchParams.get('category'),
            query: urlObj.searchParams.get('query'),
            page: urlObj.searchParams.get('page') || '1'
          };
        }
        else if (url.includes('/listing/') || url.includes('/auction/') || url.includes('/index.cfm?fa=main.item')) {
          result.pageType = "listing_detail";

          // Extract listing ID
          const idMatch = url.match(/(?:listing|auction|itemid=)(\\d+)/);
          if (idMatch) {
            result.metadata.listingId = idMatch[1];
          }
        }
        else if (url.includes('/advanced-search') || url.includes('/index.cfm?fa=main.advSearch')) {
          result.pageType = "advanced_search";
        }
        else if (url === 'https://www.govdeals.com/' || url === 'https://www.govdeals.com') {
          result.pageType = "home";
        }

        // Element-based detection (fallback)
        if (result.pageType === "unknown") {
          // Check for search results indicators
          const hasSearchResults = document.querySelector('.search-results, .auction-list, [class*="search-results"]');
          const hasAuctionItems = document.querySelectorAll('.auction-item, .listing-card').length > 0;

          if (hasSearchResults || hasAuctionItems) {
            result.pageType = "search_results";
          }

          // Check for listing detail indicators
          const hasItemTitle = document.querySelector('h1.item-title, h1.auction-title');
          const hasDescription = document.querySelector('.item-description, #description');
          const hasBidButton = document.querySelector('button.place-bid, button[class*="bid"]');

          if (hasItemTitle && (hasDescription || hasBidButton)) {
            result.pageType = "listing_detail";
          }

          // Check for advanced search form
          const hasAdvancedForm = document.querySelector('form[action*="advSearch"], .advanced-search-form');
          if (hasAdvancedForm) {
            result.pageType = "advanced_search";
          }
        }

        result.success = true;

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  }
];
