import React, { useCallback, useEffect, useState } from 'react';
import { Ban, RefreshCw } from 'lucide-react';
import { Panel } from '../../design';

/**
 * The 86 board — one tap between reality and the menu.
 *
 * Backend shipped on rebuild night 1 (#431); this is the button. A
 * barista who watches the last soy carton glug across the floor taps
 * SOY once and it is refused and hidden on every channel — SMS, kiosk,
 * walk-in — whatever the ledger still believes, even in unlimited
 * mode. Tap again when the spare box turns up and the arithmetic
 * speaks again. Every tap is logged server-side with who and when.
 *
 * Chips are event-wide: "we're out" at a two-station cart almost
 * always means the event is out. Per-station overrides exist in the
 * API for the day that stops being true.
 */

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
  'Content-Type': 'application/json',
});

const Chip = ({ label, dead, onToggle, busy }) => (
  <button
    onClick={onToggle}
    disabled={busy}
    className={`px-3 py-2 rounded-cq-md border-2 text-sm font-semibold capitalize
                transition-colors disabled:opacity-40 ${dead
                  ? 'bg-cq-alert border-cq-alert text-white line-through'
                  : 'bg-cq-milk border-cq-line text-cq-roast hover:border-cq-alert'}`}
    title={dead ? `86'd — tap to bring back` : 'Tap to 86 (mark sold out everywhere)'}
  >
    {label}
  </button>
);

const EightySixBoard = () => {
  const [menu, setMenu] = useState({ drinks: [], milks: [], beans: [] });
  const [dead, setDead] = useState({});   // "category:name" -> true
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [rm, ro] = await Promise.all([
        fetch('/api/display/menu'),
        fetch('/api/stock-overrides', { headers: authHeaders() }),
      ]);
      const bm = rm.ok ? await rm.json() : {};
      const m = bm.menu || {};
      const bo = ro.ok ? await ro.json() : {};
      const nextDead = {};
      (bo.overrides || []).forEach((o) => {
        if (o.state === '86' && !o.station_id) {
          nextDead[`${o.category}:${o.name}`] = true;
        }
      });
      // The menu hides 86'd items (by design), so the chip list is the
      // union of what's on now PLUS what's currently 86'd — otherwise
      // a dead item would vanish from the board that revives it.
      const drinks = new Set((m.coffee_types || []).map((x) => x.value));
      const milks = new Set((m.milks || []).map((x) => x.value));
      const beans = new Set(m.beans || []);
      Object.keys(nextDead).forEach((k) => {
        const [cat, name] = k.split(':');
        if (cat === 'drink') drinks.add(name);
        if (cat === 'milk') milks.add(name);
        if (cat === 'coffee') beans.add(name);
      });
      setMenu({
        drinks: [...drinks].sort(),
        milks: [...milks].sort(),
        beans: [...beans].sort(),
      });
      setDead(nextDead);
    } catch (e) { /* next refresh */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (category, name) => {
    const key = `${category}:${name}`;
    setBusy(key);
    try {
      await fetch('/api/stock-overrides', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          category, name,
          state: dead[key] ? 'clear' : '86',
        }),
      });
      await load();
    } finally {
      setBusy('');
    }
  };

  const Row = ({ title, cat, items }) => (
    items.length > 0 && (
      <div className="mt-2">
        <div className="text-xs font-extrabold uppercase tracking-wider text-cq-ink-3 mb-1.5">
          {title}
        </div>
        <div className="flex flex-wrap gap-2">
          {items.map((n) => (
            <Chip key={n} label={n}
              dead={!!dead[`${cat}:${n}`]}
              busy={busy === `${cat}:${n}`}
              onToggle={() => toggle(cat, n)} />
          ))}
        </div>
      </div>
    )
  );

  return (
    <Panel
      title="86 board"
      Icon={Ban}
      right={<button onClick={load} className="text-cq-ink-3 hover:text-cq-roast"
                     title="Refresh"><RefreshCw size={15} /></button>}
    >
      <p className="text-sm text-cq-ink-3 -mt-1 mb-1">
        Tap to mark sold out everywhere, instantly. Tap again to bring it back.
      </p>
      <Row title="Drinks" cat="drink" items={menu.drinks} />
      <Row title="Milks" cat="milk" items={menu.milks} />
      <Row title="Beans" cat="coffee" items={menu.beans} />
    </Panel>
  );
};

export default EightySixBoard;
