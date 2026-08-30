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
import React, { useState, useEffect, useCallback, useRef } from 'react';
import BaristaAskCard from './BaristaAskCard';
import { recall, remember, forget } from '../../utils/deviceMemory';
import playCupQSignature from '../../utils/cupqSignature';
import { useSearchParams } from 'react-router-dom';
import { Volume2, VolumeX } from 'lucide-react';
import KioskOrder from './KioskOrder';

const STORAGE_KEY = 'coffee_cue_my_cid';
// Which QR/sign this visit came from. Session, not local: a delegate who
// scans the foyer poster today and the cart iPad tomorrow is two visits.
const SRC_KEY = 'coffee_my_src';
const PHONE_KEY = 'coffee_cue_my_phone';
// Whether this device wants the ready-chime. Off unless the person
// asked for it.
const SOUND_KEY = 'coffee_my_sound_on';

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
  // A half-configured EventsAir link sends the merge token LITERALLY --
  // ?cid={ContactID} -- and every attendee would land on an error. An
  // unexpanded token is no identity at all: ignore it and fall through
  // to the ordinary flow.
  const paramCidRaw = params.get('cid');
  const paramCid = (paramCidRaw && !/[{}[\]%]/.test(paramCidRaw))
    ? paramCidRaw : null;
  // Which QR they scanned: ?src=foyer-poster, ?src=cart-1-ipad, ?src=lanyard.
  // Remembered like cid, because the page reloads on its own during
  // ordering and the parameter would otherwise be lost after the first tap.
  const paramSrc = params.get('src');
  const [srcCode] = useState(
    () => paramSrc || sessionStorage.getItem(SRC_KEY) || ''
  );
  useEffect(() => {
    if (paramSrc) {
      try { sessionStorage.setItem(SRC_KEY, paramSrc); } catch (e) { /* private mode */ }
    }
  }, [paramSrc]);


  const [cid, setCid] = useState(
    () => paramCid || recall(STORAGE_KEY) || ''
  );
  const [me, setMe] = useState(null);
  // Liveness, tracked from REAL fetches rather than a decorative spinner.
  // Steve, watching his own order sit on "In the queue" while the barista
  // made it: "there should be a bit of a something that has motion or
  // proof that its connected and checking status live as you dont know if
  // its frozen etc". A spinner that turns regardless would be exactly the
  // placebo he is asking to be protected from, so `lastOkAt` only moves
  // when the server actually answered.
  const [lastOkAt, setLastOkAt] = useState(null);
  const [connected, setConnected] = useState(true);
  // Re-render once a second so "checked 12s ago" counts up on its own.
  const [, setTick] = useState(0);

  // Declared AFTER `me` deliberately. The dependency array below reads
  // me?.active_order?.status, and a dep array is evaluated DURING RENDER
  // -- so with this block sitting above `const [me] = useState(...)` it
  // threw a temporal-dead-zone ReferenceError and took the whole /my
  // page down in production. The build compiled it without complaint.
  //
  // Second time this exact shape has bitten in this codebase (the label
  // roll hook in BaristaInterface referenced stationPrinter the same
  // way). If a hook mentions a value in its deps, that value has to be
  // declared above it.
  //
  // A sound when it turns ready. This page IS the notification for
  // someone who gave no phone number, and a silent change on a screen in
  // a pocket is no notification at all (Steve: "possible to have should
  // when changes to ready for pickup").
  //
  // Web Audio rather than an audio file: no asset to ship, no request to
  // fail on venue wifi, and it works from a page the customer has
  // already tapped -- which is what unlocks audio in the first place.
  // Every browser blocks sound before a gesture, and placing the order
  // was that gesture.
  // OFF BY DEFAULT, and the customer decides.
  //
  // The chime shipped always-on with no way to silence it. In a room of
  // 400 delegates that is 400 phones that might chime unprompted, which
  // is worse than no sound at all and is the kind of thing a venue
  // remembers. Steve asked for a speaker icon, default off.
  //
  // Remembered per device, so someone who turns it on for a long wait
  // does not have to think about it again at the next event.
  const [soundOn, setSoundOn] = useState(() => {
    try { return localStorage.getItem(SOUND_KEY) === 'true'; } catch (e) { return false; }
  });
  // What the play attempt actually did: 'running' = audio flowed (a
  // silent phone means the mute switch/volume), 'blocked' = the
  // surrounding app never let audio start. Steve, in the EA app:
  // "I cant here the sound preview" -- with no way to tell which.
  const [audioState, setAudioState] = useState('unknown');
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    try { localStorage.setItem(SOUND_KEY, String(next)); } catch (e) { /* private mode */ }
    // Play it once on the way ON. Two reasons: the customer hears what
    // they have signed up for, and the tap itself is the gesture every
    // browser requires before it will allow audio at all -- so enabling
    // it here is also what makes it work later.
    if (next) {
      wakeAudio();
      playReadyChime();
      setTimeout(() => {
        try {
          setAudioState(audioRef.current && audioRef.current.state === 'running'
            ? 'running' : 'blocked');
        } catch (e) { setAudioState('blocked'); }
      }, 400);
    } else {
      setAudioState('unknown');
    }
  };

  // ONE AudioContext, reused, and resumed before every play.
  //
  // Steve: "no sound played on my phone despite having sould turned on".
  // Two reasons, both iOS:
  //
  //  * The old code did `new AudioContext()` EVERY chime. Safari caps how
  //    many a page may create (historically about four); past that the
  //    constructor throws, and the catch below swallowed it silently.
  //  * A context is SUSPENDED whenever the page has been backgrounded,
  //    and iOS backgrounds a page the moment the screen locks -- which is
  //    exactly what a phone in a pocket does while it waits for a coffee.
  //    Nothing resumed it, so oscillators played into a stopped context.
  //
  // So: keep one context, resume it before use, and resume it again on
  // the tap that turns sound on (that gesture is what grants permission
  // in the first place) and whenever the page comes back into view.
  const audioRef = useRef(null);
  const getAudio = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!audioRef.current) audioRef.current = new Ctx();
      return audioRef.current;
    } catch (e) {
      return null;
    }
  };
  const wakeAudio = () => {
    const ctx = getAudio();
    if (ctx && ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) { /* nothing to do */ }
    }
    return ctx;
  };

  const playReadyChime = () => {
    try {
      const ctx = wakeAudio();
      if (!ctx) return;
      // resume() is async. Waiting for it means the chime still lands
      // when the context was suspended a millisecond ago -- which is the
      // ordinary case on a phone that just woke up.
      // The CupQ signature -- the same motif the beacon and the admin
      // test play. This page had kept a private copy of the OLD
      // two-beep, so identified attendees were hearing a different
      // brand than everyone else.
      const fire = () => playCupQSignature(ctx);
      if (ctx.state === 'suspended' && ctx.resume) {
        Promise.resolve(ctx.resume()).then(fire).catch(() => {
          /* audio stayed blocked -- the page still works silently */
        });
      } else {
        fire();
      }
      // NOT closed afterwards. Closing is what forced a new context every
      // time, which is what hit Safari's limit.
    } catch (e) { /* a missing chime never blocks the status page */ }
  };

  const prevStatusRef = useRef(null);
  useEffect(() => {
    const status = me?.active_order?.status;
    const num = me?.active_order?.order_number;
    // The last status THIS ORDER was seen in, remembered across a
    // reload.
    //
    // In memory alone, `was` is null on a fresh mount, and the guard
    // below then suppresses the chime -- correct for someone opening the
    // page to an already-ready coffee, wrong for the case that actually
    // matters: a phone that slept, dropped the tab, restored it, and
    // finds the order finished in the meantime. That person never had a
    // "previous" status in memory and so was never told.
    const memKey = num ? `coffee_my_last_status_${num}` : null;
    let was = prevStatusRef.current;
    if (!was && memKey) {
      try { was = sessionStorage.getItem(memKey) || null; } catch (e) { /* private mode */ }
    }
    prevStatusRef.current = status;
    if (memKey && status) {
      try { sessionStorage.setItem(memKey, status); } catch (e) { /* private mode */ }
    }
    // Only on the TRANSITION into ready, never on a poll that merely
    // finds it still ready -- otherwise it chimes every few seconds at
    // someone who already knows.
    if (!was || was === status || status !== 'completed') return;
    // Only if the customer asked for it. Silence is the default.
    if (soundOn) playReadyChime();
    // The buzz is NOT gated on the sound toggle: a vibration is private,
    // does not carry across a room, and is the one signal that still
    // works for a phone face-down on a table with the ringer off. The
    // toggle is about noise in a shared room, which this is not.
    try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (e) { /* fine */ }
  }, [me?.active_order?.status]);

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
  // Coffee first (Steve: "even if it could not find ea persons name i
  // think it should start with the order"). An unidentified visitor
  // lands IN the ordering flow; looking up an existing order is the
  // link, not the gate.
  // /my?find=1 lands straight on the find-my-order screen AND skips
  // the beacon restore. It exists for the person who typed a WRONG
  // order number: the beacon page sends them here, and without the
  // flag the restore would bounce them right back to the wrong order.
  // Steve: "no way to search again without quitting the whole app".
  const [checkExisting, setCheckExisting] = useState(() => !!params.get('find'));
  // Order-number recovery. Steve force-quit the EA app, which wipes ALL
  // site data, having ordered as "fred" with no phone -- neither number
  // nor name could find that order again. The order number CAN (it is
  // on the done screen and the barista can read it out), and it is
  // explicit where a bare digit entry would be ambiguous with badge
  // numbers.
  const [orderNum, setOrderNum] = useState('');
  const [orderNumBusy, setOrderNumBusy] = useState(false);
  const [orderNumError, setOrderNumError] = useState('');
  // Bumping this remounts the coffee-first order flow from its first
  // screen. It is what the X now does there: Steve hit X mid-order and
  // was dumped on the old name-and-number page -- "confusing and out of
  // order... like a legacy menu system". X means start over, not
  // time-travel to the retired front door.
  const [orderEpoch, setOrderEpoch] = useState(0);
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
        setLastOkAt(Date.now());
        setConnected(true);
        // Adopt the CONTACT ID the server resolved, whichever way they got
        // in. Without this, someone who identified by phone left `cid`
        // empty and every later call — order, save usual — would 404.
        if (b.cid) {
          remember(STORAGE_KEY, b.cid, 7 * 24 * 3600);
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
          forget(STORAGE_KEY);
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
      // A failed poll is the case the indicator exists for: say so rather
      // than leaving a stale card looking current.
      setConnected(false);
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
  //
  // THE BUG THIS FIXES. Steve watched his own order: "im in the que but
  // when started it did not change and completed did not change". The
  // polling was working -- verified, 8s on the dot -- but a phone screen
  // does not stay awake. iOS suspends timers in a hidden tab, and his
  // phone was on 11% battery, where Low Power Mode throttles them harder
  // still. So the interval stopped, and NOTHING restarted it or refetched
  // when he looked again. The card sat on the last thing it had heard.
  //
  // A wake lock was already requested below, but it is unsupported on
  // iOS Safari and released the moment the page hides anyway. It cannot
  // be the answer.
  //
  // So: refresh the moment the page becomes visible again, and again on
  // pageshow (iOS restoring from the back/forward cache fires that and
  // not visibilitychange).
  //
  // Depends on the order NUMBER, not the active_order OBJECT: the object
  // is newly parsed on every poll, so the old dep tore the interval down
  // and rebuilt it eight seconds at a time, resetting its own clock.
  const activeNumber = me?.active_order?.order_number;
  useEffect(() => {
    if (!cid || !activeNumber) return undefined;
    const refresh = () => load(cid, { quiet: true });
    const t = setInterval(refresh, 8000);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      refresh();
      // iOS suspends the audio context while the page is hidden. Resume
      // it as we come back, so a chime a second later is not the first
      // thing that discovers it was asleep.
      if (soundOn) wakeAudio();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    window.addEventListener('online', refresh);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      window.removeEventListener('online', refresh);
    };
  }, [cid, activeNumber, load]);

  // Drives the "checked 12s ago" counter. Only while an order is live --
  // a once-a-second render on an idle page would be a battery cost for
  // nothing, and this page is open on phones that are already low.
  useEffect(() => {
    if (!activeNumber) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [activeNumber]);

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
        // channel: an events-app link carries ?cid=, a plain QR does not.
        // The server falls back to the same rule if this is ever absent.
        body: JSON.stringify({
          cid,
          channel: paramCid ? 'app' : 'web',
          src: srcCode || undefined,
        }),
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

  // Same picture-led chooser the QR flow uses, handing its answer back
  // here instead of ordering. Its vocabulary is not quite ours -- sugar
  // comes back as a NUMBER, strength and extra-hot as separate fields --
  // so translate into the shape composed() speaks. The chips are plain
  // words on purpose: the SMS parser already turns "double shot" into
  // strength and "extra hot" into temp.
  const usualFromKiosk = (p) => {
    const n = Number(p.sugar) || 0;
    const chips = [];
    if (p.extraHot) chips.push('extra hot');
    const st = String(p.strength || '').toLowerCase();
    if (QUICK_NOTES.includes(st)) chips.push(st);
    return {
      drink: p.drink || '',
      milk: p.milk || '',
      size: p.size || '',
      sugar: n === 0 ? 'no sugar' : `${n} sugar${n > 1 ? 's' : ''}`,
      other: '',
      chips,
      // Keep whatever free text they had already written -- the picker
      // has no field for it and losing it silently would be worse than
      // not offering it.
      notes: (pick.notes || '').trim(),
    };
  };

  // "I've got it" -- the customer clears their own order off the Ready
  // column. Optimistic: the card should go the instant they tap, because
  // they are already walking away from the cart.
  const markCollected = async () => {
    const num = me?.active_order?.order_number;
    if (!num) return;
    setMe((prev) => (prev ? { ...prev, active_order: null } : prev));
    try {
      await fetch('/api/ea/me/collected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid, order_number: num }),
      });
    } catch (e) {
      // The next poll re-reads the truth either way, so a failed call
      // costs a few seconds of a card being gone early, not a lost order.
    }
    load(cid, { quiet: true });
  };

  const saveUsualFromPick = async (p) => {
    const next = usualFromKiosk(p);
    setPick(next);
    setBusy(true);
    try {
      const bits = [];
      if (next.size) bits.push(next.size);
      if (next.drink) bits.push(next.drink);
      let out = bits.join(' ');
      if (next.milk) out += ` with ${next.milk}`;
      if (next.sugar) out += `, ${next.sugar}`;
      if (next.chips.length) out += `, ${next.chips.join(', ')}`;
      const usual = next.notes ? `${out.trim()} | ${next.notes}` : out.trim();
      const r = await fetch('/api/ea/me/usual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid, usual }),
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
    forget(STORAGE_KEY);
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
        remember(STORAGE_KEY, b.cid, 7 * 24 * 3600);
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
  // A live order remembered on this device survives the app being
  // closed: restore the beacon instead of offering a fresh order form.
  // Cleared by age (3h) here and by the tracking page on pickup.
  if (!me && !checkExisting) {
    try {
      const raw = recall('cupq_active_order');
      if (raw) {
        const a = JSON.parse(raw);
        if (a && a.n && Date.now() - (a.at || 0) < 3 * 3600 * 1000) {
          window.location.replace(`/order?order=${a.n}&restored=1`);
          return null;
        }
        forget('cupq_active_order');
      }
    } catch (er) { /* unreadable = no memory; order form it is */ }
  }

  if (!me && !checkExisting) {
    // COFFEE FIRST. The mobile-entry screen used to be the front door,
    // which put a form between a thirsty person and the menu (and was
    // the first thing the EventsAir app showed when its link carried no
    // contact id). Ordering is now the front door; identity happens at
    // the end of the flow, where it belongs.
    return (
      <div className="min-h-screen bg-white">
        <KioskOrder
          key={orderEpoch}
          onClose={() => setOrderEpoch((e) => e + 1)}
          onCheckExisting={() => setCheckExisting(true)}
          onOrderPlaced={(orderNumber) => {
            // No identity to hang a /my beacon on -- the order-number
            // tracking view is the beacon (the same URL the done-screen
            // share-QR encodes): live status until collected.
            window.location.href = `/order?order=${orderNumber}`;
          }}
        />
      </div>
    );
  }

  const findOrderByNumber = async () => {
    if (!orderNum) return;
    setOrderNumBusy(true);
    setOrderNumError('');
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(orderNum)}/track`);
      const b = r.ok ? await r.json() : null;
      if (b?.success) {
        try {
          remember('cupq_active_order',
            JSON.stringify({ n: orderNum, at: Date.now() }), 3 * 3600);
        } catch (er) { /* memory is a bonus */ }
        window.location.href = `/order?order=${orderNum}`;
        return;
      }
      setOrderNumError("We can't find that order number.");
    } catch (e) {
      setOrderNumError('Network problem — try again.');
    } finally {
      setOrderNumBusy(false);
    }
  };

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
            {/* Not "Checking…": that implies we are verifying them
                against a list, and at most events there is no list --
                we are looking up a previous order, and if there is
                none they simply carry on. Steve: it "implies its
                looking for a EA database". */}
            {busy ? 'One moment…' : 'Continue'}
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
          <div className="mt-5 pt-4 border-t border-gray-200">
            <p className="text-sm text-gray-600 mb-2">
              Or find an order by its number (it's on the order screen):
            </p>
            <div className="flex gap-2">
              <input
                className="flex-1 border-2 rounded-xl px-3 py-3 text-xl text-center"
                inputMode="numeric"
                placeholder="e.g. 250"
                value={orderNum}
                onChange={(e) => { setOrderNum(e.target.value.replace(/\D/g, '')); setOrderNumError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && orderNum) findOrderByNumber(); }}
              />
              <button
                className="px-5 rounded-xl bg-gray-800 text-white font-semibold disabled:opacity-40"
                disabled={!orderNum || orderNumBusy}
                onClick={findOrderByNumber}
              >
                {orderNumBusy ? '…' : 'Find'}
              </button>
            </div>
            {orderNumError && <p className="text-red-600 mt-2 text-sm">{orderNumError}</p>}
          </div>
          <button
            className="w-full mt-3 py-3 text-gray-600 underline"
            onClick={() => setFullOrder(true)}
          >
            {badgeLookup
              ? "I don't have a badge — just order"
              : 'Just order without giving a number'}
          </button>
          <button
            className="w-full mt-2 py-2 text-gray-500 underline text-sm"
            onClick={() => setCheckExisting(false)}
          >
            Back to ordering
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
    // Seconds since the server last answered. Recomputed every render,
    // and a render is forced once a second by the tick effect above.
    const staleSeconds = lastOkAt
      ? Math.max(0, Math.round((Date.now() - lastOkAt) / 1000))
      : 99;
    // How long it has been in its current status, per the server. Not
    // counted on the client: the phone may have been asleep for ten
    // minutes of it.
    const waitingMinutes = typeof active.seconds_in_status === 'number'
      ? Math.floor(active.seconds_in_status / 60)
      : null;
    const copy = STATUS[active.status] || { title: 'One moment…', tone: 'bg-gray-400' };
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
            {/* WHERE. A card that says a coffee is ready without saying
                which cart is only half an answer at a two-cart event
                (Steve: "#78 order does not say which station to colelct
                from"). */}
            {active.station_name && (
              <div className="mt-2 text-lg font-semibold opacity-95">
                {ready ? 'at ' : 'being made at '}{active.station_name}
              </div>
            )}
            {/* HOW LONG it has been sitting there. Only once ready --
                before that it is the wait, which the page does not
                promise, and a clock on a queue position just makes
                people anxious. */}
            {ready && waitingMinutes != null && (
              <div className="mt-1 text-sm opacity-90">
                {waitingMinutes < 1
                  ? 'just now'
                  : `waiting ${waitingMinutes} min${waitingMinutes === 1 ? '' : 's'}`}
              </div>
            )}
          </div>

          {ready && (
            <button
              type="button"
              onClick={markCollected}
              className="mt-4 w-full py-4 rounded-xl bg-gray-900 text-white text-lg font-semibold"
            >
              I've got it
            </button>
          )}
          {/* Proof it is alive, and honest about it when it is not.
              The dot only pulses because a fetch actually succeeded, and
              the counter only resets when the server answered -- so a
              frozen page shows a number climbing past 30s and then says
              so outright, instead of looking exactly like a working one.
              That distinction is the whole request. */}
          <div className="mt-6 flex items-center justify-center gap-2 text-sm">
            <span className={`inline-block w-2 h-2 rounded-full
                              ${!connected || staleSeconds > 30
                                ? 'bg-amber-500'
                                : 'bg-green-500 motion-safe:animate-pulse'}`} />
            <span className={!connected || staleSeconds > 30
                              ? 'text-amber-700' : 'text-gray-500'}>
              {!connected
                ? 'Not connected — trying again'
                : staleSeconds > 30
                  ? `Last checked ${staleSeconds}s ago — reconnecting`
                  : staleSeconds <= 1
                    ? 'Checking now'
                    : `Checked ${staleSeconds}s ago`}
            </span>
          </div>
          <div className="mb-4">
            <BaristaAskCard orderNumber={active.order_number} />
          </div>
          <p className="text-center text-gray-500 text-sm mt-2">
            Keep this page open — it updates by itself.
          </p>

          {/* Sound, off by default, the customer's choice.
              Sits right under "keep this page open", because that is the
              moment they are deciding how much attention this page needs
              from them. Red with a line through it when muted, green
              when on -- readable at a glance without reading the words
              (Steve: "maybe red speaker with cross though it and then
              green speaker icon"). */}
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={soundOn}
            className={`mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl
                        border-2 text-sm font-semibold transition-colors
                        ${soundOn
                          ? 'border-green-600 text-green-700 bg-green-50'
                          : 'border-red-500 text-red-600 bg-red-50'}`}
          >
            {soundOn
              ? <Volume2 size={18} className="shrink-0" />
              : <VolumeX size={18} className="shrink-0" />}
            {soundOn ? 'Sound on when ready' : 'Tap for a sound when ready'}
          </button>
          {soundOn && audioState === 'running' && (
            <p className="mt-1 text-xs text-center text-gray-500">
              Chime played — didn't hear it? Check your phone's silent
              switch and volume.
            </p>
          )}
          {soundOn && audioState === 'blocked' && (
            <p className="mt-1 text-xs text-center text-amber-700">
              This app is blocking sound. This screen still turns green
              when it's ready — or opt in for a text.
            </p>
          )}

          {/* A code someone ELSE can scan to order their own. Steve: "can
              this page have a qr code on it so others can order off of
              it?" -- the person holding the phone already has an order,
              so this points at the ORDERING page rather than at this
              one. Open by default here, unlike the share-my-order code
              on the other status page: that one answers "let me show a
              friend my order", this one is the thing a colleague asks
              for, and a code they have to be shown how to reveal is a
              code nobody uses. */}
          <div className="mt-6 flex flex-col items-center">
            <img
              src={`/api/qr?size=7&data=${encodeURIComponent(`${window.location.origin}/order`)}`}
              alt="Order a coffee"
              className="w-40 h-40 bg-white rounded-xl p-2 shadow"
            />
            <p className="text-xs text-gray-500 mt-2 text-center">
              Someone else can scan this to order their own.
            </p>
          </div>

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
              onOrderPlaced={() => { setFullOrder(false); load(cid); }}
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
          /* The SAME chooser the QR flow uses, in pick mode. There used to
             be a second, text-only one here; Steve found it by watching
             someone beside him get the nicer screen for the same job. */
          <div className="mt-6">
            <KioskOrder
              onPick={saveUsualFromPick}
              onClose={() => setEditing(false)}
              eaCid={cid}
              channel="web"
            />
          </div>
        ) : null}
        {!editing ? (
          <button
            className="w-full mt-3 py-3 rounded-xl bg-white border-2 border-blue-600 text-blue-600 font-semibold"
            onClick={startEditing}
          >
            {me.usual ? 'Change my usual' : 'Save my usual'}
          </button>
        ) : null}

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
          {/* onOrderPlaced: Done flips STRAIGHT to the waiting beacon
              (Steve's spec: selections -> name -> optional SMS -> beacon
              until collected). Before this, Done showed a static screen,
              closing it re-looked-up by PHONE ONLY, found nothing for an
              EA order without a number, and dumped the customer back at
              the start as if their order had vanished. The lookup now
              also matches the EA contact, and this handoff skips the
              dead end entirely. */}
          <KioskOrder
            eaCid={cid}
            onClose={() => { setFullOrder(false); load(cid); }}
            onOrderPlaced={() => { setFullOrder(false); load(cid); }}
          />
        </div>
      )}
    </div>
  );
};

export default MyCoffeePage;
