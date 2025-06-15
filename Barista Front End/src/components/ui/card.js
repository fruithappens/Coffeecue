import React from 'react';

export const Card = ({ className = '', children, ...props }) => (
  <div className={`bg-white rounded-lg shadow-sm border ${className}`} {...props}>
    {children}
  </div>
);

export const CardHeader = ({ className = '', children, ...props }) => (
  <div className={`px-6 py-4 border-b ${className}`} {...props}>
    {children}
  </div>
);

export const CardTitle = ({ className = '', children, ...props }) => (
  <h3 className={`text-lg font-semibold ${className}`} {...props}>
    {children}
  </h3>
);

export const CardContent = ({ className = '', children, ...props }) => (
  <div className={`px-6 py-4 ${className}`} {...props}>
    {children}
  </div>
);