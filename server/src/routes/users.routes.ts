import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { repo, dealerScope } from '../db/repositories/index.js';
import { User } from '../types/index.js';
import { AuthService, toPublicUser } from '../services/AuthService.js';
import { AuditService } from '../services/AuditService.js';
import {
  requireDealerAdmin,
  getAuthUser,
  resolveDealerScope,
  resolveWritableDealerId,
  assertDealerAccess,
  clientIp,
  routeParam,
} from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword, validatePasswordStrength } from '../utils/password.js';
import { pakistaniPhoneSchema, normalizePhone } from '../utils/validators.js';

export const usersRouter = Router();

// Only dealer admins and above may manage staff accounts.
usersRouter.use(requireDealerAdmin);

/** List staff for the caller's dealership. */
usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = resolveDealerScope(req);
    const users = await repo.users.findMany({
      where: dealerScope(scope),
      orderBy: { createdAt: 'desc' },
    });
    res.json(users.map(toPublicUser));
  })
);

const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(120),
  email: z.string().trim().email('Please enter a valid email address.').max(255),
  phone: pakistaniPhoneSchema,
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
  role: z.enum(['DEALER_ADMIN', 'DEALER_STAFF', 'CUSTOMER']),
  /** Required when role is CUSTOMER — binds the login to one customer record. */
  customerId: z.string().trim().optional(),
  dealerId: z.string().trim().optional(),
});

usersRouter.post(
  '/',
  validateBody(createUserSchema),
  asyncHandler(async (req, res) => {
  const actor = getAuthUser(req);
  const body = req.body as z.infer<typeof createUserSchema>;
  const dealerId = await resolveWritableDealerId(req, body.dealerId);

  const strength = validatePasswordStrength(body.password);
  if (!strength.valid) throw AppError.badRequest(strength.errors.join(' '));

  if (await repo.users.findByEmail(body.email)) {
    throw AppError.conflict('A user account already exists with this email address.');
  }

  // A CUSTOMER login is only meaningful when tied to a customer record we own.
  let customerId: string | undefined;
  if (body.role === 'CUSTOMER') {
    if (!body.customerId) {
      throw AppError.badRequest('A customerId is required when creating a CUSTOMER login.');
    }
    const customer = await repo.customers.findById(body.customerId);
    if (!customer) throw AppError.notFound('Customer');
    assertDealerAccess(req, customer.dealerId, 'customer');
    customerId = customer.id;
  }

  const nowIso = new Date().toISOString();
  const user = await repo.users.create({
    id: `user-${uuidv4().substring(0, 8)}`,
    dealerId,
    customerId,
    name: body.name,
    email: body.email,
    passwordHash: hashPassword(body.password),
    role: body.role,
    phone: normalizePhone(body.phone),
    active: true,
    // The admin knows this password, so force a change on first sign-in.
    mustChangePassword: true,
    passwordChangedAt: nowIso,
    createdAt: nowIso,
  });

  await AuditService.log({
    dealerId,
    userId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: 'USER_CREATED',
    targetType: 'USER',
    targetId: user.id,
    details: `${actor.name} created a ${body.role} account for ${body.name} (${body.email}).`,
    ipAddress: clientIp(req),
  });

  res.status(201).json(toPublicUser(user));
  })
);

const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: pakistaniPhoneSchema.optional(),
  role: z.enum(['DEALER_ADMIN', 'DEALER_STAFF', 'CUSTOMER']).optional(),
  active: z.boolean().optional(),
});

usersRouter.patch(
  '/:id',
  validateBody(updateUserSchema),
  asyncHandler(async (req, res) => {
  const actor = getAuthUser(req);
  const target = await repo.users.findById(routeParam(req, 'id'));
  if (!target) throw AppError.notFound('User');
  assertDealerAccess(req, target.dealerId, 'user');

  const body = req.body as z.infer<typeof updateUserSchema>;

  // Guard rails that prevent an admin from locking everyone out or escalating.
  if (target.id === actor.userId) {
    if (body.active === false) throw AppError.badRequest('You cannot deactivate your own account.');
    if (body.role && body.role !== target.role) throw AppError.badRequest('You cannot change your own role.');
  }
  if (target.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
    throw AppError.forbidden('Only a super admin can modify a super admin account.');
  }
  if (body.role === 'DEALER_ADMIN' && actor.role !== 'SUPER_ADMIN' && actor.role !== 'DEALER_ADMIN') {
    throw AppError.forbidden('You do not have permission to grant dealer admin access.');
  }

  const updates: Partial<User> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.phone !== undefined) updates.phone = normalizePhone(body.phone);
  if (body.role !== undefined) updates.role = body.role;
  if (body.active !== undefined) updates.active = body.active;

  if (Object.keys(updates).length === 0) {
    throw AppError.badRequest('No changes were supplied.');
  }

  const updated = await repo.users.update(target.id, updates);
  if (!updated) throw AppError.notFound('User');

  await AuditService.log({
    dealerId: target.dealerId,
    userId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: 'USER_UPDATED',
    targetType: 'USER',
    targetId: target.id,
    details: `${actor.name} updated ${target.name}: ${Object.keys(updates).join(', ')}.`,
    ipAddress: clientIp(req),
  });

  res.json(toPublicUser(updated));
  })
);

const resetPasswordSchema = z.object({
  temporaryPassword: z.string().min(8, 'Temporary password must be at least 8 characters.').max(128),
});

usersRouter.post(
  '/:id/reset-password',
  validateBody(resetPasswordSchema),
  asyncHandler(async (req, res) => {
  const actor = getAuthUser(req);
  const result = await AuthService.resetPassword({
    actor,
    targetUserId: routeParam(req, 'id'),
    temporaryPassword: (req.body as z.infer<typeof resetPasswordSchema>).temporaryPassword,
    ipAddress: clientIp(req),
  });
  res.json(result);
  })
);

/**
 * Deactivation rather than deletion — audit logs and payment records reference
 * user ids, so hard-deleting a staff member would orphan the trail.
 */
usersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
  const actor = getAuthUser(req);
  const target = await repo.users.findById(routeParam(req, 'id'));
  if (!target) throw AppError.notFound('User');
  assertDealerAccess(req, target.dealerId, 'user');

  if (target.id === actor.userId) {
    throw AppError.badRequest('You cannot deactivate your own account.');
  }
  if (target.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
    throw AppError.forbidden('Only a super admin can deactivate a super admin account.');
  }

  await repo.users.update(target.id, { active: false });

  await AuditService.log({
    dealerId: target.dealerId,
    userId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: 'USER_DEACTIVATED',
    targetType: 'USER',
    targetId: target.id,
    details: `${actor.name} deactivated the account of ${target.name} (${target.role}).`,
    ipAddress: clientIp(req),
  });

  res.json({ success: true, message: `${target.name}'s account has been deactivated.` });
  })
);
