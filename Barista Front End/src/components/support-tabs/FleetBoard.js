// FleetBoard.js — Runner > System > Fleet: every CupQ copy on one page.
//
// Roadmap C3-7. One row per copy: up or down, the version it runs, orders
// in the last hour, orders open, texts used, printers online. Red when a
// copy doesn't answer. The numbers for OTHER copies need the shared
// FLEET_STATUS_TOKEN set on each; without it the board still shows up/down
// and version from each copy's public /api/app-version.
import React, { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';

const api = new ApiServiceClass();
const REFRESH_MS = 30000;

const num = (v) => (v === null || v === undefined ? '—' : v);

const FleetBoard = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [list, setList] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.request('/fleet/board');
      if (r?.success === false) throw new Error(r.message || 'Could not read the fleet');
      setData(r.data); setError('');
    } catch (e) { setError(e.message || 'Could not read the fleet'); }
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const startEdit = () => {
    setList((data?.copies || []).filter(c => !c.self).map(c => ({ name: c.name, url: c.url })));
    setEditing(true);
  };
  const save = async () => {
    setSaving(true); setError('');
    try {
      const r = await api.request('/fleet/copies', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copies: list.filter(c => c.url.trim()) }),
      });
      if (r?.success === false) throw new Error(r.message || 'Not saved');
      setEditing(false); load();
    } catch (e) { setError(e.message || 'Not saved'); }
    setSaving(false);
  };

  const copies = data?.copies || [];
  const down = copies.filter(c => !c.up).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-cq-roast">Fleet</h2>
          <p className="text-sm text-cq-ink-3">
            {copies.length ? `${copies.length} cop${copies.length === 1 ? 'y' : 'ies'}` : 'Loading'}
            {down ? `, ${down} not answering` : copies.length ? ', all answering' : ''}. Refreshes every 30 s.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-cq-lg border border-cq-line text-cq-roast font-semibold disabled:opacity-40">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          {!editing && (
            <button type="button" onClick={startEdit}
              className="px-3 py-2 rounded-cq-lg bg-cq-roast text-white font-semibold">Edit copies</button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-cq-alert">{error}</p>}
      {data && !data.token_set && copies.length > 1 && (
        <p className="text-sm text-cq-ink-3">
          Other copies show up/down and version only. For their orders, texts and printers, set the same
          FLEET_STATUS_TOKEN on every copy in Railway.
        </p>
      )}

      <div className="overflow-x-auto rounded-cq-lg border border-cq-line bg-cq-milk">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-cq-ink-3">
            <tr>
              <th className="px-3 py-2">Copy</th><th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Version</th><th className="px-3 py-2">Event</th>
              <th className="px-3 py-2 text-right">Orders / hr</th><th className="px-3 py-2 text-right">Open</th>
              <th className="px-3 py-2 text-right">Texts</th><th className="px-3 py-2 text-right">Printers</th>
            </tr>
          </thead>
          <tbody>
            {copies.map(c => {
              const s = c.stats || {};
              return (
                <tr key={c.url} className={`border-t border-cq-line ${c.up ? '' : 'bg-cq-alert-wash'}`}>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-cq-roast">{c.name}</div>
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cq-ink-3 underline">{c.url.replace('https://', '')}</a>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${c.up ? 'bg-cq-ready-wash text-cq-ready' : 'bg-cq-alert text-white'}`}>
                      {c.up ? 'Up' : 'Down'}
                    </span>
                    {!c.up && c.error && <div className="text-xs text-cq-alert mt-0.5">{c.error}</div>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{c.commit || '—'}</td>
                  <td className="px-3 py-2">{s.event_name || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(s.orders_last_hour)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(s.orders_open)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.texts_used === undefined || s.texts_used === null ? '—' : `${s.texts_used}${s.text_cap ? ` / ${s.text_cap}` : ''}`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.printers ? `${s.printers_online} / ${s.printers} online` : (c.stats ? 'none' : '—')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="rounded-cq-lg border border-cq-line bg-cq-milk p-4 space-y-2">
          <p className="text-sm text-cq-ink-2">Other copies to watch (https on cupq.app or up.railway.app):</p>
          {list.map((c, i) => (
            <div key={i} className="flex gap-2">
              <input value={c.name} placeholder="Name" aria-label="Copy name"
                onChange={e => setList(l => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                className="w-40 px-2 py-1.5 rounded border border-cq-line" />
              <input value={c.url} placeholder="https://demo.cupq.app" aria-label="Copy address"
                onChange={e => setList(l => l.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                className="flex-1 min-w-0 px-2 py-1.5 rounded border border-cq-line font-mono text-xs" />
              <button type="button" aria-label="Remove" onClick={() => setList(l => l.filter((_, j) => j !== i))}
                className="p-2 text-cq-ink-3 hover:text-cq-alert"><Trash2 size={16} /></button>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setList(l => [...l, { name: '', url: '' }])}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-cq-line text-sm"><Plus size={14} /> Add a copy</button>
            <button type="button" onClick={save} disabled={saving}
              className="px-3 py-1.5 rounded bg-cq-roast text-white text-sm font-semibold disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 text-sm text-cq-ink-3">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FleetBoard;
