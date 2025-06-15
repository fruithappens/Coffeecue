// Example BaristaInterface.js implementation using the new services

// Import statements
import React, { useState, useEffect } from 'react';
import NotificationService from '../services/NotificationService';
import { useNotification } from './NotificationSystem';
import ConfigService from '../services/ConfigService';
import OrderDataService from '../services/OrderDataService';

// Just the handleCompleteOrder method as an example
const handleCompleteOrder = async (orderId) => {
  try {
    console.log('Starting order completion process for order:', orderId);
    
    // Get the notification API
    const { showSuccess, showError } = useNotification();
    
    // First find the order before it gets moved to completed
    const orderToComplete = inProgressOrders.find(o => o.id === orderId);
    
    if (!orderToComplete) {
      console.error('Could not find order in inProgressOrders array:', orderId);
      showError('Could not find the order details. Please try again.');
      return false;
    }
    
    // Find the actual station info from the stations list
    const stationInfo = stations.find(s => s.id === selectedStation);
    
    // Add station name to the order for notifications
    const orderWithStation = {
      ...orderToComplete,
      stationName: stationInfo ? stationInfo.name : settings.stationName
    };
    
    console.log('Prepared order object for notification:', orderWithStation);
    
    // First complete the order using the existing function from useOrders
    const result = await completeOrder(orderId);
    console.log('Complete order API result:', result);
    
    // Check if the result has a success property or define success
    const isOrderCompleteSuccess = result && (result.success === true || 
      !Object.prototype.hasOwnProperty.call(result, 'success'));
    
    if (isOrderCompleteSuccess) {
      console.log('Order marked as complete in backend. Sending notification...');
      
      // Use our new NotificationService for reliable delivery
      const notificationResult = await NotificationService.sendNotification(orderWithStation);
      
      // Update message status UI to reflect notification status
      setMessageStatus(prev => ({
        ...prev,
        [orderId]: { 
          status: notificationResult.success ? 'sent' : 'failed', 
          error: notificationResult.success ? null : (notificationResult.message || 'Failed to send notification'),
          timestamp: new Date() 
        }
      }));
      
      return true;
    } else {
      console.error('Failed to complete order in backend');
      showError('Failed to complete the order. Please try again.');
    }
    
    return false;
  } catch (err) {
    console.error('Error completing order with notifications:', err);
    // useNotification hook needs to be used inside a function component
    // since this is just an example, we're not using it here
    return false;
  }
};

// Example of how this would be used in a React component
const OrderActions = ({ order }) => {
  const { showSuccess, showError } = useNotification();
  
  const handleComplete = async () => {
    try {
      // First complete the order in the backend
      const result = await OrderDataService.completeOrder(order.id);
      
      if (!result.success) {
        showError("Failed to complete order. Please try again.");
        return;
      }
      
      // Then send notification using the centralized service
      const notificationResult = await NotificationService.sendNotification(order);
      
      if (notificationResult.success) {
        showSuccess(`Order completed and notification sent to ${order.customerName}`);
      } else {
        showSuccess(`Order completed but notification failed: ${notificationResult.message}`);
      }
    } catch (error) {
      showError(`Error: ${error.message}`);
    }
  };
  
  return (
    <button 
      className="mt-3 w-full bg-green-500 text-white py-3 rounded-lg font-bold text-lg hover:bg-green-600"
      onClick={handleComplete}
    >
      COMPLETE ORDER
    </button>
  );
};

// Example of using the notification system in a component
const NotificationExample = () => {
  const { showSuccess, showError, showWarning, showInfo } = useNotification();
  
  return (
    <div className="space-y-2">
      <button 
        className="px-4 py-2 bg-green-500 text-white rounded-md"
        onClick={() => showSuccess("Order completed successfully!")}
      >
        Show Success
      </button>
      
      <button 
        className="px-4 py-2 bg-red-500 text-white rounded-md"
        onClick={() => showError("Failed to complete order.")}
      >
        Show Error
      </button>
      
      <button 
        className="px-4 py-2 bg-yellow-500 text-white rounded-md"
        onClick={() => showWarning("Running low on milk.")}
      >
        Show Warning
      </button>
      
      <button 
        className="px-4 py-2 bg-blue-500 text-white rounded-md"
        onClick={() => showInfo("New orders synced with backend.")}
      >
        Show Info
      </button>
    </div>
  );
};

export { handleCompleteOrder, OrderActions, NotificationExample };