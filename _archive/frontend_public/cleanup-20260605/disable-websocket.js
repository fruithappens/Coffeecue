// Disable WebSocket to prevent console errors
// This file should be loaded before the main app

(function() {
  console.log('🔌 Disabling WebSocket to prevent console errors...');
  
  // Store the original WebSocket constructor
  window.WebSocketOriginal = window.WebSocket;
  
  // Create a mock WebSocket that does nothing
  window.WebSocket = function(url, protocols) {
    console.log(`🚫 WebSocket connection blocked: ${url}`);
    
    // Return a mock object that implements the WebSocket interface
    const mock = {
      url: url,
      readyState: 3, // CLOSED
      bufferedAmount: 0,
      extensions: '',
      protocol: '',
      binaryType: 'blob',
      
      // Methods that do nothing
      send: function(data) {
        console.log('🚫 WebSocket send blocked:', data);
      },
      close: function(code, reason) {
        console.log('🚫 WebSocket close called');
      },
      
      // Event handlers
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
      
      // Event listener methods
      addEventListener: function(type, listener) {
        console.log(`🚫 WebSocket addEventListener blocked: ${type}`);
      },
      removeEventListener: function(type, listener) {
        console.log(`🚫 WebSocket removeEventListener blocked: ${type}`);
      },
      dispatchEvent: function(event) {
        return false;
      }
    };
    
    // Set a flag in localStorage to indicate WebSocket is disabled
    localStorage.setItem('websocket_disabled', 'true');
    
    return mock;
  };
  
  // Also override Socket.IO if it exists
  if (window.io) {
    const originalIo = window.io;
    window.io = function() {
      console.log('🚫 Socket.IO connection blocked');
      return {
        connect: () => {},
        disconnect: () => {},
        emit: () => {},
        on: () => {},
        off: () => {},
        once: () => {},
        connected: false
      };
    };
  }
  
  console.log('✅ WebSocket disabled successfully');
})();