// BenchMode.js -- the rush view of the barista queue (Peri SIG, Nov 2026).
//
// What went wrong in a 58-orders-in-two-minutes break: the list was 80
// cards long on a 9" iPad, nobody could find the card for the cup in their
// hand, so nobody tapped, the board went wrong and people who waited
// patiently missed out. The cart had always run on a ticket system --
// ticket under the cup, stub to the customer, call the number -- and this
// screen is that system:
//
//   * Only what is on the bench: at most BENCH big tiles, oldest first, in
//     the same left-to-right order as the cups. Waiting is a number and a
//     "Next N" button, never a list to scroll.
//   * Each tile is what goes on the lid: the whole number big, then the short
//     code (FW S X), then the name. No size when the menu has one size.
//   * One tap: Ready (texts them, puts them on the board).
//   * Number pad: "47?" -> that order, one button for whatever it needs.
//   * Handed over without a text (the cup is already in their hand) and a
//     catch-up for everything the screen never heard about.
import React, { useMemo, useState } from 'react';
import { Check, Hash, Play, RotateCcw, UserPlus, X, List, Delete, Layers, Bell, CheckSquare, Square, ListChecks } from 'lucide-react';
import ApiService from '../../services/ApiService';
import { showToast } from '../shared/Toast';
import { orderNumberOf, notesOf, isDecaf, isPriority, hasPhone } from './queue/orderMeta';
import { parseServerDate } from '../../utils/orderUtils';

export const BENCH = 6;
// "Start the next 5, finish those 5": the barista picks the batch size for
// this tablet. Eight packs the tiles smaller so the whole bench still fits.
export const BENCH_SIZES = [4, 5, 6, 8];
const readSize = () => { try { const n = Number(localStorage.getItem('cupq_bench_size')); return BENCH_SIZES.includes(n) ? n : BENCH; } catch (e) { return BENCH; } };
// Same-drink rounds only look this far down the waiting list, so a hot
// chocolate run cannot jump someone who ordered twenty minutes earlier.
export const FAIR_WINDOW = 20;

const MILK_WORD = { '': 'FC' };
// "Hot chocolate x5: 3 FC, 1 S, 1 O" -- what to steam for a same-drink run.
export const milkTally = (orders) => {
  const t = {};
  orders.forEach((o) => {
    const m = low(o.milkType || o.milk_type);
    const k = /no milk|none/.test(m) ? 'black' : ((MILK.find(([re]) => re.test(m)) || [null, ''])[1] || MILK_WORD['']);
    t[k] = (t[k] || 0) + 1;
  });
  return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ');
};
export const drinkGroups = (waiting, window = FAIR_WINDOW) => {
  const g = {};
  waiting.slice(0, window).forEach((o) => {
    const d = drinkOf(o).replace(/\b(decaf|strong|extra strong|weak|double|extra hot)\b/g, '').trim();
    const code = (DRINK.find(([re]) => re.test(d)) || [null, d.toUpperCase()])[1];
    (g[code] = g[code] || { code, name: d, orders: [] }).orders.push(o);
  });
  return Object.values(g).filter((x) => x.orders.length > 1).sort((a, b) => b.orders.length - a.orders.length);
};

const DRINK = [
  // Chai and hot chocolate before latte: "chai latte" is not a latte.
  [/chai/, 'CH'], [/hot choc/, 'HC'], [/mocha/, 'MOC'],
  [/flat white/, 'FW'], [/cappuccino|\bcap\b/, 'CAP'], [/latte/, 'LAT'], [/long black/, 'LB'], [/piccolo/, 'PIC'], [/macchiato/, 'MAC'],
  [/cortado/, 'COR'], [/americano/, 'AM'], [/espresso|short black/, 'ESP'], [/tea\b/, 'TEA'],
];
const MILK = [
  [/lactose/, 'LF'], [/skim|skinny|light/, 'S'], [/oat/, 'O'], [/soy/, 'SOY'], [/almond/, 'A'],
  [/coconut/, 'COC'], [/macadamia/, 'MAC'],
];

const low = (s) => String(s || '').toLowerCase();
const drinkOf = (o) => low(o.coffeeType || o.coffee_type);

// The lid code: drink, milk, then the extras that change how it is made.
// Full cream and black coffees write no milk (the guide's rule: blank =
// full cream).
export const lidCode = (o, { showSize = false } = {}) => {
  const d = drinkOf(o);
  const drink = (DRINK.find(([re]) => re.test(d)) || [null, d.replace(/\b(decaf|strong|extra strong|weak|double|extra hot)\b/g, '').trim().slice(0, 3).toUpperCase() || 'COF'])[1];
  const m = low(o.milkType || o.milk_type);
  const milk = (MILK.find(([re]) => re.test(m)) || [null, ''])[1];
  const strong = /\b(strong|extra|double)\b/.test(d) || /strong|extra|double/.test(low(o.strength)) || Number(o.shots) >= 2;
  const bits = [showSize && o.size ? String(o.size)[0].toUpperCase() : null, drink, milk,
    strong ? 'X' : null, isDecaf(o) || /\bdecaf\b/.test(d) ? 'DC' : null, /\bweak\b/.test(d) ? 'WEAK' : null,
    o.extraHot ? 'HOT' : null, notesOf(o) ? 'N' : null];
  return bits.filter(Boolean).join(' ');
};

const created = (o) => parseServerDate(o.createdAt || o.created_at || 0).getTime() || 0;
const readyAt = (o) => parseServerDate(o.completedAt || o.completed_at || o.updatedAt || 0).getTime() || 0;
const oldestFirst = (a, b) => (isPriority(b) - isPriority(a)) || (created(a) - created(b));
const firstName = (o) => String(o.customerName || o.customer_name || '').split(' ')[0];
const statusOf = (o) => low(o.status).replace('_', '-');

// The number split so the last two digits (what the lid says) stand out.
const Num = ({ n, big = 'text-6xl' }) => {
  // The whole number at one size: it is what the phone shows and what the
  // lid says (a split '11 23' read oddly).
  return <span className={`font-extrabold tabular-nums leading-none ${big}`}>{String(n)}</span>;
};

export default function BenchMode({
  pendingOrders = [], inProgressOrders = [], completedOrders = [], collectedOrders = [], stationId,
  onStart, onComplete, onCollected, onWalkIn, onList, refresh, showReady = true,
}) {
  const [busy, setBusy] = useState({});
  const [pad, setPad] = useState(false);
  const [typed, setTyped] = useState('');
  const [catchUp, setCatchUp] = useState(false);
  const [rounds, setRounds] = useState(false);
  const [benchSize, setBenchSize] = useState(readSize);
  const chooseSize = (n) => { setBenchSize(n); try { localStorage.setItem('cupq_bench_size', String(n)); } catch (e) { /* device pref */ } };
  // A batch is whatever the barista says it is: tick cups on the bench and
  // finish them together, or tick any of the next FAIR_WINDOW waiting and
  // start them together, different drinks and all.
  const [ticked, setTicked] = useState(() => new Set());
  const [pick, setPick] = useState(false);
  const [pickSel, setPickSel] = useState(() => new Set());
  const toggle = (setter) => (k) => setter((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // One size on today's menu (or on every order we can see) means size is
  // clutter, not information.
  const showSize = useMemo(() => {
    const sizes = new Set([...pendingOrders, ...inProgressOrders].map((o) => low(o.size)).filter((s) => s && s !== 'regular'));
    return sizes.size > 1;
  }, [pendingOrders, inProgressOrders]);

  const waiting = useMemo(() => [...pendingOrders].sort(oldestFirst), [pendingOrders]);
  const bench = useMemo(() => [...inProgressOrders].sort(oldestFirst), [inProgressOrders]);
  const sid = stationId != null ? String(stationId) : null;
  const mine = (o) => { if (!sid) return true; const c = [o.stationId, o.station_id].filter((v) => v != null).map(String); return !c.length || c.includes(sid); };
  // Picked up arrives as its own list (useOrders' previousOrders); a fresh
  // tap can still sit in completedOrders for one poll.
  const collectedList = useMemo(() => {
    const seen = new Set();
    return [...(collectedOrders || []), ...(completedOrders || []).filter((o) => statusOf(o) === 'picked-up')]
      .filter((o) => { const k = String(orderNumberOf(o)); if (seen.has(k)) return false; seen.add(k); return true; })
      .map((o) => ({ ...o, status: 'picked_up' }));
  }, [collectedOrders, completedOrders]);
  const ready = useMemo(() => (completedOrders || []).filter((o) => {
    if (statusOf(o) !== 'completed') return false;
    if (sid) { const c = [o.stationId, o.station_id].filter((v) => v != null).map(String); if (c.length && !c.includes(sid)) return false; }
    return true;
  }).sort((a, b) => readyAt(a) - readyAt(b)), [completedOrders, sid]);

  const room = Math.max(0, benchSize - bench.length);
  const dense = benchSize > 6 || bench.length > 6;
  const nextBatch = waiting.slice(0, room);

  const act = async (ids, fn) => {
    setBusy((b) => ({ ...b, ...Object.fromEntries(ids.map((i) => [i, true])) }));
    try { await fn(); } catch (e) {
      showToast(e?.details?.message || e?.message || 'That did not go through. Try again.', 'error');
    } finally {
      setBusy((b) => { const n = { ...b }; ids.forEach((i) => delete n[i]); return n; });
      if (refresh) refresh();
    }
  };
  const idOf = (o) => String(o.id || orderNumberOf(o));

  const startNext = () => act(nextBatch.map(idOf), async () => {
    for (const o of nextBatch) await onStart(o); // eslint-disable-line no-await-in-loop
  });
  const makeReady = (o) => act([idOf(o)], () => onComplete(o.id || orderNumberOf(o)));
  // Already in the customer's hand: finish it (stock, make time) WITHOUT
  // the ready text, then mark it collected.
  const handOverQuiet = async (o) => {
    const id = o.id || orderNumberOf(o);
    const api = new ApiService();
    if (statusOf(o) !== 'completed') await api.post(`/orders/${id}/complete`, { handed_over: true });
    await api.post(`/orders/${id}/pickup`, {});
  };
  const remind = (o) => act([idOf(o)], async () => {
    const n = orderNumberOf(o);
    await new ApiService().post(`/orders/${n}/message`, { message: `Your coffee #${n} is ready at the coffee cart. Show this number to collect it.` });
    showToast(`Reminder sent to #${n}`, 'success');
  });
  const groups = useMemo(() => drinkGroups(waiting), [waiting]);
  const startRound = (list) => act(list.map(idOf), async () => {
    for (const o of list) await onStart(o); // eslint-disable-line no-await-in-loop
  });
  const readyMany = (list) => act(list.map(idOf), async () => {
    for (const o of list) await onComplete(o.id || orderNumberOf(o)); // eslint-disable-line no-await-in-loop
    setTicked(new Set());
    showToast(`${list.length} ready: each one has been texted`, 'success');
  });
  const benchTicked = bench.filter((o) => ticked.has(idOf(o)));
  const pickWindow = waiting.slice(0, FAIR_WINDOW);
  const pickList = pickWindow.filter((o) => pickSel.has(idOf(o)));
  const handOver = (o) => act([idOf(o)], () => (statusOf(o) === 'completed' && onCollected ? onCollected(o.id || orderNumberOf(o)) : handOverQuiet(o)));

  // ---- catch-up --------------------------------------------------------------
  const now = Date.now();
  const staleBench = bench.filter((o) => now - created(o) > 15 * 60000);
  const staleReady = ready.filter((o) => now - readyAt(o) > 10 * 60000);
  const runCatchUp = (list) => act(list.map(idOf), async () => {
    for (const o of list) await handOverQuiet(o); // eslint-disable-line no-await-in-loop
    showToast(`${list.length} marked handed over`, 'success');
  });

  // ---- number pad --------------------------------------------------------------
  const matches = useMemo(() => {
    if (!typed) return [];
    const all = [...bench, ...ready, ...waiting, ...collectedList];
    return all.filter((o) => String(orderNumberOf(o)).replace(/[a-z]$/i, '').endsWith(typed) || String(orderNumberOf(o)) === typed).slice(0, 4);
  }, [typed, bench, ready, waiting]);
  const closePad = () => { setPad(false); setTyped(''); };

  const btn = 'inline-flex items-center justify-center gap-2 rounded-cq-md font-extrabold disabled:opacity-40';

  return (
    <div className="flex flex-col gap-2 min-h-0 flex-1" data-testid="bench-mode">
      {/* Top: waiting count, the one button that feeds the bench, the pad. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <div className="text-3xl font-extrabold text-cq-roast tabular-nums leading-none">{waiting.length}</div>
          <div className="text-sm font-bold text-cq-ink-3 uppercase tracking-wider">waiting</div>
        </div>
        <div className="flex items-center gap-1 bg-cq-wash rounded-cq-md p-1" title="How many to start and finish at a time">
          <span className="text-[10px] font-bold text-cq-ink-3 px-0.5 uppercase">Batch</span>
          {BENCH_SIZES.map((n) => (
            <button key={n} type="button" onClick={() => chooseSize(n)} aria-pressed={benchSize === n}
              className={`h-10 w-8 rounded-cq-sm text-lg font-extrabold ${benchSize === n ? 'bg-cq-roast text-cq-cream' : 'text-cq-roast'}`}>{n}</button>
          ))}
        </div>
        <button type="button" onClick={startNext} disabled={!nextBatch.length || nextBatch.some((o) => busy[idOf(o)])}
          className={`${btn} h-14 px-5 text-xl text-white`} style={{ background: '#3B82F6' }}>
          <Play size={24} /> {nextBatch.length ? `Next ${nextBatch.length}` : (waiting.length ? 'Full' : 'None waiting')}
        </button>
        <button type="button" onClick={() => setPad(true)} className={`${btn} h-14 px-4 text-xl bg-cq-roast text-cq-cream`}>
          <Hash size={24} /> Number
        </button>
        <button type="button" onClick={() => { setPickSel(new Set()); setPick(true); }} disabled={!waiting.length} className={`${btn} h-11 px-3 text-base bg-cq-wash text-cq-roast`} title="Tick any of the next orders and start them as one batch">
          <ListChecks size={18} /> Pick
        </button>
        <button type="button" onClick={() => setRounds(true)} disabled={!groups.length} className={`${btn} h-11 px-3 text-base bg-cq-wash text-cq-roast`} title="Make all of one drink together">
          <Layers size={18} /> Same drink
        </button>
        {onWalkIn ? (
          <button type="button" onClick={onWalkIn} className={`${btn} h-11 px-3 text-base bg-cq-wash text-cq-roast`} title="A coffee made for someone who did not order on CupQ, so it still counts">
            <UserPlus size={18} /> Walk-up
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-cq-ink-3 mr-auto">{bench.length > 1 ? 'Tick the cups that are done, or finish the whole bench' : ''}</span>
        {benchTicked.length ? (
          <button type="button" onClick={() => readyMany(benchTicked)} className={`${btn} h-11 px-4 text-lg text-white`} style={{ background: '#16A34A' }}>
            <Check size={20} /> Ready ticked ({benchTicked.length})
          </button>
        ) : null}
        {bench.length > 1 ? (
          <button type="button" onClick={() => readyMany(bench)} disabled={bench.some((o) => busy[idOf(o)])} className={`${btn} h-11 px-4 text-lg bg-white border-2 border-cq-ready text-cq-ready`}>
            <Check size={20} /> All {bench.length} ready
          </button>
        ) : null}
        <button type="button" onClick={() => setCatchUp(true)} className={`${btn} h-11 px-3 text-base bg-cq-wash text-cq-roast`}>
          <RotateCcw size={18} /> Catch up
        </button>
        {onList ? (
          <button type="button" onClick={onList} className={`${btn} h-11 px-3 text-base bg-cq-wash text-cq-ink-2`} title="Back to the full list">
            <List size={18} /> List
          </button>
        ) : null}
      </div>

      {/* The bench: one tile per cup, oldest first, left to right. */}
      {bench.length === 0 ? (
        <div className="flex-1 grid place-items-center rounded-cq-lg border-2 border-dashed border-cq-line text-cq-ink-3 text-xl font-bold p-10 text-center">
          {waiting.length ? `Tap Next ${Math.min(benchSize, waiting.length)} to start the oldest orders.` : 'Nothing on the bench.'}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
        <div className={`grid gap-2 content-start ${dense ? 'grid-cols-3 lg:grid-cols-4' : 'grid-cols-2 lg:grid-cols-3'}`}>
          {bench.map((o) => {
            const notes = notesOf(o);
            return (
              <div key={idOf(o)} className={`bg-cq-milk rounded-cq-lg shadow-cq-card border-t-[6px] border-t-cq-caramel ${dense ? 'p-2' : 'p-3'} flex flex-col gap-1 ${ticked.has(idOf(o)) ? 'ring-4 ring-cq-ready' : ''}`} data-testid="bench-tile">
                <button type="button" onClick={() => toggle(setTicked)(idOf(o))} className="flex items-start justify-between gap-2 text-left" aria-pressed={ticked.has(idOf(o))} title="Tick to finish with others">
                  <span className="text-cq-roast"><Num n={orderNumberOf(o)} big={dense ? 'text-4xl' : 'text-5xl'} small={dense ? 'text-base' : 'text-xl'} /></span>
                  <span className="flex items-center gap-1">
                    {isPriority(o) ? <span className="text-xs font-extrabold bg-yellow-300 text-black rounded px-2 py-1">PRIORITY</span> : null}
                    {ticked.has(idOf(o)) ? <CheckSquare size={30} className="text-cq-ready" /> : <Square size={30} className="text-cq-line" />}
                  </span>
                </button>
                <div className={`${dense ? 'text-xl' : 'text-2xl'} font-extrabold tracking-wide text-cq-caramel-deep`} data-testid="lid-code">{lidCode(o, { showSize })}</div>
                <div className={`${dense ? 'text-base' : 'text-lg'} font-bold text-cq-ink truncate`}>{firstName(o) || ' '}</div>
                {notes ? <div className="text-base font-semibold bg-cq-caramel-wash text-cq-roast rounded-cq-sm px-2 py-1">N: {notes}</div> : null}
                <button type="button" onClick={() => makeReady(o)} disabled={!!busy[idOf(o)]}
                  className={`${btn} mt-auto ${dense ? 'h-12 text-xl' : 'h-14 text-2xl'} text-white`} style={{ background: '#16A34A' }}>
                  <Check size={28} /> Ready
                </button>
              </div>
            );
          })}
        </div></div>
      )}

      {/* Ready: numbers, like the shelf. Tap one when it is handed over. */}
      {showReady && ready.length ? (
        <div className="mt-auto pl-12">
          <div className="text-sm font-bold text-cq-ink-3 uppercase tracking-wider mb-1">Ready, waiting for pickup &middot; tap when handed over</div>
          <div className="flex flex-wrap gap-2">
            {ready.map((o) => (
              <button key={idOf(o)} type="button" onClick={() => handOver(o)} disabled={!!busy[idOf(o)]}
                className={`${btn} h-14 px-4 bg-white border-2 border-cq-ready text-cq-roast`} title={`${firstName(o)} ${lidCode(o)}`}>
                <Num n={orderNumberOf(o)} big="text-3xl" small="text-base" />
                <span className="text-sm font-bold text-cq-ink-2">{firstName(o)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Number pad */}
      {pad ? (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={closePad}>
          <div className="bg-cq-milk rounded-cq-lg p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-5xl font-extrabold tabular-nums text-cq-roast min-h-[3rem]">{typed || <span className="text-cq-ink-3 text-2xl">Type the number</span>}</div>
              <button type="button" onClick={closePad} aria-label="Close" className="p-2"><X size={28} /></button>
            </div>
            <div className="flex flex-col gap-2 mb-3 h-44 overflow-y-auto">
              {typed && !matches.length ? <div className="text-cq-ink-3 font-semibold">No order ending in {typed}.</div> : null}
              {matches.map((o) => {
                const st = statusOf(o);
                return (
                  <div key={idOf(o)} className="flex items-center gap-3 bg-white rounded-cq-md p-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-2xl font-extrabold">#{orderNumberOf(o)} <span className="text-lg text-cq-ink-2">{firstName(o)}</span></div>
                      <div className="text-sm font-bold text-cq-caramel-deep">{lidCode(o, { showSize })} &middot; {st === 'pending' ? `waiting, ${waiting.indexOf(o) + 1} in line` : st === 'in-progress' ? 'on the bench' : st === 'completed' ? 'READY, not collected' : 'collected'}{hasPhone(o) ? '' : ' · no phone'}</div>
                    </div>
                    {st === 'pending' ? <button type="button" className={`${btn} h-12 px-4 text-white`} style={{ background: '#3B82F6' }} onClick={() => act([idOf(o)], () => onStart(o))}>Start</button> : null}
                    {st === 'in-progress' ? <button type="button" className={`${btn} h-12 px-4 text-white`} style={{ background: '#16A34A' }} onClick={() => { makeReady(o); closePad(); }}>Ready</button> : null}
                    {st === 'in-progress' || st === 'completed' ? <button type="button" className={`${btn} h-12 px-4 bg-cq-roast text-cq-cream`} onClick={() => { handOver(o); closePad(); }}>Handed over</button> : null}
                    {(st === 'completed' || st === 'picked-up') && hasPhone(o) ? <button type="button" className={`${btn} h-12 px-3 bg-cq-wash text-cq-roast`} onClick={() => remind(o)} title="Text them again: ready at the cart"><Bell size={18} /> Remind</button> : null}
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '<'].map((k) => (
                <button key={k} type="button" className={`${btn} h-16 text-3xl bg-cq-wash text-cq-roast`}
                  onClick={() => setTyped((t) => (k === 'C' ? '' : k === '<' ? t.slice(0, -1) : (t + k).slice(-6)))}>
                  {k === '<' ? <Delete size={28} /> : k}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Pick: any of the next FAIR_WINDOW, ticked, started as one batch. */}
      {pick ? (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setPick(false)}>
          <div className="bg-cq-milk rounded-cq-lg p-5 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="text-2xl font-extrabold text-cq-roast mb-1">Pick a batch</div>
            <p className="text-sm text-cq-ink-2 mb-3">Tick any of the next {pickWindow.length}, different drinks and all, and start them together.</p>
            <div className="flex flex-col gap-1.5 max-h-[55vh] overflow-y-auto">
              {pickWindow.map((o, i) => {
                const on = pickSel.has(idOf(o));
                return (
                  <button key={idOf(o)} type="button" onClick={() => toggle(setPickSel)(idOf(o))} aria-pressed={on}
                    className={`flex items-center gap-3 rounded-cq-md px-3 py-2 text-left border-2 ${on ? 'bg-cq-ready-wash border-cq-ready' : 'bg-white border-cq-line'}`}>
                    {on ? <CheckSquare size={26} className="text-cq-ready shrink-0" /> : <Square size={26} className="text-cq-ink-3 shrink-0" />}
                    <span className="text-xs font-bold text-cq-ink-3 w-6">{i + 1}</span>
                    <span className="text-cq-roast"><Num n={orderNumberOf(o)} big="text-2xl" small="text-sm" /></span>
                    <span className="text-lg font-extrabold text-cq-caramel-deep">{lidCode(o, { showSize })}</span>
                    <span className="text-base font-semibold text-cq-ink-2 truncate ml-auto">{firstName(o)}</span>
                  </button>
                );
              })}
            </div>
            {/* Always there, so ticking never moves the list under a finger. */}
            <div className="mt-2 h-5 text-sm font-bold text-cq-caramel-deep">{pickList.length ? `Milk to steam: ${milkTally(pickList)}` : 'Tick the cups for this batch'}</div>
            <div className="flex gap-2 mt-3">
              <button type="button" className={`${btn} h-12 px-4 bg-cq-wash text-cq-ink-2`} onClick={() => setPick(false)}>Cancel</button>
              <button type="button" disabled={!pickList.length} className={`${btn} h-12 flex-1 text-lg text-white`} style={{ background: '#3B82F6' }}
                onClick={() => { startRound(pickList); setPick(false); }}>
                <Play size={20} /> Start these {pickList.length || ''}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Same drink: every hot chocolate (or flat white...) in the next
          FAIR_WINDOW orders, with the milks to steam. */}
      {rounds ? (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setRounds(false)}>
          <div className="bg-cq-milk rounded-cq-lg p-5 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="text-2xl font-extrabold text-cq-roast mb-1">Same drink together</div>
            <p className="text-sm text-cq-ink-2 mb-3">From the next {Math.min(FAIR_WINDOW, waiting.length)} waiting only, so nobody further back jumps the line.</p>
            <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
              {groups.map((g) => (
                <button key={g.code} type="button" className={`${btn} justify-between h-auto py-3 px-4 bg-white text-left text-cq-roast border-2 border-cq-line`}
                  onClick={() => { startRound(g.orders); setRounds(false); }}>
                  <span className="flex flex-col">
                    <span className="text-2xl">{g.code} &times; {g.orders.length}</span>
                    <span className="text-base font-bold text-cq-caramel-deep">{milkTally(g.orders)}</span>
                    <span className="text-xs font-semibold text-cq-ink-3">#{g.orders.map((o) => String(orderNumberOf(o)).slice(-2)).join(' #')}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-lg text-white rounded-cq-md px-3 py-2" style={{ background: '#3B82F6' }}><Play size={18} /> Start all</span>
                </button>
              ))}
              {!groups.length ? <div className="text-cq-ink-3">No two of the same drink in the next {FAIR_WINDOW}.</div> : null}
            </div>
            <button type="button" className={`${btn} mt-3 h-12 w-full bg-cq-wash text-cq-ink-2`} onClick={() => setRounds(false)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {/* Catch up */}
      {catchUp ? (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setCatchUp(false)}>
          <div className="bg-cq-milk rounded-cq-lg p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="text-2xl font-extrabold text-cq-roast mb-2">Catch up</div>
            <p className="text-base text-cq-ink-2 mb-4">For cups that were called out and handed over without a tap. They are marked handed over and nobody is sent a text.</p>
            <div className="flex flex-col gap-2">
              <button type="button" disabled={!staleBench.length} className={`${btn} h-14 px-4 text-lg bg-cq-roast text-cq-cream`}
                onClick={() => { runCatchUp(staleBench); setCatchUp(false); }}>
                {staleBench.length} on the bench, ordered over 15 min ago
              </button>
              <button type="button" disabled={!staleReady.length} className={`${btn} h-14 px-4 text-lg bg-cq-roast text-cq-cream`}
                onClick={() => { runCatchUp(staleReady); setCatchUp(false); }}>
                {staleReady.length} ready for over 10 min
              </button>
              <button type="button" className={`${btn} h-12 px-4 bg-cq-wash text-cq-ink-2`} onClick={() => setCatchUp(false)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
