import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { BuyLocksPage } from './BuyLocksPage.js';
import { mockApi, renderPage, fail } from '../test/harness.js';
import { toRomanUrdu, toUrdu } from '../i18n/translate.js';

const order = (over: Record<string, unknown> = {}) => ({
  id: 'lord-1', dealerId: 'dealer-1', dealerName: 'Shop', dealerCity: 'Lahore', dealerPhone: '', ownerName: 'Tariq',
  size: 30, unitPrice: 800, totalPrice: 24000, status: 'PENDING', paymentMethod: 'JAZZCASH', transactionId: 'JC-111',
  amountPaid: 24000, hasProof: true, note: '', submittedByName: 'Tariq', createdAt: '2026-11-20T10:00:00Z', ...over,
});
const list = (orders: unknown[]) => ({ orders, paymentInstructions: 'JazzCash 0300', maxPendingOrders: 3 });

function open(orders: unknown[], routes = {}) {
  const api = mockApi({ role: 'DEALER_ADMIN', routes: { 'GET /lock-orders': list(orders), ...routes } });
  renderPage(<BuyLocksPage />);
  return api;
}

describe('changing a pending lock order', () => {
  it('loads the order into the form and sends only a PATCH with the corrected size and ID', async () => {
    const api = open([order()], { 'PATCH /lock-orders/lord-1': { order: order({ size: 5 }), message: 'Order updated.' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Change order of 30 locks' }));

    expect(screen.getByRole('status')).toHaveTextContent('Changing your order of 30 locks (TID JC-111)');
    expect(screen.getByLabelText('Transaction ID (TID)')).toHaveValue('JC-111');
    expect(screen.getByLabelText('Amount sent (Rs)')).toHaveValue(24000);
    expect(screen.getByText('Replace screenshot')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Number of locks'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Amount sent (Rs)'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Transaction ID (TID)'), { target: { value: 'JC-222' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));

    await waitFor(() => expect(api.to('PATCH /lock-orders/lord-1')).toHaveLength(1));
    expect(api.to('PATCH /lock-orders/lord-1')[0].body).toMatchObject({ size: 5, amountPaid: 5000, transactionId: 'JC-222', paymentMethod: 'JAZZCASH' });
    // No new screenshot was attached, so the one on file stays.
    expect(api.to('PATCH /lock-orders/lord-1')[0].body.proofImage).toBeUndefined();
    expect(api.to('POST /lock-orders')).toHaveLength(0);
    await waitFor(() => expect(screen.queryByText(/Changing your order of/)).not.toBeInTheDocument());
  });

  it('lets the owner stop changing and go back to a new order', async () => {
    open([order()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Change order of 30 locks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop changing' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Transaction ID (TID)')).toHaveValue('');
    expect(screen.getByRole('button', { name: /Send order/ })).toBeInTheDocument();
  });

  it('can correct an order even when the shop is at its pending-order limit', async () => {
    const three = [order(), order({ id: 'lord-2', transactionId: 'JC-2' }), order({ id: 'lord-3', transactionId: 'JC-3' })];
    open(three);
    await screen.findAllByRole('button', { name: 'Change order of 30 locks' });
    expect(screen.getByRole('button', { name: /Send order/ })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Change order of 30 locks' })[0]);
    expect(screen.getByRole('button', { name: /Save changes/ })).toBeEnabled();
  });

  it('shows the server\'s refusal, such as a transaction ID already used', async () => {
    open([order()], { 'PATCH /lock-orders/lord-1': fail(409, 'This transaction ID has already been used for a lock order.') });
    fireEvent.click(await screen.findByRole('button', { name: 'Change order of 30 locks' }));
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already been used');
  });

  it('offers Change order only on orders still waiting', async () => {
    open([order({ id: 'a', status: 'APPROVED' }), order({ id: 'r', status: 'REJECTED', rejectionReason: 'No money' })]);
    const rows = await screen.findAllByRole('listitem');
    for (const row of rows) expect(within(row).queryByRole('button', { name: /Change order/ })).not.toBeInTheDocument();
  });

  it('has the new labels in Roman Urdu and Urdu', () => {
    for (const label of ['Change order', 'Stop changing', 'Replace screenshot', 'Order updated.', 'Changing your order of 30 locks (TID JC-111)', 'Change order of 5 locks']) {
      expect(toRomanUrdu(label), label).not.toBe(label);
      expect(toUrdu(label).replace(/JC-111|TID/g, ''), label).not.toMatch(/[A-Za-z]{3,}/);
    }
  });
});
