import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';

/** PATCH /api/lock-orders/:id — a shop owner corrects an order that is still waiting. */
beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

const transfer = { size: 30, paymentMethod: 'JAZZCASH', transactionId: 'JC-778812345', amountPaid: 21_000 };
const screenshot = 'data:image/png;base64,iVBORw0KGgo=';

async function placeOrder(overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await as(ACCOUNTS.dealerAdmin).post('/api/lock-orders').send({ ...transfer, ...overrides });
  expect(res.status).toBe(201);
  return res.body.order.id as string;
}

describe('a shop owner changes a pending order', () => {
  it('changes the number of locks and prices it again from the price list', async () => {
    const id = await placeOrder();
    const res = await as(ACCOUNTS.dealerAdmin).patch(`/api/lock-orders/${id}`).send({ size: 5, amountPaid: 4_000 });
    expect(res.status).toBe(200);
    expect(res.body.order).toMatchObject({ status: 'PENDING', size: 5, unitPrice: 800, totalPrice: 4_000, amountPaid: 4_000 });

    const approved = await as(ACCOUNTS.superAdmin).post(`/api/lock-orders/${id}/approve`);
    expect(approved.body.licenses).toBe(5);
    expect(approved.body.pack).toMatchObject({ size: 5, totalPrice: 4_000 });
  });

  it('changes the transaction ID and screenshot, and records the change in the audit log', async () => {
    const id = await placeOrder();
    const res = await as(ACCOUNTS.dealerAdmin).patch(`/api/lock-orders/${id}`).send({ transactionId: 'JC-000111222', proofImage: screenshot });
    expect(res.status).toBe(200);
    expect(res.body.order).toMatchObject({ transactionId: 'JC-000111222', hasProof: true });
    expect(res.body.order.proofImage).toBeUndefined();
    expect((await as(ACCOUNTS.dealerAdmin).get(`/api/lock-orders/${id}/proof`)).body.proofImage).toBe(screenshot);

    const log = await repo.auditLogs.findFirst({ targetId: id, action: 'LOCK_ORDER_AMENDED' });
    expect(log?.details).toContain('JC-778812345 -> JC-000111222');
    expect(log?.details).toContain('screenshot');

    // The old ID is free again; the new one is taken.
    expect((await as(ACCOUNTS.otherDealerAdmin).post('/api/lock-orders').send(transfer)).status).toBe(201);
    expect((await as(ACCOUNTS.otherDealerAdmin).post('/api/lock-orders').send({ ...transfer, transactionId: 'JC-000111222' })).status).toBe(409);
  });

  it('refuses a transaction ID another order already uses', async () => {
    await placeOrder({ transactionId: 'JC-TAKEN-001' });
    const id = await placeOrder();
    const res = await as(ACCOUNTS.dealerAdmin).patch(`/api/lock-orders/${id}`).send({ transactionId: 'jc-taken-001' });
    expect(res.status).toBe(409);
    expect((await repo.lockOrders.findById(id))?.transactionId).toBe('JC-778812345');
  });

  it('keeps the order rules: no bad size, no empty change', async () => {
    const id = await placeOrder();
    expect((await as(ACCOUNTS.dealerAdmin).patch(`/api/lock-orders/${id}`).send({ size: 0 })).status).toBe(422);
    expect((await as(ACCOUNTS.dealerAdmin).patch(`/api/lock-orders/${id}`).send({})).status).toBe(422);
    expect((await as(ACCOUNTS.dealerAdmin).patch(`/api/lock-orders/${id}`).send({ proofImage: 'not-an-image' })).status).toBe(422);
  });

  it('cannot change an order once it is approved, rejected or cancelled', async () => {
    const approved = await placeOrder({ transactionId: 'JC-APPROVED-1' });
    await as(ACCOUNTS.superAdmin).post(`/api/lock-orders/${approved}/approve`);
    const cancelled = await placeOrder({ transactionId: 'JC-CANCEL-1' });
    await as(ACCOUNTS.dealerAdmin).post(`/api/lock-orders/${cancelled}/cancel`);

    for (const id of [approved, cancelled]) {
      const res = await as(ACCOUNTS.dealerAdmin).patch(`/api/lock-orders/${id}`).send({ size: 100 });
      expect(res.status).toBe(409);
    }
    expect((await repo.lockOrders.findById(approved))?.size).toBe(30);
  });

  it('is the shop owner\'s alone, for their own shop', async () => {
    const id = await placeOrder();
    expect((await as(ACCOUNTS.otherDealerAdmin).patch(`/api/lock-orders/${id}`).send({ size: 5 })).status).toBe(404);
    expect((await as(ACCOUNTS.dealerStaff).patch(`/api/lock-orders/${id}`).send({ size: 5 })).status).toBe(403);
    expect((await as(ACCOUNTS.superAdmin).patch(`/api/lock-orders/${id}`).send({ size: 5 })).status).toBe(403);
    expect((await repo.lockOrders.findById(id))?.size).toBe(30);
  });
});
