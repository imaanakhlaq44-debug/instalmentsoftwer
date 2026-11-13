import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { NotificationsPage } from './NotificationsPage.js';
import { mockApi, renderPage, fill, fail, paged } from '../test/harness.js';
import type { UserRole } from '../types/index.js';

/**
 * Reminders and alerts. The page must say plainly whether messages are really
 * leaving the shop, and only the shop's people may pair a phone to send them.
 */

const MESSAGES = [
  {
    id: 'n-1',
    type: 'PAYMENT_OVERDUE',
    title: 'Payment overdue',
    message: 'Your instalment of Rs 7,000 is late.',
    customerId: 'cust-1',
    customerName: 'Imran Qureshi',
    deviceModel: 'Infinix Hot 40',
    channel: 'SMS',
    status: 'SENT',
    createdAt: '2026-11-12T09:00:00Z',
  },
];

const listing = (extra: Record<string, unknown> = {}) =>
  paged(MESSAGES, {
    counts: { queued: 0, sent: 1, failed: 0 },
    deliveryEnabled: true,
    deliveryNote: '',
    smsChannel: 'PHONE',
    relays: [{ id: 'relay-1', name: 'Counter phone', online: true, sentCount: 12, failedCount: 1, lastSeenAt: '2026-11-12T08:00:00Z' }],
    ...extra,
  });

const TEMPLATES = [{ id: 't-1', name: 'Due reminder', bodyTemplate: 'Salam {name}, your instalment is due.' }];

function open(role: UserRole = 'DEALER_ADMIN', routes: Record<string, unknown> = {}) {
  const api = mockApi({
    role,
    routes: { 'GET /notifications': listing(), 'GET /notifications/templates': TEMPLATES, ...routes },
  });
  renderPage(<NotificationsPage />, { path: '/notifications' });
  return api;
}

const loaded = () => screen.findByText('Your instalment of Rs 7,000 is late.');

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('whether messages are leaving', () => {
  it('says a paired phone is sending when one is', async () => {
    open();
    await loaded();

    expect(screen.getByText('A paired phone is sending these messages')).toBeInTheDocument();
    expect(screen.queryByText('Messages are not being delivered yet')).not.toBeInTheDocument();
  });

  it('warns, with the server’s reason, when nothing is sending', async () => {
    open('DEALER_ADMIN', {
      'GET /notifications': listing({ deliveryEnabled: false, deliveryNote: 'No phone has checked in for 3 days.', relays: [] }),
    });
    await loaded();

    expect(screen.getByText('Messages are not being delivered yet')).toBeInTheDocument();
    expect(screen.getByText('No phone has checked in for 3 days.')).toBeInTheDocument();
    expect(screen.queryByText('A paired phone is sending these messages')).not.toBeInTheDocument();
  });

  it('names the gateway sender when the shop sends through the gateway', async () => {
    open('DEALER_ADMIN', {
      'GET /notifications': listing({ smsChannel: 'AGGREGATOR', aggregator: { configured: true, senderMask: 'ALMADINA' } }),
    });
    await loaded();

    expect(screen.getByText('The SMS gateway is sending these messages')).toBeInTheDocument();
    expect(screen.getByText('ALMADINA')).toBeInTheDocument();
  });
});

describe('the message list', () => {
  it('shows each message with its customer and templates beside it', async () => {
    open();
    await loaded();

    expect(screen.getByText(/Customer: Imran Qureshi · Infinix Hot 40/)).toBeInTheDocument();
    expect(screen.getByText('Salam {name}, your instalment is due.')).toBeInTheDocument();
  });

  it('asks for the page the owner is on', async () => {
    const api = open();
    await loaded();

    const req = api.to('GET /notifications')[0];
    expect(req.query.get('page')).toBe('1');
  });

  it('says so when nothing has been sent', async () => {
    open('DEALER_ADMIN', { 'GET /notifications': { ...listing(), data: [] } });

    expect(await screen.findByText('No notifications dispatched yet.')).toBeInTheDocument();
  });

  it('shows the server’s refusal when the list cannot load', async () => {
    open('DEALER_ADMIN', { 'GET /notifications': fail(500, 'Database unavailable') });

    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
  });
});

describe('pairing a phone', () => {
  it('pairs a named phone and shows the code once', async () => {
    const api = open('DEALER_STAFF', {
      'POST /notifications/relays': { success: true, pairingCode: 'relay-2.secret-token' },
    });
    await loaded();

    const pair = screen.getByRole('button', { name: 'Pair' });
    expect(pair).toBeDisabled();
    fill(screen.getByPlaceholderText('Counter phone'), '  Back office  ');
    fireEvent.click(pair);

    expect(await screen.findByText('relay-2.secret-token')).toBeInTheDocument();
    expect(api.to('POST /notifications/relays')[0].body).toEqual({ dealerId: 'dealer-1', name: 'Back office' });

    fireEvent.click(screen.getByRole('button', { name: 'I have entered it' }));
    expect(screen.queryByText('relay-2.secret-token')).not.toBeInTheDocument();
  });

  it('unpairs a phone', async () => {
    const api = open('DEALER_ADMIN', { 'POST /notifications/relays/relay-1/revoke': { success: true } });
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Unpair' }));

    expect(await screen.findByText('"Counter phone" can no longer collect messages.')).toBeInTheDocument();
    expect(api.to('POST /notifications/relays/relay-1/revoke')).toHaveLength(1);
  });

  it('shows the server’s reason when pairing is refused', async () => {
    open('DEALER_ADMIN', { 'POST /notifications/relays': fail(400, 'Give the phone a name.') });
    await loaded();

    fill(screen.getByPlaceholderText('Counter phone'), 'Counter');
    fireEvent.click(screen.getByRole('button', { name: 'Pair' }));

    expect(await screen.findByText('Give the phone a name.')).toBeInTheDocument();
  });

  it('is not offered to a customer, whom the server would refuse', async () => {
    open('CUSTOMER');
    await loaded();

    expect(screen.queryByPlaceholderText('Counter phone')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pair' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unpair' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Counter phone')).not.toBeInTheDocument());
  });
});
