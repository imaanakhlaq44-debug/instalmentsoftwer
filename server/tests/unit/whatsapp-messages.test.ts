import { describe, it, expect } from 'vitest';

import { toWhatsAppNumber } from '../../src/services/whatsapp/phone.js';
import {
  renderWhatsAppMessage, buildWaLink, formatDate, formatRupees, WHATSAPP_KINDS, WHATSAPP_LANGUAGES, WhatsAppFacts,
} from '../../src/services/whatsapp/templates.js';

describe('a Pakistani number as WhatsApp addresses it', () => {
  it.each([
    ['0300-1234567', '923001234567'],
    ['03001234567', '923001234567'],
    ['0300 1234567', '923001234567'],
    ['+923001234567', '923001234567'],
    ['+92 300 1234567', '923001234567'],
    ['923001234567', '923001234567'],
    ['00923001234567', '923001234567'],
    ['+92 (0)300 1234567', '923001234567'],
    ['3001234567', '923001234567'],
  ])('%s → %s', (raw, expected) => {
    expect(toWhatsAppNumber(raw)).toBe(expected);
  });

  it.each([
    [''],
    ['N/A'],
    ['0300-123456'],       // a digit short
    ['0300-12345678'],     // a digit long
    ['042-35761234'],      // a Lahore landline: no WhatsApp on it
    ['+1 415 555 2671'],   // not Pakistani
    ['0200-1234567'],      // mobiles start 03
  ])('refuses %s rather than guess', (raw) => {
    expect(toWhatsAppNumber(raw)).toBeNull();
  });

  it('copes with a number that was never recorded', () => {
    expect(toWhatsAppNumber(undefined)).toBeNull();
    expect(toWhatsAppNumber(null)).toBeNull();
  });
});

const facts: WhatsAppFacts = {
  customerName: 'Kashif Mehmood',
  shopName: 'Al-Madina Mobile Hub',
  shopPhone: '0300-8451299',
  deviceName: 'Vivo Y27 5G',
  amount: 6250,
  date: '2026-11-15',
  daysOverdue: 12,
  overdueCount: 2,
  receiptNumber: 'RCP-000123',
  remainingBalance: 31250,
};

describe('the messages', () => {
  it('formats money and dates the way a receipt does', () => {
    expect(formatRupees(125000)).toBe('Rs. 125,000');
    expect(formatDate('2026-11-05', 'EN')).toBe('5 Nov 2026');
    expect(formatDate('2026-11-05', 'ROMAN_UR')).toBe('5 Nov 2026');
    expect(formatDate('2026-11-05', 'UR')).toBe('5 نومبر 2026');
  });

  it('carries the real figures, the customer and the shop in every kind and language', () => {
    for (const kind of WHATSAPP_KINDS) {
      for (const language of WHATSAPP_LANGUAGES) {
        const text = renderWhatsAppMessage(kind, language, facts);

        expect(text, `${kind}/${language}`).toContain('Kashif Mehmood');
        expect(text, `${kind}/${language}`).toContain('Rs. 6,250');
        expect(text, `${kind}/${language}`).toContain('Al-Madina Mobile Hub — 0300-8451299');
        expect(text, `${kind}/${language}`).toContain(language === 'UR' ? '15 نومبر 2026' : '15 Nov 2026');
        expect(text, `${kind}/${language}`).not.toMatch(/undefined|NaN|\$\{/);
      }
    }
  });

  it('writes Urdu in Urdu script and Roman Urdu in Latin', () => {
    expect(renderWhatsAppMessage('DUE_REMINDER', 'UR', facts)).toContain('السلام علیکم');
    expect(renderWhatsAppMessage('DUE_REMINDER', 'UR', facts)).toContain('قسط');
    expect(renderWhatsAppMessage('DUE_REMINDER', 'ROMAN_UR', facts)).toContain('qist');
    expect(renderWhatsAppMessage('DUE_REMINDER', 'ROMAN_UR', facts)).not.toMatch(/[؀-ۿ]/);
    expect(renderWhatsAppMessage('DUE_REMINDER', 'EN', facts)).toContain('installment');
  });

  it('says how late and how many in an overdue notice', () => {
    const text = renderWhatsAppMessage('OVERDUE', 'EN', facts);
    expect(text).toContain('2 installment(s)');
    expect(text).toContain('12 day(s) late');
  });

  it('puts the receipt number and the balance left on a receipt', () => {
    const text = renderWhatsAppMessage('PAYMENT_RECEIVED', 'ROMAN_UR', facts);
    expect(text).toContain('RCP-000123');
    expect(text).toContain('Rs. 31,250');
  });

  it('ties a lock warning to the signed agreement, and only says "may"', () => {
    expect(renderWhatsAppMessage('LOCK_WARNING', 'EN', facts)).toContain('may be locked as per your signed agreement');
    expect(renderWhatsAppMessage('LOCK_WARNING', 'ROMAN_UR', facts)).toContain('lock ho sakta hai');
    expect(renderWhatsAppMessage('LOCK_WARNING', 'UR', facts)).toContain('لاک ہو سکتا ہے');
  });
});

describe('the wa.me link', () => {
  it('carries the number and the whole message, encoded', () => {
    const message = renderWhatsAppMessage('DUE_REMINDER', 'UR', facts);
    const url = buildWaLink('923451239874', message);

    expect(url.startsWith('https://wa.me/923451239874?text=')).toBe(true);
    expect(url).not.toMatch(/[\s؀-ۿ]/);
    expect(new URL(url).searchParams.get('text')).toBe(message);
  });
});
