import { beforeEach, afterAll, it, expect } from 'vitest';
import { as, reseed, repo, ACCOUNTS } from '../helpers.js';
import { prisma, disconnectDatabase } from '../../src/db/prisma.js';
beforeEach(async () => { await reseed(); }, 60000);
afterAll(disconnectDatabase);
const sale = {
  customer: { name: 'Signed Sale Buyer', cnic: '35202-1234567-1', phone: '0300-1112233', address: 'House 1 Test Street Lahore', emergencyContactName: 'Next Contact', emergencyContactPhone: '0300-4445566' },
  device: { brand: 'Samsung', model: 'Galaxy A15', imei: '490154203237518', purchasePrice: 55000 },
  plan: { downPayment: 15000, totalInstallments: 6, firstDueDate: '2026-12-20' },
};
const actor = () => as(ACCOUNTS.dealerAdmin);
async function agreement() { const preview = await actor().post('/api/customers/agreement-preview').send(sale).expect(200); return { signerName: sale.customer.name,
  signatureImage: 'data:image/png;base64,c2lnbmF0dXJl', declarationAccepted: true, termsVersion: preview.body.termsVersion, fingerprint: preview.body.fingerprint }; }
async function counts() { return Promise.all([prisma.customer.count(), prisma.device.count(), prisma.contract.count(), prisma.installmentPlan.count(), prisma.transaction.count()]); }
it('previews the real bilingual agreement and exact schedule without creating records', async () => {
  const before = await counts(); const preview = await actor().post('/api/customers/agreement-preview').send(sale).expect(200);
  expect(preview.body.clauses.length).toBeGreaterThan(0); expect(preview.body.declaration.ur).toBeTruthy();
  expect(preview.body.snapshot.schedule.reduce((sum: number, row: any) => sum + row.amountDue, 0)).toBe(40000);
  expect(await counts()).toEqual(before);
});
it('saves the sale, signature, exact snapshot and audit together', async () => {
  const signed = await agreement(); const response = await actor().post('/api/customers').send({ ...sale, agreement: signed }).expect(201);
  expect(response.body.contractStatus).toBe('SIGNED'); const doc = await repo.contracts.findById(response.body.contractId);
  expect(doc?.signatureImage).toBe(signed.signatureImage); expect(doc?.signerName).toBe(sale.customer.name);
  const rendered = await actor().get('/api/contracts/' + response.body.contractId).expect(200); expect(rendered.body.hashMatches).toBe(true); expect(rendered.body.planMatches).toBe(true);
});
it('refuses changed figures and rolls back customer, plan, signature and money records', async () => {
  const signed = await agreement(), before = await counts();
  await actor().post('/api/customers').send({ ...sale, device: { ...sale.device, purchasePrice: 60000 }, agreement: signed }).expect(409);
  expect(await counts()).toEqual(before);
});
it('refuses changed shop policy after preview instead of signing unseen terms', async () => {
  const signed = await agreement(), before = await counts(); const policy = await repo.devicePolicies.findByDealer('dealer-1');
  await repo.devicePolicies.update(policy!.id, { lateFeeAmount: (policy!.lateFeeAmount ?? 0) + 50 });
  await actor().post('/api/customers').send({ ...sale, agreement: signed }).expect(409); expect(await counts()).toEqual(before);
});
it('requires explicit acceptance and a signature when inline signing is requested', async () => {
  const signed = await agreement(), before = await counts();
  await actor().post('/api/customers').send({ ...sale, agreement: { ...signed, declarationAccepted: false } }).expect(422);
  await actor().post('/api/customers').send({ ...sale, agreement: { ...signed, signatureImage: '' } }).expect(422);
  expect(await counts()).toEqual(before);
});
it('does not let a shop prepare another shop agreement', async () => {
  await actor().post('/api/customers/agreement-preview').send({ ...sale, dealerId: 'dealer-2' }).expect(403);
});
