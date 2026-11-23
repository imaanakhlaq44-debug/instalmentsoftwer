import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { StaffDeskPage } from './StaffDeskPage.js';
import { mockApi, renderPage } from '../test/harness.js';
import { toRomanUrdu, toUrdu } from '../i18n/translate.js';

const desk = {
  businessDate: '2026-11-23',
  customers: [
    {
      customerId: 'cust-1', name: 'Ahmed Raza', phone: '0300-1234567', amountDue: 5000, daysLate: 4,
      plans: [{
        planId: 'plan-1', deviceName: 'Samsung A15', totalInstallments: 6, paidInstallments: 2, installmentsDue: 1,
        amountDue: 5000, daysLate: 4, installmentId: 'inst-3', nextAmount: 5000, nextDueDate: '2026-11-19',
      }],
    },
    {
      customerId: 'cust-2', name: 'Sana Bibi', phone: '0321-7654321', amountDue: 0, daysLate: 0,
      plans: [{
        planId: 'plan-2', deviceName: 'Vivo Y03', totalInstallments: 10, paidInstallments: 3, installmentsDue: 0,
        amountDue: 0, daysLate: 0, installmentId: 'inst-9', nextAmount: 3000, nextDueDate: '2026-12-05',
      }],
    },
  ],
};

function open(role: 'DEALER_STAFF' | 'DEALER_VIEWER', routes = {}) {
  const api = mockApi({ role, routes: { 'GET /staff-desk/customers': desk, ...routes } });
  renderPage(<StaffDeskPage />);
  return api;
}

describe('staff desk', () => {
  it('shows every customer with their full number and Call / WhatsApp links', async () => {
    open('DEALER_VIEWER');
    const card = (await screen.findByText('Ahmed Raza')).closest('li')!;
    expect(within(card).getByText('0300-1234567')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Call Ahmed Raza' })).toHaveAttribute('href', 'tel:03001234567');
    expect(within(card).getByRole('link', { name: 'WhatsApp Ahmed Raza' })).toHaveAttribute('href', 'https://wa.me/923001234567');
    expect(within(card).getByText('4 days late')).toBeInTheDocument();
  });

  it('gives view-only staff no way to take a payment', async () => {
    open('DEALER_VIEWER');
    await screen.findByText('Ahmed Raza');
    expect(screen.queryByRole('button', { name: /Collect payment/ })).not.toBeInTheDocument();
    expect(screen.getByText('View only')).toBeInTheDocument();
  });

  it('lets counter staff take a payment against the right plan', async () => {
    const api = open('DEALER_STAFF', { 'POST /payments': { message: 'Payment recorded.' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Collect payment from Ahmed Raza' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.submit(sheet);
    await waitFor(() => expect(api.to('POST /payments')).toHaveLength(1));
    expect(api.to('POST /payments')[0].body).toMatchObject({ customerId: 'cust-1', planId: 'plan-1', amount: 5000, paymentMethod: 'CASH' });
  });

  it('has no menu, sales, settings or account deletion', async () => {
    open('DEALER_STAFF');
    await screen.findByText('Ahmed Raza');
    for (const name of [/New sale/i, /Settings/i, /Delete account/i, /Devices/i, /Support/i]) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('searches by name or phone on the server', async () => {
    const api = open('DEALER_STAFF');
    await screen.findByText('Ahmed Raza');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search by name or phone' }), { target: { value: '0321' } });
    await waitFor(() => expect(api.to('GET /staff-desk/customers').some((r) => r.query.get('search') === '0321')).toBe(true));
  });

  it('is in Roman Urdu and Urdu', () => {
    for (const label of [
      'Call customers and take installments at the counter.', 'Call customers about their installments.',
      'Search by name or phone', 'No customers yet.', 'Up to date', 'Collect payment from Ali', 'Call Ali',
      'Sees customers and their phone numbers to call them. Nothing else.',
    ]) {
      expect(toRomanUrdu(label), label).not.toBe(label);
      expect(toUrdu(label).replace(/Ali/g, ''), label).not.toMatch(/[A-Za-z]{3,}/);
    }
  });
});
