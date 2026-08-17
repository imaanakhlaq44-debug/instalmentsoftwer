import { DevicePolicy, Installment } from '../types/index.js';

export interface ScheduleRow {
  installmentNumber: number;
  amountDue: number;
  dueDate: string;
  graceDate: string;
}

export interface Schedule {
  /** The regular monthly amount shown to the customer. */
  baseInstallment: number;
  /** The final row, which absorbs the rounding difference. */
  finalInstallment: number;
  rows: ScheduleRow[];
}

/**
 * Builds a repayment schedule whose rows sum EXACTLY to the financed amount.
 *
 * The original code used `Math.round(financed / months)` for every row, so a
 * 50,000 loan over 6 months produced 6 × 8,333 = 49,998 and the plan could never
 * reach a clean zero balance. Here the remainder is folded into the last
 * installment, which is what every real installment contract does.
 */
export function buildInstallmentSchedule(params: {
  financedAmount: number;
  totalInstallments: number;
  firstDueDate: string;
  gracePeriodDays: number;
}): Schedule {
  const { financedAmount, totalInstallments, firstDueDate, gracePeriodDays } = params;

  if (totalInstallments < 1) {
    throw new Error('A plan must have at least one installment.');
  }

  // Work in whole rupees — paisa is not used at the counter.
  const total = Math.round(financedAmount);
  const base = Math.floor(total / totalInstallments);
  const remainder = total - base * totalInstallments;
  const finalInstallment = base + remainder;

  const firstDue = parseDateOnly(firstDueDate);
  const rows: ScheduleRow[] = [];

  for (let n = 1; n <= totalInstallments; n++) {
    const due = addMonthsPreservingEndOfMonth(firstDue, n - 1);
    const grace = new Date(due);
    grace.setDate(grace.getDate() + gracePeriodDays);

    rows.push({
      installmentNumber: n,
      amountDue: n === totalInstallments ? finalInstallment : base,
      dueDate: toDateOnly(due),
      graceDate: toDateOnly(grace),
    });
  }

  const sum = rows.reduce((s, r) => s + r.amountDue, 0);
  if (sum !== total) {
    // Guards against a future edit reintroducing the rounding drift.
    throw new Error(`Schedule does not balance: rows total ${sum} but financed amount is ${total}.`);
  }

  return { baseInstallment: base, finalInstallment, rows };
}

/**
 * Adds months without the JavaScript overflow bug: `new Date('2026-01-31')`
 * plus one month gives 3 March, not 28 February. Installments dated on the 29th,
 * 30th or 31st would silently drift into the following month.
 */
export function addMonthsPreservingEndOfMonth(start: Date, months: number): Date {
  const targetDay = start.getUTCDate();
  const result = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
  ).getUTCDate();
  result.setUTCDate(Math.min(targetDay, lastDayOfTargetMonth));
  return result;
}

export function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function toDateOnly(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function daysBetween(from: string, to: string): number {
  const ms = parseDateOnly(to).getTime() - parseDateOnly(from).getTime();
  return Math.floor(ms / 86_400_000);
}

// ---------------------------------------------------------------------------
// Late fees
// ---------------------------------------------------------------------------

export const DEFAULT_POLICY: Pick<
  DevicePolicy,
  | 'gracePeriodDays' | 'autoLockEnabled' | 'autoUnlockEnabled' | 'lockWarningDays'
  | 'customerReminderEnabled' | 'lateFeeEnabled' | 'lateFeeType' | 'lateFeeAmount'
  | 'lateFeeFrequency' | 'lateFeeMaxPerInstallment'
> = {
  gracePeriodDays: 3,
  autoLockEnabled: false,
  autoUnlockEnabled: true,
  lockWarningDays: 2,
  customerReminderEnabled: true,
  lateFeeEnabled: false,
  lateFeeType: 'FIXED',
  lateFeeAmount: 500,
  lateFeeFrequency: 'ONE_TIME',
  lateFeeMaxPerInstallment: 5000,
};

/**
 * Calculates the TOTAL late fee an installment should carry as of `asOfDate`.
 *
 * This returns the absolute figure rather than an increment, so running the job
 * twice in one day — or catching up after the server was down for a week — can
 * never double-charge a customer.
 */
export function calculateLateFee(params: {
  installment: Pick<Installment, 'amountDue' | 'amountPaid' | 'graceDate' | 'lateFeeWaivedAt'>;
  policy: Pick<DevicePolicy, 'lateFeeEnabled' | 'lateFeeType' | 'lateFeeAmount' | 'lateFeeFrequency' | 'lateFeeMaxPerInstallment'>;
  asOfDate: string;
}): number {
  const { installment, policy, asOfDate } = params;

  if (!policy.lateFeeEnabled) return 0;
  if (installment.lateFeeWaivedAt) return 0;
  if (installment.amountPaid >= installment.amountDue) return 0;

  const daysLate = daysBetween(installment.graceDate, asOfDate);
  if (daysLate <= 0) return 0;

  const rate = policy.lateFeeAmount ?? 0;
  if (rate <= 0) return 0;

  const perCharge =
    policy.lateFeeType === 'PERCENTAGE'
      ? Math.round((installment.amountDue * rate) / 100)
      : Math.round(rate);

  const gross = policy.lateFeeFrequency === 'DAILY' ? perCharge * daysLate : perCharge;

  const cap = policy.lateFeeMaxPerInstallment ?? Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(gross, cap));
}

/** The full amount required to clear one installment, penalty included. */
export function amountOutstanding(installment: Installment): number {
  const principal = Math.max(0, installment.amountDue - installment.amountPaid);
  const fees = Math.max(0, (installment.lateFee ?? 0) - (installment.lateFeePaid ?? 0));
  return principal + fees;
}
