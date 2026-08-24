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
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Coffee, Check, Clock, ArrowLeft, RefreshCw, MapPin,
         Maximize2, MessageCircle, RotateCw, Volume2, VolumeX } from 'lucide-react';
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
//
// `name` sits between `num` and `body` on purpose. The name used to be
// rendered at `body` size UNDER the number, which made it about a third
// of the number's height — but a customer scanning this screen from
// across a room is usually looking for their NAME, not a number they
// may not have memorised. It now sits beside the number, large enough
// to find at the same distance.
const FONT_SCALE = {
  small:        { num: 'text-6xl',  name: 'text-3xl', body: 'text-lg',  label: 'text-sm' },
  medium:       { num: 'text-7xl',  name: 'text-4xl', body: 'text-xl',  label: 'text-base' },
  large:        { num: 'text-8xl',  name: 'text-5xl', body: 'text-2xl', label: 'text-lg' },
  'extra-large':{ num: 'text-9xl',  name: 'text-6xl', body: 'text-3xl', label: 'text-xl' },
};

// Pick the layout for the current viewport + setting combination.
// "auto" looks at window aspect ratio at render time.
// How often the board re-reads orders when no WebSocket event arrives.
// Single source of truth: the copy in DisplaySelector quotes this, and it
// used to claim 20s while the code polled 8s.
export const DISPLAY_POLL_MS = 5000;

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
          {/* Order number and name share a row, baseline-aligned. The
              number stays the anchor you can read across a room; the
              name is now big enough to find from the same distance
              instead of being a caption under it. flex-wrap so a long
              name drops to its own line on a narrow screen rather than
              squeezing the number. */}
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 min-w-0">
            <div className={`${fonts.num} font-extrabold leading-none tracking-tight ${theme.text} flex-shrink-0`}>
              #{order.order_number}
            </div>
            {showCustomerName && (
              <div className={`${fonts.name} font-semibold leading-none ${theme.text} truncate min-w-0`}>
                {formatCustomerLine(order)}
              </div>
            )}
          </div>
          {showDetails && (
            <div className={`${fonts.label} mt-3 ${theme.subtext}`}>
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
  // Operator navigation on a public board is opt-in. See the back button
  // below for why.
  const showNav = searchParams.get('nav') === '1';
  // What the header QR encodes. ?qr= lets an operator point it at a short
  // branded link (rebrand.ly/CTNCoffee) instead of the raw app URL; with
  // no override it falls back to this deployment's own /my page, which is
  // always correct even if nobody configures anything. ?qr=off hides it.
  const qrParam = searchParams.get('qr');
  const orderQrUrl = qrParam === 'off'
    ? ''
    : (qrParam || (typeof window !== 'undefined' ? `${window.location.origin}/my` : ''));
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

  // Display config from the backend. The PUBLIC customer display has NO auth,
  // so it CANNOT read /api/settings — every appearance + content setting must
  // come from the public /display/config (populated by the fetch below).
  // Declared here, BEFORE the derivations that read it, to avoid a TDZ error.
  const [config, setConfig] = useState({
    system_name: 'Coffee Cue',
    event_name: 'Coffee Event',
    sms_number: '',
    sponsor: { enabled: false, name: '', message: '' },
    // CupQ house dark. This initial value matters: a second merge from
    // the local settings hook runs after the API one, so a blue left
    // here beat the colour the server actually sent.
    header_color: '#C08552',
    custom_message: '',
    logo: '',
    background_landscape: '',
    background_portrait: '',
    // Content + appearance — authoritative for the PUBLIC display. Defaults
    // mirror the old settings-hook fallbacks so a fresh screen looks right.
    show_customer_name: true,
    show_order_details: true,
    show_completed: true,
    show_wait_times: true,
    display_theme: 'light',
    display_font_size: 'large',
    display_zoom: 100,
    display_rotation: 0,
    display_mode: 'auto',
    // Board overflow controls (operator-set in the barista Display tab):
    // seconds per page flip, fixed cards-per-page (0 = auto-measure,
    // 3..8 = scale cards to fit), and flip vs continuous scroll.
    display_flip_seconds: 10,
    display_cards_per_page: 0,
    display_overflow_mode: 'flip',
    // Is this screen a TOUCHSCREEN? On: tap-to-order kiosk button.
    // Off (wall TV nobody can reach): SMS ordering is the primary CTA.
    display_touch_ordering: true,
  });

  // Visual config — sourced from the public /display/config (works with no
  // auth). The settings hook is NOT used here because the public display can't
  // read it; that was why theme/font/etc. set by the operator never applied.
  const themeKey = config.display_theme || 'light';
  const theme = THEMES[themeKey] || THEMES.light;
  const fonts = FONT_SCALE[config.display_font_size] || FONT_SCALE.large;
  const zoom = config.display_zoom || 100;
  const showCustomerName = config.show_customer_name !== false;
  const showDetails = config.show_order_details !== false;
  const showCompleted = config.show_completed !== false;
  const showWaitTimes = config.show_wait_times !== false;
  // Board overflow controls, operator-set in the barista Display tab.
  // cardsPerPage 0 = auto-measure; 3..8 = force N and scale cards to fit.
  const boardOpts = {
    flipSeconds: config.display_flip_seconds > 0 ? Number(config.display_flip_seconds) : 10,
    cardsPerPage: config.display_cards_per_page > 0
      ? Math.min(8, Math.max(3, Number(config.display_cards_per_page)))
      : 0,
    overflowMode: config.display_overflow_mode === 'scroll' ? 'scroll' : 'flip',
  };
  // CSS rotation for hardware screens mounted sideways (a vertical
  // TV on a stand fed by an HDMI source that can't itself rotate,
  // an AirPlay'd iPad on a wall mount, etc). 0/90/180/270 only.
  // When the OS supports rotation that's still the better path —
  // this is for when it doesn't.
  const rotation = _normalizeRotation(
    rotateFromUrl != null ? rotateFromUrl : (config.display_rotation ?? 0)
  );

  // Effective orientation — URL > config setting > auto-detect.
  const [orientation, setOrientation] = useState(
    () => resolveOrientation(orientationFromUrl || config.display_mode || 'auto')
  );
  // Re-resolve on window resize AND when the config's display_mode loads
  // from the backend (deps), so "auto" picks up landscape ⇄ portrait flips
  // and an operator-set orientation applies once config arrives.
  useEffect(() => {
    const onResize = () => {
      setOrientation(resolveOrientation(orientationFromUrl || config.display_mode || 'auto'));
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, [orientationFromUrl, config.display_mode]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Health, for the corner dot. Three states because two are not enough:
  // "working now" and "broken now" miss the case that actually matters --
  // a board that dropped out earlier and recovered. Steve wants to remote
  // in, read the dot and leave, without exiting the display and
  // interrupting a live queue to find out whether it has been solid.
  //   green  never missed a poll
  //   orange recovered, but it HAS dropped out since this screen loaded
  //   red    failing right now
  const [health, setHealth] = useState({ level: 'green', misses: 0, everFailed: false });
  const noteFetch = useCallback((ok) => {
    setHealth(prev => {
      if (ok) {
        return { level: prev.everFailed ? 'orange' : 'green', misses: 0,
                 everFailed: prev.everFailed };
      }
      const misses = prev.misses + 1;
      // One missed poll is a blip on conference wifi, not a fault. Two
      // in a row is worth a red dot -- a dot that cries wolf gets
      // ignored, which defeats the point of glancing at it.
      return { level: misses >= 2 ? 'red' : (prev.everFailed ? 'orange' : 'green'),
               misses, everFailed: true };
    });
  }, []);

  // Measured with its own tiny request, deliberately.
  //
  // The obvious hook -- the orders poll -- cannot answer this. It goes
  // through OrderDataService, which falls back to cached data when the
  // server is unreachable. That is right for the board (a frozen list
  // beats an empty one) but it means the poll RESOLVES during an
  // outage, so a dot driven by it stays green while the screen shows
  // stale orders. Tested exactly that: server killed, dot stayed green.
  //
  // /api/health is a few bytes and touches nothing, so asking it
  // directly is both honest and cheap.
  useEffect(() => {
    let dead = false;
    const probe = async () => {
      let ok = false;
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        ok = r.ok;
      } catch (e) { ok = false; }
      if (!dead) noteFetch(ok);
    };
    probe();
    const t = setInterval(probe, DISPLAY_POLL_MS * 2);
    return () => { dead = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // When the board last successfully loaded, for the staleness check.
  const lastLoadAtRef = useRef(0);
  // The live loader, published by the polling effect so the Refresh
  // button can actually call it (see handleRefresh).
  const loadRef = useRef(null);
  const prevReadyIdsRef = useRef(new Set());

  // --- Voice announcements: "Order number one five nine, for Sarah" ---
  // Web Speech API — the TV's browser does the talking and the audio
  // rides the TV's own output (HDMI). No recordings, no cloud, works
  // offline. OFF by default; the tap that enables it doubles as the
  // browser's required audio-unlock gesture, and we confirm out loud so
  // the operator knows sound is actually reaching the TV speakers.
  // Refs (not state) inside the announce path so the long-lived polling
  // effect never needs new dependencies.
  const [announceOn, setAnnounceOn] = useState(
    () => localStorage.getItem('coffee_display_announce') === 'true'
  );
  const announceOnRef = useRef(announceOn);
  const announceQueueRef = useRef([]);
  const speakingRef = useRef(false);
  const announcedIdsRef = useRef(new Set());
  const firstPollRef = useRef(true);
  useEffect(() => { announceOnRef.current = announceOn; }, [announceOn]);
  useEffect(() => () => {
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* noop */ }
  }, []);

  const playChime = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
      osc.onended = () => { try { ctx.close(); } catch (e) { /* noop */ } };
    } catch (e) { /* a missing chime never blocks the announcement */ }
  };

  const speakNextAnnouncement = () => {
    if (speakingRef.current || !announceOnRef.current) return;
    const text = announceQueueRef.current.shift();
    if (!text || !('speechSynthesis' in window)) return;
    speakingRef.current = true;
    playChime();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    try {
      const voices = window.speechSynthesis.getVoices() || [];
      const voice = voices.find(v => /en[-_]AU/i.test(v.lang))
        || voices.find(v => /^en/i.test(v.lang));
      if (voice) u.voice = voice;
    } catch (e) { /* default voice is fine */ }
    const done = () => {
      speakingRef.current = false;
      setTimeout(speakNextAnnouncement, 400);
    };
    u.onend = done;
    u.onerror = done;
    // Let the chime land before the voice starts.
    setTimeout(() => window.speechSynthesis.speak(u), 450);
  };

  const enqueueAnnouncements = (readyOrders) => {
    if (!announceOnRef.current || !('speechSynthesis' in window)) return;
    readyOrders.forEach(o => {
      const id = String(o.id);
      if (announcedIdsRef.current.has(id)) return;
      announcedIdsRef.current.add(id);
      // Digits read one at a time — "one five nine" carries over venue
      // noise better than "a hundred and fifty-nine".
      const digits = String(o.order_number || o.id)
        .replace(/\D/g, '').split('').join(' ');
      const first = String(o.customerName || '').trim().split(' ')[0];
      let text = `Order number ${digits || String(o.order_number || o.id)}`;
      if (first && first.toLowerCase() !== 'customer') text += `, for ${first}`;
      announceQueueRef.current.push(text);
      // A backlog of stale announcements helps nobody — keep the last 6.
      if (announceQueueRef.current.length > 6) announceQueueRef.current.shift();
    });
    speakNextAnnouncement();
  };

  const toggleAnnouncements = () => {
    const next = !announceOn;
    setAnnounceOn(next);
    try { localStorage.setItem('coffee_display_announce', next ? 'true' : 'false'); } catch (e) { /* noop */ }
    announceOnRef.current = next;
    if (next && 'speechSynthesis' in window) {
      playChime();
      const u = new SpeechSynthesisUtterance('Order announcements on');
      setTimeout(() => window.speechSynthesis.speak(u), 450);
    } else {
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* noop */ }
      announceQueueRef.current = [];
      speakingRef.current = false;
    }
  };

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
            // Honour the operator's display toggles + appearance settings
            // (server-authoritative — the public display can't read /api/settings).
            show_customer_name: c.show_customer_name !== false,
            show_order_details: c.show_order_details !== false,
            show_completed: c.show_completed !== false,
            show_wait_times: c.show_wait_times !== false,
            display_theme: c.display_theme || prev.display_theme,
            display_font_size: c.display_font_size || prev.display_font_size,
            display_zoom: c.display_zoom || prev.display_zoom,
            display_rotation: c.display_rotation ?? prev.display_rotation,
            display_mode: c.display_mode || prev.display_mode,
            // Board overflow controls (barista Display tab)
            display_flip_seconds: c.display_flip_seconds ?? prev.display_flip_seconds,
            display_cards_per_page: c.display_cards_per_page ?? prev.display_cards_per_page,
            display_overflow_mode: c.display_overflow_mode || prev.display_overflow_mode,
            display_touch_ordering: c.display_touch_ordering ?? prev.display_touch_ordering,
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
    const load = async (loadOpts) => {
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
          (OrderDataService.getPendingOrders ? OrderDataService.getPendingOrders(loadOpts) : Promise.resolve([])),
          OrderDataService.getInProgressOrders(loadOpts),
          OrderDataService.getCompletedOrders(loadOpts),
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

        // Voice: announce orders that JUST became ready. The first poll
        // is baseline (announcing the whole board on page load would be
        // chaos); dedupe lives inside enqueueAnnouncements.
        const newlyReady = next.ready.filter(
          o => !prevReadyIdsRef.current.has(String(o.id)));
        if (!firstPollRef.current && newlyReady.length) {
          enqueueAnnouncements(newlyReady);
        }
        firstPollRef.current = false;

        prevReadyIdsRef.current = currentReadyIds;

        setOrders(next);
        lastLoadAtRef.current = Date.now();
        setLastUpdated(new Date());
        setConnected(true);
        setLoading(false);
      } catch (e) {
        setError('Failed to load orders: ' + (e.message || 'Unknown'));
        setConnected(false);
        setLoading(false);
      }
    };
    loadRef.current = load;
    load();
    // The poll IS the update path, not a fallback.
    //
    // The comment here used to say WebSocket events "flip the board
    // instantly ... this just bounds the worst-case lag". They never fire:
    // ApiService.initializeWebSocket() has no callers anywhere in the app,
    // so setupCommonEventHandlers never runs and order_created /
    // order_updated are never dispatched. The worst case was the only
    // case, and the listeners below are dead wiring kept for when the
    // socket is actually connected.
    //
    // setInterval alone is not enough either: browsers throttle timers in
    // a tab that is not foreground - measured here at one poll per 35-60s
    // against a nominal 5s, which is exactly the ">30 seconds" Steve saw.
    // So the board also refreshes whenever it becomes visible again, and
    // checks on a short heartbeat whether its data has gone stale.
    timer = setInterval(load, DISPLAY_POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);

    // Belt and braces: if a throttled timer has left the board stale, this
    // catches it the moment the tab is being painted again.
    const staleCheck = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const age = Date.now() - (lastLoadAtRef.current || 0);
      if (age > DISPLAY_POLL_MS * 2) load();
    }, 2000);
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
      clearInterval(staleCheck);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
      window.removeEventListener('order_created', wsLoad);
      window.removeEventListener('order_updated', wsLoad);
      window.removeEventListener('app:newOrder', wsLoad);
    };
  }, [currentStation]);

  // Manual refresh button.
  //
  // This used to fetch NOTHING. It set a spinner, waited 300ms and
  // cleared it - "just bump loading state to give the operator visual
  // feedback" - so pressing Refresh on a stale board changed nothing but
  // the spinner. Combined with the 60s order cache, an operator could
  // press it repeatedly and watch the same stale columns.
  const handleRefresh = () => {
    setLoading(true);
    setLastUpdated(new Date());
    const run = loadRef.current;
    if (run) {
      // force: skip the client cache. Someone pressing Refresh is saying
      // the screen is wrong; answering from cache is useless.
      Promise.resolve(run({ force: true })).finally(() => setLoading(false));
    } else {
      setTimeout(() => setLoading(false), 300);
    }
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
  // Locked mode. Hides every operator control on a public screen, so a
  // passer-by cannot wander into settings or close the board. Getting
  // out is a deliberate act: press and hold the top-left corner. Steve:
  // "needs a clean tamperproof version that say a click and hold in a
  // certain area allows a pinched to exit full screen and also access
  // other menus".
  //
  // Held in the URL (?locked=1) rather than in storage on purpose. A
  // display that boots into a state you cannot remember setting, on a
  // screen with no keyboard, is a bad afternoon. Reloading the plain URL
  // always gives you the controls back.
  const lockedByUrl = searchParams.get('locked') === '1'
                   || searchParams.get('lock') === '1';
  const [unlocked, setUnlocked] = useState(false);
  const locked = lockedByUrl && !unlocked;
  const holdRef = useRef(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const startHold = () => {
    if (!locked) return;
    setHoldProgress(0);
    const started = Date.now();
    holdRef.current = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - started) / 2000) * 100);
      setHoldProgress(pct);
      if (pct >= 100) {
        clearInterval(holdRef.current);
        holdRef.current = null;
        setHoldProgress(0);
        setUnlocked(true);
      }
    }, 60);
  };
  const cancelHold = () => {
    if (holdRef.current) { clearInterval(holdRef.current); holdRef.current = null; }
    setHoldProgress(0);
  };
  useEffect(() => () => { if (holdRef.current) clearInterval(holdRef.current); }, []);

  // Track fullscreen so the operator chrome (back arrow, station picker,
  // control buttons) can hide for a clean customer-facing board.
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

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

  // Column gap. Wide enough for the overhanging QR to sit between the
  // Brewing and Ready headers rather than on top of them; the ordinary
  // gap everywhere else.
  // The ribbon overlaps the coloured headers now rather than dropping
  // into a lane between them (Steve: "the qr code could be bigger and
  // could go over the top of the orange and green banner"). Overlapping
  // buys the width back for the order cards -- the old 13rem lane was
  // dead space on every board -- and the drop shadow is what makes the
  // overlap read as a layer rather than a collision.
  const qrGap = (orderQrUrl && !isPortrait) ? 'gap-6 md:gap-16' : 'gap-6 md:gap-8';

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
  // CupQ house colours, from the logo: dark navy-charcoal with a tan
  // accent. The old default was a generic blue that belonged to nothing.
  // Still overridable per event via branding.headerColor -- a client with
  // their own brand should win over ours.
  // The logo's coffee tan is the banner; the near-black is reserved for
  // shadow and text. Steve: "think the black backgound should be the
  // coffee colour". A near-black band reads as chrome; the tan reads as
  // the brand.
  const CUPQ_DARK = '#1F2A37';
  const CUPQ_COFFEE = '#C08552';
  const headerColor = config.header_color || CUPQ_COFFEE;
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
  // orders arrive. Panels anchor to the TOP of the screen (under the
  // header): people standing in front of the display block the bottom
  // half, so status banners must sit up high to stay visible.
  const bgImage = isPortrait
    ? (config.background_portrait || config.background_landscape || '')
    : (config.background_landscape || config.background_portrait || '');
  const hasBg = !!bgImage;

  // h-screen, not min-h-screen. With min-h-screen the column could grow
  // TALLER than the viewport, and overflow-hidden then clipped whatever
  // fell off the bottom - which on an iPad (about 1.43:1, not the 16:9 a
  // wall TV gives you) was the footer holding the "Order here" button.
  // Fixing the height to the viewport and letting <main> shrink keeps the
  // footer on screen at any aspect ratio.
  const content = (
    <div className={`h-screen w-full ${hasBg ? '' : theme.bg} ${theme.text}
                     flex flex-col font-sans overflow-hidden`}
         onClick={tryFullscreen}
         style={hasBg
           ? { ...containerStyle, backgroundImage: `url("${bgImage}")`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }
           : containerStyle}>

      {/* --- Header (brand band) --- */}
      {/* Three cells, not a flex row: branding | centre gutter | controls.
          justify-between distributes slack BETWEEN items, so a spacer
          meant to hold the middle open landed wherever the surrounding
          widths pushed it -- measured at x=400 on a 1280 board while the
          QR sat at 560, putting the SMS number straight under the code.
          A 1fr/auto/1fr grid puts the middle cell in the middle by
          construction, whatever the branding or the controls weigh. */}
      {/* The shadow belongs to the WHOLE banner, not just the code hanging
          off it. Steve: "the drop shadow could be dark (blackish) and not
          just go around the qr code but the full banner outline". One
          shadow under one shape is what makes the band and its dip read
          as a single object in front of the board -- a shadow on the
          ribbon alone made the code look stuck on. Cast in the logo's
          near-black rather than a neutral grey, so even the shadow is
          part of the palette. */}
      <header className="px-6 md:px-10 pt-5 pb-5 grid items-center gap-4 relative"
              style={{ backgroundColor: headerColor, color: onHeader,
                       boxShadow: '0 10px 24px -4px rgba(31,42,55,0.55)',
                       gridTemplateColumns: (orderQrUrl && !isPortrait)
                         ? '1fr auto 1fr' : '1fr auto' }}>

        {/* Health dot, top-left. Small and quiet enough that a customer
            never notices it, readable from a remote-desktop session at a
            glance -- which is the whole point. Steve: "if you remote in
            you can see the dot colour without having to exit the display
            and interrupt use".
              green   never missed a poll
              orange  recovered, but it HAS dropped out since load
              red     failing right now
            It doubles as the unlock target when the board is locked:
            press and hold it for two seconds to get the controls back.
            One corner, two jobs, and nothing extra on a public screen. */}
        <div
          className="absolute top-1.5 left-1.5 flex items-center gap-1 select-none"
          onMouseDown={startHold} onMouseUp={cancelHold} onMouseLeave={cancelHold}
          onTouchStart={startHold} onTouchEnd={cancelHold} onTouchCancel={cancelHold}
          onClick={(e) => { if (locked) e.stopPropagation(); }}
          title={locked
            ? 'Press and hold to unlock the controls'
            : (health.level === 'green' ? 'Connected'
               : health.level === 'orange' ? 'Connected - but it dropped out earlier'
               : 'Not reaching the server')}
        >
          <span
            className="block rounded-full"
            style={{
              width: 9, height: 9,
              backgroundColor: health.level === 'green' ? '#22c55e'
                             : health.level === 'orange' ? '#f59e0b' : '#ef4444',
              opacity: health.level === 'green' ? 0.55 : 0.95,
              boxShadow: health.level === 'red' ? '0 0 6px #ef4444' : 'none',
            }}
          />
          {holdProgress > 0 && (
            <span className="text-[10px] font-mono opacity-70">
              {Math.round(holdProgress)}%
            </span>
          )}
        </div>

        <div className="flex items-center min-w-0">
          {/* Operator chrome hides in fullscreen — a customer-facing wall
              board should show branding and orders, not navigation. Exit
              fullscreen (Esc / tablet gesture) to get the controls back. */}
          {/* Customer-facing board: no way off it by accident.

              This was hidden only in fullscreen, so on an iPad in Safari -
              which is how it actually gets used - the arrow sat top-left of
              a screen the public taps, one press from the landing page.
              Now it appears only when the URL carries ?nav=1, which the
              operator can add when setting the tablet up. */}
          {!isFullscreen && showNav && !locked && (
          <button
            onClick={(e) => { e.stopPropagation(); window.location.href = '/'; }}
            className="mr-4 p-2 rounded-full hover:opacity-80 transition flex-shrink-0"
            style={{ backgroundColor: headerChip, color: onHeader }}
            title="Back to home"
          >
            <ArrowLeft size={24} />
          </button>
          )}
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
            {/* Station name nearly title-sized (Steve: "much larger, only
                slightly smaller than Treenet 2026") — it's the thing a
                customer across the room reads to know WHICH queue this
                board is. The custom message stays small below it. */}
            <div className={`${isPortrait ? 'text-2xl' : 'text-3xl'} font-bold flex items-center mt-1 leading-tight truncate`}>
              <MapPin size={isPortrait ? 22 : 26} className="mr-2 flex-shrink-0" />
              {currentStation
                ? `${currentStation.name}${currentStation.location ? ` · ${currentStation.location}` : ''}`
                : 'Loading station…'}
            </div>
            {/* The old "Live · refreshes every 8s" was implementation
                detail customers don't need (Steve). The operator's
                Custom Message lives here instead — guaranteed visible
                even when the sponsor line owns the footer. */}
            {config.custom_message && (
              <div className="text-sm md:text-base mt-1 truncate" style={{ color: onHeaderDim }}>
                {config.custom_message}
              </div>
            )}
          </div>
        </div>
        {/* Scan-to-order QR, dead centre and OVERHANGING the header.
            Built to Steve's mockup: "might also be nice if could be
            larger QR code that is dead centre and may slight drop down
            part of the blue banner bar overlaying slightly the centre of
            the orange brewing and the green ready making the QR code
            larger with out increasing the top bar size".

            That last clause is the whole trick. The QR is absolutely
            positioned and hangs BELOW the band, so it grows into the gap
            between the Brewing and Ready columns instead of pushing the
            header down. The bar stays the same height and the code gets
            about half again as big.

            It sits on the column boundary on purpose: that is the one
            vertical strip of the board where no order card ever renders,
            so nothing is covered up.

            Stays up in fullscreen, unlike the operator chrome, and is
            generated by /api/qr on our own origin because the external QR
            service fails on venue wifi. */}
        {orderQrUrl && !isPortrait && (
          <div
            className="absolute left-1/2 -translate-x-1/2 top-0 z-30 flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* The header colour carried DOWN around the code, so the band
                reads as one ribbon that dips and comes back rather than a
                white square dropped on the join (Steve: "the blue to wrap
                around the QR code to make it more of a ribbon that sort of
                changes shape a bit and then comes back").

                Drawn as a backing panel behind the code, same colour as
                the header, with only the BOTTOM corners rounded -- the top
                stays square so it melts into the band above it with no
                seam. */}
            {/* Shadow thrown straight DOWN, not the default all-round
                one. The ribbon hangs in front of the board, so the light
                should read as coming from above and the shadow should
                land on the orange and green headers it overlaps -- that
                is what sells it as one layer in front of another rather
                than a shape pasted into a gap. Zero horizontal offset
                keeps it honest: the ribbon is directly above them, so
                the shadow has no reason to lean. */}
            <div className="px-3 pt-2 pb-3 rounded-b-3xl"
                 style={{ backgroundColor: headerColor,
                          boxShadow: '0 14px 20px -6px rgba(31,42,55,0.55)' }}>
              <div className="bg-white rounded-xl p-2 shadow-lg">
              <img
                // `size` is the endpoint's module size, not pixel width;
                // the CSS below decides how big it actually draws.
                src={`/api/qr?size=10&data=${encodeURIComponent(orderQrUrl)}`}
                alt="Scan to order"
                className="w-44 h-44"
                // A QR that fails to load should leave a clean header,
                // not a broken-image box on a customer-facing board.
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              </div>
              <div className="text-center text-xs font-bold mt-1.5"
                   style={{ color: onHeaderDim }}>
                Order from your phone
              </div>
            </div>
          </div>
        )}

        {/* Portrait has no column boundary to hang over -- one tall
            column means an overhanging QR would sit on top of order
            cards. Keep the older inline treatment there. */}
        {orderQrUrl && isPortrait && (
          <div className="flex items-center gap-3 flex-shrink-0 mr-2"
               onClick={(e) => e.stopPropagation()}>
            <div className="text-right leading-tight hidden md:block">
              <div className="text-lg font-bold">Order from</div>
              <div className="text-lg font-bold">your phone</div>
              <div className="text-xs" style={{ color: onHeaderDim }}>scan me</div>
            </div>
            <div className="bg-white rounded-xl p-1.5 shadow-sm">
              <img
                src={`/api/qr?size=8&data=${encodeURIComponent(orderQrUrl)}`}
                alt="Scan to order"
                className="w-20 h-20"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            </div>
          </div>
        )}

        {/* A reserved gutter the width of the QR.
            The QR is absolutely positioned, so it takes no space in the
            flex row and everything else lays out straight underneath it
            -- which put the SMS number behind the code. Steve's own
            mockup shows the same clash ("Or... you..." disappearing
            under it). This spacer is what keeps the middle of the bar
            clear so the overhanging code covers nothing. */}
        {/* Exactly the ribbon's own width (184px), not a rounded-up
            guess. Any slack between the gutter and the ribbon lands
            entirely in the first gap -- a 224px gutter around a 184px
            ribbon pushed the QR-to-number gap to 76px while the other
            two sat at 40. Matching them makes justify-evenly's three
            gaps actually equal on screen. */}
        {orderQrUrl && !isPortrait && (
          <div className="w-[216px] flex-shrink-0" aria-hidden />
        )}

        {/* Right cell: SMS number, ordering button and operator chrome in
            ONE group, so the grid right-aligns them together. Steve's
            mockup puts ordering across the top: "instead of dropdown
            menus and settings this could be onscreen order, and SMS
            number all across the top bar". The footer copies remain for
            portrait and for non-touch screens. */}
        {/* Evenly spaced, not bunched at the right edge. Steve: "text
            message number and order here button and qr code should all be
            equally spaced apart". justify-evenly gives equal space
            BETWEEN and AROUND its children, so the run from the QR's edge
            to the right margin divides into three equal gaps: QR to
            number, number to button, button to edge. justify-end put both
            hard right with all the air on the QR side. */}
        <div className="flex items-center justify-evenly min-w-0">
        {!isPortrait && (
          <div className="flex flex-1 items-center justify-evenly min-w-0"
               onClick={(e) => e.stopPropagation()}>
            {config.sms_number && (
              <div className="text-right leading-tight flex-shrink-0">
                {/* The one place a brand accent reads without competing
                    with order information: a small label nobody needs to
                    read from across the room. */}
                {/* "Or SMS" rather than "Or text": on a board where the
                    other options are a QR and a touchscreen, SMS names
                    the METHOD, while "text" reads as a verb and gets
                    skimmed past. */}
                <div className="text-sm font-bold uppercase tracking-widest"
                     style={{ color: onHeaderDim }}>
                  Or SMS
                </div>
                {/* Never wrap a phone number. Letting it compress stacked
                    it as "0489 / 263 / 333", which reads as three numbers
                    rather than one. If the bar is genuinely too narrow the
                    right thing is to lose the label, not to fold the
                    digits. */}
                {/* Measured against the event name: that sits at 48px and
                    this was at 24, exactly half, which made the one
                    number a customer has to READ AND TYPE the smallest
                    thing on the bar.

                    Sized to the VIEWPORT rather than fixed. At 40px the
                    number plus the button needed 476px of a 492px cell on
                    a 1280 board -- no gap left, and "Order here" wrapped
                    onto two lines. Event screens are usually 1920, where
                    40px fits comfortably, so the big size is kept for
                    wide boards and a smaller one used below that.
                    whitespace-nowrap on the button because a wrapped
                    call-to-action reads as a mistake at any size. */}
                <div className="text-[32px] 2xl:text-[40px] leading-none font-extrabold tracking-wide whitespace-nowrap">
                  {formatSmsNumber(config.sms_number)}
                </div>
              </div>
            )}
            {kioskEnabled && config.display_touch_ordering !== false && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowKiosk(true); }}
                className="flex items-center gap-3 rounded-2xl px-5 2xl:px-7 py-3 2xl:py-4 text-2xl 2xl:text-3xl font-extrabold shadow-md hover:opacity-90 active:scale-95 bg-white whitespace-nowrap"
                style={{ color: headerColor }}
              >
                <span className="text-3xl" aria-hidden>👆</span> Order here
              </button>
            )}
          </div>
        )}

        {/* Operator chrome, OUT of the flow. It is setup-only -- a live
            board runs fullscreen and never shows it -- but while it sat
            in the row it took a share of the space and pushed the SMS
            number and the ordering button out of even spacing. Absolute
            positioning lets those two own the right-hand run, and the
            chrome overlaps only on a screen nobody is serving from. */}
        {!isFullscreen && (
        <div className="flex items-center gap-2 flex-shrink-0 absolute right-2 bottom-1 z-40">
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
            onClick={(e) => { e.stopPropagation(); toggleAnnouncements(); }}
            className="p-2 rounded-full hover:opacity-80"
            style={{ backgroundColor: announceOn ? '#16a34a' : headerChip,
                     color: announceOn ? '#ffffff' : onHeader }}
            title={announceOn
              ? 'Voice announcements ON - tap to mute'
              : 'Read new READY orders aloud through this screen (tap to enable - you should hear a confirmation)'}
          >
            {announceOn ? <Volume2 size={24} /> : <VolumeX size={24} />}
          </button>
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
        )}
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
      {/* min-h-0 on <main>: a flex child defaults to min-height:auto, so it
          refuses to shrink below its content and pushes the footer off the
          bottom instead of letting the board compress. */}
      {isPickupMode ? (
        <main className="flex-grow min-h-0 px-6 md:px-10 pb-6 overflow-hidden">
          <Column
            kind="ready"
            boardOpts={boardOpts}
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
        // The overhanging QR needs a lane to drop into. With the normal
        // gap the code sat over the Ready column's tick and its count
        // (Steve: "not sitting over the top of the tick for the ready for
        // pickup or the zero"). Widening only the landscape two-column
        // gap gives it clear air without costing card width anywhere else.
        ? `flex-grow flex ${qrGap} px-6 md:px-10 pt-6 pb-6 ${isPortrait ? 'flex-col justify-start' : 'flex-row items-start'}`
        : `flex-grow grid ${qrGap} px-6 md:px-10 pb-6 ${isPortrait
            ? 'grid-cols-1 grid-rows-2'
            : (showCompleted ? 'grid-cols-2' : 'grid-cols-1')}`}>

        {/* In portrait we put Ready first (more important to
            customers waiting). In landscape we keep the natural
            left-to-right flow. */}
        {isPortrait && showCompleted && (
          <Column
            kind="ready"
            boardOpts={boardOpts}
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
          boardOpts={boardOpts}
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
            boardOpts={boardOpts}
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
          {/* Touchscreen displays get the tap-to-order kiosk button (the
              finger says "this screen is touchable"). Non-touch screens
              (wall TVs) promote SMS as the PRIMARY way to order instead —
              a button nobody can press is just confusing. */}
          {/* Landscape moves this into the top bar, so showing it here
              too would put two "Order here" buttons on one screen -- a
              customer-facing board is the wrong place to make someone
              choose between identical buttons. Portrait keeps it here,
              because a single tall column has no room in the header. */}
          {kioskEnabled && config.display_touch_ordering !== false && isPortrait && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowKiosk(true); }}
              className="flex items-center gap-3 rounded-2xl px-7 py-4 text-2xl font-extrabold shadow-md hover:opacity-90 active:scale-95"
              style={{ backgroundColor: headerColor, color: onHeader }}
            >
              <span className="text-3xl" aria-hidden>👆</span> Order here
            </button>
          )}
          {/* Only advertise SMS ordering when a number is actually configured. */}
          {config.sms_number && !(isPortrait === false && kioskEnabled) && (
            (kioskEnabled && config.display_touch_ordering !== false) ? (
              <div className="flex items-center min-w-0 rounded-2xl px-5 py-3 shadow-sm bg-white/90 text-gray-800">
                <MessageCircle size={26} className="mr-3 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-bold uppercase tracking-wide text-gray-500">
                    Or order by SMS
                  </div>
                  <div className="text-xl font-extrabold tracking-wide truncate">
                    {formatSmsNumber(config.sms_number)}
                  </div>
                </div>
              </div>
            ) : (
              /* SMS-first CTA for non-touch screens. */
              <div className="flex items-center min-w-0 rounded-2xl px-7 py-4 shadow-md"
                   style={{ backgroundColor: headerColor, color: onHeader }}>
                <MessageCircle size={32} className="mr-4 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-2xl font-extrabold tracking-wide truncate">
                    Order by SMS: {formatSmsNumber(config.sms_number)}
                  </div>
                  <div className="text-sm font-semibold opacity-90">
                    Text your order — we'll text you when it's ready
                  </div>
                </div>
              </div>
            )
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
                  showCustomerName, showDetails, newReadyMap, hasBg,
                  boardOpts = {} }) => {
  const isReady = kind === 'ready';
  // Auto page-flip: a wall display can't be scrolled. The first version
  // used a FIXED guess (6 per page in landscape), so 5 tall cards
  // counted as "one page" while only ~3 actually fit — the rest were
  // cut off and nothing flipped (Steve's board). Now we MEASURE: real
  // card height vs the column's real available height decides the page
  // size, re-measured on resize and whenever the queue changes.
  const bodyRef = useRef(null);
  const [measuredFit, setMeasuredFit] = useState(null);
  const [availableH, setAvailableH] = useState(null);
  const [cardH, setCardH] = useState(null);
  useEffect(() => {
    const measure = () => {
      const el = bodyRef.current;
      if (!el) return;
      const card = el.querySelector('[data-kcard]');
      if (!card || !card.offsetHeight) return;
      const gap = 24; // grid gap-6
      // Available height: with a background image the panel hugs content
      // up to a viewport cap, so derive from the viewport (stable — the
      // panel's own height shrinks with its content and would feed back).
      // Without a background the grid row fixes the column height.
      const headerAndPadding = 96;
      const available = hasBg
        ? window.innerHeight * (isPortrait ? 0.42 : 0.78) - headerAndPadding
        : el.clientHeight - 8;
      const pagerReserve = 44; // dots + "x–y of z" row
      // NOTE: offsetHeight is a layout value — unaffected by the CSS
      // `zoom` we may apply below, so this can't feed back on itself.
      const n = Math.floor((available - pagerReserve + gap) / (card.offsetHeight + gap));
      setMeasuredFit(Math.max(1, n));
      setAvailableH(available);
      setCardH(card.offsetHeight);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [orders.length, isPortrait, hasBg]);

  // Operator board controls (barista Display tab). cardsPerPage 3..8
  // forces N per page and SCALES the cards down to fit; 0 = auto.
  const flipSeconds = boardOpts.flipSeconds > 0 ? boardOpts.flipSeconds : 10;
  const forcedN = boardOpts.cardsPerPage || 0;
  const scrollMode = boardOpts.overflowMode === 'scroll';

  const pageSize = forcedN >= 3 ? forcedN : (measuredFit ?? (isPortrait ? 3 : 4));
  // Card scale for forced N: shrink until N cards + pager fit the
  // available height. Never below 40% (unreadable) or above 100%.
  let cardScale = 1;
  if (forcedN >= 3 && availableH && cardH) {
    const gap = 24;
    const needed = forcedN * cardH + (forcedN - 1) * gap + 44;
    cardScale = Math.max(0.4, Math.min(1, (availableH) / needed));
  }
  const pageCount = Math.max(1, Math.ceil(orders.length / pageSize));
  // WALL-CLOCK synchronised flipping: page and countdown derive from
  // Date.now() rather than a per-column timer, so Brewing and Ready —
  // and every display screen in the venue — flip at the same instant
  // with no shared state (Steve: "if both are spinning they do it in
  // sync").
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (pageCount <= 1 || scrollMode) return undefined;
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 250);
    return () => clearInterval(t);
  }, [pageCount, scrollMode]);
  const safePage = pageCount <= 1 ? 0
    : Math.floor(nowSec / flipSeconds) % pageCount;
  const countdown = flipSeconds - (nowSec % flipSeconds);
  // Y-axis spin on page change: the whole panel turns edge-on (the
  // background branding shows through for a few frames) and comes back
  // with the next page. spinTick keys the <section> so the CSS
  // animation retriggers per flip — and 0 means "first load, no spin".
  const prevPageRef = useRef(safePage);
  const [spinTick, setSpinTick] = useState(0);
  useEffect(() => {
    if (prevPageRef.current !== safePage) {
      prevPageRef.current = safePage;
      setSpinTick(t => t + 1);
    }
  }, [safePage]);
  const visibleOrders = orders.slice(safePage * pageSize, safePage * pageSize + pageSize);
  // Continuous-scroll mode: when overflowing, loop the FULL list in a
  // slow marquee (list rendered twice for a seamless wrap).
  const scrolling = scrollMode && orders.length > pageSize;
  const scrollDurationS = Math.max(12, orders.length * 4);
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
    /* Full 360° turn in one direction, but as a pane of GLASS rather
       than a vanishing paper card: a frosted translucent BACK face is
       what you see from 90° to 270°, so the panel keeps physical
       presence mid-turn while the background branding still shows
       through it (Steve: total disappearance was "a bit jarring"). */
    <div key={spinTick}
         className={hasBg ? (isPortrait ? 'w-full' : 'flex-1 min-w-0') : 'h-full'}
         style={{ perspective: '1600px' }}>
      <style>{`@keyframes displayPanelSpin {
        0%   { transform: rotateY(0deg); }
        100% { transform: rotateY(360deg); }
      }`}</style>
      <div className="relative h-full"
           style={{ transformStyle: 'preserve-3d',
                    animation: spinTick > 0 ? 'displayPanelSpin 1.4s ease-in-out' : 'none' }}>
        {/* Frosted back face (pre-rotated 180°): visible only while the
            panel is turned away. */}
        <div className="absolute inset-0 rounded-3xl"
             style={{ transform: 'rotateY(180deg)',
                      backfaceVisibility: 'hidden',
                      background: 'rgba(255,255,255,0.35)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                      border: '1px solid rgba(255,255,255,0.55)' }} />
    <section
      className={`rounded-3xl overflow-hidden flex flex-col ${theme.panel} shadow-xl h-full
                        ${hasBg ? (isPortrait ? 'w-full max-h-[42vh]' : 'w-full max-h-[78vh]') : ''}`}
      style={{ backfaceVisibility: 'hidden' }}>
      {/* Title centred, count pinned right. Centring with justify-between
          is not possible with two children of different widths -- the
          title would sit wherever the count's width left it. Absolute
          positioning for the count takes it out of the flow entirely, so
          the title centres against the FULL header width and stays put
          whether the count reads 0 or 18. */}
      <header className={`${headerCls} px-6 py-4 flex items-center justify-center relative flex-shrink-0`}>
        <div className="flex items-center">
          {icon}
          <h2 className="text-2xl md:text-3xl font-bold">{title}</h2>
        </div>
        {/* Count on the OUTER edge of each column. The ribbon now overlaps
            the inner edges, and with the title centred the count was the
            only thing living there -- on the left-hand column it sat
            directly under the QR. Pushing each count outwards keeps both
            readable whatever the ribbon covers. */}
        <div className={`absolute text-lg font-bold opacity-90 ${
          isReady ? 'right-6' : 'left-6'}`}>{orders.length}</div>
      </header>
      <div ref={bodyRef}
           className={hasBg ? 'px-4 py-3 overflow-hidden' : 'p-4 md:p-6 flex-grow overflow-hidden'}>
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
        ) : scrolling ? (
          /* Continuous-scroll loop (operator option): the FULL list
             glides upward in a slow marquee, rendered twice for a
             seamless wrap. No pager, no countdown. */
          <div className="overflow-hidden"
               style={{ maxHeight: availableH ? `${availableH}px` : undefined }}>
            <style>{`@keyframes displayScrollLoop {
              from { transform: translateY(0); }
              to   { transform: translateY(-50%); }
            }`}</style>
            <div className="grid grid-cols-1 gap-4 md:gap-6"
                 style={{ animation: `displayScrollLoop ${scrollDurationS}s linear infinite`,
                          zoom: cardScale }}>
              {[0, 1].map(copy => orders.map(o => (
                <div key={`${copy}-${o.id}`} data-kcard>
                  <OrderCard
                    order={o}
                    variant={isReady ? 'ready' : 'brewing'}
                    fonts={fonts}
                    theme={theme}
                    showCustomerName={showCustomerName}
                    showDetails={showDetails}
                    isNew={copy === 0 && isReady && newReadyMap.has(String(o.id))}
                  />
                </div>
              )))}
            </div>
          </div>
        ) : (
          /* Content swap only — the page-change animation is the panel's
             Y-axis spin on <section>, so no inner fade here. */
          <div className="grid grid-cols-1 gap-4 md:gap-6" key={safePage}
               style={{ zoom: cardScale }}>
            {visibleOrders.map(o => (
              <div key={o.id} data-kcard>
                <OrderCard
                  order={o}
                  variant={isReady ? 'ready' : 'brewing'}
                  fonts={fonts}
                  theme={theme}
                  showCustomerName={showCustomerName}
                  showDetails={showDetails}
                  isNew={isReady && newReadyMap.has(String(o.id))}
                />
              </div>
            ))}
            {pageCount > 1 && (
              <div className={`flex items-center justify-center gap-2 pt-1 ${theme.subtext}`}>
                {Array.from({ length: pageCount }).map((_, i) => (
                  <span key={i}
                        className={`inline-block w-2.5 h-2.5 rounded-full ${i === safePage ? (isReady ? 'bg-green-500' : 'bg-amber-500') : 'bg-gray-300'}`} />
                ))}
                <span className="ml-2 text-sm">
                  {safePage * pageSize + 1}–{Math.min(orders.length, (safePage + 1) * pageSize)} of {orders.length}
                </span>
                <span className="ml-2 text-sm font-semibold">
                  · more orders in {countdown}s
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
      </div>
    </div>
  );
};

const Empty = ({ theme, text, pulse }) => (
  <div className={`h-full min-h-[200px] flex flex-col items-center justify-center ${theme.subtext}`}>
    <Coffee size={64} className={`mb-4 opacity-40 ${pulse ? 'animate-pulse' : ''}`} />
    <p className="text-xl">{text}</p>
  </div>
);

export default DisplayScreen;
