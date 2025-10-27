#!/usr/bin/env node
import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:9010/ws');

ws.on('open', () => {
  console.log('✓ WebSocket connected');

  // Send a simple test message
  const msg = {
    id: 'test-1',
    type: 'browser_list_attached_tabs',
    payload: {}
  };

  console.log('→ Sending:', msg);
  ws.send(JSON.stringify(msg));
});

ws.on('message', (data) => {
  console.log('← Received:', data.toString());
  ws.close();
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('✗ Error:', error.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('✗ Timeout after 5 seconds');
  ws.close();
  process.exit(1);
}, 5000);
