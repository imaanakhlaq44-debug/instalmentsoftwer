import { v4 as uuidv4 } from 'uuid';

import { db } from '../db/db.js';
import {
  Payment, Installment, InstallmentPlan, Device, DevicePolicy,
  Transaction, Notification, PaymentMethod, UserRole,
} from '../types/index.js';
import { deviceManagementService } from './DeviceManagementService.js';
import { AuditService } from './AuditService.js';
import { AppError } from '../utils/AppError.js';
import { amountOutstanding, DEFAULT_POLICY } from './InstallmentMath.js';

export interface PaymentActor {
  userId: string;
  userName: string;
  userRole: UserRole;
  ipAddress?: string;
}

export interface AllocationLine {
  installmentId: string;
  installmentNumber: number;
  appliedToLateFee: number;
  appliedToPrincipal: number;
  nowFullyPaid: boolean;
}

export interface PaymentOutcome {
  payment: Payment;
  allocations: AllocationLine[];
  creditBalanceAdded: number;
  unlockTriggered: boolean;
  planStatus?: string;
  remainingBalance?: number;
  message: string;
}

function resolvePolicy(dealerId: string): DevicePolicy | (typeof DEFAULT_POLICY & { dealerId: string }) {
  return (
    db.findOne<DevicePolicy>('devicePolicies', (p) => p.dealerId === dealerId) || {
      ...DEFAULT_POLICY,
      dealerId,
    }
  );
}

/** Sequential, human-readable receipt number the customer can quote at the counter. */
function nextReceiptNumber(dealerId: string): string {
  const year = new Date().getFullYear();
  const prefix = `RCP-${year}-`;
  const count = db.find<Payment>('payments', (p) => p.dealerId === dealerId && (p.receiptNumber || '').startsWith(prefix)).length;
  return `${prefix}${String(count + 1).padStart(6, '0')}`;
}

export class PaymentService {
  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  public static async recordPayment(params: {
    dealerId: string;
    customerId: string;
    installmentId?: string;
    planId?: string;
    amount: number;
    paymentMethod: PaymentMethod;
    referenceNumber?: string;
    notes?: string;
    autoVerify?: boolean;
    actor: PaymentActor;
  }): Promise<PaymentOutcome> {
    if (params.amount <= 0) {
      throw AppError.badRequest('Payment amount must be greater than zero.');
    }

    // Work out which plan this payment belongs to. The original code only ever
    // acted on `installmentId`, so a lump-sum payment against a plan was recorded
    // but never reduced the balance and never unlocked the device.
    const plan = this.resolvePlan(params);

    if (plan && plan.customerId !== params.customerId) {
      throw AppError.badRequest('This installment plan does not belong to the selected customer.');
    }
    if (plan && plan.status === 'CANCELLED') {
      throw AppError.badRequest('This financing plan has been cancelled and cannot accept payments.');
    }

    const nowIso = new Date().toISOString();
    const autoVerify = params.autoVerify !== false;

    const referenceNumber =
      params.referenceNumber?.trim() ||
      `${params.paymentMethod.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-8)}`;

    // Duplicate reference guard — double-clicking "Save" at the counter is common.
    const duplicate = db.findOne<Payment>(
      'payments',
      (p) =>
        p.dealerId === params.dealerId &&
        p.referenceNumber === referenceNumber &&
        p.status !== 'FAILED' &&
        !p.reversedAt
    );
    if (duplicate) {
      throw AppError.conflict(
        `A payment with reference "${referenceNumber}" already exists (receipt ${duplicate.receiptNumber || duplicate.id}). ` +
          'If this is a separate payment, please use a different reference number.'
      );
    }

    return db.batch(() => {
      const payment = db.insert<Payment>('payments', {
        id: `pay-${uuidv4().substring(0, 8)}`,
        dealerId: params.dealerId,
        customerId: params.customerId,
        installmentId: params.installmentId,
        planId: plan?.id,
        amount: params.amount,
        paymentMethod: params.paymentMethod,
        referenceNumber,
        notes: params.notes,
        status: autoVerify ? 'VERIFIED' : 'PENDING',
        verifiedBy: autoVerify ? params.actor.userId : undefined,
        verifiedAt: autoVerify ? nowIso : undefined,
        receiptNumber: autoVerify ? nextReceiptNumber(params.dealerId) : undefined,
        recordedBy: params.actor.userId,
        createdAt: nowIso,
      });

      db.insert<Transaction>('transactions', {
        id: `tx-${uuidv4().substring(0, 8)}`,
        dealerId: params.dealerId,
        customerId: params.customerId,
        paymentId: payment.id,
        planId: plan?.id,
        type: 'MONTHLY_INSTALLMENT',
        amount: params.amount,
        status: autoVerify ? 'COMPLETED' : 'PENDING',
        date: nowIso,
        notes: params.notes || `Payment received via ${params.paymentMethod}.`,
      });

      if (!autoVerify) {
        return {
          payment,
          allocations: [],
          creditBalanceAdded: 0,
          unlockTriggered: false,
          message: 'Payment recorded and is awaiting verification. It will be applied once verified.',
        };
      }

      return this.applyPaymentEffect(payment, params.actor);
    });
  }

  public static async verifyPayment(paymentId: string, actor: PaymentActor): Promise<PaymentOutcome> {
    const payment = db.findById<Payment>('payments', paymentId);
    if (!payment) throw AppError.notFound('Payment');
    if (payment.reversedAt) throw AppError.badRequest('This payment has been reversed and cannot be verified.');
    if (payment.status === 'VERIFIED') throw AppError.badRequest('This payment has already been verified.');

    return db.batch(() => {
      const updated = db.update<Payment>('payments', paymentId, {
        status: 'VERIFIED',
        verifiedBy: actor.userId,
        verifiedAt: new Date().toISOString(),
        receiptNumber: payment.receiptNumber || nextReceiptNumber(payment.dealerId),
      });
      if (!updated) throw AppError.notFound('Payment');

      const tx = db.findOne<Transaction>('transactions', (t) => t.paymentId === paymentId);
      if (tx) db.update<Transaction>('transactions', tx.id, { status: 'COMPLETED' });

      return this.applyPaymentEffect(updated, actor);
    });
  }

  // -------------------------------------------------------------------------
  // Allocation
  // -------------------------------------------------------------------------

  /**
   * Distributes a verified payment across the plan.
   *
   * Order of settlement, which mirrors how these shops actually account:
   *   1. the specifically targeted installment, if one was chosen;
   *   2. then remaining installments oldest-first;
   *   3. within each installment, outstanding late fee before principal;
   *   4. anything left over becomes plan credit for the next due date, instead
   *      of vanishing as it did before.
   */
  private static applyPaymentEffect(payment: Payment, actor: PaymentActor): PaymentOutcome {
    const plan = payment.planId ? db.findById<InstallmentPlan>('installmentPlans', payment.planId) : undefined;

    if (!plan) {
      // A payment with no plan (e.g. a standalone accessory sale) is still a
      // valid ledger entry; there is simply nothing to allocate it against.
      this.notifyCustomer(payment, 'Payment recorded.');
      this.auditPayment(payment, actor, 'No installment plan linked — recorded as a standalone payment.');
      return {
        payment,
        allocations: [],
        creditBalanceAdded: 0,
        unlockTriggered: false,
        message: 'Payment recorded. It was not linked to any financing plan.',
      };
    }

    const installments = db
      .find<Installment>('installments', (i) => i.planId === plan.id)
      .sort((a, b) => a.installmentNumber - b.installmentNumber);

    // Targeted installment goes first, then everything else in due order.
    const queue = payment.installmentId
      ? [
          ...installments.filter((i) => i.id === payment.installmentId),
          ...installments.filter((i) => i.id !== payment.installmentId),
        ]
      : installments;

    let remaining = payment.amount + (plan.creditBalance || 0);
    const creditConsumed = Math.min(plan.creditBalance || 0, remaining);
    const allocations: AllocationLine[] = [];
    let lateFeeTotal = 0;

    for (const inst of queue) {
      if (remaining <= 0) break;
      const outstanding = amountOutstanding(inst);
      if (outstanding <= 0) continue;

      const feeDue = Math.max(0, (inst.lateFee ?? 0) - (inst.lateFeePaid ?? 0));
      const toFee = Math.min(feeDue, remaining);
      remaining -= toFee;

      const principalDue = Math.max(0, inst.amountDue - inst.amountPaid);
      const toPrincipal = Math.min(principalDue, remaining);
      remaining -= toPrincipal;

      if (toFee === 0 && toPrincipal === 0) continue;

      const newPaid = inst.amountPaid + toPrincipal;
      const newFeePaid = (inst.lateFeePaid ?? 0) + toFee;
      const fullyPaid = newPaid >= inst.amountDue && newFeePaid >= (inst.lateFee ?? 0);

      const updates: Partial<Installment> = {
        amountPaid: newPaid,
        lateFeePaid: newFeePaid,
      };
      if (fullyPaid) {
        updates.status = 'PAID';
        updates.paidAt = new Date().toISOString();
      }
      // Note: `paidAt` is deliberately left untouched when not fully paid. The
      // old code set it to undefined on every partial payment, wiping the date
      // off an installment that had already been settled.
      db.update<Installment>('installments', inst.id, updates);

      lateFeeTotal += toFee;
      allocations.push({
        installmentId: inst.id,
        installmentNumber: inst.installmentNumber,
        appliedToLateFee: toFee,
        appliedToPrincipal: toPrincipal,
        nowFullyPaid: fullyPaid,
      });
    }

    const creditBalanceAdded = Math.max(0, remaining);

    if (lateFeeTotal > 0) {
      db.update<Payment>('payments', payment.id, { lateFeePortion: lateFeeTotal });
      db.insert<Transaction>('transactions', {
        id: `tx-${uuidv4().substring(0, 8)}`,
        dealerId: payment.dealerId,
        customerId: payment.customerId,
        paymentId: payment.id,
        planId: plan.id,
        type: 'LATE_FEE',
        amount: lateFeeTotal,
        status: 'COMPLETED',
        date: new Date().toISOString(),
        notes: `Late fee settled from receipt ${payment.receiptNumber || payment.id}.`,
      });
    }

    if (creditConsumed > 0) {
      // The credit that was sitting on the plan has now been spent on installments.
      db.insert<Transaction>('transactions', {
        id: `tx-${uuidv4().substring(0, 8)}`,
        dealerId: payment.dealerId,
        customerId: payment.customerId,
        paymentId: payment.id,
        planId: plan.id,
        type: 'ADVANCE_CREDIT',
        amount: -creditConsumed,
        status: 'COMPLETED',
        date: new Date().toISOString(),
        notes: `Rs. ${creditConsumed.toLocaleString()} of existing advance credit applied to this settlement.`,
      });
    }

    if (creditBalanceAdded > 0) {
      db.insert<Transaction>('transactions', {
        id: `tx-${uuidv4().substring(0, 8)}`,
        dealerId: payment.dealerId,
        customerId: payment.customerId,
        paymentId: payment.id,
        planId: plan.id,
        type: 'ADVANCE_CREDIT',
        amount: creditBalanceAdded,
        status: 'COMPLETED',
        date: new Date().toISOString(),
        notes: `Overpayment held as advance credit against the next installment.`,
      });
    }

    const summary = this.recalculatePlan(plan.id, creditBalanceAdded);
    const unlockTriggered = this.maybeUnlockDevice(plan.id, payment, actor, summary.hasOverdue);

    const finalPayment = db.findById<Payment>('payments', payment.id) || payment;

    const message = this.buildMessage({
      allocations,
      creditBalanceAdded,
      unlockTriggered,
      remainingBalance: summary.remainingBalance,
      completed: summary.status === 'COMPLETED',
    });

    this.notifyCustomer(finalPayment, message);
    this.auditPayment(
      finalPayment,
      actor,
      `Applied to ${allocations.length} installment(s).` +
        (lateFeeTotal > 0 ? ` Rs. ${lateFeeTotal.toLocaleString()} settled late fees.` : '') +
        (creditBalanceAdded > 0 ? ` Rs. ${creditBalanceAdded.toLocaleString()} carried forward as credit.` : '') +
        (unlockTriggered ? ' Device was auto-unlocked.' : '')
    );

    return {
      payment: finalPayment,
      allocations,
      creditBalanceAdded,
      unlockTriggered,
      planStatus: summary.status,
      remainingBalance: summary.remainingBalance,
      message,
    };
  }

  // -------------------------------------------------------------------------
  // Reversal — a bounced cheque or a mis-keyed amount had no remedy before
  // -------------------------------------------------------------------------

  public static async reversePayment(params: {
    paymentId: string;
    reason: string;
    actor: PaymentActor;
  }): Promise<{ success: true; message: string; unlockedDeviceRelocked: boolean }> {
    const payment = db.findById<Payment>('payments', params.paymentId);
    if (!payment) throw AppError.notFound('Payment');
    if (payment.reversedAt) throw AppError.badRequest('This payment has already been reversed.');
    if (payment.status !== 'VERIFIED') {
      // An unverified payment never touched any balance — just mark it failed.
      db.update<Payment>('payments', payment.id, {
        status: 'FAILED',
        reversedAt: new Date().toISOString(),
        reversedBy: params.actor.userId,
        reversalReason: params.reason,
      });
      const tx = db.findOne<Transaction>('transactions', (t) => t.paymentId === payment.id);
      if (tx) db.update<Transaction>('transactions', tx.id, { status: 'REVERSED' });
      return { success: true, message: 'Unverified payment cancelled.', unlockedDeviceRelocked: false };
    }

    return db.batch(() => {
      const nowIso = new Date().toISOString();

      // Undo the allocation by rebuilding it from the payment's own footprint.
      const plan = payment.planId ? db.findById<InstallmentPlan>('installmentPlans', payment.planId) : undefined;

      if (plan) {
        let toClawBack = payment.amount;
        const feePortion = payment.lateFeePortion ?? 0;
        let feeClawBack = feePortion;

        // Reverse in the opposite order to allocation: newest installments first.
        const installments = db
          .find<Installment>('installments', (i) => i.planId === plan.id)
          .sort((a, b) => b.installmentNumber - a.installmentNumber);

        // Take the overpayment credit back before touching installments.
        const creditReclaim = Math.min(plan.creditBalance || 0, toClawBack);
        toClawBack -= creditReclaim;
        if (creditReclaim > 0) {
          db.update<InstallmentPlan>('installmentPlans', plan.id, {
            creditBalance: (plan.creditBalance || 0) - creditReclaim,
          });
        }

        for (const inst of installments) {
          if (toClawBack <= 0) break;

          const feeBack = Math.min(feeClawBack, inst.lateFeePaid ?? 0, toClawBack);
          feeClawBack -= feeBack;
          toClawBack -= feeBack;

          const principalBack = Math.min(inst.amountPaid, toClawBack);
          toClawBack -= principalBack;

          if (feeBack === 0 && principalBack === 0) continue;

          db.update<Installment>('installments', inst.id, {
            amountPaid: inst.amountPaid - principalBack,
            lateFeePaid: (inst.lateFeePaid ?? 0) - feeBack,
            status: inst.status === 'PAID' ? 'PENDING' : inst.status,
            paidAt: inst.status === 'PAID' ? undefined : inst.paidAt,
          });
        }
      }

      db.update<Payment>('payments', payment.id, {
        status: 'REFUNDED',
        reversedAt: nowIso,
        reversedBy: params.actor.userId,
        reversalReason: params.reason,
      });

      const tx = db.findOne<Transaction>('transactions', (t) => t.paymentId === payment.id);
      if (tx) db.update<Transaction>('transactions', tx.id, { status: 'REVERSED' });

      // A visible contra-entry, so the ledger shows both the payment and its undo.
      db.insert<Transaction>('transactions', {
        id: `tx-${uuidv4().substring(0, 8)}`,
        dealerId: payment.dealerId,
        customerId: payment.customerId,
        paymentId: payment.id,
        planId: payment.planId,
        type: 'REVERSAL',
        amount: -payment.amount,
        status: 'COMPLETED',
        date: nowIso,
        notes: `Reversal of receipt ${payment.receiptNumber || payment.id}. Reason: ${params.reason}`,
      });

      const summary = payment.planId ? this.recalculatePlan(payment.planId) : undefined;

      AuditService.log({
        dealerId: payment.dealerId,
        userId: params.actor.userId,
        actorName: params.actor.userName,
        actorRole: params.actor.userRole,
        action: 'PAYMENT_REVERSED',
        targetType: 'PAYMENT',
        targetId: payment.id,
        details:
          `Reversed a payment of Rs. ${payment.amount.toLocaleString()} ` +
          `(receipt ${payment.receiptNumber || payment.id}). Reason: ${params.reason}`,
        ipAddress: params.actor.ipAddress,
      });

      return {
        success: true as const,
        message:
          `Payment of Rs. ${payment.amount.toLocaleString()} has been reversed. ` +
          (summary ? `Outstanding balance is now Rs. ${summary.remainingBalance.toLocaleString()}.` : ''),
        unlockedDeviceRelocked: false,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private static resolvePlan(params: { installmentId?: string; planId?: string; customerId: string }): InstallmentPlan | undefined {
    if (params.installmentId) {
      const inst = db.findById<Installment>('installments', params.installmentId);
      if (!inst) throw AppError.notFound('Installment');
      return db.findById<InstallmentPlan>('installmentPlans', inst.planId);
    }

    if (params.planId) {
      const plan = db.findById<InstallmentPlan>('installmentPlans', params.planId);
      if (!plan) throw AppError.notFound('Installment plan');
      return plan;
    }

    // No target given: if the customer has exactly one open plan, use it. This is
    // what the counter clerk means 95% of the time.
    const open = db.find<InstallmentPlan>(
      'installmentPlans',
      (p) => p.customerId === params.customerId && p.status !== 'COMPLETED' && p.status !== 'CANCELLED'
    );
    if (open.length === 1) return open[0];
    if (open.length > 1) {
      throw AppError.badRequest(
        'This customer has more than one active financing plan. Please choose which plan the payment applies to.'
      );
    }
    return undefined;
  }

  /**
   * Recomputes every derived field on a plan from its installments.
   *
   * `newCreditBalance` is the absolute figure to store, or `undefined` to leave
   * the existing credit untouched (used by the reversal path, which adjusts the
   * credit itself).
   */
  private static recalculatePlan(planId: string, newCreditBalance?: number) {
    const plan = db.findById<InstallmentPlan>('installmentPlans', planId);
    if (!plan) throw AppError.notFound('Installment plan');

    const installments = db.find<Installment>('installments', (i) => i.planId === planId);

    const paidCount = installments.filter((i) => i.status === 'PAID').length;
    const principalPaid = installments.reduce((s, i) => s + i.amountPaid, 0);
    const outstandingLateFees = installments.reduce(
      (s, i) => s + Math.max(0, (i.lateFee ?? 0) - (i.lateFeePaid ?? 0)),
      0
    );
    const remainingBalance = Math.max(0, plan.financedAmount - principalPaid);
    const hasOverdue = installments.some((i) => i.status === 'OVERDUE');
    const allPaid = installments.every((i) => i.status === 'PAID');

    const status = allPaid ? 'COMPLETED' : hasOverdue ? 'OVERDUE' : 'CURRENT';

    db.update<InstallmentPlan>('installmentPlans', planId, {
      paidInstallments: paidCount,
      remainingBalance,
      outstandingLateFees,
      creditBalance: newCreditBalance !== undefined ? newCreditBalance : plan.creditBalance,
      status,
      closedAt: allPaid && !plan.closedAt ? new Date().toISOString() : plan.closedAt,
    });

    return { status, remainingBalance, hasOverdue, outstandingLateFees, allPaid };
  }

  /** Auto-unlock once nothing is overdue on the plan, if policy allows it. */
  private static maybeUnlockDevice(
    planId: string,
    payment: Payment,
    actor: PaymentActor,
    hasOverdue: boolean
  ): boolean {
    if (hasOverdue) return false;

    const plan = db.findById<InstallmentPlan>('installmentPlans', planId);
    if (!plan) return false;

    const device = db.findById<Device>('devices', plan.deviceId);
    if (!device) return false;

    const restricted = device.status === 'LOCKED' || device.status === 'LOCK_PENDING' || device.status === 'OVERDUE';
    if (!restricted) return false;

    const policy = resolvePolicy(device.dealerId);
    if (!policy.autoUnlockEnabled) return false;

    // OVERDUE is only a flag, not an applied lock — clearing it needs no command.
    if (device.status === 'OVERDUE') {
      db.update<Device>('devices', device.id, {
        status: 'ACTIVE',
        lockReason: undefined,
        updatedAt: new Date().toISOString(),
      });
      return true;
    }

    void deviceManagementService.unlockDevice({
      deviceId: device.id,
      userId: actor.userId,
      userName: actor.userName,
      userRole: actor.userRole,
      reason: `Automatic unlock: overdue balance cleared by payment ${payment.receiptNumber || payment.referenceNumber}.`,
      ipAddress: actor.ipAddress,
    });

    return true;
  }

  private static buildMessage(params: {
    allocations: AllocationLine[];
    creditBalanceAdded: number;
    unlockTriggered: boolean;
    remainingBalance: number;
    completed: boolean;
  }): string {
    const parts: string[] = [];

    const settled = params.allocations.filter((a) => a.nowFullyPaid).length;
    if (settled > 0) {
      parts.push(`${settled} installment${settled > 1 ? 's' : ''} settled in full.`);
    } else if (params.allocations.length > 0) {
      parts.push('Partial payment applied.');
    }

    if (params.creditBalanceAdded > 0) {
      parts.push(`Rs. ${params.creditBalanceAdded.toLocaleString()} held as advance credit for the next installment.`);
    }

    if (params.completed) {
      parts.push('This financing plan is now fully paid.');
    } else {
      parts.push(`Remaining balance: Rs. ${params.remainingBalance.toLocaleString()}.`);
    }

    if (params.unlockTriggered) {
      parts.push('The device has been unlocked automatically.');
    }

    return parts.join(' ');
  }

  private static notifyCustomer(payment: Payment, detail: string): void {
    db.insert<Notification>('notifications', {
      id: `notif-${uuidv4().substring(0, 8)}`,
      dealerId: payment.dealerId,
      customerId: payment.customerId,
      type: 'PAYMENT_DUE',
      channel: 'SMS',
      title: 'Payment Received',
      message:
        `Rs. ${payment.amount.toLocaleString()} received via ${payment.paymentMethod} ` +
        `(Receipt: ${payment.receiptNumber || payment.referenceNumber}). ${detail} Thank you.`,
      status: 'QUEUED',
      createdAt: new Date().toISOString(),
    });
  }

  private static auditPayment(payment: Payment, actor: PaymentActor, detail: string): void {
    AuditService.log({
      dealerId: payment.dealerId,
      userId: actor.userId,
      actorName: actor.userName,
      actorRole: actor.userRole,
      action: 'PAYMENT_VERIFIED',
      targetType: 'PAYMENT',
      targetId: payment.id,
      details:
        `Rs. ${payment.amount.toLocaleString()} via ${payment.paymentMethod} ` +
        `(Ref ${payment.referenceNumber}, Receipt ${payment.receiptNumber || 'n/a'}). ${detail}`,
      ipAddress: actor.ipAddress,
    });
  }
}
