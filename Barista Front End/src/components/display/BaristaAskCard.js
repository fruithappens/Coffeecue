import React, { useEffect, useRef, useState } from 'react';

// The barista-to-this-customer message, on the customer's own phone.
//
// Steve wanted the barista to be able to reach ANY waiting customer --
// number or no number -- and get a reply: "we have just run out of oat
// is almond ok?" This card shows that question on the tracking page and
// sends the answer straight back, by tap or by typing. Self-contained:
// give it an order number (and optionally the ask if the parent already
// polls /track) and it handles the rest.
export default function BaristaAskCard({ orderNumber, ask: askProp, headerColor = '#0f766e' }) {
  const [ask, setAsk] = useState(askProp || null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [text, setText] = useState('');
  const mounted = useRef(true);

  // If the parent didn't hand us the ask, poll /track for it ourselves.
  useEffect(() => {
    mounted.current = true;
    if (askProp !== undefined && askProp !== null) { setAsk(askProp); return undefined; }
    if (askProp === null) { setAsk(null); }
    if (!orderNumber) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/track`);
        const b = r.ok ? await r.json() : null;
        if (!cancelled && b && b.success) setAsk(b.barista_ask || null);
      } catch (e) { /* keep last */ }
    };
    poll();
    const t = setInterval(poll, 8000);
    return () => { cancelled = true; clearInterval(t); mounted.current = false; };
  }, [orderNumber, askProp]);

  useEffect(() => { if (askProp !== undefined) setAsk(askProp); }, [askProp]);

  const send = async (reply) => {
    const body = String(reply || '').trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply: body }),
      });
      if (r.ok) { setSent(true); setAsk(null); }
    } catch (e) { /* they can try again */ }
    finally { if (mounted.current) setSending(false); }
  };

  if (sent) {
    return (
      <div className="rounded-2xl border-2 p-4 text-center" style={{ borderColor: headerColor }}>
        <div className="text-lg font-bold" style={{ color: headerColor }}>Thanks — sent to the barista.</div>
        <div className="text-sm text-gray-500 mt-1">They'll see your answer on their screen.</div>
      </div>
    );
  }
  if (!ask || !ask.message) return null;

  return (
    <div className="rounded-2xl border-2 p-4" style={{ borderColor: headerColor, background: '#fffdf7' }}>
      <div className="text-xs font-bold uppercase tracking-wide text-amber-700 mb-1">
        A message from the barista
      </div>
      <div className="text-xl font-semibold text-gray-800 mb-3">{ask.message}</div>

      {Array.isArray(ask.options) && ask.options.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {ask.options.map((opt) => (
            <button key={opt} disabled={sending} onClick={() => send(opt)}
              className="px-4 py-3 rounded-xl text-white text-lg font-bold disabled:opacity-50"
              style={{ backgroundColor: headerColor }}>
              {opt}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(text); }}
          placeholder="…or type a reply"
          className="flex-1 border-2 border-gray-200 rounded-xl px-3 py-2 text-base"
        />
        <button disabled={sending || !text.trim()} onClick={() => send(text)}
          className="px-4 rounded-xl text-white font-semibold disabled:opacity-40"
          style={{ backgroundColor: headerColor }}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
