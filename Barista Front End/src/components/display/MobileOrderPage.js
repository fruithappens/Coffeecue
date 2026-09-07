// MobileOrderPage.js — "scan the QR, order from your own phone".
//
// The no-SIM / no-cell-data answer (Steve): a guest on venue WiFi points
// their camera at a QR, this page opens in their browser, they tap out
// an order. NO message is sent anywhere — it's a web page, so it needs
// no SIM, no data plan, no app, no account.
//
// The notification problem is solved WITHOUT SMS too: after ordering,
// this page becomes a live status card that polls /api/orders/<n>/track
// — "You're #3" -> "Being made" -> "READY - collect from Station 1".
// They keep the tab open (or re-scan later; the number is in the URL).
// A phone number remains OPTIONAL for anyone who does want the text.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import CancelOrderButton from './CancelOrderButton';
import BaristaAskCard from './BaristaAskCard';
import { remember, recall, forget } from '../../utils/deviceMemory';
import { useSearchParams, Navigate } from 'react-router-dom';
import useReadyChime, { SoundToggleButton } from './useReadyChime';
import SponsorTicker from './SponsorTicker';
import { event as logEvent } from '../../services/logging';
import { CUSTOMER_STATUS } from '../../constants/customerStatus';

// Customer-facing status words live in ONE place (constants/customerStatus).
const STATUS_COPY = CUSTOMER_STATUS;

// Embedded in the EventsAir app's webview, or a standalone phone browser?
// (A cross-origin frame throws on window.top.) The status beacon is what a
// QR / receipt scan lands on, so its bottom must clear the phone browser's
// toolbar (standalone) or the app's nav bar (embedded) on top of the
// device safe-area inset — otherwise "Collect from Station X" is cut off.
const IS_EMBEDDED = (() => {
  try { return window.self !== window.top; } catch (e) { return true; }
})();
const BEACON_PAD_BOTTOM = IS_EMBEDDED
  ? 'calc(env(safe-area-inset-bottom) + 11rem)'
  : 'calc(env(safe-area-inset-bottom) + 2rem)';

const MobileOrderPage = () => {
  const [params, setParams] = useSearchParams();
  const stationId = params.get('station');
  const trackNumber = params.get('order');
  useEffect(() => {
    // Refresh the device's memory of ITS OWN live order (written at
    // placement) so a long wait doesn't age it out. Only when it
    // matches: scanning a friend's share-QR must not hijack this
    // device's beacon.
    if (!trackNumber) return;
    try {
      const raw = recall('cupq_active_order');
      if (raw && String((JSON.parse(raw) || {}).n) === String(trackNumber)) {
        remember('cupq_active_order',
          JSON.stringify({ n: trackNumber, at: Date.now() }), 3 * 3600);
      }
    } catch (er) { /* private mode */ }
  }, [trackNumber]);
  const [track, setTrack] = useState(null);
  const [gone, setGone] = useState(false);
  // Heartbeat, same as /my's identified card: proof the beacon is
  // actually talking to the server, and honest when it is not. The
  // counter resets only when the server answered.
  const [lastOkAt, setLastOkAt] = useState(null);
  const [connected, setConnected] = useState(true);
  const [, setTick] = useState(0);
  const [collecting, setCollecting] = useState(false);
  const [collected, setCollected] = useState(false);
  // Same chime and same button as /my. A customer who scanned the kiosk
  // QR is watching exactly the same wait and deserves the same warning.
  const { soundOn, toggleSound, playChime, audioState } = useReadyChime();
  const prevTrackStatus = useRef(null);

  // Sponsor ticker on the phone beacon, same strip as the display and /my.
  // Steve: this is the page most people watch, and the sponsors never
  // appeared on it. Fetched once; hidden until the operator adds logos.
  const [sponsorTicker, setSponsorTicker] = useState({ enabled: false, size: 'small', sponsors: [] });
  useEffect(() => {
    if (!trackNumber) return undefined;
    let dead = false;
    (async () => {
      try {
        const r = await fetch('/api/sponsors', { cache: 'no-cache' });
        const b = r.ok ? await r.json() : null;
        if (!dead && b && b.success) {
          setSponsorTicker({ enabled: !!b.enabled, size: 'small', sponsors: Array.isArray(b.sponsors) ? b.sponsors : [] });
        }
      } catch (e) { /* no ticker */ }
    })();
    return () => { dead = true; };
  }, [trackNumber]);
  const tickerOn = sponsorTicker.enabled && sponsorTicker.sponsors.length > 0;

  // Fit the whole card column to THIS phone's screen. Steve: the beacon
  // should scale to each phone so most of it, and the buttons under the
  // coloured card, are visible without scrolling. Measured after render:
  // if the column is taller than the space above the ticker/nav, zoom it
  // down (never below 0.7, never up). CSS zoom reflows, so nothing clips.
  const colRef = useRef(null);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    if (!trackNumber) return undefined;
    const measure = () => {
      const el = colRef.current;
      if (!el) return;
      const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
      const reserve = (tickerOn ? 84 : 0) + (IS_EMBEDDED ? 176 : 40) + 24;
      const natural = el.scrollHeight / (fit || 1);
      const next = Math.max(0.7, Math.min(1, (vh - reserve) / Math.max(1, natural)));
      if (Math.abs(next - fit) > 0.02) setFit(next);
    };
    const t = setTimeout(measure, 50);
    window.addEventListener('resize', measure);
    return () => { clearTimeout(t); window.removeEventListener('resize', measure); };
  }, [trackNumber, tickerOn, track?.status, collected, gone, fit]);

  useEffect(() => {
    const status = track?.status;
    const num = track?.order_number;
    const memKey = num ? `coffee_my_last_status_${num}` : null;
    let was = prevTrackStatus.current;
    if (!was && memKey) {
      try { was = sessionStorage.getItem(memKey) || null; } catch (e) { /* private mode */ }
    }
    prevTrackStatus.current = status;
    if (memKey && status) {
      try { sessionStorage.setItem(memKey, status); } catch (e) { /* private mode */ }
    }
    // Only on the change INTO ready, never on a poll that finds it still
    // ready. `was` falls back to sessionStorage so a phone that slept
    // through the moment still gets told.
    if (!was || was === status || status !== 'completed') return;
    if (soundOn) playChime(track?.beacon_sound);
    // Vibration is NOT gated on the toggle: it is private, does not
    // carry across a room, and reaches a phone lying face-down.
    try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (e) { /* fine */ }
  }, [track?.status, track?.order_number, soundOn, playChime]);

  // Poll this order's public status. No auth, no personal data — just
  // status, queue position and where to collect.
  const poll = useCallback(async () => {
    if (!trackNumber) return;
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(trackNumber)}/track`);
      setLastOkAt(Date.now());
      setConnected(true);
      if (r.status === 404) {
        setGone(true);
        // An order the server no longer knows must not keep pulling the
        // device back here -- forget it so /my offers ordering again.
        try {
          const raw = recall('cupq_active_order');
          if (raw && String((JSON.parse(raw) || {}).n) === String(trackNumber)) {
            forget('cupq_active_order');
          }
        } catch (er) { /* nothing remembered */ }
        return;
      }
      const b = await r.json();
      if (b?.success) {
        setTrack(b);
        setGone(false);
        // Survives a reload: if the barista marked it collected, or this
        // phone did before the page was refreshed, show it as done.
        if (b.status === 'picked_up' || b.status === 'picked-up'
            || b.status === 'cancelled') {
          setCollected(true);
          // The device stops remembering a FINISHED order -- otherwise
          // closing and reopening the app would restore a beacon for a
          // coffee already in hand (the restore lives in MyCoffeePage).
          try {
            const raw = recall('cupq_active_order');
            if (raw && String((JSON.parse(raw) || {}).n) === String(trackNumber)) {
              forget('cupq_active_order');
            }
          } catch (er) { /* nothing remembered, nothing to clear */ }
        }
      }
    } catch (e) {
      // Keep the last known order state, but say the line went quiet --
      // a stale card must not look exactly like a working one.
      setConnected(false);
    }
  }, [trackNumber]);

  useEffect(() => {
    if (!trackNumber) return;
    poll();
    const t = setInterval(poll, 8000);
    return () => clearInterval(t);
  }, [trackNumber, poll]);

  // Drives the "checked 12s ago" counter. Only while the order is still
  // in flight -- a once-a-second render on a finished page is a battery
  // cost for nothing.
  useEffect(() => {
    if (!trackNumber || collected || gone) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [trackNumber, collected, gone]);

  // Keep the screen awake while they watch for READY (best effort —
  // unsupported browsers just ignore it).
  useEffect(() => {
    let lock = null;
    (async () => {
      try {
        if (trackNumber && navigator.wakeLock) {
          lock = await navigator.wakeLock.request('screen');
        }
      } catch (e) { /* fine */ }
    })();
    return () => { try { lock && lock.release(); } catch (e) { /* noop */ } };
  }, [trackNumber]);

  if (trackNumber) {
    const copy = STATUS_COPY[track?.status] || { title: 'Checking…', tone: 'bg-gray-400' };
    const ready = track?.status === 'completed';
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center p-6"
           style={{ minHeight: '100dvh',
                    paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
                    // Room for the sponsor strip when it is on.
                    paddingBottom: tickerOn ? `calc(${BEACON_PAD_BOTTOM} + 84px)` : BEACON_PAD_BOTTOM }}>
        <div className="w-full max-w-md" ref={colRef} style={fit !== 1 ? { zoom: fit } : undefined}>
          {/* Incident notice. Above the order card on purpose: if the
              system is in trouble, that outranks the queue position the
              customer came here to read.
              The server only sends this to orders that are actually
              affected -- a printed order is already on a label and will
              be made, so its watcher is deliberately left alone rather
              than sent to re-confirm and create a duplicate. */}
          {track?.notice && (
            <div className="mb-4 rounded-2xl bg-amber-100 border-2 border-amber-500 p-4 text-amber-950">
              <div className="font-extrabold text-lg mb-1">Please read</div>
              <div className="text-base leading-snug">{track.notice}</div>
            </div>
          )}
          {/* The barista's question for this order (out-of-oat etc.) --
              answerable right here, tap or type. */}
          {!collected && (
            <div className="mb-4">
              <BaristaAskCard orderNumber={trackNumber} ask={track?.barista_ask || null} />
            </div>
          )}
          <div className={`${copy.tone} text-white rounded-2xl p-6 text-center shadow-lg
                           ${ready ? 'animate-pulse' : ''}`}>
            <div className="text-sm uppercase tracking-wide opacity-90">Your order</div>
            <div className="font-extrabold my-2"
                 style={{ fontSize: 'clamp(2.5rem, 13vw, 3.75rem)', lineHeight: 1.05 }}>#{trackNumber}</div>
            <div className="text-2xl font-bold">{copy.title}</div>
            {track?.status === 'pending' && track?.position > 0 && (
              <div className="mt-2 text-lg">You're #{track.position} in line</div>
            )}
            {/* The estimate. Deliberately soft wording -- the server
                rounds up and never counts past zero, and "about" carries
                that honesty into the sentence a person actually reads. */}
            {!ready && track?.eta_text && (
              <div className="mt-1 text-lg opacity-95">
                Ready in {track.eta_text}
              </div>
            )}
            {/* WHERE, from the first moment -- not only once it's
                ready. A delegate wants to drift toward the right room
                (Steve: the beacon "does not say which station to
                collect from"). */}
            {(track?.station_name || track?.collection_note) && (
              <div className={ready ? 'mt-3 text-xl font-semibold' : 'mt-2 text-base opacity-95'}>
                {track?.collection_note
                  ? `Collect from ${track.collection_note}`
                  : `Collect from ${track.station_name}${track?.station_location ? ` · ${track.station_location}` : ''}`}
              </div>
            )}
          </div>
          {/* Collected, from the customer's own phone: one less press for
              the barista on the busiest surface they have. Only offered
              when the coffee is actually ready -- the server refuses it
              otherwise, so a mis-tap cannot clear a card still on the
              bench. */}
          {ready && !collected && (
            <button
              className="w-full mt-4 py-4 rounded-xl bg-green-600 text-white text-xl font-bold shadow disabled:opacity-60"
              disabled={collecting}
              onClick={async () => {
                setCollecting(true);
                try {
                  const r = await fetch(
                    `/api/orders/${encodeURIComponent(trackNumber)}/collected`,
                    { method: 'POST' });
                  const b = await r.json().catch(() => ({}));
                  if (b?.success) { setCollected(true); poll(); }
                } catch (e) {
                  // Conference wifi. Leave the button up so they can
                  // try again; the barista can still mark it either way.
                } finally {
                  setCollecting(false);
                }
              }}
            >
              {collecting ? 'One moment…' : "Got it, thanks"}
            </button>
          )}
          {collected && (
            <div className={`mt-4 text-center font-semibold text-lg ${
              track?.status === 'cancelled' ? 'text-gray-600' : 'text-green-700'}`}>
              {track?.status === 'cancelled'
                ? 'This order was cancelled.'
                : 'Enjoy your coffee.'}
            </div>
          )}
          {/* The WHOLE order, so someone can see their almond milk and
              their size arrived -- not just the word "hot chocolate".
              Falls back to the short name on an older server that does
              not send the long one. */}
          {(track?.drink_full || track?.drink) && (
            <div className="text-center text-gray-700 mt-3 text-lg">
              {track.first_name && (
                <span className="font-semibold">{track.first_name} · </span>
              )}
              {track.drink_full || track.drink}
            </div>
          )}
          {/* The sound button, which this page did not have. */}
          {!gone && !ready && (
            <SoundToggleButton soundOn={soundOn} audioState={audioState} className="mt-4"
              onToggle={() => { try { logEvent('BEACON_SOUND', { on: !soundOn, order: trackNumber }); } catch (e) { /* log only */ } toggleSound(); }} />
          )}
          {gone && (
            <div className="mt-3 text-center text-gray-500">
              We can't find that order number.
            </div>
          )}
          {/* Share it. Steve: "a friend could use their phone to scan it so
              they don't have to type a link or get close to a display
              counter". Someone standing next to you scans this off your
              screen and watches the same order -- no typing, no queueing
              at the kiosk to find out how long.
              Collapsed by default: the person holding the phone already
              has the order, so this is for the occasion when a friend
              asks, not something to put in front of them every time. */}
          {!collected && (
            <details className="mt-6">
              <summary className="text-center text-gray-500 text-sm cursor-pointer select-none">
                Show a code for a friend to scan
              </summary>
              <div className="flex flex-col items-center mt-3">
                <img
                  src={`/api/qr?size=7&data=${encodeURIComponent(
                    `${window.location.origin}/order?order=${trackNumber}`)}`}
                  alt={`Order ${trackNumber}`}
                  className="w-44 h-44 bg-white rounded-lg p-2 shadow"
                />
                <p className="text-xs text-gray-500 mt-2">
                  They will see this order's progress too.
                </p>
              </div>
            </details>
          )}

          {!collected && !gone && (() => {
            const staleSeconds = lastOkAt
              ? Math.max(0, Math.round((Date.now() - lastOkAt) / 1000))
              : 99;
            const worried = !connected || staleSeconds > 30;
            return (
              <div className="mt-6 flex items-center justify-center gap-2 text-sm">
                <span className={`inline-block w-2 h-2 rounded-full
                                  ${worried
                                    ? 'bg-amber-500'
                                    : 'bg-green-500 motion-safe:animate-pulse'}`} />
                <span className={worried ? 'text-amber-700' : 'text-gray-500'}>
                  {!connected
                    ? 'Not connected — trying again'
                    : staleSeconds > 30
                      ? `Last checked ${staleSeconds}s ago — reconnecting`
                      : staleSeconds <= 1
                        ? 'Checking now'
                        : `Checked ${staleSeconds}s ago`}
                </span>
              </div>
            );
          })()}
          <p className="text-center text-gray-500 text-sm mt-2">
            Keep this page open — it updates by itself. No text message needed.
          </p>
          <button
            className="block mx-auto mt-2 text-sm text-gray-500 underline"
            onClick={() => {
              try {
                const raw = recall('cupq_active_order');
                if (raw && String((JSON.parse(raw) || {}).n) === String(trackNumber)) {
                  forget('cupq_active_order');
                }
              } catch (er) { /* nothing remembered */ }
              window.location.href = '/my?find=1';
            }}
          >
            Wrong order? Search again
          </button>
          {/* Cancel — only while still queued (server refuses once it's
              being made). */}
          <CancelOrderButton orderNumber={trackNumber} status={track?.status}
            onCancelled={() => {
              try {
                const raw = recall('cupq_active_order');
                if (raw && String((JSON.parse(raw) || {}).n) === String(trackNumber)) {
                  forget('cupq_active_order');
                }
              } catch (er) { /* nothing remembered */ }
            }} />
          <button
            className="w-full mt-6 py-3 rounded-xl bg-gray-800 text-white font-semibold"
            onClick={() => { setParams({ ...(stationId ? { station: stationId } : {}) }); setTrack(null); }}
          >
            Order another coffee
          </button>
        </div>
        {/* Sponsor strip, pinned above the phone toolbar / the events-app
            nav so it is seen without scrolling -- the display's ticker,
            on the page people actually watch. */}
        {tickerOn && (
          <div className="fixed left-0 right-0 z-20 shadow-lg"
               style={{ bottom: IS_EMBEDDED ? 'calc(env(safe-area-inset-bottom) + 8.5rem)' : 'env(safe-area-inset-bottom)' }}>
            <SponsorTicker items={sponsorTicker.sponsors} position="bottom" size="small" />
          </div>
        )}
      </div>
    );
  }

  // Event-code gate: a cold visitor is asked for the code once before the
  // ordering flow. A scan/shared link carries ?e= and never sees this.
  // Ordering now lives in ONE place -- /my (and /). This page is only the
  // order-number BEACON above; a bare /order with nothing to track sends the
  // visitor to that single ordering home, preserving any event code / station
  // already in the URL. (The old duplicate ordering flow + its own event-code
  // gate lived here; MyCoffeePage owns ordering and its gate now.)
  return <Navigate to={`/my${window.location.search || ''}`} replace />;
};

export default MobileOrderPage;
