import React, { useEffect, useRef, useState } from 'react';
import { pollDelayMs, QUEUED_MS } from '../../utils/pollPace';

// The barista-to-this-customer message, on the customer's own phone.
//
// Steve wanted the barista to be able to reach ANY waiting customer --
// number or no number -- and get a reply: "we have just run out of oat
// is almond ok?" This card shows that question on the tracking page and
// sends the answer straight back, by tap or by typing. Self-contained:
// give it an order number (and optionally the ask if the parent already
// polls /track) and it handles the rest.
export default function BaristaAskCard({ orderNumber, ask: askProp, headerColor = '#B8764A' }) {
  const [ask, setAsk] = useState(askProp || null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [text, setText] = useState('');
  const mounted = useRef(true);

  // Poll /track ourselves ONLY when the parent isn't passing the ask at
  // all (undefined). A parent that passes null is already polling /track
  // and is saying "no question right now"; treating null as "poll it
  // yourself" doubled every tracking phone's checks (found by the
  // 1,000-phone load test). Our own polling follows the shared pace and
  // stops when the order is finished.
  useEffect(() => {
    mounted.current = true;
    if (askProp !== undefined) { setAsk(askProp); return undefined; }
    if (!orderNumber) return undefined;
    let cancelled = false;
    let timer = null;
    const poll = async () => {
      let delay = QUEUED_MS;
      try {
        const r = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/track`);
        const b = r.ok ? await r.json() : null;
        if (!cancelled && b && b.success) {
          setAsk(b.barista_ask || null);
          delay = pollDelayMs({
            status: b.status,
            position: b.position,
            hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
          });
        }
      } catch (e) { /* keep last */ }
      if (!cancelled && delay != null) timer = setTimeout(poll, delay);
    };
    // Looked at again: check now (a question is waiting on this person).
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || cancelled) return;
      if (timer) clearTimeout(timer);
      poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      mounted.current = false;
    };
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
      <div className="rounded-cq-xl border-2 p-4 text-center" style={{ borderColor: headerColor }}>
        <div className="text-lg font-bold" style={{ color: headerColor }}>Thanks — sent to the barista.</div>
        <div className="text-sm text-cq-ink-3 mt-1">They'll see your answer on their screen.</div>
      </div>
    );
  }
  if (!ask || !ask.message) return null;

  return (
    <div className="rounded-cq-xl border-2 p-4" style={{ borderColor: headerColor, background: 'var(--cq-milk, #FFFFFF)' }}>
      <div className="text-xs font-bold uppercase tracking-wide text-cq-caramel-deep mb-1">
        A message from the barista
      </div>
      <div className="text-xl font-semibold text-cq-roast mb-3">{ask.message}</div>

      {Array.isArray(ask.options) && ask.options.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {ask.options.map((opt) => (
            <button key={opt} disabled={sending} onClick={() => send(opt)}
              className="px-4 py-3 rounded-cq-lg text-white text-lg font-bold disabled:opacity-50"
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
          className="flex-1 border-2 border-cq-line rounded-cq-lg px-3 py-2 text-base"
        />
        <button disabled={sending || !text.trim()} onClick={() => send(text)}
          className="px-4 rounded-cq-lg text-white font-semibold disabled:opacity-40"
          style={{ backgroundColor: headerColor }}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
