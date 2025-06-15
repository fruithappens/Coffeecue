// notification-handler.js - Improved notification system with better error handling

import OrderDataService from './OrderDataService';
import MessageService from './MessageService';
import authService from './auth-service';
import antiFlickerProtection from './anti-flicker';

/**
 * Enhanced notification system for customer notifications
 * with improved error handling and fallback mechanisms
 */
class NotificationHandler {
  constructor() {
    this.successRate = {
      total: 0,
      success: 0
    };
    this.lastNotificationTime = null;
    this.retryDelay = 1000; // 1 second initial delay
    this.maxRetries = 3;
    this.debugMode = true;
    
    // Initialize display notification handler
    this.setupDisplayNotificationListener();
  }
  
  /**
   * Setup listener for display notifications
   */
  setupDisplayNotificationListener() {
    window.addEventListener('showOrderOnDisplay', event => {
      try {
        const { orderId, orderNumber, customerName, coffeeType, status } = event.detail;
        console.log(`Showing order ${orderId} (${orderNumber}) for ${customerName} on display screen`);
        
        // Here we would handle showing the order on a physical display
        // This is a placeholder for that functionality
        const displayEvent = new CustomEvent('orderDisplayed', {
          detail: { orderId, success: true }
        });
        window.dispatchEvent(displayEvent);
      } catch (error) {
        console.error('Error handling display notification:', error);
      }
    });
  }
  
  /**
   * Send customer notification when order is ready
   * using a multi-layered fallback approach
   * 
   * @param {Object} order - Order object
   * @returns {Promise<Object>} Notification result
   */
  async sendReadyNotification(order) {
    if (!order) {
      throw new Error('Invalid order: cannot be null or undefined');
    }
    
    // Start tracking metrics
    this.successRate.total++;
    this.lastNotificationTime = Date.now();
    
    // Normalize order object if only ID is provided
    const orderObj = this.normalizeOrderObject(order);
    
    if (this.debugMode) {
      console.log('Sending ready notification for order:', orderObj);
    }
    
    let result = null;
    let error = null;
    let attempts = 0;
    
    // Try the multi-layered notification approach
    while (attempts < this.maxRetries && !result) {
      attempts++;
      
      try {
        // Attempt 1: Use MessageService (dedicated messaging service)
        if (this.debugMode) {
          console.log(`Attempt ${attempts}/3: Using MessageService...`);
        }
        
        result = await MessageService.sendReadyNotification(orderObj);
        
        if (result && result.success) {
          if (this.debugMode) {
            console.log('MessageService notification succeeded!');
          }
          break;
        }
      } catch (messageServiceError) {
        error = messageServiceError;
        console.error('MessageService notification failed:', messageServiceError);
        
        // Wait before retry
        await this.sleep(this.retryDelay * attempts);
        
        try {
          // Attempt 2: Use OrderDataService's notification method
          if (this.debugMode) {
            console.log(`Attempt ${attempts}/3: Using OrderDataService...`);
          }
          
          result = await OrderDataService.sendReadyNotification(orderObj);
          
          if (result && result.success) {
            if (this.debugMode) {
              console.log('OrderDataService notification succeeded!');
            }
            break;
          }
        } catch (orderServiceError) {
          error = orderServiceError;
          console.error('OrderDataService notification failed:', orderServiceError);
          
          // Wait before retry
          await this.sleep(this.retryDelay * attempts);
          
          try {
            // Attempt 3: Direct message as last resort
            if (this.debugMode) {
              console.log(`Attempt ${attempts}/3: Using direct message...`);
            }
            
            // Construct a basic message
            const message = `🔔 YOUR COFFEE IS READY! Your ${orderObj.coffeeType || 'coffee'} is now ready for collection. Enjoy! ☕`;
            
            result = await OrderDataService.sendMessageToCustomer(
              orderObj.id,
              message
            );
            
            if (result && (result.success === true || !Object.prototype.hasOwnProperty.call(result, 'success'))) {
              if (this.debugMode) {
                console.log('Direct message notification succeeded!');
              }
              break;
            }
          } catch (directMessageError) {
            error = directMessageError;
            console.error('Direct message notification failed:', directMessageError);
          }
        }
      }
    }
    
    // Handle final result
    if (result && result.success) {
      this.successRate.success++;
      
      // Also try to show on display (this is non-blocking)
      this.showOnDisplay(orderObj).catch(displayError => {
        console.error('Error showing order on display:', displayError);
      });
      
      return {
        success: true,
        message: result.message || 'Notification sent successfully',
        method: result.method || 'multi_method',
        attempts
      };
    } else {
      // All attempts failed, return the last error
      console.error(`All notification attempts failed after ${attempts} tries:`, error);
      
      // Still try to show on display as last resort
      this.showOnDisplay(orderObj).catch(displayError => {
        console.error('Error showing order on display:', displayError);
      });
      
      return {
        success: false,
        error: error?.message || 'Unknown error during notification',
        attempts
      };
    }
  }
  
  /**
   * Show an order on the display screen
   * @param {Object} order - Order object
   * @returns {Promise<Object>} Result with success status
   */
  async showOnDisplay(order) {
    try {
      // Dispatch event to display the order
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
      
      return { success: true };
    } catch (error) {
      console.error('Failed to show order on display:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Sleep for a specific duration
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Normalize order object to ensure consistent structure
   * @param {string|Object} order - Order ID or order object
   * @returns {Object} Normalized order object
   */
  normalizeOrderObject(order) {
    if (typeof order === 'string') {
      // If only ID is provided, create minimal order object
      return {
        id: order,
        orderNumber: order
      };
    } else if (order && (order.id || order.orderNumber || order.order_number)) {
      // Return consistent object with known properties
      return {
        id: order.id || order.orderNumber || order.order_number,
        orderNumber: order.orderNumber || order.order_number || order.id,
        customerName: order.customerName || order.customer_name || 'Customer',
        phoneNumber: order.phoneNumber || order.phone_number || order.phone || '',
        coffeeType: order.coffeeType || order.coffee_type || 'Coffee',
        stationName: order.stationName || order.station_name || ''
      };
    } else {
      throw new Error('Invalid order: missing ID');
    }
  }
  
  /**
   * Get notification success metrics
   * @returns {Object} Success rate metrics
   */
  getSuccessMetrics() {
    return {
      ...this.successRate,
      successRate: this.successRate.total > 0 
        ? (this.successRate.success / this.successRate.total * 100).toFixed(2) + '%'
        : '0%',
      lastNotification: this.lastNotificationTime ? new Date(this.lastNotificationTime).toISOString() : null
    };
  }
  
  /**
   * Reset success metrics
   */
  resetMetrics() {
    this.successRate = {
      total: 0,
      success: 0
    };
    this.lastNotificationTime = null;
  }
}

// Export singleton
const notificationHandler = new NotificationHandler();
export default notificationHandler;
