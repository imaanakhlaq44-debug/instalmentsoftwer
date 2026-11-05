import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

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

describe('GET /api/platform/overview', () => {
  it('is for the super admin only', async () => {
    expect((await as(ACCOUNTS.dealerAdmin).get('/api/platform/overview')).status).toBe(403);
    expect((await anonymous().get('/api/platform/overview')).status).toBe(401);
  });

  it('lists a new shop as awaiting payment, with what it owes', async () => {
    const reg = await anonymous().post('/api/auth/register-dealer').send(signup);
    const dealerId = reg.body.dealer.id as string;

    const res = await as(ACCOUNTS.superAdmin).get('/api/platform/overview');
    expect(res.status).toBe(200);

    const waiting = res.body.awaitingPayment.find((s: { dealerId: string }) => s.dealerId === dealerId);
    expect(waiting).toMatchObject({
      name: 'Bismillah Mobiles',
      requestedPack: { size: 10, unitPrice: 1000, totalPrice: 10_000 },
    });
    expect(res.body.totals.shopsAwaitingPayment).toBeGreaterThanOrEqual(1);
  });

  it('stops listing the shop once its pack is issued, and counts the sale', async () => {
    const reg = await anonymous().post('/api/auth/register-dealer').send(signup);
    const dealerId = reg.body.dealer.id as string;
    const before = (await as(ACCOUNTS.superAdmin).get('/api/platform/overview')).body.totals;

    await as(ACCOUNTS.superAdmin).post('/api/licenses/packs').send({ dealerId, size: 10 });

    const after = await as(ACCOUNTS.superAdmin).get('/api/platform/overview');
    expect(after.body.awaitingPayment.some((s: { dealerId: string }) => s.dealerId === dealerId)).toBe(false);
    expect(after.body.totals.revenue).toBe(before.revenue + 10_000);
    expect(after.body.totals.locksSold).toBe(before.locksSold + 10);

    const shop = after.body.shops.find((s: { dealerId: string }) => s.dealerId === dealerId);
    expect(shop).toMatchObject({ available: 10, consumed: 0, packsBought: 1, billed: 10_000, requestedPack: null });
    expect((await repo.dealers.findById(dealerId))?.requestedPackSize ?? null).toBeNull();
  });

  it('summarises the fleet by status', async () => {
    const res = await as(ACCOUNTS.superAdmin).get('/api/platform/overview');
    const total = Object.values(res.body.fleet.byStatus as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(total).toBe(await repo.devices.count({}));
    expect(typeof res.body.fleet.stale).toBe('number');
  });
});
