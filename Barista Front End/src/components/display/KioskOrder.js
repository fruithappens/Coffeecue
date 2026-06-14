// components/display/KioskOrder.js
//
// Self-service "order here" kiosk overlay for the public Display screen.
// Touch-first: type your name, tap a drink, milk, size, set sugar with +/−,
// confirm, done. Items only available at OTHER stations are shown greyed-out
// with the station numbers that make them; if the customer picks one, we tell
// them which station to collect from (the backend routes the order there).
//
// Talks to the PUBLIC endpoints (no auth, like the rest of the Display):
//   GET  /api/display/menu   → { menu: { stations, coffee_types, milks, sizes } }
//   POST /api/display/order  → { order_number, station_id, station_name, reassigned }
import React, { useState, useEffect, useMemo } from 'react';
import { X, ArrowLeft, Plus, Minus, Check, Loader } from 'lucide-react';

// Friendly emoji per item so the buttons read at a glance from across a venue.
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
  const [step, setStep] = useState('name'); // name → drink → milk → size → sugar → review → done
  const [name, setName] = useState('');
  const [drink, setDrink] = useState(null);
  const [milk, setMilk] = useState(null);
  const [size, setSize] = useState(null);
  const [sugar, setSugar] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // The station this display is set to (null/'all' → let the backend choose).
  const myStation = useMemo(() => {
    const n = parseInt(stationId, 10);
    return Number.isFinite(n) ? n : null;
  }, [stationId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/display/menu');
        const b = r.ok ? await r.json() : null;
        if (!cancelled && b && b.success) setMenu(b.menu);
      } catch (e) {
        /* leave menu null → show a gentle error */
      } finally {
        if (!cancelled) setLoadingMenu(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // "No milk" is always offered (tea / black coffee) even if no station lists it.
  const milkOptions = useMemo(() => {
    const base = (menu?.milks || []).slice();
    if (!base.some(m => (m.value || '').includes('no milk'))) {
      base.push({ name: 'No milk', value: 'no milk', stations: (menu?.stations || []).map(s => s.id) });
    }
    return base;
  }, [menu]);

  // Does this display's station make the given item? (no station set → yes)
  const madeHere = (item) => {
    if (!item) return true;
    if (myStation == null) return true;
    return (item.stations || []).includes(myStation);
  };
  const stationLabel = (item) => (item?.stations || []).map(s => `${s}`).join(', ');

  // Stations that can make the WHOLE chosen order (intersection). Drives the
  // "collect from Station X" note.
  const collectStations = useMemo(() => {
    const sets = [drink, milk, size].filter(Boolean).map(i => new Set(i.stations || []));
    if (sets.length === 0) return [];
    let inter = null;
    sets.forEach(s => {
      if (inter == null) inter = new Set(s);
      else inter = new Set([...inter].filter(x => s.has(x)));
    });
    return [...(inter || [])];
  }, [drink, milk, size]);

  const collectsHere = myStation == null || collectStations.includes(myStation);
  const collectElsewhere = !collectsHere && collectStations.length > 0;

  const sizeChoices = menu?.sizes || [];
  const needsSizeStep = sizeChoices.length > 1;

  const goAfterMilk = () => setStep(needsSizeStep ? 'size' : 'sugar');

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
        }),
      });
      const b = await r.json();
      if (r.ok && b.success) {
        setResult(b);
        setStep('done');
        // Auto-close the success screen so the kiosk is ready for the next person.
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

  // ---- little presentational helpers -------------------------------------
  const Tile = ({ active, disabled, onClick, emoji, label, sub }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative flex flex-col items-center justify-center rounded-2xl p-5 min-h-[120px] text-center transition
        ${active ? 'ring-4 ring-offset-2' : 'shadow'}
        ${disabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-800 hover:shadow-lg active:scale-95'}`}
      style={active ? { boxShadow: `0 0 0 4px ${headerColor}` } : undefined}
    >
      <span className="text-4xl mb-2" aria-hidden>{emoji}</span>
      <span className="text-xl font-bold leading-tight">{label}</span>
      {sub && <span className="mt-1 text-xs font-semibold text-amber-600">{sub}</span>}
    </button>
  );

  const Header = ({ title, onBack }) => (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        {onBack && (
          <button onClick={onBack} className="p-2 rounded-full bg-white/90 text-gray-700 hover:bg-white">
            <ArrowLeft size={28} />
          </button>
        )}
        <h2 className="text-3xl font-extrabold text-white drop-shadow">{title}</h2>
      </div>
      <button onClick={onClose} className="p-2 rounded-full bg-white/90 text-gray-700 hover:bg-white" title="Cancel">
        <X size={28} />
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: `linear-gradient(135deg, ${headerColor}ee, #000000cc)` }}>
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl p-6 md:p-8"
           style={{ backgroundColor: '#f8fafc' }}>

        {/* ---------- NAME ---------- */}
        {step === 'name' && (
          <>
            <Header title="Order here ☕" />
            <p className="text-xl text-gray-600 mb-3 font-medium">What's your first name?</p>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Type your name"
              className="w-full text-3xl font-bold p-5 rounded-2xl border-4 border-gray-200 focus:outline-none"
              style={{ borderColor: name ? headerColor : undefined }}
            />
            <button
              disabled={name.trim().length < 2}
              onClick={() => setStep('drink')}
              className="mt-6 w-full py-5 rounded-2xl text-2xl font-extrabold text-white disabled:opacity-40"
              style={{ backgroundColor: headerColor }}
            >
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
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {(menu?.coffee_types || []).map(d => {
                  const here = madeHere(d);
                  return (
                    <Tile key={d.value} emoji={drinkEmoji(d.value)} label={d.name}
                      active={drink?.value === d.value}
                      disabled={false}
                      sub={here ? null : `Station ${stationLabel(d)} only`}
                      onClick={() => { setDrink(d); setStep('milk'); }} />
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ---------- MILK ---------- */}
        {step === 'milk' && (
          <>
            <Header title="Milk?" onBack={() => setStep('drink')} />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {milkOptions.map(m => {
                const here = madeHere(m);
                return (
                  <Tile key={m.value} emoji={milkEmoji(m.value)} label={m.name}
                    active={milk?.value === m.value}
                    disabled={false}
                    sub={here ? null : `Station ${stationLabel(m)} only`}
                    onClick={() => { setMilk(m); goAfterMilk(); }} />
                );
              })}
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
                className="p-6 rounded-full bg-white shadow text-gray-700 active:scale-95 disabled:opacity-40"
                disabled={sugar === 0}>
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
            <button onClick={() => setStep('review')}
              className="w-full py-5 rounded-2xl text-2xl font-extrabold text-white"
              style={{ backgroundColor: headerColor }}>
              Review order →
            </button>
          </>
        )}

        {/* ---------- REVIEW ---------- */}
        {step === 'review' && (
          <>
            <Header title="All good?" onBack={() => setStep('sugar')} />
            <div className="bg-white rounded-2xl p-6 shadow mb-4">
              <div className="text-2xl font-extrabold text-gray-800 mb-3">{name.trim()}</div>
              <ul className="text-xl text-gray-700 space-y-1">
                <li>{drinkEmoji(drink?.value)} {drink?.name}</li>
                <li>{milkEmoji(milk?.value)} {milk?.name}</li>
                {size && <li>🥤 {size.name}</li>}
                <li>🍬 {sugar === 0 ? 'No sugar' : `${sugar} sugar${sugar > 1 ? 's' : ''}`}</li>
              </ul>
            </div>
            {collectElsewhere && (
              <div className="rounded-2xl p-4 mb-4 bg-amber-100 text-amber-900 text-lg font-semibold">
                Heads up: these options are made at <b>Station {collectStations.join(' / ')}</b> —
                please collect your order there.
              </div>
            )}
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
            <button onClick={onClose}
              className="mt-8 px-10 py-4 rounded-2xl text-xl font-bold text-white"
              style={{ backgroundColor: headerColor }}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default KioskOrder;
