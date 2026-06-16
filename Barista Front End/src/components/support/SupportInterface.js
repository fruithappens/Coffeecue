import React, { useState, useEffect } from 'react';
import {
  Activity, Settings, Users, MessageSquare, Terminal, AlertTriangle,
  Coffee, RefreshCw, BarChart3, Phone, ArrowLeft, Menu, Ban
} from 'lucide-react';

import ErrorMonitoring from './ErrorMonitoring';
import SettingsService from '../../services/SettingsService';
import SMSTestSimulator from './SMSTestSimulator';

// Import tab components directly (no lazy loading for now)
import DashboardTab from '../support-tabs/DashboardTab';
import SystemHealthTab from '../support-tabs/SystemHealthTab';
import CommunicationsTab from '../support-tabs/CommunicationsTab';
import OperationsTab from '../support-tabs/OperationsTab';
import UsersAccessTab from '../support-tabs/UsersAccessTab';
import DiagnosticsTab from '../support-tabs/DiagnosticsTab';
import EmergencyTab from '../support-tabs/EmergencyTab';
import SmsBlocklistTab from '../support-tabs/SmsBlocklistTab';

const SupportInterface = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Mobile: the sidebar becomes an off-canvas drawer toggled by the header menu button.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
    { id: 'sms-blocklist', label: 'SMS Block', icon: Ban, component: SmsBlocklistTab },
    { id: 'users', label: 'Users', icon: Users, component: UsersAccessTab },
    { id: 'diagnostics', label: 'Diagnose', icon: Terminal, component: DiagnosticsTab },
    { id: 'emergency', label: 'Emergency', icon: AlertTriangle, component: EmergencyTab }
  ];

  const activeTabInfo = tabs.find(tab => tab.id === activeTab) || tabs[0];
  const ActiveComponent = activeTabInfo.component;

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile drawer backdrop — tap to close. */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 bg-black bg-opacity-40 z-30" onClick={() => setMobileNavOpen(false)}></div>
      )}
      {/* Sidebar Navigation — matches the Organiser sidebar (white,
          collapsible, labelled, amber active) so the two interfaces feel
          consistent. Emergency keeps a red accent. On mobile it's an
          off-canvas drawer (slides in via the header menu button). */}
      <div className={`bg-white shadow-lg ${sidebarOpen ? 'w-64' : 'w-20'} transition-all duration-300 flex flex-col fixed inset-y-0 left-0 z-40 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'} md:static md:translate-x-0 md:z-auto`}>
        <div className="p-4 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <button
                className="mr-2 p-1 rounded hover:bg-gray-200"
                onClick={() => { window.location.href = '/'; }}
                title="Back to Home"
              >
                <ArrowLeft size={20} />
              </button>
              <h1 className={`font-bold text-gray-800 ${sidebarOpen ? 'text-xl' : 'text-sm'}`}>
                {sidebarOpen ? 'Support' : 'S'}
              </h1>
            </div>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-gray-500 hover:text-gray-800"
            >
              {sidebarOpen ? '◀' : '▶'}
            </button>
          </div>
        </div>

        <nav className="flex-1 px-2 py-4 overflow-y-auto" onClick={() => setMobileNavOpen(false)}>
          <div className="space-y-1">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const cls = tab.id === 'emergency'
                ? (isActive ? 'bg-red-100 text-red-800' : 'text-red-700 hover:bg-red-50')
                : (isActive ? 'bg-amber-100 text-amber-800' : 'text-gray-700 hover:bg-gray-100');
              return (
                <button
                  key={tab.id}
                  className={`w-full flex items-center px-3 py-2 rounded-md ${cls}`}
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.label}
                >
                  <Icon size={20} className="mr-3" />
                  {sidebarOpen && <span>{tab.label}</span>}
                </button>
              );
            })}
          </div>
        </nav>
      </div>
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-white shadow-sm px-6 py-4 flex items-center justify-between">
          <div className="flex items-center">
            {/* Mobile-only menu button — opens the sidebar drawer. */}
            <button
              className="md:hidden mr-2 p-2 rounded-lg hover:bg-gray-100 transition-colors"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={20} />
            </button>
            <button
              className="mr-4 p-2 rounded-lg hover:bg-gray-100 transition-colors"
              onClick={() => window.location.href = '/'}
              title="Back to Home"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-lg md:text-2xl font-bold text-gray-800 truncate">
                Support Interface - {activeTabInfo.label}
              </h1>
              <p className="text-sm text-gray-600 hidden md:block">
                System monitoring and management tools (Active: {activeTab})
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-600 hidden md:block">
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