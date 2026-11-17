import { it, expect } from 'vitest';
import { toBusinessDate } from '../../src/services/InstallmentMath.js';
it('uses the new Pakistan date at the nightly 00:30 evaluation', () => {
  expect(toBusinessDate(new Date('2026-11-16T19:30:00Z'))).toBe('2026-11-17');
});
it('changes the Pakistan business date exactly at local midnight', () => {
  expect(toBusinessDate(new Date('2026-11-16T18:59:59Z'))).toBe('2026-11-16');
  expect(toBusinessDate(new Date('2026-11-16T19:00:00Z'))).toBe('2026-11-17');
});
