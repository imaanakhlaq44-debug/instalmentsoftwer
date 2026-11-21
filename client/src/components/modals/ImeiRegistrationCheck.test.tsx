import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { ImeiRegistrationCheck } from './ImeiRegistrationCheck.js';
import { mockApi, fail } from '../../test/harness.js';

/**
 * The sale form's early warning for an IMEI that is already registered — the
 * phone the shop took back and is selling again — and the owner's way to close
 * the old registration without leaving the form.
 */

const IMEI = '490154203237518';
const STATUS_KEY = `GET /devices/imei-status/${IMEI}`;
const CLOSE_KEY = 'POST /devices/dev-old/close-registration';

const registered = (canClose: boolean) => ({
  registered: true,
  sameShop: true,
  canClose,
  device: {
    id: 'dev-old',
    brand: 'Samsung',
    model: 'Galaxy A15',
    status: 'LOCKED',
    registeredAt: '2026-06-01T10:00:00Z',
    customerName: 'Muhammad Aslam',
    plan: { status: 'OVERDUE', remainingBalance: 18000, outstandingLateFees: 500 },
  },
});

describe('ImeiRegistrationCheck', () => {
  it('stays silent until the IMEI is complete, and for a free IMEI', async () => {
    const api = mockApi({ role: 'DEALER_ADMIN', routes: { [STATUS_KEY]: { registered: false } } });
    const { rerender, container } = render(<ImeiRegistrationCheck imei="49015420" />);
    rerender(<ImeiRegistrationCheck imei={IMEI} />);
    await waitFor(() => expect(api.to(STATUS_KEY)).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the owner who holds the IMEI and closes the old registration', async () => {
    let closed = false;
    const api = mockApi({
      role: 'DEALER_ADMIN',
      routes: {
        [STATUS_KEY]: () => (closed ? { registered: false } : registered(true)),
        [CLOSE_KEY]: () => { closed = true; return { outstandingAtClose: 18500 }; },
      },
    });
    render(<ImeiRegistrationCheck imei={IMEI} />);

    expect(await screen.findByText('This phone is already registered in your shop.')).toBeInTheDocument();
    expect(screen.getByText('Muhammad Aslam')).toBeInTheDocument();
    expect(screen.getByText('Rs 18,500')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Close old registration/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Close old registration' });
    expect(dialog).toHaveTextContent('This plan still has money owed');

    const confirm = screen.getByRole('button', { name: 'Close registration' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type the last 4 digits of the IMEI to confirm'), { target: { value: '7518' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(api.to(CLOSE_KEY)).toHaveLength(1));
    expect(api.to(CLOSE_KEY)[0].body).toEqual({ reason: 'Phone taken back from the customer', confirmImeiLast4: '7518' });
    expect(await screen.findByText(/Old registration closed/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the dialog open with the server\'s reason when closing is refused', async () => {
    mockApi({
      role: 'DEALER_ADMIN',
      routes: {
        [STATUS_KEY]: registered(true),
        [CLOSE_KEY]: fail(400, "The last 4 digits do not match this phone's IMEI."),
      },
    });
    render(<ImeiRegistrationCheck imei={IMEI} />);
    fireEvent.click(await screen.findByRole('button', { name: /Close old registration/ }));
    fireEvent.change(screen.getByLabelText('Type the last 4 digits of the IMEI to confirm'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close registration' }));
    expect(await screen.findByText("The last 4 digits do not match this phone's IMEI.")).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('tells staff to ask the owner, with no close button', async () => {
    mockApi({ role: 'DEALER_STAFF', routes: { [STATUS_KEY]: registered(false) } });
    render(<ImeiRegistrationCheck imei={IMEI} />);
    expect(await screen.findByText(/Ask the shop owner to close the old registration/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Close old registration/ })).not.toBeInTheDocument();
  });

  it('says only "another shop" for an IMEI registered elsewhere', async () => {
    mockApi({ role: 'DEALER_ADMIN', routes: { [STATUS_KEY]: { registered: true, sameShop: false, canClose: false } } });
    render(<ImeiRegistrationCheck imei={IMEI} />);
    expect(await screen.findByText(/registered with another shop/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
