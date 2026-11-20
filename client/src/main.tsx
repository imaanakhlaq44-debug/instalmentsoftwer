import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './index.css';
// The Android shop app's own look (top bar, bottom bar, home tiles). Every rule
// targets classes that only render inside the app, so the website is unchanged.
import './shop-app.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
