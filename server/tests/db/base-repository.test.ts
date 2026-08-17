import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { prisma, disconnectDatabase, runInTransaction } from '../../src/db/prisma.js';
import { makeRepository } from '../../src/db/repositories/base.js';
import { Dealer, Customer, Installment } from '../../src/types/index.js';

const dealers = makeRepository<Dealer>('dealer');
const customers = makeRepository<Customer>('customer');
const installments = makeRepository<Installment>('installment');

const DEALER: Dealer = {
  id: 'repo-dealer-1',
  name: 'Repository Test Dealer',
  code: 'RTD-LHR',
  ownerName: 'Test Owner',
  email: 'owner@repotest.pk',
  phone: '0300-1112233',
  city: 'Lahore',
  address: 'Shop 1, Test Plaza, Lahore',
  licenseKeyId: 'repo-lic-1',
  active: true,
  createdAt: '2026-01-10T10:00:00.000Z',
};

function customer(id: string, overrides: Partial<Customer> = {}): Customer {
  return {
    id,
    dealerId: DEALER.id,
    name: `Customer ${id}`,
    phone: '0300-4445566',
    cnic: `35202-000000${id.slice(-1)}-1`,
    address: 'House 1, Test Street, Lahore',
    emergencyContactName: 'Emergency Contact',
    emergencyContactPhone: '0300-7778899',
    active: true,
    createdAt: '2026-02-01T10:00:00.000Z',
    ...overrides,
  };
}

/** Truncates everything, then reinstates the one dealer these tests hang off. */
async function resetTables(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      installments, installment_plans, payments, transactions,
      device_action_logs, devices, enrollment_tokens, notifications,
      audit_logs, customers, users, device_policies, license_keys, dealers
    RESTART IDENTITY CASCADE
  `);
  await dealers.create(DEALER);
}

beforeEach(resetTables);

afterAll(async () => {
  await disconnectDatabase();
});

describe('create and read', () => {
  it('round-trips a record through the database', async () => {
    const created = await customers.create(customer('repo-cust-1'));

    expect(created.id).toBe('repo-cust-1');
    expect(await customers.findById('repo-cust-1')).toEqual(created);
  });

  it('returns undefined for an id that does not exist', async () => {
    expect(await customers.findById('no-such-id')).toBeUndefined();
    expect(await customers.findById('')).toBeUndefined();
  });

  it('omits absent optional fields rather than returning null', async () => {
    const created = await customers.create(customer('repo-cust-1'));

    expect('notes' in created).toBe(false);
    expect(created.notes).toBeUndefined();
  });

  it('preserves an ISO timestamp exactly', async () => {
    const created = await customers.create(customer('repo-cust-1'));
    expect(created.createdAt).toBe('2026-02-01T10:00:00.000Z');
  });

  it('inserts many rows in one statement', async () => {
    const count = await customers.createMany([
      customer('repo-cust-1'),
      customer('repo-cust-2'),
      customer('repo-cust-3'),
    ]);

    expect(count).toBe(3);
    expect(await customers.count()).toBe(3);
  });
});

describe('date-only columns', () => {
  it('round-trips due dates as YYYY-MM-DD with no timezone shift', async () => {
    await customers.create(customer('repo-cust-1'));

    // An installment needs a plan, which needs a device; go straight to raw SQL
    // to keep this test about date conversion rather than about fixtures.
    await prisma.$executeRawUnsafe(`
      INSERT INTO devices (id, dealer_id, customer_id, brand, model, imei, serial_number,
        color, ram_storage, purchase_price, status, last_seen, battery_level, is_online,
        os_version, security_patch, created_at, updated_at)
      VALUES ('repo-dev-1', '${DEALER.id}', 'repo-cust-1', 'Samsung', 'A16',
        '359871080012348', 'SN1', 'Black', '8GB / 128GB', 60000, 'ACTIVE', now(), 90, true,
        'Android 14', '2026-06-01', now(), now())
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO installment_plans (id, dealer_id, customer_id, device_id, total_amount,
        down_payment, financed_amount, monthly_installment, total_installments,
        paid_installments, remaining_balance, first_due_date, grace_period_days, status, created_at)
      VALUES ('repo-plan-1', '${DEALER.id}', 'repo-cust-1', 'repo-dev-1', 60000, 12000, 48000,
        8000, 6, 0, 48000, DATE '2026-09-20', 3, 'CURRENT', now())
    `);

    const created = await installments.create({
      id: 'repo-inst-1',
      planId: 'repo-plan-1',
      dealerId: DEALER.id,
      customerId: 'repo-cust-1',
      installmentNumber: 1,
      amountDue: 8_000,
      amountPaid: 0,
      dueDate: '2026-09-20',
      graceDate: '2026-09-23',
      status: 'PENDING',
      createdAt: '2026-08-17T10:00:00.000Z',
    });

    expect(created.dueDate).toBe('2026-09-20');
    expect(created.graceDate).toBe('2026-09-23');

    const reread = await installments.findById('repo-inst-1');
    expect(reread!.dueDate).toBe('2026-09-20');
  });
});

describe('update', () => {
  beforeEach(async () => {
    await customers.create(customer('repo-cust-1', { notes: 'Original note.' }));
  });

  it('applies a partial update and leaves other columns alone', async () => {
    const updated = await customers.update('repo-cust-1', { name: 'Renamed' });

    expect(updated!.name).toBe('Renamed');
    expect(updated!.notes).toBe('Original note.');
  });

  it('clears a column when the key is present with undefined', async () => {
    const updated = await customers.update('repo-cust-1', { notes: undefined });

    expect(updated!.notes).toBeUndefined();
    expect('notes' in updated!).toBe(false);
  });

  it('returns undefined instead of throwing for a missing row', async () => {
    expect(await customers.update('no-such-id', { name: 'x' })).toBeUndefined();
  });
});

describe('delete', () => {
  it('reports whether a row was actually removed', async () => {
    await customers.create(customer('repo-cust-1'));

    expect(await customers.delete('repo-cust-1')).toBe(true);
    expect(await customers.delete('repo-cust-1')).toBe(false);
  });
});

describe('paginate', () => {
  beforeEach(async () => {
    await customers.createMany(
      Array.from({ length: 12 }, (_, i) =>
        customer(`repo-cust-${i + 1}`, {
          name: `Customer ${String(i + 1).padStart(2, '0')}`,
          cnic: `35202-000000${i}-1`,
        })
      )
    );
  });

  it('returns one page and the total for the whole filtered set', async () => {
    const page = await customers.paginate({ page: 1, limit: 5, orderBy: { name: 'asc' } });

    expect(page.data).toHaveLength(5);
    expect(page.total).toBe(12);
    expect(page.data[0].name).toBe('Customer 01');
  });

  it('does not overlap page 2 with page 1', async () => {
    const first = await customers.paginate({ page: 1, limit: 5, orderBy: { name: 'asc' } });
    const second = await customers.paginate({ page: 2, limit: 5, orderBy: { name: 'asc' } });

    const firstIds = first.data.map((c) => c.id);
    expect(second.data.some((c) => firstIds.includes(c.id))).toBe(false);
  });

  it('counts the filtered set, not the table', async () => {
    const page = await customers.paginate({
      where: { name: { contains: '1' } },
      page: 1,
      limit: 100,
    });

    expect(page.total).toBe(page.data.length);
    expect(page.total).toBeLessThan(12);
  });

  it('clamps a page past the end to the last one with rows', async () => {
    // The dashboard has always behaved this way: asking for page 99 of a
    // 3-page result shows the last page rather than an empty screen. Plain
    // SQL OFFSET would return nothing, so `paginate` corrects for it.
    const page = await customers.paginate({ page: 99, limit: 5, orderBy: { name: 'asc' } });

    expect(page.total).toBe(12);
    expect(page.page).toBe(3);
    expect(page.data).toHaveLength(2);
  });

  it('reports an empty result as page 1', async () => {
    const page = await customers.paginate({ where: { name: 'no such customer' }, page: 4, limit: 5 });

    expect(page.total).toBe(0);
    expect(page.page).toBe(1);
    expect(page.data).toHaveLength(0);
  });
});

describe('transactions', () => {
  it('commits every write in the unit together', async () => {
    await runInTransaction(async (tx) => {
      await customers.create(customer('repo-cust-1'), tx);
      await customers.create(customer('repo-cust-2'), tx);
    });

    expect(await customers.count()).toBe(2);
  });

  it('rolls the whole unit back when one write fails', async () => {
    await expect(
      runInTransaction(async (tx) => {
        await customers.create(customer('repo-cust-1'), tx);
        // Same id — violates the primary key and aborts the transaction.
        await customers.create(customer('repo-cust-1'), tx);
      })
    ).rejects.toThrow();

    expect(await customers.count()).toBe(0);
  });

  it('rolls back when the callback throws after a successful write', async () => {
    await expect(
      runInTransaction(async (tx) => {
        await customers.create(customer('repo-cust-1'), tx);
        throw new Error('Business rule failed after the insert.');
      })
    ).rejects.toThrow(/business rule/i);

    expect(await customers.count()).toBe(0);
  });
});

describe('database constraints', () => {
  it('rejects a second customer with the same CNIC at one dealer', async () => {
    await customers.create(customer('repo-cust-1', { cnic: '35202-1234567-1' }));

    await expect(
      customers.create(customer('repo-cust-2', { cnic: '35202-1234567-1' }))
    ).rejects.toThrow();
  });

  it('refuses a customer whose dealer does not exist', async () => {
    await expect(
      customers.create(customer('repo-cust-1', { dealerId: 'no-such-dealer' }))
    ).rejects.toThrow();
  });
});
