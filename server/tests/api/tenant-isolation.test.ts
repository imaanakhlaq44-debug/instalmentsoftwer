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

/** A device and a customer that belong to dealer-2, i.e. not to dealer-1. */
async function otherDealersRecords() {
  const device = (await repo.devices.findFirst({ dealerId: 'dealer-2' }))!;
  const customer = (await repo.customers.findFirst({ dealerId: 'dealer-2' }))!;
  return { device, customer };
}

describe('list scoping', () => {
  it('shows a dealer admin only their own dealership', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/devices?limit=100');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((d: Device) => d.dealerId === 'dealer-1')).toBe(true);
  });

  it('ignores a dealerId query parameter pointing at another dealer', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/devices?dealerId=dealer-2&limit=100');

    expect(res.status).toBe(200);
    expect(res.body.data.every((d: Device) => d.dealerId === 'dealer-1')).toBe(true);
  });

  it('scopes the customer directory the same way', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/customers?dealerId=dealer-2&limit=100');

    expect(res.status).toBe(200);
    expect(res.body.data.every((c: Customer) => c.dealerId === 'dealer-1')).toBe(true);
  });

  it('lets a super admin see every dealership at once', async () => {
    const res = await as(ACCOUNTS.superAdmin).get('/api/devices?limit=100');

    const dealers = new Set(res.body.data.map((d: Device) => d.dealerId));
    expect(dealers.size).toBeGreaterThan(1);
  });

  it('lets a super admin narrow to one dealership on request', async () => {
    const res = await as(ACCOUNTS.superAdmin).get('/api/devices?dealerId=dealer-2&limit=100');

    expect(res.body.data.every((d: Device) => d.dealerId === 'dealer-2')).toBe(true);
  });

  it('shows a customer login only their own devices', async () => {
    const res = await as(ACCOUNTS.customer).get('/api/devices?limit=100');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((d: Device) => d.customerId === 'cust-1')).toBe(true);
  });

  it('shows a customer login only their own customer record', async () => {
    const res = await as(ACCOUNTS.customer).get('/api/customers?limit=100');

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('cust-1');
  });
});

describe('single-record access', () => {
  it('returns 404, not 403, for another dealer\'s device', async () => {
    const { device } = await otherDealersRecords();

    const res = await as(ACCOUNTS.dealerAdmin).get(`/api/devices/${device.id}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for another dealer\'s customer', async () => {
    const { customer } = await otherDealersRecords();

    const res = await as(ACCOUNTS.dealerAdmin).get(`/api/customers/${customer.id}`);
    expect(res.status).toBe(404);
  });

  it('refuses to lock another dealer\'s device', async () => {
    const { device } = await otherDealersRecords();

    const res = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${device.id}/lock`)
      .send({ reason: 'Testing cross-tenant lock.' });

    expect(res.status).toBe(404);
    expect((await repo.devices.findById(device.id))!.status).toBe(device.status);
  });

  it('refuses to edit another dealer\'s customer', async () => {
    const { customer } = await otherDealersRecords();

    const res = await as(ACCOUNTS.dealerAdmin)
      .patch(`/api/customers/${customer.id}`)
      .send({ name: 'Renamed By Another Dealer' });

    expect(res.status).toBe(404);
    expect((await repo.customers.findById(customer.id))!.name).toBe(customer.name);
  });

  it('stops a customer login from opening another customer\'s device', async () => {
    const foreign = (await repo.devices.findFirst({ dealerId: 'dealer-1', customerId: { not: 'cust-1' } }))!;

    const res = await as(ACCOUNTS.customer).get(`/api/devices/${foreign.id}`);
    expect(res.status).toBe(404);
  });

  it('lets a super admin reach any dealership\'s device', async () => {
    const { device } = await otherDealersRecords();

    const res = await as(ACCOUNTS.superAdmin).get(`/api/devices/${device.id}`);
    expect(res.status).toBe(200);
  });
});

describe('writes are stamped with the caller\'s dealer', () => {
  const customer = {
    name: 'Test Customer',
    phone: '0300-1112233',
    cnic: '35202-1234567-1',
    address: 'House 1, Test Street, Lahore',
    emergencyContactName: 'Test Contact',
    emergencyContactPhone: '0300-4445566',
  };

  it('refuses a dealerId in the body pointing at another dealer', async () => {
    const res = await as(ACCOUNTS.dealerStaff)
      .post('/api/customers')
      .send({ dealerId: 'dealer-2', customer });

    expect(res.status).toBe(403);
    expect(await repo.customers.findFirst({ name: customer.name })).toBeUndefined();
  });

  it('stamps a new customer with the caller\'s own dealer', async () => {
    const res = await as(ACCOUNTS.dealerStaff).post('/api/customers').send({ customer });

    expect(res.status).toBeLessThan(300);
    expect((await repo.customers.findFirst({ name: customer.name }))!.dealerId).toBe('dealer-1');
  });

  it('makes a super admin name the dealer explicitly', async () => {
    const res = await as(ACCOUNTS.superAdmin).post('/api/customers').send({ customer });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must specify which dealerId/i);
  });
});
