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
    <div className={`fixed top-4 right-4 ${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center space-x-3 z-50 animate-slide-in`}>
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
    // Listen for custom toast events
    const handleToast = (event) => {
      const { message, type, duration } = event.detail;
      const id = Date.now();
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