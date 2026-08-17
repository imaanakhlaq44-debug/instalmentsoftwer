import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AuthProvider, useAuth } from './AuthContext.js';
import { TOKEN_STORAGE_KEY } from '../services/api.js';
import { UserRole } from '../types/index.js';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubApi(handler: Handler) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

function session(role: UserRole = 'DEALER_ADMIN', overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'user-1', name: 'Tariq', email: 'tariq@almadinamobiles.pk', role, ...overrides },
    dealer: { id: 'dealer-1', name: 'Al-Madina Mobile Hub' },
    token: 'issued-token',
  };
}

/** Surfaces the pieces of the context the tests assert on. */
const Probe = () => {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="bootstrapping">{String(auth.isBootstrapping)}</span>
      <span data-testid="role">{auth.role ?? 'none'}</span>
      <span data-testid="name">{auth.user?.name ?? 'none'}</span>
      <span data-testid="dealer">{auth.selectedDealerId ?? 'none'}</span>
      <span data-testid="flags">
        {[auth.isSuperAdmin && 'super', auth.isDealerAdmin && 'admin', auth.isStaff && 'staff', auth.isCustomer && 'customer']
          .filter(Boolean)
          .join(',')}
      </span>
      <button onClick={() => auth.login('tariq@almadinamobiles.pk', 'Emishield#2026').catch(() => undefined)}>
        Sign in
      </button>
      <button onClick={() => auth.logout()}>Sign out</button>
      <button onClick={() => auth.setSelectedDealerId('dealer-9')}>Switch dealer</button>
    </div>
  );
};

function renderAuth() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}

const settled = () => waitFor(() => expect(screen.getByTestId('bootstrapping')).toHaveTextContent('false'));

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('bootstrapping', () => {
  it('starts signed out when there is no stored token, without calling the server', async () => {
    const fetchSpy = stubApi(() => json({}));

    renderAuth();
    await settled();

    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('restores a session from a stored token', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'stored-token');
    stubApi((url) => (url.endsWith('/auth/me') ? json(session()) : json({})));

    renderAuth();
    await settled();

    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('name')).toHaveTextContent('Tariq');
  });

  it('sends the stored token on the restore request', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'stored-token');
    const fetchSpy = stubApi(() => json(session()));

    renderAuth();
    await settled();

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer stored-token');
  });

  it('discards a token the server rejects', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'stale-token');
    stubApi(() => json({ error: 'Your session has expired.' }, 401));

    renderAuth();
    await settled();

    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });
});

describe('login', () => {
  it('stores the token and adopts the session', async () => {
    stubApi((url) => (url.endsWith('/auth/login') ? json(session()) : json({})));

    renderAuth();
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('true'));
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('issued-token');
    expect(screen.getByTestId('role')).toHaveTextContent('DEALER_ADMIN');
  });

  it('surfaces the server\'s message and stays signed out on a bad password', async () => {
    stubApi(() => json({ error: 'Invalid email or password.' }, 401));

    renderAuth();
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Invalid email or password.')).toBeInTheDocument());
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
  });

  /**
   * A failed sign-in is the user mistyping a password, not a dead session. If
   * the 401 handler fired here it would show "your session has expired" to
   * somebody who was never signed in.
   */
  it('does not treat a failed sign-in as an expired session', async () => {
    stubApi(() => json({ error: 'Invalid email or password.' }, 401));

    renderAuth();
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Invalid email or password.')).toBeInTheDocument());
    expect(screen.queryByText(/session has expired/i)).not.toBeInTheDocument();
  });

  it('warns a user signing in with a temporary password', async () => {
    stubApi((url) =>
      url.endsWith('/auth/login') ? json(session('DEALER_STAFF', { mustChangePassword: true })) : json({})
    );

    renderAuth();
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText(/must change your temporary password/i)).toBeInTheDocument());
  });
});

describe('logout', () => {
  it('clears the stored token', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'stored-token');
    stubApi(() => json(session()));

    renderAuth();
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
  });

  it('signs the user out even when the server call fails', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'stored-token');
    stubApi((url) => {
      if (url.endsWith('/auth/logout')) throw new Error('network down');
      return json(session());
    });

    renderAuth();
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
  });
});

/**
 * The server takes dealerId from the JWT and ignores the query parameter for
 * everyone but a super admin. The client mirrors that rather than sending a
 * value it knows will be discarded.
 */
describe('dealer switching', () => {
  it('lets a super admin look at another dealership', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'stored-token');
    stubApi(() => json(session('SUPER_ADMIN')));

    renderAuth();
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Switch dealer' }));
    expect(screen.getByTestId('dealer')).toHaveTextContent('dealer-9');
  });

  it.each<UserRole>(['DEALER_ADMIN', 'DEALER_STAFF', 'CUSTOMER'])(
    'ignores the switch for a %s',
    async (role) => {
      localStorage.setItem(TOKEN_STORAGE_KEY, 'stored-token');
      stubApi(() => json(session(role)));

      renderAuth();
      await settled();

      await userEvent.click(screen.getByRole('button', { name: 'Switch dealer' }));
      expect(screen.getByTestId('dealer')).toHaveTextContent('dealer-1');
    }
  );
});

describe('role flags', () => {
  it.each([
    { role: 'SUPER_ADMIN' as UserRole, expected: 'super,admin,staff' },
    { role: 'DEALER_ADMIN' as UserRole, expected: 'admin,staff' },
    { role: 'DEALER_STAFF' as UserRole, expected: 'staff' },
    { role: 'CUSTOMER' as UserRole, expected: 'customer' },
  ])('$role resolves to $expected', async ({ role, expected }) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'stored-token');
    stubApi(() => json(session(role)));

    renderAuth();
    await settled();

    expect(screen.getByTestId('flags')).toHaveTextContent(expected);
  });
});

describe('session expiry', () => {
  it('tears the session down when any request comes back 401', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'stored-token');

    let meCalls = 0;
    stubApi((url) => {
      if (url.endsWith('/auth/me')) {
        meCalls += 1;
        // First call restores the session; a later one finds it expired.
        return meCalls === 1 ? json(session()) : json({ error: 'Session expired' }, 401);
      }
      return json({ error: 'Session expired' }, 401);
    });

    renderAuth();
    await settled();
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');

    // An ordinary authenticated request now fails with 401. It must sign the
    // app out rather than leave the user on a dashboard that cannot load.
    const { ApiService } = await import('../services/api.js');
    await act(async () => {
      await ApiService.getDevices({}).catch(() => undefined);
    });

    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('false'));
    expect(screen.getByText(/session has expired/i)).toBeInTheDocument();
  });
});

describe('useAuth', () => {
  it('refuses to be used outside the provider', () => {
    // React logs the thrown error; silence it so the run stays readable.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Probe />)).toThrow(/must be used within an AuthProvider/i);

    consoleError.mockRestore();
  });
});
