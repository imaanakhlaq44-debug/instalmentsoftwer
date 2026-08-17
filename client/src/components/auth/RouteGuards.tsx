import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2, ShieldAlert } from 'lucide-react';
import { UserRole } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';

const FullPageSpinner: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-950">
    <Loader2 className="w-8 h-8 text-blue-500 animate-spin" aria-hidden="true" />
    <p className="text-sm text-slate-500">{label}</p>
  </div>
);

/**
 * Blocks everything until a session is proven. While the stored token is being
 * validated we show a spinner rather than flashing the dashboard — otherwise a
 * signed-out user briefly sees the shell of a page they cannot access.
 */
export const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isBootstrapping, mustChangePassword } = useAuth();
  const location = useLocation();

  if (isBootstrapping) return <FullPageSpinner label="Restoring your session…" />;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  // A temporary password must be replaced before anything else is reachable.
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  return <>{children}</>;
};

export const AccessDenied: React.FC<{ requiredRoles?: UserRole[] }> = ({ requiredRoles }) => (
  <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
    <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-600/40 flex items-center justify-center mb-5">
      <ShieldAlert className="w-8 h-8 text-amber-400" aria-hidden="true" />
    </div>
    <h2 className="text-xl font-bold text-white mb-2">You don't have access to this page</h2>
    <p className="text-sm text-slate-400 max-w-md">
      {requiredRoles?.length
        ? `This section is limited to ${requiredRoles.join(', ').replace(/_/g, ' ').toLowerCase()}.`
        : 'Your role does not permit viewing this section.'}{' '}
      Contact your shop administrator if you believe this is a mistake.
    </p>
  </div>
);

/** Wraps a route so only the listed roles can render it. */
export const RequireRole: React.FC<{ roles: UserRole[]; children: React.ReactNode }> = ({ roles, children }) => {
  const { role } = useAuth();
  if (!role || !roles.includes(role)) return <AccessDenied requiredRoles={roles} />;
  return <>{children}</>;
};

/** Conditionally renders children based on role — for buttons and menu items. */
export const Can: React.FC<{ roles: UserRole[]; children: React.ReactNode; fallback?: React.ReactNode }> = ({
  roles,
  children,
  fallback = null,
}) => {
  const { role } = useAuth();
  if (!role || !roles.includes(role)) return <>{fallback}</>;
  return <>{children}</>;
};
