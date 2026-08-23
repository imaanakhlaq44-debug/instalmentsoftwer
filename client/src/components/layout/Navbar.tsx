import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Bell, ChevronDown, LogOut, Building2, KeyRound, ShieldCheck, Check,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { ApiService } from '../../services/api.js';

/**
 * The top bar: search, whose books you are looking at, what is waiting, who you
 * are. Nothing else earns a permanent slot at the top of every screen — the
 * gradient "Phone Simulator" button that used to live here is a page in the
 * navigation like any other.
 */

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super admin',
  DEALER_ADMIN: 'Shop owner',
  DEALER_STAFF: 'Counter staff',
  CUSTOMER: 'Customer',
};

/** Closes a dropdown when the user clicks anywhere outside it. */
function useOutsideClick(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onOutside]);
  return ref;
}

export const Navbar: React.FC = () => {
  const { user, dealer, role, logout, selectedDealerId, setSelectedDealerId, isSuperAdmin } =
    useAuth();
  const navigate = useNavigate();

  const [showProfile, setShowProfile] = useState(false);
  const [showDealerMenu, setShowDealerMenu] = useState(false);
  const [dealers, setDealers] = useState<{ id: string; name: string; city: string }[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [searchValue, setSearchValue] = useState('');

  const profileRef = useOutsideClick(() => setShowProfile(false));
  const dealerRef = useOutsideClick(() => setShowDealerMenu(false));

  // Only a super admin can view another dealership, so only they need the list.
  useEffect(() => {
    if (!isSuperAdmin) return;
    ApiService.getLicenses()
      .then((res) =>
        setDealers(
          (res.dealers ?? []).map((d: any) => ({
            id: d.dealerId,
            name: d.dealerName,
            city: d.dealerCity,
          }))
        )
      )
      .catch(() => setDealers([]));
  }, [isSuperAdmin]);

  // Badge reflects real queued notifications rather than an always-on red dot.
  useEffect(() => {
    let cancelled = false;
    ApiService.getNotifications({ status: 'QUEUED', limit: 1 })
      .then((res) => {
        if (!cancelled) setUnreadCount(res.counts?.queued ?? res.pagination?.total ?? 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const activeDealerLabel = isSuperAdmin
    ? selectedDealerId
      ? dealers.find((d) => d.id === selectedDealerId)?.name ?? selectedDealerId
      : 'All dealers'
    : dealer?.name ?? '—';

  const menuItem =
    'flex w-full items-center gap-2.5 px-3 py-2 text-body text-ink-700 transition-colors hover:bg-paper-200';

  return (
    <header className="sticky top-0 z-30 border-b border-paper-300 bg-paper-100/90 px-4 py-2.5 backdrop-blur-sm lg:px-8">
      <div className="flex items-center gap-3">
        <div className="hidden max-w-sm flex-1 sm:block">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search IMEI, customer, phone or model…"
              aria-label="Search devices"
              className="input py-1.5 pl-9"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchValue.trim()) {
                  navigate(`/devices?search=${encodeURIComponent(searchValue.trim())}`);
                }
              }}
            />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Dealer switcher — super admin only. A dealer user has exactly one
              dealership and the server ignores the parameter for them anyway. */}
          {isSuperAdmin && (
            <div className="relative" ref={dealerRef}>
              <button
                type="button"
                onClick={() => setShowDealerMenu((v) => !v)}
                aria-expanded={showDealerMenu}
                className="btn-secondary py-1.5 text-caption"
              >
                <Building2 className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
                <span className="hidden max-w-[10rem] truncate md:inline">{activeDealerLabel}</span>
                <ChevronDown className="h-3 w-3 text-ink-400" aria-hidden="true" />
              </button>

              {showDealerMenu && (
                <div className="absolute right-0 z-50 mt-1.5 max-h-80 w-72 overflow-y-auto rounded-lg border border-paper-300 bg-paper-50 py-1 shadow-overlay">
                  <p className="eyebrow px-3 py-1.5">View dealership</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDealerId(undefined);
                      setShowDealerMenu(false);
                    }}
                    className={menuItem}
                  >
                    <Check
                      className={`h-3.5 w-3.5 ${selectedDealerId ? 'invisible' : 'text-accent-700'}`}
                      aria-hidden="true"
                    />
                    All dealers
                  </button>
                  {dealers.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        setSelectedDealerId(d.id);
                        setShowDealerMenu(false);
                      }}
                      className={menuItem}
                    >
                      <Check
                        className={`h-3.5 w-3.5 shrink-0 ${
                          selectedDealerId === d.id ? 'text-accent-700' : 'invisible'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate">{d.name}</span>
                        <span className="block truncate text-caption text-ink-400">{d.city}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => navigate('/notifications')}
            className="btn-ghost relative h-9 w-9 rounded-md p-0"
            aria-label={unreadCount > 0 ? `${unreadCount} pending notifications` : 'Notifications'}
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-critical-600 px-1 text-[10px] font-medium tabular text-white ring-2 ring-paper-100">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {/* Profile menu — the old role switcher lived here. It rewrote the
              user's role in the database, letting anyone become super admin. */}
          <div className="relative" ref={profileRef}>
            <button
              type="button"
              onClick={() => setShowProfile((v) => !v)}
              aria-expanded={showProfile}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-paper-200"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-800 text-caption font-medium text-white">
                {user?.name.charAt(0).toUpperCase() ?? '?'}
              </span>
              <span className="hidden text-left xl:block">
                <span className="block text-caption font-medium leading-tight text-ink-900">
                  {user?.name}
                </span>
                <span className="block text-micro normal-case tracking-normal text-ink-400">
                  {role ? ROLE_LABELS[role] ?? role : ''}
                </span>
              </span>
              <ChevronDown className="hidden h-3 w-3 text-ink-400 xl:block" aria-hidden="true" />
            </button>

            {showProfile && (
              <div className="absolute right-0 z-50 mt-1.5 w-64 rounded-lg border border-paper-300 bg-paper-50 py-1 shadow-overlay">
                <div className="border-b border-paper-300 px-3 pb-2.5 pt-2">
                  <p className="truncate text-body font-medium text-ink-900">{user?.name}</p>
                  <p className="truncate text-caption text-ink-400">{user?.email}</p>
                  <p className="mt-1.5 flex items-center gap-1.5 text-caption text-ink-500">
                    <ShieldCheck className="h-3.5 w-3.5 text-accent-700" aria-hidden="true" />
                    {role ? ROLE_LABELS[role] ?? role : ''}
                    {dealer && <span className="truncate text-ink-400">· {dealer.name}</span>}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowProfile(false);
                    navigate('/change-password');
                  }}
                  className={menuItem}
                >
                  <KeyRound className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
                  Change password
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowProfile(false);
                    logout();
                  }}
                  className={`${menuItem} text-critical-600 hover:bg-critical-50`}
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
