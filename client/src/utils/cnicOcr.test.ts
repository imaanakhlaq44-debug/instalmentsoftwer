import { describe, it, expect } from 'vitest';
import { parseCnicText } from './cnicOcr.js';
describe('CNIC OCR review fields', () => {
  it('extracts labelled English fields and never substitutes the father name', () => {
    expect(parseCnicText('PAKISTAN\nName\nSample Customer\nFather Name\nSample Father\n35202-1234567-1\nPresent Address: House 4\nTest Street\nDate of Issue 01.01.2020')).toEqual({ cnic: '35202-1234567-1', name: 'Sample Customer', address: 'House 4 Test Street' });
  });
  it('reads Urdu digits and labels', () => {
    expect(parseCnicText('نام: محمد اسلم\n۳۵۲۰۲-۱۲۳۴۵۶۷-۱\nموجودہ پتہ: لاہور')).toEqual({ cnic: '35202-1234567-1', name: 'محمد اسلم', address: 'لاہور' });
  });
  it('leaves ambiguous CNICs empty for review', () => {
    expect(parseCnicText('35202-1234567-1\n35202-1234567-2').cnic).toBe('');
  });
  it('does not guess a name or address from unrelated card text', () => {
    expect(parseCnicText('PAKISTAN\nFather Name\nAnother Person\n01.01.2020')).toEqual({ cnic: '', name: '', address: '' });
  });
});
