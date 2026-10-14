// LedgerTab.js — Runner > Report > Ledger (roadmap L6-3).
//
// One page per event: what it was (read from this copy's data) and what to
// charge (prices in utils/pricing.py on the server). Type in the hardware,
// hours and anything else, Save, then Print for the invoice.
import React, { useCallback, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import { showToast } from '../shared/Toast';

const api = new ApiServiceClass();
const aud = (n) => `$${Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Field = ({ label, children }) => (
  <label className="block">
    <span className="text-xs font-bold uppercase tracking-wide text-cq-ink-3">{label}</span>
    <div className="mt-1">{children}</div>
  </label>
);
const inputCls = 'w-full px-3 py-2 rounded-cq-md border-2 border-cq-line bg-white text-cq-roast';

const LedgerTab = () => {
  const [data, setData] = useState(null);
  const [inp, setInp] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/ledger');
      setData(r); setInp(r.inputs || {});
    } catch (e) { setData({ error: (e && e.message) || 'Could not load the ledger' }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put('/ledger', inp);
      setData((d) => ({ ...d, inputs: r.inputs, bill: r.bill }));
      showToast('Ledger saved', 'success');
    } catch (e) { showToast(`Couldn't save: ${(e && e.message) || e}`, 'error'); } finally { setBusy(false); }
  };

  if (!data) return <div className="cq p-6 text-cq-ink-2">Loading…</div>;
  if (data.error) return <div className="cq p-6 text-cq-alert">{data.error}</div>;
  const f = data.facts || {};
  const bill = data.bill || { lines: [] };
  const pl = data.price_list || { hardware: {}, addons: {} };
  const set = (k, v) => setInp((x) => ({ ...x, [k]: v }));
  const other = inp.other || [];

  return (
    <div className="cq">
      <style>{`@media print {
        body * { visibility: hidden; }
        .ledger-print, .ledger-print * { visibility: visible; }
        .ledger-print { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none; }
        .no-print { display: none !important; }
      }`}</style>

      <div className="grid gap-4 2xl:grid-cols-[1fr_420px]">
        <div className="ledger-print bg-cq-milk rounded-cq-lg shadow-cq-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-cq-ink-3">CupQ event ledger</div>
              <h2 className="text-2xl font-extrabold text-cq-roast">{inp.client || 'Client name'}</h2>
              <p className="text-sm text-cq-ink-2">
                {f.by_day && f.by_day.length ? `${f.by_day[0].date} to ${f.by_day[f.by_day.length - 1].date}` : 'No orders yet'}
                {' · '}Plan: {f.tier_name || 'not chosen'}
              </p>
            </div>
            <button type="button" onClick={() => window.print()}
              className="no-print h-10 px-3 inline-flex items-center gap-2 rounded-cq-md border-2 border-cq-line font-bold text-cq-roast">
              <Printer size={16} /> Print
            </button>
          </div>

          <dl className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {[['Days with orders', f.days], ['Orders', f.orders], ['Stations used', f.stations_used],
              ['Texts sent', `${f.texts_sent}${f.texts_included != null ? ` of ${f.texts_included}` : ''}`]].map(([k, v]) => (
              <div key={k} className="bg-cq-wash rounded-cq-md p-3">
                <dt className="text-xs text-cq-ink-3">{k}</dt>
                <dd className="text-xl font-extrabold text-cq-roast">{v}</dd>
              </div>
            ))}
          </dl>
          {f.by_day && f.by_day.length > 0 && (
            <p className="mt-2 text-xs text-cq-ink-3">
              {f.by_day.map((d) => `${d.date}: ${d.orders}`).join(' · ')} (days in {f.timezone})
            </p>
          )}

          <table className="mt-6 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-cq-ink-3 border-b border-cq-line">
                <th className="py-2">Item</th><th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Each</th><th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((l, i) => (
                <tr key={i} className="border-b border-cq-line/60">
                  <td className="py-2">{l.what}{l.note ? <span className="text-cq-ink-3"> · {l.note}</span> : null}</td>
                  <td className="py-2 text-right">{l.qty}</td>
                  <td className="py-2 text-right">{aud(l.each)}</td>
                  <td className="py-2 text-right font-semibold">{aud(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={3} className="pt-3 text-right">Subtotal (ex GST)</td><td className="pt-3 text-right font-bold">{aud(bill.subtotal)}</td></tr>
              <tr><td colSpan={3} className="text-right">GST</td><td className="text-right">{aud(bill.gst)}</td></tr>
              <tr><td colSpan={3} className="text-right text-lg font-extrabold">Total</td><td className="text-right text-lg font-extrabold">{aud(bill.total)}</td></tr>
            </tfoot>
          </table>
          {inp.notes && <p className="mt-4 text-sm text-cq-ink-2 whitespace-pre-line">{inp.notes}</p>}
        </div>

        <div className="no-print bg-cq-milk rounded-cq-lg shadow-cq-card p-6 space-y-4 self-start">
          <h3 className="text-lg font-extrabold text-cq-roast">What to add</h3>
          <Field label="Client"><input className={inputCls} value={inp.client || ''} onChange={(e) => set('client', e.target.value)} /></Field>
          <Field label={`Days to charge (from orders: ${f.days || 0})`}>
            <input className={inputCls} type="number" min="0" value={inp.days_override || ''} placeholder={String(f.days || 1)}
              onChange={(e) => set('days_override', e.target.value)} />
          </Field>
          <Field label="Add-ons">
            {Object.entries(pl.addons).map(([k, a]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={(inp.addons || []).includes(k)}
                  onChange={(e) => set('addons', e.target.checked ? [...(inp.addons || []), k] : (inp.addons || []).filter((x) => x !== k))} />
                {a.name} ({aud(a.price)}{a.included_in.length ? `, included on ${a.included_in.join('/')}` : ''})
                {k === 'eventsair' && f.eventsair_linked ? <span className="text-xs text-cq-ink-3"> · linked on this copy</span> : null}
              </label>
            ))}
          </Field>
          <Field label="Hardware hired (each, for every day)">
            {Object.entries(pl.hardware).map(([k, h]) => (
              <div key={k} className="flex items-center gap-2 text-sm mb-1">
                <input type="number" min="0" className="w-16 px-2 py-1 rounded border border-cq-line"
                  value={(inp.hardware || {})[k] || ''} onChange={(e) => set('hardware', { ...(inp.hardware || {}), [k]: e.target.value })} />
                {h.name} ({aud(h.per_day)}/day)
              </div>
            ))}
          </Field>
          <Field label={`On-site operator hours (${aud(pl.operator_per_hour)}/h, ${pl.operator_min_hours} h min)`}>
            <input className={inputCls} type="number" min="0" step="0.5" value={inp.operator_hours || ''} onChange={(e) => set('operator_hours', e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!inp.remote_setup} onChange={(e) => set('remote_setup', e.target.checked)} />
            Remote setup and rehearsal ({aud(pl.remote_setup)})
          </label>
          <Field label={`Texts: fixed amount (blank = ${aud(pl.text_each)} each beyond the allowance)`}>
            <input className={inputCls} type="number" min="0" step="0.01" value={inp.texts_charge_override ?? ''} onChange={(e) => set('texts_charge_override', e.target.value)} />
          </Field>
          <Field label="Travel"><input className={inputCls} type="number" min="0" value={inp.travel || ''} onChange={(e) => set('travel', e.target.value)} /></Field>
          <Field label="Other lines (negative for a discount)">
            {other.map((o, i) => (
              <div key={i} className="flex gap-2 mb-1">
                <input className="flex-1 px-2 py-1 rounded border border-cq-line text-sm" value={o[0]}
                  onChange={(e) => set('other', other.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} />
                <input className="w-24 px-2 py-1 rounded border border-cq-line text-sm" type="number" value={o[1]}
                  onChange={(e) => set('other', other.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} />
                <button type="button" className="text-cq-alert text-sm" onClick={() => set('other', other.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button type="button" className="text-sm font-semibold text-cq-caramel-deep" onClick={() => set('other', [...other, ['', '']])}>+ Add a line</button>
          </Field>
          <Field label="Notes on the page"><textarea className={inputCls} rows={2} value={inp.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
          <button type="button" onClick={save} disabled={busy}
            className="w-full h-11 rounded-cq-md bg-cq-roast text-cq-cream font-bold disabled:opacity-50">Save and work it out</button>
        </div>
      </div>
    </div>
  );
};

export default LedgerTab;
