// src/components/ProtectedRoute.js

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { apiConfig } from '../config/apiConfig';

/**
 * Protected Route component that checks if user is authenticated
 * Redirects to login page if not authenticated
 */
const ProtectedRoute = ({ children }) => {
  const location = useLocation();
  const isAuthenticated = apiConfig.AuthClient.isAuthenticated();

  if (!isAuthenticated) {
    // Redirect to login page, but save the current location they were
    // trying to go to when they were redirected.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

export default ProtectedRoute;