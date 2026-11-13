import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';

import { CustomersPage } from './CustomersPage.js';
import { mockApi, renderPage, fill, fail, paged } from '../test/harness.js';
import type { UserRole } from '../types/index.js';

/**
 * The customer list: who owes what, a quick look at one, and the export an
 * owner hands to their accountant.
 */

const CUSTOMERS = [
  {
    id: 'cust-1',
    name: 'Imran Qureshi',
    phone: '0301-7654321',
    cnic: '35202-*****-1',
    address: 'Gulberg, Lahore',
    totalDevices: 1,
    lockedDevices: 0,
    outstandingBalance: 42000,
    paymentStatus: 'OVERDUE',
    lastPaymentAmount: 7000,
    createdAt: '2026-05-01T10:00:00Z',
  },
  {
    id: 'cust-2',
    name: 'Sana Butt',
    phone: '0333-1112223',
    cnic: '35201-*****-2',
    totalDevices: 2,
    lockedDevices: 1,
    outstandingBalance: 0,
    paymentStatus: 'COMPLETED',
    lastPaymentAmount: null,
    createdAt: '2026-06-01T10:00:00Z',
  },
];

const DETAIL = {
  customer: {
    id: 'cust-1',
    name: 'Imran Qureshi',
    phone: '0301-7654321',
    cnic: '35202-*****-1',
    address: 'Gulberg, Lahore',
    emergencyContactName: 'Bilal Qureshi',
    emergencyContactPhone: '0300-0000000',
  },
  devices: [{ id: 'dev-1', brand: 'Infinix', model: 'Hot 40', imei: '356789012345678', status: 'OVERDUE' }],
  payments: [
    { id: 'pay-1', amount: 7000, paymentMethod: 'CASH', referenceNumber: 'R-1', status: 'VERIFIED' },
    { id: 'pay-2', amount: 5000, paymentMethod: 'JAZZCASH', referenceNumber: 'R-2', status: 'PENDING' },
    { id: 'pay-3', amount: 3000, paymentMethod: 'CASH', referenceNumber: 'R-3', status: 'VERIFIED', reversedAt: '2026-11-01T10:00:00Z' },
  ],
};

function open(role: UserRole = 'DEALER_ADMIN', routes: Record<string, unknown> = {}) {
  const api = mockApi({
    role,
    routes: { 'GET /customers': paged(CUSTOMERS), 'GET /customers/cust-1': DETAIL, ...routes },
  });
  renderPage(<CustomersPage />, { path: '/customers' });
  return api;
}

const loaded = () => screen.findByText('Imran Qureshi');
const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('the list', () => {
  it('shows each customer with what they owe and their status', async () => {
    open();
    await loaded();

    const imran = within(rowOf('Imran Qureshi'));
    expect(imran.getByText('Rs. 42,000')).toBeInTheDocument();
    expect(imran.getByText('OVERDUE')).toBeInTheDocument();
    expect(imran.getByText('Rs. 7,000')).toBeInTheDocument();
    expect(within(rowOf('Sana Butt')).getByText('None yet')).toBeInTheDocument();
  });

  it('searches by what the owner typed', async () => {
    const api = open();
    await loaded();

    fill(screen.getByPlaceholderText(/Search by customer name/), '0301');
    fireEvent.submit(screen.getByPlaceholderText(/Search by customer name/).closest('form')!);

    await waitFor(() => expect(api.to('GET /customers').at(-1)!.query.get('search')).toBe('0301'));
  });

  it('says so when there are no customers', async () => {
    open('DEALER_ADMIN', { 'GET /customers': paged([]) });

    expect(await screen.findByText('No Customers Found')).toBeInTheDocument();
  });

  it('shows the server’s refusal when the list cannot load', async () => {
    open('DEALER_ADMIN', { 'GET /customers': fail(500, 'Database unavailable') });

    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    expect(screen.getByText('No Customers Found')).toBeInTheDocument();
  });

  it('opens the full profile', async () => {
    open();
    await loaded();

    fireEvent.click(within(rowOf('Imran Qureshi')).getByRole('button', { name: 'Full Profile' }));
    expect(await screen.findByText('Went to /customers/cust-1')).toBeInTheDocument();
  });

  it('lets staff edit a customer', async () => {
    open('DEALER_STAFF');
    await loaded();

    expect(within(rowOf('Imran Qureshi')).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });
});

describe('quick view', () => {
  it('shows the customer’s phones and payments', async () => {
    open();
    await loaded();

    fireEvent.click(within(rowOf('Imran Qureshi')).getByRole('button', { name: 'Quick View' }));

    expect(await screen.findByText('Customer 360 Profile')).toBeInTheDocument();
    expect(screen.getByText('Bilal Qureshi (0300-0000000)')).toBeInTheDocument();
    expect(screen.getByText('IMEI: ***************5678')).toBeInTheDocument();
  });

  it('marks only a verified, unreversed payment as verified', async () => {
    open();
    await loaded();

    fireEvent.click(within(rowOf('Imran Qureshi')).getByRole('button', { name: 'Quick View' }));
    const modal = within((await screen.findByText('Customer 360 Profile')).closest('.shadow-overlay') as HTMLElement);

    const line = (amount: string) => modal.getByText(amount).parentElement!.parentElement as HTMLElement;
    expect(within(line('Rs. 7,000')).getByText('Verified ✓')).toBeInTheDocument();
    // A transfer still waiting for the shop, and a reversed payment, are not money received.
    expect(within(line('Rs. 5,000')).queryByText('Verified ✓')).not.toBeInTheDocument();
    expect(within(line('Rs. 5,000')).getByText('PENDING')).toBeInTheDocument();
    expect(within(line('Rs. 3,000')).queryByText('Verified ✓')).not.toBeInTheDocument();
    expect(within(line('Rs. 3,000')).getByText('REVERSED')).toBeInTheDocument();
  });
});

describe('CSV export', () => {
  it('exports every page with the filters on screen', async () => {
    const api = open('DEALER_ADMIN', {
      'GET /customers': (req: { query: URLSearchParams }) =>
        req.query.get('limit') === '200'
          ? {
              data: req.query.get('page') === '1' ? CUSTOMERS : [CUSTOMERS[0]],
              pagination: { page: Number(req.query.get('page')), limit: 200, total: 3, totalPages: 2 },
            }
          : paged(CUSTOMERS),
    });
    await loaded();

    fill(screen.getByPlaceholderText(/Search by customer name/), 'Qureshi');
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));

    expect(await screen.findByText('Exported 3 row(s) to CSV.')).toBeInTheDocument();
    const exportCalls = api.to('GET /customers').filter((c) => c.query.get('limit') === '200');
    expect(exportCalls.map((c) => c.query.get('page'))).toEqual(['1', '2']);
    expect(exportCalls.every((c) => c.query.get('search') === 'Qureshi')).toBe(true);
  });

  it('says there is nothing to export rather than writing an empty file', async () => {
    open('DEALER_ADMIN', { 'GET /customers': paged([]) });
    await screen.findByText('No Customers Found');

    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    expect(await screen.findByText('There is nothing to export with the current filters.')).toBeInTheDocument();
  });
});
