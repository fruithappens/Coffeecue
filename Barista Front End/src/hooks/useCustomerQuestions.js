// useCustomerQuestions — data/logic for the "BARISTA" SMS questions feature.
//
// When a customer texts BARISTA + a question, the backend queues it in
// customer_questions and pushes a 'customer_question' WebSocket event. This
// hook keeps the live list of pending questions (poll + WS), exposes the
// count (for a badge), and a sendReply() that SMSes the answer back.
//
// Extracted from the old CustomerQuestionsButton so the count can live in the
// Barista header's Messages badge while the list renders inside the Messages
// inbox panel.
import { useState, useEffect, useCallback, useRef } from 'react';
import ApiService from '../services/ApiService';

const POLL_MS = 15000;

export default function useCustomerQuestions() {
  const [items, setItems] = useState([]);
  const [replyDrafts, setReplyDrafts] = useState({}); // {id: text}
  const [sending, setSending] = useState({});         // {id: bool}
  const [blocking, setBlocking] = useState({});       // {id: bool}
  const apiRef = useRef(null);
  if (!apiRef.current) apiRef.current = new ApiService();

  const fetchPending = useCallback(async () => {
    try {
      const resp = await apiRef.current.get('/customer-questions?status=pending');
      const list = (resp && (resp.data || resp.items)) || [];
      setItems(Array.isArray(list) ? list : []);
    } catch (err) {
      // Silent — keep last good state.
      console.warn('CustomerQuestions: fetch failed', err);
    }
  }, []);

  // Initial load + periodic refresh as a safety net for missed WS events.
  useEffect(() => {
    fetchPending();
    const id = setInterval(fetchPending, POLL_MS);
    return () => clearInterval(id);
  }, [fetchPending]);

  // WebSocket listeners (ApiService forwards SocketIO events to window).
  useEffect(() => {
    const refetch = () => fetchPending();
    window.addEventListener('customer_question', refetch);
    window.addEventListener('customer_question_answered', refetch);
    window.addEventListener('customer_question_timed_out', refetch);
    return () => {
      window.removeEventListener('customer_question', refetch);
      window.removeEventListener('customer_question_answered', refetch);
      window.removeEventListener('customer_question_timed_out', refetch);
    };
  }, [fetchPending]);

  const sendReply = useCallback(async (q) => {
    const text = (replyDrafts[q.id] || '').trim();
    if (!text) return;
    setSending(s => ({ ...s, [q.id]: true }));
    try {
      const stationLabel = (
        typeof window !== 'undefined' &&
        localStorage.getItem('coffee_cue_selected_station')
      ) || 'Barista';
      const resp = await apiRef.current.post(
        `/customer-questions/${q.id}/reply`,
        { response: text, responded_by: stationLabel },
      );
      if (resp && (resp.success === true || resp.status === 'success')) {
        setItems(its => its.filter(x => x.id !== q.id)); // optimistic remove
        setReplyDrafts(d => { const { [q.id]: _omit, ...rest } = d; return rest; });
      } else {
        alert((resp && resp.message) || 'Failed to send reply');
      }
    } catch (err) {
      alert(err?.message || 'Failed to send reply');
    } finally {
      setSending(s => ({ ...s, [q.id]: false }));
    }
  }, [replyDrafts]);

  // Block the sender of a message (e.g. an SMS spammer, or the ⚠️ auto-pause
  // alert). The bot stops replying to that number until it's unblocked in
  // Support → SMS. Reversible; deletes nothing.
  const blockSender = useCallback(async (q) => {
    const phone = q.phone || q.from || '';
    if (!phone) { alert('No phone number on this message to block.'); return; }
    if (!window.confirm(
      `Block ${phone}?\n\nThe system will stop replying to this number to protect ` +
      `your SMS credit. You can undo this anytime in Support → SMS. ` +
      `Nothing is deleted.`
    )) return;
    setBlocking(s => ({ ...s, [q.id]: true }));
    try {
      const resp = await apiRef.current.post('/sms/block', {
        phone, reason: 'Blocked from Messages inbox',
      });
      if (resp && (resp.success === true || resp.status === 'success')) {
        setItems(its => its.filter(x => x.id !== q.id)); // optimistic remove
      } else {
        alert((resp && resp.message) || 'Failed to block number');
      }
    } catch (err) {
      alert(err?.message || 'Failed to block number');
    } finally {
      setBlocking(s => ({ ...s, [q.id]: false }));
    }
  }, []);

  return {
    items, count: items.length, replyDrafts, setReplyDrafts,
    sending, sendReply, blocking, blockSender,
  };
}
