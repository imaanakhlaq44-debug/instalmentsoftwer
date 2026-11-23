import { describe, it, expect, beforeEach } from 'vitest';
import {
  FEEDBACK_PROMPT_INTERVAL_MS,
  readLastPromptAt,
  shouldPromptForFeedback,
  writeLastPromptAt,
  type FeedbackPromptInput,
} from './feedbackPrompt.js';

const NOW = Date.UTC(2026, 10, 23, 10, 0, 0);
const base: FeedbackPromptInput = {
  role: 'DEALER_ADMIN',
  native: false,
  hasFeedback: false,
  lastShownAt: null,
  now: NOW,
  path: '/',
};
const ask = (over: Partial<FeedbackPromptInput> = {}) => shouldPromptForFeedback({ ...base, ...over });

describe('shouldPromptForFeedback', () => {
  it('asks a shop owner who has never been asked and has not given feedback', () => {
    expect(ask()).toBe(true);
  });

  it('never asks once the server says the shop has given feedback', () => {
    expect(ask({ hasFeedback: true })).toBe(false);
    expect(ask({ hasFeedback: true, lastShownAt: NOW - 10 * FEEDBACK_PROMPT_INTERVAL_MS })).toBe(false);
  });

  it('does not ask while the server has not answered', () => {
    expect(ask({ hasFeedback: null })).toBe(false);
  });

  it('asks only shop owners: not staff, viewers or the platform', () => {
    for (const role of ['SUPER_ADMIN', 'DEALER_STAFF', 'DEALER_VIEWER', 'CUSTOMER', null]) {
      expect(ask({ role })).toBe(false);
    }
  });

  it('stays out of the native shop app and off the Feedback page itself', () => {
    expect(ask({ native: true })).toBe(false);
    expect(ask({ path: '/feedback' })).toBe(false);
  });

  it('waits the full interval after "Later" — at most 3–4 times in a day', () => {
    expect(ask({ lastShownAt: NOW - FEEDBACK_PROMPT_INTERVAL_MS + 1 })).toBe(false);
    expect(ask({ lastShownAt: NOW - FEEDBACK_PROMPT_INTERVAL_MS })).toBe(true);

    // Simulate a full day of use, checking every minute.
    let last: number | null = null;
    let shown = 0;
    for (let t = NOW; t < NOW + 24 * 3600_000; t += 60_000) {
      if (ask({ now: t, lastShownAt: last })) {
        shown++;
        last = t;
      }
    }
    expect(shown).toBeGreaterThanOrEqual(3);
    expect(shown).toBeLessThanOrEqual(5);
  });
});

describe('last-prompt memory', () => {
  beforeEach(() => localStorage.clear());

  it('is per user and round-trips', () => {
    expect(readLastPromptAt('u1')).toBeNull();
    writeLastPromptAt('u1', NOW);
    expect(readLastPromptAt('u1')).toBe(NOW);
    expect(readLastPromptAt('u2')).toBeNull();
  });

  it('treats garbage as never asked', () => {
    localStorage.setItem('almas_feedback_prompt_at:u1', 'nope');
    expect(readLastPromptAt('u1')).toBeNull();
  });
});
