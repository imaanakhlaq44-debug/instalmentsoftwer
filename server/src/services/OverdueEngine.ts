import { v4 as uuidv4 } from 'uuid';

import { repo, indexBy } from '../db/repositories/index.js';
import {
  Installment, InstallmentPlan, Device, DevicePolicy, Notification,
} from '../types/index.js';
import { deviceManagementService } from './DeviceManagementService.js';
import { AuditService } from './AuditService.js';
import { calculateLateFee, daysBetween, DEFAULT_POLICY, toDateOnly } from './InstallmentMath.js';

export interface OverdueEvaluationResult {
  evaluatedCount: number;
  newlyOverdueCount: number;
  devicesLockedCount: number;
  devicesFlaggedCount: number;
  notificationsQueued: number;
  lateFeesCharged: number;
  lateFeeAmountTotal: number;
  warningsSent: number;
}

export class OverdueEngine {
  /**
   * Evaluates every open installment against its grace date.
   *
   * The whole function is idempotent: late fees are recomputed as absolute
   * totals and notifications are de-duplicated per installment per day, so
   * running it twice — or catching up after downtime — cannot double-charge or
   * spam a customer.
   */
  public static async runEvaluation(currentDateStr?: string): Promise<OverdueEvaluationResult> {
    const today = currentDateStr ? new Date(currentDateStr) : new Date();
    const todayStr = toDateOnly(today);

    const result: OverdueEvaluationResult = {
      evaluatedCount: 0,
      newlyOverdueCount: 0,
      devicesLockedCount: 0,
      devicesFlaggedCount: 0,
      notificationsQueued: 0,
      lateFeesCharged: 0,
      lateFeeAmountTotal: 0,
      warningsSent: 0,
    };

    const openInstallments = await repo.installments.findMany({
      where: { status: { not: 'PAID' } },
      orderBy: { dueDate: 'asc' },
    });
    result.evaluatedCount = openInstallments.length;

    if (openInstallments.length === 0) {
      await this.auditRun(result);
      return result;
    }

    /**
     * Fetch the related rows in three queries keyed by the ids actually
     * referenced, rather than loading every plan, device and policy in the
     * database. The maps below are only for the in-memory join afterwards.
     */
    const planIds = [...new Set(openInstallments.map((i) => i.planId))];
    const plans = await repo.installmentPlans.findMany({ where: { id: { in: planIds } } });
    const plansById = indexBy<InstallmentPlan>(plans, (p) => p.id);

    const deviceIds = [...new Set(plans.map((p) => p.deviceId))];
    const devicesById = indexBy<Device>(await repo.devices.findByIds(deviceIds), (d) => d.id);

    const dealerIds = [...new Set(openInstallments.map((i) => i.dealerId))];
    const policiesByDealer = indexBy<DevicePolicy>(
      await repo.devicePolicies.findByDealers(dealerIds),
      (p) => p.dealerId
    );

    const affectedPlans = new Set<string>();

    for (const inst of openInstallments) {
      const plan = plansById.get(inst.planId);
      if (!plan || plan.status === 'CANCELLED' || plan.status === 'COMPLETED') continue;

      const device = devicesById.get(plan.deviceId);
      const policy = policiesByDealer.get(inst.dealerId) ?? ({ ...DEFAULT_POLICY, dealerId: inst.dealerId } as DevicePolicy);

      const pastGrace = inst.graceDate < todayStr;
      const pastDue = inst.dueDate < todayStr;
      const dueToday = inst.dueDate === todayStr;

      // ---------------------------------------------------------------------
      // Late fee accrual (absolute, so it is safe to re-run)
      // ---------------------------------------------------------------------
      if (pastGrace) {
        const owedFee = calculateLateFee({ installment: inst, policy, asOfDate: todayStr });
        const currentFee = inst.lateFee ?? 0;

        if (owedFee > currentFee) {
          const delta = owedFee - currentFee;

          await repo.installments.update(inst.id, {
            lateFee: owedFee,
            lateFeeAccruedThrough: todayStr,
          });

          await repo.transactions.create({
            id: `tx-${uuidv4().substring(0, 8)}`,
            dealerId: inst.dealerId,
            customerId: inst.customerId,
            planId: plan.id,
            type: 'LATE_FEE',
            amount: delta,
            status: 'PENDING',
            date: new Date().toISOString(),
            notes: `Late fee charged on installment #${inst.installmentNumber}, ${daysBetween(inst.graceDate, todayStr)} day(s) past the grace date.`,
          });

          result.lateFeesCharged++;
          result.lateFeeAmountTotal += delta;
          affectedPlans.add(plan.id);
        }
      }

      // ---------------------------------------------------------------------
      // Status transitions
      // ---------------------------------------------------------------------
      if (pastGrace && inst.status !== 'OVERDUE') {
        await repo.installments.update(inst.id, { status: 'OVERDUE' });
        await repo.installmentPlans.update(plan.id, { status: 'OVERDUE' });
        result.newlyOverdueCount++;
        affectedPlans.add(plan.id);

        if (device) {
          const daysLate = daysBetween(inst.dueDate, todayStr);

          const queued = await this.queueNotification({
            dealerId: inst.dealerId,
            customerId: inst.customerId,
            deviceId: device.id,
            type: 'PAYMENT_OVERDUE',
            title: 'Overdue Installment',
            message:
              `Your installment of Rs. ${inst.amountDue.toLocaleString()} for ${device.brand} ${device.model} ` +
              `is ${daysLate} day(s) overdue. Please pay immediately to avoid restrictions on your device.`,
          });
          if (queued) result.notificationsQueued++;

          if (policy.autoLockEnabled && device.status !== 'LOCKED' && device.status !== 'LOCK_PENDING') {
            try {
              await deviceManagementService.lockDevice({
                deviceId: device.id,
                userId: 'system-overdue-engine',
                userName: 'Auto-Lock Policy Engine',
                userRole: 'SUPER_ADMIN',
                reason: `Automated enforcement: installment #${inst.installmentNumber} is past the ${policy.gracePeriodDays}-day grace period.`,
                lockMessage: `DEVICE RESTRICTED: Installment payment overdue. Amount due: Rs. ${inst.amountDue.toLocaleString()}.`,
              });
              result.devicesLockedCount++;
            } catch (err) {
              // One un-lockable device must not abort the whole nightly run.
              console.error(`[overdue] Failed to auto-lock device ${device.id}:`, err);
            }
          } else if (device.status === 'ACTIVE' || device.status === 'ENROLLED') {
            await repo.devices.update(device.id, {
              status: 'OVERDUE',
              lockReason: `Installment #${inst.installmentNumber} overdue by ${daysLate} day(s).`,
              updatedAt: new Date().toISOString(),
            });
            result.devicesFlaggedCount++;
          }
        }
      } else if (dueToday && inst.status === 'PENDING') {
        await repo.installments.update(inst.id, { status: 'DUE_TODAY' });
      } else if (pastDue && !pastGrace && inst.status !== 'OVERDUE') {
        // Inside the grace window — due, but not yet a default.
        if (inst.status !== 'DUE_TODAY') {
          await repo.installments.update(inst.id, { status: 'DUE_TODAY' });
        }
      } else if (!pastDue && inst.status === 'PENDING') {
        // -------------------------------------------------------------------
        // Advance warning — the whole point of `lockWarningDays`, which the
        // original engine defined in the policy but never actually used.
        // -------------------------------------------------------------------
        const daysUntilDue = daysBetween(todayStr, inst.dueDate);
        const warnWindow = policy.lockWarningDays ?? 2;

        if (policy.customerReminderEnabled && daysUntilDue > 0 && daysUntilDue <= warnWindow) {
          await repo.installments.update(inst.id, { status: 'DUE_SOON' });

          const queued = await this.queueNotification({
            dealerId: inst.dealerId,
            customerId: inst.customerId,
            deviceId: device?.id,
            type: 'PAYMENT_DUE',
            title: 'Installment Due Soon',
            message:
              `Reminder: your installment of Rs. ${inst.amountDue.toLocaleString()} is due on ${inst.dueDate} ` +
              `(${daysUntilDue} day(s) from now). You have ${policy.gracePeriodDays} grace day(s) after that.`,
          });
          if (queued) {
            result.warningsSent++;
            result.notificationsQueued++;
          }
        }
      }
    }

    // Keep plan-level totals honest after fee accrual.
    for (const planId of affectedPlans) {
      await this.recalculatePlanFees(planId);
    }

    await this.auditRun(result);
    return result;
  }

  private static async auditRun(result: OverdueEvaluationResult): Promise<void> {
    await AuditService.log({
      userId: 'system',
      actorName: 'Overdue Engine',
      actorRole: 'SUPER_ADMIN',
      action: 'OVERDUE_EVALUATION_COMPLETED',
      targetType: 'SYSTEM',
      targetId: 'SCHEDULED_JOB',
      details:
        `Evaluated ${result.evaluatedCount} open installments. ` +
        `${result.newlyOverdueCount} newly overdue, ${result.devicesLockedCount} auto-locked, ` +
        `${result.devicesFlaggedCount} flagged, ${result.lateFeesCharged} late fees ` +
        `(Rs. ${result.lateFeeAmountTotal.toLocaleString()}), ${result.notificationsQueued} notifications queued.`,
      ipAddress: 'system',
    });
  }

  /**
   * Queues a notification unless an identical one already went out today.
   * Without this, a nightly job plus manual runs would text the customer
   * repeatedly about the same installment.
   */
  private static async queueNotification(params: {
    dealerId: string;
    customerId: string;
    deviceId?: string;
    type: Notification['type'];
    title: string;
    message: string;
  }): Promise<boolean> {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    // The same check as before, but expressed as a query the database answers
    // with an index rather than a scan of every notification ever queued.
    const alreadySent = await repo.notifications.findFirst({
      customerId: params.customerId,
      type: params.type,
      message: params.message,
      createdAt: { gte: dayStart },
    });
    if (alreadySent) return false;

    await repo.notifications.create({
      id: `notif-${uuidv4().substring(0, 8)}`,
      dealerId: params.dealerId,
      customerId: params.customerId,
      deviceId: params.deviceId,
      type: params.type,
      channel: 'SMS',
      title: params.title,
      message: params.message,
      // QUEUED, not SENT — nothing has actually reached a phone until an SMS
      // gateway is wired up. Claiming SENT here was simply untrue.
      status: 'QUEUED',
      createdAt: new Date().toISOString(),
    });

    return true;
  }

  private static async recalculatePlanFees(planId: string): Promise<void> {
    const installments = await repo.installments.findByPlan(planId);
    const outstandingLateFees = installments.reduce(
      (sum: number, i: Installment) => sum + Math.max(0, (i.lateFee ?? 0) - (i.lateFeePaid ?? 0)),
      0
    );
    await repo.installmentPlans.update(planId, { outstandingLateFees });
  }
}
