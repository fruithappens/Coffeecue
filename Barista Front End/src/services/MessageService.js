// services/MessageService.js
import OrderDataService from './OrderDataService';
import { createOrderTrackingSMS } from '../utils/qrCodeUtils';
import { getSimilarMilkSuggestions, formatMilkListForSMS } from '../utils/milkConfig';

class MessageService {
  constructor() {
    this.messageHistory = {};
    this.maxHistoryLength = 10;
    
    // Track active reminder timers to cancel them if order is picked up
    this.reminderTimers = new Map();
    
    this.settings = {
      autoSendSmsOnComplete: true, // Changed to true to enable automatic SMS
      remindAfterDelay: true,
      reminderDelay: 120, // 2 minutes in seconds (changed from 30)
      showNameOnDisplay: true,
      displayDuration: 30, // seconds
      includeQrCode: true, // Include enhanced SMS features
      includeTrackingLink: true, // Include location and tips in SMS messages
      useShortUrls: false // Use URL shortening for tracking links
    };
    
    // IMPORTANT: Direct absolute URL to backend - bypassing proxy issues
    this.baseUrl = 'http://localhost:5001/api';
    this.debugMode = true;
    
    // Initialize token from localStorage if available
    this.token = localStorage.getItem('coffee_system_token') || null;
    
    console.log('MessageService initialized with direct backend URL:', this.baseUrl);
    
    if (this.token) {
      console.log('Token found in localStorage during MessageService initialization');
    } else {
      console.warn('No token found in localStorage during MessageService initialization');
    }
    
    // Load any saved settings or history
    this.loadSettings();
    this.loadHistory();
  }
  
  /**
   * Custom fetch with authentication using direct URL approach
   * @param {string} endpoint - API endpoint
   * @param {object} options - Request options
   * @returns {Promise<any>} - API response
   */
  async directFetch(endpoint, options = {}) {
    try {
      // Extract the endpoint path regardless of format
      let apiPath;
      
      // Check if it's a complete URL
      if (endpoint.startsWith('http')) {
        // Extract path from URL
        const url = new URL(endpoint);
        apiPath = url.pathname;
        
        // Further extract after /api/ if present
        if (apiPath.includes('/api/')) {
          apiPath = apiPath.substring(apiPath.indexOf('/api/') + 4);
        }
      } else {
        // Handle relative paths
        if (endpoint.includes('/api/')) {
          // Extract everything after /api/
          apiPath = endpoint.substring(endpoint.indexOf('/api/') + 4);
        } else {
          // Remove leading slash if present
          apiPath = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
        }
      }
      
      // Construct direct URL - this ensures we use the absolute backend URL
      const directUrl = `/api/${apiPath}`;
      console.log(`Using direct URL strategy: ${directUrl}`);
      
      // Check if token exists in localStorage but not in memory
      if (!this.token) {
        const storedToken = localStorage.getItem('coffee_system_token');
        if (storedToken) {
          console.log('Found token in localStorage but not in memory, using it for request');
          this.token = storedToken;
        }
      }
      
      // Set headers
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
        ...(options.headers || {})
      };
      
      if (this.debugMode) {
        console.log(`Authorization header ${this.token ? 'set' : 'NOT set'} for request to ${directUrl}`);
        if (this.token) {
          console.log(`Token length: ${this.token.length}, Token prefix: ${this.token.substring(0, 10)}...`);
        }
        
        console.log(`Fetching from: ${directUrl} with method: ${options.method || 'GET'}`);
        if (options.body) {
          console.log(`Request body: ${options.body}`);
        }
      }
      
      // Make the request - avoid CORS issues by not using credentials
      const response = await fetch(directUrl, {
        ...options,
        headers,
        mode: 'cors'
      });
      
      if (!response.ok) {
        // Try to get error details from response
        let errorDetails = {};
        try {
          errorDetails = await response.json();
        } catch (e) {
          try {
            errorDetails = { message: await response.text() };
          } catch (e2) {
            errorDetails = { message: `HTTP error: ${response.status} ${response.statusText}` };
          }
        }
        
        console.error(`API error: ${response.status}`, errorDetails);
        throw new Error(errorDetails.message || `API error: ${response.status}`);
      }
      
      const data = await response.json();
      if (this.debugMode) {
        console.log(`Response from ${directUrl}:`, data);
      }
      return data;
    } catch (error) {
      console.error(`Error fetching from ${endpoint}:`, error);
      throw error;
    }
  }
  
  /**
   * Load message settings from localStorage
   */
  loadSettings() {
    try {
      const savedSettings = localStorage.getItem('messageServiceSettings');
      if (savedSettings) {
        this.settings = { ...this.settings, ...JSON.parse(savedSettings) };
      }
    } catch (err) {
      console.error('Failed to load message settings:', err);
    }
  }
  
  /**
   * Save current settings to localStorage
   */
  saveSettings() {
    try {
      localStorage.setItem('messageServiceSettings', JSON.stringify(this.settings));
    } catch (err) {
      console.error('Failed to save message settings:', err);
    }
  }
  
  /**
   * Update settings
   * @param {Object} newSettings - New settings to apply
   */
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();
    return this.settings;
  }
  
  /**
   * Send a message to a customer
   * @param {string|Object} order - Order ID or order object
   * @param {string} messageText - Message content
   * @returns {Promise<Object>} - Result with success status and message info
   */
  async sendMessage(order, messageText) {
    if (!order || !messageText) {
      return { success: false, error: 'Missing order or message' };
    }
    
    const orderId = typeof order === 'string' ? order : order.id;
    const customerName = typeof order === 'object' ? order.customerName : '';
    const phoneNumber = typeof order === 'object' ? order.phoneNumber : '';
    
    console.log(`MessageService: Sending message to order ${orderId}`);
    console.log(`Phone number in order object: "${phoneNumber}"`);
    console.log(`Full order object:`, JSON.stringify(order, null, 2));
    
    try {
      // First try using our direct URL approach
      let result;
      let usedDirectFetch = false;
      
      try {
        // Try direct URL approach to send message
        // Clean the ID - remove any prefixes like order_, order_in_progress_, etc.
        let cleanId = String(orderId);
        cleanId = cleanId.replace(/^order_in_progress_/, '')
                       .replace(/^order_completed_/, '')
                       .replace(/^order_/, '');
        
        console.log(`Sending message to customer for order ${cleanId} using direct URL: ${messageText}`);
        
        const requestBody = { 
          order_id: cleanId,
          message: messageText
        };
        
        // Add phone number directly if we have it (direct override)
        if (phoneNumber) {
          requestBody.to = phoneNumber;
          console.log("Adding phone number directly to request:", phoneNumber);
        }
        
        result = await this.directFetch('sms/send', {
          method: 'POST',
          body: JSON.stringify(requestBody)
        });
        
        console.log('Direct fetch message send result:', result);
        usedDirectFetch = true;
      } catch (directError) {
        console.error('Direct URL message sending failed:', directError);
        console.log('Falling back to OrderDataService...');
        
        // Fall back to OrderDataService
        result = await OrderDataService.sendMessageToCustomer(orderId, messageText);
        console.log('OrderDataService message send result:', result);
      }
      
      // Check if result has success property or define success
      const isSuccess = result && (result.success === true || !Object.prototype.hasOwnProperty.call(result, 'success'));
      
      if (!isSuccess) {
        throw new Error(result?.message || result?.error || 'Failed to send message');
      }
      
      // Add message to history
      this.addToHistory(orderId, {
        messageId: result.messageId || result.message_sid || `msg_${Date.now()}`,
        orderId,
        customerName,
        phoneNumber,
        text: messageText,
        timestamp: new Date(),
        status: 'sent',
        sentVia: usedDirectFetch ? 'direct' : 'orderService',
        type: 'outgoing'
      });
      
      console.log('Message added to history');
      
      return { 
        success: true, 
        messageId: result.messageId || result.message_sid || `msg_${Date.now()}`,
        timestamp: new Date()
      };
    } catch (err) {
      console.error('Failed to send message:', err);
      
      // Add failed message to history
      this.addToHistory(orderId, {
        messageId: `failed_${Date.now()}`,
        orderId,
        customerName,
        phoneNumber,
        text: messageText,
        timestamp: new Date(),
        status: 'failed',
        error: err.message,
        type: 'outgoing'
      });
      
      return { 
        success: false, 
        error: err.message
      };
    }
  }
  
  /**
   * Add a message to the history for a specific order
   * @param {string} orderId - Order ID
   * @param {Object} message - Message object
   */
  addToHistory(orderId, message) {
    if (!orderId || !message) return;
    
    // Initialize history array for this order if it doesn't exist
    if (!this.messageHistory[orderId]) {
      this.messageHistory[orderId] = [];
    }
    
    // Add message to history
    this.messageHistory[orderId].unshift(message);
    
    // Keep history at the maximum length
    if (this.messageHistory[orderId].length > this.maxHistoryLength) {
      this.messageHistory[orderId] = this.messageHistory[orderId].slice(0, this.maxHistoryLength);
    }
    
    // Also store in localStorage for persistence
    this.persistHistory();
  }
  
  /**
   * Save message history to localStorage
   */
  persistHistory() {
    try {
      localStorage.setItem('messageHistory', JSON.stringify(this.messageHistory));
    } catch (err) {
      console.error('Failed to persist message history:', err);
    }
  }
  
  /**
   * Load message history from localStorage
   */
  loadHistory() {
    try {
      const savedHistory = localStorage.getItem('messageHistory');
      if (savedHistory) {
        this.messageHistory = JSON.parse(savedHistory);
      }
    } catch (err) {
      console.error('Failed to load message history:', err);
    }
  }
  
  /**
   * Get message history for a specific order
   * @param {string} orderId - Order ID
   * @returns {Array} - Array of messages
   */
  getHistory(orderId) {
    return this.messageHistory[orderId] || [];
  }
  
  /**
   * Get all message history
   * @returns {Object} - Message history indexed by order ID
   */
  getAllHistory() {
    return this.messageHistory;
  }
  
  /**
   * Clear message history for a specific order
   * @param {string} orderId - Order ID
   */
  clearHistory(orderId) {
    if (orderId && this.messageHistory[orderId]) {
      delete this.messageHistory[orderId];
      this.persistHistory();
    }
  }
  
  /**
   * Clear all message history
   */
  clearAllHistory() {
    this.messageHistory = {};
    this.persistHistory();
  }
  
  /**
   * Send a ready notification to a customer
   * @param {Object} order - Order object
   * @returns {Promise<Object>} - Result with success status
   */
  async sendReadyNotification(order) {
    if (!order || !order.id) {
      console.error('Invalid order object:', order);
      return { success: false, error: 'Invalid order' };
    }
    
    console.log('Sending ready notification for order:', order);
    
    // Generate enhanced notification with useful information
    let message = '';
    
    if (this.settings.includeTrackingLink || this.settings.includeQrCode) {
      // Use enhanced SMS system with tips and location info
      const trackingInfo = createOrderTrackingSMS(
        order,
        `🔔 YOUR COFFEE IS READY! Your ${order.coffeeType || "coffee"} is now ready for collection from {stationName}! ☕`
      );
      message = trackingInfo.smsText;
    } else {
      // Simple notification with basic enhancements
      let baseMessage = `🔔 YOUR COFFEE IS READY! Your ${order.coffeeType || 'coffee'} is now ready for collection from ${order.stationName || 'our counter'}! ☕`;
      
      // Add a tip even for simple messages
      const tips = [
        ' TIP: SMS "Same" to reorder next time!',
        ' TIP: Save this number for quick reorders!',
        ' TIP: Peak hours are 8-10am - order early!'
      ];
      baseMessage += tips[Math.floor(Math.random() * tips.length)];
      
      message = baseMessage;
    }
    
    try {
      // Try directFetch first
      let result;
      let usedDirectFetch = false;
      
      try {
        // Clean the ID
        let cleanId = String(order.id);
        cleanId = cleanId.replace(/^order_in_progress_/, '')
                       .replace(/^order_completed_/, '')
                       .replace(/^order_/, '');
                       
        // Create request body
        const requestBody = { 
          order_id: cleanId,
          message: message
        };
        
        // Add phone number directly if we have it
        if (order.phoneNumber) {
          requestBody.to = order.phoneNumber;
        }
        
        result = await this.directFetch('sms/send', {
          method: 'POST',
          body: JSON.stringify(requestBody)
        });
        
        console.log('Direct fetch ready notification result:', result);
        usedDirectFetch = true;
      } catch (directError) {
        console.error('Direct URL ready notification failed:', directError);
        
        // Fall back to OrderDataService
        result = await OrderDataService.sendMessageToCustomer(order.id, message);
        console.log('OrderDataService ready notification result:', result);
      }
      
      // Check if result has success property or assume true if it completed
      const isSuccess = result && (result.success === true || !Object.prototype.hasOwnProperty.call(result, 'success'));
      
      // Add to our local history with appropriate status
      this.addToHistory(order.id, {
        messageId: `ready_${Date.now()}`,
        orderId: order.id,
        customerName: order.customerName,
        phoneNumber: order.phoneNumber,
        text: message,
        timestamp: new Date(),
        status: isSuccess ? 'sent' : 'failed',
        sentVia: usedDirectFetch ? 'direct' : 'orderService',
        error: isSuccess ? null : (result?.message || 'Unknown error'),
        type: 'outgoing'
      });
      
      // Schedule reminder SMS if enabled and ready notification was successful
      if (isSuccess && this.settings.remindAfterDelay && this.settings.reminderDelay > 0) {
        this.scheduleReminderSMS(order);
      }
      
      // Always return a properly formatted result with success property
      return { 
        success: isSuccess,
        message: isSuccess ? 'Notification sent successfully' : 'Failed to send notification',
        error: isSuccess ? null : (result?.message || 'Unknown error')
      };
    } catch (error) {
      console.error('Failed to send ready notification:', error);
      
      // Add failed message to history
      this.addToHistory(order.id, {
        messageId: `failed_${Date.now()}`,
        orderId: order.id,
        customerName: order.customerName,
        phoneNumber: order.phoneNumber,
        text: message,
        timestamp: new Date(),
        status: 'failed',
        error: error.message,
        type: 'outgoing'
      });
      
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Send a reminder notification to a customer
   * @param {Object} order - Order object
   * @param {number} waitMinutes - How many minutes the order has been waiting
   * @returns {Promise<Object>} - Result with success status
   */
  async sendReminderNotification(order, waitMinutes) {
    if (!order || !order.id) {
      return { success: false, error: 'Invalid order' };
    }
    
    // Extract order number from ID if not provided
    const orderNumber = order.orderNumber || order.id.replace(/^order_/, '');
    
    // Create enhanced reminder message with location and tips
    let message = `⏰ REMINDER: Your order #${orderNumber} (${order.coffeeType || 'coffee'}) has been ready for ${waitMinutes} minutes at ${order.stationName || 'our counter'}. Please collect it soon to enjoy it at its best! ☕`;
    
    // Add location information if available
    try {
      const stationSettings = JSON.parse(localStorage.getItem(`coffee_station_settings_${order.stationId}`) || '{}');
      if (stationSettings.location && stationSettings.location.trim()) {
        message += ` Location: ${stationSettings.location}.`;
      }
    } catch (error) {
      // Ignore location loading errors
    }
    
    // Add a helpful tip for reminders
    const reminderTips = [
      ' TIP: Show this SMS to skip the queue next time!',
      ' TIP: SMS "Same" to reorder your usual!',
      ' TIP: Save this number for quick reorders!'
    ];
    message += reminderTips[Math.floor(Math.random() * reminderTips.length)];
    
    return this.sendMessage(order, message);
  }
  
  /**
   * Show an order on the display screen by dispatching a custom event
   * that the display screen component will listen for
   * @param {Object} order - Order object
   * @returns {Object} - Result with success status
   */
  showOnDisplay(order) {
    if (!order) {
      return { success: false, error: 'Invalid order' };
    }
    
    try {
      // Dispatch a custom event that will be caught by the display screen
      const displayEvent = new CustomEvent('showOrderOnDisplay', {
        detail: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          coffeeType: order.coffeeType || 'Coffee',
          status: 'ready'
        }
      });
      
      window.dispatchEvent(displayEvent);
      
      console.log(`Showing order ${order.id} for ${order.customerName} on display screen`);
      
      return { 
        success: true, 
        timestamp: new Date()
      };
    } catch (err) {
      console.error('Failed to show order on display:', err);
      return { 
        success: false, 
        error: err.message
      };
    }
  }
  
  /**
   * Get templates for SMS messages
   * @returns {Promise<Object>} - SMS templates
   */
  async getSMSTemplates() {
    try {
      // Use direct URL approach
      const response = await this.directFetch('sms/templates', {
        method: 'GET'
      });
      
      console.log('SMS templates response:', response);
      
      if (response) {
        return response;
      }
      
      throw new Error('Failed to fetch SMS templates');
    } catch (error) {
      console.error('Failed to fetch SMS templates:', error);
      // Return default templates
      return { 
        status: 'success', 
        templates: {
          'order_confirmation_message': 'Your order #{order_number} has been confirmed. We\'ll notify you when it\'s ready!',
          'order_ready_message': 'Your order #{order_number} is now ready for pickup!',
          'delay_message': 'We apologize, but your order #{order_number} is running a bit behind schedule.'
        }
      };
    }
  }
  
  /**
   * Schedule a reminder SMS for an order
   * @param {Object} order - Order object
   */
  scheduleReminderSMS(order) {
    if (!order || !order.id) {
      console.warn('Cannot schedule reminder SMS: Invalid order');
      return;
    }
    
    // Cancel any existing reminder for this order
    this.cancelReminderSMS(order.id);
    
    console.log(`📅 Scheduling reminder SMS for order ${order.id} in ${this.settings.reminderDelay} seconds`);
    
    const timerId = setTimeout(async () => {
      try {
        // Check if order is still completed (not picked up)
        // This is a simple check - in a real system you'd query the current order status
        const isStillCompleted = !this.isOrderPickedUp(order.id);
        
        if (isStillCompleted) {
          const reminderMinutes = Math.floor(this.settings.reminderDelay / 60);
          await this.sendReminderNotification(order, reminderMinutes);
          console.log(`✅ Reminder SMS sent for order ${order.id}`);
        } else {
          console.log(`⏭️ Order ${order.id} was picked up, skipping reminder`);
        }
      } catch (error) {
        console.error(`❌ Failed to send reminder for order ${order.id}:`, error);
      } finally {
        // Clean up the timer reference
        this.reminderTimers.delete(order.id);
      }
    }, this.settings.reminderDelay * 1000);
    
    // Store the timer ID so we can cancel it later
    this.reminderTimers.set(order.id, timerId);
  }
  
  /**
   * Cancel a scheduled reminder SMS for an order
   * @param {string} orderId - Order ID
   */
  cancelReminderSMS(orderId) {
    if (this.reminderTimers.has(orderId)) {
      clearTimeout(this.reminderTimers.get(orderId));
      this.reminderTimers.delete(orderId);
      console.log(`🚫 Cancelled reminder SMS for order ${orderId}`);
    }
  }
  
  /**
   * Check if an order has been picked up (simple localStorage check)
   * @param {string} orderId - Order ID
   * @returns {boolean} - True if order has been picked up
   */
  isOrderPickedUp(orderId) {
    try {
      // Check if order exists in any "previous orders" cache (indicating it was picked up)
      for (let stationId = 1; stationId <= 5; stationId++) {
        const cacheKey = `orders_cache_station_${stationId}`;
        const cache = localStorage.getItem(cacheKey);
        if (cache) {
          const parsed = JSON.parse(cache);
          if (parsed.previousOrders && parsed.previousOrders.some(order => order.id === orderId)) {
            return true;
          }
        }
      }
      
      // Also check fallback previous orders
      const fallbackPrevious = localStorage.getItem('fallback_previous_orders');
      if (fallbackPrevious) {
        const parsed = JSON.parse(fallbackPrevious);
        if (parsed.some(order => order.id === orderId)) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error checking if order is picked up:', error);
      return false; // Assume not picked up on error
    }
  }
  
  /**
   * Method to call when an order is picked up to cancel pending reminders
   * @param {string} orderId - Order ID that was picked up
   */
  onOrderPickedUp(orderId) {
    console.log(`📦 Order ${orderId} picked up, cancelling any pending reminders`);
    this.cancelReminderSMS(orderId);
  }
  
  /**
   * Broadcast a message to all stations
   * Used by the enhanced schedule management system
   * @param {Object} messageData - Message data to broadcast
   * @returns {Promise<Object>} - Result with success status
   */
  async broadcastToStations(messageData) {
    try {
      // Dispatch a custom event that all station interfaces will listen for
      const broadcastEvent = new CustomEvent('stationBroadcast', {
        detail: {
          ...messageData,
          timestamp: new Date().toISOString(),
          source: 'organizer'
        }
      });
      
      window.dispatchEvent(broadcastEvent);
      
      // Also store in localStorage for stations that might not be listening yet
      const broadcasts = JSON.parse(localStorage.getItem('station_broadcasts') || '[]');
      broadcasts.unshift({
        ...messageData,
        timestamp: new Date().toISOString(),
        id: Date.now()
      });
      
      // Keep only last 50 broadcasts
      if (broadcasts.length > 50) {
        broadcasts.length = 50;
      }
      
      localStorage.setItem('station_broadcasts', JSON.stringify(broadcasts));
      
      console.log('Broadcast sent to all stations:', messageData);
      
      // If we have WebSocket support, also send via WebSocket
      try {
        await this.directFetch('stations/broadcast', {
          method: 'POST',
          body: JSON.stringify(messageData)
        });
      } catch (wsError) {
        console.warn('WebSocket broadcast failed, using local broadcast only:', wsError);
      }
      
      return { 
        success: true, 
        timestamp: new Date(),
        method: 'event_and_storage'
      };
    } catch (error) {
      console.error('Failed to broadcast to stations:', error);
      return { 
        success: false, 
        error: error.message
      };
    }
  }
}

// Export as singleton
export default new MessageService();
