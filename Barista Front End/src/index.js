import React from 'react';
import ReactDOM from 'react-dom/client';
// Silence console.log/.debug/.info/.trace in production builds. Has
// no effect in dev. See utils/consoleSilencer.js for the rationale
// and the window.__expressoEnableConsole escape hatch.
import './utils/consoleSilencer';
// Storage guard. Touching localStorage THROWS in a cross-origin iframe on
// iOS, and App.js reads it during boot — that is why the page went blank
// inside the EventsAir app. Imported here as a side effect so the shim is
// installed at MODULE-EVALUATION time, before App's own module body runs.
// It has to be a plain side-effect import rather than a call between
// imports: ES modules hoist all imports, so a statement in the middle
// would not actually run earlier, and it breaks the import/first lint
// rule that CRA promotes to a build error.
import './utils/installSafeStorage';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
