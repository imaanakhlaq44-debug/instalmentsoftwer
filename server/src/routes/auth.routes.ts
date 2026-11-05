import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { AuthService, toPublicUser } from '../services/AuthService.js';
import { repo } from '../db/repositories/index.js';
import { runInTransaction } from '../db/prisma.js';
import { Dealer } from '../types/index.js';
import { requireAuth, requireSuperAdmin, getAuthUser, clientIp } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword, validatePasswordStrength } from '../utils/password.js';
import { pakistaniPhoneSchema, normalizePhone } from '../utils/validators.js';
import { AuditService } from '../services/AuditService.js';
import { PACK_SIZE_RULE, priceForPack } from '../services/LicenseService.js';

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
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const session = await AuthService.login(email, password, clientIp(req));
    res.json(session);
  })
);

const registerDealerSchema = z.object({
  name: z.string().trim().min(2, 'Shop name must be at least 2 characters.').max(120),
  ownerName: z.string().trim().min(2, 'Owner name must be at least 2 characters.').max(120),
  email: z.string().trim().email('Please enter a valid email address.').max(255),
  phone: pakistaniPhoneSchema,
  city: z.string().trim().min(2).max(60),
  address: z.string().trim().min(5, 'Please enter a complete shop address.').max(300),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
  /**
   * The pack the shop wants to buy. Recorded, not issued: locks are minted only
   * once the platform confirms the money arrived (POST /api/licenses/packs).
   */
  packSize: z
    .number()
    .int()
    .refine((n) => priceForPack(n) !== undefined, {
      message: PACK_SIZE_RULE,
    })
    .default(30),
});

authRouter.post(
  '/register-dealer',
  validateBody(registerDealerSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof registerDealerSchema>;

    const strength = validatePasswordStrength(body.password);
    if (!strength.valid) {
      throw AppError.badRequest(strength.errors.join(' '));
    }

    if (await repo.dealers.findFirst({ email: { equals: body.email, mode: 'insensitive' } })) {
      throw AppError.conflict('A dealer is already registered with this email address.');
    }
    if (await repo.users.findByEmail(body.email)) {
      throw AppError.conflict('A user account already exists with this email address.');
    }

    const dealerId = `dealer-${uuidv4().substring(0, 8)}`;
    const cityCode = body.city.substring(0, 3).toUpperCase();
    const nowIso = new Date().toISOString();

    // A dealer without its policy or owner login is not a usable account.
    // Every row lands together or none of them do.
    //
    // No locks are issued here. This endpoint is public and there is no payment
    // gateway, so minting the requested pack at sign-up would hand anyone up to
    // 100 free locks. The shop starts with none; a super admin issues the pack
    // once payment is confirmed, and until then a financed sale is refused at
    // the counter with "no locks left" rather than going ahead unpaid.
    const requestedPack = priceForPack(body.packSize)!;
    const session = await runInTransaction(async (tx) => {
      await repo.dealers.create(
        {
          id: dealerId,
          name: body.name,
          code: `DLR-${cityCode}-${Math.floor(100 + Math.random() * 900)}`,
          ownerName: body.ownerName,
          email: body.email,
          phone: normalizePhone(body.phone),
          city: body.city,
          address: body.address,
          active: true,
          createdAt: nowIso,
          requestedPackSize: requestedPack.size,
        },
        tx
      );

      const user = await repo.users.create({
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
      }, tx);

      await repo.devicePolicies.create({
        id: `pol-${dealerId}`,
        dealerId,
        gracePeriodDays: 3,
        // New shops start with enforcement on: staged restrictions, and the
        // offline rule at its minimum of 3 days. Every one of these is printed
        // in the contract the customer signs, and the shop can turn any of
        // them off in Settings.
        autoLockEnabled: true,
        stagedRestrictionsEnabled: true,
        offlineLockAfterDays: 3,
        autoUnlockEnabled: true,
        lockWarningDays: 2,
        customerReminderEnabled: true,
        emergencyCallsAllowed: true,
        paymentMethodsOnLock: ['CASH', 'JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER'],
        createdAt: nowIso,
        updatedAt: nowIso,
      }, tx);

      await AuditService.log({
        dealerId,
        userId: user.id,
        actorName: user.name,
        actorRole: 'DEALER_ADMIN',
        action: 'DEALER_REGISTERED',
        targetType: 'DEALER',
        targetId: dealerId,
        details:
          `New dealer "${body.name}" registered in ${body.city}. Requested a pack of ` +
          `${requestedPack.size} device locks (Rs ${requestedPack.totalPrice}), not issued until payment is confirmed.`,
        ipAddress: clientIp(req),
      }, tx);

      return {
        user: toPublicUser(user),
        dealer: await repo.dealers.findById(dealerId, tx),
        token: AuthService.issueToken(user),
        requestedPack: { ...requestedPack, issued: false },
      };
    });

    res.status(201).json(session);
  })
);

// ---------------------------------------------------------------------------
// AUTHENTICATED
// ---------------------------------------------------------------------------

/** Returns the current session — used by the client to restore state on reload. */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await AuthService.getSession(getAuthUser(req).userId));
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.').max(128),
  newPassword: z.string().min(8, 'New password must be at least 8 characters.').max(128),
});

authRouter.post(
  '/change-password',
  requireAuth,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const result = await AuthService.changePassword({
      userId: getAuthUser(req).userId,
      currentPassword,
      newPassword,
      ipAddress: clientIp(req),
    });
    res.json(result);
  })
);

/**
 * Logout is client-side (the token is simply discarded), but we record it so the
 * audit trail shows a complete session history.
 */
authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    await AuditService.log({
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
  })
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
    const target = await repo.users.findById((req.body as z.infer<typeof impersonateSchema>).userId);

    if (!target) throw AppError.notFound('User');
    if (!target.active) throw AppError.badRequest('That account is deactivated and cannot be impersonated.');

    await AuditService.log({
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
      dealer: target.dealerId ? await repo.dealers.findById(target.dealerId) : undefined,
      token: AuthService.issueToken(target),
      impersonatedBy: { id: actor.userId, name: actor.name },
    });
  })
);
