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
