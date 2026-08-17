import jwt from 'jsonwebtoken';
import { db } from '../db/db.js';
import { User, UserRole, Dealer, AuthenticatedUser } from '../types/index.js';
import { AuditService } from './AuditService.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword, needsRehash, validatePasswordStrength } from '../utils/password.js';
import { AppError } from '../utils/AppError.js';

/** Account is temporarily blocked after this many consecutive failures. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export interface PublicUser {
  id: string;
  dealerId?: string;
  customerId?: string;
  name: string;
  email: string;
  role: UserRole;
  phone: string;
  active: boolean;
  lastLoginAt?: string;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface AuthSession {
  user: PublicUser;
  dealer?: Dealer;
  token: string;
  expiresIn: string;
}

/** Strips passwordHash and internal lockout fields before anything leaves the server. */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    dealerId: user.dealerId,
    customerId: user.customerId,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    active: user.active,
    lastLoginAt: user.lastLoginAt,
    mustChangePassword: user.mustChangePassword === true,
    createdAt: user.createdAt,
  };
}

export class AuthService {
  public static login(email: string, password: string, ipAddress?: string): AuthSession {
    if (!email || !password) {
      throw new AppError('Email and password are required.', 400);
    }

    const user = db.findOne<User>('users', (u) => u.email.toLowerCase() === String(email).trim().toLowerCase());

    // Uniform message: never reveal whether the email exists.
    const invalidCredentials = () => new AppError('Invalid email or password.', 401);

    if (!user) {
      // Burn roughly the same time a real bcrypt comparison would take, so an
      // attacker cannot distinguish "no such user" from "wrong password".
      verifyPassword(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi');
      throw invalidCredentials();
    }

    if (!user.active) {
      throw new AppError('This account has been deactivated. Please contact your administrator.', 403);
    }

    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const minutesLeft = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60_000);
      throw new AppError(
        `Too many failed login attempts. Try again in ${minutesLeft} minute(s).`,
        429
      );
    }

    if (!verifyPassword(password, user.passwordHash)) {
      this.registerFailedAttempt(user, ipAddress);
      throw invalidCredentials();
    }

    // Successful login — upgrade any legacy plain-text password in place.
    const updates: Partial<User> = {
      lastLoginAt: new Date().toISOString(),
      failedLoginAttempts: 0,
      lockedUntil: undefined,
    };
    if (needsRehash(user.passwordHash)) {
      updates.passwordHash = hashPassword(password);
      updates.passwordChangedAt = new Date().toISOString();
      console.warn(`[auth] Migrated legacy plain-text password to bcrypt for user ${user.id}.`);
    }
    const current = db.update<User>('users', user.id, updates) || user;

    const dealer = current.dealerId ? db.findById<Dealer>('dealers', current.dealerId) : undefined;

    if (dealer && !dealer.active) {
      throw new AppError('Your dealer account is suspended. Please contact EMI Shield support.', 403);
    }

    AuditService.log({
      dealerId: current.dealerId,
      userId: current.id,
      actorName: current.name,
      actorRole: current.role,
      action: 'USER_LOGIN',
      targetType: 'USER',
      targetId: current.id,
      details: `${current.name} signed in as ${current.role}.`,
      ipAddress,
    });

    return {
      user: toPublicUser(current),
      dealer,
      token: this.issueToken(current),
      expiresIn: config.jwt.expiresIn,
    };
  }

  private static registerFailedAttempt(user: User, ipAddress?: string): void {
    const attempts = (user.failedLoginAttempts || 0) + 1;
    const updates: Partial<User> = { failedLoginAttempts: attempts };

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      updates.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
      updates.failedLoginAttempts = 0;

      AuditService.log({
        dealerId: user.dealerId,
        userId: user.id,
        actorName: user.name,
        actorRole: user.role,
        action: 'ACCOUNT_LOCKED',
        targetType: 'USER',
        targetId: user.id,
        details: `Account locked for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED_ATTEMPTS} failed login attempts.`,
        ipAddress,
      });
    }

    db.update<User>('users', user.id, updates);
  }

  public static issueToken(user: User): string {
    const payload: AuthenticatedUser = {
      userId: user.id,
      dealerId: user.dealerId,
      customerId: user.customerId,
      role: user.role,
      name: user.name,
      email: user.email,
    };

    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
      issuer: 'emi-shield',
    } as jwt.SignOptions);
  }

  public static verifyToken(token: string): AuthenticatedUser | null {
    try {
      const decoded = jwt.verify(token, config.jwt.secret, { issuer: 'emi-shield' });
      if (typeof decoded === 'string') return null;
      return decoded as unknown as AuthenticatedUser;
    } catch {
      return null;
    }
  }

  /** Returns the current session for an already-authenticated request. */
  public static getSession(userId: string): AuthSession {
    const user = db.findById<User>('users', userId);
    if (!user || !user.active) {
      throw new AppError('Session is no longer valid. Please sign in again.', 401);
    }
    const dealer = user.dealerId ? db.findById<Dealer>('dealers', user.dealerId) : undefined;
    return {
      user: toPublicUser(user),
      dealer,
      token: this.issueToken(user),
      expiresIn: config.jwt.expiresIn,
    };
  }

  public static changePassword(params: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    ipAddress?: string;
  }): { success: true; message: string } {
    const user = db.findById<User>('users', params.userId);
    if (!user) throw new AppError('User not found.', 404);

    if (!verifyPassword(params.currentPassword, user.passwordHash)) {
      throw new AppError('Current password is incorrect.', 401);
    }

    if (params.currentPassword === params.newPassword) {
      throw new AppError('New password must be different from the current password.', 400);
    }

    const strength = validatePasswordStrength(params.newPassword);
    if (!strength.valid) {
      throw new AppError(strength.errors.join(' '), 400);
    }

    db.update<User>('users', user.id, {
      passwordHash: hashPassword(params.newPassword),
      passwordChangedAt: new Date().toISOString(),
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: undefined,
    });

    AuditService.log({
      dealerId: user.dealerId,
      userId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'PASSWORD_CHANGED',
      targetType: 'USER',
      targetId: user.id,
      details: `${user.name} changed their own password.`,
      ipAddress: params.ipAddress,
    });

    return { success: true, message: 'Password updated successfully.' };
  }

  /**
   * Admin-initiated reset. The target user must change the temporary password
   * on their next login.
   */
  public static resetPassword(params: {
    actor: AuthenticatedUser;
    targetUserId: string;
    temporaryPassword: string;
    ipAddress?: string;
  }): { success: true; message: string } {
    const target = db.findById<User>('users', params.targetUserId);
    if (!target) throw new AppError('User not found.', 404);

    // A dealer admin may only reset passwords inside their own dealership.
    if (params.actor.role !== 'SUPER_ADMIN' && target.dealerId !== params.actor.dealerId) {
      throw new AppError('You do not have permission to reset this user\'s password.', 403);
    }

    const strength = validatePasswordStrength(params.temporaryPassword);
    if (!strength.valid) {
      throw new AppError(strength.errors.join(' '), 400);
    }

    db.update<User>('users', target.id, {
      passwordHash: hashPassword(params.temporaryPassword),
      passwordChangedAt: new Date().toISOString(),
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: undefined,
    });

    AuditService.log({
      dealerId: target.dealerId,
      userId: params.actor.userId,
      actorName: params.actor.name,
      actorRole: params.actor.role,
      action: 'PASSWORD_RESET',
      targetType: 'USER',
      targetId: target.id,
      details: `${params.actor.name} reset the password for ${target.name}. User must change it on next login.`,
      ipAddress: params.ipAddress,
    });

    return { success: true, message: `Temporary password set for ${target.name}.` };
  }
}
