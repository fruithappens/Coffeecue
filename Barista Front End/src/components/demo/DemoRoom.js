// DemoRoom.js — cupq.app/demo: every screen of an event on one page.
//
// Steve's sales demo used to mean five devices on a table. Here each
// surface is the REAL page in a frame, drawn at its true size and scaled
// down to fit, so an order placed on the little phone shows up on the
// barista tablet, the kiosk, the queue board and the label a moment
// later -- the same way it would at the cart. Nothing is mocked: this is
// the live event, so use it with a demo event loaded, not a client's.
//
// Frames share this browser's login and storage. That is what makes it
// work: the barista frame is signed in because you are, and the "after
// ordering" phone shows the order the customer phone just placed.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RotateCw } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';

const api = new ApiServiceClass();
const TOKEN_KEY = 'coffee_system_token';

// One device: the page at its real size (w x h), scaled to the column.
const Screen = ({ title, hint, src, w, h, reloadKey }) => {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0.3);
  const [own, setOwn] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const fit = () => setScale(el.clientWidth / w);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);
  return (
    <section className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-cq-roast">{title}</h2>
          {hint && <p className="text-xs text-cq-ink-3 truncate">{hint}</p>}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button type="button" onClick={() => setOwn(n => n + 1)}
            className="p-1.5 rounded-cq-md text-cq-ink-3 hover:text-cq-roast hover:bg-cq-wash"
            aria-label={`Reload ${title}`} title="Reload this screen">
            <RotateCw size={14} />
          </button>
          <a href={src} target="_blank" rel="noopener noreferrer"
            className="p-1.5 rounded-cq-md text-cq-ink-3 hover:text-cq-roast hover:bg-cq-wash"
            aria-label={`Open ${title} in a new tab`} title="Open full size">
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
      <div ref={wrapRef}
        className="relative overflow-hidden rounded-cq-lg border-4 border-cq-roast bg-black shadow"
        style={{ height: h * scale }}>
        <iframe key={`${reloadKey}-${own}`} src={src} title={title}
          style={{ width: w, height: h, border: 0, transform: `scale(${scale})`,
                   transformOrigin: 'top left', background: '#fff' }} />
      </div>
    </section>
  );
};

// The label for the newest order, re-drawn whenever a new one arrives.
const LabelPreview = ({ reloadKey }) => {
  const [orderNumber, setOrderNumber] = useState(null);
  const [img, setImg] = useState(null);
  const [error, setError] = useState('');

  const poll = useCallback(async () => {
    try {
      const r = await api.request('/orders');
      const list = r?.orders || r?.data || (Array.isArray(r) ? r : []);
      const newest = list.reduce((best, o) => {
        const n = parseInt(o.order_number, 10);
        return Number.isFinite(n) && (best == null || n > best) ? n : best;
      }, null);
      setOrderNumber(newest);
    } catch (e) { /* keep the last label up */ }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 4000);
    return () => clearInterval(t);
  }, [poll, reloadKey]);

  useEffect(() => {
    let url = null;
    let dead = false;
    (async () => {
      try {
        const q = orderNumber != null ? `?order_id=${orderNumber}` : '?sample=1';
        const r = await fetch(`/api/print/preview${q}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) || ''}` },
        });
        if (!r.ok) throw new Error(`label preview answered ${r.status}`);
        url = URL.createObjectURL(await r.blob());
        if (!dead) { setImg(url); setError(''); }
      } catch (e) { if (!dead) setError(e.message); }
    })();
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [orderNumber, reloadKey]);

  return (
    <section className="min-w-0">
      <h2 className="text-sm font-extrabold text-cq-roast">Cup label</h2>
      <p className="text-xs text-cq-ink-3 mb-1.5">
        {orderNumber != null ? `Order #${orderNumber}, as the printer would print it` : 'A sample label'}
      </p>
      <div className="rounded-cq-lg border-4 border-cq-roast bg-white p-3 flex items-center justify-center min-h-[8rem]">
        {img ? <img src={img} alt={`Label for order ${orderNumber ?? 'sample'}`} className="max-w-full h-auto" />
             : <span className="text-sm text-cq-ink-3">{error || 'Drawing the label…'}</span>}
      </div>
    </section>
  );
};

// What the customer's phone would have received -- and a box to text the
// event as that customer. Demo numbers (0400 009 900 - 999) are filed by
// the server instead of texted, so this costs nothing and reaches nobody.
// The typed text runs the REAL text-ordering conversation (POST
// /api/demo/sms), so "Large flat white, Priya" makes a real order.
const DEFAULT_DEMO_PHONE = '+61400009901';
const MessagesPreview = ({ reloadKey }) => {
  const [texts, setTexts] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const lastId = useRef(0);
  const endRef = useRef(null);
  useEffect(() => { lastId.current = 0; setTexts([]); }, [reloadKey]);
  const merge = useCallback((fresh) => {
    if (!fresh.length) return;
    setTexts(prev => {
      const seen = new Set(prev.map(t => t.id));
      const out = [...prev, ...fresh.filter(t => !seen.has(t.id))].sort((a, b) => a.id - b.id);
      lastId.current = out.length ? out[out.length - 1].id : 0;
      return out.slice(-200);
    });
  }, []);
  useEffect(() => {
    let dead = false;
    const poll = async () => {
      try {
        const r = await api.request(`/demo/texts?after=${lastId.current}`);
        if (!dead) merge(r?.data?.texts || []);
      } catch (e) { /* keep what's shown */ }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => { dead = true; clearInterval(t); };
  }, [reloadKey, merge]);
  const to = texts.length ? texts[texts.length - 1].to : DEFAULT_DEMO_PHONE;
  const thread = texts.filter(t => t.to === to);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [thread.length]);
  const local = `0${to.slice(3, 6)} ${to.slice(6, 9)} ${to.slice(9)}`;
  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true); setError('');
    try {
      const r = await api.request('/demo/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: to, text }),
      });
      if (r?.success === false) throw new Error(r.message || 'Not sent');
      merge(r?.data?.texts || []);
      setDraft('');
    } catch (e) { setError(e.message || 'Not sent'); }
    setSending(false);
  };
  return (
    <section className="min-w-0">
      <h2 className="text-sm font-extrabold text-cq-roast">Text messages</h2>
      <p className="text-xs text-cq-ink-3 mb-1.5">
        Text the event below, or give a kiosk order the number 0400 009 901. Shown here, never sent.
      </p>
      <div className="rounded-cq-lg border-4 border-cq-roast bg-white overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b border-cq-line text-center text-xs font-semibold text-cq-ink-2 bg-cq-wash">
          Messages · {local}
        </div>
        <div className="p-3 space-y-2 h-72 overflow-y-auto">
          {thread.length === 0 && (
            <p className="text-sm text-cq-ink-3 text-center pt-6">No texts yet. Try “Hi”.</p>
          )}
          {thread.map(t => {
            const mine = t.direction === 'in';
            return (
              <div key={t.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${mine ? 'rounded-br-md' : 'rounded-bl-md'}`}
                  style={mine ? { background: '#0A84FF', color: '#fff' } : { background: '#E9E9EB', color: '#111' }}>
                  {t.body}
                </div>
                {!mine && (
                  <span className="text-[10px] text-cq-ink-3 mt-0.5 ml-1">
                    {new Date(t.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {t.kind}
                  </span>
                )}
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
        <form className="flex gap-2 p-2 border-t border-cq-line"
          onSubmit={e => { e.preventDefault(); send(); }}>
          <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={480}
            placeholder="Text the event…" aria-label="Text the event as the demo customer"
            className="flex-1 min-w-0 px-3 py-2 rounded-full border border-cq-line text-sm outline-none focus:border-cq-caramel" />
          <button type="submit" disabled={!draft.trim() || sending}
            className="px-4 py-2 rounded-full text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: '#0A84FF' }}>
            {sending ? '…' : 'Send'}
          </button>
        </form>
        {error && <p className="px-3 pb-2 text-xs text-red-700">{error}</p>}
      </div>
    </section>
  );
};

const DemoRoom = () => {
  const [eventCode, setEventCode] = useState(null);
  const [eventName, setEventName] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/display/config', { cache: 'no-cache' });
        const b = r.ok ? await r.json() : null;
        const cfg = b?.config || b || {};
        setEventCode(String(cfg.event_code || '').trim());
        setEventName(String(cfg.event_name || cfg.system_name || '').trim());
      } catch (e) { setEventCode(''); }
    })();
  }, []);

  if (eventCode == null) {
    return <div className="min-h-screen bg-cq-cream p-6 text-cq-ink-3">Loading the demo room…</div>;
  }
  // The event-code door: the phone has to arrive the way a scanned QR
  // would, or it stops at "enter your event code".
  const e = eventCode ? `?e=${encodeURIComponent(eventCode)}` : '';

  return (
    <div className="min-h-screen bg-cq-cream p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-cq-roast">Demo room</h1>
          <p className="text-sm text-cq-ink-3">
            {eventName ? `${eventName}: ` : ''}every screen, live. Order on the phone and watch the rest.
          </p>
        </div>
        <button type="button" onClick={() => setReloadKey(k => k + 1)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-cq-lg bg-cq-roast text-white font-semibold">
          <RotateCw size={16} /> Reload all
        </button>
      </header>

      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_2.4fr]">
        <Screen title="Customer's phone" hint="Scan the QR, order" src={`/order${e}`}
          w={390} h={844} reloadKey={reloadKey} />
        <Screen title="Their phone after ordering" hint="Where it's up to" src={`/my${e}`}
          w={390} h={844} reloadKey={reloadKey} />
        <div className="sm:col-span-2 xl:col-span-1 grid gap-5 content-start">
          <Screen title="Barista tablet" hint="Start, Ready, walk-ups" src="/barista"
            w={1180} h={820} reloadKey={reloadKey} />
          <div className="grid gap-5 grid-cols-1 md:grid-cols-2">
            <LabelPreview reloadKey={reloadKey} />
            <MessagesPreview reloadKey={reloadKey} />
          </div>
        </div>
        <div className="sm:col-span-2 xl:col-span-3 grid gap-5 grid-cols-1 lg:grid-cols-2">
          <Screen title="Self-serve kiosk" hint="Tap Order here" src="/display?kiosk=1"
            w={1920} h={1080} reloadKey={reloadKey} />
          <Screen title="Queue board" hint="Names called when ready" src="/display?mode=pickup"
            w={1920} h={1080} reloadKey={reloadKey} />
        </div>
      </div>
    </div>
  );
};

export default DemoRoom;
