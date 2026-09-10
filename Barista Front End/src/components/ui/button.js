import React from 'react';

// On the CupQ palette. These primitives are used by four support screens and
// were built on blue/grey Tailwind, which is why those screens never looked
// like the rest of the app however many times the screens themselves were
// tidied. Same API, same variant names -- only the colours move.
const variants = {
  default: 'bg-cq-roast text-cq-cream hover:bg-cq-caramel-deep',
  destructive: 'bg-cq-alert text-white hover:opacity-90',
  outline: 'border border-cq-line bg-cq-milk text-cq-ink-2 hover:bg-cq-wash',
  secondary: 'bg-cq-wash text-cq-roast hover:bg-cq-caramel-wash',
  ghost: 'text-cq-ink-2 hover:bg-cq-wash',
  link: 'text-cq-caramel-deep underline-offset-4 hover:underline'
};

const sizes = {
  default: 'px-4 py-2',
  sm: 'px-3 py-1 text-sm',
  lg: 'px-6 py-3',
  icon: 'p-2'
};

export const Button = ({ 
  className = '', 
  variant = 'default', 
  size = 'default',
  disabled = false,
  children, 
  ...props 
}) => (
  <button
    className={`
      inline-flex items-center justify-center rounded-cq-md font-semibold 
      transition-colors focus-visible:outline-none focus-visible:ring-2
      focus-visible:ring-cq-caramel focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50
      ${variants[variant]} ${sizes[size]} ${className}
    `}
    disabled={disabled}
    {...props}
  >
    {children}
  </button>
);