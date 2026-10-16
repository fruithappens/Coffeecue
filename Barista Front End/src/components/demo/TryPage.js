// TryPage.js — demo.cupq.app/try: order a coffee and watch it travel.
//
// Public and self-guided, on the real system. Step 1 picks one of the four
// ways people order at an event, each shown as the REAL screen in its
// device: the phone page from the QR (or on your own phone), a text to the
// cart, the touchscreen at the cart, and the same phone page inside an
// event app (how EventsAir shows it). Then Next plays the barista: Start,
// Ready, Collected, through the real barista routes (routes/try_routes.py),
// so the texts, the cup label, the customer's watch screen and the board
// all change for real. Autoplay does the presses.
//
// Orders placed in the frames carry the session's tag (?src=), which is how
// this page finds them; texts come from the session's demo number.
// /try/phone?src=… is where the QR lands on the visitor's own phone.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QrCode, MessageCircle, MonitorSmartphone, AppWindow, UserPlus, Menu, ArrowLeft, Bean, Home, CalendarPlus, Lock } from 'lucide-react';

const METHODS = [
  { key: 'qr', Icon: QrCode, title: 'Scan the QR', line: 'Order from your seat on the phone page' },
  { key: 'sms', Icon: MessageCircle, title: 'Text the cart', line: 'Plain English, any phone, no app' },
  { key: 'kiosk', Icon: MonitorSmartphone, title: 'Touchscreen', line: 'At the cart, for anyone without a phone' },
  { key: 'app', Icon: AppWindow, title: 'In the event app', line: 'Inside EventsAir, without leaving the app' },
];
const STEPS = [
  { title: 'Order', next: null },
  { title: 'Barista starts it', next: 'start', button: 'Next: barista taps Start' },
  { title: 'Ready to collect', next: 'ready', button: 'Next: barista taps Ready' },
  { title: 'Collected', next: 'collect', button: 'Next: they collect it' },
];
const STATUS_STEP = { pending: 1, 'in-progress': 2, in_progress: 2, completed: 3, ready: 3, picked_up: 4, collected: 4 };
const AUTOPLAY_MS = 4500;
const CAME_FROM = { qr: 'from the phone page (QR)', sms: 'by text', kiosk: 'from the touchscreen', app: 'from the event app' };

async function call(path, opts = {}) {
  const r = await fetch(`/api/try${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.success === false) {
    const err = new Error(b.message || `Something went wrong (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return b;
}

// A page at its real size (w x h), scaled down to fill its box's width.
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
    <div ref={ref} className="relative overflow-hidden bg-white" style={{ height: h * scale }}>
      <iframe src={src} title={title} style={{ width: w, height: h, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div>
  );
}

const Phone = ({ children }) => (
  <div className="mx-auto w-full max-w-[340px] rounded-[2.6rem] bg-cq-roast p-3 shadow-cq-raised">
    <div className="rounded-[2rem] overflow-hidden bg-white">
      <div className="h-6 bg-cq-roast/90 flex items-center justify-center"><div className="w-20 h-1.5 rounded-full bg-black/40" /></div>
      {children}
    </div>
  </div>
);

// Upright, like the iPad on its stand at the cart.
const Tablet = ({ children }) => (
  <div className="mx-auto w-full max-w-[400px] rounded-[1.6rem] bg-cq-roast p-3 shadow-cq-raised">
    <div className="rounded-[1rem] overflow-hidden bg-white">{children}</div>
  </div>
);

// How a page looks inside an event app (Steve's EventsAir screenshots, 16 Oct
// 2026): the app's own top bar, a coloured page header, the page, and the
// app's tab bar with Coffee Order? highlighted. Laid out like EventsAir but
// with no vendor's or client's name or logo: this repo and page are public.
const AppShell = ({ children }) => (
  <>
    <div className="h-10 bg-white flex items-center justify-between px-3 text-[#E39462]">
      <UserPlus size={18} /><Menu size={20} />
    </div>
    <div className="h-11 bg-[#E39462] text-cq-roast-deep flex items-center px-3">
      <ArrowLeft size={18} />
      <span className="flex-1 flex items-center justify-center gap-1.5 font-bold text-[15px] -ml-4"><Bean size={16} /> Coffee Order?</span>
    </div>
    {children}
    <div className="h-14 bg-[#2B2A4C] grid grid-cols-4 items-center text-[10px] font-semibold px-1">
      {[[Home, 'Home'], [Bean, 'Coffee Order?'], [CalendarPlus, 'My Agenda'], [MessageCircle, 'Ask AI']].map(([I, l]) => (
        <div key={l} className={`flex flex-col items-center justify-center gap-0.5 ${
          l === 'Coffee Order?' ? 'text-white' : l === 'Ask AI' ? 'bg-white text-[#2B2A4C] rounded-md mx-1.5 py-1' : 'text-white/55'}`}>
          <I size={16} />{l}
        </div>
      ))}
    </div>
  </>
);

// The event app opening: it asks for the event's code first, as event apps
// do. The demo fills it in; Submit opens the app on its Coffee Order? page.
const AppSplash = ({ onOpen }) => (
  <div className="h-[560px] flex flex-col items-center justify-between px-5 py-10 text-white"
    style={{ background: 'linear-gradient(160deg, #5B2BD0 0%, #3A1E9C 45%, #160C55 100%)' }}>
    <div className="text-center">
      <div className="text-sm font-bold opacity-90">Your</div>
      <div className="text-4xl font-extrabold tracking-tight leading-none">EVENT<span className="text-[#9F86FF]">APP</span></div>
    </div>
    <div className="w-full rounded-2xl bg-white p-4 text-cq-ink space-y-3 shadow-lg">
      <div className="text-center font-bold text-sm">Please enter your Event Code:</div>
      <div className="h-10 rounded-lg bg-[#F4F4FB] flex items-center gap-2 px-3 text-sm"><Lock size={14} className="text-cq-ink-3" /> CUPQLIVE</div>
      <button type="button" onClick={onOpen} className="w-full h-10 rounded-full bg-[#6F35E8] text-white font-bold text-sm">Submit</button>
    </div>
    <div className="text-xs opacity-70">The organiser's event app</div>
  </div>
);

// The moment that sells it (Steve, 16 Oct 2026): the phone is in a pocket,
// locked, and the "your coffee is ready" text lights it up. Shown when the
// barista taps Ready; tap the notification (or the next step) to go on.
function LockScreen({ body, onOpen }) {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[ap]m$/i, '');
  const date = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="h-[560px] flex flex-col items-center px-4 pt-10 text-white"
      style={{ background: 'radial-gradient(120% 80% at 50% 0%, #6b4a33 0%, #3B2314 45%, #160c06 100%)' }}>
      <div className="text-sm font-semibold opacity-85">{date}</div>
      <div className="text-7xl font-light tracking-tight leading-none mt-1">{time}</div>
      <button type="button" onClick={onOpen}
        className="mt-10 w-full text-left rounded-2xl bg-white/85 text-[#111] p-3 shadow-lg backdrop-blur animate-[cqdrop_.5s_ease-out]">
        <div className="flex items-center gap-2 text-[11px] text-[#555]">
          <span className="w-5 h-5 rounded-md bg-[#34C759] inline-flex items-center justify-center"><MessageCircle size={12} color="#fff" /></span>
          <span className="font-semibold uppercase tracking-wide">Messages</span>
          <span className="ml-auto">now</span>
        </div>
        <div className="mt-1.5 text-sm font-bold">CupQ</div>
        <div className="text-sm leading-snug">{body}</div>
      </button>
      <div className="mt-auto mb-6 text-xs opacity-70">Tap the message to open it</div>
      <style>{'@keyframes cqdrop{from{transform:translateY(-24px)}to{transform:none}}'}</style>
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
  const [method, setMethod] = useState('qr');
  const [error, setError] = useState('');
  const [texts, setTexts] = useState([]);
  const [order, setOrder] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [labelKey, setLabelKey] = useState(0);
  const [appOpen, setAppOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { document.title = 'Try CupQ live'; }, []);

  const begin = useCallback(async () => {
    setError(''); setTexts([]); setOrder(null); setAuto(false);
    // Orders placed in the frames below are tagged as demo orders.
    try { sessionStorage.setItem('cupq_demo', '1'); } catch (e) { /* private mode */ }
    try { setSession(await call('/session', { method: 'POST' })); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { begin(); }, [begin]);

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

  // Autoplay. Keyed on the order's STATUS, not the order object: the poll
  // hands back a new object every 2 seconds, which restarted this timer.
  const orderStatus = order ? String(order.status) : '';
  const nextAction = nextStep?.next || '';
  useEffect(() => {
    if (!auto || !orderStatus || done || busy || !nextAction) return undefined;
    const t = setTimeout(() => advance(nextAction), AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [auto, orderStatus, done, busy, nextAction, advance]);

  const src = session?.src || '';
  const phoneUrl = session ? `${window.location.origin}/try/phone?src=${src}` : '';
  const placed = !!order;
  const viaText = order?.via === 'text';

  // Ready: the phone locks and the text arrives on the lock screen.
  useEffect(() => { setLocked(step === 3); }, [step]);
  const readyText = (() => {
    const t = [...texts].reverse().find((x) => x.direction !== 'in' && /ready/i.test(x.body || ''));
    if (t) return t.body;
    const what = [order?.size, order?.drink].filter(Boolean).join(' ') || 'coffee';
    return `${order?.name ? `${order.name}, your` : 'Your'} ${what} is ready. Collect it from the cart.`;
  })();

  const textThread = (canType) => (
    <div className="flex flex-col h-[560px]">
      <div className="px-3 py-2 text-center text-xs font-semibold text-cq-ink-2 bg-cq-wash">CupQ · from {session?.phone}</div>
      <div className="flex-1 p-3 space-y-2 overflow-y-auto">
        {texts.length === 0 && (
          <div className="text-center pt-6 space-y-3">
            <p className="text-sm text-cq-ink-3">Text the cart like you'd text a friend.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {['Hi', 'Large oat flat white for Sam'].map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="h-8 px-3 rounded-full bg-cq-wash text-cq-roast text-sm font-semibold">{s}</button>
              ))}
            </div>
          </div>
        )}
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
      {canType && (
        <form className="flex gap-2 p-2 border-t border-cq-line" onSubmit={(e) => { e.preventDefault(); const t = draft; setDraft(''); send(t); }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Text message" aria-label="Text message"
            className="flex-1 min-w-0 h-10 px-3 rounded-full border-2 border-cq-line text-cq-roast" />
          <button type="submit" disabled={busy || !draft.trim()} className="h-10 px-4 rounded-full bg-cq-roast text-cq-cream font-bold disabled:opacity-50">Send</button>
        </form>
      )}
    </div>
  );

  // The customer's side: the chosen way to order, then their watch screen.
  const customer = () => {
    if (!session) return <div className="text-cq-ink-3 p-6">Setting up your demo…</div>;
    if (placed && locked) return <Phone><LockScreen body={readyText} onOpen={() => setLocked(false)} /></Phone>;
    if (placed && viaText) return <Phone>{textThread(false)}</Phone>;
    if (placed) {
      const watch = `/order?order=${order.number}`;
      return method === 'app'
        ? <Phone><AppShell><Scaled src={watch} w={390} h={700} title="Their watch screen" /></AppShell></Phone>
        : <Phone><Scaled src={watch} w={390} h={760} title="Their watch screen" /></Phone>;
    }
    if (method === 'sms') return <Phone>{textThread(true)}</Phone>;
    if (method === 'kiosk') return <Tablet><Scaled key={`kiosk-${src}`} src={`/display?kiosk=1&open=1&src=${src}`} w={834} h={1112} title="Touchscreen at the cart" /></Tablet>;
    if (method === 'app') {
      return appOpen
        ? <Phone><AppShell><Scaled key={`app-${src}`} src={`/order?new=1&src=${src}`} w={390} h={700} title="Ordering in the event app" /></AppShell></Phone>
        : <Phone><AppSplash onOpen={() => setAppOpen(true)} /></Phone>;
    }
    return <Phone><Scaled key={`qr-${src}`} src={`/order?new=1&src=${src}`} w={390} h={760} title="The phone ordering page" /></Phone>;
  };

  return (
    <div className="cq min-h-screen bg-cq-cream px-4 py-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-cq-caramel-deep tracking-wide">CupQ · live demo</div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-cq-roast">Order a coffee and watch it travel</h1>
            <p className="text-cq-ink-2 mt-1 max-w-[70ch]">The real system. Pick how you'd order, place it, then play the barista.</p>
          </div>
          <a href="https://cupq.com.au" className="text-sm font-semibold text-cq-caramel-deep underline underline-offset-4">Back to cupq.com.au</a>
        </header>

        {/* Four ways in */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" role="tablist" aria-label="How to order">
          {METHODS.map((m) => {
            const on = method === m.key;
            return (
              <button key={m.key} type="button" role="tab" aria-selected={on} disabled={placed}
                onClick={() => { setMethod(m.key); if (m.key === 'app') setAppOpen(false); }}
                className={`text-left rounded-cq-lg p-3 border-2 transition-colors disabled:cursor-default ${on ? 'bg-cq-roast border-cq-roast text-cq-cream' : 'bg-cq-milk border-cq-line text-cq-roast hover:border-cq-caramel'} ${placed && !on ? 'opacity-50' : ''}`}>
                <m.Icon size={22} />
                <div className="font-extrabold mt-1">{m.title}</div>
                <div className={`text-xs ${on ? 'text-cq-cream/80' : 'text-cq-ink-3'}`}>{m.line}</div>
              </button>
            );
          })}
        </div>

        {error && <div role="alert" className="rounded-cq-md bg-cq-alert-wash text-cq-alert font-semibold p-3 text-sm">{error} <button type="button" onClick={begin} className="underline ml-2">Start again</button></div>}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* The customer */}
          <div className="lg:col-span-5 space-y-3 min-w-0">
            <h2 className="text-lg font-extrabold text-cq-roast">{placed ? 'Their phone, watching' : 'You, ordering'}</h2>
            <p className="text-sm text-cq-ink-3 -mt-2">
              {placed
                ? (viaText ? 'Every step arrives as a text.' : 'The beacon changes colour and chimes when it\'s ready.')
                : method === 'sms' ? `You're texting from ${session?.phone || 'a demo number'}. Shown here, never sent.`
                  : method === 'kiosk' ? 'Tap a drink, add a name. A phone number is optional.'
                    : 'Tap a drink, add your name, done.'}
            </p>
            {customer()}
            {!placed && method === 'qr' && session && (
              <div className="bg-cq-milk rounded-cq-lg border border-cq-line p-3 flex items-center gap-3">
                <img alt="QR code: order on your own phone" width={110} height={110} src={`/api/qr?size=4&data=${encodeURIComponent(phoneUrl)}`} />
                <p className="text-sm text-cq-ink-2"><b className="text-cq-roast">Use your own phone.</b> Scan this and order there; this screen keeps showing everything behind the counter.</p>
              </div>
            )}
          </div>

          {/* Behind the counter */}
          <div className="lg:col-span-7 space-y-4 min-w-0">
            <h2 className="text-lg font-extrabold text-cq-roast">Behind the counter</h2>
            <ol className="flex flex-wrap gap-2 -mt-1" aria-label="Steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className={`px-3 h-8 inline-flex items-center rounded-full text-xs font-bold ${i < step ? 'bg-cq-ready text-white' : i === step ? 'bg-cq-roast text-cq-cream' : 'bg-cq-wash text-cq-ink-3'}`}>{i + 1}. {s.title}</li>
              ))}
            </ol>

            <div className="bg-cq-milk rounded-cq-xl shadow-cq-card p-4">
              {!placed && <p className="text-cq-ink-2">Place your order on the left. It lands on the barista's screen the moment you send it.</p>}
              {placed && !done && (
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" disabled={busy} onClick={() => advance(nextStep.next)}
                    className="h-12 px-5 rounded-cq-md bg-cq-caramel text-white font-extrabold text-lg disabled:opacity-50">{nextStep.button}</button>
                  <label className="flex items-center gap-2 text-sm text-cq-ink-2">
                    <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Play the rest for me
                  </label>
                </div>
              )}
              {done && (
                <div className="space-y-3">
                  <p className="font-bold text-cq-roast">Ordered, made, labelled, collected, and nobody stood in a queue.</p>
                  <div className="flex flex-wrap gap-2">
                    <a href="https://cupq.app/start" className="h-11 px-4 inline-flex items-center rounded-cq-md bg-cq-roast text-cq-cream font-bold">Get started</a>
                    <a href="https://cupq.com.au/#demo" className="h-11 px-4 inline-flex items-center rounded-cq-md border-2 border-cq-line text-cq-roast font-bold">Book a demo</a>
                    <button type="button" onClick={begin} className="h-11 px-4 rounded-cq-md text-cq-caramel-deep font-bold underline underline-offset-4">Try another way</button>
                  </div>
                </div>
              )}
            </div>

            {/* The board stands upright beside the cart, like the tablet at
                Treenet: sponsors on top, Ready and Brewing, and the event's
                artwork filling the rest. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              <div className="space-y-4 min-w-0">
                <Panel title="The barista's screen" hint="Milk and size up front, every order in one queue.">
                  {placed ? (
                    <div className="bg-white rounded-cq-lg border-4 border-cq-roast p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-2xl font-extrabold text-cq-roast truncate">{order.name || 'Guest'} <span className="text-cq-ink-3">#{order.number}</span></div>
                          <div className="text-cq-ink-2 capitalize">{[order.size, order.milk, order.drink].filter(Boolean).join(' · ')}</div>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${step >= 3 ? 'bg-cq-ready text-white' : step === 2 ? 'bg-cq-caramel text-white' : 'bg-cq-wash text-cq-roast'}`}>
                          {step >= 4 ? 'Collected' : step === 3 ? 'Ready' : step === 2 ? 'Making' : 'New'}
                        </span>
                      </div>
                      <div className="text-xs text-cq-ink-3 mt-2">Came in {viaText ? 'by text' : CAME_FROM[method]}</div>
                    </div>
                  ) : <div className="rounded-cq-lg border-4 border-dashed border-cq-line p-6 text-center text-sm text-cq-ink-3">Waiting for your order</div>}
                </Panel>
                <Panel title="The cup label" hint="Prints the moment the barista starts it.">
                  <div className="rounded-cq-lg border-4 border-cq-roast bg-white p-3 flex items-center justify-center min-h-[7.5rem]">
                    {placed && step >= 2
                      ? <img key={labelKey} alt={`Cup label for order ${order.number}`} className="max-w-full h-auto" src={`/api/try/label?token=${encodeURIComponent(session.token)}&k=${labelKey}`} />
                      : <span className="text-sm text-cq-ink-3">Prints when it's started</span>}
                  </div>
                </Panel>
              </div>
              <Panel title="The board at the cart" hint="An upright screen at the cart. Names show when they're ready.">
                <div className="mx-auto w-full max-w-[300px] rounded-[1.4rem] bg-cq-roast p-2.5 shadow-cq-raised">
                  <div className="rounded-[0.9rem] overflow-hidden">
                    <Scaled src={`/display?orientation=portrait${order?.station_id ? `&station=${order.station_id}` : ''}`} w={800} h={1280} title="The board at the cart" />
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
