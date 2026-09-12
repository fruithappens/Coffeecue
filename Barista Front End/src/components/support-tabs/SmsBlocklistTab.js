// SmsBlocklistTab — manage SMS abuse protection.
//
// Backs the abuse-protection API added server-side: lists blocked numbers,
// lets an operator block a new one, and unblock existing ones. Blocking just
// stops the bot replying to that number (protects Twilio credit); it's fully
// reversible and deletes nothing. The automatic burst-throttle (a flood is
// auto-paused for ~10 min + a barista alert) is separate and needs no action.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Ban, RotateCcw, ShieldCheck, Loader, AlertTriangle } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import { Panel, DataTable, TableRow, Cell, Empty, TextField } from '../../design';
import { askConfirm } from '../shared/ConfirmDialog';
import { showToast } from '../shared/Toast';

export default function SmsBlocklistTab() {
  const apiRef = useRef(null);
  if (!apiRef.current) apiRef.current = new ApiServiceClass();

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await apiRef.current.get('/sms/blocklist');
      const blocked = (resp && (resp.data?.blocked || resp.blocked)) || [];
      setList(Array.isArray(blocked) ? blocked : []);
    } catch (err) {
      setError(err?.message || 'Could not load the blocklist.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const block = async () => {
    const phone = newPhone.trim();
    if (!phone) return;
    setBusy(true);
    try {
      const resp = await apiRef.current.post('/sms/block', { phone, reason: 'Blocked from Support' });
      if (resp && (resp.success === true || resp.status === 'success')) {
        setNewPhone('');
        await load();
      } else {
        showToast((resp && resp.message) || 'Failed to block number', 'error');
      }
    } catch (err) {
      showToast(err?.message || 'Failed to block number', 'error');
    } finally {
      setBusy(false);
    }
  };

  const unblock = async (phone) => {
    if (!(await askConfirm({ title: `Unblock ${phone}?`, message: 'They will be able to order by SMS again.', confirmLabel: 'Unblock' }))) return;
    setBusy(true);
    try {
      const resp = await apiRef.current.post('/sms/unblock', { phone });
      if (resp && (resp.success === true || resp.status === 'success')) {
        await load();
      } else {
        showToast((resp && resp.message) || 'Failed to unblock number', 'error');
      }
    } catch (err) {
      showToast(err?.message || 'Failed to unblock number', 'error');
    } finally {
      setBusy(false);
    }
  };

  const fmtWhen = (iso) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(); } catch (e) { return ''; }
  };

  return (
    <div className="cq max-w-2xl">
      <div className="flex items-center gap-2 mb-1">
        <Ban className="text-cq-alert" size={22} />
        <h2 className="text-lg font-bold text-cq-roast">Blocked numbers</h2>
      </div>
      <p className="text-sm text-cq-ink-3 mb-4 max-w-[62ch]">
        A blocked number gets <b>no reply</b> from the ordering line, which
        protects your SMS credit from spam. Blocking is fully reversible and
        deletes nothing.
      </p>

      {/* Was a blue info box -- the only blue on the screen, and blue means
          nothing in this palette. It is reassurance, so it wears the brand. */}
      <div className="bg-cq-caramel-wash rounded-cq-md p-4 mb-5 text-sm text-cq-ink-2 flex gap-2.5">
        <ShieldCheck size={18} className="flex-shrink-0 mt-0.5 text-cq-caramel-deep" />
        <span>
          You usually will not need this. A number that floods the line is
          <b> paused automatically for about ten minutes</b> and flagged in the
          barista Messages inbox. Use this page to block one for good.
        </span>
      </div>

      <div className="flex gap-2 mb-5">
        <TextField
          type="tel"
          width="flex-1"
          value={newPhone}
          onChange={setNewPhone}
          onKeyDown={(e) => e.key === 'Enter' && block()}
          placeholder="Number to block, e.g. 0412 345 678"
          disabled={busy}
        />
        <button
          type="button"
          onClick={block}
          disabled={busy || !newPhone.trim()}
          className="h-10 px-4 rounded-cq-md bg-cq-alert text-white font-semibold text-sm
                     hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          <Ban size={16} /> Block
        </button>
      </div>

      {loading ? (
        <Empty>
          <span className="inline-flex items-center gap-2">
            <Loader className="animate-spin" size={16} /> Loading…
          </span>
        </Empty>
      ) : error ? (
        <div className="bg-cq-alert-wash rounded-cq-md p-3 text-sm text-cq-alert flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
          <button type="button" onClick={load} className="ml-auto underline font-semibold">
            Try again
          </button>
        </div>
      ) : list.length === 0 ? (
        <Panel>
          <Empty>Nobody is blocked.</Empty>
        </Panel>
      ) : (
        <Panel title={`${list.length} blocked`}>
          <DataTable head={['Number', 'Why, and when', '']} align={[null, null, 'right']}>
            {list.map((b) => (
              <TableRow key={b.phone}>
                <Cell strong className="font-mono whitespace-nowrap">{b.phone}</Cell>
                <Cell dim>
                  {[b.reason, b.by ? `by ${b.by}` : null, fmtWhen(b.at)]
                    .filter(Boolean).join(' · ')}
                </Cell>
                <Cell right>
                  <button
                    type="button"
                    onClick={() => unblock(b.phone)}
                    disabled={busy}
                    className="h-9 px-3 rounded-cq-md border border-cq-line text-sm font-semibold
                               text-cq-ink-2 hover:bg-cq-wash disabled:opacity-40
                               inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <RotateCcw size={14} /> Unblock
                  </button>
                </Cell>
              </TableRow>
            ))}
          </DataTable>
        </Panel>
      )}
    </div>
  );
}
