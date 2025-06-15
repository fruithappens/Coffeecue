import React, { useState, useEffect } from 'react';
import { 
  Activity, Settings, Users, MessageSquare, Terminal, AlertTriangle,
  Coffee, RefreshCw, BarChart3, Phone, ArrowLeft
} from 'lucide-react';

import ErrorMonitoring from './ErrorMonitoring';
import SettingsService from '../services/SettingsService';
import SMSTestSimulator from './SMSTestSimulator';

// Import tab components directly (no lazy loading for now)
import DashboardTab from './support-tabs/DashboardTab';
import SystemHealthTab from './support-tabs/SystemHealthTab';
import CommunicationsTab from './support-tabs/CommunicationsTab';
import OperationsTab from './support-tabs/OperationsTab';
import UsersAccessTab from './support-tabs/UsersAccessTab';
import ConfigurationTab from './support-tabs/ConfigurationTab';
import DiagnosticsTab from './support-tabs/DiagnosticsTab';
import EmergencyTab from './support-tabs/EmergencyTab';

const SupportInterface = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [systemHealth, setSystemHealth] = useState({
    appVersion: '1.2.0',
    lastUpdated: new Date()
  });

  // Load system settings on mount and clear old errors
  useEffect(() => {
    // Clear old error logs that might be causing the persistent error display
    localStorage.removeItem('coffee_system_errors');
    localStorage.removeItem('supportErrors');
    localStorage.removeItem('errorLog');
    
    const loadSettings = async () => {
      try {
        const settings = await SettingsService.getSettings();
        console.log('Settings loaded:', settings);
      } catch (error) {
        console.error('Error loading system settings:', error);
      }
    };
    loadSettings();
  }, []);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3, component: DashboardTab },
    { id: 'operations', label: 'Operations', icon: Settings, component: OperationsTab },
    { id: 'health', label: 'Health', icon: Activity, component: SystemHealthTab },
    { id: 'communications', label: 'Comms', icon: MessageSquare, component: CommunicationsTab },
    { id: 'sms-test', label: 'SMS Test', icon: Phone, component: SMSTestSimulator },
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
      </div>
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-white shadow-sm px-6 py-4 flex items-center justify-between">
          <div className="flex items-center">
            <button 
              className="mr-4 p-2 rounded-lg hover:bg-gray-100 transition-colors"
              onClick={() => window.location.href = '/'}
              title="Back to Home"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">
                Support Interface - {activeTabInfo.label}
              </h1>
              <p className="text-sm text-gray-600">
                System monitoring and management tools (Active: {activeTab})
              </p>
            </div>
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
          <div key={activeTab}>
            <ActiveComponent />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupportInterface;