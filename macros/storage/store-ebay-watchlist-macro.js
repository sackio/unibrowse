#!/usr/bin/env node

import WebSocket from 'ws';
import { ebayWatchlistMacro } from '../ebay-watchlist-macro.js';

const WS_URL = 'ws://localhost:9010/ws';

async function storeMacro() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      console.log('Connected to Unibrowse MCP server');

      // Send the macro storage request
      const request = {
        jsonrpc: '2.0',
        id: `store-watchlist-${Date.now()}`,
        method: 'tools/call',
        params: {
          name: 'browser_store_macro',
          arguments: ebayWatchlistMacro
        }
      };

      ws.send(JSON.stringify(request));
    });

    ws.on('message', (data) => {
      const response = JSON.parse(data.toString());
      console.log('Response:', JSON.stringify(response, null, 2));

      if (response.error) {
        console.error('Error storing macro:', response.error);
        reject(response.error);
      } else if (response.result) {
        console.log('Macro stored successfully');
        resolve(response.result);
      }

      ws.close();
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    });

    ws.on('close', () => {
      console.log('Connection closed');
    });
  });
}

storeMacro()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
