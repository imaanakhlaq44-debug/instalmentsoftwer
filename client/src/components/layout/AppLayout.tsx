import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.js';
import { Navbar } from './Navbar.js';
import { AppTopBar } from './AppTopBar.js';
import { BottomNav } from './BottomNav.js';
import { ShopModeBanner } from './ShopModeBanner.js';
import { isNativeShopApp } from '../../utils/nativeApp.js';

export const AppLayout: React.FC = () => {
  // Inside the Android shop app: the app's own top bar and a phone-width page,
  // no website sidebar or navbar. On the website: the full dashboard shell.
  const native = isNativeShopApp();
  return (
    <div className={`flex min-h-screen bg-paper-100 ${native ? 'shop-app-shell' : ''}`}>
      {!native && <Sidebar />}

      <div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-0">
        {native ? <AppTopBar /> : <Navbar />}
        <ShopModeBanner />
        {/* 72rem keeps a line of table text inside a comfortable measure on the
            wide monitors these shops increasingly have. */}
        <main className={native ? 'shop-app-main' : 'mx-auto w-full max-w-[72rem] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8'}>
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  );
};
