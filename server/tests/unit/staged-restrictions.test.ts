import { describe, it, expect } from 'vitest';

import { levelForOverdue, overdueCount, stagedFullLockDue } from '../../src/services/StagedRestrictions.js';
import { renderClauses, termsDiscloseStagedRestrictions, ContractSnapshot } from '../../src/services/contractTerms.js';

type Inst = { status: string; installmentNumber: number };
const plan = (statuses: string[]): Inst[] => statuses.map((status, i) => ({ status, installmentNumber: i + 1 }));

describe('staged restriction levels', () => {
  it('maps missed installments to a level', () => {
    expect(levelForOverdue(0)).toBe(0);
    expect(levelForOverdue(1)).toBe(1);
    expect(levelForOverdue(2)).toBe(2);
    expect(levelForOverdue(5)).toBe(2);
  });

  it('counts only installments past grace', () => {
    expect(overdueCount(plan(['PAID', 'OVERDUE', 'DUE_TODAY', 'PENDING']) as never)).toBe(1);
  });

  it('locks fully at the third missed installment', () => {
    expect(stagedFullLockDue(plan(['OVERDUE', 'OVERDUE', 'PENDING', 'PENDING', 'PENDING', 'PENDING']) as never)).toBe(false);
    expect(stagedFullLockDue(plan(['OVERDUE', 'OVERDUE', 'OVERDUE', 'PENDING', 'PENDING', 'PENDING']) as never)).toBe(true);
  });

  it('locks fully when the final installment is missed, however short the plan', () => {
    expect(stagedFullLockDue(plan(['PAID', 'OVERDUE']) as never)).toBe(true);
    expect(stagedFullLockDue(plan(['OVERDUE', 'PENDING']) as never)).toBe(false);
  });
});

describe('the contract describes the stages', () => {
  const snapshot = {
    dealer: { name: 'Al Madina Mobiles', code: 'AMM', phone: '0300-1234567', address: 'Blue Area', city: 'Islamabad' },
    customer: { name: 'Buyer', cnic: '35201-1234567-3', phone: '0300-7654321', address: 'Lahore' },
    device: { brand: 'Infinix', model: 'Hot 40', imei: '356938035643809' },
    plan: { totalAmount: 60000, downPayment: 12000, financedAmount: 48000, monthlyInstallment: 8000, totalInstallments: 6, firstDueDate: '2026-12-05', gracePeriodDays: 3 },
    lateFee: { enabled: false, type: 'FIXED', amount: 0, frequency: 'ONE_TIME' },
    offlineLock: { enabled: true, afterDays: 3 },
    stagedRestrictions: { enabled: true },
    schedule: [],
    preparedAt: '2026-11-06',
  } as ContractSnapshot;

  const clause4 = (version: string, s = snapshot) => renderClauses(s, version).find((c) => c.heading.startsWith('4.'))!;

  it('is disclosed from terms v1.2', () => {
    expect(termsDiscloseStagedRestrictions('1.1')).toBe(false);
    expect(termsDiscloseStagedRestrictions('1.2')).toBe(true);
    expect(termsDiscloseStagedRestrictions('2.0')).toBe(true);
  });

  it('prints each stage in both languages under v1.2', () => {
    const c = clause4('1.2');
    expect(c.body).toMatch(/outgoing calls or send SMS/);
    expect(c.body).toMatch(/WhatsApp, Facebook, TikTok and YouTube/);
    expect(c.body).toMatch(/emergency calls keep working/);
    expect(c.bodyUr).toMatch(/مرحلہ وار/);
    // The offline rule from v1.1 is still there.
    expect(c.body).toMatch(/3 days in a row/);
  });

  it('says nothing about stages under v1.1, or when they were off at signing', () => {
    expect(clause4('1.1').body).not.toMatch(/in stages/);
    expect(clause4('1.2', { ...snapshot, stagedRestrictions: { enabled: false } }).body).not.toMatch(/in stages/);
  });
});
