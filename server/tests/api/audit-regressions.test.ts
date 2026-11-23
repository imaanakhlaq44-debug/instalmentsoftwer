import { beforeEach, afterAll, it, expect } from 'vitest';
import { repo, reseed, as, ACCOUNTS, tokenFor, SEED_PASSWORD } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { PaymentService } from '../../src/services/PaymentService.js';
const actor = { userId: ACCOUNTS.dealerAdmin, userName: 'Audit', userRole: 'DEALER_ADMIN' as const };
const pay = (referenceNumber: string, amount: number, extra = {}) => PaymentService.recordPayment({ dealerId: 'dealer-1', customerId: 'cust-1', planId: 'plan-1', amount, paymentMethod: 'CASH', referenceNumber, actor, ...extra });
beforeEach(reseed); afterAll(disconnectDatabase);
it('applies simultaneous verification exactly once', async () => {
  const p = await pay('concurrent', 1000, { autoVerify: false });
  const results = await Promise.allSettled([PaymentService.verifyPayment(p.payment.id, actor), PaymentService.verifyPayment(p.payment.id, actor)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect((await repo.installmentPlans.findById('plan-1'))!.remainingBalance).toBe(26000);
});
it('preserves outstanding principal when rescheduling a partial payment', async () => {
  await pay('partial', 2000);
  const r = await as(ACCOUNTS.dealerAdmin).post('/api/installments/plans/plan-1/reschedule').send({ totalInstallments: 4, firstDueDate: '2027-01-01', reason: 'Customer requested a revised schedule' });
  expect(r.status).toBe(200);
  const rows = await repo.installments.findByPlan('plan-1');
  expect(rows.reduce((n, i) => n + i.amountDue - i.amountPaid, 0)).toBe(25000);
});
it('hides nested private device and customer fields from staff', async () => {
  const plan = (await repo.installmentPlans.findById('plan-1'))!;
  await repo.devices.update(plan.deviceId, { authTokenHash: 'a'.repeat(64), locationLat: 31.5, locationLng: 74.3 });
  const r = await as(ACCOUNTS.dealerAdmin).get('/api/installments/plans/plan-1');
  expect(r.status).toBe(200);
  expect(r.body.device.authTokenHash).toBeUndefined(); expect(r.body.device.locationLat).toBeUndefined();
  expect(r.body.customer.cnic).toContain('*******');
});
it('revokes old session and supplies a working replacement on password change', async () => {
  const old = tokenFor(ACCOUNTS.dealerAdmin);
  const r = await as(ACCOUNTS.dealerAdmin).post('/api/auth/change-password').send({ currentPassword: SEED_PASSWORD, newPassword: 'AuditChanged#2026' });
  expect(r.status).toBe(200); expect(r.body.session.token).toBeTruthy();
  const request = (await import('supertest')).default;
  const { app } = await import('../helpers.js');
  expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${old}`)).status).toBe(401);
  expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.session.token}`)).status).toBe(200);
});
it('reverses the original targeted allocation and reconciles cash totals', async () => {
  const a = await pay('first', 6750, { installmentId: 'inst-1-3' });
  await pay('second', 6750, { installmentId: 'inst-1-4' });
  await PaymentService.reversePayment({ paymentId: a.payment.id, reason: 'Incorrect payment entered', actor });
  expect((await repo.installments.findById('inst-1-3'))!.amountPaid).toBe(0);
  expect((await repo.installments.findById('inst-1-4'))!.amountPaid).toBe(6750);
  expect((await repo.transactions.totals({ paymentId: a.payment.id })).net).toBe(0);
});
it('counts late-fee allocations as part of cash received', async () => {
  await repo.installments.update('inst-1-3', { lateFee: 500, lateFeePaid: 0, status: 'OVERDUE' });
  const p = await pay('fee', 1000);
  expect((await repo.transactions.totals({ paymentId: p.payment.id })).inflow).toBe(1000);
});
it('issues distinct receipts for concurrent payments', async () => {
  const [a,b] = await Promise.all([pay('receipt-a', 100),pay('receipt-b', 100)]);
  expect(a.payment.receiptNumber).not.toBe(b.payment.receiptNumber);
});
it('settles a principal-paid installment after fee waiver', async () => {
  await repo.installments.update('inst-1-3', { amountPaid: 6750, lateFee: 500, lateFeePaid: 0, status: 'OVERDUE' });
  const r=await as(ACCOUNTS.dealerAdmin).post('/api/installments/inst-1-3/waive-late-fee').send({ reason: 'Customer hardship fee waiver' });
  expect(r.status).toBe(200); expect((await repo.installments.findById('inst-1-3'))!.status).toBe('PAID');
});

it('dealer-triggered evaluation leaves the other dealer unchanged', async () => {
  const before = await repo.installments.findMany({ where: { dealerId: 'dealer-2' }, orderBy: { id: 'asc' } });
  const r = await as(ACCOUNTS.dealerAdmin).post('/api/installments/evaluate-overdue').send({});
  expect(r.status).toBe(200);
  expect(await repo.installments.findMany({ where: { dealerId: 'dealer-2' }, orderBy: { id: 'asc' } })).toEqual(before);
});
it('logout revokes the old bearer token', async () => {
  const request = (await import('supertest')).default;
  const { app } = await import('../helpers.js');
  const token = tokenFor(ACCOUNTS.dealerAdmin);
  expect((await request(app).post('/api/auth/logout').set('Authorization', 'Bearer ' + token)).status).toBe(200);
  expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer ' + token)).status).toBe(401);
});
it('retries a failed lock for an installment already marked overdue', async () => {
  const { vi } = await import('vitest');
  const { deviceManagementService } = await import('../../src/services/DeviceManagementService.js');
  const { OverdueEngine } = await import('../../src/services/OverdueEngine.js');
  await repo.installments.updateMany({ dealerId: 'dealer-1' }, { dueDate: '2099-01-01', graceDate: '2099-01-04' });
  await repo.installments.update('inst-1-3', { dueDate: '2026-01-01', graceDate: '2026-01-04', status: 'OVERDUE' });
  const plan = (await repo.installmentPlans.findById('plan-1'))!;
  const device = (await repo.devices.findById(plan.deviceId))!;
  const policy = (await repo.devicePolicies.findByDealer('dealer-1'))!;
  await repo.devices.update(device.id, { status: 'ACTIVE' });
  await repo.devicePolicies.update(policy.id, { autoLockEnabled: true, stagedRestrictionsEnabled: false });
  const lock = vi.spyOn(deviceManagementService, 'lockDevice').mockRejectedValueOnce(new Error('Temporary failure')).mockResolvedValueOnce(device);
  try {
    await OverdueEngine.runEvaluation('2026-11-17', 'dealer-1');
    await OverdueEngine.runEvaluation('2026-11-17', 'dealer-1');
    expect(lock).toHaveBeenCalledTimes(2);
  } finally { lock.mockRestore(); }
});
