import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getWhatsAppMessage = vi.fn();
const recordWhatsAppOpened = vi.fn();
const showToast = vi.fn();

vi.mock('../../services/api.js', () => ({
  ApiService: {
    getWhatsAppMessage: (...args: unknown[]) => getWhatsAppMessage(...args),
    recordWhatsAppOpened: (...args: unknown[]) => recordWhatsAppOpened(...args),
  },
}));

vi.mock('../../context/AuthContext.js', () => ({
  useAuth: () => ({ showToast }),
}));

import { WhatsAppButton } from './WhatsAppButton.js';
import { toRomanUrdu } from '../../i18n/translate.js';

const MESSAGE = 'Assalam o Alaikum Kashif Mehmood,\nAap ke Vivo Y27 5G ki 2 qist(ein), kul Rs. 12,500, late hain.\nAl-Madina Mobile Hub — 0300-8451299';
const URL = `https://wa.me/923451239874?text=${encodeURIComponent(MESSAGE)}`;

beforeEach(() => {
  getWhatsAppMessage.mockResolvedValue({ message: MESSAGE, url: URL, phone: '0345-1239874' });
  recordWhatsAppOpened.mockResolvedValue({ success: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderButton = (props = {}) =>
  render(<WhatsAppButton customerId="cust-6" customerName="Kashif Mehmood" kind="OVERDUE" {...props} />);

describe('WhatsAppButton', () => {
  it('asks the server for nothing until it is pressed', () => {
    renderButton();

    expect(screen.getByRole('button', { name: 'WhatsApp Kashif Mehmood' })).toBeInTheDocument();
    expect(getWhatsAppMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the server’s message and links to wa.me with the international number', async () => {
    const user = userEvent.setup();
    renderButton({ planId: 'plan-6' });

    await user.click(screen.getByRole('button', { name: 'WhatsApp Kashif Mehmood' }));

    expect(getWhatsAppMessage).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust-6', kind: 'OVERDUE', planId: 'plan-6' })
    );

    const preview = await screen.findByTestId('whatsapp-message');
    expect(preview).toHaveTextContent('Rs. 12,500');
    // The customer's words are not the dashboard's to translate.
    expect(preview).toHaveAttribute('data-i18n-skip', 'true');

    const link = screen.getByRole('link', { name: /Open WhatsApp/ });
    expect(link).toHaveAttribute('href', URL);
    expect(link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/923\d{9}\?text=/);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('records the open only when WhatsApp is actually opened', async () => {
    const user = userEvent.setup();
    const onOpened = vi.fn();
    renderButton({ onOpened });

    await user.click(screen.getByRole('button', { name: 'WhatsApp Kashif Mehmood' }));
    await screen.findByTestId('whatsapp-message');

    // Looking at the preview is not opening WhatsApp.
    expect(recordWhatsAppOpened).not.toHaveBeenCalled();

    await user.click(screen.getByRole('link', { name: /Open WhatsApp/ }));

    expect(recordWhatsAppOpened).toHaveBeenCalledTimes(1);
    expect(recordWhatsAppOpened).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cust-6', kind: 'OVERDUE' }));
    await waitFor(() => expect(onOpened).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancelling records nothing', async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: 'WhatsApp Kashif Mehmood' }));
    await screen.findByTestId('whatsapp-message');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(recordWhatsAppOpened).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('fetches a different message when another type is picked', async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: 'WhatsApp Kashif Mehmood' }));
    await screen.findByTestId('whatsapp-message');
    await user.click(screen.getByRole('button', { name: 'Lock warning' }));

    await waitFor(() =>
      expect(getWhatsAppMessage).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'LOCK_WARNING' }))
    );
  });

  it('shows the server’s reason and offers no link when the message would be untrue', async () => {
    getWhatsAppMessage.mockRejectedValue(new Error('This customer has no overdue installment.'));
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: 'WhatsApp Kashif Mehmood' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This customer has no overdue installment.');
    expect(screen.queryByRole('link', { name: /Open WhatsApp/ })).not.toBeInTheDocument();
  });

  it('says "opened", never "sent", about what it records', async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: 'WhatsApp Kashif Mehmood' }));
    await screen.findByTestId('whatsapp-message');

    expect(screen.getByText(/We record that it was opened and by whom — not that it was sent or delivered/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Send/ })).not.toBeInTheDocument();
  });
});

describe('WhatsApp in Roman Urdu', () => {
  it.each([
    ['Open WhatsApp', 'WhatsApp kholein'],
    ['Due reminder', 'Qist ki yaad dehani'],
    ['Overdue notice', 'Late qist ka notice'],
    ['Lock warning', 'Lock ki warning'],
    ['WhatsApp opened', 'WhatsApp khola gaya'],
    ['WhatsApp message language', 'WhatsApp message ki zaban'],
    ['WhatsApp Kashif Mehmood', 'Kashif Mehmood ko WhatsApp karein'],
    ['WhatsApp message for Kashif Mehmood', 'Kashif Mehmood ke liye WhatsApp message'],
  ])('%s → %s', (english, roman) => {
    expect(toRomanUrdu(english)).toBe(roman);
  });

  it('keeps the honest wording honest', () => {
    const roman = toRomanUrdu(
      'This opens your own WhatsApp with the message typed in. You press send there. We record that it was opened and by whom — not that it was sent or delivered, because that cannot be known.'
    );
    expect(roman).toContain('kis ne khola');
    expect(roman).toContain('maloom nahin ho sakta');
  });
});
