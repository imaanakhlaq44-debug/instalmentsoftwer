/**
 * Lock pricing, as the server charges it (server/src/services/LicenseService.ts).
 * Any number of locks from 1 to 500; the more at once, the cheaper each one.
 * The server is the authority — this copy only lets a form show the price
 * before it is submitted.
 */
export const PRICE_TIERS = [
  { minSize: 100, unitPrice: 600 },
  { minSize: 50, unitPrice: 700 },
  { minSize: 30, unitPrice: 800 },
  { minSize: 1, unitPrice: 1000 },
] as const;

export const MAX_PACK_SIZE = 500;

/** One-click sizes offered next to the free-entry box. */
export const PACK_PRESETS = [5, 10, 30, 50, 100] as const;

export interface PackPrice {
  size: number;
  unitPrice: number;
  totalPrice: number;
}

export function priceForPack(size: number): PackPrice | undefined {
  if (!Number.isInteger(size) || size < 1 || size > MAX_PACK_SIZE) return undefined;
  const tier = PRICE_TIERS.find((t) => size >= t.minSize)!;
  return { size, unitPrice: tier.unitPrice, totalPrice: size * tier.unitPrice };
}

export const money = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;
