#!/usr/bin/env node
/**
 * Store all utility macros from utility-macros.js into the Browser MCP database
 * Run: node store-utility-macros.js
 */

import { WebSocket } from 'ws';
import { tier1Macros, tier2Macros, tier3Macros, tier4Macros } from './utility-macros.js';

const WS_URL = 'ws://localhost:9010/ws';
let ws;
let messageId = 0;

// Combine all tiers
const allMacros = [
  ...tier1Macros,
  ...tier2Macros,
  ...tier3Macros,
  ...tier4Macros
];

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
    const id = `store-${++messageId}-${Date.now()}`;
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

async function storeMacros() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  STORING ALL UTILITY MACROS');
  console.log(`  Total macros to store: ${allMacros.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    await connectWebSocket();

    let stored = 0;
    let updated = 0;
    let skipped = 0;

    for (const macro of allMacros) {
      process.stdout.write(`Storing: ${macro.name.padEnd(40)}... `);

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
          console.log('⊘ SKIPPED');
          skipped++;
        }
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log('⊘ EXISTS');
          skipped++;
        } else {
          console.log(`✗ ERROR: ${error.message}`);
        }
      }

      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Total:   ${allMacros.length} macros`);
    console.log(`  ✓ Stored: ${stored} new macros`);
    console.log(`  ✓ Updated: ${updated} existing macros`);
    console.log(`  ⊘ Skipped: ${skipped} (already exist)\n`);

    if (stored + updated > 0) {
      console.log('🎉 SUCCESS! All utility macros are now in the database!\n');
    }

  } catch (error) {
    console.error('\n✗ Fatal error:', error.message);
    process.exit(1);
  } finally {
    if (ws) {
      ws.close();
    }
  }
}

storeMacros().catch(console.error);
