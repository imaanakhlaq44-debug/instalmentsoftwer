import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.js';
import { navItemsForRole } from './navItems.js';

/** Which sections earn a slot on the small mobile bar, in priority order. */
const MOBILE_PRIORITY = ['/', '/devices', '/payments', '/customers', '/installments'];

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
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t
                 border-paper-300 bg-paper-50/95 backdrop-blur-sm lg:hidden"
      // Keeps the bar clear of the iOS home indicator.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 py-2.5 text-micro normal-case tracking-normal transition-colors ${
                isActive ? 'text-accent-700' : 'text-ink-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className="h-5 w-5" aria-hidden="true" strokeWidth={isActive ? 2.2 : 1.8} />
                <span className={isActive ? 'font-medium' : ''}>{item.label}</span>
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
};
