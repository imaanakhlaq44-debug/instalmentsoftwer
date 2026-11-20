import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';

import { app, as, reseed, repo, ACCOUNTS } from '../helpers.js';
import { AuthService } from '../../src/services/AuthService.js';
import { disconnectDatabase } from '../../src/db/prisma.js';

/**
 * View-only shop staff: the owner adds them from the Staff section, and they
 * can see which phone is with whom and who is behind on payments, but every
 * change to shop data is refused by the server.
 */

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

const TEMP_PASSWORD = 'Temp#Viewer2026';
const REAL_PASSWORD = 'Viewer#Own2026x';

/** The owner adds a view-only login; returns a bearer header for it, past the first-login password change. */
async function addViewer(): Promise<{ id: string; header: { Authorization: string } }> {
  const created = await as(ACCOUNTS.dealerAdmin)
    .post('/api/users')
    .send({
      name: 'Bilal (Recovery)',
      email: 'bilal.recovery@almadinamobiles.pk',
      phone: '0301-2345678',
      password: TEMP_PASSWORD,
      role: 'DEALER_VIEWER',
    })
    .expect(201);
  expect(created.body.role).toBe('DEALER_VIEWER');
  expect(created.body.mustChangePassword).toBe(true);

  const user = await repo.users.findById(created.body.id);
  const header = { Authorization: `Bearer ${AuthService.issueToken(user!)}` };

  // Changing their own password is one of the two writes they are allowed.
  await request(app)
    .post('/api/auth/change-password')
    .set(header)
    .send({ currentPassword: TEMP_PASSWORD, newPassword: REAL_PASSWORD })
    .expect(200);

  const fresh = await repo.users.findById(created.body.id);
  return { id: created.body.id, header: { Authorization: `Bearer ${AuthService.issueToken(fresh!)}` } };
}

describe('view-only staff', () => {
  it('only the owner can add one', async () => {
    await as(ACCOUNTS.dealerStaff)
      .post('/api/users')
      .send({ name: 'Nope', email: 'nope@x.pk', phone: '0301-2345678', password: TEMP_PASSWORD, role: 'DEALER_VIEWER' })
      .expect(403);
    await addViewer();
  });

  it("sees the shop's phones, customers, instalments, payments and who is behind", async () => {
    const { header } = await addViewer();
    const get = (url: string) => request(app).get(url).set(header);

    const devices = await get('/api/devices').expect(200);
    const deviceList = devices.body.data ?? devices.body.devices ?? devices.body;
    expect(Array.isArray(deviceList) && deviceList.length).toBeTruthy();
    const deviceId = deviceList[0].id;
    await get(`/api/devices/${deviceId}`).expect(200);
    await get(`/api/devices/${deviceId}/actions`).expect(200);

    await get('/api/customers').expect(200);
    const customer = await get('/api/customers/cust-1').expect(200);
    // Same masking as counter staff: the full CNIC stays with the owner.
    expect(customer.body.customer.cnic).toContain('*');

    await get('/api/installments').expect(200);
    await get('/api/installments/plans').expect(200);
    await get('/api/payments').expect(200);
    await get('/api/dashboard/stats').expect(200);
    const attention = await get('/api/dashboard/attention').expect(200);
    expect(Array.isArray(attention.body.overdueInstallments)).toBe(true);
  });

  it('cannot change anything', async () => {
    const { header } = await addViewer();
    const refused = async (method: 'post' | 'patch' | 'put' | 'delete', url: string, body: object = {}) => {
      const res = await request(app)[method](url).set(header).send(body);
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(403);
      expect(res.body.code ?? res.body.error?.code).toBe('VIEW_ONLY');
    };

    await refused('post', '/api/payments', { customerId: 'cust-1', planId: 'x', amount: 1000, paymentMethod: 'CASH' });
    await refused('post', '/api/payments/submit', { amount: 1000 });
    await refused('post', '/api/customers', {});
    await refused('patch', '/api/customers/cust-1', { name: 'Changed' });
    await refused('delete', '/api/customers/cust-1/photo');
    await refused('post', '/api/devices/dev-1/lock', { reason: 'test' });
    await refused('post', '/api/devices/dev-1/message', { message: 'hello' });
    await refused('post', '/api/enrollment/generate', {});
    await refused('post', '/api/notifications/send', {});
    await refused('post', '/api/installments/evaluate-overdue', {});

    // Nothing moved.
    const customer = await repo.customers.findById('cust-1');
    expect(customer?.name).not.toBe('Changed');
  });

  it('is kept out of the owner-only pages', async () => {
    const { header } = await addViewer();
    for (const url of ['/api/users', '/api/settings', '/api/audit-logs', '/api/licenses', '/api/enrollment/tokens']) {
      const res = await request(app).get(url).set(header);
      expect(res.status, url).toBe(403);
    }
  });

  it('counter staff can still record a payment', async () => {
    const plans = await as(ACCOUNTS.dealerStaff).get('/api/installments/plans').expect(200);
    const list = plans.body.data ?? plans.body.plans ?? plans.body;
    const plan = list.find((p: { status: string }) => p.status === 'ACTIVE') ?? list[0];
    const res = await as(ACCOUNTS.dealerStaff)
      .post('/api/payments')
      .send({ customerId: plan.customerId, planId: plan.id, amount: 1000, paymentMethod: 'CASH' });
    expect(res.status).toBe(201);
  });

  it('the owner can switch a login between view-only and counter staff, and switch it off', async () => {
    const { id } = await addViewer();
    const up = await as(ACCOUNTS.dealerAdmin).patch(`/api/users/${id}`).send({ role: 'DEALER_STAFF' }).expect(200);
    expect(up.body.role).toBe('DEALER_STAFF');
    const down = await as(ACCOUNTS.dealerAdmin).patch(`/api/users/${id}`).send({ role: 'DEALER_VIEWER' }).expect(200);
    expect(down.body.role).toBe('DEALER_VIEWER');

    await as(ACCOUNTS.dealerAdmin).delete(`/api/users/${id}`).expect(200);
    const user = await repo.users.findById(id);
    const res = await request(app)
      .get('/api/devices')
      .set({ Authorization: `Bearer ${AuthService.issueToken(user!)}` });
    expect(res.status).toBe(403);
  });
});
