#!/usr/bin/env node
import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:9010/ws');

ws.on('open', () => {
  console.log('✓ Connected to WebSocket\n');

  console.log('Test: Creating window with single URL...');
  const msg = {
    id: 'test-create-window',
    type: 'browser_create_window',
    payload: {
      url: 'https://www.google.com',
      focused: true
    }
  };

  console.log('→ Sending:', JSON.stringify(msg, null, 2));
  ws.send(JSON.stringify(msg));
});

ws.on('message', (data) => {
  console.log('\n← Received:');
  const response = JSON.parse(data.toString());
  console.log(JSON.stringify(response, null, 2));

  console.log('\n=== ANALYSIS ===');
  if (response.type === 'messageResponse') {
    console.log('Response type:', response.type);
    console.log('Request ID:', response.payload.requestId);
    console.log('Has error:', !!response.payload.error);

    if (response.payload.error) {
      console.error('❌ Error:', response.payload.error);
    } else {
      console.log('✅ Success!');
      console.log('Result:', JSON.stringify(response.payload.result, null, 2));

      if (response.payload.result.windowId) {
        console.log(`\n✅ Window created with ID: ${response.payload.result.windowId}`);
      }
    }
  }

  ws.close();
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('✗ WebSocket Error:', error.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('\n✗ Timeout after 10 seconds');
  ws.close();
  process.exit(1);
}, 10000);
