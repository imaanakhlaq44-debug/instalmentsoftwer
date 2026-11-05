import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { anonymous, reseed, repo } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { createSuperAdmin } from '../../src/services/SuperAdminBootstrap.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

const input = { email: 'Owner@AlmasSDM.pro', name: 'Platform Owner', password: 'Owner#Strong2026' };

describe('creating a super admin from the server shell', () => {
  it('creates a SUPER_ADMIN that can sign in', async () => {
    const user = await createSuperAdmin(input);
    expect(user.role).toBe('SUPER_ADMIN');
    expect(user.email).toBe('owner@almassdm.pro');
    expect(user.dealerId).toBeUndefined();

    const login = await anonymous()
      .post('/api/auth/login')
      .send({ email: 'owner@almassdm.pro', password: input.password });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('SUPER_ADMIN');
  });

  it('can issue a pack of locks to a shop', async () => {
    await createSuperAdmin(input);
    const login = await anonymous()
      .post('/api/auth/login')
      .send({ email: input.email, password: input.password });
    const res = await anonymous()
      .post('/api/licenses/packs')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ dealerId: 'dealer-1', size: 30 });
    expect(res.status).toBe(201);
  });

  it('refuses a weak password and an email already in use', async () => {
    await expect(createSuperAdmin({ ...input, password: 'short' })).rejects.toThrow();
    await expect(createSuperAdmin({ ...input, email: 'tariq@almadinamobiles.pk' })).rejects.toThrow(/already exists/);
    expect(await repo.users.findByEmail('owner@almassdm.pro')).toBeFalsy();
  });
});
