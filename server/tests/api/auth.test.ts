import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';

import { disconnectDatabase } from '../../src/db/prisma.js';

import { anonymous, as, reseed, repo, tokenFor, ACCOUNTS, SEED_PASSWORD } from '../helpers.js';

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

describe('POST /api/auth/login', () => {
  it('issues a token for correct credentials', async () => {
    const res = await anonymous()
      .post('/api/auth/login')
      .send({ email: 'tariq@almadinamobiles.pk', password: SEED_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe('DEALER_ADMIN');
    expect(res.body.dealer.id).toBe('dealer-1');
  });

  it('never returns the password hash', async () => {
    const res = await anonymous()
      .post('/api/auth/login')
      .send({ email: 'tariq@almadinamobiles.pk', password: SEED_PASSWORD });

    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('matches the email case-insensitively', async () => {
    const res = await anonymous()
      .post('/api/auth/login')
      .send({ email: '  TARIQ@AlMadinaMobiles.PK ', password: SEED_PASSWORD });

    expect(res.status).toBe(200);
  });

  it('rejects a wrong password', async () => {
    const res = await anonymous()
      .post('/api/auth/login')
      .send({ email: 'tariq@almadinamobiles.pk', password: 'WrongPassword#1' });

    expect(res.status).toBe(401);
  });

  it('gives the same message for an unknown email as for a wrong password', async () => {
    const unknown = await anonymous()
      .post('/api/auth/login')
      .send({ email: 'nobody@nowhere.pk', password: 'WrongPassword#1' });
    const wrong = await anonymous()
      .post('/api/auth/login')
      .send({ email: 'tariq@almadinamobiles.pk', password: 'WrongPassword#1' });

    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe(wrong.body.error);
  });

  it('refuses a deactivated account', async () => {
    await repo.users.update(ACCOUNTS.dealerStaff, { active: false });

    const res = await anonymous()
      .post('/api/auth/login')
      .send({ email: 'usman@almadinamobiles.pk', password: SEED_PASSWORD });

    expect(res.status).toBe(403);
  });

  it('locks the account after five consecutive failures', async () => {
    for (let i = 0; i < 5; i++) {
      await anonymous()
        .post('/api/auth/login')
        .send({ email: 'usman@almadinamobiles.pk', password: 'WrongPassword#1' });
    }

    // Even the correct password is now refused, with a lockout status.
    const res = await anonymous()
      .post('/api/auth/login')
      .send({ email: 'usman@almadinamobiles.pk', password: SEED_PASSWORD });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many failed login attempts/i);
  });

  it('resets the failure counter after a successful sign-in', async () => {
    for (let i = 0; i < 3; i++) {
      await anonymous()
        .post('/api/auth/login')
        .send({ email: 'usman@almadinamobiles.pk', password: 'WrongPassword#1' });
    }
    expect((await repo.users.findById(ACCOUNTS.dealerStaff))!.failedLoginAttempts).toBe(3);

    await anonymous()
      .post('/api/auth/login')
      .send({ email: 'usman@almadinamobiles.pk', password: SEED_PASSWORD });

    expect((await repo.users.findById(ACCOUNTS.dealerStaff))!.failedLoginAttempts).toBe(0);
  });
});

describe('token handling', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await anonymous().get('/api/devices');
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with a different secret', async () => {
    const forged = jwt.sign(
      { userId: ACCOUNTS.dealerAdmin, role: 'DEALER_ADMIN', dealerId: 'dealer-1' },
      'not-the-real-secret',
      { issuer: 'emi-shield' }
    );

    const res = await anonymous().get('/api/devices').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token from another issuer', async () => {
    const forged = jwt.sign(
      { userId: ACCOUNTS.dealerAdmin, role: 'DEALER_ADMIN', dealerId: 'dealer-1' },
      process.env.JWT_SECRET!,
      { issuer: 'somebody-else' }
    );

    const res = await anonymous().get('/api/devices').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign(
      { userId: ACCOUNTS.dealerAdmin, role: 'DEALER_ADMIN', dealerId: 'dealer-1' },
      process.env.JWT_SECRET!,
      { issuer: 'emi-shield', expiresIn: '-1h' }
    );

    const res = await anonymous().get('/api/devices').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('stops honouring a valid token once the account is deactivated', async () => {
    const before = await as(ACCOUNTS.dealerStaff).get('/api/devices');
    expect(before.status).toBe(200);

    await repo.users.update(ACCOUNTS.dealerStaff, { active: false });
    const after = await as(ACCOUNTS.dealerStaff).get('/api/devices');

    expect(after.status).toBe(403);
  });

  it('stops honouring a token whose account has been deleted', async () => {
    // The token is minted before the account goes away, so it is well-formed
    // and correctly signed — only the account behind it is gone.
    const token = tokenFor(ACCOUNTS.dealerStaff);
    await repo.users.delete(ACCOUNTS.dealerStaff);

    const res = await anonymous().get('/api/devices').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('does not trust a role claim baked into the token', async () => {
    // Same real user id, but claiming SUPER_ADMIN. requireAuth re-reads the
    // account, so the forged claim must be ignored.
    const escalated = jwt.sign(
      {
        userId: ACCOUNTS.dealerStaff,
        role: 'SUPER_ADMIN',
        dealerId: 'dealer-1',
        name: 'Usman Ali',
        email: 'usman@almadinamobiles.pk',
      },
      process.env.JWT_SECRET!,
      { issuer: 'emi-shield', expiresIn: '1h' }
    );

    const res = await anonymous().get('/api/audit-logs').set('Authorization', `Bearer ${escalated}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/auth/me', () => {
  it('restores the session for a valid token', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(ACCOUNTS.dealerAdmin);
  });

  it('requires a token', async () => {
    expect((await anonymous().get('/api/auth/me')).status).toBe(401);
  });
});

describe('POST /api/auth/change-password', () => {
  it('rejects a wrong current password', async () => {
    const res = await as(ACCOUNTS.dealerStaff)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'NotMyPassword#1', newPassword: 'BrandNew#2026x' });

    expect(res.status).toBe(401);
  });

  it('rejects a weak new password', async () => {
    // 422 from the Zod schema (too short); the strength policy in AuthService
    // returns 400 for anything that gets past it.
    const short = await as(ACCOUNTS.dealerStaff)
      .post('/api/auth/change-password')
      .send({ currentPassword: SEED_PASSWORD, newPassword: 'abc' });
    expect(short.status).toBe(422);

    const noComplexity = await as(ACCOUNTS.dealerStaff)
      .post('/api/auth/change-password')
      .send({ currentPassword: SEED_PASSWORD, newPassword: 'aaaaaaaaaaaa' });
    expect([400, 422]).toContain(noComplexity.status);
  });

  it('rejects reusing the current password', async () => {
    const res = await as(ACCOUNTS.dealerStaff)
      .post('/api/auth/change-password')
      .send({ currentPassword: SEED_PASSWORD, newPassword: SEED_PASSWORD });

    expect(res.status).toBe(400);
  });

  it('changes the password and makes the new one work', async () => {
    const res = await as(ACCOUNTS.dealerStaff)
      .post('/api/auth/change-password')
      .send({ currentPassword: SEED_PASSWORD, newPassword: 'BrandNew#2026x' });
    expect(res.status).toBe(200);

    const old = await anonymous()
      .post('/api/auth/login')
      .send({ email: 'usman@almadinamobiles.pk', password: SEED_PASSWORD });
    expect(old.status).toBe(401);

    const fresh = await anonymous()
      .post('/api/auth/login')
      .send({ email: 'usman@almadinamobiles.pk', password: 'BrandNew#2026x' });
    expect(fresh.status).toBe(200);
  });
});

describe('GET /api/health', () => {
  it('is reachable without a token', async () => {
    const res = await anonymous().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
