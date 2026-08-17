import React from 'react';
import { NavLink } from 'react-router-dom';
import { ShieldCheck, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { navItemsForRole } from './navItems.js';

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  DEALER_ADMIN: 'Shop Owner',
  DEALER_STAFF: 'Counter Staff',
  CUSTOMER: 'Customer',
};

export const Sidebar: React.FC = () => {
  const { role, dealer, user } = useAuth();

  // Menu is derived from the signed-in role, so nothing unreachable is shown.
  const navItems = navItemsForRole(role);

  return (
    <aside className="w-64 bg-navy-950 text-slate-300 flex flex-col shrink-0 border-r border-slate-800 min-h-screen select-none hidden lg:flex">
      {/* Brand Header */}
      <div className="h-16 px-6 flex items-center gap-3 border-b border-slate-800/80 bg-navy-950/90">
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-white text-lg tracking-tight">EMI Shield</span>
            <span className="text-[10px] uppercase font-bold bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded border border-blue-400/30">PRO</span>
          </div>
          <p className="text-[10px] text-slate-400 font-medium tracking-wide">Smart Device Management</p>
        </div>
      </div>

      {/* Dealer Info Pill */}
      <div className="mx-4 my-3.5 p-3 rounded-xl bg-navy-900/90 border border-slate-800 flex items-center justify-between">
        <div className="truncate">
          <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
            {role === 'SUPER_ADMIN' ? 'Platform View' : 'Active Dealer'}
          </p>
          <p className="text-xs font-bold text-white truncate mt-0.5">
            {dealer?.name || (role === 'SUPER_ADMIN' ? 'All Dealers' : '—')}
          </p>
          {user && (
            <p className="text-[10px] text-slate-500 truncate mt-0.5">
              {user.name} · {ROLE_LABELS[user.role] ?? user.role}
            </p>
          )}
        </div>
        <div className="w-2 h-2 rounded-full bg-emerald-400 ring-4 ring-emerald-400/20 shrink-0"></div>
      </div>

      {/* Nav List */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        <div className="px-3 py-1.5 text-[10px] font-bold text-slate-300 uppercase tracking-wider">
          Management
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `group flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-bold'
                    : item.highlight
                    ? 'bg-indigo-950/70 text-indigo-300 hover:bg-indigo-900/60 border border-indigo-500/30'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`
              }
            >
              <div className="flex items-center gap-3">
                <Icon className="w-4 h-4 transition-transform group-hover:scale-110" />
                <span>{item.label}</span>
              </div>
              {item.highlight && (
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
              )}
            </NavLink>
          );
        })}
      </div>

      {/* Security Status Box */}
      <div className="p-4 border-t border-slate-800/80 bg-navy-950/60">
        <div className="p-3 rounded-xl bg-navy-900/80 border border-slate-800 text-xs">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-[11px] mb-1">
            <Lock className="w-3.5 h-3.5" /> MDM Policy Guard
          </div>
          <p className="text-[11px] text-slate-400">
            DPC remote locking abstraction operational.
          </p>
        </div>
      </div>
    </aside>
  );
};
