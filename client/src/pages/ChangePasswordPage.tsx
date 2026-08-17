import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Loader2, Check, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { ApiError } from '../services/api.js';

interface Rule {
  label: string;
  test: (value: string) => boolean;
}

/** Mirrors the server-side policy in server/src/utils/password.ts. */
const RULES: Rule[] = [
  { label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { label: 'Contains a letter', test: (v) => /[A-Za-z]/.test(v) },
  { label: 'Contains a number', test: (v) => /[0-9]/.test(v) },
];

export const ChangePasswordPage: React.FC = () => {
  const { changePassword, mustChangePassword, logout } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rulesPassed = RULES.every((r) => r.test(newPassword));
  const matches = newPassword.length > 0 && newPassword === confirmPassword;
  const canSubmit = currentPassword.length > 0 && rulesPassed && matches && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!matches) {
      setError('The two new passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-11 h-11 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center">
              <KeyRound className="w-5 h-5 text-blue-400" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Change your password</h1>
              {mustChangePassword && (
                <p className="text-xs text-amber-400 mt-0.5">
                  Required before you can use the dashboard.
                </p>
              )}
            </div>
          </div>

          {error && (
            <div role="alert" className="mb-5 px-4 py-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200 text-sm">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="current" className="block text-sm font-medium text-slate-300 mb-2">
              Current password
            </label>
            <input
              id="current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="new" className="block text-sm font-medium text-slate-300 mb-2">
              New password
            </label>
            <input
              id="new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <ul className="mt-3 space-y-1.5">
              {RULES.map((rule) => {
                const ok = rule.test(newPassword);
                return (
                  <li key={rule.label} className={`flex items-center gap-2 text-xs ${ok ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {ok ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <X className="w-3.5 h-3.5" aria-hidden="true" />}
                    {rule.label}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mb-6">
            <label htmlFor="confirm" className="block text-sm font-medium text-slate-300 mb-2">
              Confirm new password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {confirmPassword.length > 0 && !matches && (
              <p className="mt-2 text-xs text-rose-400">The passwords do not match.</p>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-semibold transition-colors"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            Update password
          </button>

          <button
            type="button"
            onClick={() => logout()}
            className="w-full mt-3 px-4 py-2.5 rounded-lg text-slate-400 hover:text-white text-sm transition-colors"
          >
            Sign out instead
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChangePasswordPage;
