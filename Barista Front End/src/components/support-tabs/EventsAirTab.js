// EventsAirTab.js — Support panel for the EA Survey Order Channel (BETA).
//
// Honest by design: the panel always renders, and when the backend flag
// (EA_SURVEY_CHANNEL_ENABLED) is off it says so plainly instead of
// pretending. Status, attendee-mirror sync, the last 10 webhook log rows,
// and a rehearsal test-order button (no phone by default → zero SMS risk).
import React, { useState, useEffect, useCallback } from 'react';
import { CalendarClock, RefreshCw, Send, Copy } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import { showToast } from '../shared/Toast';
import { fetchEventAccess } from '../../utils/eventGate';

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

// Ready-to-paste embed for EventsAir. An EA page's HTML/Source-Code box
// takes this iframe snippet to embed the coffee ordering page inside the
// attendee app (Steve). The src uses THIS deployment's own origin, so it's
// always the correct live URL — no hand-editing a hard-coded domain.
const EmbedCard = () => {
  const origin = (typeof window !== 'undefined' && window.location.origin) || 'https://cupq.app';
  // If an event code is set, bake it into the src (?e=<code>) so the embedded
  // page skips the code gate — an EA attendee already got into the app with a
  // code, so asking again inside is pointless friction (Steve). Re-copy the
  // snippet if you change the event code.
  const [code, setCode] = useState('');
  useEffect(() => { fetchEventAccess().then((a) => setCode(a.code || '')).catch(() => setCode('')); }, []);
  const src = code ? `${origin}/my?e=${code}` : `${origin}/my`;
  const embed = `<div style="position: relative; width: 100%; height: 100vh; min-height: 640px; margin: 0; padding: 0; overflow: hidden;"><iframe style="display: block; width: 100%; height: 100vh; min-height: 640px; border: none; margin: 0; padding: 0;" src="${src}" width="auto" height="auto" allowfullscreen="allowfullscreen"></iframe></div>`;
  const copy = () => {
    try {
      navigator.clipboard.writeText(embed).then(
        () => showToast('Embed code copied', 'success'),
        () => showToast('Copy failed — select the text and copy manually', 'error'));
    } catch (e) {
      showToast('Copy failed — select the text and copy manually', 'error');
    }
  };
  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <h3 className="text-lg font-bold mb-2">Embed code for EventsAir</h3>
      <p className="text-sm text-gray-500 mb-2">
        Embed the coffee ordering page inside the EventsAir attendee app.
        {code
          ? ' The event code is included, so attendees already in the EA app aren’t asked for it again — re-copy this if you ever change the event code.'
          : ''}
      </p>
      <textarea
        readOnly
        value={embed}
        rows={4}
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.target.select()}
        className="w-full border rounded px-2 py-1.5 text-xs font-mono bg-gray-50 resize-none"
      />
      <button
        className="mt-2 inline-flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700"
        onClick={copy}
      >
        <Copy size={14} /> Copy embed code
      </button>
      <div className="mt-4 border-t pt-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Add it in EventsAir
        </p>
        <ol className="text-sm text-gray-600 list-decimal pl-5 space-y-1">
          <li>Open your EventsAir <strong>attendee app / portal</strong> and add or edit a <strong>page</strong> (a Static Content / HTML page).</li>
          <li>Insert an <strong>HTML</strong> element to open the HTML editor.</li>
          <li>In the editor, go to <strong>Tools → Source Code</strong>.</li>
          <li><strong>Paste</strong> the code above into the Source Code box, then click <strong>Update</strong>.</li>
          <li><strong>Save</strong> the page.</li>
          <li><strong>Test</strong> it in the app — the coffee ordering page should load straight in.</li>
        </ol>
      </div>
    </div>
  );
};

// Credentials card — writes to the EventsAir KV config (secrets are
// write-only: the GET returns *_set booleans, never values). This is
// what makes first API access self-serve: paste, save, test, inspect.
const CredentialsCard = ({ onChanged }) => {
  const [cfg, setCfg] = useState(null);
  const [draft, setDraft] = useState({ client_id: '', client_secret: '',
    tenant_endpoint: '', event_id: '' });
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await api.request('/integrations/eventsair/config');
      const c = r?.config || {};
      setCfg(c);
      setDraft(d => ({ ...d,
        client_id: c.client_id || '',
        tenant_endpoint: c.tenant_endpoint || '',
        event_id: c.event_id || '' }));
    } catch (e) { setCfg({}); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    const body = { ...draft, enabled: true };
    if (!body.client_secret) delete body.client_secret; // blank = keep stored
    const r = await api.request('/integrations/eventsair/config',
      { method: 'PUT', body: JSON.stringify(body) })
      .catch(e => ({ success: false, error: e?.message }));
    setBusy(false);
    showToast(r?.success ? 'EA credentials saved' : `Save failed: ${r?.error || 'unknown'}`,
      r?.success ? 'success' : 'error');
    load();
    if (onChanged) onChanged();
  };

  const testConnection = async () => {
    setBusy(true);
    const r = await api.request('/integrations/eventsair/status?probe=1')
      .catch(e => ({ success: false, error: e?.message }));
    setBusy(false);
    const h = r?.health || {};
    showToast(h.token_ok ? 'Connected — EA token OK'
      : (h.detail || r?.error || 'Connection test failed'),
    h.token_ok ? 'success' : 'error', 6000);
  };

  const inspectSchema = async () => {
    setBusy(true);
    setReport(null);
    const r = await api.request('/ea/introspect')
      .catch(e => ({ success: false, message: e?.message }));
    setBusy(false);
    if (r?.success) {
      setReport(r.report);
      showToast('Schema inspected — copy the report below and send it to Claude', 'success', 6000);
    } else {
      showToast(`Inspection failed: ${r?.message || 'unknown'}`, 'error', 6000);
    }
  };

  const field = (key, label, type = 'text', placeholder = '') => (
    <label className="block text-sm mb-2">
      <span className="text-gray-600">{label}</span>
      <input
        type={type}
        className="mt-1 w-full border rounded px-2 py-1.5"
        value={draft[key]}
        placeholder={placeholder}
        onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
      />
    </label>
  );

  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <h3 className="text-lg font-bold mb-2">EventsAir API credentials</h3>
      <p className="text-sm text-gray-500 mb-3">
        Paste the API key details from EventsAir here, Save, then Test
        connection. Once connected, Inspect schema produces the report that
        finalises the integration queries.
      </p>
      {field('client_id', 'Client ID')}
      {field('client_secret', 'Client secret' + (cfg?.client_secret_set ? ' (already set — leave blank to keep)' : ''), 'password')}
      {field('tenant_endpoint', 'Tenant GraphQL endpoint', 'text', 'https://…eventsair…/graphql')}
      {field('event_id', 'EA event ID')}
      <div className="flex space-x-2 mt-3">
        <button className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-40"
                disabled={busy} onClick={save}>Save</button>
        <button className="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-300 disabled:opacity-40"
                disabled={busy} onClick={testConnection}>Test connection</button>
        <button className="bg-purple-600 text-white px-3 py-1.5 rounded text-sm hover:bg-purple-700 disabled:opacity-40"
                disabled={busy} onClick={inspectSchema}>Inspect schema</button>
      </div>
      {report && (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Schema report</h4>
            <button
              className="text-sm text-blue-600 underline"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(report, null, 2))
                  .then(() => showToast('Report copied to clipboard', 'success'));
              }}
            >
              Copy report
            </button>
          </div>
          <ul className="mt-1 text-sm list-disc ml-5">
            {(report.findings || []).map((f, i) => <li key={i}>{f}</li>)}
          </ul>
          <pre className="mt-2 bg-gray-50 border rounded p-2 text-xs overflow-x-auto max-h-64 overflow-y-auto">
            {JSON.stringify(report, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

const EventsAirTab = () => {
  const [status, setStatus] = useState(null);
  // Separate from the EA credentials: creds persist between events, but
  // whether the mirror holds THIS event's people only the operator knows.
  const [badgeLookup, setBadgeLookup] = useState(null);
  const [badgeBusy, setBadgeBusy] = useState(false);
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

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/ea/attendee-lookup');
        setBadgeLookup(!!r?.enabled);
      } catch (e) { setBadgeLookup(false); }
    })();
  }, []);

  const setBadge = async (val) => {
    setBadgeBusy(true);
    try {
      await api.post('/ea/attendee-lookup', { enabled: val });
      setBadgeLookup(val);
    } catch (e) {
      // Leave the switch where it was rather than showing a state the
      // server did not accept.
    } finally { setBadgeBusy(false); }
  };

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

            {/* The mirror is ONE table shared across events — it holds
                whoever was synced last. If this event does not use
                EventsAir, those contacts belong to a different client, and
                badge "101" will match one of them: their name on screen,
                their phone attached to the order, their handset getting
                the "coffee is ready" text. Hence a switch the operator
                sets per event, defaulting to off. */}
            <div className="mt-3 rounded border border-gray-200 p-3">
              <label className="flex items-start gap-3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={!!badgeLookup}
                  disabled={badgeBusy || badgeLookup === null}
                  onChange={(e) => setBadge(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-gray-800">
                    Let attendees identify by badge number
                  </span>
                  <span className="block text-gray-600 mt-0.5">
                    Only turn this on when the {status?.mirror_count ?? 0} contacts
                    above are <strong>this event&apos;s</strong> attendees. While it
                    is off, the ordering page asks for a mobile number instead and
                    never mentions badges.
                  </span>
                  {badgeLookup && (status?.mirror_count ?? 0) === 0 && (
                    <span className="block mt-1 text-amber-700">
                      The mirror is empty — nobody will be found.
                    </span>
                  )}
                </span>
              </label>
            </div>
            <Row label="Order write-back to EA">
              {status?.writeback_enabled
                ? (status?.custom_field_created ? 'on (field created)' : 'on (field pending first order)')
                : 'off'}
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

      <CredentialsCard onChanged={refresh} />

      <EmbedCard />

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
