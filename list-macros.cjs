#!/usr/bin/env node

const WebSocket = require('ws');

const SERVER_URL = 'ws://localhost:9010/ws';
let ws;
let messageId = 0;

function sendMessage(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    const message = {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: method,
        arguments: params
      }
    };

    const handler = (data) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.id === id) {
          ws.off('message', handler);
          if (response.error) {
            reject(new Error(response.error.message || JSON.stringify(response.error)));
          } else {
            resolve(response.result);
          }
        }
      } catch (err) {
        reject(err);
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify(message));

    setTimeout(() => {
      ws.off('message', handler);
      reject(new Error('Timeout waiting for response'));
    }, 10000);
  });
}

async function listMacros() {
  ws = new WebSocket(SERVER_URL);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 5000);
  });

  console.log('Connected to Browser MCP server\n');

  // List all macros
  console.log('📋 All Macros:\n');
  const allMacros = await sendMessage('browser_list_macros', {});
  const macros = JSON.parse(allMacros.content[0].text);

  if (macros.count === 0) {
    console.log('  No macros stored in database');
  } else {
    macros.macros.forEach(macro => {
      console.log(`  • ${macro.name} (${macro.site})`);
      console.log(`    Category: ${macro.category}`);
      console.log(`    Description: ${macro.description}`);
      console.log(`    Version: ${macro.version}`);
      console.log(`    Reliability: ${macro.reliability}`);
      console.log(`    Usage: ${macro.usageCount} times (${(macro.successRate * 100).toFixed(1)}% success)`);
      console.log(`    Tags: ${macro.tags.join(', ')}`);
      console.log(`    ID: ${macro.id}`);
      console.log('');
    });
    console.log(`Total: ${macros.count} macros`);
  }

  ws.close();
}

listMacros().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
