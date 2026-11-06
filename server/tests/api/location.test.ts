import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

/**
 * Location for recovering a phone. Asked for by an owner, only for a locked or
 * overdue phone whose signed agreement allows it, answered once, and logged.
 */

const SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const FIX = { lat: 31.5204, lng: 74.3587, accuracy: 25 };

async function setPolicy(updates: Record<string, unknown>) {
  const res = await as(ACCOUNTS.dealerAdmin).put('/api/settings/policy').send(updates);
  expect(res.status).toBe(200);
}

function imeiFrom(base14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    let digit = Number(base14[i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return base14 + String((10 - (sum % 10)) % 10);
}

let counter = 0;

/** A fresh sale, connected, with its agreement signed under the policy now in force. */
async function signedPhone(sign = true) {
  const unique = String((Number(Date.now().toString().slice(-7)) + counter++) % 10_000_000).padStart(7, '0');
  const sale = await as(ACCOUNTS.dealerStaff)
    .post('/api/customers')
    .send({
      customer: {
        name: 'Test Buyer',
        phone: `0300${unique}`,
        cnic: `35201-${unique}-3`,
        address: '12 Ferozepur Road, Lahore',
        emergencyContactName: 'Next of Kin',
        emergencyContactPhone: `0301${unique}`,
      },
      device: { brand: 'Infinix', model: 'Hot 40', imei: imeiFrom(`35${unique}90123`.slice(0, 14)), purchasePrice: 60000 },
      plan: { downPayment: 12000, totalInstallments: 6, firstDueDate: '2026-09-05', gracePeriodDays: 3 },
    });
  expect(sale.status).toBe(201);
  const deviceId = sale.body.device.id as string;

  const qr = await as(ACCOUNTS.dealerStaff).post('/api/enrollment/generate').send({ deviceId, qrType: 'STANDARD' });
  const enrolled = await anonymous().post('/api/dpc/enroll').send({ token: qr.body.token.token, dpcVersion: '1.3.0' });
  expect(enrolled.status).toBe(201);

  if (sign) {
    const contract = (await repo.contracts.findByDevice(deviceId))!;
    const res = await as(ACCOUNTS.dealerStaff)
      .post(`/api/contracts/${contract.id}/sign`)
      .send({ signerName: 'Test Buyer', signatureImage: SIGNATURE, declarationAccepted: true });
    expect(res.status).toBe(200);
  }

  return { deviceId, credential: `Device ${enrolled.body.deviceId}.${enrolled.body.deviceToken}` };
}

async function checkIn(credential: string, body: Record<string, unknown> = {}) {
  const res = await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send(body);
  expect(res.status).toBe(200);
  return res.body;
}

const ask = (deviceId: string, account: string = ACCOUNTS.dealerAdmin) =>
  as(account).post(`/api/devices/${deviceId}/location-request`).send({ reason: 'Customer stopped answering calls' });

describe('location for recovery', () => {
  it('a locked phone is asked once, answers once, and the owner sees it', async () => {
    await setPolicy({ locationOnRecoveryEnabled: true });
    const { deviceId, credential } = await signedPhone();
    await repo.devices.update(deviceId, { status: 'LOCKED' });

    expect((await checkIn(credential)).policy.reportLocation).toBe(false);
    expect((await ask(deviceId)).status).toBe(200);
    expect((await checkIn(credential)).policy.reportLocation).toBe(true);

    // The phone answers; the request closes.
    const answered = await checkIn(credential, { location: { ...FIX, capturedAt: new Date().toISOString() } });
    expect(answered.policy.reportLocation).toBe(false);

    const view = await as(ACCOUNTS.dealerAdmin).get(`/api/devices/${deviceId}/location`);
    expect(view.status).toBe(200);
    expect(view.body.location).toMatchObject({ lat: FIX.lat, lng: FIX.lng, accuracy: FIX.accuracy });
    expect(await repo.auditLogs.findFirst({ action: 'LOCATION_REQUESTED', targetId: deviceId })).toBeTruthy();
    expect(await repo.auditLogs.findFirst({ action: 'LOCATION_VIEWED', targetId: deviceId })).toBeTruthy();
  });

  it('never puts coordinates in an ordinary device response', async () => {
    await setPolicy({ locationOnRecoveryEnabled: true });
    const { deviceId, credential } = await signedPhone();
    await repo.devices.update(deviceId, { status: 'LOCKED' });
    await ask(deviceId);
    await checkIn(credential, { location: FIX });

    const res = await as(ACCOUNTS.dealerAdmin).get(`/api/devices/${deviceId}`);
    expect(JSON.stringify(res.body)).not.toMatch(/locationLat|74\.3587/);
  });

  it('drops a location nobody asked for', async () => {
    await setPolicy({ locationOnRecoveryEnabled: true });
    const { deviceId, credential } = await signedPhone();
    await repo.devices.update(deviceId, { status: 'LOCKED' });

    await checkIn(credential, { location: FIX });
    expect((await repo.devices.findById(deviceId))!.locationLat).toBeUndefined();
  });

  it('refuses a customer who is up to date', async () => {
    await setPolicy({ locationOnRecoveryEnabled: true });
    const { deviceId } = await signedPhone();

    const res = await ask(deviceId);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/locked or overdue/i);
  });

  it('refuses a customer whose agreement was signed while location was off', async () => {
    const { deviceId } = await signedPhone();
    await setPolicy({ locationOnRecoveryEnabled: true });
    await repo.devices.update(deviceId, { status: 'LOCKED' });

    const res = await ask(deviceId);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not allow location/i);
  });

  it('refuses while the shop has it turned off', async () => {
    await setPolicy({ locationOnRecoveryEnabled: true });
    const { deviceId } = await signedPhone();
    await setPolicy({ locationOnRecoveryEnabled: false });
    await repo.devices.update(deviceId, { status: 'LOCKED' });

    expect((await ask(deviceId)).status).toBe(400);
  });

  it('closes an open request once the customer is up to date again', async () => {
    await setPolicy({ locationOnRecoveryEnabled: true });
    const { deviceId, credential } = await signedPhone();
    await repo.devices.update(deviceId, { status: 'LOCKED' });
    await ask(deviceId);

    await repo.devices.update(deviceId, { status: 'ACTIVE' });
    expect((await checkIn(credential)).policy.reportLocation).toBe(false);
  });

  it('is for owners only', async () => {
    await setPolicy({ locationOnRecoveryEnabled: true });
    const { deviceId } = await signedPhone();
    await repo.devices.update(deviceId, { status: 'LOCKED' });

    expect((await ask(deviceId, ACCOUNTS.dealerStaff)).status).toBe(403);
    expect((await as(ACCOUNTS.dealerStaff).get(`/api/devices/${deviceId}/location`)).status).toBe(403);
    expect((await ask(deviceId, ACCOUNTS.otherDealerAdmin)).status).toBe(404);
  });

  it('forgets the location when the phone is released', async () => {
    await setPolicy({ locationOnRecoveryEnabled: true });
    const { deviceId, credential } = await signedPhone();
    await repo.devices.update(deviceId, { status: 'LOCKED' });
    await ask(deviceId);
    await checkIn(credential, { location: FIX });

    await as(ACCOUNTS.dealerAdmin).post(`/api/devices/${deviceId}/release`).send({ reason: 'Paid in cash at the shop' });
    expect((await repo.devices.findById(deviceId))!.locationLat).toBeUndefined();
  });

  it('is written into the agreement the customer signs', async () => {
    await setPolicy({ locationOnRecoveryEnabled: true });
    const { deviceId } = await signedPhone(false);
    const contract = (await repo.contracts.findByDevice(deviceId))!;

    const doc = await as(ACCOUNTS.dealerAdmin).get(`/api/contracts/${contract.id}`);
    expect(doc.status).toBe(200);
    expect(JSON.stringify(doc.body)).toMatch(/current location in order to recover it/);
  });
});
