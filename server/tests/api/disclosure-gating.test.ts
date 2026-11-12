import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import {
  CURRENT_TERMS_VERSION,
  ContractSnapshot,
  DECLARATION,
  declarationFor,
  renderClauses,
  termsDiscloseIntegrityChecks,
  termsDiscloseResetProtection,
} from '../../src/services/contractTerms.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

/**
 * Terms v1.4 — what the handset app does that earlier agreements never said.
 *
 * Two things: it reports the phone's hardware identity and integrity and can
 * restrict a tampered phone that owes nothing overdue, and it protects the
 * phone against being reset out of the agreement. A customer who signed v1.3
 * or earlier was told neither, so for them the server must do neither — the
 * same bargain the offline rule already keeps for v1.0.
 */

const DEALER_GOOGLE_ID = '114327899012345678901';
const ROGUE_IMEI = '351111222233334';

const snapshot: ContractSnapshot = {
  dealer: { name: 'Al-Madina Mobiles', code: 'AMM', phone: '0321-0000000', address: 'Hall Road', city: 'Lahore' },
  customer: { name: 'Test Buyer', cnic: '35201-1234567-3', phone: '0300-1234567', address: 'Lahore' },
  device: { brand: 'Infinix', model: 'Hot 40', imei: '356789012345678' },
  plan: {
    totalAmount: 60000, downPayment: 12000, financedAmount: 48000, monthlyInstallment: 8000,
    totalInstallments: 6, firstDueDate: '2026-12-05', gracePeriodDays: 3,
  },
  lateFee: { enabled: false, type: 'FIXED', amount: 0, frequency: 'ONE_TIME' },
  offlineLock: { enabled: false, afterDays: 0 },
  stagedRestrictions: { enabled: false },
  locationOnRecovery: { enabled: true },
  schedule: [{ installmentNumber: 1, amountDue: 8000, dueDate: '2026-12-05' }],
  preparedAt: '2026-11-01T00:00:00.000Z',
};

const clause4 = (version: string, snap: ContractSnapshot = snapshot) =>
  renderClauses(snap, version).find((c) => c.heading.startsWith('4.'))!;

/** An enrolled handset whose agreement is signed under the current terms. */
async function enrolledHandset() {
  const device = (await repo.devices.findFirst({ dealerId: 'dealer-1', status: 'PENDING', noLock: false }))!;
  const qr = await as(ACCOUNTS.dealerStaff)
    .post('/api/enrollment/generate')
    .send({ deviceId: device.id, qrType: 'STANDARD' });
  expect(qr.status).toBe(201);

  const res = await anonymous()
    .post('/api/dpc/enroll')
    .send({ token: qr.body.token.token, dpcVersion: '1.5.1', imeis: [device.imei], serialNumber: 'SN-GATE-01' });
  expect(res.status).toBe(201);

  const contract = (await repo.contracts.findByDevice(device.id))!;
  expect(contract.status).toBe('SIGNED');
  expect(contract.termsVersion).toBe(CURRENT_TERMS_VERSION);

  return { device, contract, credential: `Device ${res.body.deviceId}.${res.body.deviceToken}` };
}

/**
 * Puts the agreement back on an older terms version, with a hash that matches
 * — i.e. a customer who genuinely signed before v1.4 existed, not a record
 * that has been tampered with.
 */
async function signedUnder(contractId: string, version: string) {
  const contract = (await repo.contracts.findById(contractId))!;
  const documentHash = crypto.createHash('sha256').update(`${version}\n${contract.snapshot}`).digest('hex');
  await repo.contracts.update(contractId, { termsVersion: version, documentHash });
}

const tampered = {
  dpcVersion: '1.5.1',
  imeis: [ROGUE_IMEI],
  serialNumber: 'SN-SWAPPED-99',
  isDeviceOwner: true,
  integrity: { rooted: true, bootloaderUnlocked: true, testKeys: false },
};

async function checkIn(credential: string, body: Record<string, unknown> = {}) {
  const res = await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send(body);
  expect(res.status).toBe(200);
  return res.body;
}

describe('which terms versions disclose what', () => {
  it('starts at v1.4 for both', () => {
    for (const older of ['1.0', '1.1', '1.2', '1.3']) {
      expect(termsDiscloseIntegrityChecks(older)).toBe(false);
      expect(termsDiscloseResetProtection(older)).toBe(false);
    }
    for (const newer of ['1.4', '1.10', '2.0']) {
      expect(termsDiscloseIntegrityChecks(newer)).toBe(true);
      expect(termsDiscloseResetProtection(newer)).toBe(true);
    }
  });

  it('prints both in clause 4 of v1.4, in English and Urdu', () => {
    const clause = clause4('1.4');
    expect(clause.body).toMatch(/IMEI and serial numbers/);
    expect(clause.body).toMatch(/restricted even when the installments are up to date/);
    expect(clause.body).toMatch(/cannot be factory-reset from its settings/);
    expect(clause.body).toMatch(/shop's own account/);
    expect(clause.bodyUr).toContain('سیریل نمبر');
    expect(clause.bodyUr).toContain('چھیڑ چھاڑ');
    expect(clause.bodyUr).toContain('فیکٹری ری سیٹ');
  });

  it('leaves v1.3 exactly as it was signed', () => {
    const clause = clause4('1.3');
    expect(clause.body).not.toMatch(/serial/i);
    expect(clause.body).not.toMatch(/factory-reset/i);
    // The contradiction v1.3 shipped with is part of what those customers
    // signed. It is fixed in v1.4, not rewritten underneath them.
    expect(clause.body).toContain("does not track the handset's location, and");
    expect(clause.bodyUr).not.toContain('فیکٹری ری سیٹ');
  });

  it('no longer denies tracking location in the same clause that permits it', () => {
    const clause = clause4('1.4');
    expect(clause.body).toContain("does not track the handset's location except as stated below in this clause");
    expect(clause.body).not.toContain("does not track the handset's location, and");
    expect(clause.bodyUr).toContain('لوکیشن ٹریک نہیں کرتا سوائے اس صورت کے');
  });

  it('keeps the flat denial where location is not part of the agreement', () => {
    const clause = clause4('1.4', { ...snapshot, locationOnRecovery: { enabled: false } });
    expect(clause.body).toContain("does not track the handset's location, and");
  });

  it('versions the declaration with the clauses', () => {
    expect(declarationFor('1.3')).toBe(DECLARATION);
    expect(declarationFor('1.4').en).toMatch(/tampered with/);
    expect(declarationFor('1.4').ur).toContain('چھیڑ چھاڑ');
  });
});

describe('hardware checks and the tamper lock', () => {
  it('records the signals and queues a lock for a customer who signed v1.4', async () => {
    const { device, credential } = await enrolledHandset();

    const body = await checkIn(credential, tampered);
    expect(body.status).toBe('LOCK_PENDING');
    expect(body.command).toMatchObject({ type: 'LOCK' });

    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.tamperFlags).toEqual(expect.arrayContaining(['IMEI_MISMATCH', 'ROOTED']));
    expect(stored.reportedImei).toBe(ROGUE_IMEI);
  });

  it('neither locks nor keeps the signals for a customer who signed v1.3', async () => {
    const { device, contract, credential } = await enrolledHandset();
    await signedUnder(contract.id, '1.3');
    const before = (await repo.devices.findById(device.id))!;

    const body = await checkIn(credential, tampered);
    expect(body.status).toBe('ACTIVE');
    expect(body.command).toBeNull();

    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.tamperFlags ?? []).toEqual(before.tamperFlags ?? []);
    expect(stored.reportedImei).toBe(before.reportedImei);
    expect(stored.reportedSerial).toBe(before.reportedSerial);
    expect(stored.tamperDetectedAt).toBeUndefined();

    const alert = await repo.notifications.findFirst({ deviceId: device.id, type: 'SECURITY_ALERT' });
    expect(alert).toBeFalsy();
  });

  it('still lets the same v1.3 customer be locked for an ordinary reason', async () => {
    // The gate withholds what was not disclosed, not the consent they gave.
    const { device, contract } = await enrolledHandset();
    await signedUnder(contract.id, '1.3');

    const res = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${device.id}/lock`)
      .send({ reason: 'Installment overdue past the grace period.' });
    expect(res.status).toBe(200);
  });

  it('asks only a v1.4 handset to attest its hardware', async () => {
    const current = await enrolledHandset();
    expect((await checkIn(current.credential)).attestationChallenge).toEqual(expect.any(String));

    await reseed();
    const older = await enrolledHandset();
    await signedUnder(older.contract.id, '1.3');
    expect((await checkIn(older.credential)).attestationChallenge).toBeUndefined();
    expect((await repo.devices.findById(older.device.id))!.attestationChallenge).toBeFalsy();
  });
});

describe('factory-reset protection', () => {
  async function setFrp() {
    const res = await as(ACCOUNTS.dealerAdmin).put('/api/settings/policy').send({ frpAccountIds: [DEALER_GOOGLE_ID] });
    expect(res.status).toBe(200);
  }

  it('hands the shop\'s account to a handset whose customer signed v1.4', async () => {
    await setFrp();
    const { credential } = await enrolledHandset();
    expect((await checkIn(credential)).policy.frpAccountIds).toEqual([DEALER_GOOGLE_ID]);
  });

  it('hands over none for a customer who signed v1.3, so the phone drops it', async () => {
    await setFrp();
    const { contract, credential } = await enrolledHandset();
    await signedUnder(contract.id, '1.3');
    expect((await checkIn(credential)).policy.frpAccountIds).toEqual([]);
  });

  it('hands over none once the agreement is voided', async () => {
    await setFrp();
    const { contract, credential } = await enrolledHandset();
    await repo.contracts.update(contract.id, { status: 'VOID', voidReason: 'Sale cancelled' });
    expect((await checkIn(credential)).policy.frpAccountIds).toEqual([]);
  });
});

describe('emergency calls', () => {
  it('cannot be switched off by a shop, because every agreement promises them', async () => {
    const saved = await as(ACCOUNTS.dealerAdmin).put('/api/settings/policy').send({ emergencyCallsAllowed: false });
    expect(saved.status).toBe(200);
    expect(saved.body.policy.emergencyCallsAllowed).toBe(true);

    // Even a policy row written some other way does not reach the handset.
    const policy = (await repo.devicePolicies.findByDealer('dealer-1'))!;
    await repo.devicePolicies.update(policy.id, { emergencyCallsAllowed: false });

    const { credential } = await enrolledHandset();
    expect((await checkIn(credential)).policy.emergencyCallsAllowed).toBe(true);
  });
});
