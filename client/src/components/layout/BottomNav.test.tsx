import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { BottomNav } from './BottomNav.js';
import { mockApi, renderPage } from '../../test/harness.js';
afterEach(() => vi.restoreAllMocks());
describe('mobile access to every permitted section', () => {
  it('lets an owner reach enrollment, statements and settings through More', async () => {
    mockApi({ role: 'DEALER_ADMIN' }); renderPage(<BottomNav />);
    fireEvent.click(await screen.findByRole('button', { name: 'More' }));
    const menu = screen.getByRole('dialog', { name: 'More sections' });
    for (const name of ['QR Enrollment', 'Transactions', 'Settings', 'Installments', 'Privacy', 'Delete account']) {
      expect(within(menu).getByRole('link', { name })).toBeInTheDocument();
    }
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
  it('does not offer a customer shop-administration links', async () => {
    mockApi({ role: 'CUSTOMER' }); renderPage(<BottomNav />);
    fireEvent.click(await screen.findByRole('button', { name: 'More' }));
    const menu = screen.getByRole('dialog', { name: 'More sections' });
    expect(within(menu).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('link', { name: 'Customers' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'Payments' })).toBeInTheDocument();
  });
  it('keeps Play licensing informational while preserving operational sections', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Android AlmasSDMShop/1.0.0 (Play)');
    mockApi({ role: 'DEALER_ADMIN' }); renderPage(<BottomNav />);
    fireEvent.click(await screen.findByRole('button', { name: 'More' }));
    const menu = screen.getByRole('dialog', { name: 'More sections' });
    expect(within(menu).queryByRole('link', { name: 'Buy locks' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'Device Locks' })).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'QR Enrollment' })).toBeInTheDocument();
  });
});
