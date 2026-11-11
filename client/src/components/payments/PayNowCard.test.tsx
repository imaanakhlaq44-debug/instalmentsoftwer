import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PayNowCard } from './PayNowCard.js';
import { ApiService } from '../../services/api.js';

const showToast = vi.fn();

vi.mock('../../context/AuthContext.js', () => ({
  useAuth: () => ({ user: { customerId: 'cust-1' }, showToast }),
}));

const plan = {
  id: 'plan-1', status: 'CURRENT', remainingBalance: 27_000, outstandingLateFees: 0, creditBalance: 0, monthlyInstallment: 6_750,
};

function stubApi(options: { enabled: boolean }) {
  vi.spyOn(ApiService, 'getGatewayOptions').mockResolvedValue({
    enabled: options.enabled,
    providers: options.enabled ? [{ id: 'JAZZCASH', label: 'JazzCash' }] : [],
  });
  vi.spyOn(ApiService, 'getCustomer').mockResolvedValue({ plans: [plan] } as any);
}

beforeEach(() => {
  showToast.mockReset();
  window.history.replaceState(null, '', '/payments');
});

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll('form').forEach((form) => form.remove());
});

describe('PayNowCard', () => {
  it('renders nothing when the shop has no gateway', async () => {
    stubApi({ enabled: false });
    const { container } = render(<PayNowCard onPaid={vi.fn()} />);

    await waitFor(() => expect(ApiService.getGatewayOptions).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(ApiService.getCustomer).not.toHaveBeenCalled();
  });

  it('offers Pay now with the monthly installment filled in', async () => {
    stubApi({ enabled: true });
    render(<PayNowCard onPaid={vi.fn()} />);

    expect(await screen.findByRole('button', { name: 'Pay now · JazzCash' })).toBeEnabled();
    expect(screen.getByLabelText('Amount to pay')).toHaveValue(6_750);
  });

  it('will not start a checkout for more than is owed', async () => {
    stubApi({ enabled: true });
    const create = vi.spyOn(ApiService, 'createGatewayCheckout');
    render(<PayNowCard onPaid={vi.fn()} />);

    const amount = await screen.findByLabelText('Amount to pay');
    await userEvent.clear(amount);
    await userEvent.type(amount, '27001');

    expect(screen.getByRole('button', { name: 'Pay now · JazzCash' })).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });

  it('posts the signed fields, untouched, to the gateway page', async () => {
    stubApi({ enabled: true });
    const fields = { pp_Amount: '675000', pp_TxnRefNo: 'T2026111112000012345', pp_SecureHash: 'ABC123' };
    const create = vi.spyOn(ApiService, 'createGatewayCheckout').mockResolvedValue({
      reference: fields.pp_TxnRefNo,
      amount: 6_750,
      redirect: { url: 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/', method: 'POST', fields },
    });
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);

    render(<PayNowCard onPaid={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pay now · JazzCash' }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({ planId: 'plan-1', amount: 6_750, provider: 'JAZZCASH' });

    const form = document.querySelector('form')!;
    expect(form.method.toUpperCase()).toBe('POST');
    expect(form.action).toBe('https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/');
    const posted = Object.fromEntries([...form.querySelectorAll('input')].map((i) => [i.name, i.value]));
    expect(posted).toEqual(fields);
  });

  it('refuses to post to a page that is not https', async () => {
    stubApi({ enabled: true });
    vi.spyOn(ApiService, 'createGatewayCheckout').mockResolvedValue({
      reference: 'T1', amount: 6_750, redirect: { url: 'http://evil.test/pay', method: 'POST', fields: {} },
    });
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);

    render(<PayNowCard onPaid={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pay now · JazzCash' }));

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(submit).not.toHaveBeenCalled();
  });

  it('shows the result the server recorded, not the one the address claims', async () => {
    stubApi({ enabled: true });
    // The address says "paid"; the server says the checkout failed.
    window.history.replaceState(null, '', '/payments?gateway=paid&ref=T2026111112000012345');
    vi.spyOn(ApiService, 'getGatewayCheckout').mockResolvedValue({
      reference: 'T2026111112000012345', amount: 6_750, status: 'FAILED',
    });
    const onPaid = vi.fn();

    render(<PayNowCard onPaid={onPaid} />);

    expect(await screen.findByText(/The payment was not completed/)).toBeInTheDocument();
    expect(onPaid).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it('confirms a paid checkout with its receipt number', async () => {
    stubApi({ enabled: true });
    window.history.replaceState(null, '', '/payments?gateway=paid&ref=T2026111112000012345');
    vi.spyOn(ApiService, 'getGatewayCheckout').mockResolvedValue({
      reference: 'T2026111112000012345', amount: 6_750, status: 'PAID', receiptNumber: 'RCP-2026-000042',
    });
    const onPaid = vi.fn();

    render(<PayNowCard onPaid={onPaid} />);

    expect(await screen.findByText('Payment received. Thank you.')).toBeInTheDocument();
    expect(screen.getByText(/RCP-2026-000042/)).toBeInTheDocument();
    expect(onPaid).toHaveBeenCalledTimes(1);
  });
});
