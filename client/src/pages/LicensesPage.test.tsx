import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';

import { LicensesPage } from './LicensesPage.js';
import { mockApi, renderPage, fill, fail } from '../test/harness.js';
import type { UserRole } from '../types/index.js';

/**
 * Device locks: what a shop has left, and — for the platform only — issuing more.
 *
 * Issuing a pack is how the platform hands over something a shop has paid for,
 * so the tests check that it goes to the shop that was chosen, in the size that
 * was chosen, and that a shop owner cannot issue locks to themselves.
 */

const shop = (over: Record<string, unknown> = {}) => ({
  dealerId: 'dealer-1',
  dealerName: 'Al-Madina Mobile Hub',
  dealerCity: 'Lahore',
  available: 12,
  consumed: 18,
  total: 30,
  packsBought: 1,
  spent: 24000,
  utilizationPercentage: 60,
  outOfLocks: false,
  runningLow: false,
  ...over,
});

const OTHER = shop({
  dealerId: 'dealer-2',
  dealerName: 'Bismillah Mobiles',
  dealerCity: 'Faisalabad',
  available: 0,
  consumed: 5,
  total: 5,
  spent: 5000,
  outOfLocks: true,
});

const CATALOGUE = [
  { size: 30, unitPrice: 800, totalPrice: 24000 },
  { size: 50, unitPrice: 700, totalPrice: 35000 },
];

const PACK = {
  id: 'pack-1',
  dealerId: 'dealer-1',
  dealerName: 'Al-Madina Mobile Hub',
  size: 30,
  unitPrice: 800,
  totalPrice: 24000,
  reference: 'JC-778899',
  issuedByName: 'Platform',
  consumed: 18,
  createdAt: '2026-08-01T10:00:00Z',
};

function open(role: UserRole, licences: unknown, routes: Record<string, unknown> = {}) {
  const api = mockApi({ role, routes: { 'GET /licenses': licences, ...routes } });
  renderPage(<LicensesPage />, { path: '/licenses' });
  return api;
}

/** The card for one pack size in the price list. */
const packCard = (size: number) =>
  within(screen.getAllByText(`${size} locks`).find((el) => el.closest('.well'))!.closest('.well') as HTMLElement);

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('a shop owner', () => {
  it('sees locks left, locks spent and what each pack went on', async () => {
    open('DEALER_ADMIN', { dealers: [shop()], packs: [PACK], catalogue: CATALOGUE });

    expect(await screen.findByText('Ready to enrol')).toBeInTheDocument();
    expect(screen.getByText('Locks left').parentElement).toHaveTextContent('12');
    expect(screen.getByText('Locks spent').parentElement).toHaveTextContent('18');
    expect(screen.getByText('12 unused')).toBeInTheDocument();
    expect(screen.getByText(/ref JC-778899/)).toBeInTheDocument();
  });

  it('is warned when few locks remain', async () => {
    open('DEALER_ADMIN', { dealers: [shop({ available: 3, runningLow: true })], packs: [PACK], catalogue: CATALOGUE });

    expect(await screen.findByText('Running low')).toBeInTheDocument();
  });

  it('is told plainly that no sale can be registered once locks run out', async () => {
    open('DEALER_ADMIN', {
      dealers: [shop({ available: 0, consumed: 30, outOfLocks: true })],
      packs: [{ ...PACK, consumed: 30 }],
      catalogue: CATALOGUE,
    });

    expect(await screen.findByText('No handset can be enrolled')).toBeInTheDocument();
    expect(screen.getByText(/You have no locks left\. New financed sales cannot be registered/)).toBeInTheDocument();
    expect(screen.getByText('fully used')).toBeInTheDocument();
  });

  it('can see the prices but cannot issue locks', async () => {
    const api = open('DEALER_ADMIN', { dealers: [shop()], packs: [PACK], catalogue: CATALOGUE });
    await screen.findByText('Ready to enrol');

    // Buying goes through the lock-order screen, not this page.
    expect(screen.getByRole('link', { name: /Buy locks/ })).toHaveAttribute('href', '/buy-locks');
    expect(packCard(50).getByText(/35,000/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Issue/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Shop to issue locks to')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Custom number of locks')).not.toBeInTheDocument();
    expect(api.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('says so when no pack has been bought', async () => {
    open('DEALER_ADMIN', { dealers: [shop({ available: 0, consumed: 0, total: 0, outOfLocks: true })], packs: [], catalogue: CATALOGUE });

    expect(await screen.findByText('No packs bought yet')).toBeInTheDocument();
  });
});

describe('the platform (super admin)', () => {
  const platform = { dealers: [shop(), OTHER], packs: [PACK], catalogue: CATALOGUE };

  it('cannot issue anything until a shop is picked', async () => {
    const api = open('SUPER_ADMIN', platform);
    await screen.findByText('Dealerships');

    const issue30 = packCard(30).getByRole('button', { name: 'Pick a shop first' });
    expect(issue30).toBeDisabled();
    fireEvent.click(issue30);
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('issues the chosen pack to the chosen shop', async () => {
    const api = open('SUPER_ADMIN', platform, {
      'POST /licenses/packs': { message: '50 locks issued to Bismillah Mobiles.' },
    });
    await screen.findByText('Dealerships');

    fireEvent.change(screen.getByLabelText('Shop to issue locks to'), { target: { value: 'dealer-2' } });
    expect(screen.getByText('Bismillah Mobiles has no locks left and cannot enrol a handset.')).toBeInTheDocument();

    fireEvent.click(packCard(50).getByRole('button', { name: 'Issue to Bismillah Mobiles' }));

    expect(await screen.findByText('50 locks issued to Bismillah Mobiles.')).toBeInTheDocument();
    expect(api.to('POST /licenses/packs')).toHaveLength(1);
    expect(api.to('POST /licenses/packs')[0].body).toEqual({ dealerId: 'dealer-2', size: 50 });
    // The figures are re-read from the server afterwards.
    await waitFor(() => expect(api.to('GET /licenses').length).toBeGreaterThan(1));
  });

  it('picks the shop from its row in the list', async () => {
    open('SUPER_ADMIN', platform);
    await screen.findByText('Dealerships');
    Element.prototype.scrollIntoView = vi.fn();

    const bismillah = screen.getByText('Faisalabad · 5 of 5 spent').closest('li') as HTMLElement;
    expect(within(bismillah).getByText('Out of locks')).toBeInTheDocument();
    fireEvent.click(within(bismillah).getByRole('button', { name: 'Issue locks' }));

    expect(screen.getByLabelText('Shop to issue locks to')).toHaveValue('dealer-2');
    expect(packCard(30).getByRole('button', { name: 'Issue to Bismillah Mobiles' })).toBeEnabled();
  });

  it('prices any other number of locks before issuing it', async () => {
    const api = open('SUPER_ADMIN', platform, { 'POST /licenses/packs': { message: '7 locks issued.' } });
    await screen.findByText('Dealerships');
    fireEvent.change(screen.getByLabelText('Shop to issue locks to'), { target: { value: 'dealer-1' } });

    const custom = screen.getByLabelText('Custom number of locks');
    fill(custom, '501');
    expect(screen.getByText('1 to 500 locks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Issue\s+locks to Al-Madina Mobile Hub$/ })).toBeDisabled();

    fill(custom, '7');
    expect(screen.getByText(/1,000 per handset · .*7,000 total/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Issue 7 locks to Al-Madina Mobile Hub' }));

    expect(await screen.findByText('7 locks issued.')).toBeInTheDocument();
    expect(api.to('POST /licenses/packs')[0].body).toEqual({ dealerId: 'dealer-1', size: 7 });
  });

  it('shows the reason when issuing fails, and can try again', async () => {
    open('SUPER_ADMIN', platform, { 'POST /licenses/packs': fail(400, 'Dealer is not active.') });
    await screen.findByText('Dealerships');
    fireEvent.change(screen.getByLabelText('Shop to issue locks to'), { target: { value: 'dealer-2' } });

    fireEvent.click(packCard(30).getByRole('button', { name: 'Issue to Bismillah Mobiles' }));

    expect(await screen.findByText('Dealer is not active.')).toBeInTheDocument();
    await waitFor(() => expect(packCard(30).getByRole('button', { name: 'Issue to Bismillah Mobiles' })).toBeEnabled());
  });

  it('has nobody to choose when there is only one shop', async () => {
    open('SUPER_ADMIN', { dealers: [shop()], packs: [PACK], catalogue: CATALOGUE });

    await screen.findByText('Ready to enrol');
    await waitFor(() =>
      expect(packCard(30).getByRole('button', { name: 'Issue to Al-Madina Mobile Hub' })).toBeEnabled()
    );
  });
});
