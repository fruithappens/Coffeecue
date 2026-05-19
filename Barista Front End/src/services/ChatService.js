// services/ChatService.js
import ApiService from './ApiService';

/**
 * Service for station chat communication
 * Provides methods for sending and receiving chat messages
 */
class ChatService {
  constructor() {
    // Get ApiService singleton instance instead of extending
    this.apiService = new ApiService();
    this.baseUrl = '/api/chat'; // Use direct URL to avoid proxy issues
    this.debugMode = true;
    this.enableFallback = false; // Disable fallback to use real data only
    this.messages = [];
    this.stationId = null;
    this.stationName = null;
    this.baristaName = null;
    this.listeners = [];
    this.pollingInterval = null;
    this.pollingDelay = 10000; // 10 seconds
    this.initialized = false;
    
    // Use localStorage for chat sharing between stations
    this._setupLocalMessageSharing();
  }
  
  /**
   * Set up local storage for sharing messages between stations
   * This enables real-time station-to-station communication
   * @private
   */
  _setupLocalMessageSharing() {
    // Set up storage event listener to sync messages between tabs/instances
    window.addEventListener('storage', (event) => {
      if (event.key === 'coffee_chat_messages') {
        try {
          const sharedMessages = JSON.parse(event.newValue || '[]');
          
          console.log(`Syncing ${sharedMessages.length} messages from other tabs`);
          
          // Merge with existing messages to avoid duplicates
          const existingIds = this.messages.map(m => m.id);
          const newMessages = sharedMessages.filter(m => !existingIds.includes(m.id));
          
          if (newMessages.length > 0) {
            console.log(`Adding ${newMessages.length} new messages from other tabs`);
            
            // Ensure each new message has the original station data
            const processedNewMessages = newMessages.map(message => {
              if (!message.original_station_id && message.station_id) {
                message.original_station_id = message.station_id;
              }
              if (!message.original_station_name && message.station_name) {
                message.original_station_name = message.station_name;
              }
              return message;
            });
            
            this.messages = [...this.messages, ...processedNewMessages];
            
            // Only notify if we're initialized
            if (this.initialized) {
              this.notifyListeners();
            }
          }
        } catch (error) {
          console.error('Error syncing messages from storage:', error);
        }
      }
    });
    
    // Load initial messages from localStorage
    try {
      const savedMessages = localStorage.getItem('coffee_chat_messages');
      if (savedMessages) {
        this.messages = JSON.parse(savedMessages);
      }
    } catch (error) {
      console.error('Error loading initial messages from storage:', error);
    }
  }

  /**
   * Initialize the chat service with station info
   * @param {number} stationId - Station ID
   * @param {string} stationName - Station name
   * @param {string} baristaName - Barista name
   */
  initialize(stationId, stationName, baristaName) {
    // CRITICAL: Save original station ID for debugging
    const originalStationId = stationId;
    
    // Ensure station ID is always numeric for consistency
    this.stationId = typeof stationId === 'string' ? parseInt(stationId, 10) : stationId;
    this.stationName = stationName;
    this.baristaName = baristaName;
    this.initialized = true;
    
    // Start polling for messages
    this.startPolling();
    
    // Load messages immediately
    this.loadMessages();
    
    console.log(`Chat service initialized for ${stationName} (ID: ${this.stationId}, originalId: ${originalStationId}, type: ${typeof originalStationId}) with barista: ${baristaName}`);
  }
  
  /**
   * Start polling for new messages
   */
  startPolling() {
    // Clear any existing interval
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    
    // Start new polling interval
    this.pollingInterval = setInterval(() => {
      this.loadMessages();
    }, this.pollingDelay);
  }
  
  /**
   * Stop polling for messages
   */
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
  
  /**
   * Load chat messages.
   *
   * Previously this method only read from localStorage, which meant
   * Station 1 could never see what Station 2 sent — chat was siloed
   * per browser. Now it primarily fetches from /api/chat/messages
   * (the real chat_messages table, which the backend supports via
   * POST and GET endpoints) and falls back to localStorage when the
   * backend is unreachable.
   *
   * @param {number} limit - Maximum number of messages to fetch
   * @returns {Promise<Array>} - Chat messages
   */
  async loadMessages(limit = 50) {
    if (!this.initialized) return this.messages;

    // Try the backend first — that's the source of truth for
    // inter-station chat.
    try {
      const serverMessages = await this.apiService.request(
        `${this.baseUrl}/messages?limit=${limit}`,
        { method: 'GET' }
      );
      // The endpoint historically returned a bare array; the newer
      // consolidated route may wrap it as { messages: [...] }. Handle both.
      const list = Array.isArray(serverMessages)
        ? serverMessages
        : (serverMessages?.messages || serverMessages?.data || []);
      if (Array.isArray(list)) {
        // Normalize each row to the shape the UI expects. Some rows
        // come from the older inline-app.py route without station_name,
        // so we patch missing fields from companions where possible.
        const normalized = list.map(m => ({
          id: m.id,
          sender: m.sender || m.baristaName || `Station #${m.station_id || '?'}`,
          content: m.content,
          is_urgent: !!m.is_urgent,
          station_id: m.station_id != null
            ? (typeof m.station_id === 'string' ? parseInt(m.station_id, 10) : m.station_id)
            : null,
          station_name: m.station_name || null,
          baristaName: m.baristaName || m.barista_name || null,
          created_at: m.created_at || m.timestamp || new Date().toISOString(),
          original_station_id: m.station_id ?? null,
          original_station_name: m.station_name || null,
        }));
        // Sort oldest → newest so the chat panel scrolls naturally.
        normalized.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        this.messages = normalized;
        try {
          localStorage.setItem('coffee_chat_messages', JSON.stringify(this.messages));
        } catch (e) {
          // localStorage may be full; not fatal.
        }
        this.notifyListeners();
        return this.messages;
      }
    } catch (error) {
      console.warn('Chat: backend fetch failed, falling back to localStorage:', error?.message || error);
    }

    // Fallback path — read whatever's in localStorage so the UI stays
    // populated when the backend is temporarily down.
    try {
      const savedMessages = localStorage.getItem('coffee_chat_messages');
      if (savedMessages) {
        const parsed = JSON.parse(savedMessages);
        this.messages = parsed.map(message => {
          if (!message.station_name && message.station_id) {
            const ref = parsed.find(m => m.station_id === message.station_id && m.station_name);
            if (ref) return { ...message, station_name: ref.station_name };
          }
          return message;
        });
      }
    } catch (e) {
      console.error('Failed to parse saved messages:', e);
    }
    this.notifyListeners();
    return this.messages;
  }
  
  /**
   * Send a chat message
   * @param {string} content - Message content
   * @param {boolean} isUrgent - Whether the message is urgent
   * @returns {Promise<Object>} - Response with sent message
   */
  async sendMessage(content, isUrgent = false) {
    try {
      // Don't attempt to send if not initialized
      if (!this.initialized) {
        throw new Error('Chat service not initialized');
      }
      
      console.log(`Preparing to send message from station ID: ${this.stationId}, station name: ${this.stationName}`);
      
      // DO NOT FORMAT THE STATION NAME INTO THE SENDER FIELD - KEEP IT SEPARATE
      // We need to separate the components to fix the hardcoded Station 1 issue
      
      // Use raw barista name as sender, store station info separately
      const sender = this.baristaName && this.baristaName.trim() 
        ? this.baristaName.trim() 
        : (this.stationName || `Station #${this.stationId}`);
      
      // Prepare message data with separate fields for better display control
      const messageData = {
        sender, // Keep for backward compatibility 
        content,
        is_urgent: isUrgent,
        // Store barista name separately
        baristaName: this.baristaName && this.baristaName.trim() ? this.baristaName.trim() : null,
        // Ensure station_id is numeric for consistency
        station_id: typeof this.stationId === 'string' ? parseInt(this.stationId, 10) : this.stationId
      };
      
      // Create a new message with timestamp and ID
      const newMessage = {
        id: Date.now(),
        ...messageData,
        // Store the station_id explicitly rather than relying on object property
        station_id: typeof this.stationId === 'string' ? parseInt(this.stationId, 10) : this.stationId,
        // Store the station_name explicitly
        station_name: this.stationName || `Station #${this.stationId}`,
        created_at: new Date().toISOString()
      };
      
      console.log(`Creating message with station ID = ${newMessage.station_id} and station name = ${newMessage.station_name}`);
      
      // Ensure we have the original station ID and name for display
      newMessage.original_station_id = newMessage.station_id;
      newMessage.original_station_name = newMessage.station_name;
      
      // Debug: Log message creation details
      console.log("Creating new message with station details:", {
        id: newMessage.id,
        station_id: newMessage.station_id,
        station_name: newMessage.station_name,
        original_station_id: newMessage.original_station_id,
        original_station_name: newMessage.original_station_name,
        baristaName: newMessage.baristaName,
        sender: newMessage.sender
      });
      
      // Add to local messages immediately so the UI feels responsive,
      // then send to the backend. If the backend accepts we swap our
      // optimistic ID for the real one; if it errors we keep the
      // local copy (visible to this barista but won't propagate).
      this.messages = [...this.messages, newMessage];
      this.notifyListeners();

      try {
        const resp = await this.apiService.request(`${this.baseUrl}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender: messageData.sender,
            content: messageData.content,
            is_urgent: messageData.is_urgent,
            station_id: messageData.station_id,
            baristaName: messageData.baristaName,
            station_name: newMessage.station_name,
          }),
        });
        const persisted = resp?.message || resp?.data || resp;
        if (persisted && persisted.id) {
          // Replace the optimistic row with the server's authoritative copy.
          this.messages = this.messages.map(m => (m.id === newMessage.id
            ? {
                ...newMessage,
                id: persisted.id,
                created_at: persisted.created_at || newMessage.created_at,
              }
            : m));
        }
      } catch (apiError) {
        console.warn('Chat: backend POST failed, message kept locally only:', apiError?.message || apiError);
      }

      // Save to localStorage as a cache for next reload.
      try {
        localStorage.setItem('coffee_chat_messages', JSON.stringify(this.messages));
      } catch (storageError) {
        console.error('Failed to save messages to localStorage:', storageError);
      }

      this.notifyListeners();
      return newMessage;
    } catch (error) {
      console.error('Failed to send chat message:', error);
      throw error;
    }
  }
  
  /**
   * Delete a chat message
   * @param {number} messageId - Message ID to delete
   * @returns {Promise<Object>} - Response with success status
   */
  async deleteMessage(messageId) {
    try {
      // Don't attempt to delete if not initialized
      if (!this.initialized) {
        throw new Error('Chat service not initialized');
      }
      
      // Remove the message from our local array
      this.messages = this.messages.filter(message => message.id !== messageId);

      // Also delete on the backend so it actually vanishes for other
      // stations. The DELETE endpoint at /api/chat/messages/<id>
      // accepts admin/staff/barista roles.
      try {
        await this.apiService.request(`${this.baseUrl}/messages/${messageId}`, {
          method: 'DELETE',
        });
      } catch (apiError) {
        console.warn(`Chat: backend DELETE for ${messageId} failed:`, apiError?.message || apiError);
      }

      // Update localStorage cache
      try {
        localStorage.setItem('coffee_chat_messages', JSON.stringify(this.messages));
      } catch (storageError) {
        console.error('Failed to save messages to localStorage:', storageError);
      }

      this.notifyListeners();

      return { success: true };
    } catch (error) {
      console.error(`Failed to delete message ${messageId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get active stations for the chat
   * @returns {Promise<Array>} - List of active stations
   */
  async getStations() {
    try {
      // Get stations from localStorage (populated by StationsService)
      try {
        const stationsJson = localStorage.getItem('coffee_cue_stations');
        if (stationsJson) {
          return JSON.parse(stationsJson);
        }
      } catch (localStorageError) {
        console.warn('Failed to get stations from localStorage:', localStorageError);
      }
      
      return [];
    } catch (error) {
      console.error('Failed to get stations:', error);
      return [];
    }
  }
  
  /**
   * Add a listener for chat updates
   * @param {Function} listener - Callback function
   * @returns {Function} - Function to remove the listener
   */
  addListener(listener) {
    if (typeof listener === 'function' && !this.listeners.includes(listener)) {
      this.listeners.push(listener);
    }
    
    // Return function to remove this listener
    return () => {
      this.removeListener(listener);
    };
  }
  
  /**
   * Remove a listener
   * @param {Function} listener - Listener to remove
   */
  removeListener(listener) {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }
  
  /**
   * Filter messages for all stations to enable true inter-station communication
   * @returns {Array} - All messages for any station, ensuring real communication
   */
  getStationMessages() {
    // Return all messages to enable true station-to-station communication
    // Each message contains sender and station_id to identify its origin
    return this.messages;
  }

  /**
   * Notify all listeners of updates
   */
  notifyListeners() {
    const filteredMessages = this.getStationMessages();
    
    this.listeners.forEach(listener => {
      try {
        listener(filteredMessages);
      } catch (error) {
        console.error('Error notifying chat listener:', error);
      }
    });
  }
  
  /**
   * Clean up resources when service is no longer needed
   */
  cleanup() {
    this.stopPolling();
    this.listeners = [];
    this.initialized = false;
  }
  
  /**
   * Reset chat messages (useful for debugging)
   */
  resetMessages() {
    this.messages = [];
    try {
      localStorage.setItem('coffee_chat_messages', JSON.stringify([]));
      console.log('Chat messages reset successfully');
      this.notifyListeners();
      return true;
    } catch (error) {
      console.error('Failed to reset chat messages:', error);
      return false;
    }
  }
}

// Export singleton instance
export default new ChatService();