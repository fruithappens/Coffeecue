import React, { useState, useEffect } from 'react';
import {
  Coffee, Users, Clock, Calendar, Settings,
  LogOut, Bell, Sliders,
  FileText, Activity, Brain, Zap, LineChart,
  Radio, Shield, Package, ArrowLeft, CheckCircle, Database, MessageSquare, Menu
} from 'lucide-react';
// MessageSquare, TrendingUp, BarChart, Layers, UserPlus were imported
// but unused — left in the original sprawl. Trimmed in batch G of the
// system audit (Messages section + others removed). LogOut is kept —
// still rendered in the header.

import GroupOrdersTab from '../barista/GroupOrdersTab';
import AllOrdersTab from '../barista/AllOrdersTab';
import UserManagementTab from './UserManagementTab';
import EnhancedLiveOperationsDashboard from '../support/EnhancedLiveOperationsDashboard';
import QueuePsychologyIntelligence from '../support/QueuePsychologyIntelligence';
import EventLifecycleManagement from './EventLifecycleManagement';
import AnalyticsDashboard from '../support/AnalyticsDashboard';
import EnhancedCommunicationHub from '../support/EnhancedCommunicationHub';
import PredictiveIntelligence from '../support/PredictiveIntelligence';
import EventSettings from './EventSettings';
import EventDataManagement from './EventDataManagement';
import InventoryManagement from './InventoryManagement';
import EventStockManagement from './EventStockManagement';
import StationSettings from './StationSettings';
import StationInventoryConfig from './StationInventoryConfig';
import EnhancedScheduleManagement from './EnhancedScheduleManagement';
import StationDefaults from './StationDefaults';
import QuickSetup from './QuickSetup';
import SetupWizard from './SetupWizard';
import ReadinessTab from './ReadinessTab';
import SmsFlowReference from './SmsFlowReference';
import InventoryIntegrationService from '../../services/InventoryIntegrationService';
import StationsService from '../../services/StationsService';
import OrderDataService from '../../services/OrderDataService';
import AuthService from '../../services/AuthService';
import { useAppMode } from '../../context/AppContext';
import useStations from '../../hooks/useStations';
import brandingConfig from '../../config/brandingConfig';

/**
 * Organiser Interface Component
 * Main interface for event organizers and admins
 */
const OrganiserInterface = () => {
  const { appMode } = useAppMode();
  const { stations, loading, refreshData } = useStations();
  
  // Navigation state
  const [activeSection, setActiveSection] = useState('dashboard'); // Default to Live Ops Dashboard
  const [showSetupWizard, setShowSetupWizard] = useState(false);

  // Account menu (the top-right avatar) + working log out. Both the avatar
  // and the sidebar "Log out" were dead before — no handler at all.
  const [accountOpen, setAccountOpen] = useState(false);
  const currentUser = AuthService.getCurrentUser();
  const userLabel = (currentUser && (currentUser.username || currentUser.full_name)) || 'admin';
  const userInitial = (userLabel[0] || 'A').toUpperCase();
  const handleLogout = () => {
    if (window.confirm('Log out of Coffee Cue?')) {
      AuthService.logout();
    }
  };
  const [stationTab, setStationTab] = useState(() => {
    // Force new interface by clearing any old tab state
    const newVersion = '2.0';
    const savedVersion = localStorage.getItem('organiser_interface_version');
    if (savedVersion !== newVersion) {
      localStorage.setItem('organiser_interface_version', newVersion);
      localStorage.removeItem('organiser_active_section');
      localStorage.removeItem('organiser_station_tab');
    }
    return 'settings'; // Always start with settings tab
  });
  
  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Mobile: the sidebar becomes an off-canvas drawer toggled by the header menu button.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Load stations when component mounts
  useEffect(() => {
    // Stations are loaded by the useStations hook
    console.log('Organiser Interface mounted');
    
    // Initialize inventory integration service
    InventoryIntegrationService.initializeStockServiceIntegration();
  }, []);
  
  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Mobile drawer backdrop — tap to close. */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 bg-black bg-opacity-40 z-30" onClick={() => setMobileNavOpen(false)}></div>
      )}
      {/* Sidebar. On mobile it's an off-canvas drawer (slides in via the header
          menu button); on md+ it's the normal in-flow collapsible sidebar. */}
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
                {sidebarOpen ? brandingConfig.adminPanelTitle : brandingConfig.shortName.split(' ').map(word => word[0]).join('')}
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
            {/* Quick Setup wizard — discoverable up top so a fresh
                event configuration takes one click instead of 30. */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'quickSetup'
                  ? 'bg-amber-100 text-amber-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('quickSetup')}
            >
              <Zap size={20} className="mr-3" />
              {sidebarOpen && <span>Quick Setup</span>}
            </button>

            {/* Event Readiness — pairs with Quick Setup. Operator runs
                this just before doors open to verify SMS + stations +
                inventory + capabilities are all green. */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'readiness'
                  ? 'bg-amber-100 text-amber-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('readiness')}
            >
              <CheckCircle size={20} className="mr-3" />
              {sidebarOpen && <span>Readiness</span>}
            </button>

            {/* Live Operations Dashboard */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'dashboard'
                  ? 'bg-amber-100 text-amber-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('dashboard')}
            >
              <Activity size={20} className="mr-3" />
              {sidebarOpen && <span>Live Ops</span>}
            </button>
            
            {/* Stations */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'stations' 
                  ? 'bg-amber-100 text-amber-800' 
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => {
                setActiveSection('stations');
                setStationTab('settings');
              }}
            >
              <Coffee size={20} className="mr-3" />
              {sidebarOpen && <span>Stations</span>}
            </button>
            
            {/* Queue Psychology */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'queuePsychology' 
                  ? 'bg-amber-100 text-amber-800' 
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('queuePsychology')}
            >
              <Brain size={20} className="mr-3" />
              {sidebarOpen && <span>Queue AI</span>}
            </button>
            
            {/* Event Lifecycle */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'eventLifecycle' 
                  ? 'bg-amber-100 text-amber-800' 
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('eventLifecycle')}
            >
              <Zap size={20} className="mr-3" />
              {sidebarOpen && <span>Event Phases</span>}
            </button>
            
            {/* Orders */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'orders' 
                  ? 'bg-amber-100 text-amber-800' 
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('orders')}
            >
              <Clock size={20} className="mr-3" />
              {sidebarOpen && <span>Orders</span>}
            </button>
            
            {/* Group Orders */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'groupOrders' 
                  ? 'bg-amber-100 text-amber-800' 
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('groupOrders')}
            >
              <FileText size={20} className="mr-3" />
              {sidebarOpen && <span>Group Orders</span>}
            </button>
            
            {/* Users */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'users' 
                  ? 'bg-amber-100 text-amber-800' 
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('users')}
            >
              <Users size={20} className="mr-3" />
              {sidebarOpen && <span>Users</span>}
            </button>
            
            {/* Schedule */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'schedule' 
                  ? 'bg-amber-100 text-amber-800' 
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('schedule')}
            >
              <Calendar size={20} className="mr-3" />
              {sidebarOpen && <span>Schedule</span>}
            </button>
            
            {/* Analytics Dashboard */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'analytics' 
                  ? 'bg-amber-100 text-amber-800' 
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('analytics')}
            >
              <LineChart size={20} className="mr-3" />
              {sidebarOpen && <span>Analytics</span>}
            </button>
            
            {/* Communication Hub */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'communication' 
                  ? 'bg-amber-100 text-amber-800' 
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('communication')}
            >
              <Radio size={20} className="mr-3" />
              {sidebarOpen && <span>Comms Hub</span>}
            </button>
            
            {/* Predictive Intelligence */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'predictive' 
                  ? 'bg-amber-100 text-amber-800' 
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('predictive')}
            >
              <Shield size={20} className="mr-3" />
              {sidebarOpen && <span>AI Predict</span>}
            </button>
            
            {/* Messages — removed in batch G of the system audit. The
                section just rendered "Message center functionality coming
                soon." Use the Communications Hub or Support → Broadcast
                for real inter-station / customer messaging. */}

            {/* Settings */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'settings' 
                  ? 'bg-amber-100 text-amber-800' 
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('settings')}
            >
              <Settings size={20} className="mr-3" />
              {sidebarOpen && <span>Settings</span>}
            </button>

            {/* How SMS Works — read-only reference explaining the SMS bot
                conversation flow, what's event-driven vs built-in, and
                what it remembers. Helps organisers understand/explain it. */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'smsGuide'
                  ? 'bg-amber-100 text-amber-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('smsGuide')}
            >
              <MessageSquare size={20} className="mr-3" />
              {sidebarOpen && <span>How SMS Works</span>}
            </button>

            {/* Event Data — export / wipe / re-import (per-client lifecycle) */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'eventData'
                  ? 'bg-amber-100 text-amber-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('eventData')}
            >
              <Database size={20} className="mr-3" />
              {sidebarOpen && <span>Event Data</span>}
            </button>
          </div>
        </nav>
        
        <div className="p-4 border-t border-gray-200">
          <button onClick={handleLogout} className="flex items-center text-gray-700 w-full hover:text-red-600">
            <LogOut size={20} className="mr-3" />
            {sidebarOpen && <span>Log out</span>}
          </button>
        </div>
      </div>
      
      {/* Main content */}
      <div className="flex-1 overflow-auto">
        <header className="bg-white shadow-sm p-4 flex justify-between items-center">
          <div className="flex items-center gap-2 min-w-0">
            {/* Mobile-only menu button — opens the sidebar drawer. */}
            <button
              className="md:hidden p-1 rounded hover:bg-gray-200 text-gray-700 flex-shrink-0"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={24} />
            </button>
            <h1 className="text-xl font-bold text-gray-800 truncate">
            {activeSection === 'quickSetup' && '⚡ Quick Setup'}
            {activeSection === 'readiness' && '✅ Event Readiness'}
            {activeSection === 'dashboard' && '🚀 Live Operations Command Center'}
            {activeSection === 'stations' && 'Station Management'}
            {activeSection === 'queuePsychology' && 'Queue Psychology & Customer Intelligence'}
            {activeSection === 'eventLifecycle' && 'Event Lifecycle Management'}
            {activeSection === 'analytics' && '📊 Real-Time Analytics Dashboard'}
            {activeSection === 'communication' && '📡 Communication Hub'}
            {activeSection === 'predictive' && '🤖 Predictive Intelligence & Resilience'}
            {activeSection === 'orders' && 'All Orders Overview'}
            {activeSection === 'users' && 'User Management'}
            {activeSection === 'schedule' && 'Event Schedule'}
            {activeSection === 'messages' && 'Message Center'}
            {activeSection === 'settings' && 'System Settings'}
            {activeSection === 'smsGuide' && '📱 How the SMS Bot Works'}
            {activeSection === 'eventData' && 'Event Data'}
            </h1>
          </div>

          <div className="flex items-center space-x-4">
            {/* Account menu — click the avatar for the logged-in user +
                a working Log out. (The old bell was a fake notification
                placeholder with no feed behind it — removed.) */}
            <div className="relative">
              <button
                onClick={() => setAccountOpen(o => !o)}
                className="h-9 w-9 rounded-full bg-amber-200 flex items-center justify-center hover:bg-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
                title={`Signed in as ${userLabel}`}
              >
                <span className="text-amber-800 font-medium">{userInitial}</span>
              </button>
              {accountOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setAccountOpen(false)} />
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-20 py-1">
                    <div className="px-4 py-2 border-b border-gray-100">
                      <div className="text-xs text-gray-500">Signed in as</div>
                      <div className="text-sm font-medium text-gray-800 truncate">{userLabel}</div>
                    </div>
                    <button
                      onClick={() => { setAccountOpen(false); handleLogout(); }}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center"
                    >
                      <LogOut size={16} className="mr-2" /> Log out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        
        <main className="p-6">
          {/* Quick Setup */}
          {activeSection === 'quickSetup' && (
            <>
              {/* Guided questionnaire — the "answer 12 questions, we
                  build the event" path for operators who don't know the
                  menus yet. Writes through the same endpoints as the
                  one-page Quick Setup below. */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex items-center justify-between">
                <div>
                  <div className="font-bold text-blue-900">New here? Try the guided setup</div>
                  <div className="text-sm text-blue-800">Answer about 12 quick questions (3 minutes) and the event builds itself — stations, milks, sizes, drinks, hours. Everything stays editable afterwards.</div>
                </div>
                <button
                  className="ml-4 flex-shrink-0 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700"
                  onClick={() => setShowSetupWizard(true)}
                >
                  Start questionnaire
                </button>
              </div>
              <QuickSetup />
            </>
          )}
          {showSetupWizard && (
            <SetupWizard onClose={() => setShowSetupWizard(false)} />
          )}

          {activeSection === 'readiness' && (
            <ReadinessTab />
          )}

          {/* Dashboard */}
          {activeSection === 'dashboard' && (
            <EnhancedLiveOperationsDashboard />
          )}
          
          {/* Queue Psychology */}
          {activeSection === 'queuePsychology' && (
            <QueuePsychologyIntelligence />
          )}
          
          {/* Event Lifecycle */}
          {activeSection === 'eventLifecycle' && (
            <EventLifecycleManagement />
          )}
          
          {/* Stations */}
          {activeSection === 'stations' && (
            <div>
              {/* Tab Navigation

                  RETIRED: 'Menu Items' (MenuManagement.js). It was a SECOND
                  drinks menu kept in localStorage 'event_menu' — a store the
                  server has never read — so switching a drink off there
                  changed nothing for SMS, the kiosk, the attendee app or the
                  barista. Event Inventory is the menu; Station Inventory is
                  the per-station menu, and both are server-backed.

                  The four tabs below are the whole model:
                    Event Inventory  what this event offers
                    Event Stock      how much of it there is
                    Station Inventory which stations carry what
                    Station Defaults  what the walk-in form pre-fills
              */}
              <div className="mb-6 bg-white p-2 rounded-lg shadow flex">
                <button
                  className={`flex-1 py-2 px-4 rounded-md ${stationTab === 'settings' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  onClick={() => setStationTab('settings')}
                >
                  <Settings size={16} className="inline-block mr-1" />
                  Station Settings
                </button>
                <button
                  className={`flex-1 py-2 px-4 rounded-md ${stationTab === 'inventory' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  onClick={() => setStationTab('inventory')}
                >
                  <Package size={16} className="inline-block mr-1" />
                  Event Inventory
                </button>
                <button
                  className={`flex-1 py-2 px-4 rounded-md ${stationTab === 'stock' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  onClick={() => setStationTab('stock')}
                >
                  <Package size={16} className="inline-block mr-1" />
                  Event Stock
                </button>
                <button
                  className={`flex-1 py-2 px-4 rounded-md ${stationTab === 'config' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  onClick={() => setStationTab('config')}
                >
                  <Coffee size={16} className="inline-block mr-1" />
                  Station Inventory
                </button>
                <button
                  className={`flex-1 py-2 px-4 rounded-md ${stationTab === 'defaults' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  onClick={() => setStationTab('defaults')}
                >
                  <Sliders size={16} className="inline-block mr-1" />
                  Station Defaults
                </button>
              </div>
              
              {/* Tab Content */}
              {stationTab === 'settings' && (
                <StationSettings
                  stations={stations}
                  onStationUpdate={async (stationId, stationData) => {
                    // ApiService is exported as a class — must be
                    // instantiated before calling request(). The
                    // previous version called ApiService.request(...)
                    // directly on the class and silently failed with
                    // "TypeError: ApiService.request is not a function",
                    // which is why Add / Update / Delete Station all
                    // appeared broken from the UI even after the
                    // backend API was correct.
                    try {
                      console.log('Updating station:', stationId, stationData);
                      const { default: ApiServiceClass } = await import('../../services/ApiService');
                      const apiService = new ApiServiceClass();
                      const response = await apiService.request(`/stations/${stationId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(stationData),
                      });
                      if (response.success) {
                        console.log('Station updated successfully:', response);
                        refreshData();
                        return true;
                      } else {
                        console.error('Failed to update station:', response.error);
                        return false;
                      }
                    } catch (error) {
                      console.error('Error updating station:', error);
                      return false;
                    }
                  }}
                  onAddStation={async (stationData) => {
                    try {
                      console.log('Adding station:', stationData);
                      const { default: ApiServiceClass } = await import('../../services/ApiService');
                      const apiService = new ApiServiceClass();
                      // Backend auto-assigns station_id when omitted
                      // (see routes/station_api_routes.py create_station).
                      // We send a client-suggested id as a fallback,
                      // but the server-side allocation is the source
                      // of truth.
                      const newStationId = Math.max(0, ...stations.map(s => s.id || 0)) + 1;
                      const response = await apiService.request('/stations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ station_id: newStationId, ...stationData }),
                      });
                      if (response.success) {
                        console.log('Station added successfully:', response);
                        refreshData();
                        return true;
                      } else {
                        console.error('Failed to add station:', response.error);
                        return false;
                      }
                    } catch (error) {
                      console.error('Error adding station:', error);
                      return false;
                    }
                  }}
                  onDeleteStation={async (stationId) => {
                    try {
                      console.log('Deleting station:', stationId);
                      const { default: ApiServiceClass } = await import('../../services/ApiService');
                      const apiService = new ApiServiceClass();
                      const response = await apiService.request(`/stations/${stationId}`, {
                        method: 'DELETE',
                      });
                      if (response.success) {
                        console.log('Station deleted successfully:', response);
                        refreshData();
                        return true;
                      } else {
                        console.error('Failed to delete station:', response.error);
                        return false;
                      }
                    } catch (error) {
                      console.error('Error deleting station:', error);
                      return false;
                    }
                  }}
                />
              )}
              
              {stationTab === 'inventory' && (
                <InventoryManagement />
              )}
              
              {stationTab === 'stock' && (
                <EventStockManagement />
              )}
              
              {stationTab === 'config' && (
                <StationInventoryConfig stations={stations} />
              )}
              
              {stationTab === 'defaults' && (
                <StationDefaults />
              )}
            </div>
          )}
          
          {/* Orders Overview Section */}
          {activeSection === 'orders' && (
            <div className="bg-white rounded-lg shadow p-6">
              <AllOrdersTab />
            </div>
          )}
          
          {/* Group Orders Section */}
          {activeSection === 'groupOrders' && (
            <div className="bg-white rounded-lg shadow">
              <GroupOrdersTab 
                onSubmitGroupOrders={(groupOrder) => {
                  // Handle group order submission
                  const result = OrderDataService.submitGroupOrder(groupOrder);
                  return result;
                }} 
              />
            </div>
          )}
          
          {/* Analytics Dashboard */}
          {activeSection === 'analytics' && (
            <AnalyticsDashboard />
          )}
          
          {/* Communication Hub */}
          {activeSection === 'communication' && (
            <EnhancedCommunicationHub />
          )}
          
          {/* Predictive Intelligence */}
          {activeSection === 'predictive' && (
            <PredictiveIntelligence />
          )}
          
          {/* User Management */}
          {activeSection === 'users' && (
            <div className="bg-white rounded-lg shadow p-6">
              <UserManagementTab />
            </div>
          )}
          
          {/* Settings - Branding */}
          {activeSection === 'settings' && (
            <EventSettings />
          )}

          {/* How SMS Works — read-only reference for organisers */}
          {activeSection === 'smsGuide' && (
            <SmsFlowReference />
          )}

          {/* Event Data — export / wipe / re-import */}
          {activeSection === 'eventData' && (
            <EventDataManagement />
          )}
          
          {/* Schedule Management */}
          {activeSection === 'schedule' && (
            <EnhancedScheduleManagement />
          )}
          
          {/* Messages section removed in batch G — see sidebar comment. */}
          
          {/* Placeholder for other sections */}
          {activeSection !== 'dashboard' && 
           activeSection !== 'stations' && 
           activeSection !== 'groupOrders' &&
           activeSection !== 'queuePsychology' &&
           activeSection !== 'eventLifecycle' &&
           activeSection !== 'analytics' &&
           activeSection !== 'communication' &&
           activeSection !== 'predictive' &&
           activeSection !== 'settings' &&
           activeSection !== 'schedule' &&
           activeSection !== 'orders' &&
           activeSection !== 'users' &&
           activeSection !== 'messages' && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">{activeSection.charAt(0).toUpperCase() + activeSection.slice(1)}</h2>
              <p className="text-gray-600">This section is under development.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default OrganiserInterface;