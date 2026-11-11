import crypto from 'crypto';
import { describe, it, expect } from 'vitest';

import { jazzCashProvider, jazzCashSecureHash, jazzCashTimestamp } from '../../src/services/gateway/JazzCashProvider.js';
import { jazzCashMerchantFor, gatewayUrls, dealerEnvKey } from '../../src/services/gateway/config.js';

const merchant = { merchantId: 'MC12345', password: 'pw', integritySalt: 'salt-9x', environment: 'sandbox' as const };

describe('jazzCashSecureHash', () => {
  it('is HMAC-SHA256 over salt & non-empty values in field-name order', () => {
    const fields = { pp_Version: '1.1', pp_Amount: '10000', ppmpf_1: 'x', pp_BankID: '', pp_TxnRefNo: 'T1', pp_SecureHash: 'ignored', other: 'ignored' };
    const expected = crypto.createHmac('sha256', 'salt-9x').update('salt-9x&10000&T1&1.1&x', 'utf8').digest('hex').toUpperCase();
    expect(jazzCashSecureHash(fields, 'salt-9x')).toBe(expected);
  });
});

describe('jazzCashTimestamp', () => {
  it('is Pakistan time, yyyyMMddHHmmss', () => {
    expect(jazzCashTimestamp(new Date('2026-11-11T20:30:05Z'))).toBe('20261112013005');
  });
});

describe('verifyCallback', () => {
  const sign = (fields: Record<string, string>) => ({ ...fields, pp_SecureHash: jazzCashSecureHash(fields, merchant.integritySalt) });
  const base = { pp_TxnRefNo: 'T2026111201300512345', pp_MerchantID: 'MC12345', pp_Amount: '675000', pp_ResponseCode: '000', pp_TxnCurrency: 'PKR' };

  it('accepts a correctly signed success, in either hex case', () => {
    const signed = sign(base);
    const verdict = jazzCashProvider.verifyCallback(merchant, { ...signed, pp_SecureHash: signed.pp_SecureHash.toLowerCase() });
    expect(verdict).toMatchObject({ authentic: true, paid: true, amount: 6750, merchantId: 'MC12345', reference: base.pp_TxnRefNo });
  });

  it('rejects a changed field, a wrong salt, and a hash that is not a hash', () => {
    const signed = sign(base);
    expect(jazzCashProvider.verifyCallback(merchant, { ...signed, pp_Amount: '100' })).toEqual({ authentic: false, reason: 'BAD_SIGNATURE' });
    expect(jazzCashProvider.verifyCallback({ ...merchant, integritySalt: 'other' }, signed)).toEqual({ authentic: false, reason: 'BAD_SIGNATURE' });
    expect(jazzCashProvider.verifyCallback(merchant, { ...base, pp_SecureHash: 'zz' })).toEqual({ authentic: false, reason: 'BAD_SIGNATURE' });
    expect(jazzCashProvider.verifyCallback(merchant, base)).toEqual({ authentic: false, reason: 'MALFORMED' });
  });

  it('treats only 000 as paid', () => {
    for (const code of ['001', '124', '121', '0', '']) {
      const verdict = jazzCashProvider.verifyCallback(merchant, sign({ ...base, pp_ResponseCode: code }));
      expect(verdict.authentic && verdict.paid).toBe(false);
    }
  });

  it('gives no amount for paisa fractions, non-numbers or another currency', () => {
    for (const fields of [{ pp_Amount: '675050' }, { pp_Amount: '6750.00' }, { pp_Amount: '' }, { pp_TxnCurrency: 'USD' }]) {
      const verdict = jazzCashProvider.verifyCallback(merchant, sign({ ...base, ...fields }));
      expect(verdict).toMatchObject({ authentic: true, amount: undefined });
    }
  });
});

describe('configuration', () => {
  const triple = { JAZZCASH_MERCHANT_ID: 'MC1', JAZZCASH_PASSWORD: 'p', JAZZCASH_INTEGRITY_SALT: 's' };

  it('is off with nothing set', () => {
    expect(jazzCashMerchantFor('dealer-1', {})).toBeUndefined();
    expect(gatewayUrls({})).toBeUndefined();
  });

  it('applies the platform account only to dealerships named for it', () => {
    expect(jazzCashMerchantFor('dealer-1', triple)).toBeUndefined();
    expect(jazzCashMerchantFor('dealer-1', { ...triple, JAZZCASH_DEALER_IDS: 'dealer-2' })).toBeUndefined();
    expect(jazzCashMerchantFor('dealer-1', { ...triple, JAZZCASH_DEALER_IDS: 'dealer-2, dealer-1' })?.merchantId).toBe('MC1');
    expect(jazzCashMerchantFor('dealer-9', { ...triple, JAZZCASH_DEALER_IDS: '*' })?.merchantId).toBe('MC1');
  });

  it("prefers a dealership's own account", () => {
    expect(dealerEnvKey('dealer-1')).toBe('DEALER_1');
    const env = {
      ...triple, JAZZCASH_DEALER_IDS: '*',
      JAZZCASH_DEALER_DEALER_1_MERCHANT_ID: 'OWN', JAZZCASH_DEALER_DEALER_1_PASSWORD: 'p', JAZZCASH_DEALER_DEALER_1_INTEGRITY_SALT: 's',
    };
    expect(jazzCashMerchantFor('dealer-1', env)?.merchantId).toBe('OWN');
    expect(jazzCashMerchantFor('dealer-2', env)?.merchantId).toBe('MC1');
  });

  it('ignores an incomplete set of credentials', () => {
    expect(jazzCashMerchantFor('dealer-1', { JAZZCASH_MERCHANT_ID: 'MC1', JAZZCASH_DEALER_IDS: '*' })).toBeUndefined();
  });

  it('refuses sandbox on a production server, and insecure URLs there', () => {
    const env = { ...triple, JAZZCASH_DEALER_IDS: '*', NODE_ENV: 'production' };
    expect(jazzCashMerchantFor('dealer-1', env)).toBeUndefined();
    expect(jazzCashMerchantFor('dealer-1', { ...env, JAZZCASH_ENV: 'production' })?.environment).toBe('production');
    expect(gatewayUrls({ NODE_ENV: 'production', PAYMENT_GATEWAY_API_URL: 'http://x.pk/api', PAYMENT_GATEWAY_DASHBOARD_URL: 'https://x.pk' })).toBeUndefined();
    expect(gatewayUrls({ NODE_ENV: 'production', PAYMENT_GATEWAY_API_URL: 'https://x.pk/api/', PAYMENT_GATEWAY_DASHBOARD_URL: 'https://x.pk' }))
      .toEqual({ apiUrl: 'https://x.pk/api', dashboardUrl: 'https://x.pk' });
  });
});
