import React, { useState, useEffect } from 'react';
import {
  Coffee, Users, Clock, Calendar, Settings, LogOut, Activity, Zap,
  Radio, Package, Boxes, CheckCircle, Menu,
  HelpCircle, Image as ImageIcon, Palette, Tag, Droplet, FileText, ListChecks,
} from 'lucide-react';

import GroupOrdersTab from '../barista/GroupOrdersTab';
import AllOrdersTab from '../barista/AllOrdersTab';
import UserManagementTab from './UserManagementTab';
import EnhancedLiveOperationsDashboard from '../support/EnhancedLiveOperationsDashboard';
import EnhancedCommunicationHub from '../support/EnhancedCommunicationHub';
import BrandingSettings from './BrandingSettings';
import MilkColorSettings from './MilkColorSettings';
import LabelsTab from './LabelsTab';
import EventDataManagement from './EventDataManagement';
import InventoryManagement from './InventoryManagement';
import EventStockManagement from './EventStockManagement';
import StationSettings from './StationSettings';
import StationInventoryConfig from './StationInventoryConfig';
import EnhancedScheduleManagement from './EnhancedScheduleManagement';
import QuickSetup from './QuickSetup';
import ReadinessTab from './ReadinessTab';
import SponsorsPanel from './SponsorsPanel';
import SubTabs from '../shared/SubTabs';
import SmsFlowReference from './SmsFlowReference';
import InventoryIntegrationService from '../../services/InventoryIntegrationService';
import OrderDataService from '../../services/OrderDataService';
import AuthService from '../../services/AuthService';
import useStations from '../../hooks/useStations';
import brandingConfig from '../../config/brandingConfig';

// The sidebar, grouped by the job being done. Every section is at most one
// sub-tab deep, and everything about one thing lives in one section:
//
//   Menu        what the event offers, how much of it, which station carries what
//   Stations    the stations themselves (name, location, walk-in defaults)
//   Branding    logo & look, sponsors, labels (stickers), milk colours
//   Schedule    the sessions, and the day's phases
//   Operations  readiness before doors, the live board, messages to stations/customers
//
// Before this: labels were in Support -> Printers, the sponsor thank-you
// line was on the Branding form while the logos had their own sidebar
// item, and the menu lived under "Stations" — three doors for the one
// idea. (Steve: "menus have lots of sub menus and are not all in similar
// or logical place.")
const NAV = [
  { heading: 'Set up', items: [
    { id: 'quickSetup', label: 'Quick Setup', Icon: Zap },
    { id: 'menu',       label: 'Menu',        Icon: Package },
    { id: 'stations',   label: 'Stations',    Icon: Coffee },
    { id: 'branding',   label: 'Branding',    Icon: Palette },
    { id: 'schedule',   label: 'Schedule',    Icon: Calendar },
    { id: 'users',      label: 'Users',       Icon: Users },
  ] },
  { heading: 'Run the day', items: [
    { id: 'operations', label: 'Operations',  Icon: Activity },
    { id: 'orders',     label: 'Orders',      Icon: Clock },
  ] },
  { heading: 'Review & system', items: [
    { id: 'settings',   label: 'Settings',    Icon: Settings },
    { id: 'help',       label: 'Help',        Icon: HelpCircle },
  ] },
];

// Sub-tabs per section. A section not listed here has no tab bar.
const TABS = {
  menu: [
    { id: 'inventory',        label: 'Event Inventory',   Icon: ListChecks },
    { id: 'stock',            label: 'Event Stock',       Icon: Boxes },
    { id: 'stationInventory', label: 'Station Inventory', Icon: Coffee },
  ],
  branding: [
    { id: 'logo',     label: 'Logo & look',  Icon: Palette },
    { id: 'sponsors', label: 'Sponsors',     Icon: ImageIcon },
    { id: 'labels',   label: 'Labels',       Icon: Tag },
    { id: 'milk',     label: 'Milk colours', Icon: Droplet },
  ],
  operations: [
    { id: 'readiness', label: 'Readiness', Icon: CheckCircle },
    { id: 'live',      label: 'Live',      Icon: Activity },
    { id: 'messages',  label: 'Messages',  Icon: Radio },
  ],
  orders: [
    { id: 'all',    label: 'All Orders',   Icon: Clock },
    { id: 'groups', label: 'Group Orders', Icon: FileText },
  ],
};

// Operations opens on Live so the landing screen is the one you watch
// during service; everything else opens on its first tab.
const DEFAULT_TAB = {
  menu: 'inventory', branding: 'logo',
  operations: 'live', orders: 'all',
};

const KNOWN_SECTIONS = NAV.flatMap((g) => g.items.map((i) => i.id));

// Header title per screen.
const TITLES = {
  quickSetup: 'Quick Setup',
  menu: { inventory: 'Event Inventory', stock: 'Event Stock', stationInventory: 'Station Inventory' },
  stations: 'Stations',
  branding: { logo: 'Logo & look', sponsors: 'Sponsors', labels: 'Labels & stickers', milk: 'Milk colours' },
  schedule: 'Event Schedule',
  users: 'Users',
  operations: { readiness: 'Event Readiness', live: 'Live Operations', messages: 'Messages' },
  orders: { all: 'All Orders', groups: 'Group Orders' },
  settings: 'Event Data',
  help: 'How the SMS Bot Works',
};

// Deep links: /organiser#section or #section/tab (e.g. #branding/labels),
// so Support, Readiness and the docs can point at an exact screen, and a
// bookmark or the back button lands where you were.
const readHash = () => {
  const [s, t] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (!KNOWN_SECTIONS.includes(s)) return null;
  const tabs = TABS[s];
  const tab = tabs && tabs.some((x) => x.id === t) ? t : (DEFAULT_TAB[s] || null);
  return { section: s, tab };
};

/**
 * Organiser Interface Component
 * Main interface for event organizers and admins
 */
const OrganiserInterface = () => {
  const { stations, refreshData } = useStations();

  // Navigation state — which section, and which tab within each section
  // (remembered per section so switching away and back keeps your place).
  const [activeSection, setActiveSection] = useState(() => (readHash() || {}).section || 'operations');
  const [tabBySection, setTabBySection] = useState(() => {
    const h = readHash();
    return { ...DEFAULT_TAB, ...(h && h.tab ? { [h.section]: h.tab } : {}) };
  });
  const activeTab = tabBySection[activeSection];
  const setActiveTab = (id) => setTabBySection((t) => ({ ...t, [activeSection]: id }));

  // Keep the URL hash in step (replace, not push — tabs shouldn't pile up
  // in the back-button history), and follow it when something else
  // changes it (a link inside the app).
  useEffect(() => {
    const want = TABS[activeSection] ? `#${activeSection}/${tabBySection[activeSection]}` : `#${activeSection}`;
    if (window.location.hash !== want) window.history.replaceState(null, '', want);
  }, [activeSection, tabBySection]);
  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      if (!h) return;
      setActiveSection(h.section);
      if (h.tab) setTabBySection((t) => ({ ...t, [h.section]: h.tab }));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Account menu (the top-right avatar) + working log out.
  const [accountOpen, setAccountOpen] = useState(false);
  const currentUser = AuthService.getCurrentUser();
  const userLabel = (currentUser && (currentUser.username || currentUser.full_name)) || 'admin';
  const userInitial = (userLabel[0] || 'A').toUpperCase();
  const handleLogout = () => {
    if (window.confirm('Log out of CupQ?')) {
      AuthService.logout();
    }
  };

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Mobile: the sidebar becomes an off-canvas drawer toggled by the header menu button.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    // Stations are loaded by the useStations hook
    InventoryIntegrationService.initializeStockServiceIntegration();
  }, []);

  const titleFor = TITLES[activeSection];
  const title = typeof titleFor === 'string' ? titleFor : ((titleFor && titleFor[activeTab]) || activeSection);

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
          {NAV.map(({ heading, items }, gi) => (
            <div key={heading} className={gi === 0 ? '' : 'mt-4'}>
              {sidebarOpen ? (
                <div className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{heading}</div>
              ) : (
                gi !== 0 && <div className="mx-3 mb-2 border-t border-gray-200" />
              )}
              <div className="space-y-1">
                {items.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    className={`w-full flex items-center px-3 py-2 rounded-md ${
                      activeSection === id
                        ? 'bg-amber-100 text-amber-800'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    onClick={() => setActiveSection(id)}
                    title={sidebarOpen ? undefined : label}
                  >
                    <Icon size={20} className="mr-3 flex-shrink-0" />
                    {sidebarOpen && <span>{label}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
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
            <h1 className="text-base sm:text-xl font-bold text-gray-800 truncate">{title}</h1>
          </div>

          <div className="flex items-center space-x-4">
            {/* Account menu — click the avatar for the logged-in user + a
                working Log out. */}
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

        <main className="p-3 sm:p-6">
          {/* One tab bar for every grouped section, so they all look and
              behave the same. */}
          {TABS[activeSection] && (
            <SubTabs active={activeTab} onChange={setActiveTab} tabs={TABS[activeSection]} />
          )}

          {/* Quick Setup — the one-page event configuration. (The second
              door, a 12-question wizard modal, was retired in the
              re-imagining: one way to set up an event.) */}
          {activeSection === 'quickSetup' && <QuickSetup />}

          {/* Menu — what this event offers, how much there is, which
              stations carry what. All three are server-backed; the old
              localStorage 'Menu Items' store was retired long ago. */}
          {activeSection === 'menu' && activeTab === 'inventory' && <InventoryManagement />}
          {activeSection === 'menu' && activeTab === 'stock' && <EventStockManagement />}
          {activeSection === 'menu' && activeTab === 'stationInventory' && <StationInventoryConfig stations={stations} />}

          {/* Stations — the stations themselves. Walk-in defaults live
              inside Station Settings against the station being edited. */}
          {activeSection === 'stations' && (
            <StationSettings
              stations={stations}
              onStationUpdate={async (stationId, stationData) => {
                // ApiService is exported as a class — must be instantiated
                // before calling request().
                try {
                  const { default: ApiServiceClass } = await import('../../services/ApiService');
                  const apiService = new ApiServiceClass();
                  const response = await apiService.request(`/stations/${stationId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(stationData),
                  });
                  if (response.success) {
                    refreshData();
                    return true;
                  }
                  console.error('Failed to update station:', response.error);
                  return false;
                } catch (error) {
                  console.error('Error updating station:', error);
                  return false;
                }
              }}
              onAddStation={async (stationData) => {
                try {
                  const { default: ApiServiceClass } = await import('../../services/ApiService');
                  const apiService = new ApiServiceClass();
                  // Backend auto-assigns station_id when omitted (see
                  // routes/station_api_routes.py create_station). We send a
                  // client-suggested id as a fallback, but the server-side
                  // allocation is the source of truth.
                  const newStationId = Math.max(0, ...stations.map(s => s.id || 0)) + 1;
                  const response = await apiService.request('/stations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ station_id: newStationId, ...stationData }),
                  });
                  if (response.success) {
                    refreshData();
                    return true;
                  }
                  console.error('Failed to add station:', response.error);
                  return false;
                } catch (error) {
                  console.error('Error adding station:', error);
                  return false;
                }
              }}
              onDeleteStation={async (stationId) => {
                try {
                  const { default: ApiServiceClass } = await import('../../services/ApiService');
                  const apiService = new ApiServiceClass();
                  const response = await apiService.request(`/stations/${stationId}`, {
                    method: 'DELETE',
                  });
                  if (response.success) {
                    refreshData();
                    return true;
                  }
                  console.error('Failed to delete station:', response.error);
                  return false;
                } catch (error) {
                  console.error('Error deleting station:', error);
                  return false;
                }
              }}
            />
          )}

          {/* Branding — logo & look, sponsors, labels, milk colours. */}
          {activeSection === 'branding' && activeTab === 'logo' && <BrandingSettings />}
          {activeSection === 'branding' && activeTab === 'sponsors' && <SponsorsPanel />}
          {activeSection === 'branding' && activeTab === 'labels' && <LabelsTab />}
          {activeSection === 'branding' && activeTab === 'milk' && <MilkColorSettings />}

          {/* Schedule — the real, server-backed session agenda. (The
              "Phases" tab described a generic hardcoded day and never read
              these sessions; retired.) */}
          {activeSection === 'schedule' && <EnhancedScheduleManagement />}

          {/* Users */}
          {activeSection === 'users' && (
            <div className="bg-white rounded-lg shadow p-6">
              <UserManagementTab />
            </div>
          )}

          {/* Operations — Readiness (pre-doors checks, test SMS, admin
              alerts), Live (the during-service board) and Messages
              (broadcasts to stations and customers). Same operator, same
              day, one click apart. */}
          {activeSection === 'operations' && activeTab === 'readiness' && <ReadinessTab />}
          {activeSection === 'operations' && activeTab === 'live' && <EnhancedLiveOperationsDashboard />}
          {activeSection === 'operations' && activeTab === 'messages' && <EnhancedCommunicationHub />}

          {/* Orders — individual orders and group orders. */}
          {activeSection === 'orders' && activeTab === 'all' && (
            <div className="bg-white rounded-lg shadow p-6">
              <AllOrdersTab />
            </div>
          )}
          {activeSection === 'orders' && activeTab === 'groups' && (
            <div className="bg-white rounded-lg shadow">
              <GroupOrdersTab
                onSubmitGroupOrders={(groupOrder) => OrderDataService.submitGroupOrder(groupOrder)}
              />
            </div>
          )}

          {/* Insights (Analytics / Queue / Forecast) retired: sample data
              and controls that persisted nothing. The Report (roadmap
              phase 7) takes this slot with real numbers. */}

          {/* Settings — the per-client Event Data lifecycle (export / wipe /
              re-import). "Configure the installation" rather than "run the
              event". */}
          {activeSection === 'settings' && <EventDataManagement />}

          {/* Help — operator documentation. Currently the SMS bot flow
              reference; add further explainers here rather than adding
              sidebar items. */}
          {activeSection === 'help' && <SmsFlowReference />}

          {/* Unknown section fallback — a whitelist, so a new section that
              forgets to register in NAV shows this instead of silently
              doubling up. */}
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
