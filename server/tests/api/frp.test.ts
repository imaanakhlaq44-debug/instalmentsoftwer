import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { hashDeviceToken } from '../../src/utils/deviceToken.js';

const DEALER_GOOGLE_ID = '118223344556677889900';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

/** An enrolled dealer-1 handset with a plan on it, and the credential it would hold. */
async function financedDevice() {
  const plan = (await repo.installmentPlans.findFirst({ dealerId: 'dealer-1', status: 'CURRENT' }))!;
  const token = 'frp-test-token-0123456789abcdefghijklmnop';
  await repo.devices.update(plan.deviceId, { status: 'ACTIVE', authTokenHash: hashDeviceToken(token) });
  return { plan, credential: `Device ${plan.deviceId}.${token}` };
}

async function setFrp(ids: unknown) {
  return as(ACCOUNTS.dealerAdmin).put('/api/settings/policy').send({ frpAccountIds: ids });
}

describe('PUT /api/settings/policy — frpAccountIds', () => {
  it('stores numeric Google account ids, de-duplicated', async () => {
    const res = await setFrp([DEALER_GOOGLE_ID, DEALER_GOOGLE_ID]);
    expect(res.status).toBe(200);
    expect(res.body.policy.frpAccountIds).toEqual([DEALER_GOOGLE_ID]);
  });

  it('rejects an email address, which would lock a wiped phone out for everyone', async () => {
    const res = await setFrp(['dealer@gmail.com']);
    expect(res.status).toBe(422);
    expect((await repo.devicePolicies.findByDealer('dealer-1'))?.frpAccountIds ?? []).toEqual([]);
  });

  it('records the change in the audit trail', async () => {
    await setFrp([DEALER_GOOGLE_ID]);
    const logs = await repo.auditLogs.findMany({ where: { dealerId: 'dealer-1' } });
    expect(logs.some((l) => /Factory Reset Protection/.test(l.details))).toBe(true);
  });

  it('is off by default', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/settings');
    expect(res.body.policy.frpAccountIds ?? []).toEqual([]);
  });
});

describe('DPC policy view — frpAccountIds', () => {
  it('sends the dealer accounts to a handset that still owes money', async () => {
    await setFrp([DEALER_GOOGLE_ID]);
    const { credential } = await financedDevice();

    const res = await anonymous().get('/api/dpc/policy').set('Authorization', credential);
    expect(res.status).toBe(200);
    expect(res.body.policy.frpAccountIds).toEqual([DEALER_GOOGLE_ID]);
  });

  it('sends none once the plan is paid off, so the phone drops the protection', async () => {
    await setFrp([DEALER_GOOGLE_ID]);
    const { plan, credential } = await financedDevice();
    for (const inst of await repo.installments.findByPlan(plan.id)) {
      await repo.installments.update(inst.id, { status: 'PAID', amountPaid: inst.amountDue });
    }

    const res = await anonymous().get('/api/dpc/policy').set('Authorization', credential);
    expect(res.body.policy.frpAccountIds).toEqual([]);
  });

  it('sends none when the dealer has not configured it', async () => {
    const { credential } = await financedDevice();
    const res = await anonymous().get('/api/dpc/policy').set('Authorization', credential);
    expect(res.body.policy.frpAccountIds).toEqual([]);
  });
});

describe('DPC FRP verification telemetry & refusal handling', () => {
  it('stores ACTIVE and LEGACY verification telemetry and clears prior errors on ACTIVE', async () => {
    const { plan, credential } = await financedDevice();

    const legacyRes = await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({
        dpcVersion: '1.5.1',
        frp: {
          status: 'LEGACY',
          detail: 'Play Services legacy restriction (Android 8-10)',
          verifiedAccountsCount: 1,
        },
      });
    expect(legacyRes.status).toBe(200);

    let stored = (await repo.devices.findById(plan.deviceId))!;
    expect(stored.frpStatus).toBe('LEGACY');
    expect(stored.frpError).toBe('Play Services legacy restriction (Android 8-10)');
    expect(stored.frpVerifiedAt).toBeDefined();

    const activeRes = await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({
        dpcVersion: '1.5.1',
        frp: {
          status: 'ACTIVE',
          verifiedAccountsCount: 1,
        },
      });
    expect(activeRes.status).toBe(200);

    stored = (await repo.devices.findById(plan.deviceId))!;
    expect(stored.frpStatus).toBe('ACTIVE');
    expect(stored.frpError).toBeUndefined();
    expect(stored.frpVerifiedAt).toBeDefined();
  });

  it('alerts shop on REFUSED without flagging tamper or auto-locking, and deduplicates repeat check-ins', async () => {
    const { plan, credential } = await financedDevice();

    const first = await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({
        dpcVersion: '1.5.1',
        frp: {
          status: 'REFUSED',
          detail: 'OEM ROM dropped FactoryResetProtectionPolicy after readback',
          verifiedAccountsCount: 0,
        },
      });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('ACTIVE');
    expect(first.body.command).toBeNull();

    const stored = (await repo.devices.findById(plan.deviceId))!;
    expect(stored.frpStatus).toBe('REFUSED');
    expect(stored.frpError).toContain('dropped FactoryResetProtectionPolicy');
    expect(stored.tamperFlags ?? []).toEqual([]);
    expect(stored.status).toBe('ACTIVE');

    // Second check-in while still REFUSED does not emit another notification
    await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({
        dpcVersion: '1.5.1',
        frp: { status: 'REFUSED', detail: 'Still refused', verifiedAccountsCount: 0 },
      });

    const alerts = await repo.notifications.findMany({
      where: { dealerId: 'dealer-1', deviceId: plan.deviceId, title: 'Reset Protection Refused' },
    });
    expect(alerts).toHaveLength(1);
  });

  it('records REFUSED alert at enrollment and clears FRP columns on re-enroll and release', async () => {
    const pending = (await repo.devices.findFirst({ dealerId: 'dealer-1', status: 'PENDING', noLock: false }))!;
    const genRes = await as(ACCOUNTS.dealerStaff)
      .post('/api/enrollment/generate')
      .send({ deviceId: pending.id, qrType: 'STANDARD' });
    expect(genRes.status).toBe(201);

    const enrollRes = await anonymous()
      .post('/api/dpc/enroll')
      .send({
        token: genRes.body.token.token,
        dpcVersion: '1.5.1',
        isDeviceOwner: true,
        frp: { status: 'REFUSED', detail: 'Play Services disabled', verifiedAccountsCount: 0 },
      });
    expect(enrollRes.status).toBe(201);

    let stored = (await repo.devices.findById(pending.id))!;
    expect(stored.frpStatus).toBe('REFUSED');
    expect(stored.frpError).toBe('Play Services disabled');

    const alerts = await repo.notifications.findMany({
      where: { dealerId: 'dealer-1', deviceId: pending.id, title: 'Reset Protection Refused' },
    });
    expect(alerts).toHaveLength(1);

    const reEnrollRes = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${pending.id}/re-enroll`)
      .send({ reason: 'Customer wiped phone and came back' });
    expect(reEnrollRes.status).toBe(200);

    stored = (await repo.devices.findById(pending.id))!;
    expect(stored.frpStatus).toBeUndefined();
    expect(stored.frpError).toBeUndefined();
    expect(stored.frpVerifiedAt).toBeUndefined();

    // Release clears FRP telemetry as well
    const { plan } = await financedDevice();
    await repo.devices.update(plan.deviceId, {
      frpStatus: 'ACTIVE',
      frpVerifiedAt: new Date().toISOString(),
    });
    const relRes = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${plan.deviceId}/release`)
      .send({ reason: 'Customer settled early by cash' });
    expect(relRes.status).toBe(200);

    const released = (await repo.devices.findById(plan.deviceId))!;
    expect(released.frpStatus).toBeUndefined();
    expect(released.frpVerifiedAt).toBeUndefined();
  });
});

describe('Dealer visibility: readiness, stats, and frp=refused filter', () => {
  it('exposes enrollment readiness to DEALER_STAFF without leaking account IDs and blocks CUSTOMER', async () => {
    let res = await as(ACCOUNTS.dealerStaff).get('/api/enrollment/readiness');
    expect(res.status).toBe(200);
    expect(res.body.frpConfigured).toBe(false);
    expect(res.body.frpAccountsCount).toBe(0);
    expect(typeof res.body.provisioningReady).toBe('boolean');
    expect(JSON.stringify(res.body)).not.toContain(DEALER_GOOGLE_ID);

    await setFrp([DEALER_GOOGLE_ID]);

    res = await as(ACCOUNTS.dealerStaff).get('/api/enrollment/readiness');
    expect(res.status).toBe(200);
    expect(res.body.frpConfigured).toBe(true);
    expect(res.body.frpAccountsCount).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain(DEALER_GOOGLE_ID);

    const custRes = await as(ACCOUNTS.customer).get('/api/enrollment/readiness');
    expect(custRes.status).toBe(403);
  });

  it('includes frpConfigured and frpRefusedDevices in dashboard stats and filters GET /api/devices?frp=refused', async () => {
    let statsRes = await as(ACCOUNTS.dealerStaff).get('/api/dashboard/stats');
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.frpConfigured).toBe(false);
    expect(statsRes.body.frpRefusedDevices).toBe(0);

    await setFrp([DEALER_GOOGLE_ID]);

    const { plan, credential } = await financedDevice();
    await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({
        dpcVersion: '1.5.1',
        frp: { status: 'REFUSED', detail: 'OEM blocked FRP' },
      });

    statsRes = await as(ACCOUNTS.dealerStaff).get('/api/dashboard/stats');
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.frpConfigured).toBe(true);
    expect(statsRes.body.frpRefusedDevices).toBe(1);

    const listRes = await as(ACCOUNTS.dealerStaff).get('/api/devices?frp=refused');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].id).toBe(plan.deviceId);
    expect(listRes.body.data[0].frpStatus).toBe('REFUSED');
  });
});
