import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, Phone, Mail, Bell, Smartphone,
  Send, User, Clock, CheckCircle, AlertCircle,
  Filter, Search, Settings, Download, RefreshCw,
  Radio, Wifi, WifiOff, ChevronRight, Zap,
  Target, Users, BarChart3, TrendingUp
} from 'lucide-react';
import MessageService from '../services/MessageService';
import useOrders from '../hooks/useOrders';
import useSettings from '../hooks/useSettings';

/**
 * Enhanced Communication Hub Integration
 * Multi-channel communication management system with advanced features
 */
const EnhancedCommunicationHub = () => {
  const { orders, loading: ordersLoading, error: ordersError } = useOrders();
  const { settings } = useSettings();
  
  // Debug logging
  useEffect(() => {
    console.log('EnhancedCommunicationHub: Orders state update', {
      orders: orders ? 'loaded' : 'not loaded',
      ordersType: typeof orders,
      ordersIsArray: Array.isArray(orders),
      ordersKeys: orders && typeof orders === 'object' ? Object.keys(orders) : 'N/A',
      ordersLoading,
      ordersError
    });
  }, [orders, ordersLoading, ordersError]);
  const [activeChannel, setActiveChannel] = useState('all');
  const [messages, setMessages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [broadcasts, setBroadcasts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const messageEndRef = useRef(null);
  
  // Channel configurations
  const channels = [
    { id: 'sms', name: 'SMS', icon: Smartphone, color: 'blue', enabled: true },
    { id: 'email', name: 'Email', icon: Mail, color: 'green', enabled: true },
    { id: 'push', name: 'Push', icon: Bell, color: 'purple', enabled: true },
    { id: 'voice', name: 'Voice', icon: Phone, color: 'amber', enabled: false },
    { id: 'whatsapp', name: 'WhatsApp', icon: MessageSquare, color: 'emerald', enabled: false }
  ];
  
  // Load data on mount
  useEffect(() => {
    loadMessages();
    loadTemplates();
    loadBroadcasts();
    
    // Refresh messages every 10 seconds
    const interval = setInterval(loadMessages, 10000);
    return () => clearInterval(interval);
  }, [orders]);
  
  // Load messages from MessageService
  const loadMessages = async () => {
    try {
      const messageHistory = MessageService.getAllHistory();
      const allMessages = [];
      
      // Safety check: ensure orders exists
      if (!orders) {
        console.log('EnhancedCommunicationHub: Waiting for orders data to load...');
        return;
      }
      
      // Handle both array and object formats
      let ordersArray = orders;
      if (!Array.isArray(orders)) {
        // If orders is an object with different status arrays, combine them
        ordersArray = [
          ...(orders.pending || []),
          ...(orders.inProgress || []),
          ...(orders.completed || [])
        ];
      }
      
      if (ordersArray.length === 0) {
        console.log('EnhancedCommunicationHub: No orders available yet');
        return;
      }
      
      Object.entries(messageHistory).forEach(([orderId, msgs]) => {
        const order = ordersArray?.find(o => o.id?.toString() === orderId);
        msgs.forEach(msg => {
          allMessages.push({
            id: `${orderId}-${msg.timestamp}`,
            channel: msg.channel || 'sms',
            recipient: order?.phone || msg.recipient || 'Unknown',
            customerName: order?.customer_name || 'Customer',
            message: msg.message,
            status: msg.status || 'delivered',
            timestamp: new Date(msg.timestamp),
            order: order?.order_number || orderId,
            type: msg.type || 'outbound'
          });
        });
      });
      
      // Sort by newest first
      allMessages.sort((a, b) => b.timestamp - a.timestamp);
      setMessages(allMessages);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };
  
  // Load message templates
  const loadTemplates = async () => {
    try {
      const smsTemplates = await MessageService.getSMSTemplates();
      
      // Enhanced templates with multiple channels
      const enhancedTemplates = [
        {
          id: 1,
          name: 'Order Ready',
          channel: 'sms',
          template: 'Hi {name}, your {coffee} is ready for pickup at {station}! ☕',
          variables: ['name', 'coffee', 'station'],
          usage: 1247
        },
        {
          id: 2,
          name: 'Queue Update',
          channel: 'sms',
          template: 'Your order is #{position} in queue. Est. wait: {wait} mins ⏱️',
          variables: ['position', 'wait'],
          usage: 892
        },
        {
          id: 3,
          name: 'Welcome Email',
          channel: 'email',
          template: 'Welcome to Coffee Cue! Your first order gets 10% off. 🎉',
          variables: [],
          usage: 234
        },
        {
          id: 4,
          name: 'Order Delayed',
          channel: 'push',
          template: 'Sorry for the delay! Your order will be ready in {time} mins',
          variables: ['time'],
          usage: 45
        },
        {
          id: 5,
          name: 'VIP Fast Track',
          channel: 'sms',
          template: 'VIP Fast Track: Skip to Station {station} for immediate service! 🌟',
          variables: ['station'],
          usage: 89
        },
        {
          id: 6,
          name: 'Loyalty Reward',
          channel: 'email',
          template: 'Congrats {name}! You\'ve earned a free {reward}. Use code: {code}',
          variables: ['name', 'reward', 'code'],
          usage: 156
        }
      ];
      
      setTemplates(enhancedTemplates);
    } catch (error) {
      console.error('Error loading templates:', error);
    }
  };
  
  // Load scheduled broadcasts
  const loadBroadcasts = () => {
    // Mock broadcasts - in production, load from API
    setBroadcasts([
      {
        id: 1,
        name: 'Morning Rush Alert',
        channels: ['sms', 'push'],
        audience: 'All waiting customers',
        message: '☕ High demand this morning! Your patience is appreciated. Est. +5min wait.',
        scheduled: new Date(Date.now() + 60 * 60000),
        status: 'scheduled',
        recipients: 45,
        filters: { waitTime: '>10' }
      },
      {
        id: 2,
        name: 'Happy Hour Promo',
        channels: ['email', 'push'],
        audience: 'Loyalty members',
        message: '🎉 Happy Hour: 50% off all drinks 3-5 PM today!',
        scheduled: new Date(Date.now() + 3 * 60 * 60000),
        status: 'scheduled',
        recipients: 234,
        filters: { customerType: 'loyalty' }
      },
      {
        id: 3,
        name: 'Station 2 Closure',
        channels: ['sms'],
        audience: 'Station 2 queue',
        message: 'Station 2 temporarily closed. You\'ve been moved to Station 1.',
        scheduled: null,
        status: 'sent',
        recipients: 12,
        sentAt: new Date(Date.now() - 30 * 60000)
      }
    ]);
  };
  
  // Auto-scroll to latest message
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  // Filter messages
  const filteredMessages = messages.filter(msg => {
    const matchesSearch = 
      msg.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      msg.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (msg.order && msg.order.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesStatus = filterStatus === 'all' || msg.status === filterStatus;
    const matchesChannel = activeChannel === 'all' || msg.channel === activeChannel;
    
    return matchesSearch && matchesStatus && matchesChannel;
  });
  
  // Send message function
  const sendMessage = async (channel, recipient, message, variables = {}) => {
    // Replace variables in template
    let finalMessage = message;
    Object.entries(variables).forEach(([key, value]) => {
      finalMessage = finalMessage.replace(`{${key}}`, value);
    });
    
    const newMessage = {
      id: Date.now(),
      channel,
      recipient,
      customerName: variables.name || 'Customer',
      message: finalMessage,
      status: 'sending',
      timestamp: new Date(),
      order: variables.order || null
    };
    
    setMessages(prev => [newMessage, ...prev]);
    
    // Send via MessageService if SMS
    if (channel === 'sms' && selectedConversation) {
      const order = orders.find(o => o.phone === recipient);
      if (order) {
        await MessageService.sendMessage(order, finalMessage);
      }
    }
    
    // Simulate delivery for other channels
    setTimeout(() => {
      setMessages(prev => prev.map(msg => 
        msg.id === newMessage.id 
          ? { ...msg, status: Math.random() > 0.1 ? 'delivered' : 'failed' }
          : msg
      ));
    }, 2000);
  };
  
  // Apply template
  const applyTemplate = (template) => {
    if (!selectedConversation) return;
    
    const order = orders.find(o => o.phone === selectedConversation.recipient);
    if (!order) return;
    
    // Replace variables with actual data
    let message = template.template;
    const variables = {
      name: order.customer_name || 'Customer',
      coffee: order.items?.[0]?.coffee_type || 'coffee',
      station: order.station_id || '1',
      wait: Math.floor(Math.random() * 10 + 5),
      position: Math.floor(Math.random() * 5 + 1),
      time: Math.floor(Math.random() * 10 + 5)
    };
    
    Object.entries(variables).forEach(([key, value]) => {
      message = message.replace(`{${key}}`, value);
    });
    
    setNewMessage(message);
  };
  
  // Get status color
  const getStatusColor = (status) => {
    switch (status) {
      case 'delivered': return 'text-green-600 bg-green-50';
      case 'sent': return 'text-blue-600 bg-blue-50';
      case 'sending': return 'text-amber-600 bg-amber-50';
      case 'failed': return 'text-red-600 bg-red-50';
      case 'scheduled': return 'text-purple-600 bg-purple-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };
  
  // Get channel color
  const getChannelColor = (channelId) => {
    const channel = channels.find(c => c.id === channelId);
    return channel ? channel.color : 'gray';
  };
  
  // Group messages by conversation
  const conversations = React.useMemo(() => {
    const grouped = {};
    
    filteredMessages.forEach(msg => {
      const key = msg.recipient;
      if (!grouped[key]) {
        grouped[key] = {
          id: key,
          recipient: msg.recipient,
          customerName: msg.customerName,
          lastMessage: msg.message,
          lastTimestamp: msg.timestamp,
          unreadCount: 0,
          messages: []
        };
      }
      
      grouped[key].messages.push(msg);
      if (msg.timestamp > grouped[key].lastTimestamp) {
        grouped[key].lastMessage = msg.message;
        grouped[key].lastTimestamp = msg.timestamp;
      }
      if (msg.type === 'inbound' && msg.status === 'unread') {
        grouped[key].unreadCount++;
      }
    });
    
    return Object.values(grouped).sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  }, [filteredMessages]);
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Communication Hub</h2>
          
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 text-sm">
              <Wifi className="w-4 h-4 text-green-500" />
              <span className="text-gray-600">All channels online</span>
            </div>
            
            <button 
              onClick={() => setShowBroadcastModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
            >
              <Radio className="w-4 h-4" />
              <span>New Broadcast</span>
            </button>
          </div>
        </div>
        
        {/* Channel Tabs */}
        <div className="flex space-x-1 border-b">
          <button
            onClick={() => setActiveChannel('all')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeChannel === 'all'
                ? 'text-gray-900 border-gray-900'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            All Channels
          </button>
          
          {channels.map(channel => (
            <button
              key={channel.id}
              onClick={() => setActiveChannel(channel.id)}
              disabled={!channel.enabled}
              className={`px-4 py-2 font-medium border-b-2 transition-colors flex items-center space-x-2 ${
                activeChannel === channel.id
                  ? `text-${channel.color}-600 border-${channel.color}-600`
                  : channel.enabled
                    ? 'text-gray-500 border-transparent hover:text-gray-700'
                    : 'text-gray-300 cursor-not-allowed'
              }`}
            >
              <channel.icon className="w-4 h-4" />
              <span>{channel.name}</span>
              {!channel.enabled && <span className="text-xs">(Soon)</span>}
            </button>
          ))}
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Conversations List */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm">
          <div className="p-4 border-b">
            <div className="flex items-center space-x-3">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search messages..."
                  className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              {/* Status Filter */}
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Status</option>
                <option value="delivered">Delivered</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
              </select>
              
              <button className="p-2 hover:bg-gray-100 rounded-lg">
                <RefreshCw className="w-5 h-5 text-gray-600" />
              </button>
            </div>
          </div>
          
          <div className="flex h-96">
            {/* Conversation List */}
            <div className="w-1/3 border-r overflow-y-auto">
              {conversations.map(conv => (
                <div
                  key={conv.id}
                  onClick={() => setSelectedConversation(conv)}
                  className={`p-4 border-b cursor-pointer hover:bg-gray-50 ${
                    selectedConversation?.id === conv.id ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <h4 className="font-medium">{conv.customerName}</h4>
                    <span className="text-xs text-gray-500">
                      {conv.lastTimestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">{conv.recipient}</p>
                  <p className="text-sm text-gray-500 truncate">{conv.lastMessage}</p>
                  {conv.unreadCount > 0 && (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 mt-1">
                      {conv.unreadCount} new
                    </span>
                  )}
                </div>
              ))}
            </div>
            
            {/* Message Thread */}
            <div className="flex-1 flex flex-col">
              {selectedConversation ? (
                <>
                  {/* Header */}
                  <div className="p-4 border-b bg-gray-50">
                    <h3 className="font-semibold">{selectedConversation.customerName}</h3>
                    <p className="text-sm text-gray-600">{selectedConversation.recipient}</p>
                  </div>
                  
                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {selectedConversation.messages.map(msg => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.type === 'outbound' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className={`max-w-xs ${
                          msg.type === 'outbound' ? 'order-2' : ''
                        }`}>
                          <div className={`p-3 rounded-lg ${
                            msg.type === 'outbound'
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-100'
                          }`}>
                            <p className="text-sm">{msg.message}</p>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {msg.timestamp.toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                    ))}
                    <div ref={messageEndRef} />
                  </div>
                  
                  {/* Input */}
                  <div className="p-4 border-t">
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage('sms', selectedConversation.recipient, newMessage);
                            setNewMessage('');
                          }
                        }}
                        placeholder="Type a message..."
                        className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={() => {
                          sendMessage('sms', selectedConversation.recipient, newMessage);
                          setNewMessage('');
                        }}
                        disabled={!newMessage.trim()}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
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
                    <p>Select a conversation</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Right Sidebar */}
        <div className="space-y-6">
          {/* Quick Templates */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold mb-4">Quick Templates</h3>
            
            <div className="space-y-2">
              {templates
                .filter(t => activeChannel === 'all' || t.channel === activeChannel)
                .slice(0, 5)
                .map(template => (
                  <div 
                    key={template.id}
                    className="border rounded-lg p-3 hover:bg-gray-50 cursor-pointer"
                    onClick={() => applyTemplate(template)}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <h4 className="font-medium text-sm">{template.name}</h4>
                      <span className="text-xs text-gray-500">{template.usage} uses</span>
                    </div>
                    <p className="text-xs text-gray-600 mb-2">{template.template}</p>
                    <div className="flex items-center justify-between">
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs bg-${getChannelColor(template.channel)}-100 text-${getChannelColor(template.channel)}-700`}>
                        {template.channel}
                      </span>
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </div>
                  </div>
                ))}
            </div>
          </div>
          
          {/* Scheduled Broadcasts */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold mb-4">Broadcasts</h3>
            
            <div className="space-y-3">
              {broadcasts.slice(0, 3).map(broadcast => (
                <div key={broadcast.id} className="border rounded-lg p-3">
                  <h4 className="font-medium text-sm mb-1">{broadcast.name}</h4>
                  <p className="text-xs text-gray-600 mb-2">{broadcast.message}</p>
                  
                  <div className="flex items-center justify-between text-xs">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full ${getStatusColor(broadcast.status)}`}>
                      {broadcast.status}
                    </span>
                    <span className="text-gray-500">
                      {broadcast.recipients} recipients
                    </span>
                  </div>
                  
                  {broadcast.scheduled && (
                    <p className="text-xs text-gray-500 mt-2">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {broadcast.scheduled.toLocaleTimeString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* Communication Stats */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4">Communication Analytics</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <p className="text-3xl font-bold text-blue-600">
              {messages.filter(m => m.timestamp > new Date(Date.now() - 24*60*60*1000)).length}
            </p>
            <p className="text-sm text-gray-600">Messages Today</p>
            <p className="text-xs text-blue-600 mt-1">
              <TrendingUp className="w-3 h-3 inline" /> +12% vs yesterday
            </p>
          </div>
          
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <p className="text-3xl font-bold text-green-600">
              {((messages.filter(m => m.status === 'delivered').length / messages.length) * 100).toFixed(1)}%
            </p>
            <p className="text-sm text-gray-600">Delivery Rate</p>
            <p className="text-xs text-green-600 mt-1">Above target</p>
          </div>
          
          <div className="text-center p-4 bg-amber-50 rounded-lg">
            <p className="text-3xl font-bold text-amber-600">1.8s</p>
            <p className="text-sm text-gray-600">Avg Response Time</p>
            <p className="text-xs text-amber-600 mt-1">Within SLA</p>
          </div>
          
          <div className="text-center p-4 bg-purple-50 rounded-lg">
            <p className="text-3xl font-bold text-purple-600">4.8</p>
            <p className="text-sm text-gray-600">Satisfaction Score</p>
            <p className="text-xs text-purple-600 mt-1">Based on feedback</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnhancedCommunicationHub;