import React, { useState } from 'react';
import { 
  Activity, Settings, Users, MessageSquare, Terminal, AlertTriangle,
  Coffee, ArrowLeft, Bell, BellOff, RefreshCw, BarChart3
} from 'lucide-react';

// Simple test tab components
const TestDashboard = () => (
  <div className="p-6">
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <h2 className="text-xl font-bold text-blue-800">📊 DASHBOARD TAB</h2>
      <p className="text-blue-600">This is the Dashboard content</p>
    </div>
  </div>
);

const TestOperations = () => (
  <div className="p-6">
    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
      <h2 className="text-xl font-bold text-green-800">⚙️ OPERATIONS TAB</h2>
      <p className="text-green-600">This is the Operations content</p>
    </div>
  </div>
);

const TestHealth = () => (
  <div className="p-6">
    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
      <h2 className="text-xl font-bold text-red-800">❤️ HEALTH TAB</h2>
      <p className="text-red-600">This is the Health content</p>
    </div>
  </div>
);

const TestCommunications = () => (
  <div className="p-6">
    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
      <h2 className="text-xl font-bold text-purple-800">📱 COMMUNICATIONS TAB</h2>
      <p className="text-purple-600">This is the Communications content</p>
    </div>
  </div>
);

const TestUsers = () => (
  <div className="p-6">
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
      <h2 className="text-xl font-bold text-yellow-800">👥 USERS TAB</h2>
      <p className="text-yellow-600">This is the Users content</p>
    </div>
  </div>
);

const TestConfig = () => (
  <div className="p-6">
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
      <h2 className="text-xl font-bold text-indigo-800">🔧 CONFIG TAB</h2>
      <p className="text-indigo-600">This is the Config content</p>
    </div>
  </div>
);

const TestDiagnostics = () => (
  <div className="p-6">
    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
      <h2 className="text-xl font-bold text-orange-800">🔍 DIAGNOSTICS TAB</h2>
      <p className="text-orange-600">This is the Diagnostics content</p>
    </div>
  </div>
);

const TestEmergency = () => (
  <div className="p-6">
    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
      <h2 className="text-xl font-bold text-red-800">🚨 EMERGENCY TAB</h2>
      <p className="text-red-600">This is the Emergency content</p>
    </div>
  </div>
);

const SupportInterfaceTest = () => {
  const [activeTab, setActiveTab] = useState('dashboard');

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3, component: TestDashboard },
    { id: 'operations', label: 'Operations', icon: Settings, component: TestOperations },
    { id: 'health', label: 'Health', icon: Activity, component: TestHealth },
    { id: 'communications', label: 'Comms', icon: MessageSquare, component: TestCommunications },
    { id: 'users', label: 'Users', icon: Users, component: TestUsers },
    { id: 'config', label: 'Config', icon: Settings, component: TestConfig },
    { id: 'diagnostics', label: 'Diagnose', icon: Terminal, component: TestDiagnostics },
    { id: 'emergency', label: 'Emergency', icon: AlertTriangle, component: TestEmergency }
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
        <div className="bg-white shadow-sm px-6 py-4">
          <h1 className="text-2xl font-bold text-gray-800">
            Support Interface Test - {activeTabInfo.label} (Active: {activeTab})
          </h1>
        </div>
        
        {/* Tab Content */}
        <div className="flex-1 overflow-auto">
          <ActiveComponent />
        </div>
      </div>
    </div>
  );
};

export default SupportInterfaceTest;