import React, { useState, useEffect } from 'react';
import {
  Activity, Settings, Users, MessageSquare, Terminal, AlertTriangle,
  RefreshCw, BarChart3, Phone, ArrowLeft, Menu, Ban, Printer, CalendarClock,
  LogOut, Plug, Heart
} from 'lucide-react';

import SettingsService from '../../services/SettingsService';
import AuthService from '../../services/AuthService';
import SMSTestSimulator from './SMSTestSimulator';
import { ToastManager } from '../shared/Toast';
import SubTabs from '../shared/SubTabs';

// Import tab components directly (no lazy loading for now)
import DashboardTab from '../support-tabs/DashboardTab';
import SystemHealthTab from '../support-tabs/SystemHealthTab';
import CommunicationsTab from '../support-tabs/CommunicationsTab';
import OperationsTab from '../support-tabs/OperationsTab';
import UsersAccessTab from '../support-tabs/UsersAccessTab';
import DiagnosticsTab from '../support-tabs/DiagnosticsTab';
import EmergencyTab from '../support-tabs/EmergencyTab';
import SmsBlocklistTab from '../support-tabs/SmsBlocklistTab';
import PrintersTab from '../support-tabs/PrintersTab';
import EventsAirTab from '../support-tabs/EventsAirTab';

// Support navigation, grouped the same way as the Organiser sidebar: the
// sidebar picks the area of the job, a SubTabs bar picks the screen within
// it. Eleven flat items (several with truncated labels like "Comms",
// "SMS Block", "Diagnose") became seven readable ones.
//
// Emergency stays its own item and keeps the red accent — it should never
// be one tab-click away inside another group.
const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', Icon: BarChart3, component: DashboardTab },
  { id: 'operations', label: 'Operations', Icon: Settings, component: OperationsTab },
  {
    id: 'system', label: 'System', Icon: Heart,
    tabs: [
      { id: 'health', label: 'Health', Icon: Activity, component: SystemHealthTab },
      { id: 'diagnostics', label: 'Diagnostics', Icon: Terminal, component: DiagnosticsTab },
    ],
  },
  {
    id: 'messaging', label: 'Messaging', Icon: MessageSquare,
    tabs: [
      { id: 'communications', label: 'Comms', Icon: MessageSquare, component: CommunicationsTab },
      { id: 'sms-test', label: 'SMS Test', Icon: Phone, component: SMSTestSimulator },
      { id: 'sms-blocklist', label: 'Blocklist', Icon: Ban, component: SmsBlocklistTab },
    ],
  },
  {
    id: 'integrations', label: 'Integrations', Icon: Plug,
    tabs: [
      { id: 'printers', label: 'Printers', Icon: Printer, component: PrintersTab },
      { id: 'eventsair', label: 'EventsAir', Icon: CalendarClock, component: EventsAirTab },
    ],
  },
  { id: 'users', label: 'Users', Icon: Users, component: UsersAccessTab },
  { id: 'emergency', label: 'Emergency', Icon: AlertTriangle, component: EmergencyTab },
];

const SupportInterface = () => {
  const [activeSection, setActiveSection] = useState('dashboard');
  // One sub-tab position per grouped section, so switching away and back
  // returns to the screen you were on rather than resetting to the first.
  const [subTab, setSubTab] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Mobile: the sidebar becomes an off-canvas drawer toggled by the header menu button.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const currentUser = AuthService.getCurrentUser();
  const userLabel = (currentUser && (currentUser.username || currentUser.full_name)) || 'admin';
  const userInitial = (userLabel[0] || 'A').toUpperCase();
  const handleLogout = () => {
    if (window.confirm('Log out of Coffee Cue?')) {
      AuthService.logout();
    }
  };

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

  const section = SECTIONS.find(s => s.id === activeSection) || SECTIONS[0];
  const grouped = Array.isArray(section.tabs);
  const activeSubId = grouped ? (subTab[section.id] || section.tabs[0].id) : null;
  const activeLeaf = grouped
    ? (section.tabs.find(t => t.id === activeSubId) || section.tabs[0])
    : section;
  const ActiveComponent = activeLeaf.component;

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Toasts (Printers tab and friends dispatch app:toast events). */}
      <ToastManager />
      {/* Mobile drawer backdrop — tap to close. */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 bg-black bg-opacity-40 z-30" onClick={() => setMobileNavOpen(false)}></div>
      )}
      {/* Sidebar — same chrome as the Organiser sidebar: white, collapsible,
          amber active state, back-to-home in the header, Log out in a footer.
          Emergency keeps a red accent. */}
      <div className={`bg-white shadow-lg ${sidebarOpen ? 'w-64' : 'w-20'} transition-all duration-300 flex flex-col fixed inset-y-0 left-0 z-40 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'} md:static md:translate-x-0 md:z-auto`}>
        <div className="p-4 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <button
                className="mr-2 p-1 rounded hover:bg-gray-200"
                onClick={() => { window.location.href = '/welcome'; }}
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
            {SECTIONS.map(s => {
              const { Icon } = s;
              const isActive = activeSection === s.id;
              const cls = s.id === 'emergency'
                ? (isActive ? 'bg-red-100 text-red-800' : 'text-red-700 hover:bg-red-50')
                : (isActive ? 'bg-amber-100 text-amber-800' : 'text-gray-700 hover:bg-gray-100');
              return (
                <button
                  key={s.id}
                  className={`w-full flex items-center px-3 py-2 rounded-md ${cls}`}
                  onClick={() => setActiveSection(s.id)}
                  title={s.label}
                >
                  <Icon size={20} className="mr-3" />
                  {sidebarOpen && <span>{s.label}</span>}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="p-4 border-t border-gray-200">
          <button onClick={handleLogout} className="flex items-center text-gray-700 w-full hover:text-red-600">
            <LogOut size={20} className="mr-3" />
            {sidebarOpen && <span>Log out</span>}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header — matches the Organiser header: the screen's own name at
            text-xl, and an account menu on the right. Previously this read
            "Support Interface - <tab>" at text-2xl with the subtitle
            "System monitoring and management tools (Active: <tabId>)" —
            the raw tab id was internal state on show, and the oversized
            title collided with the timestamp beside it. */}
        <header className="bg-white shadow-sm px-6 py-4 flex items-center justify-between">
          <div className="flex items-center min-w-0">
            {/* Mobile-only menu button — opens the sidebar drawer. */}
            <button
              className="md:hidden mr-2 p-1 rounded hover:bg-gray-200 text-gray-700 flex-shrink-0"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={24} />
            </button>
            <h1 className="text-xl font-bold text-gray-800 truncate">
              {grouped ? `${section.label} — ${activeLeaf.label}` : section.label}
            </h1>
          </div>

          <div className="flex items-center space-x-4 flex-shrink-0">
            <div className="text-sm text-gray-600 hidden md:block">
              Last update: {lastUpdated.toLocaleTimeString()}
            </div>
            <button
              onClick={() => { setLastUpdated(new Date()); window.location.reload(); }}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw size={20} />
            </button>
            {/* Account menu — same control as the Organiser header. Support
                had no way to log out at all before. */}
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

        {/* Content. The p-6 gutter lives here, as it does in the Organiser
            <main>, rather than being each tab's job — only 3 of the 11 tabs
            set their own padding, so the other 8 rendered flush against the
            sidebar and the window edge. */}
        <main className="flex-1 overflow-auto p-6">
          {grouped && (
            <SubTabs
              active={activeSubId}
              onChange={(id) => setSubTab(prev => ({ ...prev, [section.id]: id }))}
              tabs={section.tabs.map(({ id, label, Icon }) => ({ id, label, Icon }))}
            />
          )}
          <div key={activeLeaf.id}>
            <ActiveComponent />
          </div>
        </main>
      </div>
    </div>
  );
};

export default SupportInterface;
