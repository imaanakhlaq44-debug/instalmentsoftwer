import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

describe('customer profile totalPaid', () => {
  it('drops a payment once it is reversed', async () => {
    const plan = (await repo.installmentPlans.findFirst({ customerId: 'cust-1' }))!;
    const profile = () => as(ACCOUNTS.dealerAdmin).get('/api/customers/cust-1');

    const before = (await profile()).body.summary.totalPaid as number;

    const paid = await as(ACCOUNTS.dealerStaff).post('/api/payments').send({
      customerId: 'cust-1',
      planId: plan.id,
      amount: 1234,
      paymentMethod: 'CASH',
      referenceNumber: 'TOTALPAID-REV',
    });
    expect(paid.status).toBeLessThan(300);
    const paymentId = paid.body.payment?.id ?? paid.body.data?.payment?.id;
    expect(paymentId).toBeTruthy();

    expect((await profile()).body.summary.totalPaid).toBe(before + 1234);

    const rev = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/payments/${paymentId}/reverse`)
      .send({ reason: 'Cheque bounced at the bank.' });
    expect(rev.status).toBeLessThan(300);

    expect((await profile()).body.summary.totalPaid).toBe(before);
  });
});
