import React from 'react';

// Semantic variants keep their meaning and take the palette's own semantic
// colours -- ready / warn / alert -- rather than raw Tailwind greens.
const variants = {
  default: 'bg-cq-wash text-cq-ink-2',
  secondary: 'bg-cq-wash text-cq-roast',
  success: 'bg-cq-ready-wash text-cq-ready',
  destructive: 'bg-cq-alert-wash text-cq-alert',
  warning: 'bg-cq-warn-wash text-cq-warn',
  outline: 'border border-cq-line text-cq-ink-2'
};

export const Badge = ({ 
  className = '', 
  variant = 'default', 
  children, 
  ...props 
}) => (
  <span
    className={`
      inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold
      ${variants[variant]} ${className}
    `}
    {...props}
  >
    {children}
  </span>
);