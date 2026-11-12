/**
 * How many SMS a message really costs.
 *
 * A plain English or Roman Urdu text travels in the GSM 7-bit alphabet: 160
 * characters in one SMS, 153 per part once it has to be split. A single Urdu
 * letter — or an emoji, or a curly quote pasted from Word — switches the whole
 * message to UCS-2, where one SMS holds 70 characters and each part of a longer
 * one holds 67. An Urdu reminder that looks short on screen can therefore be
 * three SMS on the bill, and a gateway usually has to be told which of the two
 * it is being handed.
 */

const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ!"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

/** In the GSM alphabet, but sent as an escape plus the character: two septets each. */
const GSM_EXTENDED = '\f^{}\\[~]|€';

const BASIC = new Set(GSM_BASIC);
const EXTENDED = new Set(GSM_EXTENDED);

export type SmsEncoding = 'GSM-7' | 'UCS-2';

export interface SmsSegmentInfo {
  encoding: SmsEncoding;
  /** True when the message cannot travel as GSM-7 — Urdu script, for one. */
  unicode: boolean;
  /** Units the message occupies: septets for GSM-7, UTF-16 code units for UCS-2. */
  length: number;
  /** How many SMS the customer's operator will count. 0 for an empty message. */
  segments: number;
  /** Units one part holds at this length: 160/153 for GSM-7, 70/67 for UCS-2. */
  perSegment: number;
  /** Units left before the message grows by another SMS. */
  remaining: number;
}

export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!BASIC.has(ch) && !EXTENDED.has(ch)) return false;
  }
  return true;
}

export function smsSegments(text: string): SmsSegmentInfo {
  if (isGsm7(text)) {
    let septets = 0;
    for (const ch of text) septets += EXTENDED.has(ch) ? 2 : 1;
    return describe('GSM-7', septets, 160, 153);
  }

  // `length` is UTF-16 code units, which is what UCS-2 parts are measured in:
  // an emoji outside the basic plane takes two, exactly as it does on the air.
  return describe('UCS-2', text.length, 70, 67);
}

function describe(encoding: SmsEncoding, length: number, single: number, multi: number): SmsSegmentInfo {
  const segments = length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / multi);
  const perSegment = segments <= 1 ? single : multi;
  const capacity = segments <= 1 ? single : segments * multi;

  return {
    encoding,
    unicode: encoding === 'UCS-2',
    length,
    segments,
    perSegment,
    remaining: capacity - length,
  };
}
