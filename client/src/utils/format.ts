/**
 * Formatting the whole interface agrees on.
 *
 * Money is the reason this file exists. Rupee amounts were being written six
 * different ways across the app — `Rs. 1,284,500`, `PKR 1284500`, bare numbers —
 * and a shop owner comparing two screens could not tell whether they were
 * looking at the same figure. There is now one function, and it is `en-PK`, so
 * the grouping and the symbol are the ones a Pakistani reader expects.
 */

const PKR = new Intl.NumberFormat('en-PK', {
  style: 'currency',
  currency: 'PKR',
  maximumFractionDigits: 0,
});

const PKR_PRECISE = new Intl.NumberFormat('en-PK', {
  style: 'currency',
  currency: 'PKR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `Rs 495,808` — the default everywhere a rupee amount is shown. */
export const money = (value: number | string | null | undefined): string =>
  PKR.format(Number(value) || 0);

/** `Rs 6,250.00` — only where paisa genuinely matter (receipts, ledger rows). */
export const moneyExact = (value: number | string | null | undefined): string =>
  PKR_PRECISE.format(Number(value) || 0);

/**
 * `4.96 lakh` — for figures that only need their magnitude read, such as an
 * axis tick. Lakh and crore are how these amounts are actually spoken in a
 * Pakistani shop; 495808 on an axis is noise.
 */
export const moneyShort = (value: number | null | undefined): string => {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 10_000_000) return `${oneDecimal(n / 10_000_000)} cr`;
  if (abs >= 100_000) return `${oneDecimal(n / 100_000)} lakh`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
};

/** `1.5`, but `5` rather than `5.0` — a trailing zero is noise on an axis. */
const oneDecimal = (n: number): string => {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const DATE = new Intl.DateTimeFormat('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
const DATE_LONG = new Intl.DateTimeFormat('en-PK', { weekday: 'long', day: 'numeric', month: 'long' });

/** `20 Jun 2026` */
export const shortDate = (iso: string | Date | null | undefined): string =>
  iso ? DATE.format(new Date(iso)) : '—';

/** `Wednesday, 19 August` — the dashboard's dateline. */
export const longDate = (date: Date = new Date()): string => DATE_LONG.format(date);

/** `88 days overdue` / `due today` / `due in 4 days`, from a day count. */
export const overdueLabel = (days: number): string => {
  if (days > 1) return `${days} days late`;
  if (days === 1) return '1 day late';
  if (days === 0) return 'due today';
  return `due in ${Math.abs(days)} days`;
};

/** Greeting keyed to the shop's own clock, not the server's. */
export const greeting = (date: Date = new Date()): string => {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

/** First name only — a dashboard greets you the way a person would. */
export const firstName = (fullName: string | null | undefined): string =>
  (fullName ?? '').trim().split(/\s+/)[0] || 'there';
