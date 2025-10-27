#!/usr/bin/env node
/**
 * Test Browser MCP macro execution
 */

import { WebSocket } from 'ws';

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

async function executeMacro(macroId, params = {}) {
  return new Promise((resolve, reject) => {
    const id = `test-macro-${++messageId}-${Date.now()}`;
    const message = {
      id,
      type: 'browser_execute_macro',
      payload: { id: macroId, params }
    };

    const timeout = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error('Request timeout'));
    }, 15000);

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

async function run() {
  const macroId = process.argv[2];
  const paramsStr = process.argv[3];

  if (!macroId) {
    console.error('Usage: node test-macro.js <macroId> [params-json]');
    process.exit(1);
  }

  let params = {};
  if (paramsStr) {
    try {
      params = JSON.parse(paramsStr);
    } catch (e) {
      console.error('Error parsing params:', e.message);
      process.exit(1);
    }
  }

  try {
    await connectWebSocket();

    console.log(`Executing macro: ${macroId}`);
    if (Object.keys(params).length > 0) {
      console.log(`Parameters:`, JSON.stringify(params, null, 2));
    }
    console.log('');

    const result = await executeMacro(macroId, params);

    console.log('Result:');
    console.log(JSON.stringify(result, null, 2));

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
