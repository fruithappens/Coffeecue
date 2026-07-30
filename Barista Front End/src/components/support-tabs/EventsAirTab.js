// EventsAirTab.js — Support panel for the EA Survey Order Channel (BETA).
//
// Honest by design: the panel always renders, and when the backend flag
// (EA_SURVEY_CHANNEL_ENABLED) is off it says so plainly instead of
// pretending. Status, attendee-mirror sync, the last 10 webhook log rows,
// and a rehearsal test-order button (no phone by default → zero SMS risk).
import React, { useState, useEffect, useCallback } from 'react';
import { CalendarClock, RefreshCw, Send } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import { showToast } from '../shared/Toast';

const api = new ApiServiceClass();

const STATUS_TONES = {
  processed: 'bg-green-100 text-green-700',
  received: 'bg-blue-100 text-blue-700',
  processing: 'bg-blue-100 text-blue-700',
  duplicate: 'bg-gray-200 text-gray-600',
  ignored: 'bg-gray-100 text-gray-500',
  failed: 'bg-red-100 text-red-700',
};

const Row = ({ label, children }) => (
  <div className="flex justify-between py-1 text-sm border-b last:border-0">
    <span className="text-gray-500">{label}</span>
    <span className="font-medium text-right">{children}</span>
  </div>
);

const EventsAirTab = () => {
  const [status, setStatus] = useState(null);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.request('/ea/status');
      setStatus(s || null);
    } catch (e) {
      setStatus({ success: false, error: e?.message });
    }
    try {
      const l = await api.request('/ea/webhook-log');
      setLog(Array.isArray(l?.rows) ? l.rows : []);
    } catch (e) {
      setLog([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const enabled = !!status?.channel_enabled;
  const today = status?.today || {};

  return (
    <div className="p-4 space-y-6 max-w-4xl">
      <div className="bg-white rounded-lg shadow-md p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold flex items-center">
            <CalendarClock size={20} className="mr-2" /> EventsAir Survey Channel
            <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded uppercase">Beta</span>
          </h2>
          <button className="text-gray-500 hover:text-gray-700 flex items-center text-sm"
                  onClick={refresh}>
            <RefreshCw size={16} className="mr-1" /> Refresh
          </button>
        </div>

        {!status ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            {!enabled && (
              <div className="mb-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded p-3">
                Channel is <strong>disabled</strong> (set <code>EA_SURVEY_CHANNEL_ENABLED=true</code>{' '}
                on Railway to activate). Attendee app orders are off; SMS ordering is unaffected.
              </div>
            )}
            <Row label="EventsAir API">
              {status?.ea?.stub
                ? 'not configured (stub mode)'
                : (status?.ea?.token_ok ? 'connected' : (status?.ea?.detail || 'unknown'))}
            </Row>
            <Row label="Webhook subscription">
              {status?.subscription_id || '—'}
            </Row>
            <Row label="Signing secret">{status?.signing_secret_set ? 'set' : 'NOT SET'}</Row>
            <Row label="Coffee surveys">{(status?.survey_ids || []).join(', ') || '—'}</Row>
            <Row label="Question map">{status?.question_map_set ? 'configured' : 'not configured'}</Row>
            <Row label="Attendee mirror">
              {status?.mirror_count ?? 0} contacts
              {status?.mirror_synced_at ? ` (synced ${status.mirror_synced_at})` : ''}
            </Row>
            <Row label="Last webhook">{status?.last_webhook_at || 'never'}</Row>
            <Row label="Today">
              {['processed', 'failed', 'duplicate', 'ignored']
                .map(k => `${today[k] || 0} ${k}`).join(' · ')}
            </Row>
            {(today.failed || 0) > 0 && (
              <div className="mt-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded p-2">
                {today.failed} webhook{today.failed === 1 ? '' : 's'} failed processing today —
                details in the log below.
              </div>
            )}
            <div className="mt-3 flex space-x-2">
              <button
                className="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-300 disabled:opacity-40"
                disabled={!enabled || busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await api.request('/ea/sync-attendees', { method: 'POST' })
                    .catch(e => ({ success: false, message: e?.message }));
                  setBusy(false);
                  showToast(r?.success ? `Synced ${r.synced} attendees`
                    : `Sync failed: ${r?.message || 'unknown'}`,
                  r?.success ? 'success' : 'error');
                  refresh();
                }}
              >
                Sync attendees
              </button>
              <button
                className="bg-purple-600 text-white px-3 py-1.5 rounded text-sm hover:bg-purple-700 disabled:opacity-40 flex items-center"
                disabled={!enabled || busy}
                title="Runs the full worker path off a fixture — expect a queued order with the APP badge. No phone attached, so no SMS is sent."
                onClick={async () => {
                  setBusy(true);
                  const r = await api.request('/ea/test-order', { method: 'POST', body: JSON.stringify({}) })
                    .catch(e => ({ success: false, error: e?.message }));
                  setBusy(false);
                  showToast(r?.success
                    ? `Test order #${r.order_number} queued (check the barista screen)`
                    : `Test failed: ${r?.error || r?.status || 'unknown'}`,
                  r?.success ? 'success' : 'error');
                  refresh();
                }}
              >
                <Send size={14} className="mr-1" /> Inject test order
              </button>
            </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-md p-4">
        <h3 className="text-lg font-bold mb-2">Webhook log (last 10)</h3>
        {log.length === 0 ? (
          <p className="text-sm text-gray-500">No webhooks received yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-3">Received</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {log.map(r => (
                  <tr key={r.correlation_id} className="border-b last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{r.received_at}</td>
                    <td className="py-2 pr-3">{r.event_type || '—'}</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        STATUS_TONES[r.status] || 'bg-gray-100 text-gray-600'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 text-red-600 text-xs max-w-[20rem] truncate" title={r.error || ''}>
                      {r.error || ''}
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

export default EventsAirTab;
