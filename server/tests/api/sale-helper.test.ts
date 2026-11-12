import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';

/**
 * The one-page sale form at the counter: what the server fills in for it, and
 * a returning customer sold another phone without retyping their details.
 */

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

const registration = {
  customer: {
    name: 'Counter Test Customer',
    phone: '0300-1112233',
    cnic: '35202-1234567-1',
    address: 'House 1, Test Street, Model Town, Lahore',
    emergencyContactName: 'Counter Contact',
    emergencyContactPhone: '0300-4445566',
  },
  device: { brand: 'Tecno', model: 'Spark 20', imei: '359871080012348', purchasePrice: 38_000, ramStorage: '8GB / 128GB' },
  plan: { downPayment: 8_000, totalInstallments: 6, firstDueDate: '2026-12-20', gracePeriodDays: 3 },
};

const helper = (cnic?: string, account: string = ACCOUNTS.dealerStaff) =>
  as(account).get(`/api/customers/sale-helper${cnic ? `?cnic=${encodeURIComponent(cnic)}` : ''}`);

describe('GET /api/customers/sale-helper', () => {
  it('finds a returning customer by CNIC, with or without dashes, by name only', async () => {
    await as(ACCOUNTS.dealerStaff).post('/api/customers').send(registration).expect(201);

    for (const cnic of ['35202-1234567-1', '3520212345671']) {
      const res = await helper(cnic).expect(200);
      expect(res.body.customer).toEqual({ name: 'Counter Test Customer', phonesOnFile: 1, overdueInstallments: 0 });
    }
    // Nothing a counter login is not allowed to see.
    const body = JSON.stringify((await helper('35202-1234567-1')).body);
    expect(body).not.toContain('Model Town');
    expect(body).not.toContain('0300-1112233');
  });

  it('answers null for an unknown or incomplete CNIC', async () => {
    expect((await helper('35202-9999999-9').expect(200)).body.customer).toBeNull();
    expect((await helper('35202').expect(200)).body.customer).toBeNull();
  });

  it("does not find another shop's customer", async () => {
    await as(ACCOUNTS.dealerStaff).post('/api/customers').send(registration).expect(201);
    expect((await helper('35202-1234567-1', ACCOUNTS.otherDealerAdmin).expect(200)).body.customer).toBeNull();
  });

  it("lists the shop's recent models once each, newest first, with the last price", async () => {
    await as(ACCOUNTS.dealerStaff).post('/api/customers').send(registration).expect(201);

    const res = await helper().expect(200);
    expect(res.body.recentModels[0]).toEqual({ brand: 'Tecno', model: 'Spark 20', ramStorage: '8GB / 128GB', price: 38_000 });
    const keys = res.body.recentModels.map((m: { brand: string; model: string }) => `${m.brand} ${m.model}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(res.body.recentModels.length).toBeLessThanOrEqual(6);
  });

  it("returns the shop's own grace period", async () => {
    const policy = (await repo.devicePolicies.findByDealer('dealer-1'))!;
    await repo.devicePolicies.update(policy.id, { gracePeriodDays: 5 });
    expect((await helper().expect(200)).body.gracePeriodDays).toBe(5);
  });

  it('is for shop logins only', async () => {
    await helper(undefined, ACCOUNTS.customer).expect(403);
  });
});

describe('selling a returning customer another phone without their details', () => {
  it('needs only the CNIC and the name on file', async () => {
    const first = await as(ACCOUNTS.dealerStaff).post('/api/customers').send(registration).expect(201);

    const res = await as(ACCOUNTS.dealerStaff)
      .post('/api/customers')
      .send({
        customer: { name: 'Counter Test Customer', cnic: '3520212345671' },
        device: { ...registration.device, imei: '490154203237518' },
        plan: registration.plan,
      })
      .expect(201);

    expect(res.body.customer.id).toBe(first.body.customer.id);
    // The record on file is kept as it was.
    const onFile = (await repo.customers.findById(first.body.customer.id))!;
    expect(onFile.address).toBe(registration.customer.address);
    expect(onFile.phone).toBe('0300-1112233');
  });

  it('still asks a new customer for every contact box, naming each one', async () => {
    const res = await as(ACCOUNTS.dealerStaff)
      .post('/api/customers')
      .send({ customer: { name: 'Brand New Buyer', cnic: '35202-7654321-9' }, device: registration.device, plan: registration.plan })
      .expect(422);

    expect(res.body.details.map((d: { field: string }) => d.field)).toEqual([
      'customer.phone',
      'customer.address',
      'customer.emergencyContactName',
      'customer.emergencyContactPhone',
    ]);
    expect(await repo.devices.findByImei(registration.device.imei)).toBeUndefined();
  });
});
