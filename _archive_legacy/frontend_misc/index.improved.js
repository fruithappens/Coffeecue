import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { initializeWithMigration } from './utils/migrationUtils';

// Run migration before rendering the app
initializeWithMigration();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);