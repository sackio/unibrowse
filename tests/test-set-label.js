#!/usr/bin/env node
import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:9010/ws');

ws.on('open', () => {
  console.log('✓ Connected to WebSocket\n');

  const msg = {
    id: 'test-label-123',
    type: 'browser_set_tab_label',
    payload: {
      tabTarget: 41857853,
      label: 'test-label-demo'
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
    console.log('Result:', JSON.stringify(response.payload.result, null, 2));
  }

  ws.close();
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('✗ Error:', error.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('✗ Timeout');
  ws.close();
  process.exit(1);
}, 5000);
