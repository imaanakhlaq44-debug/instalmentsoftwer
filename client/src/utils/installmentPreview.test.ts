import { it, expect } from 'vitest';
import { installmentPreview } from './installmentPreview.js';
it('calculates the financed amount and exact final installment from price and advance', () => {
  const result = installmentPreview(60000, 10000, 6)!;
  expect(result).toEqual({ financedAmount: 50000, monthlyInstallment: 8333, finalInstallment: 8335 });
  expect(result.monthlyInstallment * 5 + result.finalInstallment).toBe(50000);
});
it('recalculates when the advance or number of months changes', () => {
  expect(installmentPreview(60000, 15000, 6)?.monthlyInstallment).toBe(7500);
  expect(installmentPreview(60000, 10000, 12)).toEqual({ financedAmount: 50000, monthlyInstallment: 4166, finalInstallment: 4174 });
});
it('does not invent a schedule for invalid or incomplete money fields', () => {
  for (const input of [[0, 0, 6], [60000, 60000, 6], [60000, -1, 6], [60000, 10000, 0], [NaN, 0, 6], [60000.5, 10000, 6]]) expect(installmentPreview(...input as [number, number, number])).toBeNull();
});
