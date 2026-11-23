import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { ForgotPasswordPage } from './ForgotPasswordPage.js';
import { ResetPasswordPage } from './ResetPasswordPage.js';
import { ApiService } from '../services/api.js';

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const TOKEN = 'ab'.repeat(32);

const LoginStub = () => {
  const state = useLocation().state as { notice?: string; email?: string } | null;
  return <p>login: {state?.notice} / {state?.email}</p>;
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<LoginStub />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('password reset by email link', () => {
  it('asks for the email, then says to check the inbox instead of asking for a code', async () => {
    const user = userEvent.setup();
    vi.spyOn(ApiService, 'passwordResetStatus').mockResolvedValue({ available: true, channel: 'email' });
    const forgot = vi
      .spyOn(ApiService, 'forgotPassword')
      .mockResolvedValue({ available: true, channel: 'email', message: 'A link to reset the password has been sent.' });

    renderAt('/forgot-password');
    await user.type(await screen.findByLabelText('Email address'), 'owner@shop.pk');
    await user.click(screen.getByRole('button', { name: /Email me a reset link/i }));

    expect(forgot).toHaveBeenCalledWith('owner@shop.pk');
    expect(await screen.findByText(/link to reset the password has been sent/)).toBeInTheDocument();
    expect(screen.queryByLabelText('6-digit code')).not.toBeInTheDocument();
  });

  it('the link sets a new password and returns to sign-in with the email filled', async () => {
    const user = userEvent.setup();
    const reset = vi
      .spyOn(ApiService, 'resetPasswordWithLink')
      .mockResolvedValue({ success: true, message: 'Your password has been changed.', email: 'owner@shop.pk' });

    renderAt(`/reset-password?id=pwr-1&token=${TOKEN}`);
    await user.type(screen.getByLabelText('New password'), 'NewPass2026');
    await user.type(screen.getByLabelText('Confirm new password'), 'NewPass2026');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(reset).toHaveBeenCalledWith('pwr-1', TOKEN, 'NewPass2026');
    expect(await screen.findByText('login: Your password has been changed. / owner@shop.pk')).toBeInTheDocument();
  });

  it('a broken link offers a new one instead of a form', () => {
    renderAt('/reset-password?id=pwr-1&token=short');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ask for a new link' })).toHaveAttribute('href', '/forgot-password');
  });
});
