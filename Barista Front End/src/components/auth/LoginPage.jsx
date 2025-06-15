// src/components/auth/LoginPage.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import AuthService from '../../services/AuthService';
import OfflineDataHelper from '../../utils/offlineDataHelper';

const LoginPage = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('coffee123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFallbackOption, setShowFallbackOption] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  
  const navigate = useNavigate();
  const location = useLocation();

  // Get the intended destination from location state or query parameters
  // First check location state (React Router), then URL query params, then default to barista view
  const getRedirectPath = () => {
    // Check for location state first (set by React Router)
    if (location.state?.from) {
      return location.state.from;
    }
    
    // Check URL query parameters
    const params = new URLSearchParams(window.location.search);
    const redirectPath = params.get('redirect');
    if (redirectPath) {
      return redirectPath;
    }
    
    // Default to barista view
    return '/barista';
  };
  
  const from = getRedirectPath();
  
  // Check for existing token errors on mount
  useEffect(() => {
    const checkTokenValidity = async () => {
      // Only run if we have a token
      if (AuthService.getToken()) {
        const validationResult = AuthService.validateToken();
        
        if (!validationResult.isValid) {
          setTokenError(validationResult.error);
          setShowFallbackOption(true);
          setError(`Token error detected: ${validationResult.error}`);
        }
      }
    };
    
    checkTokenValidity();
  }, []);
  
  // Handle enabling fallback mode
  const handleEnableFallback = () => {
    OfflineDataHelper.enableFallbackMode();
    navigate('/barista', { replace: true });
  };
  
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      await AuthService.login(username, password);
      
      // Call the onLoginSuccess callback if provided
      if (onLoginSuccess) {
        onLoginSuccess();
      }
      
      // Navigate to the intended destination
      navigate(from, { replace: true });
    } catch (err) {
      console.error('Login failed:', err);
      
      // Check if this is a token-related error
      const errorMessage = err.message || 'Login failed. Please check your credentials.';
      setError(errorMessage);
      
      // If error message suggests token issues, show fallback option
      if (
        errorMessage.toLowerCase().includes('token') ||
        errorMessage.toLowerCase().includes('signature') ||
        errorMessage.toLowerCase().includes('authentication')
      ) {
        setTokenError(errorMessage);
        setShowFallbackOption(true);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h2>Coffee Cue System</h2>
          <p>ANZCA ASM 2025 Cairns</p>
        </div>
        
        <div className="login-body">
          <h3>Log In</h3>
          
          {error && (
            <div className="error-message">
              {error}
              
              {showFallbackOption && (
                <div className="fallback-option">
                  <p>Would you like to use offline mode with sample data?</p>
                  <button 
                    onClick={handleEnableFallback} 
                    className="fallback-button"
                  >
                    Enable Fallback Mode
                  </button>
                </div>
              )}
            </div>
          )}
          
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                placeholder="Username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                placeholder="Password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            
            <div className="form-actions">
              <button
                type="submit"
                className={`login-button ${loading ? 'loading' : ''}`}
                disabled={loading}
              >
                {loading ? 'Logging in...' : 'Sign In'}
              </button>
              <a
                className="forgot-password"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  alert('Please contact an administrator to reset your password.');
                }}
              >
                Forgot Password?
              </a>
            </div>
          </form>
        </div>
      </div>
      
      {/* Add some basic styling */}
      <style>{`
        .login-container {
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background-color: #f5f5f5;
        }
        
        .login-card {
          width: 100%;
          max-width: 400px;
          background: white;
          border-radius: 8px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }
        
        .login-header {
          background-color: #8B4513;
          color: white;
          padding: 20px;
          text-align: center;
        }
        
        .login-header h2 {
          margin: 0;
          font-size: 24px;
        }
        
        .login-header p {
          margin: 5px 0 0;
          opacity: 0.8;
        }
        
        .login-body {
          padding: 20px;
        }
        
        .login-body h3 {
          margin-top: 0;
          margin-bottom: 20px;
          color: #333;
        }
        
        .error-message {
          background-color: #FEE;
          border: 1px solid #F88;
          color: #C00;
          padding: 10px;
          border-radius: 4px;
          margin-bottom: 15px;
        }
        
        .form-group {
          margin-bottom: 15px;
        }
        
        .form-group label {
          display: block;
          margin-bottom: 5px;
          font-weight: bold;
          color: #555;
        }
        
        .form-group input {
          width: 100%;
          padding: 10px;
          border: 1px solid #DDD;
          border-radius: 4px;
          font-size: 16px;
        }
        
        .form-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 20px;
        }
        
        .login-button {
          background-color: #8B4513;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 16px;
          font-weight: bold;
        }
        
        .login-button:hover {
          background-color: #704214;
        }
        
        .login-button.loading {
          opacity: 0.7;
          cursor: not-allowed;
        }
        
        .forgot-password {
          color: #8B4513;
          text-decoration: none;
          font-size: 14px;
        }
        
        .forgot-password:hover {
          text-decoration: underline;
        }
        
        .fallback-option {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid #FAA;
        }
        
        .fallback-button {
          background-color: #F90;
          color: white;
          border: none;
          padding: 8px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          margin-top: 8px;
          font-weight: bold;
          width: 100%;
        }
        
        .fallback-button:hover {
          background-color: #E80;
        }
      `}</style>
    </div>
  );
};

export default LoginPage;