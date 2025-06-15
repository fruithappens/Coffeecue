// hooks/useMessages.js
import { useState, useEffect, useCallback } from 'react';
import OrderDataService from '../services/OrderDataService';

/**
 * Custom hook for managing customer messages
 * Provides message history, sending functions, and status tracking
 */
export default function useMessages() {
  // State for message history
  const [messages, setMessages] = useState([]);
  // State for loading messages
  const [loading, setLoading] = useState(true);
  // Selected order for filtering messages
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  // State for tracking the connection status
  const [connectionStatus, setConnectionStatus] = useState(OrderDataService.connectionStatus);
  // State for tracking sending status
  const [sending, setSending] = useState(false);

  // Load initial messages
  useEffect(() => {
    const loadMessages = () => {
      // Get all messages or filtered by order ID
      const history = OrderDataService.getMessageHistory(selectedOrderId);
      setMessages(history);
      setLoading(false);
    };

    loadMessages();
    
    // Set up polling to refresh messages every 30 seconds
    const interval = setInterval(loadMessages, 30000);
    
    // Subscribe to connection status changes
    const unsubscribe = OrderDataService.addListener(newStatus => {
      setConnectionStatus(newStatus);
    });
    
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [selectedOrderId]);

  // Send a new message
  const sendMessage = useCallback(async (orderId, messageText) => {
    setSending(true);
    try {
      const result = await OrderDataService.sendMessageToCustomer(orderId, messageText);
      
      // Reload messages to get the updated status
      const updatedHistory = OrderDataService.getMessageHistory(selectedOrderId);
      setMessages(updatedHistory);
      
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error("Failed to send message:", error);
      
      // Reload messages to see the failed status
      const updatedHistory = OrderDataService.getMessageHistory(selectedOrderId);
      setMessages(updatedHistory);
      
      return { success: false, error: error.message };
    } finally {
      setSending(false);
    }
  }, [selectedOrderId]);

  // Retry sending a failed message
  const retryMessage = useCallback(async (messageId) => {
    setSending(true);
    try {
      const success = await OrderDataService.retryMessage(messageId);
      
      // Reload messages to get the updated status
      const updatedHistory = OrderDataService.getMessageHistory(selectedOrderId);
      setMessages(updatedHistory);
      
      return { success };
    } catch (error) {
      console.error("Failed to retry message:", error);
      return { success: false, error: error.message };
    } finally {
      setSending(false);
    }
  }, [selectedOrderId]);

  // Clear message history
  const clearHistory = useCallback(() => {
    if (window.confirm('Are you sure you want to clear all message history? This cannot be undone.')) {
      OrderDataService.clearMessageHistory();
      setMessages([]);
    }
  }, []);

  // Filter message history by order
  const filterByOrder = useCallback((orderId = null) => {
    setSelectedOrderId(orderId);
  }, []);

  // Group messages by order
  const messagesByOrder = useCallback(() => {
    const grouped = {};
    
    messages.forEach(msg => {
      if (!grouped[msg.orderId]) {
        grouped[msg.orderId] = [];
      }
      grouped[msg.orderId].push(msg);
    });
    
    // Sort each group by timestamp (newest first)
    Object.keys(grouped).forEach(orderId => {
      grouped[orderId].sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
      );
    });
    
    return grouped;
  }, [messages]);

  // Get messages for a specific order
  const getMessagesForOrder = useCallback((orderId) => {
    return messages.filter(msg => msg.orderId === orderId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [messages]);

  // Get counts of message statuses
  const getStatusCounts = useCallback(() => {
    return messages.reduce((counts, msg) => {
      counts[msg.status] = (counts[msg.status] || 0) + 1;
      return counts;
    }, {});
  }, [messages]);

  return {
    // Data
    messages,
    messagesByOrder: messagesByOrder(),
    statusCounts: getStatusCounts(),
    loading,
    sending,
    connectionStatus,
    
    // Actions
    sendMessage,
    retryMessage,
    clearHistory,
    filterByOrder,
    getMessagesForOrder,
    
    // Helper
    setSelectedOrderId
  };
}
