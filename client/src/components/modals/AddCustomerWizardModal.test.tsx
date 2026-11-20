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
vi.mock('../contract/SignaturePad.js', () => ({ SignaturePad: ({ onChange }: any) => <button type="button" onClick={() => onChange('data:image/png;base64,c2lnbmF0dXJl')}>Draw test signature</button> }));
const PREVIEW = { termsVersion: '1.4', fingerprint: 'a'.repeat(64), declaration: { en: 'Customer declaration', ur: 'اقرار' },
  snapshot: { customer: { name: 'Muhammad Aslam' }, device: { brand: 'Samsung', model: 'Galaxy A15' }, schedule: [{ installmentNumber: 1, amountDue: 6750, dueDate: '2026-12-20' }] },
  clauses: [{ heading: 'Agreement terms', body: 'The complete terms', headingUr: 'شرائط', bodyUr: 'مکمل شرائط' }] };

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
      'POST /customers/agreement-preview': PREVIEW,
      ...routes,
    },
  });
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  renderPage(<AddCustomerWizardModal onClose={onClose} onSuccess={onSuccess} />);
  return { api, onClose, onSuccess };
}

/** Both "Register" buttons (the desktop one and the bottom bar) submit the same form. */
const register = async () => {
  if (!screen.queryByText('Fill customer, phone and installment details to prepare the agreement.')) {
    fireEvent.click(await screen.findByRole('button', { name: 'Draw test signature' }));
    const accept = screen.getByRole('checkbox', { name: 'The customer has read the agreement and accepts it.' });
    if (!(accept as HTMLInputElement).checked) fireEvent.click(accept);
  }
  fireEvent.click(screen.getByRole('button', { name: /Save signed sale|Saving sale/ }));
};

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

    await register();

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
    await register();
    await screen.findByText('Customer name must be at least 3 characters.');

    fill(screen.getByPlaceholderText('e.g. Muhammad Aslam'), 'Muhammad Aslam');

    expect(screen.queryByText('Customer name must be at least 3 characters.')).not.toBeInTheDocument();
    expect(screen.getByText('Please enter a complete address.')).toBeInTheDocument();
  });

  it('refuses an IMEI that fails the checksum', async () => {
    const { api } = open();
    await fillEverything();
    fill(screen.getByPlaceholderText('15-digit IMEI'), '123456789012345');

    await register();

    expect(await screen.findByText(/IMEI must be 15 digits with a valid checksum/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('15-digit IMEI')).toHaveAttribute('aria-invalid', 'true');
    expect(api.to('POST /customers')).toHaveLength(0);
  });

  it('refuses an advance that is not less than the price', async () => {
    open();
    await fillEverything();
    fill(screen.getByLabelText('Advance (Rs)'), '54000');

    await register();

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
    await register();

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

    await register();

    expect((await screen.findAllByText('Sale and signed agreement saved.')).length).toBeGreaterThan(0);
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
  it('does not save before the customer signs and accepts, and clears acceptance when figures change', async () => {
    const { api } = open(); await fillEverything();
    await screen.findByRole('button', { name: 'Draw test signature' });
    fireEvent.click(screen.getByRole('button', { name: /Save signed sale/ }));
    expect(api.to('POST /customers')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Draw test signature' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'The customer has read the agreement and accepts it.' }));
    fill(screen.getByLabelText('Phone price (Rs)'), '60000');
    await screen.findByRole('button', { name: 'Draw test signature' });
    expect(screen.getByRole('checkbox', { name: 'The customer has read the agreement and accepts it.' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Save signed sale/ }));
    expect(api.to('POST /customers')).toHaveLength(0);
  });

  it('hides the second QR and finishes inside the same card when a phone was scanned first', async () => {
    const id = '748c604f-a6cc-4f7d-9e40-77facbfcb617';
    const { api } = open('DEALER_ADMIN', {
      'POST /enrollment/phone-intakes': { id, tokenId: 'intake-token', qrImageDataUrl: 'data:image/png;base64,QR' },
      [`GET /enrollment/phone-intakes/${id}`]: { status: 'RECEIVED', report: { brand: 'Samsung', model: 'Galaxy A15', imeis: [VALID_IMEI], serialNumber: 'SCAN-001', osVersion: '14' } },
    });
    await fillNewCustomer();
    fireEvent.click(screen.getByRole('button', { name: 'Scan new phone from Welcome screen' }));
    await waitFor(() => expect(screen.getByPlaceholderText('15-digit IMEI')).toHaveValue(VALID_IMEI));
    fill(screen.getByLabelText('Phone price (Rs)'), '54000');
    await register(); await screen.findByRole('button', { name: 'Done' });
    expect(lastSale(api).phoneIntakeId).toBe(id);
    expect(lastSale(api).agreement).toMatchObject({ declarationAccepted: true, termsVersion: '1.4' });
    expect(screen.queryByAltText('QR code to scan on the new phone')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open QR page' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New sale' })).toBeInTheDocument();
    expect(screen.getByText(/Finish Android setup on the phone/)).toBeInTheDocument();
  });

  it('sends the customer, phone and plan exactly as entered and shows the QR', async () => {
    const { api, onSuccess, onClose } = open();
    await fillEverything();

    await register();

    expect(await screen.findByText("Scan this QR on the customer's phone")).toBeInTheDocument();
    expect(screen.getByAltText('QR code to scan on the new phone')).toHaveAttribute('src', SALE_CREATED.qrImageDataUrl);
    expect(screen.queryByRole('button', { name: 'Open QR page' })).not.toBeInTheDocument();

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

  it('reads the agreement and finishes the sale in the same card without navigation', async () => {
    open();
    await fillEverything();
    const read = await screen.findByRole('button', { name: 'Read agreement' });
    await waitFor(() => expect(read).toBeEnabled());
    fireEvent.click(read);
    expect(screen.getByText('The complete terms')).toBeInTheDocument();
    await register();
    await screen.findByRole('button', { name: 'Done' });
    expect(screen.getByRole('dialog', { name: 'New sale' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open QR page' })).not.toBeInTheDocument();
  });

  it('warns when the server cannot serve the app download for this QR', async () => {
    open('DEALER_ADMIN', { 'POST /customers': { ...SALE_CREATED, qrProvisioningReady: false } });
    await fillEverything();
    await register();

    expect(await screen.findByText(/this QR cannot install the app yet/)).toBeInTheDocument();
  });

  it('refuses the sale when the shop has no locks left, and keeps everything typed', async () => {
    const refusal =
      'You have no device locks left. Each handset needs its own lock, and a lock is not returned when a plan is paid off. Buy a pack before registering another financed sale.';
    const { api, onSuccess } = open('DEALER_ADMIN', { 'POST /customers': fail(403, refusal) });
    await fillEverything();

    await register();

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(screen.queryByText("Scan this QR on the customer's phone")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Save signed sale/ })).toBeEnabled());
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

    await register();

    expect((await screen.findAllByText('This IMEI failed the checksum.')).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('15-digit IMEI')).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not register twice when the button is pressed twice', async () => {
    const { api } = open();
    await fillEverything();

    fireEvent.click(await screen.findByRole('button', { name: 'Draw test signature' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'The customer has read the agreement and accepts it.' }));
    const save = screen.getByRole('button', { name: /Save signed sale/ });
    fireEvent.click(save); fireEvent.click(save);
    await screen.findByText("Scan this QR on the customer's phone");
    expect(api.to('POST /customers')).toHaveLength(1);
  });

  it('shows the server message when the CNIC is on file under a different name', async () => {
    const refusal =
      'This CNIC is already on file for Muhammad Aslam Khan. To sell them another phone, enter the name exactly as on file. If this is a different person, check the CNIC.';
    open('DEALER_STAFF', { 'POST /customers': fail(409, refusal) });
    await fillEverything();

    await register();

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('35202-1234567-1')).toHaveValue('35202-1234567-1');
  });

  it('refuses a duplicate IMEI with the server message', async () => {
    const refusal = 'A device with this IMEI is already registered in the system.';
    open('DEALER_STAFF', { 'POST /customers': fail(409, refusal) });
    await fillEverything();

    await register();

    expect(await screen.findByText(refusal)).toBeInTheDocument();
  });
});

describe('automatic plan and single phone QR', () => {
  it('fills the plan from the phone price before customer details are entered', async () => {
    open(); await screen.findByText('Sell a phone on installments');
    fill(screen.getByLabelText('Phone price (Rs)'), '60000');
    expect(screen.getByLabelText('Plan price (Rs)')).toHaveValue(60000);
    expect(screen.getByLabelText('Advance (Rs)')).toHaveValue(15000);
    expect(screen.getByLabelText('Remaining amount (Rs)')).toHaveValue(45000);
    expect(screen.getByLabelText('Monthly installment (Rs)')).toHaveValue(7500);
    expect(screen.getByLabelText('Plan price (Rs)')).toHaveAttribute('readonly');
  });
  it('recalculates the exact plan and preserves a manually typed advance when price changes', async () => {
    open(); await screen.findByText('Sell a phone on installments');
    fill(screen.getByLabelText('Phone price (Rs)'), '60000');
    fill(screen.getByLabelText('Advance (Rs)'), '10000');
    expect(screen.getByLabelText('Remaining amount (Rs)')).toHaveValue(50000);
    expect(screen.getByLabelText('Monthly installment (Rs)')).toHaveValue(8333);
    expect(screen.getByLabelText('Final installment (Rs)')).toHaveValue(8335);
    fill(screen.getByLabelText('Phone price (Rs)'), '65000');
    expect(screen.getByLabelText('Advance (Rs)')).toHaveValue(10000);
    expect(screen.getByLabelText('Remaining amount (Rs)')).toHaveValue(55000);
    fireEvent.click(screen.getByRole('button', { name: /^12\s*months$/ }));
    expect(screen.getByLabelText('Monthly installment (Rs)')).toHaveValue(4583);
    expect(screen.getByLabelText('Final installment (Rs)')).toHaveValue(4587);
  });
  it('keeps the Welcome-screen QR and manual IMEI but removes the extra IMEI scanner', async () => {
    open(); await screen.findByText('Sell a phone on installments');
    expect(screen.getByRole('button', { name: 'Scan new phone from Welcome screen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scan the IMEI barcode on the box' })).not.toBeInTheDocument();
    fill(screen.getByLabelText('IMEI (15 digits)'), VALID_IMEI);
    expect(screen.getByLabelText('IMEI (15 digits)')).toHaveValue(VALID_IMEI);
  });
});

