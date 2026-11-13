import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';

import { DashboardPage } from './DashboardPage.js';
import { mockApi, renderPage, fail } from '../test/harness.js';
import { money as formatMoney } from '../utils/format.js';
import type { UserRole } from '../types/index.js';

/**
 * The shop owner's morning briefing.
 *
 * The figures at the top are what an owner reads before opening the shop, so
 * the tests check they are the server's figures, that each warning appears only
 * when there is something to act on, and that a customer never sees staff work.
 */

/** The formatter spaces with a no-break space; the DOM query normalises it. */
const money = (n: number) => formatMoney(n).replace(/\s/g, ' ');

const STATS = {
  totalDevices: 12,
  activeDevices: 7,
  pendingDevices: 1,
  lockedDevices: 2,
  overdueDevices: 2,
  inactiveDevices: 0,
  totalCustomers: 10,
  activePlans: 9,
  outstandingAmount: 485000,
  overdueAmount: 36500,
  overdueInstallmentsCount: 3,
  collectedThisMonth: 60000,
  pendingVerificationAmount: 0,
  collectionRatePercentage: 80,
  tamperAlertDevices: 0,
  silentDevices: 0,
  frpRefusedDevices: 0,
  frpConfigured: true,
};

/** Oldest month first, this month last — the order the server sends. */
const month = (m: string, target: number, collection = 0) => ({ month: m, target, collection, overdue: 0, paymentCount: 0 });
const CHARTS = {
  monthlyTrends: [
    month('Jun 2026', 40000, 40000),
    month('Jul 2026', 0),
    month('Aug 2026', 0),
    month('Sep 2026', 0),
    month('Oct 2026', 0),
    month('Nov 2026', 80000, 60000),
  ],
  brandDistribution: [
    { name: 'Infinix', count: 6 },
    { name: 'Tecno', count: 4 },
  ],
};

const ATTENTION = {
  overdueInstallments: [
    {
      installmentId: 'inst-1',
      customerId: 'cust-1',
      customerName: 'Imran Qureshi',
      customerPhone: '0301-7654321',
      deviceId: 'dev-1',
      deviceName: 'Infinix Hot 40',
      deviceStatus: 'OVERDUE',
      amountOutstanding: 12500,
      daysOverdue: 9,
    },
  ],
};

function open(role: UserRole = 'DEALER_ADMIN', routes: Record<string, unknown> = {}) {
  const api = mockApi({
    role,
    routes: {
      'GET /dashboard/stats': STATS,
      'GET /dashboard/charts': CHARTS,
      'GET /dashboard/attention': ATTENTION,
      ...routes,
    },
  });
  renderPage(<DashboardPage />, { path: '/' });
  return api;
}

const loaded = () => screen.findByText('9 active plans · 10 customers');

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('the money band', () => {
  it('shows the server’s outstanding, at-risk and collected figures', async () => {
    open();
    await loaded();

    // Each figure sits under its own heading; the chart below repeats some of them.
    const figure = (heading: string) => within(screen.getByText(heading).parentElement!.parentElement!);
    expect(figure('Outstanding').getByText(money(485000))).toBeInTheDocument();
    expect(figure('At risk').getByText(money(36500))).toBeInTheDocument();
    expect(figure('Collected this month').getByText(money(60000))).toBeInTheDocument();
    expect(screen.getByText('3 instalments past due')).toBeInTheDocument();
  });

  it('measures this month’s collection against this month’s schedule, not an older month’s', async () => {
    open();
    await loaded();

    // 60,000 of the 80,000 due in November. June's 40,000 would read 100%.
    const line = screen.getByText(/expected this month/);
    expect(line).toHaveTextContent('75% of 80k expected this month');
  });

  it('says nothing is due when this month has no instalments, even if an earlier month did', async () => {
    const quiet = { ...CHARTS, monthlyTrends: CHARTS.monthlyTrends.map((m, i) => (i === 5 ? { ...m, target: 0 } : m)) };
    open('DEALER_ADMIN', { 'GET /dashboard/charts': quiet });
    await loaded();

    expect(screen.getByText('No instalments fall due this month')).toBeInTheDocument();
    expect(screen.queryByText(/expected this month/)).not.toBeInTheDocument();
  });

  it('calls a portfolio with nothing past due healthy', async () => {
    open('DEALER_ADMIN', { 'GET /dashboard/stats': { ...STATS, overdueAmount: 0, overdueInstallmentsCount: 0 } });
    await loaded();

    expect(screen.getByText('Nothing past due · Fleet healthy')).toBeInTheDocument();
  });

  it('shows no invented figures when the dashboard fails to load', async () => {
    open('DEALER_ADMIN', { 'GET /dashboard/stats': fail(500, 'Database unavailable') });

    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    expect(screen.getByText('Loading your portfolio…')).toBeInTheDocument();
    expect(screen.queryByText(money(485000))).not.toBeInTheDocument();
  });
});

describe('who to chase', () => {
  it('lists the customers behind with their arrears', async () => {
    open();
    await loaded();

    expect(await screen.findByText('Imran Qureshi')).toBeInTheDocument();
    expect(screen.getByText('Who to chase today')).toBeInTheDocument();
  });

  it('never asks who is behind for a customer, and hides the staff buttons', async () => {
    const api = open('CUSTOMER');
    await loaded();

    expect(api.to('GET /dashboard/attention')).toHaveLength(0);
    expect(screen.queryByText('Who to chase today')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New financed sale/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Provision a handset/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Re-check overdue/ })).not.toBeInTheDocument();
  });

  it('lets staff sell but leaves the overdue re-check to the owner', async () => {
    open('DEALER_STAFF');
    await loaded();

    expect(screen.getByRole('button', { name: /New financed sale/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Re-check overdue/ })).not.toBeInTheDocument();
  });

  it('runs the overdue re-check for the owner and reloads the figures', async () => {
    const api = open('DEALER_ADMIN', { 'POST /installments/evaluate-overdue': { message: '2 instalments marked overdue' } });
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: /Re-check overdue/ }));

    expect(await screen.findByText('2 instalments marked overdue')).toBeInTheDocument();
    await waitFor(() => expect(api.to('GET /dashboard/stats')).toHaveLength(2));
  });
});

describe('warnings', () => {
  it('shows none when there is nothing to act on', async () => {
    open();
    await loaded();

    expect(screen.queryByText(/waiting for you to confirm it/)).not.toBeInTheDocument();
    expect(screen.queryByText(/tamper alerts/)).not.toBeInTheDocument();
    expect(screen.queryByText(/silent for over 72 hours/)).not.toBeInTheDocument();
    expect(screen.queryByText('Factory Reset Protection is off for this shop')).not.toBeInTheDocument();
  });

  it('points each warning at the list that needs attention', async () => {
    open('DEALER_ADMIN', {
      'GET /dashboard/stats': {
        ...STATS,
        pendingVerificationAmount: 15000,
        tamperAlertDevices: 1,
        silentDevices: 2,
        frpRefusedDevices: 1,
        frpConfigured: false,
      },
    });
    await loaded();

    expect(screen.getByText('Factory Reset Protection is off for this shop')).toBeInTheDocument();
    expect(screen.getByText('2 managed phone(s) have been silent for over 72 hours')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/waiting for you to confirm it/));
    expect(await screen.findByText('Went to /payments?status=PENDING')).toBeInTheDocument();
  });

  it('sends a tamper alert to the filtered device list', async () => {
    open('DEALER_ADMIN', { 'GET /dashboard/stats': { ...STATS, tamperAlertDevices: 1 } });
    await loaded();

    fireEvent.click(screen.getByText(/tamper alerts waiting for inspection/));
    expect(await screen.findByText('Went to /devices?tamper=true')).toBeInTheDocument();
  });

  it('keeps every warning from a customer', async () => {
    open('CUSTOMER', {
      'GET /dashboard/stats': { ...STATS, pendingVerificationAmount: 15000, tamperAlertDevices: 1, frpConfigured: false },
    });
    await loaded();

    expect(screen.queryByText(/waiting for you to confirm it/)).not.toBeInTheDocument();
    expect(screen.queryByText(/tamper alerts/)).not.toBeInTheDocument();
    expect(screen.queryByText('Factory Reset Protection is off for this shop')).not.toBeInTheDocument();
  });
});

describe('fleet and brands', () => {
  it('ranks brands with their counts', async () => {
    open();
    await loaded();

    expect(screen.getByText('Infinix')).toBeInTheDocument();
    expect(screen.getByText('Tecno')).toBeInTheDocument();
  });
});
