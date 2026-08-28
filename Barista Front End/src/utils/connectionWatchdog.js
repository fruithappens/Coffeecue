// Self-healing for screens nobody is standing next to.
//
// Steve: "if the browser goes into offline mode sample data is there a
// way the browser can attempt a refresh itself rather than exit
// fullscreen mode or putting a keyboard and using keystroke to force
// refresh." An iPad in fullscreen standalone mode has no address bar
// and no F5 -- once the venue WiFi blips and the app falls back to
// cached data, a human has to walk over with a keyboard. That is the
// wrong employee for the job.
//
// This pings /api/health on a slow loop. When the server answers again
// AFTER having been unreachable, the page reloads itself -- the exact
// thing the keyboard-and-F5 walk was for. Two guards:
//
//   * TRANSITION-ONLY: it reloads on down->up, never while still down
//     (no reload storms against a dead server) and never when the
//     connection was fine all along.
//   * IDLE-ONLY: no reload within `idleMs` of a touch or keypress.
//     A customer mid-order or a barista mid-edit keeps their screen;
//     the reload waits for the next quiet moment.
//
// navigator.onLine and the 'online' event are hints, not truth -- an
// iPad can hold a WiFi association with no working route. The ping is
// the truth; 'online' only prompts an immediate ping.

const PING_EVERY_MS = 20000;
const PING_TIMEOUT_MS = 8000;

export default function startConnectionWatchdog({ idleMs = 60000 } = {}) {
  let lastInteraction = Date.now();
  let wasDown = false;
  let pendingReload = false;
  let stopped = false;

  const bump = () => {
    lastInteraction = Date.now();
  };

  const reloadWhenIdle = () => {
    if (stopped) return;
    if (Date.now() - lastInteraction >= idleMs) {
      window.location.reload();
    } else {
      // Someone is using the screen -- try again shortly.
      pendingReload = true;
      setTimeout(reloadWhenIdle, 10000);
    }
  };

  const ping = async () => {
    if (stopped) return;
    let ok = false;
    try {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), PING_TIMEOUT_MS);
      const r = await fetch('/api/health', {
        cache: 'no-store',
        signal: abort.signal,
      }).finally(() => clearTimeout(timer));
      ok = r.ok;
    } catch (e) {
      ok = false;
    }
    if (ok) {
      if (wasDown && !pendingReload) {
        pendingReload = true;
        reloadWhenIdle();
      }
      wasDown = false;
    } else {
      wasDown = true;
    }
  };

  window.addEventListener('pointerdown', bump, true);
  window.addEventListener('keydown', bump, true);
  window.addEventListener('online', ping);
  const timer = setInterval(ping, PING_EVERY_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener('pointerdown', bump, true);
    window.removeEventListener('keydown', bump, true);
    window.removeEventListener('online', ping);
  };
}
