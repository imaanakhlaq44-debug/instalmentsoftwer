import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { AppTopBar } from './AppTopBar.js';
import { mockApi, renderPage } from '../../test/harness.js';
afterEach(() => { vi.restoreAllMocks(); delete (window as any).AlmasDocument; });
describe('app notification bell', () => {
  it('opens notifications and exposes the settings gear', async () => {
    mockApi({ role: 'DEALER_ADMIN', routes: { 'GET /notifications': { data: [], counts: { queued: 0 } } } });
    renderPage(<AppTopBar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Went to /notifications')).toBeInTheDocument();
  });
  it('refreshes the badge and vibrates only for a newly arrived notification', async () => {
    const postMessage = vi.fn(); (window as any).AlmasDocument = { postMessage };
    const api = mockApi({ role: 'DEALER_ADMIN', routes: { 'GET /notifications': { data: [{ id: 'one' }], counts: { queued: 1 } } } });
    renderPage(<AppTopBar />); await screen.findByText('1'); expect(postMessage).not.toHaveBeenCalled();
    api.on('GET /notifications', { data: [{ id: 'two' }, { id: 'one' }], counts: { queued: 2 } });
    fireEvent(window, new Event('focus')); await screen.findByText('2');
    expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ action: 'vibrate' }));
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(api.to('GET /notifications').length).toBe(3));
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'App settings' })).toBeInTheDocument();
  });
  it('routes the platform bell to lock orders', async () => {
    mockApi({ role: 'SUPER_ADMIN', routes: { 'GET /platform/overview': { awaitingPayment: [], totals: {} } } });
    renderPage(<AppTopBar />); fireEvent.click(await screen.findByRole('button', { name: 'Lock orders' }));
    expect(await screen.findByText('Went to /orders')).toBeInTheDocument();
  });
});

