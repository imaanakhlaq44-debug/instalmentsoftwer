import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { DeviceDetailPage } from './DeviceDetailPage.js';
import { mockApi, renderPage, fill, fail } from '../test/harness.js';
import type { UserRole } from '../types/index.js';

/**
 * One phone, and the levers that act on it.
 *
 * Lock, unlock and release change what a customer can do with a phone they are
 * paying for, so each goes through a confirmation that says what will happen,
 * and each is offered only to the shop owner.
 */

const DEVICE = {
  id: 'dev-1',
  dealerId: 'dealer-1',
  customerId: 'cust-1',
  brand: 'Samsung',
  model: 'Galaxy A15',
  maskedImei: '4901542••••7518',
  serialNumber: 'R58N123ABC',
  status: 'OVERDUE',
  isOnline: true,
  batteryLevel: 64,
  osVersion: 'Android 14',
  securityPatch: '2026-09-01',
  lastCheckInAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  customer: { name: 'Muhammad Aslam', phone: '0300-1234567', cnic: '35202-*******-1' },
  plan: {
    totalAmount: 54000,
    downPayment: 13500,
    monthlyInstallment: 6750,
    paidInstallments: 2,
    totalInstallments: 6,
    remainingBalance: 27000,
  },
  installments: [],
  actionLogs: [],
};

const SIGNED_CONTRACT = {
  contract: { id: 'con-1', status: 'SIGNED', signerName: 'Muhammad Aslam', signedAt: '2026-09-01T10:00:00Z' },
  hashMatches: true,
  planMatches: true,
};

function open(role: UserRole, device: Record<string, unknown> = {}, routes: Record<string, unknown> = {}) {
  const api = mockApi({
    role,
    routes: {
      'GET /devices/dev-1': { ...DEVICE, ...device },
      'GET /contracts/device/dev-1': SIGNED_CONTRACT,
      ...routes,
    },
  });
  renderPage(<DeviceDetailPage />, { path: '/devices/dev-1', route: '/devices/:id' });
  return api;
}

const loaded = () => screen.findByRole('heading', { name: 'Samsung Galaxy A15' });
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const noButton = (name: string | RegExp) => expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('locking a phone', () => {
  it('asks the owner to confirm, then sends the reason', async () => {
    const api = open('DEALER_ADMIN', {}, { 'POST /devices/dev-1/lock': { message: 'Lock command sent to Samsung Galaxy A15.' } });
    await loaded();

    fireEvent.click(button('LOCK DEVICE'));

    // Nothing is sent by opening the dialog.
    expect(screen.getByText('Lock Device?')).toBeInTheDocument();
    expect(api.to('POST /devices/dev-1/lock')).toHaveLength(0);

    fill(screen.getByDisplayValue('Installment overdue per financing policy'), 'Two installments overdue, customer not answering');
    fireEvent.click(button('Confirm Lock'));

    expect(await screen.findByText('Lock command sent to Samsung Galaxy A15.')).toBeInTheDocument();
    expect(api.to('POST /devices/dev-1/lock')[0].body).toEqual({
      reason: 'Two installments overdue, customer not answering',
    });
    expect(screen.queryByText('Lock Device?')).not.toBeInTheDocument();
  });

  it('locks nothing when the owner cancels', async () => {
    const api = open('DEALER_ADMIN');
    await loaded();

    fireEvent.click(button('LOCK DEVICE'));
    fireEvent.click(button('Cancel'));

    expect(screen.queryByText('Lock Device?')).not.toBeInTheDocument();
    expect(api.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('shows why the server refused, e.g. an unsigned agreement', async () => {
    const refusal = 'This device cannot be restricted: the financing agreement has not been signed.';
    open('DEALER_ADMIN', {}, { 'POST /devices/dev-1/lock': fail(409, refusal) });
    await loaded();

    fireEvent.click(button('LOCK DEVICE'));
    fireEvent.click(button('Confirm Lock'));

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    // The dialog stays so the owner can read it and try again.
    expect(screen.getByText('Lock Device?')).toBeInTheDocument();
    await waitFor(() => expect(button('Confirm Lock')).toBeEnabled());
  });

  it('warns beside the plan when the agreement is not signed', async () => {
    open('DEALER_ADMIN', {}, {
      'GET /contracts/device/dev-1': { contract: { id: 'con-1', status: 'DRAFT' }, hashMatches: true, planMatches: true },
    });
    await loaded();

    expect(await screen.findByText(/Not signed\. This device cannot be restricted until the customer signs\./)).toBeInTheDocument();
    fireEvent.click(button('Read and sign with the customer'));
    expect(await screen.findByText('Went to /contracts/con-1')).toBeInTheDocument();
  });

  it('warns when the plan changed after signing', async () => {
    open('DEALER_ADMIN', {}, {
      'GET /contracts/device/dev-1': { ...SIGNED_CONTRACT, planMatches: false, planChanges: ['monthly installment'] },
    });
    await loaded();

    expect(await screen.findByText(/Signed, but the plan has changed since \(monthly installment\)/)).toBeInTheDocument();
  });
});

describe('unlocking a phone', () => {
  it('offers unlock instead of lock on a locked phone, and sends the note', async () => {
    const api = open('DEALER_ADMIN', { status: 'LOCKED' }, { 'POST /devices/dev-1/unlock': { message: 'Unlock command sent.' } });
    await loaded();

    noButton('LOCK DEVICE');
    fireEvent.click(button('UNLOCK DEVICE'));
    expect(screen.getByText('Authorize Device Unlock')).toBeInTheDocument();
    fireEvent.click(button('Confirm Unlock'));

    expect(await screen.findByText('Unlock command sent.')).toBeInTheDocument();
    expect(api.to('POST /devices/dev-1/unlock')[0].body).toEqual({ reason: 'Payment verified in full' });
  });

  it('treats a lock still on its way to the phone as locked', async () => {
    open('DEALER_ADMIN', { status: 'LOCK_PENDING' });
    await loaded();

    expect(button('UNLOCK DEVICE')).toBeInTheDocument();
    noButton('LOCK DEVICE');
  });
});

describe('releasing a phone', () => {
  it('says it cannot be undone and needs a reason before it will send', async () => {
    const api = open('DEALER_ADMIN', {}, { 'POST /devices/dev-1/release': { success: true } });
    await loaded();

    fireEvent.click(button('Release phone'));

    expect(screen.getByText('Release this phone')).toBeInTheDocument();
    expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
    // Two "Release phone" buttons now: the one on the page and the one that confirms.
    const confirm = screen.getAllByRole('button', { name: 'Release phone' }).at(-1)!;
    expect(confirm).toBeDisabled();

    fill(screen.getByPlaceholderText('e.g. Customer paid the full balance in cash'), 'Paid');
    expect(confirm).toBeDisabled();
    fill(screen.getByPlaceholderText('e.g. Customer paid the full balance in cash'), 'Customer paid the balance in cash');
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(await screen.findByText(/Phone released\. Its restrictions come off/)).toBeInTheDocument();
    expect(api.to('POST /devices/dev-1/release')[0].body).toEqual({ reason: 'Customer paid the balance in cash' });
  });

  it('releases nothing when cancelled', async () => {
    const api = open('DEALER_ADMIN');
    await loaded();

    fireEvent.click(button('Release phone'));
    fill(screen.getByPlaceholderText('e.g. Customer paid the full balance in cash'), 'Customer paid the balance in cash');
    fireEvent.click(button('Cancel'));

    expect(screen.queryByText('Release this phone')).not.toBeInTheDocument();
    expect(api.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('shows a released phone as the customer’s own, with nothing left to lock or release', async () => {
    open('DEALER_ADMIN', { status: 'INACTIVE' });
    await loaded();

    expect(screen.getByText('RELEASED')).toBeInTheDocument();
    expect(screen.getByText('Released: this phone belongs to the customer')).toBeInTheDocument();
    noButton('LOCK DEVICE');
    noButton('UNLOCK DEVICE');
    noButton('Release phone');
    noButton('Re-enroll');
  });
});

describe('a phone sold without a lock', () => {
  it('offers no lock, unlock or re-enroll', async () => {
    open('DEALER_ADMIN', { noLock: true, status: 'ACTIVE' });
    await loaded();

    expect(screen.getByText('NO LOCK')).toBeInTheDocument();
    expect(screen.getByText('Sold without a lock')).toBeInTheDocument();
    noButton('LOCK DEVICE');
    noButton('UNLOCK DEVICE');
    noButton('Re-enroll');
    noButton('Find this phone');
  });
});

describe('re-enrolling a wiped phone', () => {
  it('warns that a locked phone comes back unlocked, then goes to its new QR', async () => {
    const api = open('DEALER_ADMIN', { status: 'LOCKED' }, { 'POST /devices/dev-1/re-enroll': { success: true } });
    await loaded();

    fireEvent.click(button('Re-enroll'));
    expect(screen.getByText(/It comes back unlocked, so lock it again/)).toBeInTheDocument();
    fireEvent.click(button('Re-enroll and show QR'));

    expect(await screen.findByText('Went to /enrollment?device=dev-1')).toBeInTheDocument();
    expect(api.to('POST /devices/dev-1/re-enroll')[0].body).toEqual({
      reason: 'Phone was factory reset from recovery mode',
    });
  });
});

describe('a tamper alert', () => {
  const TAMPERED = {
    tamperFlags: ['IMEI_MISMATCH', 'ROOTED'],
    tamperDetectedAt: '2026-10-01T10:00:00Z',
    tamperReason: 'Reported IMEI differs from the registered IMEI.',
  };

  it('is spelled out, and the owner can resolve it with an inspection note', async () => {
    const api = open('DEALER_ADMIN', TAMPERED, { 'POST /devices/dev-1/clear-tamper': { success: true } });
    await loaded();

    expect(screen.getByText('Security & hardware integrity alert')).toBeInTheDocument();
    expect(screen.getByText('IMEI mismatch')).toBeInTheDocument();
    expect(screen.getByText('Rooted handset')).toBeInTheDocument();
    expect(screen.getByText('Reported IMEI differs from the registered IMEI.')).toBeInTheDocument();

    fireEvent.click(button('Resolve Alert'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Resolve Alert' }).at(-1)!);

    expect(await screen.findByText('Security alert resolved')).toBeInTheDocument();
    expect(api.to('POST /devices/dev-1/clear-tamper')[0].body).toEqual({
      reason: 'Handset inspected in shop; confirmed authentic',
    });
  });

  it('is shown to staff, who cannot dismiss it', async () => {
    open('DEALER_STAFF', TAMPERED);
    await loaded();

    expect(screen.getByText('Security & hardware integrity alert')).toBeInTheDocument();
    noButton('Resolve Alert');
  });
});

describe('who sees which controls', () => {
  it('gives counter staff a message button and none of the owner’s levers', async () => {
    const api = open('DEALER_STAFF', {}, { 'POST /devices/dev-1/message': { success: true } });
    await loaded();

    noButton('LOCK DEVICE');
    noButton('UNLOCK DEVICE');
    noButton('Release phone');
    noButton('Re-enroll');
    noButton(/Edit Device/);
    noButton('Find this phone');

    fireEvent.click(button(/Send Message/));
    fireEvent.click(button(/Send to Device/));

    expect(await screen.findByText('Push alert sent to device')).toBeInTheDocument();
    expect(api.to('POST /devices/dev-1/message')[0].body).toEqual({
      title: 'Important Account Notice',
      message: 'Please visit the shop or transfer installment via JazzCash.',
    });
  });

  it('gives staff no unlock on a locked phone either', async () => {
    open('DEALER_STAFF', { status: 'LOCKED' });
    await loaded();

    expect(screen.getByText('LOCKED')).toBeInTheDocument();
    noButton('UNLOCK DEVICE');
  });

  it('shows a customer their own phone and plan, with no controls at all', async () => {
    const api = open('CUSTOMER', { status: 'LOCKED' });
    await loaded();

    // What they owe is theirs to see.
    expect(screen.getByText('2 of 6 Months Paid')).toBeInTheDocument();
    expect(screen.getByText('Rs. 27,000')).toBeInTheDocument();
    expect(await screen.findByText(/Signed by Muhammad Aslam/)).toBeInTheDocument();

    noButton('LOCK DEVICE');
    noButton('UNLOCK DEVICE');
    noButton('Release phone');
    noButton('Re-enroll');
    noButton(/Edit Device/);
    noButton(/Send Message/);
    noButton('Find this phone');
    // Only the phone in the address bar was asked for.
    expect(api.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(api.calls.map((c) => c.path).sort()).toEqual(['/contracts/device/dev-1', '/devices/dev-1']);
  });

  it('shows a customer nothing of a phone the server will not give them', async () => {
    open('CUSTOMER', {}, { 'GET /devices/dev-1': fail(403, 'You do not have access to this device.') });

    expect(await screen.findByText('You do not have access to this device.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Samsung Galaxy A15' })).not.toBeInTheDocument();
    expect(screen.queryByText('Muhammad Aslam')).not.toBeInTheDocument();
  });

  it('gives the owner every lever on an overdue phone', async () => {
    open('DEALER_ADMIN');
    await loaded();

    for (const name of ['LOCK DEVICE', 'Release phone', 'Re-enroll', /Edit Device/, /Send Message/, 'Find this phone']) {
      expect(button(name)).toBeInTheDocument();
    }
  });

  it('will not offer a reboot to a phone that is offline', async () => {
    open('DEALER_ADMIN', { isOnline: false });
    await loaded();

    expect(screen.getByTitle('Device is offline and cannot be rebooted')).toBeDisabled();
  });
});
