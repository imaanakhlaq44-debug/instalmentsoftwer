/**
 * When the dashboard asks a shop owner for feedback.
 *
 * Shop owners rarely open the Feedback page on their own, so the dashboard
 * asks — but politely: at most once every few hours of use (three or four
 * times on a long working day), with a "Later" button, and never again once
 * the shop has sent feedback. Whether it has is the server's answer (the
 * shop's testimonial row), not this browser's memory: the owner may have
 * written it from another phone or computer.
 */

/** Minimum gap between two prompts. Five hours ≈ three or four times a day. */
export const FEEDBACK_PROMPT_INTERVAL_MS = 5 * 60 * 60 * 1000;

/** How long after the dashboard opens before the first prompt, so it never greets a login. */
export const FEEDBACK_PROMPT_FIRST_DELAY_MS = 60 * 1000;

export interface FeedbackPromptInput {
  role: string | null | undefined;
  /** The Android shop app keeps its own small screens; no popup there. */
  native: boolean;
  /** From GET /testimonials/mine: `null` = unknown yet, never prompt on a guess. */
  hasFeedback: boolean | null;
  /** Last time the prompt was shown (ms), or null if never. */
  lastShownAt: number | null;
  now: number;
  /** The current route; the Feedback page itself needs no popup. */
  path: string;
}

export function shouldPromptForFeedback(i: FeedbackPromptInput): boolean {
  if (i.role !== 'DEALER_ADMIN') return false; // owners only: not staff, viewers or the platform
  if (i.native) return false;
  if (i.hasFeedback !== false) return false; // sent already, or the server has not said yet
  if (i.path.startsWith('/feedback')) return false;
  if (i.lastShownAt === null) return true;
  return i.now - i.lastShownAt >= FEEDBACK_PROMPT_INTERVAL_MS;
}

const key = (userId: string) => `almas_feedback_prompt_at:${userId}`;

export function readLastPromptAt(userId: string): number | null {
  try {
    const raw = localStorage.getItem(key(userId));
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeLastPromptAt(userId: string, at: number): void {
  try {
    localStorage.setItem(key(userId), String(at));
  } catch {
    /* private mode: the prompt may simply come back sooner */
  }
}
