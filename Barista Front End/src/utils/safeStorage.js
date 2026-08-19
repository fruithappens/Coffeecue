// safeStorage.js — make localStorage incapable of crashing the app.
//
// THE BUG THIS FIXES
// The attendee page is embedded in the EventsAir app as a cross-origin
// iframe. On iOS, and anywhere third-party storage is blocked, merely
// TOUCHING window.localStorage throws a SecurityError — not on write, on
// access. App.js reads it during boot and MyCoffeePage reads it inside
// useState initialisers, so the throw happened before React rendered
// anything: a blank white page, no error on screen, nothing in the app to
// suggest what went wrong.
//
// It fitted every observation. The page worked opened directly (storage
// is first-party there), worked inside a desktop iframe from another
// origin (Chrome still allowed it), and failed only inside the app's
// webview — which is exactly where a delegate would meet it.
//
// WHAT THIS DOES
// Installs a drop-in replacement when the real thing is unusable, so
// every existing `localStorage.getItem(...)` call keeps working and
// simply forgets between visits. Losing "remember me" is a small,
// contained cost; a blank page is total failure.
//
// Imported for its side effect from index.js, BEFORE React renders — the
// crash happened during boot, so the guard has to be in place first.

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); },
    clear: () => { map.clear(); },
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
    // Marks the substitute, so anything that cares can tell the
    // difference between "nothing saved" and "cannot save".
    __ephemeral: true,
  };
}

// A real round-trip, not just a presence check: Safari exposes the object
// and then throws on use when storage is blocked or the quota is zero.
function storageWorks(store) {
  try {
    const probe = '__cc_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return true;
  } catch (e) {
    return false;
  }
}

export function installSafeStorage() {
  let usable = false;
  try {
    usable = !!window.localStorage && storageWorks(window.localStorage);
  } catch (e) {
    usable = false; // the access itself threw
  }
  if (usable) return false;

  const shim = makeMemoryStorage();
  try {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => shim,
    });
  } catch (e) {
    // Some engines refuse to redefine it. Nothing more we can do here;
    // callers that guard their own access still work.
    return false;
  }
  return true;
}

export default installSafeStorage;
