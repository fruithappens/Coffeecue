import React, { useState, useEffect } from 'react';
import { 
  Zap, Target, Coffee, Package, Users, BarChart3, MessageSquare, Settings,
  Menu, X, Bell, User, LogOut, ChevronLeft, ChevronRight, Palette
} from 'lucide-react';

// Import styles
import '../styles/OrganizerInterface.css';

// Import components
import LiveOperationsDashboard from './LiveOperationsDashboard';
import EventSetupPanel from './EventSetupPanel';
import StationManagementPanel from './StationManagementPanel';
import InventoryManagementPanel from './InventoryManagementPanel';
import StaffManagementPanel from './StaffManagementPanel';
import AnalyticsDashboard from './AnalyticsDashboard';
import CommunicationHub from './CommunicationHub';
import SystemSettings from './SystemSettings';
import BrandingSettings from './BrandingSettings';

// Import existing components that we'll enhance
import GroupOrdersTab from './GroupOrdersTab';

/**
 * Enhanced Organizer Interface with 8-Tab Structure
 * Mobile-responsive, iPad-optimized interface for event management
 */
const EnhancedOrganizerInterface = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState('live-ops');
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 1024);
  const [notifications, setNotifications] = useState([]);
  
  // Tab configuration
  const tabs = [
    { id: 'live-ops', label: 'Live Ops', icon: Zap, color: 'text-red-600', component: LiveOperationsDashboard },
    { id: 'event-setup', label: 'Event Setup', icon: Target, color: 'text-blue-600', component: EventSetupPanel },
    { id: 'stations', label: 'Stations', icon: Coffee, color: 'text-amber-600', component: StationManagementPanel },
    { id: 'inventory', label: 'Inventory', icon: Package, color: 'text-green-600', component: InventoryManagementPanel },
    { id: 'staff', label: 'Staff', icon: Users, color: 'text-purple-600', component: StaffManagementPanel },
    { id: 'analytics', label: 'Analytics', icon: BarChart3, color: 'text-indigo-600', component: AnalyticsDashboard },
    { id: 'comms', label: 'Comms', icon: MessageSquare, color: 'text-cyan-600', component: CommunicationHub },
    { id: 'settings', label: 'Settings', icon: Settings, color: 'text-gray-600', component: SystemSettings }
  ];
  
  // Handle responsive sidebar
  useEffect(() => {
    const handleResize = () => {
      setSidebarOpen(window.innerWidth >= 1024);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Emergency controls that are always visible
  const EmergencyControls = () => (
    <div className="bg-red-600 text-white px-4 py-2 flex items-center justify-between sticky top-0 z-50 lg:hidden">
      <button className="flex items-center space-x-2 text-sm font-medium">
        <Zap className="w-4 h-4" />
        <span>Emergency Stop</span>
      </button>
      <button className="flex items-center space-x-2 text-sm font-medium">
        <MessageSquare className="w-4 h-4" />
        <span>Alert All</span>
      </button>
    </div>
  );
  
  // Get the active component
  const ActiveComponent = tabs.find(tab => tab.id === activeTab)?.component || LiveOperationsDashboard;
  
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col lg:flex-row">
      {/* Mobile Emergency Controls */}
      <EmergencyControls />
      
      {/* Sidebar */}
      <aside className={`
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        fixed lg:static inset-y-0 left-0 z-40 w-64 lg:w-auto
        bg-white shadow-lg transition-transform duration-300 ease-in-out
        flex flex-col h-full lg:h-screen
      `}>
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-800">CoffeeCue Pro</h1>
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden text-gray-500 hover:text-gray-700"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>
        
        {/* Navigation Tabs */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (window.innerWidth < 1024) setSidebarOpen(false);
                }}
                className={`
                  w-full flex items-center space-x-3 px-3 py-3 rounded-lg
                  transition-all duration-200 group
                  ${isActive 
                    ? 'bg-gray-100 shadow-sm' 
                    : 'hover:bg-gray-50'
                  }
                `}
              >
                <Icon className={`w-5 h-5 ${isActive ? tab.color : 'text-gray-400 group-hover:text-gray-600'}`} />
                <span className={`font-medium ${isActive ? 'text-gray-900' : 'text-gray-600'}`}>
                  {tab.label}
                </span>
                {isActive && (
                  <ChevronRight className="w-4 h-4 text-gray-400 ml-auto" />
                )}
              </button>
            );
          })}
        </nav>
        
        {/* User Section */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center space-x-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <User className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Event Manager</p>
              <p className="text-xs text-gray-500">admin@coffeecue.com</p>
            </div>
          </div>
          <button 
            onClick={onLogout}
            className="w-full flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900"
          >
            <LogOut className="w-4 h-4" />
            <span>Log out</span>
          </button>
        </div>
      </aside>
      
      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-h-screen lg:h-screen">
        {/* Header */}
        <header className="bg-white shadow-sm px-4 lg:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button 
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden text-gray-500 hover:text-gray-700"
              >
                <Menu className="w-6 h-6" />
              </button>
              <h2 className="text-xl lg:text-2xl font-semibold text-gray-800">
                {tabs.find(tab => tab.id === activeTab)?.label || 'Dashboard'}
              </h2>
            </div>
            
            <div className="flex items-center space-x-3">
              {/* Notifications */}
              <button className="relative p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
                <Bell className="w-5 h-5" />
                {notifications.length > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                )}
              </button>
              
              {/* Quick Stats - Desktop Only */}
              <div className="hidden lg:flex items-center space-x-4 text-sm">
                <div className="flex items-center space-x-1">
                  <span className="text-gray-500">Active Orders:</span>
                  <span className="font-semibold text-gray-900">24</span>
                </div>
                <div className="w-px h-5 bg-gray-300"></div>
                <div className="flex items-center space-x-1">
                  <span className="text-gray-500">Avg Wait:</span>
                  <span className="font-semibold text-gray-900">6.2min</span>
                </div>
              </div>
            </div>
          </div>
        </header>
        
        {/* Tab Content */}
        <div className="flex-1 overflow-auto p-4 lg:p-6">
          <ActiveComponent />
        </div>
      </main>
      
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && window.innerWidth < 1024 && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
};

export default EnhancedOrganizerInterface;