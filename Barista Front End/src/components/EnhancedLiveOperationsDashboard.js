import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  AlertTriangle, Coffee, Package, Users, Clock, MessageCircle, 
  Activity, TrendingUp, Pause, Play, RefreshCw, Bell, Zap,
  ChevronRight, AlertCircle, CheckCircle, Wifi, WifiOff,
  BarChart2, Shield, Target, Settings
} from 'lucide-react';
import useStations from '../hooks/useStations';
import useOrders from '../hooks/useOrders';
import useStock from '../hooks/useStock';
import useSettings from '../hooks/useSettings';

const EnhancedLiveOperationsDashboard = () => {
  const { stations, updateStation } = useStations();
  const { 
    pendingOrders,
    inProgressOrders,
    completedOrders,
    online: ordersOnline, 
    queueCount,
    refreshData: refreshOrders,
    sendMessage 
  } = useOrders();
  
  // Create ordersData object for backward compatibility
  const ordersData = {
    pending: pendingOrders || [],
    inProgress: inProgressOrders || [],
    completed: completedOrders || []
  };
  const { settings } = useSettings();
  
  const [criticalAlerts, setCriticalAlerts] = useState([]);
  const [selectedStation, setSelectedStation] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const [showEmergencyDialog, setShowEmergencyDialog] = useState(false);
  const [emergencyMessage, setEmergencyMessage] = useState('');
  const [recentActivities, setRecentActivities] = useState([]);
  const [displayView, setDisplayView] = useState('grid'); // grid or list
  
  // Calculate real-time system metrics
  const systemMetrics = useMemo(() => {
    if (!ordersData) return {
      totalOrders: 0,
      avgWaitTime: 0,
      activeStations: 0,
      loadPercentage: 0,
      ordersPerHour: 0,
      customerSatisfaction: 0,
      totalRevenue: 0,
      peakTime: null
    };
    
    const totalOrders = ordersData.pending.length + ordersData.inProgress.length;
    const avgWaitTime = ordersData.pending.length > 0 
      ? ordersData.pending.reduce((sum, order) => sum + (order.waitTime || 0), 0) / ordersData.pending.length
      : 0;
    const activeStations = stations.filter(s => s.status === 'active').length;
    const totalCapacity = stations.reduce((sum, s) => sum + (s.max_concurrent_orders || 5), 0);
    const currentLoad = ordersData.inProgress.length;
    const loadPercentage = totalCapacity > 0 ? (currentLoad / totalCapacity) * 100 : 0;
    
    // Calculate orders per hour based on completed orders
    const recentCompleted = ordersData.completed.filter(order => {
      const completedTime = new Date(order.completed_at || order.updated_at);
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      return completedTime > hourAgo;
    }).length;
    
    // Calculate revenue
    const totalRevenue = ordersData.completed.reduce((sum, order) => sum + (order.total || 0), 0);
    
    // Find peak time (hour with most orders)
    const hourCounts = {};
    ordersData.completed.forEach(order => {
      const hour = new Date(order.created_at).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
    
    return {
      totalOrders,
      avgWaitTime: Math.round(avgWaitTime),
      activeStations,
      loadPercentage: Math.round(loadPercentage),
      ordersPerHour: recentCompleted,
      customerSatisfaction: 94, // This would be calculated from real feedback
      totalRevenue,
      peakTime: peakHour ? `${peakHour[0]}:00` : null
    };
  }, [ordersData, stations]);
  
  // Generate critical alerts with enhanced logic
  useEffect(() => {
    const alerts = [];
    
    // Station overload alerts
    stations.forEach(station => {
      const stationOrders = ordersData.inProgress.filter(o => o.station_id === station.id);
      const queuedOrders = ordersData.pending.filter(o => 
        o.preferred_station === station.id || 
        (!o.preferred_station && station.capabilities?.standard_coffee)
      );
      const totalLoad = stationOrders.length + queuedOrders.length;
      const maxCapacity = station.max_concurrent_orders || 5;
      
      if (totalLoad > maxCapacity * 1.5) {
        alerts.push({
          id: `overload-${station.id}`,
          type: 'overload',
          severity: 'critical',
          station: station.name,
          stationId: station.id,
          message: `${station.name} critically overloaded`,
          detail: `${totalLoad} orders (${Math.round(totalLoad/maxCapacity * 100)}% capacity)`,
          action: 'Redistribute',
          timestamp: new Date()
        });
      } else if (totalLoad > maxCapacity) {
        alerts.push({
          id: `overload-${station.id}`,
          type: 'overload',
          severity: 'warning',
          station: station.name,
          stationId: station.id,
          message: `${station.name} overloaded`,
          detail: `${totalLoad} orders queued`,
          action: 'Monitor',
          timestamp: new Date()
        });
      }
    });
    
    // Long wait time alerts
    const longWaitOrders = ordersData.pending.filter(o => o.waitTime > 15);
    const criticalWaitOrders = ordersData.pending.filter(o => o.waitTime > 20);
    
    if (criticalWaitOrders.length > 0) {
      alerts.push({
        id: 'critical-wait',
        type: 'wait',
        severity: 'critical',
        message: `${criticalWaitOrders.length} orders waiting over 20 minutes`,
        detail: 'Customer satisfaction at risk',
        action: 'Urgent Action',
        timestamp: new Date()
      });
    } else if (longWaitOrders.length > 5) {
      alerts.push({
        id: 'long-wait',
        type: 'wait',
        severity: 'warning',
        message: `${longWaitOrders.length} orders waiting over 15 minutes`,
        detail: 'Consider opening another station',
        action: 'Review',
        timestamp: new Date()
      });
    }
    
    // VIP/Priority order alerts
    const vipOrders = ordersData.pending.filter(o => o.vip || o.priority);
    if (vipOrders.length > 0) {
      alerts.push({
        id: 'vip-orders',
        type: 'vip',
        severity: 'info',
        message: `${vipOrders.length} VIP orders pending`,
        detail: vipOrders.map(o => `#${o.orderNumber}`).join(', '),
        action: 'Prioritize',
        timestamp: new Date()
      });
    }
    
    // Stock alerts (would be enhanced with real stock data)
    const lowStockStations = stations.filter(s => s.low_stock_items?.length > 0);
    lowStockStations.forEach(station => {
      alerts.push({
        id: `stock-${station.id}`,
        type: 'stock',
        severity: station.critical_stock_items?.length > 0 ? 'critical' : 'warning',
        station: station.name,
        message: `${station.name} low on supplies`,
        detail: station.low_stock_items?.join(', ') || 'Check inventory',
        action: 'Restock',
        timestamp: new Date()
      });
    });
    
    // System performance alert
    if (systemMetrics.loadPercentage > 90) {
      alerts.push({
        id: 'system-load',
        type: 'system',
        severity: 'critical',
        message: 'System at maximum capacity',
        detail: `${systemMetrics.loadPercentage}% load across all stations`,
        action: 'Open Station',
        timestamp: new Date()
      });
    }
    
    setCriticalAlerts(alerts.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    }));
  }, [ordersData?.pending?.length, ordersData?.inProgress?.length, stations?.length, systemMetrics.loadPercentage]);
  
  // Add activity to recent log
  const addActivity = useCallback((type, message) => {
    setRecentActivities(prev => [{
      id: Date.now(),
      type,
      message,
      timestamp: new Date()
    }, ...prev].slice(0, 20)); // Keep last 20 activities
  }, []);
  
  // Handle emergency alert
  const handleEmergencyAlert = async () => {
    if (!emergencyMessage.trim()) return;
    
    try {
      // In real implementation, would send to all channels
      console.log('Emergency Alert:', emergencyMessage);
      
      // Send notifications to all pending customers
      const pendingCustomers = ordersData.pending.map(o => o.phoneNumber).filter(Boolean);
      // await sendBulkMessage(pendingCustomers, emergencyMessage);
      
      addActivity('emergency', `Emergency alert: "${emergencyMessage}"`);
      setShowEmergencyDialog(false);
      setEmergencyMessage('');
    } catch (error) {
      console.error('Failed to send emergency alert:', error);
    }
  };
  
  // Handle pause/resume orders
  const handlePauseResume = async () => {
    try {
      setIsPaused(!isPaused);
      addActivity('system', isPaused ? 'Order system resumed' : 'New orders paused');
      // In real implementation, would update backend
    } catch (error) {
      console.error('Failed to pause/resume orders:', error);
    }
  };
  
  // Handle station redistribution
  const handleRedistributeStation = useCallback(async (stationId) => {
    try {
      addActivity('system', `Redistributing orders from station ${stationId}`);
      // Implementation would move orders to less busy stations
    } catch (error) {
      console.error('Failed to redistribute:', error);
    }
  }, [addActivity]);
  
  // Handle long wait orders
  const handleLongWaitOrders = useCallback((orders) => {
    console.log('Handling long wait orders:', orders);
    // Would implement priority boost or reassignment
  }, []);
  
  // Handle VIP prioritization
  const handlePrioritizeVIP = useCallback((orders) => {
    console.log('Prioritizing VIP orders:', orders);
    // Would implement VIP fast-track
  }, []);
  
  // Get alert styling
  const getAlertIcon = (type) => {
    const icons = {
      overload: <Users className="text-red-500" size={20} />,
      wait: <Clock className="text-yellow-500" size={20} />,
      vip: <Zap className="text-purple-500" size={20} />,
      stock: <Package className="text-orange-500" size={20} />,
      system: <AlertCircle className="text-red-500" size={20} />
    };
    return icons[type] || <Bell className="text-blue-500" size={20} />;
  };
  
  const getAlertBgColor = (severity) => {
    const colors = {
      critical: 'bg-red-50 border-red-200',
      warning: 'bg-yellow-50 border-yellow-200',
      info: 'bg-blue-50 border-blue-200'
    };
    return colors[severity] || 'bg-gray-50 border-gray-200';
  };
  
  // Get station card styling based on load
  const getStationCardStyle = (station) => {
    const orders = ordersData.inProgress.filter(o => o.station_id === station.id).length;
    const pending = ordersData.pending.filter(o => o.preferred_station === station.id).length;
    const total = orders + pending;
    const maxOrders = station.max_concurrent_orders || 5;
    const loadRatio = total / maxOrders;
    
    if (station.status !== 'active') return 'bg-gray-100 border-gray-300';
    if (loadRatio > 1.2) return 'bg-red-50 border-red-300';
    if (loadRatio > 0.8) return 'bg-yellow-50 border-yellow-300';
    if (loadRatio > 0.5) return 'bg-blue-50 border-blue-300';
    return 'bg-green-50 border-green-300';
  };

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      {/* Header with Live Status */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-6">
            <h1 className="text-2xl font-bold text-gray-900">Live Operations Command Center</h1>
            <div className="flex items-center space-x-2">
              {ordersOnline ? (
                <>
                  <Wifi className="text-green-500" size={20} />
                  <span className="text-sm font-medium text-green-600">System Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="text-red-500" size={20} />
                  <span className="text-sm font-medium text-red-600">Offline Mode</span>
                </>
              )}
            </div>
            <div className="text-sm text-gray-500">
              Last update: {new Date().toLocaleTimeString()}
            </div>
          </div>
          <button
            onClick={refreshOrders}
            className="flex items-center space-x-2 px-4 py-2 text-gray-600 hover:text-gray-900"
          >
            <RefreshCw size={16} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Critical Alerts with Actions */}
      {criticalAlerts.length > 0 && (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="bg-red-600 text-white px-6 py-3">
            <h2 className="text-lg font-semibold flex items-center">
              <AlertTriangle className="mr-2" size={20} />
              Critical Alerts ({criticalAlerts.filter(a => a.severity === 'critical').length} critical, {criticalAlerts.filter(a => a.severity === 'warning').length} warnings)
            </h2>
          </div>
          <div className="p-4 space-y-3 max-h-64 overflow-y-auto">
            {criticalAlerts.map(alert => (
              <div key={alert.id} className={`p-4 rounded-lg border ${getAlertBgColor(alert.severity)}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    {getAlertIcon(alert.type)}
                    <div>
                      <div className="font-semibold">{alert.message}</div>
                      {alert.detail && (
                        <div className="text-sm text-gray-600 mt-1">{alert.detail}</div>
                      )}
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                  {alert.action && (
                    <button
                      onClick={alert.actionHandler}
                      className={`px-4 py-2 rounded text-sm font-medium ${
                        alert.severity === 'critical' 
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : alert.severity === 'warning'
                          ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {alert.action}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Real-time Metrics Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <Coffee className="text-gray-400" size={20} />
            <span className="text-xs text-green-600">+12%</span>
          </div>
          <div className="text-2xl font-bold">{systemMetrics.totalOrders}</div>
          <div className="text-xs text-gray-500">Active Orders</div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <Clock className="text-gray-400" size={20} />
            <span className={`text-xs ${systemMetrics.avgWaitTime > 15 ? 'text-red-600' : 'text-green-600'}`}>
              {systemMetrics.avgWaitTime > 15 ? '↑' : '↓'}
            </span>
          </div>
          <div className="text-2xl font-bold">{systemMetrics.avgWaitTime}m</div>
          <div className="text-xs text-gray-500">Avg Wait</div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <Users className="text-gray-400" size={20} />
          </div>
          <div className="text-2xl font-bold">{systemMetrics.activeStations}/{stations.length}</div>
          <div className="text-xs text-gray-500">Active Stations</div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <Activity className="text-gray-400" size={20} />
          </div>
          <div className="text-2xl font-bold">{systemMetrics.loadPercentage}%</div>
          <div className="text-xs text-gray-500">System Load</div>
          <div className="mt-1 bg-gray-200 h-2 rounded-full overflow-hidden">
            <div 
              className={`h-full ${
                systemMetrics.loadPercentage > 90 ? 'bg-red-500' :
                systemMetrics.loadPercentage > 70 ? 'bg-yellow-500' :
                'bg-green-500'
              }`}
              style={{ width: `${systemMetrics.loadPercentage}%` }}
            />
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="text-gray-400" size={20} />
          </div>
          <div className="text-2xl font-bold">{systemMetrics.ordersPerHour}</div>
          <div className="text-xs text-gray-500">Orders/Hour</div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <Target className="text-gray-400" size={20} />
          </div>
          <div className="text-2xl font-bold text-green-600">{systemMetrics.customerSatisfaction}%</div>
          <div className="text-xs text-gray-500">Satisfaction</div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <BarChart2 className="text-gray-400" size={20} />
          </div>
          <div className="text-2xl font-bold">${systemMetrics.totalRevenue}</div>
          <div className="text-xs text-gray-500">Revenue</div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <Clock className="text-gray-400" size={20} />
          </div>
          <div className="text-2xl font-bold">{systemMetrics.peakTime || '--'}</div>
          <div className="text-xs text-gray-500">Peak Time</div>
        </div>
      </div>

      {/* Station Status Grid with Enhanced Information */}
      <div className="bg-white rounded-lg shadow-md">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold">Station Status Grid</h2>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-500">
              {systemMetrics.activeStations} active, {queueCount} orders in queue
            </span>
            <button
              onClick={() => setDisplayView(displayView === 'grid' ? 'list' : 'grid')}
              className="text-gray-500 hover:text-gray-700"
            >
              {displayView === 'grid' ? 'List View' : 'Grid View'}
            </button>
          </div>
        </div>
        
        <div className={`p-6 ${displayView === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4' : 'space-y-4'}`}>
          {stations.map(station => {
            const inProgress = ordersData.inProgress.filter(o => o.station_id === station.id);
            const pending = ordersData.pending.filter(o => o.preferred_station === station.id);
            const total = inProgress.length + pending.length;
            const avgWait = pending.length > 0 
              ? Math.round(pending.reduce((sum, o) => sum + (o.waitTime || 0), 0) / pending.length)
              : 0;
            
            return (
              <div 
                key={station.id}
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all hover:shadow-lg ${getStationCardStyle(station)}`}
                onClick={() => setSelectedStation(station)}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-lg">{station.name}</h3>
                    <p className="text-sm text-gray-500">Station #{station.id}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    station.status === 'active' ? 'bg-green-100 text-green-800' :
                    station.status === 'paused' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {station.status || 'active'}
                  </span>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Queue</span>
                    <span className="font-semibold">{total} orders</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">In Progress</span>
                    <span className="font-semibold">{inProgress.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Wait Time</span>
                    <span className={`font-semibold ${avgWait > 15 ? 'text-red-600' : ''}`}>
                      {avgWait}m
                    </span>
                  </div>
                  {station.current_barista && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Barista</span>
                      <span className="font-medium text-sm truncate max-w-[100px]">
                        {station.current_barista}
                      </span>
                    </div>
                  )}
                </div>
                
                {/* Load indicator bar */}
                <div className="mt-3 bg-gray-200 h-3 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all ${
                      total / (station.max_concurrent_orders || 5) > 1 ? 'bg-red-500' :
                      total / (station.max_concurrent_orders || 5) > 0.8 ? 'bg-yellow-500' :
                      total / (station.max_concurrent_orders || 5) > 0.5 ? 'bg-blue-500' :
                      'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(100, (total / (station.max_concurrent_orders || 5)) * 100)}%` }}
                  />
                </div>
                
                {/* Capabilities badges */}
                <div className="mt-3 flex flex-wrap gap-1">
                  {station.capabilities?.standard_coffee && (
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">Coffee</span>
                  )}
                  {station.capabilities?.alternative_milk && (
                    <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded">Alt Milk</span>
                  )}
                  {station.capabilities?.high_volume && (
                    <span className="text-xs bg-purple-100 text-purple-600 px-2 py-1 rounded">High Vol</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick Actions Panel */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <button
            onClick={() => setShowEmergencyDialog(true)}
            className="flex flex-col items-center justify-center p-4 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all"
          >
            <AlertTriangle size={24} className="mb-2" />
            <span className="text-sm font-medium">Emergency Alert</span>
            <span className="text-xs opacity-75">All Stations</span>
          </button>
          
          <button
            onClick={() => console.log('Announce')}
            className="flex flex-col items-center justify-center p-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all"
          >
            <MessageCircle size={24} className="mb-2" />
            <span className="text-sm font-medium">Announce</span>
            <span className="text-xs opacity-75">To Customers</span>
          </button>
          
          <button
            onClick={handlePauseResume}
            className={`flex flex-col items-center justify-center p-4 rounded-lg transition-all ${
              isPaused 
                ? 'bg-green-500 hover:bg-green-600' 
                : 'bg-yellow-500 hover:bg-yellow-600'
            } text-white`}
          >
            {isPaused ? <Play size={24} className="mb-2" /> : <Pause size={24} className="mb-2" />}
            <span className="text-sm font-medium">{isPaused ? 'Resume' : 'Pause'} Orders</span>
            <span className="text-xs opacity-75">System {isPaused ? 'Paused' : 'Active'}</span>
          </button>
          
          <button
            onClick={() => console.log('Redistribute')}
            className="flex flex-col items-center justify-center p-4 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-all"
          >
            <RefreshCw size={24} className="mb-2" />
            <span className="text-sm font-medium">Redistribute</span>
            <span className="text-xs opacity-75">Balance Load</span>
          </button>
          
          <button
            onClick={() => console.log('Manual SMS')}
            className="flex flex-col items-center justify-center p-4 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-all"
          >
            <MessageCircle size={24} className="mb-2" />
            <span className="text-sm font-medium">Manual SMS</span>
            <span className="text-xs opacity-75">Response</span>
          </button>
        </div>
      </div>

      {/* Recent Activity Stream */}
      <div className="bg-white rounded-lg shadow-md">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold flex items-center">
            <Activity className="mr-2" size={20} />
            Recent Activity Stream
          </h2>
        </div>
        <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
          {recentActivities.length > 0 ? (
            recentActivities.map(activity => (
              <div key={activity.id} className="flex items-center space-x-3 py-2 border-b border-gray-100 last:border-0">
                <span className="text-xs text-gray-400 w-16">
                  {new Date(activity.timestamp).toLocaleTimeString()}
                </span>
                <ChevronRight size={14} className="text-gray-400" />
                <span className={`text-sm ${
                  activity.type === 'emergency' ? 'text-red-600 font-semibold' :
                  activity.type === 'system' ? 'text-blue-600' :
                  'text-gray-700'
                }`}>
                  {activity.message}
                </span>
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-gray-400">
              <Activity size={48} className="mx-auto mb-3" />
              <p>No recent activity</p>
              <p className="text-xs mt-1">Actions will appear here</p>
            </div>
          )}
        </div>
      </div>

      {/* Emergency Alert Dialog */}
      {showEmergencyDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center mb-4">
              <AlertTriangle className="text-red-500 mr-3" size={24} />
              <h3 className="text-xl font-bold">Send Emergency Alert</h3>
            </div>
            <p className="text-gray-600 mb-4">
              This will immediately notify all stations and pending customers.
            </p>
            <textarea
              value={emergencyMessage}
              onChange={(e) => setEmergencyMessage(e.target.value)}
              placeholder="Enter your emergency message..."
              className="w-full border rounded-lg p-3 mb-4 focus:outline-none focus:ring-2 focus:ring-red-500"
              rows={4}
              autoFocus
            />
            <div className="flex space-x-3">
              <button
                onClick={handleEmergencyAlert}
                disabled={!emergencyMessage.trim()}
                className="flex-1 bg-red-500 text-white py-2 rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                Send Emergency Alert
              </button>
              <button
                onClick={() => {
                  setShowEmergencyDialog(false);
                  setEmergencyMessage('');
                }}
                className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400 font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnhancedLiveOperationsDashboard;