import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';

import { DevicesPage } from './DevicesPage.js';
import { mockApi, renderPage, fill, fail, paged } from '../test/harness.js';
import type { UserRole } from '../types/index.js';

/**
 * The phones list: quick lock, unlock and payment from a row.
 */

const OVERDUE = {
  id: 'dev-1',
  dealerId: 'dealer-1',
  customerId: 'cust-1',
  brand: 'Samsung',
  model: 'Galaxy A15',
  maskedImei: '4901542••••7518',
  customerName: 'Muhammad Aslam',
  customerPhone: '0300-1234567',
  monthlyAmount: 6750,
  nextDueDate: '2026-10-01',
  installmentStatus: 'OVERDUE',
  status: 'OVERDUE',
  isOnline: true,
};

const LOCKED = {
  ...OVERDUE,
  id: 'dev-2',
  customerId: 'cust-2',
  brand: 'Infinix',
  model: 'Hot 40',
  customerName: 'Sana Tariq',
  status: 'LOCKED',
};

const NO_LOCK = {
  ...OVERDUE,
  id: 'dev-3',
  customerId: 'cust-3',
  brand: 'Apple',
  model: 'iPhone 13',
  customerName: 'Bilal Ahmed',
  status: 'ACTIVE',
  installmentStatus: 'PENDING',
  noLock: true,
};

function open(role: UserRole, routes: Record<string, unknown> = {}, path = '/devices') {
  const api = mockApi({
    role,
    routes: { 'GET /devices': paged([OVERDUE, LOCKED, NO_LOCK]), ...routes },
  });
  renderPage(<DevicesPage />, { path });
  return api;
}

const row = (text: string) => within(screen.getByText(text).closest('tr') as HTMLElement);

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('locking and unlocking from the list', () => {
  it('names the phone and its customer before locking, then sends the reason', async () => {
    const api = open('DEALER_ADMIN', { 'POST /devices/dev-1/lock': { message: 'Lock command sent.' } });
    await screen.findByText('Samsung Galaxy A15');

    fireEvent.click(row('Samsung Galaxy A15').getByTitle('Restricted Lock Device'));

    const warning = screen.getByText(/into restricted mode/);
    expect(warning).toHaveTextContent('Samsung Galaxy A15');
    expect(warning).toHaveTextContent('Customer: Muhammad Aslam');
    expect(screen.getByText(/Emergency call access will remain preserved/)).toBeInTheDocument();
    expect(api.to('POST /devices/dev-1/lock')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Lock Device' }));

    expect(await screen.findByText('Lock command sent.')).toBeInTheDocument();
    expect(api.to('POST /devices/dev-1/lock')[0].body).toEqual({
      reason: 'Installment overdue for Samsung Galaxy A15',
    });
    // The other phones were not touched.
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('locks nothing on cancel', async () => {
    const api = open('DEALER_ADMIN');
    await screen.findByText('Samsung Galaxy A15');

    fireEvent.click(row('Samsung Galaxy A15').getByTitle('Restricted Lock Device'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Lock Device?')).not.toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('keeps the dialog open with the server’s reason when a lock is refused', async () => {
    open('DEALER_ADMIN', { 'POST /devices/dev-1/lock': fail(409, 'The financing agreement has not been signed.') });
    await screen.findByText('Samsung Galaxy A15');

    fireEvent.click(row('Samsung Galaxy A15').getByTitle('Restricted Lock Device'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Lock Device' }));

    expect(await screen.findByText('The financing agreement has not been signed.')).toBeInTheDocument();
    expect(screen.getByText('Lock Device?')).toBeInTheDocument();
  });

  it('offers unlock, not lock, on a locked phone', async () => {
    const api = open('DEALER_ADMIN', { 'POST /devices/dev-2/unlock': { message: 'Unlock command sent.' } });
    await screen.findByText('Infinix Hot 40');

    expect(row('Infinix Hot 40').queryByTitle('Restricted Lock Device')).not.toBeInTheDocument();
    fireEvent.click(row('Infinix Hot 40').getByTitle('Unlock Device'));
    expect(screen.getByText(/Restore full access for/)).toHaveTextContent('Infinix Hot 40');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Unlock' }));

    expect(await screen.findByText('Unlock command sent.')).toBeInTheDocument();
    expect(api.to('POST /devices/dev-2/unlock')[0].body).toEqual({ reason: 'Payment confirmed for Infinix Hot 40' });
  });

  it('offers neither on a phone sold without a lock', async () => {
    open('DEALER_ADMIN');
    await screen.findByText('Apple iPhone 13');

    expect(row('Apple iPhone 13').getByText('NO LOCK')).toBeInTheDocument();
    expect(row('Apple iPhone 13').queryByTitle('Restricted Lock Device')).not.toBeInTheDocument();
    expect(row('Apple iPhone 13').queryByTitle('Unlock Device')).not.toBeInTheDocument();
  });
});

describe('quick payment from the list', () => {
  it('starts from the monthly installment and credits the right customer', async () => {
    const api = open('DEALER_STAFF', { 'POST /payments': { message: 'Rs. 6,750 received.' } });
    await screen.findByText('Samsung Galaxy A15');

    fireEvent.click(row('Samsung Galaxy A15').getByTitle('Record Installment Payment'));

    expect(screen.getByText('Muhammad Aslam — Samsung Galaxy A15')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toHaveValue(6750);
    fill(screen.getByRole('spinbutton'), '7000');
    fireEvent.change(screen.getByDisplayValue('JazzCash'), { target: { value: 'CASH' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record & Verify Payment' }));

    expect(await screen.findByText('Rs. 6,750 received.')).toBeInTheDocument();
    expect(api.to('POST /payments')[0].body).toMatchObject({
      dealerId: 'dealer-1',
      customerId: 'cust-1',
      amount: 7000,
      paymentMethod: 'CASH',
      autoVerify: true,
    });
  });
});

describe('who sees which controls', () => {
  it('lets staff take a payment and add a sale, but not lock or unlock', async () => {
    open('DEALER_STAFF');
    await screen.findByText('Samsung Galaxy A15');

    expect(screen.getByRole('button', { name: /Add Financed Device/ })).toBeInTheDocument();
    expect(screen.getAllByTitle('Record Installment Payment')).toHaveLength(3);
    expect(screen.queryByTitle('Restricted Lock Device')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Unlock Device')).not.toBeInTheDocument();
  });

  it('lets a customer look and nothing else', async () => {
    const api = open('CUSTOMER', { 'GET /devices': paged([LOCKED]) });
    await screen.findByText('Infinix Hot 40');

    // Only what the server returned for them is listed.
    expect(screen.getAllByRole('row')).toHaveLength(2); // header + their one phone
    expect(screen.queryByText('Samsung Galaxy A15')).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /Add Financed Device/ })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Record Installment Payment')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Restricted Lock Device')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Unlock Device')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('View Full Device 360 Detail'));
    expect(await screen.findByText('Went to /devices/dev-2')).toBeInTheDocument();
    expect(api.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('does not offer a customer with no phones a way to register a sale', async () => {
    open('CUSTOMER', { 'GET /devices': paged([]) });

    expect(await screen.findByText('No Financed Devices Found')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Device Now' })).not.toBeInTheDocument();
  });

  it('offers staff the first sale from an empty list', async () => {
    open('DEALER_STAFF', {
      'GET /devices': paged([]),
      'GET /enrollment/readiness': { frpConfigured: true },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Add Device Now' }));

    expect(await screen.findByText('Sell a phone on installments')).toBeInTheDocument();
  });
});

describe('finding phones', () => {
  it('asks the server for the chosen status', async () => {
    const api = open('DEALER_ADMIN');
    await screen.findByText('Samsung Galaxy A15');

    fireEvent.click(screen.getByRole('button', { name: 'LOCKED' }));

    await waitFor(() => expect(api.to('GET /devices').at(-1)?.query.get('status')).toBe('LOCKED'));
    expect(api.to('GET /devices').at(-1)?.query.get('dealerId')).toBe('dealer-1');
  });

  it('opens on the tamper filter when linked from the dashboard', async () => {
    const api = open(
      'DEALER_ADMIN',
      { 'GET /devices': paged([{ ...OVERDUE, tamperFlags: ['ROOTED'] }]) },
      '/devices?tamper=true'
    );

    expect(await screen.findByText('Tamper Alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tamper Alerts' })).toHaveAttribute('aria-pressed', 'true');
    expect(api.to('GET /devices').at(-1)?.query.get('tamper')).toBe('true');
  });

  it('flags a phone whose reset protection was refused', async () => {
    open('DEALER_ADMIN', { 'GET /devices': paged([{ ...OVERDUE, frpStatus: 'REFUSED' }]) });

    expect(await screen.findByText('FRP Refused')).toBeInTheDocument();
  });

  it('says so when the list cannot be loaded', async () => {
    open('DEALER_ADMIN', { 'GET /devices': fail(500, 'Database is unavailable.') });

    expect(await screen.findByText('Database is unavailable.')).toBeInTheDocument();
  });
});
