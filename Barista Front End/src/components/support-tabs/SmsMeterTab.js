// SmsMeterTab -- how many texts this event has used, against its cap.
//
// Steve's buyers fear an open-ended text bill. The answer (22 Sep): each
// plan includes texts, the organiser can set a hard cap, and this meter
// shows where they stand. As the cap nears, "we've started your coffee"
// texts stop first; at the cap every automatic text stops and customers
// fall back to the board and their phone page. Texts a person chose to
// send, and replies inside a text order, are counted but never stopped.
//
// Counting is server-side (services/sms_meter.py), in billed segments.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Gauge, Loader, AlertTriangle, RotateCcw, Save } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import { Panel, DataTable, TableRow, Cell, Empty, TextField, Button } from '../../design';
import { askConfirm } from '../shared/ConfirmDialog';
import { showToast } from '../shared/Toast';

const TIER_NAMES = { lite: 'Skim', standard: 'Flat White', pro: 'Double Shot', urn: 'The Urn' };
const STOPS = {
  warn: 'Stops first (at 90%)',
  cap: 'Stops at the cap',
  never: 'Never stopped',
};
const fmt = (n) => (n == null ? '' : Number(n).toLocaleString());
const when = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch (e) { return ''; }
};

function Bar({ used, cap, warnAt }) {
  const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
  const colour = !cap ? 'bg-cq-caramel'
    : used >= cap ? 'bg-cq-alert'
    : used >= cap * warnAt ? 'bg-cq-warn'
    : 'bg-cq-ready';
  return (
    <div className="relative h-4 rounded-full bg-cq-wash overflow-hidden" role="meter"
         aria-valuemin={0} aria-valuemax={cap || 0} aria-valuenow={used}>
      <div className={`h-full ${colour} transition-all`} style={{ width: `${pct}%` }} />
      {cap ? (
        <div className="absolute top-0 bottom-0 w-0.5 bg-cq-roast opacity-40"
             style={{ left: `${warnAt * 100}%` }} title="Started texts stop here" />
      ) : null}
    </div>
  );
}

export default function SmsMeterTab() {
  const apiRef = useRef(null);
  if (!apiRef.current) apiRef.current = new ApiServiceClass();

  const [m, setM] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [capDraft, setCapDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const take = (resp) => {
    const data = resp && (resp.data || null);
    if (data && typeof data.used === 'number') {
      setM(data);
      setCapDraft(data.cap_is_custom && data.cap != null ? String(data.cap) : '');
      return true;
    }
    return false;
  };

  const load = useCallback(async () => {
    setError('');
    try {
      const resp = await apiRef.current.get('/sms/meter');
      if (!take(resp)) setError((resp && resp.message) || 'Could not read the text meter.');
    } catch (err) {
      setError(err?.message || 'Could not read the text meter.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const saveCap = async (value) => {
    setBusy(true);
    try {
      const resp = await apiRef.current.put('/sms/meter/cap', { cap: value === '' ? null : value });
      if (take(resp)) showToast(value === '' ? 'Following the plan allowance' : 'Cap saved', 'success');
      else showToast((resp && resp.message) || 'Could not save the cap', 'error');
    } catch (err) {
      showToast(err?.message || 'Could not save the cap', 'error');
    } finally {
      setBusy(false);
    }
  };

  const newCount = async () => {
    if (!(await askConfirm({
      title: 'Start a new count?',
      message: 'The meter goes back to zero for the next event. Nothing is deleted - every text sent so far stays on record.',
      confirmLabel: 'Start from zero',
    }))) return;
    setBusy(true);
    try {
      const resp = await apiRef.current.post('/sms/meter/new-count', {});
      if (take(resp)) showToast('Counting from zero', 'success');
      else showToast((resp && resp.message) || 'Could not start a new count', 'error');
    } catch (err) {
      showToast(err?.message || 'Could not start a new count', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="cq max-w-3xl">
        <Empty><span className="inline-flex items-center gap-2"><Loader className="animate-spin" size={16} /> Loading…</span></Empty>
      </div>
    );
  }
  if (error || !m) {
    return (
      <div className="cq max-w-3xl">
        <div className="bg-cq-alert-wash rounded-cq-md p-3 text-sm text-cq-alert flex items-center gap-2">
          <AlertTriangle size={16} /> {error || 'Could not read the text meter.'}
          <button type="button" onClick={load} className="ml-auto underline font-semibold">Try again</button>
        </div>
      </div>
    );
  }

  const { used, cap, allowance, state, totals } = m;
  const tierName = TIER_NAMES[m.plan_tier] || null;
  const headline = {
    uncapped: 'No cap set - texts are counted but never stopped.',
    ok: `${fmt(m.remaining)} texts left before the cap.`,
    warn: `Past ${Math.round(m.warn_at * 100)}% - "we've started your coffee" texts and reminders have stopped. Ready texts still go.`,
    capped: 'Cap reached - automatic texts have stopped. Customers see their order on the board and their phone page.',
  }[state];
  const headlineTone = state === 'capped' ? 'bg-cq-alert-wash text-cq-alert'
    : state === 'warn' ? 'bg-cq-warn-wash text-cq-ink'
    : 'bg-cq-caramel-wash text-cq-ink-2';

  return (
    <div className="cq max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <Gauge className="text-cq-caramel" size={22} />
        <h2 className="text-lg font-bold text-cq-roast">Text meter</h2>
      </div>
      <p className="text-sm text-cq-ink-3 mb-4 max-w-[62ch]">
        Every text this event has sent, counted the way the phone company bills
        it. {m.since ? <>Counting since <b>{when(m.since)}</b>.</> : null}
      </p>

      <Panel>
        <div className="flex items-baseline gap-2 mb-3 flex-wrap">
          <span className="text-4xl font-extrabold text-cq-roast tabular-nums">{fmt(used)}</span>
          <span className="text-cq-ink-3">{cap != null ? <>of <b className="text-cq-ink-2">{fmt(cap)}</b> texts</> : 'texts sent'}</span>
          {m.testing_mode ? <span className="ml-auto text-xs font-semibold text-cq-ink-3">TEST MODE - nothing really sent</span> : null}
        </div>
        <Bar used={used} cap={cap} warnAt={m.warn_at} />
        <div className={`rounded-cq-md p-3 mt-3 text-sm ${headlineTone}`}>{headline}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
          <div><div className="text-cq-ink-3">Messages</div><div className="font-bold text-cq-roast tabular-nums">{fmt(totals.texts)}</div></div>
          <div><div className="text-cq-ink-3">Held by the cap</div><div className="font-bold text-cq-roast tabular-nums">{fmt(totals.held)}</div></div>
          <div><div className="text-cq-ink-3">Failed to send</div><div className="font-bold text-cq-roast tabular-nums">{fmt(totals.failed)}</div></div>
          <div><div className="text-cq-ink-3">Last text</div><div className="font-bold text-cq-roast">{m.last_at ? when(m.last_at) : '-'}</div></div>
        </div>
        {totals.not_plain > 0 ? (
          <p className="text-xs text-cq-ink-3 mt-3">
            {fmt(totals.not_plain)} message{totals.not_plain === 1 ? '' : 's'} used an emoji or special
            character, which makes a text cost double. Keep wording plain.
          </p>
        ) : null}
      </Panel>

      <Panel title="Cap">
        <p className="text-sm text-cq-ink-2 mb-3 max-w-[62ch]">
          {allowance != null
            ? <>The {tierName || 'current'} plan includes <b>{fmt(allowance)}</b> texts. </>
            : <>No plan allowance is set. </>}
          Set your own cap to stop sooner, or to allow more (extra texts are
          billed at 15c each). Leave it blank to {allowance != null ? 'use the plan allowance' : 'have no cap'}.
        </p>
        <div className="flex gap-2 items-center flex-wrap">
          <TextField
            type="number"
            width="w-40"
            value={capDraft}
            onChange={setCapDraft}
            placeholder={allowance != null ? fmt(allowance) : 'No cap'}
            disabled={busy}
            min={0}
          />
          <Button size="sm" Icon={Save} disabled={busy} onClick={() => saveCap(capDraft.trim())}>Save cap</Button>
          {m.cap_is_custom ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => saveCap('')}>
              {allowance != null ? 'Use the plan allowance' : 'Remove cap'}
            </Button>
          ) : null}
        </div>
        {cap != null && allowance != null && cap > allowance ? (
          <p className="text-sm text-cq-ink-3 mt-2">
            {fmt(cap - allowance)} texts above the plan - up to ${((cap - allowance) * 0.15).toFixed(2)} extra if they are all used.
          </p>
        ) : null}
      </Panel>

      <Panel title="What the texts were">
        {m.by_kind.length === 0 ? (
          <Empty>No texts yet.</Empty>
        ) : (
          <DataTable head={['Kind', 'When the cap nears', 'Texts', 'Held']} align={[null, null, 'right', 'right']}>
            {m.by_kind.map((k) => (
              <TableRow key={k.kind}>
                <Cell strong>{k.label}</Cell>
                <Cell dim>{STOPS[k.stops] || ''}</Cell>
                <Cell right className="tabular-nums">{fmt(k.segments)}</Cell>
                <Cell right className="tabular-nums">{k.held ? fmt(k.held) : ''}</Cell>
              </TableRow>
            ))}
          </DataTable>
        )}
      </Panel>

      <div className="flex items-center gap-3">
        <Button size="sm" variant="secondary" Icon={RotateCcw} disabled={busy} onClick={newCount}>
          Start a new count
        </Button>
        <span className="text-xs text-cq-ink-3">For the next event on this system. Deletes nothing.</span>
      </div>
    </div>
  );
}
