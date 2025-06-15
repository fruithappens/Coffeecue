// components/auth/UnauthorizedPage.js
import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthService from '../../services/AuthService';
import LogoutButton from '../LogoutButton';

/**
 * Unauthorized access page displayed when a user doesn't have the required role
 */
const UnauthorizedPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const currentUser = AuthService.getCurrentUser();
  
  // Get required roles from location state, if available
  const requiredRoles = location.state?.requiredRoles || [];
  
  // Handle logout
  const handleLogout = () => {
    AuthService.logout();
  };
  
  // Handle going back
  const handleGoBack = () => {
    navigate(-1);
  };

  // Determine landing page based on user role
  const getLandingPage = () => {
    if (!currentUser) return '/';
    
    switch (currentUser.role) {
      case 'admin':
        return '/admin';
      case 'staff':
      case 'event_organizer':
        return '/organiser';
      case 'barista':
        return '/barista';
      case 'support':
        return '/support';
      default:
        return '/';
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
        <div className="text-center mb-6">
          <div className="bg-red-100 text-red-600 p-3 rounded-full inline-flex items-center justify-center w-16 h-16 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Access Denied</h1>
          <p className="text-gray-600 mt-2">
            You don't have permission to access this page.
          </p>
        </div>
        
        {requiredRoles.length > 0 && (
          <div className="bg-gray-50 p-4 rounded-lg mb-6">
            <p className="text-sm text-gray-700 mb-2">Required roles:</p>
            <div className="flex flex-wrap gap-2">
              {requiredRoles.map(role => (
                <span key={role} className="bg-gray-200 text-gray-700 px-3 py-1 rounded-full text-sm">
                  {role}
                </span>
              ))}
            </div>
          </div>
        )}
        
        {currentUser && (
          <div className="text-center text-gray-700 mb-6">
            <p>You are signed in as:</p>
            <p className="font-medium">{currentUser.username}</p>
            <p className="text-sm">Role: {currentUser.role}</p>
          </div>
        )}
        
        <div className="flex flex-col space-y-3">
          <Link 
            to={getLandingPage()} 
            className="bg-amber-600 text-white py-2 px-4 rounded hover:bg-amber-700 text-center"
          >
            Go to Dashboard
          </Link>
          
          <button 
            onClick={handleGoBack}
            className="bg-gray-200 text-gray-800 py-2 px-4 rounded hover:bg-gray-300"
          >
            Go Back
          </button>
          
          <LogoutButton 
            showIcon={true} 
            showText={true}
            className="justify-center py-2 px-4 w-full"
            confirmLogout={false}
          />
        </div>
      </div>
    </div>
  );
};

export default UnauthorizedPage;