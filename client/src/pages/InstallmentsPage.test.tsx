import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';

import { InstallmentsPage } from './InstallmentsPage.js';
import { mockApi, renderPage, fail, paged } from '../test/harness.js';
import type { UserRole } from '../types/index.js';

/**
 * Installment plans.
 *
 * Note: the API client has `reschedulePlan` and `waiveLateFee`, but no screen
 * in the dashboard calls them yet, so there is no reschedule or waiver UI to
 * test. What is here — the plan list and the overdue run — is covered.
 */

const PLANS = [
  {
    id: 'plan-000000aaa111',
    deviceId: 'dev-1',
    customerName: 'Muhammad Aslam',
    customerPhone: '0300-1234567',
    deviceBrand: 'Samsung',
    deviceModel: 'Galaxy A15',
    deviceImei: '4901542••••7518',
    totalAmount: 54000,
    monthlyInstallment: 6750,
    paidInstallments: 2,
    totalInstallments: 6,
    remainingBalance: 27000,
    status: 'OVERDUE',
  },
  {
    id: 'plan-000000bbb222',
    deviceId: 'dev-2',
    customerName: 'Sana Tariq',
    customerPhone: '0321-7654321',
    deviceBrand: 'Infinix',
    deviceModel: 'Hot 40',
    deviceImei: '3569871••••1234',
    totalAmount: 36000,
    monthlyInstallment: 3000,
    paidInstallments: 12,
    totalInstallments: 12,
    remainingBalance: 0,
    status: 'COMPLETED',
  },
];

function open(role: UserRole, routes: Record<string, unknown> = {}) {
  const api = mockApi({ role, routes: { 'GET /installments/plans': paged(PLANS), ...routes } });
  renderPage(<InstallmentsPage />, { path: '/installments' });
  return api;
}

const row = (text: string) => within(screen.getByText(text).closest('tr') as HTMLElement);

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('installment plans', () => {
  it('shows what is paid and what is still owed on each plan', async () => {
    open('DEALER_STAFF');
    await screen.findByText('Muhammad Aslam');

    const aslam = row('Muhammad Aslam');
    expect(aslam.getByText('2/6 Months')).toBeInTheDocument();
    expect(aslam.getByText('33%')).toBeInTheDocument();
    expect(aslam.getByText('Rs. 27,000')).toBeInTheDocument();
    expect(aslam.getByText('OVERDUE')).toBeInTheDocument();

    const sana = row('Sana Tariq');
    expect(sana.getByText('100%')).toBeInTheDocument();
    expect(sana.getByText('Rs. 0')).toBeInTheDocument();
  });

  it('opens the phone behind a plan', async () => {
    open('DEALER_STAFF');
    await screen.findByText('Muhammad Aslam');

    fireEvent.click(row('Muhammad Aslam').getByRole('button', { name: 'Device 360' }));

    expect(await screen.findByText('Went to /devices/dev-1')).toBeInTheDocument();
  });

  it('asks the server for only the chosen status', async () => {
    const api = open('DEALER_ADMIN');
    await screen.findByText('Muhammad Aslam');
    expect(api.to('GET /installments/plans')[0].query.get('status')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'OVERDUE' }));

    await waitFor(() => expect(api.to('GET /installments/plans').at(-1)?.query.get('status')).toBe('OVERDUE'));
  });

  it('says so when there are no plans', async () => {
    open('DEALER_STAFF', { 'GET /installments/plans': paged([]) });

    expect(await screen.findByText('No Installment Contracts Found')).toBeInTheDocument();
  });
});

describe('running the overdue check', () => {
  it('lets the owner run it and reports what it did', async () => {
    const api = open('DEALER_ADMIN', {
      'POST /installments/evaluate-overdue': { message: '3 installments marked overdue, 1 device queued for lock.' },
    });
    await screen.findByText('Muhammad Aslam');
    const loads = api.to('GET /installments/plans').length;

    fireEvent.click(screen.getByRole('button', { name: /Run Automated Overdue Engine/ }));

    expect(await screen.findByText('3 installments marked overdue, 1 device queued for lock.')).toBeInTheDocument();
    expect(api.to('POST /installments/evaluate-overdue')).toHaveLength(1);
    // The list is re-read, since statuses may have changed.
    await waitFor(() => expect(api.to('GET /installments/plans').length).toBeGreaterThan(loads));
  });

  it('shows the reason when the run fails', async () => {
    open('DEALER_ADMIN', { 'POST /installments/evaluate-overdue': fail(500, 'Overdue evaluation failed.') });
    await screen.findByText('Muhammad Aslam');

    fireEvent.click(screen.getByRole('button', { name: /Run Automated Overdue Engine/ }));

    expect(await screen.findByText('Overdue evaluation failed.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Run Automated Overdue Engine/ })).toBeEnabled());
  });

  it.each(['DEALER_STAFF', 'CUSTOMER'] as const)('is not offered to %s — it can lock phones', async (role) => {
    open(role);
    await screen.findByText('Muhammad Aslam');

    expect(screen.queryByRole('button', { name: /Run Automated Overdue Engine/ })).not.toBeInTheDocument();
  });
});
