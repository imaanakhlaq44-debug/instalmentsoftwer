import { describe, it, expect } from 'vitest';

import { priceForPack, PACK_OPTIONS, MAX_PACK_SIZE } from '../../src/services/LicenseService.js';

describe('pricing a pack of locks', () => {
  it('sells small packs at Rs 1,000 a lock', () => {
    expect(priceForPack(1)).toEqual({ size: 1, unitPrice: 1000, totalPrice: 1000 });
    expect(priceForPack(5)).toEqual({ size: 5, unitPrice: 1000, totalPrice: 5000 });
    expect(priceForPack(29)).toEqual({ size: 29, unitPrice: 1000, totalPrice: 29_000 });
  });

  it('keeps the old prices for 30, 50 and 100', () => {
    expect(priceForPack(30)).toEqual({ size: 30, unitPrice: 800, totalPrice: 24_000 });
    expect(priceForPack(50)).toEqual({ size: 50, unitPrice: 700, totalPrice: 35_000 });
    expect(priceForPack(100)).toEqual({ size: 100, unitPrice: 600, totalPrice: 60_000 });
  });

  it('prices sizes between the tiers at the tier below', () => {
    expect(priceForPack(45)?.unitPrice).toBe(800);
    expect(priceForPack(75)?.unitPrice).toBe(700);
    expect(priceForPack(250)?.unitPrice).toBe(600);
  });

  it('refuses sizes that cannot be sold', () => {
    for (const n of [0, -3, 2.5, MAX_PACK_SIZE + 1, Number.NaN]) {
      expect(priceForPack(n)).toBeUndefined();
    }
  });

  it('offers 10, 30, 50 and 100 as one-click sizes', () => {
    expect(PACK_OPTIONS.map((p) => p.size)).toEqual([10, 30, 50, 100]);
  });
});
