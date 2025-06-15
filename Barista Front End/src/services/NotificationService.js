// services/NotificationService.js
import OrderDataService from './OrderDataService';
import MessageService from './MessageService';

class NotificationService {
  constructor() {
    this.attemptHistory = {};
    this.debugMode = true;
  }
  
  /**
   * Send a notification to a customer with maximum reliability using multiple fallbacks
   * @param {Object|string} order - Order object or ID
   * @param {string} [customMessage] - Optional custom message. If not provided, a default "ready" message is used
   * @returns {Promise<Object>} - Result with success status
   */
  async sendNotification(order, customMessage = null) {
    // Create an ID for this notification attempt for tracking
    const attemptId = Date.now();
    const startTime = Date.now();
    
    try {
      // First, ensure we have a proper order object
      const orderObject = this._normalizeOrderObject(order);
      if (!orderObject || !orderObject.id) {
        throw new Error('Invalid order: missing ID or object');
      }
      
      const orderId = orderObject.id;
      this.logDebug(`Starting notification for order ${orderId} [${attemptId}]`);
      
      // Create a default message if none provided
      const message = customMessage || this._createDefaultMessage(orderObject);
      
      // Track this attempt
      this.attemptHistory[orderId] = {
        attemptId,
        orderId,
        message,
        attempts: [],
        startTime,
        success: false
      };
      
      // Try multiple notification methods in sequence until one succeeds
      const attemptsConfig = [
        { method: 'MessageService.sendReadyNotification', execute: () => MessageService.sendReadyNotification(orderObject) },
        { method: 'OrderDataService.sendReadyNotification', execute: () => OrderDataService.sendReadyNotification(orderObject) },
        { method: 'MessageService.sendMessage', execute: () => MessageService.sendMessage(orderObject, message) },
        { method: 'OrderDataService.sendMessageToCustomer', execute: () => OrderDataService.sendMessageToCustomer(orderId, message) }
      ];
      
      // Try each method until one succeeds
      for (const attempt of attemptsConfig) {
        try {
          this.logDebug(`Attempting ${attempt.method} for order ${orderId}`);
          const result = await attempt.execute();
          
          // Record this attempt
          this.attemptHistory[orderId].attempts.push({
            method: attempt.method,
            timestamp: Date.now(),
            success: result && (result.success === true || !Object.prototype.hasOwnProperty.call(result, 'success')),
            result
          });
          
          // If successful, return early
          if (result && (result.success === true || !Object.prototype.hasOwnProperty.call(result, 'success'))) {
            this.logDebug(`${attempt.method} succeeded for order ${orderId}`);
            this.attemptHistory[orderId].success = true;
            this.attemptHistory[orderId].completedTime = Date.now();
            
            // For global notification, we'll use window.notificationSystem if available
            if (window.notificationSystem && window.notificationSystem.success) {
              window.notificationSystem.success(`Notification sent to ${orderObject.customerName || 'customer'}`);
            }
            
            return {
              success: true,
              method: attempt.method,
              timeTaken: Date.now() - startTime,
              message: `Notification sent successfully via ${attempt.method}`
            };
          }
          
          this.logDebug(`${attempt.method} failed for order ${orderId}`);
        } catch (error) {
          this.logDebug(`${attempt.method} threw error for order ${orderId}: ${error.message}`);
          
          // Record this attempt
          this.attemptHistory[orderId].attempts.push({
            method: attempt.method,
            timestamp: Date.now(),
            success: false,
            error: error.message
          });
        }
      }
      
      // If we reached here, all attempts failed
      this.logDebug(`All notification attempts failed for order ${orderId}`);
      this.attemptHistory[orderId].completedTime = Date.now();
      
      // For global notification, we'll use window.notificationSystem if available
      if (window.notificationSystem && window.notificationSystem.error) {
        window.notificationSystem.error(`Failed to send notification to ${orderObject.customerName || 'customer'}`);
      }
      
      return {
        success: false,
        timeTaken: Date.now() - startTime,
        message: 'All notification attempts failed'
      };
    } catch (error) {
      this.logDebug(`Error in sendNotification: ${error.message}`);
      
      // For global notification, we'll use window.notificationSystem if available
      if (window.notificationSystem && window.notificationSystem.error) {
        window.notificationSystem.error(`Notification error: ${error.message}`);
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Create a default "order ready" message
   * @param {Object} order - Order object
   * @returns {string} - Message text
   */
  _createDefaultMessage(order) {
    return `🔔 YOUR COFFEE IS READY! Your ${order.coffeeType || 'coffee'} is now ready for collection${order.stationName ? ` at ${order.stationName}` : ''}. Enjoy! ☕`;
  }
  
  /**
   * Ensure we have a consistent order object
   * @param {Object|string} order - Order object or ID
   * @returns {Object} - Normalized order object
   */
  _normalizeOrderObject(order) {
    if (!order) return null;
    
    // If it's already an object with required fields, return it
    if (typeof order === 'object' && order.id) {
      return order;
    }
    
    // If it's a string (order ID), create a minimal order object
    if (typeof order === 'string') {
      return {
        id: order,
        orderNumber: order
      };
    }
    
    return null;
  }
  
  /**
   * Log debug messages if debug mode is enabled
   * @param {string} message - Debug message
   */
  logDebug(message) {
    if (this.debugMode) {
      console.log(`[NotificationService] ${message}`);
    }
  }
  
  /**
   * Get history of notification attempts for an order
   * @param {string} orderId - Order ID
   * @returns {Object} - Attempt history for this order
   */
  getAttemptHistory(orderId) {
    return this.attemptHistory[orderId] || null;
  }
}

// Export as singleton
export default new NotificationService();