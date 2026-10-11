// PlanTierCard -- Runner > Settings: which plan this event is on.
//
// The tier decides the attendee cap, station limit, included texts and which
// features are on (utils/plan_limits.py). There was no way to set it from the
// app, so every instance ran with no plan (no limits). Server side:
// routes/plan_routes.py.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BadgeCheck, Loader } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import { Panel, Button } from '../../design';
import { askConfirm } from '../shared/ConfirmDialog';
import { showToast } from '../shared/Toast';

const num = (v, unit) => (v == null ? `Unlimited ${unit}` : `${Number(v).toLocaleString()} ${unit}`);
const FEATURES = [['vip', 'VIP rules'], ['group_orders', 'Group orders'], ['square', 'Card payments'], ['badge_scan', 'Badge scan']];

export default function PlanTierCard() {
  const apiRef = useRef(null);
  if (!apiRef.current) apiRef.current = new ApiServiceClass();
  const [data, setData] = useState(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await apiRef.current.get('/plan');
      if (r && r.success) { setData(r.data); setPick(r.data.tier || ''); }
      else setError((r && r.message) || 'Could not load the plan.');
    } catch (e) { setError(e?.message || 'Could not load the plan.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const name = pick ? data.tiers.find((t) => t.key === pick)?.name : 'No plan';
    if (!(await askConfirm({
      title: `Switch to ${name}?`,
      message: pick ? 'Its limits apply straight away to new orders, stations and texts. Existing orders are not affected.' : 'All plan limits are lifted.',
      confirmLabel: 'Switch plan',
    }))) return;
    setBusy(true);
    try {
      const r = await apiRef.current.put('/plan', { tier: pick || null });
      if (r && r.success) { setData(r.data); showToast(`Plan set to ${name}`, 'success'); }
      else showToast((r && r.message) || 'Could not save the plan', 'error');
    } catch (e) { showToast(e?.message || 'Could not save the plan', 'error'); }
    finally { setBusy(false); }
  };

  if (error) return <Panel title="Plan" Icon={BadgeCheck}><p className="text-sm text-cq-alert">{error}</p></Panel>;
  if (!data) return <Panel title="Plan" Icon={BadgeCheck}><span className="inline-flex items-center gap-2 text-sm text-cq-ink-3"><Loader className="animate-spin" size={16} /> Loading…</span></Panel>;

  const options = [...data.tiers, { key: '', name: 'No plan', limits: null }];
  const current = data.tier || '';
  return (
    <Panel title="Plan" Icon={BadgeCheck}>
      <p className="text-sm text-cq-ink-2 mb-4 max-w-[62ch]">
        The plan this event is on. It sets the attendee cap, how many stations
        you can add, the texts included and which features are switched on.
      </p>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Plan">
        {options.map((t) => {
          const on = pick === t.key;
          const l = t.limits;
          return (
            <button key={t.key || 'none'} type="button" role="radio" aria-checked={on} onClick={() => setPick(t.key)}
              className={`text-left rounded-cq-md border-2 p-3 transition-colors ${on ? 'border-cq-caramel bg-cq-caramel-wash' : 'border-cq-line hover:border-cq-caramel'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-cq-roast">{t.name}</span>
                {current === t.key ? <span className="text-xs font-bold text-cq-caramel-deep">Current</span> : null}
              </div>
              {l ? (
                <div className="text-xs text-cq-ink-3 mt-1 leading-5">
                  {num(l.attendees, 'attendees')} · {num(l.stations, l.stations === 1 ? 'station' : 'stations')} · {num(l.sms, 'texts')}
                  <br />
                  {FEATURES.filter(([k]) => l[k]).map(([, n]) => n).join(', ') || 'Core ordering only'}
                </div>
              ) : <div className="text-xs text-cq-ink-3 mt-1">No limits (how CupQ has run until now)</div>}
            </button>
          );
        })}
      </div>
      <div className="mt-4">
        <Button size="sm" disabled={busy || pick === current} onClick={save}>Switch plan</Button>
      </div>
    </Panel>
  );
}
