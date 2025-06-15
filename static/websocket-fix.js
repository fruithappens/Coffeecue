// WebSocket Fix - Prevents authentication loops
(function() {
  // Check if we should disable WebSocket
  if (localStorage.getItem('disable_websocket') === 'true') {
    console.log('WebSocket disabled via localStorage');
    
    // Override WebSocket constructor
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = class extends OriginalWebSocket {
      constructor(url) {
        console.log('WebSocket connection blocked:', url);
        // Create a dummy WebSocket that immediately closes
        super('ws://localhost:1');
        setTimeout(() => this.close(), 0);
      }
    };
    
    // Also override socket.io if it exists
    if (window.io) {
      const originalIo = window.io;
      window.io = function() {
        console.log('Socket.io connection blocked');
        return {
          on: () => {},
          emit: () => {},
          disconnect: () => {},
          connected: false
        };
      };
    }
  }
})();