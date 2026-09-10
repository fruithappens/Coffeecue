// Status pills. Tone comes from the ONE status vocabulary; the words come
// from there too, so a pill can never say something the beacon doesn't.
import React from 'react';
import { staffStatus } from '../constants/customerStatus';

const TONES = {
  neutral: 'bg-cq-wash text-cq-ink-2',
  caramel: 'bg-cq-caramel text-white',
  ready:   'bg-cq-ready text-white',
  alert:   'bg-cq-alert text-white',
  muted:   'bg-cq-line text-cq-ink-3',
  roast:   'bg-cq-roast text-cq-cream',
  outline: 'bg-transparent text-cq-ink-2 border border-cq-line',
};
const SIZES = { sm: 'h-6 px-2 text-xs', md: 'h-7 px-3 text-sm', lg: 'h-9 px-4 text-base' };

export function Pill({ tone = 'neutral', size = 'md', dot = false, className = '', children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-bold uppercase tracking-wide leading-none whitespace-nowrap ${TONES[tone] || TONES.neutral} ${SIZES[size] || SIZES.md} ${className}`}>
      {dot ? <span className="w-2 h-2 rounded-full bg-current opacity-90" /> : null}
      {children}
    </span>
  );
}

// <StatusPill status="in-progress" /> -> "MAKING" in caramel.
export function StatusPill({ status, size = 'md', className = '' }) {
  const s = staffStatus(status);
  if (!s) return null;
  return <Pill tone={s.tone} size={size} className={className}>{s.label}</Pill>;
}

export default Pill;
