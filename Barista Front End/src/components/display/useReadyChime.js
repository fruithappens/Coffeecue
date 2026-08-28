// The ready-chime and its on/off button, in one place.
//
// It shipped on /my and nowhere else, so the page a kiosk customer
// reaches by scanning the QR had no way to be told out loud. Steve:
// "there was no option on the waiting qrcode there was no sound button
// on this page."
//
// Copying the code across would have been the same mistake as the two
// drink choosers -- two implementations, one of which quietly gets the
// iOS handling wrong. So both pages import this.
//
// WHAT THE iOS HANDLING IS FOR (learned the hard way, see #382):
//   * ONE AudioContext, reused. Safari caps how many a page may create;
//     past that the constructor throws. Creating one per chime and
//     closing it afterwards guaranteed hitting that cap.
//   * RESUME before every play. A context is suspended whenever the page
//     has been backgrounded, and iOS backgrounds a page the moment the
//     screen locks -- exactly what a phone in a pocket does while it
//     waits for a coffee.
//   * The toggle tap is the user gesture that grants audio permission at
//     all, so it wakes the context too.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import playCupQSignature from '../../utils/cupqSignature';

export const SOUND_KEY = 'coffee_my_sound_on';

export default function useReadyChime() {
  const [soundOn, setSoundOn] = useState(() => {
    try { return localStorage.getItem(SOUND_KEY) === 'true'; } catch (e) { return false; }
  });

  const audioRef = useRef(null);
  const getAudio = useCallback(() => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!audioRef.current) audioRef.current = new Ctx();
      return audioRef.current;
    } catch (e) {
      return null;
    }
  }, []);

  const wakeAudio = useCallback(() => {
    const ctx = getAudio();
    if (ctx && ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) { /* nothing to do */ }
    }
    return ctx;
  }, [getAudio]);

  const playChime = useCallback(() => {
    try {
      const ctx = wakeAudio();
      if (!ctx) return;
      // The CupQ signature -- drop, pour, "Q", steam. One motif on
      // every good-news moment so the sound itself comes to mean
      // coffee (see utils/cupqSignature.js for the design).
      const fire = () => playCupQSignature(ctx);
      // resume() is async, so wait for it rather than firing into a
      // context that is still waking.
      if (ctx.state === 'suspended' && ctx.resume) {
        Promise.resolve(ctx.resume()).then(fire).catch(() => {
          /* audio stayed blocked -- the page still works silently */
        });
      } else {
        fire();
      }
    } catch (e) { /* a missing chime never blocks the status page */ }
  }, [wakeAudio]);

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      try { localStorage.setItem(SOUND_KEY, String(next)); } catch (e) { /* private mode */ }
      if (next) {
        // Play it once on the way ON: they hear what they signed up for,
        // and this tap is the gesture that unlocks audio in the first
        // place -- so enabling it here is also what makes it work later.
        wakeAudio();
        playChime();
      }
      return next;
    });
  }, [wakeAudio, playChime]);

  // iOS suspends the context while the page is hidden. Resume as we come
  // back, so a chime a second later is not the first thing to discover
  // it was asleep.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && soundOn) wakeAudio();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [soundOn, wakeAudio]);

  return { soundOn, toggleSound, playChime, wakeAudio };
}

// Red with a line through it when muted, green when on -- readable at a
// glance without reading the words (Steve: "maybe red speaker with cross
// though it and then green speaker icon").
export function SoundToggleButton({ soundOn, onToggle, className = '' }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={soundOn}
      className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl
                  border-2 text-sm font-semibold transition-colors ${className}
                  ${soundOn
                    ? 'border-green-600 text-green-700 bg-green-50'
                    : 'border-red-500 text-red-600 bg-red-50'}`}
    >
      {soundOn
        ? <Volume2 size={18} className="shrink-0" />
        : <VolumeX size={18} className="shrink-0" />}
      {soundOn ? 'Sound on when ready' : 'Tap for a sound when ready'}
    </button>
  );
}
