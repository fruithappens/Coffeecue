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
   * Load chat messages from the server
   * @param {number} limit - Maximum number of messages to fetch
   * @returns {Promise<Array>} - Chat messages
   */
  async loadMessages(limit = 50) {
    try {
      // Don't attempt to load if not initialized
      if (!this.initialized) {
        return this.messages;
      }
      
      // Try to load from localStorage first
      const savedMessages = localStorage.getItem('coffee_chat_messages');
      if (savedMessages) {
        try {
          // Parse messages from localStorage
          const parsedMessages = JSON.parse(savedMessages);
          
          // Debug: Log the loaded messages
          console.log(`Loaded ${parsedMessages.length} messages from localStorage`);
          if (parsedMessages.length > 0) {
            console.log("Sample message:", {
              id: parsedMessages[0].id,
              station_id: parsedMessages[0].station_id,
              station_name: parsedMessages[0].station_name,
              baristaName: parsedMessages[0].baristaName,
              sender: parsedMessages[0].sender
            });
          }
          
          // Process messages to ensure all have the required fields
          this.messages = parsedMessages.map(message => {
            // If the message doesn't have the station_name field, try to add it
            if (!message.station_name && message.station_id) {
              // Try to find any existing message with this station_id that has a station_name
              const referenceMessage = parsedMessages.find(
                m => m.station_id === message.station_id && m.station_name
              );
              
              if (referenceMessage) {
                console.log(`Adding missing station_name to message ${message.id}: ${referenceMessage.station_name}`);
                return {
                  ...message,
                  station_name: referenceMessage.station_name
                };
              }
            }
            return message;
          });
        } catch (e) {
          console.error('Failed to parse saved messages:', e);
        }
      }
      
      // Notify listeners with current messages
      this.notifyListeners();
      
      return this.messages;
    } catch (error) {
      console.error('Failed to load chat messages:', error);
      
      // Return existing messages on error
      return this.messages;
    }
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
      
      // Add to local messages
      this.messages = [...this.messages, newMessage];
      
      // Save to localStorage for sharing between stations
      try {
        localStorage.setItem('coffee_chat_messages', JSON.stringify(this.messages));
      } catch (storageError) {
        console.error('Failed to save messages to localStorage:', storageError);
      }
      
      // Notify listeners
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
      
      // Update localStorage
      try {
        localStorage.setItem('coffee_chat_messages', JSON.stringify(this.messages));
      } catch (storageError) {
        console.error('Failed to save messages to localStorage:', storageError);
      }
      
      // Notify listeners
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