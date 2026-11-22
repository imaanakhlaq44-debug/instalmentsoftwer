import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { hashDeviceToken } from '../../src/utils/deviceToken.js';
import { offlineUnlockCode, normaliseChallenge } from '../../src/services/OfflineUnlockCode.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

/** Enrols a pending fixture device and returns its id and handset credential. */
async function enrolledDevice() {
  const device = (await repo.devices.findFirst({ dealerId: 'dealer-1', status: 'PENDING' }))!;
  const qr = await as(ACCOUNTS.dealerStaff)
    .post('/api/enrollment/generate')
    .send({ deviceId: device.id, qrType: 'STANDARD' });
  expect(qr.status).toBe(201);

  const res = await anonymous().post('/api/dpc/enroll').send({ token: qr.body.token.token, dpcVersion: '1.7.0' });
  expect(res.status).toBe(201);
  const credential = `Device ${res.body.deviceId}.${res.body.deviceToken}`;
  const done = await anonymous()
    .post('/api/dpc/check-in')
    .set('Authorization', credential)
    .send({ isDeviceOwner: true, setupComplete: true });
  expect(done.status).toBe(200);
  return { deviceId: device.id as string, deviceToken: res.body.deviceToken as string };
}

describe('offline unlock code — the algorithm', () => {
  it('matches the fixed vector the Android app is tested against', () => {
    // Same vector as android/dpc/src/test/.../OfflineUnlockTest.kt.
    const tokenHash = hashDeviceToken('test-device-token');
    expect(tokenHash).toBe('fdc2f4194f79710d879d596f606d94f5e85f07f53b42d2b13f2e9aeb74d78c39');
    expect(offlineUnlockCode(tokenHash, 'dev-1', '12345678')).toBe('03478775');
    expect(offlineUnlockCode(tokenHash, 'dev-1', '00000000')).toBe('64068132');
  });

  it('accepts the phone code with spaces or a dash, and nothing else', () => {
    expect(normaliseChallenge('1234 5678')).toBe('12345678');
    expect(normaliseChallenge('1234-5678')).toBe('12345678');
    expect(normaliseChallenge('1234567')).toBeNull();
    expect(normaliseChallenge('1234567a')).toBeNull();
  });
});

describe('POST /api/devices/:id/offline-unlock-code', () => {
  it('gives the shop owner the code the handset will accept', async () => {
    const { deviceId, deviceToken } = await enrolledDevice();

    const res = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${deviceId}/offline-unlock-code`)
      .send({ challenge: '1234 5678' });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(offlineUnlockCode(hashDeviceToken(deviceToken), deviceId, '12345678'));

    const logs = await repo.auditLogs.findMany({ where: { targetId: deviceId } });
    expect(logs.some((l) => l.details.includes('Offline unlock code issued'))).toBe(true);
  });

  it('refuses while the dashboard still wants the phone locked', async () => {
    const { deviceId } = await enrolledDevice();
    const lock = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${deviceId}/lock`)
      .send({ reason: 'Installment overdue by 30 days' });
    expect(lock.status).toBe(200);

    const res = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${deviceId}/offline-unlock-code`)
      .send({ challenge: '12345678' });
    expect(res.status).toBe(409);
  });

  it('is for the shop owner only, and only for their own phones', async () => {
    const { deviceId } = await enrolledDevice();

    const staff = await as(ACCOUNTS.dealerStaff)
      .post(`/api/devices/${deviceId}/offline-unlock-code`)
      .send({ challenge: '12345678' });
    expect(staff.status).toBe(403);

    const other = await as(ACCOUNTS.otherDealerAdmin)
      .post(`/api/devices/${deviceId}/offline-unlock-code`)
      .send({ challenge: '12345678' });
    expect(other.status).toBe(404);
  });

  it('refuses a phone that never registered with the lock app', async () => {
    const device = (await repo.devices.findFirst({ dealerId: 'dealer-1', status: 'PENDING' }))!;
    const res = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${device.id}/offline-unlock-code`)
      .send({ challenge: '12345678' });
    expect(res.status).toBe(400);
  });

  it('rejects a phone code that is not eight digits', async () => {
    const { deviceId } = await enrolledDevice();
    const res = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${deviceId}/offline-unlock-code`)
      .send({ challenge: '1234567x' });
    expect(res.status).toBe(400);
  });
});
