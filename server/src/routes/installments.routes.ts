import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { db } from '../db/db.js';
import {
  Installment, InstallmentPlan, Customer, Device, Transaction, DevicePolicy,
} from '../types/index.js';
import { OverdueEngine } from '../services/OverdueEngine.js';
import { buildInstallmentSchedule, amountOutstanding, DEFAULT_POLICY } from '../services/InstallmentMath.js';
import { AuditService } from '../services/AuditService.js';
import {
  requireDealerAdmin, getAuthUser, resolveDealerScope, assertDealerAccess, clientIp,
  routeParam,
} from '../middleware/auth.js';
import { validateBody, validateQuery, getQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { maskImei } from '../utils/mask.js';
import { isoDateSchema, paginationSchema, paginate } from '../utils/validators.js';

export const installmentsRouter = Router();

// ---------------------------------------------------------------------------
// PLANS
// ---------------------------------------------------------------------------

const plansQuerySchema = paginationSchema.extend({
  status: z.string().trim().max(20).optional(),
  search: z.string().trim().max(120).optional(),
  dealerId: z.string().trim().max(64).optional(),
});

installmentsRouter.get('/plans', validateQuery(plansQuerySchema), (req, res) => {
  const user = getAuthUser(req);
  const scope = resolveDealerScope(req);
  const q = getQuery<z.infer<typeof plansQuerySchema>>(req);

  const customersById = db.indexBy<Customer>('customers', (c) => c.id);
  const devicesById = db.indexBy<Device>('devices', (d) => d.id);
  const installmentsByPlan = db.groupBy<Installment>('installments', (i) => i.planId);

  let plans = db.find<InstallmentPlan>('installmentPlans', (p) => {
    if (scope !== null && p.dealerId !== scope) return false;
    if (user.role === 'CUSTOMER' && p.customerId !== user.customerId) return false;
    if (q.status && q.status !== 'ALL' && p.status !== q.status) return false;
    return true;
  });

  if (q.search) {
    const needle = q.search.toLowerCase();
    plans = plans.filter((p) => {
      const customer = customersById.get(p.customerId);
      const device = devicesById.get(p.deviceId);
      return (
        (customer?.name.toLowerCase().includes(needle) ?? false) ||
        (device?.model.toLowerCase().includes(needle) ?? false) ||
        (device?.brand.toLowerCase().includes(needle) ?? false) ||
        p.id.toLowerCase().includes(needle)
      );
    });
  }

  plans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const page = paginate(plans, { page: q.page, limit: q.limit });

  const enriched = page.data.map((p) => {
    const customer = customersById.get(p.customerId);
    const device = devicesById.get(p.deviceId);
    const rows = installmentsByPlan.get(p.id) ?? [];
    const unpaid = rows.filter((i) => i.status !== 'PAID').sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    return {
      ...p,
      customerName: customer?.name ?? 'Unknown',
      customerPhone: customer?.phone ?? 'N/A',
      deviceBrand: device?.brand ?? 'N/A',
      deviceModel: device?.model ?? 'N/A',
      deviceImei: maskImei(device?.imei),
      deviceStatus: device?.status ?? 'UNKNOWN',
      nextDueDate: unpaid[0]?.dueDate ?? null,
      nextDueAmount: unpaid[0] ? amountOutstanding(unpaid[0]) : 0,
      overdueInstallmentsCount: rows.filter((i) => i.status === 'OVERDUE').length,
      totalOverdueAmount: rows.filter((i) => i.status === 'OVERDUE').reduce((s, i) => s + amountOutstanding(i), 0),
      progressPercentage: p.totalInstallments > 0 ? Math.round((p.paidInstallments / p.totalInstallments) * 100) : 0,
    };
  });

  res.json({ ...page, data: enriched });
});

/** Full plan detail including the schedule and a payoff quote. */
installmentsRouter.get('/plans/:id', (req, res) => {
  const user = getAuthUser(req);
  const plan = db.findById<InstallmentPlan>('installmentPlans', routeParam(req, 'id'));
  if (!plan) throw AppError.notFound('Installment plan');

  assertDealerAccess(req, plan.dealerId, 'installment plan');
  if (user.role === 'CUSTOMER' && plan.customerId !== user.customerId) {
    throw AppError.notFound('Installment plan');
  }

  const installments = db
    .find<Installment>('installments', (i) => i.planId === plan.id)
    .sort((a, b) => a.installmentNumber - b.installmentNumber);

  const unpaid = installments.filter((i) => i.status !== 'PAID');
  const payoffAmount = Math.max(0, unpaid.reduce((s, i) => s + amountOutstanding(i), 0) - (plan.creditBalance ?? 0));

  res.json({
    plan,
    installments,
    customer: db.findById<Customer>('customers', plan.customerId) ?? null,
    device: db.findById<Device>('devices', plan.deviceId) ?? null,
    payoff: {
      amount: payoffAmount,
      remainingInstallments: unpaid.length,
      outstandingLateFees: plan.outstandingLateFees ?? 0,
      creditApplied: plan.creditBalance ?? 0,
    },
  });
});

// ---------------------------------------------------------------------------
// INSTALLMENT ROWS
// ---------------------------------------------------------------------------

const listQuerySchema = paginationSchema.extend({
  planId: z.string().trim().max(64).optional(),
  status: z.string().trim().max(20).optional(),
  customerId: z.string().trim().max(64).optional(),
  dueBefore: z.string().trim().max(30).optional(),
  dealerId: z.string().trim().max(64).optional(),
});

installmentsRouter.get('/', validateQuery(listQuerySchema), (req, res) => {
  const user = getAuthUser(req);
  const scope = resolveDealerScope(req);
  const q = getQuery<z.infer<typeof listQuerySchema>>(req);

  const rows = db.find<Installment>('installments', (i) => {
    if (scope !== null && i.dealerId !== scope) return false;
    if (user.role === 'CUSTOMER' && i.customerId !== user.customerId) return false;
    if (q.planId && i.planId !== q.planId) return false;
    if (q.customerId && i.customerId !== q.customerId) return false;
    if (q.status && q.status !== 'ALL' && i.status !== q.status) return false;
    if (q.dueBefore && i.dueDate > q.dueBefore) return false;
    return true;
  });

  rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const page = paginate(rows, { page: q.page, limit: q.limit });

  res.json({
    ...page,
    data: page.data.map((i) => ({ ...i, totalOutstanding: amountOutstanding(i) })),
  });
});

// ---------------------------------------------------------------------------
// OVERDUE ENGINE
// ---------------------------------------------------------------------------

const evaluateSchema = z.object({
  referenceDate: isoDateSchema.optional(),
});

installmentsRouter.post(
  '/evaluate-overdue',
  requireDealerAdmin,
  validateBody(evaluateSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const body = req.body as z.infer<typeof evaluateSchema>;

    // Back-dating the evaluation rewrites history; keep it to super admins.
    if (body.referenceDate && user.role !== 'SUPER_ADMIN') {
      throw AppError.forbidden('Only a super admin may run the overdue evaluation against a custom date.');
    }

    const result = await OverdueEngine.runEvaluation(body.referenceDate);

    res.json({
      success: true,
      message:
        `Evaluated ${result.evaluatedCount} installments. ` +
        `${result.newlyOverdueCount} newly overdue, ${result.devicesLockedCount} auto-locked, ` +
        `${result.lateFeesCharged} late fee(s) charged.`,
      data: result,
    });
  })
);

// ---------------------------------------------------------------------------
// LATE FEE WAIVER — dealers routinely forgive a penalty; there was no way to
// ---------------------------------------------------------------------------

const waiveSchema = z.object({
  reason: z.string().trim().min(10, 'Please record why the late fee is being waived.').max(500),
});

installmentsRouter.post('/:id/waive-late-fee', requireDealerAdmin, validateBody(waiveSchema), (req, res) => {
  const user = getAuthUser(req);
  const inst = db.findById<Installment>('installments', routeParam(req, 'id'));
  if (!inst) throw AppError.notFound('Installment');
  assertDealerAccess(req, inst.dealerId, 'installment');

  const outstandingFee = Math.max(0, (inst.lateFee ?? 0) - (inst.lateFeePaid ?? 0));
  if (outstandingFee <= 0) {
    throw AppError.badRequest('This installment has no outstanding late fee to waive.');
  }

  const reason = (req.body as z.infer<typeof waiveSchema>).reason;
  const nowIso = new Date().toISOString();

  db.batch(() => {
    db.update<Installment>('installments', inst.id, {
      lateFee: inst.lateFeePaid ?? 0,
      lateFeeWaivedAt: nowIso,
      lateFeeWaivedBy: user.userId,
      lateFeeWaiverReason: reason,
    });

    db.insert<Transaction>('transactions', {
      id: `tx-${uuidv4().substring(0, 8)}`,
      dealerId: inst.dealerId,
      customerId: inst.customerId,
      planId: inst.planId,
      type: 'LATE_FEE_WAIVER',
      amount: -outstandingFee,
      status: 'COMPLETED',
      date: nowIso,
      notes: `Late fee of Rs. ${outstandingFee.toLocaleString()} waived on installment #${inst.installmentNumber}. Reason: ${reason}`,
    });

    const remaining = db
      .find<Installment>('installments', (i) => i.planId === inst.planId)
      .reduce((s, i) => s + Math.max(0, (i.lateFee ?? 0) - (i.lateFeePaid ?? 0)), 0);
    db.update<InstallmentPlan>('installmentPlans', inst.planId, { outstandingLateFees: remaining });
  });

  AuditService.log({
    dealerId: inst.dealerId,
    userId: user.userId,
    actorName: user.name,
    actorRole: user.role,
    action: 'LATE_FEE_WAIVED',
    targetType: 'INSTALLMENT',
    targetId: inst.id,
    details: `Waived Rs. ${outstandingFee.toLocaleString()} of late fees on installment #${inst.installmentNumber}. Reason: ${reason}`,
    ipAddress: clientIp(req),
  });

  res.json({ success: true, waivedAmount: outstandingFee, message: 'Late fee waived.' });
});

// ---------------------------------------------------------------------------
// RESCHEDULE — when a customer genuinely cannot pay, the alternative to
// locking their phone is restructuring the plan. There was no such option.
// ---------------------------------------------------------------------------

const rescheduleSchema = z.object({
  totalInstallments: z.number().int().min(1).max(60),
  firstDueDate: isoDateSchema,
  gracePeriodDays: z.number().int().min(0).max(30).optional(),
  reason: z.string().trim().min(10, 'Please record why the plan is being restructured.').max(500),
});

installmentsRouter.post('/plans/:id/reschedule', requireDealerAdmin, validateBody(rescheduleSchema), (req, res) => {
  const user = getAuthUser(req);
  const plan = db.findById<InstallmentPlan>('installmentPlans', routeParam(req, 'id'));
  if (!plan) throw AppError.notFound('Installment plan');
  assertDealerAccess(req, plan.dealerId, 'installment plan');

  if (plan.status === 'COMPLETED' || plan.status === 'CANCELLED') {
    throw AppError.badRequest(`A ${plan.status.toLowerCase()} plan cannot be rescheduled.`);
  }

  const body = req.body as z.infer<typeof rescheduleSchema>;
  const existing = db.find<Installment>('installments', (i) => i.planId === plan.id);
  const paidRows = existing.filter((i) => i.amountPaid > 0 || i.status === 'PAID');
  const unpaidRows = existing.filter((i) => i.amountPaid === 0 && i.status !== 'PAID');

  const principalPaid = existing.reduce((s, i) => s + i.amountPaid, 0);
  const outstandingPrincipal = Math.max(0, plan.financedAmount - principalPaid);

  if (outstandingPrincipal <= 0) {
    throw AppError.badRequest('There is no outstanding balance left to reschedule.');
  }

  const grace = body.gracePeriodDays ?? plan.gracePeriodDays;
  const schedule = buildInstallmentSchedule({
    financedAmount: outstandingPrincipal,
    totalInstallments: body.totalInstallments,
    firstDueDate: body.firstDueDate,
    gracePeriodDays: grace,
  });

  const nowIso = new Date().toISOString();

  const created = db.batch(() => {
    // Paid and partially-paid rows are history and stay exactly as they are.
    for (const row of unpaidRows) {
      db.delete('installments', row.id);
    }

    const rows = schedule.rows.map((row, idx) =>
      db.insert<Installment>('installments', {
        id: `inst-${plan.id}-r${Date.now().toString(36)}-${row.installmentNumber}`,
        planId: plan.id,
        dealerId: plan.dealerId,
        customerId: plan.customerId,
        installmentNumber: paidRows.length + row.installmentNumber,
        amountDue: row.amountDue,
        amountPaid: 0,
        dueDate: row.dueDate,
        graceDate: row.graceDate,
        status: idx === 0 ? 'DUE_SOON' : 'PENDING',
        lateFee: 0,
        lateFeePaid: 0,
        createdAt: nowIso,
      })
    );

    db.update<InstallmentPlan>('installmentPlans', plan.id, {
      totalInstallments: paidRows.length + body.totalInstallments,
      monthlyInstallment: schedule.baseInstallment,
      firstDueDate: body.firstDueDate,
      gracePeriodDays: grace,
      status: 'CURRENT',
    });

    return rows;
  });

  AuditService.log({
    dealerId: plan.dealerId,
    userId: user.userId,
    actorName: user.name,
    actorRole: user.role,
    action: 'PLAN_RESCHEDULED',
    targetType: 'INSTALLMENT_PLAN',
    targetId: plan.id,
    details:
      `Restructured the remaining Rs. ${outstandingPrincipal.toLocaleString()} into ${body.totalInstallments} ` +
      `installment(s) of about Rs. ${schedule.baseInstallment.toLocaleString()}, starting ${body.firstDueDate}. Reason: ${body.reason}`,
    ipAddress: clientIp(req),
  });

  res.json({
    success: true,
    message: `Plan restructured into ${body.totalInstallments} new installment(s).`,
    installments: created,
    plan: db.findById<InstallmentPlan>('installmentPlans', plan.id),
  });
});

// ---------------------------------------------------------------------------
// EARLY SETTLEMENT QUOTE
// ---------------------------------------------------------------------------

installmentsRouter.get('/plans/:id/payoff-quote', (req, res) => {
  const user = getAuthUser(req);
  const plan = db.findById<InstallmentPlan>('installmentPlans', routeParam(req, 'id'));
  if (!plan) throw AppError.notFound('Installment plan');
  assertDealerAccess(req, plan.dealerId, 'installment plan');
  if (user.role === 'CUSTOMER' && plan.customerId !== user.customerId) {
    throw AppError.notFound('Installment plan');
  }

  const rows = db.find<Installment>('installments', (i) => i.planId === plan.id && i.status !== 'PAID');
  const principal = rows.reduce((s, i) => s + Math.max(0, i.amountDue - i.amountPaid), 0);
  const lateFees = rows.reduce((s, i) => s + Math.max(0, (i.lateFee ?? 0) - (i.lateFeePaid ?? 0)), 0);
  const credit = plan.creditBalance ?? 0;

  const policy =
    db.findOne<DevicePolicy>('devicePolicies', (p) => p.dealerId === plan.dealerId) ??
    ({ ...DEFAULT_POLICY, dealerId: plan.dealerId } as DevicePolicy);

  res.json({
    planId: plan.id,
    remainingInstallments: rows.length,
    outstandingPrincipal: principal,
    outstandingLateFees: lateFees,
    advanceCredit: credit,
    totalPayable: Math.max(0, principal + lateFees - credit),
    gracePeriodDays: policy.gracePeriodDays,
    note: 'This quote settles the plan in full. Verify with the customer before recording the payment.',
  });
});
