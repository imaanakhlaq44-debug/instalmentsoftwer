import { v4 as uuidv4 } from 'uuid';

import { repo } from '../db/repositories/index.js';
import { runInTransaction, Tx } from '../db/prisma.js';
import {
  Payment, Installment, InstallmentPlan, Device, DevicePolicy,
  PaymentMethod, UserRole,
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

/**
 * A device the committed transaction decided should be released.
 *
 * The unlock is deliberately NOT part of the payment transaction: it talks to
 * the device management service, which opens a transaction of its own, and
 * Prisma has no nested interactive transactions. Releasing a phone only after
 * the money is durably recorded is also the right order — the reverse would
 * unlock on a payment that then failed to commit.
 */
interface PendingUnlock {
  deviceId: string;
  reason: string;
  /** OVERDUE is a flag rather than an applied lock, so clearing it needs no device command. */
  flagOnly: boolean;
}

async function resolvePolicy(dealerId: string, tx?: Tx): Promise<DevicePolicy | (typeof DEFAULT_POLICY & { dealerId: string })> {
  return (await repo.devicePolicies.findByDealer(dealerId, tx)) || { ...DEFAULT_POLICY, dealerId };
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

    const nowIso = new Date().toISOString();
    const autoVerify = params.autoVerify !== false;

    const referenceNumber =
      params.referenceNumber?.trim() ||
      `${params.paymentMethod.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-8)}`;

    const { outcome, unlock } = await runInTransaction(async (tx) => {
      // Work out which plan this payment belongs to. The original code only
      // ever acted on `installmentId`, so a lump-sum payment against a plan was
      // recorded but never reduced the balance and never unlocked the device.
      const plan = await this.resolvePlan(params, tx);

      if (plan && plan.customerId !== params.customerId) {
        throw AppError.badRequest('This installment plan does not belong to the selected customer.');
      }
      if (plan && plan.status === 'CANCELLED') {
        throw AppError.badRequest('This financing plan has been cancelled and cannot accept payments.');
      }

      // Duplicate reference guard — double-clicking "Save" at the counter is
      // common. The unique index on (dealer, reference) is what actually stops
      // two concurrent requests; this check exists to turn that into a clear
      // message rather than a constraint error.
      const duplicate = await repo.payments.findByReference(params.dealerId, referenceNumber, tx);
      if (duplicate) {
        throw AppError.conflict(
          `A payment with reference "${referenceNumber}" already exists (receipt ${duplicate.receiptNumber || duplicate.id}). ` +
            'If this is a separate payment, please use a different reference number.'
        );
      }

      const payment = await repo.payments.create(
        {
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
          receiptNumber: autoVerify
            ? await repo.payments.nextReceiptNumber(params.dealerId, new Date().getFullYear(), tx)
            : undefined,
          recordedBy: params.actor.userId,
          createdAt: nowIso,
        },
        tx
      );

      await repo.transactions.create(
        {
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
        },
        tx
      );

      if (!autoVerify) {
        return {
          outcome: {
            payment,
            allocations: [],
            creditBalanceAdded: 0,
            unlockTriggered: false,
            message: 'Payment recorded and is awaiting verification. It will be applied once verified.',
          } as PaymentOutcome,
          unlock: undefined as PendingUnlock | undefined,
        };
      }

      return this.applyPaymentEffect(payment, params.actor, tx);
    });

    return this.settleUnlock(outcome, unlock, params.actor);
  }

  public static async verifyPayment(paymentId: string, actor: PaymentActor): Promise<PaymentOutcome> {
    const { outcome, unlock } = await runInTransaction(async (tx) => {
      const payment = await repo.payments.findById(paymentId, tx);
      if (!payment) throw AppError.notFound('Payment');
      if (payment.reversedAt) throw AppError.badRequest('This payment has been reversed and cannot be verified.');
      if (payment.status === 'VERIFIED') throw AppError.badRequest('This payment has already been verified.');

      const updated = await repo.payments.update(
        paymentId,
        {
          status: 'VERIFIED',
          verifiedBy: actor.userId,
          verifiedAt: new Date().toISOString(),
          receiptNumber:
            payment.receiptNumber ||
            (await repo.payments.nextReceiptNumber(payment.dealerId, new Date().getFullYear(), tx)),
        },
        tx
      );
      if (!updated) throw AppError.notFound('Payment');

      const ledgerEntry = await repo.transactions.findByPayment(paymentId, tx);
      if (ledgerEntry) await repo.transactions.update(ledgerEntry.id, { status: 'COMPLETED' }, tx);

      return this.applyPaymentEffect(updated, actor, tx);
    });

    return this.settleUnlock(outcome, unlock, actor);
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
  private static async applyPaymentEffect(
    payment: Payment,
    actor: PaymentActor,
    tx: Tx
  ): Promise<{ outcome: PaymentOutcome; unlock?: PendingUnlock }> {
    const plan = payment.planId ? await repo.installmentPlans.findById(payment.planId, tx) : undefined;

    if (!plan) {
      // A payment with no plan (e.g. a standalone accessory sale) is still a
      // valid ledger entry; there is simply nothing to allocate it against.
      await this.notifyCustomer(payment, 'Payment recorded.', tx);
      await this.auditPayment(payment, actor, 'No installment plan linked — recorded as a standalone payment.', tx);
      return {
        outcome: {
          payment,
          allocations: [],
          creditBalanceAdded: 0,
          unlockTriggered: false,
          message: 'Payment recorded. It was not linked to any financing plan.',
        },
      };
    }

    const installments = await repo.installments.findByPlan(plan.id, tx);

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
      await repo.installments.update(inst.id, updates, tx);

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
      await repo.payments.update(payment.id, { lateFeePortion: lateFeeTotal }, tx);
      await repo.transactions.create(
        {
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
        },
        tx
      );
    }

    if (creditConsumed > 0) {
      // The credit that was sitting on the plan has now been spent on installments.
      await repo.transactions.create(
        {
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
        },
        tx
      );
    }

    if (creditBalanceAdded > 0) {
      await repo.transactions.create(
        {
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
        },
        tx
      );
    }

    const summary = await this.recalculatePlan(plan.id, tx, creditBalanceAdded);
    const unlock = await this.resolveUnlock(plan.id, payment, summary.hasOverdue, tx);

    const finalPayment = (await repo.payments.findById(payment.id, tx)) || payment;

    const message = this.buildMessage({
      allocations,
      creditBalanceAdded,
      unlockTriggered: unlock !== undefined,
      remainingBalance: summary.remainingBalance,
      completed: summary.status === 'COMPLETED',
    });

    await this.notifyCustomer(finalPayment, message, tx);
    await this.auditPayment(
      finalPayment,
      actor,
      `Applied to ${allocations.length} installment(s).` +
        (lateFeeTotal > 0 ? ` Rs. ${lateFeeTotal.toLocaleString()} settled late fees.` : '') +
        (creditBalanceAdded > 0 ? ` Rs. ${creditBalanceAdded.toLocaleString()} carried forward as credit.` : '') +
        (unlock ? ' Device was auto-unlocked.' : ''),
      tx
    );

    return {
      outcome: {
        payment: finalPayment,
        allocations,
        creditBalanceAdded,
        unlockTriggered: unlock !== undefined,
        planStatus: summary.status,
        remainingBalance: summary.remainingBalance,
        message,
      },
      unlock,
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
    return runInTransaction(async (tx) => {
      const payment = await repo.payments.findById(params.paymentId, tx);
      if (!payment) throw AppError.notFound('Payment');
      if (payment.reversedAt) throw AppError.badRequest('This payment has already been reversed.');

      const nowIso = new Date().toISOString();

      if (payment.status !== 'VERIFIED') {
        // An unverified payment never touched any balance — just mark it failed.
        await repo.payments.update(
          payment.id,
          {
            status: 'FAILED',
            reversedAt: nowIso,
            reversedBy: params.actor.userId,
            reversalReason: params.reason,
          },
          tx
        );
        const ledgerEntry = await repo.transactions.findByPayment(payment.id, tx);
        if (ledgerEntry) await repo.transactions.update(ledgerEntry.id, { status: 'REVERSED' }, tx);

        return { success: true as const, message: 'Unverified payment cancelled.', unlockedDeviceRelocked: false };
      }

      // Undo the allocation by rebuilding it from the payment's own footprint.
      const plan = payment.planId ? await repo.installmentPlans.findById(payment.planId, tx) : undefined;

      if (plan) {
        let toClawBack = payment.amount;
        let feeClawBack = payment.lateFeePortion ?? 0;

        // Reverse in the opposite order to allocation: newest installments first.
        const installments = (await repo.installments.findByPlan(plan.id, tx))
          .slice()
          .sort((a, b) => b.installmentNumber - a.installmentNumber);

        // Take the overpayment credit back before touching installments.
        const creditReclaim = Math.min(plan.creditBalance || 0, toClawBack);
        toClawBack -= creditReclaim;
        if (creditReclaim > 0) {
          await repo.installmentPlans.update(
            plan.id,
            { creditBalance: (plan.creditBalance || 0) - creditReclaim },
            tx
          );
        }

        for (const inst of installments) {
          if (toClawBack <= 0) break;

          const feeBack = Math.min(feeClawBack, inst.lateFeePaid ?? 0, toClawBack);
          feeClawBack -= feeBack;
          toClawBack -= feeBack;

          const principalBack = Math.min(inst.amountPaid, toClawBack);
          toClawBack -= principalBack;

          if (feeBack === 0 && principalBack === 0) continue;

          await repo.installments.update(
            inst.id,
            {
              amountPaid: inst.amountPaid - principalBack,
              lateFeePaid: (inst.lateFeePaid ?? 0) - feeBack,
              status: inst.status === 'PAID' ? 'PENDING' : inst.status,
              paidAt: inst.status === 'PAID' ? undefined : inst.paidAt,
            },
            tx
          );
        }
      }

      await repo.payments.update(
        payment.id,
        {
          status: 'REFUNDED',
          reversedAt: nowIso,
          reversedBy: params.actor.userId,
          reversalReason: params.reason,
        },
        tx
      );

      const ledgerEntry = await repo.transactions.findByPayment(payment.id, tx);
      if (ledgerEntry) await repo.transactions.update(ledgerEntry.id, { status: 'REVERSED' }, tx);

      // A visible contra-entry, so the ledger shows both the payment and its undo.
      await repo.transactions.create(
        {
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
        },
        tx
      );

      const summary = payment.planId ? await this.recalculatePlan(payment.planId, tx) : undefined;

      await AuditService.log(
        {
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
        },
        tx
      );

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

  private static async resolvePlan(
    params: { installmentId?: string; planId?: string; customerId: string },
    tx: Tx
  ): Promise<InstallmentPlan | undefined> {
    if (params.installmentId) {
      const inst = await repo.installments.findById(params.installmentId, tx);
      if (!inst) throw AppError.notFound('Installment');
      return repo.installmentPlans.findById(inst.planId, tx);
    }

    if (params.planId) {
      const plan = await repo.installmentPlans.findById(params.planId, tx);
      if (!plan) throw AppError.notFound('Installment plan');
      return plan;
    }

    // No target given: if the customer has exactly one open plan, use it. This
    // is what the counter clerk means 95% of the time.
    const open = await repo.installmentPlans.findOpenForCustomer(params.customerId, tx);
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
  private static async recalculatePlan(planId: string, tx: Tx, newCreditBalance?: number) {
    const plan = await repo.installmentPlans.findById(planId, tx);
    if (!plan) throw AppError.notFound('Installment plan');

    const installments = await repo.installments.findByPlan(planId, tx);

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

    await repo.installmentPlans.update(
      planId,
      {
        paidInstallments: paidCount,
        remainingBalance,
        outstandingLateFees,
        creditBalance: newCreditBalance !== undefined ? newCreditBalance : plan.creditBalance,
        status,
        closedAt: allPaid && !plan.closedAt ? new Date().toISOString() : plan.closedAt,
      },
      tx
    );

    return { status, remainingBalance, hasOverdue, outstandingLateFees, allPaid };
  }

  /**
   * Decides whether settling this payment should release the device.
   *
   * This only reads state and reports the decision; the command itself is sent
   * after the transaction commits — see `PendingUnlock`.
   */
  private static async resolveUnlock(
    planId: string,
    payment: Payment,
    hasOverdue: boolean,
    tx: Tx
  ): Promise<PendingUnlock | undefined> {
    if (hasOverdue) return undefined;

    const plan = await repo.installmentPlans.findById(planId, tx);
    if (!plan) return undefined;

    const device = await repo.devices.findById(plan.deviceId, tx);
    if (!device) return undefined;

    const restricted = device.status === 'LOCKED' || device.status === 'LOCK_PENDING' || device.status === 'OVERDUE';
    if (!restricted) return undefined;

    const policy = await resolvePolicy(device.dealerId, tx);
    if (!policy.autoUnlockEnabled) return undefined;

    return {
      deviceId: device.id,
      reason: `Automatic unlock: overdue balance cleared by payment ${payment.receiptNumber || payment.referenceNumber}.`,
      flagOnly: device.status === 'OVERDUE',
    };
  }

  /** Runs the device release decided inside the transaction, after it committed. */
  private static async settleUnlock(
    outcome: PaymentOutcome,
    unlock: PendingUnlock | undefined,
    actor: PaymentActor
  ): Promise<PaymentOutcome> {
    if (!unlock) return outcome;

    try {
      if (unlock.flagOnly) {
        // OVERDUE was only a flag, not an applied lock — clearing it needs no
        // command to the phone.
        await repo.devices.update(unlock.deviceId, {
          status: 'ACTIVE',
          lockReason: undefined,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await deviceManagementService.unlockDevice({
          deviceId: unlock.deviceId,
          userId: actor.userId,
          userName: actor.userName,
          userRole: actor.userRole,
          reason: unlock.reason,
          ipAddress: actor.ipAddress,
        });
      }
      return outcome;
    } catch (err) {
      // The money is already recorded and must not be rolled back because a
      // phone could not be reached. Report the payment honestly instead.
      console.error(`[payment] Auto-unlock failed for device ${unlock.deviceId}:`, err);
      return {
        ...outcome,
        unlockTriggered: false,
        message: `${outcome.message} The device could not be unlocked automatically — please unlock it manually.`,
      };
    }
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

  private static async notifyCustomer(payment: Payment, detail: string, tx: Tx): Promise<void> {
    await repo.notifications.create(
      {
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
      },
      tx
    );
  }

  private static async auditPayment(payment: Payment, actor: PaymentActor, detail: string, tx: Tx): Promise<void> {
    await AuditService.log(
      {
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
      },
      tx
    );
  }
}
