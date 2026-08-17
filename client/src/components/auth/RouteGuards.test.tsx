import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import { RequireAuth, RequireRole, Can, AccessDenied } from './RouteGuards.js';
import { AuthProvider } from '../../context/AuthContext.js';
import { TOKEN_STORAGE_KEY } from '../../services/api.js';
import { UserRole } from '../../types/index.js';

/**
 * The guards read from AuthContext, which bootstraps by calling `/auth/me`.
 * Stubbing fetch rather than the context keeps the real provider logic — token
 * restore, role derivation, the mustChangePassword redirect — under test.
 */
function mockSession(user: { role: UserRole; mustChangePassword?: boolean } | null) {
  if (user) localStorage.setItem(TOKEN_STORAGE_KEY, 'stored-token');

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/auth/me')) {
        if (!user) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }
        return new Response(
          JSON.stringify({
            user: {
              id: 'user-1',
              name: 'Test User',
              email: 'test@emishield.pk',
              role: user.role,
              mustChangePassword: user.mustChangePassword ?? false,
            },
            dealer: { id: 'dealer-1', name: 'Al-Madina Mobile Hub' },
            token: 'stored-token',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    })
  );
}

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<p>Sign in page</p>} />
          <Route path="/change-password" element={<p>Change your password</p>} />
          <Route path="*" element={element} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

const Dashboard = () => <p>Dashboard contents</p>;

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('RequireAuth', () => {
  it('shows a spinner while the stored session is being validated', async () => {
    mockSession({ role: 'DEALER_ADMIN' });

    renderAt('/', <RequireAuth><Dashboard /></RequireAuth>);

    // The point of the spinner: the dashboard must not flash before the token
    // has been proven.
    expect(screen.getByText(/restoring your session/i)).toBeInTheDocument();
    expect(screen.queryByText('Dashboard contents')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Dashboard contents')).toBeInTheDocument());
  });

  it('sends a signed-out visitor to the login page', async () => {
    mockSession(null);

    renderAt('/', <RequireAuth><Dashboard /></RequireAuth>);

    await waitFor(() => expect(screen.getByText('Sign in page')).toBeInTheDocument());
    expect(screen.queryByText('Dashboard contents')).not.toBeInTheDocument();
  });

  it('sends a visitor whose stored token is rejected to the login page', async () => {
    // A token is present but the server refuses it — an expired session.
    mockSession(null);
    localStorage.setItem(TOKEN_STORAGE_KEY, 'stale-token');

    renderAt('/', <RequireAuth><Dashboard /></RequireAuth>);

    await waitFor(() => expect(screen.getByText('Sign in page')).toBeInTheDocument());
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('holds a user on the change-password page until they change it', async () => {
    mockSession({ role: 'DEALER_STAFF', mustChangePassword: true });

    renderAt('/', <RequireAuth><Dashboard /></RequireAuth>);

    await waitFor(() => expect(screen.getByText('Change your password')).toBeInTheDocument());
    expect(screen.queryByText('Dashboard contents')).not.toBeInTheDocument();
  });

  it('does not redirect in a loop once they are on that page', async () => {
    mockSession({ role: 'DEALER_STAFF', mustChangePassword: true });

    renderAt('/change-password', <RequireAuth><Dashboard /></RequireAuth>);

    await waitFor(() => expect(screen.getByText('Change your password')).toBeInTheDocument());
  });
});

describe('RequireRole', () => {
  const cases: { role: UserRole; allowed: UserRole[]; renders: boolean }[] = [
    { role: 'SUPER_ADMIN', allowed: ['SUPER_ADMIN', 'DEALER_ADMIN'], renders: true },
    { role: 'DEALER_ADMIN', allowed: ['SUPER_ADMIN', 'DEALER_ADMIN'], renders: true },
    { role: 'DEALER_STAFF', allowed: ['SUPER_ADMIN', 'DEALER_ADMIN'], renders: false },
    { role: 'CUSTOMER', allowed: ['SUPER_ADMIN', 'DEALER_ADMIN'], renders: false },
  ];

  it.each(cases)('$role on an admin-only page renders: $renders', async ({ role, allowed, renders }) => {
    mockSession({ role });

    renderAt(
      '/',
      <RequireAuth>
        <RequireRole roles={allowed}><Dashboard /></RequireRole>
      </RequireAuth>
    );

    if (renders) {
      await waitFor(() => expect(screen.getByText('Dashboard contents')).toBeInTheDocument());
    } else {
      await waitFor(() => expect(screen.getByText(/don't have access/i)).toBeInTheDocument());
      expect(screen.queryByText('Dashboard contents')).not.toBeInTheDocument();
    }
  });

  it('names the roles that would be allowed', async () => {
    mockSession({ role: 'DEALER_STAFF' });

    renderAt(
      '/',
      <RequireAuth>
        <RequireRole roles={['DEALER_ADMIN']}><Dashboard /></RequireRole>
      </RequireAuth>
    );

    await waitFor(() => expect(screen.getByText(/limited to dealer admin/i)).toBeInTheDocument());
  });
});

describe('Can', () => {
  it('renders an action the role is permitted', async () => {
    mockSession({ role: 'DEALER_ADMIN' });

    renderAt(
      '/',
      <RequireAuth>
        <Can roles={['DEALER_ADMIN']}><button>Lock device</button></Can>
      </RequireAuth>
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Lock device' })).toBeInTheDocument());
  });

  it('hides an action the role is not permitted', async () => {
    mockSession({ role: 'DEALER_STAFF' });

    renderAt(
      '/',
      <RequireAuth>
        <div>
          <p>Page loaded</p>
          <Can roles={['DEALER_ADMIN']}><button>Lock device</button></Can>
        </div>
      </RequireAuth>
    );

    await waitFor(() => expect(screen.getByText('Page loaded')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Lock device' })).not.toBeInTheDocument();
  });

  it('renders the fallback instead when one is given', async () => {
    mockSession({ role: 'CUSTOMER' });

    renderAt(
      '/',
      <RequireAuth>
        <Can roles={['DEALER_ADMIN']} fallback={<p>Contact your dealer</p>}>
          <button>Lock device</button>
        </Can>
      </RequireAuth>
    );

    await waitFor(() => expect(screen.getByText('Contact your dealer')).toBeInTheDocument());
  });
});

describe('AccessDenied', () => {
  it('reads sensibly with no roles supplied', () => {
    render(<AccessDenied />);
    expect(screen.getByText(/your role does not permit/i)).toBeInTheDocument();
  });
});
