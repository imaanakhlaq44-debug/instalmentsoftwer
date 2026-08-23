import { describe, it, expect } from 'vitest';
import { toChaseList, type OverdueRow } from './CollectionQueue.js';

const row = (over: Partial<OverdueRow>): OverdueRow => ({
  installmentId: 'inst-1',
  customerId: 'cust-1',
  customerName: 'Kashif Mehmood',
  customerPhone: '0345-1239874',
  deviceId: 'dev-1',
  deviceName: 'Vivo Y27 5G',
  deviceStatus: 'PENDING',
  amountOutstanding: 6250,
  daysOverdue: 30,
  ...over,
});

describe('toChaseList', () => {
  it('collapses a customer’s instalments into one phone call', () => {
    const list = toChaseList([
      row({ installmentId: 'a', amountOutstanding: 6250, daysOverdue: 88 }),
      row({ installmentId: 'b', amountOutstanding: 6250, daysOverdue: 57 }),
    ]);

    expect(list).toHaveLength(1);
    expect(list[0].total).toBe(12500);
    expect(list[0].count).toBe(2);
  });

  it('carries the worst arrears on the row', () => {
    const list = toChaseList([
      row({ installmentId: 'a', daysOverdue: 57 }),
      row({ installmentId: 'b', daysOverdue: 88 }),
    ]);

    expect(list[0].worstDays).toBe(88);
  });

  it('shows the locked handset when a customer has more than one in trouble', () => {
    const list = toChaseList([
      row({ installmentId: 'a', deviceName: 'Vivo Y27 5G', deviceStatus: 'OVERDUE' }),
      row({ installmentId: 'b', deviceName: 'Infinix Note 30', deviceStatus: 'LOCKED' }),
    ]);

    expect(list[0].deviceName).toBe('Infinix Note 30');
    expect(list[0].deviceStatus).toBe('LOCKED');
  });

  it('puts the longest overdue customer at the top, then the largest debt', () => {
    const list = toChaseList([
      row({ customerId: 'c1', customerName: 'A', daysOverdue: 10, amountOutstanding: 1000 }),
      row({ customerId: 'c2', customerName: 'B', daysOverdue: 88, amountOutstanding: 500 }),
      row({ customerId: 'c3', customerName: 'C', daysOverdue: 10, amountOutstanding: 9000 }),
    ]);

    expect(list.map((c) => c.customerName)).toEqual(['B', 'C', 'A']);
  });

  it('returns nothing when nobody is behind', () => {
    expect(toChaseList([])).toEqual([]);
  });
});
