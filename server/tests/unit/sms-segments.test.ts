import { describe, it, expect } from 'vitest';

import { smsSegments, isGsm7 } from '../../src/utils/smsSegments.js';

describe('counting what an SMS costs', () => {
  it('fits 160 plain characters in one SMS and splits the 161st', () => {
    expect(smsSegments('a'.repeat(160))).toMatchObject({ encoding: 'GSM-7', segments: 1, remaining: 0 });
    expect(smsSegments('a'.repeat(161))).toMatchObject({ encoding: 'GSM-7', segments: 2, perSegment: 153 });
    expect(smsSegments('a'.repeat(306)).segments).toBe(2);
    expect(smsSegments('a'.repeat(307)).segments).toBe(3);
  });

  it('treats a Roman Urdu reminder as plain text', () => {
    const text = 'Salam Ali sahib, aap ki qist Rs 5,000 kal due hai. Shukriya - Al-Madina Mobiles';
    expect(isGsm7(text)).toBe(true);
    expect(smsSegments(text).segments).toBe(1);
  });

  it('counts an Urdu message at 70 characters an SMS, not 160', () => {
    // The mistake this prevents: an Urdu reminder that looks like one SMS on
    // screen and is billed as three.
    const urdu = 'آپ کی قسط کل واجب الادا ہے۔ براہ کرم وقت پر ادا کریں۔';
    const info = smsSegments(urdu);

    expect(info.encoding).toBe('UCS-2');
    expect(info.unicode).toBe(true);
    expect(info.length).toBe(urdu.length);
    expect(info.segments).toBe(1);

    expect(smsSegments('ق'.repeat(70)).segments).toBe(1);
    expect(smsSegments('ق'.repeat(71))).toMatchObject({ segments: 2, perSegment: 67 });
    expect(smsSegments('ق'.repeat(134)).segments).toBe(2);
    expect(smsSegments('ق'.repeat(135)).segments).toBe(3);
  });

  it('switches the whole message to Unicode for a single Urdu letter', () => {
    const mixed = 'a'.repeat(100) + 'ق';
    expect(smsSegments(mixed)).toMatchObject({ encoding: 'UCS-2', segments: 2 });
  });

  it('charges two characters for the GSM escape set', () => {
    expect(smsSegments('[€]')).toMatchObject({ encoding: 'GSM-7', length: 6 });
    expect(smsSegments('a'.repeat(159) + '€').segments).toBe(2);
  });

  it('counts an emoji as the two units it occupies', () => {
    expect(smsSegments('😀')).toMatchObject({ encoding: 'UCS-2', length: 2 });
  });

  it('reports nothing to send for an empty message', () => {
    expect(smsSegments('')).toMatchObject({ segments: 0, length: 0 });
  });
});
