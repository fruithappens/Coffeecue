import React from 'react';
import ReactDOM from 'react-dom/client';
// Silence console.log/.debug/.info/.trace in production builds. Has
// no effect in dev. See utils/consoleSilencer.js for the rationale
// and the window.__expressoEnableConsole escape hatch.
import './utils/consoleSilencer';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);