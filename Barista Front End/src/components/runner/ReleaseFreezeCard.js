// ReleaseFreezeCard.js — Runner > Settings: freeze updates during the event (S1-4).
//
// While frozen, CupQ's automatic checks refuse every change, so nothing new
// goes live mid-event. It also freezes by itself whenever orders have been
// placed or changed in the last 30 minutes.
import React, { useCallback, useEffect, useState } from 'react';
import { Snowflake } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';

const api = new ApiServiceClass();

const ReleaseFreezeCard = () => {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api.get('/settings/release-freeze')); } catch (e) { setData(null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!data || data.success === false) return null;

  const set = async (on) => {
    setBusy(true);
    try { await api.put('/settings/release-freeze', { on }); await load(); } finally { setBusy(false); }
  };
  const frozen = data.state && data.state.frozen;
  return (
    <div className="cq bg-cq-milk rounded-cq-lg shadow-cq-card p-5 mb-4 flex items-start gap-3">
      <Snowflake size={26} className={frozen ? 'text-blue-600' : 'text-cq-ink-3'} />
      <div className="flex-1 min-w-0">
        <h3 className="text-lg font-extrabold text-cq-roast">
          Updates {frozen ? 'are frozen' : 'can go out'}
        </h3>
        <p className="text-sm text-cq-ink-2 mt-0.5">
          {data.state && data.state.reason} While frozen, no new version of CupQ goes live.
          It also freezes by itself while orders are coming in.
        </p>
        <button type="button" disabled={busy} onClick={() => set(!data.on)}
          className="mt-3 h-10 px-4 rounded-cq-md bg-cq-roast text-cq-cream font-bold disabled:opacity-50">
          {data.on ? 'Unfreeze' : 'Freeze updates for the event'}
        </button>
        {data.on && data.by && <span className="ml-3 text-xs text-cq-ink-3">Frozen by {data.by}</span>}
      </div>
    </div>
  );
};

export default ReleaseFreezeCard;
