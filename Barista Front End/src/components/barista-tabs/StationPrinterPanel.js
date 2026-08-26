import React, { useCallback, useEffect, useState } from 'react';
import { Printer, RefreshCw, RotateCw, XCircle } from 'lucide-react';

/**
 * This station's printer, on the barista's own screen.
 *
 * Steve: "wondering if the print queue for the appropriate station be
 * in the barista station so they can see if their printer is online,
 * queued, working etc". Until now that view only existed in Support —
 * so the person standing next to the printer was the one person who
 * couldn't see what it was doing, and a fault (paper retracted, cover
 * open) showed as labels quietly not arriving.
 *
 * Shows: online/offline, the decoded fault (the backend translates
 * Star's status bits into words), and this station's last few jobs
 * with retry/cancel. Polls only while mounted, i.e. while the barista
 * is actually looking at Settings.
 */

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
  'Content-Type': 'application/json',
});

const STATUS_STYLE = {
  done: 'bg-green-100 text-green-700',
  printed: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-800',
  printing: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

const StationPrinterPanel = ({ stationId, stationPrinter }) => {
  const [jobs, setJobs] = useState([]);
  const [busyJob, setBusyJob] = useState(null);
  const [refreshedAt, setRefreshedAt] = useState(null);

  const load = useCallback(async () => {
    if (!stationId) return;
    try {
      const r = await fetch(
        `/api/print/jobs?station_id=${stationId}&limit=8`,
        { headers: authHeaders() }
      );
      const b = r.ok ? await r.json() : {};
      setJobs(Array.isArray(b.jobs) ? b.jobs : []);
      setRefreshedAt(new Date());
    } catch (e) { /* poll again next tick */ }
  }, [stationId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (jobId, action) => {
    setBusyJob(jobId);
    try {
      await fetch(`/api/print/jobs/${jobId}/${action}`, {
        method: 'POST',
        headers: authHeaders(),
      });
      await load();
    } finally {
      setBusyJob(null);
    }
  };

  if (!stationPrinter) {
    return (
      <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
        <div className="flex items-center gap-2 font-semibold text-gray-700">
          <Printer size={18} /> Printer
        </div>
        <p className="mt-1">
          No printer is assigned to this station. Assign one in Support →
          Printers, and its status and queue will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 p-4 bg-white border border-gray-200 rounded-lg">
      <div className="flex items-center gap-2 flex-wrap">
        <Printer size={18} className="text-gray-700" />
        <span className="font-semibold text-gray-800">{stationPrinter.name}</span>
        <span
          className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
            stationPrinter.online
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${stationPrinter.online ? 'bg-green-500' : 'bg-red-500'}`} />
          {stationPrinter.online ? 'online' : 'offline'}
        </span>
        {stationPrinter.fault && (
          <span className="text-xs font-semibold bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded">
            {stationPrinter.fault}
          </span>
        )}
        <button
          onClick={load}
          className="ml-auto text-gray-400 hover:text-gray-700"
          title={refreshedAt ? `Updated ${refreshedAt.toLocaleTimeString()}` : 'Refresh'}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-gray-500 mt-3">No recent print jobs for this station.</p>
      ) : (
        <div className="mt-3 divide-y divide-gray-100">
          {jobs.map((j) => (
            <div key={j.id} className="py-1.5 flex items-center gap-2 text-sm">
              <span className="font-mono text-gray-500 w-14">
                {j.order_id ? `#${j.order_id}` : j.type}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                  STATUS_STYLE[j.status] || 'bg-gray-100 text-gray-600'
                }`}
              >
                {j.status}
              </span>
              {j.attempts > 1 && (
                <span className="text-xs text-gray-400">×{j.attempts}</span>
              )}
              {j.error && (
                <span className="text-xs text-red-600 truncate max-w-[10rem]" title={j.error}>
                  {j.error}
                </span>
              )}
              <span className="ml-auto flex items-center gap-1">
                {j.status === 'failed' && (
                  <button
                    onClick={() => act(j.id, 'retry')}
                    disabled={busyJob === j.id}
                    className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                    title="Retry this job"
                  >
                    <RotateCw size={14} />
                  </button>
                )}
                {(j.status === 'pending' || j.status === 'failed') && (
                  <button
                    onClick={() => act(j.id, 'cancel')}
                    disabled={busyJob === j.id}
                    className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                    title="Cancel this job"
                  >
                    <XCircle size={14} />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StationPrinterPanel;
