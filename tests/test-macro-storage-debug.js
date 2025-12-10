#!/usr/bin/env node
/**
 * Debug script to see what browser_store_macro actually returns
 */

import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:9010/ws';
let ws;
let messageId = 0;

async function sendMessage(type, payload) {
  return new Promise((resolve, reject) => {
    const id = `debug-${++messageId}-${Date.now()}`;
    const message = { id, type, payload };

    const timeout = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`Request timeout after 15 seconds`));
    }, 15000);

    const handler = (data) => {
      const response = JSON.parse(data.toString());
      if (response.type === 'messageResponse' && response.payload.requestId === id) {
        clearTimeout(timeout);
        ws.removeListener('message', handler);

        if (response.payload.error) {
          reject(new Error(response.payload.error));
        } else {
          // Return the RAW result without parsing
          resolve(response.payload.result);
        }
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify(message));
  });
}

async function test() {
  ws = new WebSocket(WS_URL);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  console.log('✓ Connected to WebSocket\n');

  // Wait for extension
  await new Promise(r => setTimeout(r, 2000));

  // Try to list existing macros first
  console.log('Listing existing macros...\n');

  try {
    const result = await sendMessage('browser_list_macros', { site: '*' });

    console.log('RAW RESULT:');
    console.log(JSON.stringify(result, null, 2));
    console.log('\n');

    console.log('Result structure:');
    console.log('  - Has "content" property:', !!result.content);
    console.log('  - Has "isError" property:', !!result.isError);

    if (result.content && result.content[0]) {
      console.log('\n  Content[0]:');
      console.log('    - Type:', result.content[0].type);
      console.log('    - Text:', result.content[0].text.substring(0, 500));

      // Try to parse the text as JSON
      try {
        const parsed = JSON.parse(result.content[0].text);
        console.log('\n  Parsed content:');
        console.log(JSON.stringify(parsed, null, 2));
        console.log('\n  Has "count" field:', !!parsed.count);
        console.log('  Has "macros" field:', !!parsed.macros);
      } catch (e) {
        console.log('\n  Failed to parse as JSON:', e.message);
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
  }

  ws.close();
}

test().catch(console.error);
