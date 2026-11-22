import { it, expect } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { DashboardPage } from './DashboardPage.js';
import { mockApi, renderPage, fail } from '../test/harness.js';
import { toRomanUrdu, toUrdu } from '../i18n/translate.js';

const stats = { collectedToday: 12000, collectedThisMonth: 60000, outstandingAmount: 485000, overdueAmount: 36500, overdueInstallmentsCount: 3, dueTodayCount: 5, paidDueTodayCount: 2, pendingVerificationAmount: 0, tamperAlertDevices: 0, frpConfigured: true };
const today = {
  total: 1, dueTodayCount: 1, lateCount: 0,
  customers: [{ planId: 'plan-1', installmentId: 'inst-1', customerId: 'cust-1', customerName: 'Fahad Mustafa', customerPhone: '0312', deviceName: 'Tecno Camon 30', totalInstallments: 6, paidInstallments: 2, installmentsDue: 1, amountDue: 7250, dueDate: '2026-11-18', daysLate: 0 }],
};
function open(role: 'DEALER_ADMIN' | 'DEALER_STAFF' | 'CUSTOMER' = 'DEALER_ADMIN', routes = {}) {
  const api = mockApi({ role, routes: { 'GET /dashboard/stats': stats, 'GET /dashboard/today': today, 'GET /sale-drafts': { drafts: [], devices: [] }, ...routes } });
  renderPage(<DashboardPage />);
  return api;
}

it('opens the website shop dashboard on the same khata as the shop app, with month and outstanding figures', async () => {
  const api = open();
  expect(await screen.findByLabelText('Shop dashboard')).toBeInTheDocument();
  expect(screen.getByText('Shop khata')).toBeInTheDocument();
  expect(await screen.findByText('2 of 5 installments received')).toBeInTheDocument();
  expect(screen.getByText(/485,000|4,85,000/)).toBeInTheDocument();
  expect(screen.getByText(/60,000/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New sale' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Pending work/ })).toBeInTheDocument();
  expect(api.to('GET /dashboard/charts')).toHaveLength(0);
  expect(api.to('GET /dashboard/today')[0].query.get('limit')).toBe('6');
});

it('lists who owes today with Remind and Collect payment', async () => {
  open();
  const card = (await screen.findByText('Fahad Mustafa')).closest('li')!;
  expect(within(card).getByRole('button', { name: /Remind/ })).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: /Collect payment/ })).toBeInTheDocument();
});

it('keeps real server totals and retries a failure without showing invented money', async () => {
  const api = open('DEALER_ADMIN', { 'GET /dashboard/stats': fail(500, 'Unavailable') });
  await screen.findByText('Could not load the latest figures.');
  expect(screen.queryByText(/485,000/)).not.toBeInTheDocument();
  api.on('GET /dashboard/stats', stats);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText(/485,000|4,85,000/)).toBeInTheDocument();
});

it('refreshes figures without running overdue enforcement', async () => {
  const api = open();
  await screen.findByText(/485,000|4,85,000/);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh dashboard' }));
  await waitFor(() => expect(api.to('GET /dashboard/stats')).toHaveLength(2));
  expect(api.to('POST /installments/evaluate-overdue')).toHaveLength(0);
});

it('shows a pending payment only when it needs checking', async () => {
  open('DEALER_ADMIN', { 'GET /dashboard/stats': { ...stats, pendingVerificationAmount: 15000 } });
  fireEvent.click(await screen.findByRole('button', { name: /Payments awaiting confirmation/ }));
  expect(await screen.findByText('Went to /payments?status=PENDING')).toBeInTheDocument();
});

it('sends the owner to finish phone protection when it is not set up', async () => {
  open('DEALER_ADMIN', { 'GET /dashboard/stats': { ...stats, frpConfigured: false } });
  fireEvent.click(await screen.findByRole('button', { name: /Finish phone protection setup/ }));
  expect(await screen.findByText('Went to /settings')).toBeInTheDocument();
  for (const label of ['Finish phone protection setup', 'Check phone connection or protection', 'Shop dashboard']) {
    expect(toRomanUrdu(label), label).not.toBe(label);
    expect(toUrdu(label), label).not.toMatch(/[A-Za-z]{3,}/);
  }
});

it('does not expose staff work to a customer', async () => {
  const api = open('CUSTOMER', { 'GET /dashboard/charts': { monthlyTrends: [], brandDistribution: [] } });
  await waitFor(() => expect(api.to('GET /dashboard/stats')).toHaveLength(1));
  expect(api.to('GET /dashboard/today')).toHaveLength(0);
  expect(api.to('GET /dashboard/attention')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: /New sale/ })).not.toBeInTheDocument();
});
