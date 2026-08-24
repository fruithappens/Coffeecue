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
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import KioskOrder from './KioskOrder';

const STATUS_COPY = {
  pending: { title: 'In the queue', tone: 'bg-blue-600' },
  'in-progress': { title: 'Being made now', tone: 'bg-amber-500' },
  completed: { title: 'READY - come and get it', tone: 'bg-green-600' },
  picked_up: { title: 'Collected - enjoy!', tone: 'bg-gray-500' },
  cancelled: { title: 'Cancelled', tone: 'bg-red-600' },
};

const MobileOrderPage = () => {
  const [params, setParams] = useSearchParams();
  const stationId = params.get('station');
  const trackNumber = params.get('order');
  const [track, setTrack] = useState(null);
  const [gone, setGone] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collected, setCollected] = useState(false);

  // Poll this order's public status. No auth, no personal data — just
  // status, queue position and where to collect.
  const poll = useCallback(async () => {
    if (!trackNumber) return;
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(trackNumber)}/track`);
      if (r.status === 404) { setGone(true); return; }
      const b = await r.json();
      if (b?.success) {
        setTrack(b);
        setGone(false);
        // Survives a reload: if the barista marked it collected, or this
        // phone did before the page was refreshed, show it as done.
        if (b.status === 'picked_up' || b.status === 'picked-up') setCollected(true);
      }
    } catch (e) { /* keep the last known state */ }
  }, [trackNumber]);

  useEffect(() => {
    if (!trackNumber) return;
    poll();
    const t = setInterval(poll, 8000);
    return () => clearInterval(t);
  }, [trackNumber, poll]);

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
      <div className="min-h-screen bg-gray-50 flex flex-col items-center p-6">
        <div className="w-full max-w-md">
          <div className={`${copy.tone} text-white rounded-2xl p-6 text-center shadow-lg
                           ${ready ? 'animate-pulse' : ''}`}>
            <div className="text-sm uppercase tracking-wide opacity-90">Your order</div>
            <div className="text-6xl font-extrabold my-2">#{trackNumber}</div>
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
            {ready && (
              <div className="mt-3 text-xl font-semibold">
                {track?.collection_note
                  ? `Collect from ${track.collection_note}`
                  : `Collect from ${track?.station_name || 'the counter'}`}
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
            <div className="mt-4 text-center text-green-700 font-semibold text-lg">
              Enjoy your coffee.
            </div>
          )}
          {track?.drink && (
            <div className="text-center text-gray-600 mt-3 text-lg">
              {track.first_name ? `${track.first_name} · ` : ''}{track.drink}
            </div>
          )}
          {gone && (
            <div className="mt-3 text-center text-gray-500">
              We can't find that order number.
            </div>
          )}
          <p className="text-center text-gray-500 text-sm mt-6">
            Keep this page open — it updates by itself. No text message needed.
          </p>
          <button
            className="w-full mt-6 py-3 rounded-xl bg-gray-800 text-white font-semibold"
            onClick={() => { setParams({ ...(stationId ? { station: stationId } : {}) }); setTrack(null); }}
          >
            Order another coffee
          </button>
        </div>
      </div>
    );
  }

  // Ordering: reuse the kiosk flow verbatim (same steps, same rules,
  // same availability logic) but full-screen on the phone. On success
  // we switch this page into tracking mode via the URL.
  return (
    <div className="min-h-screen bg-white">
      <KioskOrder
        stationId={stationId}
        // This page is reached by scanning a QR on a phone, not by
        // tapping the cart's iPad, so it reports as the delegate's own
        // device. Without this both would land as 'kiosk' -- the exact
        // blind spot that made CTN26's channel split unanswerable.
        channel="web"
        onClose={() => { /* nothing to close — this IS the page */ }}
        onOrderPlaced={(orderNumber) => {
          const next = { order: String(orderNumber) };
          if (stationId) next.station = stationId;
          setParams(next);
        }}
      />
    </div>
  );
};

export default MobileOrderPage;
