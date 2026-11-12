import { v4 as uuidv4 } from 'uuid';

import { prisma, runInTransaction } from '../db/prisma.js';
import { repo } from '../db/repositories/index.js';
import { toDomainList } from '../db/mappers.js';
import {
  AuthenticatedUser, LicensePack, LockOrder, LockOrderPaymentMethod, LockOrderStatus,
} from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { AuditService } from './AuditService.js';
import { LicenseService, PACK_SIZE_RULE, priceForPack } from './LicenseService.js';

/**
 * Lock orders.
 *
 * A shop used to order locks over WhatsApp and the super admin issued the pack
 * by hand. An order puts that conversation on the record: the shop picks a
 * size, pays the platform outside the system and reports the transfer; a super
 * admin checks the money arrived and approves or rejects.
 *
 * The one rule everything here protects: **an order never mints locks by
 * itself, and an approved order mints exactly one pack.** There is no payment
 * gateway, so the approval is the platform saying the money arrived — a shop
 * that could approve its own order could print free locks. Approval is
 * therefore super-admin only (enforced on the route), and it is a
 * compare-and-set inside the same transaction that issues the pack, so two
 * clicks, two tabs or two admins cannot both issue one.
 */

/** A shop with this many undecided orders has to wait for a decision first. */
export const MAX_PENDING_ORDERS_PER_DEALER = 3;

/** The row in `platform_settings` holding what a shop is told about paying. */
const PAYMENT_INSTRUCTIONS_ID = 'lock-payment-instructions';

/** An order as a list shows it: everything except the screenshot itself. */
export type LockOrderSummary = Omit<LockOrder, 'proofImage'> & { hasProof: boolean };

const SUMMARY_SELECT = {
  id: true, dealerId: true, size: true, unitPrice: true, totalPrice: true, status: true,
  paymentMethod: true, transactionId: true, amountPaid: true, note: true,
  submittedById: true, submittedByName: true, reviewedById: true, reviewedByName: true,
  reviewedAt: true, rejectionReason: true, packId: true, createdAt: true,
} as const;

function summarise(order: LockOrder): LockOrderSummary {
  const { proofImage, ...rest } = order;
  return { ...rest, hasProof: Boolean(proofImage) };
}

const METHOD_LABELS: Record<LockOrderPaymentMethod, string> = {
  JAZZCASH: 'JazzCash',
  EASYPAISA: 'Easypaisa',
  BANK_TRANSFER: 'Bank transfer',
  RAAST: 'Raast',
};

export interface SubmitOrderParams {
  dealerId: string;
  size: number;
  paymentMethod: LockOrderPaymentMethod;
  transactionId: string;
  amountPaid: number;
  proofImage?: string;
  note?: string;
  actor: AuthenticatedUser;
  ipAddress?: string;
}

export class LockOrderService {
  /**
   * Orders, newest first, without their screenshots.
   *
   * A screenshot is up to 180 KB of base64; a queue of fifty of them would be
   * megabytes nobody asked for. The list says only whether one exists, and the
   * reviewer fetches it when they open it.
   */
  public static async list(filter: { dealerId: string | null; status?: LockOrderStatus }): Promise<LockOrderSummary[]> {
    const rows = await prisma.lockOrder.findMany({
      where: {
        ...(filter.dealerId ? { dealerId: filter.dealerId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: SUMMARY_SELECT,
    });
    const withProof = await prisma.lockOrder.findMany({
      where: { id: { in: rows.map((r) => r.id) }, proofImage: { not: null } },
      select: { id: true },
    });
    const proofIds = new Set(withProof.map((r) => r.id));
    return toDomainList<Omit<LockOrder, 'proofImage'>>(rows).map((o) => ({ ...o, hasProof: proofIds.has(o.id) }));
  }

  /** The shop reports a transfer and asks for a pack. Mints nothing. */
  public static async submit(params: SubmitOrderParams): Promise<LockOrderSummary> {
    const price = priceForPack(params.size);
    if (!price) throw AppError.badRequest(PACK_SIZE_RULE);

    const transactionId = params.transactionId.trim();

    const pending = await repo.lockOrders.count({ dealerId: params.dealerId, status: 'PENDING' });
    if (pending >= MAX_PENDING_ORDERS_PER_DEALER) {
      throw AppError.conflict(
        `You already have ${pending} orders waiting to be checked. Please wait for those before sending another.`
      );
    }

    // One transfer pays for one order. The same transaction ID turning up twice
    // is either a double-click or an attempt to be paid for twice; a rejected
    // or cancelled order frees its ID so an honest mistake can be corrected.
    const reused = await repo.lockOrders.findFirst({
      paymentMethod: params.paymentMethod,
      transactionId: { equals: transactionId, mode: 'insensitive' },
      status: { in: ['PENDING', 'APPROVED'] },
    });
    if (reused) {
      throw AppError.conflict('This transaction ID has already been used for a lock order.');
    }

    const order: LockOrder = {
      id: `lord-${uuidv4().substring(0, 8)}`,
      dealerId: params.dealerId,
      size: price.size,
      unitPrice: price.unitPrice,
      totalPrice: price.totalPrice,
      status: 'PENDING',
      paymentMethod: params.paymentMethod,
      transactionId,
      amountPaid: params.amountPaid,
      proofImage: params.proofImage,
      note: params.note?.trim() || undefined,
      submittedById: params.actor.userId,
      submittedByName: params.actor.name,
      createdAt: new Date().toISOString(),
    };

    const created = await runInTransaction(async (tx) => {
      const row = await repo.lockOrders.create(order, tx);
      await AuditService.log(
        {
          dealerId: params.dealerId,
          userId: params.actor.userId,
          actorName: params.actor.name,
          actorRole: params.actor.role,
          action: 'LOCK_ORDER_SUBMITTED',
          targetType: 'LOCK_ORDER',
          targetId: row.id,
          details:
            `Ordered ${price.size} device locks (Rs ${price.totalPrice}). Reported Rs ${params.amountPaid} paid by ` +
            `${METHOD_LABELS[params.paymentMethod]}, transaction ID ${transactionId}` +
            `${params.proofImage ? ', with a screenshot' : ''}. No locks issued until the platform confirms the payment.`,
          ipAddress: params.ipAddress,
        },
        tx
      );
      return row;
    });

    return summarise(created);
  }

  /** The shop withdraws an order nobody has decided yet — a mistyped ID, say. */
  public static async cancel(params: { orderId: string; actor: AuthenticatedUser; ipAddress?: string }): Promise<LockOrderSummary> {
    const order = await repo.lockOrders.findById(params.orderId);
    // A 404 either way: another shop's order must not be confirmed to exist.
    if (!order || order.dealerId !== params.actor.dealerId) throw AppError.notFound('Lock order');

    await runInTransaction(async (tx) => {
      const done = await repo.lockOrders.decide(order.id, { status: 'CANCELLED' }, tx);
      if (!done) throw AppError.conflict(`This order is already ${order.status.toLowerCase()} and cannot be cancelled.`);
      await AuditService.log(
        {
          dealerId: order.dealerId,
          userId: params.actor.userId,
          actorName: params.actor.name,
          actorRole: params.actor.role,
          action: 'LOCK_ORDER_CANCELLED',
          targetType: 'LOCK_ORDER',
          targetId: order.id,
          details: `Cancelled the order for ${order.size} device locks (transaction ID ${order.transactionId}).`,
          ipAddress: params.ipAddress,
        },
        tx
      );
    });

    return summarise((await repo.lockOrders.findById(order.id))!);
  }

  /**
   * The platform confirms the money arrived, and the pack is issued.
   *
   * Everything happens in one transaction, in this order:
   *
   *   1. The order is moved PENDING -> APPROVED by compare-and-set. A second
   *      approval finds nothing to move and stops here, before any lock exists.
   *   2. The pack is minted through LicenseService, at the price fixed on the
   *      order.
   *   3. The order is tied to its pack, and both steps are audited.
   *
   * If any step fails the whole thing rolls back: there is no approved order
   * without a pack, and no pack from an order that was not approved.
   */
  public static async approve(params: {
    orderId: string;
    actor: AuthenticatedUser;
    ipAddress?: string;
  }): Promise<{ order: LockOrderSummary; pack: LicensePack; licenses: number }> {
    const order = await repo.lockOrders.findById(params.orderId);
    if (!order) throw AppError.notFound('Lock order');

    // Said the same way whether this request found the order decided, or lost
    // the race to another one a moment ago.
    const alreadyDecided = () =>
      AppError.conflict(
        'This order has already been decided. Locks are issued once per order and will not be issued again.'
      );
    if (order.status !== 'PENDING') throw alreadyDecided();

    const nowIso = new Date().toISOString();
    const reference = `${METHOD_LABELS[order.paymentMethod]} ${order.transactionId}`.slice(0, 80);

    const result = await runInTransaction(async (tx) => {
      const claimed = await repo.lockOrders.decide(
        order.id,
        { status: 'APPROVED', reviewedById: params.actor.userId, reviewedByName: params.actor.name, reviewedAt: nowIso },
        tx
      );
      if (!claimed) throw alreadyDecided();

      const issued = await LicenseService.issuePack({
        dealerId: order.dealerId,
        size: order.size,
        price: { unitPrice: order.unitPrice, totalPrice: order.totalPrice },
        reference,
        actor: { id: params.actor.userId, name: params.actor.name },
        tx,
      });

      await repo.lockOrders.update(order.id, { packId: issued.pack.id }, tx);

      await AuditService.log(
        {
          dealerId: order.dealerId,
          userId: params.actor.userId,
          actorName: params.actor.name,
          actorRole: params.actor.role,
          action: 'LOCK_ORDER_APPROVED',
          targetType: 'LOCK_ORDER',
          targetId: order.id,
          details:
            `Approved the order for ${order.size} device locks (Rs ${order.totalPrice}; shop reported Rs ${order.amountPaid} ` +
            `by ${reference}). Pack ${issued.pack.id} issued.`,
          ipAddress: params.ipAddress,
        },
        tx
      );
      await AuditService.log(
        {
          dealerId: order.dealerId,
          userId: params.actor.userId,
          actorName: params.actor.name,
          actorRole: params.actor.role,
          action: 'LICENSE_PACK_ISSUED',
          targetType: 'LICENSE_PACK',
          targetId: issued.pack.id,
          details:
            `Issued a pack of ${issued.pack.size} device locks at Rs ${issued.pack.unitPrice} each ` +
            `(Rs ${issued.pack.totalPrice} total), reference ${reference}, for lock order ${order.id}.`,
          ipAddress: params.ipAddress,
        },
        tx
      );

      return issued;
    });

    return { order: summarise((await repo.lockOrders.findById(order.id))!), ...result };
  }

  /** The platform turns an order down, and says why. Mints nothing. */
  public static async reject(params: {
    orderId: string;
    reason: string;
    actor: AuthenticatedUser;
    ipAddress?: string;
  }): Promise<LockOrderSummary> {
    const order = await repo.lockOrders.findById(params.orderId);
    if (!order) throw AppError.notFound('Lock order');

    const reason = params.reason.trim();

    await runInTransaction(async (tx) => {
      const done = await repo.lockOrders.decide(
        order.id,
        {
          status: 'REJECTED',
          rejectionReason: reason,
          reviewedById: params.actor.userId,
          reviewedByName: params.actor.name,
          reviewedAt: new Date().toISOString(),
        },
        tx
      );
      if (!done) throw AppError.conflict(`This order is already ${order.status.toLowerCase()} and can no longer be rejected.`);
      await AuditService.log(
        {
          dealerId: order.dealerId,
          userId: params.actor.userId,
          actorName: params.actor.name,
          actorRole: params.actor.role,
          action: 'LOCK_ORDER_REJECTED',
          targetType: 'LOCK_ORDER',
          targetId: order.id,
          details:
            `Rejected the order for ${order.size} device locks (transaction ID ${order.transactionId}). ` +
            `Reason: ${reason}`,
          ipAddress: params.ipAddress,
        },
        tx
      );
    });

    return summarise((await repo.lockOrders.findById(order.id))!);
  }

  /** What a shop is told about where to send the money. Empty until the super admin writes it. */
  public static async getPaymentInstructions(): Promise<string> {
    return (await repo.platformSettings.findById(PAYMENT_INSTRUCTIONS_ID))?.value ?? '';
  }

  public static async setPaymentInstructions(params: {
    value: string;
    actor: AuthenticatedUser;
    ipAddress?: string;
  }): Promise<string> {
    const value = params.value.trim();
    const row = {
      id: PAYMENT_INSTRUCTIONS_ID,
      value,
      updatedById: params.actor.userId,
      updatedByName: params.actor.name,
      updatedAt: new Date().toISOString(),
    };

    await runInTransaction(async (tx) => {
      if (await repo.platformSettings.findById(PAYMENT_INSTRUCTIONS_ID, tx)) {
        await repo.platformSettings.update(PAYMENT_INSTRUCTIONS_ID, row, tx);
      } else {
        await repo.platformSettings.create(row, tx);
      }
      await AuditService.log(
        {
          userId: params.actor.userId,
          actorName: params.actor.name,
          actorRole: params.actor.role,
          action: 'LOCK_PAYMENT_INSTRUCTIONS_UPDATED',
          targetType: 'PLATFORM_SETTING',
          targetId: PAYMENT_INSTRUCTIONS_ID,
          // The accounts shops are told to pay into are worth having on the
          // record in full: a changed account number is how a fraud would look.
          details: `Payment instructions for lock orders set to: ${value || '(empty)'}`.slice(0, 1000),
          ipAddress: params.ipAddress,
        },
        tx
      );
    });

    return value;
  }
}
