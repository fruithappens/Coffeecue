// QuickPicksSettings.js — Runner > Menu > Quick picks.
//
// The organiser's one-tap drinks. A lounge sells the same three or four
// drinks to most people; set each one up here (drink, milk, cup) and it
// shows as a big button at the top of every ordering screen -- the phone
// page, the kiosk and the barista's walk-up form -- so the common order
// is one tap and a name.
//
// Choices come from the live public menu (/api/display/menu), so a pick
// can only name a drink and milk this event actually carries. The saved
// list (/api/quick-picks) is kept as written: a pick whose milk is 86'd
// today stays here, marked "hidden today", instead of being deleted.
import React, { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, Trash2, Plus, Zap } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';

const api = new ApiServiceClass();
const MAX_PICKS = 6;
// Drink + milk only: the server fills a blank cup with the default size,
// so the live pick and the saved one differ there by design.
const keyOf = (p) => `${p.drink}|${p.milk || ''}`;

const QuickPicksSettings = () => {
  const [menu, setMenu] = useState(null);
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null); // {kind:'ok'|'error', text}

  const loadMenu = async () => {
    const r = await fetch('/api/display/menu', { cache: 'no-cache' });
    const b = r.ok ? await r.json() : null;
    setMenu(b?.menu || null);
  };

  useEffect(() => {
    (async () => {
      try {
        const [saved] = await Promise.all([api.request('/quick-picks'), loadMenu()]);
        if (saved?.success) setPicks(saved.quick_picks || []);
        else setMessage({ kind: 'error', text: 'Could not load the saved quick picks.' });
      } catch (e) {
        setMessage({ kind: 'error', text: 'Could not load the saved quick picks.' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const drinks = (menu?.coffee_types || []).filter(d => (d.stations || []).length > 0);
  const milks = (menu?.milks || []).filter(m => !m.unavailable && !(m.value || '').includes('no milk'));
  const sizes = menu?.sizes || [];
  // What the ordering screens will actually show right now.
  const liveKeys = new Set((menu?.quick_picks || []).map(keyOf));

  const update = (i, patch) => setPicks(ps => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const move = (i, d) => setPicks(ps => {
    const j = i + d;
    if (j < 0 || j >= ps.length) return ps;
    const next = ps.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = (i) => setPicks(ps => ps.filter((_, j) => j !== i));
  const add = () => setPicks(ps => [...ps, {
    drink: drinks[0]?.value || '', milk: milks[0]?.value || '', size: '', label: '',
  }]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const r = await api.request('/quick-picks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quick_picks: picks }),
      });
      if (!r?.success) throw new Error(r?.message || r?.error || 'Save failed');
      setPicks(r.quick_picks || []);
      await loadMenu();
      setMessage({ kind: 'ok', text: 'Saved. Ordering screens pick this up on their next menu load.' });
    } catch (e) {
      setMessage({ kind: 'error', text: `Not saved: ${e.message}` });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-8">Loading quick picks…</div>;

  const select = 'border border-cq-line rounded-cq-md px-2 py-2 bg-cq-milk text-cq-roast min-w-0';

  return (
    <div className="bg-cq-milk shadow-cq-card rounded-cq-md p-6">
      <h2 className="text-xl font-bold mb-1 flex items-center gap-2"><Zap size={20} /> Quick picks</h2>
      <p className="text-cq-ink-2 mb-5 max-w-2xl">
        The drinks most people order, as one-tap buttons at the top of the phone page,
        the kiosk and the walk-up form. Tap, add a name, done. Up to {MAX_PICKS}; the
        first is shown first. A pick is hidden automatically while its drink or milk is off.
      </p>

      {message && (
        <div className={`mb-4 px-4 py-3 rounded-cq-md ${message.kind === 'ok'
          ? 'bg-green-50 text-green-800 border border-green-200'
          : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {message.text}
        </div>
      )}

      {picks.length === 0 && (
        <div className="py-6 text-center text-cq-ink-3 border-2 border-dashed border-cq-line rounded-cq-md mb-4">
          No quick picks yet. Customers see the full menu only.
        </div>
      )}

      <div className="space-y-3">
        {picks.map((p, i) => {
          const live = liveKeys.has(keyOf(p));
          return (
            <div key={i} className="p-3 border-2 border-cq-line rounded-cq-md">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_1.4fr_auto] gap-2 items-center">
                <select className={select} value={p.drink} aria-label="Drink"
                  onChange={e => update(i, { drink: e.target.value })}>
                  {!drinks.some(d => d.value === p.drink) && <option value={p.drink}>{p.drink || 'Choose a drink'}</option>}
                  {drinks.map(d => <option key={d.value} value={d.value}>{d.name}</option>)}
                </select>
                <select className={select} value={p.milk || ''} aria-label="Milk"
                  onChange={e => update(i, { milk: e.target.value })}>
                  <option value="">No milk</option>
                  {p.milk && !milks.some(m => m.value === p.milk) && <option value={p.milk}>{p.milk}</option>}
                  {milks.map(m => <option key={m.value} value={m.value}>{m.name}</option>)}
                </select>
                <select className={select} value={p.size || ''} aria-label="Cup"
                  onChange={e => update(i, { size: e.target.value })}>
                  <option value="">Default cup</option>
                  {sizes.map(s => <option key={s.value} value={s.value}>{s.name}</option>)}
                </select>
                <input className={select} value={p.label || ''} maxLength={40} aria-label="Button text"
                  placeholder="Button text (optional)"
                  onChange={e => update(i, { label: e.target.value })} />
                <div className="flex gap-1 justify-end">
                  <button className="p-2 rounded hover:bg-cq-wash disabled:opacity-30" disabled={i === 0}
                    onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={18} /></button>
                  <button className="p-2 rounded hover:bg-cq-wash disabled:opacity-30" disabled={i === picks.length - 1}
                    onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={18} /></button>
                  <button className="p-2 rounded hover:bg-red-50 text-red-700"
                    onClick={() => remove(i)} aria-label="Remove"><Trash2 size={18} /></button>
                </div>
              </div>
              {!live && p.drink && (
                <div className="mt-2 text-sm text-cq-caramel-deep">
                  Hidden today: this drink or milk isn't available right now (or not saved yet).
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap justify-between gap-3">
        <button onClick={add} disabled={picks.length >= MAX_PICKS || drinks.length === 0}
          className="flex items-center gap-1 bg-cq-line hover:bg-cq-wash text-cq-roast font-medium py-2 px-4 rounded disabled:opacity-40">
          <Plus size={18} /> Add a quick pick
        </button>
        <button onClick={save} disabled={saving}
          className="bg-cq-ready text-white font-medium py-2 px-4 rounded disabled:opacity-60">
          {saving ? 'Saving…' : 'Save quick picks'}
        </button>
      </div>
    </div>
  );
};

export default QuickPicksSettings;
