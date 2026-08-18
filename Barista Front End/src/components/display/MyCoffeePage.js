// MyCoffeePage.js — "my coffee", the attendee's own sticky page.
//
// Reached from a link in the EventsAir attendee app. That link is STATIC:
// every attendee opens the SAME url, because EA's app content is one
// document, not one per person. So the page identifies them once — badge
// number off their name tag — and remembers it on the device. From then
// on the same link is personal: their name, their usual, one tap to
// order, and live status while it's being made.
//
// Why identity lives here and not in EventsAir: the only fields an
// attendee can self-edit in the EA app are photo, socials and bio, and
// bio is public — nobody wants their coffee order on display. So EA seeds
// the preference and Coffee Cue owns it after that (Steve's call, 18 Aug).
//
// Anyone we don't recognise falls through to the normal ordering flow, so
// a wrong badge number or a guest who isn't in EventsAir is never stuck.
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import KioskOrder from './KioskOrder';

const STORAGE_KEY = 'coffee_cue_my_cid';

const STATUS = {
  pending: { title: 'In the queue', tone: 'bg-blue-600' },
  'in-progress': { title: 'Being made now', tone: 'bg-amber-500' },
  completed: { title: 'READY — come and get it', tone: 'bg-green-600' },
};

const MyCoffeePage = () => {
  const [params] = useSearchParams();
  // ?cid= wins (a merge field, if the app ever supplies one), then whatever
  // this device remembered from last time.
  const paramCid = params.get('cid');
  const [cid, setCid] = useState(
    () => paramCid || localStorage.getItem(STORAGE_KEY) || ''
  );
  const [me, setMe] = useState(null);
  const [entry, setEntry] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [fullOrder, setFullOrder] = useState(false);

  const load = useCallback(async (id, { quiet } = {}) => {
    if (!id) return;
    if (!quiet) setBusy(true);
    try {
      const r = await fetch(`/api/ea/me?cid=${encodeURIComponent(id)}`);
      const b = await r.json();
      if (b?.success) {
        setMe(b);
        localStorage.setItem(STORAGE_KEY, id);
        setError('');
      } else if (!quiet) {
        setError("We don't recognise that number.");
        setMe(null);
      }
    } catch (e) {
      if (!quiet) setError('Network problem — try again.');
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);

  useEffect(() => { if (cid) load(cid); }, [cid, load]);

  // While an order is live, keep the status fresh without the person
  // having to do anything — this page IS the notification for anyone
  // without a usable phone number (overseas guests on venue wifi).
  useEffect(() => {
    if (!cid || !me?.active_order) return undefined;
    const t = setInterval(() => load(cid, { quiet: true }), 8000);
    return () => clearInterval(t);
  }, [cid, me?.active_order, load]);

  // Keep the screen awake while they're watching for READY.
  useEffect(() => {
    let lock = null;
    (async () => {
      try {
        if (me?.active_order && navigator.wakeLock) {
          lock = await navigator.wakeLock.request('screen');
        }
      } catch (e) { /* unsupported is fine */ }
    })();
    return () => { try { lock && lock.release(); } catch (e) { /* noop */ } };
  }, [me?.active_order]);

  const orderUsual = async () => {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/ea/me/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid }),
      });
      const b = await r.json();
      if (b?.success) {
        await load(cid);
      } else {
        setError(b?.message || 'Could not place that order.');
      }
    } catch (e) {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  };

  const saveUsual = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/ea/me/usual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid, usual: draft }),
      });
      const b = await r.json();
      if (b?.success) { setEditing(false); await load(cid); }
      else setError(b?.message || 'Could not save that.');
    } catch (e) {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  };

  const forget = () => {
    localStorage.removeItem(STORAGE_KEY);
    setCid(''); setMe(null); setEntry(''); setError('');
  };

  // ---- not identified yet -------------------------------------------------
  if (!me) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-3" aria-hidden>☕</div>
          <h1 className="text-2xl font-bold mb-1">Your coffee</h1>
          <p className="text-gray-600 mb-6">
            Enter the number on your name badge and we'll remember you.
          </p>
          <input
            className="w-full border-2 rounded-xl px-4 py-4 text-2xl text-center tracking-widest"
            inputMode="numeric"
            placeholder="e.g. 56"
            value={entry}
            onChange={(e) => setEntry(e.target.value.trim())}
            onKeyDown={(e) => { if (e.key === 'Enter' && entry) setCid(entry); }}
          />
          {error && <p className="text-red-600 mt-3">{error}</p>}
          <button
            className="w-full mt-4 py-4 rounded-xl bg-blue-600 text-white text-lg font-semibold disabled:opacity-40"
            disabled={!entry || busy}
            onClick={() => setCid(entry)}
          >
            {busy ? 'Checking…' : "That's me"}
          </button>
          <button
            className="w-full mt-3 py-3 text-gray-600 underline"
            onClick={() => setFullOrder(true)}
          >
            I don't have a badge — just order
          </button>
        </div>
        {fullOrder && (
          <div className="fixed inset-0 bg-white z-50 overflow-auto">
            <KioskOrder onClose={() => setFullOrder(false)} />
          </div>
        )}
      </div>
    );
  }

  // ---- order in flight: this page becomes the notification ---------------
  const active = me.active_order;
  if (active) {
    const copy = STATUS[active.status] || { title: 'Checking…', tone: 'bg-gray-400' };
    const ready = active.status === 'completed';
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center p-6">
        <div className="w-full max-w-md">
          <div className={`${copy.tone} text-white rounded-2xl p-6 text-center shadow-lg
                           ${ready ? 'animate-pulse' : ''}`}>
            <div className="text-sm uppercase tracking-wide opacity-90">
              {me.first_name}'s order
            </div>
            <div className="text-6xl font-extrabold my-2">#{active.order_number}</div>
            <div className="text-2xl font-bold">{copy.title}</div>
          </div>
          <p className="text-center text-gray-500 text-sm mt-6">
            Keep this page open — it updates by itself.
          </p>
          <button
            className="w-full mt-6 py-3 rounded-xl bg-gray-800 text-white font-semibold"
            onClick={() => setFullOrder(true)}
          >
            Order another
          </button>
        </div>
        {fullOrder && (
          <div className="fixed inset-0 bg-white z-50 overflow-auto">
            <KioskOrder onClose={() => setFullOrder(false)} />
          </div>
        )}
      </div>
    );
  }

  // ---- identified, nothing in flight -------------------------------------
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <h1 className="text-3xl font-bold mb-1">Hi {me.first_name}</h1>

        {me.usual ? (
          <>
            <p className="text-gray-600 mb-1">Your usual</p>
            <p className="text-2xl font-semibold mb-6">{me.usual}</p>
            <button
              className="w-full py-5 rounded-2xl bg-blue-600 text-white text-xl font-bold shadow disabled:opacity-40"
              disabled={busy}
              onClick={orderUsual}
            >
              {busy ? 'Ordering…' : '☕ Order this now'}
            </button>
          </>
        ) : (
          <p className="text-gray-600 mb-6">
            You haven't saved a usual yet.
          </p>
        )}

        {error && <p className="text-red-600 mt-4">{error}</p>}

        {editing ? (
          <div className="mt-6 text-left">
            <label className="block text-sm text-gray-600 mb-1">
              Your usual — write it how you'd say it
            </label>
            <input
              className="w-full border-2 rounded-xl px-4 py-3"
              placeholder="e.g. Medium oat latte, 1 sugar"
              value={draft}
              maxLength={200}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="flex gap-2 mt-3">
              <button className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold disabled:opacity-40"
                      disabled={busy} onClick={saveUsual}>Save</button>
              <button className="flex-1 py-3 rounded-xl bg-gray-200 font-semibold"
                      onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button
            className="w-full mt-3 py-3 rounded-xl bg-white border-2 border-blue-600 text-blue-600 font-semibold"
            onClick={() => { setDraft(me.usual || ''); setEditing(true); }}
          >
            {me.usual ? 'Change my usual' : 'Save my usual'}
          </button>
        )}

        <button
          className="w-full mt-3 py-3 text-gray-700 underline"
          onClick={() => setFullOrder(true)}
        >
          Order something else
        </button>

        <button className="mt-8 text-xs text-gray-400 underline" onClick={forget}>
          Not {me.first_name}?
        </button>
      </div>

      {fullOrder && (
        <div className="fixed inset-0 bg-white z-50 overflow-auto">
          <KioskOrder onClose={() => { setFullOrder(false); load(cid); }} />
        </div>
      )}
    </div>
  );
};

export default MyCoffeePage;
