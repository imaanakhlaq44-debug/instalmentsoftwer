import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';

import { errorHandler } from '../../src/middleware/errorHandler.js';

function run(err: unknown) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  errorHandler(err, { method: 'POST', originalUrl: '/api/customers' } as Request, res as unknown as Response, () => {});
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
}

describe('errorHandler — uniqueness conflicts', () => {
  it('turns a Prisma unique violation into a 409, not a 500', () => {
    const { status, body } = run(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    expect(status).toBe(409);
    expect(body.code).toBe('ALREADY_EXISTS');
  });

  it('does the same for a raw Postgres 23505', () => {
    expect(run(Object.assign(new Error('duplicate key'), { code: '23505' })).status).toBe(409);
  });

  it('still reports an unknown fault as a 500', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(run(new Error('boom')).status).toBe(500);
    spy.mockRestore();
  });
});
