// UnlockPinsPanel -- Runner > People: a PIN per person, and who unlocked what.
//
// The barista padlock and the display kiosk's admin panel used to take one
// shared event PIN, so nobody could tell who had unlocked a tablet. Now each
// person can have their own; every unlock (and every wrong guess) is logged
// with who, where and when. The shared event PIN still works unless it is
// switched off here, so a team that hasn't set personal PINs is unaffected.
//
// Server side: routes/pin_routes.py (manage) and utils/pins.py (check).
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { KeyRound, Loader, AlertTriangle, Trash2, Save, ShieldCheck } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import { Panel, DataTable, TableRow, Cell, Empty, TextField, Button, Toggle } from '../../design';
import { askConfirm } from '../shared/ConfirmDialog';
import { showToast } from '../shared/Toast';

const when = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch (e) { return ''; }
};
const SURFACE = { barista: 'Barista padlock', kiosk: 'Display kiosk' };
const ok = (r) => r && (r.success === true || r.status === 'success');

function PinField({ busy, onSave, placeholder = 'New PIN' }) {
  const [v, setV] = useState('');
  return (
    <span className="inline-flex gap-2 items-center">
      <TextField
        type="password" inputMode="numeric" autoComplete="new-password" width="w-28"
        value={v} onChange={(x) => setV(x.replace(/\D/g, '').slice(0, 8))}
        placeholder={placeholder} disabled={busy}
        onKeyDown={(e) => { if (e.key === 'Enter' && v.length >= 4) { onSave(v); setV(''); } }}
      />
      <Button size="sm" Icon={Save} disabled={busy || v.length < 4} onClick={() => { onSave(v); setV(''); }}>
        Save
      </Button>
    </span>
  );
}

export default function UnlockPinsPanel() {
  const apiRef = useRef(null);
  if (!apiRef.current) apiRef.current = new ApiServiceClass();

  const [data, setData] = useState(null);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [s, u] = await Promise.all([
        apiRef.current.get('/pins'),
        apiRef.current.get('/pins/unlocks?limit=30'),
      ]);
      if (ok(s)) setData(s.data); else setError((s && s.message) || 'Could not load PINs.');
      if (ok(u)) setLog(u.data.unlocks || []);
    } catch (e) {
      setError(e?.message || 'Could not load PINs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const call = async (fn, done) => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok(r)) { if (done) showToast(done, 'success'); await load(); }
      else showToast((r && r.message) || 'That did not save', 'error');
    } catch (e) {
      showToast(e?.message || 'That did not save', 'error');
    } finally {
      setBusy(false);
    }
  };

  const setPin = (p, pin) => call(() => apiRef.current.put(`/pins/users/${p.id}`, { pin }), `PIN saved for ${p.full_name || p.username}`);
  const clearPin = async (p) => {
    if (!(await askConfirm({ title: `Remove ${p.full_name || p.username}'s PIN?`, message: 'They will need the event PIN, or a new PIN, to unlock.', confirmLabel: 'Remove' }))) return;
    call(() => apiRef.current.delete(`/pins/users/${p.id}`), 'PIN removed');
  };
  const setEventPin = (pin) => call(() => apiRef.current.put('/pins/event', { pin }), 'Event PIN changed');
  const setEventEnabled = async (enabled) => {
    if (!enabled) {
      const withPin = (data?.people || []).filter((p) => p.has_pin && p.is_active).length;
      if (!(await askConfirm({
        title: 'Turn off the shared event PIN?',
        message: withPin
          ? `Only personal PINs will unlock the padlock and kiosk. ${withPin} ${withPin === 1 ? 'person has' : 'people have'} one.`
          : 'Nobody has a personal PIN yet, so nobody could unlock the padlock or kiosk. Set some PINs first.',
        confirmLabel: 'Turn it off',
      }))) return;
    }
    call(() => apiRef.current.put('/pins/event', { enabled }), enabled ? 'Event PIN turned on' : 'Event PIN turned off');
  };

  if (loading) {
    return <Panel title="Unlock PINs" Icon={KeyRound}><Empty><span className="inline-flex items-center gap-2"><Loader className="animate-spin" size={16} /> Loading…</span></Empty></Panel>;
  }
  if (error || !data) {
    return (
      <Panel title="Unlock PINs" Icon={KeyRound}>
        <div className="bg-cq-alert-wash rounded-cq-md p-3 text-sm text-cq-alert flex items-center gap-2">
          <AlertTriangle size={16} /> {error || 'Could not load PINs.'}
          <button type="button" onClick={load} className="ml-auto underline font-semibold">Try again</button>
        </div>
      </Panel>
    );
  }

  const ev = data.event_pin;
  return (
    <div className="cq">
      <Panel title="Unlock PINs" Icon={KeyRound}>
        <p className="text-sm text-cq-ink-2 mb-4 max-w-[70ch]">
          PINs open the <b>barista padlock</b> and the <b>display kiosk's admin panel</b>.
          Give each person their own and the log below shows who unlocked what. A PIN is
          4 to 8 digits and nobody else can use the same one.
        </p>

        <div className="rounded-cq-md bg-cq-caramel-wash p-3 mb-5 flex flex-wrap gap-3 items-center text-sm">
          <ShieldCheck size={18} className="text-cq-caramel-deep" />
          <b className="text-cq-roast">Shared event PIN</b>
          <span className="text-cq-ink-2">
            {ev.enabled ? (ev.is_default ? 'On - still the default 1234, change it' : 'On') : 'Off - only personal PINs work'}
          </span>
          <span className="ml-auto inline-flex gap-3 items-center flex-wrap">
            {ev.enabled ? <PinField busy={busy} onSave={setEventPin} placeholder="New event PIN" /> : null}
            <Toggle on={ev.enabled} onChange={setEventEnabled} />
          </span>
        </div>

        {data.people.length === 0 ? (
          <Empty>No people yet - add them above.</Empty>
        ) : (
          <DataTable head={['Person', 'PIN', 'Last unlocked', '']} align={[null, null, null, 'right']}>
            {data.people.map((p) => (
              <TableRow key={p.id}>
                <Cell strong>
                  {p.full_name || p.username}
                  <span className="block text-xs font-normal text-cq-ink-3">{p.role}{p.is_active ? '' : ' - inactive'}</span>
                </Cell>
                <Cell dim>{p.has_pin ? `Set ${when(p.pin_set_at)}` : 'None'}</Cell>
                <Cell dim>{p.last_unlock_at ? when(p.last_unlock_at) : '-'}</Cell>
                <Cell right>
                  <span className="inline-flex gap-2 items-center justify-end">
                    <PinField busy={busy} onSave={(pin) => setPin(p, pin)} placeholder={p.has_pin ? 'Change' : 'Set PIN'} />
                    {p.has_pin ? (
                      <button type="button" disabled={busy} onClick={() => clearPin(p)} title="Remove PIN"
                        className="h-9 w-9 inline-flex items-center justify-center rounded-cq-sm text-cq-ink-3 hover:text-cq-alert">
                        <Trash2 size={16} />
                      </button>
                    ) : null}
                  </span>
                </Cell>
              </TableRow>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title="Recent unlocks">
        {log.length === 0 ? (
          <Empty>Nobody has unlocked anything yet.</Empty>
        ) : (
          <DataTable head={['When', 'Who', 'Where']}>
            {log.map((u, i) => (
              <TableRow key={`${u.at}-${i}`}>
                <Cell dim>{when(u.at)}</Cell>
                <Cell strong={u.ok}>{u.ok ? u.who : <span className="text-cq-alert font-semibold">Wrong PIN</span>}</Cell>
                <Cell dim>{SURFACE[u.surface] || u.surface || '-'}</Cell>
              </TableRow>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
