// components/LogoutButton.js
import React from 'react';
import { LogOut } from 'lucide-react'; 
import AuthService from '../services/AuthService';

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
  const handleLogout = () => {
    // Ask for confirmation if confirmLogout is true
    if (confirmLogout) {
      const confirmed = window.confirm('Are you sure you want to log out?');
      if (!confirmed) return;
    }
    
    AuthService.logout();
  };
  
  return (
    <button
      onClick={handleLogout}
      className={`flex items-center px-3 py-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded ${className}`}
      title="Log out"
    >
      {showIcon && <LogOut size={18} className="mr-1" />}
      {showText && <span>Sign Out</span>}
    </button>
  );
};

export default LogoutButton;