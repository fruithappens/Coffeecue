import React, { useState, useEffect } from 'react';
import {
  Server, Database, Wifi, MessageSquare, Activity,
  HardDrive, Cpu, MemoryStick, Globe, CheckCircle,
  XCircle, AlertTriangle, RefreshCw
} from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';

const _apiService = new ApiServiceClass();

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
  ]);


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
  
  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Activity className="w-5 h-5 text-gray-500" />;
    }
  };
  
  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy': return 'border-green-500 bg-green-50';
      case 'warning': return 'border-yellow-500 bg-yellow-50';
      case 'error': return 'border-red-500 bg-red-50';
      default: return 'border-gray-500 bg-gray-50';
    }
  };
  
  // Component-restart buttons are non-functional: there's no per-
  // component restart endpoint on the backend (and "restart Postgres
  // from the support UI" isn't a thing you actually want to wire up
  // anyway). Left in place but no-op'd to make this explicit — was
  // previously a console.log that looked like it worked.
  const handleRestart = (componentId) => {
    window.alert(
      `Restarting "${componentId}" from this panel isn't supported. ` +
      `Restart the service from your deploy host (Railway dashboard, ` +
      `systemd, etc).`
    );
  };
  
  return (
    // Gutter comes from the Support shell's <main className="p-6">.
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">System Health Monitor</h2>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-600">
            Last update: {lastUpdate.toLocaleTimeString()}
          </span>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm">Auto-refresh</span>
          </label>
          <button
            onClick={checkSystemHealth}
            className="p-2 bg-blue-100 hover:bg-blue-200 rounded-lg transition-colors"
          >
            <RefreshCw className="w-5 h-5 text-blue-600" />
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
            onRestart={() => handleRestart(component.id)}
          />
        ))}
      </div>
      
      {/* System Resources */}
      <div className="mt-6 bg-white rounded-lg shadow-sm p-6">
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
        </div>
        {perf.cpu == null && (
          <p className="text-xs text-gray-500 mt-3">
            Live CPU/memory unavailable — /api/diagnostics/performance unreachable.
          </p>
        )}
      </div>
      {/* The old "Recent Health Events" feed was removed: every entry was a
          hardcoded fake (Redis threshold, backup completed, API restart) for
          services this stack doesn't even run. Real frontend crashes are in
          Diagnose → Client crashes; real order/system state is in the tiles. */}
    </div>
  );
};

const OverviewCard = ({ label, value, status }) => {
  const statusColors = {
    healthy: 'text-green-600',
    warning: 'text-yellow-600',
    error: 'text-red-600'
  };
  
  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <div className="text-sm text-gray-600 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${statusColors[status]}`}>{value}</div>
    </div>
  );
};

const ComponentCard = ({ component, getStatusIcon, getStatusColor, onRestart }) => (
  <div className={`border-2 rounded-lg p-4 ${getStatusColor(component.status)}`}>
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center space-x-3">
        {component.icon}
        <h3 className="font-semibold">{component.name}</h3>
      </div>
      <div className="flex items-center space-x-2">
        {getStatusIcon(component.status)}
        <button
          onClick={onRestart}
          className="p-1 hover:bg-gray-200 rounded transition-colors"
          title="Restart component"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    </div>
    
    {component.warning && (
      <div className="mb-3 p-2 bg-yellow-100 rounded text-sm text-yellow-800">
        {component.warning}
      </div>
    )}
    
    <div className="grid grid-cols-2 gap-2 text-sm">
      {Object.entries(component.metrics).map(([key, value]) => (
        <div key={key}>
          <span className="text-gray-600">{key}:</span>
          <span className="font-medium ml-1">{value}</span>
        </div>
      ))}
    </div>
  </div>
);

const ResourceMeter = ({ label, value, max, unit, color }) => {
  const percentage = (value / max) * 100;
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500'
  };
  
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-gray-600">
          {value}{unit} / {max}{unit}
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={`h-full rounded-full ${colorClasses[color]}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};


export default SystemHealthTab;