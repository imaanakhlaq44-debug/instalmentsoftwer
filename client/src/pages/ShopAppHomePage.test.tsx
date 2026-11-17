import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { ShopAppHomePage } from './ShopAppHomePage.js';
import { mockApi, renderPage, fail } from '../test/harness.js';
const stats = { collectedToday: 42000, collectedThisMonth: 124500, outstandingAmount: 865000, dueTodayCount: 18, paidDueTodayCount: 12, totalDevices: 126, totalCustomers: 98, overdueInstallmentsCount: 6, pendingVerificationAmount: 0 };
function open(role: 'DEALER_ADMIN' | 'CUSTOMER' | 'SUPER_ADMIN' = 'DEALER_ADMIN', routes = {}) {
  const api = mockApi({ role, routes: { 'GET /dashboard/stats': stats, ...routes } }); renderPage(<ShopAppHomePage />); return api;
}
describe('Bold Easy app home', () => {
  it('uses the real daily and monthly figures in the yellow overview', async () => {
    open(); expect(await screen.findByText(/42,000/)).toBeInTheDocument();
    expect(screen.getByText(/1,24,500|124,500/)).toBeInTheDocument();
    expect(screen.getByText('12 / 18')).toBeInTheDocument();
    for (const name of ['New sale', 'Record payment', 'Installments', 'Customer list']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });
  it('opens customer and overdue lists from real home actions', async () => {
    open(); fireEvent.click(await screen.findByRole('button', { name: /Installments past due/ }));
    expect(await screen.findByText('Went to /installments?status=OVERDUE')).toBeInTheDocument();
  });
  it('opens the existing one-card sale form from New sale', async () => {
    open(); fireEvent.click(await screen.findByRole('button', { name: 'New sale' }));
    expect(await screen.findByRole('dialog', { name: 'New sale' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save signed sale & show QR' })).toBeInTheDocument();
  });
  it('keeps one sale entry point and links directly to installments', async () => {
    open(); await screen.findByText(/42,000/);
    expect(screen.queryByRole('button', { name: 'Scan new phone' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Installments' }));
    expect(await screen.findByText('Went to /installments')).toBeInTheDocument();
  });
  it('does not show shop sales or customer actions to a customer', async () => {
    open('CUSTOMER'); await screen.findByText(/42,000/);
    expect(screen.queryByRole('button', { name: 'New sale' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Customer list' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My phones' })).toBeInTheDocument();
  });
  it('shows a failure and retry instead of invented sample money', async () => {
    open('DEALER_ADMIN', { 'GET /dashboard/stats': fail(500, 'Unavailable') });
    expect(await screen.findByText('Could not load the latest figures.')).toBeInTheDocument();
    expect(screen.queryByText(/42,000/)).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  it('shows real platform earnings and platform actions for the super admin', async () => {
    open('SUPER_ADMIN', { 'GET /platform/overview': { totals: { shops: 5, revenueThisMonth: 14000, revenue: 28000, locksSoldThisMonth: 14, locksConsumed: 2 }, awaitingPayment: [], shops: [], fleet: { byStatus: {}, stale: 0 } } });
    expect(await screen.findByText(/14,000/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'All shops' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New sale' })).not.toBeInTheDocument();
  });
});
