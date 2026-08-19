import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { ApiError } from '../services/api.js';

/**
 * Sign-in.
 *
 * This used to be a dark screen in front of a light application — the first
 * thing a new user saw was a product that could not decide what it was. It is
 * the same paper as the dashboard now, and it says plainly what the tool is for
 * before asking anyone to identify themselves.
 */
export const LoginPage: React.FC = () => {
  const { login, isAuthenticated, isBootstrapping } = useAuth();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-100">
        <Loader2 className="h-6 w-6 animate-spin text-ink-400" aria-label="Loading" />
      </div>
    );
  }

  if (isAuthenticated) {
    // Send the user back to wherever they were headed before being bounced here.
    const from = (location.state as { from?: string } | null)?.from || '/';
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Please enter both your email and password.');
      return;
    }

    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.');
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {/* The full lockup, because this is the one screen where the product
              introduces itself. The name is inside the artwork, so the heading
              below it would only repeat itself. */}
          <img
            src="/logo-lockup.webp"
            alt="Almas SDM"
            width={720}
            height={629}
            className="mx-auto mb-5 h-24 w-auto"
          />
          <h1 className="sr-only">Almas SDM</h1>
          <p className="text-body text-ink-500">
            Installments, devices and collections for your shop
          </p>
        </div>

        <form onSubmit={handleSubmit} className="surface p-6 shadow-hairline sm:p-7" noValidate>
          {error && (
            <div
              role="alert"
              className="mb-5 rounded-md border border-critical-200 bg-critical-50 px-3.5 py-2.5 text-body text-critical-700"
            >
              {error}
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="email" className="field-label">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              className="input"
              placeholder="you@yourshop.pk"
            />
          </div>

          <div className="mb-6">
            <label htmlFor="password" className="field-label">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                className="input pr-11"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 transition-colors hover:text-ink-700"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <button type="submit" disabled={submitting} className="btn-primary w-full py-2.5">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="mt-5 text-center text-caption text-ink-400">
            Forgotten your password? Your shop administrator can reset it.
          </p>
        </form>

        <p className="mt-6 text-center text-caption text-ink-400">
          Access is logged. Unauthorised use is prohibited.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
