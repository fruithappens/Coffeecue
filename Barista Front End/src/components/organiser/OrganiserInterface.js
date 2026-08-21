import React, { useState, useEffect } from 'react';
import {
  Coffee, Users, Clock, Calendar, Settings,
  LogOut, Bell, Sliders,
  FileText, Activity, Brain, Zap, LineChart,
  Radio, Shield, Package, ArrowLeft, CheckCircle, Database, Menu,
  HelpCircle
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

// Sections the sidebar can reach. Anything not in here falls through to
// the "under development" placeholder below.
const KNOWN_SECTIONS = [
  'quickSetup', 'operations', 'stations', 'orders', 'eventLifecycle',
  'schedule', 'insights', 'communication', 'users', 'settings', 'help',
];

// Sub-tab bar shared by the grouped sidebar sections (Operations,
// Orders, Insights, Settings). Same visual language as the Stations
// tabs so the two levels of navigation read consistently: the sidebar
// picks the area of the job, these pick the screen within it.
const SubTabs = ({ tabs, active, onChange }) => (
  <div className="mb-6 bg-white p-2 rounded-lg shadow flex">
    {tabs.map(({ id, label, Icon }) => (
      <button
        key={id}
        className={`flex-1 py-2 px-4 rounded-md ${active === id ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        onClick={() => onChange(id)}
      >
        <Icon size={16} className="inline-block mr-1" />
        {label}
      </button>
    ))}
  </div>
);

/**
 * Organiser Interface Component
 * Main interface for event organizers and admins
 */
const OrganiserInterface = () => {
  const { appMode } = useAppMode();
  const { stations, loading, refreshData } = useStations();
  
  // Navigation state
  // Sidebar area. Grouped sections own a sub-tab below (opsTab etc).
  const [activeSection, setActiveSection] = useState('operations');
  // Operations opens on Live rather than Readiness so the landing screen
  // is unchanged from when these were two separate sidebar items.
  const [opsTab, setOpsTab] = useState('dashboard');
  const [ordersTab, setOrdersTab] = useState('all');
  const [insightsTab, setInsightsTab] = useState('analytics');
  const [settingsTab, setSettingsTab] = useState('system');
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
            {/* Sidebar groups sections by the job being done, not by
                screen. Sixteen items became eleven: Readiness + Live Ops
                are one event-day area (Operations), Orders + Group Orders
                one Orders area, Analytics + Queue + Forecast one Insights
                area, Settings + Event Data one Settings area. Each group
                renders a SubTabs bar; nothing was deleted, only reparented. */}
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

            {/* Operations — Readiness (pre-doors checks, test SMS, admin
                alerts) and Live (the during-service command centre).
                Same operator, same day, one click apart. */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'operations'
                  ? 'bg-amber-100 text-amber-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('operations')}
            >
              <Activity size={20} className="mr-3" />
              {sidebarOpen && <span>Operations</span>}
            </button>

            {/* Stations */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'stations'
                  ? 'bg-amber-100 text-amber-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('stations')}
            >
              <Coffee size={20} className="mr-3" />
              {sidebarOpen && <span>Stations</span>}
            </button>

            {/* Orders — all orders, plus group orders */}
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

            {/* Event Phases. NOTE: its phases (SETUP / PRE_EVENT /
                MORNING_PEAK ...) are hardcoded in EventLifecycleManagement
                and do NOT read the sessions entered in Schedule, so it
                describes a generic event day rather than this one. Left as
                its own item until it is driven by real sessions. */}
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

            {/* Schedule — the real, server-backed session agenda */}
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

            {/* Insights — Analytics (real, historical), Queue and Forecast.
                NOTE: all three are read-only. Analytics charts are sample
                data (its own banner says so). Queue and Forecast do read live
                orders, but their toggles — message tone, auto-adjust,
                auto-order — persist nothing and nothing downstream reads
                them. Real live figures are Operations -> Live. */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'insights'
                  ? 'bg-amber-100 text-amber-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('insights')}
            >
              <Brain size={20} className="mr-3" />
              {sidebarOpen && <span>Insights</span>}
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

            {/* Settings — system settings, plus Event Data export/wipe */}
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

            {/* Help — currently the SMS bot reference. A home for operator
                documentation so the next explainer does not need a
                sidebar item of its own. */}
            <button
              className={`w-full flex items-center px-3 py-2 rounded-md ${
                activeSection === 'help'
                  ? 'bg-amber-100 text-amber-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setActiveSection('help')}
            >
              <HelpCircle size={20} className="mr-3" />
              {sidebarOpen && <span>Help</span>}
            </button>

            {/* Messages — removed in batch G of the system audit. The
                section just rendered "Message center functionality coming
                soon." Use the Communications Hub or Support → Broadcast
                for real inter-station / customer messaging. */}
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
            {activeSection === 'operations' && (opsTab === 'readiness' ? '✅ Event Readiness' : '🚀 Live Operations Command Center')}
            {activeSection === 'stations' && 'Station Management'}
            {activeSection === 'orders' && (ordersTab === 'groups' ? 'Group Orders' : 'All Orders Overview')}
            {activeSection === 'eventLifecycle' && 'Event Lifecycle Management'}
            {activeSection === 'schedule' && 'Event Schedule'}
            {activeSection === 'insights' && (
              insightsTab === 'queue' ? 'Queue Psychology & Customer Intelligence'
              : insightsTab === 'forecast' ? '🤖 Predictive Intelligence & Resilience'
              : '📊 Real-Time Analytics Dashboard')}
            {activeSection === 'communication' && '📡 Communication Hub'}
            {activeSection === 'users' && 'User Management'}
            {activeSection === 'settings' && (settingsTab === 'eventData' ? 'Event Data' : 'System Settings')}
            {activeSection === 'help' && '📱 How the SMS Bot Works'}
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

          {/* Operations — pre-doors readiness and the live command centre.
              Sequential rather than duplicate: Readiness is what you run
              before doors open, Live is what you watch during service. */}
          {activeSection === 'operations' && (
            <div>
              <SubTabs
                active={opsTab}
                onChange={setOpsTab}
                tabs={[
                  { id: 'readiness', label: 'Readiness', Icon: CheckCircle },
                  { id: 'dashboard', label: 'Live', Icon: Activity },
                ]}
              />
              {opsTab === 'readiness' && <ReadinessTab />}
              {opsTab === 'dashboard' && <EnhancedLiveOperationsDashboard />}
            </div>
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
                  Walk-in defaults now live inside Station Settings, against
                  the station you are already editing.
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
              
            </div>
          )}
          
          {/* Orders — individual orders and group orders, one area. */}
          {activeSection === 'orders' && (
            <div>
              <SubTabs
                active={ordersTab}
                onChange={setOrdersTab}
                tabs={[
                  { id: 'all', label: 'All Orders', Icon: Clock },
                  { id: 'groups', label: 'Group Orders', Icon: FileText },
                ]}
              />
              {ordersTab === 'all' && (
                <div className="bg-white rounded-lg shadow p-6">
                  <AllOrdersTab />
                </div>
              )}
              {ordersTab === 'groups' && (
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
            </div>
          )}
          
          {/* Insights — Analytics, Queue and Forecast.

              NOTE for whoever picks this up: Analytics renders sample data,
              not this event's numbers. Queue and Forecast do read live orders
              via hooks, but persist NOTHING. Their controls —
              message tone (Precise/Friendly/Gamified), Auto-adjust,
              Auto-order — are component state only. No localStorage, no
              settings write, and nothing downstream reads them. They are
              read-only views with controls that look actionable. */}
          {activeSection === 'insights' && (
            <div>
              <SubTabs
                active={insightsTab}
                onChange={setInsightsTab}
                tabs={[
                  { id: 'analytics', label: 'Analytics', Icon: LineChart },
                  { id: 'queue', label: 'Queue', Icon: Brain },
                  { id: 'forecast', label: 'Forecast', Icon: Shield },
                ]}
              />
              {insightsTab === 'analytics' && <AnalyticsDashboard />}
              {insightsTab === 'queue' && <QueuePsychologyIntelligence />}
              {insightsTab === 'forecast' && <PredictiveIntelligence />}
            </div>
          )}
          
          {/* Communication Hub */}
          {activeSection === 'communication' && (
            <EnhancedCommunicationHub />
          )}
          
          {/* User Management */}
          {activeSection === 'users' && (
            <div className="bg-white rounded-lg shadow p-6">
              <UserManagementTab />
            </div>
          )}
          
          {/* Settings — system settings, plus the per-client Event Data
              lifecycle (export / wipe / re-import). Both are "configure the
              installation" rather than "run the event". */}
          {activeSection === 'settings' && (
            <div>
              <SubTabs
                active={settingsTab}
                onChange={setSettingsTab}
                tabs={[
                  { id: 'system', label: 'System Settings', Icon: Settings },
                  { id: 'eventData', label: 'Event Data', Icon: Database },
                ]}
              />
              {settingsTab === 'system' && <EventSettings />}
              {settingsTab === 'eventData' && <EventDataManagement />}
            </div>
          )}

          {/* Help — operator documentation. Currently the SMS bot flow
              reference; add further explainers here rather than adding
              sidebar items. */}
          {activeSection === 'help' && (
            <SmsFlowReference />
          )}
          
          {/* Schedule Management */}
          {activeSection === 'schedule' && (
            <EnhancedScheduleManagement />
          )}
          
          {/* Messages section removed in batch G — see sidebar comment. */}
          
          {/* Unknown section fallback.

              This was a blacklist of 13 !== comparisons, and it had drifted:
              'readiness', 'quickSetup', 'smsGuide' and 'eventData' were never
              added to it, so "This section is under development." rendered
              underneath four working screens. A whitelist cannot drift the
              same way — a new section that forgets to register here shows the
              placeholder instead of silently doubling up. */}
          {!KNOWN_SECTIONS.includes(activeSection) && (
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