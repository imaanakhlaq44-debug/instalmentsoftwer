import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { AddCustomerWizardModal } from './AddCustomerWizardModal.js';
import { mockApi, renderPage, fill, fail, type MockApi, type MockRequest } from '../../test/harness.js';
import type { UserRole } from '../../types/index.js';

/**
 * Registering a financed sale: the one-page form at the counter.
 *
 * This is where a shop commits a phone and a repayment plan to a customer, so
 * the tests follow what the shopkeeper sees: which box is wrong, what fills in
 * by itself, whether the phone can take a lock, what the server is told, and
 * what happens when the server says no.
 */

const VALID_IMEI = '490154203237518';

const SALE_CREATED = {
  success: true,
  qrImageDataUrl: 'data:image/png;base64,QR',
  qrProvisioningReady: true,
  customer: { id: 'cust-9', name: 'Muhammad Aslam' },
  device: { id: 'dev-9', brand: 'Samsung', model: 'Galaxy A15' },
  enrollmentToken: { token: 'ENR-7K2M-QX', expiresAt: '2030-01-01T00:00:00Z' },
};

const HELPER = {
  customer: null,
  recentModels: [
    { brand: 'Tecno', model: 'Spark 20', ramStorage: '8GB / 128GB', price: 38000 },
    { brand: 'Samsung', model: 'Galaxy A15', ramStorage: '6GB / 128GB', price: 54000 },
  ],
  gracePeriodDays: 5,
};

/** Answers the CNIC lookup with a returning customer for one CNIC only. */
const helperWith =
  (returning: { name: string; phonesOnFile: number; overdueInstallments: number }) => (req: MockRequest) => ({
    ...HELPER,
    customer: req.query.get('cnic') === '3520212345671' ? returning : null,
  });

function open(role: UserRole = 'DEALER_ADMIN', routes: Record<string, unknown> = {}) {
  const api = mockApi({
    role,
    routes: {
      'GET /enrollment/readiness': { frpConfigured: true, frpAccountsCount: 1, provisioningReady: true },
      'GET /customers/sale-helper': HELPER,
      'POST /customers': SALE_CREATED,
      ...routes,
    },
  });
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  renderPage(<AddCustomerWizardModal onClose={onClose} onSuccess={onSuccess} />);
  return { api, onClose, onSuccess };
}

/** Both "Register" buttons (the desktop one and the bottom bar) submit the same form. */
const register = () => fireEvent.click(screen.getAllByRole('button', { name: /Register sale|Registering/ })[0]);

async function fillNewCustomer(overrides: Record<string, string> = {}) {
  await screen.findByText('Sell a phone on installments');
  const values: Record<string, string> = {
    '35202-1234567-1': '35202-1234567-1',
    'e.g. Muhammad Aslam': 'Muhammad Aslam',
    '0300-1234567': '0300-1234567',
    'House / Street / City': 'House 12, Street 4, Lahore',
    'e.g. Asif Aslam (Brother)': 'Asif Aslam',
    '0321-7654321': '0321-7654321',
    ...overrides,
  };
  for (const [placeholder, value] of Object.entries(values)) {
    fill(screen.getByPlaceholderText(placeholder), value);
  }
}

async function fillPhone() {
  await screen.findByText('Sell a phone on installments');
  fill(screen.getByPlaceholderText('e.g. Galaxy A15 / Spark 20'), 'Galaxy A15');
  fill(screen.getByPlaceholderText('15-digit IMEI'), VALID_IMEI);
  fill(screen.getByPlaceholderText('e.g. 54000'), '54000');
}

async function fillEverything() {
  await fillNewCustomer();
  await fillPhone();
}

const lastSale = (api: MockApi) => api.to('POST /customers').at(-1)?.body;

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('the sale form — one page', () => {
  it('shows the customer, the phone and the plan together, with one button to register', async () => {
    open();
    await screen.findByText('Sell a phone on installments');

    expect(screen.getByRole('heading', { name: 'Customer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The phone' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Installment plan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
  });

  it("starts the plan from the shop's own grace period", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText('Grace period (days)')).toHaveValue(5));
  });

  it('fills brand, model and price from a model sold recently, with a 25% advance', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Tecno Spark 20/ }));

    expect(screen.getByLabelText('Brand')).toHaveValue('Tecno');
    expect(screen.getByLabelText('Model')).toHaveValue('Spark 20');
    expect(screen.getByLabelText('Phone price (Rs)')).toHaveValue(38000);
    expect(screen.getByLabelText('Advance (Rs)')).toHaveValue(9500);
  });

  it('works out the monthly installment as the advance and months are tapped', async () => {
    open();
    await fillPhone();

    // Rs 54,000 with a 25% advance (Rs 13,500) over 6 months.
    expect(screen.getAllByText('Rs 6,750').length).toBeGreaterThan(0);
    expect(screen.getByText('Rs 40,500')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '30%' }));
    fireEvent.click(screen.getByRole('button', { name: /^12\s*months$/ }));

    // Rs 54,000 less Rs 16,200, over 12 months.
    expect(screen.getByText('Rs 37,800')).toBeInTheDocument();
    expect(screen.getAllByText('Rs 3,150').length).toBeGreaterThan(0);
  });
});

describe('the sale form — validation', () => {
  it('names every wrong box at once and sends nothing', async () => {
    const { api } = open();
    await screen.findByText('Sell a phone on installments');

    register();

    expect(await screen.findByText('Customer name must be at least 3 characters.')).toBeInTheDocument();
    expect(screen.getByText('CNIC must be 13 digits, e.g. 35202-1234567-1.')).toBeInTheDocument();
    expect(screen.getByText('Please enter a complete address.')).toBeInTheDocument();
    expect(screen.getAllByText('Enter a Pakistani mobile number, e.g. 0300-1234567.')).toHaveLength(2);
    expect(screen.getByText('Please enter the phone model.')).toBeInTheDocument();
    expect(screen.getByText(/IMEI must be 15 digits/)).toBeInTheDocument();
    expect(screen.getByText('Please fix the fields marked in red.')).toBeInTheDocument();
    expect(api.to('POST /customers')).toHaveLength(0);
  });

  it('clears a message as soon as that box is corrected', async () => {
    open();
    await screen.findByText('Sell a phone on installments');
    register();
    await screen.findByText('Customer name must be at least 3 characters.');

    fill(screen.getByPlaceholderText('e.g. Muhammad Aslam'), 'Muhammad Aslam');

    expect(screen.queryByText('Customer name must be at least 3 characters.')).not.toBeInTheDocument();
    expect(screen.getByText('Please enter a complete address.')).toBeInTheDocument();
  });

  it('refuses an IMEI that fails the checksum', async () => {
    const { api } = open();
    await fillEverything();
    fill(screen.getByPlaceholderText('15-digit IMEI'), '123456789012345');

    register();

    expect(await screen.findByText(/IMEI must be 15 digits with a valid checksum/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('15-digit IMEI')).toHaveAttribute('aria-invalid', 'true');
    expect(api.to('POST /customers')).toHaveLength(0);
  });

  it('refuses an advance that is not less than the price', async () => {
    open();
    await fillEverything();
    fill(screen.getByLabelText('Advance (Rs)'), '54000');

    register();

    expect(await screen.findByText('Down payment must be less than the phone price.')).toBeInTheDocument();
  });
});

describe('the sale form — a returning customer', () => {
  it('recognises a CNIC on file, fills the name and asks for nothing else', async () => {
    const { api } = open('DEALER_STAFF', {
      'GET /customers/sale-helper': helperWith({ name: 'Muhammad Aslam', phonesOnFile: 1, overdueInstallments: 0 }),
    });
    await screen.findByText('Sell a phone on installments');

    fill(screen.getByPlaceholderText('35202-1234567-1'), '35202-1234567-1');

    expect(await screen.findByText('Returning customer')).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toHaveValue('Muhammad Aslam');
    expect(screen.getByLabelText('Full name')).toHaveAttribute('readonly');
    expect(screen.queryByPlaceholderText('House / Street / City')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('0300-1234567')).not.toBeInTheDocument();

    await fillPhone();
    register();

    await screen.findByText("Scan this QR on the customer's phone");
    // The record on file is used: only the name and CNIC are sent.
    expect(lastSale(api).customer).toEqual({ name: 'Muhammad Aslam', cnic: '35202-1234567-1' });
  });

  it('warns when an earlier phone has overdue installments', async () => {
    open('DEALER_STAFF', {
      'GET /customers/sale-helper': helperWith({ name: 'Muhammad Aslam', phonesOnFile: 2, overdueInstallments: 3 }),
    });
    await screen.findByText('Sell a phone on installments');

    fill(screen.getByPlaceholderText('35202-1234567-1'), '3520212345671');

    expect(await screen.findByText(/installment\(s\) overdue on an earlier phone/)).toBeInTheDocument();
  });

  it('asks for the full details again when the CNIC is changed to an unknown one', async () => {
    open('DEALER_STAFF', {
      'GET /customers/sale-helper': helperWith({ name: 'Muhammad Aslam', phonesOnFile: 1, overdueInstallments: 0 }),
    });
    await screen.findByText('Sell a phone on installments');
    fill(screen.getByPlaceholderText('35202-1234567-1'), '35202-1234567-1');
    await screen.findByText('Returning customer');

    fill(screen.getByPlaceholderText('35202-1234567-1'), '35202-7654321-9');

    expect(await screen.findByPlaceholderText('House / Street / City')).toBeInTheDocument();
    expect(screen.queryByText('Returning customer')).not.toBeInTheDocument();
  });
});

describe('the sale form — phone support check', () => {
  it('says a current Android phone is fully supported', async () => {
    open();
    await screen.findByText('Phone check');
    expect(screen.getByText(/Fully supported/)).toBeInTheDocument();
    expect(screen.queryByText(/No lock will be used/)).not.toBeInTheDocument();
  });

  it('warns that Android 8–10 locks but has weak reset protection', async () => {
    open();
    await screen.findByText('Phone check');
    fireEvent.click(screen.getByRole('button', { name: '8 – 10' }));

    expect(screen.getByText(/Lock works, reset protection does not/)).toBeInTheDocument();
  });

  it('tells the shop a phone without Play Store cannot be locked', async () => {
    open();
    await screen.findByText('Phone check');
    fireEvent.click(screen.getByRole('button', { name: 'No Play Store' }));

    expect(screen.getByText(/No Google Play, so no lock/)).toBeInTheDocument();
    expect(screen.getByText(/No lock will be used and no QR is needed/)).toBeInTheDocument();
  });

  it('registers an iPhone as a sale without a lock, and shows no QR', async () => {
    const { api } = open('DEALER_ADMIN', {
      'POST /customers': { success: true, customer: { id: 'cust-9' }, device: { id: 'dev-9', noLock: true } },
    });
    await fillEverything();
    fireEvent.change(screen.getByLabelText('Brand'), { target: { value: 'Apple' } });

    expect(screen.getByText(/iPhone cannot be locked/)).toBeInTheDocument();
    // The Android questions no longer apply.
    expect(screen.getByRole('button', { name: '11 or newer' })).toBeDisabled();
    expect(screen.getByText('Sold without a lock')).toBeInTheDocument();

    register();

    expect(await screen.findByText('Sale registered without a lock')).toBeInTheDocument();
    expect(lastSale(api).noLock).toBe(true);
    expect(screen.queryByAltText('QR code to scan on the new phone')).not.toBeInTheDocument();
  });

  it('warns when the shop has no reset-protection account, and only the owner is sent to Settings', async () => {
    open('DEALER_STAFF', {
      'GET /enrollment/readiness': { frpConfigured: false, frpAccountsCount: 0, provisioningReady: true },
    });

    expect(await screen.findByText('Factory Reset Protection is off for this shop')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /How to get Google Account ID/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).not.toBeInTheDocument();
  });

  it('offers the owner a way to Settings from the same warning', async () => {
    const { onClose } = open('DEALER_ADMIN', {
      'GET /enrollment/readiness': { frpConfigured: false, frpAccountsCount: 0, provisioningReady: true },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Open Settings' }));

    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText('Went to /settings')).toBeInTheDocument();
  });
});

describe('the sale form — sending it', () => {
  it('sends the customer, phone and plan exactly as entered and shows the QR', async () => {
    const { api, onSuccess, onClose } = open();
    await fillEverything();

    register();

    expect(await screen.findByText("Scan this QR on the customer's phone")).toBeInTheDocument();
    expect(screen.getByAltText('QR code to scan on the new phone')).toHaveAttribute('src', SALE_CREATED.qrImageDataUrl);
    expect(screen.getByText(/ENR-7K2M-QX/)).toBeInTheDocument();

    const sent = lastSale(api);
    expect(sent.customer).toEqual({
      name: 'Muhammad Aslam',
      phone: '0300-1234567',
      cnic: '35202-1234567-1',
      address: 'House 12, Street 4, Lahore',
      emergencyContactName: 'Asif Aslam',
      emergencyContactPhone: '0321-7654321',
    });
    expect(sent.device).toMatchObject({ brand: 'Samsung', model: 'Galaxy A15', imei: VALID_IMEI, purchasePrice: 54000 });
    expect(sent.plan).toMatchObject({ downPayment: 13500, totalInstallments: 6, gracePeriodDays: 5 });
    expect(sent.noLock).toBe(false);
    expect(api.to('POST /customers')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('opens the QR page for the new phone', async () => {
    open();
    await fillEverything();
    register();

    fireEvent.click(await screen.findByRole('button', { name: 'Open QR page' }));

    expect(await screen.findByText('Went to /enrollment?device=dev-9')).toBeInTheDocument();
  });

  it('warns when the server cannot serve the app download for this QR', async () => {
    open('DEALER_ADMIN', { 'POST /customers': { ...SALE_CREATED, qrProvisioningReady: false } });
    await fillEverything();
    register();

    expect(await screen.findByText(/this QR cannot install the app yet/)).toBeInTheDocument();
  });

  it('refuses the sale when the shop has no locks left, and keeps everything typed', async () => {
    const refusal =
      'You have no device locks left. Each handset needs its own lock, and a lock is not returned when a plan is paid off. Buy a pack before registering another financed sale.';
    const { api, onSuccess } = open('DEALER_ADMIN', { 'POST /customers': fail(403, refusal) });
    await fillEverything();

    register();

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(screen.queryByText("Scan this QR on the customer's phone")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Register sale/ })[0]).toBeEnabled());
    expect(screen.getByPlaceholderText('15-digit IMEI')).toHaveValue(VALID_IMEI);
    expect(api.to('POST /customers')).toHaveLength(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('marks the box the server rejected', async () => {
    open('DEALER_ADMIN', {
      'POST /customers': fail(422, 'Validation failed', {
        details: [{ field: 'device.imei', message: 'This IMEI failed the checksum.' }],
      }),
    });
    await fillEverything();

    register();

    expect((await screen.findAllByText('This IMEI failed the checksum.')).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('15-digit IMEI')).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not register twice when the button is pressed twice', async () => {
    const { api } = open();
    await fillEverything();

    register();
    register();

    await screen.findByText("Scan this QR on the customer's phone");
    expect(api.to('POST /customers')).toHaveLength(1);
  });

  it('shows the server message when the CNIC is on file under a different name', async () => {
    const refusal =
      'This CNIC is already on file for Muhammad Aslam Khan. To sell them another phone, enter the name exactly as on file. If this is a different person, check the CNIC.';
    open('DEALER_STAFF', { 'POST /customers': fail(409, refusal) });
    await fillEverything();

    register();

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('35202-1234567-1')).toHaveValue('35202-1234567-1');
  });

  it('refuses a duplicate IMEI with the server message', async () => {
    const refusal = 'A device with this IMEI is already registered in the system.';
    open('DEALER_STAFF', { 'POST /customers': fail(409, refusal) });
    await fillEverything();

    register();

    expect(await screen.findByText(refusal)).toBeInTheDocument();
  });
});
