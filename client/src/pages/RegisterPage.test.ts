import { describe, it, expect } from 'vitest';
import { validateSignup } from './RegisterPage.js';
import { PACK_PRESETS, priceForPack } from '../utils/packPricing.js';

const ok = {
  name: 'Bismillah Mobiles',
  ownerName: 'Kashif Ali',
  email: 'kashif@bismillahmobiles.pk',
  phone: '0300-1234567',
  city: 'Faisalabad',
  address: 'Shop 12, Rail Bazaar',
  password: 'Bismillah#2026',
  confirm: 'Bismillah#2026',
  packSize: 30,
};

describe('sign-up form checks', () => {
  it('accepts a complete form', () => {
    expect(validateSignup(ok)).toBeNull();
  });

  it('accepts the phone formats the server accepts', () => {
    for (const phone of ['03001234567', '0300-1234567', '+923001234567', '923001234567']) {
      expect(validateSignup({ ...ok, phone })).toBeNull();
    }
  });

  it('names the first problem it finds', () => {
    expect(validateSignup({ ...ok, email: 'not-an-email' })).toMatch(/email/i);
    expect(validateSignup({ ...ok, phone: '12345' })).toMatch(/Pakistani mobile/);
    expect(validateSignup({ ...ok, password: 'short', confirm: 'short' })).toMatch(/8 characters/);
    expect(validateSignup({ ...ok, confirm: 'Different#2026' })).toMatch(/do not match/);
  });

  it('accepts a small order and refuses an impossible one', () => {
    expect(validateSignup({ ...ok, packSize: 5 })).toBeNull();
    expect(validateSignup({ ...ok, packSize: 0 })).toMatch(/between 1 and 500/);
    expect(validateSignup({ ...ok, packSize: Number.NaN })).toMatch(/between 1 and 500/);
  });
});

describe('lock pricing, as the server charges it', () => {
  it('prices each tier', () => {
    expect(priceForPack(5)).toEqual({ size: 5, unitPrice: 1000, totalPrice: 5000 });
    expect(priceForPack(30)).toEqual({ size: 30, unitPrice: 800, totalPrice: 24_000 });
    expect(priceForPack(50)).toEqual({ size: 50, unitPrice: 700, totalPrice: 35_000 });
    expect(priceForPack(100)).toEqual({ size: 100, unitPrice: 600, totalPrice: 60_000 });
    expect(priceForPack(501)).toBeUndefined();
  });

  it('offers 5 and 10 as one-click sizes alongside the old packs', () => {
    expect([...PACK_PRESETS]).toEqual([5, 10, 30, 50, 100]);
  });
});
