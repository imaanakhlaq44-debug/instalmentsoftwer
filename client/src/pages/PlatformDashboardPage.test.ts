import { describe, it, expect } from 'vitest';
import { whatsappNumber } from './PlatformDashboardPage.js';

describe('WhatsApp links for a shop', () => {
  it('turns a Pakistani mobile number into the international form', () => {
    expect(whatsappNumber('0300-1234567')).toBe('923001234567');
    expect(whatsappNumber('03001234567')).toBe('923001234567');
    expect(whatsappNumber('+923001234567')).toBe('923001234567');
    expect(whatsappNumber('923001234567')).toBe('923001234567');
  });
});
