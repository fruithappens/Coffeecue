import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coffee, Settings, Monitor, LogIn, User } from 'lucide-react';
import AuthService from '../services/AuthService';
import LogoutButton from './LogoutButton';
import brandingConfig from '../config/brandingConfig';

const LandingPage = () => {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check authentication status on component mount
  useEffect(() => {
    const checkAuth = async () => {
      const isAuth = await AuthService.handleAuthentication();
      setIsAuthenticated(isAuth);
    };
    checkAuth();
  }, []);

  // Functions to handle navigation
  const goToLogin = () => navigate('/login');
  const goToOrganiser = () => isAuthenticated ? navigate('/organiser') : navigate('/login', { state: { from: '/organiser' } });
  const goToBarista = () => isAuthenticated ? navigate('/barista') : navigate('/login', { state: { from: '/barista' } });
  const goToDisplayScreen = () => navigate('/displays');
  const goToSupportInterface = () => isAuthenticated ? navigate('/support') : navigate('/login', { state: { from: '/support' } });
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-6xl w-full p-6">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-amber-800 mb-2">{brandingConfig.landingTitle}</h1>
          <p className="text-xl text-gray-600">{brandingConfig.landingSubtitle}</p>
        </div>
        
        {!isAuthenticated ? (
          <div className="bg-white rounded-lg shadow-md p-8 border border-amber-200 hover:shadow-lg transition-shadow flex items-center justify-between mb-8">
            <div className="flex items-center">
              <div className="w-12 h-12 flex items-center justify-center bg-amber-100 rounded-full mr-4">
                <LogIn size={24} className="text-amber-800" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">Authentication Required</h2>
                <p className="text-gray-600">Please log in to access the system</p>
              </div>
            </div>
            <button 
              className="px-6 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors"
              onClick={goToLogin}
            >
              Log In
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-md p-8 border border-green-200 hover:shadow-lg transition-shadow flex items-center justify-between mb-8">
            <div className="flex items-center">
              <div className="w-12 h-12 flex items-center justify-center bg-green-100 rounded-full mr-4">
                <User size={24} className="text-green-700" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">Currently Logged In</h2>
                <p className="text-gray-600">
                  {AuthService.getCurrentUser()?.username || 'Authenticated User'}
                  {AuthService.getCurrentUser()?.role && ` (${AuthService.getCurrentUser().role})`}
                </p>
              </div>
            </div>
            <div className="flex space-x-3">
              <LogoutButton showIcon={true} showText={true} />
            </div>
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Client/Event Organizer Card */}
          <div className="bg-white rounded-lg shadow-md p-8 border border-gray-200 hover:shadow-lg transition-shadow flex flex-col items-center text-center">
            <div className="w-16 h-16 flex items-center justify-center bg-amber-100 rounded-full mb-4">
              <Coffee size={32} className="text-amber-800" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Client/Event Organizer</h2>
            <p className="text-gray-600">Analytics Dashboard & System Configuration</p>
            <button 
              className="mt-6 px-6 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors"
              onClick={goToOrganiser}
            >
              Sign In
            </button>
          </div>
          
          {/* Barista Card */}
          <div className="bg-white rounded-lg shadow-md p-8 border border-gray-200 hover:shadow-lg transition-shadow flex flex-col items-center text-center">
            <div className="w-16 h-16 flex items-center justify-center bg-amber-100 rounded-full mb-4">
              <Coffee size={32} className="text-amber-800" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Barista</h2>
            <p className="text-gray-600">Order Management & Coffee Production</p>
            <button 
              className="mt-6 px-6 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors"
              onClick={goToBarista}
            >
              Sign In
            </button>
          </div>
          
          {/* Support Staff Card */}
          <div className="bg-white rounded-lg shadow-md p-8 border border-gray-200 hover:shadow-lg transition-shadow flex flex-col items-center text-center">
            <div className="w-16 h-16 flex items-center justify-center bg-gray-100 rounded-full mb-4">
              <Settings size={32} className="text-gray-700" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Support Staff</h2>
            <p className="text-gray-600">Technical Monitoring & Troubleshooting</p>
            <button 
              className="mt-6 px-6 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
              onClick={goToSupportInterface}
            >
              Sign In
            </button>
          </div>
          
          {/* Display Screen Card */}
          <div className="bg-white rounded-lg shadow-md p-8 border border-gray-200 hover:shadow-lg transition-shadow flex flex-col items-center text-center">
            <div className="w-16 h-16 flex items-center justify-center bg-blue-100 rounded-full mb-4">
              <Monitor size={32} className="text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Display Screen</h2>
            <p className="text-gray-600">Order Status Display</p>
            <button 
              className="mt-6 px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              onClick={goToDisplayScreen}
            >
              Access
            </button>
          </div>
        </div>
        
        <div className="text-center mt-10 text-gray-500 text-sm">
          <p>{brandingConfig.footerText}</p>
          
          {/* Direct login link */}
          <div className="mt-4">
            <a 
              href="/login" 
              className="text-amber-600 hover:text-amber-800 hover:underline"
            >
              Go to Login Page
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;