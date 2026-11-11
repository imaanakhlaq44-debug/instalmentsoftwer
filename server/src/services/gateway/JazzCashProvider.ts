import crypto from 'crypto';

import { jazzCashMerchantFor, JazzCashMerchant } from './config.js';
import { CallbackPayload, CallbackVerdict, CheckoutRedirect, CheckoutRequest, GatewayProvider } from './types.js';

/**
 * JazzCash hosted checkout ("Page Redirection", API version 1.1).
 *
 * The customer's browser posts a signed form to JazzCash, pays on JazzCash's
 * own page, and is posted back to `pp_ReturnURL` with a signed result.
 *
 * The signature (`pp_SecureHash`) is HMAC-SHA256, keyed with the merchant's
 * Integrity Salt, over: the salt, then every non-empty `pp_*` / `ppmpf_*` value
 * ordered by field name, joined with `&`. JazzCash's own documentation site
 * could not be reached when this was written; the recipe was cross-checked
 * against two independent public implementations and MUST be confirmed against
 * the sandbox before going live — see the gateway notes in `.env.example`.
 *
 * `pp_Password` is, by JazzCash's design, a form field the browser posts. The
 * Integrity Salt is the secret that must never leave the server; it is used
 * here only as the HMAC key and appears in no return value.
 */

const HOSTS = {
  sandbox: 'https://sandbox.jazzcash.com.pk',
  production: 'https://payments.jazzcash.com.pk',
} as const;

const CHECKOUT_PATH = '/CustomerPortal/transactionmanagement/merchantform/';

/** The one code that means the money has been received. Everything else is "not paid". */
const PAID_CODE = '000';

const isSignedField = (name: string) =>
  (name.startsWith('pp_') || name.startsWith('ppmpf_')) && name !== 'pp_SecureHash';

/** Field names in plain code-point order — `pp_Version` sorts before `ppmpf_1`. */
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function jazzCashSecureHash(fields: Record<string, string>, integritySalt: string): string {
  const values = Object.keys(fields)
    .filter(isSignedField)
    .filter((name) => fields[name] !== '')
    .sort(byName)
    .map((name) => fields[name]);

  return crypto
    .createHmac('sha256', integritySalt)
    .update([integritySalt, ...values].join('&'), 'utf8')
    .digest('hex')
    .toUpperCase();
}

/** JazzCash timestamps are Pakistan time (UTC+5, no daylight saving): `yyyyMMddHHmmss`. */
export function jazzCashTimestamp(date: Date): string {
  return new Date(date.getTime() + 5 * 3_600_000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function signatureMatches(expected: string, received: string): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(received)) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
}

/** `pp_Amount` is in paisa with no decimal point. Only whole rupees are ever charged here. */
function rupeesFromPaisa(raw: string | undefined): number | undefined {
  if (!raw || !/^\d{1,13}$/.test(raw)) return undefined;
  const paisa = Number(raw);
  return paisa % 100 === 0 ? paisa / 100 : undefined;
}

export const jazzCashProvider: GatewayProvider<JazzCashMerchant> = {
  id: 'JAZZCASH',
  label: 'JazzCash',
  paymentMethod: 'JAZZCASH',

  resolveMerchant: (dealerId) => jazzCashMerchantFor(dealerId),

  buildCheckout(merchant, request: CheckoutRequest): CheckoutRedirect {
    const fields: Record<string, string> = {
      pp_Version: '1.1',
      // Empty lets the customer choose wallet, card or voucher on JazzCash's page.
      pp_TxnType: '',
      pp_Language: 'EN',
      pp_MerchantID: merchant.merchantId,
      pp_SubMerchantID: '',
      pp_Password: merchant.password,
      pp_BankID: '',
      pp_ProductID: '',
      pp_TxnRefNo: request.reference,
      pp_Amount: String(request.amount * 100),
      pp_TxnCurrency: 'PKR',
      pp_TxnDateTime: jazzCashTimestamp(request.now),
      pp_BillReference: request.reference,
      pp_Description: request.description,
      pp_TxnExpiryDateTime: jazzCashTimestamp(request.expiresAt),
      pp_ReturnURL: request.returnUrl,
      ppmpf_1: '',
      ppmpf_2: '',
      ppmpf_3: '',
      ppmpf_4: '',
      ppmpf_5: '',
    };
    fields.pp_SecureHash = jazzCashSecureHash(fields, merchant.integritySalt);

    return { url: HOSTS[merchant.environment] + CHECKOUT_PATH, method: 'POST', fields };
  },

  extractReference: (payload: CallbackPayload) => payload.pp_TxnRefNo || undefined,

  verifyCallback(merchant, payload): CallbackVerdict {
    const received = payload.pp_SecureHash;
    if (!received) return { authentic: false, reason: 'MALFORMED' };

    if (!signatureMatches(jazzCashSecureHash(payload, merchant.integritySalt), received)) {
      return { authentic: false, reason: 'BAD_SIGNATURE' };
    }

    // Everything below is covered by the signature just verified.
    const reference = payload.pp_TxnRefNo;
    const responseCode = payload.pp_ResponseCode;
    if (!reference || !responseCode) return { authentic: false, reason: 'MALFORMED' };

    const currency = payload.pp_TxnCurrency;
    const amount = currency && currency !== 'PKR' ? undefined : rupeesFromPaisa(payload.pp_Amount);

    return {
      authentic: true,
      reference,
      merchantId: payload.pp_MerchantID || '',
      amount,
      paid: responseCode === PAID_CODE,
      // JazzCash's own spelling.
      providerTxnId: payload.pp_RetreivalReferenceNo || undefined,
      responseCode,
      responseMessage: payload.pp_ResponseMessage || undefined,
    };
  },
};
