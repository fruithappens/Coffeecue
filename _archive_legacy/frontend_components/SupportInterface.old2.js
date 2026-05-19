import React, { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { 
  Activity, Settings, Server, Database, Shield, AlertTriangle, 
  Clock, Users, Coffee, MessageSquare, Wifi, RefreshCw, HelpCircle,
  Terminal, FileText, Zap, BellOff, Bell, Eye, EyeOff, Rocket,
  BarChart3, Package, UserCheck, ArrowLeft
} from 'lucide-react';

import SupportApiNotificationBanner from './SupportApiNotificationBanner';
import ErrorMonitoring from './ErrorMonitoring';
import useStations from '../hooks/useStations';
import useOrders from '../hooks/useOrders';
import useStock from '../hooks/useStock';
import SettingsService from '../services/SettingsService';

// Lazy load tab components
const DashboardTab = React.lazy(() => import('./support-tabs/DashboardTab'));
const SystemHealthTab = React.lazy(() => import('./support-tabs/SystemHealthTab'));
const CommunicationsTab = React.lazy(() => import('./support-tabs/CommunicationsTab'));
const OperationsTab = React.lazy(() => import('./support-tabs/OperationsTab'));
const UsersAccessTab = React.lazy(() => import('./support-tabs/UsersAccessTab'));
const ConfigurationTab = React.lazy(() => import('./support-tabs/ConfigurationTab'));
const DiagnosticsTab = React.lazy(() => import('./support-tabs/DiagnosticsTab'));
const EmergencyTab = React.lazy(() => import('./support-tabs/EmergencyTab'));

const SupportInterface = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [systemHealth, setSystemHealth] = useState({
    appVersion: '1.2.0',
    lastUpdated: new Date()
  });
  
  const [showNotifications, setShowNotifications] = useState(false);
  
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
  
  // Load system settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await SettingsService.getSettings();
        setSystemSettings(settings);
      } catch (error) {
        console.error('Error loading system settings:', error);
      }
    };
    loadSettings();
  }, []);
  
  // Calculate analytics when data changes
  useEffect(() => {
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
  
  const handleNotificationBell = () => setShowNotifications(!showNotifications);
  
  // Tab configuration
  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3, color: 'bg-indigo-700' },
    { id: 'operations', label: 'Operations', icon: Settings, color: 'bg-indigo-700' },
    { id: 'health', label: 'Health', icon: Activity, color: 'bg-indigo-700' },
    { id: 'communications', label: 'Comms', icon: MessageSquare, color: 'bg-indigo-700' },
    { id: 'users', label: 'Users', icon: Users, color: 'bg-indigo-700' },
    { id: 'config', label: 'Config', icon: Settings, color: 'bg-indigo-700' },
    { id: 'diagnostics', label: 'Diagnose', icon: Terminal, color: 'bg-indigo-700' },
    { id: 'emergency', label: 'Emergency', icon: AlertTriangle, color: 'bg-red-600' }
  ];
  
  // Render tab content based on active tab
  const renderTabContent = () => {
    console.log('Active tab:', activeTab); // Debug log
    switch (activeTab) {
      case 'dashboard':
        return <DashboardTab />;
      case 'health':
        return <SystemHealthTab />;
      case 'communications':
        return <CommunicationsTab />;
      case 'operations':
        return <OperationsTab />;
      case 'users':
        return <UsersAccessTab />;
      case 'config':
        return <ConfigurationTab />;
      case 'diagnostics':
        return <DiagnosticsTab />;
      case 'emergency':
        return <EmergencyTab />;
      default:
        return <DashboardTab />;
    }
  };
  
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar Navigation */}
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
          <div className="text-xs mt-1 font-medium">Support</div>
        </div>
        
        <nav className="flex flex-col items-center space-y-4 flex-grow">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const bgColor = tab.id === 'emergency' ? 
              (isActive ? 'bg-red-700' : 'bg-red-600 hover:bg-red-700') : 
              (isActive ? 'bg-indigo-700' : 'hover:bg-indigo-700');
            
            return (
              <button
                key={tab.id}
                className={`p-3 rounded-xl transition-colors ${bgColor}`}
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
              >
                <Icon size={24} />
                <span className="text-xs mt-1 block">{tab.label}</span>
              </button>
            );
          })}
        </nav>
        
        <button
          onClick={() => setShowNotifications(!showNotifications)}
          className="p-3 rounded-xl hover:bg-indigo-700 relative"
          title="Notifications"
        >
          {showNotifications ? <BellOff size={24} /> : <Bell size={24} />}
          <div className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
        </button>
      </div>
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-white shadow-sm px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              Support Interface - {tabs.find(t => t.id === activeTab)?.label}
            </h1>
            <p className="text-sm text-gray-600">
              System monitoring and management tools
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-600">
              Last update: {systemHealth.lastUpdated.toLocaleTimeString()}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw size={20} />
            </button>
          </div>
        </div>
        
        {/* Tab Content */}
        <div className="flex-1 overflow-auto">
          <ErrorMonitoring>
            <Suspense fallback={
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-indigo-600" />
                  <p className="text-gray-600">Loading...</p>
                </div>
              </div>
            }>
              <div key={activeTab}>
                {renderTabContent()}
              </div>
            </Suspense>
          </ErrorMonitoring>
        </div>
        
        {/* Notifications Panel */}
        {showNotifications && (
          <div className="absolute right-0 top-16 w-96 bg-white shadow-lg rounded-l-lg p-4 max-h-96 overflow-y-auto">
            <h3 className="font-semibold mb-4">System Notifications</h3>
            <div className="space-y-2">
              <div className="p-3 bg-yellow-50 rounded-lg">
                <p className="text-sm font-medium text-yellow-800">High queue at Station 1</p>
                <p className="text-xs text-yellow-600">2 minutes ago</p>
              </div>
              <div className="p-3 bg-red-50 rounded-lg">
                <p className="text-sm font-medium text-red-800">Station 3 offline</p>
                <p className="text-xs text-red-600">5 minutes ago</p>
              </div>
              <div className="p-3 bg-green-50 rounded-lg">
                <p className="text-sm font-medium text-green-800">Backup completed</p>
                <p className="text-xs text-green-600">1 hour ago</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SupportInterface;