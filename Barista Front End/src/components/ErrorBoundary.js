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

      // Phone home to the backend so I find out about crashes the
      // same minute they happen, instead of waiting for Steve to
      // screenshot the page. Best-effort: fire-and-forget, no auth
      // required (crashes can happen at the login screen before any
      // token exists), and any failure stays silent — error reporting
      // must never become the new error.
      //
      // Field names match the backend's INSERT shape in
      // routes/consolidated_api_routes.py — component_stack with an
      // underscore, not the camelCase componentStack we receive from
      // React.
      try {
        const payload = {
          component: errorData.component,
          message: errorData.error.message,
          stack: errorData.error.stack,
          component_stack: errorInfo && errorInfo.componentStack,
          url: errorData.url,
          user_id: errorData.userId,
          user_agent: errorData.userAgent,
          retry_count: errorData.retryCount,
        };
        // Use sendBeacon when available — survives a tab close and
        // doesn't tie up the main thread while React is mid-unmount.
        const body = JSON.stringify(payload);
        const endpoint = '/api/client-errors';
        if (navigator.sendBeacon) {
          const blob = new Blob([body], { type: 'application/json' });
          navigator.sendBeacon(endpoint, blob);
        } else {
          // Older browsers / iPad Safari fallback. Don't await; we're
          // already in a broken render, no point blocking on the post.
          fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
            // eslint-disable-next-line @typescript-eslint/no-empty-function
          }).catch(() => { /* error reporting must never throw */ });
        }
      } catch (_) { /* error reporting must never throw */ }

      // Legacy hook — kept for any existing wiring that still sets
      // window.errorTrackingService externally (e.g. for testing).
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
                      <pre className="mt-1 whitespace-pre-wrap break-words">
                        {/* Show whatever we can get our hands on — some
                            errors arrive without a useful .message
                            (e.g. thrown strings, undefined deref) so
                            falling back to .toString() and including
                            the component stack helps locate the actual
                            file when a generic "TypeError" fires. */}
                        {this.state.error?.message
                          || (this.state.error ? String(this.state.error) : '(no error message)')}
                        {this.state.error?.stack && (
                          <>
                            {'\n\nStack:\n'}
                            {this.state.error.stack}
                          </>
                        )}
                        {this.state.errorInfo?.componentStack && (
                          <>
                            {'\n\nComponent stack:'}
                            {this.state.errorInfo.componentStack}
                          </>
                        )}
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