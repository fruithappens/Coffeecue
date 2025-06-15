// components/auth/AuthGuard.js
import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import AuthService from '../../services/AuthService';

/**
 * AuthGuard component that provides role-based access control
 * @param {Object} props - Component props
 * @param {Array} props.requiredRoles - Array of roles that are allowed to access the route
 * @param {React.ReactNode} props.children - Child components to render if authenticated
 * @param {string} [props.redirectPath='/login'] - Path to redirect to if not authenticated
 */
const AuthGuard = ({ requiredRoles = [], children, redirectPath = '/login' }) => {
  const location = useLocation();
  const [authState, setAuthState] = useState({
    isChecking: true,
    isAuthenticated: false,
    hasRequiredRole: false,
  });

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Check if authenticated and token is valid
        const isAuthenticated = await AuthService.handleAuthentication();
        
        // If not authenticated, no need to check roles
        if (!isAuthenticated) {
          setAuthState({
            isChecking: false,
            isAuthenticated: false,
            hasRequiredRole: false,
          });
          return;
        }
        
        // Get current user
        const currentUser = AuthService.getCurrentUser();
        
        // Check if user has required role (if any roles specified)
        let hasRequiredRole = true;
        if (requiredRoles.length > 0) {
          hasRequiredRole = currentUser && requiredRoles.includes(currentUser.role);
        }
        
        setAuthState({
          isChecking: false,
          isAuthenticated,
          hasRequiredRole,
        });
      } catch (error) {
        console.error('Auth check error:', error);
        setAuthState({
          isChecking: false,
          isAuthenticated: false,
          hasRequiredRole: false,
        });
      }
    };

    checkAuth();
  }, [requiredRoles, location.pathname]);

  // Show loading indicator while checking authentication
  if (authState.isChecking) {
    return <div className="flex justify-center items-center h-screen">Verifying access...</div>;
  }

  // Redirect if not authenticated or doesn't have the required role
  if (!authState.isAuthenticated) {
    // Redirect to login with the current location
    return <Navigate to={redirectPath} state={{ from: location.pathname }} replace />;
  }

  // If authenticated but doesn't have the required role
  if (!authState.hasRequiredRole) {
    // Redirect to unauthorized page (or could be dashboard with limited access)
    return <Navigate to="/unauthorized" state={{ requiredRoles }} replace />;
  }

  // If everything is OK, render the children
  return children;
};

export default AuthGuard;