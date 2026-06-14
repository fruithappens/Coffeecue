// components/display/KioskOrder.js
//
// Self-service "order here" kiosk overlay for the public Display screen.
// Touch-first, McDonald's-style: type your name, tap a drink, milk, size, set
// sugar with +/−, choose where to collect, leave a phone if collecting
// elsewhere, confirm, done.
//
// Smart bits:
//  - Items only available at OTHER stations are greyed with the station
//    numbers that make them.
//  - When more than one station can make the whole order, the customer picks
//    Collect Here / Fastest / a specific station (with live wait times).
//  - A phone number is REQUIRED only when collecting away from this screen's
//    station (so we can SMS "ready at Station X"); collecting here, it's
//    skipped — stand and watch the board.
//  - 30s of no touch → the overlay closes itself so the kiosk returns to the
//    live orders board for the next person.
//
// Public endpoints (no auth, like the rest of the Display):
//   GET  /api/display/menu   → { menu: { stations:[{id,name,wait,load}], coffee_types, milks, sizes } }
//   POST /api/display/order  → { order_number, station_id, station_name }
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { X, ArrowLeft, Plus, Minus, Check, Loader, MapPin, Zap } from 'lucide-react';

const IDLE_MS = 30000; // close after 30s of no interaction

const drinkEmoji = (name) => {
  const n = (name || '').toLowerCase();
  if (n.includes('hot choc')) return '🍫';
  if (n.includes('chai')) return '🫖';
  if (n.includes('matcha')) return '🍵';
  if (n.includes('tea')) return '🫖';
  if (n.includes('mocha')) return '🍫';
  return '☕';
};
const milkEmoji = (name) => {
  const n = (name || '').toLowerCase();
  if (n.includes('no milk') || n.includes('none')) return '🚫';
  if (n.includes('oat')) return '🌾';
  if (n.includes('soy')) return '🫘';
  if (n.includes('almond')) return '🌰';
  if (n.includes('coconut')) return '🥥';
  if (n.includes('macadamia')) return '🌰';
  return '🥛';
};

const KioskOrder = ({ stationId, headerColor = '#1e40af', onClose }) => {
  const [menu, setMenu] = useState(null);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [step, setStep] = useState('name'); // name → drink → milk → size → sugar → location → phone → review → done
  const [name, setName] = useState('');
  const [drink, setDrink] = useState(null);
  const [milk, setMilk] = useState(null);
  const [size, setSize] = useState(null);
  const [sugar, setSugar] = useState(0);
  const [drinkCat, setDrinkCat] = useState('All'); // category tab on the drink step
  const [chosenStation, setChosenStation] = useState(null); // collect-from station id
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const myStation = useMemo(() => {
    const n = parseInt(stationId, 10);
    return Number.isFinite(n) ? n : null;
  }, [stationId]);

  // --- 30s inactivity auto-close -----------------------------------------
  const idleRef = useRef(null);
  const resetIdle = useCallback(() => {
    if (idleRef.current) clearTimeout(idleRef.current);
    if (step === 'done') return; // success screen has its own timer
    idleRef.current = setTimeout(() => { if (onClose) onClose(); }, IDLE_MS);
  }, [step, onClose]);
  useEffect(() => {
    resetIdle();
    return () => { if (idleRef.current) clearTimeout(idleRef.current); };
  }, [step, name, drink, milk, size, sugar, chosenStation, phone, resetIdle]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/display/menu');
        const b = r.ok ? await r.json() : null;
        if (!cancelled && b && b.success) setMenu(b.menu);
      } catch (e) { /* gentle error below */ }
      finally { if (!cancelled) setLoadingMenu(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const stationById = useMemo(() => {
    const m = {};
    (menu?.stations || []).forEach(s => { m[s.id] = s; });
    return m;
  }, [menu]);
  const stationName = (id) => stationById[id]?.name || `Station ${id}`;
  const stationWait = (id) => (stationById[id]?.wait ?? null);

  // "No milk" is always offered (tea / black coffee) even if no station lists it.
  const milkOptions = useMemo(() => {
    const base = (menu?.milks || []).slice();
    if (!base.some(m => (m.value || '').includes('no milk'))) {
      base.push({ name: 'No milk', value: 'no milk', stations: (menu?.stations || []).map(s => s.id) });
    }
    return base;
  }, [menu]);

  const madeHere = (item) => {
    if (!item) return true;
    if (myStation == null) return true;
    return (item.stations || []).includes(myStation);
  };
  const stationLabel = (item) => (item?.stations || []).map(s => `${s}`).join(', ');

  // Stations that can make the WHOLE chosen order (intersection of each part).
  const capable = useMemo(() => {
    const sets = [drink, milk, size].filter(Boolean).map(i => new Set(i.stations || []));
    if (sets.length === 0) return [];
    let inter = null;
    sets.forEach(s => { inter = inter == null ? new Set(s) : new Set([...inter].filter(x => s.has(x))); });
    return [...(inter || [])].sort((a, b) => a - b);
  }, [drink, milk, size]);

  const fastestStation = useMemo(() => {
    if (capable.length === 0) return null;
    return capable.slice().sort((a, b) => {
      const la = stationById[a]?.load ?? 0, lb = stationById[b]?.load ?? 0;
      if (la !== lb) return la - lb;
      return (stationById[a]?.wait ?? 0) - (stationById[b]?.wait ?? 0);
    })[0];
  }, [capable, stationById]);

  // Drink category tabs (Coffee / Tea / Hot Chocolate / Chai) — only shown
  // when the menu actually spans more than one, so a coffee-only event stays
  // a single clean grid.
  const drinkCategories = useMemo(() => {
    const order = ['Coffee', 'Tea', 'Hot Chocolate', 'Chai', 'Cold Drinks'];
    const present = [...new Set((menu?.coffee_types || []).map(d => d.category || 'Coffee'))];
    present.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return present;
  }, [menu]);
  const drinksForTab = (menu?.coffee_types || [])
    .filter(d => drinkCat === 'All' || (d.category || 'Coffee') === drinkCat);

  const sizeChoices = menu?.sizes || [];
  const needsSizeStep = sizeChoices.length > 1;

  // After sugar: choose a station if there's a choice, else auto-route.
  const afterSugar = () => {
    if (capable.length > 1) { setStep('location'); return; }
    const only = capable.length === 1 ? capable[0] : null;
    setChosenStation(only);
    routeFromStation();
  };
  // Always offer the phone step. It's REQUIRED when collecting elsewhere (the
  // only way to tell them it's ready) and OPTIONAL ("I'll wait here") when
  // collecting at this screen's own station — so even a single-station customer
  // can still opt in to a ready SMS and walk away.
  const routeFromStation = () => setStep('phone');
  const chooseStation = (sid) => { setChosenStation(sid); routeFromStation(); };

  const collectingHere = myStation != null && chosenStation === myStation;
  const phoneDigits = phone.replace(/\D/g, '');
  const phoneValid = phoneDigits.length >= 8;

  const placeOrder = async () => {
    setSubmitting(true);
    setErrorMsg('');
    try {
      const r = await fetch('/api/display/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          coffee_type: drink?.value,
          milk: milk?.value || 'no milk',
          size: size?.value || (sizeChoices[0]?.value) || 'medium',
          sugar: sugar === 0 ? 'No sugar' : `${sugar} sugar${sugar > 1 ? 's' : ''}`,
          station_id: myStation,
          preferred_station: chosenStation,
          phone: phone.trim(),
        }),
      });
      const b = await r.json();
      if (r.ok && b.success) {
        setResult(b);
        setStep('done');
        setTimeout(() => { if (onClose) onClose(); }, 12000);
      } else {
        setErrorMsg(b.message || 'Could not place your order. Please see a barista.');
      }
    } catch (e) {
      setErrorMsg('Could not reach the system. Please see a barista.');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- presentational helpers -------------------------------------------
  const Tile = ({ active, disabled, onClick, emoji, label, sub }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative flex flex-col items-center justify-center rounded-2xl p-5 min-h-[120px] text-center transition
        ${disabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-800 hover:shadow-lg active:scale-95 shadow'}`}
      style={active ? { boxShadow: `0 0 0 4px ${headerColor}` } : undefined}
    >
      <span className="text-5xl mb-2" aria-hidden>{emoji}</span>
      <span className="text-xl font-bold leading-tight">{label}</span>
      {sub && <span className="mt-1 text-xs font-semibold text-amber-600">{sub}</span>}
    </button>
  );

  const Header = ({ title, onBack }) => (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3 min-w-0">
        {onBack && (
          <button onClick={onBack} className="p-2 rounded-full bg-white/90 text-gray-700 hover:bg-white flex-shrink-0">
            <ArrowLeft size={28} />
          </button>
        )}
        <h2 className="text-3xl font-extrabold text-white drop-shadow truncate">{title}</h2>
      </div>
      <button onClick={onClose} className="p-2 rounded-full bg-white/90 text-gray-700 hover:bg-white flex-shrink-0" title="Cancel">
        <X size={28} />
      </button>
    </div>
  );

  const waitText = (id) => {
    const w = stationWait(id);
    return (w || w === 0) ? `~${w} min` : '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         onPointerDown={resetIdle}
         style={{ background: `linear-gradient(135deg, ${headerColor}ee, #000000cc)` }}>
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl p-6 md:p-8"
           style={{ backgroundColor: '#f8fafc' }}>

        {/* ---------- NAME ---------- */}
        {step === 'name' && (
          <>
            <Header title="Order here ☕" />
            <p className="text-xl text-gray-600 mb-3 font-medium">What's your first name?</p>
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Type your name"
              className="w-full text-3xl font-bold p-5 rounded-2xl border-4 border-gray-200 focus:outline-none"
              style={{ borderColor: name ? headerColor : undefined }}
            />
            <button
              disabled={name.trim().length < 2} onClick={() => setStep('drink')}
              className="mt-6 w-full py-5 rounded-2xl text-2xl font-extrabold text-white disabled:opacity-40"
              style={{ backgroundColor: headerColor }}>
              Next →
            </button>
          </>
        )}

        {/* ---------- DRINK ---------- */}
        {step === 'drink' && (
          <>
            <Header title={`Hi ${name.trim()} — pick a drink`} onBack={() => setStep('name')} />
            {loadingMenu ? (
              <div className="flex items-center justify-center py-16 text-gray-500"><Loader className="animate-spin mr-2" /> Loading menu…</div>
            ) : (menu?.coffee_types || []).length === 0 ? (
              <div className="text-center py-16 text-gray-500 text-xl">No drinks available right now. Please see a barista.</div>
            ) : (
              <>
                {drinkCategories.length > 1 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {['All', ...drinkCategories].map(cat => (
                      <button key={cat} onClick={() => setDrinkCat(cat)}
                        className="px-4 py-2 rounded-full text-base font-bold transition"
                        style={drinkCat === cat
                          ? { backgroundColor: headerColor, color: '#fff' }
                          : { backgroundColor: '#fff', color: '#374151', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                        {cat}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {drinksForTab.map(d => (
                    <Tile key={d.value} emoji={drinkEmoji(d.value)} label={d.name}
                      active={drink?.value === d.value}
                      sub={madeHere(d) ? null : `Station ${stationLabel(d)} only`}
                      onClick={() => { setDrink(d); setStep('milk'); }} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ---------- MILK ---------- */}
        {step === 'milk' && (
          <>
            <Header title="Milk?" onBack={() => setStep('drink')} />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {milkOptions.map(m => (
                <Tile key={m.value} emoji={milkEmoji(m.value)} label={m.name}
                  active={milk?.value === m.value}
                  sub={madeHere(m) ? null : `Station ${stationLabel(m)} only`}
                  onClick={() => { setMilk(m); setStep(needsSizeStep ? 'size' : 'sugar'); }} />
              ))}
            </div>
          </>
        )}

        {/* ---------- SIZE ---------- */}
        {step === 'size' && (
          <>
            <Header title="What size?" onBack={() => setStep('milk')} />
            <div className="grid grid-cols-3 gap-4">
              {sizeChoices.map(s => (
                <Tile key={s.value} emoji="🥤" label={s.name}
                  active={size?.value === s.value}
                  onClick={() => { setSize(s); setStep('sugar'); }} />
              ))}
            </div>
          </>
        )}

        {/* ---------- SUGAR ---------- */}
        {step === 'sugar' && (
          <>
            <Header title="How much sugar?" onBack={() => setStep(needsSizeStep ? 'size' : 'milk')} />
            <div className="flex items-center justify-center gap-8 py-8">
              <button onClick={() => setSugar(s => Math.max(0, s - 1))}
                className="p-6 rounded-full bg-white shadow text-gray-700 active:scale-95 disabled:opacity-40" disabled={sugar === 0}>
                <Minus size={40} />
              </button>
              <div className="text-center min-w-[120px]">
                <div className="text-7xl font-extrabold" style={{ color: headerColor }}>{sugar}</div>
                <div className="text-lg font-semibold text-gray-500">{sugar === 0 ? 'No sugar' : `sugar${sugar > 1 ? 's' : ''}`}</div>
              </div>
              <button onClick={() => setSugar(s => Math.min(9, s + 1))}
                className="p-6 rounded-full bg-white shadow text-gray-700 active:scale-95">
                <Plus size={40} />
              </button>
            </div>
            <button onClick={afterSugar}
              className="w-full py-5 rounded-2xl text-2xl font-extrabold text-white" style={{ backgroundColor: headerColor }}>
              Next →
            </button>
          </>
        )}

        {/* ---------- LOCATION (only when >1 station can make it) ---------- */}
        {step === 'location' && (
          <>
            <Header title="Collect from?" onBack={() => setStep('sugar')} />
            <div className="grid grid-cols-1 gap-3">
              {myStation != null && capable.includes(myStation) && (
                <button onClick={() => chooseStation(myStation)}
                  className="flex items-center justify-between rounded-2xl p-5 bg-white shadow hover:shadow-lg active:scale-[0.99]">
                  <span className="flex items-center gap-3 text-2xl font-bold text-gray-800"><MapPin size={28} style={{ color: headerColor }} /> Collect here</span>
                  <span className="text-lg text-gray-500">{stationName(myStation)} · {waitText(myStation)}</span>
                </button>
              )}
              {fastestStation != null && fastestStation !== myStation && (
                <button onClick={() => chooseStation(fastestStation)}
                  className="flex items-center justify-between rounded-2xl p-5 bg-white shadow hover:shadow-lg active:scale-[0.99]">
                  <span className="flex items-center gap-3 text-2xl font-bold text-gray-800"><Zap size={28} className="text-amber-500" /> Fastest</span>
                  <span className="text-lg text-gray-500">{stationName(fastestStation)} · {waitText(fastestStation)}</span>
                </button>
              )}
              <div className="text-sm font-semibold uppercase tracking-wide text-gray-400 mt-2 px-1">Or pick a station</div>
              {capable.map(sid => (
                <button key={sid} onClick={() => chooseStation(sid)}
                  className="flex items-center justify-between rounded-2xl p-4 bg-white shadow hover:shadow-lg active:scale-[0.99]">
                  <span className="text-xl font-bold text-gray-800">{stationName(sid)}{sid === myStation ? ' (here)' : ''}</span>
                  <span className="text-base text-gray-500">{waitText(sid)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ---------- PHONE (required when collecting elsewhere) ---------- */}
        {step === 'phone' && (
          <>
            <Header title={collectingHere ? 'Get a text when it’s ready?' : 'Your mobile number'}
                    onBack={() => setStep(capable.length > 1 ? 'location' : 'sugar')} />
            <p className="text-xl text-gray-600 mb-3 font-medium">
              {collectingHere
                ? "Pop in your mobile and we’ll text you when it’s ready — or skip and watch the board."
                : <>Your order will be ready at <b>{stationName(chosenStation)}</b> — enter your mobile so we can text you when it’s done.</>}
            </p>
            <input
              autoFocus value={phone} onChange={(e) => setPhone(e.target.value)}
              inputMode="tel" placeholder="0408 263 333"
              className="w-full text-3xl font-bold p-5 rounded-2xl border-4 border-gray-200 focus:outline-none"
              style={{ borderColor: phoneValid ? headerColor : undefined }}
            />
            <div className="mt-6 flex gap-3">
              {collectingHere && (
                <button onClick={() => { setPhone(''); setStep('review'); }}
                  className="flex-1 py-5 rounded-2xl text-2xl font-bold bg-white text-gray-700 shadow active:scale-95">
                  I'll wait here
                </button>
              )}
              <button disabled={!phoneValid} onClick={() => setStep('review')}
                className="flex-1 py-5 rounded-2xl text-2xl font-extrabold text-white disabled:opacity-40"
                style={{ backgroundColor: headerColor }}>
                Next →
              </button>
            </div>
          </>
        )}

        {/* ---------- REVIEW ---------- */}
        {step === 'review' && (
          <>
            <Header title="All good?" onBack={() => setStep('phone')} />
            <div className="bg-white rounded-2xl p-6 shadow mb-4">
              <div className="text-2xl font-extrabold text-gray-800 mb-3">{name.trim()}</div>
              <ul className="text-xl text-gray-700 space-y-1">
                <li>{drinkEmoji(drink?.value)} {drink?.name}</li>
                <li>{milkEmoji(milk?.value)} {milk?.name}</li>
                {size && <li>🥤 {size.name}</li>}
                <li>🍬 {sugar === 0 ? 'No sugar' : `${sugar} sugar${sugar > 1 ? 's' : ''}`}</li>
              </ul>
              <div className="mt-4 pt-3 border-t flex items-center gap-2 text-lg font-semibold" style={{ color: headerColor }}>
                <MapPin size={20} /> Collect from {chosenStation != null ? stationName(chosenStation) : 'the next available station'}
                {chosenStation != null && waitText(chosenStation) ? ` · ${waitText(chosenStation)}` : ''}
              </div>
              {phone.trim() && (
                <div className="mt-1 text-base text-gray-500">We'll text {phone.trim()} when it's ready.</div>
              )}
            </div>
            {errorMsg && (
              <div className="rounded-2xl p-4 mb-4 bg-red-100 text-red-800 text-lg font-semibold">{errorMsg}</div>
            )}
            <button onClick={placeOrder} disabled={submitting}
              className="w-full py-6 rounded-2xl text-3xl font-extrabold text-white flex items-center justify-center gap-3 disabled:opacity-50"
              style={{ backgroundColor: headerColor }}>
              {submitting ? <><Loader className="animate-spin" /> Placing…</> : <><Check size={32} /> Place order</>}
            </button>
          </>
        )}

        {/* ---------- DONE ---------- */}
        {step === 'done' && result && (
          <div className="text-center py-8">
            <div className="text-7xl mb-4">✅</div>
            <h2 className="text-4xl font-extrabold text-gray-800 mb-2">Thanks, {name.trim()}!</h2>
            <p className="text-2xl text-gray-600 mb-6">Your order number is</p>
            <div className="text-8xl font-black mb-6" style={{ color: headerColor }}>#{result.order_number}</div>
            <p className="text-2xl text-gray-700 font-semibold">
              Collect from <b>{result.station_name || `Station ${result.station_id}`}</b>
            </p>
            {phone.trim() && (
              <p className="text-lg text-gray-500 mt-2">We'll text you when it's ready.</p>
            )}
            <button onClick={onClose}
              className="mt-8 px-10 py-4 rounded-2xl text-xl font-bold text-white" style={{ backgroundColor: headerColor }}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default KioskOrder;
