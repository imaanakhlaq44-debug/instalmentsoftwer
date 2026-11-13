import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';

import { CustomerDetailPage } from './CustomerDetailPage.js';
import { mockApi, renderPage, fail } from '../test/harness.js';
import type { UserRole } from '../types/index.js';

/**
 * One customer's whole account: what they owe, the schedule, and every payment
 * as it really stands — a pending or reversed payment must never look like money in.
 */

const PROFILE = {
  customer: {
    id: 'cust-1',
    name: 'Imran Qureshi',
    phone: '0301-7654321',
    cnic: '35202-*****-1',
    cnicMasked: true,
    address: 'Gulberg, Lahore',
    active: true,
    emergencyContactName: 'Bilal Qureshi',
    emergencyContactPhone: '0300-0000000',
  },
  devices: [{ id: 'dev-1', brand: 'Infinix', model: 'Hot 40', maskedImei: '**********5678', status: 'OVERDUE' }],
  plans: [{ deviceId: 'dev-1', monthlyInstallment: 7000, paidInstallments: 2, totalInstallments: 6, remainingBalance: 28000 }],
  installments: [
    { id: 'i-1', installmentNumber: 1, dueDate: '2026-09-01', amountDue: 7000, amountPaid: 7000, lateFee: 0, status: 'PAID' },
    { id: 'i-2', installmentNumber: 2, dueDate: '2026-10-01', amountDue: 7000, amountPaid: 2000, lateFee: 500, lateFeePaid: 0, totalOutstanding: 5500, status: 'OVERDUE' },
    { id: 'i-3', installmentNumber: 3, dueDate: '2026-11-01', amountDue: 7000, amountPaid: 0, lateFee: 0, totalOutstanding: 7000, status: 'OVERDUE' },
  ],
  payments: [
    { id: 'pay-1', receiptNumber: 'RCP-001', createdAt: '2026-09-01T10:00:00Z', paymentMethod: 'CASH', amount: 7000, status: 'VERIFIED' },
    { id: 'pay-2', receiptNumber: 'RCP-002', createdAt: '2026-10-03T10:00:00Z', paymentMethod: 'JAZZCASH', amount: 2000, status: 'PENDING' },
    { id: 'pay-3', receiptNumber: 'RCP-003', createdAt: '2026-10-05T10:00:00Z', paymentMethod: 'CASH', amount: 4000, status: 'VERIFIED', reversedAt: '2026-10-06T10:00:00Z' },
  ],
  summary: { outstandingBalance: 28000, totalPaid: 7000, outstandingLateFees: 500, creditBalance: 0 },
  whatsappOpens: [],
};

function open(role: UserRole = 'DEALER_ADMIN', routes: Record<string, unknown> = {}) {
  const api = mockApi({ role, routes: { 'GET /customers/cust-1': PROFILE, ...routes } });
  renderPage(<CustomerDetailPage />, { path: '/customers/cust-1', route: '/customers/:id' });
  return api;
}

const loaded = () => screen.findByRole('heading', { name: 'Imran Qureshi' });
const tile = (label: string) => screen.getByText(label).parentElement!.parentElement as HTMLElement;
const paymentRow = (receipt: string) => screen.getByText(receipt).closest('tr') as HTMLElement;

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('the account', () => {
  it('shows the server’s totals', async () => {
    open();
    await loaded();

    expect(within(tile('Outstanding')).getByText('Rs. 28,000')).toBeInTheDocument();
    expect(within(tile('Total paid')).getByText('Rs. 7,000')).toBeInTheDocument();
    expect(within(tile('Late fees')).getByText('Rs. 500')).toBeInTheDocument();
    expect(screen.getByText('(masked)')).toBeInTheDocument();
  });

  it('adds up what the overdue instalments still owe, late fees included', async () => {
    open();
    await loaded();

    expect(screen.getByText('2 overdue installments')).toBeInTheDocument();
    expect(screen.getByText(/Rs\. 12,500/)).toHaveTextContent('Rs. 12,500 outstanding, including any late fees.');
  });

  it('shows the plan on each financed phone', async () => {
    open();
    await loaded();

    const card = screen.getByText('Infinix Hot 40').closest('a') as HTMLElement;
    expect(card).toHaveAttribute('href', '/devices/dev-1');
    expect(within(card).getByText('2/6')).toBeInTheDocument();
    expect(within(card).getByText('Rs. 28,000')).toBeInTheDocument();
  });
});

describe('payment history', () => {
  it('shows each payment as it stands, and no receipt for one still pending', async () => {
    open();
    await loaded();

    expect(within(paymentRow('RCP-001')).getByRole('button', { name: 'Print' })).toBeInTheDocument();
    expect(within(paymentRow('RCP-002')).getByText('PENDING')).toBeInTheDocument();
    expect(within(paymentRow('RCP-002')).queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
    // A reversed payment keeps its receipt (which itself says REVERSED) but reads as reversed here.
    expect(within(paymentRow('RCP-003')).getByText('REVERSED')).toBeInTheDocument();
  });

  it('says so when nothing has been paid', async () => {
    open('DEALER_ADMIN', { 'GET /customers/cust-1': { ...PROFILE, payments: [] } });
    await loaded();

    expect(screen.getByText('No payments recorded yet.')).toBeInTheDocument();
  });
});

describe('who may do what', () => {
  it('lets the owner edit the customer', async () => {
    open('DEALER_ADMIN');
    await loaded();

    expect(screen.getByRole('button', { name: /Edit details/ })).toBeInTheDocument();
  });

  it('shows staff the WhatsApp opens, which a customer never sees', async () => {
    const withOpens = {
      ...PROFILE,
      whatsappOpens: [{ id: 'w-1', actorName: 'Kashif Ali', createdAt: '2026-11-10T10:00:00Z', details: 'Overdue reminder' }],
    };
    open('DEALER_STAFF', { 'GET /customers/cust-1': withOpens });
    await loaded();

    expect(screen.getByText('WhatsApp opened')).toBeInTheDocument();
    expect(screen.getByText('Kashif Ali')).toBeInTheDocument();
  });
});

describe('when it cannot load', () => {
  it('shows the server’s reason and a way back', async () => {
    open('DEALER_ADMIN', { 'GET /customers/cust-1': fail(404, 'Customer not found') });

    expect(await screen.findByText('Customer not found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to customers' }));
    expect(await screen.findByText('Went to /customers')).toBeInTheDocument();
  });
});
