import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { AppTopBar } from './AppTopBar.js';
import { mockApi, renderPage } from '../../test/harness.js';
afterEach(() => { vi.restoreAllMocks(); delete (window as any).AlmasDocument; });
const none = { data: [], pagination: { total: 0 } };
describe('app notification bell', () => {
  it('opens notifications when nothing waits for the owner, and exposes the settings gear', async () => {
    mockApi({ role: 'DEALER_ADMIN', routes: { 'GET /payments': none } });
    renderPage(<AppTopBar />);
    expect(await screen.findByRole('button', { name: 'App settings' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Went to /notifications')).toBeInTheDocument();
  });
  it('counts payments awaiting the owner and opens them', async () => {
    const api = mockApi({ role: 'DEALER_ADMIN', routes: { 'GET /payments': { data: [{ id: 'p1' }], pagination: { total: 1 } } } });
    renderPage(<AppTopBar />);
    await screen.findByText('1');
    expect(api.to('GET /payments')[0].query.get('status')).toBe('PENDING');
    fireEvent.click(screen.getByRole('button', { name: 'Payments awaiting approval' }));
    expect(await screen.findByText('Went to /payments?status=PENDING')).toBeInTheDocument();
  });
  it('refreshes the badge and vibrates only for a newly arrived approval', async () => {
    const postMessage = vi.fn(); (window as any).AlmasDocument = { postMessage };
    const api = mockApi({ role: 'DEALER_ADMIN', routes: { 'GET /payments': { data: [{ id: 'one' }], pagination: { total: 1 } } } });
    renderPage(<AppTopBar />); await screen.findByText('1'); expect(postMessage).not.toHaveBeenCalled();
    api.on('GET /payments', { data: [{ id: 'two' }, { id: 'one' }], pagination: { total: 2 } });
    fireEvent(window, new Event('focus')); await screen.findByText('2');
    expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ action: 'vibrate' }));
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(api.to('GET /payments').length).toBe(3));
    expect(postMessage).toHaveBeenCalledTimes(1);
  });
  it('a customer still sees their own messages', async () => {
    mockApi({ role: 'CUSTOMER', routes: { 'GET /notifications': { data: [], counts: { queued: 0 } } } });
    renderPage(<AppTopBar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Went to /notifications')).toBeInTheDocument();
  });
  it('routes the platform bell to lock orders', async () => {
    mockApi({ role: 'SUPER_ADMIN', routes: { 'GET /platform/overview': { awaitingPayment: [], totals: {} } } });
    renderPage(<AppTopBar />); fireEvent.click(await screen.findByRole('button', { name: 'Lock orders' }));
    expect(await screen.findByText('Went to /orders')).toBeInTheDocument();
  });
});
