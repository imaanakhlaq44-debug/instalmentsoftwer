import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { disconnectDatabase } from '../../src/db/prisma.js';
import { resetAndSeedPostgres } from '../../src/db/seedPostgres.js';
import { repo, indexBy, groupBy } from '../../src/db/repositories/index.js';
import { Device, Payment } from '../../src/types/index.js';

/**
 * The seeded fixture is read-only for these tests, so it is loaded once rather
 * than per case — seeding 25 devices with six installments each is the slowest
 * thing in the suite.
 */
beforeAll(async () => {
  await resetAndSeedPostgres();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

describe('seeding', () => {
  it('loads the whole demo dataset', async () => {
    expect(await repo.dealers.count()).toBe(5);
    expect(await repo.customers.count()).toBe(20);
    expect(await repo.devices.count()).toBe(25);
    expect(await repo.installments.count()).toBe(150);
    expect(await repo.users.count()).toBe(5);
  });

  it('keeps money as whole rupees', async () => {
    const plan = await repo.installmentPlans.findById('plan-1');
    expect(Number.isInteger(plan!.financedAmount)).toBe(true);
    expect(plan!.financedAmount).toBe(40_500);
  });

  it('returns due dates as plain calendar dates', async () => {
    const installment = await repo.installments.findById('inst-1-1');
    expect(installment!.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('dealer scoping', () => {
  it('restricts a list to one dealer', async () => {
    const page = await repo.devices.list({ dealerId: 'dealer-1', limit: 100 });

    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data.every((d) => d.dealerId === 'dealer-1')).toBe(true);
    expect(page.total).toBe(page.data.length);
  });

  it('returns every dealer when the scope is null', async () => {
    const page = await repo.devices.list({ dealerId: null, limit: 100 });
    const seen = new Set(page.data.map((d) => d.dealerId));

    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('device queries', () => {
  it('filters by status in SQL', async () => {
    const page = await repo.devices.list({ dealerId: null, status: 'LOCKED', limit: 100 });

    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data.every((d) => d.status === 'LOCKED')).toBe(true);
  });

  it('treats ALL as no filter', async () => {
    const all = await repo.devices.list({ dealerId: null, status: 'ALL', limit: 100 });
    expect(all.total).toBe(25);
  });

  it('matches a brand case-insensitively', async () => {
    const page = await repo.devices.list({ dealerId: null, brand: 'samsung', limit: 100 });

    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data.every((d) => d.brand === 'Samsung')).toBe(true);
  });

  it('searches the model', async () => {
    const page = await repo.devices.list({ dealerId: null, search: 'galaxy', limit: 100 });

    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data.every((d) => /galaxy/i.test(d.model))).toBe(true);
  });

  it('searches through the customer relation, not just the device columns', async () => {
    const customer = await repo.customers.findById('cust-1');
    const page = await repo.devices.list({ dealerId: null, search: customer!.name, limit: 100 });

    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data.every((d) => d.customerId === 'cust-1')).toBe(true);
  });

  it('finds a device by IMEI', async () => {
    const known = await repo.devices.findById('dev-1');
    const found = await repo.devices.findByImei(known!.imei);

    expect(found!.id).toBe('dev-1');
  });

  it('counts by status in one grouped query', async () => {
    const counts = await repo.devices.countByStatus('dealer-1');
    const listed = await repo.devices.list({ dealerId: 'dealer-1', limit: 200 });

    const expected: Record<string, number> = {};
    for (const d of listed.data) expected[d.status] = (expected[d.status] ?? 0) + 1;

    expect(counts).toEqual(expected);
  });

  it('excludes removed devices from the licence count', async () => {
    const before = await repo.devices.countActiveForDealer('dealer-1');
    await repo.devices.update('dev-1', { status: 'REMOVED' });

    expect(await repo.devices.countActiveForDealer('dealer-1')).toBe(before - 1);

    await repo.devices.update('dev-1', { status: 'ACTIVE' });
  });
});

describe('customer queries', () => {
  it('finds a duplicate by CNIC', async () => {
    const existing = await repo.customers.findById('cust-1');

    const duplicate = await repo.customers.findDuplicate({
      dealerId: 'dealer-1',
      cnic: existing!.cnic,
      phone: '0300-0000000',
    });

    expect(duplicate!.id).toBe('cust-1');
  });

  it('finds a duplicate by phone', async () => {
    const existing = await repo.customers.findById('cust-1');

    const duplicate = await repo.customers.findDuplicate({
      dealerId: 'dealer-1',
      cnic: '00000-0000000-0',
      phone: existing!.phone,
    });

    expect(duplicate!.id).toBe('cust-1');
  });

  it('ignores the record being edited', async () => {
    const existing = await repo.customers.findById('cust-1');

    const duplicate = await repo.customers.findDuplicate({
      dealerId: 'dealer-1',
      cnic: existing!.cnic,
      phone: existing!.phone,
      excludeId: 'cust-1',
    });

    expect(duplicate).toBeUndefined();
  });

  it('does not treat another dealer\'s customer as a duplicate', async () => {
    const existing = await repo.customers.findById('cust-1');

    const duplicate = await repo.customers.findDuplicate({
      dealerId: 'dealer-2',
      cnic: existing!.cnic,
      phone: existing!.phone,
    });

    expect(duplicate).toBeUndefined();
  });

  it('narrows to a single customer for a self-service login', async () => {
    const page = await repo.customers.list({ dealerId: 'dealer-1', customerId: 'cust-1', limit: 100 });

    expect(page.total).toBe(1);
    expect(page.data[0].id).toBe('cust-1');
  });
});

describe('user queries', () => {
  it('matches an email case-insensitively', async () => {
    const user = await repo.users.findByEmail('  TARIQ@AlMadinaMobiles.PK ');
    expect(user!.id).toBe('user-dealer-admin-1');
  });

  it('returns undefined for an unknown email', async () => {
    expect(await repo.users.findByEmail('nobody@nowhere.pk')).toBeUndefined();
    expect(await repo.users.findByEmail('   ')).toBeUndefined();
  });
});

describe('plan and installment queries', () => {
  it('returns a plan\'s installments in order', async () => {
    const rows = await repo.installments.findByPlan('plan-1');

    expect(rows).toHaveLength(6);
    expect(rows.map((i) => i.installmentNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('finds only plans a payment could be applied to', async () => {
    const open = await repo.installmentPlans.findOpenForCustomer('cust-1');

    expect(open.length).toBeGreaterThan(0);
    expect(open.every((p) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED')).toBe(true);
  });

  it('finds overdue installments by grace date', async () => {
    const asOf = new Date(Date.UTC(2026, 7, 17));
    const rows = await repo.installments.findOverdueAsOf(asOf, 'dealer-1');

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((i) => i.status !== 'PAID')).toBe(true);
    expect(rows.every((i) => i.graceDate < '2026-08-17')).toBe(true);
  });

  it('sums plan totals in SQL', async () => {
    const totals = await repo.installmentPlans.totals('dealer-1');
    const plans = await repo.installmentPlans.list({ dealerId: 'dealer-1', limit: 200 });

    const expected = plans.data.reduce((s, p) => s + p.financedAmount, 0);
    expect(totals.financed).toBe(expected);
  });
});

describe('payment queries', () => {
  it('finds an existing payment by reference', async () => {
    const known = await repo.payments.findById('pay-dp-1');
    const found = await repo.payments.findByReference(known!.dealerId, known!.referenceNumber);

    expect(found!.id).toBe('pay-dp-1');
  });

  it('ignores a reversed payment when guarding against duplicates', async () => {
    const known = await repo.payments.findById('pay-dp-2');
    await repo.payments.update('pay-dp-2', { reversedAt: '2026-08-17T00:00:00.000Z' });

    expect(await repo.payments.findByReference(known!.dealerId, known!.referenceNumber)).toBeUndefined();

    await repo.payments.update('pay-dp-2', { reversedAt: undefined });
  });

  it('issues the first receipt number when none exist', async () => {
    expect(await repo.payments.nextReceiptNumber('dealer-5', 2026)).toBe('RCP-2026-000001');
  });

  it('continues from the highest receipt number already issued', async () => {
    await repo.payments.update('pay-dp-1', { receiptNumber: 'RCP-2026-000007' });

    expect(await repo.payments.nextReceiptNumber('dealer-1', 2026)).toBe('RCP-2026-000008');

    await repo.payments.update('pay-dp-1', { receiptNumber: undefined });
  });

  it('sums totals over the whole filter, not one page', async () => {
    const where = { dealerId: 'dealer-1' };
    const totals = await repo.payments.totals(where);
    const page = await repo.payments.list({ dealerId: 'dealer-1', page: 1, limit: 5 });

    expect(page.data).toHaveLength(5);
    expect(totals.count).toBe(page.total);
    expect(totals.count).toBeGreaterThan(5);
  });

  it('counts verified money without the reversed rows', async () => {
    const totals = await repo.payments.totals({ dealerId: 'dealer-1' });
    const all = await repo.payments.list({ dealerId: 'dealer-1', limit: 500 });

    const expected = all.data
      .filter((p: Payment) => p.status === 'VERIFIED' && !p.reversedAt)
      .reduce((s, p) => s + p.amount, 0);

    expect(totals.verifiedAmount).toBe(expected);
  });
});

describe('enrollment token cleanup', () => {
  it('expires only tokens past their expiry', async () => {
    const before = await repo.enrollmentTokens.findById('tok-1');
    expect(before!.status).toBe('WAITING');

    // The seeded token expires two days after the fixture's "now".
    const notYet = await repo.enrollmentTokens.expireStale(new Date('2026-08-17T06:00:00.000Z'));
    expect(notYet).toBe(0);

    const expired = await repo.enrollmentTokens.expireStale(new Date('2026-08-25T00:00:00.000Z'));
    expect(expired).toBe(1);
    expect((await repo.enrollmentTokens.findById('tok-1'))!.status).toBe('EXPIRED');

    await repo.enrollmentTokens.update('tok-1', { status: 'WAITING' });
  });
});

describe('join helpers', () => {
  it('indexes a fetched list by id', async () => {
    const rows = await repo.customers.findByIds(['cust-1', 'cust-2']);
    const map = indexBy(rows, (c) => c.id);

    expect(map.size).toBe(2);
    expect(map.get('cust-1')!.id).toBe('cust-1');
  });

  it('groups a fetched list one-to-many', async () => {
    const rows = await repo.devices.list({ dealerId: 'dealer-1', limit: 200 });
    const map = groupBy(rows.data, (d: Device) => d.customerId);

    const total = [...map.values()].reduce((s, list) => s + list.length, 0);
    expect(total).toBe(rows.data.length);
  });

  it('returns nothing for an empty id list without querying', async () => {
    expect(await repo.customers.findByIds([])).toEqual([]);
    expect(await repo.devices.findByIds([])).toEqual([]);
  });
});
