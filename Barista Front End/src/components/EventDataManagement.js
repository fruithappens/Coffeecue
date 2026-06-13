import React, { useState } from 'react';
import { Download, Upload, Trash2, ShieldAlert, Database } from 'lucide-react';
import ApiServiceClass from '../services/ApiService';

const api = new ApiServiceClass();

// Event Data Lifecycle UI — export / wipe / re-import. Admin-only feature
// for multi-client operation: archive an event, clear customer data so the
// next client starts clean, and re-import a past event so returning
// attendees' "usuals" come back (e.g. treenet 2026 → 2027).
const EventDataManagement = () => {
  const [busy, setBusy] = useState('');          // 'export' | 'wipe' | 'import'
  const [result, setResult] = useState(null);     // {ok, msg}
  const [wipeText, setWipeText] = useState('');
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
    if (!window.confirm('This permanently clears ALL customer and order data for this event. Stations and inventory config are kept. Continue?')) return;
    setBusy('wipe'); setResult(null);
    try {
      const resp = await api.request('/event-data/wipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'WIPE', clear_staff: clearStaff, reset_branding: resetBranding }),
      });
      say(true, resp?.message || `Wiped ${resp?.total_rows ?? '?'} rows.`);
      setWipeText('');
    } catch (e) {
      say(false, `Wipe failed: ${e?.message || e}`);
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
    <div className="bg-white rounded-lg shadow p-6 max-w-3xl">
      <h2 className="text-xl font-bold flex items-center mb-1">
        <Database className="w-5 h-5 mr-2" /> Event Data
      </h2>
      <p className="text-gray-600 text-sm mb-6">
        Archive this event, hand the next client a clean system, and carry
        returning attendees' saved orders forward to next year.
      </p>

      {result && (
        <div className={`mb-6 p-3 rounded-lg text-sm border ${
          result.ok ? 'bg-green-50 border-green-300 text-green-800'
                     : 'bg-red-50 border-red-300 text-red-800'}`}>
          {result.msg}
        </div>
      )}

      {/* EXPORT */}
      <section className="border border-gray-200 rounded-lg p-4 mb-4">
        <h3 className="font-semibold flex items-center mb-1">
          <Download className="w-4 h-4 mr-2 text-blue-600" /> Export event
        </h3>
        <p className="text-sm text-gray-600 mb-3">
          Download everything — customers and their usual orders, all orders,
          SMS history, and config — as one JSON file. For your records and analysis.
        </p>
        <button
          onClick={handleExport}
          disabled={busy === 'export'}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === 'export' ? 'Exporting…' : 'Export & download'}
        </button>
      </section>

      {/* IMPORT */}
      <section className="border border-gray-200 rounded-lg p-4 mb-4">
        <h3 className="font-semibold flex items-center mb-1">
          <Upload className="w-4 h-4 mr-2 text-green-600" /> Re-import a past event
        </h3>
        <p className="text-sm text-gray-600 mb-3">
          Load a file exported earlier (e.g. last year's). Returning customers'
          saved orders come back so the bot greets them with their usual. Old
          orders and messages are <strong>not</strong> loaded into the live queue.
        </p>
        <input
          type="file" accept="application/json,.json"
          onChange={(e) => setImportFile(e.target.files?.[0] || null)}
          className="block text-sm mb-2"
        />
        <label className="flex items-center text-sm text-gray-600 mb-3">
          <input type="checkbox" className="mr-2"
            checked={includeConfig} onChange={(e) => setIncludeConfig(e.target.checked)} />
          Also restore event settings (branding, etc.) from the file
        </label>
        <button
          onClick={handleImport}
          disabled={busy === 'import' || !importFile}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {busy === 'import' ? 'Importing…' : 'Import customers'}
        </button>
      </section>

      {/* WIPE */}
      <section className="border-2 border-red-200 rounded-lg p-4 bg-red-50">
        <h3 className="font-semibold flex items-center mb-1 text-red-800">
          <ShieldAlert className="w-4 h-4 mr-2" /> Wipe for next client
        </h3>
        <p className="text-sm text-red-700 mb-3">
          Permanently clears all customer data, orders and SMS history so the
          next client can't see this one's. <strong>Export first if you want a
          copy.</strong> Stations, inventory config and logins are kept.
        </p>
        <label className="flex items-center text-sm text-red-800 mb-2 cursor-pointer">
          <input type="checkbox" className="mr-2"
            checked={clearStaff} onChange={(e) => setClearStaff(e.target.checked)} />
          Also remove this event's staff logins (keeps the master admin so you can still sign in)
        </label>
        <label className="flex items-center text-sm text-red-800 mb-3 cursor-pointer">
          <input type="checkbox" className="mr-2"
            checked={resetBranding} onChange={(e) => setResetBranding(e.target.checked)} />
          Also reset event branding, logo &amp; pricing to default (so the next client doesn't see this one's)
        </label>
        <label className="block text-sm text-red-800 mb-1">Type <strong>WIPE</strong> to enable:</label>
        <div className="flex items-center gap-3">
          <input
            type="text" value={wipeText}
            onChange={(e) => setWipeText(e.target.value)}
            placeholder="WIPE"
            className="px-3 py-2 border border-red-300 rounded font-mono w-32"
          />
          <button
            onClick={handleWipe}
            disabled={busy === 'wipe' || wipeText !== 'WIPE'}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 flex items-center"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {busy === 'wipe' ? 'Wiping…' : 'Wipe event data'}
          </button>
        </div>
      </section>
    </div>
  );
};

export default EventDataManagement;
