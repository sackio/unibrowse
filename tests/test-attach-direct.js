#!/usr/bin/env node
import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:9010/ws');

ws.on('open', () => {
  console.log('✓ Connected to WebSocket\n');

  const msg = {
    id: 'test-attach-' + Date.now(),
    type: 'browser_attach_tab',
    payload: {
      autoOpenUrl: 'https://example.com'
    }
  };

  console.log('→ Sending browser_attach_tab...');
  console.log(JSON.stringify(msg, null, 2));
  ws.send(JSON.stringify(msg));

  setTimeout(() => {
    console.log('\n✗ No response after 15 seconds');
    ws.close();
    process.exit(1);
  }, 15000);
});

ws.on('message', (data) => {
  console.log('\n← Received:');
  const response = JSON.parse(data.toString());
  console.log(JSON.stringify(response, null, 2));

  if (response.type === 'messageResponse') {
    if (response.payload.error) {
      console.log('\n✗ Error:', response.payload.error);
    } else {
      console.log('\n✓ Success!');
    }
  }

  ws.close();
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('✗ Error:', error.message);
  process.exit(1);
});
