// TouchBar.js — the barista's stretched touch display (/bar).
//
// A long, short screen (1920×480 class) above or beside the machine, run
// by its own small PC, replacing the docket rail. It is NOT the kiosk and
// NOT the barista tablet: it is the "what do I make next" surface you can
// hit with a wet finger without looking down at an iPad.
//
// Three screens, swiped left/right (or tapped in the top strip):
//   1. Queue    — Waiting | Making | Ready side by side, flow direction
//                 flippable (the pickup end can be left or right). Big
//                 Start / Ready / Collected buttons on every card.
//   2. Batches  — waiting orders that are the same drink, milk and cup,
//                 grouped, with one "Start all".
//   3. Stock    — the milks, tap to 86 / bring back.
//
// Hold a waiting card for half a second and it lifts: drop it between
// cards to move it, or on top of another card to batch the two (two oat
// lattes made together). The arrangement is this screen's own (kept on
// this device, per station) -- the order of service on the SERVER is
// untouched, because queue_priority already means VIP and time of day.
//
// Every action goes through useOrders, the same code the tablet uses, so
// a Start here is exactly a Start there (label print, SMS, stock).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Check, Play, Coffee, Layers, Ban, X } from 'lucide-react';
import useOrders from '../../hooks/useOrders';
import useStations from '../../hooks/useStations';
import { getMilkColor } from '../../utils/milkColorHelper';
import { reconcileUnits } from '../../utils/barUnits';
import {
  orderNumberOf, notesOf, isPriority, isDecaf, sinceQueued, sinceStarted, sinceReady,
} from './queue/orderMeta';

const HOLD_MS = 450;
const SWIPE_PX = 90;
const SCREENS = [
  { id: 'queue', label: 'Queue', Icon: Coffee },
  { id: 'batches', label: 'Batches', Icon: Layers },
  { id: 'stock', label: 'Stock', Icon: Ban },
];

const C = {
  bg: '#16110D', panel: '#221A14', card: '#2E241C', line: '#3C3026',
  ink: '#F6EFE7', ink2: '#CDBFB0', ink3: '#8F7F70',
  start: '#3B82F6', ready: '#16A34A', collect: '#6B7280', batch: '#C2854F', vip: '#E0B000',
};

const idOf = (o) => String(o.id);
const nameOf = (o) => o.customerName || o.customer_name || o.name || 'Guest';
const drinkOf = (o) => o.coffeeType || o.coffee_type || 'Coffee';
const milkOf = (o) => o.milkType || o.milk_type || '';
const sizeOf = (o) => o.size || '';
const sugarOf = (o) => o.sugar || '';
const kindKey = (o) => `${drinkOf(o)}|${milkOf(o)}|${sizeOf(o)}`.toLowerCase();
const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase());
const blackMilk = (m) => !m || /no milk/i.test(m);

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
});

const readJSON = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* view-only nicety */ } };

const TouchBar = () => {
  const params = new URLSearchParams(window.location.search);
  const { stations, selectedStation, changeSelectedStation } = useStations({ autoSelect: true });
  const urlStation = params.get('station');
  useEffect(() => {
    if (urlStation && String(urlStation) !== String(selectedStation)) changeSelectedStation(Number(urlStation));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlStation]);
  const station = urlStation ? Number(urlStation) : selectedStation;
  const stationLabel = (stations || []).find(s => String(s.id) === String(station))?.name || (station ? `Station ${station}` : '');

  const {
    pendingOrders, inProgressOrders, completedOrders,
    startOrder, completeOrder, markOrderPickedUp, refreshData,
  } = useOrders(station || null);

  // ---- per-device preferences -------------------------------------------
  const [reverse, setReverse] = useState(() => readJSON('cupq_bar_reverse', false));
  useEffect(() => writeJSON('cupq_bar_reverse', reverse), [reverse]);
  const layoutKey = `cupq_bar_units_${station || 'all'}`;
  const [savedUnits, setSavedUnits] = useState(() => readJSON(layoutKey, []));
  useEffect(() => { setSavedUnits(readJSON(layoutKey, [])); }, [layoutKey]);

  const waiting = pendingOrders || [];
  const byId = useMemo(() => new Map(
    [...waiting, ...(inProgressOrders || []), ...(completedOrders || [])].map(o => [idOf(o), o])), [waiting, inProgressOrders, completedOrders]);
  const units = useMemo(() => reconcileUnits(savedUnits, waiting), [savedUnits, waiting]);
  const saveUnits = useCallback((u) => { setSavedUnits(u); writeJSON(layoutKey, u); }, [layoutKey]);

  // ---- busy state per order, so a double tap cannot fire twice ------------
  const [busy, setBusy] = useState({});
  const run = async (ids, fn) => {
    setBusy(b => ({ ...b, ...Object.fromEntries(ids.map(i => [i, true])) }));
    try { await fn(); } finally {
      setBusy(b => { const n = { ...b }; ids.forEach(i => delete n[i]); return n; });
      refreshData && refreshData();
    }
  };
  const start = (o) => run([idOf(o)], () => startOrder(o));
  // A batch is started one order at a time through the same startOrder a
  // single tap uses, so each cup gets its own label, text and stock line.
  const startMany = (ids) => run(ids, async () => {
    for (const id of ids) {
      const o = byId.get(id);
      if (o) await startOrder(o); // eslint-disable-line no-await-in-loop
    }
  });
  const ready = (o) => run([idOf(o)], () => completeOrder(o.id));
  const collected = (o) => run([idOf(o)], () => markOrderPickedUp(o.id));

  // ---- screens + swipe ------------------------------------------------------
  const [screen, setScreen] = useState(0);
  const swipe = useRef(null);

  // ---- hold-to-lift drag ----------------------------------------------------
  const cardEls = useRef(new Map()); // unit key -> element
  const [drag, setDrag] = useState(null); // {key, x0, dx, over:{key, mode}}
  const hold = useRef(null);

  const unitKey = (u) => u.join('+');
  const visualUnits = reverse ? [...units].reverse() : units;

  const targetAt = (clientX, selfKey) => {
    const rects = visualUnits
      .map(u => unitKey(u))
      .filter(k => k !== selfKey)
      .map(k => ({ k, r: cardEls.current.get(k)?.getBoundingClientRect() }))
      .filter(x => x.r);
    for (const { k, r } of rects) {
      const inner = r.width * 0.25;
      if (clientX > r.left + inner && clientX < r.right - inner) return { key: k, mode: 'merge' };
    }
    // Otherwise: insert before the first card whose middle is to the right.
    const before = rects.find(({ r }) => clientX < r.left + r.width / 2);
    return { key: before ? before.k : null, mode: 'before' };
  };

  const onCardPointerDown = (e, key) => {
    if (e.button !== undefined && e.button !== 0) return;
    const x = e.clientX, y = e.clientY, el = e.currentTarget, pid = e.pointerId;
    hold.current = { x, y, timer: setTimeout(() => {
      try { el.setPointerCapture(pid); } catch (er) { /* fine without */ }
      if (navigator.vibrate) navigator.vibrate(15);
      setDrag({ key, x0: x, dx: 0, over: null });
    }, HOLD_MS) };
  };
  const onCardPointerMove = (e) => {
    if (drag) {
      e.stopPropagation();
      setDrag(d => d && ({ ...d, dx: e.clientX - d.x0, over: targetAt(e.clientX, d.key) }));
      return;
    }
    const h = hold.current;
    if (h && (Math.abs(e.clientX - h.x) > 10 || Math.abs(e.clientY - h.y) > 10)) {
      clearTimeout(h.timer); hold.current = null; // a swipe or scroll, not a hold
    }
  };
  const endHold = () => { if (hold.current) { clearTimeout(hold.current.timer); hold.current = null; } };
  const onCardPointerUp = (e) => {
    endHold();
    if (!drag) return;
    e.stopPropagation();
    const over = targetAt(e.clientX, drag.key);
    const moving = units.find(u => unitKey(u) === drag.key);
    setDrag(null);
    if (!moving) return;
    let rest = units.filter(u => unitKey(u) !== drag.key);
    if (over.mode === 'merge' && over.key) {
      rest = rest.map(u => (unitKey(u) === over.key ? [...u, ...moving] : u));
      saveUnits(rest);
      return;
    }
    // Insert in VISUAL order, then store in logical (flow) order.
    let vis = reverse ? [...rest].reverse() : rest;
    const at = over.key ? vis.findIndex(u => unitKey(u) === over.key) : vis.length;
    vis = [...vis.slice(0, at < 0 ? vis.length : at), moving, ...vis.slice(at < 0 ? vis.length : at)];
    saveUnits(reverse ? vis.reverse() : vis);
  };
  const ungroup = (key) => saveUnits(units.flatMap(u => (unitKey(u) === key ? u.map(id => [id]) : [u])));

  const onBodyPointerDown = (e) => { if (!drag) swipe.current = { x: e.clientX, y: e.clientY }; };
  const onBodyPointerUp = (e) => {
    const s = swipe.current; swipe.current = null;
    if (!s || drag) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dy) < 80) {
      setScreen(i => Math.max(0, Math.min(SCREENS.length - 1, i + (dx < 0 ? 1 : -1))));
    }
  };

  // ---- a clock for the timers on the cards --------------------------------
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 15000); return () => clearInterval(t); }, []);

  // ---- pieces -----------------------------------------------------------------
  const MilkChip = ({ milk }) => (blackMilk(milk) ? (
    <span className="px-2 py-0.5 rounded-full text-sm font-bold" style={{ background: C.line, color: C.ink2 }}>Black</span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-sm font-bold" style={{ background: C.line, color: C.ink }}>
      <span className="inline-block w-3 h-3 rounded-full" style={{ background: getMilkColor(titleCase(milk)) || '#fff' }} />
      {titleCase(milk)}
    </span>
  ));

  const OrderFace = ({ o, compact }) => (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xl font-black tabular-nums" style={{ color: C.ink2 }}>#{orderNumberOf(o)}</span>
        <span className="flex gap-1">
          {isPriority(o) && <span className="px-1.5 rounded text-xs font-black" style={{ background: C.vip, color: '#000' }}>VIP</span>}
          {isDecaf(o) && <span className="px-1.5 rounded text-xs font-black" style={{ background: '#7C3AED', color: '#fff' }}>DECAF</span>}
        </span>
      </div>
      <div className={`${compact ? 'text-2xl' : 'text-4xl'} font-black leading-none mt-1 truncate`} style={{ color: C.ink }}>{nameOf(o)}</div>
      <div className={`${compact ? 'text-base' : 'text-xl'} font-bold mt-2 leading-tight`} style={{ color: C.ink }}>
        {titleCase([sizeOf(o), drinkOf(o)].filter(Boolean).join(' '))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {MilkChip({ milk: milkOf(o) })}
        {sugarOf(o) && !/no sugar/i.test(sugarOf(o)) && (
          <span className="px-2 py-0.5 rounded-full text-sm font-bold" style={{ background: C.line, color: C.ink }}>{sugarOf(o)}</span>
        )}
      </div>
      {!compact && notesOf(o) && (
        <div className="mt-1.5 text-sm font-semibold line-clamp-2" style={{ color: '#FBBF24' }}>“{notesOf(o)}”</div>
      )}
    </>
  );

  const BigButton = ({ onClick, color, disabled, children, label }) => (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={disabled}
      aria-label={label}
      className="w-full mt-auto rounded-xl py-4 text-xl font-black flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-50"
      style={{ background: color, color: '#fff', minHeight: 64 }}>
      {children}
    </button>
  );

  const cardBase = 'rounded-2xl p-3 flex flex-col flex-shrink-0 select-none';

  const WaitingUnit = ({ u }) => {
    const key = unitKey(u);
    const orders = u.map(id => byId.get(id)).filter(Boolean);
    if (!orders.length) return null;
    const lifted = drag?.key === key;
    const mergeTarget = drag && drag.over?.mode === 'merge' && drag.over.key === key;
    const insertBefore = drag && drag.over?.mode === 'before' && drag.over.key === key;
    const isBatch = orders.length > 1;
    const anyBusy = u.some(id => busy[id]);
    return (
      <div className="flex items-stretch flex-shrink-0">
        {insertBefore && <div className="w-1.5 rounded-full mr-2" style={{ background: C.batch }} />}
        <div
          ref={el => { if (el) cardEls.current.set(key, el); else cardEls.current.delete(key); }}
          onPointerDown={(e) => onCardPointerDown(e, key)}
          onPointerMove={onCardPointerMove}
          onPointerUp={onCardPointerUp}
          onPointerCancel={() => { endHold(); setDrag(null); }}
          onContextMenu={(e) => e.preventDefault()}
          className={cardBase}
          style={{
            width: isBatch ? 150 * orders.length + 90 : 236,
            background: isBatch ? '#3A2A1C' : C.card,
            border: `3px solid ${mergeTarget ? C.batch : (isBatch ? C.batch : 'transparent')}`,
            transform: lifted ? `translateX(${drag.dx}px) scale(1.04)` : undefined,
            boxShadow: lifted ? '0 18px 40px rgba(0,0,0,0.55)' : undefined,
            zIndex: lifted ? 30 : undefined,
            position: 'relative',
            touchAction: 'pan-x',
          }}>
          {isBatch ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-black uppercase tracking-wider" style={{ color: C.batch }}>
                  <Layers size={14} className="inline -mt-0.5 mr-1" />Batch · {orders.length}
                </span>
                <button onPointerDown={e => e.stopPropagation()} onClick={() => ungroup(key)}
                  className="p-1 rounded" style={{ color: C.ink3 }} aria-label="Split batch"><X size={18} /></button>
              </div>
              <div className="flex gap-2 flex-1 min-h-0">
                {orders.map(o => (
                  <div key={idOf(o)} className="rounded-xl p-2 flex-1 min-w-0" style={{ background: C.card }}>
                    {OrderFace({ o, compact: true })}
                  </div>
                ))}
              </div>
              {BigButton({ color: C.start, disabled: anyBusy, onClick: () => startMany(u), label: `Start ${orders.length}`,
                children: <><Play size={24} /> START {orders.length}</> })}
            </>
          ) : (
            <>
              {OrderFace({ o: orders[0] })}
              <div className="text-sm font-semibold mt-1" style={{ color: C.ink3 }}>{sinceQueued(orders[0])}</div>
              {BigButton({ color: C.start, disabled: anyBusy, onClick: () => start(orders[0]), label: 'Start',
                children: <><Play size={24} /> START</> })}
            </>
          )}
        </div>
      </div>
    );
  };

  const LiveCard = ({ o, kind }) => (
    <div className={cardBase} style={{ width: 236, background: C.card,
      border: `3px solid ${kind === 'ready' ? C.ready : '#F59E0B'}` }}>
      {OrderFace({ o })}
      <div className="text-sm font-semibold mt-1" style={{ color: C.ink3 }}>
        {kind === 'ready' ? sinceReady(o) : sinceStarted(o)}
      </div>
      {kind === 'making' ? (
        BigButton({ color: C.ready, disabled: busy[idOf(o)], onClick: () => ready(o), label: 'Ready',
          children: <><Check size={26} /> READY</> })
      ) : (
        BigButton({ color: C.collect, disabled: busy[idOf(o)], onClick: () => collected(o), label: 'Collected',
          children: <>COLLECTED</> })
      )}
    </div>
  );

  const Lane = ({ key, title, count, color, grow, children, empty }) => (
    <section key={key} className="flex flex-col min-w-0 h-full"
      style={{ flex: grow ? '1 1 0' : '0 1 auto', maxWidth: grow ? undefined : (count === 0 ? 220 : '34%') }}>
      <div className="flex items-center gap-2 px-1 mb-1.5">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <span className="text-sm font-black uppercase tracking-widest" style={{ color: C.ink2 }}>{title}</span>
        <span className="text-sm font-black tabular-nums" style={{ color: C.ink3 }}>{count}</span>
      </div>
      <div className={`flex gap-3 overflow-x-auto overflow-y-hidden flex-1 min-h-0 pb-1 ${reverse ? 'flex-row-reverse' : ''}`}
        style={{
          scrollbarWidth: 'none',
          // A soft edge where the lane runs on past the screen, so a cut-off
          // card reads as "more this way", not as a broken layout.
          ...(count > 1 ? (() => {
            const m = `linear-gradient(to ${reverse ? 'left' : 'right'}, #000 calc(100% - 56px), transparent)`;
            return { WebkitMaskImage: m, maskImage: m };
          })() : {}),
        }}>
        {count === 0 ? (
          <div className="flex items-center justify-center rounded-2xl text-lg font-bold px-6 w-full"
            style={{ border: `2px dashed ${C.line}`, color: C.ink3, width: 200, textAlign: 'center' }}>{empty}</div>
        ) : children}
      </div>
    </section>
  );

  const readyShown = (completedOrders || []).slice(0, 8);
  const lanes = [
    Lane({ key: 'w', title: 'Waiting', count: waiting.length, color: C.start, grow: true, empty: 'Nothing waiting. Nice work.',
      children: (reverse ? [...units].reverse() : units).map(u => <React.Fragment key={unitKey(u)}>{WaitingUnit({ u })}</React.Fragment>) }),
    Lane({ key: 'm', title: 'Making', count: (inProgressOrders || []).length, color: '#F59E0B', empty: 'Tap START on a card',
      children: (inProgressOrders || []).map(o => <React.Fragment key={idOf(o)}>{LiveCard({ o, kind: 'making' })}</React.Fragment>) }),
    Lane({ key: 'r', title: 'Ready', count: readyShown.length, color: C.ready, empty: 'Ready drinks show here',
      children: readyShown.map(o => <React.Fragment key={idOf(o)}>{LiveCard({ o, kind: 'ready' })}</React.Fragment>) }),
  ];

  // Batches screen: same drink, milk and cup, two or more waiting.
  const suggestions = useMemo(() => {
    const g = new Map();
    for (const o of waiting) { const k = kindKey(o); g.set(k, [...(g.get(k) || []), o]); }
    return [...g.values()].filter(list => list.length > 1).sort((a, b) => b.length - a.length);
  }, [waiting]);

  // Stock screen: milks, 86 / back.
  const [milks, setMilks] = useState([]);
  const [dead, setDead] = useState({});
  const loadStock = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([
        fetch('/api/display/menu', { cache: 'no-cache' }).then(r => r.json()),
        fetch('/api/stock-overrides', { headers: authHeaders() }).then(r => r.json()),
      ]);
      setMilks((m?.menu?.milks || []).filter(x => !/no milk/i.test(x.value || '')));
      const d = {};
      for (const o of (s?.overrides || s?.items || [])) {
        if (o.state === '86' && !o.station_id && String(o.category).toLowerCase() === 'milk') d[String(o.item_name || o.name).toLowerCase()] = true;
      }
      setDead(d);
    } catch (e) { /* the queue still works */ }
  }, []);
  useEffect(() => { if (SCREENS[screen].id === 'stock') loadStock(); }, [screen, loadStock]);
  const toggle86 = async (value) => {
    await fetch('/api/stock-overrides', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ category: 'milk', name: value, state: dead[value] ? 'clear' : '86' }),
    }).catch(() => null);
    loadStock();
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden" style={{ background: C.bg, color: C.ink, fontFamily: 'inherit' }}>
      {/* top strip */}
      <header className="flex items-center gap-4 px-4 flex-shrink-0" style={{ height: 48, background: C.panel, borderBottom: `1px solid ${C.line}` }}>
        <span className="text-lg font-black tracking-wide" style={{ color: C.ink }}>{stationLabel || 'Bar'}</span>
        <nav className="flex gap-1 mx-auto" aria-label="Screens">
          {SCREENS.map((s, i) => (
            <button key={s.id} onClick={() => setScreen(i)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-base font-bold"
              style={i === screen ? { background: C.batch, color: '#fff' } : { color: C.ink3 }}>
              <s.Icon size={16} /> {s.label}
              {s.id === 'batches' && suggestions.length > 0 && (
                <span className="ml-1 px-1.5 rounded-full text-xs font-black" style={{ background: '#fff', color: C.bg }}>{suggestions.length}</span>
              )}
            </button>
          ))}
        </nav>
        <span className="text-base font-bold tabular-nums" style={{ color: C.ink2 }}>
          {waiting.length} waiting · {(inProgressOrders || []).length} making
        </span>
        <button onClick={() => setReverse(r => !r)} aria-label="Flip flow direction"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold"
          style={{ background: C.line, color: C.ink }}>
          <ArrowLeftRight size={16} /> {reverse ? 'Ready ← Waiting' : 'Waiting → Ready'}
        </button>
      </header>

      {/* screens */}
      <div className="flex-1 min-h-0 relative"
        onPointerDown={onBodyPointerDown} onPointerUp={onBodyPointerUp}>
        <div className="absolute inset-0 flex transition-transform duration-300"
          style={{ width: `${SCREENS.length * 100}%`, transform: `translateX(-${(100 / SCREENS.length) * screen}%)` }}>
          {/* 1. queue */}
          <div className="h-full flex gap-5 px-4 py-3" style={{ width: `${100 / SCREENS.length}%` }}>
            {reverse ? [...lanes].reverse() : lanes}
          </div>

          {/* 2. batches */}
          <div className="h-full flex gap-4 px-4 py-3 overflow-x-auto" style={{ width: `${100 / SCREENS.length}%` }}>
            {suggestions.length === 0 ? (
              <div className="m-auto text-2xl font-bold" style={{ color: C.ink3 }}>
                No two waiting orders are the same right now.
              </div>
            ) : suggestions.map(list => {
              const ids = list.map(idOf);
              const o = list[0];
              return (
                <div key={kindKey(o)} className={cardBase} style={{ width: 340, background: C.card, border: `3px solid ${C.batch}` }}>
                  <div className="text-5xl font-black" style={{ color: C.batch }}>{list.length}×</div>
                  <div className="text-2xl font-black mt-1">{titleCase([sizeOf(o), drinkOf(o)].filter(Boolean).join(' '))}</div>
                  <div className="mt-2">{MilkChip({ milk: milkOf(o) })}</div>
                  <div className="mt-3 text-lg font-bold leading-snug" style={{ color: C.ink2 }}>
                    {list.map(x => `#${orderNumberOf(x)} ${nameOf(x)}`).join(' · ')}
                  </div>
                  {BigButton({ color: C.start, disabled: ids.some(i => busy[i]), onClick: () => startMany(ids), label: `Start all ${list.length}`,
                    children: <><Play size={24} /> START ALL {list.length}</> })}
                </div>
              );
            })}
          </div>

          {/* 3. stock */}
          <div className="h-full flex flex-wrap content-center justify-center gap-4 px-4 py-3" style={{ width: `${100 / SCREENS.length}%` }}>
            {milks.map(m => {
              const off = dead[m.value] || m.unavailable;
              return (
                <button key={m.value} onClick={() => toggle86(m.value)}
                  className="rounded-2xl px-8 py-6 text-2xl font-black flex items-center gap-3 active:scale-95"
                  style={{ background: off ? '#3F1D1D' : C.card, color: off ? '#FCA5A5' : C.ink,
                    border: `3px solid ${off ? '#DC2626' : C.line}`, minWidth: 240 }}>
                  <span className="w-5 h-5 rounded-full" style={{ background: getMilkColor(m.name) || '#fff' }} />
                  <span className={off ? 'line-through' : ''}>{m.name}</span>
                  <span className="ml-auto text-base">{off ? '86’d · tap to bring back' : 'tap to 86'}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TouchBar;
