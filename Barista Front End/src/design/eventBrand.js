// The EVENT's brand, on the surfaces a customer sees.
//
// Steve's call: the phone page, the board and the wall wear the event's own
// identity -- Treenet's logo and name, the event's colour -- and CupQ signs
// the bottom quietly as "powered by". A delegate is at Treenet, not at CupQ.
//
// Everything here comes from the PUBLIC /api/display/config, because these
// screens have no login. One request is shared by every component that asks.
import React, { useEffect, useState } from 'react';

const FALLBACK = { eventName: '', logo: '', accent: '#B8764A', systemName: 'CupQ', sponsor: null,
                   header: { mode: 'logo_name', image: '', color: '' }, loaded: false };

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
        // How the operator wants the top of a customer screen to look.
        header: {
          mode: (c.customer_header && c.customer_header.mode) || 'logo_name',
          image: (c.customer_header && c.customer_header.image) || '',
          color: (c.customer_header && c.customer_header.color) || '',
        },
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
  const h = b.header || FALLBACK.header;
  const colour = h.color || b.accent;
  const wrap = (kids) => (
    <div className={`flex items-center gap-3 ${align === 'center' ? 'justify-center' : ''} ${className}`}>{kids}</div>
  );

  // A picture chosen FOR this spot: an event's main logo is often square or
  // wide and the wrong shape for the top of a phone, so the operator can
  // supply one that fits (Steve).
  if (h.mode === 'image' && h.image) {
    return wrap(<img src={h.image} alt={b.eventName || ''} className="h-12 w-auto max-w-full object-contain" />);
  }
  const name = b.eventName ? (
    <span className="font-extrabold text-lg leading-tight truncate" style={{ color: colour }}>{b.eventName}</span>
  ) : null;
  // Just the words, in the operator's colour.
  if (h.mode === 'name') return name ? wrap(name) : null;
  if (!b.eventName && !b.logo) return null;
  return wrap(
    <>
      {b.logo ? <img src={b.logo} alt="" aria-hidden className="h-10 w-auto max-w-[9rem] object-contain" /> : null}
      {name}
    </>,
  );
}

// CupQ signs the bottom. Small, once per screen, never competing with the
// event's own mark.
export function PoweredBy({ brand, className = '' }) {
  const b = brand || FALLBACK;
  return (
    <div className={`text-xs text-cq-ink-3 ${className}`}>
      powered by <span className="font-semibold text-cq-ink-3">{b.systemName || 'CupQ'}</span>
      <span className="mx-1.5">·</span>
      <span className="italic">Cue the cups.</span>
    </div>
  );
}

export default useEventBrand;
