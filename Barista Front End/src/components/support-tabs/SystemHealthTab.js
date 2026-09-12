import React, { useState, useEffect } from 'react';
import {
  Server, Database, Wifi, MessageSquare, Activity,
  HardDrive, Cpu, MemoryStick, Globe, CheckCircle,
  XCircle, AlertTriangle, RefreshCw
} from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import { Modal, Notice, Button } from '../../design';

const _apiService = new ApiServiceClass();

const mb = (b) => (b == null ? '—' : `${Math.round(b / 1048576)} MB`);

const SystemHealthTab = () => {
  const [components, setComponents] = useState([
    // Tiles are populated from real /api/diagnostics/* endpoints by
    // checkSystemHealth(). Initial values are 'unknown' so support
    // staff see a clear "loading" state rather than the hardcoded
    // mock that used to live here (45ms response, $123.45 Twilio
    // balance, etc).
    //
    // Redis and nginx tiles were removed — this stack doesn't use
    // either, so claiming they're "healthy" was actively misleading.
    {
      id: 'api',
      name: 'API Server',
      icon: <Server className="w-6 h-6" />,
      status: 'unknown',
      metrics: { 'Status': 'Loading…' },
    },
    {
      id: 'database',
      name: 'PostgreSQL Database',
      icon: <Database className="w-6 h-6" />,
      status: 'unknown',
      metrics: { 'Status': 'Loading…' },
    },
    {
      id: 'twilio',
      name: 'SMS Gateway (Twilio)',
      icon: <MessageSquare className="w-6 h-6" />,
      status: 'unknown',
      metrics: { 'Status': 'Loading…' },
    },
    {
      id: 'host',
      name: 'Application Host (CPU/Memory)',
      icon: <Cpu className="w-6 h-6" />,
      status: 'unknown',
      metrics: { 'Status': 'Loading…' },
    },
    // Tiles populated from /api/health/full (added 2026-05-25).
    // Each one is a rollup of a distinct subsystem; status comes
    // from the check, metrics are the most useful 2-3 fields.
    {
      id: 'queue',
      name: 'Order Queue',
      icon: <Activity className="w-6 h-6" />,
      status: 'unknown',
      metrics: { 'Status': 'Loading…' },
    },
    {
      id: 'catalog',
      name: 'Catalog',
      icon: <HardDrive className="w-6 h-6" />,
      status: 'unknown',
      metrics: { 'Status': 'Loading…' },
    },
    {
      id: 'stations',
      name: 'Stations',
      icon: <Globe className="w-6 h-6" />,
      status: 'unknown',
      metrics: { 'Status': 'Loading…' },
    },
    {
      id: 'migrations',
      name: 'Schema Migrations',
      icon: <MemoryStick className="w-6 h-6" />,
      status: 'unknown',
      metrics: { 'Status': 'Loading…' },
    },
    // How full the Postgres volume is and what is in it (finding 17).
    // Railway's gauge showed 196 of 500 MB and nothing here could say why.
    {
      id: 'storage',
      name: 'Database storage',
      icon: <HardDrive className="w-6 h-6" />,
      status: 'unknown',
      metrics: { 'Status': 'Loading…' },
    },
  ]);
  // The measured storage figures, kept whole for the meter and the
  // reclaim dialog (the tile only shows the headline numbers).
  const [storage, setStorage] = useState(null);
  const [reclaimOpen, setReclaimOpen] = useState(false);
  const [reclaimBusy, setReclaimBusy] = useState(false);
  const [reclaimNote, setReclaimNote] = useState('');


  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  // Real host metrics + measured API round-trip, captured during
  // checkSystemHealth(). null = not yet known / endpoint unavailable,
  // rendered as "—" rather than a made-up number.
  const [perf, setPerf] = useState({ cpu: null, mem: null, latencyMs: null });
  
  useEffect(() => {
    // Initial check on mount.
    checkSystemHealth();
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      checkSystemHealth();
      setLastUpdate(new Date());
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Pull real diagnostics from the backend endpoints that already
  // exist (support_api_routes.py): database, sms, performance.
  // Updates the corresponding tile statuses + metrics so support
  // staff stops looking at the previously-hardcoded mockup values.
  const checkSystemHealth = async () => {
    const updates = {};

    // --- API + Database -------------------------------------------
    // Backend response shape: {status: 'healthy'|'error', message: ...}
    // The round-trip is also timed — it doubles as the "API Latency"
    // overview figure (a real measurement, not a hardcoded 12ms).
    let latencyMs = null;
    try {
      const _t0 = performance.now();
      const dbResp = await _apiService.get('/diagnostics/database');
      latencyMs = performance.now() - _t0;
      const ok = dbResp?.status === 'healthy';
      updates.api = {
        status: ok ? 'healthy' : 'error',
        metrics: ok
          ? { 'DB Connection': 'OK' }
          : { 'Error': dbResp?.message || 'unreachable' },
      };
      updates.database = {
        status: ok ? 'healthy' : 'error',
        metrics: ok
          ? { 'Status': 'Connected' }
          : { 'Error': dbResp?.message || 'down' },
      };
    } catch (e) {
      updates.api = { status: 'error', metrics: { 'Error': String(e?.message || e) } };
      updates.database = { status: 'error', metrics: { 'Error': 'unreachable' } };
    }

    // --- Twilio / SMS gateway -------------------------------------
    // Backend response shape: {status: 'healthy'|'warning'|'error', message: ...}
    try {
      const smsResp = await _apiService.get('/diagnostics/sms');
      const status =
        smsResp?.status === 'healthy' ? 'healthy' :
        smsResp?.status === 'warning' ? 'warning' :
        'error';
      updates.twilio = {
        status,
        metrics: {
          'Status':  smsResp?.status || 'unknown',
          ...(smsResp?.message ? { 'Message': smsResp.message } : {}),
        },
      };
    } catch (e) {
      updates.twilio = { status: 'error', metrics: { 'Error': String(e?.message || e) } };
    }

    // --- Host (CPU/Memory) ----------------------------------------
    try {
      const perfResp = await _apiService.get('/diagnostics/performance');
      const cpu = perfResp?.cpuUsage;
      const mem = perfResp?.memoryUsage;
      const status = (cpu > 90 || mem > 90) ? 'warning' : 'healthy';
      updates.host = {
        status,
        metrics: {
          'CPU':    typeof cpu === 'number' ? `${cpu.toFixed(0)}%` : 'n/a',
          'Memory': typeof mem === 'number' ? `${mem.toFixed(0)}%` : 'n/a',
        },
      };
      setPerf({
        cpu: typeof cpu === 'number' ? cpu : null,
        mem: typeof mem === 'number' ? mem : null,
        latencyMs,
      });
    } catch (e) {
      updates.host = { status: 'warning', metrics: { 'Error': String(e?.message || e) } };
      setPerf({ cpu: null, mem: null, latencyMs });
    }

    // --- Rich health endpoint: queue / catalog / stations / migrations
    // ----------------------------------------------------------------
    // /api/health/full reports {checks: {subsystem: {status, detail,
    // ...extra}}}. Maps subsystems → tile ids 1:1. ok/warn/fail there
    // → healthy/warning/error here.
    const _mapStatus = (s) =>
      s === 'ok' ? 'healthy' : s === 'warn' ? 'warning' : s === 'fail' ? 'error' : 'unknown';
    try {
      const full = await _apiService.get('/health/full');
      const checks = (full && full.checks) || {};

      if (checks.database) {
        const q = checks.database.queue || {};
        updates.queue = {
          status: _mapStatus(checks.database.status),
          metrics: {
            'Pending':       q.pending != null ? String(q.pending) : '—',
            'In progress':   q.in_progress != null ? String(q.in_progress) : '—',
            'Ready for pickup': q.ready_for_pickup != null ? String(q.ready_for_pickup) : '—',
            'Last hour':     q.created_last_hour != null ? `${q.created_last_hour} new` : '—',
          },
        };
      }
      if (checks.catalog) {
        const by = checks.catalog.by_category || {};
        updates.catalog = {
          status: _mapStatus(checks.catalog.status),
          metrics: {
            'Milks':       by.milk != null ? String(by.milk) : '—',
            'Drinks':      by.drink != null ? String(by.drink) : '—',
            'Sizes':       by.size != null ? String(by.size) : '—',
            'Sweeteners':  by.sweetener != null ? String(by.sweetener) : '—',
          },
        };
      }
      if (checks.stations) {
        updates.stations = {
          status: _mapStatus(checks.stations.status),
          metrics: {
            'Active':      String(checks.stations.active ?? '—'),
            'Inactive':    String(checks.stations.inactive ?? '—'),
            'Maintenance': String(checks.stations.maintenance ?? '—'),
            'Total':       String(checks.stations.total ?? '—'),
          },
        };
      }
      if (checks.migrations) {
        updates.migrations = {
          status: _mapStatus(checks.migrations.status),
          metrics: {
            'Applied': String(checks.migrations.applied_count ?? '—'),
            'Pending': (checks.migrations.pending_versions || []).join(', ') || 'none',
          },
        };
      }
      if (checks.storage) {
        const st = checks.storage;
        setStorage(st);
        const bigTable = (st.tables || [])[0];
        const bigKey = (st.settings_keys || [])[0];
        updates.storage = {
          status: _mapStatus(st.status),
          metrics: {
            'Data':          mb(st.db_bytes),
            'WAL':           st.wal_bytes == null ? 'n/a' : mb(st.wal_bytes),
            'Volume':        st.used_pct == null ? '—' : `${Math.round(st.used_pct)}% of ${mb(st.volume_bytes)}`,
            'Reclaimable':   mb(st.settings_reclaimable_bytes),
            ...(bigTable ? { 'Largest table': `${bigTable.name} ${mb(bigTable.bytes)}` } : {}),
            ...(bigKey ? { 'Largest setting': `${bigKey.key} ${mb(bigKey.bytes)}` } : {}),
          },
        };
      }
      // Backfill twilio from /health/full if /diagnostics/sms failed.
      if (checks.twilio && (!updates.twilio || updates.twilio.status === 'error')) {
        updates.twilio = {
          status: _mapStatus(checks.twilio.status),
          metrics: {
            'Mode': checks.twilio.testing_mode ? 'Testing (stubbed)' : 'Live',
            ...(checks.twilio.phone_number ? { 'Phone': checks.twilio.phone_number } : {}),
            ...(checks.twilio.detail ? { 'Detail': checks.twilio.detail } : {}),
          },
        };
      }
    } catch (e) {
      // /api/health/full unreachable — leave the new tiles at 'unknown'.
      // The classic /diagnostics/* fetches above already populated the
      // legacy tiles, so the panel isn't blank.
      console.warn('/api/health/full failed:', e?.message);
    }

    // Merge updates onto whichever tile id matches. Anything we don't
    // have real data for keeps its existing (possibly mock) values —
    // intentional fallback rather than nuking the whole grid on the
    // first failed fetch.
    setComponents(prev => prev.map(c => {
      const upd = updates[c.id];
      if (!upd) return c;
      return { ...c, status: upd.status, metrics: upd.metrics };
    }));
    setLastUpdate(new Date());
  };
  
  // VACUUM (FULL) the settings table: every save of a branding, sponsor or
  // video blob leaves the old copy behind until a vacuum. Admin only on
  // the server; a second's exclusive lock on settings, so the dialog says
  // "quiet moment" and the button is only offered when there is something
  // worth getting back.
  const reclaim = async () => {
    setReclaimBusy(true); setReclaimNote('');
    try {
      const r = await _apiService.post('/health/storage/reclaim', {});
      setReclaimNote(r?.message || 'Done.');
      await checkSystemHealth();
    } catch (e) {
      setReclaimNote(e?.details?.message || e?.message || 'Reclaim failed');
    }
    setReclaimBusy(false);
  };
  const reclaimable = storage?.settings_reclaimable_bytes || 0;
  const reclaimWorth = reclaimable >= 5 * 1048576;

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="w-5 h-5 text-cq-ready" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-cq-warn" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-cq-alert" />;
      default:
        return <Activity className="w-5 h-5 text-cq-ink-3" />;
    }
  };
  
  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy': return 'border-cq-ready bg-cq-ready-wash';
      case 'warning': return 'border-cq-warn bg-cq-warn-wash';
      case 'error': return 'border-cq-alert bg-cq-alert-wash';
      default: return 'border-cq-line bg-cq-wash';
    }
  };
  
  return (
    // Gutter comes from the Support shell's <main className="p-6">.
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">System Health Monitor</h2>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-cq-ink-2">
            Last update: {lastUpdate.toLocaleTimeString()}
          </span>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="mr-2 w-[18px] h-[18px] rounded-cq-sm border-2 border-cq-line accent-cq-caramel cursor-pointer"
            />
            <span className="text-sm">Auto-refresh</span>
          </label>
          <button
            onClick={checkSystemHealth}
            className="p-2 bg-cq-caramel-wash hover:bg-cq-caramel-wash rounded-cq-md transition-colors"
          >
            <RefreshCw className="w-5 h-5 text-cq-caramel-deep" />
          </button>
        </div>
      </div>
      
      {/* System Overview — every figure is computed from the live tile
          statuses / measured calls below. Previously these were hardcoded
          (98%, "1 incident", 42%, 12ms) which made the panel claim health
          it never checked. "—" means not yet measured. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {(() => {
          const known = components.filter(c => c.status !== 'unknown');
          const healthy = known.filter(c => c.status === 'healthy').length;
          const score = known.length ? Math.round((healthy / known.length) * 100) : null;
          const incidents = components.filter(c => c.status === 'error').length;
          const cpu = perf.cpu;
          const lat = perf.latencyMs;
          return (
            <>
              <OverviewCard
                label="Health Score"
                value={score == null ? '—' : `${score}%`}
                status={score == null ? 'warning' : score >= 90 ? 'healthy' : score >= 70 ? 'warning' : 'error'}
              />
              <OverviewCard
                label="Components Failing"
                value={String(incidents)}
                status={incidents === 0 ? 'healthy' : 'error'}
              />
              <OverviewCard
                label="CPU Load"
                value={cpu == null ? '—' : `${Math.round(cpu)}%`}
                status={cpu == null ? 'warning' : cpu > 90 ? 'error' : cpu > 70 ? 'warning' : 'healthy'}
              />
              <OverviewCard
                label="API Latency"
                value={lat == null ? '—' : `${Math.round(lat)}ms`}
                status={lat == null ? 'warning' : lat < 500 ? 'healthy' : lat < 2000 ? 'warning' : 'error'}
              />
            </>
          );
        })()}
      </div>
      
      {/* Components Grid */}
      <div className="grid grid-cols-2 gap-4">
        {components.map(component => (
          <ComponentCard
            key={component.id}
            component={component}
            getStatusIcon={getStatusIcon}
            getStatusColor={getStatusColor}
            action={component.id === 'storage' && reclaimWorth ? (
              <Button variant="secondary" size="sm" onClick={() => { setReclaimNote(''); setReclaimOpen(true); }}>
                Reclaim {mb(reclaimable)}
              </Button>
            ) : null}
            note={component.id === 'storage' && reclaimNote ? reclaimNote : null}
          />
        ))}
      </div>
      
      {/* System Resources */}
      <div className="mt-6 bg-cq-milk rounded-cq-lg shadow-cq-card p-6">
        <h3 className="font-semibold text-lg mb-4 flex items-center">
          <Cpu className="w-5 h-5 mr-2" />
          System Resources
        </h3>
        {/* Real values from /api/diagnostics/performance (psutil on the
            host). Disk meter removed — the backend doesn't report disk,
            and the old hardcoded 45GB/100GB was pure fiction. */}
        <div className="grid grid-cols-2 gap-6">
          <ResourceMeter
            label="CPU Usage"
            value={perf.cpu == null ? 0 : Math.round(perf.cpu)}
            max={100}
            unit="%"
            color="blue"
          />
          <ResourceMeter
            label="Memory Usage"
            value={perf.mem == null ? 0 : Math.round(perf.mem)}
            max={100}
            unit="%"
            color="green"
          />
          {/* The Postgres volume, measured from inside: data + WAL against
              DB_VOLUME_MB. Railway's own gauge runs a little higher because
              it also counts Postgres' bookkeeping, which no query can sum.
              Amber at 60 %, red at 80 % -- the same thresholds the tile uses. */}
          <ResourceMeter
            label="Database volume"
            value={storage?.used_bytes == null ? 0 : Math.round(storage.used_bytes / 1048576)}
            max={storage?.volume_bytes ? Math.round(storage.volume_bytes / 1048576) : 500}
            unit=" MB"
            color={storage?.used_pct >= 80 ? 'red' : storage?.used_pct >= 60 ? 'amber' : 'blue'}
          />
        </div>
        {storage?.used_pct != null && (
          <p className="text-xs text-cq-ink-3 mt-3">
            {mb(storage.db_bytes)} of data{storage.wal_bytes != null ? ` and ${mb(storage.wal_bytes)} of WAL` : ''} on a {mb(storage.volume_bytes)} volume.
            Railway's gauge reads a little higher: it also counts Postgres' own bookkeeping.
          </p>
        )}
        {perf.cpu == null && (
          <p className="text-xs text-cq-ink-3 mt-3">
            Live CPU/memory unavailable — /api/diagnostics/performance unreachable.
          </p>
        )}
      </div>
      {/* The old "Recent Health Events" feed was removed: every entry was a
          hardcoded fake (Redis threshold, backup completed, API restart) for
          services this stack doesn't even run. Real frontend crashes are in
          Diagnose → Client crashes; real order/system state is in the tiles. */}
      {reclaimOpen && (
        <Modal title="Reclaim database space" Icon={HardDrive} onClose={() => setReclaimOpen(false)} busy={reclaimBusy}
               footer={(
                 <>
                   <Button variant="ghost" onClick={() => setReclaimOpen(false)} disabled={reclaimBusy}>Not now</Button>
                   <Button variant="primary" onClick={async () => { await reclaim(); setReclaimOpen(false); }} disabled={reclaimBusy}>
                     {reclaimBusy ? 'Reclaiming…' : `Reclaim ${mb(reclaimable)}`}
                   </Button>
                 </>
               )}>
          <Notice tone="warn">Do this at a quiet moment. Settings are locked for a second or two while the table is rewritten; screens that are open keep working.</Notice>
          <p className="text-sm text-cq-ink-2">
            Every save of a branding, sponsor or background-video blob leaves the old copy behind until the
            database tidies up. The settings table is {mb(storage?.settings_bytes)} for {mb(storage?.settings_live_bytes)} of
            live data; the rest comes back to the volume.
          </p>
        </Modal>
      )}
    </div>
  );
};

const OverviewCard = ({ label, value, status }) => {
  const statusColors = {
    healthy: 'text-cq-ready',
    warning: 'text-cq-warn',
    error: 'text-cq-alert'
  };
  
  return (
    <div className="bg-cq-milk rounded-cq-lg shadow-cq-card p-4">
      <div className="text-sm text-cq-ink-2 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${statusColors[status]}`}>{value}</div>
    </div>
  );
};

// No "restart" button: there is no per-component restart on the backend, and
// the one that stood here only opened a browser alert saying so (finding 8).
const ComponentCard = ({ component, getStatusIcon, getStatusColor, action = null, note = null }) => (
  <div className={`border-2 rounded-cq-md p-4 ${getStatusColor(component.status)}`}>
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center space-x-3">
        {component.icon}
        <h3 className="font-semibold">{component.name}</h3>
      </div>
      <div className="flex items-center space-x-2">
        {getStatusIcon(component.status)}
      </div>
    </div>
    
    {component.warning && (
      <div className="mb-3 p-2 bg-cq-warn-wash rounded text-sm text-cq-warn">
        {component.warning}
      </div>
    )}
    
    <div className="grid grid-cols-2 gap-2 text-sm">
      {Object.entries(component.metrics).map(([key, value]) => (
        <div key={key}>
          <span className="text-cq-ink-2">{key}:</span>
          <span className="font-medium ml-1">{value}</span>
        </div>
      ))}
    </div>
    {(action || note) && (
      <div className="flex items-center justify-between gap-3 mt-3">
        {action}
        {note ? <span className="text-sm font-semibold text-cq-caramel-deep">{note}</span> : null}
      </div>
    )}
  </div>
);

const ResourceMeter = ({ label, value, max, unit, color }) => {
  const percentage = (value / max) * 100;
  const colorClasses = {
    blue: 'bg-cq-caramel',
    green: 'bg-cq-ready',
    purple: 'bg-cq-caramel',
    amber: 'bg-cq-warn',
    red: 'bg-cq-alert',
  };
  
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-cq-ink-2">
          {value}{unit} / {max}{unit}
        </span>
      </div>
      <div className="w-full bg-cq-wash rounded-full h-2">
        <div
          className={`h-full rounded-full ${colorClasses[color]}`}
          style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </div>
    </div>
  );
};


export default SystemHealthTab;