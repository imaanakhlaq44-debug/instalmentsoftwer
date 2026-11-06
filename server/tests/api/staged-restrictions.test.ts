import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { OverdueEngine } from '../../src/services/OverdueEngine.js';
import { RESTRICTED_APPS } from '../../src/services/StagedRestrictions.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

const SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function setPolicy(updates: Record<string, unknown>) {
  const res = await as(ACCOUNTS.dealerAdmin).put('/api/settings/policy').send(updates);
  expect(res.status).toBe(200);
}

let counter = 0;
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

/** A sale, its contract signed under the terms now in force, and an enrolled handset. */
async function signedEnrolledSale() {
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

  const contract = (await repo.contracts.findByDevice(deviceId))!;
  const signed = await as(ACCOUNTS.dealerStaff)
    .post(`/api/contracts/${contract.id}/sign`)
    .send({ signerName: 'Test Buyer', signatureImage: SIGNATURE, declarationAccepted: true });
  expect(signed.status).toBe(200);

  const qr = await as(ACCOUNTS.dealerStaff).post('/api/enrollment/generate').send({ deviceId, qrType: 'STANDARD' });
  const enrolled = await anonymous().post('/api/dpc/enroll').send({ token: qr.body.token.token, dpcVersion: '2.4.0' });
  expect(enrolled.status).toBe(201);

  return { deviceId, credential: `Device ${enrolled.body.deviceId}.${enrolled.body.deviceToken}` };
}

async function markOverdue(deviceId: string, howMany: number) {
  const plan = (await repo.installmentPlans.findByDevice(deviceId))!;
  const installments = (await repo.installments.findByPlan(plan.id)).sort((a, b) => a.installmentNumber - b.installmentNumber);
  for (const inst of installments.slice(0, howMany)) {
    await repo.installments.update(inst.id, { status: 'OVERDUE' });
  }
}

async function policyFor(credential: string) {
  const res = await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send({});
  expect(res.status).toBe(200);
  return res.body.policy;
}

describe('what the handset is told about staged restrictions', () => {
  it('blocks calls and SMS at one missed installment, adds apps at two', async () => {
    await setPolicy({ autoLockEnabled: true, stagedRestrictionsEnabled: true });
    const { deviceId, credential } = await signedEnrolledSale();

    expect((await policyFor(credential)).restrictionLevel).toBe(0);

    await markOverdue(deviceId, 1);
    let policy = await policyFor(credential);
    expect(policy.restrictionLevel).toBe(1);
    expect(policy.restrictedApps).toEqual([]);

    await markOverdue(deviceId, 2);
    policy = await policyFor(credential);
    expect(policy.restrictionLevel).toBe(2);
    expect(policy.restrictedApps).toEqual([...RESTRICTED_APPS]);
    expect(policy.locked).toBe(false);
  });

  it('applies nothing while the dealer has staged restrictions off', async () => {
    await setPolicy({ autoLockEnabled: true, stagedRestrictionsEnabled: false });
    const { deviceId, credential } = await signedEnrolledSale();
    await markOverdue(deviceId, 2);
    expect((await policyFor(credential)).restrictionLevel).toBe(0);
  });

  it('applies nothing when the contract was signed with the stages off', async () => {
    await setPolicy({ autoLockEnabled: true, stagedRestrictionsEnabled: false });
    const { deviceId, credential } = await signedEnrolledSale();
    // Turned on afterwards: this customer never agreed to it.
    await setPolicy({ stagedRestrictionsEnabled: true });
    await markOverdue(deviceId, 2);
    expect((await policyFor(credential)).restrictionLevel).toBe(0);
  });
});

describe('the nightly engine under staged restrictions', () => {
  it('does not lock at the first missed installment', async () => {
    await setPolicy({ autoLockEnabled: true, stagedRestrictionsEnabled: true });
    const { deviceId } = await signedEnrolledSale();

    // Every installment due before this date is past its grace; run as of the
    // day after the first one's grace ends.
    await OverdueEngine.runEvaluation('2026-09-10');

    const device = (await repo.devices.findById(deviceId))!;
    expect(device.status).not.toBe('LOCKED');
    expect(device.status).not.toBe('LOCK_PENDING');
  });

  it('locks at the third missed installment', async () => {
    await setPolicy({ autoLockEnabled: true, stagedRestrictionsEnabled: true });
    const { deviceId } = await signedEnrolledSale();

    await OverdueEngine.runEvaluation('2026-11-10');

    const device = (await repo.devices.findById(deviceId))!;
    expect(['LOCKED', 'LOCK_PENDING']).toContain(device.status);
  });
});

describe('a new shop starts with enforcement on', () => {
  it('signs up with staged restrictions and a 3-day offline rule', async () => {
    const res = await anonymous().post('/api/auth/register-dealer').send({
      name: 'Bismillah Mobiles',
      ownerName: 'Kashif Ali',
      email: 'kashif@bismillahmobiles.pk',
      phone: '03001234567',
      city: 'Faisalabad',
      address: 'Shop 12, Rail Bazaar, Faisalabad',
      password: 'Bismillah#2026',
      packSize: 5,
    });
    expect(res.status).toBe(201);

    const policy = (await repo.devicePolicies.findByDealer(res.body.dealer.id))!;
    expect(policy).toMatchObject({ autoLockEnabled: true, stagedRestrictionsEnabled: true, offlineLockAfterDays: 3 });
  });
});
