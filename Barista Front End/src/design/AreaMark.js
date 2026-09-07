// An area of the app is told apart by an ICON and a NAME, never by its own
// colour (Steve, 7 Sep). One mark per area; the same one in headers, on the
// sign-in landing and on the Screens list.
import React from 'react';
import { Coffee, ClipboardList, Monitor, Smartphone } from 'lucide-react';

export const AREAS = Object.freeze({
  barista:  { label: 'Barista',  Icon: Coffee,        hint: 'the cart' },
  runner:   { label: 'Runner',   Icon: ClipboardList, hint: 'the organiser on the floor' },
  display:  { label: 'Screens',  Icon: Monitor,       hint: 'boards, menus, sponsor wall' },
  customer: { label: 'Customer', Icon: Smartphone,    hint: 'phone, kiosk, beacon' },
});

const SIZES = { sm: { icon: 16, text: 'text-sm' }, md: { icon: 20, text: 'text-base' }, lg: { icon: 28, text: 'text-xl' } };

export default function AreaMark({ area = 'barista', size = 'md', label, inverse = false, className = '' }) {
  const a = AREAS[area] || AREAS.barista;
  const s = SIZES[size] || SIZES.md;
  const Icon = a.Icon;
  return (
    <span className={`inline-flex items-center gap-2 font-bold ${s.text} ${inverse ? 'text-cq-cream' : 'text-cq-roast'} ${className}`}>
      <span className={`inline-flex items-center justify-center rounded-cq-md ${inverse ? 'bg-white/15' : 'bg-cq-caramel-wash'}`} style={{ width: s.icon + 12, height: s.icon + 12 }}>
        <Icon size={s.icon} strokeWidth={2.25} />
      </span>
      {label !== null && <span>{label || a.label}</span>}
    </span>
  );
}
