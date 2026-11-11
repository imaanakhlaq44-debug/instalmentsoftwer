import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

const transfer = {
  size: 30,
  paymentMethod: 'JAZZCASH',
  transactionId: 'JC-778812345',
  amountPaid: 24_000,
};

const availableFor = (dealerId: string) => repo.deviceLicenses.countAvailable(dealerId);
const packsFor = (dealerId: string) => repo.licensePacks.count({ dealerId });
const auditFor = (targetId: string, action: string) => repo.auditLogs.count({ targetId, action });

/** dealer-1's owner places an order and the test gets its id back. */
async function placeOrder(overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await as(ACCOUNTS.dealerAdmin).post('/api/lock-orders').send({ ...transfer, ...overrides });
  expect(res.status).toBe(201);
  return res.body.order.id as string;
}

describe('a shop orders locks', () => {
  it('records the order at the price list, pending, and issues nothing', async () => {
    const before = await availableFor('dealer-1');
    const packsBefore = await packsFor('dealer-1');

    const res = await as(ACCOUNTS.dealerAdmin).post('/api/lock-orders').send(transfer);

    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({
      dealerId: 'dealer-1',
      size: 30,
      unitPrice: 800,
      totalPrice: 24_000,
      status: 'PENDING',
      paymentMethod: 'JAZZCASH',
      transactionId: 'JC-778812345',
      amountPaid: 24_000,
      hasProof: false,
    });
    expect(await availableFor('dealer-1')).toBe(before);
    expect(await packsFor('dealer-1')).toBe(packsBefore);
    expect(await auditFor(res.body.order.id, 'LOCK_ORDER_SUBMITTED')).toBe(1);
  });

  it('prices every tier as the price list says', async () => {
    // Split across two shops: one shop may only have three undecided orders.
    const cases: [string, number, number][] = [
      [ACCOUNTS.dealerAdmin, 1, 1_000],
      [ACCOUNTS.dealerAdmin, 29, 29_000],
      [ACCOUNTS.dealerAdmin, 30, 24_000],
      [ACCOUNTS.otherDealerAdmin, 50, 35_000],
      [ACCOUNTS.otherDealerAdmin, 100, 60_000],
    ];
    for (const [account, size, total] of cases) {
      const res = await as(account)
        .post('/api/lock-orders')
        .send({ ...transfer, size, amountPaid: total, transactionId: `TID-${size}` });
      expect(res.status).toBe(201);
      expect(res.body.order).toMatchObject({ size, totalPrice: total });
    }
  });

  it('ignores a price or a shop sent in the body', async () => {
    const res = await as(ACCOUNTS.dealerAdmin)
      .post('/api/lock-orders')
      .send({ ...transfer, totalPrice: 1, unitPrice: 0, dealerId: 'dealer-2', status: 'APPROVED', packId: 'pack-x' });

    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ dealerId: 'dealer-1', totalPrice: 24_000, status: 'PENDING' });
    expect(res.body.order.packId).toBeUndefined();
  });

  it('refuses a malformed order', async () => {
    const post = (body: Record<string, unknown>) => as(ACCOUNTS.dealerAdmin).post('/api/lock-orders').send(body);

    expect((await post({ ...transfer, size: 0 })).status).toBe(422);
    expect((await post({ ...transfer, size: 501 })).status).toBe(422);
    expect((await post({ ...transfer, size: 2.5 })).status).toBe(422);
    expect((await post({ ...transfer, paymentMethod: 'CASH' })).status).toBe(422);
    expect((await post({ ...transfer, transactionId: 'x' })).status).toBe(422);
    expect((await post({ ...transfer, transactionId: '<script>alert(1)</script>' })).status).toBe(422);
    expect((await post({ ...transfer, amountPaid: 0 })).status).toBe(422);
    expect((await post({ ...transfer, amountPaid: -5 })).status).toBe(422);
    expect((await post({ ...transfer, proofImage: 'https://example.com/a.png' })).status).toBe(422);
    expect(await repo.lockOrders.count({})).toBe(0);
  });

  it('keeps a screenshot out of the list and serves it only to its shop and the platform', async () => {
    const proofImage = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ';
    const id = await placeOrder({ proofImage });

    const list = await as(ACCOUNTS.dealerAdmin).get('/api/lock-orders');
    expect(list.body.orders[0]).toMatchObject({ id, hasProof: true });
    expect(list.body.orders[0].proofImage).toBeUndefined();

    expect((await as(ACCOUNTS.dealerAdmin).get(`/api/lock-orders/${id}/proof`)).body.proofImage).toBe(proofImage);
    expect((await as(ACCOUNTS.superAdmin).get(`/api/lock-orders/${id}/proof`)).body.proofImage).toBe(proofImage);
    expect((await as(ACCOUNTS.otherDealerAdmin).get(`/api/lock-orders/${id}/proof`)).status).toBe(404);
  });

  it('does not accept the same transaction ID twice, from any shop', async () => {
    await placeOrder();

    const again = await as(ACCOUNTS.dealerAdmin).post('/api/lock-orders').send(transfer);
    expect(again.status).toBe(409);

    const otherShop = await as(ACCOUNTS.otherDealerAdmin)
      .post('/api/lock-orders')
      .send({ ...transfer, transactionId: 'jc-778812345' });
    expect(otherShop.status).toBe(409);
  });

  it('stops a shop piling up undecided orders', async () => {
    for (const n of [1, 2, 3]) await placeOrder({ transactionId: `TID-000${n}` });

    const fourth = await as(ACCOUNTS.dealerAdmin).post('/api/lock-orders').send({ ...transfer, transactionId: 'TID-0004' });
    expect(fourth.status).toBe(409);
    expect(await repo.lockOrders.count({ dealerId: 'dealer-1' })).toBe(3);
  });

  it('lets the shop cancel an undecided order, which frees its transaction ID', async () => {
    const id = await placeOrder();

    const res = await as(ACCOUNTS.dealerAdmin).post(`/api/lock-orders/${id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('CANCELLED');
    expect(await auditFor(id, 'LOCK_ORDER_CANCELLED')).toBe(1);

    // Cancelled means cancelled: the platform cannot approve it afterwards.
    expect((await as(ACCOUNTS.superAdmin).post(`/api/lock-orders/${id}/approve`)).status).toBe(409);
    expect((await as(ACCOUNTS.dealerAdmin).post('/api/lock-orders').send(transfer)).status).toBe(201);
  });
});

describe('the platform decides an order', () => {
  it('approving issues exactly the ordered pack, tied to the order, and audits both', async () => {
    const before = await availableFor('dealer-1');
    const packsBefore = await packsFor('dealer-1');
    const id = await placeOrder();

    const res = await as(ACCOUNTS.superAdmin).post(`/api/lock-orders/${id}/approve`);

    expect(res.status).toBe(200);
    expect(res.body.licenses).toBe(30);
    expect(res.body.order).toMatchObject({ status: 'APPROVED', reviewedByName: expect.any(String) });
    expect(res.body.pack).toMatchObject({
      dealerId: 'dealer-1',
      size: 30,
      unitPrice: 800,
      totalPrice: 24_000,
      reference: 'JazzCash JC-778812345',
    });

    expect(await availableFor('dealer-1')).toBe(before + 30);
    expect(await packsFor('dealer-1')).toBe(packsBefore + 1);
    expect((await repo.lockOrders.findById(id))?.packId).toBe(res.body.pack.id);
    expect(await repo.deviceLicenses.count({ packId: res.body.pack.id })).toBe(30);

    expect(await auditFor(id, 'LOCK_ORDER_APPROVED')).toBe(1);
    expect(await auditFor(res.body.pack.id, 'LICENSE_PACK_ISSUED')).toBe(1);
  });

  it('issues at the price fixed on the order, not at a price list that changed since', async () => {
    const id = await placeOrder();
    // As if the order had been placed under an older, cheaper price list.
    await repo.lockOrders.update(id, { unitPrice: 750, totalPrice: 22_500 });

    const res = await as(ACCOUNTS.superAdmin).post(`/api/lock-orders/${id}/approve`);
    expect(res.body.pack).toMatchObject({ size: 30, unitPrice: 750, totalPrice: 22_500 });
  });

  it('will not approve the same order twice', async () => {
    const id = await placeOrder();
    const before = await availableFor('dealer-1');

    expect((await as(ACCOUNTS.superAdmin).post(`/api/lock-orders/${id}/approve`)).status).toBe(200);
    const second = await as(ACCOUNTS.superAdmin).post(`/api/lock-orders/${id}/approve`);

    expect(second.status).toBe(409);
    expect(await availableFor('dealer-1')).toBe(before + 30);
    expect(await repo.licensePacks.count({ reference: 'JazzCash JC-778812345' })).toBe(1);
    expect(await auditFor(id, 'LOCK_ORDER_APPROVED')).toBe(1);
  });

  it('issues one pack when two approvals arrive at the same moment', async () => {
    const id = await placeOrder();
    const before = await availableFor('dealer-1');

    const results = await Promise.all(
      [1, 2, 3, 4].map(() => as(ACCOUNTS.superAdmin).post(`/api/lock-orders/${id}/approve`))
    );

    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    expect(await availableFor('dealer-1')).toBe(before + 30);
    expect(await repo.licensePacks.count({ reference: 'JazzCash JC-778812345' })).toBe(1);
  });

  it('rolls the approval back if the pack cannot be issued', async () => {
    const id = await placeOrder();
    // An impossible size makes LicenseService refuse inside the transaction.
    await repo.lockOrders.update(id, { size: 9_999 });

    const res = await as(ACCOUNTS.superAdmin).post(`/api/lock-orders/${id}/approve`);

    expect(res.status).toBe(400);
    expect((await repo.lockOrders.findById(id))?.status).toBe('PENDING');
    expect(await auditFor(id, 'LOCK_ORDER_APPROVED')).toBe(0);
  });

  it('rejecting needs a reason, issues nothing, and is final', async () => {
    const id = await placeOrder();
    const before = await availableFor('dealer-1');

    expect((await as(ACCOUNTS.superAdmin).post(`/api/lock-orders/${id}/reject`).send({})).status).toBe(422);
    expect((await as(ACCOUNTS.superAdmin).post(`/api/lock-orders/${id}/reject`).send({ reason: 'no' })).status).toBe(422);

    const res = await as(ACCOUNTS.superAdmin)
      .post(`/api/lock-orders/${id}/reject`)
      .send({ reason: 'No payment with this transaction ID reached our JazzCash account.' });

    expect(res.status).toBe(200);
    expect(res.body.order).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'No payment with this transaction ID reached our JazzCash account.',
    });
    expect(await availableFor('dealer-1')).toBe(before);
    expect(await auditFor(id, 'LOCK_ORDER_REJECTED')).toBe(1);

    // The shop sees why.
    const mine = await as(ACCOUNTS.dealerAdmin).get('/api/lock-orders');
    expect(mine.body.orders[0].rejectionReason).toMatch(/No payment/);

    expect((await as(ACCOUNTS.superAdmin).post(`/api/lock-orders/${id}/approve`)).status).toBe(409);
    expect((await as(ACCOUNTS.superAdmin).post(`/api/lock-orders/${id}/reject`).send({ reason: 'Again, for luck.' })).status).toBe(409);
    expect((await as(ACCOUNTS.dealerAdmin).post(`/api/lock-orders/${id}/cancel`)).status).toBe(409);
    expect(await availableFor('dealer-1')).toBe(before);
  });

  it('answers 404 for an order that does not exist', async () => {
    expect((await as(ACCOUNTS.superAdmin).post('/api/lock-orders/lord-missing/approve')).status).toBe(404);
    expect((await as(ACCOUNTS.superAdmin).post('/api/lock-orders/lord-missing/reject').send({ reason: 'Not found anywhere.' })).status).toBe(404);
  });
});

describe('who may touch a lock order', () => {
  it('needs a session', async () => {
    expect((await anonymous().get('/api/lock-orders')).status).toBe(401);
    expect((await anonymous().post('/api/lock-orders').send(transfer)).status).toBe(401);
    expect((await anonymous().post('/api/lock-orders/x/approve')).status).toBe(401);
  });

  it('is closed to counter staff and customers', async () => {
    for (const account of [ACCOUNTS.dealerStaff, ACCOUNTS.customer]) {
      expect((await as(account).get('/api/lock-orders')).status).toBe(403);
      expect((await as(account).post('/api/lock-orders').send(transfer)).status).toBe(403);
    }
    expect(await repo.lockOrders.count({})).toBe(0);
  });

  it('never lets a shop approve or reject — its own order or anyone else\'s', async () => {
    const id = await placeOrder();
    const before = await availableFor('dealer-1');

    for (const account of [ACCOUNTS.dealerAdmin, ACCOUNTS.otherDealerAdmin, ACCOUNTS.dealerStaff, ACCOUNTS.customer]) {
      expect((await as(account).post(`/api/lock-orders/${id}/approve`)).status).toBe(403);
      expect((await as(account).post(`/api/lock-orders/${id}/reject`).send({ reason: 'Trying my luck here.' })).status).toBe(403);
    }

    expect((await repo.lockOrders.findById(id))?.status).toBe('PENDING');
    expect(await availableFor('dealer-1')).toBe(before);
  });

  it('still keeps direct pack issuing away from a shop', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).post('/api/licenses/packs').send({ dealerId: 'dealer-1', size: 30 });
    expect(res.status).toBe(403);
  });

  it('shows a shop only its own orders, and will not cancel another shop\'s', async () => {
    const id = await placeOrder();

    const other = await as(ACCOUNTS.otherDealerAdmin).get('/api/lock-orders?dealerId=dealer-1');
    expect(other.status).toBe(200);
    expect(other.body.orders).toEqual([]);

    expect((await as(ACCOUNTS.otherDealerAdmin).post(`/api/lock-orders/${id}/cancel`)).status).toBe(404);
    expect((await repo.lockOrders.findById(id))?.status).toBe('PENDING');
  });

  it('gives the super admin the queue across shops, but not a shop\'s place in it', async () => {
    const id = await placeOrder();
    await as(ACCOUNTS.otherDealerAdmin).post('/api/lock-orders').send({ ...transfer, transactionId: 'EP-99001122', paymentMethod: 'EASYPAISA' });

    const queue = await as(ACCOUNTS.superAdmin).get('/api/lock-orders?status=PENDING');
    expect(queue.body.orders).toHaveLength(2);
    expect(queue.body.orders.find((o: { id: string }) => o.id === id)).toMatchObject({
      dealerId: 'dealer-1',
      dealerName: expect.any(String),
      dealerPhone: expect.any(String),
    });

    // A super admin issues packs directly; ordering and cancelling are the shop's.
    expect((await as(ACCOUNTS.superAdmin).post('/api/lock-orders').send(transfer)).status).toBe(403);
    expect((await as(ACCOUNTS.superAdmin).post(`/api/lock-orders/${id}/cancel`)).status).toBe(403);
  });
});

describe('payment instructions', () => {
  it('are written by the super admin, read by shop owners, and audited', async () => {
    const text = 'JazzCash 0321-1144477 (Almas SDM)\nMeezan Bank PK00MEZN0000000000000000';

    const denied = await as(ACCOUNTS.dealerAdmin).put('/api/lock-orders/payment-instructions').send({ paymentInstructions: 'Pay me instead' });
    expect(denied.status).toBe(403);
    expect((await as(ACCOUNTS.dealerAdmin).get('/api/lock-orders')).body.paymentInstructions).toBe('');

    const saved = await as(ACCOUNTS.superAdmin).put('/api/lock-orders/payment-instructions').send({ paymentInstructions: text });
    expect(saved.status).toBe(200);
    // Saving twice updates the one row rather than failing on it.
    expect((await as(ACCOUNTS.superAdmin).put('/api/lock-orders/payment-instructions').send({ paymentInstructions: text })).status).toBe(200);

    expect((await as(ACCOUNTS.dealerAdmin).get('/api/lock-orders')).body.paymentInstructions).toBe(text);
    expect(await repo.auditLogs.count({ action: 'LOCK_PAYMENT_INSTRUCTIONS_UPDATED' })).toBe(2);
  });
});

describe('a new shop, from sign-up to its first locks', () => {
  const signup = {
    name: 'Bismillah Mobiles',
    ownerName: 'Kashif Ali',
    email: 'kashif@bismillahmobiles.pk',
    phone: '03001234567',
    city: 'Faisalabad',
    address: 'Shop 12, Rail Bazaar, Faisalabad',
    password: 'Bismillah#2026',
    packSize: 10,
  };

  it('signs up unpaid, orders, is approved once, and can then sell', async () => {
    const reg = await anonymous().post('/api/auth/register-dealer').send(signup);
    expect(reg.status).toBe(201);
    const dealerId = reg.body.dealer.id as string;
    const owner = { Authorization: `Bearer ${reg.body.token}` };
    expect(await availableFor(dealerId)).toBe(0);

    // Before it reports a payment, the shop is on the platform's "has not paid" list.
    const waiting = (await as(ACCOUNTS.superAdmin).get('/api/platform/overview')).body;
    expect(waiting.awaitingPayment.some((s: { dealerId: string }) => s.dealerId === dealerId)).toBe(true);

    const placed = await anonymous()
      .post('/api/lock-orders')
      .set(owner)
      .send({ size: 10, paymentMethod: 'EASYPAISA', transactionId: 'EP-55667788', amountPaid: 10_000 });
    expect(placed.status).toBe(201);
    expect(await availableFor(dealerId)).toBe(0);

    // Now it is in the orders queue instead — one place, one button.
    const queued = (await as(ACCOUNTS.superAdmin).get('/api/platform/overview')).body;
    expect(queued.awaitingPayment.some((s: { dealerId: string }) => s.dealerId === dealerId)).toBe(false);
    expect(queued.totals.ordersToCheck).toBe(1);

    // The new owner cannot wave their own order through.
    expect((await anonymous().post(`/api/lock-orders/${placed.body.order.id}/approve`).set(owner)).status).toBe(403);

    expect((await as(ACCOUNTS.superAdmin).post(`/api/lock-orders/${placed.body.order.id}/approve`)).status).toBe(200);
    expect(await availableFor(dealerId)).toBe(10);
    expect((await repo.dealers.findById(dealerId))?.requestedPackSize ?? null).toBeNull();

    const mine = await anonymous().get('/api/lock-orders').set(owner);
    expect(mine.body.orders).toHaveLength(1);
    expect(mine.body.orders[0]).toMatchObject({ status: 'APPROVED', size: 10, totalPrice: 10_000 });
  });
});
