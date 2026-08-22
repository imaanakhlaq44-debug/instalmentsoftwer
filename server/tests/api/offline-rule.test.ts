import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { CURRENT_TERMS_VERSION } from '../../src/services/contractTerms.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

/**
 * The offline rule — a handset that restricts itself after too long out of
 * contact.
 *
 * The server does not apply this lock and could not: the phone it applies to is
 * by definition unreachable. What the server decides is whether a given handset
 * is *permitted* to, and everything below is about that permission being
 * refused in every case where nobody agreed to it.
 */

const SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Turns the rule on for dealer-1, which is what every case here starts from. */
async function setPolicy(updates: Record<string, unknown>) {
  const res = await as(ACCOUNTS.dealerAdmin).put('/api/settings/policy').send(updates);
  expect(res.status).toBe(200);
  return res.body.policy;
}

let saleCounter = 0;

/**
 * A 15-digit IMEI whose checksum passes — registration rejects anything else.
 */
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

/**
 * A fresh financed sale, so the contract is a draft this test can sign.
 *
 * The fixture's own devices come with contracts already signed, and the terms
 * frozen into a signed contract are the ones that were in force at the moment
 * of signing — which is exactly what most of these cases are about. So each one
 * registers its own sale after setting the policy it wants to test.
 */
async function registerSale() {
  // Seven digits, because they go into a phone number and a CNIC that the
  // registration form validates. A counter rather than the clock alone: two
  // sales in the same millisecond would otherwise collide on the IMEI.
  const unique = String((Number(Date.now().toString().slice(-7)) + saleCounter++) % 10_000_000)
    .padStart(7, '0');

  const res = await as(ACCOUNTS.dealerStaff)
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
      device: {
        brand: 'Infinix',
        model: 'Hot 40',
        imei: imeiFrom(`35${unique}90123`.slice(0, 14)),
        purchasePrice: 60000,
      },
      plan: {
        downPayment: 12000,
        totalInstallments: 6,
        firstDueDate: '2026-09-05',
        gracePeriodDays: 3,
      },
    });

  expect(res.status).toBe(201);
  return res.body.device.id as string;
}

/** Provisions a registered handset and returns the credential it would keep. */
async function enrolledDevice(deviceId?: string) {
  const id = deviceId ?? (await registerSale());

  const qr = await as(ACCOUNTS.dealerStaff)
    .post('/api/enrollment/generate')
    .send({ deviceId: id, qrType: 'STANDARD' });
  expect(qr.status).toBe(201);

  const res = await anonymous()
    .post('/api/dpc/enroll')
    .send({ token: qr.body.token.token, dpcVersion: '2.4.0' });
  expect(res.status).toBe(201);

  return {
    deviceId: id,
    credential: `Device ${res.body.deviceId}.${res.body.deviceToken}`,
    enrollPolicy: res.body.policy,
  };
}

/** Signs the draft contract the sale created, under the terms now in force. */
async function signContractFor(deviceId: string) {
  const contract = (await repo.contracts.findByDevice(deviceId))!;
  const res = await as(ACCOUNTS.dealerStaff)
    .post(`/api/contracts/${contract.id}/sign`)
    .send({ signerName: 'Test Buyer', signatureImage: SIGNATURE, declarationAccepted: true });
  expect(res.status).toBe(200);
  return (await repo.contracts.findById(contract.id))!;
}

async function checkIn(credential: string, body: Record<string, unknown> = {}) {
  const res = await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send(body);
  expect(res.status).toBe(200);
  return res.body;
}

describe('what the handset is told about the offline rule', () => {
  it('hands over the limit once the policy, the consent and the terms all agree', async () => {
    await setPolicy({ autoLockEnabled: true, offlineLockAfterDays: 7 });
    const { deviceId, credential } = await enrolledDevice();
    await signContractFor(deviceId);

    const body = await checkIn(credential);
    expect(body.policy.offlineLockAfterDays).toBe(7);
    // The phone applies the same grace after a due date that the server does.
    expect(body.policy.gracePeriodDays).toBeGreaterThan(0);
  });

  it('says never when the dealer has not configured a limit', async () => {
    await setPolicy({ autoLockEnabled: true });
    const { deviceId, credential } = await enrolledDevice();
    await signContractFor(deviceId);

    expect((await checkIn(credential)).policy.offlineLockAfterDays).toBe(0);
  });

  it('says never while automatic locking is off', async () => {
    // A shop that locks by hand does not get a rule that fires with nobody
    // deciding, even having set a number of days.
    await setPolicy({ autoLockEnabled: true, offlineLockAfterDays: 7 });
    const { deviceId, credential } = await enrolledDevice();
    await signContractFor(deviceId);
    await setPolicy({ autoLockEnabled: false });

    expect((await checkIn(credential)).policy.offlineLockAfterDays).toBe(0);
  });

  it('says never for a handset whose agreement is unsigned', async () => {
    await setPolicy({ autoLockEnabled: true, offlineLockAfterDays: 7 });
    const { credential } = await enrolledDevice();

    expect((await checkIn(credential)).policy.offlineLockAfterDays).toBe(0);
  });

  it('says never for a handset whose agreement was voided', async () => {
    await setPolicy({ autoLockEnabled: true, offlineLockAfterDays: 7 });
    const { deviceId, credential } = await enrolledDevice();
    const contract = await signContractFor(deviceId);

    const voided = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/contracts/${contract.id}/void`)
      .send({ reason: 'Replaced by a restructured agreement.' });
    expect(voided.status).toBe(200);

    expect((await checkIn(credential)).policy.offlineLockAfterDays).toBe(0);
  });

  it('says never when the signed terms predate the rule', async () => {
    // The point of the whole gate. v1.0 told the customer their phone could be
    // restricted for non-payment; it did not tell them it had to keep reporting
    // in. Locking on an undisclosed rule is what consent exists to prevent.
    await setPolicy({ autoLockEnabled: true, offlineLockAfterDays: 7 });
    const { deviceId, credential } = await enrolledDevice();
    const contract = await signContractFor(deviceId);

    await repo.contracts.update(contract.id, { termsVersion: '1.0' });

    expect((await checkIn(credential)).policy.offlineLockAfterDays).toBe(0);
  });

  it('says never when the rule was off at the time of signing', async () => {
    // The dealer turned it on afterwards. The contract in this customer's hand
    // does not mention it, so this handset is not covered by it.
    await setPolicy({ autoLockEnabled: true, offlineLockAfterDays: 0 });
    const { deviceId, credential } = await enrolledDevice();
    await signContractFor(deviceId);

    await setPolicy({ offlineLockAfterDays: 14 });

    expect((await checkIn(credential)).policy.offlineLockAfterDays).toBe(0);
  });

  it('never shortens the limit below the one the customer signed', async () => {
    await setPolicy({ autoLockEnabled: true, offlineLockAfterDays: 14 });
    const { deviceId, credential } = await enrolledDevice();
    await signContractFor(deviceId);

    // Tightened for everybody afterwards. This customer agreed to fourteen days
    // and keeps fourteen days.
    await setPolicy({ offlineLockAfterDays: 3 });
    expect((await checkIn(credential)).policy.offlineLockAfterDays).toBe(14);

    // Relaxing it, on the other hand, applies to them like anybody else.
    await setPolicy({ offlineLockAfterDays: 30 });
    expect((await checkIn(credential)).policy.offlineLockAfterDays).toBe(30);
  });

  it('still tells the phone nothing about the dealership', async () => {
    await setPolicy({ autoLockEnabled: true, offlineLockAfterDays: 7 });
    const { deviceId, credential } = await enrolledDevice();
    await signContractFor(deviceId);

    const payload = JSON.stringify(await checkIn(credential));
    expect(payload).not.toMatch(/cnic/i);
    expect(payload).not.toMatch(/termsVersion/);
    expect(payload).not.toMatch(/snapshot/);
  });
});

describe('a handset reporting that it locked itself', () => {
  async function permittedDevice() {
    await setPolicy({ autoLockEnabled: true, offlineLockAfterDays: 7 });
    const device = await enrolledDevice();
    await signContractFor(device.deviceId);
    return device;
  }

  it('records it without claiming the shop issued the lock', async () => {
    const { deviceId, credential } = await permittedDevice();

    const body = await checkIn(credential, {
      offlineLockActive: true,
      offlineLockSince: '2026-08-14T09:00:00Z',
    });

    const stored = (await repo.devices.findById(deviceId))!;
    expect(stored.offlineLockActive).toBe(true);
    expect(stored.offlineLockSince).toBeTruthy();

    // The status is untouched. LOCKED means a lock this server issued and the
    // handset confirmed; this was neither.
    expect(stored.status).toBe('ACTIVE');
    expect(body.status).toBe('ACTIVE');
    expect(body.policy.locked).toBe(false);
  });

  it('writes it to the device timeline, once, when the shop first hears of it', async () => {
    const { deviceId, credential } = await permittedDevice();

    await checkIn(credential, { offlineLockActive: true, offlineLockSince: '2026-08-14T09:00:00Z' });
    await checkIn(credential, { offlineLockActive: true, offlineLockSince: '2026-08-14T09:00:00Z' });

    const logs = await repo.deviceActionLogs.findMany({ where: { deviceId } });
    const selfLocks = logs.filter((log) => /restricted itself/i.test(log.reason ?? ''));
    expect(selfLocks).toHaveLength(1);
  });

  it('keeps the moment the phone names, not the moment the news arrived', async () => {
    const { deviceId, credential } = await permittedDevice();

    await checkIn(credential, { offlineLockActive: true, offlineLockSince: '2026-08-14T09:00:00Z' });

    const stored = (await repo.devices.findById(deviceId))!;
    expect(new Date(stored.offlineLockSince!).toISOString()).toBe('2026-08-14T09:00:00.000Z');
  });

  it('clears the flag when the handset reports the restriction lifted', async () => {
    const { deviceId, credential } = await permittedDevice();

    await checkIn(credential, { offlineLockActive: true, offlineLockSince: '2026-08-14T09:00:00Z' });
    await checkIn(credential, { offlineLockActive: false });

    const stored = (await repo.devices.findById(deviceId))!;
    expect(stored.offlineLockActive).toBe(false);
    expect(stored.offlineLockSince).toBeUndefined();

    const logs = await repo.deviceActionLogs.findMany({ where: { deviceId } });
    expect(logs.some((log) => /lifted the restriction/i.test(log.reason ?? ''))).toBe(true);
  });

  it('treats a check-in that says nothing as no self-lock', async () => {
    const { deviceId, credential } = await permittedDevice();

    await checkIn(credential, { batteryLevel: 40 });

    const stored = (await repo.devices.findById(deviceId))!;
    expect(stored.offlineLockActive).toBe(false);
  });
});

describe('the setting itself', () => {
  it('refuses a limit short enough to catch an ordinary weekend without signal', async () => {
    const res = await as(ACCOUNTS.dealerAdmin)
      .put('/api/settings/policy')
      .send({ offlineLockAfterDays: 1 });

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/at least 3 days/i);
  });

  it('accepts zero, which turns the rule off', async () => {
    const policy = await setPolicy({ offlineLockAfterDays: 0 });
    expect(policy.offlineLockAfterDays).toBe(0);
  });

  it('records the change in the audit trail in its own words', async () => {
    await setPolicy({ autoLockEnabled: true });
    await setPolicy({ offlineLockAfterDays: 10 });

    const logs = await repo.auditLogs.findMany({ where: { dealerId: 'dealer-1' } });
    expect(
      logs.some((log) => /restrict themselves after 10 day/i.test(log.details ?? ''))
    ).toBe(true);
  });

  it('is off for a dealer who has never touched it', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.policy.offlineLockAfterDays ?? 0).toBe(0);
  });
});

describe('the simulator standing in for the handset', () => {
  it('refuses to self-lock a phone the real rule would never touch', async () => {
    // No signed agreement disclosing the rule, so a real handset would have
    // been handed a limit of zero and would never have done this.
    await setPolicy({ autoLockEnabled: true, offlineLockAfterDays: 7 });
    const { deviceId } = await enrolledDevice();

    const res = await as(ACCOUNTS.dealerStaff)
      .post('/api/simulator/update-state')
      .send({ deviceId, action: 'SIMULATE_OFFLINE_SELF_LOCK' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not permitted to restrict itself/i);
  });

  it('records a self-lock without moving the device to LOCKED', async () => {
    await setPolicy({ autoLockEnabled: true, offlineLockAfterDays: 7 });
    const { deviceId } = await enrolledDevice();
    await signContractFor(deviceId);

    const res = await as(ACCOUNTS.dealerStaff)
      .post('/api/simulator/update-state')
      .send({ deviceId, action: 'SIMULATE_OFFLINE_SELF_LOCK' });

    expect(res.status).toBe(200);
    expect(res.body.offlineLockAfterDays).toBe(7);

    const stored = (await repo.devices.findById(deviceId))!;
    expect(stored.offlineLockActive).toBe(true);
    expect(stored.isOnline).toBe(false);
    expect(stored.status).toBe('ACTIVE');
  });
});

describe('the terms the rule rests on', () => {
  it('freezes the rule into the contract the customer signs', async () => {
    await setPolicy({ autoLockEnabled: true, offlineLockAfterDays: 7 });
    const { deviceId } = await enrolledDevice();
    const contract = await signContractFor(deviceId);

    expect(contract.termsVersion).toBe(CURRENT_TERMS_VERSION);

    const snapshot = JSON.parse(contract.snapshot);
    expect(snapshot.offlineLock).toEqual({ enabled: true, afterDays: 7 });
  });

  it('prints the rule in clause 4, in both languages, with the real day count', async () => {
    await setPolicy({ autoLockEnabled: true, offlineLockAfterDays: 7 });
    const { deviceId } = await enrolledDevice();
    const contract = await signContractFor(deviceId);

    const res = await as(ACCOUNTS.dealerStaff).get(`/api/contracts/${contract.id}`);
    expect(res.status).toBe(200);

    const clause = res.body.clauses.find((c: { heading: string }) => c.heading.startsWith('4.'));
    expect(clause.body).toMatch(/7 days in a row/);
    expect(clause.body).toMatch(/does\s+not prevent a restriction/);
    expect(clause.bodyUr).toContain('7');
    expect(clause.bodyUr.length).toBeGreaterThan(clause.body.length / 4);
  });

  it('says nothing about it on a contract signed while the rule was off', async () => {
    await setPolicy({ autoLockEnabled: true, offlineLockAfterDays: 0 });
    const { deviceId } = await enrolledDevice();
    const contract = await signContractFor(deviceId);

    const res = await as(ACCOUNTS.dealerStaff).get(`/api/contracts/${contract.id}`);
    const clause = res.body.clauses.find((c: { heading: string }) => c.heading.startsWith('4.'));

    expect(clause.body).not.toMatch(/days in a row/);
  });
});
