// components/display/KioskOrder.js
//
// Self-service "order here" kiosk overlay for the public Display screen.
// Touch-first, McDonald's-style: type your name, tap a drink, milk, size, set
// sugar with +/−, choose where to collect, leave a phone if collecting
// elsewhere, confirm, done.
//
// Smart bits:
//  - Items only available at OTHER stations are greyed with the station
//    numbers that make them.
//  - When more than one station can make the whole order, the customer picks
//    Collect Here / Fastest / a specific station (with live wait times).
//  - A phone number is REQUIRED only when collecting away from this screen's
//    station (so we can SMS "ready at Station X"); collecting here, it's
//    skipped — stand and watch the board.
//  - 30s of no touch → the overlay closes itself so the kiosk returns to the
//    live orders board for the next person.
//
// Public endpoints (no auth, like the rest of the Display):
//   GET  /api/display/menu   → { menu: { stations:[{id,name,wait,load}], coffee_types, milks, sizes } }
//   POST /api/display/order  → { order_number, station_id, station_name }
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DrinkIcon from './DrinkIcon';
import { remember } from '../../utils/deviceMemory';
import { X, ArrowLeft, Plus, Minus, Check, Loader, MapPin, Zap } from 'lucide-react';

// Idle handling: after IDLE_WARN_MS of no touch, a full-screen countdown
// appears for IDLE_COUNTDOWN_SECONDS ("tap to keep ordering"); if it runs
// out, the overlay closes and the kiosk returns to the live board — an
// abandoned half-order can't hold the display hostage (Steve's spec:
// ~20s quiet, then a visible 10s countdown).
const IDLE_WARN_MS = 20000;
const IDLE_COUNTDOWN_SECONDS = 10;

export const drinkEmoji = (name) => {
  const n = (name || '').toLowerCase();
  if (n.includes('hot choc')) return '🍫';
  if (n.includes('chai')) return '🫖';
  if (n.includes('matcha')) return '🍵';
  if (n.includes('tea')) return '🫖';
  if (n.includes('mocha')) return '🍫';
  return '☕';
};
export const milkEmoji = (name) => {
  const n = (name || '').toLowerCase();
  if (n.includes('no milk') || n.includes('none')) return '🚫';
  if (n.includes('oat')) return '🌾';
  if (n.includes('soy')) return '🫘';
  if (n.includes('almond')) return '🌰';
  if (n.includes('coconut')) return '🥥';
  if (n.includes('macadamia')) return '🌰';
  return '🥛';
};

// `channel` says WHOSE screen this is. The same component is both the
// cart's own touchscreen (mounted by DisplayScreen) and the page a
// delegate lands on after scanning a QR (mounted by MobileOrderPage at
// /order). They are different channels for reporting and only the caller
// knows which one it is, so it is a prop, not a guess.
const KioskOrder = ({ stationId, headerColor = '#C08552', onClose, onOrderPlaced,
                      eaCid, channel = 'kiosk', onPick , onCheckExisting }) => {
  // PICK MODE. With `onPick` supplied this screen chooses a drink and
  // hands it back instead of ordering one -- same tiles, same pictures,
  // same steps, no name/phone/station and no POST.
  //
  // It exists because /my had a SECOND, text-only drink chooser for
  // "change my usual", and Steve found out the way you would least want
  // to: "I went to change my usual and it was all text while someone who
  // scanned my qr code got the more pictorial menu." Two chooser UIs for
  // the same decision, and he was looking at the worse one.
  const picking = typeof onPick === 'function';
  const [menu, setMenu] = useState(null);
  // Event SMS number, for the "or text us" line. Public config, same
  // source the poster page uses. Absent is fine -- the line just drops
  // the text option rather than showing a blank.
  const [smsNumber, setSmsNumber] = useState('');
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch('/api/display/config');
        const b = r.ok ? await r.json() : null;
        const n = String((b?.config || b || {}).sms_number || '').trim();
        if (!dead && n) setSmsNumber(n);
      } catch (e) { /* the strip works without it */ }
    })();
    return () => { dead = true; };
  }, []);
  const [loadingMenu, setLoadingMenu] = useState(true);
  // Drink FIRST (Steve: "the first thing that should appear is not the
  // person's name, but the coffee type") — the order is the point; the
  // name and phone/collection come at the end.
  const [step, setStep] = useState('drink'); // drink → milk → size → sugar → name → location → phone → review → done

  // WHERE BACK GOES. Steve, on the strength step: "back doesnt go back to
  // where it was before, i was on the double shot page and clicked back
  // and it went to name and back went to size it was all a bit mixed up".
  //
  // Every Back button used to hand-derive its destination -- EIGHT
  // separate guesses at "where did they come from", each re-implementing
  // a slice of the forward branching, and each wrong for some route
  // through it. Strength went back to 'sugar' even when self-serve sugar
  // had skipped that step; Collect-from went back to 'name' even though
  // an EA-identified attendee never sees a name step. So Back landed on
  // screens the person had never been on.
  //
  // A stack cannot get this wrong: goTo remembers where you were, goBack
  // returns you there. Any new branch is handled for free.
  // Free text for the ask no menu anticipates. Steve: "could be a custom
  // field or notes (someone on weekend did 1/8th strength) or No lid etc
  // half full". Every one of those is a real order somebody placed, and
  // none of them is a tile.
  const [notes, setNotes] = useState('');
  // How long the confirmation screen stays up, counted down out loud.
  //
  // Steve: "feel like the qr code diapears to fast if someone wanted to
  // get phone out and scan maybe should have a contdown and say i need
  // more time to scan 5,4,3,2,1 and more time to scan can be a 10 second
  // extension".
  //
  // It was a silent 12-second setTimeout, so the screen vanished with no
  // warning while someone was still getting their phone out of a pocket.
  // Now the seconds are on screen and there is a button to buy more.
  const DONE_SECONDS = 15;
  const DONE_EXTENSION = 10;
  const [doneLeft, setDoneLeft] = useState(null);

  // WHOSE SCREEN IS THIS.
  //
  // Steve: "the device that has not been logged in assumes its someones
  // personal device ... the only distringuishing differnce is the
  // touchscreen should be logged in and should have user name and pass
  // where people phones dont need to be logged in".
  //
  // That is the honest test, and better than what was here. The code
  // inferred it from which component mounted the kiosk -- which happens
  // to work, but indirect is how the idle timer ended up interrupting
  // someone who was plainly typing.
  //
  // A customer never logs in. A cart touchscreen always has, because a
  // barista signed it in to work the station. So a token in storage means
  // this is the cart's shared screen; no token means a phone in someone's
  // hand.
  const isOwnDevice = (() => {
    try { return !localStorage.getItem('coffee_system_token'); } catch (e) { return true; }
  })();

  const [history, setHistory] = useState([]);
  const goTo = (next) => {
    setHistory((h) => [...h, step]);
    setStep(next);
  };
  const goBack = () => {
    setHistory((h) => {
      if (!h.length) return h;
      const rest = h.slice(0, -1);
      setStep(h[h.length - 1]);
      return rest;
    });
  };
  const [name, setName] = useState('');
  const [drink, setDrink] = useState(null);
  const [milk, setMilk] = useState(null);
  const [size, setSize] = useState(null);
  const [sugar, setSugar] = useState(0);
  const [drinkCat, setDrinkCat] = useState('All'); // category tab on the drink step
  // Strength and temperature. The first note the baristas made on the
  // day was that customers wanted a double shot or a half strength and
  // the touchscreen had no way to say so -- it could only arrive by SMS
  // or by a barista typing it in. The ordering API already accepted
  // both; only the screen never asked.
  const [strength, setStrength] = useState('');
  const [extraHot, setExtraHot] = useState(false);
  // Decaf. Stocked at the venue and orderable by SMS and at the
  // walk-in screen, but the touchscreen and the phone-QR flow had
  // no way to ask for it at all -- so the customers most likely to
  // want it (an afternoon session, someone avoiding caffeine) were
  // the only ones who could not choose it.
  const [decaf, setDecaf] = useState(false);
  const [chosenStation, setChosenStation] = useState(null); // collect-from station id
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // EventsAir pre-identification: the EA event app links to this page
  // with ?cid={ContactID}. We ask the server who that is (first name +
  // has_phone only — the number itself never reaches the browser) and
  // skip the name/phone steps. Unknown cid or channel off → normal flow.
  const [eaIdentity, setEaIdentity] = useState(null); // {cid, firstName, hasPhone}
  // Explicit SMS opt-in against the REGISTRATION mobile (never shown to
  // the browser). Steve's flow: confirm what's on record, opt IN to the
  // ready-text, or change details -- never assume the text.
  const [useRegisteredPhone, setUseRegisteredPhone] = useState(false);
  useEffect(() => {
    // The cid can arrive two ways: in the URL (an app link with a merge
    // field) or as a PROP from /my, which holds the identity in state
    // after the person identified themselves once. Without the prop this
    // component asked a known attendee for their name and phone all over
    // again, and the resulting order was attributed to whatever they
    // typed — so it never appeared as their order and the label carried
    // the wrong name.
    const cid = eaCid || new URLSearchParams(window.location.search).get('cid');
    if (!cid) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/ea/hello?cid=${encodeURIComponent(cid)}`);
        const b = await r.json();
        if (!cancelled && r.ok && b.success && b.first_name) {
          setEaIdentity({
            cid,
            firstName: b.first_name,
            hasPhone: !!b.has_phone,
            // 'local:' means /api/ea/guest minted this a moment ago for
            // someone who typed their own details — an exhibitor, AV crew,
            // a speaker. They have no event registration and no number on
            // file with the organiser, so the copy below must not claim
            // either.
            guest: String(cid).startsWith('local:'),
          });
          setName(b.first_name);
        }
      } catch (e) { /* anonymous flow */ }
    })();
    return () => { cancelled = true; };
  }, [eaCid]);

  const myStation = useMemo(() => {
    const n = parseInt(stationId, 10);
    return Number.isFinite(n) ? n : null;
  }, [stationId]);

  // --- inactivity: silent 20s, then a VISIBLE 10s countdown, then close ---
  const idleRef = useRef(null);
  const countdownRef = useRef(null);
  const [idleCountdown, setIdleCountdown] = useState(null); // null = no warning up
  const resetIdle = useCallback(() => {
    if (idleRef.current) clearTimeout(idleRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setIdleCountdown(null);
    if (step === 'done') return; // success screen has its own timer
    // Never time out somebody's own phone. The timeout exists because a
    // SHARED screen cannot be left holding a stranger's half-finished
    // order -- that reasoning does not apply to a phone in a pocket, and
    // an abandoned order on it costs nobody anything.
    //
    // Keyed off being logged in, which is Steve's rule and the honest
    // one, with the old prop kept as a second guard: a page that hands
    // back an order number is a personal flow whatever storage says.
    if (isOwnDevice || onOrderPlaced) return;
    idleRef.current = setTimeout(() => {
      setIdleCountdown(IDLE_COUNTDOWN_SECONDS);
      countdownRef.current = setInterval(() => {
        setIdleCountdown(c => {
          if (c == null) return null;
          if (c <= 1) {
            clearInterval(countdownRef.current);
            if (onClose) onClose();
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    }, IDLE_WARN_MS);
  }, [step, onClose, onOrderPlaced, isOwnDevice]);
  useEffect(() => {
    resetIdle();
    return () => {
      if (idleRef.current) clearTimeout(idleRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
    // notes/strength/extraHot were missing here, which is how Steve got
    // "when tyoping in notes field it gave the 10 second warning for
    // time out despite typing in this field" -- twenty seconds of
    // typing counted as twenty seconds of nobody being there.
  }, [step, name, drink, milk, size, sugar, chosenStation, phone,
      notes, strength, extraHot, decaf, resetIdle]);

  // AND a real activity listener, because the list above is the bug.
  //
  // Every field added to this screen has to be remembered here or the
  // countdown starts interrupting someone who is plainly still using it.
  // That is a footgun with a fresh victim per feature -- the notes box
  // was the first. Actual touches and keystrokes cannot go stale, so a
  // field added next year is covered without anyone noticing they had to
  // do anything.
  //
  // Kept ALONGSIDE the dependency list rather than replacing it: the
  // list also catches programmatic changes (a remembered usual filling
  // itself in), which no input event would.
  useEffect(() => {
    const bump = () => resetIdle();
    const opts = { passive: true };
    window.addEventListener('pointerdown', bump, opts);
    window.addEventListener('keydown', bump, opts);
    return () => {
      window.removeEventListener('pointerdown', bump, opts);
      window.removeEventListener('keydown', bump, opts);
    };
  }, [resetIdle]);

  // Counts the confirmation screen down and closes at zero. Separate
  // from the idle timer: this one is a deliberate "you are finished",
  // not "are you still there".
  useEffect(() => {
    if (doneLeft == null) return undefined;
    if (doneLeft <= 0) {
      if (onClose) onClose();
      return undefined;
    }
    const t = setTimeout(() => setDoneLeft((n) => (n == null ? null : n - 1)), 1000);
    return () => clearTimeout(t);
  }, [doneLeft, onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/display/menu');
        const b = r.ok ? await r.json() : null;
        if (!cancelled && b && b.success) setMenu(b.menu);
      } catch (e) { /* gentle error below */ }
      finally { if (!cancelled) setLoadingMenu(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const stationById = useMemo(() => {
    const m = {};
    (menu?.stations || []).forEach(s => { m[s.id] = s; });
    return m;
  }, [menu]);
  const stationName = (id) => stationById[id]?.name || `Station ${id}`;
  const stationWait = (id) => (stationById[id]?.wait ?? null);

  // "No milk" is always offered (tea / black coffee) even if no station lists it.
  const milkOptions = useMemo(() => {
    const base = (menu?.milks || []).slice();
    if (!base.some(m => (m.value || '').includes('no milk'))) {
      base.push({ name: 'No milk', value: 'no milk', stations: (menu?.stations || []).map(s => s.id) });
    }
    return base;
  }, [menu]);

  const madeHere = (item) => {
    if (!item) return true;
    if (myStation == null) return true;
    return (item.stations || []).includes(myStation);
  };
  const stationLabel = (item) => (item?.stations || []).map(s => `${s}`).join(', ');

  // Can SOME station make everything chosen so far PLUS this candidate?
  // Used to grey out milks/sizes that would dead-end at the review screen
  // — the kiosk used to let you build an impossible combo and only tell
  // you after you tried to place it (Steve's screenshot).
  const compatible = (...items) => {
    const sets = items.filter(Boolean).map(i => new Set(i.stations || []));
    if (sets.length === 0) return true;
    let inter = null;
    sets.forEach(s => { inter = inter == null ? new Set(s) : new Set([...inter].filter(x => s.has(x))); });
    return (inter?.size || 0) > 0;
  };

  // Drinks that never take milk — asking "what milk with your juice?"
  // confused real customers. These skip straight past the milk step.
  const MILKLESS = /(juice|smoothie|sparkling|lemonade|soft drink|still water)/;
  const noMilkOption = () =>
    milkOptions.find(m => (m.value || '').includes('no milk'))
    || { name: 'No milk', value: 'no milk', stations: (menu?.stations || []).map(s => s.id) };

  // Stations that can make the WHOLE chosen order (intersection of each part).
  const capable = useMemo(() => {
    const sets = [drink, milk, size].filter(Boolean).map(i => new Set(i.stations || []));
    if (sets.length === 0) return [];
    let inter = null;
    sets.forEach(s => { inter = inter == null ? new Set(s) : new Set([...inter].filter(x => s.has(x))); });
    return [...(inter || [])].sort((a, b) => a - b);
  }, [drink, milk, size]);

  const fastestStation = useMemo(() => {
    if (capable.length === 0) return null;
    return capable.slice().sort((a, b) => {
      const la = stationById[a]?.load ?? 0, lb = stationById[b]?.load ?? 0;
      if (la !== lb) return la - lb;
      return (stationById[a]?.wait ?? 0) - (stationById[b]?.wait ?? 0);
    })[0];
  }, [capable, stationById]);

  // Drink category tabs (Coffee / Tea / Hot Chocolate / Chai) — only shown
  // when the menu actually spans more than one, so a coffee-only event stays
  // a single clean grid.
  const drinkCategories = useMemo(() => {
    const order = ['Coffee', 'Tea', 'Hot Chocolate', 'Chai', 'Cold Drinks'];
    const present = [...new Set((menu?.coffee_types || []).map(d => d.category || 'Coffee'))];
    present.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return present;
  }, [menu]);
  const drinksForTab = (menu?.coffee_types || [])
    .filter(d => drinkCat === 'All' || (d.category || 'Coffee') === drinkCat);

  // Six familiar tiles, everything else one tap away. Steve: "I like
  // that the coffee menu only has 6 main items but feel like if someone
  // wanted ristretto they might not know its a posability so maybe last
  // item could be something else or other". Server marks the standard
  // menu featured; the long tail (ristretto, magic, cortado...) hides
  // behind a "Something else" tile until asked for.
  const [showAllDrinks, setShowAllDrinks] = useState(false);

  // Phone-first identity (Steve's Treenet flow: no badge ids printed).
  // The number is a SEARCH key against the attendee list first, and an
  // SMS opt-in second -- separately chosen, never implied. eaSuggest
  // holds a name the number found, waiting to be confirmed or refused.
  const [eaSuggest, setEaSuggest] = useState(null); // {firstName, cid}
  const [smsOptIn, setSmsOptIn] = useState(true);
  const [lookupBusy, setLookupBusy] = useState(false);

  const sizeChoices = menu?.sizes || [];
  const needsSizeStep = sizeChoices.length > 1;

  // Strength only makes sense where there are shots to change. Asking a
  // hot chocolate how strong it should be is a step that wastes a tap
  // and makes the machine look like it is not paying attention.
  const drinkIsEspresso = (() => {
    const cat = String(drink?.category || 'Coffee').toLowerCase();
    if (cat !== 'coffee') return false;
    const name = String(drink?.value || drink?.name || '').toLowerCase();
    // A long black or espresso is already about the shot; the useful
    // question there is strength, so they stay in.
    return !/(hot chocolate|chai|matcha|tea)/.test(name);
  })();

  // After sugar: EA-identified visitors skip the name step (we already
  // greeted them by their registration name); everyone else types one.
  // Where to go once drink+milk are settled and there is no size step.
  // The SIZE step already skipped sugar in self-serve mode; the MILK
  // step's transitions did not -- so a single-size venue (the size step
  // never renders) asked the sugar question its own settings had turned
  // off. Steve, testing on his phone: "it asked about sugar. that
  // option should not display." One decision, every path.
  const afterMilk = () => {
    if (needsSizeStep) { goTo('size'); return; }
    if (menu?.sugar_self_serve) { setSugar(0); afterSugar(); return; }
    goTo('sugar');
  };

  const afterSugar = () => {
    if (drinkIsEspresso) { goTo('strength'); return; }
    afterStrength();
  };
  const afterStrength = () => {
    // In pick mode the drink IS the whole answer -- there is nobody to
    // name, nowhere to route and nothing to send.
    if (picking) {
      onPick({
        drink: drink?.value || drink?.name || '',
        milk: milk?.value || '',
        size: size?.value || (sizeChoices[0]?.value) || '',
        sugar,
        strength: strength || '',
        extraHot: !!extraHot,
        beanType: decaf ? 'decaf' : '',
        notes: notes.trim(),
      });
      return;
    }
    // Phone first (optional), then name -- a number can find the name
    // on the attendee list, so asking for it second wasted the answer.
    goTo('phone');
  };
  // Continue from the phone step with a number: search the attendee
  // list before asking anything else. Whatever happens -- found,
  // ambiguous, unknown, offline -- the flow continues; the lookup can
  // only ever SAVE typing, never block an order.
  const continueWithNumber = async () => {
    setLookupBusy(true);
    try {
      const r = await fetch(`/api/ea/me?phone=${encodeURIComponent(phone.trim())}`);
      const b = await r.json().catch(() => null);
      if (r.ok && b?.success && b.first_name) {
        setEaSuggest({ firstName: b.first_name, cid: b.cid || null });
        goTo('name_confirm');
        return;
      }
      // A shared number is a question, not a failure: a delegate who
      // registered their whole team against one mobile gets asked which
      // of them is ordering (HTTP 300 with the candidates).
      if (r.status === 300 && Array.isArray(b?.choose) && b.choose.length > 0) {
        setEaSuggest({ choose: b.choose.slice(0, 4) });
        goTo('name_confirm');
        return;
      }
    } catch (e) { /* offline lookup = just ask for the name */ }
    setEaSuggest(null);
    goTo('name');
  };
  // After the name: choose a station if there's a choice, else auto-route.
  const afterName = () => {
    if (capable.length > 1) { goTo('location'); return; }
    const only = capable.length === 1 ? capable[0] : null;
    setChosenStation(only);
    routeFromStation();
  };
  // Always offer the phone step, but it's OPTIONAL for everyone — a customer
  // with no phone / on international roaming must still be able to order. If
  // they skip, they watch the board for their name (and the collect-from
  // station is shown on review + the board). Entering a number just opts them
  // into a ready-SMS. EA-identified attendees whose registration has a
  // mobile skip the step entirely — the server attaches it for the
  // ready-SMS without the number ever reaching this screen.
  const routeFromStation = () => {
    // The phone step already happened (it now leads, not trails).
    goTo('review');
  };
  const chooseStation = (sid) => { setChosenStation(sid); routeFromStation(); };

  const collectingHere = myStation != null && chosenStation === myStation;
  const phoneDigits = phone.replace(/\D/g, '');
  const phoneValid = phoneDigits.length >= 8;

  const placeOrder = async () => {
    setSubmitting(true);
    setErrorMsg('');
    try {
      const r = await fetch('/api/display/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          coffee_type: drink?.value,
          milk: milk?.value || 'no milk',
          size: size?.value || (sizeChoices[0]?.value) || 'medium',
          sugar: sugar === 0 ? 'No sugar' : `${sugar} sugar${sugar > 1 ? 's' : ''}`,
          station_id: myStation,
          preferred_station: chosenStation,
          // The number is only ATTACHED when texts were opted into --
          // it may have been typed purely to find the name.
          phone: smsOptIn ? phone.trim() : '',
          use_registered_phone: useRegisteredPhone || undefined,
          // A confirmed lookup links the order to the attendee, which
          // is what lets a wiped device find it again by number.
          ea_contact_id: eaIdentity?.cid
            || (name.trim() === (eaSuggest?.firstName || '') ? eaSuggest?.cid : undefined)
            || undefined,
          // Provenance. This overlay is the cart's own touchscreen, so the
          // channel is fixed; ?src= lets one event run several kiosks and
          // still tell them apart on the report (cart-1-ipad, foyer-ipad).
          strength: strength || undefined,
          notes: notes.trim() || undefined,
          temp: extraHot ? 'extra hot' : undefined,
          bean_type: decaf ? 'decaf' : undefined,
          channel,
          src: new URLSearchParams(window.location.search).get('src') || undefined,
          // The event this link belongs to. Carried through from the QR
          // so an old poster cannot order into a new event.
          e: new URLSearchParams(window.location.search).get('e') || undefined,
        }),
      });
      const b = await r.json();
      if (r.ok && b.success) {
        setResult(b);
        setStep('done');
        // Remember the live order ON THE DEVICE (localStorage AND a
        // cookie -- the EA app's webview can wipe one and keep the
        // other on a full quit). /my checks this on load and restores
        // the beacon until the order is done or three hours pass.
        remember('cupq_active_order', JSON.stringify({
          n: b.order_number, at: Date.now(),
        }), 3 * 3600);
        if (onOrderPlaced) {
          // Phone flow: the page becomes a live status card. No
          // auto-close — the customer watches for READY here.
          onOrderPlaced(b.order_number);
        } else if (!isOwnDevice) {
          // Shared screen: clear it for the next person, counted down out
          // loud. On a personal phone it stays until they close it.
          setDoneLeft(DONE_SECONDS);
        }
      } else {
        setErrorMsg(b.message || 'Could not place your order. Please see a barista.');
      }
    } catch (e) {
      setErrorMsg('Could not reach the system. Please see a barista.');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- presentational helpers -------------------------------------------
  const Tile = ({ active, disabled, onClick, emoji, icon, label, sub }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative flex flex-col items-center justify-center rounded-2xl p-5 min-h-[120px] text-center transition
        ${disabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-800 hover:shadow-lg active:scale-95 shadow'}`}
      style={active ? { boxShadow: `0 0 0 4px ${headerColor}` } : undefined}
    >
      <span className="mb-2 flex items-center justify-center h-14" aria-hidden>
        {icon || <span className="text-5xl">{emoji}</span>}
      </span>
      <span className="text-xl font-bold leading-tight">{label}</span>
      {sub && <span className="mt-1 text-xs font-semibold text-amber-600">{sub}</span>}
    </button>
  );

  const Header = ({ title, onBack }) => (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3 min-w-0">
        {onBack && (
          <button onClick={onBack} className="p-2 rounded-full bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 flex-shrink-0">
            <ArrowLeft size={28} />
          </button>
        )}
        {/* Dark, not white. This header sits INSIDE the panel, whose
            background is #f8fafc - so white-on-near-white made "Order here
            - pick a drink" effectively invisible on the kiosk. It was
            presumably styled for the dark backdrop behind the panel. */}
        {/* Sized down and allowed to WRAP on a phone.
            text-3xl with `truncate` meant a 375px screen showed
            "Order here ☕ —…" with the actual instruction cut off --
            on the one screen whose whole job is telling somebody what
            to do. The close button is flex-shrink-0 beside it, so on a
            narrow screen the heading was fighting for what was left. */}
        <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-gray-900
                       leading-tight break-words">{title}</h2>
      </div>
      <button onClick={onClose} className="p-2 rounded-full bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 flex-shrink-0" title="Cancel">
        <X size={28} />
      </button>
    </div>
  );

  const waitText = (id) => {
    const w = stationWait(id);
    return (w || w === 0) ? `~${w} min` : '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4"
         onPointerDown={resetIdle}
         style={{ background: `linear-gradient(135deg, ${headerColor}ee, #000000cc)`,
                  paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>

      {/* Idle countdown — big, unmissable, tap-to-dismiss. */}
      {idleCountdown != null && idleCountdown > 0 && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-6"
             onPointerDown={(e) => { e.stopPropagation(); resetIdle(); }}>
          <div className="bg-white rounded-3xl p-10 text-center shadow-2xl max-w-md">
            <div className="text-8xl font-black mb-2" style={{ color: headerColor }}>{idleCountdown}</div>
            <div className="text-3xl font-extrabold text-gray-800 mb-2">Still there?</div>
            <div className="text-xl text-gray-600">
              Tap anywhere to keep ordering — otherwise this screen goes back
              to the order board in {idleCountdown} second{idleCountdown === 1 ? '' : 's'}.
            </div>
          </div>
        </div>
      )}

      <div className={`w-full max-h-[92vh] overflow-y-auto rounded-3xl p-6 md:p-8
                       ${step === 'done' ? 'max-w-5xl' : 'max-w-3xl'}`}
           style={{ backgroundColor: '#f8fafc' }}>

        {/* ---------- NAME (after the drink is built) ---------- */}
        {step === 'name' && (
          <>
            <Header title="Almost done — who's it for?"
                    onBack={goBack} />
            <p className="text-xl text-gray-600 mb-3 font-medium">First name for the order</p>
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Type your name"
              className="w-full text-3xl font-bold p-5 rounded-2xl border-4 border-gray-200 focus:outline-none"
              style={{ borderColor: name ? headerColor : undefined }}
            />
            <button
              disabled={name.trim().length < 2} onClick={afterName}
              className="mt-6 w-full py-5 rounded-2xl text-2xl font-extrabold text-white disabled:opacity-40"
              style={{ backgroundColor: headerColor }}>
              Next →
            </button>
          </>
        )}

        {/* ---------- DRINK (first screen) ---------- */}
        {step === 'drink' && (
          <>
            <Header title={eaIdentity
              ? `Hi ${eaIdentity.firstName}! Pick a drink ☕`
              : 'Order here ☕'} />
            {eaIdentity && (
              <div className="flex items-center justify-center -mt-2 mb-2">
                <span className="text-sm text-gray-500">
                  Ordering as <strong>{eaIdentity.firstName}</strong>
                  {eaIdentity.guest ? '' : ' (from your event registration)'}
                </span>
                <button
                  className="ml-2 text-sm text-blue-600 underline"
                  onClick={() => { setEaIdentity(null); setName(''); }}
                >
                  Not you?
                </button>
              </div>
            )}
            {loadingMenu ? (
              <div className="flex items-center justify-center py-16 text-gray-500"><Loader className="animate-spin mr-2" /> Loading menu…</div>
            ) : (menu?.coffee_types || []).length === 0 ? (
              <div className="text-center py-16 text-gray-500 text-xl">No drinks available right now. Please see a barista.</div>
            ) : (
              <>
                {drinkCategories.length > 1 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {['All', ...drinkCategories].map(cat => (
                      <button key={cat} onClick={() => setDrinkCat(cat)}
                        className="px-4 py-2 rounded-full text-base font-bold transition"
                        style={drinkCat === cat
                          ? { backgroundColor: headerColor, color: '#fff' }
                          : { backgroundColor: '#fff', color: '#374151', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                        {cat}
                      </button>
                    ))}
                  </div>
                )}
                {onCheckExisting && (
                  <button
                    onClick={onCheckExisting}
                    className="block mx-auto mb-3 text-sm text-gray-500 underline"
                  >
                    Already ordered? Find my order
                  </button>
                )}
                {(() => {
                  // A drink an old server never labelled counts as
                  // featured, so nothing vanishes on a stale bundle.
                  const hidden = showAllDrinks ? []
                    : drinksForTab.filter(d => d.featured === false);
                  const shown = showAllDrinks ? drinksForTab
                    : drinksForTab.filter(d => d.featured !== false);
                  return (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {shown.map(d => (
                        <Tile key={d.value} icon={<DrinkIcon name={d.value} />} label={d.name}
                          active={drink?.value === d.value}
                          disabled={(d.stations || []).length === 0}
                          sub={(d.stations || []).length === 0 ? 'Not available today'
                            : (madeHere(d) ? null : `Station ${stationLabel(d)} only`)}
                          onClick={() => {
                            setDrink(d);
                            if (MILKLESS.test(d.value || '')) {
                              // Juice & friends: no milk question.
                              setMilk(noMilkOption());
                              afterMilk();
                            } else {
                              goTo('milk');
                            }
                          }} />
                      ))}
                      {hidden.length > 0 && (
                        <Tile emoji="✨" label="Something else"
                          sub={hidden.slice(0, 3).map(d => d.name).join(', ')
                               + (hidden.length > 3 ? '…' : '')}
                          onClick={() => setShowAllDrinks(true)} />
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </>
        )}

        {/* ---------- MILK ---------- */}
        {step === 'milk' && (
          <>
            <Header title="Milk?" onBack={goBack} />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {milkOptions.map(m => {
                const ok = compatible(drink, m);
                return (
                  <Tile key={m.value} emoji={milkEmoji(m.value)} label={m.name}
                    active={milk?.value === m.value}
                    disabled={!ok}
                    sub={!ok ? `Not available with ${drink?.name || 'that drink'}`
                      : (madeHere(m) ? null : `Station ${stationLabel(m)} only`)}
                    onClick={() => { if (ok) { setMilk(m); afterMilk(); } }} />
                );
              })}
            </div>
          </>
        )}

        {/* ---------- SIZE ---------- */}
        {step === 'size' && (
          <>
            <Header title="What size?" onBack={goBack} />
            <div className="grid grid-cols-3 gap-4">
              {sizeChoices.map(s => {
                const ok = compatible(drink, milk, s);
                return (
                  <Tile key={s.value} emoji="🥤" label={s.name}
                    active={size?.value === s.value}
                    disabled={!ok}
                    sub={!ok ? 'Not available with your choices' : null}
                    onClick={() => { if (ok) { setSize(s); if (menu?.sugar_self_serve) { setSugar(0); afterSugar(); } else { goTo('sugar'); } } }} />
                );
              })}
            </div>
          </>
        )}

        {/* ---------- SUGAR ---------- */}
        {step === 'sugar' && (
          <>
            <Header title="How much sugar?" onBack={goBack} />
            <div className="flex items-center justify-center gap-8 py-8">
              <button onClick={() => setSugar(s => Math.max(0, s - 1))}
                className="p-6 rounded-full bg-white shadow text-gray-700 active:scale-95 disabled:opacity-40" disabled={sugar === 0}>
                <Minus size={40} />
              </button>
              <div className="text-center min-w-[120px]">
                <div className="text-7xl font-extrabold" style={{ color: headerColor }}>{sugar}</div>
                <div className="text-lg font-semibold text-gray-500">{sugar === 0 ? (menu?.sugar_self_serve ? 'Add your own sugar at pickup' : 'No sugar') : `sugar${sugar > 1 ? 's' : ''}`}</div>
              </div>
              <button onClick={() => setSugar(s => Math.min(9, s + 1))}
                className="p-6 rounded-full bg-white shadow text-gray-700 active:scale-95">
                <Plus size={40} />
              </button>
            </div>
            <button onClick={afterSugar}
              className="w-full py-5 rounded-2xl text-2xl font-extrabold text-white" style={{ backgroundColor: headerColor }}>
              Next →
            </button>
          </>
        )}

        {/* ---------- STRENGTH (espresso drinks only) ---------- */}
        {step === 'strength' && (
          <>
            {menu?.sugar_self_serve && (
              <p className="text-base text-gray-500 mb-2">
                Sugar and sweeteners are help-yourself at pickup.
              </p>
            )}
            <Header title="How strong?" onBack={goBack} />
            <div className="grid grid-cols-3 gap-2 py-4">
              {/* Three, not four. Steve: "think should be normal, double,
                  half, notes 1/4, 1/8, 3x etc". "Extra strong" sat beside
                  "Double shot" meaning almost the same thing, which is a
                  choice to make rather than an option to take -- and the
                  genuinely unusual ones (1/8 strength, 3x) are not tiles
                  anyone would guess. They go in the notes box below,
                  which now exists. */}
              {[
                { value: '', label: 'Normal', hint: 'as it comes' },
                { value: 'strong', label: 'Double shot', hint: 'extra shot' },
                { value: 'weak', label: 'Half strength', hint: 'lighter' },
              ].map(opt => (
                <button
                  key={opt.label}
                  onClick={() => setStrength(opt.value)}
                  className={`py-5 px-3 rounded-2xl text-xl font-bold shadow active:scale-95 ${
                    strength === opt.value ? 'text-white' : 'bg-white text-gray-800'}`}
                  style={strength === opt.value ? { backgroundColor: headerColor } : {}}
                >
                  {opt.label}
                  <span className="block text-sm font-normal opacity-70 mt-0.5">{opt.hint}</span>
                </button>
              ))}
            </div>
            {/* Extra hot rides along here rather than earning its own
                step. It is a common ask and a cheap one, and a whole
                screen for one toggle is a tap nobody thanks you for. */}
            <button
              onClick={() => setExtraHot(v => !v)}
              className={`w-full py-4 rounded-2xl text-xl font-bold shadow mb-3 ${
                extraHot ? 'text-white' : 'bg-white text-gray-800'}`}
              style={extraHot ? { backgroundColor: headerColor } : {}}
            >
              {extraHot ? '✓ Extra hot' : 'Extra hot?'}
            </button>
            {/* Decaf rides along for the same reason Extra hot does: a
                common ask, a cheap one, and not worth a screen of its
                own. Only offered on espresso drinks, which is the only
                place the step appears anyway.

                GATED ON STOCK. The first version hardcoded this toggle,
                which meant decaf could not be switched off and the offer
                had no stock behind it. The menu now lists bean rows that
                actually have stock; no decaf row, no toggle. An old
                server that sends no beans list keeps the toggle (fail
                toward offering, since the barista can always say no). */}
            {(!Array.isArray(menu?.beans)
              || menu.beans.some(b => /decaf/i.test(b))) && (
            <button
              onClick={() => setDecaf(v => !v)}
              className={`w-full py-4 rounded-2xl text-xl font-bold shadow mb-3 ${
                decaf ? 'text-white' : 'bg-white text-gray-800'}`}
              style={decaf ? { backgroundColor: headerColor } : {}}
            >
              {decaf ? '✓ Decaf' : 'Decaf?'}
            </button>
            )}
            <label className="block mb-3">
              <span className="block text-base text-gray-600 mb-1">
                Anything else? (optional)
              </span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value.slice(0, 80))}
                placeholder="e.g. 1/4 strength, 3 shots, no lid, half full"
                className="w-full px-4 py-4 rounded-2xl text-lg border-2 border-gray-200
                           focus:outline-none"
                style={notes ? { borderColor: headerColor } : {}}
              />
            </label>
            <button onClick={afterStrength}
              className="w-full py-5 rounded-2xl text-2xl font-extrabold text-white" style={{ backgroundColor: headerColor }}>
              Next →
            </button>
          </>
        )}

        {/* ---------- LOCATION (only when >1 station can make it) ---------- */}
        {step === 'location' && (
          <>
            <Header title="Collect from?" onBack={goBack} />
            <div className="grid grid-cols-1 gap-3">
              {myStation != null && capable.includes(myStation) && (
                <button onClick={() => chooseStation(myStation)}
                  className="flex items-center justify-between rounded-2xl p-5 bg-white shadow hover:shadow-lg active:scale-[0.99]">
                  <span className="flex items-center gap-3 text-2xl font-bold text-gray-800"><MapPin size={28} style={{ color: headerColor }} /> Collect here</span>
                  <span className="text-lg text-gray-500">{stationName(myStation)} · {waitText(myStation)}</span>
                </button>
              )}
              {fastestStation != null && fastestStation !== myStation && (
                <button onClick={() => chooseStation(fastestStation)}
                  className="flex items-center justify-between rounded-2xl p-5 bg-white shadow hover:shadow-lg active:scale-[0.99]">
                  <span className="flex items-center gap-3 text-2xl font-bold text-gray-800"><Zap size={28} className="text-amber-500" /> Fastest</span>
                  <span className="text-lg text-gray-500">{stationName(fastestStation)} · {waitText(fastestStation)}</span>
                </button>
              )}
              <div className="text-sm font-semibold uppercase tracking-wide text-gray-400 mt-2 px-1">Or pick a station</div>
              {capable.map(sid => (
                <button key={sid} onClick={() => chooseStation(sid)}
                  className="flex items-center justify-between rounded-2xl p-4 bg-white shadow hover:shadow-lg active:scale-[0.99]">
                  <span className="text-xl font-bold text-gray-800">{stationName(sid)}{sid === myStation ? ' (here)' : ''}</span>
                  <span className="text-base text-gray-500">{waitText(sid)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ---------- PHONE (always optional — offer a ready-text) ---------- */}
        {step === 'phone' && eaIdentity?.hasPhone && !phone && (
          <>
            <Header title="Is this right?" onBack={goBack} />
            <p className="text-xl text-gray-600 mb-4 font-medium">
              We have <b>{name || eaIdentity.firstName}</b> and a mobile number
              on your registration.
            </p>
            <div className="space-y-3">
              <button
                onClick={() => { setUseRegisteredPhone(true); afterName(); }}
                className="w-full py-4 rounded-2xl text-white text-xl font-bold"
                style={{ backgroundColor: headerColor }}
              >
                Yes — text that number when it’s ready
              </button>
              <button
                onClick={() => { setUseRegisteredPhone(false); afterName(); }}
                className="w-full py-4 rounded-2xl text-xl font-bold border-4"
                style={{ borderColor: headerColor, color: headerColor }}
              >
                No texts — I’ll watch this screen
              </button>
              <button
                onClick={() => { setUseRegisteredPhone(false);
                  setEaIdentity((e) => (e ? { ...e, hasPhone: false } : e)); }}
                className="w-full py-3 text-gray-600 underline"
              >
                Use a different name or number
              </button>
            </div>
          </>
        )}
        {step === 'phone' && !(eaIdentity?.hasPhone && !phone) && (
          <>
            <Header title={isOwnDevice ? 'How should we tell you?' : 'Want a text when it’s ready?'}
                    onBack={goBack} />
            <p className="text-xl text-gray-600 mb-3 font-medium">
              {/* On someone's OWN phone, THIS PAGE is a way of being told,
                  and the best one -- no number, nothing to pay for, and it
                  updates itself. Say that first and offer the text as an
                  extra. On the cart's own screen it is not an option at
                  all, because they are about to walk away from it. */}
              {isOwnDevice
                ? (<>Keep this page open and it will tell you right here — no number
                     needed. Add your mobile if you’d rather get a text as well, or
                     just watch the board.</>)
                : collectingHere
                ? "Pop in your mobile and we’ll text you when it’s ready — or just wait nearby and watch the board for your name. No phone needed."
                : <>Your order will be ready at <b>{stationName(chosenStation)}</b>. Add your mobile for a text when it’s done, or skip and watch the board there for your name. No phone needed.</>}
            </p>
            <input
              autoFocus value={phone} onChange={(e) => setPhone(e.target.value)}
              inputMode="tel" placeholder="0408 263 333"
              className="w-full text-3xl font-bold p-5 rounded-2xl border-4 border-gray-200 focus:outline-none"
              style={{ borderColor: phoneValid ? headerColor : undefined }}
            />
            {phoneValid && (
              <button
                onClick={() => setSmsOptIn(!smsOptIn)}
                className="mt-4 w-full flex items-center gap-3 rounded-2xl border-4 p-4 text-left text-lg font-semibold"
                style={{ borderColor: smsOptIn ? headerColor : '#e5e7eb',
                         color: smsOptIn ? headerColor : '#6b7280' }}
              >
                <span className="text-2xl">{smsOptIn ? '☑' : '☐'}</span>
                Text me when it's ready
              </button>
            )}
            <div className="mt-4 flex gap-3">
              {/* Both choices are EQUAL, valid ways forward — same colour,
                  same weight. The old white "No thanks" next to a filled
                  "Text me →" read as cancel-vs-proceed (Steve), when
                  skipping the phone is a perfectly normal choice. */}
              <button onClick={() => { setPhone(''); setEaSuggest(null); goTo('name'); }}
                className="flex-1 py-5 rounded-2xl text-xl font-extrabold text-white shadow active:scale-95"
                style={{ backgroundColor: headerColor }}>
                {isOwnDevice ? '📱 Watch it on this phone' : "📺 I'll watch the board"}
              </button>
              <button disabled={!phoneValid || lookupBusy} onClick={continueWithNumber}
                className="flex-1 py-5 rounded-2xl text-xl font-extrabold text-white shadow active:scale-95 disabled:opacity-40"
                style={{ backgroundColor: headerColor }}>
                {lookupBusy ? 'One sec…' : 'Continue →'}
              </button>
            </div>
          </>
        )}

        {/* ---------- NAME CONFIRM (the number found someone) ---------- */}
        {step === 'name_confirm' && eaSuggest && (
          <>
            <Header title={eaSuggest.choose ? 'Which one are you?' : 'Is this you?'}
                    onBack={goBack} />
            <p className="text-xl text-gray-600 mb-4 font-medium">
              {eaSuggest.choose
                ? <>That number is registered to more than one person.</>
                : <>That number is registered to <b>{eaSuggest.firstName}</b>.</>}
            </p>
            <div className="space-y-3">
              {eaSuggest.choose ? (
                eaSuggest.choose.map((c) => (
                  <button key={c.cid || c.first_name}
                    onClick={() => {
                      setEaSuggest({ firstName: c.first_name, cid: c.cid || null });
                      setName(c.first_name);
                      afterName();
                    }}
                    className="w-full py-4 rounded-2xl text-white text-xl font-bold"
                    style={{ backgroundColor: headerColor }}
                  >
                    I'm {c.first_name}
                  </button>
                ))
              ) : (
                <button
                  onClick={() => { setName(eaSuggest.firstName); afterName(); }}
                  className="w-full py-4 rounded-2xl text-white text-xl font-bold"
                  style={{ backgroundColor: headerColor }}
                >
                  Yes — I'm {eaSuggest.firstName}
                </button>
              )}
              <button
                onClick={() => { setEaSuggest(null); goTo('name'); }}
                className="w-full py-4 rounded-2xl text-xl font-bold border-4"
                style={{ borderColor: headerColor, color: headerColor }}
              >
                {eaSuggest.choose ? 'Someone else — type a name' : 'No — use another name'}
              </button>
            </div>
          </>
        )}

        {/* ---------- REVIEW ---------- */}
        {step === 'review' && (
          <>
            <Header title="All good?" onBack={goBack} />
            <div className="bg-white rounded-2xl p-6 shadow mb-4">
              <div className="text-2xl font-extrabold text-gray-800 mb-3">{name.trim()}</div>
              <ul className="text-xl text-gray-700 space-y-1">
                <li>{drinkEmoji(drink?.value)} {drink?.name}</li>
                <li>{milkEmoji(milk?.value)} {milk?.name}</li>
                {size && <li>🥤 {size.name}</li>}
                <li>🍬 {sugar === 0
                  ? (menu?.sugar_self_serve ? 'Add your own sugar at pickup' : 'No sugar')
                  : `${sugar} sugar${sugar > 1 ? 's' : ''}`}</li>
                {/* Only listed when chosen. A review screen that solemnly
                    confirms "Normal strength" on every order trains people
                    to stop reading it. */}
                {strength && (
                  <li>💪 {strength === 'strong' ? 'Double shot'
                        : strength === 'weak' ? 'Half strength'
                        : 'Extra strong'}</li>
                )}
                {extraHot && <li>🌡️ Extra hot</li>}
              </ul>
              <div className="mt-4 pt-3 border-t flex items-center gap-2 text-lg font-semibold" style={{ color: headerColor }}>
                <MapPin size={20} /> Collect from {chosenStation != null ? stationName(chosenStation) : 'the next available station'}
                {chosenStation != null && waitText(chosenStation) ? ` · ${waitText(chosenStation)}` : ''}
              </div>
              {phone.trim() && smsOptIn ? (
                <div className="mt-1 text-base text-gray-500">We'll text {phone.trim()} when it's ready.</div>
              ) : (eaIdentity && eaIdentity.hasPhone && useRegisteredPhone && (
                <div className="mt-1 text-base text-gray-500">
                  {eaIdentity.guest
                    ? "We'll text the number you gave us when it's ready."
                    : "We'll text your registered number when it's ready."}
                </div>
              ))}
            </div>
            {/* Impossible combination: say so BEFORE they tap, and
                disable the button — it used to show the error while
                leaving a big active "Place order" underneath. */}
            {capable.length === 0 && !errorMsg && (
              <div className="rounded-2xl p-4 mb-4 bg-red-100 text-red-800 text-lg font-semibold">
                No station can make that exact combination right now — tap back and adjust the drink or milk.
              </div>
            )}
            {errorMsg && (
              <div className="rounded-2xl p-4 mb-4 bg-red-100 text-red-800 text-lg font-semibold">{errorMsg}</div>
            )}
            <button onClick={placeOrder} disabled={submitting || capable.length === 0}
              className="w-full py-6 rounded-2xl text-3xl font-extrabold text-white flex items-center justify-center gap-3 disabled:opacity-50"
              style={{ backgroundColor: headerColor }}>
              {submitting ? <><Loader className="animate-spin" /> Placing…</> : <><Check size={32} /> Place order</>}
            </button>
          </>
        )}

        {/* ---------- DONE ---------- */}
        {/* Order-from-your-own-phone strip, on screen for the WHOLE flow.
            Steve: "even while people are going through the touchscreen
            entry think the QR code should be available so someone can
            learn over and scan even while placing a order also the SMS
            number could be there also".
            One kiosk becomes several ordering points without buying any
            hardware -- the person waiting behind does not have to wait
            for the screen. Deliberately small and low-contrast: it must
            never compete with the step the current customer is on. */}
        {step !== 'done' && (
          <div className="mt-6 pt-4 border-t border-gray-200 flex items-center justify-center gap-4 opacity-80">
            <img
              src={`/api/qr?size=5&data=${encodeURIComponent(
                `${window.location.origin}/order${myStation ? `?station=${myStation}` : ''}`)}`}
              alt="Share the menu with a friend"
              className="w-20 h-20 rounded bg-white p-1"
            />
            <div className="text-left">
              <div className="text-base font-semibold text-gray-700">
                Share the menu with a friend
              </div>
              <div className="text-sm text-gray-500">
                Scan this code{smsNumber ? ` or text ${smsNumber}` : ''}
              </div>
            </div>
          </div>
        )}

        {step === 'done' && result && (
          /* TWO COLUMNS ON A WIDE SCREEN. This was one tall centred
             stack, and on a landscape iPad it ran off the bottom --
             Steve had to scroll to read his own order number: "would be
             good if could fit on single page there is lots of width
             avalible". There is: the number and the counter go left, the
             QR and the summary right, and nothing scrolls. Stacks back
             to one column on a phone. */
          <div className="text-center py-6 md:grid md:grid-cols-2 md:gap-8 md:items-center md:text-left">
            <div className="md:flex md:flex-col md:justify-center">
              <div className="text-6xl md:text-7xl mb-3">✅</div>
              <h2 className="text-3xl md:text-4xl font-extrabold text-gray-800 mb-1">Thanks, {name.trim()}!</h2>
              <p className="text-xl md:text-2xl text-gray-600 mb-2">Your order number is</p>
              <div className="text-7xl md:text-8xl font-black mb-3 leading-none"
                   style={{ color: headerColor }}>#{result.order_number}</div>
              <p className="text-xl md:text-2xl text-gray-700 font-semibold">
                Collect from <b>{result.station_name || `Station ${result.station_id}`}</b>
              </p>
              {phone.trim() && (
                <p className="text-base md:text-lg text-gray-500 mt-2">We'll text you when it's ready.</p>
              )}
            </div>
            <div className="md:flex md:flex-col md:items-center">

            {/* Track-it QR. Two jobs at once.
                For someone who gave no number, this is the ONLY way they
                can watch their order -- otherwise they are stuck reading
                the board or asking. And because it is on screen rather
                than on their phone, a friend can scan it off this display
                and watch it too, which is Steve's "share a QR code with a
                friend" without anyone typing a link or crowding the
                counter. */}
            {result?.order_number && (
              <div className="mt-2 md:mt-0 flex flex-col items-center">
                <img
                  src={`/api/qr?size=8&data=${encodeURIComponent(
                    `${window.location.origin}/order?order=${result.order_number}`)}`}
                  alt={`Track order ${result.order_number}`}
                  className="w-32 h-32 md:w-40 md:h-40 rounded-lg bg-white p-2 shadow"
                />
                <p className="text-base text-gray-600 mt-2 max-w-xs">
                  {phone.trim()
                    ? 'Scan to watch it on your phone - or let a friend scan it for you.'
                    : "Scan to watch it on your phone. No number needed."}
                </p>
              </div>
            )}

            {/* What you actually ordered, so you can see it all arrived
                -- not just the drink name. Steve, tracking his own:
                "your not confident that the whole order was recieved". */}
            <div className="mt-4 mx-auto w-full max-w-md rounded-2xl bg-gray-50 border-2 border-gray-200 px-5 py-3 text-center">
              <div className="text-sm uppercase tracking-wide text-gray-500 mb-1">
                Your order
              </div>
              <div className="text-2xl font-bold text-gray-800 capitalize">
                {[size?.name, drink?.name].filter(Boolean).join(' ')}
              </div>
              <div className="text-lg text-gray-600 mt-0.5">
                {[
                  milk?.name,
                  sugar === 0
                    ? (menu?.sugar_self_serve ? 'add your own sugar at pickup' : 'no sugar')
                    : `${sugar} sugar${sugar > 1 ? 's' : ''}`,
                  strength || null,
                  extraHot ? 'extra hot' : null,
                  // What the SERVER stored, not what they typed. A VIP
                  // code is stripped server-side, and this screen sits on
                  // a shared counter for fifteen seconds with the next
                  // person in the queue reading it. Falls back to the
                  // typed text only if the server did not say -- an older
                  // server, where no code stripping happens either.
                  (result?.notes !== undefined ? result.notes : notes).trim() || null,
                ].filter(Boolean).join(' · ')}
              </div>
            </div>

            {/* The countdown, out loud, with a way to buy more time. */}
            {doneLeft != null && (
              <div className="mt-4 flex flex-col items-center gap-2">
                <div className="text-lg text-gray-500">
                  This screen clears in <b className="text-gray-800">{doneLeft}</b>
                  {doneLeft === 1 ? ' second' : ' seconds'}
                </div>
                <button
                  onClick={() => setDoneLeft((n) => (n || 0) + DONE_EXTENSION)}
                  className="px-8 py-4 rounded-2xl text-lg font-bold border-2 border-gray-300 bg-white text-gray-800"
                >
                  I need more time to scan
                </button>
              </div>
            )}

            <button onClick={onClose}
              className="mt-5 px-10 py-4 rounded-2xl text-xl font-bold text-white" style={{ backgroundColor: headerColor }}>
              Done
            </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default KioskOrder;
