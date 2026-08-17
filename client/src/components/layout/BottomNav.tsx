import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.js';
import { navItemsForRole } from './navItems.js';

/** Which sections earn a slot on the small mobile bar, in priority order. */
const MOBILE_PRIORITY = ['/', '/devices', '/simulator', '/payments', '/customers', '/installments'];

export const BottomNav: React.FC = () => {
  const { role } = useAuth();

  // Same role-filtered source as the sidebar, trimmed to five slots.
  const allowed = navItemsForRole(role);
  const items = MOBILE_PRIORITY.map((path) => allowed.find((i) => i.to === path))
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .slice(0, 5)
    .map((i) => ({ ...i, label: i.to === '/' ? 'Home' : i.label.replace('Device ', '') }));

  if (items.length === 0) return null;

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-2 py-2 flex items-center justify-around shadow-lg">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center py-1 px-3 rounded-xl text-[10px] font-semibold transition-all ${
                isActive
                  ? 'text-blue-600 font-bold scale-105'
                  : item.highlight
                  ? 'text-indigo-600'
                  : 'text-slate-500 hover:text-slate-900'
              }`
            }
          >
            <div className={`p-1 rounded-lg ${item.highlight ? 'bg-indigo-50 text-indigo-600' : ''}`}>
              <Icon className="w-5 h-5" />
            </div>
            <span className="mt-0.5">{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
};
