import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';

// Ask THIS customer a question, tied to their order, from the barista
// card -- and see their reply come back. Works whether or not they left
// a phone number (unlike the SMS-only message button beside it). Steve:
// "the barista can contact every customer regardless if they left a
// mobile number... we have jsut run out of oat is almond ok?"
//
// Self-contained on purpose: it holds its own form state and does its
// own POST, so it drops into the order card with one line and adds no
// hooks to the (fragile) barista interface body.
const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
  'Content-Type': 'application/json',
});

const PRESETS = [
  { label: 'Out of a milk', message: "We've run out of your milk — is another OK?", options: 'Full cream, Skim, Soy, Almond, Cancel' },
  { label: 'Running behind', message: "We're running a few minutes behind — still want it?", options: 'Yes please, Cancel' },
];

export default function AskCustomerControls({ order }) {
  // Read the thread from /track (public, reliable) rather than the order
  // serializer -- /orders/in-progress has two routes and one shadows the
  // other, so a field added to the "wrong" one never reaches the card.
  const [ask, setAsk] = useState(order.barista_ask || order.baristaAsk || null);
  const [reply, setReply] = useState(order.customer_reply || order.customerReply || null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (!order.id) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/orders/${encodeURIComponent(order.id)}/track`);
        const b = r.ok ? await r.json() : null;
        if (!cancelled && b && b.success) {
          setAsk(b.barista_ask || null);
          setReply(b.customer_reply || null);
        }
      } catch (e) { /* keep last */ }
    };
    poll();
    const t = setInterval(poll, 8000);
    return () => { cancelled = true; clearInterval(t); mounted.current = false; };
  }, [order.id]);

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [optionsText, setOptionsText] = useState('');
  const [sending, setSending] = useState(false);
  const [acked, setAcked] = useState(false);
  const [acking, setAcking] = useState(false);

  // Quick acknowledgement back to the customer (Steve: "a thumbs up, that's
  // fine"). One-way SMS; doesn't disturb the reply on the card.
  const ackCustomer = async (msg) => {
    if (acking) return;
    setAcking(true);
    try {
      await fetch(`/api/orders/${encodeURIComponent(order.id)}/ack`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ message: msg }),
      });
      setAcked(true);
    } finally {
      setAcking(false);
    }
  };

  const send = async () => {
    const msg = message.trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      const options = optionsText.split(',').map((o) => o.trim()).filter(Boolean);
      await fetch(`/api/orders/${encodeURIComponent(order.id)}/ask`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ message: msg, options }),
      });
      setAsk({ message: msg, options: optionsText.split(',').map((o)=>o.trim()).filter(Boolean) });
      setReply(null);
      setOpen(false); setMessage(''); setOptionsText('');
    } finally {
      setSending(false);
    }
  };

  // The reply is the payoff — show it loud and clear when it lands, with a
  // one-tap acknowledgement so the customer knows it was received.
  if (reply && reply.text) {
    return (
      <div className="mt-2 w-full rounded-lg border-2 border-green-500 bg-green-50 p-2">
        <div className="text-xs font-bold uppercase tracking-wide text-green-700">Customer replied</div>
        <div className="text-lg font-semibold text-green-900">“{reply.text}”</div>
        {acked ? (
          <div className="mt-2 text-sm font-semibold text-green-700">✓ Acknowledged</div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button onClick={() => ackCustomer('Got it - making your coffee now.')} disabled={acking}
              className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50">
              👍 Got it
            </button>
            <button onClick={() => ackCustomer('No worries, all sorted - making it now.')} disabled={acking}
              className="px-3 py-1.5 rounded-lg bg-green-100 text-green-800 text-sm font-semibold hover:bg-green-200 disabled:opacity-50">
              All sorted
            </button>
            <button onClick={() => setOpen(true)} className="text-sm text-green-700 underline">Ask something else</button>
          </div>
        )}
        {open && <AskForm {...{ message, setMessage, optionsText, setOptionsText, sending, send, setOpen }} />}
      </div>
    );
  }

  if (ask && ask.message && !open) {
    return (
      <div className="mt-2 w-full rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm">
        <span className="text-amber-800">Waiting for a reply to: </span>
        <span className="font-semibold text-amber-900">“{ask.message}”</span>
        <button onClick={() => setOpen(true)} className="ml-2 text-amber-700 underline">Ask again</button>
      </div>
    );
  }

  // Open: the question form takes a full-width line below the action row.
  if (open) {
    return (
      <div className="w-full">
        <AskForm {...{ message, setMessage, optionsText, setOptionsText, sending, send, setOpen }} />
      </div>
    );
  }
  // Collapsed: just an icon that sits in the action row beside Complete /
  // Message / Print — no full-width "Ask customer" label eating a line, so
  // more order cards fit on screen (Steve). Tooltip carries the meaning.
  return (
    <button onClick={() => setOpen(true)}
      title="Ask this customer a question (works with any phone, or none)"
      className="px-3 rounded-lg flex items-center justify-center bg-gray-200 hover:bg-gray-300 text-gray-700">
      <MessageSquare size={18} />
    </button>
  );
}

function AskForm({ message, setMessage, optionsText, setOptionsText, sending, send, setOpen }) {
  return (
    <div className="mt-1 border rounded-lg p-2 bg-white">
      <div className="flex flex-wrap gap-1 mb-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button"
            onClick={() => { setMessage(p.message); setOptionsText(p.options); }}
            className="text-xs bg-gray-100 hover:bg-gray-200 rounded px-2 py-1">
            {p.label}
          </button>
        ))}
      </div>
      <input
        autoFocus value={message} onChange={(e) => setMessage(e.target.value)}
        placeholder="Message to the customer"
        className="w-full border rounded px-2 py-1.5 text-sm mb-1"
      />
      <input
        value={optionsText} onChange={(e) => setOptionsText(e.target.value)}
        placeholder="Reply buttons (comma-separated) — optional"
        className="w-full border rounded px-2 py-1.5 text-sm mb-2"
      />
      <div className="flex gap-2">
        <button onClick={send} disabled={sending || !message.trim()}
          className="flex-1 bg-amber-600 hover:bg-amber-700 text-white rounded py-1.5 text-sm font-semibold disabled:opacity-40">
          {sending ? 'Sending…' : 'Send to customer'}
        </button>
        <button onClick={() => setOpen(false)}
          className="px-3 rounded bg-gray-100 text-gray-600 text-sm">Cancel</button>
      </div>
      <div className="text-[11px] text-gray-400 mt-1">
        Shows on their order page. If they left a mobile, it also texts them.
      </div>
    </div>
  );
}
