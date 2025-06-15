// barista-interface-notification.js - Enhanced notification methods for BaristaInterface
// These methods should be integrated into the BaristaInterface component

import OrderDataService from '../services/OrderDataService';
import MessageService from '../services/MessageService';
import notificationHandler from '../services/notification-handler';

/**
 * Handle order completion with reliable notification
 * This replaces the handleCompleteOrder method in BaristaInterface
 * 
 * @param {string} orderId - Order ID
 * @returns {Promise<Object>} Completion result
 */
async handleCompleteOrder(orderId) {
  try {
    // 1. Update UI to indicate order is being processed
    this.setState({ processingOrder: orderId });
    
    // 2. First mark the order as completed with the backend
    const result = await OrderDataService.completeOrder(orderId);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to complete order');
    }
    
    console.log('Order completed successfully:', result);
    
    // 3. Get the completed order details to send notification
    // We need to find the order in our state first
    let orderToNotify = null;
    
    const pendingOrders = [...this.state.pendingOrders];
    const inProgressOrders = [...this.state.inProgressOrders];
    
    // Lookup in in-progress orders first (most likely location)
    const orderIndex = inProgressOrders.findIndex(order => 
      order.id === orderId || 
      `order_in_progress_${order.id}` === orderId || 
      order.id === `order_in_progress_${orderId}`
    );
    
    if (orderIndex !== -1) {
      orderToNotify = inProgressOrders[orderIndex];
      // Remove from in-progress orders in the UI
      inProgressOrders.splice(orderIndex, 1);
    } else {
      // If not found in in-progress, check pending (unlikely but possible)
      const pendingIndex = pendingOrders.findIndex(order => 
        order.id === orderId || 
        `order_${order.id}` === orderId || 
        order.id === `order_${orderId}`
      );
      
      if (pendingIndex !== -1) {
        orderToNotify = pendingOrders[pendingIndex];
        // Remove from pending orders in the UI
        pendingOrders.splice(pendingIndex, 1);
      }
    }
    
    // If we still don't have the order, do a lookup
    if (!orderToNotify) {
      try {
        const orderLookup = await OrderDataService.getOrderDetails(orderId);
        if (orderLookup && (orderLookup.id || orderLookup.order_id)) {
          orderToNotify = orderLookup;
        }
      } catch (lookupError) {
        console.error('Failed to lookup order for notification:', lookupError);
        // Continue with limited information
        orderToNotify = { id: orderId };
      }
    }
    
    // 4. Send notification using our enhanced notification handler
    const notificationResult = await notificationHandler.sendReadyNotification(orderToNotify);
    
    // 5. Update the UI state
    const newCompletedOrders = [
      { 
        ...orderToNotify, 
        status: 'completed', 
        completedAt: new Date()
      }, 
      ...this.state.completedOrders
    ];
    
    this.setState({
      pendingOrders,
      inProgressOrders,
      completedOrders: newCompletedOrders,
      processingOrder: null,
      notificationStatus: notificationResult.success ? 'success' : 'error',
      notificationMessage: notificationResult.success 
        ? `Order completed and notification sent (method: ${notificationResult.method})`
        : `Order completed but notification failed: ${notificationResult.error}`
    });
    
    // 6. Set a timeout to clear the notification message
    setTimeout(() => {
      this.setState({
        notificationStatus: null,
        notificationMessage: null
      });
    }, 5000);
    
    // 7. Return the combined result
    return {
      success: true,
      notificationSuccess: notificationResult.success,
      message: 'Order completed successfully',
      notificationDetails: notificationResult
    };
  } catch (error) {
    console.error('Error completing order:', error);
    
    // Update UI to show error
    this.setState({
      processingOrder: null,
      notificationStatus: 'error',
      notificationMessage: `Error completing order: ${error.message}`
    });
    
    // Clear error message after timeout
    setTimeout(() => {
      this.setState({
        notificationStatus: null,
        notificationMessage: null
      });
    }, 5000);
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Send manual message to customer
 * This replaces the handleSendMessage method in BaristaInterface
 * 
 * @param {string} orderId - Order ID
 * @param {string} message - Message content
 * @returns {Promise<Object>} Message sending result
 */
async handleSendMessage(orderId, message) {
  try {
    if (!orderId || !message) {
      throw new Error('Order ID and message are required');
    }
    
    // Update UI to indicate message is being sent
    this.setState({ sendingMessage: orderId });
    
    // Find the order in our state to get customer details
    let orderToMessage = null;
    const allOrders = [
      ...this.state.pendingOrders,
      ...this.state.inProgressOrders,
      ...this.state.completedOrders
    ];
    
    orderToMessage = allOrders.find(order => 
      order.id === orderId || 
      `order_${order.id}` === orderId || 
      `order_in_progress_${order.id}` === orderId ||
      `order_completed_${order.id}` === orderId ||
      order.id === `order_${orderId}` ||
      order.id === `order_in_progress_${orderId}` ||
      order.id === `order_completed_${orderId}`
    );
    
    let result;
    
    // Try MessageService first (most reliable)
    try {
      if (orderToMessage) {
        result = await MessageService.sendMessage(orderToMessage, message);
      } else {
        result = await MessageService.sendMessage(orderId, message);
      }
    } catch (messageServiceError) {
      console.error('MessageService failed, falling back to OrderDataService:', messageServiceError);
      
      // Fallback to OrderDataService
      result = await OrderDataService.sendMessageToCustomer(orderId, message);
    }
    
    // Update UI with result
    this.setState({
      sendingMessage: null,
      notificationStatus: result.success ? 'success' : 'error',
      notificationMessage: result.success 
        ? 'Message sent successfully' 
        : `Failed to send message: ${result.error || 'Unknown error'}`
    });
    
    // Clear notification after timeout
    setTimeout(() => {
      this.setState({
        notificationStatus: null,
        notificationMessage: null
      });
    }, 5000);
    
    return result;
  } catch (error) {
    console.error('Error sending message:', error);
    
    // Update UI to show error
    this.setState({
      sendingMessage: null,
      notificationStatus: 'error',
      notificationMessage: `Error sending message: ${error.message}`
    });
    
    // Clear error message after timeout
    setTimeout(() => {
      this.setState({
        notificationStatus: null,
        notificationMessage: null
      });
    }, 5000);
    
    return {
      success: false,
      error: error.message
    };
  }
}
