import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

/** The seeded customer behind the CUSTOMER login, and their financing plan. */
async function customerPlan() {
  const plan = (await repo.installmentPlans.findFirst({ customerId: 'cust-1' }))!;
  return { customerId: 'cust-1', planId: plan.id, plan };
}

function submission(planId: string, overrides: Record<string, unknown> = {}) {
  return {
    planId,
    amount: 5000,
    paymentMethod: 'JAZZCASH',
    referenceNumber: `TID${Date.now().toString().slice(-9)}`,
    notes: 'Sent from my JazzCash account.',
    ...overrides,
  };
}

describe('a customer reports a transfer', () => {
  it('records it as unverified, not as money received', async () => {
    const { planId } = await customerPlan();

    const res = await as(ACCOUNTS.customer).post('/api/payments/submit').send(submission(planId));

    expect(res.status).toBe(201);
    const stored = (await repo.payments.findById(res.body.payment.id))!;
    expect(stored.status).toBe('PENDING');
    expect(stored.source).toBe('CUSTOMER');
    expect(stored.verifiedAt).toBeUndefined();
    // No receipt number: nothing has been receipted, because nothing has been
    // confirmed.
    expect(stored.receiptNumber).toBeUndefined();
  });

  it('does not touch the balance until somebody verifies it', async () => {
    const { planId, plan } = await customerPlan();

    await as(ACCOUNTS.customer).post('/api/payments/submit').send(submission(planId));

    const after = (await repo.installmentPlans.findById(planId))!;
    expect(after.remainingBalance).toBe(plan.remainingBalance);
  });

  it('applies the money once the shop verifies it', async () => {
    const { planId, plan } = await customerPlan();

    const submitted = await as(ACCOUNTS.customer).post('/api/payments/submit').send(submission(planId));
    const verify = await as(ACCOUNTS.dealerAdmin).post(`/api/payments/${submitted.body.payment.id}/verify`).send({});

    expect(verify.status).toBe(200);
    const stored = (await repo.payments.findById(submitted.body.payment.id))!;
    expect(stored.status).toBe('VERIFIED');
    expect(stored.receiptNumber).toBeTruthy();

    const after = (await repo.installmentPlans.findById(planId))!;
    expect(after.remainingBalance).toBeLessThan(plan.remainingBalance);
  });

  it('keeps the screenshot with the claim', async () => {
    const { planId } = await customerPlan();
    const proof = 'data:image/jpeg;base64,' + 'A'.repeat(200);

    const res = await as(ACCOUNTS.customer)
      .post('/api/payments/submit')
      .send(submission(planId, { proofImage: proof }));

    expect(res.status).toBe(201);
    expect((await repo.payments.findById(res.body.payment.id))!.proofImage).toBe(proof);
  });

  it('refuses a screenshot larger than the app would ever send', async () => {
    const { planId } = await customerPlan();

    const res = await as(ACCOUNTS.customer)
      .post('/api/payments/submit')
      .send(submission(planId, { proofImage: 'data:image/jpeg;base64,' + 'A'.repeat(190_000) }));

    expect(res.status).toBe(422);
  });

  it('rejects an oversized body rather than reporting a server fault', async () => {
    // Past the request body limit express.json throws before any route runs.
    // That is a rejection the caller can act on, not an internal error.
    const { planId } = await customerPlan();

    const res = await as(ACCOUNTS.customer)
      .post('/api/payments/submit')
      .send(submission(planId, { proofImage: 'data:image/jpeg;base64,' + 'A'.repeat(400_000) }));

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('will not take a cash payment from a customer at home', async () => {
    // Cash changes hands at a counter. There is nothing to report from home and
    // nothing anybody could check.
    const { planId } = await customerPlan();

    const res = await as(ACCOUNTS.customer)
      .post('/api/payments/submit')
      .send(submission(planId, { paymentMethod: 'CASH' }));

    expect(res.status).toBe(422);
  });

  it('requires the transaction reference', async () => {
    const { planId } = await customerPlan();

    const res = await as(ACCOUNTS.customer)
      .post('/api/payments/submit')
      .send(submission(planId, { referenceNumber: '' }));

    expect(res.status).toBe(422);
  });

  it('rejects a reference already used at that dealership', async () => {
    const { planId } = await customerPlan();
    const body = submission(planId);

    await as(ACCOUNTS.customer).post('/api/payments/submit').send(body);
    const second = await as(ACCOUNTS.customer).post('/api/payments/submit').send(body);

    expect(second.status).toBe(409);
  });

  it('stops a customer from filling the queue with unchecked claims', async () => {
    const { planId } = await customerPlan();

    for (let i = 0; i < 5; i += 1) {
      const res = await as(ACCOUNTS.customer)
        .post('/api/payments/submit')
        .send(submission(planId, { referenceNumber: `TID-QUEUE-${i}` }));
      expect(res.status).toBe(201);
    }

    const sixth = await as(ACCOUNTS.customer)
      .post('/api/payments/submit')
      .send(submission(planId, { referenceNumber: 'TID-QUEUE-6' }));

    expect(sixth.status).toBe(400);
    expect(sixth.body.error).toMatch(/waiting to be checked/i);
  });
});

describe('a customer cannot pay on somebody else\'s behalf', () => {
  it('ignores a customer id in the body and uses the session', async () => {
    const { planId } = await customerPlan();

    const res = await as(ACCOUNTS.customer)
      .post('/api/payments/submit')
      .send(submission(planId, { customerId: 'cust-2' }));

    expect(res.status).toBe(201);
    // The session's customer, not the one they asked for.
    expect((await repo.payments.findById(res.body.payment.id))!.customerId).toBe('cust-1');
  });

  it('refuses a plan that belongs to another customer', async () => {
    const otherPlan = (await repo.installmentPlans.findFirst({ customerId: 'cust-2' }))!;

    const res = await as(ACCOUNTS.customer).post('/api/payments/submit').send(submission(otherPlan.id));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not belong/i);
  });
});

describe('the verification queue', () => {
  it('shows staff what customers claim to have paid', async () => {
    const { planId } = await customerPlan();
    await as(ACCOUNTS.customer).post('/api/payments/submit').send(submission(planId));

    const res = await as(ACCOUNTS.dealerStaff).get('/api/payments/pending-submissions');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].customerName).toBeTruthy();
    expect(res.body.data[0].source).toBe('CUSTOMER');
  });

  it('leaves counter payments out of it', async () => {
    // Payments staff took at the counter are already verified and are not
    // waiting on anybody.
    const { customerId, planId } = await customerPlan();

    await as(ACCOUNTS.dealerStaff).post('/api/payments').send({
      customerId,
      planId,
      amount: 3000,
      paymentMethod: 'CASH',
    });

    const res = await as(ACCOUNTS.dealerStaff).get('/api/payments/pending-submissions');
    expect(res.body.count).toBe(0);
  });

  it('never shows one dealership another\'s queue', async () => {
    const { planId } = await customerPlan();
    await as(ACCOUNTS.customer).post('/api/payments/submit').send(submission(planId));

    const res = await as(ACCOUNTS.otherDealerAdmin).get('/api/payments/pending-submissions');
    expect(res.body.count).toBe(0);
  });

  it('is not open to a customer login', async () => {
    const res = await as(ACCOUNTS.customer).get('/api/payments/pending-submissions');
    expect(res.status).toBe(403);
  });

  it('empties as the shop works through it', async () => {
    const { planId } = await customerPlan();
    const submitted = await as(ACCOUNTS.customer).post('/api/payments/submit').send(submission(planId));

    await as(ACCOUNTS.dealerAdmin).post(`/api/payments/${submitted.body.payment.id}/verify`).send({});

    const res = await as(ACCOUNTS.dealerStaff).get('/api/payments/pending-submissions');
    expect(res.body.count).toBe(0);
  });
});
