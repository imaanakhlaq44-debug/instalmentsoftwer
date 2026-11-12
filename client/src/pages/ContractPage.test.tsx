import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { ContractPage } from './ContractPage.js';
import { mockApi, renderPage, fill, fail } from '../test/harness.js';
import type { UserRole } from '../types/index.js';

/**
 * The financing agreement.
 *
 * A signature here is what permits a phone to be restricted, so the page must
 * not record one without a drawn signature, a name and the declaration ticked —
 * and must say plainly when a signed agreement no longer covers the plan.
 */

const SIGNATURE = 'data:image/png;base64,SIGNATURE';

function agreement(contract: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    contract: { id: 'con-1', status: 'DRAFT', termsVersion: 3, ...contract },
    snapshot: {
      dealer: { name: 'Al-Madina Mobile Hub', city: 'Lahore', phone: '0300-8451299' },
      customer: { name: 'Muhammad Aslam', cnic: '35202-1234567-1', phone: '0300-1234567', address: 'House 12, Lahore' },
      device: { brand: 'Samsung', model: 'Galaxy A15', imei: '490154203237518' },
      plan: { totalAmount: 54000, downPayment: 13500, financedAmount: 40500, totalInstallments: 6, monthlyInstallment: 6750 },
      schedule: [
        { installmentNumber: 1, dueDate: '2026-11-05', amountDue: 6750 },
        { installmentNumber: 2, dueDate: '2026-12-05', amountDue: 6750 },
      ],
    },
    clauses: [
      { heading: '4. Restriction on default', headingUr: '۴۔ پابندی', body: 'The handset may be restricted if an installment is overdue.', bodyUr: 'قسط' },
    ],
    declaration: { en: 'I have read and accept these terms.', ur: 'میں نے شرائط پڑھ لی ہیں۔' },
    hashMatches: true,
    planMatches: true,
    planChanges: [],
    ...extra,
  };
}

function open(role: UserRole, doc: unknown = agreement(), routes: Record<string, unknown> = {}) {
  const api = mockApi({ role, routes: { 'GET /contracts/con-1': doc, ...routes } });
  renderPage(<ContractPage />, { path: '/contracts/con-1', route: '/contracts/:id' });
  return api;
}

/** The customer draws on the pad. */
function drawSignature() {
  const pad = screen.getByLabelText('Signature area');
  fireEvent.pointerDown(pad, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(pad, { clientX: 60, clientY: 30, pointerId: 1 });
  fireEvent.pointerUp(pad, { clientX: 60, clientY: 30, pointerId: 1 });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  // jsdom has no canvas. The pad only needs something to draw on and an image back.
  const context = {
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(SIGNATURE);
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
});

describe('reading the agreement', () => {
  it('shows the parties, the figures and the schedule the customer is agreeing to', async () => {
    open('DEALER_STAFF');

    expect(await screen.findByRole('heading', { name: 'Installment Financing Agreement' })).toBeInTheDocument();
    expect(screen.getByText('CNIC 35202-1234567-1')).toBeInTheDocument();
    expect(screen.getByText('IMEI 490154203237518')).toBeInTheDocument();
    expect(screen.getByText('Rs. 54,000')).toBeInTheDocument();
    expect(screen.getByText('Rs. 13,500')).toBeInTheDocument();
    expect(screen.getByText('6 × Rs. 6,750')).toBeInTheDocument();
    expect(screen.getByText('2026-12-05')).toBeInTheDocument();
    expect(screen.getByText('The handset may be restricted if an installment is overdue.')).toBeInTheDocument();
  });

  it('says so when the agreement cannot be loaded', async () => {
    open('DEALER_STAFF', fail(404, 'Contract not found.'));

    expect(await screen.findByText('This agreement could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('Contract not found.')).toBeInTheDocument();
  });
});

describe('signing', () => {
  it('records nothing until there is a signature, a name and the declaration', async () => {
    const api = open('DEALER_STAFF', agreement(), { 'POST /contracts/con-1/sign': { success: true } });
    expect(await screen.findByText('Not signed yet')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Sign with the customer/ }));
    const record = screen.getByRole('button', { name: 'Record the signature' });
    const declaration = screen.getByRole('checkbox');
    // The customer's name is filled in from the agreement.
    expect(screen.getByDisplayValue('Muhammad Aslam')).toBeInTheDocument();

    expect(record).toBeDisabled();
    fireEvent.click(declaration);
    expect(record).toBeDisabled(); // ticked, but nothing drawn

    drawSignature();
    expect(screen.getByText('Signature captured.')).toBeInTheDocument();
    expect(record).toBeEnabled();

    fireEvent.click(declaration);
    expect(record).toBeDisabled(); // drawn, but the declaration is un-ticked
    fireEvent.click(declaration);

    fill(screen.getByDisplayValue('Muhammad Aslam'), 'MA');
    expect(record).toBeDisabled(); // two letters is not a name
    fill(screen.getByDisplayValue('MA'), '  Muhammad Aslam  ');
    expect(record).toBeEnabled();

    expect(api.to('POST /contracts/con-1/sign')).toHaveLength(0);
    fireEvent.click(record);

    expect(await screen.findByText(/Agreement signed\. This device may now be managed/)).toBeInTheDocument();
    expect(api.to('POST /contracts/con-1/sign')[0].body).toEqual({
      signerName: 'Muhammad Aslam',
      signatureImage: SIGNATURE,
      declarationAccepted: true,
    });
    // The page re-reads the agreement so the signed state comes from the server.
    await waitFor(() => expect(api.to('GET /contracts/con-1').length).toBeGreaterThan(1));
    expect(screen.queryByRole('button', { name: 'Record the signature' })).not.toBeInTheDocument();
  });

  it('forgets a cleared signature', async () => {
    open('DEALER_STAFF');
    fireEvent.click(await screen.findByRole('button', { name: /Sign with the customer/ }));
    fireEvent.click(screen.getByRole('checkbox'));
    drawSignature();
    expect(screen.getByRole('button', { name: 'Record the signature' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.getByText('Ask the customer to sign above.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record the signature' })).toBeDisabled();
  });

  it('keeps the signature on screen when the server refuses it', async () => {
    open('DEALER_STAFF', agreement(), {
      'POST /contracts/con-1/sign': fail(409, 'This agreement has already been signed.'),
    });
    fireEvent.click(await screen.findByRole('button', { name: /Sign with the customer/ }));
    fireEvent.click(screen.getByRole('checkbox'));
    drawSignature();

    fireEvent.click(screen.getByRole('button', { name: 'Record the signature' }));

    expect(await screen.findByText('This agreement has already been signed.')).toBeInTheDocument();
    expect(screen.getByText('Customer signature')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record the signature' })).toBeEnabled());
  });

  it('never lets a customer take their own signature', async () => {
    open('CUSTOMER');

    expect(await screen.findByText('Not signed yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign with the customer/ })).not.toBeInTheDocument();
    // They can still read and print it.
    expect(screen.getByRole('button', { name: /Print \/ Save as PDF/ })).toBeInTheDocument();
  });
});

describe('an agreement that is already signed', () => {
  const signed = { status: 'SIGNED', signerName: 'Muhammad Aslam', signedAt: '2026-09-01T10:00:00Z', signatureImage: SIGNATURE, documentHash: 'abcdef0123456789abcdef' };

  it('shows who signed and offers no second signature', async () => {
    open('DEALER_ADMIN', agreement(signed));

    expect(await screen.findByText(/^Signed by Muhammad Aslam on/)).toBeInTheDocument();
    expect(screen.getByAltText('Customer signature')).toHaveAttribute('src', SIGNATURE);
    expect(screen.queryByRole('button', { name: /Sign with the customer/ })).not.toBeInTheDocument();
  });

  it('warns that it no longer covers a plan changed after signing', async () => {
    open('DEALER_ADMIN', agreement(signed, { planMatches: false, planChanges: ['monthly installment', 'first due date'] }));

    expect(await screen.findByText('The plan has changed since this was signed')).toBeInTheDocument();
    expect(screen.getByText(/monthly installment, first due date — changed after signing/)).toBeInTheDocument();
    expect(screen.queryByText(/^Signed by Muhammad Aslam on/)).not.toBeInTheDocument();
  });

  it('warns, differently, when the stored record itself was altered', async () => {
    open('DEALER_ADMIN', agreement(signed, { hashMatches: false, planMatches: false }));

    expect(await screen.findByText('This record no longer matches its own signature')).toBeInTheDocument();
    // An altered record is not reported as a mere plan change.
    expect(screen.queryByText('The plan has changed since this was signed')).not.toBeInTheDocument();
  });

  it('shows why a voided agreement was voided', async () => {
    open('DEALER_ADMIN', agreement({ status: 'VOID', voidReason: 'Sale cancelled; phone returned.' }));

    expect(await screen.findByText('This agreement was voided')).toBeInTheDocument();
    expect(screen.getByText('Sale cancelled; phone returned.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign with the customer/ })).not.toBeInTheDocument();
  });
});
