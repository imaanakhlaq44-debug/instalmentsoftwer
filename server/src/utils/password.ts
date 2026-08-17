import bcrypt from 'bcryptjs';
import { config } from '../config.js';

/** bcrypt hashes always start with $2a$ / $2b$ / $2y$ followed by the cost factor. */
const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isHashed(value: string): boolean {
  return BCRYPT_PATTERN.test(value);
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, config.bcryptRounds);
}

/**
 * Compares a candidate password against a stored value.
 *
 * Existing databases created by the prototype hold plain-text passwords. Rather
 * than locking those users out, we accept an exact plain-text match once and the
 * caller is expected to immediately re-store a proper hash (see `needsRehash`).
 */
export function verifyPassword(plain: string, stored: string): boolean {
  if (!plain || !stored) return false;
  if (isHashed(stored)) {
    return bcrypt.compareSync(plain, stored);
  }
  return timingSafeEqual(plain, stored);
}

/** True when the stored value should be replaced with a fresh bcrypt hash. */
export function needsRehash(stored: string): boolean {
  return !isHashed(stored);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface PasswordStrengthResult {
  valid: boolean;
  errors: string[];
}

/**
 * Minimum policy for any password the system accepts. Deliberately modest so
 * shop staff can actually remember it, but strong enough to survive a leak of
 * the data file.
 */
export function validatePasswordStrength(plain: string): PasswordStrengthResult {
  const errors: string[] = [];

  if (!plain || plain.length < 8) {
    errors.push('Password must be at least 8 characters long.');
  }
  if (plain && plain.length > 128) {
    errors.push('Password must be 128 characters or fewer.');
  }
  if (!/[A-Za-z]/.test(plain || '')) {
    errors.push('Password must contain at least one letter.');
  }
  if (!/[0-9]/.test(plain || '')) {
    errors.push('Password must contain at least one number.');
  }

  const banned = [
    'password', '12345678', 'admin123', 'dealer123', 'staff123',
    'customer123', 'qwerty123', 'demo1234', '11111111',
  ];
  if (banned.includes((plain || '').toLowerCase())) {
    errors.push('This password is too common. Please choose a different one.');
  }

  return { valid: errors.length === 0, errors };
}
