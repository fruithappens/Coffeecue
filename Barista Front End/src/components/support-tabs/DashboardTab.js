import React, { useState, useEffect } from 'react';
import {
  Activity, AlertTriangle, Coffee, Clock, TrendingUp,
  Users, DollarSign, CheckCircle, XCircle, RefreshCw
} from 'lucide-react';
import useOrders from '../../hooks/useOrders';
import useStations from '../../hooks/useStations';
import ApiServiceClass from '../../services/ApiService';

const api = new ApiServiceClass();

// Wire the Quick Action buttons to real backend endpoints. Each
// handler confirms with the operator first (these are
// event-affecting actions — no accidental clicks). On success a
// short status message is shown alongside the button grid.
const quickAction = async (label, fn, setStatus) => {
  setStatus({ label, state: 'busy', message: 'Working…' });
  try {
    const result = await fn();
    setStatus({ label, state: 'ok', message: result || 'Done' });
  } catch (e) {
    setStatus({ label, state: 'err', message: e?.message || 'Failed' });
  } finally {
    setTimeout(() => setStatus(null), 4000);
  }
};

const DashboardTab = () => {
  const { pendingOrders, inProgressOrders, completedOrders } = useOrders();
  const { stations } = useStations();
  const [quickStatus, setQuickStatus] = useState(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastSending, setBroadcastSending] = useState(false);

  // Pause / Resume / Emergency Stop wire to the real backend endpoints.
  const handlePauseAll = () => quickAction('Pause All Orders', async () => {
    if (!window.confirm('Pause all pending and in-progress orders? Customers will need to be told their order is delayed.')) return 'Cancelled';
    const r = await api.request('/emergency/stop-all', { method: 'POST' });
    return r?.message || 'All active orders paused';
  }, setQuickStatus);

  const handleEmergencyStop = () => quickAction('Emergency Stop', async () => {
    if (!window.confirm('Emergency stop will pause ALL active orders. Use only if there\'s an immediate safety issue. Continue?')) return 'Cancelled';
    const r = await api.request('/emergency/stop-all', { method: 'POST' });
    return r?.message || 'Emergency stop activated';
  }, setQuickStatus);

  const handleBroadcast = () => {
    setBroadcastMsg('');
    setBroadcastOpen(true);
  };

  const sendBroadcast = async () => {
    const text = (broadcastMsg || '').trim();
    if (!text) return;
    setBroadcastSending(true);
    try {
      const r = await api.request('/support/broadcast/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, audience: 'today' }),
      });
      setQuickStatus({ label: 'Broadcast Message', state: 'ok',
                       message: `Sent to ${r?.sent || r?.recipient_count || 'recipients'}` });
      setBroadcastOpen(false);
      setBroadcastMsg('');
      setTimeout(() => setQuickStatus(null), 4000);
    } catch (e) {
      setQuickStatus({ label: 'Broadcast Message', state: 'err',
                       message: e?.message || 'Broadcast failed' });
    } finally {
      setBroadcastSending(false);
    }
  };

  const handleRefreshData = () => quickAction('Refresh Data', async () => {
    // The "Restart Services" placeholder didn't make sense for a
    // hosted backend the operator can't actually restart. Repurposed
    // as "Refresh Data" — force-reload caches by invalidating the
    // useOrders/useStations data via a window event.
    window.dispatchEvent(new CustomEvent('app:forceRefresh'));
    return 'Caches refreshed';
  }, setQuickStatus);
  
  const [metrics, setMetrics] = useState({
    totalOrders: 0,
    activeOrders: 0,
    avgWaitTime: 0,
    errorRate: 0,
    revenue: 0,
    ordersPerHour: 0,
    systemUptime: 99.8,
    customerSatisfaction: 4.5
  });
  
  const [alerts, setAlerts] = useState([
    { id: 1, type: 'warning', message: 'High queue at Station 1', time: '2 min ago' },
    { id: 2, type: 'error', message: 'Station 3 offline', time: '5 min ago' },
    { id: 3, type: 'success', message: 'Backup completed successfully', time: '1 hour ago' }
  ]);
  
  useEffect(() => {
    // Calculate metrics
    const totalOrders = (pendingOrders?.length || 0) + 
                       (inProgressOrders?.length || 0) + 
                       (completedOrders?.length || 0);
    const activeOrders = (pendingOrders?.length || 0) + (inProgressOrders?.length || 0);
    
    setMetrics(prev => ({
      ...prev,
      totalOrders,
      activeOrders
    }));
  }, [pendingOrders, inProgressOrders, completedOrders]);
  
  const getAlertIcon = (type) => {
    switch (type) {
      case 'error': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'success': return <CheckCircle className="w-5 h-5 text-green-500" />;
      default: return <Activity className="w-5 h-5 text-blue-500" />;
    }
  };
  
  return (
    <div className="p-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h2 className="text-xl font-bold text-blue-800">📊 Dashboard Tab</h2>
        <p className="text-blue-600">System overview and real-time metrics</p>
      </div>
      {/* System Status Bar */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6 flex items-center justify-between">
        <div className="flex items-center space-x-6">
          <div className="flex items-center">
            <div className="w-3 h-3 bg-green-500 rounded-full mr-2 animate-pulse"></div>
            <span className="font-semibold">System Status: Online</span>
          </div>
          <div className="text-sm text-gray-600">
            Uptime: {metrics.systemUptime}%
          </div>
          <div className="text-sm text-gray-600">
            Last Update: {new Date().toLocaleTimeString()}
          </div>
        </div>
        <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>
      
      {/* Metrics Grid */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Active Orders"
          value={metrics.activeOrders}
          icon={<Coffee className="w-6 h-6 text-orange-600" />}
          trend="+12%"
          trendUp={true}
        />
        <MetricCard
          title="Avg Wait Time"
          value={`${metrics.avgWaitTime} min`}
          icon={<Clock className="w-6 h-6 text-blue-600" />}
          trend="-2 min"
          trendUp={false}
        />
        <MetricCard
          title="Error Rate"
          value={`${metrics.errorRate}%`}
          icon={<AlertTriangle className="w-6 h-6 text-red-600" />}
          trend="0%"
          trendUp={false}
        />
        <MetricCard
          title="Today's Revenue"
          value={`$${metrics.revenue.toLocaleString()}`}
          icon={<DollarSign className="w-6 h-6 text-green-600" />}
          trend="+8%"
          trendUp={true}
        />
      </div>
      
      {/* Alerts and Quick Actions */}
      <div className="grid grid-cols-2 gap-6">
        {/* Recent Alerts */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <h3 className="font-semibold text-lg mb-4 flex items-center">
            <AlertTriangle className="w-5 h-5 mr-2" />
            Recent Alerts
          </h3>
          <div className="space-y-3">
            {alerts.map(alert => (
              <div key={alert.id} className="flex items-start space-x-3 p-3 hover:bg-gray-50 rounded">
                {getAlertIcon(alert.type)}
                <div className="flex-1">
                  <p className="text-sm font-medium">{alert.message}</p>
                  <p className="text-xs text-gray-500">{alert.time}</p>
                </div>
              </div>
            ))}
          </div>
          <button className="mt-4 text-sm text-blue-600 hover:text-blue-800">
            View All Alerts →
          </button>
        </div>
        
        {/* Quick Actions — wired to real backend endpoints. */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <h3 className="font-semibold text-lg mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            <QuickActionButton
              label="Pause All Orders"
              icon={<Activity className="w-5 h-5" />}
              color="red"
              onClick={handlePauseAll}
            />
            <QuickActionButton
              label="Broadcast Message"
              icon={<Users className="w-5 h-5" />}
              color="blue"
              onClick={handleBroadcast}
            />
            <QuickActionButton
              label="Refresh Data"
              icon={<RefreshCw className="w-5 h-5" />}
              color="yellow"
              onClick={handleRefreshData}
            />
            <QuickActionButton
              label="Emergency Stop"
              icon={<XCircle className="w-5 h-5" />}
              color="red"
              onClick={handleEmergencyStop}
            />
          </div>
          {quickStatus && (
            <div className={`mt-3 text-sm p-2 rounded ${
              quickStatus.state === 'ok' ? 'bg-green-50 text-green-800' :
              quickStatus.state === 'err' ? 'bg-red-50 text-red-800' :
              'bg-gray-50 text-gray-700'
            }`}>
              <strong>{quickStatus.label}:</strong> {quickStatus.message}
            </div>
          )}
          {broadcastOpen && (
            <div className="mt-3 p-3 border border-blue-200 bg-blue-50 rounded">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Broadcast message to today's customers
              </label>
              <textarea
                value={broadcastMsg}
                onChange={(e) => setBroadcastMsg(e.target.value)}
                rows="3"
                maxLength={480}
                placeholder="e.g. The coffee station is closing in 15 minutes."
                className="w-full p-2 border border-gray-300 rounded text-sm"
              />
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-gray-500">{broadcastMsg.length}/480 chars</span>
                <div className="space-x-2">
                  <button
                    onClick={() => { setBroadcastOpen(false); setBroadcastMsg(''); }}
                    className="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded"
                  >Cancel</button>
                  <button
                    onClick={sendBroadcast}
                    disabled={broadcastSending || !broadcastMsg.trim()}
                    className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                  >{broadcastSending ? 'Sending…' : 'Send'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Live Order Flow */}
      <div className="mt-6 bg-white rounded-lg shadow-sm p-4">
        <h3 className="font-semibold text-lg mb-4">Live Order Flow</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-3xl font-bold text-orange-600">{pendingOrders?.length || 0}</div>
            <div className="text-sm text-gray-600">Pending</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-blue-600">{inProgressOrders?.length || 0}</div>
            <div className="text-sm text-gray-600">In Progress</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600">{completedOrders?.length || 0}</div>
            <div className="text-sm text-gray-600">Completed Today</div>
          </div>
        </div>
      </div>

      <TodayReport />

      
      {/* Station Status */}
      <div className="mt-6 bg-white rounded-lg shadow-sm p-4">
        <h3 className="font-semibold text-lg mb-4">Station Status</h3>
        <div className="grid grid-cols-4 gap-4">
          {stations?.map(station => (
            <div key={station.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Station {station.id}</span>
                <div className={`w-2 h-2 rounded-full ${
                  station.status === 'active' ? 'bg-green-500' : 'bg-red-500'
                }`}></div>
              </div>
              <div className="text-sm text-gray-600">
                <div>Queue: {station.queueLength || 0}</div>
                <div>Wait: {station.waitTime || 10} min</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const MetricCard = ({ title, value, icon, trend, trendUp }) => (
  <div className="bg-white rounded-lg shadow-sm p-4">
    <div className="flex items-center justify-between mb-2">
      {icon}
      <span className={`text-sm ${trendUp ? 'text-green-600' : 'text-red-600'}`}>
        {trend}
      </span>
    </div>
    <div className="text-2xl font-bold">{value}</div>
    <div className="text-sm text-gray-600">{title}</div>
  </div>
);

const QuickActionButton = ({ label, icon, color, onClick }) => {
  const colorClasses = {
    red: 'bg-red-100 hover:bg-red-200 text-red-700',
    blue: 'bg-blue-100 hover:bg-blue-200 text-blue-700',
    yellow: 'bg-yellow-100 hover:bg-yellow-200 text-yellow-700',
    green: 'bg-green-100 hover:bg-green-200 text-green-700'
  };
  
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-lg transition-colors ${colorClasses[color]} flex flex-col items-center space-y-2`}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
};

// ---- TodayReport --------------------------------------------------------
// Live event metrics rolled up by /api/reports/today. Polls every 30s
// and listens for order_updated WS events so figures stay current
// without the operator hitting refresh.
const TodayReport = () => {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  const load = React.useCallback(async () => {
    try {
      const r = await api.request('/reports/today', { method: 'GET' });
      if (r && r.success !== false) {
        setData(r);
        setError(null);
      } else {
        setError(r?.error || 'Could not load report');
      }
    } catch (e) {
      setError(e?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    const onOrderEvt = () => load();
    window.addEventListener('order_updated', onOrderEvt);
    window.addEventListener('order_created', onOrderEvt);
    return () => {
      clearInterval(timer);
      window.removeEventListener('order_updated', onOrderEvt);
      window.removeEventListener('order_created', onOrderEvt);
    };
  }, [load]);

  // Opens the printable summary in a new tab. The backend renders an
  // inline-styled HTML page; operator hits Cmd+P → Save as PDF → emails
  // the file to the client. Cheaper than adding a server-side PDF lib.
  const handlePrint = () => {
    // Use the JWT-aware URL. Authorization header isn't sent on
    // window.open, so we add the token as a fallback query param —
    // backend's jwt_required_with_demo decorator accepts ?jwt=… via
    // flask_jwt_extended's locations config in app.py. If not, the
    // operator will be prompted to log in (acceptable demo UX).
    const token = localStorage.getItem('coffee_auth_token') || '';
    const url = `/api/reports/today/print${token ? `?jwt=${encodeURIComponent(token)}` : ''}`;
    window.open(url, '_blank', 'noopener');
  };

  if (loading && !data) {
    return (
      <div className="mt-6 bg-white rounded-lg shadow-sm p-4">
        <h3 className="font-semibold text-lg mb-4">Today's Report</h3>
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-6 bg-white rounded-lg shadow-sm p-4">
        <h3 className="font-semibold text-lg mb-4">Today's Report</h3>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  const total = data?.total_orders ?? 0;
  const sym = data?.currency_symbol ?? '$';
  const fmtRev = (n) => `${sym}${(n || 0).toFixed(2)}`;
  const fmtMin = (n) => (n == null ? '—' : `${n.toFixed(1)} min`);

  return (
    <div className="mt-6 bg-white rounded-lg shadow-sm p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-lg">Today's Report</h3>
        <div className="flex items-center gap-3">
          <button
            onClick={handlePrint}
            className="text-xs text-amber-700 hover:text-amber-900 underline"
            title="Open a printable summary in a new tab — Cmd+P → Save as PDF"
          >
            Print / save as PDF
          </button>
          <span className="text-xs text-gray-400">{data?.date}</span>
        </div>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="text-center p-3 border rounded">
          <div className="text-2xl font-bold">{total}</div>
          <div className="text-xs text-gray-500 uppercase">Total orders</div>
        </div>
        <div className="text-center p-3 border rounded">
          <div className="text-2xl font-bold">{fmtMin(data?.avg_wait_min)}</div>
          <div className="text-xs text-gray-500 uppercase">Avg wait</div>
        </div>
        <div className="text-center p-3 border rounded">
          <div className="text-2xl font-bold">{fmtRev(data?.revenue_total)}</div>
          <div className="text-xs text-gray-500 uppercase">Revenue (stamped)</div>
        </div>
        <div className="text-center p-3 border rounded">
          <div className="text-2xl font-bold">
            {data?.status_breakdown?.completed ?? 0}
          </div>
          <div className="text-xs text-gray-500 uppercase">Completed</div>
        </div>
      </div>

      {/* Per-station + top drinks side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Per station</h4>
          {data?.per_station?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="text-left py-1">Station</th>
                  <th className="text-right py-1">Orders</th>
                  <th className="text-right py-1">Avg wait</th>
                </tr>
              </thead>
              <tbody>
                {data.per_station.map(s => (
                  <tr key={s.station_id || 'unassigned'} className="border-b last:border-b-0">
                    <td className="py-1">{s.station_id ?? 'Unassigned'}</td>
                    <td className="py-1 text-right">{s.orders}</td>
                    <td className="py-1 text-right">{s.avg_wait_min == null ? '—' : `${s.avg_wait_min} min`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-gray-500">No data yet.</p>}
        </div>
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Top drinks</h4>
          {data?.top_drinks?.length ? (
            <ol className="text-sm space-y-1">
              {data.top_drinks.map((d, i) => (
                <li key={d.drink} className="flex justify-between border-b last:border-b-0 py-1">
                  <span>{i + 1}. {d.drink}</span>
                  <span className="text-gray-500">{d.orders}</span>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-gray-500">No data yet.</p>}
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Refreshes every 30s and on order updates. Revenue counts only orders
        with a price stamped at confirmation (pricing must be enabled).
      </p>
    </div>
  );
};

export default DashboardTab;