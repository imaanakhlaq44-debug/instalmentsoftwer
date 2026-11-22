import { beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest';
import { as, reseed, ACCOUNTS } from '../helpers.js';
import { prisma, disconnectDatabase } from '../../src/db/prisma.js';

/**
 * GET /api/dashboard/today — the shop app home's "who owes money today" list.
 * 2026-11-17T19:30Z is already 18 Nov in Pakistan.
 */
beforeEach(async () => {
  await reseed();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T19:30:00Z'));
}, 60000);
afterEach(() => vi.useRealTimers());
afterAll(disconnectDatabase);

/** Moves every dealer-1 installment out of the way, then dates the given plan rows. */
async function isolate() {
  await prisma.installment.updateMany({ data: { dueDate: new Date('2099-01-01'), status: 'PENDING' } });
  const plans = await prisma.installmentPlan.findMany({ where: { dealerId: 'dealer-1', status: { not: 'CANCELLED' } }, orderBy: { id: 'asc' }, take: 3 });
  const rowsOf = (planId: string) => prisma.installment.findMany({ where: { planId }, orderBy: { installmentNumber: 'asc' } });
  return { plans, rowsOf };
}

it('lists one card per plan: due today first, then late plans, with amounts summed', async () => {
  const { plans, rowsOf } = await isolate();
  const [todayPlan, latePlan, paidPlan] = plans;

  const t = await rowsOf(todayPlan.id);
  await prisma.installment.update({ where: { id: t[0].id }, data: { dueDate: new Date('2026-11-18'), status: 'DUE_TODAY', amountPaid: 0 } });

  const l = await rowsOf(latePlan.id);
  await prisma.installment.update({ where: { id: l[0].id }, data: { dueDate: new Date('2026-11-13'), status: 'OVERDUE', amountPaid: 0 } });
  await prisma.installment.update({ where: { id: l[1].id }, data: { dueDate: new Date('2026-11-15'), status: 'OVERDUE', amountPaid: 0 } });

  const p = await rowsOf(paidPlan.id);
  await prisma.installment.update({ where: { id: p[0].id }, data: { dueDate: new Date('2026-11-18'), status: 'PAID', amountPaid: p[0].amountDue } });

  const res = await as(ACCOUNTS.dealerStaff).get('/api/dashboard/today').expect(200);
  expect(res.body.businessDate).toBe('2026-11-18');
  expect(res.body.total).toBe(2);
  expect(res.body.dueTodayCount).toBe(1);
  expect(res.body.lateCount).toBe(1);
  const [first, second] = res.body.customers;
  expect(first.planId).toBe(todayPlan.id);
  expect(first.daysLate).toBe(0);
  expect(second.planId).toBe(latePlan.id);
  expect(second.daysLate).toBe(5);
  expect(second.installmentsDue).toBe(2);
  expect(second.amountDue).toBeGreaterThanOrEqual(Number(l[0].amountDue) + Number(l[1].amountDue));
  expect(second.installmentId).toBe(l[0].id);
  expect(first.totalInstallments).toBe(todayPlan.totalInstallments);
  expect(typeof first.customerName).toBe('string');
});

it('honours the limit but still reports the full count', async () => {
  const { plans, rowsOf } = await isolate();
  for (const plan of plans) {
    const [row] = await rowsOf(plan.id);
    await prisma.installment.update({ where: { id: row.id }, data: { dueDate: new Date('2026-11-18'), status: 'DUE_TODAY', amountPaid: 0 } });
  }
  const res = await as(ACCOUNTS.dealerAdmin).get('/api/dashboard/today?limit=1').expect(200);
  expect(res.body.customers).toHaveLength(1);
  expect(res.body.total).toBe(plans.length);
});

it('is scoped to the shop and closed to customers', async () => {
  const { plans, rowsOf } = await isolate();
  const [row] = await rowsOf(plans[0].id);
  await prisma.installment.update({ where: { id: row.id }, data: { dueDate: new Date('2026-11-18'), status: 'DUE_TODAY', amountPaid: 0 } });

  expect((await as(ACCOUNTS.otherDealerAdmin).get('/api/dashboard/today').expect(200)).body.customers.every((c: { planId: string }) => c.planId !== plans[0].id)).toBe(true);
  await as(ACCOUNTS.customer).get('/api/dashboard/today').expect(403);
});
