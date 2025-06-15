import React, { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { 
  Activity, 
  Settings, 
  Server, 
  Database, 
  Shield, 
  AlertTriangle, 
  Clock, 
  Users, 
  Coffee, 
  MessageSquare, 
  Wifi, 
  RefreshCw,
  HelpCircle,
  Terminal,
  FileText,
  Zap,
  BellOff,
  Bell,
  Eye,
  EyeOff,
  Rocket,
  BarChart3,
  Package,
  UserCheck,
  ArrowLeft
} from 'lucide-react';

import SupportApiNotificationBanner from './SupportApiNotificationBanner';
import ErrorMonitoring from './ErrorMonitoring';
import useStations from '../hooks/useStations';
import useOrders from '../hooks/useOrders';
import useStock from '../hooks/useStock';
import StationsService from '../services/StationsService';
import OrderDataService from '../services/OrderDataService';
import StockService from '../services/StockService';
import SettingsService from '../services/SettingsService';

const SupportInterface = () => {
  const [activeTab, setActiveTab] = useState('liveOps');
  const [systemHealth, setSystemHealth] = useState({
    appVersion: '1.2.0',
    lastUpdated: new Date()
  });
  
  const [activeSubMenu, setActiveSubMenu] = useState('overview');
  const [showNotifications, setShowNotifications] = useState(false);
  const [logFilter, setLogFilter] = useState('all');
  
  // Use real data hooks
  const { stations, loading: stationsLoading } = useStations();
  const { pendingOrders, inProgressOrders, completedOrders } = useOrders();
  const { stockData } = useStock();
  
  // Create ordersData object for backward compatibility - memoized to prevent infinite re-renders
  const ordersData = useMemo(() => ({
    pendingOrders: pendingOrders || [],
    inProgressOrders: inProgressOrders || [],
    completedOrders: completedOrders || []
  }), [pendingOrders, inProgressOrders, completedOrders]);
  const [systemSettings, setSystemSettings] = useState({});
  const [analytics, setAnalytics] = useState({
    totalOrders: 0,
    avgWaitTime: 0,
    completionRate: 0,
    activeStations: 0
  });
  
  // Define functions before useEffect
  const loadSystemSettings = useCallback(async () => {
    try {
      const settings = await SettingsService.getSettings();
      setSystemSettings(settings);
    } catch (error) {
      console.error('Error loading system settings:', error);
    }
  }, []);
  
  const calculateAnalytics = useCallback(() => {
    if (!ordersData || !stations) return;
    
    const allOrders = [
      ...(ordersData.pendingOrders || []),
      ...(ordersData.inProgressOrders || []),
      ...(ordersData.completedOrders || [])
    ];
    
    const totalOrders = allOrders.length;
    const completedOrders = (ordersData.completedOrders || []).length;
    const completionRate = totalOrders > 0 ? (completedOrders / totalOrders * 100).toFixed(0) : 0;
    const activeStations = stations.filter(s => s.status === 'active').length;
    
    // Calculate average wait time
    let totalWaitTime = 0;
    let waitTimeCount = 0;
    allOrders.forEach(order => {
      if (order.waitTime) {
        totalWaitTime += order.waitTime;
        waitTimeCount++;
      }
    });
    const avgWaitTime = waitTimeCount > 0 ? (totalWaitTime / waitTimeCount).toFixed(1) : 0;
    
    setAnalytics({
      totalOrders,
      avgWaitTime,
      completionRate,
      activeStations
    });
  }, [ordersData, stations]);
  
  // Load system settings on mount and when dependencies change
  useEffect(() => {
    loadSystemSettings();
    calculateAnalytics();
  }, [ordersData, stations, loadSystemSettings, calculateAnalytics]);
  
  const formatTime = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const handleNotificationBell = () => setShowNotifications(!showNotifications);
  
  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy': case 'online': case 'stable': case 'active': case 'ok': return 'text-green-500';
      case 'degraded': case 'warning': return 'text-amber-500';
      case 'error': case 'critical': case 'offline': case 'disconnected': case 'inactive': return 'text-red-500';
      case 'maintenance': return 'text-blue-500';
      default: return 'text-gray-500';
    }
  };
  
  // Import the new support tabs
  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return React.lazy(() => import('./support-tabs/DashboardTab'));
      case 'operations':
        return React.lazy(() => import('./support-tabs/OperationsTab'));
      case 'health':
        return React.lazy(() => import('./support-tabs/SystemHealthTab'));
      case 'communications':
        return React.lazy(() => import('./support-tabs/CommunicationsTab'));
      case 'users':
        return React.lazy(() => import('./support-tabs/UsersAccessTab'));
      case 'config':
        return React.lazy(() => import('./support-tabs/ConfigurationTab'));
      case 'diagnostics':
        return React.lazy(() => import('./support-tabs/DiagnosticsTab'));
      case 'emergency':
        return React.lazy(() => import('./support-tabs/EmergencyTab'));
      default:
        return null;
    }
  };
  
  const getLevelBadge = (level) => {
    switch (level) {
      case 'info': return <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">Info</span>;
      case 'warning': return <span className="px-2 py-1 text-xs rounded-full bg-amber-100 text-amber-800">Warning</span>;
      case 'error': return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">Error</span>;
      case 'critical': return <span className="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-800">Critical</span>;
      default: return <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800">{level}</span>;
    }
  };
  
  return (
    <div className="flex h-screen bg-gray-50">
      <div className="w-20 bg-indigo-800 text-white flex flex-col items-center py-6 shadow-lg">
        <button 
          className="mb-4 p-2 rounded hover:bg-indigo-700"
          onClick={() => window.history.back()}
          title="Back to Home"
        >
          <ArrowLeft size={20} />
        </button>
        
        <div className="mb-8">
          <Coffee size={32} className="text-white" />
          <div className="text-xs mt-1 font-medium">CoffeeCue</div>
        </div>
        
        <nav className="flex flex-col items-center space-y-4 flex-grow">
          <button 
            className={`p-3 rounded-xl ${activeTab === 'dashboard' ? 'bg-indigo-700' : 'hover:bg-indigo-700'}`} 
            onClick={() => setActiveTab('dashboard')}
          >
            <BarChart3 size={24} />
            <span className="text-xs mt-1 block">Dashboard</span>
          </button>
          
          <button 
            className={`p-3 rounded-xl ${activeTab === 'operations' ? 'bg-indigo-700' : 'hover:bg-indigo-700'}`} 
            onClick={() => setActiveTab('operations')}
          >
            <Settings size={24} />
            <span className="text-xs mt-1 block">Operations</span>
          </button>
          
          <button 
            className={`p-3 rounded-xl ${activeTab === 'health' ? 'bg-indigo-700' : 'hover:bg-indigo-700'}`} 
            onClick={() => setActiveTab('health')}
          >
            <Activity size={24} />
            <span className="text-xs mt-1 block">Health</span>
          </button>
          
          <button 
            className={`p-3 rounded-xl ${activeTab === 'communications' ? 'bg-indigo-700' : 'hover:bg-indigo-700'}`} 
            onClick={() => setActiveTab('communications')}
          >
            <MessageSquare size={24} />
            <span className="text-xs mt-1 block">Comms</span>
          </button>
          
          <button 
            className={`p-3 rounded-xl ${activeTab === 'users' ? 'bg-indigo-700' : 'hover:bg-indigo-700'}`} 
            onClick={() => setActiveTab('users')}
          >
            <Users size={24} />
            <span className="text-xs mt-1 block">Users</span>
          </button>
          
          <button 
            className={`p-3 rounded-xl ${activeTab === 'config' ? 'bg-indigo-700' : 'hover:bg-indigo-700'}`} 
            onClick={() => setActiveTab('config')}
          >
            <Settings size={24} />
            <span className="text-xs mt-1 block">Config</span>
          </button>
          
          <button 
            className={`p-3 rounded-xl ${activeTab === 'diagnostics' ? 'bg-indigo-700' : 'hover:bg-indigo-700'}`} 
            onClick={() => setActiveTab('diagnostics')}
          >
            <Terminal size={24} />
            <span className="text-xs mt-1 block">Diagnose</span>
          </button>
          
          <button 
            className={`p-3 rounded-xl ${activeTab === 'emergency' ? 'bg-indigo-700' : 'hover:bg-indigo-700'} bg-red-600 hover:bg-red-700`} 
            onClick={() => setActiveTab('emergency')}
          >
            <AlertTriangle size={24} />
            <span className="text-xs mt-1 block">Emergency</span>
          </button>
          
          <button 
            className={`p-3 rounded-xl ${activeTab === 'logs' ? 'bg-indigo-700' : 'hover:bg-indigo-700'}`} 
            onClick={() => setActiveTab('logs')}
          >
            <FileText size={24} />
            <span className="text-xs mt-1 block">Logs</span>
          </button>
          
          <button 
            className={`p-3 rounded-xl ${activeTab === 'stations' ? 'bg-indigo-700' : 'hover:bg-indigo-700'}`} 
            onClick={() => setActiveTab('stations')}
          >
            <Coffee size={24} />
            <span className="text-xs mt-1 block">Stations</span>
          </button>
          
          <button 
            className={`p-3 rounded-xl ${activeTab === 'inventory' ? 'bg-indigo-700' : 'hover:bg-indigo-700'}`} 
            onClick={() => setActiveTab('inventory')}
          >
            <Package size={24} />
            <span className="text-xs mt-1 block">Inventory</span>
          </button>
          
          <button 
            className={`p-3 rounded-xl ${activeTab === 'staff' ? 'bg-indigo-700' : 'hover:bg-indigo-700'}`} 
            onClick={() => setActiveTab('staff')}
          >
            <UserCheck size={24} />
            <span className="text-xs mt-1 block">Staff</span>
          </button>
          
          <button 
            className={`p-3 rounded-xl ${activeTab === 'analytics' ? 'bg-indigo-700' : 'hover:bg-indigo-700'}`} 
            onClick={() => setActiveTab('analytics')}
          >
            <BarChart3 size={24} />
            <span className="text-xs mt-1 block">Analytics</span>
          </button>
          
          <button 
            className={`p-3 rounded-xl ${activeTab === 'settings' ? 'bg-indigo-700' : 'hover:bg-indigo-700'}`} 
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={24} />
            <span className="text-xs mt-1 block">Settings</span>
          </button>
        </nav>
        
        <div className="mt-auto">
          <button 
            className="p-3 rounded-xl hover:bg-indigo-700"
            onClick={() => alert("Support documentation will be available when backend API is implemented.")}
          >
            <HelpCircle size={24} />
            <span className="text-xs mt-1 block">Support</span>
          </button>
        </div>
      </div>
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm border-b px-6 py-3 flex justify-between items-center">
          <div className="flex items-center">
            <h1 className="text-xl font-semibold text-gray-800">
              {activeTab === 'liveOps' && 'Live Operations Center'}
              {activeTab === 'dashboard' && 'System Dashboard'}
              {activeTab === 'monitoring' && 'System Monitoring'}
              {activeTab === 'logs' && 'System Logs'}
              {activeTab === 'stations' && 'Station Management'}
              {activeTab === 'inventory' && 'Inventory Management'}
              {activeTab === 'staff' && 'Staff Management'}
              {activeTab === 'analytics' && 'Analytics & Reports'}
              {activeTab === 'settings' && 'System Settings'}
            </h1>
            <span className="ml-2 px-2 py-1 text-xs rounded-full bg-indigo-100 text-indigo-800">
              v{systemHealth.appVersion}
            </span>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-500">
              Last updated: {formatTime(systemHealth.lastUpdated)}
            </div>
            
            <button 
              className="p-2 rounded-full hover:bg-gray-100"
              onClick={() => window.location.reload()}
            >
              <RefreshCw size={20} className="text-gray-600" />
            </button>
            
            <div className="relative">
              <button 
                className="p-2 rounded-full hover:bg-gray-100 relative"
                onClick={handleNotificationBell}
              >
                <Bell size={20} className="text-gray-600" />
              </button>
              
              {showNotifications && (
                <div className="absolute top-full right-0 mt-1 w-80 bg-white rounded-lg shadow-lg z-10 border">
                  <div className="p-3 border-b flex justify-between items-center">
                    <h3 className="font-medium">Notifications</h3>
                    <button 
                      className="text-xs text-blue-600 hover:text-blue-800"
                      onClick={() => alert("This feature requires backend API implementation.")}
                    >
                      Mark all as read
                    </button>
                  </div>
                  
                  <div className="p-4 text-center text-gray-500">
                    <SupportApiNotificationBanner 
                      title="Notifications API Not Implemented" 
                      message="The notifications API has not been implemented yet. Notifications will appear here when the backend is connected."
                    />
                    No notifications available
                  </div>
                  
                  <div className="p-2 text-center border-t">
                    <button 
                      className="text-sm text-blue-600 hover:text-blue-800"
                      onClick={() => alert("This feature requires backend API implementation.")}
                    >
                      View all notifications
                    </button>
                  </div>
                </div>
              )}
            </div>
            
            <div className="h-6 w-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-medium">
              S
            </div>
          </div>
        </header>
        
        {activeTab === 'liveOps' && (
          <div className="flex-1 overflow-auto p-6">
            {/* Critical Alerts Section */}
            <div className="bg-white rounded-lg shadow-sm border mb-6">
              <div className="border-b px-6 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-800 flex items-center">
                    <AlertTriangle size={20} className="text-red-500 mr-2" />
                    Critical Alerts
                  </h2>
                  <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">3 Active</span>
                </div>
              </div>
              <div className="p-6 space-y-3">
                <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-center">
                    <Package size={16} className="text-red-600 mr-2" />
                    <span className="text-sm font-medium text-red-800">Station 2: Low Oat Milk</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-red-600">47 minutes remaining</span>
                    <button className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">
                      Restock
                    </button>
                  </div>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-center">
                    <Clock size={16} className="text-amber-600 mr-2" />
                    <span className="text-sm font-medium text-amber-800">Station 1: 15+ min wait time</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-amber-600">12 orders in queue</span>
                    <button className="px-2 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700">
                      Redistribute
                    </button>
                  </div>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center">
                    <Users size={16} className="text-blue-600 mr-2" />
                    <span className="text-sm font-medium text-blue-800">Group order #1248 needs VIP station</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-blue-600">5 drinks pending</span>
                    <button className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
                      Assign
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Metrics Row - Using Real Data */}
            <div className="grid grid-cols-4 gap-6 mb-6">
              <div className="bg-white p-4 rounded-lg shadow-sm border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-500">Orders/Hour</h3>
                  <BarChart3 size={20} className="text-green-500" />
                </div>
                <div className="mt-1 font-semibold text-2xl text-green-600">
                  {ordersData ? Math.round(analytics.totalOrders / 8) : '-'}
                </div>
                <div className="mt-2 text-xs text-green-600 flex items-center">
                  <span className="mr-1">Live</span>
                  <span className="text-gray-500">data</span>
                </div>
              </div>
              
              <div className="bg-white p-4 rounded-lg shadow-sm border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-500">Avg Wait Time</h3>
                  <Clock size={20} className="text-amber-500" />
                </div>
                <div className="mt-1 font-semibold text-2xl text-amber-600">
                  {analytics.avgWaitTime} min
                </div>
                <div className="mt-2 text-xs text-amber-600 flex items-center">
                  <span className="mr-1">Live</span>
                  <span className="text-gray-500">average</span>
                </div>
              </div>
              
              <div className="bg-white p-4 rounded-lg shadow-sm border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-500">Completion Rate</h3>
                  <Activity size={20} className="text-green-500" />
                </div>
                <div className="mt-1 font-semibold text-2xl text-green-600">
                  {analytics.completionRate}%
                </div>
                <div className="mt-2 text-xs text-green-600 flex items-center">
                  <span className="mr-1">Live</span>
                  <span className="text-gray-500">rate</span>
                </div>
              </div>
              
              <div className="bg-white p-4 rounded-lg shadow-sm border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-500">Active Stations</h3>
                  <Coffee size={20} className="text-blue-500" />
                </div>
                <div className="mt-1 font-semibold text-2xl text-blue-600">
                  {analytics.activeStations}/{stations.length}
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  {stations.filter(s => s.status !== 'active').length > 0 && 
                    `${stations.filter(s => s.status !== 'active').length} offline`
                  }
                </div>
              </div>
            </div>

            {/* Station Status Grid */}
            <div className="bg-white rounded-lg shadow-sm border mb-6">
              <div className="border-b px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center">
                  <Coffee size={20} className="text-blue-500 mr-2" />
                  Station Status Overview
                </h2>
              </div>
              <div className="p-6">
                {stationsLoading ? (
                  <div className="flex justify-center items-center h-32">
                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent"></div>
                    <span className="ml-2 text-gray-600">Loading stations...</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {stations.map((station) => {
                      // Get station custom name from localStorage or use default
                      const customName = localStorage.getItem(`coffee_station_name_${station.id}`) || station.name || `Station ${station.id}`;
                      const location = localStorage.getItem(`coffee_station_location_${station.id}`) || station.location || '';
                      const baristaName = station.baristaName || localStorage.getItem(`coffee_station_barista_${station.id}`) || 'Unassigned';
                      
                      // Calculate queue size for this station
                      const stationOrders = ordersData ? [
                        ...(ordersData.pendingOrders || []).filter(o => o.stationId === station.id),
                        ...(ordersData.inProgressOrders || []).filter(o => o.stationId === station.id)
                      ] : [];
                      const queueSize = stationOrders.length;
                      
                      // Determine status color and label
                      let statusColor, statusBg, statusLabel, statusIcon;
                      if (station.status !== 'active') {
                        statusColor = 'gray';
                        statusBg = 'bg-gray-50';
                        statusLabel = station.status === 'maintenance' ? 'Maintenance' : 'Offline';
                        statusIcon = '⚫';
                      } else if (queueSize > 10) {
                        statusColor = 'red';
                        statusBg = 'bg-red-50';
                        statusLabel = 'Overload';
                        statusIcon = '🔴';
                      } else if (queueSize > 5) {
                        statusColor = 'amber';
                        statusBg = 'bg-amber-50';
                        statusLabel = 'Busy';
                        statusIcon = '🟡';
                      } else {
                        statusColor = 'green';
                        statusBg = 'bg-green-50';
                        statusLabel = 'Available';
                        statusIcon = '🟢';
                      }
                      
                      // Calculate average wait time
                      const avgWaitTime = queueSize * 3.5; // Rough estimate
                      
                      return (
                        <div key={station.id} className={`border-l-4 border-${statusColor}-500 ${statusBg} p-4 rounded-lg`}>
                          <div className="flex items-center justify-between mb-2">
                            <h3 className={`font-semibold text-${statusColor}-800`}>
                              {customName}{location && `: ${location}`}
                            </h3>
                            <span className={`px-2 py-1 text-xs rounded-full bg-${statusColor}-200 text-${statusColor}-800`}>
                              {statusIcon} {statusLabel}
                            </span>
                          </div>
                          <div className={`text-sm text-${statusColor}-700 mb-2`}>
                            👨‍🍳 {baristaName} | Queue: {queueSize} | Wait: {avgWaitTime.toFixed(0)}min
                          </div>
                          <div className="flex space-x-2">
                            <button 
                              className={`px-3 py-1 text-xs bg-${statusColor}-600 text-white rounded hover:bg-${statusColor}-700`}
                              onClick={() => {
                                // Open station chat
                                alert(`Chat with ${customName} - Feature coming soon`);
                              }}
                            >
                              💬 Chat
                            </button>
                            <button 
                              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                              onClick={() => {
                                // Show station details
                                alert(`Details for ${customName} - Feature coming soon`);
                              }}
                            >
                              📊 Details
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="border-b px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center">
                  <Zap size={20} className="text-purple-500 mr-2" />
                  Quick Actions
                </h2>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-2 gap-4">
                  <button className="flex items-center justify-center p-4 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">
                    <AlertTriangle size={20} className="mr-2" />
                    Emergency Alert All Stations
                  </button>
                  <button className="flex items-center justify-center p-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
                    <MessageSquare size={20} className="mr-2" />
                    Broadcast to All Customers
                  </button>
                  <button className="flex items-center justify-center p-4 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors">
                    <Clock size={20} className="mr-2" />
                    Pause New Orders
                  </button>
                  <button className="flex items-center justify-center p-4 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
                    <RefreshCw size={20} className="mr-2" />
                    Redistribute Load
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'dashboard' && (
          <div className="flex-1 overflow-auto p-6">
            <SupportApiNotificationBanner 
              title="Support Dashboard API Not Implemented" 
              message="The support dashboard API endpoints have not been implemented yet. This section will show real-time system health data when the backend is connected."
            />
            
            <div className="grid grid-cols-4 gap-6 mb-6">
              <div className="bg-white p-4 rounded-lg shadow-sm border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-500">Server Status</h3>
                  <Server size={20} className="text-gray-400" />
                </div>
                <div className="mt-1 font-semibold text-gray-400">
                  Not connected
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Connect to backend API for status
                </div>
              </div>
              
              <div className="bg-white p-4 rounded-lg shadow-sm border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-500">Database Status</h3>
                  <Database size={20} className="text-gray-400" />
                </div>
                <div className="mt-1 font-semibold text-gray-400">
                  Not connected
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Connect to backend API for status
                </div>
              </div>
              
              <div className="bg-white p-4 rounded-lg shadow-sm border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-500">SMS Service</h3>
                  <MessageSquare size={20} className="text-gray-400" />
                </div>
                <div className="mt-1 font-semibold text-gray-400">
                  Not connected
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Connect to backend API for status
                </div>
              </div>
              
              <div className="bg-white p-4 rounded-lg shadow-sm border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-500">WebSocket Status</h3>
                  <Wifi size={20} className="text-gray-400" />
                </div>
                <div className="mt-1 font-semibold text-gray-400">
                  Not connected
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Connect to backend API for status
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-5 gap-6 mb-6">
              <div className="bg-white p-4 rounded-lg shadow-sm border flex flex-col items-center justify-center">
                <div className="text-2xl font-bold text-gray-400">-</div>
                <div className="text-sm text-gray-600">Active Users</div>
              </div>
              
              <div className="bg-white p-4 rounded-lg shadow-sm border flex flex-col items-center justify-center">
                <div className="text-2xl font-bold text-gray-400">-</div>
                <div className="text-sm text-gray-600">Active Baristas</div>
              </div>
              
              <div className="bg-white p-4 rounded-lg shadow-sm border flex flex-col items-center justify-center">
                <div className="text-2xl font-bold text-gray-400">-</div>
                <div className="text-sm text-gray-600">Pending Orders</div>
              </div>
              
              <div className="bg-white p-4 rounded-lg shadow-sm border flex flex-col items-center justify-center">
                <div className="text-2xl font-bold text-gray-400">-</div>
                <div className="text-sm text-gray-600">Completed Today</div>
              </div>
              
              <div className="bg-white p-4 rounded-lg shadow-sm border flex flex-col items-center justify-center">
                <div className="text-2xl font-bold text-gray-400">-</div>
                <div className="text-sm text-gray-600">Failed Orders</div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                <div className="bg-indigo-50 px-4 py-3 border-b">
                  <h2 className="font-medium text-indigo-800">Active Alerts</h2>
                </div>
                
                <div className="p-4 text-center text-gray-500">
                  <SupportApiNotificationBanner 
                    title="Alerts API Not Implemented" 
                    message="The alerts API has not been implemented yet. System alerts will appear here when the backend is connected."
                  />
                  No active alerts data available
                </div>
                
                <div className="bg-gray-50 px-4 py-2 border-t">
                  <button 
                    className="text-sm text-indigo-600 hover:text-indigo-800"
                    onClick={() => alert("This feature requires backend API implementation.")}
                  >
                    View all alerts
                  </button>
                </div>
              </div>
              
              <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                <div className="bg-indigo-50 px-4 py-3 border-b flex justify-between items-center">
                  <h2 className="font-medium text-indigo-800">Recent System Logs</h2>
                  <div className="flex space-x-2">
                    <select 
                      className="text-xs border rounded px-2 py-1"
                      value={logFilter}
                      onChange={(e) => setLogFilter(e.target.value)}
                    >
                      <option value="all">All</option>
                      <option value="info">Info</option>
                      <option value="warning">Warnings</option>
                      <option value="error">Errors</option>
                    </select>
                  </div>
                </div>
                
                <div className="p-4 text-center text-gray-500">
                  <SupportApiNotificationBanner 
                    title="Logs API Not Implemented" 
                    message="The system logs API has not been implemented yet. System logs will appear here when the backend is connected."
                  />
                  No logs data available
                </div>
                
                <div className="bg-gray-50 px-4 py-2 border-t">
                  <button 
                    className="text-sm text-indigo-600 hover:text-indigo-800"
                    onClick={() => setActiveTab('logs')}
                  >
                    View all logs
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'monitoring' && (
          <div className="flex-1 overflow-auto p-6">
            <SupportApiNotificationBanner 
              title="Monitoring API Not Implemented" 
              message="The system monitoring API endpoints have not been implemented yet. This section will show real-time monitoring data when the backend is connected."
            />
            
            <div className="flex border-b mb-6">
              <button 
                className={`px-4 py-2 font-medium ${activeSubMenu === 'overview' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-600 hover:text-indigo-600'}`}
                onClick={() => setActiveSubMenu('overview')}
              >
                Overview
              </button>
              <button 
                className={`px-4 py-2 font-medium ${activeSubMenu === 'services' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-600 hover:text-indigo-600'}`}
                onClick={() => setActiveSubMenu('services')}
              >
                Services
              </button>
              <button 
                className={`px-4 py-2 font-medium ${activeSubMenu === 'errors' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-600 hover:text-indigo-600'}`}
                onClick={() => setActiveSubMenu('errors')}
              >
                Error Monitoring
              </button>
            </div>
            
            {activeSubMenu === 'overview' && (
              <div className="bg-white p-6 rounded-lg shadow-sm border">
                <h2 className="text-lg font-medium mb-4">Monitoring Overview</h2>
                <div className="h-64 flex items-center justify-center text-gray-500">
                  <p>No monitoring data available. Connect to backend API to display system health metrics.</p>
                </div>
              </div>
            )}
            
            {activeSubMenu === 'services' && (
              <div className="bg-white p-6 rounded-lg shadow-sm border">
                <h2 className="text-lg font-medium mb-4">Service Status</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 border rounded">
                    <p>Server: <span className="text-gray-400">Not connected</span></p>
                    <button 
                      onClick={() => alert("This feature requires backend API implementation.")} 
                      className="mt-2 text-sm text-indigo-600 hover:text-indigo-800"
                    >
                      Restart
                    </button>
                  </div>
                  <div className="p-4 border rounded">
                    <p>Database: <span className="text-gray-400">Not connected</span></p>
                    <button 
                      onClick={() => alert("This feature requires backend API implementation.")} 
                      className="mt-2 text-sm text-indigo-600 hover:text-indigo-800"
                    >
                      Restart
                    </button>
                  </div>
                  <div className="p-4 border rounded">
                    <p>SMS Service: <span className="text-gray-400">Not connected</span></p>
                    <button 
                      onClick={() => alert("This feature requires backend API implementation.")} 
                      className="mt-2 text-sm text-indigo-600 hover:text-indigo-800"
                    >
                      Restart
                    </button>
                  </div>
                  <div className="p-4 border rounded">
                    <p>WebSocket: <span className="text-gray-400">Not connected</span></p>
                    <button 
                      onClick={() => alert("This feature requires backend API implementation.")} 
                      className="mt-2 text-sm text-indigo-600 hover:text-indigo-800"
                    >
                      Restart
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {activeSubMenu === 'errors' && (
              <ErrorMonitoring />
            )}
          </div>
        )}
        
        {activeTab === 'logs' && (
          <div className="flex-1 overflow-auto p-6">
            <SupportApiNotificationBanner 
              title="Logs API Not Implemented" 
              message="The system logs API endpoints have not been implemented yet. This section will show log data when the backend is connected."
            />
            
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="p-4 border-b flex justify-between items-center">
                <h2 className="text-lg font-medium">System Logs</h2>
                <select 
                  className="text-sm border rounded px-2 py-1"
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value)}
                >
                  <option value="all">All</option>
                  <option value="info">Info</option>
                  <option value="warning">Warnings</option>
                  <option value="error">Errors</option>
                </select>
              </div>
              <div className="h-96 flex items-center justify-center text-gray-500">
                <p>No logs data available. Connect to backend API to display system logs.</p>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'stations' && (
          <div className="flex-1 overflow-auto p-6">
            <SupportApiNotificationBanner 
              title="Station Management API Not Implemented" 
              message="The station management API endpoints have not been implemented yet. This section will show station data when the backend is connected."
            />
            
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="p-4 border-b">
                <h2 className="text-lg font-medium">Station Management</h2>
              </div>
              <div className="h-96 flex items-center justify-center text-gray-500">
                <p>No station data available. Connect to backend API to display and manage stations.</p>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'inventory' && (
          <div className="flex-1 overflow-auto p-6">
            {/* Inventory Management Content */}
            <div className="mb-6">
              <div className="bg-white rounded-lg shadow-sm border">
                <div className="border-b px-6 py-4">
                  <h2 className="text-lg font-semibold text-gray-800 flex items-center">
                    <Package size={20} className="text-blue-500 mr-2" />
                    Event-Wide Inventory Status
                  </h2>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-3 gap-6">
                    <div className="space-y-4">
                      <h3 className="font-medium text-gray-700">🥛 Milk Products</h3>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded">
                          <span className="text-sm font-medium">Full Cream</span>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-green-600">80% (24L/30L)</div>
                            <div className="text-xs text-green-600">✅ Good</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded">
                          <span className="text-sm font-medium">Oat Milk</span>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-amber-600">60% (12L/20L)</div>
                            <div className="text-xs text-amber-600">🟡 Monitor</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded">
                          <span className="text-sm font-medium">Almond Milk</span>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-red-600">20% (4L/20L)</div>
                            <div className="text-xs text-red-600">🔴 Critical</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <h3 className="font-medium text-gray-700">☕ Coffee Beans</h3>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded">
                          <span className="text-sm font-medium">House Blend</span>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-green-600">85% (8.5kg/10kg)</div>
                            <div className="text-xs text-green-600">✅ Good</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded">
                          <span className="text-sm font-medium">Decaf</span>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-green-600">70% (3.5kg/5kg)</div>
                            <div className="text-xs text-green-600">✅ Good</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <h3 className="font-medium text-gray-700">📏 Cups & Supplies</h3>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded">
                          <span className="text-sm font-medium">Small Cups</span>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-green-600">450/500</div>
                            <div className="text-xs text-green-600">✅ Good</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded">
                          <span className="text-sm font-medium">Large Cups</span>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-amber-600">150/300</div>
                            <div className="text-xs text-amber-600">🟡 Monitor</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Station Distribution */}
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="border-b px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-800">Station Stock Distribution</h2>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-4 gap-4">
                  <div className="border rounded-lg p-4">
                    <h3 className="font-medium text-gray-700 mb-3">Station 1</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Full Cream:</span>
                        <span className="font-medium">8L</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Oat Milk:</span>
                        <span className="font-medium">3L</span>
                      </div>
                      <div className="flex justify-between text-red-600">
                        <span>Almond:</span>
                        <span className="font-medium">1L 🔴</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="border rounded-lg p-4">
                    <h3 className="font-medium text-gray-700 mb-3">Station 2</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Full Cream:</span>
                        <span className="font-medium">6L</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Oat Milk:</span>
                        <span className="font-medium">4L</span>
                      </div>
                      <div className="flex justify-between text-red-600">
                        <span>Almond:</span>
                        <span className="font-medium">1L 🔴</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="border rounded-lg p-4">
                    <h3 className="font-medium text-gray-700 mb-3">Station 3</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Full Cream:</span>
                        <span className="font-medium">5L</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Oat Milk:</span>
                        <span className="font-medium">2L</span>
                      </div>
                      <div className="flex justify-between text-red-600">
                        <span>Almond:</span>
                        <span className="font-medium">1L 🔴</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="border rounded-lg p-4 bg-gray-50">
                    <h3 className="font-medium text-gray-500 mb-3">Station 4 (Closed)</h3>
                    <div className="space-y-2 text-sm text-gray-500">
                      <div>Maintenance Mode</div>
                      <div>Stock Reserved</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'staff' && (
          <div className="flex-1 overflow-auto p-6">
            {/* Current Shift Status */}
            <div className="mb-6">
              <div className="bg-white rounded-lg shadow-sm border">
                <div className="border-b px-6 py-4">
                  <h2 className="text-lg font-semibold text-gray-800 flex items-center">
                    <UserCheck size={20} className="text-green-500 mr-2" />
                    Current Shift Status
                  </h2>
                </div>
                <div className="p-6">
                  {stationsLoading ? (
                    <div className="flex justify-center items-center h-32">
                      <div className="animate-spin rounded-full h-8 w-8 border-2 border-green-500 border-t-transparent"></div>
                      <span className="ml-2 text-gray-600">Loading staff assignments...</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      {stations.map((station) => {
                        // Get station custom name and barista from localStorage
                        const customName = localStorage.getItem(`coffee_station_name_${station.id}`) || station.name || `Station ${station.id}`;
                        const location = localStorage.getItem(`coffee_station_location_${station.id}`) || station.location || '';
                        const baristaName = station.baristaName || localStorage.getItem(`coffee_station_barista_${station.id}`) || 'Unassigned';
                        
                        // Calculate orders for this barista today
                        const todayOrders = ordersData ? [
                          ...(ordersData.completedOrders || []).filter(o => o.stationId === station.id)
                        ] : [];
                        const orderCount = todayOrders.length;
                        
                        // Calculate average time
                        const avgTime = orderCount > 0 ? (todayOrders.reduce((sum, o) => sum + (o.completionTime || 240), 0) / orderCount / 60).toFixed(1) : 0;
                        
                        // Determine status
                        let statusColor, statusBg, statusLabel, statusIcon;
                        if (station.status !== 'active') {
                          statusColor = 'gray';
                          statusBg = 'bg-gray-50';
                          statusLabel = 'Offline';
                          statusIcon = '⚫';
                        } else if (baristaName === 'Unassigned') {
                          statusColor = 'gray';
                          statusBg = 'bg-gray-50';
                          statusLabel = 'Unstaffed';
                          statusIcon = '⚫';
                        } else {
                          statusColor = 'green';
                          statusBg = 'bg-green-50';
                          statusLabel = 'Active';
                          statusIcon = '🟢';
                        }
                        
                        return (
                          <div key={station.id} className={`border-l-4 border-${statusColor}-500 ${statusBg} p-4 rounded-lg`}>
                            <div className="flex items-center justify-between mb-2">
                              <h3 className={`font-semibold text-${statusColor}-800`}>
                                {baristaName !== 'Unassigned' ? baristaName : customName}
                              </h3>
                              <span className={`px-2 py-1 text-xs rounded-full bg-${statusColor}-200 text-${statusColor}-800`}>
                                {statusIcon} {statusLabel}
                              </span>
                            </div>
                            <div className={`text-sm text-${statusColor}-700 space-y-1`}>
                              <div>📍 {customName}{location && ` - ${location}`}</div>
                              {baristaName !== 'Unassigned' && (
                                <>
                                  <div>☕ {orderCount} orders today | ⏱️ Avg: {avgTime}min</div>
                                  <div>⭐ Active shift</div>
                                </>
                              )}
                              {baristaName === 'Unassigned' && (
                                <div>🔧 No barista assigned</div>
                              )}
                            </div>
                            {baristaName !== 'Unassigned' && (
                              <div className="flex space-x-2 mt-3">
                                <button 
                                  className={`px-3 py-1 text-xs bg-${statusColor}-600 text-white rounded hover:bg-${statusColor}-700`}
                                  onClick={() => alert(`Chat with ${baristaName} - Feature coming soon`)}
                                >
                                  💬 Message
                                </button>
                                <button 
                                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                                  onClick={() => alert(`Performance details for ${baristaName} - Feature coming soon`)}
                                >
                                  📊 Performance
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Today's Schedule */}
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="border-b px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-800">Today's Schedule</h2>
              </div>
              <div className="p-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded">
                    <div>
                      <span className="font-medium">08:00-12:00:</span>
                      <span className="ml-2">John (Station 1), Sarah (Station 2)</span>
                    </div>
                    <span className="text-sm text-blue-600">Morning Shift</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded">
                    <div>
                      <span className="font-medium">12:00-16:00:</span>
                      <span className="ml-2">Sarah (Station 2), Mike (Station 3)</span>
                    </div>
                    <span className="text-sm text-green-600">Afternoon Shift</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-purple-50 border border-purple-200 rounded">
                    <div>
                      <span className="font-medium">16:00-18:00:</span>
                      <span className="ml-2">Mike (Station 3), Emma (VIP Station)</span>
                    </div>
                    <span className="text-sm text-purple-600">Evening VIP</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'analytics' && (
          <div className="flex-1 overflow-auto p-6">
            {/* Key Performance Indicators */}
            <div className="mb-6">
              <div className="bg-white rounded-lg shadow-sm border">
                <div className="border-b px-6 py-4">
                  <h2 className="text-lg font-semibold text-gray-800 flex items-center">
                    <BarChart3 size={20} className="text-purple-500 mr-2" />
                    Today's Performance Analytics
                  </h2>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-4 gap-6 mb-6">
                    <div className="text-center">
                      <div className="text-3xl font-bold text-green-600">312</div>
                      <div className="text-sm text-gray-500">Total Orders</div>
                      <div className="text-xs text-green-600">+15% vs yesterday</div>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-blue-600">$1,872</div>
                      <div className="text-sm text-gray-500">Revenue</div>
                      <div className="text-xs text-blue-600">+12% vs target</div>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-amber-600">4.8/5</div>
                      <div className="text-sm text-gray-500">Satisfaction</div>
                      <div className="text-xs text-amber-600">89 reviews</div>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-purple-600">94%</div>
                      <div className="text-sm text-gray-500">Efficiency</div>
                      <div className="text-xs text-purple-600">+2% improvement</div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <h3 className="font-medium text-gray-700 mb-3">Peak Hours Analysis</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center p-2 bg-red-50 rounded">
                          <span className="text-sm">10:30-11:00 AM</span>
                          <span className="font-medium text-red-600">67 orders (PEAK)</span>
                        </div>
                        <div className="flex justify-between items-center p-2 bg-amber-50 rounded">
                          <span className="text-sm">14:00-14:30 PM</span>
                          <span className="font-medium text-amber-600">45 orders</span>
                        </div>
                        <div className="flex justify-between items-center p-2 bg-blue-50 rounded">
                          <span className="text-sm">16:30-17:00 PM</span>
                          <span className="font-medium text-blue-600">38 orders</span>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="font-medium text-gray-700 mb-3">Popular Items</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center p-2 bg-green-50 rounded">
                          <span className="text-sm">Oat Latte</span>
                          <span className="font-medium text-green-600">34% (106 orders)</span>
                        </div>
                        <div className="flex justify-between items-center p-2 bg-blue-50 rounded">
                          <span className="text-sm">Cappuccino</span>
                          <span className="font-medium text-blue-600">28% (87 orders)</span>
                        </div>
                        <div className="flex justify-between items-center p-2 bg-purple-50 rounded">
                          <span className="text-sm">Flat White</span>
                          <span className="font-medium text-purple-600">22% (69 orders)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Station Performance Comparison */}
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="border-b px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-800">Station Performance</h2>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="border rounded-lg p-4">
                    <h3 className="font-medium text-gray-700 mb-3">Station 1 (John)</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Orders:</span>
                        <span className="font-medium">47</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Avg Time:</span>
                        <span className="font-medium text-green-600">4.2min</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Rating:</span>
                        <span className="font-medium">4.8/5</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="border rounded-lg p-4">
                    <h3 className="font-medium text-gray-700 mb-3">Station 2 (Sarah)</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Orders:</span>
                        <span className="font-medium">38</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Avg Time:</span>
                        <span className="font-medium text-amber-600">5.1min</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Rating:</span>
                        <span className="font-medium">4.6/5</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="border rounded-lg p-4">
                    <h3 className="font-medium text-gray-700 mb-3">Station 3 (Mike)</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Orders:</span>
                        <span className="font-medium">23</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Avg Time:</span>
                        <span className="font-medium text-green-600">3.8min</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Rating:</span>
                        <span className="font-medium">4.9/5</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'settings' && (
          <div className="flex-1 overflow-auto p-6">
            <SupportApiNotificationBanner 
              title="Settings API Not Implemented" 
              message="The system settings API endpoints have not been implemented yet. This section will allow changing settings when the backend is connected."
            />
            
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="p-4 border-b">
                <h2 className="text-lg font-medium">System Settings</h2>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span>Notifications Enabled</span>
                    <button 
                      onClick={() => alert("This feature requires backend API implementation.")}
                      className="p-2 bg-gray-100 rounded"
                    >
                      <Bell size={20} className="text-gray-400" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Alert Sound Enabled</span>
                    <button 
                      onClick={() => alert("This feature requires backend API implementation.")}
                      className="p-2 bg-gray-100 rounded"
                    >
                      <Bell size={20} className="text-gray-400" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Debug Mode</span>
                    <button 
                      onClick={() => alert("This feature requires backend API implementation.")}
                      className="p-2 bg-gray-100 rounded"
                    >
                      <Eye size={20} className="text-gray-400" />
                    </button>
                  </div>
                  
                  <div className="mt-6 pt-6 border-t">
                    <div className="flex items-center">
                      <span className="font-medium">Data Retention Period</span>
                      <select 
                        className="ml-4 border rounded p-2 bg-gray-100 text-gray-400"
                        disabled
                        onClick={() => alert("This feature requires backend API implementation.")}
                      >
                        <option>7 days</option>
                        <option>14 days</option>
                        <option>30 days</option>
                        <option>90 days</option>
                      </select>
                    </div>
                  </div>
                  
                  <div className="mt-6 pt-6 border-t">
                    <button 
                      className="px-4 py-2 bg-indigo-100 text-indigo-400 rounded font-medium cursor-not-allowed"
                      onClick={() => alert("This feature requires backend API implementation.")}
                    >
                      Save Settings
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SupportInterface;