import { describe, it, expect, afterEach } from 'vitest';
import { toRomanUrdu, PageTranslator } from './translate.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('toRomanUrdu', () => {
  it('translates a known line and keeps the spaces around it', () => {
    expect(toRomanUrdu('Release phone')).toBe('Phone azaad karein');
    expect(toRomanUrdu('  Send Message ')).toBe('  Message bhejein ');
  });

  it('matches across line breaks in the source', () => {
    expect(toRomanUrdu('Phones sold\n   on installments')).toBe('Qiston par biche hue phones');
  });

  it('fills in numbers', () => {
    expect(toRomanUrdu('2 of 6 Months Paid')).toBe('6 mein se 2 mahine ada');
    expect(toRomanUrdu('3 device(s) have active hardware or tamper alerts waiting for inspection')).toBe(
      '3 phone(s) par hardware ya chher-chhar ka alert hai, jaanch zaroori hai'
    );
    expect(toRomanUrdu('2 managed phone(s) have been silent for over 72 hours')).toBe(
      '2 phone(s) 72 ghante se ziada waqt se khamosh hain'
    );
    expect(toRomanUrdu('4 phone(s) refused Factory Reset Protection — recovery reset may bypass shop lock')).toBe(
      '4 phone(s) par FRP nakaam raha — recovery format se dukaan ka lock toot sakta hai'
    );
    expect(
      toRomanUrdu(
        'This handset did not hold OS-level Factory Reset Protection (OEM dropped policy). A recovery-mode wipe may not ask for your shop Google account. Check Play Services / Android version in person; Android 15+ gives strongest recovery reset protection.'
      )
    ).toBe(
      'Is phone ke system ne Factory Reset Protection nahin lagayi (OEM dropped policy). Recovery mode se format karne par shayad dukaan ka Google account na mange. Phone par Play Services aur Android version check karein; Android 15+ par hifazat sab se mazboot hoti hai.'
    );
    expect(toRomanUrdu('Tamper Alert')).toBe('Chher-chhar Alert');
    expect(toRomanUrdu('How to get Google Account ID')).toBe('Google Account ID kahan se lein');
  });

  it('covers the lock order screens', () => {
    expect(toRomanUrdu('Buy locks')).toBe('Locks khareedein');
    expect(toRomanUrdu('Payments to check')).toBe('Check karne wali payments');
    expect(toRomanUrdu('Payment received: give 30 locks')).toBe('Payment mil gayi: 30 locks dein');
    expect(toRomanUrdu(' · Rs 800 per phone · ')).toBe(' · Rs 800 fi phone · ');
    expect(toRomanUrdu('Rs 24,000 total')).toBe('kul Rs 24,000');
    expect(toRomanUrdu('Choose between 1 and 500 locks.')).toBe('1 se 500 ke darmiyan locks chunein.');
  });

  it('leaves unknown text, names and figures alone', () => {
    expect(toRomanUrdu('Shoaib Akhtar')).toBe('Shoaib Akhtar');
    expect(toRomanUrdu('Rs. 11,250')).toBe('Rs. 11,250');
  });
});

describe('PageTranslator', () => {
  let translator: PageTranslator | undefined;
  afterEach(() => {
    translator?.stop();
    document.body.innerHTML = '';
  });

  it('translates the page, then what is added later, and puts English back on stop', async () => {
    document.body.innerHTML = '<button title="Release phone">Release phone</button><input placeholder="Search devices" value="Cancel" />';
    translator = new PageTranslator();
    translator.start();

    const button = document.querySelector('button')!;
    expect(button.textContent).toBe('Phone azaad karein');
    expect(button.getAttribute('title')).toBe('Phone azaad karein');
    // What someone typed is never changed; a placeholder is just a hint.
    const input = document.querySelector('input')!;
    expect(input.value).toBe('Cancel');
    expect(input.getAttribute('placeholder')).toBe('Phones dhoondein');

    const later = document.createElement('p');
    later.textContent = 'Send Message';
    document.body.appendChild(later);
    await tick();
    expect(later.textContent).toBe('Message bhejein');

    translator.stop();
    translator = undefined;
    expect(button.textContent).toBe('Release phone');
    expect(later.textContent).toBe('Send Message');
  });

  it('leaves anything marked data-i18n-skip as written', () => {
    document.body.innerHTML = '<div data-i18n-skip><h1>Installment Financing Agreement</h1></div>';
    translator = new PageTranslator();
    translator.start();
    expect(document.querySelector('h1')!.textContent).toBe('Installment Financing Agreement');
  });
});
