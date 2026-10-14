// PhoneWordingTab.js — Runner > Branding > Phone wording (roadmap X7-5).
//
// What the customer's phone says at each stage of their order. Leave a line
// empty to keep CupQ's wording (shown greyed). Colours stay ours: they carry
// the meaning (blue queued, amber being made, green ready).
import React, { useEffect, useState } from 'react';
import ApiServiceClass from '../../services/ApiService';
import { CUSTOMER_STATUS } from '../../constants/customerStatus';
import { showToast } from '../shared/Toast';

const api = new ApiServiceClass();
const MAX = 60;
const LABELS = {
  pending: 'Waiting in the queue',
  'in-progress': 'Being made',
  completed: 'Ready to collect',
  picked_up: 'Collected',
  cancelled: 'Cancelled',
  awaiting_payment: 'Waiting for payment (pay-to-order events only)',
};
const ORDER = ['pending', 'in-progress', 'completed', 'picked_up', 'cancelled', 'awaiting_payment'];

const PhoneWordingTab = () => {
  const [wording, setWording] = useState({});
  const [saved, setSaved] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/settings/customer-wording');
        const w = (r && r.wording) || {};
        setWording(w); setSaved(w);
      } catch (e) { /* keep empty: CupQ's wording */ }
    })();
  }, []);

  const changed = JSON.stringify(wording) !== JSON.stringify(saved);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put('/settings/customer-wording', { wording });
      const w = (r && r.wording) || {};
      setWording(w); setSaved(w);
      showToast('Saved. Phones show it the next time they load.', 'success');
    } catch (e) {
      showToast(`Couldn't save: ${(e && e.message) || e}`, 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="cq bg-cq-milk rounded-cq-lg shadow-cq-card p-6">
      <h2 className="text-xl font-extrabold text-cq-roast">Phone wording</h2>
      <p className="text-cq-ink-2 mt-1 text-sm">
        The big line on a customer's phone at each stage of their order. Leave one empty to keep CupQ's wording.
        Up to {MAX} characters.
      </p>
      <div className="mt-5 space-y-4">
        {ORDER.map((k) => {
          const ours = CUSTOMER_STATUS[k].title;
          const val = wording[k] || '';
          return (
            <div key={k} className="grid gap-3 md:grid-cols-[1fr_260px] items-center">
              <label className="block">
                <span className="text-sm font-bold text-cq-roast">{LABELS[k]}</span>
                <input value={val} maxLength={MAX} placeholder={ours}
                  onChange={(e) => setWording((w) => ({ ...w, [k]: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-cq-md border-2 border-cq-line bg-white text-cq-roast" />
                {val.length > MAX - 10 && <span className="text-xs text-cq-ink-3">{MAX - val.length} characters left</span>}
              </label>
              <div className={`${CUSTOMER_STATUS[k].tone} text-white rounded-cq-md px-4 py-3 font-extrabold text-lg truncate`}
                title="How it looks on the phone">
                {val.trim() || ours}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-6 flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy || !changed}
          className="h-11 px-5 rounded-cq-md bg-cq-roast text-cq-cream font-bold disabled:opacity-50">Save</button>
        <button type="button" onClick={() => setWording({})} disabled={busy}
          className="h-11 px-4 text-sm font-semibold text-cq-ink-2 hover:underline">Use CupQ's wording for all</button>
      </div>
    </div>
  );
};

export default PhoneWordingTab;
