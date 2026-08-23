import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.js';
import { navItemsForRole, NAV_GROUPS, type NavGroup } from './navItems.js';

/**
 * The sidebar.
 *
 * It used to be a dark navy column bolted onto a light application — the single
 * loudest "template" signal in the product, and a permanent cold rectangle in
 * the corner of a warm page. It is now the same paper as everything else,
 * separated by a hairline, and it earns attention through structure rather than
 * contrast: four labelled groups instead of twelve undifferentiated links.
 *
 * The active item is marked by a rule down its left edge and a change of weight.
 * No pill, no shadow, no glow — the reader knows where they are without the
 * navigation shouting it.
 */

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super admin',
  DEALER_ADMIN: 'Shop owner',
  DEALER_STAFF: 'Counter staff',
  CUSTOMER: 'Customer',
};

export const Sidebar: React.FC = () => {
  const { role, dealer, user } = useAuth();

  // Menu is derived from the signed-in role, so nothing unreachable is shown.
  const navItems = navItemsForRole(role);
  const groups = NAV_GROUPS.map((group: NavGroup) => ({
    group,
    items: navItems.filter((i) => i.group === group),
  })).filter((g) => g.items.length > 0);

  return (
    <aside className="hidden w-60 shrink-0 select-none flex-col border-r border-paper-300 bg-paper-50 lg:flex">
      <div className="flex h-16 items-center gap-2.5 px-5">
        {/* The mark carries no background plate: it is drawn with white lines
            between its facets, and a coloured tile behind it fights them. */}
        <img
          src="/logo-mark.webp"
          alt=""
          width={32}
          height={26}
          className="h-7 w-auto"
          aria-hidden="true"
        />
        <span className="text-lede font-semibold tracking-[-0.01em] text-ink-900">Almas SDM</span>
      </div>

      {/* Whose books are on screen. For a super admin this is the only thing
          distinguishing one dealership's data from another's. */}
      <div className="mx-3 mb-2 rounded-md bg-paper-200/70 px-3 py-2.5">
        <p className="eyebrow">{role === 'SUPER_ADMIN' ? 'Viewing' : 'Dealership'}</p>
        <p className="mt-0.5 truncate text-caption font-medium text-ink-900">
          {dealer?.name || (role === 'SUPER_ADMIN' ? 'All dealers' : '—')}
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {groups.map(({ group, items }) => (
          <div key={group} className="mb-5 last:mb-0">
            <p className="eyebrow px-2.5 pb-1.5">{group}</p>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      className={({ isActive }) =>
                        `relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-body transition-colors ${
                          isActive
                            ? 'bg-paper-200 font-medium text-ink-900'
                            : 'text-ink-500 hover:bg-paper-200/60 hover:text-ink-900'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent-600" />
                          )}
                          <Icon
                            className={`h-4 w-4 shrink-0 ${isActive ? 'text-accent-700' : 'text-ink-400'}`}
                            aria-hidden="true"
                          />
                          <span className="truncate">{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {user && (
        <div className="border-t border-paper-300 px-5 py-3.5">
          <p className="truncate text-caption font-medium text-ink-900">{user.name}</p>
          <p className="truncate text-micro normal-case tracking-normal text-ink-400">
            {ROLE_LABELS[user.role] ?? user.role}
          </p>
        </div>
      )}
    </aside>
  );
};
