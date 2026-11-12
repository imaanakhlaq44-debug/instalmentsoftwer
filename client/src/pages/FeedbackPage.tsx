import React, { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { ApiService, ApiError, type Testimonial, type TestimonialStatus } from '../services/api.js';
import { Card, CardHeader, Skeleton } from '../components/ui/Card.js';
import { shortDate } from '../utils/format.js';

/**
 * Feedback for the website.
 *
 * The shop owner says what they think of the product, in their own words, and
 * decides whether it may be printed under their name. Nothing here is edited
 * by anyone else: what the owner types is what the website shows, or nothing.
 * The consent box is not decoration — the server refuses a submission without
 * it, and the owner can take the feedback back whenever they like.
 */

const QUOTE_MIN = 20;
const QUOTE_MAX = 600;

const STATUS: Record<TestimonialStatus, { label: string; pill: string; body: string }> = {
  PENDING: {
    label: 'Waiting for review',
    pill: 'status-pending',
    body: 'We will read it soon. It is not on the website yet.',
  },
  APPROVED: {
    label: 'Approved for the website',
    pill: 'status-active',
    body: 'It appears on the website the next time the site is updated, exactly as you wrote it.',
  },
  REJECTED: {
    label: 'Not accepted',
    pill: 'status-locked',
    body: 'It is not on the website. You can change it and send it again.',
  },
  UNPUBLISHED: {
    label: 'Taken off the website',
    pill: 'status-inactive',
    body: 'It was removed from the website. You can change it and send it again.',
  },
  WITHDRAWN: {
    label: 'Withdrawn by you',
    pill: 'status-inactive',
    body: 'You took it back, so it is not shown anywhere. You can send feedback again whenever you like.',
  },
};

export const Stars: React.FC<{ rating: number; className?: string }> = ({ rating, className = '' }) => (
  <span className={`inline-flex items-center gap-0.5 ${className}`} role="img" aria-label={`${rating} out of 5`}>
    {[1, 2, 3, 4, 5].map((n) => (
      <Star key={n} className={`h-4 w-4 ${n <= rating ? 'fill-sun-400 text-ink-900' : 'text-ink-300'}`} aria-hidden="true" />
    ))}
  </span>
);

export const FeedbackPage: React.FC = () => {
  const { user, dealer, showToast } = useAuth();

  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState<Testimonial | null>(null);
  const [consentText, setConsentText] = useState('');
  const [editing, setEditing] = useState(false);

  const [quote, setQuote] = useState('');
  const [rating, setRating] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [city, setCity] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  /** Fills the form from what is saved. Consent is never pre-ticked. */
  const fillForm = (t: Testimonial | null) => {
    setQuote(t?.quote ?? '');
    setRating(t?.rating ?? 0);
    setDisplayName(t?.displayName ?? user?.name ?? '');
    setCity(t?.city ?? dealer?.city ?? '');
    setConsent(false);
    setErrors({});
  };

  const load = async () => {
    setFailed(false);
    try {
      const res = await ApiService.getMyTestimonial();
      setCurrent(res.testimonial);
      setConsentText(res.consentText);
      fillForm(res.testimonial);
      setEditing(!res.testimonial);
      setLoaded(true);
    } catch {
      setFailed(true);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const res = await ApiService.submitMyTestimonial({ quote, rating, displayName, city, consent });
      setCurrent(res.testimonial);
      fillForm(res.testimonial);
      setEditing(false);
      showToast('Thank you. Your feedback was sent for review.', 'success');
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      showToast(err instanceof Error ? err.message : 'Could not send your feedback.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    try {
      const res = await ApiService.withdrawMyTestimonial();
      setCurrent(res.testimonial);
      setConfirmWithdraw(false);
      showToast('Your feedback was withdrawn.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not withdraw your feedback.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const status = current ? STATUS[current.status] : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <p className="eyebrow">Your opinion</p>
        <h1 className="mt-1 text-display text-ink-900">Feedback</h1>
        <p className="mt-1 text-body text-ink-500">
          Tell us how Almas SDM is working for your shop. If you allow it, we may show your words on our website.
        </p>
      </header>

      {failed ? (
        <Card>
          <p className="text-body text-ink-700">Could not load your feedback.</p>
          <button type="button" className="btn-secondary mt-3" onClick={() => void load()}>
            Try again
          </button>
        </Card>
      ) : !loaded ? (
        <Card>
          <Skeleton className="h-48" />
        </Card>
      ) : (
        <>
          {current && status && !editing && (
            <Card>
              <CardHeader
                title="What you sent"
                action={<span className={`status-pill ${status.pill}`}>{status.label}</span>}
              />
              <blockquote
                data-i18n-skip
                dir="auto"
                className="mt-4 rounded-md border-2 border-ink-900 bg-white p-4 text-body font-semibold leading-relaxed text-ink-900"
              >
                {current.quote}
              </blockquote>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-700">
                <Stars rating={current.rating} />
                <span data-i18n-skip dir="auto" className="font-bold">
                  {current.displayName}
                </span>
                <span data-i18n-skip dir="auto">
                  {current.city}
                </span>
              </div>

              <p className="mt-4 text-body text-ink-700">{status.body}</p>
              {current.reviewNote && (current.status === 'REJECTED' || current.status === 'UNPUBLISHED') && (
                <div className="well mt-3 p-3">
                  <p className="eyebrow">Note from Almas SDM</p>
                  <p className="mt-1 text-body text-ink-900" data-i18n-skip dir="auto">
                    {current.reviewNote}
                  </p>
                </div>
              )}
              {current.status !== 'WITHDRAWN' && (
                <p className="mt-3 text-caption text-ink-500">
                  <span>Permission to publish given by</span>{' '}
                  <span data-i18n-skip>{current.consentByName}</span> · <span>{shortDate(current.consentAt)}</span>
                </p>
              )}

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    fillForm(current);
                    setEditing(true);
                  }}
                >
                  {current.status === 'WITHDRAWN' ? 'Send feedback again' : 'Change my feedback'}
                </button>
                {current.status !== 'WITHDRAWN' && !confirmWithdraw && (
                  <button type="button" className="btn-ghost text-critical-700" onClick={() => setConfirmWithdraw(true)}>
                    Withdraw my feedback
                  </button>
                )}
              </div>

              {confirmWithdraw && (
                <div className="mt-4 rounded-md border-2 border-critical-200 bg-critical-50 p-4">
                  <p className="text-body font-bold text-ink-900">Withdraw your feedback?</p>
                  <p className="mt-1 text-caption text-ink-700">
                    We will stop showing it. It leaves the website the next time the site is updated, at most a day.
                  </p>
                  <div className="mt-3 flex gap-3">
                    <button type="button" className="btn-primary" disabled={busy} onClick={() => void withdraw()}>
                      Yes, withdraw it
                    </button>
                    <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirmWithdraw(false)}>
                      Keep it
                    </button>
                  </div>
                </div>
              )}
            </Card>
          )}

          {editing && (
            <Card>
              <CardHeader
                title={current ? 'Change your feedback' : 'Write your feedback'}
                hint="Urdu, Roman Urdu or English: write the way you speak."
              />
              {current && current.status !== 'WITHDRAWN' && (
                <p className="well mt-4 p-3 text-caption text-ink-700">
                  If you change it, it goes back for review and comes off the website until it is approved again.
                </p>
              )}

              <form className="mt-5 space-y-5" onSubmit={(e) => void submit(e)} noValidate>
                <div>
                  <label className="field-label" htmlFor="fb-quote">
                    Your feedback
                  </label>
                  <textarea
                    id="fb-quote"
                    dir="auto"
                    rows={5}
                    maxLength={QUOTE_MAX}
                    className="input"
                    value={quote}
                    onChange={(e) => setQuote(e.target.value)}
                    aria-invalid={Boolean(errors.quote)}
                  />
                  <div className="mt-1 flex justify-between gap-3 text-caption">
                    <span className="text-critical-700">{errors.quote ?? ''}</span>
                    <span className="tabular text-ink-400">
                      {quote.length}/{QUOTE_MAX}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="field-label" id="fb-rating-label">
                    Your rating
                  </span>
                  <div className="flex gap-1.5" role="radiogroup" aria-labelledby="fb-rating-label">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={rating === n}
                        aria-label={`${n} out of 5`}
                        onClick={() => setRating(n)}
                        className="rounded-md border-2 border-ink-900 bg-white p-2 hover:bg-sun-100"
                      >
                        <Star className={`h-6 w-6 ${n <= rating ? 'fill-sun-400 text-ink-900' : 'text-ink-300'}`} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                  {errors.rating && <p className="mt-1 text-caption text-critical-700">{errors.rating}</p>}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="field-label" htmlFor="fb-name">
                      Name to show
                    </label>
                    <input
                      id="fb-name"
                      dir="auto"
                      className="input"
                      maxLength={80}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      aria-invalid={Boolean(errors.displayName)}
                    />
                    <p className="mt-1 text-caption text-ink-400">Your name, or your shop's name. Your choice.</p>
                    {errors.displayName && <p className="mt-1 text-caption text-critical-700">{errors.displayName}</p>}
                  </div>
                  <div>
                    <label className="field-label" htmlFor="fb-city">
                      City to show
                    </label>
                    <input
                      id="fb-city"
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

                <div className="rounded-md border-2 border-ink-900 bg-sun-100 p-4">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-ink-900"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    <span className="text-body font-semibold text-ink-900">{consentText}</span>
                  </label>
                  <p className="mt-2 text-caption text-ink-700">
                    We never show your phone number, email or shop ID, and we do not change your words.
                  </p>
                  {errors.consent && <p className="mt-2 text-caption font-bold text-critical-700">{errors.consent}</p>}
                </div>

                <div className="flex flex-wrap gap-3">
                  <button type="submit" className="btn-primary" disabled={busy}>
                    Send for review
                  </button>
                  {current && (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => {
                        fillForm(current);
                        setEditing(false);
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </Card>
          )}
        </>
      )}
    </div>
  );
};
