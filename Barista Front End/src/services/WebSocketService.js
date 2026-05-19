// services/WebSocketService.js
//
// Previously this file was a stub — _tryConnect literally returned
// false ("For now, return false to prevent connection issues"). The
// result: the whole real-time update path was dead. ApiService
// subscribed to `order_updated` events that never fired, baristas
// only saw new orders on the next 15s poll, and inter-station chat
// felt sluggish for the same reason.
//
// This rewrite uses socket.io-client (already in package.json) to
// actually connect to the Flask-SocketIO server on the backend.
// Server-side emit sites (services/add_websocket_to_coffee_system.py,
// services/stock_management.py, etc.) already publish events; the
// frontend just needed a client that listens.
//
// Events forwarded:
//   order_created / new_order  → window 'order_created' / 'app:newOrder'
//   order_updated              → window 'order_updated'
//   chat_message               → window 'chat:new_message'
//   stock_update / stock_alert → window 'stock:update' / 'stock:alert'
//
// If the connection fails (backend offline, CORS misconfig, etc.)
// the service downgrades silently — the existing poll-based code
// path keeps working, just at the existing 15s cadence.
import { io } from 'socket.io-client';

class WebSocketService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.eventHandlers = new Map();
    this.wsUrl = process.env.NODE_ENV === 'production'
      ? window.location.origin
      : 'http://localhost:5001';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  async initialize() {
    if (localStorage.getItem('websocket_disabled') === 'true') {
      console.log('[WS] disabled via user preference');
      return false;
    }
    return this._tryConnect();
  }

  _tryConnect() {
    if (this.socket && this.isConnected) return true;
    try {
      const token = localStorage.getItem('coffee_auth_token')
                 || localStorage.getItem('coffee_system_token');

      this.socket = io(this.wsUrl, {
        // Auth: backend's init_websocket_handlers checks for a JWT
        // on connect. Pass it in the standard "auth" object so the
        // server can authenticate the room subscriptions.
        auth: token ? { token } : {},
        // Polling-only is more reliable behind cloud reverse
        // proxies (Railway) than the websocket upgrade — start with
        // both, the client picks whichever works.
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1500,
        timeout: 10000,
      });

      this.socket.on('connect', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        console.log('[WS] connected:', this.socket.id);
        // Join the "orders" room so all order events come through.
        // Backend's add_websocket_to_coffee_system.py emits to room='orders'.
        try { this.socket.emit('join_room', { room: 'orders' }); } catch (_) {}
      });

      this.socket.on('disconnect', (reason) => {
        this.isConnected = false;
        console.log('[WS] disconnected:', reason);
      });

      this.socket.on('connect_error', (err) => {
        this.reconnectAttempts += 1;
        // Don't spam the console after repeated failures — once is
        // enough to know the backend isn't listening for WS.
        if (this.reconnectAttempts <= 1) {
          console.log('[WS] connect_error (will fall back to polling):', err.message);
        }
      });

      // Forward backend events into the window event bus so the
      // existing listeners in ApiService / OrderDataService / etc.
      // keep working with zero changes.
      const forward = (evt, windowEvt) => {
        this.socket.on(evt, (data) => {
          try {
            window.dispatchEvent(new CustomEvent(windowEvt, { detail: data }));
          } catch (_) { /* ignore */ }
          // Also fire any local subscribers registered via .on()
          (this.eventHandlers.get(evt) || []).forEach(h => {
            try { h(data); } catch (e) { console.warn('[WS] handler error', e); }
          });
        });
      };

      forward('order_created',  'order_created');
      forward('new_order',      'app:newOrder');       // triggers sound chime
      forward('order_updated',  'order_updated');
      forward('chat_message',   'chat:new_message');
      forward('stock_update',   'stock:update');
      forward('stock_alert',    'stock:alert');
      forward('station_update', 'station:update');

      return true;
    } catch (error) {
      console.log('[WS] init failed:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  // Send a payload via WebSocket. Returns true if accepted, false
  // if we're offline (caller can retry via HTTP).
  send(event, data) {
    if (this.socket && this.isConnected) {
      this.socket.emit(event, data);
      return true;
    }
    return false;
  }

  // Subscribe to an event locally (alternative to the window event bus).
  on(event, handler) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, []);
    this.eventHandlers.get(event).push(handler);
  }

  off(event, handler) {
    if (this.eventHandlers.has(event)) {
      const handlers = this.eventHandlers.get(event);
      const i = handlers.indexOf(handler);
      if (i > -1) handlers.splice(i, 1);
    }
  }

  disconnect() {
    if (this.socket) {
      try { this.socket.disconnect(); } catch (_) {}
      this.socket = null;
    }
    this.isConnected = false;
  }

  get connected() { return this.isConnected; }

  // Backend expects the JWT in the auth handshake, but we expose
  // an explicit authenticate() for callers that want to re-auth
  // after a token refresh.
  authenticate(token) {
    if (this.socket && this.isConnected) {
      this.socket.emit('authenticate', { token });
      return true;
    }
    return false;
  }

  joinRoom(room) { return this.send('join_room', { room }); }
  leaveRoom(room) { return this.send('leave_room', { room }); }
}

const webSocketService = new WebSocketService();
export default webSocketService;
