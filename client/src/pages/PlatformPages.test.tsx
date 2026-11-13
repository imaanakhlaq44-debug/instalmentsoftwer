import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';

import { PlatformDashboardPage, PlatformOrdersPage, PlatformShopsPage, type PlatformOverview } from './PlatformDashboardPage.js';
import { mockApi, renderPage, fail } from '../test/harness.js';
import { money as formatMoney } from '../utils/format.js';

/**
 * The platform owner's pages: home, lock orders and shops. What matters is that
 * the counts are the server's, that a shop is only given locks after the owner
 * confirms payment, and that "Open shop" really switches to that shop.
 */

const money = (n: number) => formatMoney(n).replace(/\s/g, ' ');

const shop = (over: Record<string, unknown>) => ({
  dealerId: 'dealer-1',
  name: 'Al-Madina Mobile Hub',
  ownerName: 'Kashif Ali',
  phone: '0300-1234567',
  city: 'Lahore',
  createdAt: '2026-01-01T00:00:00Z',
  available: 40,
  consumed: 60,
  packsBought: 2,
  billed: 50000,
  lastPackAt: '2026-10-01T00:00:00Z',
  devices: { total: 60, locked: 3, overdue: 5 },
  outOfLocks: false,
  runningLow: false,
  requestedPack: null,
  ...over,
});

const OVERVIEW: PlatformOverview = {
  totals: {
    shops: 3,
    shopsAwaitingPayment: 1,
    ordersToCheck: 2,
    locksSold: 300,
    locksSoldThisMonth: 50,
    revenue: 150000,
    revenueThisMonth: 25000,
    locksAvailable: 45,
    locksConsumed: 70,
  },
  awaitingPayment: [
    {
      dealerId: 'dealer-3',
      name: 'New Star Mobiles',
      ownerName: 'Usman',
      phone: '0345-9876543',
      email: 'usman@example.pk',
      city: 'Multan',
      createdAt: '2026-11-10T00:00:00Z',
      requestedPack: { size: 25, unitPrice: 500, totalPrice: 12500 },
    },
  ],
  shops: [
    shop({}),
    shop({ dealerId: 'dealer-2', name: 'City Phones', available: 3, runningLow: true, devices: { total: 10, locked: 0, overdue: 1 } }),
    shop({
      dealerId: 'dealer-3',
      name: 'New Star Mobiles',
      available: 0,
      outOfLocks: true,
      packsBought: 0,
      billed: 0,
      devices: { total: 0, locked: 0, overdue: 0 },
      requestedPack: { size: 25, unitPrice: 500, totalPrice: 12500 },
    }),
  ] as any,
  fleet: { byStatus: { ACTIVE: 50, OVERDUE: 6, LOCKED: 3, PENDING: 1 }, stale: 4, staleAfterDays: 7 },
};

function open(page: React.ReactNode, routes: Record<string, unknown> = {}) {
  const api = mockApi({
    role: 'SUPER_ADMIN',
    routes: {
      'GET /platform/overview': OVERVIEW,
      'GET /lock-orders': { orders: [], paymentInstructions: '', maxPendingOrders: 3 },
      ...routes,
    },
  });
  renderPage(page, { path: '/platform' });
  return api;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('platform home', () => {
  const loaded = () => screen.findByText('3 shops · 70 phones under lock');

  it('counts orders waiting, shops running low and silent phones', async () => {
    open(<PlatformDashboardPage />);
    await loaded();

    // One unpaid sign-up plus two reported payments to check.
    const orders = screen.getByText('Lock orders waiting for payment').closest('a')!;
    expect(within(orders).getByText('3')).toBeInTheDocument();
    expect(orders).toHaveAttribute('href', '/orders');

    const low = screen.getByText('Shops running out of locks').closest('a')!;
    expect(within(low).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByText('Phones silent for 7+ days').closest('a')!).getByText('4')).toBeInTheDocument();
  });

  it('shows what the platform has earned', async () => {
    open(<PlatformDashboardPage />);
    await loaded();

    expect(screen.getByText(money(25000))).toBeInTheDocument();
    expect(screen.getByText('50 locks sold')).toBeInTheDocument();
    expect(screen.getByText(money(150000))).toBeInTheDocument();
    expect(screen.getByText('60 phones in total')).toBeInTheDocument();
  });

  it('says all is well when there is nothing to do', async () => {
    open(<PlatformDashboardPage />, {
      'GET /platform/overview': {
        ...OVERVIEW,
        totals: { ...OVERVIEW.totals, ordersToCheck: 0 },
        awaitingPayment: [],
        shops: [shop({})],
        fleet: { ...OVERVIEW.fleet, stale: 0 },
      },
    });
    await loaded();

    expect(screen.getByText('No orders waiting')).toBeInTheDocument();
    expect(screen.getByText('Every shop has locks')).toBeInTheDocument();
    expect(screen.getByText('Every phone is checking in')).toBeInTheDocument();
  });

  it('opens the biggest shop’s own dashboard', async () => {
    open(<PlatformDashboardPage />);
    await loaded();
    window.scrollTo = vi.fn();

    const row = screen.getAllByText('Al-Madina Mobile Hub')[0].closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Open shop' }));

    expect(await screen.findByText('Went to /')).toBeInTheDocument();
  });

  it('offers a retry when the overview fails, and recovers', async () => {
    const api = open(<PlatformDashboardPage />, { 'GET /platform/overview': fail(500, 'Database unavailable') });

    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    api.on('GET /platform/overview', OVERVIEW);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await loaded()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('lock orders', () => {
  it('gives a waiting shop its pack only after the owner confirms payment', async () => {
    const api = open(<PlatformOrdersPage />, { 'POST /licenses/packs': { message: '25 locks given to New Star Mobiles' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);

    const give = await screen.findByRole('button', { name: 'Paid: give 25 locks' });
    fireEvent.click(give);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(api.to('POST /licenses/packs')).toHaveLength(0);

    fireEvent.click(give);
    expect(await screen.findByText('25 locks given to New Star Mobiles')).toBeInTheDocument();
    expect(api.to('POST /licenses/packs')[0].body).toEqual({ dealerId: 'dealer-3', size: 25 });
    await waitFor(() => expect(api.to('GET /platform/overview')).toHaveLength(2));
  });

  it('shows what the shop owes', async () => {
    open(<PlatformOrdersPage />);

    const order = (await screen.findByText('New Star Mobiles')).closest('li')!;
    expect(order).toHaveTextContent(`Ordered 25 locks · ${money(500)} each · to pay ${money(12500)}`);
    expect(within(order).getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/923459876543');
  });

  it('lists only paying shops as likely to order soon', async () => {
    open(<PlatformOrdersPage />);
    await screen.findByText('New Star Mobiles');

    // City Phones has bought before and is low; New Star has never paid, so it is an order, not a re-order.
    expect(screen.getByText('3 locks left')).toBeInTheDocument();
    expect(screen.getByText('City Phones')).toBeInTheDocument();
    expect(screen.queryByText('0 locks left')).not.toBeInTheDocument();
  });

  it('shows the server’s refusal and keeps the order', async () => {
    open(<PlatformOrdersPage />, { 'POST /licenses/packs': fail(400, 'This shop already has a pack being issued.') });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(await screen.findByRole('button', { name: 'Paid: give 25 locks' }));

    expect(await screen.findByText('This shop already has a pack being issued.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paid: give 25 locks' })).toBeEnabled();
  });
});

describe('shops', () => {
  const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

  it('lists every shop with its locks, phones and what it has paid', async () => {
    open(<PlatformShopsPage />);
    await screen.findByText('City Phones');

    const madina = within(rowOf('Al-Madina Mobile Hub'));
    expect(madina.getByText('40')).toBeInTheDocument();
    expect(madina.getByText('(3 locked)')).toBeInTheDocument();
    expect(madina.getByText(money(50000))).toBeInTheDocument();
    expect(within(rowOf('New Star Mobiles')).getByText('unpaid')).toBeInTheDocument();
    expect(within(rowOf('City Phones')).queryByText('unpaid')).not.toBeInTheDocument();
    expect(screen.getByText(/4 managed phones have not checked in for 7\+ days/)).toBeInTheDocument();
  });

  it('opens a shop’s own dashboard', async () => {
    open(<PlatformShopsPage />);
    await screen.findByText('City Phones');
    window.scrollTo = vi.fn();

    fireEvent.click(within(rowOf('City Phones')).getByRole('button', { name: /Open shop/ }));
    expect(await screen.findByText('Went to /')).toBeInTheDocument();
  });

  it('says so when no shop has registered', async () => {
    open(<PlatformShopsPage />, { 'GET /platform/overview': { ...OVERVIEW, shops: [], awaitingPayment: [] } });

    expect(await screen.findByText('No shops yet')).toBeInTheDocument();
  });
});
