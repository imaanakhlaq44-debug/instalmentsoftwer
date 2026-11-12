import { describe, it, expect } from 'vitest';
import { HANDSET_TEST_STEPS, emptySteps, overallResultOf, StepResult } from './handsetTest.js';
import { toRomanUrdu } from '../i18n/translate.js';

const all = (result: StepResult) => {
  const steps = emptySteps();
  for (const key of Object.keys(steps)) steps[key].result = result;
  return steps;
};

describe('the handset checklist', () => {
  it('has the nine steps, each with instructions', () => {
    expect(HANDSET_TEST_STEPS).toHaveLength(9);
    for (const step of HANDSET_TEST_STEPS) expect(step.how.length).toBeGreaterThan(20);
  });

  it('starts with nothing tested', () => {
    expect(overallResultOf(emptySteps())).toBe('NOT_TESTED');
  });

  it('passes only when every step passed, and fails on any failure', () => {
    expect(overallResultOf(all('PASS'))).toBe('PASS');

    const partial = all('PASS');
    partial.RE_ENROL.result = 'NOT_TESTED';
    expect(overallResultOf(partial)).toBe('PARTIAL');

    const failed = all('PASS');
    failed.LOCK.result = 'FAIL';
    expect(overallResultOf(failed)).toBe('FAIL');
  });

  // Titles such as "Lock" stay as they are on purpose: shops say them in English.
  it('has Roman Urdu for every step instruction', () => {
    for (const step of HANDSET_TEST_STEPS) {
      expect(toRomanUrdu(step.how), step.key).not.toBe(step.how);
    }
  });
});
