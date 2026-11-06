import { describe, it, expect } from 'vitest';
import { timeLeft } from './EnrollmentPage.js';

describe('QR expiry countdown', () => {
  const now = Date.parse('2026-11-06T10:00:00Z');

  it('shows hours and minutes, then minutes', () => {
    expect(timeLeft('2026-11-06T12:00:00Z', now)).toBe('2h 0m');
    expect(timeLeft('2026-11-06T11:59:00Z', now)).toBe('1h 59m');
    expect(timeLeft('2026-11-06T10:12:00Z', now)).toBe('12m');
  });

  it('says expired at or after the moment, or for a bad date', () => {
    expect(timeLeft('2026-11-06T10:00:00Z', now)).toBe('expired');
    expect(timeLeft('2026-11-06T09:00:00Z', now)).toBe('expired');
    expect(timeLeft('not a date', now)).toBe('expired');
  });
});
