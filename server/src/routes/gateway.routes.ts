import express, { Router, Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { repo } from '../db/repositories/index.js';
import { GatewayService, CallbackOutcome } from '../services/gateway/GatewayService.js';
import { gatewayUrls } from '../services/gateway/config.js';
import { CallbackPayload } from '../services/gateway/types.js';
import { requireRole, getAuthUser, assertDealerAccess, clientIp, routeParam } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { positiveMoneySchema } from '../utils/validators.js';

// ---------------------------------------------------------------------------
// CALLBACKS — public, because the caller is the gateway, not a logged-in user
//
// Mounted ahead of the CORS allow-list on purpose: the "return" is a form the
// gateway's page posts from the customer's browser, so it arrives with the
// gateway's Origin, which the dashboard allow-list would refuse. Being public
// is safe only because nothing here is believed without a valid signature —
// see `GatewayService.handleCallback`.
// ---------------------------------------------------------------------------

export const gatewayCallbackRouter = Router();

gatewayCallbackRouter.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests.', code: 'GATEWAY_RATE_LIMITED' },
  })
);
gatewayCallbackRouter.use(express.urlencoded({ extended: false, limit: '32kb' }));
gatewayCallbackRouter.use(express.json({ limit: '32kb' }));

/** Keeps only plain string fields; anything nested or oversized is not a gateway callback. */
function callbackPayload(req: Request): CallbackPayload {
  const out: CallbackPayload = {};
  const body: unknown = req.body;
  if (!body || typeof body !== 'object') return out;

  for (const [key, value] of Object.entries(body as Record<string, unknown>).slice(0, 80)) {
    if (typeof value === 'string' && key.length <= 60 && value.length <= 1000) out[key] = value;
  }
  return out;
}

/** One line per callback. The reference is not a secret; nothing else from the payload is logged. */
function logOutcome(provider: string, kind: string, outcome: CallbackOutcome): void {
  const reference = 'checkout' in outcome ? outcome.checkout.reference : 'unmatched';
  const detail = outcome.result === 'REJECTED' ? ` (${outcome.reason})` : '';
  const line = `[gateway] ${provider.toUpperCase().slice(0, 20)} ${kind} ${reference} -> ${outcome.result}${detail}`;
  if (outcome.result === 'REJECTED' || outcome.result === 'REVIEW') console.warn(line);
  else console.log(line);
}

const RETURN_STATUS: Record<CallbackOutcome['result'], string> = {
  PAID: 'paid',
  ALREADY_PAID: 'paid',
  NOT_PAID: 'failed',
  REVIEW: 'review',
  REJECTED: 'rejected',
};

/** The customer's browser, sent back by the gateway's page. Always ends in a redirect to the dashboard. */
gatewayCallbackRouter.post(
  '/:provider/return',
  asyncHandler(async (req, res) => {
    const urls = gatewayUrls();
    if (!urls) throw AppError.notFound('Route');

    const provider = routeParam(req, 'provider');
    const payload = callbackPayload(req);
    const outcome = await GatewayService.handleCallback(provider, payload, clientIp(req));
    logOutcome(provider, 'return', outcome);

    const target = new URL(`${urls.dashboardUrl}/payments`);
    target.searchParams.set('gateway', RETURN_STATUS[outcome.result]);
    if ('checkout' in outcome) target.searchParams.set('ref', outcome.checkout.reference);
    res.redirect(303, target.toString());
  })
);

/** The gateway's server-to-server notification, where the merchant account has one configured. */
gatewayCallbackRouter.post(
  '/:provider/notify',
  asyncHandler(async (req, res) => {
    if (!gatewayUrls()) throw AppError.notFound('Route');

    const provider = routeParam(req, 'provider');
    const payload = callbackPayload(req);
    const outcome = await GatewayService.handleCallback(provider, payload, clientIp(req));
    logOutcome(provider, 'notify', outcome);

    res.status(outcome.result === 'REJECTED' ? 400 : 200).json({ received: outcome.result !== 'REJECTED', result: outcome.result });
  })
);

// ---------------------------------------------------------------------------
// CHECKOUT — behind `requireAuth`, for the customer's own "Pay now"
// ---------------------------------------------------------------------------

export const paymentGatewayRouter = Router();

/** Which gateways, if any, this login's shop collects through. `enabled: false` is the normal state. */
paymentGatewayRouter.get(
  '/options',
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const providers = user.dealerId ? GatewayService.availableFor(user.dealerId) : [];
    res.json({ enabled: providers.length > 0, providers });
  })
);

const checkoutSchema = z.object({
  planId: z.string().trim().min(1, 'Choose which financing plan this payment is for.').max(64),
  amount: positiveMoneySchema,
  provider: z.string().trim().max(20).optional(),
});

paymentGatewayRouter.post(
  '/checkout',
  // Only the customer pays online. Staff take money at the counter and record it there.
  requireRole('CUSTOMER'),
  validateBody(checkoutSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const body = req.body as z.infer<typeof checkoutSchema>;
    // The customer comes from the session, never the body.
    if (!user.customerId) throw AppError.badRequest('No customer was identified for this payment.');

    const { checkout, redirect } = await GatewayService.createCheckout({
      customerId: user.customerId,
      planId: body.planId,
      amount: body.amount,
      providerId: body.provider,
    });

    res.status(201).json({
      reference: checkout.reference,
      provider: checkout.provider,
      amount: checkout.amount,
      expiresAt: checkout.expiresAt,
      redirect,
    });
  })
);

/** How a checkout ended — what the customer's screen shows after coming back from the gateway. */
paymentGatewayRouter.get(
  '/checkouts/:reference',
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const checkout = await repo.gatewayCheckouts.findByReference(routeParam(req, 'reference'));
    if (!checkout) throw AppError.notFound('Checkout');
    assertDealerAccess(req, checkout.dealerId, 'payment');
    if (user.role === 'CUSTOMER' && checkout.customerId !== user.customerId) throw AppError.notFound('Checkout');

    const payment = checkout.paymentId ? await repo.payments.findById(checkout.paymentId) : undefined;

    res.json({
      reference: checkout.reference,
      provider: checkout.provider,
      amount: checkout.amount,
      status: checkout.status,
      paymentId: payment?.id,
      receiptNumber: payment?.receiptNumber,
      completedAt: checkout.completedAt,
    });
  })
);
