import { Router } from 'express';

import { db } from '../db/db.js';
import { Device, InstallmentPlan, Payment, Installment, Customer } from '../types/index.js';
import { getAuthUser, resolveDealerScope } from '../middleware/auth.js';
import { amountOutstanding, addMonthsPreservingEndOfMonth, toDateOnly } from '../services/InstallmentMath.js';

export const dashboardRouter = Router();

function scopeFilter<T extends { dealerId: string; customerId?: string }>(
  items: T[],
  scope: string | null,
  customerId?: string
): T[] {
  return items.filter((i) => {
    if (scope !== null && i.dealerId !== scope) return false;
    if (customerId && i.customerId !== customerId) return false;
    return true;
  });
}

dashboardRouter.get('/stats', (req, res) => {
  const user = getAuthUser(req);
  const scope = resolveDealerScope(req);
  const customerScope = user.role === 'CUSTOMER' ? user.customerId : undefined;

  const devices = scopeFilter(db.find<Device>('devices'), scope, customerScope);
  const plans = scopeFilter(db.find<InstallmentPlan>('installmentPlans'), scope, customerScope);
  const payments = scopeFilter(db.find<Payment>('payments'), scope, customerScope);
  const installments = scopeFilter(db.find<Installment>('installments'), scope, customerScope);

  // Only money that actually landed and was not later reversed.
  const settled = payments.filter((p) => p.status === 'VERIFIED' && !p.reversedAt);

  const now = new Date();
  const monthStart = toDateOnly(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const todayStr = toDateOnly(now);

  const overdueInstallments = installments.filter((i) => i.status === 'OVERDUE');
  const dueThisWeek = installments.filter(
    (i) => i.status !== 'PAID' && i.dueDate >= todayStr && i.dueDate <= toDateOnly(new Date(now.getTime() + 7 * 86_400_000))
  );

  const outstandingAmount = plans.reduce((sum, p) => sum + (p.remainingBalance || 0), 0);
  const outstandingLateFees = plans.reduce((sum, p) => sum + (p.outstandingLateFees || 0), 0);

  // Collection rate: of everything that has fallen due, how much came in.
  const dueToDate = installments.filter((i) => i.dueDate <= todayStr);
  const dueAmount = dueToDate.reduce((s, i) => s + i.amountDue, 0);
  const collectedOfDue = dueToDate.reduce((s, i) => s + i.amountPaid, 0);

  res.json({
    totalDevices: devices.length,
    activeDevices: devices.filter((d) => d.status === 'ACTIVE').length,
    pendingDevices: devices.filter((d) => d.status === 'PENDING' || d.status === 'ENROLLED').length,
    lockedDevices: devices.filter((d) => d.status === 'LOCKED' || d.status === 'LOCK_PENDING').length,
    overdueDevices: devices.filter((d) => d.status === 'OVERDUE').length,
    inactiveDevices: devices.filter((d) => d.status === 'INACTIVE' || d.status === 'REMOVED').length,
    offlineDevices: devices.filter((d) => !d.isOnline && d.status !== 'REMOVED').length,

    totalCustomers: new Set(plans.map((p) => p.customerId)).size,
    activePlans: plans.filter((p) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED').length,
    completedPlans: plans.filter((p) => p.status === 'COMPLETED').length,

    outstandingAmount,
    outstandingLateFees,
    overdueAmount: overdueInstallments.reduce((s, i) => s + amountOutstanding(i), 0),
    overdueInstallmentsCount: overdueInstallments.length,
    dueThisWeekCount: dueThisWeek.length,
    dueThisWeekAmount: dueThisWeek.reduce((s, i) => s + amountOutstanding(i), 0),

    collectedThisMonth: settled.filter((p) => p.createdAt >= monthStart).reduce((s, p) => s + p.amount, 0),
    totalCollectedAllTime: settled.reduce((s, p) => s + p.amount, 0),
    pendingVerificationAmount: payments.filter((p) => p.status === 'PENDING').reduce((s, p) => s + p.amount, 0),

    collectionRatePercentage: dueAmount > 0 ? Math.round((collectedOfDue / dueAmount) * 100) : 100,
  });
});

dashboardRouter.get('/charts', (req, res) => {
  const user = getAuthUser(req);
  const scope = resolveDealerScope(req);
  const customerScope = user.role === 'CUSTOMER' ? user.customerId : undefined;

  const devices = scopeFilter(db.find<Device>('devices'), scope, customerScope);
  const installments = scopeFilter(db.find<Installment>('installments'), scope, customerScope);
  const payments = scopeFilter(db.find<Payment>('payments'), scope, customerScope).filter(
    (p) => p.status === 'VERIFIED' && !p.reversedAt
  );

  // -------------------------------------------------------------------------
  // Monthly trend — computed from real records. The previous version returned a
  // hardcoded array, so the chart showed the same five months to every dealer
  // regardless of their actual business.
  // -------------------------------------------------------------------------
  const now = new Date();
  const monthlyTrends = [];

  for (let offset = 5; offset >= 0; offset--) {
    const monthDate = addMonthsPreservingEndOfMonth(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      -offset
    );
    const start = toDateOnly(monthDate);
    const end = toDateOnly(addMonthsPreservingEndOfMonth(monthDate, 1));

    const monthPayments = payments.filter((p) => p.createdAt >= start && p.createdAt < end);
    const monthInstallments = installments.filter((i) => i.dueDate >= start && i.dueDate < end);

    monthlyTrends.push({
      month: monthDate.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      collection: monthPayments.reduce((s, p) => s + p.amount, 0),
      // "Target" is what was scheduled to be collected that month — a real
      // benchmark rather than an invented number.
      target: monthInstallments.reduce((s, i) => s + i.amountDue, 0),
      overdue: monthInstallments.filter((i) => i.status === 'OVERDUE').reduce((s, i) => s + amountOutstanding(i), 0),
      paymentCount: monthPayments.length,
    });
  }

  const brandCounts = new Map<string, number>();
  for (const d of devices) {
    brandCounts.set(d.brand, (brandCounts.get(d.brand) ?? 0) + 1);
  }

  const methodTotals = new Map<string, { amount: number; count: number }>();
  for (const p of payments) {
    const current = methodTotals.get(p.paymentMethod) ?? { amount: 0, count: 0 };
    methodTotals.set(p.paymentMethod, { amount: current.amount + p.amount, count: current.count + 1 });
  }

  const statusCounts = new Map<string, number>();
  for (const d of devices) {
    statusCounts.set(d.status, (statusCounts.get(d.status) ?? 0) + 1);
  }

  res.json({
    monthlyTrends,
    brandDistribution: [...brandCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    paymentMethodDistribution: [...methodTotals.entries()]
      .map(([name, v]) => ({ name, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount),
    deviceStatusDistribution: [...statusCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  });
});

/** Actionable list for the dashboard: who to chase today. */
dashboardRouter.get('/attention', (req, res) => {
  const scope = resolveDealerScope(req);
  const customersById = db.indexBy<Customer>('customers', (c) => c.id);
  const devicesById = db.indexBy<Device>('devices', (d) => d.id);
  const plansById = db.indexBy<InstallmentPlan>('installmentPlans', (p) => p.id);

  const overdue = db
    .find<Installment>('installments', (i) => i.status === 'OVERDUE' && (scope === null || i.dealerId === scope))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 25)
    .map((i) => {
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
});
