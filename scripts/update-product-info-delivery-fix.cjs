#!/usr/bin/env node

const { MongoClient } = require('mongodb');

const UPDATED_CODE = `(params) => {
  const result = {
    success: false,
    product: {}
  };

  try {
    // Realistic scrolling behavior - scroll from top to bottom to trigger lazy loading
    const scrollToBottom = async () => {
      const scrollHeight = document.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;
      const scrollSteps = Math.ceil(scrollHeight / viewportHeight);

      for (let i = 0; i <= scrollSteps; i++) {
        const targetY = (scrollHeight / scrollSteps) * i;
        window.scrollTo({
          top: targetY,
          behavior: 'smooth'
        });
        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 100));
      }

      // Scroll back to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await new Promise(resolve => setTimeout(resolve, 300));
    };

    // Execute scroll and wait for completion
    scrollToBottom();

    // Extract ASIN
    const asinMatch = window.location.href.match(/\\/dp\\/([A-Z0-9]{10})/);
    result.product.asin = asinMatch ? asinMatch[1] : null;

    // Extract title
    const titleEl = document.querySelector('#productTitle, #title');
    result.product.title = titleEl ? titleEl.textContent.trim() : null;

    // Extract price
    const priceWhole = document.querySelector('.a-price[data-a-size="xl"] .a-price-whole, .a-price[data-a-size="large"] .a-price-whole, .a-price .a-price-whole');
    const priceFraction = document.querySelector('.a-price[data-a-size="xl"] .a-price-fraction, .a-price[data-a-size="large"] .a-price-fraction, .a-price .a-price-fraction');

    if (priceWhole) {
      const whole = priceWhole.textContent.replace(/[^0-9]/g, '');
      const fraction = priceFraction ? priceFraction.textContent.replace(/[^0-9]/g, '') : '00';
      result.product.price = \`$\${whole}.\${fraction}\`;
    }

    // Extract unit price if available
    const unitPriceEl = document.querySelector('.a-price.a-text-price .a-offscreen');
    result.product.unitPrice = unitPriceEl ? unitPriceEl.textContent.trim() : null;

    // ENHANCED: Extract delivery information with availability detection
    let deliveryCost = null;
    let deliveryInfo = null;
    let deliveryAvailable = false;

    // Check for "See All Buying Options" which indicates no direct delivery
    const buyingOptionsButton = document.querySelector('#buybox-see-all-buying-choices, a[href*="all-offers-display"]');

    // Get full delivery text from the delivery block
    const deliveryBlock = document.querySelector('#mir-layout-DELIVERY_BLOCK, #deliveryBlockMessage, [id*="delivery"], #deliveryMessageMirId');
    if (deliveryBlock) {
      deliveryInfo = deliveryBlock.textContent.trim();

      // Check if delivery info indicates unavailability
      const unavailableIndicators = [
        'see all buying options',
        'see other buying options',
        'currently unavailable',
        'not available for delivery',
        'deliver to.*‌$' // Just the location prompt with no actual delivery info
      ];

      const infoLower = deliveryInfo.toLowerCase();
      const hasUnavailableIndicator = unavailableIndicators.some(indicator =>
        new RegExp(indicator, 'i').test(infoLower)
      );

      // Delivery is available if we have actual delivery information (dates, times, costs)
      const hasDeliveryDetails = /free|delivery|tomorrow|today|\\d+\\s*(day|week|month)/i.test(deliveryInfo);

      deliveryAvailable = !hasUnavailableIndicator && hasDeliveryDetails && deliveryInfo.length > 50;
    }

    // Only extract delivery cost if delivery is available
    if (deliveryAvailable) {
      // Try the data attribute first
      const deliveryPriceEl = document.querySelector('[data-csa-c-delivery-price]');
      if (deliveryPriceEl) {
        const deliveryPrice = deliveryPriceEl.getAttribute('data-csa-c-delivery-price');
        deliveryCost = deliveryPrice;
      }

      // If we didn't get delivery cost from attribute, extract from text
      if (!deliveryCost && deliveryInfo) {
        if (deliveryInfo.toLowerCase().includes('free')) {
          deliveryCost = '$0.00';
        } else {
          const feeMatch = deliveryInfo.match(/\\$([\\d,]+\\.\\d{2})/);
          if (feeMatch) {
            deliveryCost = \`$\${feeMatch[1].replace(/,/g, '')}\`;
          }
        }
      }

      // Normalize FREE delivery to $0.00
      if (deliveryCost && (deliveryCost.toLowerCase() === 'free' || deliveryCost === '$0.00' || deliveryCost.includes('FREE'))) {
        deliveryCost = '$0.00';
      }
    }

    result.product.deliveryCost = deliveryCost;
    result.product.deliveryInfo = deliveryInfo;
    result.product.deliveryAvailable = deliveryAvailable;

    // NEW: Calculate total cost (price + delivery) - only if delivery is available
    if (result.product.price && deliveryCost && deliveryAvailable) {
      try {
        const priceNum = parseFloat(result.product.price.replace(/[^0-9.]/g, ''));
        const deliveryNum = parseFloat(deliveryCost.replace(/[^0-9.]/g, ''));
        if (!isNaN(priceNum) && !isNaN(deliveryNum)) {
          result.product.totalCost = \`$\${(priceNum + deliveryNum).toFixed(2)}\`;
        }
      } catch (e) {
        // Ignore calculation errors
      }
    }

    // Extract availability
    const availabilityEl = document.querySelector('#availability span, #availability');
    result.product.availability = availabilityEl ? availabilityEl.textContent.trim() : null;

    // Extract rating
    const ratingEl = document.querySelector('#acrPopover, [data-hook="rating-out-of-text"]');
    if (ratingEl) {
      const ratingText = ratingEl.getAttribute('title') || ratingEl.textContent;
      const ratingMatch = ratingText.match(/([\\d.]+)\\s*out of/i);
      result.product.rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
    }

    // Extract rating count
    const ratingCountEl = document.querySelector('#acrCustomerReviewText, [data-hook="total-review-count"]');
    if (ratingCountEl) {
      const countText = ratingCountEl.textContent.replace(/[^0-9]/g, '');
      result.product.ratingCount = countText ? parseInt(countText) : null;
    }

    // Extract social proof (e.g., "10K+ bought in past month")
    const socialProofEl = document.querySelector('[id*="social-proofing"], .social-proofing-widget-text');
    result.product.socialProof = socialProofEl ? socialProofEl.textContent.trim() : null;

    // Extract brand
    const brandEl = document.querySelector('#bylineInfo, .po-brand .po-break-word');
    result.product.brand = brandEl ? brandEl.textContent.replace(/^(Visit the|Brand:\\s*)/i, '').trim() : null;

    // Extract variations (size, color, style, etc.)
    const variations = [];
    const variationSelects = document.querySelectorAll('#variation_size_name select, #variation_color_name select, #variation_style_name select, [id*="variation"] select');
    variationSelects.forEach(select => {
      const variationType = select.id.replace(/^native_dropdown_selected_size_name|variation_|_name$/g, '');
      const options = Array.from(select.options)
        .filter(opt => opt.value && opt.value !== '-1')
        .map(opt => opt.textContent.trim());

      if (options.length > 0) {
        variations.push({
          type: variationType,
          options: options
        });
      }
    });

    // Also check for button-based variations
    const variationButtons = document.querySelectorAll('[id*="variation"] li[data-defaultasin], [class*="variation"] li[data-dp-url]');
    if (variationButtons.length > 0) {
      const buttonVariations = {};
      variationButtons.forEach(btn => {
        const typeContainer = btn.closest('[id*="variation"]');
        const typeId = typeContainer ? typeContainer.id : 'unknown';
        const variationType = typeId.replace(/^variation_|_name$/g, '');
        const value = btn.querySelector('.selection')?.textContent.trim() ||
                     btn.getAttribute('title') ||
                     btn.textContent.trim();

        if (!buttonVariations[variationType]) {
          buttonVariations[variationType] = [];
        }
        if (value) {
          buttonVariations[variationType].push(value);
        }
      });

      Object.entries(buttonVariations).forEach(([type, options]) => {
        if (options.length > 0) {
          variations.push({ type, options });
        }
      });
    }

    result.product.variations = variations.length > 0 ? variations : null;

    // Check if product requires customization before adding to cart
    const customizeButton = document.querySelector('[name="submit.add-to-cart-upsell"], #customize-button, [id*="customize"]');
    result.product.requiresCustomization = !!customizeButton;

    // Optional: Extract features/bullets
    if (params.includeFeatures) {
      const featuresList = document.querySelector('#feature-bullets ul, .a-unordered-list.a-vertical.a-spacing-mini');
      if (featuresList) {
        const features = Array.from(featuresList.querySelectorAll('li span.a-list-item'))
          .map(li => li.textContent.trim())
          .filter(text => text && text.length > 0);
        result.product.features = features.length > 0 ? features : null;
      }
    }

    // Optional: Extract product description
    if (params.includeDescription) {
      const descEl = document.querySelector('#productDescription p, #productDescription');
      result.product.description = descEl ? descEl.textContent.trim() : null;
    }

    // Optional: Extract specifications
    if (params.includeSpecs) {
      const specs = {};
      const specRows = document.querySelectorAll('#productDetails_techSpec_section_1 tr, .prodDetTable tr');
      specRows.forEach(row => {
        const label = row.querySelector('th, .prodDetSectionEntry')?.textContent.trim();
        const value = row.querySelector('td, .prodDetAttrValue')?.textContent.trim();
        if (label && value) {
          specs[label] = value;
        }
      });
      result.product.specifications = Object.keys(specs).length > 0 ? specs : null;
    }

    // Optional: Extract "About this item" section
    if (params.includeAboutItem) {
      const aboutSection = document.querySelector('#feature-bullets, [data-feature-name="featurebullets"]');
      if (aboutSection) {
        const aboutItems = Array.from(aboutSection.querySelectorAll('li span.a-list-item'))
          .map(item => item.textContent.trim())
          .filter(text => text && text.length > 0);
        result.product.aboutItem = aboutItems.length > 0 ? aboutItems : null;
      }
    }

    result.success = true;
    return result;

  } catch (error) {
    result.error = error.message;
    return result;
  }
}`;

async function updateMacro() {
  const client = new MongoClient('mongodb://localhost:27017');

  try {
    await client.connect();
    const db = client.db('browser_mcp');
    const macros = db.collection('macros');

    // Get current macro
    const existing = await macros.findOne({ name: 'amazon_get_product_info' });

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
      { name: 'amazon_get_product_info' },
      {
        $set: {
          code: UPDATED_CODE,
          version: newVersion,
          updatedAt: new Date(),
          returnType: '{ success: boolean, product: { asin, title, price, unitPrice?, deliveryCost, deliveryInfo, deliveryAvailable, totalCost?, availability, rating, ratingCount, socialProof?, brand?, variations, requiresCustomization, description?, features?, specifications?, aboutItem? } }'
        }
      }
    );

    if (result.modifiedCount === 1) {
      console.log('✅ Macro updated successfully!');
      console.log('New version:', newVersion);
      console.log('\nChanges:');
      console.log('- Added deliveryAvailable boolean field');
      console.log('- Detects "See All Buying Options" and similar unavailability indicators');
      console.log('- Only extracts delivery cost when delivery is actually available');
      console.log('- Improved detection of delivery availability vs just location prompt');
      console.log('- totalCost now only calculated when delivery is available');
    } else {
      console.error('❌ Failed to update macro');
    }

  } finally {
    await client.close();
  }
}

updateMacro().catch(console.error);
