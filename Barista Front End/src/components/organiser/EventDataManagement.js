import React, { useEffect, useState } from 'react';
import { Download, Upload, Trash2, ShieldAlert, Database, Palette, Users } from 'lucide-react';
import { Panel, SettingRow, Toggle, TextField } from '../../design';
import ApiServiceClass from '../../services/ApiService';
import SquareCard from '../support/SquareCard';
import PlanTierCard from './PlanTierCard';
import { askConfirm } from '../shared/ConfirmDialog';

const api = new ApiServiceClass();

// Event Data Lifecycle UI — export / wipe / re-import. Admin-only feature
// for multi-client operation: archive an event, clear customer data so the
// next client starts clean, and re-import a past event so returning
// attendees' "usuals" come back (e.g. treenet 2026 → 2027).

// Browser caches survive a wipe unless something clears them, and this
// screen never did. The server emptied, the operator reloaded, and the
// old stations came straight back out of localStorage — Steve saw three
// stations plus "East Wing" reappear after wiping an event.
//
// Deliberately a KEEP-list rather than a list of things to clear. An
// explicit clear-list is the same shape as the placeholder blacklist
// that had drifted out of date elsewhere in this app: every new cache
// key someone adds is one more thing to forget. Inverting it means a new
// event-scoped key is cleared automatically, and only genuinely
// device-scoped things need naming here.
//
// What must survive: the operator's session (clearing it logs them out
// mid-wipe), and which app mode this device is in.
const KEEP_AFTER_WIPE = [
  /token/i,          // coffee_system_token, refreshToken, jwt_token, ...
  /^auth/i,
  /auth_token$/i,
  /^coffee_system_user$/,
  /^coffee_cue_app_mode$/,
];

const clearEventCaches = () => {
  const cleared = [];
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (KEEP_AFTER_WIPE.some((re) => re.test(key))) continue;
      localStorage.removeItem(key);
      cleared.push(key);
    }
  } catch (e) {
    // Storage disabled or full — the wipe itself already succeeded, so
    // report rather than fail.
    console.warn('Could not clear local caches after wipe:', e);
  }
  try {
    sessionStorage.clear();
  } catch (e) { /* same */ }
  return cleared;
};

const EventDataManagement = () => {
  const [busy, setBusy] = useState('');          // 'export' | 'wipe' | 'import'
  const [result, setResult] = useState(null);     // {ok, msg}
  const [wipeText, setWipeText] = useState('');
  const [eraseText, setEraseText] = useState('');
  // Automatic erase N days after ordering (L6-2). null = not loaded yet.
  const [retentionDays, setRetentionDays] = useState(null);
  const [retentionLast, setRetentionLast] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await api.request('/event-data/retention', { method: 'GET' });
        if (r?.success) { setRetentionDays(String(r.days ?? 0)); setRetentionLast(r.last_run || null); }
      } catch (e) { setRetentionDays('0'); }
    })();
  }, []);
  const saveRetention = async () => {
    const days = parseInt(retentionDays, 10);
    if (!Number.isFinite(days) || days < 0 || days > 3650) { say(false, 'Days must be 0 to 3650.'); return; }
    setBusy('retention'); setResult(null);
    try {
      const r = await api.request('/event-data/retention', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days }),
      });
      if (!r?.success) throw new Error(r?.message || 'Not saved');
      setRetentionDays(String(r.days)); setRetentionLast(r.last_run || null);
      say(true, days ? `Attendee details will be erased ${days} day${days === 1 ? '' : 's'} after each order, checked daily.` : 'Automatic erase is off.');
    } catch (e) { say(false, `Not saved: ${e?.message || e}`); }
    finally { setBusy(''); }
  };
  const [clearStaff, setClearStaff] = useState(false);
  const [resetBranding, setResetBranding] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [includeConfig, setIncludeConfig] = useState(false);

  const say = (ok, msg) => setResult({ ok, msg });

  // --- Export: pull the snapshot and trigger a browser download.
  const handleExport = async () => {
    setBusy('export'); setResult(null);
    try {
      const resp = await api.request('/event-data/export', { method: 'GET' });
      const snapshot = resp && (resp.snapshot || resp);
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (snapshot.event_name || 'event').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `coffeecue_${safeName}_${stamp}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      const c = snapshot.counts || {};
      say(true, `Exported ${c.customer_preferences || 0} customers and ${c.orders || 0} orders. File downloaded.`);
    } catch (e) {
      say(false, `Export failed: ${e?.message || e}`);
    } finally {
      setBusy('');
    }
  };

  // --- Wipe: requires typing WIPE; backend also enforces the token.
  const handleWipe = async () => {
    if (wipeText !== 'WIPE') return;
    if (!(await askConfirm({ title: 'Wipe this event’s data?', tone: 'bad', message: 'Permanently clears ALL customer and order data for this event. Stations and inventory config are kept.', confirmLabel: 'Wipe it', danger: true }))) return;
    setBusy('wipe'); setResult(null);
    try {
      const resp = await api.request('/event-data/wipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'WIPE', clear_staff: clearStaff, reset_branding: resetBranding }),
      });
      // Clear this device's copies too, then reload so every component
      // rehydrates from the now-empty server instead of from memory.
      const cleared = clearEventCaches();
      setWipeText('');
      say(true, `${resp?.message || `Wiped ${resp?.total_rows ?? '?'} rows.`} `
                + `Cleared ${cleared.length} cached item(s) on this device. `
                + `Reloading…`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      say(false, `Wipe failed: ${e?.message || e}`);
    } finally {
      setBusy('');
    }
  };

  // --- Retire: erase every attendee's details, keep the report's numbers.
  const handleErase = async () => {
    if (eraseText !== 'ERASE') return;
    if (!(await askConfirm({ title: 'Erase attendee details?', tone: 'bad', message: 'Removes every name, phone number, email, note and text conversation, and the EventsAir attendee list. Orders stay as counts (drink, time, station) so the report still adds up. A backup is taken first.', confirmLabel: 'Erase them', danger: true }))) return;
    setBusy('erase'); setResult(null);
    try {
      const resp = await api.request('/event-data/erase-attendees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'ERASE' }),
      });
      if (resp?.success === false || resp?.status === 'error') throw new Error(resp?.message || 'Erase failed');
      const steps = resp?.data?.steps || [];
      const rows = steps.reduce((n, x) => n + (x.rows || 0), 0);
      const skipped = steps.filter(x => x.skipped).map(x => x.what);
      setEraseText('');
      say(!skipped.length, `Attendee details erased (${rows} rows changed).`
        + (skipped.length ? ` Not done: ${skipped.join(', ')}.` : ''));
    } catch (e) {
      say(false, `Erase failed: ${e?.message || e}`);
    } finally {
      setBusy('');
    }
  };

  // --- Import: read the chosen file, POST the snapshot.
  const handleImport = async () => {
    if (!importFile) return;
    setBusy('import'); setResult(null);
    try {
      const text = await importFile.text();
      let snapshot;
      try { snapshot = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
      if (snapshot.snapshot) snapshot = snapshot.snapshot;   // tolerate wrapped exports
      const resp = await api.request('/event-data/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot, include_config: includeConfig }),
      });
      say(true, resp?.message || `Imported ${resp?.customers_imported ?? 0} customers.`);
    } catch (e) {
      say(false, `Import failed: ${e?.message || e}`);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="cq max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <Database className="w-5 h-5 text-cq-caramel" />
        <h2 className="text-lg font-bold text-cq-roast">Event data</h2>
      </div>
      <p className="text-sm text-cq-ink-3 mb-5 max-w-[62ch]">
        Archive this event, hand the next client a clean system, and carry
        returning attendees' saved orders forward to next year.
      </p>

      <PlanTierCard />

      {result && (
        <div className={`mb-5 p-3 rounded-cq-md text-sm ${
          result.ok ? 'bg-cq-ready-wash text-cq-ready' : 'bg-cq-alert-wash text-cq-alert'}`}>
          {result.msg}
        </div>
      )}

      {/* Payments level 2 (services/payments.py): the event's own Square. */}
      <SquareCard />

      <Panel title="Export this event" Icon={Download}>
        <p className="text-sm text-cq-ink-3 mb-4 max-w-[60ch]">
          Everything — customers and their usual orders, all orders, SMS
          history and config — as one file. For your records.
        </p>
        <button
          type="button" onClick={handleExport} disabled={busy === 'export'}
          className="h-10 px-4 rounded-cq-md bg-cq-roast text-cq-cream font-semibold
                     hover:bg-cq-caramel-deep disabled:opacity-40"
        >
          {busy === 'export' ? 'Exporting…' : 'Export and download'}
        </button>
      </Panel>

      <Panel title="Bring back a past event" Icon={Upload}>
        <p className="text-sm text-cq-ink-3 mb-4 max-w-[60ch]">
          Load a file exported earlier — last year's, say. Returning customers'
          saved orders come back, so the line greets them with their usual. Old
          orders and messages are <strong>not</strong> loaded into the queue.
        </p>
        <input
          type="file" accept="application/json,.json"
          onChange={(e) => setImportFile(e.target.files?.[0] || null)}
          className="block text-sm text-cq-ink-2 mb-3
                     file:mr-3 file:h-10 file:px-4 file:rounded-cq-md file:border-0
                     file:bg-cq-wash file:text-cq-roast file:font-semibold
                     hover:file:bg-cq-caramel-wash file:cursor-pointer"
        />
        <SettingRow Icon={Palette} label="Also restore event settings"
                    hint="Branding, logo and pricing from the file">
          <Toggle on={includeConfig} onChange={setIncludeConfig} />
        </SettingRow>
        <button
          type="button" onClick={handleImport} disabled={busy === 'import' || !importFile}
          className="mt-4 h-10 px-4 rounded-cq-md bg-cq-roast text-cq-cream font-semibold
                     hover:bg-cq-caramel-deep disabled:opacity-40"
        >
          {busy === 'import' ? 'Importing…' : 'Import customers'}
        </button>
      </Panel>

      {/* Retiring an event (roadmap C3-8): keep the numbers, drop the people. */}
      <section className="bg-cq-wash rounded-cq-lg p-5 mb-5 border border-cq-line">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="w-4 h-4 text-cq-caramel-deep" />
          <h3 className="text-lg font-bold text-cq-roast">Retire this event</h3>
        </div>
        <ol className="text-sm text-cq-ink-2 mb-4 max-w-[62ch] list-decimal pl-5 space-y-1">
          <li>Download the event report (Report) and, if wanted, an export (above).</li>
          <li><strong>Erase attendee details:</strong> every name, phone number, email, note and text
            conversation, and the EventsAir attendee list. Orders stay as counts, so the report
            still adds up. Staff logins, menu and settings are kept.</li>
          <li>Ask Steve to park or delete this copy&apos;s server (automatic once the Railway token is in).</li>
        </ol>
        <div className="bg-cq-milk rounded-cq-md px-4 py-3 mb-4 max-w-[62ch]">
          <div className="text-sm font-semibold text-cq-roast mb-1">Or automatically</div>
          <div className="flex items-center gap-2 flex-wrap text-sm text-cq-ink-2">
            Erase attendee details
            <TextField width="w-20" value={retentionDays ?? ''} onChange={setRetentionDays} placeholder="0" className="font-mono" />
            days after they order (0 = never).
            <button type="button" onClick={saveRetention} disabled={busy === 'retention' || retentionDays === null}
              className="h-9 px-3 rounded-cq-md border border-cq-roast text-cq-roast font-semibold disabled:opacity-40">
              {busy === 'retention' ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className="text-xs text-cq-ink-3 mt-1">
            Checked once a day. Same rules as the button below: the people go, the counts stay.
            {retentionLast?.ran_at ? ` Last checked ${new Date(retentionLast.ran_at).toLocaleString()}.` : ''}
          </p>
        </div>
        <label className="block text-sm font-semibold text-cq-roast mb-2">Type ERASE to enable</label>
        <div className="flex items-center gap-3 flex-wrap">
          <TextField width="w-32" value={eraseText} onChange={setEraseText} placeholder="ERASE" className="font-mono" />
          <button type="button" onClick={handleErase}
            disabled={busy === 'erase' || eraseText !== 'ERASE'}
            className="h-10 px-4 rounded-cq-md bg-cq-roast text-white font-semibold hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-2">
            <Users className="w-4 h-4" />
            {busy === 'erase' ? 'Erasing…' : 'Erase attendee details'}
          </button>
        </div>
      </section>

      {/* The one place red is right: this deletes a client's data for good.
          Semantic colour, not decoration -- it stays. */}
      <section className="bg-cq-alert-wash rounded-cq-lg p-5 mb-5">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="w-4 h-4 text-cq-alert" />
          <h3 className="text-lg font-bold text-cq-alert">Wipe for the next client</h3>
        </div>
        <p className="text-sm text-cq-ink-2 mb-4 max-w-[60ch]">
          Permanently clears every customer, order and message so the next
          client cannot see this one's. <strong>Export first if you want a
          copy.</strong> Stations, inventory and logins are kept.
        </p>
        <div className="bg-cq-milk rounded-cq-md px-4 mb-4">
          <SettingRow Icon={Users} label="Also remove this event's staff logins"
                      hint="The master admin is kept, so you can still sign in">
            <Toggle on={clearStaff} onChange={setClearStaff} />
          </SettingRow>
          <SettingRow Icon={Palette} label="Also reset branding and pricing"
                      hint="So the next client does not see this one's">
            <Toggle on={resetBranding} onChange={setResetBranding} />
          </SettingRow>
        </div>
        <label className="block text-sm font-semibold text-cq-alert mb-2">
          Type WIPE to enable
        </label>
        <div className="flex items-center gap-3 flex-wrap">
          <TextField
            width="w-32" value={wipeText} onChange={setWipeText}
            placeholder="WIPE" className="font-mono"
          />
          <button
            type="button" onClick={handleWipe}
            disabled={busy === 'wipe' || wipeText !== 'WIPE'}
            className="h-10 px-4 rounded-cq-md bg-cq-alert text-white font-semibold
                       hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            {busy === 'wipe' ? 'Wiping…' : 'Wipe event data'}
          </button>
        </div>
      </section>
    </div>
  );
};

export default EventDataManagement;
