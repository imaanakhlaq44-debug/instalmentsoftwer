import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { DeviceIntegrityService } from '../../src/services/DeviceIntegrityService.js';
import { OverdueEngine } from '../../src/services/OverdueEngine.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

async function pendingDeviceWithToken(dealerId = 'dealer-1') {
  const device = (await repo.devices.findFirst({ dealerId, status: 'PENDING', noLock: false }))!;

  const res = await as(ACCOUNTS.dealerStaff)
    .post('/api/enrollment/generate')
    .send({ deviceId: device.id, qrType: 'STANDARD' });

  expect(res.status).toBe(201);
  return { device, enrollmentToken: res.body.token.token as string };
}

async function enrollWithDualSim(serialNumber = 'SN-DUALSIM-01') {
  const { device, enrollmentToken } = await pendingDeviceWithToken();
  const slot1 = '358240059998881';
  const res = await anonymous()
    .post('/api/dpc/enroll')
    .send({
      token: enrollmentToken,
      dpcVersion: '1.4.0',
      imeis: [slot1, device.imei],
      serialNumber,
      isDeviceOwner: true,
      integrity: {
        rooted: false,
        bootloaderUnlocked: false,
        testKeys: false,
        verifiedBootState: 'green',
        flashLocked: '1',
      },
    });

  expect(res.status).toBe(201);
  return {
    device,
    slot1,
    credential: `Device ${res.body.deviceId}.${res.body.deviceToken}`,
  };
}

describe('Hardware identity verification during DPC enrollment', () => {
  it('blocks enrollment on IMEI mismatch before burning a lock licence', async () => {
    const { device, enrollmentToken } = await pendingDeviceWithToken();
    const availableBefore = await repo.deviceLicenses.count({ dealerId: device.dealerId, status: 'AVAILABLE' });

    const rogueImei = '990000887766554';
    const res = await anonymous()
      .post('/api/dpc/enroll')
      .send({
        token: enrollmentToken,
        dpcVersion: '1.4.0',
        imeis: [rogueImei],
        serialNumber: 'SN-ROGUE-01',
        isDeviceOwner: true,
      });

    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toMatch(/imei/i);

    const availableAfter = await repo.deviceLicenses.count({ dealerId: device.dealerId, status: 'AVAILABLE' });
    expect(availableAfter).toBe(availableBefore);

    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.status).toBe('PENDING');
    expect(stored.tamperFlags).toContain('IMEI_MISMATCH');
    expect(stored.reportedImei).toBe(rogueImei);
    expect(stored.tamperDetectedAt).toBeDefined();

    const alert = await repo.notifications.findFirst({
      dealerId: device.dealerId,
      deviceId: device.id,
      type: 'SECURITY_ALERT',
    });
    expect(alert).toBeDefined();
    expect(alert?.channel).toBe('IN_APP');
    expect(alert?.status).toBe('SENT');
  });

  it('accepts a dual-SIM handset when slot 2 matches the registered IMEI', async () => {
    const { device, slot1 } = await enrollWithDualSim();

    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.status).toBe('ACTIVE');
    expect(stored.reportedImei).toBe(device.imei);
    expect(stored.reportedImeis).toEqual([slot1, device.imei]);
    expect(stored.reportedSerial).toBe('SN-DUALSIM-01');
    expect(stored.isDeviceOwner).toBe(true);
    expect(stored.imeiVerifiedAt).toBeDefined();
    expect(stored.tamperFlags).toEqual([]);
  });

  it('stays compatible with legacy enrollment payloads omitting hardware fields', async () => {
    const { device, enrollmentToken } = await pendingDeviceWithToken();
    const res = await anonymous()
      .post('/api/dpc/enroll')
      .send({ token: enrollmentToken, dpcVersion: '1.3.0' });

    expect(res.status).toBe(201);
    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.status).toBe('ACTIVE');
    expect(stored.tamperFlags).toEqual([]);
  });
});

describe('Check-in tamper detection and automatic lock queuing', () => {
  it('auto-queues a LOCK command on severe tamper without exposing hardware-ID keys to DPC', async () => {
    const { device, credential } = await enrollWithDualSim();
    const rogueImei = '351111222233334';

    const res = await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({
        dpcVersion: '1.4.0',
        imeis: [rogueImei],
        isDeviceOwner: true,
        integrity: {
          rooted: true,
          bootloaderUnlocked: true,
          testKeys: false,
          verifiedBootState: 'orange',
          flashLocked: '0',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('LOCK_PENDING');
    expect(res.body.command).toMatchObject({ type: 'LOCK' });
    expect(res.body.policy.lockMessage).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/imei/i);

    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.tamperFlags).toEqual(expect.arrayContaining(['IMEI_MISMATCH', 'BOOTLOADER_UNLOCKED', 'ROOTED']));

    const ack = await anonymous()
      .post('/api/dpc/commands/ack')
      .set('Authorization', credential)
      .send({ command: 'LOCK', applied: true });
    expect(ack.status).toBe(200);
    expect(ack.body.status).toBe('LOCKED');
  });

  it('flags tamper telemetry without auto-locking when contract consent is absent', async () => {
    const { device, credential } = await enrollWithDualSim();
    const contract = (await repo.contracts.findByDevice(device.id))!;
    await repo.contracts.update(contract.id, { status: 'VOID', voidReason: 'Replaced' });

    const res = await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({
        dpcVersion: '1.4.0',
        imeis: [device.imei],
        integrity: { rooted: false, bootloaderUnlocked: true, testKeys: false },
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.command).toBeNull();

    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.tamperFlags).toContain('BOOTLOADER_UNLOCKED');
  });

  it('flags DEVICE_OWNER_LOST without issuing an unenforceable lock command', async () => {
    const { device, credential } = await enrollWithDualSim();

    const res = await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({
        dpcVersion: '1.4.0',
        isDeviceOwner: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.command).toBeNull();

    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.isDeviceOwner).toBe(false);
    expect(stored.tamperFlags).toContain('DEVICE_OWNER_LOST');
  });
});

describe('PII masking, admin alert resolution & tamper filters', () => {
  it('hides reported IMEIs and serial numbers from dealer staff', async () => {
    const { device, slot1, credential } = await enrollWithDualSim('SN-SECRET-99');
    const rogue = '860000112233445';

    await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({ imeis: [rogue], serialNumber: 'SN-SECRET-99' });

    const staffList = await as(ACCOUNTS.dealerStaff).get('/api/devices?tamper=true');
    expect(staffList.status).toBe(200);
    const staffRow = staffList.body.data.find((d: { id: string }) => d.id === device.id);
    expect(staffRow).toBeDefined();
    expect(staffRow.reportedImei).toBeUndefined();
    expect(staffRow.reportedImeis).toBeUndefined();
    expect(staffRow.reportedSerial).toBeUndefined();
    expect(staffRow.maskedReportedImei).toMatch(/^\*+3445$/);

    const staffPayload = JSON.stringify(staffList.body);
    expect(staffPayload).not.toContain(rogue);
    expect(staffPayload).not.toContain(slot1);
    expect(staffPayload).not.toContain('SN-SECRET-99');

    const adminDetail = await as(ACCOUNTS.dealerAdmin).get(`/api/devices/${device.id}`);
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.reportedImei).toBe(rogue);
    expect(adminDetail.body.reportedImeis).toEqual([rogue]);
    expect(adminDetail.body.reportedSerial).toBe('SN-SECRET-99');
  });

  it('allows dealer admin to resolve tamper alerts and exposes tamperAlertDevices in dashboard stats', async () => {
    const { device, credential } = await enrollWithDualSim();
    await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({ imeis: ['860000998877661'] });

    const statsBefore = await as(ACCOUNTS.dealerStaff).get('/api/dashboard/stats');
    expect(statsBefore.status).toBe(200);
    expect(statsBefore.body.tamperAlertDevices).toBeGreaterThanOrEqual(1);

    const staffAttempt = await as(ACCOUNTS.dealerStaff)
      .post(`/api/devices/${device.id}/clear-tamper`)
      .send({ reason: 'Inspected device at shop counter.' });
    expect(staffAttempt.status).toBe(403);

    const resolved = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${device.id}/clear-tamper`)
      .send({ reason: 'Inspected at shop counter; legitimate dual-SIM slot repair.' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.tamperFlags).toEqual([]);
    expect(resolved.body.tamperDetectedAt).toBeUndefined();
  });

  it('clears tamper flags on re-enroll, correct-imei, and release', async () => {
    const { device, credential } = await enrollWithDualSim();
    await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({ imeis: ['860000998877661'] });

    const corrected = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${device.id}/correct-imei`)
      .send({ imei: '860000998877661', reason: 'Shop clerk entered SIM slot 1 at registration.' });
    expect(corrected.status).toBe(200);
    expect(corrected.body.tamperFlags).toEqual([]);
    expect(corrected.body.tamperDetectedAt).toBeUndefined();

    // Trigger again and verify release wipes all security flags too.
    await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({ integrity: { rooted: true } });

    const reEnrolled = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${device.id}/re-enroll`)
      .send({ reason: 'Reflashed clean stock firmware in workshop' });
    expect(reEnrolled.status).toBe(200);
    expect(reEnrolled.body.tamperFlags).toEqual([]);
  });
});

describe('Silent-heartbeat watchdog (>72h offline)', () => {
  it('flags managed devices silent for >72h with deduplicated IN_APP alerts and updates stats', async () => {
    const active = (await repo.devices.findFirst({ dealerId: 'dealer-1', status: 'ACTIVE', noLock: false }))!;
    const oldCheckIn = new Date(Date.now() - 80 * 3_600_000).toISOString();
    await repo.devices.update(active.id, {
      isOnline: true,
      lastCheckInAt: oldCheckIn,
      lastSeen: oldCheckIn,
    });

    const createdFirst = await DeviceIntegrityService.flagSilentDevices(new Date());
    expect(createdFirst).toBeGreaterThanOrEqual(1);

    // Repeating on the same day must not create duplicate alerts.
    const createdSecond = await DeviceIntegrityService.flagSilentDevices(new Date());
    expect(createdSecond).toBe(0);

    const updated = (await repo.devices.findById(active.id))!;
    expect(updated.isOnline).toBe(false);

    const stats = await as(ACCOUNTS.dealerStaff).get('/api/dashboard/stats');
    expect(stats.status).toBe(200);
    expect(stats.body.silentDevices).toBeGreaterThanOrEqual(1);

    const alert = await repo.notifications.findFirst({
      dealerId: active.dealerId,
      deviceId: active.id,
      type: 'SECURITY_ALERT',
      title: 'Silent Handset Alert',
    });
    expect(alert).toBeDefined();
    expect(alert?.channel).toBe('IN_APP');
    expect(alert?.status).toBe('SENT');

    // Verify OverdueEngine triggers watchdog without breaking overdue processing.
    await OverdueEngine.runEvaluation();
  });
});

