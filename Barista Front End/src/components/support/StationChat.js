// components/StationChat.js
import React, { useState, useEffect, useRef } from 'react';
import { sameId } from '../../utils/ids';
import { XCircle, RefreshCw, AlertTriangle, ChevronDown, Edit, Save, User, AtSign } from 'lucide-react';
import ChatService from '../../services/ChatService';
import StationsService from '../../services/StationsService';

// Build a stable @mention token from a station object. We canonicalize
// to lowercased-with-hyphens so "Coffee Station One" → "@coffee-station-one"
// — keeps the message text short and stops a station rename from
// matching legacy messages incorrectly. The picker prepends the
// human-readable form for the operator's benefit; the matcher checks
// either form so both work.
const _mentionToken = (s) =>
  (s?.name || `Station ${s?.id ?? ''}`).trim();

// Does this message text mention the given station name? Case-insensitive,
// matches the human-readable name with a leading @.
const _mentions = (text, stationName) => {
  if (!text || !stationName) return false;
  const haystack = String(text).toLowerCase();
  const needle = `@${String(stationName).trim().toLowerCase()}`;
  return haystack.includes(needle);
};

const StationChat = ({ onClose, onMessageRead, stations, currentStationId, currentStationName, baristaName = "Barista", onBaristaNameChange, embedded = false }) => {
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

  // @mention picker — operators wanted to address a specific station
  // ("@Coffee Station Two — Bob is on his way for extra lids") rather
  // than always broadcasting to everyone. The picker prepends the
  // selected station's name + '@' to the message; on receive,
  // messages mentioning the current station highlight in amber so
  // it's obvious the message was meant for them.
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const mentionPickerRef = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => {
    // Close the picker on any outside click.
    const onClickOutside = (e) => {
      if (mentionPickerRef.current && !mentionPickerRef.current.contains(e.target)) {
        setShowMentionPicker(false);
      }
    };
    if (showMentionPicker) {
      document.addEventListener('mousedown', onClickOutside);
      return () => document.removeEventListener('mousedown', onClickOutside);
    }
  }, [showMentionPicker]);

  const insertMention = (station) => {
    const token = `@${_mentionToken(station)} `;
    // Insert at cursor if possible, else append.
    const el = inputRef.current;
    if (el && typeof el.selectionStart === 'number') {
      let before = newMessage.slice(0, el.selectionStart);
      const after = newMessage.slice(el.selectionEnd);
      // If the picker was opened by typing '@', that '@' is still in the
      // text -- drop it so we don't get "@@station".
      if (before.endsWith('@')) before = before.slice(0, -1);
      setNewMessage(`${before}${token}${after}`);
      // Restore focus + place cursor after the inserted token.
      setTimeout(() => {
        try {
          el.focus();
          const pos = (before + token).length;
          el.setSelectionRange(pos, pos);
        } catch (_) { /* non-fatal */ }
      }, 0);
    } else {
      setNewMessage((m) => `${m}${m && !m.endsWith(' ') ? ' ' : ''}${token}`);
    }
    setShowMentionPicker(false);
  };
  
  // Update editedBaristaName when baristaName prop changes
  useEffect(() => {
    setEditedBaristaName(baristaName);
  }, [baristaName]);

  // Get the current station name based on ID
  const getCurrentStationName = () => {
    if (!stations || stations.length === 0) return "Unknown Station";
    const station = stations.find(s => sameId(s.id, selectedStationId));
    return station ? station.name : `Station ${selectedStationId}`;
  };

  // Initialize chat service on mount and when selected station changes
  useEffect(() => {
    // Get the station name dynamically from the stations array
    const stationObj = stations.find(s => sameId(s.id, selectedStationId));
    
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
      
      // The barista's name belongs to the station record on the server
      // (every device at the station sees it), not to this browser.
      StationsService.updateStation(numericStationId, { baristaName: editedBaristaName.trim() })
        .catch((error) => console.error('Failed to save barista name to the station:', error));
    }
    
    // Exit edit mode
    setIsEditingName(false);
  };

  return (
    // Width bumped 320 → 440px and capped to viewport so the header
    // (title + station picker + refresh + close) and footer (input +
    // @ + type + send) don't overflow. Mobile keeps full-width.
    <div className={embedded
      ? "h-full w-full bg-cq-milk overflow-hidden flex flex-col"
      : "fixed bottom-0 right-0 w-full md:w-[440px] max-w-[100vw] h-[28rem] bg-cq-milk shadow-cq-card border rounded-t-lg overflow-hidden z-40 flex flex-col"}>
      <div className="bg-cq-caramel text-white p-2 flex justify-between items-center flex-shrink-0">
        <div className="flex items-center min-w-0">
          <h3 className="font-medium mr-1 whitespace-nowrap">Chat</h3>
          <div className="relative ml-1 min-w-0">
            <button
              className="flex items-center text-white text-sm p-1 hover:bg-cq-roast rounded truncate max-w-[200px]"
              onClick={() => setShowStationSelector(!showStationSelector)}
              title={getCurrentStationName()}
            >
              <span className="truncate">{getCurrentStationName()}</span>
              <ChevronDown size={14} className="ml-1 flex-shrink-0" />
            </button>
            
            {/* Station selector dropdown */}
            {showStationSelector && stations && stations.length > 0 && (
              <div className="absolute top-full left-0 bg-cq-milk text-cq-roast shadow-cq-card rounded-md overflow-y-auto max-h-40 w-48 z-50">
                {stations.map(station => (
                  <div 
                    key={station.id}
                    className={`p-2 hover:bg-cq-wash cursor-pointer ${sameId(station.id, selectedStationId) ? 'bg-cq-caramel-wash' : ''}`}
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
                    <div className="text-xs text-cq-ink-3 flex items-center">
                      <div className={`w-2 h-2 rounded-full mr-1 ${station.status === 'active' ? 'bg-cq-ready' : 'bg-cq-alert'}`}></div>
                      {station.status}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center flex-shrink-0">
          <button
            className="text-white p-1 hover:bg-cq-roast rounded"
            onClick={handleRefresh}
            disabled={loading}
            title="Refresh Messages"
          >
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          </button>
          {/* Debug Reset button removed — it was a development-only
              "wipe all messages" button that shipped to operators and
              took up space in the header. To clear messages now, use
              the backend reset path or a SQL truncate. */}
          <button
            className="text-white p-1 hover:bg-cq-roast rounded ml-1"
            onClick={onClose}
            title="Close Chat"
          >
            <XCircle size={20} />
          </button>
        </div>
      </div>
      {error && (
        <div className="bg-cq-alert-wash text-cq-alert p-2 text-sm flex items-center">
          <AlertTriangle size={16} className="mr-1" />
          {error}
        </div>
      )}
      
      {/* Barista name editor */}
      <div className="bg-cq-caramel-wash border-b flex items-center p-2 justify-between">
        <div className="flex items-center">
          <User size={14} className="text-cq-caramel-deep mr-1" />
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
          className="text-cq-caramel-deep p-1 hover:bg-cq-caramel-wash rounded"
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
      
      <div className="flex-1 overflow-y-auto p-3 bg-cq-wash">
        {loading && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cq-caramel"></div>
            <p className="mt-2 text-cq-ink-3 text-sm">Loading messages...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-cq-ink-3">
            <p>No messages yet</p>
            <p className="text-sm">Send a message to start the conversation!</p>
          </div>
        ) : (
          messages.map(message => {
            // A message that @-mentions THIS station gets an amber
            // border — same idea as urgent but distinct, so a barista
            // can tell at a glance "this one's for me" vs "this is a
            // global urgent broadcast". Urgent still wins if both apply.
            const mentionsMe = _mentions(message.content, getCurrentStationName());
            // Ids compare as strings (utils/ids.js) -- this used to try
            // three type combinations by hand and still missed one.
            const fromMe = sameId(message.station_id, selectedStationId);
            return (
            <div
              key={message.id}
              className={`p-2 mb-2 rounded ${
                message.is_urgent
                  ? 'bg-cq-alert-wash border-l-2 border-cq-alert'
                  : mentionsMe
                    ? 'bg-cq-caramel-wash border-l-2 border-cq-caramel'
                    : fromMe
                      ? 'bg-cq-caramel-wash'
                      : 'bg-cq-wash'
              }`}
            >
              <div className="text-xs text-cq-ink-3 mb-1 flex justify-between">
                <span>
                  {/* Format sender name to show correct station */}
                  {message.sender}
                  {' '}
                  <span className="text-cq-caramel-deep">
                    (
                    {stations.find(s => sameId(s.id, message.station_id))?.name || 
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
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>
      
      <form onSubmit={handleSendMessage} className="p-2 border-t flex flex-shrink-0 relative">
        {/* @mention picker. Opens a small dropdown of stations; clicking
            one inserts '@Station Name ' at the cursor. The picker
            closes on outside click (effect above). */}
        <div className="relative" ref={mentionPickerRef}>
          <button
            type="button"
            onClick={() => setShowMentionPicker((v) => !v)}
            className="border rounded-l p-2 bg-cq-wash hover:bg-cq-wash text-cq-ink-2 flex items-center"
            title="Mention a station — addresses your message to that station"
            disabled={sending}
          >
            <AtSign size={16} />
          </button>
          {showMentionPicker && stations && stations.length > 0 && (
            <div className="absolute bottom-full left-0 mb-1 bg-cq-milk shadow-cq-card rounded-md border overflow-y-auto max-h-48 w-56 z-50">
              <div className="text-xs text-cq-ink-3 px-2 py-1 border-b bg-cq-wash">
                Mention a station:
              </div>
              {stations.map((station) => (
                <button
                  key={station.id}
                  type="button"
                  onClick={() => insertMention(station)}
                  className="w-full text-left p-2 hover:bg-cq-wash border-b last:border-b-0"
                >
                  <div className="font-medium text-sm">@{_mentionToken(station)}</div>
                  <div className="text-xs text-cq-ink-3 flex items-center">
                    <div className={`w-2 h-2 rounded-full mr-1 ${station.status === 'active' ? 'bg-cq-ready' : 'bg-cq-alert'}`}></div>
                    {station.status}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={newMessage}
          onChange={(e) => {
            const v = e.target.value;
            setNewMessage(v);
            // The placeholder promises "use @ to mention a station" -- so
            // actually make typing @ open the picker (Steve: "the @ symbol
            // does not bring up other stations"). It opened only from the
            // @ button before.
            if (v.endsWith('@')) setShowMentionPicker(true);
          }}
          placeholder="Type a message…  (use @ to mention a station)"
          className="flex-grow border-y border-r p-2 min-w-0"
          disabled={sending}
        />
        <select
          value={messageType}
          onChange={(e) => setMessageType(e.target.value)}
          className="border-y p-2 text-sm"
          disabled={sending}
        >
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
        </select>
        <button
          type="submit"
          className={`${
            sending ? 'bg-cq-caramel' : 'bg-cq-caramel hover:bg-cq-roast'
          } text-white px-3 py-2 rounded-r transition-colors flex items-center justify-center min-w-[64px]`}
          disabled={sending || !newMessage.trim()}
        >
          {sending ? (
            <RefreshCw size={16} className="animate-spin" />
          ) : (
            'Send'
          )}
        </button>
      </form>
    </div>
  );
};

export default StationChat;