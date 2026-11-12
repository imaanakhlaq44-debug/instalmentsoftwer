import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';

import { HandsetTestsPage } from './HandsetTestsPage.js';
import { CHECKLIST_SHEET_TEXT } from '../components/HandsetTestChecklist.js';
import { HANDSET_TEST_STEPS } from '../utils/handsetTest.js';
import { ROMAN_URDU } from '../i18n/romanUrdu.js';
import { URDU } from '../i18n/urdu.js';
import { mockApi, renderPage, paged } from '../test/harness.js';

/** The paper checklist a shop prints to test the lock app on a phone at the counter. */

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('the printable checklist', () => {
  it('opens from the Phone tests page with all nine steps and prints', async () => {
    mockApi({
      role: 'DEALER_ADMIN',
      routes: { 'GET /handset-tests': paged([], { facets: { brands: [], androidVersions: [] } }) },
    });
    renderPage(<HandsetTestsPage />, { path: '/handset-tests' });

    fireEvent.click(await screen.findByRole('button', { name: /Print checklist/ }));
    const sheet = screen.getByRole('dialog', { name: 'Phone test checklist' });

    const steps = within(sheet).getAllByTestId('checklist-step');
    expect(steps).toHaveLength(9);
    HANDSET_TEST_STEPS.forEach((s, i) => {
      expect(steps[i]).toHaveTextContent(s.title);
      expect(steps[i]).toHaveTextContent(s.how);
      // Roman Urdu beside the English, and boxes to tick.
      expect(steps[i]).toHaveTextContent(ROMAN_URDU[s.how]);
      expect(steps[i]).toHaveTextContent('Not tested');
    });
    expect(sheet).toHaveTextContent('1.5.2');

    const print = vi.fn();
    vi.stubGlobal('print', print);
    fireEvent.click(within(sheet).getByRole('button', { name: /Print/ }));
    expect(print).toHaveBeenCalled();

    fireEvent.click(within(sheet).getByRole('button', { name: /Close/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has Roman Urdu and Urdu for every line it prints', () => {
    const has = (d: Record<string, string>, k: string) => Object.prototype.hasOwnProperty.call(d, k);
    expect(CHECKLIST_SHEET_TEXT.filter((k) => !has(ROMAN_URDU, k) || !has(URDU, k))).toEqual([]);
  });
});
