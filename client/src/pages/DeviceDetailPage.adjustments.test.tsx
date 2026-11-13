import { describe, it, expect } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';

import { DeviceDetailPage } from './DeviceDetailPage.js';
import { mockApi, renderPage, fill, fail } from '../test/harness.js';
import type { UserRole } from '../types/index.js';

/**
 * Restructuring a plan and waiving a late fee: owner-only, a written reason
 * every time, and the server's own words when it says no.
 */

const INSTALLMENTS = [
  { id: 'inst-1', installmentNumber: 1, amountDue: 10000, amountPaid: 10000, dueDate: '2026-08-01', graceDate: '2026-08-04', status: 'PAID', lateFee: 0, lateFeePaid: 0 },
  { id: 'inst-2', installmentNumber: 2, amountDue: 10000, amountPaid: 0, dueDate: '2026-09-01', graceDate: '2026-09-04', status: 'OVERDUE', lateFee: 500, lateFeePaid: 0 },
  { id: 'inst-3', installmentNumber: 3, amountDue: 10000, amountPaid: 0, dueDate: '2026-10-01', graceDate: '2026-10-04', status: 'PENDING', lateFee: 0, lateFeePaid: 0 },
];

const DEVICE = {
  id: 'dev-1',
  dealerId: 'dealer-1',
  customerId: 'cust-1',
  brand: 'Samsung',
  model: 'Galaxy A15',
  maskedImei: '4901542••••7518',
  status: 'OVERDUE',
  isOnline: true,
  customer: { name: 'Muhammad Aslam', phone: '0300-1234567', cnic: '35202-*******-1' },
  plan: {
    id: 'plan-1',
    status: 'OVERDUE',
    totalAmount: 40000,
    downPayment: 10000,
    financedAmount: 30000,
    monthlyInstallment: 10000,
    paidInstallments: 1,
    totalInstallments: 3,
    remainingBalance: 20000,
    gracePeriodDays: 3,
  },
  installments: INSTALLMENTS,
  actionLogs: [],
};

function open(role: UserRole, routes: Record<string, unknown> = {}) {
  const api = mockApi({
    role,
    routes: {
      'GET /devices/dev-1': DEVICE,
      'GET /contracts/device/dev-1': { contract: { id: 'con-1', status: 'SIGNED', signerName: 'Muhammad Aslam' }, hashMatches: true, planMatches: true },
      ...routes,
    },
  });
  renderPage(<DeviceDetailPage />, { path: '/devices/dev-1', route: '/devices/:id' });
  return api;
}

const REASON = 'Customer lost his job, agreed to smaller payments.';

describe('who sees the adjustments', () => {
  it('offers both to the shop owner', async () => {
    open('DEALER_ADMIN');
    await screen.findByText('Installment Repayment Schedule');
    expect(screen.getByRole('button', { name: 'Restructure plan' })).toBeInTheDocument();
    // Only the row with a late fee outstanding gets the button.
    expect(screen.getAllByRole('button', { name: 'Waive late fee' })).toHaveLength(1);
  });

  it('hides both from staff', async () => {
    open('DEALER_STAFF');
    await screen.findByText('Installment Repayment Schedule');
    expect(screen.queryByRole('button', { name: 'Restructure plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Waive late fee' })).not.toBeInTheDocument();
  });
});

describe('restructuring a plan', () => {
  async function start(routes: Record<string, unknown> = {}) {
    const api = open('DEALER_ADMIN', routes);
    fireEvent.click(await screen.findByRole('button', { name: 'Restructure plan' }));
    return { api, dialog: within(screen.getByRole('dialog', { name: 'Restructure this plan' })) };
  }

  it('previews the new schedule and warns that the agreement will no longer match', async () => {
    const { dialog } = await start();

    // 30,000 financed, 10,000 paid: 20,000 left, over the 2 unpaid months by default.
    expect(dialog.getByText('Rs. 20,000')).toBeInTheDocument();
    fill(dialog.getByLabelText('Number of new months'), '3');
    fill(dialog.getByLabelText('First new due date'), '2026-12-31');

    const preview = within(dialog.getByRole('table', { name: 'New schedule' }));
    const rows = preview.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    // Numbering follows the paid row; the remainder goes on the last one; month-end is kept.
    expect(within(rows[0]).getByText('#2')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Rs. 6,666')).toBeInTheDocument();
    expect(within(rows[1]).getByText('2027-01-31')).toBeInTheDocument();
    expect(within(rows[2]).getByText('2027-02-28')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Rs. 6,668')).toBeInTheDocument();

    expect(dialog.getByText('The signed agreement will no longer match.')).toBeInTheDocument();
    expect(dialog.getByText(/this phone cannot be locked/)).toBeInTheDocument();
  });

  it('needs a reason before it can be confirmed', async () => {
    const { api, dialog } = await start();
    const confirm = dialog.getByRole('button', { name: 'Confirm restructure' });

    expect(confirm).toBeDisabled();
    fill(dialog.getByLabelText('Reason (required)'), 'too short');
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(api.to('POST /installments/plans/plan-1/reschedule')).toHaveLength(0);
  });

  it('sends the new terms and the reason', async () => {
    const { api, dialog } = await start({
      'POST /installments/plans/plan-1/reschedule': { success: true, message: 'Plan restructured into 4 new installment(s).' },
    });
    fill(dialog.getByLabelText('Number of new months'), '4');
    fill(dialog.getByLabelText('First new due date'), '2026-12-05');
    fill(dialog.getByLabelText('Reason (required)'), REASON);
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm restructure' }));

    expect(await screen.findByText('Plan restructured into 4 new installment(s).')).toBeInTheDocument();
    expect(api.to('POST /installments/plans/plan-1/reschedule')[0].body).toEqual({
      totalInstallments: 4,
      firstDueDate: '2026-12-05',
      gracePeriodDays: 3,
      reason: REASON,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it("shows the server's reason when it refuses", async () => {
    const { dialog } = await start({
      'POST /installments/plans/plan-1/reschedule': fail(400, 'There is no outstanding balance left to reschedule.'),
    });
    fill(dialog.getByLabelText('Reason (required)'), REASON);
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm restructure' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent('There is no outstanding balance left to reschedule.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('waiving a late fee', () => {
  async function start(routes: Record<string, unknown> = {}) {
    const api = open('DEALER_ADMIN', routes);
    fireEvent.click(await screen.findByRole('button', { name: 'Waive late fee' }));
    return { api, dialog: within(screen.getByRole('dialog', { name: 'Waive the late fee' })) };
  }

  it('shows the fee and needs a reason', async () => {
    const { api, dialog } = await start();
    expect(dialog.getByText('Rs. 500')).toBeInTheDocument();
    const confirm = dialog.getByRole('button', { name: 'Confirm waiver' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(api.to('POST /installments/inst-2/waive-late-fee')).toHaveLength(0);
  });

  it('sends the reason for that installment', async () => {
    const { api, dialog } = await start({
      'POST /installments/inst-2/waive-late-fee': { success: true, waivedAmount: 500, message: 'Late fee waived.' },
    });
    fill(dialog.getByLabelText('Reason (required)'), REASON);
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm waiver' }));

    expect(await screen.findByText('Late fee waived.')).toBeInTheDocument();
    expect(api.to('POST /installments/inst-2/waive-late-fee')[0].body).toEqual({ reason: REASON });
  });

  it("shows the server's reason when it refuses", async () => {
    const { dialog } = await start({
      'POST /installments/inst-2/waive-late-fee': fail(403, 'Only the shop owner can waive late fees.'),
    });
    fill(dialog.getByLabelText('Reason (required)'), REASON);
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm waiver' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent('Only the shop owner can waive late fees.');
  });
});
