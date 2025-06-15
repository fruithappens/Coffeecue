import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import TestApp from './TestApp';

// Temporary test index to bypass any app issues
const root = ReactDOM.createRoot(document.getElementById('root'));

// Check if we're in test mode
const urlParams = new URLSearchParams(window.location.search);
const testMode = urlParams.get('test') === 'true' || window.location.pathname === '/test';

if (testMode) {
  // Render test app
  root.render(
    <React.StrictMode>
      <TestApp />
    </React.StrictMode>
  );
} else {
  // Try to render main app, fall back to test app on error
  try {
    const App = require('./App').default;
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    console.error('Main app failed to load:', error);
    root.render(
      <React.StrictMode>
        <TestApp />
      </React.StrictMode>
    );
  }
}