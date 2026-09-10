// The runner app: one place for the person running the event on the floor.
//
// It replaces two overlapping apps. The Organiser and the Support interface
// both carried Operations, Users and Messages, so the honest question "where
// do I change that?" had two answers and you had to know which. Now there is
// one map (runnerNav) in the order a day actually happens: set it up, run it,
// look back.
//
// The SHELL is on the design system. The panels inside are the existing ones,
// rendered inside `.cq-legacy` so they wear the palette until each is rebuilt
// in its own phase. Nothing was dropped in the merge.
import React, { useState, useEffect } from 'react';
import { Menu, X, Shuffle, LogOut, PanelLeftClose, PanelLeft } from 'lucide-react';
import { AreaMark, SidebarNav, TabBar, Button } from '../../design';
import { NAV, TABS, DEFAULT_TAB, TITLES, SECTIONS, readHash } from './runnerNav';
import useStations from '../../hooks/useStations';
import AuthService from '../../services/AuthService';
import OrderDataService from '../../services/OrderDataService';
import InventoryIntegrationService from '../../services/InventoryIntegrationService';
import { ToastManager } from '../shared/Toast';
import { askConfirm } from '../shared/ConfirmDialog';

// Set up
import QuickSetup from '../organiser/QuickSetup';
import InventoryManagement from '../organiser/InventoryManagement';
import EventStockManagement from '../organiser/EventStockManagement';
import StationInventoryConfig from '../organiser/StationInventoryConfig';
import StationSettings from '../organiser/StationSettings';
import BrandingSettings from '../organiser/BrandingSettings';
import SponsorsPanel from '../organiser/SponsorsPanel';
import LabelsTab from '../organiser/LabelsTab';
import MilkColorSettings from '../organiser/MilkColorSettings';
import EnhancedScheduleManagement from '../organiser/EnhancedScheduleManagement';
import UserManagementTab from '../organiser/UserManagementTab';
import UsersAccessTab from '../support-tabs/UsersAccessTab';
// Run the day
import ReadinessTab from '../organiser/ReadinessTab';
import EnhancedLiveOperationsDashboard from '../support/EnhancedLiveOperationsDashboard';
import DashboardTab from '../support-tabs/DashboardTab';
import AllOrdersTab from '../barista/AllOrdersTab';
import GroupOrdersTab from '../barista/GroupOrdersTab';
import EnhancedCommunicationHub from '../support/EnhancedCommunicationHub';
import SMSTestSimulator from '../support/SMSTestSimulator';
import SmsBlocklistTab from '../support-tabs/SmsBlocklistTab';
import PrintersTab from '../support-tabs/PrintersTab';
import DisplaySelector from '../display/DisplaySelector';
// Review & system
import SystemHealthTab from '../support-tabs/SystemHealthTab';
import DiagnosticsTab from '../support-tabs/DiagnosticsTab';
import EventsAirTab from '../support-tabs/EventsAirTab';
import EventDataManagement from '../organiser/EventDataManagement';
import EmergencyTab from '../support-tabs/EmergencyTab';
import SmsFlowReference from '../organiser/SmsFlowReference';
import NoticeComposer from './NoticeComposer';
import ReportTab from './ReportTab';

const RunnerInterface = () => {
  const { stations, refreshData } = useStations();

  const [activeSection, setActiveSection] = useState(() => (readHash() || {}).section || 'live');
  const [tabBySection, setTabBySection] = useState(() => {
    const h = readHash();
    return { ...DEFAULT_TAB, ...(h && h.tab ? { [h.section]: h.tab } : {}) };
  });
  const activeTab = tabBySection[activeSection];
  const setActiveTab = (id) => setTabBySection((t) => ({ ...t, [activeSection]: id }));

  // Deep links: #section/tab, so a link into Branding → Labels still works
  // (and the old organiser/support hashes are mapped in runnerNav.ALIASES).
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

  useEffect(() => { InventoryIntegrationService.initializeStockServiceIntegration(); }, []);

  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const currentUser = AuthService.getCurrentUser();
  const userLabel = (currentUser && (currentUser.username || currentUser.full_name)) || 'admin';

  const go = (id) => { setActiveSection(id); setMobileNavOpen(false); };

  // Station writes used by the Stations panel. The backend allocates the id
  // on create; the suggestion here is only a fallback.
  const api = async () => new (await import('../../services/ApiService')).default();
  const stationWrite = async (path, options) => {
    try {
      const r = await (await api()).request(path, options);
      if (r && r.success) { refreshData(); return true; }
      console.error('Station write failed:', r && r.error);
      return false;
    } catch (e) { console.error('Station write error:', e); return false; }
  };

  const title = TITLES[activeSection] || activeSection;
  const tabs = TABS[activeSection];

  const content = (
    <>
      {activeSection === 'quickSetup' && <QuickSetup />}

      {activeSection === 'menu' && activeTab === 'inventory' && <InventoryManagement />}
      {activeSection === 'menu' && activeTab === 'stock' && <EventStockManagement />}
      {activeSection === 'menu' && activeTab === 'stationInventory' && <StationInventoryConfig stations={stations} />}

      {activeSection === 'stations' && (
        <StationSettings
          stations={stations}
          onStationUpdate={(stationId, stationData) => stationWrite(`/stations/${stationId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stationData) })}
          onAddStation={(stationData) => stationWrite('/stations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ station_id: Math.max(0, ...stations.map((s) => s.id || 0)) + 1, ...stationData }) })}
          onDeleteStation={(stationId) => stationWrite(`/stations/${stationId}`, { method: 'DELETE' })}
        />
      )}

      {activeSection === 'branding' && activeTab === 'logo' && <BrandingSettings />}
      {activeSection === 'branding' && activeTab === 'sponsors' && <SponsorsPanel />}
      {activeSection === 'branding' && activeTab === 'labels' && <LabelsTab />}
      {activeSection === 'branding' && activeTab === 'milk' && <MilkColorSettings />}

      {activeSection === 'schedule' && <EnhancedScheduleManagement />}

      {activeSection === 'users' && activeTab === 'people' && (
        <div className="bg-cq-milk rounded-cq-md shadow p-6"><UserManagementTab /></div>
      )}
      {activeSection === 'users' && activeTab === 'access' && <UsersAccessTab />}

      {activeSection === 'live' && activeTab === 'readiness' && <ReadinessTab />}
      {activeSection === 'live' && activeTab === 'board' && <EnhancedLiveOperationsDashboard />}
      {activeSection === 'live' && activeTab === 'metrics' && <DashboardTab />}

      {activeSection === 'orders' && activeTab === 'all' && (
        <div className="bg-cq-milk rounded-cq-md shadow p-6"><AllOrdersTab /></div>
      )}
      {activeSection === 'orders' && activeTab === 'groups' && (
        <div className="bg-cq-milk rounded-cq-md shadow">
          <GroupOrdersTab onSubmitGroupOrders={(g) => OrderDataService.submitGroupOrder(g)} />
        </div>
      )}

      {activeSection === 'messages' && activeTab === 'notice' && <NoticeComposer />}
      {activeSection === 'messages' && activeTab === 'broadcast' && <EnhancedCommunicationHub />}
      {activeSection === 'messages' && activeTab === 'test' && <SMSTestSimulator />}
      {activeSection === 'messages' && activeTab === 'blocked' && <SmsBlocklistTab />}

      {/* Every screen CupQ can put on a wall, plus where the look is set. */}
      {activeSection === 'screens' && <div className="cq"><DisplaySelector embedded /></div>}
      {activeSection === 'printers' && <PrintersTab />}

      {activeSection === 'report' && <ReportTab />}

      {activeSection === 'system' && activeTab === 'health' && <SystemHealthTab />}
      {/* Diagnostics already lists the frontend crashes; a separate
          Crashes tab was the same panel twice. */}
      {activeSection === 'system' && activeTab === 'diagnostics' && <DiagnosticsTab />}

      {activeSection === 'eventsair' && <EventsAirTab />}
      {activeSection === 'settings' && <EventDataManagement />}
      {activeSection === 'emergency' && <EmergencyTab />}
      {activeSection === 'help' && <SmsFlowReference />}

      {/* A whitelist, so a section added to NAV without a panel here shows
          this rather than a silently blank page. */}
      {!SECTIONS.includes(activeSection) && (
        <div className="cq bg-cq-milk rounded-cq-lg shadow-cq-card p-6">
          <h2 className="text-xl font-extrabold text-cq-roast">{title}</h2>
          <p className="text-cq-ink-2 mt-1">Nothing lives here yet.</p>
        </div>
      )}
    </>
  );

  return (
    <div className="cq min-h-screen flex">
      <ToastManager />

      {/* Sidebar — desktop */}
      <div className="hidden md:flex flex-col border-r border-cq-line bg-cq-milk">
        <div className={`flex items-center gap-2 px-3 py-4 ${collapsed ? 'justify-center' : ''}`}>
          <AreaMark area="runner" label={collapsed ? null : 'Runner'} />
          {!collapsed && <div className="flex-1" />}
          <button type="button" onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
            className="h-9 w-9 inline-flex items-center justify-center rounded-cq-md text-cq-ink-3 hover:bg-cq-wash hover:text-cq-roast">
            {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav groups={NAV} active={activeSection} onChange={go} collapsed={collapsed} className="border-r-0" />
        </div>
        <div className="p-3 border-t border-cq-line">
          <button type="button" onClick={async () => { if (await askConfirm({ title: 'Sign out of CupQ?', confirmLabel: 'Sign out' })) AuthService.logout(); }}
            className="w-full flex items-center gap-3 h-11 px-3 rounded-cq-md font-semibold text-cq-ink-2 hover:bg-cq-alert-wash hover:text-cq-alert">
            <LogOut size={20} />{!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </div>

      {/* Sidebar — mobile drawer */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-cq-roast/60" onClick={() => setMobileNavOpen(false)} />
          <div className="relative bg-cq-milk h-full overflow-y-auto shadow-cq-raised">
            <div className="flex items-center justify-between px-3 py-4">
              <AreaMark area="runner" />
              <button type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close the menu"
                className="h-11 w-11 inline-flex items-center justify-center rounded-cq-md text-cq-ink-2 hover:bg-cq-wash"><X size={22} /></button>
            </div>
            <SidebarNav groups={NAV} active={activeSection} onChange={go} className="border-r-0" />
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-cq-roast text-cq-cream px-4 py-3 flex items-center gap-3">
          <button type="button" className="md:hidden h-10 w-10 inline-flex items-center justify-center rounded-cq-md hover:bg-cq-milk/10"
            onClick={() => setMobileNavOpen(true)} aria-label="Open the menu"><Menu size={22} /></button>
          <h1 className="text-2xl font-extrabold truncate">{title}</h1>
          <div className="flex-1" />
          <div className="relative">
            <button type="button" onClick={() => setAccountOpen((v) => !v)}
              className="h-10 px-3 inline-flex items-center gap-2 rounded-cq-md bg-cq-milk/10 hover:bg-cq-milk/20 font-bold text-sm">
              <Shuffle size={16} /> <span className="hidden sm:inline">Switch view</span>
            </button>
            {accountOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAccountOpen(false)} />
                <div className="absolute right-0 mt-2 w-52 bg-cq-milk text-cq-ink rounded-cq-lg shadow-cq-raised z-50 overflow-hidden">
                  <div className="px-4 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-cq-ink-3 border-b border-cq-line">
                    Signed in as {userLabel}
                  </div>
                  {[['/barista', 'Barista'], ['/displays', 'Screens'], ['/my', 'Order as a customer']].map(([path, label]) => (
                    <button key={path} type="button" onClick={() => { window.location.href = path; }}
                      className="block w-full text-left px-4 h-11 font-semibold hover:bg-cq-wash">{label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        </header>

        {tabs && (
          <div className="px-4 pt-3">
            <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />
          </div>
        )}

        {/* The panels are the existing ones; `cq-legacy` puts them in the
            palette until each is rebuilt in its own phase. */}
        <main className="cq-legacy flex-1 overflow-y-auto p-4">{content}</main>
      </div>
    </div>
  );
};

export default RunnerInterface;
