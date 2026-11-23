import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Eye, EyeOff, KeyRound, Loader2, X } from 'lucide-react';
import { ApiError, ApiService } from '../services/api.js';
import { RULES } from './ForgotPasswordPage.js';

/**
 * Where the link in a password-reset email lands: choose a new password.
 *
 * The link carries a one-time id and token. They go to the server with the new
 * password; the server checks them, so nothing here trusts them.
 */
export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const id = params.get('id') ?? '';
  const token = params.get('token') ?? '';
  const linkOk = id.length > 0 && /^[0-9a-f]{64}$/.test(token);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rulesPassed = RULES.every((r) => r.test(newPassword));
  const matches = newPassword.length > 0 && newPassword === confirmPassword;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!rulesPassed) return setError('Choose a stronger password.');
    if (!matches) return setError('The two new passwords do not match.');

    setSubmitting(true);
    try {
      const res = await ApiService.resetPasswordWithLink(id, token, newPassword);
      navigate('/login', { replace: true, state: { notice: res.message, email: res.email } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The password could not be changed. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/logo-lockup.webp" alt="Almas SDM" width={720} height={629} className="mx-auto mb-4 h-20 w-auto" />
        </div>

        <div className="surface p-6 shadow-hairline sm:p-7">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border-2 border-ink-900 bg-sun-200">
              <KeyRound className="h-5 w-5 text-ink-900" aria-hidden="true" />
            </span>
            <div>
              <h1 className="font-display text-title font-black text-ink-900">Choose a new password</h1>
              <p className="text-caption text-ink-500">Naya password banayein.</p>
            </div>
          </div>

          {error && (
            <div role="alert" className="mb-4 rounded-md border border-critical-200 bg-critical-50 px-3.5 py-2.5 text-body text-critical-700">
              {error}
            </div>
          )}

          {!linkOk ? (
            <div className="space-y-4">
              <p className="text-body text-ink-700">
                This reset link is not complete. Open it again from the email, or ask for a new one.
              </p>
              <Link to="/forgot-password" className="btn-primary w-full py-2.5">
                Ask for a new link
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <label htmlFor="reset-new" className="field-label">
                New password
              </label>
              <div className="relative">
                <input
                  id="reset-new"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  autoFocus
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={submitting}
                  className="input pe-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-700"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                </button>
              </div>
              <ul className="mt-2 space-y-0.5">
                {RULES.map((r) => {
                  const ok = r.test(newPassword);
                  return (
                    <li key={r.label} className={`flex items-center gap-1.5 text-micro ${ok ? 'text-positive-700' : 'text-ink-400'}`}>
                      {ok ? <Check className="h-3 w-3" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}
                      {r.label}
                    </li>
                  );
                })}
              </ul>

              <label htmlFor="reset-confirm" className="field-label mt-4">
                Confirm new password
              </label>
              <input
                id="reset-confirm"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={submitting}
                className="input"
              />
              {confirmPassword && !matches && (
                <p className="mt-1 text-micro font-semibold text-critical-700">The passwords do not match.</p>
              )}

              <button type="submit" disabled={submitting} className="btn-primary mt-5 w-full py-2.5">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {submitting ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          )}
        </div>

        <Link to="/login" className="btn-secondary mt-5 w-full py-2.5">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          Back to sign in
        </Link>
      </div>
    </div>
  );
};

export default ResetPasswordPage;
