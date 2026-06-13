import React, { useState, useEffect } from 'react';
import {
  Coffee, Users, Clock, Calendar, Settings,
  LogOut, Bell, Sliders,
  FileText, Activity, Brain, Zap, LineChart,
  Radio, Shield, Package, ArrowLeft, CheckCircle, Database, MessageSquare
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
import MenuManagement from './MenuManagement';
import StationDefaults from './StationDefaults';
import QuickSetup from './QuickSetup';
import ReadinessTab from './ReadinessTab';
import SmsFlowReference from './SmsFlowReference';
import InventoryIntegrationService from '../../services/InventoryIntegrationService';
import StationsService from '../../services/StationsService';
import OrderDataService from '../../services/OrderDataService';
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
  
  // Load stations when component mounts
  useEffect(() => {
    // Stations are loaded by the useStations hook
    console.log('Organiser Interface mounted');
    
    // Initialize inventory integration service
    InventoryIntegrationService.initializeStockServiceIntegration();
  }, []);
  
  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Sidebar */}
      <div className={`bg-white shadow-lg ${sidebarOpen ? 'w-64' : 'w-20'} transition-all duration-300 flex flex-col`}>
        <div className="p-4 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <button 
                className="mr-2 p-1 rounded hover:bg-gray-200"
                onClick={() => window.history.back()}
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
        
        <nav className="flex-1 px-2 py-4">
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
              {sidebarOpen && <span>⚡ Quick Setup</span>}
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
              {sidebarOpen && <span>✅ Readiness</span>}
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
              {sidebarOpen && <span>🚀 Live Ops</span>}
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
          <button className="flex items-center text-gray-700 w-full">
            <LogOut size={20} className="mr-3" />
            {sidebarOpen && <span>Log out</span>}
          </button>
        </div>
      </div>
      
      {/* Main content */}
      <div className="flex-1 overflow-auto">
        <header className="bg-white shadow-sm p-4 flex justify-between items-center">
          <h1 className="text-xl font-bold text-gray-800">
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
          
          <div className="flex items-center space-x-4">
            <button className="text-gray-500 hover:text-gray-800 relative">
              <Bell size={20} />
              <span className="absolute top-0 right-0 bg-red-500 rounded-full w-2 h-2"></span>
            </button>
            <div className="h-8 w-8 rounded-full bg-amber-200 flex items-center justify-center">
              <span className="text-amber-800 font-medium">A</span>
            </div>
          </div>
        </header>
        
        <main className="p-6">
          {/* Quick Setup */}
          {activeSection === 'quickSetup' && (
            <QuickSetup />
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
              {/* Tab Navigation */}
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
                  className={`flex-1 py-2 px-4 rounded-md ${stationTab === 'menu' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  onClick={() => setStationTab('menu')}
                >
                  <Coffee size={16} className="inline-block mr-1" />
                  Menu Items
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
              
              {stationTab === 'menu' && (
                <MenuManagement />
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