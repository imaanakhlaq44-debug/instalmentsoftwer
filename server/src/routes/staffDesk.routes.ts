import { Router } from 'express';
import { z } from 'zod';

import { repo, indexBy, groupBy, dealerScope } from '../db/repositories/index.js';
import { Device, Installment, InstallmentPlan } from '../types/index.js';
import { getAuthUser, resolveDealerScope, requireShopTeam } from '../middleware/auth.js';
import { validateQuery, getQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { amountOutstanding, parseDateOnly } from '../services/InstallmentMath.js';

/**
 * The staff desk: the one screen a shop's staff login works from.
 *
 * Staff have two jobs. They contact customers, so each customer comes with the
 * phone number in full (the rest of the app masks it for staff). Counter staff
 * also take payments, so each running plan comes with what is owed today and
 * the oldest unpaid installment to put the money against.
 *
 * Nothing else about the customer is sent: no CNIC, address, photo, guarantor
 * or device identifiers. Staff do not need them for either job.
 */
export const staffDeskRouter = Router();

const querySchema = z.object({
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

staffDeskRouter.get(
  '/customers',
  requireShopTeam,
  validateQuery(querySchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const scope = resolveDealerScope(req);
    const q = getQuery<z.infer<typeof querySchema>>(req);

    // Same Pakistan business day as the dashboard.
    const businessDate = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
    const today = parseDateOnly(businessDate);

    const page = await repo.customers.list({
      dealerId: scope,
      search: q.search,
      paymentStatus: 'ALL',
      orderBy: { name: 'asc' },
      page: 1,
      limit: q.limit,
    });
    const customers = page.data.filter((c) => c.active !== false);
    const ids = customers.map((c) => c.id);

    const plans = ids.length
      ? await repo.installmentPlans.findMany({
          where: { customerId: { in: ids }, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
        })
      : [];
    const [unpaid, devices] = await Promise.all([
      plans.length
        ? repo.installments.findMany({
            where: { ...dealerScope(scope), planId: { in: plans.map((p) => p.id) }, status: { not: 'PAID' } },
            orderBy: { dueDate: 'asc' },
          })
        : Promise.resolve([] as Installment[]),
      repo.devices.findByIds([...new Set(plans.map((p) => p.deviceId))]),
    ]);

    const devicesById = indexBy<Device>(devices, (d) => d.id);
    const plansByCustomer = groupBy<InstallmentPlan>(plans, (p) => p.customerId);
    const unpaidByPlan = groupBy<Installment>(
      unpaid.filter((i) => amountOutstanding(i) > 0),
      (i) => i.planId
    );
    const dayMs = 86_400_000;

    const rows = customers.map((c) => {
      const custPlans = (plansByCustomer.get(c.id) ?? []).map((plan) => {
        const open = unpaidByPlan.get(plan.id) ?? [];
        const due = open.filter((i) => parseDateOnly(String(i.dueDate).slice(0, 10)).getTime() <= today.getTime());
        const next = open[0];
        const device = devicesById.get(plan.deviceId);
        const oldestDue = due[0];
        return {
          planId: plan.id,
          deviceName: device ? `${device.brand} ${device.model}` : '',
          totalInstallments: plan.totalInstallments ?? 0,
          paidInstallments: plan.paidInstallments ?? 0,
          installmentsDue: due.length,
          amountDue: due.reduce((s, i) => s + amountOutstanding(i), 0),
          daysLate: oldestDue
            ? Math.max(0, Math.round((today.getTime() - parseDateOnly(String(oldestDue.dueDate).slice(0, 10)).getTime()) / dayMs))
            : 0,
          // The installment a payment goes against: the oldest one still open.
          installmentId: next?.id ?? null,
          nextAmount: next ? amountOutstanding(next) : 0,
          nextDueDate: next ? String(next.dueDate).slice(0, 10) : null,
        };
      });
      return {
        customerId: c.id,
        name: c.name,
        phone: c.phone ?? '',
        amountDue: custPlans.reduce((s, p) => s + p.amountDue, 0),
        daysLate: custPlans.reduce((m, p) => Math.max(m, p.daysLate), 0),
        plans: custPlans,
      };
    });

    // The people to call first: the longest late, then whoever owes today.
    rows.sort((a, b) => b.daysLate - a.daysLate || b.amountDue - a.amountDue || a.name.localeCompare(b.name));

    res.json({
      businessDate,
      role: user.role,
      canRecordPayments: user.role !== 'DEALER_VIEWER',
      total: page.total,
      customers: rows,
    });
  })
);
