// OpsBoard — the single event-day screen (Steve's brief).
//
// One page you leave open and glance at from across the room. It answers
// "should I worry right now?" and shows PROVEN-working, not just "online":
// every signal means "I saw this actually work N seconds ago". Everything
// diagnostic lives one click deeper in the full Support interface; this
// screen is operator-facing, not engineer-facing.
//
// All data is REAL and server-side, polled every 10s:
//   /api/reports/today          headline metrics (wait, completed, revenue)
//   /api/sms/health             the rich SMS proof (proven / unproven / rejecting)
//   /api/health/full            db / migrations / stations / catalog
//   /api/stations               per-station lanes
//   /api/orders                 order flow, throughput, stuck orders, feed
//   /api/client-errors          a NEW crash today (vs stale history)
//   /api/diagnostics/performance server cpu/mem (kept small, de-emphasised)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ApiServiceClass from '../../services/ApiService';

const api = new ApiServiceClass();

// --- small helpers ---------------------------------------------------------
const asArray = (v) => (Array.isArray(v) ? v : []);
const num = (v, d = 0) => (typeof v === 'number' && !Number.isNaN(v) ? v : d);
const parseTs = (v) => { const t = v ? Date.parse(v) : NaN; return Number.isNaN(t) ? null : t; };
const minsAgo = (ts, now) => (ts == null ? null : Math.max(0, Math.round((now - ts) / 60000)));
const fmtClock = (ts) => {
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return ''; }
};
const ageLabel = (m) => (m == null ? '' : m < 1 ? 'just now' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`);

// Status colour system (control-room traffic light).
const TONE = {
  green: { dot: '#22c55e', text: 'text-emerald-300', ring: 'ring-emerald-500/30', bg: 'bg-emerald-500/10', bar: 'bg-emerald-500' },
  amber: { dot: '#f59e0b', text: 'text-amber-300', ring: 'ring-amber-500/30', bg: 'bg-amber-500/10', bar: 'bg-amber-500' },
  red: { dot: '#ef4444', text: 'text-red-300', ring: 'ring-red-500/40', bg: 'bg-red-500/10', bar: 'bg-red-500' },
  idle: { dot: '#64748b', text: 'text-slate-400', ring: 'ring-slate-700', bg: 'bg-slate-800/40', bar: 'bg-slate-600' },
};
const worst = (levels) => (levels.includes('red') ? 'red' : levels.includes('amber') ? 'amber' : 'green');

export default function OpsBoard() {
  const [d, setD] = useState({ reports: null, sms: null, health: null, stations: null, orders: null, errors: null, perf: null });
  const [lastOkAt, setLastOkAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [bcOpen, setBcOpen] = useState(false);
  const [bcMsg, setBcMsg] = useState('');
  const prev = useRef({ wait: null, completed: null });

  // Live clock so ages and "updated Ns ago" advance on their own.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Poll everything in parallel; a failed source degrades to null, never
  // takes the page down. lastOkAt only moves on a REAL answer (no placebo).
  useEffect(() => {
    let dead = false;
    const pull = async () => {
      const [reports, sms, health, stations, orders, errors, perf] = await Promise.all([
        api.get('/reports/today').catch(() => null),
        api.get('/sms/health').catch(() => null),
        api.get('/health/full').catch(() => null),
        api.get('/stations').catch(() => null),
        api.get('/orders').catch(() => null),
        api.get('/client-errors').catch(() => null),
        api.get('/diagnostics/performance').catch(() => null),
      ]);
      if (dead) return;
      setD({ reports, sms, health, stations, orders, errors, perf });
      if (reports || stations || orders) setLastOkAt(Date.now());
      setLoading(false);
    };
    pull();
    const t = setInterval(pull, 10000);
    return () => { dead = true; clearInterval(t); };
  }, []);

  const refresh = () => { setBusy('refresh'); setNote(''); setTimeout(() => setBusy(''), 400); window.dispatchEvent(new Event('opsboard:refresh')); };

  const emergencyStop = async () => {
    if (!window.confirm('Pause ALL active orders across every station? Use this if you need to halt the floor.')) return;
    setBusy('stop'); setNote('');
    try { const r = await api.post('/emergency/stop-all', {}); setNote(r?.message || 'All active orders paused.'); }
    catch (e) { setNote('Could not reach the server to pause orders.'); }
    finally { setBusy(''); }
  };

  const sendBroadcast = async () => {
    const text = bcMsg.trim();
    if (!text) return;
    setBusy('broadcast'); setNote('');
    try {
      const r = await api.post('/support/broadcast/customers', { message: text, audience: 'today' });
      setNote(r?.message || `Broadcast sent to today's customers.`);
      setBcMsg(''); setBcOpen(false);
    } catch (e) { setNote('Broadcast failed — try the full Support screen.'); }
    finally { setBusy(''); }
  };

  // ---- derive everything from the raw data --------------------------------
  const m = useMemo(() => {
    const rep = (d.reports && (d.reports.data || d.reports)) || {};
    const smsH = (d.sms && (d.sms.health || d.sms)) || {};
    const health = d.health || {};
    const checks = (health.checks || {});
    const stations = asArray(d.stations && (d.stations.stations || d.stations.data || d.stations));
    const orders = asArray(d.orders && (d.orders.data || d.orders.orders || d.orders));
    const errors = asArray(d.errors && (d.errors.errors || d.errors.data || d.errors));
    const perf = d.perf || {};

    // order buckets
    const byStatus = { pending: 0, 'in-progress': 0, completed: 0, picked_up: 0, cancelled: 0 };
    orders.forEach((o) => { const s = o.status || ''; if (s in byStatus) byStatus[s] += 1; });

    // ready but not collected, with age of the oldest
    const readyList = orders
      .filter((o) => o.status === 'completed')
      .map((o) => ({ o, age: minsAgo(parseTs(o.completedAt || o.completed_at || o.updatedAt || o.updated_at), now) }))
      .sort((a, b) => (b.age || 0) - (a.age || 0));
    const readyOldest = readyList.length ? readyList[0].age : null;

    // stuck: brewing for too long
    const STUCK_MIN = 12;
    const stuck = orders.filter((o) => o.status === 'in-progress'
      && (minsAgo(parseTs(o.updatedAt || o.updated_at || o.createdAt || o.created_at), now) || 0) >= STUCK_MIN);

    // throughput: arrivals vs completions in the last 60 min (the leading gap)
    const HOUR = 60 * 60 * 1000;
    const inHr = orders.filter((o) => { const t = parseTs(o.createdAt || o.created_at); return t && now - t <= HOUR; }).length;
    const outHr = orders.filter((o) => { const t = parseTs(o.completedAt || o.completed_at); return t && now - t <= HOUR; }).length;

    // per-station lanes
    const lanes = stations.map((s) => {
      const sid = s.id;
      const mine = orders.filter((o) => String(o.stationId ?? o.station_id) === String(sid));
      const queue = mine.filter((o) => o.status === 'pending' || o.status === 'in-progress').length;
      const brewing = mine.filter((o) => o.status === 'in-progress').length;
      const lastDone = mine
        .filter((o) => o.status === 'completed' || o.status === 'picked_up')
        .map((o) => parseTs(o.completedAt || o.completed_at || o.updatedAt || o.updated_at))
        .filter(Boolean)
        .sort((a, b) => b - a)[0] || null;
      const active = (s.status || '').toLowerCase() === 'active';
      const barista = s.barista_name || s.baristaName || null;
      return {
        id: sid, name: s.name || `Station ${sid}`, location: s.location || s.equipment_notes || '',
        active, barista, wait: num(s.estimated_wait, null), load: num(s.current_load, queue),
        capacity: num(s.capacity, null), queue, brewing, lastDoneMin: minsAgo(lastDone, now),
      };
    });
    const stationsActive = lanes.filter((l) => l.active).length;

    // SMS proven state
    const smsStatus = String(smsH.status || 'unknown');
    const smsProven = smsStatus === 'ok' || smsStatus === 'proven' || smsStatus === 'healthy';
    const smsRejecting = num(smsH?.webhook?.rejected_since_boot, 0) > 0
      && num(smsH?.webhook?.rejected_since_boot, 0) >= num(smsH?.webhook?.hits_since_boot, 0);
    const smsFailed = num(smsH?.outbound?.failed_since_boot, 0);
    const smsSentMin = smsH?.outbound?.last_minutes_ago;

    // a NEW crash today (vs the stale history log)
    const todayStr = new Date(now).toISOString().slice(0, 10);
    const crashesToday = errors.filter((e) => String(e.occurred_at || '').slice(0, 10) === todayStr).length;

    // headline numbers
    const wait = num(rep.avg_wait_min, null);
    const completed = num((rep.status_breakdown || {}).completed, byStatus.completed);
    const totalToday = num(rep.total_orders, orders.length);

    // trends (vs previous poll)
    let waitTrend = 0;
    if (prev.current == null) prev.current = {};
    if (wait != null && prev.current.wait != null) waitTrend = wait - prev.current.wait;
    prev.current = { wait, completed };

    // ---- warnings (leading indicators) ----
    const warns = [];
    if (!stations.length) warns.push({ level: 'amber', t: 'No station data — check the backend' });
    if (stations.length && stationsActive === 0) warns.push({ level: 'red', t: 'No stations are active — nobody can be routed an order' });
    lanes.forEach((l) => {
      if (l.active && !l.barista) warns.push({ level: 'amber', t: `${l.name}: no barista signed in` });
      if (l.active && l.queue >= 1 && l.brewing === 0 && (l.lastDoneMin == null || l.lastDoneMin >= 6))
        warns.push({ level: 'amber', t: `${l.name}: ${l.queue} waiting but nothing brewing` });
      if (!l.active) warns.push({ level: 'amber', t: `${l.name} is offline` });
    });
    if (wait != null && wait >= 15) warns.push({ level: 'amber', t: `Wait is ${Math.round(wait)} min and climbing` });
    if (inHr - outHr >= 4) warns.push({ level: 'amber', t: `Orders arriving faster than they're made (${inHr} in / ${outHr} out per hr)` });
    stuck.forEach((o) => warns.push({ level: 'amber', t: `#${o.orderNumber || o.order_number} stuck brewing ${STUCK_MIN}+ min` }));
    if (readyOldest != null && readyOldest >= 8) warns.push({ level: 'amber', t: `${readyList.length} ready & uncollected (oldest ${ageLabel(readyOldest)}) — going cold` });
    const checkDb = (checks.database?.status || checks.database);
    if (checkDb && checkDb !== 'ok') warns.push({ level: 'red', t: 'Database check failing' });
    if (checks.migrations && (checks.migrations.status || checks.migrations) !== 'ok') warns.push({ level: 'amber', t: 'Schema migrations not applied' });
    if (smsH && smsH.testing_mode) warns.push({ level: 'amber', t: 'SMS is in TEST mode — texts are NOT really sent' });
    else if (smsRejecting) warns.push({ level: 'red', t: 'Twilio is reaching us but every webhook is being refused' });
    else if (smsFailed > 0) warns.push({ level: 'amber', t: `${smsFailed} outbound text(s) failed since boot` });
    else if (smsH && !smsProven) warns.push({ level: 'amber', t: 'SMS unproven — no text has been sent/received since restart. Send one to prove it.' });
    if (crashesToday > 0) warns.push({ level: 'red', t: `${crashesToday} app crash(es) logged TODAY — investigate` });

    // ---- composite status ----
    const level = warns.length ? worst(warns.map((w) => w.level)) : 'green';
    const headline = level === 'green' ? 'ALL SYSTEMS GO'
      : level === 'amber' ? 'NEEDS ATTENTION' : 'PROBLEM — LOOK NOW';

    // ---- activity feed (proof of life) ----
    const feed = orders
      .map((o) => ({ o, t: parseTs(o.updatedAt || o.updated_at || o.createdAt || o.created_at) }))
      .filter((x) => x.t)
      .sort((a, b) => b.t - a.t)
      .slice(0, 14);

    return {
      wait, waitTrend, completed, totalToday, byStatus, readyCount: readyList.length, readyOldest,
      inHr, outHr, lanes, stationsActive, smsH, smsStatus, smsProven, smsSentMin, smsRejecting,
      warns, level, headline, feed, perf, crashesToday,
    };
  }, [d, now]);

  const okAge = lastOkAt ? Math.round((now - lastOkAt) / 1000) : null;
  const t = TONE[m.level] || TONE.idle;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-3 md:p-5"
         style={{ fontVariantNumeric: 'tabular-nums' }}>
      {/* ---- composite status banner ---- */}
      <div className={`rounded-2xl ring-1 ${t.ring} ${t.bg} px-5 py-4 mb-4 flex flex-wrap items-center gap-x-6 gap-y-2`}>
        <span className="relative flex h-4 w-4">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ backgroundColor: t.dot }} />
          <span className="relative inline-flex rounded-full h-4 w-4" style={{ backgroundColor: t.dot }} />
        </span>
        <div className="min-w-0">
          <div className={`text-2xl md:text-3xl font-extrabold tracking-tight ${t.text}`}>{m.headline}</div>
          <div className="text-slate-400 text-sm truncate">
            {m.warns.length ? m.warns[0].t : 'Everything proven working right now.'}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4 text-right">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-500">Live</div>
            <div className="text-sm text-slate-300">
              {okAge == null ? 'connecting…' : okAge <= 15 ? `updated ${okAge}s ago` :
                <span className="text-amber-400">stale — {okAge}s ago</span>}
            </div>
          </div>
          <div className="tabular-nums text-2xl font-bold text-slate-200">{fmtClock(now)}</div>
        </div>
      </div>

      {/* ---- headline KPIs ---- */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <Kpi label="Current wait" value={m.wait == null ? '—' : `${Math.round(m.wait)}m`}
             trend={m.waitTrend} trendGoodDown tone={m.wait >= 15 ? 'amber' : 'green'} />
        <Kpi label="Brewing now" value={m.byStatus['in-progress']} tone="idle" />
        <Kpi label="Waiting" value={m.byStatus.pending} tone={m.byStatus.pending > 6 ? 'amber' : 'idle'} />
        <Kpi label="Ready · uncollected" value={m.readyCount}
             sub={m.readyOldest != null ? `oldest ${ageLabel(m.readyOldest)}` : null}
             tone={m.readyOldest != null && m.readyOldest >= 8 ? 'amber' : 'idle'} />
        <Kpi label="Completed today" value={m.completed} tone="green" />
        <Kpi label="In / out per hr" value={`${m.inHr} / ${m.outHr}`}
             sub={m.inHr - m.outHr >= 4 ? 'arriving faster than made' : 'keeping up'}
             tone={m.inHr - m.outHr >= 4 ? 'amber' : 'green'} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* ---- station lanes ---- */}
        <div className="xl:col-span-2 space-y-3">
          <SectionTitle>Stations</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {m.lanes.length === 0 && <Empty>No station data.</Empty>}
            {m.lanes.map((l) => {
              const lt = TONE[!l.active ? 'red' : (!l.barista || l.wait >= 15) ? 'amber' : 'green'];
              return (
                <div key={l.id} className={`rounded-xl ring-1 ${lt.ring} bg-slate-900 p-4`}>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: lt.dot }} />
                    <div className="font-bold text-lg truncate">{l.name}</div>
                    <span className={`ml-auto text-xs font-semibold uppercase ${lt.text}`}>
                      {l.active ? 'Active' : 'Offline'}
                    </span>
                  </div>
                  {l.location && <div className="text-xs text-slate-500 mb-2">{l.location}</div>}
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <Stat k="Wait" v={l.wait == null ? '—' : `${l.wait}m`} />
                    <Stat k="Queue" v={l.queue} />
                    <Stat k="Brewing" v={l.brewing} />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className={l.barista ? 'text-slate-300' : 'text-amber-400 font-semibold'}>
                      {l.barista ? `👤 ${l.barista}` : '⚠ no barista signed in'}
                    </span>
                    <span className="text-slate-500">
                      {l.lastDoneMin == null ? 'no completions yet' : `last done ${ageLabel(l.lastDoneMin)} ago`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ---- early-warning strip ---- */}
          <SectionTitle>Watch list</SectionTitle>
          <div className="rounded-xl ring-1 ring-slate-800 bg-slate-900 p-3">
            {m.warns.length === 0 ? (
              <div className="text-emerald-300 text-sm py-2 px-1">✓ No warnings — all leading indicators clear.</div>
            ) : (
              <ul className="space-y-1.5">
                {m.warns.map((w, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: TONE[w.level].dot }} />
                    <span className="text-slate-200">{w.t}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ---- right column: SMS, feed, actions ---- */}
        <div className="space-y-4">
          {/* SMS proven tile */}
          <div>
            <SectionTitle>SMS · Twilio</SectionTitle>
            {(() => {
              const rejecting = m.smsRejecting;
              const testing = m.smsH?.testing_mode;
              const lvl = rejecting ? 'red' : (testing || !m.smsProven) ? 'amber' : 'green';
              const st = TONE[lvl];
              const label = testing ? 'TEST MODE — not really sending'
                : rejecting ? 'Twilio rejecting webhooks'
                  : m.smsProven ? 'Proven working' : 'Unproven — not yet demonstrated';
              return (
                <div className={`rounded-xl ring-1 ${st.ring} ${st.bg} p-4`}>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: st.dot }} />
                    <span className={`font-bold ${st.text}`}>{label}</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-400 space-y-0.5">
                    <div>From {m.smsH?.from_number || '—'}</div>
                    <div>Last sent: {m.smsSentMin == null ? 'never since restart' : `${ageLabel(m.smsSentMin)} ago`}</div>
                    <div>Sent / failed since boot: {num(m.smsH?.outbound?.sent_since_boot)} / {num(m.smsH?.outbound?.failed_since_boot)}</div>
                    {!m.smsProven && !testing && !rejecting &&
                      <div className="text-amber-400 pt-1">Send one real text to flip this to proven.</div>}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* activity feed */}
          <div>
            <SectionTitle>Live activity</SectionTitle>
            <div className="rounded-xl ring-1 ring-slate-800 bg-slate-900 p-2 max-h-72 overflow-y-auto">
              {m.feed.length === 0 ? <Empty>No recent activity.</Empty> : (
                <ul className="divide-y divide-slate-800/70">
                  {m.feed.map(({ o, t: ts }) => {
                    const s = o.status || '';
                    const dot = s === 'completed' ? '#22c55e' : s === 'in-progress' ? '#f59e0b'
                      : s === 'picked_up' ? '#38bdf8' : s === 'cancelled' ? '#ef4444' : '#64748b';
                    const label = s === 'in-progress' ? 'brewing' : s === 'picked_up' ? 'collected' : s || 'new';
                    return (
                      <li key={o.id || o.orderNumber || o.order_number} className="flex items-center gap-2 py-1.5 px-1 text-sm">
                        <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
                        <span className="font-semibold">#{o.orderNumber || o.order_number}</span>
                        <span className="text-slate-400 truncate">{o.customerName || o.customer_name || ''}</span>
                        <span className="text-slate-500">· {label}</span>
                        {o.channel && <span className="text-slate-600 text-xs">· {o.channel}</span>}
                        <span className="ml-auto text-slate-500 text-xs">{fmtClock(ts)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* actions */}
          <div>
            <SectionTitle>Actions</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={refresh} disabled={busy === 'refresh'}
                className="rounded-lg bg-slate-800 hover:bg-slate-700 py-3 font-semibold text-sm">
                ↻ Refresh
              </button>
              <button onClick={() => setBcOpen((v) => !v)}
                className="rounded-lg bg-sky-600 hover:bg-sky-500 py-3 font-semibold text-sm">
                📣 Broadcast
              </button>
              <button onClick={emergencyStop} disabled={busy === 'stop'}
                className="col-span-2 rounded-lg bg-red-600 hover:bg-red-500 py-3 font-bold text-sm">
                {busy === 'stop' ? 'Pausing…' : '⛔ Pause all orders (emergency)'}
              </button>
            </div>
            {bcOpen && (
              <div className="mt-2 rounded-lg bg-slate-900 ring-1 ring-slate-800 p-2">
                <textarea value={bcMsg} onChange={(e) => setBcMsg(e.target.value.slice(0, 300))}
                  rows={2} placeholder="Message to today's customers (plain text — SMS cost applies)"
                  className="w-full bg-slate-950 rounded px-2 py-1.5 text-sm text-slate-100 outline-none ring-1 ring-slate-800" />
                <div className="flex items-center gap-2 mt-1">
                  <button onClick={sendBroadcast} disabled={!bcMsg.trim() || busy === 'broadcast'}
                    className="rounded bg-sky-600 hover:bg-sky-500 px-3 py-1.5 text-sm font-semibold disabled:opacity-40">
                    {busy === 'broadcast' ? 'Sending…' : 'Send to today'}
                  </button>
                  <span className="text-xs text-slate-500">{bcMsg.length}/300</span>
                </div>
              </div>
            )}
            {note && <div className="mt-2 text-sm text-emerald-300">{note}</div>}
          </div>

          {/* server footer — deliberately small */}
          <div className="text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t border-slate-800/70">
            <span>server cpu {m.perf?.cpuUsage != null ? `${Math.round(m.perf.cpuUsage)}%` : '—'}</span>
            <span>mem {m.perf?.memoryUsage != null ? `${Math.round(m.perf.memoryUsage)}%` : '—'}</span>
            <span>api {m.perf?.apiResponseTime != null ? `${m.perf.apiResponseTime}ms` : '—'}</span>
            <span>db {m.perf?.dbQueryTime != null ? `${m.perf.dbQueryTime}ms` : '—'}</span>
            <a href="/support" className="ml-auto text-sky-400 hover:underline">Full Support →</a>
          </div>
        </div>
      </div>

      {loading && <div className="fixed inset-0 flex items-center justify-center bg-slate-950/80 text-slate-300">Loading the board…</div>}
    </div>
  );
}

// --- little presentational pieces ------------------------------------------
function Kpi({ label, value, sub, trend, trendGoodDown, tone = 'idle' }) {
  const t = TONE[tone] || TONE.idle;
  let arrow = null;
  if (typeof trend === 'number' && Math.abs(trend) >= 0.5) {
    const up = trend > 0;
    const bad = trendGoodDown ? up : !up;
    arrow = <span className={bad ? 'text-red-400' : 'text-emerald-400'}>{up ? '▲' : '▼'}</span>;
  }
  return (
    <div className={`rounded-xl ring-1 ${t.ring} bg-slate-900 p-3`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-3xl font-extrabold mt-1 flex items-baseline gap-1 ${t.text}`}>
        <span>{value}</span>{arrow && <span className="text-base">{arrow}</span>}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
const Stat = ({ k, v }) => (
  <div className="text-center rounded-lg bg-slate-950/60 py-1.5">
    <div className="text-lg font-bold leading-none">{v}</div>
    <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-0.5">{k}</div>
  </div>
);
const SectionTitle = ({ children }) => (
  <div className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1">{children}</div>
);
const Empty = ({ children }) => <div className="text-slate-500 text-sm py-3 px-2 text-center">{children}</div>;
