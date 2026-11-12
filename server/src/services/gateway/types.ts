import { PaymentMethod } from '../../types/index.js';

/**
 * The seam a payment gateway plugs into.
 *
 * A provider knows three things and nothing else: where its merchant
 * credentials live, how to build a signed hosted-checkout request, and how to
 * tell a genuine callback from a forged one. It never touches the database and
 * never decides whether money is applied — `GatewayService` does that, the same
 * way for every provider, so a second gateway (Easypaisa) cannot grow its own
 * slightly different rules about amounts, references or replays.
 */

/** Credentials for one merchant account. Only `merchantId` may ever be stored or logged. */
export interface MerchantAccount {
  /** The public merchant identifier. */
  merchantId: string;
}

/** What the customer's browser must do to reach the gateway's hosted page. */
export interface CheckoutRedirect {
  url: string;
  method: 'POST';
  /** Form fields, posted as-is. */
  fields: Record<string, string>;
}

export interface CheckoutRequest {
  /** Our reference: letters and digits only, at most 20 characters. */
  reference: string;
  /** Whole rupees. */
  amount: number;
  description: string;
  /** Where the gateway sends the customer's browser afterwards. */
  returnUrl: string;
  now: Date;
  expiresAt: Date;
}

/** The fields of a callback, exactly as received. Nothing in it is trusted yet. */
export type CallbackPayload = Record<string, string>;

export type CallbackVerdict =
  | {
      /** The signature did not verify, or the message was not well-formed. */
      authentic: false;
      reason: 'BAD_SIGNATURE' | 'MALFORMED';
    }
  | {
      authentic: true;
      reference: string;
      /** The merchant the gateway says it acted for. */
      merchantId: string;
      /** Whole rupees the gateway says it handled; `undefined` if it sent none or a fraction. */
      amount: number | undefined;
      /** True only for the gateway's unambiguous "money received" code. */
      paid: boolean;
      providerTxnId?: string;
      responseCode: string;
      responseMessage?: string;
    };

export interface GatewayProvider<M extends MerchantAccount = MerchantAccount> {
  /** Stable identifier, used in URLs and stored on the checkout. */
  readonly id: string;
  /** Shown on the customer's button. */
  readonly label: string;
  /** How a payment through this gateway is filed in the ledger. */
  readonly paymentMethod: PaymentMethod;

  /**
   * The merchant account a dealership collects through, or `undefined` when
   * none is configured — which is what "off" means.
   */
  resolveMerchant(dealerId: string): M | undefined;

  buildCheckout(merchant: M, request: CheckoutRequest): CheckoutRedirect;

  /**
   * Reads our reference out of an unverified callback, so the right
   * dealership's credentials can be found to verify it with. Nothing else may
   * be concluded from the payload at this point.
   */
  extractReference(payload: CallbackPayload): string | undefined;

  verifyCallback(merchant: M, payload: CallbackPayload): CallbackVerdict;
}
