import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Shield, Eye, EyeOff, Loader2, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { ApiError } from '../services/api.js';

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
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" aria-label="Loading" />
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
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/40 mb-4">
            <Shield className="w-8 h-8 text-blue-400" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-white">EMI Shield</h1>
          <p className="text-sm text-slate-400 mt-1">Device Management &amp; Installment Platform</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl"
          noValidate
        >
          <h2 className="text-lg font-semibold text-white mb-6">Sign in to your dashboard</h2>

          {error && (
            <div
              role="alert"
              className="mb-5 px-4 py-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200 text-sm"
            >
              {error}
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
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
              className="w-full px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-60"
              placeholder="you@yourshop.pk"
            />
          </div>

          <div className="mb-6">
            <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
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
                className="w-full px-4 py-2.5 pr-11 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-60"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold transition-colors"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Signing in…
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" aria-hidden="true" />
                Sign in
              </>
            )}
          </button>

          <p className="mt-6 text-xs text-slate-500 text-center">
            Forgot your password? Ask your shop administrator to reset it for you.
          </p>
        </form>

        <p className="mt-6 text-center text-xs text-slate-600">
          Access is logged. Unauthorised use is prohibited.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
