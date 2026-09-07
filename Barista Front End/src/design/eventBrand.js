// The EVENT's brand, on the surfaces a customer sees.
//
// Steve's call: the phone page, the board and the wall wear the event's own
// identity -- Treenet's logo and name, the event's colour -- and CupQ signs
// the bottom quietly as "powered by". A delegate is at Treenet, not at CupQ.
//
// Everything here comes from the PUBLIC /api/display/config, because these
// screens have no login. One request is shared by every component that asks.
import React, { useEffect, useState } from 'react';

const FALLBACK = { eventName: '', logo: '', accent: '#B8764A', systemName: 'CupQ', sponsor: null, loaded: false };

let cached = null;      // the resolved brand
let inFlight = null;    // the shared promise

export function loadEventBrand() {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = fetch('/api/display/config')
    .then((r) => (r.ok ? r.json() : null))
    .then((b) => {
      const c = (b && (b.config || b)) || {};
      cached = {
        eventName: c.event_name || '',
        logo: c.logo || '',
        // The operator's own colour. Falls back to caramel, never to blue.
        accent: c.header_color || '#B8764A',
        systemName: c.system_name || 'CupQ',
        sponsor: c.sponsor && c.sponsor.enabled ? c.sponsor : null,
        loaded: true,
      };
      return cached;
    })
    .catch(() => ({ ...FALLBACK, loaded: true }))
    .finally(() => { inFlight = null; });
  return inFlight;
}

export function useEventBrand() {
  const [brand, setBrand] = useState(cached || FALLBACK);
  useEffect(() => {
    let alive = true;
    loadEventBrand().then((b) => { if (alive) setBrand(b); });
    return () => { alive = false; };
  }, []);
  return brand;
}

// The event's mark at the top of a customer screen. Deliberately quiet: it
// says whose event this is and then gets out of the way of the task.
export function EventHeader({ brand, className = '', align = 'center' }) {
  const b = brand || FALLBACK;
  if (!b.eventName && !b.logo) return null;
  return (
    <div className={`flex items-center gap-3 ${align === 'center' ? 'justify-center' : ''} ${className}`}>
      {b.logo ? (
        <img src={b.logo} alt="" aria-hidden className="h-10 w-auto max-w-[9rem] object-contain" />
      ) : null}
      {b.eventName ? (
        <span className="font-extrabold text-lg leading-tight truncate" style={{ color: b.accent }}>
          {b.eventName}
        </span>
      ) : null}
    </div>
  );
}

// CupQ signs the bottom. Small, once per screen, never competing with the
// event's own mark.
export function PoweredBy({ brand, className = '' }) {
  const b = brand || FALLBACK;
  return (
    <div className={`text-xs text-gray-400 ${className}`}>
      powered by <span className="font-semibold text-gray-500">{b.systemName || 'CupQ'}</span>
      <span className="mx-1.5">·</span>
      <span className="italic">Cue the cups.</span>
    </div>
  );
}

export default useEventBrand;
