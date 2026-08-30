// useStationChatUnread — the number that makes the Messages bubble
// react to STATION CHAT, not just customer questions.
//
// Steve: "there is no change in message blue bubble icon when a message
// send... not sure if it changed." The bubble's badge only ever counted
// customer questions, so an incoming station chat (Concourse <-> Ferguson)
// lit up nothing -- and with the panel closed the chat wasn't even being
// polled. This keeps ChatService running from the interface and counts
// messages from OTHER stations that arrived since this barista last
// looked, so the bubble finally reflects chat activity.
import { useState, useEffect, useCallback, useRef } from 'react';
import ChatService from '../services/ChatService';

const readKey = (id) => `coffee_chat_last_read_station_${id}`;

const lastRead = (id) => {
  try { return parseInt(localStorage.getItem(readKey(id)) || '0', 10) || 0; }
  catch (e) { return 0; }
};

export default function useStationChatUnread(stationId, stationName, baristaName) {
  const [unread, setUnread] = useState(0);
  const msgsRef = useRef([]);

  const recompute = useCallback((messages) => {
    if (messages) msgsRef.current = messages;
    const sid = typeof stationId === 'string' ? parseInt(stationId, 10) : stationId;
    if (!sid) { setUnread(0); return; }
    const since = lastRead(sid);
    const n = (msgsRef.current || []).filter((m) => {
      const from = typeof m.station_id === 'string' ? parseInt(m.station_id, 10) : m.station_id;
      if (from === sid) return false; // my own station's messages are not "unread for me"
      const t = m.created_at ? Date.parse(m.created_at) : (m.id || 0);
      return t > since;
    }).length;
    setUnread(n);
  }, [stationId]);

  useEffect(() => {
    if (!stationId) return undefined;
    // Keep chat polling even while the panel is closed, so the badge is
    // live. initialize() is safe to call again -- it just (re)starts the
    // 10s poll for this station.
    try {
      if (!ChatService.initialized) {
        ChatService.initialize(stationId, stationName || `Station ${stationId}`, baristaName || 'Barista');
      }
    } catch (e) { /* chat is a nicety, never block the interface */ }
    // Seed from whatever the service already holds, then follow updates.
    try { recompute(ChatService.getStationMessages ? ChatService.getStationMessages() : []); } catch (e) { /* */ }
    const remove = ChatService.addListener((messages) => recompute(messages));
    return () => { try { remove && remove(); } catch (e) { /* */ } };
  }, [stationId, stationName, baristaName, recompute]);

  // Call when the barista actually looks at the chat: everything up to now
  // counts as read.
  const markRead = useCallback(() => {
    const sid = typeof stationId === 'string' ? parseInt(stationId, 10) : stationId;
    if (!sid) return;
    try { localStorage.setItem(readKey(sid), String(Date.now())); } catch (e) { /* */ }
    setUnread(0);
  }, [stationId]);

  return { unread, markRead };
}
