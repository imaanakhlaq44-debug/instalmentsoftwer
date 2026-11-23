import { beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest';
import { as, reseed, ACCOUNTS } from '../helpers.js';
import { prisma, disconnectDatabase } from '../../src/db/prisma.js';
beforeEach(async () => { await reseed(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-17T19:30:00Z')); }, 60000);
afterEach(() => vi.useRealTimers());
afterAll(disconnectDatabase);
async function payment(id: string, amount: number, createdAt: string, extra: any = {}) {
  return prisma.payment.create({ data: { id, dealerId: 'dealer-1', customerId: 'cust-1', amount, paymentMethod: 'CASH', referenceNumber: id, status: 'VERIFIED', createdAt: new Date(createdAt), ...extra } });
}
it('counts only verified, unreversed payments inside the Pakistan calendar day', async () => {
  await prisma.payment.updateMany({ data: { createdAt: new Date('2000-01-01') } });
  await payment('before-pk-day', 1000, '2026-11-17T18:59:59Z');
  await payment('start-pk-day', 2000, '2026-11-17T19:00:00Z');
  await payment('last-pk-day', 3000, '2026-11-18T18:59:59Z');
  await payment('next-pk-day', 4000, '2026-11-18T19:00:00Z');
  await payment('pending-today', 5000, '2026-11-17T19:10:00Z', { status: 'PENDING' });
  await payment('reversed-today', 6000, '2026-11-17T19:10:00Z', { reversedAt: new Date() });
  const result = await as(ACCOUNTS.dealerAdmin).get('/api/dashboard/stats').expect(200);
  expect(result.body.businessDate).toBe('2026-11-18'); expect(result.body.collectedToday).toBe(5000);
  expect((await as(ACCOUNTS.otherDealerAdmin).get('/api/dashboard/stats')).body.collectedToday).toBe(0);
});
it('keeps customer daily figures limited to that customer', async () => {
  await prisma.payment.updateMany({ data: { createdAt: new Date('2000-01-01') } });
  await payment('my-today', 2000, '2026-11-17T19:01:00Z');
  const other = await prisma.customer.findFirstOrThrow({ where: { dealerId: 'dealer-1', id: { not: 'cust-1' } } });
  await payment('another-customer', 3000, '2026-11-17T19:02:00Z', { customerId: other.id });
  expect((await as(ACCOUNTS.customer).get('/api/dashboard/stats')).body.collectedToday).toBe(2000);
  expect((await as(ACCOUNTS.dealerAdmin).get('/api/dashboard/stats')).body.collectedToday).toBe(5000);
});
it('counts today scheduled and paid installments from stored rows', async () => {
  await prisma.installment.updateMany({ data: { dueDate: new Date('2000-01-01') } });
  const rows = await prisma.installment.findMany({ where: { dealerId: 'dealer-1' }, take: 3 });
  for (let i = 0; i < rows.length; i++) await prisma.installment.update({ where: { id: rows[i].id }, data: { dueDate: new Date('2026-11-18'), status: i ? 'DUE_SOON' : 'PAID' } });
  const result = await as(ACCOUNTS.dealerAdmin).get('/api/dashboard/stats').expect(200);
  expect(result.body.dueTodayCount).toBe(3); expect(result.body.paidDueTodayCount).toBe(1);
});
