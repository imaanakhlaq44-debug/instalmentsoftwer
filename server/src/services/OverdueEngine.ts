import { v4 as uuidv4 } from 'uuid';

import { db } from '../db/db.js';
import {
  Installment, InstallmentPlan, Device, DevicePolicy, Notification, Transaction,
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

    const openInstallments = db.find<Installment>('installments', (i) => i.status !== 'PAID');
    result.evaluatedCount = openInstallments.length;

    // Pre-index the joins so this stays linear even with tens of thousands of rows.
    const plansById = db.indexBy<InstallmentPlan>('installmentPlans', (p) => p.id);
    const devicesById = db.indexBy<Device>('devices', (d) => d.id);
    const policiesByDealer = db.indexBy<DevicePolicy>('devicePolicies', (p) => p.dealerId);

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
          db.update<Installment>('installments', inst.id, {
            lateFee: owedFee,
            lateFeeAccruedThrough: todayStr,
          });

          db.insert<Transaction>('transactions', {
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
        db.update<Installment>('installments', inst.id, { status: 'OVERDUE' });
        db.update<InstallmentPlan>('installmentPlans', plan.id, { status: 'OVERDUE' });
        result.newlyOverdueCount++;
        affectedPlans.add(plan.id);

        if (device) {
          const daysLate = daysBetween(inst.dueDate, todayStr);

          if (this.queueNotification({
            dealerId: inst.dealerId,
            customerId: inst.customerId,
            deviceId: device.id,
            type: 'PAYMENT_OVERDUE',
            title: 'Overdue Installment',
            message:
              `Your installment of Rs. ${inst.amountDue.toLocaleString()} for ${device.brand} ${device.model} ` +
              `is ${daysLate} day(s) overdue. Please pay immediately to avoid restrictions on your device.`,
            dedupeKey: `overdue:${inst.id}`,
          })) {
            result.notificationsQueued++;
          }

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
            db.update<Device>('devices', device.id, {
              status: 'OVERDUE',
              lockReason: `Installment #${inst.installmentNumber} overdue by ${daysLate} day(s).`,
              updatedAt: new Date().toISOString(),
            });
            result.devicesFlaggedCount++;
          }
        }
      } else if (dueToday && inst.status === 'PENDING') {
        db.update<Installment>('installments', inst.id, { status: 'DUE_TODAY' });
      } else if (pastDue && !pastGrace && inst.status !== 'OVERDUE') {
        // Inside the grace window — due, but not yet a default.
        if (inst.status !== 'DUE_TODAY') {
          db.update<Installment>('installments', inst.id, { status: 'DUE_TODAY' });
        }
      } else if (!pastDue && inst.status === 'PENDING') {
        // ---------------------------------------------------------------------
        // Advance warning — the whole point of `lockWarningDays`, which the
        // original engine defined in the policy but never actually used.
        // ---------------------------------------------------------------------
        const daysUntilDue = daysBetween(todayStr, inst.dueDate);
        const warnWindow = policy.lockWarningDays ?? 2;

        if (policy.customerReminderEnabled && daysUntilDue > 0 && daysUntilDue <= warnWindow) {
          db.update<Installment>('installments', inst.id, { status: 'DUE_SOON' });

          if (this.queueNotification({
            dealerId: inst.dealerId,
            customerId: inst.customerId,
            deviceId: device?.id,
            type: 'PAYMENT_DUE',
            title: 'Installment Due Soon',
            message:
              `Reminder: your installment of Rs. ${inst.amountDue.toLocaleString()} is due on ${inst.dueDate} ` +
              `(${daysUntilDue} day(s) from now). You have ${policy.gracePeriodDays} grace day(s) after that.`,
            dedupeKey: `duesoon:${inst.id}`,
          })) {
            result.warningsSent++;
            result.notificationsQueued++;
          }
        }
      }
    }

    // Keep plan-level totals honest after fee accrual.
    for (const planId of affectedPlans) {
      this.recalculatePlanFees(planId);
    }

    AuditService.log({
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

    return result;
  }

  /**
   * Queues a notification unless an identical one already went out today.
   * Without this, a nightly job plus manual runs would text the customer
   * repeatedly about the same installment.
   */
  private static queueNotification(params: {
    dealerId: string;
    customerId: string;
    deviceId?: string;
    type: Notification['type'];
    title: string;
    message: string;
    dedupeKey: string;
  }): boolean {
    const todayPrefix = new Date().toISOString().split('T')[0];

    const alreadySent = db.findOne<Notification>(
      'notifications',
      (n) =>
        n.customerId === params.customerId &&
        n.type === params.type &&
        n.createdAt.startsWith(todayPrefix) &&
        n.message === params.message
    );
    if (alreadySent) return false;

    db.insert<Notification>('notifications', {
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

  private static recalculatePlanFees(planId: string): void {
    const installments = db.find<Installment>('installments', (i) => i.planId === planId);
    const outstandingLateFees = installments.reduce(
      (sum, i) => sum + Math.max(0, (i.lateFee ?? 0) - (i.lateFeePaid ?? 0)),
      0
    );
    db.update<InstallmentPlan>('installmentPlans', planId, { outstandingLateFees });
  }
}
