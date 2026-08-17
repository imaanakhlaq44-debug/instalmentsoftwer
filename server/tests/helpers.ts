import request from 'supertest';

import { app } from '../src/index.js';
import { repo } from '../src/db/repositories/index.js';
import { resetAndSeedPostgres } from '../src/db/seedPostgres.js';
import { AuthService } from '../src/services/AuthService.js';
import { User } from '../src/types/index.js';

export { app, repo };

export const SEED_PASSWORD = 'Emishield#2026';

/** Demo accounts, one per role, as created by `generateSeedData`. */
export const ACCOUNTS = {
  superAdmin: 'user-superadmin',
  dealerAdmin: 'user-dealer-admin-1',   // dealer-1
  dealerStaff: 'user-dealer-staff-1',   // dealer-1
  otherDealerAdmin: 'user-dealer-admin-2', // dealer-2
  customer: 'user-customer-1',          // dealer-1 / cust-1
} as const;

/**
 * The seeded logins, cached so `as()` can stay synchronous.
 *
 * Minting a token needs the user record, and making that an `await` would turn
 * `as(id).post(url).send(body)` into a promise chain at every call site. The
 * accounts are fixed by the fixture, so they are read once per reseed instead.
 */
const seededUsers = new Map<string, User>();

/**
 * Truncates every table and reloads the seeded fixture. Call in `beforeEach` —
 * the database is shared across the file, so a test that records a payment
 * would otherwise leak into the next one.
 */
export async function reseed(): Promise<void> {
  await resetAndSeedPostgres();

  seededUsers.clear();
  for (const user of await repo.users.findMany()) {
    seededUsers.set(user.id, user);
  }
}

/** A bearer token for a seeded user, minted directly to skip the bcrypt cost. */
export function tokenFor(userId: string): string {
  const user = seededUsers.get(userId);
  if (!user) throw new Error(`No seeded user with id "${userId}". Did you call reseed()?`);
  return AuthService.issueToken(user);
}

export function authHeader(userId: string): { Authorization: string } {
  return { Authorization: `Bearer ${tokenFor(userId)}` };
}

/** `request(app)` with the Authorization header already attached. */
export function as(userId: string) {
  const header = authHeader(userId);
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).set(header),
    post: (url: string) => agent.post(url).set(header),
    patch: (url: string) => agent.patch(url).set(header),
    put: (url: string) => agent.put(url).set(header),
    delete: (url: string) => agent.delete(url).set(header),
  };
}

export const anonymous = () => request(app);
