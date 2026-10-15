// components/BaristaInterface.js
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import startConnectionWatchdog from '../../utils/connectionWatchdog';
import StationPrinterPanel from '../barista-tabs/StationPrinterPanel';
import EightySixBoard from '../barista-tabs/EightySixBoard';
import { ToastManager, showToast } from '../shared/Toast';
import SmsHealthBanner from '../shared/SmsHealthBanner';
import AuthService from '../../services/AuthService';
import printService from '../../services/PrintService';
import BroadcastDialog from '../dialogs/BroadcastDialog';
import StationChooser from './StationChooser';
import QueueHeader from './queue/QueueHeader';
import QueueColumn from './queue/QueueColumn';
import StationPicker from './queue/StationPicker';
import AdminSheet from './queue/AdminSheet';
import useLanesLayout from './queue/useLanesLayout';
import { TabBar, SettingGroup, SettingRow, Toggle as CqToggle, Segmented, SelectRow, TextField } from '../../design';
import { ArrowLeft, ArrowRightLeft, Bell, Droplet, FileText, MapPin, Tag, Brain, Calendar, Check, Clock, Coffee, Eye, Grid, Hand, Layers, MessageCircle, Monitor, Package, Printer, RefreshCw, RotateCw, Scale, Send, Settings, Timer, Truck, Users, Wrench, XCircle } from 'lucide-react';

// Import app mode context
import { useAppMode } from '../../context/AppContext';

// Import the custom hooks for order, station, stock, and schedule management
import useOrders from '../../hooks/useOrders';
import useStations from '../../hooks/useStations';
import useStock from '../../hooks/useStock';
import useLiveStock from '../../hooks/useLiveStock';
import useStationChatUnread from '../../hooks/useStationChatUnread';
import AskCustomerControls from './AskCustomerControls';
import useSchedule from '../../hooks/useSchedule';
import {
  getTimeRatioColor,
  calculateMinutesDiff,
  buildGroupInfo,
  applicableStages,
  parseServerDate
} from '../../utils/orderUtils';
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
import KioskOrder from '../display/KioskOrder';
import EditOrderDialog from '../dialogs/EditOrderDialog';
import useCustomerQuestions from '../../hooks/useCustomerQuestions';
import CustomerQuestionsList from './CustomerQuestionsList';
import ToolsTab from '../barista-tabs/ToolsTab';
// Using inline help dialog instead of importing external component
import StationChat from '../support/StationChat';
import OrderNotificationHandler from '../shared/OrderNotificationHandler';
import '../../styles/boardDensity.css';
import GroupBadge from './GroupBadge';
import SourceBadge from './SourceBadge';
import RushMixStrip from './RushMixStrip';
import { byId } from '../../utils/ids';
import QueueIntelligence from '../support/QueueIntelligence';
import StationLoadBalancer from '../support/StationLoadBalancer';
import { askConfirm } from '../shared/ConfirmDialog';
import useNotices from '../shared/useNotices';
import NoticeBanner from '../shared/NoticeBanner';

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
         className="relative w-full overflow-hidden rounded-cq-md border bg-cq-roast"
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
  } = useStations({ autoSelect: false });

  // What the room is being told right now (see NoticeComposer). A barista on
  // cart 4 needs to know cart 2 is down as much as the person waiting does --
  // they are the one who gets asked about it.
  const notices = useNotices('screen', selectedStation);
  // Lanes side by side on a landscape tablet or a laptop; one column on a
  // phone or a portrait tablet (see useLanesLayout).
  const lanes = useLanesLayout();

  // State for showing station selector dropdown
  // Phase 4 (the queue screen): which OTHER stations this tablet watches in
  // the header -- a device preference, capped -- plus the station picker and
  // the PIN-gated admin sheet.
  const [watchedIds, setWatchedIds] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem('coffee_cue_watched_stations') || '[]'); return Array.isArray(v) ? v.map(Number).filter(Boolean) : []; } catch (e) { return []; }
  });
  const toggleWatch = (id) => setWatchedIds(prev => {
    const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id].slice(0, 3);
    try { localStorage.setItem('coffee_cue_watched_stations', JSON.stringify(next)); } catch (e) { /* device pref only */ }
    return next;
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  // One PIN unlocks this tablet for UNLOCK_MINUTES (or until Lock now /
  // sign out): moving between the queue and the settings pages must not
  // ask for it again (Steve). Kept in sessionStorage so a reload keeps it.
  const UNLOCK_MINUTES = 10;
  const [unlockedUntil, setUnlockedUntil] = useState(() => { try { return Number(sessionStorage.getItem('coffee_cue_unlocked_until') || 0); } catch (e) { return 0; } });
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 30000); return () => clearInterval(t); }, []);
  const unlocked = unlockedUntil > nowTick;
  const unlockedMinutes = unlocked ? Math.max(1, Math.ceil((unlockedUntil - nowTick) / 60000)) : 0;
  const unlockNow = () => { const until = Date.now() + UNLOCK_MINUTES * 60000; setUnlockedUntil(until); setNowTick(Date.now()); try { sessionStorage.setItem('coffee_cue_unlocked_until', String(until)); } catch (e) { /* ignore */ } };
  const lockNow = () => { setUnlockedUntil(0); try { sessionStorage.removeItem('coffee_cue_unlocked_until'); } catch (e) { /* ignore */ } };
  // Auto-refresh interval picker (header pill) open/closed
  // Admin-only "Switch view" dropdown in the header (replaces the floating
  // cross-interface switcher on this screen).

  // Per-device screen zoom for the whole barista interface. Two problems from
  // the event floor (Steve): on a SMALL tablet the Start button was a hard tap
  // — baristas want everything bigger; on a big screen they'd rather shrink it
  // to see more orders at once. CSS `zoom` reflows the layout properly (unlike
  // transform: scale, which clips), and Chromium/Safari scale the fixed layer
  // uniformly so centred modals stay centred. This is deliberately device-local
  // (its own localStorage key, NOT the synced settings blob) so each tablet
  // keeps its own size without pushing it to every other screen.
  const ZOOM_MIN = 0.7, ZOOM_MAX = 1.6;
  const [uiZoom, setUiZoom] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem('coffee_barista_zoom'));
      if (v >= ZOOM_MIN && v <= ZOOM_MAX) return v;
    } catch (_) { /* no stored value / private mode — default to 1 */ }
    return 1;
  });
  const setZoom = (v) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v * 100) / 100));
    setUiZoom(clamped);
    try { localStorage.setItem('coffee_barista_zoom', String(clamped)); } catch (_) { /* private mode */ }
  };

  // Use schedule hook to get schedule data
  const {
    setStation: setScheduleStation,
    refreshData: refreshScheduleData
  } = useSchedule();

  // Use the custom hook for order management with station filtering
  const {
    pendingOrders,
    inProgressOrders,
    completedOrders,
    historyOrders,
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
  
  // A tab remembered from before phase 4 (Completed, Inventory, Schedule,
  // Capabilities, Staff...) is no longer on this screen; land on the queue.
  const [activeTab, setActiveTabState] = useState(() => {
    const t = loadActiveTab();
    return ['orders', 'stock', 'tools', 'settings', 'display'].includes(t) ? t : 'orders';
  });

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
  // The tabs a plain barista may not open (managers see them behind the lock).
  const MANAGER_ONLY_TABS = ['display', 'queue', 'balance', 'capabilities', 'staff', 'settings'];
    if (!isManager && MANAGER_ONLY_TABS.includes(activeTab)) {
      setActiveTab('orders');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, activeTab]);
  
  // Remembers which leaf each group was last on, so leaving a group and
  // coming back returns to the screen you were using rather than the
  // first one.
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
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [batchModeActive, setBatchModeActive] = useState(false);
  const [waitTime, setWaitTime] = useState(2); // Default wait time of 2 minutes
  const [selectedOrders, setSelectedOrders] = useState(new Set());
  const [chatOpen, setChatOpen] = useState(false);
  // Which tab the Messages bubble shows: customer 'questions' or station 'chat'.
  const [messagesTab, setMessagesTab] = useState('questions');
  // Live pending customer-questions — count drives the Messages badge (replaces
  // the old hardcoded `unreadMessages = 2` that always showed a fake "2").
  const cq = useCustomerQuestions();
  
  // Effect to ensure settings are synced with selected station
  // Use useRef to track if we've already synced this station to avoid unnecessary updates
  const lastSyncedStation = useRef(null);
  
  useEffect(() => {
    // Skip if nothing has changed or we don't have a valid selection
    if (!selectedStation || !stations.length) return;
    const station = stations.find(s => s.id === selectedStation);
    // Re-sync when the station RECORD changes, not just the station id:
    // the list is polled from the server, so a name or barista saved on
    // another tablet at this station reaches this one within the poll.
    // (Keying on the id alone left a stale in-memory copy on screen.)
    const signature = station
      ? `${station.id}|${station.name || ''}|${station.location || ''}|${station.baristaName || station.barista || ''}`
      : String(selectedStation);
    if (lastSyncedStation.current === signature) return;
    
    console.log(`Syncing settings for station ${selectedStation}`);
    
    if (station) {
      // Remember what we synced so an unchanged poll doesn't re-run this
      lastSyncedStation.current = signature;
      
      // Get station-specific barista name
      const stationBaristaName = getStationBaristaName(selectedStation);
      
      // The station record (server) is the only source of the name.
      const stationName = station.name;
      
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
  // "View Details" on a completed order was a placebo -- it only toasted
  // "Details for order #N are not available", though the order exists.
  // Now it expands the card and pulls the full breakdown from /track.
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

  // LIVE stock: the real inventory_items table (same source as depletion
  // and the low-stock warnings), replacing the localStorage blob the tab
  // used to show. Steve caught the two disagreeing (5 L tab vs 0.19 L
  // warning). See useLiveStock.
  const live = useLiveStock(selectedStation);
  const [liveStockCat, setLiveStockCat] = useState('milk');
  
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
      
      // The barista's name lives on the station record (server), so every
      // device at this station sees the same name.
      const stationObj = stations.find(s => s.id === numericStationId);
      const stationBaristaName = stationObj ? (stationObj.baristaName || stationObj.barista) : '';
      if (stationBaristaName) {
        return stationBaristaName;
      }
      
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
          // Station identity is NOT a device setting: it comes from the
          // station record, never from this blob. (The blob used to win,
          // so a tablet kept a stale name after the organiser renamed it.)
          stationName: stations.find(s => s.id === selectedStation)?.name || 'Coffee Station',
          stationLocation: stations.find(s => s.id === selectedStation)?.location || '',
          baristaName: getStationBaristaName(selectedStation),
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
  // Unread STATION CHAT (from other stations) — makes the Messages bubble
  // react to chat, not only customer questions (Steve's note). Declared
  // AFTER `settings` because it reads settings.baristaName; placing it
  // earlier hit a temporal-dead-zone crash ("Cannot access before
  // initialization") that took the whole barista interface down.
  const chatUnread = useStationChatUnread(
    selectedStation,
    stations.find(s => s.id === selectedStation)?.name,
    settings.baristaName);
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
        // Sounds that play on OTHER devices (display board, phone beacon):
        // chosen here, stored server-side, read by those screens.
        'displayReadySound', 'beaconReadySound',
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
        inProgressOrders.find(byId(orderId)) || 
        completedOrders.find(byId(orderId)) ||
        pendingOrders.find(byId(orderId)) || 
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
  // Payments level 1: the counter took the money; say so on the card.
  const handleMarkPaid = async (order, paid) => {
    if (!order || !order.id) return;
    try {
      const r = await fetch(`/api/orders/${order.id}/${paid ? 'paid' : 'unpaid'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}` },
        body: JSON.stringify({ method: 'cash' }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || b.success === false) throw new Error(b.message || `Could not mark ${paid ? 'paid' : 'unpaid'}`);
      showToast(`#${order.orderNumber || order.id} marked ${paid ? 'paid' : 'unpaid'}`, 'success', 2500);
      if (typeof refreshData === 'function') refreshData();
    } catch (e) {
      showToast(e.message || 'Could not update payment', 'error', 5000);
    }
  };

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
      
      // Find the order for the label/notification details -- but do not
      // refuse the tap if it is not in the local list. That refusal was the
      // Ready button's version of the dead Collected button (#606): a
      // double tap, a second tablet, or a poll landing mid-action, and the
      // barista got "Could not find the order details. Please try again"
      // forever while the server was never asked. The hook resolves the
      // order by number on the server; the details here are a nicety.
      const orderToComplete = inProgressOrders.find(byId(orderId))
                           || pendingOrders.find(byId(orderId))
                           || { id: orderId, orderNumber: orderId };
      
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
      const ok = await askConfirm({
        title: 'Take this station offline?',
        message: 'New SMS and walk-up orders will stop being sent here until you bring '
          + 'it back online. Orders already in progress are not affected.',
        confirmLabel: 'Take offline',
        danger: true,
      });
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
  };

  // Other stations (for the at-a-glance queue pills) — lets a barista point
  // a walk-up at a quieter station. Colour-coded by how busy each one is.

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

  // Function to show display screen with station ID
  const openDisplayScreen = () => {
    // Pass the station ID in the URL to customize the display
    window.open(`/display?station=${selectedStation}`, '_blank');
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
          return 'bg-cq-alert';
        case 'warning':
          return 'bg-cq-warn';
        case 'good':
        default:
          return 'bg-cq-ready';
      }
    };

    // The same three states as a CSS colour. The stock slider below builds a
    // linear-gradient() out of this, and a Tailwind CLASS NAME inside a
    // gradient is not a colour -- the whole declaration was invalid, so the
    // bar has been drawing its track with no fill at all, whatever the level.
    const getStatusCss = (status) => {
      switch(status) {
        case 'danger':  return 'var(--cq-alert, #C8372D)';
        case 'warning': return 'var(--cq-warn, #B07D10)';
        case 'good':
        default:        return 'var(--cq-ready, #1F8A4C)';
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
      <div className="flex flex-col mb-6 pb-4 border-b border-cq-line">
        <div className="flex items-center justify-between mb-2">
          <div className="w-1/4">
            <div className="font-medium">{item.name}</div>
            <div className="text-sm text-cq-ink-3 flex items-center">
              <span className="mr-2">Available: {item.amount} {item.unit}</span>
              <button 
                className="text-cq-caramel-deep text-xs underline"
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
                  className="bg-cq-ready text-white px-2 py-1 rounded text-xs"
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
                className="ml-2 text-cq-caramel-deep text-xs underline"
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
                  className="bg-cq-ready text-white px-2 py-1 rounded text-xs"
                  onClick={handleCapacityChange}
                >
                  Update
                </button>
              </div>
            )}
          </div>
          
          <div className="w-1/4 flex justify-end space-x-2">
            <button 
              className="w-10 h-10 bg-cq-line rounded-md flex items-center justify-center hover:bg-cq-line"
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
              className="w-10 h-10 bg-cq-line rounded-md flex items-center justify-center hover:bg-cq-line"
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
              className="w-full h-5 appearance-none bg-cq-line rounded-full focus:outline-none"
              style={{
                background: `linear-gradient(to right, ${getStatusCss(item.status)} 0%, ${getStatusCss(item.status)} ${percentage}%, var(--cq-line, #E6DCD0) ${percentage}%, var(--cq-line, #E6DCD0) 100%)`
              }}
            />
          </div>
          
          {/* Visual indicators for thresholds */}
          <div className="relative w-full h-6">
            {/* Low threshold indicator */}
            <div 
              className="absolute top-0 w-0.5 h-2 bg-cq-warn" 
              style={{ left: `${(item.lowThreshold / item.capacity) * 100}%` }}
            ></div>
            <div 
              className="absolute top-3 text-xs text-cq-warn" 
              style={{ left: `${(item.lowThreshold / item.capacity) * 100}%`, transform: 'translateX(-50%)' }}
            >
              Low
            </div>
            
            {/* Critical threshold indicator */}
            <div 
              className="absolute top-0 w-0.5 h-2 bg-cq-alert" 
              style={{ left: `${(item.criticalThreshold / item.capacity) * 100}%` }}
            ></div>
            <div 
              className="absolute top-3 text-xs text-cq-alert" 
              style={{ left: `${(item.criticalThreshold / item.capacity) * 100}%`, transform: 'translateX(-50%)' }}
            >
              Critical
            </div>
          </div>
        </div>
      </div>
    );
  };

  
    // Dismissible Info Panel Component
  // Texts and display settings: saved the moment they change, on this
  // device and on the server (the public Display is another device and reads
  // the server copy). Replaces a card that needed its own Save button.
  const saveNotification = (patch) => {
    setSettings(prev => ({ ...prev, ...patch }));
    MessageService.updateSettings({
      autoSendSmsOnComplete: settings.autoSendSmsOnComplete,
      remindAfterDelay: settings.remindAfterDelay,
      reminderDelay: settings.reminderDelay,
      showNameOnDisplay: settings.showNameOnDisplay,
      ...patch,
    });
    SettingsService.updateSettings(patch)
      .then(() => showToast('Saved', 'success', 1500))
      .catch(() => showToast("Saved on this tablet only: the server didn't answer, so the Display may not follow", 'error', 6000));
  };

  // Switch this tablet to another station (from the picker or a watched
  // chip). Same steps the old header dropdown did.
  const switchStation = (id) => {
    const station = stations.find(s => s.id === id);
    if (!station) return;
    changeSelectedStation(id);
    const baristaName = getStationBaristaName(id);
    setSettings(prev => ({ ...prev, stationName: station.name, baristaName }));
    ChatService.initialize(id, station.name, baristaName);
    refreshData();
  };
  // Rush mode: hide the menus, pack the cards, ask for real fullscreen
  // (a refusal never stops the toggle).
  const setRushMode = async (next) => {
    setSettings(prev => ({ ...prev, rushMode: next }));
    try {
      if (next && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else if (!next && document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
    } catch (e) { /* fullscreen is a bonus, not the feature */ }
  };

  // ---- Station-level actions (were the bottom action bar) ----------------
  const printQueueNow = async () => {
    setPrintingQueue(true);
    try {
      const r = await printService.printQueue(selectedStation);
      if (!r?.success) showToast(r?.message || 'Could not print the queue', 'error');
      else if (r.queued > 0) showToast(`Printing ${r.queued} label${r.queued === 1 ? '' : 's'}` + (r.already_printed ? ` (${r.already_printed} already done)` : '') + (r.truncated ? ' - press again for the rest' : ''), 'success');
      else if (r.already_printed > 0) showToast('Every waiting order already has a label', 'info');
      else showToast(r.message || 'Nothing to print', 'info');
    } catch (e) { showToast('Could not print the queue', 'error'); }
    finally { setPrintingQueue(false); }
  };
  // Make ahead: hold the texts, THEN print the batch (printing first leaves
  // a window where a fast barista completes one and the customer is pulled
  // out of a session for a coffee sitting on a table).
  const makeAhead = async () => {
    setPrintingQueue(true); setHoldBusy(true);
    try {
      const api = new (await import('../../services/ApiService')).default();
      await api.put('/notifications/hold', { holding: true });
      const r = await printService.printQueue(selectedStation);
      const n = r?.queued || 0;
      showToast(n > 0 ? `Texts held, ${n} label${n === 1 ? '' : 's'} printing. Release when the break starts.` : 'Texts held. Nothing new to print.', n > 0 ? 'success' : 'info');
    } catch (e) { showToast('Could not start make-ahead', 'error'); }
    finally { setPrintingQueue(false); setHoldBusy(false); refreshHold(); }
  };
  const holdTexts = async () => {
    if (!(await askConfirm({ title: 'Hold all "coffee ready" texts?', message: 'Customers will NOT be told their order is ready until you press Release. Use this only for pre-orders or before a session starts.', confirmLabel: 'Hold texts', danger: true }))) return;
    setHoldBusy(true);
    try { const api = new (await import('../../services/ApiService')).default(); await api.put('/notifications/hold', { holding: true }); }
    finally { setHoldBusy(false); refreshHold(); }
  };
  const releaseTexts = async () => {
    const n = holdState?.will_send ?? 0;
    if (n > 0 && !(await askConfirm({ title: `Send ${n} held "your coffee is ready" ${n === 1 ? 'message' : 'messages'} now?`, message: 'Every customer whose coffee is already ready gets their text at once.', confirmLabel: 'Send now' }))) return;
    setHoldBusy(true);
    try {
      const api = new (await import('../../services/ApiService')).default();
      const r = await api.post('/notifications/release', {});
      if (r?.success) showToast(`Sent ${r.sent} notification${r.sent === 1 ? '' : 's'}`, 'success');
    } catch (e) { showToast('Could not release notifications', 'error'); }
    finally { setHoldBusy(false); refreshHold(); }
  };
  const stopHolding = async () => {
    setHoldBusy(true);
    try { const api = new (await import('../../services/ApiService')).default(); await api.put('/notifications/hold', { holding: false }); }
    finally { setHoldBusy(false); refreshHold(); }
  };
  const refreshAll = () => { refreshStations(); refreshData(); refreshScheduleData(); };
  // Name the CATEGORY so "medium" isn't mistaken for a recipe or a milk.
  const lowStockLabel = (i) => {
    const n = String(i.name || ''); const c = String(i.category || '').toLowerCase();
    if (c === 'cups') return `${n} cups`;
    if (c === 'milk' && !/milk$/i.test(n)) return `${n} milk`;
    if (c === 'coffee' && !/beans?$/i.test(n)) return `${n} beans`;
    return n;
  };
  const rollNeedsAction = labelRoll && ['low', 'critical', 'empty'].includes(labelRoll.level);
  const stationMenu = [
    stationPrinter && pendingOrders.length > 0 && !holdState?.holding ? { label: `Make ahead (${pendingOrders.length})`, Icon: Printer, disabled: printingQueue || holdBusy, onClick: makeAhead, hint: 'Hold the ready texts, then print every waiting label' } : null,
    stationPrinter && pendingOrders.length > 0 ? { label: printingQueue ? 'Sending…' : `Print queue (${pendingOrders.length})`, Icon: Printer, disabled: printingQueue, onClick: printQueueNow } : null,
    stationPrinter && rollNeedsAction ? { label: 'Fitted a new label roll', Icon: Printer, onClick: async () => { try { await printService.updateRoll(stationPrinter.id, { reset: true }); showToast('New roll recorded', 'success'); } catch (e) { showToast('Could not record the new roll', 'error'); } finally { refreshRoll(); } } } : null,
    holdState?.holding
      ? { label: `Release ${holdState.will_send > 0 ? holdState.will_send + ' ' : ''}held ${holdState.will_send === 1 ? 'text' : 'texts'}`, Icon: Send, disabled: holdBusy, onClick: releaseTexts }
      : { label: 'Hold the "ready" texts', Icon: Bell, disabled: holdBusy, onClick: holdTexts, hint: 'Finish orders without texting anyone yet' },
    holdState?.holding ? { label: 'Stop holding (no send)', Icon: Bell, disabled: holdBusy, onClick: stopHolding } : null,
    { label: 'Tell waiting customers', Icon: MessageCircle, onClick: () => setBroadcastOpen(true), hint: 'A message to everyone watching their phone' },
    { label: 'Session so far', Icon: Clock, onClick: () => { setShowSessionReport(true); refreshSession(); } },
    { label: isRefreshing ? 'Refreshing…' : 'Refresh', Icon: RefreshCw, disabled: isRefreshing, onClick: refreshAll },
  ];

  // In lanes the queue fills the screen and nothing on the page scrolls;
  // every other tab scrolls inside the content area as before.
  const lanesActive = lanes && activeTab === 'orders';

  // A tablet must be told which station it is at. Until someone chooses
  // (or if the remembered station no longer exists), ask -- never guess.
  if (!selectedStation) {
    return (
      <StationChooser
        stations={stations}
        loading={stationsLoading}
        onChoose={(id) => changeSelectedStation(id)}
        onRefresh={() => refreshStations && refreshStations()}
      />
    );
  }

  // Main component render
  return (
    <div
      className={`cq flex flex-col ${lanesActive ? 'h-screen overflow-hidden' : 'min-h-screen'}`}
      // At zoom < 1 a bare min-h-screen (100vh) would render shorter than the
      // real viewport once scaled, leaving a grey strip at the bottom; dividing
      // by the zoom keeps it filling the screen. At zoom > 1 the taller content
      // simply overflows and scrolls, which is what we want.
      style={uiZoom !== 1 ? { zoom: uiZoom, minHeight: `${100 / uiZoom}vh`, ...(lanesActive ? { height: `${100 / uiZoom}vh` } : {}) } : undefined}
    >
      {/* Toast Notifications */}
      <ToastManager position={lanesActive ? 'bottom-center' : 'bottom-center-high'} />

      {/* Outbound-SMS-down alert — loud + always visible during service, the
          one signal that survives a total outbound outage (see component). */}
      <SmsHealthBanner />

      {/* Header - Connection Banner */}
      {!online && (
        <div className="bg-cq-alert text-white p-2 text-center">
          Could not connect to backend service. Using sample data instead.
        </div>
      )}
      
      {/* Demo Mode Indicator */}
      {isDemoMode && (
        <div className="bg-cq-caramel text-white p-2 text-center">
          Demo Mode Active - Using simulated data
        </div>
      )}
      
      {/* The queue header (phase 4): this station, the carts this tablet
          watches, ONE status line (red only when something is broken), and
          the lock that opens the admin sheet. */}
      <QueueHeader
        station={currentStationObj}
        stations={stations}
        watchedIds={watchedIds.filter(id => id !== selectedStation)}
        rushMode={!!settings.rushMode}
        net={online}
        stationOnline={stationOnline}
        queueCount={queueCount}
        madeToday={madeToday}
        waitMin={currentStationObj?.estimatedWait ?? waitTime}
        printer={stationPrinter}
        labelRoll={labelRoll}
        onOpenPicker={() => setPickerOpen(true)}
        onOpenAdmin={() => setAdminOpen(true)}
        onTapWait={() => setShowWaitTimeDialog(true)}
        onTapMade={() => { setShowSessionReport(true); refreshSession(); }}
        onToggleOnline={toggleStationOnline}
        onSelectStation={switchStation}
        holding={holdState?.holding ? holdState : null}
        lowStock={lowStockItems.map(lowStockLabel)}
        onTapHold={releaseTexts}
        onTapLowStock={() => setActiveTab('stock')}
        unlocked={unlocked}
      />

      <NoticeBanner notices={notices} className="px-4 pt-3" />

      {/* Three tabs: Queue, Stock, Tools. The manager tabs live behind the
          lock (station settings, screens) or in the organiser. Gone in rush
          mode -- the header keeps the way out. */}
      {(!settings.rushMode || activeTab !== 'orders') && (
        <div className="px-4 pt-3">
          <TabBar
            tabs={[
              { id: 'orders', label: 'Queue', Icon: Coffee, count: pendingOrders.length + inProgressOrders.length },
              { id: 'stock', label: 'Stock', Icon: Package },
              { id: 'tools', label: 'Tools', Icon: Wrench },
              // A manager tab opened from the lock appears as a fourth tab
              // while it is open, so the way back is visible.
              ...(['orders', 'stock', 'tools'].includes(activeTab) ? [] : [{ id: activeTab, label: ({ completed: 'Completed', inventory: 'Inventory', schedule: 'Schedule', capabilities: 'Capabilities', staff: 'Staff', queue: 'Queue rules', balance: 'Balance', settings: 'Station settings', display: 'Screens' })[activeTab] || 'More', Icon: Settings }]),
            ]}
            active={activeTab}
            onChange={setActiveTab}
          />
        </div>
      )}

      {/* Main Content. Extra bottom padding on mobile so the fixed bottom
          tab bar + sticky action footer don't cover the last items. */}
      {/* Bottom padding so the last card can scroll clear of the sticky
          action bar (the page grows past the viewport). */}
      <div className={`p-4 flex-grow overflow-y-auto ${lanesActive ? 'pb-4 flex flex-col min-h-0' : 'pb-28'} ${activeTab === 'orders' ? '' : 'cq-legacy'}`}>
        {/* Every page that is not the queue: the old markup inside the
            palette sweep (design/legacy.css) and one obvious way back. */}
        {!loading && activeTab !== 'orders' && (
          <div className="mb-3">
            <button type="button" onClick={() => setActiveTab('orders')} className="inline-flex items-center gap-2 h-11 px-4 rounded-cq-md bg-cq-roast text-cq-cream font-bold hover:bg-cq-roast-deep">
              <ArrowLeft size={18} /> Back to the queue
            </button>
          </div>
        )}
        {/* Loading state */}
        {loading && (
          <div className="flex justify-center items-center h-full">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cq-caramel"></div>
          </div>
        )}
        
        {/* Error state */}
        {error && (
          <div className="bg-cq-alert-wash border border-cq-alert text-cq-alert px-4 py-3 rounded relative mb-4">
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
          <div className="text-xs text-cq-ink-3 mb-2 flex items-center">
            <Clock size={12} className="mr-1" />
            Last updated: {new Date(lastUpdated).toLocaleTimeString()}
            {isRefreshing && (
              <span className="ml-2 flex items-center text-cq-caramel-deep">
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
          <div className="mb-3 rounded-cq-md border-l-4 border-cq-alert bg-cq-alert-wash px-4 py-3 text-cq-alert">
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

        {/* Orders Tab */}
        {!loading && activeTab === 'orders' && (
          <>
          {/* Batch suggestions are a planning aid, not something you read
              mid-rush. */}
          {/* Lanes on a landscape tablet or laptop, a column elsewhere. The
              rush-mix strip (a planning aid, not for mid-rush) rides inside
              the Up next lane so it costs no screen height. */}
          <QueueColumn
            rushStrip={!settings.rushMode ? (
              <RushMixStrip
                pendingOrders={pendingOrders}
                inProgressOrders={inProgressOrders}
                stationName={currentStationObj?.name || `Station ${selectedStation}`}
                onStartBatch={handleStartRushBatch}
                onBatchComplete={handleBatchComplete}
              />
            ) : null}
            pendingOrders={pendingOrders}
            inProgressOrders={inProgressOrders}
            completedOrders={completedOrders}
            showReady={!settings.skipPickedUp}
            stationId={selectedStation}
            expiryMinutes={settings.readyExpiryMinutes}
            teamMode={teamMode}
            groupInfoByOrderId={groupInfoByOrderId}
            stationPrinter={stationPrinter}
            compact={!!(settings.compactOrders || settings.rushMode)}
            applicableStages={applicableStages}
            orderStages={orderStages}
            toggleStage={toggleStage}
            onStart={startOrderWithLabel}
            onStartGroup={handleStartGroup}
            onComplete={handleCompleteOrder}
            onCollected={markOrderPickedUp}
            onMessage={handleOpenMessageDialog}
            onPrint={handlePrintLabel}
            onMove={handleOpenMoveDialog}
            onEdit={handleEditOrder}
            onDelay={handleDelayOrder}
            onPaid={handleMarkPaid}
            onWalkIn={() => setShowWalkInDialog(true)}
            stationMenu={stationMenu}
            layout={lanes ? 'lanes' : 'column'}
          />
          </>
        )}

        {/* Stock Management Tab */}
        {!loading && activeTab === 'stock' && (
          <div className="p-4">
            {/* Reality's shortcut: one tap 86s an item on every channel,
                whatever the ledger believes. */}
            <EightySixBoard />

            {/* This tab now reads the LIVE inventory table -- the same
                figures the recipes deplete and the low-stock alerts read.
                No more "tab says 5 L, warning says 0.19 L". */}
            <div className="mb-4 rounded-cq-md border-l-4 border-cq-ready bg-cq-ready-wash px-4 py-3 text-sm text-cq-ready">
              <span className="font-semibold">Live station stock.</span> These
              are the real figures orders draw down and the low-stock alert
              watches — edits here take effect immediately, everywhere.
              {(live.criticalCount > 0 || live.lowCount > 0) && (
                <span className="block mt-1 font-medium">
                  {live.criticalCount > 0 && <span className="text-cq-alert mr-2">Critical: {live.criticalCount}</span>}
                  {live.lowCount > 0 && <span className="text-cq-caramel-deep">Low: {live.lowCount}</span>}
                </span>
              )}
            </div>

            {/* Category selector, from whatever the live inventory holds */}
            <div className="flex flex-wrap gap-2 mb-4">
              {(live.categories.length ? live.categories : ['milk']).map(category => (
                <button
                  key={category}
                  className={`px-4 py-2 rounded-full ${liveStockCat === category ? 'bg-cq-ready text-white' : 'bg-cq-line'}`}
                  onClick={() => setLiveStockCat(category)}
                >
                  {category.charAt(0).toUpperCase() + category.slice(1)}
                </button>
              ))}
            </div>

            <h2 className="text-xl font-bold mb-3 flex items-center justify-between">
              <span>{liveStockCat.charAt(0).toUpperCase() + liveStockCat.slice(1)}</span>
              <button onClick={live.reload} className="text-sm text-cq-ink-3 hover:text-cq-ink-2 font-normal">
                Refresh
              </button>
            </h2>

            <div className="space-y-3">
              {live.loading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cq-ready"></div>
                </div>
              ) : (live.byCategory[liveStockCat] || []).length > 0 ? (
                (live.byCategory[liveStockCat] || []).map(item => {
                  const amt = parseFloat(item.amount) || 0;
                  const cap = parseFloat(item.capacity) || 0;
                  const min = parseFloat(item.minimum_threshold) || 0;
                  const lvl = live.level(item);
                  const scope = item.station_id ? 'this station' : 'event pool';
                  return (
                    <div key={item.id}
                      className={`bg-cq-milk rounded-cq-md shadow-sm p-4 flex items-center justify-between gap-3 border-l-4 ${
                        lvl === 'critical' ? 'border-cq-alert'
                        : lvl === 'low' ? 'border-cq-caramel' : 'border-transparent'}`}>
                      <div className="min-w-0">
                        <div className="font-semibold capitalize truncate">{item.name}</div>
                        <div className="text-sm text-cq-ink-3">
                          {amt}{item.unit ? ` ${item.unit}` : ''} left
                          {cap ? ` of ${cap}` : ''} · min {min}
                          <span className="ml-2 text-xs uppercase tracking-wide text-cq-ink-3">{scope}</span>
                          {lvl !== 'ok' && (
                            <span className={`ml-2 text-xs font-bold ${lvl === 'critical' ? 'text-cq-alert' : 'text-cq-caramel-deep'}`}>
                              {lvl === 'critical' ? 'CRITICAL' : 'LOW'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          type="number" min="0" defaultValue={amt} key={`${item.id}-${amt}`}
                          className="w-20 border-2 border-cq-line rounded-cq-md px-2 py-1.5 text-right"
                          onKeyDown={(e) => { if (e.key === 'Enter') live.setAmount(item.id, e.target.value); }}
                          onBlur={(e) => { if ((parseFloat(e.target.value) || 0) !== amt) live.setAmount(item.id, e.target.value); }}
                        />
                        {cap > 0 && (
                          <button
                            onClick={() => live.setAmount(item.id, cap)}
                            className="px-3 py-1.5 rounded-cq-md bg-cq-ready text-white text-sm font-semibold hover:bg-cq-ready"
                            title={`Restock to full (${cap})`}
                          >
                            Full
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-8 text-cq-ink-3 bg-cq-milk rounded-cq-md shadow-sm">
                  <Package size={48} className="mx-auto mb-2 text-cq-ink-3" />
                  <p>No {liveStockCat} items in inventory</p>
                  <p className="text-sm text-cq-ink-3">Add stock in Runner › Menu › Event Stock</p>
                </div>
              )}
            </div>

            {(live.byCategory[liveStockCat] || []).length > 0 && (
              <button
                className="w-full mt-4 py-3 bg-cq-ready text-white rounded-md font-medium hover:bg-cq-ready"
                onClick={async () => {
                  const rows = live.byCategory[liveStockCat] || [];
                  if (await askConfirm({ title: `Restock all ${liveStockCat} to full?`, message: 'Every item in this category is set to its capacity.', confirmLabel: 'Restock all' })) {
                    rows.forEach(it => {
                      const cap = parseFloat(it.capacity) || 0;
                      if (cap > 0) live.setAmount(it.id, cap);
                    });
                  }
                }}
              >
                Restock all {liveStockCat} to full
              </button>
            )}

            <p className="text-xs text-cq-ink-3 mt-3">
              Structural changes (adding items, capacities, minimums) live in
              Runner › Menu › Event Stock. This tab is for adjusting what's on hand.
            </p>
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
        {/* Settings tab, rebuilt on the settings vocabulary (design/Settings.js)
            to match the Station admin sheet: an icon, a name, one line of hint
            and one control per row (Steve, 15 Oct 2026: "lots of white space,
            wordy, could be much cleaner"). Two columns of groups that each
            take their own height, so nothing stretches over empty space. */}
        {!loading && activeTab === 'settings' && (
          <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-x-5 items-start">
            <div>
              <SettingGroup title="This station">
                <SettingRow Icon={Coffee} label="Name" hint="Shown on the queue, labels and board">
                  <TextField width="w-56" value={settings.stationName || ''}
                    onChange={(v) => setSettings(prev => ({ ...prev, stationName: v }))} />
                </SettingRow>
                <SettingRow Icon={MapPin} label="Location" hint="Where attendees collect">
                  <TextField width="w-56" placeholder="e.g. Main Hall" value={settings.stationLocation || ''}
                    onChange={(v) => setSettings(prev => ({ ...prev, stationLocation: v }))} />
                </SettingRow>
                <SettingRow Icon={Users} label="Barista" hint="Who's making the coffee here">
                  <TextField width="w-56" value={settings.baristaName || ''}
                    onChange={(v) => setSettings(prev => ({ ...prev, baristaName: v }))} />
                </SettingRow>
                <div className="py-3 flex justify-end">
                  <button type="button"
                    className="h-10 px-4 rounded-cq-md bg-cq-roast text-cq-cream font-bold inline-flex items-center gap-1.5"
                    onClick={async () => {
                      // The station record on the server is the one place a
                      // station's name, location and barista live, so every
                      // device agrees. Only claim success if it succeeded.
                      if (!updateStation) { showToast('Cannot save: station service unavailable.', 'error', 6000); return; }
                      try {
                        const ok = await updateStation(selectedStation, {
                          name: settings.stationName, location: settings.stationLocation, baristaName: settings.baristaName,
                        });
                        showToast(ok === false ? 'Could not save to the server.' : 'Station saved', ok === false ? 'error' : 'success');
                      } catch (error) {
                        showToast('Could not save the station. Try again.', 'error', 6000);
                      }
                    }}>
                    <Check size={16} /> Save station
                  </button>
                </div>
              </SettingGroup>

              <SettingGroup title="Texts and the display">
                <SettingRow Icon={MessageCircle} label="Text when ready" hint="The customer gets a text as you complete it">
                  <CqToggle on={!!settings.autoSendSmsOnComplete} onChange={(v) => saveNotification({ autoSendSmsOnComplete: v })} />
                </SettingRow>
                <SettingRow Icon={Bell} label="Reminder if not collected"
                  hint={settings.remindAfterDelay ? `After ${settings.reminderDelay || 30} seconds` : 'A second text for forgotten cups'}>
                  {settings.remindAfterDelay ? (
                    <Segmented size="sm" value={settings.reminderDelay || 30}
                      onChange={(v) => saveNotification({ reminderDelay: parseInt(v, 10) })}
                      options={[{ value: 30, label: '30s' }, { value: 60, label: '1m' }, { value: 120, label: '2m' }, { value: 300, label: '5m' }]} />
                  ) : null}
                  <CqToggle on={!!settings.remindAfterDelay} onChange={(v) => saveNotification({ remindAfterDelay: v })} />
                </SettingRow>
                <SettingRow Icon={Eye} label="Names on the display" hint="Off shows order numbers only">
                  <CqToggle on={!!settings.showNameOnDisplay} onChange={(v) => saveNotification({ showNameOnDisplay: v })} />
                </SettingRow>
              </SettingGroup>

              <SettingGroup title="Sound">
                <SettingRow Icon={Bell} label="Sounds on this tablet" hint={settings.soundEnabled ? `Volume ${settings.soundVolume ?? 70}%` : 'Chimes for new and ready orders'}>
                  {settings.soundEnabled ? (
                    <input type="range" min="0" max="100" aria-label="Volume" value={settings.soundVolume ?? 70}
                      onChange={(e) => setSettings(prev => ({ ...prev, soundVolume: parseInt(e.target.value, 10) }))}
                      className="w-28 accent-cq-caramel" />
                  ) : null}
                  <CqToggle on={!!settings.soundEnabled} onChange={(on) => {
                    setSettings(prev => ({ ...prev, soundEnabled: on }));
                    window.dispatchEvent(new CustomEvent('app:toggleSound', { detail: { enabled: on } }));
                    if (on) setTimeout(() => window.dispatchEvent(new CustomEvent('app:newOrder')), 300);
                  }} />
                </SettingRow>
                {settings.soundEnabled ? <SoundChoiceRows settings={settings} setSettings={setSettings} /> : null}
              </SettingGroup>
            </div>

            <div>
              <SettingGroup title="Order board">
                <SettingRow Icon={Layers} label="Column order" hint="Match your bench: queue in, cups out">
                  <SelectRow ariaLabel="Column order" value={settings.boardColumnOrder || 'progression'}
                    onChange={(v) => setSettings(prev => ({ ...prev, boardColumnOrder: v }))}
                    options={[
                      { value: 'progression', label: 'Upcoming → Ready' },
                      { value: 'progression-rtl', label: 'Ready ← Upcoming' },
                      { value: 'current-first', label: 'Current first' },
                    ]} />
                </SettingRow>
                <SettingRow Icon={Check} label="Complete finishes the order" hint="Hides the Ready column; for calling names out">
                  <CqToggle on={!!settings.skipPickedUp} onChange={(v) => setSettings(prev => ({ ...prev, skipPickedUp: v }))} />
                </SettingRow>
                {!settings.skipPickedUp ? (
                  <SettingRow Icon={Timer} label="Ready cards clear after" hint="Twice as long for orders with no phone">
                    <Segmented size="sm" value={settings.readyExpiryMinutes ?? 30}
                      onChange={(v) => setSettings(prev => ({ ...prev, readyExpiryMinutes: parseInt(v, 10) }))}
                      options={[{ value: 10, label: '10m' }, { value: 20, label: '20m' }, { value: 30, label: '30m' }, { value: 60, label: '1h' }]} />
                  </SettingRow>
                ) : null}
                <SettingRow Icon={Grid} label="Compact cards" hint="About a third more orders on screen">
                  <CqToggle on={!!settings.compactOrders} onChange={(v) => setSettings(prev => ({ ...prev, compactOrders: v }))} />
                </SettingRow>
                <SettingRow Icon={Users} label="Team mode" hint="Two baristas tick shots and milk separately">
                  <CqToggle on={!!teamMode} onChange={setTeamMode} />
                </SettingRow>
                <SettingRow Icon={RefreshCw} label="Check for new orders" hint="How often this tablet looks">
                  <Segmented size="sm" value={autoRefreshEnabled ? autoRefreshInterval : 0} onChange={(v) => setRefreshInterval(parseInt(v, 10))}
                    options={[{ value: 0, label: 'Off' }, { value: 5, label: '5s' }, { value: 15, label: '15s' }, { value: 30, label: '30s' }]} />
                  <button type="button" aria-label="Check now" title="Check now" onClick={() => refreshData()}
                    className="h-10 w-10 inline-flex items-center justify-center rounded-cq-md bg-cq-wash text-cq-roast">
                    <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
                  </button>
                </SettingRow>
              </SettingGroup>

              <SettingGroup title="Label printer">
                {stationPrinter ? (
                  <>
                    <SettingRow Icon={Printer} label={stationPrinter.name || 'Label printer'}
                      hint={stationPrinter.online ? 'Online' : 'Offline: check power, paper and the Nighthawk'}>
                      <span className={`text-sm font-bold ${stationPrinter.online ? 'text-cq-ready' : 'text-cq-alert'}`}>{stationPrinter.online ? 'Online' : 'Offline'}</span>
                      <button type="button" className="h-10 px-3 rounded-cq-md bg-cq-wash text-cq-roast font-semibold text-sm"
                        onClick={async () => {
                          const r = await printService.testPrint(stationPrinter.id);
                          showToast(r?.success ? 'Test label queued' : `Test failed: ${r?.message || 'unknown'}`, r?.success ? 'success' : 'error');
                        }}>Test</button>
                    </SettingRow>
                    <SettingRow Icon={Tag} label="Print when started" hint="A cup label the moment you start an order">
                      <CqToggle on={!!autoPrintLabels} onChange={setAutoPrintLabels} />
                    </SettingRow>
                    <MilkShapeRow stationId={selectedStation} />
                    <SettingRow Icon={FileText} label="Banner" hint="Text printed lengthwise, e.g. FLAT WHITE">
                      <input id="bannerTextInput" maxLength={60} placeholder="Banner text" aria-label="Banner text"
                        className="w-36 h-10 rounded-cq-md border-2 border-cq-line bg-cq-milk px-3 text-cq-roast" />
                      <button type="button" className="h-10 px-3 rounded-cq-md bg-cq-wash text-cq-roast font-semibold text-sm"
                        onClick={async () => {
                          const el = document.getElementById('bannerTextInput');
                          const text = (el?.value || '').trim();
                          if (!text) { showToast('Type the banner text first', 'warning'); return; }
                          try {
                            const resp = await fetch('/api/print/banner', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}` },
                              body: JSON.stringify({ text, printer_id: stationPrinter.id }),
                            });
                            const b = await resp.json();
                            showToast(b?.success ? `Banner "${text}" queued` : `Banner failed: ${b?.message || 'unknown'}`, b?.success ? 'success' : 'error');
                            if (b?.success && el) el.value = '';
                          } catch (e) { showToast(`Banner failed: ${e?.message || 'network'}`, 'error'); }
                        }}>Print</button>
                    </SettingRow>
                    <SettingRow Icon={Package} label="Branded stickers" hint="A batch for plain cups, the night before">
                      <input id="stickerCountInput" type="number" min="1" max="200" defaultValue="50" aria-label="How many stickers"
                        className="w-20 h-10 rounded-cq-md border-2 border-cq-line bg-cq-milk px-2 text-cq-roast" />
                      <button type="button" className="h-10 px-2 text-sm font-semibold text-cq-caramel-deep underline underline-offset-4"
                        onClick={async () => {
                          // A bare href can't carry the login, so fetch with
                          // it and hand the browser a blob.
                          try {
                            const resp = await fetch('/api/print/preview?sticker=1', { headers: { Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}` } });
                            if (!resp.ok) { showToast('Preview failed - is the label service up?', 'warning'); return; }
                            window.open(URL.createObjectURL(await resp.blob()), '_blank', 'noreferrer');
                          } catch (e) { showToast('Preview failed: ' + e.message, 'warning'); }
                        }}>See one</button>
                      <button type="button" className="h-10 px-3 rounded-cq-md bg-cq-wash text-cq-roast font-semibold text-sm"
                        onClick={async () => {
                          const count = parseInt(document.getElementById('stickerCountInput')?.value, 10);
                          if (!count || count < 1) { showToast('How many stickers?', 'warning'); return; }
                          // A batch is paper you can't get back, so it asks.
                          if (!(await askConfirm({ title: `Print ${count} branded stickers now?`, message: 'A batch is paper you cannot get back.', confirmLabel: 'Print' }))) return;
                          try {
                            const r = await printService.printStickers(count, stationPrinter.id);
                            if (r?.success) showToast(r.warning ? `${r.queued} stickers queued. ${r.warning}` : `${r.queued} stickers queued`, r.warning ? 'warning' : 'success');
                            else showToast(r?.message || 'Could not queue the stickers', 'error');
                          } catch (e) { showToast(`Stickers failed: ${e?.message || 'network'}`, 'error'); }
                        }}>Print</button>
                    </SettingRow>
                    <details className="py-3">
                      <summary className="cursor-pointer font-bold text-cq-roast">Recent labels</summary>
                      <div className="mt-2">
                        <StationPrinterPanel stationId={selectedStation} stationPrinter={stationPrinter} />
                      </div>
                    </details>
                  </>
                ) : (
                  <SettingRow Icon={Printer} label="No printer for this station" hint="Set one up in Runner > Printers (Pair a printer)" />
                )}
              </SettingGroup>
            </div>
          </div>
        )}

        {/* Display Tab */}
        {!loading && activeTab === 'display' && (
          <div className="p-4 grid grid-cols-1 xl:grid-cols-2 gap-x-5 items-start">
            <div>
            {/* Screen links, one row per screen (rebuilt 15 Oct 2026 on the
                settings vocabulary, like the rest of this page). One station
                at a time: 50 stations shouldn't mean 150 rows. */}
            {(() => {
              const chosen = linkStation === null ? String(selectedStation ?? '') : linkStation;
              const chosenName = chosen === ''
                ? 'All stations'
                : (stations.find(s => String(s.id) === String(chosen))?.name || `Station ${chosen}`);
              const small = 'h-9 px-2.5 rounded-cq-md bg-cq-wash text-cq-roast font-semibold text-sm';
              return (
                <SettingGroup title="Screen links: no login needed">
                  <SettingRow Icon={Coffee} label="Links for" hint="Short paths are easy to type on a TV">
                    <SelectRow ariaLabel="Links for" value={chosen} onChange={(v) => setLinkStation(v)}
                      options={[...stations.map(st => ({ value: String(st.id), label: st.name + (String(st.id) === String(selectedStation) ? ' (this one)' : '') })),
                                { value: '', label: 'All stations' }]} />
                  </SettingRow>
                  {[
                    { key: 'tv', label: 'TV board', Icon: Monitor },
                    { key: 'kiosk', label: 'Touch kiosk', Icon: Hand },
                    { key: 'pickup', label: 'Pickup only', Icon: Check },
                    { key: 'sponsors', label: 'Sponsor wall', Icon: Tag },
                  ].map(v => {
                    // The sponsor wall is event-wide: one screen, no station suffix.
                    const shortPath = v.key === 'sponsors' ? '/sponsors' : `/${v.key}${chosen}`;
                    const url = `${window.location.origin}${shortPath}`;
                    return (
                      <SettingRow key={v.key} Icon={v.Icon} label={v.label} hint={<code className="font-bold text-cq-roast">{shortPath}</code>}>
                        <button type="button" className={small} onClick={() => {
                          try { navigator.clipboard.writeText(url); showToast(`Copied ${url}`, 'success'); } catch (_) { showToast(url, 'info', 8000); }
                        }}>Copy</button>
                        <button type="button" className={small} onClick={() => setScreenLinkQr({ url, label: `${chosenName}: ${v.label}` })}>QR</button>
                        <button type="button" className={small} onClick={() => setScreenLinkPreview({ url, label: `${chosenName}: ${v.label}` })}>Preview</button>
                      </SettingRow>
                    );
                  })}
                </SettingGroup>
              );
            })()}

            {/* In-page link preview — the real screen, scaled, without
                leaving the page. */}
            {screenLinkPreview && (
              <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
                   onClick={() => setScreenLinkPreview(null)}>
                <div className="bg-cq-milk rounded-cq-lg p-4 shadow-cq-raised w-full max-w-3xl"
                     onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-bold">{screenLinkPreview.label}</div>
                    <button className="px-3 py-1 bg-cq-line rounded hover:bg-cq-line text-sm"
                            onClick={() => setScreenLinkPreview(null)}>
                      Close
                    </button>
                  </div>
                  <ScaledDisplayPreview url={screenLinkPreview.url} />
                  <div className="mt-2 text-sm text-cq-ink-2 break-all">{screenLinkPreview.url}</div>
                </div>
              </div>
            )}

            {/* QR popup — scan with the target device's camera to open the
                link there. Generated via a public QR image service; these
                links are public-by-design so nothing sensitive leaves. */}
            {screenLinkQr && (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                   onClick={() => setScreenLinkQr(null)}>
                <div className="bg-cq-milk rounded-cq-lg p-6 text-center shadow-cq-raised"
                     onClick={(e) => e.stopPropagation()}>
                  <div className="font-bold mb-3">{screenLinkQr.label}</div>
                  <img
                    alt={`QR code for ${screenLinkQr.url}`}
                    width={220}
                    height={220}
                    src={`/api/qr?size=8&data=${encodeURIComponent(screenLinkQr.url)}`}
                  />
                  <div className="mt-3 text-sm text-cq-ink-2 break-all max-w-[260px]">{screenLinkQr.url}</div>
                  <button
                    className="mt-4 px-4 py-2 bg-cq-line rounded hover:bg-cq-line"
                    onClick={() => setScreenLinkQr(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            <SettingGroup title="The customer display">
              <SettingRow Icon={Monitor} label="Open the display" hint="This station's board, in a new tab">
                <button type="button" onClick={openDisplayScreen}
                  className="h-10 px-4 rounded-cq-md bg-cq-caramel text-white font-bold">Open</button>
              </SettingRow>
              <SettingRow Icon={FileText} label="Header" hint="The title across the top">
                <TextField width="w-48" value={settings.stationName || ''}
                  onChange={(v) => setSettings(prev => ({ ...prev, stationName: v }))} />
              </SettingRow>
              <SettingRow Icon={MessageCircle} label="Footer message" hint="A sponsor line takes its place">
                {/* Saves on blur, not per keystroke. The Display is another
                    device reading the server: claim success only when the
                    server said yes. */}
                <TextField width="w-48" placeholder="Enjoy your coffee!" defaultValue={settings.displayCustomMessage || ''}
                  onBlur={(e) => {
                    const v = e.target.value || '';
                    if (v === (settings.displayCustomMessage || '')) return;
                    setSettings(prev => ({ ...prev, displayCustomMessage: v }));
                    SettingsService.updateSettings({ displayCustomMessage: v })
                      .then(() => showToast('Footer message saved', 'success'))
                      .catch(() => showToast("Not saved to the server: the Display won't show it", 'error', 6000));
                  }} />
              </SettingRow>
              <SettingRow Icon={Monitor} label="Layout"
                          hint="How the board is arranged on screen">
                <SelectRow
                  ariaLabel="Layout"
                  value={settings.displayMode}
                  onChange={(v) => setSettings(prev => ({ ...prev, displayMode: v }))}
                  options={[
                    { value: 'auto', label: 'Auto — match screen shape' },
                    { value: 'landscape', label: 'Landscape — 3 columns' },
                    { value: 'portrait', label: 'Portrait — stacked' },
                    { value: 'portrait-columns', label: 'Portrait — side by side' },
                  ]}
                />
              </SettingRow>

              <SettingRow Icon={RotateCw} label="Rotate output"
                          hint="Last resort: the device's own rotation is sharper">
                <Segmented
                  size="sm"
                  value={settings.displayRotation ?? 0}
                  onChange={(v) => setSettings(prev => ({ ...prev, displayRotation: parseInt(v, 10) }))}
                  options={[
                    { value: 0, label: 'None' }, { value: 90, label: '90°' },
                    { value: 180, label: '180°' }, { value: 270, label: '270°' },
                  ]}
                />
              </SettingRow>

              <SettingRow Icon={Layers} label="When orders overflow"
                          hint="More orders than fit on the screen">
                <Segmented
                  size="sm"
                  value={settings.displayOverflowMode || 'flip'}
                  onChange={(v) => setSettings(prev => ({ ...prev, displayOverflowMode: v }))}
                  options={[{ value: 'flip', label: 'Page flip' }, { value: 'scroll', label: 'Scroll' }]}
                />
              </SettingRow>

              {(settings.displayOverflowMode || 'flip') === 'flip' ? (
                <SettingRow Icon={Clock} label="Seconds per page"
                            hint="How long each page stays up">
                  <Segmented
                    size="sm"
                    value={settings.displayFlipSeconds ?? 10}
                    onChange={(v) => setSettings(prev => ({ ...prev, displayFlipSeconds: parseInt(v, 10) }))}
                    options={[5, 8, 10, 15, 20]}
                  />
                </SettingRow>
              ) : null}

              <SettingRow Icon={Grid} label="Orders per page"
                          hint="Auto fits the screen; a number shrinks cards to fit">
                <SelectRow
                  ariaLabel="Orders per page"
                  value={settings.displayCardsPerPage ?? 0}
                  onChange={(v) => setSettings(prev => ({ ...prev, displayCardsPerPage: parseInt(v, 10) }))}
                  options={[{ value: 0, label: 'Auto — fit to screen' },
                            ...[3, 4, 5, 6, 7, 8].map(n => ({ value: n, label: String(n) }))]}
                />
              </SettingRow>

              <SettingRow Icon={Hand} label="Customers can tap to order"
                          hint="Off for a wall TV nobody can reach">
                <CqToggle
                  on={settings.displayTouchOrdering !== false}
                  onChange={(v) => setSettings(prev => ({ ...prev, displayTouchOrdering: v }))}
                />
              </SettingRow>

              <SettingRow Icon={Eye} label="Show customer names"
                          hint="Turn off for privacy — numbers only">
                <CqToggle
                  on={!!settings.showNameOnDisplay}
                  onChange={(v) => setSettings(prev => ({ ...prev, showNameOnDisplay: v }))}
                />
              </SettingRow>

              <SettingRow Icon={Timer} label="Keep finished orders up for"
                          hint="Then they leave the board">
                <Segmented
                  size="sm"
                  value={settings.displayTimeout}
                  onChange={(v) => setSettings(prev => ({ ...prev, displayTimeout: parseInt(v, 10) }))}
                  options={[{ value: 2, label: '2 min' }, { value: 5, label: '5 min' },
                            { value: 10, label: '10 min' }, { value: 20, label: '20 min' }]}
                />
              </SettingRow>
            </SettingGroup>



            
            </div>
            <div>
              <SettingGroup title="Live preview: the real display, scaled">
                <div className="py-3">
                  <ScaledDisplayPreview url={`/display?station=${selectedStation}`} />
                </div>
              </SettingGroup>
            </div>
          </div>
        )}
      </div>

      {/* Session so far -- opened from the status line ("n made") or the
          admin sheet. The old action bar that housed it is gone: its
          actions live behind the queue's "..." and on the status line. */}
          {showSessionReport && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
                 onClick={() => setShowSessionReport(false)}>
              <div className="absolute inset-0 bg-black bg-opacity-50"></div>
              <div className="relative bg-cq-milk rounded-cq-lg shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto"
                   onClick={e => e.stopPropagation()}>
                <div className="bg-cq-caramel-deep text-white p-4 rounded-t-xl flex justify-between items-center">
                  <h2 className="text-xl font-bold">Session so far</h2>
                  <button className="text-white opacity-80 hover:opacity-100"
                          onClick={() => setShowSessionReport(false)}>
                    <XCircle size={22} />
                  </button>
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-cq-wash rounded-cq-md p-3">
                      <div className="text-3xl font-bold">{madeToday ?? 0}</div>
                      <div className="text-xs text-cq-ink-3 mt-1">made here</div>
                    </div>
                    <div className="bg-cq-wash rounded-cq-md p-3">
                      <div className="text-3xl font-bold">{sessionStats?.total_orders ?? 0}</div>
                      <div className="text-xs text-cq-ink-3 mt-1">orders, all stations</div>
                    </div>
                    <div className="bg-cq-wash rounded-cq-md p-3">
                      <div className="text-3xl font-bold">
                        {sessionStats?.avg_wait_min != null
                          ? Math.round(sessionStats.avg_wait_min) : '-'}
                        <span className="text-base">m</span>
                      </div>
                      <div className="text-xs text-cq-ink-3 mt-1">average wait</div>
                    </div>
                  </div>

                  {sessionStats?.milk?.by_milk?.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-1">Milk</h3>
                      <div className="text-sm text-cq-ink-2 mb-2">
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
                    <div className="bg-cq-caramel-wash border border-cq-line rounded-cq-sm p-2 text-sm">
                      <span className="font-semibold text-cq-caramel-deep">Not ordered today: </span>
                      <span className="text-cq-caramel-deep">{sessionStats.unused_milks.join(', ')}</span>
                      <div className="text-cq-caramel-deep text-xs mt-1">
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
                    <div className="text-sm text-cq-ink-2">
                      Busiest hour: {String(sessionStats.peak_hour.hour).padStart(2, '0')}:00
                      {' '}&mdash; {sessionStats.peak_hour.orders} orders
                    </div>
                  )}

                  <p className="text-xs text-cq-ink-3">
                    Counts today, from the server. If the screen ever stops
                    updating, the last number you saw here is still what had
                    been made.
                  </p>
                </div>
              </div>
            </div>
          )}

      {/* Messages bubble — opens the unified inbox (customer Questions +
          station Chat). Lifted on mobile so it clears the action footer + the
          fixed bottom tab bar. The badge is the REAL count of pending customer
          questions (was a hardcoded fake "2"). */}
      <button
        className="fixed bottom-20 right-4 bg-cq-roast text-cq-cream p-3 rounded-full shadow-cq-raised hover:bg-cq-roast-deep z-30"
        title="Messages — customer questions & station chat"
        onClick={() => {
          // When opening, land on Questions if any are pending, else Chat.
          if (!chatOpen) {
            const toChat = cq.count === 0 && chatUnread.unread > 0;
            setMessagesTab(cq.count > 0 ? 'questions' : (toChat ? 'chat' : 'chat'));
            if (toChat || cq.count === 0) chatUnread.markRead();
          }
          setChatOpen(!chatOpen);
        }}
      >
        <MessageCircle size={24} />
        {/* Unread badge — bigger, ringed and PULSING so a minimised inbox
            can't hide 10 waiting messages (Steve). Counts customer questions
            + station chat + any customer message sitting on an active order
            (the 💬 replies that never fed the old badge). */}
        {(() => {
          const orderMsgs = [...(pendingOrders || []), ...(inProgressOrders || [])]
            .filter(o => String(o.customerMessage || o.customer_message || '').trim()).length;
          const total = cq.count + chatUnread.unread + orderMsgs;
          return total > 0 ? (
            <span className="absolute -top-2 -right-2 bg-cq-alert text-white text-sm font-extrabold min-w-6 h-6 px-1.5 flex items-center justify-center rounded-full ring-2 ring-white animate-pulse">
              {total}
            </span>
          ) : null;
        })()}
      </button>
      
      {/* Station picker + the PIN-gated admin sheet (phase 4). */}
      <StationPicker
        open={pickerOpen}
        stations={stations}
        selectedStation={selectedStation}
        watchedIds={watchedIds.filter(id => id !== selectedStation)}
        onSelect={(id) => { switchStation(id); setPickerOpen(false); }}
        onToggleWatch={toggleWatch}
        onClose={() => setPickerOpen(false)}
      />
      <AdminSheet
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        unlocked={unlocked}
        unlockedMinutes={unlockedMinutes}
        onUnlock={unlockNow}
        onLock={lockNow}
        state={{
          rushMode: !!settings.rushMode, teamMode, soundEnabled: settings.soundEnabled,
          zoom: uiZoom, zoomMin: ZOOM_MIN, zoomMax: ZOOM_MAX,
          refreshSeconds: autoRefreshEnabled ? autoRefreshInterval : 0,
          stationName: currentStationObj?.name,
        }}
        actions={{
          setRush: setRushMode,
          setTeam: setTeamMode,
          setSound: (on) => setSettings(prev => ({ ...prev, soundEnabled: on })),
          setZoom,
          setRefresh: setRefreshInterval,
          openPicker: () => { setAdminOpen(false); setPickerOpen(true); },
          openStationSettings: () => { setAdminOpen(false); setActiveTab('settings'); },
          openDisplaySettings: () => { setAdminOpen(false); setActiveTab('display'); },
          openTab: (id) => { setAdminOpen(false); setActiveTab(id); },
          openSession: () => { setAdminOpen(false); setShowSessionReport(true); refreshSession(); },
          signOut: () => {
            lockNow();
            try { localStorage.removeItem('coffee_cue_selected_station'); localStorage.removeItem('last_used_station_id'); } catch (e) { /* ignore */ }
            AuthService.logout();
            window.location.href = '/login';
          },
        }}
      />

      {/* Dialogs */}
      {showWaitTimeDialog && (
        <WaitTimeDialog 
          currentWaitTime={waitTime}
          onSubmit={handleAdjustWaitTime}
          onClose={() => setShowWaitTimeDialog(false)}
        />
      )}
      
      {/* Walk-up order: the customer's own form, pointed at this station,
          so the drink questions ("dash of water or milk?"), the sizes and
          "Add another coffee" are exactly what a customer gets. Steve
          found the old barista-only form had none of that. */}
      {showWalkInDialog && (
        <KioskOrder
          stationId={selectedStation}
          channel="walkin"
          headerColor="#B8764A"
          onClose={() => setShowWalkInDialog(false)}
          onOrderPlaced={(orderNumber) => {
            setShowWalkInDialog(false);
            showToast(`Order${orderNumber ? ` #${orderNumber}` : ''} added to the queue`, 'success');
            refreshData();
          }}
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
        <div className="fixed bottom-0 right-0 w-full md:w-[440px] max-w-[100vw] h-[28rem] bg-cq-milk shadow-cq-card border rounded-t-lg overflow-hidden z-40 flex flex-col">
          <div className="bg-cq-wash border-b px-2 py-1.5 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMessagesTab('questions')}
                className={`px-3 py-1 rounded text-sm font-medium ${messagesTab === 'questions' ? 'bg-cq-milk shadow text-cq-caramel-deep' : 'text-cq-ink-2 hover:bg-cq-line'}`}
              >
                Questions{cq.count > 0 ? ` (${cq.count})` : ''}
              </button>
              <button
                onClick={() => { setMessagesTab('chat'); chatUnread.markRead(); }}
                className={`px-3 py-1 rounded text-sm font-medium ${messagesTab === 'chat' ? 'bg-cq-milk shadow text-cq-caramel-deep' : 'text-cq-ink-2 hover:bg-cq-line'}`}
              >
                Station chat{chatUnread.unread > 0 ? ` (${chatUnread.unread})` : ''}
              </button>
            </div>
            <button
              onClick={() => setChatOpen(false)}
              className="p-1 text-cq-ink-3 hover:text-cq-roast rounded"
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
const SOUND_EVENT_ROWS = [
  { key: 'newOrder',      label: 'New Order',      enableField: 'soundNewOrder',      btnColor: 'bg-cq-ready hover:bg-cq-ready' },
  { key: 'orderComplete', label: 'Order Complete', enableField: 'soundOrderComplete', btnColor: 'bg-cq-caramel hover:bg-cq-roast' },
  { key: 'orderPickedUp', label: 'Order Picked Up', enableField: 'soundOrderPickedUp', btnColor: 'bg-cq-caramel hover:bg-cq-roast' },
  { key: 'lowStock',      label: 'Low Stock Alert', enableField: 'soundLowStock',     btnColor: 'bg-cq-warn hover:bg-cq-warn' },
  { key: 'error',         label: 'Error Alert',     enableField: 'soundError',        btnColor: 'bg-cq-alert hover:bg-cq-alert' },
];

// One row per sound: on/off, which sound, and a Test. The two sounds that
// play on OTHER screens are saved to the server so every display and phone
// picks them up.
const SoundChoiceRows = ({ settings, setSettings }) => {
  const choices = { ...DEFAULT_SOUND_CHOICES, ...(settings.soundChoices || {}) };
  const volume = (settings.soundVolume ?? 70) / 100;
  const preview = (presetKey) => {
    try { SoundNotificationService.preview(presetKey, volume); } catch (e) { /* the service handles its own errors */ }
  };
  const options = SOUND_PRESETS.map(p => ({ value: p.key, label: p.label }));
  const testBtn = (key) => (
    <button type="button" onClick={() => preview(key)}
      className="h-10 px-3 rounded-cq-md bg-cq-wash text-cq-roast font-semibold text-sm">Test</button>
  );
  return (
    <>
      {SOUND_EVENT_ROWS.map(row => {
        const key = choices[row.key] || DEFAULT_SOUND_CHOICES[row.key];
        const on = settings[row.enableField] !== false;
        return (
          <SettingRow key={row.key} label={row.label}>
            {on ? <SelectRow ariaLabel={`${row.label} sound`} value={key} options={options}
              onChange={(v) => setSettings(prev => ({ ...prev, soundChoices: { ...choices, [row.key]: v } }))} /> : null}
            {on ? testBtn(key) : null}
            <CqToggle on={on} onChange={(v) => setSettings(prev => ({ ...prev, [row.enableField]: v }))} />
          </SettingRow>
        );
      })}
      {[
        { key: 'displayReadySound', label: 'Display: ready', def: 'chime_up' },
        { key: 'beaconReadySound', label: "Customer's phone: ready", def: 'cupq_signature' },
      ].map(row => (
        <SettingRow key={row.key} label={row.label} hint="Every screen, within 30 seconds">
          <SelectRow ariaLabel={row.label} value={settings[row.key] || row.def} options={options}
            onChange={(v) => setSettings(prev => ({ ...prev, [row.key]: v }))} />
          {testBtn(settings[row.key] || row.def)}
        </SettingRow>
      ))}
    </>
  );
};

// The milk shape on cup labels (moved here from Tools > Milk, 15 Oct 2026:
// it's a label setting). Saved per station on the server, because the label
// is drawn there.
const MilkShapeRow = ({ stationId }) => {
  const [on, setOn] = useState(false);
  const [glyphs, setGlyphs] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!stationId) return undefined;
    let live = true;
    printService.getMilkSymbols(stationId)
      .then((r) => { if (live) { setOn(!!r?.enabled); setGlyphs(r?.glyphs || {}); } })
      .catch(() => undefined);
    return () => { live = false; };
  }, [stationId]);
  const legend = Object.entries(glyphs).slice(0, 5).map(([milk, mark]) => `${mark} ${milk}`).join('  ·  ');
  return (
    <SettingRow Icon={Droplet} label="Milk shape on labels"
      hint={on && legend ? legend : 'A mark before the milk, so a row of cups reads at a glance'}>
      <CqToggle on={on} disabled={busy || !stationId} onChange={async (next) => {
        setOn(next); setBusy(true);
        try { await printService.setMilkSymbols(stationId, next); } catch (e) { setOn(!next); }
        finally { setBusy(false); }
      }} />
    </SettingRow>
  );
};

export default BaristaInterface;