import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase, prisma } from '../../src/db/prisma.js';
import { hashDeviceToken } from '../../src/utils/deviceToken.js';

/**
 * A phone the shop took back and sells to someone else.
 *
 * The IMEI used to be unique across every device ever registered, so the old
 * record blocked the new sale for good. Now the owner closes the old
 * registration — the phone is released, the old plan stops, nothing is
 * deleted — and the same IMEI registers again.
 */

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

const FREE_IMEI = '359871080012348';

/** A financed, managed phone from the fixture, with a credential its app could use. */
async function financedDevice() {
  const plan = (await repo.installmentPlans.findFirst({ dealerId: 'dealer-1', status: 'CURRENT' }))!;
  const token = 'reregister-test-token-0123456789abcdefghij';
  await repo.devices.update(plan.deviceId, { status: 'ACTIVE', authTokenHash: hashDeviceToken(token) });
  const device = (await repo.devices.findById(plan.deviceId))!;
  return { plan, device, credential: `Device ${device.id}.${token}` };
}

const status = (imei: string, account: string = ACCOUNTS.dealerAdmin) =>
  as(account).get(`/api/devices/imei-status/${imei}`);

const close = (deviceId: string, last4: string, account: string = ACCOUNTS.dealerAdmin) =>
  as(account)
    .post(`/api/devices/${deviceId}/close-registration`)
    .send({ reason: 'Phone taken back from the customer', confirmImeiLast4: last4 });

const saleOf = (imei: string) => ({
  customer: {
    name: 'Second Owner',
    phone: '0300-7776655',
    cnic: '35202-1112223-5',
    address: 'House 12, Resale Street, Johar Town, Lahore',
    emergencyContactName: 'Second Contact',
    emergencyContactPhone: '0300-9998877',
  },
  device: { brand: 'Tecno', model: 'Spark 20', imei, purchasePrice: 30_000 },
  plan: { downPayment: 6_000, totalInstallments: 6, firstDueDate: '2026-12-20', gracePeriodDays: 3 },
});

describe('GET /api/devices/imei-status/:imei', () => {
  it('says a new IMEI is free', async () => {
    const res = await status(FREE_IMEI).expect(200);
    expect(res.body).toEqual({ registered: false });
  });

  it('shows the owner the old registration and lets them close it', async () => {
    const { device, plan } = await financedDevice();
    const res = await status(device.imei).expect(200);
    expect(res.body).toMatchObject({
      registered: true,
      sameShop: true,
      canClose: true,
      device: { id: device.id, brand: device.brand, status: 'ACTIVE', plan: { remainingBalance: plan.remainingBalance } },
    });
    expect(res.body.device.customerName).toBeTruthy();
  });

  it('is closed to staff, who no longer make sales', async () => {
    const { device } = await financedDevice();
    expect((await status(device.imei, ACCOUNTS.dealerStaff)).status).toBe(403);
  });

  it('tells another shop only that the IMEI is taken', async () => {
    const { device } = await financedDevice();
    const res = await status(device.imei, ACCOUNTS.otherDealerAdmin).expect(200);
    expect(res.body).toEqual({ registered: true, sameShop: false, canClose: false });
  });

  it('is closed to customers and refuses a malformed IMEI', async () => {
    const { device } = await financedDevice();
    expect((await status(device.imei, ACCOUNTS.customer)).status).toBe(403);
    expect((await status('12345')).status).toBe(400);
  });
});

describe('POST /api/devices/:id/close-registration', () => {
  it('refuses a sale on a registered IMEI with a code the form can act on', async () => {
    const { device } = await financedDevice();
    const res = await as(ACCOUNTS.dealerAdmin).post('/api/customers').send(saleOf(device.imei));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IMEI_REGISTERED');
  });

  it('closes the registration: phone released, plan cancelled, history kept', async () => {
    const { device, plan, credential } = await financedDevice();

    const res = await close(device.id, device.imei.slice(-4)).expect(200);
    expect(res.body.outstandingAtClose).toBe(plan.remainingBalance + (plan.outstandingLateFees ?? 0));

    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.status).toBe('INACTIVE');
    expect(stored.retiredAt).toBeTruthy();
    expect(stored.imei).toBe(device.imei);

    expect((await repo.installmentPlans.findById(plan.id))!.status).toBe('CANCELLED');
    // Nothing financial is removed.
    expect(await prisma.installment.count({ where: { planId: plan.id } })).toBeGreaterThan(0);

    // The phone's app is told it is no longer managed and steps down.
    const checkIn = await anonymous().get('/api/dpc/policy').set('Authorization', credential);
    expect(checkIn.status).toBe(403);

    const audit = await repo.auditLogs.findFirst({ action: 'DEVICE_REGISTRATION_CLOSED', targetId: device.id });
    expect(audit?.details).toMatch(/Phone taken back/);
  });

  it('lets the same IMEI be sold again, and keeps both records', async () => {
    const { device } = await financedDevice();
    await close(device.id, device.imei.slice(-4)).expect(200);

    expect((await status(device.imei).expect(200)).body).toEqual({ registered: false });

    const sale = await as(ACCOUNTS.dealerAdmin).post('/api/customers').send(saleOf(device.imei));
    expect(sale.status).toBe(201);

    const rows = await prisma.device.findMany({ where: { imei: device.imei }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.retiredAt === null)).toHaveLength(1);

    // The new registration is the live one now.
    const now = (await status(device.imei).expect(200)).body;
    expect(now.registered).toBe(true);
    expect(now.device.id).not.toBe(device.id);
  });

  it('still allows only one live registration per IMEI in the database', async () => {
    const { device } = await financedDevice();
    await expect(
      prisma.device.create({ data: { ...(await prisma.device.findUniqueOrThrow({ where: { id: device.id } })), id: 'dup-live-device' } })
    ).rejects.toThrow();
  });

  it('needs the last 4 IMEI digits, the shop owner, and the same shop', async () => {
    const { device } = await financedDevice();
    const wrong = device.imei.slice(-4) === '0000' ? '1111' : '0000';
    expect((await close(device.id, wrong)).status).toBe(400);
    expect((await close(device.id, device.imei.slice(-4), ACCOUNTS.dealerStaff)).status).toBe(403);
    expect((await close(device.id, device.imei.slice(-4), ACCOUNTS.otherDealerAdmin)).status).toBe(404);
    expect((await repo.devices.findById(device.id))!.retiredAt).toBeFalsy();
  });

  it('cannot close twice, and a closed record takes no new QR or IMEI edit', async () => {
    const { device } = await financedDevice();
    await close(device.id, device.imei.slice(-4)).expect(200);

    expect((await close(device.id, device.imei.slice(-4))).status).toBe(409);
    const reEnroll = await as(ACCOUNTS.dealerAdmin).post(`/api/devices/${device.id}/re-enroll`).send({ reason: 'Customer factory reset it' });
    expect(reEnroll.status).toBe(400);
    expect(reEnroll.body.error).toMatch(/closed/i);
  });

  it('takes the cancelled plan out of the dashboard figures', async () => {
    const { device, plan } = await financedDevice();
    const before = (await as(ACCOUNTS.dealerAdmin).get('/api/dashboard/stats').expect(200)).body;
    await close(device.id, device.imei.slice(-4)).expect(200);
    const after = (await as(ACCOUNTS.dealerAdmin).get('/api/dashboard/stats').expect(200)).body;
    expect(after.outstandingAmount).toBe(before.outstandingAmount - plan.remainingBalance);
  });
});
