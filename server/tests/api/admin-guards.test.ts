import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { disconnectDatabase } from '../../src/db/prisma.js';

import { anonymous, as, reseed, repo, ACCOUNTS, SEED_PASSWORD } from '../helpers.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

describe('dealer suspension', () => {
  it('cuts off an already-issued token as soon as the dealer is suspended', async () => {
    expect((await as(ACCOUNTS.dealerStaff).get('/api/devices')).status).toBe(200);

    await repo.dealers.update('dealer-1', { active: false });

    const res = await as(ACCOUNTS.dealerStaff).get('/api/devices');
    expect(res.status).toBe(403);
    expect(res.body.message ?? res.body.error).toMatch(/suspended/i);
  });

  it('does not affect other dealers or the super admin', async () => {
    await repo.dealers.update('dealer-1', { active: false });

    expect((await as(ACCOUNTS.otherDealerAdmin).get('/api/devices')).status).toBe(200);
    expect((await as(ACCOUNTS.superAdmin).get('/api/devices')).status).toBe(200);
  });
});

describe('temporary password', () => {
  const TEMP = 'TempPass#2026';
  const NEW = 'NewSecret#2026';

  async function loginWithTemp(): Promise<string> {
    const reset = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/users/${ACCOUNTS.dealerStaff}/reset-password`)
      .send({ temporaryPassword: TEMP });
    expect(reset.status).toBe(200);

    const staff = (await repo.users.findById(ACCOUNTS.dealerStaff))!;
    const login = await anonymous().post('/api/auth/login').send({ email: staff.email, password: TEMP });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    return login.body.token as string;
  }

  it('blocks the API until the password is changed', async () => {
    const token = await loginWithTemp();
    const auth = { Authorization: `Bearer ${token}` };

    const blocked = await anonymous().get('/api/devices').set(auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // The session itself and the change-password endpoint stay reachable.
    expect((await anonymous().get('/api/auth/me').set(auth)).status).toBe(200);
    const changed = await anonymous()
      .post('/api/auth/change-password')
      .set(auth)
      .send({ currentPassword: TEMP, newPassword: NEW });
    expect(changed.status).toBe(200);

    expect((await anonymous().get('/api/devices').set(auth)).status).toBe(200);
  });

  it('leaves normal accounts untouched', async () => {
    const staff = (await repo.users.findById(ACCOUNTS.dealerStaff))!;
    const login = await anonymous().post('/api/auth/login').send({ email: staff.email, password: SEED_PASSWORD });
    const res = await anonymous().get('/api/devices').set({ Authorization: `Bearer ${login.body.token}` });
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/users/:id role and customer binding', () => {
  it('refuses to turn staff into a CUSTOMER without a customerId', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).patch(`/api/users/${ACCOUNTS.dealerStaff}`).send({ role: 'CUSTOMER' });
    expect(res.status).toBe(400);
    expect((await repo.users.findById(ACCOUNTS.dealerStaff))!.role).toBe('DEALER_STAFF');
  });

  it("refuses another dealer's customer", async () => {
    const foreign = (await repo.customers.findFirst({ dealerId: 'dealer-2' }))!;
    const res = await as(ACCOUNTS.dealerAdmin)
      .patch(`/api/users/${ACCOUNTS.dealerStaff}`)
      .send({ role: 'CUSTOMER', customerId: foreign.id });
    expect(res.status).toBe(404);
  });

  it('binds the customer when one of this dealer is given', async () => {
    const own = (await repo.customers.findFirst({ dealerId: 'dealer-1' }))!;
    const res = await as(ACCOUNTS.dealerAdmin)
      .patch(`/api/users/${ACCOUNTS.dealerStaff}`)
      .send({ role: 'CUSTOMER', customerId: own.id });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('CUSTOMER');
    expect(res.body.customerId).toBe(own.id);
  });

  it('clears the customer link when a CUSTOMER becomes staff', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).patch(`/api/users/${ACCOUNTS.customer}`).send({ role: 'DEALER_STAFF' });
    expect(res.status).toBe(200);
    expect(res.body.customerId).toBeUndefined();
    expect((await repo.users.findById(ACCOUNTS.customer))!.customerId).toBeUndefined();
  });

  it('still allows ordinary edits of a CUSTOMER login', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).patch(`/api/users/${ACCOUNTS.customer}`).send({ name: 'Renamed Customer' });
    expect(res.status).toBe(200);
    expect(res.body.customerId).toBeTruthy();
  });
});
