import React from 'react';
import { vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { AuthProvider } from '../context/AuthContext.js';
import { RequireAuth } from '../components/auth/RouteGuards.js';
import { LanguageProvider } from '../i18n/LanguageContext.js';
import { TOKEN_STORAGE_KEY } from '../services/api.js';
import type { UserRole } from '../types/index.js';

/**
 * Shared plumbing for page tests.
 *
 * Pages are rendered the way the app renders them: inside the real router, the
 * real AuthProvider and the real ApiService. Only `fetch` is replaced, so the
 * role flags, the request a button actually sends and the error a server sends
 * back are all the real code paths.
 */

export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any;
}

class Failure {
  constructor(
    public status: number,
    public payload: Record<string, unknown>
  ) {}
}

/** A server refusal: `fail(403, 'You have no device locks left.')`. */
export function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return new Failure(status, { error, ...extra });
}

/** A paginated list, as every list endpoint returns it. */
export function paged<T>(data: T[], extra: Record<string, unknown> = {}) {
  return {
    data,
    pagination: {
      page: 1,
      limit: 25,
      total: data.length,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    ...extra,
  };
}

type Reply = unknown | ((req: MockRequest) => unknown);

export interface MockApiOptions {
  role: UserRole;
  /** Keyed "METHOD /path" (no /api prefix, no query string). */
  routes?: Record<string, Reply>;
  /** Extra fields on the signed-in user, e.g. `customerId`. */
  user?: Record<string, unknown>;
}

export interface MockApi {
  calls: MockRequest[];
  /** Every request made to "METHOD /path". */
  to: (key: string) => MockRequest[];
  /** Replace or add a route after the page is up. */
  on: (key: string, reply: Reply) => void;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Signs a user of the given role in and answers the API from `routes`.
 * A request with no route gets a 404 that names it, so a missing mock shows up
 * in the test output instead of passing silently.
 */
export function mockApi({ role, routes = {}, user = {} }: MockApiOptions): MockApi {
  localStorage.setItem(TOKEN_STORAGE_KEY, 'stored-token');
  const table: Record<string, Reply> = { ...routes };
  const calls: MockRequest[] = [];

  const session = {
    user: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@almassdm.pk',
      role,
      mustChangePassword: false,
      ...(role === 'CUSTOMER' ? { customerId: 'cust-1' } : {}),
      ...user,
    },
    dealer: role === 'SUPER_ADMIN' ? undefined : { id: 'dealer-1', name: 'Al-Madina Mobile Hub' },
    token: 'stored-token',
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname.replace(/^\/api/, '');
      const method = (init.method ?? 'GET').toUpperCase();
      if (path === '/auth/me') return json(200, session);

      let body: any;
      try {
        body = init.body ? JSON.parse(String(init.body)) : undefined;
      } catch {
        body = init.body;
      }
      const req: MockRequest = { method, path, query: url.searchParams, body };
      calls.push(req);

      const key = `${method} ${path}`;
      if (!(key in table)) return json(404, { error: `No mock for ${key}` });
      const reply = table[key];
      const result = typeof reply === 'function' ? (reply as (r: MockRequest) => unknown)(req) : reply;
      if (result instanceof Failure) return json(result.status, result.payload);
      return json(200, result ?? {});
    })
  );

  return {
    calls,
    to: (key) => calls.filter((c) => `${c.method} ${c.path}` === key),
    on: (key, reply) => {
      table[key] = reply;
    },
  };
}

/** Where the app went, for asserting on navigation without mounting other pages. */
const Elsewhere: React.FC = () => {
  const location = useLocation();
  return (
    <p>
      Went to {location.pathname}
      {location.search}
    </p>
  );
};

export interface RenderPageOptions {
  /** The URL the user is on. */
  path?: string;
  /** The route pattern the page is mounted at; defaults to the path itself. */
  route?: string;
  /** Extra chrome rendered beside the page (e.g. the language switch). */
  chrome?: React.ReactNode;
}

/**
 * Renders a page behind RequireAuth, as App.tsx does, so it mounts only once
 * the session is known — a page never sees a half-loaded role.
 */
export function renderPage(ui: React.ReactNode, { path = '/', route, chrome }: RenderPageOptions = {}) {
  const pattern = route ?? path.split('?')[0];
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <LanguageProvider>
          {chrome}
          <Routes>
            <Route path={pattern} element={<RequireAuth>{ui}</RequireAuth>} />
            <Route path="*" element={<Elsewhere />} />
          </Routes>
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

/** Sets a field's value in one step — the forms here are long, and per-key typing is slow. */
export function fill(field: Element, value: string) {
  fireEvent.change(field, { target: { value } });
}
