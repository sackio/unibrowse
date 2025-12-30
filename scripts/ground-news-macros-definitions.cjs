/**
 * Ground.News Macro Definitions for Unibrowse
 * 28 macros for comprehensive news browsing, bias analysis, and story extraction
 *
 * Ground.News is a news aggregator that shows bias distribution across sources
 * Based on ground.news site structure as of 2025-12-30
 */

module.exports = [
  // ==================== SEARCH MACROS (4) ====================

  {
    site: 'ground.news',
    category: 'search',
    name: 'groundnews_search_keyword',
    description: 'Search for news stories by keyword on ground.news',
    parameters: {
      query: {
        type: 'string',
        description: 'Search keyword or phrase',
        required: true
      },
      filters: {
        type: 'object',
        description: 'Optional filters to apply (topic, bias, factuality)',
        required: false,
        default: {}
      }
    },
    code: `(params) => {
      const { query, filters = {} } = params;

      if (!query || query.trim().length === 0) {
        return { success: false, error: 'Query is required' };
      }

      // Find search input
      const searchInput = document.querySelector('input[type="search"]') ||
                         document.querySelector('input[placeholder*="Search"]') ||
                         document.querySelector('input[name="q"]');

      if (!searchInput) {
        return { success: false, error: 'Search input not found' };
      }

      // Type query
      searchInput.value = '';
      searchInput.focus();
      for (let i = 0; i < query.length; i++) {
        searchInput.value += query[i];
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Find search button
      const searchBtn = searchInput.closest('form')?.querySelector('button[type="submit"]') ||
                       document.querySelector('button[aria-label*="Search"]');

      if (searchBtn) {
        searchBtn.click();
        return {
          success: true,
          query: query,
          appliedFilters: filters,
          message: 'Search submitted'
        };
      }

      // Fallback: submit form
      const form = searchInput.closest('form');
      if (form) {
        form.submit();
        return {
          success: true,
          query: query,
          appliedFilters: filters,
          method: 'form-submit'
        };
      }

      return { success: false, error: 'Could not submit search' };
    }`,
    returnType: 'Object with success, query, resultCount (if available), and appliedFilters',
    tags: ['ground.news', 'search', 'news'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'search',
    name: 'groundnews_filter_by_topic',
    description: 'Filter stories by topic/category on ground.news',
    parameters: {
      topic: {
        type: 'string',
        description: 'Topic name (e.g., "Israel-Gaza", "Business & Markets")',
        required: true
      }
    },
    code: `(params) => {
      const { topic } = params;

      if (!topic || topic.trim().length === 0) {
        return { success: false, error: 'Topic is required' };
      }

      // Find topic links/buttons
      const topicElements = Array.from(document.querySelectorAll('a, button')).filter(el =>
        el.textContent.trim().toLowerCase().includes(topic.toLowerCase())
      );

      if (topicElements.length === 0) {
        return { success: false, error: 'Topic not found: ' + topic };
      }

      // Click the first matching topic
      topicElements[0].click();

      // Count visible stories after filtering (with delay for loading)
      setTimeout(() => {
        const storyCount = document.querySelectorAll('[class*="story"], [class*="article"], [class*="card"]').length;
      }, 500);

      return {
        success: true,
        topic: topic,
        message: 'Navigated to topic'
      };
    }`,
    returnType: 'Object with success, topic, and resultCount',
    tags: ['ground.news', 'filter', 'topic'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'search',
    name: 'groundnews_filter_by_region',
    description: 'Filter stories by geographic region on ground.news',
    parameters: {
      region: {
        type: 'string',
        description: 'Region name (North America, Europe, Asia, Australia, Africa, South America)',
        required: true
      }
    },
    code: `(params) => {
      const { region } = params;

      const validRegions = ['North America', 'South America', 'Europe', 'Asia', 'Australia', 'Africa'];

      if (!region || region.trim().length === 0) {
        return { success: false, error: 'Region is required' };
      }

      // Find region link
      const regionLink = Array.from(document.querySelectorAll('a, button')).find(el =>
        el.textContent.trim() === region
      );

      if (!regionLink) {
        return {
          success: false,
          error: 'Region not found: ' + region + '. Valid regions: ' + validRegions.join(', ')
        };
      }

      regionLink.click();

      return {
        success: true,
        region: region,
        message: 'Filtered by region'
      };
    }`,
    returnType: 'Object with success, region, and resultCount',
    tags: ['ground.news', 'filter', 'region'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'search',
    name: 'groundnews_filter_by_bias',
    description: 'Filter stories by coverage bias distribution (blindspot feed)',
    parameters: {
      biasFilter: {
        type: 'string',
        description: 'Bias filter: "left_blindspot", "right_blindspot", or "balanced"',
        required: true
      }
    },
    code: `(params) => {
      const { biasFilter } = params;

      const validFilters = ['left_blindspot', 'right_blindspot', 'balanced'];

      if (!validFilters.includes(biasFilter)) {
        return {
          success: false,
          error: 'Invalid bias filter. Valid options: ' + validFilters.join(', ')
        };
      }

      // Navigate to blindspot feed
      if (biasFilter.includes('blindspot')) {
        const blindspotLink = Array.from(document.querySelectorAll('a')).find(el =>
          el.textContent.toLowerCase().includes('blindspot')
        );

        if (blindspotLink) {
          blindspotLink.click();

          setTimeout(() => {
            // Apply left/right filter if needed
            if (biasFilter === 'left_blindspot') {
              const leftFilter = Array.from(document.querySelectorAll('button, a')).find(el =>
                el.textContent.toLowerCase().includes('left')
              );
              if (leftFilter) leftFilter.click();
            } else if (biasFilter === 'right_blindspot') {
              const rightFilter = Array.from(document.querySelectorAll('button, a')).find(el =>
                el.textContent.toLowerCase().includes('right')
              );
              if (rightFilter) rightFilter.click();
            }
          }, 500);

          return {
            success: true,
            filter: biasFilter,
            message: 'Applied bias filter'
          };
        }
      }

      return { success: false, error: 'Could not apply bias filter' };
    }`,
    returnType: 'Object with success, filter, and resultCount',
    tags: ['ground.news', 'filter', 'bias', 'blindspot'],
    reliability: 'untested'
  },

  // ==================== EXTRACTION MACROS (10) ====================

  {
    site: 'ground.news',
    category: 'extraction',
    name: 'groundnews_extract_top_stories',
    description: 'Extract top news stories from ground.news homepage with bias distribution',
    parameters: {
      limit: {
        type: 'number',
        description: 'Maximum number of stories to extract',
        required: false,
        default: 10
      }
    },
    code: `(params) => {
      const { limit = 10 } = params;

      // Helper: Extract bias percentages from text
      const extractBiasFromText = (text) => {
        const leftMatch = text.match(new RegExp('L\\\\s*(\\\\d+)%|Left\\\\s*(\\\\d+)%'));
        const centerMatch = text.match(new RegExp('C(?:enter)?\\\\s*(\\\\d+)%'));
        const rightMatch = text.match(new RegExp('R(?:ight)?\\\\s*(\\\\d+)%'));

        return {
          left: leftMatch ? parseInt(leftMatch[1] || leftMatch[2]) : 0,
          center: centerMatch ? parseInt(centerMatch[1]) : 0,
          right: rightMatch ? parseInt(rightMatch[1]) : 0
        };
      };

      // Helper: Extract coverage info from element
      const extractCoverage = (element) => {
        const text = element.textContent;

        // Try to find "X% Left/Center/Right coverage: N sources"
        const coverageMatch = text.match(new RegExp('(\\\\d+)%\\\\s+(Left|Center|Right)\\\\s+coverage:\\\\s+(\\\\d+)\\\\s+sources?'));
        const sourceMatch = text.match(new RegExp('(\\\\d+)\\\\s+sources?'));

        return {
          sourceCount: sourceMatch ? parseInt(sourceMatch[1]) : 0,
          bias: coverageMatch ? coverageMatch[2].toLowerCase() : null,
          percentage: coverageMatch ? parseInt(coverageMatch[1]) : null
        };
      };

      // Find story cards - try multiple selectors
      const storyCards = Array.from(
        document.querySelectorAll('article, [class*="story"], [class*="card"], a[id*="card"], a[id*="feed"]')
      ).filter(el => {
        const text = el.textContent;
        return text.length > 50 && (
          text.includes('coverage') ||
          text.includes('sources') ||
          text.match(new RegExp('(\\\\d+)%'))
        );
      });

      if (storyCards.length === 0) {
        return { success: false, error: 'No story cards found on page' };
      }

      const stories = storyCards.slice(0, limit).map((card, index) => {
        // Extract headline
        const headline = (
          card.querySelector('h1, h2, h3, h4, h5, [class*="headline"], [class*="title"]')?.textContent ||
          card.querySelector('a')?.textContent ||
          ''
        ).trim();

        // Extract URL
        const link = card.querySelector('a') || card;
        const url = link.href || '';

        // Extract coverage info
        const text = card.textContent;
        const coverage = extractBiasFromText(text);
        const coverageInfo = extractCoverage(card);

        // Extract timestamp
        const timestampEl = card.querySelector('[class*="time"], time, [class*="date"]');
        const timestamp = timestampEl?.textContent?.trim() || '';

        // Extract topic
        const topicEl = card.querySelector('[class*="topic"], [class*="category"]');
        const topic = topicEl?.textContent?.trim() || '';

        // Extract factuality
        const factualityMatch = text.match(new RegExp('(High|Mixed|Low)\\\\s+Factuality'));
        const factuality = factualityMatch ? factualityMatch[1] + ' Factuality' : '';

        return {
          position: index + 1,
          headline: headline,
          url: url,
          coverage: coverage,
          sourceCount: coverageInfo.sourceCount,
          topic: topic,
          timestamp: timestamp,
          factuality: factuality
        };
      }).filter(story => story.headline.length > 0);

      return {
        success: true,
        stories: stories,
        count: stories.length,
        extractedAt: new Date().toISOString()
      };
    }`,
    returnType: 'Object with success, stories array (headline, url, coverage, sourceCount, topic, timestamp, factuality), count, and extractedAt timestamp',
    tags: ['ground.news', 'extraction', 'news', 'bias'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'extraction',
    name: 'groundnews_extract_daily_briefing',
    description: 'Extract the Daily Briefing curated stories from ground.news',
    parameters: {},
    code: `(params) => {
      // Find Daily Briefing section
      const briefingSection = Array.from(document.querySelectorAll('article, section, div')).find(el =>
        el.textContent.includes('Daily Briefing')
      );

      if (!briefingSection) {
        return { success: false, error: 'Daily Briefing section not found' };
      }

      // Extract metadata
      const text = briefingSection.textContent;
      const storyCountMatch = text.match(new RegExp('(\\\\d+)\\\\s+stories'));
      const articleCountMatch = text.match(new RegExp('(\\\\d+)\\\\s+articles'));
      const readTimeMatch = text.match(new RegExp('(\\\\d+)m\\\\s+read'));

      // Extract story headlines from briefing
      const storyElements = briefingSection.querySelectorAll('h1, h2, h3, h4, h5, [class*="headline"]');
      const stories = Array.from(storyElements).map(el => ({
        headline: el.textContent.trim()
      }));

      return {
        success: true,
        briefing: {
          storyCount: storyCountMatch ? parseInt(storyCountMatch[1]) : 0,
          articleCount: articleCountMatch ? parseInt(articleCountMatch[1]) : 0,
          readTime: readTimeMatch ? readTimeMatch[1] + 'm' : '',
          stories: stories
        }
      };
    }`,
    returnType: 'Object with success and briefing object containing storyCount, articleCount, readTime, and stories array',
    tags: ['ground.news', 'extraction', 'briefing'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'extraction',
    name: 'groundnews_extract_blindspot_feed',
    description: 'Extract stories from Blindspot Feed (disproportionate coverage)',
    parameters: {
      blindspotType: {
        type: 'string',
        description: 'Filter type: "left_blindspot", "right_blindspot", or "all"',
        required: false,
        default: 'all'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of stories to extract',
        required: false,
        default: 10
      }
    },
    code: `(params) => {
      const { blindspotType = 'all', limit = 10 } = params;

      // Helper: Detect blindspot type from coverage
      const detectBlindspotType = (text) => {
        // "Low coverage from Left Sources" -> right_blindspot (only right covers it)
        // "Low coverage from Right Sources" -> left_blindspot (only left covers it)
        if (text.includes('Low coverage from Left')) return 'right_blindspot';
        if (text.includes('Low coverage from Right')) return 'left_blindspot';

        // Parse percentages
        const leftMatch = text.match(new RegExp('L(?:eft)?\\\\s*(\\\\d+)%'));
        const rightMatch = text.match(new RegExp('R(?:ight)?\\\\s*(\\\\d+)%'));

        const left = leftMatch ? parseInt(leftMatch[1]) : 0;
        const right = rightMatch ? parseInt(rightMatch[1]) : 0;

        if (left < 30 && right > 60) return 'right_blindspot';
        if (right < 30 && left > 60) return 'left_blindspot';

        return 'balanced';
      };

      // Find blindspot stories
      const storyCards = Array.from(
        document.querySelectorAll('article, [class*="story"], [class*="card"]')
      ).filter(el => {
        const text = el.textContent;
        return text.includes('Low coverage from') || detectBlindspotType(text) !== 'balanced';
      });

      if (storyCards.length === 0) {
        return { success: false, error: 'No blindspot stories found' };
      }

      const blindspots = storyCards.slice(0, limit).map((card, index) => {
        const text = card.textContent;
        const blindspot = detectBlindspotType(text);

        // Filter by type if specified
        if (blindspotType !== 'all' && blindspot !== blindspotType) {
          return null;
        }

        const headline = (
          card.querySelector('h1, h2, h3, h4, [class*="headline"]')?.textContent || ''
        ).trim();

        const sourceMatch = text.match(new RegExp('(\\\\d+)\\\\s+sources?'));
        const leftMatch = text.match(new RegExp('L(?:eft)?\\\\s*(\\\\d+)%'));
        const centerMatch = text.match(new RegExp('C(?:enter)?\\\\s*(\\\\d+)%'));
        const rightMatch = text.match(new RegExp('R(?:ight)?\\\\s*(\\\\d+)%'));

        return {
          position: index + 1,
          headline: headline,
          blindspotType: blindspot,
          coverage: {
            left: leftMatch ? parseInt(leftMatch[1]) : 0,
            center: centerMatch ? parseInt(centerMatch[1]) : 0,
            right: rightMatch ? parseInt(rightMatch[1]) : 0
          },
          sourceCount: sourceMatch ? parseInt(sourceMatch[1]) : 0
        };
      }).filter(story => story !== null && story.headline.length > 0);

      return {
        success: true,
        blindspots: blindspots,
        count: blindspots.length,
        filter: blindspotType
      };
    }`,
    returnType: 'Object with success, blindspots array (headline, blindspotType, coverage, sourceCount), count, and filter',
    tags: ['ground.news', 'extraction', 'blindspot', 'bias'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'extraction',
    name: 'groundnews_extract_story_details',
    description: 'Extract detailed information from a ground.news story page',
    parameters: {
      storyUrl: {
        type: 'string',
        description: 'Story URL (optional if already on story page)',
        required: false
      }
    },
    code: `(params) => {
      const { storyUrl } = params;

      // Navigate to URL if provided
      if (storyUrl) {
        window.location.href = storyUrl;
        return { success: false, error: 'Navigation initiated, retry after page loads' };
      }

      // Extract headline
      const headline = (
        document.querySelector('h1')?.textContent ||
        document.querySelector('[class*="headline"]')?.textContent ||
        ''
      ).trim();

      if (!headline) {
        return { success: false, error: 'Not on a story page or headline not found' };
      }

      // Extract summary
      const summary = (
        document.querySelector('[class*="summary"], [class*="description"], p')?.textContent ||
        ''
      ).trim();

      // Extract coverage percentages
      const pageText = document.body.textContent;
      const leftMatch = pageText.match(new RegExp('L(?:eft)?\\\\s*(\\\\d+)%'));
      const centerMatch = pageText.match(new RegExp('C(?:enter)?\\\\s*(\\\\d+)%'));
      const rightMatch = pageText.match(new RegExp('R(?:ight)?\\\\s*(\\\\d+)%'));

      const coverage = {
        left: leftMatch ? parseInt(leftMatch[1]) : 0,
        center: centerMatch ? parseInt(centerMatch[1]) : 0,
        right: rightMatch ? parseInt(rightMatch[1]) : 0
      };

      // Extract source count
      const sourceMatch = pageText.match(new RegExp('(\\\\d+)\\\\s+sources?'));
      const sourceCount = sourceMatch ? parseInt(sourceMatch[1]) : 0;

      // Extract sources
      const sourceElements = Array.from(document.querySelectorAll('a[href*="http"]')).filter(el => {
        const href = el.href;
        return !href.includes('ground.news') && el.textContent.trim().length > 0;
      });

      const sources = sourceElements.slice(0, 20).map(el => ({
        outlet: el.textContent.trim(),
        url: el.href,
        headline: el.getAttribute('title') || el.textContent.trim()
      }));

      // Extract topics
      const topicElements = document.querySelectorAll('[class*="topic"], [class*="tag"], [class*="category"]');
      const topics = Array.from(topicElements).map(el => el.textContent.trim()).filter(t => t.length > 0);

      // Extract dates
      const timeElement = document.querySelector('time, [class*="date"], [class*="published"]');
      const publishedDate = timeElement?.getAttribute('datetime') || timeElement?.textContent?.trim() || '';

      return {
        success: true,
        story: {
          headline: headline,
          summary: summary,
          coverage: coverage,
          sources: sources,
          sourceCount: sourceCount,
          topics: topics.slice(0, 5),
          publishedDate: publishedDate,
          url: window.location.href
        }
      };
    }`,
    returnType: 'Object with success and story object containing headline, summary, coverage, sources array, sourceCount, topics array, publishedDate, and url',
    tags: ['ground.news', 'extraction', 'story', 'detail'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'extraction',
    name: 'groundnews_extract_source_breakdown',
    description: 'Extract detailed source list and bias breakdown for current story',
    parameters: {},
    code: `(params) => {
      // Find sources section
      const sourcesSection = Array.from(document.querySelectorAll('section, div')).find(el =>
        el.textContent.includes('Sources') || el.textContent.includes('Coverage')
      );

      if (!sourcesSection) {
        return { success: false, error: 'Sources section not found' };
      }

      // Helper: Determine bias from context
      const determineBias = (element) => {
        const text = element.textContent.toLowerCase();
        if (text.includes('left')) return 'left';
        if (text.includes('right')) return 'right';
        if (text.includes('center')) return 'center';
        return 'unknown';
      };

      // Find all source links
      const sourceLinks = Array.from(sourcesSection.querySelectorAll('a[href*="http"]')).filter(el =>
        !el.href.includes('ground.news')
      );

      const sourcesByBias = {
        left: [],
        center: [],
        right: [],
        counts: { left: 0, center: 0, right: 0 }
      };

      sourceLinks.forEach(link => {
        const parent = link.closest('[class*="left"], [class*="center"], [class*="right"]') || link.parentElement;
        const bias = determineBias(parent);

        const sourceData = {
          outlet: link.textContent.trim(),
          url: link.href
        };

        if (bias === 'left') {
          sourcesByBias.left.push(sourceData);
          sourcesByBias.counts.left++;
        } else if (bias === 'right') {
          sourcesByBias.right.push(sourceData);
          sourcesByBias.counts.right++;
        } else if (bias === 'center') {
          sourcesByBias.center.push(sourceData);
          sourcesByBias.counts.center++;
        }
      });

      return {
        success: true,
        sources: sourcesByBias
      };
    }`,
    returnType: 'Object with success and sources object containing left/center/right arrays and counts',
    tags: ['ground.news', 'extraction', 'sources', 'bias'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'extraction',
    name: 'groundnews_extract_my_bias',
    description: 'Extract user reading bias statistics from ground.news',
    parameters: {},
    code: `(params) => {
      // Find "My News Bias" section
      const biasSection = Array.from(document.querySelectorAll('section, div')).find(el =>
        el.textContent.includes('My News Bias') || el.textContent.includes('My Bias')
      );

      if (!biasSection) {
        return { success: false, error: 'My News Bias section not found (may need to be logged in)' };
      }

      const text = biasSection.textContent;

      // Extract stories/articles read
      const storiesMatch = text.match(new RegExp('(\\\\d+)\\\\s+Stories'));
      const articlesMatch = text.match(new RegExp('(\\\\d+)\\\\s+Articles'));

      // Extract bias distribution
      const leftMatch = text.match(new RegExp('L\\\\s*(\\\\d+)%'));
      const centerMatch = text.match(new RegExp('C\\\\s*(\\\\d+)%'));
      const rightMatch = text.match(new RegExp('R\\\\s*(\\\\d+)%'));

      return {
        success: true,
        myBias: {
          storiesRead: storiesMatch ? parseInt(storiesMatch[1]) : 0,
          articlesRead: articlesMatch ? parseInt(articlesMatch[1]) : 0,
          distribution: {
            left: leftMatch ? parseInt(leftMatch[1]) : 0,
            center: centerMatch ? parseInt(centerMatch[1]) : 0,
            right: rightMatch ? parseInt(rightMatch[1]) : 0
          }
        }
      };
    }`,
    returnType: 'Object with success and myBias object containing storiesRead, articlesRead, and distribution',
    tags: ['ground.news', 'extraction', 'bias', 'user'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'extraction',
    name: 'groundnews_extract_trending_topics',
    description: 'Extract current trending topics from ground.news',
    parameters: {},
    code: `(params) => {
      // Find trending/popular topics section
      const trendingSection = Array.from(document.querySelectorAll('section, div, nav')).find(el =>
        el.textContent.includes('Trending') ||
        el.textContent.includes('Popular') ||
        el.textContent.includes('Topics')
      );

      if (!trendingSection) {
        // Fallback: extract from visible topic links
        const topicLinks = Array.from(document.querySelectorAll('a')).filter(el => {
          const text = el.textContent.trim();
          return text.length > 3 && text.length < 50 && !el.href.includes('article');
        });

        if (topicLinks.length === 0) {
          return { success: false, error: 'No trending topics found' };
        }

        const topics = topicLinks.slice(0, 20).map(el => el.textContent.trim());
        const uniqueTopics = [...new Set(topics)];

        return {
          success: true,
          trending: uniqueTopics.slice(0, 10)
        };
      }

      // Extract topics from trending section
      const topicElements = trendingSection.querySelectorAll('a, button, [class*="topic"]');
      const topics = Array.from(topicElements)
        .map(el => el.textContent.trim())
        .filter(t => t.length > 0 && t.length < 50);

      const uniqueTopics = [...new Set(topics)];

      return {
        success: true,
        trending: uniqueTopics.slice(0, 15)
      };
    }`,
    returnType: 'Object with success and trending array of topic names',
    tags: ['ground.news', 'extraction', 'topics', 'trending'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'extraction',
    name: 'groundnews_extract_latest_stories',
    description: 'Extract latest stories feed from ground.news',
    parameters: {
      limit: {
        type: 'number',
        description: 'Maximum number of stories to extract',
        required: false,
        default: 20
      }
    },
    code: `(params) => {
      const { limit = 20 } = params;

      // Find latest stories section
      const latestSection = Array.from(document.querySelectorAll('section, div')).find(el =>
        el.textContent.includes('Latest') || el.textContent.includes('Recent')
      ) || document.body;

      // Extract story cards
      const storyCards = Array.from(latestSection.querySelectorAll('article, [class*="story"], [class*="card"], a[id*="card"]'))
        .filter(el => el.textContent.length > 50);

      if (storyCards.length === 0) {
        return { success: false, error: 'No stories found' };
      }

      const stories = storyCards.slice(0, limit).map((card, index) => {
        const headline = (card.querySelector('h1, h2, h3, h4, [class*="headline"]')?.textContent || '').trim();
        const link = card.querySelector('a') || card;
        const url = link.href || '';

        const text = card.textContent;
        const timestampEl = card.querySelector('time, [class*="time"]');
        const timestamp = timestampEl?.textContent?.trim() || '';

        return {
          position: index + 1,
          headline: headline,
          url: url,
          timestamp: timestamp
        };
      }).filter(story => story.headline.length > 0);

      return {
        success: true,
        stories: stories,
        count: stories.length
      };
    }`,
    returnType: 'Object with success, stories array, and count',
    tags: ['ground.news', 'extraction', 'latest'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'extraction',
    name: 'groundnews_extract_topic_stories',
    description: 'Extract all stories for a specific topic on ground.news',
    parameters: {
      topic: {
        type: 'string',
        description: 'Topic name',
        required: true
      }
    },
    code: `(params) => {
      const { topic } = params;

      if (!topic || topic.trim().length === 0) {
        return { success: false, error: 'Topic is required' };
      }

      // Check if we're on a topic page
      const pageTitle = document.title || '';
      const pageText = document.body.textContent;

      if (!pageTitle.toLowerCase().includes(topic.toLowerCase()) &&
          !pageText.includes(topic)) {
        return {
          success: false,
          error: 'Not on topic page for: ' + topic + '. Navigate to topic first.'
        };
      }

      // Extract stories
      const storyCards = Array.from(
        document.querySelectorAll('article, [class*="story"], [class*="card"], a[id*="card"]')
      ).filter(el => el.textContent.length > 50);

      if (storyCards.length === 0) {
        return { success: false, error: 'No stories found for topic' };
      }

      const stories = storyCards.map((card, index) => {
        const headline = (card.querySelector('h1, h2, h3, h4, [class*="headline"]')?.textContent || '').trim();
        const link = card.querySelector('a') || card;
        const url = link.href || '';

        return {
          position: index + 1,
          headline: headline,
          url: url
        };
      }).filter(story => story.headline.length > 0);

      return {
        success: true,
        topic: topic,
        stories: stories,
        count: stories.length
      };
    }`,
    returnType: 'Object with success, topic, stories array, and count',
    tags: ['ground.news', 'extraction', 'topic'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'extraction',
    name: 'groundnews_extract_factuality_info',
    description: 'Extract factuality ratings for current story on ground.news',
    parameters: {},
    code: `(params) => {
      const pageText = document.body.textContent;

      // Extract factuality percentages
      const highMatch = pageText.match(new RegExp('(\\\\d+)%.*?High Factuality|High Factuality.*?(\\\\d+)%'));
      const mixedMatch = pageText.match(new RegExp('(\\\\d+)%.*?Mixed|Mixed.*?(\\\\d+)%'));

      // Extract source counts by factuality
      const sourceText = pageText;
      const highSourceMatch = sourceText.match(new RegExp('High.*?(\\\\d+)\\\\s+sources?'));
      const mixedSourceMatch = sourceText.match(new RegExp('Mixed.*?(\\\\d+)\\\\s+sources?'));
      const lowSourceMatch = sourceText.match(new RegExp('Low.*?(\\\\d+)\\\\s+sources?'));

      const highPercentage = highMatch ? parseInt(highMatch[1] || highMatch[2]) : 0;
      const mixedPercentage = mixedMatch ? parseInt(mixedMatch[1] || mixedMatch[2]) : 0;
      const lowPercentage = 100 - highPercentage - mixedPercentage;

      return {
        success: true,
        factuality: {
          highFactuality: highPercentage,
          mixedOrLower: mixedPercentage + lowPercentage,
          breakdown: {
            high: highSourceMatch ? parseInt(highSourceMatch[1]) : 0,
            mixed: mixedSourceMatch ? parseInt(mixedSourceMatch[1]) : 0,
            low: lowSourceMatch ? parseInt(lowSourceMatch[1]) : 0
          }
        }
      };
    }`,
    returnType: 'Object with success and factuality object containing percentages and source breakdown',
    tags: ['ground.news', 'extraction', 'factuality'],
    reliability: 'untested'
  },

  // ==================== NAVIGATION MACROS (6) ====================

  {
    site: 'ground.news',
    category: 'navigation',
    name: 'groundnews_navigate_to_story',
    description: 'Click and navigate to a specific story on ground.news',
    parameters: {
      position: {
        type: 'number',
        description: '1-based position in current feed',
        required: false
      },
      titleMatch: {
        type: 'string',
        description: 'Partial headline text to match (case-insensitive)',
        required: false
      }
    },
    code: `(params) => {
      const { position, titleMatch } = params;

      if (!position && !titleMatch) {
        return { success: false, error: 'Either position or titleMatch is required' };
      }

      // Find all story cards
      const storyCards = Array.from(
        document.querySelectorAll('article, [class*="story"], [class*="card"], a[id*="card"]')
      ).filter(el => el.textContent.length > 50);

      if (storyCards.length === 0) {
        return { success: false, error: 'No stories found on page' };
      }

      let targetCard = null;
      let targetHeadline = '';
      let targetPosition = 0;

      if (position) {
        const index = position - 1;
        if (index < 0 || index >= storyCards.length) {
          return {
            success: false,
            error: 'Position out of range (1-' + storyCards.length + ')'
          };
        }
        targetCard = storyCards[index];
        targetPosition = position;
      } else if (titleMatch) {
        const regex = new RegExp(titleMatch, 'i');
        const index = storyCards.findIndex(card =>
          regex.test(card.textContent)
        );

        if (index === -1) {
          return { success: false, error: 'No story matching: ' + titleMatch };
        }

        targetCard = storyCards[index];
        targetPosition = index + 1;
      }

      // Extract headline before navigation
      targetHeadline = (
        targetCard.querySelector('h1, h2, h3, h4, [class*="headline"]')?.textContent || ''
      ).trim();

      // Get link
      const link = targetCard.querySelector('a') || targetCard;
      const url = link.href || '';

      if (!url) {
        return { success: false, error: 'Story link not found' };
      }

      // Navigate
      window.location.href = url;

      return {
        success: true,
        headline: targetHeadline,
        url: url,
        position: targetPosition,
        message: 'Navigation initiated'
      };
    }`,
    returnType: 'Object with success, headline, url, and position',
    tags: ['ground.news', 'navigation', 'story'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'navigation',
    name: 'groundnews_navigate_to_section',
    description: 'Navigate to specific section of ground.news site',
    parameters: {
      section: {
        type: 'string',
        description: 'Section name: "home", "for_you", "local", "blindspot"',
        required: true
      }
    },
    code: `(params) => {
      const { section } = params;

      const validSections = ['home', 'for_you', 'local', 'blindspot'];

      if (!validSections.includes(section.toLowerCase())) {
        return {
          success: false,
          error: 'Invalid section. Valid options: ' + validSections.join(', ')
        };
      }

      // Map section names to link text
      const sectionMap = {
        'home': ['Home', 'News'],
        'for_you': ['For You'],
        'local': ['Local', 'Local News'],
        'blindspot': ['Blindspot', 'Blindspot Feed']
      };

      const searchTexts = sectionMap[section.toLowerCase()] || [section];

      // Find navigation link
      const navLink = Array.from(document.querySelectorAll('nav a, a')).find(el => {
        const text = el.textContent.trim();
        return searchTexts.some(searchText =>
          text.toLowerCase() === searchText.toLowerCase()
        );
      });

      if (!navLink) {
        return { success: false, error: 'Section link not found: ' + section };
      }

      const url = navLink.href || '';
      navLink.click();

      return {
        success: true,
        section: section,
        url: url,
        message: 'Navigated to section'
      };
    }`,
    returnType: 'Object with success, section, and url',
    tags: ['ground.news', 'navigation', 'section'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'navigation',
    name: 'groundnews_navigate_to_topic',
    description: 'Navigate to specific topic page on ground.news',
    parameters: {
      topic: {
        type: 'string',
        description: 'Topic name (e.g., "Israel-Gaza", "Business & Markets")',
        required: true
      }
    },
    code: `(params) => {
      const { topic } = params;

      if (!topic || topic.trim().length === 0) {
        return { success: false, error: 'Topic is required' };
      }

      // Find topic link
      const topicLink = Array.from(document.querySelectorAll('a')).find(el =>
        el.textContent.trim().toLowerCase() === topic.toLowerCase()
      );

      if (!topicLink) {
        return { success: false, error: 'Topic not found: ' + topic };
      }

      const url = topicLink.href || '';
      topicLink.click();

      return {
        success: true,
        topic: topic,
        url: url,
        message: 'Navigated to topic page'
      };
    }`,
    returnType: 'Object with success, topic, url, and storyCount',
    tags: ['ground.news', 'navigation', 'topic'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'navigation',
    name: 'groundnews_scroll_and_load_more',
    description: 'Scroll down and load more stories (infinite scroll) on ground.news',
    parameters: {
      scrollCount: {
        type: 'number',
        description: 'Number of times to scroll down',
        required: false,
        default: 3
      }
    },
    code: `(params) => {
      const { scrollCount = 3 } = params;

      let storiesLoaded = 0;
      const initialCount = document.querySelectorAll('article, [class*="story"], [class*="card"]').length;

      // Scroll function
      const scrollDown = () => {
        window.scrollTo(0, document.body.scrollHeight);
      };

      // Perform scrolls with delays
      let scrollsCompleted = 0;

      const doScroll = () => {
        if (scrollsCompleted >= scrollCount) {
          const finalCount = document.querySelectorAll('article, [class*="story"], [class*="card"]').length;
          storiesLoaded = finalCount - initialCount;
          return;
        }

        scrollDown();
        scrollsCompleted++;

        setTimeout(doScroll, 1000);
      };

      doScroll();

      return {
        success: true,
        scrollsPerformed: scrollCount,
        message: 'Scrolling initiated, wait for loading to complete'
      };
    }`,
    returnType: 'Object with success, storiesLoaded, and totalStories',
    tags: ['ground.news', 'navigation', 'scroll'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'navigation',
    name: 'groundnews_navigate_pagination',
    description: 'Navigate between pages if pagination exists on ground.news',
    parameters: {
      direction: {
        type: 'string',
        description: 'Direction: "next", "previous", or page number',
        required: true
      }
    },
    code: `(params) => {
      const { direction } = params;

      // Find pagination controls
      const paginationLinks = Array.from(document.querySelectorAll('a, button')).filter(el => {
        const text = el.textContent.toLowerCase();
        return text.includes('next') || text.includes('previous') || text.includes('prev') ||
               /^\\d+$/.test(text.trim());
      });

      if (paginationLinks.length === 0) {
        return { success: false, error: 'No pagination found (site may use infinite scroll)' };
      }

      let targetLink = null;

      if (direction.toLowerCase() === 'next') {
        targetLink = paginationLinks.find(el => el.textContent.toLowerCase().includes('next'));
      } else if (direction.toLowerCase() === 'previous' || direction.toLowerCase() === 'prev') {
        targetLink = paginationLinks.find(el =>
          el.textContent.toLowerCase().includes('prev')
        );
      } else if (/^\\d+$/.test(direction)) {
        targetLink = paginationLinks.find(el => el.textContent.trim() === direction);
      }

      if (!targetLink) {
        return { success: false, error: 'Pagination link not found: ' + direction };
      }

      targetLink.click();

      return {
        success: true,
        direction: direction,
        message: 'Navigation initiated'
      };
    }`,
    returnType: 'Object with success, currentPage, and totalPages',
    tags: ['ground.news', 'navigation', 'pagination'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'navigation',
    name: 'groundnews_open_source_article',
    description: 'Open original source article from ground.news story page',
    parameters: {
      sourceOutlet: {
        type: 'string',
        description: 'Specific outlet name to open (optional)',
        required: false
      },
      position: {
        type: 'number',
        description: 'Source position (1-based, optional)',
        required: false
      }
    },
    code: `(params) => {
      const { sourceOutlet, position } = params;

      // Find source links (external, not ground.news)
      const sourceLinks = Array.from(document.querySelectorAll('a[href*="http"]')).filter(el =>
        !el.href.includes('ground.news') && el.textContent.trim().length > 0
      );

      if (sourceLinks.length === 0) {
        return { success: false, error: 'No source articles found on page' };
      }

      let targetLink = null;
      let outlet = '';

      if (sourceOutlet) {
        targetLink = sourceLinks.find(el =>
          el.textContent.toLowerCase().includes(sourceOutlet.toLowerCase())
        );
        if (!targetLink) {
          return { success: false, error: 'Source outlet not found: ' + sourceOutlet };
        }
        outlet = targetLink.textContent.trim();
      } else if (position) {
        const index = position - 1;
        if (index < 0 || index >= sourceLinks.length) {
          return {
            success: false,
            error: 'Position out of range (1-' + sourceLinks.length + ')'
          };
        }
        targetLink = sourceLinks[index];
        outlet = targetLink.textContent.trim();
      } else {
        // Default: open first source
        targetLink = sourceLinks[0];
        outlet = targetLink.textContent.trim();
      }

      const url = targetLink.href;
      window.open(url, '_blank');

      return {
        success: true,
        outlet: outlet,
        url: url,
        message: 'Opened source article in new tab'
      };
    }`,
    returnType: 'Object with success, outlet, url, and bias',
    tags: ['ground.news', 'navigation', 'source'],
    reliability: 'untested'
  },

  // ==================== INTERACTION MACROS (5) ====================

  {
    site: 'ground.news',
    category: 'interaction',
    name: 'groundnews_toggle_bias_view',
    description: 'Toggle between different bias visualization modes on ground.news',
    parameters: {
      viewMode: {
        type: 'string',
        description: 'View mode: "chart", "list", "grid" (optional)',
        required: false
      }
    },
    code: `(params) => {
      const { viewMode } = params;

      // Find view toggle buttons
      const viewButtons = Array.from(document.querySelectorAll('button, a')).filter(el => {
        const text = el.textContent.toLowerCase();
        return text.includes('view') || text.includes('chart') || text.includes('list') || text.includes('grid');
      });

      if (viewButtons.length === 0) {
        return { success: false, error: 'View toggle controls not found' };
      }

      if (viewMode) {
        const targetButton = viewButtons.find(el =>
          el.textContent.toLowerCase().includes(viewMode.toLowerCase())
        );

        if (!targetButton) {
          return { success: false, error: 'View mode not found: ' + viewMode };
        }

        targetButton.click();
        return {
          success: true,
          viewMode: viewMode,
          message: 'Toggled to ' + viewMode + ' view'
        };
      }

      // Toggle to next view
      viewButtons[0].click();

      return {
        success: true,
        message: 'Toggled view mode'
      };
    }`,
    returnType: 'Object with success and viewMode',
    tags: ['ground.news', 'interaction', 'view'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'interaction',
    name: 'groundnews_expand_story_details',
    description: 'Expand collapsed sections on ground.news story page',
    parameters: {
      section: {
        type: 'string',
        description: 'Section to expand: "sources", "timeline", "related"',
        required: true
      }
    },
    code: `(params) => {
      const { section } = params;

      const validSections = ['sources', 'timeline', 'related'];

      if (!validSections.includes(section.toLowerCase())) {
        return {
          success: false,
          error: 'Invalid section. Valid options: ' + validSections.join(', ')
        };
      }

      // Find expand buttons
      const expandButtons = Array.from(document.querySelectorAll('button, [role="button"], [class*="expand"]')).filter(el => {
        const text = el.textContent.toLowerCase();
        return text.includes(section.toLowerCase()) ||
               text.includes('show more') ||
               text.includes('expand');
      });

      if (expandButtons.length === 0) {
        return { success: false, error: 'Expand control not found for: ' + section };
      }

      const button = expandButtons[0];
      const wasExpanded = button.getAttribute('aria-expanded') === 'true';

      button.click();

      return {
        success: true,
        section: section,
        expanded: !wasExpanded,
        message: (wasExpanded ? 'Collapsed ' : 'Expanded ') + section
      };
    }`,
    returnType: 'Object with success, section, and expanded boolean',
    tags: ['ground.news', 'interaction', 'expand'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'interaction',
    name: 'groundnews_apply_filters',
    description: 'Apply multiple filters at once on ground.news',
    parameters: {
      filters: {
        type: 'object',
        description: 'Filter object with topic, region, bias, factuality, timeRange properties',
        required: true
      }
    },
    code: `(params) => {
      const { filters } = params;

      if (!filters || Object.keys(filters).length === 0) {
        return { success: false, error: 'At least one filter must be specified' };
      }

      const appliedFilters = {};
      const errors = [];

      // Apply topic filter
      if (filters.topic) {
        const topicLink = Array.from(document.querySelectorAll('a, button')).find(el =>
          el.textContent.trim().toLowerCase().includes(filters.topic.toLowerCase())
        );

        if (topicLink) {
          topicLink.click();
          appliedFilters.topic = filters.topic;
        } else {
          errors.push('Topic not found: ' + filters.topic);
        }
      }

      // Apply region filter
      if (filters.region) {
        const regionLink = Array.from(document.querySelectorAll('a, button')).find(el =>
          el.textContent.trim() === filters.region
        );

        if (regionLink) {
          regionLink.click();
          appliedFilters.region = filters.region;
        } else {
          errors.push('Region not found: ' + filters.region);
        }
      }

      // Apply time range filter
      if (filters.timeRange) {
        const timeButtons = Array.from(document.querySelectorAll('button, a')).filter(el => {
          const text = el.textContent.toLowerCase();
          return text.includes('today') || text.includes('week') || text.includes('month');
        });

        const timeButton = timeButtons.find(el =>
          el.textContent.toLowerCase().includes(filters.timeRange.toLowerCase())
        );

        if (timeButton) {
          timeButton.click();
          appliedFilters.timeRange = filters.timeRange;
        } else {
          errors.push('Time range not found: ' + filters.timeRange);
        }
      }

      return {
        success: Object.keys(appliedFilters).length > 0,
        appliedFilters: appliedFilters,
        errors: errors,
        message: 'Applied ' + Object.keys(appliedFilters).length + ' filters'
      };
    }`,
    returnType: 'Object with success, appliedFilters, and resultCount',
    tags: ['ground.news', 'interaction', 'filter'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'interaction',
    name: 'groundnews_sort_stories',
    description: 'Sort stories by different criteria on ground.news',
    parameters: {
      sortBy: {
        type: 'string',
        description: 'Sort order: "newest", "most_sources", "most_biased"',
        required: true
      }
    },
    code: `(params) => {
      const { sortBy } = params;

      const validSortOptions = ['newest', 'most_sources', 'most_biased'];

      if (!validSortOptions.includes(sortBy.toLowerCase())) {
        return {
          success: false,
          error: 'Invalid sort option. Valid options: ' + validSortOptions.join(', ')
        };
      }

      // Find sort controls
      const sortButtons = Array.from(document.querySelectorAll('button, select, a')).filter(el => {
        const text = el.textContent.toLowerCase();
        return text.includes('sort') || text.includes('order');
      });

      if (sortButtons.length === 0) {
        return { success: false, error: 'Sort controls not found' };
      }

      // Map sort options to likely text
      const sortTextMap = {
        'newest': ['newest', 'recent', 'latest'],
        'most_sources': ['sources', 'coverage'],
        'most_biased': ['bias', 'biased']
      };

      const searchTexts = sortTextMap[sortBy.toLowerCase()] || [sortBy];

      // Find matching sort option
      const sortOption = sortButtons.find(el => {
        const text = el.textContent.toLowerCase();
        return searchTexts.some(searchText => text.includes(searchText));
      });

      if (!sortOption) {
        return { success: false, error: 'Sort option not found: ' + sortBy };
      }

      sortOption.click();

      return {
        success: true,
        sortOrder: sortBy,
        message: 'Sorted by ' + sortBy
      };
    }`,
    returnType: 'Object with success and sortOrder',
    tags: ['ground.news', 'interaction', 'sort'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'interaction',
    name: 'groundnews_toggle_theme',
    description: 'Toggle between light/dark theme on ground.news',
    parameters: {
      theme: {
        type: 'string',
        description: 'Theme: "light", "dark", or "auto"',
        required: true
      }
    },
    code: `(params) => {
      const { theme } = params;

      const validThemes = ['light', 'dark', 'auto'];

      if (!validThemes.includes(theme.toLowerCase())) {
        return {
          success: false,
          error: 'Invalid theme. Valid options: ' + validThemes.join(', ')
        };
      }

      // Find theme toggle
      const themeButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(el => {
        const text = el.textContent.toLowerCase();
        const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
        return text.includes('theme') || text.includes('dark') || text.includes('light') ||
               ariaLabel.includes('theme') || ariaLabel.includes('dark') || ariaLabel.includes('light');
      });

      if (themeButtons.length === 0) {
        return { success: false, error: 'Theme toggle not found' };
      }

      const themeButton = themeButtons[0];

      // Click until desired theme is active
      let attempts = 0;
      while (attempts < 3) {
        themeButton.click();

        const currentText = themeButton.textContent.toLowerCase();
        if (currentText.includes(theme.toLowerCase())) {
          break;
        }

        attempts++;
      }

      return {
        success: true,
        theme: theme,
        message: 'Theme set to ' + theme
      };
    }`,
    returnType: 'Object with success and theme',
    tags: ['ground.news', 'interaction', 'theme'],
    reliability: 'untested'
  },

  // ==================== UTILITY MACROS (3) ====================

  {
    site: 'ground.news',
    category: 'util',
    name: 'groundnews_detect_page_type',
    description: 'Detect what type of page is currently displayed on ground.news',
    parameters: {},
    code: `(params) => {
      const url = window.location.href;
      const title = document.title.toLowerCase();
      const pageText = document.body.textContent;

      let pageType = 'unknown';
      const metadata = {};

      // Detect homepage
      if (url === 'https://ground.news/' || url === 'https://ground.news' || title.includes('ground news')) {
        pageType = 'homepage';

        // Count sections
        metadata.hasDailyBriefing = pageText.includes('Daily Briefing');
        metadata.hasBlindspotFeed = pageText.includes('Blindspot');
        metadata.hasTopStories = pageText.includes('Top News');
      }
      // Detect story detail page
      else if (url.includes('/article/') || document.querySelector('h1')?.textContent.length > 30) {
        pageType = 'story_detail';

        metadata.headline = document.querySelector('h1')?.textContent?.trim() || '';
        metadata.hasSourceList = pageText.includes('Sources') || pageText.includes('Coverage');
      }
      // Detect topic page
      else if (url.includes('/topic/') || title.includes('topic')) {
        pageType = 'topic_page';

        const topicMatch = title.match(/([^|]+)/);
        metadata.topic = topicMatch ? topicMatch[1].trim() : '';
      }
      // Detect blindspot feed
      else if (url.includes('/blindspot') || pageText.includes('Blindspot Feed')) {
        pageType = 'blindspot_feed';

        metadata.hasLeftBlindspots = pageText.includes('Low coverage from Left');
        metadata.hasRightBlindspots = pageText.includes('Low coverage from Right');
      }
      // Detect search results
      else if (url.includes('?q=') || url.includes('/search')) {
        pageType = 'search_results';

        const queryMatch = url.match(/q=([^&]+)/);
        metadata.searchQuery = queryMatch ? decodeURIComponent(queryMatch[1]) : '';
      }

      // Count visible stories
      const storyCards = document.querySelectorAll('article, [class*="story"], [class*="card"]');
      metadata.storyCount = storyCards.length;

      return {
        success: true,
        pageType: pageType,
        metadata: metadata,
        url: url
      };
    }`,
    returnType: 'Object with success, pageType (homepage|story_detail|topic_page|search_results|blindspot_feed|unknown), metadata, and url',
    tags: ['ground.news', 'util', 'detection'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'util',
    name: 'groundnews_get_story_count',
    description: 'Get count of stories currently visible on ground.news page',
    parameters: {},
    code: `(params) => {
      // Count story cards
      const storyCards = document.querySelectorAll('article, [class*="story"], [class*="card"], a[id*="card"]');
      const visibleStories = Array.from(storyCards).filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.height > 0 && rect.width > 0;
      });

      // Try to get total count from page
      const pageText = document.body.textContent;
      const totalMatch = pageText.match(new RegExp('(\\\\d+)\\\\s+(?:total\\\\s+)?stories'));

      return {
        success: true,
        visibleStories: visibleStories.length,
        totalAvailable: totalMatch ? parseInt(totalMatch[1]) : visibleStories.length
      };
    }`,
    returnType: 'Object with success, visibleStories count, and totalAvailable count',
    tags: ['ground.news', 'util', 'count'],
    reliability: 'untested'
  },

  {
    site: 'ground.news',
    category: 'util',
    name: 'groundnews_validate_bias_data',
    description: 'Validate that bias percentages add up to 100% and normalize if needed',
    parameters: {
      biasData: {
        type: 'object',
        description: 'Object with left, center, right percentage properties',
        required: true
      }
    },
    code: `(params) => {
      const { biasData } = params;

      if (!biasData || typeof biasData !== 'object') {
        return { success: false, error: 'biasData object is required' };
      }

      const left = parseInt(biasData.left) || 0;
      const center = parseInt(biasData.center) || 0;
      const right = parseInt(biasData.right) || 0;

      const total = left + center + right;
      const valid = total === 100;

      // Normalize if not valid
      let normalized = { left, center, right };

      if (!valid && total > 0) {
        normalized = {
          left: Math.round((left / total) * 100),
          center: Math.round((center / total) * 100),
          right: Math.round((right / total) * 100)
        };

        // Adjust for rounding errors
        const normalizedTotal = normalized.left + normalized.center + normalized.right;
        if (normalizedTotal !== 100) {
          const diff = 100 - normalizedTotal;
          normalized.center += diff; // Add/subtract difference to center
        }
      }

      return {
        success: true,
        valid: valid,
        total: total,
        original: { left, center, right },
        normalized: normalized
      };
    }`,
    returnType: 'Object with success, valid boolean, total, original data, and normalized data',
    tags: ['ground.news', 'util', 'validation', 'bias'],
    reliability: 'untested'
  }
];
