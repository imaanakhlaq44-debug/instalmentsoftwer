/**
 * A preview of the schedule the server will build when a plan is restructured.
 *
 * Mirrors server/src/services/InstallmentMath.ts `buildInstallmentSchedule`:
 * whole rupees, the rounding remainder folded into the last row, and due dates
 * that keep the day of month without spilling into the next month. The server
 * is still the one that writes the rows; this only shows the owner what they
 * are about to agree to.
 */
export interface PreviewRow {
  installmentNumber: number;
  amountDue: number;
  dueDate: string;
  graceDate: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toDateOnly = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function addMonths(start: Date, months: number): Date {
  const day = start.getUTCDate();
  const result = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result;
}

export function previewSchedule(params: {
  outstanding: number;
  months: number;
  firstDueDate: string;
  graceDays: number;
  /** Rows already paid, which keep their numbers; the new ones follow them. */
  startAfter?: number;
}): PreviewRow[] {
  const { outstanding, months, firstDueDate, graceDays, startAfter = 0 } = params;
  if (!Number.isInteger(months) || months < 1 || months > 60) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate) || outstanding <= 0) return [];

  const [y, m, d] = firstDueDate.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, d));
  const total = Math.round(outstanding);
  const base = Math.floor(total / months);
  const last = base + (total - base * months);

  return Array.from({ length: months }, (_, i) => {
    const due = addMonths(first, i);
    const grace = new Date(due);
    grace.setUTCDate(grace.getUTCDate() + graceDays);
    return {
      installmentNumber: startAfter + i + 1,
      amountDue: i === months - 1 ? last : base,
      dueDate: toDateOnly(due),
      graceDate: toDateOnly(grace),
    };
  });
}
