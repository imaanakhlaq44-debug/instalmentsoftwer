import { Router } from 'express';
import { z } from 'zod';

import { db } from '../db/db.js';
import { DevicePolicy, Dealer, User, LicenseKey } from '../types/index.js';
import { AuditService } from '../services/AuditService.js';
import { toPublicUser } from '../services/AuthService.js';
import { DEFAULT_POLICY } from '../services/InstallmentMath.js';
import {
  requireDealerAdmin, getAuthUser, resolveDealerScope, resolveWritableDealerId, clientIp,
} from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { AppError } from '../utils/AppError.js';
import { pakistaniPhoneSchema, normalizePhone } from '../utils/validators.js';

export const settingsRouter = Router();

settingsRouter.use(requireDealerAdmin);

function ensurePolicy(dealerId: string): DevicePolicy {
  const existing = db.findOne<DevicePolicy>('devicePolicies', (p) => p.dealerId === dealerId);
  if (existing) return existing;

  const nowIso = new Date().toISOString();
  return db.insert<DevicePolicy>('devicePolicies', {
    ...DEFAULT_POLICY,
    id: `pol-${dealerId}`,
    dealerId,
    emergencyCallsAllowed: true,
    paymentMethodsOnLock: ['CASH', 'JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER'],
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

settingsRouter.get('/', (req, res) => {
  const user = getAuthUser(req);
  const scope = resolveDealerScope(req);

  // A super admin with no dealer selected has no single settings page to show.
  const dealerId = scope ?? user.dealerId;
  if (!dealerId) {
    throw AppError.badRequest('Select a specific dealer to view their settings.');
  }

  const dealer = db.findById<Dealer>('dealers', dealerId);
  if (!dealer) throw AppError.notFound('Dealer');

  const policy = ensurePolicy(dealer.id);
  const license = db.findOne<LicenseKey>('licenseKeys', (l) => l.dealerId === dealer.id);
  const staffUsers = db.find<User>('users', (u) => u.dealerId === dealer.id).map(toPublicUser);

  res.json({ dealer, policy, license: license ?? null, staffUsers });
});

// ---------------------------------------------------------------------------
// POLICY
// ---------------------------------------------------------------------------

const policySchema = z
  .object({
    dealerId: z.string().trim().max(64).optional(),
    gracePeriodDays: z.number().int().min(0).max(30).optional(),
    autoLockEnabled: z.boolean().optional(),
    autoUnlockEnabled: z.boolean().optional(),
    lockWarningDays: z.number().int().min(0).max(15).optional(),
    customerReminderEnabled: z.boolean().optional(),
    emergencyCallsAllowed: z.boolean().optional(),
    paymentMethodsOnLock: z.array(z.string().trim().max(30)).max(10).optional(),

    lateFeeEnabled: z.boolean().optional(),
    lateFeeType: z.enum(['FIXED', 'PERCENTAGE']).optional(),
    lateFeeAmount: z.number().min(0).max(1_000_000).optional(),
    lateFeeFrequency: z.enum(['ONE_TIME', 'DAILY']).optional(),
    lateFeeMaxPerInstallment: z.number().min(0).max(1_000_000).optional(),
  })
  .refine(
    (v) => v.lateFeeType !== 'PERCENTAGE' || v.lateFeeAmount === undefined || v.lateFeeAmount <= 100,
    { message: 'A percentage late fee cannot exceed 100%.', path: ['lateFeeAmount'] }
  );

/**
 * Accepts either a flat body or the legacy `{ policyData: {...} }` shape the
 * existing client sends, so the dashboard keeps working during the rollout.
 */
settingsRouter.put('/policy', (req, res, next) => {
  const body = req.body as Record<string, unknown>;
  if (body && typeof body.policyData === 'object' && body.policyData !== null) {
    req.body = { ...(body.policyData as object), dealerId: body.dealerId };
  }
  next();
}, validateBody(policySchema), (req, res) => {
  const user = getAuthUser(req);
  const { dealerId: bodyDealerId, ...changes } = req.body as z.infer<typeof policySchema>;
  const dealerId = resolveWritableDealerId(req, bodyDealerId);

  const existing = ensurePolicy(dealerId);

  const updates = Object.fromEntries(
    Object.entries(changes).filter(([, v]) => v !== undefined)
  ) as Partial<DevicePolicy>;

  if (Object.keys(updates).length === 0) {
    throw AppError.badRequest('No changes were supplied.');
  }

  const updated = db.update<DevicePolicy>('devicePolicies', existing.id, {
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  if (!updated) throw AppError.notFound('Policy');

  // Auto-lock is the setting that actually restricts someone's phone — it gets
  // its own explicit line in the audit trail.
  const autoLockChanged =
    updates.autoLockEnabled !== undefined && updates.autoLockEnabled !== existing.autoLockEnabled;

  AuditService.log({
    dealerId,
    userId: user.userId,
    actorName: user.name,
    actorRole: user.role,
    action: autoLockChanged ? 'AUTO_LOCK_POLICY_CHANGED' : 'POLICY_UPDATED',
    targetType: 'POLICY',
    targetId: existing.id,
    details: autoLockChanged
      ? `${user.name} turned automatic device locking ${updates.autoLockEnabled ? 'ON' : 'OFF'}.`
      : `${user.name} updated the enforcement policy: ${Object.keys(updates).join(', ')}.`,
    ipAddress: clientIp(req),
  });

  res.json({ success: true, policy: updated });
});

// ---------------------------------------------------------------------------
// DEALER PROFILE
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  dealerId: z.string().trim().max(64).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  ownerName: z.string().trim().min(2).max(120).optional(),
  phone: pakistaniPhoneSchema.optional(),
  city: z.string().trim().min(2).max(60).optional(),
  address: z.string().trim().min(5).max(300).optional(),
});

settingsRouter.put('/profile', (req, res, next) => {
  const body = req.body as Record<string, unknown>;
  if (body && typeof body.profileData === 'object' && body.profileData !== null) {
    req.body = { ...(body.profileData as object), dealerId: body.dealerId };
  }
  next();
}, validateBody(profileSchema), (req, res) => {
  const user = getAuthUser(req);
  const { dealerId: bodyDealerId, ...changes } = req.body as z.infer<typeof profileSchema>;
  const dealerId = resolveWritableDealerId(req, bodyDealerId);

  const dealer = db.findById<Dealer>('dealers', dealerId);
  if (!dealer) throw AppError.notFound('Dealer');

  const updates = Object.fromEntries(
    Object.entries(changes).filter(([, v]) => v !== undefined)
  ) as Partial<Dealer>;

  if (updates.phone) updates.phone = normalizePhone(updates.phone);
  if (Object.keys(updates).length === 0) {
    throw AppError.badRequest('No changes were supplied.');
  }

  const updated = db.update<Dealer>('dealers', dealer.id, updates);
  if (!updated) throw AppError.notFound('Dealer');

  AuditService.log({
    dealerId,
    userId: user.userId,
    actorName: user.name,
    actorRole: user.role,
    action: 'DEALER_PROFILE_UPDATED',
    targetType: 'DEALER',
    targetId: dealer.id,
    details: `${user.name} updated the shop profile: ${Object.keys(updates).join(', ')}.`,
    ipAddress: clientIp(req),
  });

  res.json({ success: true, dealer: updated });
});
