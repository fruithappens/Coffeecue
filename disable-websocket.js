// Disable WebSocket to prevent connection errors
// Run this in the browser console to stop the WebSocket loops

// Method 1: Override WebSocket constructor
window.WebSocket = class extends WebSocket {
  constructor(url) {
    console.log('WebSocket disabled - blocking connection to:', url);
    super('ws://localhost:1'); // Connect to invalid port to fail immediately
  }
};

// Method 2: Clear any existing WebSocket service
if (window.webSocketService) {
  window.webSocketService.disconnect();
  window.webSocketService = null;
}

// Method 3: Disable in localStorage
localStorage.setItem('disable_websocket', 'true');

console.log('WebSocket has been disabled. Refresh the page to apply changes.');