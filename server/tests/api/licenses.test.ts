import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

/** A device the fixture leaves un-enrolled, plus a fresh QR for it. */
async function pendingDeviceWithToken() {
  const device = (await repo.devices.findFirst({ dealerId: 'dealer-1', status: 'PENDING' }))!;

  const res = await as(ACCOUNTS.dealerStaff)
    .post('/api/enrollment/generate')
    .send({ deviceId: device.id, qrType: 'STANDARD' });

  expect(res.status).toBe(201);
  return { device, enrollmentToken: res.body.token.token as string };
}

const availableFor = (dealerId: string) =>
  repo.deviceLicenses.countAvailable(dealerId);

/** Spends every remaining lock so the next enrolment has nothing to claim. */
async function exhaustLocks(dealerId: string) {
  await repo.deviceLicenses.updateMany(
    { dealerId, status: 'AVAILABLE' },
    { status: 'VOID' }
  );
  expect(await availableFor(dealerId)).toBe(0);
}

describe('a lock is spent at enrolment', () => {
  it('claims exactly one lock when a handset enrols', async () => {
    const before = await availableFor('dealer-1');
    const { device, enrollmentToken } = await pendingDeviceWithToken();

    const res = await anonymous().post('/api/dpc/enroll').send({ token: enrollmentToken });
    expect(res.status).toBe(201);

    expect(await availableFor('dealer-1')).toBe(before - 1);

    const license = await repo.deviceLicenses.findByDevice(device.id);
    expect(license?.status).toBe('CONSUMED');
    expect(license?.imei).toBe(device.imei);
    expect(license?.consumedAt).toBeTruthy();
  });

  it('does not spend a second lock when the same handset re-enrols', async () => {
    const { device, enrollmentToken } = await pendingDeviceWithToken();
    await anonymous().post('/api/dpc/enroll').send({ token: enrollmentToken });

    const afterFirst = await availableFor('dealer-1');
    const first = await repo.deviceLicenses.findByDevice(device.id);

    // A factory reset puts the same phone through provisioning again.
    const second = await as(ACCOUNTS.dealerStaff)
      .post('/api/enrollment/generate')
      .send({ deviceId: device.id, qrType: 'STANDARD' });

    // The device is ACTIVE now, so the counter is told to unlock it first
    // rather than being quietly charged for a fresh QR.
    if (second.status === 201) {
      const res = await anonymous()
        .post('/api/dpc/enroll')
        .send({ token: second.body.token.token });
      expect(res.status).toBe(201);
    }

    expect(await availableFor('dealer-1')).toBe(afterFirst);
    const held = await repo.deviceLicenses.findByDevice(device.id);
    expect(held?.id).toBe(first?.id);
  });

  it('refuses to enrol when the dealer has no locks left', async () => {
    const { enrollmentToken } = await pendingDeviceWithToken();
    await exhaustLocks('dealer-1');

    const res = await anonymous().post('/api/dpc/enroll').send({ token: enrollmentToken });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no device locks left/i);
  });

  it('leaves the QR usable after a refusal, so the sale survives a top-up', async () => {
    const { enrollmentToken } = await pendingDeviceWithToken();
    await exhaustLocks('dealer-1');

    await anonymous().post('/api/dpc/enroll').send({ token: enrollmentToken });

    // The platform records the dealer's payment...
    const issued = await as(ACCOUNTS.superAdmin)
      .post('/api/licenses/packs')
      .send({ dealerId: 'dealer-1', size: 30 });
    expect(issued.status).toBe(201);

    // ...and the phone the customer is holding enrols on the same code.
    const retry = await anonymous().post('/api/dpc/enroll').send({ token: enrollmentToken });
    expect(retry.status).toBe(201);
  });

  it('never returns a lock when the device is removed', async () => {
    const { device, enrollmentToken } = await pendingDeviceWithToken();
    await anonymous().post('/api/dpc/enroll').send({ token: enrollmentToken });
    const afterEnrol = await availableFor('dealer-1');

    await repo.devices.update(device.id, { status: 'INACTIVE' });

    expect(await availableFor('dealer-1')).toBe(afterEnrol);
    expect(await repo.deviceLicenses.countByStatus('dealer-1', 'CONSUMED')).toBeGreaterThan(0);
  });
});

describe('the counter is stopped before the customer is', () => {
  it('refuses a new financed sale when there are no locks left', async () => {
    await exhaustLocks('dealer-1');

    const res = await as(ACCOUNTS.dealerStaff)
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
        device: {
          brand: 'Samsung',
          model: 'Galaxy A16',
          imei: '356938035643809',
          purchasePrice: 55_000,
        },
        plan: {
          downPayment: 15_000,
          totalInstallments: 6,
          firstDueDate: '2026-09-01',
        },
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/no device locks left/i);
  });
});

describe('packs', () => {
  it('mints one lock per unit and prices the pack at the rate it was sold', async () => {
    const before = await availableFor('dealer-4');

    const res = await as(ACCOUNTS.superAdmin)
      .post('/api/licenses/packs')
      .send({ dealerId: 'dealer-4', size: 100, reference: 'HBL-99231' });

    expect(res.status).toBe(201);
    expect(res.body.pack.unitPrice).toBe(600);
    expect(res.body.pack.totalPrice).toBe(60_000);
    expect(res.body.pack.reference).toBe('HBL-99231');
    expect(await availableFor('dealer-4')).toBe(before + 100);
  });

  it('sells only the sizes on the price list', async () => {
    const res = await as(ACCOUNTS.superAdmin)
      .post('/api/licenses/packs')
      .send({ dealerId: 'dealer-1', size: 42 });

    expect(res.status).toBe(400);
  });

  it('does not let a dealer mint their own locks', async () => {
    const before = await availableFor('dealer-1');

    const res = await as(ACCOUNTS.dealerAdmin)
      .post('/api/licenses/packs')
      .send({ dealerId: 'dealer-1', size: 100 });

    expect(res.status).toBe(403);
    expect(await availableFor('dealer-1')).toBe(before);
  });

  it('keeps counter staff away from commercial data entirely', async () => {
    const res = await as(ACCOUNTS.dealerStaff).get('/api/licenses');
    expect(res.status).toBe(403);
  });

  it('reports one dealership to its owner and every dealership to the platform', async () => {
    const mine = await as(ACCOUNTS.dealerAdmin).get('/api/licenses');
    expect(mine.status).toBe(200);
    expect(mine.body.dealers).toHaveLength(1);
    expect(mine.body.dealers[0].dealerId).toBe('dealer-1');

    const all = await as(ACCOUNTS.superAdmin).get('/api/licenses');
    expect(all.body.dealers.length).toBeGreaterThan(1);
  });

  it('shows which handset each lock was spent on', async () => {
    const { device, enrollmentToken } = await pendingDeviceWithToken();
    await anonymous().post('/api/dpc/enroll').send({ token: enrollmentToken });

    const license = (await repo.deviceLicenses.findByDevice(device.id))!;
    const res = await as(ACCOUNTS.dealerAdmin).get(`/api/licenses/packs/${license.packId}`);

    expect(res.status).toBe(200);
    const spent = res.body.licenses.find((l: any) => l.id === license.id);
    expect(spent.imei).toBe(device.imei);
    expect(spent.deviceName).toContain(device.brand);
  });

  it('does not leak another dealership’s pack', async () => {
    const other = (await repo.licensePacks.findFirst({ dealerId: 'dealer-2' }))!;
    const res = await as(ACCOUNTS.dealerAdmin).get(`/api/licenses/packs/${other.id}`);
    expect(res.status).toBe(404);
  });
});
