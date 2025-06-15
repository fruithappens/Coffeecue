// src/components/ApiTestComponent.js
import React, { useState, useEffect } from 'react';
import { apiConfig } from '../config/apiConfig';  // adjust path as needed

const ApiTestComponent = () => {
  const [connectionStatus, setConnectionStatus] = useState('checking');
  const [fallbackEnabled, setFallbackEnabled] = useState(apiConfig.getConfig().enableFallback);
  const [debugMode, setDebugMode] = useState(apiConfig.getConfig().debugMode);
  const [testResults, setTestResults] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  // Test connection on component mount
  useEffect(() => {
    testConnection();
  }, []);

  // Test API connection
  const testConnection = async () => {
    setConnectionStatus('checking');
    const isConnected = await apiConfig.checkConnection();
    setConnectionStatus(isConnected ? 'connected' : 'disconnected');
  };

  // Toggle fallback mechanism
  const toggleFallback = () => {
    const newStatus = !fallbackEnabled;
    setFallbackEnabled(newStatus);
    apiConfig.setFallbackEnabled(newStatus);
  };

  // Toggle debug mode
  const toggleDebugMode = () => {
    const newStatus = !debugMode;
    setDebugMode(newStatus);
    apiConfig.setDebugMode(newStatus);
  };

  // Test an API endpoint
  const testEndpoint = async (endpointName) => {
    setIsLoading(true);
    try {
      let result;
      const endpoint = apiConfig.endpoints[endpointName];
      
      if (!endpoint) {
        throw new Error(`Unknown endpoint: ${endpointName}`);
      }
      
      console.log(`Testing endpoint: ${endpoint}`);
      
      try {
        result = await apiConfig.fetchApi(endpoint);
        setTestResults(prev => ({
          ...prev,
          [endpointName]: {
            success: true,
            data: result,
            error: null,
            usedFallback: false
          }
        }));
      } catch (error) {
        // This means the fallback was disabled and the API call failed
        setTestResults(prev => ({
          ...prev,
          [endpointName]: {
            success: false,
            data: null,
            error: error.message,
            usedFallback: false
          }
        }));
      }
    } catch (error) {
      console.error(`Error testing ${endpointName}:`, error);
      setTestResults(prev => ({
        ...prev,
        [endpointName]: {
          success: false,
          data: null,
          error: error.message,
          usedFallback: false
        }
      }));
    } finally {
      setIsLoading(false);
    }
  };

  // List of endpoints to test
  const testableEndpoints = Object.keys(apiConfig.endpoints).filter(e => e !== 'test');

  return (
    <div className="p-6 max-w-4xl mx-auto bg-white rounded-lg shadow-md">
      <h1 className="text-2xl font-bold mb-6">API Connectivity Test</h1>
      
      <div className="mb-6 p-4 border rounded-lg">
        <h2 className="text-lg font-semibold mb-2">Connection Status</h2>
        <div className="flex items-center mb-3">
          <div 
            className={`w-4 h-4 rounded-full mr-2 ${
              connectionStatus === 'connected' ? 'bg-green-500' : 
              connectionStatus === 'disconnected' ? 'bg-red-500' : 'bg-yellow-500'
            }`}
          ></div>
          <span className="font-medium">
            {connectionStatus === 'connected' ? 'Connected to API' : 
             connectionStatus === 'disconnected' ? 'Disconnected from API' : 'Checking connection...'}
          </span>
        </div>
        <div className="space-y-2">
          <button 
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            onClick={testConnection}
            disabled={connectionStatus === 'checking'}
          >
            {connectionStatus === 'checking' ? 'Checking...' : 'Test Connection'}
          </button>
        </div>
      </div>
      
      <div className="mb-6 p-4 border rounded-lg">
        <h2 className="text-lg font-semibold mb-2">API Configuration</h2>
        <div className="space-y-3">
          <div className="flex items-center">
            <label className="inline-flex items-center">
              <input 
                type="checkbox" 
                checked={fallbackEnabled}
                onChange={toggleFallback}
                className="form-checkbox h-5 w-5 text-blue-600"
              />
              <span className="ml-2">Enable Fallback Mechanism</span>
            </label>
            <span className="ml-3 text-sm text-gray-500">
              {fallbackEnabled ? 
                '(Will use sample data if API fails)' : 
                '(Will show real errors if API fails)'}
            </span>
          </div>
          
          <div className="flex items-center">
            <label className="inline-flex items-center">
              <input 
                type="checkbox" 
                checked={debugMode}
                onChange={toggleDebugMode}
                className="form-checkbox h-5 w-5 text-blue-600"
              />
              <span className="ml-2">Enable Debug Mode</span>
            </label>
            <span className="ml-3 text-sm text-gray-500">
              (Shows detailed logs in console)
            </span>
          </div>
        </div>
      </div>
      
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Test API Endpoints</h2>
        <p className="mb-3 text-gray-600">
          Test individual API endpoints to verify connectivity. 
          {!fallbackEnabled && <span className="text-red-500 font-medium"> Warning: Fallback is disabled, real errors will be shown.</span>}
        </p>
        
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
          {testableEndpoints.map(endpoint => (
            <button
              key={endpoint}
              className="px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded text-sm"
              onClick={() => testEndpoint(endpoint)}
              disabled={isLoading}
            >
              Test {endpoint}
            </button>
          ))}
        </div>
        
        {isLoading && (
          <div className="text-center py-4">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
            <p className="mt-2 text-gray-600">Testing endpoint...</p>
          </div>
        )}
        
        {Object.keys(testResults).length > 0 && (
          <div className="mt-4 border rounded-lg overflow-hidden">
            <div className="bg-gray-100 px-4 py-2 font-medium">Test Results</div>
            <div className="divide-y">
              {Object.entries(testResults).map(([endpoint, result]) => (
                <div key={endpoint} className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-medium">{endpoint}</div>
                    <div 
                      className={`px-2 py-1 text-xs rounded-full ${
                        result.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {result.success ? 'Success' : 'Failed'}
                    </div>
                  </div>
                  
                  {result.error ? (
                    <div className="text-red-500 text-sm">{result.error}</div>
                  ) : (
                    <div>
                      <div className="text-sm mb-1">
                        {result.usedFallback ? 
                          <span className="text-orange-500">⚠️ Using fallback data</span> : 
                          <span className="text-green-500">✅ Using real API data</span>
                        }
                      </div>
                      
                      <details className="text-sm">
                        <summary className="cursor-pointer text-blue-500 hover:text-blue-700">
                          View Data
                        </summary>
                        <pre className="mt-2 bg-gray-100 p-2 rounded overflow-x-auto text-xs">
                          {JSON.stringify(result.data, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ApiTestComponent;