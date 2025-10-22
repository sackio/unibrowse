#!/usr/bin/env node

const { MongoClient } = require('mongodb');

const UPDATED_CODE = `(params) => {
  // Helper: Realistic full-page scroll to trigger lazy loading
  const realisticFullPageScroll = async () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await new Promise(resolve => setTimeout(resolve, 500));

    const scrollHeight = document.body.scrollHeight;
    const viewportHeight = window.innerHeight;
    let currentScroll = 0;

    while (currentScroll < scrollHeight) {
      currentScroll += viewportHeight * 0.7;
      window.scrollTo({ top: Math.min(currentScroll, scrollHeight), behavior: 'smooth' });
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    await new Promise(resolve => setTimeout(resolve, 800));
  };

  return (async () => {
    await realisticFullPageScroll();

    const relatedProducts = {
      frequentlyBoughtTogether: [],
      compareWithSimilar: [],
      customersAlsoViewed: [],
      sponsoredProducts: [],
      relatedProducts: [],
      other: []
    };

    // Helper function to extract product info from a product card
    const extractProductInfo = (productEl, index) => {
      const asin = productEl.getAttribute('data-asin') ||
                   productEl.querySelector('[data-asin]')?.getAttribute('data-asin') ||
                   productEl.querySelector('a[href*="/dp/"]')?.href?.match(/\\/dp\\/([A-Z0-9]{10})/)?.[1];

      const titleLink = productEl.querySelector('a[href*="/dp/"], a.a-link-normal, h2 a, .a-text-normal');

      // FIXED: Clean title extraction - remove script/style tags and clean text
      let title = null;
      if (titleLink) {
        // Clone the element to avoid modifying the DOM
        const titleClone = titleLink.cloneNode(true);
        // Remove script and style tags
        titleClone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
        // Get clean text
        title = titleClone.textContent?.trim() || null;
        // If title is too long or contains code-like patterns, try alternative selectors
        if (title && (title.length > 300 || title.includes('{') || title.includes('function'))) {
          title = productEl.querySelector('.p13n-sc-truncate, .a-size-base-plus, span.a-size-base')?.textContent?.trim() || null;
        }
      }

      const url = titleLink?.href || null;

      const priceWhole = productEl.querySelector('.a-price-whole')?.textContent?.trim() || '';
      const priceFraction = productEl.querySelector('.a-price-fraction')?.textContent?.trim() || '';
      const price = priceWhole && priceFraction ? \`\${priceWhole}\${priceFraction}\` :
                   productEl.querySelector('.a-price .a-offscreen')?.textContent?.trim() || null;

      // NEW: Extract delivery/shipping cost
      let deliveryCost = null;
      let deliveryInfo = null;
      const deliveryElement = productEl.querySelector('[data-csa-c-delivery-price], .a-color-secondary:has-text("delivery"), .a-size-base:has-text("delivery")');
      if (deliveryElement) {
        deliveryInfo = deliveryElement.textContent?.trim() || null;
        // Extract price from delivery text (e.g., "$15.99 delivery" or "FREE delivery")
        if (deliveryInfo) {
          if (deliveryInfo.toLowerCase().includes('free')) {
            deliveryCost = '$0.00';
          } else {
            const deliveryMatch = deliveryInfo.match(/\\$(\\d+\\.\\d{2})/);
            if (deliveryMatch) {
              deliveryCost = \`$\${deliveryMatch[1]}\`;
            }
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

      // FIXED: Rating extraction - use correct selector
      let rating = null;
      const ratingContainer = productEl.querySelector('[aria-label*="out of 5 stars"]');
      if (ratingContainer) {
        const ariaLabel = ratingContainer.getAttribute('aria-label');
        const match = ariaLabel.match(/(\\d+\\.?\\d*)\\s+out of 5 stars/);
        if (match) rating = parseFloat(match[1]);
      }

      const reviewCountText = productEl.querySelector('[aria-label*="stars"] + span, .a-size-small .a-link-normal')?.textContent?.trim() || '';
      const reviewCount = reviewCountText ? parseInt(reviewCountText.replace(/[^0-9]/g, '')) : null;

      const isPrime = productEl.querySelector('.s-prime, [aria-label*="Prime"], .a-icon-prime') !== null;

      const image = productEl.querySelector('img')?.src || null;

      return {
        position: index + 1,
        asin,
        title,
        url,
        price,
        deliveryCost,        // NEW FIELD
        deliveryInfo,        // NEW FIELD
        totalCost,           // NEW FIELD
        rating,
        reviewCount,
        isPrime,
        image
      };
    };

    // 1. Frequently Bought Together
    const fbtSection = document.querySelector('#sims-fbt, [data-component-type="sp-frequently-bought-together"]');
    if (fbtSection) {
      const fbtProducts = fbtSection.querySelectorAll('[data-asin]:not([data-asin=""]), .a-carousel-card, li[data-asin]');
      fbtProducts.forEach((el, idx) => {
        const info = extractProductInfo(el, idx);
        if (info.asin && info.asin !== 'undefined') {
          relatedProducts.frequentlyBoughtTogether.push(info);
        }
      });
    }

    // 2. Compare with Similar Items
    const compareSection = document.querySelector('#HLCXComparisonWidget, [data-component-type="comparison-table"], .comparison-table, #comparison_table');
    if (compareSection) {
      const compareProducts = compareSection.querySelectorAll('[data-asin], .comparison_table_image_row td, .comparison-table-column');
      compareProducts.forEach((el, idx) => {
        const info = extractProductInfo(el, idx);
        if (info.asin && info.asin !== 'undefined') {
          relatedProducts.compareWithSimilar.push(info);
        }
      });
    }

    // 3. Customers Who Viewed This Also Viewed
    const alsoViewedSections = document.querySelectorAll('[data-component-type="sp-ppl"], .similarities-widget, #purchase-sims-feature, #similarities_feature_div');
    alsoViewedSections.forEach(section => {
      const sectionTitle = section.querySelector('.a-carousel-heading, h2')?.textContent?.toLowerCase() || '';
      const products = section.querySelectorAll('[data-asin]:not([data-asin=""]), .a-carousel-card, li[data-asin]');

      products.forEach((el, idx) => {
        const info = extractProductInfo(el, idx);
        if (info.asin && info.asin !== 'undefined') {
          if (sectionTitle.includes('viewed') || sectionTitle.includes('also')) {
            relatedProducts.customersAlsoViewed.push(info);
          } else {
            relatedProducts.relatedProducts.push(info);
          }
        }
      });
    });

    // 4. Sponsored Products
    const sponsoredSections = document.querySelectorAll('[data-component-type*="sp-"], [cel_widget_id*="sp-"]');
    sponsoredSections.forEach(section => {
      // Skip if already captured in other sections
      if (section.id === 'sims-fbt') return;

      const products = section.querySelectorAll('[data-asin]:not([data-asin=""])');
      products.forEach((el, idx) => {
        const info = extractProductInfo(el, idx);
        if (info.asin && info.asin !== 'undefined') {
          // Check if not already in other arrays
          const alreadyCaptured =
            relatedProducts.frequentlyBoughtTogether.some(p => p.asin === info.asin) ||
            relatedProducts.compareWithSimilar.some(p => p.asin === info.asin) ||
            relatedProducts.customersAlsoViewed.some(p => p.asin === info.asin);

          if (!alreadyCaptured) {
            relatedProducts.sponsoredProducts.push(info);
          }
        }
      });
    });

    // 5. Any other product cards on the page
    const allProductCards = document.querySelectorAll('[data-asin]:not([data-asin=""])');
    allProductCards.forEach((el, idx) => {
      const info = extractProductInfo(el, idx);
      if (info.asin && info.asin !== 'undefined' && info.title) {
        // Check if not already captured
        const alreadyCaptured =
          relatedProducts.frequentlyBoughtTogether.some(p => p.asin === info.asin) ||
          relatedProducts.compareWithSimilar.some(p => p.asin === info.asin) ||
          relatedProducts.customersAlsoViewed.some(p => p.asin === info.asin) ||
          relatedProducts.sponsoredProducts.some(p => p.asin === info.asin) ||
          relatedProducts.relatedProducts.some(p => p.asin === info.asin);

        if (!alreadyCaptured) {
          relatedProducts.other.push(info);
        }
      }
    });

    // Remove duplicates and clean up
    const removeDuplicates = (arr) => {
      const seen = new Set();
      return arr.filter(item => {
        if (!item.asin || seen.has(item.asin)) return false;
        seen.add(item.asin);
        return true;
      });
    };

    relatedProducts.frequentlyBoughtTogether = removeDuplicates(relatedProducts.frequentlyBoughtTogether);
    relatedProducts.compareWithSimilar = removeDuplicates(relatedProducts.compareWithSimilar);
    relatedProducts.customersAlsoViewed = removeDuplicates(relatedProducts.customersAlsoViewed);
    relatedProducts.sponsoredProducts = removeDuplicates(relatedProducts.sponsoredProducts);
    relatedProducts.relatedProducts = removeDuplicates(relatedProducts.relatedProducts);
    relatedProducts.other = removeDuplicates(relatedProducts.other);

    const totalProducts =
      relatedProducts.frequentlyBoughtTogether.length +
      relatedProducts.compareWithSimilar.length +
      relatedProducts.customersAlsoViewed.length +
      relatedProducts.sponsoredProducts.length +
      relatedProducts.relatedProducts.length +
      relatedProducts.other.length;

    return {
      success: true,
      action: 'related_products_extracted',
      method: 'realistic_scrolling_extraction_with_delivery_costs',
      currentProduct: {
        url: window.location.href,
        asin: window.location.pathname.match(/\\/dp\\/([A-Z0-9]{10})/)?.[1] || null
      },
      relatedProducts: relatedProducts,
      summary: {
        totalProducts: totalProducts,
        frequentlyBoughtTogetherCount: relatedProducts.frequentlyBoughtTogether.length,
        compareWithSimilarCount: relatedProducts.compareWithSimilar.length,
        customersAlsoViewedCount: relatedProducts.customersAlsoViewed.length,
        sponsoredProductsCount: relatedProducts.sponsoredProducts.length,
        relatedProductsCount: relatedProducts.relatedProducts.length,
        otherCount: relatedProducts.other.length
      },
      message: \`Extracted \${totalProducts} related products with delivery costs across \${Object.values(relatedProducts).filter(arr => arr.length > 0).length} sections\`,
      note: 'Used realistic full-page scrolling to capture all lazy-loaded content. Now includes delivery costs and total price calculations.'
    };
  })();
}`;

async function updateMacro() {
  const client = new MongoClient('mongodb://localhost:27017');

  try {
    await client.connect();
    const db = client.db('browser_mcp');
    const macros = db.collection('macros');

    // Get current macro
    const existing = await macros.findOne({ name: 'amazon_get_related_products' });

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
      { name: 'amazon_get_related_products' },
      {
        $set: {
          code: UPDATED_CODE,
          version: newVersion,
          updatedAt: new Date(),
          returnType: '{ success: boolean, action: string, method: string, currentProduct: object, relatedProducts: object (with deliveryCost, deliveryInfo, and totalCost fields), summary: object, message: string, note: string }'
        }
      }
    );

    if (result.modifiedCount === 1) {
      console.log('✅ Macro updated successfully!');
      console.log('New version:', newVersion);
      console.log('\nChanges:');
      console.log('- Added deliveryCost extraction');
      console.log('- Added deliveryInfo (full delivery text)');
      console.log('- Added totalCost calculation (price + delivery)');
      console.log('- Updated method name to reflect delivery cost extraction');
    } else {
      console.error('❌ Failed to update macro');
    }

  } finally {
    await client.close();
  }
}

updateMacro().catch(console.error);
