// src/AppRouter.js
import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Route, Switch, Redirect } from 'react-router-dom';
import AuthService from './services/AuthService';
import BaristaInterface from './components/BaristaInterface';
import LandingPage from './components/LandingPage';
import OrganiserInterface from './components/OrganiserInterface';
import SupportInterface from './components/SupportInterface';
import DisplayScreen from './components/DisplayScreen';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './components/LoginPage';

const AppRouter = () => {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);

  useEffect(() => {
    // Check authentication status when component mounts
    const checkAuth = async () => {
      try {
        const isAuthenticated = await AuthService.handleAuthentication();
        setAuthenticated(isAuthenticated);
        
        if (isAuthenticated) {
          const user = AuthService.getCurrentUser();
          setUserRole(user?.role || null);
        }
      } catch (error) {
        console.error('Authentication check failed:', error);
        setAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Show loading indicator while checking authentication
  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <Router>
      <Switch>
        {/* Login Page */}
        <Route path="/login">
          {authenticated ? <Redirect to="/" /> : <LoginPage />}
        </Route>

        {/* Home/Landing Page - Role Selection */}
        <Route exact path="/">
          {authenticated ? 
            <LandingPage userRole={userRole} /> : 
            <Redirect to="/login" />}
        </Route>

        {/* Barista Interface */}
        <ProtectedRoute 
          path="/barista" 
          component={BaristaInterface} 
          authenticated={authenticated} 
          allowedRoles={['barista', 'admin', 'staff']}
        />

        {/* Organiser Interface */}
        <ProtectedRoute 
          path="/organiser" 
          component={OrganiserInterface} 
          authenticated={authenticated} 
          allowedRoles={['staff', 'event_organizer', 'admin']}
        />

        {/* Support Interface */}
        <ProtectedRoute 
          path="/support" 
          component={SupportInterface} 
          authenticated={authenticated} 
          allowedRoles={['support', 'admin']}
        />

        {/* Display Screen */}
        <ProtectedRoute 
          path="/display" 
          component={DisplayScreen} 
          authenticated={authenticated} 
          allowedRoles={['display', 'admin', 'staff', 'barista', 'support']}
        />

        {/* Fallback route */}
        <Route path="*">
          <Redirect to="/" />
        </Route>
      </Switch>
    </Router>
  );
};

export default AppRouter;