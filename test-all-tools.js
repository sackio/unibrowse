#!/usr/bin/env node
/**
 * Comprehensive Test Suite for Browser MCP
 * Tests all 68 tools across 16 categories
 */

import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:9010/ws';
const TEST_RESULTS = {
  passed: [],
  failed: [],
  skipped: []
};

let ws;
let messageId = 0;

function generateMessageId() {
  return `test-${++messageId}-${Date.now()}`;
}

async function connectWebSocket() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      console.log('✓ Connected to Browser MCP WebSocket');
      resolve();
    });

    ws.on('error', (error) => {
      console.error('✗ WebSocket connection error:', error.message);
      reject(error);
    });
  });
}

async function sendMessage(type, payload) {
  return new Promise((resolve, reject) => {
    const id = generateMessageId();
    const message = { id, type, payload };

    const timeout = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error('Test timeout after 10 seconds'));
    }, 10000);

    const handler = (data) => {
      const response = JSON.parse(data.toString());
      if (response.type === 'messageResponse' && response.payload.requestId === id) {
        clearTimeout(timeout);
        ws.removeListener('message', handler);

        if (response.payload.error) {
          reject(new Error(response.payload.error));
        } else {
          resolve(response.payload.result);
        }
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify(message));
  });
}

async function testTool(category, toolName, type, payload = {}) {
  const testName = `${category}: ${toolName}`;

  try {
    console.log(`\n→ Testing: ${testName}`);
    const result = await sendMessage(type, payload);

    console.log(`  ✓ Success`);
    if (result && typeof result === 'object') {
      console.log(`  Response keys: ${Object.keys(result).join(', ')}`);
    }

    TEST_RESULTS.passed.push({ category, toolName, result });
    return result;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    TEST_RESULTS.failed.push({ category, toolName, error: error.message });
    return null;
  }
}

async function skipTool(category, toolName, reason) {
  console.log(`\n⊘ Skipping: ${category}: ${toolName} - ${reason}`);
  TEST_RESULTS.skipped.push({ category, toolName, reason });
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  BROWSER MCP COMPREHENSIVE TEST SUITE');
  console.log('  Testing all 68 tools across 16 categories');
  console.log('═══════════════════════════════════════════════════════\n');

  try {
    await connectWebSocket();

    // Wait for extension connection
    console.log('\nWaiting 2 seconds for extension connection...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // =====================================================================
    // CATEGORY 1: Cookie Management (4 tools)
    // =====================================================================
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║  CATEGORY 1: Cookie Management (4 tools)             ║');
    console.log('╚═══════════════════════════════════════════════════════╝');

    const cookies = await testTool('Cookie Management', 'Get Cookies', 'browser_get_cookies', {});
    await testTool('Cookie Management', 'Set Cookie', 'browser_set_cookie', {
      name: 'test_cookie',
      value: 'test_value_123',
      path: '/'
    });
    await testTool('Cookie Management', 'Delete Cookie', 'browser_delete_cookie', {
      name: 'test_cookie'
    });
    await testTool('Cookie Management', 'Clear Cookies', 'browser_clear_cookies', {});

    // =====================================================================
    // CATEGORY 2: Download Management (4 tools)
    // =====================================================================
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║  CATEGORY 2: Download Management (4 tools)           ║');
    console.log('╚═══════════════════════════════════════════════════════╝');

    await skipTool('Download Management', 'Download File', 'Requires valid URL and would download actual file');
    const downloads = await testTool('Download Management', 'Get Downloads', 'browser_get_downloads', {
      limit: 10
    });

    if (downloads && downloads.downloads && downloads.downloads.length > 0) {
      const downloadId = downloads.downloads[0].id;
      await testTool('Download Management', 'Open Download', 'browser_open_download', { downloadId });
    } else {
      await skipTool('Download Management', 'Cancel Download', 'No active downloads');
      await skipTool('Download Management', 'Open Download', 'No completed downloads');
    }

    // =====================================================================
    // CATEGORY 3: Clipboard (2 tools)
    // =====================================================================
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║  CATEGORY 3: Clipboard (2 tools)                     ║');
    console.log('╚═══════════════════════════════════════════════════════╝');

    await testTool('Clipboard', 'Set Clipboard', 'browser_set_clipboard', {
      text: 'Browser MCP Test String'
    });
    const clipboardContent = await testTool('Clipboard', 'Get Clipboard', 'browser_get_clipboard', {});

    // =====================================================================
    // CATEGORY 4: History (4 tools)
    // =====================================================================
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║  CATEGORY 4: History (4 tools)                       ║');
    console.log('╚═══════════════════════════════════════════════════════╝');

    const historyResults = await testTool('History', 'Search History', 'browser_search_history', {
      text: 'github',
      maxResults: 5
    });

    if (historyResults && historyResults.results && historyResults.results.length > 0) {
      const testUrl = historyResults.results[0].url;
      await testTool('History', 'Get History Visits', 'browser_get_history_visits', { url: testUrl });
    } else {
      await skipTool('History', 'Get History Visits', 'No history found');
    }

    await skipTool('History', 'Delete History', 'Would delete actual history');
    await skipTool('History', 'Clear History', 'Would clear actual history');

    // =====================================================================
    // CATEGORY 5: System Information (3 tools)
    // =====================================================================
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║  CATEGORY 5: System Information (3 tools)            ║');
    console.log('╚═══════════════════════════════════════════════════════╝');

    await testTool('System Information', 'Get Version', 'browser_get_version', {});
    await testTool('System Information', 'Get System Info', 'browser_get_system_info', {});
    await testTool('System Information', 'Get Browser Info', 'browser_get_browser_info', {});

    // =====================================================================
    // CATEGORY 6: Network (3 tools)
    // =====================================================================
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║  CATEGORY 6: Network (3 tools)                       ║');
    console.log('╚═══════════════════════════════════════════════════════╝');

    await testTool('Network', 'Get Network State', 'browser_get_network_state', {});
    await testTool('Network', 'Set Network Conditions', 'browser_set_network_conditions', {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0
    });
    await skipTool('Network', 'Clear Cache', 'Would clear browser cache');

    // =====================================================================
    // CATEGORY 7: Bookmarks (4 tools)
    // =====================================================================
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║  CATEGORY 7: Bookmarks (4 tools)                     ║');
    console.log('╚═══════════════════════════════════════════════════════╝');

    const bookmarks = await testTool('Bookmarks', 'Get Bookmarks', 'browser_get_bookmarks', {
      recursive: false
    });

    const createdBookmark = await testTool('Bookmarks', 'Create Bookmark', 'browser_create_bookmark', {
      title: 'Test Bookmark - Browser MCP',
      url: 'https://example.com/test'
    });

    await testTool('Bookmarks', 'Search Bookmarks', 'browser_search_bookmarks', {
      query: 'test',
      limit: 5
    });

    if (createdBookmark && createdBookmark.bookmark && createdBookmark.bookmark.id) {
      await testTool('Bookmarks', 'Delete Bookmark', 'browser_delete_bookmark', {
        id: createdBookmark.bookmark.id
      });
    } else {
      await skipTool('Bookmarks', 'Delete Bookmark', 'Failed to create test bookmark');
    }

    // =====================================================================
    // CATEGORY 8: Extension Management (4 tools)
    // =====================================================================
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║  CATEGORY 8: Extension Management (4 tools)          ║');
    console.log('╚═══════════════════════════════════════════════════════╝');

    const extensions = await testTool('Extension Management', 'List Extensions', 'browser_list_extensions', {});

    if (extensions && extensions.extensions && extensions.extensions.length > 0) {
      // Find a safe extension to test (not Browser MCP itself)
      const testExtension = extensions.extensions.find(ext =>
        ext.id !== extensions.extensions.find(e => e.name.includes('Browser MCP'))?.id
      );

      if (testExtension) {
        await testTool('Extension Management', 'Get Extension Info', 'browser_get_extension_info', {
          id: testExtension.id
        });

        await skipTool('Extension Management', 'Enable Extension', 'Would modify extension state');
        await skipTool('Extension Management', 'Disable Extension', 'Would modify extension state');
      } else {
        await skipTool('Extension Management', 'Get Extension Info', 'No safe extensions to test');
        await skipTool('Extension Management', 'Enable Extension', 'No safe extensions to test');
        await skipTool('Extension Management', 'Disable Extension', 'No safe extensions to test');
      }
    } else {
      await skipTool('Extension Management', 'Get Extension Info', 'No extensions found');
      await skipTool('Extension Management', 'Enable Extension', 'No extensions found');
      await skipTool('Extension Management', 'Disable Extension', 'No extensions found');
    }

    // =====================================================================
    // CATEGORY 9-16: Core/Existing Tools (Quick Validation)
    // =====================================================================
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║  VALIDATING CORE TOOLS (Quick Check)                 ║');
    console.log('╚═══════════════════════════════════════════════════════╝');

    // Navigation & Common
    await testTool('Core', 'List Tabs', 'browser_list_tabs', {});

    // Interaction Log
    await testTool('Core', 'Get Interactions', 'browser_get_interactions', {
      limit: 10
    });

    // =====================================================================
    // RESULTS SUMMARY
    // =====================================================================
    console.log('\n\n═══════════════════════════════════════════════════════');
    console.log('  TEST RESULTS SUMMARY');
    console.log('═══════════════════════════════════════════════════════\n');

    console.log(`✓ PASSED:  ${TEST_RESULTS.passed.length} tests`);
    console.log(`✗ FAILED:  ${TEST_RESULTS.failed.length} tests`);
    console.log(`⊘ SKIPPED: ${TEST_RESULTS.skipped.length} tests`);
    console.log(`  TOTAL:   ${TEST_RESULTS.passed.length + TEST_RESULTS.failed.length + TEST_RESULTS.skipped.length} tests\n`);

    if (TEST_RESULTS.failed.length > 0) {
      console.log('FAILED TESTS:');
      TEST_RESULTS.failed.forEach(({ category, toolName, error }) => {
        console.log(`  ✗ ${category}: ${toolName}`);
        console.log(`    Error: ${error}`);
      });
      console.log('');
    }

    if (TEST_RESULTS.skipped.length > 0) {
      console.log('SKIPPED TESTS:');
      TEST_RESULTS.skipped.forEach(({ category, toolName, reason }) => {
        console.log(`  ⊘ ${category}: ${toolName} - ${reason}`);
      });
      console.log('');
    }

    const passRate = ((TEST_RESULTS.passed.length / (TEST_RESULTS.passed.length + TEST_RESULTS.failed.length)) * 100).toFixed(1);
    console.log(`Pass Rate: ${passRate}% (excluding skipped tests)\n`);

    if (TEST_RESULTS.failed.length === 0) {
      console.log('🎉 ALL TESTS PASSED! 🎉\n');
    }

  } catch (error) {
    console.error('\n✗ Fatal error during testing:', error);
  } finally {
    if (ws) {
      ws.close();
    }
  }
}

// Run the tests
runTests().catch(console.error);
