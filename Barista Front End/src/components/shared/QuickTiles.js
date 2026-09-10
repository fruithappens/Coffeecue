import React from 'react';

/**
 * The tile controls shared by the walk-in form and the order editor.
 *
 * These lived inside WalkInOrderDialog. Steve asked for the edit dialog
 * to look like the walk-in Quick view, and the wrong way to do that is
 * to copy these two components across — this codebase has spent the day
 * paying for exactly that habit (five copies of one inventory query, two
 * shapes of "extra hot", two representations of VIP). One definition,
 * two importers.
 */

export const QuickGroup = ({ label, children }) => (
  <div>
    <div className="text-xs font-extrabold uppercase tracking-wider text-cq-ink-3 mb-1.5">
      {label}
    </div>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
);

// Big enough to hit without looking, which is the point of the whole
// mode -- a barista is holding a cup in the other hand.
export const QuickTile = ({ active, onClick, emoji, label, badge, disabled }) => (
  <button
    type="button"
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    aria-disabled={disabled || undefined}
    title={disabled ? `${label} is not on the menu for this event` : undefined}
    className={`relative min-w-[6.5rem] px-3 py-2.5 rounded-cq-lg border-2 text-center
                transition-colors ${disabled
                  ? 'bg-cq-wash text-cq-ink-3 border-cq-line border-dashed cursor-not-allowed'
                  : active
                  ? 'bg-cq-caramel text-white border-cq-caramel'
                  : 'bg-cq-milk text-cq-roast border-cq-line hover:border-cq-caramel'}`}
  >
    {badge && (
      <span className={`absolute top-1 left-1.5 text-[10px] font-bold leading-none
                        ${active ? 'text-white/70' : 'text-cq-ink-3'}`}>
        {badge}
      </span>
    )}
    <span className={`block text-2xl leading-none mb-1 ${disabled ? 'opacity-40 grayscale' : ''}`}
          aria-hidden>{emoji}</span>
    <span className="block text-sm font-semibold capitalize leading-tight">{label}</span>
    {disabled && (
      <span className="block text-[10px] font-normal normal-case leading-tight text-cq-ink-3">
        not available
      </span>
    )}
  </button>
);
