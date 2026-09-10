// A station, as a chip: its name, how many are waiting, whether it is the
// one you are at. The header shows a FEW of these -- the ones you chose to
// watch -- never one per cart (Steve saw 200 chips fill a screen).
import React from 'react';

export default function StationChip({ name, queue = 0, selected = false, status = 'active', onClick, compact = false, className = '' }) {
  const off = status !== 'active';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`inline-flex items-center gap-2 rounded-full font-bold leading-none whitespace-nowrap transition-colors
        ${compact ? 'h-9 px-3 text-sm' : 'h-11 px-4 text-base'}
        ${selected ? 'bg-cq-roast text-cq-cream' : 'bg-cq-milk text-cq-roast border-2 border-cq-line hover:border-cq-caramel'}
        ${off ? 'opacity-60' : ''} ${className}`}
    >
      <span className={`w-2.5 h-2.5 rounded-full ${off ? 'bg-cq-alert' : 'bg-cq-ready'}`} aria-hidden />
      <span className="truncate max-w-[10rem]">{name}</span>
      <span className={`inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-full text-sm ${selected ? 'bg-cq-milk/15' : 'bg-cq-wash text-cq-ink-2'}`}>{queue}</span>
    </button>
  );
}
