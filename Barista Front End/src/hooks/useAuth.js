// src/hooks/useAuth.js
import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { apiConfig } from '../config/apiConfig';
import AuthService from '../services/AuthService';

// Create an authentication context
const AuthContext = createContext(null);

// Provider component
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Initialize auth state
  useEffect(() => {
    const initAuth = async () => {
      // First check our local AuthService
      if (AuthService.isLoggedIn()) {
        const userData = AuthService.getCurrentUser();
        if (userData) {
          setUser(userData);
          setLoading(false);
          return;
        }
      }
      
      // Fallback to ApiConfig's AuthClient
      const isAuthenticated = apiConfig.AuthClient.isAuthenticated();
      
      if (isAuthenticated) {
        try {
          // Fetch user profile data
          const userData = await apiConfig.AuthClient.apiRequest('/api/user/profile');
          setUser(userData);
        } catch (error) {
          console.error('Failed to fetch user data:', error);
          // Clear invalid tokens if user data fetch fails
          await apiConfig.AuthClient.logout();
        }
      }
      
      setLoading(false);
    };
    
    initAuth();
  }, []);

  // Login function
  const login = useCallback(async (username, password) => {
    setLoading(true);
    try {
      // First try direct AuthService login
      const userData = await AuthService.login(username, password);
      setUser(userData);
      return userData;
    } catch (firstError) {
      console.warn('First login attempt failed, trying alternative method:', firstError);
      
      try {
        // Fallback to ApiConfig AuthClient
        const userData = await apiConfig.AuthClient.login(username, password);
        setUser(userData);
        return userData;
      } catch (secondError) {
        console.error('Both login methods failed:', secondError);
        throw secondError;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Logout function
  const logout = useCallback(async () => {
    setLoading(true);
    try {
      // Try both logout methods
      await AuthService.logout();
      await apiConfig.AuthClient.logout();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Provide auth context value
  const value = {
    user,
    loading,
    isAuthenticated: !!user,
    login,
    logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Hook for using the auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default useAuth;