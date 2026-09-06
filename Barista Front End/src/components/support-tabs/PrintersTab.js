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
  // Which station's jobs to show. Steve: "currently a big list and you
  // dont knwo if you see a error which station is belongs to unless you
  // can nut out which printer name and or order number and that a bit
  // slow." Filtering SERVER-side so "last 20" means the last 20 for that
  // station -- filtering the same 20 rows in the browser would just show
  // fewer of them, which is the opposite of what you want when one
  // station is busy and the other is the one with the fault.
  const [jobStation, setJobStation] = useState('');

  const refresh = useCallback(async () => {
    const [printerList, jobList] = await Promise.all([
      printService.getPrinters(),
      printService.getJobs(jobStation ? { stationId: jobStation } : {}),
    ]);
    setPrinters(printerList);
    setJobs(jobList);
    setLoading(false);
  }, [jobStation]);

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
      {/* Label DESIGN (logo, what prints, auto-print mode, footer) moved to
          Organiser -> Branding -> Labels so every sticker decision lives
          with the rest of the branding. This tab is the hardware: which
          printers exist, their connection, roll width, offset, and the
          queue. */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
        Label design — logo, what prints on the sticker, auto-print — is in{' '}
        <a href="/organiser#branding/labels" className="font-semibold underline">Organiser → Branding → Labels</a>.
        This page is the printers themselves: connection, roll width, offset and the print queue.
      </div>

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
                  <th className="py-2 pr-3">Width</th>
                  <th className="py-2 pr-3">Offset</th>
                  <th className="py-2 pr-3">Driver</th>
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
                      {p.poll_interval_s != null && (
                        <div className={`mt-1 text-xs ${p.poll_slow ? 'text-red-700 font-semibold' : 'text-gray-500'}`}
                             title="Measured from the polls this server receives">
                          polls every {p.poll_interval_s}s{p.poll_slow ? ' — set CloudPRNT polling to 5 s on the printer' : ''}
                        </div>
                      )}
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
                      {/* Printable dots across the roll — drives labels,
                          tickets AND banner height. 203dpi ≈ 8 dots/mm:
                          40mm stock ≈ 320, 58mm ≈ 406 (50.8mm printable),
                          80mm ≈ 640. Check the printer's spec sheet for
                          its exact printable width. */}
                      <select
                        className="border rounded px-1 py-1 text-xs"
                        value={String(p.width_dots || 406)}
                        onChange={(e) => patchPrinter(
                          p, { width_dots: parseInt(e.target.value, 10) },
                          'Roll width saved')}
                      >
                        <option value="320">40mm (320)</option>
                        <option value="406">58mm (406)</option>
                        <option value="576">72mm (576)</option>
                        <option value="640">80mm (640)</option>
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      {/* LEFT OFFSET, per printer.
                          Every printer needs its own. An 80mm head
                          printing onto 58mm stock held right-aligned by
                          the guide rail misses the leftmost dots
                          entirely: the TSP100IV needs 142, the mC-Label3
                          needed 58, and a third machine will need
                          something else again. It is a property of that
                          printer with that stock in that rail, not a
                          setting anyone can guess.
                          Applied at DELIVERY by padding blank on the
                          left, so the label design stays one canvas and
                          the on-screen preview keeps matching. */}
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          max="640"
                          step="2"
                          className="border rounded px-1 py-1 text-xs w-16"
                          defaultValue={p.offset_dots ?? 0}
                          title="Blank dots padded on the left so the print lands on the label"
                          onBlur={(e) => {
                            const next = Math.max(0, Math.min(640,
                              parseInt(e.target.value, 10) || 0));
                            if (next !== (p.offset_dots ?? 0)) {
                              patchPrinter(p, { offset_dots: next },
                                next === 0 ? 'Offset cleared' : `Offset set to ${next} dots`);
                            }
                          }}
                        />
                        {(p.offset_dots ?? 0) !== 0 && (
                          <button
                            className="text-[10px] text-blue-700 underline"
                            title="Back to no offset — use this after setting the paper width on the printer itself"
                            onClick={() => patchPrinter(p, { offset_dots: 0 }, 'Offset cleared')}
                          >
                            zero
                          </button>
                        )}
                      </div>
                      <button
                        className="text-[10px] text-blue-700 underline mt-0.5"
                        disabled={!p.enabled}
                        title="Prints a ruler. Read the number sitting at the left edge of the label — that is your offset."
                        onClick={async () => {
                          const r = await printService.testPrint(p.id);
                          showToast(r?.success
                            ? 'Ruler sent — read the number at the LEFT EDGE of the label and type it in'
                            : `Test failed: ${r?.message || 'unknown'}`,
                          r?.success ? 'success' : 'error', 9000);
                        }}
                      >
                        calibrate
                      </button>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        left offset (dots)
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      {/* Per-printer driver. The distinction that actually
                          matters operationally is WHO POLLS WHOM: with
                          CloudPRNT the printer calls us and needs nothing
                          else running; every other option needs the local
                          print agent alive or jobs just sit in 'queued'.
                          That confusion cost real debugging time when the
                          mC-Label3 arrived on USB, so the labels say it. */}
                      <select
                        className="border rounded px-1 py-1 text-xs"
                        value={p.driver || 'cloudprnt'}
                        onChange={(e) => patchPrinter(p, { driver: e.target.value },
                          'Driver saved')}
                      >
                        <option value="cloudprnt">CloudPRNT — printer polls us (no agent)</option>
                        <option value="cups_agent">USB / OS printer — via agent</option>
                        <option value="starprnt_lan">Star raster TCP 9100 — via agent</option>
                        <option value="escpos_lan">ESC/POS TCP 9100 — via agent (Epson)</option>
                      </select>
                      {p.driver && p.driver !== 'cloudprnt' && (
                        <div className="text-[10px] text-amber-700 mt-0.5">
                          needs print agent running
                        </div>
                      )}
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        describes the connection; doesn't change it
                      </div>
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
                          // "Queued" is not "printed". If nothing is polling
                          // for this printer the job will sit there, so say so
                          // instead of showing a green tick — a stopped agent
                          // once read as a broken printer for an hour.
                          if (r?.warning) {
                            showToast(r.warning, 'warning', 9000);
                          } else {
                            showToast(r?.success ? 'Test label queued'
                              : `Test failed: ${r?.message || 'unknown'}`,
                              r?.success ? 'success' : 'error');
                          }
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
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-xl font-bold">
            Print Queue (last 20{jobStation ? ` — ${stationName(jobStation)}` : ''})
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">Station</span>
            <select
              value={jobStation}
              onChange={(e) => setJobStation(e.target.value)}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">All stations</option>
              {stations.map(st => (
                <option key={st.id} value={st.id}>{st.name || `Station ${st.id}`}</option>
              ))}
            </select>
          </label>
        </div>

        {/* WHY NOTHING IS PRINTING, at the top of the thing you are
            staring at. Steve had two jobs sitting at "queued / 0
            attempts / no error" while the printer reported "Out of
            paper" on every poll for an hour. From the server's side
            nothing HAD gone wrong -- it offered the job every second and
            the printer never came for it -- so the queue had nothing to
            report. The answer was in the printer's own status all
            along. */}
        {printers.filter(p => p.enabled && p.fault).map(p => (
          <div key={p.id}
               className="mb-3 rounded-md border-l-4 border-red-500 bg-red-50 px-3 py-2">
            <div className="font-semibold text-red-800">
              {p.name || `Printer ${p.id}`}: {p.fault}
            </div>
            <div className="text-sm text-red-700">
              It is still asking for work every few seconds, so jobs will print
              as soon as this is cleared — nothing needs re-sending.
            </div>
          </div>
        ))}
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
                  <th className="py-2 pr-3">Station</th>
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
                    <td className="py-2 pr-3 whitespace-nowrap font-medium">
                      {stationName(j.station_id)}
                    </td>
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
