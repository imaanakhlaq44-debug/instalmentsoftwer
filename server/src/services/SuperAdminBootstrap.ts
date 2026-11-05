import { v4 as uuidv4 } from 'uuid';

import { repo } from '../db/repositories/index.js';
import { User } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword, validatePasswordStrength } from '../utils/password.js';
import { AuditService } from './AuditService.js';

export interface SuperAdminInput {
  email: string;
  name: string;
  password: string;
  phone?: string;
}

/**
 * Creates a platform super admin on a live database.
 *
 * Production never seeds (AUTO_SEED is refused there), and no endpoint can mint
 * a SUPER_ADMIN, since any such endpoint would itself be the most valuable thing
 * on the server to attack. So the first one is created from a shell on the
 * server with `node dist/scripts/createSuperAdmin.js`, which calls this.
 *
 * Without one, nobody can issue a pack of locks, and a shop that has paid could
 * never enrol a phone.
 */
export async function createSuperAdmin(input: SuperAdminInput): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw AppError.badRequest('Please give a valid email address.');
  }
  if (name.length < 2) {
    throw AppError.badRequest('Name must be at least 2 characters.');
  }
  const strength = validatePasswordStrength(input.password);
  if (!strength.valid) {
    throw AppError.badRequest(strength.errors.join(' '));
  }
  if (await repo.users.findByEmail(email)) {
    throw AppError.conflict('An account already exists with this email address.');
  }

  const nowIso = new Date().toISOString();
  const user = await repo.users.create({
    id: `user-${uuidv4().substring(0, 8)}`,
    name,
    email,
    passwordHash: hashPassword(input.password),
    role: 'SUPER_ADMIN',
    phone: input.phone?.trim() || '',
    active: true,
    passwordChangedAt: nowIso,
    createdAt: nowIso,
  });

  await AuditService.log({
    userId: user.id,
    actorName: 'Server shell',
    actorRole: 'SUPER_ADMIN',
    action: 'SUPER_ADMIN_CREATED',
    targetType: 'USER',
    targetId: user.id,
    details: `Super admin ${email} created from the server shell.`,
  });

  return user;
}
