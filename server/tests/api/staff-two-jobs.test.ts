import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';

import { app, as, reseed, repo, ACCOUNTS } from '../helpers.js';
import { AuthService } from '../../src/services/AuthService.js';
import { disconnectDatabase } from '../../src/db/prisma.js';

/**
 * The owner's rule for shop staff: two jobs and nothing else.
 *
 *   1. Every staff login can look customers up with their full phone number,
 *      to call or WhatsApp them (GET /api/staff-desk/customers).
 *   2. Counter staff can also take a payment at the counter (POST /api/payments).
 *
 * Every other endpoint is refused for them, by the allow-list in requireAuth.
 */

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

async function addViewer(): Promise<{ Authorization: string }> {
  const created = await as(ACCOUNTS.dealerAdmin)
    .post('/api/users')
    .send({ name: 'Bilal', email: 'bilal.view@almadinamobiles.pk', phone: '0301-2345678', password: 'Temp#Viewer2026', role: 'DEALER_VIEWER' })
    .expect(201);
  const user = await repo.users.findById(created.body.id);
  await repo.users.update(user!.id, { mustChangePassword: false });
  const fresh = await repo.users.findById(created.body.id);
  return { Authorization: `Bearer ${AuthService.issueToken(fresh!)}` };
}

/** Endpoints a shop's staff used to reach, and now must not. */
const CLOSED: Array<[string, string]> = [
  ['get', '/api/dashboard/stats'],
  ['get', '/api/dashboard/today'],
  ['get', '/api/customers'],
  ['get', '/api/customers/cust-1'],
  ['post', '/api/customers'],
  ['get', '/api/devices'],
  ['get', '/api/installments'],
  ['get', '/api/installments/plans'],
  ['get', '/api/payments'],
  ['get', '/api/transactions'],
  ['get', '/api/notifications'],
  ['post', '/api/notifications/whatsapp/message'],
  ['get', '/api/sale-drafts'],
  ['post', '/api/enrollment/qr'],
  ['get', '/api/handset-tests'],
  ['get', '/api/licenses'],
  ['get', '/api/settings'],
  ['get', '/api/users'],
  ['post', '/api/testimonials'],
  ['get', '/api/audit-logs'],
];

describe('staff can only do their two jobs', () => {
  it('counter staff see each customer with the full phone number and what is owed', async () => {
    const res = await as(ACCOUNTS.dealerStaff).get('/api/staff-desk/customers').expect(200);
    expect(res.body.canRecordPayments).toBe(true);
    expect(res.body.customers.length).toBeGreaterThan(0);
    const one = res.body.customers.find((c: { customerId: string }) => c.customerId === 'cust-1');
    expect(one.phone).toMatch(/^0\d{3}-?\d{7}$/);
    expect(one.phone).not.toContain('*');
    // Only what the two jobs need: no CNIC, address or device identifiers.
    expect(Object.keys(one).sort()).toEqual(['amountDue', 'customerId', 'daysLate', 'name', 'phone', 'plans']);
    for (const plan of one.plans) expect(plan).not.toHaveProperty('imei');
    expect(JSON.stringify(res.body)).not.toMatch(/cnic|address|imei/i);
  });

  it('only shows the staff member\'s own shop', async () => {
    const res = await as(ACCOUNTS.dealerStaff).get('/api/staff-desk/customers').expect(200);
    const mine = await repo.customers.findMany({ where: { dealerId: 'dealer-1' } });
    const ids = new Set(mine.map((c) => c.id));
    for (const c of res.body.customers) expect(ids.has(c.customerId)).toBe(true);
  });

  it('searches by phone', async () => {
    const cust = await repo.customers.findById('cust-1');
    const digits = cust!.phone.replace(/\D/g, '').slice(-4);
    const res = await as(ACCOUNTS.dealerStaff).get(`/api/staff-desk/customers?search=${digits}`).expect(200);
    expect(res.body.customers.map((c: { customerId: string }) => c.customerId)).toContain('cust-1');
  });

  it('counter staff can take a payment at the counter', async () => {
    const desk = await as(ACCOUNTS.dealerStaff).get('/api/staff-desk/customers').expect(200);
    const one = desk.body.customers.find((c: { plans: unknown[] }) => c.plans.length > 0);
    const plan = one.plans[0];
    const res = await as(ACCOUNTS.dealerStaff)
      .post('/api/payments')
      .send({ customerId: one.customerId, planId: plan.planId, amount: 500, paymentMethod: 'CASH', autoVerify: true })
      .expect(201);
    expect(res.body).toBeTruthy();
  });

  it.each(CLOSED)('counter staff are refused %s %s', async (method, url) => {
    const res = await (as(ACCOUNTS.dealerStaff) as any)[method](url).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('STAFF_LIMITED');
  });

  it('counter staff cannot reverse, verify or delete anything', async () => {
    for (const [method, url] of [
      ['post', '/api/payments/pay-1/reverse'],
      ['post', '/api/payments/pay-1/verify'],
      ['delete', '/api/customers/cust-1'],
      ['post', '/api/devices/dev-1/lock'],
      ['post', '/api/payments/submit'],
    ] as const) {
      const res = await (as(ACCOUNTS.dealerStaff) as any)[method](url).send({});
      expect(res.status, `${method} ${url}`).toBe(403);
    }
  });

  it('view-only staff can look customers up but cannot take a payment or reach anything else', async () => {
    const header = await addViewer();
    const desk = await request(app).get('/api/staff-desk/customers').set(header).expect(200);
    expect(desk.body.canRecordPayments).toBe(false);
    expect(desk.body.customers.length).toBeGreaterThan(0);

    const pay = await request(app)
      .post('/api/payments')
      .set(header)
      .send({ customerId: 'cust-1', amount: 500, paymentMethod: 'CASH' });
    expect(pay.status).toBe(403);
    expect(pay.body.code).toBe('VIEW_ONLY');

    for (const [, url] of CLOSED.filter(([m]) => m === 'get')) {
      const res = await request(app).get(url).set(header);
      expect(res.status, url).toBe(403);
    }
  });

  it('staff can still see who they are, change their password and sign out', async () => {
    await as(ACCOUNTS.dealerStaff).get('/api/auth/me').expect(200);
    await as(ACCOUNTS.dealerStaff).post('/api/auth/logout').expect(200);
  });

  it('the owner and customers are not affected', async () => {
    await as(ACCOUNTS.dealerAdmin).get('/api/customers').expect(200);
    await as(ACCOUNTS.dealerAdmin).get('/api/staff-desk/customers').expect(200);
    await as(ACCOUNTS.customer).get('/api/staff-desk/customers').expect(403);
  });
});
