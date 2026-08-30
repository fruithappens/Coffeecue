import React, { useState, useEffect, useRef } from 'react';
import EventWordingCard from './EventWordingCard';
import EventAccessCard from './EventAccessCard';
import { 
  MessageSquare, Phone, Mail, Bell, Smartphone,
  Send, User, Clock, CheckCircle, AlertCircle,
  Filter, Search, Settings, Download, RefreshCw,
  Radio, Wifi, WifiOff, ChevronRight, Zap,
  Target, Users, BarChart3, TrendingUp
} from 'lucide-react';
import MessageService from '../../services/MessageService';
import useOrders from '../../hooks/useOrders';
import useSettings from '../../hooks/useSettings';
import ApiServiceClass from '../../services/ApiService';

const api = new ApiServiceClass();

/**
 * Enhanced Communication Hub Integration
 * Multi-channel communication management system with advanced features
 */
// The GSM-7 alphabet. A message made only of these fits 160 characters a
// segment; one character outside it (an emoji, a curly quote, an em dash)
// switches the whole message to UCS-2 at 70 characters a segment, so it
// costs twice as much to send. Worth flagging before a few hundred go out.
const GSM7 = new Set(
  ('@\u00A3$\u00A5\u00E8\u00E9\u00F9\u00EC\u00F2\u00C7\n\u00D8\u00F8\r\u00C5\u00E5\u0394_\u03A6\u0393\u039B\u03A9\u03A0\u03A8\u03A3\u0398\u039E\u00C6\u00E6\u00DF\u00C9'
   + ' !"#\u00A4%&\'()*+,-./0123456789:;<=>?'
   + '\u00A1ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00C4\u00D6\u00D1\u00DC\u00A7'
   + '\u00BFabcdefghijklmnopqrstuvwxyz\u00E4\u00F6\u00F1\u00FC\u00E0'
   + '\f^{}\\[~]|\u20AC').split('')
);

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
  // Real broadcast state. The "New Broadcast" button used to open a
  // modal that didn't exist (dead button). Now it opens a working modal
  // wired to POST /api/support/broadcast/customers (audience-targeted,
  // capped at 500 recipients server-side, with a dry-run preview).
  const [bcMessage, setBcMessage] = useState('');
  const [bcAudience, setBcAudience] = useState('today');
  const [bcSending, setBcSending] = useState(false);
  const [bcResult, setBcResult] = useState(null);

  const runBroadcast = async (dryRun) => {
    if (!bcMessage.trim()) { setBcResult({ ok: false, msg: 'Enter a message first.' }); return; }
    setBcSending(true); setBcResult(null);
    try {
      const r = await api.request('/support/broadcast/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: bcMessage.trim(), audience: bcAudience, dry_run: dryRun }),
      });
      // Endpoint returns {status:'success', recipient_count} on dry-run
      // and {status:'success', sent, failed, capped} on a real send.
      const okStatus = r && (r.status === 'success' || r.dry_run || typeof r.sent === 'number');
      if (okStatus) {
        if (dryRun) {
          const n = r.recipient_count ?? 0;
          setBcResult({ ok: true,
            msg: `${n} recipient(s) would receive this (${bcAudience})${r.capped ? ', capped at 500' : ''}. Not sent yet.` });
        } else {
          setBcResult({ ok: true,
            msg: `Sent to ${r.sent ?? 0}${r.failed ? `, ${r.failed} failed` : ''} recipient(s).` });
        }
      } else {
        setBcResult({ ok: false, msg: r?.message || r?.error || 'Broadcast failed' });
      }
    } catch (e) {
      setBcResult({ ok: false, msg: e?.message || 'Broadcast failed' });
    } finally {
      setBcSending(false);
    }
  };
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
  
  // Load message templates.
  //
  // This used to fetch the real templates and then THROW THE RESULT AWAY,
  // rendering six hardcoded ones instead -- with invented usage counts
  // ("1247 uses" was a number somebody typed). Anyone reading this screen
  // was being shown wording the system does not send and statistics that
  // were never measured.
  const loadTemplates = async () => {
    try {
      const resp = await MessageService.getSMSTemplates();
      const raw = (resp && resp.templates) || {};
      // Readable names for the keys the backend actually stores. Anything
      // new the backend grows shows up under its own key rather than
      // being dropped, which is how the previous version hid things.
      const NAMES = {
        sms_welcome_message: 'First reply to a new customer',
        sms_ready_message: 'Order ready',
        sms_started_message: 'Order started',
        order_confirmation_message: 'Order confirmed',
        delay_message: 'Order delayed',
        sponsor_message: 'Sponsor line',
      };
      const prettify = (key) => NAMES[key]
        || key.replace(/_/g, ' ').replace(/^sms /, '').replace(/^./, c => c.toUpperCase());

      setTemplates(Object.entries(raw).map(([key, text], i) => ({
        id: key,
        key,
        name: prettify(key),
        channel: 'sms',
        template: String(text || ''),
        // A template nobody has set is not empty behaviour -- the system
        // falls back to wording built into the code. Say so, because
        // "blank" reads as "no message is sent".
        unset: !String(text || '').trim(),
        // Any character outside the GSM-7 set turns the whole message
        // into UCS-2, which halves the characters per segment and so
        // doubles what it costs to send. Worth seeing before you send a
        // few hundred of them.
        costly: !String(text || '').split('').every(ch => GSM7.has(ch)),
        variables: [...String(text || '').matchAll(/\{(\w+)\}/g)].map(m => m[1]),
      })));
    } catch (error) {
      console.error('Error loading templates:', error);
      setTemplates([]);
    }
  };
  
  // Scheduled broadcasts.
  //
  // This used to render three invented ones, including a "Station 2
  // Closure" marked SENT to 234 recipients. On a support screen that is
  // the worst kind of fake: someone reading it would believe messages had
  // gone out. There is no scheduled-broadcast store behind this yet, so
  // it now says so rather than making one up. The live broadcast notice
  // (the one baristas actually send) has its own dialog and its own
  // storage.
  const loadBroadcasts = () => {
    setBroadcasts([]);
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
      {/* Sponsor line + venue cafe name -- the editable SMS wording.
          Lives here because this is where the operator thinks about
          messages; the backend reads these fresh per send. */}
      <EventWordingCard />
      <div className="mt-4"><EventAccessCard /></div>

      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
          <h2 className="text-xl font-semibold">Communication Hub</h2>

          <div className="flex flex-wrap items-center gap-3">
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
        <div className="flex space-x-1 border-b overflow-x-auto">
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
          
          <div className="flex flex-col sm:flex-row sm:h-96">
            {/* Conversation List */}
            <div className="w-full max-h-56 sm:max-h-none sm:w-1/3 border-b sm:border-b-0 sm:border-r overflow-y-auto">
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
                      {template.costly && (
                        <span className="text-xs text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 whitespace-nowrap"
                              title="Contains a character outside the plain SMS set (usually an emoji or a dash). That doubles the cost of every send.">
                          costs double
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-600 mb-2">
                      {template.unset
                        ? <em className="text-gray-400">Not set — the built-in wording is used</em>
                        : template.template}
                    </p>
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
            
            {broadcasts.length === 0 && (
              <p className="text-sm text-gray-500">
                Nothing scheduled. To tell everyone waiting something now, use
                <strong> Tell waiting customers</strong> on the barista screen.
              </p>
            )}
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
            {/* removed hardcoded "+12% vs yesterday" — no day-over-day
                comparison is computed. */}
          </div>
          
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <p className="text-3xl font-bold text-green-600">
              {messages.length === 0
                ? '\u2014'
                : `${((messages.filter(m => m.status === 'delivered').length / messages.length) * 100).toFixed(1)}%`}
            </p>
            <p className="text-sm text-gray-600">Delivery Rate</p>
            {/* "Above target" was printed unconditionally, under a NaN%
                whenever no messages had been sent yet. A number that can
                be NaN must not carry a verdict that is always good. */}
            <p className="text-xs text-gray-400 mt-1">
              {messages.length === 0 ? 'nothing sent yet' : `of ${messages.length} sent`}
            </p>
          </div>
          
          <div className="text-center p-4 bg-amber-50 rounded-lg">
            <p className="text-3xl font-bold text-amber-600">—</p>
            <p className="text-sm text-gray-600">Avg Response Time</p>
            <p className="text-xs text-gray-400 mt-1">not yet measured</p>
          </div>

          <div className="text-center p-4 bg-purple-50 rounded-lg">
            <p className="text-3xl font-bold text-purple-600">—</p>
            <p className="text-sm text-gray-600">Satisfaction Score</p>
            <p className="text-xs text-gray-400 mt-1">no feedback pipeline yet</p>
          </div>
        </div>
      </div>

      {/* Broadcast modal — sends a real SMS to a customer audience via
          POST /api/support/broadcast/customers (server caps at 500). */}
      {showBroadcastModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold flex items-center">
                <Radio className="mr-2 text-amber-600" size={20} /> New broadcast
              </h3>
              <button onClick={() => { setShowBroadcastModal(false); setBcResult(null); }}
                      className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <label className="block text-sm text-gray-600 mb-1">Audience</label>
            <select
              value={bcAudience}
              onChange={e => setBcAudience(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded mb-3"
            >
              <option value="today">Everyone who ordered today</option>
              <option value="active_today">Today's customers with an open order</option>
              <option value="in_progress">Only orders being made now</option>
            </select>
            <label className="block text-sm text-gray-600 mb-1">Message</label>
            <textarea
              value={bcMessage}
              onChange={e => setBcMessage(e.target.value)}
              rows={3}
              maxLength={480}
              placeholder="e.g. Coffee service wraps up in 15 minutes — last orders now!"
              className="w-full px-3 py-2 border border-gray-300 rounded mb-1"
            />
            <p className="text-xs text-gray-400 mb-3">{bcMessage.length}/480 — capped at 500 recipients per send.</p>
            {bcResult && (
              <div className={`mb-3 text-sm px-3 py-2 rounded ${bcResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {bcResult.msg}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => runBroadcast(true)}
                disabled={bcSending}
                className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-100 text-gray-700 disabled:opacity-50"
              >
                Preview recipients
              </button>
              <button
                onClick={() => runBroadcast(false)}
                disabled={bcSending || !bcMessage.trim()}
                className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 flex items-center gap-2"
              >
                {bcSending ? (<><RefreshCw size={16} className="animate-spin" /> Sending…</>) : (<><Send size={16} /> Send broadcast</>)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnhancedCommunicationHub;