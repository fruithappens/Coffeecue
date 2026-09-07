// The barista's order card. The number is what you say out loud; the drink
// line is what you make; the state lives on the left edge (caramel = being
// made, green = ready) so a column of cards reads at a glance without a
// single word of colour on the chrome.
import React from 'react';
import { StatusPill } from './Pill';

const EDGE = { queued: 'border-l-cq-line', making: 'border-l-cq-caramel', ready: 'border-l-cq-ready cq-breathe' };
const STATUS_KEY = { queued: 'pending', making: 'in-progress', ready: 'completed' };

export default function OrderCard({ order, state = 'queued', badges = null, actions = null, compact = false, className = '' }) {
  const { number, name, drink, milk, sugar, notes, message, since } = order || {};
  return (
    <article className={`bg-cq-milk rounded-cq-lg shadow-cq-card border-l-[6px] ${EDGE[state] || EDGE.queued} ${compact ? 'p-3' : 'p-4'} ${className}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className={`font-extrabold leading-none tracking-tight text-cq-roast ${compact ? 'text-3xl' : 'text-5xl'}`}>#{number}</span>
            {name ? <span className={`font-bold text-cq-ink truncate ${compact ? 'text-lg' : 'text-2xl'}`}>{name}</span> : null}
          </div>
          {since ? <div className="mt-1 text-sm text-cq-ink-3">{since}</div> : null}
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <StatusPill status={STATUS_KEY[state]} size={compact ? 'sm' : 'md'} />
          {badges}
        </div>
      </header>
      <div className={`mt-3 rounded-cq-md bg-cq-wash ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
        <div className={`font-extrabold leading-snug text-cq-roast ${compact ? 'text-lg' : 'text-2xl'}`}>{drink}</div>
        {(milk || sugar) ? <div className={`text-cq-ink-2 ${compact ? 'text-sm' : 'text-base'}`}>{[milk, sugar].filter(Boolean).join(' · ')}</div> : null}
      </div>
      {notes ? <div className="mt-2 text-base text-cq-ink"><span className="font-bold">Note:</span> {notes}</div> : null}
      {message ? <div className="mt-2 rounded-cq-md bg-cq-alert-wash text-cq-alert px-3 py-2 text-base font-semibold">{message}</div> : null}
      {actions ? <footer className="mt-3 flex flex-wrap gap-2">{actions}</footer> : null}
    </article>
  );
}
