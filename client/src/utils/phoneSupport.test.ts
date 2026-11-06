import { describe, expect, it } from 'vitest';
import { checkPhoneSupport } from './phoneSupport.js';

describe('checkPhoneSupport', () => {
  it('supports a modern Samsung fully', () => {
    expect(checkPhoneSupport({ brand: 'Samsung', android: '11+', playStore: true }).level).toBe('full');
  });

  it('never supports an iPhone, whatever else is said', () => {
    expect(checkPhoneSupport({ brand: 'Apple', android: '11+', playStore: true }).level).toBe('none');
  });

  it('rules out a phone without Google Play, such as a newer Huawei', () => {
    expect(checkPhoneSupport({ brand: 'Huawei', android: '11+', playStore: false }).level).toBe('none');
  });

  it('rules out Android 7 and older', () => {
    expect(checkPhoneSupport({ brand: 'Samsung', android: '7-', playStore: true }).level).toBe('none');
  });

  it('a 2019 Huawei with Play Store on Android 9 locks but has no reset protection', () => {
    const r = checkPhoneSupport({ brand: 'Huawei', android: '8-10', playStore: true });
    expect(r.level).toBe('partial');
    expect(r.title).toMatch(/reset protection/);
  });

  it('asks for an Itel to be tested first', () => {
    expect(checkPhoneSupport({ brand: 'Itel', android: '11+', playStore: true }).level).toBe('partial');
  });
});
