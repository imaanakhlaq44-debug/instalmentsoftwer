import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './index.css';
import './shop-app.css';
import { isNativeShopApp } from './utils/nativeApp.js';

if (isNativeShopApp()) document.documentElement.dataset.shopApp = 'bold';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
