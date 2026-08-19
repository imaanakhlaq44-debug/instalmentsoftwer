import { Router } from 'express';
import { z } from 'zod';

import { repo, indexBy } from '../db/repositories/index.js';
import { Customer } from '../types/index.js';
import { PaymentService, PaymentActor } from '../services/PaymentService.js';
import {
  requireDealerStaff, requireDealerAdmin, getAuthUser, resolveDealerScope,
  resolveWritableDealerId, assertDealerAccess, clientIp,
  routeParam,
} from '../middleware/auth.js';
import { validateBody, validateQuery, getQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { positiveMoneySchema, paginationSchema, pageEnvelope } from '../utils/validators.js';

export const paymentsRouter = Router();

function actorFrom(req: Parameters<typeof getAuthUser>[0]): PaymentActor {
  const user = getAuthUser(req);
  return { userId: user.userId, userName: user.name, userRole: user.role, ipAddress: clientIp(req) };
}

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------

const listQuerySchema = paginationSchema.extend({
  customerId: z.string().trim().max(64).optional(),
  planId: z.string().trim().max(64).optional(),
  status: z.enum(['ALL', 'PENDING', 'VERIFIED', 'FAILED', 'REFUNDED']).default('ALL'),
  method: z.string().trim().max(20).optional(),
  from: z.string().trim().max(30).optional(),
  to: z.string().trim().max(30).optional(),
  search: z.string().trim().max(120).optional(),
  dealerId: z.string().trim().max(64).optional(),
});

paymentsRouter.get(
  '/',
  validateQuery(listQuerySchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const scope = resolveDealerScope(req);
    const q = getQuery<z.infer<typeof listQuerySchema>>(req);

    const filters = {
      dealerId: scope,
      // A CUSTOMER login only ever sees its own payments.
      customerId: user.role === 'CUSTOMER' ? user.customerId : q.customerId,
      planId: q.planId,
      status: q.status,
      method: q.method,
      search: q.search,
      from: q.from,
      to: q.to,
    };

    // Totals reflect the whole filtered set, not just the visible page — so
    // they are summed by the database rather than from `page.data`.
    const [page, totals] = await Promise.all([
      repo.payments.list({ ...filters, page: q.page, limit: q.limit }),
      repo.payments.totals(repo.payments.buildWhere(filters)),
    ]);

    const customerIds = [...new Set(page.data.map((p) => p.customerId))];
    const customersById = indexBy<Customer>(await repo.customers.findByIds(customerIds), (c) => c.id);

    const enriched = page.data.map((p) => {
      const customer = customersById.get(p.customerId);
      return {
        ...p,
        customerName: customer?.name ?? 'Unknown',
        customerPhone: customer?.phone ?? 'N/A',
        isReversed: Boolean(p.reversedAt),
      };
    });

    res.json({ ...pageEnvelope(enriched, page, q.limit), totals });
  })
);

// ---------------------------------------------------------------------------
// RECORD
// ---------------------------------------------------------------------------

const recordSchema = z
  .object({
    dealerId: z.string().trim().max(64).optional(),
    customerId: z.string().trim().min(1, 'Please select a customer.'),
    installmentId: z.string().trim().max(80).optional(),
    planId: z.string().trim().max(64).optional(),
    amount: positiveMoneySchema,
    paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'RAAST', 'ONLINE']).default('CASH'),
    referenceNumber: z.string().trim().max(60).optional(),
    notes: z.string().trim().max(500).optional(),
    autoVerify: z.boolean().default(true),
  })
  .refine(
    // A digital transfer without a transaction reference is unreconcilable later.
    (v) => v.paymentMethod === 'CASH' || Boolean(v.referenceNumber?.trim()),
    { message: 'A transaction reference number is required for non-cash payments.', path: ['referenceNumber'] }
  );

paymentsRouter.post(
  '/',
  requireDealerStaff,
  validateBody(recordSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof recordSchema>;
    const dealerId = await resolveWritableDealerId(req, body.dealerId);

    const customer = await repo.customers.findById(body.customerId);
    if (!customer) throw AppError.notFound('Customer');
    assertDealerAccess(req, customer.dealerId, 'customer');
    if (!customer.active) throw AppError.badRequest('This customer account is deactivated.');

    const result = await PaymentService.recordPayment({
      dealerId,
      customerId: body.customerId,
      installmentId: body.installmentId,
      planId: body.planId,
      amount: body.amount,
      paymentMethod: body.paymentMethod,
      referenceNumber: body.referenceNumber,
      notes: body.notes,
      autoVerify: body.autoVerify,
      actor: actorFrom(req),
    });

    res.status(201).json(result);
  })
);

// ---------------------------------------------------------------------------
// CUSTOMER SUBMISSION
//
// The shop is shut at ten at night and the customer has just transferred the
// money. Until now that payment could not enter the system until somebody
// opened the counter in the morning — and the handset stayed locked in the
// meantime. This lets the customer report it; a person still has to verify it
// before a rupee moves.
// ---------------------------------------------------------------------------

/**
 * The largest proof image accepted, in characters of data URL.
 *
 * `config.bodyLimit` is 256kb and applies to the whole request, so this has to
 * leave room for the rest of the body. Base64 also inflates the bytes by about
 * a third — 180,000 characters is roughly a 130 KB JPEG, which a downscaled
 * screenshot comfortably fits inside.
 */
const PROOF_IMAGE_MAX_CHARS = 180_000;

const submitSchema = z
  .object({
    planId: z.string().trim().max(64).optional(),
    installmentId: z.string().trim().max(80).optional(),
    amount: positiveMoneySchema,
    // No CASH here. Cash is handed over at a counter; there is nothing for a
    // customer to report from home, and nothing anyone could verify.
    paymentMethod: z.enum(['BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'RAAST', 'ONLINE']),
    referenceNumber: z.string().trim().min(4, 'Enter the transaction ID from your transfer.').max(60),
    notes: z.string().trim().max(500).optional(),
    /**
     * A screenshot of the transfer.
     *
     * The cap sits below `config.bodyLimit` on purpose. The browser downscales
     * and re-compresses until the image fits, so a normal screenshot always
     * gets through; anything that does not is either not from this app or is a
     * photograph somebody tried to upload whole.
     */
    proofImage: z
      .string()
      .trim()
      .startsWith('data:image/', 'The proof must be an image.')
      .max(PROOF_IMAGE_MAX_CHARS, 'That image is too large. Please send a smaller screenshot.')
      .optional(),
    /** Staff may submit on a customer's behalf; a customer login may not name anyone. */
    customerId: z.string().trim().max(64).optional(),
  })
  .refine((v) => Boolean(v.planId || v.installmentId), {
    message: 'Choose which financing plan this payment is for.',
    path: ['planId'],
  });

/** More unverified claims than this from one customer is not a queue, it is noise. */
const MAX_OPEN_SUBMISSIONS = 5;

paymentsRouter.post(
  '/submit',
  validateBody(submitSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const body = req.body as z.infer<typeof submitSchema>;

    /**
     * The customer id comes from the verified session, never from the body.
     * Letting a customer login name the customer would be the tenant-isolation
     * hole this codebase closes everywhere else.
     */
    const customerId = user.role === 'CUSTOMER' ? user.customerId : body.customerId;
    if (!customerId) {
      throw AppError.badRequest('No customer was identified for this payment.');
    }

    const customer = await repo.customers.findById(customerId);
    if (!customer) throw AppError.notFound('Customer');
    assertDealerAccess(req, customer.dealerId, 'customer');
    if (user.role === 'CUSTOMER' && customer.id !== user.customerId) {
      throw AppError.notFound('Customer');
    }
    if (!customer.active) throw AppError.badRequest('This customer account is deactivated.');

    const plan = body.planId ? await repo.installmentPlans.findById(body.planId) : undefined;
    if (body.planId && (!plan || plan.customerId !== customer.id)) {
      throw AppError.badRequest('That financing plan does not belong to this customer.');
    }

    const open = await repo.payments.count({
      customerId: customer.id,
      status: 'PENDING',
      source: 'CUSTOMER',
    });
    if (open >= MAX_OPEN_SUBMISSIONS) {
      throw AppError.badRequest(
        `You have ${open} payments still waiting to be checked. Please contact the shop rather than sending more.`
      );
    }

    const result = await PaymentService.recordPayment({
      dealerId: customer.dealerId,
      customerId: customer.id,
      installmentId: body.installmentId,
      planId: body.planId,
      amount: body.amount,
      paymentMethod: body.paymentMethod,
      referenceNumber: body.referenceNumber,
      notes: body.notes,
      // Never. A payment nobody has checked must not settle an installment or
      // release a handset — the whole point is that a person confirms it first.
      autoVerify: false,
      source: 'CUSTOMER',
      proofImage: body.proofImage,
      actor: actorFrom(req),
    });

    res.status(201).json({
      ...result,
      message:
        'Thank you. The shop will check this against their account and your phone will unlock once it is confirmed.',
    });
  })
);

/** The queue: what customers say they have paid, oldest first. */
paymentsRouter.get(
  '/pending-submissions',
  requireDealerStaff,
  asyncHandler(async (req, res) => {
    const scope = resolveDealerScope(req);

    const pending = await repo.payments.findMany({
      where: { ...(scope === null ? {} : { dealerId: scope }), status: 'PENDING', source: 'CUSTOMER' },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    const customers = await repo.customers.findByIds([...new Set(pending.map((p) => p.customerId))]);
    const byId = indexBy<Customer>(customers, (c) => c.id);

    res.json({
      data: pending.map((payment) => ({
        ...payment,
        customerName: byId.get(payment.customerId)?.name ?? 'Unknown',
        customerPhone: byId.get(payment.customerId)?.phone ?? null,
      })),
      count: pending.length,
    });
  })
);

paymentsRouter.post(
  '/:id/verify',
  requireDealerAdmin,
  asyncHandler(async (req, res) => {
    const payment = await repo.payments.findById(routeParam(req, 'id'));
    if (!payment) throw AppError.notFound('Payment');
    assertDealerAccess(req, payment.dealerId, 'payment');

    const result = await PaymentService.verifyPayment(payment.id, actorFrom(req));
    res.json(result);
  })
);

// ---------------------------------------------------------------------------
// REVERSAL — previously impossible; a mistyped amount was permanent
// ---------------------------------------------------------------------------

const reverseSchema = z.object({
  reason: z.string().trim().min(10, 'Please explain why this payment is being reversed (at least 10 characters).').max(500),
});

paymentsRouter.post(
  '/:id/reverse',
  requireDealerAdmin,
  validateBody(reverseSchema),
  asyncHandler(async (req, res) => {
    const payment = await repo.payments.findById(routeParam(req, 'id'));
    if (!payment) throw AppError.notFound('Payment');
    assertDealerAccess(req, payment.dealerId, 'payment');

    const result = await PaymentService.reversePayment({
      paymentId: payment.id,
      reason: (req.body as z.infer<typeof reverseSchema>).reason,
      actor: actorFrom(req),
    });

    res.json(result);
  })
);

// ---------------------------------------------------------------------------
// RECEIPT — the customer needs something to take away
// ---------------------------------------------------------------------------

paymentsRouter.get(
  '/:id/receipt',
  asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const payment = await repo.payments.findById(routeParam(req, 'id'));
  if (!payment) throw AppError.notFound('Payment');

  assertDealerAccess(req, payment.dealerId, 'payment');
  if (user.role === 'CUSTOMER' && payment.customerId !== user.customerId) {
    throw AppError.notFound('Payment');
  }

  const [customer, dealer, plan] = await Promise.all([
    repo.customers.findById(payment.customerId),
    repo.dealers.findById(payment.dealerId),
    payment.planId ? repo.installmentPlans.findById(payment.planId) : Promise.resolve(undefined),
  ]);
  const device = plan ? await repo.devices.findById(plan.deviceId) : undefined;

  res.json({
    receiptNumber: payment.receiptNumber || payment.id,
    issuedAt: payment.verifiedAt || payment.createdAt,
    status: payment.reversedAt ? 'REVERSED' : payment.status,
    dealer: dealer
      ? { name: dealer.name, code: dealer.code, phone: dealer.phone, address: dealer.address, city: dealer.city }
      : null,
    customer: customer ? { name: customer.name, phone: customer.phone } : null,
    device: device ? { brand: device.brand, model: device.model } : null,
    payment: {
      amount: payment.amount,
      method: payment.paymentMethod,
      reference: payment.referenceNumber,
      lateFeePortion: payment.lateFeePortion ?? 0,
      principalPortion: payment.amount - (payment.lateFeePortion ?? 0),
      notes: payment.notes,
    },
    plan: plan
      ? {
          totalAmount: plan.totalAmount,
          downPayment: plan.downPayment,
          monthlyInstallment: plan.monthlyInstallment,
          paidInstallments: plan.paidInstallments,
          totalInstallments: plan.totalInstallments,
          remainingBalance: plan.remainingBalance,
          creditBalance: plan.creditBalance ?? 0,
          outstandingLateFees: plan.outstandingLateFees ?? 0,
        }
      : null,
    reversal: payment.reversedAt
      ? { reversedAt: payment.reversedAt, reason: payment.reversalReason }
      : null,
  });
  })
);
