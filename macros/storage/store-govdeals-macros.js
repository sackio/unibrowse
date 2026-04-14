#!/usr/bin/env node
/**
 * Store GovDeals Macros to Unibrowse MongoDB
 *
 * Usage: node store-govdeals-macros.js
 */

import { WebSocket } from 'ws';
import { govdealsMacros } from '../govdeals-macros.js';

const WS_URL = 'ws://localhost:9010/ws';
let ws;
let messageId = 0;

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
    const id = `store-govdeals-${++messageId}-${Date.now()}`;
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

async function storeMacros() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  STORING GOVDEALS MACROS');
  console.log(`  Total macros to store: ${govdealsMacros.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    await connectWebSocket();

    let stored = 0;
    let updated = 0;
    let failed = 0;

    for (const macro of govdealsMacros) {
      process.stdout.write(`Storing: ${macro.name.padEnd(45)}... `);

      try {
        const result = await sendMessage('browser_store_macro', {
          site: macro.site,
          category: macro.category,
          name: macro.name,
          description: macro.description,
          parameters: macro.parameters,
          code: macro.code,
          returnType: macro.returnType,
          reliability: macro.reliability,
          tags: macro.tags
        });

        if (result.success) {
          if (result.message.includes('updated')) {
            console.log('✓ UPDATED');
            updated++;
          } else {
            console.log('✓ STORED');
            stored++;
          }
        } else {
          console.log('✗ FAILED:', result.error || 'Unknown error');
          failed++;
        }
      } catch (error) {
        console.log('✗ ERROR:', error.message);
        failed++;
      }
    }

    ws.close();

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  New macros stored:       ${stored}`);
    console.log(`  Existing macros updated: ${updated}`);
    console.log(`  Failed:                  ${failed}`);
    console.log(`  Total processed:         ${govdealsMacros.length}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('\n✗ Fatal error:', error.message);
    process.exit(1);
  }
}

storeMacros();
