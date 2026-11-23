import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Star, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { ApiService, ApiError } from '../../services/api.js';
import { isNativeShopApp } from '../../utils/nativeApp.js';
import {
  FEEDBACK_PROMPT_FIRST_DELAY_MS,
  readLastPromptAt,
  shouldPromptForFeedback,
  writeLastPromptAt,
} from '../../utils/feedbackPrompt.js';

const QUOTE_MIN = 20;
const QUOTE_MAX = 600;
/** How often an open dashboard re-checks whether it is time to ask again. */
const CHECK_EVERY_MS = 60 * 1000;

/**
 * Asks a shop owner for feedback, a few times a day, until they give it.
 *
 * Mounted once in the dashboard layout. It does nothing for anyone but a shop
 * owner in the browser dashboard, and nothing at all until the server has said
 * this shop has not sent feedback yet. The form is the Feedback page's, sent
 * to the same endpoint with the same explicit consent — the popup only saves
 * the owner from having to find the page.
 */
export const FeedbackPrompt: React.FC<{ firstDelayMs?: number; checkEveryMs?: number }> = ({
  firstDelayMs = FEEDBACK_PROMPT_FIRST_DELAY_MS,
  checkEveryMs = CHECK_EVERY_MS,
}) => {
  const { user, dealer, role, showToast } = useAuth();
  const { pathname } = useLocation();
  const native = isNativeShopApp();
  // A super admin viewing a shop keeps the SUPER_ADMIN role, so this also keeps the popup from them.
  const eligible = role === 'DEALER_ADMIN' && !native && Boolean(user?.id);

  const [hasFeedback, setHasFeedback] = useState<boolean | null>(null);
  const [consentText, setConsentText] = useState('');
  const [open, setOpen] = useState(false);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  // The server, not this browser, says whether the shop has given feedback.
  useEffect(() => {
    if (!eligible) return;
    let live = true;
    ApiService.getMyTestimonial()
      .then((res) => {
        if (!live) return;
        setConsentText(res.consentText);
        setHasFeedback(Boolean(res.testimonial));
      })
      .catch(() => {
        /* unknown: never ask on a guess */
      });
    return () => {
      live = false;
    };
  }, [eligible]);

  useEffect(() => {
    if (!eligible || hasFeedback !== false || !user?.id) return;
    const userId = user.id;
    const check = () => {
      const now = Date.now();
      if (
        shouldPromptForFeedback({
          role,
          native,
          hasFeedback,
          lastShownAt: readLastPromptAt(userId),
          now,
          path: pathRef.current,
        })
      ) {
        // Counted as shown the moment it opens: closing the tab does not make it come straight back.
        writeLastPromptAt(userId, now);
        setOpen(true);
      }
    };
    let interval: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      check();
      interval = setInterval(check, checkEveryMs);
    }, firstDelayMs);
    return () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    };
  }, [eligible, hasFeedback, user?.id, role, native, firstDelayMs, checkEveryMs]);

  if (!open) return null;
  return (
    <FeedbackPromptDialog
      consentText={consentText}
      defaultName={dealer?.name ?? user?.name ?? ''}
      defaultCity={dealer?.city ?? ''}
      onLater={() => setOpen(false)}
      onSent={() => {
        setHasFeedback(true);
        setOpen(false);
        showToast('Thank you. Your feedback was sent for review.', 'success');
      }}
      onError={(message) => showToast(message, 'error')}
    />
  );
};

const FeedbackPromptDialog: React.FC<{
  consentText: string;
  defaultName: string;
  defaultCity: string;
  onLater: () => void;
  onSent: () => void;
  onError: (message: string) => void;
}> = ({ consentText, defaultName, defaultCity, onLater, onSent, onError }) => {
  const [quote, setQuote] = useState('');
  const [rating, setRating] = useState(0);
  const [displayName, setDisplayName] = useState(defaultName);
  const [city, setCity] = useState(defaultCity);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onLater();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onLater]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problems: Record<string, string> = {};
    if (quote.trim().length < QUOTE_MIN) problems.quote = `Please write at least ${QUOTE_MIN} characters.`;
    if (rating < 1) problems.rating = 'Choose 1 to 5 stars.';
    if (displayName.trim().length < 2) problems.displayName = 'Enter the name to show.';
    if (city.trim().length < 2) problems.city = 'Enter the city to show.';
    if (!consent) problems.consent = 'Tick the box to allow publication, or do not submit.';
    setErrors(problems);
    if (Object.keys(problems).length) return;

    setBusy(true);
    try {
      await ApiService.submitMyTestimonial({ quote, rating, displayName, city, consent });
      onSent();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      onError(err instanceof Error ? err.message : 'Could not send your feedback.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fbp-title"
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm sm:items-center"
    >
      <div className="relative w-full max-w-lg rounded-xl border-2 border-ink-900 bg-paper-50 p-5 shadow-xl sm:p-6">
        <button
          type="button"
          onClick={onLater}
          aria-label="Close"
          className="absolute end-3 top-3 rounded-md p-1.5 text-ink-500 hover:bg-paper-200"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <h2 id="fbp-title" className="pe-8 text-title font-bold text-ink-900">
          How is Almas SDM working for your shop?
        </h2>
        <p className="mt-1 text-body text-ink-600">
          Tell us how Almas SDM is working for your shop. If you allow it, we may show your words on our website.
        </p>

        <form className="mt-4 space-y-4" onSubmit={(e) => void submit(e)} noValidate>
          <div>
            <span className="field-label" id="fbp-rating-label">
              Your rating
            </span>
            <div className="flex gap-1.5" role="radiogroup" aria-labelledby="fbp-rating-label">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} out of 5`}
                  onClick={() => setRating(n)}
                  className="rounded-md border-2 border-ink-900 bg-white p-1.5 hover:bg-sun-100"
                >
                  <Star className={`h-6 w-6 ${n <= rating ? 'fill-sun-400 text-ink-900' : 'text-ink-300'}`} aria-hidden="true" />
                </button>
              ))}
            </div>
            {errors.rating && <p className="mt-1 text-caption text-critical-700">{errors.rating}</p>}
          </div>

          <div>
            <label className="field-label" htmlFor="fbp-quote">
              Your feedback
            </label>
            <textarea
              id="fbp-quote"
              dir="auto"
              rows={4}
              maxLength={QUOTE_MAX}
              className="input"
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              aria-invalid={Boolean(errors.quote)}
              placeholder="Urdu, Roman Urdu or English: write the way you speak."
            />
            {errors.quote && <p className="mt-1 text-caption text-critical-700">{errors.quote}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="fbp-name">
                Name to show
              </label>
              <input
                id="fbp-name"
                dir="auto"
                className="input"
                maxLength={80}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                aria-invalid={Boolean(errors.displayName)}
              />
              {errors.displayName && <p className="mt-1 text-caption text-critical-700">{errors.displayName}</p>}
            </div>
            <div>
              <label className="field-label" htmlFor="fbp-city">
                City to show
              </label>
              <input
                id="fbp-city"
                dir="auto"
                className="input"
                maxLength={60}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                aria-invalid={Boolean(errors.city)}
              />
              {errors.city && <p className="mt-1 text-caption text-critical-700">{errors.city}</p>}
            </div>
          </div>

          <div className="rounded-md border-2 border-ink-900 bg-sun-100 p-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-ink-900"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span className="text-caption font-semibold text-ink-900">{consentText}</span>
            </label>
            {errors.consent && <p className="mt-1 text-caption text-critical-700">{errors.consent}</p>}
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn-primary" disabled={busy}>
              Send for review
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={onLater}>
              Later
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
