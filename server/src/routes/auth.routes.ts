import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { AuthService, toPublicUser } from '../services/AuthService.js';
import { db } from '../db/db.js';
import { Dealer, User, LicenseKey, DevicePolicy } from '../types/index.js';
import { requireAuth, requireSuperAdmin, getAuthUser, clientIp } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword, validatePasswordStrength } from '../utils/password.js';
import { pakistaniPhoneSchema, normalizePhone } from '../utils/validators.js';
import { AuditService } from '../services/AuditService.js';

export const authRouter = Router();

// ---------------------------------------------------------------------------
// PUBLIC
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.').max(255),
  password: z.string().min(1, 'Password is required.').max(128),
});

authRouter.post(
  '/login',
  validateBody(loginSchema),
  (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const session = AuthService.login(email, password, clientIp(req));
    res.json(session);
  }
);

const registerDealerSchema = z.object({
  name: z.string().trim().min(2, 'Shop name must be at least 2 characters.').max(120),
  ownerName: z.string().trim().min(2, 'Owner name must be at least 2 characters.').max(120),
  email: z.string().trim().email('Please enter a valid email address.').max(255),
  phone: pakistaniPhoneSchema,
  city: z.string().trim().min(2).max(60),
  address: z.string().trim().min(5, 'Please enter a complete shop address.').max(300),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
  plan: z.enum(['STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE']).default('PROFESSIONAL'),
});

const PLAN_DEVICE_LIMITS: Record<string, number> = {
  STARTER: 25,
  PROFESSIONAL: 100,
  BUSINESS: 500,
  ENTERPRISE: 2000,
};

authRouter.post(
  '/register-dealer',
  validateBody(registerDealerSchema),
  (req, res) => {
    const body = req.body as z.infer<typeof registerDealerSchema>;

    const strength = validatePasswordStrength(body.password);
    if (!strength.valid) {
      throw AppError.badRequest(strength.errors.join(' '));
    }

    const emailLower = body.email.toLowerCase();

    if (db.findOne<Dealer>('dealers', (d) => d.email.toLowerCase() === emailLower)) {
      throw AppError.conflict('A dealer is already registered with this email address.');
    }
    if (db.findOne<User>('users', (u) => u.email.toLowerCase() === emailLower)) {
      throw AppError.conflict('A user account already exists with this email address.');
    }

    const dealerId = `dealer-${uuidv4().substring(0, 8)}`;
    const licenseId = `lic-${uuidv4().substring(0, 8)}`;
    const cityCode = body.city.substring(0, 3).toUpperCase();
    const nowIso = new Date().toISOString();

    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1);

    const session = db.batch(() => {
      db.insert<LicenseKey>('licenseKeys', {
        id: licenseId,
        dealerId,
        licenseKey: `EMIS-${body.plan.substring(0, 3)}-${Math.floor(1000 + Math.random() * 9000)}-${cityCode}`,
        plan: body.plan,
        deviceLimit: PLAN_DEVICE_LIMITS[body.plan] ?? 100,
        usedDevices: 0,
        expiryDate: expiry.toISOString().split('T')[0],
        status: 'ACTIVE',
        createdAt: nowIso,
      });

      db.insert<Dealer>('dealers', {
        id: dealerId,
        name: body.name,
        code: `DLR-${cityCode}-${Math.floor(100 + Math.random() * 900)}`,
        ownerName: body.ownerName,
        email: body.email,
        phone: normalizePhone(body.phone),
        city: body.city,
        address: body.address,
        licenseKeyId: licenseId,
        active: true,
        createdAt: nowIso,
      });

      const user = db.insert<User>('users', {
        id: `user-${uuidv4().substring(0, 8)}`,
        dealerId,
        name: body.ownerName,
        email: body.email,
        passwordHash: hashPassword(body.password),
        role: 'DEALER_ADMIN',
        phone: normalizePhone(body.phone),
        active: true,
        passwordChangedAt: nowIso,
        createdAt: nowIso,
      });

      db.insert<DevicePolicy>('devicePolicies', {
        id: `pol-${dealerId}`,
        dealerId,
        gracePeriodDays: 3,
        autoLockEnabled: false,
        autoUnlockEnabled: true,
        lockWarningDays: 2,
        customerReminderEnabled: true,
        emergencyCallsAllowed: true,
        paymentMethodsOnLock: ['CASH', 'JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER'],
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      AuditService.log({
        dealerId,
        userId: user.id,
        actorName: user.name,
        actorRole: 'DEALER_ADMIN',
        action: 'DEALER_REGISTERED',
        targetType: 'DEALER',
        targetId: dealerId,
        details: `New dealer "${body.name}" registered in ${body.city} on the ${body.plan} plan.`,
        ipAddress: clientIp(req),
      });

      return {
        user: toPublicUser(user),
        dealer: db.findById<Dealer>('dealers', dealerId),
        token: AuthService.issueToken(user),
      };
    });

    res.status(201).json(session);
  }
);

// ---------------------------------------------------------------------------
// AUTHENTICATED
// ---------------------------------------------------------------------------

/** Returns the current session — used by the client to restore state on reload. */
authRouter.get(
  '/me',
  requireAuth,
  (req, res) => {
    res.json(AuthService.getSession(getAuthUser(req).userId));
  }
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.').max(128),
  newPassword: z.string().min(8, 'New password must be at least 8 characters.').max(128),
});

authRouter.post(
  '/change-password',
  requireAuth,
  validateBody(changePasswordSchema),
  (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const result = AuthService.changePassword({
      userId: getAuthUser(req).userId,
      currentPassword,
      newPassword,
      ipAddress: clientIp(req),
    });
    res.json(result);
  }
);

/**
 * Logout is client-side (the token is simply discarded), but we record it so the
 * audit trail shows a complete session history.
 */
authRouter.post(
  '/logout',
  requireAuth,
  (req, res) => {
    const user = getAuthUser(req);
    AuditService.log({
      dealerId: user.dealerId,
      userId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'USER_LOGOUT',
      targetType: 'USER',
      targetId: user.userId,
      details: `${user.name} signed out.`,
      ipAddress: clientIp(req),
    });
    res.json({ success: true, message: 'Signed out successfully.' });
  }
);

/**
 * Impersonation, super-admin only.
 *
 * This replaces the old `/switch-role` endpoint, which was unauthenticated and
 * PERMANENTLY rewrote the target user's role in the database — any staff member
 * could promote themselves to super admin. This version issues a token for an
 * existing user without modifying a single record.
 */
const impersonateSchema = z.object({
  userId: z.string().trim().min(1, 'Target userId is required.'),
});

authRouter.post(
  '/impersonate',
  requireAuth,
  requireSuperAdmin,
  validateBody(impersonateSchema),
  asyncHandler(async (req, res) => {
    const actor = getAuthUser(req);
    const target = db.findById<User>('users', (req.body as z.infer<typeof impersonateSchema>).userId);

    if (!target) throw AppError.notFound('User');
    if (!target.active) throw AppError.badRequest('That account is deactivated and cannot be impersonated.');

    AuditService.log({
      dealerId: target.dealerId,
      userId: actor.userId,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'USER_IMPERSONATED',
      targetType: 'USER',
      targetId: target.id,
      details: `${actor.name} (SUPER_ADMIN) started an impersonation session as ${target.name} (${target.role}).`,
      ipAddress: clientIp(req),
    });

    res.json({
      user: toPublicUser(target),
      dealer: target.dealerId ? db.findById<Dealer>('dealers', target.dealerId) : undefined,
      token: AuthService.issueToken(target),
      impersonatedBy: { id: actor.userId, name: actor.name },
    });
  })
);
