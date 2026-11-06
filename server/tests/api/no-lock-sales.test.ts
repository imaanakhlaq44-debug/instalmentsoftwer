import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

/**
 * A phone that cannot run the lock app (newer Huawei, iPhone, old Android) is
 * still sold on installments. The plan and ledger are kept; the handset gets no
 * QR, spends no lock and can never be sent a lock.
 */
function sale(noLock: boolean) {
  return as(ACCOUNTS.dealerStaff)
    .post('/api/customers')
    .send({
      customer: {
        name: 'Naveed Iqbal',
        phone: '0300-1112233',
        cnic: '35201-1234567-1',
        address: 'Shop 4, Hall Road, Lahore',
        emergencyContactName: 'Bilal Iqbal',
        emergencyContactPhone: '0301-4445566',
      },
      device: { brand: 'Huawei', model: 'Nova 9', imei: '356938035643809', purchasePrice: 55_000 },
      plan: { downPayment: 15_000, totalInstallments: 6, firstDueDate: '2026-12-01' },
      noLock,
    });
}

async function exhaustLocks(dealerId: string) {
  await repo.deviceLicenses.updateMany({ dealerId, status: 'AVAILABLE' }, { status: 'VOID' });
}

describe('a sale without a lock', () => {
  it('goes through with no locks left, issues no QR and spends nothing', async () => {
    await exhaustLocks('dealer-1');

    const res = await sale(true);

    expect(res.status).toBe(201);
    expect(res.body.enrollmentToken).toBeUndefined();
    expect(res.body.device.noLock).toBe(true);
    expect(res.body.installments).toHaveLength(6);
    expect(await repo.deviceLicenses.countAvailable('dealer-1')).toBe(0);
  });

  it('a normal sale still needs a lock', async () => {
    await exhaustLocks('dealer-1');
    expect((await sale(false)).status).toBe(403);
  });

  it('never gets a QR code', async () => {
    const { body } = await sale(true);

    const res = await as(ACCOUNTS.dealerStaff)
      .post('/api/enrollment/generate')
      .send({ deviceId: body.device.id, qrType: 'STANDARD' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/without a lock/i);
  });

  it('cannot be locked', async () => {
    const { body } = await sale(true);

    const res = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${body.device.id}/lock`)
      .send({ reason: 'Installment overdue for testing' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/without a lock/i);
  });

  it('is left out of the phones waiting for a QR', async () => {
    const { body } = await sale(true);

    const res = await as(ACCOUNTS.dealerStaff).get('/api/devices?status=PENDING&lockable=true&limit=100');

    expect(res.status).toBe(200);
    const ids = (res.body.data ?? res.body.devices).map((d: { id: string }) => d.id);
    expect(ids).not.toContain(body.device.id);
  });
});
