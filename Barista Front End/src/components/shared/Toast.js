import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

const Toast = ({ message, type = 'info', duration = 3000, onClose, standalone = true }) => {
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
    success: 'bg-cq-ready',
    error: 'bg-cq-alert',
    warning: 'bg-cq-caramel',
    info: 'bg-cq-caramel'
  };

  return (
    <div className={`${standalone ? 'fixed top-4 right-4 z-50' : 'relative'} ${colors[type]} text-white px-4 py-3 rounded-cq-md shadow-lg flex items-center space-x-3 animate-slide-in`}>
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
// position: 'top-right' (default) or 'bottom-center'. The barista screen
// uses bottom-center: at top-right the stack sat on the header's lock
// button, and two toasts at once used to land on the same spot.
export const ToastManager = ({ position = 'top-right' } = {}) => {
  // 'bottom-center-high' clears a strip pinned to the bottom of the screen.
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
    <div className={`fixed z-50 space-y-2 ${position === 'bottom-center' ? 'bottom-6 left-1/2 -translate-x-1/2 w-[min(92vw,40rem)]' : position === 'bottom-center-high' ? 'bottom-24 left-1/2 -translate-x-1/2 w-[min(92vw,40rem)]' : 'top-4 right-4'}`}>
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          standalone={false}
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