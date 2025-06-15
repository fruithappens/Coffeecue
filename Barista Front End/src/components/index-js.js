// index.js
import React from 'react';
import ReactDOM from 'react-dom';
import BaristaApp from './BaristaApp';
import './styles.css'; // You would need to create this file with your base Tailwind CSS

ReactDOM.render(
  <React.StrictMode>
    <BaristaApp />
  </React.StrictMode>,
  document.getElementById('root')
);