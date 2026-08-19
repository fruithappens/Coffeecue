import React from 'react';
import ReactDOM from 'react-dom/client';
// Silence console.log/.debug/.info/.trace in production builds. Has
// no effect in dev. See utils/consoleSilencer.js for the rationale
// and the window.__expressoEnableConsole escape hatch.
import './utils/consoleSilencer';
// MUST run before App is imported/rendered. Touching localStorage throws
// in a cross-origin iframe on iOS, and App.js reads it during boot — the
// page went blank inside the EventsAir app for exactly that reason.
import { installSafeStorage } from './utils/safeStorage';

const storageShimmed = installSafeStorage();
if (storageShimmed) {
  // Not an error worth hiding: it explains why nothing is remembered.
  console.warn('[coffee-cue] localStorage unavailable (embedded/private '
    + 'browsing) — using in-memory storage for this session.');
}

import './index.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);