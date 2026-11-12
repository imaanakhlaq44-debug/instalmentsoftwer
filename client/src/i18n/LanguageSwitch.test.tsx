import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';

import { LanguageToggle } from './LanguageContext.js';
import { PaymentsPage } from '../pages/PaymentsPage.js';
import { ContractPage } from '../pages/ContractPage.js';
import { mockApi, renderPage, paged } from '../test/harness.js';

/**
 * Switching the dashboard to Roman Urdu, on real pages.
 *
 * translate.test.ts covers the dictionary and the translator on bare markup.
 * This checks the thing a shopkeeper does: press "Roman Urdu" and read the page.
 */

const PAYMENT = {
  id: 'pay-2',
  referenceNumber: 'EAS-200002',
  customerName: 'Sana Tariq',
  customerPhone: '0321-7654321',
  amount: 6000,
  paymentMethod: 'EASYPAISA',
  status: 'PENDING',
  createdAt: '2026-10-06T11:00:00Z',
};

function openPayments() {
  mockApi({
    role: 'DEALER_STAFF',
    routes: {
      'GET /payments': paged([PAYMENT], { totals: { verifiedAmount: 0, pendingAmount: 6000, count: 1 } }),
      'GET /customers': paged([{ id: 'cust-2', name: 'Sana Tariq', phone: '0321-7654321', outstandingBalance: 12000 }]),
      'GET /payments/pending-submissions': { data: [], count: 0 },
    },
  });
  renderPage(<PaymentsPage />, { path: '/payments', chrome: <LanguageToggle /> });
}

const romanUrdu = () => fireEvent.click(screen.getByRole('button', { name: 'Roman Urdu' }));

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('switching to Roman Urdu', () => {
  it('turns the payments page into Roman Urdu, and back again', async () => {
    openPayments();
    expect(await screen.findByRole('heading', { name: 'Take a payment' })).toBeInTheDocument();
    await screen.findByText('EAS-200002');

    romanUrdu();

    expect(await screen.findByRole('heading', { name: 'Payment lein' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Qist ki payment darj karein/ })).toBeInTheDocument();
    expect(screen.getByText('Maalik ka intezar')).toBeInTheDocument();
    expect(screen.queryByText('Take a payment')).not.toBeInTheDocument();
    expect(document.documentElement.lang).toBe('ur-Latn');
    // Names, references and money are data, not wording: they are left alone.
    expect(screen.getByText('Sana Tariq')).toBeInTheDocument();
    expect(screen.getByText('EAS-200002')).toBeInTheDocument();
    expect(screen.getByText('Rs. 6,000')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(await screen.findByRole('heading', { name: 'Take a payment' })).toBeInTheDocument();
    expect(screen.getByText('Awaiting owner')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });

  it('translates a dialog opened after the switch', async () => {
    openPayments();
    await screen.findByText('EAS-200002');
    romanUrdu();
    const record = await screen.findByRole('button', { name: /Qist ki payment darj karein/ });

    fireEvent.click(record);

    // The dialog's own title is the same phrase, rendered after the switch.
    await waitFor(() => expect(screen.getAllByText('Qist ki payment darj karein').length).toBeGreaterThan(1));
    expect(screen.queryByText('Record Installment Payment')).not.toBeInTheDocument();
  });

  it('remembers the choice for the next visit', async () => {
    openPayments();
    await screen.findByText('EAS-200002');

    romanUrdu();
    await screen.findByRole('heading', { name: 'Payment lein' });

    expect(localStorage.getItem('almas_language')).toBe('roman-ur');
    expect(screen.getByRole('button', { name: 'Roman Urdu' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens in Roman Urdu when that was the saved choice', async () => {
    localStorage.setItem('almas_language', 'roman-ur');
    openPayments();

    expect(await screen.findByRole('heading', { name: 'Payment lein' })).toBeInTheDocument();
  });

  it('keeps the way back readable: the switch itself is never translated', async () => {
    openPayments();
    await screen.findByText('EAS-200002');
    romanUrdu();
    await screen.findByRole('heading', { name: 'Payment lein' });

    const toggle = within(screen.getByRole('group', { name: 'Language' }));
    expect(toggle.getByRole('button', { name: 'English' })).toBeInTheDocument();
    expect(toggle.getByRole('button', { name: 'Roman Urdu' })).toBeInTheDocument();
  });

  it('leaves the signed agreement exactly as written', async () => {
    localStorage.setItem('almas_language', 'roman-ur');
    mockApi({
      role: 'DEALER_STAFF',
      routes: {
        'GET /contracts/con-1': {
          contract: { id: 'con-1', status: 'DRAFT', termsVersion: 3 },
          snapshot: {
            dealer: { name: 'Al-Madina Mobile Hub', city: 'Lahore', phone: '0300-8451299' },
            customer: { name: 'Muhammad Aslam', cnic: '35202-1234567-1', phone: '0300-1234567', address: 'Lahore' },
            device: { brand: 'Samsung', model: 'Galaxy A15', imei: '490154203237518' },
            plan: { totalAmount: 54000, downPayment: 13500, financedAmount: 40500, totalInstallments: 6, monthlyInstallment: 6750 },
            schedule: [],
          },
          clauses: [{ heading: 'Payments', headingUr: 'ادائیگی', body: 'Settings', bodyUr: 'قسط' }],
          declaration: { en: 'I accept these terms.', ur: 'قبول ہے' },
          hashMatches: true,
          planMatches: true,
          planChanges: [],
        },
      },
    });
    renderPage(
      <>
        <p>Settings</p>
        <ContractPage />
      </>,
      { path: '/contracts/con-1', route: '/contracts/:id', chrome: <LanguageToggle /> }
    );

    await screen.findByRole('heading', { name: 'Installment Financing Agreement' });
    // "Back" has a Roman Urdu entry ("Wapas"); outside the agreement it would be
    // translated. Inside it, the legal text and its controls stay as issued.
    await waitFor(() => expect(document.documentElement.lang).toBe('ur-Latn'));
    expect(screen.getByRole('button', { name: /Back/ })).toBeInTheDocument();
    expect(screen.queryByText('Wapas')).not.toBeInTheDocument();
    expect(screen.getByText('Not signed yet')).toBeInTheDocument();
  });
});
