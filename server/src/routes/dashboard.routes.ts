import { Router } from 'express';

import { prisma } from '../db/prisma.js';
import { repo, indexBy, dealerScope } from '../db/repositories/index.js';
import { Device, InstallmentPlan, Customer, Installment } from '../types/index.js';
import { getAuthUser, resolveDealerScope } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { amountOutstanding, addMonthsPreservingEndOfMonth, toDateOnly, parseDateOnly } from '../services/InstallmentMath.js';

export const dashboardRouter = Router();

/**
 * The rows this request is allowed to see.
 *
 * Dealer scope comes from the verified JWT; a CUSTOMER login is narrowed
 * further to its own records. Every query below starts from this.
 */
function scopeWhere(scope: string | null, customerId?: string): Record<string, unknown> {
  return { ...dealerScope(scope), ...(customerId ? { customerId } : {}) };
}

/** Turns a grouped `_count` result into a plain lookup. */
function tally(rows: unknown[], key: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows as Record<string, unknown>[]) {
    out.set(String(row[key]), (row._count as { _all: number })._all);
  }
  return out;
}

function sumOf(result: unknown, field: string): number {
  return ((result as Record<string, Record<string, number | null>>)._sum?.[field]) ?? 0;
}

dashboardRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const scope = resolveDealerScope(req);
    const customerScope = user.role === 'CUSTOMER' ? user.customerId : undefined;
    const where = scopeWhere(scope, customerScope);

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const today = parseDateOnly(toDateOnly(now));
    const weekEnd = new Date(today.getTime() + 7 * 86_400_000);

    /**
     * Every figure below is computed by the database. The previous version
     * loaded devices, plans, payments and installments in full and reduced them
     * in JavaScript — affordable against a JSON file, not against a table.
     */
    const [
      deviceStatuses,
      planStatuses,
      distinctPlanCustomers,
      planSums,
      overdueRows,
      dueThisWeekRows,
      settledAllTime,
      settledThisMonth,
      pendingVerification,
      dueToDateSums,
      offlineDevices,
    ] = await Promise.all([
      prisma.device.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.installmentPlan.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.installmentPlan.findMany({ where, distinct: ['customerId'], select: { customerId: true } }),
      prisma.installmentPlan.aggregate({ where, _sum: { remainingBalance: true, outstandingLateFees: true } }),
      repo.installments.findMany({ where: { ...where, status: 'OVERDUE' } }),
      repo.installments.findMany({
        where: { ...where, status: { not: 'PAID' }, dueDate: { gte: today, lte: weekEnd } },
      }),
      prisma.payment.aggregate({
        where: { ...where, status: 'VERIFIED', reversedAt: null },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { ...where, status: 'VERIFIED', reversedAt: null, createdAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({ where: { ...where, status: 'PENDING' }, _sum: { amount: true } }),
      prisma.installment.aggregate({
        where: { ...where, dueDate: { lte: today } },
        _sum: { amountDue: true, amountPaid: true },
      }),
      prisma.device.count({ where: { ...where, isOnline: false, status: { not: 'REMOVED' } } }),
    ]);

    const devices = tally(deviceStatuses, 'status');
    const plans = tally(planStatuses, 'status');
    const countOf = (map: Map<string, number>, ...statuses: string[]) =>
      statuses.reduce((s, status) => s + (map.get(status) ?? 0), 0);

    const totalDevices = [...devices.values()].reduce((s, n) => s + n, 0);
    const totalPlans = [...plans.values()].reduce((s, n) => s + n, 0);

    // Collection rate: of everything that has fallen due, how much came in.
    const dueAmount = sumOf(dueToDateSums, 'amountDue');
    const collectedOfDue = sumOf(dueToDateSums, 'amountPaid');

    res.json({
      totalDevices,
      activeDevices: countOf(devices, 'ACTIVE'),
      pendingDevices: countOf(devices, 'PENDING', 'ENROLLED'),
      lockedDevices: countOf(devices, 'LOCKED', 'LOCK_PENDING'),
      overdueDevices: countOf(devices, 'OVERDUE'),
      inactiveDevices: countOf(devices, 'INACTIVE', 'REMOVED'),
      offlineDevices,

      totalCustomers: distinctPlanCustomers.length,
      activePlans: totalPlans - countOf(plans, 'COMPLETED', 'CANCELLED'),
      completedPlans: countOf(plans, 'COMPLETED'),

      outstandingAmount: sumOf(planSums, 'remainingBalance'),
      outstandingLateFees: sumOf(planSums, 'outstandingLateFees'),
      // Outstanding blends principal and late fees per row, so it is summed
      // over the fetched overdue rows rather than as a single SQL expression.
      overdueAmount: overdueRows.reduce((s: number, i: Installment) => s + amountOutstanding(i), 0),
      overdueInstallmentsCount: overdueRows.length,
      dueThisWeekCount: dueThisWeekRows.length,
      dueThisWeekAmount: dueThisWeekRows.reduce((s: number, i: Installment) => s + amountOutstanding(i), 0),

      collectedThisMonth: sumOf(settledThisMonth, 'amount'),
      totalCollectedAllTime: sumOf(settledAllTime, 'amount'),
      pendingVerificationAmount: sumOf(pendingVerification, 'amount'),

      collectionRatePercentage: dueAmount > 0 ? Math.round((collectedOfDue / dueAmount) * 100) : 100,
    });
  })
);

dashboardRouter.get(
  '/charts',
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const scope = resolveDealerScope(req);
    const customerScope = user.role === 'CUSTOMER' ? user.customerId : undefined;
    const where = scopeWhere(scope, customerScope);
    // `as const` so the status narrows to the enum literal Prisma expects
    // rather than widening to `string`.
    const settledWhere = { ...where, status: 'VERIFIED' as const, reversedAt: null };

    // -------------------------------------------------------------------------
    // Monthly trend — computed from real records. The previous version returned a
    // hardcoded array, so the chart showed the same five months to every dealer
    // regardless of their actual business.
    // -------------------------------------------------------------------------
    const now = new Date();
    const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const months = Array.from({ length: 6 }, (_, i) => {
      const monthDate = addMonthsPreservingEndOfMonth(firstOfThisMonth, -(5 - i));
      return { monthDate, start: monthDate, end: addMonthsPreservingEndOfMonth(monthDate, 1) };
    });

    const monthlyTrends = await Promise.all(
      months.map(async ({ monthDate, start, end }) => {
        const monthInstallmentWhere = { ...where, dueDate: { gte: start, lt: end } };

        const [collection, scheduled, overdueRows] = await Promise.all([
          prisma.payment.aggregate({
            where: { ...settledWhere, createdAt: { gte: start, lt: end } },
            _sum: { amount: true },
            _count: { _all: true },
          }),
          prisma.installment.aggregate({ where: monthInstallmentWhere, _sum: { amountDue: true } }),
          repo.installments.findMany({ where: { ...monthInstallmentWhere, status: 'OVERDUE' } }),
        ]);

        return {
          month: monthDate.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
          collection: sumOf(collection, 'amount'),
          // "Target" is what was scheduled to be collected that month — a real
          // benchmark rather than an invented number.
          target: sumOf(scheduled, 'amountDue'),
          overdue: overdueRows.reduce((s: number, i: Installment) => s + amountOutstanding(i), 0),
          paymentCount: (collection as { _count: { _all: number } })._count._all,
        };
      })
    );

    const [brands, methods, statuses] = await Promise.all([
      prisma.device.groupBy({ by: ['brand'], where, _count: { _all: true } }),
      prisma.payment.groupBy({
        by: ['paymentMethod'],
        where: settledWhere,
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.device.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);

    res.json({
      monthlyTrends,
      brandDistribution: [...tally(brands, 'brand').entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      paymentMethodDistribution: (methods as {
        paymentMethod: string;
        _sum: { amount: number | null };
        _count: { _all: number };
      }[])
        .map((m) => ({ name: m.paymentMethod, amount: m._sum.amount ?? 0, count: m._count._all }))
        .sort((a, b) => b.amount - a.amount),
      deviceStatusDistribution: [...tally(statuses, 'status').entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    });
  })
);

/** Actionable list for the dashboard: who to chase today. */
dashboardRouter.get(
  '/attention',
  asyncHandler(async (req, res) => {
    const scope = resolveDealerScope(req);

    // 25 rows, ordered and limited by the database.
    const overdueRows = await repo.installments.findMany({
      where: { ...dealerScope(scope), status: 'OVERDUE' },
      orderBy: { dueDate: 'asc' },
      take: 25,
    });

    if (overdueRows.length === 0) {
      res.json({ overdueInstallments: [] });
      return;
    }

    const [plans, customers] = await Promise.all([
      repo.installmentPlans.findMany({ where: { id: { in: overdueRows.map((i) => i.planId) } } }),
      repo.customers.findByIds([...new Set(overdueRows.map((i) => i.customerId))]),
    ]);
    const plansById = indexBy<InstallmentPlan>(plans, (p) => p.id);
    const customersById = indexBy<Customer>(customers, (c) => c.id);
    const devicesById = indexBy<Device>(
      await repo.devices.findByIds([...new Set(plans.map((p) => p.deviceId))]),
      (d) => d.id
    );

    const overdue = overdueRows.map((i) => {
      const plan = plansById.get(i.planId);
      const device = plan ? devicesById.get(plan.deviceId) : undefined;
      const customer = customersById.get(i.customerId);
      return {
        installmentId: i.id,
        planId: i.planId,
        customerId: i.customerId,
        customerName: customer?.name ?? 'Unknown',
        customerPhone: customer?.phone ?? 'N/A',
        deviceId: device?.id,
        deviceName: device ? `${device.brand} ${device.model}` : 'N/A',
        deviceStatus: device?.status ?? 'UNKNOWN',
        installmentNumber: i.installmentNumber,
        dueDate: i.dueDate,
        amountOutstanding: amountOutstanding(i),
        daysOverdue: Math.max(
          0,
          Math.floor((Date.now() - new Date(i.graceDate).getTime()) / 86_400_000)
        ),
      };
    });

    res.json({ overdueInstallments: overdue });
  })
);
