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
const PHONE_KEY = 'coffee_cue_my_phone';

const STATUS = {
  pending: { title: 'In the queue', tone: 'bg-blue-600' },
  'in-progress': { title: 'Being made now', tone: 'bg-amber-500' },
  completed: { title: 'READY — come and get it', tone: 'bg-green-600' },
};

// Sentinel for "a drink that isn't on the list".
const OTHER = '__other__';

// The modifiers people actually ask for, as one-tap chips. They are
// appended as plain words because the SMS parser already understands
// them - "double shot" becomes strength, "extra hot" becomes temp - so
// the same text works whether it arrives from here or from a text.
const QUICK_NOTES = ['extra hot', 'double shot', 'half strength', 'decaf', 'no foam'];

const SUGARS = [
  { name: 'No sugar', value: 'no sugar' },
  { name: '1 sugar', value: '1 sugar' },
  { name: '2 sugars', value: '2 sugars' },
  { name: '3 sugars', value: '3 sugars' },
];

// Drinks with no milk in them. Same list the barista stage chips and the
// bean-stock maths use — keep the three aligned if it ever changes.
const NO_MILK = /long black|short black|espresso|tea|juice|water/i;
const needsMilk = (drink) => !!drink && !NO_MILK.test(drink);

// One row of tappable options. Big targets: this is used one-handed while
// queueing, not at a desk.
const Choice = ({ label, options, value, onPick }) => (
  <div className="mb-4">
    <div className="text-sm text-gray-600 mb-2">{label}</div>
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const v = o.value || o.name;
        const on = value === v;
        return (
          <button
            key={v}
            onClick={() => onPick(on ? '' : v)}
            className={`px-4 py-3 rounded-xl border-2 text-base font-medium ${
              on ? 'bg-blue-600 border-blue-600 text-white'
                 : 'bg-white border-gray-300 text-gray-800'}`}
          >
            {o.name || v}
          </button>
        );
      })}
    </div>
  </div>
);

const MyCoffeePage = () => {
  const [params] = useSearchParams();
  // ?cid= wins (a merge field, if the app ever supplies one), then whatever
  // this device remembered from last time.
  const paramCid = params.get('cid');
  const [cid, setCid] = useState(
    () => paramCid || localStorage.getItem(STORAGE_KEY) || ''
  );
  const [me, setMe] = useState(null);
  // Mobile first: almost nobody knows their badge number, and it may not
  // even be printed. Everyone knows their own phone. It is also the number
  // we need for notifications, so matching on it proves we hold a good one.
  const [mode, setMode] = useState('phone');
  // Is badge lookup offered at this event? Starts false, not true: the
  // page must never advertise an identification route the event has not
  // enabled, and on a stale mirror a badge number matches the WRONG
  // person (see attendee_lookup_enabled on the server).
  const [badgeLookup, setBadgeLookup] = useState(false);
  const [phone, setPhone] = useState(() => localStorage.getItem(PHONE_KEY) || '');
  const [entry, setEntry] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fullOrder, setFullOrder] = useState(false);
  // When one mobile belongs to several attendees (a delegate who booked
  // for their team), we ask instead of guessing.
  const [choices, setChoices] = useState(null);
  // Set when the number is not in EventsAir. Exhibitors, crew and speakers
  // are never in the attendee list, so instead of turning them away we ask
  // for a name — the order only ever needed a name and a number anyway.
  const [guestAsk, setGuestAsk] = useState(false);
  // The number the failed lookup actually used. NOT the same as `entry`:
  // the guest prompt is also reached on arrival, from a number this device
  // remembered, where the person has typed nothing. Registering then sent
  // an empty phone and the server answered "that is not a valid mobile
  // number" — about a field the person was never shown, while they were
  // being asked for a NAME.
  const [guestPhone, setGuestPhone] = useState('');
  const [guestName, setGuestName] = useState('');
  // The name on the cup. The phone identifies them; the name is theirs to
  // set — nicknames, aliases, or fetching one for a colleague.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  // The usual is PICKED from the live menu, never typed. Free text was a
  // hangover from SMS, where a text message was all we had. Here there is
  // a real browser, so a chosen option cannot be misspelled, cannot name a
  // drink we do not make, and needs no parsing on the way back.
  const [menu, setMenu] = useState(null);
  const [pick, setPick] = useState({ drink: '', milk: '', size: '', sugar: '' });

  // `restored` marks a lookup the PERSON did not ask for: re-identifying
  // from an id this device remembered. A failure there is not their
  // mistake and must not be reported as one.
  const load = useCallback(async (id, { quiet, byPhone, restored } = {}) => {
    if (!id) return;
    if (!quiet) setBusy(true);
    try {
      const q = byPhone
        ? `phone=${encodeURIComponent(id)}`
        : `cid=${encodeURIComponent(id)}`;
      const r = await fetch(`/api/ea/me?${q}`);
      const b = await r.json();
      if (b?.choose) {
        setChoices(b.choose);
        setMe(null);
        setError('');
        return;
      }
      if (b?.success) {
        setChoices(null);
        setMe(b);
        // Adopt the CONTACT ID the server resolved, whichever way they got
        // in. Without this, someone who identified by phone left `cid`
        // empty and every later call — order, save usual — would 404.
        if (b.cid) {
          localStorage.setItem(STORAGE_KEY, b.cid);
          setCid((prev) => (prev === b.cid ? prev : b.cid));
        }
        if (byPhone) localStorage.setItem(PHONE_KEY, id);
        setError('');
      } else if (b?.guest_ok && byPhone) {
        // Not registered — but that is not the same as not welcome.
        setGuestPhone(id);
        setGuestAsk(true);
        setChoices(null);
        setMe(null);
        setError('');
      } else if (restored) {
        // A remembered id that no longer resolves - a different event now
        // holds the attendee list, or badge lookup has since been turned
        // off. Drop it and show the normal sign-in, with no error: the
        // person has just arrived and typed nothing.
        //
        // This is what produced "we don't recognise that badge number" for
        // someone who had entered a MOBILE. The message was picked by
        // `byPhone`, and a restored id is not a phone lookup, so a silent
        // background retry blamed a badge they never used.
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch (_) { /* storage blocked - the state reset below still holds */ }
        setCid('');
        setMe(null);
        setError('');
      } else if (!quiet) {
        setError(byPhone
          ? (badgeLookup
              ? "We can't find that number. Try the number you registered with, or use your badge number."
              // No attendee list is consulted at this event, so there is
              // no "number you registered with" to appeal to.
              : "We haven't seen that number here yet. Check it, or just order without one.")
          : badgeLookup
            ? "We don't recognise that badge number."
            // Badge lookup is off for this event, so never name a badge.
            : "We can't find that. Try your mobile number, or just order without one.");
        setMe(null);
      }
    } catch (e) {
      if (!quiet) setError('Network problem — try again.');
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (cid) load(cid, { restored: true });
    else if (phone) load(phone, { byPhone: true, restored: true });
    // Only on mount / after an identifier changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, load]);

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

  // Opening the editor starts from what they already chose, so changing
  // one thing does not mean re-picking everything.
  useEffect(() => {
    if (!editing) return;
    const u = (me?.usual || '').toLowerCase();
    if (!u) return;
    setPick((prev) => (prev.drink ? prev : {
      drink: (menu?.coffee_types || []).map((o) => o.value)
        .filter((v) => u.includes(v)).sort((a, b) => b.length - a.length)[0] || '',
      milk: (menu?.milks || []).map((o) => o.value).find((v) => u.includes(v)) || '',
      size: (menu?.sizes || []).map((o) => o.value).find((v) => u.includes(v)) || '',
      sugar: SUGARS.map((o) => o.value).find((v) => u.includes(v)) || '',
    }));
  }, [editing, menu, me?.usual]);

  // Read the event's feature flags once, on load. Rides on the menu
  // endpoint the page already uses, so this is not an extra round trip
  // for a phone on event wifi — it just happens earlier than the edit
  // screen would have asked for it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/display/menu');
        const b = await r.json();
        if (cancelled) return;
        setBadgeLookup(!!(b && b.features && b.features.attendee_lookup));
        setMenu((b && (b.menu || b)) || null);
      } catch (e) {
        if (!cancelled) setBadgeLookup(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // If the event has badge lookup off, never sit in badge mode — a stale
  // ?mode= or a previous visit should not strand someone on an input the
  // server will refuse.
  useEffect(() => {
    if (!badgeLookup && mode === 'badge') setMode('phone');
  }, [badgeLookup, mode]);

  useEffect(() => {
    if (!editing || menu) return;
    (async () => {
      try {
        const r = await fetch('/api/display/menu');
        const b = await r.json();
        setMenu((b && (b.menu || b)) || null);
      } catch (e) { setMenu(null); }
    })();
  }, [editing, menu]);

  // Compose what gets saved. Built from menu VALUES, so it always matches
  // something we actually serve.
  const composed = () => {
    const bits = [];
    if (pick.size) bits.push(pick.size);
    // `other` lets someone name a drink the picker does not list - a
    // ristretto, a piccolo, a long macchiato. The parser knows far more
    // drinks than any menu shows, and anything it still cannot place
    // reaches the barista as a note rather than being lost.
    const drink = pick.drink === OTHER ? (pick.other || '').trim() : pick.drink;
    if (drink) bits.push(drink);
    let out = bits.join(' ');
    if (pick.milk) out += ` with ${pick.milk}`;
    if (pick.sugar) out += `, ${pick.sugar}`;
    // Chips go INTO the drink text: the parser understands "extra hot" and
    // "double shot" and turns them into structured temp/strength, which is
    // what drives the barista card. Free text goes after a pipe instead,
    // because the parser DISCARDS what it cannot place - "no foam" was
    // simply lost, and "light on the chocolate" came back as skim milk.
    const chips = (pick.chips || []);
    if (chips.length) out += `, ${chips.join(', ')}`;
    const note = (pick.notes || '').trim();
    return (note ? `${out.trim()} | ${note}` : out.trim());
  };

  // What to show the person: the pipe is plumbing, not copy.
  const composedLabel = () => composed().replace(' | ', ' — ');

  // Opening the editor on an existing usual should show what was saved.
  // Only the free-text half is restored: drink/size/milk/sugar and the
  // chips are re-picked from the menu, which is the part that must match
  // what the event actually offers today.
  const startEditing = () => {
    const saved = String(me?.usual || '');
    const note = saved.includes('|') ? saved.split('|')[1].trim() : '';
    setPick((prev) => ({ ...prev, notes: note }));
    setEditing(true);
  };

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
        body: JSON.stringify({ cid, usual: composed() }),
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

  const saveName = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/ea/me/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid, name: nameDraft }),
      });
      const b = await r.json();
      if (b?.success) { setEditingName(false); await load(cid); }
      else setError(b?.message || 'Could not save that name.');
    } catch (e) {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  };

  const forget = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PHONE_KEY);
    setCid(''); setPhone(''); setMe(null); setEntry('');
    setError(''); setChoices(null);
  };

  // ---- one number, several people ----------------------------------------
  if (!me && choices) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center p-6"
           style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
                    paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold mb-1">Which one are you?</h1>
          <p className="text-gray-600 mb-6">
            More than one person uses that number.
          </p>
          {choices.map((p) => (
            <button
              key={p.cid}
              className="w-full mb-3 py-4 rounded-xl bg-white border-2 border-blue-600
                         text-blue-700 text-lg font-semibold"
              onClick={() => { setChoices(null); setCid(p.cid); }}
            >
              {p.first_name}{p.badge ? ` · badge ${p.badge}` : ''}
            </button>
          ))}
          <button
            className="w-full mt-2 py-3 text-gray-600 underline"
            onClick={() => { setChoices(null); setEntry(''); }}
          >
            None of these — try again
          </button>
        </div>
      </div>
    );
  }

  const registerGuest = async () => {
    const name = guestName.trim();
    if (!name) return;
    // Whichever number got us here: typed just now, or restored from this
    // device on arrival.
    const phoneForGuest = (guestPhone || entry || phone || '').trim();
    if (!phoneForGuest) {
      // Should not happen, but a name screen must never fail with a
      // complaint about a number field it never showed.
      setGuestAsk(false);
      setError('Please enter your mobile number first.');
      return;
    }
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/ea/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneForGuest, name }),
      });
      const b = await r.json();
      if (b?.choose) { setChoices(b.choose); setGuestAsk(false); return; }
      if (b?.success && b.cid) {
        localStorage.setItem(STORAGE_KEY, b.cid);
        localStorage.setItem(PHONE_KEY, phoneForGuest);
        setGuestAsk(false);
        setGuestName('');
        setCid(b.cid);
        load(b.cid);
      } else {
        setError(b?.message || 'Could not save that name.');
      }
    } catch (e) {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  };

  // ---- no match: ask for a name and carry on ------------------------------
  // Reached two ways, and the copy must not assume which: nobody was found
  // on the attendee list, OR this event never consults one.
  if (guestAsk) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center p-6"
           style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
                    paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-3" aria-hidden>☕</div>
          <h1 className="text-2xl font-bold mb-1">What&apos;s your first name?</h1>
          <p className="text-gray-600 mb-6">
            {/* Only claim a list was checked when one actually was. With
                attendee lookup off, nothing consults the delegate list by
                design, so "that number isn't on the delegate list" states
                a result we never went looking for - and reads as though
                the person has been turned away by it. */}
            {badgeLookup
              ? "That number isn't on the delegate list — no problem. Give us a name for the cup and you're set."
              : "Just a name for the cup and you're set."}
          </p>
          <input
            className="w-full border-2 rounded-xl px-4 py-4 text-2xl text-center"
            autoFocus
            autoComplete="given-name"
            placeholder="First name"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') registerGuest(); }}
          />
          {error && <p className="text-red-600 mt-3">{error}</p>}
          <button
            className="w-full mt-4 py-4 rounded-xl bg-blue-600 text-white text-lg font-semibold disabled:opacity-40"
            disabled={!guestName.trim() || busy}
            onClick={registerGuest}
          >
            {busy ? 'Saving…' : 'Continue'}
          </button>
          <button
            className="w-full mt-3 py-2 text-blue-700 underline text-sm"
            onClick={() => { setGuestAsk(false); setError(''); setEntry(''); setGuestPhone(''); }}
          >
            Try a different number
          </button>
        </div>
      </div>
    );
  }

  // ---- not identified yet -------------------------------------------------
  if (!me) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center p-6"
           style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
                    paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-3" aria-hidden>☕</div>
          <h1 className="text-2xl font-bold mb-1">Your coffee</h1>
          <p className="text-gray-600 mb-6">
            {mode === 'badge'
              ? "Enter the number on your name badge. We'll remember your order and text you when it's ready."
              : badgeLookup
                ? "Enter your mobile — the one you registered with. We'll remember your order and text you when it's ready."
                : "Enter your mobile. We'll remember your order and text you when it's ready."}
          </p>
          <input
            className="w-full border-2 rounded-xl px-4 py-4 text-2xl text-center"
            inputMode={mode === 'phone' ? 'tel' : 'numeric'}
            placeholder={mode === 'phone' ? '0412 345 678' : 'e.g. 56'}
            value={entry}
            onChange={(e) => setEntry(e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !entry) return;
              if (mode === 'phone') load(entry, { byPhone: true }); else setCid(entry);
            }}
          />
          {error && <p className="text-red-600 mt-3">{error}</p>}
          <button
            className="w-full mt-4 py-4 rounded-xl bg-blue-600 text-white text-lg font-semibold disabled:opacity-40"
            disabled={!entry || busy}
            onClick={() => {
              if (mode === 'phone') load(entry, { byPhone: true }); else setCid(entry);
            }}
          >
            {busy ? 'Checking…' : "That's me"}
          </button>
          {/* Only offered when the event actually has an attendee list
              loaded. Without this the page invited people to type a badge
              number that would be looked up against whichever event was
              synced last. */}
          {badgeLookup && (
            <button
              className="w-full mt-3 py-2 text-blue-700 underline text-sm"
              onClick={() => { setMode(mode === 'phone' ? 'badge' : 'phone'); setEntry(''); setError(''); }}
            >
              {mode === 'phone'
                ? 'Use my name badge number instead'
                : 'Use my mobile number instead'}
            </button>
          )}
          <button
            className="w-full mt-3 py-3 text-gray-600 underline"
            onClick={() => setFullOrder(true)}
          >
            {badgeLookup
              ? "I don't have a badge — just order"
              : 'Just order without giving a number'}
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
      <div className="min-h-screen bg-gray-50 flex flex-col items-center p-6"
           style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
                    paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
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
            <KioskOrder
              eaCid={cid}
              onClose={() => { setFullOrder(false); load(cid); }}
            />
          </div>
        )}
      </div>
    );
  }

  // ---- identified, nothing in flight -------------------------------------
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center p-6"
         style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
                  paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
      <div className="w-full max-w-md text-center">
        {editingName ? (
          <div className="mb-5 text-left">
            <label className="block text-sm text-gray-600 mb-1">
              Name for the cup
            </label>
            <input
              className="w-full border-2 rounded-xl px-4 py-3 text-lg"
              placeholder={me.registered_name || 'Your name'}
              value={nameDraft}
              maxLength={40}
              onChange={(e) => setNameDraft(e.target.value)}
            />
            <div className="flex gap-2 mt-3">
              <button className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold disabled:opacity-40"
                      disabled={busy} onClick={saveName}>Save</button>
              <button className="flex-1 py-3 rounded-xl bg-gray-200 font-semibold"
                      onClick={() => setEditingName(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <h1 className="text-3xl font-bold mb-1">
            Hi {me.first_name}
            <button
              className="ml-2 align-middle text-sm font-normal text-blue-600 underline"
              onClick={() => { setNameDraft(me.name_overridden ? me.first_name : ''); setEditingName(true); }}
            >
              edit
            </button>
          </h1>
        )}

        {me.usual ? (
          <>
            <p className="text-gray-600 mb-1">Your usual</p>
            {/* The pipe separates drink from barista note in storage; it
                is not something to show a customer. */}
            <p className="text-2xl font-semibold mb-6">{String(me.usual).replace(' | ', ' — ')}</p>
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
            {!menu ? (
              <p className="text-gray-500 py-6 text-center">Loading the menu…</p>
            ) : (
              <>
                <Choice label="Drink"
                        options={[...(menu.coffee_types || []), { name: 'Something else', value: OTHER }]}
                        value={pick.drink}
                        onPick={(v) => setPick({ ...pick, drink: v })} />
                {pick.drink === OTHER && (
                  <input
                    className="w-full border-2 rounded-xl px-4 py-3 text-lg mb-2"
                    placeholder="e.g. ristretto, piccolo, long macchiato"
                    value={pick.other || ''}
                    onChange={(e) => setPick({ ...pick, other: e.target.value })}
                  />
                )}
                {/* Milk is irrelevant to a long black or a tea, so only ask
                    once a drink that takes it has been chosen. */}
                {needsMilk(pick.drink) && (
                  <Choice label="Milk" options={(menu.milks || [])}
                          value={pick.milk}
                          onPick={(v) => setPick({ ...pick, milk: v })} />
                )}
                <Choice label="Size" options={(menu.sizes || [])}
                        value={pick.size}
                        onPick={(v) => setPick({ ...pick, size: v })} />
                {/* Hidden entirely where the venue puts sugar on the counter. */}
                {!menu.sugar_self_serve && (
                  <Choice label="Sugar" options={SUGARS} value={pick.sugar}
                          onPick={(v) => setPick({ ...pick, sugar: v })} />
                )}
                {/* Anything else the barista should know. Chips for the
                    common ones, free text for the rest. */}
                <div className="mt-4">
                  <p className="text-sm text-gray-600 mb-1">Anything else?</p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {QUICK_NOTES.map((q) => {
                      const cur = (pick.chips || []);
                      const on = cur.includes(q);
                      return (
                        <button
                          key={q}
                          type="button"
                          className={`px-3 py-1.5 rounded-full text-sm border ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
                          onClick={() => setPick({
                            ...pick,
                            chips: on ? cur.filter(x => x !== q) : [...cur, q],
                          })}
                        >
                          {q}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    className="w-full border-2 rounded-xl px-4 py-3 text-base"
                    placeholder="Anything else for the barista"
                    value={pick.notes || ''}
                    onChange={(e) => setPick({ ...pick, notes: e.target.value })}
                  />
                </div>
                <p className="mt-4 mb-1 text-sm text-gray-600">Your usual will be</p>
                <p className="text-lg font-semibold min-h-[1.75rem]">
                  {composedLabel() || <span className="text-gray-400">pick a drink…</span>}
                </p>
              </>
            )}
            <div className="flex gap-2 mt-4">
              <button className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold disabled:opacity-40"
                      disabled={busy || !pick.drink || (pick.drink === OTHER && !(pick.other || '').trim())}
                      onClick={saveUsual}>Save</button>
              <button className="flex-1 py-3 rounded-xl bg-gray-200 font-semibold"
                      onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button
            className="w-full mt-3 py-3 rounded-xl bg-white border-2 border-blue-600 text-blue-600 font-semibold"
            onClick={startEditing}
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
          Not {me.first_name}? Start again
        </button>
      </div>

      {fullOrder && (
        <div className="fixed inset-0 bg-white z-50 overflow-auto">
          {/* eaCid so the order is filed against THIS person: their name on
              the cup, their phone attached server-side, and the order then
              shows here as theirs instead of vanishing. */}
          <KioskOrder
            eaCid={cid}
            onClose={() => { setFullOrder(false); load(cid); }}
          />
        </div>
      )}
    </div>
  );
};

export default MyCoffeePage;
