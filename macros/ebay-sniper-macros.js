/**
 * eBay Auction Sniper Macros
 *
 * Safe testing workflow for eBay auction bidding.
 * These macros fill forms but DO NOT submit final bids.
 *
 * Workflow:
 * 1. ebay_sniper_analyze_page - Detect current page and extract state
 * 2. ebay_sniper_initiate_bid - Click "Place Bid" button
 * 3. ebay_sniper_fill_bid - Fill bid amount (NO SUBMIT)
 * 4. ebay_sniper_review_bid - Extract confirmation page (READ-ONLY)
 *
 * SAFETY: All macros stop before final bid confirmation.
 * User must manually click confirm button (for practice only).
 */

export const ebaySniperMacros = [
  {
    site: "ebay.com",
    category: "extraction",
    name: "ebay_sniper_analyze_page",
    description: "Detect current page in bid workflow and extract state (product/bid entry/confirmation)",
    parameters: {},
    code: `(params) => {
      // Multi-page detector for eBay bid workflow
      const result = {
        success: false,
        pageType: "unknown",
        url: window.location.href,
        itemId: null,
        timestamp: Date.now(),
        error: null
      };

      try {
        // Extract item ID from URL
        const urlMatch = result.url.match(/\\/itm\\/([\\d]+)/);
        if (urlMatch) {
          result.itemId = urlMatch[1];
        }

        // Page type detection logic
        const url = result.url.toLowerCase();

        // 1. Check for product page
        if (url.includes('/itm/') && !url.includes('/confirmbid')) {
          // Look for Place Bid button
          const placeBidSelectors = [
            'button[data-test-id="place-bid"]',
            '#placebidbtn',
            'button.btn-place-bid',
            'a[href*="placeoffer"]'
          ];

          let placeBidButton = null;
          for (const selector of placeBidSelectors) {
            placeBidButton = document.querySelector(selector);
            if (placeBidButton) break;
          }

          // Also check by text content
          if (!placeBidButton) {
            const buttons = Array.from(document.querySelectorAll('button, a'));
            placeBidButton = buttons.find(btn =>
              /place\\s+bid/i.test(btn.textContent.trim())
            );
          }

          if (placeBidButton) {
            result.pageType = "product_page";

            // Extract product details
            result.product = {};

            // Title
            const titleSelectors = [
              'h1.x-item-title__mainTitle',
              'h1[itemprop="name"]',
              '.it-ttl'
            ];
            for (const selector of titleSelectors) {
              const titleEl = document.querySelector(selector);
              if (titleEl) {
                result.product.title = titleEl.textContent.trim();
                break;
              }
            }

            // Current bid
            const bidSelectors = [
              'div[data-testid="x-price-primary"] .ux-textspans',
              '.x-price-primary span',
              '#prcIsum'
            ];
            for (const selector of bidSelectors) {
              const bidEl = document.querySelector(selector);
              if (bidEl) {
                const bidText = bidEl.textContent.trim();
                const bidMatch = bidText.match(/\\$?([\\d,]+\\.?\\d*)/);
                if (bidMatch) {
                  result.product.currentBid = parseFloat(bidMatch[1].replace(/,/g, ''));
                  break;
                }
              }
            }

            // Time left
            const timeSelectors = [
              '.ux-timer__text',
              '.timeMs',
              'span[data-testid="ux-timer"]'
            ];
            for (const selector of timeSelectors) {
              const timeEl = document.querySelector(selector);
              if (timeEl) {
                result.product.timeLeft = timeEl.textContent.trim();
                break;
              }
            }

            // Bid count
            const bidCountEl = document.querySelector('[data-testid="x-bid-count"]');
            if (bidCountEl) {
              const countMatch = bidCountEl.textContent.match(/\\d+/);
              if (countMatch) {
                result.product.bidCount = parseInt(countMatch[0]);
              }
            }

            result.product.isAuction = result.product.bidCount !== undefined ||
                                       result.product.timeLeft !== undefined;

            result.success = true;
          }
        }

        // 2. Check for bid entry page
        if (!result.success && (url.includes('placeoffer') || url.includes('binconfirm'))) {
          const bidInputSelectors = [
            'input[data-test-id="bid-amount"]',
            '#MaxBidId',
            'input[name="maxbid"]',
            'input[type="text"][maxlength="10"]'
          ];

          let bidInput = null;
          for (const selector of bidInputSelectors) {
            bidInput = document.querySelector(selector);
            if (bidInput) break;
          }

          // Context-based search
          if (!bidInput) {
            const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="number"]'));
            bidInput = inputs.find(input => {
              const label = input.labels?.[0]?.textContent || '';
              const placeholder = input.placeholder || '';
              return /bid|amount/i.test(label + placeholder);
            });
          }

          if (bidInput) {
            result.pageType = "bid_entry_page";
            result.bidEntry = {};

            // Extract minimum bid
            const pageText = document.body.textContent;
            const minBidPatterns = [
              /enter\\s+\\$?([\\d,]+\\.?\\d*)\\s+or\\s+more/i,
              /minimum\\s+bid[:\\s]+\\$?([\\d,]+\\.?\\d*)/i,
              /starting\\s+bid[:\\s]+\\$?([\\d,]+\\.?\\d*)/i
            ];

            for (const pattern of minBidPatterns) {
              const match = pageText.match(pattern);
              if (match) {
                result.bidEntry.minBid = parseFloat(match[1].replace(/,/g, ''));
                break;
              }
            }

            // Find submit button
            const submitSelectors = [
              'button[name="submit_bid"]',
              'button[type="submit"]',
              'input[type="submit"]'
            ];

            for (const selector of submitSelectors) {
              const submitBtn = document.querySelector(selector);
              if (submitBtn) {
                result.bidEntry.submitButton = {
                  text: submitBtn.value || submitBtn.textContent.trim(),
                  disabled: submitBtn.disabled,
                  selector: selector
                };
                break;
              }
            }

            result.bidEntry.maxBidField = {
              selector: bidInputSelectors.find(s => document.querySelector(s)) || 'unknown',
              value: bidInput.value,
              placeholder: bidInput.placeholder
            };

            result.success = true;
          }
        }

        // 3. Check for confirmation page
        if (!result.success && url.includes('confirm')) {
          const confirmButtonSelectors = [
            'button[name="confirm"]',
            'button[id*="confirm"]',
            'input[type="submit"][value*="onfirm"]'
          ];

          let confirmButton = null;
          for (const selector of confirmButtonSelectors) {
            confirmButton = document.querySelector(selector);
            if (confirmButton) break;
          }

          // Text-based search
          if (!confirmButton) {
            const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
            confirmButton = buttons.find(btn =>
              /confirm\\s+bid/i.test(btn.value || btn.textContent)
            );
          }

          if (confirmButton) {
            result.pageType = "bid_confirmation_page";
            result.confirmation = {};

            // Extract bid amount
            const amountPatterns = [
              /your\\s+bid[:\\s]+\\$?([\\d,]+\\.?\\d*)/i,
              /max\\s+bid[:\\s]+\\$?([\\d,]+\\.?\\d*)/i
            ];

            const pageText = document.body.textContent;
            for (const pattern of amountPatterns) {
              const match = pageText.match(pattern);
              if (match) {
                result.confirmation.bidAmount = parseFloat(match[1].replace(/,/g, ''));
                break;
              }
            }

            // Extract total cost
            const totalPattern = /total[:\\s]+\\$?([\\d,]+\\.?\\d*)/i;
            const totalMatch = pageText.match(totalPattern);
            if (totalMatch) {
              result.confirmation.total = parseFloat(totalMatch[1].replace(/,/g, ''));
            }

            result.confirmation.confirmButton = {
              text: confirmButton.value || confirmButton.textContent.trim(),
              disabled: confirmButton.disabled,
              selector: confirmButtonSelectors.find(s => document.querySelector(s)) || 'unknown'
            };

            result.success = true;
          }
        }

        // If still unknown, provide hints
        if (!result.success) {
          result.pageType = "unknown";
          result.error = "Could not detect bid workflow page type. URL: " + result.url;
          result.hint = "Expected URLs: /itm/ (product), placeoffer (bid entry), confirm (confirmation)";
        }

      } catch (error) {
        result.success = false;
        result.error = error.message;
        result.stack = error.stack;
      }

      return result;
    }`,
    returnType: "object",
    reliability: "untested",
    tags: ["ebay", "auction", "detection", "navigation", "safety"]
  },

  {
    site: "ebay.com",
    category: "interaction",
    name: "ebay_sniper_initiate_bid",
    description: "Click Place Bid button to navigate to bid entry page (verifies auction first)",
    parameters: {
      verifyAuction: {
        type: "boolean",
        required: false,
        default: true,
        description: "Verify listing is an auction before clicking"
      }
    },
    code: `(params) => {
      const { verifyAuction = true } = params;

      const result = {
        success: false,
        action: null,
        preClickState: {},
        error: null,
        message: null
      };

      try {
        // 1. Verify we're on product page
        const url = window.location.href;
        if (!url.includes('/itm/')) {
          result.error = "Not on product page. URL: " + url;
          return result;
        }

        // Extract item ID
        const itemMatch = url.match(/\\/itm\\/([\\d]+)/);
        if (itemMatch) {
          result.preClickState.itemId = itemMatch[1];
        }

        // 2. Verify auction (if requested)
        if (verifyAuction) {
          // Check for auction indicators
          const bidCountEl = document.querySelector('[data-testid="x-bid-count"]');
          const timeLeftEl = document.querySelector('.ux-timer__text, .timeMs');

          if (!bidCountEl && !timeLeftEl) {
            result.error = "Auction verification failed: No bid count or time remaining found";
            result.warning = "This may not be an auction listing";
            return result;
          }

          result.preClickState.isAuction = true;

          if (bidCountEl) {
            const countMatch = bidCountEl.textContent.match(/\\d+/);
            if (countMatch) {
              result.preClickState.bidCount = parseInt(countMatch[0]);
            }
          }

          if (timeLeftEl) {
            result.preClickState.timeLeft = timeLeftEl.textContent.trim();
          }
        }

        // 3. Extract current bid
        const bidSelectors = [
          'div[data-testid="x-price-primary"] .ux-textspans',
          '.x-price-primary span',
          '#prcIsum'
        ];

        for (const selector of bidSelectors) {
          const bidEl = document.querySelector(selector);
          if (bidEl) {
            const bidText = bidEl.textContent.trim();
            const bidMatch = bidText.match(/\\$?([\\d,]+\\.?\\d*)/);
            if (bidMatch) {
              result.preClickState.currentBid = parseFloat(bidMatch[1].replace(/,/g, ''));
              break;
            }
          }
        }

        // 4. Find Place Bid button
        const placeBidSelectors = [
          'button[data-test-id="place-bid"]',
          '#placebidbtn',
          'button.btn-place-bid',
          'a[href*="placeoffer"]'
        ];

        let placeBidButton = null;
        let usedSelector = null;

        for (const selector of placeBidSelectors) {
          placeBidButton = document.querySelector(selector);
          if (placeBidButton) {
            usedSelector = selector;
            break;
          }
        }

        // Text-based fallback
        if (!placeBidButton) {
          const buttons = Array.from(document.querySelectorAll('button, a'));
          placeBidButton = buttons.find(btn =>
            /place\\s+bid/i.test(btn.textContent.trim())
          );
          if (placeBidButton) {
            usedSelector = 'text-match: ' + placeBidButton.textContent.trim();
          }
        }

        if (!placeBidButton) {
          result.error = "Place Bid button not found";
          result.hint = "Tried selectors: " + placeBidSelectors.join(', ');
          return result;
        }

        result.preClickState.buttonText = placeBidButton.textContent.trim() || placeBidButton.value;
        result.preClickState.buttonSelector = usedSelector;

        // 5. Click the button
        placeBidButton.click();

        result.success = true;
        result.action = "clicked_place_bid";
        result.message = "Place Bid button clicked, page will navigate to bid entry form";

      } catch (error) {
        result.success = false;
        result.error = error.message;
        result.stack = error.stack;
      }

      return result;
    }`,
    returnType: "object",
    reliability: "untested",
    tags: ["ebay", "auction", "bidding", "interaction", "navigation"]
  },

  {
    site: "ebay.com",
    category: "interaction",
    name: "ebay_sniper_fill_bid",
    description: "Fill bid amount on bid entry page (DOES NOT SUBMIT - safe for testing)",
    parameters: {
      bidAmount: {
        type: "number",
        required: true,
        description: "Bid amount in dollars (e.g., 142.50)"
      },
      verifyMinimum: {
        type: "boolean",
        required: false,
        default: true,
        description: "Verify bid meets minimum requirement"
      }
    },
    code: `(params) => {
      const { bidAmount, verifyMinimum = true } = params;

      const result = {
        success: false,
        action: null,
        bidAmount: bidAmount,
        minimumBid: null,
        bidInput: null,
        submitButton: null,
        validationError: null,
        warning: "⚠️  BID NOT SUBMITTED - Review page before manual submission",
        error: null
      };

      try {
        // 1. Verify bid amount is valid
        if (typeof bidAmount !== 'number' || bidAmount <= 0) {
          result.error = "Invalid bid amount: " + bidAmount;
          return result;
        }

        // 2. Verify we're on bid entry page
        const url = window.location.href.toLowerCase();
        if (!url.includes('placeoffer') && !url.includes('binconfirm')) {
          result.error = "Not on bid entry page. URL: " + window.location.href;
          result.hint = "Expected URL to contain 'placeoffer' or 'binconfirm'";
          return result;
        }

        // 3. Find bid input field
        const bidInputSelectors = [
          'input[data-test-id="bid-amount"]',
          '#MaxBidId',
          'input[name="maxbid"]',
          'input[type="text"][maxlength="10"]'
        ];

        let bidInput = null;
        let usedSelector = null;

        for (const selector of bidInputSelectors) {
          bidInput = document.querySelector(selector);
          if (bidInput) {
            usedSelector = selector;
            break;
          }
        }

        // Context-based fallback
        if (!bidInput) {
          const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="number"]'));
          bidInput = inputs.find(input => {
            const label = input.labels?.[0]?.textContent || '';
            const placeholder = input.placeholder || '';
            const name = input.name || '';
            return /bid|amount|max/i.test(label + placeholder + name);
          });
          if (bidInput) {
            usedSelector = 'context-match';
          }
        }

        if (!bidInput) {
          result.error = "Bid input field not found";
          result.hint = "Tried selectors: " + bidInputSelectors.join(', ');
          return result;
        }

        // 4. Extract minimum bid
        const pageText = document.body.textContent;
        const minBidPatterns = [
          /enter\\s+\\$?([\\d,]+\\.?\\d*)\\s+or\\s+more/i,
          /minimum\\s+bid[:\\s]+\\$?([\\d,]+\\.?\\d*)/i,
          /starting\\s+bid[:\\s]+\\$?([\\d,]+\\.?\\d*)/i,
          /current\\s+bid[:\\s]+\\$?([\\d,]+\\.?\\d*)/i
        ];

        for (const pattern of minBidPatterns) {
          const match = pageText.match(pattern);
          if (match) {
            result.minimumBid = parseFloat(match[1].replace(/,/g, ''));
            break;
          }
        }

        // 5. Verify minimum bid (if enabled and found)
        if (verifyMinimum && result.minimumBid !== null) {
          if (bidAmount < result.minimumBid) {
            result.error = \`Bid amount \$\${bidAmount.toFixed(2)} is below minimum \$\${result.minimumBid.toFixed(2)}\`;
            result.validationError = "below_minimum";
            return result;
          }
        }

        // 6. Format bid amount
        const formattedBid = bidAmount.toFixed(2);

        // 7. Fill input field and trigger validation events
        bidInput.value = formattedBid;
        bidInput.dispatchEvent(new Event('input', { bubbles: true }));
        bidInput.dispatchEvent(new Event('change', { bubbles: true }));
        bidInput.dispatchEvent(new Event('blur', { bubbles: true }));

        result.bidInput = {
          value: bidInput.value,
          selector: usedSelector
        };

        // 8. Check for inline validation errors
        const errorSelectors = [
          '.error-msg',
          '.alert-error',
          '[role="alert"]',
          '.invalid-feedback'
        ];

        for (const selector of errorSelectors) {
          const errorEl = document.querySelector(selector);
          if (errorEl && errorEl.offsetParent !== null) { // visible
            const errorText = errorEl.textContent.trim();
            if (errorText.length > 0) {
              result.validationError = errorText;
              break;
            }
          }
        }

        // 9. Find submit button (for info only - DO NOT CLICK)
        const submitSelectors = [
          'button[name="submit_bid"]',
          'button[type="submit"]',
          'input[type="submit"]',
          'button.btn-prim'
        ];

        let submitButton = null;
        let submitSelector = null;

        for (const selector of submitSelectors) {
          submitButton = document.querySelector(selector);
          if (submitButton) {
            submitSelector = selector;
            break;
          }
        }

        // Text-based fallback
        if (!submitButton) {
          const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
          submitButton = buttons.find(btn =>
            /continue|submit|confirm/i.test(btn.value || btn.textContent)
          );
          if (submitButton) {
            submitSelector = 'text-match';
          }
        }

        if (submitButton) {
          result.submitButton = {
            text: submitButton.value || submitButton.textContent.trim(),
            disabled: submitButton.disabled,
            selector: submitSelector
          };
        }

        result.success = true;
        result.action = "filled_bid_amount";
        result.nextStep = "Click submit button to proceed to confirmation page (MANUAL ACTION REQUIRED)";

      } catch (error) {
        result.success = false;
        result.error = error.message;
        result.stack = error.stack;
      }

      return result;
    }`,
    returnType: "object",
    reliability: "untested",
    tags: ["ebay", "auction", "bidding", "form-filling", "safety"]
  },

  {
    site: "ebay.com",
    category: "extraction",
    name: "ebay_sniper_review_bid",
    description: "Extract confirmation page data (READ-ONLY - does not interact with page)",
    parameters: {},
    code: `(params) => {
      const result = {
        success: false,
        pageType: "confirmation_page",
        url: window.location.href,
        itemId: null,
        timestamp: Date.now(),
        item: {},
        bid: {},
        confirmButton: null,
        messages: [],
        safetyWarning: "🛑 DO NOT CLICK CONFIRM BUTTON - This is for practice/testing only",
        readOnly: true,
        error: null
      };

      try {
        // 1. Verify we're on confirmation page
        const url = result.url.toLowerCase();
        if (!url.includes('confirm') && !url.includes('review')) {
          result.error = "Not on confirmation page. URL: " + result.url;
          result.hint = "Expected URL to contain 'confirm' or 'review'";
          return result;
        }

        // Extract item ID
        const itemMatch = result.url.match(/item[=\\/]([\\d]+)/i);
        if (itemMatch) {
          result.itemId = itemMatch[1];
        }

        // 2. Extract item details
        // Title
        const titleSelectors = [
          'h1.it-ttl',
          '.item-title',
          '[data-testid="item-title"]',
          'h1'
        ];

        for (const selector of titleSelectors) {
          const titleEl = document.querySelector(selector);
          if (titleEl) {
            result.item.title = titleEl.textContent.trim();
            break;
          }
        }

        // Image
        const imgSelectors = [
          'img.it-img',
          '.item-image img',
          '[data-testid="item-image"]'
        ];

        for (const selector of imgSelectors) {
          const imgEl = document.querySelector(selector);
          if (imgEl && imgEl.src) {
            result.item.imageUrl = imgEl.src;
            break;
          }
        }

        // Item number
        const pageText = document.body.textContent;
        const itemNumberMatch = pageText.match(/item\\s+number[:\\s]+([\\d]+)/i);
        if (itemNumberMatch) {
          result.item.itemNumber = itemNumberMatch[1];
        }

        // 3. Extract bid details
        const bidPatterns = {
          yourBid: [
            /your\\s+(?:max\\s+)?bid[:\\s]+\\$?([\\d,]+\\.?\\d*)/i,
            /bid\\s+amount[:\\s]+\\$?([\\d,]+\\.?\\d*)/i
          ],
          shippingCost: [
            /shipping[:\\s]+\\$?([\\d,]+\\.?\\d*)/i,
            /postage[:\\s]+\\$?([\\d,]+\\.?\\d*)/i
          ],
          totalCost: [
            /total[:\\s]+\\$?([\\d,]+\\.?\\d*)/i,
            /amount\\s+to\\s+pay[:\\s]+\\$?([\\d,]+\\.?\\d*)/i
          ],
          currentBid: [
            /current\\s+bid[:\\s]+\\$?([\\d,]+\\.?\\d*)/i,
            /winning\\s+bid[:\\s]+\\$?([\\d,]+\\.?\\d*)/i
          ],
          bidIncrement: [
            /bid\\s+increment[:\\s]+\\$?([\\d,]+\\.?\\d*)/i,
            /minimum\\s+increment[:\\s]+\\$?([\\d,]+\\.?\\d*)/i
          ]
        };

        for (const [key, patterns] of Object.entries(bidPatterns)) {
          for (const pattern of patterns) {
            const match = pageText.match(pattern);
            if (match) {
              result.bid[key] = parseFloat(match[1].replace(/,/g, ''));
              break;
            }
          }
        }

        // 4. Find confirm button (INFO ONLY - do not provide click capability)
        const confirmButtonSelectors = [
          'button[name="confirm"]',
          'button[id*="confirm"]',
          'input[type="submit"][value*="onfirm"]',
          'button.btn-prim'
        ];

        let confirmButton = null;
        let confirmSelector = null;

        for (const selector of confirmButtonSelectors) {
          confirmButton = document.querySelector(selector);
          if (confirmButton) {
            confirmSelector = selector;
            break;
          }
        }

        // Text-based fallback
        if (!confirmButton) {
          const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
          confirmButton = buttons.find(btn =>
            /confirm\\s+bid/i.test(btn.value || btn.textContent)
          );
          if (confirmButton) {
            confirmSelector = 'text-match';
          }
        }

        if (confirmButton) {
          result.confirmButton = {
            text: confirmButton.value || confirmButton.textContent.trim(),
            disabled: confirmButton.disabled,
            selector: confirmSelector,
            warning: "⚠️  DO NOT CLICK THIS BUTTON IN PRODUCTION"
          };
        }

        // 5. Extract page messages/warnings
        const messageSelectors = [
          '.msg',
          '.alert',
          '[role="alert"]',
          '.notice'
        ];

        for (const selector of messageSelectors) {
          const messageEls = document.querySelectorAll(selector);
          messageEls.forEach(el => {
            if (el.offsetParent !== null) { // visible
              const text = el.textContent.trim();
              if (text.length > 0) {
                result.messages.push({
                  type: el.className.includes('error') ? 'error' :
                        el.className.includes('warning') ? 'warning' : 'info',
                  text: text
                });
              }
            }
          });
        }

        result.success = true;

      } catch (error) {
        result.success = false;
        result.error = error.message;
        result.stack = error.stack;
      }

      return result;
    }`,
    returnType: "object",
    reliability: "untested",
    tags: ["ebay", "auction", "confirmation", "extraction", "safety", "read-only"]
  }
];
