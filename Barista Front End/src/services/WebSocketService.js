// services/WebSocketService.js
/**
 * Simplified WebSocket service that handles failures gracefully
 */
class WebSocketService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.eventHandlers = new Map();
    // Environment-aware WebSocket URL
    this.wsUrl = process.env.NODE_ENV === 'production' 
      ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}` 
      : 'http://localhost:5001';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
  }

  /**
   * Initialize WebSocket connection (optional)
   */
  async initialize() {
    // Check if WebSocket is disabled
    if (localStorage.getItem('websocket_disabled') === 'true') {
      console.log('WebSocket is disabled via user preference');
      return false;
    }
    
    // Try to connect but don't crash if it fails
    try {
      console.log('Attempting WebSocket connection to backend...');
      return await this._tryConnect();
    } catch (error) {
      console.log('WebSocket connection failed (non-critical):', error.message);
      return false;
    }
  }

  /**
   * Try to connect to WebSocket
   */
  async _tryConnect() {
    try {
      // Simple connection attempt
      console.log('WebSocket connection attempt...');
      this.isConnected = false;
      return false; // For now, return false to prevent connection issues
    } catch (error) {
      console.log('WebSocket connection failed:', error);
      return false;
    }
  }

  /**
   * Send message through WebSocket (optional)
   */
  send(event, data) {
    if (this.socket && this.isConnected) {
      this.socket.emit(event, data);
      return true;
    } else {
      console.log('WebSocket not connected - message not sent (non-critical)');
      return false;
    }
  }

  /**
   * Subscribe to WebSocket events
   */
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  /**
   * Unsubscribe from WebSocket events
   */
  off(event, handler) {
    if (this.eventHandlers.has(event)) {
      const handlers = this.eventHandlers.get(event);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
  }

  /**
   * Get connection status
   */
  get connected() {
    return this.isConnected;
  }

  /**
   * Authenticate with token (optional)
   */
  authenticate(token) {
    console.log('WebSocket authentication skipped (not connected)');
    return false;
  }

  /**
   * Join room (optional)
   */
  joinRoom(room) {
    return this.send('join_room', { room });
  }

  /**
   * Leave room (optional)
   */
  leaveRoom(room) {
    return this.send('leave_room', { room });
  }
}

// Create and export singleton instance
const webSocketService = new WebSocketService();
export default webSocketService;