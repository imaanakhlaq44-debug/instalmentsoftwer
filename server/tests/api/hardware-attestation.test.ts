import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import {
  enrollmentChallenge,
  setExtraTrustedRootsForTesting,
  verifyKeyAttestation,
} from '../../src/services/attestation/KeyAttestation.js';
import { AttestationRevocationList } from '../../src/services/attestation/RevocationList.js';
import { buildAttestationChain, INTERMEDIATE_SERIAL, testRoot } from '../attestationChain.js';

beforeAll(() => {
  setExtraTrustedRootsForTesting([testRoot.publicKey]);
});

beforeEach(async () => {
  await reseed();
}, 60_000);

afterEach(() => {
  AttestationRevocationList.setForTesting(null);
});

afterAll(async () => {
  setExtraTrustedRootsForTesting([]);
  await disconnectDatabase();
});

const challenge = Buffer.alloc(32, 7);

describe('Key attestation verifier', () => {
  it('reads the factory IMEIs, serial and boot state from a valid chain', async () => {
    const chain = buildAttestationChain({
      challenge,
      imei: '358240051111110',
      secondImei: '358240051111128',
      serial: 'R58N12ABCDE',
      brand: 'samsung',
      model: 'SM-A155F',
    });

    const result = await verifyKeyAttestation({ chain }, challenge);
    expect(result).toMatchObject({
      status: 'VERIFIED',
      securityLevel: 'TEE',
      imeis: ['358240051111110', '358240051111128'],
      serial: 'R58N12ABCDE',
      brand: 'samsung',
      model: 'SM-A155F',
      deviceLocked: true,
      verifiedBootState: 'VERIFIED',
    });
  });

  it('rejects a chain whose leaf signature was tampered with', async () => {
    const chain = buildAttestationChain({ challenge, imei: '358240051111110', breakLeafSignature: true });
    expect((await verifyKeyAttestation({ chain }, challenge))?.status).toBe('INVALID');
  });

  it('rejects a forged leaf signed by an attested key (record above the leaf)', async () => {
    const chain = buildAttestationChain({ challenge, imei: '358240051111110', recordOnIntermediate: true });
    expect((await verifyKeyAttestation({ chain }, challenge))?.status).toBe('INVALID');
  });

  it('does not trust a chain that ends at an unknown root', async () => {
    const chain = buildAttestationChain({ challenge, imei: '358240051111110', untrustedRoot: true });
    const result = await verifyKeyAttestation({ chain }, challenge);
    expect(result?.status).toBe('UNTRUSTED_ROOT');
    expect(result?.imeis).toEqual([]);
  });

  it('refuses an attestation made for another challenge (replay)', async () => {
    const chain = buildAttestationChain({ challenge: Buffer.alloc(32, 9), imei: '358240051111110' });
    expect((await verifyKeyAttestation({ chain }, challenge))?.status).toBe('CHALLENGE_MISMATCH');
  });

  it('reports a revoked (leaked keybox) certificate', async () => {
    AttestationRevocationList.setForTesting([INTERMEDIATE_SERIAL.toString(16)]);
    const chain = buildAttestationChain({ challenge, imei: '358240051111110' });
    expect((await verifyKeyAttestation({ chain }, challenge))?.status).toBe('REVOKED');
  });

  it('does not count software-only attestation as hardware proof', async () => {
    const chain = buildAttestationChain({ challenge, imei: '358240051111110', securityLevel: 0 });
    expect((await verifyKeyAttestation({ chain }, challenge))?.status).toBe('SOFTWARE_ONLY');
  });

  it('records a handset that could not attest at all', async () => {
    const result = await verifyKeyAttestation({ chain: [], error: 'StrongBoxUnavailableException' }, challenge);
    expect(result?.status).toBe('UNAVAILABLE');
  });

  it('derives the enrollment challenge exactly as the DPC does', () => {
    // Same vector as DPC AttestationChallengeTest.
    expect(enrollmentChallenge('ENROLL-TOKEN-123').toString('hex')).toBe(
      '416f4981d48e6da08d4431d3787147fec4f3f171353f2cee114115384b5cfa7e'
    );
  });
});

async function pendingDeviceWithToken() {
  const device = (await repo.devices.findFirst({ dealerId: 'dealer-1', status: 'PENDING', noLock: false }))!;
  const res = await as(ACCOUNTS.dealerStaff)
    .post('/api/enrollment/generate')
    .send({ deviceId: device.id, qrType: 'STANDARD' });
  expect(res.status).toBe(201);
  return { device, token: res.body.token.token as string };
}

async function enrollAttested(serial = 'R58N12ABCDE') {
  const { device, token } = await pendingDeviceWithToken();
  const chain = buildAttestationChain({ challenge: enrollmentChallenge(token), imei: device.imei, serial });
  const res = await anonymous()
    .post('/api/dpc/enroll')
    .send({
      token,
      dpcVersion: '1.5.0',
      imeis: [device.imei],
      serialNumber: serial,
      isDeviceOwner: true,
      attestation: { chain, idsAttested: true },
    });
  expect(res.status).toBe(201);
  return { device, credential: `Device ${res.body.deviceId}.${res.body.deviceToken}` };
}

describe('Hardware attestation at enrollment', () => {
  it('blocks a phone whose secure chip IMEI differs, even when the OS reports the registered IMEI', async () => {
    const { device, token } = await pendingDeviceWithToken();
    const licencesBefore = await repo.deviceLicenses.count({ dealerId: device.dealerId, status: 'AVAILABLE' });

    // A rooted phone hooking getImei() to return the shop's IMEI.
    const chain = buildAttestationChain({ challenge: enrollmentChallenge(token), imei: '990001112223334' });
    const res = await anonymous()
      .post('/api/dpc/enroll')
      .send({ token, dpcVersion: '1.5.0', imeis: [device.imei], isDeviceOwner: true, attestation: { chain } });

    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toMatch(/imei/i);
    expect(await repo.deviceLicenses.count({ dealerId: device.dealerId, status: 'AVAILABLE' })).toBe(licencesBefore);

    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.status).toBe('PENDING');
    expect(stored.tamperFlags).toContain('ATTESTED_IMEI_MISMATCH');
    expect(stored.attestationStatus).toBe('VERIFIED');
  });

  it('records the verified hardware identity and pins the attested serial', async () => {
    const { device } = await enrollAttested();
    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.status).toBe('ACTIVE');
    expect(stored.attestationStatus).toBe('VERIFIED');
    expect(stored.attestedImeis).toEqual([device.imei]);
    expect(stored.attestedSerial).toBe('R58N12ABCDE');
    expect(stored.enrolledSerial).toBe('R58N12ABCDE');
    expect(stored.attestedAt).toBeDefined();
    expect(stored.tamperFlags).toEqual([]);
  });

  it('masks attested identifiers for dealer staff and never exposes the challenge', async () => {
    const { device } = await enrollAttested('R58NSECRET77');
    await repo.devices.update(device.id, { attestationChallenge: 'outstanding-challenge-value' });

    const staff = await as(ACCOUNTS.dealerStaff).get(`/api/devices/${device.id}`);
    expect(staff.status).toBe(200);
    expect(staff.body.attestedImeis).toBeUndefined();
    expect(staff.body.maskedAttestedImeis?.[0]).toMatch(/^\*+\d{4}$/);
    expect(staff.body.attestedSerial).toBeUndefined();
    expect(staff.body.enrolledSerial).toBeUndefined();
    const staffJson = JSON.stringify(staff.body);
    expect(staffJson).not.toContain(device.imei);
    expect(staffJson).not.toContain('R58NSECRET77');
    expect(staffJson).not.toContain('outstanding-challenge-value');

    const admin = await as(ACCOUNTS.dealerAdmin).get(`/api/devices/${device.id}`);
    expect(admin.body.attestedImeis).toEqual([device.imei]);
    expect(admin.body.attestedSerial).toBe('R58NSECRET77');
    expect(JSON.stringify(admin.body)).not.toContain('outstanding-challenge-value');
  });
});

describe('Serial-number pinning and daily attestation on check-in', () => {
  it('auto-locks when the handset reports a different serial from the one pinned at enrollment', async () => {
    const { device, credential } = await enrollAttested();

    const res = await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({ dpcVersion: '1.5.0', imeis: [device.imei], serialNumber: 'ZY22OTHERPHONE', isDeviceOwner: true });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('LOCK_PENDING');
    expect(res.body.command).toMatchObject({ type: 'LOCK' });
    expect(JSON.stringify(res.body)).not.toMatch(/serial/i);

    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.tamperFlags).toContain('SERIAL_MISMATCH');
    expect(stored.tamperReason).not.toContain('ZY22OTHERPHONE');
  });

  it('pins the first serial a pre-1.5 phone reports instead of flagging it', async () => {
    const { token } = await pendingDeviceWithToken();
    const enrolled = await anonymous().post('/api/dpc/enroll').send({ token, dpcVersion: '1.3.0' });
    expect(enrolled.status).toBe(201);
    const credential = `Device ${enrolled.body.deviceId}.${enrolled.body.deviceToken}`;

    const res = await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({ dpcVersion: '1.5.0', serialNumber: 'FIRSTSEEN01' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');

    const stored = (await repo.devices.findById(enrolled.body.deviceId))!;
    expect(stored.enrolledSerial).toBe('FIRSTSEEN01');
    expect(stored.tamperFlags).toEqual([]);
  });

  it('asks for a fresh attestation once a day and locks on a hardware IMEI mismatch', async () => {
    const { device, credential } = await enrollAttested();

    // Just attested at enrollment: no challenge yet.
    const quiet = await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send({ dpcVersion: '1.5.0' });
    expect(quiet.body.attestationChallenge).toBeUndefined();

    // A day later the server asks again, and repeats the same challenge until answered.
    await repo.devices.update(device.id, { attestationCheckedAt: new Date(Date.now() - 25 * 3_600_000).toISOString() });
    const asked = await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send({ dpcVersion: '1.5.0' });
    const issued = asked.body.attestationChallenge as string;
    expect(issued).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const again = await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send({ dpcVersion: '1.5.0' });
    expect(again.body.attestationChallenge).toBe(issued);

    // The answer: the chip now holds a different IMEI (board swapped).
    const chain = buildAttestationChain({
      challenge: Buffer.from(issued, 'base64url'),
      imei: '990001112223334',
      serial: 'R58N12ABCDE',
    });
    const res = await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({ dpcVersion: '1.5.0', imeis: [device.imei], attestation: { chain, idsAttested: true } });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('LOCK_PENDING');
    expect(res.body.attestationChallenge).toBeUndefined();
    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.tamperFlags).toContain('ATTESTED_IMEI_MISMATCH');
    expect(stored.attestationChallenge).toBeUndefined();
  });

  it('locks when the secure chip reports an unlocked bootloader', async () => {
    const { device, credential } = await enrollAttested();
    await repo.devices.update(device.id, { attestationCheckedAt: new Date(Date.now() - 25 * 3_600_000).toISOString() });
    const asked = await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send({});
    const chain = buildAttestationChain({
      challenge: Buffer.from(asked.body.attestationChallenge, 'base64url'),
      imei: device.imei,
      serial: 'R58N12ABCDE',
      deviceLocked: false,
      bootState: 2,
    });

    // The OS claims all is well; the chip disagrees.
    const res = await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({ integrity: { rooted: false, bootloaderUnlocked: false, testKeys: false }, attestation: { chain } });
    expect(res.body.status).toBe('LOCK_PENDING');
    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.tamperFlags).toContain('BOOTLOADER_UNLOCKED');
    expect(stored.attestedBootLocked).toBe(false);
  });

  it('alerts without locking on a forged chain', async () => {
    const { device, credential } = await enrollAttested();
    await repo.devices.update(device.id, { attestationCheckedAt: new Date(Date.now() - 25 * 3_600_000).toISOString() });
    const asked = await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send({});
    const chain = buildAttestationChain({
      challenge: Buffer.from(asked.body.attestationChallenge, 'base64url'),
      imei: device.imei,
      breakLeafSignature: true,
    });

    const res = await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send({ attestation: { chain } });
    expect(res.body.status).toBe('ACTIVE');
    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.tamperFlags).toContain('ATTESTATION_INVALID');
    expect(stored.attestationStatus).toBe('INVALID');
  });

  it('re-pins the serial after a dealer admin clears the alert in person', async () => {
    const { device, credential } = await enrollAttested();
    await anonymous()
      .post('/api/dpc/check-in')
      .set('Authorization', credential)
      .send({ serialNumber: 'NEWBOARD0001' });

    const cleared = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${device.id}/clear-tamper`)
      .send({ reason: 'Motherboard replaced at authorised service centre; receipt seen.' });
    expect(cleared.status).toBe(200);

    await anonymous().post('/api/dpc/check-in').set('Authorization', credential).send({ serialNumber: 'NEWBOARD0001' });
    const stored = (await repo.devices.findById(device.id))!;
    expect(stored.enrolledSerial).toBe('NEWBOARD0001');
    expect(stored.tamperFlags).toEqual([]);
  });
});
