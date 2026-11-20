import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { ForgotPasswordPage } from './ForgotPasswordPage.js';
import { ApiService } from '../services/api.js';

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const LoginStub = () => {
  const state = useLocation().state as { notice?: string; email?: string } | null;
  return <p>login: {state?.notice} / {state?.email}</p>;
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/login" element={<LoginStub />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ForgotPasswordPage', () => {
  it('sends a code, then sets the new password and returns to sign-in', async () => {
    const user = userEvent.setup();
    vi.spyOn(ApiService, 'passwordResetStatus').mockResolvedValue({ available: true });
    const forgot = vi
      .spyOn(ApiService, 'forgotPassword')
      .mockResolvedValue({ available: true, message: 'A 6-digit code has been sent by SMS.' });
    const reset = vi
      .spyOn(ApiService, 'resetPasswordWithCode')
      .mockResolvedValue({ success: true, message: 'Your password has been changed.' });

    renderPage();

    await user.type(await screen.findByLabelText('Email address'), 'owner@shop.pk');
    await user.click(screen.getByRole('button', { name: /Send code/i }));
    expect(forgot).toHaveBeenCalledWith('owner@shop.pk');
    expect(await screen.findByText(/6-digit code has been sent/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('6-digit code'), '12a3456');
    await user.type(screen.getByLabelText('New password'), 'NewPass2026');
    await user.type(screen.getByLabelText('Confirm new password'), 'NewPass2026');
    await user.click(screen.getByRole('button', { name: /Set new password/i }));

    expect(reset).toHaveBeenCalledWith('owner@shop.pk', '123456', 'NewPass2026');
    expect(await screen.findByText('login: Your password has been changed. / owner@shop.pk')).toBeInTheDocument();
  });

  it('does not send mismatched passwords', async () => {
    const user = userEvent.setup();
    vi.spyOn(ApiService, 'passwordResetStatus').mockResolvedValue({ available: true });
    vi.spyOn(ApiService, 'forgotPassword').mockResolvedValue({ available: true, message: 'Sent.' });
    const reset = vi.spyOn(ApiService, 'resetPasswordWithCode');

    renderPage();
    await user.type(await screen.findByLabelText('Email address'), 'owner@shop.pk');
    await user.click(screen.getByRole('button', { name: /Send code/i }));
    await user.type(await screen.findByLabelText('6-digit code'), '123456');
    await user.type(screen.getByLabelText('New password'), 'NewPass2026');
    await user.type(screen.getByLabelText('Confirm new password'), 'OtherPass2026');
    await user.click(screen.getByRole('button', { name: /Set new password/i }));

    expect(reset).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/do not match/);
  });

  it('offers WhatsApp support when the server cannot send SMS', async () => {
    vi.spyOn(ApiService, 'passwordResetStatus').mockResolvedValue({ available: false });
    renderPage();
    const link = await screen.findByRole('link', { name: /WhatsApp support/i });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/923211144477\?text=/);
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
  });
});
