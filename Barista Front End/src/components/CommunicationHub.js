import React, { useState, useEffect } from 'react';
import { 
  MessageSquare, Phone, Mail, Bell, Send,
  Users, Clock, CheckCircle, AlertCircle,
  Filter, Search, MoreVertical, Zap
} from 'lucide-react';
import MessageService from '../services/MessageService';
import useOrders from '../hooks/useOrders';

/**
 * Communication Hub Component
 * Multi-channel communication management
 */
const CommunicationHub = () => {
  const { orders } = useOrders();
  const [activeChannel, setActiveChannel] = useState('sms'); // sms, staff, announcements
  const [messages, setMessages] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [templates, setTemplates] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Load messages and templates
  useEffect(() => {
    loadMessages();
    loadTemplates();
  }, [orders]); // Reload when orders change
  
  const loadMessages = async () => {
    try {
      // Get message history from MessageService (it's already a singleton)
      const messageHistory = MessageService.getAllHistory();
      
      // Convert message history to array format for display
      const allMessages = [];
      Object.entries(messageHistory).forEach(([orderId, messages]) => {
        const order = orders.find(o => o.id.toString() === orderId);
        messages.forEach(msg => {
          allMessages.push({
            id: `${orderId}-${msg.timestamp}`,
            orderId,
            customerName: order?.customer_name || 'Unknown',
            customerPhone: order?.phone || 'Unknown',
            message: msg.message,
            timestamp: new Date(msg.timestamp),
            type: msg.type || 'sent',
            status: msg.status || 'delivered'
          });
        });
      });
      
      // Sort by timestamp (newest first)
      allMessages.sort((a, b) => b.timestamp - a.timestamp);
      
      // Group messages by conversation
      const conversations = groupMessagesByConversation(allMessages);
      setMessages(conversations);
    } catch (error) {
      console.error('Error loading messages:', error);
      setMessages([]);
    }
  };
  
  const loadTemplates = async () => {
    try {
      // Get templates from MessageService
      const messageServiceInstance = new MessageService();
      const smsTemplates = await messageServiceInstance.getSMSTemplates();
      
      if (smsTemplates && smsTemplates.length > 0) {
        setTemplates(smsTemplates.map((template, index) => ({
          id: index + 1,
          name: template.name || `Template ${index + 1}`,
          message: template.template
        })));
      } else {
        // Use default templates as fallback
        const defaultTemplates = [
          { id: 1, name: 'Order Ready', message: 'Hi {name}, your {coffee} is ready for pickup at Station {station}!' },
          { id: 2, name: 'Wait Time Update', message: 'Hi {name}, your order will be ready in approximately {time} minutes.' },
          { id: 3, name: 'Queue Position', message: "You're currently #{position} in the queue at Station {station}." },
          { id: 4, name: 'Station Switch', message: 'Hi {name}, Station {alt_station} can prepare your order {time} minutes faster. Reply YES to switch.' },
          { id: 5, name: 'VIP Welcome', message: 'Welcome {name}! As a VIP, your order has priority status. Estimated wait: {time} minutes.' }
        ];
        setTemplates(defaultTemplates);
      }
    } catch (error) {
      console.error('Error loading templates:', error);
      // Use default templates on error
      const defaultTemplates = [
        { id: 1, name: 'Order Ready', message: 'Hi {name}, your {coffee} is ready for pickup at Station {station}!' },
        { id: 2, name: 'Wait Time Update', message: 'Hi {name}, your order will be ready in approximately {time} minutes.' }
      ];
      setTemplates(defaultTemplates);
    }
  };
  
  const groupMessagesByConversation = (messages) => {
    if (!messages || !Array.isArray(messages)) {
      return [];
    }
    
    const grouped = {};
    messages.forEach(msg => {
      const key = msg.phone || msg.order_id;
      if (!grouped[key]) {
        grouped[key] = {
          id: key,
          customer: msg.customer_name || 'Unknown',
          phone: msg.phone,
          lastMessage: msg.message,
          timestamp: msg.created_at,
          unread: msg.status === 'unread',
          messages: []
        };
      }
      grouped[key].messages.push(msg);
    });
    return Object.values(grouped).sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
  };
  
  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation) return;
    
    try {
      // Find the order for this conversation
      const order = orders.find(o => 
        o.phone === selectedConversation.phone || 
        o.customer_phone === selectedConversation.phone
      );
      
      if (order) {
        await MessageService.sendMessage(order, newMessage);
        
        setNewMessage('');
        // Wait a bit for the message to be saved to history
        setTimeout(() => {
          loadMessages(); // Reload to show new message
        }, 500);
      } else {
        console.error('No order found for this conversation');
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };
  
  const applyTemplate = (template) => {
    // Replace placeholders with actual data
    let message = template.message;
    if (selectedConversation) {
      const order = orders.find(o => o.customer_phone === selectedConversation.phone);
      if (order) {
        message = message
          .replace('{name}', order.customer_name)
          .replace('{coffee}', order.items?.[0]?.coffee_type || 'coffee')
          .replace('{station}', order.station_id || '1')
          .replace('{time}', '5')
          .replace('{position}', '3');
      }
    }
    setNewMessage(message);
  };
  
  const filteredConversations = messages.filter(conv =>
    conv.customer.toLowerCase().includes(searchTerm.toLowerCase()) ||
    conv.phone?.includes(searchTerm) ||
    conv.lastMessage.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  return (
    <div className="h-full flex flex-col">
      {/* Channel Tabs */}
      <div className="bg-white rounded-lg shadow-sm p-2 mb-4 flex space-x-2">
        <button
          onClick={() => setActiveChannel('sms')}
          className={`flex-1 py-2 px-4 rounded-md flex items-center justify-center space-x-2 ${
            activeChannel === 'sms' 
              ? 'bg-cyan-500 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <Phone className="w-4 h-4" />
          <span>SMS Messages</span>
        </button>
        <button
          onClick={() => setActiveChannel('staff')}
          className={`flex-1 py-2 px-4 rounded-md flex items-center justify-center space-x-2 ${
            activeChannel === 'staff' 
              ? 'bg-cyan-500 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Staff Chat</span>
        </button>
        <button
          onClick={() => setActiveChannel('announcements')}
          className={`flex-1 py-2 px-4 rounded-md flex items-center justify-center space-x-2 ${
            activeChannel === 'announcements' 
              ? 'bg-cyan-500 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>Announcements</span>
        </button>
      </div>
      
      {/* SMS Messages View */}
      {activeChannel === 'sms' && (
        <div className="flex-1 bg-white rounded-lg shadow-sm flex overflow-hidden">
          {/* Conversations List */}
          <div className="w-1/3 border-r">
            <div className="p-4 border-b">
              <div className="relative">
                <Search className="w-5 h-5 absolute left-3 top-2.5 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search conversations..."
                  className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
            </div>
            
            <div className="overflow-y-auto" style={{ height: 'calc(100% - 73px)' }}>
              {filteredConversations.map(conv => (
                <div
                  key={conv.id}
                  onClick={() => setSelectedConversation(conv)}
                  className={`p-4 border-b cursor-pointer hover:bg-gray-50 ${
                    selectedConversation?.id === conv.id ? 'bg-cyan-50' : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <h4 className="font-medium">{conv.customer}</h4>
                    <span className="text-xs text-gray-500">
                      {new Date(conv.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">{conv.phone}</p>
                  <p className="text-sm text-gray-500 truncate mt-1">{conv.lastMessage}</p>
                  {conv.unread && (
                    <span className="inline-block w-2 h-2 bg-cyan-500 rounded-full mt-1"></span>
                  )}
                </div>
              ))}
            </div>
          </div>
          
          {/* Conversation Detail */}
          <div className="flex-1 flex flex-col">
            {selectedConversation ? (
              <>
                {/* Header */}
                <div className="p-4 border-b bg-gray-50">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="font-semibold">{selectedConversation.customer}</h3>
                      <p className="text-sm text-gray-600">{selectedConversation.phone}</p>
                    </div>
                    <button className="p-2 hover:bg-gray-200 rounded">
                      <MoreVertical className="w-5 h-5 text-gray-600" />
                    </button>
                  </div>
                </div>
                
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {selectedConversation.messages.map((msg, index) => (
                    <div
                      key={index}
                      className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-xs p-3 rounded-lg ${
                        msg.direction === 'outbound' 
                          ? 'bg-cyan-500 text-white' 
                          : 'bg-gray-100 text-gray-900'
                      }`}>
                        <p className="text-sm">{msg.message}</p>
                        <p className={`text-xs mt-1 ${
                          msg.direction === 'outbound' ? 'text-cyan-100' : 'text-gray-500'
                        }`}>
                          {new Date(msg.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Templates */}
                <div className="p-3 border-t bg-gray-50">
                  <p className="text-xs font-medium text-gray-600 mb-2">Quick Templates:</p>
                  <div className="flex flex-wrap gap-2">
                    {templates.map(template => (
                      <button
                        key={template.id}
                        onClick={() => applyTemplate(template)}
                        className="px-3 py-1 text-xs bg-white border rounded-full hover:bg-gray-100"
                      >
                        {template.name}
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Message Input */}
                <div className="p-4 border-t">
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                      placeholder="Type a message..."
                      className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                    <button
                      onClick={sendMessage}
                      disabled={!newMessage.trim()}
                      className="px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <MessageSquare className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  <p>Select a conversation to view messages</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Staff Chat View */}
      {activeChannel === 'staff' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="text-center py-12">
            <Users className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-600 mb-2">Staff Communication</h3>
            <p className="text-gray-500">Real-time staff messaging coming soon...</p>
            <p className="text-sm text-gray-400 mt-2">
              Enable instant communication between baristas, managers, and support staff
            </p>
          </div>
        </div>
      )}
      
      {/* Announcements View */}
      {activeChannel === 'announcements' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-4">Broadcast Announcements</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button className="p-6 border-2 border-dashed rounded-lg hover:bg-gray-50 text-left">
                <Bell className="w-8 h-8 text-amber-500 mb-3" />
                <h4 className="font-semibold mb-1">All Customers</h4>
                <p className="text-sm text-gray-600">
                  Send updates to all customers with pending orders
                </p>
              </button>
              
              <button className="p-6 border-2 border-dashed rounded-lg hover:bg-gray-50 text-left">
                <Zap className="w-8 h-8 text-blue-500 mb-3" />
                <h4 className="font-semibold mb-1">VIP Customers</h4>
                <p className="text-sm text-gray-600">
                  Send priority messages to VIP customers only
                </p>
              </button>
              
              <button className="p-6 border-2 border-dashed rounded-lg hover:bg-gray-50 text-left">
                <Clock className="w-8 h-8 text-green-500 mb-3" />
                <h4 className="font-semibold mb-1">Delayed Orders</h4>
                <p className="text-sm text-gray-600">
                  Notify customers experiencing wait times over 15min
                </p>
              </button>
              
              <button className="p-6 border-2 border-dashed rounded-lg hover:bg-gray-50 text-left">
                <AlertCircle className="w-8 h-8 text-red-500 mb-3" />
                <h4 className="font-semibold mb-1">Emergency Alert</h4>
                <p className="text-sm text-gray-600">
                  Send urgent messages to all active customers
                </p>
              </button>
            </div>
          </div>
          
          {/* Recent Announcements */}
          <div>
            <h4 className="font-medium mb-3">Recent Broadcasts</h4>
            <div className="space-y-2">
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="flex justify-between items-start mb-1">
                  <p className="font-medium text-sm">System Maintenance Alert</p>
                  <span className="text-xs text-gray-500">2 hours ago</span>
                </div>
                <p className="text-sm text-gray-600">Sent to 45 customers</p>
              </div>
              
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="flex justify-between items-start mb-1">
                  <p className="font-medium text-sm">Special Offer: Free Size Upgrade</p>
                  <span className="text-xs text-gray-500">Yesterday</span>
                </div>
                <p className="text-sm text-gray-600">Sent to 128 VIP customers</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommunicationHub;