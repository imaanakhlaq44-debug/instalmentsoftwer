import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import {
  GatewayService, registerGatewayProvider, unregisterGatewayProvider,
} from '../../src/services/gateway/GatewayService.js';
import { jazzCashSecureHash } from '../../src/services/gateway/JazzCashProvider.js';
import { GatewayProvider, MerchantAccount } from '../../src/services/gateway/types.js';

/**
 * A stand-in gateway. It signs with a plain HMAC over three fields, which is
 * all the generic rules need: something that can be authentic or not.
 */
interface MockMerchant extends MerchantAccount { secret: string }

const MOCK_SECRET = 'mock-gateway-test-secret';
const MOCK_MERCHANT = 'MOCK-MERCHANT-1';

const mockSign = (fields: Record<string, string>, secret = MOCK_SECRET) =>
  crypto
    .createHmac('sha256', secret)
    .update([fields.ref, fields.merchant, fields.amount, fields.code].join('|'))
    .digest('hex');

const mockProvider: GatewayProvider<MockMerchant> = {
  id: 'MOCKPAY',
  label: 'MockPay',
  paymentMethod: 'ONLINE',
  resolveMerchant: (dealerId) => (dealerId === 'dealer-1' ? { merchantId: MOCK_MERCHANT, secret: MOCK_SECRET } : undefined),
  buildCheckout: (merchant, request) => ({
    url: 'https://mockpay.test/checkout',
    method: 'POST',
    fields: { ref: request.reference, merchant: merchant.merchantId, amount: String(request.amount), returnUrl: request.returnUrl },
  }),
  extractReference: (payload) => payload.ref,
  verifyCallback(merchant, payload) {
    if (!payload.sig) return { authentic: false, reason: 'MALFORMED' };
    if (payload.sig !== mockSign(payload, merchant.secret)) return { authentic: false, reason: 'BAD_SIGNATURE' };
    return {
      authentic: true,
      reference: payload.ref,
      merchantId: payload.merchant,
      amount: /^\d+$/.test(payload.amount) ? Number(payload.amount) : undefined,
      paid: payload.code === 'OK',
      providerTxnId: payload.txn,
      responseCode: payload.code,
    };
  },
};

const GATEWAY_ENV = [
  'PAYMENT_GATEWAY_API_URL', 'PAYMENT_GATEWAY_DASHBOARD_URL', 'JAZZCASH_ENV', 'JAZZCASH_MERCHANT_ID',
  'JAZZCASH_PASSWORD', 'JAZZCASH_INTEGRITY_SALT', 'JAZZCASH_DEALER_IDS',
  'JAZZCASH_DEALER_DEALER_1_MERCHANT_ID', 'JAZZCASH_DEALER_DEALER_1_PASSWORD', 'JAZZCASH_DEALER_DEALER_1_INTEGRITY_SALT',
];

function clearGatewayEnv() {
  for (const name of GATEWAY_ENV) delete process.env[name];
}

function enableUrls() {
  process.env.PAYMENT_GATEWAY_API_URL = 'http://localhost:5000/api';
  process.env.PAYMENT_GATEWAY_DASHBOARD_URL = 'http://localhost:5173';
}

beforeEach(async () => {
  await reseed();
  clearGatewayEnv();
  enableUrls();
  registerGatewayProvider(mockProvider);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}, 60_000);

afterEach(() => {
  unregisterGatewayProvider('MOCKPAY');
  clearGatewayEnv();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await disconnectDatabase();
});

const PLAN = 'plan-1';
const AMOUNT = 5_000;

/** Everything that would show if money had been applied. */
async function moneyState(planId = PLAN) {
  const plan = (await repo.installmentPlans.findById(planId))!;
  return {
    remainingBalance: plan.remainingBalance,
    paidInstallments: plan.paidInstallments,
    creditBalance: plan.creditBalance ?? 0,
    payments: await repo.payments.count({ planId }),
    transactions: await repo.transactions.count({ planId }),
    paidInPrincipal: (await repo.installments.findByPlan(planId)).reduce((sum, i) => sum + i.amountPaid, 0),
  };
}

async function startCheckout(amount = AMOUNT, provider = 'MOCKPAY') {
  const res = await as(ACCOUNTS.customer).post('/api/payment-gateway/checkout').send({ planId: PLAN, amount, provider });
  expect(res.status).toBe(201);
  return res.body as { reference: string; amount: number; redirect: { url: string; fields: Record<string, string> } };
}

function mockCallback(reference: string, overrides: Record<string, string> = {}, secret = MOCK_SECRET) {
  const fields: Record<string, string> = {
    ref: reference, merchant: MOCK_MERCHANT, amount: String(AMOUNT), code: 'OK', txn: 'MOCK-TXN-778', ...overrides,
  };
  return { ...fields, sig: mockSign(fields, secret) };
}

const postReturn = (body: Record<string, string>, provider = 'mockpay') =>
  anonymous().post(`/api/gateway/${provider}/return`).type('form').send(body);

describe('the gateway is off unless it is configured', () => {
  it('reports disabled and refuses a checkout when no merchant is configured', async () => {
    unregisterGatewayProvider('MOCKPAY');

    const options = await as(ACCOUNTS.customer).get('/api/payment-gateway/options');
    expect(options.body).toEqual({ enabled: false, providers: [] });

    const res = await as(ACCOUNTS.customer).post('/api/payment-gateway/checkout').send({ planId: PLAN, amount: AMOUNT });
    expect(res.status).toBe(400);
    expect(await repo.gatewayCheckouts.count()).toBe(0);
  });

  it('stays off without the public URLs, even with a merchant', async () => {
    clearGatewayEnv();
    const options = await as(ACCOUNTS.customer).get('/api/payment-gateway/options');
    expect(options.body.enabled).toBe(false);

    const res = await postReturn(mockCallback('T2026111112000012345'));
    expect(res.status).toBe(404);
  });

  it('is off for a dealership with no merchant account of its own', async () => {
    const options = await as(ACCOUNTS.otherDealerAdmin).get('/api/payment-gateway/options');
    expect(options.body.enabled).toBe(false);
  });

  it('leaves the customer-reported flow working as the fallback', async () => {
    unregisterGatewayProvider('MOCKPAY');
    const res = await as(ACCOUNTS.customer)
      .post('/api/payments/submit')
      .send({ planId: PLAN, amount: AMOUNT, paymentMethod: 'JAZZCASH', referenceNumber: 'TID123456789' });
    expect(res.status).toBe(201);
    expect(res.body.payment.status).toBe('PENDING');
  });
});

describe('starting a checkout', () => {
  it('offers the gateway to the customer and creates a signed redirect', async () => {
    const options = await as(ACCOUNTS.customer).get('/api/payment-gateway/options');
    expect(options.body).toEqual({ enabled: true, providers: [{ id: 'MOCKPAY', label: 'MockPay' }] });

    const before = await moneyState();
    const checkout = await startCheckout();

    expect(checkout.reference).toMatch(/^T\d{19}$/);
    expect(checkout.redirect.fields.returnUrl).toBe('http://localhost:5000/api/gateway/mockpay/return');

    const stored = (await repo.gatewayCheckouts.findByReference(checkout.reference))!;
    expect(stored).toMatchObject({ status: 'CREATED', amount: AMOUNT, customerId: 'cust-1', dealerId: 'dealer-1', merchantId: MOCK_MERCHANT });
    // Starting a checkout is not a payment.
    expect(await moneyState()).toEqual(before);
  });

  it('is for the customer only, and only for their own plan', async () => {
    const staff = await as(ACCOUNTS.dealerAdmin).post('/api/payment-gateway/checkout').send({ planId: PLAN, amount: AMOUNT });
    expect(staff.status).toBe(403);

    const foreign = await as(ACCOUNTS.customer).post('/api/payment-gateway/checkout').send({ planId: 'plan-2', amount: AMOUNT });
    expect(foreign.status).toBe(400);
    expect(await repo.gatewayCheckouts.count()).toBe(0);
  });

  it('refuses more than is owed, and a fractional amount', async () => {
    const plan = (await repo.installmentPlans.findById(PLAN))!;
    const tooMuch = await as(ACCOUNTS.customer)
      .post('/api/payment-gateway/checkout')
      .send({ planId: PLAN, amount: plan.remainingBalance + (plan.outstandingLateFees ?? 0) + 1 });
    expect(tooMuch.status).toBe(400);

    const fraction = await as(ACCOUNTS.customer).post('/api/payment-gateway/checkout').send({ planId: PLAN, amount: 100.5 });
    expect(fraction.status).toBe(400);
  });
});

describe('a valid callback', () => {
  it('applies the money like a confirmed counter payment and issues the receipt', async () => {
    const before = await moneyState();
    const checkout = await startCheckout();

    const res = await postReturn(mockCallback(checkout.reference));

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`http://localhost:5173/payments?gateway=paid&ref=${checkout.reference}`);

    const stored = (await repo.gatewayCheckouts.findByReference(checkout.reference))!;
    expect(stored.status).toBe('PAID');
    expect(stored.providerTxnId).toBe('MOCK-TXN-778');

    const payment = (await repo.payments.findById(stored.paymentId!))!;
    expect(payment).toMatchObject({
      status: 'VERIFIED', source: 'GATEWAY', amount: AMOUNT, paymentMethod: 'ONLINE',
      referenceNumber: checkout.reference, customerId: 'cust-1', planId: PLAN,
    });
    expect(payment.receiptNumber).toMatch(/^RCP-\d{4}-\d{6}$/);

    const after = await moneyState();
    expect(after.paidInPrincipal).toBe(before.paidInPrincipal + AMOUNT);
    expect(after.remainingBalance).toBe(before.remainingBalance - AMOUNT);
    expect(after.payments).toBe(before.payments + 1);

    // The customer can open the receipt and see how the checkout ended.
    const receipt = await as(ACCOUNTS.customer).get(`/api/payments/${payment.id}/receipt`);
    expect(receipt.status).toBe(200);
    expect(receipt.body.payment.amount).toBe(AMOUNT);

    const status = await as(ACCOUNTS.customer).get(`/api/payment-gateway/checkouts/${checkout.reference}`);
    expect(status.body).toMatchObject({ status: 'PAID', receiptNumber: payment.receiptNumber });
  });

  it('is accepted on the server-to-server route too', async () => {
    const checkout = await startCheckout();
    const res = await anonymous().post('/api/gateway/mockpay/notify').send(mockCallback(checkout.reference));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, result: 'PAID' });
  });

  it('clears the overdue flag through the existing unlock path', async () => {
    // plan-2 / dev-2: installment #2 overdue, device flagged OVERDUE.
    const device = (await repo.devices.findById('dev-2'))!;
    expect(device.status).toBe('OVERDUE');
    const plan = (await repo.installmentPlans.findById('plan-2'))!;
    const overdue = (await repo.installments.findByPlan('plan-2')).filter((i) => i.status === 'OVERDUE');
    const due = overdue.reduce((sum, i) => sum + (i.amountDue - i.amountPaid) + ((i.lateFee ?? 0) - (i.lateFeePaid ?? 0)), 0);

    const { checkout } = await GatewayService.createCheckout({
      customerId: plan.customerId, planId: plan.id, amount: due, providerId: 'MOCKPAY',
    });
    const res = await postReturn(mockCallback(checkout.reference, { amount: String(due) }));

    expect(res.headers.location).toContain('gateway=paid');
    expect((await repo.devices.findById('dev-2'))!.status).toBe('ACTIVE');
    expect((await repo.installmentPlans.findById('plan-2'))!.status).toBe('CURRENT');
  });
});

describe('a callback that must change nothing', () => {
  it('bad signature', async () => {
    const checkout = await startCheckout();
    const before = await moneyState();

    const res = await postReturn(mockCallback(checkout.reference, {}, 'not-the-secret'));

    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('gateway=rejected');
    expect(await moneyState()).toEqual(before);
    expect((await repo.gatewayCheckouts.findByReference(checkout.reference))!.status).toBe('CREATED');
  });

  it('a signature made for different contents', async () => {
    const checkout = await startCheckout();
    const before = await moneyState();
    const failed = mockCallback(checkout.reference, { code: 'DECLINED' });

    // The gateway said "declined"; somebody edits the form to say "OK".
    const res = await postReturn({ ...failed, code: 'OK' });

    expect(res.headers.location).toContain('gateway=rejected');
    expect(await moneyState()).toEqual(before);
  });

  it('no signature at all', async () => {
    const checkout = await startCheckout();
    const before = await moneyState();
    const { sig: _sig, ...unsigned } = mockCallback(checkout.reference);

    const res = await anonymous().post('/api/gateway/mockpay/notify').send(unsigned);

    expect(res.status).toBe(400);
    expect(res.body.result).toBe('REJECTED');
    expect(await moneyState()).toEqual(before);
  });

  it('wrong amount: nothing applied, parked for a person', async () => {
    const checkout = await startCheckout();
    const before = await moneyState();

    // Correctly signed, but for Rs. 50 rather than the Rs. 5,000 of the checkout.
    const res = await postReturn(mockCallback(checkout.reference, { amount: '50' }));

    expect(res.headers.location).toContain('gateway=review');
    expect(await moneyState()).toEqual(before);

    const stored = (await repo.gatewayCheckouts.findByReference(checkout.reference))!;
    expect(stored.status).toBe('REVIEW');
    expect(stored.paymentId).toBeUndefined();
    expect(await repo.auditLogs.count({ action: 'GATEWAY_PAYMENT_NEEDS_REVIEW', targetId: stored.id })).toBe(1);

    // Replaying the mismatch neither applies it nor floods the audit trail.
    await postReturn(mockCallback(checkout.reference, { amount: '50' }));
    expect(await moneyState()).toEqual(before);
    expect(await repo.auditLogs.count({ action: 'GATEWAY_PAYMENT_NEEDS_REVIEW', targetId: stored.id })).toBe(1);
  });

  it('a larger amount than the checkout is not applied either', async () => {
    const checkout = await startCheckout();
    const before = await moneyState();
    await postReturn(mockCallback(checkout.reference, { amount: String(AMOUNT * 2) }));
    expect(await moneyState()).toEqual(before);
  });

  it('unknown reference', async () => {
    await startCheckout();
    const before = await moneyState();

    const res = await postReturn(mockCallback('T2026111112000099999'));

    expect(res.headers.location).toBe('http://localhost:5173/payments?gateway=rejected');
    expect(await moneyState()).toEqual(before);
    expect(await repo.payments.count({ source: 'GATEWAY' })).toBe(0);
  });

  it('a reference that belongs to another gateway', async () => {
    const checkout = await startCheckout();
    const before = await moneyState();
    const res = await postReturn(mockCallback(checkout.reference), 'jazzcash');
    expect(res.headers.location).toContain('gateway=rejected');
    expect(await moneyState()).toEqual(before);
  });

  it('a different merchant account, correctly signed', async () => {
    const checkout = await startCheckout();
    const before = await moneyState();
    const res = await postReturn(mockCallback(checkout.reference, { merchant: 'SOMEBODY-ELSE' }));
    expect(res.headers.location).toContain('gateway=rejected');
    expect(await moneyState()).toEqual(before);
  });

  it('an authentic "not paid" result', async () => {
    const checkout = await startCheckout();
    const before = await moneyState();

    const res = await postReturn(mockCallback(checkout.reference, { code: 'DECLINED' }));

    expect(res.headers.location).toContain('gateway=failed');
    expect(await moneyState()).toEqual(before);
    expect((await repo.gatewayCheckouts.findByReference(checkout.reference))!.status).toBe('FAILED');
  });

  it('an unknown gateway name', async () => {
    const res = await postReturn(mockCallback('T2026111112000012345'), 'nosuchpay');
    expect(res.headers.location).toContain('gateway=rejected');
  });
});

describe('idempotency', () => {
  it('a replayed callback never applies the payment twice', async () => {
    const checkout = await startCheckout();
    const callback = mockCallback(checkout.reference);

    await postReturn(callback);
    const afterFirst = await moneyState();
    const audits = await repo.auditLogs.count({ action: 'PAYMENT_VERIFIED' });

    const replay = await postReturn(callback);
    const notify = await anonymous().post('/api/gateway/mockpay/notify').send(callback);

    // The customer still lands on "paid" — it is paid — but nothing moved.
    expect(replay.headers.location).toContain('gateway=paid');
    expect(notify.body.result).toBe('ALREADY_PAID');
    expect(await moneyState()).toEqual(afterFirst);
    expect(await repo.payments.count({ referenceNumber: checkout.reference })).toBe(1);
    expect(await repo.auditLogs.count({ action: 'PAYMENT_VERIFIED' })).toBe(audits);
  });

  it('two callbacks arriving together apply it once', async () => {
    const before = await moneyState();
    const checkout = await startCheckout();
    const callback = mockCallback(checkout.reference);

    const results = await Promise.all([
      postReturn(callback),
      anonymous().post('/api/gateway/mockpay/notify').send(callback),
      postReturn(callback),
    ]);

    expect(results[0].headers.location).toContain('gateway=paid');
    expect(results[2].headers.location).toContain('gateway=paid');
    expect(await repo.payments.count({ referenceNumber: checkout.reference })).toBe(1);
    const after = await moneyState();
    expect(after.paidInPrincipal).toBe(before.paidInPrincipal + AMOUNT);
    expect(after.payments).toBe(before.payments + 1);
  });

  it('a late "failed" message does not undo a paid checkout', async () => {
    const checkout = await startCheckout();
    await postReturn(mockCallback(checkout.reference));
    const paid = await moneyState();

    await postReturn(mockCallback(checkout.reference, { code: 'DECLINED' }));

    expect((await repo.gatewayCheckouts.findByReference(checkout.reference))!.status).toBe('PAID');
    expect(await moneyState()).toEqual(paid);
  });

  it('a verified payment that cannot be applied is parked, not dropped and not guessed', async () => {
    const checkout = await startCheckout();
    await repo.installmentPlans.update(PLAN, { status: 'CANCELLED' });
    const before = await moneyState();

    const res = await postReturn(mockCallback(checkout.reference));

    expect(res.headers.location).toContain('gateway=review');
    expect(await moneyState()).toEqual(before);
    expect((await repo.gatewayCheckouts.findByReference(checkout.reference))!.status).toBe('REVIEW');
  });
});

describe('JazzCash end to end', () => {
  const SALT = 'test-integrity-salt';

  beforeEach(() => {
    unregisterGatewayProvider('MOCKPAY');
    process.env.JAZZCASH_ENV = 'sandbox';
    process.env.JAZZCASH_DEALER_DEALER_1_MERCHANT_ID = 'MC12345';
    process.env.JAZZCASH_DEALER_DEALER_1_PASSWORD = 'test-password';
    process.env.JAZZCASH_DEALER_DEALER_1_INTEGRITY_SALT = SALT;
  });

  function jazzCashResult(request: Record<string, string>, overrides: Record<string, string> = {}) {
    const fields: Record<string, string> = {
      pp_Amount: request.pp_Amount,
      pp_AuthCode: '',
      pp_BankID: '',
      pp_BillReference: request.pp_BillReference,
      pp_Language: 'EN',
      pp_MerchantID: request.pp_MerchantID,
      pp_ResponseCode: '000',
      pp_ResponseMessage: 'Thank you for Using JazzCash, your transaction was successful.',
      pp_RetreivalReferenceNo: '251111123456',
      pp_SubMerchantId: '',
      pp_TxnCurrency: 'PKR',
      pp_TxnDateTime: request.pp_TxnDateTime,
      pp_TxnRefNo: request.pp_TxnRefNo,
      pp_TxnType: 'MWALLET',
      pp_Version: '1.1',
      ppmpf_1: '',
      ...overrides,
    };
    return { ...fields, pp_SecureHash: jazzCashSecureHash(fields, SALT) };
  }

  it('builds a signed hosted-checkout form and applies its signed success', async () => {
    const before = await moneyState();
    const checkout = await startCheckout(AMOUNT, 'JAZZCASH');
    const { fields, url } = checkout.redirect;

    expect(url).toBe('https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/');
    expect(fields.pp_Amount).toBe('500000');
    expect(fields.pp_TxnRefNo).toBe(checkout.reference);
    expect(fields.pp_ReturnURL).toBe('http://localhost:5000/api/gateway/jazzcash/return');
    expect(fields.pp_SecureHash).toBe(jazzCashSecureHash(fields, SALT));
    // The salt never leaves the server.
    expect(JSON.stringify(checkout)).not.toContain(SALT);

    const res = await postReturn(jazzCashResult(fields), 'jazzcash');

    expect(res.headers.location).toContain('gateway=paid');
    const payment = (await repo.payments.findFirst({ referenceNumber: checkout.reference }))!;
    expect(payment).toMatchObject({ status: 'VERIFIED', source: 'GATEWAY', paymentMethod: 'JAZZCASH', amount: AMOUNT });
    expect((await moneyState()).remainingBalance).toBe(before.remainingBalance - AMOUNT);
  });

  it('changes nothing for a tampered amount, a failure code, or a pending voucher', async () => {
    const checkout = await startCheckout(AMOUNT, 'JAZZCASH');
    const before = await moneyState();
    const { fields } = checkout.redirect;

    const genuine = jazzCashResult(fields);
    await postReturn({ ...genuine, pp_Amount: '100' }, 'jazzcash');
    await postReturn({ ...genuine, pp_SecureHash: genuine.pp_SecureHash.replace(/.$/, (c) => (c === '0' ? '1' : '0')) }, 'jazzcash');
    await postReturn(jazzCashResult(fields, { pp_ResponseCode: '101' }), 'jazzcash');
    await postReturn(jazzCashResult(fields, { pp_ResponseCode: '124' }), 'jazzcash');
    await postReturn(jazzCashResult(fields, { pp_Amount: '100' }), 'jazzcash');
    await postReturn(jazzCashResult(fields, { pp_Amount: '500050' }), 'jazzcash');
    await postReturn(jazzCashResult(fields, { pp_MerchantID: 'MC99999' }), 'jazzcash');

    expect(await moneyState()).toEqual(before);
    expect(await repo.payments.count({ source: 'GATEWAY' })).toBe(0);
  });

  it('never applies sandbox results on a production server', async () => {
    const checkout = await startCheckout(AMOUNT, 'JAZZCASH');
    const before = await moneyState();

    process.env.NODE_ENV = 'production';
    process.env.PAYMENT_GATEWAY_API_URL = 'https://shop.example/api';
    process.env.PAYMENT_GATEWAY_DASHBOARD_URL = 'https://shop.example';
    try {
      const res = await postReturn(jazzCashResult(checkout.redirect.fields), 'jazzcash');
      expect(res.headers.location).toContain('gateway=rejected');
    } finally {
      process.env.NODE_ENV = 'test';
    }
    expect(await moneyState()).toEqual(before);
  });
});
