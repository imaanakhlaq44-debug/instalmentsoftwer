import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { User, Dealer, UserRole } from '../types/index.js';
import { ApiService, ApiError, TOKEN_STORAGE_KEY, setUnauthorizedHandler, setWriteGuard } from '../services/api.js';

export const VIEW_ONLY_MESSAGE =
  'This shop is open in view-only mode. Turn on edit mode at the top of the page to make changes.';

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
  /**
   * A super admin who opens a shop starts read-only: every write is refused in
   * the browser until they turn edit mode on. Switching shop or going back to
   * the platform turns it off again.
   */
  isViewOnly: boolean;
  shopEditMode: boolean;
  setShopEditMode: (on: boolean) => void;

  isAuthenticated: boolean;
  /** True while the stored session is being validated on first load. */
  isBootstrapping: boolean;
  /** A stored sign-in exists but the server could not be reached to confirm it. */
  restoreFailed: boolean;
  retryRestore: () => void;
  mustChangePassword: boolean;

  login: (email: string, password: string) => Promise<void>;
  logout: (reason?: string) => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refreshSession: () => Promise<void>;

  /** Role checks the UI uses to decide what to render. */
  can: (...roles: UserRole[]) => boolean;
  isSuperAdmin: boolean;
  isDealerAdmin: boolean;
  /** Can make sales and take payments: owner, admin, counter staff. Not view-only staff. */
  isStaff: boolean;
  /** Anyone on the shop's side, view-only staff included. For what may be seen, never for actions. */
  isShopTeam: boolean;
  /** View-only staff: sees the shop's records, changes nothing. */
  isViewer: boolean;
  isCustomer: boolean;

  toasts: Toast[];
  showToast: (message: string, type?: ToastType) => void;
  dismissToast: (id: number) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Waits before each attempt to restore a stored sign-in: about 10 seconds in all. */
export const RESTORE_RETRY_DELAYS_MS = [0, 1500, 3000, 5000];

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // No hardcoded user. The app starts signed out and only knows who you are
  // after the server validates a token.
  const [user, setUser] = useState<User | null>(null);
  const [dealer, setDealer] = useState<Dealer | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [selectedDealerId, setSelectedDealerIdState] = useState<string | undefined>(undefined);
  const [shopEditMode, setShopEditMode] = useState(false);
  // Every change of shop starts back in view-only.
  const setSelectedDealerId = useCallback((id: string | undefined) => {
    setSelectedDealerIdState(id);
    setShopEditMode(false);
  }, []);
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
  //
  // Only the server saying "this sign-in is no longer valid" (401/403) signs
  // the user out. A phone that has just woken up often has no internet for the
  // first few seconds, and a busy server can answer 5xx; neither is a reason
  // to throw away a perfectly good sign-in. Those are retried, and if the
  // server still cannot be reached the token is kept and a "Try again" screen
  // is shown instead of the login page.
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const retryRestore = useCallback(() => {
    setRestoreFailed(false);
    setIsBootstrapping(true);
    setRestoreAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (!stored) {
        setIsBootstrapping(false);
        return;
      }

      for (const wait of RESTORE_RETRY_DELAYS_MS) {
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        if (cancelled) return;
        try {
          const session = await ApiService.me();
          if (cancelled) return;
          applySession({ ...session, token: session.token || stored });
          setIsBootstrapping(false);
          return;
        } catch (err) {
          if (cancelled) return;
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            clearSession();
            setIsBootstrapping(false);
            return;
          }
          // Network trouble or a server error: try again.
        }
      }

      if (!cancelled) {
        setRestoreFailed(true);
        setIsBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applySession, clearSession, restoreAttempt]);

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
      const result = await ApiService.changePassword(currentPassword, newPassword);
      if (result.session) applySession(result.session);
      setUser((prev) => (prev ? { ...prev, mustChangePassword: false } : prev));
      showToast('Password updated successfully.', 'success');
    },
    [showToast, applySession]
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

  const isViewOnly = role === 'SUPER_ADMIN' && Boolean(selectedDealerId) && !shopEditMode;

  useEffect(() => {
    setWriteGuard(isViewOnly ? () => VIEW_ONLY_MESSAGE : null);
    return () => setWriteGuard(null);
  }, [isViewOnly]);

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
    isViewOnly,
    shopEditMode,
    setShopEditMode,

    isAuthenticated: Boolean(user && token),
    isBootstrapping,
    restoreFailed,
    retryRestore,
    mustChangePassword: user?.mustChangePassword === true,

    login,
    logout,
    changePassword,
    refreshSession,

    can,
    isSuperAdmin: role === 'SUPER_ADMIN',
    isDealerAdmin: role === 'SUPER_ADMIN' || role === 'DEALER_ADMIN',
    isStaff: role === 'SUPER_ADMIN' || role === 'DEALER_ADMIN' || role === 'DEALER_STAFF',
    isShopTeam: role === 'SUPER_ADMIN' || role === 'DEALER_ADMIN' || role === 'DEALER_STAFF' || role === 'DEALER_VIEWER',
    isViewer: role === 'DEALER_VIEWER',
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
    <div className="fixed bottom-20 sm:bottom-6 end-4 sm:end-6 z-[100] flex flex-col gap-2 max-w-[calc(100vw-2rem)] sm:max-w-md">
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
