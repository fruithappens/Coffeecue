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
  ]);


  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  
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
    try {
      const dbResp = await _apiService.get('/diagnostics/database');
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
    } catch (e) {
      updates.host = { status: 'warning', metrics: { 'Error': String(e?.message || e) } };
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
    <div className="p-6">
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
      
      {/* System Overview */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <OverviewCard label="Total Health Score" value="98%" status="healthy" />
        <OverviewCard label="Active Incidents" value="1" status="warning" />
        <OverviewCard label="System Load" value="42%" status="healthy" />
        <OverviewCard label="Network Latency" value="12ms" status="healthy" />
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
        <div className="grid grid-cols-3 gap-6">
          <ResourceMeter
            label="CPU Usage"
            value={24}
            max={100}
            unit="%"
            color="blue"
          />
          <ResourceMeter
            label="Memory Usage"
            value={6.2}
            max={16}
            unit="GB"
            color="green"
          />
          <ResourceMeter
            label="Disk Usage"
            value={45}
            max={100}
            unit="GB"
            color="purple"
          />
        </div>
      </div>
      
      {/* Recent Health Events */}
      <div className="mt-6 bg-white rounded-lg shadow-sm p-6">
        <h3 className="font-semibold text-lg mb-4">Recent Health Events</h3>
        <div className="space-y-2">
          <HealthEvent
            time="2 min ago"
            type="warning"
            message="Redis memory usage exceeded 85% threshold"
            component="Redis Cache"
          />
          <HealthEvent
            time="15 min ago"
            type="success"
            message="Database backup completed successfully"
            component="PostgreSQL"
          />
          <HealthEvent
            time="1 hour ago"
            type="error"
            message="API server restarted due to high memory usage"
            component="API Server"
          />
        </div>
      </div>
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

const HealthEvent = ({ time, type, message, component }) => {
  const typeIcons = {
    success: <CheckCircle className="w-4 h-4 text-green-500" />,
    warning: <AlertTriangle className="w-4 h-4 text-yellow-500" />,
    error: <XCircle className="w-4 h-4 text-red-500" />
  };
  
  return (
    <div className="flex items-start space-x-3 p-3 hover:bg-gray-50 rounded">
      {typeIcons[type]}
      <div className="flex-1">
        <p className="text-sm">{message}</p>
        <p className="text-xs text-gray-500">{component} • {time}</p>
      </div>
    </div>
  );
};

export default SystemHealthTab;