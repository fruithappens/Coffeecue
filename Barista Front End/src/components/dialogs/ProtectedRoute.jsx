// src/components/dialogs/ProtectedRoute.jsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

/**
 * A wrapper for routes that require authentication or specific roles
 * 
 * @param {Object} props - Component props
 * @param {boolean} props.isAllowed - Is the user allowed based on authentication
 * @param {Array} props.roles - Optional array of roles that are allowed to access this route
 * @param {string} props.redirectPath - Where to redirect if not authenticated
 * @param {React.Component} props.element - The component to render if authenticated
 * @returns {React.Component}
 */
const ProtectedRoute = ({
  isAllowed,
  roles,
  redirectPath = '/login',
  element
}) => {
  const location = useLocation();
  const { user, isAuthenticated } = useAuth();
  
  // If we're using the auth context to determine authentication
  const isUserAuthenticated = isAllowed || isAuthenticated;
  
  // Check role-based access if roles are specified
  let hasRequiredRole = true;
  if (roles && roles.length > 0) {
    const userRole = user?.role;
    hasRequiredRole = userRole && roles.includes(userRole);
  }
  
  // If not authenticated or doesn't have required role, redirect to login
  if (!isUserAuthenticated || !hasRequiredRole) {
    return <Navigate to={redirectPath} state={{ from: location }} replace />;
  }
  
  // If authenticated and has required role, render the element
  return element;
};

export default ProtectedRoute;
