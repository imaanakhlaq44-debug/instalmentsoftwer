import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Eye, EyeOff, KeyRound, Loader2, Mail, MessageCircle, MessageSquareText, X } from 'lucide-react';
import { ApiError, ApiService } from '../services/api.js';

/** Almas SDM support on WhatsApp — the same number as sign-up and Buy locks. */
const WHATSAPP_NUMBER = '923211144477';

/** Mirrors the server-side policy in server/src/utils/password.ts. */
export const RULES: { label: string; test: (v: string) => boolean }[] = [
  { label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { label: 'Contains a letter', test: (v) => /[A-Za-z]/.test(v) },
  { label: 'Contains a number', test: (v) => /[0-9]/.test(v) },
];

type Step = 'email' | 'code' | 'sent';

/**
 * "Forgot password", for every shop on its own.
 *
 * Step one asks for the sign-in email; a six-digit code goes by SMS to the
 * mobile number on that account. Step two takes the code and the new
 * password. A server with no SMS gateway yet says so up front and offers
 * WhatsApp support instead of a form that would never deliver anything.
 */
export const ForgotPasswordPage: React.FC = () => {
  const navigate = useNavigate();

  const [available, setAvailable] = useState<boolean | null>(null);
  const [channel, setChannel] = useState<'email' | 'sms'>('sms');
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    ApiService.passwordResetStatus()
      .then((res) => {
        setAvailable(res.available);
        if (res.channel === 'email') setChannel('email');
      })
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Please enter the email you sign in with.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await ApiService.forgotPassword(email.trim());
      if (!res.available) {
        setAvailable(false);
        return;
      }
      setNotice(res.message);
      if (res.channel === 'email') setChannel('email');
      setStep(res.channel === 'email' ? 'sent' : 'code');
      setResendIn(60);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The code could not be sent. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const rulesPassed = RULES.every((r) => r.test(newPassword));
  const matches = newPassword.length > 0 && newPassword === confirmPassword;
  const codeOk = /^\d{6}$/.test(code);

  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!codeOk) return setError('Enter the 6-digit code from the SMS.');
    if (!rulesPassed) return setError('Choose a stronger password.');
    if (!matches) return setError('The two new passwords do not match.');

    setSubmitting(true);
    try {
      const res = await ApiService.resetPasswordWithCode(email.trim(), code, newPassword);
      navigate('/login', { replace: true, state: { notice: res.message, email: email.trim() } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The password could not be changed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const whatsappText = encodeURIComponent(
    `Assalam o Alaikum, mujhe Almas SDM ka password reset karwana hai.${email.trim() ? ` Email: ${email.trim()}` : ''}`
  );

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
              <h1 className="font-display text-title font-black text-ink-900">Reset your password</h1>
              <p className="text-caption text-ink-500">
                {available === false
                  ? 'We can help you on WhatsApp.'
                  : step === 'sent'
                    ? 'Check your email.'
                    : step === 'email'
                      ? channel === 'email'
                        ? 'We will email you a link.'
                        : 'We will send a code to your mobile.'
                      : 'Enter the code and a new password.'}
              </p>
            </div>
          </div>

          {error && (
            <div role="alert" className="mb-4 rounded-md border border-critical-200 bg-critical-50 px-3.5 py-2.5 text-body text-critical-700">
              {error}
            </div>
          )}

          {available === null ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-ink-400" aria-label="Loading" />
            </div>
          ) : available === false ? (
            <div className="space-y-4">
              <p className="text-body text-ink-700">
                Password reset by SMS is not switched on yet. Message Almas SDM support on WhatsApp from your shop&apos;s
                registered number and we will reset it for you.
              </p>
              <p className="text-caption text-ink-500" lang="ur-Latn">
                SMS se password reset abhi on nahi hai. Apne registered number se WhatsApp par message karein, hum reset
                kar denge.
              </p>
              <a
                className="btn w-full border-2 border-ink-900 bg-[#25D366] py-2.5 text-ink-900 shadow-[3px_3px_0_#0F1419]"
                href={`https://wa.me/${WHATSAPP_NUMBER}?text=${whatsappText}`}
                target="_blank"
                rel="noopener"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                WhatsApp support
              </a>
            </div>
          ) : step === 'email' ? (
            <form onSubmit={sendCode} noValidate>
              <label htmlFor="reset-email" className="field-label">
                Email address
              </label>
              <input
                id="reset-email"
                type="email"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                className="input"
                placeholder="you@yourshop.pk"
              />
              <p className="mt-1.5 text-micro text-ink-400">
                {channel === 'email'
                  ? 'A link to choose a new password goes to this email.'
                  : 'The code goes by SMS to the mobile number saved on your account.'}
              </p>
              <button type="submit" disabled={submitting} className="btn-primary mt-5 w-full py-2.5">
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                )}
                {submitting ? 'Sending…' : channel === 'email' ? 'Email me a reset link' : 'Send code'}
              </button>
            </form>
          ) : step === 'sent' ? (
            <div className="space-y-4">
              <div role="status" className="rounded-md border border-positive-200 bg-positive-50 px-3.5 py-2.5 text-caption text-positive-700">
                {notice}
              </div>
              <p className="flex items-start gap-2 text-body text-ink-700">
                <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Open the email from Almas SDM on <span className="font-bold" data-i18n-skip>{email.trim()}</span> and tap the
                  button in it. The link works once, for 30 minutes.
                </span>
              </p>
              <p className="text-caption text-ink-500" lang="ur-Latn">
                Apni email (Gmail) kholein, Almas SDM ki email mein button dabayein aur naya password banayein. Email na mile to
                Spam folder dekhein.
              </p>
              <button
                type="button"
                disabled={resendIn > 0 || submitting}
                onClick={() => void sendCode()}
                className="btn-secondary w-full py-2.5"
              >
                {resendIn > 0 ? `Send again in ${resendIn}s` : 'Send the email again'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setError(null);
                }}
                className="btn-ghost w-full py-2 text-caption"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={resetPassword} noValidate>
              {notice && (
                <div role="status" className="mb-4 rounded-md border border-positive-200 bg-positive-50 px-3.5 py-2.5 text-caption text-positive-700">
                  {notice}
                </div>
              )}

              <label htmlFor="reset-code" className="field-label">
                6-digit code
              </label>
              <input
                id="reset-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={submitting}
                className="input text-center font-mono text-lede tracking-[0.5em]"
                placeholder="••••••"
              />
              <div className="mt-1.5 flex items-center justify-between text-micro text-ink-400">
                <span>Sent to the mobile on {email.trim()}</span>
                <button
                  type="button"
                  disabled={resendIn > 0 || submitting}
                  onClick={() => void sendCode()}
                  className="font-bold text-accent-700 underline disabled:text-ink-300 disabled:no-underline"
                >
                  {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                </button>
              </div>

              <label htmlFor="reset-new" className="field-label mt-4">
                New password
              </label>
              <div className="relative">
                <input
                  id="reset-new"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
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
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setCode('');
                  setError(null);
                }}
                className="btn-ghost mt-2 w-full py-2 text-caption"
              >
                Use a different email
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

export default ForgotPasswordPage;
