// OnCallTab.js — Runner > People > On call (roadmap U4-6).
//
// Who answers on each event day. Alerts (printer down, texts failing) and
// the ? button's help requests text whoever is on call at that moment, as
// well as the admin alert number, so the roster adds people and never
// removes the backstop. Times are the event's own clock.
import React, { useEffect, useState } from 'react';
import { Plus, Trash2, PhoneCall } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import { showToast } from '../shared/Toast';

const api = new ApiServiceClass();
const blank = () => ({ name: '', phone: '', email: '', day: '', start: '07:00', end: '16:00' });

const OnCallTab = () => {
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState(false);

  const take = (r) => {
    setData(r);
    setRows((r.shifts || []).map((s) => ({ ...s })));
  };
  useEffect(() => {
    api.get('/settings/on-call').then(take).catch(() => setData({ shifts: [], on_now: [] }));
  }, []);

  const edit = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => setRows((rs) => [...rs, { ...blank(), day: (data && data.event_now || '').slice(0, 10) }]);
  const remove = (i) => setRows((rs) => rs.filter((_, j) => j !== i));

  const save = async () => {
    setBusy(true); setProblems([]);
    try {
      const r = await api.put('/settings/on-call', { shifts: rows });
      if (r && r.success === false) { setProblems(r.problems || [r.message]); return; }
      take(r);
      showToast('Roster saved', 'success');
    } catch (e) {
      // ApiService puts the server's reply on e.details (not e.response.data).
      const p = e && e.details && e.details.problems;
      setProblems(p || ["Couldn't save the roster."]);
    } finally { setBusy(false); }
  };

  if (!data) return <div className="cq p-6 text-cq-ink-2">Loading…</div>;
  const input = 'h-10 px-2 rounded-cq-sm border-2 border-cq-line bg-white text-cq-roast text-sm w-full';
  return (
    <div className="cq bg-cq-milk rounded-cq-lg shadow-cq-card p-6">
      <div className="flex items-center gap-2">
        <PhoneCall className="text-cq-caramel" size={22} />
        <h2 className="text-xl font-extrabold text-cq-roast">On call</h2>
      </div>
      <p className="text-sm text-cq-ink-2 mt-1 max-w-[70ch]">
        Who answers on each event day. Alerts and help requests from the ? button are texted (or emailed) to
        whoever is on call at that moment, and always to the admin alert number too. Times are the event's
        clock ({data.timezone}); a shift that ends before it starts runs past midnight.
      </p>
      <div className="mt-3 text-sm font-semibold text-cq-roast">
        On call now ({data.event_now}): {data.on_now && data.on_now.length ? data.on_now.join(', ') : 'nobody (the admin number only)'}
      </div>

      <div className="mt-5 space-y-3">
        {rows.length === 0 && <div className="text-sm text-cq-ink-3">Nobody on the roster yet.</div>}
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-2 md:grid-cols-6 xl:grid-cols-12 gap-2 items-end border-b border-cq-line pb-3">
            <label className="col-span-2 md:col-span-2 text-xs text-cq-ink-3">Name
              <input className={input} value={r.name} onChange={(e) => edit(i, 'name', e.target.value)} />
            </label>
            <label className="col-span-1 md:col-span-2 text-xs text-cq-ink-3">Mobile
              <input className={input} type="tel" value={r.phone} placeholder="+61…" onChange={(e) => edit(i, 'phone', e.target.value)} />
            </label>
            <label className="col-span-1 md:col-span-2 text-xs text-cq-ink-3">Email (optional)
              <input className={input} type="email" value={r.email} onChange={(e) => edit(i, 'email', e.target.value)} />
            </label>
            <label className="col-span-2 md:col-span-2 text-xs text-cq-ink-3">Day
              <div className="flex gap-1">
                <input className={input} type="date" value={r.day === 'every' ? '' : r.day} disabled={r.day === 'every'}
                  onChange={(e) => edit(i, 'day', e.target.value)} aria-label={`Day for ${r.name || 'this shift'}`} />
              </div>
              <span className="inline-flex items-center gap-1 mt-1">
                <input type="checkbox" checked={r.day === 'every'} onChange={(e) => edit(i, 'day', e.target.checked ? 'every' : '')} />
                every day
              </span>
            </label>
            <label className="col-span-1 md:col-span-1 xl:col-span-2 text-xs text-cq-ink-3">From
              <input className={input} type="time" value={r.start} onChange={(e) => edit(i, 'start', e.target.value)} />
            </label>
            <label className="col-span-1 md:col-span-2 xl:col-span-1 text-xs text-cq-ink-3">To
              <input className={input} type="time" value={r.end} onChange={(e) => edit(i, 'end', e.target.value)} />
            </label>
            <button type="button" onClick={() => remove(i)} aria-label={`Remove ${r.name || 'this shift'}`}
              className="col-span-2 md:col-span-1 h-10 inline-flex items-center justify-center text-cq-alert hover:underline text-sm">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      {problems.length > 0 && (
        <ul className="mt-3 text-sm font-semibold text-cq-alert list-disc pl-5">
          {problems.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={add}
          className="h-11 px-4 rounded-cq-md border-2 border-cq-line text-cq-roast font-semibold inline-flex items-center gap-1.5">
          <Plus size={16} /> Add a shift
        </button>
        <button type="button" onClick={save} disabled={busy}
          className="h-11 px-5 rounded-cq-md bg-cq-roast text-cq-cream font-bold disabled:opacity-50">Save roster</button>
      </div>
    </div>
  );
};

export default OnCallTab;
