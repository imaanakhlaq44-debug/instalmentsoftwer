import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { AddCustomerWizardModal } from './AddCustomerWizardModal.js';
import { mockApi, renderPage, fill, fail, type MockApi } from '../../test/harness.js';
import type { UserRole } from '../../types/index.js';

/**
 * Registering a financed sale: the four-step wizard at the counter.
 *
 * This is where a shop commits a phone and a repayment plan to a customer, so
 * the tests follow what the shopkeeper sees: which box is wrong, whether the
 * phone can take a lock, what the server is told, and what happens when the
 * server says no.
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

function open(role: UserRole = 'DEALER_ADMIN', routes: Record<string, unknown> = {}) {
  const api = mockApi({
    role,
    routes: {
      'GET /enrollment/readiness': { frpConfigured: true, frpAccountsCount: 1, provisioningReady: true },
      'POST /customers': SALE_CREATED,
      ...routes,
    },
  });
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  renderPage(<AddCustomerWizardModal onClose={onClose} onSuccess={onSuccess} />);
  return { api, onClose, onSuccess };
}

const next = () => fireEvent.click(screen.getByRole('button', { name: /next/i }));

async function fillCustomer(overrides: Record<string, string> = {}) {
  await screen.findByText('Customer Details');
  const values: Record<string, string> = {
    'e.g. Muhammad Aslam': 'Muhammad Aslam',
    '0300-1234567': '0300-1234567',
    '35202-1234567-1': '35202-1234567-1',
    'House / Street / City': 'House 12, Street 4, Lahore',
    'e.g. Asif Aslam (Brother)': 'Asif Aslam',
    '0321-7654321': '0321-7654321',
    ...overrides,
  };
  for (const [placeholder, value] of Object.entries(values)) {
    fill(screen.getByPlaceholderText(placeholder), value);
  }
}

/** Customer and device steps filled in correctly; leaves the wizard on Financing. */
async function reachFinancing() {
  await fillCustomer();
  next();
  fill(await screen.findByPlaceholderText('15-digit IMEI'), VALID_IMEI);
  next();
  await screen.findByText('Installment Structure');
}

async function reachReview() {
  await reachFinancing();
  next();
  await screen.findByText('Installment Financing Agreement');
}

const lastSale = (api: MockApi) => api.to('POST /customers').at(-1)?.body;

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('registering a financed sale — validation', () => {
  it('names every wrong box on the customer step and does not move on', async () => {
    open();
    await screen.findByText('Customer Details');

    next();

    expect(await screen.findByText('Customer name must be at least 3 characters.')).toBeInTheDocument();
    expect(screen.getByText('CNIC must be 13 digits, e.g. 35202-1234567-1.')).toBeInTheDocument();
    expect(screen.getByText('Please enter a complete address.')).toBeInTheDocument();
    expect(screen.getAllByText('Enter a Pakistani mobile number, e.g. 0300-1234567.')).toHaveLength(2);
    expect(screen.getByText('Please fix the fields marked in red.')).toBeInTheDocument();
    // Still on the customer step.
    expect(screen.getByText('Customer Details')).toBeInTheDocument();
    expect(screen.queryByText('Financed Smartphone Specs')).not.toBeInTheDocument();
  });

  it('clears a message as soon as that box is corrected', async () => {
    open();
    await screen.findByText('Customer Details');
    next();
    await screen.findByText('Customer name must be at least 3 characters.');

    fill(screen.getByPlaceholderText('e.g. Muhammad Aslam'), 'Muhammad Aslam');

    expect(screen.queryByText('Customer name must be at least 3 characters.')).not.toBeInTheDocument();
    // The others are still wrong, and still say so.
    expect(screen.getByText('Please enter a complete address.')).toBeInTheDocument();
  });

  it('refuses an IMEI that fails the checksum', async () => {
    open();
    await fillCustomer();
    next();
    fill(await screen.findByPlaceholderText('15-digit IMEI'), '123456789012345');

    next();

    expect(await screen.findByText(/IMEI must be 15 digits with a valid checksum/)).toBeInTheDocument();
    expect(screen.queryByText('Installment Structure')).not.toBeInTheDocument();
  });

  it('refuses a down payment that is not less than the price', async () => {
    open();
    await reachFinancing();
    fill(screen.getByDisplayValue('13500'), '54000');

    next();

    expect(await screen.findByText('Down payment must be less than the phone price.')).toBeInTheDocument();
    expect(screen.queryByText('Installment Financing Agreement')).not.toBeInTheDocument();
  });

  it('works out the monthly installment from price, advance and months', async () => {
    open();
    await reachFinancing();

    // Rs. 54,000 less Rs. 13,500 over 6 months.
    expect(screen.getByText('Rs. 40,500')).toBeInTheDocument();
    expect(screen.getByText('Rs. 6,750')).toBeInTheDocument();

    fill(screen.getByDisplayValue('13500'), '14000');
    fireEvent.change(screen.getByDisplayValue('6 Months'), { target: { value: '12' } });

    expect(screen.getByText('Rs. 40,000')).toBeInTheDocument();
    expect(screen.getByText('Rs. 3,333')).toBeInTheDocument();
  });
});

describe('registering a financed sale — phone support check', () => {
  async function reachDevice() {
    await fillCustomer();
    next();
    await screen.findByText('Phone check');
  }

  it('says a current Android phone is fully supported', async () => {
    open();
    await reachDevice();
    expect(screen.getByText(/Fully supported/)).toBeInTheDocument();
    expect(screen.queryByText(/No lock will be used/)).not.toBeInTheDocument();
  });

  it('warns that Android 8–10 locks but has weak reset protection', async () => {
    open();
    await reachDevice();
    fireEvent.change(screen.getByDisplayValue('Android 11 or newer'), { target: { value: '8-10' } });

    expect(screen.getByText(/Lock works, reset protection does not/)).toBeInTheDocument();
    expect(screen.queryByText(/No lock will be used/)).not.toBeInTheDocument();
  });

  it('tells the shop a phone without Play Store cannot be locked', async () => {
    open();
    await reachDevice();
    fireEvent.change(screen.getByDisplayValue('Yes, Play Store works'), { target: { value: 'no' } });

    expect(screen.getByText(/No Google Play, so no lock/)).toBeInTheDocument();
    expect(screen.getByText(/No lock will be used and no QR is needed/)).toBeInTheDocument();
  });

  it('registers an iPhone as a sale without a lock, and shows no QR', async () => {
    const { api } = open('DEALER_ADMIN', {
      'POST /customers': { success: true, customer: { id: 'cust-9' }, device: { id: 'dev-9', noLock: true } },
    });
    await reachDevice();
    fireEvent.change(screen.getByDisplayValue('Samsung'), { target: { value: 'Apple' } });

    expect(screen.getByText(/iPhone cannot be locked/)).toBeInTheDocument();
    // The Android questions no longer apply.
    expect(screen.getByDisplayValue('Android 11 or newer')).toBeDisabled();

    fill(screen.getByPlaceholderText('15-digit IMEI'), VALID_IMEI);
    next();
    await screen.findByText('Installment Structure');
    next();
    expect(await screen.findByText(/Sold without a lock:/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve & Register Sale' }));

    expect(await screen.findByText('Sale registered without a lock')).toBeInTheDocument();
    expect(lastSale(api).noLock).toBe(true);
    expect(screen.queryByAltText('QR code to scan on the new phone')).not.toBeInTheDocument();
  });

  it('warns when the shop has no reset-protection account, and only the owner is sent to Settings', async () => {
    open('DEALER_STAFF', {
      'GET /enrollment/readiness': { frpConfigured: false, frpAccountsCount: 0, provisioningReady: true },
    });
    await reachDevice();

    expect(await screen.findByText('Factory Reset Protection is off for this shop')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /How to get Google Account ID/ })).toBeInTheDocument();
    // Staff cannot open Settings, so they are not offered it.
    expect(screen.queryByRole('button', { name: 'Open Settings' })).not.toBeInTheDocument();
  });

  it('offers the owner a way to Settings from the same warning', async () => {
    const { onClose } = open('DEALER_ADMIN', {
      'GET /enrollment/readiness': { frpConfigured: false, frpAccountsCount: 0, provisioningReady: true },
    });
    await reachDevice();

    fireEvent.click(await screen.findByRole('button', { name: 'Open Settings' }));

    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText('Went to /settings')).toBeInTheDocument();
  });
});

describe('registering a financed sale — sending it', () => {
  it('sends the customer, phone and plan exactly as entered and shows the QR', async () => {
    const { api, onSuccess, onClose } = open();
    await reachReview();

    // The review step repeats the figures the customer is agreeing to.
    expect(screen.getByText('Rs. 54,000 / Rs. 13,500')).toBeInTheDocument();
    expect(screen.getByText(/Rs\. 6,750 \/ month × 6 months/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve & Generate QR' }));

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
    expect(sent.device).toMatchObject({ brand: 'Samsung', imei: VALID_IMEI, purchasePrice: 54000 });
    expect(sent.plan).toMatchObject({ downPayment: 13500, totalInstallments: 6, gracePeriodDays: 3 });
    expect(sent.noLock).toBe(false);
    expect(api.to('POST /customers')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('opens the QR page for the new phone', async () => {
    open();
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Approve & Generate QR' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Open QR page' }));

    expect(await screen.findByText('Went to /enrollment?device=dev-9')).toBeInTheDocument();
  });

  it('warns when the server cannot serve the app download for this QR', async () => {
    open('DEALER_ADMIN', { 'POST /customers': { ...SALE_CREATED, qrProvisioningReady: false } });
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Approve & Generate QR' }));

    expect(await screen.findByText(/this QR cannot install the app yet/)).toBeInTheDocument();
  });

  it('refuses the sale when the shop has no locks left, and shows why', async () => {
    const refusal =
      'You have no device locks left. Each handset needs its own lock, and a lock is not returned when a plan is paid off. Buy a pack before registering another financed sale.';
    const { api, onSuccess } = open('DEALER_ADMIN', { 'POST /customers': fail(403, refusal) });
    await reachReview();

    fireEvent.click(screen.getByRole('button', { name: 'Approve & Generate QR' }));

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    // Nothing was registered: still on the review step, no QR, and the button is usable again.
    expect(screen.getByText('Installment Financing Agreement')).toBeInTheDocument();
    expect(screen.queryByText("Scan this QR on the customer's phone")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve & Generate QR' })).toBeEnabled());
    expect(api.to('POST /customers')).toHaveLength(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('takes the shop back to the box the server rejected', async () => {
    open('DEALER_ADMIN', {
      'POST /customers': fail(422, 'Validation failed', {
        details: [{ field: 'device.imei', message: 'This IMEI failed the checksum.' }],
      }),
    });
    await reachReview();

    fireEvent.click(screen.getByRole('button', { name: 'Approve & Generate QR' }));

    // Back on the device step, with the server's words under the IMEI box.
    expect(await screen.findByText('Financed Smartphone Specs')).toBeInTheDocument();
    expect(screen.getAllByText('This IMEI failed the checksum.').length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('15-digit IMEI')).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not register twice when the button is pressed twice', async () => {
    const { api } = open();
    await reachReview();
    const approve = screen.getByRole('button', { name: 'Approve & Generate QR' });

    fireEvent.click(approve);
    fireEvent.click(approve);

    await screen.findByText("Scan this QR on the customer's phone");
    expect(api.to('POST /customers')).toHaveLength(1);
  });
});

describe('registering a financed sale — a returning customer', () => {
  it('adds another phone for a CNIC already on file', async () => {
    // The server finds the CNIC, attaches the sale to the existing record and
    // answers exactly as for a new customer.
    const { api } = open('DEALER_STAFF', {
      'POST /customers': { ...SALE_CREATED, customer: { id: 'cust-existing', name: 'Muhammad Aslam' } },
    });
    await reachReview();

    fireEvent.click(screen.getByRole('button', { name: 'Approve & Generate QR' }));

    expect(await screen.findByText("Scan this QR on the customer's phone")).toBeInTheDocument();
    expect(screen.getByText(/Samsung Galaxy A15 for Muhammad Aslam/)).toBeInTheDocument();
    expect(lastSale(api).customer.cnic).toBe('35202-1234567-1');
  });

  it('explains when the CNIC is on file under a different name', async () => {
    const refusal =
      'This CNIC is already on file for Muhammad Aslam Khan. To sell them another phone, enter the name exactly as on file. If this is a different person, check the CNIC.';
    open('DEALER_STAFF', { 'POST /customers': fail(409, refusal) });
    await reachReview();

    fireEvent.click(screen.getByRole('button', { name: 'Approve & Generate QR' }));

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(screen.queryByText("Scan this QR on the customer's phone")).not.toBeInTheDocument();

    // The shop can go back, correct the name and try again without retyping the rest.
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByPlaceholderText('35202-1234567-1')).toHaveValue('35202-1234567-1');
  });

  it('refuses a duplicate IMEI with the server message', async () => {
    const refusal = 'A device with this IMEI is already registered in the system.';
    open('DEALER_STAFF', { 'POST /customers': fail(409, refusal) });
    await reachReview();

    fireEvent.click(screen.getByRole('button', { name: 'Approve & Generate QR' }));

    expect(await screen.findByText(refusal)).toBeInTheDocument();
  });
});
