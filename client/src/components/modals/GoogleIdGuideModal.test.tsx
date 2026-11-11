import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoogleIdGuideModal } from './GoogleIdGuideModal.js';

afterEach(() => {
  cleanup();
});

describe('GoogleIdGuideModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<GoogleIdGuideModal isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows bilingual warning, People API Explorer link, and language tabs when open', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onGoToSettings = vi.fn();

    render(<GoogleIdGuideModal isOpen={true} onClose={onClose} onGoToSettings={onGoToSettings} />);

    // Both English and Roman Urdu visible by default
    expect(screen.getByText(/Do NOT enter your Gmail address or phone number/i)).toBeInTheDocument();
    expect(screen.getByText(/Yahan @gmail\.com ya phone number har giz mat likhein/i)).toBeInTheDocument();

    const finderLink = screen.getByRole('link', { name: /Open Google ID Finder/i });
    expect(finderLink).toHaveAttribute('href', 'https://developers.google.com/people/api/rest/v1/people/get');

    // Marked data-i18n-skip so PageTranslator leaves bilingual tabs untouched
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('[data-i18n-skip="true"]')).not.toBeNull();

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

