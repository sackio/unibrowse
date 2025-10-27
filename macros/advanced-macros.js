/**
 * Browser MCP Advanced Macros Library
 *
 * Extended collection of 24 advanced macros for performance monitoring,
 * accessibility auditing, content extraction, and testing automation.
 *
 * Usage: Import these macros into Browser MCP using browser_store_macro
 */

// ============================================================================
// TIER 1: MOST VALUABLE MACROS (5)
// ============================================================================

/**
 * Extract Main Content
 * Intelligently extract article/main content (like Reader Mode)
 */
const extractMainContent = {
  site: "*",
  category: "extraction",
  name: "extract_main_content",
  description: "Intelligently extract article/main content similar to Reader Mode",
  parameters: {},
  code: `(params) => {
    // Find main content container
    const mainSelectors = [
      'article',
      '[role="main"]',
      'main',
      '.article-content',
      '.post-content',
      '.entry-content',
      '#content'
    ];

    let mainContent = null;
    for (const selector of mainSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        mainContent = el;
        break;
      }
    }

    if (!mainContent) {
      // Fallback: find element with most paragraph text
      const candidates = document.querySelectorAll('div, section');
      let maxWords = 0;
      candidates.forEach(el => {
        const words = el.innerText.split(/\\s+/).length;
        if (words > maxWords) {
          maxWords = words;
          mainContent = el;
        }
      });
    }

    if (!mainContent) {
      return { found: false, message: 'Could not identify main content' };
    }

    // Extract metadata
    const title = document.querySelector('h1')?.textContent.trim() || document.title;
    const author = document.querySelector('[rel="author"], .author, .byline')?.textContent.trim() || null;
    const dateEl = document.querySelector('time, .date, .published');
    const publishDate = dateEl?.getAttribute('datetime') || dateEl?.textContent.trim() || null;

    // Extract clean text
    const content = mainContent.innerText.trim();
    const wordCount = content.split(/\\s+/).length;
    const readingTime = Math.ceil(wordCount / 200); // avg 200 words per minute

    return {
      found: true,
      title: title.substring(0, 200),
      author: author?.substring(0, 100),
      publishDate: publishDate,
      content: content.substring(0, 5000), // limit to avoid token explosion
      wordCount: wordCount,
      readingTime: readingTime + ' min',
      contentTruncated: content.length > 5000
    };
  }`,
  returnType: "Object with title, author, publishDate, content, wordCount, readingTime",
  reliability: "high",
  tags: ["extraction", "content", "readability"]
};

/**
 * Detect Page Load State
 * Check if page is fully loaded or still loading
 */
const detectPageLoadState = {
  site: "*",
  category: "performance",
  name: "detect_page_load_state",
  description: "Check if page is fully loaded or still loading with detailed metrics",
  parameters: {},
  code: `(params) => {
    const state = {
      domReady: document.readyState === 'complete',
      readyState: document.readyState,
      imagesLoaded: 0,
      fontsLoaded: false,
      scriptsRunning: false,
      networkIdle: false
    };

    // Check images
    const images = document.querySelectorAll('img');
    const loadedImages = Array.from(images).filter(img => img.complete).length;
    state.imagesLoaded = images.length > 0 ? Math.round((loadedImages / images.length) * 100) : 100;

    // Check fonts (if supported)
    if (document.fonts) {
      state.fontsLoaded = document.fonts.status === 'loaded';
    }

    // Check for active network requests (approximate)
    if (window.performance && window.performance.getEntriesByType) {
      const resources = window.performance.getEntriesByType('resource');
      const recentRequests = resources.filter(r => {
        return (Date.now() - r.startTime) < 2000; // requests in last 2 seconds
      });
      state.networkIdle = recentRequests.length === 0;
    }

    // Overall load state
    if (state.domReady && state.imagesLoaded === 100 && state.fontsLoaded && state.networkIdle) {
      state.loadState = 'complete';
    } else if (state.domReady) {
      state.loadState = 'interactive';
    } else {
      state.loadState = 'loading';
    }

    return state;
  }`,
  returnType: "Object with domReady, imagesLoaded percentage, fontsLoaded, networkIdle, loadState",
  reliability: "high",
  tags: ["performance", "loading", "timing"]
};

/**
 * Audit Accessibility
 * Basic accessibility checks
 */
const auditAccessibility = {
  site: "*",
  category: "accessibility",
  name: "audit_accessibility",
  description: "Perform basic accessibility audit and return issues with severity",
  parameters: {},
  code: `(params) => {
    const issues = [];
    let score = 100;

    // Check 1: Images without alt text
    const imagesWithoutAlt = Array.from(document.querySelectorAll('img')).filter(img => !img.alt);
    if (imagesWithoutAlt.length > 0) {
      issues.push({ type: 'missing-alt', count: imagesWithoutAlt.length, severity: 'warning' });
      score -= Math.min(imagesWithoutAlt.length * 2, 15);
    }

    // Check 2: Form inputs without labels
    const inputsWithoutLabels = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"])')).filter(input => {
      return !input.labels || input.labels.length === 0;
    });
    if (inputsWithoutLabels.length > 0) {
      issues.push({ type: 'missing-labels', count: inputsWithoutLabels.length, severity: 'warning' });
      score -= Math.min(inputsWithoutLabels.length * 3, 15);
    }

    // Check 3: Buttons without text or aria-label
    const buttonsWithoutText = Array.from(document.querySelectorAll('button')).filter(btn => {
      return !btn.textContent.trim() && !btn.getAttribute('aria-label');
    });
    if (buttonsWithoutText.length > 0) {
      issues.push({ type: 'unlabeled-buttons', count: buttonsWithoutText.length, severity: 'error' });
      score -= Math.min(buttonsWithoutText.length * 4, 20);
    }

    // Check 4: Missing lang attribute
    if (!document.documentElement.lang) {
      issues.push({ type: 'missing-lang', count: 1, severity: 'warning' });
      score -= 5;
    }

    // Check 5: Heading hierarchy (check for skipped levels)
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    let lastLevel = 0;
    let skippedLevels = 0;
    headings.forEach(h => {
      const level = parseInt(h.tagName[1]);
      if (lastLevel > 0 && level - lastLevel > 1) {
        skippedLevels++;
      }
      lastLevel = level;
    });
    if (skippedLevels > 0) {
      issues.push({ type: 'skipped-heading-levels', count: skippedLevels, severity: 'warning' });
      score -= Math.min(skippedLevels * 3, 10);
    }

    // Check 6: Links without discernible text
    const emptyLinks = Array.from(document.querySelectorAll('a[href]')).filter(link => {
      return !link.textContent.trim() && !link.getAttribute('aria-label') && !link.querySelector('img[alt]');
    });
    if (emptyLinks.length > 0) {
      issues.push({ type: 'empty-links', count: emptyLinks.length, severity: 'error' });
      score -= Math.min(emptyLinks.length * 4, 20);
    }

    // Check keyboard navigation
    const keyboardNavigable = document.querySelectorAll('[tabindex]').length > 0 ||
                             document.querySelectorAll('a, button, input, select, textarea').length > 0;

    // Check ARIA usage
    const ariaElements = document.querySelectorAll('[role], [aria-label], [aria-labelledby], [aria-describedby]');
    const ariaCompliant = ariaElements.length > 0 ? 'partial' : 'none';

    return {
      issues: issues,
      issueCount: issues.length,
      score: Math.max(score, 0),
      keyboardNavigable: keyboardNavigable,
      ariaCompliant: ariaCompliant
    };
  }`,
  returnType: "Object with issues array, score, keyboardNavigable, ariaCompliant status",
  reliability: "high",
  tags: ["accessibility", "audit", "compliance"]
};

/**
 * Find Search Functionality
 * Locate search on the page
 */
const findSearchFunctionality = {
  site: "*",
  category: "navigation",
  name: "find_search_functionality",
  description: "Locate and analyze search functionality on the page",
  parameters: {},
  code: `(params) => {
    const result = {
      found: false,
      type: null,
      input: null,
      submit: null,
      autocomplete: false,
      advancedSearch: false
    };

    // Look for search input
    const searchInputs = document.querySelectorAll(
      'input[type="search"], input[name*="search" i], input[placeholder*="search" i], input[aria-label*="search" i], #search'
    );

    if (searchInputs.length === 0) {
      // Check for search button that might open overlay
      const searchButtons = document.querySelectorAll('button[aria-label*="search" i], [class*="search" i]');
      if (searchButtons.length > 0) {
        result.found = true;
        result.type = 'overlay';
        result.trigger = {
          selector: searchButtons[0].id ? '#' + searchButtons[0].id : 'button[aria-label*="search" i]',
          text: searchButtons[0].textContent.trim()
        };
        return result;
      }
      return result;
    }

    result.found = true;
    result.type = 'input';

    const input = searchInputs[0];
    result.input = {
      selector: input.id ? '#' + input.id : input.name ? \`input[name="\${input.name}"]\` : 'input[type="search"]',
      placeholder: input.placeholder,
      name: input.name,
      autocomplete: input.autocomplete
    };

    // Find submit button (might be in same form or nearby)
    const form = input.closest('form');
    if (form) {
      const submitBtn = form.querySelector('[type="submit"], button:not([type="button"])');
      if (submitBtn) {
        result.submit = {
          selector: submitBtn.id ? '#' + submitBtn.id : 'button[type="submit"]',
          text: submitBtn.textContent.trim()
        };
      }
    }

    // Check for autocomplete/suggestions
    result.autocomplete = !!input.getAttribute('autocomplete') ||
                         !!document.querySelector('[role="combobox"], [role="listbox"]');

    // Check for advanced search link
    result.advancedSearch = !!document.querySelector('a[href*="advanced" i], a[href*="search" i]');

    return result;
  }`,
  returnType: "Object with found flag, type, input details, submit button, autocomplete, advancedSearch",
  reliability: "high",
  tags: ["navigation", "search", "discovery"]
};

/**
 * Smart Cookie Consent
 * Intelligently handle cookie consent
 */
const smartCookieConsent = {
  site: "*",
  category: "util",
  name: "smart_cookie_consent",
  description: "Intelligently handle cookie consent with preference selection",
  parameters: {
    preference: {
      type: "string",
      description: "Cookie preference: 'reject-all', 'accept-all', or 'necessary-only'",
      required: false,
      default: "reject-all"
    }
  },
  code: `(params) => {
    const { preference = 'reject-all' } = params;
    const result = {
      found: false,
      action: null,
      method: null,
      verified: false
    };

    // Common cookie banner selectors
    const cookieSelectors = [
      '[class*="cookie" i]',
      '[id*="cookie" i]',
      '[aria-label*="cookie" i]',
      '[class*="consent" i]',
      '[id*="consent" i]'
    ];

    let cookieBanner = null;
    for (const selector of cookieSelectors) {
      const els = document.querySelectorAll(selector);
      for (const el of els) {
        if (el.textContent.toLowerCase().includes('cookie') &&
            window.getComputedStyle(el).display !== 'none') {
          cookieBanner = el;
          break;
        }
      }
      if (cookieBanner) break;
    }

    if (!cookieBanner) {
      return result;
    }

    result.found = true;

    // Find appropriate button based on preference
    let targetButton = null;

    if (preference === 'accept-all') {
      // Look for accept/agree buttons
      const acceptButtons = cookieBanner.querySelectorAll('button, a');
      for (const btn of acceptButtons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('accept') || text.includes('agree') || text.includes('allow')) {
          targetButton = btn;
          result.action = 'accepted all cookies';
          break;
        }
      }
    } else if (preference === 'reject-all') {
      // Look for reject/decline buttons
      const rejectButtons = cookieBanner.querySelectorAll('button, a');
      for (const btn of rejectButtons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('reject') || text.includes('decline') || text.includes('deny')) {
          targetButton = btn;
          result.action = 'rejected all cookies';
          break;
        }
      }
    } else if (preference === 'necessary-only') {
      // Look for necessary/essential only option
      const necessaryButtons = cookieBanner.querySelectorAll('button, a');
      for (const btn of necessaryButtons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('necessary') || text.includes('essential') || text.includes('required')) {
          targetButton = btn;
          result.action = 'accepted necessary cookies only';
          break;
        }
      }
    }

    if (targetButton) {
      targetButton.click();
      result.method = 'clicked ' + targetButton.textContent.trim();

      // Verify banner disappeared
      setTimeout(() => {
        const style = window.getComputedStyle(cookieBanner);
        result.verified = style.display === 'none' || style.visibility === 'hidden';
      }, 500);
    } else {
      result.action = 'no matching button found for preference: ' + preference;
    }

    return result;
  }`,
  returnType: "Object with found flag, action taken, method, and verification status",
  reliability: "medium",
  tags: ["util", "cookies", "privacy", "automation"]
};

// ============================================================================
// TIER 2: PERFORMANCE & ANALYSIS MACROS (6)
// ============================================================================

/**
 * Measure Page Performance
 * Get detailed page performance metrics
 */
const measurePagePerformance = {
  site: "*",
  category: "performance",
  name: "measure_page_performance",
  description: "Get comprehensive page performance metrics using Performance API",
  parameters: {},
  code: `(params) => {
    if (!window.performance) {
      return { available: false, message: 'Performance API not available' };
    }

    const perf = window.performance;
    const timing = perf.timing || {};
    const navigation = perf.getEntriesByType('navigation')[0] || {};

    // Basic timing metrics
    const loadTime = timing.loadEventEnd ? timing.loadEventEnd - timing.navigationStart : null;
    const domReadyTime = timing.domContentLoadedEventEnd ? timing.domContentLoadedEventEnd - timing.navigationStart : null;

    // Paint timing
    const paintEntries = perf.getEntriesByType('paint');
    const firstPaint = paintEntries.find(e => e.name === 'first-paint');
    const firstContentfulPaint = paintEntries.find(e => e.name === 'first-contentful-paint');

    // Resource counts
    const resources = perf.getEntriesByType('resource');
    const resourceCount = {
      scripts: resources.filter(r => r.initiatorType === 'script').length,
      stylesheets: resources.filter(r => r.initiatorType === 'link' || r.initiatorType === 'css').length,
      images: resources.filter(r => r.initiatorType === 'img').length,
      fonts: resources.filter(r => r.name.match(/\\.woff2?|\\.ttf|\\.otf/)).length,
      xhr: resources.filter(r => r.initiatorType === 'xmlhttprequest' || r.initiatorType === 'fetch').length
    };

    // Calculate total size (approximate)
    const totalSize = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
    const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);

    return {
      available: true,
      loadTime: loadTime ? Math.round(loadTime) : null,
      domReadyTime: domReadyTime ? Math.round(domReadyTime) : null,
      firstPaint: firstPaint ? Math.round(firstPaint.startTime) : null,
      firstContentfulPaint: firstContentfulPaint ? Math.round(firstContentfulPaint.startTime) : null,
      resourceCount: resourceCount,
      totalResources: resources.length,
      totalSize: totalSizeMB + ' MB',
      transferSize: totalSize
    };
  }`,
  returnType: "Object with timing metrics, resource counts, and total size",
  reliability: "high",
  tags: ["performance", "metrics", "monitoring"]
};

/**
 * Get Page Outline
 * Extract heading hierarchy
 */
const getPageOutline = {
  site: "*",
  category: "exploration",
  name: "get_page_outline",
  description: "Extract heading hierarchy for document outline and navigation",
  parameters: {},
  code: `(params) => {
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const outline = [];
    const jumpLinks = [];

    headings.forEach((heading, idx) => {
      const level = parseInt(heading.tagName[1]);
      const text = heading.textContent.trim();
      let id = heading.id;

      // Generate ID if missing
      if (!id) {
        id = 'heading-' + idx;
      }

      outline.push({
        level: level,
        text: text.substring(0, 100),
        id: id,
        hasId: !!heading.id
      });

      jumpLinks.push('#' + id);
    });

    // Check if table of contents exists
    const tocSelectors = [
      '[class*="toc" i]',
      '[id*="toc" i]',
      'nav[aria-label*="table of contents" i]'
    ];

    let tocExists = false;
    for (const selector of tocSelectors) {
      if (document.querySelector(selector)) {
        tocExists = true;
        break;
      }
    }

    return {
      headingCount: outline.length,
      outline: outline,
      tocExists: tocExists,
      jumpLinks: jumpLinks,
      maxLevel: outline.length > 0 ? Math.max(...outline.map(h => h.level)) : 0
    };
  }`,
  returnType: "Object with outline array, tocExists, jumpLinks, and heading count",
  reliability: "high",
  tags: ["exploration", "navigation", "structure"]
};

/**
 * Extract All Text By Sections
 * Extract text organized by page sections
 */
const extractAllTextBySections = {
  site: "*",
  category: "extraction",
  name: "extract_all_text_by_sections",
  description: "Extract text content organized by semantic page sections",
  parameters: {
    maxChars: {
      type: "number",
      description: "Maximum characters per section (default: 1000)",
      required: false,
      default: 1000
    }
  },
  code: `(params) => {
    const { maxChars = 1000 } = params;
    const sections = [];

    // Common semantic sections
    const sectionMap = {
      header: 'header, [role="banner"]',
      nav: 'nav, [role="navigation"]',
      main: 'main, [role="main"], article',
      aside: 'aside, [role="complementary"], .sidebar',
      footer: 'footer, [role="contentinfo"]'
    };

    const result = {};

    for (const [name, selector] of Object.entries(sectionMap)) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.innerText.trim();
        const wordCount = text.split(/\\s+/).length;

        result[name] = text.substring(0, maxChars);
        sections.push({
          name: name,
          selector: selector.split(',')[0].trim(),
          text: text.substring(0, maxChars),
          wordCount: wordCount,
          truncated: text.length > maxChars
        });
      }
    }

    return {
      ...result,
      sections: sections,
      sectionCount: sections.length
    };
  }`,
  returnType: "Object with text by section name and sections array",
  reliability: "high",
  tags: ["extraction", "content", "structure"]
};

/**
 * Analyze Images
 * Comprehensive image analysis
 */
const analyzeImages = {
  site: "*",
  category: "accessibility",
  name: "analyze_images",
  description: "Comprehensive image analysis including alt text, loading state, and accessibility",
  parameters: {
    limit: {
      type: "number",
      description: "Maximum number of images to analyze in detail (default: 20)",
      required: false,
      default: 20
    }
  },
  code: `(params) => {
    const { limit = 20 } = params;
    const allImages = document.querySelectorAll('img');
    const images = [];

    let withAlt = 0;
    let withoutAlt = 0;
    let broken = 0;
    let lazy = 0;

    allImages.forEach((img, idx) => {
      const hasAlt = !!img.alt;
      if (hasAlt) withAlt++;
      else withoutAlt++;

      const isLazy = img.loading === 'lazy' || img.getAttribute('data-src');
      if (isLazy) lazy++;

      const isBroken = !img.complete || img.naturalWidth === 0;
      if (isBroken) broken++;

      if (idx < limit) {
        images.push({
          src: img.src.substring(0, 100),
          alt: img.alt || '(missing)',
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          loaded: img.complete,
          visible: img.offsetParent !== null,
          lazy: isLazy,
          broken: isBroken
        });
      }
    });

    return {
      total: allImages.length,
      withAlt: withAlt,
      withoutAlt: withoutAlt,
      broken: broken,
      lazy: lazy,
      images: images,
      accessibilityScore: allImages.length > 0 ? Math.round((withAlt / allImages.length) * 100) : 100
    };
  }`,
  returnType: "Object with image statistics and detailed image array",
  reliability: "high",
  tags: ["accessibility", "images", "audit"]
};

/**
 * Extract Download Links
 * Find all downloadable files
 */
const extractDownloadLinks = {
  site: "*",
  category: "extraction",
  name: "extract_download_links",
  description: "Find all downloadable file links with type and size detection",
  parameters: {},
  code: `(params) => {
    const downloadExtensions = /\\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|tar|gz|csv|txt|json|xml)$/i;
    const links = document.querySelectorAll('a[href]');
    const downloads = [];
    const types = {};

    links.forEach(link => {
      const href = link.href;
      const match = href.match(downloadExtensions);

      if (match || link.download || link.getAttribute('download') !== null) {
        const type = match ? match[1].toLowerCase() : 'unknown';
        const text = link.textContent.trim() || link.getAttribute('aria-label') || 'Download';

        // Try to extract size from link text
        const sizeMatch = text.match(/\\(([\\d.]+)\\s*(MB|KB|GB)\\)/i);
        const size = sizeMatch ? sizeMatch[1] + ' ' + sizeMatch[2].toUpperCase() : null;

        downloads.push({
          text: text.substring(0, 100),
          href: href,
          type: type,
          size: size,
          hasDownloadAttr: link.hasAttribute('download')
        });

        types[type] = (types[type] || 0) + 1;
      }
    });

    return {
      downloadCount: downloads.length,
      downloads: downloads,
      types: types
    };
  }`,
  returnType: "Object with download links array and type counts",
  reliability: "high",
  tags: ["extraction", "downloads", "files"]
};

/**
 * Detect Tracking Scripts
 * Identify analytics and tracking
 */
const detectTrackingScripts = {
  site: "*",
  category: "privacy",
  name: "detect_tracking_scripts",
  description: "Identify analytics, advertising, and tracking scripts on the page",
  parameters: {},
  code: `(params) => {
    const analytics = [];
    const advertising = [];
    const social = [];

    // Check scripts
    const scripts = document.querySelectorAll('script[src]');
    scripts.forEach(script => {
      const src = script.src.toLowerCase();

      // Analytics
      if (src.includes('google-analytics') || src.includes('gtag') || src.includes('ga.js')) {
        analytics.push('Google Analytics');
      } else if (src.includes('mixpanel')) {
        analytics.push('Mixpanel');
      } else if (src.includes('segment')) {
        analytics.push('Segment');
      } else if (src.includes('amplitude')) {
        analytics.push('Amplitude');
      } else if (src.includes('hotjar')) {
        analytics.push('Hotjar');
      }

      // Advertising
      if (src.includes('doubleclick') || src.includes('googlesyndication')) {
        advertising.push('Google Ads');
      } else if (src.includes('adroll')) {
        advertising.push('AdRoll');
      }

      // Social
      if (src.includes('facebook') || src.includes('fbevents')) {
        social.push('Facebook Pixel');
      } else if (src.includes('twitter') || src.includes('analytics.twitter')) {
        social.push('Twitter Analytics');
      } else if (src.includes('linkedin')) {
        social.push('LinkedIn Insights');
      }
    });

    // Check cookies
    const cookies = document.cookie.split(';').length;

    // Remove duplicates
    const uniqueAnalytics = [...new Set(analytics)];
    const uniqueAdvertising = [...new Set(advertising)];
    const uniqueSocial = [...new Set(social)];

    return {
      analytics: uniqueAnalytics,
      advertising: uniqueAdvertising,
      social: uniqueSocial,
      total: uniqueAnalytics.length + uniqueAdvertising.length + uniqueSocial.length,
      cookiesSet: cookies
    };
  }`,
  returnType: "Object with analytics, advertising, social arrays and total count",
  reliability: "medium",
  tags: ["privacy", "tracking", "analytics"]
};

// ============================================================================
// TIER 3: ADVANCED DISCOVERY MACROS (7)
// ============================================================================

/**
 * Find Elements By Position
 * Find elements by visual position
 */
const findElementsByPosition = {
  site: "*",
  category: "exploration",
  name: "find_elements_by_position",
  description: "Find elements by their visual position on the page",
  parameters: {
    position: {
      type: "string",
      description: "Position: 'top-left', 'top-right', 'center', 'bottom-left', 'bottom-right', 'bottom'",
      required: true
    },
    limit: {
      type: "number",
      description: "Maximum number of elements to return (default: 10)",
      required: false,
      default: 10
    }
  },
  code: `(params) => {
    const { position, limit = 10 } = params;
    const elements = [];

    const vh = window.innerHeight;
    const vw = window.innerWidth;

    // Define position ranges
    const ranges = {
      'top-left': { x: [0, vw * 0.3], y: [0, vh * 0.3] },
      'top-right': { x: [vw * 0.7, vw], y: [0, vh * 0.3] },
      'center': { x: [vw * 0.3, vw * 0.7], y: [vh * 0.3, vh * 0.7] },
      'bottom-left': { x: [0, vw * 0.3], y: [vh * 0.7, vh] },
      'bottom-right': { x: [vw * 0.7, vw], y: [vh * 0.7, vh] },
      'bottom': { x: [0, vw], y: [vh * 0.8, vh] }
    };

    const range = ranges[position];
    if (!range) {
      return { error: 'Invalid position. Use: top-left, top-right, center, bottom-left, bottom-right, bottom' };
    }

    // Get all visible interactive elements
    const candidates = document.querySelectorAll('a, button, input, select, [role="button"], [onclick]');

    candidates.forEach(el => {
      if (elements.length >= limit) return;

      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      if (x >= range.x[0] && x <= range.x[1] && y >= range.y[0] && y <= range.y[1]) {
        const style = window.getComputedStyle(el);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          elements.push({
            type: el.tagName.toLowerCase(),
            text: el.textContent.trim().substring(0, 50),
            selector: el.id ? '#' + el.id : el.className ? el.tagName.toLowerCase() + '.' + el.className.split(' ')[0] : el.tagName.toLowerCase(),
            x: Math.round(x),
            y: Math.round(y)
          });
        }
      }
    });

    return {
      position: position,
      count: elements.length,
      elements: elements
    };
  }`,
  returnType: "Object with position, count, and elements array with coordinates",
  reliability: "high",
  tags: ["exploration", "position", "layout"]
};

/**
 * Find Recently Added Elements
 * Detect newly added DOM elements
 */
const findRecentlyAddedElements = {
  site: "*",
  category: "util",
  name: "find_recently_added_elements",
  description: "Detect DOM elements added recently (requires baseline)",
  parameters: {
    baseline: {
      type: "string",
      description: "JSON string of baseline element count",
      required: true
    }
  },
  code: `(params) => {
    const { baseline } = params;
    const baselineData = JSON.parse(baseline);
    const currentCount = document.querySelectorAll('*').length;

    // This is a simplified version - in reality, would use MutationObserver
    const newElements = currentCount - (baselineData.totalElements || 0);

    // Get recently added notifications/alerts as example
    const alerts = document.querySelectorAll('[role="alert"], .notification, .toast');
    const recentAlerts = Array.from(alerts).filter(el => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none';
    });

    return {
      baselineElements: baselineData.totalElements,
      currentElements: currentCount,
      newElements: Math.max(newElements, 0),
      recentAlerts: recentAlerts.length,
      alerts: recentAlerts.map(el => ({
        text: el.textContent.trim().substring(0, 100),
        class: el.className
      }))
    };
  }`,
  returnType: "Object with element counts and recently added alerts",
  reliability: "medium",
  tags: ["util", "monitoring", "changes"]
};

/**
 * Find Elements By Z-Index
 * Find topmost elements by z-index
 */
const findElementsByZIndex = {
  site: "*",
  category: "exploration",
  name: "find_elements_by_z_index",
  description: "Find elements with highest z-index values (visually on top)",
  parameters: {
    limit: {
      type: "number",
      description: "Number of top elements to return (default: 10)",
      required: false,
      default: 10
    }
  },
  code: `(params) => {
    const { limit = 10 } = params;
    const elements = [];

    const allElements = document.querySelectorAll('*');

    allElements.forEach(el => {
      const style = window.getComputedStyle(el);
      const zIndex = parseInt(style.zIndex);

      if (!isNaN(zIndex) && zIndex > 0) {
        elements.push({
          selector: el.id ? '#' + el.id : el.className ? el.tagName.toLowerCase() + '.' + el.className.split(' ')[0] : el.tagName.toLowerCase(),
          zIndex: zIndex,
          visible: style.display !== 'none' && style.visibility !== 'hidden',
          position: style.position
        });
      }
    });

    // Sort by z-index descending
    elements.sort((a, b) => b.zIndex - a.zIndex);

    return {
      topElements: elements.slice(0, limit),
      highest: elements.length > 0 ? elements[0].zIndex : 0,
      totalWithZIndex: elements.length
    };
  }`,
  returnType: "Object with topElements array sorted by z-index",
  reliability: "high",
  tags: ["exploration", "layout", "debugging"]
};

/**
 * Analyze Form Requirements
 * Deep form validation analysis
 */
const analyzeFormRequirements = {
  site: "*",
  category: "exploration",
  name: "analyze_form_requirements",
  description: "Deep analysis of form validation rules and requirements",
  parameters: {
    formSelector: {
      type: "string",
      description: "CSS selector for form (optional, uses first form if not specified)",
      required: false
    }
  },
  code: `(params) => {
    const { formSelector } = params;
    const form = formSelector ? document.querySelector(formSelector) : document.querySelector('form');

    if (!form) {
      return { found: false, message: 'No form found' };
    }

    const fields = [];
    const inputs = form.querySelectorAll('input, textarea, select');

    inputs.forEach(input => {
      if (input.type === 'hidden' || input.type === 'submit') return;

      const field = {
        name: input.name || input.id,
        type: input.type || input.tagName.toLowerCase(),
        required: input.required,
        pattern: input.pattern || null,
        minLength: input.minLength > 0 ? input.minLength : null,
        maxLength: input.maxLength > 0 ? input.maxLength : null,
        min: input.min || null,
        max: input.max || null,
        step: input.step || null,
        autocomplete: input.autocomplete || null,
        placeholder: input.placeholder || null
      };

      fields.push(field);
    });

    // Detect validation method
    let validationMethod = 'html5';
    if (form.noValidate) {
      validationMethod = 'javascript';
    }

    return {
      found: true,
      formId: form.id,
      formAction: form.action,
      formMethod: form.method,
      fieldCount: fields.length,
      fields: fields,
      validationMethod: validationMethod
    };
  }`,
  returnType: "Object with form details and field validation requirements",
  reliability: "high",
  tags: ["forms", "validation", "testing"]
};

/**
 * Generate Form Test Data
 * Generate realistic test data for forms
 */
const generateFormTestData = {
  site: "*",
  category: "util",
  name: "generate_form_test_data",
  description: "Generate realistic test data for form fields",
  parameters: {
    formSelector: {
      type: "string",
      description: "CSS selector for form (optional)",
      required: false
    },
    strategy: {
      type: "string",
      description: "Data strategy: 'realistic', 'edge-cases', 'invalid' (default: realistic)",
      required: false,
      default: "realistic"
    }
  },
  code: `(params) => {
    const { formSelector, strategy = 'realistic' } = params;
    const form = formSelector ? document.querySelector(formSelector) : document.querySelector('form');

    if (!form) {
      return { found: false, message: 'No form found' };
    }

    const data = {};
    const inputs = form.querySelectorAll('input, textarea, select');

    // Test data generators
    const generators = {
      realistic: {
        text: () => 'Test User',
        email: () => 'test.user' + Date.now() + '@example.com',
        tel: () => '555-0' + Math.floor(Math.random() * 1000).toString().padStart(3, '0'),
        number: (min, max) => Math.floor(Math.random() * ((max || 100) - (min || 1) + 1)) + (min || 1),
        date: () => '1990-01-15',
        url: () => 'https://example.com',
        password: () => 'Test123!@#'
      },
      'edge-cases': {
        text: () => 'A'.repeat(255),
        email: () => 'a@b.co',
        tel: () => '+1-555-0000',
        number: (min, max) => max || 999999,
        date: () => '2000-12-31',
        url: () => 'https://very-long-domain-name-example.com/path',
        password: () => 'P@ssw0rd!'
      }
    };

    const gen = generators[strategy] || generators.realistic;

    inputs.forEach(input => {
      if (input.type === 'hidden' || input.type === 'submit') return;

      const name = input.name || input.id;
      if (!name) return;

      let value;

      if (input.tagName === 'SELECT') {
        const options = Array.from(input.options).filter(opt => opt.value);
        value = options.length > 0 ? options[0].value : '';
      } else if (input.type === 'checkbox') {
        value = true;
      } else if (input.type === 'radio') {
        value = input.value;
      } else {
        const type = input.type || 'text';
        const generator = gen[type] || gen.text;
        value = typeof generator === 'function' ? generator(input.min, input.max) : generator;
      }

      data[name] = value;
    });

    return {
      found: true,
      strategy: strategy,
      data: data,
      fieldCount: Object.keys(data).length
    };
  }`,
  returnType: "Object with generated test data for form fields",
  reliability: "high",
  tags: ["forms", "testing", "automation"]
};

/**
 * Detect Infinite Scroll
 * Detect infinite scroll patterns
 */
const detectInfiniteScroll = {
  site: "*",
  category: "navigation",
  name: "detect_infinite_scroll",
  description: "Detect infinite scroll implementation and characteristics",
  parameters: {},
  code: `(params) => {
    const result = {
      hasInfiniteScroll: false,
      triggerPoint: null,
      currentItems: 0,
      estimatedTotal: 'unknown',
      loadMoreTrigger: null
    };

    // Check for "Load More" button
    const loadMoreButtons = document.querySelectorAll('button, a');
    for (const btn of loadMoreButtons) {
      const text = btn.textContent.toLowerCase();
      if (text.includes('load more') || text.includes('show more') || text.includes('see more')) {
        result.hasInfiniteScroll = true;
        result.loadMoreTrigger = 'button';
        result.triggerElement = btn.textContent.trim();
        break;
      }
    }

    // Check for pagination with high page count (suggests infinite)
    const pagination = document.querySelector('[class*="pagination" i], [role="navigation"]');
    if (pagination) {
      const pageLinks = pagination.querySelectorAll('a, button');
      if (pageLinks.length > 10) {
        result.hasInfiniteScroll = true;
        result.loadMoreTrigger = 'pagination';
      }
    }

    // Check for common infinite scroll containers
    const scrollContainers = document.querySelectorAll('[class*="infinite" i], [data-infinite], [data-scroll]');
    if (scrollContainers.length > 0) {
      result.hasInfiniteScroll = true;
      result.loadMoreTrigger = 'scroll';
    }

    // Count items in common list structures
    const lists = document.querySelectorAll('ul, ol, [class*="list" i], [class*="grid" i]');
    let maxItems = 0;
    lists.forEach(list => {
      const items = list.children.length;
      if (items > maxItems) maxItems = items;
    });
    result.currentItems = maxItems;

    // Estimate trigger point (usually 80-90% scroll)
    if (result.hasInfiniteScroll) {
      result.triggerPoint = 85;
    }

    return result;
  }`,
  returnType: "Object with infinite scroll detection and characteristics",
  reliability: "medium",
  tags: ["navigation", "scrolling", "pagination"]
};

/**
 * Detect Loading Indicators
 * Find loading spinners and progress indicators
 */
const detectLoadingIndicators = {
  site: "*",
  category: "util",
  name: "detect_loading_indicators",
  description: "Detect loading spinners, progress bars, and loading states",
  parameters: {},
  code: `(params) => {
    const indicators = [];
    let loading = false;

    // Check for common loading indicators
    const spinnerSelectors = [
      '[class*="spinner" i]',
      '[class*="loading" i]',
      '[class*="loader" i]',
      '[aria-busy="true"]',
      '[role="progressbar"]'
    ];

    spinnerSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        const style = window.getComputedStyle(el);
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';

        if (visible) {
          loading = true;

          let type = 'spinner';
          if (el.getAttribute('role') === 'progressbar') {
            type = 'progress';
          }

          const indicator = {
            type: type,
            selector: selector,
            visible: visible
          };

          // Get progress value if available
          if (type === 'progress') {
            const value = el.getAttribute('aria-valuenow');
            const max = el.getAttribute('aria-valuemax');
            if (value && max) {
              indicator.value = Math.round((parseInt(value) / parseInt(max)) * 100);
            }
          }

          indicators.push(indicator);
        }
      });
    });

    return {
      loading: loading,
      indicatorCount: indicators.length,
      indicators: indicators
    };
  }`,
  returnType: "Object with loading state and indicator details",
  reliability: "high",
  tags: ["util", "loading", "monitoring"]
};

// ============================================================================
// TIER 4: NAVIGATION & TESTING MACROS (6)
// ============================================================================

/**
 * Get Keyboard Navigation Order
 * Map tab order for keyboard navigation
 */
const getKeyboardNavigationOrder = {
  site: "*",
  category: "accessibility",
  name: "get_keyboard_navigation_order",
  description: "Map keyboard navigation tab order and detect tab traps",
  parameters: {
    limit: {
      type: "number",
      description: "Maximum elements to include (default: 50)",
      required: false,
      default: 50
    }
  },
  code: `(params) => {
    const { limit = 50 } = params;
    const focusable = document.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const tabOrder = [];
    const tabIndexMap = new Map();

    focusable.forEach((el, idx) => {
      if (idx >= limit) return;

      const tabIndex = parseInt(el.getAttribute('tabindex')) || 0;
      const style = window.getComputedStyle(el);

      if (style.display !== 'none' && style.visibility !== 'hidden') {
        const item = {
          index: tabIndex,
          naturalIndex: idx,
          element: el.tagName.toLowerCase(),
          text: (el.textContent || el.placeholder || el.value || '').trim().substring(0, 50),
          selector: el.id ? '#' + el.id : el.name ? \`[\${el.tagName.toLowerCase()}][name="\${el.name}"]\` : el.tagName.toLowerCase()
        };

        tabOrder.push(item);
        tabIndexMap.set(tabIndex, (tabIndexMap.get(tabIndex) || 0) + 1);
      }
    });

    // Sort by tabindex (0 comes last, positive numbers first)
    tabOrder.sort((a, b) => {
      if (a.index > 0 && b.index > 0) return a.index - b.index;
      if (a.index > 0) return -1;
      if (b.index > 0) return 1;
      return a.naturalIndex - b.naturalIndex;
    });

    // Detect potential tab traps (elements with very high tabindex)
    const tabTraps = tabOrder.filter(item => item.index > 1000);

    return {
      totalFocusable: focusable.length,
      tabOrder: tabOrder,
      tabTraps: tabTraps.length > 0 ? tabTraps.map(t => t.selector) : [],
      hasCustomTabOrder: Array.from(tabIndexMap.keys()).some(idx => idx > 0)
    };
  }`,
  returnType: "Object with tab order array, total focusable elements, and tab traps",
  reliability: "high",
  tags: ["accessibility", "keyboard", "navigation"]
};

/**
 * Detect Dark Mode
 * Check dark mode availability
 */
const detectDarkMode = {
  site: "*",
  category: "util",
  name: "detect_dark_mode",
  description: "Detect dark mode availability, current state, and toggle mechanism",
  parameters: {},
  code: `(params) => {
    const result = {
      available: false,
      active: false,
      toggle: null,
      method: null
    };

    // Check for dark mode toggle
    const toggleSelectors = [
      '[aria-label*="dark mode" i]',
      '[aria-label*="theme" i]',
      '[class*="theme-toggle" i]',
      '[class*="dark-mode" i]',
      '[id*="theme" i]'
    ];

    for (const selector of toggleSelectors) {
      const toggle = document.querySelector(selector);
      if (toggle) {
        result.available = true;
        result.toggle = {
          selector: selector,
          type: toggle.tagName.toLowerCase(),
          text: toggle.textContent.trim() || toggle.getAttribute('aria-label')
        };
        break;
      }
    }

    // Check if dark mode is currently active
    const html = document.documentElement;
    const body = document.body;

    // Method 1: Check for dark class
    if (html.classList.contains('dark') || body.classList.contains('dark') ||
        html.classList.contains('dark-mode') || body.classList.contains('dark-mode')) {
      result.active = true;
      result.method = 'class';
    }

    // Method 2: Check for dark theme attribute
    if (html.getAttribute('data-theme') === 'dark' || body.getAttribute('data-theme') === 'dark') {
      result.active = true;
      result.method = 'data-attribute';
    }

    // Method 3: Check background color
    const bgColor = window.getComputedStyle(body).backgroundColor;
    const rgb = bgColor.match(/\\d+/g);
    if (rgb) {
      const brightness = (parseInt(rgb[0]) + parseInt(rgb[1]) + parseInt(rgb[2])) / 3;
      if (brightness < 128) {
        result.active = true;
        if (!result.method) result.method = 'background-color';
      }
    }

    return result;
  }`,
  returnType: "Object with dark mode availability, active state, toggle info, and method",
  reliability: "medium",
  tags: ["util", "theme", "ui"]
};

/**
 * Measure Viewport Coverage
 * Calculate viewport coverage by elements
 */
const measureViewportCoverage = {
  site: "*",
  category: "util",
  name: "measure_viewport_coverage",
  description: "Measure what percentage of viewport is covered by major page sections",
  parameters: {},
  code: `(params) => {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const viewportArea = vh * vw;

    const coverage = {};
    const sections = {
      header: 'header, [role="banner"]',
      nav: 'nav, [role="navigation"]',
      main: 'main, [role="main"]',
      sidebar: 'aside, [role="complementary"]',
      footer: 'footer, [role="contentinfo"]'
    };

    let totalCovered = 0;

    for (const [name, selector] of Object.entries(sections)) {
      const el = document.querySelector(selector);
      if (el) {
        const rect = el.getBoundingClientRect();

        // Calculate visible area
        const visibleWidth = Math.min(rect.right, vw) - Math.max(rect.left, 0);
        const visibleHeight = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
        const area = Math.max(0, visibleWidth) * Math.max(0, visibleHeight);

        const percentage = (area / viewportArea) * 100;
        coverage[name] = Math.round(percentage);
        totalCovered += area;
      }
    }

    // Calculate empty space
    const emptySpace = Math.max(0, 100 - Math.round((totalCovered / viewportArea) * 100));

    // Find most prominent
    let mostProminent = null;
    let maxCoverage = 0;
    for (const [name, percent] of Object.entries(coverage)) {
      if (percent > maxCoverage) {
        maxCoverage = percent;
        mostProminent = name;
      }
    }

    return {
      coverage: coverage,
      emptySpace: emptySpace,
      mostProminent: mostProminent,
      viewportSize: { width: vw, height: vh }
    };
  }`,
  returnType: "Object with coverage percentages by section and empty space",
  reliability: "high",
  tags: ["util", "layout", "analysis"]
};

/**
 * Detect CAPTCHA
 * Detect CAPTCHA presence
 */
const detectCaptcha = {
  site: "*",
  category: "util",
  name: "detect_captcha",
  description: "Detect CAPTCHA presence, type, and characteristics",
  parameters: {},
  code: `(params) => {
    const result = {
      present: false,
      type: null,
      visible: false,
      location: null,
      bypassable: false
    };

    // Check for reCAPTCHA
    if (document.querySelector('.g-recaptcha, [data-sitekey]')) {
      result.present = true;
      result.type = 'recaptcha-v2';

      const badge = document.querySelector('.grecaptcha-badge');
      if (badge) {
        result.visible = window.getComputedStyle(badge).visibility !== 'hidden';
        const rect = badge.getBoundingClientRect();
        if (rect.bottom > window.innerHeight * 0.8) {
          result.location = 'bottom-right';
        }
      }
    }

    // Check for reCAPTCHA v3 (invisible)
    const scripts = Array.from(document.querySelectorAll('script'));
    if (scripts.some(s => s.src.includes('recaptcha/api.js') || s.src.includes('recaptcha/enterprise.js'))) {
      if (!result.present) {
        result.present = true;
        result.type = 'recaptcha-v3';
        result.visible = false;
        result.bypassable = true; // v3 is invisible
      }
    }

    // Check for hCaptcha
    if (document.querySelector('.h-captcha, [data-hcaptcha-sitekey]')) {
      result.present = true;
      result.type = 'hcaptcha';
      result.visible = true;
    }

    // Check for Cloudflare Turnstile
    if (document.querySelector('[data-sitekey][data-callback]') ||
        scripts.some(s => s.src.includes('challenges.cloudflare.com'))) {
      result.present = true;
      result.type = 'cloudflare-turnstile';
      result.visible = true;
    }

    return result;
  }`,
  returnType: "Object with CAPTCHA detection details",
  reliability: "high",
  tags: ["util", "captcha", "automation"]
};

/**
 * Generate Unique Selectors
 * Create reliable CSS selectors for elements
 */
const generateUniqueSelectors = {
  site: "*",
  category: "util",
  name: "generate_unique_selectors",
  description: "Generate reliable unique CSS selectors for elements",
  parameters: {
    targetSelectors: {
      type: "array",
      description: "Array of basic selectors to generate unique selectors for",
      required: true
    }
  },
  code: `(params) => {
    const { targetSelectors } = params;
    const results = [];

    const isUnique = (selector) => {
      return document.querySelectorAll(selector).length === 1;
    };

    targetSelectors.forEach(basicSelector => {
      const element = document.querySelector(basicSelector);
      if (!element) {
        results.push({
          input: basicSelector,
          found: false,
          selector: null,
          uniqueness: 'not-found'
        });
        return;
      }

      const alternatives = [];

      // Strategy 1: ID
      if (element.id) {
        const idSelector = '#' + element.id;
        if (isUnique(idSelector)) {
          results.push({
            input: basicSelector,
            found: true,
            selector: idSelector,
            uniqueness: 'unique',
            strategy: 'id',
            alternatives: alternatives
          });
          return;
        }
        alternatives.push(idSelector);
      }

      // Strategy 2: Unique class combination
      if (element.className) {
        const classes = element.className.trim().split(/\\s+/);
        const classSelector = element.tagName.toLowerCase() + '.' + classes.join('.');
        if (isUnique(classSelector)) {
          results.push({
            input: basicSelector,
            found: true,
            selector: classSelector,
            uniqueness: 'unique',
            strategy: 'class',
            alternatives: alternatives
          });
          return;
        }
        alternatives.push(classSelector);
      }

      // Strategy 3: Attribute selectors
      if (element.name) {
        const nameSelector = \`\${element.tagName.toLowerCase()}[name="\${element.name}"]\`;
        if (isUnique(nameSelector)) {
          results.push({
            input: basicSelector,
            found: true,
            selector: nameSelector,
            uniqueness: 'unique',
            strategy: 'name',
            alternatives: alternatives
          });
          return;
        }
        alternatives.push(nameSelector);
      }

      // Strategy 4: nth-child
      const parent = element.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children);
        const index = siblings.indexOf(element) + 1;
        const nthSelector = \`\${element.tagName.toLowerCase()}:nth-child(\${index})\`;
        alternatives.push(nthSelector);
      }

      // Fallback: use basic selector
      results.push({
        input: basicSelector,
        found: true,
        selector: basicSelector,
        uniqueness: isUnique(basicSelector) ? 'unique' : 'not-unique',
        strategy: 'fallback',
        alternatives: alternatives
      });
    });

    return {
      count: results.length,
      selectors: results
    };
  }`,
  returnType: "Object with selector results array",
  reliability: "high",
  tags: ["util", "testing", "selectors"]
};

/**
 * Compare Element Positions
 * Visual regression detection
 */
const compareElementPositions = {
  site: "*",
  category: "util",
  name: "compare_element_positions",
  description: "Compare current element positions with baseline for visual regression",
  parameters: {
    baseline: {
      type: "string",
      description: "JSON string of baseline positions",
      required: true
    },
    selectors: {
      type: "array",
      description: "Array of selectors to compare",
      required: true
    }
  },
  code: `(params) => {
    const { baseline, selectors } = params;
    const baselineData = JSON.parse(baseline);
    const changed = [];
    const unchanged = 0;
    let totalShift = 0;

    selectors.forEach(selector => {
      const element = document.querySelector(selector);
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const current = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };

      const base = baselineData[selector];
      if (base) {
        const dx = current.x - base.x;
        const dy = current.y - base.y;
        const shift = Math.sqrt(dx * dx + dy * dy);

        if (shift > 1) { // More than 1px shift
          changed.push({
            selector: selector,
            before: base,
            after: current,
            shift: Math.round(shift)
          });
          totalShift += shift;
        }
      }
    });

    // Calculate Cumulative Layout Shift (CLS) approximation
    const viewportArea = window.innerWidth * window.innerHeight;
    const layoutShift = totalShift / Math.sqrt(viewportArea);

    return {
      changed: changed,
      changedCount: changed.length,
      unchangedCount: selectors.length - changed.length,
      layoutShift: layoutShift.toFixed(3),
      significant: layoutShift > 0.1
    };
  }`,
  returnType: "Object with changed elements and layout shift score",
  reliability: "medium",
  tags: ["util", "testing", "visual-regression"]
};

// Export macros
const tier1AdvancedMacros = [
  extractMainContent,
  detectPageLoadState,
  auditAccessibility,
  findSearchFunctionality,
  smartCookieConsent
];

const tier2AdvancedMacros = [
  measurePagePerformance,
  getPageOutline,
  extractAllTextBySections,
  analyzeImages,
  extractDownloadLinks,
  detectTrackingScripts
];

const tier3AdvancedMacros = [
  findElementsByPosition,
  findRecentlyAddedElements,
  findElementsByZIndex,
  analyzeFormRequirements,
  generateFormTestData,
  detectInfiniteScroll,
  detectLoadingIndicators
];

const tier4AdvancedMacros = [
  getKeyboardNavigationOrder,
  detectDarkMode,
  measureViewportCoverage,
  detectCaptcha,
  generateUniqueSelectors,
  compareElementPositions
];

const allAdvancedMacros = [
  ...tier1AdvancedMacros,
  ...tier2AdvancedMacros,
  ...tier3AdvancedMacros,
  ...tier4AdvancedMacros
];

// CommonJS export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    tier1AdvancedMacros,
    tier2AdvancedMacros,
    tier3AdvancedMacros,
    tier4AdvancedMacros,
    allAdvancedMacros
  };
}

// ES Module export
export {
  tier1AdvancedMacros,
  tier2AdvancedMacros,
  tier3AdvancedMacros,
  tier4AdvancedMacros,
  allAdvancedMacros
};
