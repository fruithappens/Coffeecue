import React, { useState, useEffect } from 'react';
import { 
  Activity, AlertTriangle, Coffee, Clock, TrendingUp, 
  Users, DollarSign, CheckCircle, XCircle, RefreshCw 
} from 'lucide-react';
import useOrders from '../../hooks/useOrders';
import useStations from '../../hooks/useStations';

const DashboardTab = () => {
  console.log('DashboardTab component loaded');
  const { pendingOrders, inProgressOrders, completedOrders } = useOrders();
  const { stations } = useStations();
  
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
        
        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <h3 className="font-semibold text-lg mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            <QuickActionButton
              label="Pause All Orders"
              icon={<Activity className="w-5 h-5" />}
              color="red"
              onClick={() => console.log('Pause all orders')}
            />
            <QuickActionButton
              label="Broadcast Message"
              icon={<Users className="w-5 h-5" />}
              color="blue"
              onClick={() => console.log('Broadcast message')}
            />
            <QuickActionButton
              label="Restart Services"
              icon={<RefreshCw className="w-5 h-5" />}
              color="yellow"
              onClick={() => console.log('Restart services')}
            />
            <QuickActionButton
              label="Emergency Stop"
              icon={<XCircle className="w-5 h-5" />}
              color="red"
              onClick={() => console.log('Emergency stop')}
            />
          </div>
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

export default DashboardTab;