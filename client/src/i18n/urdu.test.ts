import { describe, it, expect, afterEach } from 'vitest';
import { ROMAN_URDU, ROMAN_URDU_PATTERNS } from './romanUrdu.js';
import { URDU, URDU_ONLY, URDU_PATTERNS } from './urdu.js';
import { toUrdu, PageTranslator, BIDI_MARKS } from './translate.js';

const URDU_SCRIPT = /[؀-ۿ]/;
const LRM = '‎';
/** What a reader sees: the invisible direction marks taken out. */
const visible = (s: string) => s.replace(BIDI_MARKS, '');
const has = (dictionary: Record<string, string>, key: string) =>
  Object.prototype.hasOwnProperty.call(dictionary, key);

describe('the Urdu dictionary keeps up with Roman Urdu', () => {
  it('has every key the Roman Urdu dictionary has', () => {
    const missing = Object.keys(ROMAN_URDU).filter((key) => !has(URDU, key));
    // Add each of these to urdu.ts, on the line matching its place in romanUrdu.ts.
    expect(missing).toEqual([]);
  });

  it('has every pattern the Roman Urdu dictionary has', () => {
    const have = new Set(URDU_PATTERNS.map(([re]) => re.source));
    const missing = ROMAN_URDU_PATTERNS.map(([re]) => re.source).filter((source) => !have.has(source));
    expect(missing).toEqual([]);
  });

  it('carries no keys of its own, so a line removed from Roman Urdu is noticed', () => {
    // Urdu-only lines belong in URDU_ONLY.
    expect(Object.keys(URDU).filter((key) => !has(ROMAN_URDU, key))).toEqual([]);
  });

  it('is written in Urdu script, with nothing left empty', () => {
    const notUrdu = Object.entries({ ...URDU, ...URDU_ONLY })
      .filter(([, value]) => !value.trim() || !URDU_SCRIPT.test(value))
      // A handful of labels are a name or an abbreviation in every language.
      .filter(([key, value]) => key !== value)
      .map(([key]) => key);
    expect(notUrdu).toEqual([]);
  });

  it('keeps every value a pattern captures', () => {
    for (const [re, replacement] of URDU_PATTERNS) {
      const groups = new RegExp(`${re.source}|`).exec('')!.length - 1;
      for (let n = 1; n <= groups; n++) expect(replacement, re.source).toContain(`$${n}`);
    }
  });
});

describe('toUrdu', () => {
  it('translates a known line and keeps the spaces around it', () => {
    expect(toUrdu('Release phone')).toBe('فون آزاد کریں');
    expect(toUrdu('  Send Message ')).toBe('  پیغام بھیجیں ');
  });

  it('fills in numbers and names', () => {
    expect(visible(toUrdu('2 of 6 Months Paid'))).toBe('6 میں سے 2 مہینے ادا');
    expect(visible(toUrdu('Down payment for Galaxy A15 (8/128)'))).toBe('Galaxy A15 (8/128) کا ایڈوانس');
  });

  it('falls back to English for a line it does not know', () => {
    expect(visible(toUrdu('A sentence added on another branch'))).toBe('A sentence added on another branch');
  });

  it('holds figures, numbers and names left to right', () => {
    const samples = [
      'Rs 11,250',
      '+92 300 1234567',
      '35202-1234567-1',
      '356938035643809',
      '17 Aug 2026, 10:30 am',
      'Shoaib Akhtar',
    ];
    for (const text of samples) expect(toUrdu(text)).toBe(LRM + text + LRM);
    expect(toUrdu(' 0300-1234567 ')).toBe(` ${LRM}0300-1234567${LRM} `);
  });

  it('leaves text that is already Urdu, and bare punctuation, alone', () => {
    expect(toUrdu('محمد اسلم')).toBe('محمد اسلم');
    expect(toUrdu(' · ')).toBe(' · ');
    expect(toUrdu('—')).toBe('—');
  });
});

describe('PageTranslator in Urdu', () => {
  let translator: PageTranslator | undefined;
  afterEach(() => {
    translator?.stop();
    document.body.innerHTML = '';
  });

  it('translates the page and puts it back exactly as it was on stop', () => {
    document.body.innerHTML =
      '<button title="Release phone">Release phone</button><p>Rs 11,250</p><input placeholder="Search devices" value="Cancel" />';
    translator = new PageTranslator(toUrdu);
    translator.start();

    const button = document.querySelector('button')!;
    expect(button.textContent).toBe('فون آزاد کریں');
    expect(button.getAttribute('title')).toBe('فون آزاد کریں');
    expect(visible(document.querySelector('p')!.textContent!)).toBe('Rs 11,250');
    const input = document.querySelector('input')!;
    expect(input.value).toBe('Cancel');
    expect(input.getAttribute('placeholder')).toBe('فون تلاش کریں');

    translator.stop();
    translator = undefined;
    expect(button.textContent).toBe('Release phone');
    expect(document.querySelector('p')!.textContent).toBe('Rs 11,250');
  });
});
