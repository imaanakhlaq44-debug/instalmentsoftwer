import { Router } from 'express';
import { z } from 'zod';

import { repo, indexBy } from '../db/repositories/index.js';
import { Dealer, LockOrderStatus } from '../types/index.js';
import { LockOrderService, MAX_PENDING_ORDERS_PER_DEALER } from '../services/LockOrderService.js';
import { PACK_SIZE_RULE, PRICE_TIERS, MAX_PACK_SIZE, priceForPack } from '../services/LicenseService.js';
import {
  requireDealerAdmin, requireRole, requireSuperAdmin, getAuthUser, resolveDealerScope, clientIp, routeParam,
} from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';

/**
 * Lock orders: a shop buys a pack from its dashboard.
 *
 * Who may do what, and it is the whole point of the file:
 *
 *   - A shop owner (DEALER_ADMIN) places and cancels their own shop's orders.
 *   - Only a SUPER_ADMIN approves or rejects, because approval is the platform
 *     confirming money arrived and is what mints the locks.
 *   - Counter staff and customers have no business with any of it.
 */
export const lockOrdersRouter = Router();

lockOrdersRouter.use(requireDealerAdmin);

const STATUSES: LockOrderStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

/**
 * Orders, newest first. A shop owner sees their own; a super admin sees every
 * shop's, or one shop's with `?dealerId=`, optionally narrowed by `?status=`.
 */
lockOrdersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = resolveDealerScope(req);
    const status = STATUSES.find((s) => s === req.query.status);

    const [orders, paymentInstructions] = await Promise.all([
      LockOrderService.list({ dealerId: scope, status }),
      LockOrderService.getPaymentInstructions(),
    ]);
    const dealersById = indexBy<Dealer>(
      await repo.dealers.findByIds([...new Set(orders.map((o) => o.dealerId))]),
      (d) => d.id
    );

    res.json({
      orders: orders.map((o) => {
        const dealer = dealersById.get(o.dealerId);
        return {
          ...o,
          dealerName: dealer?.name ?? 'Unknown dealer',
          dealerCity: dealer?.city ?? '',
          dealerPhone: dealer?.phone ?? '',
          ownerName: dealer?.ownerName ?? '',
        };
      }),
      paymentInstructions,
      priceTiers: PRICE_TIERS,
      maxPackSize: MAX_PACK_SIZE,
      maxPendingOrders: MAX_PENDING_ORDERS_PER_DEALER,
    });
  })
);

/**
 * Same cap as a customer's payment screenshot (payments.routes.ts): the browser
 * downscales until the image fits, and the whole request stays under
 * `config.bodyLimit`. The image lives in the order's own row — there is no file
 * storage to run or clean up.
 */
const PROOF_IMAGE_MAX_CHARS = 180_000;

const submitSchema = z.object({
  size: z
    .number()
    .int()
    .refine((n) => priceForPack(n) !== undefined, { message: PACK_SIZE_RULE }),
  // No CASH: an order is a transfer somebody can look up.
  paymentMethod: z.enum(['JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER', 'RAAST']),
  transactionId: z
    .string()
    .trim()
    .min(4, 'Enter the transaction ID from your transfer.')
    .max(60)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/, 'A transaction ID is letters and numbers only.'),
  amountPaid: z
    .number({ message: 'Amount must be a number.' })
    .int('Amount must be in whole rupees.')
    .positive('Amount must be greater than zero.')
    .max(10_000_000, 'Amount exceeds the maximum allowed value.'),
  proofImage: z
    .string()
    .trim()
    .startsWith('data:image/', 'The proof must be an image.')
    .max(PROOF_IMAGE_MAX_CHARS, 'That image is too large. Please send a smaller screenshot.')
    .optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * A shop owner places an order. DEALER_ADMIN only: a super admin who wants a
 * shop to have locks issues the pack directly, and has no shop to order for.
 *
 * The shop is always the caller's own. There is no dealerId in the body to get
 * wrong, or to point at somebody else.
 */
lockOrdersRouter.post(
  '/',
  requireRole('DEALER_ADMIN'),
  validateBody(submitSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    if (!user.dealerId) throw AppError.forbidden('Your account is not linked to any dealer.');
    const body = req.body as z.infer<typeof submitSchema>;

    const order = await LockOrderService.submit({
      dealerId: user.dealerId,
      size: body.size,
      paymentMethod: body.paymentMethod,
      transactionId: body.transactionId,
      amountPaid: body.amountPaid,
      proofImage: body.proofImage,
      note: body.note,
      actor: user,
      ipAddress: clientIp(req),
    });

    res.status(201).json({
      order,
      message: 'Order received. Your locks are added as soon as the payment is confirmed.',
    });
  })
);

lockOrdersRouter.post(
  '/:id/cancel',
  requireRole('DEALER_ADMIN'),
  asyncHandler(async (req, res) => {
    const order = await LockOrderService.cancel({
      orderId: routeParam(req, 'id'),
      actor: getAuthUser(req),
      ipAddress: clientIp(req),
    });
    res.json({ order, message: 'Order cancelled.' });
  })
);

/** The screenshot for one order: its own shop, or a super admin. */
lockOrdersRouter.get(
  '/:id/proof',
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const order = await repo.lockOrders.findById(routeParam(req, 'id'));
    if (!order || (user.role !== 'SUPER_ADMIN' && order.dealerId !== user.dealerId) || !order.proofImage) {
      throw AppError.notFound('Payment screenshot');
    }
    res.json({ proofImage: order.proofImage });
  })
);

/**
 * Approve: the platform confirms the money arrived, and the pack is minted —
 * once, in the same transaction. Super admin only, for the reason given on
 * POST /api/licenses/packs: whoever can call this can print locks.
 */
lockOrdersRouter.post(
  '/:id/approve',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { order, pack, licenses } = await LockOrderService.approve({
      orderId: routeParam(req, 'id'),
      actor: getAuthUser(req),
      ipAddress: clientIp(req),
    });
    res.json({ order, pack, licenses, message: `${licenses} device locks issued.` });
  })
);

const rejectSchema = z.object({
  reason: z.string().trim().min(5, 'Say why, so the shop knows what to fix.').max(500),
});

lockOrdersRouter.post(
  '/:id/reject',
  requireSuperAdmin,
  validateBody(rejectSchema),
  asyncHandler(async (req, res) => {
    const order = await LockOrderService.reject({
      orderId: routeParam(req, 'id'),
      reason: (req.body as z.infer<typeof rejectSchema>).reason,
      actor: getAuthUser(req),
      ipAddress: clientIp(req),
    });
    res.json({ order, message: 'Order rejected.' });
  })
);

const instructionsSchema = z.object({
  paymentInstructions: z.string().trim().max(1000),
});

/** Where shops are told to send the money. Written by the super admin, read by shop owners. */
lockOrdersRouter.put(
  '/payment-instructions',
  requireSuperAdmin,
  validateBody(instructionsSchema),
  asyncHandler(async (req, res) => {
    const paymentInstructions = await LockOrderService.setPaymentInstructions({
      value: (req.body as z.infer<typeof instructionsSchema>).paymentInstructions,
      actor: getAuthUser(req),
      ipAddress: clientIp(req),
    });
    res.json({ paymentInstructions, message: 'Payment instructions saved.' });
  })
);
