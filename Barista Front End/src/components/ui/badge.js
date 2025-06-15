import React from 'react';

const variants = {
  default: 'bg-gray-100 text-gray-800',
  secondary: 'bg-gray-100 text-gray-900',
  success: 'bg-green-100 text-green-800',
  destructive: 'bg-red-100 text-red-800',
  warning: 'bg-yellow-100 text-yellow-800',
  outline: 'border border-gray-200'
};

export const Badge = ({ 
  className = '', 
  variant = 'default', 
  children, 
  ...props 
}) => (
  <span
    className={`
      inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
      ${variants[variant]} ${className}
    `}
    {...props}
  >
    {children}
  </span>
);