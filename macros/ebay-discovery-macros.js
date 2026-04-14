/**
 * eBay Discovery Macros
 *
 * Macros for discovering related items and seller listings.
 * These enable powerful discovery workflows beyond keyword search.
 *
 * Use Cases:
 * - Find more items from the same seller
 * - Discover eBay's related/similar item recommendations
 * - See what other buyers viewed
 * - Browse seller's eBay store inventory
 *
 * Workflow Examples:
 * 1. Find good listing → Extract seller items → Find more bulk lots
 * 2. View product → Extract related items → Discover similar hardware
 * 3. Research item → Extract recommended → See what buyers compared
 */

export const ebayDiscoveryMacros = [
  {
    site: "ebay.com",
    category: "extraction",
    name: "ebay_extract_seller_items",
    description: "Extract seller's other active listings from product page or seller profile",
    parameters: {
      limit: {
        type: "number",
        required: false,
        default: 50,
        description: "Maximum number of items to extract (default: 50)"
      },
      includeSold: {
        type: "boolean",
        required: false,
        default: false,
        description: "Include sold/ended listings (default: false)"
      },
      sortBy: {
        type: "string",
        required: false,
        default: "ending_soon",
        description: "Sort order: ending_soon|price_low|price_high|newest (default: ending_soon)"
      }
    },
    returnType: "object",
    reliability: "medium",
    tags: ["discovery", "seller", "extraction", "listings"],
    code: `(params) => {
      const { limit = 50, includeSold = false, sortBy = "ending_soon" } = params;

      const result = {
        success: false,
        items: [],
        sellerName: null,
        sellerItemsLink: null,
        totalExtracted: 0,
        hasMore: false,
        error: null,
        message: null
      };

      try {
        // Find "Seller's other items" link on product page using text matching
        const allLinks = Array.from(document.querySelectorAll('a'));
        const sellerLink = allLinks.find(a => {
          const text = a.textContent.toLowerCase();
          const href = a.href.toLowerCase();
          return (text.includes("seller") && text.includes("other") && text.includes("item")) ||
                 (text.includes("see other items")) ||
                 (text.includes("see seller's other items")) ||
                 ((href.includes("/str/") || href.includes("/sch/")) && text.includes("seller"));
        });

        // If found the link, check if we should extract from current page or return link
        if (sellerLink && !window.location.href.includes("/str/") && !window.location.href.includes("/sch/")) {
          result.sellerItemsLink = sellerLink.href;
          result.message = "Found seller items link. Navigate to this URL to extract items, or the link is in sellerItemsLink field.";
          result.success = true;
          return result;
        }

        // If we're on seller store/search page, extract items directly
        let section = document.body; // Use whole page for store/search results

        // Check if we're on a seller's listings page (store or search)
        const isStoreOrSearch = window.location.href.includes("/str/") ||
                               window.location.href.includes("/sch/") ||
                               document.querySelector('.srp-results');

        if (!isStoreOrSearch) {
          // Try to find inline seller items section (rare on modern eBay)
          const sectionSelectors = [
            '[data-viewport="Other items from this seller"]',
            '.ux-seller-items',
            '#vi-oia-cntr',
            'section[aria-label*="seller" i]',
            '.seller-other-items',
            '[class*="sellerOtherItems"]'
          ];

          for (const selector of sectionSelectors) {
            const found = document.querySelector(selector);
            if (found) {
              section = found;
              break;
            }
          }
        }

        // Extract seller name
        const sellerNameSelectors = [
          '.seller-persona a',
          '[data-testid="ux-seller-section"] a',
          '.mbg a',
          'a[href*="/usr/"]'
        ];

        for (const selector of sellerNameSelectors) {
          const sellerEl = document.querySelector(selector);
          if (sellerEl) {
            result.sellerName = sellerEl.textContent.trim();
            break;
          }
        }

        // Extract item containers
        const itemSelectors = [
          '.s-item',
          '.srp-results .s-item',
          'li[data-view="mi:1686"]',
          '.item',
          '[class*="item-card"]',
          'article.item'
        ];

        let items = [];
        for (const selector of itemSelectors) {
          items = Array.from(section.querySelectorAll(selector));
          if (items.length > 0) break;
        }

        // Fallback: look for links with item IDs
        if (items.length === 0) {
          const links = Array.from(section.querySelectorAll('a[href*="/itm/"]'));
          // Group by item ID to deduplicate (multiple links per item)
          const itemMap = new Map();
          links.forEach(link => {
            const match = link.href.match(/\\/itm\\/([\\d]+)/);
            if (match && !itemMap.has(match[1])) {
              itemMap.set(match[1], link.closest('li, div, article') || link);
            }
          });
          items = Array.from(itemMap.values());
        }

        if (items.length === 0) {
          throw new Error('No seller items found in section');
        }

        // Limit extraction
        items = items.slice(0, limit);

        // Extract data from each item
        for (const item of items) {
          const itemData = {
            id: null,
            title: null,
            price: null,
            shipping: null,
            condition: null,
            listingType: null,
            timeLeft: null,
            bids: null,
            imageUrl: null,
            itemUrl: null,
            sold: false
          };

          // Extract item URL and ID
          const linkSelectors = [
            'a.s-item__link',
            'a[href*="/itm/"]',
            '.item-title a',
            'a.item-link'
          ];

          let itemLink = null;
          for (const selector of linkSelectors) {
            itemLink = item.querySelector(selector);
            if (itemLink) break;
          }

          if (itemLink) {
            itemData.itemUrl = itemLink.href;
            const idMatch = itemData.itemUrl.match(/\\/itm\\/([\\d]+)/);
            if (idMatch) {
              itemData.id = idMatch[1];
            }
          }

          // Extract title
          const titleSelectors = [
            '.s-item__title',
            '.item-title',
            'h3.s-item__title',
            '[class*="item-title"]'
          ];

          for (const selector of titleSelectors) {
            const titleEl = item.querySelector(selector);
            if (titleEl) {
              itemData.title = titleEl.textContent.trim();
              break;
            }
          }

          // Extract price
          const priceSelectors = [
            '.s-item__price',
            '.item-price',
            '[class*="price"]'
          ];

          for (const selector of priceSelectors) {
            const priceEl = item.querySelector(selector);
            if (priceEl) {
              const priceText = priceEl.textContent.trim();
              const priceMatch = priceText.match(/\\$?([\\d,]+\\.?\\d*)/);
              if (priceMatch) {
                itemData.price = parseFloat(priceMatch[1].replace(/,/g, ''));
                break;
              }
            }
          }

          // Extract shipping
          const shippingSelectors = [
            '.s-item__shipping',
            '.item-shipping',
            '[class*="shipping"]'
          ];

          for (const selector of shippingSelectors) {
            const shipEl = item.querySelector(selector);
            if (shipEl) {
              const shipText = shipEl.textContent.trim();
              if (/free/i.test(shipText)) {
                itemData.shipping = 0;
              } else {
                const shipMatch = shipText.match(/\\$?([\\d,]+\\.?\\d*)/);
                if (shipMatch) {
                  itemData.shipping = parseFloat(shipMatch[1].replace(/,/g, ''));
                }
              }
              break;
            }
          }

          // Extract condition
          const conditionSelectors = [
            '.s-item__subtitle',
            '.item-condition',
            '[class*="condition"]'
          ];

          for (const selector of conditionSelectors) {
            const condEl = item.querySelector(selector);
            if (condEl) {
              const text = condEl.textContent.trim();
              if (/new|used|refurbished|open box|parts/i.test(text)) {
                itemData.condition = text;
                break;
              }
            }
          }

          // Detect listing type
          const auctionIndicators = ['bids', 'bid', 'bidding'];
          const itemText = item.textContent.toLowerCase();

          if (auctionIndicators.some(ind => itemText.includes(ind))) {
            itemData.listingType = 'auction';

            // Extract bid count
            const bidMatch = itemText.match(/(\\d+)\\s*bids?/i);
            if (bidMatch) {
              itemData.bids = parseInt(bidMatch[1]);
            }
          } else {
            itemData.listingType = 'buy_it_now';
          }

          // Extract time left
          const timeSelectors = [
            '.s-item__time-left',
            '.time-left',
            '[class*="time"]'
          ];

          for (const selector of timeSelectors) {
            const timeEl = item.querySelector(selector);
            if (timeEl) {
              itemData.timeLeft = timeEl.textContent.trim();
              break;
            }
          }

          // Extract image
          const imgSelectors = [
            '.s-item__image-img',
            '.item-image img',
            'img[src*="ebayimg"]'
          ];

          for (const selector of imgSelectors) {
            const img = item.querySelector(selector);
            if (img && img.src && !img.src.includes('placeholder')) {
              itemData.imageUrl = img.src;
              break;
            }
          }

          // Check if sold
          const soldIndicators = ['sold', 'ended', 'completed'];
          if (soldIndicators.some(ind => itemText.includes(ind))) {
            itemData.sold = true;
          }

          // Filter out sold items if not requested
          if (!includeSold && itemData.sold) {
            continue;
          }

          result.items.push(itemData);
        }

        result.totalExtracted = result.items.length;

        // Check for "See all items" or pagination
        const moreLinks = section.querySelectorAll('a[href*="seller"], a[href*="see all" i]');
        result.hasMore = moreLinks.length > 0 || result.totalExtracted >= limit;

        result.success = true;

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  },

  {
    site: "ebay.com",
    category: "extraction",
    name: "ebay_extract_related_items",
    description: "Extract eBay's related/similar items section (Similar sponsored items)",
    parameters: {
      limit: {
        type: "number",
        required: false,
        default: 20,
        description: "Maximum number of items to extract (default: 20)"
      },
      includeSponsored: {
        type: "boolean",
        required: false,
        default: true,
        description: "Include sponsored results (default: true)"
      }
    },
    returnType: "object",
    reliability: "medium",
    tags: ["discovery", "related", "extraction", "recommendations"],
    code: `(params) => {
      const { limit = 20, includeSponsored = true } = params;

      const result = {
        success: false,
        items: [],
        sectionTitle: null,
        totalExtracted: 0,
        error: null
      };

      try {
        // Multi-layer selectors for related items section
        const sectionSelectors = [
          '[data-viewport="Similar sponsored items"]',
          '[data-viewport="You may also like"]',
          '.ux-related-carousel',
          'section[aria-label*="similar" i]',
          'section[aria-label*="related" i]',
          '.similar-items',
          '#RelatedItems',
          '[class*="relatedItems"]',
          '[id*="similar"]'
        ];

        let section = null;
        for (const selector of sectionSelectors) {
          section = document.querySelector(selector);
          if (section) break;
        }

        // Fallback: find by heading text
        if (!section) {
          const headings = document.querySelectorAll('h2, h3, .section-title');
          for (const heading of headings) {
            const text = heading.textContent.trim();
            if (/similar|related|you may also like|recommended/i.test(text)) {
              section = heading.closest('section, div[class*="section"], div[id*="section"]') ||
                       heading.parentElement;
              result.sectionTitle = text;
              break;
            }
          }
        }

        if (!section) {
          throw new Error('Could not find related items section on page');
        }

        // Extract section title if not already set
        if (!result.sectionTitle) {
          const titleSelectors = ['h2', 'h3', '.section-title', '[class*="title"]'];
          for (const selector of titleSelectors) {
            const titleEl = section.querySelector(selector);
            if (titleEl) {
              result.sectionTitle = titleEl.textContent.trim();
              break;
            }
          }
        }

        // Extract item containers
        const itemSelectors = [
          '.carousel-item',
          '.s-item',
          'li[class*="item"]',
          'article[class*="item"]',
          '[data-item-id]',
          '.item-card'
        ];

        let items = [];
        for (const selector of itemSelectors) {
          items = Array.from(section.querySelectorAll(selector));
          if (items.length > 0) break;
        }

        // Fallback: find all links with item IDs
        if (items.length === 0) {
          const links = Array.from(section.querySelectorAll('a[href*="/itm/"]'));
          const itemMap = new Map();
          links.forEach(link => {
            const match = link.href.match(/\\/itm\\/([\\d]+)/);
            if (match && !itemMap.has(match[1])) {
              itemMap.set(match[1], link.closest('li, div, article') || link);
            }
          });
          items = Array.from(itemMap.values());
        }

        if (items.length === 0) {
          throw new Error('No related items found in section');
        }

        // Limit extraction
        items = items.slice(0, limit);

        // Extract data from each item
        for (const item of items) {
          const itemData = {
            id: null,
            title: null,
            price: null,
            shipping: null,
            condition: null,
            sponsored: false,
            imageUrl: null,
            itemUrl: null
          };

          // Check if sponsored
          const sponsoredIndicators = ['sponsored', 'ad', 'advertisement'];
          const itemText = item.textContent.toLowerCase();
          itemData.sponsored = sponsoredIndicators.some(ind => itemText.includes(ind));

          // Skip sponsored if not requested
          if (!includeSponsored && itemData.sponsored) {
            continue;
          }

          // Extract item URL and ID
          const linkSelectors = [
            'a[href*="/itm/"]',
            '.item-link',
            'a.s-item__link'
          ];

          let itemLink = null;
          for (const selector of linkSelectors) {
            itemLink = item.querySelector(selector);
            if (itemLink) break;
          }

          if (itemLink) {
            itemData.itemUrl = itemLink.href;
            const idMatch = itemData.itemUrl.match(/\\/itm\\/([\\d]+)/);
            if (idMatch) {
              itemData.id = idMatch[1];
            }
          }

          // Extract title
          const titleSelectors = [
            '.item-title',
            '.s-item__title',
            'h3',
            '[class*="title"]'
          ];

          for (const selector of titleSelectors) {
            const titleEl = item.querySelector(selector);
            if (titleEl) {
              let title = titleEl.textContent.trim();
              // Remove "SPONSORED" prefix if present
              title = title.replace(/^SPONSORED\\s*/i, '');
              itemData.title = title;
              break;
            }
          }

          // Extract price
          const priceSelectors = [
            '.s-item__price',
            '.item-price',
            '[class*="price"]'
          ];

          for (const selector of priceSelectors) {
            const priceEl = item.querySelector(selector);
            if (priceEl) {
              const priceText = priceEl.textContent.trim();
              const priceMatch = priceText.match(/\\$?([\\d,]+\\.?\\d*)/);
              if (priceMatch) {
                itemData.price = parseFloat(priceMatch[1].replace(/,/g, ''));
                break;
              }
            }
          }

          // Extract shipping
          const shippingSelectors = [
            '.s-item__shipping',
            '[class*="shipping"]'
          ];

          for (const selector of shippingSelectors) {
            const shipEl = item.querySelector(selector);
            if (shipEl) {
              const shipText = shipEl.textContent.trim();
              if (/free/i.test(shipText)) {
                itemData.shipping = 0;
              } else {
                const shipMatch = shipText.match(/\\$?([\\d,]+\\.?\\d*)/);
                if (shipMatch) {
                  itemData.shipping = parseFloat(shipMatch[1].replace(/,/g, ''));
                }
              }
              break;
            }
          }

          // Extract condition
          const conditionSelectors = [
            '.s-item__subtitle',
            '[class*="condition"]'
          ];

          for (const selector of conditionSelectors) {
            const condEl = item.querySelector(selector);
            if (condEl) {
              const text = condEl.textContent.trim();
              if (/new|used|refurbished|open box/i.test(text)) {
                itemData.condition = text;
                break;
              }
            }
          }

          // Extract image
          const imgSelectors = [
            '.s-item__image-img',
            '.item-image img',
            'img[src*="ebayimg"]',
            'img'
          ];

          for (const selector of imgSelectors) {
            const img = item.querySelector(selector);
            if (img && img.src && !img.src.includes('placeholder')) {
              itemData.imageUrl = img.src;
              break;
            }
          }

          result.items.push(itemData);
        }

        result.totalExtracted = result.items.length;
        result.success = true;

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  },

  {
    site: "ebay.com",
    category: "extraction",
    name: "ebay_extract_recommended_items",
    description: "Extract 'People who viewed this also viewed' recommendations",
    parameters: {
      limit: {
        type: "number",
        required: false,
        default: 20,
        description: "Maximum number of items to extract (default: 20)"
      }
    },
    returnType: "object",
    reliability: "medium",
    tags: ["discovery", "recommended", "extraction", "viewed"],
    code: `(params) => {
      const { limit = 20 } = params;

      const result = {
        success: false,
        items: [],
        sectionTitle: null,
        totalExtracted: 0,
        error: null
      };

      try {
        // Multi-layer selectors for "People also viewed" section
        const sectionSelectors = [
          '[data-viewport="People who viewed this item also viewed"]',
          '[data-viewport*="also viewed"]',
          'section[aria-label*="also viewed" i]',
          '.also-viewed',
          '#AlsoViewed',
          '[class*="alsoViewed"]',
          '[id*="also-viewed"]'
        ];

        let section = null;
        for (const selector of sectionSelectors) {
          section = document.querySelector(selector);
          if (section) break;
        }

        // Fallback: find by heading text
        if (!section) {
          const headings = document.querySelectorAll('h2, h3, .section-title');
          for (const heading of headings) {
            const text = heading.textContent.trim();
            if (/people.*viewed.*also viewed|also viewed|customers also viewed/i.test(text)) {
              section = heading.closest('section, div[class*="section"], div[id*="section"]') ||
                       heading.parentElement;
              result.sectionTitle = text;
              break;
            }
          }
        }

        if (!section) {
          throw new Error('Could not find "also viewed" section on page');
        }

        // Extract section title if not already set
        if (!result.sectionTitle) {
          const titleSelectors = ['h2', 'h3', '.section-title'];
          for (const selector of titleSelectors) {
            const titleEl = section.querySelector(selector);
            if (titleEl) {
              result.sectionTitle = titleEl.textContent.trim();
              break;
            }
          }
        }

        // Extract item containers
        const itemSelectors = [
          '.carousel-item',
          '.s-item',
          'li[class*="item"]',
          '[data-item-id]',
          '.item-card'
        ];

        let items = [];
        for (const selector of itemSelectors) {
          items = Array.from(section.querySelectorAll(selector));
          if (items.length > 0) break;
        }

        // Fallback: find all links with item IDs
        if (items.length === 0) {
          const links = Array.from(section.querySelectorAll('a[href*="/itm/"]'));
          const itemMap = new Map();
          links.forEach(link => {
            const match = link.href.match(/\\/itm\\/([\\d]+)/);
            if (match && !itemMap.has(match[1])) {
              itemMap.set(match[1], link.closest('li, div, article') || link);
            }
          });
          items = Array.from(itemMap.values());
        }

        if (items.length === 0) {
          throw new Error('No recommended items found in section');
        }

        // Limit extraction
        items = items.slice(0, limit);

        // Extract data from each item
        for (const item of items) {
          const itemData = {
            id: null,
            title: null,
            price: null,
            shipping: null,
            condition: null,
            soldCount: null,
            imageUrl: null,
            itemUrl: null
          };

          // Extract item URL and ID
          const linkSelectors = [
            'a[href*="/itm/"]',
            '.item-link',
            'a.s-item__link'
          ];

          let itemLink = null;
          for (const selector of linkSelectors) {
            itemLink = item.querySelector(selector);
            if (itemLink) break;
          }

          if (itemLink) {
            itemData.itemUrl = itemLink.href;
            const idMatch = itemData.itemUrl.match(/\\/itm\\/([\\d]+)/);
            if (idMatch) {
              itemData.id = idMatch[1];
            }
          }

          // Extract title
          const titleSelectors = [
            '.item-title',
            '.s-item__title',
            'h3',
            '[class*="title"]'
          ];

          for (const selector of titleSelectors) {
            const titleEl = item.querySelector(selector);
            if (titleEl) {
              itemData.title = titleEl.textContent.trim();
              break;
            }
          }

          // Extract price
          const priceSelectors = [
            '.s-item__price',
            '.item-price',
            '[class*="price"]'
          ];

          for (const selector of priceSelectors) {
            const priceEl = item.querySelector(selector);
            if (priceEl) {
              const priceText = priceEl.textContent.trim();
              const priceMatch = priceText.match(/\\$?([\\d,]+\\.?\\d*)/);
              if (priceMatch) {
                itemData.price = parseFloat(priceMatch[1].replace(/,/g, ''));
                break;
              }
            }
          }

          // Extract shipping
          const shippingSelectors = [
            '.s-item__shipping',
            '[class*="shipping"]'
          ];

          for (const selector of shippingSelectors) {
            const shipEl = item.querySelector(selector);
            if (shipEl) {
              const shipText = shipEl.textContent.trim();
              if (/free/i.test(shipText)) {
                itemData.shipping = 0;
              } else {
                const shipMatch = shipText.match(/\\$?([\\d,]+\\.?\\d*)/);
                if (shipMatch) {
                  itemData.shipping = parseFloat(shipMatch[1].replace(/,/g, ''));
                }
              }
              break;
            }
          }

          // Extract condition
          const conditionSelectors = [
            '.s-item__subtitle',
            '[class*="condition"]'
          ];

          for (const selector of conditionSelectors) {
            const condEl = item.querySelector(selector);
            if (condEl) {
              const text = condEl.textContent.trim();
              if (/new|used|refurbished|open box/i.test(text)) {
                itemData.condition = text;
                break;
              }
            }
          }

          // Extract sold count
          const itemText = item.textContent;
          const soldMatch = itemText.match(/(\\d+)\\s*sold/i);
          if (soldMatch) {
            itemData.soldCount = parseInt(soldMatch[1]);
          }

          // Extract image
          const imgSelectors = [
            '.s-item__image-img',
            '.item-image img',
            'img[src*="ebayimg"]',
            'img'
          ];

          for (const selector of imgSelectors) {
            const img = item.querySelector(selector);
            if (img && img.src && !img.src.includes('placeholder')) {
              itemData.imageUrl = img.src;
              break;
            }
          }

          result.items.push(itemData);
        }

        result.totalExtracted = result.items.length;
        result.success = true;

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  },

  {
    site: "ebay.com",
    category: "extraction",
    name: "ebay_extract_seller_store_items",
    description: "Extract items from seller's eBay store (if they have one)",
    parameters: {
      category: {
        type: "string",
        required: false,
        description: "Store category to filter (optional)"
      },
      limit: {
        type: "number",
        required: false,
        default: 50,
        description: "Maximum number of items to extract (default: 50)"
      }
    },
    returnType: "object",
    reliability: "low",
    tags: ["discovery", "seller", "store", "extraction"],
    code: `(params) => {
      const { category, limit = 50 } = params;

      const result = {
        success: false,
        items: [],
        storeName: null,
        storeCategories: [],
        totalExtracted: 0,
        hasMore: false,
        error: null
      };

      try {
        // Check if we're on a seller store page
        const storeIndicators = [
          '.str-header',
          '.store-header',
          '#storeBanner',
          '[class*="store-header"]',
          '[class*="str-seller"]',
          '.str-main',
          '[id*="str-"]'
        ];

        let isStorePage = false;
        for (const selector of storeIndicators) {
          if (document.querySelector(selector)) {
            isStorePage = true;
            break;
          }
        }

        // Check URL - must be /str/ specifically, not /sch/ (search)
        if (!isStorePage) {
          const url = window.location.href.toLowerCase();
          isStorePage = url.includes('/str/');
        }

        // Additional check: look for store branding elements
        if (!isStorePage) {
          const hasStor

eElements = document.querySelector('[class*="store"]') &&
                              document.querySelectorAll('.s-item').length > 0;
          if (hasStoreElements) {
            isStorePage = true;
          }
        }

        if (!isStorePage) {
          throw new Error('Not on a seller store page. Navigate to seller store first.');
        }

        // Extract store name
        const storeNameSelectors = [
          '.str-seller-card__store-name',
          '.store-name',
          'h1.store-title',
          '[class*="store-name"]'
        ];

        for (const selector of storeNameSelectors) {
          const nameEl = document.querySelector(selector);
          if (nameEl) {
            result.storeName = nameEl.textContent.trim();
            break;
          }
        }

        // Extract store categories
        const categoriesSelectors = [
          '.str-left-nav a',
          '.store-categories a',
          'nav a[href*="/str/"]'
        ];

        for (const selector of categoriesSelectors) {
          const catLinks = document.querySelectorAll(selector);
          if (catLinks.length > 0) {
            catLinks.forEach(link => {
              result.storeCategories.push({
                name: link.textContent.trim(),
                url: link.href
              });
            });
            break;
          }
        }

        // Extract item containers
        const itemSelectors = [
          '.s-item',
          '.srp-results .s-item',
          'li[data-view]',
          '.item',
          '[class*="item-card"]'
        ];

        let items = [];
        for (const selector of itemSelectors) {
          items = Array.from(document.querySelectorAll(selector));
          if (items.length > 0) break;
        }

        if (items.length === 0) {
          throw new Error('No items found in store');
        }

        // Limit extraction
        items = items.slice(0, limit);

        // Extract data from each item (same pattern as seller items)
        for (const item of items) {
          const itemData = {
            id: null,
            title: null,
            price: null,
            shipping: null,
            condition: null,
            listingType: null,
            imageUrl: null,
            itemUrl: null,
            storeCategory: null
          };

          // Extract item URL and ID
          const linkSelectors = [
            'a.s-item__link',
            'a[href*="/itm/"]'
          ];

          let itemLink = null;
          for (const selector of linkSelectors) {
            itemLink = item.querySelector(selector);
            if (itemLink) break;
          }

          if (itemLink) {
            itemData.itemUrl = itemLink.href;
            const idMatch = itemData.itemUrl.match(/\\/itm\\/([\\d]+)/);
            if (idMatch) {
              itemData.id = idMatch[1];
            }
          }

          // Extract title
          const titleSelectors = [
            '.s-item__title',
            'h3.s-item__title'
          ];

          for (const selector of titleSelectors) {
            const titleEl = item.querySelector(selector);
            if (titleEl) {
              itemData.title = titleEl.textContent.trim();
              break;
            }
          }

          // Extract price
          const priceSelectors = [
            '.s-item__price'
          ];

          for (const selector of priceSelectors) {
            const priceEl = item.querySelector(selector);
            if (priceEl) {
              const priceText = priceEl.textContent.trim();
              const priceMatch = priceText.match(/\\$?([\\d,]+\\.?\\d*)/);
              if (priceMatch) {
                itemData.price = parseFloat(priceMatch[1].replace(/,/g, ''));
                break;
              }
            }
          }

          // Extract shipping
          const shippingSelectors = [
            '.s-item__shipping'
          ];

          for (const selector of shippingSelectors) {
            const shipEl = item.querySelector(selector);
            if (shipEl) {
              const shipText = shipEl.textContent.trim();
              if (/free/i.test(shipText)) {
                itemData.shipping = 0;
              } else {
                const shipMatch = shipText.match(/\\$?([\\d,]+\\.?\\d*)/);
                if (shipMatch) {
                  itemData.shipping = parseFloat(shipMatch[1].replace(/,/g, ''));
                }
              }
              break;
            }
          }

          // Extract condition
          const conditionSelectors = [
            '.s-item__subtitle'
          ];

          for (const selector of conditionSelectors) {
            const condEl = item.querySelector(selector);
            if (condEl) {
              const text = condEl.textContent.trim();
              if (/new|used|refurbished|open box/i.test(text)) {
                itemData.condition = text;
                break;
              }
            }
          }

          // Detect listing type
          const itemText = item.textContent.toLowerCase();
          if (/bid|auction/.test(itemText)) {
            itemData.listingType = 'auction';
          } else {
            itemData.listingType = 'buy_it_now';
          }

          // Extract image
          const imgSelectors = [
            '.s-item__image-img'
          ];

          for (const selector of imgSelectors) {
            const img = item.querySelector(selector);
            if (img && img.src && !img.src.includes('placeholder')) {
              itemData.imageUrl = img.src;
              break;
            }
          }

          result.items.push(itemData);
        }

        result.totalExtracted = result.items.length;

        // Check for pagination
        const nextPage = document.querySelector('.pagination__next:not(.disabled)');
        result.hasMore = !!nextPage;

        result.success = true;

      } catch (error) {
        result.error = error.message;
      }

      return result;
    }`
  }
];
