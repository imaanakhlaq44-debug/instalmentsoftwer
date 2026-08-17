import request from 'supertest';

import { app } from '../src/index.js';
import { db } from '../src/db/db.js';
import { generateSeedData } from '../src/db/seed.js';
import { AuthService } from '../src/services/AuthService.js';
import { User } from '../src/types/index.js';

export { app, db };

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
 * Restores the store to the seeded fixture. Call in `beforeEach` — the JSON
 * store is a process-wide singleton, so a test that records a payment would
 * otherwise leak into the next one.
 */
export function reseed(): void {
  db.reset(generateSeedData());
}

/** A bearer token for a seeded user, minted directly to skip the bcrypt cost. */
export function tokenFor(userId: string): string {
  const user = db.findById<User>('users', userId);
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
