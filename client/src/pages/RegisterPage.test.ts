import { describe, it, expect } from 'vitest';
import { PACKS, validateSignup } from './RegisterPage.js';

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

  it('offers the three packs the server sells, at the site prices', () => {
    expect(PACKS.map((p) => [p.size, p.perPhone, p.total])).toEqual([
      [30, 800, 24_000],
      [50, 700, 35_000],
      [100, 600, 60_000],
    ]);
  });
});
