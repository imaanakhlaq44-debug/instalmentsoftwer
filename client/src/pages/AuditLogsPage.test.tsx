import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { AuditLogsPage } from './AuditLogsPage.js';
import { mockApi, renderPage, fill, fail, paged } from '../test/harness.js';

/**
 * The activity log: who locked, took money or changed a setting, and when.
 * The filters decide what the owner sees and what goes into the export.
 */

const LOGS = [
  {
    id: 'log-1',
    createdAt: '2026-11-12T09:30:00Z',
    actorName: 'Kashif Ali',
    actorRole: 'DEALER_ADMIN',
    action: 'DEVICE_LOCKED',
    targetType: 'DEVICE',
    targetId: 'dev-1',
    details: 'Locked Infinix Hot 40 for non-payment',
    ipAddress: '39.45.1.2',
  },
];

function open(routes: Record<string, unknown> = {}) {
  const api = mockApi({ role: 'DEALER_ADMIN', routes: { 'GET /audit-logs': paged(LOGS, { facets: {} }), ...routes } });
  renderPage(<AuditLogsPage />, { path: '/audit-logs' });
  return api;
}

const loaded = () => screen.findByText('Locked Infinix Hot 40 for non-payment');

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('the log', () => {
  it('shows who did what, to what', async () => {
    open();
    await loaded();

    expect(screen.getByText('Kashif Ali')).toBeInTheDocument();
    expect(screen.getByText('DEVICE LOCKED')).toBeInTheDocument();
    expect(screen.getByText('39.45.1.2')).toBeInTheDocument();
  });

  it('filters by target type, and ALL sends no filter', async () => {
    const api = open();
    await loaded();
    expect(api.to('GET /audit-logs')[0].query.has('targetType')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'PAYMENT' }));

    await waitFor(() => expect(api.to('GET /audit-logs').at(-1)!.query.get('targetType')).toBe('PAYMENT'));
    expect(api.to('GET /audit-logs').at(-1)!.query.get('page')).toBe('1');
  });

  it('searches for what the owner typed', async () => {
    const api = open();
    await loaded();

    const box = screen.getByPlaceholderText('Search action or actor...');
    fill(box, 'Kashif');
    fireEvent.submit(box.closest('form')!);

    await waitFor(() => expect(api.to('GET /audit-logs').at(-1)!.query.get('search')).toBe('Kashif'));
  });

  it('says so when nothing matches', async () => {
    open({ 'GET /audit-logs': paged([], { facets: {} }) });

    expect(await screen.findByText('No matching audit logs found.')).toBeInTheDocument();
  });

  it('shows the server’s refusal when the log cannot load', async () => {
    open({ 'GET /audit-logs': fail(403, 'Only the shop owner may read the activity log.') });

    expect(await screen.findByText('Only the shop owner may read the activity log.')).toBeInTheDocument();
  });
});

describe('CSV export', () => {
  it('exports with the same filter as the screen', async () => {
    const api = open();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'DEVICE' }));
    await waitFor(() => expect(api.to('GET /audit-logs').at(-1)!.query.get('targetType')).toBe('DEVICE'));
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));

    expect(await screen.findByText('Exported 1 row(s) to CSV.')).toBeInTheDocument();
    const exported = api.to('GET /audit-logs').filter((c) => c.query.get('limit') === '200');
    expect(exported).toHaveLength(1);
    expect(exported[0].query.get('targetType')).toBe('DEVICE');
  });
});
