import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoogleIdGuideModal, extractGoogleAccountId } from './GoogleIdGuideModal.js';

afterEach(() => {
  cleanup();
});

describe('extractGoogleAccountId', () => {
  it('takes the number out of a Google Maps "Your contributions" link', () => {
    expect(
      extractGoogleAccountId('https://www.google.com/maps/contrib/118223344556677889900/reviews?entry=ttu')
    ).toBe('118223344556677889900');
  });

  it('accepts the bare number and refuses an email or a link without one', () => {
    expect(extractGoogleAccountId(' 118223344556677889900 ')).toBe('118223344556677889900');
    expect(extractGoogleAccountId('yourshop@gmail.com')).toBeNull();
    expect(extractGoogleAccountId('https://www.google.com/maps/@31.5,74.3,15z')).toBeNull();
  });
});

describe('GoogleIdGuideModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<GoogleIdGuideModal isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the Google Maps steps, the language tabs and the link helper', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onGoToSettings = vi.fn();

    render(<GoogleIdGuideModal isOpen={true} onClose={onClose} onGoToSettings={onGoToSettings} />);

    // Both English and Roman Urdu visible by default
    expect(screen.getByText(/Do NOT enter your Gmail address or phone number/i)).toBeInTheDocument();
    expect(screen.getByText(/Yahan @gmail\.com ya phone number har giz mat likhein/i)).toBeInTheDocument();

    const mapsLink = screen.getByRole('link', { name: /Open Google Maps/i });
    expect(mapsLink).toHaveAttribute('href', 'https://www.google.com/maps');
    expect(screen.getByText(/"Your contributions"/)).toBeInTheDocument();

    // Marked data-i18n-skip so PageTranslator leaves bilingual tabs untouched
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('[data-i18n-skip="true"]')).not.toBeNull();

    // Pasting the whole link pulls out the ID
    await user.type(
      screen.getByLabelText(/Pura link yahan paste karein/i),
      'https://www.google.com/maps/contrib/104455667788990011223/photos'
    );
    expect(screen.getByText('104455667788990011223')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy ID/i })).toBeInTheDocument();

    // Switch to Roman Urdu only
    await user.click(screen.getByRole('button', { name: 'Roman Urdu' }));
    expect(screen.queryByText(/Do NOT enter your Gmail address or phone number/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Yahan @gmail\.com ya phone number har giz mat likhein/i)).toBeInTheDocument();

    // Switch to English only
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByText(/Do NOT enter your Gmail address or phone number/i)).toBeInTheDocument();
    expect(screen.queryByText(/Yahan @gmail\.com ya phone number har giz mat likhein/i)).not.toBeInTheDocument();

    // Settings navigation triggers close + callback
    await user.click(screen.getByRole('button', { name: /Open Settings/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onGoToSettings).toHaveBeenCalledTimes(1);
  });
});
