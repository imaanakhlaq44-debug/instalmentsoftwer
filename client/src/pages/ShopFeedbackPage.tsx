import React, { useEffect, useState } from 'react';
import { MessageSquareQuote } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { ApiService, type ReviewTestimonial, type TestimonialStatus } from '../services/api.js';
import { Card, EmptyState, Skeleton } from '../components/ui/Card.js';
import { shortDate } from '../utils/format.js';
import { Stars } from './FeedbackPage.js';

/**
 * The platform's review queue for shop feedback.
 *
 * Three decisions and no editor. A testimonial on the website carries a shop's
 * name, so its words have to be that shop's: the reviewer can approve it,
 * reject it with a note, or take a published one down — and if a spelling needs
 * fixing, the note asks the shop to fix it. There is no field here to type
 * into a quote, and the server has no route that would accept one.
 */

const STATUS: Record<TestimonialStatus, { label: string; pill: string }> = {
  PENDING: { label: 'Waiting for review', pill: 'status-pending' },
  APPROVED: { label: 'Approved for the website', pill: 'status-active' },
  REJECTED: { label: 'Rejected', pill: 'status-locked' },
  UNPUBLISHED: { label: 'Unpublished', pill: 'status-inactive' },
  WITHDRAWN: { label: 'Withdrawn by the shop', pill: 'status-inactive' },
};

/** Waiting first, then what is live, then the rest. */
const ORDER: TestimonialStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'UNPUBLISHED', 'WITHDRAWN'];

export const ShopFeedbackPage: React.FC = () => {
  const { showToast } = useAuth();
  const [rows, setRows] = useState<ReviewTestimonial[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Which row is being asked for a note, and for which decision. */
  const [noteFor, setNoteFor] = useState<{ id: string; kind: 'reject' | 'unpublish' } | null>(null);
  const [note, setNote] = useState('');

  const load = async () => {
    setFailed(false);
    try {
      const res = await ApiService.getTestimonials();
      setRows([...res.testimonials].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)));
    } catch {
      setFailed(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const act = async (id: string, run: () => Promise<unknown>, done: string) => {
    setBusyId(id);
    try {
      await run();
      showToast(done, 'success');
      setNoteFor(null);
      setNote('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'That did not work.', 'error');
    } finally {
      setBusyId(null);
      // Reload either way: a refusal usually means the shop changed something.
      void load();
    }
  };

  const waiting = rows?.filter((r) => r.status === 'PENDING').length ?? 0;

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Platform</p>
        <h1 className="mt-1 text-display text-ink-900">Shop feedback</h1>
        <p className="mt-1 max-w-2xl text-body text-ink-500">
          Feedback shops have allowed us to publish. Approve it to show it on the website, or reject it with a note.
        </p>
      </header>

      <p className="well p-3 text-caption text-ink-700">
        You cannot change a shop's words. If something needs fixing, reject it with a note and the shop will correct it
        and send it again.
      </p>

      {failed ? (
        <Card>
          <p className="text-body text-ink-700">Could not load shop feedback.</p>
          <button type="button" className="btn-secondary mt-3" onClick={() => void load()}>
            Try again
          </button>
        </Card>
      ) : !rows ? (
        <Card>
          <Skeleton className="h-40" />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MessageSquareQuote className="h-6 w-6" aria-hidden="true" />}
            title="No feedback yet"
            body="When a shop owner sends feedback from their dashboard, it appears here for you to review."
          />
        </Card>
      ) : (
        <>
          <p className="text-caption font-bold text-ink-700">
            {waiting === 0 ? 'Nothing waiting for review' : `${waiting} waiting for review`}
          </p>
          <ul className="space-y-4">
            {rows.map((t) => {
              const busy = busyId === t.id;
              const asking = noteFor?.id === t.id ? noteFor.kind : null;
              return (
                <li key={t.id}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-ink-900" data-i18n-skip>
                          {t.dealerName}
                        </p>
                        <p className="text-caption text-ink-500" data-i18n-skip>
                          {t.dealerCity}
                        </p>
                      </div>
                      <span className={`status-pill ${STATUS[t.status].pill}`}>{STATUS[t.status].label}</span>
                    </div>

                    <blockquote
                      data-i18n-skip
                      dir="auto"
                      className="mt-4 rounded-md border-2 border-ink-900 bg-white p-4 text-body font-semibold leading-relaxed text-ink-900"
                    >
                      {t.quote}
                    </blockquote>
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-700">
                      <Stars rating={t.rating} />
                      <span>Shown as</span>
                      <span data-i18n-skip dir="auto" className="font-bold">
                        {t.displayName}
                      </span>
                      <span data-i18n-skip dir="auto">
                        {t.city}
                      </span>
                    </div>
                    <p className="mt-2 text-caption text-ink-500">
                      <span>Permission to publish given by</span> <span data-i18n-skip>{t.consentByName}</span> ·{' '}
                      <span>{shortDate(t.consentAt)}</span>
                    </p>
                    {t.reviewNote && (
                      <p className="mt-2 text-caption text-ink-700">
                        <span className="font-bold">Your note:</span>{' '}
                        <span data-i18n-skip dir="auto">
                          {t.reviewNote}
                        </span>
                      </p>
                    )}
                    {!t.dealerActive && (
                      <p className="mt-2 text-caption font-bold text-caution-700">
                        This shop is suspended, so its feedback is not shown on the website.
                      </p>
                    )}

                    {asking ? (
                      <div className="mt-4 space-y-2">
                        <label className="field-label" htmlFor={`note-${t.id}`}>
                          {asking === 'reject' ? 'Why is it rejected? The shop will read this.' : 'Why is it unpublished? The shop will read this.'}
                        </label>
                        <input
                          id={`note-${t.id}`}
                          className="input"
                          dir="auto"
                          maxLength={300}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                        />
                        <div className="flex gap-3">
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={busy || note.trim().length < 3}
                            onClick={() =>
                              void act(
                                t.id,
                                () =>
                                  asking === 'reject'
                                    ? ApiService.rejectTestimonial(t.id, note)
                                    : ApiService.unpublishTestimonial(t.id, note),
                                asking === 'reject' ? 'Rejected. The shop can see your note.' : 'Unpublished. It will leave the website.'
                              )
                            }
                          >
                            {asking === 'reject' ? 'Reject' : 'Unpublish'}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={busy}
                            onClick={() => {
                              setNoteFor(null);
                              setNote('');
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      t.status !== 'WITHDRAWN' && (
                        <div className="mt-4 flex flex-wrap gap-3">
                          {t.status !== 'APPROVED' && (
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={busy}
                              onClick={() =>
                                void act(
                                  t.id,
                                  () => ApiService.approveTestimonial(t.id, t.updatedAt),
                                  'Approved. It will appear on the website.'
                                )
                              }
                            >
                              Approve
                            </button>
                          )}
                          {t.status === 'PENDING' && (
                            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setNoteFor({ id: t.id, kind: 'reject' })}>
                              Reject
                            </button>
                          )}
                          {t.status === 'APPROVED' && (
                            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setNoteFor({ id: t.id, kind: 'unpublish' })}>
                              Unpublish
                            </button>
                          )}
                        </div>
                      )
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
};
