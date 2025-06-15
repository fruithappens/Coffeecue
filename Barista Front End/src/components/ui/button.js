import React from 'react';

const variants = {
  default: 'bg-blue-600 text-white hover:bg-blue-700',
  destructive: 'bg-red-600 text-white hover:bg-red-700',
  outline: 'border border-gray-300 bg-white hover:bg-gray-50',
  secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300',
  ghost: 'hover:bg-gray-100',
  link: 'text-blue-600 underline-offset-4 hover:underline'
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
      inline-flex items-center justify-center rounded-md font-medium 
      transition-colors focus-visible:outline-none focus-visible:ring-2 
      focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50
      ${variants[variant]} ${sizes[size]} ${className}
    `}
    disabled={disabled}
    {...props}
  >
    {children}
  </button>
);