import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { hashDeviceToken } from '../../src/utils/deviceToken.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

/**
 * When the last installment is paid the phone belongs to the customer. The
 * record goes INACTIVE, and the phone's next check-in is told it is no longer
 * managed, which is the app's signal to undo everything and step down.
 */
async function financedDevice() {
  const plan = (await repo.installmentPlans.findFirst({ dealerId: 'dealer-1', status: 'CURRENT' }))!;
  const token = 'release-test-token-0123456789abcdefghijk';
  await repo.devices.update(plan.deviceId, { status: 'ACTIVE', authTokenHash: hashDeviceToken(token) });
  return { plan, deviceId: plan.deviceId, credential: `Device ${plan.deviceId}.${token}` };
}

function checkIn(credential: string) {
  return anonymous().get('/api/dpc/policy').set('Authorization', credential);
}

async function payOff(planId: string) {
  const plan = (await repo.installmentPlans.findById(planId))!;
  const installments = (await repo.installments.findByPlan(planId)).filter((i) => i.status !== 'PAID');
  for (const inst of installments) {
    const res = await as(ACCOUNTS.dealerStaff).post('/api/payments').send({
      customerId: plan.customerId,
      installmentId: inst.id,
      amount: inst.amountDue - (inst.amountPaid ?? 0) + (inst.lateFee ?? 0),
      paymentMethod: 'CASH',
      referenceNumber: `PAYOFF-${inst.installmentNumber}`,
    });
    expect(res.status).toBeLessThan(300);
  }
  return (await repo.installmentPlans.findById(planId))!;
}

describe('a plan paid in full', () => {
  it('releases its phone, and the phone is told so at its next check-in', async () => {
    const { plan, deviceId, credential } = await financedDevice();
    expect((await checkIn(credential)).status).toBe(200);

    const final = await payOff(plan.id);
    expect(final.status).toBe('COMPLETED');

    expect((await repo.devices.findById(deviceId))!.status).toBe('INACTIVE');
    const res = await checkIn(credential);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/no longer under management/i);

    expect(await repo.auditLogs.findFirst({ action: 'DEVICE_RELEASED', targetId: deviceId })).toBeTruthy();
  });

  it('a partial payment does not release anything', async () => {
    const { plan, deviceId } = await financedDevice();
    const first = (await repo.installments.findByPlan(plan.id)).find((i) => i.status !== 'PAID')!;

    await as(ACCOUNTS.dealerStaff).post('/api/payments').send({
      customerId: plan.customerId,
      installmentId: first.id,
      amount: 100,
      paymentMethod: 'CASH',
      referenceNumber: 'PARTIAL-1',
    });

    expect((await repo.devices.findById(deviceId))!.status).toBe('ACTIVE');
  });
});

describe('POST /api/devices/:id/release', () => {
  const release = (deviceId: string, account: string = ACCOUNTS.dealerAdmin) =>
    as(account).post(`/api/devices/${deviceId}/release`).send({ reason: 'Customer paid the balance in cash' });

  it('releases a locked phone and drops its queued command', async () => {
    const { deviceId, credential } = await financedDevice();
    await repo.devices.update(deviceId, { status: 'LOCKED', pendingCommand: 'LOCK', pendingCommandAt: new Date().toISOString() });

    const res = await release(deviceId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('INACTIVE');

    const stored = (await repo.devices.findById(deviceId))!;
    expect(stored.pendingCommand).toBeUndefined();
    expect((await checkIn(credential)).status).toBe(403);
  });

  it('is refused twice, to staff, and to another shop', async () => {
    const { deviceId } = await financedDevice();
    expect((await release(deviceId, ACCOUNTS.dealerStaff)).status).toBe(403);
    expect((await release(deviceId, ACCOUNTS.otherDealerAdmin)).status).toBe(404);
    expect((await release(deviceId)).status).toBe(200);

    const again = await release(deviceId);
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already been released/i);
  });

  it('cannot be locked once released', async () => {
    const { deviceId } = await financedDevice();
    await release(deviceId);

    const res = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${deviceId}/lock`)
      .send({ reason: 'Trying to lock a released phone' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
