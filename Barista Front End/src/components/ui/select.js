import React from 'react';

export const Select = ({ className = '', children, ...props }) => (
  <select
    className={`
      flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 
      text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 
      focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed 
      disabled:opacity-50
      ${className}
    `}
    {...props}
  >
    {children}
  </select>
);