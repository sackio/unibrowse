#!/usr/bin/env node

const { MongoClient } = require('mongodb');

const UPDATED_CODE = `(params) => {
  const includeSponsored = params?.includeSponsored !== false;

  // Find all product containers
  const products = [];
  const productElements = document.querySelectorAll('[data-component-type="s-search-result"]');

  productElements.forEach((el, index) => {
    try {
      // Check if sponsored
      const isSponsored = el.querySelector('.puis-sponsored-label-text, .s-label-popover-default') !== null;
      if (!includeSponsored && isSponsored) return;

      // Extract ASIN
      const asin = el.getAttribute('data-asin');
      if (!asin) return; // Skip if no ASIN

      // Extract title and link - find the main product title link
      const allLinks = el.querySelectorAll('a');
      const titleLink = Array.from(allLinks).find(a => {
        const text = a.textContent?.trim();
        return text && text.length > 30 && !text.includes('$');
      });

      const title = titleLink?.textContent?.trim() || '';
      const link = titleLink?.href || '';

      // Extract price information
      let price = null;
      let originalPrice = null;

      // Current price
      const priceElement = el.querySelector('.a-price:not(.a-text-price) .a-offscreen');
      if (priceElement) {
        price = priceElement.textContent.trim();
      }

      // Original price (if on sale)
      const originalPriceElement = el.querySelector('.a-price.a-text-price .a-offscreen');
      if (originalPriceElement) {
        originalPrice = originalPriceElement.textContent.trim();
      }

      // Discount percentage
      let discountPercent = null;
      const discountElement = el.querySelector('.s-price-instructions-style .a-letter-space + span');
      if (discountElement) {
        discountPercent = discountElement.textContent.trim();
      }

      // Coupon discount
      const couponElement = el.querySelector('.s-coupon-unclipped');
      const coupon = couponElement?.textContent?.trim() || null;

      // NEW: Extract delivery/shipping cost
      let deliveryCost = null;
      let deliveryInfo = null;

      // Try multiple selectors for delivery info
      const deliverySelectors = [
        '[data-csa-c-delivery-price]',
        '.a-color-secondary:not(.a-text-bold)',
        '.a-row.a-size-base.a-color-secondary',
        '[aria-label*="delivery"]'
      ];

      for (const selector of deliverySelectors) {
        const deliveryElement = el.querySelector(selector);
        if (deliveryElement) {
          const text = deliveryElement.textContent?.trim() || '';
          if (text && (text.toLowerCase().includes('delivery') || text.toLowerCase().includes('shipping'))) {
            deliveryInfo = text;

            // Extract price from delivery text
            if (text.toLowerCase().includes('free')) {
              deliveryCost = '$0.00';
            } else {
              const deliveryMatch = text.match(/\\$(\\d+\\.\\d{2})/);
              if (deliveryMatch) {
                deliveryCost = \`$\${deliveryMatch[1]}\`;
              }
            }
            break;
          }
        }
      }

      // NEW: Calculate total cost (price + delivery)
      let totalCost = null;
      if (price && deliveryCost) {
        try {
          const priceNum = parseFloat(price.replace(/[^0-9.]/g, ''));
          const deliveryNum = parseFloat(deliveryCost.replace(/[^0-9.]/g, ''));
          if (!isNaN(priceNum) && !isNaN(deliveryNum)) {
            totalCost = \`$\${(priceNum + deliveryNum).toFixed(2)}\`;
          }
        } catch (e) {
          // Ignore calculation errors
        }
      }

      // Rating - FIXED SELECTOR
      let rating = null;
      let reviewCount = null;
      const ratingContainer = el.querySelector('[aria-label*="out of 5 stars"]');
      if (ratingContainer) {
        const ariaLabel = ratingContainer.getAttribute('aria-label');
        const match = ariaLabel.match(/(\\d+\\.?\\d*)\\s+out of 5 stars/);
        if (match) rating = parseFloat(match[1]);
      }

      // Review count
      const reviewElement = el.querySelector('[aria-label*="stars"] + span[aria-label]');
      if (reviewElement) {
        const reviewText = reviewElement.getAttribute('aria-label');
        const match = reviewText.match(/([\\d,]+)/);
        if (match) reviewCount = parseInt(match[1].replace(/,/g, ''));
      }

      // Prime status
      const primeElement = el.querySelector('[aria-label="Amazon Prime"]');
      const isPrime = primeElement !== null;

      // Availability
      let availability = 'In Stock'; // Default assumption
      const availElement = el.querySelector('.a-color-success, .a-color-price');
      if (availElement) {
        const text = availElement.textContent.trim();
        if (text.toLowerCase().includes('out of stock')) availability = 'Out of Stock';
        else availability = text;
      }

      // Image URL
      const imgElement = el.querySelector('.s-image');
      const imageUrl = imgElement?.src || imgElement?.getAttribute('data-src') || null;

      // Position on page
      const position = products.length + 1;

      products.push({
        position,
        asin,
        title,
        link,
        price,
        originalPrice,
        discountPercent,
        coupon,
        deliveryCost,        // NEW FIELD
        deliveryInfo,        // NEW FIELD
        totalCost,           // NEW FIELD
        rating,
        reviewCount,
        availability,
        isPrime,
        isSponsored,
        imageUrl
      });
    } catch (error) {
      console.error('Error extracting product:', error);
    }
  });

  return {
    success: true,
    products,
    count: products.length,
    currentPage: (() => {
      const currentPageEl = document.querySelector('.s-pagination-item.s-pagination-selected');
      return currentPageEl ? parseInt(currentPageEl.textContent) : 1;
    })(),
    message: \`Extracted \${products.length} products from search results with delivery costs where available\`
  };
}`;

async function updateMacro() {
  const client = new MongoClient('mongodb://localhost:27017');

  try {
    await client.connect();
    const db = client.db('browser_mcp');
    const macros = db.collection('macros');

    // Get current macro
    const existing = await macros.findOne({ name: 'amazon_extract_search_results' });

    if (!existing) {
      console.error('Macro not found!');
      process.exit(1);
    }

    console.log('Current version:', existing.version);

    // Increment patch version
    const [major, minor, patch] = existing.version.split('.').map(Number);
    const newVersion = `${major}.${minor}.${patch + 1}`;

    // Update macro
    const result = await macros.updateOne(
      { name: 'amazon_extract_search_results' },
      {
        $set: {
          code: UPDATED_CODE,
          version: newVersion,
          updatedAt: new Date(),
          returnType: '{ success: boolean, products: array (with deliveryCost, deliveryInfo, and totalCost fields), count: number, currentPage: number, message: string }'
        }
      }
    );

    if (result.modifiedCount === 1) {
      console.log('✅ Macro updated successfully!');
      console.log('New version:', newVersion);
      console.log('\nChanges:');
      console.log('- Added deliveryCost extraction (when available on search results)');
      console.log('- Added deliveryInfo (full delivery text)');
      console.log('- Added totalCost calculation (price + delivery)');
      console.log('- Multiple selectors to catch delivery info in different formats');
    } else {
      console.error('❌ Failed to update macro');
    }

  } finally {
    await client.close();
  }
}

updateMacro().catch(console.error);
