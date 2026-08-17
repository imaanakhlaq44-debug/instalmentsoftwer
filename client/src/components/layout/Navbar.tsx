import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Bell, Smartphone, ChevronDown, LogOut, Building2, KeyRound, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { ApiService } from '../../services/api.js';

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  DEALER_ADMIN: 'Shop Owner',
  DEALER_STAFF: 'Counter Staff',
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
  const { user, dealer, role, logout, selectedDealerId, setSelectedDealerId, isSuperAdmin, isStaff } = useAuth();
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
      .then((rows) =>
        setDealers(
          rows.map((l: any) => ({ id: l.dealerId, name: l.dealerName, city: l.dealerCity }))
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
      : 'All Dealers'
    : dealer?.name ?? '—';

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 lg:px-8 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 max-w-md hidden sm:block">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="search"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search IMEI, customer, phone or model…"
              aria-label="Search devices"
              className="w-full pl-10 pr-4 py-2 bg-slate-50 hover:bg-slate-100/80 focus:bg-white text-xs sm:text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchValue.trim()) {
                  navigate(`/devices?search=${encodeURIComponent(searchValue.trim())}`);
                }
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2.5 sm:gap-4 ml-auto">
          {isStaff && (
            <button
              onClick={() => navigate('/simulator')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
            >
              <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Phone Simulator</span>
            </button>
          )}

          {/* Dealer switcher — super admin only. A dealer user has exactly one
              dealership and the server ignores the parameter for them anyway. */}
          {isSuperAdmin && (
            <div className="relative" ref={dealerRef}>
              <button
                onClick={() => setShowDealerMenu((v) => !v)}
                aria-expanded={showDealerMenu}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200/70 rounded-lg text-xs font-medium text-slate-700 border border-slate-200/60 transition-all"
              >
                <Building2 className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                <span className="hidden md:inline font-semibold max-w-[10rem] truncate">{activeDealerLabel}</span>
                <ChevronDown className="w-3 h-3 text-slate-500" aria-hidden="true" />
              </button>

              {showDealerMenu && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-100 py-1.5 z-50 max-h-80 overflow-y-auto">
                  <div className="px-3 py-2 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    View dealership
                  </div>
                  <button
                    onClick={() => {
                      setSelectedDealerId(undefined);
                      setShowDealerMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 ${
                      !selectedDealerId ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700'
                    }`}
                  >
                    All Dealers (platform-wide)
                  </button>
                  {dealers.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => {
                        setSelectedDealerId(d.id);
                        setShowDealerMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 ${
                        selectedDealerId === d.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700'
                      }`}
                    >
                      {d.name}
                      <span className="block text-[10px] text-slate-400">{d.city}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => navigate('/notifications')}
            className="p-2 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-xl relative transition-colors"
            aria-label={unreadCount > 0 ? `${unreadCount} pending notifications` : 'Notifications'}
          >
            <Bell className="w-4 h-4" aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-rose-500 text-white text-[9px] font-bold rounded-full ring-2 ring-white flex items-center justify-center">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {/* Profile menu — the old role switcher lived here. It rewrote the
              user's role in the database, letting anyone become super admin. */}
          <div className="relative pl-2 border-l border-slate-200" ref={profileRef}>
            <button
              onClick={() => setShowProfile((v) => !v)}
              aria-expanded={showProfile}
              className="flex items-center gap-2.5 hover:bg-slate-50 rounded-lg px-1.5 py-1 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-navy-900 to-blue-700 text-white flex items-center justify-center font-bold text-xs shadow-sm">
                {user?.name.charAt(0).toUpperCase() ?? '?'}
              </div>
              <div className="hidden xl:block text-left">
                <div className="text-xs font-bold text-slate-800 leading-tight">{user?.name}</div>
                <div className="text-[10px] text-slate-500">{role ? ROLE_LABELS[role] ?? role : ''}</div>
              </div>
              <ChevronDown className="w-3 h-3 text-slate-500 hidden xl:block" aria-hidden="true" />
            </button>

            {showProfile && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-2xl border border-slate-200 py-2 z-50">
                <div className="px-4 py-2.5 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-800 truncate">{user?.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <ShieldCheck className="w-3 h-3 text-blue-600" aria-hidden="true" />
                    <span className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">
                      {role ? ROLE_LABELS[role] ?? role : ''}
                    </span>
                  </div>
                  {dealer && <p className="text-[10px] text-slate-400 mt-1 truncate">{dealer.name}</p>}
                </div>

                <button
                  onClick={() => {
                    setShowProfile(false);
                    navigate('/change-password');
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <KeyRound className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                  Change password
                </button>

                <button
                  onClick={() => {
                    setShowProfile(false);
                    logout();
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-rose-600 hover:bg-rose-50 transition-colors border-t border-slate-100"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
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
