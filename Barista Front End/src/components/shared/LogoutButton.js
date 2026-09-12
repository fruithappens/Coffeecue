// components/LogoutButton.js
import React from 'react';
import { LogOut } from 'lucide-react'; 
import AuthService from '../../services/AuthService';
import { askConfirm } from './ConfirmDialog';

/**
 * LogoutButton component that can be used in any interface
 * 
 * @param {Object} props - Component props
 * @param {string} props.className - Additional CSS classes for styling
 * @param {boolean} props.showIcon - Whether to show the logout icon
 * @param {boolean} props.showText - Whether to show the logout text
 */
const LogoutButton = ({ 
  className = '',
  showIcon = true,
  showText = true,
  confirmLogout = true
}) => {
  const handleLogout = async () => {
    // Ask for confirmation if confirmLogout is true
    if (confirmLogout) {
      const confirmed = await askConfirm({ title: 'Sign out?', confirmLabel: 'Sign out' });
      if (!confirmed) return;
    }
    
    AuthService.logout();
  };
  
  return (
    <button
      onClick={handleLogout}
      className={`flex items-center px-3 py-2 text-cq-alert hover:text-cq-alert hover:bg-cq-alert-wash rounded ${className}`}
      title="Log out"
    >
      {showIcon && <LogOut size={18} className="mr-1" />}
      {showText && <span>Sign Out</span>}
    </button>
  );
};

export default LogoutButton;