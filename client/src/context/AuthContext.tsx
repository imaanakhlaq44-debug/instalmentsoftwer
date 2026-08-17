import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { User, Dealer, UserRole } from '../types/index.js';
import { ApiService, ApiError, TOKEN_STORAGE_KEY, setUnauthorizedHandler } from '../services/api.js';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface AuthContextType {
  user: User | null;
  dealer: Dealer | null;
  token: string | null;
  role: UserRole | null;
  /** Dealer whose data is currently being viewed. Only a super admin can change it. */
  selectedDealerId: string | undefined;
  setSelectedDealerId: (id: string | undefined) => void;

  isAuthenticated: boolean;
  /** True while the stored session is being validated on first load. */
  isBootstrapping: boolean;
  mustChangePassword: boolean;

  login: (email: string, password: string) => Promise<void>;
  logout: (reason?: string) => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refreshSession: () => Promise<void>;

  /** Role checks the UI uses to decide what to render. */
  can: (...roles: UserRole[]) => boolean;
  isSuperAdmin: boolean;
  isDealerAdmin: boolean;
  isStaff: boolean;
  isCustomer: boolean;

  toasts: Toast[];
  showToast: (message: string, type?: ToastType) => void;
  dismissToast: (id: number) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // No hardcoded user. The app starts signed out and only knows who you are
  // after the server validates a token.
  const [user, setUser] = useState<User | null>(null);
  const [dealer, setDealer] = useState<Dealer | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [selectedDealerId, setSelectedDealerId] = useState<string | undefined>(undefined);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toastId = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-3), { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, type === 'error' ? 7000 : 4500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setUser(null);
    setDealer(null);
    setToken(null);
    setSelectedDealerId(undefined);
  }, []);

  const applySession = useCallback((session: { user: User; dealer?: Dealer; token: string }) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, session.token);
    setToken(session.token);
    setUser(session.user);
    setDealer(session.dealer ?? null);
    setSelectedDealerId(session.dealer?.id);
  }, []);

  const logout = useCallback(
    (reason?: string) => {
      // Fire-and-forget so the audit trail records the sign-out, but never block
      // the user from leaving if the request fails.
      if (localStorage.getItem(TOKEN_STORAGE_KEY)) {
        ApiService.logout().catch(() => undefined);
      }
      clearSession();
      showToast(reason || 'You have been signed out.', reason ? 'warning' : 'info');
    },
    [clearSession, showToast]
  );

  // Any 401 from any request tears the session down immediately.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      showToast('Your session has expired. Please sign in again.', 'warning');
    });
    return () => setUnauthorizedHandler(null);
  }, [clearSession, showToast]);

  // Restore the session on page load / refresh.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (!stored) {
        setIsBootstrapping(false);
        return;
      }

      try {
        const session = await ApiService.me();
        if (!cancelled) applySession({ ...session, token: session.token || stored });
      } catch {
        if (!cancelled) clearSession();
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applySession, clearSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        const session = await ApiService.login(email, password);
        applySession(session);
        showToast(`Welcome back, ${session.user.name}.`, 'success');

        if (session.user.mustChangePassword) {
          showToast('You must change your temporary password before continuing.', 'warning');
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.';
        showToast(message, 'error');
        throw err;
      }
    },
    [applySession, showToast]
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await ApiService.changePassword(currentPassword, newPassword);
      setUser((prev) => (prev ? { ...prev, mustChangePassword: false } : prev));
      showToast('Password updated successfully.', 'success');
    },
    [showToast]
  );

  const refreshSession = useCallback(async () => {
    try {
      const session = await ApiService.me();
      applySession(session);
    } catch {
      clearSession();
    }
  }, [applySession, clearSession]);

  const role = user?.role ?? null;

  const can = useCallback(
    (...roles: UserRole[]) => (role ? roles.includes(role) : false),
    [role]
  );

  const value: AuthContextType = {
    user,
    dealer,
    token,
    role,
    selectedDealerId,
    setSelectedDealerId: (id) => {
      // Only a super admin may look at another dealer's books; for everyone else
      // the server ignores the parameter anyway, so we never send it.
      if (user?.role === 'SUPER_ADMIN') setSelectedDealerId(id);
    },

    isAuthenticated: Boolean(user && token),
    isBootstrapping,
    mustChangePassword: user?.mustChangePassword === true,

    login,
    logout,
    changePassword,
    refreshSession,

    can,
    isSuperAdmin: role === 'SUPER_ADMIN',
    isDealerAdmin: role === 'SUPER_ADMIN' || role === 'DEALER_ADMIN',
    isStaff: role === 'SUPER_ADMIN' || role === 'DEALER_ADMIN' || role === 'DEALER_STAFF',
    isCustomer: role === 'CUSTOMER',

    toasts,
    showToast,
    dismissToast,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </AuthContext.Provider>
  );
};

const TOAST_STYLES: Record<ToastType, string> = {
  success: 'bg-emerald-600 border-emerald-500',
  error: 'bg-rose-600 border-rose-500',
  warning: 'bg-amber-600 border-amber-500',
  info: 'bg-blue-600 border-blue-500',
};

const TOAST_ICONS: Record<ToastType, string> = {
  success: '✅',
  error: '⚠️',
  warning: '⚡',
  info: 'ℹ️',
};

const ToastStack: React.FC<{ toasts: Toast[]; onDismiss: (id: number) => void }> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-[100] flex flex-col gap-2 max-w-[calc(100vw-2rem)] sm:max-w-md">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className={`px-5 py-3 rounded-xl shadow-2xl flex items-start gap-3 text-sm font-semibold text-white border ${TOAST_STYLES[toast.type]}`}
        >
          <span aria-hidden="true">{TOAST_ICONS[toast.type]}</span>
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="opacity-70 hover:opacity-100 transition-opacity"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
