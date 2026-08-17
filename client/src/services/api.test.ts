import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ApiService, ApiError, TOKEN_STORAGE_KEY, setUnauthorizedHandler } from './api.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => impl(String(input), init));
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  setUnauthorizedHandler(null);
});

describe('request building', () => {
  it('prefixes every call with /api', async () => {
    const spy = stubFetch(() => json({}));
    await ApiService.getDevices({});

    expect(String(spy.mock.calls[0][0])).toBe('/api/devices');
  });

  it('attaches the stored token', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc123');
    const spy = stubFetch(() => json({}));

    await ApiService.getDevices({});

    const headers = spy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer abc123');
  });

  it('sends no Authorization header when signed out', async () => {
    const spy = stubFetch(() => json({}));
    await ApiService.getDevices({});

    const headers = spy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

/**
 * `buildQuery` drops empty values and the literal 'ALL'. Sending `status=ALL`
 * would be harmless but noisy; sending `search=` would filter on an empty
 * string on some endpoints.
 */
describe('query string', () => {
  it('includes real values', async () => {
    const spy = stubFetch(() => json({}));
    await ApiService.getDevices({ page: 2, limit: 25, search: 'galaxy' });

    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('page=2');
    expect(url).toContain('limit=25');
    expect(url).toContain('search=galaxy');
  });

  it('omits undefined, null, empty and ALL', async () => {
    const spy = stubFetch(() => json({}));
    await ApiService.getDevices({
      page: 1,
      status: 'ALL',
      brand: '',
      customerId: undefined,
      dealerId: null,
    });

    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('page=1');
    expect(url).not.toContain('status=');
    expect(url).not.toContain('brand=');
    expect(url).not.toContain('customerId=');
    expect(url).not.toContain('dealerId=');
  });

  it('encodes a value with spaces and symbols', async () => {
    const spy = stubFetch(() => json({}));
    await ApiService.getDevices({ search: 'Muhammad Ali & Sons' });

    const url = String(spy.mock.calls[0][0]);
    expect(url).not.toContain(' ');

    // Parsed rather than hand-decoded: URLSearchParams writes a space as "+",
    // which decodeURIComponent would leave as a literal plus.
    const parsed = new URL(url, 'http://localhost').searchParams;
    expect(parsed.get('search')).toBe('Muhammad Ali & Sons');
  });
});

describe('error handling', () => {
  it('raises the server\'s message, not a generic one', async () => {
    stubFetch(() => json({ error: 'This customer account is deactivated.' }, 400));

    await expect(ApiService.getDevices({})).rejects.toThrow('This customer account is deactivated.');
  });

  it('carries the status code', async () => {
    stubFetch(() => json({ error: 'Nope' }, 403));

    await expect(ApiService.getDevices({})).rejects.toMatchObject({ status: 403 });
  });

  it('reports an unreachable server in words a shopkeeper can act on', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    const error = await ApiService.getDevices({}).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).message).toMatch(/cannot reach the server/i);
  });

  it('falls back to the status line when the body carries no message', async () => {
    stubFetch(() => new Response('not json', { status: 500, statusText: 'Internal Server Error' }));

    await expect(ApiService.getDevices({})).rejects.toThrow(/500/);
  });

  it('returns undefined for a 204 rather than trying to parse a body', async () => {
    stubFetch(() => new Response(null, { status: 204 }));

    await expect(ApiService.getDevices({})).resolves.toBeUndefined();
  });
});

/**
 * The server returns Zod issues as `{ field, message }`, with nested paths like
 * `customer.phone`. Forms hold flat state, so the last segment is the key.
 */
describe('ApiError.fieldErrors', () => {
  it('maps validation details onto form field names', () => {
    const error = new ApiError('Invalid', 422, 'VALIDATION_ERROR', [
      { field: 'customer.phone', message: 'Phone must be a valid Pakistani mobile number.' },
      { field: 'cnic', message: 'CNIC must be 13 digits.' },
    ]);

    expect(error.fieldErrors).toEqual({
      phone: 'Phone must be a valid Pakistani mobile number.',
      cnic: 'CNIC must be 13 digits.',
    });
  });

  it('is empty when the error carries no details', () => {
    expect(new ApiError('Boom', 500).fieldErrors).toEqual({});
  });
});

describe('the 401 handler', () => {
  it('fires when a request finds the session dead', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    stubFetch(() => json({ error: 'Session expired' }, 401));

    await ApiService.getDevices({}).catch(() => undefined);

    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('does NOT fire for a failed sign-in', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    stubFetch(() => json({ error: 'Invalid email or password.' }, 401));

    await ApiService.login('a@b.pk', 'wrong').catch(() => undefined);

    // Otherwise mistyping a password tells the user their session expired.
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('does not fire on other error statuses', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    stubFetch(() => json({ error: 'Forbidden' }, 403));

    await ApiService.getDevices({}).catch(() => undefined);

    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe('mutations', () => {
  it('posts a login as JSON', async () => {
    const spy = stubFetch(() => json({ token: 't' }));

    await ApiService.login('tariq@almadinamobiles.pk', 'Emishield#2026');

    const init = spy.mock.calls[0][1]!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'tariq@almadinamobiles.pk',
      password: 'Emishield#2026',
    });
  });

  it('never puts a password in the URL', async () => {
    const spy = stubFetch(() => json({ token: 't' }));

    await ApiService.login('tariq@almadinamobiles.pk', 'Emishield#2026');

    expect(String(spy.mock.calls[0][0])).not.toContain('Emishield');
  });
});
