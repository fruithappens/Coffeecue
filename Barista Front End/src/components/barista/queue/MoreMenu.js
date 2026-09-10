// The "..." behind every card: everything that is not the ONE primary
// action. A 48 px target, a plain list, closes on any outside tap.
import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

export default function MoreMenu({ items = [], label = 'More', align = 'right', direction = 'up', Icon: TriggerIcon = MoreHorizontal, triggerClassName = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const visible = items.filter(Boolean);
  if (visible.length === 0) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`h-12 w-12 inline-flex items-center justify-center rounded-cq-md bg-cq-milk border-2 border-cq-line text-cq-ink-2 hover:border-cq-caramel hover:text-cq-roast ${triggerClassName}`}
      >
        <TriggerIcon size={22} strokeWidth={2.5} />
      </button>
      {open ? (
        <div className={`absolute z-40 ${direction === 'down' ? 'top-14' : 'bottom-14'} ${align === 'right' ? 'right-0' : 'left-0'} min-w-[14rem] bg-cq-milk rounded-cq-lg shadow-cq-raised border border-cq-line py-1.5`}>
          {visible.map(({ label: l, Icon, onClick, disabled, danger, hint }, i) => (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => { setOpen(false); onClick && onClick(); }}
              title={hint}
              className={`w-full flex items-center gap-3 px-4 h-12 text-left text-base font-semibold ${disabled ? 'opacity-40' : danger ? 'text-cq-alert hover:bg-cq-alert-wash' : 'text-cq-ink hover:bg-cq-wash'}`}
            >
              {Icon ? <Icon size={18} strokeWidth={2.25} /> : null}
              <span className="flex-1">{l}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
