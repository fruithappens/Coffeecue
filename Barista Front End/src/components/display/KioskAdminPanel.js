import React, { useCallback, useEffect, useRef, useState } from 'react';
import { forget } from '../../utils/deviceMemory';
import {
  Shield, X, Monitor, Coffee, Settings as SettingsIcon, RotateCw,
  Volume2, RefreshCw, LogOut, Maximize, Delete,
} from 'lucide-react';

const MY_CID_KEY = 'coffee_cue_my_cid';

/**
 * The hidden device admin panel (demo findings A3).
 *
 * An iPad running the display from a Home Screen shortcut is in iOS
 * standalone mode: no address bar, no back button, no way out by
 * design. The escape hatch has to live in the app. It also doubles as
 * the device-failover plan — when a barista terminal dies, staff
 * press-and-hold on a display screen, enter the PIN, switch it to
 * barista mode, and keep serving.
 *
 * Trigger: press-and-hold ~3s in the top-left corner (a deliberate
 * gesture a curious attendee won't stumble into; double-tap was
 * rejected as too easy to fire by accident). Gate: numeric PIN,
 * verified SERVER-side — the PIN never ships to the client. Panel
 * auto-dismisses after 30s idle so it can't be left open on a
 * public-facing screen.
 */

const HOLD_MS = 3000;
const IDLE_DISMISS_MS = 30000;

// Everything CupQ has ever stored on a device. Clearing is A2's
// "one clean device" action: stale barista logins from an old test and
// leftover attendee identities are exactly what confused the demo.
const clearDeviceState = () => {
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('coffee_') || k.startsWith('cupq_')
                || k.startsWith('quick_setup') || k.startsWith('display_'))) {
        doomed.push(k);
      }
    }
    doomed.forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
    // The cookie halves of the device memory go with it.
    forget('cupq_active_order');
    forget(MY_CID_KEY);
  } catch (e) { /* private mode: nothing stored anyway */ }
};

const beep = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const go = () => {
      const t0 = ctx.currentTime;
      [[880, 0], [1175, 0.16]].forEach(([hz, at]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = hz;
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(0.4, t0 + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.3);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t0 + at); osc.stop(t0 + at + 0.32);
      });
    };
    if (ctx.state === 'suspended') ctx.resume().then(go);
    else go();
  } catch (e) { /* silent devices stay silent */ }
};

const KioskAdminPanel = ({ stationId, stationName }) => {
  const [stage, setStage] = useState('hidden'); // hidden | pin | panel
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [defaultPin, setDefaultPin] = useState(false);
  const [version, setVersion] = useState('');
  const holdTimer = useRef(null);
  const idleTimer = useRef(null);

  // --- the press-and-hold corner --------------------------------
  const startHold = useCallback(() => {
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => setStage('pin'), HOLD_MS);
  }, []);
  const cancelHold = useCallback(() => clearTimeout(holdTimer.current), []);

  // --- auto-dismiss ----------------------------------------------
  const poke = useCallback(() => {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      setStage('hidden');
      setPin('');
    }, IDLE_DISMISS_MS);
  }, []);
  useEffect(() => {
    if (stage !== 'hidden') poke();
    return () => clearTimeout(idleTimer.current);
  }, [stage, poke]);

  useEffect(() => {
    if (stage !== 'panel') return;
    fetch('/api/app-version')
      .then((r) => (r.ok ? r.json() : {}))
      .then((b) => setVersion(b.bundle || ''))
      .catch(() => { /* version is decoration */ });
  }, [stage]);

  const tryPin = async (candidate) => {
    try {
      const r = await fetch('/api/kiosk/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: candidate }),
      });
      const b = await r.json().catch(() => ({}));
      if (r.ok && b.success) {
        setDefaultPin(!!b.default_pin);
        setStage('panel');
        setPin('');
        setPinError(false);
      } else {
        setPinError(true);
        setPin('');
      }
    } catch (e) {
      setPinError(true);
      setPin('');
    }
  };

  const press = (d) => {
    poke();
    setPinError(false);
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (next.length >= 4) tryPin(next);
  };

  const goTo = (path) => { window.location.href = path; };
  const identity = (() => {
    try {
      const u = JSON.parse(localStorage.getItem('coffee_system_user') || 'null');
      return u ? `${u.username} (${u.role})` : 'not signed in';
    } catch (e) { return 'not signed in'; }
  })();

  const Action = ({ icon: Icon, label, onClick, danger }) => (
    <button
      onClick={() => { poke(); onClick(); }}
      className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl border-2 text-left
                  text-base font-semibold ${danger
                    ? 'border-red-300 text-red-700 bg-red-50 hover:bg-red-100'
                    : 'border-gray-300 text-gray-800 bg-white hover:border-amber-500'}`}
    >
      <Icon size={20} className="shrink-0" /> {label}
    </button>
  );

  return (
    <>
      {/* The invisible trigger corner. pointer events cover mouse and
          touch; leaving the corner cancels the hold. */}
      <div
        className="fixed top-0 left-0 w-24 h-24 z-40"
        style={{ touchAction: 'none' }}
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
      />

      {stage === 'pin' && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
             onPointerDown={poke}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-xs text-center shadow-2xl">
            <Shield className="mx-auto text-amber-700" size={28} />
            <div className="font-bold text-gray-800 mt-1 mb-3">Staff PIN</div>
            <div className={`h-8 text-2xl tracking-[0.5em] font-mono ${pinError ? 'text-red-600' : 'text-gray-800'}`}>
              {pinError ? '····' : '•'.repeat(pin.length)}
            </div>
            {pinError && <div className="text-xs text-red-600 mb-1">Wrong PIN</div>}
            <div className="grid grid-cols-3 gap-2 mt-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                <button key={d} onClick={() => press(String(d))}
                  className="py-3 rounded-xl bg-gray-100 hover:bg-amber-100 text-xl font-bold">
                  {d}
                </button>
              ))}
              <button onClick={() => { poke(); setStage('hidden'); setPin(''); }}
                className="py-3 rounded-xl bg-gray-100 text-gray-500">
                <X size={20} className="mx-auto" />
              </button>
              <button onClick={() => press('0')}
                className="py-3 rounded-xl bg-gray-100 hover:bg-amber-100 text-xl font-bold">
                0
              </button>
              <button onClick={() => { poke(); setPin(pin.slice(0, -1)); }}
                className="py-3 rounded-xl bg-gray-100 text-gray-500">
                <Delete size={20} className="mx-auto" />
              </button>
            </div>
          </div>
        </div>
      )}

      {stage === 'panel' && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
             onPointerDown={poke}>
          <div className="bg-gray-50 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 font-bold text-gray-800">
                <Shield size={20} className="text-amber-700" /> Device admin
              </div>
              <button onClick={() => setStage('hidden')} className="text-gray-400 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <div className="text-xs text-gray-500 mb-3">
              {stationName || `Station ${stationId || '?'}`} · {identity}
              {version && <> · build {version.replace('main.', '').replace('.js', '')}</>}
              <span className="block">Closes itself after 30s idle.</span>
              {defaultPin && (
                <span className="block text-red-600 font-semibold">
                  Default PIN in use — change it in Comms Hub → Event wording.
                </span>
              )}
            </div>
            <div className="space-y-2">
              <Action icon={Coffee} label="Switch to Barista"
                onClick={() => goTo('/barista')} />
              <Action icon={SettingsIcon} label="Switch to Organiser"
                onClick={() => goTo('/organiser')} />
              <Action icon={Monitor} label="Change station / display options"
                onClick={() => goTo('/displays')} />
              <Action icon={RotateCw} label="Rotate screen"
                onClick={() => {
                  const u = new URL(window.location.href);
                  const cur = parseInt(u.searchParams.get('rotate') || '0', 10);
                  u.searchParams.set('rotate', String((cur + 90) % 360));
                  window.location.href = u.toString();
                }} />
              <Action icon={Volume2} label="Test sound" onClick={beep} />
              <Action icon={RefreshCw} label="Hard reload"
                onClick={() => window.location.reload()} />
              <Action icon={Maximize} label="Exit fullscreen"
                onClick={() => {
                  if (document.exitFullscreen && document.fullscreenElement) {
                    document.exitFullscreen();
                  }
                }} />
              <Action icon={LogOut} danger label="Clear this device & sign out"
                onClick={() => {
                  clearDeviceState();
                  window.location.href = '/';
                }} />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default KioskAdminPanel;
