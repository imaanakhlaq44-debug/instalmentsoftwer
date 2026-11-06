import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { ApiService } from '../../services/api.js';
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
  const { role, dealer, user, selectedDealerId, setSelectedDealerId } = useAuth();
  const navigate = useNavigate();
  const isPlatform = role === 'SUPER_ADMIN';
  const viewingShop = isPlatform && Boolean(selectedDealerId);

  // A super admin has no shop of their own, so the open shop's name is looked up.
  const [shopName, setShopName] = useState<string | null>(null);
  useEffect(() => {
    if (!viewingShop) return;
    ApiService.getLicenses()
      .then((res) => setShopName((res.dealers ?? []).find((d: any) => d.dealerId === selectedDealerId)?.dealerName ?? null))
      .catch(() => setShopName(null));
  }, [viewingShop, selectedDealerId]);

  // Menu is derived from the signed-in role, so nothing unreachable is shown.
  const navItems = navItemsForRole(role, viewingShop);
  const groups = NAV_GROUPS.map((group: NavGroup) => ({
    group,
    items: navItems.filter((i) => i.group === group),
  })).filter((g) => g.items.length > 0);

  return (
    <aside className="hidden w-60 shrink-0 select-none flex-col border-r-2 border-ink-900 bg-paper-50 lg:flex">
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
        <span className="text-lede font-black uppercase tracking-[-0.01em] text-ink-900">Almas SDM</span>
      </div>

      {/* Whose books are on screen. For the platform owner this says which
          mode they are in: the whole platform, or one shop opened from it. */}
      {isPlatform && !viewingShop ? (
        <div className="mx-3 mb-2 rounded-md border-2 border-ink-900 bg-accent-800 px-3 py-2.5 text-white shadow-[3px_3px_0_#0F1419]">
          <p className="text-micro font-extrabold uppercase tracking-[0.12em] text-sun-200">Platform admin</p>
          <p className="mt-0.5 text-caption font-bold">All shops</p>
        </div>
      ) : (
        <div className="mx-3 mb-2 rounded-md border-2 border-ink-900 bg-sun-100 px-3 py-2.5 shadow-[3px_3px_0_#0F1419]">
          <p className="eyebrow">{viewingShop ? 'Shop open' : 'Dealership'}</p>
          <p className="mt-0.5 truncate text-caption font-bold text-ink-900">{(viewingShop ? shopName : dealer?.name) || '—'}</p>
          {viewingShop && (
            <button
              type="button"
              onClick={() => {
                setSelectedDealerId(undefined);
                navigate('/');
              }}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border-2 border-ink-900 bg-white px-2 py-1 text-caption font-extrabold text-ink-900 hover:bg-sun-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to platform
            </button>
          )}
        </div>
      )}

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
                        `relative flex items-center gap-2.5 rounded-md border-2 px-2.5 py-1.5 text-body transition-colors ${
                          isActive
                            ? 'border-ink-900 bg-sun-400 font-extrabold text-ink-900 shadow-[3px_3px_0_#0F1419]'
                            : 'border-transparent font-semibold text-ink-700 hover:bg-sun-100 hover:text-ink-900'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                                                    <Icon
                            className={`h-4 w-4 shrink-0 ${isActive ? 'text-ink-900' : 'text-ink-500'}`}
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
        <div className="border-t-2 border-ink-900 px-5 py-3.5">
          <p className="truncate text-caption font-medium text-ink-900">{user.name}</p>
          <p className="truncate text-micro normal-case tracking-normal text-ink-400">
            {ROLE_LABELS[user.role] ?? user.role}
          </p>
        </div>
      )}
    </aside>
  );
};
