import { describe, it, expect } from 'vitest';

import {
  buildInstallmentSchedule,
  addMonthsPreservingEndOfMonth,
  calculateLateFee,
  amountOutstanding,
  daysBetween,
} from '../../src/services/InstallmentMath.js';
import { Installment } from '../../src/types/index.js';

const policy = {
  lateFeeEnabled: true,
  lateFeeType: 'FIXED' as const,
  lateFeeAmount: 500,
  lateFeeFrequency: 'ONE_TIME' as const,
  lateFeeMaxPerInstallment: 5000,
};

describe('buildInstallmentSchedule', () => {
  it('produces rows that sum exactly to the financed amount', () => {
    const schedule = buildInstallmentSchedule({
      financedAmount: 50_000,
      totalInstallments: 6,
      firstDueDate: '2026-05-20',
      gracePeriodDays: 3,
    });

    const sum = schedule.rows.reduce((s, r) => s + r.amountDue, 0);
    expect(sum).toBe(50_000);
  });

  it('puts the rounding remainder on the final installment, not on every row', () => {
    const schedule = buildInstallmentSchedule({
      financedAmount: 50_000,
      totalInstallments: 6,
      firstDueDate: '2026-05-20',
      gracePeriodDays: 3,
    });

    expect(schedule.baseInstallment).toBe(8_333);
    expect(schedule.finalInstallment).toBe(8_335);
    expect(schedule.rows.slice(0, 5).every((r) => r.amountDue === 8_333)).toBe(true);
    expect(schedule.rows[5].amountDue).toBe(8_335);
  });

  it('handles an amount that divides cleanly', () => {
    const schedule = buildInstallmentSchedule({
      financedAmount: 60_000,
      totalInstallments: 6,
      firstDueDate: '2026-01-15',
      gracePeriodDays: 3,
    });

    expect(schedule.baseInstallment).toBe(10_000);
    expect(schedule.finalInstallment).toBe(10_000);
  });

  it('supports a single-installment plan', () => {
    const schedule = buildInstallmentSchedule({
      financedAmount: 12_345,
      totalInstallments: 1,
      firstDueDate: '2026-03-01',
      gracePeriodDays: 0,
    });

    expect(schedule.rows).toHaveLength(1);
    expect(schedule.rows[0].amountDue).toBe(12_345);
    expect(schedule.rows[0].graceDate).toBe('2026-03-01');
  });

  it('rejects a plan with no installments', () => {
    expect(() =>
      buildInstallmentSchedule({
        financedAmount: 10_000,
        totalInstallments: 0,
        firstDueDate: '2026-01-01',
        gracePeriodDays: 3,
      })
    ).toThrow(/at least one installment/i);
  });

  it('does not let a 31st due date drift into the following month', () => {
    const schedule = buildInstallmentSchedule({
      financedAmount: 120_000,
      totalInstallments: 6,
      firstDueDate: '2026-01-31',
      gracePeriodDays: 0,
    });

    expect(schedule.rows.map((r) => r.dueDate)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('adds the grace period to each due date', () => {
    const schedule = buildInstallmentSchedule({
      financedAmount: 30_000,
      totalInstallments: 3,
      firstDueDate: '2026-01-30',
      gracePeriodDays: 3,
    });

    expect(schedule.rows[0].graceDate).toBe('2026-02-02');
    expect(schedule.rows[1].graceDate).toBe('2026-03-03'); // 28 Feb + 3
  });
});

describe('addMonthsPreservingEndOfMonth', () => {
  it('clamps 31 January + 1 month to 28 February in a non-leap year', () => {
    const result = addMonthsPreservingEndOfMonth(new Date(Date.UTC(2026, 0, 31)), 1);
    expect(result.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('clamps to 29 February in a leap year', () => {
    const result = addMonthsPreservingEndOfMonth(new Date(Date.UTC(2028, 0, 31)), 1);
    expect(result.toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('rolls across a year boundary', () => {
    const result = addMonthsPreservingEndOfMonth(new Date(Date.UTC(2026, 10, 15)), 3);
    expect(result.toISOString().slice(0, 10)).toBe('2027-02-15');
  });
});

describe('daysBetween', () => {
  it('counts whole days forward', () => {
    expect(daysBetween('2026-08-01', '2026-08-11')).toBe(10);
  });

  it('is negative before the from date', () => {
    expect(daysBetween('2026-08-11', '2026-08-01')).toBe(-10);
  });
});

describe('calculateLateFee', () => {
  const unpaid = { amountDue: 10_000, amountPaid: 0, graceDate: '2026-08-01', lateFeeWaivedAt: undefined };

  it('charges nothing before the grace date has passed', () => {
    expect(calculateLateFee({ installment: unpaid, policy, asOfDate: '2026-08-01' })).toBe(0);
    expect(calculateLateFee({ installment: unpaid, policy, asOfDate: '2026-07-25' })).toBe(0);
  });

  it('charges a one-time fixed fee once, however late the payment is', () => {
    expect(calculateLateFee({ installment: unpaid, policy, asOfDate: '2026-08-02' })).toBe(500);
    expect(calculateLateFee({ installment: unpaid, policy, asOfDate: '2026-09-30' })).toBe(500);
  });

  it('returns an absolute total, so re-running the job cannot double-charge', () => {
    const first = calculateLateFee({ installment: unpaid, policy, asOfDate: '2026-08-10' });
    const second = calculateLateFee({ installment: unpaid, policy, asOfDate: '2026-08-10' });
    expect(second).toBe(first);
  });

  it('accrues a daily fee per day late', () => {
    const fee = calculateLateFee({
      installment: unpaid,
      policy: { ...policy, lateFeeFrequency: 'DAILY', lateFeeAmount: 100 },
      asOfDate: '2026-08-08',
    });
    expect(fee).toBe(700);
  });

  it('never exceeds the per-installment cap', () => {
    const fee = calculateLateFee({
      installment: unpaid,
      policy: { ...policy, lateFeeFrequency: 'DAILY', lateFeeAmount: 100, lateFeeMaxPerInstallment: 1_000 },
      asOfDate: '2026-12-31',
    });
    expect(fee).toBe(1_000);
  });

  it('charges a percentage of the installment', () => {
    const fee = calculateLateFee({
      installment: unpaid,
      policy: { ...policy, lateFeeType: 'PERCENTAGE', lateFeeAmount: 2 },
      asOfDate: '2026-08-05',
    });
    expect(fee).toBe(200);
  });

  it('charges nothing when late fees are disabled', () => {
    expect(
      calculateLateFee({ installment: unpaid, policy: { ...policy, lateFeeEnabled: false }, asOfDate: '2026-09-01' })
    ).toBe(0);
  });

  it('charges nothing once the fee has been waived', () => {
    expect(
      calculateLateFee({
        installment: { ...unpaid, lateFeeWaivedAt: '2026-08-03T00:00:00.000Z' },
        policy,
        asOfDate: '2026-09-01',
      })
    ).toBe(0);
  });

  it('charges nothing on an installment that is already settled', () => {
    expect(
      calculateLateFee({ installment: { ...unpaid, amountPaid: 10_000 }, policy, asOfDate: '2026-09-01' })
    ).toBe(0);
  });
});

describe('amountOutstanding', () => {
  const base = {
    id: 'i1', planId: 'p1', dealerId: 'd1', customerId: 'c1',
    installmentNumber: 1, dueDate: '2026-08-01', graceDate: '2026-08-04',
    status: 'PENDING', createdAt: '2026-07-01T00:00:00.000Z',
  } as unknown as Installment;

  it('adds unpaid principal and unpaid late fee', () => {
    expect(amountOutstanding({ ...base, amountDue: 10_000, amountPaid: 4_000, lateFee: 500, lateFeePaid: 0 }))
      .toBe(6_500);
  });

  it('never goes negative on an overpaid installment', () => {
    expect(amountOutstanding({ ...base, amountDue: 10_000, amountPaid: 12_000, lateFee: 500, lateFeePaid: 900 }))
      .toBe(0);
  });

  it('treats missing late-fee fields as zero', () => {
    expect(amountOutstanding({ ...base, amountDue: 10_000, amountPaid: 0 })).toBe(10_000);
  });
});
