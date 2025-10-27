#!/usr/bin/env node
/**
 * List Browser MCP macros
 */

import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:9010/ws';
let ws;

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

async function listMacros(filter = {}) {
  return new Promise((resolve, reject) => {
    const id = `list-macros-${Date.now()}`;
    const message = {
      id,
      type: 'browser_list_macros',
      payload: filter
    };

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
              // Use raw result
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

async function run() {
  const searchTerm = process.argv[2] || '';

  try {
    await connectWebSocket();

    const result = await listMacros({ search: searchTerm });

    if (result && result.macros) {
      console.log(`Found ${result.macros.length} macros:\n`);
      result.macros.forEach(macro => {
        console.log(`ID: ${macro.id}`);
        console.log(`Name: ${macro.name}`);
        console.log(`Category: ${macro.category}`);
        console.log(`Description: ${macro.description}`);
        console.log('---');
      });
    } else {
      console.log('No macros found');
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    if (ws) {
      ws.close();
    }
  }
}

run();
