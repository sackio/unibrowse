export const ebayWatchlistMacro = {
  site: "ebay.com",
  category: "interaction",
  name: "ebay_add_to_watchlist",
  description: "Add the current eBay item listing to your watchlist. Must be on an eBay item page.",
  parameters: {},
  code: `(params) => {
    const result = {
      success: false,
      error: null,
      message: null
    };

    try {
      // Multi-layer selector strategy for "Add to watchlist" button
      const watchlistSelectors = [
        'button[data-test-id="add-to-watchlist"]',           // Data attribute (most reliable)
        'button._watchlistBtn',                              // Class-based
        'button[aria-label*="Add to watchlist"]',            // ARIA label
        'button[aria-label*="Watch"]',                       // Shorter ARIA label
        'a[href*="watchlist"]',                              // Link-based
        '.watchlist-cta',                                    // Generic class
        '.watchlist-button'                                  // Generic class
      ];

      let watchlistButton = null;
      for (const selector of watchlistSelectors) {
        watchlistButton = document.querySelector(selector);
        if (watchlistButton) {
          console.log(\`Found watchlist button with selector: \${selector}\`);
          break;
        }
      }

      // Text-based fallback
      if (!watchlistButton) {
        const allButtons = Array.from(document.querySelectorAll('button, a'));
        watchlistButton = allButtons.find(btn => {
          const text = btn.textContent.toLowerCase().trim();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          return text.includes('add to watchlist') ||
                 text.includes('watch this item') ||
                 text === 'watch' ||
                 ariaLabel.includes('add to watchlist') ||
                 ariaLabel.includes('watch');
        });

        if (watchlistButton) {
          console.log('Found watchlist button via text matching');
        }
      }

      if (!watchlistButton) {
        result.error = 'Could not find "Add to watchlist" button on this page';
        result.message = 'Make sure you are on an eBay item listing page';
        return result;
      }

      // Check if already in watchlist
      const buttonText = watchlistButton.textContent.toLowerCase().trim();
      const ariaLabel = (watchlistButton.getAttribute('aria-label') || '').toLowerCase();

      if (buttonText.includes('watching') ||
          buttonText.includes('remove') ||
          ariaLabel.includes('watching') ||
          ariaLabel.includes('remove from watchlist')) {
        result.success = true;
        result.message = 'Item is already in your watchlist';
        result.alreadyWatching = true;
        return result;
      }

      // Click the button
      watchlistButton.click();

      // Wait a moment for the action to complete
      setTimeout(() => {
        console.log('Watchlist button clicked');
      }, 100);

      result.success = true;
      result.message = 'Item added to watchlist successfully';
      result.alreadyWatching = false;

      return result;
    } catch (error) {
      result.error = error.message;
      return result;
    }
  }`,
  returnType: "Object with success status, message, and alreadyWatching flag",
  reliability: "untested",
  tags: ["ebay", "watchlist", "tracking", "interaction"]
};
