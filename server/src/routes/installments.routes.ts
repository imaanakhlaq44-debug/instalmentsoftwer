import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { repo, indexBy, groupBy, dealerScope } from '../db/repositories/index.js';
import { runInTransaction } from '../db/prisma.js';
import {
  Installment, InstallmentPlan, Customer, Device, Transaction, DevicePolicy,
} from '../types/index.js';
import { OverdueEngine } from '../services/OverdueEngine.js';
import { buildInstallmentSchedule, amountOutstanding, DEFAULT_POLICY, parseDateOnly } from '../services/InstallmentMath.js';
import { AuditService } from '../services/AuditService.js';
import {
  requireDealerAdmin, getAuthUser, resolveDealerScope, assertDealerAccess, clientIp,
  routeParam,
} from '../middleware/auth.js';
import { validateBody, validateQuery, getQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { maskImei } from '../utils/mask.js';
import { isoDateSchema, paginationSchema, pageEnvelope } from '../utils/validators.js';

export const installmentsRouter = Router();

// ---------------------------------------------------------------------------
// PLANS
// ---------------------------------------------------------------------------

const plansQuerySchema = paginationSchema.extend({
  status: z.string().trim().max(20).optional(),
  search: z.string().trim().max(120).optional(),
  dealerId: z.string().trim().max(64).optional(),
});

installmentsRouter.get('/plans', validateQuery(plansQuerySchema), asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const scope = resolveDealerScope(req);
  const q = getQuery<z.infer<typeof plansQuerySchema>>(req);

  const page = await repo.installmentPlans.list({
    dealerId: scope,
    // A CUSTOMER login only ever sees its own plans.
    customerId: user.role === 'CUSTOMER' ? user.customerId : undefined,
    status: q.status,
    search: q.search,
    page: q.page,
    limit: q.limit,
  });

  // The joins cover only the plans on this page.
  const [customerRows, deviceRows, installmentRows] = await Promise.all([
    repo.customers.findByIds([...new Set(page.data.map((p) => p.customerId))]),
    repo.devices.findByIds([...new Set(page.data.map((p) => p.deviceId))]),
    repo.installments.findByPlans(page.data.map((p) => p.id)),
  ]);

  const customersById = indexBy<Customer>(customerRows, (c) => c.id);
  const devicesById = indexBy<Device>(deviceRows, (d) => d.id);
  const installmentsByPlan = groupBy<Installment>(installmentRows, (i) => i.planId);

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

  res.json(pageEnvelope(enriched, page, q.limit));
}));

/** Full plan detail including the schedule and a payoff quote. */
installmentsRouter.get('/plans/:id', asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const plan = await repo.installmentPlans.findById(routeParam(req, 'id'));
  if (!plan) throw AppError.notFound('Installment plan');

  assertDealerAccess(req, plan.dealerId, 'installment plan');
  if (user.role === 'CUSTOMER' && plan.customerId !== user.customerId) {
    throw AppError.notFound('Installment plan');
  }

  const [installments, customer, device] = await Promise.all([
    repo.installments.findByPlan(plan.id),
    repo.customers.findById(plan.customerId),
    repo.devices.findById(plan.deviceId),
  ]);

  const unpaid = installments.filter((i) => i.status !== 'PAID');
  const payoffAmount = Math.max(0, unpaid.reduce((s, i) => s + amountOutstanding(i), 0) - (plan.creditBalance ?? 0));

  res.json({
    plan,
    installments,
    customer: customer ?? null,
    device: device ?? null,
    payoff: {
      amount: payoffAmount,
      remainingInstallments: unpaid.length,
      outstandingLateFees: plan.outstandingLateFees ?? 0,
      creditApplied: plan.creditBalance ?? 0,
    },
  });
}));

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

installmentsRouter.get('/', validateQuery(listQuerySchema), asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const scope = resolveDealerScope(req);
  const q = getQuery<z.infer<typeof listQuerySchema>>(req);

  const where: Record<string, unknown> = { ...dealerScope(scope) };
  // A CUSTOMER login only ever sees its own schedule.
  const customerId = user.role === 'CUSTOMER' ? user.customerId : q.customerId;
  if (customerId) where.customerId = customerId;
  if (q.planId) where.planId = q.planId;
  if (q.status && q.status !== 'ALL') where.status = q.status;
  if (q.dueBefore) where.dueDate = { lte: parseDateOnly(q.dueBefore) };

  const page = await repo.installments.paginate({
    where,
    orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }],
    page: q.page,
    limit: q.limit,
  });

  res.json(
    pageEnvelope(
      page.data.map((i) => ({ ...i, totalOutstanding: amountOutstanding(i) })),
      page,
      q.limit
    )
  );
}));

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

installmentsRouter.post('/:id/waive-late-fee', requireDealerAdmin, validateBody(waiveSchema), asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const inst = await repo.installments.findById(routeParam(req, 'id'));
  if (!inst) throw AppError.notFound('Installment');
  assertDealerAccess(req, inst.dealerId, 'installment');

  const outstandingFee = Math.max(0, (inst.lateFee ?? 0) - (inst.lateFeePaid ?? 0));
  if (outstandingFee <= 0) {
    throw AppError.badRequest('This installment has no outstanding late fee to waive.');
  }

  const reason = (req.body as z.infer<typeof waiveSchema>).reason;
  const nowIso = new Date().toISOString();

  // The waiver, its ledger entry and the plan total move together — a waiver
  // recorded without the matching contra-entry would leave the books wrong.
  await runInTransaction(async (tx) => {
    await repo.installments.update(inst.id, {
      lateFee: inst.lateFeePaid ?? 0,
      lateFeeWaivedAt: nowIso,
      lateFeeWaivedBy: user.userId,
      lateFeeWaiverReason: reason,
    }, tx);

    await repo.transactions.create({
      id: `tx-${uuidv4().substring(0, 8)}`,
      dealerId: inst.dealerId,
      customerId: inst.customerId,
      planId: inst.planId,
      type: 'LATE_FEE_WAIVER',
      amount: -outstandingFee,
      status: 'COMPLETED',
      date: nowIso,
      notes: `Late fee of Rs. ${outstandingFee.toLocaleString()} waived on installment #${inst.installmentNumber}. Reason: ${reason}`,
    }, tx);

    const remaining = (await repo.installments.findByPlan(inst.planId, tx)).reduce(
      (s: number, i: Installment) => s + Math.max(0, (i.lateFee ?? 0) - (i.lateFeePaid ?? 0)),
      0
    );
    await repo.installmentPlans.update(inst.planId, { outstandingLateFees: remaining }, tx);
  });

  await AuditService.log({
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
}));

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

installmentsRouter.post('/plans/:id/reschedule', requireDealerAdmin, validateBody(rescheduleSchema), asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const plan = await repo.installmentPlans.findById(routeParam(req, 'id'));
  if (!plan) throw AppError.notFound('Installment plan');
  assertDealerAccess(req, plan.dealerId, 'installment plan');

  if (plan.status === 'COMPLETED' || plan.status === 'CANCELLED') {
    throw AppError.badRequest(`A ${plan.status.toLowerCase()} plan cannot be rescheduled.`);
  }

  const body = req.body as z.infer<typeof rescheduleSchema>;
  const existing = await repo.installments.findByPlan(plan.id);
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

  // Deleting the old rows, writing the new schedule and updating the plan are
  // one unit: a plan left with its old rows deleted and none written would
  // erase a customer's remaining balance.
  const created = await runInTransaction(async (tx) => {
    // Paid and partially-paid rows are history and stay exactly as they are.
    for (const row of unpaidRows) {
      await repo.installments.delete(row.id, tx);
    }

    const rows = [];
    for (const [idx, row] of schedule.rows.entries()) {
      rows.push(await repo.installments.create({
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
      }, tx));
    }

    await repo.installmentPlans.update(plan.id, {
      totalInstallments: paidRows.length + body.totalInstallments,
      monthlyInstallment: schedule.baseInstallment,
      firstDueDate: body.firstDueDate,
      gracePeriodDays: grace,
      status: 'CURRENT',
    }, tx);

    return rows;
  });

  await AuditService.log({
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
    plan: await repo.installmentPlans.findById(plan.id),
  });
}));

// ---------------------------------------------------------------------------
// EARLY SETTLEMENT QUOTE
// ---------------------------------------------------------------------------

installmentsRouter.get('/plans/:id/payoff-quote', asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const plan = await repo.installmentPlans.findById(routeParam(req, 'id'));
  if (!plan) throw AppError.notFound('Installment plan');
  assertDealerAccess(req, plan.dealerId, 'installment plan');
  if (user.role === 'CUSTOMER' && plan.customerId !== user.customerId) {
    throw AppError.notFound('Installment plan');
  }

  const rows = await repo.installments.findMany({
    where: { planId: plan.id, status: { not: 'PAID' } },
    orderBy: { installmentNumber: 'asc' },
  });
  const principal = rows.reduce((s, i) => s + Math.max(0, i.amountDue - i.amountPaid), 0);
  const lateFees = rows.reduce((s, i) => s + Math.max(0, (i.lateFee ?? 0) - (i.lateFeePaid ?? 0)), 0);
  const credit = plan.creditBalance ?? 0;

  const policy =
    (await repo.devicePolicies.findByDealer(plan.dealerId)) ??
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
}));
