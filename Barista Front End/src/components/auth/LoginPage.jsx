// src/components/auth/LoginPage.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import AuthService from '../../services/AuthService';
import OfflineDataHelper from '../../utils/offlineDataHelper';
import SettingsService from '../../services/SettingsService';
import roleLanding from '../../utils/roleLanding';

const LoginPage = ({ onLoginSuccess }) => {
  // SECURITY: never pre-fill credentials. These used to default to
  // 'admin'/'coffee123', which broadcast working admin creds to anyone
  // who opened the login page (found in the 2026-06-13 public-surfaces
  // audit). Dev convenience is not worth shipping a master key.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFallbackOption, setShowFallbackOption] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [brandingSettings, setBrandingSettings] = useState(null);
  
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
    
    // No explicit destination: decide by ROLE once we know it (after
    // sign-in). This used to hard-code /barista, which is wrong for an
    // organiser and a dead end for a display account.
    return null;
  };
  
  const from = getRedirectPath();

  // Already signed in and landed on the sign-in page (a bookmark, a back
  // button): skip the form and go where this account belongs.
  useEffect(() => {
    try {
      if (AuthService.getToken() && AuthService.validateToken().isValid) {
        navigate(from || roleLanding(AuthService.getCurrentUser()?.role), { replace: true });
      }
    } catch (e) { /* show the form */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Check for existing token errors on mount and load branding settings
  useEffect(() => {
    const checkTokenValidity = async () => {
      // Check for logout message from forced logout
      const logoutMessage = AuthService.getAndClearLogoutMessage();
      if (logoutMessage) {
        setError(logoutMessage);
        setShowFallbackOption(false); // Don't show fallback for logout messages
        return;
      }
      
      // Check for deployment changes
      AuthService.handleDeploymentChange();
      
      // Only run token validation if we have a token
      if (AuthService.getToken()) {
        const validationResult = AuthService.validateToken();
        
        if (!validationResult.isValid) {
          setTokenError(validationResult.error);
          setShowFallbackOption(true);
          setError(`Token error detected: ${validationResult.error}`);
        }
      }
    };
    
    const loadBrandingSettings = async () => {
      try {
        const settings = await SettingsService.getBrandingSettings();
        setBrandingSettings(settings);
      } catch (error) {
        console.error('Failed to load branding settings:', error);
        // Use default settings if API fails
        setBrandingSettings({
          systemName: 'Coffee Cue System',
          event_name: 'Coffee Event',
          organization_name: 'Coffee Cue'
        });
      }
    };
    
    checkTokenValidity();
    loadBrandingSettings();
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
      
      // Navigate to the intended destination, else by role: barista ->
      // the board, display -> the screens, support -> support, everyone
      // else -> /welcome (the section chooser).
      navigate(from || roleLanding(AuthService.getCurrentUser()?.role), { replace: true });
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

  // Event logo (base64 data-URI from the Branding panel), if set.
  const logo = brandingSettings?.clientLogo || brandingSettings?.logo || brandingSettings?.logoUrl || '';

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          {logo
            ? <img src={logo} alt="" className="login-logo" />
            : <div className="login-logo-fallback" aria-hidden="true">☕</div>}
          <h2>{brandingSettings?.systemName || brandingSettings?.organization_name || 'Coffee Cue System'}</h2>
          <p>{brandingSettings?.event_name || 'Coffee Event'}</p>
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
              {/* No self-service reset exists, so don't render a link that
                  pretends one does (it was an href="#" + alert). Plain
                  guidance instead — organisers reset passwords from the
                  Users tab. */}
              <span className="forgot-password text-sm text-gray-500">
                Forgot your password? Ask your event organiser to reset it.
              </span>
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
          padding: 20px;
          background: linear-gradient(135deg, #6F4E37 0%, #8B4513 45%, #C8821A 100%);
        }

        .login-card {
          width: 100%;
          max-width: 400px;
          background: white;
          border-radius: 14px;
          box-shadow: 0 18px 45px rgba(0, 0, 0, 0.28);
          overflow: hidden;
        }

        .login-header {
          background: linear-gradient(135deg, #8B4513 0%, #A05A1E 100%);
          color: white;
          padding: 28px 20px;
          text-align: center;
        }

        .login-logo {
          max-height: 76px;
          max-width: 220px;
          margin: 0 auto 12px;
          display: block;
          object-fit: contain;
        }

        .login-logo-fallback {
          width: 64px;
          height: 64px;
          line-height: 64px;
          margin: 0 auto 10px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.18);
          font-size: 32px;
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