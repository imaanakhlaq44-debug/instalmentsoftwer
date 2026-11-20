import { describe, it, expect } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { StaffPage, makeTempPassword } from './StaffPage.js';
import { mockApi, renderPage, fill, type MockRequest } from '../test/harness.js';
import { navItemsForRole } from '../components/layout/navItems.js';

/**
 * The owner's Staff section: add someone, choose counter staff or view only,
 * change it later, or switch them off.
 */

const TEAM = [
  { id: 'user-1', name: 'Test User', email: 'test@almassdm.pk', phone: '03001234567', role: 'DEALER_ADMIN', active: true },
  { id: 'u-staff', name: 'Usman Ali', email: 'usman@shop.pk', phone: '03047766554', role: 'DEALER_STAFF', active: true, lastLoginAt: '2026-11-20T10:00:00Z' },
  { id: 'u-cust', name: 'A Customer', email: 'c@x.pk', phone: '03000000000', role: 'CUSTOMER', active: true },
];

describe('StaffPage', () => {
  it('lists the team without customer logins', async () => {
    mockApi({ role: 'DEALER_ADMIN', routes: { 'GET /users': TEAM } });
    renderPage(<StaffPage />, { path: '/staff' });
    expect(await screen.findByText('Usman Ali')).toBeInTheDocument();
    expect(screen.queryByText('A Customer')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('staff-row')).toHaveLength(2);
  });

  it('adds a view-only staff member and shows the password once', async () => {
    const api = mockApi({
      role: 'DEALER_ADMIN',
      routes: { 'GET /users': TEAM, 'POST /users': (r: MockRequest) => ({ id: 'u-new', ...r.body }) },
    });
    renderPage(<StaffPage />, { path: '/staff' });
    await screen.findByText('Usman Ali');

    fireEvent.click(screen.getByRole('button', { name: /add staff/i }));
    fill(screen.getByLabelText('Name'), 'Bilal Recovery');
    fill(screen.getByLabelText('Mobile number'), '0301-2345678');
    fill(screen.getByLabelText(/email/i), 'bilal@shop.pk');
    expect(screen.getByRole('radio', { name: /view only/i })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /add and make a password/i }));

    await waitFor(() => expect(api.to('POST /users')).toHaveLength(1));
    const sent = api.to('POST /users')[0].body;
    expect(sent.role).toBe('DEALER_VIEWER');
    expect(sent.email).toBe('bilal@shop.pk');
    expect((await screen.findByTestId('temp-password')).textContent).toBe(sent.password);
  });

  it('switches counter staff to view only', async () => {
    const api = mockApi({
      role: 'DEALER_ADMIN',
      routes: { 'GET /users': TEAM, 'PATCH /users/u-staff': { ok: true } },
    });
    renderPage(<StaffPage />, { path: '/staff' });
    fireEvent.change(await screen.findByLabelText('What Usman Ali may do'), { target: { value: 'DEALER_VIEWER' } });
    await waitFor(() => expect(api.to('PATCH /users/u-staff')[0]?.body).toEqual({ role: 'DEALER_VIEWER' }));
  });
});

describe('temporary password', () => {
  it('has letters and digits, as the server requires', () => {
    for (let i = 0; i < 20; i++) {
      const p = makeTempPassword();
      expect(p).toMatch(/^(?=.*[A-Za-z])(?=.*\d).{9}$/);
    }
  });
});

describe('view-only staff menu', () => {
  it('shows records but no admin or counter pages', () => {
    const links = navItemsForRole('DEALER_VIEWER').map((i) => i.to);
    expect(links).toEqual(expect.arrayContaining(['/', '/devices', '/customers', '/installments', '/payments']));
    for (const hidden of ['/staff', '/settings', '/enrollment', '/licenses', '/audit-logs', '/handset-tests']) {
      expect(links).not.toContain(hidden);
    }
    expect(navItemsForRole('DEALER_ADMIN').map((i) => i.to)).toContain('/staff');
    expect(navItemsForRole('DEALER_STAFF').map((i) => i.to)).not.toContain('/staff');
  });
});
