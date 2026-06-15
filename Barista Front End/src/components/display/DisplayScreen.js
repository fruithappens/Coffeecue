// DisplayScreen.js
//
// Customer-facing order status display. Sits on the counter (or an
// extended screen via USB-C dock / AirPlay) and shows three columns:
// pending → in progress → ready. Designed to be readable from across
// a busy café room.
//
// Layout modes (driven by ?orientation= URL param OR the
// `displayMode` setting from Barista → Display tab):
//
//   landscape : 3 columns side-by-side; default for a horizontal iPad
//               or counter-mounted TV.
//   portrait  : single tall column stacked; for a vertical iPad on a
//               stand.
//   auto      : pick whichever matches the viewport aspect ratio.
//
// The previous version was a fixed 2-column grid with no real
// portrait support and tiny order numbers — barely visible from more
// than a metre away. This rewrite focuses on:
//   - HUGE order numbers (text-8xl / text-9xl)
//   - Generous breathing room
//   - A "ready" pulse so the customer notices when their order
//     transitions from in-progress
//   - Theme support (light / dark / coffee)
//   - Tap-anywhere to toggle fullscreen on iPad
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Coffee, Check, Clock, ArrowLeft, RefreshCw, MapPin,
         Maximize2, MessageCircle, RotateCw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import OrderDataService from '../../services/OrderDataService';
import StationsService from '../../services/StationsService';
import ApiService from '../../services/ApiService';
import { parseServerDate } from '../../utils/orderUtils';
import { useSettings } from '../../hooks/useSettings';
import KioskOrder from './KioskOrder';

// Visual theme presets. Each provides bg, panel, text, accent.
const THEMES = {
  light:   { bg: 'bg-gray-50',    panel: 'bg-white',         text: 'text-gray-900', subtext: 'text-gray-500', border: 'border-gray-200' },
  dark:    { bg: 'bg-gray-900',   panel: 'bg-gray-800',      text: 'text-gray-50',  subtext: 'text-gray-400', border: 'border-gray-700' },
  coffee:  { bg: 'bg-amber-50',   panel: 'bg-amber-100/40',  text: 'text-amber-950', subtext: 'text-amber-700', border: 'border-amber-200' },
  minimal: { bg: 'bg-white',      panel: 'bg-white',         text: 'text-gray-900', subtext: 'text-gray-400', border: 'border-gray-100' },
};

// Font size scale — controls the giant order number cells.
const FONT_SCALE = {
  small:        { num: 'text-6xl',  body: 'text-lg',  label: 'text-sm' },
  medium:       { num: 'text-7xl',  body: 'text-xl',  label: 'text-base' },
  large:        { num: 'text-8xl',  body: 'text-2xl', label: 'text-lg' },
  'extra-large':{ num: 'text-9xl',  body: 'text-3xl', label: 'text-xl' },
};

// Pick the layout for the current viewport + setting combination.
// "auto" looks at window aspect ratio at render time.
const resolveOrientation = (setting) => {
  const explicit = (setting || '').toLowerCase();
  if (explicit === 'portrait' || explicit === 'landscape') return explicit;
  if (typeof window === 'undefined') return 'landscape';
  return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
};

// Small helper — short customer name + last 4 of phone number.
const formatCustomerLine = (o) => {
  const name = o.customerName || 'Customer';
  const tail = o.displayPhone || (o.phoneNumber ? o.phoneNumber.slice(-4) : '');
  return tail ? `${name} · ··${tail}` : name;
};

// Show the SMS number the way locals actually dial it. The Twilio number is
// stored international ("+61 408 263 333"), but to an Australian audience the
// "+61" reads as confusing — they'd dial 0408 263 333. Convert AU numbers to
// local format (drop +61, restore the leading 0, group as 04XX XXX XXX for
// mobiles / 0X XXXX XXXX for landlines). Anything we don't recognise as AU is
// shown unchanged so this stays safe for other countries.
const formatSmsNumber = (raw) => {
  if (!raw) return '';
  const s = String(raw).trim();
  const digits = s.replace(/[^\d+]/g, '');
  let local = null;
  if (digits.startsWith('+61')) local = '0' + digits.slice(3);
  else if (digits.startsWith('61') && digits.length >= 11) local = '0' + digits.slice(2);
  else if (digits.startsWith('0')) local = digits;
  if (local && local.length === 10) {
    if (local.startsWith('04')) {
      return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7, 10)}`;
    }
    return `${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6, 10)}`;
  }
  return s; // not a recognised AU number — leave as-is
};

// Visual variant of a single order card. Used by both columns.
const OrderCard = ({ order, variant, fonts, theme, showCustomerName, showDetails, isNew }) => {
  const ringClass = variant === 'ready'
    ? 'ring-2 ring-green-400 shadow-green-200/60'
    : 'ring-1 ring-amber-300/70';
  const badgeClass = variant === 'ready'
    ? 'bg-green-500 text-white'
    : 'bg-amber-400 text-amber-950';

  return (
    <div className={`relative rounded-2xl ${theme.panel} ${ringClass} shadow-lg
                     p-6 md:p-8 transition-all duration-500
                     ${isNew && variant === 'ready' ? 'animate-pulse-once' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* GIANT order number */}
          <div className={`${fonts.num} font-extrabold leading-none tracking-tight ${theme.text}`}>
            #{order.order_number}
          </div>
          {showCustomerName && (
            <div className={`${fonts.body} mt-3 ${theme.text} truncate`}>
              {formatCustomerLine(order)}
            </div>
          )}
          {showDetails && (
            <div className={`${fonts.label} mt-1 ${theme.subtext}`}>
              {[order.size, order.milkType, order.coffeeType]
                .filter(Boolean)
                .join(' · ')}
            </div>
          )}
        </div>
        <div className={`px-4 py-2 rounded-full ${fonts.label} font-bold ${badgeClass} whitespace-nowrap`}>
          {variant === 'ready' ? 'Ready' : 'Brewing'}
        </div>
      </div>
    </div>
  );
};

// Allowed rotation values in degrees. Honour both the saved
// `displayRotation` setting and a `?rotate=` URL param so an operator
// can test rotation without committing to the saved value.
const _normalizeRotation = (value) => {
  const n = parseInt(value, 10);
  return [0, 90, 180, 270].includes(n) ? n : 0;
};

const DisplayScreen = () => {
  const [searchParams] = useSearchParams();
  const stationId = searchParams.get('station');
  // ?orientation= overrides the saved setting. Useful for the
  // operator to test both layouts without changing the saved value.
  const orientationFromUrl = searchParams.get('orientation');
  // ?rotate=90 etc. overrides the saved rotation. Same idea.
  const rotateFromUrl = searchParams.get('rotate');
  // ?mode=pickup → a clean "collect your order" screen (no queue clutter, no
  // kiosk button, no SMS footer). Default 'orders' = the live queue + the
  // self-service "Order here" button. Lets an operator run two screens: a
  // public ordering/status one, and a tidy pickup one.
  const screenMode = (searchParams.get('mode') || 'orders').toLowerCase();
  const isPickupMode = screenMode === 'pickup';
  // Self-service kiosk shows on the orders screen unless explicitly turned off
  // with ?kiosk=0. Never on the clean pickup screen.
  const kioskEnabled = !isPickupMode && searchParams.get('kiosk') !== '0';

  const { settings } = useSettings();

  // Visual config derived from settings (with sensible defaults so
  // the screen never looks broken even on a fresh install).
  const themeKey = settings?.displayTheme || 'light';
  const theme = THEMES[themeKey] || THEMES.light;
  const fonts = FONT_SCALE[settings?.displayFontSize || 'large'] || FONT_SCALE.large;
  const zoom = settings?.displayZoom || 100;
  const showCompleted = settings?.showCompletedOrders !== false;
  const showWaitTimes = settings?.showWaitTimes !== false;
  // CSS rotation for hardware screens mounted sideways (a vertical
  // TV on a stand fed by an HDMI source that can't itself rotate,
  // an AirPlay'd iPad on a wall mount, etc). 0/90/180/270 only.
  // When the OS supports rotation that's still the better path —
  // this is for when it doesn't.
  const rotation = _normalizeRotation(
    rotateFromUrl != null ? rotateFromUrl : (settings?.displayRotation ?? 0)
  );

  // Effective orientation — URL > setting > auto-detect.
  const [orientation, setOrientation] = useState(
    () => resolveOrientation(orientationFromUrl || settings?.displayMode || 'auto')
  );
  // Re-resolve on window resize so the "auto" mode picks up
  // landscape ⇄ portrait flips of an iPad.
  useEffect(() => {
    const onResize = () => {
      setOrientation(resolveOrientation(orientationFromUrl || settings?.displayMode || 'auto'));
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, [orientationFromUrl, settings?.displayMode]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stations, setStations] = useState([]);
  const [currentStation, setCurrentStation] = useState(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [smsPhoneNumber, setSmsPhoneNumber] = useState('');
  const [orders, setOrders] = useState({ pending: [], inProgress: [], ready: [] });
  const [showKiosk, setShowKiosk] = useState(false);

  // Track which orders are "new" so we can pulse-highlight ready
  // ones when they appear. Map of order_id → timestamp first seen.
  const newReadyRef = useRef(new Map());
  const prevReadyIdsRef = useRef(new Set());

  // Display config from backend (event name, sponsor, SMS number).
  const [config, setConfig] = useState({
    system_name: 'Coffee Cue',
    event_name: 'Coffee Event',
    sms_number: '',
    sponsor: { enabled: false, name: '', message: '' },
    header_color: '#1e40af',
    custom_message: '',
    logo: '',
    background_landscape: '',
    background_portrait: '',
    // Content toggles — authoritative source for the PUBLIC display (which
    // can't read the auth-gated /api/settings). Default true.
    show_customer_name: true,
    show_order_details: true,
  });

  // Derived from config (declared above — must come AFTER it or it's a TDZ
  // ReferenceError). The public display can't read the auth-gated
  // /api/settings, so these toggles come from /display/config, not useSettings.
  const showCustomerName = config.show_customer_name !== false;
  const showDetails = config.show_order_details !== false;

  // --- Fetch display config from backend ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Public customer-facing screen: fetch the config with a PLAIN
        // fetch, not ApiService.get. ApiService routes through a
        // mock/offline fallback when there's no auth token — and the
        // display has none — so it was serving default "Coffee Event"
        // config (no event name, no logo, no SMS number) instead of the
        // real event. The endpoint is public + authoritative. Tolerate
        // both {config:{...}} and flat shapes.
        const _resp = await fetch('/api/display/config');
        const _body = _resp.ok ? await _resp.json() : null;
        const c = _body && (_body.config || _body);
        if (!cancelled && c && (c.event_name || c.sms_number || c.logo || c.system_name)) {
          setSmsPhoneNumber(c.sms_number || '');
          setConfig(prev => ({
            ...prev,
            system_name: c.system_name || 'Coffee Cue',
            event_name: c.event_name || settings?.displaySettings?.eventName || 'Coffee Event',
            sms_number: c.sms_number || '',
            sponsor: c.sponsor || prev.sponsor,
            logo: c.logo || prev.logo,
            header_color: c.header_color || prev.header_color,
            background_landscape: c.background_landscape || prev.background_landscape,
            background_portrait: c.background_portrait || prev.background_portrait,
            // Honour the operator's display toggles (server-authoritative).
            show_customer_name: c.show_customer_name !== false,
            show_order_details: c.show_order_details !== false,
          }));
        }
      } catch (e) { /* defaults OK if backend silent */ }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge in any display settings (event name, custom message, etc.)
  // from the settings hook.
  useEffect(() => {
    if (settings?.displaySettings) {
      setConfig(prev => ({
        ...prev,
        event_name: settings.displaySettings.eventName || prev.event_name,
        sms_number: smsPhoneNumber || settings.displaySettings.smsNumber || prev.sms_number,
        sponsor: {
          enabled: settings.displaySettings.showSponsor,
          name: settings.displaySettings.sponsorName,
          message: settings.displaySettings.sponsorMessage,
        },
        header_color: settings.displaySettings.headerColor || prev.header_color,
        custom_message: settings.displaySettings.customMessage || prev.custom_message,
      }));
    }
  }, [settings, smsPhoneNumber]);

  // --- Load stations ---
  useEffect(() => {
    (async () => {
      try {
        const list = await StationsService.getStations();
        if (list && list.length > 0) {
          setStations(list);
          if (stationId === 'all') {
            setCurrentStation({ id: 'all', name: 'All Stations', status: 'active' });
          } else if (stationId) {
            const nid = typeof stationId === 'string' ? parseInt(stationId, 10) : stationId;
            const match = list.find(s => s.id === nid || s.id === stationId);
            setCurrentStation(match || list[0]);
          } else {
            setCurrentStation(list[0]);
          }
          setConnected(true);
        } else {
          throw new Error('No stations found');
        }
      } catch (e) {
        setError('Failed to load stations: ' + (e.message || 'Unknown'));
        setConnected(false);
      }
    })();
  }, [stationId]);

  // --- Load orders for the current station + auto-refresh ---
  const formatList = (list, status) => list.map(o => ({
    id: o.id,
    order_number: o.orderNumber || o.id,
    customerName: o.customerName || o.customer_name || 'Customer',
    displayPhone: o.phoneNumber ? o.phoneNumber.slice(-4)
      : (o.phone_number ? o.phone_number.slice(-4) : ''),
    coffeeType: o.coffeeType || o.coffee_type || 'Coffee',
    milkType: o.milkType || o.milk_type || '',
    size: o.size || '',
    status,
    stationId: o.stationId || o.station_id,
    rawStatus: o.status,                  // for client-side dedupe / filter
    completedAt: o.completed_at || o.completedAt || o.updated_at || o.updatedAt,
  }));

  // Only show orders that are actually "ready for pickup" and were
  // completed recently. Without this filter, every old completed
  // order ever sits on the customer Display forever (Steve saw 30
  // ancient test orders dominating his screen — none from the
  // current event). 30 minutes is a sensible default; bumps to a
  // longer window if the operator slows down.
  //
  // Sorted newest-first so the most recent "your order is ready"
  // is at the top of the column. With a fixed slice of 4-6
  // entries below, this means old no-show orders naturally
  // age off the bottom as new ones come in.
  const READY_RECENCY_MINUTES = 30;
  const filterReadyForDisplay = (list) => {
    const cutoff = Date.now() - READY_RECENCY_MINUTES * 60 * 1000;
    const filtered = list.filter(o => {
      // Drop already-picked-up — those aren't "ready for pickup".
      if (o.rawStatus && (o.rawStatus === 'picked_up' || o.rawStatus === 'picked-up')) {
        return false;
      }
      // Only keep orders completed recently. If the timestamp can't
      // be parsed we keep the order (defensive — better to show
      // something than nothing for a freshly-completed drink).
      if (!o.completedAt) return true;
      const t = parseServerDate(o.completedAt).getTime();
      if (Number.isNaN(t)) return true;
      return t >= cutoff;
    });
    // Newest first. Items without a parseable timestamp sort last.
    return filtered.sort((a, b) => {
      const ta = a.completedAt ? parseServerDate(a.completedAt).getTime() : 0;
      const tb = b.completedAt ? parseServerDate(b.completedAt).getTime() : 0;
      return tb - ta;
    });
  };

  useEffect(() => {
    if (!currentStation) return;
    let timer;
    const load = async () => {
      try {
        const isAll = currentStation.id === 'all';
        const nid = isAll ? null : (typeof currentStation.id === 'string'
          ? parseInt(currentStation.id, 10) : currentStation.id);
        const filterStation = (arr) => isAll ? arr : arr.filter(o => {
          const s = o.stationId || o.station_id;
          return s === nid || (s != null && s.toString() === nid?.toString());
        });
        // Three columns — pending shown so waiting customers can see
        // their order acknowledged before a barista picks it up.
        const [pendingAll, inProgressAll, completedAll] = await Promise.all([
          (OrderDataService.getPendingOrders ? OrderDataService.getPendingOrders() : Promise.resolve([])),
          OrderDataService.getInProgressOrders(),
          OrderDataService.getCompletedOrders(),
        ]);
        const next = {
          pending:    formatList(filterStation(pendingAll || []),    'pending'),
          inProgress: formatList(filterStation(inProgressAll || []), 'in-progress'),
          // Ready column is double-filtered: must belong to the
          // selected station AND be a recent completion (not an
          // ancient picked-up order from a previous event).
          ready:      filterReadyForDisplay(
                        formatList(filterStation(completedAll || []), 'completed')
                      ),
        };

        // Detect newly-ready orders (visible since last poll) for
        // the pulse animation.
        const currentReadyIds = new Set(next.ready.map(o => String(o.id)));
        const nowTs = Date.now();
        currentReadyIds.forEach(id => {
          if (!prevReadyIdsRef.current.has(id) && !newReadyRef.current.has(id)) {
            newReadyRef.current.set(id, nowTs);
          }
        });
        // Drop entries older than 30s — pulse animation should be brief.
        for (const [id, ts] of newReadyRef.current) {
          if (nowTs - ts > 30000) newReadyRef.current.delete(id);
        }
        prevReadyIdsRef.current = currentReadyIds;

        setOrders(next);
        setLastUpdated(new Date());
        setConnected(true);
        setLoading(false);
      } catch (e) {
        setError('Failed to load orders: ' + (e.message || 'Unknown'));
        setConnected(false);
        setLoading(false);
      }
    };
    load();
    // 8s poll as a fallback; WebSocket order events (below) flip the board
    // instantly when they fire — this just bounds the worst-case lag.
    timer = setInterval(load, 8000);
    // Push refresh on WebSocket order events so the customer-facing
    // Display flips "Brewing → Ready" instantly when the barista
    // hits Complete, instead of waiting for the next 15s poll.
    // Throttled — a single barista action that emits multiple
    // events shouldn't trigger a refetch storm.
    let lastWsLoad = 0;
    const wsLoad = () => {
      const now = Date.now();
      if (now - lastWsLoad < 800) return;
      lastWsLoad = now;
      load();
    };
    window.addEventListener('order_created', wsLoad);
    window.addEventListener('order_updated', wsLoad);
    window.addEventListener('app:newOrder', wsLoad);
    return () => {
      clearInterval(timer);
      window.removeEventListener('order_created', wsLoad);
      window.removeEventListener('order_updated', wsLoad);
      window.removeEventListener('app:newOrder', wsLoad);
    };
  }, [currentStation]);

  // Manual refresh button.
  const handleRefresh = () => {
    setLoading(true);
    setLastUpdated(new Date());
    // useEffect will re-run if we toggle currentStation, but we
    // already have the timer — just bump loading state to give
    // the operator visual feedback.
    setTimeout(() => setLoading(false), 300);
  };

  // Tap anywhere to fullscreen on iPad — the operator drops the
  // tablet into a stand and one tap from any corner makes it
  // edge-to-edge.
  const tryFullscreen = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().catch(() => { /* user-gesture issue, ignore */ });
    }
  };

  // "Brewing" should only contain orders the barista has actually
  // started — combining pending+in-progress earlier was misleading
  // (the Barista UI still shows pending under "New Orders" while
  // the customer Display was showing them as "Brewing").
  const brewing = useMemo(
    () => orders.inProgress,
    [orders.inProgress]
  );

  const isPortrait = orientation === 'portrait';

  // Container styles. Zoom is applied with transform so we don't
  // re-render the layout — useful when an iPad is mirrored to a
  // bigger external screen at the same dom dimensions.
  // When rotation is set, we ALSO swap width/height and re-anchor
  // so the rotated content fills the viewport rather than running
  // off the right edge. transform-origin is top-left + a translate
  // so the post-rotation top-left lands at (0,0) of the viewport.
  // CSS rotation that ACTUALLY fills the viewport. The trick:
  //   - For 90° / 270° the visible width and height swap, so the
  //     wrapper is sized 100vh × 100vw.
  //   - transform-origin is set to a corner of the viewport such
  //     that after rotation the element lands on (0,0)..(vw,vh).
  //
  // Recipe references: 90° starts anchored at the RIGHT edge and
  // rotates clockwise into the viewport. 270° starts anchored at
  // the BOTTOM edge and rotates anti-clockwise into the viewport.
  // 180° just rotates in place around the centre.
  //
  // Previous version used `rotate(...) translate(...)` chains which
  // got the math subtly wrong on real browsers — content was
  // off-screen or doubled up.
  const ROTATION_WRAPPERS = {
    0:   null,
    90:  {
      position: 'fixed', top: 0, left: '100vw',
      width: '100vh', height: '100vw',
      transformOrigin: 'top left',
      transform: 'rotate(90deg)',
    },
    180: {
      position: 'fixed', top: 0, left: 0,
      width: '100vw', height: '100vh',
      transformOrigin: 'center center',
      transform: 'rotate(180deg)',
    },
    270: {
      position: 'fixed', top: '100vh', left: 0,
      width: '100vh', height: '100vw',
      transformOrigin: 'top left',
      transform: 'rotate(-90deg)',
    },
  };
  const rotationStyle = ROTATION_WRAPPERS[rotation];

  const zoomStyle = zoom && zoom !== 100
    ? { transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }
    : {};
  // If both rotation and zoom are active, the rotation transform
  // sits on the outer wrapper and zoom on the inner content — so
  // they don't fight each other.
  const containerStyle = rotationStyle ? {} : zoomStyle;

  // --- Render ---
  // Rotation wrapper. When rotation === 0 we render the content
  // directly so the DOM stays simple in the common case.

  // Brand header band: paint the header in the event's colour and pick a
  // readable text colour (near-black or white) from its luminance, so the
  // title stays legible whatever colour the operator picked.
  const headerColor = config.header_color || '#1e40af';
  const _hx = (headerColor || '').replace('#', '');
  const _r = parseInt(_hx.substring(0, 2) || '1e', 16);
  const _g = parseInt(_hx.substring(2, 4) || '40', 16);
  const _b = parseInt(_hx.substring(4, 6) || 'af', 16);
  const _lum = (0.299 * _r + 0.587 * _g + 0.114 * _b) / 255;
  const onHeader = _lum > 0.6 ? '#111827' : '#ffffff';
  const onHeaderDim = _lum > 0.6 ? 'rgba(17,24,39,0.72)' : 'rgba(255,255,255,0.82)';
  const headerChip = _lum > 0.6 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.16)';

  // Full-screen Display background — pick the image matching the screen's
  // orientation (fall back to the other if only one was uploaded). When set,
  // the order columns become translucent panels that hug their content, so
  // the image shows through when the queue is quiet and the boxes grow as
  // orders arrive.
  const bgImage = isPortrait
    ? (config.background_portrait || config.background_landscape || '')
    : (config.background_landscape || config.background_portrait || '');
  const hasBg = !!bgImage;

  const content = (
    <div className={`min-h-screen w-full ${hasBg ? '' : theme.bg} ${theme.text}
                     flex flex-col font-sans overflow-hidden`}
         onClick={tryFullscreen}
         style={hasBg
           ? { ...containerStyle, backgroundImage: `url("${bgImage}")`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }
           : containerStyle}>

      {/* --- Header (brand band) --- */}
      <header className="px-6 md:px-10 pt-5 pb-5 flex items-center justify-between gap-4 shadow-md"
              style={{ backgroundColor: headerColor, color: onHeader }}>
        <div className="flex items-center min-w-0">
          <button
            onClick={(e) => { e.stopPropagation(); window.location.href = '/'; }}
            className="mr-4 p-2 rounded-full hover:opacity-80 transition flex-shrink-0"
            style={{ backgroundColor: headerChip, color: onHeader }}
            title="Back to home"
          >
            <ArrowLeft size={24} />
          </button>
          {config.logo ? (
            <div className="bg-white rounded-xl p-2 mr-4 shadow-sm flex items-center flex-shrink-0">
              <img
                src={config.logo}
                alt=""
                className={`${isPortrait ? 'h-12' : 'h-16'} w-auto max-w-[220px] object-contain`}
              />
            </div>
          ) : (
            <Coffee size={40} className="mr-4 flex-shrink-0" />
          )}
          <div className="min-w-0">
            <h1 className={`${isPortrait ? 'text-4xl' : 'text-5xl'} font-extrabold tracking-tight leading-tight truncate`}>
              {config.event_name || config.system_name}
            </h1>
            <div className="text-sm md:text-base flex items-center mt-1.5" style={{ color: onHeaderDim }}>
              <MapPin size={14} className="mr-1" />
              {currentStation
                ? `${currentStation.name}${currentStation.location ? ` · ${currentStation.location}` : ''}`
                : 'Loading station…'}
              {showWaitTimes && (
                <span className="ml-3 inline-flex items-center">
                  <Clock size={14} className="mr-1" />
                  Live · refreshes every 8s
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {stations.length > 1 && (
            <select
              value={currentStation?.id || ''}
              onChange={(e) => {
                e.stopPropagation();
                const v = e.target.value;
                if (v === 'all') setCurrentStation({ id: 'all', name: 'All Stations' });
                else {
                  const nid = parseInt(v, 10);
                  setCurrentStation(stations.find(s => s.id === nid) || stations[0]);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="px-3 py-2 rounded-lg text-sm border-0 bg-white/95 text-gray-800"
            >
              <option value="all">All Stations</option>
              {stations.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setOrientation(orientation === 'portrait' ? 'landscape' : 'portrait'); }}
            className="p-2 rounded-full hover:opacity-80"
            style={{ backgroundColor: headerChip, color: onHeader }}
            title={orientation === 'portrait' ? 'Switch to landscape' : 'Switch to portrait (vertical)'}
          >
            <RotateCw size={20} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
            className="p-2 rounded-full hover:opacity-80"
            style={{ backgroundColor: headerChip, color: onHeader }}
            title="Refresh"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); tryFullscreen(); }}
            className="p-2 rounded-full hover:opacity-80"
            style={{ backgroundColor: headerChip, color: onHeader }}
            title="Fullscreen"
          >
            <Maximize2 size={20} />
          </button>
        </div>
      </header>

      {/* --- Connection warning --- */}
      {!connected && (
        <div className="mx-6 md:mx-10 mb-3 px-4 py-2 rounded-lg bg-red-500/90 text-white text-sm">
          {error || 'Not connected to backend — orders may be stale.'}
        </div>
      )}

      {/* --- Main ---
           Pickup mode: a clean, single full-width "ready for collection"
           board (no brewing column, no kiosk, no SMS footer). Orders mode:
           the usual two-column Brewing / Ready layout. */}
      {isPickupMode ? (
        <main className="flex-grow px-6 md:px-10 pb-6 overflow-hidden">
          <Column
            kind="ready"
            hasBg={hasBg}
            theme={theme}
            fonts={fonts}
            isPortrait={isPortrait}
            loading={loading}
            orders={orders.ready}
            showCustomerName={showCustomerName}
            showDetails={showDetails}
            newReadyMap={newReadyRef.current}
          />
        </main>
      ) : (
      <main className={hasBg
        ? `flex-grow flex gap-6 md:gap-8 px-6 md:px-10 pb-6 ${isPortrait ? 'flex-col justify-end' : 'flex-row items-end'}`
        : `flex-grow grid gap-6 md:gap-8 px-6 md:px-10 pb-6 ${isPortrait
            ? 'grid-cols-1 grid-rows-2'
            : (showCompleted ? 'grid-cols-2' : 'grid-cols-1')}`}>

        {/* In portrait we put Ready first (more important to
            customers waiting). In landscape we keep the natural
            left-to-right flow. */}
        {isPortrait && showCompleted && (
          <Column
            kind="ready"
            hasBg={hasBg}
            theme={theme}
            fonts={fonts}
            isPortrait={isPortrait}
            loading={loading}
            orders={orders.ready}
            showCustomerName={showCustomerName}
            showDetails={showDetails}
            newReadyMap={newReadyRef.current}
          />
        )}

        <Column
          kind="brewing"
          hasBg={hasBg}
          theme={theme}
          fonts={fonts}
          isPortrait={isPortrait}
          loading={loading}
          orders={brewing}
          showCustomerName={showCustomerName}
          showDetails={showDetails}
          newReadyMap={newReadyRef.current}
        />

        {!isPortrait && showCompleted && (
          <Column
            kind="ready"
            hasBg={hasBg}
            theme={theme}
            fonts={fonts}
            isPortrait={isPortrait}
            loading={loading}
            orders={orders.ready}
            showCustomerName={showCustomerName}
            showDetails={showDetails}
            newReadyMap={newReadyRef.current}
          />
        )}
      </main>
      )}

      {/* --- Footer: self-service "Order here" + SMS prompt + sponsor ---
           Hidden on the clean pickup screen. */}
      {!isPickupMode && (
      <footer className={`px-6 md:px-10 py-4 ${theme.panel} ${theme.border} border-t
                          flex items-center justify-between gap-6 flex-wrap`}>
        <div className="flex items-center gap-4 flex-wrap min-w-0">
          {/* Big touch target for walk-up self-service ordering. */}
          {kioskEnabled && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowKiosk(true); }}
              className="flex items-center gap-3 rounded-2xl px-7 py-4 text-2xl font-extrabold shadow-md hover:opacity-90 active:scale-95"
              style={{ backgroundColor: headerColor, color: onHeader }}
            >
              <Coffee size={32} /> Order here
            </button>
          )}
          {/* Only advertise SMS ordering when a number is actually configured. */}
          {config.sms_number && (
            <div className="flex items-center min-w-0 rounded-2xl px-5 py-3 shadow-sm bg-white/90 text-gray-800">
              <MessageCircle size={26} className="mr-3 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-wide text-gray-500">
                  {kioskEnabled ? 'Or order by SMS' : 'Order by SMS'}
                </div>
                <div className="text-xl font-extrabold tracking-wide truncate">
                  {formatSmsNumber(config.sms_number)}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className={`text-right max-w-[40%] ${fonts.body} font-medium truncate`}>
          {config.sponsor?.enabled && config.sponsor.name
            ? `${config.sponsor.name}: ${config.sponsor.message}`
            : (config.custom_message || '')}
        </div>
      </footer>
      )}

      {/* Self-service kiosk overlay. Routes to this display's station (or a
          capable one) and refreshes the board on close so a just-placed
          order shows immediately. */}
      {showKiosk && (
        <KioskOrder
          stationId={currentStation && currentStation.id !== 'all' ? currentStation.id : null}
          headerColor={headerColor}
          onClose={() => { setShowKiosk(false); handleRefresh(); }}
        />
      )}

      {/* Tiny inline style for a one-shot pulse on newly-ready
          orders. Tailwind doesn't ship this animation by default. */}
      <style>{`
        @keyframes pulseOnce {
          0%   { box-shadow: 0 0 0 0 rgba(34,197,94,0.55); }
          50%  { box-shadow: 0 0 0 12px rgba(34,197,94,0); }
          100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
        }
        .animate-pulse-once {
          animation: pulseOnce 1.4s ease-out 0s 6;
        }
      `}</style>
    </div>
  );

  // Apply CSS rotation if the operator picked a non-zero value. This
  // is the "screen is mounted sideways, OS can't rotate" escape
  // hatch — when the OS CAN rotate (Mac System Settings → Displays,
  // Windows → Display orientation), prefer that. CSS rotation works
  // but adds a transform that can blur text slightly on some
  // browsers.
  if (rotationStyle) {
    // Apply zoom on the inner content (so it doesn't fight the
    // outer rotation transform).
    const innerStyle = zoom && zoom !== 100
      ? { transform: `scale(${zoom / 100})`, transformOrigin: 'top left',
          width: zoom === 100 ? '100%' : `${10000 / zoom}%`,
          height: zoom === 100 ? '100%' : `${10000 / zoom}%` }
      : { width: '100%', height: '100%' };
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0,
        overflow: 'hidden',
        ...rotationStyle,
      }}>
        <div style={innerStyle}>{content}</div>
      </div>
    );
  }
  return content;
};

// --- Subcomponent: a column of orders ---
const Column = ({ kind, theme: baseTheme, fonts, isPortrait, loading, orders,
                  showCustomerName, showDetails, newReadyMap, hasBg }) => {
  const isReady = kind === 'ready';
  // Over a full-screen background, render a frosted-white panel with dark
  // text so cards stay legible whatever the image, and let the panel hug
  // its content (compact when empty, growing as orders arrive).
  const theme = hasBg
    ? { ...baseTheme, panel: 'bg-white/90 backdrop-blur-md', text: 'text-gray-900', subtext: 'text-gray-500', border: 'border-gray-200' }
    : baseTheme;
  const headerCls = isReady ? 'bg-green-600 text-white' : 'bg-amber-500 text-white';
  const icon = isReady ? <Check size={28} className="mr-2" /> : <Clock size={28} className="mr-2" />;
  const title = isReady ? 'Ready for Pickup' : 'Brewing';

  return (
    <section className={`rounded-3xl overflow-hidden flex flex-col ${theme.panel} shadow-xl
                        ${hasBg ? (isPortrait ? 'w-full max-h-[42vh]' : 'flex-1 min-w-0 max-h-[78vh]') : ''}`}>
      <header className={`${headerCls} px-6 py-4 flex items-center justify-between flex-shrink-0`}>
        <div className="flex items-center">
          {icon}
          <h2 className="text-2xl md:text-3xl font-bold">{title}</h2>
        </div>
        <div className="text-lg font-bold opacity-90">{orders.length}</div>
      </header>
      <div className={hasBg ? 'px-4 py-3 overflow-auto' : 'p-4 md:p-6 flex-grow overflow-auto'}>
        {loading ? (
          hasBg
            ? <div className={`text-center ${theme.subtext} text-sm py-1`}>Loading…</div>
            : <Empty theme={theme} text="Loading…" pulse />
        ) : orders.length === 0 ? (
          hasBg
            ? <div className={`text-center ${theme.subtext} text-sm py-1`}>
                {isReady ? 'Nothing ready yet' : 'All caught up'}
              </div>
            : <Empty theme={theme}
                     text={isReady ? 'Nothing ready yet — keep an eye on the brewing list' : 'All caught up'} />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:gap-6">
            {orders.slice(0, isPortrait ? 4 : 6).map(o => (
              <OrderCard
                key={o.id}
                order={o}
                variant={isReady ? 'ready' : 'brewing'}
                fonts={fonts}
                theme={theme}
                showCustomerName={showCustomerName}
                showDetails={showDetails}
                isNew={isReady && newReadyMap.has(String(o.id))}
              />
            ))}
            {orders.length > (isPortrait ? 4 : 6) && (
              <div className={`text-center ${theme.subtext} pt-2`}>
                + {orders.length - (isPortrait ? 4 : 6)} more
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

const Empty = ({ theme, text, pulse }) => (
  <div className={`h-full min-h-[200px] flex flex-col items-center justify-center ${theme.subtext}`}>
    <Coffee size={64} className={`mb-4 opacity-40 ${pulse ? 'animate-pulse' : ''}`} />
    <p className="text-xl">{text}</p>
  </div>
);

export default DisplayScreen;
