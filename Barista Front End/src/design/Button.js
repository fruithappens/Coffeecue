// The button. Caramel is the ONE action colour; red only for something a
// person must stop and think about; roast (dark) for the board's chrome.
// Minimum 48 px tall at md/lg: a barista's thumb, a wet counter.
import React from 'react';

const VARIANTS = {
  primary:   'bg-cq-caramel text-white hover:bg-cq-caramel-deep active:bg-cq-caramel-deep shadow-cq-card',
  secondary: 'bg-cq-milk text-cq-roast border-2 border-cq-line hover:border-cq-caramel hover:text-cq-caramel-deep',
  ghost:     'bg-transparent text-cq-ink-2 hover:bg-cq-wash hover:text-cq-roast',
  dark:      'bg-cq-roast text-cq-cream hover:bg-cq-roast-deep',
  danger:    'bg-cq-alert text-white hover:brightness-95',
  ready:     'bg-cq-ready text-white hover:brightness-95 shadow-cq-card',
};
const SIZES = {
  sm: 'h-9 px-3 text-sm rounded-cq-sm gap-1.5',
  md: 'h-12 px-5 text-base rounded-cq-md gap-2',
  lg: 'h-14 px-6 text-lg rounded-cq-lg gap-2.5',
};

export default function Button({ variant = 'primary', size = 'md', Icon, block = false, disabled = false, className = '', children, ...rest }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex items-center justify-center font-bold leading-none select-none transition-colors
        ${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size] || SIZES.md} ${block ? 'w-full' : ''}
        ${disabled ? 'opacity-40 pointer-events-none' : ''} ${className}`}
      {...rest}
    >
      {Icon ? <Icon size={size === 'sm' ? 16 : 20} strokeWidth={2.5} /> : null}
      {children}
    </button>
  );
}
