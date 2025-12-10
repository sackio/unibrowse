#!/usr/bin/env node
/**
 * Check test prerequisites
 * Verifies that the browser extension is connected before running tests
 */

import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:9010/ws';
const TIMEOUT_MS = 5000;

async function checkExtensionConnection() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, TIMEOUT_MS);

    ws.on('open', () => {
      // Send a test message that requires the extension
      const testMessage = {
        id: `prereq-check-${Date.now()}`,
        type: 'browser_list_attached_tabs',
        payload: {}
      };

      const messageHandler = (data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.type === 'messageResponse' && response.payload.requestId === testMessage.id) {
            clearTimeout(timeout);
            ws.close();

            // Check if we got an error about no connection
            if (response.payload.error && response.payload.error.includes('No connection to browser extension')) {
              resolve({ connected: false, error: response.payload.error });
            } else if (response.payload.result) {
              // Got a successful response - check if it's an MCP error
              const result = response.payload.result;
              if (result.isError && result.content && result.content[0]) {
                const errorText = result.content[0].text;
                if (errorText.includes('No connection to browser extension')) {
                  resolve({ connected: false, error: errorText });
                  return;
                }
              }
              // Got a successful response - extension is connected
              resolve({ connected: true, response: result });
            } else {
              resolve({ connected: false, error: 'Unknown response format' });
            }
          }
        } catch (e) {
          clearTimeout(timeout);
          ws.close();
          reject(e);
        }
      };

      ws.on('message', messageHandler);
      ws.send(JSON.stringify(testMessage));
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  BROWSER MCP TEST PREREQUISITES CHECK');
  console.log('═══════════════════════════════════════════════════════\n');

  // Check 1: MCP Server running
  console.log('✓ Checking if MCP server is running...');
  try {
    const ws = new WebSocket(WS_URL);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Server not responding'));
      }, 3000);

      ws.on('open', () => {
        clearTimeout(timeout);
        ws.close();
        resolve();
      });

      ws.on('error', reject);
    });
    console.log('  ✓ MCP server is running at', WS_URL, '\n');
  } catch (error) {
    console.log('  ✗ MCP server is NOT running');
    console.log('  → Start the server with: docker compose up -d mcp-server\n');
    process.exit(1);
  }

  // Check 2: Browser extension connected
  console.log('✓ Checking if browser extension is connected...');
  try {
    const result = await checkExtensionConnection();
    if (result.connected) {
      console.log('  ✓ Browser extension is connected');
      if (result.response) {
        console.log('  Response:', JSON.stringify(result.response, null, 2).split('\n').slice(0, 5).join('\n') + '...\n');
      }
    } else {
      console.log('  ✗ Browser extension is NOT connected');
      console.log('  → Open Chrome with the extension:');
      console.log('     1. Open Chrome/Chromium');
      console.log('     2. Navigate to chrome://extensions');
      console.log('     3. Enable "Developer mode"');
      console.log('     4. Click "Load unpacked"');
      console.log('     5. Select the "extension" folder in this project');
      console.log('     6. Click the Browser MCP extension icon');
      console.log('     7. Click "Connect" to connect to ws://localhost:9010/ws');
      console.log('  → Or use the isolated Chrome launcher:');
      console.log('     npm run chrome\n');
      process.exit(1);
    }
  } catch (error) {
    console.log('  ✗ Failed to check extension connection:', error.message, '\n');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('  ALL PREREQUISITES MET ✓');
  console.log('  You can now run the test suites');
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch((error) => {
  console.error('\n✗ Fatal error:', error.message);
  process.exit(1);
});
