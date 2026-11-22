import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ShopAppHomePage } from './ShopAppHomePage.js';
import { mockApi, renderPage, fail } from '../test/harness.js';
import { toRomanUrdu, toUrdu } from '../i18n/translate.js';

const stats = { collectedToday: 42000, collectedThisMonth: 124500, outstandingAmount: 865000, dueTodayCount: 12, paidDueTodayCount: 7, totalDevices: 126, totalCustomers: 98, overdueInstallmentsCount: 6, pendingVerificationAmount: 0 };
const card = (over: Record<string, unknown> = {}) => ({
  planId: 'plan-1', installmentId: 'inst-1', customerId: 'cust-1', customerName: 'Fahad Mustafa', customerPhone: '03123344556',
  deviceId: 'dev-1', deviceName: 'Tecno Camon 30', totalInstallments: 6, paidInstallments: 2, installmentsDue: 1,
  amountDue: 7250, dueDate: '2026-11-18', daysLate: 0, ...over,
});
const today = {
  total: 4, dueTodayCount: 2, lateCount: 2,
  customers: [card(), card({ planId: 'plan-2', installmentId: 'inst-2', customerId: 'cust-2', customerName: 'Rashid Khan', daysLate: 3, amountDue: 11500, installmentsDue: 2 })],
};
const sharedRoutes = { 'GET /dashboard/stats': stats, 'GET /dashboard/today': today, 'GET /sale-drafts': { drafts: [], devices: [] } };

function open(role: 'DEALER_ADMIN' | 'DEALER_VIEWER' | 'CUSTOMER' | 'SUPER_ADMIN' = 'DEALER_ADMIN', routes = {}) {
  const api = mockApi({ role, routes: { ...sharedRoutes, ...routes } }); renderPage(<ShopAppHomePage />); return api;
}

describe('Shop app home — Khata card', () => {
  it('puts today\'s takings and one segment per installment due today in the SHOP KHATA card', async () => {
    open(); expect(await screen.findByText(/42,000/)).toBeInTheDocument();
    expect(screen.getByText('Shop khata')).toBeInTheDocument();
    expect(screen.getByText('7 of 12 installments received')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: "Today's installments received" });
    expect(bar.children).toHaveLength(12);
    expect(bar.querySelectorAll('.paid')).toHaveLength(7);
  });

  it('lists who owes today, due-today and late, with plan progress', async () => {
    open(); const fahad = (await screen.findByText('Fahad Mustafa')).closest('li')!;
    expect(within(fahad).getByText('Due today')).toBeInTheDocument();
    expect(within(fahad).getByText(/7,250/)).toBeInTheDocument();
    expect(within(fahad).getByText('2 of 6 paid')).toBeInTheDocument();
    expect(within(fahad).getByText('6 months')).toBeInTheDocument();
    const rashid = screen.getByText('Rashid Khan').closest('li')!;
    expect(within(rashid).getByText('3 days late')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /\+ 2 more customers today · see all/ }));
    expect(await screen.findByText('Went to /installments?status=OVERDUE')).toBeInTheDocument();
  });

  it('records a payment against that plan from Collect payment', async () => {
    const api = open('DEALER_ADMIN', { 'POST /payments': { message: 'Payment recorded.' } });
    const fahad = (await screen.findByText('Fahad Mustafa')).closest('li')!;
    fireEvent.click(within(fahad).getByRole('button', { name: /Collect payment/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByLabelText('Amount (Rs)')).toHaveValue(7250);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(api.calls.some(c => c.method === 'POST' && c.path === '/payments')).toBe(true));
    const sent = api.calls.find(c => c.method === 'POST' && c.path === '/payments')!.body;
    expect(sent).toMatchObject({ customerId: 'cust-1', planId: 'plan-1', amount: 7250, paymentMethod: 'CASH' });
  });

  it('asks for a transaction ID before recording a JazzCash payment', async () => {
    const api = open();
    fireEvent.click(within((await screen.findByText('Fahad Mustafa')).closest('li')!).getByRole('button', { name: /Collect payment/ }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('radio', { name: 'JazzCash' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Record payment' }));
    expect(await within(sheet).findByText('Enter the transaction ID.')).toBeInTheDocument();
    expect(api.calls.some(c => c.method === 'POST' && c.path === '/payments')).toBe(false);
  });

  it('opens the WhatsApp reminder for a late customer as an overdue notice', async () => {
    const api = open('DEALER_ADMIN', { 'GET /notifications/whatsapp/message': { message: 'Salam', url: 'https://wa.me/923123344556', phone: '03123344556', waNumber: '923123344556', language: 'roman-ur' } });
    fireEvent.click(within((await screen.findByText('Rashid Khan')).closest('li')!).getByRole('button', { name: /Remind/ }));
    expect(await screen.findByRole('dialog', { name: 'WhatsApp message for Rashid Khan' })).toBeInTheDocument();
    await waitFor(() => expect(api.calls.find(c => c.path === '/notifications/whatsapp/message')?.query.get('kind')).toBe('OVERDUE'));
  });

  it('opens the sale form from the big New sale button', async () => {
    open(); fireEvent.click(await screen.findByRole('button', { name: 'New sale' }));
    expect(await screen.findByRole('dialog', { name: 'New sale' })).toBeInTheDocument();
  });

  it('gives view-only staff the lists but no buttons that change anything', async () => {
    open('DEALER_VIEWER'); await screen.findByText('Fahad Mustafa');
    expect(screen.queryByRole('button', { name: 'New sale' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Collect payment/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remind/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search customers' })).toBeInTheDocument();
  });

  it('says so when nobody owes today', async () => {
    open('DEALER_ADMIN', { 'GET /dashboard/today': { total: 0, dueTodayCount: 0, lateCount: 0, customers: [] }, 'GET /dashboard/stats': { ...stats, dueTodayCount: 0, paidDueTodayCount: 0 } });
    expect(await screen.findByText('Nobody owes an installment today.')).toBeInTheDocument();
    expect(screen.getByText('No installments due today')).toBeInTheDocument();
  });

  it('shows a failure and retry instead of invented sample money', async () => {
    open('DEALER_ADMIN', { 'GET /dashboard/stats': fail(500, 'Unavailable') });
    expect(await screen.findByText('Could not load the latest figures.')).toBeInTheDocument();
    expect(screen.queryByText(/42,000/)).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('has every new label in Roman Urdu and Urdu', () => {
    const labels = ['Shop khata', 'Today', 'Received today', 'Due today', 'Remind', 'Collect payment', 'New sale', 'Search customers',
      'Nobody owes an installment today.', 'No installments due today', 'Amount (Rs)', 'How was it paid?', 'Cash', 'Record payment',
      '7 of 12 installments received', '2 of 6 paid', '6 months', '3 days late', '+ 2 more customers today · see all'];
    for (const label of labels) {
      expect(toUrdu(label), label).not.toMatch(/[A-Za-z]{3,}/);
      if (label !== 'Shop khata') expect(toRomanUrdu(label), label).not.toBe(label);
    }
    expect(toRomanUrdu('7 of 12 installments received')).toBe('12 mein se 7 qistein mil gayin');
    expect(toRomanUrdu('Remind')).toBe('Yaad dilao');
  });
});

describe('Shop app home — customer and platform', () => {
  it('keeps a customer on their own phones and payments, with no shop actions', async () => {
    open('CUSTOMER'); await screen.findByText(/42,000/);
    expect(screen.queryByRole('button', { name: 'New sale' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My phones' })).toBeInTheDocument();
  });

  it('shows real platform earnings and platform actions for the super admin', async () => {
    open('SUPER_ADMIN', { 'GET /platform/overview': { totals: { shops: 5, revenueThisMonth: 14000, revenue: 28000, locksSoldThisMonth: 14, locksConsumed: 2 }, awaitingPayment: [], shops: [], fleet: { byStatus: {}, stale: 0 } } });
    expect(await screen.findByText(/14,000/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'All shops' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New sale' })).not.toBeInTheDocument();
  });
});
