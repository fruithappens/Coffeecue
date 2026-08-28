// components/BaristaInterface.js
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import startConnectionWatchdog from '../../utils/connectionWatchdog';
import StationPrinterPanel from '../barista-tabs/StationPrinterPanel';
import EightySixBoard from '../barista-tabs/EightySixBoard';
import { ToastManager, showToast } from '../shared/Toast';
import AuthService from '../../services/AuthService';
import printService from '../../services/PrintService';
import BroadcastDialog from '../dialogs/BroadcastDialog';
import { 
  Coffee, Package, Calendar, Check, Monitor, Settings,
  MessageCircle, Printer, Plus, Clock,
  Bell, XCircle, RefreshCw, Edit, ArrowLeft, ChevronDown,
  Send, CheckCircle, Brain, Scale, Users, MoreHorizontal, Wrench, Shuffle,
  Truck, Maximize2, Minimize2, ArrowRightLeft,
} from 'lucide-react';

// Import app mode context
import { useAppMode } from '../../context/AppContext';

// Import the custom hooks for order, station, stock, and schedule management
import useOrders from '../../hooks/useOrders';
import useStations from '../../hooks/useStations';
import useStock from '../../hooks/useStock';
import useSchedule from '../../hooks/useSchedule';
import {
  getOrderBackgroundColor,
  getTimeRatioColor,
  formatTimeSince,
  formatBatchName,
  calculateMinutesDiff,
  buildGroupInfo,
  applicableStages
} from '../../utils/orderUtils';
import { getMilkColorStyle, getMilkDotStyle } from '../../utils/milkColorHelper';
import '../../styles/milkColors.css';

// Import services and utilities
import MessageService from '../../services/MessageService';
import SettingsService from '../../services/SettingsService';
import OrderDataService from '../../services/OrderDataService';
import ChatService from '../../services/ChatService';
import InventoryIntegrationService from '../../services/InventoryIntegrationService';
import SoundNotificationService, {
  SOUND_PRESETS,
  DEFAULT_SOUND_CHOICES,
} from '../../services/SoundNotificationService';

// Import components
import MessageDialog from '../dialogs/MessageDialog';
import MoveOrderDialog from '../dialogs/MoveOrderDialog';
import WaitTimeDialog from '../dialogs/WaitTimeDialog';
import WalkInOrderDialog from '../dialogs/WalkInOrderDialog';
import EditOrderDialog from '../dialogs/EditOrderDialog';
import useCustomerQuestions from '../../hooks/useCustomerQuestions';
import CustomerQuestionsList from './CustomerQuestionsList';
import ToolsTab from '../barista-tabs/ToolsTab';
// Using inline help dialog instead of importing external component
import StationChat from '../support/StationChat';
import OrderNotificationHandler from '../shared/OrderNotificationHandler';
import PendingOrdersSection from './PendingOrdersSection';
import '../../styles/boardDensity.css';
import {
  filterByMilk, milkOptions, sortCurrentOrders, summariseMilk,
} from '../../utils/currentOrderView';
import GroupBadge from './GroupBadge';
import SourceBadge from './SourceBadge';
import RushMixStrip from './RushMixStrip';
import QueueIntelligence from '../support/QueueIntelligence';
import StationLoadBalancer from '../support/StationLoadBalancer';
import DynamicStaffAllocation from '../organiser/DynamicStaffAllocation';
import MultiLevelInventory from '../organiser/MultiLevelInventory';
import StationCapabilitiesEditor from './StationCapabilitiesEditor';
import EnhancedStationCapabilities from '../organiser/EnhancedStationCapabilities';

// True-to-life display preview: the REAL /display page in an iframe,
// rendered at external-screen size (1280×720, 16:9) and scaled down to
// fit its container — so what the operator sees IS what the TV shows,
// live, flips and all. pointer-events off: it's a preview, not a portal.
const ScaledDisplayPreview = ({ url }) => {
  const wrapRef = React.useRef(null);
  const [scale, setScale] = React.useState(0.3);
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setScale((el.clientWidth || 384) / 1280);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return (
    <div ref={wrapRef}
         className="relative w-full overflow-hidden rounded-lg border bg-gray-900"
         style={{ aspectRatio: '16 / 9' }}>
      <iframe
        title={`Display preview ${url}`}
        src={url}
        style={{ width: 1280, height: 720, transform: `scale(${scale})`,
                 transformOrigin: 'top left', border: 0, pointerEvents: 'none' }}
      />
    </div>
  );
};

const BaristaInterface = () => {
  // Self-heal after a network outage (same watchdog as the displays,
  // longer idle guard: a barista mid-edit must never lose their screen;
  // the reload waits for two quiet minutes).
  useEffect(() => startConnectionWatchdog({ idleMs: 120000 }), []);
  // Use the AppMode context
  const { isDemoMode, toggleAppMode } = useAppMode();

  // Use the stations hook to get stations from the backend
  const {
    stations,
    selectedStation,
    loading: stationsLoading,
    changeSelectedStation,
    updateStation,
    updateStationStatus,
    refreshData: refreshStations
  } = useStations();

  // State for showing station selector dropdown
  const [showStationSelector, setShowStationSelector] = useState(false);
  // Auto-refresh interval picker (header pill) open/closed
  const [showRefreshMenu, setShowRefreshMenu] = useState(false);
  // Admin-only "Switch view" dropdown in the header (replaces the floating
  // cross-interface switcher on this screen).
  const [showViewSwitch, setShowViewSwitch] = useState(false);
  
  // Use schedule hook to get schedule data
  const {
    scheduleData,
    loading: scheduleLoading,
    error: scheduleError,
    setStation: setScheduleStation,
    refreshData: refreshScheduleData
  } = useSchedule();

  // Use the custom hook for order management with station filtering
  const {
    pendingOrders,
    inProgressOrders,
    completedOrders,
    previousOrders,
    historyOrders,
    yesterdayOrders,
    thisWeekOrders,
    searchResults,
    vipOrders,
    regularOrders,
    batchGroups,
    queueCount,
    online,
    loading,
    error,
    lastUpdated,
    isRefreshing,
    
    // New auto-refresh properties
    autoRefreshEnabled,
    autoRefreshInterval,
    toggleAutoRefresh,
    updateAutoRefreshInterval,
    
    startOrder,
    completeOrder,
    markOrderPickedUp,
    processBatch,
    processBatchSelection,
    addWalkInOrder,
    sendMessage,
    reassignOrder,
    updateWaitTime,
    clearError,
    refreshData,
    // History actions
    fetchYesterdayOrders,
    fetchThisWeekOrders,
    searchOrders,
    getOrderHistory
  } = useOrders(selectedStation);
  
  // UI State
  // Load active tab from localStorage or default to 'orders'
  const loadActiveTab = () => {
    try {
      const saved = localStorage.getItem('coffee_cue_active_tab');
      if (saved) {
        return saved;
      }
    } catch (error) {
      console.error('Error loading active tab from localStorage:', error);
    }
    return 'orders';
  };
  
  const [activeTab, setActiveTabState] = useState(loadActiveTab());

  // Label printer (Star mC-Label3 via CloudPRNT). The list is polled so the
  // header chip tracks online/offline; auto-print is a per-DEVICE choice
  // (this tablet opts in), stored in localStorage per station.
  const [printers, setPrinters] = useState([]);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [autoPrintLabels, setAutoPrintLabelsState] = useState(false);
  // Current column view controls. Local state, not settings: these are
  // "what am I looking at right now" rather than a preference, and a
  // barista who filters to oat should not find it still filtered
  // tomorrow morning.
  const [currentSort, setCurrentSort] = useState('oldest');
  const [currentMilkFilter, setCurrentMilkFilter] = useState('');
  // Notification hold: while it is on, completed orders do not text the
  // customer -- they queue up and go out together when released.
  const [holdState, setHoldState] = useState(null);
  const [holdBusy, setHoldBusy] = useState(false);
  const [printingQueue, setPrintingQueue] = useState(false);
  // Today's numbers for this station. Polled rather than derived from
  // completedOrders because that list is capped at 50 -- past fifty
  // coffees the tally would silently stop climbing, which is the exact
  // moment a barista most needs to trust it.
  const [sessionStats, setSessionStats] = useState(null);
  const [showSessionReport, setShowSessionReport] = useState(false);
  const refreshSession = useCallback(async () => {
    try {
      const api = new (await import('../../services/ApiService')).default();
      const r = await api.get('/reports/today');
      if (r?.success !== false) setSessionStats(r);
    } catch (e) { /* the tally is nice to have, the board is not */ }
  }, []);
  useEffect(() => {
    refreshSession();
    const t = setInterval(refreshSession, 30000);
    return () => clearInterval(t);
  }, [refreshSession]);
  // Coffees finished at THIS station today.
  const madeToday = React.useMemo(() => {
    const per = sessionStats?.per_station;
    if (!Array.isArray(per)) return null;
    const mine = per.find(p => String(p.station_id) === String(selectedStation));
    return mine ? (mine.completed ?? mine.orders ?? null) : 0;
  }, [sessionStats, selectedStation]);
  const refreshHold = useCallback(async () => {
    try {
      const api = new (await import('../../services/ApiService')).default();
      const r = await api.get('/notifications/hold');
      if (r?.success) setHoldState(r);
    } catch (e) { /* the board matters more than this pill */ }
  }, []);
  useEffect(() => {
    refreshHold();
    const t = setInterval(refreshHold, 20000);
    return () => clearInterval(t);
  }, [refreshHold]);
  useEffect(() => {
    let cancelled = false;
    const loadPrinters = async () => {
      const list = await printService.getPrinters();
      if (!cancelled) setPrinters(list);
    };
    loadPrinters();
    const timer = setInterval(loadPrinters, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  useEffect(() => {
    setAutoPrintLabelsState(printService.isAutoPrintEnabled(selectedStation));
  }, [selectedStation]);
  const stationPrinter = printService.findStationPrinter(printers, selectedStation);

  // Label roll. Declared AFTER stationPrinter on purpose: the dependency
  // array is evaluated during render, so referencing stationPrinter from
  // above its own `const` threw a temporal-dead-zone ReferenceError and
  // the whole Barista Interface fell into the error boundary. The build
  // was perfectly happy about it.
  //
  // Polled slowly -- a roll takes hours to run down, and the value is a
  // heads-up in time to change it during a lull, not a live gauge.
  const [labelRoll, setLabelRoll] = useState(null);
  const refreshRoll = useCallback(async () => {
    if (!stationPrinter?.id) { setLabelRoll(null); return; }
    try {
      const r = await printService.getRolls(stationPrinter.id);
      setLabelRoll((r?.rolls || [])[0] || null);
    } catch (e) { /* non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationPrinter?.id]);
  useEffect(() => {
    refreshRoll();
    const t = setInterval(refreshRoll, 120000);
    return () => clearInterval(t);
  }, [refreshRoll]);
  const setAutoPrintLabels = (enabled) => {
    printService.setAutoPrint(selectedStation, enabled);
    setAutoPrintLabelsState(enabled);
  };

  // Team mode: multiple baristas sharing THIS iPad divide an order into
  // stages (shots / milk) and tick their part on the card. Per-device
  // like auto-print — the iPad is the station's screen.
  const [teamMode, setTeamModeState] = useState(false);
  useEffect(() => {
    setTeamModeState(localStorage.getItem(
      `coffee_cue_team_mode_station_${selectedStation}`) === 'true');
  }, [selectedStation]);
  const setTeamMode = (enabled) => {
    try {
      localStorage.setItem(`coffee_cue_team_mode_station_${selectedStation}`,
        enabled ? 'true' : 'false');
    } catch (e) { /* device pref only */ }
    setTeamModeState(enabled);
  };
  // Optimistic local stage state layered over the polled value so a tap
  // feels instant; the next poll reconciles with the server.
  const [stageOverrides, setStageOverrides] = useState({});
  const orderStages = (order) => ({
    ...(order.stages || {}),
    ...(stageOverrides[order.id] || {}),
  });
  // Which stages apply to a drink lives in orderUtils.applicableStages
  // (shared with the pending work-type tags). More helpers than chips is
  // fine — chips are per-stage, not per-person.
  const toggleStage = async (order, stage) => {
    const current = !!orderStages(order)[stage];
    const next = !current;
    setStageOverrides(s => ({
      ...s,
      [order.id]: { ...(s[order.id] || {}), [stage]: next ? new Date().toISOString() : undefined },
    }));
    try {
      const resp = await fetch(`/api/orders/${order.id}/stage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
        },
        body: JSON.stringify({ stage, done: next }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch (e) {
      // Revert the optimistic tick and say so — a silent placebo tick
      // would tell the other barista a stage is done when it isn't.
      setStageOverrides(s => ({
        ...s,
        [order.id]: { ...(s[order.id] || {}), [stage]: current ? new Date().toISOString() : undefined },
      }));
      showToast(`Couldn't save the ${stage} tick - try again`, 'error');
    }
  };

  // Role gate for manager-only tabs. A plain BARISTA on the floor should
  // see order-flow tools only (Orders, Stock, Inventory AI, Schedule,
  // Completed). Event-configuration tabs — Display, Queue AI (routing),
  // Balance, Capabilities (drives SMS routing!), Staff, Settings — are
  // organiser/admin concerns and are hidden from plain baristas. The
  // /barista route is also used by admin/staff, who keep full access.
  // Audit 2026-06-12: a barista editing Capabilities could silently
  // misroute every SMS order, so this gate is a real safety fix, not
  // just tidiness.
  const _currentRole = (() => {
    try { return (AuthService.getCurrentUser()?.role || '').toLowerCase(); }
    catch (_) { return ''; }
  })();
  // Accept every organiser-role spelling/variant so a user created as
  // 'event_organizer' gets the manager tabs too (was missing it).
  const isManager = ['admin', 'staff', 'organizer', 'organiser', 'event_organizer'].includes(_currentRole);
  const MANAGER_ONLY_TABS = ['display', 'queue', 'balance', 'capabilities', 'staff', 'settings'];

  // Desktop tab bar, grouped by the job being done. Twelve tabs in one
  // row had become a wall of similar-looking words — Stock next to
  // Inventory, Queue Rules next to Balance, Staff next to Schedule —
  // where the difference between neighbours was not obvious from the
  // label.
  //
  // activeTab still holds the LEAF id, so every `activeTab === 'stock'`
  // content block below is untouched, and the mobile bottom bar (which
  // sets leaf ids directly) keeps working as it is.
  const BARISTA_GROUPS = [
    { id: 'orders',    label: 'Orders',    Icon: Coffee, tab: 'orders' },
    { id: 'completed', label: 'Completed', Icon: Check,  tab: 'completed' },
    { id: 'stockGrp',  label: 'Stock',     Icon: Package, tabs: [
        // Same subject, different scope: what this station has in front
        // of it, versus every station plus forecasting.
        { id: 'stock',     label: 'This Station', Icon: Package },
        { id: 'inventory', label: 'All Stations', Icon: Truck },
      ] },
    { id: 'queueGrp',  label: 'Queue',     Icon: Brain, tabs: [
        { id: 'queue',   label: 'Rules',   Icon: Brain },
        { id: 'balance', label: 'Balance', Icon: Scale },
      ] },
    { id: 'teamGrp',   label: 'Team',      Icon: Users, tabs: [
        { id: 'staff',    label: 'Staff',    Icon: Users },
        { id: 'schedule', label: 'Schedule', Icon: Calendar },
      ] },
    { id: 'stationGrp', label: 'Station',  Icon: Settings, tabs: [
        { id: 'capabilities', label: 'Capabilities', Icon: Settings },
        { id: 'display',      label: 'Display',      Icon: Monitor },
        { id: 'settings',     label: 'Settings',     Icon: Settings },
      ] },
    { id: 'tools',     label: 'Tools',     Icon: Wrench, tab: 'tools' },
  ];

  // Wrapper function to persist active tab when it changes
  const setActiveTab = (tab) => {
    setActiveTabState(tab);
    try {
      localStorage.setItem('coffee_cue_active_tab', tab);
      console.log('Saved active tab to localStorage:', tab);
    } catch (error) {
      console.error('Error saving active tab to localStorage:', error);
    }
  };

  // If a plain barista has a stale active tab pointing at a now-hidden
  // manager-only tab (e.g. restored from localStorage), bounce them to
  // Orders so they don't land on a blank/gated view.
  useEffect(() => {
    if (!isManager && MANAGER_ONLY_TABS.includes(activeTab)) {
      setActiveTab('orders');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, activeTab]);
  
  // Remembers which leaf each group was last on, so leaving a group and
  // coming back returns to the screen you were using rather than the
  // first one.
  const [groupSubTab, setGroupSubTab] = useState({});
  // Text the operator is typing into the refresh-interval box. Separate from
  // autoRefreshInterval so a half-typed number is not fought by the setter.
  const [refreshDraft, setRefreshDraft] = useState('');
  // Seed and re-sync the draft whenever the live value changes elsewhere
  // (the header's quick picker, or a value restored from storage).
  useEffect(() => {
    setRefreshDraft(String(autoRefreshInterval ?? ''));
  }, [autoRefreshInterval]);

  // State to track dismissed info panels
  const [dismissedPanels, setDismissedPanels] = useState(() => {
    // Try to load from localStorage
    try {
      const saved = localStorage.getItem('dismissed_info_panels');
      return saved ? JSON.parse(saved) : {
        stockInfoPanel: false,
        scheduleInfoPanel: false,
        historyInfoPanel: false,
        displayInfoPanel: false
      };
    } catch (e) {
      console.error('Error loading dismissed panels state:', e);
      return {
        stockInfoPanel: false,
        scheduleInfoPanel: false,
        historyInfoPanel: false,
        displayInfoPanel: false
      };
    }
  });
  
  // Function to dismiss a panel
  const dismissPanel = useCallback((panelId) => {
    setDismissedPanels(prev => {
      const updated = { ...prev, [panelId]: true };
      // Save to localStorage
      localStorage.setItem('dismissed_info_panels', JSON.stringify(updated));
      return updated;
    });
  }, []);
  
  // Function to restore all panels
  const restoreAllPanels = useCallback(() => {
    // Honest feedback: say how many panels were actually restored —
    // clicking it with nothing dismissed used to do nothing visible.
    const dismissedCount = Object.values(dismissedPanels || {}).filter(Boolean).length;
    const resetState = {
      stockInfoPanel: false,
      scheduleInfoPanel: false,
      historyInfoPanel: false,
      displayInfoPanel: false
    };
    setDismissedPanels(resetState);
    localStorage.setItem('dismissed_info_panels', JSON.stringify(resetState));
    showToast(dismissedCount > 0
      ? `${dismissedCount} dismissed info panel${dismissedCount === 1 ? '' : 's'} restored — check the Stock / Schedule / Display tabs`
      : 'No info panels were dismissed — nothing to restore', 'info');
  }, [dismissedPanels]);
  
  // Handle tab changes to ensure data persists
  // Initialize inventory integration on component mount
  useEffect(() => {
    console.log('Initializing inventory integration service for BaristaInterface');
    InventoryIntegrationService.initializeStockServiceIntegration();
  }, []);

  useEffect(() => {
    console.log(`Tab changed to: ${activeTab}`);
    
    // Ensure station consistency before refreshing
    if (selectedStation) {
      localStorage.setItem('coffee_cue_selected_station', selectedStation.toString());
      localStorage.setItem('last_used_station_id', selectedStation.toString());
    }
    
    // When switching to in-progress tab, force a refresh to ensure data is loaded
    if (activeTab === 'in-progress') {
      console.log(`Switched to in-progress tab - refreshing data for station ${selectedStation}`);
      // Use setTimeout to ensure station state is fully applied
      setTimeout(() => {
        refreshData();
      }, 50);
    }
    
  }, [activeTab, refreshData, selectedStation]);
  const [historyTab, setHistoryTab] = useState('completed');
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [batchModeActive, setBatchModeActive] = useState(false);
  const [waitTime, setWaitTime] = useState(2); // Default wait time of 2 minutes
  const [selectedOrders, setSelectedOrders] = useState(new Set());
  const [chatOpen, setChatOpen] = useState(false);
  // Which tab the Messages bubble shows: customer 'questions' or station 'chat'.
  const [messagesTab, setMessagesTab] = useState('questions');
  // Live pending customer-questions — count drives the Messages badge (replaces
  // the old hardcoded `unreadMessages = 2` that always showed a fake "2").
  const cq = useCustomerQuestions();
  const [filter, setFilter] = useState('all');
  
  // Effect to ensure settings are synced with selected station
  // Use useRef to track if we've already synced this station to avoid unnecessary updates
  const lastSyncedStation = useRef(null);
  
  useEffect(() => {
    // Skip if nothing has changed or we don't have a valid selection
    if (!selectedStation || !stations.length) return;
    if (lastSyncedStation.current === selectedStation) return;
    
    console.log(`Syncing settings for station ${selectedStation}`);
    
    const station = stations.find(s => s.id === selectedStation);
    if (station) {
      // Update our ref to avoid repeated updates for the same station
      lastSyncedStation.current = selectedStation;
      
      // Get station-specific barista name
      const stationBaristaName = getStationBaristaName(selectedStation);
      
      // Try to get custom station name from localStorage first
      let stationName = station.name;
      try {
        const customName = localStorage.getItem(`coffee_station_name_${selectedStation}`);
        if (customName) {
          console.log(`Using custom name from localStorage for station ${selectedStation}: ${customName}`);
          stationName = customName;
        }
      } catch (e) {
        console.error(`Error getting custom name for station ${selectedStation}:`, e);
      }
      
      setSettings(prev => ({
        ...prev,
        stationName: stationName,
        stationLocation: station.location || '',
        baristaName: stationBaristaName
      }));
      
      // Also initialize ChatService with the correct names
      ChatService.initialize(
        selectedStation, 
        stationName,
        stationBaristaName
      );

      // REMOVED: Force sync that was overwriting depleted stock levels
      // The StockService now handles loading stock data properly with depletion preservation
      // setTimeout(() => {
      //   console.log(`Force syncing inventory for station ${selectedStation}`);
      //   InventoryIntegrationService.forceSyncStation(selectedStation);
      // }, 100);
      
      // Update schedule station
      setScheduleStation(selectedStation);
    }
  }, [selectedStation, stations, setScheduleStation]);
  
  // Dialog State
  const [showWaitTimeDialog, setShowWaitTimeDialog] = useState(false);
  const [showWalkInDialog, setShowWalkInDialog] = useState(false);
  const [showMessageDialog, setShowMessageDialog] = useState(false);
  // Move-order dialog: opened when the barista taps the move icon on a
  // pending card (e.g. ran out of oat milk; push this oat order to
  // another station rather than disappointing the customer).
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [orderToMove, setOrderToMove] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [currentMessageOrder, setCurrentMessageOrder] = useState(null);
  // Mobile-only: the bottom tab bar's "More" sheet (manager tabs).
  const [showMobileMore, setShowMobileMore] = useState(false);

  // NEW: Message status tracking
  const [messageStatus, setMessageStatus] = useState({});
  const [successMessage, setSuccessMessage] = useState('');
  const [showDisplayScreen, setShowDisplayScreen] = useState(false);
  // QR popup for the Screen-links card ({url, label} or null).
  const [screenLinkQr, setScreenLinkQr] = useState(null);

  // Low-stock watch. The backend has had /inventory/low-stock all along
  // but NOTHING in the barista UI read it — Steve sat at station 1 with
  // the bean counter at zero and never saw a whisper. Poll it, show a
  // persistent red banner, toast + sound ONCE per item (no nagging).
  const [lowStockItems, setLowStockItems] = useState([]);
  const alertedLowStockRef = useRef(new Set());
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const api = new (await import('../../services/ApiService')).default();
        const r = await api.get(`/inventory/low-stock?station_id=${selectedStation}`);
        if (cancelled) return;
        const items = (r && r.items) || [];
        setLowStockItems(items);
        const fresh = items.filter(i => !alertedLowStockRef.current.has(i.id));
        if (fresh.length > 0) {
          fresh.forEach(i => alertedLowStockRef.current.add(i.id));
          const names = fresh.map(i =>
            `${i.name} (${parseFloat(i.amount) || 0}${i.unit ? ` ${i.unit}` : ''} left)`).join(', ');
          showToast(`⚠ LOW STOCK: ${names} — restock or turn the item off in Stock`, 'error', 10000);
          try {
            window.dispatchEvent(new CustomEvent('stock:alert'));
          } catch (_) { /* very old browsers */ }
        }
      } catch (e) {
        console.warn('low-stock check failed (non-fatal):', e?.message);
      }
    };
    check();
    const t = setInterval(check, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, [selectedStation]);
  // In-page preview popup for a screen link ({url, label} or null).
  const [screenLinkPreview, setScreenLinkPreview] = useState(null);
  // Which station the Screen-links card shows (null = the active one).
  const [linkStation, setLinkStation] = useState(null);

  // Use the stock hook for station-specific stock management
  const {
    stockItems,
    stockCategories,
    loading: stockLoading,
    error: stockError,
    getCategoryStock,
    updateStockItem,
    addStockItem,
    deleteStockItem,
    resetStock,
    getLowStockCount
  } = useStock(selectedStation, stations.find(s => s.id === selectedStation)?.name || 'Coffee Station');
  
  const [selectedStockCategory, setSelectedStockCategory] = useState('milk');
  
  // Get low stock counts for notifications
  const { lowCount, criticalCount } = getLowStockCount();
  
  // Initialize inventory integration service on component mount
  useEffect(() => {
    console.log('BaristaInterface mounted - initializing inventory integration');
    InventoryIntegrationService.initializeStockServiceIntegration();
  }, []);
  
  // Get station-specific barista name
  const getStationBaristaName = (stationId) => {
    try {
      const numericStationId = typeof stationId === 'string' 
        ? parseInt(stationId, 10) 
        : stationId;
      
      // Try to get station-specific barista name
      const stationBaristaName = localStorage.getItem(`coffee_barista_name_station_${numericStationId}`);
      
      // Fall back to station name if no barista name is found
      if (stationBaristaName) {
        return stationBaristaName;
      }
      
      // Get the station name
      const stationObj = stations.find(s => s.id === numericStationId);
      const stationName = stationObj ? stationObj.name : `Station ${numericStationId}`;
      
      // Fall back to generic "Barista" name with the station name
      return `Barista (${stationName})`;
    } catch (error) {
      console.error('Error getting station barista name:', error);
      return 'Barista';
    }
  };

  // Load settings from localStorage or use defaults.
  //
  // Migration (May 2026): the canonical store is now
  // `coffee_cue_settings` (the same one `useSettings` reads from).
  // We try that first; if not present, we fall back to the legacy
  // `coffee_cue_barista_settings` key and copy it into the canonical
  // store so future reads find it there. This collapses the three-
  // stores-for-similar-data mess that caused toggles like
  // "Show name on display" to appear dead.
  const loadSettings = () => {
    try {
      let saved = localStorage.getItem('coffee_cue_settings');
      if (!saved || saved === 'undefined' || saved === 'null') {
        // First boot after this change — migrate from the legacy key.
        const legacy = localStorage.getItem('coffee_cue_barista_settings');
        if (legacy && legacy !== 'undefined' && legacy !== 'null') {
          saved = legacy;
          try {
            localStorage.setItem('coffee_cue_settings', legacy);
          } catch (_) { /* migration is best-effort */ }
        }
      }
      if (saved && saved !== 'undefined' && saved !== 'null') {
        const parsed = JSON.parse(saved);
        return {
          displayMode: parsed.displayMode || 'landscape',
          // Rotation in degrees for hardware screens mounted sideways.
          // 0 = no rotation (use OS-level rotation when possible). 90 /
          // 180 / 270 supported. See DisplayScreen.js — applied via
          // CSS transform.
          displayRotation: parsed.displayRotation || 0,
          soundEnabled: parsed.soundEnabled !== undefined ? parsed.soundEnabled : true,
          // Granular sound settings
          soundNewOrder: parsed.soundNewOrder !== undefined ? parsed.soundNewOrder : true,
          soundOrderComplete: parsed.soundOrderComplete !== undefined ? parsed.soundOrderComplete : true,
          soundOrderPickedUp: parsed.soundOrderPickedUp !== undefined ? parsed.soundOrderPickedUp : true,
          soundLowStock: parsed.soundLowStock !== undefined ? parsed.soundLowStock : true,
          soundError: parsed.soundError !== undefined ? parsed.soundError : true,
          soundVolume: parsed.soundVolume || 50, // 0-100
          autoPrintLabels: parsed.autoPrintLabels || false,
          stationName: parsed.stationName || stations.find(s => s.id === selectedStation)?.name || 'Coffee Station',
          stationLocation: parsed.stationLocation || stations.find(s => s.id === selectedStation)?.location || '',
          baristaName: parsed.baristaName || getStationBaristaName(selectedStation),
          batchSuggestions: parsed.batchSuggestions !== undefined ? parsed.batchSuggestions : true,
          // Order board layout. 'progression' reads left-to-right the way
          // the work actually flows -- Upcoming, then Current, then Ready
          // -- which is how a barista scans the screen. 'current-first'
          // is the older layout, kept for anyone who prefers it.
          boardColumnOrder: parsed.boardColumnOrder || 'progression',
          // Tighter cards, for a station making 8-10 at once. At CTN26 a
          // full Current column pushed everything off the bottom, and on
          // a smaller screen only two or three orders were visible.
          compactOrders: parsed.compactOrders !== undefined ? parsed.compactOrders : false,
          // Skip the Collected step. With this on, completing an order is
          // the end of it for the barista -- the Ready for Pickup column
          // is not shown and nobody taps twice (Steve: "you dont need to
          // select picked up, just completed"). The order still counts as
          // ready on the CUSTOMER display, and still ages off there, so
          // turning this on does not hide anything from the person
          // waiting for their coffee.
          skipPickedUp: parsed.skipPickedUp !== undefined ? parsed.skipPickedUp : false,
          // Rush mode: give the screen back to the orders. Measured on the
          // real board, roughly half the height was header, tab bars, the
          // "last updated" line and batch suggestions before a single
          // order appeared (Steve: "nearly 50% of screen shot is errors,
          // menus, and suggestions"). This hides all of it and packs the
          // cards, leaving only a slim bar with the way out.
          rushMode: parsed.rushMode !== undefined ? parsed.rushMode : false,
          // How long a completed order stays in Ready for Pickup.
          readyExpiryMinutes: parsed.readyExpiryMinutes || 30,
          waitTimeWarning: parsed.waitTimeWarning || 10, // minutes
          displayTimeout: parsed.displayTimeout || 5, // minutes
          // Notification settings
          autoSendSmsOnComplete: parsed.autoSendSmsOnComplete !== undefined ? parsed.autoSendSmsOnComplete : true,
          remindAfterDelay: parsed.remindAfterDelay !== undefined ? parsed.remindAfterDelay : true,
          reminderDelay: parsed.reminderDelay || 30, // seconds
          showNameOnDisplay: parsed.showNameOnDisplay !== undefined ? parsed.showNameOnDisplay : true,
          demoMode: parsed.demoMode || false
        };
      }
    } catch (error) {
      console.error('Error loading settings from localStorage:', error);
    }
    // Return defaults if no saved settings
    return {
      displayMode: 'landscape',
      displayRotation: 0,
      soundEnabled: true,
      // Granular sound settings
      soundNewOrder: true,
      soundOrderComplete: true,
      soundOrderPickedUp: true,
      soundLowStock: true,
      soundError: true,
      soundVolume: 50, // 0-100
      autoPrintLabels: false,
      stationName: stations.find(s => s.id === selectedStation)?.name || 'Coffee Station',
      stationLocation: stations.find(s => s.id === selectedStation)?.location || '',
      baristaName: getStationBaristaName(selectedStation),
      batchSuggestions: true,
      boardColumnOrder: 'progression',
      compactOrders: false,
      skipPickedUp: false,
      rushMode: false,
      readyExpiryMinutes: 30,
      waitTimeWarning: 10, // minutes
      displayTimeout: 5, // minutes
      // Notification settings
      autoSendSmsOnComplete: true,
      remindAfterDelay: true,
      reminderDelay: 30, // seconds
      showNameOnDisplay: true,
      demoMode: false
    };
  };

  // Settings state (moved to a SettingsService in a full implementation)
  const [settings, setSettingsState] = useState(loadSettings());
  // Mirrors `settings` synchronously. Two things need it:
  //
  //  1. Call sites that pass an updater function. setSettingsState would
  //     handle those on its own, but the persistence below runs on the
  //     value passed in — and spreading a FUNCTION yields no keys, so
  //     those calls silently skipped both their localStorage write and
  //     their backend sync.
  //  2. Back-to-back calls in one tick. `settings` in a closure is the
  //     value from the last render, so two quick edits both built on the
  //     same snapshot and the second erased the first.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  
  // Wrapper function to persist settings when they change.
  //
  // Canonical store is `coffee_cue_settings` — the same one
  // `useSettings` reads from. After this change there's only ONE
  // settings store for local (non-branding) state; the old
  // mirror-and-event pattern is gone.
  //
  // The legacy `coffee_cue_barista_settings` key is intentionally
  // NOT written to anymore; loadSettings() does a one-shot read of
  // it for migration purposes on first boot.
  const setSettings = (update) => {
    // Accepts an object or an updater, and resolves the updater HERE so
    // everything below sees a real object rather than a function.
    const prev = settingsRef.current;
    const newSettings = typeof update === 'function' ? update(prev) : update;
    // Advance the ref immediately so a second call in the same tick
    // builds on this change instead of on the last render's value.
    settingsRef.current = newSettings;
    setSettingsState(newSettings);
    try {
      // Merge against any existing stored value so we don't clobber
      // fields managed by other components that share this store.
      let existing = {};
      try {
        existing = JSON.parse(localStorage.getItem('coffee_cue_settings') || '{}');
      } catch (_) { /* corrupted, start fresh */ }
      const merged = { ...existing, ...newSettings };
      localStorage.setItem('coffee_cue_settings', JSON.stringify(merged));
      // Tell the useSettings hook to refresh its in-memory copy so
      // sibling components (Display screen etc.) re-render with the
      // new value immediately.
      window.dispatchEvent(new CustomEvent('settings:updated', { detail: newSettings }));

      // Global display/notification settings must ALSO reach the backend, or
      // other devices — especially the public Display screen — never see them
      // (setSettings alone only writes THIS device's localStorage). Persist
      // only the server-backed keys, and only when they actually changed, so
      // a station switch (which spreads the whole settings blob) doesn't spam
      // PUTs. Non-fatal on API failure.
      const GLOBAL_SETTING_KEYS = [
        'showNameOnDisplay', 'showOrderDetails', 'showCompletedOrders', 'showWaitTimes',
        'displayTheme', 'displayFontSize', 'displayZoom', 'displayRotation', 'displayMode',
        'displayCustomMessage',
        'displayFlipSeconds', 'displayCardsPerPage', 'displayOverflowMode',
        'displayTouchOrdering',
        'autoSendSmsOnComplete', 'remindAfterDelay', 'reminderDelay',
      ];
      const changed = {};
      for (const k of GLOBAL_SETTING_KEYS) {
        if (Object.prototype.hasOwnProperty.call(newSettings, k) && newSettings[k] !== settings[k]) {
          changed[k] = newSettings[k];
        }
      }
      if (Object.keys(changed).length > 0) {
        // The backend-sync failure is reported by SettingsService itself
        // (it swallows that error to stay local-first, and raises an
        // app:toast instead). This catch is for the outer failure it does
        // rethrow — localStorage full or blocked.
        SettingsService.updateSettings(changed)
          .catch(err => {
            console.warn('Could not save display settings:', err);
            showToast('Could not save that setting on this device.', 'error', 6000);
          });
      }
    } catch (error) {
      console.error('Error saving settings to localStorage:', error);
    }
  };

  // Schedule data is initialized at the top of the component

  // NEW: Init notification handler
  const notificationHandler = OrderNotificationHandler({
    onSendMessage: (orderId, message) => handleSendMessage(orderId, message),
    onUpdateSettings: (newSettings) => {
      setSettings(prev => ({...prev, ...newSettings}));
    }
  });

  // Load station-specific settings on mount
  useEffect(() => {
    // This effect only needs to run once on initial component mount
    // We'll handle station changes in the other useEffect
  }, []);
  
  // Synchronize settings with MessageService on mount
  useEffect(() => {
    MessageService.updateSettings({
      autoSendSmsOnComplete: settings.autoSendSmsOnComplete,
      remindAfterDelay: settings.remindAfterDelay,
      reminderDelay: settings.reminderDelay,
      showNameOnDisplay: settings.showNameOnDisplay,
      displayDuration: settings.displayTimeout * 60 // convert minutes to seconds
    });
  }, []);
  
  // Synchronize schedule station with selected station
  useEffect(() => {
    if (selectedStation && typeof setScheduleStation === 'function') {
      console.log('Synchronizing schedule station with selected station:', selectedStation);
      setScheduleStation(selectedStation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStation]);
  
  // Check for navigation from organizer page and trigger order refresh
  useEffect(() => {
    // Check URL parameters for navigation source
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('from') && urlParams.get('from') === 'organiser') {
      console.log('Detected navigation from organiser via URL parameter');
      
      // Trigger an immediate refresh with a slight delay to ensure all hooks are initialized
      setTimeout(() => {
        refreshData();
        console.log('Forced order refresh after organiser navigation');
        
        // Remove the parameter from the URL to prevent multiple refreshes
        if (window.history && window.history.replaceState) {
          const newUrl = window.location.pathname;
          window.history.replaceState({}, document.title, newUrl);
        }
      }, 100);
    }
    
    // Check localStorage for flag indicating we're returning from organiser
    const returnFromOrganiser = sessionStorage.getItem('force_orders_refresh');
    if (returnFromOrganiser === 'true') {
      console.log('Detected return from organiser via sessionStorage flag');
      sessionStorage.removeItem('force_orders_refresh'); // Clear the flag
      refreshData(); // Trigger refresh
    }
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NEW: Enhanced message sending function using the suggested pattern
  const handleSendMessage = async (orderId, message) => {
    try {
      // First find the full order object if available
      const order = 
        inProgressOrders.find(o => o.id === orderId) || 
        completedOrders.find(o => o.id === orderId) ||
        pendingOrders.find(o => o.id === orderId) || 
        orderId;
      
      // Update status to indicate sending
      setMessageStatus(prev => ({
        ...prev,
        [orderId]: { status: 'sending', timestamp: new Date() }
      }));
      
      // Use MessageService to send the message
      const result = await MessageService.sendMessage(order, message);
      
      if (result.success) {
        // Update status on success
        setMessageStatus(prev => ({
          ...prev,
          [orderId]: { status: 'sent', timestamp: new Date() }
        }));
        
        // No need to close dialog, it will close itself on success
        
        return { success: true };
      } else {
        // Update status on failure
        setMessageStatus(prev => ({
          ...prev,
          [orderId]: { status: 'failed', error: result.error, timestamp: new Date() }
        }));
        
        return { success: false, error: result.error };
      }
    } catch (err) {
      console.error('Message send error:', err);
      
      // Update status on error
      setMessageStatus(prev => ({
        ...prev,
        [orderId]: { status: 'failed', error: err.message, timestamp: new Date() }
      }));
      
      return { success: false, error: err.message };
    }
  };

  // NEW: Handle sending message to customer (simplified version)
  const handleOpenMessageDialog = (order) => {
    setCurrentMessageOrder(order);
    setShowMessageDialog(true);
  };

  // Handle sending automatic reminder for completed orders
  const handleSendReminder = async (order) => {
    if (!order || !order.id) {
      console.error('Cannot send reminder: Invalid order');
      return;
    }

    try {
      console.log('Sending reminder for order:', order.id);
      
      // Calculate how long the order has been waiting
      const minutesWaiting = order.completedAt ? calculateMinutesDiff(order.completedAt) : 0;
      
      // Send reminder notification using MessageService
      const result = await MessageService.sendReminderNotification(order, minutesWaiting);
      
      if (result.success) {
        // Update message status to show success
        setMessageStatus(prev => ({
          ...prev,
          [order.id]: { status: 'sent', timestamp: new Date() }
        }));
        
        // Show success feedback
        showToast(`Reminder sent to ${order.customerName}`, 'success');
      } else {
        throw new Error(result.error || 'Failed to send reminder');
      }
    } catch (error) {
      console.error('Failed to send reminder:', error);
      showToast(`Failed to send reminder: ${error.message}`, 'error', 6000);
    }
  };

  // NEW: Handle delay order
  const handleDelayOrder = (order) => {
    if (!order || !order.id) {
      console.error('Cannot delay order: Missing order ID');
      return;
    }

    // HONESTY over theater: this used to claim "delayed by 5 minutes"
    // while doing absolutely nothing — the order stayed exactly where it
    // was, and a rushing barista had no way to tell. Until a real delay
    // mechanism exists in the backend queue, say so and offer the
    // workable alternative.
    showToast(
      `Delaying orders isn't supported yet — order #${order.orderNumber || order.id} ` +
      `has NOT been changed. Use Move to send it to another station, or message the customer.`,
      'info', 8000
    );
  };

  // Open the move-to-station dialog. Just stages the order — the
  // dialog drives the actual reassign call so it can show inline
  // errors (e.g. capability mismatch) without disrupting the queue.
  const handleOpenMoveDialog = (order) => {
    if (!order || !order.id) {
      console.error('Cannot move order: missing order ID');
      return;
    }
    setOrderToMove(order);
    setShowMoveDialog(true);
  };

  const handleEditOrder = (order) => {
    if (!order || !order.id) {
      console.error('Cannot edit order: Missing order ID');
      return;
    }
    // Opens the edit dialog (drink/milk/size/sugar override + cancel-order).
    // Backed by PATCH /orders/{id} and POST /orders/{id}/cancel.
    setEditingOrder(order);
  };

  const handleSaveOrderEdit = async (fields) => {
    if (!editingOrder) return;
    setEditSaving(true);
    try {
      const id = editingOrder.orderNumber || editingOrder.id;
      const res = await OrderDataService.updateOrder(id, fields);
      if (res && res.success) {
        setEditingOrder(null);
        refreshData();
      } else {
        showToast(`Could not update order: ${(res && res.message) || 'Unknown error'}`, 'error', 6000);
      }
    } catch (err) {
      showToast(`Error updating order: ${err.message || 'Unknown error'}`, 'error', 6000);
    } finally {
      setEditSaving(false);
    }
  };

  const handleCancelOrderEdit = async () => {
    if (!editingOrder) return;
    setEditSaving(true);
    try {
      const id = editingOrder.orderNumber || editingOrder.id;
      const res = await OrderDataService.cancelOrder(id);
      if (res && res.success) {
        setEditingOrder(null);
        refreshData();
      } else {
        showToast(`Could not cancel order: ${(res && res.message) || 'Unknown error'}`, 'error', 6000);
      }
    } catch (err) {
      showToast(`Error cancelling order: ${err.message || 'Unknown error'}`, 'error', 6000);
    } finally {
      setEditSaving(false);
    }
  };

  // Which orders belong to a multi-coffee GROUP (multi-drink SMS or FRIEND
  // order). Computed across every visible order so the position/size counts
  // ("2/3") are correct regardless of which list a member is sitting in.
  const groupInfoByOrderId = useMemo(
    () => buildGroupInfo([
      ...(pendingOrders || []),
      ...(inProgressOrders || []),
      ...(completedOrders || []),
    ]),
    [pendingOrders, inProgressOrders, completedOrders]
  );

  // Start every still-pending coffee in this order's group at once, so a
  // group gets made — and collected — together. Falls back to a single start
  // if the order isn't actually grouped.
  const handleStartGroup = async (order) => {
    const gid = order.groupId || order.group_id;
    if (!gid) return startOrderWithLabel(order);
    const members = (pendingOrders || []).filter(
      o => (o.groupId || o.group_id) === gid
    );
    if (members.length === 0) return startOrderWithLabel(order);
    for (const m of members) {
      // Sequential so the backend/station load updates cleanly per order.
      // eslint-disable-next-line no-await-in-loop
      await startOrderWithLabel(m);
    }
  };

  // Queue a cup label. Fire-and-forget: printing must never block or fail
  // the order flow — a problem surfaces as a toast and in the Support
  // print queue, nothing else.
  const handlePrintLabel = async (order, { reprint = false } = {}) => {
    const id = order?.id || order;
    const r = reprint
      ? await printService.reprintLabel(id, selectedStation)
      : await printService.printLabel(id, selectedStation);
    if (r?.success) {
      showToast(`Label queued for order #${id}`, 'success');
    } else {
      showToast(`Label not printed: ${r?.message || 'printer unavailable'}`, 'warning');
    }
  };

  // What this event wants on Start: 'off' | 'arrival' | 'start'. Resolved
  // by the server, which also carries the migration -- while nobody has
  // chosen, it answers with this DEVICE's old autoPrintLabels flag, so a
  // tablet that was auto-printing carries on doing exactly that.
  const [autoPrintMode, setAutoPrintMode] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/print/auto-print-mode?device_auto_print=${autoPrintLabels ? 'true' : 'false'}`,
          { headers: { 'Authorization': `Bearer ${localStorage.getItem('coffee_system_token') || ''}` } });
        const b = await r.json();
        if (!cancelled && b?.mode) setAutoPrintMode(b.mode);
      } catch (e) {
        // Unreachable server must not change printing behaviour -- fall
        // back to whatever this device was already doing.
        if (!cancelled) setAutoPrintMode(autoPrintLabels ? 'start' : 'off');
      }
    })();
    return () => { cancelled = true; };
  }, [autoPrintLabels, selectedStation]);

  const startOrderWithLabel = async (order) => {
    const result = await startOrder(order);
    // 'arrival' already printed it when the order came in; printing again
    // on Start would put two labels on one cup.
    if (autoPrintMode === 'start' && stationPrinter) {
      handlePrintLabel(order);
    }
    return result;
  };

  // Express batch (the big-event "flat white table" flow): start a whole
  // tray of same-kind pending orders, and complete a made tray in one
  // tap — every ready-SMS then says "collect from the FLAT WHITE table
  // at <station>" via the batch-complete endpoint's collection note.
  const handleStartRushBatch = async (group) => {
    await processBatchSelection(group.map(o => o.id));
  };
  const handleBatchComplete = async (group, tableLabel) => {
    try {
      const resp = await fetch('/api/orders/batch-complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
        },
        body: JSON.stringify({
          order_ids: group.map(o => o.id),
          collection_label: tableLabel,
        }),
      });
      const body = await resp.json();
      const done = (body.completed || []).length;
      const failedCount = (body.failed || []).length;
      if (failedCount === 0 && done > 0) {
        showToast(`Tray done - ${done} order(s) ready, SMSes say "${tableLabel}"`, 'success', 5000);
      } else {
        showToast(`Tray: ${done} completed, ${failedCount} FAILED - check those cards`,
          'warning', 8000);
      }
      refreshData();
    } catch (e) {
      showToast(`Batch complete failed: ${e?.message || 'unknown'}`, 'error');
    }
  };

  // Enhanced order completion function with guaranteed notifications
  const handleCompleteOrder = async (orderId) => {
    try {
      console.log('Starting order completion process for order:', orderId);
      
      // First find the order before it gets moved to completed
      const orderToComplete = inProgressOrders.find(o => o.id === orderId);
      
      if (!orderToComplete) {
        console.error('Could not find order in inProgressOrders array:', orderId);
        showToast('Could not find the order details. Please try again.', 'error', 6000);
        return false;
      }
      
      // Find the actual station info from the stations list
      const stationInfo = stations.find(s => s.id === selectedStation);
      
      // Add station name to the order for notifications
      const orderWithStation = {
        ...orderToComplete,
        stationName: stationInfo ? stationInfo.name : settings.stationName
      };
      
      console.log('Prepared order object for notification:', orderWithStation);
      
      // First complete the order using the existing function from useOrders
      const result = await completeOrder(orderId);
      console.log('Complete order API result:', result);
      
      // Check if the result has a success property or define success
      const isOrderCompleteSuccess = result && (result.success === true || !Object.prototype.hasOwnProperty.call(result, 'success'));
      
      if (isOrderCompleteSuccess) {
        console.log('Order marked as complete in backend. Backend sends the "your coffee is ready" SMS — no frontend follow-up needed.');

        // SMS notification is owned by the BACKEND now.
        //
        // The /api/orders/<id>/complete endpoint calls
        // _notify_customer_order_ready() server-side. We used to ALSO
        // fire the same notification from here via three different
        // fallback paths (notificationHandler → MessageService →
        // OrderDataService), each of which hit /sms/send with its own
        // template. Net result: customer got TWO "ready" SMS for one
        // order (Steve hit this during QC: "☕ Hi Steve!" then "🔔
        // YOUR COFFEE IS READY!"). And the reminder scheduling below
        // fired a third "0 minutes" reminder 30 seconds later.
        //
        // Treating the backend as the single source of truth fixes
        // all three. Local UI status still updates from completeOrder()
        // — the frontend doesn't need to do anything else.
        const notificationSuccess = true;
        const notificationError = null;

        // Update message status UI to reflect notification status
        setMessageStatus(prev => ({
          ...prev,
          [orderId]: {
            status: notificationSuccess ? 'sent' : 'failed',
            error: notificationSuccess ? null : (notificationError?.message || 'Failed to send notification'),
            timestamp: new Date() 
          }
        }));
        
        return true;
      } else {
        console.error('Failed to complete order in backend');
        showToast('Failed to complete the order. Please try again.', 'error', 6000);
      }
      
      return false;
    } catch (err) {
      console.error('Error completing order with notifications:', err);
      showToast(`${err.message || 'Unknown error completing order'}`, 'error', 6000);
      return false;
    }
  };

  // Handle wait time change
  const handleAdjustWaitTime = async (newWaitTime) => {
    if (newWaitTime && !isNaN(newWaitTime)) {
      const waitTimeValue = parseInt(newWaitTime);
      const success = await updateWaitTime(waitTimeValue);
      
      if (success) {
        setWaitTime(waitTimeValue);
        setShowWaitTimeDialog(false);
        showToast(`Wait time updated to ${waitTimeValue} minutes`, 'success');
      } else {
        showToast('Failed to update wait time. Please try again.', 'error', 6000);
      }
    }
  };

  // --- Station online/offline toggle (header pill) -----------------------
  // NOTE: the `online` flag from useOrders is network connectivity, NOT
  // whether this station is taking orders. Accepting-orders state lives in
  // the station's status: 'active' = online; 'maintenance' = offline (the
  // SMS router already refuses to route new orders to a non-active station).
  const currentStationObj = stations.find(s => s.id === selectedStation);
  const stationOnline = !currentStationObj || (currentStationObj.status || 'active') === 'active';

  const toggleStationOnline = async () => {
    if (!selectedStation) return;
    const goingOffline = stationOnline;
    if (goingOffline) {
      const ok = window.confirm(
        'Take this station offline?\n\n' +
        'New SMS and walk-up orders will stop being sent here until you bring ' +
        'it back online. Orders already in progress are not affected.'
      );
      if (!ok) return;
    }
    try {
      await updateStationStatus(selectedStation, goingOffline ? 'maintenance' : 'active');
      await refreshStations();
      setSuccessMessage(
        goingOffline
          ? 'Station is now offline - not receiving new orders'
          : 'Station is back online'
      );
    } catch (e) {
      showToast('Could not change station status: ' + (e?.message || 'unknown error'), 'error', 6000);
    }
  };

  // --- Auto-refresh interval picker (header pill) ------------------------
  // The useOrders hook only flips the React enabled-state via
  // toggleAutoRefresh, so enabling means calling that first, then setting
  // the interval. 0 = off.
  const setRefreshInterval = (seconds) => {
    if (seconds === 0) {
      if (autoRefreshEnabled) toggleAutoRefresh();
    } else {
      if (!autoRefreshEnabled) toggleAutoRefresh();
      updateAutoRefreshInterval(seconds);
    }
    setShowRefreshMenu(false);
  };

  // Other stations (for the at-a-glance queue pills) — lets a barista point
  // a walk-up at a quieter station. Colour-coded by how busy each one is.
  const otherStations = stations.filter(s => s.id !== selectedStation);
  // Compact ≤4-char tag for the other-station pills so a long custom name
  // ("East Wing", "Main Foyer Coffee") doesn't blow the header out. Full name
  // is still shown on hover (title attr) and in the station dropdown/title.
  //   "Coffee Station 2" → "S2"  (trailing number wins)
  //   "East Wing"        → "EW"  (initials of each word)
  //   "Lobby"            → "Lobb" (first 4 of a single word)
  const shortStationLabel = (name, id) => {
    if (!name) return `S${id}`;
    const trailing = String(name).match(/(\d+)\s*$/);
    if (trailing) return `S${trailing[1]}`.slice(0, 4);
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return words.map(w => w[0]).join('').toUpperCase().slice(0, 4);
    return (words[0] || `S${id}`).slice(0, 4);
  };

  // Batch order handling
  const toggleBatchMode = () => {
    setBatchModeActive(!batchModeActive);
    if (batchModeActive && selectedOrders.size > 0) {
      // Process selected orders
      processBatchSelection(selectedOrders);
    }
    // Clear selections when toggling off
    setSelectedOrders(new Set());
  };

  const toggleOrderSelection = (orderId) => {
    const newSelectedOrders = new Set(selectedOrders);
    if (newSelectedOrders.has(orderId)) {
      newSelectedOrders.delete(orderId);
    } else {
      newSelectedOrders.add(orderId);
    }
    setSelectedOrders(newSelectedOrders);
  };

  // Handle walk-in order submission with better error handling
  const handleWalkInOrder = async (orderDetails, orderType = 'single') => {
    try {
      console.log('BaristaInterface.handleWalkInOrder called with:', {
        orderType,
        customerName: orderDetails.customer_name || orderDetails.customerName,
        milkType: orderDetails.milk_type || orderDetails.milkType,
        milkTypeId: orderDetails.milk_type_id || orderDetails.milkTypeId
      });
      
      // If this is a group order, handle it differently
      if (orderType === 'group') {
        console.log('Attempting to add group order:', orderDetails);
        
        // Find the actual station info from the stations list
        const stationInfo = stations.find(s => s.id === selectedStation);
        
        // Pass the group order to the service function
        const result = await OrderDataService.submitGroupOrder(orderDetails);
        
        if (result && result.success) {
          setShowWalkInDialog(false);
          showToast(`Group order "${orderDetails.groupName}" with ${result.count} coffees added to the queue!`, 'success');
          // Refresh data to show new orders
          refreshData();
        } else {
          // More detailed error message
          showToast(`Failed to add group order: ${result?.message || 'Unknown error'}`, 'error', 6000);
        }
        
        return;
      }
      
      // Handle regular individual walk-in order
      console.log('Attempting to add walk-in order:', orderDetails);
      
      // Find the actual station info from the stations list
      const stationInfo = stations.find(s => s.id === selectedStation);
      
      // Add station ID to the order details
      // If a collection station is specified, the order should be processed there
      const targetStationId = orderDetails.collectionStation || selectedStation;
      const targetStation = stations.find(s => s.id === targetStationId);
      
      const orderWithStation = {
        ...orderDetails,
        // Processing station - where the order will be made
        stationId: targetStationId,
        station_id: targetStationId,
        assignedStation: targetStationId,
        // Add the station name for better display
        stationName: targetStation ? targetStation.name : (stationInfo ? stationInfo.name : settings.stationName),
        // Track where the order was originally created (for reference)
        createdAtStation: selectedStation,
        created_at_station: selectedStation
      };
      
      console.log('Adding walk-in order with station information:', orderWithStation);
      
      // Add a proper try/catch around the API call
      const result = await addWalkInOrder(orderWithStation);

      // A REFUSAL (e.g. "this station doesn't stock almond") must never
      // toast success — Danny's two walk-ins "added successfully" while
      // the backend had refused both and nothing existed anywhere.
      // (Now also covers plain server errors — Penny's long black said
      // "added" while the server had it rejected.)
      if (result && result.refused) {
        showToast(`❌ Not added: ${result.message}`, 'error', 8000);
        return; // keep the dialog open so the barista can adjust
      }

      // True offline: the order is queued on THIS device only until the
      // connection returns. Say so — it won't be on other stations or
      // the customer display yet.
      if (result && result.offline) {
        setShowWalkInDialog(false);
        showToast('⚠ OFFLINE — order saved on this device and will sync when '
          + 'the connection returns. Not visible to other stations yet.', 'info', 8000);
        return;
      }

      if (result) {
        setShowWalkInDialog(false);
        
        // Get customer name or use a default
        const customerName = orderDetails.customer_name || orderDetails.customerName || 'Walk-in Customer';
        
        // Honest, specific toast: the order NUMBER and where it landed,
        // so a barista viewing a different station knows why it isn't on
        // their own queue.
        const newNum = result.order_number || result.orderNumber || result.id;
        let message = `✅ Order${newNum ? ` #${newNum}` : ''} added`;
        
        // Add customer name if available
        if (customerName && customerName !== 'Walk-in Customer') {
          message += ` for ${customerName}`;
        }
        const landedStation = result.station_id || result.stationId
          || orderWithStation.stationId;
        if (landedStation) {
          message += ` → Station ${landedStation}`;
          if (String(landedStation) !== String(selectedStation)) {
            message += ` (not this station's queue)`;
          }
        }
        
        // Add collection station info if different
        if (orderDetails.collectionStation && orderDetails.collectionStation !== selectedStation) {
          const stationName = orderWithStation.stationName || `Station ${orderDetails.collectionStation}`;
          message += `\n📍 Collection at: ${stationName}`;
        }
        
        // Use toast notification
        showToast(message.replace(/\n/g, ' '), 'success', 5000);
        
        console.log('Walk-in order successfully added and dialog closed');
      } else {
        // Don't close dialog on error, let user retry
        console.error('Failed to add walk-in order - keeping dialog open for retry');
        showToast('Failed to add walk-in order — the server refused it. Check the details and try again.', 'error', 6000);
      }
    } catch (error) {
      console.error('Error submitting walk-in order:', error);
      
      // Show specific error message if available
      const errorMessage = error?.message || 'Unknown error occurred';
      showToast(`Error adding walk-in order: ${errorMessage}`, 'error', 6000);
      
      // Don't close dialog on error, let user retry or manually close
      console.error('Walk-in order submission failed - keeping dialog open for retry');
    }
  };

  // Function to show display screen with station ID
  const openDisplayScreen = () => {
    // Pass the station ID in the URL to customize the display
    window.open(`/display?station=${selectedStation}`, '_blank');
  };

  // Function to render in-progress order
  const renderInProgressOrder = (order) => {
    const hasSentMessage = messageStatus[order.id]?.status === 'sent';
    
    return (
      <div key={order.id} className="bg-white rounded-lg shadow-md p-4 mb-4">
        <div className="flex justify-between">
          <div>
            <div className="text-sm text-gray-500">Order #{order.id}</div>
            <div className="text-xl font-bold mt-1 flex items-center">
              {order.customerName}
              {hasSentMessage && (
                <span className="ml-1 text-green-500" title="Message sent">
                  <CheckCircle size={16} />
                </span>
              )}
            </div>
            <div className="text-gray-700">{order.phoneNumber}</div>
          </div>
          <div className="flex flex-col items-end">
            {/* Group badge — still part of a group while being made, so the
                barista knows to hold it for collection with its siblings. */}
            <GroupBadge info={groupInfoByOrderId[order.id]} />
            <SourceBadge order={order} />
            {order.priority && (
              <div className="mt-1 bg-red-100 text-red-700 px-2 py-1 rounded text-sm font-medium">
                PRIORITY
              </div>
            )}
            <div className="mt-2 flex space-x-2">
              {/* Move mid-make. The backend has allowed reassigning an
                  in-progress order all along -- its own comment names
                  this exact case ("barista realises mid-pour they're
                  out of milk") -- but only the PENDING card ever grew
                  the button. Steve, mid-service: "cant transfer station
                  once started ... worked out ran out of that milk or a
                  error fault". */}
              <button
                className="text-gray-500 hover:text-amber-600"
                onClick={() => handleOpenMoveDialog(order)}
                title="Move to another station"
              >
                <ArrowRightLeft size={16} />
              </button>
              <button
                className="text-gray-500 hover:text-gray-700"
                onClick={() => handleEditOrder(order)}
                title="Edit order"
              >
                <Edit size={16} />
              </button>
            </div>
          </div>
        </div>
        
        <div className="mt-2 bg-gray-100 p-2 rounded-lg">
          <div className="text-lg font-bold leading-snug">{order.size ? `${order.size} ` : ''}{order.coffeeType || 'Coffee'}</div>
          <div className="text-sm text-gray-700">
            {order.milkType || 'Regular milk'}, {order.sugar || 'No sugar'}
            {order.extraHot ? ', Extra hot' : ''}
          </div>
          {order.alternativeMilk && (
            <span className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded mt-1">
              Alternative Milk
            </span>
          )}
        </div>

        {/* Team mode stage chips: two-plus baristas sharing this iPad
            tick their part (shots / milk). COMPLETE stays the explicit
            final tap — it lights up when every part is ticked but never
            fires itself (an accidental complete would SMS the customer). */}
        {teamMode && (() => {
          const stages = applicableStages(order);
          if (stages.length === 0) return null;
          const done = orderStages(order);
          return (
            <div className="mt-2 flex space-x-2">
              {stages.map(stage => (
                <button
                  key={stage}
                  className={`flex-1 py-2 rounded-lg font-semibold text-sm border-2 ${
                    done[stage]
                      ? 'bg-green-100 border-green-500 text-green-800'
                      : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'}`}
                  onClick={() => toggleStage(order, stage)}
                  title={done[stage]
                    ? `${stage} done - tap to undo`
                    : `Tap when the ${stage} ${stage === 'shots' ? 'are' : 'is'} done`}
                >
                  {done[stage] ? '✓ ' : ''}{stage === 'shots' ? '☕ Shots' : '🥛 Milk'}
                </button>
              ))}
            </div>
          );
        })()}

        {/* One compact action row: big COMPLETE, small icon-only message
            button (Steve: the card ate too much vertical space). Messaging
            is disabled when the order has no phone number — it used to
            open the dialog and let you type a message that could never
            send. */}
        {(() => {
          const _ph = String(order.phoneNumber || '').trim().toLowerCase();
          const hasPhone = !!_ph && _ph !== 'walk-in' && _ph !== 'na' && _ph !== 'n/a';
          const _stages = teamMode ? applicableStages(order) : [];
          const _done = orderStages(order);
          const allStagesDone = _stages.length > 0 && _stages.every(s => _done[s]);
          return (
            <div className="mt-2 flex space-x-2">
              <button
                className={`flex-1 text-white py-2 rounded-lg font-bold ${
                  allStagesDone
                    ? 'bg-green-600 hover:bg-green-700 ring-2 ring-green-300 animate-pulse'
                    : 'bg-green-500 hover:bg-green-600'}`}
                onClick={() => handleCompleteOrder(order.id)}
              >
                {allStagesDone ? 'ALL PARTS DONE - COMPLETE' : 'COMPLETE ORDER'}
              </button>
              <button
                className={`px-3 rounded-lg flex items-center justify-center ${hasPhone
                  ? 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                  : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}
                onClick={() => hasPhone && handleOpenMessageDialog(order)}
                disabled={!hasPhone}
                title={hasPhone
                  ? 'Message customer'
                  : 'No phone number on this order — add one via Edit (pencil) to enable SMS'}
              >
                <MessageCircle size={18} />
              </button>
              {stationPrinter && (
                <button
                  className="px-3 rounded-lg flex items-center justify-center bg-gray-200 hover:bg-gray-300 text-gray-700"
                  onClick={() => handlePrintLabel(order)}
                  title={stationPrinter.online
                    ? 'Print cup label'
                    : 'Print cup label (printer looks offline — job will queue)'}
                >
                  <Printer size={18} />
                </button>
              )}
            </div>
          );
        })()}

        {/* Time-into-order bar. Fills as the order ages against a 5-minute
            make target (or promisedTime when the API sends one). It used
            to divide by a promisedTime the /orders listing never provided,
            so it sat at 0% forever. */}
        {(() => {
          const target = order.promisedTime > 0 ? order.promisedTime : 5;
          const pct = Math.floor(Math.min(((order.waitTime || 0) / target) * 100, 100));
          return (
            <div className="mt-2 flex items-center space-x-2 text-xs text-gray-500">
              <span className="whitespace-nowrap">{order.waitTime || 0} min</span>
              <div className="flex-grow bg-gray-200 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-1.5 ${getTimeRatioColor(order.waitTime || 0, target)}`}
                  style={{ width: `${pct}%` }}
                ></div>
              </div>
              <span className="whitespace-nowrap">target {target} min</span>
            </div>
          );
        })()}
      </div>
    );
  };

  // Function to render completed order card
  const renderCompletedOrder = (order) => {
    const minutesWaiting = order.completedAt ? calculateMinutesDiff(order.completedAt) : 0;
    const hasSentMessage = messageStatus[order.id]?.status === 'sent';
    
    const milkColorStyle = order.milkType && order.milkType !== 'No Milk' 
      ? getMilkColorStyle(order.milkType, order.milkTypeId)
      : { borderLeftWidth: '4px', borderLeftStyle: 'solid', borderLeftColor: '#10B981' };
    
    return (
      <div key={order.id} className="bg-white rounded-lg shadow-sm p-3 mb-2" style={milkColorStyle}>
        <div className="flex justify-between items-center">
          <div className="font-bold flex items-center">
            Order #{order.id}
            {hasSentMessage && (
              <span className="ml-1 text-green-500" title="Message sent">
                <CheckCircle size={14} />
              </span>
            )}
          </div>
          <div className="text-sm text-gray-500">Completed {minutesWaiting} minutes ago</div>
        </div>
        <div className="mt-2">
          <div className="text-gray-700 flex items-center">
            {order.milkType && order.milkType !== 'No Milk' && (
              <span style={getMilkDotStyle(order.milkType, order.milkTypeId)}></span>
            )}
            {order.coffeeType || 'Coffee'}, {order.milkType || 'Regular milk'}
          </div>
          <div className="font-medium">{order.customerName}</div>
          <div className="text-sm text-gray-600">{order.phoneNumber}</div>
          {order.alternativeMilk && (
            <div className="mt-1">
              <span className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded">
                Alternative Milk
              </span>
            </div>
          )}
        </div>
        <div className="mt-3 flex space-x-2">
          <button
            className="flex-1 bg-amber-600 text-white py-1 rounded text-sm hover:bg-amber-700"
            onClick={() => handleSendReminder(order)}
          >
            Remind
          </button>
          <button
            className="flex-1 bg-green-500 text-white py-1 rounded text-sm hover:bg-green-600"
            onClick={() => markOrderPickedUp(order.id)}
          >
            Picked Up
          </button>
          {stationPrinter && (
            <button
              className="px-2 bg-gray-200 text-gray-700 py-1 rounded text-sm hover:bg-gray-300 flex items-center"
              onClick={() => handlePrintLabel(order, { reprint: true })}
              title="Reprint label (uses the original order details)"
            >
              <Printer size={14} />
            </button>
          )}
        </div>
      </div>
    );
  };

  // Function to render previous order card
  const renderPreviousOrder = (order) => {
    const milkColorStyle = order.milkType && order.milkType !== 'No Milk' 
      ? getMilkColorStyle(order.milkType, order.milkTypeId)
      : { borderLeftWidth: '4px', borderLeftStyle: 'solid', borderLeftColor: '#10B981' };
    
    return (
      <div key={order.id} className="bg-white rounded-lg shadow-sm p-3 mb-2" style={milkColorStyle}>
        <div className="flex justify-between items-center">
          <div className="font-bold">Order #{order.id}</div>
          <button 
            className="text-sm text-gray-600 bg-gray-200 px-2 py-1 rounded hover:bg-gray-300"
            onClick={() => {
              console.log(`Viewing details for order #${order.id}`);
              showToast(`Details for order #${order.id} are not available.`, 'info');
            }}
          >
            View Details
          </button>
        </div>
        <div className="mt-2">
          <div className="text-gray-700 flex items-center">
            {order.milkType && order.milkType !== 'No Milk' && (
              <span style={getMilkDotStyle(order.milkType, order.milkTypeId)}></span>
            )}
            {order.coffeeType || 'Coffee'}, {order.milkType || 'Regular milk'} {order.sugar ? `, ${order.sugar}` : ''}
          </div>
          <div className="font-medium">{order.customerName}</div>
          <div className="text-sm text-gray-600">Picked up at {order.pickedUpAt ? new Date(order.pickedUpAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'unknown'}</div>
        </div>
      </div>
    );
  };

  // Create individual stock item component to properly use hooks
  const StockItem = ({ item, category, updateStockItem, deleteStockItem, addStockItem }) => {
    const percentage = (item.amount / item.capacity) * 100;
    const [isEditingCapacity, setIsEditingCapacity] = useState(false);
    const [tempCapacity, setTempCapacity] = useState(item.capacity);
    const [showNumericInput, setShowNumericInput] = useState(false);
    const [numericAmount, setNumericAmount] = useState(item.amount);
    
    // Get appropriate color based on status
    const getStatusColor = (status) => {
      switch(status) {
        case 'danger':
          return 'bg-red-400';
        case 'warning':
          return 'bg-yellow-400';
        case 'good':
        default:
          return 'bg-green-400';
      }
    };
    
    // Get appropriate amount change based on category and item type
    const getChangeAmount = (itemCategory, itemObj) => {
      if (itemCategory === 'milk') {
        return 0.5; // 0.5 liter
      } else if (itemCategory === 'coffee') {
        return 0.1; // 0.1 kg
      } else if (itemCategory === 'cups') {
        return 5; // 5 cups
      } else if (itemCategory === 'syrups') {
        return 0.1; // 0.1 liter
      } else {
        // Default or 'other' category
        return itemObj.unit === 'pcs' ? 5 : 0.5;
      }
    };
    
    const changeAmount = getChangeAmount(category, item);
    
    // Function to handle slider change
    const handleSliderChange = (e) => {
      const newAmount = parseFloat(e.target.value);
      updateStockItem(category, item.id, newAmount);
      setNumericAmount(newAmount);
    };
    
    // Function to handle numeric input change
    const handleNumericInputChange = (e) => {
      setNumericAmount(e.target.value);
    };
    
    // Function to apply numeric input
    const applyNumericInput = () => {
      const newAmount = parseFloat(numericAmount);
      if (!isNaN(newAmount) && newAmount >= 0 && newAmount <= item.capacity) {
        updateStockItem(category, item.id, newAmount);
      }
      setShowNumericInput(false);
    };
    
    // Function to handle capacity change
    const handleCapacityChange = () => {
      if (!isNaN(tempCapacity) && tempCapacity > 0) {
        // We need to update the whole item with the new capacity
        // First let's get the low and critical thresholds percentages
        const lowThresholdPercent = (item.lowThreshold / item.capacity);
        const criticalThresholdPercent = (item.criticalThreshold / item.capacity);
        
        // Create a new item with updated capacity and thresholds
        const updatedItem = {
          ...item,
          capacity: parseFloat(tempCapacity),
          amount: Math.min(item.amount, parseFloat(tempCapacity)), // Make sure amount doesn't exceed new capacity
          lowThreshold: parseFloat(tempCapacity) * lowThresholdPercent,
          criticalThreshold: parseFloat(tempCapacity) * criticalThresholdPercent
        };
        
        // Delete the old item and add the updated one
        deleteStockItem(category, item.id);
        addStockItem(category, updatedItem);
        
        setIsEditingCapacity(false);
      }
    };
    
    return (
      <div className="flex flex-col mb-6 pb-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <div className="w-1/4">
            <div className="font-medium">{item.name}</div>
            <div className="text-sm text-gray-500 flex items-center">
              <span className="mr-2">Available: {item.amount} {item.unit}</span>
              <button 
                className="text-blue-500 text-xs underline"
                onClick={() => setShowNumericInput(!showNumericInput)}
              >
                {showNumericInput ? 'Hide' : 'Edit'}
              </button>
            </div>
            
            {/* Numeric input for direct value entry */}
            {showNumericInput && (
              <div className="mt-1 flex items-center">
                <input
                  type="number"
                  min="0"
                  max={item.capacity}
                  step={item.unit === 'pcs' ? 1 : 0.1}
                  value={numericAmount}
                  onChange={handleNumericInputChange}
                  className="w-24 p-1 border rounded mr-2"
                />
                <button
                  className="bg-green-500 text-white px-2 py-1 rounded text-xs"
                  onClick={applyNumericInput}
                >
                  Apply
                </button>
              </div>
            )}
          </div>
          
          <div className="w-1/4 flex flex-col">
            <div className="font-medium flex items-center">
              Capacity: {item.capacity} {item.unit}
              <button 
                className="ml-2 text-blue-500 text-xs underline"
                onClick={() => setIsEditingCapacity(!isEditingCapacity)}
              >
                {isEditingCapacity ? 'Cancel' : 'Edit'}
              </button>
            </div>
            
            {isEditingCapacity && (
              <div className="mt-1 flex items-center">
                <input
                  type="number"
                  min={item.amount} // Can't set capacity lower than current amount
                  step={item.unit === 'pcs' ? 1 : 0.1}
                  value={tempCapacity}
                  onChange={(e) => setTempCapacity(e.target.value)}
                  className="w-24 p-1 border rounded mr-2"
                />
                <button
                  className="bg-green-500 text-white px-2 py-1 rounded text-xs"
                  onClick={handleCapacityChange}
                >
                  Update
                </button>
              </div>
            )}
          </div>
          
          <div className="w-1/4 flex justify-end space-x-2">
            <button 
              className="w-10 h-10 bg-gray-200 rounded-md flex items-center justify-center hover:bg-gray-300"
              onClick={() => {
                if (item.amount > 0) {
                  // Decrease stock using the hook
                  const newAmount = Math.max(0, item.amount - changeAmount);
                  updateStockItem(category, item.id, newAmount);
                  setNumericAmount(newAmount);
                }
              }}
            >
              -
            </button>
            <button 
              className="w-10 h-10 bg-gray-200 rounded-md flex items-center justify-center hover:bg-gray-300"
              onClick={() => {
                // Increase stock using the hook
                const newAmount = Math.min(item.capacity, item.amount + changeAmount);
                updateStockItem(category, item.id, newAmount);
                setNumericAmount(newAmount);
              }}
            >
              +
            </button>
          </div>
        </div>
        
        {/* Interactive slider for stock level */}
        <div className="w-full mt-2">
          <div className="flex items-center">
            <input
              type="range"
              min="0"
              max={item.capacity}
              step={item.unit === 'pcs' ? 1 : 0.1}
              value={item.amount}
              onChange={handleSliderChange}
              className="w-full h-5 appearance-none bg-gray-200 rounded-full focus:outline-none"
              style={{
                background: `linear-gradient(to right, ${getStatusColor(item.status)} 0%, ${getStatusColor(item.status)} ${percentage}%, #e5e7eb ${percentage}%, #e5e7eb 100%)`
              }}
            />
          </div>
          
          {/* Visual indicators for thresholds */}
          <div className="relative w-full h-6">
            {/* Low threshold indicator */}
            <div 
              className="absolute top-0 w-0.5 h-2 bg-yellow-500" 
              style={{ left: `${(item.lowThreshold / item.capacity) * 100}%` }}
            ></div>
            <div 
              className="absolute top-3 text-xs text-yellow-600" 
              style={{ left: `${(item.lowThreshold / item.capacity) * 100}%`, transform: 'translateX(-50%)' }}
            >
              Low
            </div>
            
            {/* Critical threshold indicator */}
            <div 
              className="absolute top-0 w-0.5 h-2 bg-red-500" 
              style={{ left: `${(item.criticalThreshold / item.capacity) * 100}%` }}
            ></div>
            <div 
              className="absolute top-3 text-xs text-red-600" 
              style={{ left: `${(item.criticalThreshold / item.capacity) * 100}%`, transform: 'translateX(-50%)' }}
            >
              Critical
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Function to render schedule item
  const renderScheduleItem = (item, type) => {
    const getStatusClass = (status) => {
      switch(status) {
        case 'active':
          return 'bg-green-100 border-green-500 text-green-700';
        case 'upcoming':
          return 'bg-blue-100 border-blue-500 text-blue-700';
        case 'completed':
          return 'bg-gray-100 border-gray-500 text-gray-700';
        default:
          return 'bg-gray-100 border-gray-500 text-gray-700';
      }
    };
    
    return (
      <div 
        key={`${type}-${item.id}`}
        className={`mb-2 p-3 rounded-lg border-l-4 ${getStatusClass(item.status)} shadow-sm`}
      >
        <div className="flex justify-between items-center">
          <div className="font-bold">{item.start} - {item.end}</div>
          {type === 'shift' && (
            <div className="text-sm bg-amber-100 text-amber-800 px-2 py-1 rounded">
              {item.barista}
            </div>
          )}
          {type === 'rush' && (
            <div className="text-sm bg-red-100 text-red-800 px-2 py-1 rounded">
              Rush Period
            </div>
          )}
        </div>
        <div className="mt-2">
          {type === 'shift' && <div className="text-gray-700">Barista Shift</div>}
          {type === 'break' && <div className="text-gray-700">Break Time for {item.barista}</div>}
          {type === 'rush' && <div className="text-gray-700">{item.reason}</div>}
        </div>
      </div>
    );
  };
  
    // Dismissible Info Panel Component
  const DismissibleInfoPanel = ({ id, title, message, extraContent, borderColor = 'green', bgColor = 'green', isDismissed, onDismiss }) => {
    if (isDismissed) return null;
    
    return (
      <div className={`bg-${bgColor}-100 border-l-4 border-${borderColor}-500 text-${borderColor}-700 p-2 mb-3 relative`}>
        <div className="flex">
          <div className="py-1">
            <svg className={`fill-current h-5 w-5 text-${borderColor}-500 mr-2`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
              <path d="M2.93 17.07A10 10 0 1 1 17.07 2.93 10 10 0 0 1 2.93 17.07zm12.73-1.41A8 8 0 1 0 4.34 4.34a8 8 0 0 0 11.32 11.32zM9 11V9h2v6H9v-4zm0-6h2v2H9V5z"/>
            </svg>
          </div>
          <div className="pr-7">
            <p className="font-bold text-sm">{title}</p>
            <p className="text-xs">{message}</p>
            {extraContent && <div className="mt-1 text-xs">{extraContent}</div>}
          </div>
        </div>
        
        {/* Close button */}
        <button 
          className="absolute top-1 right-1 text-gray-500 hover:text-gray-800 bg-white rounded-full p-1 shadow-sm"
          onClick={() => onDismiss(id)}
          aria-label="Dismiss message"
          title="Dismiss this message"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    );
  };
  
  // Notification Settings Component
  const NotificationSettings = () => {
    const [localSettings, setLocalSettings] = useState({
      autoSendSmsOnComplete: settings.autoSendSmsOnComplete,
      remindAfterDelay: settings.remindAfterDelay,
      reminderDelay: settings.reminderDelay,
      showNameOnDisplay: settings.showNameOnDisplay
    });
    
    const saveSettings = () => {
      // Update parent settings (this device's local state + localStorage)
      setSettings(prev => ({...prev, ...localSettings}));

      // Update MessageService settings
      MessageService.updateSettings(localSettings);

      // Persist to the BACKEND too. setSettings only writes THIS device's
      // localStorage, so settings like "Show customer name on display" never
      // reached the public Display screen (a separate device that reads these
      // from the backend). updateSettings PUTs to /api/settings and is
      // non-fatal if the API call fails.
      SettingsService.updateSettings(localSettings)
        .then(() => showToast('Notification settings saved', 'success'))
        .catch(() => showToast(
          'Saved on this device, but the server sync failed — the public '
          + 'Display may not reflect these until it succeeds.', 'error', 6000));
    };
    
    return (
      <div className="p-4 border rounded shadow-lg bg-white">
        <h3 className="text-lg font-bold mb-4">Notification Settings</h3>
        <div className="space-y-4">
          <div>
            <label className="flex items-center space-x-2">
              <input 
                type="checkbox" 
                checked={localSettings.autoSendSmsOnComplete} 
                onChange={e => setLocalSettings({...localSettings, autoSendSmsOnComplete: e.target.checked})}
              />
              <span>Automatically send SMS when order is completed</span>
            </label>
          </div>
          
          <div>
            <label className="flex items-center space-x-2">
              <input 
                type="checkbox" 
                checked={localSettings.showNameOnDisplay} 
                onChange={e => setLocalSettings({...localSettings, showNameOnDisplay: e.target.checked})}
              />
              <span>Show customer name on display screen</span>
            </label>
          </div>
          
          <div>
            <label className="flex items-center space-x-2">
              <input 
                type="checkbox" 
                checked={localSettings.remindAfterDelay} 
                onChange={e => setLocalSettings({...localSettings, remindAfterDelay: e.target.checked})}
              />
              <span>Send reminder if order not picked up</span>
            </label>
            
            {localSettings.remindAfterDelay && (
              <div className="pl-6 mt-2">
                <label className="flex items-center space-x-2">
                  <span>Reminder delay (seconds):</span>
                  <input 
                    type="number" 
                    min="10" 
                    max="300"
                    value={localSettings.reminderDelay} 
                    onChange={e => setLocalSettings({...localSettings, reminderDelay: parseInt(e.target.value)})}
                    className="w-20 p-1 border rounded"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
        
        <div className="mt-4 flex justify-end">
          <button 
            className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
            onClick={saveSettings}
          >
            Save Settings
          </button>
        </div>
      </div>
    );
  };

  // Main component render
  return (
    <div className="bg-gray-100 min-h-screen flex flex-col">
      {/* Toast Notifications */}
      <ToastManager />
      
      {/* Header - Connection Banner */}
      {!online && (
        <div className="bg-red-500 text-white p-2 text-center">
          Could not connect to backend service. Using sample data instead.
        </div>
      )}
      
      {/* Demo Mode Indicator */}
      {isDemoMode && (
        <div className="bg-amber-500 text-white p-2 text-center">
          Demo Mode Active - Using simulated data
        </div>
      )}
      
      {/* Main Header */}
      {/* Header. On mobile it wraps (flex-wrap) instead of overflowing, and
          the less-critical pills (Display, auto-refresh) are hidden — the
          barista keeps Station / Online / Queue / Wait / Questions / HELP. */}
      <header className={`bg-amber-800 text-white flex flex-wrap gap-y-2 justify-between items-center shadow-md ${settings.rushMode ? 'px-3 py-1.5' : 'p-4'}`}>
        <div className="flex items-center">
          <button 
            className="mr-2 p-1 rounded hover:bg-amber-700"
            onClick={() => window.history.back()}
            title="Back to Home"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="text-xl font-bold cursor-pointer" onClick={() => setShowStationSelector(!showStationSelector)}>
            {(() => {
              // Try to get custom name from localStorage first
              if (selectedStation) {
                try {
                  const customName = localStorage.getItem(`coffee_station_name_${selectedStation}`);
                  if (customName) {
                    return customName;
                  }
                } catch (e) {
                  console.error('Error getting custom station name for display:', e);
                }
              }
              // Fall back to station from list if no custom name
              return stations.find(s => s.id === selectedStation)?.name || 'Select a Station';
            })()}
            <ChevronDown size={16} className="inline ml-1" />
          </div>
          
          {/* Station Selector Dropdown */}
          {showStationSelector && (
            <div className="absolute top-16 left-4 bg-white text-gray-800 shadow-lg rounded-md overflow-hidden z-50">
              {stations.map(station => (
                <div 
                  key={station.id}
                  className={`p-3 hover:bg-gray-100 cursor-pointer ${station.id === selectedStation ? 'bg-amber-100' : ''}`}
                  onClick={() => {
                    // Change selected station (this will trigger sync in useOrders)
                    changeSelectedStation(station.id);
                    
                    // Get station-specific barista name for the new station
                    const stationBaristaName = getStationBaristaName(station.id);
                    
                    // Check for custom station name in localStorage
                    let customStationName = station.name;
                    try {
                      const customName = localStorage.getItem(`coffee_station_name_${station.id}`);
                      if (customName) {
                        console.log(`Found custom station name in localStorage: ${customName}`);
                        customStationName = customName;
                      }
                    } catch (e) {
                      console.error('Error getting custom station name from localStorage:', e);
                    }
                    
                    // Update settings with new station info
                    setSettings(prev => ({
                      ...prev,
                      stationName: customStationName, // Use custom name if available
                      baristaName: stationBaristaName
                    }));
                    
                    // Also initialize ChatService with the correct names
                    ChatService.initialize(
                      station.id, 
                      customStationName,
                      stationBaristaName
                    );
                    
                    setShowStationSelector(false);
                    // Refresh data for the new station
                    refreshData();
                  }}
                >
                  <div className="font-medium">
                    {(() => {
                      try {
                        const customName = localStorage.getItem(`coffee_station_name_${station.id}`);
                        return customName || station.name;
                      } catch (e) {
                        return station.name;
                      }
                    })()}
                  </div>
                  <div className="text-xs text-gray-500 flex items-center">
                    <div className={`w-2 h-2 rounded-full mr-1 ${station.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    {station.status === 'active' ? 'Active' : 'Maintenance'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="flex flex-wrap gap-2 items-center">
          {/* Online/Offline — toggles whether THIS station accepts new orders.
              Tap to take it offline (with confirm) or bring it back. The old
              Display shortcut was removed (the Display tab still exists). */}
          <button
            className={`px-4 py-1 rounded-full flex items-center transition-colors ${stationOnline ? 'bg-green-500 hover:bg-green-600' : 'bg-gray-500 hover:bg-gray-600'}`}
            onClick={toggleStationOnline}
            title={stationOnline ? 'Online and taking orders — click to take this station offline' : 'Offline — not receiving new orders. Click to bring it back online'}
          >
            <div className={`w-3 h-3 rounded-full ${stationOnline ? 'bg-green-200' : 'bg-gray-300'} mr-2`}></div>
            {stationOnline ? 'Online' : 'Offline'}
          </button>

          {/* Auto-refresh interval picker — tap to choose how often the queue
              refreshes. Hidden on mobile to declutter. */}
          <div className="relative hidden md:block">
            <button
              className={`px-4 py-1 rounded-full flex items-center ${autoRefreshEnabled ? 'bg-green-500 hover:bg-green-600' : 'bg-gray-500 hover:bg-gray-600'}`}
              onClick={() => setShowRefreshMenu(v => !v)}
              title={autoRefreshEnabled ? `Auto-refresh every ${autoRefreshInterval}s — click to change` : 'Auto-refresh off — click to choose an interval'}
            >
              <RefreshCw size={14} className={`mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
              {autoRefreshEnabled ? `${autoRefreshInterval}s` : 'Off'}
              <ChevronDown size={14} className="ml-1" />
            </button>
            {showRefreshMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowRefreshMenu(false)}></div>
                <div className="absolute right-0 mt-1 bg-white text-gray-800 shadow-lg rounded-md overflow-hidden z-50 w-36">
                  <div className="px-3 py-1.5 text-xs text-gray-500 border-b">Refresh queue every</div>
                  {[
                    { label: 'Off', value: 0 },
                    { label: '5 seconds', value: 5 },
                    { label: '15 seconds', value: 15 },
                    { label: '30 seconds', value: 30 },
                    { label: '60 seconds', value: 60 },
                  ].map(opt => {
                    const active = opt.value === 0 ? !autoRefreshEnabled : (autoRefreshEnabled && autoRefreshInterval === opt.value);
                    return (
                      <button
                        key={opt.value}
                        className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${active ? 'bg-amber-100 font-medium text-amber-800' : ''}`}
                        onClick={() => setRefreshInterval(opt.value)}
                      >
                        {opt.label}{opt.value === 5 ? ' (fast)' : ''}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="px-4 py-1 rounded-full bg-green-500">
            Queue: {queueCount}
          </div>

          {/* Coffees made today at this station. Two jobs: it is the
              number the baristas were writing down by hand for invoicing,
              and it is crash insurance -- if the system stalls they can
              see it stopped at 78 rather than reconstructing it later.
              Clicking it opens the full session summary. */}
          {madeToday !== null && (
            <button
              className="px-4 py-1 rounded-full bg-amber-900 hover:bg-amber-950 transition-colors"
              onClick={() => { setShowSessionReport(true); refreshSession(); }}
              title="Coffees finished at this station today - click for the full summary"
            >
              Made: {madeToday}
            </button>
          )}

          {/* Wait pill shows the live SMART estimate (backend: per-drink
              make-time × pending+in-progress ÷ station capacity — the same
              number SMS customers get). Falls back to the manual value at
              event start before real data exists. Tap to set the manual
              starting estimate. */}
          <button
            className="px-4 py-1 rounded-full bg-green-500 hover:bg-green-600 flex items-center transition-colors"
            onClick={() => setShowWaitTimeDialog(true)}
            title="The walk-up answer: if someone orders RIGHT NOW, this is roughly how long until their coffee — live estimate from the current queue, real make-times and station capacity. With an empty queue it's just the time to make one coffee. Click to set the starting estimate (used until enough real orders complete)."
          >
            <Clock size={14} className="mr-1" />
            Walk-up ~{currentStationObj?.estimatedWait ?? waitTime} min
          </button>

          {/* Other stations at a glance (e.g. S2: Q5) so a barista can send a
              walk-up to a quieter station. Green = quiet, amber = busy, red =
              very busy. Hidden on mobile to keep the condensed header tidy. */}
          {otherStations.map(s => {
            const q = s.queueCount ?? 0;
            // An offline station must NOT look "quiet/green" — that would
            // invite a barista to send a walk-up to a closed station. Grey it
            // out and show "off" instead of a queue count.
            const offline = (s.status || 'active') !== 'active';
            const tone = offline
              ? 'bg-gray-500 text-gray-200'
              : q <= 2 ? 'bg-green-600 text-white'
              : q <= 5 ? 'bg-yellow-500 text-yellow-900'
              : 'bg-red-600 text-white';
            return (
              <div
                key={s.id}
                className={`px-3 py-1 rounded-full text-sm hidden md:flex items-center ${tone}`}
                title={offline
                  ? `${s.name}: offline (not taking orders)`
                  : `${s.name}: ${q} order${q === 1 ? '' : 's'} in queue`}
              >
                {shortStationLabel(s.name, s.id)}: {offline ? 'off' : `Q${q}`}
              </div>
            );
          })}

          {/* Label printer chip — only shown when this station has an
              enabled printer assigned. Green = polled within the last 15s,
              red = printer has stopped polling (power/WiFi). Desktop only,
              like the station pills. */}
          {stationPrinter && (
            <div
              className={`px-3 py-1 rounded-full text-sm hidden md:flex items-center ${
                stationPrinter.online ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}
              title={stationPrinter.online
                ? `${stationPrinter.name || 'Label printer'}: online`
                : `${stationPrinter.name || 'Label printer'}: OFFLINE — check power/WiFi. Labels will queue and print when it reconnects.`}
            >
              <Printer size={14} className="mr-1" />
              {stationPrinter.online ? 'Labels' : 'Labels off'}
            </div>
          )}

          {/* Customer questions + station chat now live in the blue Messages
              bubble (bottom-right); the static HELP button was removed to
              declutter the header. */}

          {/* Rush mode. The way in AND the way out -- in rush mode every
              other menu is gone, so this button must stay visible and
              obvious, and it says EXIT rather than showing a state. It
              also asks the browser for real fullscreen, which reclaims
              the address bar on a tablet; if that is refused (some
              kiosks block it) the in-page saving still applies. */}
          <button
            className={`px-3 py-1 rounded-full flex items-center transition-colors text-sm mr-2 ${
              settings.rushMode
                ? 'bg-white text-amber-900 font-bold hover:bg-amber-100'
                : 'bg-amber-900 hover:bg-amber-950'}`}
            onClick={async () => {
              const next = !settings.rushMode;
              setSettings(prev => ({ ...prev, rushMode: next }));
              try {
                if (next && document.documentElement.requestFullscreen) {
                  await document.documentElement.requestFullscreen();
                } else if (!next && document.fullscreenElement && document.exitFullscreen) {
                  await document.exitFullscreen();
                }
              } catch (e) {
                // Fullscreen is a bonus, not the feature. A refusal must
                // never stop the toggle -- the barista still gets the
                // hidden menus and the tighter cards.
              }
            }}
            title={settings.rushMode
              ? 'Show the menus and batch suggestions again'
              : 'Hide the menus and suggestions, pack the cards, go fullscreen'}
          >
            {settings.rushMode
              ? <><Minimize2 size={14} className="mr-1" /> Exit rush</>
              : <><Maximize2 size={14} className="mr-1" /> Rush</>}
          </button>

          {/* Admin-only "Switch view" — jump to another interface from the
              header (replaces the floating switcher on this screen, which is
              hidden on /barista). Desktop only. */}
          {_currentRole === 'admin' && (
            <div className="relative hidden md:block">
              <button
                onClick={() => setShowViewSwitch(v => !v)}
                className="px-3 py-1 rounded-full bg-amber-900 hover:bg-amber-950 flex items-center transition-colors text-sm"
                title="Switch to another interface (Organiser / Barista / Support / Display)"
              >
                <Shuffle size={14} className="mr-1" /> Switch view
              </button>
              {showViewSwitch && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowViewSwitch(false)}></div>
                  <div className="absolute right-0 mt-2 w-44 bg-white text-gray-800 rounded-lg shadow-lg z-50 overflow-hidden">
                    <div className="px-3 py-1.5 text-xs text-gray-500 border-b">Switch view</div>
                    {[
                      { path: '/organiser', label: 'Organiser' },
                      { path: '/barista', label: 'Barista' },
                      { path: '/support', label: 'Support' },
                      { path: '/displays', label: 'Display' },
                    ].map(v => (
                      <button
                        key={v.path}
                        onClick={() => { window.location.href = v.path; }}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Navigation Tabs (desktop), grouped. On mobile these are replaced
          by the fixed bottom tab bar below.

          Groups render only the leaves the current role may see, so a
          plain barista's "Team" collapses to just Schedule (Staff is
          manager-only) — and when a group has one visible leaf it is
          drawn as a plain tab under that leaf's own name, rather than a
          heading over a single-item sub-bar. */}
      {/* Both tab bars go away in rush mode -- the slim header keeps the
          way out, and everything else is a menu the barista is not using
          while there are ten coffees on the bench. */}
      {!settings.rushMode && (
      <div className="hidden md:block bg-white border-b shadow-sm">
        <div className="flex">
          {BARISTA_GROUPS.map((g) => {
            const leaves = (g.tabs || [{ id: g.tab, label: g.label, Icon: g.Icon }])
              .filter((t) => isManager || !MANAGER_ONLY_TABS.includes(t.id));
            if (leaves.length === 0) return null;
            const isActive = leaves.some((t) => t.id === activeTab);
            // One visible leaf: show it under its own name.
            const single = leaves.length === 1;
            const label = single ? leaves[0].label : g.label;
            const Icon = single ? leaves[0].Icon : g.Icon;
            return (
              <button
                key={g.id}
                className={`py-4 px-6 font-medium flex items-center ${isActive ? 'border-b-2 border-amber-600 bg-white text-amber-800' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                onClick={() => {
                  if (isActive) return;
                  // Return to the leaf last used in this group.
                  const remembered = groupSubTab[g.id];
                  const target = leaves.some((t) => t.id === remembered)
                    ? remembered
                    : leaves[0].id;
                  setActiveTab(target);
                }}
              >
                <Icon size={18} className="mr-1" />
                {label}
              </button>
            );
          })}
        </div>

        {/* Sub-tabs for the active group. Only drawn when the group has
            more than one leaf this role can see. */}
        {(() => {
          const g = BARISTA_GROUPS.find(
            (grp) => (grp.tabs || []).some((t) => t.id === activeTab)
          );
          if (!g) return null;
          const leaves = g.tabs.filter(
            (t) => isManager || !MANAGER_ONLY_TABS.includes(t.id)
          );
          if (leaves.length < 2) return null;
          return (
            <div className="flex bg-white border-t border-gray-100 px-4">
              {leaves.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={`py-2 px-4 text-sm font-medium flex items-center border-b-2 ${activeTab === id ? 'border-amber-500 text-amber-800' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                  onClick={() => {
                    setActiveTab(id);
                    setGroupSubTab((prev) => ({ ...prev, [g.id]: id }));
                  }}
                >
                  <Icon size={15} className="mr-1" />
                  {label}
                </button>
              ))}
            </div>
          );
        })()}
      </div>
      )}

      {/* Mobile bottom tab bar — replaces the overflowing top tab row on
          phones. Plain baristas get Orders / Stock / Completed; managers
          also get a "More" sheet with the configuration tabs. Hidden on
          md+ (desktop keeps the top tab row). */}
      {!settings.rushMode && (
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-lg flex">
        {[
          { id: 'orders', label: 'Orders', Icon: Coffee },
          { id: 'stock', label: 'Stock', Icon: Package },
          { id: 'completed', label: 'Done', Icon: Check },
          { id: 'tools', label: 'Tools', Icon: Wrench },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`flex-1 flex flex-col items-center justify-center py-2 ${activeTab === id ? 'text-amber-700' : 'text-gray-500'}`}
            onClick={() => { setActiveTab(id); setShowMobileMore(false); }}
          >
            <Icon size={20} />
            <span className="text-xs mt-0.5">{label}</span>
          </button>
        ))}
        {isManager && (
          <button
            className={`flex-1 flex flex-col items-center justify-center py-2 ${showMobileMore || !['orders', 'stock', 'completed'].includes(activeTab) ? 'text-amber-700' : 'text-gray-500'}`}
            onClick={() => setShowMobileMore(v => !v)}
          >
            <MoreHorizontal size={20} />
            <span className="text-xs mt-0.5">More</span>
          </button>
        )}
      </div>
      )}

      {/* Mobile "More" sheet — the manager/config tabs, opened from the bar. */}
      {showMobileMore && isManager && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setShowMobileMore(false)}>
          <div className="absolute inset-0 bg-black bg-opacity-40"></div>
          <div className="absolute bottom-14 left-0 right-0 bg-white rounded-t-2xl shadow-xl p-3" onClick={e => e.stopPropagation()}>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'inventory', label: 'Inventory', Icon: Package },
                { id: 'schedule', label: 'Schedule', Icon: Calendar },
                { id: 'display', label: 'Display', Icon: Monitor },
                { id: 'queue', label: 'Queue Rules', Icon: Brain },
                { id: 'balance', label: 'Balance', Icon: Scale },
                { id: 'capabilities', label: 'Capabilities', Icon: Settings },
                { id: 'staff', label: 'Staff', Icon: Users },
                { id: 'settings', label: 'Settings', Icon: Settings },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={`flex flex-col items-center justify-center py-3 rounded-lg ${activeTab === id ? 'bg-amber-100 text-amber-800' : 'bg-gray-50 text-gray-700'}`}
                  onClick={() => { setActiveTab(id); setShowMobileMore(false); }}
                >
                  <Icon size={20} />
                  <span className="text-xs mt-1">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Content. Extra bottom padding on mobile so the fixed bottom
          tab bar + sticky action footer don't cover the last items. */}
      <div className="p-4 flex-grow overflow-y-auto pb-24 md:pb-4">
        {/* Loading state */}
        {loading && (
          <div className="flex justify-center items-center h-full">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-600"></div>
          </div>
        )}
        
        {/* Error state */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
            <strong className="font-bold">Error!</strong>
            <span className="block sm:inline"> {error}</span>
            <button 
              className="absolute top-0 bottom-0 right-0 px-4 py-3"
              onClick={clearError}
            >
              <XCircle size={20} />
            </button>
          </div>
        )}
        
        {/* Last Updated indicator */}
        {!loading && !error && !settings.rushMode && (
          <div className="text-xs text-gray-500 mb-2 flex items-center">
            <Clock size={12} className="mr-1" />
            Last updated: {new Date(lastUpdated).toLocaleTimeString()}
            {isRefreshing && (
              <span className="ml-2 flex items-center text-amber-600">
                <RefreshCw size={12} className="animate-spin mr-1" />
                Refreshing...
              </span>
            )}
          </div>
        )}

        {/* LOW STOCK banner — persistent while anything is at/below its
            threshold, on every tab. With ignore-stock mode on, orders
            keep flowing, so this is the barista's ONLY warning that the
            real-world supplies need topping up. */}
        {/* The printer's own complaint, where the barista is looking.
            A stuck queue with no explanation sends someone to debug the
            server; "Out of paper" sends them to the roll. */}
        {stationPrinter?.fault && (
          <div className="mb-3 rounded-lg border-l-4 border-red-600 bg-red-50 px-4 py-3 text-red-800">
            <div className="font-bold flex items-center">
              <Printer size={18} className="mr-2" />
              Printer: {stationPrinter.fault}
            </div>
            <div className="text-sm mt-0.5">
              Labels are queuing up and will print as soon as this is sorted —
              nothing needs re-sending.
            </div>
          </div>
        )}
        {lowStockItems.length > 0 && (
          <div className="mb-3 rounded-lg border-l-4 border-red-600 bg-red-50 px-4 py-3 text-red-800">
            <div className="font-bold flex items-center">
              ⚠ Low stock at this station
            </div>
            <div className="text-sm mt-1">
              {lowStockItems.map(i =>
                `${i.name}: ${parseFloat(i.amount) || 0}${i.unit ? ` ${i.unit}` : ''} left (min ${parseFloat(i.minimum_threshold) || 0})`
              ).join(' · ')}
            </div>
            <div className="text-xs mt-1 text-red-700">
              Orders keep coming — restock from back of house, or turn the item off
              in the Stock tab so customers stop ordering it.
            </div>
          </div>
        )}
        
        {/* Orders Tab */}
        {!loading && activeTab === 'orders' && (
          <>
          {/* Batch suggestions are a planning aid, not something you read
              mid-rush -- and they were costing two rows above the columns. */}
          {!settings.rushMode && (
          <RushMixStrip
            pendingOrders={pendingOrders}
            inProgressOrders={inProgressOrders}
            stationName={currentStationObj?.name || `Station ${selectedStation}`}
            onStartBatch={handleStartRushBatch}
            onBatchComplete={handleBatchComplete}
          />
          )}
          {/* Column order follows the work: Upcoming, then Current, then
              Ready. Steve asked for "columb progression" after CTN26,
              where the middle-of-the-board Current column filled up and
              the eye had to jump about to follow one order through. The
              older Current-first layout is still selectable in Settings.

              `board-compact` tightens the cards for a station making
              8-10 at once -- see styles/boardDensity.css. */}
          {/* `board-rtl` mirrors the column order for a cart where the
              queue is on the barista's right and the hatch is on their
              left, so the board matches the bench instead of fighting it
              (Steve: "orders comes in on 1 side and goes out on the
              other"). It flips the grid, not the JSX, so the reading
              order and the keyboard order stay put. */}
          <div className={`grid grid-cols-1 ${
            settings.skipPickedUp ? 'lg:grid-cols-2' : 'lg:grid-cols-3'} gap-4${
            (settings.compactOrders || settings.rushMode) ? ' board-compact' : ''}${
            settings.boardColumnOrder === 'progression-rtl' ? ' board-rtl' : ''}`}>
            {settings.boardColumnOrder !== 'current-first' && (
              /* Pending Orders */
              <PendingOrdersSection
                orders={pendingOrders}
                teamMode={teamMode}
                filter={filter}
                onFilterChange={setFilter}
                onStartOrder={startOrderWithLabel}
                onProcessBatch={processBatch}
                onSendMessage={handleOpenMessageDialog}
                onDelayOrder={handleDelayOrder}
                onEditOrder={handleEditOrder}
                onMoveOrder={handleOpenMoveDialog}
                groupInfoByOrderId={groupInfoByOrderId}
                onStartGroup={handleStartGroup}
              />
            )}

            {/* Current Order (In Progress) */}
            <div>
              <div className="bg-amber-700 text-white p-2 rounded-t-lg flex justify-between items-center flex-wrap gap-y-1">
                <h2 className="text-xl font-bold">Current Order ({inProgressOrders.length})</h2>
                {/* Same place and same shape as the Upcoming column's
                    chips, so the two headers read as one control strip
                    rather than two different ideas. */}
                {inProgressOrders.length > 1 && (
                  <div className="flex flex-wrap gap-1">
                    <button
                      className="px-2 py-1 rounded-md text-xs bg-amber-600 hover:bg-amber-800"
                      onClick={() => setCurrentSort(v => v === 'oldest' ? 'newest' : 'oldest')}
                      title={currentSort === 'oldest'
                        ? 'Longest on the bench first — click for newest first'
                        : 'Newest first — click for longest on the bench first'}
                    >
                      {currentSort === 'oldest' ? '↑ Old' : '↓ New'}
                    </button>
                    {milkOptions(inProgressOrders, 2).length > 0 && (
                      <>
                        <button
                          className={`px-2 py-1 rounded-md text-xs ${!currentMilkFilter
                            ? 'bg-white text-amber-700' : 'bg-amber-600 hover:bg-amber-800'}`}
                          onClick={() => setCurrentMilkFilter('')}
                        >
                          All
                        </button>
                        {milkOptions(inProgressOrders, 2).map(m => (
                          <button
                            key={m.milk}
                            className={`px-2 py-1 rounded-md text-xs ${currentMilkFilter === m.milk
                              ? 'bg-white text-amber-700' : 'bg-amber-600 hover:bg-amber-800'}`}
                            onClick={() => setCurrentMilkFilter(
                              currentMilkFilter === m.milk ? '' : m.milk)}
                          >
                            {/* No count on the chip: the Steam strip
                                directly below already gives counts and
                                litres, and the milk names are long enough
                                that the counts wrapped this header onto a
                                second row while the other two stayed on
                                one. */}
                            {m.milk}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="bg-white p-4 rounded-b-lg shadow-md">
                {(() => {
                  const jugs = summariseMilk(inProgressOrders);
                  const shown = sortCurrentOrders(
                    filterByMilk(inProgressOrders, currentMilkFilter), currentSort);
                  return (
                    <>
                      {/* What to steam, in litres, for everything on the
                          bench. One trip to the machine instead of four.
                          Ignores the milk filter on purpose -- you steam
                          for the whole bench, not for what you filtered. */}
                      {jugs.length > 0 && (
                        <div className="mb-3 text-sm bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex flex-wrap gap-x-3 gap-y-1">
                          <span className="font-semibold text-amber-900">Steam:</span>
                          {jugs.map(j => (
                            <span key={j.milk} className="text-amber-900 whitespace-nowrap">
                              {j.litres}L {j.milk}
                              <span className="text-amber-700"> ({j.count})</span>
                            </span>
                          ))}
                        </div>
                      )}

                      {shown.length > 0 ? (
                        shown.map(order => renderInProgressOrder(order))
                      ) : inProgressOrders.length > 0 ? (
                        <div className="text-center py-6 text-gray-500 text-sm">
                          <p>Nothing on the bench with {currentMilkFilter} milk</p>
                          <button className="mt-1 text-amber-700 underline"
                                  onClick={() => setCurrentMilkFilter('')}>
                            Show all {inProgressOrders.length}
                          </button>
                        </div>
                      ) : (
                        <div className="text-center py-8 text-gray-500">
                          <Coffee size={48} className="mx-auto mb-2 text-gray-400" />
                          <p>No orders in progress</p>
                          <p className="text-sm text-gray-400">Start an order from the queue</p>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

            {settings.boardColumnOrder === 'current-first' && (
            /* Pending Orders */
            <PendingOrdersSection
              orders={pendingOrders}
              teamMode={teamMode}
              filter={filter}
              onFilterChange={setFilter}
              onStartOrder={startOrderWithLabel}
              onProcessBatch={processBatch}
              onSendMessage={handleOpenMessageDialog}
              onDelayOrder={handleDelayOrder}
              onEditOrder={handleEditOrder}
              onMoveOrder={handleOpenMoveDialog}
              groupInfoByOrderId={groupInfoByOrderId}
              onStartGroup={handleStartGroup}
            />
            )}

            {/* Ready for Pickup — recently-completed orders at this
                station with a Collected button. Steve wanted this
                visible on the main Orders tab so the barista doesn't
                have to switch to the Completed tab to mark orders
                as collected as customers arrive. Stale orders still
                live under the full Completed tab.

                Hidden entirely when "Completing an order finishes it"
                is on: the grid drops to two columns and the barista
                never taps Collected. The order still shows as ready on
                the customer display and still ages off there. */}
            {!settings.skipPickedUp && (
            <ReadyForPickupColumn
              completedOrders={completedOrders}
              stationId={selectedStation}
              expiryMinutes={settings.readyExpiryMinutes}
              onMarkPickedUp={markOrderPickedUp}
              onSendMessage={handleOpenMessageDialog}
            />
            )}
          </div>
          </>
        )}

        {/* Stock Management Tab */}
        {!loading && activeTab === 'stock' && (
          <div className="p-4">
            {/* Reality's shortcut: one tap 86s an item on every
                channel, whatever the ledger believes. Sits above the
                counts because "we just ran out" outranks bookkeeping. */}
            <EightySixBoard />
            {/* Local Stock Management Information */}
            <DismissibleInfoPanel
              id="stockInfoPanel"
              title="Station-Specific Inventory Management"
              message="This station's inventory is saved locally. Each station manages its own inventory independently."
              borderColor="green"
              bgColor="green"
              isDismissed={dismissedPanels.stockInfoPanel}
              onDismiss={dismissPanel}
              extraContent={
                (lowCount > 0 || criticalCount > 0) && (
                  <p className="font-medium">
                    {criticalCount > 0 && <span className="text-red-600 mr-2">Critical: {criticalCount} items</span>}
                    {lowCount > 0 && <span className="text-yellow-600">Low: {lowCount} items</span>}
                  </p>
                )
              }
            />
            
            {/* Category Selector */}
            <div className="flex flex-wrap gap-2 mb-4">
              {stockCategories.map(category => (
                <button
                  key={category}
                  className={`px-4 py-2 rounded-full ${selectedStockCategory === category ? 'bg-green-500 text-white' : 'bg-gray-200'}`}
                  onClick={() => setSelectedStockCategory(category)}
                >
                  {category.charAt(0).toUpperCase() + category.slice(1)}
                </button>
              ))}
            </div>
            
            {/* Stock Items */}
            <h2 className="text-xl font-bold mb-4 flex items-center justify-between">
              <span>{selectedStockCategory.charAt(0).toUpperCase() + selectedStockCategory.slice(1)} Inventory</span>
              
            </h2>
            
            <div className="space-y-4 bg-white rounded-lg shadow-md p-4">
              {stockLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-green-500"></div>
                </div>
              ) : getCategoryStock(selectedStockCategory).length > 0 ? (
                getCategoryStock(selectedStockCategory).map(item => (
                  <StockItem 
                    key={item.id}
                    item={item} 
                    category={selectedStockCategory}
                    updateStockItem={updateStockItem}
                    deleteStockItem={deleteStockItem}
                    addStockItem={addStockItem}
                  />
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Package size={48} className="mx-auto mb-2 text-gray-400" />
                  <p>No {selectedStockCategory} items found</p>
                  <p className="text-sm text-gray-400">Click 'Add Event Stock' to add standard items or 'Custom Item' for unique items</p>
                </div>
              )}
            </div>
            
            {/* Stock Action Buttons */}
            <div className="flex flex-wrap gap-2 mt-6">
              <button 
                className="flex-1 py-3 bg-green-500 text-white rounded-md font-medium hover:bg-green-600"
                onClick={() => {
                  // Show confirmation message in alert and proceed if user enters "yes"
                  const userConfirmed = window.prompt(`Type 'yes' to confirm restocking all ${selectedStockCategory} items to full capacity:`) === 'yes';
                  
                  if (userConfirmed) {
                    // Get all items in the current category
                    const items = getCategoryStock(selectedStockCategory);
                    // Update each item to full capacity
                    items.forEach(item => {
                      updateStockItem(selectedStockCategory, item.id, item.capacity);
                    });
                  }
                }}
              >
                Restock All to Full
              </button>
              
              <button 
                className="flex-1 py-3 bg-gray-500 text-white rounded-md font-medium hover:bg-gray-600"
                onClick={() => {
                  // Prompt for item selection to delete
                  const items = getCategoryStock(selectedStockCategory);
                  if (items.length === 0) {
                    showToast(`No ${selectedStockCategory} items to delete`, 'info');
                    return;
                  }
                  
                  // Create item options as a numbered list
                  let message = `Select item to delete:\n`;
                  items.forEach((item, index) => {
                    message += `${index + 1}. ${item.name}\n`;
                  });
                  
                  // Get selection
                  const selection = prompt(message);
                  if (selection) {
                    const index = parseInt(selection, 10) - 1;
                    if (!isNaN(index) && index >= 0 && index < items.length) {
                      const item = items[index];
                      // Ask for confirmation using prompt instead of confirm
                      const deleteConfirmed = window.prompt(`Type 'yes' to confirm deleting ${item.name}:`) === 'yes';
                      if (deleteConfirmed) {
                        deleteStockItem(selectedStockCategory, item.id);
                      }
                    } else {
                      showToast('Invalid selection', 'error');
                    }
                  }
                }}
              >
                Delete Item
              </button>
              
              <button 
                className="flex-1 py-3 bg-red-500 text-white rounded-md font-medium hover:bg-red-600"
                onClick={() => {
                  // Ask for confirmation using prompt instead of confirm
                  const resetConfirmed = window.prompt('Type \'yes\' to reset all stock to default values. This cannot be undone:') === 'yes';
                  if (resetConfirmed) {
                    resetStock();
                  }
                }}
              >
                Reset to Defaults
              </button>
            </div>
          </div>
        )}
        
        {/* Inventory Intelligence Tab */}
        {!loading && activeTab === 'inventory' && (
          <div className="p-4">
            <MultiLevelInventory />
          </div>
        )}
        
        {/* Schedule Tab */}
        {!loading && activeTab === 'schedule' && (
          <div className="p-4">
            {/* API Not Implemented Notification */}
            <DismissibleInfoPanel
              id="scheduleInfoPanel"
              title="Schedule Management Available in Organiser"
              message="Create and manage schedules in the Organiser interface. Go to Organiser → Schedule to add shifts for today."
              borderColor="blue"
              bgColor="blue"
              isDismissed={dismissedPanels.scheduleInfoPanel}
              onDismiss={dismissPanel}
            />
          
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white rounded-lg shadow-md p-4">
                <h2 className="text-xl font-bold mb-4">Today's Schedule</h2>
                <div className="space-y-2">
                  {scheduleLoading ? (
                    <div className="text-center py-6">
                      <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-amber-600 mx-auto"></div>
                      <p className="mt-2 text-gray-500">Loading schedule data...</p>
                    </div>
                  ) : scheduleData.shifts && scheduleData.shifts.length > 0 ? (
                    scheduleData.shifts.map(item => {
                      // Format the schedule item for display
                      const formattedItem = {
                        id: item.id,
                        start: item.start_time || '9:00',
                        end: item.end_time || '17:00',
                        status: item.status || 'active',
                        barista: item.staff_name || 'Barista'
                      };
                      return renderScheduleItem(formattedItem, 'shift');
                    })
                  ) : (
                    <div className="text-center py-6 text-gray-500">
                      <p>No schedule data available for this station</p>
                      <p className="text-sm text-gray-400">Create schedules in the Organiser interface</p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="bg-white rounded-lg shadow-md p-4">
                <h2 className="text-xl font-bold mb-4">Breaks</h2>
                <div className="space-y-2">
                  {scheduleLoading ? (
                    <div className="text-center py-6">
                      <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-amber-600 mx-auto"></div>
                      <p className="mt-2 text-gray-500">Loading break data...</p>
                    </div>
                  ) : scheduleData.breaks && scheduleData.breaks.length > 0 ? (
                    scheduleData.breaks.map(item => renderScheduleItem(item, 'break'))
                  ) : (
                    <div className="text-center py-6 text-gray-500">
                      <p>No break data available</p>
                      <p className="text-sm text-gray-400">Break scheduling will be added soon</p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="bg-white rounded-lg shadow-md p-4 md:col-span-2">
                <h2 className="text-xl font-bold mb-4">Predicted Rush Periods</h2>
                <div className="space-y-2">
                  {scheduleLoading ? (
                    <div className="text-center py-6">
                      <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-amber-600 mx-auto"></div>
                      <p className="mt-2 text-gray-500">Loading rush period data...</p>
                    </div>
                  ) : scheduleData.rushPeriods && scheduleData.rushPeriods.length > 0 ? (
                    scheduleData.rushPeriods.map(item => renderScheduleItem(item, 'rush'))
                  ) : (
                    <div className="text-center py-6 text-gray-500">
                      <p>No rush period data available</p>
                      <p className="text-sm text-gray-400">Rush period analytics will be added soon</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Completed Orders Tab */}
        {!loading && activeTab === 'completed' && (
          <div>
            <div className="bg-white rounded-lg shadow-md p-4 mb-4">
              <h2 className="text-xl font-bold mb-3">Completed Orders</h2>
              <div className="flex space-x-2 mb-4">
                <button 
                  className={`${historyTab === 'completed' ? 'bg-amber-600 text-white' : 'bg-gray-200 hover:bg-gray-300'} px-6 py-2 rounded-full`}
                  onClick={() => setHistoryTab('completed')}
                >
                  Today
                </button>
                <button 
                  className={`${historyTab === 'yesterday' ? 'bg-amber-600 text-white' : 'bg-gray-200 hover:bg-gray-300'} px-6 py-2 rounded-full`}
                  onClick={() => {
                    setHistoryTab('yesterday');
                    fetchYesterdayOrders();
                  }}
                >
                  Yesterday
                </button>
                <button 
                  className={`${historyTab === 'thisWeek' ? 'bg-amber-600 text-white' : 'bg-gray-200 hover:bg-gray-300'} px-6 py-2 rounded-full`}
                  onClick={() => {
                    setHistoryTab('thisWeek');
                    fetchThisWeekOrders();
                  }}
                >
                  This Week
                </button>
                <button 
                  className={`${historyTab === 'search' ? 'bg-amber-600 text-white' : 'bg-gray-200 hover:bg-gray-300'} px-6 py-2 rounded-full ml-auto`}
                  onClick={() => setHistoryTab('search')}
                >
                  Search Orders
                </button>
              </div>
              
              {/* Search Box - Only shown when search tab is active */}
              {historyTab === 'search' && (
                <div className="mb-4">
                  <div className="flex">
                    <input
                      type="text"
                      placeholder="Search by customer name, order number, or coffee type..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="flex-1 p-2 border rounded-l-md"
                    />
                    <button
                      className="bg-amber-600 text-white px-4 py-2 rounded-r-md"
                      onClick={() => searchOrders(searchTerm)}
                    >
                      Search
                    </button>
                  </div>
                </div>
              )}
            </div>
            
            {/* Content based on active history tab */}
            {historyTab === 'completed' && (
              <>
                <h3 className="text-xl font-bold mb-3 ml-2">Ready for Pickup</h3>
                <div className="space-y-2 mb-6">
                  {completedOrders.length > 0 ? (
                    completedOrders.map(order => renderCompletedOrder(order))
                  ) : (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                      <p>No orders ready for pickup</p>
                    </div>
                  )}
                </div>
                
                <h3 className="text-xl font-bold mb-3 ml-2">Previously Completed</h3>
                <div className="space-y-2">
                  {previousOrders.length > 0 ? (
                    previousOrders.map(order => renderPreviousOrder(order))
                  ) : (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                      <p>No previous orders to display</p>
                    </div>
                  )}
                </div>
              </>
            )}
            
            {historyTab === 'yesterday' && (
              <>
                <h3 className="text-xl font-bold mb-3 ml-2">Yesterday's Orders</h3>
                <div className="space-y-2">
                  {loading ? (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto mb-2"></div>
                      <p className="text-gray-500">Loading yesterday's orders...</p>
                    </div>
                  ) : yesterdayOrders.length > 0 ? (
                    yesterdayOrders.map(order => renderPreviousOrder(order))
                  ) : (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                      <p>No orders from yesterday</p>
                    </div>
                  )}
                </div>
              </>
            )}
            
            {historyTab === 'thisWeek' && (
              <>
                <h3 className="text-xl font-bold mb-3 ml-2">This Week's Orders</h3>
                <div className="space-y-2">
                  {loading ? (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto mb-2"></div>
                      <p className="text-gray-500">Loading this week's orders...</p>
                    </div>
                  ) : thisWeekOrders.length > 0 ? (
                    thisWeekOrders.map(order => renderPreviousOrder(order))
                  ) : (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                      <p>No orders from this week</p>
                    </div>
                  )}
                </div>
              </>
            )}
            
            {historyTab === 'search' && (
              <>
                <h3 className="text-xl font-bold mb-3 ml-2">Search Results</h3>
                <div className="space-y-2">
                  {loading ? (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto mb-2"></div>
                      <p className="text-gray-500">Searching orders...</p>
                    </div>
                  ) : searchTerm ? (
                    searchResults.length > 0 ? (
                      searchResults.map(order => renderPreviousOrder(order))
                    ) : (
                      <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                        <p>No orders match your search</p>
                      </div>
                    )
                  ) : (
                    <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                      <p>Enter a search term to find orders</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        
        {/* Barista Tools Tab — offline helpers (timer, recipes, dial-in…).
            stationId lets the Dial-in card load/save the shared per-station recipe. */}
        {!loading && activeTab === 'tools' && (
          <ToolsTab stationId={selectedStation} baristaName={settings.baristaName} />
        )}

        {/* Queue Intelligence Tab */}
        {!loading && activeTab === 'queue' && (
          <div className="p-4">
            <QueueIntelligence />
          </div>
        )}
        
        {/* Load Balancer Tab */}
        {!loading && activeTab === 'balance' && (
          <div className="p-4">
            <StationLoadBalancer />
          </div>
        )}
        
        {/* Enhanced Capabilities Tab — two stacked sections:
            (1) the new per-station milk/drink/size editor that drives
                _assign_station routing (built May 2026), and
            (2) the older barista skill-level profile editor below it. */}
        {!loading && activeTab === 'capabilities' && (
          <div className="p-4 space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-3">Station Capabilities</h2>
              <p className="text-sm text-gray-600 mb-3">
                What each station can serve. Drives where the SMS bot
                routes incoming orders.
              </p>
              <StationCapabilitiesEditor />
            </div>
            <div className="border-t border-gray-200 pt-6">
              <h2 className="text-xl font-bold mb-3">Barista Skill Profiles</h2>
              <p className="text-sm text-gray-600 mb-3">
                Optional skill-level tracking per barista. Read-only
                analytics for now.
              </p>
              <EnhancedStationCapabilities />
            </div>
          </div>
        )}
        
        {/* Staff Allocation Tab */}
        {!loading && activeTab === 'staff' && (
          <div className="p-4">
            <DynamicStaffAllocation />
          </div>
        )}
        
        {/* Settings Tab. Order matters: Notifications first (the settings
            a barista actually reaches for mid-service), then station
            identity, then the housekeeping cards — the old order left a
            near-empty left column and pushed Notifications below the fold. */}
        {!loading && activeTab === 'settings' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
            {/* Notification Settings — promoted to the top */}
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-xl font-bold mb-4">Notification Settings</h2>
              <NotificationSettings />
            </div>
            {/* Team mode — stage chips for multiple baristas sharing this
                station's iPad. Per-device, default OFF: solo baristas
                never see the extra chips. */}
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-xl font-bold mb-4">Team Mode</h2>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={teamMode}
                  onChange={(e) => setTeamMode(e.target.checked)}
                />
                <span>
                  Stage chips on current orders — when two or more baristas
                  share this screen, each ticks their part (☕ shots / 🥛 milk)
                  and COMPLETE lights up when every part is done
                </span>
              </label>
            </div>
            {/* Order board — how the three columns are arranged and how
                tightly the cards pack. Per device, because it depends on
                the screen in front of this barista, not on the event. */}
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-xl font-bold mb-4">Order board</h2>
              <div className="space-y-4">
                <div>
                  <div className="font-medium mb-1">Column order</div>
                  <select
                    className="border rounded px-2 py-1.5 w-full max-w-sm"
                    value={settings.boardColumnOrder || 'progression'}
                    onChange={(e) => setSettings(prev => ({ ...prev, boardColumnOrder: e.target.value }))}
                  >
                    <option value="progression">Upcoming &rarr; Current &rarr; Ready (follows the work)</option>
                    <option value="progression-rtl">Ready &larr; Current &larr; Upcoming (right to left)</option>
                    <option value="current-first">Current &rarr; Upcoming &rarr; Ready (original)</option>
                  </select>
                  <p className="text-sm text-gray-500 mt-1">
                    In the order a coffee actually moves, so your eye follows one
                    order across the screen. Pick the direction that matches your
                    bench &mdash; if the queue is on your right and you hand out on
                    your left, use right to left.
                  </p>
                </div>
                <label className="flex items-start space-x-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!settings.skipPickedUp}
                    onChange={(e) => setSettings(prev => ({ ...prev, skipPickedUp: e.target.checked }))}
                  />
                  <span>
                    <span className="font-medium">Completing an order finishes it</span>
                    <span className="block text-sm text-gray-500">
                      Hides the Ready for Pickup column so nobody has to tap
                      Collected. The order still shows as ready on the customer
                      display. Use this when someone is calling names out rather
                      than tracking collection.
                    </span>
                  </span>
                </label>
                {!settings.skipPickedUp && (
                  <div>
                    <div className="font-medium mb-1">Ready cards disappear after</div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        min="5"
                        max="240"
                        className="border rounded px-2 py-1.5 w-24"
                        value={settings.readyExpiryMinutes ?? 30}
                        onChange={(e) => {
                          // Empty field must not become NaN while they type.
                          const v = parseInt(e.target.value, 10);
                          setSettings(prev => ({
                            ...prev,
                            readyExpiryMinutes: Number.isNaN(v) ? '' : v,
                          }));
                        }}
                        onBlur={(e) => {
                          const v = parseInt(e.target.value, 10);
                          setSettings(prev => ({
                            ...prev,
                            readyExpiryMinutes: Number.isNaN(v) ? 30 : Math.min(240, Math.max(5, v)),
                          }));
                        }}
                      />
                      <span className="text-gray-600">minutes</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      Orders with no phone number stay twice as long &mdash; nobody
                      texted them, so the card is the only reminder to call the name.
                    </p>
                  </div>
                )}
                <label className="flex items-start space-x-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!settings.compactOrders}
                    onChange={(e) => setSettings(prev => ({ ...prev, compactOrders: e.target.checked }))}
                  />
                  <span>
                    <span className="font-medium">Compact cards</span>
                    <span className="block text-sm text-gray-500">
                      Fits about a third more orders on screen. Turn this on when
                      you are making 8&ndash;10 at once or working on a smaller
                      screen. Order numbers, names and buttons stay full size.
                    </span>
                  </span>
                </label>
              </div>
            </div>
            {/* Label Printing — per-device auto-print toggle. Deliberately
                OFF by default: the operator opts each station's tablet in
                once the printer is confirmed working. */}
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-xl font-bold mb-4">Label Printing</h2>
              {stationPrinter ? (
                <div className="space-y-3">
                  <div className="text-sm text-gray-600 flex items-center">
                    <Printer size={16} className="mr-2" />
                    {stationPrinter.name || 'Label printer'} —{' '}
                    <span className={stationPrinter.online ? 'text-green-600 font-medium ml-1' : 'text-red-600 font-medium ml-1'}>
                      {stationPrinter.online ? 'online' : 'offline'}
                    </span>
                  </div>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={autoPrintLabels}
                      onChange={(e) => setAutoPrintLabels(e.target.checked)}
                    />
                    <span>Automatically print a cup label when an order is started</span>
                  </label>
                  {/* This station's printer: status, fault in words,
                      and the queue -- so the barista standing next to
                      the printer can finally see what it is doing. */}
                  <StationPrinterPanel
                    stationId={selectedStation}
                    stationPrinter={stationPrinter}
                  />
                  <button
                    className="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-300"
                    onClick={async () => {
                      const r = await printService.testPrint(stationPrinter.id);
                      showToast(r?.success ? 'Test label queued' : `Test failed: ${r?.message || 'unknown'}`,
                        r?.success ? 'success' : 'error');
                    }}
                  >
                    Print test label
                  </button>
                  {/* Sideways banner: free text printed lengthwise down
                      the roll — the stock width (40-80mm) becomes the
                      banner height, up to ~30cm long. Express-table
                      signage straight off the printer (Steve). */}
                  <div className="flex gap-2 pt-2 border-t mt-2">
                    <input
                      id="bannerTextInput"
                      className="flex-1 border rounded px-2 py-1.5 text-sm"
                      placeholder="Banner text, e.g. FLAT WHITE"
                      maxLength={60}
                    />
                    <button
                      className="bg-gray-700 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-800"
                      onClick={async () => {
                        const el = document.getElementById('bannerTextInput');
                        const text = (el?.value || '').trim();
                        if (!text) { showToast('Type the banner text first', 'warning'); return; }
                        try {
                          const resp = await fetch('/api/print/banner', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
                            },
                            body: JSON.stringify({ text, printer_id: stationPrinter.id }),
                          });
                          const b = await resp.json();
                          showToast(b?.success ? `Banner "${text}" queued`
                            : `Banner failed: ${b?.message || 'unknown'}`,
                          b?.success ? 'success' : 'error');
                          if (b?.success && el) el.value = '';
                        } catch (e) {
                          showToast(`Banner failed: ${e?.message || 'network'}`, 'error');
                        }
                      }}
                    >
                      Print banner
                    </button>
                  </div>
                  {/* Pre-stickered cups: a batch of branded stickers for
                      plain house cups, for an event too small to justify
                      a custom cup run. Done the night before, not during
                      service — which is why it asks for a count rather
                      than printing one at a time. */}
                  <div className="pt-2 border-t mt-2">
                    <div className="text-sm text-gray-600 mb-1.5">
                      Pre-stickered cups &mdash; branded stickers for plain cups
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        id="stickerCountInput"
                        type="number"
                        min="1"
                        max="200"
                        defaultValue="50"
                        className="w-24 border rounded px-2 py-1.5 text-sm"
                      />
                      {/* A bare href cannot carry the JWT, so this
                          opened a JSON auth error in a new tab (Steve
                          hit it this morning). Fetch with the token,
                          hand the browser a blob URL -- same pattern
                          the Support printer tab already uses. */}
                      <button
                        type="button"
                        className="text-sm text-blue-700 underline"
                        onClick={async () => {
                          try {
                            const resp = await fetch('/api/print/preview?sticker=1', {
                              headers: {
                                Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
                              },
                            });
                            if (!resp.ok) {
                              showToast('Preview failed - is the label service up?', 'warning');
                              return;
                            }
                            const url = URL.createObjectURL(await resp.blob());
                            window.open(url, '_blank', 'noreferrer');
                          } catch (e) {
                            showToast('Preview failed: ' + e.message, 'warning');
                          }
                        }}
                      >
                        See one first
                      </button>
                      <button
                        className="bg-gray-700 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-800 ml-auto"
                        onClick={async () => {
                          const el = document.getElementById('stickerCountInput');
                          const count = parseInt(el?.value, 10);
                          if (!count || count < 1) {
                            showToast('How many stickers?', 'warning');
                            return;
                          }
                          // A batch is paper you cannot get back, so it
                          // asks — unlike every other button on this card,
                          // which costs one label at most.
                          if (!window.confirm(`Print ${count} branded stickers now?`)) return;
                          try {
                            const r = await printService.printStickers(count, stationPrinter.id);
                            if (r?.success) {
                              showToast(r.warning
                                ? `${r.queued} stickers queued. ${r.warning}`
                                : `${r.queued} stickers queued`,
                              r.warning ? 'warning' : 'success');
                            } else {
                              showToast(r?.message || 'Could not queue the stickers', 'error');
                            }
                          } catch (e) {
                            showToast(`Stickers failed: ${e?.message || 'network'}`, 'error');
                          }
                        }}
                      >
                        Print batch
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  No label printer is assigned to this station. Printers are set
                  up in Support → Printers (they appear there automatically the
                  first time they connect).
                </p>
              )}
            </div>
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-xl font-bold mb-4">Auto-Refresh Settings</h2>
              <div className="space-y-4">
                <div>
                  <label className="flex items-center space-x-2">
                    <input 
                      type="checkbox" 
                      checked={autoRefreshEnabled}
                      onChange={toggleAutoRefresh}
                    />
                    <span>Enable automatic refreshing of order data</span>
                  </label>
                </div>
                
                {autoRefreshEnabled && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Refresh interval (seconds)
                    </label>
                    {/* Draft state, not the live value.

                        This field could not be edited at all. onChange did
                        parseInt(e.target.value) and the setter rejected NaN
                        and anything under the minimum - so clearing it gave
                        NaN (rejected), and typing "3" of "30" was itself
                        under the minimum (rejected). Either way the
                        controlled value snapped straight back, on every
                        keystroke.

                        Now the box holds whatever you type, and the value is
                        committed only when it is a sensible number. */}
                    <div className="flex items-center">
                      <input
                        type="number"
                        min="3"
                        max="300"
                        value={refreshDraft}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setRefreshDraft(raw);           // always let it be typed
                          const n = parseInt(raw, 10);
                          if (!isNaN(n) && n >= 3 && n <= 300) updateAutoRefreshInterval(n);
                        }}
                        onBlur={() => {
                          // Leaving the box empty or nonsense returns it to
                          // the value actually in force.
                          const n = parseInt(refreshDraft, 10);
                          if (isNaN(n) || n < 3 || n > 300) setRefreshDraft(String(autoRefreshInterval));
                        }}
                        className="w-20 p-2 border rounded mr-2"
                      />
                      <span className="text-sm text-gray-500">
                        {autoRefreshInterval <= 5 ? '(fast — good during service)' : ''}
                      </span>
                    </div>
                  </div>
                )}
                
                <div className="mt-4">
                  <button 
                    className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 flex items-center"
                    onClick={() => {
                      // Make sure we preserve the current station when refreshing
                      const currentStation = stations.find(s => s.id === selectedStation);
                      console.log(`Refreshing with station: ${currentStation?.name || 'Unknown'} (ID: ${selectedStation})`);
                      
                      // Update localStorage to ensure consistency
                      localStorage.setItem('coffee_cue_selected_station', selectedStation.toString());
                      localStorage.setItem('last_used_station_id', selectedStation.toString());
                      
                      // Refresh the data
                      refreshData();
                    }}
                  >
                    <RefreshCw size={16} className={`mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
                    Refresh Now
                  </button>
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-xl font-bold mb-4">Station Settings</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Station Name
                  </label>
                  <input 
                    type="text" 
                    value={settings.stationName}
                    onChange={(e) => setSettings(prev => ({...prev, stationName: e.target.value}))}
                    className="w-full p-2 border rounded"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Station Location
                  </label>
                  <input 
                    type="text" 
                    value={settings.stationLocation}
                    onChange={(e) => setSettings(prev => ({...prev, stationLocation: e.target.value}))}
                    className="w-full p-2 border rounded"
                    placeholder="e.g., Main Hall, Registration Area, etc."
                  />
                </div>
                
                <button
                  className="mt-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center"
                  onClick={async () => {
                    // Cache locally so the fields survive a reload even if
                    // the network is down. This is a CACHE, not the save --
                    // it used to be treated as one, which is why a location
                    // typed here vanished on another device.
                    try {
                      localStorage.setItem(`coffee_station_name_${selectedStation}`, settings.stationName);
                      localStorage.setItem(`coffee_station_location_${selectedStation}`, settings.stationLocation);
                      localStorage.setItem(`coffee_station_barista_${selectedStation}`, settings.baristaName);
                    } catch (e) { /* private mode: the server save below still counts */ }

                    // The signature is updateStation(stationId, data).
                    // This call passed ONE object with the id inside it, so
                    // the hook received the whole object as `stationId` and
                    // `undefined` as the data -- nothing was ever sent. The
                    // other call site in this same file (station name) had
                    // it right, which is how the two drifted.
                    if (!updateStation) {
                      showToast('Cannot save: station service unavailable.', 'error', 6000);
                      return;
                    }
                    try {
                      const ok = await updateStation(selectedStation, {
                        name: settings.stationName,
                        location: settings.stationLocation,
                        baristaName: settings.baristaName
                      });
                      // And only claim success if it succeeded. The toast
                      // used to fire whatever happened, so a save that
                      // never left the browser still said "saved
                      // successfully" -- which is worse than an error,
                      // because you stop looking.
                      if (ok === false) {
                        showToast('Could not save station settings to the server.', 'error', 6000);
                      } else {
                        showToast('Station settings saved successfully!', 'success');
                      }
                    } catch (error) {
                      console.error('Error saving station settings:', error);
                      showToast('Error saving station settings. Please try again.', 'error', 6000);
                    }
                  }}
                >
                  <Check size={18} className="mr-1" />
                  Save Station Settings
                </button>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Barista Name
                  </label>
                  <input 
                    type="text" 
                    value={settings.baristaName}
                    onChange={(e) => {
                      const newBaristaName = e.target.value;
                      // Update settings state
                      setSettings(prev => ({...prev, baristaName: newBaristaName}));
                      // Save to localStorage for persistence with station-specific key
                      try {
                        const numericStationId = typeof selectedStation === 'string' 
                          ? parseInt(selectedStation, 10) 
                          : selectedStation;
                        localStorage.setItem(`coffee_barista_name_station_${numericStationId}`, newBaristaName);
                      } catch (error) {
                        console.error('Failed to save station-specific barista name to localStorage:', error);
                      }
                    }}
                    className="w-full p-2 border rounded"
                  />
                </div>
                
                <div>
                  <h3 className="font-medium mb-3">Sound Notifications</h3>
                  
                  {/* Master Sound Toggle */}
                  <label className="flex items-center space-x-2 mb-3">
                    <input 
                      type="checkbox" 
                      checked={settings.soundEnabled}
                      onChange={(e) => {
                        const newSoundEnabled = e.target.checked;
                        setSettings(prev => ({...prev, soundEnabled: newSoundEnabled}));
                        
                        // (A 'coffee_sound_enabled' key was also written
                        // here "for the sound system" -- but the sound
                        // service reads soundEnabled from the
                        // coffee_cue_settings blob persisted below, and
                        // nothing anywhere read the extra key. Sweep 2:
                        // one fact, one store.)
                        window.dispatchEvent(new CustomEvent('app:toggleSound', { 
                          detail: { enabled: newSoundEnabled } 
                        }));
                        
                        // Play test sound if enabled
                        if (newSoundEnabled && window.coffeeSounds) {
                          window.coffeeSounds.play('newOrder', { volume: settings.soundVolume / 100 });
                        } else if (newSoundEnabled) {
                          // Direct event dispatch fallback if coffeeSounds not available
                          setTimeout(() => {
                            window.dispatchEvent(new CustomEvent('app:newOrder'));
                          }, 300);
                        }
                      }}
                    />
                    <span className="font-medium">Enable All Sounds</span>
                  </label>
                  
                  {settings.soundEnabled && (
                    <div className="ml-6 space-y-2">
                      {/* Volume Control */}
                      <div className="flex items-center space-x-3">
                        <label className="text-sm w-20">Volume:</label>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={settings.soundVolume}
                          onChange={(e) => setSettings(prev => ({...prev, soundVolume: parseInt(e.target.value)}))}
                          className="flex-1"
                        />
                        <span className="text-sm w-10">{settings.soundVolume}%</span>
                      </div>
                      
                      {/* Per-event sound chooser. Each row: enable
                          toggle, sound dropdown, preview button. The
                          sounds come from SoundNotificationService's
                          synthesized library — they're genuinely
                          different (different pitches, envelopes,
                          waveforms) rather than the old near-identical
                          base64 WAV stubs. */}
                      <SoundChoiceRows settings={settings} setSettings={setSettings} />
                      {/* "Test All Sounds" removed — it played a legacy
                          base64 stub (window.coffeeSounds is gone) and the
                          per-row Test buttons cover the need. */}
                    </div>
                  )}
                </div>
                
                {/* REMOVED: a second "Auto-print labels" checkbox.

                    It wrote settings.autoPrintLabels, which nothing reads.
                    The switch that actually prints is `autoPrintLabels`
                    (see startOrderWithLabel), shown up in the Label
                    Printing block beside the printer's online status -
                    which is where it belongs, since it is meaningless
                    without a printer.

                    Two controls for one idea, and they disagreed on
                    screen: Steve had the real one ON and this one OFF at
                    the same time, with no way to tell which governed. */}
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-xl font-bold mb-4">System Information</h2>
              <div className="text-sm text-gray-600 space-y-2">
                <div>Version: 1.2.0</div>
                <div>Station: {
                  (() => {
                    // Try to get custom name from localStorage first
                    if (selectedStation) {
                      try {
                        const customName = localStorage.getItem(`coffee_station_name_${selectedStation}`);
                        if (customName) {
                          return customName;
                        }
                      } catch (e) {
                        console.error('Error getting custom station name for system info:', e);
                      }
                    }
                    // Fall back to station from list
                    return stations.find(s => s.id === selectedStation)?.name || 'Unknown';
                  })()
                }</div>
                <div>Last Sync: {new Date().toLocaleString()}</div>
                <div>API Status: {online ? 'Connected' : 'Offline'}</div>
                <div>App Mode: {isDemoMode ? 'Demo' : 'Production'}</div>
              </div>

              {/* Restore dismissed info panels (folded in from its own
                  near-empty card; gives honest toast feedback now). */}
              <button
                className="mt-3 text-sm text-blue-600 hover:text-blue-800 underline"
                onClick={restoreAllPanels}
              >
                Restore dismissed info panels
              </button>

              <div className="mt-4 flex justify-between">
                {/* Demo mode switches the whole station to FAKE data —
                    a barista hitting it mid-service would lose the live
                    queue. Manager-only. */}
                {isManager && (
                  <button
                    className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
                    onClick={toggleAppMode}
                  >
                    Toggle Demo Mode
                  </button>
                )}
                <button 
                  className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
                  onClick={() => {
                    // Save barista name to localStorage with station-specific key
                    try {
                      const numericStationId = typeof selectedStation === 'string' 
                        ? parseInt(selectedStation, 10) 
                        : selectedStation;
                      localStorage.setItem(`coffee_barista_name_station_${numericStationId}`, settings.baristaName);
                    } catch (error) {
                      console.error('Failed to save station-specific barista name to localStorage:', error);
                    }
                    
                    // Always save station name to localStorage for resilience
                    if (selectedStation && settings.stationName) {
                      try {
                        // Save custom station name in localStorage keyed by station id
                        localStorage.setItem(`coffee_station_name_${selectedStation}`, settings.stationName);
                        console.log(`Saved custom station name to localStorage: ${settings.stationName}`);
                      } catch (e) {
                        console.error('Error saving custom station name to localStorage:', e);
                      }

                      // Also update the station in the stations array in localStorage
                      try {
                        const savedStations = localStorage.getItem('coffee_cue_stations');
                        if (savedStations) {
                          const stations = JSON.parse(savedStations);
                          const updatedStations = stations.map(station => 
                            station.id === selectedStation 
                              ? { ...station, name: settings.stationName, location: settings.stationLocation }
                              : station
                          );
                          localStorage.setItem('coffee_cue_stations', JSON.stringify(updatedStations));
                          console.log('Updated station name in cached stations');
                        }
                      } catch (cacheError) {
                        console.error('Error updating station name in cached stations:', cacheError);
                      }
                      
                      // Update station name and location using the updateStation function from useStations hook
                      updateStation(selectedStation, {
                        name: settings.stationName,
                        location: settings.stationLocation
                      }).then(success => {
                        if (success) {
                          // Refresh station data to ensure changes are reflected immediately
                          refreshStations().then(() => {
                            showToast('Settings updated successfully!', 'success');
                          });
                        } else {
                          showToast('Server update FAILED — change saved on this device only.', 'error', 6000);
                        }
                      }).catch(error => {
                        console.error('Error updating station:', error);
                        // Still consider it a success since we saved to localStorage
                        showToast('Server connection error — change saved on this device only: ' + (error.message || 'Unknown error'), 'error', 6000);
                      });
                    } else {
                      showToast('Settings updated successfully!', 'success');
                    }
                  }}
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Display Tab */}
        {!loading && activeTab === 'display' && (
          <div className="p-4">
            {/* The "Display Screen Integration" demo-data warning that
                used to live here is gone: the customer-facing display
                IS connected to real orders now (rewritten May 2026).
                Steve flagged the stale popup as confusing — leaving it
                only on a non-dismissible info panel below. */}
            <div className="mb-4 rounded-lg p-3 bg-green-50 border-l-4 border-green-500 text-sm text-green-900">
              The display screen shows <strong>live order data</strong>.
              Open it on a tablet or external monitor; portrait /
              landscape now flips automatically based on viewport.
            </div>

            {/* Screen links — every display URL findable in one place,
                copyable, QR-scannable to another device, with short
                paths a human can type into a TV browser (Steve's ask). */}
            <div className="bg-white rounded-lg shadow-md p-4 mb-4">
              <h2 className="text-xl font-bold mb-1">Screen links</h2>
              <p className="text-sm text-gray-600 mb-3">
                Open these on any TV, tablet or phone — <b>no login needed</b>. Short paths are
                easy to type into a TV browser; Copy puts the full link on the clipboard;
                QR lets another device scan it straight off this screen.
              </p>
              {/* One station at a time (defaults to the station being
                  viewed) — an event with 50 stations shouldn't mean 150
                  rows of links (Steve). */}
              {(() => {
                const chosen = linkStation === null ? String(selectedStation ?? '') : linkStation;
                const chosenName = chosen === ''
                  ? 'All stations'
                  : (stations.find(s => String(s.id) === String(chosen))?.name || `Station ${chosen}`);
                return (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <label className="text-sm font-medium text-gray-700">Links for:</label>
                      <select
                        value={chosen}
                        onChange={(e) => setLinkStation(e.target.value)}
                        className="p-2 border rounded text-sm"
                      >
                        {stations.map(s => (
                          <option key={s.id} value={String(s.id)}>
                            {s.name}{String(s.id) === String(selectedStation) ? ' (this station)' : ''}
                          </option>
                        ))}
                        <option value="">All stations</option>
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { key: 'tv', label: '📺 TV board' },
                        { key: 'kiosk', label: '👆 Touch kiosk' },
                        { key: 'pickup', label: '✅ Pickup only' },
                      ].map(v => {
                        const shortPath = `/${v.key}${chosen}`;
                        const url = `${window.location.origin}${shortPath}`;
                        return (
                          <div key={v.key} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1">
                            <span className="text-xs text-gray-500">{v.label}</span>
                            <code className="text-sm font-bold">{shortPath}</code>
                            <button
                              className="text-blue-600 text-xs underline"
                              onClick={() => {
                                try {
                                  navigator.clipboard.writeText(url);
                                  showToast(`Copied ${url}`, 'success');
                                } catch (_) {
                                  showToast(url, 'info', 8000);
                                }
                              }}
                            >
                              Copy
                            </button>
                            <button
                              className="text-blue-600 text-xs underline"
                              onClick={() => setScreenLinkQr({ url, label: `${chosenName} — ${v.label}` })}
                            >
                              QR
                            </button>
                            <button
                              className="text-blue-600 text-xs underline"
                              onClick={() => setScreenLinkPreview({ url, label: `${chosenName} — ${v.label}` })}
                            >
                              Preview
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* In-page link preview — the real screen, scaled, without
                leaving the page. */}
            {screenLinkPreview && (
              <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
                   onClick={() => setScreenLinkPreview(null)}>
                <div className="bg-white rounded-xl p-4 shadow-xl w-full max-w-3xl"
                     onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-bold">{screenLinkPreview.label}</div>
                    <button className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 text-sm"
                            onClick={() => setScreenLinkPreview(null)}>
                      Close
                    </button>
                  </div>
                  <ScaledDisplayPreview url={screenLinkPreview.url} />
                  <div className="mt-2 text-sm text-gray-600 break-all">{screenLinkPreview.url}</div>
                </div>
              </div>
            )}

            {/* QR popup — scan with the target device's camera to open the
                link there. Generated via a public QR image service; these
                links are public-by-design so nothing sensitive leaves. */}
            {screenLinkQr && (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                   onClick={() => setScreenLinkQr(null)}>
                <div className="bg-white rounded-xl p-6 text-center shadow-xl"
                     onClick={(e) => e.stopPropagation()}>
                  <div className="font-bold mb-3">{screenLinkQr.label}</div>
                  <img
                    alt={`QR code for ${screenLinkQr.url}`}
                    width={220}
                    height={220}
                    src={`/api/qr?size=8&data=${encodeURIComponent(screenLinkQr.url)}`}
                  />
                  <div className="mt-3 text-sm text-gray-600 break-all max-w-[260px]">{screenLinkQr.url}</div>
                  <button
                    className="mt-4 px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
                    onClick={() => setScreenLinkQr(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg shadow-md p-4 mb-4">
              <h2 className="text-xl font-bold mb-4">Display Screen Settings</h2>
              <p className="mb-4">Control what appears on the customer-facing display screen.</p>

              {/* ONE open control — this button, station-scoped, new tab.
                  There were three ("Open Display Screen", "Open in New
                  Tab", and a link further down) all doing the same thing. */}
              <div className="flex space-x-4 mb-4">
                <button
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  onClick={openDisplayScreen}
                >
                  Open customer Display (new tab)
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Display Header
                  </label>
                  <input
                    type="text"
                    value={settings.stationName}
                    onChange={(e) => setSettings(prev => ({...prev, stationName: e.target.value}))}
                    className="w-full p-2 border rounded"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Custom Message
                  </label>
                  {/* Was a dead input — no value, no onChange, saved
                      nowhere ("custom text goes no where"). Commits on
                      blur so we don't PUT per keystroke; shows in the
                      Display footer (sponsor line takes precedence). */}
                  <input
                    type="text"
                    placeholder="Enjoy your coffee!"
                    defaultValue={settings.displayCustomMessage || ''}
                    onBlur={(e) => {
                      const v = e.target.value || '';
                      if (v !== (settings.displayCustomMessage || '')) {
                        setSettings(prev => ({ ...prev, displayCustomMessage: v }));
                        // The Display is a DIFFERENT DEVICE reading the
                        // backend -- setSettings alone is this device's
                        // localStorage, so the old toast claimed a footer
                        // update that never left the room (sweep 1
                        // placebo hunt). Claim success only when the
                        // server said yes.
                        SettingsService.updateSettings({ displayCustomMessage: v })
                          .then(() => showToast('Custom message saved — shows in the Display footer', 'success'))
                          .catch(() => showToast('Server update failed — message saved on this device only, the Display will NOT show it', 'error', 6000));
                      }
                    }}
                    className="w-full p-2 border rounded"
                  />
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow-md p-4 mb-4">
              <h2 className="text-xl font-bold mb-4">Display Configuration</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Layout
                  </label>
                  <select
                    value={settings.displayMode}
                    onChange={(e) => setSettings(prev => ({...prev, displayMode: e.target.value}))}
                    className="w-full p-2 border rounded"
                  >
                    <option value="auto">Auto — match screen shape</option>
                    <option value="landscape">Landscape (16:9) — 3 columns side-by-side</option>
                    <option value="portrait">Portrait (9:16) — stacked, Ready on top</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Decides whether the customer Display shows three columns side-by-side
                    (wide screen / horizontal iPad) or a single tall stacked layout (tall
                    screen / vertical iPad). "Auto" picks based on the screen's aspect ratio.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Rotate output
                  </label>
                  <select
                    value={settings.displayRotation ?? 0}
                    onChange={(e) => setSettings(prev => ({...prev, displayRotation: parseInt(e.target.value, 10)}))}
                    className="w-full p-2 border rounded"
                  >
                    <option value={0}>None (recommended)</option>
                    <option value={90}>90° clockwise</option>
                    <option value={180}>180°</option>
                    <option value={270}>270° (90° counter-clockwise)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    For a TV mounted sideways when the OS / display can't rotate the image
                    itself. Prefer OS-level rotation (Mac System Settings → Displays, Windows
                    → Display orientation, iPad Control Center) when possible — it's sharper.
                    Use this as an escape hatch.
                  </p>
                </div>

                {/* Board overflow controls — how the Display handles more
                    orders than fit on screen (Steve's ask). */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      When orders overflow
                    </label>
                    <select
                      value={settings.displayOverflowMode || 'flip'}
                      onChange={(e) => setSettings(prev => ({...prev, displayOverflowMode: e.target.value}))}
                      className="w-full p-2 border rounded"
                    >
                      <option value="flip">Page flip (with countdown)</option>
                      <option value="scroll">Continuous scroll loop</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Seconds per page
                    </label>
                    <select
                      value={settings.displayFlipSeconds ?? 10}
                      onChange={(e) => setSettings(prev => ({...prev, displayFlipSeconds: parseInt(e.target.value, 10)}))}
                      className="w-full p-2 border rounded"
                      disabled={(settings.displayOverflowMode || 'flip') !== 'flip'}
                    >
                      <option value={5}>5 seconds</option>
                      <option value={8}>8 seconds</option>
                      <option value={10}>10 seconds</option>
                      <option value={15}>15 seconds</option>
                      <option value={20}>20 seconds</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Orders per page
                    </label>
                    <select
                      value={settings.displayCardsPerPage ?? 0}
                      onChange={(e) => setSettings(prev => ({...prev, displayCardsPerPage: parseInt(e.target.value, 10)}))}
                      className="w-full p-2 border rounded"
                    >
                      <option value={0}>Auto — fit to screen</option>
                      {[3, 4, 5, 6, 7, 8].map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-gray-500 -mt-2">
                  Choosing more orders per page than naturally fit scales the cards down
                  (3 minimum, 8 maximum). Auto measures the screen and never cuts cards off.
                </p>

                <div className="flex items-start">
                  <input
                    type="checkbox"
                    id="displayTouchOrdering"
                    checked={settings.displayTouchOrdering !== false}
                    onChange={(e) => setSettings(prev => ({...prev, displayTouchOrdering: e.target.checked}))}
                    className="mr-2 mt-1"
                  />
                  <label htmlFor="displayTouchOrdering" className="text-sm font-medium text-gray-700">
                    This display is a touchscreen — customers can tap to order
                    <span className="block text-xs text-gray-500 font-normal">
                      Ticked: the display shows a "👆 Order here" tap-to-order button.
                      Unticked (wall TV nobody can reach): SMS becomes the main call to
                      action — "Order by SMS … we'll text you when it's ready".
                    </span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Display Timeout (minutes)
                  </label>
                  <input 
                    type="number" 
                    min="1" 
                    max="60"
                    value={settings.displayTimeout}
                    onChange={(e) => setSettings(prev => ({...prev, displayTimeout: parseInt(e.target.value)}))}
                    className="w-full p-2 border rounded"
                  />
                  <p className="text-xs text-gray-500 mt-1">How long to show completed orders before removing them</p>
                </div>
                
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="showNameOnDisplay"
                    checked={settings.showNameOnDisplay}
                    onChange={(e) => setSettings(prev => ({...prev, showNameOnDisplay: e.target.checked}))}
                    className="mr-2"
                  />
                  <label htmlFor="showNameOnDisplay" className="text-sm font-medium text-gray-700">
                    Show customer names on display (uncheck for privacy)
                  </label>
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-xl font-bold mb-1">Preview — live 16:9</h2>
              <p className="text-sm text-gray-600 mb-3">
                This is the REAL customer display, scaled down — exactly what the
                external screen shows, live orders, page flips and all. (The old
                preview was a hand-drawn mock that looked nothing like the screen.)
              </p>
              <ScaledDisplayPreview url={`/display?station=${selectedStation}`} />
            </div>
          </div>
        )}
      </div>

      {/* Action Bar. On mobile it sits just above the fixed bottom tab bar
          (bottom-14 = 56px) and its buttons wrap instead of overflowing. */}
      <div className="sticky bottom-14 md:bottom-0 bg-white p-3 shadow-lg flex flex-wrap gap-2 justify-between border-t border-gray-200">
        <div className="flex flex-wrap gap-2">
          <button 
            className="px-4 py-2 bg-gray-200 rounded flex items-center hover:bg-gray-300 transition-colors"
            onClick={() => setShowWalkInDialog(true)}
          >
            <Plus size={18} className="mr-1" /> Add Walk-in Order
          </button>
          {/* Label roll warning. Only shown when it matters -- a gauge
              sitting at "ok" all day is noise, and noise is what makes a
              barista stop reading the top of the screen. */}
          {labelRoll && (labelRoll.level === 'low' || labelRoll.level === 'critical'
                         || labelRoll.level === 'empty') && (
            <div className={`w-full mb-2 px-3 py-2 rounded flex items-center justify-between text-sm ${
              labelRoll.level === 'low'
                ? 'bg-amber-50 border border-amber-300 text-amber-900'
                : 'bg-red-50 border border-red-300 text-red-900'}`}>
              <span className="flex items-center">
                <Printer size={16} className="mr-2" />
                {labelRoll.message}
              </span>
              <button
                className="px-3 py-1 rounded bg-white border border-current text-xs font-semibold hover:bg-gray-50"
                onClick={async () => {
                  try {
                    await printService.updateRoll(stationPrinter.id, { reset: true });
                    showToast('New roll recorded', 'success');
                  } catch (e) {
                    showToast('Could not record the new roll', 'error');
                  } finally { refreshRoll(); }
                }}
                title="I have just fitted a new roll - start counting again"
              >
                Fitted a new roll
              </button>
            </div>
          )}

          {/* Make ahead: hold the texts, then print the batch -- in that
              order, because printing first leaves a window where a fast
              barista completes one and the customer is pulled out of a
              session for a coffee that is sitting on a table.

              Both halves existed already (Hold notifications, Print
              queue) but nothing said they went together, so using them
              meant remembering two buttons AND the order. Steve asked for
              "print without notification (for orders being bulk made
              before a break)" -- this is that, as one tap. */}
          {stationPrinter && pendingOrders.length > 0 && !holdState?.holding && (
            <button
              className="px-4 py-2 bg-amber-100 text-amber-900 rounded flex items-center hover:bg-amber-200 transition-colors disabled:opacity-50"
              disabled={printingQueue || holdBusy}
              onClick={async () => {
                setPrintingQueue(true);
                setHoldBusy(true);
                try {
                  const api = new (await import('../../services/ApiService')).default();
                  await api.put('/notifications/hold', { holding: true });
                  const r = await printService.printQueue(selectedStation);
                  const n = r?.queued || 0;
                  showToast(
                    n > 0
                      ? `Texts held, ${n} label${n === 1 ? '' : 's'} printing. Release when the break starts.`
                      : 'Texts held. Nothing new to print.',
                    n > 0 ? 'success' : 'info');
                } catch (e) {
                  showToast('Could not start make-ahead', 'error');
                } finally {
                  setPrintingQueue(false);
                  setHoldBusy(false);
                  refreshHold();
                }
              }}
              title="Hold the ready texts, then print every waiting label — for making a batch before a break"
            >
              <Printer size={18} className="mr-1" />
              Make ahead ({pendingOrders.length})
            </button>
          )}

          {/* Print the whole queue. Only offered when this station has a
              printer and there is something waiting -- a button that does
              nothing is worse than no button. Steve, watching his own
              video: "they were hitting print and pulling sticker out,
              print and sticker". */}
          {stationPrinter && pendingOrders.length > 0 && (
            <button
              className="px-4 py-2 bg-gray-200 rounded flex items-center hover:bg-gray-300 transition-colors disabled:opacity-60"
              disabled={printingQueue}
              onClick={async () => {
                setPrintingQueue(true);
                try {
                  const r = await printService.printQueue(selectedStation);
                  if (!r?.success) {
                    showToast(r?.message || 'Could not print the queue', 'error');
                  } else if (r.queued > 0) {
                    showToast(
                      `Printing ${r.queued} label${r.queued === 1 ? '' : 's'}` +
                      (r.already_printed ? ` (${r.already_printed} already done)` : '') +
                      (r.truncated ? ' - press again for the rest' : ''),
                      'success');
                  } else if (r.already_printed > 0) {
                    showToast('Every waiting order already has a label', 'info');
                  } else {
                    showToast(r.message || 'Nothing to print', 'info');
                  }
                } catch (e) {
                  showToast('Could not print the queue', 'error');
                } finally { setPrintingQueue(false); }
              }}
              title="Print a label for every waiting order, oldest first"
            >
              <Printer size={18} className="mr-1" />
              {printingQueue ? 'Sending...' : `Print queue (${pendingOrders.length})`}
            </button>
          )}

          {/* Session summary. What the baristas were keeping on paper --
              how many, what kind, which milks -- so it can be read off
              at the end of a session for invoicing, and so a stocking
              decision has numbers behind it. CTN26 carried coconut and
              sold none of it; that is worth knowing before buying more. */}
          {showSessionReport && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
                 onClick={() => setShowSessionReport(false)}>
              <div className="absolute inset-0 bg-black bg-opacity-50"></div>
              <div className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto"
                   onClick={e => e.stopPropagation()}>
                <div className="bg-amber-800 text-white p-4 rounded-t-xl flex justify-between items-center">
                  <h2 className="text-xl font-bold">Session so far</h2>
                  <button className="text-white opacity-80 hover:opacity-100"
                          onClick={() => setShowSessionReport(false)}>
                    <XCircle size={22} />
                  </button>
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-3xl font-bold">{madeToday ?? 0}</div>
                      <div className="text-xs text-gray-500 mt-1">made here</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-3xl font-bold">{sessionStats?.total_orders ?? 0}</div>
                      <div className="text-xs text-gray-500 mt-1">orders, all stations</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-3xl font-bold">
                        {sessionStats?.avg_wait_min != null
                          ? Math.round(sessionStats.avg_wait_min) : '-'}
                        <span className="text-base">m</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">average wait</div>
                    </div>
                  </div>

                  {sessionStats?.milk?.by_milk?.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-1">Milk</h3>
                      <div className="text-sm text-gray-600 mb-2">
                        {sessionStats.milk.dairy} full cream &middot;{' '}
                        {sessionStats.milk.alternative} alternative &middot;{' '}
                        {sessionStats.milk.none} no milk
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {sessionStats.milk.by_milk.map(m => (
                            <tr key={m.milk} className="border-b last:border-0">
                              <td className="py-1 capitalize">{m.milk}</td>
                              <td className="py-1 text-right tabular-nums font-medium">{m.orders}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {sessionStats?.unused_milks?.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-2 text-sm">
                      <span className="font-semibold text-amber-900">Not ordered today: </span>
                      <span className="text-amber-900">{sessionStats.unused_milks.join(', ')}</span>
                      <div className="text-amber-700 text-xs mt-1">
                        Stocked but unused &mdash; worth reviewing before the next event.
                      </div>
                    </div>
                  )}

                  {sessionStats?.top_drinks?.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-1">Drinks</h3>
                      <table className="w-full text-sm">
                        <tbody>
                          {sessionStats.top_drinks.slice(0, 8).map(d => (
                            <tr key={d.drink} className="border-b last:border-0">
                              <td className="py-1 capitalize">{d.drink}</td>
                              <td className="py-1 text-right tabular-nums font-medium">{d.orders}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {sessionStats?.peak_hour?.orders > 0 && (
                    <div className="text-sm text-gray-600">
                      Busiest hour: {String(sessionStats.peak_hour.hour).padStart(2, '0')}:00
                      {' '}&mdash; {sessionStats.peak_hour.orders} orders
                    </div>
                  )}

                  <p className="text-xs text-gray-400">
                    Counts today, from the server. If the screen ever stops
                    updating, the last number you saw here is still what had
                    been made.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Broadcast to everyone watching their phone. Sits with the
              other bulk actions because that is what it is -- but it
              confirms first and names the count, because this reaches
              real customers and cannot be unsent. */}
          <button
            className="px-4 py-2 bg-gray-200 rounded flex items-center hover:bg-gray-300 transition-colors"
            onClick={() => setBroadcastOpen(true)}
            title="Tell customers watching their phone that something has gone wrong"
          >
            <MessageCircle size={18} className="mr-1" /> Tell waiting customers
          </button>

          {/* Notification hold. Deliberately loud when ON and quiet when
              off: a hold left on by accident means customers are never
              told their coffee is ready, which is a far worse failure
              than a text arriving at an awkward moment. The count is on
              the button because pressing "release" without knowing it is
              87 texts is how an event gets a surprise phone bill. */}
          {holdState?.holding ? (
            <div className="flex items-center gap-2">
              <button
                className="px-4 py-2 bg-amber-600 text-white rounded flex items-center hover:bg-amber-700 transition-colors font-semibold disabled:opacity-60"
                disabled={holdBusy}
                onClick={async () => {
                  const n = holdState?.will_send ?? 0;
                  if (n > 0 && !window.confirm(
                    `Send ${n} held "your coffee is ready" ${n === 1 ? 'message' : 'messages'} now?`)) return;
                  setHoldBusy(true);
                  try {
                    const api = new (await import('../../services/ApiService')).default();
                    const r = await api.post('/notifications/release', {});
                    if (r?.success) {
                      showToast(`Sent ${r.sent} notification${r.sent === 1 ? '' : 's'}`, 'success');
                    }
                  } catch (e) {
                    showToast('Could not release notifications', 'error');
                  } finally { setHoldBusy(false); refreshHold(); }
                }}
                title="Send every held notification, and stop holding"
              >
                <Send size={16} className="mr-1" />
                Release {holdState.will_send > 0 ? `${holdState.will_send} ` : ''}
                {holdState.will_send === 1 ? 'message' : 'messages'}
              </button>
              <button
                className="px-3 py-2 bg-gray-200 rounded text-sm hover:bg-gray-300"
                disabled={holdBusy}
                onClick={async () => {
                  setHoldBusy(true);
                  try {
                    const api = new (await import('../../services/ApiService')).default();
                    await api.put('/notifications/hold', { holding: false });
                  }
                  finally { setHoldBusy(false); refreshHold(); }
                }}
                title="Go back to texting customers as each order finishes"
              >
                Stop holding
              </button>
            </div>
          ) : (
            <button
              className="px-4 py-2 bg-gray-200 rounded flex items-center hover:bg-gray-300 transition-colors"
              disabled={holdBusy}
              onClick={async () => {
                setHoldBusy(true);
                try {
                  const api = new (await import('../../services/ApiService')).default();
                  await api.put('/notifications/hold', { holding: true });
                }
                finally { setHoldBusy(false); refreshHold(); }
              }}
              title="Finish orders without texting anyone yet - for pre-orders made during a session"
            >
              <Bell size={18} className="mr-1" /> Hold notifications
            </button>
          )}
          {/* "Adjust Wait Time" moved to the Wait pill in the header. */}
          <button
            className="px-4 py-2 bg-gray-200 rounded flex items-center hover:bg-gray-300 transition-colors"
            onClick={() => {
              // Refresh stations, orders, and schedule data
              refreshStations();
              refreshData();
              refreshScheduleData();
            }}
          >
            <RefreshCw size={18} className={`mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        
        {/* Removed Break Time and Need Help buttons as they're redundant with organiser settings and help at the top */}
      </div>
      
      {/* Messages bubble — opens the unified inbox (customer Questions +
          station Chat). Lifted on mobile so it clears the action footer + the
          fixed bottom tab bar. The badge is the REAL count of pending customer
          questions (was a hardcoded fake "2"). */}
      <button
        className="fixed bottom-40 md:bottom-16 right-4 bg-blue-500 text-white p-3 rounded-full shadow-lg hover:bg-blue-600 z-30"
        title="Messages — customer questions & station chat"
        onClick={() => {
          // When opening, land on Questions if any are pending, else Chat.
          if (!chatOpen) setMessagesTab(cq.count > 0 ? 'questions' : 'chat');
          setChatOpen(!chatOpen);
        }}
      >
        <MessageCircle size={24} />
        {cq.count > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full">
            {cq.count}
          </span>
        )}
      </button>
      
      {/* Dialogs */}
      {showWaitTimeDialog && (
        <WaitTimeDialog 
          currentWaitTime={waitTime}
          onSubmit={handleAdjustWaitTime}
          onClose={() => setShowWaitTimeDialog(false)}
        />
      )}
      
      {showWalkInDialog && (
        <WalkInOrderDialog 
          onSubmit={handleWalkInOrder}
          onClose={() => setShowWalkInDialog(false)}
        />
      )}
      
      {/* Updated MessageDialog to handle messages more reliably */}
      {showMessageDialog && currentMessageOrder && (
        <MessageDialog 
          order={currentMessageOrder}
          onSubmit={async (orderId, message) => {
            try {
              const success = await sendMessage(orderId, message);
              if (success) {
                setShowMessageDialog(false);
                setCurrentMessageOrder(null);
                // Update message status to show success
                setMessageStatus(prev => ({
                  ...prev,
                  [orderId]: { status: 'sent', timestamp: new Date() }
                }));
                return { success: true };
              } else {
                return { success: false, error: 'Failed to send message' };
              }
            } catch (err) {
              console.error('Message send error:', err);
              return { success: false, error: err.message };
            }
          }}
          onClose={() => {
            setShowMessageDialog(false);
            setCurrentMessageOrder(null);
          }}
        />
      )}

      {/* Move-to-station dialog — used when the current station can't
          serve this order (milk out, machine fault) and the operator
          wants to push it to a different station rather than disappoint
          the customer. The dialog handles its own error display; if
          the backend refuses (e.g. capability mismatch), the operator
          can pick a different target without the queue blanking. */}
      {showMoveDialog && orderToMove && (
        <MoveOrderDialog
          order={orderToMove}
          stations={stations}
          currentStationId={selectedStation}
          onConfirm={async (order, targetStationId) => {
            return await reassignOrder(order, targetStationId);
          }}
          onClose={() => {
            setShowMoveDialog(false);
            setOrderToMove(null);
          }}
        />
      )}

      {editingOrder && (
        <EditOrderDialog
          order={editingOrder}
          saving={editSaving}
          onSave={handleSaveOrderEdit}
          onCancelOrder={handleCancelOrderEdit}
          onClose={() => setEditingOrder(null)}
        />
      )}

      {/* Unified Messages inbox — customer Questions + station Chat in one
          docked panel. Replaces the separate Questions header button, the
          chat-only panel, and the removed HELP dialog. */}
      {chatOpen && (
        <div className="fixed bottom-0 right-0 w-full md:w-[440px] max-w-[100vw] h-[28rem] bg-white shadow-lg border rounded-t-lg overflow-hidden z-40 flex flex-col">
          <div className="bg-gray-100 border-b px-2 py-1.5 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMessagesTab('questions')}
                className={`px-3 py-1 rounded text-sm font-medium ${messagesTab === 'questions' ? 'bg-white shadow text-blue-700' : 'text-gray-600 hover:bg-gray-200'}`}
              >
                Questions{cq.count > 0 ? ` (${cq.count})` : ''}
              </button>
              <button
                onClick={() => setMessagesTab('chat')}
                className={`px-3 py-1 rounded text-sm font-medium ${messagesTab === 'chat' ? 'bg-white shadow text-blue-700' : 'text-gray-600 hover:bg-gray-200'}`}
              >
                Station chat
              </button>
            </div>
            <button
              onClick={() => setChatOpen(false)}
              className="p-1 text-gray-500 hover:text-gray-800 rounded"
              title="Close"
            >
              <XCircle size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {messagesTab === 'chat' ? (
              <StationChat
                embedded
                onClose={() => setChatOpen(false)}
                onMessageRead={() => { /* station-chat read state handled internally */ }}
                stations={stations}
                currentStationId={selectedStation}
                currentStationName={stations.find(s => s.id === selectedStation)?.name || 'Unknown Station'}
                baristaName={settings.baristaName}
                onBaristaNameChange={(name) => setSettings(prev => ({ ...prev, baristaName: name }))}
              />
            ) : (
              <CustomerQuestionsList
                items={cq.items}
                replyDrafts={cq.replyDrafts}
                setReplyDrafts={cq.setReplyDrafts}
                sending={cq.sending}
                sendReply={cq.sendReply}
                blocking={cq.blocking}
                blockSender={cq.blockSender}
              />
            )}
          </div>
        </div>
      )}

      {/* Replaces window.prompt. This is the one control that sends words
          to real customers' phones, so it shows who it reaches and what
          they will read before it goes. */}
      <BroadcastDialog
        open={broadcastOpen}
        onClose={() => setBroadcastOpen(false)}
        waitingCount={(pendingOrders || []).length}
        onSend={async (message) => {
          try {
            const api = new (await import('../../services/ApiService')).default();
            const r = await api.post('/broadcast', { message, ttl_minutes: 30 });
            showToast(r?.success
              ? 'Sent to everyone waiting with an unprinted order'
              : `Could not send: ${r?.message || 'unknown'}`,
            r?.success ? 'success' : 'error');
            if (r?.success) setBroadcastOpen(false);
          } catch (e) {
            showToast(`Could not send: ${e?.message || 'network'}`, 'error');
          }
        }}
      />
    </div>
  );
};

// ---- ReadyForPickupColumn ------------------------------------------------
// Third column of the Orders tab. Shows completed-but-not-picked-up
// orders from the last 30 minutes with a one-tap Collected button.
//
// Without this column the barista had to navigate to the Completed
// tab every time a customer walked up to collect — too much friction.
// Older completions still live under the full Completed tab.
//
// Fetches its own list rather than using the shared completedOrders
// from useOrders, for two reasons:
//   1. It needs only the last 30 min — useOrders fetches 50 ever.
//   2. Some old test rows had future-dated completed_at timestamps
//      that defeated a client-side filter. Backend recency filter
//      (recent_minutes=30, station_id=X) is reliable.
const READY_RECENCY_MIN = 30;

// An order whose customer was TEXTED can age off on the normal timer --
// they know it is waiting and will come. An order with no phone number
// never got a message, so the only thing telling anyone it exists is
// this card and the barista calling the name. Those stay twice as long
// (Steve: "maybe its more the ones that are not getting a SMS").
const NO_SMS_EXPIRY_MULTIPLIER = 2;

const ReadyForPickupColumn = ({
  completedOrders, stationId, onMarkPickedUp, onSendMessage,
  expiryMinutes = READY_RECENCY_MIN,
}) => {
  // Switched May 2026: instead of fetching its own list this column
  // now derives from the same `completedOrders` that the Completed
  // tab uses. Steve reported the column showing 0 while the
  // Completed tab showed real orders — proving the data was in the
  // hook, we just had a broken parallel fetch path.
  //
  // We still apply two client-side filters:
  //   1. station_id matches the selected station (so a barista
  //      doesn't see other stations' ready orders)
  //   2. completed within the last READY_RECENCY_MIN minutes (so
  //      ancient picked-up rows don't squat here forever)
  const [hiddenIds, setHiddenIds] = React.useState(() => new Set());

  const list = React.useMemo(() => {
    if (!Array.isArray(completedOrders)) return [];
    const baseMin = Number(expiryMinutes) > 0
      ? Number(expiryMinutes) : READY_RECENCY_MIN;
    const now = Date.now();
    const cutoff = now - baseMin * 60 * 1000;
    const cutoffNoSms = now - baseMin * NO_SMS_EXPIRY_MULTIPLIER * 60 * 1000;
    const sidStr = stationId != null ? String(stationId) : null;

    return completedOrders
      .filter(o => {
        // Optimistic-remove: once Collected is tapped, hide
        // immediately even before the backend confirms.
        const oid = o.id || o.order_number || o.orderNumber;
        if (hiddenIds.has(oid)) return false;
        // Skip already-picked-up
        const status = (o.status || '').toLowerCase();
        if (status === 'picked_up' || status === 'picked-up') return false;
        // Match station — check every alias the data ships under,
        // tolerate string/number type mismatch.
        if (sidStr) {
          const candidates = [
            o.stationId, o.station_id,
            o.assignedStation, o.assigned_to_station,
          ].filter(v => v != null).map(String);
          if (candidates.length > 0 && !candidates.includes(sidStr)) {
            return false;
          }
        }
        // Recency
        const ts = o.completedAt || o.completed_at
                || o.updatedAt   || o.updated_at;
        if (!ts) return true;
        const t = new Date(ts).getTime();
        if (Number.isNaN(t)) return true;
        // No phone means no "your coffee is ready" text was ever sent,
        // so this card is the only trace of it -- give it longer.
        // hasPhone is a boolean from the API; the number itself is
        // deliberately not in this listing.
        const hasPhone = o.hasPhone !== undefined
          ? !!o.hasPhone
          : !!String(o.phoneNumber || o.phone_number || o.phone || '').trim();
        const floor = hasPhone ? cutoff : cutoffNoSms;
        // Tolerate clock skew up to 5 min in either direction.
        return t >= floor && t <= now + 5 * 60 * 1000;
      })
      .sort((a, b) => {
        const ta = new Date(a.completedAt || a.completed_at || a.updatedAt || a.updated_at || 0).getTime();
        const tb = new Date(b.completedAt || b.completed_at || b.updatedAt || b.updated_at || 0).getTime();
        return tb - ta;
      });
  }, [completedOrders, stationId, hiddenIds, expiryMinutes]);

  // Reset the hidden set when the underlying completedOrders changes
  // significantly — prevents stale ids from accumulating.
  React.useEffect(() => {
    if (!Array.isArray(completedOrders)) return;
    setHiddenIds(prev => {
      const live = new Set(completedOrders.map(o => o.id || o.order_number || o.orderNumber));
      const next = new Set([...prev].filter(id => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [completedOrders]);

  const handleCollected = async (oid) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      next.add(oid);
      return next;
    });
    try { await onMarkPickedUp(oid); } catch (e) {
      // If backend failed, unhide so the operator can retry.
      setHiddenIds(prev => {
        const next = new Set(prev);
        next.delete(oid);
        return next;
      });
    }
  };

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[ReadyForPickup] showing ${list.length} of ${completedOrders?.length || 0} completedOrders for station ${stationId}`);
  }

  return (
    <div>
      <div className="bg-green-600 text-white p-2 rounded-t-lg flex justify-between items-center">
        <h2 className="text-xl font-bold">Ready for Pickup</h2>
        <span className="text-sm">
          {list.length}
          {stationId != null && (
            <span className="ml-2 opacity-75 text-xs">@ Station {stationId}</span>
          )}
        </span>
      </div>
      <div className="bg-white p-4 rounded-b-lg shadow-md min-h-[120px]">
        {list.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Coffee size={48} className="mx-auto mb-2 text-gray-400" />
            <p>Nothing ready yet</p>
            <p className="text-sm text-gray-400">Completed orders appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {list.map(order => {
              const oid = order.id || order.order_number || order.orderNumber;
              const orderNum = order.orderNumber || order.order_number || oid;
              const name = order.customerName || order.customer_name || 'Customer';
              const coffee = order.coffeeType || order.coffee_type || 'Coffee';
              const milk = order.milkType || order.milk_type || '';
              const price = order.priceFormatted || order.price_formatted;
              return (
                <div key={oid} className="border rounded-lg p-3 hover:border-green-400">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-lg">#{orderNum}</div>
                      <div className="text-sm text-gray-700 truncate">{name}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {[coffee, milk].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {price && (
                      <span className="inline-block bg-green-100 text-green-800 text-sm font-bold px-2 py-1 rounded whitespace-nowrap">
                        {price}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      className="flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded font-medium"
                      onClick={() => handleCollected(oid)}
                    >
                      ✓ Collected
                    </button>
                    {onSendMessage && (
                      <button
                        type="button"
                        className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm rounded"
                        title="Send reminder SMS"
                        onClick={() => onSendMessage(order)}
                      >
                        SMS
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ---- SoundChoiceRows -----------------------------------------------------
// Renders the per-event sound chooser inside the Settings tab. Five rows,
// one per alert type: each has an enable checkbox, a dropdown for picking
// which sound to play, and a Test button that previews it.
//
// State lives in `settings.soundChoices` ({eventKey: soundPresetKey}) and
// `settings.sound<EventName>` booleans (legacy on/off per event, kept for
// back-compat with any code that reads them). All persisted via the
// existing setSettings flow → coffee_cue_settings localStorage.
const SOUND_EVENT_ROWS = [
  { key: 'newOrder',      label: 'New Order',      enableField: 'soundNewOrder',      btnColor: 'bg-green-500 hover:bg-green-600' },
  { key: 'orderComplete', label: 'Order Complete', enableField: 'soundOrderComplete', btnColor: 'bg-blue-500 hover:bg-blue-600' },
  { key: 'orderPickedUp', label: 'Order Picked Up', enableField: 'soundOrderPickedUp', btnColor: 'bg-purple-500 hover:bg-purple-600' },
  { key: 'lowStock',      label: 'Low Stock Alert', enableField: 'soundLowStock',     btnColor: 'bg-yellow-500 hover:bg-yellow-600' },
  { key: 'error',         label: 'Error Alert',     enableField: 'soundError',        btnColor: 'bg-red-500 hover:bg-red-600' },
];

const SoundChoiceRows = ({ settings, setSettings }) => {
  const choices = { ...DEFAULT_SOUND_CHOICES, ...(settings.soundChoices || {}) };
  const volume = (settings.soundVolume ?? 70) / 100;

  const setChoice = (eventKey, presetKey) => {
    setSettings(prev => ({
      ...prev,
      soundChoices: { ...choices, [eventKey]: presetKey },
    }));
  };

  const preview = (presetKey) => {
    try {
      SoundNotificationService.preview(presetKey, volume);
    } catch (e) {
      // Should never happen; the service handles its own errors.
      console.warn('Sound preview failed:', e);
    }
  };

  return (
    <div className="space-y-2">
      {SOUND_EVENT_ROWS.map(row => (
        <div key={row.key} className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center space-x-2 min-w-[150px]">
            <input
              type="checkbox"
              checked={settings[row.enableField] !== false}
              onChange={(e) => setSettings(prev => ({ ...prev, [row.enableField]: e.target.checked }))}
            />
            <span className="text-sm">{row.label}</span>
          </label>
          <select
            value={choices[row.key] || DEFAULT_SOUND_CHOICES[row.key]}
            onChange={(e) => setChoice(row.key, e.target.value)}
            className="flex-1 min-w-[180px] text-sm px-2 py-1 border border-gray-300 rounded"
          >
            {SOUND_PRESETS.map(p => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
          <button
            type="button"
            className={`px-2 py-1 text-white text-xs rounded ${row.btnColor}`}
            onClick={() => preview(choices[row.key] || DEFAULT_SOUND_CHOICES[row.key])}
          >
            Test
          </button>
        </div>
      ))}
      <div className="text-xs text-gray-500 mt-2">
        Sounds are synthesized in-browser — no assets to download, works offline.
        "No sound" disables that alert without affecting the others.
      </div>
    </div>
  );
};

export default BaristaInterface;