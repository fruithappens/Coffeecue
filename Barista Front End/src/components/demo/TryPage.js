// TryPage.js — demo.cupq.app/try: order a coffee and watch it travel.
//
// Public and self-guided. The visitor orders by text on the page (a demo
// number, texts shown here, never sent) or on their own phone from the QR,
// then presses Next to play the barista: Start, Ready, Collected. Each
// press calls the real barista route on the server (routes/try_routes.py),
// so the texts, the cup label, the customer's phone page and the board all
// change for real. Autoplay does the presses for them.
//
// /try/phone?src=… is where the QR lands on their phone: it marks the
// session as a demo, then opens the real ordering page tagged with src.
import React, { useCallback, useEffect, useRef, useState } from 'react';

const STEPS = [
  { key: 'order', title: 'Order a coffee', next: null },
  { key: 'start', title: 'The barista starts it', next: 'start', button: 'Next: barista taps Start' },
  { key: 'ready', title: 'It\'s ready', next: 'ready', button: 'Next: barista taps Ready' },
  { key: 'collect', title: 'Collected', next: 'collect', button: 'Next: customer collects it' },
];
const STATUS_STEP = { pending: 1, 'in-progress': 2, in_progress: 2, completed: 3, ready: 3, picked_up: 4, collected: 4 };
const AUTOPLAY_MS = 4500;

async function call(path, opts = {}) {
  const r = await fetch(`/api/try${path}`, {
    ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.success === false) {
    const err = new Error(b.message || `Something went wrong (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return b;
}

// A page at its real size, scaled down to fit its column.
function Scaled({ src, w, h, title }) {
  const ref = useRef(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => setScale(el.clientWidth / w);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);
  return (
    <div ref={ref} className="relative overflow-hidden rounded-cq-lg border-4 border-cq-roast bg-black" style={{ height: h * scale }}>
      <iframe src={src} title={title} style={{ width: w, height: h, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div>
  );
}

function Panel({ title, hint, children }) {
  return (
    <section className="min-w-0">
      <h2 className="text-sm font-extrabold text-cq-roast">{title}</h2>
      {hint ? <p className="text-xs text-cq-ink-3 mb-1.5">{hint}</p> : <div className="mb-1.5" />}
      {children}
    </section>
  );
}

// Where the QR lands on the visitor's own phone.
export function TryPhoneLanding() {
  useEffect(() => {
    const src = (new URLSearchParams(window.location.search).get('src') || '').replace(/[^a-z0-9-]/g, '').slice(0, 32);
    try { sessionStorage.setItem('cupq_demo', '1'); } catch (e) { /* private mode */ }
    window.location.replace(`/order?new=1${src ? `&src=${src}` : ''}`);
  }, []);
  return <div className="cq min-h-screen bg-cq-cream flex items-center justify-center p-6 text-cq-ink-2">Opening the order page…</div>;
}

export default function TryPage() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [texts, setTexts] = useState([]);
  const [order, setOrder] = useState(null);
  const [menu, setMenu] = useState({ drinks: [], milks: [], sizes: [] });
  const [pick, setPick] = useState({ name: '', drink: '', milk: '', size: '' });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [labelKey, setLabelKey] = useState(0);
  const endRef = useRef(null);

  useEffect(() => { document.title = 'Try CupQ live'; }, []);

  const begin = useCallback(async () => {
    setError(''); setTexts([]); setOrder(null); setAuto(false);
    try { setSession(await call('/session', { method: 'POST' })); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { begin(); }, [begin]);

  useEffect(() => {
    fetch('/api/display/menu').then((r) => r.json()).then((b) => {
      const m = b.menu || {};
      const name = (x) => (typeof x === 'string' ? x : x.name || x.value || '');
      setMenu({
        drinks: (m.coffee_types || []).map(name).filter(Boolean).slice(0, 8),
        milks: (m.milks || []).map(name).filter(Boolean).slice(0, 6),
        sizes: (m.sizes || []).map(name).filter(Boolean),
      });
    }).catch(() => undefined);
  }, []);

  // Follow the session: texts and the order, every 2 seconds.
  useEffect(() => {
    if (!session) return undefined;
    let dead = false;
    const tick = async () => {
      try {
        const b = await call(`/state?token=${encodeURIComponent(session.token)}`);
        if (dead) return;
        setTexts(b.texts || []);
        setOrder(b.order || null);
      } catch (e) { if (!dead && e.status === 410) setError('This demo timed out.'); }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { dead = true; clearInterval(t); };
  }, [session]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [texts.length]);

  const step = order ? (STATUS_STEP[String(order.status).toLowerCase()] || 1) : 0;
  const nextStep = STEPS[step];
  const done = step >= 4;

  const send = async (text) => {
    if (!session || !text.trim()) return;
    setBusy(true); setError('');
    try { const b = await call('/text', { method: 'POST', body: JSON.stringify({ token: session.token, text }) }); setTexts(b.texts || []); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };

  // The menu chips text the whole order, one message at a time, like a person.
  const orderByText = async () => {
    const name = pick.name.trim() || 'Sam';
    // Always a complete order, so the bot can confirm it in one go: the size
    // they picked or the menu's first, their milk, their drink or the first.
    const size = pick.size || menu.sizes[0] || '';
    const drink = [size, pick.milk && pick.milk !== 'full cream' ? pick.milk : '', pick.drink || menu.drinks[0] || 'flat white'].filter(Boolean).join(' ');
    await send('Hi');
    await send(name);
    await send(drink);
  };

  const advance = useCallback(async (action) => {
    if (!session) return;
    setBusy(true); setError('');
    try {
      const b = await call('/advance', { method: 'POST', body: JSON.stringify({ token: session.token, action }) });
      setOrder(b.order || null); setTexts(b.texts || []);
      if (action === 'start') setLabelKey((k) => k + 1);
    } catch (e) { setError(e.message); setAuto(false); }
    setBusy(false);
  }, [session]);

  // Autoplay: press the next barista button every few seconds.
  // Keyed on the order's STATUS, not the order object: the 2-second poll
  // hands back a new object each time, which restarted this timer forever.
  const orderStatus = order ? String(order.status) : '';
  const nextAction = nextStep?.next || '';
  useEffect(() => {
    if (!auto || !orderStatus || done || busy || !nextAction) return undefined;
    const t = setTimeout(() => advance(nextAction), AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [auto, orderStatus, done, busy, nextAction, advance]);

  const phoneUrl = session ? `${window.location.origin}/try/phone?src=${session.src}` : '';
  const chip = (on) => `h-9 px-3 rounded-full text-sm font-semibold border-2 ${on ? 'bg-cq-caramel text-white border-cq-caramel' : 'bg-white text-cq-roast border-cq-line'}`;

  return (
    <div className="cq min-h-screen bg-cq-cream px-4 py-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-cq-caramel-deep tracking-wide">CupQ · live demo</div>
            <h1 className="text-3xl font-extrabold text-cq-roast">Order a coffee and watch it travel</h1>
            <p className="text-cq-ink-2 mt-1 max-w-[70ch]">
              This is the real system. Order by text below, or on your own phone with the QR code, then press Next to play the barista.
            </p>
          </div>
          <a href="https://cupq.com.au" className="text-sm font-semibold text-cq-caramel-deep underline underline-offset-4">Back to cupq.com.au</a>
        </header>

        <ol className="flex flex-wrap gap-2" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.key} className={`px-3 h-9 inline-flex items-center rounded-full text-sm font-bold ${i < step ? 'bg-cq-ready text-white' : i === step ? 'bg-cq-roast text-cq-cream' : 'bg-cq-wash text-cq-ink-3'}`}>
              {i + 1}. {s.title}
            </li>
          ))}
        </ol>

        {error && <div role="alert" className="rounded-cq-md bg-cq-alert-wash text-cq-alert font-semibold p-3 text-sm">{error} <button type="button" onClick={begin} className="underline ml-2">Start again</button></div>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          {/* The customer */}
          <div className="space-y-4 min-w-0">
            {!order || order.via === 'text' ? (
              <Panel title="Your phone: texts" hint={session ? `From ${session.phone}, a demo number. Shown here, never sent.` : ''}>
                <div className="rounded-[2rem] border-8 border-cq-roast bg-white overflow-hidden flex flex-col">
                  <div className="px-3 py-2 text-center text-xs font-semibold text-cq-ink-2 bg-cq-wash">Messages · CupQ</div>
                  <div className="p-3 space-y-2 h-72 overflow-y-auto">
                    {texts.length === 0 && <p className="text-sm text-cq-ink-3 text-center pt-6">Pick a coffee below, or type "Hi".</p>}
                    {texts.map((t) => {
                      const mine = t.direction === 'in';
                      return (
                        <div key={t.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${mine ? 'rounded-br-md' : 'rounded-bl-md'}`}
                            style={mine ? { background: '#0A84FF', color: '#fff' } : { background: '#E9E9EB', color: '#111' }}>{t.body}</div>
                        </div>
                      );
                    })}
                    <div ref={endRef} />
                  </div>
                  <form className="flex gap-2 p-2 border-t border-cq-line" onSubmit={(e) => { e.preventDefault(); const t = draft; setDraft(''); send(t); }}>
                    <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Text the coffee cart" aria-label="Text message"
                      className="flex-1 min-w-0 h-10 px-3 rounded-full border-2 border-cq-line text-cq-roast" />
                    <button type="submit" disabled={busy || !draft.trim()} className="h-10 px-4 rounded-full bg-cq-roast text-cq-cream font-bold disabled:opacity-50">Send</button>
                  </form>
                </div>
              </Panel>
            ) : (
              <Panel title="Your phone: the order page" hint="What the customer sees. The beacon changes colour and chimes when it's ready.">
                <Scaled src={`/order?order=${order.number}`} w={390} h={760} title="Customer's order page" />
              </Panel>
            )}

            {!order && (
              <Panel title="The menu" hint="Tap your coffee and it's texted for you.">
                <div className="space-y-2">
                  <input value={pick.name} onChange={(e) => setPick({ ...pick, name: e.target.value })} placeholder="Your first name" aria-label="Your first name"
                    className="w-full h-10 px-3 rounded-cq-md border-2 border-cq-line bg-white text-cq-roast" />
                  <div className="flex flex-wrap gap-2">{menu.drinks.map((d) => <button key={d} type="button" className={chip(pick.drink === d)} onClick={() => setPick({ ...pick, drink: d })}>{d}</button>)}</div>
                  <div className="flex flex-wrap gap-2">{menu.milks.map((m) => <button key={m} type="button" className={chip(pick.milk === m)} onClick={() => setPick({ ...pick, milk: m })}>{m}</button>)}</div>
                  <div className="flex flex-wrap gap-2">{menu.sizes.map((s) => <button key={s} type="button" className={chip(pick.size === s)} onClick={() => setPick({ ...pick, size: s })}>{s}</button>)}</div>
                  <button type="button" disabled={busy || !session} onClick={orderByText}
                    className="w-full h-11 rounded-cq-md bg-cq-roast text-cq-cream font-extrabold disabled:opacity-50">Text my order</button>
                </div>
              </Panel>
            )}

            {!order && session && (
              <Panel title="Or use your own phone" hint="Scan with your phone's camera and order on the real page.">
                <div className="bg-white rounded-cq-lg border border-cq-line p-3 flex items-center gap-3">
                  <img alt="QR code: order on your own phone" width={132} height={132} src={`/api/qr?size=5&data=${encodeURIComponent(phoneUrl)}`} />
                  <p className="text-sm text-cq-ink-2">Your phone shows the real order page and pickup beacon. This screen shows everything behind the counter.</p>
                </div>
              </Panel>
            )}
          </div>

          {/* The barista */}
          <div className="space-y-4 min-w-0">
            <Panel title="Next step">
              <div className="bg-cq-milk rounded-cq-xl shadow-cq-card p-4 space-y-3">
                {!order && <p className="text-cq-ink-2">Order a coffee first. It appears on the barista's screen straight away.</p>}
                {order && !done && (
                  <>
                    <button type="button" disabled={busy} onClick={() => advance(nextStep.next)}
                      className="w-full h-12 rounded-cq-md bg-cq-caramel text-white font-extrabold text-lg disabled:opacity-50">{nextStep.button}</button>
                    <label className="flex items-center gap-2 text-sm text-cq-ink-2">
                      <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Play the rest automatically
                    </label>
                  </>
                )}
                {done && (
                  <div className="space-y-3">
                    <p className="font-bold text-cq-roast">That's CupQ: ordered, made, labelled, collected, and nobody queued.</p>
                    <div className="flex flex-wrap gap-2">
                      <a href="https://cupq.app/start" className="h-11 px-4 inline-flex items-center rounded-cq-md bg-cq-roast text-cq-cream font-bold">Get started</a>
                      <a href="https://cupq.com.au/#demo" className="h-11 px-4 inline-flex items-center rounded-cq-md border-2 border-cq-line text-cq-roast font-bold">Book a demo</a>
                      <button type="button" onClick={begin} className="h-11 px-4 rounded-cq-md text-cq-caramel-deep font-bold underline underline-offset-4">Try again</button>
                    </div>
                  </div>
                )}
              </div>
            </Panel>

            <Panel title="The barista's screen" hint="Every order lands here, with the milk and size up front.">
              {order ? (
                <div className="bg-white rounded-cq-lg border-4 border-cq-roast p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-2xl font-extrabold text-cq-roast">{order.name || 'Guest'} <span className="text-cq-ink-3">#{order.number}</span></div>
                      <div className="text-cq-ink-2 capitalize">{[order.size, order.milk, order.drink].filter(Boolean).join(' · ')}</div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${step >= 3 ? 'bg-cq-ready text-white' : step === 2 ? 'bg-cq-caramel text-white' : 'bg-cq-wash text-cq-roast'}`}>
                      {step >= 4 ? 'Collected' : step === 3 ? 'Ready' : step === 2 ? 'Making' : 'New'}
                    </span>
                  </div>
                </div>
              ) : <div className="rounded-cq-lg border-4 border-dashed border-cq-line p-6 text-center text-sm text-cq-ink-3">Waiting for your order</div>}
            </Panel>

            <Panel title="The cup label" hint="Printed the moment the barista starts it.">
              <div className="rounded-cq-lg border-4 border-cq-roast bg-white p-3 flex items-center justify-center min-h-[7rem]">
                {order && step >= 2
                  ? <img key={labelKey} alt={`Cup label for order ${order.number}`} className="max-w-full h-auto" src={`/api/try/label?token=${encodeURIComponent(session.token)}&k=${labelKey}`} />
                  : <span className="text-sm text-cq-ink-3">Prints when the coffee is started</span>}
              </div>
            </Panel>
          </div>

          {/* The room */}
          <div className="space-y-4 min-w-0">
            <Panel title="The pickup board" hint="On a screen by the cart. Names appear when they're ready.">
              <Scaled src={`/display?mode=pickup${order?.station_id ? `&station=${order.station_id}` : ''}`} w={1080} h={1920} title="Pickup board" />
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
