#!/usr/bin/env node

/**
 * Test script for Browser MCP Macro System
 * Tests all CRUD operations and macro execution
 */

const fs = require('fs');
const WebSocket = require('ws');

const SERVER_URL = 'ws://localhost:9010/ws';
const TEST_MACROS_FILE = './test-macros.json';

let ws;
let messageId = 0;
let storedMacroIds = [];

// Create promise-based message sender
function sendMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = `test-${Date.now()}-${messageId++}`;
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for response to ${type}`));
    }, 10000);

    const handler = (data) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.type === 'messageResponse' && response.payload.requestId === id) {
          clearTimeout(timeout);
          ws.off('message', handler);
          if (response.payload.error) {
            reject(new Error(response.payload.error));
          } else {
            resolve(response.payload.result);
          }
        }
      } catch (error) {
        // Ignore parse errors, wait for correct message
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify({ id, type, payload }));
  });
}

// Test functions
async function testStoreMacros() {
  console.log('\n📦 Testing browser_store_macro...');

  const macros = JSON.parse(fs.readFileSync(TEST_MACROS_FILE, 'utf8'));

  for (const macro of macros) {
    try {
      const result = await sendMessage('browser_store_macro', macro);
      const data = JSON.parse(result.content[0].text);

      if (data.success) {
        console.log(`  ✅ Stored macro: ${macro.name} (ID: ${data.id})`);
        storedMacroIds.push({ id: data.id, name: macro.name });
      } else {
        console.log(`  ❌ Failed to store ${macro.name}: ${data.message}`);
      }
    } catch (error) {
      console.log(`  ❌ Error storing ${macro.name}: ${error.message}`);
    }
  }
}

async function testListMacros() {
  console.log('\n📋 Testing browser_list_macros...');

  // Test 1: List all macros
  try {
    const result = await sendMessage('browser_list_macros', {});
    const data = JSON.parse(result.content[0].text);
    console.log(`  ✅ Listed ${data.count} macros`);
  } catch (error) {
    console.log(`  ❌ Error listing all macros: ${error.message}`);
  }

  // Test 2: Filter by site
  try {
    const result = await sendMessage('browser_list_macros', { site: 'amazon.com' });
    const data = JSON.parse(result.content[0].text);
    console.log(`  ✅ Listed ${data.count} amazon.com macros`);
  } catch (error) {
    console.log(`  ❌ Error filtering by site: ${error.message}`);
  }

  // Test 3: Filter by category
  try {
    const result = await sendMessage('browser_list_macros', { category: 'extraction' });
    const data = JSON.parse(result.content[0].text);
    console.log(`  ✅ Listed ${data.count} extraction macros`);
  } catch (error) {
    console.log(`  ❌ Error filtering by category: ${error.message}`);
  }

  // Test 4: Filter by tags
  try {
    const result = await sendMessage('browser_list_macros', { tags: ['search'] });
    const data = JSON.parse(result.content[0].text);
    console.log(`  ✅ Listed ${data.count} macros with 'search' tag`);
  } catch (error) {
    console.log(`  ❌ Error filtering by tags: ${error.message}`);
  }

  // Test 5: Search by text
  try {
    const result = await sendMessage('browser_list_macros', { search: 'price' });
    const data = JSON.parse(result.content[0].text);
    console.log(`  ✅ Found ${data.count} macros matching 'price'`);
  } catch (error) {
    console.log(`  ❌ Error searching: ${error.message}`);
  }
}

async function testExecuteMacro() {
  console.log('\n▶️  Testing browser_execute_macro...');

  // Note: Execution requires browser tab connection
  // This test will fail without a connected browser tab

  if (storedMacroIds.length === 0) {
    console.log('  ⚠️  No macros stored, skipping execution test');
    return;
  }

  // Try to execute the price range macro (safe, read-only)
  const priceRangeMacro = storedMacroIds.find(m => m.name === 'amazon_get_price_range');
  if (priceRangeMacro) {
    try {
      const result = await sendMessage('browser_execute_macro', {
        id: priceRangeMacro.id,
        params: {}
      });
      const data = JSON.parse(result.content[0].text);
      console.log(`  ✅ Executed ${priceRangeMacro.name}`);
      console.log(`     Result:`, JSON.stringify(data, null, 2));
    } catch (error) {
      console.log(`  ⚠️  Execution failed (expected without browser tab): ${error.message}`);
    }
  }
}

async function testUpdateMacro() {
  console.log('\n✏️  Testing browser_update_macro...');

  if (storedMacroIds.length === 0) {
    console.log('  ⚠️  No macros stored, skipping update test');
    return;
  }

  const macroToUpdate = storedMacroIds[0];

  try {
    const result = await sendMessage('browser_update_macro', {
      id: macroToUpdate.id,
      description: 'Updated description for testing',
      reliability: 'medium',
      tags: ['amazon', 'test', 'updated']
    });
    const data = JSON.parse(result.content[0].text);

    if (data.success) {
      console.log(`  ✅ Updated macro: ${macroToUpdate.name}`);
      console.log(`     New version: ${data.version}`);
    } else {
      console.log(`  ❌ Failed to update: ${data.message}`);
    }
  } catch (error) {
    console.log(`  ❌ Error updating macro: ${error.message}`);
  }
}

async function testDeleteMacros() {
  console.log('\n🗑️  Testing browser_delete_macro...');

  if (storedMacroIds.length === 0) {
    console.log('  ⚠️  No macros stored, skipping delete test');
    return;
  }

  // Delete first macro
  const macroToDelete = storedMacroIds[0];

  try {
    const result = await sendMessage('browser_delete_macro', {
      id: macroToDelete.id
    });
    const data = JSON.parse(result.content[0].text);

    if (data.success) {
      console.log(`  ✅ Deleted macro: ${macroToDelete.name}`);
      storedMacroIds.shift(); // Remove from array
    } else {
      console.log(`  ❌ Failed to delete: ${data.message}`);
    }
  } catch (error) {
    console.log(`  ❌ Error deleting macro: ${error.message}`);
  }
}

async function cleanup() {
  console.log('\n🧹 Cleaning up remaining test macros...');

  for (const macro of storedMacroIds) {
    try {
      await sendMessage('browser_delete_macro', { id: macro.id });
      console.log(`  ✅ Deleted: ${macro.name}`);
    } catch (error) {
      console.log(`  ❌ Error deleting ${macro.name}: ${error.message}`);
    }
  }
}

async function runTests() {
  console.log('🧪 Browser MCP Macro System - Test Suite');
  console.log('==========================================');

  try {
    await testStoreMacros();
    await testListMacros();
    await testExecuteMacro();
    await testUpdateMacro();
    await testDeleteMacros();
    await cleanup();

    console.log('\n✅ All tests completed!');
    console.log('\n📊 Summary:');
    console.log(`   - Stored ${storedMacroIds.length + 1} macros (1 deleted, ${storedMacroIds.length} cleaned up)`);
    console.log('   - Tested filtering by site, category, tags, and search');
    console.log('   - Tested update and delete operations');
    console.log('\n💡 Note: Macro execution requires a connected browser tab');

  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
  } finally {
    ws.close();
  }
}

// Connect and run tests
console.log(`Connecting to ${SERVER_URL}...`);

ws = new WebSocket(SERVER_URL);

ws.on('open', () => {
  console.log('✅ Connected to Browser MCP server\n');
  runTests().catch(error => {
    console.error('Fatal error:', error);
    ws.close();
    process.exit(1);
  });
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
  console.error('\n💡 Make sure the Browser MCP server is running:');
  console.error('   npm run serve');
  process.exit(1);
});

ws.on('close', () => {
  console.log('\n👋 Disconnected from server');
  process.exit(0);
});
