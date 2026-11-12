import { Router } from 'express';
import { z } from 'zod';

import { repo } from '../db/repositories/index.js';
import { DevicePolicy, Dealer } from '../types/index.js';
import { AuditService } from '../services/AuditService.js';
import { LicenseService } from '../services/LicenseService.js';
import { SmsAggregatorService } from '../services/SmsAggregatorService.js';
import { WhatsAppDispatchService } from '../services/whatsapp/WhatsAppDispatchService.js';
import { WHATSAPP_LANGUAGES } from '../services/whatsapp/templates.js';
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

  const [policy, licences, staff] = await Promise.all([
    ensurePolicy(dealer.id),
    LicenseService.summaryFor(dealer.id),
    repo.users.findMany({ where: { dealerId: dealer.id }, orderBy: { createdAt: 'desc' } }),
  ]);

  res.json({
    dealer,
    policy,
    licences,
    staffUsers: staff.map(toPublicUser),
    // Whether the aggregator choices under "SMS channel" can be picked at all.
    smsAggregator: SmsAggregatorService.describe(),
    /** Whether the platform can send through the WhatsApp Business Cloud API at all. */
    whatsappCloudEnabled: WhatsAppDispatchService.isEnabled(),
  });
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
    stagedRestrictionsEnabled: z.boolean().optional(),
    locationOnRecoveryEnabled: z.boolean().optional(),
    autoUnlockEnabled: z.boolean().optional(),
    lockWarningDays: z.number().int().min(0).max(15).optional(),
    /**
     * 0 disables the offline rule. The floor of 3 on anything else is
     * deliberate: below that, an ordinary weekend in a village with no signal
     * would lock a handset whose owner has paid every installment on time.
     */
    offlineLockAfterDays: z
      .number()
      .int()
      .min(0)
      .max(90)
      .refine((v) => v === 0 || v >= 3, {
        message: 'The offline limit must be 0 (off) or at least 3 days.',
      })
      .optional(),
    /**
     * Google account ids for Factory Reset Protection. Android takes the
     * numeric account id here, not an email — an email would be accepted by
     * the phone and then match nobody, leaving a wiped handset that no one can
     * set up. Rejecting it here is far kinder than finding out at the counter.
     */
    frpAccountIds: z
      .array(
        z
          .string()
          .trim()
          .regex(/^\d{6,30}$/, 'A Google account id is the long number from your Google account, not an email address.')
      )
      .max(5, 'At most 5 Google accounts can be allowed.')
      .transform((ids) => [...new Set(ids)])
      .optional(),
    customerReminderEnabled: z.boolean().optional(),
    /**
     * Which way this shop's SMS go out: its paired phone, the aggregator, or
     * the aggregator with the phone behind it.
     */
    smsChannel: z.enum(['PHONE', 'AGGREGATOR', 'AGGREGATOR_THEN_PHONE']).optional(),
    // Accepted so an older dashboard can still save, and always stored as
    // true: clause 4 of every terms version promises emergency calls.
    emergencyCallsAllowed: z.boolean().transform(() => true).optional(),
    /** Language of the messages the shop opens in its own WhatsApp. */
    whatsappLanguage: z.enum(WHATSAPP_LANGUAGES).optional(),
    /** Where automatic reminders are queued. */
    reminderChannel: z.enum(['SMS', 'WHATSAPP']).optional(),
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

  const smsChannelChanged =
    updates.smsChannel !== undefined && updates.smsChannel !== (existing.smsChannel ?? 'PHONE');

  // Choosing the aggregator on a server that has none would look like a
  // working setup while every reminder quietly went nowhere new.
  if (smsChannelChanged && updates.smsChannel !== 'PHONE' && !SmsAggregatorService.isConfigured()) {
    throw AppError.badRequest(
      'No SMS gateway account is set up on this server yet. Messages can only go through a paired phone for now.'
    );
  }

  if (updates.reminderChannel === 'WHATSAPP' && !WhatsAppDispatchService.isEnabled()) {
    throw AppError.badRequest(
      'Automatic WhatsApp reminders are not available: the WhatsApp Business API is not connected on this server. ' +
        'Reminders stay on SMS. The WhatsApp button on each customer still works.'
    );
  }

  const updated = await repo.devicePolicies.update(existing.id, {
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  if (!updated) throw AppError.notFound('Policy');

  // Waiting messages start afresh on the new channel, so none is left queued
  // for a sender that is no longer allowed to collect it.
  if (smsChannelChanged) await repo.notifications.resetRoutingForDealer(dealerId);

  // The two settings that actually restrict someone's phone get their own
  // explicit lines in the audit trail rather than a list of changed keys.
  const autoLockChanged =
    updates.autoLockEnabled !== undefined && updates.autoLockEnabled !== existing.autoLockEnabled;
  const offlineLockChanged =
    updates.offlineLockAfterDays !== undefined &&
    updates.offlineLockAfterDays !== (existing.offlineLockAfterDays ?? 0);

  const stagedChanged =
    updates.stagedRestrictionsEnabled !== undefined &&
    updates.stagedRestrictionsEnabled !== (existing.stagedRestrictionsEnabled ?? false);

  const locationChanged =
    updates.locationOnRecoveryEnabled !== undefined &&
    updates.locationOnRecoveryEnabled !== (existing.locationOnRecoveryEnabled ?? false);

  const frpChanged =
    updates.frpAccountIds !== undefined &&
    updates.frpAccountIds.join(',') !== (existing.frpAccountIds ?? []).join(',');

  const details = locationChanged
    ? `${user.name} turned location for recovery ${updates.locationOnRecoveryEnabled ? 'ON' : 'OFF'}. ` +
      'It applies only to agreements signed while it is on.'
    : frpChanged
    ? updates.frpAccountIds!.length === 0
      ? `${user.name} turned Factory Reset Protection OFF for handsets.`
      : `${user.name} set Factory Reset Protection to ${updates.frpAccountIds!.length} Google account(s): ` +
        `${updates.frpAccountIds!.join(', ')}.`
    : stagedChanged
    ? `${user.name} turned staged restrictions (calls/SMS, then apps, then lock) ${updates.stagedRestrictionsEnabled ? 'ON' : 'OFF'}.`
    : autoLockChanged
    ? `${user.name} turned automatic device locking ${updates.autoLockEnabled ? 'ON' : 'OFF'}.`
    : offlineLockChanged
      ? updates.offlineLockAfterDays === 0
        ? `${user.name} turned the offline lock rule OFF.`
        : `${user.name} set handsets to restrict themselves after ${updates.offlineLockAfterDays} day(s) ` +
          'without reaching the server.'
      : smsChannelChanged
        ? `${user.name} set SMS to go out through ${
            updates.smsChannel === 'PHONE'
              ? 'the paired phone'
              : updates.smsChannel === 'AGGREGATOR'
                ? 'the SMS gateway'
                : 'the SMS gateway, with the paired phone as a fallback'
          }.`
        : `${user.name} updated the enforcement policy: ${Object.keys(updates).join(', ')}.`;

  await AuditService.log({
    dealerId,
    userId: user.userId,
    actorName: user.name,
    actorRole: user.role,
    action: autoLockChanged || offlineLockChanged || frpChanged || stagedChanged || locationChanged ? 'AUTO_LOCK_POLICY_CHANGED' : 'POLICY_UPDATED',
    targetType: 'POLICY',
    targetId: existing.id,
    details,
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
