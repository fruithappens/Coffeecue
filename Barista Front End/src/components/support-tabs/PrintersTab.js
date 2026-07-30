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
