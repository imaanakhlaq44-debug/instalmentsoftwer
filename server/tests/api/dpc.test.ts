import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { hashDeviceToken } from '../../src/utils/deviceToken.js';
import { Device } from '../../src/types/index.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

/**
 * A device the fixture leaves un-enrolled, plus a fresh QR for it. This is the
 * state a phone is in when the counter hands it to the customer.
 */
async function pendingDeviceWithToken() {
  const device = (await repo.devices.findFirst({ dealerId: 'dealer-1', status: 'PENDING' }))!;

  const res = await as(ACCOUNTS.dealerStaff)
    .post('/api/enrollment/generate')
    .send({ deviceId: device.id, qrType: 'STANDARD' });

  expect(res.status).toBe(201);
  return { device, enrollmentToken: res.body.token.token as string };
}

/** Runs enrollment and returns the credential the handset would keep. */
async function enrolledDevice() {
  const { device, enrollmentToken } = await pendingDeviceWithToken();

  const res = await anonymous()
    .post('/api/dpc/enroll')
    .send({ token: enrollmentToken, dpcVersion: '2.4.0' });

  expect(res.status).toBe(201);
  return {
    deviceId: device.id,
    credential: `Device ${res.body.deviceId}.${res.body.deviceToken}`,
    body: res.body,
  };
}

describe('POST /api/dpc/enroll', () => {
  it('redeems the QR and issues the handset its own credentials', async () => {
    const { body, deviceId } = await enrolledDevice();

    expect(body.deviceId).toBe(deviceId);
    expect(body.deviceToken).toEqual(expect.any(String));
    expect(body.deviceToken.length).toBeGreaterThan(30);
    expect(body.checkInIntervalSeconds).toBeGreaterThan(0);
  });

  it('stores only the hash of the token, never the token', async () => {
    const { deviceId, body } = await enrolledDevice();

    const stored = (await repo.devices.findById(deviceId))!;
    expect(stored.authTokenHash).toBe(hashDeviceToken(body.deviceToken));
    expect(JSON.stringify(stored)).not.toContain(body.deviceToken);
  });

  it('brings the device under management', async () => {
    const { deviceId } = await enrolledDevice();

    const stored = (await repo.devices.findById(deviceId))!;
    expect(stored.status).toBe('ACTIVE');
    expect(stored.dpcVersion).toBe('2.4.0');
  });

  it('refuses a QR that has already been redeemed', async () => {
    const { enrollmentToken } = await pendingDeviceWithToken();

    expect((await anonymous().post('/api/dpc/enroll').send({ token: enrollmentToken })).status).toBe(201);

    const second = await anonymous().post('/api/dpc/enroll').send({ token: enrollmentToken });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/already been used/i);
  });

  it('refuses an invented code', async () => {
    const res = await anonymous().post('/api/dpc/enroll').send({ token: 'EMIS-STA-NOTAREALTOKEN0000' });
    expect(res.status).toBe(400);
  });

  it('rotates the credential when a handset re-enrolls', async () => {
    const first = await enrolledDevice();

    // A factory reset sends the phone back for a new QR.
    await repo.devices.update(first.deviceId, { status: 'PENDING' });
    const regenerated = await as(ACCOUNTS.dealerStaff)
      .post('/api/enrollment/generate')
      .send({ deviceId: first.deviceId, qrType: 'STANDARD' });

    const second = await anonymous()
      .post('/api/dpc/enroll')
      .send({ token: regenerated.body.token.token });

    expect(second.body.deviceToken).not.toBe(first.body.deviceToken);

    // The credential the old installation held must stop working.
    const stale = await anonymous().get('/api/dpc/policy').set('Authorization', first.credential);
    expect(stale.status).toBe(401);
  });
});

describe('device authentication', () => {
  it('rejects a request with no credential', async () => {
    expect((await anonymous().get('/api/dpc/policy')).status).toBe(401);
  });

  it('rejects a malformed credential', async () => {
    for (const header of ['Device', 'Device nodot', 'Device .justtoken', 'Device deviceonly.', 'Bearer abc.def']) {
      const res = await anonymous().get('/api/dpc/policy').set('Authorization', header);
      expect(res.status).toBe(401);
    }
  });

  it('rejects a valid token presented for a different device', async () => {
    const { body } = await enrolledDevice();
    const other = (await repo.devices.findFirst({ dealerId: 'dealer-2' }))!;

    const res = await anonymous()
      .get('/api/dpc/policy')
      .set('Authorization', `Device ${other.id}.${body.deviceToken}`);

    expect(res.status).toBe(401);
  });

  it('rejects a device that was never enrolled', async () => {
    const device = (await repo.devices.findFirst({ dealerId: 'dealer-1', status: 'PENDING' }))!;

    const res = await anonymous()
      .get('/api/dpc/policy')
      .set('Authorization', `Device ${device.id}.anything-at-all`);

    expect(res.status).toBe(401);
  });

  it('gives the same answer for an unknown device as for a wrong token', async () => {
    const { deviceId } = await enrolledDevice();

    const wrongToken = await anonymous()
      .get('/api/dpc/policy')
      .set('Authorization', `Device ${deviceId}.wrong-token-entirely`);
    const unknownDevice = await anonymous()
      .get('/api/dpc/policy')
      .set('Authorization', 'Device dev-does-not-exist.some-token');

    expect(wrongToken.status).toBe(401);
    expect(unknownDevice.body.error).toBe(wrongToken.body.error);
  });

  it('stops honouring the credential once the device is removed', async () => {
    const { deviceId, credential } = await enrolledDevice();

    expect((await anonymous().get('/api/dpc/policy').set('Authorization', credential)).status).toBe(200);

    await repo.devices.update(deviceId, { status: 'REMOVED' });

    const res = await anonymous().get('/api/dpc/policy').set('Authorization', credential);
    expect(res.status).toBe(403);
  });

  it('does not let a device credential reach the dashboard API', async () => {
    const { credential } = await enrolledDevice();

    const res = await anonymous().get('/api/devices').set('Authorization', credential);
    expect(res.status).toBe(401);
  });

  it('does not let a staff token drive the DPC API', async () => {
    const staff = await as(ACCOUNTS.dealerAdmin).get('/api/auth/me');
    const jwt = staff.body.token;

    const res = await anonymous().get('/api/dpc/policy').set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/dpc/check-in', () => {
  it('records the telemetry the handset reports', async () => {
    const { deviceId, credential } = await enrolledDevice();

    const res = await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({
        batteryLevel: 42,
        osVersion: 'Android 15',
        simCarrier: 'Jazz 4G',
        location: { lat: 31.52, lng: 74.35 },
      });

    expect(res.status).toBe(200);

    const stored = (await repo.devices.findById(deviceId))!;
    expect(stored.batteryLevel).toBe(42);
    expect(stored.osVersion).toBe('Android 15');
    expect(stored.simCarrier).toBe('Jazz 4G');
    expect(stored.isOnline).toBe(true);
    expect(stored.lastCheckInAt).toBeTruthy();
  });

  it('leaves unreported fields alone', async () => {
    const { deviceId, credential } = await enrolledDevice();
    const before = (await repo.devices.findById(deviceId))!;

    await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send({ batteryLevel: 10 });

    const after = (await repo.devices.findById(deviceId))!;
    expect(after.osVersion).toBe(before.osVersion);
    expect(after.batteryLevel).toBe(10);
  });

  it('reports no command when none is waiting', async () => {
    const { credential } = await enrolledDevice();

    const res = await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send({});
    expect(res.body.command).toBeNull();
  });

  it('never returns another dealership\'s data', async () => {
    const { credential } = await enrolledDevice();

    const res = await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send({});
    const payload = JSON.stringify(res.body);

    expect(payload).not.toContain('dealer-2');
    expect(payload).not.toMatch(/imei/i);
    expect(payload).not.toMatch(/cnic/i);
    expect(payload).not.toMatch(/authTokenHash/);
  });
});

/**
 * The heart of the protocol: a lock is only real once the handset says so.
 */
describe('offline lock, delivered on the next check-in', () => {
  async function lockedWhileOffline() {
    const enrolled = await enrolledDevice();
    // A phone that has gone off the network.
    await repo.devices.update(enrolled.deviceId, { isOnline: false });

    const res = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${enrolled.deviceId}/lock`)
      .send({ reason: 'Installment overdue by nine days.' });

    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(true);
    expect(res.body.status).toBe('LOCK_PENDING');

    return enrolled;
  }

  it('queues the lock rather than claiming it took effect', async () => {
    const { deviceId } = await lockedWhileOffline();

    const stored = (await repo.devices.findById(deviceId))!;
    expect(stored.status).toBe('LOCK_PENDING');
    expect(stored.pendingCommand).toBe('LOCK');
  });

  it('hands the command to the phone at check-in without applying it', async () => {
    const { deviceId, credential } = await lockedWhileOffline();

    const res = await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send({});

    expect(res.body.command).toMatchObject({ type: 'LOCK' });
    // Still pending: the phone has been told, but has not confirmed.
    expect(res.body.status).toBe('LOCK_PENDING');
    expect((await repo.devices.findById(deviceId))!.status).toBe('LOCK_PENDING');
  });

  it('applies the lock only once the handset acknowledges it', async () => {
    const { deviceId, credential } = await lockedWhileOffline();

    await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send({});

    const ack = await anonymous()
      .post('/api/dpc/commands/ack')
      .set('Authorization', credential)
      .send({ command: 'LOCK', applied: true });

    expect(ack.status).toBe(200);
    expect(ack.body.status).toBe('LOCKED');

    const stored = (await repo.devices.findById(deviceId))!;
    expect(stored.status).toBe('LOCKED');
    expect(stored.pendingCommand).toBeUndefined();
  });

  it('keeps the command queued when the handset reports it failed', async () => {
    const { deviceId, credential } = await lockedWhileOffline();

    const ack = await anonymous()
      .post('/api/dpc/commands/ack')
      .set('Authorization', credential)
      .send({ command: 'LOCK', applied: false, error: 'Device admin permission was revoked.' });

    expect(ack.status).toBe(200);
    expect(ack.body.commandCleared).toBe(false);

    const stored = (await repo.devices.findById(deviceId))!;
    expect(stored.status).toBe('LOCK_PENDING');
    expect(stored.pendingCommand).toBe('LOCK');

    // The reason is on the device's timeline for support to read.
    const logs = await repo.deviceActionLogs.findByDevice(deviceId);
    expect(logs.some((l) => (l.reason ?? '').includes('permission was revoked'))).toBe(true);
  });

  it('serves the lock screen its real figures once locked', async () => {
    const { deviceId, credential } = await lockedWhileOffline();
    await anonymous()
      .post('/api/dpc/commands/ack')
      .set('Authorization', credential)
      .send({ command: 'LOCK', applied: true });

    const res = await anonymous().get('/api/dpc/policy').set('Authorization', credential);

    expect(res.body.policy.locked).toBe(true);
    expect(res.body.policy.lockMessage).toBeTruthy();
    expect(res.body.policy.contact.dealerName).toBe('Al-Madina Mobile Hub');
    expect(res.body.policy.paymentMethods.length).toBeGreaterThan(0);
    expect(typeof res.body.policy.amountDue).toBe('number');

    // Nothing invented: the figure matches what the plan actually shows.
    const plan = await repo.installmentPlans.findByDevice(deviceId);
    const installments = plan ? await repo.installments.findByPlan(plan.id) : [];
    const overdue = installments
      .filter((i) => i.status === 'OVERDUE')
      .reduce((s, i) => s + Math.max(0, i.amountDue - i.amountPaid) + Math.max(0, (i.lateFee ?? 0) - (i.lateFeePaid ?? 0)), 0);
    expect(res.body.policy.amountDue).toBe(overdue);
  });
});

describe('POST /api/dpc/commands/ack — guards', () => {
  it('refuses an acknowledgement when nothing is queued', async () => {
    const { credential } = await enrolledDevice();

    const res = await anonymous()
      .post('/api/dpc/commands/ack')
      .set('Authorization', credential)
      .send({ command: 'LOCK', applied: true });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no command waiting/i);
  });

  it('refuses an acknowledgement for the wrong command', async () => {
    const enrolled = await enrolledDevice();
    await repo.devices.update(enrolled.deviceId, { isOnline: false });
    await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${enrolled.deviceId}/lock`)
      .send({ reason: 'Installment overdue by nine days.' });

    const res = await anonymous()
      .post('/api/dpc/commands/ack')
      .set('Authorization', enrolled.credential)
      .send({ command: 'UNLOCK', applied: true });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/waiting command is LOCK/i);
  });
});

describe('the dashboard never exposes the device credential', () => {
  it('omits authTokenHash from the device list', async () => {
    await enrolledDevice();

    const res = await as(ACCOUNTS.dealerAdmin).get('/api/devices?limit=100');
    expect(JSON.stringify(res.body)).not.toMatch(/authTokenHash/);
  });

  it('omits authTokenHash from the device detail', async () => {
    const { deviceId } = await enrolledDevice();

    const res = await as(ACCOUNTS.dealerAdmin).get(`/api/devices/${deviceId}`);
    expect(res.status).toBe(200);
    expect(res.body.authTokenHash).toBeUndefined();

    // The hash really is stored — this is masking, not an empty column.
    const stored = (await repo.devices.findById(deviceId)) as Device;
    expect(stored.authTokenHash).toBeTruthy();
  });
});
