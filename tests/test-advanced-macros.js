#!/usr/bin/env node
/**
 * Test advanced macros functionality
 * Tests macro storage, listing, and execution with real websites
 */

import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:9010/ws';
let ws;
let messageId = 0;
let testCount = 0;
let passCount = 0;
let failCount = 0;
let initialTabIds = []; // Track tabs that existed before the test

async function connectWebSocket() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      console.log('✓ Connected to WebSocket\n');
      resolve();
    });

    ws.on('error', (error) => {
      console.error('✗ Connection error:', error.message);
      reject(error);
    });
  });
}

async function sendMessage(type, payload, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = `test-adv-${++messageId}-${Date.now()}`;
    const message = { id, type, payload };

    const timeout = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error('Request timeout after ' + timeoutMs + 'ms'));
    }, timeoutMs);

    const handler = (data) => {
      const response = JSON.parse(data.toString());
      if (response.type === 'messageResponse' && response.payload.requestId === id) {
        clearTimeout(timeout);
        ws.removeListener('message', handler);

        if (response.payload.error) {
          reject(new Error(response.payload.error));
        } else {
          // Parse JSON from text content
          let result = response.payload.result;
          if (result && result.content && result.content[0] && result.content[0].text) {
            try {
              result = JSON.parse(result.content[0].text);
            } catch (e) {
              // Use raw result if parsing fails
            }
          }
          resolve(result);
        }
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify(message));
  });
}

async function test(description, testFn) {
  testCount++;
  process.stdout.write(`  ${description.padEnd(60)}... `);

  try {
    const result = await testFn();
    passCount++;
    console.log('✓ PASS');
    return result;
  } catch (error) {
    failCount++;
    console.log(`✗ FAIL: ${error.message}`);
    return null;
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  BROWSER MCP ADVANCED MACROS TEST SUITE');
  console.log('  Comprehensive testing of 24 advanced macros');
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    await connectWebSocket();

    // Wait for server to be ready
    console.log('Waiting 2 seconds for server...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Record initial tab IDs before testing
    try {
      const initialResult = await sendMessage('browser_list_attached_tabs', {});
      const text = initialResult.content?.[0]?.text || '';
      const idMatches = text.matchAll(/\(ID: (\d+)\)/g);
      for (const match of idMatches) {
        initialTabIds.push(parseInt(match[1]));
      }
    } catch (e) {
      // Ignore if we can't get initial tabs
    }

    // ========================================================================
    // PHASE 1: MACRO DISCOVERY
    // ========================================================================
    console.log('Phase 1: Macro Discovery & Storage Verification\n');

    const listResult = await test('List all universal macros', async () => {
      const result = await sendMessage('browser_list_macros', { site: '*' });
      if (!result || !result.macros) {
        throw new Error('No macros returned');
      }
      console.log(`\n    → Found ${result.count} universal macros`);
      return result;
    });

    // Check for advanced macros
    const advancedMacros = [
      'extract_main_content',
      'detect_page_load_state',
      'audit_accessibility',
      'measure_page_performance',
      'detect_dark_mode'
    ];

    for (const macroName of advancedMacros) {
      await test(`Find ${macroName} in database`, async () => {
        const macro = listResult.macros.find(m => m.name === macroName);
        if (!macro) {
          throw new Error(`Macro ${macroName} not found`);
        }
        return macro;
      });
    }

    // ========================================================================
    // PHASE 2: TAB ATTACHMENT
    // ========================================================================
    console.log('\nPhase 2: Tab Management\n');

    // Check for attached tabs
    const attachedTabs = await test('Check for attached tabs', async () => {
      const result = await sendMessage('browser_list_attached_tabs', {});
      return result;
    });

    // Attach to a new tab if needed
    if (!attachedTabs || !attachedTabs.content || !attachedTabs.content[0] ||
        attachedTabs.content[0].text.includes('No tabs currently attached')) {
      console.log('\n  No tabs attached, opening new tab...\n');

      await test('Attach to new browser tab', async () => {
        const result = await sendMessage('browser_attach_tab', {
          autoOpenUrl: 'https://example.com'
        }, 30000);
        console.log(`\n    → Successfully attached to new tab`);
        return result;
      });

      // Wait for tab to load
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      console.log('\n  ✓ Found existing attached tab(s)\n');
    }

    // ========================================================================
    // PHASE 3: TIER 1 MACROS (Most Valuable)
    // ========================================================================
    console.log('\nPhase 3: Testing Tier 1 Macros (Most Valuable)\n');

    // Navigate to example.com
    await test('Navigate to example.com', async () => {
      await sendMessage('browser_navigate', { url: 'https://example.com' });
      await new Promise(resolve => setTimeout(resolve, 2000));
      return true;
    });

    // Test extract_main_content
    await test('Execute extract_main_content', async () => {
      const macro = listResult.macros.find(m => m.name === 'extract_main_content');
      if (!macro) throw new Error('Macro not found');

      const response = await sendMessage('browser_execute_macro', {
        id: macro.id,
        params: {}
      });

      const result = response.result || response;
      if (!result.found) {
        throw new Error('No main content found');
      }
      console.log(`\n    → Found content: ${result.wordCount} words, ${result.readingTime}`);
      return result;
    });

    // Test detect_page_load_state
    await test('Execute detect_page_load_state', async () => {
      const macro = listResult.macros.find(m => m.name === 'detect_page_load_state');
      if (!macro) throw new Error('Macro not found');

      const response = await sendMessage('browser_execute_macro', {
        id: macro.id,
        params: {}
      });

      const result = response.result || response;
      console.log(`\n    → Load state: ${result.loadState}, images: ${result.imagesLoaded}%`);
      return result;
    });

    // Test audit_accessibility
    await test('Execute audit_accessibility', async () => {
      const macro = listResult.macros.find(m => m.name === 'audit_accessibility');
      if (!macro) throw new Error('Macro not found');

      const response = await sendMessage('browser_execute_macro', {
        id: macro.id,
        params: {}
      });

      const result = response.result || response;
      console.log(`\n    → A11y score: ${result.score}/100, issues: ${result.issueCount}`);
      return result;
    });

    // Test find_search_functionality
    await test('Execute find_search_functionality', async () => {
      const macro = listResult.macros.find(m => m.name === 'find_search_functionality');
      if (!macro) throw new Error('Macro not found');

      const response = await sendMessage('browser_execute_macro', {
        id: macro.id,
        params: {}
      });

      const result = response.result || response;
      console.log(`\n    → Search found: ${result.found}, type: ${result.type || 'N/A'}`);
      return result;
    });

    // ========================================================================
    // PHASE 4: TIER 2 MACROS (Performance & Analysis)
    // ========================================================================
    console.log('\nPhase 4: Testing Tier 2 Macros (Performance & Analysis)\n');

    // Test measure_page_performance
    await test('Execute measure_page_performance', async () => {
      const macro = listResult.macros.find(m => m.name === 'measure_page_performance');
      if (!macro) throw new Error('Macro not found');

      const response = await sendMessage('browser_execute_macro', {
        id: macro.id,
        params: {}
      });

      const result = response.result || response;
      if (result.available) {
        console.log(`\n    → Load: ${result.loadTime}ms, size: ${result.totalSize}`);
      }
      return result;
    });

    // Test get_page_outline
    await test('Execute get_page_outline', async () => {
      const macro = listResult.macros.find(m => m.name === 'get_page_outline');
      if (!macro) throw new Error('Macro not found');

      const response = await sendMessage('browser_execute_macro', {
        id: macro.id,
        params: {}
      });

      const result = response.result || response;
      console.log(`\n    → Headings: ${result.headingCount}, ToC exists: ${result.tocExists}`);
      return result;
    });

    // Test analyze_images
    await test('Execute analyze_images', async () => {
      const macro = listResult.macros.find(m => m.name === 'analyze_images');
      if (!macro) throw new Error('Macro not found');

      const response = await sendMessage('browser_execute_macro', {
        id: macro.id,
        params: { limit: 10 }
      });

      const result = response.result || response;
      console.log(`\n    → Images: ${result.total}, alt text: ${result.withAlt}/${result.total}`);
      return result;
    });

    // ========================================================================
    // PHASE 5: NAVIGATION TO COMPLEX PAGE
    // ========================================================================
    console.log('\nPhase 5: Testing on Complex Page (GitHub)\n');

    await test('Navigate to github.com', async () => {
      await sendMessage('browser_navigate', { url: 'https://github.com' });
      await new Promise(resolve => setTimeout(resolve, 3000));
      return true;
    });

    // Test detect_tracking_scripts
    await test('Execute detect_tracking_scripts', async () => {
      const macro = listResult.macros.find(m => m.name === 'detect_tracking_scripts');
      if (!macro) throw new Error('Macro not found');

      const response = await sendMessage('browser_execute_macro', {
        id: macro.id,
        params: {}
      });

      const result = response.result || response;
      console.log(`\n    → Trackers: ${result.total}, cookies: ${result.cookiesSet}`);
      return result;
    });

    // ========================================================================
    // PHASE 6: TIER 3 MACROS (Advanced Discovery)
    // ========================================================================
    console.log('\nPhase 6: Testing Tier 3 Macros (Advanced Discovery)\n');

    // Test find_elements_by_position
    await test('Execute find_elements_by_position', async () => {
      const macro = listResult.macros.find(m => m.name === 'find_elements_by_position');
      if (!macro) throw new Error('Macro not found');

      const response = await sendMessage('browser_execute_macro', {
        id: macro.id,
        params: { position: 'top-right', limit: 5 }
      });

      const result = response.result || response;
      if (result.error) {
        console.log(`\n    → ${result.error}`);
      } else {
        console.log(`\n    → Found ${result.count} elements in top-right`);
      }
      return result;
    });

    // Test find_elements_by_z_index
    await test('Execute find_elements_by_z_index', async () => {
      const macro = listResult.macros.find(m => m.name === 'find_elements_by_z_index');
      if (!macro) throw new Error('Macro not found');

      const response = await sendMessage('browser_execute_macro', {
        id: macro.id,
        params: { limit: 5 }
      });

      const result = response.result || response;
      console.log(`\n    → Highest z-index: ${result.highest}, total: ${result.totalWithZIndex}`);
      return result;
    });

    // Test detect_loading_indicators
    await test('Execute detect_loading_indicators', async () => {
      const macro = listResult.macros.find(m => m.name === 'detect_loading_indicators');
      if (!macro) throw new Error('Macro not found');

      const response = await sendMessage('browser_execute_macro', {
        id: macro.id,
        params: {}
      });

      const result = response.result || response;
      console.log(`\n    → Loading: ${result.loading}, indicators: ${result.indicatorCount}`);
      return result;
    });

    // ========================================================================
    // PHASE 7: TIER 4 MACROS (Navigation & Testing)
    // ========================================================================
    console.log('\nPhase 7: Testing Tier 4 Macros (Navigation & Testing)\n');

    // Test get_keyboard_navigation_order
    await test('Execute get_keyboard_navigation_order', async () => {
      const macro = listResult.macros.find(m => m.name === 'get_keyboard_navigation_order');
      if (!macro) throw new Error('Macro not found');

      const response = await sendMessage('browser_execute_macro', {
        id: macro.id,
        params: { limit: 20 }
      });

      const result = response.result || response;
      console.log(`\n    → Focusable: ${result.totalFocusable}, tab traps: ${result.tabTraps.length}`);
      return result;
    });

    // Test detect_dark_mode
    await test('Execute detect_dark_mode', async () => {
      const macro = listResult.macros.find(m => m.name === 'detect_dark_mode');
      if (!macro) throw new Error('Macro not found');

      const response = await sendMessage('browser_execute_macro', {
        id: macro.id,
        params: {}
      });

      const result = response.result || response;
      console.log(`\n    → Dark mode available: ${result.available}, active: ${result.active}`);
      return result;
    });

    // Test measure_viewport_coverage
    await test('Execute measure_viewport_coverage', async () => {
      const macro = listResult.macros.find(m => m.name === 'measure_viewport_coverage');
      if (!macro) throw new Error('Macro not found');

      const response = await sendMessage('browser_execute_macro', {
        id: macro.id,
        params: {}
      });

      const result = response.result || response;
      console.log(`\n    → Most prominent: ${result.mostProminent}, empty: ${result.emptySpace}%`);
      return result;
    });

    // Test detect_captcha
    await test('Execute detect_captcha', async () => {
      const macro = listResult.macros.find(m => m.name === 'detect_captcha');
      if (!macro) throw new Error('Macro not found');

      const response = await sendMessage('browser_execute_macro', {
        id: macro.id,
        params: {}
      });

      const result = response.result || response;
      console.log(`\n    → CAPTCHA present: ${result.present}, type: ${result.type || 'N/A'}`);
      return result;
    });

    // ========================================================================
    // FINAL SUMMARY
    // ========================================================================
    console.log('\n\n═══════════════════════════════════════════════════════════════');
    console.log('  TEST SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log(`  Total:  ${testCount} tests`);
    console.log(`  ✓ Pass: ${passCount} tests`);
    console.log(`  ✗ Fail: ${failCount} tests`);
    console.log(`  Pass Rate: ${((passCount / testCount) * 100).toFixed(1)}%\n`);

    if (failCount === 0) {
      console.log('🎉 ALL TESTS PASSED! 🎉\n');
    } else {
      console.log(`⚠️  ${failCount} test(s) failed\n`);
      process.exit(1);
    }

  } catch (error) {
    console.error('\n✗ Fatal error:', error.message);
    process.exit(1);
  } finally {
    // Cleanup: Close only tabs that were created during this test
    if (ws && ws.readyState === 1) {
      try {
        console.log('\n→ Cleaning up test tabs...');
        const listResult = await sendMessage('browser_list_attached_tabs', {});
        const text = listResult.content?.[0]?.text || '';

        // Find all current tab IDs
        const currentTabIds = [];
        const idMatches = text.matchAll(/\(ID: (\d+)\)/g);
        for (const match of idMatches) {
          currentTabIds.push(parseInt(match[1]));
        }

        // Close tabs that didn't exist before the test
        const newTabs = currentTabIds.filter(id => !initialTabIds.includes(id));

        if (newTabs.length > 0) {
          for (const tabId of newTabs) {
            try {
              await sendMessage('browser_close_tab', { tabId });
            } catch (e) {
              // Tab may already be closed
            }
          }
          console.log(`  ✓ Closed ${newTabs.length} test tab(s)`);
        } else {
          console.log('  No test tabs to close');
        }
      } catch (e) {
        console.log(`  ⚠ Cleanup failed: ${e.message}`);
      }
    }

    if (ws) {
      ws.close();
    }
  }
}

runTests().catch(console.error);
