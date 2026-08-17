import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { Device, Customer } from '../../src/types/index.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

describe('role restrictions', () => {
  it('keeps the audit trail away from counter staff', async () => {
    expect((await as(ACCOUNTS.dealerStaff).get('/api/audit-logs')).status).toBe(403);
    expect((await as(ACCOUNTS.dealerAdmin).get('/api/audit-logs')).status).toBe(200);
  });

  it('keeps staff management away from counter staff', async () => {
    expect((await as(ACCOUNTS.dealerStaff).get('/api/users')).status).toBe(403);
    expect((await as(ACCOUNTS.dealerAdmin).get('/api/users')).status).toBe(200);
  });

  it('does not let counter staff lock a device', async () => {
    const device = (await repo.devices.findFirst({ dealerId: 'dealer-1', status: 'ACTIVE' }))!;

    const res = await as(ACCOUNTS.dealerStaff)
      .post(`/api/devices/${device.id}/lock`)
      .send({ reason: 'Staff attempting an enforcement action.' });

    expect(res.status).toBe(403);
    expect((await repo.devices.findById(device.id))!.status).toBe('ACTIVE');
  });

  it('does not let a customer lock their own device', async () => {
    const device = (await repo.devices.findFirst({ customerId: 'cust-1' }))!;

    const res = await as(ACCOUNTS.customer)
      .post(`/api/devices/${device.id}/unlock`)
      .send({ reason: 'Self-service unlock attempt.' });

    expect(res.status).toBe(403);
  });

  it('does not let a customer record a payment', async () => {
    const res = await as(ACCOUNTS.customer)
      .post('/api/payments')
      .send({ customerId: 'cust-1', amount: 5000, paymentMethod: 'CASH' });

    expect(res.status).toBe(403);
  });

  it('does not let a customer register another customer', async () => {
    const res = await as(ACCOUNTS.customer).post('/api/customers').send({
      name: 'Injected Customer',
      phone: '0300-1112233',
      cnic: '3520212345671',
      address: 'House 1, Test Street, Lahore',
    });

    expect(res.status).toBe(403);
  });

  it('does let counter staff record a payment', async () => {
    const res = await as(ACCOUNTS.dealerStaff).post('/api/payments').send({
      customerId: 'cust-2',
      planId: 'plan-2',
      amount: 1_000,
      paymentMethod: 'CASH',
      referenceNumber: 'RBAC-TEST-1',
    });

    expect(res.status).toBeLessThan(300);
  });
});

describe('PII masking by role', () => {
  it('sends the raw IMEI to a dealer admin', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/devices?limit=5');
    const device = res.body.data[0];

    expect(device.imei).toMatch(/^\d+$/);
    expect(device.imeiMasked).toBe(false);
  });

  it('removes the raw IMEI for counter staff rather than shadowing it', async () => {
    const res = await as(ACCOUNTS.dealerStaff).get('/api/devices?limit=5');
    const device = res.body.data[0];

    expect(device.imei).toBeUndefined();
    expect(device.maskedImei).toMatch(/^\*+\d{4}$/);
    expect(device.imeiMasked).toBe(true);
  });

  it('removes the serial number for counter staff', async () => {
    const res = await as(ACCOUNTS.dealerStaff).get('/api/devices?limit=5');
    expect(res.body.data[0].serialNumber).toBeUndefined();
  });

  it('never leaks a raw IMEI anywhere in a staff device listing', async () => {
    const admin = await as(ACCOUNTS.dealerAdmin).get('/api/devices?limit=100');
    const staff = await as(ACCOUNTS.dealerStaff).get('/api/devices?limit=100');

    const rawImeis = admin.body.data.map((d: Device) => d.imei).filter(Boolean);
    expect(rawImeis.length).toBeGreaterThan(0);

    const staffPayload = JSON.stringify(staff.body);
    for (const imei of rawImeis) {
      expect(staffPayload).not.toContain(imei);
    }
  });

  it('masks CNIC, address and phone for counter staff', async () => {
    const res = await as(ACCOUNTS.dealerStaff).get('/api/customers?limit=5');
    const customer = res.body.data[0];

    expect(customer.cnic).toContain('*');
    expect(customer.address).toContain('••••');
    expect(customer.phone).toContain('***');
  });

  it('leaves the address intact for a dealer admin', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/customers?limit=5');
    const customer = res.body.data[0];

    const stored = (await repo.customers.findById(customer.id))!;
    expect(customer.address).toBe(stored.address);
  });

  it('shows a customer their own unmasked address', async () => {
    const res = await as(ACCOUNTS.customer).get('/api/customers?limit=5');
    const me = res.body.data[0];

    expect(me.id).toBe('cust-1');
    expect(me.address).toBe((await repo.customers.findById('cust-1'))!.address);
  });
});

describe('pagination', () => {
  it('returns a pagination envelope on list endpoints', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/devices?page=1&limit=5');

    expect(res.body.data).toHaveLength(5);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 5 });
    expect(res.body.pagination.total).toBeGreaterThan(5);
  });

  it('returns a different slice on page 2', async () => {
    const first = await as(ACCOUNTS.dealerAdmin).get('/api/devices?page=1&limit=5');
    const second = await as(ACCOUNTS.dealerAdmin).get('/api/devices?page=2&limit=5');

    const ids = (r: { body: { data: Device[] } }) => r.body.data.map((d) => d.id);
    expect(ids(second)).not.toEqual(ids(first));
    expect(ids(second).some((id) => ids(first).includes(id))).toBe(false);
  });

  it('rejects a nonsensical page size', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/devices?limit=100000');
    expect(res.status).toBe(422);
  });
});

describe('error handling', () => {
  it('returns 404 with a clean body for an unknown route', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it('does not leak a stack trace on a validation failure', async () => {
    const res = await as(ACCOUNTS.dealerStaff).post('/api/payments').send({ amount: 'not-a-number' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+|node_modules/);
  });
});
