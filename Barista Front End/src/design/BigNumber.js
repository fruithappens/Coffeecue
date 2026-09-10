// The board number -- the biggest thing CupQ draws. Read from four metres:
// tabular numerals so a column of them lines up, a 6 px state ring on the
// card (caramel = brewing, green = ready), and the name beside it big
// enough to find from the same distance.
import React from 'react';

export default function BigNumber({ number, name, details, state = 'making', isNew = false, dark = false, className = '' }) {
  // A BORDER, not a Tailwind ring: rings are box-shadows, and the breathe
  // animation animates box-shadow, so a ring vanished the moment the card
  // went green (seen on the first sheet).
  const edge = state === 'ready' ? 'border-cq-ready cq-breathe' : 'border-cq-caramel';
  return (
    <div className={`relative rounded-cq-xl border-[6px] ${edge} ${dark ? 'bg-cq-roast text-cq-cream' : 'bg-cq-milk text-cq-roast'} px-8 py-5 shadow-cq-raised ${className}`}>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div className="font-extrabold leading-none tracking-tighter" style={{ fontSize: 'var(--cq-text-board)' }}>#{number}</div>
        {name ? <div className="font-bold leading-none truncate" style={{ fontSize: 'calc(var(--cq-text-board) * 0.4)' }}>{name}</div> : null}
      </div>
      {details ? <div className={`mt-2 font-semibold ${dark ? 'text-cq-tan' : 'text-cq-ink-2'}`} style={{ fontSize: 'calc(var(--cq-text-board) * 0.2)' }}>{details}</div> : null}
      {isNew && state === 'ready' ? <span className="absolute -top-3 -right-3 rounded-full bg-cq-ready text-white text-sm font-bold px-3 py-1 uppercase tracking-wide">just now</span> : null}
    </div>
  );
}
