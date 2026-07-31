// PrintersTab.js — Support panel for the label-printer fleet (CloudPRNT).
//
// Onboarding is zero-touch on the printer side: a Star mC-Label3 pointed at
// /cloudprnt registers itself DISABLED on its first poll and appears here.
// The operator names it, assigns a station, and enables it. Jobs never
// print anywhere until that explicit step.
import React, { useState, useEffect, useCallback } from 'react';
import { Printer, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import printService from '../../services/PrintService';
import ApiServiceClass from '../../services/ApiService';
import { showToast } from '../shared/Toast';

const api = new ApiServiceClass();

const STATUS_TONES = {
  queued: 'bg-blue-100 text-blue-700',
  fetched: 'bg-amber-100 text-amber-700',
  printed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-200 text-gray-600',
};

// Label design card — see the label EXACTLY as it will print (same
// renderer, same pixels) and toggle what appears on it. Presentation
// options apply at render time, so even already-queued jobs pick up a
// change.
const LabelDesignCard = () => {
  const [settings, setSettings] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const r = await api.request('/print/label-settings');
      setSettings(r?.settings || {});
    } catch (e) { setSettings({}); }
  }, []);

  const [ticketPreviewUrl, setTicketPreviewUrl] = useState(null);

  const refreshPreview = useCallback(async () => {
    const token = localStorage.getItem('coffee_system_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const grab = async (url, setter) => {
      try {
        const r = await fetch(url, { headers });
        if (!r.ok) return;
        const blob = await r.blob();
        setter(old => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
      } catch (e) { /* preview stays stale */ }
    };
    grab('/api/print/preview?sample=1', setPreviewUrl);
    grab('/api/print/preview?sample=1&ticket=1', setTicketPreviewUrl);
  }, []);

  useEffect(() => { loadSettings(); refreshPreview(); }, [loadSettings, refreshPreview]);

  const save = async (patch) => {
    setBusy(true);
    const r = await api.request('/print/label-settings',
      { method: 'PUT', body: JSON.stringify(patch) })
      .catch(e => ({ success: false, message: e?.message }));
    setBusy(false);
    if (r?.success) {
      setSettings(s => ({ ...s, ...r.settings }));
      refreshPreview();
    } else {
      showToast(`Save failed: ${r?.message || 'unknown'}`, 'error');
    }
  };

  const toggle = (key, label, hint) => (
    <label className="flex items-center space-x-2 text-sm py-1">
      <input
        type="checkbox"
        disabled={busy || !settings}
        checked={!!settings?.[key]}
        onChange={(e) => save({ [key]: e.target.checked })}
      />
      <span>{label}</span>
      {hint && <span className="text-xs text-gray-400">{hint}</span>}
    </label>
  );

  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <h2 className="text-xl font-bold mb-1">Label design</h2>
      <p className="text-sm text-gray-500 mb-3">
        Exactly what the printer will produce (58mm wide; the label cuts at
        the image height). Order number, name and drink always print —
        baristas need them. The rest is yours:
      </p>
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1 min-w-[16rem]">
          {toggle('show_event_name', 'Event name',
            settings?.event_name_effective ? `("${settings.event_name_effective}")` : '')}
          {toggle('show_logo', 'Event logo',
            settings?.logo_available ? '(from Branding)' : '(no logo uploaded in Branding yet)')}
          {toggle('show_name', 'Customer name', '(off = number-only cups)')}
          {toggle('show_station_time', 'Station + time line')}
          <label className="flex items-center space-x-2 text-sm py-1">
            <span>Text alignment</span>
            <select
              className="border rounded px-2 py-1"
              disabled={busy || !settings}
              value={settings?.align || 'left'}
              onChange={(e) => save({ align: e.target.value })}
            >
              <option value="left">Left</option>
              <option value="center">Centred</option>
            </select>
          </label>
          <div className="text-sm text-gray-600 mt-2 mb-1">Divider lines</div>
          {toggle('rule_below_logo', 'Below logo')}
          {toggle('rule_below_number', 'Below order number')}
          {toggle('rule_below_drink', 'Below drink details')}
          {toggle('rule_above_station', 'Above station + time')}
          {toggle('rule_above_footer', 'Above instructions/footer')}
          {toggle('rule_between_footer_lines', 'Between instructions and footer')}
          <div className="text-sm text-gray-600 mt-2 mb-1">Customer ticket stubs</div>
          {toggle('ticket_on_walkup', 'Print a number ticket for walk-up & kiosk orders',
            '(the deli-counter slip, right preview)')}
          <label className="block text-sm mt-2">
            <span className="text-gray-600">Ordering instructions line</span>
            <input
              className="mt-1 w-full border rounded px-2 py-1.5"
              defaultValue={settings?.instructions_text || ''}
              placeholder="e.g. Order: SMS 0489 263 333 or the event app"
              disabled={busy || !settings}
              onBlur={(e) => {
                if ((settings?.instructions_text || '') !== e.target.value.trim()) {
                  save({ instructions_text: e.target.value.trim() });
                }
              }}
            />
          </label>
          <label className="block text-sm mt-2">
            <span className="text-gray-600">Footer line (website / sponsor)</span>
            <input
              className="mt-1 w-full border rounded px-2 py-1.5"
              defaultValue={settings?.footer_text || ''}
              placeholder="e.g. CoffeeCue - coffeecue.com  or  Wallfly - wallfly.com.au"
              disabled={busy || !settings}
              onBlur={(e) => {
                if ((settings?.footer_text || '') !== e.target.value.trim()) {
                  save({ footer_text: e.target.value.trim() });
                }
              }}
            />
          </label>
          <label className="block text-sm mt-2">
            <span className="text-gray-600">Event name override (blank = use the event's name)</span>
            <input
              className="mt-1 w-full border rounded px-2 py-1.5"
              defaultValue={settings?.event_name || ''}
              placeholder={settings?.event_name_effective || ''}
              disabled={busy || !settings}
              onBlur={(e) => {
                if ((settings?.event_name || '') !== e.target.value.trim()) {
                  save({ event_name: e.target.value.trim() });
                }
              }}
            />
          </label>
          <button
            className="mt-3 bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-300"
            onClick={refreshPreview}
          >
            Refresh preview
          </button>
        </div>
        <div className="flex-shrink-0 flex gap-4">
          <div className="text-center">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Cup label preview"
                className="border rounded shadow-sm mx-auto"
                style={{ width: '203px', imageRendering: 'pixelated' }}
              />
            ) : (
              <div className="w-[203px] h-48 border rounded flex items-center justify-center text-gray-400 text-sm">
                Loading preview…
              </div>
            )}
            <div className="text-xs text-gray-400 mt-1">cup label · 50% · 58mm</div>
          </div>
          {settings?.ticket_on_walkup && (
            <div className="text-center">
              {ticketPreviewUrl ? (
                <img
                  src={ticketPreviewUrl}
                  alt="Ticket stub preview"
                  className="border rounded shadow-sm mx-auto"
                  style={{ width: '203px', imageRendering: 'pixelated' }}
                />
              ) : (
                <div className="w-[203px] h-40 border rounded flex items-center justify-center text-gray-400 text-sm">
                  Loading…
                </div>
              )}
              <div className="text-xs text-gray-400 mt-1">customer ticket · 50%</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const PrintersTab = () => {
  const [printers, setPrinters] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nameDrafts, setNameDrafts] = useState({});

  const refresh = useCallback(async () => {
    const [printerList, jobList] = await Promise.all([
      printService.getPrinters(),
      printService.getJobs(),
    ]);
    setPrinters(printerList);
    setJobs(jobList);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.request('/stations');
        const list = r?.stations || r?.data || [];
        setStations(Array.isArray(list) ? list : []);
      } catch (e) {
        setStations([]);
      }
    })();
  }, []);

  const patchPrinter = async (printer, fields, successMsg) => {
    const r = await printService.updatePrinter(printer.id, fields);
    if (r?.success) {
      if (successMsg) showToast(successMsg, 'success');
      refresh();
    } else {
      showToast(`Update failed: ${r?.message || 'unknown'}`, 'error');
    }
  };

  const stationName = (id) => {
    const s = stations.find(st => String(st.id) === String(id));
    return s ? (s.name || `Station ${id}`) : (id ? `Station ${id}` : '—');
  };

  return (
    <div className="p-4 space-y-6">
      {/* What the labels look like + design options */}
      <LabelDesignCard />

      {/* Printer fleet */}
      <div className="bg-white rounded-lg shadow-md p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold flex items-center">
            <Printer size={20} className="mr-2" /> Label Printers
          </h2>
          <button
            className="text-gray-500 hover:text-gray-700 flex items-center text-sm"
            onClick={refresh}
            title="Refresh now (auto-refreshes every 10s)"
          >
            <RefreshCw size={16} className="mr-1" /> Refresh
          </button>
        </div>

        {loading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : printers.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No printers yet. Point the printer's CloudPRNT setting at{' '}
            <code className="bg-gray-100 px-1 rounded">{window.location.origin}/cloudprnt</code>{' '}
            and it will appear here on its first poll (within ~10 seconds).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">MAC</th>
                  <th className="py-2 pr-3">Station</th>
                  <th className="py-2 pr-3">Enabled</th>
                  <th className="py-2 pr-3">Last poll</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {printers.map(p => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        p.online ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {p.online ? 'online' : 'offline'}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        className="border rounded px-2 py-1 w-40"
                        value={nameDrafts[p.id] !== undefined ? nameDrafts[p.id] : (p.name || '')}
                        placeholder="e.g. Station 1 label printer"
                        onChange={(e) => setNameDrafts(d => ({ ...d, [p.id]: e.target.value }))}
                        onBlur={() => {
                          const draft = nameDrafts[p.id];
                          if (draft !== undefined && draft !== (p.name || '')) {
                            patchPrinter(p, { name: draft }, 'Printer renamed');
                          }
                        }}
                      />
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{p.mac_address || '—'}</td>
                    <td className="py-2 pr-3">
                      <select
                        className="border rounded px-2 py-1"
                        value={p.station_id ?? ''}
                        onChange={(e) => patchPrinter(
                          p,
                          { station_id: e.target.value ? parseInt(e.target.value, 10) : null },
                          'Station assigned'
                        )}
                      >
                        <option value="">Unassigned</option>
                        {stations.map(s => (
                          <option key={s.id} value={s.id}>{s.name || `Station ${s.id}`}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <label className="inline-flex items-center">
                        <input
                          type="checkbox"
                          checked={!!p.enabled}
                          onChange={(e) => patchPrinter(
                            p,
                            { enabled: e.target.checked },
                            e.target.checked ? 'Printer enabled' : 'Printer disabled'
                          )}
                        />
                      </label>
                    </td>
                    <td className="py-2 pr-3 text-gray-500">
                      {p.seconds_since_poll == null ? 'never' : `${p.seconds_since_poll}s ago`}
                    </td>
                    <td className="py-2">
                      <button
                        className="bg-gray-200 text-gray-700 px-2 py-1 rounded text-xs hover:bg-gray-300 disabled:opacity-40"
                        disabled={!p.enabled}
                        title={p.enabled
                          ? 'Queue a calibration test label'
                          : 'Enable the printer first'}
                        onClick={async () => {
                          const r = await printService.testPrint(p.id);
                          showToast(r?.success ? 'Test label queued' : `Test failed: ${r?.message || 'unknown'}`,
                            r?.success ? 'success' : 'error');
                          refresh();
                        }}
                      >
                        Test print
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Job queue */}
      <div className="bg-white rounded-lg shadow-md p-4">
        <h2 className="text-xl font-bold mb-3">Print Queue (last 20)</h2>
        {jobs.length === 0 ? (
          <p className="text-gray-500 text-sm">No print jobs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2 pr-3">Order</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Printer</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Attempts</th>
                  <th className="py-2 pr-3">Error</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => (
                  <tr key={j.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">
                      {j.created_at ? new Date(j.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="py-2 pr-3">{j.order_id ? `#${j.order_id}` : '—'}</td>
                    <td className="py-2 pr-3">{j.type}</td>
                    <td className="py-2 pr-3">{j.printer_name || stationName(j.station_id)}</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        STATUS_TONES[j.status] || 'bg-gray-100 text-gray-600'}`}>
                        {j.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{j.attempts}</td>
                    <td className="py-2 pr-3 text-red-600 text-xs max-w-[16rem] truncate" title={j.error || ''}>
                      {j.error || ''}
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      {(j.status === 'failed' || j.status === 'cancelled') && (
                        <button
                          className="text-blue-600 hover:text-blue-800 mr-2 inline-flex items-center text-xs"
                          title="Put this job back on the queue"
                          onClick={async () => {
                            const r = await printService.retryJob(j.id);
                            showToast(r?.success ? 'Job requeued' : `Retry failed: ${r?.message || 'unknown'}`,
                              r?.success ? 'success' : 'error');
                            refresh();
                          }}
                        >
                          <RotateCcw size={13} className="mr-0.5" /> Retry
                        </button>
                      )}
                      {j.status === 'queued' && (
                        <button
                          className="text-red-600 hover:text-red-800 inline-flex items-center text-xs"
                          title="Cancel before the printer takes it"
                          onClick={async () => {
                            const r = await printService.cancelJob(j.id);
                            showToast(r?.success ? 'Job cancelled' : `Cancel failed: ${r?.message || 'unknown'}`,
                              r?.success ? 'success' : 'error');
                            refresh();
                          }}
                        >
                          <XCircle size={13} className="mr-0.5" /> Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default PrintersTab;
