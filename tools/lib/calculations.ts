import type { CurrencyCode } from './site-data';

export type ProrationMethod = 'exact' | 'thirty' | 'annual';

export function parseUTCDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function monthEndISO(value: string): string {
  const date = parseUTCDate(value);
  if (!date) return '';
  return toISODate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

export function calculateProration(monthlyRent: number, moveIn: string, moveOut: string, method: ProrationMethod) {
  const start = parseUTCDate(moveIn);
  const end = parseUTCDate(moveOut);
  if (!start || !end || end < start || !Number.isFinite(monthlyRent) || monthlyRent < 0) {
    return { days: 0, dailyRate: 0, total: 0 };
  }

  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  let total = 0;
  if (method === 'exact') {
    for (let offset = 0; offset < days; offset += 1) {
      const day = new Date(start.getTime() + offset * 86_400_000);
      const daysInMonth = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
      total += monthlyRent / daysInMonth;
    }
  } else {
    const daily = method === 'thirty' ? monthlyRent / 30 : (monthlyRent * 12) / 365;
    total = daily * days;
  }
  return { days, dailyRate: total / days, total };
}

export function formatMoney(value: number, currency: CurrencyCode, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat(currency === 'GBP' ? 'en-GB' : 'en-US', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatWholeMoney(value: number, currency: CurrencyCode): string {
  return new Intl.NumberFormat(currency === 'GBP' ? 'en-GB' : 'en-US', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}
