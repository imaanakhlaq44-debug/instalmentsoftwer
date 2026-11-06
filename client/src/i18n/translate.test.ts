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
