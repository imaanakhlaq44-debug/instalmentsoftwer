import { Router } from 'express';
import { z } from 'zod';

import { repo } from '../db/repositories/index.js';
import { DevicePolicy, Dealer } from '../types/index.js';
import { AuditService } from '../services/AuditService.js';
import { toPublicUser } from '../services/AuthService.js';
import { DEFAULT_POLICY } from '../services/InstallmentMath.js';
import {
  requireDealerAdmin, getAuthUser, resolveDealerScope, resolveWritableDealerId, clientIp,
} from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { pakistaniPhoneSchema, normalizePhone } from '../utils/validators.js';

export const settingsRouter = Router();

settingsRouter.use(requireDealerAdmin);

async function ensurePolicy(dealerId: string): Promise<DevicePolicy> {
  const existing = await repo.devicePolicies.findByDealer(dealerId);
  if (existing) return existing;

  const nowIso = new Date().toISOString();
  return repo.devicePolicies.create({
    ...DEFAULT_POLICY,
    id: `pol-${dealerId}`,
    dealerId,
    emergencyCallsAllowed: true,
    paymentMethodsOnLock: ['CASH', 'JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER'],
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

settingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const scope = resolveDealerScope(req);

  // A super admin with no dealer selected has no single settings page to show.
  const dealerId = scope ?? user.dealerId;
  if (!dealerId) {
    throw AppError.badRequest('Select a specific dealer to view their settings.');
  }

  const dealer = await repo.dealers.findById(dealerId);
  if (!dealer) throw AppError.notFound('Dealer');

  const [policy, license, staff] = await Promise.all([
    ensurePolicy(dealer.id),
    repo.licenseKeys.findByDealer(dealer.id),
    repo.users.findMany({ where: { dealerId: dealer.id }, orderBy: { createdAt: 'desc' } }),
  ]);

  res.json({ dealer, policy, license: license ?? null, staffUsers: staff.map(toPublicUser) });
  })
);

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
}, validateBody(policySchema), asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const { dealerId: bodyDealerId, ...changes } = req.body as z.infer<typeof policySchema>;
  const dealerId = await resolveWritableDealerId(req, bodyDealerId);

  const existing = await ensurePolicy(dealerId);

  const updates = Object.fromEntries(
    Object.entries(changes).filter(([, v]) => v !== undefined)
  ) as Partial<DevicePolicy>;

  if (Object.keys(updates).length === 0) {
    throw AppError.badRequest('No changes were supplied.');
  }

  const updated = await repo.devicePolicies.update(existing.id, {
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  if (!updated) throw AppError.notFound('Policy');

  // Auto-lock is the setting that actually restricts someone's phone — it gets
  // its own explicit line in the audit trail.
  const autoLockChanged =
    updates.autoLockEnabled !== undefined && updates.autoLockEnabled !== existing.autoLockEnabled;

  await AuditService.log({
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
}));

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
}, validateBody(profileSchema), asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const { dealerId: bodyDealerId, ...changes } = req.body as z.infer<typeof profileSchema>;
  const dealerId = await resolveWritableDealerId(req, bodyDealerId);

  const dealer = await repo.dealers.findById(dealerId);
  if (!dealer) throw AppError.notFound('Dealer');

  const updates = Object.fromEntries(
    Object.entries(changes).filter(([, v]) => v !== undefined)
  ) as Partial<Dealer>;

  if (updates.phone) updates.phone = normalizePhone(updates.phone);
  if (Object.keys(updates).length === 0) {
    throw AppError.badRequest('No changes were supplied.');
  }

  const updated = await repo.dealers.update(dealer.id, updates);
  if (!updated) throw AppError.notFound('Dealer');

  await AuditService.log({
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
}));
