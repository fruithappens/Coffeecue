import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  AlertTriangle, Coffee, Package, Users, Clock, MessageCircle, 
  Activity, TrendingUp, Pause, Play, RefreshCw, Bell, Zap,
  ChevronRight, AlertCircle, CheckCircle, Wifi, WifiOff,
  MessageSquare, UserCheck, BarChart3
} from 'lucide-react';
import useStations from '../hooks/useStations';
import useOrders from '../hooks/useOrders';
import useStock from '../hooks/useStock';
import useSettings from '../hooks/useSettings';
import useMessages from '../hooks/useMessages';

/**
 * Live Operations Dashboard Component
 * Real-time command center for event management
 */
const LiveOperationsDashboard = () => {
  const { pendingOrders, inProgressOrders, completedOrders, refreshData } = useOrders();
  const { stations } = useStations();
  const stockLevels = []; // TODO: Implement proper stock levels hook
  
  // Combine all order types - memoized to prevent infinite re-renders
  const orders = useMemo(() => {
    return [
      ...(pendingOrders || []),
      ...(inProgressOrders || []),
      ...(completedOrders || [])
    ];
  }, [pendingOrders, inProgressOrders, completedOrders]);
  
  const refreshOrders = refreshData;
  
  // Use refs to access current values in interval
  const ordersRef = useRef(orders);
  const stationsRef = useRef(stations);
  const stockLevelsRef = useRef(stockLevels);
  
  // Update refs when values change
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);
  
  useEffect(() => {
    stationsRef.current = stations;
  }, [stations]);
  
  useEffect(() => {
    stockLevelsRef.current = stockLevels;
  }, [stockLevels]);
  
  // Critical alerts state
  const [criticalAlerts, setCriticalAlerts] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [selectedAlert, setSelectedAlert] = useState(null);
  
  // Update recent orders
  useEffect(() => {
    if (!orders || !Array.isArray(orders)) {
      setRecentOrders([]);
      return;
    }
    
    const recent = orders
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10);
    setRecentOrders(recent);
  }, [orders]);
  
  // Generate critical alerts based on system state - using interval to prevent dependency issues
  useEffect(() => {
    const generateAlerts = () => {
      const alerts = [];
      const currentOrders = ordersRef.current;
      const currentStations = stationsRef.current;
      const currentStockLevels = stockLevelsRef.current;
      
      // Check stock levels
      if (currentStockLevels && Array.isArray(currentStockLevels)) {
        currentStockLevels.forEach(stock => {
          if (stock.current_level < stock.min_level) {
            alerts.push({
              id: `stock-${stock.id}`,
              type: 'stock',
              severity: stock.current_level === 0 ? 'critical' : 'warning',
              station: stock.station_id,
              item: stock.item_name,
              message: `${stock.item_name} ${stock.current_level === 0 ? 'OUT OF STOCK' : 'running low'}`,
              timeRemaining: stock.current_level > 0 ? `${Math.round(stock.current_level / stock.usage_rate * 60)}min` : '0min',
              timestamp: new Date()
            });
          }
        });
      }
      
      // Check station wait times
      if (currentStations && Array.isArray(currentStations) && currentOrders && Array.isArray(currentOrders)) {
        currentStations.forEach(station => {
          const stationOrders = currentOrders.filter(o => o.station_id === station.id && o.status === 'pending');
          const avgWaitTime = station.average_wait_time || 0;
          
          if (avgWaitTime > 15) {
            alerts.push({
              id: `wait-${station.id}`,
              type: 'wait',
              severity: avgWaitTime > 20 ? 'critical' : 'warning',
              station: station.id,
              message: `Station ${station.name} - High wait time`,
              waitTime: `${avgWaitTime}min`,
              queueLength: stationOrders.length,
              timestamp: new Date()
            });
          }
        });
      }
      
      // Check for VIP or group orders
      if (currentOrders && Array.isArray(currentOrders)) {
        currentOrders.forEach(order => {
          if (order.is_vip && order.status === 'pending') {
            alerts.push({
              id: `vip-${order.id}`,
              type: 'vip',
              severity: 'info',
              orderId: order.id,
              message: `VIP order #${order.id} pending`,
              requirement: 'Priority handling required',
              timestamp: new Date()
            });
          }
          
          if (order.group_id && order.status === 'pending') {
            alerts.push({
              id: `group-${order.group_id}`,
              type: 'group',
              severity: 'info',
              orderId: order.id,
              groupId: order.group_id,
              message: `Group order ${order.group_id} - ${order.items?.length || 0} items`,
              requirement: 'Coordinate preparation',
              timestamp: new Date()
            });
          }
        });
      }
      
      setCriticalAlerts(prevAlerts => {
        const newAlerts = alerts.sort((a, b) => {
          const severityOrder = { critical: 0, warning: 1, info: 2 };
          return severityOrder[a.severity] - severityOrder[b.severity];
        });
        
        // Only update if alerts actually changed (simple comparison)
        const prevIds = prevAlerts.map(a => a.id).join(',');
        const newIds = newAlerts.map(a => a.id).join(',');
        
        if (prevIds !== newIds) {
          return newAlerts;
        }
        return prevAlerts;
      });
    };
    
    // Run immediately
    generateAlerts();
    
    // Set up interval to check periodically (every 5 seconds)
    const interval = setInterval(generateAlerts, 5000);
    
    return () => clearInterval(interval);
  }, []); // Empty dependency array - interval will capture current values
  
  // Quick action handlers
  const handleEmergencyAlert = () => {
    console.log('Sending emergency alert to all stations...');
    // TODO: Implement emergency alert
  };
  
  const handlePauseOrders = () => {
    console.log('Pausing new orders...');
    // TODO: Implement order pausing
  };
  
  const handleRedistributeLoad = () => {
    console.log('Redistributing station load...');
    // TODO: Implement load redistribution
  };
  
  const getAlertIcon = (type) => {
    switch (type) {
      case 'stock': return <Package className="w-5 h-5" />;
      case 'wait': return <Clock className="w-5 h-5" />;
      case 'vip': return <Zap className="w-5 h-5" />;
      case 'group': return <Users className="w-5 h-5" />;
      default: return <AlertCircle className="w-5 h-5" />;
    }
  };
  
  const getAlertColor = (severity) => {
    switch (severity) {
      case 'critical': return 'text-red-600 bg-red-50 border-red-200';
      case 'warning': return 'text-amber-600 bg-amber-50 border-amber-200';
      case 'info': return 'text-blue-600 bg-blue-50 border-blue-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };
  
  const getStationStatusColor = (status, queue) => {
    if (status === 'closed') return 'bg-gray-100 border-gray-300 text-gray-600';
    if (queue > 10) return 'bg-red-100 border-red-300 text-red-700';
    if (queue > 5) return 'bg-amber-100 border-amber-300 text-amber-700';
    if (status === 'available') return 'bg-green-100 border-green-300 text-green-700';
    return 'bg-blue-100 border-blue-300 text-blue-700';
  };
  
  return (
    <div className="space-y-6">
      {/* Critical Alerts Section */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold flex items-center">
            <AlertTriangle className="w-6 h-6 mr-2 text-amber-500" />
            Critical Alerts
          </h2>
          <span className="text-sm text-gray-500">
            {criticalAlerts.filter(a => a.severity === 'critical').length} critical, 
            {' '}{criticalAlerts.filter(a => a.severity === 'warning').length} warnings
          </span>
        </div>
        
        {criticalAlerts.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-500" />
            <p>All systems operating normally</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {criticalAlerts.map(alert => (
              <div 
                key={alert.id}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${getAlertColor(alert.severity)} ${
                  selectedAlert?.id === alert.id ? 'ring-2 ring-offset-2' : ''
                }`}
                onClick={() => setSelectedAlert(alert)}
              >
                <div className="flex items-start space-x-3">
                  {getAlertIcon(alert.type)}
                  <div className="flex-1">
                    <p className="font-medium">{alert.message}</p>
                    <div className="text-sm mt-1 space-x-4">
                      {alert.station && <span>Station {alert.station}</span>}
                      {alert.waitTime && <span>Wait: {alert.waitTime}</span>}
                      {alert.queueLength && <span>Queue: {alert.queueLength}</span>}
                      {alert.timeRemaining && <span>Time left: {alert.timeRemaining}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Station Status Grid */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center">
          <Coffee className="w-6 h-6 mr-2" />
          Station Status
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {stations && Array.isArray(stations) ? stations.map(station => {
            const stationOrders = orders && Array.isArray(orders) 
              ? orders.filter(o => o.station_id === station.id)
              : [];
            const pendingOrders = stationOrders.filter(o => o.status === 'pending').length;
            const inProgressOrders = stationOrders.filter(o => o.status === 'in_progress').length;
            
            return (
              <div 
                key={station.id}
                className={`p-4 rounded-lg border-2 ${getStationStatusColor(station.status, pendingOrders)}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold">{station.name}</h3>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    station.status === 'active' ? 'bg-green-500 text-white' :
                    station.status === 'closed' ? 'bg-gray-500 text-white' :
                    'bg-amber-500 text-white'
                  }`}>
                    {station.status}
                  </span>
                </div>
                
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Queue:</span>
                    <span className="font-medium">{pendingOrders}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>In Progress:</span>
                    <span className="font-medium">{inProgressOrders}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Wait Time:</span>
                    <span className="font-medium">{station.average_wait_time || 0}min</span>
                  </div>
                  {station.current_barista && (
                    <div className="flex justify-between">
                      <span>Barista:</span>
                      <span className="font-medium truncate">{station.current_barista}</span>
                    </div>
                  )}
                </div>
                
                {station.alerts && station.alerts.length > 0 && (
                  <div className="mt-2 pt-2 border-t">
                    {station.alerts.map((alert, idx) => (
                      <div key={idx} className="text-xs text-red-600">
                        • {alert}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }) : (
            <div className="col-span-4 text-center py-8 text-gray-500">
              <Coffee className="w-12 h-12 mx-auto mb-2 text-gray-300" />
              <p>No stations available</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
        
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <button 
            onClick={handleEmergencyAlert}
            className="p-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex flex-col items-center space-y-1"
          >
            <AlertCircle className="w-6 h-6" />
            <span className="text-sm">Emergency Alert</span>
          </button>
          
          <button 
            className="p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex flex-col items-center space-y-1"
          >
            <MessageSquare className="w-6 h-6" />
            <span className="text-sm">Announce</span>
          </button>
          
          <button 
            onClick={handlePauseOrders}
            className="p-3 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors flex flex-col items-center space-y-1"
          >
            <Pause className="w-6 h-6" />
            <span className="text-sm">Pause Orders</span>
          </button>
          
          <button 
            onClick={handleRedistributeLoad}
            className="p-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex flex-col items-center space-y-1"
          >
            <RefreshCw className="w-6 h-6" />
            <span className="text-sm">Redistribute</span>
          </button>
          
          <button 
            className="p-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors flex flex-col items-center space-y-1"
          >
            <MessageSquare className="w-6 h-6" />
            <span className="text-sm">Manual SMS</span>
          </button>
        </div>
      </div>
      
      {/* Recent Orders Stream */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold flex items-center">
            <Activity className="w-6 h-6 mr-2" />
            Recent Orders
          </h2>
          <button 
            onClick={refreshOrders}
            className="text-blue-600 hover:text-blue-700"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="pb-2">Order #</th>
                <th className="pb-2">Customer</th>
                <th className="pb-2">Items</th>
                <th className="pb-2">Station</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {recentOrders.map(order => (
                <tr key={order.id} className="text-sm">
                  <td className="py-2">#{order.id}</td>
                  <td className="py-2">{order.customer_name}</td>
                  <td className="py-2">{order.items?.map(i => i.coffee_type).join(', ') || 'N/A'}</td>
                  <td className="py-2">Station {order.station_id || '-'}</td>
                  <td className="py-2">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      order.status === 'completed' ? 'bg-green-100 text-green-800' :
                      order.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                      order.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="py-2 text-gray-500">
                    {new Date(order.created_at).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LiveOperationsDashboard;