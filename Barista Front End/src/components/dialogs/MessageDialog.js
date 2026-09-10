// components/dialogs/MessageDialog.js
//
// Texting one customer about one order — "your milk preference?", "running a
// few minutes behind". Separate from Broadcast, which reaches everyone.
import React, { useState, useEffect } from 'react';
import { Send, CheckCircle, AlertCircle, Clock, RefreshCw, MessageSquare } from 'lucide-react';
import MessageService from '../../services/MessageService';
import { Modal, Notice, Subject, Button } from '../../design';

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

  // Delivery state, in the same three colours the rest of the app uses for it.
  const getStatusIcon = (status) => {
    switch (status) {
      case 'sent':    return <CheckCircle size={16} className="text-cq-ready" />;
      case 'failed':  return <AlertCircle size={16} className="text-cq-alert" />;
      case 'sending': return <RefreshCw size={16} className="text-cq-warn animate-spin" />;
      case 'pending':
      default:        return <Clock size={16} className="text-cq-ink-3" />;
    }
  };

  return (
    <Modal
      title="Message customer"
      Icon={MessageSquare}
      onClose={onClose}
      busy={sending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button
            variant="primary"
            Icon={sending ? undefined : Send}
            onClick={handleSubmit}
            disabled={!message.trim() || sending}
          >
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </>
      }
    >
      {order && (
        <Subject title={`Order #${order.id} \u2014 ${order.customerName}`}>
          {order.phoneNumber}{' \u00b7 '}{order.coffeeType}, {order.milkType}
        </Subject>
      )}

      {messageHistory.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-extrabold uppercase tracking-wider text-cq-ink-3 mb-2">
            Already said
          </div>
          <div className="space-y-2 overflow-y-auto max-h-40">
            {messageHistory.map((msg) => (
              <div
                key={msg.messageId}
                className={`flex items-start gap-2 p-2.5 rounded-cq-md ${
                  msg.type === 'outgoing' ? 'bg-cq-caramel-wash' : 'bg-cq-wash'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-cq-roast break-words">{msg.text}</div>
                  <div className="text-xs text-cq-ink-3 mt-1">
                    {formatTime(msg.timestamp)}
                    {' \u00b7 '}
                    {msg.type === 'outgoing' ? 'Sent to customer' : 'Received'}
                  </div>
                </div>
                <div className="mt-0.5 flex-shrink-0">{getStatusIcon(msg.status)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <Notice tone="bad">{error}</Notice>}

      <form onSubmit={handleSubmit}>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows="4"
          placeholder="Type the message…"
          required
          disabled={sending}
          className="w-full rounded-cq-md border-2 border-cq-line bg-cq-milk p-3 text-base
                     leading-snug text-cq-roast placeholder:text-cq-ink-3 resize-none
                     focus:border-cq-caramel focus:outline-none disabled:opacity-50"
        />

        <div className="text-xs font-extrabold uppercase tracking-wider text-cq-ink-3 mt-4 mb-2">
          Or use one of these
        </div>
        <div className="grid grid-cols-2 gap-2">
          {quickMessages.map((template, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setMessage(template.text)}
              className="text-left text-sm font-semibold text-cq-ink-2 bg-cq-wash p-2.5
                         rounded-cq-md hover:bg-cq-caramel-wash hover:text-cq-roast
                         transition-colors"
            >
              {template.label}
            </button>
          ))}
        </div>
      </form>
    </Modal>
  );
};

export default MessageDialog;
