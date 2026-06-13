// components/SupportApiNotificationBanner.js
import React from 'react';
import { AlertTriangle } from 'lucide-react';

const SupportApiNotificationBanner = ({ title, message }) => {
  return (
    <div className="bg-indigo-50 border-l-4 border-indigo-500 text-indigo-700 p-4 mb-4 rounded">
      <div className="flex">
        <div className="py-1">
          <AlertTriangle className="h-6 w-6 text-indigo-500 mr-4" />
        </div>
        <div>
          <p className="font-bold">{title}</p>
          <p className="text-sm">{message}</p>
        </div>
      </div>
    </div>
  );
};

export default SupportApiNotificationBanner;