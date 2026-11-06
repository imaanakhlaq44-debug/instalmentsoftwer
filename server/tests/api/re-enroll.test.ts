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
 * A recovery-mode wipe erases the lock app, and Factory Reset Protection sends
 * the phone back to the shop. The record still says ACTIVE, so the shop needs
 * a way to put it back to PENDING and show a fresh QR.
 */
async function qrFor(deviceId: string) {
  return as(ACCOUNTS.dealerStaff).post('/api/enrollment/generate').send({ deviceId, qrType: 'STANDARD' });
}

async function enrol(deviceId: string) {
  const qr = await qrFor(deviceId);
  expect(qr.status).toBe(201);
  const res = await anonymous().post('/api/dpc/enroll').send({ token: qr.body.token.token, dpcVersion: '1.1.0' });
  expect(res.status).toBe(201);
  return `Device ${res.body.deviceId}.${res.body.deviceToken}`;
}

async function enrolledDevice() {
  const device = (await repo.devices.findFirst({ dealerId: 'dealer-1', status: 'PENDING', noLock: false }))!;
  const credential = await enrol(device.id);
  return { deviceId: device.id, credential };
}

function reEnroll(deviceId: string, account = ACCOUNTS.dealerAdmin) {
  return as(account).post(`/api/devices/${deviceId}/re-enroll`).send({ reason: 'Phone was reset from recovery mode' });
}

describe('POST /api/devices/:id/re-enroll', () => {
  it('an enrolled phone is refused a new QR until it is set for re-enrolment', async () => {
    const { deviceId } = await enrolledDevice();
    expect((await qrFor(deviceId)).status).toBe(400);

    const res = await reEnroll(deviceId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.isOnline).toBe(false);

    expect((await qrFor(deviceId)).status).toBe(201);
  });

  it('drops the wiped installation\'s credential', async () => {
    const { deviceId, credential } = await enrolledDevice();
    expect((await anonymous().get('/api/dpc/policy').set('Authorization', credential)).status).toBe(200);

    await reEnroll(deviceId);

    expect((await anonymous().get('/api/dpc/policy').set('Authorization', credential)).status).toBe(401);
  });

  it('enrols again on the same lock, spending nothing', async () => {
    const { deviceId } = await enrolledDevice();
    const before = await repo.deviceLicenses.countAvailable('dealer-1');

    await reEnroll(deviceId);
    const credential = await enrol(deviceId);

    expect((await repo.devices.findById(deviceId))!.status).toBe('ACTIVE');
    expect(await repo.deviceLicenses.countAvailable('dealer-1')).toBe(before);
    expect((await anonymous().get('/api/dpc/policy').set('Authorization', credential)).status).toBe(200);
  });

  it('works on a locked phone and clears its queued command', async () => {
    const { deviceId } = await enrolledDevice();
    await repo.devices.update(deviceId, { status: 'LOCKED', pendingCommand: 'UNLOCK', pendingCommandAt: new Date().toISOString() });

    expect((await reEnroll(deviceId)).status).toBe(200);
    const device = (await repo.devices.findById(deviceId))!;
    expect(device.status).toBe('PENDING');
    expect(device.pendingCommand).toBeUndefined();
  });

  it('is logged on the device timeline and in the audit trail', async () => {
    const { deviceId } = await enrolledDevice();
    await reEnroll(deviceId);

    const actions = await as(ACCOUNTS.dealerAdmin).get(`/api/devices/${deviceId}/actions`);
    expect(JSON.stringify(actions.body)).toMatch(/re-enrolment.*recovery mode/i);
    const audit = await repo.auditLogs.findFirst({ action: 'DEVICE_RE_ENROLL', targetId: deviceId });
    expect(audit).toBeTruthy();
  });

  it('refuses a phone that is already waiting for its scan', async () => {
    const device = (await repo.devices.findFirst({ dealerId: 'dealer-1', status: 'PENDING' }))!;
    const res = await reEnroll(device.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already waiting/i);
  });

  it('needs a dealer admin, and only for the dealer\'s own phones', async () => {
    const { deviceId } = await enrolledDevice();
    expect((await reEnroll(deviceId, ACCOUNTS.dealerStaff)).status).toBe(403);
    // Another shop is not told the phone exists.
    expect((await reEnroll(deviceId, ACCOUNTS.otherDealerAdmin)).status).toBe(404);
  });
});
