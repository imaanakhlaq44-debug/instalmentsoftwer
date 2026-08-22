import { describe, it, expect, vi } from 'vitest';
import { money, moneyExact, moneyShort, overdueLabel, greeting, firstName, relativeTime } from './format.js';

/**
 * Intl separates the symbol from the figure with a non-breaking space, which is
 * what we want on screen — "Rs" must never be left dangling at the end of a
 * line. The expectations spell the character out rather than quietly passing on
 * something nobody can see in a diff.
 */
const RS = 'Rs ';

describe('money', () => {
  it('formats rupees the way a Pakistani reader expects', () => {
    expect(money(495808)).toBe(`${RS}495,808`);
  });

  it('rounds away paisa, because a dashboard figure is not a receipt', () => {
    expect(money(6749.6)).toBe(`${RS}6,750`);
  });

  it('treats a missing amount as zero rather than printing NaN', () => {
    expect(money(null)).toBe(`${RS}0`);
    expect(money(undefined)).toBe(`${RS}0`);
    expect(money('' as unknown as number)).toBe(`${RS}0`);
  });

  it('keeps paisa where they are the point', () => {
    expect(moneyExact(6250.5)).toBe(`${RS}6,250.50`);
  });
});

describe('moneyShort', () => {
  it('speaks in lakh and crore, as the shop does', () => {
    expect(moneyShort(495808)).toBe('5 lakh');
    expect(moneyShort(150000)).toBe('1.5 lakh');
    expect(moneyShort(12_500_000)).toBe('1.3 cr');
  });

  it('drops to thousands below a lakh', () => {
    expect(moneyShort(113938)).toBe('1.1 lakh');
    expect(moneyShort(6750)).toBe('7k');
  });

  it('leaves small amounts alone', () => {
    expect(moneyShort(0)).toBe('0');
    expect(moneyShort(940)).toBe('940');
  });
});

describe('overdueLabel', () => {
  it('reads as a sentence, not a number', () => {
    expect(overdueLabel(88)).toBe('88 days late');
    expect(overdueLabel(1)).toBe('1 day late');
    expect(overdueLabel(0)).toBe('due today');
    expect(overdueLabel(-4)).toBe('due in 4 days');
  });
});

describe('greeting', () => {
  it('follows the shop clock', () => {
    expect(greeting(new Date('2026-08-19T08:00:00'))).toBe('Good morning');
    expect(greeting(new Date('2026-08-19T13:00:00'))).toBe('Good afternoon');
    expect(greeting(new Date('2026-08-19T20:00:00'))).toBe('Good evening');
  });
});

describe('firstName', () => {
  it('takes the first word', () => {
    expect(firstName('Tariq Mehmood (Admin)')).toBe('Tariq');
  });

  it('falls back to something addressable when the name is missing', () => {
    expect(firstName(null)).toBe('there');
    expect(firstName('   ')).toBe('there');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-08-21T12:00:00Z').getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('says how long ago, in the largest unit that still reads naturally', () => {
    vi.setSystemTime(now);

    expect(relativeTime(ago(30_000))).toBe('Just now');
    expect(relativeTime(ago(15 * 60_000))).toBe('15 minutes ago');
    expect(relativeTime(ago(3 * 3_600_000))).toBe('3 hours ago');
    expect(relativeTime(ago(1 * 3_600_000))).toBe('1 hour ago');
    expect(relativeTime(ago(4 * 86_400_000))).toBe('4 days ago');
    expect(relativeTime(ago(86_400_000))).toBe('1 day ago');

    vi.useRealTimers();
  });

  it('says Never rather than inventing a time for a handset that has not reported', () => {
    // This number is what the offline rule counts. A blank or a guess here
    // would contradict what the phone is actually doing.
    expect(relativeTime(null)).toBe('Never');
    expect(relativeTime(undefined)).toBe('Never');
    expect(relativeTime('not a date')).toBe('Never');
  });
});
