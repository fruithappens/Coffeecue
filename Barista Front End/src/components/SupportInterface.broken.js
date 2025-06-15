import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import { 
  Activity, Settings, Server, Database, Shield, AlertTriangle, 
  Clock, Users, Coffee, MessageSquare, Wifi, RefreshCw, HelpCircle,
  Terminal, FileText, Zap, BellOff, Bell, Eye, EyeOff, Rocket,
  BarChart3, Package, UserCheck, ArrowLeft
} from 'lucide-react';

import ErrorMonitoring from './ErrorMonitoring';
import useStations from '../hooks/useStations';
import useOrders from '../hooks/useOrders';
import useStock from '../hooks/useStock';
import SettingsService from '../services/SettingsService';

// Lazy load tab components
const DashboardTab = lazy(() => import('./support-tabs/DashboardTab'));
const SystemHealthTab = lazy(() => import('./support-tabs/SystemHealthTab'));
const CommunicationsTab = lazy(() => import('./support-tabs/CommunicationsTab'));
const OperationsTab = lazy(() => import('./support-tabs/OperationsTab'));
const UsersAccessTab = lazy(() => import('./support-tabs/UsersAccessTab'));
const ConfigurationTab = lazy(() => import('./support-tabs/ConfigurationTab'));
const DiagnosticsTab = lazy(() => import('./support-tabs/DiagnosticsTab'));
const EmergencyTab = lazy(() => import('./support-tabs/EmergencyTab'));

const SupportInterface = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showNotifications, setShowNotifications] = useState(false);
  const [systemSettings, setSystemSettings] = useState({});
  const [systemHealth, setSystemHealth] = useState({
    appVersion: '1.2.0',
    lastUpdated: new Date()
  });
  
  // Use real data hooks
  const { stations, loading: stationsLoading } = useStations();
  const { pendingOrders, inProgressOrders, completedOrders } = useOrders();
  const { stockData } = useStock();
  
  // Load system settings on mount
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

  // Tab configuration
  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3, component: DashboardTab },
    { id: 'operations', label: 'Operations', icon: Settings, component: OperationsTab },
    { id: 'health', label: 'Health', icon: Activity, component: SystemHealthTab },
    { id: 'communications', label: 'Comms', icon: MessageSquare, component: CommunicationsTab },
    { id: 'users', label: 'Users', icon: Users, component: UsersAccessTab },
    { id: 'config', label: 'Config', icon: Settings, component: ConfigurationTab },
    { id: 'diagnostics', label: 'Diagnose', icon: Terminal, component: DiagnosticsTab },
    { id: 'emergency', label: 'Emergency', icon: AlertTriangle, component: EmergencyTab }
  ];

  const activeTabInfo = tabs.find(tab => tab.id === activeTab) || tabs[0];
  const ActiveComponent = activeTabInfo.component;

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
                onClick={() => {
                  console.log('Switching to tab:', tab.id);
                  setActiveTab(tab.id);
                }}
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
              Support Interface - {activeTabInfo.label}
            </h1>
            <p className="text-sm text-gray-600">
              System monitoring and management tools (Active: {activeTab})
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
                  <p className="text-gray-600">Loading {activeTabInfo.label}...</p>
                </div>
              </div>
            }>
              <ActiveComponent />
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