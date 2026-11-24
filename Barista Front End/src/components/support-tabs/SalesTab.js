// SalesTab -- one list from enquiry to paid (L6-9). Website enquiries and
// sign-ups join it by themselves; leads from elsewhere are added by hand.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2, TrendingUp } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import { Panel, Empty, Button } from '../../design';
import { showToast } from '../shared/Toast';
import { askConfirm } from '../shared/ConfirmDialog';
import { money, summary, isOverdue, localToday } from '../../utils/salesList';

const LABEL = {
  enquiry: 'Enquiry', demo: 'Demo', quoted: 'Quoted', signed: 'Signed',
  event: 'Event', invoiced: 'Invoiced', paid: 'Paid', lost: 'Lost',
};
const FROM = { demo: 'website enquiry', signup: 'sign-up', manual: 'added by hand' };
const input = 'h-10 px-2 rounded-cq-sm border border-cq-line bg-white text-sm text-cq-roast';

// Saves when you leave the box, and only if it changed.
const Edit = ({ lead, field, label, type = 'text', className = '', onSave }) => {
  const now = lead[field] ?? '';
  return (
    <label className={`text-xs text-cq-ink-3 block ${className}`}>{label}
      <input key={`${lead.id}-${now}`} type={type} defaultValue={now} className={`${input} w-full mt-0.5`}
        onBlur={(e) => { if (e.target.value !== String(now)) onSave(lead, { [field]: e.target.value }); }} />
    </label>
  );
};

export default function SalesTab() {
  const apiRef = useRef(null);
  if (!apiRef.current) apiRef.current = new ApiServiceClass();
  const [leads, setLeads] = useState(null);
  const [stages, setStages] = useState([]);
  const [show, setShow] = useState('open');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await apiRef.current.get('/sales');
      if (!r || !Array.isArray(r.leads)) throw new Error((r && r.message) || '');
      setLeads(r.leads); setStages(r.stages || []);
    } catch (e) { setError('Could not load the sales list. It needs an admin login.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const call = async (method, path, body) => {
    try {
      return await apiRef.current.request(path, {
        method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { return { success: false, message: e?.details?.message }; }
  };
  const save = async (lead, change) => {
    const r = await call('PATCH', `/sales/${lead.id}`, change);
    if (r && r.success) setLeads((all) => all.map((l) => (l.id === lead.id ? r.lead : l)));
    else { showToast((r && r.message) || "Couldn't save that", 'error'); load(); }
  };
  const add = async (e) => {
    e.preventDefault();
    if (!adding.trim()) return;
    const r = await call('POST', '/sales', { organisation: adding });
    if (r && r.success) { setAdding(''); setShow('open'); setLeads((all) => [r.lead, ...all]); }
    else showToast((r && r.message) || "Couldn't add that", 'error');
  };
  const remove = async (lead) => {
    if (!(await askConfirm({ title: `Delete ${lead.organisation || lead.name}?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
    const r = await call('DELETE', `/sales/${lead.id}`);
    if (r && r.success) setLeads((all) => all.filter((l) => l.id !== lead.id));
    else showToast((r && r.message) || "Couldn't delete that", 'error');
  };

  if (error) return <div className="cq"><Empty>{error}</Empty></div>;
  if (!leads) return <div className="cq"><Empty>Loading…</Empty></div>;
  const today = localToday();
  const totals = summary(leads, stages);
  const shown = leads
    .filter((l) => (show === 'all' ? true : show === 'open' ? !['paid', 'lost'].includes(l.stage) : l.stage === show))
    .sort((a, b) => (a.next_date || '9999').localeCompare(b.next_date || '9999'));

  return (
    <div className="cq max-w-4xl">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="text-cq-caramel" size={22} />
        <h2 className="text-lg font-bold text-cq-roast">Sales</h2>
      </div>
      <p className="text-sm text-cq-ink-3 mb-4 max-w-[62ch]">
        Everyone who might book, from enquiry to paid. Website enquiries and sign-ups appear by themselves.
        Changes save as you go. Values are ex GST.
      </p>
      <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Show">
        {[['open', 'Open', totals.open], ...stages.map((s) => [s, LABEL[s] || s, totals[s]]), ['all', 'All', totals.all]].map(([id, label, t]) => (
          <button key={id} type="button" onClick={() => setShow(id)} aria-pressed={show === id}
            className={`px-3 py-1.5 rounded-full border-2 text-sm ${show === id ? 'border-cq-caramel bg-cq-caramel-wash font-semibold text-cq-roast' : 'border-cq-line text-cq-ink-2'}`}>
            {label} {t.count}{t.value ? ` · ${money(t.value)}` : ''}
          </button>
        ))}
      </div>
      <form onSubmit={add} className="flex gap-2 mb-4">
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Organisation" aria-label="New lead's organisation" className={`${input} flex-1 max-w-xs`} />
        <Button size="sm" variant="secondary" Icon={Plus} type="submit">Add</Button>
      </form>
      {shown.length === 0 ? <Empty>Nothing here.</Empty> : null}
      <div className="space-y-3">
        {shown.map((l) => (
          <Panel key={l.id} className={l.stage === 'lost' ? 'opacity-60' : ''}>
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-[12rem]">
                <div className="font-bold text-cq-roast break-words">{l.organisation || l.name}</div>
                <div className="text-xs text-cq-ink-3">{new Date(l.created_at).toLocaleDateString()} · {FROM[l.source] || l.source}{l.event_when ? ` · ${l.event_when}` : ''}</div>
              </div>
              <select value={l.stage} aria-label={`Stage for ${l.organisation || l.name}`} onChange={(e) => save(l, { stage: e.target.value })} className={`${input} font-semibold`}>
                {stages.map((s) => <option key={s} value={s}>{LABEL[s] || s}</option>)}
              </select>
              {l.source === 'manual' ? (
                <button type="button" onClick={() => remove(l)} aria-label={`Delete ${l.organisation || l.name}`} className="h-10 w-10 inline-flex items-center justify-center text-cq-ink-3"><Trash2 size={16} /></button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mt-3">
              <Edit lead={l} field="next_step" label="Next step" className="sm:col-span-2" onSave={save} />
              <Edit lead={l} field="next_date" label={isOverdue(l, today) ? 'By (overdue)' : 'By'} type="date" onSave={save} />
              <Edit lead={l} field="value" label="Value $" onSave={save} />
            </div>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-cq-ink-2">Contact and notes</summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <Edit lead={l} field="name" label="Name" onSave={save} />
                <Edit lead={l} field="email" label="Email" onSave={save} />
                <Edit lead={l} field="phone" label="Phone" onSave={save} />
                <Edit lead={l} field="event_when" label="Event and when" onSave={save} />
              </div>
              <label className="text-xs text-cq-ink-3 block mt-2">Notes
                <textarea key={`${l.id}-${l.notes || ''}`} rows={3} defaultValue={l.notes || ''} className="w-full mt-0.5 p-2 rounded-cq-sm border border-cq-line bg-white text-sm text-cq-roast"
                  onBlur={(e) => { if (e.target.value !== (l.notes || '')) save(l, { notes: e.target.value }); }} />
              </label>
            </details>
          </Panel>
        ))}
      </div>
    </div>
  );
}
