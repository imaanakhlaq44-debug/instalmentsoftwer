import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { CheckCircle2, Eye, EyeOff, Loader2, MessageCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { ApiError, ApiService } from '../services/api.js';
import { MAX_PACK_SIZE, PACK_PRESETS, money, priceForPack } from '../utils/packPricing.js';

/**
 * A shop signs itself up.
 *
 * Signing up creates the shop and its owner's login, and records the pack of
 * locks the shop wants. It does not issue locks: there is no payment gateway,
 * so the platform confirms the money first and then issues the pack from the
 * Licenses page. The screen after sign-up says exactly that, and points the
 * shop at WhatsApp to pay, so nobody is surprised at the counter.
 */

const WHATSAPP_NUMBER = '923211144477';

interface Form {
  name: string;
  ownerName: string;
  email: string;
  phone: string;
  city: string;
  address: string;
  password: string;
  confirm: string;
  packSize: number;
}

const EMPTY: Form = {
  name: '',
  ownerName: '',
  email: '',
  phone: '',
  city: '',
  address: '',
  password: '',
  confirm: '',
  packSize: 30,
};

/** Checks the browser can make before bothering the server. */
export function validateSignup(f: Form): string | null {
  if (f.name.trim().length < 2) return 'Please enter your shop name.';
  if (f.ownerName.trim().length < 2) return "Please enter the owner's name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return 'Please enter a valid email address.';
  if (!/^(03\d{2}-?\d{7}|\+?923\d{9})$/.test(f.phone.trim())) {
    return 'Please enter a Pakistani mobile number, e.g. 0300-1234567.';
  }
  if (f.city.trim().length < 2) return 'Please enter your city.';
  if (f.address.trim().length < 5) return 'Please enter the full shop address.';
  if (f.password.length < 8) return 'Password must be at least 8 characters.';
  if (f.password !== f.confirm) return 'The two passwords do not match.';
  if (!priceForPack(f.packSize)) return `Choose between 1 and ${MAX_PACK_SIZE} locks.`;
  return null;
}

export const RegisterPage: React.FC = () => {
  const { login, isAuthenticated, isBootstrapping } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(EMPTY);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-100">
        <Loader2 className="h-6 w-6 animate-spin text-ink-400" aria-label="Loading" />
      </div>
    );
  }

  // Someone already signed in has no business on the sign-up form.
  if (isAuthenticated && !done) return <Navigate to="/" replace />;

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const pack = priceForPack(form.packSize);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = validateSignup(form);
    if (problem) {
      setError(problem);
      return;
    }

    setSubmitting(true);
    try {
      await ApiService.registerDealer({
        name: form.name.trim(),
        ownerName: form.ownerName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        city: form.city.trim(),
        address: form.address.trim(),
        password: form.password,
        packSize: form.packSize,
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        const detail = err.details?.map((d) => d.message).filter(Boolean).join(' ');
        setError(detail || err.message);
      } else {
        setError('Sign-up failed. Please check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    const text = encodeURIComponent(
      `Salam, maine Almas SDM par "${form.name.trim()}" register kiya hai (${form.email.trim()}). ` +
        `${pack?.size} locks chahiye: ${money(pack?.totalPrice ?? 0)}. Payment ki detail bhej dein.`
    );
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-100 p-4">
        <div className="surface w-full max-w-md p-6 sm:p-8">
          <CheckCircle2 className="h-10 w-10 text-positive-600" aria-hidden="true" />
          <h1 className="mt-4 text-display text-ink-900">Your shop is registered</h1>
          <p className="mt-2 text-body text-ink-700">
            <b>{form.name.trim()}</b> can sign in now with <b>{form.email.trim()}</b>.
          </p>

          <div className="mt-5 rounded-md border-2 border-ink-900 bg-sun-100 p-4">
            <p className="eyebrow text-ink-700">Next step: pay for your locks</p>
            <p className="mt-1.5 text-body text-ink-900">
              <b>{pack?.size} locks</b> · {money(pack?.unitPrice ?? 0)} per phone · <b>{money(pack?.totalPrice ?? 0)}</b> total
            </p>
            <p className="mt-2 text-caption text-ink-700">
              Your locks are added as soon as we confirm the payment. Until then you can explore the dashboard,
              but a new financed sale cannot be registered.
            </p>
          </div>

          {/* The next step is on the dashboard: the account to pay into, and
              the form for the transaction ID. */}
          <button
            type="button"
            className="btn-primary mt-5 w-full py-2.5"
            onClick={async () => {
              await login(form.email.trim(), form.password);
              navigate('/buy-locks', { replace: true });
            }}
          >
            Pay and get my locks
          </button>
          <a
            className="btn mt-3 w-full border-2 border-ink-900 bg-[#25D366] py-2.5 text-ink-900 shadow-[3px_3px_0_#0F1419]"
            href={`https://wa.me/${WHATSAPP_NUMBER}?text=${text}`}
            target="_blank"
            rel="noopener"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            Ask us on WhatsApp
          </a>
          <button
            type="button"
            className="btn-ghost mt-3 w-full py-2"
            onClick={async () => {
              await login(form.email.trim(), form.password);
              navigate('/', { replace: true });
            }}
          >
            Open my dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-100 p-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <img src="/logo-lockup.webp" alt="Almas SDM" width={720} height={629} className="mx-auto mb-4 h-20 w-auto" />
          <h1 className="text-display text-ink-900">Register your shop</h1>
          <p className="mt-1 text-body text-ink-500">No monthly fee. Pay once per phone, from Rs 600.</p>
        </div>

        <form onSubmit={handleSubmit} className="surface p-6 sm:p-7" noValidate>
          {error && (
            <div role="alert" className="mb-5 rounded-md border-2 border-critical-600 bg-critical-50 px-3.5 py-2.5 text-body text-critical-700">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="r-name" className="field-label">Shop name</label>
              <input id="r-name" className="input" value={form.name} onChange={set('name')} disabled={submitting} placeholder="Al Madina Mobiles" />
            </div>
            <div>
              <label htmlFor="r-owner" className="field-label">Owner's name</label>
              <input id="r-owner" className="input" value={form.ownerName} onChange={set('ownerName')} disabled={submitting} autoComplete="name" />
            </div>
            <div>
              <label htmlFor="r-phone" className="field-label">Mobile number</label>
              <input id="r-phone" className="input" value={form.phone} onChange={set('phone')} disabled={submitting} inputMode="tel" autoComplete="tel" placeholder="0300-1234567" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="r-email" className="field-label">Email (for signing in)</label>
              <input id="r-email" type="email" className="input" value={form.email} onChange={set('email')} disabled={submitting} autoComplete="email" placeholder="you@yourshop.pk" />
            </div>
            <div>
              <label htmlFor="r-city" className="field-label">City</label>
              <input id="r-city" className="input" value={form.city} onChange={set('city')} disabled={submitting} autoComplete="address-level2" />
            </div>
            <div>
              <label htmlFor="r-address" className="field-label">Shop address</label>
              <input id="r-address" className="input" value={form.address} onChange={set('address')} disabled={submitting} autoComplete="street-address" />
            </div>
            <div>
              <label htmlFor="r-password" className="field-label">Password</label>
              <div className="relative">
                <input
                  id="r-password"
                  type={showPassword ? 'text' : 'password'}
                  className="input pe-11"
                  value={form.password}
                  onChange={set('password')}
                  disabled={submitting}
                  autoComplete="new-password"
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
            </div>
            <div>
              <label htmlFor="r-confirm" className="field-label">Repeat password</label>
              <input
                id="r-confirm"
                type={showPassword ? 'text' : 'password'}
                className="input"
                value={form.confirm}
                onChange={set('confirm')}
                disabled={submitting}
                autoComplete="new-password"
              />
            </div>
          </div>

          <fieldset className="mt-6">
            <legend className="field-label">How many locks? (one lock per phone)</legend>
            <div className="flex flex-wrap gap-2">
              {PACK_PRESETS.map((n) => {
                const selected = n === form.packSize;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, packSize: n }))}
                    aria-pressed={selected}
                    className={`rounded-md border-2 border-ink-900 px-3.5 py-1.5 text-body font-extrabold transition ${
                      selected ? 'bg-sun-400 shadow-[3px_3px_0_#0F1419]' : 'bg-white hover:bg-sun-100'
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
              <label className="flex items-center gap-2">
                <span className="sr-only">Number of locks</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_PACK_SIZE}
                  inputMode="numeric"
                  className="input w-24 py-1.5"
                  value={Number.isFinite(form.packSize) ? form.packSize : ''}
                  onChange={(e) => setForm((f) => ({ ...f, packSize: e.target.value === '' ? NaN : Number(e.target.value) }))}
                  disabled={submitting}
                  aria-label="Number of locks"
                />
              </label>
            </div>
            <div className="mt-3 rounded-md border-2 border-ink-900 bg-sun-100 px-3.5 py-2.5">
              {pack ? (
                <p className="text-body text-ink-900">
                  <b>{pack.size} locks</b> · {money(pack.unitPrice)} per phone · <b>{money(pack.totalPrice)}</b> total
                </p>
              ) : (
                <p className="text-body text-critical-700">Choose between 1 and {MAX_PACK_SIZE} locks.</p>
              )}
              <p className="mt-1 text-caption text-ink-700">
                1–29: Rs 1,000 · 30–49: Rs 800 · 50–99: Rs 700 · 100+: Rs 600 per phone
              </p>
            </div>
            <p className="mt-2 text-caption text-ink-500">
              You pay after signing up. Locks are added once the payment is confirmed.
            </p>
          </fieldset>

          <button type="submit" disabled={submitting} className="btn-primary mt-6 w-full py-2.5">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitting ? 'Registering…' : 'Register shop'}
          </button>

          <p className="mt-5 text-center text-caption text-ink-500">
            Already registered?{' '}
            <Link to="/login" className="font-bold text-ink-900 underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default RegisterPage;
