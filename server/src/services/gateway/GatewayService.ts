import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { repo } from '../../db/repositories/index.js';
import { GatewayCheckout } from '../../types/index.js';
import { AppError } from '../../utils/AppError.js';
import { AuditService } from '../AuditService.js';
import { PaymentService, PaymentOutcome } from '../PaymentService.js';
import { gatewayUrls } from './config.js';
import { jazzCashProvider, jazzCashTimestamp } from './JazzCashProvider.js';
import { CallbackPayload, CheckoutRedirect, GatewayProvider } from './types.js';

/**
 * Everything a gateway payment has in common, whichever gateway it came from.
 *
 * The rule this file exists to enforce: a callback applies money only when it
 * is authentic, names a checkout this server created, for the merchant and the
 * amount that checkout was created with, and has not been applied before.
 * Anything short of that changes no balance, issues no receipt and unlocks no
 * phone. Where a callback is authentic and says "paid" but something still does
 * not add up, the checkout is parked as REVIEW for a person — never guessed at.
 */

const providers = new Map<string, GatewayProvider<any>>();

export function registerGatewayProvider(provider: GatewayProvider<any>): void {
  providers.set(provider.id, provider);
}

/** For tests that install a stand-in provider. */
export function unregisterGatewayProvider(id: string): void {
  providers.delete(id);
}

registerGatewayProvider(jazzCashProvider);

/** How long a checkout stays payable on the gateway's page. */
const CHECKOUT_LIFETIME_MS = 60 * 60_000;

/** More attempts than this in an hour is not somebody paying, it is somebody pressing. */
const MAX_CHECKOUTS_PER_HOUR = 10;

/** Our reference as every known gateway accepts it: letters and digits, 20 at most. */
const REFERENCE_PATTERN = /^[A-Za-z0-9]{1,20}$/;

export type CallbackOutcome =
  /** Money applied by this very callback. */
  | { result: 'PAID'; checkout: GatewayCheckout; payment: PaymentOutcome }
  /** A repeat of a callback that was already applied. Nothing was changed. */
  | { result: 'ALREADY_PAID'; checkout: GatewayCheckout }
  /** Authentic, and the gateway says the customer did not pay. */
  | { result: 'NOT_PAID'; checkout: GatewayCheckout }
  /** Authentic "paid", but it could not be applied safely. A person must look. */
  | { result: 'REVIEW'; checkout: GatewayCheckout; reason: string }
  /** Not believed. Nothing was changed at all. */
  | { result: 'REJECTED'; reason: 'UNKNOWN_PROVIDER' | 'UNKNOWN_REFERENCE' | 'NOT_CONFIGURED' | 'BAD_SIGNATURE' | 'MALFORMED' | 'MERCHANT_MISMATCH' };

function newReference(now: Date): string {
  // T + 14-digit Pakistan timestamp + 5 random digits = 20 characters.
  return `T${jazzCashTimestamp(now)}${String(crypto.randomInt(0, 100_000)).padStart(5, '0')}`;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

export class GatewayService {
  /** The gateways a dealership's customers can pay through right now. Empty means off. */
  public static availableFor(dealerId: string): { id: string; label: string }[] {
    if (!gatewayUrls()) return [];
    return [...providers.values()]
      .filter((provider) => provider.resolveMerchant(dealerId) !== undefined)
      .map((provider) => ({ id: provider.id, label: provider.label }));
  }

  // -------------------------------------------------------------------------
  // Starting a checkout
  // -------------------------------------------------------------------------

  public static async createCheckout(params: {
    customerId: string;
    planId: string;
    amount: number;
    providerId?: string;
  }): Promise<{ checkout: GatewayCheckout; redirect: CheckoutRedirect }> {
    const customer = await repo.customers.findById(params.customerId);
    if (!customer) throw AppError.notFound('Customer');
    if (!customer.active) throw AppError.badRequest('This customer account is deactivated.');

    const urls = gatewayUrls();
    const available = this.availableFor(customer.dealerId);
    const chosen = params.providerId ? available.find((p) => p.id === params.providerId) : available[0];
    const provider = chosen ? providers.get(chosen.id) : undefined;
    const merchant = provider?.resolveMerchant(customer.dealerId);
    if (!urls || !provider || !merchant) {
      throw AppError.badRequest('Online payment is not available for this shop. Please pay the shop and report the transfer instead.');
    }

    const plan = await repo.installmentPlans.findById(params.planId);
    if (!plan || plan.customerId !== customer.id) {
      throw AppError.badRequest('That financing plan does not belong to this customer.');
    }
    if (plan.status === 'COMPLETED' || plan.status === 'CANCELLED') {
      throw AppError.badRequest('This financing plan is closed and cannot accept payments.');
    }

    if (!Number.isInteger(params.amount) || params.amount <= 0) {
      throw AppError.badRequest('Enter the amount in whole rupees.');
    }
    // Paying more than is owed online would leave money to hand back by hand.
    const owed = plan.remainingBalance + (plan.outstandingLateFees ?? 0) - (plan.creditBalance ?? 0);
    if (params.amount > owed) {
      throw AppError.badRequest(`You can pay at most Rs. ${Math.max(0, owed).toLocaleString()} on this plan.`);
    }

    const now = new Date();
    const recent = await repo.gatewayCheckouts.count({
      customerId: customer.id,
      createdAt: { gte: new Date(now.getTime() - 3_600_000) },
    });
    if (recent >= MAX_CHECKOUTS_PER_HOUR) {
      throw new AppError('Too many payment attempts. Please wait a while, or contact the shop.', 429, {
        code: 'GATEWAY_RATE_LIMITED',
      });
    }

    const expiresAt = new Date(now.getTime() + CHECKOUT_LIFETIME_MS);

    for (let attempt = 0; ; attempt++) {
      const reference = newReference(now);
      try {
        const checkout = await repo.gatewayCheckouts.create({
          id: `gw-${uuidv4().substring(0, 12)}`,
          dealerId: customer.dealerId,
          customerId: customer.id,
          planId: plan.id,
          provider: provider.id,
          reference,
          merchantId: merchant.merchantId,
          amount: params.amount,
          status: 'CREATED',
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
        });

        const redirect = provider.buildCheckout(merchant, {
          reference,
          amount: params.amount,
          description: 'Installment payment',
          returnUrl: `${urls.apiUrl}/gateway/${provider.id.toLowerCase()}/return`,
          now,
          expiresAt,
        });
        return { checkout, redirect };
      } catch (err) {
        // Two checkouts in the same second drew the same five digits.
        if (isUniqueViolation(err) && attempt < 3) continue;
        throw err;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Hearing back
  // -------------------------------------------------------------------------

  public static async handleCallback(providerId: string, payload: CallbackPayload, ipAddress?: string): Promise<CallbackOutcome> {
    const provider = providers.get(providerId.toUpperCase());
    if (!provider) return { result: 'REJECTED', reason: 'UNKNOWN_PROVIDER' };

    // The reference is read before anything is verified, only to find out whose
    // credentials to verify with. It decides nothing by itself.
    const reference = provider.extractReference(payload);
    if (!reference || !REFERENCE_PATTERN.test(reference)) return { result: 'REJECTED', reason: 'MALFORMED' };

    const checkout = await repo.gatewayCheckouts.findByReference(reference);
    if (!checkout || checkout.provider !== provider.id) return { result: 'REJECTED', reason: 'UNKNOWN_REFERENCE' };

    const merchant = provider.resolveMerchant(checkout.dealerId);
    if (!merchant) return { result: 'REJECTED', reason: 'NOT_CONFIGURED' };

    const verdict = provider.verifyCallback(merchant, payload);
    if (!verdict.authentic) return { result: 'REJECTED', reason: verdict.reason };

    // Signed by the right key, but for some other checkout or merchant account.
    if (
      verdict.reference !== checkout.reference ||
      verdict.merchantId !== checkout.merchantId ||
      merchant.merchantId !== checkout.merchantId
    ) {
      return { result: 'REJECTED', reason: 'MERCHANT_MISMATCH' };
    }

    if (checkout.status === 'PAID') return { result: 'ALREADY_PAID', checkout };

    const response = {
      providerTxnId: verdict.providerTxnId?.slice(0, 80),
      responseCode: verdict.responseCode.slice(0, 20),
      responseMessage: verdict.responseMessage?.slice(0, 300),
    };

    if (!verdict.paid) {
      // Recorded on the attempt only. No payment row, no balance, no receipt.
      await repo.gatewayCheckouts.updateMany({ id: checkout.id, status: { in: ['CREATED', 'FAILED'] } }, { status: 'FAILED', ...response });
      return { result: 'NOT_PAID', checkout: (await repo.gatewayCheckouts.findById(checkout.id)) ?? checkout };
    }

    if (verdict.amount !== checkout.amount) {
      return this.park(
        checkout,
        response,
        `The gateway confirmed a payment whose amount does not match the Rs. ${checkout.amount.toLocaleString()} this checkout was created for. Nothing was applied.`,
        ipAddress
      );
    }

    const actor = {
      userId: `gateway:${provider.id}`,
      userName: `${provider.label} gateway`,
      userRole: 'CUSTOMER' as const,
      ipAddress,
    };

    try {
      const payment = await PaymentService.recordPayment({
        dealerId: checkout.dealerId,
        customerId: checkout.customerId,
        planId: checkout.planId,
        amount: checkout.amount,
        paymentMethod: provider.paymentMethod,
        referenceNumber: checkout.reference,
        notes: `Paid online through ${provider.label}.` + (response.providerTxnId ? ` Gateway transaction ${response.providerTxnId}.` : ''),
        // The processor is the verification.
        autoVerify: true,
        source: 'GATEWAY',
        actor,
        /**
         * The claim. It commits with the payment or not at all, and matches at
         * most one caller: a second callback arriving at the same moment finds
         * the status already PAID (or loses on the payment's unique reference)
         * and rolls back without having applied anything.
         */
        withinTransaction: async (tx, created) => {
          const claimed = await repo.gatewayCheckouts.updateMany(
            { id: checkout.id, status: { in: ['CREATED', 'FAILED', 'REVIEW'] } },
            { status: 'PAID', paymentId: created.id, completedAt: new Date().toISOString(), ...response },
            tx
          );
          if (claimed !== 1) throw new Error('GATEWAY_CHECKOUT_ALREADY_CLAIMED');
        },
      });

      return {
        result: 'PAID',
        checkout: (await repo.gatewayCheckouts.findById(checkout.id)) ?? checkout,
        payment,
      };
    } catch (err) {
      const current = await repo.gatewayCheckouts.findById(checkout.id);
      if (current?.status === 'PAID') return { result: 'ALREADY_PAID', checkout: current };

      const why = err instanceof AppError ? err.message : 'An unexpected error occurred while applying it.';
      console.error(`[gateway] Verified ${provider.id} payment ${checkout.reference} could not be applied: ${err instanceof Error ? err.message : 'unknown error'}`);
      return this.park(checkout, response, `The gateway confirmed Rs. ${checkout.amount.toLocaleString()} but it could not be applied: ${why}`, ipAddress);
    }
  }

  /** Sets an authentic-but-unusable "paid" callback aside for a person to resolve. */
  private static async park(
    checkout: GatewayCheckout,
    response: { providerTxnId?: string; responseCode: string; responseMessage?: string },
    reason: string,
    ipAddress?: string
  ): Promise<CallbackOutcome> {
    const parked = await repo.gatewayCheckouts.updateMany(
      { id: checkout.id, status: { in: ['CREATED', 'FAILED'] } },
      { status: 'REVIEW', ...response }
    );
    // Audited once, when it is first parked — a replay must not flood the trail.
    if (parked === 1) {
      await AuditService.log({
        dealerId: checkout.dealerId,
        userId: `gateway:${checkout.provider}`,
        actorName: `${checkout.provider} gateway`,
        actorRole: 'CUSTOMER',
        action: 'GATEWAY_PAYMENT_NEEDS_REVIEW',
        targetType: 'PAYMENT',
        targetId: checkout.id,
        details: (`Checkout ${checkout.reference}` + (response.providerTxnId ? ` (gateway transaction ${response.providerTxnId})` : '') + `: ${reason}`).slice(0, 900),
        ipAddress,
      });
    }
    return { result: 'REVIEW', checkout: (await repo.gatewayCheckouts.findById(checkout.id)) ?? checkout, reason };
  }
}
