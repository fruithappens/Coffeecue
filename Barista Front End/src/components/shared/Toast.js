import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

const Toast = ({ message, type = 'info', duration = 3000, onClose }) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      if (onClose) onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  if (!isVisible) return null;

  const icons = {
    success: <CheckCircle size={20} />,
    error: <XCircle size={20} />,
    warning: <AlertCircle size={20} />,
    info: <Info size={20} />
  };

  const colors = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    warning: 'bg-amber-500',
    info: 'bg-blue-500'
  };

  return (
    // `relative`, NOT `fixed`. ToastManager already positions the stack and
    // spaces it; every toast being fixed to the same corner meant two at once
    // landed exactly on top of each other, so only the last one could be read
    // -- and a low-stock warning could bury the message you needed.
    <div className={`relative ${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center space-x-3 animate-slide-in`}>
      {icons[type]}
      <span className="flex-1">{message}</span>
      <button
        onClick={() => {
          setIsVisible(false);
          if (onClose) onClose();
        }}
        className="hover:opacity-80"
      >
        <X size={16} />
      </button>
    </div>
  );
};

// Toast Manager to handle multiple toasts
export const ToastManager = () => {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    // Listen for custom toast events.
    // Same bug as NotificationSystem had: Date.now() alone collides
    // for back-to-back events in the same millisecond. Append a
    // counter so React keys stay unique.
    let counter = 0;
    const handleToast = (event) => {
      const { message, type, duration } = event.detail;
      counter += 1;
      const id = `${Date.now()}-${counter}`;
      setToasts(prev => [...prev, { id, message, type, duration }]);
    };

    window.addEventListener('app:toast', handleToast);
    return () => window.removeEventListener('app:toast', handleToast);
  }, []);

  const removeToast = (id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  return (
    <div className="fixed top-4 right-4 space-y-2 z-50">
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
};

// Utility function to show toast
export const showToast = (message, type = 'info', duration = 3000) => {
  window.dispatchEvent(new CustomEvent('app:toast', {
    detail: { message, type, duration }
  }));
};

export default Toast;