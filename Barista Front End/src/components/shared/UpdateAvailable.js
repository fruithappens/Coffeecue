import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * Notices that the tablet is running an old build, and does something
 * about it.
 *
 * Steve: "hope dont need to always tell baristas to force refresh, clear
 * cache, etc."
 *
 * He is right that this should not be a human procedure. A tablet left
 * open since setup keeps running the bundle it loaded then, and
 * deploying does not change that — so a fix ships, everyone is told it
 * is live, and the one screen that matters is still running yesterday's
 * code. That is how he was still looking at oat milk hours after it was
 * removed from the menu.
 *
 * The bundle FILENAME is the build identity (CRA fingerprints it), so
 * comparing the name this page loaded against the one the server is
 * serving is enough.
 *
 * TWO BEHAVIOURS, because the screens are not alike:
 *
 *   Display boards reload themselves. Nobody is standing at them, there
 *   is nothing half-typed to lose, and a banner would just sit there
 *   unread in front of customers.
 *
 *   Staff screens ASK. A barista may be halfway through a walk-in order
 *   with a customer waiting, and yanking the page out from under them to
 *   apply a menu change would be its own bug.
 */

// Long enough to be invisible, short enough that a deploy during setup
// is picked up before doors open.
const POLL_MS = 3 * 60 * 1000;

// Screens with no operator standing at them.
const SELF_RELOAD_PATHS = ['/display', '/displays'];

const ownBundle = () => {
  try {
    const el = document.querySelector('script[src*="/static/js/main."]');
    const src = el && el.getAttribute('src');
    const m = src && src.match(/(main\.[A-Za-z0-9]+\.js)/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
};

const isSelfReloading = () => {
  try {
    const path = window.location.pathname || '';
    return SELF_RELOAD_PATHS.some(p => path === p || path.startsWith(p + '/'));
  } catch (e) {
    return false;
  }
};

export default function UpdateAvailable() {
  const [stale, setStale] = useState(false);
  const mine = useRef(ownBundle());

  const check = useCallback(async () => {
    // No fingerprint to compare (dev server, or the tag moved) — then we
    // genuinely cannot tell, so say nothing rather than nag.
    if (!mine.current) return;
    try {
      const r = await fetch('/api/app-version', { cache: 'no-store' });
      if (!r.ok) return;
      const b = await r.json();
      const served = b && b.bundle;
      if (served && served !== mine.current) setStale(true);
    } catch (e) {
      // Offline is not stale. The cart loses signal regularly and a
      // "reload now" prompt is the worst possible advice with no network.
    }
  }, []);

  useEffect(() => {
    const t = setInterval(check, POLL_MS);
    // Coming back to the tab is the cheapest moment to notice.
    const onFocus = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onFocus); };
  }, [check]);

  useEffect(() => {
    if (stale && isSelfReloading()) {
      // Small delay so a board mid-render finishes first.
      const t = setTimeout(() => window.location.reload(true), 2000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [stale]);

  if (!stale || isSelfReloading()) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999]
                 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg
                 bg-amber-600 text-white"
    >
      <RefreshCw size={18} className="shrink-0" aria-hidden />
      <span className="text-sm font-semibold">
        A newer version is available
      </span>
      <button
        type="button"
        onClick={() => window.location.reload(true)}
        className="px-3 py-1.5 rounded-lg bg-white text-amber-700 text-sm font-bold
                   hover:bg-amber-50"
      >
        Reload
      </button>
      <button
        type="button"
        onClick={() => setStale(false)}
        className="text-white/80 hover:text-white text-sm"
        title="Keep working; it will ask again later"
      >
        Later
      </button>
    </div>
  );
}
