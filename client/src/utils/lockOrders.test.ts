import { describe, it, expect } from 'vitest';
import { validateLockOrder, methodLabel, ORDER_PAYMENT_METHODS } from './lockOrders.js';

const ok = { size: 30, paymentMethod: 'JAZZCASH', transactionId: 'JC-778812345', amountPaid: 24_000 };

describe('lock order form checks', () => {
  it('accepts a complete order', () => {
    expect(validateLockOrder(ok)).toBeNull();
    expect(validateLockOrder({ ...ok, size: 1, amountPaid: 1000 })).toBeNull();
  });

  it('refuses a pack size the server would refuse', () => {
    expect(validateLockOrder({ ...ok, size: 0 })).toMatch(/between 1 and 500/);
    expect(validateLockOrder({ ...ok, size: 501 })).toMatch(/between 1 and 500/);
    expect(validateLockOrder({ ...ok, size: Number.NaN })).toMatch(/between 1 and 500/);
  });

  it('needs a real-looking transaction ID', () => {
    expect(validateLockOrder({ ...ok, transactionId: ' ab ' })).toMatch(/transaction ID/);
    expect(validateLockOrder({ ...ok, transactionId: '<b>123456</b>' })).toMatch(/letters and numbers/);
    expect(validateLockOrder({ ...ok, transactionId: 'x'.repeat(61) })).toMatch(/letters and numbers/);
  });

  it('needs the amount in whole rupees', () => {
    expect(validateLockOrder({ ...ok, amountPaid: '' })).toMatch(/amount/);
    expect(validateLockOrder({ ...ok, amountPaid: 0 })).toMatch(/amount/);
    expect(validateLockOrder({ ...ok, amountPaid: 2400.5 })).toMatch(/amount/);
  });

  it('does not offer cash, and names each method', () => {
    expect(ORDER_PAYMENT_METHODS.map((m) => m.value)).not.toContain('CASH');
    expect(validateLockOrder({ ...ok, paymentMethod: 'CASH' })).toMatch(/how you paid/);
    expect(methodLabel('BANK_TRANSFER')).toBe('Bank transfer');
    expect(methodLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
