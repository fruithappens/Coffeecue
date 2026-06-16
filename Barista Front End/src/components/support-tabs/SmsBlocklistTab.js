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
        alert((resp && resp.message) || 'Failed to block number');
      }
    } catch (err) {
      alert(err?.message || 'Failed to block number');
    } finally {
      setBusy(false);
    }
  };

  const unblock = async (phone) => {
    if (!window.confirm(`Unblock ${phone}? They'll be able to order by SMS again.`)) return;
    setBusy(true);
    try {
      const resp = await apiRef.current.post('/sms/unblock', { phone });
      if (resp && (resp.success === true || resp.status === 'success')) {
        await load();
      } else {
        alert((resp && resp.message) || 'Failed to unblock number');
      }
    } catch (err) {
      alert(err?.message || 'Failed to unblock number');
    } finally {
      setBusy(false);
    }
  };

  const fmtWhen = (iso) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(); } catch (e) { return ''; }
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 mb-1">
        <Ban className="text-red-600" size={22} />
        <h2 className="text-xl font-bold text-gray-800">SMS Blocklist</h2>
      </div>
      <p className="text-sm text-gray-600 mb-4">
        Blocked numbers get <b>no reply</b> from the ordering bot, which protects your
        SMS credit from spam. Blocking is <b>fully reversible</b> — unblock anytime and
        the number can order again immediately. Nothing is deleted.
      </p>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-5 text-sm text-blue-800 flex gap-2">
        <ShieldCheck size={18} className="flex-shrink-0 mt-0.5" />
        <span>
          You usually won't need this: a number that floods the line is
          <b> automatically paused for ~10 minutes</b> and flagged in the barista
          Messages inbox. Use this page to permanently block (or unblock) a specific number.
        </span>
      </div>

      {/* Block a new number */}
      <div className="flex gap-2 mb-5">
        <input
          type="tel"
          value={newPhone}
          onChange={(e) => setNewPhone(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && block()}
          placeholder="Phone number to block (e.g. 0412 345 678)"
          className="flex-1 px-3 py-2 border rounded-lg text-sm"
          disabled={busy}
        />
        <button
          onClick={block}
          disabled={busy || !newPhone.trim()}
          className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1"
        >
          <Ban size={16} /> Block
        </button>
      </div>

      {/* Blocklist */}
      {loading ? (
        <div className="text-gray-500 py-8 text-center inline-flex items-center gap-2 justify-center w-full">
          <Loader className="animate-spin" size={18} /> Loading…
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
          <button onClick={load} className="ml-auto underline">Retry</button>
        </div>
      ) : list.length === 0 ? (
        <div className="text-center text-gray-500 py-10 border-2 border-dashed border-gray-200 rounded-lg">
          No numbers are blocked. 🎉
        </div>
      ) : (
        <ul className="divide-y border rounded-lg overflow-hidden">
          {list.map((b) => (
            <li key={b.phone} className="flex items-center gap-3 p-3 bg-white">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-800 font-mono">{b.phone}</div>
                <div className="text-xs text-gray-500 truncate">
                  {b.reason ? `${b.reason} · ` : ''}{b.by ? `by ${b.by} · ` : ''}{fmtWhen(b.at)}
                </div>
              </div>
              <button
                onClick={() => unblock(b.phone)}
                disabled={busy}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1 flex-shrink-0"
              >
                <RotateCcw size={14} /> Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
