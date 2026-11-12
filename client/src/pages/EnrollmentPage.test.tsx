import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { EnrollmentPage } from './EnrollmentPage.js';
import { mockApi, renderPage, fail, paged } from '../test/harness.js';
import type { UserRole } from '../types/index.js';

/**
 * The enrolment QR page: pick the phone being sold, show its QR.
 *
 * (The countdown arithmetic has its own unit test in EnrollmentPage.test.ts.)
 */

const WAITING = [
  { id: 'dev-1', dealerId: 'dealer-1', brand: 'Samsung', model: 'Galaxy A15', maskedImei: '4901542••••7518', customerName: 'Muhammad Aslam' },
  { id: 'dev-2', dealerId: 'dealer-1', brand: 'Infinix', model: 'Hot 40', maskedImei: '3569871••••1234', customerName: 'Sana Tariq' },
];

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

const qrFor = (extra: Record<string, unknown> = {}) => ({
  token: { token: 'ENR-7K2M-QX', expiresAt: inMinutes(120) },
  qrImageDataUrl: 'data:image/png;base64,QR',
  qrProvisioningReady: true,
  ...extra,
});

function open(role: UserRole, routes: Record<string, unknown> = {}, path = '/enrollment') {
  const api = mockApi({
    role,
    routes: {
      'GET /devices': paged(WAITING),
      'GET /enrollment/tokens': paged([]),
      'GET /enrollment/readiness': { frpConfigured: true, frpAccountsCount: 1, provisioningReady: true },
      'POST /enrollment/generate': qrFor(),
      ...routes,
    },
  });
  renderPage(<EnrollmentPage />, { path });
  return api;
}

const QR_ALT = 'QR code to scan on the new phone';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('showing a phone its QR', () => {
  it('lists only phones waiting to be connected and shows no QR until one is chosen', async () => {
    const api = open('DEALER_STAFF');

    expect(await screen.findByText('Samsung Galaxy A15')).toBeInTheDocument();
    expect(screen.getByText('Muhammad Aslam · IMEI …7518')).toBeInTheDocument();
    expect(screen.getByText('The QR appears here')).toBeInTheDocument();
    expect(screen.queryByAltText(QR_ALT)).not.toBeInTheDocument();

    const asked = api.to('GET /devices')[0].query;
    expect(asked.get('status')).toBe('PENDING');
    expect(asked.get('lockable')).toBe('true');
    expect(api.to('POST /enrollment/generate')).toHaveLength(0);
  });

  it('makes a two-hour QR for exactly the phone that was tapped', async () => {
    const api = open('DEALER_STAFF');

    fireEvent.click(await screen.findByRole('button', { name: /Infinix Hot 40/ }));

    expect(await screen.findByAltText(QR_ALT)).toHaveAttribute('src', 'data:image/png;base64,QR');
    expect(screen.getByText('ENR-7K2M-QX')).toBeInTheDocument();
    expect(screen.getByText('Valid for 2h 0m, one phone only')).toBeInTheDocument();
    expect(screen.getByText('Infinix Hot 40 for Sana Tariq')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Infinix Hot 40/ })).toHaveAttribute('aria-pressed', 'true');
    expect(api.to('POST /enrollment/generate')[0].body).toEqual({
      dealerId: 'dealer-1',
      deviceId: 'dev-2',
      qrType: 'STANDARD',
      expiresInMinutes: 120,
    });
  });

  it('opens the QR straight away when arriving from a sale', async () => {
    const api = open('DEALER_STAFF', {}, '/enrollment?device=dev-1');

    expect(await screen.findByAltText(QR_ALT)).toBeInTheDocument();
    expect(api.to('POST /enrollment/generate')[0].body.deviceId).toBe('dev-1');
  });

  it('shows the QR full screen for older phones, and closes again', async () => {
    open('DEALER_STAFF');
    fireEvent.click(await screen.findByRole('button', { name: /Samsung Galaxy A15/ }));

    fireEvent.click(await screen.findByRole('button', { name: /Show QR full screen/ }));
    expect(screen.getByRole('dialog', { name: 'QR code, full screen' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close full screen QR' }));
    expect(screen.queryByRole('dialog', { name: 'QR code, full screen' })).not.toBeInTheDocument();
  });

  it('offers a new QR instead of an expired one', async () => {
    const api = open('DEALER_STAFF', {
      'POST /enrollment/generate': qrFor({ token: { token: 'ENR-OLD', expiresAt: inMinutes(-5) } }),
    });
    fireEvent.click(await screen.findByRole('button', { name: /Samsung Galaxy A15/ }));

    expect(await screen.findByText('This QR has expired')).toBeInTheDocument();
    // An expired QR must not be blown up for scanning.
    expect(screen.queryByRole('button', { name: /Show QR full screen/ })).not.toBeInTheDocument();

    api.on('POST /enrollment/generate', qrFor());
    fireEvent.click(screen.getByRole('button', { name: 'Expired, make a new QR' }));

    // The page's clock ticks every 30 seconds, so the fresh code reads 2h 0m or 2h 1m.
    expect(await screen.findByText(/^Valid for 2h [01]m, one phone only$/)).toBeInTheDocument();
    expect(screen.queryByText('This QR has expired')).not.toBeInTheDocument();
    expect(api.to('POST /enrollment/generate')).toHaveLength(2);
  });

  it('warns when the QR cannot install the app yet', async () => {
    open('DEALER_STAFF', {
      'POST /enrollment/generate': qrFor({ qrProvisioningReady: false, qrWarning: 'The app download URL is not configured.' }),
    });
    fireEvent.click(await screen.findByRole('button', { name: /Samsung Galaxy A15/ }));

    expect(await screen.findByText('This QR cannot set up a new phone yet.')).toBeInTheDocument();
    expect(screen.getByText(/The app download URL is not configured\./)).toBeInTheDocument();
  });

  it('shows why a QR could not be made, e.g. no locks left', async () => {
    open('DEALER_STAFF', { 'POST /enrollment/generate': fail(403, 'You have no device locks left.') });
    fireEvent.click(await screen.findByRole('button', { name: /Samsung Galaxy A15/ }));

    expect(await screen.findByText('You have no device locks left.')).toBeInTheDocument();
    expect(screen.queryByAltText(QR_ALT)).not.toBeInTheDocument();
    // The list is usable again for another try.
    await waitFor(() => expect(screen.getByRole('button', { name: /Samsung Galaxy A15/ })).toBeEnabled());
  });

  it('tells the shop to register a sale first when no phone is waiting', async () => {
    open('DEALER_STAFF', { 'GET /devices': paged([]) });

    expect(await screen.findByText('No phone is waiting')).toBeInTheDocument();
  });
});

describe('recent QR codes', () => {
  it('shows whether each code was used, is waiting or has expired', async () => {
    open('DEALER_STAFF', {
      'GET /enrollment/tokens': paged([
        { id: 't1', token: 'ENR-USED', status: 'ENROLLED', deviceInfo: 'Samsung Galaxy A15', customerName: 'Muhammad Aslam', expiresAt: inMinutes(60) },
        { id: 't2', token: 'ENR-WAIT', status: 'ACTIVE', deviceInfo: 'Infinix Hot 40', customerName: 'Sana Tariq', expiresAt: inMinutes(45) },
        { id: 't3', token: 'ENR-DEAD', status: 'ACTIVE', isExpired: true, deviceInfo: 'Tecno Spark 20', customerName: 'Bilal Ahmed', expiresAt: inMinutes(-60) },
        { id: 't4', token: 'ENR-LOOSE', status: 'ACTIVE', deviceInfo: 'Unassigned', expiresAt: inMinutes(30) },
      ]),
    });

    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getAllByText('Waiting for scan')).toHaveLength(2);
    expect(screen.getByText('45m')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Not linked to a phone (cannot be used)')).toBeInTheDocument();
  });
});

describe('the reset-protection warning', () => {
  const off = { 'GET /enrollment/readiness': { frpConfigured: false, frpAccountsCount: 0, provisioningReady: true } };

  it('tells staff to ask the owner, without a Settings button', async () => {
    open('DEALER_STAFF', off);

    expect(await screen.findByText('Factory Reset Protection is off for this shop')).toBeInTheDocument();
    expect(screen.getByText(/^Ask the shop owner to add at least one Google Account ID/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).not.toBeInTheDocument();
  });

  it('sends the owner to Settings', async () => {
    open('DEALER_ADMIN', off);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Settings' }));

    expect(await screen.findByText('Went to /settings')).toBeInTheDocument();
  });

  it('is absent when the shop has an account on file', async () => {
    open('DEALER_ADMIN');
    await screen.findByText('Samsung Galaxy A15');

    expect(screen.queryByText('Factory Reset Protection is off for this shop')).not.toBeInTheDocument();
  });
});
