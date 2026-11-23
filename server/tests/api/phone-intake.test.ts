import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { prisma, disconnectDatabase } from '../../src/db/prisma.js';
import { config } from '../../src/config.js';

const dpc = config.dpc as { apkUrl: string; apkSignatureChecksum: string; serverUrl: string };
const original = { ...dpc };
beforeEach(async () => { await reseed(); Object.assign(dpc, { apkUrl: 'https://example.invalid/dpc.apk', apkSignatureChecksum: 'test', serverUrl: 'https://example.invalid/api/dpc' }); }, 60000);
afterAll(async () => { Object.assign(dpc, original); await disconnectDatabase(); });
const report = { brand: 'Samsung', model: 'SM-A155F', osVersion: '14', imeis: ['490154203237518'], serialNumber: 'SCAN-SERIAL-01', isDeviceOwner: true, dpcVersion: '1.6.0' };
async function scan() {
  const response = await as(ACCOUNTS.dealerAdmin).post('/api/enrollment/phone-intakes').send({}).expect(201);
  const token = (await repo.enrollmentTokens.findById(response.body.tokenId))!;
  return { ...response.body, code: token.token };
}
const sale = {
  customer: { name: 'Scan Test Customer', cnic: '35202-1234567-1', phone: '0300-1112233', address: 'House 1, Test Street, Lahore', emergencyContactName: 'Scan Contact', emergencyContactPhone: '0300-4445566' },
  device: { brand: 'Samsung', model: 'SM-A155F', imei: report.imeis[0], serialNumber: report.serialNumber, purchasePrice: 55000 },
  plan: { downPayment: 15000, totalInstallments: 6, firstDueDate: '2026-12-20' },
};
describe('welcome-screen scan before a sale', () => {
  it('collects details without creating a customer, device, sale or spending a lock', async () => {
    const devices = await repo.devices.count(); const customers = await repo.customers.count();
    const locks = await repo.deviceLicenses.countAvailable('dealer-1');
    const s = await scan();
    expect(s.qrImageDataUrl).toMatch(/^data:image\/png;base64,/);
    const response = await anonymous().post('/api/dpc/enroll').send({ token: s.code, ...report }).expect(202);
    expect(response.body.intakePending).toBe(true); expect(response.body.deviceToken).toBeUndefined();
    const result = await as(ACCOUNTS.dealerAdmin).get(`/api/enrollment/phone-intakes/${s.id}`).expect(200);
    expect(result.body.report.model).toBe(report.model); expect(result.body.status).toBe('RECEIVED');
    expect(await repo.devices.count()).toBe(devices); expect(await repo.customers.count()).toBe(customers);
    expect(await repo.deviceLicenses.countAvailable('dealer-1')).toBe(locks);
  });
  it('binds the same QR to the sale and then enrolls the phone', async () => {
    const s = await scan();
    await anonymous().post('/api/dpc/enroll').send({ token: s.code, ...report }).expect(202);
    const response = await as(ACCOUNTS.dealerAdmin).post('/api/customers').send({ ...sale, phoneIntakeId: s.id }).expect(201);
    expect(response.body.enrollmentToken.token).toBe(s.code);
    const enrolled = await anonymous().post('/api/dpc/enroll').send({ token: s.code, ...report }).expect(201);
    expect(enrolled.body.deviceId).toBe(response.body.device.id);
    expect(enrolled.body.deviceToken).toEqual(expect.any(String));
    const duplicate = await as(ACCOUNTS.dealerAdmin).post('/api/customers').send({ ...sale, phoneIntakeId: s.id });
    expect(duplicate.status).not.toBe(201);
  });
  it('keeps other shops and customers out of a scan', async () => {
    const s = await scan();
    await as(ACCOUNTS.otherDealerAdmin).get(`/api/enrollment/phone-intakes/${s.id}`).expect(404);
    await as(ACCOUNTS.customer).get(`/api/enrollment/phone-intakes/${s.id}`).expect(403);
    await anonymous().get(`/api/enrollment/phone-intakes/${s.id}`).expect(401);
    await as(ACCOUNTS.dealerAdmin).post('/api/enrollment/phone-intakes').send({ dealerId: 'dealer-2' }).expect(403);
  });
  it('cannot replace one scanned phone with another', async () => {
    const s = await scan();
    await anonymous().post('/api/dpc/enroll').send({ token: s.code, ...report }).expect(202);
    await anonymous().post('/api/dpc/enroll').send({ token: s.code, ...report, serialNumber: 'OTHER' }).expect(409);
    await anonymous().post('/api/dpc/enroll').send({ token: s.code, ...report }).expect(202);
  });
  it('rolls back a sale with an IMEI that differs from the scanned phone', async () => {
    const s = await scan(); const count = await repo.customers.count();
    await anonymous().post('/api/dpc/enroll').send({ token: s.code, ...report }).expect(202);
    await as(ACCOUNTS.dealerAdmin).post('/api/customers').send({ ...sale, device: { ...sale.device, imei: '356938035643809' }, phoneIntakeId: s.id }).expect(400);
    expect(await repo.customers.count()).toBe(count);
    expect((await prisma.phoneIntake.findUnique({ where: { id: s.id } }))?.deviceId).toBeNull();
  });
  it('refuses cancelled and expired QR codes', async () => {
    const s = await scan();
    await as(ACCOUNTS.dealerAdmin).post(`/api/enrollment/tokens/${s.tokenId}/revoke`).send({}).expect(200);
    const cancelled = await anonymous().post('/api/dpc/enroll').send({ token: s.code, ...report }).expect(200);
    expect(cancelled.body.intakeCancelled).toBe(true);
    const other = await scan();
    await prisma.enrollmentToken.update({ where: { id: other.tokenId }, data: { expiresAt: new Date(0) } });
    const expired = await anonymous().post('/api/dpc/enroll').send({ token: other.code, ...report }).expect(200);
    expect(expired.body.intakeCancelled).toBe(true);
  });
  it('requires Device Owner and usable hardware identity', async () => {
    const s = await scan();
    await anonymous().post('/api/dpc/enroll').send({ token: s.code, ...report, isDeviceOwner: false }).expect(400);
    await anonymous().post('/api/dpc/enroll').send({ token: s.code, ...report, imeis: [], serialNumber: 'unknown' }).expect(400);
  });
  it('refuses creating a welcome-screen QR when provisioning is not configured', async () => {
    dpc.apkUrl = '';
    await as(ACCOUNTS.dealerAdmin).post('/api/enrollment/phone-intakes').send({}).expect(400);
    expect(await prisma.phoneIntake.count()).toBe(0);
  });
});
