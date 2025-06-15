// components/MessageHistory.js
import React, { useState, useEffect } from 'react';
import { Check, X, RefreshCw, ChevronDown, ChevronUp, MessageCircle, AlertTriangle, Clock } from 'lucide-react';
import { useNotification } from './NotificationSystem';

const MessageHistory = ({ 
  messages = [], 
  onRetry,
  onClearHistory,
  isLoading = false,
  sending = false,
  compact = false
}) => {
  const [isExpanded, setIsExpanded] = useState(!compact);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const { success, error } = useNotification();
  
  // Count of messages by status
  const failedCount = messages.filter(m => m.status === 'failed').length;
  const pendingCount = messages.filter(m => m.status === 'sending').length;
  
  // Format relative time
  const formatRelativeTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return date.toLocaleDateString();
  };
  
  // Group messages by order ID
  const groupedMessages = {};
  messages.forEach(message => {
    if (!groupedMessages[message.orderId]) {
      groupedMessages[message.orderId] = [];
    }
    groupedMessages[message.orderId].push(message);
  });
  
  // Sort order IDs by most recent message
  const sortedOrderIds = Object.keys(groupedMessages).sort((a, b) => {
    const aLatest = new Date(groupedMessages[a][0].timestamp);
    const bLatest = new Date(groupedMessages[b][0].timestamp);
    return bLatest - aLatest;
  });
  
  // Handle retry
  const handleRetry = async (messageId) => {
    try {
      const result = await onRetry(messageId);
      if (result.success) {
        success('Message retry initiated');
      } else {
        error('Failed to retry message');
      }
    } catch (err) {
      error(`Error: ${err.message}`);
    }
  };
  
  // Get the status icon
  const getStatusIcon = (status) => {
    switch (status) {
      case 'sent':
        return <Check size={16} className="text-green-500" />;
      case 'failed':
        return <X size={16} className="text-red-500" />;
      case 'sending':
        return <RefreshCw size={16} className="text-blue-500 animate-spin" />;
      default:
        return <Clock size={16} className="text-gray-500" />;
    }
  };
  
  // Empty state
  if (!isLoading && messages.length === 0) {
    return (
      <div className="bg-white rounded shadow p-4 text-center text-gray-500">
        <MessageCircle size={24} className="mx-auto mb-2" />
        <p>No messages have been sent yet</p>
      </div>
    );
  }
  
  return (
    <div className="bg-white rounded shadow">
      {/* Header with expand/collapse */}
      <div 
        className="p-3 border-b border-gray-200 flex justify-between items-center cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="font-bold flex items-center">
          <MessageCircle size={18} className="mr-2" />
          Message History 
          {failedCount > 0 && (
            <span className="ml-2 text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">
              {failedCount} failed
            </span>
          )}
          {pendingCount > 0 && (
            <span className="ml-2 text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">
              {pendingCount} sending
            </span>
          )}
        </div>
        <div className="flex items-center">
          {messages.length > 0 && (
            <span className="text-sm text-gray-500 mr-2">
              {messages.length} message{messages.length !== 1 ? 's' : ''}
            </span>
          )}
          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </div>
      
      {/* Loading state */}
      {isLoading && (
        <div className="p-4 text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-500 mx-auto"></div>
          <p className="mt-2 text-gray-500">Loading messages...</p>
        </div>
      )}
      
      {/* Message list */}
      {isExpanded && !isLoading && (
        <>
          <div className="max-h-64 overflow-y-auto">
            {sortedOrderIds.map(orderId => {
              const orderMessages = groupedMessages[orderId];
              const latestMessage = orderMessages[0]; // Messages are already sorted newest first
              const orderDetails = latestMessage.orderDetails || {};
              
              return (
                <div key={orderId} className="border-b border-gray-100 last:border-0">
                  {/* Order header */}
                  <div 
                    className={`p-3 hover:bg-gray-50 cursor-pointer ${selectedOrderId === orderId ? 'bg-blue-50' : ''}`}
                    onClick={() => setSelectedOrderId(selectedOrderId === orderId ? null : orderId)}
                  >
                    <div className="flex justify-between">
                      <div className="font-medium">
                        Order #{orderId.replace('order_', '')} - {orderDetails.customerName || 'Customer'}
                      </div>
                      <div className="text-gray-500 text-sm">
                        {formatRelativeTime(latestMessage.timestamp)}
                      </div>
                    </div>
                    <div className="text-sm text-gray-600 truncate">
                      {latestMessage.message}
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <div className="text-xs text-gray-500">
                        {orderDetails.coffeeType} {orderDetails.phoneNumber ? `- ${orderDetails.phoneNumber}` : ''}
                      </div>
                      <div className="flex items-center">
                        {orderMessages.some(m => m.status === 'failed') && (
                          <span className="text-xs bg-red-100 text-red-700 px-1 py-0.5 rounded mr-1 flex items-center">
                            <AlertTriangle size={12} className="mr-1" /> Failed
                          </span>
                        )}
                        <ChevronDown 
                          size={16} 
                          className={`transform transition-transform ${selectedOrderId === orderId ? 'rotate-180' : ''}`}
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* Order message list (only shown when expanded) */}
                  {selectedOrderId === orderId && (
                    <div className="bg-gray-50 p-3 border-t border-gray-100">
                      <h4 className="text-xs font-medium text-gray-500 mb-2">MESSAGE HISTORY</h4>
                      <div className="space-y-2">
                        {orderMessages.map(message => (
                          <div 
                            key={message.id} 
                            className={`p-2 rounded text-sm ${
                              message.status === 'failed' ? 'bg-red-50 border border-red-100' : 
                              message.status === 'sending' ? 'bg-blue-50 border border-blue-100' : 
                              'bg-white border border-gray-100'
                            }`}
                          >
                            <div className="flex justify-between">
                              <div className="font-medium">{message.message}</div>
                              <div className="flex items-center">
                                {getStatusIcon(message.status)}
                                <span className="text-xs text-gray-500 ml-1">
                                  {new Date(message.timestamp).toLocaleTimeString()}
                                </span>
                              </div>
                            </div>
                            
                            {message.status === 'failed' && (
                              <div className="mt-1 flex justify-end">
                                <button
                                  className="text-xs bg-blue-500 text-white px-2 py-1 rounded flex items-center"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRetry(message.id);
                                  }}
                                  disabled={sending}
                                >
                                  {sending ? (
                                    <>
                                      <RefreshCw size={12} className="animate-spin mr-1" />
                                      Retrying...
                                    </>
                                  ) : (
                                    <>
                                      <RefreshCw size={12} className="mr-1" />
                                      Retry
                                    </>
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          
          {/* Footer with clear history button */}
          <div className="p-2 border-t border-gray-200 flex justify-end">
            <button 
              className="text-xs text-gray-500 hover:text-red-500 px-2 py-1"
              onClick={onClearHistory}
            >
              Clear History
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default MessageHistory;
