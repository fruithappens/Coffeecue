import React from 'react';
import { AlertTriangle, X, RefreshCw, Coffee } from 'lucide-react';

/**
 * Error Boundary Component for Graceful Degradation
 * Catches JavaScript errors and provides fallback UI with user controls
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      isDismissed: false,
      retryCount: 0
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error for monitoring
    this.logError(error, errorInfo);
    
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
  }

  logError = (error, errorInfo) => {
    const errorData = {
      timestamp: new Date().toISOString(),
      component: this.props.componentName || 'Unknown Component',
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      errorInfo: errorInfo,
      userAgent: navigator.userAgent,
      url: window.location.href,
      userId: localStorage.getItem('coffee_system_user') || 'anonymous',
      retryCount: this.state.retryCount
    };

    // Store error for support monitoring
    try {
      const existingErrors = JSON.parse(localStorage.getItem('coffee_system_errors') || '[]');
      existingErrors.push(errorData);
      
      // Keep only last 50 errors to prevent localStorage bloat
      if (existingErrors.length > 50) {
        existingErrors.splice(0, existingErrors.length - 50);
      }
      
      localStorage.setItem('coffee_system_errors', JSON.stringify(existingErrors));
      
      // Also log to console for debugging
      console.error('Error Boundary caught error:', errorData);
      
      // If available, send to backend error tracking
      if (window.errorTrackingService) {
        window.errorTrackingService.logError(errorData);
      }
    } catch (storageError) {
      console.error('Failed to store error data:', storageError);
    }
  };

  handleDismiss = () => {
    this.setState({ isDismissed: true });
  };

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      isDismissed: false,
      retryCount: this.state.retryCount + 1
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError && !this.state.isDismissed) {
      const { fallbackComponent: FallbackComponent, componentName } = this.props;
      
      return (
        <div className="relative">
          {/* Error Notification Banner */}
          <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-4 relative">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <AlertTriangle className="h-5 w-5 text-red-400" />
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-medium text-red-800">
                  Component Error: {componentName || 'Unknown Component'}
                </h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>
                    Something went wrong with this part of the interface. 
                    {this.state.retryCount > 0 && ` (Retry attempt: ${this.state.retryCount})`}
                  </p>
                  {this.props.showErrorDetails && (
                    <details className="mt-2 bg-red-100 p-2 rounded text-xs">
                      <summary className="cursor-pointer font-medium">Technical Details</summary>
                      <pre className="mt-1 whitespace-pre-wrap">
                        {this.state.error?.message}
                      </pre>
                    </details>
                  )}
                </div>
                <div className="mt-4 flex space-x-2">
                  <button
                    onClick={this.handleRetry}
                    className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700 flex items-center"
                  >
                    <RefreshCw size={14} className="mr-1" />
                    Try Again
                  </button>
                  <button
                    onClick={this.handleReload}
                    className="bg-gray-600 text-white px-3 py-1 rounded text-sm hover:bg-gray-700"
                  >
                    Reload Page
                  </button>
                </div>
              </div>
              <div className="ml-auto pl-3">
                <button
                  onClick={this.handleDismiss}
                  className="bg-red-200 rounded-md p-1.5 text-red-500 hover:bg-red-300 focus:outline-none"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Fallback Component or Basic UI */}
          {FallbackComponent ? (
            <FallbackComponent error={this.state.error} onRetry={this.handleRetry} />
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
              <Coffee size={48} className="mx-auto mb-4 text-amber-600" />
              <h3 className="text-lg font-medium text-amber-800 mb-2">
                Service Temporarily Unavailable
              </h3>
              <p className="text-amber-700 mb-4">
                This part of the coffee ordering system is experiencing issues. 
                Other features should still work normally.
              </p>
              <button
                onClick={this.handleRetry}
                className="bg-amber-600 text-white px-4 py-2 rounded hover:bg-amber-700"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      );
    }

    // If dismissed or no error, render children normally
    return this.props.children;
  }
}

export default ErrorBoundary;