// components/dialogs/MessageDialog.js
import React, { useState, useEffect } from 'react';
import { XCircle, Send, CheckCircle, AlertCircle, Clock, RefreshCw } from 'lucide-react';
import MessageService from '../../services/MessageService';

const MessageDialog = ({ order, onSubmit, onClose }) => {
  const [message, setMessage] = useState('');
  const [messageHistory, setMessageHistory] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  // Load message history when dialog opens
  useEffect(() => {
    if (order && order.id) {
      // Load message history for this order
      const history = MessageService.getHistory(order.id);
      setMessageHistory(history);
    }
  }, [order]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!message.trim()) return;
    
    // Reset error state
    setError(null);
    setSending(true);
    
    try {
      console.log(`Sending message for order ${order.id}: ${message}`);
      
      // Call the onSubmit handler from props (this will be handleSendMessage from BaristaInterface)
      const result = await onSubmit(order.id, message);
      
      console.log('Message sending result:', result);
      
      // Clear the message input on success
      if (result && result.success) {
        setMessage('');
        
        // Force refresh history with a small delay to allow backend to update
        setTimeout(() => {
          const updatedHistory = MessageService.getHistory(order.id);
          setMessageHistory(updatedHistory);
          console.log('Updated message history:', updatedHistory);
        }, 500);
        
      } else if (result && !result.success) {
        setError(result.error || 'Failed to send message');
        console.error('Failed to send message:', result.error);
      } else {
        // Handle unexpected result format
        console.error('Unexpected result format from message sending:', result);
        setError('Unexpected response from server');
      }
    } catch (err) {
      console.error('Error sending message:', err);
      setError(err.message || 'An error occurred while sending the message');
    } finally {
      setSending(false);
    }
  };

  // Quick message templates
  const quickMessages = [
    {
      label: 'Ready for pickup',
      text: `Your ${order?.coffeeType || 'coffee'} is ready for pickup at ${order?.stationName || 'our station'}.`
    },
    {
      label: 'Slight delay',
      text: `We're running slightly behind schedule. Your ${order?.coffeeType || 'coffee'} will be ready in about 5 more minutes.`
    },
    {
      label: 'Reminder to collect',
      text: `Your ${order?.coffeeType || 'coffee'} order has been waiting for pickup. Please collect it from ${order?.stationName || 'our station'}.`
    },
    {
      label: 'Confirm milk preference',
      text: "Could you please confirm your milk preference for this order?"
    }
  ];

  // Format timestamp for display
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Get status icon based on message status
  const getStatusIcon = (status) => {
    switch (status) {
      case 'sent':
        return <CheckCircle size={16} className="text-green-500" />;
      case 'failed':
        return <AlertCircle size={16} className="text-red-500" />;
      case 'sending':
        return <RefreshCw size={16} className="text-amber-500 animate-spin" />;
      case 'pending':
      default:
        return <Clock size={16} className="text-gray-500" />;
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">Message Customer</h3>
          <button 
            className="text-gray-500 hover:text-gray-700"
            onClick={onClose}
          >
            <XCircle size={20} />
          </button>
        </div>
        
        {order && (
          <div className="mb-4 bg-gray-100 p-3 rounded">
            <div className="font-medium">Order #{order.id}</div>
            <div>{order.customerName} - {order.phoneNumber}</div>
            <div className="text-sm">{order.coffeeType}, {order.milkType}</div>
          </div>
        )}
        
        {/* Message History Section */}
        {messageHistory.length > 0 && (
          <div className="mb-4 overflow-y-auto max-h-40 border border-gray-200 rounded p-2">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Message History</h4>
            <div className="space-y-2">
              {messageHistory.map((msg) => (
                <div 
                  key={msg.messageId} 
                  className={`flex items-start p-2 rounded ${
                    msg.type === 'outgoing' ? 'bg-blue-50' : 'bg-gray-50'
                  }`}
                >
                  <div className="flex-grow">
                    <div className="text-sm">{msg.text}</div>
                    <div className="text-xs text-gray-500 flex items-center mt-1">
                      {formatTime(msg.timestamp)} 
                      <span className="mx-1">•</span>
                      {msg.type === 'outgoing' ? 'Sent to customer' : 'Received'}
                    </div>
                  </div>
                  <div className="ml-2 mt-1">
                    {getStatusIcon(msg.status)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Error message if any */}
        {error && (
          <div className="mb-4 bg-red-50 text-red-700 p-2 rounded border border-red-200 text-sm flex items-center">
            <AlertCircle size={16} className="mr-1" />
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="flex-grow flex flex-col">
          <div className="mb-4 flex-grow">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Message
            </label>
            <textarea 
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full p-2 border rounded resize-none flex-grow"
              rows="4"
              placeholder="Enter your message here..."
              required
            ></textarea>
          </div>
          
          <div className="mb-4">
            <div className="text-sm text-gray-500">Quick Messages:</div>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {quickMessages.map((template, index) => (
                <button 
                  key={index}
                  type="button"
                  className="text-left text-xs bg-gray-100 p-2 rounded hover:bg-gray-200"
                  onClick={() => setMessage(template.text)}
                >
                  {template.label}
                </button>
              ))}
            </div>
          </div>
          
          <div className="flex justify-end space-x-2">
            <button 
              type="button"
              className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
              onClick={onClose}
            >
              Cancel
            </button>
            <button 
              type="submit"
              className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 flex items-center"
              disabled={!message.trim() || sending}
            >
              {sending ? <RefreshCw size={16} className="mr-1 animate-spin" /> : <Send size={16} className="mr-1" />}
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MessageDialog;