import React from 'react';

export const Switch = ({ checked = false, onCheckedChange, disabled = false, className = '' }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`
        relative inline-flex h-6 w-11 items-center rounded-full transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cq-caramel 
        focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50
        ${checked ? 'bg-cq-roast' : 'bg-cq-wash'}
        ${className}
      `}
      onClick={() => onCheckedChange && onCheckedChange(!checked)}
    >
      <span className="sr-only">Toggle</span>
      <span
        className={`
          ${checked ? 'translate-x-6' : 'translate-x-1'}
          inline-block h-4 w-4 transform rounded-full bg-cq-milk transition
        `}
      />
    </button>
  );
};