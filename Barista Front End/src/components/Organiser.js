// components/Organiser.js
import React from 'react';
import EnhancedOrganizerInterface from './EnhancedOrganizerInterface';
import OrganiserInterface from './OrganiserInterface';
import AuthService from '../services/AuthService';

const Organiser = () => {
  // Force use of the new improved interface (with proper inventory management)
  // Clear any old preference to use enhanced interface
  localStorage.removeItem('use_enhanced_organizer');
  
  const handleLogout = () => {
    AuthService.logout();
    window.location.href = '/login';
  };
  
  // Always use the new OrganiserInterface with the improved station/inventory management
  return <OrganiserInterface />;
};

export default Organiser;