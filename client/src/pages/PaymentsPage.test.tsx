import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';

import { PaymentsPage } from './PaymentsPage.js';
import { mockApi, renderPage, fill, fail, paged } from '../test/harness.js';
import type { UserRole } from '../types/index.js';

/**
 * Taking, confirming and reversing money.
 *
 * Verifying applies a payment to the plan and can unlock a phone; reversing
 * takes it back off. Both belong to the shop owner. Counter staff record what
 * they are handed, and a customer can only report a transfer for the shop to
 * check.
 */

const VERIFIED = {
  id: 'pay-1',
  referenceNumber: 'JAZ-100001',
  customerName: 'Muhammad Aslam',
  customerPhone: '0300-1234567',
  amount: 7500,
  paymentMethod: 'JAZZCASH',
  status: 'VERIFIED',
  createdAt: '2026-10-05T09:30:00Z',
};

const PENDING = {
  id: 'pay-2',
  referenceNumber: 'EAS-200002',
  customerName: 'Sana Tariq',
  customerPhone: '0321-7654321',
  amount: 6000,
  paymentMethod: 'EASYPAISA',
  status: 'PENDING',
  createdAt: '2026-10-06T11:00:00Z',
};

/** As the server stores a reversal: status REFUNDED with the reversal stamped on it. */
const REVERSED = {
  id: 'pay-3',
  referenceNumber: 'CAS-300003',
  customerName: 'Bilal Ahmed',
  customerPhone: '0333-1112223',
  amount: 5000,
  paymentMethod: 'CASH',
  status: 'REFUNDED',
  reversedAt: '2026-10-07T08:00:00Z',
  reversalReason: 'Cheque returned unpaid',
  createdAt: '2026-10-04T10:00:00Z',
};

const CUSTOMERS = [
  { id: 'cust-1', name: 'Muhammad Aslam', phone: '0300-1234567', outstandingBalance: 33750 },
  { id: 'cust-2', name: 'Sana Tariq', phone: '0321-7654321', outstandingBalance: 12000 },
];

const CLAIM = {
  id: 'pay-9',
  referenceNumber: 'TID-88442211',
  customerName: 'Sana Tariq',
  customerPhone: '0321-7654321',
  amount: 6000,
  paymentMethod: 'EASYPAISA',
  status: 'PENDING',
  source: 'CUSTOMER',
  notes: 'Sent from my brother’s account',
  createdAt: '2026-10-06T22:10:00Z',
};

function open(role: UserRole, routes: Record<string, unknown> = {}) {
  const api = mockApi({
    role,
    routes: {
      'GET /payments': paged([VERIFIED, PENDING], { totals: { verifiedAmount: 7500, pendingAmount: 6000, count: 2 } }),
      'GET /customers': paged(CUSTOMERS),
      'GET /payments/pending-submissions': { data: [], count: 0 },
      ...routes,
    },
  });
  renderPage(<PaymentsPage />, { path: '/payments' });
  return api;
}

const row = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('recording a payment at the counter', () => {
  it('sends the chosen customer, amount and method, then refreshes the list', async () => {
    const api = open('DEALER_STAFF', { 'POST /payments': { message: 'Rs. 6,750 received from Sana Tariq.' } });
    await screen.findByText('JAZ-100001');
    const loadsBefore = api.to('GET /payments').length;

    fireEvent.click(screen.getByRole('button', { name: /Record Installment Payment/ }));
    const form = screen.getByRole('button', { name: 'Record & Verify' }).closest('form') as HTMLElement;
    const [customer, method] = within(form).getAllByRole('combobox');
    // The outstanding balance is beside each name, so the right person is picked.
    expect(within(customer).getByRole('option', { name: /Sana Tariq.*Outstanding: Rs\. 12,000/ })).toBeInTheDocument();
    fireEvent.change(customer, { target: { value: 'cust-2' } });
    fill(within(form).getByRole('spinbutton'), '6750');
    fireEvent.change(method, { target: { value: 'CASH' } });
    fill(within(form).getByPlaceholderText('e.g. Received by counter staff'), 'Paid at counter');

    fireEvent.click(screen.getByRole('button', { name: 'Record & Verify' }));

    expect(await screen.findByText('Rs. 6,750 received from Sana Tariq.')).toBeInTheDocument();
    const sent = api.to('POST /payments')[0].body;
    expect(sent).toMatchObject({
      customerId: 'cust-2',
      amount: 6750,
      paymentMethod: 'CASH',
      notes: 'Paid at counter',
      autoVerify: true,
    });
    expect(sent.referenceNumber).toMatch(/^CAS-\d{6}$/);
    // The dialog closes and the table is fetched again.
    expect(screen.queryByRole('button', { name: 'Record & Verify' })).not.toBeInTheDocument();
    await waitFor(() => expect(api.to('GET /payments').length).toBeGreaterThan(loadsBefore));
  });

  it('keeps the form open and shows the reason when the server refuses', async () => {
    open('DEALER_ADMIN', { 'POST /payments': fail(400, 'This customer has no active installment plan.') });
    await screen.findByText('JAZ-100001');

    fireEvent.click(screen.getByRole('button', { name: /Record Installment Payment/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Record & Verify' }));

    expect(await screen.findByText('This customer has no active installment plan.')).toBeInTheDocument();
    // Nothing typed is lost, and the button works again.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record & Verify' })).toBeEnabled());
  });

  it('does not send anything when the dialog is cancelled', async () => {
    const api = open('DEALER_STAFF');
    await screen.findByText('JAZ-100001');

    fireEvent.click(screen.getByRole('button', { name: /Record Installment Payment/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('button', { name: 'Record & Verify' })).not.toBeInTheDocument();
    expect(api.to('POST /payments')).toHaveLength(0);
  });
});

describe('verifying a payment', () => {
  it('lets the owner verify a pending payment', async () => {
    const api = open('DEALER_ADMIN', { 'POST /payments/pay-2/verify': { message: 'Payment verified. Device unlocked.' } });
    await screen.findByText('EAS-200002');

    expect(within(row('EAS-200002')).getByText('Pending Verification')).toBeInTheDocument();
    fireEvent.click(within(row('EAS-200002')).getByRole('button', { name: 'Verify Payment' }));

    expect(await screen.findByText('Payment verified. Device unlocked.')).toBeInTheDocument();
    expect(api.to('POST /payments/pay-2/verify')).toHaveLength(1);
    // A payment that is already verified offers a receipt, not another verify.
    expect(within(row('JAZ-100001')).queryByRole('button', { name: 'Verify Payment' })).not.toBeInTheDocument();
  });

  it('shows the server message when verification fails', async () => {
    open('DEALER_ADMIN', { 'POST /payments/pay-2/verify': fail(400, 'This payment has already been verified.') });
    await screen.findByText('EAS-200002');

    fireEvent.click(within(row('EAS-200002')).getByRole('button', { name: 'Verify Payment' }));

    expect(await screen.findByText('This payment has already been verified.')).toBeInTheDocument();
  });

  it('gives counter staff no way to verify or reverse', async () => {
    open('DEALER_STAFF');
    await screen.findByText('EAS-200002');

    expect(within(row('EAS-200002')).getByText('Awaiting owner')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify Payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
    // Staff can still take money and hand over a receipt.
    expect(screen.getByRole('button', { name: /Record Installment Payment/ })).toBeInTheDocument();
    expect(within(row('JAZ-100001')).getByRole('button', { name: 'Receipt' })).toBeInTheDocument();
  });
});

describe('reversing a payment', () => {
  it('needs a real reason before the owner can confirm, then sends it', async () => {
    const api = open('DEALER_ADMIN', { 'POST /payments/pay-1/reverse': { message: 'Payment reversed. Balance restored.' } });
    await screen.findByText('JAZ-100001');

    fireEvent.click(within(row('JAZ-100001')).getByRole('button', { name: 'Reverse' }));

    // The dialog says whose money and how much.
    expect(screen.getByText('Reverse this payment?')).toBeInTheDocument();
    const dialogText = screen.getByText(/will be taken back off the plan/);
    expect(dialogText).toHaveTextContent('Rs. 7,500 from Muhammad Aslam');

    const confirm = screen.getByRole('button', { name: 'Confirm Reversal' });
    const reason = screen.getByPlaceholderText(/Cheque returned unpaid/);
    expect(confirm).toBeDisabled();
    fill(reason, 'too short');
    expect(confirm).toBeDisabled();
    fill(reason, 'Cheque returned unpaid by the bank');
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);

    expect(await screen.findByText('Payment reversed. Balance restored.')).toBeInTheDocument();
    expect(api.to('POST /payments/pay-1/reverse')[0].body).toEqual({ reason: 'Cheque returned unpaid by the bank' });
    expect(screen.queryByText('Reverse this payment?')).not.toBeInTheDocument();
  });

  it('reverses nothing when the owner cancels', async () => {
    const api = open('DEALER_ADMIN');
    await screen.findByText('JAZ-100001');

    fireEvent.click(within(row('JAZ-100001')).getByRole('button', { name: 'Reverse' }));
    fill(screen.getByPlaceholderText(/Cheque returned unpaid/), 'Entered against the wrong customer');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Reverse this payment?')).not.toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('keeps the dialog open when the server refuses the reversal', async () => {
    open('DEALER_ADMIN', { 'POST /payments/pay-1/reverse': fail(400, 'This payment has already been reversed.') });
    await screen.findByText('JAZ-100001');

    fireEvent.click(within(row('JAZ-100001')).getByRole('button', { name: 'Reverse' }));
    fill(screen.getByPlaceholderText(/Cheque returned unpaid/), 'Entered against the wrong customer');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reversal' }));

    expect(await screen.findByText('This payment has already been reversed.')).toBeInTheDocument();
    expect(screen.getByText('Reverse this payment?')).toBeInTheDocument();
  });

  it('shows a reversed payment as reversed — not as waiting to be verified', async () => {
    open('DEALER_ADMIN', {
      'GET /payments': paged([REVERSED], { totals: { verifiedAmount: 0, pendingAmount: 0, count: 1 } }),
    });
    await screen.findByText('CAS-300003');
    const reversed = within(row('CAS-300003'));

    expect(reversed.getAllByText('Reversed').length).toBeGreaterThan(0);
    expect(reversed.queryByText('Pending Verification')).not.toBeInTheDocument();
    // It cannot be verified or reversed a second time, but its receipt is still on file.
    expect(reversed.queryByRole('button', { name: 'Verify Payment' })).not.toBeInTheDocument();
    expect(reversed.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
    expect(reversed.getByRole('button', { name: 'Receipt' })).toBeInTheDocument();
  });

  it('does not tell staff a reversed payment is awaiting the owner', async () => {
    open('DEALER_STAFF', {
      'GET /payments': paged([REVERSED], { totals: { verifiedAmount: 0, pendingAmount: 0, count: 1 } }),
    });
    await screen.findByText('CAS-300003');

    expect(within(row('CAS-300003')).queryByText('Awaiting owner')).not.toBeInTheDocument();
    expect(within(row('CAS-300003')).getAllByText('Reversed').length).toBeGreaterThan(0);
  });
});

describe('the receipt', () => {
  const RECEIPT = {
    receiptNumber: 'RCPT-2026-0042',
    issuedAt: '2026-10-05T09:30:00Z',
    status: 'VERIFIED',
    dealer: { name: 'Al-Madina Mobile Hub', phone: '0300-8451299' },
    customer: { name: 'Muhammad Aslam', phone: '0300-1234567' },
    device: { brand: 'Samsung', model: 'Galaxy A15' },
    payment: { method: 'JAZZCASH', reference: 'JAZ-100001', amount: 7500, lateFeePortion: 500, principalPortion: 7000 },
    plan: {
      totalAmount: 54000,
      downPayment: 13500,
      monthlyInstallment: 6750,
      paidInstallments: 2,
      totalInstallments: 6,
      remainingBalance: 27000,
      outstandingLateFees: 0,
      creditBalance: 0,
    },
  };

  it('shows what was paid, how it was split and what is still owed', async () => {
    open('DEALER_STAFF', { 'GET /payments/pay-1/receipt': RECEIPT });
    await screen.findByText('JAZ-100001');

    fireEvent.click(within(row('JAZ-100001')).getByRole('button', { name: 'Receipt' }));

    const receipt = within(await screen.findByRole('dialog', { name: 'Payment receipt' }));
    expect(await receipt.findByText('No. RCPT-2026-0042')).toBeInTheDocument();
    expect(receipt.getByText('Rs. 7,500')).toBeInTheDocument();
    expect(receipt.getByText('Rs. 7,000')).toBeInTheDocument(); // towards principal
    expect(receipt.getByText('Rs. 500')).toBeInTheDocument(); // towards late fee
    expect(receipt.getByText('2 of 6')).toBeInTheDocument();
    expect(receipt.getByText('Rs. 27,000')).toBeInTheDocument();
    expect(receipt.queryByText(/Reversed — not valid/)).not.toBeInTheDocument();

    fireEvent.click(receipt.getByRole('button', { name: 'Close receipt' }));
    expect(screen.queryByRole('dialog', { name: 'Payment receipt' })).not.toBeInTheDocument();
  });

  it('stamps the receipt of a reversed payment as not valid', async () => {
    open('DEALER_STAFF', {
      'GET /payments/pay-1/receipt': {
        ...RECEIPT,
        status: 'REVERSED',
        reversal: { reversedAt: '2026-10-07T08:00:00Z', reason: 'Cheque returned unpaid' },
      },
    });
    await screen.findByText('JAZ-100001');

    fireEvent.click(within(row('JAZ-100001')).getByRole('button', { name: 'Receipt' }));

    expect(await screen.findByText(/Reversed — not valid/)).toBeInTheDocument();
    expect(screen.getByText(/Cheque returned unpaid/)).toBeInTheDocument();
  });

  it('says so when the receipt cannot be loaded, and does not offer to print nothing', async () => {
    open('DEALER_STAFF', { 'GET /payments/pay-1/receipt': fail(404, 'Receipt not found.') });
    await screen.findByText('JAZ-100001');

    fireEvent.click(within(row('JAZ-100001')).getByRole('button', { name: 'Receipt' }));

    expect(await screen.findByText('Receipt not found.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print/ })).toBeDisabled();
  });
});

describe('transfers customers say they have sent', () => {
  it('lets the owner confirm one, which applies it and clears it from the queue', async () => {
    const api = open('DEALER_ADMIN', {
      'GET /payments/pending-submissions': { data: [CLAIM], count: 1 },
      'POST /payments/pay-9/verify': { message: 'Rs. 6,000 applied. Phone unlocked.' },
    });

    expect(await screen.findByText('1 payment customers say they have sent')).toBeInTheDocument();
    // Enough to check it against the shop's own account.
    expect(screen.getByText('TID TID-88442211')).toBeInTheDocument();
    expect(screen.getByText(/Sana Tariq · 0321-7654321/)).toBeInTheDocument();
    expect(screen.getByText(/Check each transaction ID against your own account/)).toBeInTheDocument();

    api.on('GET /payments/pending-submissions', { data: [], count: 0 });
    fireEvent.click(screen.getByRole('button', { name: /Confirm received/ }));

    expect(await screen.findByText('Rs. 6,000 applied. Phone unlocked.')).toBeInTheDocument();
    expect(api.to('POST /payments/pay-9/verify')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText(/customers say they have sent/)).not.toBeInTheDocument());
  });

  it('leaves the claim in the queue when confirming fails', async () => {
    open('DEALER_ADMIN', {
      'GET /payments/pending-submissions': { data: [CLAIM], count: 1 },
      'POST /payments/pay-9/verify': fail(400, 'This payment has been reversed and cannot be verified.'),
    });

    fireEvent.click(await screen.findByRole('button', { name: /Confirm received/ }));

    expect(await screen.findByText('This payment has been reversed and cannot be verified.')).toBeInTheDocument();
    expect(screen.getByText('TID TID-88442211')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Confirm received/ })).toBeEnabled());
  });

  it('shows staff the queue but only the owner may confirm', async () => {
    open('DEALER_STAFF', { 'GET /payments/pending-submissions': { data: [CLAIM], count: 1 } });

    expect(await screen.findByText('TID TID-88442211')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm received/ })).not.toBeInTheDocument();
  });
});

describe('a customer on the payments page', () => {
  const PLAN = { id: 'plan-1', status: 'OVERDUE', remainingBalance: 27000 };

  function openAsCustomer(routes: Record<string, unknown> = {}) {
    return open('CUSTOMER', {
      'GET /payments': paged([VERIFIED], { totals: { verifiedAmount: 7500, pendingAmount: 0, count: 1 } }),
      'GET /customers/cust-1': { id: 'cust-1', plans: [PLAN, { id: 'plan-0', status: 'COMPLETED', remainingBalance: 0 }] },
      ...routes,
    });
  }

  it('can report a transfer, which goes to the shop unverified', async () => {
    const api = openAsCustomer({ 'POST /payments/submit': { success: true } });
    await screen.findByText('Already paid? Tell the shop');
    // Honest about what the form does.
    expect(screen.getByText(/this form does not unlock it by itself/)).toBeInTheDocument();

    const send = screen.getByRole('button', { name: 'Send to the shop' });
    expect(send).toBeDisabled();
    fill(screen.getByPlaceholderText('7500'), '6750');
    fill(screen.getByPlaceholderText(/reference number from your transfer receipt/), 'AB1');
    expect(send).toBeDisabled(); // a three-character TID is not a TID
    fill(screen.getByPlaceholderText(/reference number from your transfer receipt/), '  TID-55667788 ');
    expect(send).toBeEnabled();

    fireEvent.click(send);

    expect(await screen.findByText(/Sent to the shop\. They will confirm it/)).toBeInTheDocument();
    expect(api.to('POST /payments/submit')[0].body).toEqual({
      planId: 'plan-1', // the only plan still open
      amount: 6750,
      paymentMethod: 'JAZZCASH',
      referenceNumber: 'TID-55667788',
    });
    // The form is cleared so the same transfer is not sent twice.
    await waitFor(() => expect(screen.getByPlaceholderText('7500')).toHaveValue(null));
  });

  it('shows a transfer already reported as waiting for the shop', async () => {
    openAsCustomer({
      'GET /payments': (req: { query: URLSearchParams }) =>
        req.query.get('status') === 'PENDING'
          ? paged([CLAIM, { ...PENDING, source: 'COUNTER' }])
          : paged([VERIFIED], { totals: { verifiedAmount: 7500, pendingAmount: 0, count: 1 } }),
    });

    expect(await screen.findByText(/Rs\. 6,000 · TID-88442211 — waiting for the shop to check/)).toBeInTheDocument();
  });

  it('keeps what was typed when the shop cannot be reached', async () => {
    openAsCustomer({ 'POST /payments/submit': fail(409, 'This transaction ID has already been reported.') });
    await screen.findByText('Already paid? Tell the shop');
    fill(screen.getByPlaceholderText('7500'), '6750');
    fill(screen.getByPlaceholderText(/reference number from your transfer receipt/), 'TID-55667788');

    fireEvent.click(screen.getByRole('button', { name: 'Send to the shop' }));

    expect(await screen.findByText('This transaction ID has already been reported.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('7500')).toHaveValue(6750);
  });

  it('has none of the shop-side controls', async () => {
    const api = openAsCustomer({
      'GET /payments': paged([VERIFIED, PENDING], { totals: { verifiedAmount: 7500, pendingAmount: 6000, count: 2 } }),
    });
    await screen.findByText('JAZ-100001');

    expect(screen.queryByRole('button', { name: /Record Installment Payment/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify Payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
    // The shop's verification queue is never even asked for.
    expect(api.to('GET /payments/pending-submissions')).toHaveLength(0);
    // Their own receipt is theirs to see.
    expect(within(row('JAZ-100001')).getByRole('button', { name: 'Receipt' })).toBeInTheDocument();
  });

  it('offers no report form to a customer whose plans are all finished', async () => {
    openAsCustomer({
      'GET /customers/cust-1': { id: 'cust-1', plans: [{ id: 'plan-0', status: 'COMPLETED', remainingBalance: 0 }] },
    });
    await screen.findByText('JAZ-100001');

    expect(screen.queryByText('Already paid? Tell the shop')).not.toBeInTheDocument();
  });
});
