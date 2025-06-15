// components/StationChat.js
import React, { useState, useEffect, useRef } from 'react';
import { XCircle, RefreshCw, AlertTriangle, ChevronDown, Edit, Save, User } from 'lucide-react';
import ChatService from '../services/ChatService';

const StationChat = ({ onClose, onMessageRead, stations, currentStationId, currentStationName, baristaName = "Barista", onBaristaNameChange }) => {
  // Use the current station as default if not explicitly provided
  const [selectedStationId, setSelectedStationId] = useState(currentStationId);
  
  // Debug: Log when selectedStationId changes
  useEffect(() => {
    console.log(`StationChat - selectedStationId changed to: ${selectedStationId}, type: ${typeof selectedStationId}`);
  }, [selectedStationId]);
  
  // Debug: Log when currentStationId prop changes
  useEffect(() => {
    console.log(`StationChat - currentStationId prop changed to: ${currentStationId}, type: ${typeof currentStationId}`);
    // Update selectedStationId when currentStationId changes
    if (currentStationId !== selectedStationId) {
      setSelectedStationId(currentStationId);
    }
  }, [currentStationId, selectedStationId]);
  const [showStationSelector, setShowStationSelector] = useState(false);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [messageType, setMessageType] = useState('normal');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  
  // New state for barista name editing
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedBaristaName, setEditedBaristaName] = useState(baristaName);
  
  // Update editedBaristaName when baristaName prop changes
  useEffect(() => {
    setEditedBaristaName(baristaName);
  }, [baristaName]);

  // Get the current station name based on ID
  const getCurrentStationName = () => {
    if (!stations || stations.length === 0) return "Unknown Station";
    const station = stations.find(s => s.id === selectedStationId);
    return station ? station.name : `Station ${selectedStationId}`;
  };

  // Initialize chat service on mount and when selected station changes
  useEffect(() => {
    // Get the station name dynamically from the stations array
    const stationObj = stations.find(s => {
      // Handle various ID type combinations
      if (s.id === selectedStationId) return true;
      if (typeof s.id === 'string' && typeof selectedStationId === 'number' && parseInt(s.id, 10) === selectedStationId) return true;
      if (typeof selectedStationId === 'string' && typeof s.id === 'number' && parseInt(selectedStationId, 10) === s.id) return true;
      return false;
    });
    
    // Use found station name or fallback
    const stationName = stationObj ? stationObj.name : `Station #${selectedStationId}`;
    
    // Make sure we have a valid numeric station ID for the local storage key
    // Convert string IDs to numbers if needed
    const numericStationId = typeof selectedStationId === 'string' 
      ? parseInt(selectedStationId, 10) 
      : selectedStationId;
    
    console.log(`Initializing chat service for station ${numericStationId} (${stationName}) using stationObj:`, stationObj);
    
    // We'll just rely on the reset button for now
    // ChatService.resetMessages();
    
    // Initialize chat service with station info
    // This ensures that the correct station name is used when sending messages
    ChatService.initialize(numericStationId, stationName, baristaName);
    
    // Add listener for message updates
    const removeListener = ChatService.addListener((updatedMessages) => {
      setMessages(updatedMessages);
      setLoading(false);
      setError(null);
    });
    
    // Mark messages as read
    if (onMessageRead) {
      onMessageRead();
    }
    
    // Load initial messages
    loadMessages();
    
    // Cleanup on unmount
    return () => {
      removeListener();
      ChatService.cleanup();
    };
  }, [selectedStationId, stations, baristaName, onMessageRead]);

  // Load messages from service
  const loadMessages = async () => {
    try {
      setLoading(true);
      await ChatService.loadMessages();
      setError(null);
    } catch (err) {
      console.error('Error loading messages:', err);
      setError('Failed to load messages');
    } finally {
      setLoading(false);
    }
  };

  // Scroll to bottom whenever messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Calculate time since message
  const getTimeSince = (timestamp) => {
    const date = new Date(timestamp);
    const minutes = Math.floor((new Date() - date) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes === 1) return '1m ago';
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  };

  // Handle sending a message
  const handleSendMessage = async (e) => {
    e.preventDefault();
    
    if (!newMessage.trim()) return;
    
    try {
      setSending(true);
      
      await ChatService.sendMessage(
        newMessage.trim(), 
        messageType === 'urgent'
      );
      
      setNewMessage('');
      setMessageType('normal');
    } catch (err) {
      console.error('Error sending message:', err);
      setError('Failed to send message');
    } finally {
      setSending(false);
    }
  };
  
  // Handle manual refresh
  const handleRefresh = () => {
    loadMessages();
  };
  
  // Handle barista name update
  const handleSaveBaristaName = () => {
    // Only update if name has changed and is not empty
    if (editedBaristaName.trim() && editedBaristaName !== baristaName) {
      // Update parent component state via callback
      if (onBaristaNameChange) {
        onBaristaNameChange(editedBaristaName.trim());
      }
      
      // Update ChatService with new barista name
      const stationName = getCurrentStationName();
      const numericStationId = typeof selectedStationId === 'string' 
        ? parseInt(selectedStationId, 10) 
        : selectedStationId;
      
      ChatService.initialize(numericStationId, stationName, editedBaristaName.trim());
      
      // Save to localStorage for persistence with station-specific key
      try {
        // Make sure we have a valid numeric station ID for the local storage key
        const numericStationId = typeof selectedStationId === 'string' 
          ? parseInt(selectedStationId, 10) 
          : selectedStationId;
          
        // Use station-specific key for barista name
        localStorage.setItem(`coffee_barista_name_station_${numericStationId}`, editedBaristaName.trim());
      } catch (error) {
        console.error('Failed to save station-specific barista name to localStorage:', error);
      }
    }
    
    // Exit edit mode
    setIsEditingName(false);
  };

  return (
    <div className="fixed bottom-0 right-0 w-full md:w-80 h-96 bg-white shadow-lg border rounded-t-lg overflow-hidden z-40">
      <div className="bg-blue-500 text-white p-2 flex justify-between items-center">
        <div className="flex items-center">
          <h3 className="font-medium mr-1">Station Chat</h3>
          <div className="relative ml-2">
            <button 
              className="flex items-center text-white text-sm p-1 hover:bg-blue-600 rounded"
              onClick={() => setShowStationSelector(!showStationSelector)}
            >
              {getCurrentStationName()} <ChevronDown size={14} className="ml-1" />
            </button>
            
            {/* Station selector dropdown */}
            {showStationSelector && stations && stations.length > 0 && (
              <div className="absolute top-full left-0 bg-white text-gray-800 shadow-lg rounded-md overflow-y-auto max-h-40 w-48 z-50">
                {stations.map(station => (
                  <div 
                    key={station.id}
                    className={`p-2 hover:bg-gray-100 cursor-pointer ${station.id === selectedStationId ? 'bg-blue-100' : ''}`}
                    onClick={() => {
                      // Set the selected station ID
                      setSelectedStationId(station.id);
                      
                      // Also reinitialize chat service with the new station ID
                      const stationName = station.name || `Station #${station.id}`;
                      const numericStationId = typeof station.id === 'string' 
                        ? parseInt(station.id, 10) 
                        : station.id;
                      
                      console.log(`Dropdown selection - Reinitializing ChatService for station: ${numericStationId} (${stationName})`);
                      
                      // Initialize chat service with station info
                      ChatService.initialize(numericStationId, stationName, baristaName);
                      
                      // Close the dropdown
                      setShowStationSelector(false);
                    }}
                  >
                    <div className="font-medium text-sm">{station.name}</div>
                    <div className="text-xs text-gray-500 flex items-center">
                      <div className={`w-2 h-2 rounded-full mr-1 ${station.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                      {station.status}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center">
          <button 
            className="text-white mr-2"
            onClick={handleRefresh}
            disabled={loading}
            title="Refresh Messages"
          >
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          </button>
          <button 
            className="text-white mr-2"
            onClick={() => {
              // Reset messages for testing
              if (window.confirm('Reset all chat messages? This is for debugging only.')) {
                ChatService.resetMessages();
              }
            }}
            title="Reset All Messages (Debug)"
          >
            {/* Use RefreshCw as a clear icon */}
            <RefreshCw size={18} className="text-red-300" />
          </button>
          <button 
            className="text-white"
            onClick={onClose}
            title="Close Chat"
          >
            <XCircle size={20} />
          </button>
        </div>
      </div>
      {error && (
        <div className="bg-red-100 text-red-700 p-2 text-sm flex items-center">
          <AlertTriangle size={16} className="mr-1" />
          {error}
        </div>
      )}
      
      {/* Barista name editor */}
      <div className="bg-blue-50 border-b flex items-center p-2 justify-between">
        <div className="flex items-center">
          <User size={14} className="text-blue-700 mr-1" />
          {isEditingName ? (
            <input
              type="text"
              value={editedBaristaName}
              onChange={(e) => setEditedBaristaName(e.target.value)}
              className="border rounded px-2 py-1 text-sm w-40"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSaveBaristaName();
                }
              }}
            />
          ) : (
            <span className="text-sm">{baristaName}</span>
          )}
        </div>
        <button
          className="text-blue-700 p-1 hover:bg-blue-100 rounded"
          onClick={() => {
            if (isEditingName) {
              handleSaveBaristaName();
            } else {
              setIsEditingName(true);
            }
          }}
        >
          {isEditingName ? <Save size={14} /> : <Edit size={14} />}
        </button>
      </div>
      
      <div className="h-64 overflow-y-auto p-3 bg-gray-50">
        {loading && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <p className="mt-2 text-gray-500 text-sm">Loading messages...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <p>No messages yet</p>
            <p className="text-sm">Send a message to start the conversation!</p>
          </div>
        ) : (
          messages.map(message => (
            <div 
              key={message.id} 
              className={`p-2 mb-2 rounded ${
                message.is_urgent 
                  ? 'bg-red-50 border-l-2 border-red-500' 
                  : (message.station_id === selectedStationId || 
                     (typeof selectedStationId === 'string' && message.station_id === parseInt(selectedStationId, 10)) ||
                     (message.sender === baristaName && message.station_id === selectedStationId))
                    ? 'bg-blue-100' 
                    : 'bg-gray-100'
              }`}
            >
              <div className="text-xs text-gray-500 mb-1 flex justify-between">
                <span>
                  {/* Format sender name to show correct station */}
                  {message.sender}
                  {' '}
                  <span className="text-blue-600">
                    (
                    {stations.find(s => s.id === message.station_id || 
                                    (typeof message.station_id === 'string' && 
                                     typeof s.id === 'number' && 
                                     parseInt(message.station_id, 10) === s.id) ||
                                    (typeof s.id === 'string' && 
                                     typeof message.station_id === 'number' && 
                                     parseInt(s.id, 10) === message.station_id)
                    )?.name || 
                     message.station_name || 
                     `Station #${message.station_id}`}
                    )
                  </span>
                </span>
                <span>{getTimeSince(message.created_at)}</span>
              </div>
              <div className={message.is_urgent ? 'font-bold' : ''}>
                {message.content}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      
      <form onSubmit={handleSendMessage} className="p-2 border-t flex">
        <input 
          type="text" 
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..." 
          className="flex-grow border rounded-l p-2"
          disabled={sending}
        />
        <select 
          value={messageType}
          onChange={(e) => setMessageType(e.target.value)}
          className="border-y p-2"
          disabled={sending}
        >
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
        </select>
        <button 
          type="submit"
          className={`${
            sending ? 'bg-blue-400' : 'bg-blue-500 hover:bg-blue-600'
          } text-white p-2 rounded-r transition-colors`}
          disabled={sending || !newMessage.trim()}
        >
          {sending ? (
            <div className="flex items-center">
              <RefreshCw size={16} className="animate-spin mr-1" />
              <span>Sending</span>
            </div>
          ) : (
            'Send'
          )}
        </button>
      </form>
    </div>
  );
};

export default StationChat;