#!/usr/bin/env node
/**
 * Test browser_create_window functionality
 * Tests the new window creation feature with various options
 */

import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:9010/ws';
let ws;
let testCount = 0;
let passCount = 0;
let failCount = 0;
let createdWindowIds = []; // Track windows created during testing for cleanup

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

async function sendMessage(type, payload) {
  return new Promise((resolve, reject) => {
    const id = `test-${++testCount}-${Date.now()}`;
    const message = { id, type, payload };

    const timeout = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error('Request timeout'));
    }, 10000);

    const handler = (data) => {
      const response = JSON.parse(data.toString());
      if (response.type === 'messageResponse' && response.payload.requestId === id) {
        clearTimeout(timeout);
        ws.removeListener('message', handler);

        if (response.payload.error) {
          reject(new Error(response.payload.error));
        } else {
          // Parse the JSON from the text content (MCP tool response format)
          let result = response.payload.result;
          if (result && result.content && result.content[0] && result.content[0].text) {
            try {
              result = JSON.parse(result.content[0].text);
            } catch (e) {
              // If parsing fails, check if it's an error response
              if (result.isError) {
                reject(new Error(result.content[0].text));
                return;
              }
              // Otherwise use raw result
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
  console.log(`\nTest ${testCount}: ${description}`);

  try {
    const result = await testFn();
    passCount++;
    console.log('  ✓ PASS');
    if (result) {
      console.log(`  Result:`, JSON.stringify(result, null, 2).split('\n').map(l => `  ${l}`).join('\n'));
      // Store window ID for cleanup if available
      if (result.windowId) {
        createdWindowIds.push(result.windowId);
      }
    }
    return result;
  } catch (error) {
    failCount++;
    console.log(`  ✗ FAIL: ${error.message}`);
    return null;
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  WINDOW CREATION TEST SUITE');
  console.log('  Testing browser_create_window functionality');
  console.log('═══════════════════════════════════════════════════════\n');

  try {
    await connectWebSocket();

    // Wait for extension connection
    console.log('Waiting 2 seconds for extension connection...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 1: Create window with single URL
    await test('Create window with single URL', async () => {
      const result = await sendMessage('browser_create_window', {
        url: 'https://example.com',
        focused: true
      });

      if (!result.windowId) {
        throw new Error('No windowId returned');
      }

      if (!result.tabs || result.tabs.length !== 1) {
        throw new Error('Expected 1 tab');
      }

      return result;
    });

    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Test 2: Create window with multiple URLs
    await test('Create window with multiple URLs', async () => {
      const result = await sendMessage('browser_create_window', {
        url: ['https://www.google.com', 'https://www.github.com'],
        width: 1200,
        height: 800
      });

      if (!result.windowId) {
        throw new Error('No windowId returned');
      }

      if (!result.tabs || result.tabs.length !== 2) {
        throw new Error(`Expected 2 tabs, got ${result.tabs?.length}`);
      }

      return result;
    });

    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Test 3: Create blank window
    await test('Create blank window (default)', async () => {
      const result = await sendMessage('browser_create_window', {});

      if (!result.windowId) {
        throw new Error('No windowId returned');
      }

      if (!result.tabs || result.tabs.length === 0) {
        throw new Error('Expected at least 1 tab');
      }

      // Check that it's about:blank or empty (URL might not be loaded yet)
      const url = result.tabs[0].url;
      if (url && !url.includes('about:blank') && !url.includes('chrome://')) {
        throw new Error(`Expected about:blank or empty, got ${url}`);
      }

      return result;
    });

    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Test 4: Create window with custom dimensions
    await test('Create window with custom dimensions', async () => {
      const result = await sendMessage('browser_create_window', {
        url: 'https://www.wikipedia.org',
        width: 1400,
        height: 900,
        focused: true
      });

      if (!result.windowId) {
        throw new Error('No windowId returned');
      }

      return result;
    });

    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Test 5: Create incognito window
    await test('Create incognito window', async () => {
      const result = await sendMessage('browser_create_window', {
        url: 'https://www.example.com',
        incognito: true,
        focused: false
      });

      if (!result.windowId) {
        throw new Error('No windowId returned');
      }

      if (!result.incognito) {
        throw new Error('Expected incognito flag to be true');
      }

      return result;
    });

    // Print summary
    console.log('\n\n═══════════════════════════════════════════════════════');
    console.log('  TEST SUMMARY');
    console.log('═══════════════════════════════════════════════════════\n');
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
    // Cleanup: Close all windows created during testing
    if (ws && createdWindowIds.length > 0) {
      console.log('\n→ Cleaning up test windows...');
      for (const windowId of createdWindowIds) {
        try {
          // Get all tabs in the window
          const tabsResult = await sendMessage('browser_list_tabs', {});
          const windowTabs = tabsResult.content?.[0]?.text?.match(/ID: (\d+)/g)
            ?.map(m => parseInt(m.split(' ')[1]))
            .filter(Boolean) || [];

          // Close each tab in the window
          for (const tabId of windowTabs) {
            try {
              await sendMessage('browser_close_tab', { tabId });
            } catch (e) {
              // Tab may already be closed
            }
          }
          console.log(`  ✓ Closed window ${windowId}`);
        } catch (error) {
          console.log(`  ⚠ Failed to close window ${windowId}: ${error.message}`);
        }
      }
      console.log('✓ Cleanup complete\n');
    }

    if (ws) {
      ws.close();
    }
  }
}

runTests().catch(console.error);
