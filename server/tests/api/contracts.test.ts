import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

/** A 1×1 PNG — enough to satisfy the format check without pretending to be a signature. */
const SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * A 15-digit IMEI whose checksum passes. Registration rejects anything else,
 * so the fixture has to produce a real one rather than fifteen digits.
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
  // The 15th digit sits at an even index, so it enters the sum undoubled.
  return base14 + String((10 - (sum % 10)) % 10);
}

/** Registers a customer with a financed device, which is what drafts a contract. */
async function registerSale(account: string = ACCOUNTS.dealerStaff) {
  const unique = Date.now().toString().slice(-7);

  const res = await as(account)
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
  const contract = (await repo.contracts.findByDevice(res.body.device.id))!;
  return { deviceId: res.body.device.id as string, contract };
}

/** Puts a device in a state where locking is otherwise permitted. */
async function makeLockable(deviceId: string) {
  await repo.devices.update(deviceId, { status: 'ACTIVE', isOnline: true });
}

describe('a sale drafts a contract', () => {
  it('creates one, unsigned, with the sale', async () => {
    const { contract } = await registerSale();

    expect(contract).toBeTruthy();
    expect(contract.status).toBe('DRAFT');
    expect(contract.signedAt).toBeUndefined();
    expect(contract.documentHash).toBeUndefined();
  });

  it('freezes the figures the customer will be shown', async () => {
    const { contract } = await registerSale();
    const snapshot = JSON.parse(contract.snapshot);

    expect(snapshot.plan.totalAmount).toBe(60000);
    expect(snapshot.plan.downPayment).toBe(12000);
    expect(snapshot.plan.financedAmount).toBe(48000);
    // The schedule is part of the document, not a reference to a table that
    // could be edited afterwards.
    expect(snapshot.schedule).toHaveLength(6);
    expect(snapshot.schedule.reduce((sum: number, r: any) => sum + r.amountDue, 0)).toBe(48000);
  });

  it('carries the customer\'s full CNIC, not a masked one', async () => {
    // This is the one document where masking would be wrong: it is the
    // customer's own copy, and an agreement identifying nobody identifies nobody.
    const { contract } = await registerSale();
    const snapshot = JSON.parse(contract.snapshot);

    expect(snapshot.customer.cnic).toMatch(/^\d{5}-\d{7}-\d$/);
  });
});

describe('signing', () => {
  it('records the signature, the signer and a document hash', async () => {
    const { contract } = await registerSale();

    const res = await as(ACCOUNTS.dealerStaff)
      .post(`/api/contracts/${contract.id}/sign`)
      .send({ signerName: 'Test Buyer', signatureImage: SIGNATURE, declarationAccepted: true });

    expect(res.status).toBe(200);
    const stored = (await repo.contracts.findById(contract.id))!;
    expect(stored.status).toBe('SIGNED');
    expect(stored.signerName).toBe('Test Buyer');
    expect(stored.signatureImage).toBe(SIGNATURE);
    expect(stored.documentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses a signature that is not an image drawn on screen', async () => {
    const { contract } = await registerSale();

    const res = await as(ACCOUNTS.dealerStaff)
      .post(`/api/contracts/${contract.id}/sign`)
      .send({ signerName: 'Test Buyer', signatureImage: 'I agree', declarationAccepted: true });

    // 422 is this codebase's validation failure, not 400.
    expect(res.status).toBe(422);
  });

  it('refuses to sign without the declaration being accepted', async () => {
    const { contract } = await registerSale();

    const res = await as(ACCOUNTS.dealerStaff)
      .post(`/api/contracts/${contract.id}/sign`)
      .send({ signerName: 'Test Buyer', signatureImage: SIGNATURE, declarationAccepted: false });

    expect(res.status).toBe(422);
  });

  it('will not sign the same agreement twice', async () => {
    const { contract } = await registerSale();
    const body = { signerName: 'Test Buyer', signatureImage: SIGNATURE, declarationAccepted: true };

    await as(ACCOUNTS.dealerStaff).post(`/api/contracts/${contract.id}/sign`).send(body);
    const second = await as(ACCOUNTS.dealerStaff).post(`/api/contracts/${contract.id}/sign`).send(body);

    expect(second.status).toBe(409);
  });

  it('does not let one dealership sign another\'s agreement', async () => {
    const { contract } = await registerSale();

    const res = await as(ACCOUNTS.otherDealerAdmin)
      .post(`/api/contracts/${contract.id}/sign`)
      .send({ signerName: 'Test Buyer', signatureImage: SIGNATURE, declarationAccepted: true });

    // 404, not 403 — confirming the record exists would leak that another
    // dealership has a contract with this id.
    expect(res.status).toBe(404);
    expect((await repo.contracts.findById(contract.id))!.status).toBe('DRAFT');
  });
});

describe('a lock rests on the signature', () => {
  it('refuses to lock a device whose agreement is unsigned', async () => {
    const { deviceId } = await registerSale();
    await makeLockable(deviceId);

    const res = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${deviceId}/lock`)
      .send({ reason: 'Installment overdue by nine days.' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not been signed/i);
    expect((await repo.devices.findById(deviceId))!.status).toBe('ACTIVE');
  });

  it('allows the lock once it is signed', async () => {
    const { deviceId, contract } = await registerSale();
    await as(ACCOUNTS.dealerStaff)
      .post(`/api/contracts/${contract.id}/sign`)
      .send({ signerName: 'Test Buyer', signatureImage: SIGNATURE, declarationAccepted: true });
    await makeLockable(deviceId);

    const res = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${deviceId}/lock`)
      .send({ reason: 'Installment overdue by nine days.' });

    expect(res.status).toBe(200);
    expect((await repo.devices.findById(deviceId))!.status).toBe('LOCKED');
  });

  it('refuses again once the agreement is voided', async () => {
    const { deviceId, contract } = await registerSale();
    await as(ACCOUNTS.dealerStaff)
      .post(`/api/contracts/${contract.id}/sign`)
      .send({ signerName: 'Test Buyer', signatureImage: SIGNATURE, declarationAccepted: true });

    await as(ACCOUNTS.dealerAdmin)
      .post(`/api/contracts/${contract.id}/void`)
      .send({ reason: 'Sale cancelled; handset returned to stock.' });

    await makeLockable(deviceId);

    const res = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${deviceId}/lock`)
      .send({ reason: 'Installment overdue.' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/voided/i);
  });

  it('refuses when the plan has been changed since signing', async () => {
    /**
     * The case the hash exists for. A shop that re-signs is fine; a shop that
     * quietly raises the installments on an already-signed agreement and then
     * locks the phone for non-payment of the new figure is not.
     */
    const { deviceId, contract } = await registerSale();
    await as(ACCOUNTS.dealerStaff)
      .post(`/api/contracts/${contract.id}/sign`)
      .send({ signerName: 'Test Buyer', signatureImage: SIGNATURE, declarationAccepted: true });

    const signed = (await repo.contracts.findById(contract.id))!;
    const tampered = JSON.parse(signed.snapshot);
    tampered.plan.monthlyInstallment += 5000;
    await repo.contracts.update(contract.id, { snapshot: JSON.stringify(tampered) });

    await makeLockable(deviceId);

    const res = await as(ACCOUNTS.dealerAdmin)
      .post(`/api/devices/${deviceId}/lock`)
      .send({ reason: 'Installment overdue.' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no longer matches/i);
  });

  it('reports the mismatch on the document rather than hiding it', async () => {
    const { contract } = await registerSale();
    await as(ACCOUNTS.dealerStaff)
      .post(`/api/contracts/${contract.id}/sign`)
      .send({ signerName: 'Test Buyer', signatureImage: SIGNATURE, declarationAccepted: true });

    const before = await as(ACCOUNTS.dealerAdmin).get(`/api/contracts/${contract.id}`);
    expect(before.body.hashMatches).toBe(true);

    const signed = (await repo.contracts.findById(contract.id))!;
    const tampered = JSON.parse(signed.snapshot);
    tampered.customer.name = 'Somebody Else';
    await repo.contracts.update(contract.id, { snapshot: JSON.stringify(tampered) });

    const after = await as(ACCOUNTS.dealerAdmin).get(`/api/contracts/${contract.id}`);
    expect(after.body.hashMatches).toBe(false);
  });
});

describe('reading the document', () => {
  it('renders the clauses in both languages, with the restriction clause present', async () => {
    const { contract } = await registerSale();

    const res = await as(ACCOUNTS.dealerStaff).get(`/api/contracts/${contract.id}`);
    expect(res.status).toBe(200);

    const restriction = res.body.clauses.find((c: any) => /restriction of the device/i.test(c.heading));
    expect(restriction).toBeTruthy();
    expect(restriction.bodyUr.length).toBeGreaterThan(50);
    // The limits are part of the clause, not only the power it grants.
    expect(restriction.body).toMatch(/emergency calls/i);
    expect(restriction.body).toMatch(/does not read/i);
  });

  it('lets the customer read their own agreement', async () => {
    const device = (await repo.devices.findFirst({ dealerId: 'dealer-1', customerId: 'cust-1' }))!;
    const contract = (await repo.contracts.findByDevice(device.id))!;

    const res = await as(ACCOUNTS.customer).get(`/api/contracts/${contract.id}`);
    expect(res.status).toBe(200);
    expect(res.body.contract.id).toBe(contract.id);
  });

  it('does not let a customer read somebody else\'s', async () => {
    const { contract } = await registerSale();

    const res = await as(ACCOUNTS.customer).get(`/api/contracts/${contract.id}`);
    expect(res.status).toBe(404);
  });

  it('does not let one dealership read another\'s', async () => {
    const { contract } = await registerSale();

    const res = await as(ACCOUNTS.otherDealerAdmin).get(`/api/contracts/${contract.id}`);
    expect(res.status).toBe(404);
  });

  it('keeps the signature image off the list', async () => {
    const { contract } = await registerSale();
    await as(ACCOUNTS.dealerStaff)
      .post(`/api/contracts/${contract.id}/sign`)
      .send({ signerName: 'Test Buyer', signatureImage: SIGNATURE, declarationAccepted: true });

    const res = await as(ACCOUNTS.dealerAdmin).get('/api/contracts?limit=100');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('data:image/png');
  });
});
