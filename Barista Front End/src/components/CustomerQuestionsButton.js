// components/CustomerQuestionsButton.js
//
// "BARISTA" SMS escape hatch — when a customer texts BARISTA followed
// by a question, the backend (services/coffee_system.py) queues it in
// customer_questions and pushes a 'customer_question' WebSocket event.
// This component:
//   - Shows a badge with the count of pending questions
//   - Opens a modal listing them, with a textarea to reply
//   - POSTs the reply to /api/customer-questions/<id>/reply
//   - Listens for WS events (new question / answered / timed out)
//     so the badge stays live without polling
//
// Pattern lifted from MessageHistory / OrderNotificationHandler — fits
// in the Barista header next to "Queue: 4" / "Wait: 2 min" / "HELP".
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import ApiService from '../services/ApiService';

const POLL_MS = 15000;

export default function CustomerQuestionsButton() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [replyDrafts, setReplyDrafts] = useState({});  // {id: text}
  const [sending, setSending] = useState({});           // {id: bool}
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

  // Initial load + periodic refresh as a safety net for missed WS.
  useEffect(() => {
    fetchPending();
    const id = setInterval(fetchPending, POLL_MS);
    return () => clearInterval(id);
  }, [fetchPending]);

  // WebSocket listeners. The ApiService forwards backend SocketIO
  // events to `window` as same-named custom events; we just listen.
  useEffect(() => {
    const onNew = () => fetchPending();
    const onAnswered = () => fetchPending();
    const onTimedOut = () => fetchPending();
    window.addEventListener('customer_question', onNew);
    window.addEventListener('customer_question_answered', onAnswered);
    window.addEventListener('customer_question_timed_out', onTimedOut);
    return () => {
      window.removeEventListener('customer_question', onNew);
      window.removeEventListener('customer_question_answered', onAnswered);
      window.removeEventListener('customer_question_timed_out', onTimedOut);
    };
  }, [fetchPending]);

  const sendReply = async (q) => {
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
        // Optimistic remove
        setItems(its => its.filter(x => x.id !== q.id));
        setReplyDrafts(d => { const { [q.id]: _, ...rest } = d; return rest; });
      } else {
        alert((resp && resp.message) || 'Failed to send reply');
      }
    } catch (err) {
      alert(err?.message || 'Failed to send reply');
    } finally {
      setSending(s => ({ ...s, [q.id]: false }));
    }
  };

  const count = items.length;
  const Icon = MessageCircle;

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        title="Customer questions from SMS"
        className={`relative px-3 py-1 rounded-md text-sm font-medium ${
          count > 0
            ? 'bg-orange-500 text-white hover:bg-orange-600 animate-pulse'
            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
        }`}
      >
        <span className="inline-flex items-center gap-1">
          <Icon size={16} />
          {count > 0 ? `${count} question${count > 1 ? 's' : ''}` : 'Questions'}
        </span>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">
                Customer Questions
                {count > 0 && <span className="ml-2 text-orange-600">({count})</span>}
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-500 hover:text-gray-800"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-4">
              {items.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  No pending questions. When a customer texts <code>BARISTA</code>
                  followed by a question, it'll show up here.
                </div>
              ) : (
                <ul className="space-y-4">
                  {items.map(q => {
                    const ageSec = q.createdAt
                      ? Math.floor((Date.now() - new Date(q.createdAt).getTime()) / 1000)
                      : 0;
                    const timeLeft = Math.max(0, 60 - ageSec);
                    return (
                      <li key={q.id} className="border rounded-lg p-3 bg-gray-50">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="font-semibold">
                              {q.customerName || q.customer_name || q.phone || 'Anonymous'}
                            </div>
                            <div className="text-xs text-gray-500">{q.phone}</div>
                          </div>
                          <div className={`text-xs font-medium px-2 py-1 rounded ${
                            timeLeft > 30
                              ? 'bg-green-100 text-green-700'
                              : timeLeft > 10
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-red-100 text-red-700'
                          }`}>
                            {timeLeft > 0 ? `${timeLeft}s left` : 'timing out…'}
                          </div>
                        </div>
                        <div className="mb-3 p-2 bg-white rounded border italic">
                          "{q.question}"
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={replyDrafts[q.id] || ''}
                            onChange={(e) => setReplyDrafts(d => ({ ...d, [q.id]: e.target.value }))}
                            onKeyDown={(e) => e.key === 'Enter' && sendReply(q)}
                            placeholder="Type reply…"
                            className="flex-1 px-2 py-1 border rounded text-sm"
                            disabled={sending[q.id]}
                          />
                          <button
                            onClick={() => sendReply(q)}
                            disabled={sending[q.id] || !(replyDrafts[q.id] || '').trim()}
                            className="px-3 py-1 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                          >
                            <Send size={14} />
                            {sending[q.id] ? 'Sending…' : 'Send'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-500">
              Replies are SMSed straight to the customer. After 60s with no reply,
              the system tells them all baristas are busy.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
