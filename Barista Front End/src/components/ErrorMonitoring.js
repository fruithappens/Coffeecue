import React, { useState, useEffect } from 'react';
import { AlertTriangle, Clock, User, Monitor, RefreshCw, Download, Trash2, X } from 'lucide-react';

/**
 * Error Monitoring Component for Support Staff
 * Displays all captured errors from ErrorBoundary components
 */
const ErrorMonitoring = () => {
  const [errors, setErrors] = useState([]);
  const [filteredErrors, setFilteredErrors] = useState([]);
  const [filter, setFilter] = useState('all');
  const [selectedError, setSelectedError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    loadErrors();
    
    // Auto-refresh every 30 seconds if enabled
    let interval;
    if (autoRefresh) {
      interval = setInterval(loadErrors, 30000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh]);

  useEffect(() => {
    filterErrors();
  }, [errors, filter]);

  const loadErrors = () => {
    try {
      const storedErrors = JSON.parse(localStorage.getItem('coffee_system_errors') || '[]');
      // Sort by timestamp (newest first)
      const sortedErrors = storedErrors.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setErrors(sortedErrors);
    } catch (error) {
      console.error('Failed to load error data:', error);
    }
  };

  const filterErrors = () => {
    let filtered = [...errors];
    
    if (filter === 'recent') {
      // Last 24 hours
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      filtered = filtered.filter(error => new Date(error.timestamp) > yesterday);
    } else if (filter === 'critical') {
      // Component errors (as opposed to API errors)
      filtered = filtered.filter(error => error.component !== 'API Service');
    } else if (filter === 'api') {
      filtered = filtered.filter(error => error.component === 'API Service');
    }
    // 'all' case - no additional filtering needed
    
    setFilteredErrors(filtered);
  };

  const clearAllErrors = () => {
    if (window.confirm('Are you sure you want to clear all error logs? This cannot be undone.')) {
      localStorage.removeItem('coffee_system_errors');
      localStorage.removeItem('supportErrors');
      localStorage.removeItem('errorLog');
      setErrors([]);
      setFilteredErrors([]);
      setSelectedError(null);
    }
  };

  const exportErrors = () => {
    const dataStr = JSON.stringify(errors, null, 2);
    const dataBlob = new Blob([dataStr], {type: 'application/json'});
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `coffee_system_errors_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getErrorSeverity = (error) => {
    if (error.error.name === 'ChunkLoadError' || error.error.message.includes('Loading chunk')) {
      return 'warning';
    }
    if (error.retryCount > 2) {
      return 'critical';
    }
    return 'error';
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'text-red-600 bg-red-50 border-red-200';
      case 'error': return 'text-orange-600 bg-orange-50 border-orange-200';
      case 'warning': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800 flex items-center">
          <Monitor className="mr-2" size={24} />
          Error Monitoring
        </h2>
        <div className="flex items-center space-x-2">
          <label className="flex items-center text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="mr-1"
            />
            Auto-refresh
          </label>
          <button
            onClick={loadErrors}
            className="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600 flex items-center"
          >
            <RefreshCw size={14} className="mr-1" />
            Refresh
          </button>
          <button
            onClick={exportErrors}
            className="bg-green-500 text-white px-3 py-1 rounded text-sm hover:bg-green-600 flex items-center"
          >
            <Download size={14} className="mr-1" />
            Export
          </button>
          <button
            onClick={clearAllErrors}
            className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600 flex items-center"
          >
            <Trash2 size={14} className="mr-1" />
            Clear All
          </button>
        </div>
      </div>

      {/* Filter Options */}
      <div className="mb-4 flex space-x-2">
        {[
          { key: 'all', label: 'All Errors' },
          { key: 'recent', label: 'Last 24h' },
          { key: 'critical', label: 'Component Errors' },
          { key: 'api', label: 'API Errors' }
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1 rounded text-sm ${
              filter === key 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Error Statistics */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-50 p-3 rounded text-center">
          <div className="text-2xl font-bold text-gray-800">{errors.length}</div>
          <div className="text-sm text-gray-600">Total Errors</div>
        </div>
        <div className="bg-red-50 p-3 rounded text-center">
          <div className="text-2xl font-bold text-red-600">
            {errors.filter(e => getErrorSeverity(e) === 'critical').length}
          </div>
          <div className="text-sm text-gray-600">Critical</div>
        </div>
        <div className="bg-orange-50 p-3 rounded text-center">
          <div className="text-2xl font-bold text-orange-600">
            {errors.filter(e => getErrorSeverity(e) === 'error').length}
          </div>
          <div className="text-sm text-gray-600">Errors</div>
        </div>
        <div className="bg-yellow-50 p-3 rounded text-center">
          <div className="text-2xl font-bold text-yellow-600">
            {errors.filter(e => getErrorSeverity(e) === 'warning').length}
          </div>
          <div className="text-sm text-gray-600">Warnings</div>
        </div>
      </div>

      {/* Error List */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filteredErrors.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {filter === 'all' ? 'No errors recorded' : `No ${filter} errors found`}
          </div>
        ) : (
          filteredErrors.map((error, index) => {
            const severity = getErrorSeverity(error);
            const severityColor = getSeverityColor(severity);
            
            return (
              <div
                key={index}
                className={`border rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow ${severityColor}`}
                onClick={() => setSelectedError(error)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <AlertTriangle size={16} />
                      <h4 className="font-medium">{error.component}</h4>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${severityColor}`}>
                        {severity.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-sm mt-1 line-clamp-2">{error.error.message}</p>
                    <div className="flex items-center space-x-4 mt-2 text-xs">
                      <span className="flex items-center">
                        <Clock size={12} className="mr-1" />
                        {formatTimestamp(error.timestamp)}
                      </span>
                      <span className="flex items-center">
                        <User size={12} className="mr-1" />
                        {error.userId}
                      </span>
                      {error.retryCount > 0 && (
                        <span className="text-red-600">
                          Retry: {error.retryCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Error Detail Modal */}
      {selectedError && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-bold">Error Details</h3>
              <button
                onClick={() => setSelectedError(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[calc(80vh-120px)]">
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium text-gray-700">Component</h4>
                  <p className="text-sm">{selectedError.component}</p>
                </div>
                <div>
                  <h4 className="font-medium text-gray-700">Error Message</h4>
                  <p className="text-sm bg-red-50 p-2 rounded">{selectedError.error.message}</p>
                </div>
                <div>
                  <h4 className="font-medium text-gray-700">Timestamp</h4>
                  <p className="text-sm">{formatTimestamp(selectedError.timestamp)}</p>
                </div>
                <div>
                  <h4 className="font-medium text-gray-700">User</h4>
                  <p className="text-sm">{selectedError.userId}</p>
                </div>
                <div>
                  <h4 className="font-medium text-gray-700">URL</h4>
                  <p className="text-sm break-all">{selectedError.url}</p>
                </div>
                <div>
                  <h4 className="font-medium text-gray-700">User Agent</h4>
                  <p className="text-sm break-all">{selectedError.userAgent}</p>
                </div>
                {selectedError.error.stack && (
                  <div>
                    <h4 className="font-medium text-gray-700">Stack Trace</h4>
                    <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                      {selectedError.error.stack}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ErrorMonitoring;