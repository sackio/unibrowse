import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:9010/ws';

console.log('Connecting to', WS_URL);

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✓ WebSocket connected');

  // Send a simple test message
  const testMessage = {
    id: 'test-1',
    type: 'browser_get_version',
    payload: {}
  };

  console.log('\n→ Sending test message:', JSON.stringify(testMessage, null, 2));
  ws.send(JSON.stringify(testMessage));

  // Set timeout to close connection after 5 seconds
  setTimeout(() => {
    console.log('\n⚠ No response after 5 seconds, closing connection');
    ws.close();
    process.exit(1);
  }, 5000);
});

ws.on('message', (data) => {
  console.log('\n✓ Received response:');
  try {
    const message = JSON.parse(data.toString());
    console.log(JSON.stringify(message, null, 2));
    ws.close();
    process.exit(0);
  } catch (error) {
    console.error('Failed to parse message:', error);
    console.log('Raw data:', data.toString());
  }
});

ws.on('error', (error) => {
  console.error('✗ WebSocket error:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('\nWebSocket closed');
});
